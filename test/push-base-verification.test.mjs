import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { coding, completeReview, fixture, grant, grantPush, orient,
  observeFixtureRepository } from './helpers.mjs';
import { publicationPaths, verifyPublicationBase } from '../src/git.mjs';
import { evaluateGate } from '../src/gate.mjs';
import { markDispatching, prepareOperation } from '../src/operations.mjs';
import { recordTest, startCycle } from '../src/validation.mjs';

async function observeHostedBranch(f, branchRef, revision, {
  remoteRepositoryURL, observedAt = new Date(f.clock.now()).toISOString(),
  verifiedBranch = { branchRef, revision }, pushURL = true,
} = {}) {
  const url = remoteRepositoryURL ?? await f.runGit('remote', 'get-url',
    ...(pushURL ? ['--push'] : []), 'origin');
  const observation = {
    workItemId: f.workItemId, repositoryId: 'primary',
    selectedRemoteName: 'origin', pushURL,
    localRepositoryPath: f.repo, remoteRepositoryURL: url,
    provider: 'azure-devops', connection: 'fixture',
    repositoryRef: `repository:${url}`, revision,
    defaultBranchRef: branchRef,
    ...(verifiedBranch ? { verifiedBranch } : {}),
    observedAt, evidenceRef: `fixture:${url}:${observedAt}`,
  };
  f.repositoryVerifications.set(url, {
    canonicalLocalRepositoryPath: f.repo,
    verifiedRemoteRepositoryURL: url,
    verifiedProvider: observation.provider,
    verifiedConnection: observation.connection,
    verifiedRepositoryRef: observation.repositoryRef,
    verifiedRevision: revision,
    verifiedDefaultBranchRef: branchRef,
    ...(verifiedBranch ? { verifiedBranch } : {}),
    verifiedObservedAt: observedAt,
    verifiedEvidenceRef: observation.evidenceRef,
  });
  return f.store.observeRepository(observation);
}

test('a fetch tracking base cannot authorize an early document push to a different URL with extra source', async t => {
  const f = await coding(await fixture(t));
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Baseline documents at fetch destination A');
  const fetchBase = await f.runGit('rev-parse', 'HEAD');
  await f.runGit('branch', 'trunk', fetchBase);
  await f.runGit('update-ref', 'refs/remotes/origin/trunk', fetchBase);
  await fs.appendFile(path.join(f.repo, 'docs', 'requirements.md'), '\nDocument-only draft change.\n');
  await f.runGit('add', 'docs/requirements.md');
  await f.runGit('commit', '-qm', 'Document-only source commit');
  const sourceRevision = await f.runGit('rev-parse', 'HEAD');

  await f.runGit('switch', '-q', '-c', 'push-destination-base', fetchBase);
  await fs.mkdir(path.join(f.repo, 'src'));
  await fs.writeFile(path.join(f.repo, 'src', 'unreviewed.mjs'), 'export const extra = true;\n');
  await f.runGit('add', 'src/unreviewed.mjs');
  await f.runGit('commit', '-qm', 'Source present only at push destination B');
  const pushBase = await f.runGit('rev-parse', 'HEAD');
  await f.runGit('switch', '-q', 'feature/fixture');
  await f.runGit('branch', '-f', 'trunk', pushBase);
  assert.deepEqual((await f.runGit('diff', '--name-only', `${fetchBase}..${sourceRevision}`)).split('\n'),
    ['docs/requirements.md']);
  assert.deepEqual((await f.runGit('diff', '--name-only', `${pushBase}..${sourceRevision}`)).split('\n'),
    ['docs/requirements.md', 'src/unreviewed.mjs']);
  const member = (await f.store.load(f.workItemId)).metadata.members[0];
  assert.deepEqual(await publicationPaths(member, sourceRevision, pushBase),
    ['docs/requirements.md', 'src/unreviewed.mjs'],
    'The hosted base must be compared as a tree, not reduced to a merge base');

  const fetch = await observeFixtureRepository(f, {
    provider: 'azure-devops', connection: 'fixture',
    repositoryRef: 'fetch-repository-A', revision: fetchBase,
    defaultBranchRef: 'refs/heads/trunk',
  });
  const pushURL = 'https://push.example.invalid/repository.git';
  await f.runGit('remote', 'set-url', '--push', 'origin', pushURL);
  const B = await observeHostedBranch(f, 'refs/heads/trunk', pushBase);
  assert.notEqual(fetch.remoteRepositoryURL, B.remoteRepositoryURL);
  assert.equal(await f.runGit('rev-parse', 'refs/remotes/origin/trunk'), fetchBase);
  assert.equal(await f.runGit('rev-parse', 'refs/heads/trunk'), pushBase);
  const records = await f.store.records(f.workItemId);
  await assert.rejects(verifyPublicationBase(member, 'origin', 'refs/heads/trunk',
    fetchBase, records, f.clock), { code: 'EVIDENCE', message: /not proven/u });
  assert.equal(await verifyPublicationBase(member, 'origin', 'refs/heads/trunk',
    pushBase, records, f.clock), pushBase);

  const publication = {
    repositoryId: 'primary', sourceRef: 'refs/heads/feature/fixture',
    targetRef: 'refs/heads/trunk', draft: true, target: 'origin',
    localRepositoryPath: f.repo, remoteRepositoryURL: pushURL,
    sourceRepositoryURL: pushURL,
  };
  await grant(f, 'pr-publication', publication, {
    prepared: true, input: 'I authorize the draft PR at the separately verified push destination B.',
  });
  const command = 'git push --no-follow-tags --no-recurse-submodules origin refs/heads/feature/fixture:refs/heads/feature/fixture';
  const { action } = await grantPush(f, command, { repositoryObservation: B });
  const request = { toolName: 'bash', toolArgs: { command }, cwd: f.repo };
  const prepare = (candidateAction, correlationKey) => prepareOperation(f.store, {
    workItemId: f.workItemId, sessionId: f.sessionId, action: candidateAction,
    request, correlationKey, intent: 'Prepare only; never dispatch a Git push',
  });
  await assert.rejects(prepare({
    ...action, earlyDraft: true, draft: true,
    baseRef: 'refs/heads/trunk', targetRevision: fetchBase,
    paths: ['docs/requirements.md'],
  }, 'mismatched-base-early-draft'), { code: 'EVIDENCE', message: /not proven/u });
  await assert.rejects(prepare({
    ...action, earlyDraft: true, draft: true,
    baseRef: 'refs/heads/trunk', targetRevision: pushBase,
    paths: ['docs/requirements.md'],
  }, 'missing-source-from-push-base'), { code: 'EVIDENCE',
    message: /paths must exactly match/u });
  assert.equal((await f.store.records(f.workItemId))
    .filter(record => record.type === 'operation').length, 0);

  const { cycle } = await startCycle(f.store, {
    workItemId: f.workItemId, configDigest: 'v1',
    cause: 'Review the entire source candidate before publication to B',
  });
  for (const testId of ['T-unit', 'T-integration']) {
    await recordTest(f.store, {
      workItemId: f.workItemId, cycleId: cycle.id, testId,
      status: 'Passed', expectedMet: true, evidenceRef: `fixture:${testId}`,
      owner: 'agent', host: 'local',
    });
  }
  await completeReview(f, cycle);
  const { operation } = await prepare(action, 'reviewed-source-to-B');
  assert.equal(operation.status, 'prepared');
  assert.equal(operation.action.earlyDraft, undefined);
  assert.equal(operation.intendedOutcome.target.remoteRepositoryURL, pushURL);
  assert.equal(operation.action.sourceRevision, sourceRevision);
  assert.equal(f.providerRequests.size, 0);
  assert.equal(f.providerResults.size, 0);
});

test('a verified hosted branch, not an identical-URL tracking ref, proves the draft base', async t => {
  const f = await fixture(t);
  await f.runGit('commit', '--allow-empty', '-qm', 'Tracked target at both URLs');
  const targetRevision = await f.runGit('rev-parse', 'HEAD');
  await f.runGit('update-ref', 'refs/remotes/origin/trunk', targetRevision);
  await f.runGit('commit', '--allow-empty', '-qm', 'Different source revision');
  const sourceRevision = await f.runGit('rev-parse', 'HEAD');
  const member = (await f.store.load(f.workItemId)).metadata.members[0];
  assert.equal(await f.runGit('remote', 'get-url', 'origin'),
    await f.runGit('remote', 'get-url', '--push', 'origin'));
  await assert.rejects(verifyPublicationBase(member, 'origin', 'refs/heads/trunk',
    targetRevision, [], f.clock), { code: 'EVIDENCE' });
  const observation = await observeHostedBranch(f, 'refs/heads/trunk', targetRevision);
  const records = await f.store.records(f.workItemId);
  assert.deepEqual(observation.verifiedBranch,
    { branchRef: 'refs/heads/trunk', revision: targetRevision });
  assert.equal(await verifyPublicationBase(member, 'origin', 'refs/heads/trunk',
    targetRevision, records, f.clock), targetRevision);
  await assert.rejects(verifyPublicationBase(member, 'origin', 'refs/heads/trunk',
    sourceRevision, records, f.clock), { code: 'EVIDENCE', message: /not proven/u });
  await assert.rejects(verifyPublicationBase(member, 'origin', 'refs/heads/other',
    targetRevision, records, f.clock), { code: 'EVIDENCE', message: /not proven/u });
  await assert.rejects(verifyPublicationBase(member, 'origin', 'refs/heads/trunk',
    targetRevision, records, { now: () => f.clock.now() - 1 }),
  { code: 'STALE', message: /from the future/u });
  f.clock.advance(60_000);
  assert.equal(await verifyPublicationBase(member, 'origin', 'refs/heads/trunk',
    targetRevision, records, f.clock), targetRevision);
  f.clock.advance(1);
  await assert.rejects(verifyPublicationBase(member, 'origin', 'refs/heads/trunk',
    targetRevision, records, f.clock), { code: 'STALE', message: /older than 60 seconds/u });
});

test('an early document push prepared at A cannot dispatch after the push URL changes to B', async t => {
  const f = await coding(await fixture(t));
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Document target at fetch and push A');
  const targetRevision = await f.runGit('rev-parse', 'HEAD');
  await f.runGit('update-ref', 'refs/remotes/origin/trunk', targetRevision);
  await fs.appendFile(path.join(f.repo, 'docs', 'requirements.md'), '\nDraft correction.\n');
  await f.runGit('add', 'docs/requirements.md');
  await f.runGit('commit', '-qm', 'Document-only draft');
  const repositoryObservation = await observeHostedBranch(f, 'refs/heads/trunk',
    targetRevision);
  await grant(f, 'pr-publication', {
    repositoryId: 'primary', sourceRef: 'refs/heads/feature/fixture',
    targetRef: 'refs/heads/trunk', draft: true, target: 'origin',
    localRepositoryPath: f.repo, remoteRepositoryURL: repositoryObservation.remoteRepositoryURL,
    sourceRepositoryURL: repositoryObservation.remoteRepositoryURL,
  });
  const command = 'git push --no-follow-tags --no-recurse-submodules origin refs/heads/feature/fixture:refs/heads/feature/fixture';
  const { action } = await grantPush(f, command, { repositoryObservation });
  const { operation } = await prepareOperation(f.store, {
    workItemId: f.workItemId, sessionId: f.sessionId,
    action: {
      ...action, earlyDraft: true, draft: true,
      baseRef: 'refs/heads/trunk', targetRevision,
      paths: ['docs/requirements.md'],
    },
    request: { toolName: 'bash', toolArgs: { command }, cwd: f.repo },
    correlationKey: 'early-draft-before-url-change',
    intent: 'Prepare only, without publishing',
  });
  assert.equal(operation.status, 'prepared');
  await markDispatching(f.store, f.workItemId, operation.id);
  f.clock.advance(1);
  await observeHostedBranch(f, 'refs/heads/trunk', targetRevision,
    { verifiedBranch: null });
  const request = { cwd: f.repo, sessionId: f.sessionId, toolName: 'bash',
    toolArgs: { command } };
  const denied = await evaluateGate(f.store, request);
  assert.equal(denied.permissionDecision, 'deny');
  assert.match(denied.permissionDecisionReason, /Early draft base branch and revision are not proven/u);
  await assert.rejects(markDispatching(f.store, f.workItemId, operation.id),
    { code: 'EVIDENCE', message: /not proven/u });
  f.clock.advance(1);
  await observeHostedBranch(f, 'refs/heads/trunk', targetRevision);
  await f.runGit('remote', 'set-url', '--push', 'origin', 'https://push.example.invalid/repository.git');
  await assert.rejects(markDispatching(f.store, f.workItemId, operation.id),
    { code: 'EVIDENCE', message: /current selected push destination/u });
  assert.equal((await f.store.records(f.workItemId))
    .find(record => record.id === operation.id).dispatchBound, false);
  assert.equal(f.providerRequests.size, 0);
  assert.equal(f.providerResults.size, 0);
});

test('repointing both URLs to B does not transfer A tracking proof; fresh B branch proof does', async t => {
  const f = await fixture(t);
  await f.runGit('commit', '--allow-empty', '-qm', 'A target');
  const A = await f.runGit('rev-parse', 'HEAD');
  await f.runGit('update-ref', 'refs/remotes/origin/trunk', A);
  await f.runGit('commit', '--allow-empty', '-qm', 'B target');
  const B = await f.runGit('rev-parse', 'HEAD');
  const member = (await f.store.load(f.workItemId)).metadata.members[0];
  const urlB = 'https://push.example.invalid/repointed.git';
  await f.runGit('remote', 'set-url', 'origin', urlB);
  await f.runGit('remote', 'set-url', '--push', 'origin', urlB);
  assert.equal(await f.runGit('remote', 'get-url', 'origin'),
    await f.runGit('remote', 'get-url', '--push', 'origin'));
  assert.equal(await f.runGit('rev-parse', 'refs/remotes/origin/trunk'), A);
  await assert.rejects(verifyPublicationBase(member, 'origin',
    'refs/heads/trunk', A, [], f.clock), { code: 'EVIDENCE' });
  const legacy = await observeHostedBranch(f, 'refs/heads/trunk', B,
    { verifiedBranch: null });
  assert.equal(legacy.verifiedBranch, undefined);
  await assert.rejects(verifyPublicationBase(member, 'origin',
    'refs/heads/trunk', B, await f.store.records(f.workItemId), f.clock),
  { code: 'EVIDENCE', message: /not proven/u });
  f.clock.advance(1);
  const proven = await observeHostedBranch(f, 'refs/heads/trunk', B);
  assert.equal(await verifyPublicationBase(member, 'origin',
    'refs/heads/trunk', B, await f.store.records(f.workItemId), f.clock),
  proven.verifiedBranch.revision);
  await assert.rejects(verifyPublicationBase(member, 'origin',
    'refs/heads/trunk', A, await f.store.records(f.workItemId), f.clock),
  { code: 'EVIDENCE', message: /not proven/u });
  f.clock.advance(1);
  await observeHostedBranch(f, 'refs/heads/trunk', B,
    { verifiedBranch: null });
  await assert.rejects(verifyPublicationBase(member, 'origin',
    'refs/heads/trunk', B, await f.store.records(f.workItemId), f.clock),
  { code: 'EVIDENCE', message: /not proven/u });
});

test('a first document-only draft to a distinct push URL and nondefault base prepares with B proof', async t => {
  const f = await coding(await fixture(t));
  await fs.writeFile(path.join(f.repo, '.sdlc', 'config.json'),
    '{"defaultBranch":"refs/heads/release/next"}\n');
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Baseline on the nondefault target');
  const targetRevision = await f.runGit('rev-parse', 'HEAD');
  await f.runGit('update-ref', 'refs/remotes/origin/release/next', targetRevision);
  await fs.appendFile(path.join(f.repo, 'docs', 'requirements.md'),
    '\nEarly draft for the release branch.\n');
  await f.runGit('add', 'docs/requirements.md');
  await f.runGit('commit', '-qm', 'Early document candidate');
  const pushURL = 'https://push.example.invalid/release.git';
  await f.runGit('remote', 'set-url', '--push', 'origin', pushURL);
  const repositoryObservation = await observeHostedBranch(f,
    'refs/heads/release/next', targetRevision);
  await grant(f, 'pr-publication', {
    repositoryId: 'primary', sourceRef: 'refs/heads/feature/fixture',
    targetRef: 'refs/heads/release/next', draft: true, target: 'origin',
    localRepositoryPath: f.repo, remoteRepositoryURL: pushURL,
    sourceRepositoryURL: pushURL,
  });
  const command = 'git push --no-follow-tags --no-recurse-submodules origin refs/heads/feature/fixture:refs/heads/feature/fixture';
  const { action } = await grantPush(f, command, { repositoryObservation });
  await orient(f);
  const { operation } = await prepareOperation(f.store, {
    workItemId: f.workItemId, sessionId: f.sessionId,
    action: { ...action, earlyDraft: true, draft: true,
      baseRef: 'refs/heads/release/next', targetRevision,
      paths: ['docs/requirements.md'] },
    request: { toolName: 'bash', toolArgs: { command }, cwd: f.repo },
    correlationKey: 'verified-nondefault-B-draft',
    intent: 'Prepare the first document-only draft; never publish',
  });
  assert.equal(operation.status, 'prepared');
  assert.equal(operation.action.remoteRepositoryURL, pushURL);
  assert.equal((await markDispatching(f.store, f.workItemId, operation.id)).status,
    'dispatching');
  const result = await evaluateGate(f.store, {
    cwd: f.repo, sessionId: f.sessionId, toolName: 'bash',
    toolArgs: { command },
  });
  assert.deepEqual(result, {});
  assert.equal((await f.store.records(f.workItemId))
    .find(record => record.id === operation.id).dispatchBound, true);
  assert.equal(f.providerRequests.size, 0);
});

test('early fork PR hosted at fetch A uses A branch proof, never fork push B proof', async t => {
  const f = await coding(await fixture(t));
  const hostedURL = await f.runGit('remote', 'get-url', 'origin');
  const forkURL = 'https://fork.example.invalid/repository.git';
  const actionTemplate = {
    class: 'pr-create', repositoryId: 'primary',
    provider: 'azure-devops', target: 'origin',
    sourceRef: 'refs/heads/feature/fixture', targetRef: 'refs/heads/trunk',
    localRepositoryPath: f.repo, remoteRepositoryURL: hostedURL,
    sourceRepositoryURL: forkURL, draft: true, earlyDraft: true,
    paths: ['docs/requirements.md'],
  };
  await fs.writeFile(path.join(f.repo, '.sdlc', 'config.json'),
    `${JSON.stringify({ defaultBranch: 'refs/heads/trunk', toolAdapters: [{
      toolName: 'fixture_create_pr',
      arguments: {
        sourceRevision: { required: true, type: 'string', actionField: 'sourceRevision' },
        targetRevision: { required: true, type: 'string', actionField: 'targetRevision' },
      },
      action: actionTemplate,
    }] })}\n`);
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Document baseline hosted at A');
  const targetRevision = await f.runGit('rev-parse', 'HEAD');
  await fs.appendFile(path.join(f.repo, 'docs', 'requirements.md'),
    '\nEarly draft for A from fork B.\n');
  await f.runGit('add', 'docs/requirements.md');
  await f.runGit('commit', '-qm', 'Document-only fork source');
  const sourceRevision = await f.runGit('rev-parse', 'HEAD');
  await f.runGit('remote', 'set-url', '--push', 'origin', forkURL);
  const hosted = await observeHostedBranch(f, 'refs/heads/trunk',
    targetRevision, { pushURL: false, verifiedBranch: null });
  const fork = await observeHostedBranch(f, 'refs/heads/trunk', targetRevision);
  assert.equal(hosted.remoteRepositoryURL, hostedURL);
  assert.equal(fork.remoteRepositoryURL, forkURL);
  await grant(f, 'pr-publication', {
    repositoryId: 'primary', sourceRef: actionTemplate.sourceRef,
    targetRef: actionTemplate.targetRef, draft: true, target: 'origin',
    localRepositoryPath: f.repo, remoteRepositoryURL: hostedURL,
    sourceRepositoryURL: forkURL,
  });
  await orient(f);
  const action = { ...actionTemplate, sourceRevision, targetRevision };
  const request = { toolName: 'fixture_create_pr',
    toolArgs: { sourceRevision, targetRevision }, cwd: f.repo };
  const prepare = correlationKey => prepareOperation(f.store, {
    workItemId: f.workItemId, sessionId: f.sessionId, action,
    request, correlationKey, intent: 'Prepare only; never create a PR',
  });
  await assert.rejects(prepare('fork-proof-only-at-B'), {
    code: 'EVIDENCE', message: /not proven for the selected hosted destination/u,
  });
  const member = (await f.store.load(f.workItemId)).metadata.members[0];
  await assert.rejects(verifyPublicationBase(member, 'origin',
    action.targetRef, targetRevision, await f.store.records(f.workItemId),
    f.clock, { actionClass: 'pr-update', remoteRepositoryURL: hostedURL }),
  { code: 'EVIDENCE', message: /not proven/u });
  f.clock.advance(1);
  await observeHostedBranch(f, 'refs/heads/trunk', targetRevision,
    { pushURL: false });
  assert.equal(await verifyPublicationBase(member, 'origin', action.targetRef,
    targetRevision, await f.store.records(f.workItemId), f.clock,
    { actionClass: 'pr-update', remoteRepositoryURL: hostedURL }), targetRevision);
  const { operation } = await prepare('fork-proof-at-A');
  assert.equal(operation.status, 'prepared');
  assert.equal(operation.intendedOutcome.target.remoteRepositoryURL, hostedURL);
  assert.equal(operation.intendedOutcome.requested.sourceRepositoryURL, forkURL);
  f.clock.advance(1);
  await observeHostedBranch(f, 'refs/heads/trunk', sourceRevision,
    { pushURL: false });
  await assert.rejects(markDispatching(f.store, f.workItemId, operation.id),
    { code: 'EVIDENCE', message: /not proven/u });
  f.clock.advance(1);
  await observeHostedBranch(f, 'refs/heads/trunk', targetRevision,
    { pushURL: false });
  f.clock.advance(60_001);
  await assert.rejects(markDispatching(f.store, f.workItemId, operation.id),
    { code: 'STALE', message: /older than 60 seconds/u });
  f.clock.advance(1);
  await observeHostedBranch(f, 'refs/heads/trunk', targetRevision,
    { pushURL: false });
  assert.equal((await markDispatching(f.store, f.workItemId, operation.id)).status,
    'dispatching');
  f.clock.advance(1);
  await observeHostedBranch(f, 'refs/heads/trunk', sourceRevision,
    { pushURL: false });
  const denied = await evaluateGate(f.store, {
    ...request, sessionId: f.sessionId,
  });
  assert.equal(denied.permissionDecision, 'deny');
  assert.match(denied.permissionDecisionReason, /not proven for the selected hosted destination/u);
  f.clock.advance(1);
  await observeHostedBranch(f, 'refs/heads/trunk', targetRevision,
    { pushURL: false });
  assert.deepEqual(await evaluateGate(f.store, {
    ...request, sessionId: f.sessionId,
  }), {});
  assert.equal((await f.store.records(f.workItemId))
    .find(record => record.id === operation.id).dispatchBound, true);
  assert.equal(f.providerRequests.size, 0);
  assert.equal(f.providerResults.size, 0);
});
