export const validationDeclarations = {
  "schemaVersion": 1,
  "groups": [{
    "root": "T-PRD018 capture admission reserves its complete process tree while independent peers progress",
    "minimumSlots": 5
  }, {
    "root": "T-PRD018 command capture durably retains dispatched identity and sanitized progress before cancellation or abrupt termination",
    "minimumSlots": 4
  }, {
    "root": "T-PRD018 command checkpoint capacity retains safe original streams without manufacturing completion",
    "minimumSlots": 2
  }, {
    "root": "T-PRD018 streamed validation output preserves typed assertion failures and redacts complete records",
    "minimumSlots": 3
  }, {
    "root": "T-PRD018 validation output keeps opaque malformed and over-budget streams explicitly incomplete",
    "minimumSlots": 3
  }],
  "applicability": [{
    "names": ["T-PRD018 Windows termination observations durably distinguish dispatch and original handle settlement without exposing caller data"],
    "platforms": ["linux-x64", "windows-x64", "macos-arm64", "macos-x64"],
    "owner": "runner-termination-evidence-contract",
    "reason": "PR-only VM-controlled Windows termination evidence, privacy, event ordering and fail-closed permutations; no real OS process or critical promotion.",
    "prerequisites": ["Node VM and owned repository-local report/journal fixtures"]
  }, {
    "names": ["T-PRD018 capture admission reserves its complete process tree while independent peers progress"],
    "platforms": ["linux-x64", "windows-x64", "macos-arm64", "macos-x64"],
    "owner": "runner-resource-contract",
    "reason": "PR-only capture admission regression: controlled capacity pressure plus real isolated worker leases and peer capacity reuse; no critical promotion.",
    "prerequisites": ["Node and five aggregate worker slots; owned repository-local process fixtures"]
  }, {
    "names": ["T-PRD018 command capture durably retains dispatched identity and sanitized progress before cancellation or abrupt termination"],
    "platforms": ["linux-x64", "windows-x64", "macos-arm64", "macos-x64"],
    "owner": "runner-resource-contract",
    "reason": "Reserve the test worker, IPC controller, owned command and Windows taskkill controller before the timed callback; journal, closure and cleanup assertions remain unchanged.",
    "prerequisites": ["Node and four aggregate worker slots; owned repository-local process fixtures"]
  }, {
    "names": [
      "T-PRD018 command checkpoint capacity retains safe original streams without manufacturing completion",
      "T-PRD018 streamed validation output preserves typed assertion failures and redacts complete records",
      "T-PRD018 validation output keeps opaque malformed and over-budget streams explicitly incomplete"
    ],
    "platforms": ["linux-x64", "windows-x64", "macos-arm64", "macos-x64"],
    "owner": "runner-resource-contract",
    "reason": "Capture peers must account for their own process trees: worker plus writer (two), real Node test coordinator plus isolated test child (three), or writer plus Windows termination controller (three).",
    "prerequisites": ["Node and the declared aggregate worker slots; owned repository-local process fixtures"]
  }],
  "surfaces": [{"coverage": "direct", "paths": ["src/coverage.mjs", "scripts/validation-inventory.mjs", "scripts/validation-tools.mjs"]}],
  "projects": [{
    "root": "test/calculator",
    "files": ["test/calculator/test/calculator.test.js", "test/calculator/test/static-contract.test.js"],
    "coverage": "fixture-only",
    "owner": "framework-example-project",
    "reason": "Frozen independent calculator example retains its own package command and historical app requirements; accounting is not framework execution or new application acceptance credit.",
    "command": ["node", "--test", "test/*.test.js"],
    "prerequisites": ["Run from the independent calculator project with its own declared assets"]
  }],
  "plannedCases": [{
    "id": "T-PRD013",
    "selectors": [
      {"file": "test/storage.test.mjs", "name": "T-16 canonical data, atomic replacement, and deterministic write-boundary failures preserve old/new state", "parents": []},
      {"file": "test/storage.test.mjs", "name": "T-16 old live locks are never stolen; concurrent revision updates serialize", "parents": []},
      {"file": "test/observation-retention-regression.test.mjs", "name": "FR-063/064 pruneWork alone archives released historical observations and facts without another refresh", "parents": []},
      {"file": "test/observation-retention-regression.test.mjs", "name": "FR-063 deterministic prune/refresh race rechecks dependencies under the work-item lock", "parents": []},
      {"file": "test/observation-retention-regression.test.mjs", "name": "FR-063/064 a replacement-write interruption at 262044 bytes remains loadable and prunable", "parents": []}
    ]
  }]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import { digest, SdlcError } from '../src/core.mjs';
import { testSpecificationDigest } from '../src/artifacts.mjs';
import { validateTestDefinitions } from '../src/validation-catalog.mjs';
import { runCoverageCommand } from '../src/coverage-cli.mjs';
import { fixture } from './helpers.mjs';
import { discoverDeclarations, compileValidationInventory,
  compileValidationSourceInventory, validationSourcePaths,
  compareValidationInventory, partitionValidationInventory,
  reconcileNodeExecution, nodeStartDefinition, cancelledNodeStarts, declarationTokens } from '../scripts/validation-inventory.mjs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createContext, runInContext } from 'node:vm';
import { atomicWrite } from '../src/files.mjs';
import { sanitizeExecutionPayload } from '../src/validation-evidence.mjs';
import { executeValidationCommand } from '../scripts/validation-tools.mjs';
import { createPlan, parseOptions } from '../scripts/test-runner.mjs';
import { runValidationReadyPool } from '../scripts/test-scheduling.mjs';
import { enterTestBudget } from '../scripts/test-budget.mjs';
import { runRefreshScenario } from './observation-refresh-worker.mjs';
import { compileCoverage, prepareCoverage, renderCoverageSection, readCoverageSection,
  replaceCoverageSection, inspectCoverage } from '../src/coverage.mjs';

function specification() {
  return {
    repositoryId: 'consumer',
    sourceRevision: 'a'.repeat(40),
    requirements: [{
      artifactId: 'orders', path: 'docs/orders/requirements.md',
      contents: `# Order requirements

### FR-901: Preserve orders

The prose mentions AC-901.99 and FR-999; neither is a definition.

**Definition of Done**

- AC-901.1: Keep an existing order after a failed write.
- AC-901.2: Make the successful order visible after restart.

## Sources

- AC-901.88: A quoted source outside the requirement is not a definition.
`,
    }],
    testPlans: [{
      artifactId: 'orders', path: 'docs/orders/test-plan.md',
      contents: `# Order Test Plan

| ID | Requirements | Conditions | Environment | Level | Checkpoint | Mode | Owner | Location | Expected outcome | Implementation | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-ORDER-1 | FR-901 | AC-901.1 | local | unit | pre-review | automated | agent | local | Failed write keeps the original; FR-999 is only prose | test/orders.mjs#failed write | NotRun |
| T-ORDER-2 | FR-901 | AC-901.1; AC-901.2 | local | integration | pre-review | automated | agent | local | Restart observes the exact successful order | test/orders.mjs#restart | NotRun |
`,
    }],
  };
}

test('T-PRD018 Windows termination observations durably distinguish dispatch and original handle settlement without exposing caller data',
  { timeout: 10000 }, async t => {
    const modulePath = path.resolve('scripts', 'validation-tools.mjs');
    const source = (await fs.readFile(modulePath, 'utf8'))
      .replace(/^import .+;\r?$/gmu, '').replace(/^export /gmu, '')
      .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(modulePath).href));
    const directory = await fs.mkdtemp(path.join(process.cwd(), '.test-data', 'termination-observation-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const privateValue = 'fixture-termination-private-caller-value';
    const stderr = `Authorization: ${privateValue}\n`;
    for (const mode of ['timeout-live', 'spawn-consumes-budget', 'timeout-root-closed',
      'timeout-controller-exited', 'root-first', 'controller-first', 'controller-error',
      'spawn-error', 'root-exited-before-stop', 'natural-success']) {
      const noController = mode === 'spawn-error' || mode === 'root-exited-before-stop';
      const outputDir = path.join(directory, mode);
      await fs.mkdir(outputDir);
      const cancellation = new AbortController();
      const lifetime = { cleanupSafe: true };
      const owned = Object.assign(new EventEmitter(), {
        pid: 731941, exitCode: null, signalCode: null,
        stdout: new PassThrough(), stderr: new PassThrough(), unref() {},
      });
      const killer = Object.assign(new EventEmitter(), {
        pid: 731942, exitCode: null, signalCode: null, stderr: new PassThrough(), unref() {},
      });
      const launched = Promise.withResolvers();
      const watchdogScheduled = Promise.withResolvers();
      const timers = [];
      let controllerDispatched = false;
      let watchdogRegistered = false;
      let clock = 0;
      let controllerStops = 0;
      let rootClosed = false;
      killer.kill = () => {
        controllerStops++;
        killer.signalCode = 'SIGTERM';
        killer.emit('exit', null, 'SIGTERM');
        killer.emit('close', null, 'SIGTERM');
        return true;
      };
      const context = createContext({
        Buffer, TextDecoder, URL, fileURLToPath, path, createHash, SdlcError, digest,
        declarationTokens, sanitizeExecutionPayload, atomicWrite,
        open: fs.open, realpath: fs.realpath,
        performance: { now: () => clock },
        process: { platform: 'win32', version: process.version, arch: 'x64',
          env: { SystemRoot: 'C:\\Windows' } },
        setTimeout(callback, milliseconds) {
          // The backend registers its watchdog synchronously after the owned controller dispatch.
          const timer = { callback, milliseconds, stop: controllerDispatched && !watchdogRegistered,
            unref() {}, cleared: false };
          timers.push(timer);
          if (timer.stop) {
            watchdogRegistered = true;
            watchdogScheduled.resolve(timer);
          }
          if (!timer.stop && milliseconds < 1000) queueMicrotask(() => {
            if (!timer.cleared) { clock += milliseconds; callback(); }
          });
          return timer;
        },
        clearTimeout(timer) { if (timer) timer.cleared = true; },
        spawn(command, args, options) {
          if (command === 'owned-node') {
            assert.equal(options.detached, false);
            launched.resolve();
            return owned;
          }
          assert.equal(command, path.join('C:\\Windows', 'System32', 'taskkill.exe'));
          assert.deepEqual(Array.from(args), ['/PID', String(owned.pid), '/T', '/F']);
          assert.equal(options.shell, false);
          clock += mode === 'spawn-consumes-budget' ? 1005 : 25;
          if (mode === 'spawn-error') throw Object.assign(new Error('Owned controller unavailable'), { code: 'EAGAIN' });
          controllerDispatched = true;
          return killer;
        },
      });
      const execute = runInContext(`${source}\nexecuteValidationCommand;`, context);
      const pending = execute({ name: 'observed', command: 'owned-node',
        args: ['-e', `console.log(${JSON.stringify(privateValue)})`],
        environment: {}, outputDir, signal: cancellation.signal, lifetime });
      pending.catch(() => {});
      const closeRoot = code => {
        rootClosed = true;
        owned.exitCode = code;
        owned.stdout.end('ready\n'); owned.stderr.end();
        owned.emit('exit', code, null); owned.emit('close', code, null);
      };
      const closeController = () => {
        killer.exitCode = 0;
        killer.stderr.end();
        killer.emit('exit', 0, null); killer.emit('close', 0, null);
      };
      try {
        await launched.promise;
        if (mode === 'natural-success') closeRoot(0);
        else {
          if (mode === 'root-exited-before-stop') closeRoot(7);
          cancellation.abort();
          if (!noController) {
            await watchdogScheduled.promise;
            killer.stderr.write(stderr);
          }
          if (noController) {
            assert.equal(controllerStops, 0);
          } else if (mode === 'root-first') {
            clock = 100; closeRoot(1);
            clock = 200; closeController();
          } else if (mode === 'controller-first') {
            clock = 100; closeController();
            clock = 200; closeRoot(1);
          } else if (mode === 'controller-error') {
            clock = 100;
            killer.emit('error', Object.assign(new Error('Owned controller launch denied'), { code: 'EACCES' }));
          } else {
            if (mode === 'timeout-root-closed') { clock = 100; closeRoot(1); }
            if (mode === 'timeout-controller-exited') {
              clock = 100; killer.exitCode = 0; killer.emit('exit', 0, null);
            }
            const watchdog = timers.find(timer => timer.stop);
            assert.ok(watchdog);
            assert.equal(watchdog.milliseconds, mode === 'spawn-consumes-budget' ? 0 : 975);
            clock = Math.max(clock, 1000);
            watchdog.callback();
          }
        }
        const report = await pending;
        assert.deepEqual(JSON.parse(await fs.readFile(path.join(outputDir, 'observed.json'), 'utf8')), report);
        const bytes = await fs.readFile(path.join(outputDir, 'observed.journal.ndjson'));
        assert.equal(digest(bytes), report.checkpoint.originalJournalPrefix.sha256);
        assert.equal(bytes.length, report.checkpoint.originalJournalPrefix.bytes);
        assert.equal(report.checkpoint.journalDurable, true);
        const events = bytes.toString('utf8').trim().split('\n').map(JSON.parse);
        t.diagnostic(JSON.stringify({ vmObservationMode: mode, outcome: report.cleanup.outcome,
          errorCode: report.cleanup.error?.code ?? null, observation: report.cleanup.terminationObservation,
          journal: report.checkpoint.originalJournalPrefix }));
        if (mode === 'natural-success') {
          assert.equal(report.complete, true);
          assert.equal(report.cleanup.requested, false);
          assert.equal(report.cleanup.terminationObservation, undefined);
          continue;
        }
        const observation = report.cleanup.terminationObservation;
        assert.ok(observation, 'Durable cleanup must retain bounded Windows termination observations');
        assert.deepEqual(events.findLast(row => row.kind === 'command-end').cleanup.terminationObservation, observation);
        const uncertain = mode.startsWith('timeout-') || mode === 'spawn-consumes-budget' ||
          mode === 'controller-error' || noController;
        assert.equal(report.complete, false);
        assert.equal(report.cleanup.outcome, uncertain ? 'uncertain' : 'reported-stopped');
        assert.equal(lifetime.cleanupSafe, false, 'Observation metadata grants no survivor/cleanup authority');
        assert.ok(report.causes.some(cause => cause.type === 'cancellation'));
        const expectedError = mode === 'controller-error' ? 'EACCES' : mode === 'spawn-error' ? 'EAGAIN' :
          mode === 'root-exited-before-stop' ? 'STOP_UNVERIFIED' : 'STOP_TIMEOUT';
        if (uncertain) assert.ok(report.causes.some(cause => cause.type === 'cleanup' && cause.code === expectedError));
        assert.equal(observation.backend, 'windows-taskkill');
        assert.deepEqual(observation.flags, ['/PID', '/T', '/F']);
        assert.equal(observation.root.pid, owned.pid);
        if (noController) {
          assert.equal(observation.controller.pid, null);
          assert.equal(observation.controller.exit, null);
          assert.equal(observation.controller.close, null);
          assert.equal(observation.controller.stderr, null);
          assert.equal(observation.beforeCleanup, null);
          assert.equal(observation.watchdog, null);
          assert.equal(controllerStops, 0);
          assert.equal(observation.dispatch.beforeMs, mode === 'spawn-error' ? 0 : null);
          assert.equal(observation.dispatch.afterMs, mode === 'spawn-error' ? 25 : null);
          assert.equal(observation.dispatch.errorCode, mode === 'spawn-error' ? 'EAGAIN' : null);
          continue;
        }
        assert.equal(observation.controller.pid, killer.pid);
        assert.equal(observation.dispatch.afterMs - observation.dispatch.beforeMs,
          mode === 'spawn-consumes-budget' ? 1005 : 25);
        assert.deepEqual(observation.controller.stderr, { sha256: digest(stderr), bytes: Buffer.byteLength(stderr) });
        const serialized = JSON.stringify(observation);
        assert.ok(Buffer.byteLength(serialized) < 4096);
        assert.ok(!serialized.includes(privateValue));
        assert.ok(!serialized.includes(modulePath));
        assert.ok(!serialized.includes('owned-node'));
        assert.deepEqual(sanitizeExecutionPayload(Buffer.from(serialized)), observation);
        const finite = value => {
          if (typeof value === 'number') assert.ok(Number.isFinite(value));
          else if (value && typeof value === 'object') Object.values(value).forEach(finite);
        };
        finite(observation);
        if (mode === 'root-first' || mode === 'controller-first') {
          assert.ok(observation.root.exit && observation.root.close);
          assert.ok(observation.controller.exit && observation.controller.close);
          assert.equal(observation.watchdog, null);
          assert.equal(controllerStops, 0);
          assert.equal(observation.root.close.elapsedMs < observation.controller.close.elapsedMs, mode === 'root-first');
        } else if (mode === 'controller-error') {
          assert.equal(observation.controller.errorCode, 'EACCES');
          assert.equal(observation.watchdog, null);
          assert.equal(controllerStops, 1);
        } else {
          const snapshot = observation.watchdog;
          assert.ok(snapshot);
          assert.equal(snapshot.root.exitCode, mode === 'timeout-root-closed' ? 1 : null);
          assert.equal(snapshot.controller.exitCode, mode === 'timeout-controller-exited' ? 0 : null);
          assert.equal(snapshot.controller.signalCode, null, 'Snapshot precedes the owned controller stop signal');
          assert.deepEqual(snapshot.stderr, observation.controller.stderr);
          assert.equal(observation.root.close === null, mode !== 'timeout-root-closed');
          assert.equal(observation.controller.close === null, mode === 'timeout-controller-exited');
          assert.equal(controllerStops, mode === 'timeout-controller-exited' ? 0 : 1);
          if (controllerStops) assert.equal(observation.controller.exit.signal, 'SIGTERM');
          assert.deepEqual(observation.beforeCleanup.controller, snapshot.controller);
        }
      } finally {
        if (!rootClosed) closeRoot(1);
        await pending;
      }
    }
  });

test('T-PRD018 capture admission reserves its complete process tree while independent peers progress',
  { timeout: 30000 }, async t => {
    const root = 'T-PRD018 command capture durably retains dispatched identity and sanitized progress before cancellation or abrupt termination';
    const plan = await createPlan(parseOptions(['targeted', '--workers', '5', '--name',
      '^T-PRD018 command capture durably', 'test/public-readiness-inventory.test.mjs']));
    const capture = plan.groups.find(group => group.root === root);
    const release = Promise.withResolvers();
    const peer = Promise.withResolvers();
    let released = false;
    let entered = false;
    const group = (id, minimumSlots, dependsOn = []) =>
      ({ id, minimumSlots, dependsOn, exclusiveResources: [] });
    const pending = runValidationReadyPool([
      group('blocker', 2), group('seed', 1), group('peer', 1),
      { ...capture, dependsOn: ['seed'] },
    ], { concurrency: 5, capacity: 5, signal: t.signal, execute: async selected => {
      if (selected.id === 'blocker') await release.promise;
      else if (selected.id === 'seed') await peer.promise;
      else if (selected.id === 'peer') peer.resolve();
      else {
        entered = true;
        assert.equal(released, true,
          'Capture must not start its timed callback with only three slots available for four live actors');
      }
      return 'Passed';
    } });
    try {
      await peer.promise;
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(entered, false,
        'An admitted peer must not allow the four-actor capture callback to oversubscribe a five-slot host');
    } finally {
      released = true;
      release.resolve();
      await pending;
    }
    assert.equal(entered, true);

    const producers = await createPlan(parseOptions(['targeted', '--workers', '5', '--name',
      '^T-PRD018 (command checkpoint capacity|streamed validation output|validation output keeps)',
      'test/public-readiness-inventory.test.mjs']));
    for (const producer of producers.groups) {
      const finish = Promise.withResolvers();
      let captureLive = false;
      const pressure = runValidationReadyPool([capture, producer], {
        concurrency: 5, capacity: 5, signal: t.signal, execute: async selected => {
          if (selected.id === capture.id) {
            captureLive = true;
            await finish.promise;
            captureLive = false;
          } else assert.equal(captureLive, false,
            `The capture tree cannot share its remaining single slot with this multi-process producer: ${producer.root}`);
          return 'Passed';
        },
      });
      try { await new Promise(resolve => setImmediate(resolve)); }
      finally { finish.resolve(); await pressure; }
    }

    const budget = await enterTestBudget({ workers: 5, fileCount: 3 });
    const children = [];
    const environment = { ...process.env, ...budget.environment, NODE_OPTIONS: '', NODE_PATH: '' };
    delete environment.NODE_TEST_CONTEXT;
    delete environment.SDLC_TEST_REPORT_CONTEXT;
    const module = new URL('../scripts/test-budget.mjs', import.meta.url).href;
    const start = (id, slots) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', `
import {acquireTestWorker,readTestBudget,readTestGroupProcesses} from ${JSON.stringify(module)};
const worker=await acquireTestWorker(${slots},{groupId:${JSON.stringify(id)}});
const lease=(await readTestGroupProcesses(${JSON.stringify(id)})).find(row=>row.pid===process.pid);
process.send({lease,budget:await readTestBudget()});
await new Promise(resolve=>process.once('message',resolve));
worker.close();process.disconnect();
`], { cwd: process.cwd(), env: environment, shell: false, signal: t.signal,
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
      let stderr = '';
      child.stderr.on('data', bytes => { stderr += bytes; });
      const ready = new Promise((resolve, reject) => {
        child.once('message', resolve);
        child.once('error', reject);
        child.once('close', code => reject(new Error(`Worker closed before admission: ${code}: ${stderr}`)));
      });
      const done = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', code => code === 0 ? resolve() : reject(new Error(stderr || `Worker exit ${code}`)));
      });
      children.push({ child, done });
      return { child, ready, done };
    };
    try {
      const owner = start(capture.id, capture.minimumSlots);
      const owned = await owner.ready;
      const first = start(digest('capture-peer-first'), 1);
      const firstEvidence = await first.ready;
      first.child.send({ release: true });
      await first.done;
      const next = start(digest('capture-peer-next'), 1);
      const nextEvidence = await next.ready;
      assert.equal(owner.child.exitCode, null, 'Peer capacity must be reused while capture retains its reservation');
      assert.equal(owned.lease.minimumSlots, 4);
      assert.equal(owned.lease.finishedAt, null);
      assert.equal(firstEvidence.budget.id, owned.budget.id);
      assert.equal(nextEvidence.budget.id, owned.budget.id);
      assert.equal(owned.lease.minimumSlots + nextEvidence.lease.minimumSlots, 5);
      assert.notEqual(nextEvidence.lease.slot, owned.lease.slot);
      t.diagnostic(JSON.stringify({ capture: owned.lease, peer: nextEvidence.lease,
        budgetId: owned.budget.id, capacity: owned.budget.capacity }));
      next.child.send({ release: true });
      owner.child.send({ release: true });
    } finally {
      for (const { child } of children) {
        if (child.connected) child.send({ release: true }, () => {});
      }
      try { await Promise.all(children.map(({ done }) => done)); }
      finally { await budget.close(); }
    }
  });

test('T-PRD018 command capture durably retains dispatched identity and sanitized progress before cancellation or abrupt termination',
  { timeout: 30000 }, async t => {
    const directory = await fs.mkdtemp(path.join(process.cwd(), '.test-data', 'command-checkpoint-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const environment = { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' };
    delete environment.NODE_TEST_CONTEXT;
    delete environment.SDLC_TEST_REPORT_CONTEXT;
    const module = pathToFileURL(path.resolve('scripts', 'validation-tools.mjs')).href;
    const filesModule = pathToFileURL(path.resolve('src', 'files.mjs')).href;
    for (const abrupt of [false, true]) {
      const name = abrupt ? 'abrupt-command' : 'cancelled-command';
      const marker = path.join(directory, `${name}-entered.json`);
      const release = path.join(directory, `${name}-release`);
      const source = path.join(directory, `${name}.mjs`);
      await fs.writeFile(source, `import * as fs from 'node:fs/promises';
import {atomicWrite} from ${JSON.stringify(filesModule)};
import {setTimeout as delay} from 'node:timers/promises';
await atomicWrite(${JSON.stringify(marker)},JSON.stringify({pid:process.pid,parentPid:process.ppid}));
console.log(JSON.stringify({authorization:'fixture-checkpoint-private-value'}));
const deadline=Date.now()+20000;
while(!(await fs.stat(${JSON.stringify(release)}).catch(error=>{
  if(error.code!=='ENOENT')throw error;return null;
}))){
  if(Date.now()>=deadline)throw Error('Owned capture fixture release timed out');await delay(20);
}
`);
      const controllerSource = path.join(directory, `${name}-controller.mjs`);
      await fs.writeFile(controllerSource, `import {executeValidationCommand} from ${JSON.stringify(module)};
const cancellation=new AbortController();
process.once('message',()=>cancellation.abort());
await executeValidationCommand({name:${JSON.stringify(name)},command:process.execPath,
  args:[${JSON.stringify(source)}],outputDir:${JSON.stringify(directory)},signal:cancellation.signal});
if(process.connected)process.disconnect();
`);
      const controller = spawn(process.execPath, [controllerSource], {
        cwd: process.cwd(), env: environment, shell: false, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      });
      let stderr = '';
      controller.stderr.on('data', data => { stderr += data; });
      const done = new Promise((resolve, reject) => {
        controller.once('error', reject);
        controller.once('close', (code, signal) => resolve({ code, signal }));
      });
      let owned;
      let report;
      const reportPath = path.join(directory, `${name}.json`);
      try {
        const deadline = Date.now() + 7000;
        while (Date.now() < deadline) {
          try {
            owned = JSON.parse(await fs.readFile(marker, 'utf8'));
            report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
          } catch (error) { if (error.code !== 'ENOENT') throw error; }
          if (report?.pid === owned?.pid && report?.stdout.includes('[redacted:')) break;
          await delay(20);
        }
        assert.ok(owned?.pid, stderr);
        assert.equal(report.pid, owned.pid, 'The durable report must identify the dispatched, still-running command');
        assert.equal(report.complete, false);
        assert.equal(report.finishedAt, null);
        assert.equal(report.exitCode, null);
        assert.match(report.stdout, /\[redacted:[a-f0-9]{64}\]/u);
        assert.ok(!JSON.stringify(report).includes('fixture-checkpoint-private-value'));
        const journalPath = path.join(directory, `${name}.journal.ndjson`);
        const journal = await fs.readFile(journalPath);
        const reference = report.checkpoint.originalJournalPrefix;
        t.diagnostic(JSON.stringify({ boundary: 'running-journal', variant: name,
          checkpoint: report.checkpoint, causes: report.causes, originalOutput: report.originalOutput }));
        assert.equal(report.checkpoint.journalDurable, true,
          `The running journal must be durable: ${JSON.stringify(report.checkpoint)}`);
        assert.equal(digest(journal.subarray(0, reference.bytes)), reference.sha256);
        const events = journal.subarray(0, reference.bytes).toString('utf8').trim().split('\n').map(JSON.parse);
        assert.equal(events.at(-1).sequence, report.checkpoint.journalSequence);
        assert.ok(events.some(row => row.kind === 'command-dispatched' && row.pid === owned.pid));
        assert.ok(events.some(row => row.kind === 'output' && row.channel === 'stdout'));
        const existingReport = await fs.readFile(reportPath);
        const existingJournal = await fs.readFile(journalPath);
        await assert.rejects(executeValidationCommand({ name, command: process.execPath,
          args: [source], outputDir: directory, environment }), { code: 'EEXIST' });
        assert.deepEqual(await fs.readFile(reportPath), existingReport);
        assert.deepEqual(await fs.readFile(journalPath), existingJournal);
        if (abrupt) {
          controller.kill('SIGKILL');
          await done;
          const preserved = await fs.readFile(reportPath);
          await fs.writeFile(release, '');
          assert.deepEqual(await fs.readFile(reportPath), preserved);
          assert.equal(JSON.parse(preserved).complete, false);
        } else {
          await new Promise((resolve, reject) => controller.send({ cancel: true },
            error => error ? reject(error) : resolve()));
          const result = await done;
          assert.equal(result.code, 0, stderr);
          const cancelled = JSON.parse(await fs.readFile(reportPath, 'utf8'));
          assert.equal(cancelled.complete, false);
          assert.ok(cancelled.causes.some(cause => cause.type === 'cancellation'));
          t.diagnostic(JSON.stringify({ boundary: 'cancelled-root-closure', variant: name,
            cleanup: cancelled.cleanup, checkpoint: cancelled.checkpoint,
            causes: cancelled.causes, originalOutput: cancelled.originalOutput }));
          assert.equal(cancelled.cleanup.rootExitObserved, true,
            `Cancellation must observe root closure: ${JSON.stringify(cancelled.cleanup)}`);
          assert.equal(cancelled.checkpoint.phase, 'finished');
          const finalJournal = await fs.readFile(journalPath);
          assert.equal(digest(finalJournal), cancelled.checkpoint.originalJournalPrefix.sha256);
          assert.equal(finalJournal.length, cancelled.checkpoint.originalJournalPrefix.bytes);
        }
      } finally {
        await fs.writeFile(release, '');
        if (owned) {
          try { process.kill(owned.pid, 'SIGKILL'); }
          catch (error) { if (error.code !== 'ESRCH') throw error; }
        }
        if (controller.exitCode === null && controller.signalCode === null) controller.kill('SIGKILL');
        await done;
        const deadline = Date.now() + 5000;
        while (owned) {
          try { process.kill(owned.pid, 0); }
          catch (error) { if (error.code === 'ESRCH') break; throw error; }
          assert.ok(Date.now() < deadline, 'No owned capture process may survive cleanup');
          await delay(20);
        }
      }
    }
  });

test('T-PRD018 command checkpoint capacity retains safe original streams without manufacturing completion',
  { timeout: 30000 }, async t => {
    // Keep the one-second progress callback pending until the real producer closes.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const directory = await fs.mkdtemp(path.join(process.cwd(), '.test-data', 'command-checkpoint-bound-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const source = path.join(directory, 'bounded.mjs');
    await fs.writeFile(source, "const bytes=Buffer.from('x'.repeat(2100000)+'\\n');" +
      "await new Promise(resolve=>process.stdout.write(bytes,resolve));" +
      "await new Promise(resolve=>process.stderr.write(bytes,resolve));");
    const environment = { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' };
    delete environment.NODE_TEST_CONTEXT;
    delete environment.SDLC_TEST_REPORT_CONTEXT;
    const report = await executeValidationCommand({
      name: 'bounded-command', command: process.execPath, args: [source],
      outputDir: directory, environment, signal: t.signal,
    });
    assert.equal(report.complete, false);
    assert.ok(report.causes.some(cause => cause.type === 'persistence' && cause.code === 'CAPACITY'));
    assert.equal(report.checkpoint.phase, 'retention-failed');
    assert.equal(report.cleanup.requested, false,
      'Retention failure after root closure must not start asynchronous termination or journal writes');
    assert.equal(report.cleanup.rootExitObserved, true);
    assert.ok(report.checkpoint.originalSnapshot.bytes > 4 * 1024 * 1024);
    const journal = await fs.readFile(path.join(directory, 'bounded-command.journal.ndjson'));
    assert.equal(digest(journal), report.checkpoint.originalJournalPrefix.sha256);
    assert.equal(journal.length, report.checkpoint.originalJournalPrefix.bytes);
    const events = journal.toString('utf8').trim().split('\n').map(JSON.parse);
    const last = events.at(-1);
    assert.equal(last.kind, 'report-retention-rejected');
    assert.equal(last.complete, false);
    assert.deepEqual(last.original, report.checkpoint.originalSnapshot);
    for (const channel of ['stdout', 'stderr']) {
      const original = Buffer.from(events.filter(row => row.kind === 'output' && row.channel === channel)
        .map(row => row.text).join(''));
      assert.equal(original.length, 2100001);
      assert.deepEqual(report.originalOutput[channel], { sha256: digest(original), bytes: original.length });
    }
    const retained = await fs.readFile(path.join(directory, 'bounded-command.json'));
    assert.ok(retained.length > 0 && retained.length <= 4 * 1024 * 1024);
    assert.deepEqual(JSON.parse(retained), report);
  });

test('T-PRD018 streamed validation output preserves typed assertion failures and redacts complete records', async t => {
  const directory = await fs.mkdtemp(path.join(process.cwd(), '.test-data', 'output-records-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const environment = { ...process.env, NO_COLOR: '1', NODE_DISABLE_COLORS: '1', NODE_OPTIONS: '', NODE_PATH: '' };
  delete environment.NODE_TEST_CONTEXT;
  delete environment.SDLC_TEST_REPORT_CONTEXT;
  delete environment.FORCE_COLOR;
  const secrets = ['fixture-inspected-authorization', 'fixture-json-password', 'fixture-header-token',
    'fixture-folded-token', 'fixture-array-client-secret'];
  const reporterFixture = path.join(directory, 'actual-reporter.test.mjs');
  await fs.writeFile(reporterFixture, "import test from 'node:test';import assert from 'node:assert/strict';" +
    "test('owned real assertion failure',()=>assert.ok(false));" +
    "test('owned missing regexp rejection',async()=>assert.rejects(Promise.resolve(),/transparency|checkpoint|signature|log|timestamp/iu));" +
    "test('owned missing predicate rejection',async()=>assert.rejects(Promise.resolve(),error=>error.code==='EXPECTED'));" +
    "test('owned passing sibling',()=>assert.ok(true));");
  const reporter = await executeValidationCommand({ name: 'actual-node-spec', command: process.execPath,
    args: ['--test', '--test-reporter=spec', reporterFixture], outputDir: directory, environment, signal: t.signal });
  assert.equal(reporter.complete, true, reporter.diagnostic);
  assert.equal(reporter.exitCode, 1);
  assert.equal(reporter.cleanup.requested, false);
  assert.match(reporter.stdout, /owned real assertion failure/u);
  assert.match(reporter.stdout, /owned missing regexp rejection/u);
  assert.match(reporter.stdout, /owned missing predicate rejection/u);
  assert.match(reporter.stdout, /Missing expected rejection/u);
  assert.match(reporter.stdout, /owned passing sibling/u);
  const reporterEvents = (await fs.readFile(path.join(directory, 'actual-node-spec.journal.ndjson'), 'utf8'))
    .trim().split('\n').map(JSON.parse);
  assert.equal(reporterEvents.reduce((count, event) => count + (event.normalizedRecords ?? 0), 0), 3);
  assert.ok(!reporterEvents.some(event => event.kind === 'output-rejected'));
  for (const fragmented of [false, true]) {
    const name = fragmented ? 'fragmented-assertion' : 'whole-assertion';
    const identityFile = path.join(directory, `${name}-identity.json`);
    const source = path.join(directory, `${name}.mjs`);
    await fs.writeFile(source, `import assert from 'node:assert/strict';
import {inspect} from 'node:util';import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';import {setTimeout as delay} from 'node:timers/promises';
let failure;try{assert.ok(false);}catch(error){failure=error;}
const originalInspection=inspect(failure,{colors:false,depth:8});
failure.actual={authorization:${JSON.stringify(secrets[0])},
  nested:[{clientSecret:${JSON.stringify(secrets[4])}}],literalArray:['Object'],
  nil:undefined,invalid:NaN,negativeZero:-0};
failure.expected={authorization:'expected fixture value'};
const details={generatedMessage:failure.generatedMessage,code:failure.code,actual:failure.actual,
  expected:failure.expected,operator:failure.operator};
let explicit;try{assert.fail('owned explicit failure');}catch(error){explicit=error;}
const text='plain UTF-8 ✔🔐\\n'+originalInspection+'\\n'+inspect(failure,{colors:false,depth:8})+'\\n'+
  inspect(details,{colors:false,depth:8})+'\\n'+
  inspect(explicit,{colors:false,depth:8})+'\\n'+
  JSON.stringify({nested:{password:${JSON.stringify(secrets[1])}}},null,2)+'\\n'+
  'ordinary tail\\nAuthorization: Bearer ${secrets[2]}\\n  ${secrets[3]}\\n';
const bytes=Buffer.from(text);
await writeFile(${JSON.stringify(identityFile)},JSON.stringify({sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length}));
if(${fragmented}){for(let offset=0;offset<bytes.length;offset+=7){
  await new Promise(resolve=>process.stdout.write(bytes.subarray(offset,offset+7),resolve));await delay(1);
}}else await new Promise(resolve=>process.stdout.write(bytes,resolve));
process.exitCode=1;
`);
    const report = await executeValidationCommand({ name, command: process.execPath, args: [source],
      outputDir: directory, environment, signal: t.signal });
    if (!report.complete) {
      const events = (await fs.readFile(path.join(directory, `${name}.journal.ndjson`), 'utf8'))
        .trim().split('\n').map(JSON.parse);
      t.diagnostic(JSON.stringify({ name, rejected: events.filter(event => event.kind === 'output-rejected')
        .map(event => ({ code: event.code, cause: event.cause, original: event.original })),
      normalized: events.filter(event => event.normalization).length }));
    }
    assert.equal(report.complete, true, report.diagnostic);
    assert.equal(report.exitCode, 1, 'The original assertion failure must remain a failure, not retention cancellation');
    assert.equal(report.cleanup.requested, false);
    assert.deepEqual(report.originalOutput.stdout, JSON.parse(await fs.readFile(identityFile, 'utf8')));
    assert.match(report.stdout, /"code":"ERR_ASSERTION"/u);
    assert.match(report.stdout, /\[redacted:[a-f0-9]{64}\]/u);
    assert.match(report.stdout, /plain UTF-8 ✔🔐/u);
    assert.match(report.stdout, /"literalArray":\["Object"\]/u);
    assert.match(report.stdout, /ordinary tail/u);
    const journal = await fs.readFile(path.join(directory, `${name}.journal.ndjson`), 'utf8');
    const stored = await fs.readFile(path.join(directory, `${name}.json`), 'utf8');
    for (const secret of secrets) {
      assert.ok(!report.stdout.includes(secret), 'The readable transcript must redact every labelled secret');
      assert.ok(!journal.includes(secret), 'No partial output event may expose a secret split across records');
      assert.ok(!stored.includes(secret));
    }
    assert.deepEqual(JSON.parse(stored), report);
    const events = journal.trim().split('\n').map(JSON.parse);
    const output = events.filter(event => event.kind === 'output' && event.channel === 'stdout');
    assert.equal(output.map(event => event.text).join(''), report.stdout);
    assert.equal(output.reduce((bytes, event) => bytes + event.original.bytes, 0),
      report.originalOutput.stdout.bytes, 'Every original byte belongs to exactly one retained logical record');
    assert.ok(events.some(event => event.kind === 'output' && event.normalization === 'node-assertion-metadata-json'));
    assert.equal(events.reduce((count, event) => count + (event.normalizedRecords ?? 0), 0), 4);
    assert.ok(!events.some(event => event.kind === 'output-rejected'));
    assert.equal(events.at(-1).kind, 'command-end');
    assert.equal(events.at(-1).complete, true);
  }
});

test('T-PRD018 validation output keeps opaque malformed and over-budget streams explicitly incomplete', async t => {
  const directory = await fs.mkdtemp(path.join(process.cwd(), '.test-data', 'output-rejection-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const environment = { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' };
  delete environment.NODE_TEST_CONTEXT;
  delete environment.SDLC_TEST_REPORT_CONTEXT;
  const fixtures = [
    ['untyped-object', "Buffer.from(\"{authorization:'fixture-unsafe-object'}\\n\")", 'UNSAFE'],
    ['unknown-assertion-field', "Buffer.from(\"{generatedMessage:false,code:'ERR_ASSERTION',actual:false,expected:true,operator:'==',authorization:'fixture-unsafe-object'}\\n\")", 'UNSAFE'],
    ['function-source-is-not-data', "Buffer.from(\"{generatedMessage:false,code:'ERR_ASSERTION',actual:false,expected:function(){throw Error('fixture-unsafe-object')},operator:'rejects'}\\n\")", 'UNSAFE'],
    ['oversized-inspection', 'Buffer.from("{generatedMessage:false,code:\\\'ERR_ASSERTION\\\',actual:\\\'"+"x".repeat(65536)+"\\\',expected:true,operator:\\\'==\\\'}\\n")', 'UNSAFE'],
    ['opaque-control', 'Buffer.from([27,91,51,49,109,10])', 'UNSAFE'],
    ['invalid-utf8', 'Buffer.from([195,40,10])', 'UNSAFE'],
    ['output-budget', 'Buffer.alloc(4*1024*1024+1,120)', 'CAPACITY'],
  ];
  for (const [name, value, code] of fixtures) {
    const identityFile = path.join(directory, `${name}-identity.json`);
    const source = path.join(directory, `${name}.mjs`);
    await fs.writeFile(source, `import {writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
const bytes=${value};await writeFile(${JSON.stringify(identityFile)},JSON.stringify({
sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length}));
await new Promise(resolve=>process.stdout.write(bytes,resolve));
`);
    const report = await executeValidationCommand({ name, command: process.execPath, args: [source],
      outputDir: directory, environment, signal: t.signal });
    assert.equal(report.complete, false, name);
    assert.ok(report.causes.some(cause => cause.type === 'output' && cause.code === code), name);
    assert.deepEqual(report.originalOutput.stdout, JSON.parse(await fs.readFile(identityFile, 'utf8')));
    const journal = await fs.readFile(path.join(directory, `${name}.journal.ndjson`), 'utf8');
    assert.ok(!journal.includes('fixture-unsafe-object'));
    const events = journal.trim().split('\n').map(JSON.parse);
    assert.ok(events.some(event => event.kind === 'output-rejected' && event.original?.sha256));
    assert.equal(events.at(-1).complete, false);
  }
});

test('T-PRD002 literal and finite declarations identify exact selectors without executing candidate JavaScript', () => {
  const source = [
    "import test from 'node:test';",
    "throw new Error('Discovery must not execute source');",
    "const fixture = \"test('not an actual registration',()=>{});\";",
    "test('literal case', () => {});",
    "for (const mode of ['one','two']) test(`finite ${mode}`, () => {});",
    'export const validationDeclarations = {"schemaVersion":1,"variants":[',
    '{"expression":"`finite ${mode}`","domains":{"mode":["one","two"]}}]};',
  ].join('\n');
  const result = discoverDeclarations(source, 'test/consumer.test.mjs');
  assert.deepEqual(result.cases.map(test => test.name), ['literal case', 'finite one', 'finite two']);
  assert.deepEqual(result.unresolved, []);
  assert.ok(result.cases.every(test => test.line > 0 && test.column > 0 && test.sourceDigest));
  assert.ok(!result.cases.some(test => test.name.includes('not an actual registration')));
  const missing = discoverDeclarations(source.replace('`finite ${mode}`', '`new ${mode}`'),
    'test/consumer.test.mjs');
  assert.ok(missing.unresolved.some(item => item.code === 'UNDECLARED_VARIANTS'));
  assert.ok(missing.unresolved.some(item => item.code === 'STALE_VARIANTS'));
  assert.throws(() => discoverDeclarations(source.replace('["one","two"]', '["one","one"]'),
    'test/consumer.test.mjs'), /unique/iu);
  assert.throws(() => discoverDeclarations(source.replace('{"schemaVersion":1', '{schemaVersion:1'),
    'test/consumer.test.mjs'), /strict JSON/iu);
  const repeated = discoverDeclarations(
    "import test from 'node:test';for(const input of [1,2]){test('same literal',()=>{});}",
    'test/repeated.test.mjs');
  assert.ok(repeated.unresolved.some(item => item.code === 'UNDECLARED_REPEATED_REGISTRATION'));
});

test('T-PRD002 source-declared logical bindings preserve original assertions and require every exact selector', () => {
  const file = 'test/consumer.test.mjs';
  const body = "import test from 'node:test';test('original assertion',()=>{});" +
    "test('original sibling',()=>{});";
  const selector = { name: 'original assertion', parents: [] };
  const bindings = [
    { id: 'T-CONSUMER-1', selectors: [selector, { name: 'original sibling', parents: [] }] },
    { id: 'T-CONSUMER-2', selectors: [selector] },
  ];
  const source = plannedCases => `export const validationDeclarations = ${JSON.stringify({
    schemaVersion: 1, plannedCases,
  })};\n${body}`;
  const original = discoverDeclarations(body, file);
  const declared = discoverDeclarations(source(bindings), file);
  assert.deepEqual(declared.unresolved, []);
  assert.deepEqual(declared.cases.map(test => [test.id, test.name, test.definitionDigest]),
    original.cases.map(test => [test.id, test.name, test.definitionDigest]));
  assert.deepEqual(declared.cases.map(test => test.plannedCases),
    [['T-CONSUMER-1', 'T-CONSUMER-2'], ['T-CONSUMER-1']]);
  const stale = structuredClone(bindings);
  stale[0].selectors[1].name = 'renamed assertion';
  assert.ok(discoverDeclarations(source(stale), file).unresolved.some(item =>
    item.code === 'STALE_PLANNED_CASE_SELECTOR' && item.testId === 'T-CONSUMER-1'));
  assert.ok(discoverDeclarations(source([{ id: 'T-CONSUMER-1',
    selectors: [{ name: 'absent assertion' }] }]), file).unresolved.some(item =>
    item.code === 'STALE_PLANNED_CASE_SELECTOR'));
  for (const invalid of [
    [...bindings, bindings[0]],
    [{ ...bindings[0], selectors: [selector, selector] }],
    [{ ...bindings[0], selectors: [selector, { name: selector.name }] }],
    [{ ...bindings[0], selectors: [] }],
    [{ ...bindings[0], selectors: [{ ...selector, pattern: '.*' }] }],
  ]) assert.throws(() => discoverDeclarations(source(invalid), file), /unique|duplicate|nonempty|literal/iu);
});

test('T-PRD002 repeated leaf names require unambiguous source-declared parent paths', () => {
  const body = "import test from 'node:test';" +
    "test('first',async t=>{await t.test('shared leaf',()=>{});});" +
    "test('second',async t=>{await t.test('shared leaf',()=>{});});";
  const source = selector => `export const validationDeclarations = ${JSON.stringify({
    schemaVersion: 1, plannedCases: [{ id: 'T-CONSUMER-1', selectors: [selector] }],
  })};\n${body}`;
  assert.throws(() => discoverDeclarations(source({ name: 'shared leaf' }), 'test/consumer.test.mjs'),
    /ambiguous/iu);
  const discovered = discoverDeclarations(source({ name: 'shared leaf', parents: ['second'] }),
    'test/consumer.test.mjs');
  assert.deepEqual(discovered.cases.filter(test => test.plannedCases).map(test =>
    [test.name, test.parents, test.plannedCases]), [['shared leaf', ['second'], ['T-CONSUMER-1']]]);
  assert.ok(discoverDeclarations(source({ name: 'shared leaf', parents: [] }),
    'test/consumer.test.mjs').unresolved.some(item => item.code === 'STALE_PLANNED_CASE_SELECTOR'));
});

test('T-PRD002 cross-file logical bindings resolve against original assertions without duplicated executions', () => {
  const selector = { file: 'test/original.test.mjs', name: 'actual storage boundary', parents: [] };
  const files = [
    { file: 'test/bindings.test.mjs', contents: `export const validationDeclarations = ${JSON.stringify({
      schemaVersion: 1, plannedCases: [{ id: 'T-CONSUMER-1', selectors: [selector] }],
    })};import test from 'node:test';test('binding inventory assertion',()=>{});` },
    { file: selector.file, contents: "import test from 'node:test';test('actual storage boundary',()=>{});" },
  ];
  const original = discoverDeclarations(files[1].contents, files[1].file).cases[0];
  const inventory = compileValidationSourceInventory({ files, surfacePaths: files.map(source => source.file) });
  assert.equal(inventory.complete, true);
  const bound = inventory.cases.find(test => test.id === original.id);
  assert.deepEqual(bound.plannedCases, ['T-CONSUMER-1']);
  assert.equal(bound.definitionDigest, original.definitionDigest);
  assert.equal(inventory.cases.filter(test => test.id === original.id).length, 1);
  const absent = compileValidationSourceInventory({ files: files.slice(0, 1),
    surfacePaths: files.slice(0, 1).map(source => source.file) });
  assert.equal(absent.complete, false);
  assert.ok(absent.unresolved.some(item => item.code === 'STALE_PLANNED_CASE_SELECTOR'));
  const duplicate = structuredClone(files);
  duplicate[0].contents = duplicate[0].contents.replace(JSON.stringify([selector]), JSON.stringify([selector, selector]));
  assert.throws(() => compileValidationSourceInventory({
    files: duplicate, surfacePaths: duplicate.map(source => source.file),
  }), { code: 'INVENTORY' });
});

test('T-PRD002 ESM and CommonJS registration aliases cannot escape the nonexecuting denominator', () => {
  const source = [
    "import test,{test as extra,it as scenario,describe as group} from 'node:test';",
    "import * as runner from 'node:test';",
    "test('ordinary',()=>{});extra('aliased',()=>{});",
    "group('suite',()=>{scenario('leaf',()=>{});});runner.test('namespaced',()=>{});",
    "throw new Error('Never execute candidate discovery');",
  ].join('\n');
  const esm = discoverDeclarations(source, 'test/nested/aliases.test.js');
  assert.deepEqual(esm.unresolved, []);
  assert.deepEqual(esm.cases.map(test => [test.name, test.parents]),
    [['ordinary', []], ['aliased', []], ['suite', []], ['leaf', ['suite']], ['namespaced', []]]);
  const cjs = discoverDeclarations([
    'exports.validationDeclarations = {"schemaVersion":1};',
    "const {test: extra,it: scenario}=require('node:test');",
    "const runner=require('node:test');const alias=extra;",
    "extra('aliased CommonJS',()=>{});scenario('CommonJS it',()=>{});",
    "runner.test('CommonJS namespace',()=>{});alias('simple alias',()=>{});",
  ].join('\n'), 'test/nested/aliases.test.cjs');
  assert.deepEqual(cjs.unresolved, []);
  assert.deepEqual(cjs.cases.map(test => test.name),
    ['aliased CommonJS', 'CommonJS it', 'CommonJS namespace', 'simple alias']);
  for (const extra of [
    "const unrecognized=test.bind(null);unrecognized('hidden',()=>{});",
    "test['test']('hidden',()=>{});",
  ]) assert.ok(discoverDeclarations(source + extra, 'test/nested/aliases.test.js')
    .unresolved.some(item => item.code === 'UNSUPPORTED_TEST_REGISTRATION_ALIAS'));
  for (const dynamic of [
    "const {it:extra}=await import('node:test');extra('omitted failure',()=>{throw Error('hidden failure');});",
    "const runner=await import('node:test');runner.test('omitted failure',()=>{});",
    "import('node:test').then(({test:extra})=>extra('omitted failure',()=>{}));",
  ]) {
    const declaration = discoverDeclarations(source + dynamic, 'test/nested/aliases.test.js');
    assert.ok(declaration.unresolved.some(item => item.code === 'UNSUPPORTED_DYNAMIC_TEST_IMPORT_BINDING'),
      'A known passing registration must not hide an unsupported dynamic registration source');
    const compiled = compileValidationSourceInventory({
      files: [{ file: 'test/nested/aliases.test.js', contents: source + dynamic }],
      surfacePaths: [],
    });
    assert.equal(compiled.complete, false);
    assert.ok(compiled.nodeUnresolved.some(item => item.code === 'UNSUPPORTED_DYNAMIC_TEST_IMPORT_BINDING'));
  }
  for (const operand of [
    "'node:test'", '"node:test"', '`node:test`', "('node:test')",
    '((/* around literal */ "node:test" /* after */))',
    '( // outer wrapper\n ( /* inner */ `node:test` ) )',
    "'node\\u003atest'", '`node\\x3atest`', "'node\\u{3a}test'",
    "'node:\\\ntest'", `${'('.repeat(128)}\`node:test\`${')'.repeat(128)}`,
    "( /* outer */ ('node\\x3atest') /* done */ )",
    "'node:' + 'test'", "('node:' + (`te` + 'st'))", "`node:test` + ''",
    "'node:test' + ('' || '')",
  ]) {
    for (const dynamic of [
      `const {it:dynamicCase}=await import(${operand});dynamicCase('omitted failure',()=>{});`,
      `const dynamicRunner=await import(${operand});dynamicRunner.test('omitted failure',()=>{});`,
      `import(${operand}).then(({test:dynamicCase})=>dynamicCase('omitted failure',()=>{}));`,
    ]) {
      const compiled = compileValidationSourceInventory({
        files: [{ file: 'test/nested/aliases.test.js', contents: source + dynamic }],
        surfacePaths: [],
      });
      assert.equal(compiled.complete, false, `Dynamic node:test operand must not escape: ${operand}`);
      assert.ok(compiled.nodeUnresolved.some(item => item.code === 'UNSUPPORTED_DYNAMIC_TEST_IMPORT_BINDING'));
    }
  }
  for (const operand of [
    "'node:fs/promises'", '`node:fs/promises`',
    '( /* wrappers */ ( `node:\\u0066s/promises` ) )',
    "'node:test/reporters'", "(( 'node:\\\nfs/promises' ))",
    "'node:test' + '/reporters'", "('node:' + (`fs` + '/promises'))",
    "( ('node:' /* split */ + 'test/reporters') )",
  ]) assert.deepEqual(discoverDeclarations(source + `const dependency=await import(${operand});`,
    'test/nested/aliases.test.js').unresolved, [], 'Unrelated dynamic modules remain valid');
});

test('T-PRD002 native skip dispositions require an owner, actual platforms and declared prerequisites', () => {
  const body = "import test from 'node:test';" +
    "test('native owned case',{skip:process.platform!=='win32'},()=>{});";
  assert.ok(discoverDeclarations(body, 'test/native.test.mjs').unresolved.some(item =>
    item.code === 'UNOWNED_SKIP_DISPOSITION'));
  assert.ok(discoverDeclarations("import test from 'node:test';test.skip('native owned case',()=>{});",
    'test/native.test.mjs').unresolved.some(item => item.code === 'UNOWNED_SKIP_DISPOSITION'));
  const policy = { names: ['native owned case'], platforms: ['windows-x64'],
    owner: 'native-fixture', reason: 'Real native adapter required',
    prerequisites: ['verified Windows launcher'] };
  const source = applicability => `export const validationDeclarations = ${JSON.stringify({
    schemaVersion: 1, applicability,
  })};${body}`;
  const valid = discoverDeclarations(source([policy]), 'test/native.test.mjs');
  assert.deepEqual(valid.unresolved, []);
  assert.deepEqual(valid.cases[0].applicability, {
    platforms: ['windows-x64'], owner: 'native-fixture', reason: 'Real native adapter required',
    prerequisites: ['verified Windows launcher'],
  });
  for (const mutate of [
    value => { delete value.owner; }, value => { value.owner = ''; },
    value => { delete value.platforms; }, value => { value.platforms = []; },
    value => { value.platforms = ['translated-macos']; },
    value => { value.platforms = ['windows-x64', 'windows-x64']; },
    value => { delete value.prerequisites; }, value => { value.prerequisites = 'launcher'; },
    value => { value.prerequisites = ['']; }, value => { value.prerequisites = [{ available: true }]; },
  ]) {
    const invalid = structuredClone(policy);
    mutate(invalid);
    assert.throws(() => discoverDeclarations(source([invalid]), 'test/native.test.mjs'),
      error => error.code === 'INVENTORY' && /native assignments, owner, reason and prerequisites/u.test(error.message));
  }
});

test('T-PRD001 independent packaged JS tests remain accounted NotRun instead of becoming framework passes', () => {
  const declaration = { schemaVersion: 1, projects: [{
    root: 'test/example', files: ['test/example/test/example.test.cjs'],
    coverage: 'fixture-only', owner: 'example-owner',
    reason: 'Independent frozen example, not a framework acceptance execution',
    command: ['node', '--test', 'test/*.test.cjs'], prerequisites: ['example assets'],
  }] };
  const files = [
    { file: 'test/accounting.test.mjs', contents: `export const validationDeclarations = ${
      JSON.stringify(declaration)};import test from 'node:test';test('framework assertion',()=>{});` },
    { file: 'test/example/package.json', contents: '{"scripts":{"test":"node --test test/*.test.cjs"}}' },
    { file: 'test/example/test/example.test.cjs',
      contents: "const {test: scenario}=require('node:test');scenario('independent assertion',()=>{});" },
  ];
  const surfacePaths = files.map(source => source.file);
  assert.deepEqual(validationSourcePaths(surfacePaths), [...surfacePaths].sort());
  const inventory = compileValidationSourceInventory({ files, surfacePaths });
  assert.equal(inventory.complete, true);
  assert.deepEqual(inventory.cases.map(test => test.name), ['framework assertion']);
  assert.equal(inventory.sourceFiles.length, 3);
  assert.equal(inventory.independentProjects[0].status, 'NotRun');
  assert.deepEqual(inventory.independentProjects[0].cases.map(test => test.name), ['independent assertion']);
  assert.ok(inventory.coverageGaps.some(project => project.root === 'test/example'));
  const undeclared = files.map(source => source.file === files[0].file ? {
    ...source, contents: "import test from 'node:test';test('framework assertion',()=>{});",
  } : source);
  assert.ok(compileValidationSourceInventory({ files: undeclared, surfacePaths })
    .unresolved.some(item => item.code === 'UNCLASSIFIED_NODE_PROJECT'));
  for (const change of [
    values => values.filter(source => source.file !== files[2].file),
    values => values.map(source => source.file === files[2].file ?
      { ...source, file: 'test/example/test/renamed.test.cjs' } : source),
    values => [...values, { file: 'test/example/test/new.test.js',
      contents: "const test=require('node:test');test('new independent assertion',()=>{});" }],
  ]) {
    const changed = change(structuredClone(files));
    const current = compileValidationSourceInventory({
      files: changed, surfacePaths: changed.map(source => source.file),
    });
    assert.equal(current.complete, false);
    assert.ok(current.unresolved.some(item =>
      ['STALE_PROJECT_TEST', 'UNASSIGNED_PROJECT_TEST'].includes(item.code)));
    assert.equal(compareValidationInventory(current, inventory).complete, false);
  }
});

test('T-PRD001 API-acquired source and tree paths compile without executing candidate code or narrowing surfaces', () => {
  const file = 'test/consumer.test.mjs';
  const contents = 'export const validationDeclarations = {"schemaVersion":1,' +
    '"surfaces":[{"coverage":"direct","paths":["src/utility.mjs"]}]};\n' +
    "throw new Error('Candidate source must never execute');\n" +
    "import test from 'node:test';test('original assertion',()=>{});";
  const files = [{ file, contents }];
  const surfacePaths = ['README.md', file, 'src/utility.mjs'];
  const inventory = compileValidationSourceInventory({ files, surfacePaths });
  assert.equal(inventory.complete, true);
  assert.deepEqual(inventory.unresolved, []);
  assert.deepEqual(inventory.files, [{ file, sourceDigest: digest(contents) }]);
  assert.deepEqual(inventory.cases, discoverDeclarations(contents, file).cases);
  assert.deepEqual(inventory.surfaces.map(surface => surface.path), ['src/utility.mjs']);
  const added = compileValidationSourceInventory({
    files, surfacePaths: [...surfacePaths, 'scripts/unmapped.mjs'],
  });
  assert.ok(added.unresolved.some(item => item.code === 'UNMAPPED_EXECUTABLE_SURFACE'));
  const removed = compileValidationSourceInventory({ files, surfacePaths: [file] });
  assert.ok(removed.unresolved.some(item => item.code === 'STALE_EXECUTABLE_SURFACE'));
  assert.deepEqual(compileValidationSourceInventory({
    files, surfacePaths: [...surfacePaths].reverse(),
  }), inventory);
  for (const invalid of [
    { files: [...files, ...files], surfacePaths },
    { files: [{ ...files[0], file: '../test/consumer.test.mjs' }], surfacePaths },
    { files: [{ ...files[0], file: 'test\\consumer.test.mjs' }], surfacePaths },
    { files, surfacePaths: [...surfacePaths, '../outside.mjs'] },
    { files, surfacePaths: [...surfacePaths, 'src/utility.mjs'] },
    { files: [], surfacePaths },
  ]) assert.throws(() => compileValidationSourceInventory(invalid), /inventory/iu);
});

test('T-PRD001 current source declares every test variant, utility surface and native skip owner without execution credit', async () => {
    const inventory = await compileValidationInventory(process.cwd());
    assert.deepEqual(inventory.unresolved, []);
    assert.equal(inventory.complete, true);
    const files = [];
    const walk = async directory => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (entry.name.startsWith('.runner-fixture-') ||
          ['node_modules', '.git', '.test-data'].includes(entry.name)) continue;
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(file);
        else if (/\.test\.(?:mjs|js|cjs)$/u.test(entry.name)) files.push(file.split(path.sep).join('/'));
      }
    };
    await walk('test');
    const accounted = [...inventory.files, ...inventory.independentProjects.flatMap(project => project.files)]
      .map(file => file.file);
    assert.deepEqual(accounted.sort(), files.sort());
    assert.ok(inventory.cases.length > inventory.files.length);
    assert.equal(new Set(inventory.cases.map(test => test.id)).size, inventory.cases.length);
    assert.ok(inventory.cases.every(test => test.applicability.platforms.length));
    assert.ok(inventory.surfaces.some(surface => surface.path === 'scripts/test-worker.mjs' &&
      surface.coverage === 'process'));
    assert.ok(inventory.coverageGaps.some(surface => surface.coverage === 'fixture-only'));
    const calculator = inventory.independentProjects.find(project => project.root === 'test/calculator');
    assert.equal(calculator.status, 'NotRun');
    assert.ok(calculator.cases.length > 0);
    assert.deepEqual(calculator.files.map(file => file.file), [
      'test/calculator/test/calculator.test.js', 'test/calculator/test/static-contract.test.js',
    ]);
    assert.ok(inventory.sourceFiles.some(file => file.file === 'test/calculator/package.json'));
    assert.ok(!inventory.files.some(file => file.file.startsWith('test/calculator/')));
    assert.ok(!Object.hasOwn(inventory, 'Passed'));
    const shards = partitionValidationInventory(inventory, 4);
    assert.equal(new Set(shards.flatMap(shard => shard.assertionIds)).size, inventory.cases.length);
  });

test('T-PRD017 recursive source additions, renames and deletions retain exact shard multiplicity', async t => {
  const root = await fs.mkdtemp(path.join(process.cwd(), '.test-data', 'shard-mutations-'));
  t.after(() => fs.rm(root, { recursive: true }));
  await fs.mkdir(path.join(root, 'test', 'nested'), { recursive: true });
  const first = path.join(root, 'test', 'nested', 'heavy.test.js');
  const second = path.join(root, 'test', 'light.test.cjs');
  await fs.writeFile(first, "const test=require('node:test');test('heavy first',()=>{});test('heavy second',()=>{});");
  const original = await compileValidationInventory(root);
  const assertUnion = inventory => {
    const shards = partitionValidationInventory(inventory, 3);
    const ids = shards.flatMap(shard => shard.assertionIds);
    assert.deepEqual([...ids].sort(), inventory.cases.map(test => test.id).sort());
    assert.equal(ids.length, inventory.cases.length);
    for (const id of inventory.cases.map(test => test.id)) assert.equal(ids.filter(value => value === id).length, 1);
    assert.deepEqual(shards.flatMap(shard => shard.files).sort(), inventory.files.map(file => file.file).sort());
  };
  assertUnion(original);
  await fs.writeFile(second, "const {test: extra}=require('node:test');extra('new CJS assertion',()=>{});");
  const added = await compileValidationInventory(root);
  assertUnion(added);
  assert.equal(compareValidationInventory(added, original).added.length, 1);
  const renamed = path.join(root, 'test', 'nested', 'renamed.test.js');
  await fs.rename(first, renamed);
  const moved = await compileValidationInventory(root);
  assertUnion(moved);
  const comparison = compareValidationInventory(moved, added);
  assert.equal(comparison.added.length, 2);
  assert.equal(comparison.removed.length, 2);
  await fs.unlink(second);
  const deleted = await compileValidationInventory(root);
  assertUnion(deleted);
  assert.equal(compareValidationInventory(deleted, moved).removed.length, 1);
  assert.throws(() => partitionValidationInventory({
    ...deleted, cases: [...deleted.cases, deleted.cases[0]],
  }, 2), { code: 'INVENTORY' });
});

  test('T-PRD017 independent file shards retain the exact assertion union and disregard stale scheduling hints', () => {
    const files = ['test/heavy.test.mjs', 'test/light.test.mjs', 'test/new.test.mjs'];
    const inventory = { complete: true, files: files.map(file => ({ file })),
      cases: files.map((file, index) => ({
        id: `assertion-${index}`, file, sourceDigest: digest(file),
      })) };
    const shards = partitionValidationInventory(inventory, 2, [
      { assertionId: 'assertion-0', sourceDigest: digest(files[0]), durationMs: 1000 },
      { assertionId: 'assertion-1', sourceDigest: 'stale', durationMs: 50000 },
    ]);
    assert.equal(shards[0].files[0], files[0]);
    assert.equal(shards[0].durationMs, 1000);
    assert.equal(shards[1].durationMs, 0);
    assert.deepEqual(new Set(shards.flatMap(shard => shard.files)), new Set(files));
    assert.throws(() => partitionValidationInventory({ ...inventory, complete: false }, 2));
    assert.throws(() => partitionValidationInventory(inventory, 33));
  });

  test('T-PRD013 process-isolated retention scheduling preserves the original ordered exhaustion assertions and identity', async () => {
    const inventory = await compileValidationInventory(process.cwd());
    const original = inventory.cases.filter(test =>
      test.name === 'FR-063/064 real refresh and prune archive superseded observations/facts before exhaustion');
    assert.equal(original.length, 1);
    assert.equal(original[0].file, 'test/observation-retention-refresh.test.mjs');
    assert.equal(original[0].id, 'assertion-8dc566af6d5f4cba896fde6196863255393355cf4a0450e3bbe3d515788358eb');
    assert.equal(original[0].definitionDigest, '223b543cd32b194dffc9c7c3eb2328e5dd7af64cd1df41de517907ed1b7521b6');
    const scenario = runRefreshScenario.toString().replace(/\r\n/gu, '\n')
      .replace(/^async function runRefreshScenario\(t\) \{/u,
        `test('${original[0].name}', async t => {`)
      .replace(/\n  return \{ fixtureRoot: f\.root \};\n\}$/u, '\n});');
    const preserved = discoverDeclarations(scenario, original[0].file);
    assert.deepEqual(preserved.unresolved, []);
    assert.equal(preserved.cases.length, 1);
    assert.equal(preserved.cases[0].definitionDigest,
      'f03ae57142aa5719195f61fa979581e7ac2e42d82ce8909656eb9a96c0383d3b');
    const shards = partitionValidationInventory(inventory, 4, [{
      assertionId: original[0].id, sourceDigest: original[0].sourceDigest, durationMs: 100000,
    }]);
    assert.equal(shards[0].files[0], original[0].file);
    assert.equal(shards.flatMap(shard => shard.assertionIds)
      .filter(id => id === original[0].id).length, 1);
  });

test('T-PRD013 measured GitHub process partitions preserve every original assertion and callback definition', async () => {
  const operationFamily = 'test/github-operation-results.unit.test.mjs';
  const boundaryFamily = 'test/github-existing-consumer-boundaries.unit.test.mjs';
  const files = [
    operationFamily, 'test/github-operation-dispatch.unit.test.mjs',
    'test/github-operation-publication.unit.test.mjs', boundaryFamily,
    'test/github-consumer-refresh.unit.test.mjs', 'test/github-consumer-source.unit.test.mjs',
    'test/github-consumer-policy.unit.test.mjs',
  ];
  const declarations = await Promise.all(files.map(async file =>
    discoverDeclarations(await fs.readFile(path.join(...file.split('/')), 'utf8'), file)));
  assert.deepEqual(declarations.flatMap(file => file.unresolved), []);
  assert.deepEqual(declarations.map(file => file.declared.assertionNamespace),
    [operationFamily, operationFamily, operationFamily,
      boundaryFamily, boundaryFamily, boundaryFamily, boundaryFamily]);
  const snapshotId = 'assertion-2be026a15f5d572e8573f9b9a31de64fea9d53fec0ac215767c7bc378901c216';
  const allCases = declarations.flatMap(file => file.cases);
  const snapshot = allCases.filter(test => test.id === snapshotId);
  assert.equal(snapshot.length, 1);
  assert.equal(snapshot[0].file, boundaryFamily);
  assert.equal(snapshot[0].name,
    'fixture byte snapshots bound fresh reads and drain failures without caching or losing lock exclusions');
  assert.deepEqual(snapshot[0].parents, []);
  assert.equal(allCases.length, 144);
  assert.equal(new Set(allCases.map(test => test.id)).size, allCases.length);
  const originals = declarations.map(file => file.cases.filter(test => test.id !== snapshotId));
  assert.deepEqual(originals.map(cases => cases.filter(test => !test.parents.length).length),
    [2, 1, 1, 1, 1, 1, 1]);
  const assertions = originals.flat().map(test => ({
    id: test.id, parents: test.parents, name: test.name, definitionDigest: test.definitionDigest,
  })).sort((left, right) => left.id.localeCompare(right.id, 'en'));
  assert.equal(assertions.length, 143);
  assert.equal(new Set(assertions.map(test => test.id)).size, assertions.length);
  assert.equal(digest(assertions), '04af554a098d1422688e958a838c68c70b0a576f699e3d509dbfac7c943f8a2a');
});

  test('T-PRD016 actual case observations, not a green exit or producer denominator, determine completeness', () => {
    const file = 'test/orders.test.mjs';
    const discovered = discoverDeclarations("import test from 'node:test';test('preserves orders',()=>{});", file);
    const inventory = { ...discovered, complete: true, files: [{ file }],
      digest: digest('independently selected inventory') };
    const report = { platform: 'win32', architecture: 'x64', files: [file],
      complete: true, exitCode: 0,
      summary: { success: true, counts: { tests: 1, cancelled: 0 } },
      executions: [{ file, name: 'preserves orders', parents: [], status: 'Passed',
        nameDigest: digest('preserves orders'), parentDigests: [], sequence: 1,
        observedAt: '2026-10-18T10:00:00.000Z' }] };
    assert.equal(reconcileNodeExecution(inventory, report, { platform: 'windows-x64' }).status, 'Passed');
    for (const mutate of [
      value => { value.executions = []; value.summary.counts.tests = 0; },
      value => { value.executions[0].status = 'Skipped'; },
      value => { value.complete = false; },
      value => { value.architecture = 'arm64'; },
      value => { value.executions.push(structuredClone(value.executions[0])); value.summary.counts.tests = 2; },
      value => { value.executions[0].nameDigest = digest('other selector'); },
      value => { delete value.executions[0].parentDigests; },
      value => { value.executions[0] = null; },
      value => { value.executions[0].name = 'different case'; value.executions[0].nameDigest = digest('different case'); },
    ]) {
      const changed = structuredClone(report);
      mutate(changed);
      assert.equal(reconcileNodeExecution(inventory, changed, { platform: 'windows-x64' }).status, 'NotRun');
    }
    const failed = structuredClone(report);
    failed.exitCode = 1;
    failed.summary.success = false;
    failed.executions[0].status = 'Failed';
    assert.equal(reconcileNodeExecution(inventory, failed, { platform: 'windows-x64' }).status, 'Failed');
  });

test('T-PRD016 reconciliation matches full nested selectors and preserves missing, skipped and cancelled diagnostics', () => {
  const file = 'test/orders.test.mjs';
  const discovered = discoverDeclarations("import test from 'node:test';" +
    "test('outer',async t=>{await t.test('first',async context=>{" +
    "await context.test('same leaf',()=>{});});" +
    "await t.test('second',async context=>{await context.test('same leaf',()=>{});});});", file);
  const inventory = { ...discovered, files: [{ file }], complete: true,
    digest: digest('nested independently selected inventory') };
  const rows = discovered.cases.map((test, index) => ({
    file, name: test.name, parents: test.parents, status: 'Passed',
    nameDigest: digest(test.name), parentDigests: test.parents.map(name => digest(name)),
    sequence: index + 1, observedAt: '2026-10-18T10:00:00.000Z',
  }));
  const report = executions => ({ platform: 'win32', architecture: 'x64', files: [file],
    complete: true, exitCode: 0, summary: { success: true,
      counts: { tests: executions.length, cancelled: 0 } }, executions });
  const selection = { platform: 'windows-x64', pattern: '^outer first(?: same leaf)?$' };
  const first = rows.filter(row => row.parents[0] === 'outer' &&
    (row.name === 'first' || row.parents[1] === 'first'));
  const result = reconcileNodeExecution(inventory, report(first), selection);
  assert.equal(result.status, 'Passed');
  assert.equal(result.counts.required, 2);
  assert.deepEqual(result.cases.map(test => test.parents), [['outer'], ['outer', 'first']]);
  assert.equal(reconcileNodeExecution(inventory, report(rows), {
    platform: 'windows-x64', pattern: '^outer$',
  }).status, 'Passed', 'A matching ancestor also executes its complete descendant inventory');
  const missing = reconcileNodeExecution(inventory, report(first.slice(0, 1)), selection);
  assert.equal(missing.status, 'NotRun');
  assert.ok(missing.blockers.some(item => item.code === 'MISSING_REQUIRED_OBSERVATION'));
  for (const status of ['Skipped', 'Todo', 'Cancelled']) {
    const changed = structuredClone(first);
    Object.assign(changed[1], { status, skipReason: status === 'Skipped' ? 'missing adapter' : null,
      todoReason: status === 'Todo' ? 'not yet implemented' : null,
      diagnostic: status === 'Cancelled' ? { message: 'interrupted by SIGTERM' } : undefined });
    const actual = reconcileNodeExecution(inventory, report(changed), selection);
    assert.equal(actual.status, 'NotRun');
    assert.equal(actual.cases[1].rawStatus, status);
    assert.ok(actual.blockers.some(item =>
      item.code === 'UNEXECUTED_REQUIRED_ASSERTION' && item.rawStatus === status && item.reason));
  }
  const wrongParent = structuredClone(first);
  wrongParent[1].parents = ['outer', 'second'];
  wrongParent[1].parentDigests = wrongParent[1].parents.map(name => digest(name));
  assert.ok(reconcileNodeExecution(inventory, report(wrongParent), selection).blockers.some(item =>
    item.code === 'UNMAPPED_OBSERVATION'));
  const catalog = discoverDeclarations("import test from 'node:test';test('suite',async t=>{" +
    "await t.test('active',()=>{});await t.test('never started',()=>{});});", file).cases;
  const active = catalog.find(test => test.name === 'active');
  const start = { kind: 'start', file, name: active.name, nesting: 1,
    line: active.line, column: active.column, sequence: 7, observedAt: '2026-10-19T20:00:00.000Z' };
  const cancellation = { cases: catalog, starts: [start], executions: [], producerPid: 123,
    interruption: { signal: 'SIGTERM', producerPid: 123, sequence: 8,
      observedAt: '2026-10-19T20:00:01.000Z' } };
  const closed = cancelledNodeStarts(cancellation);
  assert.deepEqual(closed.map(row => [row.name, row.parents, row.status, row.durationMs]),
    [['active', ['suite'], 'Cancelled', null]]);
  assert.deepEqual(closed[0].cancellation, {
    signal: 'SIGTERM', producerPid: 123, startedSequence: 7, interruptionSequence: 8,
  });
  for (const change of [
    { starts: [] }, { starts: [{ ...start, kind: 'registration' }] },
    { starts: [start, start] }, { starts: [{ ...start, name: 'unknown' }] },
    { starts: [{ ...start, name: file, nesting: 0 }] }, { interruption: null },
    { interruption: { ...cancellation.interruption, producerPid: 999 } },
    { interruption: { ...cancellation.interruption, sequence: 7 } },
    { interruption: { ...cancellation.interruption, observedAt: '2026-10-19T19:59:59.000Z' } },
    { executions: [{ file, name: active.name, parents: ['suite'], status: 'Passed' }] },
    { executions: [{ file, name: active.name, parents: ['unknown parent'], status: 'Passed' }] },
    { executions: closed },
  ]) assert.deepEqual(cancelledNodeStarts({ ...cancellation, ...change }), []);
  const suite = catalog.find(test => test.name === 'suite');
  const suiteStart = { ...start, name: suite.name, nesting: 0,
    line: suite.line, column: suite.column, sequence: 6 };
  assert.deepEqual(cancelledNodeStarts({ ...cancellation, starts: [suiteStart, start] })
    .map(row => [row.name, row.parents]), [['suite', []], ['active', ['suite']]]);
  assert.deepEqual(cancelledNodeStarts({ ...cancellation, starts: [suiteStart, start],
    executions: [{ file, name: 'suite', parents: [], status: 'Passed' }] })
    .map(row => row.name), ['active']);
  assert.equal(nodeStartDefinition(discovered.cases, {
    file, name: 'same leaf', nesting: 2,
  }), null, 'Ambiguous concurrent ancestry cannot manufacture a cancellation selector');
  const secondLeaf = discovered.cases.find(test => test.name === 'same leaf' && test.parents[1] === 'second');
  assert.equal(nodeStartDefinition(discovered.cases, {
    file, name: 'same leaf', nesting: 2, parents: ['outer', 'second'],
  }).id, secondLeaf.id);
});

test('T-PRD003 added, removed, renamed and unbound executable inputs cannot reuse an adopted denominator', async t => {
  const root = await fs.mkdtemp(path.join(process.cwd(), '.test-data', 'inventory-contract-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.join(process.cwd(), '.test-data'));
    await fs.rm(root, { recursive: true });
  });
  await fs.mkdir(path.join(root, 'test'));
  const file = path.join(root, 'test', 'orders.test.mjs');
  await fs.writeFile(file, "import test from 'node:test';test('preserves orders',()=>{});\n");
  const baseline = await compileValidationInventory(root);
  assert.deepEqual(compileValidationSourceInventory({
    files: [{ file: 'test/orders.test.mjs', contents: await fs.readFile(file, 'utf8') }],
    surfacePaths: ['test/orders.test.mjs'],
  }), baseline, 'Filesystem and API readers must use the same declaration compiler and digest');
  assert.equal(compareValidationInventory(baseline, baseline).complete, true);
  await fs.writeFile(file, "import test from 'node:test';test('renamed case',()=>{});\n");
  const renamed = compareValidationInventory(await compileValidationInventory(root), baseline);
  assert.equal(renamed.complete, false);
  assert.equal(renamed.added.length, 1);
  assert.equal(renamed.removed.length, 1);
  await fs.mkdir(path.join(root, 'src'));
  await fs.writeFile(path.join(root, 'src', 'new-utility.mjs'), 'export const utility = true;\n');
  const unbound = await compileValidationInventory(root);
  assert.equal(unbound.complete, false);
  assert.ok(unbound.unresolved.some(item => item.code === 'UNMAPPED_EXECUTABLE_SURFACE'));
  await fs.writeFile(path.join(root, 'test', 'additional.test.mjs'),
    "import test from 'node:test';test('additional case',()=>{});\n");
  assert.equal(compareValidationInventory(await compileValidationInventory(root), baseline).complete, false);
  await fs.rm(file);
  assert.equal(compareValidationInventory(await compileValidationInventory(root), baseline).complete, false);
});

test('T-PRD083 coverage is compiled from definition fields, not prose or status claims', () => {
  const input = specification();
  const metadata = prepareCoverage(input);
  assert.deepEqual(metadata.coverage, [
    { requirement: 'FR-901', condition: 'AC-901.1', tests: ['T-ORDER-1', 'T-ORDER-2'] },
    { requirement: 'FR-901', condition: 'AC-901.2', tests: ['T-ORDER-2'] },
  ]);
  assert.deepEqual(metadata.uncovered, []);
  assert.equal(metadata.requirements[0].sha256, digest(input.requirements[0].contents));
  assert.equal(metadata.testPlans[0].definitionDigest,
    testSpecificationDigest(input.testPlans[0].contents));
  assert.ok(!JSON.stringify(metadata).includes('Passed'));
  const body = replaceCoverageSection('## Purpose\nPreserve existing user notes.', metadata);
  assert.deepEqual(readCoverageSection(body), metadata);
  assert.equal(inspectCoverage({ ...input, body }).complete, true);
  assert.deepEqual(prepareCoverage(input), metadata);
});

test('T-PRD083 incomplete coverage identifies exact AC gaps and never claims execution', () => {
  const input = specification();
  input.testPlans[0].contents = input.testPlans[0].contents.replace('AC-901.1; AC-901.2', 'AC-901.1');
  const metadata = prepareCoverage(input);
  assert.deepEqual(metadata.uncovered, ['AC-901.2']);
  const report = inspectCoverage({ ...input, body: renderCoverageSection(metadata) });
  assert.equal(report.complete, false);
  assert.equal(report.required, 2);
  assert.equal(report.covered, 1);
  assert.deepEqual(report.diagnostics.find(item => item.code === 'UNCOVERED_CRITERIA').ids,
    ['AC-901.2']);
  assert.ok(!Object.hasOwn(report, 'status'));
  for (const status of ['Passed', 'Failed']) {
    const changed = structuredClone(input);
    changed.testPlans[0].contents = changed.testPlans[0].contents.replaceAll('NotRun', status);
    assert.deepEqual(prepareCoverage(changed), metadata);
  }
});

test('T-PRD083 source, definitions and mappings are independently compared with PR metadata', () => {
  const input = specification();
  const original = prepareCoverage(input);
  const body = renderCoverageSection(original);
  for (const [change, code] of [
    [value => { value.sourceRevision = 'b'.repeat(40); }, 'STALE_SOURCE'],
    [value => { value.requirements[0].contents += '\nA changed requirement constraint.\n'; },
      'STALE_SPECIFICATION'],
    [value => { value.testPlans[0].contents = value.testPlans[0].contents.replace(
      'test/orders.mjs#restart', 'test/orders.mjs#different assertion'); }, 'STALE_SPECIFICATION'],
  ]) {
    const changed = structuredClone(input);
    change(changed);
    const result = inspectCoverage({ ...changed, body });
    assert.equal(result.complete, false);
    assert.ok(result.diagnostics.some(item => item.code === code));
  }
  const edited = structuredClone(original);
  edited.coverage[0].tests = ['T-ORDER-2'];
  const result = inspectCoverage({ ...input, body: renderCoverageSection(edited) });
  assert.equal(result.complete, false);
  assert.ok(result.diagnostics.some(item => item.code === 'COVERAGE_MISMATCH'));
});

test('T-PRD083 malformed or ambiguous documents cannot silently reduce the denominator', () => {
  const original = specification();
  for (const change of [
    value => { value.requirements[0].contents += '\n### FR-901: Duplicate\n**Definition of Done**\n- AC-901.3: Duplicate owner.\n'; },
    value => { value.requirements[0].contents = value.requirements[0].contents.replace(
      '- AC-901.1:', '- AC-901.1: Duplicate definition.\n- AC-901.1:'); },
    value => { value.requirements[0].contents = value.requirements[0].contents.replace('**Definition of Done**', 'General checklist'); },
    value => { value.requirements[0].contents = value.requirements[0].contents.replace('- AC-901.2:', '- AC-999.2:'); },
    value => { value.testPlans[0].contents = value.testPlans[0].contents.replace('T-ORDER-2', 'T-ORDER-1'); },
    value => { value.testPlans[0].contents = value.testPlans[0].contents.replace('AC-901.2', 'AC-901.99'); },
    value => { value.testPlans[0].contents = value.testPlans[0].contents.replaceAll('| FR-901 |', '| FR-999 |'); },
    value => { value.testPlans[0].contents = value.testPlans[0].contents.replace('Conditions |', 'Requirements |'); },
    value => { value.testPlans[0].contents = value.testPlans[0].contents.replace('FR-901 | AC-901.1', 'FR-901 through FR-999 | AC-901.1'); },
    value => { value.requirements[0].path = '../requirements.md'; },
    value => { value.testPlans[0].path = '.sdlc/test-plan.md'; },
    value => { value.testPlans = []; },
  ]) {
    const changed = structuredClone(original);
    change(changed);
    assert.throws(() => prepareCoverage(changed), error =>
      ['COVERAGE', 'INPUT'].includes(error.code));
  }
});

test('T-PRD083 multiple canonical documents compose without duplicate or orphan identities', () => {
  const input = specification();
  const second = specification();
  second.requirements[0].artifactId = 'payments';
  second.requirements[0].path = 'docs/payments/requirements.md';
  second.requirements[0].contents = second.requirements[0].contents.replaceAll('901', '902');
  second.testPlans[0].artifactId = 'payments';
  second.testPlans[0].path = 'docs/payments/test-plan.md';
  second.testPlans[0].contents = second.testPlans[0].contents
    .replaceAll('901', '902').replaceAll('T-ORDER-', 'T-PAYMENT-');
  input.requirements.push(second.requirements[0]);
  input.testPlans.push(second.testPlans[0]);
  const metadata = prepareCoverage(input);
  assert.equal(metadata.coverage.length, 4);
  input.requirements.reverse();
  input.testPlans.reverse();
  assert.deepEqual(prepareCoverage(input), metadata);
  assert.equal(inspectCoverage({ ...input, body: renderCoverageSection(metadata) }).complete, true);
  input.testPlans[0].contents = input.testPlans[0].contents.replace('T-PAYMENT-1', 'T-ORDER-1');
  assert.throws(() => prepareCoverage(input), { code: 'COVERAGE' });
});

test('T-PRD083 PR section updates preserve unrelated text and reject malformed duplicate sections', () => {
  const input = specification();
  const metadata = prepareCoverage(input);
  const section = renderCoverageSection(metadata);
  const body = `Human prefix.\r\n\r\n${section}\r\n\r\nHuman suffix.`;
  const updatedMetadata = prepareCoverage({ ...input, sourceRevision: 'c'.repeat(40) });
  const updated = replaceCoverageSection(body, updatedMetadata);
  assert.equal(updated, body.replace(section, renderCoverageSection(updatedMetadata)));
  assert.deepEqual(readCoverageSection(updated), updatedMetadata);
  for (const invalid of [
    'No coverage.',
    `${section}\n${section}`,
    section.replace('sdlc-coverage:v1', 'sdlc-coverage:v2'),
    section.replace('```json', '```javascript'),
    section.replace('"schemaVersion": 1', '"schemaVersion": 99'),
    section.replace('"sourceRevision":', '"unexpected": true,\n"sourceRevision":'),
    section.replace('"schemaVersion": 1', '"schemaVersion":'),
  ]) {
    const result = inspectCoverage({ ...input, body: invalid });
    assert.equal(result.complete, false);
    assert.ok(result.diagnostics.length > 0);
  }
  assert.throws(() => replaceCoverageSection(`${section}\n${section}`, metadata),
    { code: 'COVERAGE' });
});

test('T-PRD083 legacy JSON plan definitions and escaped table cells keep their declared identities', () => {
  const input = specification();
  const { sourceRevision, ...sources } = input;
  const compiled = compileCoverage(sources);
  input.testPlans[0].contents = JSON.stringify({
    tests: compiled.tests.map(({ outOfScope, ...item }) => item),
  });
  assert.equal(prepareCoverage(input).coverage.length, 2);
  input.testPlans[0].contents = specification().testPlans[0].contents
    .replace('failed write |', 'failed\\|write |');
  const changed = compileCoverage({ ...sources, testPlans: input.testPlans });
  assert.equal(changed.tests[0].implementation, 'test/orders.mjs#failed|write');
});

test('T-PRD083 escaped selectors and expectations retain status-only definition and committed-source identity', async t => {
  const f = await fixture(t, { initialize: false });
  await f.runGit('config', 'core.autocrlf', 'false');
  const input = specification();
  const requirements = input.requirements[0];
  const plan = input.testPlans[0];
  const expected = 'Failed \\| write keeps the original; FR-999 is only prose';
  const implementation = 'test/orders.mjs#failed\\|write';
  const contents = plan.contents.replace('Failed write keeps the original; FR-999 is only prose', expected)
    .replace('test/orders.mjs#failed write', implementation);
  await fs.mkdir(path.join(f.repo, 'docs', 'orders'), { recursive: true });
  await fs.writeFile(path.join(f.repo, requirements.path), requirements.contents);
  await fs.writeFile(path.join(f.repo, plan.path), contents);
  await f.runGit('add', '--', 'docs');
  await f.runGit('commit', '-qm', 'Commit isolated escaped coverage definitions');
  const references = {
    repositoryId: input.repositoryId,
    requirements: [{ artifactId: requirements.artifactId, path: requirements.path }],
    testPlans: [{ artifactId: plan.artifactId, path: plan.path }],
  };
  const prepare = async () => (await runCoverageCommand(f.store, {
    subcommand: 'prepare', cwd: f.repo, flags: {}, input: references,
  })).result;
  const original = await prepare();
  assert.equal(original.sourceMatches, true, JSON.stringify(original.diagnostics));
  const specificationDigest = testSpecificationDigest(contents);
  for (const status of ['Passed', 'Failed']) {
    const projection = contents.replaceAll('| NotRun |', `| ${status} |`);
    await fs.writeFile(path.join(f.repo, plan.path), projection);
    assert.equal(testSpecificationDigest(projection), specificationDigest);
    const current = await prepare();
    assert.equal(current.sourceMatches, true, JSON.stringify(current.diagnostics));
    assert.deepEqual(current.metadata, original.metadata);
    assert.ok(!current.diagnostics.some(item => item.code === 'UNCOMMITTED_SPECIFICATION'));
  }
  for (const definition of [
    contents.replace(implementation, 'test/orders.mjs#different\\|selector'),
    contents.replace(expected, 'A genuinely different \\| expected result'),
  ]) {
    await fs.writeFile(path.join(f.repo, plan.path), definition);
    assert.notEqual(testSpecificationDigest(definition), specificationDigest);
    const current = await prepare();
    assert.equal(current.sourceMatches, false);
    assert.ok(current.diagnostics.some(item => item.code === 'UNCOMMITTED_SPECIFICATION'));
  }
  const left = contents.replace(expected, 'left\\|middle').replace(implementation, 'right');
  const right = contents.replace(expected, 'left').replace(implementation, 'middle\\|right');
  assert.notEqual(testSpecificationDigest(left), testSpecificationDigest(right),
    'A literal pipe cannot be moved across a cell boundary without changing identity');
  assert.notEqual(specificationDigest,
    testSpecificationDigest(contents.replace(implementation, 'test/orders.mjs#failed\\\\|write')),
    'A preserved literal backslash is definition data, not a mutable projection');
});

test('T-PRD083 malformed input diagnostics expose no raw prose and planned bindings stay explicit', () => {
  const input = specification();
  const metadata = prepareCoverage(input);
  const malformed = structuredClone(input);
  malformed.testPlans[0].contents = '{"tests": ["private-prose-not-for-diagnostics"';
  assert.throws(() => prepareCoverage(malformed), error =>
    error.code === 'COVERAGE' && !error.message.includes('private-prose'));
  const edited = { ...metadata, 'private-prose-not-for-diagnostics': true };
  assert.throws(() => renderCoverageSection(edited), error =>
    error.code === 'COVERAGE' && !error.message.includes('private-prose'));
  input.testPlans[0].contents = input.testPlans[0].contents
    .replace('test/orders.mjs#restart', 'planned: test/orders.mjs#restart');
  const prepared = prepareCoverage(input);
  const result = inspectCoverage({ ...input, body: renderCoverageSection(prepared) });
  assert.equal(result.complete, true);
  assert.deepEqual(result.unresolved, ['T-ORDER-2']);
  assert.equal(result.warnings[0].code, 'PLANNED_BINDINGS');
  assert.ok(!JSON.stringify(prepared).includes('Passed'));
});

test('T-PRD083 declared coverage does not impose the managed unit-first policy on a consumer CI plan', () => {
  const input = specification();
  input.testPlans[0].contents = input.testPlans[0].contents
    .replaceAll('| unit |', '| integration |')
    .replaceAll('| pre-review |', '| post-review |');
  const metadata = prepareCoverage(input);
  assert.equal(inspectCoverage({ ...input, body: renderCoverageSection(metadata) }).complete, true);
  assert.deepEqual(metadata.uncovered, []);
  assert.throws(() => validateTestDefinitions([{
    id: 'T-CI', environment: 'local', level: 'integration', checkpoint: 'post-review',
    mode: 'automated', owner: 'provider', location: 'ci',
    implementation: 'consumer:test', expected: 'The declared behavior holds',
  }]), { code: 'INPUT' });
});
