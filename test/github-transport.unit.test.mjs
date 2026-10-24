export const validationDeclarations = {
  "schemaVersion": 1,
  "surfaces": [{"coverage": "direct", "paths": ["src/github/transport.mjs", "src/github/connection.mjs"]}],
  "variants": [
    {"expression": "`write preflight binds the actual resolved authorization before HTTP: ${Object.keys(changed)[0]}`", "domains": {"Object.keys(changed)[0]": ["generation", "actorVisibility", "permissions"]}},
    {"expression": "`current ${state} entitlement cannot reuse an available preflight to dispatch`", "domains": {"state": ["unknown", "unavailable", "omitted"]}},
    {"expression": "`HTTP ${status}/${code} case ${caseIndex} is explicit denial/contract failure, never absence or empty success`", "names": ["HTTP 401/AUTH case 0 is explicit denial/contract failure, never absence or empty success", "HTTP 403/PERMISSION case 1 is explicit denial/contract failure, never absence or empty success", "HTTP 404/INACCESSIBLE case 2 is explicit denial/contract failure, never absence or empty success", "HTTP 429/RATE_LIMIT case 3 is explicit denial/contract failure, never absence or empty success", "HTTP 403/RATE_LIMIT case 4 is explicit denial/contract failure, never absence or empty success", "HTTP 403/RATE_LIMIT case 5 is explicit denial/contract failure, never absence or empty success", "HTTP 500/PROVIDER case 6 is explicit denial/contract failure, never absence or empty success", "HTTP 202/CONTRACT case 7 is explicit denial/contract failure, never absence or empty success"]},
    {"expression": "`${name} fails the bounded response contract`", "domains": {"name": ["malformed JSON", "wrong JSON type", "login HTML", "declared oversized", "streamed oversized", "malformed UTF-8"]}},
    {"expression": "`unsafe/out-of-scope relative route is rejected: ${pathIndex}`", "domains": {"pathIndex": ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]}},
    {"expression": "`connection rejects noncanonical origin ${originIndex}`", "domains": {"originIndex": ["0", "1", "2", "3", "4", "5"]}},
    {"expression": "`REST pagination rejects ${name} without a false complete result`", "domains": {"name": ["other origin", "changed filters", "changed resource", "malformed link", "cycle", "bounded pages", "duplicate next"]}},
    {"expression": "`cache isolation rejects a changed ${change} before conditional dispatch`", "domains": {"change": ["request", "profile", "generation", "visibility", "connection", "forged-entry"]}},
    {"expression": "`${protocol} pagination rejects actor/credential generation changes before the second page`", "domains": {"protocol": ["rest", "graphql"]}},
    {"expression": "`cleanup failure preserves the primary ${code} category and reports the additional gap`", "domains": {"code": ["PERMISSION", "REDIRECT", "PROVIDER"]}},
    {"expression": "`incompatible credential origin, token class, header or generation case ${incompatibleIndex} is rejected before dispatch`", "domains": {"incompatibleIndex": ["0", "1", "2", "3"]}},
    {"expression": "`archive refuses untrusted origins, unsafe URLs and forwarding its API token case ${targetIndex}`", "domains": {"targetIndex": ["0", "1", "2", "3", "4"]}},
    {"expression": "`GraphQL errors, partial data and failed mandatory typed selections case ${bodyIndex} cannot become complete facts`", "domains": {"bodyIndex": ["0", "1", "2", "3", "4"]}},
    {"expression": "`GraphQL rejects cyclic, absent or unbounded cursors case ${cursorIndex} without partial success`", "domains": {"cursorIndex": ["0", "1", "2"]}}
  ]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import { SdlcError } from '../src/core.mjs';
import {
  createGitHubConnection, GITHUB_REST_PROFILES,
} from '../src/github/connection.mjs';
import { createGitHubTransport, getGitHubTransportPageLimit } from '../src/github/transport.mjs';

const api = 'https://api.github.com';
const route = '/repos/fixture-owner/fixture-repo/issues?state=open&per_page=2';
const scope = { kind: 'repository', id: 17, owner: 'fixture-owner', name: 'fixture-repo' };
const token = 'fixture-ephemeral-token';
const credential = (changes = {}) => ({
  apiOrigin: api, tokenClass: 'fine-grained-pat', token,
  generation: 'generation-1', actorVisibility: 'actor-42-private', ...changes,
});
const authority = { operationId: 'operation-1', authorityRef: 'authority-1', dispatchClaimId: 'claim-1' };
const connection = (changes = {}) => createGitHubConnection({
  id: 'fixture-connection', apiOrigin: api, webOrigin: 'https://github.com',
  scopes: [scope], ...changes,
});
const response = (body = { id: 17 }, status = 200, headers = {}) =>
  new Response(status === 204 || status === 304 ? null : JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', ...headers },
  });
const rest = (transport, changes = {}) => transport.buildRestRequest({
  method: 'GET', path: route, profile: '2026-03-10',
  mediaType: 'application/vnd.github+json', expectedStatuses: [200],
  proofScope: 'repository:17', tokenClasses: ['anonymous', 'fine-grained-pat'],
  ...changes,
});
const document = 'query ReadIssues($owner: String!, $after: String) { repository(owner: $owner, name: "fixture-repo") { issues(first: 2, after: $after) { nodes { id } pageInfo { hasNextPage endCursor } } } }';
const validateData = data => typeof data.repository?.issues?.pageInfo?.hasNextPage === 'boolean' &&
  Array.isArray(data.repository.issues.nodes) &&
  data.repository.issues.nodes.every(node => typeof node.id === 'string');
const gqlBody = (cursor = null, hasNextPage = false, changes = {}) => ({
  data: { repository: { issues: { nodes: [{ id: 'I_17' }],
    pageInfo: { hasNextPage, endCursor: cursor } } } }, ...changes,
});
const graphqlConnection = (changes = {}) => connection({
  profiles: [...GITHUB_REST_PROFILES,
    { id: 'reviewed-schema', kind: 'graphql', schemaVersion: 'schema-2026-03' }],
  ...changes,
});
const graphql = (transport, changes = {}) => transport.buildGraphQLRequest({
  documentId: 'issues-read-v1', document, operationName: 'ReadIssues',
  operationKind: 'query', variables: { owner: 'fixture-owner', after: null },
  schemaProfile: 'reviewed-schema', proofScope: 'repository:17',
  tokenClasses: ['anonymous'], validateData, ...changes,
});
const pageInfo = data => data.repository.issues.pageInfo;

test('constructor-bound transport page limit is exact, immutable, branded and acquisition-free', () => {
  let calls = 0, resolutions = 0;
  const owner = connection({ credentialResolver: () => { resolutions++; return credential(); } });
  const options = { connection: owner, maxPages: 12, fetch: () => { calls++; return response(); } };
  const transport = createGitHubTransport(options);
  assert.equal(getGitHubTransportPageLimit(transport, owner), 12);
  options.maxPages = 999;
  assert.equal(getGitHubTransportPageLimit(transport, owner), 12);
  assert.ok(Object.isFrozen(transport));
  assert.equal(Object.hasOwn(transport, 'maxPages'), false);
  const defaults = createGitHubTransport({ connection: owner, fetch: options.fetch });
  assert.equal(getGitHubTransportPageLimit(defaults, owner), 100);
  assert.throws(() => getGitHubTransportPageLimit({ ...transport }, owner), { code: 'ADAPTER' });
  assert.throws(() => getGitHubTransportPageLimit(transport, connection()), { code: 'ADAPTER' });
  assert.throws(() => getGitHubTransportPageLimit(transport, { ...owner }), { code: 'INPUT' });
  assert.equal(calls, 0);
  assert.equal(resolutions, 0);
});

test('constructor-bound SDK cap remains enforced before another page credential or HTTP request', async () => {
  let calls = 0, resolutions = 0;
  const owner = connection({ credentialResolver: () => { resolutions++; return credential(); } });
  const options = { connection: owner, maxPages: 1,
    fetch: () => { calls++; return response([], 200, { link: `<${api}${route}&page=2>; rel=next` }); } };
  const transport = createGitHubTransport(options);
  options.maxPages = 12;
  assert.equal(getGitHubTransportPageLimit(transport, owner), 1);
  await assert.rejects(transport.paginateRest(rest(transport)), { code: 'PROOF_GAP' });
  assert.equal(calls, 1);
  assert.equal(resolutions, 1);
  await assert.rejects(transport.paginateRest(rest(transport), { maxPages: 2 }), { code: 'INPUT' });
  assert.equal(calls, 1);
  assert.equal(resolutions, 1);
});

test('explicit aggregate allowance below constructor SDK cap stops before excess page acquisition', async () => {
  let calls = 0, resolutions = 0;
  const owner = connection({ credentialResolver: () => { resolutions++; return credential(); } });
  const transport = createGitHubTransport({ connection: owner, maxPages: 12,
    fetch: () => {
      calls++;
      return response([], 200, { link: `<${api}${route}&page=${calls + 1}>; rel=next` });
    } });
  await assert.rejects(transport.paginateRest(rest(transport), {
    maxPages: Math.min(2, getGitHubTransportPageLimit(transport, owner)),
  }), { code: 'PROOF_GAP' });
  assert.equal(calls, 2);
  assert.equal(resolutions, 2);
});

test('user routes require the exact acquired login, never a numeric identity alias', () => {
  const transport = createGitHubTransport({
    connection: connection({ scopes: [{ kind: 'user', id: '18', login: 'alice' }] }),
    fetch: () => assert.fail('Pure route preparation must not send HTTP'),
  });
  const input = {
    proofScope: 'user:18', tokenClasses: ['anonymous'],
    path: '/users/alice/repos',
  };
  assert.equal(rest(transport, input).requestIdentity.path, input.path);
  for (const path of [
    '/users/18/repos', '/users/19/repos', '/users/alice-copy/repos',
  ]) assert.throws(() => rest(transport, { ...input, path }), { code: 'SCOPE' }, path);
});

test('trusted GraphQL cursor mapper cannot switch actual document, resource variables or transport', async () => {
  for (const change of [
    { document: document.replace('nodes { id }', 'nodes { id title }') },
    { variables: { owner: 'foreign-owner', after: 'cursor_one' } },
  ]) {
    let calls = 0;
    const transport = createGitHubTransport({
      connection: graphqlConnection(),
      fetch: () => { calls++; return response(gqlBody('cursor_one', true)); },
    });
    await assert.rejects(transport.paginateGraphQL(graphql(transport), {
      cursorVariable: 'after', readPageInfo: pageInfo,
      prepareNext: after => graphql(transport, { variables: { owner: 'fixture-owner', after }, ...change }),
    }), { code: 'EVIDENCE' });
    assert.equal(calls, 1);
  }
});

for (const changed of [
  { generation: 'other-generation' }, { actorVisibility: 'other-actor' },
  { permissions: [{ name: 'issues', level: 'none' }] },
]) {
  test(`write preflight binds the actual resolved authorization before HTTP: ${Object.keys(changed)[0]}`, async () => {
    let resolutions = 0;
    let calls = 0;
    const transport = createGitHubTransport({
      connection: connection({
        credentialResolver: () => credential({
          permissions: [{ name: 'issues', level: 'write' }],
          ...(resolutions++ === 0 ? {} : changed),
        }),
      }),
      fetch: () => { calls++; return response(); },
    });
    const source = await transport.execute(rest(transport));
    const write = rest(transport, {
      method: 'PATCH', payload: { state: 'closed' }, tokenClasses: ['fine-grained-pat'],
      permissions: [{ name: 'issues', level: 'write' }],
    });
    await assert.rejects(transport.execute(write, {
      actionAuthority: authority, authorizationSource: source,
    }), error => ['EVIDENCE', 'AUTH'].includes(error.code) &&
      error.details.dispatched === false && error.details.effect === 'no-write-effect');
    assert.equal(calls, 1);
  });
}

test('a genuine unchanged preflight authorization permits exactly one declared mutation', async () => {
  const calls = [];
  const transport = createGitHubTransport({
    connection: connection({
      credentialResolver: () => credential({ permissions: [{ name: 'issues', level: 'write' }] }),
    }),
    fetch: (url, init) => { calls.push({ url, method: init.method }); return response(); },
  });
  const source = await transport.execute(rest(transport));
  const write = rest(transport, {
    method: 'PATCH', payload: { state: 'closed' }, tokenClasses: ['fine-grained-pat'],
    permissions: [{ name: 'issues', level: 'write' }],
  });
  const result = await transport.execute(write, {
    actionAuthority: authority, authorizationSource: source,
  });
  assert.deepEqual(calls.map(call => call.method), ['GET', 'PATCH']);
  assert.deepEqual(result.dispatchIndication, authority);
  await assert.rejects(transport.execute(write, {
    actionAuthority: authority, authorizationSource: JSON.parse(JSON.stringify(source)),
  }), { code: 'EVIDENCE' });
  assert.equal(calls.length, 2);
});

for (const state of ['unknown', 'unavailable', 'omitted']) {
  test(`current ${state} entitlement cannot reuse an available preflight to dispatch`, async () => {
    let resolutions = 0;
    let mutations = 0;
    const transport = createGitHubTransport({
      connection: connection({
        credentialResolver: () => credential({
          permissions: [{ name: 'issues', level: 'write' }],
          entitlements: resolutions++ === 0 ? [{ name: 'projects-plan', state: 'available' }] :
            state === 'omitted' ? [] : [{ name: 'projects-plan', state }],
        }),
      }),
      fetch: (url, init) => {
        if (init.method === 'PATCH') mutations++;
        return response();
      },
    });
    const source = await transport.execute(rest(transport));
    const write = rest(transport, {
      method: 'PATCH', payload: { state: 'closed' }, tokenClasses: ['fine-grained-pat'],
      permissions: [{ name: 'issues', level: 'write' }],
    });
    await assert.rejects(transport.execute(write, {
      actionAuthority: authority, authorizationSource: source,
    }), error => error.code === 'ENTITLEMENT' &&
      error.details.dispatched === false && error.details.effect === 'no-write-effect');
    assert.equal(mutations, 0);
  });
}

test('construction performs no credential lookup, fetch or ambient authentication', async () => {
  let resolutionCount = 0;
  const calls = [];
  const authenticated = connection({ credentialResolver: async () => {
    resolutionCount++;
    return credential();
  } });
  const transport = createGitHubTransport({ connection: authenticated, fetch: async (...args) => {
    calls.push(args);
    return response();
  } });
  const request = rest(transport);
  assert.equal(resolutionCount, 0);
  assert.equal(calls.length, 0);
  const capture = await transport.execute(request);
  assert.equal(resolutionCount, 1);
  assert.equal(capture.status, 200);
  assert.equal(capture.finalUrl, `${api}${route}`);
  assert.deepEqual(capture.body, { id: 17 });
  assert.equal(calls[0][0], `${api}${route}`);
  assert.deepEqual(calls[0][1].headers, {
    accept: 'application/vnd.github+json', authorization: `Bearer ${token}`,
    'x-github-api-version': '2026-03-10',
  });
  assert.equal(calls[0][1].method, 'GET');
  assert.equal(calls[0][1].redirect, 'manual');
  assert.ok(calls[0][1].signal instanceof AbortSignal);
  assert.equal(capture.cacheIdentity.credentialGeneration, 'generation-1');
  assert.equal(capture.cacheIdentity.actorVisibility, 'actor-42-private');
  assert.equal(capture.complete, undefined);
  assert.equal(capture.status === 'Passed', false);
  assert.equal(JSON.stringify(capture).includes(token), false);
  assert.equal(JSON.stringify(authenticated).includes(token), false);
});

test('anonymous injection never falls back to GH_TOKEN, GITHUB_TOKEN or global fetch', async t => {
  process.env.GH_TOKEN = 'fixture-do-not-use-gh';
  process.env.GITHUB_TOKEN = 'fixture-do-not-use-github';
  t.after(() => {
    delete process.env.GH_TOKEN;
    delete process.env.GITHUB_TOKEN;
  });
  let captured;
  const transport = createGitHubTransport({ connection: connection(), request: async input => {
    captured = input;
    return response();
  } });
  await transport.execute(rest(transport));
  assert.equal(captured.headers.authorization, undefined);
  assert.throws(() => createGitHubTransport({ connection: connection() }), { code: 'INPUT' });
});

test('REST writes use the declared method and exact payload but never bind plaintext/ciphertext hashes', async () => {
  let captured;
  const transport = createGitHubTransport({ connection: connection(), fetch: async (url, init) => {
    captured = { url, ...init };
    return response({ id: 31, state: 'open' }, 201);
  } });
  const payload = { title: 'private-sensitive-prompt', encrypted_value: 'private-ciphertext', key_id: 'key-1' };
  const request = rest(transport, {
    method: 'POST', path: '/repos/fixture-owner/fixture-repo/issues',
    payload, expectedStatuses: [201], payloadSlot: 'protected-payload-1',
  });
  await assert.rejects(transport.execute(request), { code: 'AUTHORITY' });
  assert.equal(captured, undefined);
  const capture = await transport.execute(request, { actionAuthority: authority });
  assert.equal(captured.method, 'POST');
  assert.deepEqual(JSON.parse(captured.body), payload);
  assert.equal(captured.headers['content-type'], 'application/json');
  assert.equal(capture.requestIdentity.payloadSlot, 'protected-payload-1');
  assert.equal(JSON.stringify(request).includes('private'), false);
  assert.equal(JSON.stringify(capture).includes('private'), false);
  assert.equal(capture.body.state, 'open');
  assert.deepEqual(capture.dispatchIndication, authority);
});

test('capability permissions and entitlements are facts, not write authority', async () => {
  let calls = 0;
  const transport = createGitHubTransport({
    connection: connection({ credentialResolver: async () => credential({
      permissions: [{ name: 'issues', level: 'write' }],
      entitlements: [{ name: 'enterprise', state: 'available' }],
    }) }),
    fetch: async () => { calls++; return response(); },
  });
  await assert.rejects(transport.execute(rest(transport, { method: 'DELETE' })), { code: 'AUTHORITY' });
  assert.equal(calls, 0);
  const capture = await transport.execute(rest(transport));
  assert.deepEqual(capture.capabilityFacts, {
    permissions: [{ name: 'issues', level: 'write' }],
    entitlements: [{ name: 'enterprise', state: 'available' }],
  });
});

for (const [caseIndex, [status, code, headers]] of [
  [401, 'AUTH', {}], [403, 'PERMISSION', {}], [404, 'INACCESSIBLE', {}],
  [429, 'RATE_LIMIT', { 'retry-after': '60' }],
  [403, 'RATE_LIMIT', { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' }],
  [403, 'RATE_LIMIT', { 'retry-after': '120' }],
  [500, 'PROVIDER', {}], [202, 'CONTRACT', {}],
].entries()) {
  test(`HTTP ${status}/${code} case ${caseIndex} is explicit denial/contract failure, never absence or empty success`, async () => {
    const transport = createGitHubTransport({ connection: connection(), fetch: async () =>
      response({ message: 'private-sensitive-response', token }, status, headers) });
    await assert.rejects(transport.execute(rest(transport)), error => {
      assert.equal(error.code, code);
      assert.equal(error.details.status, status);
      assert.equal(JSON.stringify(error).includes('private-sensitive-response'), false);
      assert.equal(JSON.stringify(error).includes(token), false);
      return true;
    });
  });
}

test('an explicitly declared 202 captures acceptance facts without fabricating completion', async () => {
  const transport = createGitHubTransport({ connection: connection(), fetch: async () =>
    response({ accepted: true }, 202) });
  const capture = await transport.execute(rest(transport, {
    method: 'POST', expectedStatuses: [202],
  }), { actionAuthority: authority });
  assert.equal(capture.status, 202);
  assert.equal(capture.complete, undefined);
  assert.equal(capture.outcome, undefined);
});

test('the explicit legacy REST profile captures a 204 empty dispatch separately', async () => {
  let headers;
  const transport = createGitHubTransport({ connection: connection(), fetch: async (_, init) => {
    headers = init.headers;
    return response(null, 204);
  } });
  const capture = await transport.execute(rest(transport, {
    method: 'POST', path: '/repos/fixture-owner/fixture-repo/actions/workflows/23/dispatches',
    profile: '2022-11-28', payload: { ref: 'main' },
    expectedStatuses: [204], responseType: 'empty',
  }), { actionAuthority: authority });
  assert.equal(headers['x-github-api-version'], '2022-11-28');
  assert.equal(capture.body, null);
  assert.equal(capture.requestIdentity.apiVersion, '2022-11-28');
});

for (const [name, fake, code] of [
  ['malformed JSON', () => new Response('{"secret":', { headers: { 'content-type': 'application/json' } }), 'CONTRACT'],
  ['wrong JSON type', () => response('not-an-object'), 'CONTRACT'],
  ['login HTML', () => new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } }), 'CONTRACT'],
  ['declared oversized', () => response({}, 200, { 'content-length': '1000' }), 'RESPONSE_LIMIT'],
  ['streamed oversized', () => response({ content: 'x'.repeat(1000) }), 'RESPONSE_LIMIT'],
  ['malformed UTF-8', () => new Response(new Uint8Array([0xc3, 0x28]), { headers: { 'content-type': 'application/json' } }), 'CONTRACT'],
]) {
  test(`${name} fails the bounded response contract`, async () => {
    const transport = createGitHubTransport({ connection: connection(), fetch: async () => fake(), maxResponseBytes: 64 });
    await assert.rejects(transport.execute(rest(transport)), { code });
  });
}

test('raw provider bodies remain acquisition-only and cannot be mutated into cached facts', async () => {
  const transport = createGitHubTransport({ connection: connection(), fetch: async () =>
    response({ secret: 'sensitive-provider-content', nested: { id: 17 } }, 200, { etag: '"version-1"' }) });
  const capture = await transport.execute(rest(transport));
  assert.equal(capture.body.secret, 'sensitive-provider-content');
  assert.equal(JSON.stringify(capture).includes('sensitive-provider-content'), false);
  assert.throws(() => { capture.body.nested.id = 99; }, TypeError);
  assert.equal(capture.body.nested.id, 17);
});

for (const [pathIndex, path] of [
  'https://attacker.invalid/repos/a/b', '//attacker.invalid/x', '/repos/fixture-owner/other/issues',
  '/repos/fixture-owner/fixture-repo/../other', '/repos/fixture-owner/fixture-repo/%2e%2e/other',
  '/repos/fixture-owner/fixture-repo/issues?access_token=private',
  '/repos/fixture-owner/fixture-repo/issues?%2574oken=private',
  '/repos/fixture-owner/fixture-repo/issues?filter=token%3Dprivate',
  '/repos/fixture-owner/fixture-repo/issues#fragment', '/repos/fixture-owner/fixture-repo\\issues',
].entries()) {
  test(`unsafe/out-of-scope relative route is rejected: ${pathIndex}`, () => {
    const transport = createGitHubTransport({ connection: connection(), fetch: async () => response() });
    assert.throws(() => rest(transport, { path }), error => ['INPUT', 'SCOPE'].includes(error.code));
  });
}

for (const [originIndex, apiOrigin] of [
  'http://api.github.com', 'https://api.github.com.attacker.invalid/path',
  'https://user:password@api.github.com', 'https://api.github.com?token=private',
  'https://api.github.com/', 'https://api.github.com#fragment',
].entries()) {
  test(`connection rejects noncanonical origin ${originIndex}`, () => {
    assert.throws(() => connection({ apiOrigin }), { code: 'INPUT' });
  });
}

test('explicit organization and user scopes bind routes without becoming a user action grant', async () => {
  const transport = createGitHubTransport({
    connection: connection({ scopes: [
      { kind: 'organization', id: '31', login: 'fixture-org' },
      { kind: 'user', id: '42', login: 'fixture-user' },
    ] }), fetch: async () => response(),
  });
  for (const [path, proofScope] of [['/orgs/fixture-org/repos', 'organization:31'],
    ['/users/fixture-user/repos', 'user:42'], ['/user/notifications', 'user:42']]) {
    const capture = await transport.execute(rest(transport, { path, proofScope }));
    assert.equal(capture.requestIdentity.proofScope, proofScope);
  }
  assert.throws(() => rest(transport, { path: '/orgs/other/repos', proofScope: 'organization:31' }), { code: 'SCOPE' });
  assert.throws(() => rest(transport, { path: '/user/notifications', proofScope: 'organization:31' }), { code: 'SCOPE' });
});

test('enterprise origins require explicit reviewed profiles; no guessed version or latest', async () => {
  assert.throws(() => connection({ apiOrigin: 'https://enterprise.fixture.invalid',
    webOrigin: 'https://enterprise.fixture.invalid' }), { code: 'CONTRACT' });
  let acquired;
  const transport = createGitHubTransport({
    connection: connection({
      apiOrigin: 'https://enterprise.fixture.invalid', webOrigin: 'https://enterprise.fixture.invalid',
      apiPathPrefix: '/api/v3', graphqlPath: '/api/graphql',
      profiles: [{ id: 'enterprise-reviewed', kind: 'rest', apiVersion: null }],
    }),
    fetch: async (url, init) => { acquired = { url, ...init }; return response(); },
  });
  await transport.execute(rest(transport, { profile: 'enterprise-reviewed' }));
  assert.equal(acquired.url, `https://enterprise.fixture.invalid/api/v3${route}`);
  assert.equal(acquired.headers['x-github-api-version'], undefined);
  assert.throws(() => rest(transport, { profile: 'latest' }), { code: 'CONTRACT' });
  assert.throws(() => rest(transport, { profile: '2026-03-10' }), { code: 'CONTRACT' });
});

for (const [incompatibleIndex, incompatible] of [
  credential({ apiOrigin: 'https://other.invalid' }),
  credential({ tokenClass: 'app-installation' }),
  credential({ token: 'bad\r\nAuthorization: injected' }),
  credential({ generation: token }),
].entries()) {
  test(`incompatible credential origin, token class, header or generation case ${incompatibleIndex} is rejected before dispatch`, async () => {
    let calls = 0;
    const transport = createGitHubTransport({
      connection: connection({ credentialResolver: async () => incompatible }),
      fetch: async () => { calls++; return response(); },
    });
    await assert.rejects(transport.execute(rest(transport)), error => ['AUTH', 'INPUT'].includes(error.code));
    assert.equal(calls, 0);
  });
}

test('runtime option shapes and callbacks are closed; permissions/userScope cannot grant authority', async () => {
  const transport = createGitHubTransport({ connection: connection(), fetch: async () => response() });
  assert.throws(() => connection({ credentialResolver: 'load-from-repo.mjs' }), { code: 'INPUT' });
  assert.throws(() => createGitHubTransport({ connection: connection(), fetch: async () => response(),
    request: async () => response() }), { code: 'INPUT' });
  assert.throws(() => rest(transport, { expectedStatuses: [404] }), { code: 'INPUT' });
  await assert.rejects(transport.execute(rest(transport), { userScope: 'write' }), { code: 'INPUT' });
  await assert.rejects(transport.execute(rest(transport), { actionAuthority: { permissions: 'admin' } }), { code: 'INPUT' });
  await assert.rejects(transport.execute(rest(transport), { signal: {} }), { code: 'INPUT' });
});

test('unapproved redirects fail before another credential-bearing request', async () => {
  const calls = [];
  const transport = createGitHubTransport({
    connection: connection({ credentialResolver: async () => credential() }),
    fetch: async (url, init) => { calls.push({ url, ...init }); return new Response(null, {
      status: 302, headers: { location: 'https://attacker.invalid/steal' },
    }); },
  });
  await assert.rejects(transport.execute(rest(transport)), { code: 'REDIRECT' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.authorization, `Bearer ${token}`);
});

test('a fetch that already followed an unsafe final URL is rejected instead of trusted', async () => {
  const transport = createGitHubTransport({ connection: connection(), fetch: async () => ({
    status: 200, url: 'https://attacker.invalid/x', redirected: true,
    headers: new Headers(), body: null,
  }) });
  await assert.rejects(transport.execute(rest(transport)), { code: 'REDIRECT' });
});

test('archive acquisition strips auth/version headers and protects signed URLs in a separate bounded stream', async () => {
  const calls = [];
  const transient = 'https://archives.fixture.invalid/file.zip?X-Amz-Signature=private-signed-value';
  const transport = createGitHubTransport({
    connection: connection({
      archiveOrigins: ['https://archives.fixture.invalid'],
      credentialResolver: async () => credential(),
    }),
    fetch: async (url, init) => {
      calls.push({ url, ...init });
      return calls.length === 1 ? new Response(null, { status: 302, headers: { location: transient } }) :
        new Response(new Uint8Array([80, 75, 3, 4]), { headers: { 'content-type': 'application/zip' } });
    },
  });
  const request = rest(transport, {
    path: '/repos/fixture-owner/fixture-repo/actions/artifacts/31/zip', responseType: 'bytes',
  });
  const capture = await transport.downloadArchive(request);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].headers.authorization, `Bearer ${token}`);
  assert.deepEqual(calls[1].headers, { accept: 'application/octet-stream' });
  assert.equal(calls[1].redirect, 'manual');
  assert.equal(capture.finalUrl, transient);
  assert.equal(capture.finalOrigin, 'https://archives.fixture.invalid');
  assert.equal(JSON.stringify(capture).includes('private-signed-value'), false);
  assert.deepEqual([...new Uint8Array(await new Response(capture.bodyStream).arrayBuffer())], [80, 75, 3, 4]);
});

for (const [targetIndex, target] of [
  'https://archives.fixture.invalid.attacker.invalid/file',
  'http://archives.fixture.invalid/file', 'https://user:password@archives.fixture.invalid/file',
  `${api}/repos/other/repo/actions/artifacts/31/zip`,
  `https://archives.fixture.invalid/file?token=${token}`,
].entries()) {
  test(`archive refuses untrusted origins, unsafe URLs and forwarding its API token case ${targetIndex}`, async () => {
    let calls = 0;
    const transport = createGitHubTransport({
      connection: connection({ archiveOrigins: ['https://archives.fixture.invalid'],
        credentialResolver: async () => credential() }),
      fetch: async () => { calls++; return new Response(null, { status: 302, headers: { location: target } }); },
    });
    await assert.rejects(transport.downloadArchive(rest(transport, { responseType: 'bytes' })),
      error => ['INPUT', 'REDIRECT'].includes(error.code));
    assert.equal(calls, 1);
  });
}

test('REST pagination preserves exact filters, page captures and authentication context', async () => {
  const calls = [];
  const second = `${api}${route}&page=2`;
  const transport = createGitHubTransport({ connection: connection(), fetch: async url => {
    calls.push(url);
    return calls.length === 1 ? response([{ id: 17 }], 200, { link: `<${second}>; rel="next"` }) :
      response([{ id: 18 }]);
  } });
  const result = await transport.paginateRest(rest(transport));
  assert.deepEqual(calls, [`${api}${route}`, second]);
  assert.deepEqual(result.pages.map(page => page.body), [[{ id: 17 }], [{ id: 18 }]]);
  assert.deepEqual(result.pagination, { complete: true, pageCount: 2 });
  assert.equal(result.pages[1].requestIdentity.proofScope, 'repository:17');
});

for (const [name, link, maxPages] of [
  ['other origin', `<https://attacker.invalid${route}&page=2>; rel="next"`],
  ['changed filters', `<${api}/repos/fixture-owner/fixture-repo/issues?state=closed&per_page=2&page=2>; rel="next"`],
  ['changed resource', `<${api}/repos/fixture-owner/fixture-repo/pulls?state=open&per_page=2&page=2>; rel="next"`],
  ['malformed link', 'not-a-link'],
  ['cycle', `<${api}${route}>; rel="next"`],
  ['bounded pages', `<${api}${route}&page=2>; rel="next"`, 1],
  ['duplicate next', `<${api}${route}&page=2>; rel="next", <${api}${route}&page=3>; rel="next"`],
]) {
  test(`REST pagination rejects ${name} without a false complete result`, async () => {
    let calls = 0;
    const transport = createGitHubTransport({ connection: connection(), fetch: async () => {
      calls++;
      return response([], 200, { link });
    } });
    await assert.rejects(transport.paginateRest(rest(transport), maxPages ? { maxPages } : {}),
      error => ['INPUT', 'CONTRACT', 'PROOF_GAP'].includes(error.code));
    assert.equal(calls, 1);
  });
}

test('304 reuses only exact-context ETag facts and keeps the old observation version', async () => {
  const calls = [];
  const transport = createGitHubTransport({ connection: connection(), fetch: async (_, init) => {
    calls.push(init);
    return calls.length === 1 ? response({ id: 17 }, 200, { etag: '"etag-1"' }) : response(null, 304);
  } });
  const request = rest(transport);
  const original = await transport.execute(request);
  const cacheEntry = transport.createCacheEntry(original, { observationVersion: 'observation-1' });
  const capture = await transport.execute(request, { cacheEntry });
  assert.equal(calls[1].headers['if-none-match'], '"etag-1"');
  assert.deepEqual(capture.body, original.body);
  assert.equal(capture.status, 304);
  assert.equal(capture.source, 'conditional-cache');
  assert.equal(capture.observationVersion, 'observation-1');
  assert.equal(capture.observedAt, undefined);
});

for (const change of ['request', 'profile', 'generation', 'visibility', 'connection', 'forged-entry']) {
  test(`cache isolation rejects a changed ${change} before conditional dispatch`, async () => {
    let generation = 'generation-1';
    let actorVisibility = 'actor-42-private';
    let calls = 0;
    const transport = createGitHubTransport({
      connection: connection({ credentialResolver: async () => credential({ generation, actorVisibility }) }),
      fetch: async () => { calls++; return response({}, 200, { etag: '"etag-1"' }); },
    });
    const request = rest(transport);
    const cacheEntry = transport.createCacheEntry(await transport.execute(request), { observationVersion: 'observation-1' });
    let targetTransport = transport;
    let targetRequest = request;
    let targetEntry = cacheEntry;
    if (change === 'request') targetRequest = rest(transport, { path: `${route}&page=2` });
    if (change === 'profile') targetRequest = rest(transport, { profile: '2022-11-28' });
    if (change === 'generation') generation = 'generation-2';
    if (change === 'visibility') actorVisibility = 'actor-99-private';
    if (change === 'connection') {
      targetTransport = createGitHubTransport({
        connection: connection({ id: 'other-connection' }),
        fetch: async () => { calls++; return response(null, 304); },
      });
      targetRequest = rest(targetTransport);
    }
    if (change === 'forged-entry') targetEntry = structuredClone(cacheEntry);
    await assert.rejects(targetTransport.execute(targetRequest, { cacheEntry: targetEntry }), { code: 'CACHE_GAP' });
    assert.equal(calls, 1);
  });
}

test('304 without cache or with a contradictory ETag is a proof gap', async () => {
  let calls = 0;
  const transport = createGitHubTransport({ connection: connection(), fetch: async () => {
    calls++;
    return calls === 2 ? response({}, 200, { etag: '"etag-1"' }) :
      response(null, 304, { etag: '"etag-2"' });
  } });
  const request = rest(transport);
  await assert.rejects(transport.execute(request), { code: 'CACHE_GAP' });
  const cacheEntry = transport.createCacheEntry(await transport.execute(request), { observationVersion: 'observation-1' });
  await assert.rejects(transport.execute(request, { cacheEntry }), { code: 'CACHE_GAP' });
});

test('GraphQL uses a named static document, explicit variables and a real schema profile without a REST header', async () => {
  let acquired;
  const transport = createGitHubTransport({ connection: graphqlConnection(), request: async input => {
    acquired = input;
    return response(gqlBody());
  } });
  const capture = await transport.execute(graphql(transport, { document: () => document }));
  assert.equal(acquired.url, `${api}/graphql`);
  assert.equal(acquired.method, 'POST');
  assert.equal(acquired.headers['x-github-api-version'], undefined);
  assert.deepEqual(JSON.parse(acquired.body), {
    query: document, operationName: 'ReadIssues', variables: { owner: 'fixture-owner', after: null },
  });
  assert.equal(capture.requestIdentity.schemaVersion, 'schema-2026-03');
  assert.equal(capture.requestIdentity.documentId, 'issues-read-v1');
  assert.equal(capture.body.data.repository.issues.nodes[0].id, 'I_17');
  assert.equal(JSON.stringify(capture).includes('fixture-owner'), false);
});

for (const [bodyIndex, body] of [
  gqlBody(null, false, { errors: [{ message: 'private-graphql-error', extensions: { token } }] }),
  { errors: [{ message: 'private-graphql-error' }] },
  { data: null }, { data: { repository: null } }, { data: { repository: { issues: { nodes: [42], pageInfo: {} } } } },
].entries()) {
  test(`GraphQL errors, partial data and failed mandatory typed selections case ${bodyIndex} cannot become complete facts`, async () => {
    const transport = createGitHubTransport({ connection: graphqlConnection(), fetch: async () => response(body) });
    await assert.rejects(transport.execute(graphql(transport)), error => {
      assert.ok(['GRAPHQL', 'CONTRACT'].includes(error.code));
      assert.equal(JSON.stringify(error).includes('private-graphql-error'), false);
      assert.equal(JSON.stringify(error).includes(token), false);
      return true;
    });
  });
}

test('GraphQL schema/document contracts reject unknown profiles, multiple operations and async validators', async () => {
  const transport = createGitHubTransport({ connection: graphqlConnection(), fetch: async () => response(gqlBody()) });
  assert.throws(() => graphql(transport, { schemaProfile: 'latest' }), { code: 'CONTRACT' });
  assert.throws(() => graphql(transport, { document: `${document}\nmutation Write { update { id } }` }), { code: 'CONTRACT' });
  assert.throws(() => graphql(transport, { operationKind: 'mutation' }), { code: 'CONTRACT' });
  assert.throws(() => graphql(transport, { validateData: 'from-repository' }), { code: 'INPUT' });
  assert.throws(() => graphql(transport, { validateData: async () => true }), { code: 'INPUT' });
});

test('GraphQL cursor acquisition changes only the cursor and preserves exact query/scope/schema', async () => {
  const bodies = [];
  const transport = createGitHubTransport({ connection: graphqlConnection(), fetch: async (_, init) => {
    bodies.push(JSON.parse(init.body));
    return response(gqlBody(bodies.length === 1 ? 'cursor-1' : 'cursor-2', bodies.length === 1));
  } });
  const result = await transport.paginateGraphQL(graphql(transport), {
    cursorVariable: 'after', readPageInfo: pageInfo,
  });
  assert.deepEqual(bodies.map(body => body.variables), [
    { owner: 'fixture-owner', after: null }, { owner: 'fixture-owner', after: 'cursor-1' },
  ]);
  assert.deepEqual(result.pagination, { complete: true, pageCount: 2 });
  assert.equal(result.pages[1].requestIdentity.documentId, 'issues-read-v1');
  assert.equal(result.pages[1].requestIdentity.proofScope, 'repository:17');
  assert.equal(result.pages[1].requestIdentity.schemaVersion, 'schema-2026-03');
});

for (const [cursorIndex, [cursor, maxPages, expectedCalls]] of [['same-cursor', 5, 2], [null, 5, 1], ['cursor-1', 1, 1]].entries()) {
  test(`GraphQL rejects cyclic, absent or unbounded cursors case ${cursorIndex} without partial success`, async () => {
    let calls = 0;
    const transport = createGitHubTransport({ connection: graphqlConnection(), fetch: async () => {
      calls++;
      return response(gqlBody(cursor, true));
    } });
    await assert.rejects(transport.paginateGraphQL(graphql(transport), {
      cursorVariable: 'after', readPageInfo: pageInfo, maxPages,
    }), { code: 'PROOF_GAP' });
    assert.equal(calls, expectedCalls);
  });
}

test('GraphQL mutations require outer dispatch authority and are never automatically retried', async () => {
  let calls = 0;
  const transport = createGitHubTransport({ connection: graphqlConnection(), fetch: async () => {
    calls++;
    throw new Error(`private-message ${token}`);
  } });
  const request = graphql(transport, {
    documentId: 'issue-write-v1', document: 'mutation ChangeIssue($input: UpdateIssueInput!) { updateIssue(input: $input) { issue { id } } }',
    operationName: 'ChangeIssue', operationKind: 'mutation',
    variables: { input: { id: 'I_17', title: 'sensitive-prompt' } },
  });
  await assert.rejects(transport.execute(request), { code: 'AUTHORITY' });
  assert.equal(calls, 0);
  await assert.rejects(transport.execute(request, { actionAuthority: authority }), error => {
    assert.equal(error.code, 'TRANSPORT');
    assert.equal(error.details.effect, 'uncertain-effect');
    assert.equal(JSON.stringify(error).includes(token), false);
    return true;
  });
  assert.equal(calls, 1);
});

test('pre-dispatch cancellation makes no credential lookup or external request', async () => {
  let calls = 0;
  let resolutions = 0;
  const controller = new AbortController();
  controller.abort(new Error('private-cancellation-reason'));
  const transport = createGitHubTransport({
    connection: connection({ credentialResolver: async () => { resolutions++; return credential(); } }),
    fetch: async () => { calls++; return response(); },
  });
  await assert.rejects(transport.execute(rest(transport), { signal: controller.signal }), error => {
    assert.equal(error.code, 'CANCELLED');
    assert.equal(error.details.dispatched, false);
    assert.equal(JSON.stringify(error).includes('private-cancellation-reason'), false);
    return true;
  });
  assert.equal(calls, 0);
  assert.equal(resolutions, 0);
});

test('post-dispatch cancellation propagates AbortSignal and preserves write uncertainty without retry', async () => {
  const controller = new AbortController();
  let injectedSignal;
  let calls = 0;
  const transport = createGitHubTransport({ connection: connection(), fetch: async (_, init) => {
    calls++;
    injectedSignal = init.signal;
    controller.abort();
    return new Promise(() => {});
  } });
  await assert.rejects(transport.execute(rest(transport, { method: 'PATCH', payload: { state: 'closed' } }), {
    signal: controller.signal, actionAuthority: authority,
  }), error => {
    assert.equal(error.code, 'CANCELLED');
    assert.equal(error.details.effect, 'uncertain-effect');
    assert.equal(error.details.dispatched, true);
    return true;
  });
  assert.equal(injectedSignal.aborted, true);
  assert.equal(calls, 1);
});

test('timeout rejects even an injected request that ignores abort; a dispatched write is uncertain', async () => {
  let calls = 0;
  let injectedSignal;
  const transport = createGitHubTransport({ connection: connection(), fetch: async (_, init) => {
    calls++;
    injectedSignal = init.signal;
    return new Promise(() => {});
  } });
  await assert.rejects(transport.execute(rest(transport, { method: 'DELETE' }), {
    timeoutMs: 10, actionAuthority: authority,
  }), error => {
    assert.equal(error.code, 'TIMEOUT');
    assert.equal(error.details.effect, 'uncertain-effect');
    return true;
  });
  assert.equal(injectedSignal.aborted, true);
  assert.equal(calls, 1);
});

test('response stream cancellation is observed and owned reader cleanup runs', async () => {
  const controller = new AbortController();
  let cancelled = false;
  const transport = createGitHubTransport({ connection: connection(), fetch: async () =>
    new Response(new ReadableStream({
      pull() { controller.abort(); },
      cancel() { cancelled = true; },
    }), { headers: { 'content-type': 'application/json' } }) });
  await assert.rejects(transport.execute(rest(transport), { signal: controller.signal }), { code: 'CANCELLED' });
  assert.equal(cancelled, true);
});

test('injected errors and allowed response headers are sanitized without raw low-entropy hashes', async () => {
  const authenticated = connection({ credentialResolver: async () => credential() });
  const transport = createGitHubTransport({ connection: authenticated, fetch: async () => {
    throw new SdlcError('INPUT', `private-message ${token}`, { token, payload: 'private-payload' });
  } });
  await assert.rejects(transport.execute(rest(transport)), error => {
    assert.equal(error.code, 'TRANSPORT');
    assert.equal(JSON.stringify(error).includes(token), false);
    assert.equal(JSON.stringify(error).includes('private-payload'), false);
    return true;
  });
  const other = createGitHubTransport({ connection: authenticated, fetch: async () => response({}, 200, {
    'x-github-request-id': token, 'set-cookie': `session=${token}`,
    link: '<https://api.github.com/x?api_key=private-value>; rel="next"',
  }) });
  const capture = await other.execute(rest(other));
  assert.equal(capture.headers['set-cookie'], undefined);
  assert.equal(capture.headers['x-github-request-id'], '[redacted]');
  assert.equal(capture.headers.link, '[redacted]');
  assert.equal(JSON.stringify(capture).includes(token), false);
  assert.equal(JSON.stringify(capture).includes('private-value'), false);
});

test('response and request byte bounds enforce the exact boundary, not merely a large fixture', async () => {
  const bytes = Buffer.byteLength('{"id":17}');
  const exact = createGitHubTransport({
    connection: connection(), maxResponseBytes: bytes, fetch: async () => response({ id: 17 }),
  });
  assert.deepEqual((await exact.execute(rest(exact))).body, { id: 17 });
  const over = createGitHubTransport({
    connection: connection(), maxResponseBytes: bytes - 1, fetch: async () => response({ id: 17 }),
  });
  await assert.rejects(over.execute(rest(over)), { code: 'RESPONSE_LIMIT' });
  const payload = { title: 'private-prompt' };
  const payloadBytes = Buffer.byteLength(JSON.stringify(payload));
  const bounded = createGitHubTransport({
    connection: connection(), maxRequestBytes: payloadBytes, fetch: async () => response(),
  });
  assert.equal(rest(bounded, { method: 'POST', payload }).requestIdentity.protocol, 'rest');
  assert.throws(() => rest(bounded, {
    method: 'POST', payload: { title: 'private-prompt!' },
  }), error => {
    assert.equal(error.code, 'INPUT');
    assert.equal(error.message.includes('private-prompt'), false);
    return true;
  });
});

test('cache invalidation rejects retained entries and retained pre-write captures', async () => {
  let calls = 0;
  const transport = createGitHubTransport({ connection: connection(), fetch: async () => {
    calls++;
    return response({ id: 17 }, 200, { etag: '"etag-1"' });
  } });
  const request = rest(transport);
  const capture = await transport.execute(request);
  const cacheEntry = transport.createCacheEntry(capture, { observationVersion: 'observation-1' });
  transport.invalidateCache({ proofScope: 'repository:17' });
  await assert.rejects(transport.execute(request, { cacheEntry }), { code: 'CACHE_GAP' });
  assert.throws(() => transport.createCacheEntry(capture, {
    observationVersion: 'observation-2',
  }), { code: 'CACHE_GAP' });
  assert.equal(calls, 1);
  const next = transport.createCacheEntry(await transport.execute(request), {
    observationVersion: 'observation-3',
  });
  await transport.execute(rest(transport, { method: 'DELETE' }), { actionAuthority: authority });
  await assert.rejects(transport.execute(request, { cacheEntry: next }), { code: 'CACHE_GAP' });
  assert.equal(calls, 3);
});

test('an uncertain write invalidates mutable caches without automatically repeating the mutation', async () => {
  let calls = 0;
  const transport = createGitHubTransport({ connection: connection(), fetch: async (_, init) => {
    calls++;
    if (init.method === 'PATCH') throw new Error('lost write response');
    return response({}, 200, { etag: '"etag-1"' });
  } });
  const request = rest(transport);
  const cacheEntry = transport.createCacheEntry(await transport.execute(request), {
    observationVersion: 'observation-1',
  });
  await assert.rejects(transport.execute(rest(transport, { method: 'PATCH' }), {
    actionAuthority: authority,
  }), { code: 'TRANSPORT' });
  await assert.rejects(transport.execute(request, { cacheEntry }), { code: 'CACHE_GAP' });
  assert.equal(calls, 2);
});

test('304 cannot gain currentness when an event invalidates the cache during acquisition', async () => {
  let calls = 0;
  let transport;
  transport = createGitHubTransport({ connection: connection(), fetch: async () => {
    calls++;
    if (calls === 1) return response({}, 200, { etag: '"etag-1"' });
    transport.invalidateCache();
    return response(null, 304);
  } });
  const request = rest(transport);
  const cacheEntry = transport.createCacheEntry(await transport.execute(request), {
    observationVersion: 'observation-1',
  });
  await assert.rejects(transport.execute(request, { cacheEntry }), { code: 'CACHE_GAP' });
});

test('in-flight reads invalidated by host facts remain observations, not valid cache seeds', async () => {
  let transport;
  transport = createGitHubTransport({ connection: connection(), fetch: async () => {
    transport.invalidateCache();
    return response({}, 200, { etag: '"etag-1"' });
  } });
  const capture = await transport.execute(rest(transport));
  assert.equal(capture.status, 200);
  assert.throws(() => transport.createCacheEntry(capture, {
    observationVersion: 'observation-1',
  }), { code: 'CACHE_GAP' });
});

for (const protocol of ['rest', 'graphql']) {
  test(`${protocol} pagination rejects actor/credential generation changes before the second page`, async () => {
    let resolutions = 0;
    let calls = 0;
    const transport = createGitHubTransport({
      connection: graphqlConnection({ credentialResolver: async () => {
        resolutions++;
        return credential({ generation: `generation-${resolutions}` });
      } }),
      fetch: async () => {
        calls++;
        return protocol === 'rest' ? response([], 200, {
          link: `<${api}${route}&page=2>; rel="next"`,
        }) : response(gqlBody('cursor-1', true));
      },
    });
    const acquisition = protocol === 'rest' ? transport.paginateRest(rest(transport)) :
      transport.paginateGraphQL(graphql(transport, { tokenClasses: ['fine-grained-pat'] }), {
        cursorVariable: 'after', readPageInfo: pageInfo,
      });
    await assert.rejects(acquisition, { code: 'PROOF_GAP' });
    assert.equal(resolutions, 2);
    assert.equal(calls, 1);
  });
}

test('cancellation between pagination pages prevents another external call', async () => {
  const controller = new AbortController();
  let calls = 0;
  const transport = createGitHubTransport({ connection: graphqlConnection(), fetch: async () => {
    calls++;
    return response(gqlBody('cursor-1', true));
  } });
  await assert.rejects(transport.paginateGraphQL(graphql(transport), {
    signal: controller.signal, cursorVariable: 'after',
    readPageInfo: data => { controller.abort(); return pageInfo(data); },
  }), { code: 'CANCELLED' });
  assert.equal(calls, 1);
});

for (const [status, code] of [[403, 'PERMISSION'], [302, 'REDIRECT'], [500, 'PROVIDER']]) {
  test(`cleanup failure preserves the primary ${code} category and reports the additional gap`, async () => {
    const transport = createGitHubTransport({ connection: connection(), fetch: async () => ({
      status, url: '', redirected: false, headers: new Headers(),
      body: { cancel: async () => { throw new Error(`private-cleanup ${token}`); } },
    }) });
    await assert.rejects(transport.execute(rest(transport)), error => {
      assert.equal(error.code, code);
      assert.equal(error.details.cleanupFailed, true);
      assert.equal(JSON.stringify(error).includes(token), false);
      assert.equal(JSON.stringify(error).includes('private-cleanup'), false);
      return true;
    });
  });
}

test('GraphQL partial data is explicitly identified without copying its fields or error messages', async () => {
  const transport = createGitHubTransport({ connection: graphqlConnection(), fetch: async () =>
    response(gqlBody(null, false, { errors: [{ message: 'sensitive-details', path: ['repository'] }] })) });
  await assert.rejects(transport.execute(graphql(transport)), error => {
    assert.equal(error.code, 'GRAPHQL');
    assert.equal(error.details.partialDataPresent, true);
    assert.equal(JSON.stringify(error).includes('sensitive-details'), false);
    assert.equal(error.details.data, undefined);
    return true;
  });
});

test('mutating original factory options cannot replace an established transport capability', async () => {
  let calls = 0;
  const options = {
    connection: connection(), fetch: async () => { calls++; return response(); },
  };
  const transport = createGitHubTransport(options);
  options.fetch = async () => { throw new Error('replaced callback'); };
  options.timeoutMs = -1;
  assert.equal((await transport.execute(rest(transport))).status, 200);
  assert.equal(calls, 1);
});

test('anonymous-only credentials never satisfy a user-token-only endpoint', async () => {
  let calls = 0;
  const transport = createGitHubTransport({ connection: connection(), fetch: async () => {
    calls++;
    return response();
  } });
  await assert.rejects(transport.execute(rest(transport, {
    tokenClasses: ['classic-pat', 'oauth'],
  })), { code: 'AUTH' });
  assert.equal(calls, 0);
});

test('fetch-like header callbacks cannot smuggle provider secrets through an existing SdlcError', async () => {
  const transport = createGitHubTransport({ connection: connection(), fetch: async () => ({
    status: 200, url: '', body: null,
    headers: { get() { throw new SdlcError('CONTRACT', token, { payload: 'private-response' }); } },
  }) });
  await assert.rejects(transport.execute(rest(transport)), error => {
    assert.equal(error.code, 'TRANSPORT');
    assert.equal(error.message.includes(token), false);
    assert.equal(JSON.stringify(error).includes('private-response'), false);
    return true;
  });
});

test('failing owned reader cancellation still releases the lock and preserves the response-limit error', async () => {
  let released = false;
  const transport = createGitHubTransport({ connection: connection(), maxResponseBytes: 8, fetch: async () => ({
    status: 200, url: '', headers: new Headers({ 'content-type': 'application/json' }),
    body: {
      getReader() {
        return {
          read: async () => ({ done: false, value: new Uint8Array(9) }),
          cancel: async () => { throw new Error(`private-cleanup ${token}`); },
          releaseLock() { released = true; },
        };
      },
    },
  }) });
  await assert.rejects(transport.execute(rest(transport)), error => {
    assert.equal(error.code, 'RESPONSE_LIMIT');
    assert.equal(error.details.cleanupFailed, true);
    assert.equal(JSON.stringify(error).includes(token), false);
    return true;
  });
  assert.equal(released, true);
});
