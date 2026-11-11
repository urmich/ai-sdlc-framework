export const validationDeclarations = {
  "schemaVersion": 1,
  "surfaces": [],
  "groups": [{
    "root": "T-PRD035 completion CLI loads its native verifier before rejecting a controlled provider read",
    "dependsOn": [], "minimumSlots": 1, "exclusiveResources": []
  }],
  "applicability": [{
    "names": ["T-PRD035 completion CLI loads its native verifier before rejecting a controlled provider read"],
    "platforms": ["linux-x64", "windows-x64", "macos-arm64", "macos-x64"],
    "owner": "maintainer",
    "reason": "PR-only FR-207/AC-207.3 module-loading regression runs the real completion CLI, bundle checks and default native-verifier import in a fresh child. One independent one-slot root owns and removes its unique repository-local fixture/home; it has no shared resources or prerequisite roots and leaves critical27 unchanged. Controlled artifact-verifier/provider boundaries supply no native, cryptographic or release acceptance proof.",
    "prerequisites": ["Node >=22 on the four native PR lanes", "Owned filesystem fixture; no npm, credentials, network or native launcher"]
  }],
  "plannedCases": [{"id": "T-PRD035", "selectors": [{
    "name": "T-PRD035 completion CLI loads its native verifier before rejecting a controlled provider read",
    "parents": []
  }]}]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonical, sha256, zip } from '../packaging/standalone/archive.mjs';
import { RELEASE_SCOPE, RELEASE_GATE_TARGETS, RELEASE_PRE_CASES, evidenceIdentity,
  windowsTesterInput } from '../scripts/release-bundle.mjs';
import { INPUT_FILENAME } from '../packaging/windows-tester/generate.mjs';

const execute = promisify(execFile);

test('T-PRD035 completion CLI loads its native verifier before rejecting a controlled provider read', async t => {
  const parent = new URL('../.test-data/', import.meta.url);
  await fs.mkdir(parent, { recursive: true });
  const directory = await fs.mkdtemp(new URL('completion-loading-', parent));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
    await assert.rejects(fs.lstat(directory), { code: 'ENOENT' });
  });
  const bundleDir = path.join(directory, 'bundle');
  const outputDir = path.join(directory, 'completion');
  const assets = path.join(bundleDir, 'assets');
  const evidence = path.join(bundleDir, 'evidence');
  const home = path.join(directory, 'home');
  await Promise.all([assets, evidence, home].map(folder => fs.mkdir(folder, { recursive: true })));
  const version = '0.0.0-loading-fixture';
  const launcherSha256 = 'f'.repeat(64);
  const archive = zip([{ path: 'platform.json', mode: 0o644,
    data: Buffer.from(JSON.stringify({ launcherSha256 })) }]);
  const release = {
    descriptor: { version, sourceCommit: 'a'.repeat(40),
      payload: { sha256: 'b'.repeat(64), inventoryDigest: 'c'.repeat(64) },
      files: [{ filename: `ai-sdlc-framework-${version}-windows-x64.zip`, kind: 'archive',
        sha256: sha256(archive), size: archive.length }] },
    descriptorSha256: 'd'.repeat(64), checksumsSha256: 'e'.repeat(64)
  };
  const identity = evidenceIdentity(release);
  const releaseRepository = 'fixture/completion-loading';
  const releaseIntentId = 'unit-module-loading-not-release-evidence';
  const files = [];
  const write = async (filename, bytes) => {
    await fs.writeFile(path.join(bundleDir, filename), bytes, { flag: 'wx' });
    files.push({ filename, sha256: sha256(bytes), size: bytes.length });
  };
  await write(`assets/${release.descriptor.files[0].filename}`, archive);
  await write('context.json', Buffer.from(canonical({
    identity, releaseRepository, releaseIntentId, scope: RELEASE_SCOPE,
    prerelease: true, launcher: { sha256: launcherSha256 }
  })));
  await write(INPUT_FILENAME, Buffer.from(canonical(windowsTesterInput(release, releaseRepository, launcherSha256))));
  for (const target of RELEASE_GATE_TARGETS) {
    const [platform, architecture] = target.split('-');
    await write(`evidence/${target}.json`, Buffer.from(canonical({
      identity, releaseIntentId, target, ...RELEASE_SCOPE[target],
      status: 'Passed', nativeValidation: 'Passed', profile: 'r-pre', caseId: RELEASE_PRE_CASES[target],
      host: { kind: 'native', platform: { linux: 'linux', windows: 'win32', macos: 'darwin' }[platform],
        architecture },
      reportDirectory: `native/${target}`, run: { id: '1', attempt: '1' },
      finishedAt: new Date().toISOString(),
      reason: 'Controlled loading fixture only; no native execution or acceptance credit'
    })));
  }
  const bundleBytes = Buffer.from(canonical({ schemaVersion: 1, identity, releaseRepository,
    releaseIntentId, scope: RELEASE_SCOPE, publicationReady: false,
    files: files.sort((a, b) => a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0) }));
  await fs.writeFile(path.join(bundleDir, 'bundle.json'), bundleBytes, { flag: 'wx' });

  // Double only artifact verification and provider I/O; keep the actual CLI/import cycle intact.
  const verifierUrl = new URL('../scripts/verify-platform-package.mjs', import.meta.url).href;
  const providerUrl = new URL('../scripts/publish-release.mjs', import.meta.url).href;
  const boundary = 'CONTROLLED_COMPLETION_PROVIDER_READ_NO_ACCEPTANCE_CREDIT';
  const doubles = {
    [verifierUrl]: `export * from ${JSON.stringify(`${verifierUrl}?loading-fixture-original`)};
      export async function verifyRelease({ outputDir, rebuild }) {
        if (outputDir !== ${JSON.stringify(assets)} || rebuild !== false) throw new Error('Unexpected artifact boundary');
        return ${JSON.stringify(release)};
      }`,
    [providerUrl]: `export * from ${JSON.stringify(`${providerUrl}?loading-fixture-original`)};
      export async function githubRequest(route, { method = 'GET' } = {}) {
        if (method !== 'GET' || !/^\\/repos\\/fixture\\/completion-loading\\/actions\\/runs\\//u.test(route)) {
          throw new Error('Unexpected provider operation');
        }
        throw new Error(${JSON.stringify(boundary)});
      }`
  };
  const loader = path.join(directory, 'boundaries.mjs');
  await fs.writeFile(loader, `const doubles = ${JSON.stringify(doubles)};
    export function load(url, context, nextLoad) {
      return Object.hasOwn(doubles, url) ?
        { format: 'module', source: doubles[url], shortCircuit: true } : nextLoad(url, context);
    }`, { flag: 'wx' });
  const preload = path.join(directory, 'preload.mjs');
  await fs.writeFile(preload, `
    import { register, syncBuiltinESMExports } from 'node:module';
    import childProcess from 'node:child_process';
    import net from 'node:net';
    import tls from 'node:tls';
    import http from 'node:http';
    import https from 'node:https';
    import dgram from 'node:dgram';
    const deny = () => { throw new Error('External activity is forbidden in the loading fixture'); };
    globalThis.fetch = deny;
    for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
      childProcess[name] = deny;
    }
    net.Socket.prototype.connect = deny;
    tls.connect = deny;
    http.request = http.get = https.request = https.get = dgram.createSocket = deny;
    syncBuiltinESMExports();
    register(${JSON.stringify(pathToFileURL(loader).href)});
  `, { flag: 'wx' });
  const env = {
    HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, TEMP: home, TMP: home,
    EXPECTED_BUNDLE_SHA256: sha256(bundleBytes), GITHUB_REPOSITORY: releaseRepository
  };
  for (const key of ['SystemRoot', 'WINDIR']) if (process.env[key]) env[key] = process.env[key];
  const result = await execute(process.execPath, [
    '--import', pathToFileURL(preload).href,
    fileURLToPath(new URL('../scripts/accept-release.mjs', import.meta.url)), 'complete',
    '--directory', bundleDir, '--output-dir', outputDir
  ], { cwd: directory, env, timeout: 30_000, maxBuffer: 1024 * 1024 }).then(
    value => ({ code: 0, ...value }),
    error => {
      if (!Number.isInteger(error.code)) throw error;
      return { code: error.code, stdout: error.stdout, stderr: error.stderr };
    });
  assert.equal(result.code, 1, result.stderr);
  assert.match(result.stderr, new RegExp(boundary, 'u'));
});
