import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Store } from 'ai-sdlc-framework/store';
import {
  prepareOperation, markDispatching, recordOperation,
} from 'ai-sdlc-framework/operations';
import {
  fixture, coding, completeReview, grant, observeFixtureRepository,
  testDefinitions,
} from './helpers.mjs';
import { startCycle, recordTest } from '../src/validation.mjs';

const contract = Object.freeze({
  adapterId: 'fixture-host-call-result',
  propagatesUniqueCallId: true,
  dispatchIdField: 'dispatch.callId',
  resultIdField: 'result.callId',
});
const executionContext = Object.freeze({
  provider: 'fixture', connection: 'fixture-connection',
  scopeRef: 'project:fixture-host-ci', definitionRef: 'fixture-build',
  attemptCapability: 'none',
});
const sha256 = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ?
  `[${value.map(canonical).join(',')}]` :
  value && typeof value === 'object' ?
    `{${Object.keys(value).sort().map(key =>
      `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` :
    JSON.stringify(value);

async function hostFixture(t) {
  const f = await coding(await fixture(t));
  const results = new Map();
  const executions = new Map([['run-42:not-applicable', Object.freeze({
    provider: 'fixture', connection: 'fixture-connection',
    scopeRef: 'project:fixture-host-ci', definitionRef: 'fixture-build',
    executionRef: 'run-42', attemptKind: 'not-applicable',
  })]]);
  f.store = await new Store(f.home, {
    clock: f.clock,
    verifyRepository: f.store.verifyRepository,
    verifyOperationResult({ operation, observedResult }) {
      const verified = results.get(operation.id);
      assert.ok(verified, 'A trusted fixture result must be registered first');
      assert.deepEqual(observedResult, {
        fixtureResultId: verified.observation.providerResultId,
      });
      if (verified.observation.result) {
        assert.deepEqual(verified.observation.result.executionIdentity,
          executions.get(verified.observation.providerResultId),
        'The host-call result must identify an independently registered CI execution');
      }
      return verified;
    },
  }).ready();
  const configuration = {
    defaultBranch: 'refs/heads/main',
    environments: {
      DEV: {
        target: 'dev-resource', configDigest: 'config-v1',
        allowedStages: ['DEV'],
      },
    },
  };
  await fs.writeFile(path.join(f.repo, '.sdlc', 'config.json'),
    JSON.stringify(configuration));
  await f.runGit('add', '.sdlc');
  await f.runGit('commit', '-qm', 'Fixture candidate source');
  await observeFixtureRepository(f);
  const { cycle } = await startCycle(f.store, {
    workItemId: f.workItemId, tests: testDefinitions(),
    configDigest: 'config-v1', cause: 'host-call result regression',
  });
  for (const testId of ['T-unit', 'T-integration']) {
    await recordTest(f.store, {
      workItemId: f.workItemId, cycleId: cycle.id, testId,
      status: 'Passed', expectedMet: true, evidenceRef: `fixture:${testId}`,
      owner: 'agent', host: 'local',
    });
  }
  await completeReview(f, cycle);
  await grant(f, 'dev-authorization', {
    cycleId: cycle.id, candidateDigest: cycle.candidateDigest,
    testSpecDigest: cycle.testSpecDigest, configDigest: cycle.configDigest,
    target: 'dev-resource', completedStage: 'review',
  });
  const action = {
    class: 'build', repositoryId: 'primary', environment: 'DEV',
    target: 'dev-resource', provider: 'fixture', pipeline: 'fixture-build',
    monitorCapability: true,
    sourceRevision: cycle.sources.find(source =>
      source.repositoryId === 'primary').revision,
    configDigest: cycle.configDigest,
  };
  const request = {
    toolName: 'fixture_build',
    toolArgs: { target: 'dev-resource', pipeline: 'fixture-build' },
    cwd: f.repo,
  };
  const prepare = (correlationKey, host) => prepareOperation(f.store, {
    workItemId: f.workItemId, sessionId: f.sessionId, action, request,
    correlationKey, intent: 'Build the fixture candidate',
  }, host);
  const observe = (operation, hostCallId, providerResultId = 'run-42:not-applicable') => {
    const { intendedOutcome } = operation;
    const executionIdentity = executions.get(providerResultId);
    assert.ok(executionIdentity, 'The fixture CI service must register the execution before its callback');
    const observation = {
      status: 'succeeded', family: intendedOutcome.family,
      target: intendedOutcome.target,
      intendedOutcomeDigest: intendedOutcome.digest,
      providerStatus: 'succeeded', providerVerified: true,
      providerResultId,
      causalProof: {
        kind: 'host-call', dispatchId: operation.id, resultId: providerResultId,
        supported: true, hostCallId,
      },
      result: {
        executionRef: executionIdentity.executionRef,
        attemptCapability: 'none', attemptRef: 'not-applicable',
        executionIdentity,
        sourceRevision: action.sourceRevision,
        configDigest: action.configDigest,
        candidateDigest: cycle.candidateDigest,
        testSpecDigest: cycle.testSpecDigest,
        provider: executionIdentity.provider, pipeline: executionIdentity.definitionRef,
        environment: action.environment, target: action.target,
        remoteRepositoryURL: intendedOutcome.target.remoteRepositoryURL,
      },
      evidence: {
        ref: `fixture:host-result:${providerResultId}`, verified: true,
        sha256: sha256(providerResultId),
      },
    };
    results.set(operation.id, {
      dispatch: { id: operation.id, hostCallId, hostCallSupported: true },
      observation, executionContext,
    });
    return { fixtureResultId: providerResultId };
  };
  const record = (operation, observedResult, status = 'succeeded') =>
    recordOperation(f.store, {
      workItemId: f.workItemId, operationId: operation.id,
      status, observedResult,
    });
  return { f, action, request, prepare, observe, record, results };
}

test('T-107/T-108 public operations persist trusted host-call proof without provider request IDs', async t => {
  const { f, prepare, observe, record, results } = await hostFixture(t);
  const hostCallId = 'host-call-42';
  const { operation } = await prepare('build-host-call', { adapterContract: contract, hostCallId });
  const hostDigest = sha256(hostCallId);
  assert.equal(operation.status, 'prepared');
  assert.equal(operation.hostInvocation.hostCallIdDigest, hostDigest);
  assert.equal(operation.hostInvocation.hostAdapterId, contract.adapterId);
  assert.equal(JSON.stringify(operation).includes(hostCallId), false);
  assert.ok(operation.intendedOutcome?.digest);
  assert.equal((await f.store.records(f.workItemId)).find(record =>
    record.id === operation.id).hostInvocation.hostCallIdDigest, hostDigest);

  await markDispatching(f.store, f.workItemId, operation.id);
  const observedResult = observe(operation, hostCallId);
  const verified = results.get(operation.id);
  assert.equal(verified.dispatch.providerRequestId, undefined);
  assert.equal(verified.dispatch.providerIdempotencyToken, undefined);
  assert.equal(verified.observation.causalProof.providerRequestId, undefined);
  const completed = await record(operation, observedResult);
  assert.equal(completed.status, 'succeeded');
  assert.deepEqual(completed.resultProof, {
    status: 'succeeded', dispatchId: operation.id,
    intendedOutcomeDigest: operation.intendedOutcome.digest,
    providerResultId: verified.observation.providerResultId,
    causalKey: `host:${hostDigest}`,
    resultDigest: sha256(canonical(verified.observation)),
    executionRef: 'run-42', attemptCapability: 'none',
    attemptRef: 'not-applicable',
    executionIdentity: {
      provider: 'fixture', connection: 'fixture-connection',
      scopeRef: 'project:fixture-host-ci', definitionRef: 'fixture-build',
      executionRef: 'run-42', attemptKind: 'not-applicable',
    },
  });
  assert.equal(completed.handle, 'run-42:not-applicable');
  assert.equal(completed.evidenceRef, verified.observation.evidence.ref);
  assert.equal((await f.store.records(f.workItemId)).find(record =>
    record.id === operation.id).resultProof.resultDigest,
  completed.resultProof.resultDigest);
});

test('T-107/T-108 mismatched host ID cannot complete a dispatched operation', async t => {
  const { f, prepare, observe, record } = await hostFixture(t);
  const { operation } = await prepare('wrong-host-id', {
    adapterContract: contract, hostCallId: 'expected-host-id',
  });
  await markDispatching(f.store, f.workItemId, operation.id);
  await assert.rejects(record(operation, observe(operation, 'wrong-host-id')),
    { code: 'EVIDENCE' });
  assert.equal((await f.store.records(f.workItemId)).find(record =>
    record.id === operation.id).status, 'dispatching');
});

test('T-107/T-108 ordinary inputs and unsupported contracts cannot create host-call credit', async t => {
  const { f, action, request, prepare, observe, record } = await hostFixture(t);
  for (const extra of [
    { hostCallId: 'json-supplied' },
    { adapterContract: contract },
    { request: { ...request, hostCallId: 'json-supplied' } },
    { request: { ...request, adapterContract: contract } },
  ]) {
    await assert.rejects(prepareOperation(f.store, {
      workItemId: f.workItemId, sessionId: f.sessionId,
      action, request, correlationKey: 'raw-host-field',
      intent: 'Build the fixture candidate', ...extra,
    }), { code: 'INPUT' });
  }
  await assert.rejects(prepare('unsupported-host', {
    adapterContract: { ...contract, propagatesUniqueCallId: false },
    hostCallId: 'unsupported-id',
  }), { code: 'ADAPTER' });
  await assert.rejects(prepare('missing-id', { adapterContract: contract }),
    { code: 'ADAPTER' });
  const { operation } = await prepare('ordinary-cli');
  assert.equal(operation.hostInvocation.hostCallIdDigest, undefined);
  await markDispatching(f.store, f.workItemId, operation.id);
  await assert.rejects(record(operation, observe(operation, 'json-supplied')),
    { code: 'EVIDENCE' });
  assert.equal((await f.store.records(f.workItemId)).find(record =>
    record.id === operation.id).resultProof, undefined);
});

test('T-107/T-108 delayed identical result cannot complete a newer host call', async t => {
  const { f, prepare, observe, record, results } = await hostFixture(t);
  const first = (await prepare('first-call', {
    adapterContract: contract, hostCallId: 'host-first',
  })).operation;
  await markDispatching(f.store, f.workItemId, first.id);
  const firstResult = observe(first, 'host-first');
  assert.equal((await record(first, firstResult)).status, 'succeeded');

  const second = (await prepare('new-call', {
    adapterContract: contract, hostCallId: 'host-second',
  })).operation;
  await markDispatching(f.store, f.workItemId, second.id);
  const stale = observe(second, 'host-first');
  await assert.rejects(record(second, stale), { code: 'EVIDENCE' });
  const oldObservation = results.get(second.id).observation;
  results.set(second.id, {
    dispatch: { id: second.id, hostCallId: 'host-second', hostCallSupported: true },
    executionContext,
    observation: {
      ...oldObservation,
      causalProof: { ...oldObservation.causalProof, hostCallId: 'host-first' },
    },
  });
  const mismatched = await record(second, stale);
  assert.equal(mismatched.status, 'uncertain');
  assert.equal(mismatched.resultGap, 'missing-dispatch-to-result-proof');
  assert.equal(mismatched.resultProof, undefined);
  assert.equal((await f.store.records(f.workItemId)).find(record =>
    record.id === first.id).status, 'succeeded');
});

test('T-107 affirmative non-dispatch requires the exact supported host call', async t => {
  const { f, prepare, record, results } = await hostFixture(t);
  const { operation } = await prepare('not-dispatched', {
    adapterContract: contract, hostCallId: 'host-call-A',
  });
  const observation = {
    status: 'not-started', family: operation.intendedOutcome.family,
    target: operation.intendedOutcome.target,
    intendedOutcomeDigest: operation.intendedOutcome.digest,
    nonDispatchProof: {
      kind: 'host-non-dispatch', hostSupported: true,
      dispatchId: operation.id, dispatchAttempted: false,
    },
    evidence: {
      ref: 'fixture:host-non-dispatch', verified: true,
      sha256: sha256('affirmative-no-dispatch'),
    },
  };
  const observedResult = { fixtureResultId: undefined };
  for (const dispatch of [
    { id: operation.id, hostCallId: 'host-call-B', hostCallSupported: true },
    { id: operation.id },
    { id: operation.id, hostCallSupported: true },
    { id: operation.id, hostCallId: 'host-call-A' },
    { id: operation.id, hostCallId: 'host-call-A', hostCallSupported: false },
  ]) {
    results.set(operation.id, { dispatch, observation });
    await assert.rejects(record(operation, observedResult, 'not-started'),
      { code: 'EVIDENCE' });
    const unchanged = (await f.store.records(f.workItemId)).find(entry =>
      entry.id === operation.id);
    assert.equal(unchanged.status, 'prepared');
    assert.equal(unchanged.resultProof, undefined);
    assert.equal(unchanged.evidenceRef, undefined);
  }
  results.set(operation.id, {
    dispatch: { id: operation.id, hostCallId: 'host-call-A',
      hostCallSupported: true },
    observation,
  });
  const completed = await record(operation, observedResult, 'not-started');
  assert.equal(completed.status, 'not-started');
  assert.deepEqual(completed.resultProof, {
    status: 'not-started', dispatchId: operation.id,
    intendedOutcomeDigest: operation.intendedOutcome.digest,
    resultDigest: sha256(canonical(observation)),
  });
  assert.equal((await f.store.records(f.workItemId)).find(record =>
    record.id === operation.id).status, 'not-started');
});
