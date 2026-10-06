import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import { fixture, cli } from './helpers.mjs';
import { Store } from '../src/store.mjs';
import { selectedFetchRemote, identity } from '../src/git.mjs';
import { loadConfig } from '../src/artifacts.mjs';
import { evaluateGate as gate } from '../src/gate.mjs';
import { status } from '../src/recovery.mjs';
import { resume } from '../src/recovery.mjs';
import { registerRepositoryObservationAdapter, resolveRepositoryDefaultBranch } from '../src/repository-observations.mjs';
import {
  pullRequestIdentityKey,
  pullRequestObservationKey,
  resolveDefaultBranch,
  validatePullRequestObservation,
  validatePullRequestTransition,
  validateRepositoryObservation,
} from '../src/repository-observations.mjs';

const checkout = path.resolve('fixture', 'checkout');
const remote = 'https://git.example.invalid/team/repo.git';
const fork = 'https://git.example.invalid/team/fork.git';
const proof = {
  canonicalLocalRepositoryPath: checkout,
  verifiedRemoteRepositoryURL: remote,
  verifiedProvider: 'fixture',
  verifiedConnection: 'primary',
  verifiedRepositoryRef: 'repository-17',
  verifiedPullRequestRef: 'pr-19',
  verifiedSourceRepositoryURL: fork,
};
const initial = {
  localRepositoryPath: checkout, remoteRepositoryURL: remote,
  provider: 'fixture', connection: 'primary', repositoryRef: 'repository-17',
  pullRequestRef: 'pr-19', sourceRepositoryURL: fork,
  sourceBranchRef: 'refs/heads/feature', targetBranchRef: 'refs/heads/main',
  sourceRevision: 'a'.repeat(40), targetRevision: 'b'.repeat(40),
  state: 'active', sequence: 1, evidenceRef: 'provider-pr-1',
  observedAt: '2026-01-01T00:00:00.000Z',
};
const refresh = overrides => ({
  ...initial, sequence: 2, previousObservationKey: pullRequestObservationKey(initial, proof),
  observedAt: '2026-01-02T00:00:00.000Z', evidenceRef: 'provider-pr-2',
  ...overrides,
});

test('T-101 repository branch evidence requires an exact adapter-verified branch/revision pair', () => {
  const observation = {
    localRepositoryPath: checkout, remoteRepositoryURL: remote,
    provider: 'fixture', connection: 'primary', repositoryRef: 'repository-17',
    revision: 'a'.repeat(40), defaultBranchRef: 'refs/heads/main',
    verifiedBranch: { branchRef: 'refs/heads/release', revision: 'b'.repeat(40) },
    observedAt: initial.observedAt, evidenceRef: 'provider-branch-release',
  };
  const verification = {
    canonicalLocalRepositoryPath: checkout, verifiedRemoteRepositoryURL: remote,
    verifiedProvider: 'fixture', verifiedConnection: 'primary',
    verifiedRepositoryRef: 'repository-17',
    verifiedBranch: observation.verifiedBranch,
  };
  assert.deepEqual(validateRepositoryObservation(observation, verification).verifiedBranch,
    observation.verifiedBranch);
  assert.equal(validateRepositoryObservation({
    ...observation, verifiedBranch: undefined,
  }, { ...verification, verifiedBranch: undefined }).verifiedBranch, undefined);
  for (const [changed, checked] of [
    [{ ...observation, verifiedBranch: undefined }, verification],
    [observation, { ...verification, verifiedBranch: undefined }],
    [observation, { ...verification, verifiedBranch: {
      ...observation.verifiedBranch, branchRef: 'refs/heads/main',
    } }],
    [observation, { ...verification, verifiedBranch: {
      ...observation.verifiedBranch, revision: observation.revision,
    } }],
    [{ ...observation, verifiedBranch: {
      ...observation.verifiedBranch, revision: 'bad',
    } }, verification],
    [{ ...observation, verifiedBranch: {
      ...observation.verifiedBranch, extra: 'not-a-proof',
    } }, verification],
  ]) {
    assert.throws(() => validateRepositoryObservation(changed, checked),
      { code: changed.verifiedBranch?.revision === 'bad' ||
        changed.verifiedBranch?.extra ? 'INPUT' : 'EVIDENCE' });
  }
});

test('T-102 default branch requires a full configured ref or matching current remote observation', () => {
  const repositoryObservation = {
    localRepositoryPath: checkout, remoteRepositoryURL: remote,
    provider: 'fixture', connection: 'primary', repositoryRef: 'repository-17',
    revision: initial.targetRevision, defaultBranchRef: 'refs/heads/main',
    observedAt: initial.observedAt, evidenceRef: 'provider-repository-1',
  };
  const selectedFetchRemote = {
    selectedRemoteName: 'some-non-origin-name', fetchURLs: [remote],
  };
  const repositoryProof = {
    canonicalLocalRepositoryPath: checkout, verifiedRemoteRepositoryURL: remote,
    verifiedProvider: 'fixture', verifiedConnection: 'primary',
    verifiedRepositoryRef: 'repository-17',
  };
  assert.deepEqual(resolveDefaultBranch({
    selectedFetchRemote, repositoryObservation, verification: repositoryProof,
  }), { resolved: true, branchRef: 'refs/heads/main', source: 'provider-observation' });
  assert.deepEqual(resolveDefaultBranch({
    configuredDefaultBranchRef: 'refs/heads/main',
  }), { resolved: true, branchRef: 'refs/heads/main', source: 'configuration' });
  assert.deepEqual(resolveDefaultBranch({
    selectedFetchRemote: { ...selectedFetchRemote, selectedRemoteName: 'renamed' },
    repositoryObservation, verification: repositoryProof,
  }), { resolved: true, branchRef: 'refs/heads/main', source: 'provider-observation' });
  assert.equal(resolveDefaultBranch({
    selectedFetchRemote: { ...selectedFetchRemote, fetchURLs:
      ['https://git.example.invalid/other/repo.git'] },
    repositoryObservation, verification: repositoryProof,
  }).resolved, false);
  assert.equal(resolveDefaultBranch({
    selectedFetchRemote, repositoryObservation: {
      ...repositoryObservation, defaultBranchRef: undefined,
    }, verification: repositoryProof,
  }).resolved, false);
  assert.equal(resolveDefaultBranch({ selectedFetchRemote }).resolved, false);
  assert.equal(resolveDefaultBranch({}).resolved, false);
  assert.equal(resolveDefaultBranch({
    selectedFetchRemote, repositoryObservation, verification: repositoryProof,
    configuredDefaultBranchRef: 'refs/heads/release',
  }).resolved, false);
  assert.throws(() => resolveDefaultBranch({
    selectedFetchRemote: { ...selectedFetchRemote, fetchURLs: [remote, remote] },
  }), { code: 'EVIDENCE' });
  assert.throws(() => resolveDefaultBranch({
    configuredDefaultBranchRef: 'main',
  }), { code: 'INPUT' });
});

test('T-103 fork branch names remain disambiguated by verified hosted repositories', () => {
  const sameNames = { ...initial, sourceBranchRef: 'refs/heads/main' };
  assert.deepEqual(validatePullRequestObservation(sameNames, proof), sameNames);
  assert.notEqual(pullRequestIdentityKey(initial, proof), pullRequestIdentityKey({
    ...initial, localRepositoryPath: path.resolve('fixture', 'other'),
  }, { ...proof, canonicalLocalRepositoryPath: path.resolve('fixture', 'other') }));
  assert.notEqual(pullRequestIdentityKey(initial, proof), pullRequestIdentityKey({
    ...initial, remoteRepositoryURL: fork, repositoryRef: 'fork-repo',
    sourceRepositoryURL: remote,
  }, { ...proof, verifiedRemoteRepositoryURL: fork, verifiedRepositoryRef: 'fork-repo',
    verifiedSourceRepositoryURL: remote }));
  assert.throws(() => validatePullRequestObservation(initial,
    { ...proof, verifiedSourceRepositoryURL: remote }), { code: 'EVIDENCE' });
  assert.throws(() => validatePullRequestObservation(initial,
    { ...proof, verifiedPullRequestRef: 'other-pr' }), { code: 'EVIDENCE' });
});

test('T-103 revisions, retargeting, and state-only refresh version the same PR', () => {
  for (const changed of [
    refresh({ sourceRevision: 'c'.repeat(40) }),
    refresh({ targetBranchRef: 'refs/heads/release', targetRevision: 'd'.repeat(40) }),
    refresh({ state: 'closed' }),
  ]) {
    assert.deepEqual(validatePullRequestTransition(initial, changed, proof, proof), changed);
    assert.equal(pullRequestIdentityKey(initial, proof), pullRequestIdentityKey(changed, proof));
    assert.notEqual(pullRequestObservationKey(initial, proof),
      pullRequestObservationKey(changed, proof));
  }
  assert.throws(() => validatePullRequestTransition(initial,
    refresh({ pullRequestRef: 'other-pr' }), proof,
    { ...proof, verifiedPullRequestRef: 'other-pr' }), { code: 'ID_CONFLICT' });
  for (const invalid of [
    refresh({ sequence: 3 }),
    refresh({ previousObservationKey: 'pr-observation-' + '0'.repeat(40) }),
    refresh({ previousObservationKey: pullRequestObservationKey(
      refresh({ state: 'closed' }), proof) }),
  ]) {
    assert.throws(() => validatePullRequestTransition(initial, invalid, proof, proof),
      { code: 'STALE' });
  }
});

test('T-103 malformed, absent, duplicate and wrong-destination PR observations fail explicitly', () => {
  const other = 'https://git.example.invalid/other/repo.git';
  for (const [changed, verification] of [
    [{ ...initial, remoteRepositoryURL: other }, proof],
    [{ ...initial, sourceRepositoryURL: other }, proof],
    [{ ...initial, sourceRevision: 'short' }, proof],
    [{ ...initial, sourceBranchRef: 'feature' }, proof],
    [{ ...initial, sequence: 2 }, proof],
    [{ ...initial, sequence: 0 }, proof],
    [{ ...initial, previousObservationKey: 'pr-observation-' + '0'.repeat(40) }, proof],
    [{ ...initial, targetBranchRef: 'refs/heads/../main' }, proof],
    [{ ...initial, extraneous: true }, proof],
    [{ ...initial, sourceRepositoryURL: undefined }, proof],
    [initial, { ...proof, verifiedRemoteRepositoryURL: other }],
  ]) {
    assert.throws(() => validatePullRequestObservation(changed, verification));
  }
});

function verifiedStore(f) {
  return new Store(f.home, { clock: f.clock, verifyRepository: async ({
    provider, adapterObservation, localRepositoryPath, remoteRepositoryURL,
  }) => ({
    canonicalLocalRepositoryPath: localRepositoryPath,
    verifiedRemoteRepositoryURL: remoteRepositoryURL,
    verifiedProvider: provider,
    verifiedConnection: adapterObservation.connection,
    verifiedRepositoryRef: adapterObservation.repositoryRef,
    verifiedRevision: adapterObservation.revision,
    verifiedDefaultBranchRef: adapterObservation.defaultBranchRef,
    verifiedObservedAt: adapterObservation.observedAt,
    verifiedEvidenceRef: adapterObservation.evidenceRef,
  }) });
}
function repositoryInput(f, overrides = {}) {
  const fields = {
    workItemId: f.workItemId, repositoryId: 'primary',
    localRepositoryPath: f.repo, remoteRepositoryURL: remote,
    provider: 'fixture', connection: 'primary', repositoryRef: 'repository-17',
    revision: 'a'.repeat(40), defaultBranchRef: 'refs/heads/main',
    observedAt: '2026-09-08T00:00:00.000Z', evidenceRef: 'read-1',
    ...overrides,
  };
  return { ...fields, adapterObservation: {
    connection: fields.connection, repositoryRef: fields.repositoryRef,
    revision: fields.revision, defaultBranchRef: fields.defaultBranchRef,
    observedAt: fields.observedAt, evidenceRef: fields.evidenceRef,
  } };
}

test('T-101 repository observe persists distinct pairs, exact replay, and rejects contradictory or stale refreshes', async t => {
  const f = await fixture(t);
  const store = verifiedStore(f);
  await f.runGit('remote', 'set-url', 'origin', remote);
  const first = await store.observeRepository(repositoryInput(f));
  const originalBytes = await fs.readFile(store.recordPath(f.workItemId, first.id));
  const revision = (await store.load(f.workItemId)).checkpoint.revision;
  assert.equal((await store.observeRepository(repositoryInput(f))).id, first.id);
  assert.equal((await store.load(f.workItemId)).checkpoint.revision, revision);
  await assert.rejects(store.observeRepository(repositoryInput(f, {
    revision: 'b'.repeat(40),
  })), { code: 'ID_CONFLICT' });
  const newer = await store.observeRepository(repositoryInput(f, {
    observedAt: '2026-09-09T00:00:00.000Z', revision: 'b'.repeat(40),
    evidenceRef: 'read-2',
  }));
  assert.notEqual(first.id, newer.id);
  await assert.rejects(store.observeRepository(repositoryInput(f)), { code: 'STALE' });
  assert.equal((await store.currentRepositoryObservation(f.workItemId, 'primary'))
    .observation.id, newer.id);
  assert.deepEqual((await store.records(f.workItemId))
    .filter(record => record.type === 'repository-observation')
    .map(record => record.id).sort(), [newer.id]);
  assert.deepEqual(await fs.readFile(path.join(store.workPath(f.workItemId),
    'evidence', `${first.id}.json`)), originalBytes);
  const other = 'https://git.example.invalid/team/other.git';
  await f.runGit('remote', 'add', 'mirror', other);
  const alternate = await store.observeRepository(repositoryInput(f, {
    selectedRemoteName: 'mirror', remoteRepositoryURL: other,
    repositoryRef: 'repository-18',
  }));
  assert.notEqual(first.id, alternate.id);
  assert.equal((await store.currentRepositoryObservation(f.workItemId,
    'primary', 'mirror')).observation.id, alternate.id);
  const statusResult = await status(store, f.workItemId);
  assert.equal(statusResult.repositories[0].remoteRepositoryURL, null);
  assert.match(statusResult.repositories[0].evidenceGap, /Select a Git remote/u);
});

test('T-101 a distinct push URL needs its own trusted observation without changing fetch observations', async t => {
  const f = await fixture(t);
  const store = verifiedStore(f);
  const pushURL = 'git@git.example.invalid:team/repo.git';
  await f.runGit('remote', 'set-url', 'origin', remote);
  await f.runGit('remote', 'set-url', '--push', 'origin', pushURL);
  const fetchObservation = await store.observeRepository(repositoryInput(f));
  const pushInput = repositoryInput(f, {
    pushURL: true, remoteRepositoryURL: pushURL, evidenceRef: 'read-push',
  });
  assert.equal((await store.currentRepositoryObservation(f.workItemId,
    'primary')).observation.id, fetchObservation.id);
  const pushObservation = await store.observeRepository(pushInput);
  assert.equal(pushObservation.remoteRepositoryURL, pushURL);
  assert.notEqual(pushObservation.id, fetchObservation.id);
  assert.equal((await store.currentRepositoryObservation(f.workItemId,
    'primary')).observation.id, fetchObservation.id);
  await f.runGit('remote', 'set-url', '--push', 'origin', 'git@git.example.invalid:team/other.git');
  await assert.rejects(store.observeRepository(pushInput), { code: 'EVIDENCE' });
  assert.equal((await store.records(f.workItemId))
    .filter(item => item.type === 'repository-observation').length, 2);
});

test('T-101 push URL observation rejects missing, ambiguous, mismatched and unverified destinations', async t => {
  const f = await fixture(t);
  const pushURL = 'git@git.example.invalid:team/repo.git';
  const otherURL = 'git@git.example.invalid:team/other.git';
  await f.runGit('remote', 'set-url', 'origin', remote);
  await f.runGit('remote', 'set-url', '--push', 'origin', pushURL);
  const store = verifiedStore(f);
  const input = repositoryInput(f, {
    pushURL: true, remoteRepositoryURL: pushURL,
  });
  await assert.rejects(store.observeRepository({
    ...input, pushURL: 'true',
  }), { code: 'INPUT' });
  await assert.rejects(store.observeRepository({
    ...input, selectedRemoteName: 'not-a-remote',
  }), { code: 'EVIDENCE' });
  await assert.rejects(store.observeRepository({
    ...input, remoteRepositoryURL: otherURL,
  }), { code: 'EVIDENCE' });
  await f.runGit('remote', 'set-url', '--add', '--push', 'origin', otherURL);
  await assert.rejects(store.observeRepository(input), { code: 'EVIDENCE' });
  await f.runGit('remote', 'set-url', '--delete', '--push', 'origin', otherURL);
  const verifier = store.verifyRepository;
  store.verifyRepository = undefined;
  await assert.rejects(store.observeRepository(input), { code: 'ADAPTER' });
  store.verifyRepository = async () => ({
      canonicalLocalRepositoryPath: f.repo,
      verifiedRemoteRepositoryURL: otherURL,
      verifiedProvider: input.provider, verifiedConnection: input.connection,
      verifiedRepositoryRef: input.repositoryRef,
      verifiedRevision: input.revision, verifiedObservedAt: input.observedAt,
      verifiedEvidenceRef: input.evidenceRef,
      verifiedDefaultBranchRef: input.defaultBranchRef,
    });
  try {
    await assert.rejects(store.observeRepository(input), { code: 'EVIDENCE' });
  } finally {
    store.verifyRepository = verifier;
  }
  assert.equal((await store.records(f.workItemId))
    .filter(item => item.type === 'repository-observation').length, 0);
  await f.runGit('remote', 'remove', 'origin');
  await assert.rejects(store.observeRepository(input), { code: 'EVIDENCE' });
});

test('T-102 zero, one, multiple, selected and renamed remotes never make cached HEAD authoritative', async t => {
  const f = await fixture(t);
  const store = verifiedStore(f);
  await f.runGit('remote', 'remove', 'origin');
  assert.equal((await resolveRepositoryDefaultBranch(store, f.workItemId,
    'primary')).resolved, false);
  await assert.rejects(store.observeRepository(repositoryInput(f)), { code: 'EVIDENCE' });
  await f.runGit('remote', 'add', 'custom', remote);
  assert.deepEqual(await selectedFetchRemote((await store.metadata(f.workItemId))
    .members[0]), { selectedRemoteName: 'custom', fetchURLs: [remote] });
  assert.equal((await identity(f.repo, 'primary')).defaultBranch, null);
  const record = await store.observeRepository(repositoryInput(f));
  assert.deepEqual(await resolveRepositoryDefaultBranch(store, f.workItemId, 'primary'),
    { resolved: true, branchRef: 'refs/heads/main', source: 'provider-observation' });
  const writeRequest = { cwd: f.repo, sessionId: f.sessionId,
    toolName: 'create', toolArgs: {
      path: 'source.mjs', file_text: 'export const current = true;\n',
    } };
  const verifiedGate = await gate(store, writeRequest);
  assert.ok(!verifiedGate.findings?.some(finding =>
    finding.rule === 'repository-workflow'),
  'A verified non-origin default branch must reach the tool gate');
  assert.deepEqual((await status(store, f.workItemId)).repositories[0], {
    repositoryId: 'primary', localRepositoryPath: f.repo,
    remoteRepositoryURL: remote, selectedRemoteName: 'custom',
    observationId: record.id, evidenceRef: 'read-1',
    defaultBranchRef: 'refs/heads/main',
  });
  const recovered = await resume(store, { cwd: f.repo, sessionId: f.sessionId,
    workItemId: f.workItemId });
  assert.equal(recovered.repositories[0].observationId, record.id);
  await f.runGit('symbolic-ref', 'refs/remotes/custom/HEAD', 'refs/remotes/custom/main');
  await f.runGit('remote', 'set-url', 'custom', 'https://git.example.invalid/new.git');
  assert.equal((await resolveRepositoryDefaultBranch(store, f.workItemId,
    'primary')).resolved, false);
  const changedRemoteGate = await gate(store, writeRequest);
  assert.ok(changedRemoteGate.findings?.some(finding =>
    finding.rule === 'repository-workflow'),
  'A stale cached remote HEAD must not satisfy the tool gate');
  assert.equal((await store.currentRepositoryObservation(f.workItemId,
    'primary')).observation, null);
  assert.match((await status(store, f.workItemId)).repositories[0].evidenceGap,
    /No current hosting-service observation/u);
  assert.equal((await store.records(f.workItemId)).some(item => item.id === record.id), true);
  await f.runGit('remote', 'rename', 'custom', 'renamed');
  assert.equal((await resolveRepositoryDefaultBranch(store, f.workItemId,
    'primary')).resolved, false);
  await f.runGit('remote', 'set-url', 'renamed', remote);
  assert.equal((await resolveRepositoryDefaultBranch(store, f.workItemId,
    'primary')).branchRef, 'refs/heads/main');
  await f.runGit('remote', 'add', 'extra', 'https://git.example.invalid/extra.git');
  assert.equal((await resolveRepositoryDefaultBranch(store, f.workItemId,
    'primary')).resolved, false);
  await fs.writeFile(path.join(f.repo, '.sdlc', 'config.json'),
    JSON.stringify({ remote: 'renamed' }));
  assert.equal((await loadConfig((await store.metadata(f.workItemId)),
    'primary')).remote, 'renamed');
  assert.equal((await resolveRepositoryDefaultBranch(store, f.workItemId,
    'primary')).branchRef, 'refs/heads/main');
  await fs.writeFile(path.join(f.repo, '.sdlc', 'config.json'),
    JSON.stringify({ remote: 'missing', defaultBranch: 'refs/heads/release' }));
  assert.deepEqual(await resolveRepositoryDefaultBranch(store, f.workItemId,
    'primary'), { resolved: true, branchRef: 'refs/heads/release',
    source: 'configuration' });
});

test('T-102 conflicting observed defaults on two remotes require an explicit selection', async t => {
  const f = await fixture(t);
  const store = verifiedStore(f);
  const alternate = 'https://git.example.invalid/team/alternate.git';
  await f.runGit('remote', 'remove', 'origin');
  await f.runGit('remote', 'add', 'primary-host', remote);
  await f.runGit('remote', 'add', 'alternate-host', alternate);
  const main = await store.observeRepository(repositoryInput(f, {
    selectedRemoteName: 'primary-host',
  }));
  const release = await store.observeRepository(repositoryInput(f, {
    selectedRemoteName: 'alternate-host', remoteRepositoryURL: alternate,
    repositoryRef: 'repository-18', defaultBranchRef: 'refs/heads/release',
    evidenceRef: 'read-2',
  }));
  assert.equal(main.defaultBranchRef, 'refs/heads/main');
  assert.equal(release.defaultBranchRef, 'refs/heads/release');

  const unresolved = await resolveRepositoryDefaultBranch(store, f.workItemId, 'primary');
  assert.equal(unresolved.resolved, false);
  assert.match(unresolved.reason, /Select a Git remote/u);
  assert.deepEqual(await resolveRepositoryDefaultBranch(store, f.workItemId,
    'primary', 'primary-host'), {
    resolved: true, branchRef: 'refs/heads/main', source: 'provider-observation',
  });
  assert.deepEqual(await resolveRepositoryDefaultBranch(store, f.workItemId,
    'primary', 'alternate-host'), {
    resolved: true, branchRef: 'refs/heads/release', source: 'provider-observation',
  });
  const missing = await resolveRepositoryDefaultBranch(store, f.workItemId,
    'primary', 'missing-host');
  assert.equal(missing.resolved, false);
  assert.match(missing.reason, /does not exist/u);
  assert.deepEqual(await resolveRepositoryDefaultBranch(store, f.workItemId,
    'primary'), unresolved);
});

test('T-101 moving a checkout requires rebind and a fresh path-specific observation', async t => {
  const f = await fixture(t);
  const store = verifiedStore(f);
  await f.runGit('remote', 'set-url', 'origin', remote);
  const original = await store.observeRepository(repositoryInput(f));
  const moved = path.join(f.root, 'relocated checkout');
  await fs.rename(f.repo, moved);
  await assert.rejects(store.observeRepository(repositoryInput(f)), error =>
    ['BINDING', 'GIT'].includes(error.code));
  await store.bindMember({ workItemId: f.workItemId, repositoryId: 'primary',
    cwd: moved, sessionId: f.sessionId, replace: true });
  assert.equal((await store.currentRepositoryObservation(f.workItemId,
    'primary')).observation, null);
  const refreshed = await store.observeRepository(repositoryInput(f, {
    localRepositoryPath: moved,
  }));
  assert.notEqual(original.id, refreshed.id);
  assert.equal((await store.records(f.workItemId)).some(item => item.id === original.id), true);
});

test('repository observe CLI dispatches only through an explicitly registered hosting-service verifier', async t => {
  const f = await fixture(t);
  await f.runGit('remote', 'set-url', 'origin', remote);
  registerRepositoryObservationAdapter({
    provider: 'fixture-cli-registered',
    verify: ({ provider, localRepositoryPath, remoteRepositoryURL, adapterObservation }) => ({
      canonicalLocalRepositoryPath: localRepositoryPath,
      verifiedRemoteRepositoryURL: remoteRepositoryURL, verifiedProvider: provider,
      verifiedConnection: adapterObservation.connection,
      verifiedRepositoryRef: adapterObservation.repositoryRef,
      verifiedRevision: adapterObservation.revision,
      verifiedDefaultBranchRef: adapterObservation.defaultBranchRef,
      verifiedObservedAt: adapterObservation.observedAt,
      verifiedEvidenceRef: adapterObservation.evidenceRef,
    }),
  });

  const input = repositoryInput(f, { provider: 'fixture-cli-registered' });
  const result = await (await import('../src/cli.mjs')).runCli([
    'repository', 'observe', '--home', f.home, '--cwd', f.repo,
  ], {
    stdin: { isTTY: false, async *[Symbol.asyncIterator]() {
      yield JSON.stringify(input);
    } },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.result.remoteRepositoryURL, remote);
  assert.equal(result.result.repositoryRef, 'repository-17');
  assert.equal((await f.store.records(f.workItemId)).filter(record =>
    record.type === 'repository-observation').length, 1);
});

test('T-101 a changing fetch URL or multiple effective URLs cannot be saved as one observation', async t => {
  const f = await fixture(t);
  await f.runGit('remote', 'set-url', 'origin', remote);
  const extra = 'https://git.example.invalid/team/extra.git';
  await f.runGit('remote', 'set-url', '--add', 'origin', extra);
  const store = verifiedStore(f);
  await assert.rejects(store.observeRepository(repositoryInput(f)), { code: 'EVIDENCE' });
  await f.runGit('remote', 'set-url', '--delete', 'origin', extra);
  const racing = new Store(f.home, { clock: f.clock, verifyRepository: async context => {
    await f.runGit('remote', 'set-url', 'origin', extra);
    return {
      canonicalLocalRepositoryPath: context.localRepositoryPath,
      verifiedRemoteRepositoryURL: context.remoteRepositoryURL,
      verifiedProvider: context.provider, verifiedConnection: 'primary',
      verifiedRepositoryRef: 'repository-17', verifiedRevision: 'a'.repeat(40),
      verifiedDefaultBranchRef: 'refs/heads/main',
      verifiedObservedAt: '2026-09-08T00:00:00.000Z',
      verifiedEvidenceRef: 'read-1',
    };
  } });
  await assert.rejects(racing.observeRepository(repositoryInput(f)), { code: 'STALE' });
  assert.equal((await store.records(f.workItemId)).some(record =>
    record.type === 'repository-observation'), false);
  await f.runGit('remote', 'set-url', 'origin',
    'https://reader:credential@git.example.invalid/team/repo.git');
  await assert.rejects(store.observeRepository(repositoryInput(f)),
    { code: 'INPUT' });
});

test('CLI rejects self-attested repository observations without a registered verifier', async t => {
  const f = await fixture(t);
  await f.runGit('remote', 'set-url', 'origin', remote);
  const response = await cli(f, ['repository', 'observe'], repositoryInput(f));
  assert.notEqual(response.code, 0);
  assert.equal(response.json.error.code, 'ADAPTER');
  const validBody = repositoryInput(f);
  delete validBody.adapterObservation;
  const unavailable = await cli(f, ['repository', 'observe'], validBody);
  assert.equal(unavailable.json.error.code, 'ADAPTER');
  assert.equal((await f.store.records(f.workItemId)).some(r =>
    r.type === 'repository-observation'), false);
});
