import { canonical, choice, id, requireThat } from '../core.mjs';
import { validateGitHubId } from './schemas.mjs';

export const GITHUB_TOKEN_CLASSES = Object.freeze([
  'anonymous', 'classic-pat', 'oauth', 'fine-grained-pat',
  'app-installation', 'app-user', 'app-jwt',
]);

export const GITHUB_REST_PROFILES = Object.freeze([
  Object.freeze({ id: '2026-03-10', kind: 'rest', apiVersion: '2026-03-10' }),
  Object.freeze({ id: '2022-11-28', kind: 'rest', apiVersion: '2022-11-28' }),
]);

const connections = new WeakMap();
const credentialKey = /(?:token|password|secret|authorization|credential|signature|api[_-]?key|^key$|^sig$|prompt)/iu;

// Do not echo arbitrary option keys: callers sometimes accidentally pass secret values as keys.
export function githubOptions(value, allowed, required = []) {
  requireThat(value && Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).every(key => allowed.includes(key)) &&
    required.every(key => value[key] !== undefined),
  'INPUT', 'Invalid or unknown GitHub option fields');
  return value;
}

export function githubSafeName(value, label = 'GitHub identifier') {
  id(value, label);
  requireThat(!/^(?:gh[pousr]_|github_pat_)/iu.test(value),
    'INPUT', `Invalid ${label}`);
  return value;
}

export function githubUrl(value, { origin, prefix = '/', allowSignedQuery = false } = {}) {
  requireThat(typeof value === 'string' && value.length <= 8192 &&
    !/[\s\\\u0000-\u001f\u007f]/u.test(value),
  'INPUT', 'Invalid GitHub URL');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    requireThat(false, 'INPUT', 'Invalid GitHub URL');
  }
  requireThat(parsed.protocol === 'https:' && !parsed.username && !parsed.password &&
    !parsed.hash && parsed.href === value &&
    (origin === undefined || parsed.origin === origin) &&
    (prefix === '/' || parsed.pathname.startsWith(`${prefix}/`) || parsed.pathname === prefix),
  'INPUT', 'GitHub URL does not match the trusted HTTPS endpoint');
  // Repeated decoding prevents encoded credential keys/path traversal bypasses.
  let decoded = parsed.pathname;
  for (let index = 0; index < 3; index++) {
    let next;
    try { next = decodeURIComponent(decoded); }
    catch { requireThat(false, 'INPUT', 'Invalid GitHub URL encoding'); }
    requireThat(!/[\u0000-\u001f\u007f\\]/u.test(next) &&
      !next.split('/').some(part => part === '.' || part === '..') &&
      !/(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]+/u.test(next),
    'INPUT', 'Invalid GitHub URL path');
    if (next === decoded) break;
    decoded = next;
  }
  for (const [key, valuePart] of parsed.searchParams) {
    let current = `${key}=${valuePart}`;
    for (let index = 0; index < 3; index++) {
      requireThat(allowSignedQuery || (!credentialKey.test(current.split('=')[0]) &&
        !/(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]+|(?:token|password|secret|authorization|prompt)\s*[:=]/iu.test(current.slice(current.indexOf('=') + 1))),
      'INPUT', 'Credential-bearing GitHub query is not allowed');
      requireThat(!/[\u0000-\u001f\u007f]/u.test(current),
        'INPUT', 'Invalid GitHub query');
      let next;
      try { next = decodeURIComponent(current); }
      catch { requireThat(false, 'INPUT', 'Invalid GitHub query encoding'); }
      if (next === current) break;
      current = next;
    }
  }
  return parsed;
}

function exactOrigin(value) {
  const url = githubUrl(`${value}/`);
  requireThat(url.origin === value && url.pathname === '/' && !url.search,
    'INPUT', 'GitHub origin must be an exact HTTPS origin');
  return value;
}

function freezeJson(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeJson);
    Object.freeze(value);
  }
  return value;
}

function scopeDefinition(value) {
  githubOptions(value, ['kind', 'id', 'owner', 'name', 'login'], ['kind', 'id']);
  choice(value.kind, ['repository', 'organization', 'user'], 'GitHub scope kind');
  const providerId = validateGitHubId(value.id);
  const login = value.kind === 'repository' ? value.owner : value.login;
  requireThat(typeof login === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/u.test(login),
    'INPUT', 'Invalid GitHub scope login');
  if (value.kind === 'repository') {
    requireThat(value.login === undefined && typeof value.name === 'string' &&
      /^[A-Za-z0-9_.-]{1,100}$/u.test(value.name) && !['.', '..'].includes(value.name),
    'INPUT', 'Invalid GitHub repository scope');
  } else {
    requireThat(value.owner === undefined && value.name === undefined,
      'INPUT', 'Invalid GitHub owner scope');
  }
  return freezeJson({ ...value, id: providerId, scopeRef: `${value.kind}:${providerId}` });
}

function profileDefinition(value) {
  githubOptions(value, ['id', 'kind', 'apiVersion', 'schemaVersion'],
    ['id', 'kind']);
  githubSafeName(value.id, 'GitHub profile ID');
  choice(value.kind, ['rest', 'graphql'], 'GitHub profile kind');
  if (value.kind === 'rest') {
    requireThat(value.schemaVersion === undefined &&
      (value.apiVersion === null || (typeof value.apiVersion === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/u.test(value.apiVersion))),
    'INPUT', 'REST profiles require an explicit API version or explicit unversioned contract');
  } else {
    requireThat(value.apiVersion === undefined, 'INPUT',
      'GraphQL profiles cannot claim a REST API version');
    githubSafeName(value.schemaVersion, 'GitHub schema version');
  }
  return Object.freeze({ ...value });
}

function permissionDefinitions(value = []) {
  requireThat(Array.isArray(value) && value.length <= 100,
    'INPUT', 'Invalid GitHub permission contract');
  const result = value.map(permission => {
    githubOptions(permission, ['name', 'level'], ['name', 'level']);
    githubSafeName(permission.name, 'GitHub permission name');
    choice(permission.level, ['read', 'write', 'admin', 'none', 'unknown'],
      'GitHub permission level');
    return Object.freeze({ ...permission });
  });
  requireThat(new Set(result.map(item => item.name)).size === result.length,
    'INPUT', 'Duplicate GitHub permission');
  return Object.freeze(result);
}

/** Validate explicit endpoint-compatible token classes; this is not user authority. */
export function validateGitHubCredentialContract(value) {
  githubOptions(value, ['tokenClasses', 'permissions'], ['tokenClasses']);
  requireThat(Array.isArray(value.tokenClasses) && value.tokenClasses.length > 0 &&
    value.tokenClasses.every(item => GITHUB_TOKEN_CLASSES.includes(item)) &&
    new Set(value.tokenClasses).size === value.tokenClasses.length,
  'INPUT', 'Invalid GitHub token compatibility contract');
  return Object.freeze({
    tokenClasses: Object.freeze([...value.tokenClasses]),
    permissions: permissionDefinitions(value.permissions),
  });
}

/**
 * Trusted in-process definitions only. Required: id, apiOrigin, webOrigin, scopes.
 * Optional: apiPathPrefix, graphqlPath, profiles, archiveOrigins, credentialResolver.
 * github.com has the two reviewed REST profiles above; enterprise hosts must supply
 * explicit profiles. GraphQL always requires an explicit schema profile.
 * Resolver input: {connectionId,apiOrigin,proofScope,tokenClasses,permissions,signal}.
 * Output: {apiOrigin,tokenClass,token?,generation,actorVisibility,permissions?,entitlements?}.
 * Tokens exist only in the ephemeral resolver/HTTP boundary, never connection metadata.
 * Construction performs no credential lookup, ambient environment lookup or I/O.
 */
export function createGitHubConnection(options) {
  githubOptions(options, ['id', 'apiOrigin', 'webOrigin', 'scopes', 'apiPathPrefix',
    'graphqlPath', 'profiles', 'archiveOrigins', 'credentialResolver'],
  ['id', 'apiOrigin', 'webOrigin', 'scopes']);
  const connectionId = githubSafeName(options.id, 'GitHub connection ID');
  const apiOrigin = exactOrigin(options.apiOrigin);
  const webOrigin = exactOrigin(options.webOrigin);
  const apiPathPrefix = options.apiPathPrefix ?? '';
  requireThat(apiPathPrefix === '' || /^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/u.test(apiPathPrefix),
    'INPUT', 'Invalid GitHub API path prefix');
  const graphqlPath = options.graphqlPath ?? (apiPathPrefix === '' ? '/graphql' : undefined);
  if (graphqlPath !== undefined) {
    requireThat(/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/u.test(graphqlPath),
      'INPUT', 'Invalid GitHub GraphQL path');
  }
  requireThat(Array.isArray(options.scopes) && options.scopes.length > 0 &&
    options.scopes.length <= 1000, 'INPUT', 'GitHub scopes must be explicit');
  const scopes = options.scopes.map(scopeDefinition);
  requireThat(new Set(scopes.map(scope => scope.scopeRef)).size === scopes.length,
    'INPUT', 'Duplicate GitHub scope');
  const profileInput = options.profiles ??
    (apiOrigin === 'https://api.github.com' && webOrigin === 'https://github.com' ?
      GITHUB_REST_PROFILES : undefined);
  requireThat(Array.isArray(profileInput) && profileInput.length > 0 &&
    profileInput.length <= 100, 'CONTRACT', 'Explicit trusted endpoint profiles are required');
  const profiles = profileInput.map(profileDefinition);
  requireThat(new Set(profiles.map(profile => profile.id)).size === profiles.length,
    'INPUT', 'Duplicate GitHub profile');
  const archiveOrigins = options.archiveOrigins ?? [];
  requireThat(Array.isArray(archiveOrigins) && archiveOrigins.length <= 20,
    'INPUT', 'Invalid GitHub archive origins');
  archiveOrigins.forEach(exactOrigin);
  requireThat(new Set(archiveOrigins).size === archiveOrigins.length,
    'INPUT', 'Duplicate GitHub archive origin');
  requireThat(options.credentialResolver === undefined ||
    typeof options.credentialResolver === 'function', 'INPUT',
  'GitHub credential resolver must be an injected function');
  const connection = freezeJson({
    id: connectionId, apiOrigin, webOrigin, apiPathPrefix, graphqlPath,
    scopes, profiles, archiveOrigins: [...archiveOrigins],
  });
  connections.set(connection, { credentialResolver: options.credentialResolver });
  return connection;
}

export function requireGitHubConnection(connection) {
  requireThat(connections.has(connection), 'INPUT', 'Expected a trusted GitHub connection');
  return connection;
}

export function selectGitHubProfile(connection, profileId, kind) {
  requireGitHubConnection(connection);
  const profile = connection.profiles.find(item => item.id === profileId && item.kind === kind);
  requireThat(profile !== undefined, 'CONTRACT', 'Unsupported GitHub endpoint profile');
  return profile;
}

export function selectGitHubScope(connection, proofScope) {
  requireGitHubConnection(connection);
  const scope = connection.scopes.find(item => item.scopeRef === proofScope);
  requireThat(scope !== undefined, 'SCOPE', 'GitHub request is outside the connection scope');
  return scope;
}

/** Internal acquisition seam. Never serialize its returned token. */
export async function resolveGitHubCredential(connection, request, signal) {
  const internal = connections.get(requireGitHubConnection(connection));
  selectGitHubScope(connection, request.proofScope);
  const contract = validateGitHubCredentialContract({
    tokenClasses: request.tokenClasses, permissions: request.permissions,
  });
  let credential;
  if (internal.credentialResolver === undefined) {
    credential = { apiOrigin: connection.apiOrigin, tokenClass: 'anonymous',
      generation: 'anonymous', actorVisibility: 'public' };
  } else {
    try {
      credential = await internal.credentialResolver(Object.freeze({
        connectionId: connection.id, apiOrigin: connection.apiOrigin,
        proofScope: request.proofScope, ...contract, signal,
      }));
    } catch {
      requireThat(false, 'AUTH', 'GitHub credential resolution failed');
    }
  }
  githubOptions(credential, ['apiOrigin', 'tokenClass', 'token', 'generation',
    'actorVisibility', 'permissions', 'entitlements'],
  ['apiOrigin', 'tokenClass', 'generation', 'actorVisibility']);
  requireThat(credential.apiOrigin === connection.apiOrigin &&
    contract.tokenClasses.includes(credential.tokenClass),
  'AUTH', 'GitHub credential is incompatible with this endpoint');
  githubSafeName(credential.generation, 'GitHub credential generation');
  githubSafeName(credential.actorVisibility, 'GitHub actor visibility');
  if (credential.tokenClass === 'anonymous') {
    requireThat(credential.token === undefined, 'AUTH',
      'Anonymous GitHub credentials cannot contain a token');
  } else {
    requireThat(typeof credential.token === 'string' && credential.token.length > 0 &&
      credential.token.length <= 8192 && /^[A-Za-z0-9._~+/-]+=*$/u.test(credential.token),
    'AUTH', 'Invalid GitHub authentication token');
    requireThat(!credential.generation.includes(credential.token) &&
      !credential.actorVisibility.includes(credential.token), 'AUTH',
    'Credential identity metadata must not contain the token');
  }
  const permissions = permissionDefinitions(credential.permissions);
  const entitlements = credential.entitlements ?? [];
  requireThat(Array.isArray(entitlements) && entitlements.length <= 100,
    'INPUT', 'Invalid GitHub entitlement facts');
  const entitlementFacts = entitlements.map(item => {
    githubOptions(item, ['name', 'state'], ['name', 'state']);
    githubSafeName(item.name, 'GitHub entitlement name');
    choice(item.state, ['available', 'unavailable', 'unknown'], 'GitHub entitlement state');
    return { ...item };
  });
  // Canonicalization checks that capability facts stay JSON data, not executable authority.
  canonical(entitlementFacts);
  return {
    tokenClass: credential.tokenClass, token: credential.token,
    generation: credential.generation, actorVisibility: credential.actorVisibility,
    capabilityFacts: freezeJson({ permissions, entitlements: entitlementFacts }),
  };
}
