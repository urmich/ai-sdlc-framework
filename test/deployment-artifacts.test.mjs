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
