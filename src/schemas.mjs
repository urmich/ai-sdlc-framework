import path from 'node:path';
import { choice, digest, id, object, requireThat, strings, text } from './core.mjs';
import { validateEffect } from './authority.mjs';
import { validatePullRequestObservation, validateRepositoryObservation } from './repository-observations.mjs';
import { validateCurrentExecutionIdentity, validateExecutionResultIdentity } from './provider-adapters.mjs';
import { hasImmutableArtifactIdentity } from './current-evidence.mjs';
import { validateArtifactResultIdentity } from './external-results.mjs';

const FIELDS = {
  event: ['schemaVersion', 'sequence', 'kind', 'effect', 'sourceReceiptId', 'sourceReceiptDigest', 'inputDigest', 'sessionId', 'repositoryIds', 'snapshots', 'occurredAt', 'digest'],
  'pending-decision': ['sessionId', 'kind', 'effect', 'snapshots', 'policyGeneration'],
  operation: ['sessionId', 'repositoryId', 'bindingKey', 'class', 'action', 'target', 'status', 'correlationKey',
    'requestFingerprint', 'effectFingerprint', 'intent', 'createdAt', 'dispatchBound', 'cycleId', 'candidateDigest', 'artifactId',
    'retryOverrideId', 'priorUncertainOperationId', 'dispatchStartedAt', 'handle', 'evidenceRef', 'expectedMet', 'providerStatus', 'updatedAt', 'candidateStamp',
    'terminalSequence', 'deploymentSequence', 'stageOverride', 'dispatchAmbiguous',
    'environmentBoundaryApplied', 'reservedEventIds', 'intendedOutcome',
    'intendedOutcomeGap', 'hostInvocation', 'resultProof', 'resultGap'],
  reservation: ['eventId', 'operationId'],
  cycle: ['generation', 'candidateDigest', 'sources', 'configDigest', 'testSpecDigest', 'tests', 'results', 'artifacts',
    'deployments', 'reviewRef', 'step', 'pendingPlanSync', 'cause', 'createdAt', 'lastEvidenceSequence',
    'assuranceInvalidated', 'invalidatedEnvironments',
    'environmentInvalidationSequences', 'lastDeploymentSequence'],
  'test-evidence': ['sequence', 'cycleId', 'testId', 'testSpecDigest', 'candidateDigest', 'environment', 'implementation',
    'status', 'observedAt', 'activity', 'evidenceRef', 'runId', 'artifactId', 'deploymentId', 'operationId', 'expectedMet', 'owner', 'host', 'eventId'],
  artifact: ['sequence', 'selectedAt', 'cycleId', 'artifactId', 'environment', 'sourceDigest', 'configDigest', 'buildRunId', 'name', 'artifactType', 'evidenceRef', 'status',
    'repositoryId', 'localRepositoryPath', 'remoteRepositoryURL',
    'provider', 'connection', 'repositoryRef',
    'sourceRevision', 'artifactRef', 'artifactSha256',
    'artifactImmutableVersion', 'artifactRetrievalContext', 'artifactVersionVerified',
    'producingOperationId', 'producingAttemptCapability',
    'producingAttemptRef', 'producingExecution'],
  conflict: ['reason', 'scope', 'references', 'status', 'resolution'],
  locator: ['repositoryId', 'artifactId', 'path', 'digest', 'bindingDigest', 'authorizationId'],
  'audit-reference': ['eventId', 'eventDigest', 'repositoryId', 'commit'],
  'pr-intent': ['provider', 'connection', 'repositoryId', 'sourceRef', 'targetRef', 'sourceRevision', 'targetRevision',
    'draft', 'scope', 'status', 'createdAt', 'prRecordId',
    'localRepositoryPath', 'remoteRepositoryURL', 'sourceRepositoryURL', 'target'],
  pr: ['provider', 'connection', 'repositoryId', 'sourceRef', 'targetRef', 'sourceRevision', 'targetRevision',
    'draft', 'prId', 'url', 'state', 'evidenceRef', 'autoMerge', 'scope', 'mergeRevision'],
  'pr-facts': ['prRecordId', 'policyVersion', 'sourceRevision', 'targetRevision', 'requiredChecks', 'checks',
    'reviewsSatisfied', 'merged', 'providerEvidenceRef', 'mergeContext', 'runMonitorRefs', 'observedAt'],
  'repository-observation': ['repositoryId', 'localRepositoryPath', 'remoteRepositoryURL',
    'provider', 'connection', 'repositoryRef', 'revision', 'defaultBranchRef', 'verifiedBranch',
    'observedAt', 'evidenceRef'],
  'pr-observation': ['repositoryId', 'localRepositoryPath', 'remoteRepositoryURL',
    'provider', 'connection', 'repositoryRef', 'pullRequestRef', 'sourceRepositoryURL',
    'sourceBranchRef', 'targetBranchRef', 'sourceRevision', 'targetRevision',
    'state', 'sequence', 'previousObservationKey', 'observedAt', 'evidenceRef'],
};
export function validateRecord(record) {
  requireThat(FIELDS[record?.type], 'SCHEMA', 'Unknown local record type');
  object(record, ['type', 'id', 'workItemId', ...FIELDS[record.type]], ['type', 'id', 'workItemId']);
  id(record.id); id(record.workItemId);
  if (record.type === 'repository-observation' || record.type === 'pr-observation') {
    id(record.repositoryId, 'repository ID');
    const { type, id: recordId, workItemId, repositoryId, ...observation } = record;
    void type; void recordId; void workItemId; void repositoryId;
    const verification = {
      canonicalLocalRepositoryPath: observation.localRepositoryPath,
      verifiedRemoteRepositoryURL: observation.remoteRepositoryURL,
      verifiedProvider: observation.provider,
      verifiedConnection: observation.connection,
      verifiedRepositoryRef: observation.repositoryRef,
      ...(record.type === 'repository-observation' &&
        observation.verifiedBranch !== undefined ?
        { verifiedBranch: observation.verifiedBranch } : {}),
      ...(record.type === 'pr-observation' ? {
        verifiedPullRequestRef: observation.pullRequestRef,
        ...(observation.sourceRepositoryURL === undefined ? {} :
          { verifiedSourceRepositoryURL: observation.sourceRepositoryURL }),
      } : {}),
    };
    if (record.type === 'repository-observation') {
      requireThat(record.id ===
        `repository-observation-${digest(observation).slice(0, 40)}`,
      'SCHEMA', 'Repository observation ID does not match its evidence');
      validateRepositoryObservation(observation, verification);
    } else {
      requireThat(record.id ===
        `pr-observation-${digest(observation).slice(0, 40)}`,
      'SCHEMA', 'Pull request observation ID does not match its evidence');
      validatePullRequestObservation(observation, verification);
    }
  }
  if (['event', 'pending-decision'].includes(record.type)) {
    validateEffect(record.kind, record.effect);
    requireThat(Array.isArray(record.snapshots), 'SCHEMA', 'Decision snapshots must be an array');
    for (const snapshot of record.snapshots) {
      object(snapshot, ['role', 'repositoryId', 'artifactId', 'locator', 'digest', 'bindingDigest', 'git'],
        ['role', 'locator', 'digest']);
      text(snapshot.locator, 'snapshot locator');
      requireThat(/^[a-f0-9]{64}$/u.test(snapshot.digest), 'SCHEMA', 'Invalid snapshot digest');
      if (snapshot.repositoryId) id(snapshot.repositoryId, 'snapshot repository ID');
      if (snapshot.artifactId) id(snapshot.artifactId, 'snapshot artifact ID');
      if (snapshot.bindingDigest) requireThat(/^[a-f0-9]{64}$/u.test(snapshot.bindingDigest),
        'SCHEMA', 'Invalid external binding digest');
      if (snapshot.git) object(snapshot.git, ['repositoryId', 'commit', 'blob', 'path'], ['repositoryId', 'commit', 'blob', 'path']);
    }
  }
  if (record.type === 'event') {
    for (const field of FIELDS.event) requireThat(record[field] !== undefined, 'SCHEMA', `Effective event missing ${field}`);
    requireThat(record.schemaVersion === 1 && Number.isSafeInteger(record.sequence) && record.sequence > 0, 'SCHEMA', 'Invalid event version or sequence');
    const { digest: expected, ...content } = record;
    requireThat(expected === digest(content), 'DIGEST', 'Effective event content digest mismatch');
  }
  if (record.type === 'operation') {
    choice(record.status, ['prepared', 'dispatching', 'submitted', 'running', 'uncertain', 'succeeded', 'failed', 'cancelled', 'not-started'], 'operation state');
    for (const field of ['repositoryId', 'class', 'target', 'requestFingerprint', 'correlationKey']) text(record[field], field);
    requireThat(typeof record.dispatchBound === 'boolean', 'SCHEMA', 'Operation dispatch binding must be explicit');
    for (const field of ['intendedOutcomeGap', 'resultGap']) {
      if (record[field] !== undefined) text(record[field], field);
    }
    if (record.intendedOutcome !== undefined) {
      object(record.intendedOutcome, ['family', 'actionClass', 'target',
        'requested', 'digest'],
      ['family', 'actionClass', 'target', 'requested', 'digest']);
      const { digest: expected, ...intent } = record.intendedOutcome;
      requireThat(expected === digest(intent), 'DIGEST',
        'Prepared intended outcome has a different identity');
    }
    if (record.hostInvocation !== undefined) {
      object(record.hostInvocation, ['fingerprint', 'sessionDigest',
        'toolName', 'cwdDigest', 'shell', 'hostAdapterId',
        'hostContractDigest', 'hostCallIdDigest'],
      ['fingerprint', 'sessionDigest', 'toolName', 'cwdDigest', 'shell']);
      for (const field of ['fingerprint', 'sessionDigest', 'cwdDigest',
        'hostContractDigest', 'hostCallIdDigest']) {
        if (record.hostInvocation[field] !== undefined) requireThat(
          /^[a-f0-9]{64}$/u.test(record.hostInvocation[field]), 'SCHEMA',
          `Invalid host invocation ${field}`);
      }
    }
    if (record.resultProof !== undefined) {
      object(record.resultProof, ['status', 'dispatchId',
        'intendedOutcomeDigest', 'providerResultId', 'causalKey',
        'resultDigest', 'executionRef', 'attemptCapability', 'attemptRef',
        'executionIdentity', 'artifactIdentity'],
      ['status', 'dispatchId', 'intendedOutcomeDigest', 'resultDigest']);
      requireThat(record.resultProof.dispatchId === record.id &&
        record.resultProof.status === record.status &&
        record.resultProof.intendedOutcomeDigest ===
          record.intendedOutcome?.digest &&
        /^[a-f0-9]{64}$/u.test(record.resultProof.resultDigest),
      'SCHEMA', 'Operation result proof does not match its prepared identity');
      if (record.resultProof.artifactIdentity !== undefined) {
        const identity = validateArtifactResultIdentity(record.resultProof.artifactIdentity);
        requireThat(record.intendedOutcome?.family === 'artifact' &&
          ['artifact', 'artifact-produce'].includes(record.class) &&
          record.resultProof.providerResultId === identity.artifactRef &&
          ['executionRef', 'attemptCapability', 'attemptRef', 'executionIdentity']
            .every(field => record.resultProof[field] === undefined),
        'SCHEMA', 'Artifact result proof must use its immutable artifact identity, not a run handle');
        const target = record.intendedOutcome.target;
        const requested = record.intendedOutcome.requested;
        requireThat(identity.localRepositoryPath === target.localRepositoryPath &&
          identity.remoteRepositoryURL === target.remoteRepositoryURL &&
          (target.provider === undefined ||
            identity.producingExecution.provider === target.provider) &&
          (target.pipeline === undefined ||
            identity.producingExecution.definitionRef === target.pipeline) &&
          identity.sourceRevision === requested.sourceRevision &&
          identity.configDigest === requested.configDigest &&
          identity.artifactName === requested.artifactName,
        'SCHEMA', 'Artifact result identity differs from its prepared repository, producer or source');
        for (const [field, value] of [
          ['artifactRef', identity.artifactRef],
          ['artifactSha256', identity.sha256],
          ['artifactImmutableVersion', identity.immutableVersion],
          ['artifactRetrievalContext', identity.retrievalContext],
          ['producingExecutionRef', identity.producingExecution.executionRef],
          ['producingAttemptRef', identity.producingExecution.attemptRef ?? 'not-applicable'],
        ]) requireThat(requested[field] === undefined || requested[field] === value,
          'SCHEMA', `Artifact result identity differs from prepared ${field}`);
      }
      if (['executionRef', 'attemptCapability', 'attemptRef'].some(field =>
        record.resultProof[field] !== undefined)) {
        text(record.resultProof.executionRef, 'proven execution reference');
        text(record.resultProof.attemptRef, 'proven attempt reference');
        requireThat(
          ['distinct', 'none'].includes(record.resultProof.attemptCapability) &&
          (record.resultProof.attemptCapability === 'none' ?
            record.resultProof.attemptRef === 'not-applicable' :
            !['unknown', 'not-applicable'].includes(record.resultProof.attemptRef)) &&
          record.resultProof.providerResultId ===
            `${record.resultProof.executionRef}:${record.resultProof.attemptRef}`,
        'SCHEMA', 'Operation result proof has inconsistent execution attempt');
      }
      if (record.resultProof.executionIdentity !== undefined) {
        validateExecutionResultIdentity(record.resultProof, {
          ...(record.action?.provider === undefined ? {} :
            { provider: record.action.provider }),
          ...(record.action?.pipeline === undefined ? {} :
            { definitionRef: record.action.pipeline }),
        });
      }
    }
    if (record.terminalSequence !== undefined) requireThat(Number.isSafeInteger(record.terminalSequence) && record.terminalSequence > 0,
      'SCHEMA', 'Operation terminal sequence is invalid');
    if (record.deploymentSequence !== undefined) requireThat(Number.isSafeInteger(record.deploymentSequence) && record.deploymentSequence > 0,
      'SCHEMA', 'Operation deployment sequence is invalid');
  }
  if (record.type === 'cycle') {
    requireThat(Number.isSafeInteger(record.generation) && record.generation > 0 && Array.isArray(record.tests) && Array.isArray(record.sources), 'SCHEMA', 'Invalid validation-cycle schema');
    for (const field of ['candidateDigest', 'configDigest', 'testSpecDigest']) text(record[field], field);
    for (const field of ['results', 'artifacts', 'deployments']) requireThat(record[field] && typeof record[field] === 'object' && !Array.isArray(record[field]), 'SCHEMA', `Invalid cycle ${field}`);
  }
  if (record.type === 'test-evidence') choice(record.status, ['NotRun', 'Passed', 'Failed'], 'test outcome');
  if (record.type === 'artifact') {
    requireThat(Number.isSafeInteger(record.sequence) && record.sequence > 0,
      'SCHEMA', 'Artifact selection sequence is invalid');
    const producerFields = ['repositoryId', 'localRepositoryPath', 'remoteRepositoryURL',
      'provider', 'connection', 'repositoryRef',
      'sourceRevision', 'artifactRef',
      'producingOperationId', 'producingAttemptCapability',
      'producingAttemptRef'];
    if ([...producerFields, 'artifactSha256', 'artifactImmutableVersion',
      'artifactRetrievalContext', 'artifactVersionVerified',
      'producingExecution'].some(field => record[field] !== undefined)) {
      requireThat(producerFields.every(field => record[field] !== undefined),
        'SCHEMA', 'Current artifact producer identity is incomplete');
      id(record.repositoryId, 'artifact repository ID');
      id(record.producingOperationId, 'producing operation ID');
      for (const field of ['localRepositoryPath', 'remoteRepositoryURL',
        'provider', 'connection', 'repositoryRef',
        'artifactRef', 'producingAttemptRef']) text(record[field], field, 4096);
      choice(record.producingAttemptCapability, ['none', 'distinct'],
        'artifact producing execution attempt capability');
      requireThat(/^[a-f0-9]{40,64}$/u.test(record.sourceRevision) &&
        hasImmutableArtifactIdentity(record), 'SCHEMA',
      'Current artifact requires a full source commit and verified immutable content');
      if (record.producingExecution !== undefined) {
        const identity = validateCurrentExecutionIdentity(
          record.producingExecution, record.producingAttemptCapability);
        requireThat(identity.provider === record.provider &&
          identity.connection === record.connection &&
          (identity.attemptKind === 'known' ?
            identity.attemptRef === record.producingAttemptRef :
            identity.attemptKind === 'not-applicable' &&
              record.producingAttemptRef === 'not-applicable'),
        'SCHEMA', 'Artifact producing execution identity is inconsistent');
      }
    }
  }
  if (record.type === 'conflict') choice(record.status, ['open', 'resolved'], 'conflict state');
  return record;
}
export function validateManifest(manifest) {
  object(manifest, ['schemaVersion', 'revision', 'workItemId', 'coordinatorId', 'repositoryIds', 'artifacts', 'historyStartsAt'],
    ['schemaVersion', 'revision', 'workItemId', 'coordinatorId', 'repositoryIds', 'artifacts', 'historyStartsAt']);
  requireThat(manifest.schemaVersion === 1 && Number.isSafeInteger(manifest.revision), 'SCHEMA', 'Unsupported work-item manifest');
  id(manifest.workItemId); id(manifest.coordinatorId); strings(manifest.repositoryIds, 'repository IDs', 100);
  requireThat(manifest.repositoryIds.includes(manifest.coordinatorId) && Array.isArray(manifest.artifacts), 'SCHEMA', 'Manifest coordinator/artifact mapping is invalid');
  for (const artifact of manifest.artifacts) {
    object(artifact, ['role', 'kind', 'repositoryId', 'artifactId', 'path', 'digest', 'locatorId', 'planned'], ['role', 'kind', 'digest']);
    choice(artifact.role, ['requirements', 'test-plan', 'technical-design'], 'artifact role');
    choice(artifact.kind, ['git', 'external-file'], 'artifact kind');
    if (artifact.artifactId) id(artifact.artifactId, 'artifact ID');
    if (artifact.kind === 'git') {
      requireThat(manifest.repositoryIds.includes(artifact.repositoryId) && typeof artifact.path === 'string' &&
        !path.isAbsolute(artifact.path) && !/^[A-Za-z]:[\\/]/u.test(artifact.path) && !artifact.path.split(/[\\/]/u).includes('..'), 'PATH', 'Portable artifact path must stay within its logical repository');
      requireThat(artifact.planned === true ? artifact.digest === 'pending' : /^[a-f0-9]{64}$/u.test(artifact.digest),
        'SCHEMA', 'Git artifact digest/planned state is invalid');
    } else {
      id(artifact.locatorId);
      if (artifact.repositoryId) requireThat(manifest.repositoryIds.includes(artifact.repositoryId),
        'SCHEMA', 'External artifact repository is not a manifest member');
      requireThat(/^[a-f0-9]{64}$/u.test(artifact.digest), 'SCHEMA', 'External artifact digest is invalid');
    }
  }
  const identities = manifest.artifacts.map(artifact =>
    `${artifact.role}\0${artifact.repositoryId ?? manifest.coordinatorId}\0${artifact.artifactId ?? 'default'}`);
  requireThat(new Set(identities).size === identities.length,
    'SCHEMA', 'Artifact role/repository identity must be unique');
  const gitPaths = manifest.artifacts.filter(artifact => artifact.kind === 'git')
    .map(artifact => `${artifact.repositoryId}\0${artifact.path.replaceAll('\\', '/')}`);
  requireThat(new Set(gitPaths).size === gitPaths.length,
    'SCHEMA', 'One repository path cannot serve multiple artifact roles');
  const locatorIds = manifest.artifacts.filter(artifact => artifact.kind === 'external-file')
    .map(artifact => artifact.locatorId);
  requireThat(new Set(locatorIds).size === locatorIds.length,
    'SCHEMA', 'External locator IDs must be unique');
  return manifest;
}
