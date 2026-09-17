import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import { fixture, coding, completeReview, grant, testDefinitions, orient } from './helpers.mjs';
import { startCycle, recordArtifact, recordTest, stagingHandoff } from '../src/validation.mjs';
import { writeJson } from '../src/files.mjs';
import { prepareOperation, markDispatching, pruneWork, recordOperation } from '../src/operations.mjs';
import { evaluatePolicy } from '../src/policy.mjs';
import { currentCycle, currentTestEvidence, hasStagingCompletion,
  hasStageCompletion, latestStagingResultEvent,
  stagePassed } from '../src/authority.mjs';
import { evaluateGate as gate } from '../src/gate.mjs';
import { loadConfig, synchronizeTestPlan, testSpecificationDigest } from '../src/artifacts.mjs';
import { formatAudit, recordAudit } from '../src/audit.mjs';
import { nextAction } from '../src/recovery.mjs';
import { stagingExecutionGuidance } from '../src/staging.mjs';

test('T-24/T-26/T-27/T-28 DEV artifact-deployment-test chain and policy-owned STAGING completion', async t => {
  const f = await coding(await fixture(t));
  const configuration = { defaultBranch: 'refs/heads/main', environments: {
    DEV: { target: 'dev-target', configDigest: 'configuration-1', allowedStages: ['DEV'] },
    STAGING: { target: 'staging-target', configDigest: 'configuration-1',
      allowedStages: ['STAGING'],
      execution: { owner: 'user', locations: ['authorized-machine'] } },
  } };
  await writeJson(path.join(f.repo, '.sdlc/config.json'), configuration);
  const { cycle } = await startCycle(f.store, { workItemId: f.workItemId, tests: testDefinitions(), configDigest: 'configuration-1', cause: 'new candidate' });
  const binding = { cycleId: cycle.id, candidateDigest: cycle.candidateDigest, testSpecDigest: cycle.testSpecDigest, configDigest: cycle.configDigest };
  for (const testId of ['T-unit', 'T-integration']) await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id, testId,
    status: 'Passed', owner: 'agent', host: 'local', expectedMet: true, evidenceRef: 'fixture:local-pass' });
  await completeReview(f, cycle);
  const broadDev = await grant(f, 'dev-authorization', { ...binding, target: 'dev-target', completedStage: 'review' });
  const deploy = async environment => {
    const target = environment === 'DEV' ? 'dev-target' : 'staging-target';
    const artifactId = `artifact-${environment}`;
    await recordArtifact(f.store, { workItemId: f.workItemId, cycleId: cycle.id, artifactId, environment, sourceDigest: cycle.candidateDigest,
      configDigest: cycle.configDigest, buildRunId: `build-${environment}`, name: 'package', artifactType: 'archive', evidenceRef: 'fixture:artifact-metadata', status: 'succeeded' });
    const action = { class: 'deploy', environment, target, repositoryId: 'primary', artifactId, configDigest: cycle.configDigest, stages: [environment], monitorCapability: true };
    const { operation } = await prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId, action,
      request: { toolName: 'fixture_pipeline_write', toolArgs: { environment, artifactId }, cwd: f.repo }, correlationKey: `deploy-${environment}`, intent: `Deploy authorized ${environment} candidate` });
    await markDispatching(f.store, f.workItemId, operation.id);
    await recordOperation(f.store, { workItemId: f.workItemId, operationId: operation.id, status: 'submitted', handle: `run-${environment}` });
    await recordOperation(f.store, { workItemId: f.workItemId, operationId: operation.id, status: 'succeeded', handle: `run-${environment}`,
      target, requestFingerprint: operation.requestFingerprint, evidenceRef: 'fixture:successful-deployment' });
    return { operation, artifactId, target };
  };
  const dev = await deploy('DEV');
  await grant(f, 'dev-authorization', { ...binding, target: 'dev-target',
    scope: { repositoryIds: ['primary'], actions: ['test'], environment: 'DEV',
      target: 'dev-target' }, lifetime: { kind: 'once' } });
  await grant(f, 'revocation', { revokes: [broadDev.event.id] });
  const devTestRequest = { toolName: 'fixture_test',
    toolArgs: { testId: 'T-dev', deploymentId: dev.operation.id }, cwd: f.repo };
  const devTest = await prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId,
    action: { class: 'test', repositoryId: 'primary', environment: 'DEV',
      target: dev.target, configDigest: cycle.configDigest, testId: 'T-dev',
      owner: 'agent', host: 'development-machine', artifactId: dev.artifactId,
      deploymentId: dev.operation.id },
    request: devTestRequest, correlationKey: 'test-DEV', intent: 'Test the current DEV deployment' });
  await markDispatching(f.store, f.workItemId, devTest.operation.id);
  await recordOperation(f.store, { workItemId: f.workItemId, operationId: devTest.operation.id,
    status: 'succeeded', target: devTest.operation.target,
    requestFingerprint: devTest.operation.requestFingerprint,
    evidenceRef: 'fixture:dev-test-operation', expectedMet: true });
  const wrongTargetOperation = { ...devTest.operation, id: 'op-wrong-dev-target',
    target: 'other-dev-target', action: { ...devTest.operation.action, target: 'other-dev-target' } };
  await writeJson(path.join(f.store.workPath(f.workItemId), 'evidence',
    `${wrongTargetOperation.id}.json`), wrongTargetOperation);
  await assert.rejects(recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id,
    testId: 'T-dev', status: 'Passed', artifactId: dev.artifactId,
    deploymentId: dev.operation.id, operationId: wrongTargetOperation.id,
    expectedMet: true, owner: 'agent', host: 'development-machine',
    evidenceRef: 'fixture:wrong-dev-target' }), { code: 'OPERATION' });
  await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id, testId: 'T-dev', status: 'Passed',
    artifactId: dev.artifactId, deploymentId: dev.operation.id, expectedMet: true,
    operationId: devTest.operation.id, owner: 'agent', host: 'development-machine',
    evidenceRef: 'fixture:dev-scenario' });
  await grant(f, 'dev-authorization', { ...binding, target: 'dev-target', completedStage: 'review' });
  assert.equal(evaluatePolicy(await f.store.load(f.workItemId), { class: 'recommend-staging', repositoryId: 'primary' }).allowed, false);
  const promotion = await grant(f, 'staging-promotion', { ...binding, target: 'staging-target',
    completedStage: 'DEV', deploymentId: dev.operation.id });
  const staging = await deploy('STAGING');
  await grant(f, 'revocation', { revokes: [promotion.event.id] });
  assert.match(nextAction(await f.store.load(f.workItemId), f.clock),
    /Run handoff staging to resolve/u);
  await grant(f, 'staging-promotion', { ...binding, target: 'staging-target',
    completedStage: 'DEV', deploymentId: dev.operation.id });
  const handoff = await stagingHandoff(f.store, f.workItemId);
  assert.equal(handoff.owner, 'user');
  assert.equal(handoff.tests[0].mode, 'automated');
  const state = await f.store.load(f.workItemId);
  assert.equal(evaluatePolicy(state, { class: 'test', testId: 'T-staging', environment: 'STAGING', repositoryId: 'primary', owner: 'agent', host: 'development-machine',
    target: staging.target, configDigest: cycle.configDigest }, { configuration, clock: f.clock }).allowed, false);
  await assert.rejects(grant(f, 'staging-result', { ...binding, target: staging.target, deploymentId: 'wrong-run', artifactId: staging.artifactId,
    testIds: ['T-staging'], outcome: 'Passed', owner: 'user',
    host: 'authorized-machine', evidenceRef: 'fixture:wrong-staging-result' }),
  { code: 'EVIDENCE' });
  await assert.rejects(grant(f, 'staging-result', { ...binding,
    target: staging.target, deploymentId: staging.operation.id,
    artifactId: staging.artifactId, testIds: ['T-staging'],
    outcome: 'Passed', owner: 'user', host: 'authorized-machine',
    evidenceRef: 'fixture:wrong-scope-staging-result',
    scope: { repositoryIds: ['not-a-member'], environment: 'DEV',
      target: 'other-target' } }), { code: 'AUTHORITY' });
  const result = await grant(f, 'staging-result', { ...binding, target: staging.target, deploymentId: staging.operation.id,
    artifactId: staging.artifactId, testIds: ['T-staging'], outcome: 'Passed',
    owner: 'user', host: 'authorized-machine',
    evidenceRef: 'fixture:staging-result' });
  await assert.rejects(recordTest(f.store, { workItemId: f.workItemId,
    cycleId: cycle.id, testId: 'T-staging', status: 'Passed',
    artifactId: 'wrong-artifact', deploymentId: staging.operation.id,
    expectedMet: true, owner: 'user', host: 'authorized-machine',
    evidenceRef: 'fixture:wrong-artifact', eventId: result.event.id }),
  { code: 'EVIDENCE' });
  await assert.rejects(recordTest(f.store, { workItemId: f.workItemId,
    cycleId: cycle.id, testId: 'T-staging', status: 'Passed',
    artifactId: staging.artifactId, deploymentId: 'wrong-deployment',
    expectedMet: true, owner: 'user', host: 'authorized-machine',
    evidenceRef: 'fixture:wrong-deployment', eventId: result.event.id }),
  { code: 'EVIDENCE' });
  await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id, testId: 'T-staging', status: 'Passed',
    artifactId: staging.artifactId, deploymentId: staging.operation.id,
    expectedMet: true, owner: 'user', host: 'authorized-machine', evidenceRef: 'fixture:staging-user-report', eventId: result.event.id });
  const recommendation = evaluatePolicy(await f.store.load(f.workItemId), { class: 'recommend-prod', repositoryId: 'primary' }, { configuration, clock: f.clock });
  assert.ok(recommendation.findings.some(finding => finding.rule === 'prod-pr-readiness'));
  assert.ok(recommendation.findings.some(finding =>
    finding.rule === 'staging-completion'));
  await assert.rejects(grant(f, 'stage-completion', { ...binding,
    completedStage: 'STAGING', deploymentId: staging.operation.id,
    target: 'other-target',
    scope: { repositoryIds: ['primary'], environment: 'DEV',
      target: 'other-target' } }), { code: 'AUTHORITY' });
  await assert.rejects(grant(f, 'stage-completion', { ...binding,
    completedStage: 'STAGING', deploymentId: staging.operation.id,
    target: staging.target,
    scope: { repositoryIds: ['not-a-member'], environment: 'STAGING',
      target: staging.target } }), { code: 'AUTHORITY' });
  await grant(f, 'stage-completion', { ...binding,
    completedStage: 'STAGING', deploymentId: staging.operation.id,
    target: staging.target });
  const confirmedRecommendation = evaluatePolicy(
    await f.store.load(f.workItemId),
    { class: 'recommend-prod', repositoryId: 'primary' },
    { configuration, clock: f.clock });
  assert.ok(!confirmedRecommendation.findings.some(finding =>
    finding.rule === 'staging-completion'));
  await grant(f, 'staging-result', { ...binding, target: staging.target, deploymentId: staging.operation.id,
    artifactId: staging.artifactId, testIds: ['T-staging'], outcome: 'Failed',
    owner: 'user', host: 'authorized-machine',
    evidenceRef: 'fixture:failed-staging-result' });
  const failedState = await f.store.load(f.workItemId);
  const failedCycle = currentCycle(failedState.records, failedState.checkpoint);
  assert.equal(hasStagingCompletion(failedState.records, failedCycle, f.clock), false);
  assert.equal(failedCycle.results['T-staging'], undefined);
  assert.match(await fs.readFile(path.join(f.repo, 'docs/test-plan.md'), 'utf8'), /T-staging.*Failed/u);
  const replacementRequest = { toolName: 'fixture_pipeline_write',
    toolArgs: { environment: 'STAGING', artifactId: staging.artifactId, attempt: 2 }, cwd: f.repo };
  const replacement = await prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId,
    action: { class: 'deploy', environment: 'STAGING', target: staging.target, repositoryId: 'primary',
      artifactId: staging.artifactId, configDigest: cycle.configDigest, stages: ['STAGING'], monitorCapability: true },
    request: replacementRequest, correlationKey: 'deploy-STAGING-replacement', intent: 'Replace the STAGING deployment' });
  await markDispatching(f.store, f.workItemId, replacement.operation.id);
  let replacementState = await f.store.load(f.workItemId);
  assert.equal(hasStagingCompletion(replacementState.records, currentCycle(replacementState.records, replacementState.checkpoint), f.clock), false);
  await recordOperation(f.store, { workItemId: f.workItemId, operationId: replacement.operation.id,
    status: 'succeeded', handle: 'run-STAGING-replacement', target: replacement.operation.target,
    requestFingerprint: replacement.operation.requestFingerprint, evidenceRef: 'fixture:successful-replacement' });
  const replacementResult = await grant(f, 'staging-result', { ...binding, target: staging.target,
    deploymentId: replacement.operation.id, artifactId: staging.artifactId,
    testIds: ['T-staging'], outcome: 'Passed', owner: 'user',
    host: 'authorized-machine', evidenceRef: 'fixture:replacement-result' });
  await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id, testId: 'T-staging', status: 'Passed',
    artifactId: staging.artifactId, deploymentId: replacement.operation.id,
    expectedMet: true, owner: 'user', host: 'authorized-machine',
    evidenceRef: 'fixture:replacement-staging-user-report', eventId: replacementResult.event.id });
  replacementState = await f.store.load(f.workItemId);
  let replacementCycle = currentCycle(replacementState.records, replacementState.checkpoint);
  assert.equal(hasStagingCompletion(replacementState.records,
    replacementCycle, f.clock), false);
  await grant(f, 'stage-completion', { ...binding,
    completedStage: 'STAGING', deploymentId: replacement.operation.id,
    target: staging.target });
  replacementState = await f.store.load(f.workItemId);
  replacementCycle = currentCycle(replacementState.records,
    replacementState.checkpoint);
  assert.equal(hasStagingCompletion(replacementState.records, replacementCycle, f.clock), true);
  const latestResult = await grant(f, 'staging-result', { ...binding, target: staging.target,
    deploymentId: replacement.operation.id, artifactId: staging.artifactId,
    testIds: ['T-staging'], outcome: 'Passed', owner: 'user',
    host: 'authorized-machine', evidenceRef: 'fixture:latest-staging-result',
    lifetime: { kind: 'until', expiresAt: new Date(f.clock.now() + 1000).toISOString() } });
  await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id, testId: 'T-staging', status: 'Passed',
    artifactId: staging.artifactId, deploymentId: replacement.operation.id,
    expectedMet: true, owner: 'user', host: 'authorized-machine',
    evidenceRef: 'fixture:latest-staging-user-report', eventId: latestResult.event.id });
  const audit = await formatAudit(f.store, f.workItemId);
  await f.runGit('add', '.sdlc');
  await f.runGit('commit', '-qm', `Audit STAGING confirmations\n\n${audit.trailers}`);
  await recordAudit(f.store, { workItemId: f.workItemId, repositoryId: 'primary',
    commit: await f.runGit('rev-parse', 'HEAD') });
  await pruneWork(f.store, f.workItemId);
  const retainedStagingResults = (await f.store.records(f.workItemId)).filter(event =>
    event.type === 'event' && event.kind === 'staging-result' &&
    event.effect.deploymentId === replacement.operation.id);
  assert.deepEqual(retainedStagingResults.map(event => event.id), [latestResult.event.id]);
  replacementState = await f.store.load(f.workItemId);
  replacementCycle = currentCycle(replacementState.records, replacementState.checkpoint);
  const currentStagingEvidence = replacementCycle.results['T-staging'];
  await assert.rejects(recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id,
    testId: 'T-staging', status: 'Passed', artifactId: staging.artifactId,
    deploymentId: replacement.operation.id,
    expectedMet: true, owner: 'user', host: 'authorized-machine',
    evidenceRef: 'fixture:late-same-deployment-report',
    eventId: replacementResult.event.id }), { code: 'PROVENANCE' });
  await assert.rejects(recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id, testId: 'T-staging', status: 'Passed',
    artifactId: staging.artifactId, deploymentId: staging.operation.id,
    expectedMet: true, owner: 'user', host: 'authorized-machine',
    evidenceRef: 'fixture:late-old-staging-report', eventId: result.event.id }), { code: 'PROVENANCE' });
  replacementState = await f.store.load(f.workItemId);
  replacementCycle = currentCycle(replacementState.records, replacementState.checkpoint);
  assert.equal(replacementCycle.results['T-staging'], currentStagingEvidence);
  f.clock.advance(1001);
  await synchronizeTestPlan(f.store, f.workItemId);
  assert.match(await fs.readFile(path.join(f.repo, 'docs/test-plan.md'), 'utf8'), /T-staging.*NotRun/u);
  const failedStagingRequest = { toolName: 'fixture_pipeline_write',
    toolArgs: { environment: 'STAGING', artifactId: staging.artifactId, attempt: 3 }, cwd: f.repo };
  const failedStaging = await prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId,
    action: { class: 'deploy', environment: 'STAGING', target: staging.target, repositoryId: 'primary',
      artifactId: staging.artifactId, configDigest: cycle.configDigest, stages: ['STAGING'], monitorCapability: true },
    request: failedStagingRequest, correlationKey: 'deploy-STAGING-failed-replacement', intent: 'Attempt another STAGING replacement' });
  await markDispatching(f.store, f.workItemId, failedStaging.operation.id);
  await recordOperation(f.store, { workItemId: f.workItemId, operationId: failedStaging.operation.id,
    status: 'failed', handle: 'run-STAGING-failed-replacement', target: failedStaging.operation.target,
    requestFingerprint: failedStaging.operation.requestFingerprint, evidenceRef: 'fixture:failed-replacement',
    providerStatus: 'failed' });
  replacementState = await f.store.load(f.workItemId);
  assert.equal(hasStagingCompletion(replacementState.records, currentCycle(replacementState.records, replacementState.checkpoint), f.clock), false);
  const devReplacementRequest = { toolName: 'fixture_pipeline_write',
    toolArgs: { environment: 'DEV', artifactId: dev.artifactId, attempt: 2 }, cwd: f.repo };
  const devReplacement = await prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId,
    action: { class: 'deploy', environment: 'DEV', target: dev.target, repositoryId: 'primary',
      artifactId: dev.artifactId, configDigest: cycle.configDigest, stages: ['DEV'], monitorCapability: true },
    request: devReplacementRequest, correlationKey: 'deploy-DEV-replacement', intent: 'Replace the DEV deployment' });
  await markDispatching(f.store, f.workItemId, devReplacement.operation.id);
  replacementState = await f.store.load(f.workItemId);
  replacementCycle = currentCycle(replacementState.records, replacementState.checkpoint);
  assert.equal(stagePassed(replacementCycle, replacementState.records, 'DEV'), false);
  assert.equal(hasStageCompletion(replacementState.records, replacementCycle, 'DEV', f.clock), false);
  assert.equal(hasStagingCompletion(replacementState.records, replacementCycle, f.clock), false);
  await assert.rejects(recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id,
    testId: 'T-dev', status: 'Passed', artifactId: dev.artifactId,
    deploymentId: devReplacement.operation.id, operationId: devTest.operation.id,
    expectedMet: true, owner: 'agent', host: 'development-machine',
    evidenceRef: 'fixture:historical-dev-operation' }), { code: 'STALE' });
  await recordOperation(f.store, { workItemId: f.workItemId, operationId: devReplacement.operation.id,
    status: 'failed', handle: 'run-DEV-replacement', target: devReplacement.operation.target,
    requestFingerprint: devReplacement.operation.requestFingerprint, evidenceRef: 'fixture:failed-dev-replacement',
    providerStatus: 'failed' });
  assert.equal(currentCycle((await f.store.load(f.workItemId)).records,
    (await f.store.load(f.workItemId)).checkpoint).deployments.DEV, devReplacement.operation.id);
});
test('T-29 status-only synchronization does not reset cycle or session orientation; test definition changes do', async t => {
  const f = await coding(await fixture(t));
  await writeJson(path.join(f.repo, '.sdlc/config.json'), { defaultBranch: 'refs/heads/main' });
  const initial = await startCycle(f.store, { workItemId: f.workItemId, tests: testDefinitions(), configDigest: 'v1', cause: 'first' });
  await orient(f);
  const plan = path.join(f.repo, 'docs/test-plan.md');
  const old = await fs.readFile(plan, 'utf8');
  await recordTest(f.store, { workItemId: f.workItemId, cycleId: initial.cycle.id, testId: 'T-unit', status: 'Passed',
    expectedMet: true, owner: 'agent', host: 'local', evidenceRef: 'fixture:units' });
  const updated = await fs.readFile(plan, 'utf8');
  assert.match(updated, /T-unit.*Passed/u);
  assert.equal(testSpecificationDigest(old), testSpecificationDigest(updated));
  assert.equal(testSpecificationDigest(JSON.stringify({ tests: [{ id: 'T-json', expected: 'same outcome', status: 'NotRun' }] })),
    testSpecificationDigest(JSON.stringify({ tests: [{ id: 'T-json', expected: 'same outcome', status: 'Passed' }] })));
  const same = await startCycle(f.store, { workItemId: f.workItemId, tests: testDefinitions(), configDigest: 'v1', cause: 'status update' });
  assert.equal(same.reset, false);
  assert.equal((await gate(f.store, { sessionId: f.sessionId, cwd: f.repo, toolName: 'create', toolArgs: { path: 'source.mjs', file_text: 'code' } })).permissionDecision, undefined);
  await fs.writeFile(plan, updated.replace('All assertions pass', 'All assertions and a new outcome pass'));
  const next = await startCycle(f.store, { workItemId: f.workItemId, configDigest: 'v1', cause: 'test requirement changed' });
  assert.equal(next.reset, true);
  assert.ok(!(await fs.readFile(plan, 'utf8')).includes('Passed'));
});
test('T-27 STAGING completion requires passing confirmation for every planned STAGING test', () => {
  const cycle = { id: 'cycle-1', candidateDigest: 'candidate', testSpecDigest: 'spec', configDigest: 'config',
    pendingPlanSync: false, deployments: { STAGING: 'deploy-1' },
    tests: [{ id: 'staging-a', environment: 'STAGING' }, { id: 'staging-b', environment: 'STAGING' }],
    results: { 'staging-a': 'evidence-a', 'staging-b': 'evidence-b' } };
  const records = [
    { id: 'deploy-1', type: 'operation', status: 'succeeded', artifactId: 'artifact-1' },
    { id: 'evidence-a', type: 'test-evidence', testId: 'staging-a',
      status: 'Passed', cycleId: cycle.id,
      candidateDigest: cycle.candidateDigest, testSpecDigest: cycle.testSpecDigest, deploymentId: 'deploy-1',
      artifactId: 'artifact-1', environment: 'STAGING', owner: 'user',
      host: 'authorized-machine', eventId: 'event-a' },
    { id: 'evidence-b', type: 'test-evidence', testId: 'staging-b',
      status: 'Passed', cycleId: cycle.id,
      candidateDigest: cycle.candidateDigest, testSpecDigest: cycle.testSpecDigest, deploymentId: 'deploy-1',
      artifactId: 'artifact-1', environment: 'STAGING', owner: 'user',
      host: 'authorized-machine', eventId: 'event-b' },
    { id: 'event-a', type: 'event', sequence: 1, kind: 'staging-result', effect: {
      cycleId: cycle.id, candidateDigest: cycle.candidateDigest, testSpecDigest: cycle.testSpecDigest,
      configDigest: cycle.configDigest, deploymentId: 'deploy-1', artifactId: 'artifact-1',
      testIds: ['staging-a'], outcome: 'Passed', owner: 'user',
      host: 'authorized-machine', evidenceRef: 'fixture:event-a' },
      occurredAt: '2026-09-16T00:00:01.000Z' },
  ];
  assert.equal(hasStagingCompletion(records, cycle), false);
  records.push({ id: 'event-b', type: 'event', sequence: 2, kind: 'staging-result', effect: {
    cycleId: cycle.id, candidateDigest: cycle.candidateDigest, testSpecDigest: cycle.testSpecDigest,
    configDigest: cycle.configDigest, deploymentId: 'deploy-1', artifactId: 'artifact-1',
    testIds: ['staging-b'], outcome: 'Passed', owner: 'user',
    host: 'authorized-machine', evidenceRef: 'fixture:event-b' },
    occurredAt: '2026-09-16T00:00:02.000Z' });
  assert.equal(currentTestEvidence(cycle, records, cycle.tests[0])?.status,
    'Passed');
  assert.equal(currentTestEvidence(cycle, records, cycle.tests[1])?.status,
    'Passed');
  assert.equal(hasStagingCompletion(records, cycle), false);
  records.push({ id: 'staging-complete', type: 'event', sequence: 3,
    kind: 'stage-completion', effect: {
      cycleId: cycle.id, candidateDigest: cycle.candidateDigest,
      testSpecDigest: cycle.testSpecDigest, configDigest: cycle.configDigest,
      completedStage: 'STAGING', deploymentId: 'deploy-1',
      target: 'staging-target' } });
  assert.equal(hasStagingCompletion(records, cycle), true);
    records.push({ id: 'event-a-new', type: 'event', sequence: 4, kind: 'staging-result', effect: {
      cycleId: cycle.id, candidateDigest: cycle.candidateDigest, testSpecDigest: cycle.testSpecDigest,
      configDigest: cycle.configDigest, deploymentId: 'deploy-1', artifactId: 'artifact-1',
      testIds: ['staging-a'], outcome: 'Passed', owner: 'user',
      host: 'authorized-machine', evidenceRef: 'fixture:event-a-new' },
      occurredAt: '2026-09-16T00:00:03.000Z' });
    records.find(record => record.id === 'evidence-a').eventId = 'event-a-new';
    assert.equal(latestStagingResultEvent(records, cycle, 'staging-a').id, 'event-a-new');
    assert.equal(latestStagingResultEvent(records, cycle, 'staging-b').id, 'event-b');
    assert.equal(hasStagingCompletion(records, cycle), true);
});

test('T-50 STAGING execution owner and location come from policy or an exact fallback', async t => {
  const f = await coding(await fixture(t));
  const cycle = (await startCycle(f.store, {
    workItemId: f.workItemId,
    configDigest: 'policy-v1',
    cause: 'STAGING execution policy',
  })).cycle;
  const state = await f.store.load(f.workItemId);
  const current = currentCycle(state.records, state.checkpoint);
  current.deployments.STAGING = 'deploy-policy';
  state.records.push({
    type: 'operation',
    id: 'deploy-policy',
    class: 'deploy',
    status: 'dispatching',
    artifactId: 'artifact-policy',
    repositoryId: 'primary',
  });

  {
    const f = await coding(await fixture(t));
    const planPath = path.join(f.repo, 'docs/test-plan.md');
    const plan = await fs.readFile(planPath, 'utf8');
    const agentPlan = plan.split('\n').map(line =>
      line.startsWith('| T-staging |') ?
        line.replace('| user | authorized-machine |',
          '| agent | staging-runner |') : line).join('\n');
    assert.notEqual(agentPlan, plan);
    await fs.writeFile(planPath, agentPlan);
    await writeJson(path.join(f.repo, '.sdlc/config.json'), {
      defaultBranch: 'refs/heads/main',
      environments: {
        STAGING: {
          target: 'staging-target',
          configDigest: 'agent-policy-v1',
          allowedStages: ['STAGING'],
          execution: { owner: 'agent', locations: ['staging-runner'] },
        },
      },
    });
    const cycle = (await startCycle(f.store, {
      workItemId: f.workItemId,
      configDigest: 'agent-policy-v1',
      cause: 'agent-owned STAGING evidence',
    })).cycle;
    await f.store.transaction(f.workItemId, tx => {
      tx.put({
        type: 'operation',
        id: 'deploy-agent-staging',
        workItemId: f.workItemId,
        sessionId: f.sessionId,
        repositoryId: 'primary',
        bindingKey: 'fixture-binding',
        class: 'deploy',
        action: {
          class: 'deploy',
          repositoryId: 'primary',
          environment: 'STAGING',
          target: 'staging-target',
          artifactId: 'artifact-agent-staging',
        },
        target: 'staging-target',
        status: 'dispatching',
        correlationKey: 'deploy-agent-staging',
        requestFingerprint: 'deploy-agent-staging-request',
        effectFingerprint: 'deploy-agent-staging-effect',
        intent: 'Fixture STAGING deployment',
        createdAt: '2026-09-16T00:00:00.000Z',
        dispatchBound: true,
        cycleId: cycle.id,
        candidateDigest: cycle.candidateDigest,
        candidateStamp: 'fixture-stamp',
        artifactId: 'artifact-agent-staging',
        deploymentSequence: 1,
      });
      tx.put({
        type: 'operation',
        id: 'test-agent-staging',
        workItemId: f.workItemId,
        sessionId: f.sessionId,
        repositoryId: 'primary',
        bindingKey: 'fixture-binding',
        class: 'test',
        action: {
          class: 'test',
          repositoryId: 'primary',
          environment: 'STAGING',
          target: 'staging-target',
          configDigest: 'agent-policy-v1',
          testId: 'T-staging',
          owner: 'agent',
          host: 'staging-runner',
          deploymentId: 'deploy-agent-staging',
          artifactId: 'artifact-agent-staging',
        },
        target: 'staging-target',
        status: 'dispatching',
        correlationKey: 'test-agent-staging',
        requestFingerprint: 'test-agent-staging-request',
        effectFingerprint: 'test-agent-staging-effect',
        intent: 'Fixture agent-owned STAGING test',
        createdAt: '2026-09-16T00:01:00.000Z',
        dispatchBound: true,
        cycleId: cycle.id,
        candidateDigest: cycle.candidateDigest,
        candidateStamp: 'fixture-stamp',
        expectedMet: true,
      });
    });
    await recordOperation(f.store, {
      workItemId: f.workItemId,
      operationId: 'deploy-agent-staging',
      status: 'succeeded',
      handle: 'run-agent-staging',
      target: 'staging-target',
      requestFingerprint: 'deploy-agent-staging-request',
      evidenceRef: 'fixture:agent-staging-deployment',
    });
    const preparedState = await f.store.load(f.workItemId);
    const preparedCycle = currentCycle(preparedState.records,
      preparedState.checkpoint);
    assert.equal(preparedCycle.deployments.STAGING,
      'deploy-agent-staging');
    assert.equal(preparedState.records.find(record =>
      record.id === 'deploy-agent-staging').artifactId,
    'artifact-agent-staging');
    const oldFailure = await grant(f, 'staging-result', {
      cycleId: cycle.id,
      candidateDigest: cycle.candidateDigest,
      testSpecDigest: cycle.testSpecDigest,
      configDigest: cycle.configDigest,
      target: 'staging-target',
      deploymentId: 'deploy-agent-staging',
      artifactId: 'artifact-agent-staging',
      testIds: ['T-staging'],
      outcome: 'Failed',
      owner: 'agent',
      host: 'staging-runner',
      evidenceRef: 'fixture:older-agent-failure',
    });
    assert.equal(oldFailure.event.effect.outcome, 'Failed');
    f.clock.advance(1);
    await recordOperation(f.store, {
      workItemId: f.workItemId,
      operationId: 'test-agent-staging',
      status: 'succeeded',
      target: 'staging-target',
      requestFingerprint: 'test-agent-staging-request',
      evidenceRef: 'fixture:agent-staging-operation',
      expectedMet: true,
    });
    const completedState = await f.store.load(f.workItemId);
    const completedTestOperation = completedState.records.find(record =>
      record.id === 'test-agent-staging');
    const wrongTargetOperation = {
      ...completedTestOperation,
      id: 'test-agent-wrong-target',
      target: 'other-target',
      action: {
        ...completedTestOperation.action,
        target: 'other-target',
      },
    };
    await writeJson(path.join(f.store.workPath(f.workItemId), 'evidence',
      `${wrongTargetOperation.id}.json`), wrongTargetOperation);
    await assert.rejects(recordTest(f.store, {
      workItemId: f.workItemId,
      cycleId: cycle.id,
      testId: 'T-staging',
      status: 'Passed',
      evidenceRef: 'fixture:wrong-target',
      artifactId: 'artifact-agent-staging',
      deploymentId: 'deploy-agent-staging',
      operationId: wrongTargetOperation.id,
      expectedMet: true,
      owner: 'agent',
      host: 'staging-runner',
    }), { code: 'OPERATION' });
    await recordTest(f.store, {
      workItemId: f.workItemId,
      cycleId: cycle.id,
      testId: 'T-staging',
      status: 'Passed',
      evidenceRef: 'fixture:agent-staging-result',
      artifactId: 'artifact-agent-staging',
      deploymentId: 'deploy-agent-staging',
      operationId: 'test-agent-staging',
      expectedMet: true,
      owner: 'agent',
      host: 'staging-runner',
    });
    const state = await f.store.load(f.workItemId);
    const current = currentCycle(state.records, state.checkpoint);
    assert.equal(currentTestEvidence(current, state.records,
      current.tests.find(test => test.id === 'T-staging'), f.clock).status,
    'Passed');
    for (const mutate of [
      operation => {
        operation.target = 'other-target';
        operation.action.target = 'other-target';
      },
      operation => {
        operation.status = 'failed';
        operation.expectedMet = false;
      },
    ]) {
      const tampered = structuredClone(state);
      mutate(tampered.records.find(record =>
        record.id === 'test-agent-staging'));
      const tamperedCycle = currentCycle(tampered.records,
        tampered.checkpoint);
      assert.notEqual(currentTestEvidence(tamperedCycle,
        tampered.records, tamperedCycle.tests.find(test =>
          test.id === 'T-staging'), f.clock)?.status, 'Passed');
    }
    assert.equal(hasStagingCompletion(state.records, current, f.clock), false);
    f.clock.advance(1);
    await grant(f, 'staging-result', {
      cycleId: cycle.id,
      candidateDigest: cycle.candidateDigest,
      testSpecDigest: cycle.testSpecDigest,
      configDigest: cycle.configDigest,
      target: 'staging-target',
      deploymentId: 'deploy-agent-staging',
      artifactId: 'artifact-agent-staging',
      testIds: ['T-staging'],
      outcome: 'Failed',
      owner: 'agent',
      host: 'staging-runner',
      evidenceRef: 'fixture:newer-agent-failure',
    });
    await recordTest(f.store, {
      workItemId: f.workItemId,
      cycleId: cycle.id,
      testId: 'T-staging',
      status: 'Passed',
      evidenceRef: 'fixture:replayed-old-operation',
      artifactId: 'artifact-agent-staging',
      deploymentId: 'deploy-agent-staging',
      operationId: 'test-agent-staging',
      expectedMet: true,
      owner: 'agent',
      host: 'staging-runner',
    });
    const failedState = await f.store.load(f.workItemId);
    const failedCycle = currentCycle(failedState.records,
      failedState.checkpoint);
    assert.equal(currentTestEvidence(failedCycle, failedState.records,
      failedCycle.tests.find(test => test.id === 'T-staging'),
      f.clock).status, 'Failed');

    await grant(f, 'override', {
      rules: ['staging-execution-contract'],
      reason: 'Use an authorized user fallback for this STAGING test',
      scope: {
        repositoryIds: ['primary'],
        actions: ['test', 'staging-result'],
        environment: 'STAGING',
        target: 'staging-target',
        owner: 'user',
        host: 'fallback-machine',
      },
      lifetime: { kind: 'cycle', cycleId: cycle.id },
    });
    const handoff = await stagingHandoff(f.store, f.workItemId);
    assert.equal(handoff.owner, 'user');
    assert.equal(handoff.location, 'fallback-machine');
    const result = await grant(f, 'staging-result', {
      cycleId: cycle.id,
      candidateDigest: cycle.candidateDigest,
      testSpecDigest: cycle.testSpecDigest,
      configDigest: cycle.configDigest,
      target: 'staging-target',
      deploymentId: 'deploy-agent-staging',
      artifactId: 'artifact-agent-staging',
      testIds: ['T-staging'],
      outcome: 'Passed',
      owner: 'user',
      host: 'fallback-machine',
      evidenceRef: 'fixture:fallback-user-result',
    });
    await recordTest(f.store, {
      workItemId: f.workItemId,
      cycleId: cycle.id,
      testId: 'T-staging',
      status: 'Passed',
      evidenceRef: 'fixture:fallback-user-result',
      artifactId: 'artifact-agent-staging',
      deploymentId: 'deploy-agent-staging',
      eventId: result.event.id,
      expectedMet: true,
      owner: 'user',
      host: 'fallback-machine',
    });
  }
  const stagingTest = current.tests.find(test =>
    test.environment === 'STAGING');
  const actionFor = (owner, host) => ({
    class: 'test',
    repositoryId: 'primary',
    environment: 'STAGING',
    target: 'staging-target',
    configDigest: cycle.configDigest,
    testId: stagingTest.id,
    owner,
    host,
    deploymentId: 'deploy-policy',
    artifactId: 'artifact-policy',
  });
  for (const owner of ['agent', 'provider', 'external-system']) {
    const candidate = structuredClone(state);
    const candidateCycle = currentCycle(candidate.records,
      candidate.checkpoint);
    const test = candidateCycle.tests.find(item =>
      item.id === stagingTest.id);
    test.owner = owner;
    test.location = `${owner}-runner`;
    const configuration = {
      environments: {
        STAGING: {
          target: 'staging-target',
          configDigest: cycle.configDigest,
          allowedStages: ['STAGING'],
          execution: { owner, locations: [`${owner}-runner`] },
        },
      },
    };
    const decision = evaluatePolicy(candidate,
      actionFor(owner, `${owner}-runner`),
      { configuration, clock: f.clock });
    assert.ok(!decision.findings.some(finding =>
      ['staging-execution-policy', 'staging-execution-contract',
        'staging-user-handoff'].includes(finding.rule)), owner);
    const guidance = stagingExecutionGuidance({
      resolved: true,
      owner,
      locations: [`${owner}-runner`],
    });
    assert.equal(guidance.state, 'ready-for-authorized-execution');
    assert.match(guidance.instruction,
      new RegExp(`authorized ${owner} path`, 'u'));
  }
  const multiLocation = stagingExecutionGuidance({
    resolved: true,
    owner: 'provider',
    locations: ['runner-a', 'runner-b'],
  }, [
    { location: 'runner-a' },
    { location: 'runner-b' },
  ]);
  assert.equal(multiLocation.location, undefined);
  assert.match(multiLocation.instruction, /runner-a, runner-b/u);

  const userConfiguration = {
    environments: {
      STAGING: {
        target: 'staging-target',
        configDigest: cycle.configDigest,
        allowedStages: ['STAGING'],
        execution: {
          owner: 'user',
          locations: ['authorized-machine'],
        },
      },
    },
  };
  assert.ok(evaluatePolicy(state,
    actionFor('user', 'authorized-machine'),
    { configuration: userConfiguration, clock: f.clock }).findings
    .some(finding => finding.rule === 'staging-user-handoff'));
  assert.ok(evaluatePolicy(state,
    actionFor('agent', 'unauthorized-machine'),
    { configuration: userConfiguration, clock: f.clock }).findings
    .some(finding => finding.rule === 'staging-execution-contract'));
  assert.ok(evaluatePolicy(state, {
    ...actionFor('agent', 'agent-runner'),
    externalPermission: false,
  }, {
    configuration: {
      environments: {
        STAGING: {
          target: 'staging-target',
          configDigest: cycle.configDigest,
          allowedStages: ['STAGING'],
          execution: { owner: 'agent', locations: ['agent-runner'] },
        },
      },
    },
    clock: f.clock,
  }).findings.some(finding => finding.rule === 'external-permission'));
  assert.ok(evaluatePolicy(state,
    actionFor('agent', 'agent-runner'),
    { configuration: { environments: {
      STAGING: {
        target: 'staging-target',
        configDigest: cycle.configDigest,
        allowedStages: ['STAGING'],
      },
    } }, clock: f.clock }).findings
    .some(finding => finding.rule === 'staging-execution-policy'));

  const fallbackState = structuredClone(state);
  fallbackState.records.push({
    type: 'event',
    id: 'fallback-agent',
    kind: 'override',
    effect: {
      rules: ['staging-execution-contract'],
      reason: 'Use the authorized agent runner for this cycle',
      scope: {
        repositoryIds: ['primary'],
        actions: ['test'],
        itemId: 'staging-suite',
        paths: ['tests/staging-suite.mjs'],
        environment: 'STAGING',
        target: 'staging-target',
        owner: 'agent',
        host: 'agent-runner',
      },
      lifetime: { kind: 'cycle', cycleId: cycle.id },
    },
  });
  const fallback = evaluatePolicy(fallbackState,
    { ...actionFor('agent', 'agent-runner'), itemId: 'staging-suite',
      paths: ['tests/staging-suite.mjs'] },
    { configuration: userConfiguration, clock: f.clock });
  assert.ok(!fallback.findings.some(finding =>
    finding.rule === 'staging-execution-contract'));
  const wrongScope = structuredClone(fallbackState);
  wrongScope.records.at(-1).effect.scope.paths = ['tests/other.mjs'];
  assert.ok(evaluatePolicy(wrongScope,
    { ...actionFor('agent', 'agent-runner'), itemId: 'staging-suite',
      paths: ['tests/staging-suite.mjs'] },
    { configuration: userConfiguration, clock: f.clock }).findings
    .some(finding => finding.rule === 'staging-execution-contract'));

  await assert.rejects(grant(f, 'override', {
    rules: ['staging-execution-contract'],
    reason: 'Invalid fallback without a target',
    scope: {
      repositoryIds: ['primary'],
      actions: ['test'],
      environment: 'STAGING',
      owner: 'agent',
      host: 'agent-runner',
    },
    lifetime: { kind: 'cycle', cycleId: cycle.id },
  }), { code: 'INPUT' });
  const recordedFallback = await grant(f, 'override', {
    rules: ['staging-execution-contract'],
    reason: 'Use the authorized agent runner for this cycle',
    scope: {
      repositoryIds: ['primary'],
      actions: ['test'],
      environment: 'STAGING',
      target: 'staging-target',
      owner: 'agent',
      host: 'agent-runner',
    },
    lifetime: { kind: 'cycle', cycleId: cycle.id },
  });
  assert.equal(recordedFallback.event.effect.scope.owner, 'agent');

  const metadata = await f.store.metadata(f.workItemId);
  for (const execution of [
    { owner: 'invalid', locations: ['runner'] },
    { owner: 'agent', locations: [] },
  ]) {
    await writeJson(path.join(f.repo, '.sdlc/config.json'), {
      environments: {
        STAGING: {
          target: 'staging-target',
          configDigest: cycle.configDigest,
          execution,
        },
      },
    });
    await assert.rejects(loadConfig(metadata, 'primary'), error =>
      ['CONFIG', 'INPUT'].includes(error.code));
  }
});
test('T-16 the same deployable artifact retains separate DEV and STAGING selections', async t => {
  const f = await coding(await fixture(t));
  const { cycle } = await startCycle(f.store, { workItemId: f.workItemId,
    tests: testDefinitions(), configDigest: 'v1', cause: 'shared artifact selection' });
  const common = { workItemId: f.workItemId, cycleId: cycle.id, artifactId: 'shared-package',
    sourceDigest: cycle.candidateDigest, configDigest: cycle.configDigest,
    buildRunId: 'build-shared', name: 'package', artifactType: 'archive',
    evidenceRef: 'fixture:shared-artifact', status: 'succeeded' };
  const dev = await recordArtifact(f.store, { ...common, environment: 'DEV' });
  const staging = await recordArtifact(f.store, { ...common, environment: 'STAGING' });
  assert.notEqual(dev.id, staging.id);
  const state = await f.store.load(f.workItemId);
  const current = currentCycle(state.records, state.checkpoint);
  assert.equal(state.records.find(record => record.id === current.artifacts.DEV).environment, 'DEV');
  assert.equal(state.records.find(record => record.id === current.artifacts.STAGING).environment, 'STAGING');
});
test('T-18 archived artifact selections can be reselected without immutable ID conflicts', async t => {
  const f = await coding(await fixture(t));
  const { cycle } = await startCycle(f.store, { workItemId: f.workItemId,
    tests: testDefinitions(), configDigest: 'v1', cause: 'artifact reselection' });
  const select = artifactId => recordArtifact(f.store, { workItemId: f.workItemId,
    cycleId: cycle.id, artifactId, environment: 'DEV', sourceDigest: cycle.candidateDigest,
    configDigest: cycle.configDigest, buildRunId: `build-${artifactId}`, name: artifactId,
    artifactType: 'archive', evidenceRef: `fixture:${artifactId}`, status: 'succeeded' });
  const ids = [];
  for (const artifactId of ['A', 'B', 'A', 'B']) {
    ids.push((await select(artifactId)).id);
    await pruneWork(f.store, f.workItemId);
  }
  assert.equal(new Set(ids).size, 4);
});
