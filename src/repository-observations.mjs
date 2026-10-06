import path from 'node:path';
import { digest, id, object, requireThat, safeRecord, text, timestamp } from './core.mjs';
import { sameExecutionIdentity, validateCurrentExecutionIdentity } from './provider-adapters.mjs';
import { selectedFetchRemote, selectedPushRemote, validateBinding } from './git.mjs';
import { archiveSupersededObservations, withObservationRetention } from './observation-retention.mjs';

async function repositoryConfiguration(metadata, repositoryId) {
  // Schema validation imports the pure helpers in this module; defer configuration loading.
  const { loadConfig } = await import('./artifacts.mjs');
  return loadConfig(metadata, repositoryId);
}

const fullRevision = /^[a-f0-9]{40,64}$/u;
const sha256 = /^[a-f0-9]{64}$/u;
const branchRef = /^refs\/heads\/(?!\/|.*(?:\/{2}|\.\.|@\{|\/\.|\.lock(?:\/|$)))[A-Za-z0-9._/-]+$/u;
const repositoryAdapters = new Map();

export function registerRepositoryObservationAdapter(adapter) {
  object(adapter, ['provider', 'verify'], ['provider', 'verify']);
  text(adapter.provider, 'hosting service');
  requireThat(typeof adapter.verify === 'function' &&
    !repositoryAdapters.has(adapter.provider), 'ADAPTER',
  'Repository observation requires one unique hosting-service verifier');
  repositoryAdapters.set(adapter.provider, adapter.verify);
  return adapter.provider;
}

export async function verifyAdapterRepository(context) {
  const adapter = repositoryAdapters.get(context.provider);
  requireThat(adapter, 'ADAPTER',
    'A trusted hosting-service repository verifier is required before recording an observation');
  return adapter(context);
}

function repositoryPath(value) {
  text(value, 'canonical local repository path', 4096);
  requireThat(path.isAbsolute(value) && path.normalize(value) === value &&
    !value.endsWith(path.sep) && !value.includes('\0'), 'INPUT',
  'Local repository path must be an absolute, canonical checkout path');
  return value;
}

function remoteUrl(value) {
  text(value, 'remote repository URL', 2048);
  requireThat(!/\s/u.test(value) && !/[?#]/u.test(value), 'INPUT',
    'Remote repository URL must not contain a query, fragment, or whitespace');
  if (/^git@[^@:\/]+:[^:]+$/u.test(value)) {
    requireThat(!value.includes('\\') && !value.includes('..') &&
      !value.endsWith('/'), 'INPUT', 'Invalid SSH remote repository URL');
    return value;
  }
  let parsed;
  try { parsed = new URL(value); }
  catch { requireThat(false, 'INPUT', 'Invalid remote repository URL'); }
  requireThat(['https:', 'ssh:'].includes(parsed.protocol) &&
    !!parsed.hostname && parsed.pathname.length > 1 &&
    !parsed.password && (!parsed.username ||
      (parsed.protocol === 'ssh:' && parsed.username === 'git')) &&
    parsed.href === value && !/%(?:2e|2f|5c)/iu.test(value), 'INPUT',
  'Remote repository URL must be a canonical, credential-free HTTPS or Git SSH URL');
  return value;
}

function revision(value, label) {
  requireThat(typeof value === 'string' && fullRevision.test(value), 'INPUT',
    `${label} must be a full Git commit ID`);
  return value;
}

function branch(value, label) {
  requireThat(typeof value === 'string' && branchRef.test(value) &&
    !value.endsWith('/') && !value.endsWith('.'), 'INPUT',
  `${label} must be a full refs/heads branch`);
  return value;
}

function observationTime(value) {
  timestamp(value);
  requireThat(new Date(value).toISOString() === value, 'INPUT',
    'Observation time must be a canonical ISO timestamp');
  return value;
}

function validateSelectedRemoteURL(input, urls, direction) {
  text(input.selectedRemoteName, 'selected Git remote name');
  requireThat(!/[\s:/\\]/u.test(input.selectedRemoteName) &&
    input.selectedRemoteName !== '.' && input.selectedRemoteName !== '..',
  'INPUT', 'Selected Git remote name is invalid');
  requireThat(Array.isArray(urls) && urls.length === 1,
    'EVIDENCE', `Selected Git remote requires exactly one current ${direction} URL`);
  return remoteUrl(urls[0]);
}

export function validateSelectedFetchRemote(input) {
  object(input, ['selectedRemoteName', 'fetchURLs'],
    ['selectedRemoteName', 'fetchURLs']);
  return validateSelectedRemoteURL(input, input.fetchURLs, 'fetch');
}

export function validateSelectedPushRemote(input) {
  object(input, ['selectedRemoteName', 'pushURLs'],
    ['selectedRemoteName', 'pushURLs']);
  return validateSelectedRemoteURL(input, input.pushURLs, 'push');
}

export async function selectedPublicationRepositoryURL(member, configuredRemote,
  remoteRepositoryURL, requestedRemote) {
  const fetch = await selectedFetchRemote(member, configuredRemote, requestedRemote);
  const selectedURL = fetch.fetchURLs.length === 1 &&
    fetch.fetchURLs[0] === remoteRepositoryURL ?
    validateSelectedFetchRemote(fetch) :
    validateSelectedPushRemote(await selectedPushRemote(member, configuredRemote,
      requestedRemote));
  requireThat(selectedURL === remoteRepositoryURL, 'EVIDENCE',
    'Publication destination differs from the selected Git fetch or push URL');
  return { selectedRemoteName: fetch.selectedRemoteName,
    remoteRepositoryURL: selectedURL };
}

export async function requirePublicationSourceObservation(metadata, records,
  hostedObservation, sourceRepositoryURL) {
  if (sourceRepositoryURL === hostedObservation.remoteRepositoryURL) return hostedObservation;
  const sources = records.filter(record => record.type === 'repository-observation' &&
    record.remoteRepositoryURL === sourceRepositoryURL &&
    record.provider === hostedObservation.provider &&
    metadata.members.some(member => member.repositoryId === record.repositoryId &&
      member.root === record.localRepositoryPath));
  requireThat(sources.length > 0, 'EVIDENCE',
    'Fork source repository requires an independent trusted repository observation');
  for (const source of sources) {
    const member = metadata.members.find(candidate =>
      candidate.repositoryId === source.repositoryId &&
      candidate.root === source.localRepositoryPath);
    const config = await repositoryConfiguration(metadata, member.repositoryId);
    try {
      await selectedPublicationRepositoryURL(member, config.remote,
        sourceRepositoryURL);
      return source;
    } catch (error) {
      if (error.code !== 'EVIDENCE') throw error;
    }
  }
  requireThat(false, 'EVIDENCE',
    'Fork source repository observation no longer matches a selected Git fetch or push URL');
}

// Verification comes from the caller's current Git binding and provider adapter, not the observation itself.
export function validateRepositoryIdentity(input, verification) {
  object(input, ['localRepositoryPath', 'remoteRepositoryURL', 'provider',
    'connection', 'repositoryRef'],
  ['localRepositoryPath', 'remoteRepositoryURL', 'provider', 'connection', 'repositoryRef']);
  object(verification, ['canonicalLocalRepositoryPath', 'verifiedRemoteRepositoryURL',
    'verifiedProvider', 'verifiedConnection', 'verifiedRepositoryRef', 'verifiedBranch'],
  ['canonicalLocalRepositoryPath', 'verifiedRemoteRepositoryURL',
    'verifiedProvider', 'verifiedConnection', 'verifiedRepositoryRef']);
  repositoryPath(input.localRepositoryPath);
  remoteUrl(input.remoteRepositoryURL);
  for (const field of ['provider', 'connection', 'repositoryRef']) text(input[field], field);
  requireThat(input.localRepositoryPath === repositoryPath(verification.canonicalLocalRepositoryPath),
    'EVIDENCE', 'Observation does not belong to the current canonical Git checkout');
  requireThat(input.remoteRepositoryURL === remoteUrl(verification.verifiedRemoteRepositoryURL),
    'EVIDENCE', 'Observation does not belong to the verified hosted repository URL');
  requireThat(input.repositoryRef === text(verification.verifiedRepositoryRef, 'verified repository reference'),
    'EVIDENCE', 'Provider repository reference differs from the observation');
  requireThat(input.provider === text(verification.verifiedProvider, 'verified provider') &&
    input.connection === text(verification.verifiedConnection, 'verified connection'),
  'EVIDENCE', 'Provider or connection differs from the verified repository observation');
  return {
    localRepositoryPath: input.localRepositoryPath,
    remoteRepositoryURL: input.remoteRepositoryURL,
    provider: input.provider,
    connection: input.connection,
    repositoryRef: input.repositoryRef,
  };
}

export function repositoryIdentityKey(input, verification) {
  return `repository-${digest(validateRepositoryIdentity(input, verification)).slice(0, 40)}`;
}

export function validateRepositoryObservation(input, verification) {
  object(input, ['localRepositoryPath', 'remoteRepositoryURL', 'provider',
    'connection', 'repositoryRef', 'revision', 'defaultBranchRef', 'verifiedBranch', 'observedAt',
    'evidenceRef'],
  ['localRepositoryPath', 'remoteRepositoryURL', 'provider', 'connection',
    'repositoryRef', 'revision', 'observedAt', 'evidenceRef']);
  const identity = validateRepositoryIdentity({
    localRepositoryPath: input.localRepositoryPath,
    remoteRepositoryURL: input.remoteRepositoryURL,
    provider: input.provider,
    connection: input.connection,
    repositoryRef: input.repositoryRef,
  }, verification);
  revision(input.revision, 'observed revision');
  if (input.defaultBranchRef !== undefined) branch(input.defaultBranchRef, 'default branch');
  if (input.verifiedBranch !== undefined) {
    object(input.verifiedBranch, ['branchRef', 'revision'], ['branchRef', 'revision']);
    branch(input.verifiedBranch.branchRef, 'provider-verified branch');
    revision(input.verifiedBranch.revision, 'provider-verified branch revision');
    requireThat(verification.verifiedBranch !== undefined, 'EVIDENCE',
      'Hosting-service adapter did not verify the branch-to-commit association');
    object(verification.verifiedBranch, ['branchRef', 'revision'], ['branchRef', 'revision']);
    requireThat(verification.verifiedBranch.branchRef === input.verifiedBranch.branchRef &&
      verification.verifiedBranch.revision === input.verifiedBranch.revision, 'EVIDENCE',
    'Hosting-service adapter did not verify the branch-to-commit association');
  } else {
    requireThat(verification.verifiedBranch === undefined, 'EVIDENCE',
      'Provider branch-to-commit evidence must be recorded with its branch and revision');
  }
  observationTime(input.observedAt);
  text(input.evidenceRef, 'repository evidence reference');
  return { ...identity, revision: input.revision,
    ...(input.defaultBranchRef === undefined ? {} : { defaultBranchRef: input.defaultBranchRef }),
    ...(input.verifiedBranch === undefined ? {} : { verifiedBranch: input.verifiedBranch }),
    observedAt: input.observedAt, evidenceRef: input.evidenceRef };
}

export function repositoryObservationKey(input, verification) {
  return `repository-observation-${digest(validateRepositoryObservation(input, verification)).slice(0, 40)}`;
}

export function resolveDefaultBranch(input) {
  object(input, ['configuredDefaultBranchRef', 'selectedFetchRemote',
    'repositoryObservation', 'verification']);
  if (input.configuredDefaultBranchRef !== undefined) {
    branch(input.configuredDefaultBranchRef, 'configured default branch');
  }
  const selectedUrl = input.selectedFetchRemote === undefined ? undefined :
    validateSelectedFetchRemote(input.selectedFetchRemote);
  const observation = input.repositoryObservation === undefined ? undefined :
    validateRepositoryObservation(input.repositoryObservation, input.verification);
  if (observation && selectedUrl && selectedUrl !== observation.remoteRepositoryURL) {
    return { resolved: false,
      reason: 'Selected Git remote fetch URL differs from the current hosted repository observation' };
  }
  if (observation?.defaultBranchRef && input.configuredDefaultBranchRef &&
      observation.defaultBranchRef !== input.configuredDefaultBranchRef) {
    return { resolved: false,
      reason: 'Configured and provider-observed default branches conflict' };
  }
  if (input.configuredDefaultBranchRef) {
    return { resolved: true, branchRef: input.configuredDefaultBranchRef,
      source: 'configuration' };
  }
  if (!selectedUrl) {
    return { resolved: false, reason: 'Select a Git remote and verify its current fetch URL' };
  }
  if (!observation?.defaultBranchRef) {
    return { resolved: false,
      reason: 'Current provider observation does not prove the selected hosted repository default branch' };
  }
  return { resolved: true, branchRef: observation.defaultBranchRef,
    source: 'provider-observation' };
}

export function assertRepositoryObservationCompatible(previous, current,
  previousVerification, currentVerification) {
  const left = validateRepositoryObservation(previous, previousVerification);
  const right = validateRepositoryObservation(current, currentVerification);
  if (left.localRepositoryPath === right.localRepositoryPath &&
      left.remoteRepositoryURL === right.remoteRepositoryURL) {
    requireThat(left.provider === right.provider &&
      left.repositoryRef === right.repositoryRef, 'ID_CONFLICT',
    'The same local path and hosted URL have conflicting provider repository evidence');
    if (left.observedAt === right.observedAt && left.connection === right.connection) {
      requireThat(digest(left) === digest(right), 'ID_CONFLICT',
        'Duplicate repository observation contains contradictory evidence');
    }
  }
  return right;
}

function prIdentity(input, verification) {
  return validateRepositoryIdentity({
    localRepositoryPath: input.localRepositoryPath,
    remoteRepositoryURL: input.remoteRepositoryURL,
    provider: input.provider,
    connection: input.connection,
    repositoryRef: input.repositoryRef,
  }, {
    canonicalLocalRepositoryPath: verification?.canonicalLocalRepositoryPath,
    verifiedRemoteRepositoryURL: verification?.verifiedRemoteRepositoryURL,
    verifiedProvider: verification?.verifiedProvider,
    verifiedConnection: verification?.verifiedConnection,
    verifiedRepositoryRef: verification?.verifiedRepositoryRef,
  });
}

export function validatePullRequestObservation(input, verification) {
  object(input, ['localRepositoryPath', 'remoteRepositoryURL', 'provider',
    'connection', 'repositoryRef', 'pullRequestRef', 'sourceRepositoryURL',
    'sourceBranchRef', 'targetBranchRef', 'sourceRevision', 'targetRevision',
    'state', 'sequence', 'previousObservationKey', 'observedAt', 'evidenceRef'],
  ['localRepositoryPath', 'remoteRepositoryURL', 'provider', 'connection',
    'repositoryRef', 'pullRequestRef', 'sourceBranchRef', 'targetBranchRef',
    'sourceRevision', 'targetRevision', 'state', 'sequence', 'observedAt', 'evidenceRef']);
  const identity = prIdentity(input, verification);
  text(input.pullRequestRef, 'pull request reference');
  requireThat(input.pullRequestRef === text(verification.verifiedPullRequestRef,
    'provider-verified pull request reference'), 'EVIDENCE',
  'Provider observation identifies a different pull request');
  if (input.sourceRepositoryURL !== undefined) {
    remoteUrl(input.sourceRepositoryURL);
    requireThat(input.sourceRepositoryURL === remoteUrl(verification.verifiedSourceRepositoryURL),
      'EVIDENCE', 'Fork source repository URL is not provider-verified');
  } else {
    requireThat(verification.verifiedSourceRepositoryURL === undefined,
      'EVIDENCE', 'Provider reports a fork source repository that is absent from the PR observation');
  }
  branch(input.sourceBranchRef, 'PR source branch');
  branch(input.targetBranchRef, 'PR target branch');
  revision(input.sourceRevision, 'PR source revision');
  revision(input.targetRevision, 'PR target revision');
  text(input.state, 'PR state');
  requireThat(Number.isSafeInteger(input.sequence) && input.sequence > 0,
    'INPUT', 'PR observation sequence must be a positive integer');
  requireThat((input.sequence === 1) === (input.previousObservationKey === undefined),
    'INPUT', 'A PR refresh must name the previous observation');
  if (input.previousObservationKey !== undefined) {
    requireThat(/^pr-observation-[a-f0-9]{40}$/u.test(input.previousObservationKey),
      'INPUT', 'Invalid previous PR observation key');
  }
  observationTime(input.observedAt);
  text(input.evidenceRef, 'PR evidence reference');
  return { ...identity, pullRequestRef: input.pullRequestRef,
    ...(input.sourceRepositoryURL === undefined ? {} :
      { sourceRepositoryURL: input.sourceRepositoryURL }),
    sourceBranchRef: input.sourceBranchRef, targetBranchRef: input.targetBranchRef,
    sourceRevision: input.sourceRevision, targetRevision: input.targetRevision,
    state: input.state, sequence: input.sequence,
    ...(input.previousObservationKey === undefined ? {} :
      { previousObservationKey: input.previousObservationKey }),
    observedAt: input.observedAt, evidenceRef: input.evidenceRef };
}

export function pullRequestIdentityKey(input, verification) {
  const pr = validatePullRequestObservation(input, verification);
  return `pr-${digest({
    localRepositoryPath: pr.localRepositoryPath, remoteRepositoryURL: pr.remoteRepositoryURL,
    provider: pr.provider, connection: pr.connection, repositoryRef: pr.repositoryRef,
    pullRequestRef: pr.pullRequestRef,
  }).slice(0, 40)}`;
}

export function pullRequestObservationKey(input, verification) {
  return `pr-observation-${digest(validatePullRequestObservation(input, verification)).slice(0, 40)}`;
}

export function validatePullRequestTransition(previous, current,
  previousVerification, currentVerification) {
  const prior = validatePullRequestObservation(previous, previousVerification);
  const next = validatePullRequestObservation(current, currentVerification);
  requireThat(pullRequestIdentityKey(prior, previousVerification) ===
    pullRequestIdentityKey(next, currentVerification), 'ID_CONFLICT',
  'PR refresh identifies a different hosted pull request');
  requireThat(next.sequence === prior.sequence + 1 &&
    next.previousObservationKey === pullRequestObservationKey(prior, previousVerification),
  'STALE', 'PR refresh does not follow the current observation');
  return next;
}

export function validateArtifactObservation(input, verification, attemptCapability) {
  object(input, ['localRepositoryPath', 'remoteRepositoryURL', 'provider',
    'connection', 'repositoryRef', 'producingExecution', 'artifactRef', 'name',
    'sourceRevision', 'configurationDigest', 'contentDigest', 'immutableVersion',
    'retrievalContext', 'evidenceRef', 'observedAt'],
  ['localRepositoryPath', 'remoteRepositoryURL', 'provider', 'connection',
    'repositoryRef', 'producingExecution', 'artifactRef', 'name',
    'sourceRevision', 'configurationDigest', 'evidenceRef', 'observedAt']);
  const identity = prIdentity(input, verification);
  const producingExecution = validateCurrentExecutionIdentity(input.producingExecution,
    attemptCapability);
  requireThat(producingExecution.provider === identity.provider &&
    producingExecution.connection === identity.connection, 'EVIDENCE',
  'Artifact producer provider or connection does not match its hosted repository');
  requireThat(producingExecution.attemptKind !== 'unknown', 'EVIDENCE',
    'Unknown producing attempt cannot prove a new artifact');
  requireThat(sameExecutionIdentity(producingExecution,
    validateCurrentExecutionIdentity(verification.verifiedProducingExecution,
      attemptCapability)), 'EVIDENCE',
  'Artifact producer does not match the provider-verified execution');
  text(input.artifactRef, 'hosted artifact reference');
  requireThat(input.artifactRef === text(verification.verifiedArtifactRef,
    'provider-verified artifact reference'), 'EVIDENCE',
  'Provider observation identifies a different artifact');
  text(input.name, 'logical artifact name');
  revision(input.sourceRevision, 'artifact source revision');
  requireThat(input.sourceRevision === revision(verification.verifiedSourceRevision,
    'verified artifact source revision'), 'EVIDENCE',
  'Artifact source revision does not match producing run provenance');
  requireThat(typeof input.configurationDigest === 'string' &&
    sha256.test(input.configurationDigest), 'INPUT',
  'Artifact build configuration requires a SHA-256 digest');
  requireThat(input.configurationDigest === verification.verifiedConfigurationDigest,
    'EVIDENCE', 'Artifact build configuration is not provider-verified');
  requireThat((input.contentDigest !== undefined) !== (input.immutableVersion !== undefined),
    'INPUT', 'Artifact requires exactly one immutable content digest or proven version');
  if (input.contentDigest !== undefined) {
    requireThat(typeof input.contentDigest === 'string' && sha256.test(input.contentDigest),
      'INPUT', 'Artifact content digest must be SHA-256');
    requireThat(input.contentDigest === verification.verifiedContentDigest,
      'EVIDENCE', 'Artifact content digest is not verified');
  } else {
    text(input.immutableVersion, 'immutable artifact version');
    text(input.retrievalContext, 'immutable artifact retrieval context');
    requireThat(input.immutableVersion === verification.verifiedImmutableVersion &&
      input.retrievalContext === verification.verifiedRetrievalContext, 'EVIDENCE',
    'Provider has not proven the immutable artifact version and retrieval context');
  }
  observationTime(input.observedAt);
  text(input.evidenceRef, 'artifact evidence reference');
  return { ...identity, producingExecution, artifactRef: input.artifactRef,
    name: input.name, sourceRevision: input.sourceRevision,
    configurationDigest: input.configurationDigest,
    ...(input.contentDigest === undefined ? {
      immutableVersion: input.immutableVersion, retrievalContext: input.retrievalContext,
    } : { contentDigest: input.contentDigest }),
    observedAt: input.observedAt, evidenceRef: input.evidenceRef };
}

export function artifactObservationKey(input, verification, attemptCapability) {
  const { observedAt, evidenceRef, ...identity } =
    validateArtifactObservation(input, verification, attemptCapability);
  void observedAt;
  void evidenceRef;
  return `artifact-observation-${digest(identity).slice(0, 40)}`;
}

export function artifactMatchesCandidate(input, verification, attemptCapability, candidate) {
  const artifact = validateArtifactObservation(input, verification, attemptCapability);
  object(candidate, ['localRepositoryPath', 'remoteRepositoryURL',
    'sourceRevision', 'configurationDigest'],
  ['localRepositoryPath', 'remoteRepositoryURL', 'sourceRevision', 'configurationDigest']);
  repositoryPath(candidate.localRepositoryPath);
  remoteUrl(candidate.remoteRepositoryURL);
  revision(candidate.sourceRevision, 'candidate source revision');
  requireThat(typeof candidate.configurationDigest === 'string' &&
    sha256.test(candidate.configurationDigest), 'INPUT',
  'Candidate build configuration requires a SHA-256 digest');
  return artifact.localRepositoryPath === candidate.localRepositoryPath &&
    artifact.remoteRepositoryURL === candidate.remoteRepositoryURL &&
    artifact.sourceRevision === candidate.sourceRevision &&
    artifact.configurationDigest === candidate.configurationDigest;
}

function memberFor(state, repositoryId) {
  const idToFind = repositoryId ?? state.metadata.coordinatorId;
  id(idToFind, 'repository ID');
  const member = state.metadata.members.find(candidate => candidate.repositoryId === idToFind);
  requireThat(member, 'BINDING', 'Repository is not bound to this work item');
  return member;
}

function repositoryObservationFromRecord(record) {
  const { type, id: recordId, workItemId, repositoryId, ...observation } = record;
  void type; void recordId; void workItemId; void repositoryId;
  return observation;
}

function latestObservation(records, repositoryId, localRepositoryPath, remoteRepositoryURL) {
  return records.filter(record => record.type === 'repository-observation' &&
    record.repositoryId === repositoryId &&
    record.localRepositoryPath === localRepositoryPath &&
    record.remoteRepositoryURL === remoteRepositoryURL)
    .sort((left, right) => left.observedAt.localeCompare(right.observedAt) ||
      left.id.localeCompare(right.id)).at(-1) ?? null;
}

function adapterVerification(verification, observation) {
  object(verification, ['canonicalLocalRepositoryPath', 'verifiedRemoteRepositoryURL',
    'verifiedProvider', 'verifiedConnection', 'verifiedRepositoryRef',
    'verifiedRevision', 'verifiedDefaultBranchRef', 'verifiedBranch', 'verifiedObservedAt',
    'verifiedEvidenceRef'],
  ['canonicalLocalRepositoryPath', 'verifiedRemoteRepositoryURL',
    'verifiedProvider', 'verifiedConnection', 'verifiedRepositoryRef',
    'verifiedRevision', 'verifiedObservedAt', 'verifiedEvidenceRef']);
  for (const [field, expected] of [
    ['verifiedRevision', observation.revision],
    ['verifiedObservedAt', observation.observedAt],
    ['verifiedEvidenceRef', observation.evidenceRef],
    ['verifiedDefaultBranchRef', observation.defaultBranchRef],
    ['verifiedBranch', observation.verifiedBranch],
  ]) {
    requireThat(field === 'verifiedBranch' ?
      digest(verification[field] ?? null) === digest(expected ?? null) :
      verification[field] === expected, 'EVIDENCE',
      `Hosting-service adapter did not verify ${field}`);
  }
  return {
    canonicalLocalRepositoryPath: verification.canonicalLocalRepositoryPath,
    verifiedRemoteRepositoryURL: verification.verifiedRemoteRepositoryURL,
    verifiedProvider: verification.verifiedProvider,
    verifiedConnection: verification.verifiedConnection,
    verifiedRepositoryRef: verification.verifiedRepositoryRef,
    ...(verification.verifiedBranch === undefined ? {} :
      { verifiedBranch: verification.verifiedBranch }),
  };
}

// pushURL selects the effective Git push URL; ordinary observations use the fetch URL.
// Only a trusted in-process adapter can supply verification; CLI input is untrusted.
export async function observeRepository(store, input) {
  object(input, ['workItemId', 'repositoryId', 'selectedRemoteName', 'pushURL',
    'localRepositoryPath', 'remoteRepositoryURL', 'provider', 'connection',
    'repositoryRef', 'revision', 'defaultBranchRef', 'verifiedBranch', 'observedAt',
    'evidenceRef', 'adapterObservation'],
  ['workItemId', 'localRepositoryPath', 'remoteRepositoryURL', 'provider',
    'connection', 'repositoryRef', 'revision', 'observedAt', 'evidenceRef']);
  id(input.workItemId, 'work item ID');
  requireThat(input.pushURL === undefined || typeof input.pushURL === 'boolean',
    'INPUT', 'Push URL selection must be a boolean');
  requireThat(typeof store.verifyRepository === 'function', 'ADAPTER',
    'A trusted hosting-service repository verifier is required before recording an observation');
  return withObservationRetention(store, input.workItemId, async (tx, monitorDependencies) => {
    const member = memberFor(tx, input.repositoryId);
    const current = await validateBinding(member);
    const config = await repositoryConfiguration(tx.metadata, member.repositoryId);
    const selectedURL = input.pushURL === true ?
      async () => validateSelectedPushRemote(await selectedPushRemote(member,
        config.remote, input.selectedRemoteName)) :
      async () => validateSelectedFetchRemote(await selectedFetchRemote(member,
        config.remote, input.selectedRemoteName));
    const currentURL = await selectedURL();
    const { workItemId, repositoryId, selectedRemoteName, pushURL, adapterObservation,
      ...candidate } = input;
    void workItemId; void repositoryId; void selectedRemoteName; void pushURL;
    requireThat(candidate.localRepositoryPath === current.root &&
      candidate.remoteRepositoryURL === currentURL, 'EVIDENCE',
    `Observation must identify the currently bound checkout and selected Git ${input.pushURL ? 'push' : 'fetch'} URL`);
    const verified = adapterVerification(await store.verifyRepository({
      provider: candidate.provider, adapterObservation,
      localRepositoryPath: current.root, remoteRepositoryURL: currentURL,
    }), candidate);
    const observation = validateRepositoryObservation(candidate, verified);
    safeRecord(observation);
    requireThat(await selectedURL() === currentURL,
      'STALE', `Selected Git ${input.pushURL ? 'push' : 'fetch'} URL changed during hosting-service verification`);
    await validateBinding(member);
    const previous = latestObservation(tx.all(), member.repositoryId,
      current.root, currentURL);
    if (previous) {
      assertRepositoryObservationCompatible(repositoryObservationFromRecord(previous),
        observation, {
          canonicalLocalRepositoryPath: previous.localRepositoryPath,
          verifiedRemoteRepositoryURL: previous.remoteRepositoryURL,
          verifiedProvider: previous.provider,
          verifiedConnection: previous.connection,
          verifiedRepositoryRef: previous.repositoryRef,
          ...(previous.verifiedBranch === undefined ? {} :
            { verifiedBranch: previous.verifiedBranch }),
        }, verified);
      requireThat(previous.observedAt <= observation.observedAt, 'STALE',
        'Repository observation is older than the current verified observation');
      requireThat(previous.observedAt !== observation.observedAt ||
        digest(repositoryObservationFromRecord(previous)) === digest(observation),
      'ID_CONFLICT', 'Repository refresh contradicts an observation at the same time');
    }
    const observationId = repositoryObservationKey(observation, verified);
    const existing = tx.get(observationId);
    if (existing) {
      requireThat(digest(repositoryObservationFromRecord(existing)) ===
        digest(observation), 'ID_CONFLICT',
      'Repository observation ID contains different evidence');
      await archiveSupersededObservations(store, tx, { monitorDependencies });
      return existing;
    }
    const record = { type: 'repository-observation', id: observationId,
      workItemId: input.workItemId, repositoryId: member.repositoryId,
      ...observation };
    tx.put(record);
    await archiveSupersededObservations(store, tx, { monitorDependencies });
    return record;
  }, { skipUnchanged: true });
}

export async function currentRepositoryObservation(store, workItemId, repositoryId,
  requestedRemoteName) {
  const state = await store.load(workItemId);
  const member = memberFor(state, repositoryId);
  const config = await repositoryConfiguration(state.metadata, member.repositoryId);
  const selected = await selectedFetchRemote(member, config.remote, requestedRemoteName);
  const currentURL = validateSelectedFetchRemote(selected);
  const observation = latestObservation(state.records, member.repositoryId,
    member.root, currentURL);
  return { selectedFetchRemote: selected, observation,
    ...(observation ? {} : {
      reason: 'Verify this checkout and selected hosted repository with a hosting-service adapter',
    }) };
}

export async function resolveRepositoryDefaultBranch(store, workItemId,
  repositoryId, requestedRemoteName) {
  const state = await store.load(workItemId);
  const member = memberFor(state, repositoryId);
  const config = await repositoryConfiguration(state.metadata, member.repositoryId);
  let selected;
  try {
    selected = await selectedFetchRemote(member, config.remote, requestedRemoteName);
  } catch (error) {
    if (error.code !== 'EVIDENCE') throw error;
    if (!config.defaultBranch) return { resolved: false, reason: error.message };
  }
  const observation = selected ? latestObservation(state.records,
    member.repositoryId, member.root, validateSelectedFetchRemote(selected)) : null;
  return resolveDefaultBranch({
    ...(config.defaultBranch ? { configuredDefaultBranchRef: config.defaultBranch } : {}),
    ...(selected ? { selectedFetchRemote: selected } : {}),
    ...(observation ? {
      repositoryObservation: repositoryObservationFromRecord(observation),
      verification: {
        canonicalLocalRepositoryPath: member.root,
        verifiedRemoteRepositoryURL: observation.remoteRepositoryURL,
        verifiedProvider: observation.provider,
        verifiedConnection: observation.connection,
        verifiedRepositoryRef: observation.repositoryRef,
        ...(observation.verifiedBranch === undefined ? {} :
          { verifiedBranch: observation.verifiedBranch }),
      },
    } : {}),
  });
}
