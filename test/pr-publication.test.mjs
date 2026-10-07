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

test('T-32 early PR creation/reuse requires publication authority, does not grant Coding, and uncertain intent prevents duplicates', async t => {
  const f = await fixture(t);
  await f.runGit('commit', '--allow-empty', '-qm', 'Create target baseline');
  const targetRevision = await f.runGit('rev-parse', 'HEAD');
  await f.runGit('branch', 'trunk', targetRevision);
  await f.runGit('update-ref', 'refs/remotes/origin/trunk', targetRevision);
  await f.runGit('add', '.sdlc');
  await f.runGit('commit', '-qm', 'Preserve the fixture documentation for publication');
  const sourceRevision = await f.runGit('rev-parse', 'HEAD');
  const { repositoryObservation, effect } = await publicationFixture(f);
  const input = { workItemId: f.workItemId, ...prIdentity(), sourceRevision, targetRevision,
    remoteSourceRevision: sourceRevision, matches: [],
    localRepositoryPath: f.repo, remoteRepositoryURL: repositoryObservation.remoteRepositoryURL,
    sourceRepositoryURL: repositoryObservation.remoteRepositoryURL, target: effect.target };
  await assert.rejects(preparePr(f.store, input), { code: 'AUTHORITY' });
  await assert.rejects(grant(f, 'pr-publication', {
    repositoryId: 'primary', sourceRef: input.sourceRef, targetRef: input.targetRef, draft: true,
  }), { code: 'INPUT' });
  await assert.rejects(grant(f, 'pr-publication', {
    ...effect, remoteRepositoryURL: 'https://example.invalid/unrelated.git',
  }), { code: 'EVIDENCE' });
  await grant(f, 'pr-publication', effect);
  const prepared = await preparePr(f.store, input);
  assert.equal(prepared.action, 'prepare-operation');
  assert.equal((await preparePr(f.store, input)).action, 'reconcile-before-create');
  assert.equal(evaluatePolicy(await f.store.load(f.workItemId), {
    class: 'pr-create', repositoryId: 'primary', sourceRef: input.sourceRef,
    targetRef: input.targetRef, draft: true,
  }, { clock: f.clock }).allowed, false);
  assert.equal(evaluatePolicy(await f.store.load(f.workItemId), { class: 'code', repositoryId: 'primary', paths: ['code.mjs'] }).allowed, false);
  const pushCommand = 'git push --no-follow-tags --no-recurse-submodules origin refs/heads/feature/fixture:refs/heads/feature/fixture';
  const push = await grantPush(f, pushCommand, { repositoryObservation });
  await assert.rejects(prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId,
    action: { ...push.action, earlyDraft: true, draft: true, targetRevision,
      baseRef: 'refs/heads/trunk~1', paths: [`.sdlc/work-items/${f.workItemId}.json`] },
    request: { toolName: 'bash', toolArgs: { command: pushCommand }, cwd: f.repo },
    correlationKey: 'invalid-early-base', intent: 'Attempt an expression-based early draft comparison' }), { code: 'INPUT' });
  await observeHostedBase(f, repositoryObservation, 'refs/heads/trunk', targetRevision);
  const earlyPush = await prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId,
    action: { ...push.action, earlyDraft: true, draft: true, targetRevision,
      baseRef: 'refs/heads/trunk',
      paths: [`.sdlc/work-items/${f.workItemId}.json`] },
    request: { toolName: 'bash', toolArgs: { command: pushCommand }, cwd: f.repo },
    correlationKey: 'early-document-push', intent: 'Push the authorized document-only draft source' });
  assert.equal(earlyPush.operation.status, 'prepared');
  const { operation } = await prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId,
    action: { class: 'pr-create', repositoryId: 'primary', sourceRef: input.sourceRef, targetRef: input.targetRef,
      sourceRevision, targetRevision, draft: true, earlyDraft: true, target: effect.target,
      localRepositoryPath: effect.localRepositoryPath, remoteRepositoryURL: effect.remoteRepositoryURL,
      sourceRepositoryURL: effect.sourceRepositoryURL,
      paths: [`.sdlc/work-items/${f.workItemId}.json`] },
    request: { toolName: 'fixture_create_pr', toolArgs: { source: input.sourceRef, target: input.targetRef }, cwd: f.repo },
    correlationKey: 'pr-create-1', intent: 'Create the explicitly requested draft documentation PR' });
  registerFixtureProviderRequest(f, operation);
  await markDispatching(f.store, f.workItemId, operation.id);
  await recordOperation(f.store, { workItemId: f.workItemId, operationId: operation.id, status: 'uncertain' });
  await assert.rejects(markDispatching(f.store, f.workItemId, operation.id), { code: 'UNCERTAIN' });
  const observedResult = registerFixtureProviderResult(f, operation, {
    providerResultId: 'PR-17',
    result: { prId: 'PR-17', sourceRef: input.sourceRef, targetRef: input.targetRef,
      sourceRevision, targetRevision, draft: true,
      sourceRepositoryURL: effect.sourceRepositoryURL,
      targetRepositoryURL: effect.remoteRepositoryURL },
  });
  await recordOperation(f.store, { workItemId: f.workItemId, operationId: operation.id,
    status: 'succeeded', observedResult }, { reconcile: true });
  const pr = { ...prIdentity(), sourceRevision, targetRevision, prId: 'PR-17',
    url: 'https://scm.example.invalid/repository/pull/17', state: 'active', evidenceRef: 'fixture:provider-pr' };
  await adoptPr(f.store, { workItemId: f.workItemId, pr, intentId: prepared.intent.id, operationId: operation.id });
  const observation = { repositoryId: 'primary', localRepositoryPath: f.repo,
    remoteRepositoryURL: effect.remoteRepositoryURL, provider: pr.provider,
    connection: pr.connection, repositoryRef: repositoryObservation.repositoryRef,
    pullRequestRef: pr.prId, sourceRepositoryURL: effect.sourceRepositoryURL,
    sourceBranchRef: input.sourceRef, targetBranchRef: input.targetRef,
    sourceRevision, targetRevision, state: 'active',
    observedAt: new Date(f.clock.now()).toISOString(),
    evidenceRef: 'fixture:verified-provider-pr' };
  await assert.rejects(adoptPr(f.store, {
    workItemId: f.workItemId, observation, adapterObservation: observedResult,
  }), { code: 'ADAPTER' });
  f.store.verifyPullRequest = ({ provider, adapterObservation, localRepositoryPath,
    remoteRepositoryURL }) => {
    const verified = f.providerResults.get(operation.id)?.observation;
    assert.equal(adapterObservation.fixtureResultId, verified.providerResultId);
    assert.equal(provider, observation.provider);
    assert.equal(localRepositoryPath, f.repo);
    assert.equal(remoteRepositoryURL, repositoryObservation.remoteRepositoryURL);
    return { canonicalLocalRepositoryPath: f.repo,
      verifiedRemoteRepositoryURL: repositoryObservation.remoteRepositoryURL,
      verifiedProvider: repositoryObservation.provider,
      verifiedConnection: repositoryObservation.connection,
      verifiedRepositoryRef: repositoryObservation.repositoryRef,
      verifiedPullRequestRef: verified.result.prId,
      verifiedSourceRepositoryURL: verified.result.sourceRepositoryURL,
      verifiedSourceBranchRef: verified.result.sourceRef,
      verifiedTargetBranchRef: verified.result.targetRef,
      verifiedSourceRevision: verified.result.sourceRevision,
      verifiedTargetRevision: verified.result.targetRevision,
      verifiedState: observation.state, verifiedObservedAt: observation.observedAt,
      verifiedEvidenceRef: observation.evidenceRef };
  };
  const adopted = await adoptPr(f.store, {
    workItemId: f.workItemId, observation, adapterObservation: observedResult,
  });
  assert.equal(adopted.observation.type, 'pr-observation');
  assert.equal(adopted.observation.remoteRepositoryURL, effect.remoteRepositoryURL);
  assert.equal((await preparePr(f.store, input)).action, 'reuse');
  assert.equal(evaluatePolicy(await f.store.load(f.workItemId), { class: 'merge', repositoryId: 'primary' }).allowed, false);
});

test('T-32 once-scoped PR publication authority cannot publish a second PR operation', async t => {
  const f = await fixture(t);
  await reviewedCoding(f);
  const { effect } = await publicationFixture(f, {
    scope: { actions: ['pr-create'] }, lifetime: { kind: 'once' },
  });
  await grant(f, 'pr-publication', effect);
  const action = await prCreateAction(f, effect);
  const firstRequest = { toolName: 'fixture_create_pr', toolArgs: { attempt: 1 }, cwd: f.repo };
  const first = await prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId,
    action, request: firstRequest, correlationKey: 'once-pr-1', intent: 'Use the once-only PR publication grant' });
  registerFixtureProviderRequest(f, first.operation);
  await markDispatching(f.store, f.workItemId, first.operation.id);
  const observedResult = registerFixtureProviderResult(f, first.operation, {
    providerResultId: 'PR-1',
    result: { prId: 'PR-1', sourceRef: action.sourceRef, targetRef: action.targetRef,
      sourceRevision: action.sourceRevision, targetRevision: action.targetRevision,
      draft: true, sourceRepositoryURL: action.sourceRepositoryURL,
      targetRepositoryURL: action.remoteRepositoryURL },
  });
  await recordOperation(f.store, { workItemId: f.workItemId, operationId: first.operation.id,
    status: 'succeeded', observedResult });
  await assert.rejects(prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId,
    action, request: { toolName: 'fixture_create_pr', toolArgs: { attempt: 2 }, cwd: f.repo },
    correlationKey: 'once-pr-2', intent: 'Attempt a second PR publication' }), { code: 'GATE' });
});

test('T-32 prerequisite push does not consume once-only PR publication authority', async t => {
  const f = await fixture(t);
  await reviewedCoding(f);
  const { effect, repositoryObservation } = await publicationFixture(f, {
    lifetime: { kind: 'once' },
  });
  const publication = await grant(f, 'pr-publication', effect);
  await grantPush(f, undefined, { repositoryObservation });
  await prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId,
    action: await pushAction(f),
    request: { toolName: 'bash', toolArgs: { command: 'git push --no-follow-tags --no-recurse-submodules origin refs/heads/feature/fixture:refs/heads/feature/fixture' }, cwd: f.repo },
    correlationKey: 'prerequisite-push', intent: 'Publish the source branch before creating the PR' });
  assert.ok(!(await f.store.records(f.workItemId)).some(record =>
    record.type === 'reservation' && record.eventId === publication.event.id));
  await prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId,
    action: await prCreateAction(f, effect),
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
  const { effect, repositoryObservation } = await publicationFixture(f, {
    lifetime: { kind: 'once' },
  });
  const publication = await grant(f, 'pr-publication', effect);
  const command = 'git push --no-follow-tags --no-recurse-submodules origin refs/heads/feature/fixture:refs/heads/feature/fixture';
  const push = await grantPush(f, command, { repositoryObservation });
  await observeHostedBase(f, repositoryObservation, 'refs/heads/trunk', targetRevision);
  const action = { ...push.action, earlyDraft: true, draft: true,
    baseRef: 'refs/heads/trunk', targetRevision,
    paths: [`.sdlc/work-items/${f.workItemId}.json`] };
  const first = await prepareOperation(f.store, { workItemId: f.workItemId,
    sessionId: f.sessionId, action,
    request: { toolName: 'bash', toolArgs: { command }, cwd: f.repo },
    correlationKey: 'early-push-once-1', intent: 'Use once-only PR authority for the early document push' });
  registerFixtureProviderRequest(f, first.operation);
  assert.ok((await f.store.records(f.workItemId)).some(record =>
    record.type === 'reservation' && record.eventId === publication.event.id));
  await markDispatching(f.store, f.workItemId, first.operation.id);
  const observedResult = registerFixtureProviderResult(f, first.operation, {
    providerResultId: `origin:${action.targetRef}`,
    result: { destination: action.target, ref: action.targetRef,
      revision: action.sourceRevision, published: true,
      remoteRepositoryURL: action.remoteRepositoryURL,
      remoteUrlDigest: action.remoteUrlDigest },
  });
  await recordOperation(f.store, { workItemId: f.workItemId, operationId: first.operation.id,
    status: 'succeeded', observedResult });
  await assert.rejects(prepareOperation(f.store, { workItemId: f.workItemId,
    sessionId: f.sessionId, action,
    request: { toolName: 'bash', toolArgs: { command, attempt: 2 }, cwd: f.repo },
    correlationKey: 'early-push-once-2', intent: 'Attempt to reuse early publication authority' }), { code: 'GATE' });
});
