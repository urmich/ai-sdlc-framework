import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { prepareOperation, markDispatching, recordOperation } from 'ai-sdlc-framework/operations';
import { currentCycle, currentTestEvidence, stagePassed } from '../src/authority.mjs';
import { deriveIntendedOutcome, validateOperationResult } from '../src/external-results.mjs';
import { validateCurrentExecutionIdentity, validateExecutionIdentity } from '../src/provider-adapters.mjs';
import { validateRecord } from '../src/schemas.mjs';
import { digest } from '../src/core.mjs';
import { writeJson } from '../src/files.mjs';
import { startCycle, recordTest } from '../src/validation.mjs';
import {
  coding, completeReview, fixture, fixtureArtifact, fixtureBuild,
  fixtureDeployment, grant, observeFixtureRepository,
  registerFixtureProviderRequest, registerFixtureProviderResult, testDefinitions,
} from './helpers.mjs';

async function candidate(t) {
  const f = await coding(await fixture(t, { compactPath: true }));
  await writeJson(path.join(f.repo, '.sdlc', 'config.json'), {
    defaultBranch: 'refs/heads/main',
    environments: { DEV: {
      target: 'dev-target', configDigest: 'config-1', allowedStages: ['DEV'],
    } },
  });
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Isolated required execution identity candidate');
  const repository = await observeFixtureRepository(f);
  const { cycle } = await startCycle(f.store, {
    workItemId: f.workItemId, tests: testDefinitions(),
    configDigest: 'config-1', cause: 'FR-059/060/064 required execution identity',
  });
  for (const testId of ['T-unit', 'T-integration']) {
    await recordTest(f.store, {
      workItemId: f.workItemId, cycleId: cycle.id, testId,
      status: 'Passed', expectedMet: true, owner: 'agent', host: 'local',
      evidenceRef: `fixture:${testId}`,
    });
  }
  await completeReview(f, cycle);
  await grant(f, 'dev-authorization', {
    cycleId: cycle.id, candidateDigest: cycle.candidateDigest,
    testSpecDigest: cycle.testSpecDigest, configDigest: cycle.configDigest,
    target: 'dev-target', completedStage: 'review',
  });
  const producer = await fixtureBuild(f, cycle);
  const artifact = await fixtureArtifact(f, cycle, producer);
  const deployment = await fixtureDeployment(f, cycle, artifact, { target: 'dev-target' });
  const action = {
    class: 'test', repositoryId: 'primary', testId: 'T-dev',
    environment: 'DEV', target: 'dev-target', owner: 'agent',
    host: 'development-machine', configDigest: cycle.configDigest,
    artifactId: artifact.artifactId, deploymentId: deployment.id,
  };
  const { operation } = await prepareOperation(f.store, {
    workItemId: f.workItemId, sessionId: f.sessionId, action,
    request: { toolName: 'fixture_test', toolArgs: { action }, cwd: f.repo },
    correlationKey: 'required-execution-identity', intent: 'Test the current verified deployment',
  });
  assert.ok(operation.intendedOutcome, 'The real public preparation must supply complete intent');
  registerFixtureProviderRequest(f, operation);
  await markDispatching(f.store, f.workItemId, operation.id);
  const result = {
    remoteRepositoryURL: repository.remoteRepositoryURL,
    executionRef: 'run-42', attemptCapability: 'distinct', attemptRef: '2',
    sourceRevision: cycle.sources[0].revision, configDigest: cycle.configDigest,
    candidateDigest: cycle.candidateDigest, testSpecDigest: cycle.testSpecDigest,
    environment: action.environment, target: action.target, testId: action.testId,
    artifactId: action.artifactId, deploymentId: action.deploymentId, expectedMet: true,
  };
  return { f, cycle, operation, result, repository };
}

test('FR-059/060/064 public hosted test without execution identity stays uncertain and cannot grant Passed', async t => {
  const { f, operation, result, repository } = await candidate(t);
  const observedResult = registerFixtureProviderResult(f, operation, {
    providerResultId: 'run-42:2', result,
  });
  const recorded = await recordOperation(f.store, {
    workItemId: f.workItemId, operationId: operation.id,
    status: 'succeeded', observedResult,
  });
  const state = await f.store.load(f.workItemId);
  const cycle = currentCycle(state.records, state.checkpoint);
  const planned = cycle.tests.find(item => item.id === 'T-dev');
  const evidence = currentTestEvidence(cycle, state.records, planned, f.clock);
  assert.deepEqual({
    recorded: recorded.status,
    loaded: state.records.find(item => item.id === operation.id).status,
    currentTest: evidence?.status ?? 'NotRun',
    stagePassed: stagePassed(cycle, state.records, 'DEV', f.clock),
  }, {
    recorded: 'uncertain', loaded: 'uncertain', currentTest: 'NotRun', stagePassed: false,
  }, 'A new causally proven hosted result with only run-42:2 must not grant current Passed');
  assert.equal(recorded.resultGap, 'missing-execution-identity');
  assert.equal(recorded.resultProof, undefined);
  assert.equal(state.records.some(item =>
    item.type === 'test-evidence' && item.operationId === operation.id), false);

  const executionIdentity = {
    provider: repository.provider, connection: repository.connection,
    scopeRef: 'project:fixture/repository:primary',
    executionRef: result.executionRef, attemptKind: 'known', attemptRef: result.attemptRef,
  };
  const freshResult = registerFixtureProviderResult(f, operation, {
    providerResultId: 'run-42:2', result: { ...result, executionIdentity },
  });
  const completed = await recordOperation(f.store, {
    workItemId: f.workItemId, operationId: operation.id,
    status: 'succeeded', observedResult: freshResult,
  }, { reconcile: true });
  assert.equal(completed.status, 'succeeded');
  assert.deepEqual(completed.resultProof.executionIdentity, executionIdentity);
  const reloaded = await f.store.load(f.workItemId);
  const current = currentCycle(reloaded.records, reloaded.checkpoint);
  const persisted = reloaded.records.find(item => item.id === operation.id);
  assert.deepEqual(persisted.resultProof, completed.resultProof);
  assert.equal(currentTestEvidence(current, reloaded.records, planned, f.clock)?.status, 'Passed');
  assert.equal(stagePassed(current, reloaded.records, 'DEV', f.clock), true);
  const replay = await recordOperation(f.store, {
    workItemId: f.workItemId, operationId: operation.id,
    status: 'succeeded', observedResult: freshResult,
  });
  assert.deepEqual(replay.resultProof, completed.resultProof);
  const historical = structuredClone(persisted);
  delete historical.resultProof.executionIdentity;
  assert.equal(validateRecord(historical), historical,
    'Incomplete old operation proof remains schema-readable without invented identity');
});

function hostedResult(kind = 'build', environment = 'DEV', capability = 'distinct') {
  const action = {
    class: kind, repositoryId: 'primary',
    remoteRepositoryURL: 'https://example.invalid/repository.git',
    environment, target: `${environment.toLowerCase()}-target`,
    sourceRevision: 'a'.repeat(40), configDigest: 'config-1',
    provider: 'fixture', pipeline: 'fixture-build',
    ...(kind === 'test' ? {
      testId: 'T-hosted', artifactId: 'package', deploymentId: 'deployment',
    } : {}),
  };
  const intended = deriveIntendedOutcome(action);
  const dispatch = {
    id: 'dispatch-1', status: 'dispatching',
    providerRequestId: 'request-1', providerRequestSupported: true,
  };
  const attemptRef = capability === 'none' ? 'not-applicable' : '2';
  const executionIdentity = {
    provider: 'fixture', connection: 'ci', scopeRef: 'project:fixture',
    definitionRef: 'fixture-build', executionRef: 'run-42',
    attemptKind: capability === 'none' ? 'not-applicable' : 'known',
    ...(capability === 'distinct' ? { attemptRef } : {}),
  };
  const result = {
    executionRef: 'run-42', attemptCapability: capability, attemptRef,
    executionIdentity, sourceRevision: action.sourceRevision,
    configDigest: action.configDigest, provider: action.provider,
    pipeline: action.pipeline, environment, target: action.target,
    remoteRepositoryURL: action.remoteRepositoryURL,
    ...(kind === 'test' ? {
      testId: action.testId, artifactId: action.artifactId,
      deploymentId: action.deploymentId, expectedMet: true,
    } : {}),
  };
  const providerResultId = `run-42:${attemptRef}`;
  const observed = {
    status: 'succeeded', family: intended.family, target: intended.target,
    intendedOutcomeDigest: intended.digest,
    providerStatus: 'succeeded', providerVerified: true, providerResultId,
    causalProof: {
      kind: 'provider-request', dispatchId: dispatch.id,
      providerRequestId: dispatch.providerRequestId, resultId: providerResultId,
      supported: true, accepted: true,
    },
    result, evidence: { ref: 'fixture:run-42', verified: true, sha256: digest(result) },
  };
  return { intended, dispatch, observed };
}

for (const kind of ['build', 'pipeline', 'pr-validation', 'test']) {
  for (const environment of ['DEV', 'STAGING']) {
    test(`FR-059 ${environment} ${kind} cannot conclude from a bare run and attempt`, () => {
      const { intended, dispatch, observed } = hostedResult(kind, environment);
      delete observed.result.executionIdentity;
      const checked = validateOperationResult(intended, dispatch, observed);
      assert.deepEqual(checked, { status: 'uncertain', reason: 'missing-execution-identity' });
    });
  }
}

test('FR-059 known attempts and proven no-attempt executions retain full identity in proof', () => {
  for (const capability of ['distinct', 'none']) {
    const { intended, dispatch, observed } = hostedResult('test', 'STAGING', capability);
    const proof = validateOperationResult(intended, dispatch, observed);
    assert.equal(proof.status, 'succeeded');
    assert.deepEqual(proof.executionIdentity, observed.result.executionIdentity);
    assert.equal(proof.attemptCapability, capability);
    assert.equal(proof.attemptRef, observed.result.attemptRef);
    assert.equal(proof.providerResultId, `run-42:${proof.attemptRef}`);
  }
});

test('FR-059 new results reject malformed, contradictory and unnormalized identities', () => {
  for (const changes of [
    { provider: 'other-provider' }, { connection: '' }, { connection: ' ci ' },
    { scopeRef: '' }, { scopeRef: ' project:fixture' },
    { definitionRef: 'other-build' }, { executionRef: 'other-run' },
    { attemptRef: '3' }, { attemptRef: 'unknown' },
    { attemptKind: 'unknown', attemptRef: undefined },
    { attemptKind: 'not-applicable', attemptRef: undefined },
  ]) {
    const { intended, dispatch, observed } = hostedResult();
    const identity = { ...observed.result.executionIdentity, ...changes };
    for (const key of Object.keys(identity)) if (identity[key] === undefined) delete identity[key];
    observed.result.executionIdentity = identity;
    assert.equal(validateOperationResult(intended, dispatch, observed).reason,
      'inconsistent-execution-identity', JSON.stringify(changes));
  }
  for (const missing of ['provider', 'connection', 'scopeRef', 'executionRef', 'attemptKind', 'attemptRef']) {
    const { intended, dispatch, observed } = hostedResult();
    delete observed.result.executionIdentity[missing];
    assert.equal(validateOperationResult(intended, dispatch, observed).status, 'uncertain', missing);
  }
});

test('FR-059 trusted execution context rejects another connection, scope, definition or attempt capability', () => {
  const { intended, dispatch, observed } = hostedResult();
  const executionContext = {
    provider: 'fixture', connection: 'ci', scopeRef: 'project:fixture',
    definitionRef: 'fixture-build', attemptCapability: 'distinct',
  };
  assert.equal(validateOperationResult(intended, dispatch, observed, { executionContext }).status, 'succeeded');
  for (const changes of [
    { provider: 'other-provider' }, { connection: 'other-connection' },
    { scopeRef: 'other-scope' }, { definitionRef: 'other-definition' },
    { attemptCapability: 'none' },
  ]) {
    assert.equal(validateOperationResult(intended, dispatch, observed, {
      executionContext: { ...executionContext, ...changes },
    }).reason, 'inconsistent-execution-identity', JSON.stringify(changes));
  }
});

test('FR-059 local tests and builds do not require a hosted execution identity', () => {
  for (const kind of ['test', 'local-build']) {
    const action = {
      class: kind, repositoryId: 'primary', environment: 'local',
      candidateDigest: 'candidate', ...(kind === 'test' ? { testId: 'T-local' } : {}),
    };
    const { dispatch, observed } = hostedResult();
    const intended = deriveIntendedOutcome(action);
    Object.assign(observed, {
      family: intended.family, target: intended.target, intendedOutcomeDigest: intended.digest,
      result: {
        executionRef: 'run-42', attemptCapability: 'distinct', attemptRef: '2',
        candidateDigest: 'candidate', local: true,
        ...(kind === 'test' ? { testId: 'T-local', expectedMet: true } : {}),
      },
    });
    assert.equal(validateOperationResult(intended, dispatch, observed).status, 'succeeded', kind);
  }
});

test('FR-060 proven no-effect failures do not invent an execution identity', () => {
  for (const status of ['failed', 'cancelled']) {
    const { intended, dispatch, observed } = hostedResult();
    Object.assign(observed, {
      status, providerStatus: status, providerResultId: 'failure-42',
      failure: { terminal: true, providerVerified: true, noEffect: true },
      result: {
        failureRef: 'failure-42', remoteRepositoryURL: intended.target.remoteRepositoryURL,
      },
    });
    observed.causalProof.resultId = observed.providerResultId;
    const proof = validateOperationResult(intended, dispatch, observed);
    assert.equal(proof.status, status);
    assert.equal(proof.executionIdentity, undefined);
    observed.failure.noEffect = false;
    assert.equal(validateOperationResult(intended, dispatch, observed).status, 'uncertain');
  }
});

test('FR-064 historical identity remains readable but is not silently normalized for current credit', () => {
  const historical = {
    provider: 'fixture', connection: ' ci ', scopeRef: 'project:fixture', executionRef: '42',
  };
  assert.deepEqual(validateExecutionIdentity(historical), historical);
  assert.throws(() => validateCurrentExecutionIdentity(historical, 'none'));
  for (const attemptRef of ['unknown', 'not-applicable', ' 2 ']) {
    assert.throws(() => validateCurrentExecutionIdentity({
      ...historical, connection: 'ci', attemptKind: 'known', attemptRef,
    }, 'distinct'));
  }
});
