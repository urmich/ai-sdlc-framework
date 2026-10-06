import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fixture, grant } from './helpers.mjs';
import { associateMonitor, attachMonitor, refreshMonitorCapabilities, claimMonitor, beginPoll, observeMonitor, readMonitor, readMonitorAssociation, verifyMonitorLink, monitorNotice, interruptMonitor, dueMonitors, pruneMonitor, runKey } from '../src/monitors.mjs';
import { azureDevOpsScopeRef, legacyExecutionRunKey, registerProviderAdapter } from '../src/provider-adapters.mjs';
import { digest } from '../src/core.mjs';
import { pullRequestObservationKey } from '../src/repository-observations.mjs';
import { formatAudit, recordAudit, replayAudit } from '../src/audit.mjs';
import { pruneWork } from '../src/operations.mjs';

const identity = (executionRef, overrides = {}) => ({
  provider: 'azure-devops',
  connection: 'fixture',
  scopeRef: azureDevOpsScopeRef({
    projectId: 'project-id',
    repositoryId: 'repository-id',
  }),
  definitionRef: '17',
  executionRef,
  ...overrides,
});
const observation = (executionRef, {
  definitionId = '17',
  metadataBuildId = executionRef,
  finalBuildId = executionRef,
  accessible = true,
} = {}) => ({
  connection: 'fixture',
  build: {
    id: executionRef,
    project: { id: 'project-id' },
    repository: { id: 'repository-id' },
    definition: { id: definitionId },
    _links: {
      web: {
        href: `https://dev.azure.com/example/project/_build/results?buildId=${metadataBuildId}&view=results`,
      },
    },
  },
  access: {
    accessible,
    finalUrl: `https://dev.azure.com/example/project/_build/results?buildId=${finalBuildId}&view=summary`,
  },
});

async function terminalEvidenceMonitor(f, executionRef, checkResults) {
  const runIdentity = identity(executionRef, { attemptKind: 'not-applicable' });
  const attached = await attachMonitor(f.store, {
    identity: runIdentity, origin: 'framework', workItemId: f.workItemId,
    schedulerAvailable: true, readAvailable: true,
  });
  const claimed = await claimMonitor(f.store, {
    runKey: attached.key, workerId: `worker-${executionRef}`,
  });
  const poll = await beginPoll(f.store, {
    runKey: attached.key, workerId: claimed.workerId,
    claimGeneration: claimed.claimGeneration,
  });
  const file = path.join(f.root, `${executionRef}.bin`);
  const bytes = Buffer.from(`Provider result for ${executionRef}`);
  await fs.writeFile(file, bytes);
  const evidence = { reference: {
    locator: `fixture:${executionRef}`,
    retrievalContext: {
      provider: 'azure-devops', connection: 'fixture',
      scopeRef: runIdentity.scopeRef, retrievedAt: new Date(f.clock.now()).toISOString(),
    },
    sha256: digest(bytes),
  } };
  if (checkResults) f.store.verifyCheckResults = () => ({
    identity: runIdentity, status: 'succeeded',
    evidenceReference: evidence.reference, checkResults,
  });
  const observed = await observeMonitor(f.store, {
    runKey: attached.key, workerId: claimed.workerId,
    claimGeneration: claimed.claimGeneration, pollGeneration: poll.pollGeneration,
    identity: runIdentity, status: 'succeeded', evidence, evidenceFilePath: file,
    ...(checkResults ? { checkResults } : {}),
  });
  assert.deepEqual(observed.evidenceVerification, { verified: true, identity: 'sha256' });
  return { runIdentity, key: attached.key, evidence, file };
}

async function deliverTerminalNotice(store, key) {
  const pending = await monitorNotice(store, { runKey: key });
  assert.deepEqual({ kind: pending.notice.kind, status: pending.notice.status },
    { kind: 'terminal', status: 'pending' });
  const delivered = await monitorNotice(store, {
    runKey: key, noticeGeneration: pending.notice.generation,
    deliveredRef: 'fixture:delivered',
  });
  assert.equal(delivered.notice.status, 'delivered');
}

async function assertActiveEvidence(f, key, evidence) {
  const active = await readMonitor(f.store, key);
  assert.equal(active.runStatus, 'succeeded');
  assert.deepEqual(active.evidence, evidence);
  assert.deepEqual(active.evidenceVerification, { verified: true, identity: 'sha256' });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.store.runtime,
    'pipeline-monitors', `${key}.json`), 'utf8')), active);
  await assert.rejects(fs.stat(path.join(f.store.runtime,
    'pipeline-monitors', 'archive', `${key}.json`)), { code: 'ENOENT' });
}

test('T-110 an undelivered terminal notice alone retains verified evidence until delivery', async t => {
  const f = await fixture(t);
  const { key, evidence } = await terminalEvidenceMonitor(f, 'notice-only');
  await assert.rejects(pruneMonitor(f.store, { runKey: key }), { code: 'MONITOR' });
  await assertActiveEvidence(f, key, evidence);
  await deliverTerminalNotice(f.store, key);
  assert.equal((await pruneMonitor(f.store, { runKey: key })).archived, true);
  assert.deepEqual((await readMonitor(f.store, key)).evidence, evidence);
});

test('T-110 a concurrent terminal-action write blocks pruning and retains its sole evidence', async t => {
  const f = await fixture(t);
  const { key, evidence } = await terminalEvidenceMonitor(f, 'action-race');
  await deliverTerminalNotice(f.store, key);
  let started;
  let release;
  const writing = new Promise(resolve => { started = resolve; });
  const released = new Promise(resolve => { release = resolve; });
  const mutation = f.store.transaction(f.workItemId, async tx => {
    tx.put({
      type: 'operation', id: 'op-terminal-monitor-consumer',
      workItemId: f.workItemId, repositoryId: 'primary', class: 'build',
      action: { class: 'build' }, target: 'fixture-build', status: 'succeeded',
      correlationKey: 'fixture-action', requestFingerprint: digest('fixture-action'),
      dispatchBound: true, evidenceRef: key,
    });
    started();
    await released;
  });
  await writing;
  try {
    await assert.rejects(pruneMonitor(f.store, { runKey: key }), { code: 'LOCK_BUSY' });
  } finally {
    release();
    await mutation;
  }
  await assert.rejects(pruneMonitor(f.store, { runKey: key }), { code: 'MONITOR' });
  assert.equal((await f.store.records(f.workItemId)).find(record =>
    record.id === 'op-terminal-monitor-consumer').evidenceRef, key);
  await assertActiveEvidence(f, key, evidence);
});

test('T-110 incomplete recovery alone retains delivered terminal evidence', async t => {
  const f = await fixture(t);
  const { key, evidence } = await terminalEvidenceMonitor(f, 'recovery-only');
  await deliverTerminalNotice(f.store, key);
  const token = await f.store.beginRecovery(f.workItemId);
  await assert.rejects(pruneMonitor(f.store, { runKey: key }), { code: 'RECOVERY' });
  assert.equal((await f.store.load(f.workItemId)).recoveryRequired, true);
  await assertActiveEvidence(f, key, evidence);
  await f.store.completeRecovery(f.workItemId, token);
  assert.equal((await pruneMonitor(f.store, { runKey: key })).archived, true);
  assert.deepEqual((await readMonitor(f.store, key)).evidence, evidence);
});

test('T-110 a genuinely audited decision referencing a run retains its evidence through work-item and monitor pruning', async t => {
  const f = await fixture(t);
  const { key, evidence } = await terminalEvidenceMonitor(f, 'audited-run');
  await deliverTerminalNotice(f.store, key);
  const { event } = await grant(f, 'scope-inclusion', { itemId: key });
  const formatted = await formatAudit(f.store, f.workItemId, [event.id]);
  await f.runGit('add', '.sdlc');
  await f.runGit('commit', '-qm', `Audit the monitored work item\n\n${formatted.trailers}`);
  const commit = await f.runGit('rev-parse', 'HEAD');
  assert.deepEqual((await recordAudit(f.store, {
    workItemId: f.workItemId, repositoryId: 'primary', commit,
  })).verified, [event.id]);
  const auditReference = (await f.store.records(f.workItemId)).find(record =>
    record.type === 'audit-reference' && record.eventId === event.id);
  assert.deepEqual({
    eventId: auditReference.eventId, eventDigest: auditReference.eventDigest,
    repositoryId: auditReference.repositoryId, commit: auditReference.commit,
  }, { eventId: event.id, eventDigest: event.digest,
    repositoryId: 'primary', commit });
  assert.deepEqual((await replayAudit(f.store, f.workItemId)).events.map(record =>
    record.id), [event.id]);
  await pruneWork(f.store, f.workItemId);
  const retained = await f.store.records(f.workItemId);
  assert.equal(retained.find(record => record.id === event.id).effect.itemId, key);
  assert.equal(retained.find(record => record.id === auditReference.id).eventId, event.id);
  await assert.rejects(pruneMonitor(f.store, { runKey: key }), { code: 'MONITOR' });
  await assertActiveEvidence(f, key, evidence);
});

test('T-110 a current PR/check association alone retains verified terminal evidence', async t => {
  const f = await fixture(t);
  const sourceRevision = 'a'.repeat(40);
  const targetRevision = 'b'.repeat(40);
  const remoteRepositoryURL = 'https://example.invalid/repository.git';
  const prObservation = {
    localRepositoryPath: f.repo, remoteRepositoryURL,
    provider: 'azure-devops', connection: 'fixture', repositoryRef: 'repository-id',
    pullRequestRef: 'pr-association-only', sourceBranchRef: 'refs/heads/feature',
    targetBranchRef: 'refs/heads/main', sourceRevision, targetRevision,
    state: 'active', sequence: 1, observedAt: new Date(f.clock.now()).toISOString(),
    evidenceRef: 'fixture:pr-read',
  };
  const pr = {
    type: 'pr-observation',
    id: pullRequestObservationKey(prObservation, {
      canonicalLocalRepositoryPath: f.repo,
      verifiedRemoteRepositoryURL: remoteRepositoryURL,
      verifiedProvider: 'azure-devops', verifiedConnection: 'fixture',
      verifiedRepositoryRef: 'repository-id',
      verifiedPullRequestRef: prObservation.pullRequestRef,
    }),
    workItemId: f.workItemId, repositoryId: 'primary', ...prObservation,
  };
  await f.store.transaction(f.workItemId, tx => tx.put(pr));
  const result = {
    requiredCheckRef: 'build', checkResultRef: 'result-association-only',
    producerRef: '17', testedRevision: sourceRevision,
    evidenceRef: 'fixture:check-read', status: 'succeeded',
    localRepositoryPath: f.repo, remoteRepositoryURL,
    repositoryRef: pr.repositoryRef, pullRequestRef: pr.pullRequestRef,
    sourceRevision, targetRevision,
  };
  const { key, evidence } = await terminalEvidenceMonitor(f, 'association-only', [result]);
  await deliverTerminalNotice(f.store, key);
  await verifyMonitorLink(f.store, {
    runKey: key, adapterId: 'azure-devops',
    observation: observation('association-only'), evidenceRef: 'fixture:run-link',
  });
  const linkNotice = await monitorNotice(f.store, { runKey: key });
  await monitorNotice(f.store, {
    runKey: key, noticeGeneration: linkNotice.notice.generation,
    deliveredRef: 'fixture:link-delivered',
  });
  const associationInput = {
    runKey: key, workItemId: f.workItemId, prRecordId: pr.id,
    prObservationKey: pr.id, localRepositoryPath: f.repo, remoteRepositoryURL,
    checkId: 'build', requiredCheckRef: 'build',
    checkResultRef: result.checkResultRef, producerRef: result.producerRef,
    testedRevision: sourceRevision, sourceRevision, targetRevision,
    evidenceRef: result.evidenceRef, evidence,
  };
  const association = await associateMonitor(f.store, associationInput);
  assert.equal((await readMonitorAssociation(f.store, associationInput)).key, association.key);
  await assert.rejects(pruneMonitor(f.store, { runKey: key }), { code: 'MONITOR' });
  await assertActiveEvidence(f, key, evidence);
  await f.store.transaction(f.workItemId, tx => tx.remove(pr.id));
  assert.equal((await pruneMonitor(f.store, { runKey: key })).archived, true);
  assert.deepEqual((await readMonitor(f.store, key)).evidence, evidence);
});

test('T-25/T-30 standalone user-reported runs poll immediately and every fake-clock minute without granting authority', async t => {
  const f = await fixture(t, { initialize: false });
  const runIdentity = identity('42');
  const attached = await attachMonitor(f.store, { identity: runIdentity,
    origin: 'user-reported', reportingReceiptId: 'receipt-reported', environment: 'PROD', schedulerAvailable: true, readAvailable: true });
  const claim = await claimMonitor(f.store, { runKey: attached.key, workerId: 'worker-one' });
  await assert.rejects(pruneMonitor(f.store, { runKey: attached.key }), { code: 'MONITOR' });
  const worker = { runKey: attached.key, workerId: 'worker-one', claimGeneration: claim.claimGeneration };
  let poll = await beginPoll(f.store, worker);
  await assert.rejects(beginPoll(f.store, worker), { code: 'MONITOR' });
  await claimMonitor(f.store, { runKey: attached.key, workerId: 'worker-one' });
  await assert.rejects(beginPoll(f.store, worker), { code: 'MONITOR' });
  let result = await observeMonitor(f.store, { ...worker,
    pollGeneration: poll.pollGeneration, identity: runIdentity,
    status: 'running', evidenceRef: 'fixture:run-read' });
  const firstPollGeneration = poll.pollGeneration;
  assert.equal(result.monitorStatus, 'active');
  assert.equal(result.link.status, 'pending');
  assert.equal(Date.parse(result.nextPollAt), f.clock.now() + 60000);
  await verifyMonitorLink(f.store, { runKey: attached.key,
    adapterId: 'azure-devops',
    observation: observation('42', {
      finalBuildId: '999',
    }),
    evidenceRef: 'fixture:wrong-final-run' });
  assert.equal((await monitorNotice(f.store, { runKey: attached.key })).link.status, 'unverified');
  f.clock.advance(60000);
  assert.equal((await dueMonitors(f.store)).length, 1);
  poll = await beginPoll(f.store, worker);
  await assert.rejects(observeMonitor(f.store, { ...worker,
    pollGeneration: firstPollGeneration, identity: runIdentity,
    status: 'running', evidenceRef: 'fixture:stale-poll' }),
  { code: 'STALE' });
  result = await observeMonitor(f.store, { ...worker,
    pollGeneration: poll.pollGeneration, identity: runIdentity,
    status: 'waiting-approval', evidenceRef: 'fixture:approval-wait' });
  assert.equal(result.monitorStatus, 'active');
  await verifyMonitorLink(f.store, { runKey: attached.key,
    adapterId: 'azure-devops', observation: observation('42'),
    evidenceRef: 'fixture:run-page' });
  const priorNotice = await monitorNotice(f.store, { runKey: attached.key });
  f.clock.advance(60000);
  poll = await beginPoll(f.store, worker);
  result = await observeMonitor(f.store, { ...worker,
    pollGeneration: poll.pollGeneration, identity: runIdentity,
    status: 'succeeded', evidenceRef: 'fixture:terminal' });
  assert.equal(result.nextPollAt, null);
  const notice = await monitorNotice(f.store, { runKey: attached.key });
  assert.match(notice.message, /user-reported/u);
  assert.equal(notice.notice.kind, 'terminal');
  assert.equal(notice.link.status, 'verified');
  await assert.rejects(monitorNotice(f.store, {
    runKey: attached.key,
    deliveredRef: 'fixture:stale-notification',
    noticeGeneration: priorNotice.notice.generation,
  }), { code: 'STALE' });
  assert.equal((await monitorNotice(f.store, {
    runKey: attached.key,
    deliveredRef: 'fixture:user-notified',
    noticeGeneration: notice.notice.generation,
  })).notice.status, 'delivered');
  assert.deepEqual(await dueMonitors(f.store), []);
  assert.equal((await pruneMonitor(f.store, { runKey: attached.key })).archived, true);
  assert.equal((await monitorNotice(f.store, { runKey: attached.key })).notice.status, 'delivered');
});

test('T-110 observe rejects serialized credentials without storing them or changing poll state', async t => {
  const f = await fixture(t, { initialize: false });
  const runIdentity = identity('sensitive-observation', { attemptKind: 'not-applicable' });
  const attached = await attachMonitor(f.store, {
    identity: runIdentity, origin: 'framework',
    schedulerAvailable: true, readAvailable: true,
  });
  const claim = await claimMonitor(f.store, {
    runKey: attached.key, workerId: 'sensitive-worker',
  });
  const worker = { runKey: attached.key, workerId: 'sensitive-worker',
    claimGeneration: claim.claimGeneration };
  const poll = await beginPoll(f.store, worker);
  const monitorPath = path.join(f.store.runtime, 'pipeline-monitors', `${attached.key}.json`);
  const before = await fs.readFile(monitorPath);
  const observation = {
    ...worker, pollGeneration: poll.pollGeneration, identity: runIdentity,
    status: 'succeeded',
  };
  for (const evidence of [
    { summary: '{"access_token":"fixture-only-sensitive-marker"}' },
    { summary: '{"rawProviderResponse":{"content":"fixture-only-sensitive-marker"}}' },
    { reference: { locator: 'fixture:diagnostic',
      retrievalContext: {
        provider: 'fixture', connection: 'httpHeaders: fixture-only-sensitive-marker',
        scopeRef: 'scope', retrievedAt: new Date(f.clock.now()).toISOString(),
      } } },
  ]) {
    await assert.rejects(observeMonitor(f.store, { ...observation, evidence }),
      { code: 'UNSAFE' });
    assert.deepEqual(await fs.readFile(monitorPath), before);
    assert.deepEqual(await readMonitor(f.store, attached.key), JSON.parse(before));
    assert.equal((await readMonitor(f.store, attached.key)).inFlight, true);
  }
  const valid = await observeMonitor(f.store, {
    ...observation, status: 'running', evidence: { summary: 'Run is still running.' },
  });
  assert.equal(valid.runStatus, 'running');
  assert.equal(valid.evidence.summary, 'Run is still running.');
  assert.equal((await fs.readFile(monitorPath, 'utf8')).includes('fixture-only-sensitive-marker'), false);
});

test('T-25 stale monitor workers, wrong run links and read failures retain observable gaps', async t => {
  const f = await fixture(t, { initialize: false });
  const runIdentity = identity('2', { definitionRef: '1' });
  const attached = await attachMonitor(f.store, { identity: runIdentity,
    origin: 'framework', schedulerAvailable: true, readAvailable: true });
  const claim = await claimMonitor(f.store, { runKey: attached.key, workerId: 'old-worker' });
  const old = { runKey: attached.key, workerId: 'old-worker', claimGeneration: claim.claimGeneration };
  const poll = await beginPoll(f.store, old);
  await observeMonitor(f.store, { ...old,
    pollGeneration: poll.pollGeneration, identity: runIdentity,
    error: 'Provider read access unavailable' });
  f.clock.advance(180000);
  assert.equal((await dueMonitors(f.store))[0].gapDetected, true);
  await interruptMonitor(f.store, { runKey: attached.key, reason: 'Host stopped; polling was interrupted' });
  const replacement = await claimMonitor(f.store, { runKey: attached.key, workerId: 'new-worker', replaceInterrupted: true });
  await assert.rejects(beginPoll(f.store, old), { code: 'STALE' });
  assert.ok(replacement.gapCount > 0);
  const link = await verifyMonitorLink(f.store, { runKey: attached.key,
    adapterId: 'azure-devops',
    observation: observation('2', {
      definitionId: '1',
      metadataBuildId: '999',
    }),
    evidenceRef: 'fixture:wrong-run' });
  assert.equal(link.link.status, 'unverified');
  await assert.rejects(attachMonitor(f.store, { identity: runIdentity,
    origin: 'user-reported', reportingReceiptId: 'receipt-other', schedulerAvailable: true, readAvailable: true }), { code: 'ID_CONFLICT' });
});
test('T-25 blocked monitor capabilities recover only through explicit refresh evidence', async t => {
  const f = await fixture(t, { initialize: false });
  await assert.rejects(attachMonitor(f.store, { identity: identity('bad'),
    origin: 'framework',
    schedulerAvailable: 'false', readAvailable: 'false' }), { code: 'INPUT' });
  const attached = await attachMonitor(f.store, { identity: identity('3', {
    definitionRef: 'blocked',
  }), origin: 'framework', schedulerAvailable: false, readAvailable: false });
  await assert.rejects(claimMonitor(f.store, { runKey: attached.key, workerId: 'worker-blocked' }), { code: 'CAPABILITY' });
  await assert.rejects(beginPoll(f.store, { runKey: attached.key, workerId: null, claimGeneration: 0 }), { code: 'STALE' });
  const refreshed = await refreshMonitorCapabilities(f.store, { runKey: attached.key,
    schedulerAvailable: true, readAvailable: true, evidenceRef: 'fixture:capabilities-restored' });
  assert.equal(refreshed.monitorStatus, 'pending');
  const claim = await claimMonitor(f.store, { runKey: attached.key, workerId: 'worker-restored' });
  assert.equal(claim.workerId, 'worker-restored');
});

test('T-105 historical Azure DevOps build stays the only worker and remains history after archive', async t => {
  const f = await fixture(t, { initialize: false });
  const historicalIdentity = identity('historical-build');
  const currentIdentity = identity('historical-build', { attemptKind: 'not-applicable' });
  const attach = identity => attachMonitor(f.store, {
    identity, origin: 'framework', schedulerAvailable: true, readAvailable: true,
  });
  const historical = await attach(historicalIdentity);
  assert.equal(historical.key, legacyExecutionRunKey(currentIdentity));
  assert.notEqual(historical.key, runKey(currentIdentity));
  const claimed = await claimMonitor(f.store, {
    runKey: historical.key, workerId: 'historical-worker',
  });
  const sameRun = await attach(currentIdentity);
  assert.equal(sameRun.key, historical.key);
  assert.equal(sameRun.workerId, 'historical-worker');
  assert.equal(sameRun.claimGeneration, claimed.claimGeneration);
  await assert.rejects(claimMonitor(f.store, {
    runKey: sameRun.key, workerId: 'second-worker',
  }), { code: 'LOCK_BUSY' });
  assert.deepEqual((await dueMonitors(f.store)).map(item => item.runKey), [historical.key]);
  const poll = await beginPoll(f.store, {
    runKey: historical.key, workerId: 'historical-worker',
    claimGeneration: claimed.claimGeneration,
  });
  await observeMonitor(f.store, {
    runKey: historical.key, workerId: 'historical-worker',
    claimGeneration: claimed.claimGeneration, pollGeneration: poll.pollGeneration,
    identity: historicalIdentity, status: 'succeeded', evidenceRef: 'fixture:historical-result',
  });
  const notice = await monitorNotice(f.store, { runKey: historical.key });
  await monitorNotice(f.store, {
    runKey: historical.key, noticeGeneration: notice.notice.generation,
    deliveredRef: 'fixture:historical-notice',
  });
  assert.equal((await pruneMonitor(f.store, { runKey: historical.key })).archived, true);
  const archived = await readMonitor(f.store, historical.key);
  assert.equal(archived.identity.attemptKind, undefined);
  assert.equal((await attach(currentIdentity)).key, historical.key);
  assert.deepEqual(await readMonitor(f.store, historical.key), archived);
  assert.equal(await readMonitor(f.store, runKey(currentIdentity)), null);
  assert.deepEqual(await dueMonitors(f.store), []);
});

test('T-105 current and historical Azure DevOps attach calls race without making two active records', async t => {
  const f = await fixture(t, { initialize: false });
  const historicalIdentity = identity('racing-build');
  const currentIdentity = identity('racing-build', { attemptKind: 'not-applicable' });
  const attach = identity => attachMonitor(f.store, {
    identity, origin: 'framework', schedulerAvailable: true, readAvailable: true,
  });
  const [historical, current] = await Promise.all([
    attach(historicalIdentity), attach(currentIdentity),
  ]);
  assert.equal(historical.key, current.key);
  const claimed = await claimMonitor(f.store, {
    runKey: current.key, workerId: 'first-worker',
  });
  await assert.rejects(claimMonitor(f.store, {
    runKey: historical.key, workerId: 'second-worker',
  }), { code: 'LOCK_BUSY' });
  assert.equal(claimed.workerId, 'first-worker');
  assert.deepEqual((await dueMonitors(f.store)).map(item => item.runKey), [current.key]);
});

test('T-105 historical attach reuses an already active current Azure DevOps build', async t => {
  const f = await fixture(t, { initialize: false });
  const currentIdentity = identity('current-first', { attemptKind: 'not-applicable' });
  const attach = identity => attachMonitor(f.store, {
    identity, origin: 'framework', schedulerAvailable: true, readAvailable: true,
  });
  const current = await attach(currentIdentity);
  const claimed = await claimMonitor(f.store, {
    runKey: current.key, workerId: 'current-worker',
  });
  const historical = await attach(identity('current-first'));
  assert.equal(historical.key, current.key);
  assert.equal(historical.workerId, 'current-worker');
  assert.equal(historical.claimGeneration, claimed.claimGeneration);
  assert.equal(await readMonitor(f.store, legacyExecutionRunKey(currentIdentity)), null);
  assert.deepEqual((await dueMonitors(f.store)).map(item => item.runKey), [current.key]);
});

test('T-110 observe verifies provider versions only with the trusted Store callback', async t => {
  const f = await fixture(t, { initialize: false });
  const filePath = path.join(f.root, 'provider-version-evidence.bin');
  await fs.writeFile(filePath, 'versioned provider bytes');
  const runIdentity = identity('versioned-evidence', { attemptKind: 'not-applicable' });
  const attached = await attachMonitor(f.store, {
    identity: runIdentity, origin: 'framework',
    schedulerAvailable: true, readAvailable: true,
  });
  const claim = await claimMonitor(f.store, {
    runKey: attached.key, workerId: 'version-worker',
  });
  const worker = { runKey: attached.key, workerId: 'version-worker',
    claimGeneration: claim.claimGeneration };
  const evidence = { reference: {
    locator: 'fixture:immutable-version',
    retrievalContext: {
      provider: 'azure-devops', connection: 'fixture', scopeRef: 'scope',
      retrievedAt: new Date(f.clock.now()).toISOString(),
    },
    immutableVersion: 'version-42',
  } };
  let calls = 0;
  f.store.verifyProviderVersion = ({ locator, retrievalContext, immutableVersion, bytes }) => {
    calls++;
    assert.equal(locator, evidence.reference.locator);
    assert.deepEqual(retrievalContext, evidence.reference.retrievalContext);
    assert.equal(immutableVersion, 'version-42');
    assert.equal(bytes.toString(), 'versioned provider bytes');
    return true;
  };
  const poll = await beginPoll(f.store, worker);
  await assert.rejects(observeMonitor(f.store, {
    ...worker, pollGeneration: poll.pollGeneration, identity: runIdentity,
    status: 'running', evidence, evidenceFilePath: filePath,
    providerVerified: true,
  }), { code: 'INPUT' });
  await assert.rejects(observeMonitor(f.store, {
    ...worker, pollGeneration: poll.pollGeneration, identity: runIdentity,
    status: 'running', evidenceFilePath: filePath,
    evidence: { reference: { ...evidence.reference, providerVerified: true } },
  }), { code: 'INPUT' });
  const verified = await observeMonitor(f.store, {
    ...worker, pollGeneration: poll.pollGeneration, identity: runIdentity,
    status: 'running', evidence, evidenceFilePath: filePath,
  });
  assert.deepEqual(verified.evidenceVerification,
    { verified: true, identity: 'provider-version' });
  assert.equal(calls, 1);
  delete f.store.verifyProviderVersion;
  f.clock.advance(60000);
  const nextPoll = await beginPoll(f.store, worker);
  const unverified = await observeMonitor(f.store, {
    ...worker, pollGeneration: nextPoll.pollGeneration, identity: runIdentity,
    status: 'succeeded', evidence, evidenceFilePath: filePath,
  });
  assert.deepEqual(unverified.evidenceVerification,
    { verified: false, reason: 'provider-version-unproven' });
  assert.equal(calls, 1);
  f.store.verifyProviderVersion = () => {
    assert.fail('SHA-256 verification must not request provider-version proof');
  };
  const shaIdentity = identity('sha-evidence', { attemptKind: 'not-applicable' });
  const shaMonitor = await attachMonitor(f.store, {
    identity: shaIdentity, origin: 'framework',
    schedulerAvailable: true, readAvailable: true,
  });
  const shaClaim = await claimMonitor(f.store, {
    runKey: shaMonitor.key, workerId: 'sha-worker',
  });
  const shaWorker = { runKey: shaMonitor.key, workerId: 'sha-worker',
    claimGeneration: shaClaim.claimGeneration };
  const shaPoll = await beginPoll(f.store, shaWorker);
  const hashed = await observeMonitor(f.store, {
    ...shaWorker, pollGeneration: shaPoll.pollGeneration, identity: shaIdentity,
    status: 'succeeded', evidenceFilePath: filePath,
    evidence: { reference: { locator: evidence.reference.locator,
      retrievalContext: evidence.reference.retrievalContext,
      sha256: digest('versioned provider bytes') } },
  });
  assert.deepEqual(hashed.evidenceVerification,
    { verified: true, identity: 'sha256' });
});

test('T-110 each poll write checks whole on-disk budget, unsafe content and unchanged state after rejection', async t => {
    const f = await fixture(t, { initialize: false });
    const runIdentity = identity('bounded-poll', { attemptKind: 'not-applicable' });
    const attached = await attachMonitor(f.store, {
      identity: runIdentity, origin: 'framework',
      schedulerAvailable: true, readAvailable: true,
    });
    const claimed = await claimMonitor(f.store, {
      runKey: attached.key, workerId: 'bounded-worker',
    });
    const worker = { runKey: attached.key, workerId: 'bounded-worker',
      claimGeneration: claimed.claimGeneration };
    const poll = await beginPoll(f.store, worker);
    const filePath = path.join(f.root, 'poll-evidence.bin');
    const bytes = Buffer.from('an immutable mock provider observation');
    await fs.writeFile(filePath, bytes);
    const evidence = {
      summary: 'x'.repeat(512),
      reference: {
        locator: `fixture:${'a'.repeat(504)}`,
        retrievalContext: {
          provider: 'azure-devops', connection: 'fixture',
          scopeRef: 'scope', retrievedAt: new Date(f.clock.now()).toISOString(),
        },
        sha256: digest(bytes),
      },
    };
    const oversizedResults = Array.from({ length: 10 }, (_, index) => ({
      requiredCheckRef: `required-${index}`,
      checkResultRef: `result-${index}-${'r'.repeat(110)}`,
      producerRef: '17', testedRevision: 'f'.repeat(40),
      evidenceRef: `fixture:check-${index}`, status: 'succeeded',
      localRepositoryPath: f.repo,
      remoteRepositoryURL: 'https://example.invalid/repository.git',
      repositoryRef: 'repository-id', pullRequestRef: '17',
      sourceRevision: 'f'.repeat(40), targetRevision: 'e'.repeat(40),
    }));
    f.store.verifyCheckResults = () => ({
      identity: runIdentity, status: 'succeeded',
      evidenceReference: evidence.reference, checkResults: oversizedResults,
    });
    const before = await fs.readFile(path.join(f.store.runtime,
      'pipeline-monitors', `${attached.key}.json`));
    await assert.rejects(observeMonitor(f.store, {
      ...worker, pollGeneration: poll.pollGeneration, identity: runIdentity,
      status: 'running',
      evidence: { summary: 'Authorization: synthetic-credential' },
    }), { code: 'UNSAFE' });
    await assert.rejects(observeMonitor(f.store, {
      ...worker, pollGeneration: poll.pollGeneration, identity: runIdentity,
      status: 'running', evidence: { summary: 'x'.repeat(513) },
    }), { code: 'INPUT' });
    await assert.rejects(observeMonitor(f.store, {
      ...worker, pollGeneration: poll.pollGeneration, identity: runIdentity,
      status: 'succeeded', evidence, evidenceFilePath: filePath,
      checkResults: oversizedResults,
    }), { code: 'CAPACITY' });
    assert.deepEqual(await fs.readFile(path.join(f.store.runtime,
      'pipeline-monitors', `${attached.key}.json`)), before);
    const result = await observeMonitor(f.store, {
      ...worker, pollGeneration: poll.pollGeneration, identity: runIdentity,
      status: 'running', evidence,
    });
    assert.equal(result.evidenceVerification.verified, false);
    assert.equal(result.evidenceVerification.reason, 'evidence-file-unavailable');
    const storedPath = path.join(f.store.runtime, 'pipeline-monitors',
      `${attached.key}.json`);
    assert.ok((await fs.stat(storedPath)).size <= 4096);
  });

test('T-110 a changed evidence file remains diagnostic, never a successful check result', async t => {
    const f = await fixture(t, { initialize: false });
    const runIdentity = identity('changed-evidence', { attemptKind: 'not-applicable' });
    const attached = await attachMonitor(f.store, {
      identity: runIdentity, origin: 'framework',
      schedulerAvailable: true, readAvailable: true,
    });
    const claimed = await claimMonitor(f.store, {
      runKey: attached.key, workerId: 'changed-worker',
    });
    const worker = { runKey: attached.key, workerId: 'changed-worker',
      claimGeneration: claimed.claimGeneration };
    const poll = await beginPoll(f.store, worker);
    const filePath = path.join(f.root, 'changed.bin');
    await fs.writeFile(filePath, 'different bytes');
    const evidence = {
      reference: {
        locator: 'fixture:changed',
        retrievalContext: {
          provider: 'azure-devops', connection: 'fixture',
          scopeRef: 'scope', retrievedAt: new Date(f.clock.now()).toISOString(),
        },
        sha256: digest('original bytes'),
      },
    };
    await assert.rejects(observeMonitor(f.store, {
      ...worker, pollGeneration: poll.pollGeneration, identity: runIdentity,
      status: 'succeeded', evidence, evidenceFilePath: filePath,
      checkResults: [{
        requiredCheckRef: 'build', checkResultRef: 'result-1',
        producerRef: '17', testedRevision: 'f'.repeat(40),
        status: 'succeeded', evidenceRef: 'fixture:result-1',
      }],
    }), { code: 'EVIDENCE' });
    const diagnostic = await observeMonitor(f.store, {
      ...worker, pollGeneration: poll.pollGeneration, identity: runIdentity,
      status: 'succeeded', evidence, evidenceFilePath: filePath,
    });
    assert.deepEqual(diagnostic.evidenceVerification,
      { verified: false, reason: 'sha256-mismatch' });
    assert.equal(diagnostic.checkResults, undefined);
  });
test('T-48 stale link callbacks cannot overwrite newer verification', async t => {
  const f = await fixture(t, { initialize: false });
  const provider = 'delayed-fixture-provider';
  let release;
  let started;
  const startedPromise = new Promise(resolve => { started = resolve; });
  const releasePromise = new Promise(resolve => { release = resolve; });
  registerProviderAdapter({
    id: provider,
    linkKinds: ['summary'],
    async normalizeLinkObservation(input) {
      if (input.delayed) {
        started();
        await releasePromise;
      }
      return {
        identity: input.identity,
        url: 'https://ci.example.invalid/job/api',
        kind: 'summary',
        accessible: input.accessible,
      };
    },
  });
  const runIdentity = {
    provider,
    connection: 'fixture',
    scopeRef: 'scope',
    definitionRef: 'definition',
    executionRef: 'execution',
  };
  const monitor = await attachMonitor(f.store, {
    identity: runIdentity,
    origin: 'framework',
    schedulerAvailable: true,
    readAvailable: true,
  });
  const older = verifyMonitorLink(f.store, {
    runKey: monitor.key,
    adapterId: provider,
    observation: {
      identity: runIdentity,
      delayed: true,
      accessible: true,
    },
    evidenceRef: 'fixture:older-success',
  });
  await startedPromise;
  const newer = await verifyMonitorLink(f.store, {
    runKey: monitor.key,
    adapterId: provider,
    observation: {
      identity: runIdentity,
      accessible: false,
    },
    evidenceRef: 'fixture:newer-failure',
  });
  assert.equal(newer.link.status, 'unverified');
  release();
  await older;
  assert.equal((await monitorNotice(f.store, {
    runKey: monitor.key,
  })).link.status, 'unverified');
});
