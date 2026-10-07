import {
  test, assert, fs, path, cli,
  coding, completeReview, fixture, fixtureArtifact, fixtureBuild,
  grant, grantPush, observeFixtureRepository, pushAction, registerFixtureProviderRequest,
  registerFixtureProviderResult, testDefinitions, preparePr, adoptPr, updatePrFacts,
  evaluateReadiness, publicationAuthority, prepareOperation, markDispatching, recordOperation,
  evaluatePolicy, associateMonitor, attachMonitor, beginPoll, claimMonitor,
  monitorAssociationKey, monitorNotice, observeMonitor, pruneMonitor, readActiveMonitor,
  readMonitor, refreshMonitorCapabilities, verifyMonitorLink, recordTest, startCycle,
  azureDevOpsScopeRef, withLock, writeJson, digest, executionIdentity,
  linkObservation, prIdentity, publicationFixture, observePushRepository, observeHostedBase,
  prCreateAction, successfulCheckMonitor, reviewedCoding,
} from './pr-support.mjs';

test('pr evaluate CLI requires the selected artifact, exact destination, current assurance, and Git HEAD', async t => {
  const f = await coding(await fixture(t));
  await writeJson(path.join(f.repo, '.sdlc/config.json'), {
    environments: { DEV: { target: 'dev-target', configDigest: 'v1' } },
  });
  await f.runGit('add', '.sdlc');
  await f.runGit('commit', '-qm', 'Fixture artifact candidate');
  await observeFixtureRepository(f);
  const { cycle } = await startCycle(f.store, {
    workItemId: f.workItemId, tests: testDefinitions(),
    configDigest: 'v1', cause: 'artifact readiness from CLI',
  });
  for (const testId of ['T-unit', 'T-integration']) {
    await recordTest(f.store, {
      workItemId: f.workItemId, cycleId: cycle.id, testId,
      status: 'Passed', expectedMet: true, owner: 'agent',
      host: 'local', evidenceRef: `fixture:${testId}`,
    });
  }
  await completeReview(f, cycle);
  await grant(f, 'dev-authorization', {
    cycleId: cycle.id, candidateDigest: cycle.candidateDigest,
    testSpecDigest: cycle.testSpecDigest, configDigest: cycle.configDigest,
    target: 'dev-target', completedStage: 'review',
  });
  const producer = await fixtureBuild(f, cycle);
  const artifact = await fixtureArtifact(f, cycle, producer);
  const urlA = artifact.remoteRepositoryURL;
  const urlB = 'https://example.invalid/other.git';
  assert.notEqual(urlA, urlB);
  const evaluate = (identity = {}) => cli(f, ['pr', 'evaluate', '--work-item', f.workItemId], {
    environment: 'DEV', repositoryId: 'primary',
    requireArtifact: true, artifactId: artifact.artifactId,
    localRepositoryPath: f.repo, remoteRepositoryURL: urlA,
    ...identity,
  });
  const current = await evaluate();
  assert.equal(current.code, 0);
  assert.equal(current.json.ready, true);
  assert.equal(current.json.verdict, 'not-applicable');
  assert.deepEqual(current.json.gaps, []);

  for (const [scenario, identity] of [
    ['different hosted URL', { remoteRepositoryURL: urlB }],
    ['missing checkout path', { localRepositoryPath: undefined }],
    ['missing hosted URL', { remoteRepositoryURL: undefined }],
  ]) {
    const result = await evaluate(identity);
    assert.equal(result.code, 0, scenario);
    assert.equal(result.json.ready, false, scenario);
    assert.equal(result.json.verdict, 'unverified', scenario);
    assert.deepEqual(result.json.gaps,
      ['current-deployable-artifact-unverified'], scenario);
  }

  await f.store.transaction(f.workItemId, tx => {
    const selected = tx.get(artifact.id);
    selected.producingAttemptCapability = 'distinct';
    selected.producingAttemptRef = '5';
    selected.producingExecution.attemptKind = 'known';
    selected.producingExecution.attemptRef = '5';
    tx.put(selected);
  });
  const stale = await evaluate();
  assert.equal(stale.code, 0);
  assert.equal(stale.json.ready, false);
  assert.equal(stale.json.verdict, 'unverified');
  assert.deepEqual(stale.json.gaps, ['current-deployable-artifact-unverified']);

  await f.store.transaction(f.workItemId, tx => {
    const selected = tx.get(artifact.id);
    selected.producingAttemptCapability = artifact.producingAttemptCapability;
    selected.producingAttemptRef = artifact.producingAttemptRef;
    selected.producingExecution = artifact.producingExecution;
    tx.put(selected);
  });
  assert.equal((await evaluate()).json.ready, true);

  const producerB = await fixtureBuild(f, cycle, {
    pipeline: 'fixture-build-B', correlationKey: 'build-DEV-B',
  });
  const artifactB = await fixtureArtifact(f, cycle, producerB, {
    artifactId: 'fixture-package-B', name: 'package-B',
  });
  assert.notEqual(artifactB.artifactRef, artifact.artifactRef);
  const selectedCycle = () => f.store.load(f.workItemId).then(state =>
    state.records.find(record => record.id === cycle.id));
  assert.equal((await selectedCycle()).artifacts.DEV, artifactB.id);
  const currentB = await evaluate({ artifactId: artifactB.artifactId });
  assert.equal(currentB.code, 0);
  assert.equal(currentB.json.ready, true);
  assert.deepEqual(currentB.json.gaps, []);
  for (const [scenario, identity] of [
    ['superseded artifact A', {}],
    ['STAGING without a selected artifact', {
      environment: 'STAGING', artifactId: artifactB.artifactId,
    }],
  ]) {
    const result = await evaluate(identity);
    assert.equal(result.code, 0, scenario);
    assert.equal(result.json.ready, false, scenario);
    assert.deepEqual(result.json.gaps,
      ['current-deployable-artifact-unverified'], scenario);
  }

  const stagingA = await fixtureArtifact(f, cycle, producerB, {
    environment: 'STAGING', artifactId: 'fixture-staging-A', name: 'staging-package-A',
  });
  const stagingB = await fixtureArtifact(f, cycle, producerB, {
    environment: 'STAGING', artifactId: 'fixture-staging-B', name: 'staging-package-B',
  });
  assert.equal((await selectedCycle()).artifacts.STAGING, stagingB.id);
  const prodInput = { environment: 'PROD', repositoryId: 'primary',
    requireArtifact: true, artifactId: stagingB.artifactId,
    localRepositoryPath: f.repo, remoteRepositoryURL: urlA };
  const prodGaps = ['qualifying-pr-missing', 'provider-policy-or-check-metadata-unavailable'];
  const prod = evaluateReadiness((await f.store.load(f.workItemId)).records,
    prodInput, { cycle: await selectedCycle(), clock: f.clock });
  assert.deepEqual(prod.gaps, prodGaps);
  assert.equal(prod.ready, false);
  assert.deepEqual(prod.permissions, { publish: false, merge: false, deploy: false });
  const prodCli = await evaluate({ environment: 'PROD', artifactId: stagingB.artifactId });
  assert.equal(prodCli.code, 0);
  assert.deepEqual(prodCli.json.gaps, prodGaps);
  assert.equal(prodCli.json.ready, false);
  assert.deepEqual(prodCli.json.permissions, prod.permissions);
  for (const artifactId of [artifactB.artifactId, stagingA.artifactId]) {
    const result = await evaluate({ environment: 'PROD', artifactId });
    assert.equal(result.code, 0, artifactId);
    assert.deepEqual(result.json.gaps,
      ['current-deployable-artifact-unverified', ...prodGaps], artifactId);
  }

  const headBeforeUrlChange = await f.runGit('rev-parse', 'HEAD');
  await f.runGit('remote', 'set-url', 'origin', urlB);
  assert.equal(await f.runGit('rev-parse', 'HEAD'), headBeforeUrlChange);
  for (const identity of [
    { artifactId: artifactB.artifactId },
    { environment: 'PROD', artifactId: stagingB.artifactId },
  ]) {
    const staleUrl = await evaluate(identity);
    assert.notEqual(staleUrl.code, 0);
    assert.equal(staleUrl.json.error.code, 'STALE');
    assert.match(staleUrl.json.error.message, /hosted URL differs from the current Git fetch destination/u);
  }
  await f.runGit('remote', 'set-url', 'origin', urlA);
  assert.equal((await evaluate({ artifactId: artifactB.artifactId })).json.ready, true);

  await f.store.transaction(f.workItemId, tx => {
    const selected = tx.get(cycle.id);
    selected.assuranceInvalidated = true;
    tx.put(selected);
  });
  assert.equal((await selectedCycle()).artifacts.DEV, artifactB.id);
  const invalidated = await evaluate({ artifactId: artifactB.artifactId });
  assert.equal(invalidated.code, 0);
  assert.equal(invalidated.json.ready, false);
  assert.deepEqual(invalidated.json.gaps, ['current-deployable-artifact-unverified']);

  await f.store.transaction(f.workItemId, tx => {
    const selected = tx.get(cycle.id);
    selected.artifacts = {};
    tx.put(selected);
  });
  assert.deepEqual((await selectedCycle()).artifacts, {});
  const emptyInvalidated = await evaluate({ artifactId: artifactB.artifactId });
  assert.equal(emptyInvalidated.code, 0);
  assert.equal(emptyInvalidated.json.ready, false);
  assert.deepEqual(emptyInvalidated.json.gaps,
    ['current-deployable-artifact-unverified']);

  await f.store.transaction(f.workItemId, tx => {
    const selected = tx.get(cycle.id);
    selected.assuranceInvalidated = false;
    tx.put(selected);
  });
  assert.equal((await selectedCycle()).artifacts.DEV, artifactB.id);
  assert.equal((await evaluate({ artifactId: artifactB.artifactId })).json.ready, true);

  await f.runGit('commit', '--allow-empty', '-qm', 'Same files at a new commit');
  assert.notEqual(await f.runGit('rev-parse', 'HEAD'), cycle.sources[0].revision);
  assert.equal((await selectedCycle()).sources[0].revision, cycle.sources[0].revision);
  assert.equal((await selectedCycle()).artifacts.DEV, undefined);
  assert.ok((await f.store.load(f.workItemId)).records.some(record =>
    record.id === artifactB.id && record.sourceRevision === cycle.sources[0].revision));
  const staleHead = await evaluate({ artifactId: artifactB.artifactId });
  assert.notEqual(staleHead.code, 0);
  assert.equal(staleHead.json.error.code, 'STALE');
});
