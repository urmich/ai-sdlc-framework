import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Store } from 'ai-sdlc-framework/store';
import { providerAdapterIds } from 'ai-sdlc-framework/provider-adapters';
import {
  createGitHubConnection, createGitHubHost, createGitHubStore, createGitHubTransport,
} from 'ai-sdlc-framework/github';

function hostFixture() {
  const noCall = () => assert.fail('Construction must not acquire credentials or call the provider');
  const connection = createGitHubConnection({
    id: 'fixture-connection', apiOrigin: 'https://api.github.com', webOrigin: 'https://github.com',
    scopes: [{ kind: 'repository', id: '101', owner: 'fixture', name: 'sample' }],
    credentialResolver: noCall,
  });
  const transport = createGitHubTransport({ connection, fetch: noCall });
  const host = createGitHubHost({ connections: [{ connection, transport }], identifier: noCall });
  return { connection, transport, host };
}

test('trusted host construction neither registers nor resolves credentials or calls GitHub', () => {
  const before = providerAdapterIds();
  const { host } = hostFixture();
  assert.deepEqual(providerAdapterIds(), before);
  assert.deepEqual(Object.keys(host).sort(),
    ['adapterContract', 'legacyOperations', 'missingVerifiers', 'storeOptions']);
  assert.deepEqual(Object.keys(host.legacyOperations).sort(),
    ['claimDispatch', 'prepare', 'reconcile', 'recordResult']);
  assert.deepEqual(host.adapterContract, {
    adapterId: 'github-existing-consumer', propagatesUniqueCallId: true,
    dispatchIdField: 'dispatch.hostCallId', resultIdField: 'observation.causalProof.hostCallId',
  });
});

test('Store factory is synchronous and preserves the exact selected home and original host brand', () => {
  const { host } = hostFixture();
  const home = path.resolve('fixture selected home');
  const store = createGitHubStore(home, host);
  assert.ok(store instanceof Store);
  assert.equal(store.home, home);
  assert.equal(typeof store.then, 'undefined');
  for (const forged of [{}, { ...host }, JSON.parse(JSON.stringify(host))]) {
    assert.throws(() => createGitHubStore(home, forged), { code: 'ADAPTER' });
  }
});

test('JSON cannot install executable verifiers or resurrect native host services', () => {
  for (const key of ['operations', 'runner', 'recoveryService', 'exportReceipt']) {
    assert.throws(() => createGitHubHost({ [key]: [] }), { code: 'INPUT' });
  }
  for (const callback of [true, { trusted: true }, { module: 'repository-controlled.mjs' }]) {
    assert.throws(() => createGitHubHost({ verifiers: { verifyRepository: callback } }), { code: 'ADAPTER' });
  }
  assert.throws(() => createGitHubHost({ authorize: true }), { code: 'ADAPTER' });
});

test('host rejects copied connections, duplicate IDs and foreign transports before acquisition', () => {
  const f = hostFixture();
  const other = createGitHubConnection({
    id: 'other-connection', apiOrigin: 'https://api.github.com', webOrigin: 'https://github.com',
    scopes: [{ kind: 'repository', id: '101', owner: 'fixture', name: 'sample' }],
  });
  const transport = createGitHubTransport({
    connection: other, fetch: () => assert.fail('Foreign construction must not acquire facts'),
  });
  assert.throws(() => createGitHubHost({
    connections: [{ connection: f.connection, transport }],
  }), { code: 'ADAPTER' });
  assert.throws(() => createGitHubHost({
    connections: [{ connection: { ...f.connection }, transport: f.transport }],
  }), { code: 'INPUT' });
  assert.throws(() => createGitHubHost({
    connections: [1, 2].map(() => ({ connection: f.connection, transport: f.transport })),
  }), { code: 'ADAPTER' });
});

test('all six absent acquisitions reject explicitly rather than trusting supplied provider facts', async t => {
  const { host } = hostFixture();
  const identity = { provider: 'github', connection: 'fixture-connection', scopeRef: 'repository:101',
    definitionRef: '301', executionRef: '401', attemptKind: 'known', attemptRef: '2' };
  const inputs = {
    verifyRepository: { provider: 'github', localRepositoryPath: path.resolve('fixture'),
      remoteRepositoryURL: 'https://github.com/fixture/sample.git', adapterObservation: { trusted: true } },
    verifyPullRequest: { provider: 'github', localRepositoryPath: path.resolve('fixture'),
      remoteRepositoryURL: 'https://github.com/fixture/sample.git', adapterObservation: { trusted: true } },
    verifyCheckResults: { identity, status: 'succeeded', evidenceReference: { ref: 'fixture:check' } },
    verifyOperationResult: { operation: { intendedOutcome: { family: 'execution' } }, observedResult: 'not-acquired' },
    verifyArtifact: { operation: { resultProof: { status: 'succeeded', executionIdentity: identity } },
      observation: { trusted: true } },
    verifyProviderVersion: { locator: 'fixture:bytes', retrievalContext: { provider: 'github' },
      immutableVersion: 'v1', bytes: Buffer.from('actual isolated bytes') },
  };
  assert.deepEqual(host.missingVerifiers, Object.keys(inputs));
  const verifiers = host.storeOptions();
  for (const [name, input] of Object.entries(inputs)) {
    await t.test(name, async () => {
      await assert.rejects(verifiers[name](input), { code: 'ADAPTER' });
    });
  }
});

test('real transport retains encoded label delimiters as opaque path data', async () => {
  const connection = createGitHubConnection({
    id: 'encoded-labels', apiOrigin: 'https://api.github.com', webOrigin: 'https://github.com',
    scopes: [{ kind: 'repository', id: '101', owner: 'fixture', name: 'sample' }],
  });
  const calls = [];
  const transport = createGitHubTransport({
    connection, async fetch(url) {
      calls.push(url);
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    },
  });
  for (const label of ['C#', 'question?']) {
    await transport.execute(transport.buildRestRequest({
      method: 'GET', path: `/repos/fixture/sample/labels/${encodeURIComponent(label)}`,
      profile: '2026-03-10', mediaType: 'application/vnd.github+json', expectedStatuses: [200],
      proofScope: 'repository:101', tokenClasses: ['anonymous'],
    }));
  }
  assert.deepEqual(calls, [
    'https://api.github.com/repos/fixture/sample/labels/C%23',
    'https://api.github.com/repos/fixture/sample/labels/question%3F',
  ]);
  for (const invalid of [
    '/repos/fixture/sample/labels/C#fragment',
    '/repos/fixture/sample/labels/%252e%252e/foreign',
    '/repos/fixture/sample/labels/C?access_token=fixture-only',
  ]) assert.throws(() => transport.buildRestRequest({
    method: 'GET', path: invalid, profile: '2026-03-10', mediaType: 'application/vnd.github+json',
    expectedStatuses: [200], proofScope: 'repository:101', tokenClasses: ['anonymous'],
  }), { code: 'INPUT' });
});
