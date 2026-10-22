export const validationDeclarations = {
  "schemaVersion": 1,
  "surfaces": [
    {"coverage": "direct", "paths": ["packaging/standalone/runtime.mjs", "packaging/standalone/protocol.mjs"]}
  ]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { canonical, tarGzip } from '../packaging/standalone/archive.mjs';
import { extractEntries, platformEntries, verifyTree } from '../packaging/standalone/protocol.mjs';

const runtimeURL = new URL('../packaging/standalone/runtime.mjs', import.meta.url);

async function fixture(t) {
  const directory = fileURLToPath(new URL(`../.test-data/standalone-runtime-${randomUUID()}/`, import.meta.url));
  const source = path.join(directory, 'source');
  const home = path.join(directory, 'home');
  const channelRoot = path.join(directory, 'channel');
  await fs.mkdir(source, { recursive: true });
  await fs.mkdir(home);
  await fs.writeFile(path.join(home, 'user.txt'), 'Preserve user content.\n');
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
    await assert.rejects(fs.lstat(directory), { code: 'ENOENT' });
  });
  return { directory, source, home, channelRoot };
}

async function tracedRuntime(t) {
  const key = `standalone-runtime-${randomUUID()}`;
  const events = [];
  globalThis[key] = events;
  t.after(() => { delete globalThis[key]; });
  // Instrument entry boundaries, but execute the original dispatcher, activation and verifier.
  const source = (await fs.readFile(runtimeURL, 'utf8'))
    .replace(/from '(\.\.?\/[^']+)'/gu, (_, relative) => `from '${new URL(relative, runtimeURL).href}'`)
    .replace('extractEntries, verifyTree }', 'extractEntries, verifyTree as actualVerifyTree }')
    .replace('export async function activateChannel(', 'async function actualActivateChannel(');
  const instrumentation = `
async function verifyTree(root, options) {
  globalThis[${JSON.stringify(key)}].push({ operation: 'verify', root });
  return actualVerifyTree(root, options);
}
export async function activateChannel(options) {
  globalThis[${JSON.stringify(key)}].push({ operation: 'activate', root: options.sourceRoot });
  return actualActivateChannel(options);
}
`;
  return { runtime: await import(`data:text/javascript;base64,${Buffer.from(source + instrumentation).toString('base64')}`), events };
}

async function invalidSource(f) {
  await fs.writeFile(path.join(f.source, 'payload-manifest.json'), canonical({ schemaVersion: 1 }));
}

function argv(f, action, extra = []) {
  return ['install-channel', '--root', f.source, '--node', process.execPath, '--',
    action, '--channel-root', f.channelRoot, '--home', f.home, ...extra];
}

async function unchanged(f) {
  await assert.rejects(fs.lstat(f.channelRoot), { code: 'ENOENT' });
  assert.deepEqual(await fs.readdir(f.home), ['user.txt']);
  assert.equal(await fs.readFile(path.join(f.home, 'user.txt'), 'utf8'), 'Preserve user content.\n');
}

test('standalone install/update reach the activation source guard once before any owned destination mutation', async t => {
  const f = await fixture(t);
  await invalidSource(f);
  const { runtime, events } = await tracedRuntime(t);
  for (const action of ['install', 'update']) {
    events.length = 0;
    await assert.rejects(runtime.main(argv(f, action)), { message: 'Malformed payload manifest' });
    assert.deepEqual(events, [
      { operation: 'activate', root: await fs.realpath(f.source) },
      { operation: 'verify', root: await fs.realpath(f.source) },
    ]);
    await unchanged(f);
  }
});

test('standalone doctor/uninstall and launch retain their source guards and original errors', async t => {
  const f = await fixture(t);
  await invalidSource(f);
  const { runtime, events } = await tracedRuntime(t);
  for (const action of ['doctor', 'uninstall']) {
    for (const extra of [[], ['--channel-only']]) {
      events.length = 0;
      await assert.rejects(runtime.main(argv(f, action, extra)), { message: 'Malformed payload manifest' });
      assert.deepEqual(events, [{ operation: 'verify', root: await fs.realpath(f.source) }]);
      await unchanged(f);
    }
  }
  events.length = 0;
  await assert.rejects(runtime.main(['launch', '--root', f.source, '--node', process.execPath,
    '--', 'doctor', '--home', f.home]), { message: 'Malformed payload manifest' });
  assert.deepEqual(events, [{ operation: 'verify', root: await fs.realpath(f.source) }]);
  await unchanged(f);
});

test('standalone argument and overlapping-home errors still precede source verification', async t => {
  const f = await fixture(t);
  await invalidSource(f);
  const { runtime, events } = await tracedRuntime(t);
  await assert.rejects(runtime.main(argv(f, 'install', ['--source-root', f.source])),
    { message: 'Standalone source-root cannot be overridden' });
  await assert.rejects(runtime.main(argv(f, 'doctor', ['--purge-existing'])),
    { message: 'Invalid purge operation' });
  await assert.rejects(runtime.main(['install-channel', '--root', f.source, '--node', process.execPath,
    '--', 'install', '--channel-root', f.home, '--home', f.home]),
  { message: 'Channel root and Copilot home must be separate, non-overlapping directories' });
  assert.deepEqual(events, []);
  await unchanged(f);
});

test('real standalone tree verification rejects source, staged and active byte tampering without a native launcher fixture', async t => {
  const f = await fixture(t);
  const files = ['LICENSE', 'package.json', 'bin/sdlc.mjs', 'src/install.mjs',
    'packaging/standalone/runtime.mjs', 'packaging/standalone/install.sh',
    'packaging/standalone/install.ps1', 'packaging/standalone/sdlc'];
  const payload = await Promise.all(files.map(async relative => ({
    path: `package/${relative}`, data: await fs.readFile(new URL(`../${relative}`, import.meta.url)),
    mode: relative === 'bin/sdlc.mjs' ? 0o755 : 0o644,
  })));
  // Protocol-only shared Mac bytes are not evidence of native installation or execution.
  const { entries } = platformEntries(tarGzip(payload), 'macos');
  const expectations = { expectedPlatform: 'darwin', expectedArch: 'x64' };
  for (const name of ['downloaded', 'staged', 'active']) {
    const tree = path.join(f.directory, name);
    await extractEntries(entries, tree);
    assert.equal((await verifyTree(tree, expectations)).platform.platform, 'darwin');
    const runtime = path.join(tree, 'package', 'packaging', 'standalone', 'runtime.mjs');
    await fs.appendFile(runtime, '\n// tampered\n');
    await assert.rejects(verifyTree(tree, expectations),
      { message: 'Distribution payload, wrapper inventory or checksum mismatch' });
  }
  const wrongPlatform = path.join(f.directory, 'wrong-platform');
  await extractEntries(entries, wrongPlatform);
  await assert.rejects(verifyTree(wrongPlatform, { expectedPlatform: 'win32', expectedArch: 'x64' }),
    { message: 'Wrong platform or architecture' });
  await fs.writeFile(path.join(wrongPlatform, 'unlisted.txt'), 'not in inventory');
  await assert.rejects(verifyTree(wrongPlatform, expectations),
    { message: 'Distribution payload, wrapper inventory or checksum mismatch' });
  await unchanged(f);
});
