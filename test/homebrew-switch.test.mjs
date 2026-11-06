export const validationDeclarations = {
  "schemaVersion": 1,
  "applicability": [
    {"options": "nativeMac", "platforms": ["macos-arm64", "macos-x64"], "owner": "maintainer", "reason": "Mac filesystem/runtime switching contracts execute independently on both native architectures.", "prerequisites": ["Native Mac Node", "Owned Homebrew/channel fixtures"]}
  ],
  "surfaces": [{"coverage": "direct", "paths": ["packaging/homebrew/switch-state.mjs", "scripts/homebrew-switch.mjs"]}]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { switchFromHomebrew, switchToHomebrew, verifyHomebrewHooks,
  verifyCopiedHomebrewInstallation, resolveHomebrewRuntime } from '../scripts/homebrew-switch.mjs';
import { captureSwitchState, finishSwitchState, linkState, restoreCapturedUpgradeLinks,
  verifyCapturedKegs } from '../packaging/homebrew/switch-state.mjs';

const nativeMac = { skip: process.platform !== 'darwin' };
const copiedHookEvents = ['sessionStart', 'userPromptSubmitted', 'preToolUse', 'postToolUse',
  'postToolUseFailure', 'preCompact', 'agentStop', 'sessionEnd'];

test('Homebrew rollback inventory bounds independent reads and preserves every captured byte', async t => {
  const root = await fs.mkdtemp(path.resolve('.test-data', 'homebrew-inventory-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const prefix = path.join(root, 'owned prefix');
  const cellar = path.join(prefix, 'Cellar');
  const keg = path.join(cellar, 'ai-sdlc-framework', '0.4.0');
  await fs.mkdir(keg, { recursive: true });
  await fs.writeFile(path.join(keg, 'INSTALL_RECEIPT.json'), JSON.stringify({
    source: { tap: 'homebrew/core' }, runtime_dependencies: [],
  }));
  const expected = [];
  for (let index = 0; index < 33; index++) {
    const name = `payload-${String(index).padStart(2, '0')}`;
    const bytes = Buffer.from(`owned rollback payload ${index}`);
    const file = path.join(keg, name);
    await fs.writeFile(file, bytes);
    expected.push({ path: name, mode: (await fs.lstat(file)).mode & 0o777,
      sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  const large = Buffer.alloc(2 * 1024 * 1024, 37);
  const largeFile = path.join(keg, 'payload-large');
  await fs.writeFile(largeFile, large);
  expected.push({ path: 'payload-large', mode: (await fs.lstat(largeFile)).mode & 0o777,
    sha256: createHash('sha256').update(large).digest('hex') });
  await fs.mkdir(path.join(keg, 'nested'));
  const nested = path.join('nested', 'child');
  const nestedBytes = Buffer.from('nested rollback bytes');
  await fs.writeFile(path.join(keg, nested), nestedBytes);
  expected.push({ path: nested, mode: (await fs.lstat(path.join(keg, nested))).mode & 0o777,
    sha256: createHash('sha256').update(nestedBytes).digest('hex') });
  await fs.symlink('payload-00', path.join(keg, 'payload-link'));
  expected.push({ path: 'payload-link', link: 'payload-00' });
  expected.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const growingFile = path.join(keg, 'payload-32');
  const growingBytes = Buffer.alloc(2 * 1024 * 1024, 91);
  expected.find(entry => entry.path === 'payload-32').sha256 =
    createHash('sha256').update(growingBytes).digest('hex');
  const readFile = fsPromises.readFile;
  const open = fsPromises.open;
  let active = 0;
  let peak = 0;
  let grew = false;
  let maximumReadBuffer = 0;
  const mocked = t.mock.method(fsPromises, 'readFile', async (file, ...options) => {
    if (['payload-large', 'payload-32'].includes(path.basename(String(file)))) {
      assert.equal(active, 0, 'Large payloads must not multiply the concurrent read-buffer budget');
    }
    return readFile(file, ...options);
  });
  const mockedOpen = t.mock.method(fsPromises, 'open', async (file, ...options) => {
    if (!path.basename(String(file)).startsWith('payload-')) return open(file, ...options);
    active++;
    peak = Math.max(peak, active);
    try {
      if (String(file) === growingFile && !grew) {
        grew = true;
        await fs.writeFile(file, growingBytes);
      }
      const handle = await open(file, ...options);
      const read = handle.read.bind(handle);
      const close = handle.close.bind(handle);
      handle.read = async (...parameters) => {
        maximumReadBuffer = Math.max(maximumReadBuffer, parameters[2]);
        return read(...parameters);
      };
      handle.close = async () => {
        try { return await close(); }
        finally { active--; }
      };
      await new Promise(resolve => setImmediate(resolve));
      return handle;
    } catch (error) {
      active--;
      throw error;
    }
  });
  syncBuiltinESMExports();
  let state;
  try {
    state = await captureSwitchState({ prefix, cellar, formula: 'ai-sdlc-framework',
      runBrew: async args => {
        assert.deepEqual(args, ['--prefix', 'ai-sdlc-framework']);
        return { stdout: keg };
      } });
    assert.ok(peak > 1 && peak <= 16, `Expected bounded overlapping reads, observed ${peak}`);
    assert.equal(grew, true);
    assert.equal(maximumReadBuffer, 1024 * 1024);
    assert.equal(active, 0);
    assert.equal(state.capturedBeforeBrew, true);
    assert.equal(state.kegs.length, 1);
    assert.deepEqual(state.kegs[0].files, expected);
    await verifyCapturedKegs(state);
    await fs.writeFile(path.join(keg, 'payload-17'), 'changed owned bytes');
    await assert.rejects(verifyCapturedKegs(state), {
      code: 'HOMEBREW_RETENTION_UNSUPPORTED',
    });
    assert.equal(await fs.readFile(path.join(state.kegs[0].backup, 'payload-17'), 'utf8'),
      'owned rollback payload 17');
  } finally {
    mocked.mock.restore();
    mockedOpen.mock.restore();
    syncBuiltinESMExports();
    if (state) await finishSwitchState(state);
  }
});

test('Homebrew rollback inventory read failures drain before removing owned recovery state', async t => {
  const root = await fs.mkdtemp(path.resolve('.test-data', 'homebrew-inventory-error-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const prefix = path.join(root, 'owned prefix');
  const cellar = path.join(prefix, 'Cellar');
  const keg = path.join(cellar, 'ai-sdlc-framework', '0.4.0');
  await fs.mkdir(keg, { recursive: true });
  await fs.writeFile(path.join(keg, 'INSTALL_RECEIPT.json'), JSON.stringify({
    source: { tap: 'homebrew/core' }, runtime_dependencies: [],
  }));
  for (const name of ['payload-0', 'payload-1', 'payload-2']) {
    await fs.writeFile(path.join(keg, name), 'owned rollback bytes');
  }
  const open = fsPromises.open;
  const remove = fsPromises.rm;
  const held = Promise.withResolvers();
  const failureStarted = Promise.withResolvers();
  const failure = Object.assign(new Error('controlled owned inventory read failure'), { code: 'EIO' });
  const drained = [];
  let started = 0;
  let active = 0;
  let cleanupWhileActive = false;
  const mockedRead = t.mock.method(fsPromises, 'open', async (file, ...options) => {
    if (!path.basename(String(file)).startsWith('payload-')) return open(file, ...options);
    const done = Promise.withResolvers();
    drained.push(done.promise);
    active++;
    try {
      if (++started === 2) {
        failureStarted.resolve();
        throw failure;
      }
      const handle = await open(file, ...options);
      const read = handle.read.bind(handle);
      const close = handle.close.bind(handle);
      handle.read = async (...parameters) => {
        await held.promise;
        return read(...parameters);
      };
      handle.close = async () => {
        try { return await close(); }
        finally {
          active--;
          done.resolve();
        }
      };
      return handle;
    } catch (error) {
      active--;
      done.resolve();
      throw error;
    }
  });
  const mockedRemove = t.mock.method(fsPromises, 'rm', async (...args) => {
    cleanupWhileActive ||= active > 0;
    return remove(...args);
  });
  syncBuiltinESMExports();
  try {
    const capturing = captureSwitchState({ prefix, cellar, formula: 'ai-sdlc-framework',
      runBrew: async () => ({ stdout: keg }) });
    let settled = false;
    capturing.then(() => { settled = true; }, () => { settled = true; });
    await Promise.race([failureStarted.promise, capturing.then(
      () => assert.fail('Expected the controlled inventory failure'),
      error => { throw error; },
    )]);
    await new Promise(resolve => setImmediate(resolve));
    const settledWhileHeld = settled;
    held.resolve();
    await assert.rejects(capturing, error => error === failure);
    assert.equal(settledWhileHeld, false);
    assert.equal(active, 0);
    assert.equal(cleanupWhileActive, false);
    await assert.rejects(fs.access(path.join(prefix, 'var', 'ai-sdlc-framework-switch', 'active.lock')),
      { code: 'ENOENT' });
  } finally {
    held.resolve();
    await Promise.allSettled(drained);
    mockedRead.mock.restore();
    mockedRemove.mock.restore();
    syncBuiltinESMExports();
  }
});

test('T-PRD061 captured upgrade restores both opt and linked references before promotion without replacing foreign state',
  nativeMac, async t => {
    const root = await fs.mkdtemp(path.resolve('.test-data', 'homebrew-upgrade-links-'));
    t.after(() => fs.rm(root, { recursive: true }));
    const name = 'ai-sdlc-framework';
    const previousKeg = path.join(root, 'Cellar', name, '0.3.1');
    const newKeg = path.join(root, 'Cellar', name, '0.4.0');
    for (const keg of [previousKeg, newKeg]) await fs.mkdir(keg, { recursive: true });
    const state = { prefix: root, previousKeg, links: [] };
    for (const file of [path.join(root, 'opt', name), path.join(root, 'var', 'homebrew', 'linked', name)]) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.symlink(path.relative(path.dirname(file), previousKeg), file);
      state.links.push({ path: file, name, captured: await linkState(file) });
      await fs.unlink(file);
      await fs.symlink(newKeg, file);
    }
    await restoreCapturedUpgradeLinks(state, newKeg);
    for (const record of state.links) {
      assert.deepEqual(await linkState(record.path), record.captured);
      assert.equal(await fs.realpath(record.path), previousKeg);
    }
    await fs.access(newKeg);
    await fs.access(previousKeg);
    const opt = state.links[0].path;
    await fs.unlink(opt);
    await fs.writeFile(opt, 'unidentified replacement');
    await assert.rejects(restoreCapturedUpgradeLinks(state, newKeg), /Unidentified replacement retained/u);
    assert.equal(await fs.readFile(opt, 'utf8'), 'unidentified replacement');
    assert.deepEqual(await linkState(state.links[1].path), state.links[1].captured);
    await assert.rejects(restoreCapturedUpgradeLinks({ ...state, links: [] }, newKeg),
      /Captured Homebrew link record is missing/u);
  });

test('T-51 runtime resolution follows current and legacy direct receipts without selecting historical or unrelated Node', async t => {
  const root = path.resolve('.test-data', `homebrew-runtime-${randomUUID()}`);
  const cellar = path.join(root, 'Cellar');
  const channel = path.join(cellar, 'ai-sdlc-framework', '0.4.0');
  await fs.mkdir(channel, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const runtimes = [['node@22', '22.23.2'], ['node@24', '24.20.0']];
  for (const [formula, version] of runtimes) {
    const keg = path.join(cellar, formula, version);
    await fs.mkdir(keg, { recursive: true });
    await fs.writeFile(path.join(keg, 'INSTALL_RECEIPT.json'), JSON.stringify({ source: { tap: 'homebrew/core' } }));
  }
  for (const [formula, version] of runtimes) {
    const keg = path.join(cellar, formula, version);
    const receipt = { runtime_dependencies: [
      { full_name: formula, pkg_version: version },
      { full_name: formula === 'node@22' ? 'node@24' : 'node@22', pkg_version: '1.0.0', declared_directly: false },
    ] };
    await fs.writeFile(path.join(channel, 'INSTALL_RECEIPT.json'), JSON.stringify(receipt));
    const calls = [];
    const runBrew = async args => {
      calls.push(args);
      assert.deepEqual(args, ['--prefix', formula]);
      return { stdout: keg };
    };
    const expected = { formula, keg, node: path.join(keg, 'bin', 'node') };
    assert.deepEqual(await resolveHomebrewRuntime({ keg: channel, cellar, runBrew }), expected);
    const currentKeg = await fs.realpath(keg);
    const capturedState = { kegs: [
      { path: channel, role: 'live', receipt, dependencies: [
        { fullName: formula, requiredLive: true, currentKeg },
      ] },
      { path: currentKeg, role: 'live' },
      { path: path.join(cellar, formula, 'retired-version'), role: 'historical' },
    ] };
    assert.deepEqual(await resolveHomebrewRuntime({ keg: channel, cellar, runBrew, capturedState }),
      { ...expected, keg: currentKeg, node: path.join(currentKeg, 'bin', 'node') });
    capturedState.kegs[0].dependencies[0].currentKeg = path.join(cellar, formula, 'retired-version');
    await assert.rejects(resolveHomebrewRuntime({ keg: channel, cellar, runBrew, capturedState }), /captured live dependency/u);
    receipt.runtime_dependencies.push({ full_name: 'node@26', pkg_version: '26.0.0' });
    await fs.writeFile(path.join(channel, 'INSTALL_RECEIPT.json'), JSON.stringify(receipt));
    await assert.rejects(resolveHomebrewRuntime({ keg: channel, cellar, runBrew }), /exactly one direct Node/u);
    await fs.writeFile(path.join(channel, 'INSTALL_RECEIPT.json'), JSON.stringify({ runtime_dependencies: [] }));
    await assert.rejects(resolveHomebrewRuntime({ keg: channel, cellar, runBrew }), /exactly one direct Node/u);
    assert.equal(calls.length, 3);
  }
});

function copiedHookFixture(home, node) {
  return { hooks: Object.fromEntries(copiedHookEvents.map(event => [event, [{
    exec: node, args: [path.join(home, 'sdlc', 'bin', 'sdlc.mjs'),
      ...(event === 'preToolUse' ? ['gate'] : ['hook', event]), '--home', home],
  }]])) };
}

function copiedCliArguments(args) {
  if (args[0] !== '--input-type=module') return args;
  assert.equal(args[1], '--eval');
  assert.match(args[2], /const \{runCli\}/u);
  return args.slice(3);
}

async function copiedHookResponse(home, args, input) {
  const invocation = copiedCliArguments(args);
  assert.equal(invocation[0], path.join(home, 'sdlc', 'bin', 'sdlc.mjs'));
  assert.deepEqual(invocation.slice(-2), ['--home', home]);
  const event = invocation[1] === 'gate' ? 'preToolUse' : invocation[2];
  assert.ok(copiedHookEvents.includes(event));
  const payload = JSON.parse(input);
  assert.equal(typeof payload.sessionId, 'string');
  const sessions = path.join(home, 'sdlc', 'runtime', 'sessions');
  if (['sessionStart', 'preCompact', 'sessionEnd'].includes(event)) {
    const file = path.join(sessions, `${payload.sessionId}.json`);
    const previous = await fs.readFile(file, 'utf8').then(JSON.parse, error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    await fs.mkdir(sessions, { recursive: true });
    await fs.writeFile(file, JSON.stringify({ sessionId: payload.sessionId,
      orientationGeneration: (previous?.orientationGeneration ?? 0) + 1,
      orientationReason: event, acknowledgedToken: null }));
  } else if (event === 'userPromptSubmitted') {
    const receipts = path.join(sessions, payload.sessionId, 'receipts');
    await fs.mkdir(receipts, { recursive: true });
    await fs.writeFile(path.join(receipts, 'owned-fixture.json'),
      JSON.stringify({ sessionId: payload.sessionId, source: event }), { flag: 'wx' });
  }
  return event === 'sessionStart' ? {
    additionalContext: 'AI SDLC lifecycle stages are advisory. Owned copied-hook fixture.',
  } : {};
}

test('T-51 copied Homebrew fixture satisfies the complete installed hook routing contract without invoking Homebrew', async t => {
  const root = path.resolve('.test-data', `homebrew-hook-contract-${randomUUID()}`);
  const home = path.join(root, 'owned home');
  const node = path.join(root, 'retained-node');
  await fs.mkdir(path.join(home, 'hooks'), { recursive: true });
  await fs.writeFile(node, 'owned runtime marker');
  t.after(() => fs.rm(root, { recursive: true }));
  const hooksFile = path.join(home, 'hooks', 'sdlc.json');
  const hooks = copiedHookFixture(home, node);
  const doctor = { installed: true, findings: [], home, frameworkVersion: '0.4.0' };
  const selectedNode = await fs.realpath(node);
  const legacy = { hooks: { sessionStart: hooks.hooks.sessionStart } };
  await fs.writeFile(hooksFile, JSON.stringify(legacy));
  await assert.rejects(verifyHomebrewHooks({ doctor, node: selectedNode }), error => {
    assert.equal(error.code, 'ERR_ASSERTION');
    assert.deepEqual(error.actual, ['sessionStart']);
    assert.equal(error.expected.length, 8);
    return true;
  });
  await fs.writeFile(hooksFile, JSON.stringify(hooks));
  const calls = [];
  const run = async (command, args, options = {}) => {
    calls.push({ command, args });
    assert.equal(command, node, 'The contract fixture must never invoke Homebrew or another executable');
    if (args[0] === '-p') return { stdout: JSON.stringify({
      execPath: selectedNode, major: 22, platform: process.platform, arch: process.arch,
    }) };
    if (copiedCliArguments(args)[1] === 'doctor') return { stdout: JSON.stringify(doctor) };
    return { stdout: JSON.stringify(await copiedHookResponse(home, args, options.input)) };
  };
  await verifyCopiedHomebrewInstallation({ home, node, frameworkVersion: '0.4.0', run });
  assert.equal(calls.filter(call => call.args[0] === '--input-type=module').length, 8);
  const wrongRoute = structuredClone(hooks);
  wrongRoute.hooks.preToolUse[0].args = [path.join(home, 'sdlc', 'bin', 'sdlc.mjs'),
    'hook', 'preToolUse', '--home', home];
  await fs.writeFile(hooksFile, JSON.stringify(wrongRoute));
  await assert.rejects(verifyHomebrewHooks({ doctor, node: selectedNode }), /wrong handler\/home/u);
});

async function setup(t, behavior = {}) {
  const root = path.resolve('.test-data', `homebrew-switch-${randomUUID()}`);
  await fs.mkdir(root, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const prefix = path.join(root, 'brew prefix');
  const cellar = path.join(prefix, 'Cellar');
  const oldKeg = path.join(cellar, 'ai-sdlc-framework', '0.3.0');
  const candidateVersion = behavior.candidateVersion ?? '0.4.0';
  const candidateRevision = behavior.candidateRevision ?? 0;
  const candidatePkgVersion = `${candidateVersion}${candidateRevision ? `_${candidateRevision}` : ''}`;
  const newKeg = path.join(cellar, 'ai-sdlc-framework', candidatePkgVersion);
  const nodeKeg = path.join(cellar, 'node@22', '22.23.2');
  const node = path.join(nodeKeg, 'bin', 'node');
  const destination = path.join(prefix, 'bin', 'sdlc');
  const home = path.join(root, 'copilot home');
  const sourceRoot = path.join(root, 'non-global npm', 'node_modules', 'ai-sdlc-framework');
  const formula = 'local/candidate/ai-sdlc-framework';
  const receipt = (dependencies, version, revision = 0) => JSON.stringify({
    installed_on_request: false, source: { tap: 'local/candidate',
      versions: { stable: version }, revision },
    runtime_dependencies: dependencies,
  });
  const recordedNodeVersion = behavior.recordedNodeVersion ?? '22.23.2';
  const dependencies = [{ full_name: 'node@22', pkg_version: recordedNodeVersion }];
  async function keg(directory, version, revision = 0) {
    await fs.mkdir(path.join(directory, 'bin'), { recursive: true });
    await fs.mkdir(path.join(directory, 'libexec', 'package'), { recursive: true });
    await fs.writeFile(path.join(directory, 'bin', 'sdlc'), `old or new ${version}\n`);
    await fs.writeFile(path.join(directory, 'libexec', 'package', 'package.json'),
      JSON.stringify({ name: 'ai-sdlc-framework', version }));
    await fs.writeFile(path.join(directory, 'INSTALL_RECEIPT.json'), receipt(dependencies, version, revision));
  }
  await keg(oldKeg, '0.3.0');
  const inactiveKeg = path.join(cellar, 'ai-sdlc-framework', '0.2.0');
  const obsoleteNodeKeg = path.join(cellar, 'node@22', '22.1.0');
  if (behavior.inactiveRetiredDependencies) {
    await keg(inactiveKeg, '0.2.0');
    await fs.writeFile(path.join(inactiveKeg, 'INSTALL_RECEIPT.json'), receipt([
      { full_name: 'node@22', pkg_version: '22.1.0' },
      { full_name: 'icu4c@71', pkg_version: '71.1' },
    ], '0.2.0'));
    await fs.mkdir(path.join(obsoleteNodeKeg, 'bin'), { recursive: true });
    await fs.writeFile(path.join(obsoleteNodeKeg, 'bin', 'node'), 'inactive node fixture\n');
    await fs.writeFile(path.join(obsoleteNodeKeg, 'INSTALL_RECEIPT.json'), receipt([
      { full_name: 'icu4c@70', pkg_version: '70.1' },
    ], '22.1.0'));
  }
  await fs.mkdir(path.join(nodeKeg, 'bin'), { recursive: true });
  await fs.writeFile(node, 'native node fixture\n', { mode: 0o755 });
  await fs.writeFile(path.join(nodeKeg, 'INSTALL_RECEIPT.json'), receipt([], '22.23.2'));
  const historicalNodeKeg = path.join(cellar, 'node@22', recordedNodeVersion);
  if (behavior.keepHistoricalDependency && historicalNodeKeg !== nodeKeg) {
    await fs.mkdir(path.join(historicalNodeKeg, 'bin'), { recursive: true });
    await fs.writeFile(path.join(historicalNodeKeg, 'bin', 'node'), 'historical node fixture\n', { mode: 0o755 });
    await fs.writeFile(path.join(historicalNodeKeg, 'INSTALL_RECEIPT.json'), receipt([], recordedNodeVersion));
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.mkdir(path.join(prefix, 'opt'), { recursive: true });
  await fs.mkdir(path.join(prefix, 'var', 'homebrew', 'linked'), { recursive: true });
  const target = directory => path.relative(path.dirname(destination), path.join(directory, 'bin', 'sdlc'));
  await fs.symlink(target(oldKeg), destination);
  await fs.symlink(oldKeg, path.join(prefix, 'opt', 'ai-sdlc-framework'));
  await fs.symlink(oldKeg, path.join(prefix, 'var', 'homebrew', 'linked', 'ai-sdlc-framework'));
  await fs.symlink(nodeKeg, path.join(prefix, 'opt', 'node@22'));
  await fs.mkdir(path.join(sourceRoot, 'bin'), { recursive: true });
  await fs.writeFile(path.join(sourceRoot, 'package.json'),
    '{"name":"ai-sdlc-framework","version":"0.4.0"}\n');
  await fs.writeFile(path.join(sourceRoot, 'bin', 'sdlc.mjs'), 'replacement fixture');
  await fs.mkdir(path.join(home, 'hooks'), { recursive: true });
  await fs.mkdir(path.join(home, 'sdlc', 'bin'), { recursive: true });
  await fs.writeFile(path.join(home, 'sdlc', 'bin', 'sdlc.mjs'), 'copied fixture');
  const calls = [];
  let installedNew = false;
  let removed = false;
  let promoted = false;
  let promotionAttempts = 0;
  let captured;
  const json = value => ({ stdout: JSON.stringify(value), stderr: '' });
  async function writeHooks() {
    await fs.writeFile(path.join(home, 'hooks', 'sdlc.json'), JSON.stringify(copiedHookFixture(home, node)));
  }
  const run = async (command, args, options = {}) => {
    calls.push({ command, args, noInstallCleanup: options.env?.HOMEBREW_NO_INSTALL_CLEANUP });
    if (command === '/usr/bin/uname') return { stdout: process.arch === 'arm64' ? 'arm64' : 'x86_64' };
    if (command === '/usr/sbin/sysctl') return { stdout: behavior.translated ?? '0' };
    if (command === 'fake-brew') {
      assert.equal(options.env?.HOMEBREW_NO_INSTALL_CLEANUP, '1', 'Every brew operation must suppress install cleanup');
      if (args[0] === '--prefix') return { stdout: args[1] === undefined ? prefix :
        path.join(prefix, 'opt', args[1].split('/').at(-1)) };
      if (args[0] === '--cellar') return { stdout: cellar };
      if (args[0] === 'info') return json({ formulae: [{
        name: 'ai-sdlc-framework', full_name: formula,
        versions: { stable: candidateVersion }, revision: candidateRevision,
      }] });
      if (['install', 'upgrade', 'tab'].includes(args[0])) {
        const lock = JSON.parse(await fs.readFile(path.join(prefix, 'var', 'ai-sdlc-framework-switch', 'active.lock'), 'utf8'));
        captured = JSON.parse(await fs.readFile(path.join(lock.root, 'state.json'), 'utf8'));
        assert.equal(captured.capturedBeforeBrew, true);
        assert.equal(captured.phase, args[0] === 'tab' ? 'retaining-node' : 'installing-new-channel');
        assert.equal(captured.capturedLink.absolute, path.join(oldKeg, 'bin', 'sdlc'));
        assert.equal(captured.targetKeg, oldKeg);
        assert.ok(captured.kegs.some(item => item.path === nodeKeg));
        assert.deepEqual(captured.installedVersions[0].versions, [
          ...(behavior.inactiveRetiredDependencies ? ['0.2.0'] : []),
          '0.3.0', ...(installedNew ? [candidatePkgVersion] : []),
        ].sort());
        await fs.access(path.join(captured.kegs[0].backup, 'bin', 'sdlc'));
      }
      if (args[0] === 'install' || args[0] === 'upgrade') {
        if (args[0] === 'upgrade' && installedNew) throw new Error('Will not overwrite the retained candidate keg');
        if (installedNew || behavior.skipCandidateInstall) return { stdout: 'Candidate already installed', stderr: '' };
        await fs.unlink(destination);
        if (behavior.removeOld || behavior.failInstall) await fs.rm(oldKeg, { recursive: true });
        if (behavior.modifyOld) await fs.appendFile(path.join(oldKeg, 'bin', 'sdlc'), 'unexpected mutation');
        if (behavior.removeDependency) await fs.rm(nodeKeg, { recursive: true });
        if (behavior.failInstall) throw new Error('brew install failed after cleaning the old keg');
        await keg(newKeg, candidateVersion, candidateRevision);
        installedNew = true;
        await fs.unlink(path.join(prefix, 'opt', 'ai-sdlc-framework'));
        await fs.symlink(newKeg, path.join(prefix, 'opt', 'ai-sdlc-framework'));
        if (behavior.foreignLink) await fs.writeFile(destination, 'unidentified replacement');
        else if (args[0] === 'upgrade') await fs.symlink(target(newKeg), destination);
      } else if (args[0] === 'tab') {
        if (!behavior.failRetention) {
          const file = path.join(nodeKeg, 'INSTALL_RECEIPT.json');
          const tab = JSON.parse(await fs.readFile(file, 'utf8'));
          tab.installed_on_request = true;
          await fs.writeFile(file, JSON.stringify(tab));
        }
      } else if (args[0] === 'link') {
        promotionAttempts++;
        if (behavior.failFirstPromotion && promotionAttempts === 1) throw new Error('first candidate promotion failed');
        await fs.symlink(target(newKeg), destination);
        await fs.unlink(path.join(prefix, 'opt', 'ai-sdlc-framework'));
        await fs.symlink(newKeg, path.join(prefix, 'opt', 'ai-sdlc-framework'));
        promoted = true;
      } else if (args[0] === 'unlink') {
        try { await fs.unlink(destination); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      } else if (args[0] === 'uninstall') {
        assert.equal(JSON.parse(await fs.readFile(path.join(nodeKeg, 'INSTALL_RECEIPT.json'), 'utf8')).installed_on_request, true);
        await fs.rm(oldKeg, { recursive: true });
        removed = true;
        if (behavior.removeRuntime) await fs.rm(nodeKeg, { recursive: true });
      }
      return { stdout: '', stderr: '' };
    }
    if (command === node) {
      await fs.access(node);
      if (args[0] === '-p') return json({
        execPath: node, major: Object.hasOwn(behavior, 'nodeMajor') ? behavior.nodeMajor : 22,
        platform: process.platform, arch: process.arch,
      });
      const action = copiedCliArguments(args)[1];
      if (action === 'hook' || action === 'gate') {
        if (removed && behavior.failPostRemovalHook) throw new Error('hook failed after channel removal');
        if (promoted && behavior.failPostPromotionHook) throw new Error('hook failed after link promotion');
        return json(await copiedHookResponse(home, args, options.input));
      }
      if (action === 'install') { await writeHooks(); return json({ installed: true }); }
      if (action === 'doctor') return json({
        installed: true, home, frameworkVersion: candidateVersion,
        findings: promoted && behavior.failPostPromotionDoctor ? ['post-promotion doctor failed'] : [],
      });
    }
    if (command === path.join(newKeg, 'bin', 'sdlc')) {
      if (args[0] === 'install') { await writeHooks(); return json({ installed: true }); }
      if (args[0] === 'doctor') return json({
        installed: true, home, frameworkVersion: candidateVersion,
        findings: behavior.failDoctor ? ['failed doctor'] : [],
      });
    }
    throw new Error(`Unexpected invocation: ${command} ${args}`);
  };
  return { root, prefix, cellar, oldKeg, inactiveKeg, obsoleteNodeKeg, newKeg, nodeKeg, historicalNodeKeg, node, destination,
    candidateVersion, candidateRevision, candidatePkgVersion,
    home, sourceRoot, formula, run, calls, target, captured: () => captured,
    options: { brew: 'fake-brew', formula, home, sourceRoot, run,
      environment: { ...process.env, HOMEBREW_NO_INSTALL_CLEANUP: '0' } } };
}

test('T-51 switching verifies retained old kegs and runs copied hooks/doctor after promotion', nativeMac, async t => {
  const input = await setup(t);
  const result = await switchToHomebrew(input.options);
  assert.equal(result.linked, true);
  assert.equal(await fs.readlink(input.destination), input.target(input.newKeg));
  assert.equal(await fs.readFile(path.join(input.oldKeg, 'bin', 'sdlc'), 'utf8'), 'old or new 0.3.0\n');
  assert.equal(await fs.readFile(input.node, 'utf8'), 'native node fixture\n');
  const state = JSON.parse(await fs.readFile(result.stateFile, 'utf8'));
  assert.equal(state.phase, 'complete');
  assert.equal(state.previousKeg, input.oldKeg);
  assert.equal(state.retentionVerifiedBeforePromotion, true);
  assert.equal(result.postSwitchVerified, true);
  assert.equal(result.oldPackageCleanupAllowed, true);
  const promotedIndex = input.calls.findIndex(call => call.args[0] === 'link');
  const postPromotion = input.calls.slice(promotedIndex + 1);
  assert.ok(postPromotion.some(call => call.command === input.node && call.args[1] === 'hook'));
  assert.ok(postPromotion.some(call => call.command === input.node && call.args[1] === 'doctor'));
  assert.ok(!postPromotion.some(call => call.command.startsWith(input.oldKeg)));
  assert.ok(!input.calls.some(call => ['uninstall', 'cleanup'].includes(call.args[0])));
});

test('T-51 promotion rollback then retry activates the intended candidate despite old opt and install no-op', nativeMac, async t => {
  for (const version of [{}, { candidateVersion: '0.3.0', candidateRevision: 1 }, { upgradePackage: true }]) {
    const input = await setup(t, { ...version, failFirstPromotion: true });
    const options = { ...input.options, upgradePackage: version.upgradePackage === true };
    await assert.rejects(switchToHomebrew(options), /first candidate promotion failed/u);
    await fs.access(path.join(input.newKeg, 'INSTALL_RECEIPT.json'));
    assert.equal(await fs.realpath(path.join(input.prefix, 'opt', 'ai-sdlc-framework')), input.oldKeg);
    assert.equal(await fs.readlink(input.destination), input.target(input.oldKeg));
    const retry = await switchToHomebrew(options);
    assert.equal(retry.launcher, path.join(input.newKeg, 'bin', 'sdlc'));
    assert.equal(retry.frameworkVersion, input.candidateVersion);
    assert.equal(retry.candidateVersion, input.candidatePkgVersion);
    assert.equal(await fs.realpath(path.join(input.prefix, 'opt', 'ai-sdlc-framework')), input.newKeg);
    assert.equal(await fs.readlink(input.destination), input.target(input.newKeg));
    const record = JSON.parse(await fs.readFile(retry.stateFile, 'utf8'));
    assert.equal(record.requestedCandidate.revision, input.candidateRevision);
    assert.equal(record.requestedCandidate.keg, input.newKeg);
    assert.ok(record.kegs.some(keg => keg.path === input.newKeg));
    assert.equal(input.calls.filter(call => call.command === 'fake-brew' && call.args[0] === 'upgrade').length,
      options.upgradePackage ? 1 : 0);
  }
});

test('T-51 forward and reverse switching survive retired receipt dependency versions after cleanup', nativeMac, async t => {
  for (const direction of [switchToHomebrew, switchFromHomebrew]) {
    const input = await setup(t, { recordedNodeVersion: '22.22.0' });
    await assert.rejects(fs.access(input.historicalNodeKeg), { code: 'ENOENT' });
    const result = await direction(input.options);
    assert.equal(result.postSwitchVerified, true);
    const record = JSON.parse(await fs.readFile(result.stateFile, 'utf8'));
    const old = record.kegs.find(keg => keg.path === input.oldKeg);
    assert.equal(old.receipt.runtime_dependencies[0].pkg_version, '22.22.0');
    assert.deepEqual(old.dependencies[0], {
      fullName: 'node@22', recordedVersion: '22.22.0', historicalKeg: input.historicalNodeKeg,
      historicalPresent: false, requiredLive: true, currentKeg: input.nodeKeg,
    });
    assert.ok(record.kegs.some(keg => keg.path === input.nodeKeg));
    assert.ok(!record.kegs.some(keg => keg.path === input.historicalNodeKeg));
    await fs.access(input.node);
  }
});

test('T-51 current dependency and still-present historical keg are both captured', nativeMac, async t => {
  const input = await setup(t, { recordedNodeVersion: '22.22.0', keepHistoricalDependency: true });
  const result = await switchToHomebrew(input.options);
  const record = JSON.parse(await fs.readFile(result.stateFile, 'utf8'));
  assert.ok(record.kegs.some(keg => keg.path === input.nodeKeg));
  assert.ok(record.kegs.some(keg => keg.path === input.historicalNodeKeg));
  assert.equal(record.kegs.find(keg => keg.path === input.oldKeg).dependencies[0].historicalPresent, true);
});

test('T-51 missing requested candidate never falls back to the old opt keg', nativeMac, async t => {
  const input = await setup(t, { skipCandidateInstall: true });
  await assert.rejects(switchToHomebrew(input.options), error => {
    assert.equal(error.code, 'HOMEBREW_SWITCH_FAILED');
    assert.equal(error.cause.code, 'ENOENT');
    return true;
  });
  assert.ok(!input.calls.some(call => call.args[0] === 'link'));
  assert.ok(!input.calls.some(call => [input.oldKeg, input.newKeg].some(keg => call.command.startsWith(keg))));
  assert.equal(await fs.readlink(input.destination), input.target(input.oldKeg));
});

test('T-51 an unresolved current dependency still fails even when its historical keg exists', nativeMac, async t => {
  for (const direction of [switchToHomebrew, switchFromHomebrew]) {
    const input = await setup(t, { recordedNodeVersion: '22.22.0', keepHistoricalDependency: true });
    await fs.unlink(path.join(input.prefix, 'opt', 'node@22'));
    await assert.rejects(direction(input.options), { code: 'ENOENT' });
    assert.ok(!input.calls.some(call => ['install', 'tab', 'uninstall'].includes(call.args[0])));
    await fs.access(input.historicalNodeKeg);
  }
});

test('T-51 inactive framework and transitive historical receipts do not require retired ICU providers', nativeMac, async t => {
  for (const direction of [switchToHomebrew, switchFromHomebrew]) {
    const input = await setup(t, { inactiveRetiredDependencies: true });
    const result = await direction(input.options);
    assert.equal(result.postSwitchVerified, true);
    const record = JSON.parse(await fs.readFile(result.stateFile, 'utf8'));
    const inactive = record.kegs.find(keg => keg.path === input.inactiveKeg);
    const obsoleteNode = record.kegs.find(keg => keg.path === input.obsoleteNodeKeg);
    assert.equal(inactive.role, 'historical');
    assert.equal(obsoleteNode.role, 'historical');
    assert.equal(record.kegs.find(keg => keg.path === input.oldKeg).role, 'live');
    assert.equal(record.kegs.find(keg => keg.path === input.nodeKeg).role, 'live');
    for (const provenance of [
      inactive.dependencies.find(dependency => dependency.fullName === 'icu4c@71'),
      obsoleteNode.dependencies.find(dependency => dependency.fullName === 'icu4c@70'),
    ]) {
      assert.equal(provenance.requiredLive, false);
      assert.equal(provenance.historicalPresent, false);
      assert.equal(Object.hasOwn(provenance, 'currentKeg'), false);
    }
    assert.ok(!input.calls.some(call => call.args[0] === '--prefix' && /^icu4c@/u.test(call.args[1])));
    assert.equal(inactive.receipt.runtime_dependencies[1].full_name, 'icu4c@71');
    assert.equal(obsoleteNode.receipt.runtime_dependencies[0].full_name, 'icu4c@70');
  }
});

test('T-51 missing live transitive ICU providers still prevent both switch directions', nativeMac, async t => {
  for (const direction of [switchToHomebrew, switchFromHomebrew]) {
    const input = await setup(t, { inactiveRetiredDependencies: true });
    const receiptFile = path.join(input.nodeKeg, 'INSTALL_RECEIPT.json');
    const receipt = JSON.parse(await fs.readFile(receiptFile, 'utf8'));
    receipt.runtime_dependencies = [{ full_name: 'icu4c@78', pkg_version: '78.3' }];
    await fs.writeFile(receiptFile, JSON.stringify(receipt));
    await assert.rejects(direction(input.options), { code: 'ENOENT' });
    assert.ok(!input.calls.some(call => ['install', 'tab', 'uninstall'].includes(call.args[0])));
  }
});

test('T-51 stale transitive inventory in a live receipt is provenance, not the current direct graph', nativeMac, async t => {
  for (const direction of [switchToHomebrew, switchFromHomebrew]) {
    const input = await setup(t);
    const receiptFile = path.join(input.oldKeg, 'INSTALL_RECEIPT.json');
    const receipt = JSON.parse(await fs.readFile(receiptFile, 'utf8'));
    receipt.runtime_dependencies[0].declared_directly = true;
    receipt.runtime_dependencies.push({ full_name: 'icu4c@70', pkg_version: '70.1', declared_directly: false });
    await fs.writeFile(receiptFile, JSON.stringify(receipt));
    const result = await direction(input.options);
    const record = JSON.parse(await fs.readFile(result.stateFile, 'utf8'));
    const provenance = record.kegs.find(keg => keg.path === input.oldKeg).dependencies[1];
    assert.equal(provenance.requiredLive, false);
    assert.equal(provenance.historicalPresent, false);
    assert.ok(!input.calls.some(call => call.args[0] === '--prefix' && call.args[1] === 'icu4c@70'));
  }
});

test('T-51 unsupported old-keg retention aborts before framework mutation or promotion', nativeMac, async t => {
  for (const behavior of [{ removeOld: true }, { removeDependency: true }, { modifyOld: true }]) {
    const input = await setup(t, behavior);
    await assert.rejects(switchToHomebrew(input.options), error => {
      assert.equal(error.cause.code, 'HOMEBREW_RETENTION_UNSUPPORTED');
      return true;
    });
    assert.ok(!input.calls.some(call => call.args[0] === 'link'));
    assert.ok(!input.calls.some(call => call.command === path.join(input.newKeg, 'bin', 'sdlc')));
    if (!behavior.modifyOld) {
      assert.equal(await fs.readlink(input.destination), input.target(input.oldKeg));
      assert.equal(await fs.readFile(input.node, 'utf8'), 'native node fixture\n');
    }
  }
});

test('T-51 failed post-promotion hooks or doctor roll back without old-keg cleanup', nativeMac, async t => {
  for (const behavior of [{ failPostPromotionHook: true }, { failPostPromotionDoctor: true }]) {
    const input = await setup(t, behavior);
    await assert.rejects(switchToHomebrew(input.options), error => {
      assert.equal(error.code, 'HOMEBREW_SWITCH_FAILED');
      return true;
    });
    assert.equal(await fs.readlink(input.destination), input.target(input.oldKeg));
    assert.ok(!input.calls.some(call => ['uninstall', 'cleanup'].includes(call.args[0])));
    await fs.access(path.join(input.oldKeg, 'bin', 'sdlc'));
  }
});

test('T-51 install and doctor failure restore the exact pre-install keg and link, not the new version', nativeMac, async t => {
  for (const behavior of [{ failInstall: true, removeDependency: true }, { failDoctor: true }]) {
    const input = await setup(t, behavior);
    await assert.rejects(switchToHomebrew(input.options), error => {
      assert.equal(error.code, 'HOMEBREW_SWITCH_FAILED');
      return true;
    });
    assert.equal(await fs.readlink(input.destination), input.target(input.oldKeg));
    assert.equal(await fs.readlink(path.join(input.prefix, 'opt', 'ai-sdlc-framework')), input.oldKeg);
    await fs.access(input.node);
    await fs.access(path.join(input.oldKeg, 'INSTALL_RECEIPT.json'));
  }
});

test('T-51 a racing unidentified link is retained and incomplete rollback is reported', nativeMac, async t => {
  const input = await setup(t, { foreignLink: true });
  await assert.rejects(switchToHomebrew(input.options), error => {
    assert.equal(error.code, 'HOMEBREW_SWITCH_INCOMPLETE');
    return true;
  });
  assert.equal(await fs.readFile(input.destination, 'utf8'), 'unidentified replacement');
  await fs.access(path.join(input.oldKeg, 'bin', 'sdlc'));
  await fs.access(path.join(input.captured().kegs[0].backup, 'bin', 'sdlc'));
});

test('T-51 reverse switching retains dependency-only Node before removal and executes hooks afterward', nativeMac, async t => {
  const input = await setup(t);
  const result = await switchFromHomebrew(input.options);
  assert.equal(result.oldPackageRemoved, true);
  assert.equal(result.postSwitchVerified, true);
  assert.equal(JSON.parse(await fs.readFile(path.join(input.nodeKeg, 'INSTALL_RECEIPT.json'), 'utf8')).installed_on_request, true);
  const removedIndex = input.calls.findIndex(call => call.args[0] === 'uninstall');
  assert.ok(input.calls.findIndex(call => call.args[0] === 'tab') < removedIndex);
  assert.ok(input.calls.slice(removedIndex + 1).some(call => call.command === input.node && call.args[1] === 'doctor'));
  assert.ok(input.calls.slice(removedIndex + 1).some(call => call.command === input.node && call.args[1] === 'hook'));
});

test('T-51 failed runtime retention prevents old-package removal', nativeMac, async t => {
  const input = await setup(t, { failRetention: true });
  await assert.rejects(switchFromHomebrew(input.options), /did not retain Node/u);
  assert.ok(!input.calls.some(call => call.args[0] === 'uninstall'));
  assert.equal(await fs.readlink(input.destination), input.target(input.oldKeg));
});

test('T-51 missing runtime or failing hooks after removal restores the captured old channel', nativeMac, async t => {
  for (const behavior of [{ removeRuntime: true }, { failPostRemovalHook: true }]) {
    const input = await setup(t, behavior);
    await assert.rejects(switchFromHomebrew(input.options), error => {
      assert.equal(error.code, 'HOMEBREW_SWITCH_FAILED');
      return true;
    });
    await fs.access(input.node);
    assert.equal(await fs.readlink(input.destination), input.target(input.oldKeg));
    assert.equal(await fs.readFile(path.join(input.oldKeg, 'bin', 'sdlc'), 'utf8'), 'old or new 0.3.0\n');
  }
});

test('T-51 incompatible or malformed Node probes fail before retention or package removal', nativeMac, async t => {
  for (const nodeMajor of [21, null, '22']) {
    const input = await setup(t, { nodeMajor });
    await assert.rejects(switchFromHomebrew(input.options), /native Node 22/u);
    assert.ok(!input.calls.some(call => ['tab', 'uninstall'].includes(call.args[0])));
    assert.equal(await fs.readlink(input.destination), input.target(input.oldKeg));
  }
});

test('T-51 unidentified initial links and translated hosts fail before brew mutation', nativeMac, async t => {
  const unidentified = await setup(t);
  await fs.unlink(unidentified.destination);
  await fs.writeFile(unidentified.destination, 'not owned');
  await assert.rejects(switchToHomebrew(unidentified.options), /Unidentified sdlc/u);
  assert.ok(!unidentified.calls.some(call => call.args[0] === 'install'));
  assert.equal(await fs.readFile(unidentified.destination, 'utf8'), 'not owned');
  const translated = await setup(t, { translated: '1' });
  await assert.rejects(switchFromHomebrew(translated.options), /Rosetta/u);
  assert.ok(!translated.calls.some(call => ['install', 'tab', 'uninstall'].includes(call.args[0])));
});
