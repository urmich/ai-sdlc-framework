export const validationDeclarations = {
  "schemaVersion": 1,
  "surfaces": [
    {"coverage": "direct", "paths": ["scripts/validation-tools.mjs"]}
  ],
  "groups": [{
    "root": "T-51 owned boundary terminates descendant writers before return while an unrelated sibling survives",
    "minimumSlots": 4
  }],
  "applicability": [{
    "names": ["T-51 owned boundary terminates descendant writers before return while an unrelated sibling survives"],
    "platforms": ["linux-x64", "macos-arm64", "macos-x64"],
    "owner": "maintainer",
    "reason": "Real POSIX process-group disappearance requires the native kernel; controlled contracts also run on Windows.",
    "prerequisites": ["Native POSIX process groups and Node"]
  }]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { stopOwnedProcessGroup, processDiagnostic } from '../scripts/validation-tools.mjs';
import { boundaryPhaseDiagnostics } from './distribution-network-boundary.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const toolsModule = await fs.readFile(new URL('../scripts/validation-tools.mjs', import.meta.url), 'utf8');
const toolsSource = toolsModule.slice(toolsModule.indexOf('export function stopOwnedProcessGroup('))
  .split('export async function executeValidationCommand(')[0].replace(/^export /gmu, '');
const boundarySource = (await fs.readFile(new URL('./distribution-network-boundary.mjs', import.meta.url), 'utf8'))
  .replace(/^import .+;\r?$/gmu, '').replace(/^export /gmu, '');

function controlled(mode = 'absent', { automatic = false, broker = false, budgetError = false, budgetAbort = false } = {}) {
  let clock = 0;
  let present = mode !== 'absent';
  const timers = [];
  const children = [];
  const signals = [];
  const environments = [];
  const context = createContext({
    Buffer, assert, path, randomUUID, AbortController, promisify: () => () => {}, execFile() {},
    http: {}, https: {}, once() {}, console,
    fs: { constants: { X_OK: 1 }, access: async () => {}, mkdir: async () => {}, symlink: async () => {},
      realpath: async value => value.includes('npm') ? path.join('fixture', 'npm', 'bin', 'npm-cli.js') : value },
    process: { execPath: process.execPath, platform: 'darwin', arch: 'x64',
      env: broker ? { SDLC_TEST_BUDGET: 'private-endpoint' } : {},
      kill(pid, signal) {
        const owned = children.find(child => -child.pid === pid);
        assert.ok(owned, 'Only the original owned group may be addressed');
        signals.push(signal);
        if (signal === 'SIGTERM') {
          assert.equal(owned.exitCode, null);
          assert.equal(owned.signalCode, null);
          if (mode === 'denied') throw Object.assign(new Error('Denied'), { code: 'EPERM' });
          if (mode === 'signal-unverified') return false;
          if (mode !== 'root-open') {
            queueMicrotask(() => {
              owned.exitCode = mode === 'term-exit-zero' ? 0 : null;
              owned.signalCode = mode === 'term-exit-zero' ? null : 'SIGTERM';
              owned.stdout.end(); owned.stderr.end();
              owned.emit('close', owned.exitCode, owned.signalCode);
            });
          }
          return true;
        }
        assert.equal(signal, 0, 'No destructive signal after losing root ownership');
        if (mode === 'unknown') return false;
        if (!present) throw Object.assign(new Error('Absent'), { code: 'ESRCH' });
        return true;
      } },
    performance: { now: () => clock },
    delay: async milliseconds => {
      assert.equal(milliseconds, 10);
      clock += milliseconds;
      if (mode === 'drain' || mode === 'root-open' || mode === 'term-exit-zero') present = false;
    },
    setTimeout(callback, milliseconds) {
      const timer = { callback, milliseconds, active: true };
      timers.push(timer); return timer;
    },
    clearTimeout(timer) { if (timer) timer.active = false; },
    readTestBudget: async ({ signal } = {}) => {
      if (budgetAbort) return await new Promise((_, reject) => signal.addEventListener('abort',
        () => reject(Object.assign(new Error('Broker inspection aborted'), { code: 'BUDGET' })), { once: true }));
      if (budgetError) throw Object.assign(new Error('Broker unavailable'), { code: 'BUDGET' });
      return { capacity: 4, activeWorkers: 3, residentWorkers: 5,
        producers: 2, key: 'private-key', port: 12345 };
    },
    processDiagnostic: error => ({ code: error?.code ?? 'PROCESS_ERROR', message: String(error?.message ?? error).slice(0, 2000) }),
    spawn(command, args, options) {
      assert.equal(options.detached, true);
      assert.equal(options.shell, false);
      environments.push(options.env);
      const child = Object.assign(new EventEmitter(), { pid: 731900 + children.length,
        exitCode: null, signalCode: null, stdout: new PassThrough(), stderr: new PassThrough(),
        unref() { this.unreferenced = true; } });
      children.push(child);
      if (automatic) queueMicrotask(() => {
        child.stdout.end('{"platform":"darwin","arch":"x64","networkNamespace":null}\n');
        child.stderr.end('phase-marker\n');
        child.exitCode = 0; child.emit('close', 0, null);
      });
      return child;
    },
  });
  const api = runInContext(`${toolsSource}\n${boundarySource}\n({executeBoundaryCommand,createNetworkBoundary,deniedEnvironment,sampleBoundaryBudget});`, context);
  return { ...api, timers, children, signals, environments, clock: () => clock };
}

test('T-51 raw boundary preserves exact streams numeric exits errors and the fixed execution budget', async () => {
  for (const code of [0, 73]) {
    const h = controlled();
    const pending = h.executeBoundaryCommand('owned', []);
    const child = h.children[0];
    child.stdout.end(' \u0000raw stdout\r\nλ');
    child.stderr.end('raw stderr\r\n\t');
    child.exitCode = code; child.emit('close', code, null);
    let result;
    if (code) {
      await assert.rejects(pending, error => {
        result = error;
        assert.ok(error instanceof Error || error.name === 'Error');
        assert.equal(error.code, 73);
        assert.equal(error.signal, null);
        assert.equal(error.killed, false);
        return true;
      });
    } else result = await pending;
    assert.equal(result.stdout, ' \u0000raw stdout\r\nλ');
    assert.equal(result.stderr, 'raw stderr\r\n\t');
    assert.equal(h.timers[0].milliseconds, 15000);
    assert.ok(!h.signals.includes('SIGTERM'));
  }
  const h = controlled();
  const pending = h.executeBoundaryCommand('missing', []);
  const child = h.children[0];
  child.pid = undefined;
  const original = Object.assign(new Error('Missing command'), { code: 'ENOENT' });
  child.emit('error', original); child.emit('close', -2, null);
  await assert.rejects(pending, error => error === original && error.code === 'ENOENT' &&
    error.stdout === '' && error.stderr === '');
});

test('T-51 raw timeout and output overflow bound root close and fail closed on uncertain ownership', async () => {
  for (const mode of ['drain', 'term-exit-zero', 'persistent', 'denied', 'signal-unverified', 'unknown', 'root-open', 'lost-root', 'overflow', 'overflow-persistent']) {
    const h = controlled(mode === 'overflow' ? 'drain' : mode === 'overflow-persistent' ? 'persistent' : mode);
    const pending = h.executeBoundaryCommand('owned', []);
    const child = h.children[0];
    if (mode.startsWith('overflow')) child.stdout.write(Buffer.alloc(4 * 1024 * 1024 + 1, 120));
    else {
      if (mode === 'lost-root') {
        child.exitCode = 0; child.emit('close', 0, null);
      } else h.timers.find(timer => timer.milliseconds === 15000).callback();
    }
    await assert.rejects(pending, error => {
      if (mode.startsWith('overflow')) {
        assert.equal(error.code, 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER');
        assert.equal(Buffer.byteLength(error.stdout), 4 * 1024 * 1024);
      } else if (mode !== 'lost-root') assert.match(error.message, /^Command failed:/u);
      assert.equal(error.cleanup.survivorsVerified, ['drain', 'term-exit-zero', 'overflow'].includes(mode));
      if (mode === 'term-exit-zero') {
        assert.equal(error.code, 0);
        assert.equal(error.signal, null);
        assert.equal(error.killed, true);
      }
      if (!error.cleanup.survivorsVerified) {
        assert.equal(error.cleanup.outcome, 'uncertain');
        assert.ok(['STOP_TIMEOUT', 'EPERM', 'STOP_UNVERIFIED'].includes(error.cleanup.error.code));
      }
      return true;
    });
    assert.ok(h.clock() <= 1000, 'Root close and group disappearance share one bounded settlement window');
    assert.equal(h.signals.filter(signal => signal === 'SIGTERM').length, mode === 'lost-root' ? 0 : 1);
    if (!['drain', 'term-exit-zero', 'overflow'].includes(mode)) assert.equal(child.unreferenced, true);
  }
  const h = controlled('persistent', { automatic: true });
  const lifetime = { cleanupSafe: true };
  await assert.rejects(h.createNetworkBoundary({ directory: 'owned', environment: { npm_execpath: 'fixture-npm' }, lifetime }));
  assert.equal(lifetime.cleanupSafe, false, 'A failed setup probe also prevents recursive fixture cleanup');
});

test('T-51 opt-in trace identifiers and broker counts never broaden the denied child environment', async () => {
  const traceId = randomUUID();
  const marker = `sdlc-install-v1 trace=${traceId} pid=123 ppid=122 seq=1 wall=1700000000000 mono=12.5 cpu_user=4 cpu_system=3 phase=source event=begin count=0 elapsed_us=0`;
  assert.deepEqual(boundaryPhaseDiagnostics(`${marker}\nprivate-output\n${marker} path=private\n`, traceId),
    { records: [marker], omitted: 0 });
  assert.deepEqual(boundaryPhaseDiagnostics(marker, randomUUID()), { records: [], omitted: 0 });
  assert.equal(boundaryPhaseDiagnostics(`${marker}\n`.repeat(257), traceId).omitted, 1);
  for (const trace of [false, true]) {
    const h = controlled('absent', { automatic: true, broker: trace });
    const environment = { HOME: 'isolated', PATH: 'unrestricted', npm_execpath: 'fixture-npm',
      NODE_OPTIONS: '--require private', SDLC_INSTALL_TRACE_ID: 'injected', SDLC_TEST_BUDGET: 'private-endpoint' };
    const boundary = await h.createNetworkBoundary({ directory: 'owned', environment, trace });
    const first = await boundary.execute('owned', [], { env: { NODE_OPTIONS: 'injected' } });
    const second = await boundary.execute('owned', []);
    const baseKeys = ['HOME', 'PATH', 'SDLC_NODE'];
    assert.deepEqual(Object.keys(boundary.environment).sort(), baseKeys);
    for (const env of h.environments) {
      assert.deepEqual(Object.keys(env).sort(), trace ? [...baseKeys, 'SDLC_INSTALL_TRACE_ID'].sort() : baseKeys);
      assert.equal(env.NODE_OPTIONS, undefined);
      assert.equal(env.SDLC_TEST_BUDGET, undefined);
      if (trace) assert.match(env.SDLC_INSTALL_TRACE_ID, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u);
    }
    if (trace) {
      assert.notEqual(first.boundaryDiagnostics.traceId, second.boundaryDiagnostics.traceId);
      const budget = first.boundaryDiagnostics.budget;
      assert.equal(budget.status, 'complete');
      assert.equal(budget.samples.length, 1);
      assert.deepEqual(Object.keys(budget.samples[0]).sort(),
        ['observedAt', 'capacity', 'activeWorkers', 'residentWorkers', 'producers'].sort());
      assert.ok(!JSON.stringify(budget).includes('private'));
    } else assert.equal(first.boundaryDiagnostics, undefined);
  }
  for (const broker of [false, true]) {
    const h = controlled('absent', { automatic: true, broker, budgetError: true });
    const boundary = await h.createNetworkBoundary({ directory: 'owned', environment: { npm_execpath: 'fixture-npm' }, trace: true });
    const result = await boundary.execute('owned', []);
    assert.equal(result.boundaryDiagnostics.budget.status, broker ? 'incomplete' : 'not-available');
    assert.equal(result.boundaryDiagnostics.budget.samples.length, 0);
    if (broker) assert.equal(result.boundaryDiagnostics.budget.error.code, 'BUDGET');
  }
  const h = controlled('absent', { broker: true, budgetAbort: true });
  const primary = new Error('Original boundary timeout');
  const pending = h.sampleBoundaryBudget(async () => { throw primary; });
  const rejected = assert.rejects(pending, error => {
    assert.equal(error, primary, 'An aborted broker observation cannot replace the primary boundary timeout');
    assert.equal(error.boundaryBudget.status, 'incomplete');
    assert.equal(error.boundaryBudget.error.code, 'BUDGET');
    return true;
  });
  h.timers.find(timer => timer.milliseconds === 250).callback();
  await rejected;
});

test('T-51 owned boundary terminates descendant writers before return while an unrelated sibling survives',
  { skip: process.platform === 'win32', timeout: 10000 }, async t => {
    const directory = await fs.mkdtemp(path.join(root, '.test-data', 'boundary-writer-'));
    let safe = false;
    t.after(async () => { if (safe) await fs.rm(directory, { recursive: true, force: true }); });
    const writer = path.join(directory, 'writer.mjs');
    const ready = path.join(directory, 'ready');
    const ticks = path.join(directory, 'ticks');
    await fs.writeFile(writer, `import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
if(process.argv[2]==='root'){
  process.on('SIGTERM',()=>{});
  spawnSync(process.execPath,[import.meta.filename,'child'],{stdio:'inherit'});
  process.exit(0);
}else{
  fs.writeFileSync(${JSON.stringify(ready)},String(process.pid));
  setInterval(()=>fs.appendFileSync(${JSON.stringify(ticks)},'x'),5);
}`);
    let child;
    let expire;
    const context = createContext({ Buffer, process, assert, path, fs, randomUUID, stopOwnedProcessGroup,
      processDiagnostic, promisify: () => () => {}, execFile() {}, http: {}, https: {}, once() {},
      setTimeout(callback, milliseconds) {
        assert.equal(milliseconds, 15000);
        expire = callback;
        return {};
      },
      clearTimeout() {},
      spawn(command, args, options) { child = spawn(command, args, options); return child; },
    });
    const execute = runInContext(`${boundarySource}\nexecuteBoundaryCommand;`, context);
    const pending = execute(process.execPath, [writer, 'root']);
    // Observe rejection immediately even if a readiness assertion subsequently fails.
    pending.catch(() => {});
    const sibling = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
    const closed = new Promise(resolve => child.once('close', resolve));
    const siblingClosed = new Promise(resolve => sibling.once('close', resolve));
    try {
      const deadline = performance.now() + 4000;
      while (!(await fs.stat(ready).catch(error => { if (error.code !== 'ENOENT') throw error; return null; }))) {
        assert.ok(performance.now() < deadline, 'Descendant writer must become ready');
        await delay(10);
      }
      expire();
      await assert.rejects(pending, error => {
        t.diagnostic(JSON.stringify({ test: 'T-51', phase: 'owned-boundary-settlement',
          pid: child.pid, exitCode: error.code, signal: error.signal, killed: error.killed,
          cleanupOutcome: error.cleanup.outcome, signalSent: error.cleanup.signalSent,
          rootExitObserved: error.cleanup.rootExitObserved,
          survivorsVerified: error.cleanup.survivorsVerified, cleanupCode: error.cleanup.error?.code }));
        assert.equal(error.cleanup.survivorsVerified, true);
        // The fixture reaps its writer and exits zero; the expired watchdog still rejects.
        assert.equal(error.code, 0);
        assert.equal(error.killed, true);
        assert.equal(error.signal, null);
        return true;
      });
      assert.throws(() => process.kill(-child.pid, 0), { code: 'ESRCH' });
      assert.equal(process.kill(sibling.pid, 0), true);
      const before = await fs.readFile(ticks).catch(error => { if (error.code !== 'ENOENT') throw error; return Buffer.alloc(0); });
      await delay(20);
      assert.deepEqual(await fs.readFile(ticks).catch(error => { if (error.code !== 'ENOENT') throw error; return Buffer.alloc(0); }), before);
      safe = true;
    } finally {
      sibling.kill('SIGTERM');
      await siblingClosed;
      if (child.exitCode === null && child.signalCode === null) await stopOwnedProcessGroup(child, closed, {}).then(() => { safe = true; });
      await pending.catch(() => {});
    }
  });
