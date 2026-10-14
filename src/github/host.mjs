import { canonical, requireThat, unsafeSummaryContent } from '../core.mjs';
import { Store } from '../store.mjs';
import { canonicalPath } from '../files.mjs';
import { recordOperation } from 'ai-sdlc-framework/operations';
import { isExternalAction } from '../policy.mjs';
import { githubOptions, requireGitHubConnection } from './connection.mjs';
import { requireGitHubTransport } from './transport.mjs';
import { createGitHubStoreBridge } from './store-bridge.mjs';

const hosts = new WeakSet();
const activeClaims = new Set();

function safeJson(value) {
  const serialized = canonical(value);
  requireThat(!unsafeSummaryContent(value) &&
    !/"(?:encrypted_value|ciphertext|secretValue|privateKey|rawDelivery|signedUrl)"\s*:/iu.test(serialized),
  'UNSAFE', 'GitHub host requires protected semantic data, not credentials or raw sensitive payloads');
  return JSON.parse(serialized);
}

function abortBeforeEffect(signal) {
  requireThat(signal === undefined || signal instanceof AbortSignal,
    'INPUT', 'GitHub host requires an AbortSignal');
  if (signal?.aborted) throw new DOMException('GitHub dispatch was cancelled', 'AbortError');
}

async function retainUncertainty(store, operation, error) {
  try {
    const saved = (await store.records(operation.workItemId))
      .find(record => record.type === 'operation' && record.id === operation.id);
    if (saved && !['succeeded', 'failed', 'cancelled', 'not-started'].includes(saved.status)) {
      await recordOperation(store, {
        workItemId: operation.workItemId, operationId: operation.id, status: 'uncertain',
      });
    }
  } catch (recoveryError) {
    throw new AggregateError([error, recoveryError],
      'GitHub claim failed and its uncertainty could not be recorded');
  }
  throw error;
}

/**
 * Construct a trusted host for the existing Store consumers without I/O or
 * registration. Optional connections are original {connection,transport} pairs;
 * verifier closures own acquisition and any named SDLC context sources.
 * verifiers retains the six existing repository/PR/check/result/artifact/version
 * signatures. Missing callbacks fail explicitly through the bridge.
 *
 * legacyOperations.prepare/claimDispatch/recordResult/reconcile uses the same
 * selected-home Store and durable operation, not a provider-native ledger.
 * claimDispatch requires an independent authorize(operation) === true, checks
 * cancellation, then atomically rechecks current candidate/spec/configuration
 * and user authority. A persisted claim is never automatically redispatched.
 * The caller performs its separately authorized physical effect only after the
 * claim returns, propagates its exact hostCallId, and retains uncertain outcomes.
 * Reconciliation invokes trusted readback only; it grants no write authority.
 * No general GitHub operation catalog or executable repository JSON is loaded.
 */
export function createGitHubHost(options = {}) {
  githubOptions(options, ['connections', 'clock', 'identifier', 'authorize', 'verifiers']);
  if (options.connections !== undefined) {
    requireThat(Array.isArray(options.connections) && options.connections.length > 0 &&
      options.connections.length <= 100, 'INPUT', 'GitHub host requires bounded explicit connections');
    const identities = new Set();
    for (const entry of options.connections) {
      githubOptions(entry, ['connection', 'transport'], ['connection', 'transport']);
      const connection = requireGitHubConnection(entry.connection);
      requireThat(!identities.has(connection.id), 'ADAPTER', 'Duplicate GitHub host connection');
      requireGitHubTransport(entry.transport, connection);
      identities.add(connection.id);
    }
  }
  requireThat(options.authorize === undefined || typeof options.authorize === 'function',
    'ADAPTER', 'GitHub host authorization must be supplied in process');
  const authorize = options.authorize;
  const bridge = createGitHubStoreBridge({
    verifiers: options.verifiers ?? {},
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.identifier === undefined ? {} : { identifier: options.identifier }),
  });
  const preparations = new WeakMap();
  const legacyOperations = Object.freeze({
    async prepare(input, store) {
      const preparation = await bridge.legacyOperations.prepare(safeJson(input), store);
      const hostCallIdDigest = preparation.operation.hostInvocation?.hostCallIdDigest;
      requireThat(!isExternalAction(preparation.operation.action) || hostCallIdDigest, 'EVIDENCE',
        'External GitHub preparation lacks its original protected host invocation');
      preparations.set(preparation, {
        store, workItemId: preparation.operation.workItemId, operationId: preparation.operation.id,
        hostCallIdDigest,
      });
      return preparation;
    },
    async claimDispatch(preparation, store, { signal } = {}) {
      abortBeforeEffect(signal);
      const bound = preparations.get(preparation);
      requireThat(bound?.store === store, 'EVIDENCE',
        'GitHub dispatch requires this host and its exact prepared Store');
      const home = await canonicalPath(store.home);
      const claimKey = canonical([process.platform === 'win32' ? home.toLowerCase() : home,
        bound.workItemId, bound.operationId]);
      abortBeforeEffect(signal);
      requireThat(!activeClaims.has(claimKey), 'EVIDENCE',
        'GitHub dispatch for this operation is already being claimed; do not redispatch');
      activeClaims.add(claimKey);
      try {
        const operation = (await store.records(bound.workItemId)).find(record =>
          record.type === 'operation' && record.id === bound.operationId);
        requireThat(operation && operation.dispatchBound === false &&
          operation.status === 'prepared' &&
          operation.hostInvocation?.hostCallIdDigest === bound.hostCallIdDigest, 'EVIDENCE',
        'GitHub IAM authorization requires its exact unclaimed durable operation');
        let authorized;
        try {
          authorized = typeof authorize === 'function' &&
            await authorize(structuredClone(operation)) === true;
        } catch (error) {
          abortBeforeEffect(signal);
          throw error;
        }
        requireThat(authorized, 'AUTHORITY',
        'GitHub dispatch requires independent host/IAM authorization');
        abortBeforeEffect(signal);
        try {
          return await bridge.legacyOperations.claimDispatch(preparation, store);
        } catch (error) {
          if (error.code === 'UNCERTAIN') throw error;
          const saved = (await store.records(bound.workItemId)).find(record => record.id === operation.id);
          if (saved?.dispatchBound) return retainUncertainty(store, saved, error);
          throw error;
        }
      } finally {
        activeClaims.delete(claimKey);
      }
    },
    recordResult: bridge.legacyOperations.recordResult,
    reconcile: bridge.legacyOperations.reconcile,
  });
  const host = Object.freeze({
    storeOptions: bridge.storeOptions,
    legacyOperations,
    adapterContract: bridge.adapterContract,
    missingVerifiers: bridge.missingVerifiers,
  });
  hosts.add(host);
  return host;
}

/** Preserve the actual selected home and reject reconstructed/foreign hosts. */
export function createGitHubStore(home, host) {
  requireThat(hosts.has(host), 'ADAPTER', 'GitHub Store requires a trusted constructed host');
  return new Store(home, host.storeOptions());
}
