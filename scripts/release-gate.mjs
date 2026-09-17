import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { canonical, readZip } from '../packaging/standalone/archive.mjs';
import { extractEntries } from '../packaging/standalone/protocol.mjs';
import { runtimePreflight } from '../packaging/standalone/runtime.mjs';
import { buildLauncher } from '../packaging/winget/build-launcher.mjs';
import { validateManifests } from '../packaging/winget/validate.mjs';
import { renderManifests } from '../packaging/winget/generate.mjs';
import { verifyPlatformPackage, verifyRelease } from './verify-platform-package.mjs';
import { buildPackage } from './package.mjs';
import { buildPlatforms } from './package-platforms.mjs';
import { verifyPackage } from './verify-package.mjs';
import { ROOT, MACOS_ARCHITECTURES, RELEASE_TARGETS, RELEASE_GATE_TARGETS, RELEASE_SCOPE, archiveRecord, homebrewMetadata, options,
  readJson, trustedEnvironment, verifyCandidate, writeJson } from './release-bundle.mjs';

const execute = promisify(execFile);

function integrationBlocked(message) {
  return Object.assign(new Error(message), { code: 'RELEASE_INTEGRATION_BLOCKED',
    homebrewResult: { nativeValidation: 'NotRun', reason: message } });
}

export async function verifyNativeHomebrew({ candidate, candidateDir, scratch,
  brew = process.env.SDLC_HOMEBREW_BREW, verifyLifecycle } = {}) {
  if (!candidate.context.prerelease && candidate.context.homebrew.status !== 'Generated') {
    throw integrationBlocked('Mandatory native Homebrew validation requires the integrated dual-architecture stable generator');
  }
  if (!verifyLifecycle) {
    const modulePath = path.join(ROOT, 'scripts/homebrew-lifecycle.mjs');
    const present = await fs.stat(modulePath).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (!present) throw integrationBlocked('Mandatory native Homebrew lifecycle hook is not integrated');
    verifyLifecycle = (await import(pathToFileURL(modulePath).href)).verifyHomebrewLifecycle;
  }
  if (typeof verifyLifecycle !== 'function') throw new Error('Homebrew lifecycle module must export verifyHomebrewLifecycle');
  if (!brew || !path.isAbsolute(brew)) throw integrationBlocked('Provide SDLC_HOMEBREW_BREW for an approved isolated Homebrew prefix');
  const root = path.join(scratch, 'homebrew-native');
  try {
    const evidence = await verifyLifecycle({ brew, candidateDirectory: path.resolve(candidateDir, 'assets'), root });
    if (evidence?.passed !== true || evidence.platform !== 'darwin' || evidence.architecture !== 'arm64' ||
        evidence.uname !== 'arm64' || [true, 1, '1'].includes(evidence.sysctlProcTranslated) || evidence.cleanupError) {
      throw new Error('Mandatory Homebrew native lifecycle, architecture or cleanup did not pass');
    }
    return { nativeValidation: 'Passed', evidence };
  } catch (error) {
    const evidence = await readJson(path.join(root, 'evidence.json')).catch(() => null);
    error.homebrewResult = { nativeValidation: 'Failed', reason: error.message, evidence };
    error.retainedWorkspace = scratch;
    throw error;
  }
}

export async function verifyMacosArchives({ candidate, candidateDir, scratch, environment = process.env }) {
  const assets = path.resolve(candidateDir, 'assets');
  const fresh = await buildPackage({ outputDir: path.join(scratch, 'fresh-npm'), environment });
  if (fresh.sha256 !== candidate.context.identity.payloadSha256) throw new Error('Intel archive payload differs from the current source');
  const artifacts = [path.join(assets, candidate.descriptor.payload.filename), fresh.artifact];
  for (const [index, artifact] of artifacts.entries()) {
    const rebuilt = await buildPlatforms({ artifact, outputDir: path.join(scratch, `macos-rebuild-${index}`),
      sourceCommit: candidate.context.identity.sourceCommit, targets: MACOS_ARCHITECTURES.map(arch => `macos-${arch}`), environment });
    for (const arch of MACOS_ARCHITECTURES) {
      const record = archiveRecord(candidate, `macos-${arch}`);
      const actual = rebuilt.archives.find(file => file.target === `macos-${arch}`);
      if (actual.sha256 !== record.sha256 || actual.size !== record.size) throw new Error(`Independent macOS ${arch} archive rebuild mismatch`);
    }
  }
  const archive = archiveRecord(candidate, 'macos-x64');
  const verified = await verifyPlatformPackage({ artifact: path.join(assets, archive.filename),
    expectedPlatform: 'darwin', expectedArch: 'x64',
    expectedDescriptorSha256: candidate.context.identity.descriptorSha256,
    expectedChecksumsSha256: candidate.context.identity.checksumsSha256 });
  return { validation: 'Passed', target: verified.target, platform: 'darwin', arch: 'x64',
    filename: verified.filename, sha256: verified.sha256, size: archive.size,
    payloadSha256: verified.payloadSha256, inventoryDigest: verified.inventoryDigest };
}

export async function verifyIntelFormula({ candidate, candidateDir, scratch, generator }) {
  const descriptor = { ...candidate.descriptor, files: candidate.descriptor.files.filter(file => file.kind === 'archive') };
  const options = { descriptor, artifactDirectory: path.resolve(candidateDir, 'assets'),
    repository: candidate.context.releaseRepository, generator,
    ...(candidate.context.prerelease ? { mode: 'candidate', candidateBaseUrl: 'http://127.0.0.1:8765/' } : {}) };
  const results = [];
  for (const iteration of ['first', 'second']) {
    const result = await homebrewMetadata({ ...options, outputDir: path.join(scratch, `intel-formula-${iteration}`) });
    if (result.status !== 'Generated') throw integrationBlocked('Mandatory Intel formula validation requires the integrated dual-architecture Homebrew generator');
    results.push(result);
  }
  const records = results.map(result => result.files.map(({ artifact, ...record }) => record));
  if (canonical(records[0]) !== canonical(records[1])) throw new Error('Independent Intel Homebrew formula generations differ');
  if (!candidate.context.prerelease &&
      canonical(records[0]) !== canonical(candidate.descriptor.files.filter(file => file.kind === 'homebrew'))) {
    throw new Error('Rebuilt Intel formula differs from frozen public Homebrew metadata');
  }
  return { ...results[0].validation, deterministicGeneration: 'Passed', formula: records[0][0],
    publication: candidate.context.prerelease ? 'NotPublishedPrerelease' : 'StableMetadata',
    nativeValidation: 'NotRun' };
}

async function command(executable, args, env, cwd = ROOT) {
  const result = await execute(executable, args, { cwd, env, timeout: 20 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  return result;
}

export async function runGate({ candidateDir, evidenceDir, target, ...expected }) {
  if (!RELEASE_GATE_TARGETS.includes(target)) throw new Error('Target is outside the release scope');
  const candidate = await verifyCandidate(candidateDir, expected);
  const policy = RELEASE_SCOPE[target];
  const result = { schemaVersion: 1, target, required: policy.required, validation: policy.validation,
    identity: candidate.context.identity, status: 'NotRun', nativeValidation: 'NotRun',
    host: { platform: process.platform, arch: process.arch, node: process.version,
      machine: os.machine(), runnerImage: process.env.ImageOS ?? 'local', runnerImageVersion: process.env.ImageVersion ?? null },
    ...(process.env.GITHUB_RUN_ID ? { run: { id: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT } } : {}) };
  const scratch = path.join(ROOT, '.test-data', `release-gate-${randomUUID()}`);
  await fs.mkdir(scratch, { recursive: true });
  const env = { ...process.env, TMPDIR: scratch, TEMP: scratch, TMP: scratch,
    GOTMPDIR: scratch, GOCACHE: path.join(scratch, 'go-cache'),
    GOENV: 'off', GOTOOLCHAIN: 'local', GOWORK: 'off', GOPROXY: 'off', GOSUMDB: 'off',
    NODE_OPTIONS: '', NODE_PATH: '' };
  try {
    if (target === 'macos-x64') {
      result.deterministicArchive = await verifyMacosArchives({ candidate, candidateDir, scratch, environment: env });
      result.homebrew = await verifyIntelFormula({ candidate, candidateDir, scratch });
      result.reason = 'Intel archive and architecture-specific formula metadata were checked as data only; no Intel launcher, Ruby, brew, or native lifecycle was executed.';
      result.status = 'Passed';
      return result;
    }
    const assets = path.resolve(candidateDir, 'assets');
    if (target === 'macos-arm64') {
      if (process.platform !== 'darwin' || process.arch !== 'arm64') {
        throw new Error('Mandatory lifecycle requires native Apple Silicon Node, not Intel or emulation');
      }
      await runtimePreflight();
      result.host.uname = (await execute('/usr/bin/uname', ['-m'])).stdout.trim();
      const translated = await execute('/usr/sbin/sysctl', ['-in', 'sysctl.proc_translated'])
        .then(value => ({ exitCode: 0, stdout: value.stdout.trim(), stderr: value.stderr.trim() }),
          error => ({ exitCode: error.code, stdout: error.stdout?.trim() ?? '', stderr: error.stderr?.trim() ?? error.message }));
      result.host.sysctlProcTranslated = translated;
      if (result.host.uname !== 'arm64' || translated.stdout === '1') throw new Error('macOS arm64 validation cannot use emulation');
      await verifyPackage({ artifact: path.join(assets, candidate.descriptor.payload.filename), environment: env });
      await command(process.execPath, ['--test', 'test/distribution-channels.test.mjs'], {
        ...env, SDLC_DISTRIBUTION_TARGET: target,
        SDLC_DISTRIBUTION_TARGETS: RELEASE_TARGETS.join(','),
        SDLC_RELEASE_DIR: assets,
        SDLC_WINDOWS_LAUNCHER: path.resolve(candidateDir, 'launcher/sdlc.exe'),
      });
      result.standaloneNativeValidation = 'Passed';
      result.networkDeniedLifecycle = 'Passed';
      result.homebrew = await verifyNativeHomebrew({ candidate, candidateDir, scratch });
      result.nativeValidation = 'Passed';
    } else {
      if (process.platform === 'win32') throw new Error('Windows gate is deliberately non-native cross-validation');
      const launcher = await buildLauncher({ outputDir: path.join(scratch, 'launcher'), environment: env });
      if (launcher.sha256 !== candidate.context.launcher.sha256) throw new Error('Independent Windows launcher rebuild mismatch');
      await verifyRelease({ outputDir: assets, windowsLauncher: launcher.artifact,
        targets: RELEASE_TARGETS, sourceCommit: candidate.context.identity.sourceCommit, environment: env });
      const input = await readJson(path.join(candidateDir, 'winget-input.json'));
      const archive = archiveRecord(candidate, target);
      if (JSON.stringify(input.archive) !== JSON.stringify(archive) || input.version !== candidate.descriptor.version ||
          input.releaseRepository !== candidate.context.releaseRepository) throw new Error('WinGet input is not candidate-bound');
      result.winget = await validateManifests({ ...input,
        archivePath: path.join(assets, archive.filename), manifestDir: path.join(candidateDir, 'winget') });
      const expectedMetadata = candidate.context.prerelease ? [] :
        renderManifests(input).map(({ content, ...record }) => record);
      if (canonical(candidate.descriptor.files.filter(file => file.kind === 'winget')) !== canonical(expectedMetadata)) {
        throw new Error('Frozen public WinGet metadata differs from the validated manifest set');
      }
      const schema = await command(process.env.SDLC_PYTHON || 'python3',
        ['scripts/validate-winget-schema.py', '--manifest-dir', path.join(candidateDir, 'winget'),
          '--schema-dir', path.join(ROOT, '.test-data/winget-schemas')], env);
      result.schema = JSON.parse(schema.stdout);
      const extracted = path.join(scratch, 'shared-windows-payload');
      await extractEntries(readZip(await fs.readFile(path.join(assets, archive.filename))), extracted);
      const goEnv = { ...env, SDLC_VERIFY_SHARED_ROOT: extracted };
      delete goEnv.GOOS;
      delete goEnv.GOARCH;
      delete goEnv.GOCACHEPROG;
      await command(process.env.SDLC_GO || 'go', ['test', '-run',
        '^(TestNativePayload|TestInventoryRejects|TestSharedCanonicalArchiveContract)', './...'],
      goEnv, path.join(ROOT, 'cmd/sdlc-launcher'));
      await command(process.env.SDLC_GO || 'go', ['vet', './...'], goEnv, path.join(ROOT, 'cmd/sdlc-launcher'));
      await command(process.execPath, ['--test', 'test/winget.test.mjs'], env);
      result.deterministicCrossBuild = 'Passed';
      result.payloadIntegrity = 'Passed';
      result.testerInputValidation = 'Passed';
      result.reason = 'No Windows executable, WinGet client, or Windows lifecycle was executed.';
    }
    result.status = 'Passed';
    return result;
  } catch (error) {
    result.status = error.code === 'RELEASE_INTEGRATION_BLOCKED' ? 'NotRun' : 'Failed';
    if (error.code === 'RELEASE_INTEGRATION_BLOCKED') result.diagnosticStatus = 'Blocked';
    if (error.homebrewResult) result.homebrew = error.homebrewResult;
    if (error.retainedWorkspace) result.retainedWorkspace = error.retainedWorkspace;
    result.reason = error.message;
    if (error.stdout) process.stdout.write(error.stdout);
    if (error.stderr) process.stderr.write(error.stderr);
    throw error;
  } finally {
    await writeJson(path.join(evidenceDir, `${target}.json`), result);
    if (!result.retainedWorkspace) await fs.rm(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await runGate({ ...options(process.argv.slice(2)), ...trustedEnvironment() }), null, 2));
}
