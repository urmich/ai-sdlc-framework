import assert from 'node:assert/strict';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LIMITS, canonical, digest } from '../src/core.mjs';
import { enterTestBudget, acquireTestWorker, readTestGroupProcesses } from '../scripts/test-budget.mjs';
import { executeValidationCommand, processDiagnostic } from '../scripts/validation-tools.mjs';
import { retentionFixture, observeFixtureRepository, refreshPr, factsInput,
  updatePrFacts, pruneWork, evaluateReadiness, archivedBytes } from './observation-retention-fixture.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const workerPath = fileURLToPath(import.meta.url);
const fixturePreload = new URL('./observation-retention-fixture.mjs', import.meta.url);
const scopes = ['refresh', 'guard', 'guard-failure'];
const leaseKeys = ['pid', 'slot', 'minimumSlots', 'exclusiveResources', 'startedAt', 'finishedAt'];

export async function runRefreshScenario(t) {
  const f = await retentionFixture(t);
  const first = await observeFixtureRepository(f);
  const firstBytes = await fs.readFile(f.store.recordPath(f.workItemId, first.id));
  let pr = await refreshPr(f, first);
  const firstPr = pr;
  const prBytes = await fs.readFile(f.store.recordPath(f.workItemId, pr.id));
  const firstFacts = await updatePrFacts(f.store, factsInput(f, pr));
  const factsBytes = await fs.readFile(f.store.recordPath(f.workItemId, firstFacts.id));
  f.clock.advance(1);
  let repository = await observeFixtureRepository(f);
  pr = await refreshPr(f, repository, pr);
  await pruneWork(f.store, f.workItemId);
  const active = await f.store.records(f.workItemId);
  assert.equal(active.some(record => record.id === first.id), false,
    'superseded repository observation must leave the active working set after refresh/prune');
  assert.equal(active.some(record => record.id === firstPr.id), false,
    'superseded PR observation must leave the active working set');
  assert.equal(active.some(record => record.id === firstFacts.id), false,
    'superseded PR facts must leave the active working set');
  assert.deepEqual(await archivedBytes(f, first.id), firstBytes);
  assert.deepEqual(await archivedBytes(f, firstPr.id), prBytes);
  assert.deepEqual(await archivedBytes(f, firstFacts.id), factsBytes);

  for (let index = 0; index < 550; index++) {
    f.clock.advance(1);
    repository = await observeFixtureRepository(f);
    if (index % 2 === 0) {
      pr = await refreshPr(f, repository, pr);
      await updatePrFacts(f.store, factsInput(f, pr));
    }
    if (index % 50 === 0) await pruneWork(f.store, f.workItemId);
    const records = await f.store.records(f.workItemId);
    assert.ok(Buffer.byteLength(canonical(records)) < LIMITS.workingSet,
      `refresh ${index} must be admitted below the unchanged working-set budget`);
    assert.ok(records.filter(record => ['repository-observation',
      'pr-observation', 'pr-facts'].includes(record.type)).length <= 6,
    `refresh ${index} must keep superseded history bounded, not wait for capacity failure`);
  }
  const records = await f.store.records(f.workItemId);
  const history = await fs.readdir(path.join(f.store.workPath(f.workItemId), 'evidence'));
  assert.ok(history.filter(name => name.startsWith('repository-observation-')).length >= 550);
  assert.ok(history.filter(name => name.startsWith('pr-observation-')).length >= 275);
  assert.ok(records.some(record => record.id === repository.id));
  assert.ok(records.some(record => record.id === pr.id));
  assert.equal((await f.store.currentRepositoryObservation(f.workItemId,
    'primary')).observation.id, repository.id);
  const oldReadiness = evaluateReadiness(records, {
    environment: 'PROD', prRecordId: firstPr.id,
    localRepositoryPath: first.localRepositoryPath,
    remoteRepositoryURL: first.remoteRepositoryURL,
    prId: firstPr.pullRequestRef, sourceRevision: firstPr.sourceRevision,
    targetRevision: firstPr.targetRevision, policyVersion: 'policy-1',
  }, { clock: f.clock });
  assert.equal(oldReadiness.ready, false);
  assert.ok(oldReadiness.gaps.includes('qualifying-pr-missing'));
  await assert.rejects(updatePrFacts(f.store, factsInput(f, firstPr)),
    { code: 'INPUT' });
  return { fixtureRoot: f.root };
}

async function refreshIdentity(scope) {
  assert.ok(scopes.includes(scope));
  const sources = [
    'test/observation-retention-refresh.test.mjs', 'test/observation-refresh-worker.mjs',
    'test/observation-retention-fixture.mjs', 'test/helpers.mjs',
    'scripts/test-budget.mjs', 'scripts/validation-tools.mjs', 'scripts/validation-inventory.mjs',
  ];
  const collect = async directory => {
    for (const entry of await fs.readdir(path.join(repositoryRoot, directory), { withFileTypes: true })) {
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await collect(file);
      else if (entry.name.endsWith('.mjs')) sources.push(file);
    }
  };
  await collect('src');
  return digest({ scope, preload: 'test/observation-retention-fixture.mjs',
    sources: await Promise.all(sources.sort().map(async file => ({
    file, sha256: digest(await fs.readFile(path.join(repositoryRoot, file))),
  }))) });
}

async function preloadIdentity() {
  return { url: fixturePreload.href, sourceDigest: digest(await fs.readFile(fixturePreload)) };
}

function closed(value, keys) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Missing refresh result object');
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), 'Unexpected refresh result fields');
}

function timestamp(value) {
  assert.equal(typeof value, 'string');
  const time = Date.parse(value);
  assert.ok(Number.isFinite(time), 'Missing refresh execution time');
  return time;
}

export async function validateRefreshWorkerResult(report, expected, leases) {
  assert.equal(report.complete, true, 'Refresh child process was incomplete');
  assert.equal(report.exitCode, 0, `Refresh child failed: ${processDiagnostic({ message: report.stderr }).message}`);
  assert.equal(report.signal, null, 'Refresh child was terminated');
  assert.equal(report.cleanup.rootExitObserved, true, 'Await the actual owned refresh child');
  assert.deepEqual(report.causes, [], 'Refresh child has unresolved execution causes');
  const outcome = JSON.parse(report.stdout);
  assert.equal(report.stdout, `${JSON.stringify(outcome)}\n`, 'Exactly one closed JSON refresh result is required');
  closed(outcome, ['schemaVersion', 'scope', 'sourceDigest', 'groupId', 'nonce', 'status',
    'cleaned', 'pid', 'slot', 'lease', 'fixtureRoot', 'startedAt', 'finishedAt', 'preload']);
  assert.equal(outcome.schemaVersion, 1);
  for (const key of ['scope', 'sourceDigest', 'groupId', 'nonce']) assert.equal(outcome[key], expected[key]);
  closed(outcome.preload, ['url', 'sourceDigest']);
  assert.deepEqual(outcome.preload, expected.preload, 'Refresh must use the fixed source-bound fixture preload');
  assert.equal(outcome.status, 'Passed', 'Every refresh assertion must finish');
  assert.equal(outcome.cleaned, true, 'Refresh fixture teardown must finish before its result');
  assert.ok(Number.isSafeInteger(outcome.pid) && outcome.pid > 0);
  assert.equal(outcome.pid, report.pid, 'Refresh result must belong to the actual owned PID');
  assert.match(outcome.slot, /^[a-f0-9-]{36}$/u);
  closed(outcome.lease, leaseKeys);
  assert.equal(outcome.lease.pid, outcome.pid);
  assert.equal(outcome.lease.slot, outcome.slot);
  assert.equal(outcome.lease.minimumSlots, 1);
  assert.deepEqual(outcome.lease.exclusiveResources, []);
  assert.equal(outcome.lease.finishedAt, null, 'Capture the live child lease before closing it');
  assert.equal(leases.length, 1, 'Exactly one actual refresh worker lease is required');
  closed(leases[0], leaseKeys);
  const { finishedAt, ...observed } = leases[0];
  const { finishedAt: liveFinishedAt, ...live } = outcome.lease;
  assert.equal(liveFinishedAt, null);
  assert.deepEqual(observed, live);
  // Each observer owns its clock; causal ownership comes from matching live/closed broker states and exit.
  assert.ok(timestamp(report.startedAt) <= timestamp(report.finishedAt), 'Command observer interval is reversed');
  assert.ok(timestamp(outcome.startedAt) <= timestamp(outcome.finishedAt), 'Worker interval is reversed');
  const leaseObservedAt = timestamp(expected.leaseObservedAt);
  assert.ok(timestamp(report.finishedAt) <= leaseObservedAt, 'Inspect the lease after command completion');
  assert.ok(timestamp(outcome.lease.startedAt) <= timestamp(finishedAt), 'Broker lease interval is reversed');
  assert.equal(typeof outcome.fixtureRoot, 'string');
  assert.equal(path.dirname(outcome.fixtureRoot), expected.fixtureParent);
  assert.match(path.basename(outcome.fixtureRoot), /^[a-f0-9-]{36}$/u);
  await assert.rejects(fs.stat(outcome.fixtureRoot), { code: 'ENOENT' });
  assert.deepEqual(await fs.readdir(expected.scratch), [],
    'No refresh fixture writer or residue may remain');
  return outcome;
}

async function runOwnedRefresh(t, scope) {
  const nonce = randomUUID();
  const root = path.join(repositoryRoot, '.test-data', `refresh-worker-${nonce}`);
  const scratch = path.join(root, 'scratch');
  await fs.mkdir(scratch, { recursive: true });
  let removable = false;
  t.after(async () => {
    if (!removable) return;
    await fs.rm(root, { recursive: true });
    await assert.rejects(fs.stat(root), { code: 'ENOENT' });
  });
  const sourceDigest = await refreshIdentity(scope);
  const groupId = digest({ scope, sourceDigest, nonce });
  const expected = { scope, sourceDigest, groupId, nonce, scratch,
    fixtureParent: path.join(repositoryRoot, '.test-data'), preload: await preloadIdentity() };
  // This producer yields the existing root slot; its one child uses that same global budget.
  const budget = await enterTestBudget({ workers: 1, fileCount: 1 });
  let primary;
  let report;
  let leases;
  try {
    const environment = { ...process.env, ...budget.environment, TMPDIR: scratch, TMP: scratch, TEMP: scratch };
    delete environment.NODE_TEST_CONTEXT;
    // Preserve the original Git fixture layout instead of exceeding Windows paths under evidence scratch.
    report = await executeValidationCommand({
      name: 'refresh', command: process.execPath,
      // Finish the existing fixture shim before transport imports can capture Git's execFile.
      args: ['--import', fixturePreload.href, workerPath, '--owned-refresh',
        scope, sourceDigest, groupId, nonce, scratch],
      cwd: repositoryRoot, outputDir: root,
      environment,
      signal: t.signal ? AbortSignal.any([budget.signal, t.signal]) : budget.signal,
    });
    leases = await readGroups(budget, groupId);
    expected.leaseObservedAt = new Date().toISOString();
    const child = report.complete && report.exitCode === 0 ? JSON.parse(report.stdout) : null;
    t.diagnostic?.(JSON.stringify({ refreshLeaseObservation: {
      sourceDigest, groupId, nonce, pid: report.pid, commandFinishedAt: report.finishedAt,
      child: child && { startedAt: child.startedAt, finishedAt: child.finishedAt, liveLease: child.lease },
      observedAt: expected.leaseObservedAt, leases } }));
    const outcome = await validateRefreshWorkerResult(report, expected, leases);
    assert.equal(await refreshIdentity(scope), sourceDigest, 'Refresh sources changed during execution');
    const allocation = await budget.snapshot();
    return { report, outcome, expected, leases, allocation, root };
  } catch (error) {
    primary = error;
    error.refreshWorker = { root, sourceDigest, groupId, report, leases,
      leaseObservedAt: expected.leaseObservedAt };
    throw error;
  } finally {
    try { await budget.close(); removable = !primary; }
    catch (error) {
      if (!primary) {
        error.refreshWorker = { root, sourceDigest, groupId, report, leases,
          leaseObservedAt: expected.leaseObservedAt };
        throw error;
      }
      primary.budgetCleanup = processDiagnostic(error);
    }
  }
}

async function readGroups(budget, groupId) {
  const previous = process.env.SDLC_TEST_BUDGET_PRODUCER;
  const inherited = process.env.SDLC_TEST_BUDGET;
  try {
    process.env.SDLC_TEST_BUDGET = budget.inherited;
    process.env.SDLC_TEST_BUDGET_PRODUCER = budget.parent;
    return await readTestGroupProcesses(groupId);
  } finally {
    if (previous === undefined) delete process.env.SDLC_TEST_BUDGET_PRODUCER;
    else process.env.SDLC_TEST_BUDGET_PRODUCER = previous;
    if (inherited === undefined) delete process.env.SDLC_TEST_BUDGET;
    else process.env.SDLC_TEST_BUDGET = inherited;
  }
}

export async function runRefreshWorker(t) {
  assert.equal(arguments.length, 1, 'The original refresh root has no worker/scenario override');
  return runOwnedRefresh(t, 'refresh');
}

export async function runRefreshWorkerControl(t, scope) {
  assert.ok(['guard', 'guard-failure'].includes(scope), 'Only fixed cheap refresh controls are allowed');
  return runOwnedRefresh(t, scope);
}

async function guardScenario(t, scope) {
  if (scope === 'guard') return { fixtureRoot: (await retentionFixture(t)).root };
  const fixtureRoot = path.resolve('.test-data', randomUUID());
  await fs.mkdir(fixtureRoot, { recursive: true });
  t.after(async () => {
    await fs.rm(fixtureRoot, { recursive: true });
    await assert.rejects(fs.stat(fixtureRoot), { code: 'ENOENT' });
    if (scope === 'guard-failure') assert.fail('Refresh guard teardown failure');
  });
  if (scope === 'guard-failure') assert.fail('Refresh guard primary assertion failure');
  return { fixtureRoot };
}

async function workerMain() {
  const [mode, scope, sourceDigest, groupId, nonce, scratch, ...extra] = process.argv.slice(2);
  assert.deepEqual(process.execArgv, ['--import', fixturePreload.href]);
  assert.equal(mode, '--owned-refresh');
  assert.deepEqual(extra, []);
  assert.ok(scopes.includes(scope));
  assert.match(nonce, /^[a-f0-9-]{36}$/u);
  assert.equal(scratch, path.join(repositoryRoot, '.test-data', `refresh-worker-${nonce}`, 'scratch'));
  assert.equal(process.cwd(), path.resolve(repositoryRoot));
  assert.equal((await fs.lstat(scratch)).isSymbolicLink(), false);
  assert.equal((await fs.lstat(path.dirname(scratch))).isSymbolicLink(), false);
  assert.equal(await refreshIdentity(scope), sourceDigest);
  assert.equal(groupId, digest({ scope, sourceDigest, nonce }));
  const allocation = await acquireTestWorker(1, { groupId });
  const startedAt = new Date().toISOString();
  const hooks = [];
  const cleanupFailures = [];
  let primary;
  let result;
  try {
    try {
      const t = { after: hook => { assert.equal(typeof hook, 'function'); hooks.push(hook); } };
      result = scope === 'refresh' ? await runRefreshScenario(t) : await guardScenario(t, scope);
    } catch (error) { primary = error; }
    for (const hook of hooks.reverse()) {
      try { await hook(); }
      catch (error) { cleanupFailures.push(error); }
    }
    if (primary || cleanupFailures.length) {
      throw new AggregateError([...(primary ? [primary] : []), ...cleanupFailures],
        'Refresh assertions or fixture cleanup failed', { cause: primary ?? cleanupFailures[0] });
    }
    assert.equal(await refreshIdentity(scope), sourceDigest);
    await assert.rejects(fs.stat(result.fixtureRoot), { code: 'ENOENT' });
    assert.deepEqual(await fs.readdir(scratch), []);
    const leases = await readTestGroupProcesses(groupId);
    assert.equal(leases.length, 1);
    assert.equal(leases[0].pid, process.pid);
    assert.equal(leases[0].slot, allocation.slot);
    assert.equal(leases[0].finishedAt, null, 'Confirm the actual lease is live after scenario cleanup');
    console.log(JSON.stringify({ schemaVersion: 1, scope, sourceDigest, groupId, nonce,
      status: 'Passed', cleaned: true, pid: process.pid, slot: allocation.slot,
      lease: leases[0], fixtureRoot: result.fixtureRoot, preload: await preloadIdentity(),
      startedAt, finishedAt: new Date().toISOString() }));
  } finally { allocation.close(); }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { await workerMain(); }
  catch (error) {
    console.error(JSON.stringify({ ...processDiagnostic(error),
      causes: (error instanceof AggregateError ? error.errors : [error]).map(processDiagnostic) }));
    process.exitCode = 1;
  }
}
