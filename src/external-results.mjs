import { canonical, digest, object, requireThat, text } from './core.mjs';
import { sameExecutionIdentity, validateCurrentExecutionIdentity,
  validateExecutionResultIdentity } from './provider-adapters.mjs';

const FAMILIES = Object.freeze({
  'local-build': 'execution',
  build: 'execution',
  pipeline: 'execution',
  'pr-validation': 'execution',
  test: 'test',
  artifact: 'artifact',
  'artifact-produce': 'artifact',
  deploy: 'deployment',
  'pr-create': 'pull-request',
  'pr-update': 'pull-request',
  push: 'git-ref',
  merge: 'merge',
  'auto-merge': 'policy',
  'policy-bypass': 'policy',
  configuration: 'policy',
  notification: 'notification',
});
const ACTION_FIELDS = new Set([
  'class', 'repositoryId', 'localRepositoryPath', 'remoteRepositoryURL',
  'remoteUrlDigest', 'sourceRepositoryURL', 'environment', 'target',
  'configDigest', 'provider', 'pipeline', 'sourceRef', 'targetRef',
  'sourceRevision', 'targetRevision',
  'baseRef', 'draft', 'prId', 'prRecordId', 'artifactId', 'deploymentId',
  'policyVersion', 'previousPolicyVersion', 'requestedState', 'contentDigest',
  'recipient', 'testId', 'candidateDigest', 'testSpecDigest',
  'artifactRef', 'artifactSha256', 'artifactImmutableVersion',
  'artifactRetrievalContext', 'artifactName', 'producingExecutionRef',
  'producingAttemptRef', 'owner', 'host', 'stages', 'implicitEnvironments',
  'paths', 'toolOptions', 'force', 'delete', 'earlyDraft', 'monitorCapability',
  'externalPermission', 'preservesChanges', 'outOfScope', 'itemId',
]);
const TARGET_FIELDS = [
  'repositoryId', 'localRepositoryPath', 'remoteRepositoryURL',
  'remoteUrlDigest', 'environment', 'target', 'provider', 'pipeline',
];
const EFFECT_FIELDS = [
  'configDigest', 'sourceRef', 'targetRef', 'sourceRevision', 'targetRevision',
  'baseRef', 'draft', 'prId', 'prRecordId', 'artifactId', 'deploymentId',
  'policyVersion', 'previousPolicyVersion', 'requestedState', 'contentDigest',
  'recipient', 'testId', 'candidateDigest', 'testSpecDigest',
  'artifactRef', 'artifactSha256', 'artifactImmutableVersion',
  'artifactRetrievalContext', 'artifactName', 'producingExecutionRef',
  'producingAttemptRef', 'sourceRepositoryURL', 'owner', 'host',
  'stages', 'implicitEnvironments',
  'paths', 'toolOptions', 'force', 'delete', 'earlyDraft',
];
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'not-started']);
const IN_PROGRESS = new Set(['submitted', 'running', 'uncertain']);
const OBSERVATION_FIELDS = new Set([
  'status', 'family', 'target', 'intendedOutcomeDigest', 'providerStatus',
  'providerVerified', 'providerResultId', 'causalProof', 'nonDispatchProof',
  'result', 'evidence', 'failure',
]);
const RESULT_FIELDS = new Set([
  'executionRef', 'attemptCapability', 'attemptRef', 'sourceRevision',
  'configDigest', 'provider', 'pipeline', 'testId', 'expectedMet', 'local',
  'artifactRef', 'artifactId', 'artifactName', 'sha256', 'immutableVersion',
  'versionVerified', 'artifactSha256', 'deploymentRef', 'deploymentId',
  'environment', 'target', 'candidateDigest', 'testSpecDigest',
  'prId', 'sourceRepositoryURL', 'targetRepositoryURL', 'sourceRef',
  'targetRef', 'targetRevision', 'draft', 'state', 'destination', 'ref',
  'revision', 'published', 'deleted', 'deletionConfirmed', 'merged',
  'mergeRevision', 'policyVersion', 'changeApplied', 'previousPolicyVersion',
  'recipient', 'contentDigest', 'deliveryReceipt', 'delivered',
  'remoteRepositoryURL', 'remoteUrlDigest', 'autoMergeEnabled',
  'terminalStatus', 'failureRef', 'executionIdentity', 'retrievalContext',
  'artifactImmutableVersion', 'artifactRetrievalContext',
]);

function plain(value) {
  return value !== null && typeof value === 'object' &&
    !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function snapshot(value) {
  canonical(value);
  const copy = JSON.parse(JSON.stringify(value));
  function freeze(node) {
    if (node && typeof node === 'object') {
      for (const child of Object.values(node)) freeze(child);
      Object.freeze(node);
    }
    return node;
  }
  return freeze(copy);
}

function fields(source, names) {
  return Object.fromEntries(names.filter(name =>
    Object.hasOwn(source, name)).map(name => [name, source[name]]));
}

function nonempty(value) {
  return typeof value === 'string' && value.length > 0;
}

function exact(expected, actual) {
  return expected !== undefined && actual !== undefined &&
    canonical(expected) === canonical(actual);
}

export function effectActionClass(actionClass) {
  return actionClass === 'artifact-produce' ? 'artifact' : actionClass;
}

function knownIdentityValue(field, value) {
  if (['sourceRevision', 'targetRevision'].includes(field)) {
    return typeof value === 'string' &&
      /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value);
  }
  if (['draft', 'force', 'delete', 'earlyDraft'].includes(field)) {
    return typeof value === 'boolean';
  }
  if (['paths', 'stages', 'implicitEnvironments'].includes(field)) {
    return Array.isArray(value) && value.every(item => typeof item === 'string' &&
      item.trim().length > 0);
  }
  if (field === 'toolOptions') return plain(value);
  if (typeof value === 'string') {
    return value.trim().length > 0 &&
      value !== 'unknown' &&
      (value !== 'not-applicable' ||
        ['attemptRef', 'producingAttemptRef'].includes(field));
  }
  return false;
}

function knownIdentityDiffers(previous, proposed, { publication = false } = {}) {
  if (!plain(previous) || !plain(proposed)) return false;
  return Object.keys(previous).some(field => {
    if (field === 'target' && publication) return false;
    const left = previous[field];
    const right = proposed[field];
    if (!knownIdentityValue(field, left) ||
        !knownIdentityValue(field, right)) return false;
    if (['sourceRevision', 'targetRevision'].includes(field) &&
        left.length !== right.length) return false;
    return !exact(left, right);
  });
}

function completeIntendedOutcome(outcome) {
  const { actionClass, family, target, requested } = outcome;
  if (FAMILIES[actionClass] !== family || !plain(target) || !plain(requested)) return false;
  if (!Object.keys(target).every(field => TARGET_FIELDS.includes(field) &&
      knownIdentityValue(field, target[field])) ||
      !Object.keys(requested).every(field => EFFECT_FIELDS.includes(field) &&
        knownIdentityValue(field, requested[field]))) return false;
  if (!['repositoryId', 'localRepositoryPath', 'remoteRepositoryURL', 'provider']
    .every(field => knownIdentityValue(field, target[field])) ||
      !knownIdentityValue('sourceRevision', requested.sourceRevision)) return false;
  const has = (source, fields) => fields.every(field =>
    knownIdentityValue(field, source[field]));
  switch (family) {
    case 'execution':
      return has(target, ['environment', 'target', 'pipeline']) &&
        has(requested, ['configDigest']);
    case 'test':
      return has(target, ['environment', 'target']) &&
        has(requested, ['configDigest', 'testId', 'artifactId', 'deploymentId']);
    case 'artifact':
      return has(requested, ['configDigest', 'artifactId', 'artifactName']);
    case 'deployment':
      return has(target, ['environment', 'target']) &&
        has(requested, ['configDigest', 'artifactId', 'artifactRef']) &&
        (has(requested, ['artifactSha256']) ||
          has(requested, ['artifactImmutableVersion', 'artifactRetrievalContext']));
    case 'pull-request':
      return has(requested, ['sourceRepositoryURL', 'sourceRef', 'targetRef',
        'targetRevision', 'draft']) &&
        (actionClass !== 'pr-update' || has(requested, ['prId']));
    case 'git-ref':
      return has(target, ['target']) && has(requested, ['targetRef']);
    case 'merge':
      return has(requested, ['prId', 'targetRevision']);
    case 'policy':
      return has(target, ['target']) && has(requested, ['policyVersion']) &&
        (actionClass !== 'auto-merge' || has(requested, ['prId']));
    case 'notification':
      return has(requested, ['recipient', 'contentDigest']);
    default:
      return false;
  }
}

export function intendedOutcomesMayMatch(previous, proposed) {
  if (!plain(previous) || !plain(proposed)) return true;
  const ambiguousRevisionWidth = ['sourceRevision', 'targetRevision'].some(field =>
    knownIdentityValue(field, previous.requested?.[field]) &&
    knownIdentityValue(field, proposed.requested?.[field]) &&
    previous.requested[field].length !== proposed.requested[field].length);
  if (!ambiguousRevisionWidth &&
      completeIntendedOutcome(previous) && completeIntendedOutcome(proposed)) {
    const effect = outcome => ({ family: outcome.family,
      actionClass: effectActionClass(outcome.actionClass),
      target: outcome.target, requested: outcome.requested });
    return exact(effect(previous), effect(proposed));
  }
  if (knownIdentityDiffers(
    { family: previous.family, actionClass: effectActionClass(previous.actionClass) },
    { family: proposed.family, actionClass: effectActionClass(proposed.actionClass) })) return false;
  return !knownIdentityDiffers(
    plain(previous.target) ? fields(previous.target, TARGET_FIELDS) : {},
    plain(proposed.target) ? fields(proposed.target, TARGET_FIELDS) : {}, {
    publication: ['push', 'pr-create', 'pr-update'].includes(proposed.actionClass),
  }) && !knownIdentityDiffers(
    plain(previous.requested) ? fields(previous.requested, EFFECT_FIELDS) : {},
    plain(proposed.requested) ? fields(proposed.requested, EFFECT_FIELDS) : {});
}

export function validateArtifactResultIdentity(identity) {
  object(identity, ['localRepositoryPath', 'remoteRepositoryURL',
    'artifactRef', 'artifactName', 'sourceRevision', 'configDigest',
    'sha256', 'immutableVersion', 'retrievalContext', 'versionVerified',
    'producingExecution', 'attemptCapability'],
  ['localRepositoryPath', 'remoteRepositoryURL', 'artifactRef', 'artifactName',
    'sourceRevision', 'configDigest', 'producingExecution', 'attemptCapability']);
  for (const field of ['localRepositoryPath', 'remoteRepositoryURL']) {
    text(identity[field], `artifact result ${field}`, 4096);
  }
  for (const field of ['artifactRef', 'artifactName', 'configDigest']) {
    text(identity[field], `artifact result ${field}`);
  }
  requireThat(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(identity.sourceRevision),
    'EVIDENCE', 'Artifact result requires its exact observed source revision');
  const hasDigest = typeof identity.sha256 === 'string' &&
    /^[a-f0-9]{64}$/u.test(identity.sha256) &&
    identity.immutableVersion === undefined &&
    identity.retrievalContext === undefined &&
    identity.versionVerified === undefined;
  const hasVersion = identity.sha256 === undefined &&
    nonempty(identity.immutableVersion) && nonempty(identity.retrievalContext) &&
    identity.versionVerified === true;
  requireThat(hasDigest || hasVersion, 'EVIDENCE',
    'Artifact result requires a digest or proven immutable version');
  if (hasVersion) {
    text(identity.immutableVersion, 'artifact result immutable version');
    text(identity.retrievalContext, 'artifact result retrieval context');
  }
  const producingExecution = validateCurrentExecutionIdentity(
    identity.producingExecution, identity.attemptCapability);
  requireThat(['known', 'not-applicable'].includes(producingExecution.attemptKind),
    'EVIDENCE', 'Artifact result requires a proven producer attempt');
  return snapshot({ ...identity, producingExecution });
}

export function operationResultProof(operation) {
  const proof = operation.resultProof;
  const intended = operation.intendedOutcome;
  if (intended?.family !== 'artifact') return proof;
  const target = plain(intended.target) ? intended.target : {};
  const requested = plain(intended.requested) ? intended.requested : {};
  return {
    ...proof, family: 'artifact',
    artifactScope: {
      ...fields(target, ['localRepositoryPath', 'remoteRepositoryURL', 'provider']),
      ...fields(requested, ['artifactName', 'sourceRevision', 'configDigest']),
      ...(requested.producingExecutionRef === undefined ? {} :
        { executionRef: requested.producingExecutionRef }),
      ...(requested.producingAttemptRef === undefined ? {} :
        { attemptRef: requested.producingAttemptRef }),
    },
  };
}

export function deriveIntendedOutcome(action) {
  requireThat(plain(action) && FAMILIES[action.class], 'INPUT',
    'Unsupported external action class');
  requireThat(Object.keys(action).every(key =>
    ACTION_FIELDS.has(key) || key === 'operationId'), 'INPUT',
  'Intended outcome must use pre-dispatch action fields only');
  requireThat(nonempty(action.repositoryId), 'INPUT',
    'Intended outcome requires a repository');
  const isLocal = action.class === 'local-build' ||
    (action.class === 'test' && action.environment === 'local');
  if (!isLocal) {
    requireThat(nonempty(action.remoteRepositoryURL) ||
      nonempty(action.remoteUrlDigest), 'INPUT',
    'External outcome requires the verified hosted destination');
  }
  if (['build', 'pipeline', 'pr-validation', 'deploy'].includes(action.class) ||
      (action.class === 'test' && !isLocal)) {
    requireThat(nonempty(action.environment) && nonempty(action.target),
      'INPUT', 'Remote execution requires an environment and target');
  }
  if (['build', 'pipeline', 'pr-validation', 'test', 'local-build'].includes(action.class)) {
    requireThat(nonempty(action.sourceRevision) ||
      (isLocal && nonempty(action.candidateDigest)), 'INPUT',
    'Execution requires its pre-dispatch candidate revision or local candidate digest');
    if (!isLocal) requireThat(nonempty(action.configDigest), 'INPUT',
      'Remote execution requires its build configuration');
    if (['build', 'pipeline', 'pr-validation'].includes(action.class)) {
      requireThat(nonempty(action.provider) && nonempty(action.pipeline),
        'INPUT', 'Remote execution requires its provider and workflow definition');
    }
  }
  if (action.class === 'push') {
    requireThat(nonempty(action.targetRef) && nonempty(action.target),
      'INPUT', 'Git ref action requires a destination and full ref');
    if (!action.delete) requireThat(nonempty(action.sourceRevision),
      'INPUT', 'Publication requires a source revision');
  }
  if (action.class === 'pr-create' || action.class === 'pr-update') {
    if (action.class === 'pr-create') requireThat(action.prId === undefined,
      'INPUT', 'PR creation cannot assume its post-dispatch provider ID');
    requireThat(['sourceRef', 'targetRef', 'sourceRevision',
      'targetRevision'].every(key => nonempty(action[key])), 'INPUT',
    'Pull request requires both full branch refs and revisions');
    requireThat(typeof action.draft === 'boolean', 'INPUT',
      'Pull request requires the intended draft state');
    requireThat(nonempty(action.sourceRepositoryURL) &&
      nonempty(action.remoteRepositoryURL), 'INPUT',
    'Pull request requires verified source and hosted repository URLs');
    if (action.class === 'pr-update') requireThat(nonempty(action.prId),
      'INPUT', 'PR update requires the hosted PR ID');
  }
  if (action.class === 'artifact' || action.class === 'artifact-produce' ||
      action.class === 'deploy') requireThat(nonempty(action.artifactId),
    'INPUT', 'Artifact or deployment action requires the intended artifact');
  if (action.class === 'test') requireThat(nonempty(action.testId), 'INPUT',
    'Test action requires a test ID');
  if (action.class === 'test' && !isLocal) requireThat(
    nonempty(action.artifactId) && nonempty(action.deploymentId),
  'INPUT', 'Environment test requires the selected artifact and deployment');
  if (action.class === 'deploy') requireThat(
    nonempty(action.artifactRef) &&
    (/^[a-f0-9]{64}$/u.test(action.artifactSha256 ?? '') &&
      action.artifactImmutableVersion === undefined &&
      action.artifactRetrievalContext === undefined ||
      action.artifactSha256 === undefined &&
      nonempty(action.artifactImmutableVersion) &&
      nonempty(action.artifactRetrievalContext)) &&
    nonempty(action.sourceRevision) && nonempty(action.configDigest),
  'INPUT', 'Deployment requires the selected immutable artifact and exact candidate');
  if (['artifact', 'artifact-produce'].includes(action.class)) {
    requireThat(nonempty(action.artifactName) &&
      nonempty(action.sourceRevision) && nonempty(action.configDigest),
    'INPUT', 'Produced artifact requires a name, revision and configuration');
  }
  if (action.class === 'merge') requireThat(nonempty(action.prId) &&
    nonempty(action.sourceRevision) && nonempty(action.targetRevision),
  'INPUT', 'Merge requires the hosted PR and both branch revisions');
  if (action.class === 'notification') requireThat(
    nonempty(action.recipient) && nonempty(action.contentDigest), 'INPUT',
    'Notification requires recipient and content digest');
  if (['policy-bypass', 'configuration', 'auto-merge'].includes(action.class)) {
    requireThat(nonempty(action.target) && nonempty(action.policyVersion),
      'INPUT', 'Policy action requires target and requested version');
    if (action.class === 'auto-merge') requireThat(nonempty(action.prId),
      'INPUT', 'Auto-merge requires the hosted PR ID');
  }
  const intended = {
    family: FAMILIES[action.class],
    actionClass: action.class,
    target: fields(action, TARGET_FIELDS),
    requested: fields(action, EFFECT_FIELDS),
  };
  return snapshot({ ...intended, digest: digest(intended) });
}

function requiredResult(intended, observed) {
  const { actionClass: kind, requested, target } = intended;
  const result = observed.result;
  if (!plain(result)) return false;
  const equal = (key, expected) =>
    expected === undefined || exact(expected, result[key]);
  switch (intended.family) {
    case 'execution':
    case 'test': {
      if (!nonempty(result.executionRef)) return false;
      if (result.attemptCapability === 'distinct') {
        if (!nonempty(result.attemptRef) || result.attemptRef === 'unknown' ||
            result.attemptRef === 'not-applicable') return false;
      } else if (result.attemptCapability === 'none') {
        if (result.attemptRef !== 'not-applicable') return false;
      } else return false;
      return equal('testId', requested.testId) &&
        equal('sourceRevision', requested.sourceRevision) &&
        equal('candidateDigest', requested.candidateDigest) &&
        equal('testSpecDigest', requested.testSpecDigest) &&
        equal('configDigest', requested.configDigest) &&
        (equal('provider', target.provider) ||
          result.provider === undefined &&
            result.executionIdentity?.provider === target.provider) &&
        equal('pipeline', target.pipeline) &&
        (kind === 'local-build' ||
          kind === 'test' && target.environment === 'local' ||
          result.environment === target.environment &&
            result.target === target.target &&
            (kind !== 'test' ||
              nonempty(requested.artifactId) &&
              nonempty(requested.deploymentId) &&
              equal('artifactId', requested.artifactId) &&
              equal('deploymentId', requested.deploymentId))) &&
        (intended.family !== 'test' || typeof result.expectedMet === 'boolean') &&
        (kind !== 'local-build' || result.local === true);
    }
    case 'artifact':
      return nonempty(result.artifactRef) && nonempty(result.executionRef) &&
        ((result.attemptCapability === 'distinct' &&
          nonempty(result.attemptRef) &&
          !['unknown', 'not-applicable'].includes(result.attemptRef)) ||
          (result.attemptCapability === 'none' &&
            result.attemptRef === 'not-applicable')) &&
        (typeof result.sha256 === 'string' &&
          /^[a-f0-9]{64}$/u.test(result.sha256) &&
          result.immutableVersion === undefined &&
          result.retrievalContext === undefined ||
          result.sha256 === undefined &&
            nonempty(result.immutableVersion) &&
            nonempty(result.retrievalContext) &&
            result.versionVerified === true) &&
        equal('artifactId', requested.artifactId) &&
        equal('artifactRef', requested.artifactRef) &&
        equal('artifactName', requested.artifactName) &&
        equal('sha256', requested.artifactSha256) &&
        equal('immutableVersion', requested.artifactImmutableVersion) &&
        equal('retrievalContext', requested.artifactRetrievalContext) &&
        equal('executionRef', requested.producingExecutionRef) &&
        equal('attemptRef', requested.producingAttemptRef) &&
        equal('sourceRevision', requested.sourceRevision) &&
        equal('configDigest', requested.configDigest);
    case 'deployment':
      return nonempty(result.deploymentRef) &&
        equal('artifactId', requested.artifactId) &&
        equal('artifactRef', requested.artifactRef) &&
        equal('artifactSha256', requested.artifactSha256) &&
        equal('artifactImmutableVersion', requested.artifactImmutableVersion) &&
        equal('artifactRetrievalContext', requested.artifactRetrievalContext) &&
        (requested.artifactSha256 === undefined ?
          result.artifactSha256 === undefined &&
            nonempty(result.artifactImmutableVersion) &&
            nonempty(result.artifactRetrievalContext) :
          result.artifactImmutableVersion === undefined &&
            result.artifactRetrievalContext === undefined) &&
        equal('deploymentId', requested.deploymentId) &&
        equal('environment', target.environment) &&
        equal('target', target.target) &&
        equal('sourceRevision', requested.sourceRevision) &&
        equal('configDigest', requested.configDigest);
    case 'pull-request':
      return nonempty(result.prId) &&
        (kind !== 'pr-update' || equal('prId', requested.prId)) &&
        ['sourceRef', 'targetRef', 'sourceRevision', 'targetRevision',
          'draft'].every(key => equal(key, requested[key])) &&
        nonempty(result.sourceRepositoryURL) &&
        nonempty(result.targetRepositoryURL) &&
        equal('sourceRepositoryURL', requested.sourceRepositoryURL) &&
        (target.remoteRepositoryURL === undefined ||
          result.targetRepositoryURL === target.remoteRepositoryURL) &&
        (requested.requestedState === undefined ||
          result.state === requested.requestedState);
    case 'git-ref':
      return result.ref === requested.targetRef &&
        result.destination === target.target &&
        (kind !== 'push' || requested.delete !== true ?
          result.revision === requested.sourceRevision && result.published === true :
          result.deleted === true && result.deletionConfirmed === true);
    case 'merge':
      return nonempty(result.prId) && equal('prId', requested.prId) &&
        result.merged === true && nonempty(result.mergeRevision) &&
        equal('sourceRevision', requested.sourceRevision) &&
        equal('targetRevision', requested.targetRevision);
    case 'policy':
      return result.target === target.target &&
        result.policyVersion === requested.policyVersion &&
        result.changeApplied === true &&
        (kind !== 'auto-merge' ||
          result.prId === requested.prId &&
          result.autoMergeEnabled === true) &&
        (requested.previousPolicyVersion === undefined ||
          result.previousPolicyVersion === requested.previousPolicyVersion);
    case 'notification':
      return nonempty(result.deliveryReceipt) &&
        result.delivered === true && result.recipient === requested.recipient &&
        result.contentDigest === requested.contentDigest;
    default:
      return false;
  }
}

function hostedDestinationMatches(intended, result) {
  if (intended.actionClass === 'local-build' ||
      (intended.actionClass === 'test' &&
        intended.target.environment === 'local')) return true;
  const hostedUrl = intended.family === 'pull-request' ?
    result.targetRepositoryURL ?? result.remoteRepositoryURL :
    result.remoteRepositoryURL;
  return (intended.target.remoteRepositoryURL === undefined ||
      hostedUrl === intended.target.remoteRepositoryURL &&
        (result.remoteRepositoryURL === undefined ||
          result.remoteRepositoryURL === intended.target.remoteRepositoryURL)) &&
    (intended.target.remoteUrlDigest === undefined ||
      result.remoteUrlDigest === intended.target.remoteUrlDigest);
}

function resultIdentity(intended, result) {
  switch (intended.family) {
    case 'execution':
    case 'test':
      return `${result.executionRef}:${result.attemptRef}`;
    case 'artifact': return result.artifactRef;
    case 'deployment': return result.deploymentRef;
    case 'pull-request': return result.prId;
    case 'git-ref': return `${result.destination}:${result.ref}`;
    case 'merge': return `${result.prId}:${result.mergeRevision}`;
    case 'policy': return `${result.target}:${result.policyVersion}`;
    case 'notification': return result.deliveryReceipt;
    default: return null;
  }
}

function causalKey(dispatch, observed) {
  const proof = observed.causalProof;
  if (!plain(proof) || proof.dispatchId !== dispatch.id ||
      proof.resultId !== observed.providerResultId ||
      !nonempty(observed.providerResultId) ||
      proof.supported !== true) return null;
  if (proof.kind === 'host-call' &&
      nonempty(dispatch.hostCallId) &&
      dispatch.hostCallSupported === true &&
      proof.hostCallId === dispatch.hostCallId) {
    return `host:${digest(proof.hostCallId)}`;
  }
  if (proof.kind === 'provider-request' &&
      dispatch.providerRequestSupported === true &&
      nonempty(dispatch.providerRequestId) &&
      proof.providerRequestId === dispatch.providerRequestId &&
      proof.accepted === true) {
    return `request:${digest(proof.providerRequestId)}`;
  }
  if (proof.kind === 'provider-idempotency' &&
      dispatch.providerRequestSupported === true &&
      nonempty(dispatch.providerIdempotencyToken) &&
      proof.providerIdempotencyToken === dispatch.providerIdempotencyToken &&
      proof.accepted === true) {
    return `token:${digest(proof.providerIdempotencyToken)}`;
  }
  return null;
}

function uncertain(reason) {
  return { status: 'uncertain', reason };
}

function supportedObservation(observed) {
  const only = (node, allowed) => node == null ||
    plain(node) && Object.keys(node).every(key => allowed.includes(key));
  return Object.keys(observed).every(key => OBSERVATION_FIELDS.has(key)) &&
    only(observed.result, [...RESULT_FIELDS]) &&
    only(observed.evidence, ['ref', 'verified', 'sha256',
      'immutableVersion', 'retrievalContext']) &&
    only(observed.causalProof, ['kind', 'dispatchId', 'resultId', 'supported',
      'hostCallId', 'providerRequestId', 'providerIdempotencyToken',
      'accepted']) &&
    only(observed.nonDispatchProof, ['kind', 'hostSupported', 'dispatchId',
      'dispatchAttempted']) &&
    only(observed.failure, ['terminal', 'providerVerified', 'noEffect']);
}

function verifiedEvidence(evidence) {
  return plain(evidence) && nonempty(evidence.ref) &&
    evidence.ref.length <= 512 && evidence.verified === true &&
    (typeof evidence.sha256 === 'string' &&
      /^[a-f0-9]{64}$/u.test(evidence.sha256) ||
      nonempty(evidence.immutableVersion) &&
        evidence.immutableVersion.length <= 512 &&
        nonempty(evidence.retrievalContext) &&
        evidence.retrievalContext.length <= 512);
}

export function sameResultResource(prior, proposed) {
  if (!prior?.providerResultId ||
      prior.providerResultId !== proposed?.providerResultId) return false;
  if (prior.artifactIdentity && proposed.artifactIdentity) {
    return exact(prior.artifactIdentity, proposed.artifactIdentity);
  }
  if (proposed.artifactIdentity && prior.family === 'artifact') {
    const identity = proposed.artifactIdentity;
    return !knownIdentityDiffers(prior.artifactScope, {
      ...fields(identity, ['localRepositoryPath', 'remoteRepositoryURL',
        'artifactName', 'sourceRevision', 'configDigest']),
      provider: identity.producingExecution.provider,
      executionRef: identity.producingExecution.executionRef,
      attemptRef: identity.producingExecution.attemptRef ?? 'not-applicable',
    });
  }
  if (prior.executionIdentity && proposed.executionIdentity) {
    return sameExecutionIdentity(prior.executionIdentity,
      proposed.executionIdentity);
  }
  return prior.intendedOutcomeDigest === proposed.intendedOutcomeDigest;
}

// priorResults must be read and reserved atomically by the caller when accepting a terminal result.
export function validateOperationResult(intended, dispatch, observed, {
  priorResults = [], previousTerminal = null, executionContext = {},
  requireArtifactExecutionIdentity = false,
} = {}) {
  requireThat(plain(intended) && nonempty(intended.digest) &&
    digest(fields(intended, ['family', 'actionClass', 'target', 'requested'])) ===
      intended.digest, 'INPUT',
  'Invalid prepared intended outcome');
  requireThat(plain(dispatch) && nonempty(dispatch.id), 'INPUT',
    'Result requires the prepared dispatch identity');
  if (!plain(observed) || !nonempty(observed.status)) return uncertain('malformed-result');
  try { canonical(observed); } catch {
    return uncertain('malformed-result');
  }
  if (!supportedObservation(observed)) return uncertain('unsupported-result-shape');
  const evidence = observed.evidence;
  const resultDigest = digest(observed);
  if (previousTerminal) {
    requireThat(previousTerminal.dispatchId === dispatch.id &&
      previousTerminal.intendedOutcomeDigest === intended.digest &&
      previousTerminal.resultDigest === resultDigest,
    'ID_CONFLICT', 'Terminal result replay differs from the complete previous result');
    return previousTerminal;
  }
  if (!TERMINAL.has(observed.status) && !IN_PROGRESS.has(observed.status)) {
    return uncertain('malformed-result');
  }
  if (observed.intendedOutcomeDigest !== intended.digest ||
      !plain(observed.target) || !exact(observed.target, intended.target) ||
      observed.family !== intended.family) return uncertain('wrong-effect-or-target');
  if (!verifiedEvidence(evidence)) return uncertain('missing-verified-evidence');
  if (observed.status === 'not-started') {
    if (dispatch.status !== 'prepared' ||
        observed.result !== undefined ||
        observed.providerResultId !== undefined ||
        observed.causalProof !== undefined ||
        (observed.providerStatus !== undefined &&
          observed.providerStatus !== 'not-started') ||
        observed.nonDispatchProof?.kind !== 'host-non-dispatch' ||
        observed.nonDispatchProof?.hostSupported !== true ||
        observed.nonDispatchProof?.dispatchId !== dispatch.id ||
        observed.nonDispatchProof?.dispatchAttempted !== false) {
      return uncertain('missing-affirmative-non-dispatch-proof');
    }
    return Object.freeze({ status: 'not-started', dispatchId: dispatch.id,
      intendedOutcomeDigest: intended.digest, resultDigest });
  }
  if (IN_PROGRESS.has(observed.status)) return uncertain('incomplete-result');
  if (observed.providerStatus !== observed.status ||
      observed.providerVerified !== true) return uncertain('unverified-terminal-status');
  const key = causalKey(dispatch, observed);
  if (!key) return uncertain('missing-dispatch-to-result-proof');
  const noEffect = ['failed', 'cancelled'].includes(observed.status) &&
    observed.failure?.noEffect === true &&
    plain(observed.result) &&
    nonempty(observed.result.failureRef) &&
    observed.result.failureRef === observed.providerResultId &&
    Object.keys(observed.result).every(key => ['failureRef',
      'remoteRepositoryURL', 'remoteUrlDigest'].includes(key));
  const hostedExecution = intended.family === 'execution' &&
    intended.actionClass !== 'local-build' ||
    intended.family === 'test' && intended.target.environment !== 'local';
  let executionIdentity;
  if ((hostedExecution ||
      requireArtifactExecutionIdentity && intended.family === 'artifact') && !noEffect) {
    if (observed.result?.executionIdentity === undefined) {
      return uncertain('missing-execution-identity');
    }
    try {
      executionIdentity = validateExecutionResultIdentity(observed.result, {
        ...executionContext,
        ...(intended.target.provider === undefined ? {} :
          { provider: intended.target.provider }),
        ...(intended.target.pipeline === undefined ? {} :
          { definitionRef: intended.target.pipeline }),
      });
      if (executionContext.provider !== undefined &&
          executionIdentity.provider !== executionContext.provider ||
          executionContext.definitionRef !== undefined &&
          executionIdentity.definitionRef !== executionContext.definitionRef) {
        return uncertain('inconsistent-execution-identity');
      }
    } catch (error) {
      if (!['INPUT', 'EVIDENCE'].includes(error.code)) throw error;
      return uncertain('inconsistent-execution-identity');
    }
  }
  const immutableResultIdentity = ['execution', 'test', 'artifact',
    'deployment', 'merge', 'notification'].includes(intended.family) ||
    intended.actionClass === 'pr-create';
  if (['failed', 'cancelled'].includes(observed.status) &&
      (observed.failure?.terminal !== true ||
        observed.failure?.providerVerified !== true)) {
    return uncertain('unverified-failure');
  }
  if (!plain(observed.result) ||
      !hostedDestinationMatches(intended, observed.result)) {
    return uncertain('wrong-or-incomplete-result');
  }
  if (!noEffect) {
    if (['failed', 'cancelled'].includes(observed.status) &&
        (!['execution', 'test', 'deployment'].includes(intended.family) ||
          observed.result.terminalStatus !== observed.status)) {
      return uncertain('partial-or-unverified-failure');
    }
    if (!requiredResult(intended, observed)) {
      return uncertain('wrong-or-incomplete-result');
    }
    if (resultIdentity(intended, observed.result) !== observed.providerResultId) {
      return uncertain('result-identity-disagrees');
    }
    if (observed.status === 'succeeded' &&
        intended.family === 'test' && observed.result.expectedMet !== true) {
      return uncertain('test-expectation-not-met');
    }
  }
  let artifactIdentity;
  if (intended.family === 'artifact' && executionIdentity && !noEffect) {
    try {
      artifactIdentity = validateArtifactResultIdentity({
        localRepositoryPath: intended.target.localRepositoryPath,
        remoteRepositoryURL: observed.result.remoteRepositoryURL,
        artifactRef: observed.result.artifactRef,
        artifactName: observed.result.artifactName,
        sourceRevision: observed.result.sourceRevision,
        configDigest: observed.result.configDigest,
        ...fields(observed.result, ['sha256', 'immutableVersion',
          'retrievalContext']),
        ...(observed.result.immutableVersion === undefined ? {} :
          { versionVerified: observed.result.versionVerified }),
        producingExecution: executionIdentity,
        attemptCapability: observed.result.attemptCapability,
      });
    } catch (error) {
      if (!['INPUT', 'EVIDENCE'].includes(error.code)) throw error;
      return uncertain('incomplete-artifact-identity');
    }
  }
  const proposedResource = {
    providerResultId: observed.providerResultId,
    intendedOutcomeDigest: intended.digest,
    ...(hostedExecution && executionIdentity ? { executionIdentity } : {}),
    ...(artifactIdentity ? { artifactIdentity } : {}),
  };
  if (priorResults.some(prior => prior.dispatchId !== dispatch.id &&
      (prior.causalKey === key ||
        immutableResultIdentity &&
          sameResultResource(prior, proposedResource)))) {
    return uncertain('result-or-request-belongs-to-another-dispatch');
  }
  return Object.freeze({ status: observed.status, dispatchId: dispatch.id,
    intendedOutcomeDigest: intended.digest, providerResultId: observed.providerResultId,
    causalKey: key, resultDigest,
    ...(artifactIdentity ? { artifactIdentity } : {}),
    ...(hostedExecution && !noEffect ? {
      executionRef: observed.result.executionRef,
      attemptCapability: observed.result.attemptCapability,
      attemptRef: observed.result.attemptRef,
      executionIdentity,
    } : {}) });
}
