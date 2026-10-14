import { AsyncLocalStorage } from 'node:async_hooks';
import { LIMITS, digest, id, newId, object, requireThat, safeRecord } from '../core.mjs';
import { Store } from '../store.mjs';
import {
  claimOperationDispatch, markDispatching, prepareOperation, recordOperation,
} from 'ai-sdlc-framework/operations';
import { validateOperationResult } from '../external-results.mjs';
import { sameExecutionIdentity } from '../provider-adapters.mjs';
import { isExternalAction } from '../policy.mjs';
import { synchronizeTestPlan } from '../artifacts.mjs';

const repositoryFields = [
  'canonicalLocalRepositoryPath', 'verifiedRemoteRepositoryURL', 'verifiedProvider',
  'verifiedConnection', 'verifiedRepositoryRef', 'verifiedRevision',
  'verifiedDefaultBranchRef', 'verifiedBranch', 'verifiedObservedAt', 'verifiedEvidenceRef',
];
const pullFields = [
  'canonicalLocalRepositoryPath', 'verifiedRemoteRepositoryURL', 'verifiedProvider',
  'verifiedConnection', 'verifiedRepositoryRef', 'verifiedPullRequestRef',
  'verifiedSourceRepositoryURL', 'verifiedSourceRepositoryRef', 'verifiedSourceBranchRef',
  'verifiedTargetBranchRef', 'verifiedSourceRevision', 'verifiedTargetRevision',
  'verifiedState', 'verifiedObservedAt', 'verifiedEvidenceRef',
];
const artifactFields = [
  'repositoryId', 'localRepositoryPath', 'remoteRepositoryURL', 'provider', 'connection',
  'repositoryRef', 'sourceRevision', 'configDigest', 'artifactId', 'artifactRef',
  'artifactSha256', 'artifactImmutableVersion', 'artifactRetrievalContext',
  'versionVerified', 'buildRunId', 'name', 'evidenceRef', 'attemptCapability', 'attemptRef',
  'producingExecution',
];
const verifierNames = Object.freeze([
  'verifyRepository', 'verifyPullRequest', 'verifyCheckResults',
  'verifyOperationResult', 'verifyArtifact', 'verifyProviderVersion',
]);
const contract = Object.freeze({
  adapterId: 'github-existing-consumer',
  propagatesUniqueCallId: true,
  dispatchIdField: 'dispatch.hostCallId',
  resultIdField: 'observation.causalProof.hostCallId',
});

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function snapshot(value) {
  safeRecord(value, LIMITS.input);
  return freeze(structuredClone(value));
}

function resultInput(input) {
  const { observedResult, ...fields } = input;
  return Object.freeze({
    ...snapshot(fields),
    ...(observedResult === undefined ? {} : { observedResult }),
  });
}

function same(expected, actual, message) {
  requireThat(digest(expected) === digest(actual), 'EVIDENCE', message);
}

function repositoryBinding(input, result) {
  requireThat(input.provider === 'github' && result.verifiedProvider === 'github' &&
    result.canonicalLocalRepositoryPath === input.localRepositoryPath &&
    result.verifiedRemoteRepositoryURL === input.remoteRepositoryURL,
  'EVIDENCE', 'GitHub verification differs from the exact selected checkout and URL');
}

function operationIdentity(operation) {
  return digest({
    id: operation.id, workItemId: operation.workItemId, sessionId: operation.sessionId,
    repositoryId: operation.repositoryId, action: operation.action,
    requestFingerprint: operation.requestFingerprint, intendedOutcome: operation.intendedOutcome ?? null,
    candidateDigest: operation.candidateDigest, candidateStamp: operation.candidateStamp,
    cycleId: operation.cycleId, bindingKey: operation.bindingKey,
    hostInvocation: operation.hostInvocation ?? null,
  });
}

function publicationTarget(recipient) {
  requireThat(typeof recipient === 'string' &&
    /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+\/(?:issues|pull|discussions)\/[1-9][0-9]*$/u.test(recipient),
  'PROOF_GAP', 'Notification bridge proves publication to an exact GitHub target, not personal receipt');
}

/**
 * Trusted application construction, never repository/CLI JSON. Each optional
 * verifier has EXACTLY the existing Store signature (Technical Design section 4).
 * It must acquire/domain-verify facts privately, or resolve a privately retained
 * acquisition handle; returning supplied self-attested JSON is not lawful wiring.
 * Missing callbacks throw ADAPTER, never admit a default observation.
 *
 * Return: {storeOptions(), legacyOperations, adapterContract, missingVerifiers}.
 * new Store(selectedHome, bridge.storeOptions()) preserves the caller's home.
 * The trusted host uses these same callbacks; this module never installs a
 * second durable ledger or loads executable definitions from repository JSON.
 *
 * legacyOperations.prepare(input,store) takes existing prepareOperation input and
 * returns an immutable preparation. claimDispatch(preparation,store) uses the
 * public claimOperationDispatch transaction for exact invocation, current
 * candidate/spec/config/authority and host-call checks plus the EXISTING
 * operation's dispatchBound claim. Configure the exact tool adapter in the host.
 * A pre-write interruption leaves the preparation unclaimed and resumable; a
 * persisted claim is never redispatched, even if its response was lost.
 * Only after the claim resolves may the host perform its external call,
 * propagating returned hostCallId. Local-only operations retain markDispatching
 * without a hosted claim or execution identity.
 * Test/environment claims synchronize the existing Test Plan projection after
 * the atomic claim; a projection failure does not release redispatch authority.
 * recordResult(preparation,input,store) takes existing recordOperation input;
 * an exact trusted affirmative not-started proof needs no dispatch claim.
 * observedResult is an opaque host-defined handle, including scalars; its
 * original identity reaches the trusted verifier without cloning or coercion.
 * Verified results are pinned in a bridge-private async operation context,
 * never keyed by or stored into the caller's handle.
 * reconcile(input,store) is result-only readback, not a mutation retry.
 * The host owns IAM, cancellation, acquisition, version checks, and uncertain
 * transport reporting. No external call is made by this routing protocol.
 *
 * Notification recipient is a GitHub publication target, NOT a person; the
 * existing deliveryReceipt is the exact publication response identity.
 * verifyProviderVersion retains the existing boolean OUTPUT contract, but only
 * the injected verifier can establish it from exact locator/context/version/bytes.
 */
export function createGitHubStoreBridge(options = {}) {
  object(options, ['verifiers', 'clock', 'identifier']);
  const verifiers = { ...object(options.verifiers ?? {}, verifierNames) };
  for (const callback of Object.values(verifiers)) requireThat(typeof callback === 'function',
    'ADAPTER', 'GitHub Store bridge requires trusted in-process verifier functions');
  const identifier = options.identifier ?? (() => newId('github-legacy-call'));
  requireThat(typeof identifier === 'function', 'ADAPTER', 'GitHub bridge requires a trusted identifier');
  if (options.clock !== undefined) requireThat(typeof options.clock.now === 'function',
    'ADAPTER', 'GitHub bridge requires a trusted clock');
  const preparations = new WeakMap();
  const pinnedResults = new AsyncLocalStorage();

  async function invoke(name, input) {
    requireThat(typeof verifiers[name] === 'function', 'ADAPTER',
      `GitHub existing consumer requires trusted ${name} acquisition`);
    return verifiers[name](snapshot(Object.fromEntries(Object.entries(input)
      .filter(([, value]) => value !== undefined))));
  }

  const callbacks = {
    async verifyRepository(input) {
      object(input, ['provider', 'adapterObservation', 'localRepositoryPath', 'remoteRepositoryURL'],
        ['provider', 'localRepositoryPath', 'remoteRepositoryURL']);
      const result = snapshot(await invoke('verifyRepository', input));
      object(result, repositoryFields, repositoryFields.filter(field =>
        !['verifiedDefaultBranchRef', 'verifiedBranch'].includes(field)));
      repositoryBinding(input, result);
      return result;
    },
    async verifyPullRequest(input) {
      object(input, ['provider', 'adapterObservation', 'localRepositoryPath', 'remoteRepositoryURL'],
        ['provider', 'localRepositoryPath', 'remoteRepositoryURL']);
      const result = snapshot(await invoke('verifyPullRequest', input));
      object(result, pullFields, pullFields.filter(field =>
        !['verifiedSourceRepositoryURL', 'verifiedSourceRepositoryRef'].includes(field)));
      repositoryBinding(input, result);
      return result;
    },
    async verifyCheckResults(input) {
      object(input, ['identity', 'status', 'evidenceReference', 'adapterObservation'],
        ['identity', 'status', 'evidenceReference']);
      requireThat(input.identity.provider === 'github', 'EVIDENCE', 'GitHub check requires GitHub execution');
      const result = snapshot(await invoke('verifyCheckResults', input));
      object(result, ['identity', 'status', 'evidenceReference', 'checkResults'],
        ['identity', 'status', 'evidenceReference', 'checkResults']);
      requireThat(sameExecutionIdentity(input.identity, result.identity) &&
        input.status === result.status, 'EVIDENCE', 'GitHub check differs from its exact execution/status');
      same(input.evidenceReference, result.evidenceReference,
        'GitHub check differs from its immutable evidence reference');
      return result;
    },
    async verifyOperationResult(input) {
      object(input, ['operation', 'observedResult'], ['operation', 'observedResult']);
      const operation = input.operation;
      requireThat(operation.intendedOutcome, 'ADAPTER',
        'GitHub result verification requires the existing intended outcome contract');
      const pinned = pinnedResults.getStore();
      if (pinned) requireThat(pinned.identity === operationIdentity(operation) &&
        Object.is(pinned.observedResult, input.observedResult), 'STALE',
      'Result verification belongs to another durable operation or exact acquisition handle');
      requireThat(typeof verifiers.verifyOperationResult === 'function', 'ADAPTER',
        'GitHub existing consumer requires trusted verifyOperationResult acquisition');
      const result = pinned ? pinned.result : snapshot(await verifiers.verifyOperationResult(Object.freeze({
        operation: snapshot(operation), observedResult: input.observedResult,
      })));
      object(result, ['dispatch', 'observation', 'executionContext'], ['dispatch', 'observation']);
      object(result.dispatch, ['id', 'hostCallId', 'hostCallSupported',
        'providerRequestId', 'providerRequestSupported', 'providerIdempotencyToken'], ['id']);
      if (result.executionContext !== undefined) object(result.executionContext,
        ['provider', 'connection', 'scopeRef', 'definitionRef', 'attemptCapability']);
      requireThat(result.dispatch.id === operation.id, 'EVIDENCE', 'GitHub result identifies another operation');
      const nonDispatch = result.observation.status === 'not-started';
      requireThat(nonDispatch ? operation.dispatchBound === false &&
        ['prepared', 'not-started'].includes(operation.status) : operation.dispatchBound === true,
      'EVIDENCE', 'GitHub result requires its actual dispatch or affirmative non-dispatch boundary');
      if (nonDispatch || result.observation.causalProof?.kind === 'host-call') requireThat(
        operation.hostInvocation?.hostAdapterId === contract.adapterId &&
        result.dispatch.hostCallSupported === true &&
        typeof result.dispatch.hostCallId === 'string' &&
        digest(result.dispatch.hostCallId) === operation.hostInvocation.hostCallIdDigest,
      'EVIDENCE', 'GitHub result has no exact existing host-call claim');
      const intended = operation.intendedOutcome;
      if (operation.class === 'local-build' ||
          operation.class === 'test' && operation.action.environment === 'local') {
        requireThat(result.executionContext === undefined &&
          result.observation.result?.executionIdentity === undefined,
        'EVIDENCE', 'Local execution cannot borrow a hosted GitHub identity');
      } else requireThat(intended.target.provider === 'github', 'EVIDENCE',
        'GitHub result cannot replace another provider');
      if (intended.family === 'notification') publicationTarget(intended.requested.recipient);
      const checked = validateOperationResult(intended,
        { ...result.dispatch, status: operation.status }, result.observation, {
          executionContext: result.executionContext,
          requireArtifactExecutionIdentity: true,
          previousTerminal: operation.resultProof ?? null,
        });
      const pending = ['submitted', 'running', 'uncertain'].includes(result.observation.status) &&
        checked.reason === 'incomplete-result';
      if (pending) {
        const proof = result.observation.causalProof;
        requireThat(proof?.supported === true && proof.dispatchId === operation.id &&
          typeof result.observation.providerResultId === 'string' &&
          proof.resultId === result.observation.providerResultId &&
          (proof.kind === 'host-call' && proof.hostCallId === result.dispatch.hostCallId &&
            result.dispatch.hostCallSupported === true ||
          proof.kind === 'provider-request' && proof.providerRequestId === result.dispatch.providerRequestId &&
            result.dispatch.providerRequestSupported === true && proof.accepted === true ||
          proof.kind === 'provider-idempotency' &&
            proof.providerIdempotencyToken === result.dispatch.providerIdempotencyToken &&
            result.dispatch.providerRequestSupported === true && proof.accepted === true),
        'EVIDENCE', 'Pending GitHub observation lacks an exact dispatched request/result association');
      }
      requireThat(checked.status !== 'uncertain' || pending, 'EVIDENCE',
        `GitHub result proof rejected: ${checked.reason}`);
      return result;
    },
    async verifyArtifact(input) {
      object(input, ['operation', 'observation'], ['operation', 'observation']);
      const producer = input.operation;
      requireThat(producer.resultProof?.status === 'succeeded' &&
        producer.resultProof.executionIdentity?.provider === 'github',
      'EVIDENCE', 'GitHub artifact requires a proven existing producing execution');
      const result = snapshot(await invoke('verifyArtifact', input));
      object(result, artifactFields, artifactFields.filter(field =>
        !['artifactSha256', 'artifactImmutableVersion', 'artifactRetrievalContext',
          'versionVerified'].includes(field)));
      requireThat(result.provider === 'github' &&
        result.connection === producer.resultProof.executionIdentity.connection &&
        result.repositoryRef === producer.resultProof.executionIdentity.scopeRef &&
        result.repositoryId === producer.repositoryId &&
        result.localRepositoryPath === producer.intendedOutcome.target.localRepositoryPath &&
        result.remoteRepositoryURL === producer.intendedOutcome.target.remoteRepositoryURL &&
        result.sourceRevision === producer.intendedOutcome.requested.sourceRevision &&
        result.configDigest === producer.intendedOutcome.requested.configDigest &&
        result.buildRunId === producer.resultProof.providerResultId &&
        sameExecutionIdentity(result.producingExecution, producer.resultProof.executionIdentity) &&
        result.attemptCapability === producer.resultProof.attemptCapability &&
        result.attemptRef === producer.resultProof.attemptRef,
      'EVIDENCE', 'GitHub artifact differs from the exact proven producer/source/configuration');
      return result;
    },
    async verifyProviderVersion(input) {
      object(input, ['locator', 'retrievalContext', 'immutableVersion', 'bytes'],
        ['locator', 'retrievalContext', 'immutableVersion', 'bytes']);
      requireThat(typeof verifiers.verifyProviderVersion === 'function', 'ADAPTER',
        'GitHub provider version requires trusted immutable-byte verification');
      requireThat(Buffer.isBuffer(input.bytes), 'INPUT', 'Provider version requires actual bounded file bytes');
      const result = await verifiers.verifyProviderVersion({
        ...snapshot({ locator: input.locator, retrievalContext: input.retrievalContext,
          immutableVersion: input.immutableVersion }), bytes: Buffer.from(input.bytes),
      });
      requireThat(typeof result === 'boolean', 'ADAPTER', 'Existing provider version verifier must return boolean');
      return result;
    },
  };

  function requireStore(store) {
    requireThat(store instanceof Store && store.verifyOperationResult === callbacks.verifyOperationResult,
      'ADAPTER', 'GitHub legacy routing requires the exact shared Store bridge callbacks');
  }

  async function boundOperation(preparation, store) {
    requireStore(store);
    const binding = preparations.get(preparation);
    requireThat(binding?.store === store, 'EVIDENCE', 'GitHub preparation belongs to another bridge/Store');
    const operation = (await store.records(binding.workItemId)).find(record => record.id === binding.operationId);
    requireThat(operation && operationIdentity(operation) === binding.identity,
      'STALE', 'GitHub preparation differs from the existing durable operation');
    return { binding, operation };
  }

  async function recordVerified(operation, input, store, reconcile = false) {
    if (input.observedResult === undefined) return recordOperation(store, input, { reconcile });
    const verified = await callbacks.verifyOperationResult({ operation, observedResult: input.observedResult });
    for (const [field, expected] of [
      ['status', verified.observation.status], ['handle', verified.observation.providerResultId],
      ['evidenceRef', verified.observation.evidence.ref], ['providerStatus', verified.observation.providerStatus],
    ]) if (input[field] !== undefined) requireThat(input[field] === expected,
      'EVIDENCE', `Caller ${field} differs from the exact acquired result`);
    return pinnedResults.run(Object.freeze({
      identity: operationIdentity(operation), observedResult: input.observedResult, result: verified,
    }), () => recordOperation(store, input, { reconcile }));
  }

  const legacyOperations = Object.freeze({
    async prepare(input, store) {
      requireStore(store);
      input = snapshot(input);
      const hostCallId = isExternalAction(input.action) ? id(identifier(), 'GitHub legacy host call') : null;
      const result = await prepareOperation(store, snapshot(input),
        hostCallId === null ? {} : { adapterContract: contract, hostCallId });
      requireThat(result.operation.status === 'prepared' && !result.operation.dispatchBound,
        'UNCERTAIN', 'Existing GitHub effect must be reconciled, never blindly dispatched again');
      requireThat(hostCallId === null ||
        result.operation.hostInvocation?.hostCallIdDigest === digest(hostCallId),
      'UNCERTAIN', 'Existing preparation requires its retained host call, not a replacement call ID');
      const preparation = snapshot(result);
      preparations.set(preparation, {
        store, workItemId: input.workItemId, operationId: result.operation.id,
        hostCallId, identity: operationIdentity(result.operation),
        request: input.request, sessionId: input.sessionId,
      });
      return preparation;
    },
    async claimDispatch(preparation, store) {
      const { binding, operation } = await boundOperation(preparation, store);
      requireThat(operation.status === 'prepared' && operation.dispatchBound === false,
        'UNCERTAIN', 'GitHub operation is claimed or uncertain; use shared reconciliation rather than redispatch');
      if (!isExternalAction(operation.action)) {
        const local = await markDispatching(store, binding.workItemId, operation.id);
        return snapshot({ operation: local, hostCallId: null, adapterContract: contract });
      }
      const claimed = await claimOperationDispatch(store, {
        workItemId: binding.workItemId, operationId: operation.id,
        invocation: { ...binding.request, sessionId: binding.sessionId },
        adapterContract: contract, hostCallId: binding.hostCallId,
      });
      requireThat(claimed.status === 'dispatching' && claimed.dispatchBound === true &&
        operationIdentity(claimed) === binding.identity,
      'EVIDENCE', 'GitHub atomic claim differs from the exact prepared operation');
      if (claimed.class === 'test' || claimed.environmentBoundaryApplied === true) {
        await synchronizeTestPlan(store, binding.workItemId);
      }
      return snapshot({ operation: claimed, hostCallId: binding.hostCallId, adapterContract: contract });
    },
    async recordResult(preparation, input, store) {
      const { binding, operation } = await boundOperation(preparation, store);
      input = resultInput(input);
      requireThat(input.workItemId === binding.workItemId && input.operationId === operation.id &&
        (operation.dispatchBound === true ||
          !isExternalAction(operation.action) && operation.status === 'dispatching' ||
          input.status === 'not-started' &&
          operation.dispatchBound === false && input.observedResult !== undefined),
      'EVIDENCE', 'GitHub result requires the exact dispatch or trusted affirmative non-dispatch proof');
      return recordVerified(operation, input, store);
    },
    async reconcile(input, store) {
      requireStore(store);
      input = resultInput(input);
      const operation = (await store.records(input.workItemId)).find(record => record.id === input.operationId);
      requireThat(operation?.type === 'operation', 'OPERATION', 'GitHub reconciliation needs its existing operation');
      return recordVerified(operation, input, store, true);
    },
  });

  return Object.freeze({
    storeOptions: () => ({ ...(options.clock === undefined ? {} : { clock: options.clock }), ...callbacks }),
    adapterContract: contract,
    legacyOperations,
    missingVerifiers: Object.freeze(verifierNames.filter(name => verifiers[name] === undefined)),
  });
}
