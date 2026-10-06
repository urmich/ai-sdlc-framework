import { digest, requireThat } from './core.mjs';
import { git, selectedFetchRemote, validateBinding } from './git.mjs';
import { sameExecutionIdentity, validateCurrentExecutionIdentity,
  validateExecutionResultIdentity } from './provider-adapters.mjs';
import { validateSelectedFetchRemote } from './repository-observations.mjs';

const fullRevision = /^[a-f0-9]{40,64}$/u;
const sha256 = /^[a-f0-9]{64}$/u;
const repositoryIdentities = new WeakMap();

export async function snapshotCurrentRepositoryIdentities(metadata,
  repositoryIds = metadata.members.map(member => member.repositoryId)) {
  const { loadConfig } = await import('./artifacts.mjs');
  const identities = new Map();
  const selectedIds = new Set(repositoryIds);
  for (const member of metadata.members.filter(candidate =>
    selectedIds.has(candidate.repositoryId))) {
    const config = await loadConfig(metadata, member.repositoryId);
    let selected;
    let remoteRepositoryURL;
    let evidenceGap;
    try {
      selected = await selectedFetchRemote(member, config.remote);
      remoteRepositoryURL = validateSelectedFetchRemote(selected);
    } catch (error) {
      if (!['INPUT', 'EVIDENCE'].includes(error.code)) throw error;
      evidenceGap = error.message;
    }
    const revision = await git(member.root,
      ['rev-parse', '--verify', '-q', 'HEAD'], { optional: true });
    identities.set(member.repositoryId, {
      localRepositoryPath: member.root, revision,
      ...(evidenceGap ? { evidenceGap } :
        { remoteRepositoryURL, selectedRemoteName: selected.selectedRemoteName }),
      ...(config.defaultBranch ?
        { configuredDefaultBranchRef: config.defaultBranch } : {}),
    });
  }
  return identities;
}

// Live identities belong to one load/transaction, never to persisted proof history.
export function bindCurrentRepositoryIdentities(records, identities) {
  repositoryIdentities.set(records, identities);
  return records;
}

export function selectedRepositoryIdentity(records, repositoryId) {
  return repositoryIdentities.get(records)?.get(repositoryId);
}

export async function ensureCurrentRepositoryIdentities(metadata, records,
  repositoryIds) {
  const identities = repositoryIdentities.get(records) ?? new Map();
  const missing = [...new Set(repositoryIds)].filter(repositoryId =>
    !identities.has(repositoryId));
  if (missing.length) {
    for (const [repositoryId, identity] of
      await snapshotCurrentRepositoryIdentities(metadata, missing)) {
      identities.set(repositoryId, identity);
    }
  }
  bindCurrentRepositoryIdentities(records, identities);
  return identities;
}

function matchesSelectedRepository(cycle, records, repositoryId, identity) {
  const identities = repositoryIdentities.get(records);
  if (!identities) return true;
  const selected = identities.get(repositoryId);
  return Boolean(selected && !selected.evidenceGap &&
    selected.localRepositoryPath === identity?.localRepositoryPath &&
    selected.remoteRepositoryURL === identity?.remoteRepositoryURL &&
    currentSource(cycle, repositoryId, selected.revision, cycle?.configDigest));
}

export async function requireCurrentRepositoryEvidence(metadata, cycle, records,
  repositoryId, identity) {
  const identities = await ensureCurrentRepositoryIdentities(metadata, records,
    [repositoryId]);
  const selected = identities.get(repositoryId);
  requireThat(selected && !selected.evidenceGap, 'EVIDENCE',
    selected?.evidenceGap ??
      'Repository evidence has no currently bound checkout and selected fetch URL');
  requireThat(currentSource(cycle, repositoryId, selected.revision,
    cycle?.configDigest), 'STALE',
  'Bound Git HEAD differs from the selected candidate commit; start a new validation cycle before using environment evidence');
  requireThat(selected.localRepositoryPath === identity?.localRepositoryPath &&
    selected.remoteRepositoryURL === identity?.remoteRepositoryURL &&
    verifiedDestination(records, repositoryId, selected.localRepositoryPath,
      selected.remoteRepositoryURL, identity), 'EVIDENCE',
  'Environment evidence differs from the current bound checkout and selected verified fetch URL');
  return selected;
}

export function currentSource(cycle, repositoryId, revision, configDigest) {
  return Boolean(cycle && fullRevision.test(revision ?? '') &&
    cycle.sources.some(source => source.repositoryId === repositoryId &&
      source.revision === revision) &&
    cycle.configDigest === configDigest);
}
export function operationMatchesCurrentSource(cycle, operation) {
  return operation.action?.environment === 'local' ||
    Boolean(operation.intendedOutcome?.requested.sourceRevision &&
      cycle?.sources.some(source =>
        source.repositoryId === operation.repositoryId &&
        source.revision === operation.intendedOutcome.requested.sourceRevision));
}

export async function requireCurrentSourceRevision(metadata, cycle, repositoryId,
  records) {
  const member = metadata.members.find(candidate =>
    candidate.repositoryId === repositoryId);
  const source = cycle?.sources.find(candidate =>
    candidate.repositoryId === repositoryId);
  requireThat(member && source && fullRevision.test(source.revision ?? ''),
    'STALE', 'Selected candidate source is missing a bound full commit revision');
  const selected = records ?
    selectedRepositoryIdentity(records, repositoryId) : undefined;
  const revision = selected ? selected.revision :
    (await validateBinding(member)).head;
  requireThat(revision === source.revision,
    'STALE', 'Bound Git HEAD differs from the selected candidate commit; start a new validation cycle before using environment evidence');
  return source.revision;
}

export async function requireCurrentCandidateRevisions(metadata, cycle, records) {
  for (const source of cycle?.sources ?? []) {
    if (!fullRevision.test(source.revision ?? '')) continue;
    await requireCurrentSourceRevision(metadata, cycle, source.repositoryId,
      records);
  }
}

export function verifiedDestination(records, repositoryId, localRepositoryPath,
  remoteRepositoryURL, { provider, connection, repositoryRef } = {}) {
  return Boolean(localRepositoryPath && remoteRepositoryURL &&
    records.some(record => record.type === 'repository-observation' &&
      record.repositoryId === repositoryId &&
      record.localRepositoryPath === localRepositoryPath &&
      record.remoteRepositoryURL === remoteRepositoryURL &&
      (provider === undefined || record.provider === provider) &&
      (connection === undefined || record.connection === connection) &&
      (repositoryRef === undefined || record.repositoryRef === repositoryRef)));
}

export function matchesProducingAttempt(resultProof, capability, attemptRef) {
  return Boolean(resultProof?.executionRef &&
    resultProof.attemptCapability === capability &&
    resultProof.attemptRef === attemptRef &&
    resultProof.providerResultId === `${resultProof.executionRef}:${attemptRef}`);
}

export function hasCurrentExecutionProof(operation, records) {
  const proof = operation?.resultProof;
  if (!proof?.executionIdentity ||
      !['succeeded', 'failed', 'cancelled'].includes(operation.status) ||
      proof.status !== operation.status ||
      proof.dispatchId !== operation.id ||
      proof.intendedOutcomeDigest !== operation.intendedOutcome?.digest ||
      !sha256.test(proof.resultDigest ?? '') ||
      typeof proof.causalKey !== 'string' || !proof.causalKey ||
      !matchesProducingAttempt(proof, proof.attemptCapability,
        proof.attemptRef)) return false;
  let execution;
  const target = operation.intendedOutcome?.target;
  try {
    execution = validateExecutionResultIdentity(proof, {
      provider: target?.provider, definitionRef: target?.pipeline,
    });
  } catch (error) {
    if (!['INPUT', 'EVIDENCE'].includes(error.code)) throw error;
    return false;
  }
  return verifiedDestination(records, operation.repositoryId,
      target?.localRepositoryPath, target?.remoteRepositoryURL, {
        provider: execution.provider, connection: execution.connection,
      });
}

export function hasImmutableArtifactIdentity(artifact) {
  return Boolean(artifact &&
    (sha256.test(artifact.artifactSha256 ?? '') &&
      artifact.artifactImmutableVersion === undefined &&
      artifact.artifactRetrievalContext === undefined ||
      artifact.artifactSha256 === undefined &&
      typeof artifact.artifactImmutableVersion === 'string' &&
      artifact.artifactImmutableVersion.length > 0 &&
      typeof artifact.artifactRetrievalContext === 'string' &&
      artifact.artifactRetrievalContext.length > 0 &&
      artifact.artifactVersionVerified === true));
}

export function matchesArtifactContent(artifact, action) {
  return hasImmutableArtifactIdentity(artifact) &&
    artifact.artifactSha256 === action?.artifactSha256 &&
    artifact.artifactImmutableVersion === action?.artifactImmutableVersion &&
    artifact.artifactRetrievalContext === action?.artifactRetrievalContext;
}

export function matchesProducerExecution(proof, artifact) {
  if (!proof?.executionIdentity || !artifact?.producingExecution ||
      !matchesProducingAttempt(proof, artifact.producingAttemptCapability,
        artifact.producingAttemptRef)) return false;
  try {
    const proven = validateExecutionResultIdentity(proof, {
      provider: artifact.provider, connection: artifact.connection,
      attemptCapability: artifact.producingAttemptCapability,
    });
    const selected = validateCurrentExecutionIdentity(artifact.producingExecution,
      artifact.producingAttemptCapability);
    return sameExecutionIdentity(proven, selected);
  } catch (error) {
    if (!['INPUT', 'EVIDENCE'].includes(error.code)) throw error;
    return false;
  }
}

export function currentArtifact(cycle, records, artifact, repositoryId = artifact?.repositoryId) {
  if (!artifact || artifact.type !== 'artifact' ||
      artifact.status !== 'succeeded' || artifact.cycleId !== cycle?.id ||
      artifact.sourceDigest !== cycle.candidateDigest ||
      !currentSource(cycle, repositoryId, artifact.sourceRevision,
        artifact.configDigest) ||
      !matchesSelectedRepository(cycle, records, repositoryId, artifact) ||
      !verifiedDestination(records, repositoryId,
        artifact.localRepositoryPath, artifact.remoteRepositoryURL, {
          provider: artifact.provider, connection: artifact.connection,
          repositoryRef: artifact.repositoryRef,
        }) ||
      !artifact.provider || !artifact.connection || !artifact.repositoryRef ||
      !artifact.artifactRef || !hasImmutableArtifactIdentity(artifact)) return false;
  if (!((artifact.producingAttemptCapability === 'none' &&
      artifact.producingAttemptRef === 'not-applicable') ||
      (artifact.producingAttemptCapability === 'distinct' &&
        typeof artifact.producingAttemptRef === 'string' &&
        !['unknown', 'not-applicable', ''].includes(artifact.producingAttemptRef)))) return false;
  const producer = records.find(record => record.type === 'operation' &&
    record.id === artifact.producingOperationId);
  return Boolean(producer && ['build', 'pipeline'].includes(producer.class) &&
    producer.status === 'succeeded' && hasCurrentExecutionProof(producer, records) &&
    producer.resultProof?.status === 'succeeded' &&
    producer.resultProof.dispatchId === producer.id &&
    producer.resultProof.intendedOutcomeDigest === producer.intendedOutcome?.digest &&
    producer.resultProof.providerResultId === artifact.buildRunId &&
    matchesProducerExecution(producer.resultProof, artifact) &&
    producer.cycleId === cycle.id &&
    producer.candidateDigest === cycle.candidateDigest &&
    producer.repositoryId === repositoryId &&
    producer.action.provider === artifact.provider &&
    producer.intendedOutcome?.requested.sourceRevision === artifact.sourceRevision &&
    producer.intendedOutcome?.requested.configDigest === artifact.configDigest &&
    producer.intendedOutcome?.target.localRepositoryPath === artifact.localRepositoryPath &&
    producer.intendedOutcome?.target.remoteRepositoryURL === artifact.remoteRepositoryURL);
}

export function currentDeployment(cycle, records, deployment, environment) {
  if (!deployment || deployment.type !== 'operation' ||
      deployment.class !== 'deploy' || deployment.status !== 'succeeded' ||
      deployment.id !== cycle?.deployments[environment] ||
      deployment.cycleId !== cycle.id ||
      deployment.candidateDigest !== cycle.candidateDigest ||
      deployment.action?.environment !== environment ||
      deployment.action.configDigest !== cycle.configDigest ||
      deployment.resultProof?.status !== 'succeeded' ||
      deployment.resultProof.dispatchId !== deployment.id ||
      deployment.resultProof.intendedOutcomeDigest !== deployment.intendedOutcome?.digest ||
      !deployment.resultProof.providerResultId ||
      deployment.action.target !== deployment.target) return false;
  const artifact = records.find(record => record.type === 'artifact' &&
    record.id === cycle.artifacts[environment]);
  return Boolean(currentArtifact(cycle, records, artifact, deployment.repositoryId) &&
    deployment.artifactId === artifact.artifactId &&
    deployment.action.artifactId === artifact.artifactId &&
    deployment.action.artifactRef === artifact.artifactRef &&
    matchesArtifactContent(artifact, deployment.action) &&
    matchesArtifactContent(artifact, deployment.intendedOutcome?.requested) &&
    deployment.intendedOutcome?.requested.artifactId === artifact.artifactId &&
    deployment.intendedOutcome?.requested.artifactRef === artifact.artifactRef &&
    deployment.intendedOutcome?.requested.sourceRevision === artifact.sourceRevision &&
    deployment.intendedOutcome?.requested.configDigest === artifact.configDigest &&
    deployment.intendedOutcome?.target.localRepositoryPath === artifact.localRepositoryPath &&
    deployment.intendedOutcome?.target.remoteRepositoryURL === artifact.remoteRepositoryURL &&
    (deployment.action.sourceRevision === undefined ||
      deployment.action.sourceRevision === artifact.sourceRevision) &&
    deployment.intendedOutcome?.target.environment === environment &&
    deployment.intendedOutcome?.target.target === deployment.target);
}

export function requireCurrentDeployment(cycle, records, deployment, environment) {
  requireThat(currentDeployment(cycle, records, deployment, environment),
    'EVIDENCE', `${environment} requires a current proven deployment, artifact, exact source revision and target`);
  return deployment;
}

export function publicationDestination(records, action, { push = false } = {}) {
  const matches = records.filter(record => record.type === 'repository-observation' &&
    record.repositoryId === action.repositoryId &&
    record.localRepositoryPath === action.localRepositoryPath &&
    record.remoteRepositoryURL === action.remoteRepositoryURL);
  return matches.length > 0 && (!push ||
    action.remoteUrlDigest === digest([action.remoteRepositoryURL]));
}
