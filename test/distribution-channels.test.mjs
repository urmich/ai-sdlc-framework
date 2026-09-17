import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildPackage } from '../scripts/package.mjs';
import { buildPlatforms, renderChecksums, writeReleaseMetadata } from '../scripts/package-platforms.mjs';
import { verifyPlatformPackage, verifyRelease, verifyReleaseChecksums } from '../scripts/verify-platform-package.mjs';
import { canonical, inventory, readTarGzip, readZip, sha256, tarGzip, zip } from '../packaging/standalone/archive.mjs';
import { extractEntries, isPrerelease, platformEntries, TARGETS, verifyEntries, verifyTree } from '../packaging/standalone/protocol.mjs';
import { activateChannel, layoutPathsOverlap, runtimePreflight, validateChannelHome } from '../packaging/standalone/runtime.mjs';
import { isolatedNpmEnvironment } from './npm-environment.mjs';
import { createNetworkBoundary, deniedEnvironment, networkAdapter, verifyNetworkNegativeControls } from './distribution-network-boundary.mjs';

const execute = promisify(execFile);
const hostTarget = Object.keys(TARGETS).find(target =>
  TARGETS[target].platform === process.platform && TARGETS[target].arch === process.arch);
let root;
let environment;
let built;
let payload;
let nativeEntries;
let originalTmp;
let originalCopilotHome;
const windowsLauncher = process.env.SDLC_WINDOWS_LAUNCHER;
const targets = process.env.SDLC_DISTRIBUTION_TARGETS?.split(',') ??
  (windowsLauncher ? Object.keys(TARGETS) : Object.keys(TARGETS).filter(target => target !== 'windows-x64'));

test.before(async () => {
  root = path.resolve('.test-data', `distribution-${randomUUID()}`);
  await fs.mkdir(path.join(root, 'scratch'), { recursive: true });
  originalTmp = process.env.TMPDIR;
  process.env.TMPDIR = path.join(root, 'scratch');
  originalCopilotHome = process.env.COPILOT_HOME;
  process.env.COPILOT_HOME = path.join(root, 'default copilot home');
  environment = await isolatedNpmEnvironment(root);
  environment.TMPDIR = process.env.TMPDIR;
  payload = await buildPackage({ outputDir: path.join(root, 'npm'), environment });
  built = await buildPlatforms({ artifact: payload.artifact, outputDir: path.join(root, 'release'),
    windowsLauncher, environment, targets });
  if (process.env.SDLC_RELEASE_DIR) {
    const candidate = await verifyRelease({ outputDir: process.env.SDLC_RELEASE_DIR, targets, rebuild: false });
    assert.equal(candidate.descriptor.sourceCommit, built.descriptor.sourceCommit);
    assert.equal(candidate.descriptor.payload.sha256, payload.sha256);
    for (const archive of built.archives) {
      assert.equal(candidate.descriptor.files.find(file => file.filename === archive.filename)?.sha256, archive.sha256);
      archive.artifact = path.join(process.env.SDLC_RELEASE_DIR, archive.filename);
    }
  }
  if (hostTarget && targets.includes(hostTarget)) {
    const archive = built.archives.find(item => item.target === hostTarget);
    const bytes = await fs.readFile(archive.artifact);
    nativeEntries = hostTarget === 'windows-x64' ? readZip(bytes) : readTarGzip(bytes);
  }
});

test.after(async () => {
  if (originalTmp === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = originalTmp;
  if (originalCopilotHome === undefined) delete process.env.COPILOT_HOME;
  else process.env.COPILOT_HOME = originalCopilotHome;
  if (root) await fs.rm(root, { recursive: true, force: true });
});

async function fixture() {
  const directory = path.join(root, randomUUID());
  const source = path.join(directory, 'downloaded archive with spaces');
  const home = path.join(directory, 'copilot home with spaces');
  const channelRoot = path.join(directory, 'standalone channel with spaces');
  await fs.mkdir(home, { recursive: true });
  if (nativeEntries) await extractEntries(nativeEntries, source);
  await fs.writeFile(path.join(home, 'copilot-instructions.md'), 'Keep user instructions.\n');
  return { directory, source, home, channelRoot };
}

function commandFor(source, args) {
  return process.platform === 'win32' ?
    { executable: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-File',
      path.join(source, 'install.ps1'), ...args] } :
    { executable: '/bin/sh', args: [path.join(source, 'install.sh'), ...args] };
}

async function installer(f, args, env = environment, run = execute) {
  const command = commandFor(f.source, [...args, '--channel-root', f.channelRoot, '--home', f.home]);
  const result = await run(command.executable, command.args,
    { env: { ...env, SDLC_NODE: process.execPath }, maxBuffer: 4 * 1024 * 1024 });
  return JSON.parse(result.stdout);
}

async function verifyRetainedHookRuntime(f, removedRoots) {
  const hooks = JSON.parse(await fs.readFile(path.join(f.home, 'hooks/sdlc.json'), 'utf8'));
  const retainedNode = await fs.realpath(process.execPath);
  for (const handler of Object.values(hooks.hooks).flat()) {
    assert.equal(handler.exec, retainedNode);
    for (const removedRoot of removedRoots) {
      assert.ok(!retainedNode.startsWith(`${path.resolve(removedRoot)}${path.sep}`));
    }
  }
  const handler = hooks.hooks.sessionStart[0];
  const input = path.join(f.directory, 'post-removal-hook-input.json');
  await fs.writeFile(input, JSON.stringify({ sessionId: 'retained-runtime-migration', cwd: f.directory }));
  const hook = await execute(handler.exec, [...handler.args, '--input-file', input], { env: environment });
  assert.match(JSON.parse(hook.stdout).additionalContext, /AI SDLC lifecycle/u);
  const health = await execute(handler.exec, [path.join(f.home, 'sdlc/bin/sdlc.mjs'),
    'doctor', '--home', f.home], { env: environment });
  const result = JSON.parse(health.stdout);
  assert.equal(result.installed, true);
  assert.equal(result.findings.length, 0);
  return result;
}

test('T-51 explicit native CI target must match actual native Node runtime', async () => {
  assert.ok(hostTarget, `Unverified platform: ${process.platform}/${process.arch}`);
  if (process.env.SDLC_DISTRIBUTION_TARGET) {
    assert.equal(hostTarget, process.env.SDLC_DISTRIBUTION_TARGET);
    if (hostTarget === 'windows-x64') assert.ok(windowsLauncher, 'Windows native gate requires SDLC_WINDOWS_LAUNCHER');
  }
  assert.equal(await runtimePreflight(), await fs.realpath(process.execPath));
});

test('T-51 independent builds reproduce exact npm payload, archives, descriptor and checksum bytes', async () => {
  const secondPayload = await buildPackage({ outputDir: path.join(root, 'npm second'), environment });
  assert.equal(secondPayload.sha256, payload.sha256);
  const second = await buildPlatforms({ artifact: secondPayload.artifact, outputDir: path.join(root, 'release second'),
    windowsLauncher, environment, targets, sourceCommit: built.descriptor.sourceCommit });
  assert.deepEqual(second.descriptor, built.descriptor);
  assert.equal(second.descriptorSha256, built.descriptorSha256);
  assert.equal(second.checksumsSha256, built.checksumsSha256);
  const verified = await verifyRelease({ outputDir: built.outputDir, environment, windowsLauncher, targets });
  assert.equal(verified.verified, true);
  assert.equal(verified.rebuilt, true);
  for (const archive of built.archives) {
    const target = TARGETS[archive.target];
    const result = await verifyPlatformPackage({ artifact: archive.artifact,
      expectedPlatform: target.platform, expectedArch: target.arch });
    assert.equal(result.payloadSha256, payload.sha256);
    assert.equal(result.inventoryDigest, built.descriptor.payload.inventoryDigest);
    await assert.rejects(verifyPlatformPackage({ artifact: archive.artifact,
      expectedArch: target.arch === 'x64' ? 'arm64' : 'x64' }), /Wrong platform/u);
  }
});

test('T-51 ZIP and tar codecs reject duplicates, traversal, truncation, corruption and nonfiles', () => {
  const entries = [{ path: 'LICENSE', data: Buffer.from('fixture\n'), mode: 0o644 },
    { path: 'bin/launcher', data: Buffer.from('entry\n'), mode: 0o755 }];
  for (const [encode, decode] of [[tarGzip, readTarGzip], [zip, readZip]]) {
    const bytes = encode(entries);
    assert.deepEqual(inventory(decode(bytes)), inventory(entries));
    assert.deepEqual(bytes, encode([...entries].reverse()));
    assert.throws(() => encode([...entries, entries[0]]), /Duplicate/u);
    assert.throws(() => encode([{ ...entries[0], path: '../outside' }]), /Unsafe/u);
    assert.throws(() => encode([{ ...entries[0], path: 'C:/outside' }]), /Unsafe/u);
    assert.throws(() => encode([{ ...entries[0], path: 'directory/' }]), /Unsafe/u);
    assert.throws(() => encode([{ ...entries[0], mode: 0o777 }]), /mode/u);
    assert.throws(() => decode(bytes.subarray(0, bytes.length - 5)));
    const corrupt = Buffer.from(bytes);
    corrupt[30] ^= 255;
    assert.throws(() => decode(corrupt));
  }
});

test('T-51 wrappers reject extra, missing, duplicate, changed and wrong-platform payload entries', async () => {
  const payloadBytes = await fs.readFile(payload.artifact);
  const { entries } = platformEntries(payloadBytes, 'linux-x64');
  assert.equal(verifyEntries(entries).manifest.payload.sha256, payload.sha256);
  const changed = entries.map(entry => entry.path === 'package/src/install.mjs' ?
    { ...entry, data: Buffer.concat([entry.data, Buffer.from('\n')]) } : entry);
  assert.throws(() => verifyEntries(changed), /mismatch/u);
  assert.throws(() => verifyEntries(entries.slice(1)), /mismatch|missing/u);
  assert.throws(() => verifyEntries([...entries, entries[0]]), /Duplicate/u);
  assert.throws(() => verifyEntries([...entries,
    { path: 'unlisted', data: Buffer.alloc(0), mode: 0o644 }]), /mismatch/u);
  assert.throws(() => verifyEntries(entries.map(entry => entry.path === 'bin/sdlc' ?
    { ...entry, mode: 0o644 } : entry)), /mismatch/u);
  assert.throws(() => verifyEntries(entries, { expectedPlatform: 'darwin' }), /Wrong platform/u);
  assert.throws(() => platformEntries(payloadBytes, 'windows-x64'), /native launcher/u);
});

test('T-51 external verification rejects absent, malformed, swapped and unbound checksums', async () => {
  const directory = path.join(root, 'tampered release');
  await fs.cp(built.outputDir, directory, { recursive: true });
  const checksums = path.join(directory, 'SHA256SUMS');
  const original = await fs.readFile(checksums);
  for (const content of ['', original.toString().replace(/[a-f0-9]{64}/u, '0'.repeat(64))]) {
    await fs.writeFile(checksums, content);
    await assert.rejects(verifyReleaseChecksums({ outputDir: directory }), /checksum/u);
  }
  await fs.unlink(checksums);
  await assert.rejects(verifyReleaseChecksums({ outputDir: directory }), { code: 'ENOENT' });
  await fs.writeFile(checksums, original);
  const descriptorFile = path.join(directory, 'release-descriptor.json');
  const value = JSON.parse(await fs.readFile(descriptorFile, 'utf8'));
  value.files.push(value.files[0]);
  await fs.writeFile(descriptorFile, canonical(value));
  await fs.writeFile(checksums, renderChecksums(value));
  await assert.rejects(verifyReleaseChecksums({ outputDir: directory }), /duplicate/u);
  await fs.cp(built.outputDir, directory, { recursive: true });
  const archive = path.join(directory, built.archives[0].filename);
  await fs.appendFile(archive, Buffer.from([0]));
  await assert.rejects(verifyPlatformPackage({ artifact: archive }), /checksum mismatch/u);
});

test('T-52 anonymous single-asset verification binds the saved prepublication evidence before extraction', async () => {
  const directory = path.join(root, 'anonymous download');
  await fs.mkdir(directory);
  const archive = built.archives[0];
  for (const filename of [archive.filename, 'SHA256SUMS', 'release-descriptor.json']) {
    await fs.copyFile(path.join(built.outputDir, filename), path.join(directory, filename));
  }
  const options = { artifact: path.join(directory, archive.filename),
    expectedDescriptorSha256: built.descriptorSha256, expectedChecksumsSha256: built.checksumsSha256 };
  assert.equal((await verifyPlatformPackage(options)).verified, true);
  await assert.rejects(verifyPlatformPackage({ ...options, expectedDescriptorSha256: '0'.repeat(64) }), /prepublication/u);
  await assert.rejects(verifyPlatformPackage({ ...options, expectedChecksumsSha256: '0'.repeat(64) }), /prepublication/u);
  const descriptor = structuredClone(built.descriptor);
  descriptor.version = '99.0.0';
  await fs.writeFile(path.join(directory, 'release-descriptor.json'), canonical(descriptor));
  await fs.writeFile(path.join(directory, 'SHA256SUMS'), renderChecksums(descriptor));
  await assert.rejects(verifyPlatformPackage({ artifact: options.artifact }), /Wrong-version/u);
});

test('T-51 metadata finalization consumes generator artifact records without circular descriptor inputs', async () => {
  const directory = path.join(root, 'metadata release');
  await fs.cp(built.outputDir, directory, { recursive: true });
  const file = path.join(root, 'candidate-fixture.yaml');
  const contents = Buffer.from('fixture: generator-contract\n');
  await fs.writeFile(file, contents);
  const item = { artifact: file, filename: 'candidate-fixture.yaml',
    kind: 'metadata', sha256: sha256(contents), size: contents.length };
  const args = { outputDir: directory, artifact: payload.artifact,
    sourceCommit: built.descriptor.sourceCommit, targets };
  const finalized = await writeReleaseMetadata({ ...args, metadataFiles: [item] });
  assert.equal(finalized.descriptor.files.find(entry => entry.filename === item.filename).sha256, item.sha256);
  assert.equal((await verifyReleaseChecksums({ outputDir: directory })).descriptorSha256, finalized.descriptorSha256);
  await assert.rejects(writeReleaseMetadata({ ...args, metadataFiles: [{ ...item, sha256: '0'.repeat(64) }] }), /supplied digest/u);
  await assert.rejects(writeReleaseMetadata({ ...args, metadataFiles: [item, item] }), /Duplicate/u);
});

test('T-51 all release verification paths reject checksum-consistent prerelease package-manager metadata', async () => {
  assert.equal(isPrerelease('1.2.3+build-with-dash'), false);
  assert.equal(isPrerelease('1.2.3-rc.1+build-with-dash'), true);
  for (const invalid of ['01.2.3', '1.2', '1.2.3-', '1.2.3-01', 'v1.2.3', '1.2.3+']) {
    assert.throws(() => isPrerelease(invalid), /SemVer/u);
  }
  const version = '0.3.0-rc.1+audit-build';
  const directory = path.join(root, 'prerelease base');
  await fs.mkdir(directory);
  const entries = readTarGzip(await fs.readFile(payload.artifact)).map(entry =>
    entry.path === 'package/package.json' ?
      { ...entry, data: Buffer.from(JSON.stringify({ ...JSON.parse(entry.data), version })) } : entry);
  const payloadBytes = tarGzip(entries);
  const artifact = path.join(directory, `ai-sdlc-framework-${version}.tgz`);
  await fs.writeFile(artifact, payloadBytes);
  const filename = `ai-sdlc-framework-${version}-linux-x64.tar.gz`;
  await fs.writeFile(path.join(directory, filename), tarGzip(platformEntries(payloadBytes, 'linux-x64').entries));
  const options = { outputDir: directory, artifact, sourceCommit: built.descriptor.sourceCommit, targets: ['linux-x64'] };
  const initial = await writeReleaseMetadata(options);
  assert.equal((await verifyRelease({ outputDir: directory, targets: options.targets, rebuild: false })).verified, true);
  for (const kind of ['homebrew', 'winget']) {
    const candidate = path.join(root, `prerelease ${kind}`);
    await fs.cp(directory, candidate, { recursive: true });
    const metadataName = kind === 'homebrew' ? 'candidate.rb' : 'candidate.yaml';
    const bytes = Buffer.from('test-only metadata must not be in a release\n');
    const metadataFile = path.join(candidate, metadataName);
    await fs.writeFile(metadataFile, bytes);
    const descriptor = structuredClone(initial.descriptor);
    descriptor.files.push({ filename: metadataName, kind, sha256: sha256(bytes), size: bytes.length });
    descriptor.files.sort((left, right) => left.filename < right.filename ? -1 : 1);
    await fs.writeFile(path.join(candidate, 'release-descriptor.json'), canonical(descriptor));
    await fs.writeFile(path.join(candidate, 'SHA256SUMS'), renderChecksums(descriptor));
    await assert.rejects(verifyReleaseChecksums({ outputDir: candidate }), /Prereleases/u);
    await assert.rejects(verifyRelease({ outputDir: candidate, targets: options.targets, rebuild: false }), /Prereleases/u);
    await assert.rejects(verifyPlatformPackage({ artifact: path.join(candidate, filename) }), /Prereleases/u);
    await assert.rejects(writeReleaseMetadata({ ...options, metadataFiles: [{ file: metadataFile, kind }] }), /Prereleases/u);
  }
});

test('T-51 network adapters sanitize executable references and fail closed on unsupported native isolation', () => {
  const env = deniedEnvironment({ HOME: 'isolated-home', PATH: '/unrestricted',
    npm_execpath: '/absolute/npm-cli.js', NPM_EXECPATH: '/other/npm-cli.js',
    npm_node_execpath: '/other/node', NPM_CLI_JS: '/third/npm-cli.js',
    NODE_OPTIONS: '--require /preload.js', NODE_PATH: '/global/modules', HTTPS_PROXY: 'http://proxy' }, '/restricted');
  assert.deepEqual(Object.keys(env).sort(), ['HOME', 'PATH', 'SDLC_NODE']);
  assert.equal(env.PATH, '/restricted');
  const options = { npmRoots: ['/node/npm'], emptyDirectory: '/isolated/empty' };
  const mac = networkAdapter('darwin', options);
  assert.match(mac.args[1], /\(deny network\*\)/u);
  assert.match(mac.args[1], /\(deny file-read\*/u);
  const linux = networkAdapter('linux', options);
  for (const flag of ['--user', '--mount', '--net']) assert.ok(linux.args.includes(flag));
  assert.equal(networkAdapter('win32', options).status, 'NotRun');
  assert.equal(networkAdapter('unsupported', options).status, 'NotRun');
});

test('T-51 npm-denied standalone lifecycle preserves unrelated content and runtime until explicit purge',
  { skip: !hostTarget || process.platform === 'win32' && !windowsLauncher }, async t => {
    const f = await fixture();
    const boundary = await createNetworkBoundary({ directory: f.directory, environment });
    if (boundary.status === 'NotRun') {
      const reason = `T-51 network-denied lifecycle NotRun: ${boundary.reason}`;
      t.diagnostic(reason);
      if (process.env.SDLC_DISTRIBUTION_TARGET) assert.fail(`${reason}; mandatory native release gate cannot pass`);
      t.skip(reason);
      return;
    }
    const controls = await verifyNetworkNegativeControls(boundary, f.directory);
    t.diagnostic(JSON.stringify({ test: 'T-51', status: 'enforced', ...controls }));
    const runInstaller = args => installer(f, args, boundary.environment, boundary.execute);
    const first = await runInstaller(['install']);
    assert.equal(first.installed, true);
    assert.match(first.nextAction, /Restart Copilot CLI/u);
    const state = path.join(f.home, 'sdlc/runtime/retained.json');
    await fs.writeFile(state, '{"keep":true}\n');
    const unrelated = path.join(f.home, 'user-settings.json');
    await fs.writeFile(unrelated, '{"unrelated":true}\n');
    const health = await runInstaller(['doctor']);
    assert.equal(health.installed, true);
    assert.equal(health.findings.length, 0);
    const current = process.platform === 'win32' ?
      { executable: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-File',
        path.join(f.channelRoot, 'current.ps1'), 'doctor', '--home', f.home] } :
      { executable: path.join(f.channelRoot, 'current/bin/sdlc'), args: ['doctor', '--home', f.home] };
    assert.equal(JSON.parse((await boundary.execute(current.executable, current.args)).stdout).installed, true);
    if (process.platform !== 'win32') {
      const linked = path.join(f.directory, 'user bin/sdlc');
      await fs.mkdir(path.dirname(linked));
      await fs.symlink(path.relative(path.dirname(linked), current.executable), linked);
      assert.equal(JSON.parse((await boundary.execute(linked, ['doctor', '--home', f.home])).stdout).installed, true);
    }
    const update = await runInstaller(['update']);
    assert.equal(update.changedFiles.length, 0);
    assert.equal(await fs.readFile(state, 'utf8'), '{"keep":true}\n');
    const hooks = JSON.parse(await fs.readFile(path.join(f.home, 'hooks/sdlc.json'), 'utf8'));
    assert.equal(hooks.hooks.preToolUse[0].exec, await fs.realpath(process.execPath));
    assert.equal(hooks.hooks.preToolUse[0].args[0], path.join(f.home, 'sdlc/bin/sdlc.mjs'));
    assert.equal((await runInstaller(['uninstall'])).uninstalled, true);
    assert.equal(await fs.readFile(state, 'utf8'), '{"keep":true}\n');
    assert.equal((await runInstaller(['install', '--purge-existing'])).purgedExisting, true);
    await assert.rejects(fs.stat(state), { code: 'ENOENT' });
    await fs.writeFile(state, '{"purge":true}\n');
    assert.equal((await runInstaller(['uninstall', '--purge'])).purged, true);
    await assert.rejects(fs.stat(path.join(f.home, 'sdlc')), { code: 'ENOENT' });
    assert.equal(await fs.readFile(unrelated, 'utf8'), '{"unrelated":true}\n');
    assert.equal((await fs.readFile(path.join(f.home, 'copilot-instructions.md'), 'utf8')).trimEnd(), 'Keep user instructions.');
  });

test('T-51 channel-only installs and channel removal never mutate the Copilot home',
  { skip: !hostTarget || process.platform === 'win32' && !windowsLauncher }, async () => {
    const f = await fixture();
    const activation = await installer(f, ['install', '--channel-only']);
    assert.equal(activation.activated, true);
    assert.equal(path.isAbsolute(activation.launcher), true);
    assert.deepEqual(await fs.readdir(f.home), ['copilot-instructions.md']);
    await installer(f, ['install']);
    await verifyRetainedHookRuntime(f, [f.channelRoot, f.source]);
    await fs.rm(f.channelRoot, { recursive: true });
    await fs.rm(f.source, { recursive: true });
    await verifyRetainedHookRuntime(f, [f.channelRoot, f.source]);
  });

test('T-51 corrupt and wrong-architecture runtime/payload fail before channel or Copilot mutation',
  { skip: !hostTarget || process.platform === 'win32' && !windowsLauncher }, async () => {
    const f = await fixture();
    await assert.rejects(runtimePreflight({ arch: process.arch === 'x64' ? 'arm64' : 'x64' }), /architecture/u);
    await assert.rejects(runtimePreflight({ node: 'node' }), /Selected/u);
    await fs.appendFile(path.join(f.source, 'package/src/install.mjs'), '\nchanged');
    await assert.rejects(activateChannel({ sourceRoot: f.source, channelRoot: f.channelRoot }), /mismatch/u);
    await assert.rejects(fs.stat(f.channelRoot), { code: 'ENOENT' });
    await assert.rejects(installer(f, ['install', '--purge-existing']));
    assert.deepEqual(await fs.readdir(f.home), ['copilot-instructions.md']);
  });

test('T-51 channel/home overlap is rejected before writes under explicit, environment and default home rules',
  { skip: !hostTarget || process.platform === 'win32' && !windowsLauncher }, async () => {
    const f = await fixture();
    const retained = path.join(f.home, 'sdlc/runtime/retained.json');
    await fs.mkdir(path.dirname(retained), { recursive: true });
    await fs.writeFile(retained, '{"retained":true}\n');
    for (const [channelRoot, home] of [
      [f.home, f.home], [path.join(f.home, 'new/channel'), f.home],
      [f.directory, f.home], [f.channelRoot, path.join(f.channelRoot, 'new/copilot')],
    ]) {
      await assert.rejects(activateChannel({ sourceRoot: f.source, channelRoot, home }), /non-overlapping/u);
    }
    for (const operation of [['install', '--purge-existing'], ['uninstall', '--purge'], ['doctor']]) {
      const command = commandFor(f.source, [...operation, '--channel-root', f.home]);
      await assert.rejects(execute(command.executable, command.args, {
        env: { ...environment, COPILOT_HOME: f.home, SDLC_NODE: process.execPath },
      }), /non-overlapping/u);
    }
    const defaultHome = path.join(f.directory, '.copilot');
    const command = commandFor(f.source, ['install', '--channel-root', path.join(defaultHome, 'nested')]);
    const defaultEnv = { ...environment, HOME: f.directory, USERPROFILE: f.directory, SDLC_NODE: process.execPath };
    delete defaultEnv.COPILOT_HOME;
    await assert.rejects(execute(command.executable, command.args, { env: defaultEnv }), /non-overlapping/u);
    await assert.rejects(fs.stat(defaultHome), { code: 'ENOENT' });
    await assert.rejects(fs.stat(f.channelRoot), { code: 'ENOENT' });
    assert.equal(await fs.readFile(retained, 'utf8'), '{"retained":true}\n');
    await validateChannelHome({ channelRoot: `${f.home}-sibling`, home: f.home });
    const selected = await installer(f, ['install', '--channel-only'], { ...environment, COPILOT_HOME: f.channelRoot });
    assert.equal(selected.activated, true, 'Explicit --home must override COPILOT_HOME');
    assert.equal(await fs.readFile(retained, 'utf8'), '{"retained":true}\n');
    if (process.platform !== 'win32') {
      await assert.rejects(execute(selected.launcher, ['uninstall', '--purge', '--home', path.join(f.channelRoot, 'copilot')],
        { env: { ...environment, SDLC_NODE: process.execPath } }), /non-overlapping/u);
      await assert.rejects(fs.stat(path.join(f.channelRoot, 'copilot')), { code: 'ENOENT' });
    }
  });

test('T-51 layout checks resolve existing and dangling symlink ancestors before any channel mutation',
  { skip: !hostTarget || process.platform === 'win32' && !windowsLauncher }, async () => {
    const f = await fixture();
    const alias = path.join(f.directory, 'home alias');
    await fs.symlink(f.home, alias, process.platform === 'win32' ? 'junction' : 'dir');
    for (const [channelRoot, home] of [
      [path.join(alias, 'new/channel'), f.home],
      [f.home, path.join(alias, 'new/copilot')],
      [alias, f.home],
    ]) {
      await assert.rejects(activateChannel({ sourceRoot: f.source, channelRoot, home }), /non-overlapping/u);
    }
    if (process.platform !== 'win32') {
      const dangling = path.join(f.directory, 'dangling home alias');
      await fs.symlink(f.channelRoot, dangling);
      await assert.rejects(activateChannel({ sourceRoot: f.source, channelRoot: f.channelRoot, home: dangling }), /non-overlapping/u);
      await assert.rejects(activateChannel({ sourceRoot: f.source,
        channelRoot: path.join(f.channelRoot, 'nested'), home: dangling }), /non-overlapping/u);
    }
    await assert.rejects(fs.stat(f.channelRoot), { code: 'ENOENT' });
    assert.deepEqual(await fs.readdir(f.home), ['copilot-instructions.md']);
  });

test('T-51 unresolved layout suffixes use Windows/macOS case equivalence without collapsing Linux names', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    const api = platform === 'win32' ? path.win32 : path.posix;
    const base = platform === 'win32' ? 'C:\\Fixture' : '/fixture';
    const channel = api.join(base, 'New-Channel');
    const home = api.join(base, 'new-channel');
    const insensitive = platform !== 'linux';
    assert.equal(layoutPathsOverlap(channel, home, platform), insensitive);
    assert.equal(layoutPathsOverlap(channel, api.join(home, 'Copilot'), platform), insensitive);
    assert.equal(layoutPathsOverlap(api.join(channel, 'Nested'), home, platform), insensitive);
    assert.equal(layoutPathsOverlap(channel, `${home}-sibling`, platform), false);
    assert.equal(layoutPathsOverlap(channel, api.join(channel, 'Copilot'), platform), true);
    assert.equal(layoutPathsOverlap(api.join(channel, 'Nested'), channel, platform), true);
  }
  assert.equal(layoutPathsOverlap('C:\\Fixture\\New', 'c:\\fixture\\new\\Home', 'win32'), true);
});

test('T-51 nonexistent case-variant home/channel roots reject channel-only and destructive operations without writes',
  { skip: !hostTarget || process.platform === 'win32' && !windowsLauncher }, async () => {
    const f = await fixture();
    const upper = path.join(f.directory, 'Future-Root');
    const lower = path.join(f.directory, 'future-root');
    const before = await fs.readdir(f.directory);
    if (process.platform === 'linux') {
      await validateChannelHome({ channelRoot: upper, home: lower });
      assert.deepEqual(await fs.readdir(f.directory), before);
      return;
    }
    for (const [channelRoot, home] of [
      [upper, lower], [upper, path.join(lower, 'Copilot')],
      [path.join(upper, 'Nested'), lower],
    ]) {
      await assert.rejects(activateChannel({ sourceRoot: f.source, channelRoot, home }), /non-overlapping/u);
      for (const operation of [['install', '--channel-only'], ['install', '--purge-existing'], ['uninstall', '--purge']]) {
        const command = commandFor(f.source, [...operation, '--channel-root', channelRoot, '--home', home]);
        await assert.rejects(execute(command.executable, command.args, {
          env: { ...environment, SDLC_NODE: process.execPath },
        }), /non-overlapping/u);
        assert.deepEqual(await fs.readdir(f.directory), before);
      }
    }
    const fromEnvironment = commandFor(f.source, ['install', '--channel-only', '--channel-root', upper]);
    await assert.rejects(execute(fromEnvironment.executable, fromEnvironment.args, {
      env: { ...environment, COPILOT_HOME: lower, SDLC_NODE: process.execPath },
    }), /non-overlapping/u);
    const fromDefault = commandFor(f.source, ['uninstall', '--purge',
      '--channel-root', path.join(f.directory, '.COPILOT', 'New-Channel')]);
    const defaultEnv = { ...environment, HOME: f.directory, USERPROFILE: f.directory, SDLC_NODE: process.execPath };
    delete defaultEnv.COPILOT_HOME;
    await assert.rejects(execute(fromDefault.executable, fromDefault.args, { env: defaultEnv }), /non-overlapping/u);
    assert.deepEqual(await fs.readdir(f.directory), before);
    assert.equal(await fs.readFile(path.join(f.home, 'copilot-instructions.md'), 'utf8'), 'Keep user instructions.\n');
  });

test('T-51 shell rejects Node 21, missing, non-executable and shadowed Node before mutation',
  { skip: process.platform === 'win32' }, async () => {
    const f = await fixture();
    const denied = path.join(f.directory, 'runtime bin');
    await fs.mkdir(denied);
    await fs.symlink('/usr/bin/dirname', path.join(denied, 'dirname'));
    const node = path.join(denied, 'node');
    const command = commandFor(f.source, ['install', '--channel-root', f.channelRoot, '--home', f.home]);
    const env = { ...environment, PATH: denied };
    delete env.SDLC_NODE;
    const oldNode = `#!/bin/sh\nexec '${process.execPath}' -e 'Object.defineProperty(process.versions, "node", {value:"21.0.0"});eval(process.argv[1])' "$2"\n`;
    for (const content of [undefined, oldNode]) {
      if (content) await fs.writeFile(node, content, { mode: 0o755 });
      await assert.rejects(execute(command.executable, command.args, { env }));
      await assert.rejects(fs.stat(f.channelRoot), { code: 'ENOENT' });
    }
    await fs.chmod(node, 0o644);
    await assert.rejects(execute(command.executable, command.args, { env: { ...env, SDLC_NODE: node } }));
    assert.deepEqual(await fs.readdir(f.home), ['copilot-instructions.md']);
  });

test('T-51 valid same-version conflicts and interrupted version switching preserve the previous launcher',
  { skip: !hostTarget || process.platform === 'win32' && !windowsLauncher }, async () => {
    const f = await fixture();
    await installer(f, ['install']);
    const first = await activateChannel({ sourceRoot: f.source, channelRoot: f.channelRoot });
    const oldVersion = path.dirname(path.dirname(first.launcher));
    const npmEntries = readTarGzip(await fs.readFile(payload.artifact));
    const alternate = npmEntries.map(entry => entry.path === 'package/README.md' ?
      { ...entry, data: Buffer.concat([entry.data, Buffer.from('\nChanged fixture payload.\n')]) } : entry);
    const launcher = windowsLauncher ? await fs.readFile(windowsLauncher) : undefined;
    const conflictSource = path.join(f.directory, 'conflicting same version');
    await extractEntries(platformEntries(tarGzip(alternate), hostTarget, launcher).entries, conflictSource);
    await assert.rejects(activateChannel({ sourceRoot: conflictSource, channelRoot: f.channelRoot }), /conflicting digest/u);
    const updated = alternate.map(entry => {
      if (entry.path !== 'package/package.json') return entry;
      const pkg = JSON.parse(entry.data);
      pkg.version = '99.0.0';
      return { ...entry, data: Buffer.from(`${JSON.stringify(pkg, null, 2)}\n`) };
    });
    const newSource = path.join(f.directory, 'new version');
    await extractEntries(platformEntries(tarGzip(updated), hostTarget, launcher).entries, newSource);
    await assert.rejects(activateChannel({ sourceRoot: newSource, channelRoot: f.channelRoot,
      beforeStep: async step => { if (step === 'promote-current') throw new Error('interrupted switch'); } }), /interrupted/u);
    const pointer = process.platform === 'win32' ? await fs.readFile(first.current, 'utf8') : await fs.readlink(first.current);
    assert.ok(pointer.includes(built.descriptor.version));
    assert.equal((await installer(f, ['doctor'])).frameworkVersion, built.descriptor.version);
    await installer({ ...f, source: newSource }, ['update']);
    assert.equal((await installer({ ...f, source: newSource }, ['doctor'])).frameworkVersion, '99.0.0');
    await verifyRetainedHookRuntime(f, [oldVersion, f.source]);
    await fs.rm(oldVersion, { recursive: true });
    await fs.rm(f.source, { recursive: true });
    const hooks = JSON.parse(await fs.readFile(path.join(f.home, 'hooks/sdlc.json'), 'utf8'));
    assert.ok(!JSON.stringify(hooks).includes(oldVersion));
    assert.equal((await verifyRetainedHookRuntime(f, [oldVersion, f.source])).frameworkVersion, '99.0.0');
  });

test('T-51 install-versus-purge serializes framework maintenance without damaging the channel',
  { skip: !hostTarget || process.platform === 'win32' && !windowsLauncher }, async () => {
    const f = await fixture();
    await installer(f, ['install']);
    const results = await Promise.allSettled([
      installer(f, ['install']),
      installer(f, ['uninstall', '--purge']),
    ]);
    for (const result of results) {
      if (result.status === 'rejected') assert.match(result.reason.stdout + result.reason.stderr, /lock|INSTALL|purge/iu);
    }
    const health = await installer(f, ['doctor']);
    assert.equal(health.findings.length, 0);
    assert.match(await fs.readFile(path.join(f.home, 'copilot-instructions.md'), 'utf8'), /Keep user instructions/u);
    assert.ok(!((await fs.readdir(f.channelRoot)).includes('.channel-lock')));
  });

test('T-51 activation failures preserve prior current and release locks with bounded staging cleanup',
  { skip: !hostTarget || process.platform === 'win32' && !windowsLauncher }, async () => {
    for (const step of ['copy', 'verify-staging', 'activate-version', 'promote-current']) {
      const f = await fixture();
      await assert.rejects(activateChannel({ sourceRoot: f.source, channelRoot: f.channelRoot,
        beforeStep: async current => { if (current === step) throw new Error(`interrupted ${step}`); } }), /interrupted/u);
      const names = await fs.readdir(f.channelRoot);
      assert.ok(!names.some(name => name.startsWith('.staging-') || name.startsWith('.current-') || name === '.channel-lock'));
      const first = await activateChannel({ sourceRoot: f.source, channelRoot: f.channelRoot });
      const pointer = process.platform === 'win32' ? await fs.readFile(first.current, 'utf8') : await fs.readlink(first.current);
      await assert.rejects(activateChannel({ sourceRoot: f.source, channelRoot: f.channelRoot,
        beforeStep: async current => { if (current === 'promote-current') throw new Error('sharing violation'); } }), /sharing/u);
      assert.equal(process.platform === 'win32' ? await fs.readFile(first.current, 'utf8') : await fs.readlink(first.current), pointer);
      assert.equal((await verifyTree(path.dirname(path.dirname(first.launcher)))).manifest.payload.sha256, payload.sha256);
    }
  });

test('T-51 simultaneous installs serialize; a busy channel times out without deleting its lock',
  { skip: !hostTarget || process.platform === 'win32' && !windowsLauncher }, async () => {
    const f = await fixture();
    const [first, second] = await Promise.all([
      activateChannel({ sourceRoot: f.source, channelRoot: f.channelRoot }),
      activateChannel({ sourceRoot: f.source, channelRoot: f.channelRoot }),
    ]);
    assert.equal(first.launcher, second.launcher);
    const lock = path.join(f.channelRoot, '.channel-lock');
    await fs.mkdir(lock);
    await fs.writeFile(path.join(lock, 'retain'), 'not ours');
    await assert.rejects(activateChannel({ sourceRoot: f.source, channelRoot: f.channelRoot, lockTimeoutMs: 20 }), /timeout/u);
    assert.equal(await fs.readFile(path.join(lock, 'retain'), 'utf8'), 'not ours');
    await fs.rm(lock, { recursive: true });
    const sourceFile = path.join(path.dirname(path.dirname(first.launcher)), 'package/src/install.mjs');
    await fs.appendFile(sourceFile, '\nconflict');
    await assert.rejects(activateChannel({ sourceRoot: f.source, channelRoot: f.channelRoot }), /mismatch/u);
  });

test('T-51 channel ownership, unexpected output and abandoned stages never delete unrelated data',
  { skip: !hostTarget || process.platform === 'win32' && !windowsLauncher }, async () => {
    const f = await fixture();
    await fs.mkdir(f.channelRoot);
    const unrelated = path.join(f.channelRoot, 'user-file');
    await fs.writeFile(unrelated, 'keep');
    await assert.rejects(activateChannel({ sourceRoot: f.source, channelRoot: f.channelRoot }), /unowned/u);
    assert.equal(await fs.readFile(unrelated, 'utf8'), 'keep');
    await assert.rejects(buildPlatforms({ artifact: payload.artifact, outputDir: f.channelRoot, targets }), /unowned/u);
    assert.equal(await fs.readFile(unrelated, 'utf8'), 'keep');
    await fs.unlink(unrelated);
    const active = await activateChannel({ sourceRoot: f.source, channelRoot: f.channelRoot });
    const abandoned = path.join(f.channelRoot, `.staging-${randomUUID()}`);
    await fs.mkdir(abandoned);
    await fs.writeFile(path.join(abandoned, 'partial-copy'), 'abandoned');
    await fs.writeFile(path.join(f.channelRoot, '.staging-not-owned'), 'keep');
    await activateChannel({ sourceRoot: f.source, channelRoot: f.channelRoot });
    await assert.rejects(fs.stat(abandoned), { code: 'ENOENT' });
    assert.equal(await fs.readFile(path.join(f.channelRoot, '.staging-not-owned'), 'utf8'), 'keep');
    if (process.platform !== 'win32') {
      await fs.unlink(active.current);
      await fs.symlink(f.home, active.current);
      await assert.rejects(activateChannel({ sourceRoot: f.source, channelRoot: f.channelRoot }), /not channel-owned/u);
      assert.equal(await fs.readlink(active.current), f.home);
      const redirected = path.join(f.directory, 'redirected-channel');
      await fs.symlink(f.channelRoot, redirected);
      await assert.rejects(activateChannel({ sourceRoot: f.source, channelRoot: redirected }), /literal directory/u);
    }
    assert.deepEqual(await fs.readdir(f.home), ['copilot-instructions.md']);
  });
