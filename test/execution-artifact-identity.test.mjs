import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { runKey } from '../src/monitors.mjs';
import {
  canCreditExecutionIdentity,
  currentExecutionRunKey,
  legacyExecutionRunKey,
  validateAdapterExecutionIdentity,
  validateCurrentExecutionIdentity,
  validateExecutionIdentity,
  verifyProviderLink,
} from '../src/provider-adapters.mjs';
import {
  artifactMatchesCandidate,
  artifactObservationKey,
  validateArtifactObservation,
} from '../src/repository-observations.mjs';

const execution = { provider: 'azure-devops', connection: 'ci',
  scopeRef: 'project:sample/repository:repo', definitionRef: 'build',
  executionRef: 'run-42', attemptKind: 'not-applicable' };
const checkout = path.resolve('fixture', 'checkout');
const remote = 'https://git.example.invalid/team/repo.git';
const artifact = {
  localRepositoryPath: checkout, remoteRepositoryURL: remote,
  provider: 'azure-devops', connection: 'ci', repositoryRef: 'repo',
  producingExecution: execution, artifactRef: 'artifact-42',
  name: 'release', sourceRevision: 'a'.repeat(40),
  configurationDigest: 'b'.repeat(64),
  contentDigest: 'c'.repeat(64),
  evidenceRef: 'provider-artifact-1', observedAt: '2026-01-01T00:00:00.000Z',
};
const proof = {
  canonicalLocalRepositoryPath: checkout, verifiedRemoteRepositoryURL: remote,
  verifiedProvider: 'azure-devops', verifiedConnection: 'ci',
  verifiedRepositoryRef: 'repo', verifiedArtifactRef: 'artifact-42',
  verifiedProducingExecution: execution, verifiedSourceRevision: 'a'.repeat(40),
  verifiedConfigurationDigest: 'b'.repeat(64),
  verifiedContentDigest: 'c'.repeat(64),
};

test('T-105 attempt capability is explicit, not guessed from a missing reference', () => {
  assert.deepEqual(validateCurrentExecutionIdentity(execution, 'none'), execution);
  assert.deepEqual(validateAdapterExecutionIdentity('azure-devops', execution), execution);
  assert.equal(canCreditExecutionIdentity(execution, 'none'), true);
  const known = { ...execution, attemptKind: 'known', attemptRef: 'attempt-2' };
  assert.deepEqual(validateCurrentExecutionIdentity(known, 'distinct'), known);
  assert.equal(canCreditExecutionIdentity(known, 'distinct'), true);
  assert.equal(canCreditExecutionIdentity({ ...known, attemptKind: 'unknown',
    attemptRef: undefined }, 'distinct'), false);
  assert.equal(canCreditExecutionIdentity({ ...execution, attemptKind: 'unknown' },
    'unknown'), false);
  for (const [identity, capability] of [
    [{ ...execution, attemptKind: undefined }, 'none'],
    [{ ...execution, attemptKind: 'known' }, 'distinct'],
    [{ ...execution, attemptKind: 'not-applicable', attemptRef: '1' }, 'none'],
    [execution, 'distinct'],
    [{ ...execution, attemptKind: 'known', attemptRef: '1' }, 'none'],
    [known, 'unknown'],
    [{ ...execution, attemptKind: 'unknown' }, 'none'],
  ]) {
    assert.throws(() => validateCurrentExecutionIdentity(identity, capability));
  }
  assert.throws(() => validateAdapterExecutionIdentity('azure-devops', known),
    { code: 'EVIDENCE' });
});

test('T-105 current run keys vary by full execution and legacy keys remain historical', () => {
  const historical = { ...execution };
  delete historical.attemptKind;
  assert.deepEqual(validateExecutionIdentity(historical), historical);
  assert.equal(legacyExecutionRunKey(execution), runKey(historical));
  assert.notEqual(currentExecutionRunKey(execution, 'none'), legacyExecutionRunKey(execution));
  for (const changes of [
    { provider: 'other-provider' }, { connection: 'other-connection' },
    { scopeRef: 'other-scope' }, { definitionRef: 'other-definition' },
    { executionRef: 'other-run' },
  ]) {
    assert.notEqual(currentExecutionRunKey(execution, 'none'),
      currentExecutionRunKey({ ...execution, ...changes }, 'none'));
  }
  const known = { ...execution, attemptKind: 'known', attemptRef: '2' };
  assert.notEqual(currentExecutionRunKey(known, 'distinct'),
    currentExecutionRunKey({ ...known, attemptRef: '3' }, 'distinct'));
  assert.equal(legacyExecutionRunKey(known), runKey({
    ...historical, attemptRef: '2',
  }));
  assert.notEqual(currentExecutionRunKey(execution, 'none'),
    currentExecutionRunKey({ ...execution, definitionRef: undefined }, 'none'));
  assert.notEqual(currentExecutionRunKey(known, 'distinct'),
    currentExecutionRunKey({ ...known, attemptKind: 'unknown',
      attemptRef: undefined }, 'distinct'));
});

test('T-105 Azure DevOps build links verify both historical and current attempt identities', async () => {
  const observed = {
    connection: 'ci',
    build: {
      id: 42, project: { id: 'sample' }, repository: { id: 'repo' },
      definition: { id: 'build' },
      _links: { web: {
        href: 'https://dev.azure.com/example/sample/_build/results?buildId=42',
      } },
    },
    access: { accessible: true,
      finalUrl: 'https://dev.azure.com/example/sample/_build/results?buildId=42&view=results' },
  };
  const current = { ...execution, definitionRef: 'build', executionRef: '42' };
  const historical = { ...current };
  delete historical.attemptKind;
  assert.equal((await verifyProviderLink('azure-devops', historical, observed)).verified,
    true);
  const link = await verifyProviderLink('azure-devops', current, observed);
  assert.equal(link.verified, true);
  assert.deepEqual(link.identity, current);
  assert.equal((await verifyProviderLink('azure-devops',
    { ...current, attemptKind: 'unknown' }, observed)).verified, false);
});

test('T-106 artifact identity binds producer, hosted reference, bytes and exact candidate commit', () => {
  assert.deepEqual(validateArtifactObservation(artifact, proof, 'none'), artifact);
  const candidate = {
    localRepositoryPath: checkout, remoteRepositoryURL: remote,
    sourceRevision: artifact.sourceRevision, configurationDigest: artifact.configurationDigest,
  };
  assert.equal(artifactMatchesCandidate(artifact, proof, 'none', candidate), true);
  for (const change of [
    { sourceRevision: 'd'.repeat(40) },
    { configurationDigest: 'e'.repeat(64) },
    { localRepositoryPath: path.resolve('fixture', 'other') },
    { remoteRepositoryURL: 'https://git.example.invalid/other/repo.git' },
  ]) {
    assert.equal(artifactMatchesCandidate(artifact, proof, 'none',
      { ...candidate, ...change }), false);
  }
  assert.notEqual(artifactObservationKey(artifact, proof, 'none'),
    artifactObservationKey({ ...artifact, contentDigest: 'e'.repeat(64) },
      { ...proof, verifiedContentDigest: 'e'.repeat(64) }, 'none'));
  assert.notEqual(artifactObservationKey(artifact, proof, 'none'),
    artifactObservationKey({ ...artifact, artifactRef: 'other' },
      { ...proof, verifiedArtifactRef: 'other' }, 'none'));
  assert.notEqual(artifactObservationKey(artifact, proof, 'none'),
    artifactObservationKey({ ...artifact, producingExecution: {
      ...execution, executionRef: 'run-43',
    } }, { ...proof, verifiedProducingExecution: {
      ...execution, executionRef: 'run-43',
    } }, 'none'));
  const otherCheckout = path.resolve('fixture', 'other-checkout');
  assert.notEqual(artifactObservationKey(artifact, proof, 'none'),
    artifactObservationKey({ ...artifact, localRepositoryPath: otherCheckout },
      { ...proof, canonicalLocalRepositoryPath: otherCheckout }, 'none'));
  const otherRemote = 'https://git.example.invalid/other/repo.git';
  assert.notEqual(artifactObservationKey(artifact, proof, 'none'),
    artifactObservationKey({ ...artifact, remoteRepositoryURL: otherRemote },
      { ...proof, verifiedRemoteRepositoryURL: otherRemote }, 'none'));
  const distinctExecution = { ...execution, provider: 'fixture',
    attemptKind: 'known', attemptRef: '2' };
  const distinctArtifact = { ...artifact, provider: 'fixture',
    producingExecution: distinctExecution };
  const distinctProof = { ...proof, verifiedProvider: 'fixture',
    verifiedProducingExecution: distinctExecution };
  assert.notEqual(artifactObservationKey(distinctArtifact, distinctProof, 'distinct'),
    artifactObservationKey({
      ...distinctArtifact, producingExecution: {
        ...distinctExecution, attemptRef: '3',
      },
    }, { ...distinctProof, verifiedProducingExecution: {
      ...distinctExecution, attemptRef: '3',
    } }, 'distinct'));
});

test('T-106 absent, contradictory or mutable artifact provenance cannot be admitted', () => {
  const immutable = { ...artifact, contentDigest: undefined,
    immutableVersion: 'immutable-7', retrievalContext: 'provider-version-lookup' };
  const immutableProof = { ...proof, verifiedImmutableVersion: 'immutable-7',
    verifiedRetrievalContext: 'provider-version-lookup' };
  const { contentDigest, ...normalizedImmutable } = immutable;
  void contentDigest;
  assert.deepEqual(validateArtifactObservation(immutable, immutableProof, 'none'),
    normalizedImmutable);
  for (const [changed, verification] of [
    [{ ...artifact, contentDigest: undefined }, proof],
    [{ ...artifact, contentDigest: 'bad' }, proof],
    [{ ...artifact, immutableVersion: 'immutable-7' }, immutableProof],
    [{ ...artifact, producingExecution: { ...execution, attemptKind: 'unknown' } }, proof],
    [{ ...artifact, artifactRef: 'other' }, proof],
    [{ ...artifact, sourceRevision: 'd'.repeat(40) }, proof],
    [{ ...artifact, configurationDigest: 'd'.repeat(64) }, proof],
    [{ ...artifact, remoteRepositoryURL: 'https://git.example.invalid/other.git' }, proof],
    [{ ...artifact, evidenceRef: '' }, proof],
    [{ ...artifact, producingExecution: {
      ...execution, executionRef: 'other-run',
    } }, proof],
    [artifact, { ...proof, verifiedContentDigest: 'e'.repeat(64) }],
    [immutable, { ...immutableProof, verifiedRetrievalContext: undefined }],
  ]) {
    assert.throws(() => validateArtifactObservation(changed, verification, 'none'));
  }
});
