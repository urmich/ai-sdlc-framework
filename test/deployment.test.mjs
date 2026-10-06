import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import { fixture, coding, completeReview, finishFixtureOperation, fixtureArtifact,
  fixtureBuild, fixtureDeployment, grant, observeFixtureRepository, prepareFixtureDeployment,
  registerFixtureProviderRequest, testDefinitions, orient } from './helpers.mjs';
import { startCycle, recordArtifact, recordTest, stagingHandoff } from '../src/validation.mjs';
import { readJson, writeJson } from '../src/files.mjs';
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
  const f = await coding(await fixture(t, { compactPath: true }));
  const configuration = { defaultBranch: 'refs/heads/main', environments: {
    DEV: { target: 'dev-target', configDigest: 'configuration-1', allowedStages: ['DEV'] },
    STAGING: { target: 'staging-target', configDigest: 'configuration-1',
      allowedStages: ['STAGING'],
      execution: { owner: 'user', locations: ['authorized-machine'] } },
  } };
  await writeJson(path.join(f.repo, '.sdlc/config.json'), configuration);
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Fixture deployment candidate');
  await observeFixtureRepository(f);
  const { cycle } = await startCycle(f.store, { workItemId: f.workItemId, tests: testDefinitions(), configDigest: 'configuration-1', cause: 'new candidate' });
  const binding = { cycleId: cycle.id, candidateDigest: cycle.candidateDigest, testSpecDigest: cycle.testSpecDigest, configDigest: cycle.configDigest };
  for (const testId of ['T-unit', 'T-integration']) await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id, testId,
    status: 'Passed', owner: 'agent', host: 'local', expectedMet: true, evidenceRef: 'fixture:local-pass' });
  await completeReview(f, cycle);
  const broadDev = await grant(f, 'dev-authorization', { ...binding, target: 'dev-target', completedStage: 'review' });
  const producer = await fixtureBuild(f, cycle);
  const deploy = async environment => {
    const target = environment === 'DEV' ? 'dev-target' : 'staging-target';
    const artifactId = `artifact-${environment}`;
    const selected = await fixtureArtifact(f, cycle, producer, { artifactId, environment });
    const operation = await fixtureDeployment(f, cycle, selected, { target });
    return { operation, artifactId, selected, target };
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
  await finishFixtureOperation(f, devTest.operation);
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
  assert.equal(evaluatePolicy(await f.store.load(f.workItemId), { class: 'recommend-staging', repositoryId: 'primary' }).allowed, false);
  await grant(f, 'stage-completion', { ...binding, target: 'dev-target',
    deploymentId: dev.operation.id, completedStage: 'DEV' });
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
  const replacement = await prepareFixtureDeployment(f, cycle, staging.selected, {
    target: staging.target, correlationKey: 'deploy-STAGING-replacement',
  });
  registerFixtureProviderRequest(f, replacement.operation);
  await markDispatching(f.store, f.workItemId, replacement.operation.id);
  let replacementState = await f.store.load(f.workItemId);
  assert.equal(hasStagingCompletion(replacementState.records, currentCycle(replacementState.records, replacementState.checkpoint), f.clock), false);
  await finishFixtureOperation(f, replacement.operation, { alreadyDispatched: true });
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
  await f.runGit('commit', '--allow-empty', '-qm', `Audit STAGING confirmations\n\n${audit.trailers}`);
  await recordAudit(f.store, { workItemId: f.workItemId, repositoryId: 'primary',
    commit: await f.runGit('rev-parse', 'HEAD') });
  const pruned = await pruneWork(f.store, f.workItemId);
  const retainedStagingResults = (await f.store.records(f.workItemId)).filter(event =>
    event.type === 'event' && event.kind === 'staging-result' &&
    event.effect.deploymentId === replacement.operation.id);
  assert.deepEqual(retainedStagingResults.map(event => event.id), []);
  assert.ok(pruned.archived.includes(latestResult.event.id));
  const archivedResult = await readJson(path.join(f.store.workPath(f.workItemId),
    'evidence', `${latestResult.event.id}.json`));
  assert.deepEqual(archivedResult.effect, latestResult.event.effect,
    'The audit commit changes HEAD: its former result remains history, not current credit');
  replacementState = await f.store.load(f.workItemId);
  replacementCycle = currentCycle(replacementState.records, replacementState.checkpoint);
  assert.equal(replacementCycle.deployments.STAGING, undefined);
  assert.equal(stagePassed(replacementCycle, replacementState.records,
    'STAGING', f.clock), false);
  assert.deepEqual(await readJson(path.join(f.store.workPath(f.workItemId),
    'evidence', `${staging.selected.producingOperationId}.json`)), producer,
  'Cleanup preserves the complete historical producer without selecting it for the new HEAD');
  const currentStagingEvidence = replacementCycle.results['T-staging'];
  await assert.rejects(recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id,
    testId: 'T-staging', status: 'Passed', artifactId: staging.artifactId,
    deploymentId: replacement.operation.id,
    expectedMet: true, owner: 'user', host: 'authorized-machine',
    evidenceRef: 'fixture:late-same-deployment-report',
    eventId: replacementResult.event.id }), { code: 'STALE' });
  await assert.rejects(recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id, testId: 'T-staging', status: 'Passed',
    artifactId: staging.artifactId, deploymentId: staging.operation.id,
    expectedMet: true, owner: 'user', host: 'authorized-machine',
    evidenceRef: 'fixture:late-old-staging-report', eventId: result.event.id }), { code: 'STALE' });
  replacementState = await f.store.load(f.workItemId);
  replacementCycle = currentCycle(replacementState.records, replacementState.checkpoint);
  assert.equal(replacementCycle.results['T-staging'], currentStagingEvidence);
  f.clock.advance(1001);
  await synchronizeTestPlan(f.store, f.workItemId);
  assert.match(await fs.readFile(path.join(f.repo, 'docs/test-plan.md'), 'utf8'), /T-staging.*NotRun/u);
  await assert.rejects(prepareFixtureDeployment(f, cycle, staging.selected, {
    target: staging.target, correlationKey: 'stale-after-audit-commit',
  }), { code: 'STALE' });
});
test('an empty commit cannot reuse a prior deployment for environment admissions without restarting the cycle', async t => {
  const f = await coding(await fixture(t, { compactPath: true }));
  await writeJson(path.join(f.repo, '.sdlc/config.json'), {
    defaultBranch: 'refs/heads/main',
    environments: {
      DEV: { target: 'dev-target', configDigest: 'configuration-1',
        allowedStages: ['DEV'] },
      STAGING: { target: 'staging-target', configDigest: 'configuration-1',
        allowedStages: ['STAGING'],
        execution: { owner: 'user', locations: ['authorized-machine'] } },
    },
  });
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Candidate A');
  await observeFixtureRepository(f);
  const { cycle } = await startCycle(f.store, {
    workItemId: f.workItemId, tests: testDefinitions(),
    configDigest: 'configuration-1', cause: 'candidate A',
  });
  const binding = { cycleId: cycle.id, candidateDigest: cycle.candidateDigest,
    testSpecDigest: cycle.testSpecDigest, configDigest: cycle.configDigest };
  for (const testId of ['T-unit', 'T-integration']) {
    await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id,
      testId, status: 'Passed', expectedMet: true, owner: 'agent',
      host: 'local', evidenceRef: `fixture:${testId}` });
  }
  await completeReview(f, cycle);
  await grant(f, 'dev-authorization', { ...binding, target: 'dev-target',
    completedStage: 'review' });
  const producer = await fixtureBuild(f, cycle);
  const devArtifact = await fixtureArtifact(f, cycle, producer, {
    environment: 'DEV', artifactId: 'candidate-a-dev',
  });
  const devDeployment = await fixtureDeployment(f, cycle, devArtifact, {
    target: 'dev-target',
  });
  const devResult = { workItemId: f.workItemId, cycleId: cycle.id,
    testId: 'T-dev', status: 'Passed', expectedMet: true,
    artifactId: devArtifact.artifactId, deploymentId: devDeployment.id,
    owner: 'agent', host: 'development-machine' };
  await recordTest(f.store, { ...devResult, evidenceRef: 'fixture:dev-A' });
  await grant(f, 'stage-completion', { ...binding, completedStage: 'DEV',
    deploymentId: devDeployment.id, target: 'dev-target' });
  await grant(f, 'staging-promotion', { ...binding, completedStage: 'DEV',
    deploymentId: devDeployment.id, target: 'staging-target' });
  const stagingArtifact = await fixtureArtifact(f, cycle, producer, {
    environment: 'STAGING', artifactId: 'candidate-a-staging',
  });
  const stagingDeployment = await fixtureDeployment(f, cycle,
    stagingArtifact, { target: 'staging-target' });
  const stagingEffect = { ...binding, target: 'staging-target',
    deploymentId: stagingDeployment.id, artifactId: stagingArtifact.artifactId,
    testIds: ['T-staging'], outcome: 'Passed', owner: 'user',
    host: 'authorized-machine', evidenceRef: 'fixture:staging-A' };
  const stagingDecision = await grant(f, 'staging-result', stagingEffect);
  const stagingResult = { workItemId: f.workItemId, cycleId: cycle.id,
    testId: 'T-staging', status: 'Passed', expectedMet: true,
    artifactId: stagingArtifact.artifactId, deploymentId: stagingDeployment.id,
    owner: 'user', host: 'authorized-machine',
    eventId: stagingDecision.event.id };
  await recordTest(f.store, { ...stagingResult,
    evidenceRef: 'fixture:staging-test-A' });
  assert.equal((await stagingHandoff(f.store, f.workItemId)).deploymentId,
    stagingDeployment.id);
  const delayedDevTest = await prepareOperation(f.store, {
    workItemId: f.workItemId, sessionId: f.sessionId,
    action: { class: 'test', repositoryId: 'primary', environment: 'DEV',
      target: 'dev-target', configDigest: cycle.configDigest,
      testId: 'T-dev', owner: 'agent', host: 'development-machine',
      artifactId: devArtifact.artifactId, deploymentId: devDeployment.id },
    request: { toolName: 'fixture_test',
      toolArgs: { testId: 'T-dev', deploymentId: devDeployment.id,
        attempt: 'before-empty-commit' }, cwd: f.repo },
    correlationKey: 'delayed-dev-test-A',
    intent: 'Observe a result from the old commit only as history',
  });
  registerFixtureProviderRequest(f, delayedDevTest.operation);
  await markDispatching(f.store, f.workItemId, delayedDevTest.operation.id);

  const revisionA = cycle.sources[0].revision;
  await f.runGit('commit', '--allow-empty', '-qm', 'Candidate B with identical files');
  assert.notEqual(await f.runGit('rev-parse', 'HEAD'), revisionA);
  await assert.rejects(stagingHandoff(f.store, f.workItemId), { code: 'STALE' });
  await assert.rejects(grant(f, 'staging-result', {
    ...stagingEffect, evidenceRef: 'fixture:staging-B',
  }), { code: 'STALE' });
  for (const effect of [
    { ...binding, completedStage: 'DEV', deploymentId: devDeployment.id,
      target: 'dev-target' },
    { ...binding, completedStage: 'STAGING',
      deploymentId: stagingDeployment.id, target: 'staging-target' },
  ]) {
    await assert.rejects(grant(f, 'stage-completion', effect), { code: 'STALE' });
  }
  await assert.rejects(grant(f, 'staging-promotion', {
    ...binding, target: 'staging-target',
  }), { code: 'STALE' });
  await assert.rejects(grant(f, 'staging-promotion', {
    ...binding, completedStage: 'DEV',
    deploymentId: devDeployment.id, target: 'staging-target',
  }), { code: 'STALE' });
  await assert.rejects(recordTest(f.store, {
    ...devResult, evidenceRef: 'fixture:dev-B',
  }), { code: 'STALE' });
  await assert.rejects(recordTest(f.store, {
    ...stagingResult, evidenceRef: 'fixture:staging-test-B',
  }), { code: 'STALE' });
  await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id,
    testId: 'T-unit', status: 'Passed', expectedMet: true,
    owner: 'agent', host: 'local', evidenceRef: 'fixture:local-B' });
  const historicalResult = await finishFixtureOperation(f,
    delayedDevTest.operation, { alreadyDispatched: true });
  assert.equal(historicalResult.status, 'succeeded');
  assert.match(historicalResult.resultGap, /commit differs/u);

  const state = await f.store.load(f.workItemId);
  const selected = currentCycle(state.records, state.checkpoint);
  assert.equal(selected.sources[0].revision, revisionA);
  assert.equal(stagePassed(selected, state.records, 'local', f.clock), true);
  assert.equal(stagePassed(selected, state.records, 'DEV', f.clock), false);
  assert.equal(selected.deployments.DEV, undefined);
  assert.equal(selected.deployments.STAGING, undefined);
  for (const prior of [producer, devArtifact, devDeployment,
    stagingArtifact, stagingDeployment, stagingDecision.event]) {
    assert.ok(state.records.some(record => record.id === prior.id),
      `${prior.id} must remain in historical evidence`);
  }
  assert.equal(state.records.filter(record => record.type === 'event' &&
    record.kind === 'staging-result').length, 1);
  assert.equal(state.records.filter(record => record.type === 'test-evidence' &&
    record.testId === 'T-dev').length, 1);
  assert.equal(state.records.filter(record => record.type === 'test-evidence' &&
    record.testId === 'T-staging').length, 1);
});

test('T-106 a delayed test result from commit A cannot displace proven DEV results for commit B', async t => {
  const f = await coding(await fixture(t, { compactPath: true }));
  await writeJson(path.join(f.repo, '.sdlc/config.json'), {
    defaultBranch: 'refs/heads/main', environments: {
      DEV: { target: 'dev-target', configDigest: 'configuration-1',
        allowedStages: ['DEV'] },
    },
  });
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Candidate A');
  await observeFixtureRepository(f);
  const { cycle } = await startCycle(f.store, {
    workItemId: f.workItemId, tests: testDefinitions(),
    configDigest: 'configuration-1', cause: 'candidate A',
  });
  for (const testId of ['T-unit', 'T-integration']) {
    await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id,
      testId, status: 'Passed', expectedMet: true, owner: 'agent',
      host: 'local', evidenceRef: `fixture:${testId}` });
  }
  await completeReview(f, cycle);
  await grant(f, 'dev-authorization', {
    cycleId: cycle.id, candidateDigest: cycle.candidateDigest,
    testSpecDigest: cycle.testSpecDigest, configDigest: cycle.configDigest,
    target: 'dev-target', completedStage: 'review',
  });
  const buildA = await fixtureBuild(f, cycle, { correlationKey: 'build-A' });
  const artifactA = await fixtureArtifact(f, cycle, buildA, {
    artifactId: 'artifact-A', environment: 'DEV',
  });
  const deploymentA = await fixtureDeployment(f, cycle, artifactA, {
    target: 'dev-target', correlationKey: 'deployment-A',
  });
  const testAction = (artifact, deployment) => ({
    class: 'test', repositoryId: 'primary', environment: 'DEV',
    target: 'dev-target', configDigest: cycle.configDigest,
    testId: 'T-dev', owner: 'agent', host: 'development-machine',
    artifactId: artifact.artifactId, deploymentId: deployment.id,
  });
  const request = (name, deployment) => ({
    toolName: 'fixture_test', toolArgs: {
      testId: 'T-dev', deploymentId: deployment.id, attempt: name,
    }, cwd: f.repo,
  });
  const { operation: testA } = await prepareOperation(f.store, {
    workItemId: f.workItemId, sessionId: f.sessionId,
    action: testAction(artifactA, deploymentA),
    request: request('A', deploymentA), correlationKey: 'test-A',
    intent: 'Test deployment A',
  });
  registerFixtureProviderRequest(f, testA);
  await markDispatching(f.store, f.workItemId, testA.id);

  await f.runGit('commit', '--allow-empty', '-qm', 'Candidate B with identical files');
  const updated = await startCycle(f.store, {
    workItemId: f.workItemId, tests: testDefinitions(),
    configDigest: 'configuration-1', cause: 'new full commit',
  });
  assert.equal(updated.reset, false);
  assert.equal(updated.cycle.id, cycle.id);
  const buildB = await fixtureBuild(f, updated.cycle, {
    correlationKey: 'build-B',
  });
  const artifactB = await fixtureArtifact(f, updated.cycle, buildB, {
    artifactId: 'artifact-B', environment: 'DEV',
  });
  const deploymentB = await fixtureDeployment(f, updated.cycle, artifactB, {
    target: 'dev-target', correlationKey: 'deployment-B',
  });
  const { operation: testB } = await prepareOperation(f.store, {
    workItemId: f.workItemId, sessionId: f.sessionId,
    action: testAction(artifactB, deploymentB),
    request: request('B', deploymentB), correlationKey: 'test-B',
    intent: 'Test deployment B',
  });
  const completedB = await finishFixtureOperation(f, testB);
  assert.equal(completedB.status, 'succeeded');
  const beforeA = await f.store.load(f.workItemId);
  const currentB = currentCycle(beforeA.records, beforeA.checkpoint);
  assert.equal(stagePassed(currentB, beforeA.records, 'DEV', f.clock), true);
  const evidenceB = currentB.results['T-dev'];
  assert.ok(evidenceB);

  const completedA = await finishFixtureOperation(f, testA, {
    alreadyDispatched: true,
  });
  assert.equal(completedA.status, 'succeeded');
  assert.match(completedA.resultGap, /earlier candidate commit/u);
  const afterA = await f.store.load(f.workItemId);
  const currentAfterA = currentCycle(afterA.records, afterA.checkpoint);
  assert.equal(currentAfterA.results['T-dev'], evidenceB);
  assert.equal(currentAfterA.deployments.DEV, deploymentB.id);
  assert.equal(stagePassed(currentAfterA, afterA.records, 'DEV', f.clock), true);
  assert.ok(!afterA.records.some(record =>
    record.type === 'test-evidence' && record.operationId === testA.id));
});

test('T-27/T-29 failed replacements invalidate current DEV and STAGING evidence', async t => {
  const f = await coding(await fixture(t, { compactPath: true }));
  await writeJson(path.join(f.repo, '.sdlc/config.json'), {
    defaultBranch: 'refs/heads/main', environments: {
      DEV: { target: 'dev-target', configDigest: 'configuration-1',
        allowedStages: ['DEV'] },
      STAGING: { target: 'staging-target', configDigest: 'configuration-1',
        allowedStages: ['STAGING'],
        execution: { owner: 'user', locations: ['authorized-machine'] } },
    },
  });
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Fixture candidate for failed replacements');
  await observeFixtureRepository(f);
  const { cycle } = await startCycle(f.store, { workItemId: f.workItemId,
    tests: testDefinitions(), configDigest: 'configuration-1',
    cause: 'replacement validation' });
  const binding = { cycleId: cycle.id, candidateDigest: cycle.candidateDigest,
    testSpecDigest: cycle.testSpecDigest, configDigest: cycle.configDigest };
  for (const testId of ['T-unit', 'T-integration']) {
    await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id,
      testId, status: 'Passed', owner: 'agent', host: 'local',
      expectedMet: true, evidenceRef: `fixture:${testId}` });
  }
  await completeReview(f, cycle);
  await grant(f, 'dev-authorization', { ...binding, target: 'dev-target',
    completedStage: 'review' });
  const producer = await fixtureBuild(f, cycle);
  const devArtifact = await fixtureArtifact(f, cycle, producer, {
    artifactId: 'replacement-dev', environment: 'DEV',
  });
  const devDeployment = await fixtureDeployment(f, cycle, devArtifact, {
    target: 'dev-target',
  });
  const { operation: devTest } = await prepareOperation(f.store, {
    workItemId: f.workItemId, sessionId: f.sessionId,
    action: { class: 'test', repositoryId: 'primary', environment: 'DEV',
      target: 'dev-target', configDigest: cycle.configDigest,
      testId: 'T-dev', owner: 'agent', host: 'development-machine',
      artifactId: devArtifact.artifactId, deploymentId: devDeployment.id },
    request: { toolName: 'fixture_test',
      toolArgs: { testId: 'T-dev', deploymentId: devDeployment.id },
      cwd: f.repo },
    correlationKey: 'replacement-dev-test', intent: 'Test initial DEV deployment',
  });
  await finishFixtureOperation(f, devTest);
  await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id,
    testId: 'T-dev', status: 'Passed', artifactId: devArtifact.artifactId,
    deploymentId: devDeployment.id, operationId: devTest.id,
    expectedMet: true, owner: 'agent', host: 'development-machine',
    evidenceRef: 'fixture:initial-dev-test' });
  const devState = await f.store.load(f.workItemId);
  assert.equal(stagePassed(currentCycle(devState.records, devState.checkpoint),
    devState.records, 'DEV'), true);
  await grant(f, 'stage-completion', { ...binding, target: 'dev-target',
    deploymentId: devDeployment.id, completedStage: 'DEV' });
  await grant(f, 'staging-promotion', { ...binding, target: 'staging-target',
    completedStage: 'DEV', deploymentId: devDeployment.id });
  const stagingArtifact = await fixtureArtifact(f, cycle, producer, {
    artifactId: 'replacement-staging', environment: 'STAGING',
  });
  const stagingDeployment = await fixtureDeployment(f, cycle, stagingArtifact, {
    target: 'staging-target',
  });
  const stagingResult = await grant(f, 'staging-result', { ...binding,
    target: 'staging-target', deploymentId: stagingDeployment.id,
    artifactId: stagingArtifact.artifactId, testIds: ['T-staging'],
    outcome: 'Passed', owner: 'user', host: 'authorized-machine',
    evidenceRef: 'fixture:initial-staging-result' });
  await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id,
    testId: 'T-staging', status: 'Passed',
    artifactId: stagingArtifact.artifactId,
    deploymentId: stagingDeployment.id, expectedMet: true,
    owner: 'user', host: 'authorized-machine',
    evidenceRef: 'fixture:initial-staging-test',
    eventId: stagingResult.event.id });
  await grant(f, 'stage-completion', { ...binding,
    completedStage: 'STAGING', deploymentId: stagingDeployment.id,
    target: 'staging-target' });
  const initial = await f.store.load(f.workItemId);
  assert.equal(hasStagingCompletion(initial.records,
    currentCycle(initial.records, initial.checkpoint), f.clock), true);

  const failedStaging = await prepareFixtureDeployment(f, cycle,
    stagingArtifact, { target: 'staging-target',
      correlationKey: 'failed-staging-replacement' });
  registerFixtureProviderRequest(f, failedStaging.operation);
  await markDispatching(f.store, f.workItemId, failedStaging.operation.id);
  await finishFixtureOperation(f, failedStaging.operation, {
    alreadyDispatched: true, status: 'failed',
  });
  const afterStagingFailure = await f.store.load(f.workItemId);
  assert.equal(hasStagingCompletion(afterStagingFailure.records,
    currentCycle(afterStagingFailure.records,
      afterStagingFailure.checkpoint), f.clock), false);

  const replacement = await prepareFixtureDeployment(f, cycle,
    devArtifact, { target: 'dev-target',
      correlationKey: 'failed-dev-replacement' });
  registerFixtureProviderRequest(f, replacement.operation);
  await markDispatching(f.store, f.workItemId, replacement.operation.id);
  const duringReplacement = await f.store.load(f.workItemId);
  const current = currentCycle(duringReplacement.records,
    duringReplacement.checkpoint);
  assert.equal(stagePassed(current, duringReplacement.records, 'DEV'), false);
  assert.equal(hasStageCompletion(duringReplacement.records, current, 'DEV',
    f.clock), false);
  await assert.rejects(recordTest(f.store, {
    workItemId: f.workItemId, cycleId: cycle.id, testId: 'T-dev',
    status: 'Passed', artifactId: devArtifact.artifactId,
    deploymentId: replacement.operation.id, operationId: devTest.id,
    expectedMet: true, owner: 'agent', host: 'development-machine',
    evidenceRef: 'fixture:old-test-cannot-pass-new-deployment',
  }), { code: 'STALE' });
  await finishFixtureOperation(f, replacement.operation, {
    alreadyDispatched: true, status: 'failed',
  });
  const afterDevFailure = await f.store.load(f.workItemId);
  assert.equal(currentCycle(afterDevFailure.records,
    afterDevFailure.checkpoint).deployments.DEV, undefined);
  assert.equal(afterDevFailure.records.find(record =>
    record.id === replacement.operation.id)?.status, 'failed');
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
test('T-27 legacy STAGING confirmations without current deployment proof do not complete the stage', () => {
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
  assert.notEqual(currentTestEvidence(cycle, records, cycle.tests[0])?.status, 'Passed');
  assert.notEqual(currentTestEvidence(cycle, records, cycle.tests[1])?.status, 'Passed');
  assert.equal(hasStagingCompletion(records, cycle), false);
  records.push({ id: 'staging-complete', type: 'event', sequence: 3,
    kind: 'stage-completion', effect: {
      cycleId: cycle.id, candidateDigest: cycle.candidateDigest,
      testSpecDigest: cycle.testSpecDigest, configDigest: cycle.configDigest,
      completedStage: 'STAGING', deploymentId: 'deploy-1',
      target: 'staging-target' } });
  assert.equal(hasStagingCompletion(records, cycle), false);
    records.push({ id: 'event-a-new', type: 'event', sequence: 4, kind: 'staging-result', effect: {
      cycleId: cycle.id, candidateDigest: cycle.candidateDigest, testSpecDigest: cycle.testSpecDigest,
      configDigest: cycle.configDigest, deploymentId: 'deploy-1', artifactId: 'artifact-1',
      testIds: ['staging-a'], outcome: 'Passed', owner: 'user',
      host: 'authorized-machine', evidenceRef: 'fixture:event-a-new' },
      occurredAt: '2026-09-16T00:00:03.000Z' });
    records.find(record => record.id === 'evidence-a').eventId = 'event-a-new';
    assert.equal(latestStagingResultEvent(records, cycle, 'staging-a'), null);
    assert.equal(latestStagingResultEvent(records, cycle, 'staging-b'), null);
    assert.ok(records.some(record => record.id === 'event-a-new'));
    assert.ok(records.some(record => record.id === 'event-b'));
    assert.equal(hasStagingCompletion(records, cycle), false);
});

test('T-50 STAGING execution policy and legacy unproven deployment cannot grant a pass', async t => {
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
    assert.equal(preparedCycle.deployments.STAGING, undefined);
    const unverifiedDeployment = preparedState.records.find(record =>
      record.id === 'deploy-agent-staging');
    assert.equal(unverifiedDeployment.status, 'uncertain');
    assert.equal(unverifiedDeployment.resultProof, undefined);
    assert.equal(unverifiedDeployment.resultGap, 'current-result-observation-required');
    assert.equal(unverifiedDeployment.artifactId, 'artifact-agent-staging');
    await assert.rejects(stagingHandoff(f.store, f.workItemId), { code: 'EVIDENCE' });
    await assert.rejects(grant(f, 'staging-result', {
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
    }), { code: 'EVIDENCE' });
    await recordOperation(f.store, {
      workItemId: f.workItemId, operationId: 'test-agent-staging',
      status: 'succeeded', target: 'staging-target',
      requestFingerprint: 'test-agent-staging-request',
      evidenceRef: 'fixture:agent-staging-operation', expectedMet: true,
    });
    const legacyState = await f.store.load(f.workItemId);
    const legacyCycle = currentCycle(legacyState.records, legacyState.checkpoint);
    assert.equal(legacyState.records.find(record => record.id === 'test-agent-staging').status,
      'uncertain');
    assert.notEqual(currentTestEvidence(legacyCycle, legacyState.records,
      legacyCycle.tests.find(item => item.id === 'T-staging'), f.clock)?.status, 'Passed');
    assert.equal(hasStagingCompletion(legacyState.records, legacyCycle, f.clock), false);

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
    await assert.rejects(stagingHandoff(f.store, f.workItemId), { code: 'EVIDENCE' });
    await assert.rejects(grant(f, 'staging-result', {
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
    }), { code: 'EVIDENCE' });
    await assert.rejects(recordTest(f.store, {
      workItemId: f.workItemId,
      cycleId: cycle.id,
      testId: 'T-staging',
      status: 'Passed',
      evidenceRef: 'fixture:fallback-user-result',
      artifactId: 'artifact-agent-staging',
      deploymentId: 'deploy-agent-staging',
      expectedMet: true,
      owner: 'user',
      host: 'fallback-machine',
    }), { code: 'EVIDENCE' });
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
test('T-50 host-contract admission is checked against a genuinely proven STAGING deployment', async t => {
  const f = await coding(await fixture(t, { compactPath: true }));
  const planPath = path.join(f.repo, 'docs/test-plan.md');
  const plan = await fs.readFile(planPath, 'utf8');
  await fs.writeFile(planPath, plan.split('\n').map(line =>
    line.startsWith('| T-staging |') ?
      line.replace('| user | authorized-machine |',
        '| agent | staging-runner |') : line).join('\n'));
  await writeJson(path.join(f.repo, '.sdlc/config.json'), {
    defaultBranch: 'refs/heads/main',
    environments: {
      DEV: { target: 'dev-target', configDigest: 'host-contract-v1',
        allowedStages: ['DEV'] },
      STAGING: { target: 'staging-target', configDigest: 'host-contract-v1',
        allowedStages: ['STAGING'],
        execution: { owner: 'agent', locations: ['staging-runner'] } },
    },
  });
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Disposable proven host-contract candidate');
  await observeFixtureRepository(f);
  const { cycle } = await startCycle(f.store, {
    workItemId: f.workItemId, configDigest: 'host-contract-v1',
    cause: 'host-contract evidence with a complete deployment chain',
  });
  for (const testId of ['T-unit', 'T-integration']) {
    await recordTest(f.store, {
      workItemId: f.workItemId, cycleId: cycle.id, testId,
      status: 'Passed', expectedMet: true, owner: 'agent', host: 'local',
      evidenceRef: `fixture:host-contract:${testId}`,
    });
  }
  await completeReview(f, cycle);
  const binding = { cycleId: cycle.id, candidateDigest: cycle.candidateDigest,
    testSpecDigest: cycle.testSpecDigest, configDigest: cycle.configDigest };
  await grant(f, 'dev-authorization', { ...binding,
    target: 'dev-target', completedStage: 'review' });
  const producer = await fixtureBuild(f, cycle);
  const devArtifact = await fixtureArtifact(f, cycle, producer, {
    artifactId: 'host-contract-dev', environment: 'DEV',
  });
  const devDeployment = await fixtureDeployment(f, cycle, devArtifact, {
    target: 'dev-target',
  });
  await recordTest(f.store, {
    workItemId: f.workItemId, cycleId: cycle.id, testId: 'T-dev',
    status: 'Passed', expectedMet: true, owner: 'agent',
    host: 'development-machine', evidenceRef: 'fixture:host-contract-dev',
    artifactId: devArtifact.artifactId, deploymentId: devDeployment.id,
  });
  await grant(f, 'stage-completion', { ...binding, completedStage: 'DEV',
    target: 'dev-target', deploymentId: devDeployment.id });
  await grant(f, 'staging-promotion', { ...binding, completedStage: 'DEV',
    target: 'staging-target', deploymentId: devDeployment.id });
  const stagingArtifact = await fixtureArtifact(f, cycle, producer, {
    artifactId: 'host-contract-staging', environment: 'STAGING',
  });
  const deployment = await fixtureDeployment(f, cycle, stagingArtifact, {
    target: 'staging-target',
  });
  const handoff = await stagingHandoff(f.store, f.workItemId);
  assert.equal(handoff.deploymentId, deployment.id);
  assert.equal(handoff.owner, 'agent');
  const input = {
    workItemId: f.workItemId, cycleId: cycle.id, testId: 'T-staging',
    status: 'Passed', expectedMet: true,
    artifactId: stagingArtifact.artifactId, deploymentId: deployment.id,
    evidenceRef: 'fixture:host-contract-test',
  };
  await assert.rejects(recordTest(f.store, { ...input,
    owner: 'agent', host: 'unauthorized-machine' }), { code: 'HOST' });
  await grant(f, 'override', {
    rules: ['staging-execution-contract'],
    reason: 'Use the authorized user fallback for the proven deployment',
    scope: { repositoryIds: ['primary'], actions: ['test', 'staging-result'],
      environment: 'STAGING', target: 'staging-target',
      owner: 'user', host: 'fallback-machine' },
    lifetime: { kind: 'cycle', cycleId: cycle.id },
  });
  await assert.rejects(recordTest(f.store, { ...input,
    owner: 'user', host: 'unauthorized-machine' }), { code: 'HOST' });
  const result = await grant(f, 'staging-result', { ...binding,
    target: 'staging-target', deploymentId: deployment.id,
    artifactId: stagingArtifact.artifactId, testIds: ['T-staging'],
    outcome: 'Passed', owner: 'user', host: 'fallback-machine',
    evidenceRef: 'fixture:proven-host-contract-fallback' });
  await recordTest(f.store, { ...input,
    owner: 'user', host: 'fallback-machine', eventId: result.event.id });
  const state = await f.store.load(f.workItemId);
  assert.equal(stagePassed(currentCycle(state.records, state.checkpoint),
    state.records, 'STAGING', f.clock), true);
});
test('T-16 the same deployable artifact retains separate DEV and STAGING selections', async t => {
  const f = await coding(await fixture(t));
  await writeJson(path.join(f.repo, '.sdlc/config.json'), {
    defaultBranch: 'refs/heads/main',
    environments: { DEV: { target: 'dev-target', configDigest: 'v1' } },
  });
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Fixture shared artifact candidate');
  await observeFixtureRepository(f);
  const { cycle } = await startCycle(f.store, { workItemId: f.workItemId,
    tests: testDefinitions(), configDigest: 'v1', cause: 'shared artifact selection' });
  for (const testId of ['T-unit', 'T-integration']) await recordTest(f.store, {
    workItemId: f.workItemId, cycleId: cycle.id, testId, status: 'Passed',
    owner: 'agent', host: 'local', expectedMet: true, evidenceRef: `fixture:${testId}`,
  });
  await completeReview(f, cycle);
  await grant(f, 'dev-authorization', {
    cycleId: cycle.id, candidateDigest: cycle.candidateDigest,
    testSpecDigest: cycle.testSpecDigest, configDigest: cycle.configDigest,
    target: 'dev-target', completedStage: 'review',
  });
  const producer = await fixtureBuild(f, cycle);
  const dev = await fixtureArtifact(f, cycle, producer, {
    artifactId: 'shared-package', environment: 'DEV',
  });
  const staging = await fixtureArtifact(f, cycle, producer, {
    artifactId: 'shared-package', environment: 'STAGING',
  });
  assert.notEqual(dev.id, staging.id);
  const state = await f.store.load(f.workItemId);
  const current = currentCycle(state.records, state.checkpoint);
  assert.equal(state.records.find(record => record.id === current.artifacts.DEV).environment, 'DEV');
  assert.equal(state.records.find(record => record.id === current.artifacts.STAGING).environment, 'STAGING');
});
test('T-18 archived artifact selections can be reselected without immutable ID conflicts', async t => {
  const f = await coding(await fixture(t));
  await writeJson(path.join(f.repo, '.sdlc/config.json'), {
    defaultBranch: 'refs/heads/main',
    environments: { DEV: { target: 'dev-target', configDigest: 'v1' } },
  });
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Fixture artifact reselection candidate');
  await observeFixtureRepository(f);
  const { cycle } = await startCycle(f.store, { workItemId: f.workItemId,
    tests: testDefinitions(), configDigest: 'v1', cause: 'artifact reselection' });
  for (const testId of ['T-unit', 'T-integration']) await recordTest(f.store, {
    workItemId: f.workItemId, cycleId: cycle.id, testId, status: 'Passed',
    owner: 'agent', host: 'local', expectedMet: true, evidenceRef: `fixture:${testId}`,
  });
  await completeReview(f, cycle);
  await grant(f, 'dev-authorization', {
    cycleId: cycle.id, candidateDigest: cycle.candidateDigest,
    testSpecDigest: cycle.testSpecDigest, configDigest: cycle.configDigest,
    target: 'dev-target', completedStage: 'review',
  });
  const ids = [];
  for (const artifactId of ['A', 'B', 'A', 'B']) {
    const producer = await fixtureBuild(f, cycle, {
      correlationKey: `build-${artifactId}-${ids.length}`,
    });
    ids.push((await fixtureArtifact(f, cycle, producer, {
      artifactId, name: artifactId,
    })).id);
    await pruneWork(f.store, f.workItemId);
  }
  assert.equal(new Set(ids).size, 4);
});
