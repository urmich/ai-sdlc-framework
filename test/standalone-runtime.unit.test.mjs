export const validationDeclarations = {
  "schemaVersion": 1,
  "surfaces": [
    {"coverage": "direct", "paths": ["packaging/standalone/runtime.mjs", "packaging/standalone/protocol.mjs", "src/cli-arguments.mjs"]}
  ],
  "applicability": [
    {"names": ["standalone activation reuses the current dispatcher while freshly verifying the exact activated version"], "platforms": ["windows-x64", "macos-arm64", "macos-x64"], "owner": "maintainer", "reason": "Controlled supported-platform activation and launch dispatch; Linux standalone remains excluded.", "prerequisites": ["Protocol-only archive; child dispatch is observed, not native launcher execution"]}
  ]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { canonical, tarGzip } from '../packaging/standalone/archive.mjs';
import { extractEntries, platformEntries, verifyTree } from '../packaging/standalone/protocol.mjs';
import { syntheticReleaseLauncher } from '../scripts/synthetic-release-fixture.mjs';

const runtimeURL = new URL('../packaging/standalone/runtime.mjs', import.meta.url);
const protocolURL = new URL('../packaging/standalone/protocol.mjs', import.meta.url);

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
    .replace("import { spawnSync } from 'node:child_process';",
      "import { spawnSync as actualSpawnSync } from 'node:child_process';")
    .replace('extractEntries, verifyTree }', 'extractEntries, verifyTree as actualVerifyTree }')
    .replace('export async function activateChannel(', 'async function actualActivateChannel(');
  const instrumentation = `
  function spawnSync(command, args, options) {
    if (command !== options?.env?.SDLC_NODE || !Array.isArray(args) ||
        typeof args[0] !== 'string' || !args[0].endsWith(path.join('package', 'bin', 'sdlc.mjs'))) {
      return actualSpawnSync(command, args, options);
    }
    globalThis[${JSON.stringify(key)}].push({ operation: 'launch', command, args,
      node: options.env.SDLC_NODE });
    return { status: 23 };
  }
export function preflightProbe(command, args, options) {
  return spawnSync(command, args, options);
}
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

async function protocolTreeEntries(target) {
  const files = ['LICENSE', 'package.json', 'bin/sdlc.mjs', 'src/install.mjs',
    'packaging/standalone/runtime.mjs', 'packaging/standalone/install.sh',
    'packaging/standalone/install.ps1', 'packaging/standalone/sdlc'];
  const payload = await Promise.all(files.map(async relative => ({
    path: `package/${relative}`, data: await fs.readFile(new URL(`../${relative}`, import.meta.url)),
    mode: relative === 'bin/sdlc.mjs' ? 0o755 : 0o644,
  })));
  return platformEntries(tarGzip(payload), target,
    target === 'windows-x64' ? syntheticReleaseLauncher() : undefined).entries;
}

async function tracedTreeReads(t, readFile) {
  const key = `standalone-tree-${randomUUID()}`;
  globalThis[key] = readFile;
  t.after(() => { delete globalThis[key]; });
  const source = (await fs.readFile(protocolURL, 'utf8'))
    .replace(/from '(\.\.?\/[^']+)'/gu, (_, relative) => `from '${new URL(relative, protocolURL).href}'`)
    .replace("import * as fs from 'node:fs/promises';",
      "import * as actualFs from 'node:fs/promises';");
  const instrumentation = `
const fs = { ...actualFs, readFile: (...args) => globalThis[${JSON.stringify(key)}](actualFs.readFile, ...args) };
`;
  return import(`data:text/javascript;base64,${Buffer.from(source + instrumentation).toString('base64')}`);
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
  // Protocol-only shared Mac bytes are not evidence of native installation or execution.
  const entries = await protocolTreeEntries('macos');
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

test('standalone activation reuses the current dispatcher while freshly verifying the exact activated version',
  { skip: !['darwin', 'win32'].includes(process.platform) }, async t => {
    const f = await fixture(t);
    // The protocol-only PE fixture is never executed and grants no native acceptance.
    await extractEntries(await protocolTreeEntries(process.platform === 'win32' ? 'windows-x64' : 'macos'), f.source);
    const { version } = JSON.parse(await fs.readFile(path.join(f.source, 'payload-manifest.json'), 'utf8'));
    const { runtime, events } = await tracedRuntime(t);
    const probe = runtime.preflightProbe(process.execPath, ['-p', '"preflight-observed"'], { encoding: 'utf8' });
    assert.equal(probe.status, 0, probe.stderr);
    assert.equal(probe.stdout.trim(), 'preflight-observed');
    assert.equal(events.length, 0, 'Preflight probes must not be recorded as framework launches');
    const node = await fs.realpath(process.execPath);
    const home = await fs.realpath(f.home);
    for (const action of ['install', 'update']) {
      events.length = 0;
      assert.equal(await runtime.main(argv(f, action)), 23);
      const launches = events.filter(event => event.operation === 'launch');
      assert.equal(launches.length, 1);
      assert.equal(launches[0].command, node);
      assert.equal(launches[0].node, node);
      assert.equal(launches[0].args[0],
        path.join(f.channelRoot, 'versions', version, 'package', 'bin', 'sdlc.mjs'));
      assert.deepEqual(launches[0].args.slice(1), [action, '--home', home]);
      const verifications = events.filter(event => event.operation === 'verify');
      assert.equal(verifications.length, 3);
      assert.equal(verifications[0].root, await fs.realpath(f.source));
      assert.equal(verifications[2].root, path.join(f.channelRoot, 'versions', version));
    }
    const active = path.join(f.channelRoot, 'versions', version);
    await fs.appendFile(path.join(active, 'package', 'src', 'install.mjs'), '\n// tampered\n');
    events.length = 0;
    await assert.rejects(runtime.main(argv(f, 'update')),
      { message: 'Distribution payload, wrapper inventory or checksum mismatch' });
    assert.equal(events.some(event => event.operation === 'launch'), false);
    assert.deepEqual(await fs.readdir(f.home), ['user.txt']);
  });

test('standalone tree verification bounds independent reads and drains a failed batch', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const names = Array.from({ length: 20 }, (_, index) => `file-${String(index).padStart(2, '0')}`);
  for (const name of names) await fs.writeFile(path.join(f.source, name), name);
  let failing = false;
  let active = 0;
  let peak = 0;
  const entered = [];
  let batchReady;
  const batch = new Promise(resolve => { batchReady = resolve; });
  let release;
  const released = new Promise(resolve => { release = resolve; });
  const failure = new Error('controlled standalone read failure');
  const protocol = await tracedTreeReads(t, async (readFile, file, ...args) => {
    active++;
    peak = Math.max(peak, active);
    try {
      if (failing) {
        entered.push(path.basename(file));
        if (entered.length === 16) batchReady();
        if (path.basename(file) === names[0]) throw failure;
        await released;
      }
      return await readFile(file, ...args);
    } finally { active--; }
  });
  const entries = await protocol.treeEntries(f.source);
  assert.deepEqual(entries.map(entry => [entry.path, entry.data.toString()]), names.map(name => [name, name]));
  assert.ok(peak <= 16);
  failing = true;
  peak = 0;
  const pending = protocol.treeEntries(f.source);
  let settled = false;
  const result = pending.then(() => { settled = true; return 'completed'; },
    () => { settled = true; return 'rejected'; });
  try {
    assert.equal(await Promise.race([batch.then(() => 'dispatched'), result]), 'dispatched');
    assert.equal(settled, false);
    release();
    await assert.rejects(pending, error => error === failure);
    assert.deepEqual(entered.sort(), names.slice(0, 16));
    assert.ok(peak <= 16);
    assert.equal(active, 0);
  } finally {
    release();
    await Promise.allSettled([pending]);
  }
});

test('standalone runtime parses arguments and resolves owned homes without loading the framework dispatcher or Store', async t => {
  const f = await fixture(t);
  await invalidSource(f);
  const isolated = path.join(f.directory, 'isolated');
  await fs.mkdir(isolated);
  for (const directory of ['src', 'packaging/standalone']) {
    await fs.cp(new URL(`../${directory}/`, import.meta.url), path.join(isolated, directory), { recursive: true });
  }
  await fs.writeFile(path.join(isolated, 'src', 'cli.mjs'),
    'export function parseArguments() {}\nthrow new Error("Forbidden full dispatcher import");\n');
  await fs.writeFile(path.join(isolated, 'src', 'store.mjs'),
    'export class Store {}\nthrow new Error("Forbidden Store import");\n');
  const probe = path.join(isolated, 'probe.mjs');
  await fs.writeFile(probe, `
import assert from 'node:assert/strict';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import { main, validateChannelHome } from './packaging/standalone/runtime.mjs';
const [source, home, channel] = process.argv.slice(2);
const expected = await fs.realpath(home);
assert.equal((await validateChannelHome({ channelRoot: channel })).home, expected);
assert.equal((await validateChannelHome({ channelRoot: channel, home: path.relative(process.cwd(), home) })).home, expected);
await assert.rejects(validateChannelHome({ channelRoot: home, home }), /non-overlapping/u);
const args = ['install-channel', '--root', source, '--node', process.execPath, '--',
  'install', '--channel-root', channel, '--home', home];
await assert.rejects(main(args), { message: 'Malformed payload manifest' });
await assert.rejects(main([...args, '--home', home]), { code: 'INPUT', message: 'Duplicate option --home' });
await assert.rejects(main([...args, '--unknown']), { code: 'INPUT', message: 'Unknown option or missing value: --unknown' });
console.log('Standalone helper-only import and original guards passed.');
`);
  const result = await promisify(execFile)(process.execPath, [probe, f.source, f.home, f.channelRoot],
    { cwd: isolated, env: { ...process.env, COPILOT_HOME: f.home } })
    .then(output => ({ code: 0, output }), error => {
      if (!Number.isInteger(error.code)) throw error;
      const primary = error.stderr.split(/\r?\n/u).find(line => /^\w*Error(?: \[[A-Z0-9_]+\])?:/u.test(line));
      return { code: error.code, diagnostic: primary ?? 'Child failed without a primary error line' };
    });
  assert.equal(result.code, 0, result.diagnostic);
  assert.equal(result.output.stdout.trim(), 'Standalone helper-only import and original guards passed.');
  await unchanged(f);
});
