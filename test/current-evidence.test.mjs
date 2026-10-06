import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { digest } from '../src/core.mjs';
import { writeJson } from '../src/files.mjs';
import { deriveIntendedOutcome } from '../src/external-results.mjs';
import { currentArtifact, currentDeployment, matchesProducerExecution,
  requireCurrentSourceRevision } from '../src/current-evidence.mjs';
import { currentCycle, currentTestEvidence, permissionMatches, stagePassed,
  validateEffect } from '../src/authority.mjs';
import { evaluatePolicy, validateAction } from '../src/policy.mjs';
import { evaluateReadiness, publicationAuthority } from '../src/pr.mjs';
import { resume } from '../src/recovery.mjs';
import { recordArtifact, recordTest, stagingHandoff, startCycle } from '../src/validation.mjs';
import { markDispatching, prepareOperation, pruneWork, recordOperation } from '../src/operations.mjs';
import { coding, completeReview, fixture, fixtureArtifact, fixtureBuild, fixtureDeployment, grant,
  observeFixtureRepository, registerFixtureProviderRequest, registerFixtureProviderResult,
  testDefinitions } from './helpers.mjs';

async function cycleFixture(t, configuration) {
  const f = await coding(await fixture(t));
  if (configuration) await writeJson(path.join(f.repo, '.sdlc/config.json'), configuration);
  await f.runGit('add', '.sdlc');
  await f.runGit('commit', '-qm', 'Fixture candidate source');
  await observeFixtureRepository(f);
  const { cycle } = await startCycle(f.store, {
    workItemId: f.workItemId, tests: testDefinitions(),
    configDigest: 'config-1', cause: 'current evidence',
  });
  return { f, cycle };
}

async function localTests(f, cycle) {
  for (const testId of ['T-unit', 'T-integration']) {
    await recordTest(f.store, {
      workItemId: f.workItemId, cycleId: cycle.id, testId,
      status: 'Passed', expectedMet: true, owner: 'agent',
      host: 'local', evidenceRef: `fixture:${testId}`,
    });
  }
}

async function producer(f, cycle) {
  const sourceRevision = cycle.sources[0].revision;
  const remoteRepositoryURL = 'https://example.invalid/repository.git';
  const action = {
    class: 'build', repositoryId: 'primary', localRepositoryPath: f.repo,
    remoteRepositoryURL, sourceRevision, configDigest: cycle.configDigest,
    candidateDigest: cycle.candidateDigest, environment: 'DEV',
    target: 'dev-target', provider: 'fixture', pipeline: 'build',
  };
  const intendedOutcome = deriveIntendedOutcome(action);
  const operation = {
    type: 'operation', id: 'op-artifact-producer', workItemId: f.workItemId,
    repositoryId: 'primary', class: 'build', action, target: 'dev-target',
    status: 'succeeded', dispatchBound: true, requestFingerprint: digest(action),
    correlationKey: 'producer', cycleId: cycle.id,
    candidateDigest: cycle.candidateDigest, intendedOutcome,
    resultProof: { status: 'succeeded', dispatchId: 'op-artifact-producer',
      intendedOutcomeDigest: intendedOutcome.digest,
      providerResultId: 'run-1', resultDigest: digest('fixture-result') },
  };
  await f.store.transaction(f.workItemId, tx => tx.put(operation));
  return operation;
}

test('first local tests pass and a verified producer artifact is admitted before any deployment', async t => {
  const { f, cycle } = await cycleFixture(t, {
    environments: { DEV: { target: 'dev-target', configDigest: 'config-1' } },
  });
  await localTests(f, cycle);
  let state = await f.store.load(f.workItemId);
  assert.equal(stagePassed(currentCycle(state.records, state.checkpoint),
    state.records, 'local', f.clock), true);
  assert.deepEqual(cycle.deployments, {});

  await completeReview(f, cycle);
  await grant(f, 'dev-authorization', {
    cycleId: cycle.id, candidateDigest: cycle.candidateDigest,
    testSpecDigest: cycle.testSpecDigest, configDigest: cycle.configDigest,
    target: 'dev-target', completedStage: 'review',
  });
  const operation = await fixtureBuild(f, cycle);
  const artifact = await fixtureArtifact(f, cycle, operation, { artifactId: 'package-1' });
  state = await f.store.load(f.workItemId);
  assert.equal(artifact.producingOperationId, operation.id);
  assert.equal(artifact.buildRunId, operation.resultProof.providerResultId);
  assert.equal(artifact.producingAttemptCapability, operation.resultProof.attemptCapability);
  assert.equal(artifact.producingAttemptRef, operation.resultProof.attemptRef);
  assert.deepEqual(artifact.producingExecution, operation.resultProof.executionIdentity);
  assert.equal(matchesProducerExecution(operation.resultProof, artifact), true);
  assert.equal(currentArtifact(cycle, state.records, artifact), true);
  const readiness = evaluateReadiness(state.records, {
    environment: 'DEV', repositoryId: 'primary',
    localRepositoryPath: artifact.localRepositoryPath,
    remoteRepositoryURL: artifact.remoteRepositoryURL,
    requireArtifact: true, artifactId: artifact.artifactId,
  }, { cycle: currentCycle(state.records, state.checkpoint) });
  assert.deepEqual(readiness.gaps, []);
  assert.equal(readiness.ready, true);
  const policy = evaluatePolicy(state, {
    class: 'deploy', repositoryId: 'primary', environment: 'DEV',
    target: 'dev-target', configDigest: cycle.configDigest,
    localRepositoryPath: artifact.localRepositoryPath,
    remoteRepositoryURL: artifact.remoteRepositoryURL,
    artifactId: artifact.artifactId, artifactRef: artifact.artifactRef,
    artifactSha256: artifact.artifactSha256,
  }, { clock: f.clock, configuration: {
    environments: { DEV: { target: 'dev-target',
      configDigest: cycle.configDigest } },
  } });
  assert.equal(policy.findings.some(finding =>
    finding.rule === 'artifact-provenance'), false);
  assert.equal(state.records.some(record => record.id === artifact.id &&
    Object.hasOwn(record, 'producerObservation')), false);
  assert.equal(currentCycle(state.records, state.checkpoint).deployments.DEV, undefined);
});

test('a selected artifact and deployment lose readiness when stored producer attempt proof differs or disappears', async t => {
  const { f, cycle } = await cycleFixture(t, {
    environments: { DEV: { target: 'dev-target', configDigest: 'config-1' } },
  });
  await localTests(f, cycle);
  await completeReview(f, cycle);
  await grant(f, 'dev-authorization', {
    cycleId: cycle.id, candidateDigest: cycle.candidateDigest,
    testSpecDigest: cycle.testSpecDigest, configDigest: cycle.configDigest,
    target: 'dev-target', completedStage: 'review',
  });
  const sourceRevision = cycle.sources[0].revision;
  const { operation } = await prepareOperation(f.store, {
    workItemId: f.workItemId, sessionId: f.sessionId,
    action: {
      class: 'build', repositoryId: 'primary', environment: 'DEV',
      target: 'dev-target', provider: 'fixture', pipeline: 'fixture-build',
      monitorCapability: true, sourceRevision, configDigest: cycle.configDigest,
    },
    request: { toolName: 'fixture_build', toolArgs: { attemptRef: '2' }, cwd: f.repo },
    correlationKey: 'distinct-build-attempt', intent: 'Build the candidate on attempt 2',
  });
  registerFixtureProviderRequest(f, operation);
  await markDispatching(f.store, f.workItemId, operation.id);
  const repository = (await f.store.records(f.workItemId)).find(record =>
    record.type === 'repository-observation' && record.repositoryId === 'primary');
  const observedResult = registerFixtureProviderResult(f, operation, {
    providerResultId: 'run-current:2',
    result: {
      remoteRepositoryURL: repository.remoteRepositoryURL,
      executionRef: 'run-current', attemptCapability: 'distinct', attemptRef: '2',
      executionIdentity: {
        provider: repository.provider, connection: repository.connection,
        scopeRef: repository.repositoryRef, definitionRef: 'fixture-build',
        executionRef: 'run-current', attemptKind: 'known', attemptRef: '2',
      },
      sourceRevision, configDigest: cycle.configDigest,
      candidateDigest: cycle.candidateDigest, testSpecDigest: cycle.testSpecDigest,
      environment: 'DEV', target: 'dev-target',
      provider: 'fixture', pipeline: 'fixture-build',
    },
  });
  const producer = await recordOperation(f.store, {
    workItemId: f.workItemId, operationId: operation.id,
    status: 'succeeded', observedResult,
  });
  assert.equal(producer.resultProof.attemptRef, '2');
  const artifactFields = {
    repositoryId: 'primary', localRepositoryPath: f.repo,
    remoteRepositoryURL: repository.remoteRepositoryURL,
    provider: repository.provider, connection: repository.connection,
    repositoryRef: repository.repositoryRef, sourceRevision,
    configDigest: cycle.configDigest, artifactId: 'package-attempt-2',
    artifactRef: 'package-from-attempt-2',
    artifactSha256: digest(Buffer.from('verified artifact bytes from attempt 2')),
    buildRunId: producer.resultProof.providerResultId,
    name: 'package', evidenceRef: 'fixture:artifact-attempt-2',
  };
  f.artifactVerifications.set(producer.id, {
    ...artifactFields, attemptCapability: 'distinct', attemptRef: '2',
    producingExecution: producer.resultProof.executionIdentity,
  });
  const artifact = await recordArtifact(f.store, {
    workItemId: f.workItemId, cycleId: cycle.id, environment: 'DEV',
    sourceDigest: cycle.candidateDigest, artifactType: 'archive',
    status: 'succeeded', producingOperationId: producer.id,
    producerObservation: { fixtureArtifactRef: artifactFields.artifactRef },
    ...artifactFields,
  });
  assert.deepEqual(artifact.producingExecution, producer.resultProof.executionIdentity);
  const deployment = await fixtureDeployment(f, cycle, artifact, { target: 'dev-target' });
  const readiness = (records, selectedCycle) => evaluateReadiness(records, {
    environment: 'DEV', repositoryId: 'primary',
    localRepositoryPath: artifact.localRepositoryPath,
    remoteRepositoryURL: artifact.remoteRepositoryURL,
    requireArtifact: true, artifactId: artifact.artifactId,
  }, { cycle: selectedCycle });
  const assertSelection = (state, eligible) => {
    const selectedCycle = currentCycle(state.records, state.checkpoint);
    const selected = state.records.find(record => record.id === artifact.id);
    const selectedDeployment = state.records.find(record => record.id === deployment.id);
    assert.equal(selectedCycle.artifacts.DEV, eligible ? artifact.id : undefined);
    assert.equal(selectedCycle.deployments.DEV, eligible ? deployment.id : undefined);
    assert.equal(currentArtifact(selectedCycle, state.records, selected), eligible);
    assert.equal(currentDeployment({
      ...selectedCycle,
      artifacts: { ...selectedCycle.artifacts, DEV: artifact.id },
      deployments: { ...selectedCycle.deployments, DEV: deployment.id },
    }, state.records, selectedDeployment, 'DEV'), eligible);
    assert.equal(readiness(state.records, selectedCycle).ready, eligible);
    assert.deepEqual(readiness(state.records, selectedCycle).gaps,
      eligible ? [] : ['current-deployable-artifact-unverified']);
  };
  assertSelection(await f.store.load(f.workItemId), true);

  await f.store.transaction(f.workItemId, tx => {
    const storedArtifact = tx.get(artifact.id);
    storedArtifact.producingAttemptRef = '5';
    storedArtifact.producingExecution.attemptRef = '5';
    tx.put(storedArtifact);
  });
  assertSelection(await f.store.load(f.workItemId), false);

  await f.store.transaction(f.workItemId, tx => {
    const storedArtifact = tx.get(artifact.id);
    storedArtifact.producingAttemptRef = artifact.producingAttemptRef;
    storedArtifact.producingExecution.attemptRef = artifact.producingExecution.attemptRef;
    tx.put(storedArtifact);
  });
  assertSelection(await f.store.load(f.workItemId), true);

  await f.store.transaction(f.workItemId, tx => {
    const storedProducer = tx.get(producer.id);
    delete storedProducer.resultProof.executionIdentity;
    delete storedProducer.resultProof.executionRef;
    delete storedProducer.resultProof.attemptCapability;
    delete storedProducer.resultProof.attemptRef;
    tx.put(storedProducer);
  });
  assertSelection(await f.store.load(f.workItemId), false);
  await resume(f.store, {
    cwd: f.repo, sessionId: f.sessionId, workItemId: f.workItemId,
  });
  assertSelection(await f.store.load(f.workItemId), false);
});

test('a proven build archived before first artifact admission can be selected and retained', async t => {
  const { f, cycle } = await cycleFixture(t, {
    defaultBranch: 'refs/heads/main',
    environments: { DEV: { target: 'dev-target', configDigest: 'config-1' } },
  });
  await localTests(f, cycle);
  await completeReview(f, cycle);
  await grant(f, 'dev-authorization', {
    cycleId: cycle.id, candidateDigest: cycle.candidateDigest,
    testSpecDigest: cycle.testSpecDigest, configDigest: cycle.configDigest,
    target: 'dev-target', completedStage: 'review',
  });
  const producer = await fixtureBuild(f, cycle);
  assert.ok((await pruneWork(f.store, f.workItemId)).archived.includes(producer.id));
  assert.equal((await f.store.records(f.workItemId)).some(record =>
    record.id === producer.id), false);
  const artifact = await fixtureArtifact(f, cycle, producer);
  let state = await f.store.load(f.workItemId);
  assert.equal(currentArtifact(cycle, state.records, artifact), true);
  assert.equal(state.records.find(record => record.id === producer.id)?.resultProof?.providerResultId,
    artifact.buildRunId);
  await pruneWork(f.store, f.workItemId);
  state = await f.store.load(f.workItemId);
  assert.equal(state.records.some(record => record.id === producer.id), true);
  assert.equal(currentArtifact(cycle, state.records, artifact), true);
  await assert.rejects(recordArtifact(f.store, {
    ...Object.fromEntries(['workItemId', 'cycleId', 'artifactId', 'environment',
      'sourceDigest', 'configDigest', 'buildRunId', 'name', 'artifactType',
      'evidenceRef', 'status', 'repositoryId', 'localRepositoryPath',
      'remoteRepositoryURL', 'provider', 'connection', 'repositoryRef',
      'sourceRevision', 'artifactRef', 'artifactSha256',
      'producingOperationId'].map(key => [key, artifact[key]])),
    producingOperationId: 'op-unrelated-producer',
    producerObservation: { fixtureArtifactRef: artifact.artifactRef },
  }), { code: 'EVIDENCE' });
  await f.runGit('commit', '--allow-empty', '-qm', 'Same files, new candidate commit');
  const advanced = await startCycle(f.store, {
    workItemId: f.workItemId, tests: testDefinitions(),
    configDigest: cycle.configDigest, cause: 'candidate advanced',
  });
  await assert.rejects(fixtureArtifact(f, advanced.cycle, producer),
    { code: 'STALE' });
});

test('an empty commit preserves local tests but cannot reuse an artifact from the previous commit', async t => {
  const { f, cycle } = await cycleFixture(t);
  const initial = await f.store.load(f.workItemId);
  assert.equal(await requireCurrentSourceRevision(initial.metadata, cycle, 'primary'),
    cycle.sources[0].revision);
  await localTests(f, cycle);
  const operation = await producer(f, cycle);
  const artifact = {
    type: 'artifact', id: 'artifact-previous-commit', workItemId: f.workItemId,
    cycleId: cycle.id, sequence: 1, artifactId: 'package-1',
    environment: 'DEV', sourceDigest: cycle.candidateDigest,
    configDigest: cycle.configDigest, sourceRevision: cycle.sources[0].revision,
    repositoryId: 'primary', localRepositoryPath: f.repo,
    provider: 'fixture', connection: 'fixture-connection',
    repositoryRef: `repository-${digest('https://example.invalid/repository.git').slice(0, 16)}`,
    remoteRepositoryURL: 'https://example.invalid/repository.git',
    artifactRef: 'hosted-artifact-1', artifactSha256: digest('artifact bytes'),
    producingOperationId: operation.id,
    producingAttemptCapability: 'none', producingAttemptRef: 'not-applicable',
    buildRunId: 'run-1', name: 'package', artifactType: 'archive',
    evidenceRef: 'fixture:artifact', status: 'succeeded',
  };
  await f.store.transaction(f.workItemId, tx => {
    tx.put(artifact);
    const selected = tx.get(cycle.id);
    selected.artifacts.DEV = artifact.id;
    tx.put(selected);
  });
  await f.runGit('commit', '--allow-empty', '-qm', 'Same bytes, different commit');
  const beforeRestart = await f.store.load(f.workItemId);
  assert.equal(stagePassed(currentCycle(beforeRestart.records,
    beforeRestart.checkpoint), beforeRestart.records, 'local', f.clock), true);
  await assert.rejects(requireCurrentSourceRevision(beforeRestart.metadata,
    cycle, 'primary'), { code: 'STALE' });
  const restarted = await startCycle(f.store, {
    workItemId: f.workItemId, tests: testDefinitions(),
    configDigest: cycle.configDigest, cause: 'new commit',
  });
  const state = await f.store.load(f.workItemId);
  const latest = currentCycle(state.records, state.checkpoint);
  assert.equal(restarted.reset, false);
  assert.notEqual(latest.sources[0].revision, artifact.sourceRevision);
  assert.equal(await requireCurrentSourceRevision(state.metadata, latest, 'primary'),
    latest.sources[0].revision);
  assert.equal(stagePassed(latest, state.records, 'local', f.clock), true);
  assert.equal(latest.artifacts.DEV, undefined);
  assert.equal(currentArtifact(latest, state.records, artifact), false);
  await assert.rejects(recordArtifact(f.store, {
    workItemId: f.workItemId, cycleId: latest.id,
    artifactId: artifact.artifactId, environment: 'DEV',
    sourceDigest: latest.candidateDigest, configDigest: latest.configDigest,
    buildRunId: artifact.buildRunId, name: artifact.name,
    artifactType: artifact.artifactType, evidenceRef: artifact.evidenceRef,
    status: 'succeeded', repositoryId: artifact.repositoryId,
    provider: artifact.provider, connection: artifact.connection,
    repositoryRef: artifact.repositoryRef,
    localRepositoryPath: artifact.localRepositoryPath,
    remoteRepositoryURL: artifact.remoteRepositoryURL,
    sourceRevision: artifact.sourceRevision, artifactRef: artifact.artifactRef,
    artifactSha256: artifact.artifactSha256,
    producingOperationId: artifact.producingOperationId,
    producerObservation: { fixture: 'stale' },
  }), { code: 'STALE' });
  assert.equal(evaluateReadiness(state.records, {
    environment: 'DEV', repositoryId: 'primary',
    localRepositoryPath: artifact.localRepositoryPath,
    remoteRepositoryURL: artifact.remoteRepositoryURL,
    requireArtifact: true, artifactId: artifact.artifactId,
  }, { cycle: latest }).ready, false);
});

test('a historical successful deployment without result proof cannot create new STAGING credit', async t => {
  const { f, cycle } = await cycleFixture(t);
  const oldDeployment = {
    type: 'operation', id: 'op-legacy-staging', workItemId: f.workItemId,
    class: 'deploy', repositoryId: 'primary', action: {
      class: 'deploy', environment: 'STAGING', target: 'staging-target',
      artifactId: 'old-package', configDigest: cycle.configDigest,
    }, target: 'staging-target', status: 'succeeded',
    requestFingerprint: digest('old'), correlationKey: 'old',
    dispatchBound: true, cycleId: cycle.id,
    candidateDigest: cycle.candidateDigest, artifactId: 'old-package',
    deploymentSequence: 1,
  };
  await f.store.transaction(f.workItemId, tx => {
    tx.put(oldDeployment);
    const updated = tx.get(cycle.id);
    updated.deployments.STAGING = oldDeployment.id;
    tx.put(updated);
  });
  const state = await f.store.load(f.workItemId);
  const latest = currentCycle(state.records, state.checkpoint);
  assert.equal(currentDeployment(latest, state.records, oldDeployment, 'STAGING'), false);
  await assert.rejects(stagingHandoff(f.store, f.workItemId), { code: 'EVIDENCE' });
  await assert.rejects(grant(f, 'staging-result', {
    cycleId: cycle.id, candidateDigest: cycle.candidateDigest,
    testSpecDigest: cycle.testSpecDigest, configDigest: cycle.configDigest,
    target: 'staging-target', deploymentId: oldDeployment.id,
    artifactId: 'old-package', testIds: ['T-staging'], outcome: 'Passed',
    owner: 'user', host: 'authorized-machine', evidenceRef: 'fixture:old',
  }), { code: 'EVIDENCE' });
  assert.equal(currentTestEvidence(latest, state.records,
    latest.tests.find(item => item.id === 'T-staging'), f.clock), null);
});

test('publication consent for hosted URL A cannot authorize URL B from the same checkout', async t => {
  const { f, cycle } = await cycleFixture(t);
  const firstUrl = 'https://example.invalid/repository.git';
  const secondUrl = 'https://example.invalid/other.git';
  const sourceRevision = cycle.sources[0].revision;
  const permission = await grant(f, 'permission', {
    grant: 'push', target: 'origin', remoteUrlDigest: digest([firstUrl]),
    sourceRef: 'refs/heads/feature/fixture',
    targetRef: 'refs/heads/feature/fixture',
    sourceRevision, force: false, delete: false,
    localRepositoryPath: f.repo, remoteRepositoryURL: firstUrl,
    scope: { repositoryIds: ['primary'] },
  });
  const publication = await grant(f, 'pr-publication', {
    repositoryId: 'primary', sourceRef: 'refs/heads/feature/fixture',
    targetRef: 'refs/heads/main', draft: true,
    target: 'origin', localRepositoryPath: f.repo,
    remoteRepositoryURL: firstUrl, sourceRepositoryURL: firstUrl,
  });
  const action = { class: 'push', repositoryId: 'primary',
    target: 'origin', sourceRef: 'refs/heads/feature/fixture',
    targetRef: 'refs/heads/feature/fixture', sourceRevision,
    force: false, delete: false,
    localRepositoryPath: f.repo, remoteRepositoryURL: firstUrl,
    remoteUrlDigest: digest([firstUrl]) };
  let state = await f.store.load(f.workItemId);
  assert.equal(permissionMatches(permission.event, 'push', action, state.records), true);
  const pr = { class: 'pr-create', repositoryId: 'primary',
    sourceRef: action.sourceRef, targetRef: 'refs/heads/main',
    draft: true, target: 'origin', localRepositoryPath: f.repo,
    remoteRepositoryURL: firstUrl, sourceRepositoryURL: firstUrl };
  assert.equal(publicationAuthority(state.records, pr, f.clock)?.id, publication.event.id);
  const oldPrEffect = {
    repositoryId: 'primary', sourceRef: pr.sourceRef,
    targetRef: pr.targetRef, draft: true,
  };
  assert.throws(() => validateEffect('pr-publication', oldPrEffect,
    { strict: true }), { code: 'INPUT' });
  assert.equal(publicationAuthority([
    { type: 'event', id: 'event-legacy-pr', kind: 'pr-publication',
      effect: oldPrEffect },
  ], pr, f.clock), undefined);
  assert.equal(permissionMatches({
    kind: 'permission', effect: { grant: 'push', target: 'origin',
      remoteUrlDigest: digest([firstUrl]), sourceRef: action.sourceRef,
      targetRef: action.targetRef, force: false, delete: false },
  }, 'push', action, state.records), false);
  await f.runGit('remote', 'set-url', 'origin', secondUrl);
  await observeFixtureRepository(f);
  state = await f.store.load(f.workItemId);
  const other = { ...action, remoteRepositoryURL: secondUrl,
    remoteUrlDigest: digest([secondUrl]) };
  validateAction(other);
  assert.equal(permissionMatches(permission.event, 'push', other, state.records), false);
  assert.equal(publicationAuthority(state.records, { ...pr,
    remoteRepositoryURL: secondUrl, sourceRepositoryURL: secondUrl }, f.clock), undefined);
  assert.ok(evaluatePolicy(state, other, { clock: f.clock }).findings.some(
    finding => finding.rule === 'push' && finding.verdict === 'violation'));
  assert.doesNotThrow(() => validateAction({ ...other, class: 'artifact-produce' }));
  assert.throws(() => validateAction({ ...other, class: 'unsupported-artifact-production' }),
    { code: 'INPUT' });
  assert.throws(() => validateAction({ ...other,
    sourceRepositoryURL: 'https://user:secret@example.invalid/other.git' }),
  { code: 'INPUT' });
  assert.throws(() => validateAction({ ...other, artifactSha256: 'not-a-digest' }),
    { code: 'INPUT' });
});
