export const validationDeclarations = {
  "schemaVersion": 1
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { enterTestBudget } from '../scripts/test-budget.mjs';
import { executeValidationCommand } from '../scripts/validation-tools.mjs';
import { runRefreshWorker, runRefreshWorkerControl,
  validateRefreshWorkerResult } from './observation-refresh-worker.mjs';

test('T-PRD010 refresh controller owns one closed budgeted child and rejects foreign or incomplete proof', async t => {
  const result = await runRefreshWorkerControl(t, 'guard');
  assert.equal(result.outcome.lease.minimumSlots, 1);
  assert.ok(result.allocation.peakActiveWorkers <= result.allocation.capacity);
  assert.equal(result.report.pid, result.leases[0].pid);
  const outcome = JSON.parse(result.report.stdout);
  const encode = value => `${JSON.stringify(value)}\n`;
  const mutations = [
    report => { report.complete = false; },
    report => { report.exitCode = 1; },
    report => { report.signal = 'SIGTERM'; },
    report => { report.cleanup.rootExitObserved = false; },
    report => { report.causes = [{ type: 'cleanup', message: 'Unverified writer' }]; },
    report => { report.stdout = ''; },
    report => { report.stdout = '{}\n'; },
    report => { report.stdout = `${report.stdout}\n${report.stdout}`; },
    report => { report.stdout = report.stdout.replace('"cleaned":true', '"cleaned":false,"cleaned":true'); },
    report => { report.pid++; },
    ...[
      ['schemaVersion', 2], ['status', 'NotRun'], ['cleaned', false], ['scope', 'refresh'],
      ['sourceDigest', '0'.repeat(64)], ['groupId', '0'.repeat(64)], ['nonce', 'foreign'],
      ['pid', outcome.pid + 1], ['slot', 'not-a-slot'], ['finishedAt', 'not-a-time'],
      ['fixtureRoot', result.root], ['extra', true],
    ].map(([key, value]) => report => {
      report.stdout = encode({ ...outcome, [key]: value });
    }),
    report => { report.stdout = encode({ ...outcome,
      lease: { ...outcome.lease, finishedAt: outcome.finishedAt } }); },
    report => { report.stdout = encode({ ...outcome,
      lease: { ...outcome.lease, minimumSlots: 2 } }); },
    report => { report.stdout = encode({ ...outcome,
      preload: { ...outcome.preload, sourceDigest: '0'.repeat(64) } }); },
    report => { report.stdout = encode({ ...outcome,
      preload: { ...outcome.preload, url: 'file:///foreign-fixture.mjs' } }); },
  ];
  for (const mutate of mutations) {
    const report = structuredClone(result.report);
    mutate(report);
    await assert.rejects(validateRefreshWorkerResult(report, result.expected, result.leases));
  }
  for (const leases of [[], [...result.leases, ...result.leases],
    [{ ...result.leases[0], finishedAt: null }], [{ ...result.leases[0], pid: outcome.pid + 1 }]]) {
    await assert.rejects(validateRefreshWorkerResult(result.report, result.expected, leases));
  }
  await assert.rejects(validateRefreshWorkerResult(result.report,
    { ...result.expected, scope: 'refresh' }, result.leases),
  'A cheap control result must never complete the protected 550-refresh root');
  const start = Date.parse(outcome.lease.startedAt);
  const commandFinishedAt = new Date(start + 1).toISOString();
  const closedAt = new Date(start + 2).toISOString();
  const observedAt = new Date(start + 3).toISOString();
  const lateReport = { ...result.report, finishedAt: commandFinishedAt,
    stdout: encode({ ...outcome, finishedAt: commandFinishedAt }) };
  const lateLeases = [{ ...result.leases[0], finishedAt: closedAt }];
  const lateExpected = { ...result.expected, leaseObservedAt: observedAt };
  await validateRefreshWorkerResult(lateReport, lateExpected, lateLeases);
  await assert.rejects(validateRefreshWorkerResult(lateReport, lateExpected,
    [{ ...lateLeases[0], finishedAt: new Date(start + 4).toISOString() }]));
  await assert.rejects(validateRefreshWorkerResult(lateReport,
    { ...lateExpected, leaseObservedAt: new Date(start).toISOString() }, lateLeases));
  await assert.rejects(validateRefreshWorkerResult(lateReport,
    { ...lateExpected, leaseObservedAt: undefined }, lateLeases));
  await fs.mkdir(outcome.fixtureRoot);
  await assert.rejects(validateRefreshWorkerResult(result.report, result.expected, result.leases));
  await fs.rmdir(outcome.fixtureRoot);
  await fs.writeFile(path.join(result.expected.scratch, 'unproven-writer'), 'retained');
  await assert.rejects(validateRefreshWorkerResult(result.report, result.expected, result.leases));
  await fs.unlink(path.join(result.expected.scratch, 'unproven-writer'));
});

test('T-PRD010 refresh assertion and teardown failures retain both causes and owned evidence after child exit', async t => {
  const hooks = [];
  let failure;
  try { await runRefreshWorkerControl({ after: hook => hooks.push(hook), signal: t.signal }, 'guard-failure'); }
  catch (error) { failure = error; }
  assert.ok(failure, 'A child assertion or teardown failure must not pass');
  const { root, report, leases } = failure.refreshWorker;
  t.after(async () => {
    if (report.cleanup.rootExitObserved !== true || leases.some(lease => lease.finishedAt === null)) return;
    await fs.rm(root, { recursive: true });
    await assert.rejects(fs.stat(root), { code: 'ENOENT' });
  });
  assert.equal(report.complete, true);
  assert.equal(report.exitCode, 1);
  assert.equal(report.cleanup.rootExitObserved, true);
  assert.equal(report.stdout, '');
  const diagnostic = JSON.parse(report.stderr);
  assert.equal(diagnostic.causes.length, 2);
  assert.match(diagnostic.causes[0].message, /primary assertion failure/u);
  assert.match(diagnostic.causes[1].message, /teardown failure/u);
  assert.equal(leases.length, 1);
  assert.equal(typeof leases[0].finishedAt, 'string');
  assert.deepEqual(await fs.readdir(path.join(root, 'scratch')), [],
    'The after hook must run even when the assertion fails');
  for (const hook of hooks.reverse()) await hook();
  await fs.stat(path.join(root, 'refresh.json'));
});

test('T-PRD010 refresh root rejects worker overrides without dispatching an alternate scenario', async () => {
  await assert.rejects(runRefreshWorker({}, { scope: 'guard' }), /no worker\/scenario override/u);
  await assert.rejects(runRefreshWorkerControl({}, 'refresh'), /Only fixed cheap refresh controls/u);
});

test('T-PRD010 refresh controller preserves an inherited cancellation instead of launching or passing a child', async t => {
  const stopped = new AbortController();
  stopped.abort();
  const hooks = [];
  let failure;
  try { await runRefreshWorkerControl({ signal: stopped.signal, after: hook => hooks.push(hook) }, 'guard'); }
  catch (error) { failure = error; }
  assert.ok(failure);
  const { root, report, leases } = failure.refreshWorker;
  t.after(async () => {
    if (report.pid !== null) return;
    await fs.rm(root, { recursive: true });
    await assert.rejects(fs.stat(root), { code: 'ENOENT' });
  });
  assert.equal(report.complete, false);
  assert.equal(report.pid, null);
  assert.equal(report.exitCode, null);
  assert.equal(report.stdout, '');
  assert.ok(report.causes.some(cause => cause.type === 'cancellation'));
  assert.deepEqual(leases, []);
  for (const hook of hooks.reverse()) await hook();
  await fs.stat(path.join(root, 'refresh.json'));
});

test('T-PRD010 fixed refresh preload preserves original Git process counts and mutation freshness', async t => {
  const control = await runRefreshWorkerControl(t, 'guard');
  const workerURL = new URL('./observation-refresh-worker.mjs', import.meta.url);
  const workerIndex = control.report.command.indexOf(fileURLToPath(workerURL));
  assert.ok(workerIndex > 0);
  const actualPreloadArgs = control.report.command.slice(1, workerIndex);
  const root = path.resolve('.test-data', `refresh git control ${randomUUID()}`);
  await fs.mkdir(root);
  let removable = false;
  t.after(async () => {
    if (!removable) return;
    await fs.rm(root, { recursive: true });
    await assert.rejects(fs.stat(root), { code: 'ENOENT' });
  });
  const counter = path.join(root, 'count actual Git.mjs');
  const micro = path.join(root, 'two observations.mjs');
  await fs.writeFile(counter, `
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';
const native = cp.execFile;
const state = { calls: [], phase: 'prefix' };
const counted = (file, args, options, callback) => {
  const row = file === 'git' ? { phase: state.phase, args, pid: null, closed: false } : null;
  if (row) state.calls.push(row);
  const child = native(file, args, options, (error, stdout, stderr) => {
    if (row) row.closed = true;
    callback(error, stdout, stderr);
  });
  if (row) row.pid = child.pid;
  return child;
};
counted[promisify.custom] = (file, args, options) => new Promise((resolve, reject) => {
  counted(file, args, options, (error, stdout, stderr) => {
    if (error) { error.stdout = stdout; error.stderr = stderr; reject(error); }
    else resolve({ stdout, stderr });
  });
});
state.execute = promisify(counted);
globalThis.refreshGitControl = state;
cp.execFile = counted;
syncBuiltinESMExports();
`);
  await fs.writeFile(micro, `
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { acquireTestWorker } from ${JSON.stringify(new URL('../scripts/test-budget.mjs', import.meta.url).href)};
const allocation = await acquireTestWorker(1);
const hooks = [];
let primary;
let result;
let fixtureRoot;
const cleanup = [];
const state = globalThis.refreshGitControl;
try {
  if (process.argv[2] !== 'original') await import(${JSON.stringify(workerURL.href)});
  const { retentionFixture, observeFixtureRepository, refreshPr, factsInput,
    updatePrFacts, pruneWork, archivedBytes } =
    await import(${JSON.stringify(new URL('./observation-retention-fixture.mjs', import.meta.url).href)});
  const f = await retentionFixture({ after: hook => hooks.push(hook) });
  fixtureRoot = f.root;
  const first = await observeFixtureRepository(f);
  const firstBytes = await fs.readFile(f.store.recordPath(f.workItemId, first.id));
  let pr = await refreshPr(f, first);
  const firstPr = pr;
  const prBytes = await fs.readFile(f.store.recordPath(f.workItemId, pr.id));
  const firstFacts = await updatePrFacts(f.store, factsInput(f, pr));
  const factsBytes = await fs.readFile(f.store.recordPath(f.workItemId, firstFacts.id));
  f.clock.advance(1);
  const repository = await observeFixtureRepository(f);
  pr = await refreshPr(f, repository, pr);
  await pruneWork(f.store, f.workItemId);
  const active = await f.store.records(f.workItemId);
  for (const record of [first, firstPr, firstFacts]) assert.equal(active.some(row => row.id === record.id), false);
  assert.deepEqual(await archivedBytes(f, first.id), firstBytes);
  assert.deepEqual(await archivedBytes(f, firstPr.id), prBytes);
  assert.deepEqual(await archivedBytes(f, firstFacts.id), factsBytes);
  const prefix = state.calls.filter(row => row.phase === 'prefix');
  const commands = {};
  for (const row of prefix) {
    const key = JSON.stringify(row.args.filter(arg => !['--no-pager', '--no-optional-locks'].includes(arg)));
    commands[key] = (commands[key] ?? 0) + 1;
  }
  state.phase = 'mutation';
  await f.runGit('commit', '--allow-empty', '-qm', 'Refresh cache freshness control');
  assert.equal(state.calls.filter(row => row.phase === 'mutation' && row.args[0] === 'commit').length, 1);
  state.phase = 'freshness';
  const actual = (await state.execute('git', ['rev-parse', 'HEAD'], { cwd: f.repo,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_TERMINAL_PROMPT: '0' } })).stdout.trim();
  const { identity } = await import(${JSON.stringify(new URL('../src/git.mjs', import.meta.url).href)});
  const current = await identity(f.repo, 'primary', 'refs/heads/feature/fixture');
  assert.notEqual(actual, repository.revision);
  assert.equal(current.head, actual, 'A real Git mutation must invalidate the existing fixture cache');
  assert.ok(state.calls.every(row => Number.isInteger(row.pid) && row.pid > 0 && row.closed));
  result = { pid: process.pid, prefixActualGitProcesses: prefix.length, commands, fresh: true };
} catch (error) { primary = error; }
for (const hook of hooks.reverse()) { try { await hook(); } catch (error) { cleanup.push(error); } }
try {
  if (primary || cleanup.length) throw new AggregateError([...(primary ? [primary] : []), ...cleanup],
    'Git preload process-count or fixture cleanup control failed');
  await assert.rejects(fs.stat(fixtureRoot), { code: 'ENOENT' });
  console.log(JSON.stringify({ ...result, cleaned: true }));
} finally { allocation.close(); }
`);
  const budget = await enterTestBudget({ workers: 1, fileCount: 1 });
  const outcomes = [];
  try {
    for (const mode of ['original', 'worker', 'worker-without-preload']) {
      const report = await executeValidationCommand({
        name: mode, command: process.execPath,
        args: ['--import', pathToFileURL(counter).href,
          ...(mode === 'worker' ? actualPreloadArgs : []), micro, mode],
        cwd: fileURLToPath(new URL('../', import.meta.url)), outputDir: root,
        environment: { ...process.env, ...budget.environment },
        signal: AbortSignal.any([budget.signal, t.signal]),
      });
      assert.equal(report.complete, true);
      assert.equal(report.exitCode, 0, report.stderr);
      assert.equal(report.cleanup.rootExitObserved, true);
      const outcome = JSON.parse(report.stdout);
      assert.equal(outcome.pid, report.pid);
      assert.equal(outcome.fresh, true);
      assert.equal(outcome.cleaned, true);
      outcomes.push(outcome);
    }
    removable = true;
    const [original, actualWorker, withoutPreload] = outcomes;
    assert.deepEqual(actualWorker.commands, original.commands,
      'The actual controller child setup must retain the original immutable Git-read capture');
    assert.equal(actualWorker.prefixActualGitProcesses, original.prefixActualGitProcesses);
    assert.ok(withoutPreload.prefixActualGitProcesses > original.prefixActualGitProcesses,
      'The v2 import order must really launch extra Git processes, not merely change an argument string');
    t.diagnostic(JSON.stringify({ refreshGitProcessControl: {
      original: original.prefixActualGitProcesses, actualWorker: actualWorker.prefixActualGitProcesses,
      withoutPreload: withoutPreload.prefixActualGitProcesses,
      realMutationFreshness: outcomes.every(outcome => outcome.fresh) } }));
  } finally { await budget.close(); }
});
