import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { coding, completeReview, fixture, grant, grantPush, pushAction } from './helpers.mjs';
import { preparePr, adoptPr, updatePrFacts, evaluateReadiness } from '../src/pr.mjs';
import { prepareOperation, markDispatching, recordOperation } from '../src/operations.mjs';
import { evaluatePolicy } from '../src/policy.mjs';
import { attachMonitor, beginPoll, claimMonitor, monitorNotice, observeMonitor,
  pruneMonitor, readMonitor, refreshMonitorCapabilities,
  verifyMonitorLink } from '../src/monitors.mjs';
import { recordTest, startCycle } from '../src/validation.mjs';
import { azureDevOpsScopeRef } from '../src/provider-adapters.mjs';
import { withLock } from '../src/files.mjs';

const executionIdentity = executionRef => ({
  provider: 'azure-devops',
  connection: 'fixture',
  scopeRef: azureDevOpsScopeRef({
    projectId: 'project-id',
    repositoryId: 'repository-id',
  }),
  definitionRef: 'check-build',
  executionRef,
});
const linkObservation = executionRef => ({
  connection: 'fixture',
  build: {
    id: executionRef,
    project: { id: 'project-id' },
    repository: { id: 'repository-id' },
    definition: { id: 'check-build' },
    _links: {
      web: {
        href: `https://dev.azure.com/example/project/_build/results?buildId=${executionRef}`,
      },
    },
  },
  access: {
    accessible: true,
    finalUrl: `https://dev.azure.com/example/project/_build/results?buildId=${executionRef}&view=results`,
  },
});
const prIdentity = () => ({ provider: 'azure-devops', connection: 'fixture', repositoryId: 'primary',
  sourceRef: 'refs/heads/feature/fixture', targetRef: 'refs/heads/trunk',
  sourceRevision: 'source-1', targetRevision: 'target-1', draft: true });
async function successfulCheckMonitor(f, prRecordId, {
  runId = '101',
  includePrContext = true,
  wrongLink = false,
} = {}) {
  const identity = executionIdentity(runId);
  const monitor = await attachMonitor(f.store, { identity,
    origin: 'framework', workItemId: f.workItemId,
    ...(includePrContext ? { prRecordId, checkId: 'check-build', sourceRevision: 'source-1', targetRevision: 'target-1',
      associationEvidenceRef: 'fixture:provider-check-association' } : {}),
    schedulerAvailable: true, readAvailable: true });
  const workerId = `worker-pr-check-${runId}`;
  const claimed = await claimMonitor(f.store, { runKey: monitor.key, workerId });
  const poll = await beginPoll(f.store, { runKey: monitor.key, workerId,
    claimGeneration: claimed.claimGeneration });
  await observeMonitor(f.store, { runKey: monitor.key, workerId,
    claimGeneration: claimed.claimGeneration,
    pollGeneration: poll.pollGeneration,
    identity, status: 'succeeded', evidenceRef: 'fixture:monitor-result' });
  const observation = linkObservation(runId);
  if (wrongLink) {
    observation.build._links.web.href =
      'https://dev.azure.com/example/project/_build/results?buildId=unrelated';
  }
  await verifyMonitorLink(f.store, { runKey: monitor.key,
    adapterId: 'azure-devops', observation,
    evidenceRef: 'fixture:verified-link' });
  return monitor.key;
}
async function reviewedCoding(f) {
  await coding(f);
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Commit the candidate before PR publication tests');
  const cycle = (await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: 'v1', cause: 'reviewed PR fixture' })).cycle;
  for (const testId of ['T-unit', 'T-integration']) {
    await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id, testId,
      status: 'Passed', expectedMet: true, evidenceRef: `fixture:${testId}`, owner: 'agent', host: 'local' });
  }
  await completeReview(f, cycle);
  return cycle;
}
test('T-32 early PR creation/reuse requires publication authority, does not grant Coding, and uncertain intent prevents duplicates', async t => {
  const f = await fixture(t);
  await f.runGit('commit', '--allow-empty', '-qm', 'Create target baseline');
  const targetRevision = await f.runGit('rev-parse', 'HEAD');
  await f.runGit('branch', 'trunk', targetRevision);
  await f.runGit('update-ref', 'refs/remotes/origin/trunk', targetRevision);
  await f.runGit('add', '.sdlc');
  await f.runGit('commit', '-qm', 'Preserve the fixture documentation for publication');
  const sourceRevision = await f.runGit('rev-parse', 'HEAD');
  const input = { workItemId: f.workItemId, ...prIdentity(), sourceRevision, targetRevision,
    remoteSourceRevision: sourceRevision, matches: [] };
  await assert.rejects(preparePr(f.store, input), { code: 'AUTHORITY' });
  await grant(f, 'pr-publication', { repositoryId: 'primary', sourceRef: input.sourceRef, targetRef: input.targetRef, draft: true });
  const prepared = await preparePr(f.store, input);
  assert.equal(prepared.action, 'prepare-operation');
  assert.equal((await preparePr(f.store, input)).action, 'reconcile-before-create');
  assert.equal(evaluatePolicy(await f.store.load(f.workItemId), {
    class: 'pr-create', repositoryId: 'primary', sourceRef: input.sourceRef,
    targetRef: input.targetRef, draft: true,
  }, { clock: f.clock }).allowed, false);
  assert.equal(evaluatePolicy(await f.store.load(f.workItemId), { class: 'code', repositoryId: 'primary', paths: ['code.mjs'] }).allowed, false);
  const pushCommand = 'git push --no-follow-tags --no-recurse-submodules origin refs/heads/feature/fixture:refs/heads/feature/fixture';
  const push = await grantPush(f, pushCommand);
  await assert.rejects(prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId,
    action: { ...push.action, earlyDraft: true, draft: true, targetRevision,
      baseRef: 'refs/heads/trunk~1', paths: [`.sdlc/work-items/${f.workItemId}.json`] },
    request: { toolName: 'bash', toolArgs: { command: pushCommand }, cwd: f.repo },
    correlationKey: 'invalid-early-base', intent: 'Attempt an expression-based early draft comparison' }), { code: 'INPUT' });
  const earlyPush = await prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId,
    action: { ...push.action, earlyDraft: true, draft: true, targetRevision,
      baseRef: 'refs/heads/trunk',
      paths: [`.sdlc/work-items/${f.workItemId}.json`] },
    request: { toolName: 'bash', toolArgs: { command: pushCommand }, cwd: f.repo },
    correlationKey: 'early-document-push', intent: 'Push the authorized document-only draft source' });
  assert.equal(earlyPush.operation.status, 'prepared');
  const { operation } = await prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId,
    action: { class: 'pr-create', repositoryId: 'primary', sourceRef: input.sourceRef, targetRef: input.targetRef,
      sourceRevision, targetRevision, draft: true, earlyDraft: true, paths: [`.sdlc/work-items/${f.workItemId}.json`] },
    request: { toolName: 'fixture_create_pr', toolArgs: { source: input.sourceRef, target: input.targetRef }, cwd: f.repo },
    correlationKey: 'pr-create-1', intent: 'Create the explicitly requested draft documentation PR' });
  await markDispatching(f.store, f.workItemId, operation.id);
  await recordOperation(f.store, { workItemId: f.workItemId, operationId: operation.id, status: 'uncertain' });
  await assert.rejects(markDispatching(f.store, f.workItemId, operation.id), { code: 'UNCERTAIN' });
  await recordOperation(f.store, { workItemId: f.workItemId, operationId: operation.id, status: 'submitted', handle: 'PR-17' }, { reconcile: true });
  const pr = { ...prIdentity(), sourceRevision, targetRevision, prId: 'PR-17',
    url: 'https://scm.example.invalid/repository/pull/17', state: 'active', evidenceRef: 'fixture:provider-pr' };
  await adoptPr(f.store, { workItemId: f.workItemId, pr, intentId: prepared.intent.id, operationId: operation.id });
  assert.equal((await preparePr(f.store, input)).action, 'reuse');
  assert.equal(evaluatePolicy(await f.store.load(f.workItemId), { class: 'merge', repositoryId: 'primary' }).allowed, false);
});
test('T-33/T-34 current PR policy/check provenance is independent of reviews, merge, artifact and deployment permission', async t => {
  const f = await fixture(t);
  const { pr } = await adoptPr(f.store, { workItemId: f.workItemId, pr: { ...prIdentity(), prId: '17',
    url: 'https://example.invalid/project/pull/17', state: 'active', evidenceRef: 'fixture:pr' } });
  const evaluation = { environment: 'PROD', prRecordId: pr.id, sourceRevision: 'source-1', targetRevision: 'target-1', policyVersion: 'policy-1' };
  const facts = { workItemId: f.workItemId, prRecordId: pr.id, policyVersion: 'policy-1', sourceRevision: 'source-1',
    targetRevision: 'target-1', requiredChecks: ['check-build'], checks: [{ id: 'check-build', status: 'succeeded',
      sourceRevision: 'source-1', targetRevision: 'target-1', evidenceRef: 'fixture:check' }], providerEvidenceRef: 'fixture:policy', reviewsSatisfied: false, merged: false };
  await updatePrFacts(f.store, facts);
  let records = (await f.store.load(f.workItemId)).records;
  assert.equal(evaluateReadiness(records, evaluation, { clock: f.clock }).ready, false);
  const wrongLinkRunKey = await successfulCheckMonitor(f, pr.id, {
    runId: '99',
    wrongLink: true,
  });
  Object.assign(facts.checks[0], {
    runKey: wrongLinkRunKey,
    identity: executionIdentity('99'),
  });
  await updatePrFacts(f.store, facts);
  records = (await f.store.load(f.workItemId)).records;
  assert.equal(evaluateReadiness(records, evaluation, { clock: f.clock }).ready,
    false);
  const unrelatedRunKey = await successfulCheckMonitor(f, pr.id, { runId: '100', includePrContext: false });
  Object.assign(facts.checks[0], {
    runKey: unrelatedRunKey,
    identity: executionIdentity('100'),
  });
  await updatePrFacts(f.store, facts);
  records = (await f.store.load(f.workItemId)).records;
  assert.equal(evaluateReadiness(records, evaluation, { clock: f.clock }).ready, false);
  await attachMonitor(f.store, { identity: executionIdentity('100'),
    origin: 'framework', workItemId: f.workItemId,
    prRecordId: pr.id, checkId: 'check-build', sourceRevision: 'source-1', targetRevision: 'target-1',
    associationEvidenceRef: 'fixture:late-provider-check-association',
    schedulerAvailable: true, readAvailable: true });
  await updatePrFacts(f.store, { ...facts, requiredChecks: ['required-security'], checks: [
    facts.checks[0],
    { ...facts.checks[0], id: 'required-security', evidenceRef: 'fixture:required-security' },
  ] });
  records = (await f.store.load(f.workItemId)).records;
  assert.equal(evaluateReadiness(records, { ...evaluation }, { clock: f.clock }).ready, false);
  await updatePrFacts(f.store, facts);
  records = (await f.store.load(f.workItemId)).records;
  assert.equal(evaluateReadiness(records, evaluation, { clock: f.clock }).ready, true);
  const runKey = unrelatedRunKey;
  const revokedObservation = linkObservation('100');
  revokedObservation.build._links.web.href =
    'https://dev.azure.com/example/project/_build/results?buildId=other';
  await verifyMonitorLink(f.store, {
    runKey,
    adapterId: 'azure-devops',
    observation: revokedObservation,
    evidenceRef: 'fixture:link-revoked',
  });
  records = (await f.store.load(f.workItemId)).records;
  assert.equal(evaluateReadiness(records, evaluation, { clock: f.clock }).ready,
    false);
  await verifyMonitorLink(f.store, {
    runKey,
    adapterId: 'azure-devops',
    observation: linkObservation('100'),
    evidenceRef: 'fixture:link-restored',
  });
  await updatePrFacts(f.store, facts);
  records = (await f.store.load(f.workItemId)).records;
  assert.equal(evaluateReadiness(records, evaluation, { clock: f.clock }).ready, true);
  let releaseWorkLock;
  let workLockStarted;
  const workLockStartedPromise = new Promise(resolve => {
    workLockStarted = resolve;
  });
  const workLockRelease = new Promise(resolve => {
    releaseWorkLock = resolve;
  });
  const heldWorkLock = withLock(path.join(
    f.store.workPath(f.workItemId), '.lock'), async () => {
    workLockStarted();
    await workLockRelease;
  });
  await workLockStartedPromise;
  await assert.rejects(refreshMonitorCapabilities(f.store, {
    runKey,
    schedulerAvailable: false,
    readAvailable: true,
    evidenceRef: 'fixture:blocked-capability-revocation',
  }), { code: 'LOCK_BUSY' });
  releaseWorkLock();
  await heldWorkLock;
  assert.equal((await readMonitor(f.store, runKey))
    .capability.schedulerAvailable, true);
  records = (await f.store.load(f.workItemId)).records;
  assert.equal(evaluateReadiness(records, evaluation, { clock: f.clock }).ready,
    true);
  await assert.rejects(refreshMonitorCapabilities(f.store, {
    runKey,
    schedulerAvailable: false,
    readAvailable: true,
    evidenceRef: 'fixture:authorization:disabled',
  }), { code: 'UNSAFE' });
  assert.equal((await readMonitor(f.store, runKey))
    .capability.schedulerAvailable, true);
  records = (await f.store.load(f.workItemId)).records;
  assert.equal(evaluateReadiness(records, evaluation, { clock: f.clock }).ready,
    true);
  await refreshMonitorCapabilities(f.store, {
    runKey,
    schedulerAvailable: false,
    readAvailable: true,
    evidenceRef: 'fixture:monitor-capability-revoked',
  });
  records = (await f.store.load(f.workItemId)).records;
  assert.equal(evaluateReadiness(records, evaluation, { clock: f.clock }).ready,
    false);
  await refreshMonitorCapabilities(f.store, {
    runKey,
    schedulerAvailable: true,
    readAvailable: true,
    evidenceRef: 'fixture:monitor-capability-restored',
  });
  await updatePrFacts(f.store, facts);
  records = (await f.store.load(f.workItemId)).records;
  assert.equal(evaluateReadiness(records, evaluation, { clock: f.clock }).ready,
    true);
  assert.deepEqual(evaluateReadiness(records, evaluation, { clock: f.clock }).permissions, { publish: false, merge: false, deploy: false });
  assert.equal(evaluateReadiness(records, { ...evaluation, policy: { reviews: true, merge: true }, requireArtifact: true }, { clock: f.clock }).ready, false);
  assert.equal(evaluateReadiness(records, { ...evaluation, targetRevision: 'target-2' }, { clock: f.clock }).ready, false);
  f.clock.advance(60001);
  assert.equal(evaluateReadiness(records, evaluation, { clock: f.clock }).ready, false);
  assert.equal(evaluateReadiness([], { environment: 'DEV' }).verdict, 'not-applicable');
  assert.equal(evaluateReadiness([], { environment: 'PROD', policy: { required: false, validation: false } }).ready, false);
  for (const status of ['failed', 'pending', 'cancelled', 'missing']) {
    await updatePrFacts(f.store, { ...facts, checks: [{ ...facts.checks[0], status }] });
    assert.equal(evaluateReadiness((await f.store.load(f.workItemId)).records, evaluation, { clock: f.clock }).ready, false);
  }
  await updatePrFacts(f.store, { ...facts, checks: [{ id: 'check-build', status: 'succeeded', mergeRevision: 'merge-1',
    evidenceRef: 'fixture:merge-check', runKey,
    identity: executionIdentity('100') }],
    mergeContext: { sourceRevision: 'source-1', targetRevision: 'target-1', mergeRevision: 'merge-1', evidenceRef: 'fixture:provider-proven-merge' } });
  assert.equal(evaluateReadiness((await f.store.load(f.workItemId)).records, evaluation, { clock: f.clock }).ready, true);
  const finalNotice = await monitorNotice(f.store, { runKey });
  await monitorNotice(f.store, {
    runKey,
    deliveredRef: 'fixture:terminal-check-notice',
    noticeGeneration: finalNotice.notice.generation,
  });
  await pruneMonitor(f.store, { runKey });
  await updatePrFacts(f.store, facts);
  assert.equal(evaluateReadiness(
    (await f.store.load(f.workItemId)).records,
    evaluation,
    { clock: f.clock }).ready, false);
  await assert.rejects(refreshMonitorCapabilities(f.store, {
    runKey,
    schedulerAvailable: false,
    readAvailable: false,
    evidenceRef: 'fixture:archived-capability-revocation',
  }), { code: 'MONITOR' });
});
test('T-32 once-scoped PR publication authority cannot publish a second PR operation', async t => {
  const f = await fixture(t);
  await reviewedCoding(f);
  const effect = { repositoryId: 'primary', sourceRef: 'refs/heads/feature/fixture',
    targetRef: 'refs/heads/trunk', draft: true, scope: { actions: ['pr-create'] },
    lifetime: { kind: 'once' } };
  await grant(f, 'pr-publication', effect);
  const action = { class: 'pr-create', repositoryId: 'primary', sourceRef: effect.sourceRef,
    targetRef: effect.targetRef, draft: true };
  const firstRequest = { toolName: 'fixture_create_pr', toolArgs: { attempt: 1 }, cwd: f.repo };
  const first = await prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId,
    action, request: firstRequest, correlationKey: 'once-pr-1', intent: 'Use the once-only PR publication grant' });
  await markDispatching(f.store, f.workItemId, first.operation.id);
  await recordOperation(f.store, { workItemId: f.workItemId, operationId: first.operation.id,
    status: 'succeeded', handle: 'PR-1', target: first.operation.target,
    requestFingerprint: first.operation.requestFingerprint, evidenceRef: 'fixture:first-pr' });
  await assert.rejects(prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId,
    action, request: { toolName: 'fixture_create_pr', toolArgs: { attempt: 2 }, cwd: f.repo },
    correlationKey: 'once-pr-2', intent: 'Attempt a second PR publication' }), { code: 'GATE' });
});
test('T-32 prerequisite push does not consume once-only PR publication authority', async t => {
  const f = await fixture(t);
  await reviewedCoding(f);
  const publication = await grant(f, 'pr-publication', { repositoryId: 'primary',
    sourceRef: 'refs/heads/feature/fixture', targetRef: 'refs/heads/trunk',
    draft: true, lifetime: { kind: 'once' } });
  await grantPush(f);
  await prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId,
    action: await pushAction(f),
    request: { toolName: 'bash', toolArgs: { command: 'git push --no-follow-tags --no-recurse-submodules origin refs/heads/feature/fixture:refs/heads/feature/fixture' }, cwd: f.repo },
    correlationKey: 'prerequisite-push', intent: 'Publish the source branch before creating the PR' });
  assert.ok(!(await f.store.records(f.workItemId)).some(record =>
    record.type === 'reservation' && record.eventId === publication.event.id));
  await prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId,
    action: { class: 'pr-create', repositoryId: 'primary',
      sourceRef: 'refs/heads/feature/fixture', targetRef: 'refs/heads/trunk', draft: true },
    request: { toolName: 'fixture_create_pr', toolArgs: { attempt: 1 }, cwd: f.repo },
    correlationKey: 'once-pr-after-push', intent: 'Create the PR with its unconsumed once-only authority' });
  assert.ok((await f.store.records(f.workItemId)).some(record =>
    record.type === 'reservation' && record.eventId === publication.event.id));
});
test('T-32 once-only PR authority is consumed by an early document push', async t => {
  const f = await fixture(t);
  await f.runGit('commit', '--allow-empty', '-qm', 'Create early push target');
  const targetRevision = await f.runGit('rev-parse', 'HEAD');
  await f.runGit('update-ref', 'refs/remotes/origin/trunk', targetRevision);
  await f.runGit('add', '.sdlc');
  await f.runGit('commit', '-qm', 'Commit early document manifest');
  const publication = await grant(f, 'pr-publication', { repositoryId: 'primary',
    sourceRef: 'refs/heads/feature/fixture', targetRef: 'refs/heads/trunk',
    draft: true, lifetime: { kind: 'once' } });
  const command = 'git push --no-follow-tags --no-recurse-submodules origin refs/heads/feature/fixture:refs/heads/feature/fixture';
  const push = await grantPush(f, command);
  const action = { ...push.action, earlyDraft: true, draft: true,
    baseRef: 'refs/heads/trunk', targetRevision,
    paths: [`.sdlc/work-items/${f.workItemId}.json`] };
  const first = await prepareOperation(f.store, { workItemId: f.workItemId,
    sessionId: f.sessionId, action,
    request: { toolName: 'bash', toolArgs: { command }, cwd: f.repo },
    correlationKey: 'early-push-once-1', intent: 'Use once-only PR authority for the early document push' });
  assert.ok((await f.store.records(f.workItemId)).some(record =>
    record.type === 'reservation' && record.eventId === publication.event.id));
  await markDispatching(f.store, f.workItemId, first.operation.id);
  await recordOperation(f.store, { workItemId: f.workItemId, operationId: first.operation.id,
    status: 'succeeded', target: first.operation.target,
    requestFingerprint: first.operation.requestFingerprint, evidenceRef: 'fixture:early-push' });
  await assert.rejects(prepareOperation(f.store, { workItemId: f.workItemId,
    sessionId: f.sessionId, action,
    request: { toolName: 'bash', toolArgs: { command, attempt: 2 }, cwd: f.repo },
    correlationKey: 'early-push-once-2', intent: 'Attempt to reuse early publication authority' }), { code: 'GATE' });
});
