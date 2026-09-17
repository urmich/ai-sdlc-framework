import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { artifact, fixture, coding, completeReview, grant, grantPush, orient, pushAction, pushPermission, syntheticPushAction, testDefinitions } from './helpers.mjs';
import { startCycle, recordTest, recordArtifact, stagingHandoff } from '../src/validation.mjs';
import { currentCycle } from '../src/authority.mjs';
import { evaluatePolicy } from '../src/policy.mjs';
import { prepareOperation, markDispatching, recordOperation, pruneWork, addConflict, resolveConflict } from '../src/operations.mjs';
import { writeJson } from '../src/files.mjs';
import { evaluateGate as gate } from '../src/gate.mjs';
import { nextAction, resume, acknowledgeContext } from '../src/recovery.mjs';
import { registerArtifact } from '../src/artifacts.mjs';
import { formatAudit, recordAudit } from '../src/audit.mjs';

async function localPass(f) {
  const { cycle } = await startCycle(f.store, { workItemId: f.workItemId, tests: testDefinitions(), configDigest: 'config-v1', cause: 'initial validation' });
  for (const testId of ['T-unit', 'T-integration']) await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id,
    testId, status: 'Passed', expectedMet: true, evidenceRef: `fixture:${testId}`, owner: 'agent', host: 'local' });
  return (await f.store.load(f.workItemId)).records.find(r => r.id === cycle.id);
}
function binding(cycle, extra = {}) { return { cycleId: cycle.id, candidateDigest: cycle.candidateDigest, testSpecDigest: cycle.testSpecDigest, configDigest: cycle.configDigest, ...extra }; }
async function configuration(f) {
  const config = { defaultBranch: 'refs/heads/main', environments: {
    DEV: { target: 'dev-resource', configDigest: 'config-v1', allowedStages: ['DEV'] },
    STAGING: { target: 'staging-resource', configDigest: 'config-v1',
      allowedStages: ['STAGING'],
      execution: { owner: 'user', locations: ['authorized-machine'] } },
  } };
  await writeJson(path.join(f.repo, '.sdlc/config.json'), config);
  return config;
}
test('T-20/T-22 cumulative gates preserve per-session compaction, push and phase boundaries', async t => {
  const f = await coding(await fixture(t));
  await configuration(f);
  const payload = { sessionId: f.sessionId, cwd: f.repo, toolName: 'create', toolArgs: { path: 'source.mjs', file_text: 'export const x = 1;' } };
  assert.equal((await gate(f.store, payload)).permissionDecision, 'deny');
  await orient(f);
  assert.equal((await gate(f.store, payload)).permissionDecision, undefined);
  assert.equal((await gate(f.store, { ...payload, toolName: 'bash', toolArgs: { command: 'git push --no-follow-tags --no-recurse-submodules origin refs/heads/feature/fixture:refs/heads/feature/fixture' } })).permissionDecision, 'deny');
  await f.store.bindSession('session-b', f.workItemId, (await f.store.metadata(f.workItemId)).members[0]);
  await orient(f, 'session-b');
  await f.store.invalidateSession(f.sessionId, 'compaction');
  assert.equal((await gate(f.store, payload)).permissionDecision, 'deny');
  assert.equal((await gate(f.store, { ...payload, sessionId: 'session-b' })).permissionDecision, undefined);
  const resumption = await resume(f.store, { cwd: f.repo, workItemId: f.workItemId, sessionId: f.sessionId });
  await f.store.invalidateSession(f.sessionId, 'second-compaction');
  await assert.rejects(acknowledgeContext(f.store, { cwd: f.repo, workItemId: f.workItemId, sessionId: f.sessionId, token: resumption.orientationToken }), { code: 'STALE' });
});
test('T-24/T-26/T-29 local unit-first reset never authorizes DEV or STAGING automatically', async t => {
  const f = await coding(await fixture(t));
  const config = await configuration(f);
  let cycle = (await startCycle(f.store, { workItemId: f.workItemId, tests: testDefinitions(), configDigest: 'config-v1', cause: 'first' })).cycle;
  await assert.rejects(recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id, testId: 'T-integration', status: 'Passed', expectedMet: true, evidenceRef: 'fixture:integration', owner: 'agent', host: 'local' }), { code: 'UNIT_FIRST' });
  cycle = await localPass(f);
  const action = { class: 'build', repositoryId: 'primary', environment: 'DEV', target: 'dev-resource', configDigest: 'config-v1', stages: ['DEV'], monitorCapability: true };
  let state = await f.store.load(f.workItemId);
  assert.equal(evaluatePolicy(state, action, { configuration: config }).allowed, false);
  await completeReview(f, cycle);
  await grant(f, 'dev-authorization', binding(cycle, { target: 'dev-resource', completedStage: 'review' }));
  state = await f.store.load(f.workItemId);
  assert.equal(evaluatePolicy(state, action, { configuration: config, clock: f.clock }).allowed, true);
  await assert.rejects(grant(f, 'staging-promotion', binding(cycle, { target: 'staging-resource', completedStage: 'DEV' })), { code: 'EVIDENCE' });
  await fs.writeFile(path.join(f.repo, 'fix.mjs'), 'export const fixed = true;');
  const reset = await startCycle(f.store, { workItemId: f.workItemId, tests: testDefinitions(), configDigest: 'config-v1', cause: 'fix after tests' });
  assert.equal(reset.reset, true);
  assert.equal(reset.cycle.step, 'local-testing');
  assert.deepEqual(reset.cycle.results, {});
  assert.equal((await f.store.records(f.workItemId)).filter(r => r.type === 'operation').length, 0);
  cycle = await localPass(f);
  assert.equal(evaluatePolicy(await f.store.load(f.workItemId), action, { configuration: config, clock: f.clock }).allowed, false);
  await assert.rejects(grant(f, 'dev-authorization', binding(reset.cycle, { candidateDigest: 'old', target: 'dev-resource', completedStage: 'review' })), { code: 'STALE' });
});
test('T-18 uncertain dispatch cannot retry/prune; evidenced terminal records retire without audit fields', async t => {
  const f = await coding(await fixture(t));
  await configuration(f);
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Commit candidate before push recovery');
  const request = { toolName: 'bash', toolArgs: { command: 'git push --no-follow-tags --no-recurse-submodules origin refs/heads/feature/fixture:refs/heads/feature/fixture' }, cwd: f.repo };
  await grantPush(f, request.toolArgs.command, { effect: { scope: { repositoryIds: ['primary'] } } });
  const cycle = await localPass(f);
  await completeReview(f, cycle);
  const prepared = await prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId,
    action: await pushAction(f, request.toolArgs.command), request, correlationKey: 'push-1', intent: 'Publish requested branch' });
  const operation = prepared.operation;
  await markDispatching(f.store, f.workItemId, operation.id);
  const uncertain = await recordOperation(f.store, { workItemId: f.workItemId, operationId: operation.id, status: 'submitted' });
  assert.equal(uncertain.status, 'uncertain');
  await assert.rejects(markDispatching(f.store, f.workItemId, operation.id), { code: 'UNCERTAIN' });
  await pruneWork(f.store, f.workItemId);
  assert.ok((await f.store.records(f.workItemId)).some(r => r.id === operation.id));
  await recordOperation(f.store, { workItemId: f.workItemId, operationId: operation.id, status: 'succeeded',
    target: operation.target, requestFingerprint: operation.requestFingerprint, evidenceRef: 'fixture:remote-ref' }, { reconcile: true });
  await pruneWork(f.store, f.workItemId);
  assert.ok(!(await f.store.records(f.workItemId)).some(r => r.id === operation.id));
  assert.ok(await fs.stat(path.join(f.store.workPath(f.workItemId), 'evidence', `${operation.id}.json`)));
});
test('T-31 out-of-scope execution/documentation and scoped conflict overrides remain independent', async t => {
  const f = await coding(await fixture(t));
  const action = { class: 'code', repositoryId: 'primary', paths: ['fix.mjs'], itemId: 'outside', outOfScope: true };
  assert.equal(evaluatePolicy(await f.store.load(f.workItemId), action).allowed, false);
  await grant(f, 'out-of-scope-execution', { itemId: 'outside' });
  assert.equal(evaluatePolicy(await f.store.load(f.workItemId), action).allowed, true);
  const document = { ...action, class: 'document', paths: ['docs/requirements.md'] };
  assert.equal(evaluatePolicy(await f.store.load(f.workItemId), document).allowed, false);
  await grant(f, 'out-of-scope-documentation', { itemId: 'outside' });
  assert.equal(evaluatePolicy(await f.store.load(f.workItemId), document).allowed, true);
  const conflict = await addConflict(f.store, { workItemId: f.workItemId, reason: 'Contradictory command policy', scope: { actions: ['code'] }, references: ['config:command', 'FR-031'] });
  assert.equal(evaluatePolicy(await f.store.load(f.workItemId), action).allowed, false);
  const override = await grant(f, 'override', { rules: [`conflict:${conflict.id}`], reason: 'User selected the framework command for affected code actions', scope: { actions: ['code'] } });
  assert.equal(evaluatePolicy(await f.store.load(f.workItemId), action).allowed, true);
  assert.equal(evaluatePolicy(await f.store.load(f.workItemId), { ...action, class: 'push' }).allowed, false);
  assert.equal(evaluatePolicy(await f.store.load(f.workItemId), { ...action, externalPermission: false }).allowed, false);
  await resolveConflict(f.store, { workItemId: f.workItemId, conflictId: conflict.id, eventId: override.event.id });
  await pruneWork(f.store, f.workItemId);
  assert.ok(!(await f.store.records(f.workItemId)).some(r => r.id === conflict.id));
});
test('T-17 once-only permission reservation respects the authorized target', async t => {
  const f = await coding(await fixture(t));
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Commit target-specific push candidate');
  const cycle = await localPass(f);
  await completeReview(f, cycle);
  const sourceRevision = await f.runGit('rev-parse', 'HEAD');
  const actionA = { ...syntheticPushAction('origin-a'), sourceRevision };
  const actionB = { ...syntheticPushAction('origin-b'), sourceRevision };
  const once = await grant(f, 'permission', { ...pushPermission(actionA), lifetime: { kind: 'once' } });
  await grant(f, 'permission', pushPermission(actionB));
  await prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId,
    action: actionB,
    request: { toolName: 'fixture_push', toolArgs: { remote: 'origin-b' }, cwd: f.repo },
    correlationKey: 'push-origin-b', intent: 'Push to the independently authorized second target' });
  assert.ok(!(await f.store.records(f.workItemId)).some(record =>
    record.type === 'reservation' && record.eventId === once.event.id));
  await prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId,
    action: actionA,
    request: { toolName: 'fixture_push', toolArgs: { remote: 'origin-a' }, cwd: f.repo },
    correlationKey: 'push-origin-a', intent: 'Consume the once-only permission on its matching target' });
  assert.ok((await f.store.records(f.workItemId)).some(record =>
    record.type === 'reservation' && record.eventId === once.event.id));
});
test('T-31 once-only out-of-scope documentation and execution authority remain distinct', async t => {
  const f = await fixture(t);
  const relative = await artifact(f, 'requirements', '# Requirements\n');
  await registerArtifact(f.store, { workItemId: f.workItemId, role: 'requirements',
    repositoryId: 'primary', path: relative });
  const execution = await grant(f, 'out-of-scope-execution', {
    itemId: 'outside-item', lifetime: { kind: 'once' } });
  const documentation = await grant(f, 'out-of-scope-documentation', {
    itemId: 'outside-item', lifetime: { kind: 'once' } });
  const action = { class: 'document', repositoryId: 'primary', paths: [relative],
    outOfScope: true, itemId: 'outside-item' };
  const first = await prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId,
    action, request: { toolName: 'fixture_document', toolArgs: { attempt: 1 }, cwd: f.repo },
    correlationKey: 'outside-doc-1', intent: 'Document the explicitly authorized out-of-scope item' });
  const reservations = (await f.store.records(f.workItemId)).filter(record => record.type === 'reservation');
  assert.ok(reservations.some(record => record.eventId === documentation.event.id));
  assert.ok(!reservations.some(record => record.eventId === execution.event.id));
  await markDispatching(f.store, f.workItemId, first.operation.id);
  await recordOperation(f.store, { workItemId: f.workItemId, operationId: first.operation.id,
    status: 'succeeded', target: first.operation.target,
    requestFingerprint: first.operation.requestFingerprint, evidenceRef: 'fixture:documented-outside-item' });
  await assert.rejects(prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId,
    action, request: { toolName: 'fixture_document', toolArgs: { attempt: 2 }, cwd: f.repo },
    correlationKey: 'outside-doc-2', intent: 'Attempt to reuse once-only documentation authority' }), { code: 'GATE' });
});
test('T-12/T-20 scoped unit-first override permits truthful integration evidence', async t => {
  const f = await coding(await fixture(t));
  const cycle = (await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: 'v1', cause: 'unit-first deviation' })).cycle;
  await grant(f, 'override', { rules: ['unit-first'], reason: 'User accepts running this integration check before units',
    scope: { actions: ['test'], environment: 'local' } });
  const evidence = await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id,
    testId: 'T-integration', status: 'Passed', expectedMet: true,
    evidenceRef: 'fixture:authorized-integration', owner: 'agent', host: 'local' });
  assert.equal(evidence.status, 'Passed');
  const state = await f.store.load(f.workItemId);
  assert.equal(state.records.find(record => record.id === cycle.results['T-unit']), undefined);
});
test('T-12/T-20 once-only unit-first override remains usable at evidence recording', async t => {
  const f = await coding(await fixture(t));
  const cycle = (await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: 'v1', cause: 'once-only unit-first deviation' })).cycle;
  await grant(f, 'override', { rules: ['unit-first'],
    reason: 'User authorizes one integration execution before units',
    scope: { actions: ['test'], environment: 'local' }, lifetime: { kind: 'once' } });
  const action = { class: 'test', repositoryId: 'primary', environment: 'local',
    testId: 'T-integration', owner: 'agent', host: 'local' };
  const prepared = await prepareOperation(f.store, { workItemId: f.workItemId,
    sessionId: f.sessionId, action,
    request: { toolName: 'fixture_test', toolArgs: { testId: 'T-integration' }, cwd: f.repo },
    correlationKey: 'once-integration', intent: 'Run the once-authorized integration test' });
  await markDispatching(f.store, f.workItemId, prepared.operation.id);
  await recordOperation(f.store, { workItemId: f.workItemId, operationId: prepared.operation.id,
    status: 'failed', target: prepared.operation.target,
    requestFingerprint: prepared.operation.requestFingerprint,
    evidenceRef: 'fixture:failed-test-operation', providerStatus: 'failed', expectedMet: false });
  await pruneWork(f.store, f.workItemId);
  assert.ok((await f.store.records(f.workItemId)).some(record =>
    record.id === prepared.operation.id));
  const evidence = await recordTest(f.store, { workItemId: f.workItemId,
    cycleId: cycle.id, testId: 'T-integration', operationId: prepared.operation.id,
    status: 'Failed', expectedMet: false, evidenceRef: 'fixture:once-integration',
    owner: 'agent', host: 'local' });
  assert.equal(evidence.operationId, prepared.operation.id);
  await assert.rejects(recordTest(f.store, { workItemId: f.workItemId,
    cycleId: cycle.id, testId: 'T-integration', operationId: '../fabricated-operation',
    status: 'Passed', expectedMet: true, evidenceRef: 'fixture:traversal-operation',
    owner: 'agent', host: 'local' }), { code: 'INPUT' });
  await writeJson(path.join(f.store.workPath(f.workItemId), 'evidence', 'fabricated-operation.json'),
    { ...prepared.operation, id: 'different-operation' });
  await assert.rejects(recordTest(f.store, { workItemId: f.workItemId,
    cycleId: cycle.id, testId: 'T-integration', operationId: 'fabricated-operation',
    status: 'Passed', expectedMet: true, evidenceRef: 'fixture:mismatched-operation',
    owner: 'agent', host: 'local' }), { code: 'OPERATION' });
  await fs.writeFile(path.join(f.repo, 'new-cycle.mjs'), 'export const next = true;\n');
  const next = await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: 'v1', cause: 'new cycle after once-only execution' });
  await assert.rejects(recordTest(f.store, { workItemId: f.workItemId,
    cycleId: next.cycle.id, testId: 'T-integration', operationId: prepared.operation.id,
    status: 'Failed', expectedMet: false, evidenceRef: 'fixture:historical-operation',
    owner: 'agent', host: 'local' }), { code: 'OPERATION' });
});
test('T-12/T-20 test evidence preserves a secondary repository override scope', async t => {
  const f = await coding(await fixture(t));
  const secondary = await fixture(t, { initialize: false });
  await f.store.bindMember({ workItemId: f.workItemId, repositoryId: 'secondary',
    cwd: secondary.repo, sessionId: 'secondary-session' });
  const cycle = (await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: 'v1', cause: 'secondary repository test' })).cycle;
  await grant(f, 'override', { rules: ['unit-first'],
    reason: 'User authorizes one secondary integration execution before units',
    scope: { repositoryIds: ['secondary'], actions: ['test'], environment: 'local' },
    lifetime: { kind: 'once' } });
  const action = { class: 'test', repositoryId: 'secondary', environment: 'local',
    testId: 'T-integration', owner: 'agent', host: 'local' };
  const prepared = await prepareOperation(f.store, { workItemId: f.workItemId,
    sessionId: 'secondary-session', action,
    request: { toolName: 'fixture_test', toolArgs: { testId: 'T-integration' }, cwd: secondary.repo },
    correlationKey: 'secondary-integration', intent: 'Run the secondary repository integration test' });
  await markDispatching(f.store, f.workItemId, prepared.operation.id);
  await recordOperation(f.store, { workItemId: f.workItemId, operationId: prepared.operation.id,
    status: 'succeeded', target: prepared.operation.target,
    requestFingerprint: prepared.operation.requestFingerprint,
    evidenceRef: 'fixture:secondary-test-operation', expectedMet: true });
  const evidence = await recordTest(f.store, { workItemId: f.workItemId,
    cycleId: cycle.id, testId: 'T-integration', operationId: prepared.operation.id,
    status: 'Passed', expectedMet: true, evidenceRef: 'fixture:secondary-integration',
    owner: 'agent', host: 'local' });
  assert.equal(evidence.operationId, prepared.operation.id);
});
test('T-18 superseded current-cycle evidence is pruned from the active working set', async t => {
  const f = await coding(await fixture(t));
  const cycle = (await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: 'v1', cause: 'evidence retention' })).cycle;
  for (let index = 0; index < 30; index++) {
    await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id,
      testId: 'T-unit', status: 'Passed', expectedMet: true,
      evidenceRef: `fixture:unit-${index}`, owner: 'agent', host: 'local' });
  }
  assert.equal((await f.store.records(f.workItemId)).filter(record =>
    record.type === 'test-evidence' && record.testId === 'T-unit').length, 30);
  const recoveryToken = await f.store.beginRecovery(f.workItemId);
  const pruneGate = await gate(f.store, { cwd: f.repo, sessionId: f.sessionId,
    toolName: 'bash', toolArgs: { command: `${process.execPath} ${path.resolve('bin/sdlc.mjs')} prune --work-item ${f.workItemId}` } });
  assert.equal(pruneGate.permissionDecision, undefined, JSON.stringify(pruneGate));
  await pruneWork(f.store, f.workItemId);
  assert.equal((await f.store.load(f.workItemId)).recoveryRequired, true);
  await f.store.completeRecovery(f.workItemId, recoveryToken);
  assert.equal((await f.store.records(f.workItemId)).filter(record =>
    record.type === 'test-evidence' && record.testId === 'T-unit').length, 1);
});
test('T-08/T-13 next action supports local-only, paused and completed work', async t => {
  const f = await coding(await fixture(t));
  const plan = path.join(f.repo, 'docs/test-plan.md');
  await fs.writeFile(plan, '# Plan\n' +
    '| ID | Requirements | Conditions | Environment | Level | Checkpoint | Mode | Owner | Location | Expected outcome | Implementation | Status |\n' +
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n' +
    '| T-unit | FR-001 | AC-001.1 | local | unit | pre-review | automated | agent | local | Unit passes | test/unit.mjs | NotRun |\n' +
    '| T-followup | FR-001 | AC-001.1 | local | workflow | post-review | automated | agent | local | Follow-up passes | test/followup.mjs | NotRun |\n');
  const cycle = (await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: 'v1', cause: 'local-only work' })).cycle;
  await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id, testId: 'T-unit',
    status: 'Passed', expectedMet: true, evidenceRef: 'fixture:unit', owner: 'agent', host: 'local' });
  await completeReview(f, cycle);
  assert.match(nextAction(await f.store.load(f.workItemId), f.clock), /Run remaining required later-checkpoint tests: T-followup/u);
  await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id, testId: 'T-followup',
    status: 'Failed', expectedMet: false, evidenceRef: 'fixture:followup-failed', owner: 'agent', host: 'local' });
  assert.match(nextAction(await f.store.load(f.workItemId), f.clock), /Diagnose failed required later-checkpoint tests: T-followup/u);
  await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id, testId: 'T-followup',
    status: 'Passed', expectedMet: true, evidenceRef: 'fixture:followup-passed', owner: 'agent', host: 'local' });
  assert.match(nextAction(await f.store.load(f.workItemId), f.clock), /local-only work is complete/u);
  await grant(f, 'work-completion', { lifecycleStatus: 'paused' });
  assert.match(nextAction(await f.store.load(f.workItemId), f.clock), /Work is paused/u);
  await grant(f, 'work-completion', { lifecycleStatus: 'completed' });
  assert.match(nextAction(await f.store.load(f.workItemId), f.clock), /Work is completed/u);
});
test('T-13 STAGING-only Test Plan is not misreported as local-only completion', async t => {
  const f = await coding(await fixture(t));
  const plan = path.join(f.repo, 'docs/test-plan.md');
  await fs.writeFile(plan, '# Plan\n' +
    '| ID | Requirements | Conditions | Environment | Level | Checkpoint | Mode | Owner | Location | Expected outcome | Implementation | Status |\n' +
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n' +
    '| T-unit | FR-001 | AC-001.1 | local | unit | pre-review | automated | agent | local | Unit passes | test/unit.mjs | NotRun |\n' +
    '| T-staging | FR-001 | AC-001.1 | STAGING | integration | STAGING | automated | user | authorized-machine | STAGING passes | test/staging.mjs | NotRun |\n');
  const cycle = (await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: 'v1', cause: 'invalid STAGING-only plan' })).cycle;
  await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id, testId: 'T-unit',
    status: 'Passed', expectedMet: true, evidenceRef: 'fixture:unit', owner: 'agent', host: 'local' });
  await completeReview(f, cycle);
  assert.match(nextAction(await f.store.load(f.workItemId), f.clock),
    /STAGING validation requires a DEV checkpoint/u);
});
test('T-06/T-13 STAGING-only guidance combines wildcard targets with secondary repositories', async t => {
  const f = await coding(await fixture(t));
  const secondary = await fixture(t, { initialize: false });
  await f.store.bindMember({ workItemId: f.workItemId, repositoryId: 'secondary',
    cwd: secondary.repo, sessionId: 'secondary-session' });
  await writeJson(path.join(f.repo, '.sdlc/config.json'), { defaultBranch: 'refs/heads/main',
    environments: { STAGING: { target: 'staging-target',
      configDigest: 'v1', allowedStages: ['STAGING'],
      execution: { owner: 'user', locations: ['authorized-machine'] } } } });
  await fs.writeFile(path.join(f.repo, 'docs/test-plan.md'), '# Plan\n' +
    '| ID | Requirements | Conditions | Environment | Level | Checkpoint | Mode | Owner | Location | Expected outcome | Implementation | Status |\n' +
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n' +
    '| T-unit | FR-001 | AC-001.1 | local | unit | pre-review | automated | agent | local | Unit passes | test/unit.mjs | NotRun |\n' +
    '| T-staging | FR-001 | AC-001.1 | STAGING | integration | STAGING | automated | user | authorized-machine | STAGING passes | test/staging.mjs | NotRun |\n');
  const cycle = (await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: 'v1', cause: 'cross-scoped STAGING-only plan' })).cycle;
  await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id, testId: 'T-unit',
    status: 'Passed', expectedMet: true, evidenceRef: 'fixture:unit', owner: 'agent', host: 'local' });
  await completeReview(f, cycle);
  await grant(f, 'override', { rules: ['dev-validation'],
    reason: 'Authorize STAGING-only validation from the secondary repository',
    scope: { repositoryIds: ['secondary'], actions: ['staging-promotion'], environment: 'STAGING' } });
  await grant(f, 'override', { rules: ['dev-completion'],
    reason: 'Authorize target-bound STAGING progression across repositories',
    scope: { actions: ['staging-promotion'], environment: 'STAGING', target: 'staging-target' } });
  assert.match(nextAction(await f.store.load(f.workItemId), f.clock),
    /Recommend STAGING and await explicit promotion consent/u);
  const binding = { cycleId: cycle.id, candidateDigest: cycle.candidateDigest,
    testSpecDigest: cycle.testSpecDigest, configDigest: cycle.configDigest };
  const promotion = await grant(f, 'staging-promotion', { ...binding, target: 'staging-target',
    completedStage: 'DEV', deploymentId: 'overridden-dev',
    scope: { repositoryIds: ['secondary'], actions: ['build'], environment: 'STAGING' },
    lifetime: { kind: 'until', expiresAt: new Date(f.clock.now() + 1000).toISOString() } });
  await grant(f, 'override', { rules: ['dev-validation', 'dev-completion'],
    reason: 'Authorize execution for every participating repository',
    scope: { actions: ['build'], environment: 'STAGING' } });
  assert.match(nextAction(await f.store.load(f.workItemId), f.clock),
    /Prepare the concrete STAGING build\/deployment/u);
  const pipelineState = structuredClone(await f.store.load(f.workItemId));
  pipelineState.records.push({ type: 'operation', id: 'op-implicit-staging', cycleId: cycle.id,
    class: 'pipeline', status: 'running', action: { class: 'pipeline', stages: ['STAGING'] } });
  assert.match(nextAction(pipelineState, f.clock),
    /Monitor or reconcile the current STAGING operation/u);
  const revokedPipelineState = structuredClone(pipelineState);
  revokedPipelineState.records.push({ type: 'event', id: 'event-revoke-pipeline-promotion',
    kind: 'revocation', effect: { revokes: [promotion.event.id] } });
  assert.match(nextAction(revokedPipelineState, f.clock),
    /Monitor or reconcile the current STAGING operation/u);
  f.clock.advance(2000);
  assert.match(nextAction(pipelineState, f.clock),
    /Monitor or reconcile the current STAGING operation/u);
});
test('T-06/T-13 explicit DEV prerequisite overrides allow STAGING-only progression', async t => {
  const f = await coding(await fixture(t));
  await writeJson(path.join(f.repo, '.sdlc/config.json'), { defaultBranch: 'refs/heads/main',
    environments: { STAGING: { target: 'staging-target',
      configDigest: 'v1', allowedStages: ['STAGING'],
      execution: { owner: 'user', locations: ['authorized-machine'] } } } });
  const plan = path.join(f.repo, 'docs/test-plan.md');
  await fs.writeFile(plan, '# Plan\n' +
    '| ID | Requirements | Conditions | Environment | Level | Checkpoint | Mode | Owner | Location | Expected outcome | Implementation | Status |\n' +
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n' +
    '| T-unit | FR-001 | AC-001.1 | local | unit | pre-review | automated | agent | local | Unit passes | test/unit.mjs | NotRun |\n' +
    '| T-staging | FR-001 | AC-001.1 | STAGING | integration | STAGING | automated | user | authorized-machine | STAGING passes | test/staging.mjs | NotRun |\n');
  const cycle = (await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: 'v1', cause: 'overridden STAGING-only plan' })).cycle;
  await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id, testId: 'T-unit',
    status: 'Passed', expectedMet: true, evidenceRef: 'fixture:unit', owner: 'agent', host: 'local' });
  await completeReview(f, cycle);
  const binding = { cycleId: cycle.id, candidateDigest: cycle.candidateDigest,
    testSpecDigest: cycle.testSpecDigest, configDigest: cycle.configDigest };
  await grant(f, 'override', { rules: ['dev-validation', 'dev-completion'],
    reason: 'Unrelated DEV override must not affect STAGING scope discovery',
    scope: { environment: 'DEV', target: 'unrelated-dev' } });
  await grant(f, 'override', { rules: ['dev-validation'],
    reason: 'User explicitly authorizes this STAGING-only validation workflow',
    scope: { repositoryIds: ['alpha', 'primary'],
      actions: ['staging-promotion', 'deploy'], environment: 'STAGING' } });
  await assert.rejects(grant(f, 'staging-promotion', { ...binding, target: 'staging-target',
    completedStage: 'DEV' }), { code: 'EVIDENCE' });
  const completionOverride = await grant(f, 'override', { rules: ['dev-completion'],
    reason: 'User explicitly authorizes STAGING progression without DEV completion',
    scope: { repositoryIds: ['beta', 'primary'],
      actions: ['staging-promotion', 'deploy'], environment: 'STAGING', target: 'staging-target' } });
  assert.match(nextAction(await f.store.load(f.workItemId), f.clock),
    /Recommend STAGING and await explicit promotion consent/u);
  await grant(f, 'override', { rules: ['dev-validation', 'dev-completion'],
    reason: 'Authorize only an older promotion target, not its execution',
    scope: { repositoryIds: ['primary'],
      actions: ['staging-promotion'], environment: 'STAGING', target: 'old-staging-target' } });
  await grant(f, 'staging-promotion', { ...binding, target: 'old-staging-target',
    completedStage: 'DEV', deploymentId: 'old-overridden-dev' });
  assert.match(nextAction(await f.store.load(f.workItemId), f.clock),
    /Prepare the concrete STAGING build\/deployment/u);
  const promotion = await grant(f, 'staging-promotion', { ...binding, target: 'staging-target',
    completedStage: 'DEV', deploymentId: 'overridden-dev',
    lifetime: { kind: 'once' } });
  assert.match(nextAction(await f.store.load(f.workItemId), f.clock),
    /Prepare the concrete STAGING build\/deployment/u);
  await recordArtifact(f.store, { workItemId: f.workItemId, cycleId: cycle.id,
    artifactId: 'staging-artifact', environment: 'STAGING', sourceDigest: cycle.candidateDigest,
    configDigest: cycle.configDigest, buildRunId: 'staging-build', name: 'package',
    artifactType: 'archive', evidenceRef: 'fixture:staging-artifact', status: 'succeeded' });
  const action = { class: 'deploy', repositoryId: 'primary', environment: 'STAGING',
    target: 'staging-target', configDigest: 'v1', stages: ['STAGING'],
    artifactId: 'staging-artifact', monitorCapability: true };
  await grant(f, 'revocation', { revokes: [completionOverride.event.id] });
  assert.match(nextAction(await f.store.load(f.workItemId), f.clock),
    /Prepare the concrete STAGING build\/deployment/u);
  await grant(f, 'override', { rules: ['dev-completion'],
    reason: 'Another target cannot reauthorize the surviving STAGING promotion',
    scope: { repositoryIds: ['primary'],
      actions: ['deploy'], environment: 'STAGING', target: 'other-staging-target' } });
  assert.match(nextAction(await f.store.load(f.workItemId), f.clock),
    /Prepare the concrete STAGING build\/deployment/u);
  await grant(f, 'override', { rules: ['dev-completion'],
    reason: 'Promotion-only scope cannot authorize the later deployment',
    scope: { repositoryIds: ['primary'],
      actions: ['staging-promotion'], environment: 'STAGING', target: 'staging-target' } });
  assert.match(nextAction(await f.store.load(f.workItemId), f.clock),
    /Prepare the concrete STAGING build\/deployment/u);
  await assert.rejects(prepareOperation(f.store, { workItemId: f.workItemId,
    sessionId: f.sessionId, action,
    request: { toolName: 'fixture_deploy', toolArgs: { environment: 'STAGING', attempt: 0 }, cwd: f.repo },
    correlationKey: 'blocked-overridden-staging', intent: 'Reject mismatched STAGING prerequisite authority' }),
  { code: 'GATE' });
  await grant(f, 'override', { rules: ['dev-completion'],
    reason: 'Reauthorize STAGING progression before starting new remote work',
    scope: { repositoryIds: ['primary'],
      actions: ['deploy'], environment: 'STAGING', target: 'staging-target' },
    lifetime: { kind: 'once' } });
  assert.match(nextAction(await f.store.load(f.workItemId), f.clock),
    /Prepare the concrete STAGING build\/deployment/u);
  const deployment = await prepareOperation(f.store, { workItemId: f.workItemId,
    sessionId: f.sessionId, action,
    request: { toolName: 'fixture_deploy', toolArgs: { environment: 'STAGING' }, cwd: f.repo },
    correlationKey: 'overridden-staging', intent: 'Deploy under explicit DEV prerequisite overrides' });
  await markDispatching(f.store, f.workItemId, deployment.operation.id);
  await recordOperation(f.store, { workItemId: f.workItemId, operationId: deployment.operation.id,
    status: 'succeeded', handle: 'staging-run', target: deployment.operation.target,
    requestFingerprint: deployment.operation.requestFingerprint, evidenceRef: 'fixture:staging-deploy' });
  await grant(f, 'revocation', { revokes: [promotion.event.id] });
  assert.match(nextAction(await f.store.load(f.workItemId), f.clock),
    /Run handoff staging to resolve/u);
  const replacementState = structuredClone(await f.store.load(f.workItemId));
  replacementState.records.push({ type: 'operation', id: 'op-staging-replacement',
    cycleId: cycle.id, class: 'pipeline', status: 'running',
    action: { class: 'pipeline', implicitEnvironments: ['STAGING'] } });
  assert.match(nextAction(replacementState, f.clock),
    /Monitor or reconcile the current STAGING operation/u);
  replacementState.records.find(record => record.id ===
    currentCycle(replacementState.records, replacementState.checkpoint).deployments.STAGING).status = 'failed';
  assert.match(nextAction(replacementState, f.clock),
    /Monitor or reconcile the current STAGING operation/u);
  const result = await grant(f, 'staging-result', { ...binding, target: 'staging-target',
    deploymentId: deployment.operation.id, artifactId: 'staging-artifact',
    testIds: ['T-staging'], outcome: 'Passed', owner: 'user',
    host: 'authorized-machine', evidenceRef: 'fixture:staging-result' });
  await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id, testId: 'T-staging',
    status: 'Passed', artifactId: 'staging-artifact',
    deploymentId: deployment.operation.id, expectedMet: true, owner: 'user',
    host: 'authorized-machine', evidenceRef: 'fixture:staging-result', eventId: result.event.id });
  assert.match(nextAction(await f.store.load(f.workItemId), f.clock),
    /capture explicit current-deployment STAGING completion/u);
  await grant(f, 'stage-completion', { ...binding,
    completedStage: 'STAGING', deploymentId: deployment.operation.id,
    target: 'staging-target' });
  assert.match(nextAction(await f.store.load(f.workItemId), f.clock),
    /Evaluate current PROD PR readiness/u);
  const failedState = structuredClone(await f.store.load(f.workItemId));
  failedState.records.find(record => record.id ===
    currentCycle(failedState.records, failedState.checkpoint).deployments.STAGING).status = 'failed';
  assert.match(nextAction(failedState, f.clock), /STAGING deployment is failed/u);
});
test('T-13 legacy cycles without checkpoint fields retain DEV/STAGING progression', async t => {
  const f = await coding(await fixture(t));
  const cycle = await localPass(f);
  await completeReview(f, cycle);
  const state = structuredClone(await f.store.load(f.workItemId));
  const current = currentCycle(state.records, state.checkpoint);
  for (const test of current.tests) delete test.checkpoint;
  assert.match(nextAction(state, f.clock), /Await DEV authorization/u);
});
test('T-13 recovery guidance bounds large later-checkpoint lists', async t => {
  const f = await coding(await fixture(t));
  const plan = path.join(f.repo, 'docs/test-plan.md');
  const rows = Array.from({ length: 41 }, (_, index) =>
    `| T-followup-${index} | FR-001 | AC-001.1 | local | workflow | post-review | automated | agent | local | Follow-up ${index} passes | test/followup-${index}.mjs | NotRun |`).join('\n');
  await fs.writeFile(plan, '# Plan\n' +
    '| ID | Requirements | Conditions | Environment | Level | Checkpoint | Mode | Owner | Location | Expected outcome | Implementation | Status |\n' +
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n' +
    '| T-unit | FR-001 | AC-001.1 | local | unit | pre-review | automated | agent | local | Unit passes | test/unit.mjs | NotRun |\n' +
    `${rows}\n`);
  const cycle = (await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: 'v1', cause: 'large later-checkpoint list' })).cycle;
  await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id,
    testId: 'T-unit', status: 'Passed', expectedMet: true,
    evidenceRef: 'fixture:unit', owner: 'agent', host: 'local' });
  await completeReview(f, cycle);
  const action = nextAction(await f.store.load(f.workItemId), f.clock);
  assert.ok(action.length < 500);
  assert.match(action, /\+36 more; use sdlc status for details/u);
});
test('T-17 once-only PROD authority is reserved for implicit pipeline stages', async t => {
  const f = await coding(await fixture(t));
  await writeJson(path.join(f.repo, '.sdlc/config.json'), { defaultBranch: 'refs/heads/main',
    environments: { PROD: { target: 'prod-target', configDigest: 'config-v1', allowedStages: ['PROD'] } } });
  const cycle = await localPass(f);
  await completeReview(f, cycle);
  await grant(f, 'override', {
    rules: ['pr-readiness', 'pr-candidate-provenance'],
    reason: 'Fixture isolates once-only PROD execution reservation',
    scope: {
      repositoryIds: ['primary'],
      actions: ['pipeline'],
      environment: 'PROD',
      target: 'prod-target',
    },
  });
  const authority = await grant(f, 'permission', { grant: 'prod-execution',
    target: 'prod-target', lifetime: { kind: 'once' } });
  const action = { class: 'pipeline', repositoryId: 'primary', target: 'prod-target',
    configDigest: 'config-v1', stages: ['PROD'], monitorCapability: true };
  const first = await prepareOperation(f.store, { workItemId: f.workItemId,
    sessionId: f.sessionId, action,
    request: { toolName: 'fixture_pipeline', toolArgs: { attempt: 1 }, cwd: f.repo },
    correlationKey: 'prod-pipeline-1', intent: 'Run the once-authorized PROD stage' });
  assert.ok((await f.store.records(f.workItemId)).some(record =>
    record.type === 'reservation' && record.eventId === authority.event.id));
  await markDispatching(f.store, f.workItemId, first.operation.id);
  await recordOperation(f.store, { workItemId: f.workItemId, operationId: first.operation.id,
    status: 'succeeded', handle: 'prod-run-1', target: first.operation.target,
    requestFingerprint: first.operation.requestFingerprint, evidenceRef: 'fixture:prod-run' });
  await assert.rejects(prepareOperation(f.store, { workItemId: f.workItemId,
    sessionId: f.sessionId, action,
    request: { toolName: 'fixture_pipeline', toolArgs: { attempt: 2 }, cwd: f.repo },
    correlationKey: 'prod-pipeline-2', intent: 'Attempt to reuse PROD authority' }), { code: 'GATE' });
});
test('T-17 once-only DEV/STAGING authority is reserved for implicit pipeline stages', async t => {
  const f = await coding(await fixture(t));
  await writeJson(path.join(f.repo, '.sdlc/config.json'), { defaultBranch: 'refs/heads/main',
    environments: {
      DEV: { target: 'dev-target', configDigest: 'config-v1', allowedStages: ['DEV'] },
      STAGING: { target: 'staging-target', configDigest: 'config-v1',
        allowedStages: ['STAGING'],
        execution: { owner: 'user', locations: ['authorized-machine'] } },
    } });
  const cycle = await localPass(f);
  await completeReview(f, cycle);
  const binding = { cycleId: cycle.id, candidateDigest: cycle.candidateDigest,
    testSpecDigest: cycle.testSpecDigest, configDigest: cycle.configDigest };
  const dev = await grant(f, 'dev-authorization', { ...binding, target: 'dev-target',
    completedStage: 'review', lifetime: { kind: 'once' } });
  const devAction = { class: 'pipeline', repositoryId: 'primary', target: 'dev-target',
    configDigest: 'config-v1', stages: ['DEV'], monitorCapability: true };
  const firstDev = await prepareOperation(f.store, { workItemId: f.workItemId,
    sessionId: f.sessionId, action: devAction,
    request: { toolName: 'fixture_pipeline', toolArgs: { environment: 'DEV', attempt: 1 }, cwd: f.repo },
    correlationKey: 'implicit-dev-1', intent: 'Run once-authorized implicit DEV stage' });
  assert.ok((await f.store.records(f.workItemId)).some(record =>
    record.type === 'reservation' && record.eventId === dev.event.id));
  await markDispatching(f.store, f.workItemId, firstDev.operation.id);
  let pipelineState = await f.store.load(f.workItemId);
  assert.deepEqual(currentCycle(pipelineState.records, pipelineState.checkpoint)
    .invalidatedEnvironments, ['DEV', 'STAGING']);
  await recordOperation(f.store, { workItemId: f.workItemId, operationId: firstDev.operation.id,
    status: 'succeeded', handle: 'dev-run-1', target: firstDev.operation.target,
    requestFingerprint: firstDev.operation.requestFingerprint, evidenceRef: 'fixture:dev-run' });
  pipelineState = await f.store.load(f.workItemId);
  assert.deepEqual(currentCycle(pipelineState.records, pipelineState.checkpoint)
    .invalidatedEnvironments, ['DEV', 'STAGING']);
  await assert.rejects(prepareOperation(f.store, { workItemId: f.workItemId,
    sessionId: f.sessionId, action: devAction,
    request: { toolName: 'fixture_pipeline', toolArgs: { environment: 'DEV', attempt: 2 }, cwd: f.repo },
    correlationKey: 'implicit-dev-2', intent: 'Attempt to reuse DEV consent' }), { code: 'GATE' });

  await grant(f, 'override', { rules: ['dev-validation', 'dev-completion'],
    reason: 'Fixture isolates STAGING once-only reservation behavior' });
  const staging = await grant(f, 'staging-promotion', { ...binding, target: 'staging-target',
    completedStage: 'DEV', deploymentId: 'fixture-dev-deployment',
    lifetime: { kind: 'once' } });
  const stagingAction = { class: 'pipeline', repositoryId: 'primary', target: 'staging-target',
    configDigest: 'config-v1', stages: ['STAGING'], monitorCapability: true };
  const firstStaging = await prepareOperation(f.store, { workItemId: f.workItemId,
    sessionId: f.sessionId, action: stagingAction,
    request: { toolName: 'fixture_pipeline', toolArgs: { environment: 'STAGING', attempt: 1 }, cwd: f.repo },
    correlationKey: 'implicit-staging-1', intent: 'Run once-authorized implicit STAGING stage' });
  assert.ok((await f.store.records(f.workItemId)).some(record =>
    record.type === 'reservation' && record.eventId === staging.event.id));
  await markDispatching(f.store, f.workItemId, firstStaging.operation.id);
  await recordOperation(f.store, { workItemId: f.workItemId, operationId: firstStaging.operation.id,
    status: 'succeeded', handle: 'staging-run-1', target: firstStaging.operation.target,
    requestFingerprint: firstStaging.operation.requestFingerprint, evidenceRef: 'fixture:staging-run' });
  await assert.rejects(prepareOperation(f.store, { workItemId: f.workItemId,
    sessionId: f.sessionId, action: stagingAction,
    request: { toolName: 'fixture_pipeline', toolArgs: { environment: 'STAGING', attempt: 2 }, cwd: f.repo },
    correlationKey: 'implicit-staging-2', intent: 'Attempt to reuse STAGING consent' }), { code: 'GATE' });
  const audit = await formatAudit(f.store, f.workItemId);
  await f.runGit('add', '.sdlc');
  await f.runGit('commit', '-qm', `Audit implicit environment authority\n\n${audit.trailers}`);
  await recordAudit(f.store, { workItemId: f.workItemId, repositoryId: 'primary',
    commit: await f.runGit('rev-parse', 'HEAD') });
  await fs.writeFile(path.join(f.repo, 'next-candidate.mjs'), 'export const next = true;\n');
  await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: 'config-v1', cause: 'retire once-only environment authority' });
  await pruneWork(f.store, f.workItemId);
  const records = await f.store.records(f.workItemId);
  assert.ok(!records.some(record => record.type === 'reservation' &&
    [dev.event.id, staging.event.id].includes(record.eventId)));
  assert.ok(!records.some(record => [dev.event.id, staging.event.id].includes(record.id)));
});

test('T-47 deployment operations require one explicitly resolved environment', async t => {
  const f = await coding(await fixture(t));
  const config = {
    defaultBranch: 'refs/heads/main',
    environments: {
      DEV: {
        target: 'dev-target',
        configDigest: 'config-v1',
        allowedStages: ['pre-production', 'deploy-app'],
      },
      STAGING: {
        target: 'staging-target',
        configDigest: 'config-v1',
        allowedStages: ['staging-deploy'],
        execution: { owner: 'user', locations: ['authorized-machine'] },
      },
    },
    environmentMappings: [{
      provider: 'ci-provider',
      pipeline: 'application-delivery',
      label: 'pre-production',
      environment: 'DEV',
      target: 'dev-target',
      configDigest: 'config-v1',
    }],
    toolAdapters: [{
      toolName: 'fixture_pipeline',
      match: { stage: 'pre-production' },
      action: {
        class: 'pipeline',
        provider: 'ci-provider',
        pipeline: 'application-delivery',
        target: 'dev-target',
        configDigest: 'config-v1',
        stages: ['pre-production'],
        implicitEnvironments: ['pre-production'],
        monitorCapability: true,
      },
    }],
  };
  await writeJson(path.join(f.repo, '.sdlc/config.json'), config);
  await orient(f);
  const cycle = await localPass(f);
  await completeReview(f, cycle);
  const authority = await grant(f, 'dev-authorization', binding(cycle, {
    target: 'dev-target',
    completedStage: 'review',
    lifetime: { kind: 'once' },
  }));
  const state = await f.store.load(f.workItemId);
  const mapped = {
    class: 'pipeline',
    repositoryId: 'primary',
    provider: 'ci-provider',
    pipeline: 'application-delivery',
    target: 'dev-target',
    configDigest: 'config-v1',
    stages: ['pre-production'],
    implicitEnvironments: ['pre-production'],
    monitorCapability: true,
    operationId: 'preview-mapped-environment',
  };
  const mappedDecision = evaluatePolicy(state, mapped, {
    configuration: config,
    clock: f.clock,
  });
  assert.equal(mappedDecision.allowed, true,
    JSON.stringify(mappedDecision.findings));
  assert.equal(mappedDecision.action.environment, 'DEV');
  assert.deepEqual(mappedDecision.action.implicitEnvironments,
    ['pre-production']);

  await assert.rejects(prepareOperation(f.store, {
    workItemId: f.workItemId,
    sessionId: f.sessionId,
    action: {
      ...mapped,
      environment: 'DEV',
      implicitEnvironments: ['unknown-environment'],
    },
    request: {
      toolName: 'fixture_pipeline',
      toolArgs: { stage: 'unknown-environment' },
      cwd: f.repo,
    },
    correlationKey: 'unresolved-environment',
    intent: 'Attempt managed execution with an unresolved environment',
  }), error => error.code === 'GATE' &&
    error.details.some(finding =>
      finding.rule === 'environment-resolution'));
  await assert.rejects(prepareOperation(f.store, {
    workItemId: f.workItemId,
    sessionId: f.sessionId,
    action: {
      ...mapped,
      environment: 'local',
      stages: ['DEV'],
      implicitEnvironments: [],
    },
    request: {
      toolName: 'fixture_pipeline',
      toolArgs: { stage: 'conflicting-local-environment' },
      cwd: f.repo,
    },
    correlationKey: 'conflicting-local-environment',
    intent: 'Attempt remote execution declared as local',
  }), error => error.code === 'GATE' &&
    error.details.some(finding =>
      finding.rule === 'environment-resolution'));

  const prepared = await prepareOperation(f.store, {
    workItemId: f.workItemId,
    sessionId: f.sessionId,
    action: mapped,
    request: {
      toolName: 'fixture_pipeline',
      toolArgs: { stage: 'pre-production' },
      cwd: f.repo,
    },
    correlationKey: 'mapped-environment',
    intent: 'Run the mapped DEV delivery stage',
  });
  assert.equal(prepared.operation.action.environment, 'DEV');
  assert.deepEqual(prepared.operation.action.implicitEnvironments,
    ['pre-production']);
  assert.ok((await f.store.records(f.workItemId)).some(record =>
    record.type === 'reservation' &&
    record.eventId === authority.event.id &&
    record.operationId === prepared.operation.id));

  const explicit = evaluatePolicy(state, {
    ...mapped,
    environment: 'DEV',
    stages: ['deploy-app'],
  }, { configuration: config, clock: f.clock });
  assert.equal(explicit.allowed, true);

  for (const action of [
    { ...mapped, provider: 'other-provider' },
    { ...mapped, stages: [], implicitEnvironments: [] },
    { ...mapped, environment: 'STAGING' },
    { ...mapped, environment: 'DEV', implicitEnvironments: ['unknown-environment'] },
  ]) {
    const decision = evaluatePolicy(state, action, {
      configuration: config,
      clock: f.clock,
    });
    assert.equal(decision.allowed, false);
    assert.ok(decision.findings.some(finding =>
      finding.rule === 'environment-resolution' &&
      finding.verdict === 'violation'));
  }

  const ambiguousConfig = structuredClone(config);
  ambiguousConfig.environmentMappings.push({
    provider: 'ci-provider',
    pipeline: 'application-delivery',
    label: 'staging-deploy',
    environment: 'STAGING',
    target: 'dev-target',
    configDigest: 'config-v1',
  });
  const ambiguous = evaluatePolicy(state, {
    ...mapped,
    stages: ['pre-production', 'staging-deploy'],
  }, { configuration: ambiguousConfig, clock: f.clock });
  assert.ok(ambiguous.findings.some(finding =>
    finding.rule === 'environment-resolution'));

  const unauthorizedStage = evaluatePolicy(state, {
    ...mapped,
    environment: 'DEV',
    stages: ['not-allowed'],
  }, { configuration: config, clock: f.clock });
  assert.ok(unauthorizedStage.findings.some(finding =>
    finding.rule === 'allowed-stages'));

  const unauthorizedProdStage = evaluatePolicy(state, {
    class: 'pipeline',
    repositoryId: 'primary',
    environment: 'PROD',
    target: 'prod-target',
    configDigest: 'config-v1',
    stages: ['unapproved-production-stage'],
    monitorCapability: true,
  }, {
    configuration: {
      environments: {
        PROD: {
          target: 'prod-target',
          configDigest: 'config-v1',
          allowedStages: ['approved-production-stage'],
        },
      },
    },
    clock: f.clock,
  });
  assert.ok(unauthorizedProdStage.findings.some(finding =>
    finding.rule === 'allowed-stages'));

  await grant(f, 'override', {
    rules: ['environment-resolution'],
    reason: 'User directs unmanaged execution despite the unresolved environment',
  });
  const unresolvedAfterOverride = evaluatePolicy(
    await f.store.load(f.workItemId),
    { ...mapped, provider: 'other-provider' },
    { configuration: config, clock: f.clock });
  const resolutionFinding = unresolvedAfterOverride.findings.find(finding =>
    finding.rule === 'environment-resolution');
  assert.equal(resolutionFinding.verdict, 'violation');
  assert.equal(resolutionFinding.eventId, undefined);

  await orient(f);
  await markDispatching(f.store, f.workItemId, prepared.operation.id);
  const managedGate = await gate(f.store, {
    sessionId: f.sessionId,
    cwd: f.repo,
    toolName: 'fixture_pipeline',
    toolArgs: { stage: 'pre-production' },
  });
  assert.equal(managedGate.permissionDecision, undefined,
    JSON.stringify(managedGate));
  assert.equal((await f.store.records(f.workItemId)).find(record =>
    record.id === prepared.operation.id).dispatchBound, true);
  await recordOperation(f.store, {
    workItemId: f.workItemId,
    operationId: prepared.operation.id,
    status: 'submitted',
  });
  await grant(f, 'override', {
    rules: ['uncertain-retry'],
    reason: 'User accepts duplicate-effect risk for the mapped DEV operation',
    scope: { environment: 'DEV' },
  });
  await grant(f, 'dev-authorization', binding(cycle, {
    target: 'dev-target',
    completedStage: 'review',
  }));
  const retry = await prepareOperation(f.store, {
    workItemId: f.workItemId,
    sessionId: f.sessionId,
    action: mapped,
    request: {
      toolName: 'fixture_pipeline',
      toolArgs: { stage: 'pre-production', attempt: 2 },
      cwd: f.repo,
    },
    correlationKey: 'mapped-environment-retry',
    intent: 'Retry the uncertain mapped DEV delivery stage',
  });
  assert.equal(retry.operation.action.environment, 'DEV');
});
