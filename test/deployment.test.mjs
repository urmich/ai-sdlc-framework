import {
  test, assert, path, fs, fixture,
  coding, completeReview, finishFixtureOperation, fixtureArtifact, fixtureBuild,
  fixtureDeployment, grant, observeFixtureRepository, prepareFixtureDeployment, registerFixtureProviderRequest,
  testDefinitions, orient, startCycle, recordArtifact, recordTest,
  stagingHandoff, readJson, writeJson, prepareOperation, markDispatching,
  pruneWork, recordOperation, evaluatePolicy, currentCycle, currentTestEvidence,
  hasStagingCompletion, hasStageCompletion, latestStagingResultEvent, stagePassed, gate,
  loadConfig, synchronizeTestPlan, testSpecificationDigest, formatAudit, recordAudit,
  nextAction, stagingExecutionGuidance,
} from './deployment-support.mjs';

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
