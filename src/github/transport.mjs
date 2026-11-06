import { randomUUID } from 'node:crypto';
import { canonical, choice, digest, requireThat as coreRequireThat, SdlcError } from '../core.mjs';
import {
  githubOptions, githubSafeName, githubUrl, requireGitHubConnection,
  resolveGitHubCredential, selectGitHubProfile, selectGitHubScope,
  validateGitHubCredentialContract,
} from './connection.mjs';

const methods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];
const selectedHeaders = [
  'content-type', 'content-length', 'etag', 'last-modified', 'link',
  'x-github-request-id', 'x-ratelimit-limit', 'x-ratelimit-remaining',
  'x-ratelimit-used', 'x-ratelimit-reset', 'x-ratelimit-resource',
  'retry-after', 'x-poll-interval',
];
const redirects = new Set([301, 302, 303, 307, 308]);
const mediaTypePattern = /^application\/[A-Za-z0-9!#$&^_.+-]+(?:;\s*[A-Za-z0-9_-]+=[A-Za-z0-9_.+-]+)*$/u;
const transportErrors = new WeakSet();
const transportConnections = new WeakMap();
const transportPageLimits = new WeakMap();
const acquiredCaptures = new WeakMap();
const captureRequests = new WeakMap();

export function requireGitHubTransport(transport, connection) {
  requireThat(transportConnections.get(transport) === connection, 'ADAPTER',
    'GitHub transport must belong to the exact trusted connection');
  return transport;
}

/** Read the immutable constructor-bound SDK page cap; performs no acquisition. */
export function getGitHubTransportPageLimit(transport, connection) {
  requireGitHubConnection(connection);
  requireGitHubTransport(transport, connection);
  return transportPageLimits.get(transport);
}

export function requireGitHubCapture(capture, connection) {
  const origin = acquiredCaptures.get(capture);
  requireThat(origin !== undefined && (connection === undefined || origin === connection),
    'EVIDENCE', 'GitHub response must be an actual acquisition from the selected transport connection');
  return capture;
}

export function requireGitHubRequestBinding(capture, expected) {
  requireGitHubCapture(capture);
  const actual = captureRequests.get(capture);
  requireThat(actual !== undefined, 'EVIDENCE', 'GitHub capture has no private request binding');
  const identity = capture.requestIdentity;
  for (const field of ['method', 'path', 'profile', 'schemaProfile', 'documentId',
    'operationName', 'operationKind', 'proofScope', 'mediaType']) {
    if (expected[field] !== undefined) requireThat(identity[field] === expected[field],
      'EVIDENCE', 'GitHub capture request differs from the declared operation');
  }
  if (identity.protocol === 'graphql') {
    const document = typeof expected.document === 'function' ? expected.document() : expected.document;
    requireThat(typeof document === 'string' && actual.document === document,
      'EVIDENCE', 'GitHub GraphQL document differs from the actual acquired request');
    requireThat(expected.variables !== undefined &&
      canonical(actual.variables) === canonical(expected.variables), 'EVIDENCE',
    'GitHub GraphQL variables differ from the actual acquired request');
  } else {
    const payload = expected.payload === undefined ? undefined : canonical(expected.payload);
    requireThat(actual.payload === payload, 'EVIDENCE',
      'GitHub payload differs from the actual dispatched request');
  }
  return capture;
}

function transportError(code, message, details) {
  const error = new SdlcError(code, message, details);
  transportErrors.add(error);
  return error;
}

function requireThat(...args) {
  try { coreRequireThat(...args); }
  catch (error) {
    transportErrors.add(error);
    throw error;
  }
}

function positiveBound(value, label, maximum) {
  requireThat(Number.isSafeInteger(value) && value > 0 && value <= maximum,
    'INPUT', `Invalid GitHub ${label}`);
  return value;
}

function freezeBody(value) {
  const pending = [value];
  while (pending.length > 0) {
    const item = pending.pop();
    if (item && typeof item === 'object') {
      for (const child of Object.values(item)) pending.push(child);
      Object.freeze(item);
    }
  }
  return value;
}

function safeHeader(value, token) {
  requireThat(typeof value === 'string' && value.length <= 8192 &&
    !/[\u0000-\u001f\u007f]/u.test(value), 'CONTRACT', 'Invalid GitHub response header');
  if ((token && value.includes(token)) ||
    /(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]+|(?:token|access[_-]?token|api[_-]?key|password|secret|authorization|credential|signature|sig|prompt)\s*[:=]/iu.test(value)) {
    return '[redacted]';
  }
  return value;
}

function captureHeaders(response, token) {
  requireThat(response?.headers && typeof response.headers.get === 'function',
    'CONTRACT', 'GitHub response must expose fetch-compatible headers');
  const headers = {};
  for (const name of selectedHeaders) {
    const value = response.headers.get(name);
    if (value !== null && value !== undefined) headers[name] = safeHeader(value, token);
  }
  return Object.freeze(headers);
}

function jsonPayload(value, maximum) {
  let serialized;
  try { serialized = canonical(value); }
  catch { requireThat(false, 'INPUT', 'GitHub payload must be finite plain JSON data'); }
  requireThat(Buffer.byteLength(serialized) <= maximum, 'INPUT', 'GitHub request payload exceeds byte limit');
  return serialized;
}

function expectedStatuses(value) {
  requireThat(Array.isArray(value) && value.length > 0 && value.length <= 20 &&
    value.every(status => Number.isInteger(status) && status >= 200 && status < 300) &&
    new Set(value).size === value.length, 'INPUT',
  'GitHub expected statuses must declare specific successful HTTP statuses');
  return Object.freeze([...value]);
}

function authorityIndication(value) {
  githubOptions(value, ['operationId', 'authorityRef', 'dispatchClaimId'],
    ['operationId', 'authorityRef', 'dispatchClaimId']);
  for (const key of ['operationId', 'authorityRef', 'dispatchClaimId']) {
    githubSafeName(value[key], 'GitHub outer action authority reference');
  }
  return Object.freeze({ ...value });
}

function assertRouteScope(url, scope, prefix) {
  const path = url.pathname.slice(prefix.length);
  const parts = path.split('/').map(part => decodeURIComponent(part));
  if (parts[1] === 'repos') {
    requireThat(scope.kind === 'repository' && parts[2] === scope.owner &&
      parts[3] === scope.name, 'SCOPE', 'GitHub repository route differs from proof scope');
  } else if (parts[1] === 'repositories' && /^[0-9]+$/u.test(parts[2] ?? '')) {
    requireThat(scope.kind === 'repository' && parts[2] === scope.id,
      'SCOPE', 'GitHub repository ID route differs from proof scope');
  } else if (parts[1] === 'orgs') {
    requireThat(scope.kind === 'organization' && parts[2] === scope.login,
      'SCOPE', 'GitHub organization route differs from proof scope');
  } else if (parts[1] === 'users') {
    requireThat(scope.kind === 'user' && parts[2] === scope.login,
      'SCOPE', 'GitHub user route differs from proof scope');
  } else if (parts[1] === 'user') {
    requireThat(scope.kind === 'user', 'SCOPE', 'GitHub current-user route requires user scope');
  }
}

function staticDocument(value, operationName, operationKind) {
  requireThat(typeof value === 'string' ||
    (typeof value === 'function' && value.constructor.name !== 'AsyncFunction'),
  'INPUT', 'GitHub compiled document must be a synchronous trusted function or string');
  let document;
  try { document = typeof value === 'function' ? value() : value; }
  catch { requireThat(false, 'CONTRACT', 'GitHub compiled document acquisition failed'); }
  requireThat(typeof document === 'string' && document.length > 0 &&
    document.length <= 256 * 1024, 'INPUT', 'Expected a static GitHub GraphQL document');
  const stripped = document.replace(/"""[\s\S]*?"""|"(?:\\.|[^"\\])*"|#[^\r\n]*/gu, ' ');
  const tokens = stripped.match(/[A-Za-z_][A-Za-z0-9_]*|[{}()]/gu) ?? [];
  let depth = 0;
  let parentheses = 0;
  const definitions = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (depth === 0 && parentheses === 0 && ['query', 'mutation', 'subscription'].includes(token)) {
      definitions.push([token, tokens[index + 1]]);
    }
    if (token === '{') depth++;
    if (token === '}') depth--;
    if (token === '(') parentheses++;
    if (token === ')') parentheses--;
    requireThat(depth >= 0 && parentheses >= 0, 'INPUT', 'Malformed GitHub GraphQL document');
  }
  requireThat(depth === 0 && parentheses === 0 && definitions.length === 1 &&
    definitions[0][0] === operationKind && definitions[0][1] === operationName &&
    new RegExp(`^\\s*${operationKind}\\s+${operationName}\\b`, 'u').test(stripped),
  'CONTRACT', 'GraphQL document must contain exactly its declared named operation');
  return document;
}

function nextRestUrl(link, current, connection, pageParameter) {
  if (link === undefined) return undefined;
  requireThat(link !== '[redacted]', 'PROOF_GAP', 'GitHub pagination header cannot be safely retained');
  const pattern = /\s*<([^<>]+)>((?:;\s*[A-Za-z][A-Za-z0-9_-]*=(?:"[^"]*"|[^;,\s]+))*)\s*(?:,|$)/gyu;
  let position = 0;
  let next;
  const currentUrl = new URL(current);
  const filters = url => [...url.searchParams].filter(([key]) => key !== pageParameter)
    .map(pair => canonical(pair)).sort();
  const baseline = canonical(filters(currentUrl));
  while (position < link.length) {
    pattern.lastIndex = position;
    const match = pattern.exec(link);
    requireThat(match && pattern.lastIndex > position, 'CONTRACT', 'Malformed GitHub pagination Link header');
    position = pattern.lastIndex;
    const url = githubUrl(match[1], {
      origin: connection.apiOrigin, prefix: connection.apiPathPrefix || '/',
    });
    requireThat(url.pathname === currentUrl.pathname &&
      canonical(filters(url)) === baseline &&
      url.searchParams.getAll(pageParameter).length <= 1,
    'PROOF_GAP', 'GitHub pagination changed the resource or filters');
    const relations = [...match[2].matchAll(/;\s*rel=(?:"([^"]*)"|([^;,\s]+))/gu)];
    requireThat(relations.length === 1, 'CONTRACT', 'GitHub pagination requires one relation per link');
    if ((relations[0][1] ?? relations[0][2]).split(/\s+/u).includes('next')) {
      requireThat(next === undefined, 'CONTRACT', 'Duplicate GitHub next-page link');
      next = url.href;
    }
  }
  return next;
}

/**
 * Required options: {connection, fetch} or {connection, request}, never both.
 * fetch(url,init) / request({url,method,headers,body,redirect,signal}) returns a
 * fetch-like Response with a bounded readable body; redirect MUST stay manual.
 * Optional: maxResponseBytes (default 1 MiB), maxRequestBytes (1 MiB),
 * maxPages (100), maxRedirects (5), timeoutMs (no implicit deadline).
 *
 * buildRestRequest({method,path,profile,mediaType,expectedStatuses,proofScope,
 *   tokenClasses,permissions?,payload?,payloadSlot?,responseType?})
 * buildGraphQLRequest({documentId,document,operationName,operationKind,variables,
 *   schemaProfile,proofScope,tokenClasses,permissions?,validateData,payloadSlot?})
 * Documents and typed-data validators are trusted domain functions, not repo JSON.
 * Prepared handles contain only safe semantic identity; payloads stay private.
 *
 * execute(request,{signal?,timeoutMs?,actionAuthority?,cacheEntry?}) captures
 * facts, NOT normalized domain outcomes, action approval or passing proof.
 * Writes need the outer {operationId,authorityRef,dispatchClaimId} indication;
 * only the host/Store can verify/consume that authority. Never retry writes.
 * body and archive bodyStream are non-enumerable acquisition-only values; callers
 * must protect/normalize them before persistence. Errors never include raw bodies.
 * createCacheEntry(capture,{observationVersion}) retains exact-context ETag facts
 * in this transport, not a serializable cache or invented observation timestamp.
 * invalidateCache({proofScope?}) is a local host invalidation hook. Dispatching
 * any write also conservatively invalidates the connection's mutable cache.
 * Pagination completion describes acquisition only, never domain completeness.
 */
export function createGitHubTransport(options) {
  githubOptions(options, ['connection', 'fetch', 'request', 'maxResponseBytes',
    'maxRequestBytes', 'maxPages', 'maxRedirects', 'timeoutMs'], ['connection']);
  const connection = requireGitHubConnection(options.connection);
  requireThat((typeof options.fetch === 'function' && options.request === undefined) ||
    (typeof options.request === 'function' && options.fetch === undefined),
  'INPUT', 'GitHub transport requires exactly one injected request function');
  const maximum = positiveBound(options.maxResponseBytes ?? 1024 * 1024, 'response byte limit', 256 * 1024 * 1024);
  const requestMaximum = positiveBound(options.maxRequestBytes ?? 1024 * 1024, 'request byte limit', 16 * 1024 * 1024);
  const pageMaximum = positiveBound(options.maxPages ?? 100, 'page limit', 10000);
  const redirectMaximum = positiveBound(options.maxRedirects ?? 5, 'redirect limit', 20);
  if (options.timeoutMs !== undefined) positiveBound(options.timeoutMs, 'timeout', 2147483647);
  const prepared = new WeakMap();
  const captures = new WeakMap();
  const caches = new WeakMap();
  let cacheEpoch = 0;
  const scopeEpochs = new Map();
  const injectedFetch = options.fetch;
  const injectedRequest = options.request;
  const defaultTimeout = options.timeoutMs;
  const call = injectedFetch ?
    (url, init) => injectedFetch(url, init) :
    (url, init) => injectedRequest({ url, ...init });

  function prepare(identity, internal) {
    const request = Object.freeze({ requestIdentity: Object.freeze(identity) });
    prepared.set(request, internal);
    return request;
  }

  function commonRequest(input, profileId, kind) {
    const profile = selectGitHubProfile(connection, profileId, kind);
    const scope = selectGitHubScope(connection, input.proofScope);
    const credentialContract = validateGitHubCredentialContract({
      tokenClasses: input.tokenClasses, permissions: input.permissions,
    });
    return { profile, scope, credentialContract };
  }

  function buildRestRequest(input) {
    githubOptions(input, ['method', 'path', 'profile', 'mediaType', 'payload',
      'payloadSlot', 'expectedStatuses', 'proofScope', 'tokenClasses',
      'permissions', 'responseType', 'responseTypes'],
    ['method', 'path', 'profile', 'mediaType', 'expectedStatuses', 'proofScope', 'tokenClasses']);
    choice(input.method, methods, 'GitHub HTTP method');
    const { profile, scope, credentialContract } = commonRequest(input, input.profile, 'rest');
    requireThat(typeof input.path === 'string' && input.path.startsWith('/') &&
      !input.path.startsWith('//'), 'INPUT', 'GitHub REST path must be relative to the API origin');
    const url = githubUrl(`${connection.apiOrigin}${connection.apiPathPrefix}${input.path}`, {
      origin: connection.apiOrigin, prefix: connection.apiPathPrefix || '/',
    });
    assertRouteScope(url, scope, connection.apiPathPrefix);
    requireThat(typeof input.mediaType === 'string' && mediaTypePattern.test(input.mediaType),
      'INPUT', 'Invalid GitHub request media type');
    const responseType = input.responseType ?? 'json';
    choice(responseType, ['json', 'empty', 'text', 'bytes'], 'GitHub response type');
    const writes = !['GET', 'HEAD'].includes(input.method);
    requireThat(writes || input.payload === undefined, 'INPUT', 'GitHub read requests cannot carry a payload');
    requireThat(input.payload !== undefined || input.payloadSlot === undefined,
      'INPUT', 'A GitHub payload slot requires a payload');
    const payload = input.payload === undefined ? undefined : jsonPayload(input.payload, requestMaximum);
    const payloadSlot = payload === undefined ? undefined :
      githubSafeName(input.payloadSlot ?? randomUUID(), 'GitHub protected payload slot');
    const statuses = expectedStatuses(input.expectedStatuses);
    let responseTypes;
    if (input.responseTypes !== undefined) {
      githubOptions(input.responseTypes, statuses.map(String), statuses.map(String));
      for (const type of Object.values(input.responseTypes)) {
        choice(type, ['json', 'empty', 'text', 'bytes'], 'GitHub status response type');
      }
      responseTypes = Object.freeze({ ...input.responseTypes });
    }
    return prepare({
      protocol: 'rest', connectionId: connection.id, apiOrigin: connection.apiOrigin,
      method: input.method, path: input.path, profile: profile.id,
      apiVersion: profile.apiVersion, mediaType: input.mediaType,
      proofScope: scope.scopeRef, responseType, expectedStatuses: statuses,
      ...credentialContract, ...(payloadSlot === undefined ? {} : { payloadSlot }),
      ...(responseTypes === undefined ? {} : { responseTypes }),
    }, { url: url.href, payload, profile, writes, responseType, responseTypes, statuses, credentialContract });
  }

  function buildGraphQLRequest(input) {
    githubOptions(input, ['documentId', 'document', 'operationName', 'operationKind',
      'variables', 'schemaProfile', 'proofScope', 'tokenClasses', 'permissions',
      'validateData', 'payloadSlot'],
    ['documentId', 'document', 'operationName', 'operationKind', 'variables',
      'schemaProfile', 'proofScope', 'tokenClasses', 'validateData']);
    githubSafeName(input.documentId, 'GitHub document ID');
    requireThat(typeof input.operationName === 'string' &&
      /^[A-Za-z_][A-Za-z0-9_]*$/u.test(input.operationName), 'INPUT', 'Invalid GitHub operation name');
    choice(input.operationKind, ['query', 'mutation'], 'GitHub GraphQL operation kind');
    requireThat(typeof input.validateData === 'function' &&
      input.validateData.constructor.name !== 'AsyncFunction',
    'INPUT', 'GraphQL requires a synchronous typed-data validator');
    githubOptions(input.variables, Object.keys(input.variables ?? {}));
    const { profile, scope, credentialContract } = commonRequest(input, input.schemaProfile, 'graphql');
    requireThat(connection.graphqlPath !== undefined, 'CONTRACT', 'GitHub GraphQL endpoint must be explicit');
    const document = staticDocument(input.document, input.operationName, input.operationKind);
    const variables = JSON.parse(jsonPayload(input.variables, requestMaximum));
    const payload = jsonPayload({ query: document, operationName: input.operationName, variables }, requestMaximum);
    const payloadSlot = githubSafeName(input.payloadSlot ?? randomUUID(), 'GitHub protected variable slot');
    return prepare({
      protocol: 'graphql', connectionId: connection.id, apiOrigin: connection.apiOrigin,
      method: 'POST', path: connection.graphqlPath, schemaProfile: profile.id,
      schemaVersion: profile.schemaVersion, documentId: input.documentId,
      operationName: input.operationName, operationKind: input.operationKind,
      proofScope: scope.scopeRef, mediaType: 'application/json', payloadSlot,
      ...credentialContract,
    }, {
      url: `${connection.apiOrigin}${connection.graphqlPath}`, profile,
      writes: input.operationKind === 'mutation', responseType: 'json',
      statuses: [200], payload, document, variables,
      validateData: input.validateData, credentialContract,
    });
  }

  function executionOptions(input = {}) {
    githubOptions(input, ['signal', 'timeoutMs', 'actionAuthority', 'cacheEntry', 'authorizationSource']);
    requireThat(input.signal === undefined || input.signal instanceof AbortSignal,
      'INPUT', 'GitHub cancellation requires an AbortSignal');
    if (input.timeoutMs !== undefined) positiveBound(input.timeoutMs, 'timeout', 2147483647);
    return {
      signal: input.signal, timeoutMs: input.timeoutMs, cacheEntry: input.cacheEntry,
      authorizationSource: input.authorizationSource,
      ...(input.actionAuthority === undefined ? {} :
        { actionAuthority: authorityIndication(input.actionAuthority) }),
    };
  }

  function authorizationContext(binding) {
    const { requestKey, ...context } = binding;
    return canonical(context);
  }

  async function run(request, input, archive = false, paginationContext) {
    const internal = prepared.get(request);
    requireThat(internal !== undefined, 'INPUT', 'Expected a request built by this GitHub transport');
    const runtime = executionOptions(input);
    if (internal.writes) {
      requireThat(runtime.actionAuthority !== undefined, 'AUTHORITY',
        'GitHub write requires an outer authorized dispatch indication');
    }
    if (archive) {
      requireThat(request.requestIdentity.protocol === 'rest' &&
        request.requestIdentity.method === 'GET' && internal.responseType === 'bytes',
      'INPUT', 'GitHub archive acquisition requires a separate GET byte contract');
    }
    const controller = new AbortController();
    let dispatched = false;
    let timedOut = false;
    let timer;
    const abort = () => controller.abort();
    const signal = controller.signal;
    runtime.signal?.addEventListener('abort', abort, { once: true });
    if (runtime.signal?.aborted) abort();
    const timeout = runtime.timeoutMs ?? defaultTimeout;
    if (timeout !== undefined) {
      timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
    }
    const context = () => ({
      connectionId: connection.id, protocol: request.requestIdentity.protocol,
      effect: internal.writes && dispatched ? 'uncertain-effect' : 'no-write-effect',
      dispatched,
    });
    const interrupted = () => transportError(timedOut ? 'TIMEOUT' : 'CANCELLED',
      timedOut ? 'GitHub request timed out' : 'GitHub request was cancelled', context());
    async function bounded(operation, startWhenAborted = false) {
      if (signal.aborted && !startWhenAborted) throw interrupted();
      let listener;
      const cancelled = new Promise((_, reject) => {
        listener = () => reject(interrupted());
        signal.addEventListener('abort', listener, { once: true });
        if (signal.aborted) listener();
      });
      try {
        return await Promise.race([Promise.resolve().then(() => {
          if (signal.aborted && !startWhenAborted) throw interrupted();
          return operation();
        }), cancelled]);
      } finally {
        signal.removeEventListener('abort', listener);
      }
    }
    const cancellations = new WeakMap();
    function cancelResource(resource, operation) {
      let pending = cancellations.get(resource);
      if (pending === undefined) {
        pending = Promise.resolve().then(operation);
        cancellations.set(resource, pending);
      }
      // Attempt cancellation after abort, but never extend the request deadline.
      return bounded(() => pending, true);
    }
    async function cancelBody(response) {
      if (response.body !== null && response.body !== undefined) {
        requireThat(typeof response.body.cancel === 'function', 'CONTRACT',
          'GitHub response body cannot be safely released');
        try { await cancelResource(response.body, () => response.body.cancel()); }
        catch (error) {
          if (transportErrors.has(error)) throw error;
          requireThat(false, 'CLEANUP', 'GitHub response body cleanup failed');
        }
      }
    }
    let reader;
    let activeResponse;
    let primaryError;
    try {
      const credential = await bounded(async () => {
        try {
          return await resolveGitHubCredential(connection, {
            ...internal.credentialContract, proofScope: request.requestIdentity.proofScope,
          }, signal);
        } catch (error) {
          throw transportError(error instanceof SdlcError &&
            ['INPUT', 'AUTH', 'SCOPE'].includes(error.code) ? error.code : 'AUTH',
          'GitHub credential acquisition failed');
        }
      });
      requireThat(credential.token === undefined ||
        !canonical({ requestIdentity: request.requestIdentity,
          capabilityFacts: credential.capabilityFacts }).includes(credential.token),
      'AUTH', 'GitHub semantic metadata cannot contain authentication material');
      const binding = Object.freeze({
        requestKey: digest(request.requestIdentity), connectionId: connection.id,
        apiOrigin: connection.apiOrigin, credentialGeneration: credential.generation,
        actorVisibility: credential.actorVisibility, tokenClass: credential.tokenClass,
      });
      if (runtime.authorizationSource !== undefined) {
        const source = requireGitHubCapture(runtime.authorizationSource, connection);
        requireThat(source.requestIdentity.proofScope === request.requestIdentity.proofScope &&
          (source.requestIdentity.protocol === 'rest' ?
            ['GET', 'HEAD'].includes(source.requestIdentity.method) :
            source.requestIdentity.operationKind === 'query'),
        'SCOPE', 'GitHub authorization prerequisite must be an actual read of this exact resource scope');
        requireThat(authorizationContext(source.cacheIdentity) === authorizationContext(binding),
          'EVIDENCE', 'GitHub write authorization differs from its independently acquired preflight context');
        if (internal.writes) {
          const levels = { none: 0, unknown: 0, read: 1, write: 2, admin: 3 };
          for (const required of internal.credentialContract.permissions) {
            const actual = credential.capabilityFacts.permissions.find(permission =>
              permission.name === required.name);
            requireThat(actual && levels[actual.level] >= levels[required.level],
              'AUTH', 'GitHub write requires current compatible permission for its acquired prerequisite');
          }
          const entitlements = credential.capabilityFacts.entitlements;
          requireThat(entitlements.every(entitlement => entitlement.state === 'available') &&
            source.capabilityFacts.entitlements.every(previous =>
              previous.state !== 'available' || entitlements.some(current =>
                current.name === previous.name && current.state === 'available')), 'ENTITLEMENT',
          'GitHub write requires available entitlements in its current authorization context');
        }
      }
      requireThat(paginationContext === undefined ||
        paginationContext === authorizationContext(binding), 'PROOF_GAP',
      'GitHub pagination authorization context changed');
      const cached = runtime.cacheEntry === undefined ? undefined : caches.get(runtime.cacheEntry);
      if (runtime.cacheEntry !== undefined) {
        requireThat(cached && request.requestIdentity.protocol === 'rest' &&
          request.requestIdentity.method === 'GET' && !archive &&
          canonical(cached.binding) === canonical(binding) &&
          cached.cacheEpoch === cacheEpoch &&
          cached.scopeEpoch === (scopeEpochs.get(request.requestIdentity.proofScope) ?? 0),
        'CACHE_GAP',
        'GitHub conditional cache does not match the exact authorization and request context');
      }
      const acquisitionEpoch = {
        cacheEpoch, scopeEpoch: scopeEpochs.get(request.requestIdentity.proofScope) ?? 0,
      };
      let url = internal.url;
      let headers = {
        accept: request.requestIdentity.mediaType,
        ...(credential.token === undefined ? {} : { authorization: `Bearer ${credential.token}` }),
        ...(internal.payload === undefined ? {} : { 'content-type': 'application/json' }),
        ...(request.requestIdentity.protocol === 'rest' && internal.profile.apiVersion !== null ?
          { 'x-github-api-version': internal.profile.apiVersion } : {}),
        ...(cached === undefined ? {} : { 'if-none-match': cached.etag }),
      };
      let response;
      const visited = new Set();
      for (let redirectCount = 0; ; redirectCount++) {
        requireThat(!visited.has(url), 'REDIRECT', 'GitHub archive redirect cycle');
        visited.add(url);
        response = await bounded(async () => {
          dispatched = true;
          // A dispatched/uncertain write invalidates old mutable observations conservatively.
          if (internal.writes) cacheEpoch++;
          try {
            const acquired = await call(url, {
              method: request.requestIdentity.method, headers: { ...headers },
              ...(internal.payload === undefined ? {} : { body: internal.payload }),
              redirect: 'manual', signal,
            });
            activeResponse = acquired;
            if (signal.aborted) {
              await cancelBody(acquired);
              activeResponse = undefined;
              throw interrupted();
            }
            return acquired;
          } catch {
            throw transportError('TRANSPORT', 'GitHub injected request failed', context());
          }
        });
        activeResponse = response;
        requireThat(response && Number.isInteger(response.status) &&
          response.status >= 100 && response.status <= 599,
        'CONTRACT', 'Invalid GitHub HTTP response');
        requireThat(response.redirected !== true &&
          (!response.url || response.url === url), 'REDIRECT',
        'GitHub outer transport followed an unapproved redirect');
        if (!redirects.has(response.status)) break;
        requireThat(archive && redirectCount < redirectMaximum, 'REDIRECT',
          'GitHub redirect is outside the separate archive contract');
        requireThat(response.headers && typeof response.headers.get === 'function',
          'CONTRACT', 'GitHub redirect requires fetch-compatible headers');
        const location = response.headers.get('location');
        requireThat(typeof location === 'string', 'REDIRECT', 'GitHub redirect has no target');
        let target;
        try { target = new URL(location, url).href; }
        catch { requireThat(false, 'REDIRECT', 'Invalid GitHub archive redirect target'); }
        let targetUrl;
        try { targetUrl = githubUrl(target, { allowSignedQuery: true }); }
        catch { throw transportError('REDIRECT', 'GitHub archive redirect target is unsafe'); }
        requireThat(credential.token === undefined || !target.includes(credential.token),
          'REDIRECT', 'GitHub redirect contains authentication material');
        requireThat(targetUrl.origin === connection.apiOrigin ||
          connection.archiveOrigins.includes(targetUrl.origin), 'REDIRECT',
        'GitHub archive redirect origin is not allowlisted');
        if (targetUrl.origin !== connection.apiOrigin) {
          headers = { accept: 'application/octet-stream' };
        } else {
          requireThat(targetUrl.pathname === new URL(internal.url).pathname,
            'REDIRECT', 'GitHub archive redirect changed the API resource');
        }
        await cancelBody(response);
        activeResponse = undefined;
        url = target;
      }
      const responseHeaders = captureHeaders(response, credential.token);
      const rateLimited = response.status === 429 ||
        (response.status === 403 && (responseHeaders['x-ratelimit-remaining'] === '0' ||
          responseHeaders['retry-after'] !== undefined));
      const statusCode = rateLimited ? 'RATE_LIMIT' :
        response.status === 401 ? 'AUTH' : response.status === 403 ? 'PERMISSION' :
          response.status === 404 ? 'INACCESSIBLE' : undefined;
      if (statusCode !== undefined) {
        throw transportError(statusCode, 'GitHub acquisition was denied', {
          ...context(), status: response.status, headers: responseHeaders,
        });
      }
      if (response.status === 304) {
        requireThat(cached && (responseHeaders.etag === undefined || responseHeaders.etag === cached.etag),
          'CACHE_GAP', 'GitHub 304 has no matching identified cached facts');
        requireThat(acquisitionEpoch.cacheEpoch === cacheEpoch &&
          acquisitionEpoch.scopeEpoch === (scopeEpochs.get(request.requestIdentity.proofScope) ?? 0),
        'CACHE_GAP', 'GitHub cache was invalidated during conditional acquisition');
        await cancelBody(response);
        activeResponse = undefined;
        return capture(response.status, responseHeaders, url, request, binding, cached.body, {
          source: 'conditional-cache', observationVersion: cached.observationVersion,
          capabilityFacts: credential.capabilityFacts,
        }, false, acquisitionEpoch);
      }
      if (!internal.statuses.includes(response.status)) {
        throw transportError(response.status >= 500 ? 'PROVIDER' : 'CONTRACT',
          'GitHub response status does not match the endpoint contract', {
            ...context(), status: response.status, headers: responseHeaders,
          });
      }
      const length = responseHeaders['content-length'];
      requireThat(length === undefined || (/^[0-9]+$/u.test(length) &&
        Number(length) <= maximum), 'RESPONSE_LIMIT', 'GitHub response exceeds byte limit');
      const chunks = [];
      let total = 0;
      if (response.body !== null && response.body !== undefined) {
        requireThat(typeof response.body.getReader === 'function', 'CONTRACT',
          'GitHub response requires a bounded readable byte stream');
        reader = response.body.getReader();
        for (;;) {
          const part = await bounded(async () => {
            try { return await reader.read(); }
            catch { throw transportError('TRANSPORT', 'GitHub response stream failed', context()); }
          });
          if (part.done) break;
          requireThat(part.value instanceof Uint8Array, 'CONTRACT',
            'GitHub response stream must contain bytes');
          total += part.value.byteLength;
          requireThat(total <= maximum, 'RESPONSE_LIMIT', 'GitHub response exceeds byte limit');
          chunks.push(Buffer.from(part.value));
        }
        reader.releaseLock();
        reader = undefined;
      }
      activeResponse = undefined;
      const bytes = Buffer.concat(chunks, total);
      let body;
      const selectedResponseType = internal.responseTypes?.[response.status] ?? internal.responseType;
      if (selectedResponseType === 'bytes') body = new Uint8Array(bytes);
      else if (selectedResponseType === 'empty') {
        requireThat(bytes.length === 0, 'CONTRACT', 'GitHub endpoint requires an empty response');
        body = null;
      } else {
        let decoded;
        try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
        catch { requireThat(false, 'CONTRACT', 'GitHub response is not valid UTF-8'); }
        if (selectedResponseType === 'text') body = decoded;
        else {
          requireThat(/^(?:application\/json|application\/[A-Za-z0-9_.+-]+\+json)(?:;|$)/iu.test(
            responseHeaders['content-type'] ?? ''), 'CONTRACT', 'GitHub endpoint requires JSON media type');
          try { body = JSON.parse(decoded); }
          catch { requireThat(false, 'CONTRACT', 'GitHub response is not valid JSON'); }
          requireThat(body !== null && typeof body === 'object',
            'CONTRACT', 'GitHub JSON response must contain an object or array');
          freezeBody(body);
        }
      }
      if (request.requestIdentity.protocol === 'graphql') {
        requireThat(body && !Array.isArray(body) && (body.errors === undefined ||
          (Array.isArray(body.errors) && body.errors.length === 0)), 'GRAPHQL',
        'GitHub GraphQL errors prevent a complete observation', {
          partialDataPresent: body?.data !== undefined && body?.data !== null,
        });
        requireThat(body.data && Object.getPrototypeOf(body.data) === Object.prototype,
          'CONTRACT', 'GitHub GraphQL response has no typed data object');
        let valid;
        try { valid = internal.validateData(body.data); }
        catch { requireThat(false, 'CONTRACT', 'GitHub GraphQL typed selection validation failed'); }
        requireThat(valid === true, 'CONTRACT', 'GitHub GraphQL required selections are missing or invalid');
      }
      return capture(response.status, responseHeaders, url, request, binding, body, {
        source: 'response', capabilityFacts: credential.capabilityFacts,
        ...(internal.writes ? { dispatchIndication: runtime.actionAuthority } : {}),
      }, archive, acquisitionEpoch);
    } catch (error) {
      if (signal.aborted) {
        primaryError = interrupted();
        throw primaryError;
      }
      if (transportErrors.has(error)) {
        primaryError = transportError(error.code, error.message, { ...error.details, ...context() });
        throw primaryError;
      }
      primaryError = transportError('TRANSPORT', 'GitHub injected request or response stream failed', context());
      throw primaryError;
    } finally {
      let cleanupFailed = false;
      let cleanupTimedOut = false;
      try {
        if (reader !== undefined) await cancelResource(reader, () => reader.cancel());
        else if (activeResponse !== undefined) await cancelBody(activeResponse);
      } catch (error) {
        cleanupFailed = true;
        cleanupTimedOut = transportErrors.has(error) && error.code === 'TIMEOUT';
      } finally {
        try { reader?.releaseLock(); }
        catch { cleanupFailed = true; }
        clearTimeout(timer);
        runtime.signal?.removeEventListener('abort', abort);
      }
      if (cleanupFailed) {
        throw transportError(primaryError?.code ?? 'CLEANUP',
          primaryError?.message ?? 'GitHub response stream cleanup failed',
          { ...primaryError?.details, ...context(), cleanupFailed: true,
            ...(cleanupTimedOut ? { cleanupTimedOut: true } : {}) });
      }
    }
  }

  function capture(status, headers, finalUrl, request, binding, body, facts, archive, acquisitionEpoch) {
    const parsed = githubUrl(finalUrl, { allowSignedQuery: archive });
    const protectedUrl = archive && parsed.search !== '';
    const result = {
      status, headers, requestIdentity: request.requestIdentity, cacheIdentity: binding,
      ...facts, ...(protectedUrl ? { finalOrigin: parsed.origin, finalUrlSlot: randomUUID() } : { finalUrl }),
    };
    Object.defineProperty(result, 'body', { value: body, enumerable: false });
    if (protectedUrl) Object.defineProperty(result, 'finalUrl', { value: finalUrl, enumerable: false });
    if (archive) {
      Object.defineProperty(result, 'bodyStream', {
        value: new ReadableStream({
          start(controller) { controller.enqueue(body); controller.close(); },
        }), enumerable: false,
      });
    }
    Object.freeze(result);
    captures.set(result, { body, binding, request, ...acquisitionEpoch });
    acquiredCaptures.set(result, connection);
    const dispatchedRequest = prepared.get(request);
    captureRequests.set(result, {
      payload: dispatchedRequest.payload,
      variables: dispatchedRequest.variables,
      document: dispatchedRequest.document,
    });
    return result;
  }

  function createCacheEntry(observation, input) {
    githubOptions(input, ['observationVersion'], ['observationVersion']);
    githubSafeName(input.observationVersion, 'GitHub observation version');
    const acquired = captures.get(observation);
    requireThat(acquired && observation.status === 200 &&
      observation.requestIdentity.protocol === 'rest' &&
      observation.requestIdentity.method === 'GET' &&
      observation.requestIdentity.responseType === 'json' &&
      acquired.cacheEpoch === cacheEpoch &&
      acquired.scopeEpoch === (scopeEpochs.get(observation.requestIdentity.proofScope) ?? 0) &&
      typeof observation.headers.etag === 'string' &&
      /^(?:W\/)?"[^"\r\n]*"$/u.test(observation.headers.etag), 'CACHE_GAP',
    'GitHub cache entry requires exact acquired GET JSON facts and ETag');
    const entry = Object.freeze({
      cacheIdentity: acquired.binding, etag: observation.headers.etag,
      observationVersion: input.observationVersion,
    });
    caches.set(entry, {
      binding: acquired.binding, etag: observation.headers.etag,
      observationVersion: input.observationVersion,
      body: freezeBody(JSON.parse(canonical(acquired.body))),
      cacheEpoch: acquired.cacheEpoch, scopeEpoch: acquired.scopeEpoch,
    });
    return entry;
  }

  /** Host reconciliation/events may invalidate one proof scope, or all connection facts. */
  function invalidateCache(input = {}) {
    githubOptions(input, ['proofScope']);
    if (input.proofScope === undefined) cacheEpoch++;
    else {
      selectGitHubScope(connection, input.proofScope);
      scopeEpochs.set(input.proofScope, (scopeEpochs.get(input.proofScope) ?? 0) + 1);
    }
  }

  function execute(request, input = {}) { return run(request, input); }
  function downloadArchive(request, input = {}) { return run(request, input, true); }

  async function paginateRest(request, input = {}) {
    githubOptions(input, ['signal', 'timeoutMs', 'maxPages', 'pageParameter']);
    const internal = prepared.get(request);
    requireThat(internal && request.requestIdentity.protocol === 'rest' &&
      request.requestIdentity.method === 'GET' && internal.responseType === 'json',
    'INPUT', 'GitHub REST pagination requires a prepared GET JSON request');
    const pageParameter = input.pageParameter ?? 'page';
    choice(pageParameter, ['page', 'after', 'before', 'since'], 'GitHub page parameter');
    const bound = input.maxPages === undefined ? pageMaximum :
      positiveBound(input.maxPages, 'page limit', pageMaximum);
    requireThat(new URL(internal.url).searchParams.getAll(pageParameter).length <= 1,
      'INPUT', 'GitHub pagination requires one initial page parameter');
    const pages = [];
    const visited = new Set();
    let current = request;
    let paginationContext;
    while (current !== undefined) {
      const url = prepared.get(current).url;
      requireThat(!visited.has(url), 'PROOF_GAP', 'GitHub REST pagination cycle');
      requireThat(pages.length < bound, 'PROOF_GAP', 'GitHub REST pagination exceeds page limit');
      visited.add(url);
      const observation = await run(current, {
        signal: input.signal, timeoutMs: input.timeoutMs,
      }, false, paginationContext);
      paginationContext ??= authorizationContext(observation.cacheIdentity);
      pages.push(observation);
      const next = nextRestUrl(observation.headers.link, url, connection, pageParameter);
      current = next === undefined ? undefined :
        prepare({ ...request.requestIdentity,
          path: next.slice(connection.apiOrigin.length + connection.apiPathPrefix.length) },
        { ...internal, url: next });
    }
    return Object.freeze({
      pages: Object.freeze(pages),
      pagination: Object.freeze({ complete: true, pageCount: pages.length }),
    });
  }

  async function paginateGraphQL(request, input) {
    githubOptions(input, ['signal', 'timeoutMs', 'maxPages', 'cursorVariable', 'readPageInfo', 'prepareNext'],
      ['cursorVariable', 'readPageInfo']);
    const internal = prepared.get(request);
    requireThat(internal && request.requestIdentity.protocol === 'graphql' &&
      request.requestIdentity.operationKind === 'query', 'INPUT',
    'GraphQL pagination requires a prepared named query');
    requireThat(typeof input.cursorVariable === 'string' &&
      /^[A-Za-z_][A-Za-z0-9_]*$/u.test(input.cursorVariable) &&
      Object.hasOwn(internal.variables, input.cursorVariable) &&
      (internal.variables[input.cursorVariable] === null ||
        (typeof internal.variables[input.cursorVariable] === 'string' &&
          internal.variables[input.cursorVariable].length > 0 &&
          internal.variables[input.cursorVariable].length <= 8192)) &&
      typeof input.readPageInfo === 'function' &&
      input.readPageInfo.constructor.name !== 'AsyncFunction',
    'INPUT', 'Invalid GitHub cursor contract');
    const bound = input.maxPages === undefined ? pageMaximum :
      positiveBound(input.maxPages, 'page limit', pageMaximum);
    requireThat(input.prepareNext === undefined || typeof input.prepareNext === 'function' &&
      input.prepareNext.constructor.name !== 'AsyncFunction', 'INPUT',
    'GitHub next-page preparation must be a synchronous trusted mapper');
    const pages = [];
    const visited = new Set([internal.variables[input.cursorVariable]]);
    let current = request;
    let paginationContext;
    for (;;) {
      requireThat(pages.length < bound, 'PROOF_GAP', 'GitHub GraphQL pagination exceeds page limit');
      const observation = await run(current, {
        signal: input.signal, timeoutMs: input.timeoutMs,
      }, false, paginationContext);
      paginationContext ??= authorizationContext(observation.cacheIdentity);
      pages.push(observation);
      let pageInfo;
      try { pageInfo = input.readPageInfo(observation.body.data); }
      catch { requireThat(false, 'CONTRACT', 'GitHub GraphQL page selection failed'); }
      githubOptions(pageInfo, ['hasNextPage', 'endCursor'], ['hasNextPage', 'endCursor']);
      requireThat(typeof pageInfo.hasNextPage === 'boolean' &&
        (pageInfo.endCursor === null || (typeof pageInfo.endCursor === 'string' &&
          pageInfo.endCursor.length > 0 && pageInfo.endCursor.length <= 8192)),
      'CONTRACT', 'Invalid GitHub GraphQL page info');
      if (!pageInfo.hasNextPage) break;
      requireThat(pageInfo.endCursor !== null && !visited.has(pageInfo.endCursor),
        'PROOF_GAP', 'GitHub GraphQL cursor is missing or cyclic');
      visited.add(pageInfo.endCursor);
      const variables = { ...internal.variables, [input.cursorVariable]: pageInfo.endCursor };
      if (input.prepareNext) {
        current = input.prepareNext(pageInfo.endCursor);
        const next = prepared.get(current);
        const { payloadSlot: initialSlot, ...identity } = request.requestIdentity;
        const { payloadSlot: nextSlot, ...nextIdentity } = current?.requestIdentity ?? {};
        void initialSlot; void nextSlot;
        requireThat(next && canonical(identity) === canonical(nextIdentity) &&
          next.document === internal.document && canonical(next.variables) === canonical(variables) &&
          canonical(next.credentialContract) === canonical(internal.credentialContract),
        'EVIDENCE', 'GitHub next-page mapper changed the exact compiled query, variables or authorization');
      } else {
        current = prepare({ ...request.requestIdentity, payloadSlot: randomUUID() }, {
          ...internal, variables,
          payload: jsonPayload({
            query: internal.document, operationName: request.requestIdentity.operationName, variables,
          }, requestMaximum),
        });
      }
    }
    return Object.freeze({
      pages: Object.freeze(pages),
      pagination: Object.freeze({ complete: true, pageCount: pages.length }),
    });
  }

  const transport = Object.freeze({
    buildRestRequest, buildGraphQLRequest, execute, downloadArchive,
    paginateRest, paginateGraphQL, createCacheEntry, invalidateCache,
  });
  transportConnections.set(transport, connection);
  transportPageLimits.set(transport, pageMaximum);
  return transport;
}
