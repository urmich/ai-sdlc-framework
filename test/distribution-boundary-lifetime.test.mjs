export const validationDeclarations = {
  "schemaVersion": 1,
  "surfaces": [
    {"coverage": "direct", "paths": ["scripts/validation-tools.mjs"]}
  ],
  "groups": [{
    "root": "T-51 owned boundary terminates descendant writers before return while an unrelated sibling survives",
    "minimumSlots": 4
  }, {
    "root": "TOOL02 Windows validation settlement bounds exited roots and failed or stalled tree termination",
    "minimumSlots": 5,
    "exclusiveResources": []
  }, {
    "root": "TOOL02 owned writer provenance is invisible until its complete publication",
    "minimumSlots": 2,
    "exclusiveResources": []
  }],
  "applicability": [{
    "names": ["TOOL02 owned writer provenance is invisible until its complete publication"],
    "platforms": ["linux-x64", "windows-x64", "macos-arm64", "macos-x64"],
    "owner": "runner-resource-contract",
    "reason": "PR-only atomic provenance regression uses an isolated stock Node writer and an owned pre-write barrier.",
    "prerequisites": ["Node and two aggregate worker slots"]
  }, {
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
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { stopOwnedProcessGroup, processDiagnostic } from '../scripts/validation-tools.mjs';
import { boundaryPhaseDiagnostics } from './distribution-network-boundary.mjs';
import { sanitizeExecutionPayload } from '../src/validation-evidence.mjs';
import { digest, SdlcError } from '../src/core.mjs';
import { atomicWrite } from '../src/files.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const toolsModule = await fs.readFile(new URL('../scripts/validation-tools.mjs', import.meta.url), 'utf8');
const toolsSource = toolsModule.slice(toolsModule.indexOf('export function stopOwnedProcessGroup('))
  .split('export async function executeValidationCommand(')[0].replace(/^export /gmu, '');
const boundarySource = (await fs.readFile(new URL('./distribution-network-boundary.mjs', import.meta.url), 'utf8'))
  .replace(/^import .+;\r?$/gmu, '').replace(/^export /gmu, '');

test('TOOL02 owned writer provenance is invisible until its complete publication', { timeout: 15000 }, async t => {
  const pauseClock = { schedule: setTimeout, cancel: clearTimeout };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const directory = await fs.mkdtemp(path.join(root, '.test-data', 'writer-publication-'));
  const token = randomUUID();
  const publication = path.join(directory, `${token}.writer.json`);
  const pausedPath = path.join(directory, `${token}.paused.json`);
  const preload = path.join(directory, 'pause-write.mjs');
  await fs.writeFile(preload, `
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const write = fs.writeFileSync;
fs.writeFileSync = function(file, bytes, options) {
  if (typeof file !== 'string' || !file.startsWith(${JSON.stringify(publication)})) {
    return write(file, bytes, options);
  }
  const flag = typeof options === 'object' ? options.flag ?? 'w' : 'w';
  const descriptor = fs.openSync(file, flag);
  try {
    write(${JSON.stringify(pausedPath)}, JSON.stringify({ pid: process.pid, file, flag }), { flag: 'wx' });
    process.send({ paused: true });
    const release = Buffer.alloc(1);
    if (fs.readSync(0, release, 0, 1, null) !== 1) throw new Error('Owned write barrier was not released');
    return write(descriptor, bytes, options);
  } finally { fs.closeSync(descriptor); }
};
syncBuiltinESMExports();
`);
  const child = spawn(process.execPath, ['--import', pathToFileURL(preload).href,
    path.join(root, 'test', 'owned-process-fixture.mjs'), '--owned-pipe-fixture', 'writer', directory, token],
  { shell: false, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
  const outputClosed = Promise.all([child.stdout, child.stderr].map(stream =>
    new Promise(resolve => stream.once('close', resolve))));
  const closed = Promise.all([
    new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal }))), outputClosed,
  ]).then(([result]) => result);
  const message = key => new Promise((resolve, reject) => {
    const schedule = key === 'paused' ? pauseClock.schedule : setTimeout;
    const cancel = key === 'paused' ? pauseClock.cancel : clearTimeout;
    const timer = schedule(() => finish(new Error(`Owned writer did not announce ${key}`)), 5000);
    const received = value => { if (value[key]) finish(null, value); };
    const exited = () => finish(new Error(`Owned writer exited before ${key}`));
    const finish = (error, value) => {
      cancel(timer);
      child.off('message', received);
      child.off('error', finish);
      child.off('close', exited);
      if (error) reject(error); else resolve(value);
    };
    child.on('message', received);
    child.once('error', finish);
    child.once('close', exited);
    if (child.exitCode !== null || child.signalCode !== null) exited();
  });
  const paused = message('paused');
  let ready;
  const writerErrors = [];
  let writerReady = false;
  const expectReady = () => {
    if (!ready) {
      ready = message('ready');
      ready.then(() => { writerReady = true; }, () => {});
      ready.catch(() => {});
    }
    return ready;
  };
  child.stderr.on('data', bytes => writerErrors.push(Buffer.from(bytes)));
  child.stdout.resume();
  child.stderr.resume();
  child.stdin.on('error', () => {});
  try {
    t.mock.timers.tick(5001);
    await paused;
    const barrier = JSON.parse(await fs.readFile(pausedPath, 'utf8'));
    assert.equal(barrier.pid, child.pid);
    assert.equal(child.exitCode, null, 'The owned writer is blocked after opening its publication file');
    assert.equal(child.signalCode, null);
    await assert.rejects(fs.stat(publication), { code: 'ENOENT' },
      'Readers must not see the final provenance name before the writer finishes its bytes');
    assert.notEqual(barrier.file, publication);
    assert.equal(path.dirname(barrier.file), directory);
    assert.equal(barrier.flag, 'wx', 'Only a unique owned pending file may be opened for publication');
    assert.equal((await fs.stat(barrier.file)).size, 0);
    t.mock.timers.tick(5001);
    t.mock.timers.reset();
    const released = expectReady();
    child.stdin.end(Buffer.from([1]));
    await released;
    assert.deepEqual(JSON.parse(await fs.readFile(publication, 'utf8')),
      { pid: child.pid, parent: process.pid, token });
    await assert.rejects(fs.stat(barrier.file), { code: 'ENOENT' });
  } finally {
    t.mock.timers.reset();
    const released = expectReady();
    if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end(Buffer.from([1]));
    await fs.writeFile(path.join(directory, `${token}.release`), '');
    await released.catch(() => {});
    if (child.connected) child.disconnect();
    let timer;
    const result = await Promise.race([closed, new Promise(resolve => {
      timer = setTimeout(() => resolve(null), 5000);
    })]).finally(() => clearTimeout(timer));
    if (!result && child.exitCode === null && child.signalCode === null) child.kill();
    const drained = result ?? await closed;
    const originalStderr = Buffer.concat(writerErrors);
    t.diagnostic(JSON.stringify({ kind: 'owned-publication-writer-outcome',
      pid: child.pid, writerReady, ...drained,
      originalStderr: { sha256: digest(originalStderr), bytes: originalStderr.length },
      ipcChannelClosed: originalStderr.includes(Buffer.from('ERR_IPC_CHANNEL_CLOSED')) }));
    assert.deepEqual(drained, { code: 0, signal: null }, 'The exact owned leaf writer must be reaped');
    t.diagnostic(JSON.stringify({ kind: 'owned-publication-writer-drained', pid: child.pid, ...drained }));
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('TOOL02 Windows validation settlement bounds exited roots and failed or stalled tree termination',
  { timeout: 20000 }, async t => {
    const failures = [];
    const phases = new Map();
    const completedModes = [];
    const ready = { natural: Promise.withResolvers(), 'root-exit': Promise.withResolvers() };
    t.after(() => t.diagnostic(JSON.stringify({
      kind: 'owned-settlement-phases', phases: Object.fromEntries(phases),
    })));
    const modes = ['natural', 'root-exit', 'failed', 'stalled', 'reported-stopped', 'retention-failed'];
    const runMode = async mode => {
      const modeStarted = performance.now();
      const phase = name => phases.set(mode, { phase: name, elapsedMs: performance.now() - modeStarted });
      phase('directory');
      const directory = await fs.mkdtemp(path.join(root, '.test-data', 'tool02-'));
      const token = randomUUID();
      const cancellation = new AbortController();
      const lifetime = { cleanupSafe: true, unsettledCommands: [] };
      const retentionFailure = Object.assign(new Error('Owned final report persistence failed'), { code: 'OWNED_PERSISTENCE' });
      let child;
      let closed;
      let killer;
      let identity;
      let killerSignals = 0;
      let launches = 0;
      const context = createContext({
        Buffer, TextDecoder, path, performance, setTimeout, clearTimeout, delay, console,
        createHash, digest, SdlcError, sanitizeExecutionPayload, root,
        atomicWrite: async (file, bytes) => {
          if (mode === 'retention-failed' && JSON.parse(bytes).checkpoint.phase === 'finished') throw retentionFailure;
          return atomicWrite(file, bytes);
        },
        open: fs.open, realpath: fs.realpath, processDiagnostic,
        process: { platform: 'win32', arch: process.arch, version: process.version,
          env: { SystemRoot: process.env.SystemRoot ?? 'owned-windows' } },
        spawn(command, args, options) {
          if (command.endsWith('taskkill.exe')) {
            launches++;
            assert.equal(child.exitCode, null, 'No PID-tree request after losing the live root');
            assert.equal(child.signalCode, null);
            killer = Object.assign(new EventEmitter(), { pid: 990001, exitCode: null,
              signalCode: null, stderr: new PassThrough(),
              kill() { killerSignals++; this.signalCode = 'SIGTERM'; this.emit('close', null, 'SIGTERM'); return true; },
              unref() {} });
            if (['failed', 'retention-failed', 'reported-stopped'].includes(mode)) queueMicrotask(() => {
              killer.exitCode = mode === 'reported-stopped' ? 0 : 1;
              killer.stderr.end('controlled termination denied');
              killer.emit('close', killer.exitCode, null);
            });
            return killer;
          }
          child = spawn(command, args, options);
          closed = new Promise(resolve => child.once('close', resolve));
          return child;
        },
      });
      const execute = runInContext(`${toolsModule.replace(/^import .+;\r?$/gmu, '')
        .replace(/^const root = .+;\r?$/gmu, '').replace(/^export /gmu, '')}\nexecuteValidationCommand;`, context);
      const pending = execute({ name: 'owned', command: process.execPath,
        args: [path.join(root, 'test', 'owned-process-fixture.mjs'), '--owned-pipe-fixture',
          mode === 'root-exit' ? mode : 'root-open', directory, token],
        cwd: root, outputDir: directory, environment: process.env, signal: cancellation.signal, lifetime });
      pending.catch(() => {});
      const observed = pending.then(report => ({ report }), error => ({ error }));
      try {
        phase('writer-provenance');
        const deadline = performance.now() + 5000;
        while (!identity) {
          identity = await fs.readFile(path.join(directory, `${token}.writer.json`), 'utf8')
            .then(JSON.parse, error => { if (error.code !== 'ENOENT') throw error; return null; });
          assert.ok(performance.now() < deadline, 'Owned descendant must publish provenance');
          if (!identity) await delay(10);
        }
        assert.equal(identity.token, token);
        assert.equal(identity.parent, child.pid);
        if (Object.hasOwn(ready, mode)) {
          ready[mode].resolve(identity);
          let timer;
          phase('peer-provenance');
          const peer = await Promise.race([
            ready[mode === 'natural' ? 'root-exit' : 'natural'].promise,
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(new Error(
                'Independent owned settlement scenarios must become ready together')), 5000);
            }),
          ]).finally(() => clearTimeout(timer));
          assert.notEqual(peer.pid, identity.pid);
          assert.notEqual(peer.token, identity.token);
        }
        if (mode === 'natural') {
          phase('natural-settlement');
          await fs.writeFile(path.join(directory, `${token}.release`), '');
          const report = await pending;
          assert.equal(report.complete, true);
          assert.equal(report.exitCode, 23);
          assert.equal(report.stdout, 'owned-natural-tail');
          assert.equal(launches, 0);
          assert.equal(lifetime.cleanupSafe, true);
          assert.deepEqual(lifetime.unsettledCommands, []);
          return;
        }
        if (mode === 'root-exit') {
          while (child.exitCode === null) {
            assert.ok(performance.now() < deadline, 'Owned root must exit before cancellation');
            await delay(10);
          }
          assert.equal(child.exitCode, 23);
        }
        const started = performance.now();
        phase('cancellation-settlement');
        cancellation.abort();
        const sentinel = Symbol('unsettled');
        let timer;
        const outcome = await Promise.race([observed, new Promise(resolve => {
          timer = setTimeout(() => resolve(sentinel), 1500);
        })]).finally(() => clearTimeout(timer));
        assert.notEqual(outcome, sentinel, `${mode}: cancellation must settle inside its original one-second stop window`);
        assert.ok(performance.now() - started < 1500);
        assert.equal(lifetime.cleanupSafe, false, 'A bounded return must not authorize deletion under the owned writer');
        assert.equal(lifetime.unsettledCommands[0].pid, child.pid);
        assert.equal(lifetime.unsettledCommands[0].reportPath, path.join(directory, 'owned.json'));
        if (mode === 'retention-failed') {
          assert.equal(outcome.error, retentionFailure);
          t.diagnostic(JSON.stringify({ mode, pid: child.pid, cleanupSafe: lifetime.cleanupSafe,
            primaryCode: outcome.error.code, cleanup: lifetime.unsettledCommands[0].cleanup }));
          return;
        }
        assert.equal(outcome.error, undefined);
        const result = outcome.report;
        assert.equal(result.complete, false);
        assert.equal(result.cleanup.survivorsVerified, false);
        assert.equal(result.cleanup.outcome, 'uncertain');
        assert.ok(result.causes.some(cause => cause.type === 'cancellation'));
        assert.ok(result.causes.some(cause => cause.type === 'cleanup'));
        assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, 'owned.json'), 'utf8')), result);
        assert.equal(result.stdout, 'owned-natural-tail');
        if (mode === 'root-exit') {
          assert.equal(result.exitCode, 23);
          assert.equal(launches, 0);
        } else assert.equal(launches, 1);
        if (mode === 'stalled') assert.equal(killerSignals, 1,
          'Stop the owned controller before it can issue a late tree request');
        t.diagnostic(JSON.stringify({ mode, pid: child.pid, complete: result.complete,
          exitCode: result.exitCode, cleanup: result.cleanup }));
      } catch (error) {
        t.diagnostic(JSON.stringify({
          kind: 'owned-settlement-scenario-failure', mode,
          ...phases.get(mode), message: error.message,
        }));
        failures.push({ mode, message: error.message, ...phases.get(mode) });
      } finally {
        phase('writer-drain');
        await fs.writeFile(path.join(directory, `${token}.release`), '');
        const deadline = performance.now() + 5000;
        while (!await fs.stat(path.join(directory, `${token}.drained`)).catch(error => {
          if (error.code !== 'ENOENT') throw error; return null;
        })) {
          assert.ok(performance.now() < deadline, 'Exact owned writer must drain through its control barrier');
          await delay(10);
        }
        const writerPresent = () => {
          if (!identity) return false;
          try { return process.kill(identity.pid, 0); }
          catch (error) { if (error.code !== 'ESRCH') throw error; return false; }
        };
        while (writerPresent()) {
          assert.ok(performance.now() < deadline, 'Exact owned descendant must exit after releasing its barrier');
          await delay(10);
        }
        phase('root-close');
        await closed;
        if (killer && killer.exitCode === null && killer.signalCode === null) {
          killer.exitCode = 1;
          killer.stderr.end();
          killer.emit('close', 1, null);
        }
        phase('final-command-settlement');
        const finalOutcome = await observed;
        if (mode !== 'retention-failed') assert.equal(finalOutcome.error, undefined);
        await fs.rm(directory, { recursive: true, force: true });
        phase('cleaned');
        completedModes.push(mode);
      }
    };
    for (let index = 0; index < modes.length; index += 2) {
      const outcomes = await Promise.allSettled(modes.slice(index, index + 2).map(runMode));
      for (const outcome of outcomes) {
        if (outcome.status === 'rejected') throw outcome.reason;
      }
    }
    assert.deepEqual([...completedModes].sort(), [...modes].sort());
    assert.deepEqual(failures, []);
  });

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
        if ((mode === 'probe-denied-drain' && present) || mode === 'probe-denied-persistent') {
          throw Object.assign(new Error('Owned group probe is denied'), { code: 'EPERM' });
        }
        if (!present) throw Object.assign(new Error('Absent'), { code: 'ESRCH' });
        return true;
      } },
    performance: { now: () => clock },
    delay: async milliseconds => {
      assert.equal(milliseconds, 10);
      clock += milliseconds;
      if (['drain', 'root-open', 'term-exit-zero', 'probe-denied-drain'].includes(mode)) present = false;
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
  for (const mode of ['drain', 'term-exit-zero', 'probe-denied-drain', 'probe-denied-persistent', 'persistent', 'denied', 'signal-unverified', 'unknown', 'root-open', 'lost-root', 'overflow', 'overflow-persistent']) {
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
      assert.equal(error.cleanup.survivorsVerified, ['drain', 'term-exit-zero', 'probe-denied-drain', 'overflow'].includes(mode));
      if (mode.startsWith('probe-denied')) {
        assert.ok(error.cleanup.probeDeniedCount > 0);
        assert.equal(error.killed, true);
        if (mode === 'probe-denied-persistent') {
          assert.equal(error.cleanup.error.code, 'EPERM');
          assert.equal(h.clock(), 1000);
        }
      }
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
    if (!['drain', 'term-exit-zero', 'probe-denied-drain', 'overflow'].includes(mode)) assert.equal(child.unreferenced, true);
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
          survivorsVerified: error.cleanup.survivorsVerified, cleanupCode: error.cleanup.error?.code,
          probeDeniedCount: error.cleanup.probeDeniedCount ?? 0 }));
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
