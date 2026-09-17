import * as fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { readZip } from '../packaging/standalone/archive.mjs';
import { extractEntries } from '../packaging/standalone/protocol.mjs';
import { runtimePreflight } from '../packaging/standalone/runtime.mjs';
import { buildLauncher } from '../packaging/winget/build-launcher.mjs';
import { validateManifests } from '../packaging/winget/validate.mjs';
import { verifyRelease } from './verify-platform-package.mjs';
import { verifyPackage } from './verify-package.mjs';
import { ROOT, RELEASE_TARGETS, RELEASE_GATE_TARGETS, RELEASE_SCOPE, archiveRecord, options,
  readJson, trustedEnvironment, verifyCandidate, writeJson } from './release-bundle.mjs';

const execute = promisify(execFile);

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
    host: { platform: process.platform, arch: process.arch },
    ...(process.env.GITHUB_RUN_ID ? { run: { id: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT } } : {}) };
  const scratch = path.join(ROOT, '.test-data', `release-gate-${randomUUID()}`);
  await fs.mkdir(scratch, { recursive: true });
  const env = { ...process.env, TMPDIR: scratch, TEMP: scratch, TMP: scratch,
    GOTMPDIR: scratch, GOCACHE: path.join(scratch, 'go-cache'),
    GOENV: 'off', GOTOOLCHAIN: 'local', GOWORK: 'off', GOPROXY: 'off', GOSUMDB: 'off',
    NODE_OPTIONS: '', NODE_PATH: '' };
  try {
    if (target === 'macos-x64') {
      result.reason = 'Intel is unsupported and NotRun: no release archive or stable Homebrew metadata is published.';
      return result;
    }
    const assets = path.resolve(candidateDir, 'assets');
    if (target === 'macos-arm64') {
      if (process.platform !== 'darwin' || process.arch !== 'arm64') {
        throw new Error('Mandatory lifecycle requires native Apple Silicon Node, not Intel or emulation');
      }
      await runtimePreflight();
      await verifyPackage({ artifact: path.join(assets, candidate.descriptor.payload.filename), environment: env });
      await command(process.execPath, ['--test', 'test/distribution-channels.test.mjs'], {
        ...env, SDLC_DISTRIBUTION_TARGET: target,
        SDLC_DISTRIBUTION_TARGETS: RELEASE_TARGETS.join(','),
        SDLC_RELEASE_DIR: assets,
        SDLC_WINDOWS_LAUNCHER: path.resolve(candidateDir, 'launcher/sdlc.exe'),
      });
      result.nativeValidation = 'Passed';
      result.networkDeniedLifecycle = 'Passed';
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
      result.testerPrompt = candidate.testerPrompt;
      result.reason = 'No Windows executable, WinGet client, or Windows lifecycle was executed.';
    }
    result.status = 'Passed';
    return result;
  } catch (error) {
    result.status = 'Failed';
    result.reason = error.message;
    if (error.stdout) process.stdout.write(error.stdout);
    if (error.stderr) process.stderr.write(error.stderr);
    throw error;
  } finally {
    await writeJson(path.join(evidenceDir, `${target}.json`), result);
    await fs.rm(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await runGate({ ...options(process.argv.slice(2)), ...trustedEnvironment() }), null, 2));
}
