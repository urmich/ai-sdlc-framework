import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';
import { LIMITS, canonical, digest } from '../src/core.mjs';

// Cache only immutable fixture Git reads; all transactions, archival and
// filesystem I/O are real. Mutating Git commands invalidate the cached reads.
const execute = childProcess.execFile;
const gitReads = new Map();
childProcess.execFile = (file, args, options, callback) => {
  const command = args.filter(argument => !['--no-pager',
    '--no-optional-locks'].includes(argument))[0];
  const cacheable = file === 'git' && (['rev-parse', 'symbolic-ref'].includes(command) ||
    command === 'remote' && (!args.includes('add') && !args.includes('set-url')));
  if (file === 'git' && !cacheable) gitReads.clear();
  const key = canonical([options.cwd, args]);
  if (cacheable && gitReads.has(key)) {
    const { stdout, stderr } = gitReads.get(key);
    queueMicrotask(() => callback(null, stdout, stderr));
    return undefined;
  }
  return execute(file, args, options, (error, stdout, stderr) => {
    if (!error && cacheable) gitReads.set(key, { stdout, stderr });
    callback(error, stdout, stderr);
  });
};
const cachedGit = childProcess.execFile;
cachedGit[promisify.custom] = (file, args, options) => new Promise((resolve, reject) => {
  cachedGit(file, args, options, (error, stdout, stderr) => {
    if (error) reject(error);
    else resolve({ stdout, stderr });
  });
});
syncBuiltinESMExports();
const { fixture, observeFixtureRepository } = await import('./helpers.mjs');
const { pruneWork } = await import('../src/operations.mjs');
const { adoptPr, evaluateReadiness, updatePrFacts } = await import('../src/pr.mjs');
const { archiveSupersededObservations, withObservationRetention } =
  await import('../src/observation-retention.mjs');
const { currentArtifact, currentDeployment } = await import('../src/current-evidence.mjs');
const { deriveIntendedOutcome } = await import('../src/external-results.mjs');
const { attachMonitor, monitorAssociationKey, withMonitorLocks } =
  await import('../src/monitors.mjs');
const { immutableJson, readJson, withLock, writeJson } = await import('../src/files.mjs');
childProcess.execFile = execute;
syncBuiltinESMExports();

async function retentionFixture(t) {
  const f = await fixture(t);
  await f.runGit('commit', '--allow-empty', '-qm', 'Retention fixture baseline');
  f.store.verifyPullRequest = ({ adapterObservation: observation }) => ({
    canonicalLocalRepositoryPath: observation.localRepositoryPath,
    verifiedRemoteRepositoryURL: observation.remoteRepositoryURL,
    verifiedProvider: observation.provider,
    verifiedConnection: observation.connection,
    verifiedRepositoryRef: observation.repositoryRef,
    verifiedPullRequestRef: observation.pullRequestRef,
    verifiedSourceBranchRef: observation.sourceBranchRef,
    verifiedTargetBranchRef: observation.targetBranchRef,
    verifiedSourceRevision: observation.sourceRevision,
    verifiedTargetRevision: observation.targetRevision,
    verifiedState: observation.state,
    verifiedObservedAt: observation.observedAt,
    verifiedEvidenceRef: observation.evidenceRef,
  });
  return f;
}

async function refreshPr(f, repository, predecessor, overrides = {}) {
  f.clock.advance(1);
  const observation = {
    repositoryId: repository.repositoryId,
    localRepositoryPath: repository.localRepositoryPath,
    remoteRepositoryURL: repository.remoteRepositoryURL,
    provider: repository.provider, connection: repository.connection,
    repositoryRef: repository.repositoryRef, pullRequestRef: 'retention-pr',
    sourceBranchRef: 'refs/heads/feature/fixture',
    targetBranchRef: 'refs/heads/main',
    sourceRevision: repository.revision, targetRevision: 'b'.repeat(40),
    state: 'active', observedAt: new Date(f.clock.now()).toISOString(),
    evidenceRef: `fixture:pr:${f.clock.now()}`, ...overrides,
  };
  return (await adoptPr(f.store, {
    workItemId: f.workItemId, observation, adapterObservation: observation,
    ...(predecessor ? { previousObservationKey: predecessor.id } : {}),
  })).observation;
}

const factsInput = (f, pr) => ({
  workItemId: f.workItemId, prRecordId: pr.id, policyVersion: 'policy-1',
  sourceRevision: pr.sourceRevision, targetRevision: pr.targetRevision,
  requiredChecks: [], checks: [], reviewsSatisfied: true,
  providerEvidenceRef: 'fixture:policy',
});

async function archivedBytes(f, recordId) {
  return fs.readFile(path.join(f.store.workPath(f.workItemId),
    'evidence', `${recordId}.json`));
}

test('FR-063/064 real refresh and prune archive superseded observations/facts before exhaustion', async t => {
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
});

const pruneObservations = f => withObservationRetention(f.store, f.workItemId,
  (tx, monitorDependencies) =>
    archiveSupersededObservations(f.store, tx, { monitorDependencies }),
  { allowRecoveryRequired: true });

test('FR-063/064 pruneWork alone archives released historical observations and facts without another refresh', async t => {
  const f = await retentionFixture(t);
  const first = await observeFixtureRepository(f);
  const firstPr = await refreshPr(f, first);
  const firstFacts = await updatePrFacts(f.store, factsInput(f, firstPr));
  const historical = [first, firstPr, firstFacts];
  const bytes = new Map(await Promise.all(historical.map(async record => [
    record.id, await fs.readFile(f.store.recordPath(f.workItemId, record.id)),
  ])));
  await f.store.transaction(f.workItemId, tx => tx.put({
    type: 'conflict', id: 'prune-only-consumer', workItemId: f.workItemId,
    reason: 'Hold historical provider evidence until the dependency is released',
    status: 'open', references: [first.id, firstFacts.id],
  }));
  f.clock.advance(1);
  const currentRepository = await observeFixtureRepository(f, { revision: 'b'.repeat(40) });
  const currentPr = await refreshPr(f, currentRepository, firstPr);
  const currentFacts = await updatePrFacts(f.store, factsInput(f, currentPr));
  await f.store.transaction(f.workItemId, tx => tx.remove('prune-only-consumer'));
  const before = await f.store.records(f.workItemId);
  for (const record of historical) {
    assert.ok(before.some(candidate => candidate.id === record.id),
      'historical evidence must still be active when pruneWork starts');
  }
  const result = await pruneWork(f.store, f.workItemId);
  assert.deepEqual(new Set(result.archived), new Set(historical.map(record => record.id)));
  const active = await f.store.records(f.workItemId);
  assert.deepEqual(new Set(active.map(record => record.id)),
    new Set([currentRepository.id, currentPr.id, currentFacts.id]));
  for (const record of historical) {
    assert.deepEqual(await archivedBytes(f, record.id), bytes.get(record.id));
  }
  assert.equal((await f.store.currentRepositoryObservation(f.workItemId,
    'primary')).observation.id, currentRepository.id);
  await assert.rejects(updatePrFacts(f.store, factsInput(f, firstPr)),
    { code: 'INPUT' });
  assert.deepEqual((await pruneWork(f.store, f.workItemId)).archived, []);
});

function actionOperation(f, repository, status, overrides = {}) {
  const action = {
    class: 'build', repositoryId: 'primary',
    localRepositoryPath: repository.localRepositoryPath,
    remoteRepositoryURL: repository.remoteRepositoryURL,
    provider: repository.provider, environment: 'DEV', target: 'fixture-dev',
    pipeline: 'fixture-build', sourceRevision: repository.revision,
    configDigest: 'c'.repeat(64), ...overrides,
  };
  return {
    type: 'operation', id: 'operation-consumer', workItemId: f.workItemId,
    repositoryId: 'primary', class: action.class, action, target: action.target,
    status, requestFingerprint: digest(action), correlationKey: 'retention-consumer',
    dispatchBound: true, createdAt: new Date(f.clock.now()).toISOString(),
    intendedOutcome: deriveIntendedOutcome(action),
  };
}

for (const status of ['prepared', 'uncertain']) {
  test(`FR-063 sole ${status} action retains its source observation until released`, async t => {
    const f = await retentionFixture(t);
    const first = await observeFixtureRepository(f);
    const operation = actionOperation(f, first, status);
    await f.store.transaction(f.workItemId, tx => tx.put(operation));
    f.clock.advance(1);
    const latest = await observeFixtureRepository(f, { revision: 'b'.repeat(40) });
    await pruneObservations(f);
    const active = await f.store.records(f.workItemId);
    assert.ok(active.some(record => record.id === first.id));
    assert.ok(active.some(record => record.id === latest.id));
    await f.store.transaction(f.workItemId, tx => tx.remove(operation.id));
    await pruneObservations(f);
    assert.equal((await f.store.records(f.workItemId)).some(record =>
      record.id === first.id), false);
    assert.equal(JSON.parse(await archivedBytes(f, first.id)).id, first.id);
  });
}

for (const consumer of ['facts-reference', 'audit-reference', 'recovery']) {
  test(`FR-063 sole ${consumer} retains superseded PR observations and facts`, async t => {
    const f = await retentionFixture(t);
    const repository = await observeFixtureRepository(f);
    const first = await refreshPr(f, repository);
    const facts = await updatePrFacts(f.store, factsInput(f, first));
    let consumerIds = [];
    let recoveryToken;
    if (consumer === 'recovery') recoveryToken = await f.store.beginRecovery(f.workItemId);
    else if (consumer === 'facts-reference') {
      consumerIds = ['conflict-consumer'];
      await f.store.transaction(f.workItemId, tx => tx.put({
        type: 'conflict', id: consumerIds[0], workItemId: f.workItemId,
        status: 'open', reason: 'Recover the referenced provider policy evidence',
        references: [facts.id, 'fixture:recovery-check'],
      }));
    } else {
      consumerIds = ['event-consumer', 'audit-consumer'];
      const event = {
        type: 'event', id: consumerIds[0], workItemId: f.workItemId,
        schemaVersion: 1, sequence: 1, kind: 'review-result',
        effect: {
          cycleId: 'cycle-history', candidateDigest: 'c'.repeat(64),
          testSpecDigest: 'd'.repeat(64), configDigest: 'e'.repeat(64),
          status: 'Blocked', evidenceRef: `copilot-cli:/review:${first.id}`,
          summary: 'Provider evidence remains an audited historical dependency',
          blockingFindings: ['fixture:missing-proof'],
        },
        sourceReceiptId: 'receipt-fixture', sourceReceiptDigest: 'a'.repeat(64),
        inputDigest: 'b'.repeat(64), sessionId: f.sessionId,
        repositoryIds: ['primary'], snapshots: [],
        occurredAt: new Date(f.clock.now()).toISOString(),
      };
      event.digest = digest(event);
      await f.store.transaction(f.workItemId, tx => {
        tx.put(event);
        tx.put({ type: 'audit-reference', id: consumerIds[1],
          workItemId: f.workItemId, eventId: event.id,
          eventDigest: event.digest, repositoryId: 'primary', commit: repository.revision });
      });
    }
    let latest;
    if (recoveryToken) {
      // Seed a legitimate refresh under the existing recovery transaction
      // contract; normal adoption correctly refuses pending recovery.
      await f.store.transaction(f.workItemId, tx => {
        const observation = { ...first, sequence: 2,
          previousObservationKey: first.id,
          observedAt: new Date(f.clock.now() + 1).toISOString(),
          evidenceRef: 'fixture:pr:recovered-refresh' };
        const { type, id: ignored, workItemId, repositoryId, ...value } = observation;
        void type; void ignored; void workItemId; void repositoryId;
        observation.id = `pr-observation-${digest(value).slice(0, 40)}`;
        tx.put(observation);
        latest = observation;
      }, { allowRecoveryRequired: true });
    } else latest = await refreshPr(f, repository, first);
    await pruneObservations(f);
    let active = await f.store.records(f.workItemId);
    assert.ok(active.some(record => record.id === first.id));
    assert.ok(active.some(record => record.id === facts.id));
    assert.ok(active.some(record => record.id === latest.id));
    if (recoveryToken) await f.store.completeRecovery(f.workItemId, recoveryToken);
    else await f.store.transaction(f.workItemId, tx => {
      for (const recordId of consumerIds) tx.remove(recordId);
    });
    await pruneObservations(f);
    active = await f.store.records(f.workItemId);
    assert.equal(active.some(record => record.id === first.id), false);
    assert.equal(active.some(record => record.id === facts.id), false);
  });
}

test('FR-063 candidate artifact and deployment preserve their producer repository observation', async t => {
  const f = await retentionFixture(t);
  const first = await observeFixtureRepository(f);
  const producer = actionOperation(f, first, 'succeeded');
  producer.cycleId = 'cycle-consumer';
  producer.candidateDigest = 'd'.repeat(64);
  const producingExecution = {
    provider: first.provider, connection: first.connection,
    scopeRef: first.repositoryRef, definitionRef: producer.action.pipeline,
    executionRef: 'fixture-producing-run', attemptKind: 'not-applicable',
  };
  producer.resultProof = {
    dispatchId: producer.id, status: 'succeeded',
    intendedOutcomeDigest: producer.intendedOutcome.digest,
    providerResultId: `${producingExecution.executionRef}:not-applicable`,
    executionRef: producingExecution.executionRef,
    attemptCapability: 'none', attemptRef: 'not-applicable',
    executionIdentity: producingExecution, resultDigest: 'e'.repeat(64),
    causalKey: digest('fixture:provider-request:producer'),
  };
  const artifact = {
    type: 'artifact', id: 'artifact-consumer', workItemId: f.workItemId,
    sequence: 1, cycleId: producer.cycleId, artifactId: 'fixture-package',
    environment: 'DEV', sourceDigest: producer.candidateDigest,
    configDigest: producer.action.configDigest, sourceRevision: first.revision,
    repositoryId: first.repositoryId, localRepositoryPath: first.localRepositoryPath,
    remoteRepositoryURL: first.remoteRepositoryURL, provider: first.provider,
    connection: first.connection, repositoryRef: first.repositoryRef,
    buildRunId: producer.resultProof.providerResultId, name: 'fixture-package',
    artifactType: 'package', evidenceRef: 'fixture:artifact', status: 'succeeded',
    artifactRef: 'fixture:immutable-package', artifactSha256: 'f'.repeat(64),
    producingOperationId: producer.id, producingAttemptCapability: 'none',
    producingAttemptRef: 'not-applicable', producingExecution,
  };
  const deploy = actionOperation(f, first, 'succeeded', {
    class: 'deploy', artifactId: artifact.artifactId,
    artifactRef: artifact.artifactRef, artifactSha256: artifact.artifactSha256,
  });
  deploy.id = 'deployment-consumer';
  deploy.cycleId = producer.cycleId;
  deploy.candidateDigest = producer.candidateDigest;
  deploy.artifactId = artifact.artifactId;
  deploy.deploymentSequence = 1;
  deploy.resultProof = {
    dispatchId: deploy.id, status: 'succeeded',
    intendedOutcomeDigest: deploy.intendedOutcome.digest,
    providerResultId: 'fixture-deployment', resultDigest: 'a'.repeat(64),
  };
  const cycle = {
    type: 'cycle', id: producer.cycleId, workItemId: f.workItemId,
    generation: 1, candidateDigest: producer.candidateDigest,
    configDigest: producer.action.configDigest, testSpecDigest: 'b'.repeat(64),
    sources: [{ repositoryId: 'primary', revision: first.revision }],
    tests: [], results: {}, artifacts: { DEV: artifact.id },
    deployments: { DEV: deploy.id }, step: 'dev-running',
  };
  await f.store.transaction(f.workItemId, tx => {
    for (const record of [producer, artifact, deploy, cycle]) tx.put(record);
  });
  f.clock.advance(1);
  await observeFixtureRepository(f, { revision: 'b'.repeat(40) });
  await pruneObservations(f);
  const records = await f.store.records(f.workItemId);
  assert.ok(records.some(record => record.id === first.id));
  assert.equal(currentArtifact(cycle, records, artifact), true);
  assert.equal(currentDeployment(cycle, records, deploy, 'DEV'), true);
  await f.store.transaction(f.workItemId, tx => {
    for (const record of [cycle, artifact, deploy, producer]) tx.remove(record.id);
  });
  await pruneObservations(f);
  assert.equal((await f.store.records(f.workItemId)).some(record =>
    record.id === first.id), false);
});

async function associationFixture(f, pr, { delivered = false, running = false } = {}) {
  const monitor = await attachMonitor(f.store, {
    identity: { provider: pr.provider, connection: pr.connection,
      scopeRef: pr.repositoryRef, definitionRef: 'fixture-check',
      executionRef: 'fixture-check-run', attemptKind: 'not-applicable' },
    origin: 'framework', workItemId: f.workItemId,
    schedulerAvailable: true, readAvailable: true,
  });
  monitor.runStatus = running ? 'running' : 'succeeded';
  monitor.notice = { status: delivered ? 'delivered' : 'pending',
    kind: 'terminal', generation: 2 };
  const association = {
    runKey: monitor.key, workItemId: f.workItemId, prRecordId: pr.id,
    prObservationKey: pr.id, checkId: 'fixture-check',
    requiredCheckRef: 'fixture-check', checkResultRef: 'fixture-check-result',
    producerRef: 'fixture-check', sourceRevision: pr.sourceRevision,
    targetRevision: pr.targetRevision, testedRevision: pr.sourceRevision,
    localRepositoryPath: pr.localRepositoryPath,
    remoteRepositoryURL: pr.remoteRepositoryURL, evidenceRef: 'fixture:check',
    identity: monitor.identity, evidenceVerified: true,
  };
  association.key = monitorAssociationKey(association);
  await withMonitorLocks(f.store, [monitor.key], async () => {
    await writeJson(path.join(f.store.runtime, 'pipeline-monitors',
      `${monitor.key}.json`), monitor);
    await immutableJson(path.join(f.store.runtime,
      'pipeline-monitor-associations', `${association.key}.json`), association);
  });
  return { monitor, association };
}

for (const consumer of ['current-check', 'terminal-notice', 'running-check',
  'uncertain-action-reference']) {
  test(`FR-063 sole ${consumer} association retains its PR and facts`, async t => {
    const f = await retentionFixture(t);
    const repository = await observeFixtureRepository(f);
    const first = await refreshPr(f, repository);
    const facts = await updatePrFacts(f.store, factsInput(f, first));
    const { monitor, association } = await associationFixture(f, first, {
      delivered: ['current-check', 'uncertain-action-reference'].includes(consumer),
      running: consumer === 'running-check',
    });
    if (consumer === 'uncertain-action-reference') {
      const operation = actionOperation(f, repository, 'uncertain');
      operation.evidenceRef = `fixture:association:${association.key}`;
      await f.store.transaction(f.workItemId, tx => tx.put(operation));
    }
    const latest = consumer === 'current-check' ? first :
      await refreshPr(f, repository, first);
    await pruneObservations(f);
    let active = await f.store.records(f.workItemId);
    assert.ok(active.some(record => record.id === first.id));
    assert.ok(active.some(record => record.id === facts.id));
    assert.ok(active.some(record => record.id === latest.id));
    if (consumer !== 'current-check') {
      if (consumer === 'uncertain-action-reference') {
        await f.store.transaction(f.workItemId, tx => tx.remove('operation-consumer'));
      }
      monitor.runStatus = 'succeeded';
      monitor.notice.status = 'delivered';
      await withMonitorLocks(f.store, [monitor.key], () =>
        writeJson(path.join(f.store.runtime, 'pipeline-monitors',
          `${monitor.key}.json`), monitor));
      await pruneObservations(f);
      active = await f.store.records(f.workItemId);
      assert.equal(active.some(record => record.id === first.id), false);
      assert.equal(active.some(record => record.id === facts.id), false);
    }
  });
}

for (const interruption of ['archive:repository-observation', 'record:repository-observation',
  'checkpoint', 'remove:repository-observation:']) {
  test(`FR-064 archival retries after ${interruption} without changing historical bytes`, async t => {
    const f = await retentionFixture(t);
    const first = await observeFixtureRepository(f);
    const bytes = await fs.readFile(f.store.recordPath(f.workItemId, first.id));
    f.clock.advance(1);
    let interrupted = false;
    f.store.fault = async point => {
      if (!interrupted && point === interruption) {
        interrupted = true;
        throw new Error(`fixture interruption: ${point}`);
      }
    };
    await assert.rejects(observeFixtureRepository(f), {
      message: `fixture interruption: ${interruption}`,
    });
    assert.equal(interrupted, true);
    assert.deepEqual(await archivedBytes(f, first.id), bytes);
    f.store.fault = async () => {};
    const latest = await observeFixtureRepository(f);
    await pruneObservations(f);
    const active = await f.store.records(f.workItemId);
    assert.equal(active.some(record => record.id === first.id), false);
    assert.ok(active.some(record => record.id === latest.id));
    assert.deepEqual(await archivedBytes(f, first.id), bytes);
    f.clock.value = Date.parse(first.observedAt);
    await assert.rejects(observeFixtureRepository(f), { code: 'STALE' });
    assert.deepEqual(await archivedBytes(f, first.id), bytes);
  });
}

test('FR-063 deterministic prune/refresh race rechecks dependencies under the work-item lock', async t => {
  const f = await retentionFixture(t);
  const first = await observeFixtureRepository(f);
  await f.store.transaction(f.workItemId, tx => tx.put({
    type: 'conflict', id: 'race-consumer', workItemId: f.workItemId,
    reason: 'Hold the sole recovery reference until pruning', status: 'open',
    references: [first.id, 'fixture:recovery'],
  }));
  f.clock.advance(1);
  await observeFixtureRepository(f);
  let entered;
  let release;
  const started = new Promise(resolve => { entered = resolve; });
  const proceed = new Promise(resolve => { release = resolve; });
  const pruning = withObservationRetention(f.store, f.workItemId,
    async (tx, monitorDependencies) => {
      entered();
      await proceed;
      tx.remove('race-consumer');
      return archiveSupersededObservations(f.store, tx, { monitorDependencies });
    });
  await started;
  let waiting;
  const waitingForWorkLock = new Promise(resolve => { waiting = resolve; });
  const transaction = f.store.transaction.bind(f.store);
  t.mock.method(f.store, 'transaction', (...args) => {
    waiting();
    return transaction(...args);
  });
  f.clock.advance(1);
  const refreshing = observeFixtureRepository(f);
  await waitingForWorkLock;
  release();
  const [archived, latest] = await Promise.all([pruning, refreshing]);
  assert.ok(archived.includes(first.id));
  const active = await f.store.records(f.workItemId);
  assert.equal(active.some(record => record.id === first.id), false);
  assert.ok(active.some(record => record.id === latest.id));
  assert.equal((await f.store.currentRepositoryObservation(f.workItemId,
    'primary')).observation.id, latest.id);
  assert.equal(JSON.parse(await archivedBytes(f, first.id)).id, first.id);
});

test('FR-063 newly associated monitor is reported STALE instead of reversing lock order', async t => {
  const f = await retentionFixture(t);
  const repository = await observeFixtureRepository(f);
  const pr = await refreshPr(f, repository);
  let entered;
  let release;
  const started = new Promise(resolve => { entered = resolve; });
  const proceed = new Promise(resolve => { release = resolve; });
  const held = withLock(path.join(f.store.workPath(f.workItemId), '.lock'), async () => {
    entered();
    await proceed;
  });
  await started;
  let waiting;
  const waitingForWorkLock = new Promise(resolve => { waiting = resolve; });
  const transaction = f.store.transaction.bind(f.store);
  t.mock.method(f.store, 'transaction', (...args) => {
    waiting();
    return transaction(...args);
  });
  const pruning = pruneObservations(f);
  const rejection = assert.rejects(pruning, { code: 'STALE' });
  await waitingForWorkLock;
  await associationFixture(f, pr);
  release();
  await Promise.all([held, rejection]);
  await pruneObservations(f);
  assert.ok((await f.store.records(f.workItemId)).some(record => record.id === pr.id));
});

test('FR-063 refresh archives legacy backlog before admission reaches the exact 262144-byte budget', async t => {
  const f = await retentionFixture(t);
  const first = await observeFixtureRepository(f);
  const backlog = [first];
  while (true) {
    f.clock.advance(1);
    const observation = {
      ...first, observedAt: new Date(f.clock.now()).toISOString(),
      evidenceRef: `fixture:legacy-refresh:${f.clock.now()}`,
    };
    const { type, id: ignored, workItemId, repositoryId, ...value } = observation;
    void type; void ignored; void workItemId; void repositoryId;
    observation.id = `repository-observation-${digest(value).slice(0, 40)}`;
    if (Buffer.byteLength(canonical([...backlog, observation])) > LIMITS.workingSet) break;
    backlog.push(observation);
  }
  const bytes = Buffer.byteLength(canonical(backlog));
  assert.equal(LIMITS.workingSet, 262144);
  assert.ok(bytes <= LIMITS.workingSet && LIMITS.workingSet - bytes < 1024);
  assert.ok(backlog.length > 250, 'the fixture must exercise hundreds of historical observations');
  await f.store.transaction(f.workItemId, tx => {
    for (const observation of backlog) tx.put(observation);
  });
  f.clock.advance(1);
  const latest = await observeFixtureRepository(f);
  const active = await f.store.records(f.workItemId);
  assert.deepEqual(active.map(record => record.id), [latest.id]);
  const historical = JSON.parse(await archivedBytes(f, first.id));
  assert.deepEqual(historical, first);
  assert.equal((await f.store.currentRepositoryObservation(f.workItemId,
    'primary')).observation.id, latest.id);
});

async function crowdedObservationFixture(t) {
  const f = await retentionFixture(t);
  const first = await observeFixtureRepository(f);
  const operation = actionOperation(f, first, 'uncertain');
  operation.evidenceRef = first.id;
  const backlog = [first];
  const target = 262044;
  while (true) {
    f.clock.advance(1);
    const observation = {
      ...first, observedAt: new Date(f.clock.now()).toISOString(),
      evidenceRef: `fixture:combined-crash:${f.clock.now()}`,
    };
    const { type, id: ignored, workItemId, repositoryId, ...value } = observation;
    void type; void ignored; void workItemId; void repositoryId;
    observation.id = `repository-observation-${digest(value).slice(0, 40)}`;
    if (Buffer.byteLength(canonical([operation, ...backlog, observation])) > target) break;
    backlog.push(observation);
  }
  let remaining = target - Buffer.byteLength(canonical([operation, ...backlog]));
  for (const observation of backlog.toReversed()) {
    if (!remaining) break;
    const padding = Math.min(remaining, 512 - observation.evidenceRef.length);
    observation.evidenceRef += 'x'.repeat(padding);
    const { type, id: ignored, workItemId, repositoryId, ...value } = observation;
    void type; void ignored; void workItemId; void repositoryId;
    observation.id = `repository-observation-${digest(value).slice(0, 40)}`;
    remaining -= padding;
  }
  assert.equal(remaining, 0);
  assert.equal(Buffer.byteLength(canonical([operation, ...backlog])), target);
  assert.ok(backlog.length > 250);
  await f.store.transaction(f.workItemId, tx => {
    tx.put(operation);
    for (const observation of backlog) tx.put(observation);
  });
  const bytes = new Map(await Promise.all(backlog.map(async record => [
    record.id, await fs.readFile(f.store.recordPath(f.workItemId, record.id)),
  ])));
  const predecessor = backlog.at(-1);
  return { f, first, operation, backlog, bytes, predecessor };
}

test('FR-063/064 a replacement-write interruption at 262044 bytes remains loadable and prunable', async t => {
  const { f, first, operation, backlog, bytes, predecessor } =
    await crowdedObservationFixture(t);
  f.clock.advance(1);
  let interrupted = false;
  f.store.fault = async point => {
    if (!interrupted && point === 'record:repository-observation') {
      interrupted = true;
      throw new Error('fixture interruption after replacement write at capacity');
    }
  };
  await assert.rejects(observeFixtureRepository(f, { revision: 'b'.repeat(40) }), {
    message: 'fixture interruption after replacement write at capacity',
  });
  assert.equal(interrupted, true);
  f.store.fault = async () => {};
  await assert.doesNotReject(
    f.store.load(f.workItemId, { recoverCheckpoint: true }),
    'replacement-write interruption must remain recoverable under the unchanged 262144-byte limit');
  await assert.doesNotReject(pruneWork(f.store, f.workItemId),
    'pruneWork must be able to finish interrupted near-capacity retention');
  const active = await f.store.records(f.workItemId);
  assert.ok(Buffer.byteLength(canonical(active)) <= LIMITS.workingSet);
  for (const record of [operation, first, predecessor]) {
    assert.ok(active.some(candidate => candidate.id === record.id),
      'active/uncertain source dependencies must survive recovery');
  }
  const current = (await f.store.currentRepositoryObservation(f.workItemId,
    'primary')).observation;
  assert.equal(current.revision, 'b'.repeat(40));
  assert.ok(current.observedAt > predecessor.observedAt);
  for (const record of backlog) {
    const recoveredBytes = active.some(candidate => candidate.id === record.id) ?
      await fs.readFile(f.store.recordPath(f.workItemId, record.id)) :
      await archivedBytes(f, record.id);
    assert.deepEqual(recoveredBytes, bytes.get(record.id));
  }
  f.clock.value = Date.parse(first.observedAt);
  await assert.rejects(observeFixtureRepository(f), { code: 'STALE' });
});

test('FR-064 interrupted headroom reclamation preserves original heads, dependencies and checkpoint bytes', async t => {
  const { f, first, operation, backlog, bytes, predecessor } =
    await crowdedObservationFixture(t);
  const checkpointFile = path.join(f.store.workPath(f.workItemId), 'checkpoint.json');
  const checkpointBytes = await fs.readFile(checkpointFile);
  f.clock.advance(1);
  let interrupted = false;
  f.store.fault = async point => {
    if (!interrupted && point === 'retention:remove:repository-observation') {
      interrupted = true;
      throw new Error('fixture interruption during headroom reclamation');
    }
  };
  await assert.rejects(observeFixtureRepository(f, { revision: 'b'.repeat(40) }), {
    message: 'fixture interruption during headroom reclamation',
  });
  assert.equal(interrupted, true);
  assert.deepEqual(await fs.readFile(checkpointFile), checkpointBytes);
  f.store.fault = async () => {};
  const recovered = await f.store.load(f.workItemId, { recoverCheckpoint: true });
  for (const record of [first, operation, predecessor]) {
    assert.ok(recovered.records.some(candidate => candidate.id === record.id),
      'eager reclamation must not remove an original current head or dependency');
  }
  assert.equal((await f.store.currentRepositoryObservation(f.workItemId,
    'primary')).observation.id, predecessor.id);
  for (const record of backlog) {
    const recoveredBytes = recovered.records.some(candidate => candidate.id === record.id) ?
      await fs.readFile(f.store.recordPath(f.workItemId, record.id)) :
      await archivedBytes(f, record.id);
    assert.deepEqual(recoveredBytes, bytes.get(record.id));
  }
  await observeFixtureRepository(f, { revision: 'b'.repeat(40) });
  await pruneWork(f.store, f.workItemId);
  assert.equal((await f.store.currentRepositoryObservation(f.workItemId,
    'primary')).observation.revision, 'b'.repeat(40));
});

test('FR-063 insufficient replacement headroom fails before writing or removing protected active evidence', async t => {
  const f = await retentionFixture(t);
  const first = await observeFixtureRepository(f);
  const records = [first];
  const target = 262044;
  while (true) {
    const sequence = records.length;
    const record = {
      type: 'test-evidence', id: `evidence-headroom-${sequence}`,
      workItemId: f.workItemId, sequence, cycleId: 'cycle-history',
      testId: `T-${sequence}`, testSpecDigest: 'c'.repeat(64),
      candidateDigest: 'd'.repeat(64), environment: 'local',
      implementation: 'ready', status: 'NotRun', activity: 'pending',
      observedAt: new Date(f.clock.now()).toISOString(),
      evidenceRef: `fixture:protected-evidence:${sequence}`, owner: 'agent', host: 'local',
    };
    if (Buffer.byteLength(canonical([...records, record])) > target) break;
    records.push(record);
  }
  let remaining = target - Buffer.byteLength(canonical(records));
  for (const record of records.toReversed()) {
    if (!remaining) break;
    const padding = Math.min(remaining, 512 - record.evidenceRef.length);
    record.evidenceRef += 'x'.repeat(padding);
    remaining -= padding;
  }
  assert.equal(remaining, 0);
  assert.equal(Buffer.byteLength(canonical(records)), target);
  await f.store.transaction(f.workItemId, tx => {
    for (const record of records) tx.put(record);
  });
  const checkpointFile = path.join(f.store.workPath(f.workItemId), 'checkpoint.json');
  const checkpointBytes = await fs.readFile(checkpointFile);
  const originalBytes = await fs.readFile(f.store.recordPath(f.workItemId, first.id));
  f.clock.advance(1);
  await assert.rejects(observeFixtureRepository(f, { revision: 'b'.repeat(40) }), {
    code: 'CAPACITY',
    message: 'Observation replacement commit working set exceeds 262144 UTF-8 bytes; no data was truncated',
  });
  assert.deepEqual(await fs.readFile(checkpointFile), checkpointBytes);
  assert.deepEqual(await fs.readFile(f.store.recordPath(f.workItemId, first.id)), originalBytes);
  assert.deepEqual(new Set((await f.store.records(f.workItemId)).map(record => record.id)),
    new Set(records.map(record => record.id)));
  assert.equal((await f.store.currentRepositoryObservation(f.workItemId,
    'primary')).observation.id, first.id);
  await pruneWork(f.store, f.workItemId);
  const latest = await observeFixtureRepository(f, { revision: 'b'.repeat(40) });
  assert.equal(latest.revision, 'b'.repeat(40));
  assert.deepEqual(await archivedBytes(f, first.id), originalBytes);
});

test('FR-064 archival preserves original formatting and rejects conflicting immutable evidence', async t => {
  const f = await retentionFixture(t);
  const first = await observeFixtureRepository(f);
  const original = Buffer.from(`${JSON.stringify(first, null, 2)}\n`);
  await fs.writeFile(f.store.recordPath(f.workItemId, first.id), original);
  const destination = path.join(f.store.workPath(f.workItemId), 'evidence', `${first.id}.json`);
  const conflicting = { ...first, evidenceRef: 'fixture:conflicting-history' };
  await writeJson(destination, conflicting);
  f.clock.advance(1);
  await assert.rejects(observeFixtureRepository(f), { code: 'ID_CONFLICT' });
  assert.deepEqual(await readJson(destination), conflicting);
  assert.deepEqual(await fs.readFile(f.store.recordPath(f.workItemId, first.id)), original);
  await fs.unlink(destination);
  await observeFixtureRepository(f);
  assert.deepEqual(await archivedBytes(f, first.id), original);
});

test('FR-063 current checkout/URL/connection and PR identities remain independently active', async t => {
  const f = await retentionFixture(t);
  const first = await observeFixtureRepository(f);
  const pr = await refreshPr(f, first);
  f.clock.advance(1);
  const otherConnection = await observeFixtureRepository(f, { connection: 'second-connection' });
  f.clock.advance(1);
  const secondPr = await refreshPr(f, otherConnection, undefined,
    { pullRequestRef: 'independent-pr' });
  f.clock.advance(1);
  const latest = await observeFixtureRepository(f, { connection: 'second-connection' });
  await f.runGit('remote', 'set-url', 'origin', 'https://example.invalid/second.git');
  f.clock.advance(1);
  const otherURL = await observeFixtureRepository(f, { connection: 'second-connection' });
  const otherPath = { ...otherURL,
    localRepositoryPath: path.join(f.root, 'other-checkout'),
    observedAt: new Date(f.clock.now() + 1).toISOString() };
  const { type, id: ignored, workItemId, repositoryId, ...value } = otherPath;
  void type; void ignored; void workItemId; void repositoryId;
  otherPath.id = `repository-observation-${digest(value).slice(0, 40)}`;
  await f.store.transaction(f.workItemId, tx => tx.put(otherPath));
  await pruneObservations(f);
  const active = await f.store.records(f.workItemId);
  for (const record of [first, latest, otherURL, otherPath, pr, secondPr]) {
    assert.ok(active.some(candidate => candidate.id === record.id), record.id);
  }
  assert.equal(active.some(record => record.id === otherConnection.id), false);
  assert.deepEqual(JSON.parse(await archivedBytes(f, otherConnection.id)), otherConnection);
});
