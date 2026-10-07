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

test('T-103 an unproven submitted PR operation cannot reconcile a legacy publication intent', async t => {
  const f = await fixture(t);
  await reviewedCoding(f);
  const { effect } = await publicationFixture(f);
  await grant(f, 'pr-publication', effect);
  const action = await prCreateAction(f, effect);
  const input = { workItemId: f.workItemId, provider: 'azure-devops',
    connection: 'fixture', repositoryId: 'primary', sourceRef: action.sourceRef,
    targetRef: action.targetRef, sourceRevision: action.sourceRevision,
    targetRevision: action.targetRevision, remoteSourceRevision: action.sourceRevision,
    draft: true, localRepositoryPath: effect.localRepositoryPath,
    remoteRepositoryURL: effect.remoteRepositoryURL,
    sourceRepositoryURL: effect.sourceRepositoryURL, target: effect.target, matches: [] };
  const prepared = await preparePr(f.store, input);
  const { operation } = await prepareOperation(f.store, {
    workItemId: f.workItemId, sessionId: f.sessionId, action,
    request: { toolName: 'fixture_create_pr', toolArgs: { source: action.sourceRef }, cwd: f.repo },
    correlationKey: 'unverified-pr-result', intent: 'Create a PR whose result still needs verification',
  });
  await markDispatching(f.store, f.workItemId, operation.id);
  const submitted = await recordOperation(f.store, {
    workItemId: f.workItemId, operationId: operation.id,
    status: 'submitted', handle: 'PR-unverified',
    requestFingerprint: operation.requestFingerprint,
    correlationKey: operation.correlationKey,
  });
  assert.equal(submitted.resultProof, undefined);
  await assert.rejects(adoptPr(f.store, {
    workItemId: f.workItemId, intentId: prepared.intent.id, operationId: operation.id,
    pr: { ...prIdentity(), sourceRevision: action.sourceRevision,
      targetRevision: action.targetRevision, prId: 'PR-unverified',
      url: 'https://scm.example.invalid/repository/pull/unverified',
      state: 'active', evidenceRef: 'fixture:unverified-pr' },
  }), { code: 'EVIDENCE' });
});

test('T-101 verified push URL B needs separate push and PR consent without dispatch', async t => {
  const f = await fixture(t);
  await reviewedCoding(f);
  const fetch = (await publicationFixture(f)).repositoryObservation;
  const pushURL = 'git@git.example.invalid:team/repository.git';
  const otherPushURL = 'git@git.example.invalid:team/other.git';
  await f.runGit('remote', 'set-url', '--push', 'origin', pushURL);
  const command = 'git push --no-follow-tags --no-recurse-submodules origin refs/heads/feature/fixture:refs/heads/feature/fixture';
  const push = await pushAction(f, command);
  const request = { toolName: 'bash', toolArgs: { command }, cwd: f.repo };
  const prepare = (action, correlationKey) => prepareOperation(f.store, {
    workItemId: f.workItemId, sessionId: f.sessionId, action, request,
    correlationKey, intent: 'Prepare only, without dispatching or publishing',
  });
  const B = {
    workItemId: f.workItemId, repositoryId: 'primary', pushURL: true,
    selectedRemoteName: 'origin', localRepositoryPath: f.repo,
    remoteRepositoryURL: pushURL, provider: fetch.provider,
    connection: fetch.connection, repositoryRef: fetch.repositoryRef,
    revision: await f.runGit('rev-parse', 'HEAD'),
    observedAt: new Date(f.clock.now()).toISOString(),
    evidenceRef: 'fixture:host-verified-push-repository',
  };
  const { effect: fetchPublication } = await publicationFixture(f);
  const AConsent = await grant(f, 'pr-publication', fetchPublication);
  const pushPublication = {
    ...fetchPublication, remoteRepositoryURL: pushURL,
    sourceRepositoryURL: pushURL,
  };
  await assert.rejects(grant(f, 'pr-publication', pushPublication, {
    prepared: true,
  }), { code: 'EVIDENCE' });
  await assert.rejects(grant(f, 'permission', {
    grant: 'push', target: push.target, remoteUrlDigest: push.remoteUrlDigest,
    sourceRef: push.sourceRef, targetRef: push.targetRef,
    sourceRevision: push.sourceRevision, force: false, delete: false,
    localRepositoryPath: f.repo, remoteRepositoryURL: pushURL,
  }), { code: 'EVIDENCE' });
  await assert.rejects(prepare(push, 'fetch-only'), { code: 'GATE' });
  f.repositoryVerifications.set(pushURL, {
    canonicalLocalRepositoryPath: f.repo, verifiedRemoteRepositoryURL: pushURL,
    verifiedProvider: B.provider, verifiedConnection: B.connection,
    verifiedRepositoryRef: B.repositoryRef, verifiedRevision: B.revision,
    verifiedObservedAt: B.observedAt, verifiedEvidenceRef: B.evidenceRef,
  });
  const verifiedB = await f.store.observeRepository(B);
  assert.equal(verifiedB.remoteRepositoryURL, pushURL);
  assert.equal((await f.store.currentRepositoryObservation(f.workItemId,
    'primary')).observation.id, fetch.id);
  assert.equal(publicationAuthority(await f.store.records(f.workItemId), {
    ...push, class: 'push', draft: true, targetRef: 'refs/heads/trunk',
  }, f.clock), undefined, 'Observation B does not create PR publication authority');
  assert.equal(publicationAuthority(await f.store.records(f.workItemId), {
    ...push, class: 'pr-create', draft: true, targetRef: 'refs/heads/trunk',
  }, f.clock), undefined, 'Consent to publish a PR at A does not transfer to B');
  assert.equal(publicationAuthority(await f.store.records(f.workItemId), {
    class: 'pr-create', ...fetchPublication,
  }, f.clock)?.id, AConsent.event.id);
  await assert.rejects(grant(f, 'pr-publication', {
    ...pushPublication, remoteRepositoryURL: otherPushURL,
    sourceRepositoryURL: otherPushURL,
  }, { prepared: true }), { code: 'EVIDENCE' });
  const BPublication = await grant(f, 'pr-publication', pushPublication, {
    prepared: true,
    input: 'I authorize PR publication only for the verified push URL B.',
  });
  assert.equal(BPublication.decision.kind, 'pr-publication');
  assert.equal(BPublication.event.sourceReceiptId, BPublication.receipt.id);
  assert.deepEqual(BPublication.event.effect, pushPublication);
  const publicationRecords = await f.store.records(f.workItemId);
  assert.equal(publicationAuthority(publicationRecords, {
    class: 'pr-create', ...pushPublication,
  }, f.clock)?.id, BPublication.event.id);
  assert.equal(publicationAuthority(publicationRecords, {
    class: 'pr-create', ...fetchPublication,
  }, f.clock)?.id, AConsent.event.id);
  assert.equal(publicationAuthority(publicationRecords, {
    class: 'pr-create', ...pushPublication,
    remoteRepositoryURL: otherPushURL, sourceRepositoryURL: otherPushURL,
  }, f.clock), undefined);
  await assert.rejects(prepare(push, 'observed-but-not-authorized'), { code: 'GATE' });
  await assert.rejects(grant(f, 'permission', {
    grant: 'push', target: push.target, remoteUrlDigest: push.remoteUrlDigest,
    sourceRef: push.sourceRef, targetRef: push.targetRef,
    sourceRevision: push.sourceRevision, force: false, delete: false,
    localRepositoryPath: f.repo, remoteRepositoryURL: fetch.remoteRepositoryURL,
  }), { code: 'EVIDENCE' });
  const { action, grant: BConsent } = await grantPush(f, command, {
    repositoryObservation: verifiedB,
  });
  const prepared = await prepare(action, 'exact-B-consent');
  assert.equal(prepared.operation.intendedOutcome.target.remoteRepositoryURL, pushURL);
  assert.equal(prepared.operation.status, 'prepared');
  assert.ok(BConsent.event);
  await f.runGit('remote', 'set-url', '--push', 'origin', otherPushURL);
  await assert.rejects(markDispatching(f.store, f.workItemId,
    prepared.operation.id), { code: 'STALE' });
  await assert.rejects(prepare(action, 'changed-push-url'), { code: 'EVIDENCE' });
  await f.runGit('remote', 'set-url', '--push', 'origin', pushURL);
  await f.runGit('remote', 'set-url', '--add', '--push', 'origin', otherPushURL);
  await assert.rejects(markDispatching(f.store, f.workItemId,
    prepared.operation.id), { code: 'STALE' });
  await assert.rejects(prepare(action, 'ambiguous-push-url'), { code: 'EVIDENCE' });
  assert.equal((await f.store.records(f.workItemId))
    .find(record => record.id === prepared.operation.id).status, 'prepared');
  assert.equal(f.providerRequests.size, 0);
  assert.equal(f.providerResults.size, 0);
});

test('T-101 verified push URL B supports a separately authorized PR through exact preparation and result', async t => {
  const f = await fixture(t);
  await reviewedCoding(f);
  const { effect: fetchPublication } = await publicationFixture(f);
  const pushURL = 'git@git.example.invalid:team/repository.git';
  const otherURL = 'git@git.example.invalid:team/other.git';
  await f.runGit('remote', 'set-url', '--push', 'origin', pushURL);
  const AConsent = await grant(f, 'pr-publication', fetchPublication, { prepared: true });
  const effect = { ...fetchPublication, remoteRepositoryURL: pushURL,
    sourceRepositoryURL: pushURL };
  const action = await prCreateAction(f, effect);
  const input = { workItemId: f.workItemId, ...prIdentity(),
    sourceRevision: action.sourceRevision, targetRevision: action.targetRevision,
    remoteSourceRevision: action.sourceRevision, matches: [],
    localRepositoryPath: f.repo, remoteRepositoryURL: pushURL,
    sourceRepositoryURL: pushURL, target: 'origin' };
  await assert.rejects(preparePr(f.store, input), { code: 'EVIDENCE' });
  await observePushRepository(f, pushURL, 'repository-id');
  await assert.rejects(preparePr(f.store, input), { code: 'AUTHORITY' });
  const AIntent = await preparePr(f.store, {
    ...input, remoteRepositoryURL: fetchPublication.remoteRepositoryURL,
    sourceRepositoryURL: fetchPublication.sourceRepositoryURL,
  });
  assert.equal(AIntent.action, 'prepare-operation');
  const BConsent = await grant(f, 'pr-publication', effect, {
    prepared: true, input: 'I authorize this exact PR at verified push URL B.',
  });
  assert.equal(BConsent.event.sourceReceiptId, BConsent.receipt.id);
  assert.notEqual(AConsent.event.id, BConsent.event.id);
  await assert.rejects(preparePr(f.store, { ...input, matches: [{
    ...prIdentity(), sourceRevision: action.sourceRevision,
    targetRevision: action.targetRevision, prId: 'PR-at-A',
    url: 'https://example.invalid/repository/pull/1', state: 'active',
    evidenceRef: 'fixture:search-result-without-hosted-repository-proof',
  }] }), { code: 'EVIDENCE' });
  const intent = await preparePr(f.store, input);
  assert.equal(intent.action, 'prepare-operation');
  assert.equal(intent.intent.remoteRepositoryURL, pushURL);
  assert.notEqual(intent.intent.id, AIntent.intent.id);
  const prepare = (correlationKey, attempt) => prepareOperation(f.store, {
    workItemId: f.workItemId, sessionId: f.sessionId, action,
    request: { toolName: 'fixture_create_pr', toolArgs: { attempt }, cwd: f.repo },
    correlationKey, intent: 'Prepare a fixture PR without contacting a provider',
  });
  const { operation } = await prepare('B-pr', 1);
  assert.equal(operation.intendedOutcome.target.remoteRepositoryURL, pushURL);
  await f.runGit('remote', 'set-url', '--push', 'origin', otherURL);
  await assert.rejects(markDispatching(f.store, f.workItemId, operation.id),
    { code: 'STALE' });
  await f.runGit('remote', 'set-url', '--push', 'origin', pushURL);
  registerFixtureProviderRequest(f, operation);
  const dispatch = await markDispatching(f.store, f.workItemId, operation.id);
  assert.equal(dispatch.status, 'dispatching');
  const observedResult = registerFixtureProviderResult(f, operation, {
    providerResultId: 'PR-B',
    result: { prId: 'PR-B', sourceRef: action.sourceRef, targetRef: action.targetRef,
      sourceRevision: action.sourceRevision, targetRevision: action.targetRevision,
      draft: true, sourceRepositoryURL: pushURL, targetRepositoryURL: pushURL },
  });
  const completed = await recordOperation(f.store, {
    workItemId: f.workItemId, operationId: operation.id, status: 'succeeded',
    observedResult,
  });
  assert.equal(completed.status, 'succeeded');
  assert.equal(completed.resultProof.intendedOutcomeDigest, operation.intendedOutcome.digest);
  const pr = { ...prIdentity(), sourceRevision: action.sourceRevision,
    targetRevision: action.targetRevision, prId: 'PR-B',
    url: 'https://example.invalid/repository/pull/B', state: 'active',
    evidenceRef: 'fixture:PR-B' };
  await adoptPr(f.store, { workItemId: f.workItemId, pr,
    intentId: intent.intent.id, operationId: operation.id });
  const observation = { repositoryId: 'primary', localRepositoryPath: f.repo,
    remoteRepositoryURL: pushURL, provider: pr.provider,
    connection: pr.connection, repositoryRef: 'repository-id',
    pullRequestRef: pr.prId, sourceRepositoryURL: pushURL,
    sourceBranchRef: action.sourceRef, targetBranchRef: action.targetRef,
    sourceRevision: action.sourceRevision, targetRevision: action.targetRevision,
    state: 'active', observedAt: new Date(f.clock.now()).toISOString(),
    evidenceRef: 'fixture:verified-PR-B' };
  f.store.verifyPullRequest = ({ provider, localRepositoryPath,
    remoteRepositoryURL }) => {
    assert.equal(provider, pr.provider);
    assert.equal(localRepositoryPath, f.repo);
    assert.equal(remoteRepositoryURL, pushURL);
    return { canonicalLocalRepositoryPath: f.repo,
      verifiedRemoteRepositoryURL: pushURL, verifiedProvider: pr.provider,
      verifiedConnection: pr.connection, verifiedRepositoryRef: 'repository-id',
      verifiedPullRequestRef: pr.prId, verifiedSourceRepositoryURL: pushURL,
      verifiedSourceBranchRef: action.sourceRef,
      verifiedTargetBranchRef: action.targetRef,
      verifiedSourceRevision: action.sourceRevision,
      verifiedTargetRevision: action.targetRevision,
      verifiedState: observation.state,
      verifiedObservedAt: observation.observedAt,
      verifiedEvidenceRef: observation.evidenceRef };
  };
  const adopted = await adoptPr(f.store, { workItemId: f.workItemId,
    observation });
  assert.equal(adopted.observation.remoteRepositoryURL, pushURL);
  assert.equal((await preparePr(f.store, input)).action, 'reuse');
  const wrong = (await prepare('B-pr-wrong-result', 2)).operation;
  registerFixtureProviderRequest(f, wrong);
  await markDispatching(f.store, f.workItemId, wrong.id);
  const wrongResult = registerFixtureProviderResult(f, wrong, {
    providerResultId: 'PR-at-A',
    result: { prId: 'PR-at-A', sourceRef: action.sourceRef,
      targetRef: action.targetRef, sourceRevision: action.sourceRevision,
      targetRevision: action.targetRevision, draft: true,
      sourceRepositoryURL: pushURL,
      targetRepositoryURL: fetchPublication.remoteRepositoryURL },
  });
  assert.equal((await recordOperation(f.store, {
    workItemId: f.workItemId, operationId: wrong.id, status: 'succeeded',
    observedResult: wrongResult,
  })).status, 'uncertain');
  assert.equal(f.providerRequests.size, 2);
  assert.equal(f.providerResults.size, 2);
});

test('T-103 initial fork PR at A requires independently verified source B, not an existing PR', async t => {
  const f = await fixture(t);
  await reviewedCoding(f);
  const { effect: hostedAtA } = await publicationFixture(f);
  const forkURL = 'git@git.example.invalid:team/fork.git';
  const unverifiedURL = 'git@git.example.invalid:team/unverified.git';
  await f.runGit('remote', 'set-url', '--push', 'origin', forkURL);
  const forkEffect = { ...hostedAtA, sourceRepositoryURL: forkURL };
  const action = await prCreateAction(f, forkEffect);
  const input = { workItemId: f.workItemId, ...prIdentity(),
    sourceRevision: action.sourceRevision, targetRevision: action.targetRevision,
    remoteSourceRevision: action.sourceRevision, matches: [],
    localRepositoryPath: f.repo, remoteRepositoryURL: hostedAtA.remoteRepositoryURL,
    sourceRepositoryURL: forkURL, target: 'origin' };
  await assert.rejects(grant(f, 'pr-publication', forkEffect, { prepared: true }),
    { code: 'EVIDENCE' });
  await observePushRepository(f, forkURL, 'fork-repository-id');
  assert.equal((await f.store.records(f.workItemId))
    .filter(record => record.type === 'pr-observation').length, 0);
  await assert.rejects(grant(f, 'pr-publication', {
    ...forkEffect, sourceRepositoryURL: unverifiedURL,
  }, { prepared: true }), { code: 'EVIDENCE' });
  const consent = await grant(f, 'pr-publication', forkEffect, {
    prepared: true, input: 'I authorize this exact fork source B and hosted target A.',
  });
  assert.equal(consent.event.sourceReceiptId, consent.receipt.id);
  assert.equal((await preparePr(f.store, input)).action, 'prepare-operation');
  const { operation } = await prepareOperation(f.store, {
    workItemId: f.workItemId, sessionId: f.sessionId, action,
    request: { toolName: 'fixture_create_pr', toolArgs: { fork: true }, cwd: f.repo },
    correlationKey: 'initial-fork-pr', intent: 'Prepare fixture fork PR only',
  });
  assert.equal(operation.intendedOutcome.target.remoteRepositoryURL,
    hostedAtA.remoteRepositoryURL);
  assert.equal(operation.intendedOutcome.requested.sourceRepositoryURL, forkURL);
  await f.runGit('remote', 'set-url', '--push', 'origin', unverifiedURL);
  await assert.rejects(markDispatching(f.store, f.workItemId, operation.id),
    { code: 'STALE' });
  assert.equal((await f.store.records(f.workItemId))
    .find(record => record.id === operation.id).status, 'prepared');
  assert.equal(f.providerRequests.size, 0);
  assert.equal(f.providerResults.size, 0);
});

test('T-103 reuses a current same-repository PR with an explicit verified source URL', async t => {
  const f = await fixture(t);
  await reviewedCoding(f);
  const { effect, repositoryObservation } = await publicationFixture(f);
  const action = await prCreateAction(f, effect);
  const observedAt = new Date(f.clock.now()).toISOString();
  const observation = {
    repositoryId: 'primary', localRepositoryPath: f.repo,
    remoteRepositoryURL: effect.remoteRepositoryURL, provider: 'azure-devops',
    connection: 'fixture', repositoryRef: repositoryObservation.repositoryRef,
    pullRequestRef: 'PR-at-A', sourceRepositoryURL: effect.remoteRepositoryURL,
    sourceBranchRef: action.sourceRef, targetBranchRef: action.targetRef,
    sourceRevision: action.sourceRevision, targetRevision: action.targetRevision,
    state: 'active', observedAt, evidenceRef: 'fixture:observed-PR-at-A',
  };
  f.store.verifyPullRequest = ({ provider, localRepositoryPath, remoteRepositoryURL }) => {
    assert.equal(provider, observation.provider);
    assert.equal(localRepositoryPath, f.repo);
    assert.equal(remoteRepositoryURL, effect.remoteRepositoryURL);
    return {
      canonicalLocalRepositoryPath: f.repo,
      verifiedRemoteRepositoryURL: observation.remoteRepositoryURL,
      verifiedProvider: observation.provider,
      verifiedConnection: observation.connection,
      verifiedRepositoryRef: observation.repositoryRef,
      verifiedPullRequestRef: observation.pullRequestRef,
      verifiedSourceRepositoryURL: observation.sourceRepositoryURL,
      verifiedSourceBranchRef: observation.sourceBranchRef,
      verifiedTargetBranchRef: observation.targetBranchRef,
      verifiedSourceRevision: observation.sourceRevision,
      verifiedTargetRevision: observation.targetRevision,
      verifiedState: observation.state, verifiedObservedAt: observedAt,
      verifiedEvidenceRef: observation.evidenceRef,
    };
  };
  await adoptPr(f.store, { workItemId: f.workItemId, observation });
  const consent = await grant(f, 'pr-publication', effect, { prepared: true });
  const pr = { ...prIdentity(), sourceRevision: action.sourceRevision,
    targetRevision: action.targetRevision, prId: observation.pullRequestRef,
    url: 'https://example.invalid/repository/pull/at-A', state: 'active',
    evidenceRef: observation.evidenceRef };
  const input = { workItemId: f.workItemId, ...prIdentity(),
    sourceRevision: action.sourceRevision, targetRevision: action.targetRevision,
    remoteSourceRevision: action.sourceRevision, matches: [pr],
    localRepositoryPath: f.repo, remoteRepositoryURL: effect.remoteRepositoryURL,
    sourceRepositoryURL: effect.remoteRepositoryURL, target: effect.target };
  const reused = await preparePr(f.store, input);
  assert.equal(reused.action, 'reuse');
  assert.equal(reused.pr.prId, observation.pullRequestRef);
  assert.equal(consent.event.sourceReceiptId, consent.receipt.id);
  const forkURL = 'git@git.example.invalid:team/other-fork.git';
  await f.runGit('remote', 'set-url', '--push', 'origin', forkURL);
  await observePushRepository(f, forkURL, 'other-fork-repository-id');
  await grant(f, 'pr-publication', { ...effect, sourceRepositoryURL: forkURL },
    { prepared: true });
  await assert.rejects(preparePr(f.store, {
    ...input, sourceRepositoryURL: forkURL,
  }), { code: 'EVIDENCE' });
  assert.equal(f.providerRequests.size, 0);
  assert.equal(f.providerResults.size, 0);
});

test('T-103 equal branch refs require a distinct verified fork, never URL similarity or legacy identity', async t => {
  const f = await fixture(t);
  await reviewedCoding(f);
  const { effect: hostedAtA } = await publicationFixture(f);
  const sameRef = 'refs/heads/feature/fixture';
  const sameRepository = { ...hostedAtA, targetRef: sameRef };
  const targetRevision = await f.runGit('rev-parse', 'refs/heads/trunk');
  const sourceRevision = await f.runGit('rev-parse', 'HEAD');
  const input = (effect, matches = []) => ({
    workItemId: f.workItemId, ...prIdentity(),
    sourceRef: sameRef, targetRef: sameRef, sourceRevision, targetRevision,
    remoteSourceRevision: sourceRevision, matches,
    localRepositoryPath: f.repo, remoteRepositoryURL: effect.remoteRepositoryURL,
    sourceRepositoryURL: effect.sourceRepositoryURL, target: effect.target,
  });
  await grant(f, 'pr-publication', sameRepository, { prepared: true });
  await assert.rejects(preparePr(f.store, input(sameRepository)), { code: 'EVIDENCE' });
  await assert.rejects(adoptPr(f.store, { workItemId: f.workItemId, pr: {
    ...prIdentity(), sourceRef: sameRef, targetRef: sameRef,
    sourceRevision, targetRevision, prId: 'legacy-same-name',
    url: 'https://example.invalid/repository/pull/legacy',
    state: 'active', evidenceRef: 'fixture:legacy',
  } }), { code: 'EVIDENCE' });

  const aliasURL = 'git@git.example.invalid:team/same-repository.git';
  await f.runGit('remote', 'set-url', '--push', 'origin', aliasURL);
  await observePushRepository(f, aliasURL, 'repository-id');
  const alias = { ...sameRepository, sourceRepositoryURL: aliasURL };
  await grant(f, 'pr-publication', alias, { prepared: true });
  await assert.rejects(preparePr(f.store, input(alias)), { code: 'EVIDENCE' });

  const forkURL = 'git@git.example.invalid:team/fork.git';
  await f.runGit('remote', 'set-url', '--push', 'origin', forkURL);
  await observePushRepository(f, forkURL, 'fork-repository-id');
  const fork = { ...sameRepository, sourceRepositoryURL: forkURL };
  const consent = await grant(f, 'pr-publication', fork, {
    prepared: true, input: 'I authorize a PR from the verified fork with the same branch name.',
  });
  const prepared = await preparePr(f.store, input(fork));
  assert.equal(prepared.action, 'prepare-operation');
  assert.equal(prepared.intent.sourceRef, prepared.intent.targetRef);
  assert.equal(consent.event.sourceReceiptId, consent.receipt.id);
  const action = { ...await prCreateAction(f, fork),
    sourceRef: sameRef, targetRef: sameRef };
  const { operation } = await prepareOperation(f.store, {
    workItemId: f.workItemId, sessionId: f.sessionId, action,
    request: { toolName: 'fixture_create_pr', toolArgs: { equalBranchNames: true }, cwd: f.repo },
    correlationKey: 'same-name-fork', intent: 'Prepare only the verified fork PR',
  });
  assert.equal(operation.intendedOutcome.requested.sourceRepositoryURL, forkURL);
  assert.equal((await markDispatching(f.store, f.workItemId, operation.id)).status,
    'dispatching');
  assert.equal(f.providerRequests.size, 0);
  assert.equal(f.providerResults.size, 0);
  registerFixtureProviderRequest(f, operation);
  const observedResult = registerFixtureProviderResult(f, operation, {
    providerResultId: 'PR-equal-ref-fork',
    result: { prId: 'PR-equal-ref-fork', sourceRef: sameRef,
      targetRef: sameRef, sourceRevision, targetRevision, draft: true,
      sourceRepositoryURL: forkURL,
      targetRepositoryURL: hostedAtA.remoteRepositoryURL },
  });
  const completed = await recordOperation(f.store, {
    workItemId: f.workItemId, operationId: operation.id,
    status: 'succeeded', observedResult,
  });
  assert.equal(completed.status, 'succeeded');
  const pr = { ...prIdentity(), sourceRef: sameRef, targetRef: sameRef,
    sourceRevision, targetRevision, prId: 'PR-equal-ref-fork',
    url: 'https://example.invalid/repository/pull/equal-ref-fork',
    state: 'active', evidenceRef: 'fixture:exact-PR-result' };
  await assert.rejects(adoptPr(f.store, {
    workItemId: f.workItemId, pr: { ...pr, prId: 'PR-other' },
    intentId: prepared.intent.id, operationId: operation.id,
  }), { code: 'EVIDENCE',
    message: /PR creation requires a causally proven matching provider result/u });
  await assert.rejects(adoptPr(f.store, {
    workItemId: f.workItemId, pr,
    intentId: prepared.intent.id, operationId: 'op-not-this-publication',
  }), { code: 'EVIDENCE',
    message: /PR creation requires a causally proven matching provider result/u });
  assert.equal((await f.store.records(f.workItemId))
    .find(record => record.id === prepared.intent.id).status, 'prepared');
  const created = await adoptPr(f.store, {
    workItemId: f.workItemId, pr,
    intentId: prepared.intent.id, operationId: operation.id,
  });
  assert.equal(created.pr.prId, pr.prId);
  assert.equal(Object.hasOwn(created.pr, 'sourceRepositoryURL'), false);
  const recordedIntent = (await f.store.records(f.workItemId))
    .find(record => record.id === prepared.intent.id);
  assert.equal(recordedIntent.status, 'recorded');
  assert.equal(recordedIntent.prRecordId, created.pr.id);
});

test('T-103 provider-proven fork permits equal-ref observation and exact existing PR reuse', async t => {
  const f = await fixture(t);
  await reviewedCoding(f);
  const { effect: hostedAtA, repositoryObservation } = await publicationFixture(f);
  const forkURL = 'git@git.example.invalid:team/provider-proven-fork.git';
  await f.runGit('remote', 'set-url', '--push', 'origin', forkURL);
  const sameRef = 'refs/heads/feature/fixture';
  const sourceRevision = await f.runGit('rev-parse', 'HEAD');
  const targetRevision = await f.runGit('rev-parse', 'refs/heads/trunk');
  const observation = {
    repositoryId: 'primary', localRepositoryPath: f.repo,
    remoteRepositoryURL: hostedAtA.remoteRepositoryURL,
    provider: 'azure-devops', connection: 'fixture',
    repositoryRef: repositoryObservation.repositoryRef,
    pullRequestRef: 'PR-from-provider-fork', sourceRepositoryURL: forkURL,
    sourceBranchRef: sameRef, targetBranchRef: sameRef,
    sourceRevision, targetRevision, state: 'active',
    observedAt: new Date(f.clock.now()).toISOString(),
    evidenceRef: 'fixture:provider-proven-fork',
  };
  let sourceRepositoryRef;
  f.store.verifyPullRequest = () => ({
    canonicalLocalRepositoryPath: f.repo,
    verifiedRemoteRepositoryURL: observation.remoteRepositoryURL,
    verifiedProvider: observation.provider,
    verifiedConnection: observation.connection,
    verifiedRepositoryRef: observation.repositoryRef,
    verifiedPullRequestRef: observation.pullRequestRef,
    verifiedSourceRepositoryURL: observation.sourceRepositoryURL,
    ...(sourceRepositoryRef ? { verifiedSourceRepositoryRef: sourceRepositoryRef } : {}),
    verifiedSourceBranchRef: observation.sourceBranchRef,
    verifiedTargetBranchRef: observation.targetBranchRef,
    verifiedSourceRevision: sourceRevision, verifiedTargetRevision: targetRevision,
    verifiedState: observation.state, verifiedObservedAt: observation.observedAt,
    verifiedEvidenceRef: observation.evidenceRef,
  });
  await assert.rejects(adoptPr(f.store, {
    workItemId: f.workItemId, observation,
  }), { code: 'EVIDENCE' });
  sourceRepositoryRef = repositoryObservation.repositoryRef;
  await assert.rejects(adoptPr(f.store, {
    workItemId: f.workItemId, observation,
  }), { code: 'EVIDENCE' });
  sourceRepositoryRef = 'provider-verified-fork-id';
  const observed = await adoptPr(f.store, {
    workItemId: f.workItemId, observation,
  });
  assert.equal(observed.observation.sourceRepositoryURL, forkURL);
  assert.equal(observed.authority,
    'observation-only; adoption grants no publish, merge or deployment permission');
  const forkEffect = { ...hostedAtA, sourceRepositoryURL: forkURL,
    targetRef: sameRef };
  await assert.rejects(grant(f, 'pr-publication', forkEffect, { prepared: true }),
    { code: 'EVIDENCE' });
  await observePushRepository(f, forkURL, sourceRepositoryRef);
  const consent = await grant(f, 'pr-publication', forkEffect, {
    prepared: true, input: 'I authorize the exact verified fork PR.',
  });
  const pr = { ...prIdentity(), sourceRef: sameRef, targetRef: sameRef,
    sourceRevision, targetRevision, prId: observation.pullRequestRef,
    url: 'https://example.invalid/repository/pull/fork', state: 'active',
    evidenceRef: observation.evidenceRef };
  const reused = await preparePr(f.store, {
    workItemId: f.workItemId, ...prIdentity(),
    sourceRef: sameRef, targetRef: sameRef,
    sourceRevision, targetRevision, remoteSourceRevision: sourceRevision,
    matches: [pr], localRepositoryPath: f.repo,
    remoteRepositoryURL: hostedAtA.remoteRepositoryURL,
    sourceRepositoryURL: forkURL, target: 'origin',
  });
  assert.equal(reused.action, 'reuse');
  assert.equal(reused.pr.prId, pr.prId);
  assert.equal(consent.event.sourceReceiptId, consent.receipt.id);
  assert.equal(f.providerRequests.size, 0);
  assert.equal(f.providerResults.size, 0);
});

test('T-103 early fork PR uses trusted hosted A base proof, not source push B proof', async t => {
  const f = await fixture(t);
  await f.runGit('commit', '--allow-empty', '-qm', 'Create hosted PR target');
  const targetRevision = await f.runGit('rev-parse', 'HEAD');
  await f.runGit('branch', 'trunk', targetRevision);
  await f.runGit('add', '.sdlc');
  await f.runGit('commit', '-qm', 'Commit documentation-only PR source');
  const { repositoryObservation: hostedAtA, effect: target } =
    await publicationFixture(f);
  const forkURL = 'git@git.example.invalid:team/document-fork.git';
  await f.runGit('remote', 'set-url', '--push', 'origin', forkURL);
  const sourceAtB = await observePushRepository(f, forkURL, 'fork-repository-id');
  const effect = { ...target, sourceRepositoryURL: forkURL };
  await grant(f, 'pr-publication', effect, { prepared: true });
  const action = { ...await prCreateAction(f, effect), earlyDraft: true,
    paths: [`.sdlc/work-items/${f.workItemId}.json`] };
  const prepare = correlationKey => prepareOperation(f.store, {
    workItemId: f.workItemId, sessionId: f.sessionId, action,
    request: { toolName: 'fixture_create_pr',
      toolArgs: { source: action.sourceRef, target: action.targetRef },
      cwd: f.repo },
    correlationKey, intent: 'Prepare only the documented fork PR',
  });
  await assert.rejects(prepare('no-hosted-base'), {
    code: 'EVIDENCE', message: /not proven/u,
  });
  await observeHostedBase(f, sourceAtB, action.targetRef,
    targetRevision);
  await assert.rejects(prepare('source-base-is-not-hosted-base'), {
    code: 'EVIDENCE', message: /not proven/u,
  });
  const proof = await observeHostedBase(f, hostedAtA, action.targetRef,
    targetRevision, { pushURL: false });
  assert.equal(proof.remoteRepositoryURL, target.remoteRepositoryURL);
  assert.equal(proof.verifiedBranch.revision, targetRevision);
  const { operation } = await prepare('hosted-base-proven');
  assert.equal(operation.intendedOutcome.target.remoteRepositoryURL,
    target.remoteRepositoryURL);
  assert.equal(operation.intendedOutcome.requested.sourceRepositoryURL,
    forkURL);
  assert.equal((await markDispatching(f.store, f.workItemId, operation.id)).status,
    'dispatching');
  assert.equal(f.providerRequests.size, 0);
  assert.equal(f.providerResults.size, 0);
});
