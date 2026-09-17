import test from 'node:test';
import assert from 'node:assert/strict';
import {
  azureDevOpsScopeRef,
  providerAdapterIds,
  registerProviderAdapter,
  sameExecutionIdentity,
  validateExecutionIdentity,
  verifyProviderLink,
} from '../src/provider-adapters.mjs';
import { runKey } from '../src/monitors.mjs';

const azureIdentity = (overrides = {}) => ({
  provider: 'azure-devops',
  connection: 'primary-ci',
  scopeRef: azureDevOpsScopeRef({
    projectId: 'project-guid',
    repositoryId: 'repository-guid',
  }),
  definitionRef: '17',
  executionRef: '42',
  ...overrides,
});

const azureObservation = (overrides = {}) => ({
  connection: 'primary-ci',
  build: {
    id: 42,
    project: { id: 'project-guid' },
    repository: { id: 'repository-guid' },
    definition: { id: 17 },
    _links: {
      web: {
        href: 'https://dev.azure.com/example/project/_build/results?buildId=42',
      },
    },
  },
  access: {
    accessible: true,
    finalUrl: 'https://dev.azure.com/example/project/_build/results?buildId=42&view=results',
  },
  ...overrides,
});

test('T-48 provider-neutral identities and Azure DevOps links are exact', async () => {
  const expected = azureIdentity();
  assert.deepEqual(validateExecutionIdentity(expected), expected);
  assert.ok(providerAdapterIds().includes('azure-devops'));
  assert.notEqual(runKey(expected), runKey({
    ...expected,
    attemptRef: '2',
  }));
  assert.notEqual(runKey(expected), runKey({
    ...expected,
    connection: 'secondary-ci',
  }));

  const verified = await verifyProviderLink('azure-devops', expected,
    azureObservation());
  assert.equal(verified.verified, true);
  assert.equal(verified.identity.executionRef, '42');
  assert.equal(verified.kind, 'summary');

  for (const observation of [
    azureObservation({
      build: {
        ...azureObservation().build,
        _links: {
          web: {
            href: 'https://dev.azure.com/example/project/_build/results?buildId=99',
          },
        },
      },
    }),
    azureObservation({
      access: {
        accessible: true,
        finalUrl: 'https://dev.azure.com/example/project/_build/results?buildId=99',
      },
    }),
    azureObservation({
      build: {
        ...azureObservation().build,
        project: { id: 'other-project' },
      },
    }),
    azureObservation({
      access: {
        accessible: false,
        finalUrl: 'https://dev.azure.com/example/project/_build/results?buildId=42',
      },
    }),
    azureObservation({
      access: {
        accessible: true,
        finalUrl: 'https://dev.azure.com/other/project/_build/results?buildId=42',
      },
    }),
    azureObservation({
      access: {
        accessible: true,
        finalUrl: 'https://unrelated.example.invalid/project/_build/results?buildId=42',
      },
    }),
    azureObservation({
      access: {
        accessible: true,
        finalUrl: 'https://dev.azure.com/example/project/not-a-build?buildId=42',
      },
    }),
    azureObservation({
      build: {
        ...azureObservation().build,
        id: null,
      },
    }),
  ]) {
    assert.equal((await verifyProviderLink('azure-devops', expected,
      observation)).verified, false);
  }
  assert.equal((await verifyProviderLink('missing-adapter', expected,
    azureObservation())).verified, false);
});

test('T-48 custom adapters register without changing generic verification', async () => {
  const adapterId = 'fixture-ci-provider';
  registerProviderAdapter({
    id: adapterId,
    linkKinds: ['summary', 'logs'],
    normalizeLinkObservation(observation) {
      return {
        identity: observation.identity,
        url: observation.url,
        kind: observation.kind,
        accessible: observation.accessible,
      };
    },
  });
  assert.throws(() => registerProviderAdapter({
    id: adapterId,
    linkKinds: ['summary'],
    normalizeLinkObservation() {},
  }), { code: 'ADAPTER' });

  const identity = {
    provider: adapterId,
    connection: 'fixture',
    scopeRef: 'project:fixture',
    definitionRef: 'workflow:build',
    executionRef: 'run:7',
    attemptRef: 'attempt:2',
  };
  const result = await verifyProviderLink(adapterId, identity, {
    identity,
    url: 'https://ci.example.invalid/job/api',
    kind: 'logs',
    accessible: true,
  });
  assert.equal(result.verified, true);
  assert.equal(sameExecutionIdentity(result.identity, identity), true);
  assert.equal((await verifyProviderLink(adapterId, identity, {
    identity: { ...identity, attemptRef: 'attempt:3' },
    url: 'https://ci.example.invalid/job/api',
    kind: 'logs',
    accessible: true,
  })).verified, false);
  assert.equal((await verifyProviderLink(adapterId, identity, {
    identity,
    url: 'https://ci.example.invalid/job/api',
    kind: 'unsupported',
    accessible: true,
  })).verified, false);

  const malformedId = 'malformed-fixture-provider';
  registerProviderAdapter({
    id: malformedId,
    linkKinds: ['summary'],
    normalizeLinkObservation(observation) {
      return {
        identity: observation.identity,
        url: null,
        kind: 'summary',
        accessible: true,
      };
    },
  });
  const malformedIdentity = {
    ...identity,
    provider: malformedId,
  };
  assert.equal((await verifyProviderLink(malformedId, malformedIdentity, {
    identity: malformedIdentity,
  })).verified, false);

  const rejectingId = 'rejecting-fixture-provider';
  registerProviderAdapter({
    id: rejectingId,
    linkKinds: ['summary'],
    normalizeLinkObservation() {
      throw null;
    },
  });
  assert.equal((await verifyProviderLink(rejectingId, {
    ...identity,
    provider: rejectingId,
  }, {})).verified, false);
});
