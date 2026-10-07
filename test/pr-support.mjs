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

export {
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
};
