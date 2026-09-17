import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { readZip, sha256 } from '../packaging/standalone/archive.mjs';
import { extractEntries } from '../packaging/standalone/protocol.mjs';
import { runtimePreflight } from '../packaging/standalone/runtime.mjs';
import { verifyPackage } from './verify-package.mjs';
import { verifyReleaseChecksums, verifyRelease } from './verify-platform-package.mjs';
import { registryPackage, verifyRegistryPayload } from './publish-release.mjs';
import { ROOT, RELEASE_TARGETS, archiveRecord, emptyDirectory, options,
  requirePublicationReady, trustedEnvironment, verifyBundle, writeJson } from './release-bundle.mjs';

const execute = promisify(execFile);

export async function downloadPublicAssets(bundle, directory, fetcher = fetch) {
  await emptyDirectory(directory);
  const base = `https://github.com/${bundle.releaseRepository}/releases/download/v${encodeURIComponent(bundle.identity.version)}`;
  const records = bundle.files.filter(file => file.filename.startsWith('assets/'));
  // Descriptor/checksum pins are authenticated by the saved bundle, not by downloaded executable code.
  for (const name of ['release-descriptor.json', 'SHA256SUMS',
    ...records.map(file => file.filename.slice(7)).filter(name => !['release-descriptor.json', 'SHA256SUMS'].includes(name))]) {
    const record = records.find(file => file.filename === `assets/${name}`);
    const response = await fetcher(`${base}/${encodeURIComponent(name)}`);
    if (!response.ok) throw new Error(`Anonymous release asset unavailable: ${name} (${response.status})`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== record.size || sha256(bytes) !== record.sha256) {
      throw new Error(`Anonymous release asset differs from prepublication evidence: ${name}`);
    }
    await fs.writeFile(path.join(directory, name), bytes, { flag: 'wx' });
  }
  await verifyReleaseChecksums({ outputDir: directory,
    expectedDescriptorSha256: bundle.identity.descriptorSha256,
    expectedChecksumsSha256: bundle.identity.checksumsSha256 });
  await verifyRelease({ outputDir: directory, targets: RELEASE_TARGETS, rebuild: false });
  return { status: 'Passed', authentication: 'anonymous', descriptorSha256: bundle.identity.descriptorSha256,
    checksumsSha256: bundle.identity.checksumsSha256, files: records.length };
}

export async function acceptPublicHomebrew({ bundle, downloaded, environment = process.env,
  brew = process.env.SDLC_PUBLIC_HOMEBREW_BREW, run = execute }) {
  const formulas = bundle.descriptor.files.filter(file => file.kind === 'homebrew');
  if (formulas.length !== 1 || formulas[0].filename !== 'ai-sdlc-framework.rb') {
    throw new Error('Stable public Homebrew acceptance requires one frozen formula');
  }
  const formulaPath = path.join(downloaded, formulas[0].filename);
  const formulaBytes = await fs.readFile(formulaPath);
  if (formulaBytes.length !== formulas[0].size || sha256(formulaBytes) !== formulas[0].sha256) {
    throw new Error('Downloaded Homebrew formula differs from the frozen release metadata');
  }
  if (!brew) {
    brew = (await run('/usr/bin/which', ['brew'], { encoding: 'utf8' })).stdout.trim();
  }
  if (!path.isAbsolute(brew)) throw new Error('Public Homebrew acceptance requires an absolute brew executable');
  await fs.access(brew, fs.constants.X_OK);
  const env = Object.fromEntries(Object.entries(environment).filter(([key]) =>
    !/token|credential|password|secret|auth|proxy|^npm_|^node_options$|^node_path$|^copilot_home$/iu.test(key)));
  Object.assign(env, { HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_ANALYTICS: '1',
    HOMEBREW_NO_INSTALL_CLEANUP: '1' });
  const commands = [];
  const invoke = async args => {
    const result = await run(brew, args, { env, encoding: 'utf8', timeout: 20 * 60 * 1000,
      maxBuffer: 16 * 1024 * 1024 });
    commands.push({ command: brew, args, exitCode: 0 });
    return result;
  };
  let installed = false;
  let failure;
  try {
    await invoke(['install', '--formula', formulaPath]);
    installed = true;
    await invoke(['test', 'ai-sdlc-framework']);
  } catch (error) {
    failure = error;
  }
  if (installed) {
    try {
      await invoke(['uninstall', '--formula', 'ai-sdlc-framework']);
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure) throw failure;
  return { status: 'Passed', authentication: 'anonymous', formulaSha256: formulas[0].sha256,
    nativePlatform: process.platform, nativeArchitecture: process.arch, commands };
}

export async function acceptRelease({ directory, outputFile, npm = 'false', hooks = {}, ...expected }) {
  if (!['true', 'false'].includes(npm)) throw new Error('--npm must be true or false');
  const bundle = await verifyBundle({ directory, ...expected });
  requirePublicationReady(bundle);
  const root = path.join(ROOT, '.test-data', `release-acceptance-${randomUUID()}`);
  await fs.mkdir(root, { recursive: true });
  const result = { schemaVersion: 1, identity: bundle.identity,
    verifierCommit: process.env.ACCEPTANCE_VERIFIER_COMMIT ?? null, status: 'NotRun',
    publicAssets: { status: 'NotRun' }, nativeMacosArm64: 'NotRun',
    nativeWindows: 'NotRun', nativeMacosIntel: 'NotRun',
    npm: { status: 'NotRun' }, homebrew: bundle.context.prerelease ?
      { status: 'NotApplicable', reason: 'Prereleases do not publish stable Homebrew metadata' } :
      { status: 'NotRun', reason: 'Required stable Homebrew acceptance hook not integrated' },
    wingetCommunity: { status: 'NotRun', reason: 'Community submission and native client availability are not cross-build evidence' } };
  try {
    if (process.platform !== 'darwin' || process.arch !== 'arm64') {
      throw new Error('Postpublication lifecycle requires native macOS arm64');
    }
    await runtimePreflight();
    const downloaded = path.join(root, 'public-assets');
    result.publicAssets = await downloadPublicAssets(bundle, downloaded);
    const windows = archiveRecord(bundle, 'windows-x64');
    const extracted = path.join(root, 'windows-integrity-only');
    await extractEntries(readZip(await fs.readFile(path.join(downloaded, windows.filename))), extracted);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !/token|credential|password|secret|auth|proxy|^npm_|^node_options$|^node_path$|^copilot_home$/iu.test(key)));
    Object.assign(env, { HOME: path.join(root, 'home'), USERPROFILE: path.join(root, 'home'),
      TMPDIR: root, TMP: root, TEMP: root, npm_config_cache: path.join(root, 'npm-cache'),
      npm_config_userconfig: path.join(root, 'npmrc'), npm_config_offline: 'true',
      SDLC_DISTRIBUTION_TARGET: 'macos-arm64', SDLC_DISTRIBUTION_TARGETS: RELEASE_TARGETS.join(','),
      SDLC_RELEASE_DIR: downloaded, SDLC_WINDOWS_LAUNCHER: path.join(extracted, 'bin/sdlc.exe') });
    await fs.mkdir(env.HOME);
    await fs.writeFile(env.npm_config_userconfig, '');
    const lifecycle = await execute(process.execPath, ['--test', 'test/distribution-channels.test.mjs'], {
      cwd: ROOT, env, timeout: 20 * 60 * 1000, maxBuffer: 16 * 1024 * 1024,
    });
    process.stdout.write(lifecycle.stdout);
    result.nativeMacosArm64 = 'Passed';
    if (npm === 'true') {
      const identity = { name: bundle.descriptor.name, version: bundle.identity.version,
        sha256: bundle.identity.payloadSha256 };
      const metadata = await registryPackage(identity.name, identity.version);
      if (!metadata) throw new Error('The exact npm version is not anonymously available');
      const bytes = await verifyRegistryPayload(metadata, identity);
      const artifact = path.join(root, bundle.descriptor.payload.filename);
      await fs.writeFile(artifact, bytes, { flag: 'wx' });
      await verifyPackage({ artifact, environment: env });
      result.npm = { status: 'Passed', authentication: 'anonymous', payloadSha256: identity.sha256 };
    }
    if (!bundle.context.prerelease) {
      result.homebrew = await (hooks.homebrew ?? acceptPublicHomebrew)({ bundle, downloaded, environment: env });
      if (result.homebrew.status !== 'Passed') throw new Error('Requested Homebrew acceptance hook did not pass');
    }
    result.status = 'Passed';
    return result;
  } catch (error) {
    result.status = error.code === 'RELEASE_INTEGRATION_BLOCKED' ? 'NotRun' : 'Failed';
    if (error.code === 'RELEASE_INTEGRATION_BLOCKED') result.diagnosticStatus = 'Blocked';
    result.reason = error.message;
    if (error.stdout) process.stdout.write(error.stdout);
    if (error.stderr) process.stderr.write(error.stderr);
    throw error;
  } finally {
    await writeJson(outputFile, result);
    await fs.rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.env.EXPECTED_BUNDLE_SHA256) throw new Error('Acceptance requires the saved prepublication bundle digest');
  console.log(JSON.stringify(await acceptRelease({
    ...options(process.argv.slice(2)), ...trustedEnvironment(),
  }), null, 2));
}
