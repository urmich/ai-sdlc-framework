import test from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubConnection } from '../src/github/connection.mjs';
import {
  createGitHubTransport, requireGitHubCapture, requireGitHubRequestBinding,
} from '../src/github/transport.mjs';

function setup(body, status = 200) {
  const connection = createGitHubConnection({
    id: 'binding-fixture', apiOrigin: 'https://api.github.com', webOrigin: 'https://github.com',
    scopes: [{ kind: 'repository', id: '101', owner: 'fixture', name: 'sample' }],
    profiles: [
      { id: '2026-03-10', kind: 'rest', apiVersion: '2026-03-10' },
      { id: 'graphql-reviewed', kind: 'graphql', schemaVersion: 'reviewed-v1' },
    ],
  });
  const transport = createGitHubTransport({
    connection,
    fetch: async () => new Response(body, {
      status, headers: status === 204 ? {} : { 'content-type': 'application/json' },
    }),
  });
  return { connection, transport };
}
const read = {
  method: 'GET', path: '/repos/fixture/sample', profile: '2026-03-10',
  mediaType: 'application/vnd.github+json', expectedStatuses: [200],
  proofScope: 'repository:101', tokenClasses: ['anonymous'],
};

test('only actual acquisition objects carry connection-owned response provenance', async () => {
  const { connection, transport } = setup('{}');
  const capture = await transport.execute(transport.buildRestRequest(read));
  assert.equal(requireGitHubCapture(capture, connection), capture);
  assert.throws(() => requireGitHubCapture({ ...capture }, connection), { code: 'EVIDENCE' });
  assert.throws(() => requireGitHubCapture(JSON.parse(JSON.stringify(capture)), connection), { code: 'EVIDENCE' });
});

test('private mutation binding rejects a different actual payload despite matching public request metadata', async () => {
  const { transport } = setup('{}');
  const actual = { ...read, method: 'POST', payload: { auto_inactive: true } };
  const capture = await transport.execute(transport.buildRestRequest(actual), {
    actionAuthority: { operationId: 'op-fixture', authorityRef: 'grant-fixture', dispatchClaimId: 'call-fixture' },
  });
  assert.equal(requireGitHubRequestBinding(capture, actual), capture);
  assert.throws(() => requireGitHubRequestBinding(capture, {
    ...actual, payload: { auto_inactive: false },
  }), { code: 'EVIDENCE' });
});

test('private GraphQL binding joins both the executed document and variables', async () => {
  const { transport } = setup('{"data":{"node":{"id":"R_fixture"}}}');
  const input = {
    documentId: 'read-node', document: 'query ReadNode($id:ID!){node(id:$id){id}}',
    operationName: 'ReadNode', operationKind: 'query', variables: { id: 'R_fixture' },
    schemaProfile: 'graphql-reviewed', proofScope: 'repository:101', tokenClasses: ['anonymous'],
    validateData: data => data.node?.id === 'R_fixture',
  };
  const capture = await transport.execute(transport.buildGraphQLRequest(input));
  assert.equal(requireGitHubRequestBinding(capture, input), capture);
  assert.throws(() => requireGitHubRequestBinding(capture, {
    ...input, document: 'query ReadNode($id:ID!){node(id:$id){id __typename}}',
  }), { code: 'EVIDENCE' });
  assert.throws(() => requireGitHubRequestBinding(capture, {
    ...input, variables: { id: 'R_foreign' },
  }), { code: 'EVIDENCE' });
});

test('status-specific success variants decode JSON 200 and strictly empty 204', async () => {
  for (const [status, body, expected] of [[200, '{}', {}], [204, null, null]]) {
    const { transport } = setup(body, status);
    const input = {
      ...read, method: 'POST', expectedStatuses: [200, 204],
      responseTypes: { 200: 'json', 204: 'empty' },
    };
    const capture = await transport.execute(transport.buildRestRequest(input), {
      actionAuthority: { operationId: 'op-variant', authorityRef: 'grant-variant', dispatchClaimId: 'call-variant' },
    });
    assert.equal(capture.status, status);
    assert.deepEqual(capture.body, expected);
  }
  const { transport } = setup('{}');
  assert.throws(() => transport.buildRestRequest({
    ...read, expectedStatuses: [200, 204], responseTypes: { 200: 'json' },
  }), { code: 'INPUT' });
});
