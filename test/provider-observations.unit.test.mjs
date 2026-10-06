import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  assertRepositoryObservationCompatible,
  repositoryIdentityKey,
  repositoryObservationKey,
  validateRepositoryIdentity,
  validateRepositoryObservation,
  validateSelectedFetchRemote,
} from '../src/repository-observations.mjs';

const checkout = path.resolve('fixture', 'checkout');
const remote = 'https://git.example.invalid/team/repo.git';
const revision = 'a'.repeat(40);
const at = '2026-01-01T00:00:00.000Z';
const identity = {
  localRepositoryPath: checkout,
  remoteRepositoryURL: remote,
  provider: 'fixture',
  connection: 'primary',
  repositoryRef: 'repository-17',
};
const proof = {
  canonicalLocalRepositoryPath: checkout,
  verifiedRemoteRepositoryURL: remote,
  verifiedProvider: 'fixture',
  verifiedConnection: 'primary',
  verifiedRepositoryRef: 'repository-17',
};
const observation = { ...identity, revision, defaultBranchRef: 'refs/heads/trunk',
  observedAt: at, evidenceRef: 'provider-read-1' };

test('T-101 selected fetch remote requires exactly one credential-free URL', () => {
  assert.equal(validateSelectedFetchRemote({
    selectedRemoteName: 'not-origin', fetchURLs: [remote],
  }), remote);
  for (const fetchURLs of [[], [remote, remote],
    [remote, 'https://git.example.invalid/other/repo.git']]) {
    assert.throws(() => validateSelectedFetchRemote({
      selectedRemoteName: 'not-origin', fetchURLs,
    }), { code: 'EVIDENCE' });
  }
  for (const url of [
    'https://user:secret@git.example.invalid/team/repo',
    'https://git.example.invalid/team/repo?token=secret',
    'ssh://git:secret@git.example.invalid/team/repo',
    'http://git.example.invalid/team/repo',
    'https://git.example.invalid/team/../repo',
  ]) {
    assert.throws(() => validateSelectedFetchRemote({
      selectedRemoteName: 'not-origin', fetchURLs: [url],
    }), { code: 'INPUT' });
  }
  assert.equal(validateSelectedFetchRemote({
    selectedRemoteName: 'mirror', fetchURLs: ['git@git.example.invalid:team/repo.git'],
  }), 'git@git.example.invalid:team/repo.git');
  assert.throws(() => validateSelectedFetchRemote({
    selectedRemoteName: 'not-origin',
  }), { code: 'INPUT' });
});

test('T-101 current canonical checkout, exact hosted URL and provider reference bind repository identity', () => {
  assert.deepEqual(validateRepositoryIdentity(identity, proof), identity);
  assert.deepEqual(validateRepositoryObservation(observation, proof), observation);
  assert.equal(repositoryIdentityKey(identity, proof),
    repositoryIdentityKey({ ...identity }, { ...proof }));
  assert.notEqual(repositoryIdentityKey(identity, proof),
    repositoryIdentityKey({ ...identity, connection: 'secondary' },
      { ...proof, verifiedConnection: 'secondary' }));
  assert.notEqual(repositoryObservationKey(observation, proof),
    repositoryObservationKey({ ...observation, observedAt: '2026-01-02T00:00:00.000Z' }, proof));
  for (const [changedIdentity, changedProof] of [
    [{ ...identity, localRepositoryPath: path.resolve('fixture', 'moved') }, proof],
    [{ ...identity, localRepositoryPath: `${checkout}${path.sep}..${path.sep}checkout` }, proof],
    [{ ...identity, remoteRepositoryURL: 'https://git.example.invalid/team/other.git' }, proof],
    [{ ...identity, repositoryRef: 'other-repo' }, proof],
    [identity, { ...proof, verifiedRemoteRepositoryURL: 'https://git.example.invalid/other.git' }],
    [identity, { ...proof, canonicalLocalRepositoryPath: path.resolve('fixture', 'moved') }],
    [identity, { ...proof, verifiedRepositoryRef: 'other-repo' }],
    [identity, { ...proof, verifiedProvider: 'other-provider' }],
    [identity, { ...proof, verifiedConnection: 'other-connection' }],
  ]) {
    assert.throws(() => validateRepositoryIdentity(changedIdentity, changedProof));
  }
  for (const malformed of [
    { ...observation, revision: 'a'.repeat(12) },
    { ...observation, defaultBranchRef: 'main' },
    { ...observation, observedAt: 'tomorrow' },
    { ...observation, evidenceRef: '' },
    { ...observation, unknown: true },
  ]) {
    assert.throws(() => validateRepositoryObservation(malformed, proof));
  }
});

test('T-101 one checkout with different URLs and two checkouts with one URL stay distinct', () => {
  const otherUrl = 'https://git.example.invalid/team/second.git';
  const otherCheckout = path.resolve('fixture', 'second-checkout');
  assert.notEqual(repositoryIdentityKey(identity, proof),
    repositoryIdentityKey({ ...identity, remoteRepositoryURL: otherUrl,
      repositoryRef: 'second' }, { ...proof, verifiedRemoteRepositoryURL: otherUrl,
      verifiedRepositoryRef: 'second' }));
  assert.notEqual(repositoryIdentityKey(identity, proof),
    repositoryIdentityKey({ ...identity, localRepositoryPath: otherCheckout },
      { ...proof, canonicalLocalRepositoryPath: otherCheckout }));
  assert.deepEqual(assertRepositoryObservationCompatible(observation, {
    ...observation, observedAt: '2026-01-02T00:00:00.000Z',
    evidenceRef: 'provider-read-2',
  }, proof, proof).evidenceRef, 'provider-read-2');
  assert.throws(() => assertRepositoryObservationCompatible(observation,
    { ...observation, evidenceRef: 'contradiction' }, proof, proof),
  { code: 'ID_CONFLICT' });
  assert.throws(() => assertRepositoryObservationCompatible(observation,
    { ...observation, repositoryRef: 'other' }, proof,
    { ...proof, verifiedRepositoryRef: 'other' }), { code: 'ID_CONFLICT' });
});
