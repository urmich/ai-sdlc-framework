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
