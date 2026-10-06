import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fixture, coding, completeReview, grant, observeFixtureRepository,
  registerFixtureProviderRequest, registerFixtureProviderResult, testDefinitions } from './helpers.mjs';
import { digest } from '../src/core.mjs';
import { observeRepository } from '../src/repository-observations.mjs';
import { adoptPr, evaluateReadiness, updatePrFacts } from '../src/pr.mjs';
import { markDispatching, prepareOperation, recordOperation } from '../src/operations.mjs';
import { associateMonitor, attachMonitor, beginPoll, claimMonitor, monitorNotice,
  interruptMonitor, observeMonitor, pruneMonitor, readMonitor, readMonitorAssociation,
  verifyMonitorLink } from '../src/monitors.mjs';
import { azureDevOpsScopeRef, registerProviderAdapter } from '../src/provider-adapters.mjs';
import { evaluatePolicy } from '../src/policy.mjs';
import { resume, status } from '../src/recovery.mjs';
import { Store } from '../src/store.mjs';
import { currentArtifact } from '../src/current-evidence.mjs';
import { recordArtifact, recordTest, startCycle } from '../src/validation.mjs';

async function archivedBytes(f, recordId) {
  return fs.readFile(path.join(f.store.workPath(f.workItemId),
    'evidence', `${recordId}.json`));
}

async function observedRepository(f, sourceRevision) {
  const repository = {
    localRepositoryPath: f.repo,
    remoteRepositoryURL: 'https://example.invalid/repository.git',
    provider: 'azure-devops',
    connection: 'fixture',
    repositoryRef: 'repository-id',
    revision: sourceRevision,
    observedAt: new Date(f.clock.now()).toISOString(),
    evidenceRef: 'fixture:repository',
  };
  const verification = {
    canonicalLocalRepositoryPath: f.repo,
    verifiedRemoteRepositoryURL: repository.remoteRepositoryURL,
    verifiedProvider: repository.provider,
    verifiedConnection: repository.connection,
    verifiedRepositoryRef: repository.repositoryRef,
    verifiedPullRequestRef: '17',
  };
  f.store.verifyRepository = () => ({
    canonicalLocalRepositoryPath: verification.canonicalLocalRepositoryPath,
    verifiedRemoteRepositoryURL: verification.verifiedRemoteRepositoryURL,
    verifiedProvider: verification.verifiedProvider,
    verifiedConnection: verification.verifiedConnection,
    verifiedRepositoryRef: verification.verifiedRepositoryRef,
    verifiedRevision: repository.revision,
    verifiedObservedAt: repository.observedAt,
    verifiedEvidenceRef: repository.evidenceRef,
  });
  await observeRepository(f.store, {
    workItemId: f.workItemId, repositoryId: 'primary',
    ...repository,
  });
  return { repository, verification };
}

const pollIdentity = {
  provider: 'azure-devops', connection: 'fixture',
  scopeRef: azureDevOpsScopeRef({ projectId: 'project-id', repositoryId: 'repository-id' }),
  definitionRef: '17', executionRef: '42', attemptKind: 'not-applicable',
};

function providerRun() {
  return {
    connection: 'fixture',
    build: {
      id: '42', project: { id: 'project-id' },
      repository: { id: 'repository-id' }, definition: { id: '17' },
      _links: { web: { href: 'https://dev.azure.com/example/project/_build/results?buildId=42' } },
    },
    access: { accessible: true,
      finalUrl: 'https://dev.azure.com/example/project/_build/results?buildId=42&view=summary' },
  };
}

test('T-103/T-104/T-113 late check association requires the current PR, exact result, producer and complete run', async t => {
  const f = await fixture(t);
  await f.runGit('commit', '--allow-empty', '-qm', 'Target revision');
  const targetRevision = await f.runGit('rev-parse', 'HEAD');
  await f.runGit('commit', '--allow-empty', '-qm', 'Source revision');
  const sourceRevision = await f.runGit('rev-parse', 'HEAD');
  const { repository, verification } = await observedRepository(f, sourceRevision);
  const prDetails = {
    repositoryId: 'primary', localRepositoryPath: repository.localRepositoryPath,
    remoteRepositoryURL: repository.remoteRepositoryURL,
    provider: repository.provider, connection: repository.connection,
    repositoryRef: repository.repositoryRef, pullRequestRef: '17',
    sourceBranchRef: 'refs/heads/feature/fixture',
    targetBranchRef: 'refs/heads/trunk',
    sourceRevision, targetRevision, state: 'active',
    observedAt: new Date(f.clock.now()).toISOString(),
    evidenceRef: 'fixture:pr-current',
  };
  await assert.rejects(adoptPr(f.store, {
    workItemId: f.workItemId, observation: prDetails,
  }), { code: 'ADAPTER' });
  let providerPr = prDetails;
  f.store.verifyPullRequest = () => ({
    ...verification,
    verifiedPullRequestRef: providerPr.pullRequestRef,
    verifiedSourceBranchRef: providerPr.sourceBranchRef,
    verifiedTargetBranchRef: providerPr.targetBranchRef,
    verifiedSourceRevision: providerPr.sourceRevision,
    verifiedTargetRevision: providerPr.targetRevision,
    verifiedState: providerPr.state,
    verifiedObservedAt: providerPr.observedAt,
    verifiedEvidenceRef: providerPr.evidenceRef,
  });
  const { observation: pr } = await adoptPr(f.store, {
    workItemId: f.workItemId, observation: prDetails,
  });
  const prBytes = await fs.readFile(f.store.recordPath(f.workItemId, pr.id));
  assert.equal(pr.sequence, 1);
  assert.equal(pr.localRepositoryPath, f.repo);
  assert.equal(pr.remoteRepositoryURL, repository.remoteRepositoryURL);
  assert.equal(pr.type, 'pr-observation');
  assert.deepEqual((await status(f.store, f.workItemId)).pullRequests, [{
    id: pr.id, observationId: pr.id, localRepositoryPath: f.repo,
    remoteRepositoryURL: repository.remoteRepositoryURL,
    provider: 'azure-devops', connection: 'fixture',
    repositoryRef: 'repository-id', pullRequestRef: '17',
    state: 'active', sourceRevision, targetRevision, sequence: 1,
  }]);
  await assert.rejects(adoptPr(f.store, {
    workItemId: f.workItemId, observation: {
      ...prDetails, repositoryRef: 'another-repository',
    },
  }), { code: 'EVIDENCE' });

  const filePath = path.join(f.root, 'run-evidence.bin');
  const bytes = Buffer.from('two separate check results from the same execution');
  await fs.writeFile(filePath, bytes);
  const evidence = {
    summary: 'Two required checks completed',
    reference: {
      locator: 'fixture:run-42',
      retrievalContext: { provider: 'azure-devops', connection: 'fixture',
        scopeRef: pollIdentity.scopeRef,
        retrievedAt: new Date(f.clock.now()).toISOString() },
      sha256: digest(bytes),
    },
  };
  const attached = await attachMonitor(f.store, { identity: pollIdentity,
    origin: 'framework', workItemId: f.workItemId,
    schedulerAvailable: true, readAvailable: true });
  const claimed = await claimMonitor(f.store, { runKey: attached.key, workerId: 'worker-check' });
  const poll = await beginPoll(f.store, {
    runKey: attached.key, workerId: 'worker-check',
    claimGeneration: claimed.claimGeneration,
  });
  const mergeRevision = 'c'.repeat(40);
  const mergeContext = { sourceRevision, targetRevision, mergeRevision,
    evidenceRef: 'fixture:proven-merge-parents' };
  const providerChecks = ['build', 'security', 'merge'].map((requiredCheckRef, index) => ({
    requiredCheckRef, checkResultRef: `result-${index + 1}`,
    producerRef: '17', testedRevision: index === 2 ? mergeRevision : sourceRevision,
    status: 'succeeded', evidenceRef: `fixture:check-result-${index + 1}`,
    displayName: 'Verify', localRepositoryPath: f.repo,
    remoteRepositoryURL: repository.remoteRepositoryURL,
    repositoryRef: repository.repositoryRef, pullRequestRef: '17',
    sourceRevision, targetRevision,
    ...(index === 2 ? { mergeContext } : {}),
  }));
  await assert.rejects(observeMonitor(f.store, {
    runKey: attached.key, workerId: 'worker-check',
    claimGeneration: claimed.claimGeneration, pollGeneration: poll.pollGeneration,
    identity: pollIdentity, status: 'succeeded', evidence,
    evidenceFilePath: filePath, checkResults: providerChecks,
  }), { code: 'ADAPTER' });
  f.store.verifyCheckResults = () => ({
    identity: pollIdentity, status: 'succeeded',
    evidenceReference: evidence.reference, checkResults: providerChecks,
  });
  const observed = await observeMonitor(f.store, {
    runKey: attached.key, workerId: 'worker-check',
    claimGeneration: claimed.claimGeneration, pollGeneration: poll.pollGeneration,
    identity: pollIdentity, status: 'succeeded', evidence,
    evidenceFilePath: filePath,
    checkResults: providerChecks,
  });
  assert.deepEqual(observed.evidenceVerification, { verified: true, identity: 'sha256' });
  await verifyMonitorLink(f.store, {
    runKey: attached.key, adapterId: 'azure-devops',
    observation: providerRun(), evidenceRef: 'fixture:run-page',
  });
  const association = (requiredCheckRef, index) => ({
    runKey: attached.key, workItemId: f.workItemId,
    prRecordId: pr.id, prObservationKey: pr.id,
    localRepositoryPath: f.repo, remoteRepositoryURL: repository.remoteRepositoryURL,
    checkId: requiredCheckRef, requiredCheckRef,
    checkResultRef: `result-${index + 1}`, producerRef: '17',
    testedRevision: index === 2 ? mergeRevision : sourceRevision,
    sourceRevision, targetRevision,
    evidenceRef: `fixture:check-result-${index + 1}`, evidence,
    ...(index === 2 ? { mergeContext } : {}),
  });
  await assert.rejects(associateMonitor(f.store, {
    ...association('security', 1), checkResultRef: 'result-1',
  }), { code: 'EVIDENCE' });
  await assert.rejects(associateMonitor(f.store, {
    ...association('build', 0), producerRef: 'different-producer',
  }), { code: 'EVIDENCE' });
  await assert.rejects(associateMonitor(f.store, {
    ...association('build', 0), remoteRepositoryURL: 'https://other.invalid/repository.git',
  }), { code: 'EVIDENCE' });
  await assert.rejects(associateMonitor(f.store, {
    ...association('build', 0),
    evidence: { ...evidence, reference: { ...evidence.reference,
      retrievalContext: { ...evidence.reference.retrievalContext,
        scopeRef: 'another-execution-scope' } } },
  }), { code: 'EVIDENCE' });
  await assert.rejects(associateMonitor(f.store, {
    ...association('merge', 2), mergeContext: undefined,
  }), { code: 'EVIDENCE' });
  const build = await associateMonitor(f.store, association('build', 0));
  const security = await associateMonitor(f.store, association('security', 1));
  const merge = await associateMonitor(f.store, association('merge', 2));
  assert.notEqual(build.key, security.key);
  assert.notEqual(merge.key, build.key);
  assert.deepEqual(await readMonitorAssociation(f.store, association('build', 0)), build);

  const facts = {
    workItemId: f.workItemId, prRecordId: pr.id,
    policyVersion: 'policy-1', sourceRevision, targetRevision,
    requiredChecks: ['build', 'security', 'merge'],
    checks: ['build', 'security', 'merge'].map((requiredCheckRef, index) => ({
      id: requiredCheckRef, requiredCheckRef, checkResultRef: `result-${index + 1}`,
      producerRef: '17', testedRevision: index === 2 ? mergeRevision : sourceRevision,
      ...(index === 2 ? { mergeRevision } : {}), sourceRevision,
      targetRevision, runKey: attached.key, identity: pollIdentity,
      status: 'succeeded', evidenceRef: `fixture:check-result-${index + 1}`,
    })),
    providerEvidenceRef: 'fixture:policy-1',
    mergeContext,
  };
  const recordedFacts = await updatePrFacts(f.store, facts);
  const factsBytes = await fs.readFile(f.store.recordPath(f.workItemId, recordedFacts.id));
  const evaluation = {
    environment: 'PROD', repositoryId: 'primary', prRecordId: pr.id,
    localRepositoryPath: repository.localRepositoryPath,
    remoteRepositoryURL: repository.remoteRepositoryURL,
    prId: pr.pullRequestRef,
    sourceRevision, targetRevision, policyVersion: 'policy-1',
  };
  const readiness = evaluateReadiness((await f.store.load(f.workItemId)).records,
    evaluation, { clock: f.clock });
  assert.equal(readiness.verdict, 'satisfied', JSON.stringify(readiness));
  assert.equal(readiness.ready, true, JSON.stringify(readiness));
  const wrongHostedURL = 'https://example.invalid/other.git';
  assert.ok(evaluateReadiness((await f.store.load(f.workItemId)).records,
    { ...evaluation, remoteRepositoryURL: wrongHostedURL },
    { clock: f.clock }).gaps.includes('pr-hosted-repository-mismatch'));
  assert.ok(evaluateReadiness((await f.store.load(f.workItemId)).records,
    { ...evaluation, prId: '18' },
    { clock: f.clock }).gaps.includes('pr-hosted-id-mismatch'));
  const wrongDestinationPolicy = evaluatePolicy(
    await f.store.load(f.workItemId), {
      class: 'build', repositoryId: 'primary', environment: 'DEV',
      target: 'fixture-build', configDigest: 'fixture-config',
      provider: 'azure-devops', pipeline: '17',
      localRepositoryPath: f.repo, remoteRepositoryURL: wrongHostedURL,
      sourceRevision, targetRevision, prRecordId: pr.id,
      prId: '18', policyVersion: 'policy-1', monitorCapability: true,
    }, { clock: f.clock, configuration: { environments: {
      DEV: { target: 'fixture-build', configDigest: 'fixture-config',
        pr: { required: true, validation: true } },
    } } });
  assert.ok(wrongDestinationPolicy.findings.some(finding =>
    finding.rule === 'pr-readiness' &&
    finding.reason.includes('pr-hosted-repository-mismatch')));
  const config = { environments: { DEV: {
    target: 'fixture-build', configDigest: 'fixture-config',
    pr: { required: true, validation: true },
  } } };
  await fs.writeFile(path.join(f.repo, '.sdlc', 'config.json'),
    JSON.stringify(config));
  const wrongPrAction = {
    class: 'build', repositoryId: 'primary', environment: 'DEV',
    target: 'fixture-build', configDigest: 'fixture-config',
    provider: 'azure-devops', pipeline: '17',
    localRepositoryPath: f.repo, remoteRepositoryURL: repository.remoteRepositoryURL,
    sourceRevision, targetRevision, prRecordId: pr.id, prId: '18',
    policyVersion: 'policy-1', monitorCapability: true,
  };
  await assert.rejects(prepareOperation(f.store, {
    workItemId: f.workItemId, sessionId: f.sessionId, action: wrongPrAction,
    request: { toolName: 'fixture_build',
      toolArgs: { prId: '18' }, cwd: f.repo },
    correlationKey: 'wrong-hosted-pr',
    intent: 'Reject PR 17 check evidence for requested PR 18',
  }), error => error.code === 'GATE' && error.details.some(finding =>
    finding.rule === 'pr-readiness' &&
    finding.reason.includes('pr-hosted-id-mismatch')));
  const notice = await monitorNotice(f.store, { runKey: attached.key });
  await monitorNotice(f.store, { runKey: attached.key,
    noticeGeneration: notice.notice.generation, deliveredRef: 'fixture:notice' });
  await assert.rejects(pruneMonitor(f.store, { runKey: attached.key }), { code: 'MONITOR' });

  await f.runGit('commit', '--allow-empty', '-qm', 'Advance source branch');
  const advancedRevision = await f.runGit('rev-parse', 'HEAD');
  f.clock.advance(1);
  providerPr = { ...prDetails, sourceRevision: advancedRevision,
    observedAt: new Date(f.clock.now()).toISOString(), evidenceRef: 'fixture:pr-advanced' };
  const { observation: refreshed } = await adoptPr(f.store, {
    workItemId: f.workItemId, previousObservationKey: pr.id,
    observation: providerPr,
  });
  assert.equal(refreshed.sequence, 2);
  assert.equal(refreshed.previousObservationKey, pr.id);
  const currentStatus = await status(f.store, f.workItemId);
  assert.deepEqual(currentStatus.pullRequests, [{
    id: refreshed.id, observationId: refreshed.id, localRepositoryPath: f.repo,
    remoteRepositoryURL: repository.remoteRepositoryURL,
    provider: 'azure-devops', connection: 'fixture',
    repositoryRef: 'repository-id', pullRequestRef: '17',
    state: 'active', sourceRevision: advancedRevision, targetRevision, sequence: 2,
  }]);
  const inventory = await status(f.store, f.workItemId, { offset: 0, limit: 100 });
  assert.equal(inventory.inventory.pullRequests.count, 1);
  assert.deepEqual(inventory.items.filter(item => item.kind === 'pullRequests'), [{
    kind: 'pullRequests', ...currentStatus.pullRequests[0],
  }]);
  const refreshedRecords = (await f.store.load(f.workItemId)).records;
  const previousReadiness = evaluateReadiness(refreshedRecords,
    evaluation, { clock: f.clock });
  assert.equal(refreshedRecords.some(item => item.id === pr.id), false,
    JSON.stringify(previousReadiness));
  assert.equal(refreshedRecords.some(item => item.id === recordedFacts.id), false);
  assert.deepEqual(await archivedBytes(f, pr.id), prBytes);
  assert.deepEqual(await archivedBytes(f, recordedFacts.id), factsBytes);
  assert.equal(previousReadiness.ready, false);
  assert.deepEqual(previousReadiness.gaps,
    ['qualifying-pr-missing', 'provider-policy-or-check-metadata-unavailable']);
  const historicalReadiness = evaluateReadiness(
    [...refreshedRecords, pr, recordedFacts], evaluation, { clock: f.clock });
  assert.equal(historicalReadiness.ready, false);
  assert.ok(historicalReadiness.gaps.includes('current-pr-observation-differs'),
    JSON.stringify(historicalReadiness));
  await assert.rejects(associateMonitor(f.store, association('build', 0)), { code: 'EVIDENCE' });
  assert.equal((await pruneMonitor(f.store, { runKey: attached.key })).archived, true);
  assert.equal((await readMonitorAssociation(f.store, association('build', 0))).key,
    build.key);
  await assert.rejects(adoptPr(f.store, {
    workItemId: f.workItemId, previousObservationKey: pr.id,
    observation: providerPr,
  }), { code: 'STALE' });
  f.clock.advance(1);
  providerPr = { ...providerPr, state: 'closed',
    observedAt: new Date(f.clock.now()).toISOString(), evidenceRef: 'fixture:pr-closed' };
  const { observation: closed } = await adoptPr(f.store, {
    workItemId: f.workItemId, previousObservationKey: refreshed.id,
    observation: providerPr,
  });
  assert.equal(closed.sequence, 3);
  assert.equal(closed.sourceRevision, refreshed.sourceRevision);
  assert.equal(closed.state, 'closed');
  f.clock.advance(1);
  providerPr = { ...providerPr, targetBranchRef: 'refs/heads/alternate',
    state: 'active', observedAt: new Date(f.clock.now()).toISOString(),
    evidenceRef: 'fixture:pr-retargeted' };
  await assert.rejects(adoptPr(f.store, {
    workItemId: f.workItemId, previousObservationKey: closed.id,
    observation: { ...providerPr, pullRequestRef: 'another-pr' },
  }), { code: 'EVIDENCE' });
  const { observation: retargeted } = await adoptPr(f.store, {
    workItemId: f.workItemId, previousObservationKey: closed.id,
    observation: providerPr,
  });
  assert.equal(retargeted.targetBranchRef, 'refs/heads/alternate');
  assert.equal(retargeted.previousObservationKey, closed.id);
  await f.runGit('remote', 'set-url', 'origin',
    'https://other.invalid/repository.git');
  await assert.rejects(adoptPr(f.store, {
    workItemId: f.workItemId, previousObservationKey: retargeted.id,
    observation: providerPr,
  }), { code: 'EVIDENCE' });
});

test('T-113 selected hosted repository, advanced PR, distinct checks and artifact survive interruption', async t => {
  const f = await coding(await fixture(t, { compactPath: true }));
  const hostedURL = 'https://checks.example.invalid/team/repository.git';
  const otherURL = 'https://checks.example.invalid/team/other.git';
  await f.runGit('remote', 'add', 'hosted', hostedURL);
  await fs.writeFile(path.join(f.repo, '.sdlc', 'config.json'), JSON.stringify({
    remote: 'hosted', environments: { DEV: {
      target: 'dev-target', configDigest: 'config-1',
    } },
  }));
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Disposable PR target');
  const targetRevision = await f.runGit('rev-parse', 'HEAD');
  await f.runGit('commit', '--allow-empty', '-qm', 'Initial PR source');
  const oldRevision = await f.runGit('rev-parse', 'HEAD');
  const repository = await observeFixtureRepository(f, {
    remoteName: 'hosted', revision: oldRevision,
  });
  assert.equal(repository.localRepositoryPath, f.repo);
  assert.equal(repository.remoteRepositoryURL, hostedURL);
  assert.equal(await f.runGit('remote', 'get-url', 'origin'),
    'https://example.invalid/repository.git');
  assert.deepEqual((await f.store.currentRepositoryObservation(
    f.workItemId, 'primary')).selectedFetchRemote, {
    selectedRemoteName: 'hosted', fetchURLs: [hostedURL],
  });

  let hostedPr = {
    repositoryId: 'primary', localRepositoryPath: f.repo,
    remoteRepositoryURL: hostedURL, provider: 'fixture',
    connection: repository.connection, repositoryRef: repository.repositoryRef,
    pullRequestRef: 'pr-17', sourceBranchRef: 'refs/heads/feature/fixture',
    targetBranchRef: 'refs/heads/trunk', sourceRevision: oldRevision,
    targetRevision, state: 'active',
    observedAt: new Date(f.clock.now()).toISOString(),
    evidenceRef: 'fixture:pr-initial',
  };
  const verifyPullRequest = ({ localRepositoryPath, remoteRepositoryURL }) => {
    assert.equal(localRepositoryPath, f.repo);
    assert.equal(remoteRepositoryURL, hostedURL);
    return {
      canonicalLocalRepositoryPath: f.repo,
      verifiedRemoteRepositoryURL: hostedURL,
      verifiedProvider: repository.provider,
      verifiedConnection: repository.connection,
      verifiedRepositoryRef: repository.repositoryRef,
      verifiedPullRequestRef: hostedPr.pullRequestRef,
      verifiedSourceBranchRef: hostedPr.sourceBranchRef,
      verifiedTargetBranchRef: hostedPr.targetBranchRef,
      verifiedSourceRevision: hostedPr.sourceRevision,
      verifiedTargetRevision: hostedPr.targetRevision,
      verifiedState: hostedPr.state, verifiedObservedAt: hostedPr.observedAt,
      verifiedEvidenceRef: hostedPr.evidenceRef,
    };
  };
  f.store.verifyPullRequest = verifyPullRequest;
  const initial = (await adoptPr(f.store, {
    workItemId: f.workItemId, observation: hostedPr,
  })).observation;
  const initialBytes = await fs.readFile(f.store.recordPath(f.workItemId, initial.id));
  await f.runGit('commit', '--allow-empty', '-qm', 'Advance hosted PR source');
  const sourceRevision = await f.runGit('rev-parse', 'HEAD');
  f.clock.advance(1);
  await observeFixtureRepository(f, { remoteName: 'hosted', revision: sourceRevision });
  hostedPr = { ...hostedPr, sourceRevision,
    observedAt: new Date(f.clock.now()).toISOString(),
    evidenceRef: 'fixture:pr-advanced' };
  const pr = (await adoptPr(f.store, {
    workItemId: f.workItemId, previousObservationKey: initial.id,
    observation: hostedPr,
  })).observation;
  assert.equal(pr.previousObservationKey, initial.id);
  assert.equal(pr.sequence, 2);

  registerProviderAdapter({
    id: 'fixture', linkKinds: ['summary'], attemptCapability: 'distinct',
    normalizeLinkObservation(observation) {
      return { identity: observation.identity,
        url: `https://ci.example.invalid/runs/${observation.identity.executionRef}`,
        kind: 'summary', accessible: observation.accessible };
    },
  });
  const definitions = [
    { requiredCheckRef: 'compile', checkResultRef: 'result-compile',
      producerRef: 'fixture-build', executionRef: 'run-build', attemptRef: '2' },
    { requiredCheckRef: 'scan', checkResultRef: 'result-scan',
      producerRef: 'fixture-scan', executionRef: 'run-scan', attemptRef: '5' },
  ];
  const checks = definitions.map(definition => {
    const identity = { provider: 'fixture', connection: repository.connection,
      scopeRef: 'team/repository', definitionRef: definition.producerRef,
      executionRef: definition.executionRef, attemptKind: 'known',
      attemptRef: definition.attemptRef };
    const result = {
      requiredCheckRef: definition.requiredCheckRef,
      checkResultRef: definition.checkResultRef,
      producerRef: definition.producerRef, displayName: 'Verify',
      testedRevision: sourceRevision, status: 'succeeded',
      evidenceRef: `fixture:${definition.checkResultRef}`,
      localRepositoryPath: f.repo, remoteRepositoryURL: hostedURL,
      repositoryRef: repository.repositoryRef, pullRequestRef: pr.pullRequestRef,
      sourceRevision, targetRevision,
    };
    return { identity, result };
  });
  const checkByRun = new Map(checks.map(check => [check.identity.executionRef, check]));
  const verifyCheckResults = ({ identity, status, evidenceReference }) => {
    const check = checkByRun.get(identity.executionRef);
    assert.ok(check, 'Unexpected hosted check execution');
    assert.deepEqual(identity, check.identity);
    assert.equal(status, 'succeeded');
    return { identity: check.identity, status,
      evidenceReference, checkResults: [check.result] };
  };
  f.store.verifyCheckResults = verifyCheckResults;
  const runEvidence = await Promise.all(checks.map(async ({ identity }) => {
    const bytes = Buffer.from(`Immutable result for ${identity.executionRef}:${identity.attemptRef}`);
    const filePath = path.join(f.root, `${identity.executionRef}.bin`);
    await fs.writeFile(filePath, bytes);
    return { filePath, evidence: {
      summary: 'One verified hosted check result',
      reference: { locator: `fixture:${identity.executionRef}`,
        retrievalContext: { provider: 'fixture', connection: repository.connection,
          scopeRef: identity.scopeRef, retrievedAt: new Date(f.clock.now()).toISOString() },
        sha256: digest(bytes) },
    } };
  }));
  const attached = await Promise.all(checks.map(check => attachMonitor(f.store, {
    identity: check.identity, origin: 'framework', workItemId: f.workItemId,
    schedulerAvailable: true, readAvailable: true,
  })));
  const claims = await Promise.all(attached.map((monitor, index) =>
    claimMonitor(f.store, { runKey: monitor.key, workerId: `worker-${index}` })));
  const polling = await Promise.all(attached.map((monitor, index) =>
    beginPoll(f.store, { runKey: monitor.key, workerId: `worker-${index}`,
      claimGeneration: claims[index].claimGeneration })));
  const observe = (store, index, claim, poll) => observeMonitor(store, {
    runKey: attached[index].key, workerId: claim.workerId,
    claimGeneration: claim.claimGeneration, pollGeneration: poll.pollGeneration,
    identity: checks[index].identity, status: 'succeeded',
    evidenceFilePath: runEvidence[index].filePath,
    evidence: runEvidence[index].evidence,
    checkResults: [checks[index].result],
  });
  assert.equal((await observe(f.store, 0, claims[0], polling[0]))
    .evidenceVerification.verified, true);
  const link = (store, index) => verifyMonitorLink(store, {
    runKey: attached[index].key, adapterId: 'fixture',
    observation: { identity: checks[index].identity, accessible: true },
    evidenceRef: `fixture:run-link-${index}`,
  });
  assert.equal((await link(f.store, 0)).link.status, 'verified');
  await interruptMonitor(f.store, {
    runKey: attached[1].key, reason: 'Disposable host process interrupted',
  });
  const { cycle } = await startCycle(f.store, {
    workItemId: f.workItemId, tests: testDefinitions(),
    configDigest: 'config-1', cause: 'Disposable candidate',
  });
  for (const testId of ['T-unit', 'T-integration']) {
    await recordTest(f.store, { workItemId: f.workItemId,
      cycleId: cycle.id, testId, status: 'Passed', owner: 'agent',
      host: 'local', expectedMet: true, evidenceRef: `fixture:${testId}` });
  }
  await completeReview(f, cycle);
  await grant(f, 'dev-authorization', {
    cycleId: cycle.id, candidateDigest: cycle.candidateDigest,
    testSpecDigest: cycle.testSpecDigest, configDigest: cycle.configDigest,
    target: 'dev-target', completedStage: 'review',
  });
  const { operation } = await prepareOperation(f.store, {
    workItemId: f.workItemId, sessionId: f.sessionId,
    action: { class: 'build', repositoryId: 'primary',
      environment: 'DEV', target: 'dev-target', configDigest: cycle.configDigest,
      provider: 'fixture', pipeline: 'fixture-build', monitorCapability: true,
      sourceRevision },
    request: { toolName: 'fixture_build', toolArgs: { executionRef: 'run-build',
      attemptRef: '2' }, cwd: f.repo },
    correlationKey: 'build-current-pr', intent: 'Build the verified candidate',
  });
  registerFixtureProviderRequest(f, operation);
  await markDispatching(f.store, f.workItemId, operation.id);

  const restarted = await new Store(f.home, { clock: f.clock,
    verifyRepository: f.store.verifyRepository,
    verifyPullRequest, verifyCheckResults,
    verifyOperationResult: f.store.verifyOperationResult,
    verifyArtifact: f.store.verifyArtifact,
  }).ready();
  const recovered = await resume(restarted, {
    workItemId: f.workItemId, cwd: f.repo, sessionId: f.sessionId,
  });
  assert.equal((await restarted.load(f.workItemId)).records.find(record =>
    record.id === operation.id).status, 'uncertain');
  assert.equal(f.providerRequests.size, 1);
  assert.equal(recovered.repositories[0].localRepositoryPath, f.repo);
  assert.equal(recovered.repositories[0].remoteRepositoryURL, hostedURL);
  assert.equal((await status(restarted, f.workItemId)).pullRequests[0].id, pr.id);
  const replacement = await claimMonitor(restarted, {
    runKey: attached[1].key, workerId: 'replacement-worker',
    replaceInterrupted: true,
  });
  await assert.rejects(observe(restarted, 1, claims[1], polling[1]),
    { code: 'STALE' });
  const resumedPoll = await beginPoll(restarted, {
    runKey: attached[1].key, workerId: replacement.workerId,
    claimGeneration: replacement.claimGeneration,
  });
  assert.equal((await observe(restarted, 1, replacement, resumedPoll))
    .evidenceVerification.verified, true);
  assert.equal((await link(restarted, 1)).link.status, 'verified');
  assert.equal((await readMonitor(restarted, attached[0].key)).identity.attemptRef, '2');
  assert.equal((await readMonitor(restarted, attached[1].key)).identity.attemptRef, '5');

  const association = index => ({
    runKey: attached[index].key, workItemId: f.workItemId,
    prRecordId: pr.id, prObservationKey: pr.id,
    localRepositoryPath: f.repo, remoteRepositoryURL: hostedURL,
    checkId: checks[index].result.requiredCheckRef,
    requiredCheckRef: checks[index].result.requiredCheckRef,
    checkResultRef: checks[index].result.checkResultRef,
    producerRef: checks[index].result.producerRef,
    testedRevision: sourceRevision, sourceRevision, targetRevision,
    evidenceRef: checks[index].result.evidenceRef,
    evidence: runEvidence[index].evidence,
  });
  await assert.rejects(associateMonitor(restarted, {
    ...association(0), remoteRepositoryURL: otherURL,
  }), { code: 'EVIDENCE' });
  await assert.rejects(associateMonitor(restarted, {
    ...association(0), prRecordId: initial.id, prObservationKey: initial.id,
    sourceRevision: oldRevision, testedRevision: oldRevision,
  }), error => ['EVIDENCE', 'STALE'].includes(error.code));
  await assert.rejects(associateMonitor(restarted, {
    ...association(0), checkResultRef: checks[1].result.checkResultRef,
  }), { code: 'EVIDENCE' });
  await assert.rejects(associateMonitor(restarted, {
    ...association(1), producerRef: checks[0].result.producerRef,
  }), { code: 'EVIDENCE' });
  const associations = [];
  for (let index = 0; index < checks.length; index++) {
    associations.push(await associateMonitor(restarted, association(index)));
    assert.deepEqual(await readMonitorAssociation(restarted, association(index)),
      associations[index]);
  }
  const facts = {
    workItemId: f.workItemId, prRecordId: pr.id,
    policyVersion: 'policy-1', sourceRevision, targetRevision,
    requiredChecks: definitions.map(check => check.requiredCheckRef),
    checks: checks.map(({ identity, result }, index) => ({
      id: result.requiredCheckRef, requiredCheckRef: result.requiredCheckRef,
      checkResultRef: result.checkResultRef, producerRef: result.producerRef,
      testedRevision: sourceRevision, sourceRevision, targetRevision,
      runKey: attached[index].key, identity, status: 'succeeded',
      evidenceRef: result.evidenceRef,
    })),
    providerEvidenceRef: 'fixture:policy-1',
  };
  await updatePrFacts(restarted, facts);
  const evaluation = {
    environment: 'PROD', repositoryId: 'primary', prRecordId: pr.id,
    localRepositoryPath: f.repo, remoteRepositoryURL: hostedURL,
    prId: pr.pullRequestRef, sourceRevision, targetRevision,
    policyVersion: 'policy-1',
  };
  const records = (await restarted.load(f.workItemId)).records;
  const readiness = evaluateReadiness(records, evaluation, { clock: f.clock });
  assert.equal(readiness.verdict, 'satisfied', JSON.stringify(readiness));
  assert.equal(readiness.ready, true, JSON.stringify(readiness));
  assert.ok(evaluateReadiness(records, {
    ...evaluation, remoteRepositoryURL: otherURL,
  }, { clock: f.clock }).gaps.includes('pr-hosted-repository-mismatch'));
  assert.ok(evaluateReadiness(records, {
    ...evaluation, sourceRevision: oldRevision,
  }, { clock: f.clock }).gaps.includes('stale-source-or-target'));
  const previousReadiness = evaluateReadiness(records, {
    ...evaluation, prRecordId: initial.id,
  }, { clock: f.clock });
  assert.equal(records.some(record => record.id === initial.id), false);
  assert.deepEqual(await archivedBytes(f, initial.id), initialBytes);
  assert.equal(previousReadiness.ready, false);
  assert.deepEqual(previousReadiness.gaps,
    ['qualifying-pr-missing', 'provider-policy-or-check-metadata-unavailable']);
  const historicalReadiness = evaluateReadiness([...records, initial], {
    ...evaluation, prRecordId: initial.id,
  }, { clock: f.clock });
  assert.equal(historicalReadiness.ready, false);
  assert.ok(historicalReadiness.gaps.includes('current-pr-observation-differs'),
    JSON.stringify(historicalReadiness));
  await assert.rejects(updatePrFacts(restarted, {
    ...facts, checks: [facts.checks[0], {
      ...facts.checks[1], identity: { ...facts.checks[1].identity, attemptRef: '2' },
    }],
    runMonitorRefs: associations.map(item => item.key),
  }), { code: 'EVIDENCE' });

  const result = registerFixtureProviderResult(f, operation, {
    providerResultId: 'run-build:2',
    result: {
      remoteRepositoryURL: hostedURL, executionRef: 'run-build',
      attemptCapability: 'distinct', attemptRef: '2',
      executionIdentity: checks[0].identity,
      sourceRevision, configDigest: cycle.configDigest,
      candidateDigest: cycle.candidateDigest, testSpecDigest: cycle.testSpecDigest,
      environment: 'DEV', target: 'dev-target',
      provider: 'fixture', pipeline: 'fixture-build',
    },
  });
  const verifiedResult = f.providerResults.get(operation.id);
  f.providerResults.set(operation.id, {
    ...verifiedResult, observation: {
      ...verifiedResult.observation, result: {
        ...verifiedResult.observation.result, remoteRepositoryURL: otherURL,
      },
    },
  });
  const wrongResult = await recordOperation(restarted, {
    workItemId: f.workItemId, operationId: operation.id,
    status: 'succeeded', observedResult: result,
  }, { reconcile: true });
  assert.equal(wrongResult.status, 'uncertain');
  assert.equal(wrongResult.resultProof, undefined);
  f.providerResults.set(operation.id, verifiedResult);
  const built = await recordOperation(restarted, {
    workItemId: f.workItemId, operationId: operation.id,
    status: 'succeeded', observedResult: result,
  }, { reconcile: true });
  assert.equal(f.providerRequests.size, 1);
  assert.equal(built.status, 'succeeded', built.resultGap);
  assert.equal(built.resultProof.providerResultId, 'run-build:2');
  assert.equal(built.resultProof.status, 'succeeded');
  assert.deepEqual(built.resultProof.executionIdentity, checks[0].identity);

  const artifactFields = {
    repositoryId: 'primary', localRepositoryPath: f.repo,
    remoteRepositoryURL: hostedURL, provider: 'fixture',
    connection: repository.connection, repositoryRef: repository.repositoryRef,
    sourceRevision, configDigest: cycle.configDigest,
    artifactId: 'package', artifactRef: 'package-build-2',
    artifactSha256: digest(Buffer.from('immutable disposable artifact')),
    buildRunId: built.resultProof.providerResultId, name: 'package',
    evidenceRef: 'fixture:package-build-2',
  };
  f.artifactVerifications.set(built.id, {
    ...artifactFields, attemptCapability: 'distinct', attemptRef: '2',
    producingExecution: checks[0].identity,
  });
  const selected = await recordArtifact(restarted, {
    workItemId: f.workItemId, cycleId: cycle.id, environment: 'DEV',
    sourceDigest: cycle.candidateDigest, artifactType: 'archive',
    status: 'succeeded', producingOperationId: built.id,
    producerObservation: { fixtureArtifactRef: artifactFields.artifactRef },
    ...artifactFields,
  });
  assert.equal(selected.producingAttemptRef, checks[0].identity.attemptRef);
  assert.deepEqual(selected.producingExecution, built.resultProof.executionIdentity);
  assert.equal(selected.buildRunId, `${checks[0].identity.executionRef}:2`);
  const persisted = await restarted.load(f.workItemId);
  assert.equal(JSON.stringify(persisted.records).includes('fixtureResultId'), false);
  const current = persisted.records.find(record =>
    record.type === 'cycle' && record.id === cycle.id);
  assert.equal(current.artifacts.DEV, selected.id);
  assert.equal(currentArtifact(current, persisted.records, selected), true);
  const artifactEvaluation = {
    ...evaluation, environment: 'DEV', policy: { required: true, validation: true },
    requireArtifact: true, artifactId: selected.artifactId,
  };
  const artifactReadiness = evaluateReadiness(persisted.records,
    artifactEvaluation, { clock: f.clock, cycle: current });
  assert.equal(artifactReadiness.verdict, 'satisfied', JSON.stringify(artifactReadiness));
  assert.equal(artifactReadiness.ready, true, JSON.stringify(artifactReadiness));
  assert.equal(evaluateReadiness(persisted.records, {
    ...artifactEvaluation, remoteRepositoryURL: otherURL,
  }, { clock: f.clock, cycle: current }).ready, false);
  assert.equal(evaluateReadiness(persisted.records, {
    ...artifactEvaluation, sourceRevision: oldRevision,
  }, { clock: f.clock, cycle: current }).ready, false);

  const wrongAttemptArtifact = { ...artifactFields,
    artifactId: 'wrong-attempt-package', artifactRef: 'package-build-5',
    evidenceRef: 'fixture:package-build-5',
  };
  f.artifactVerifications.set(built.id, {
    ...wrongAttemptArtifact, attemptCapability: 'distinct', attemptRef: '5',
    producingExecution: checks[0].identity,
  });
  await assert.rejects(recordArtifact(restarted, {
    workItemId: f.workItemId, cycleId: cycle.id, environment: 'DEV',
    sourceDigest: cycle.candidateDigest, artifactType: 'archive',
    status: 'succeeded', producingOperationId: built.id,
    producerObservation: { fixtureArtifactRef: wrongAttemptArtifact.artifactRef },
    ...wrongAttemptArtifact,
  }), { code: 'EVIDENCE' },
  'An artifact from attempt 5 must not reuse the proven build result of attempt 2');
});
