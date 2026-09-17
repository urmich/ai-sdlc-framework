import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildPackage } from '../scripts/package.mjs';
import { buildPlatforms, renderChecksums } from '../scripts/package-platforms.mjs';
import { verifyPlatformPackage, verifyRelease, verifyReleaseChecksums } from '../scripts/verify-platform-package.mjs';
import { canonical, inventory, readTarGzip, readZip, sha256, tarGzip, zip } from '../packaging/standalone/archive.mjs';
import { extractEntries, platformEntries, TARGETS, verifyEntries, verifyTree } from '../packaging/standalone/protocol.mjs';
import { activateChannel, runtimePreflight } from '../packaging/standalone/runtime.mjs';
import { isolatedNpmEnvironment } from './npm-environment.mjs';

const execute = promisify(execFile);
const hostTarget = Object.keys(TARGETS).find(target =>
  TARGETS[target].platform === process.platform && TARGETS[target].arch === process.arch);
let root;
let environment;
let built;
let payload;
let nativeEntries;
let originalTmp;
const windowsLauncher = process.env.SDLC_WINDOWS_LAUNCHER;
const targets = windowsLauncher ? Object.keys(TARGETS) : Object.keys(TARGETS).filter(target => target !== 'windows-x64');

test.before(async () => {
  root = path.resolve('.test-data', `distribution-${randomUUID()}`);
  await fs.mkdir(path.join(root, 'scratch'), { recursive: true });
  originalTmp = process.env.TMPDIR;
  process.env.TMPDIR = path.join(root, 'scratch');
  environment = await isolatedNpmEnvironment(root);
  environment.TMPDIR = process.env.TMPDIR;
  payload = await buildPackage({ outputDir: path.join(root, 'npm'), environment });
  built = await buildPlatforms({ artifact: payload.artifact, outputDir: path.join(root, 'release'),
    windowsLauncher, environment, targets });
  if (hostTarget && targets.includes(hostTarget)) {
    const archive = built.archives.find(item => item.target === hostTarget);
    const bytes = await fs.readFile(archive.artifact);
    nativeEntries = hostTarget === 'windows-x64' ? readZip(bytes) : readTarGzip(bytes);
  }
});

test.after(async () => {
  if (originalTmp === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = originalTmp;
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

async function installer(f, args, env = environment) {
  const command = commandFor(f.source, [...args, '--channel-root', f.channelRoot, '--home', f.home]);
  const result = await execute(command.executable, command.args,
    { env: { ...env, SDLC_NODE: process.execPath }, maxBuffer: 4 * 1024 * 1024 });
  return JSON.parse(result.stdout);
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

test('T-51 npm-denied standalone lifecycle preserves unrelated content and runtime until explicit purge',
  { skip: !hostTarget || process.platform === 'win32' && !windowsLauncher }, async () => {
    const f = await fixture();
    const denied = path.join(f.directory, 'denied commands');
    await fs.mkdir(denied);
    const sentinel = path.join(f.directory, 'forbidden-command-executed');
    for (const name of ['npm', 'npx', 'curl', 'wget', 'sdlc']) {
      if (process.platform === 'win32') {
        await fs.writeFile(path.join(denied, `${name}.cmd`), `@echo invoked>"${sentinel}"\r\n@exit /b 99\r\n`);
      } else {
        await fs.writeFile(path.join(denied, name), `#!/bin/sh\nprintf invoked > '${sentinel}'\nexit 99\n`, { mode: 0o755 });
      }
    }
    const env = { ...environment, PATH: `${denied}${path.delimiter}${environment.PATH}`,
      HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9',
      npm_config_registry: 'http://127.0.0.1:9', npm_config_offline: 'true' };
    const first = await installer(f, ['install'], env);
    assert.equal(first.installed, true);
    assert.match(first.nextAction, /Restart Copilot CLI/u);
    const state = path.join(f.home, 'sdlc/runtime/retained.json');
    await fs.writeFile(state, '{"keep":true}\n');
    const unrelated = path.join(f.home, 'user-settings.json');
    await fs.writeFile(unrelated, '{"unrelated":true}\n');
    const health = await installer(f, ['doctor'], env);
    assert.equal(health.installed, true);
    assert.equal(health.findings.length, 0);
    const current = process.platform === 'win32' ?
      { executable: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-File',
        path.join(f.channelRoot, 'current.ps1'), 'doctor', '--home', f.home] } :
      { executable: path.join(f.channelRoot, 'current/bin/sdlc'), args: ['doctor', '--home', f.home] };
    assert.equal(JSON.parse((await execute(current.executable, current.args,
      { env: { ...env, SDLC_NODE: process.execPath } })).stdout).installed, true);
    if (process.platform !== 'win32') {
      const linked = path.join(f.directory, 'user bin/sdlc');
      await fs.mkdir(path.dirname(linked));
      await fs.symlink(path.relative(path.dirname(linked), current.executable), linked);
      assert.equal(JSON.parse((await execute(linked, ['doctor', '--home', f.home],
        { env: { ...env, SDLC_NODE: process.execPath } })).stdout).installed, true);
    }
    const update = await installer(f, ['update'], env);
    assert.equal(update.changedFiles.length, 0);
    assert.equal(await fs.readFile(state, 'utf8'), '{"keep":true}\n');
    const hooks = JSON.parse(await fs.readFile(path.join(f.home, 'hooks/sdlc.json'), 'utf8'));
    assert.equal(hooks.hooks.preToolUse[0].exec, await fs.realpath(process.execPath));
    assert.equal(hooks.hooks.preToolUse[0].args[0], path.join(f.home, 'sdlc/bin/sdlc.mjs'));
    assert.equal((await installer(f, ['uninstall'], env)).uninstalled, true);
    assert.equal(await fs.readFile(state, 'utf8'), '{"keep":true}\n');
    assert.equal((await installer(f, ['install', '--purge-existing'], env)).purgedExisting, true);
    await assert.rejects(fs.stat(state), { code: 'ENOENT' });
    await fs.writeFile(state, '{"purge":true}\n');
    assert.equal((await installer(f, ['uninstall', '--purge'], env)).purged, true);
    await assert.rejects(fs.stat(path.join(f.home, 'sdlc')), { code: 'ENOENT' });
    assert.equal(await fs.readFile(unrelated, 'utf8'), '{"unrelated":true}\n');
    assert.equal((await fs.readFile(path.join(f.home, 'copilot-instructions.md'), 'utf8')).trimEnd(), 'Keep user instructions.');
    await assert.rejects(fs.stat(sentinel), { code: 'ENOENT' });
  });

test('T-51 channel-only installs and channel removal never mutate the Copilot home',
  { skip: !hostTarget || process.platform === 'win32' && !windowsLauncher }, async () => {
    const f = await fixture();
    const activation = await installer(f, ['install', '--channel-only']);
    assert.equal(activation.activated, true);
    assert.equal(path.isAbsolute(activation.launcher), true);
    assert.deepEqual(await fs.readdir(f.home), ['copilot-instructions.md']);
    await installer(f, ['install']);
    await fs.rm(f.channelRoot, { recursive: true });
    await fs.rm(f.source, { recursive: true });
    const { stdout } = await execute(process.execPath,
      [path.join(f.home, 'sdlc/bin/sdlc.mjs'), 'doctor', '--home', f.home], { env: environment });
    assert.equal(JSON.parse(stdout).installed, true);
    assert.equal(JSON.parse(stdout).findings.length, 0);
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
    await fs.rm(oldVersion, { recursive: true });
    await fs.rm(f.source, { recursive: true });
    const hooks = JSON.parse(await fs.readFile(path.join(f.home, 'hooks/sdlc.json'), 'utf8'));
    assert.ok(!JSON.stringify(hooks).includes(oldVersion));
    assert.equal((await installer({ ...f, source: newSource }, ['doctor'])).findings.length, 0);
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
