import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { coding, completeReview, fixture, grant, observeFixtureRepository,
  fixtureDeployment, registerFixtureProviderRequest, registerFixtureProviderResult,
  testDefinitions, orient } from './helpers.mjs';
import { writeJson } from '../src/files.mjs';
import { digest } from '../src/core.mjs';
import { deriveIntendedOutcome, validateOperationResult } from '../src/external-results.mjs';
import { validateRecord } from '../src/schemas.mjs';
import { currentArtifact, currentDeployment } from '../src/current-evidence.mjs';
import { evaluatePolicy } from '../src/policy.mjs';
import { evaluateGate } from '../src/gate.mjs';
import { markDispatching, prepareOperation, pruneWork, recordOperation } from '../src/operations.mjs';
import { recordArtifact, recordTest, startCycle } from '../src/validation.mjs';

async function candidate(t, { toolAdapters } = {}) {
  const f = await coding(await fixture(t, { compactPath: true }));
  const configuration = { defaultBranch: 'refs/heads/main', environments: {
    DEV: { target: 'dev-target', configDigest: 'configuration-1',
      allowedStages: ['DEV'] },
  }, ...(toolAdapters ? { toolAdapters } : {}) };
  await writeJson(path.join(f.repo, '.sdlc/config.json'), configuration);
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Fixture candidate');
  const repository = await observeFixtureRepository(f);
  const { cycle } = await startCycle(f.store, {
    workItemId: f.workItemId, tests: testDefinitions(),
    configDigest: 'configuration-1', cause: 'artifact provenance regression',
  });
  for (const testId of ['T-unit', 'T-integration']) {
    await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id,
      testId, status: 'Passed', owner: 'agent', host: 'local', expectedMet: true,
      evidenceRef: `fixture:${testId}` });
  }
  await completeReview(f, cycle);
  await grant(f, 'dev-authorization', {
    cycleId: cycle.id, candidateDigest: cycle.candidateDigest,
    testSpecDigest: cycle.testSpecDigest, configDigest: cycle.configDigest,
    target: 'dev-target', completedStage: 'review',
  });
  return { f, cycle, repository, configuration };
}

async function verifiedBuild(f, cycle, repository, {
  executionRef: observedExecutionRef,
  connection = repository.connection,
  scopeRef = 'project:fixture/repository:primary',
  pipeline = 'fixture-build', correlationKey = 'scoped-build',
} = {}) {
  const action = { class: 'build', repositoryId: 'primary', environment: 'DEV',
    target: 'dev-target', provider: 'fixture', pipeline,
    monitorCapability: true, sourceRevision: cycle.sources[0].revision,
    configDigest: cycle.configDigest };
  const { operation } = await prepareOperation(f.store, {
    workItemId: f.workItemId, sessionId: f.sessionId, action,
    request: { toolName: 'fixture_build', toolArgs: { action }, cwd: f.repo },
    correlationKey, intent: 'Produce an exact fixture artifact',
  });
  const { providerRequestId } = registerFixtureProviderRequest(f, operation);
  await markDispatching(f.store, f.workItemId, operation.id);
  const executionRef = observedExecutionRef ??
    `run-${digest(providerRequestId).slice(0, 16)}`;
  const buildRunId = `${executionRef}:not-applicable`;
  const producingExecution = {
    provider: 'fixture', connection,
    scopeRef,
    definitionRef: 'fixture-build', executionRef, attemptKind: 'not-applicable',
  };
  f.providerExecutions.set(operation.id, {
    identity: producingExecution,
    context: {
      provider: 'fixture', connection, scopeRef,
      definitionRef: 'fixture-build', attemptCapability: 'none',
    },
  });
  const result = {
    remoteRepositoryURL: repository.remoteRepositoryURL,
    executionRef, attemptCapability: 'none', attemptRef: 'not-applicable',
    sourceRevision: action.sourceRevision, configDigest: cycle.configDigest,
    candidateDigest: cycle.candidateDigest, testSpecDigest: cycle.testSpecDigest,
    environment: 'DEV', target: 'dev-target', provider: 'fixture',
    pipeline: producingExecution.definitionRef,
    executionIdentity: producingExecution,
  };
  const observedResult = registerFixtureProviderResult(f, operation, {
    providerResultId: buildRunId, result,
  });
  const producer = await recordOperation(f.store, {
    workItemId: f.workItemId, operationId: operation.id,
    status: 'succeeded', observedResult,
  });
  return { producer, producingExecution, buildRunId };
}

async function historicalBuild(f, cycle, repository) {
  const executionRef = 'historical-run';
  const buildRunId = `${executionRef}:not-applicable`;
  const action = {
    class: 'build', repositoryId: 'primary', environment: 'DEV',
    target: 'dev-target', provider: 'fixture', pipeline: 'fixture-build',
    localRepositoryPath: f.repo, remoteRepositoryURL: repository.remoteRepositoryURL,
    sourceRevision: cycle.sources[0].revision, configDigest: cycle.configDigest,
  };
  const intendedOutcome = deriveIntendedOutcome(action);
  const producer = {
    type: 'operation', id: 'op-historical-build', workItemId: f.workItemId,
    repositoryId: 'primary', class: 'build', action, target: action.target,
    status: 'succeeded', dispatchBound: true,
    requestFingerprint: digest('historical-build-request'),
    correlationKey: 'historical-build',
    cycleId: cycle.id, candidateDigest: cycle.candidateDigest, intendedOutcome,
    resultProof: {
      status: 'succeeded', dispatchId: 'op-historical-build',
      intendedOutcomeDigest: intendedOutcome.digest,
      providerResultId: buildRunId, resultDigest: digest('historical-provider-result'),
      executionRef, attemptCapability: 'none', attemptRef: 'not-applicable',
    },
  };
  await f.store.transaction(f.workItemId, tx => tx.put(producer));
  const state = await f.store.load(f.workItemId);
  return {
    producer: state.records.find(record => record.id === producer.id),
    buildRunId,
    producingExecution: {
      provider: 'fixture', connection: repository.connection,
      scopeRef: 'project:fixture/repository:primary',
      definitionRef: 'fixture-build', executionRef, attemptKind: 'not-applicable',
    },
  };
}

function artifactInput(f, cycle, repository, build, { version = false } = {}) {
  const artifactRef = 'fixture:artifact:scoped';
  const content = version ? {
    artifactImmutableVersion: 'fixed-version-7',
    artifactRetrievalContext: 'provider:fixture/project:fixture/repository:primary',
  } : {
    artifactSha256: createHash('sha256').update('exact fixture artifact').digest('hex'),
  };
  const input = { workItemId: f.workItemId, cycleId: cycle.id,
    environment: 'DEV', sourceDigest: cycle.candidateDigest,
    configDigest: cycle.configDigest, artifactType: 'archive', status: 'succeeded',
    repositoryId: 'primary', localRepositoryPath: f.repo,
    remoteRepositoryURL: repository.remoteRepositoryURL,
    provider: repository.provider, connection: repository.connection,
    repositoryRef: repository.repositoryRef, sourceRevision: cycle.sources[0].revision,
    artifactId: 'scoped-package', artifactRef,
    buildRunId: build.buildRunId, name: 'package',
    evidenceRef: 'fixture:artifact-observation',
    producingOperationId: build.producer.id,
    producerObservation: { fixtureArtifactRef: artifactRef }, ...content };
  const { workItemId, cycleId, environment, sourceDigest, artifactType,
    status, producingOperationId, producerObservation, ...verifiedFields } = input;
  void workItemId; void cycleId; void environment; void sourceDigest;
  void artifactType; void status; void producingOperationId; void producerObservation;
  f.artifactVerifications.set(build.producer.id, {
    ...verifiedFields,
    attemptCapability: 'none', attemptRef: 'not-applicable',
    producingExecution: build.producingExecution,
    ...(version ? { versionVerified: true } : {}),
  });
  return input;
}

test('producer proof must include the matching provider connection, scope and definition', async t => {
  const { f, cycle, repository } = await candidate(t);
  const build = await verifiedBuild(f, cycle, repository);
  const input = artifactInput(f, cycle, repository, build);
  for (const change of [
    { connection: 'other-connection' },
    { scopeRef: 'project:other/repository:primary' },
    { definitionRef: 'other-build' },
  ]) {
    const verified = f.artifactVerifications.get(build.producer.id);
    verified.producingExecution = { ...build.producingExecution, ...change };
    await assert.rejects(recordArtifact(f.store, input), { code: 'EVIDENCE' });
  }
  f.artifactVerifications.get(build.producer.id).producingExecution =
    build.producingExecution;
  const selected = await recordArtifact(f.store, input);
  const state = await f.store.load(f.workItemId);
  assert.deepEqual(selected.producingExecution, build.producingExecution);
  assert.equal(currentArtifact(cycle, state.records, selected), true);
  const tampered = { ...selected, producingExecution: {
    ...build.producingExecution, scopeRef: 'project:other/repository:primary',
  } };
  assert.equal(currentArtifact(cycle, state.records.map(record =>
    record.id === selected.id ? tampered : record), tampered), false);
});

test('historical build proof without complete producer identity remains readable but cannot select an artifact', async t => {
  const { f, cycle, repository } = await candidate(t);
  const build = await historicalBuild(f, cycle, repository);
  assert.equal(build.producer.status, 'succeeded');
  assert.equal(build.producer.resultProof.executionIdentity, undefined);
  await assert.rejects(recordArtifact(f.store,
    artifactInput(f, cycle, repository, build)), { code: 'EVIDENCE' });
  const state = await f.store.load(f.workItemId);
  assert.equal(state.records.some(record => record.type === 'artifact'), false);
});

for (const changed of ['commit', 'hosted URL']) {
  test(`artifact verification rejects a ${changed} changed while the adapter was awaited`, async t => {
    const { f, cycle, repository } = await candidate(t);
    const build = await verifiedBuild(f, cycle, repository);
    const input = artifactInput(f, cycle, repository, build);
    const verifier = f.store.verifyArtifact;
    f.store.verifyArtifact = async args => {
      const verified = await verifier(args);
      if (changed === 'commit') {
        await f.runGit('commit', '--allow-empty', '-qm', 'Changed during verification');
      } else {
        await f.runGit('remote', 'set-url', 'origin',
          'https://example.invalid/changed-repository.git');
      }
      return verified;
    };
    await assert.rejects(recordArtifact(f.store, input), { code: 'STALE' });
    const state = await f.store.load(f.workItemId);
    assert.equal(state.records.some(record => record.type === 'artifact'), false);
  });
}

test('deploy must use the selected artifact hosted URL at policy, preparation and dispatch', async t => {
  const { f, cycle, repository, configuration } = await candidate(t);
  const build = await verifiedBuild(f, cycle, repository);
  const selected = await recordArtifact(f.store,
    artifactInput(f, cycle, repository, build));
  const action = { class: 'deploy', repositoryId: 'primary', environment: 'DEV',
    target: 'dev-target', configDigest: cycle.configDigest,
    monitorCapability: true, artifactId: selected.artifactId,
    artifactRef: selected.artifactRef, artifactSha256: selected.artifactSha256,
    sourceRevision: selected.sourceRevision };
  const otherUrl = 'https://example.invalid/other-repository.git';
  const state = await f.store.load(f.workItemId);
  assert.ok(evaluatePolicy(state, {
    ...action, localRepositoryPath: f.repo, remoteRepositoryURL: otherUrl,
  }, { configuration, clock: f.clock }).findings.some(finding =>
    finding.rule === 'artifact-provenance'));
  const request = { toolName: 'fixture_deploy',
    toolArgs: { artifactId: action.artifactId }, cwd: f.repo };
  await assert.rejects(prepareOperation(f.store, {
    workItemId: f.workItemId, sessionId: f.sessionId,
    action: { ...action, localRepositoryPath: f.repo,
      remoteRepositoryURL: otherUrl }, request,
    correlationKey: 'other-hosted-url', intent: 'Invalid hosted deployment',
  }), { code: 'EVIDENCE' });
  const { operation } = await prepareOperation(f.store, {
    workItemId: f.workItemId, sessionId: f.sessionId,
    action, request, correlationKey: 'selected-hosted-url',
    intent: 'Deploy selected fixture package',
  });
  assert.equal(operation.action.remoteRepositoryURL,
    repository.remoteRepositoryURL);
  await f.runGit('remote', 'set-url', 'origin', otherUrl);
  await assert.rejects(markDispatching(f.store, f.workItemId, operation.id));
  assert.equal((await f.store.load(f.workItemId)).records.find(record =>
    record.id === operation.id).status, 'prepared');
});

test('provider-proven immutable version with retrieval context is deployable, but a mutable version is not', async t => {
  const { f, cycle, repository, configuration } = await candidate(t);
  const build = await verifiedBuild(f, cycle, repository);
  const input = artifactInput(f, cycle, repository, build, { version: true });
  const verification = f.artifactVerifications.get(build.producer.id);
  verification.versionVerified = false;
  await assert.rejects(recordArtifact(f.store, input), { code: 'EVIDENCE' });
  verification.versionVerified = true;
  await assert.rejects(recordArtifact(f.store, {
    ...input, artifactRetrievalContext: undefined,
  }), { code: 'INPUT' });
  const selected = await recordArtifact(f.store, input);
  assert.equal(selected.artifactVersionVerified, true);
  const action = { class: 'deploy', repositoryId: 'primary', environment: 'DEV',
    target: 'dev-target', configDigest: cycle.configDigest,
    monitorCapability: true, artifactId: selected.artifactId,
    artifactRef: selected.artifactRef,
    artifactImmutableVersion: selected.artifactImmutableVersion,
    artifactRetrievalContext: selected.artifactRetrievalContext,
    sourceRevision: selected.sourceRevision };
  const state = await f.store.load(f.workItemId);
  assert.equal(currentArtifact(cycle, state.records, selected), true);
  assert.ok(!evaluatePolicy(state, {
    ...action, localRepositoryPath: f.repo,
    remoteRepositoryURL: repository.remoteRepositoryURL,
  }, { configuration, clock: f.clock }).findings.some(finding =>
    finding.rule === 'artifact-provenance'));
  assert.ok(evaluatePolicy(state, {
    ...action, artifactImmutableVersion: undefined,
    artifactRetrievalContext: undefined, localRepositoryPath: f.repo,
    remoteRepositoryURL: repository.remoteRepositoryURL,
  }, { configuration, clock: f.clock }).findings.some(finding =>
    finding.rule === 'artifact-provenance'));
  const { operation } = await prepareOperation(f.store, {
    workItemId: f.workItemId, sessionId: f.sessionId, action,
    request: { toolName: 'fixture_deploy',
      toolArgs: { artifactId: action.artifactId }, cwd: f.repo },
    correlationKey: 'versioned-deploy',
    intent: 'Deploy provider-proven immutable version',
  });
  const { providerRequestId } = registerFixtureProviderRequest(f, operation);
  await markDispatching(f.store, f.workItemId, operation.id);
  const deploymentRef = `deploy-${digest(providerRequestId).slice(0, 16)}`;
  const observedResult = registerFixtureProviderResult(f, operation, {
    providerResultId: deploymentRef,
    result: { remoteRepositoryURL: repository.remoteRepositoryURL,
      deploymentRef, artifactId: selected.artifactId,
      artifactRef: selected.artifactRef,
      artifactImmutableVersion: selected.artifactImmutableVersion,
      artifactRetrievalContext: selected.artifactRetrievalContext,
      sourceRevision: selected.sourceRevision,
      configDigest: selected.configDigest, environment: 'DEV', target: 'dev-target' },
  });
  const deployed = await recordOperation(f.store, {
    workItemId: f.workItemId, operationId: operation.id,
    status: 'succeeded', observedResult,
  });
  const final = await f.store.load(f.workItemId);
  const updatedCycle = final.records.find(record => record.id === cycle.id);
  assert.equal(deployed.status, 'succeeded');
  assert.equal(currentDeployment(updatedCycle, final.records, deployed, 'DEV'), true);
  assert.equal(currentArtifact(updatedCycle, final.records, {
    ...selected, artifactVersionVerified: undefined,
  }), false);
});

for (const [field, value] of [
  ['artifactImmutableVersion', 'fixed-version-8'],
  ['artifactRetrievalContext', 'provider:fixture/project:other/repository:primary'],
]) test(`gate rejects classified ${field} differing from the selected immutable artifact`, async t => {
  const toolArgs = { artifactId: 'scoped-package', version: 'fixed-version-7' };
  const { f, cycle, repository } = await candidate(t, { toolAdapters: [{
    toolName: 'fixture_deploy', match: toolArgs,
    action: { class: 'deploy', environment: 'DEV', target: 'dev-target',
      configDigest: 'configuration-1', monitorCapability: true,
      artifactId: 'scoped-package', artifactRef: 'fixture:artifact:scoped',
      artifactImmutableVersion: field === 'artifactImmutableVersion' ?
        value : 'fixed-version-7',
      artifactRetrievalContext: 'provider:fixture/project:fixture/repository:primary',
      ...(field === 'artifactRetrievalContext' ?
        { artifactRetrievalContext: value } : {}) },
  }] });
  const build = await verifiedBuild(f, cycle, repository);
  const selected = await recordArtifact(f.store,
    artifactInput(f, cycle, repository, build, { version: true }));
  const action = { class: 'deploy', repositoryId: 'primary', environment: 'DEV',
    target: 'dev-target', configDigest: cycle.configDigest,
    monitorCapability: true, artifactId: selected.artifactId,
    artifactRef: selected.artifactRef,
    artifactImmutableVersion: selected.artifactImmutableVersion,
    artifactRetrievalContext: selected.artifactRetrievalContext,
    sourceRevision: selected.sourceRevision };
  const request = { toolName: 'fixture_deploy', toolArgs, cwd: f.repo };
  await orient(f);
  const { operation } = await prepareOperation(f.store, {
    workItemId: f.workItemId, sessionId: f.sessionId, action,
    request, correlationKey: 'version-dispatch', intent: 'Deploy selected version',
  });
  await markDispatching(f.store, f.workItemId, operation.id);
  const checked = await evaluateGate(f.store, {
    ...request, sessionId: f.sessionId,
  });
  assert.equal(checked.permissionDecision, 'deny');
  assert.match(checked.permissionDecisionReason,
    new RegExp(`Prepared ${field} differs`, 'u'));
  const current = (await f.store.load(f.workItemId)).records.find(record =>
    record.id === operation.id);
  assert.equal(current.dispatchBound, false);
  assert.equal(current.status, 'dispatching');
});

test('gate binds the exact provider-verified immutable version and retrieval context', async t => {
  const toolArgs = { artifactId: 'scoped-package', version: 'fixed-version-7' };
  const { f, cycle, repository } = await candidate(t, { toolAdapters: [{
    toolName: 'fixture_deploy', match: toolArgs,
    action: { class: 'deploy', environment: 'DEV', target: 'dev-target',
      configDigest: 'configuration-1', monitorCapability: true,
      artifactId: 'scoped-package', artifactRef: 'fixture:artifact:scoped',
      artifactImmutableVersion: 'fixed-version-7',
      artifactRetrievalContext: 'provider:fixture/project:fixture/repository:primary' },
  }] });
  const build = await verifiedBuild(f, cycle, repository);
  const selected = await recordArtifact(f.store,
    artifactInput(f, cycle, repository, build, { version: true }));
  const action = { class: 'deploy', repositoryId: 'primary', environment: 'DEV',
    target: 'dev-target', configDigest: cycle.configDigest,
    monitorCapability: true, artifactId: selected.artifactId,
    artifactRef: selected.artifactRef,
    artifactImmutableVersion: selected.artifactImmutableVersion,
    artifactRetrievalContext: selected.artifactRetrievalContext,
    sourceRevision: selected.sourceRevision };
  const request = { toolName: 'fixture_deploy', toolArgs, cwd: f.repo };
  await orient(f);
  const { operation } = await prepareOperation(f.store, {
    workItemId: f.workItemId, sessionId: f.sessionId, action,
    request, correlationKey: 'exact-version-dispatch',
    intent: 'Deploy selected immutable fixture artifact',
  });
  assert.equal(operation.intendedOutcome.requested.artifactImmutableVersion,
    selected.artifactImmutableVersion);
  assert.equal(operation.intendedOutcome.requested.artifactRetrievalContext,
    selected.artifactRetrievalContext);
  await markDispatching(f.store, f.workItemId, operation.id);
  const checked = await evaluateGate(f.store, {
    ...request, sessionId: f.sessionId,
  });
  assert.deepEqual(checked, {});
  const dispatched = (await f.store.load(f.workItemId)).records.find(record =>
    record.id === operation.id);
  assert.equal(dispatched.dispatchBound, true);
});

test('deployment without an explicit revision retains its proven current deployment across recovery', async t => {
  const { f, cycle, repository } = await candidate(t);
  const build = await verifiedBuild(f, cycle, repository);
  const selected = await recordArtifact(f.store,
    artifactInput(f, cycle, repository, build));
  const { operation } = await prepareOperation(f.store, {
    workItemId: f.workItemId, sessionId: f.sessionId,
    action: { class: 'deploy', repositoryId: 'primary', environment: 'DEV',
      target: 'dev-target', configDigest: cycle.configDigest,
      monitorCapability: true, artifactId: selected.artifactId,
      artifactRef: selected.artifactRef,
      artifactSha256: selected.artifactSha256 },
    request: { toolName: 'fixture_deploy',
      toolArgs: { artifactId: selected.artifactId }, cwd: f.repo },
    correlationKey: 'implicit-revision-deploy',
    intent: 'Deploy the selected artifact at the bound candidate commit',
  });
  assert.equal(operation.intendedOutcome.requested.sourceRevision,
    selected.sourceRevision);
  const { providerRequestId } = registerFixtureProviderRequest(f, operation);
  await markDispatching(f.store, f.workItemId, operation.id);
  const deploymentRef = `deployment-${digest(providerRequestId).slice(0, 16)}`;
  const observedResult = registerFixtureProviderResult(f, operation, {
    providerResultId: deploymentRef,
    result: {
      deploymentRef, remoteRepositoryURL: repository.remoteRepositoryURL,
      artifactId: selected.artifactId, artifactRef: selected.artifactRef,
      artifactSha256: selected.artifactSha256,
      sourceRevision: selected.sourceRevision, configDigest: cycle.configDigest,
      environment: 'DEV', target: 'dev-target',
    },
  });
  const deployed = await recordOperation(f.store, {
    workItemId: f.workItemId, operationId: operation.id,
    status: 'succeeded', observedResult,
  });
  assert.equal(deployed.status, 'succeeded');
  const state = await f.store.load(f.workItemId);
  const current = state.records.find(record => record.id === cycle.id);
  assert.equal(current.deployments.DEV, deployed.id);
  assert.equal(currentDeployment(current, state.records, deployed, 'DEV'), true);
  await f.store.transaction(f.workItemId, tx => {
    const interrupted = tx.get(cycle.id);
    delete interrupted.deployments.DEV;
    tx.put(interrupted);
  });
  const recovered = await f.store.load(f.workItemId);
  const projected = recovered.records.find(record => record.id === cycle.id);
  assert.equal(projected.deployments.DEV, deployed.id);
  assert.equal(currentDeployment(projected, recovered.records, deployed, 'DEV'), true);
});

for (const archived of [false, true]) {
  test(`${archived ? 'archived' : 'active'} proof distinguishes full execution scope and connection when run IDs collide`, async t => {
    const { f, cycle, repository } = await candidate(t);
    const shared = { executionRef: 'shared-run' };
    const first = await verifiedBuild(f, cycle, repository, {
      ...shared, correlationKey: 'first-scoped-run',
    });
    assert.equal(first.producer.status, 'succeeded');
    if (archived) {
      await pruneWork(f.store, f.workItemId);
      assert.equal((await f.store.records(f.workItemId)).some(record =>
        record.id === first.producer.id), false);
    }

    for (const [name, difference] of [
      ['connection', { connection: 'other-connection' }],
      ['scope', { scopeRef: 'project:other/repository:primary' }],
    ]) {
      const distinct = await verifiedBuild(f, cycle, repository, {
        ...shared, correlationKey: `other-${name}-run`, ...difference,
      });
      assert.equal(distinct.producer.status, 'succeeded');
      assert.equal(distinct.producer.resultProof.providerResultId,
        first.producer.resultProof.providerResultId);
      assert.deepEqual(distinct.producer.resultProof.executionIdentity,
        distinct.producingExecution);
    }
    const reused = await verifiedBuild(f, cycle, repository, {
      ...shared, correlationKey: 'reused-scoped-run',
      pipeline: 'fixture-build',
    });
    assert.equal(reused.producer.status, 'uncertain');
    assert.equal(reused.producer.resultGap,
      'result-or-request-belongs-to-another-dispatch');
  });
}

async function hostedDevTestCandidate(t) {
  const { f, cycle, repository } = await candidate(t);
  const build = await verifiedBuild(f, cycle, repository);
  const artifact = await recordArtifact(f.store,
    artifactInput(f, cycle, repository, build));
  const deployment = await fixtureDeployment(f, cycle, artifact, {
    target: 'dev-target',
  });
  return { f, cycle, repository, artifact, deployment };
}

async function verifiedDevTest({ f, cycle, repository, artifact, deployment }, {
  connection = repository.connection, scopeRef = 'project:a',
  correlationKey, includeIdentity = true,
} = {}) {
  const action = { class: 'test', repositoryId: 'primary',
    environment: 'DEV', target: 'dev-target', testId: 'T-dev',
    owner: 'agent', host: 'development-machine',
    configDigest: cycle.configDigest, artifactId: artifact.artifactId,
    deploymentId: deployment.id };
  const { operation } = await prepareOperation(f.store, {
    workItemId: f.workItemId, sessionId: f.sessionId, action,
    request: { toolName: 'fixture_test',
      toolArgs: { correlationKey }, cwd: f.repo },
    correlationKey, intent: 'Test the current DEV deployment',
  });
  registerFixtureProviderRequest(f, operation);
  await markDispatching(f.store, f.workItemId, operation.id);
  const executionIdentity = {
    provider: 'fixture', connection, scopeRef,
    definitionRef: 'dev-tests', executionRef: '42',
    attemptKind: 'known', attemptRef: '2',
  };
  f.providerExecutions.set(operation.id, {
    identity: executionIdentity,
    context: {
      provider: 'fixture', connection, scopeRef,
      definitionRef: 'dev-tests', attemptCapability: 'distinct',
    },
  });
  const observedResult = registerFixtureProviderResult(f, operation, {
    providerResultId: '42:2',
    result: {
      remoteRepositoryURL: repository.remoteRepositoryURL,
      executionRef: '42', attemptCapability: 'distinct', attemptRef: '2',
      sourceRevision: artifact.sourceRevision, configDigest: cycle.configDigest,
      candidateDigest: cycle.candidateDigest, testSpecDigest: cycle.testSpecDigest,
      environment: 'DEV', target: 'dev-target',
      testId: 'T-dev', expectedMet: true,
      artifactId: artifact.artifactId, deploymentId: deployment.id,
      ...(includeIdentity ? { executionIdentity } : {}),
    },
  });
  return recordOperation(f.store, {
    workItemId: f.workItemId, operationId: operation.id,
    status: 'succeeded', observedResult,
  });
}

for (const archived of [false, true]) {
  test(`${archived ? 'archived' : 'active'} hosted tests use full execution identity for result reuse`, async t => {
    const context = await hostedDevTestCandidate(t);
    const first = await verifiedDevTest(context, {
      correlationKey: 'test-project-a',
    });
    assert.equal(first.status, 'succeeded');
    const historical = structuredClone(first);
    delete historical.resultProof.executionIdentity;
    assert.doesNotThrow(() => validateRecord(historical));
    const otherScope = await verifiedDevTest(context, {
      correlationKey: 'test-project-b', scopeRef: 'project:b',
    });
    assert.equal(otherScope.status, 'succeeded');
    const otherConnection = await verifiedDevTest(context, {
      correlationKey: 'test-connection-b', connection: 'connection-b',
    });
    assert.equal(otherConnection.status, 'succeeded');
    for (const proof of [first, otherScope, otherConnection]) {
      assert.equal(proof.resultProof.providerResultId, '42:2');
      assert.ok(proof.resultProof.executionIdentity);
    }
    if (archived) {
      await pruneWork(context.f.store, context.f.workItemId);
      assert.equal((await context.f.store.records(context.f.workItemId))
        .some(record => record.id === first.id), false);
    }
    const duplicate = await verifiedDevTest(context, {
      correlationKey: 'test-project-a-reuse',
    });
    assert.equal(duplicate.status, 'uncertain');
    assert.equal(duplicate.resultGap,
      'result-or-request-belongs-to-another-dispatch');
  });
}

test('local-only test results do not require or persist a hosted execution identity', () => {
  const intended = deriveIntendedOutcome({
    class: 'test', repositoryId: 'primary', environment: 'local',
    testId: 'T-unit', candidateDigest: 'candidate',
  });
  const observed = {
    family: 'test', target: intended.target,
    intendedOutcomeDigest: intended.digest,
    status: 'succeeded', providerStatus: 'succeeded', providerVerified: true,
    providerResultId: 'local-run:not-applicable',
    causalProof: { kind: 'provider-request', supported: true,
      dispatchId: 'op-local-test', resultId: 'local-run:not-applicable',
      providerRequestId: 'request-local', accepted: true },
    result: {
      testId: 'T-unit', candidateDigest: 'candidate',
      executionRef: 'local-run', attemptCapability: 'none',
      attemptRef: 'not-applicable', expectedMet: true,
    },
    evidence: { ref: 'fixture:local-test', verified: true,
      sha256: digest('local result') },
  };
  const proof = validateOperationResult(intended, {
    id: 'op-local-test', providerRequestId: 'request-local',
    providerRequestSupported: true, status: 'dispatching',
  }, observed);
  assert.equal(proof.status, 'succeeded');
  assert.equal(proof.executionIdentity, undefined);
});

test('STAGING provider test proof retains full identity and rejects reuse across dispatches', () => {
  const action = {
    class: 'test', repositoryId: 'primary',
    remoteRepositoryURL: 'https://example.invalid/repository.git',
    localRepositoryPath: path.resolve('fixture', 'checkout'),
    environment: 'STAGING', target: 'staging-target',
    sourceRevision: 'a'.repeat(40), configDigest: 'config-1',
    testId: 'T-staging', artifactId: 'artifact-1',
    deploymentId: 'deployment-1', owner: 'user', host: 'authorized-machine',
  };
  const intended = deriveIntendedOutcome(action);
  const identity = {
    provider: 'fixture', connection: 'connection-a', scopeRef: 'project:a',
    definitionRef: 'staging-tests', executionRef: '42',
    attemptKind: 'known', attemptRef: '2',
  };
  const observed = (dispatchId, scopeRef) => ({
    family: 'test', target: intended.target,
    intendedOutcomeDigest: intended.digest,
    status: 'succeeded', providerStatus: 'succeeded', providerVerified: true,
    providerResultId: '42:2',
    causalProof: { kind: 'provider-request', supported: true,
      dispatchId, resultId: '42:2',
      providerRequestId: `request-${dispatchId}`, accepted: true },
    result: {
      executionRef: '42', attemptCapability: 'distinct', attemptRef: '2',
      sourceRevision: action.sourceRevision, configDigest: action.configDigest,
      testId: action.testId, environment: 'STAGING', target: action.target,
      artifactId: action.artifactId, deploymentId: action.deploymentId,
      expectedMet: true, remoteRepositoryURL: action.remoteRepositoryURL,
      executionIdentity: { ...identity, scopeRef },
    },
    evidence: { ref: `fixture:${dispatchId}`, verified: true,
      sha256: digest(dispatchId) },
  });
  const dispatch = id => ({
    id, providerRequestSupported: true,
    providerRequestId: `request-${id}`, status: 'dispatching',
  });
  const first = validateOperationResult(intended, dispatch('first'),
    observed('first', 'project:a'));
  assert.equal(first.status, 'succeeded');
  assert.deepEqual(first.executionIdentity, identity);
  const distinct = validateOperationResult(intended, dispatch('second'),
    observed('second', 'project:b'), { priorResults: [first] });
  assert.equal(distinct.status, 'succeeded');
  const repeated = validateOperationResult(intended, dispatch('third'),
    observed('third', 'project:a'), { priorResults: [first, distinct] });
  assert.deepEqual(repeated, {
    status: 'uncertain',
    reason: 'result-or-request-belongs-to-another-dispatch',
  });
});
