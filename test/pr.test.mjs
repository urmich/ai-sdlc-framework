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

test('T-33/T-34 legacy PR policy and monitor history cannot grant new readiness or deployment permission', async t => {
  const f = await fixture(t);
  const { pr } = await adoptPr(f.store, { workItemId: f.workItemId, pr: { ...prIdentity(), prId: '17',
    url: 'https://example.invalid/project/pull/17', state: 'active', evidenceRef: 'fixture:pr' } });
  const evaluation = { environment: 'PROD', prRecordId: pr.id,
    localRepositoryPath: pr.localRepositoryPath,
    remoteRepositoryURL: pr.remoteRepositoryURL,
    sourceRevision: 'source-1', targetRevision: 'target-1',
    policyVersion: 'policy-1' };
  const facts = { workItemId: f.workItemId, prRecordId: pr.id, policyVersion: 'policy-1', sourceRevision: 'source-1',
    targetRevision: 'target-1', requiredChecks: ['check-build'], checks: [{ id: 'check-build', status: 'succeeded',
      sourceRevision: 'source-1', targetRevision: 'target-1', evidenceRef: 'fixture:check' }], providerEvidenceRef: 'fixture:policy', reviewsSatisfied: false, merged: false };
  await updatePrFacts(f.store, facts);
  let records = (await f.store.load(f.workItemId)).records;
  assert.ok(evaluateReadiness(records, evaluation, { clock: f.clock }).gaps.includes(
    'pr-observation-unverified'));
  assert.ok(evaluateReadiness(records, evaluation, { clock: f.clock }).gaps.includes(
    'check:check-build:monitor-identity-missing'));
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
  assert.ok(evaluateReadiness(records, evaluation, { clock: f.clock }).gaps.includes(
    'check:check-build:monitor-not-attached-or-verified'));
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
  assert.equal(evaluateReadiness(records, evaluation, { clock: f.clock }).ready, false);
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
  assert.equal(evaluateReadiness(records, evaluation, { clock: f.clock }).ready, false);
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
    false);
  assert.ok(evaluateReadiness(records, evaluation, { clock: f.clock }).gaps.includes(
    'pr-observation-unverified'));
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
    false);
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
    false);
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
  assert.equal(evaluateReadiness((await f.store.load(f.workItemId)).records, evaluation, { clock: f.clock }).ready, false);
  const finalNotice = await monitorNotice(f.store, { runKey });
  await monitorNotice(f.store, {
    runKey,
    deliveredRef: 'fixture:terminal-check-notice',
    noticeGeneration: finalNotice.notice.generation,
  });
  const associationKey = monitorAssociationKey({ runKey, workItemId: f.workItemId,
    prRecordId: pr.id, checkId: 'check-build' });
  const durableRecords = await f.store.records(f.workItemId);
  const retainedFacts = durableRecords.find(record => record.id === `facts-${pr.id}`);
  assert.equal(retainedFacts.checks[0].runKey, runKey);
  assert.deepEqual(retainedFacts.runMonitorRefs, [associationKey]);
  assert.deepEqual(durableRecords.filter(record =>
    [runKey, associationKey].some(key => JSON.stringify(record).includes(key)))
    .map(record => record.id), [retainedFacts.id]);
  t.diagnostic(`Retained consumer: ${retainedFacts.id}; checks[0].runKey=${runKey}; runMonitorRefs[0]=${associationKey}`);
  const terminalMonitor = await readActiveMonitor(f.store, runKey);
  await assert.rejects(pruneMonitor(f.store, { runKey }), { code: 'MONITOR' });
  assert.deepEqual(await readActiveMonitor(f.store, runKey), terminalMonitor);
  const releasedFacts = await updatePrFacts(f.store, { ...facts, checks: [] });
  assert.deepEqual(releasedFacts.requiredChecks, facts.requiredChecks);
  assert.deepEqual(releasedFacts.runMonitorRefs, []);
  assert.equal(evaluateReadiness((await f.store.load(f.workItemId)).records,
    evaluation, { clock: f.clock }).ready, false);
  assert.equal((await pruneMonitor(f.store, { runKey })).archived, true);
  assert.equal(await readActiveMonitor(f.store, runKey), null);
  assert.deepEqual(await readMonitor(f.store, runKey), terminalMonitor);
  const archivedFacts = await updatePrFacts(f.store, facts);
  assert.equal(archivedFacts.checks[0].runKey, runKey);
  assert.deepEqual(archivedFacts.runMonitorRefs, []);
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

test('T-104 same-name checks in one run cannot borrow another producer or result association', async t => {
  const f = await fixture(t);
  await f.runGit('commit', '--allow-empty', '-qm', 'Create target revision');
  const targetRevision = await f.runGit('rev-parse', 'HEAD');
  await f.runGit('commit', '--allow-empty', '-qm', 'Create source revision');
  const sourceRevision = await f.runGit('rev-parse', 'HEAD');
  const repository = await observeFixtureRepository(f, {
    provider: 'azure-devops', connection: 'fixture', repositoryRef: 'repository-id',
    revision: sourceRevision,
  });
  const prDetails = {
    repositoryId: 'primary', localRepositoryPath: f.repo,
    remoteRepositoryURL: repository.remoteRepositoryURL,
    provider: 'azure-devops', connection: 'fixture',
    repositoryRef: 'repository-id', pullRequestRef: 'pr-two-checks',
    sourceBranchRef: 'refs/heads/feature/fixture',
    targetBranchRef: 'refs/heads/trunk',
    sourceRevision, targetRevision, state: 'active',
    observedAt: new Date(f.clock.now()).toISOString(),
    evidenceRef: 'fixture:pr-two-checks',
  };
  f.store.verifyPullRequest = () => ({
    canonicalLocalRepositoryPath: f.repo,
    verifiedRemoteRepositoryURL: repository.remoteRepositoryURL,
    verifiedProvider: 'azure-devops', verifiedConnection: 'fixture',
    verifiedRepositoryRef: 'repository-id', verifiedPullRequestRef: prDetails.pullRequestRef,
    verifiedSourceBranchRef: prDetails.sourceBranchRef,
    verifiedTargetBranchRef: prDetails.targetBranchRef,
    verifiedSourceRevision: sourceRevision, verifiedTargetRevision: targetRevision,
    verifiedState: 'active', verifiedObservedAt: prDetails.observedAt,
    verifiedEvidenceRef: prDetails.evidenceRef,
  });
  const { observation: pr } = await adoptPr(f.store, {
    workItemId: f.workItemId, observation: prDetails,
  });

  const identity = { ...executionIdentity('two-checks'), attemptKind: 'not-applicable' };
  const evidenceFilePath = path.join(f.root, 'two-check-results.bin');
  const bytes = Buffer.from('Distinct check results for one execution attempt');
  await fs.writeFile(evidenceFilePath, bytes);
  const evidence = {
    reference: {
      locator: 'fixture:two-check-results',
      retrievalContext: {
        provider: 'azure-devops', connection: 'fixture',
        scopeRef: identity.scopeRef, retrievedAt: new Date(f.clock.now()).toISOString(),
      },
      sha256: digest(bytes),
    },
  };
  const checks = [
    { requiredCheckRef: 'build', checkResultRef: 'result-build',
      producerRef: identity.definitionRef },
    { requiredCheckRef: 'security', checkResultRef: 'result-security',
      producerRef: 'security-producer' },
  ].map(check => ({
    ...check, displayName: 'Verify', status: 'succeeded',
    testedRevision: sourceRevision, evidenceRef: `fixture:${check.checkResultRef}`,
    localRepositoryPath: f.repo, remoteRepositoryURL: repository.remoteRepositoryURL,
    repositoryRef: repository.repositoryRef, pullRequestRef: pr.pullRequestRef,
    sourceRevision, targetRevision,
  }));
  const monitor = await attachMonitor(f.store, {
    identity, origin: 'framework', workItemId: f.workItemId,
    schedulerAvailable: true, readAvailable: true,
  });
  const workerId = 'worker-two-checks';
  const claimed = await claimMonitor(f.store, { runKey: monitor.key, workerId });
  const poll = await beginPoll(f.store, {
    runKey: monitor.key, workerId, claimGeneration: claimed.claimGeneration,
  });
  f.store.verifyCheckResults = () => ({
    identity, status: 'succeeded',
    evidenceReference: evidence.reference, checkResults: checks,
  });
  await observeMonitor(f.store, {
    runKey: monitor.key, workerId, claimGeneration: claimed.claimGeneration,
    pollGeneration: poll.pollGeneration, identity, status: 'succeeded',
    evidence, evidenceFilePath, checkResults: checks,
  });
  await verifyMonitorLink(f.store, {
    runKey: monitor.key, adapterId: 'azure-devops',
    observation: linkObservation('two-checks'), evidenceRef: 'fixture:run-link',
  });
  const association = check => ({
    runKey: monitor.key, workItemId: f.workItemId,
    prRecordId: pr.id, prObservationKey: pr.id,
    localRepositoryPath: f.repo, remoteRepositoryURL: repository.remoteRepositoryURL,
    checkId: check.requiredCheckRef, requiredCheckRef: check.requiredCheckRef,
    checkResultRef: check.checkResultRef, producerRef: check.producerRef,
    testedRevision: sourceRevision, sourceRevision, targetRevision,
    evidenceRef: check.evidenceRef, evidence,
  });
  await associateMonitor(f.store, association(checks[0]));
  await assert.rejects(associateMonitor(f.store, {
    ...association(checks[1]), checkResultRef: checks[0].checkResultRef,
    producerRef: checks[0].producerRef,
  }), { code: 'EVIDENCE' });
  await assert.rejects(associateMonitor(f.store, association(checks[1])),
    { code: 'EVIDENCE' });
  const facts = {
    workItemId: f.workItemId, prRecordId: pr.id,
    policyVersion: 'policy-two-checks', sourceRevision, targetRevision,
    requiredChecks: ['build', 'security'],
    checks: checks.map(check => ({
      id: check.requiredCheckRef, requiredCheckRef: check.requiredCheckRef,
      checkResultRef: check.checkResultRef, producerRef: check.producerRef,
      testedRevision: sourceRevision, sourceRevision, targetRevision,
      runKey: monitor.key, identity, status: 'succeeded',
      evidenceRef: check.evidenceRef,
    })),
    providerEvidenceRef: 'fixture:policy-two-checks',
  };
  const evaluation = {
    environment: 'PROD', repositoryId: 'primary', prRecordId: pr.id,
    localRepositoryPath: f.repo, remoteRepositoryURL: repository.remoteRepositoryURL,
    prId: pr.pullRequestRef, sourceRevision, targetRevision,
    policyVersion: facts.policyVersion,
  };
  await updatePrFacts(f.store, { ...facts,
    requiredChecks: ['build'], checks: [facts.checks[0]] });
  assert.deepEqual(evaluateReadiness((await f.store.load(f.workItemId)).records,
    evaluation, { clock: f.clock }).gaps, []);
  const updated = await updatePrFacts(f.store, facts);
  assert.equal(updated.runMonitorRefs.length, 1);
  const result = evaluateReadiness((await f.store.load(f.workItemId)).records,
    evaluation, { clock: f.clock });
  assert.equal(result.ready, false);
  assert.deepEqual(result.gaps, ['check:security:monitor-not-attached-or-verified']);
});
