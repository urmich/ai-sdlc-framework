import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { cli, coding, completeReview, fixture, fixtureArtifact, fixtureBuild, grant, grantPush, observeFixtureRepository,
  pushAction, registerFixtureProviderRequest, registerFixtureProviderResult, testDefinitions } from './helpers.mjs';
import { preparePr, adoptPr, updatePrFacts, evaluateReadiness, publicationAuthority } from '../src/pr.mjs';
import { prepareOperation, markDispatching, recordOperation } from '../src/operations.mjs';
import { evaluatePolicy } from '../src/policy.mjs';
import { associateMonitor, attachMonitor, beginPoll, claimMonitor, monitorAssociationKey, monitorNotice, observeMonitor,
  pruneMonitor, readActiveMonitor, readMonitor, refreshMonitorCapabilities,
  verifyMonitorLink } from '../src/monitors.mjs';
import { recordTest, startCycle } from '../src/validation.mjs';
import { azureDevOpsScopeRef } from '../src/provider-adapters.mjs';
import { withLock, writeJson } from '../src/files.mjs';
import { digest } from '../src/core.mjs';

const executionIdentity = executionRef => ({
  provider: 'azure-devops',
  connection: 'fixture',
  scopeRef: azureDevOpsScopeRef({
    projectId: 'project-id',
    repositoryId: 'repository-id',
  }),
  definitionRef: 'check-build',
  executionRef,
});
const linkObservation = executionRef => ({
  connection: 'fixture',
  build: {
    id: executionRef,
    project: { id: 'project-id' },
    repository: { id: 'repository-id' },
    definition: { id: 'check-build' },
    _links: {
      web: {
        href: `https://dev.azure.com/example/project/_build/results?buildId=${executionRef}`,
      },
    },
  },
  access: {
    accessible: true,
    finalUrl: `https://dev.azure.com/example/project/_build/results?buildId=${executionRef}&view=results`,
  },
});
const prIdentity = () => ({ provider: 'azure-devops', connection: 'fixture', repositoryId: 'primary',
  sourceRef: 'refs/heads/feature/fixture', targetRef: 'refs/heads/trunk',
  sourceRevision: 'source-1', targetRevision: 'target-1', draft: true });
async function publicationFixture(f, { lifetime, scope } = {}) {
  const repositoryObservation = await observeFixtureRepository(f, {
    provider: 'azure-devops', connection: 'fixture', repositoryRef: 'repository-id',
  });
  const effect = { repositoryId: 'primary', sourceRef: 'refs/heads/feature/fixture',
    targetRef: 'refs/heads/trunk', draft: true, target: 'origin',
    localRepositoryPath: f.repo, remoteRepositoryURL: repositoryObservation.remoteRepositoryURL,
    sourceRepositoryURL: repositoryObservation.remoteRepositoryURL,
    ...(lifetime ? { lifetime } : {}), ...(scope ? { scope } : {}) };
  return { repositoryObservation, effect };
}
async function observePushRepository(f, remoteRepositoryURL, repositoryRef) {
  const revision = await f.runGit('rev-parse', 'HEAD');
  const observedAt = new Date(f.clock.now()).toISOString();
  const evidenceRef = `fixture:repository:${repositoryRef}:${observedAt}`;
  f.repositoryVerifications.set(remoteRepositoryURL, {
    canonicalLocalRepositoryPath: f.repo, verifiedRemoteRepositoryURL: remoteRepositoryURL,
    verifiedProvider: 'azure-devops', verifiedConnection: 'fixture',
    verifiedRepositoryRef: repositoryRef, verifiedRevision: revision,
    verifiedObservedAt: observedAt, verifiedEvidenceRef: evidenceRef,
  });
  return f.store.observeRepository({
    workItemId: f.workItemId, repositoryId: 'primary',
    selectedRemoteName: 'origin', pushURL: true,
    localRepositoryPath: f.repo, remoteRepositoryURL,
    provider: 'azure-devops', connection: 'fixture', repositoryRef,
    revision, observedAt, evidenceRef,
  });
}
async function observeHostedBase(f, repository, branchRef, revision, {
  pushURL = true,
} = {}) {
  const remoteRepositoryURL = pushURL ?
    await f.runGit('remote', 'get-url', '--push', 'origin') :
    await f.runGit('remote', 'get-url', 'origin');
  assert.equal(remoteRepositoryURL, repository.remoteRepositoryURL);
  f.clock.advance(1);
  const verifiedBranch = { branchRef, revision };
  const observedAt = new Date(f.clock.now()).toISOString();
  const evidenceRef = `fixture:hosted-base:${branchRef}:${observedAt}`;
  f.repositoryVerifications.set(remoteRepositoryURL, {
    canonicalLocalRepositoryPath: f.repo, verifiedRemoteRepositoryURL: remoteRepositoryURL,
    verifiedProvider: repository.provider, verifiedConnection: repository.connection,
    verifiedRepositoryRef: repository.repositoryRef, verifiedRevision: revision,
    verifiedDefaultBranchRef: repository.defaultBranchRef, verifiedBranch,
    verifiedObservedAt: observedAt, verifiedEvidenceRef: evidenceRef,
  });
  const observation = await f.store.observeRepository({
    workItemId: f.workItemId, repositoryId: 'primary',
    selectedRemoteName: 'origin', pushURL, localRepositoryPath: f.repo,
    remoteRepositoryURL, provider: repository.provider,
    connection: repository.connection, repositoryRef: repository.repositoryRef,
    revision, defaultBranchRef: repository.defaultBranchRef,
    verifiedBranch, observedAt, evidenceRef,
  });
  assert.deepEqual(observation.verifiedBranch, verifiedBranch);
  return observation;
}
async function prCreateAction(f, effect, { earlyDraft = false, paths } = {}) {
  const { lifetime, scope, ...destination } = effect;
  void lifetime; void scope;
  return { class: 'pr-create', ...destination,
    sourceRevision: await f.runGit('rev-parse', 'HEAD'),
    targetRevision: await f.runGit('rev-parse', 'refs/heads/trunk'),
    ...(earlyDraft ? { earlyDraft: true, paths } : {}) };
}
async function successfulCheckMonitor(f, prRecordId, {
  runId = '101',
  includePrContext = true,
  wrongLink = false,
} = {}) {
  const identity = executionIdentity(runId);
  const monitor = await attachMonitor(f.store, { identity,
    origin: 'framework', workItemId: f.workItemId,
    ...(includePrContext ? { prRecordId, checkId: 'check-build', sourceRevision: 'source-1', targetRevision: 'target-1',
      associationEvidenceRef: 'fixture:provider-check-association' } : {}),
    schedulerAvailable: true, readAvailable: true });
  const workerId = `worker-pr-check-${runId}`;
  const claimed = await claimMonitor(f.store, { runKey: monitor.key, workerId });
  const poll = await beginPoll(f.store, { runKey: monitor.key, workerId,
    claimGeneration: claimed.claimGeneration });
  await observeMonitor(f.store, { runKey: monitor.key, workerId,
    claimGeneration: claimed.claimGeneration,
    pollGeneration: poll.pollGeneration,
    identity, status: 'succeeded', evidenceRef: 'fixture:monitor-result' });
  const observation = linkObservation(runId);
  if (wrongLink) {
    observation.build._links.web.href =
      'https://dev.azure.com/example/project/_build/results?buildId=unrelated';
  }
  await verifyMonitorLink(f.store, { runKey: monitor.key,
    adapterId: 'azure-devops', observation,
    evidenceRef: 'fixture:verified-link' });
  return monitor.key;
}
async function reviewedCoding(f) {
  await coding(f);
  await f.runGit('commit', '--allow-empty', '-qm', 'Create PR target baseline');
  await f.runGit('branch', 'trunk', 'HEAD');
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Commit the candidate before PR publication tests');
  await publicationFixture(f);
  const cycle = (await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: 'v1', cause: 'reviewed PR fixture' })).cycle;
  for (const testId of ['T-unit', 'T-integration']) {
    await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id, testId,
      status: 'Passed', expectedMet: true, evidenceRef: `fixture:${testId}`, owner: 'agent', host: 'local' });
  }
  await completeReview(f, cycle);
  return cycle;
}
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
