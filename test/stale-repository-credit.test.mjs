import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import { digest } from '../src/core.mjs';
import { writeJson } from '../src/files.mjs';
import { currentCycle, currentTestEvidence, stagePassed } from '../src/authority.mjs';
import { currentArtifact, currentDeployment,
  selectedRepositoryIdentity } from '../src/current-evidence.mjs';
import { markDispatching, prepareOperation, recordOperation } from '../src/operations.mjs';
import { recordTest, startCycle } from '../src/validation.mjs';
import { status } from '../src/recovery.mjs';
import { coding, completeReview, fixture, fixtureArtifact, fixtureBuild,
  fixtureDeployment, grant, observeFixtureRepository,
  registerFixtureProviderRequest, registerFixtureProviderResult } from './helpers.mjs';

const remoteA = 'https://example.invalid/repository.git';
const remoteB = 'https://example.invalid/other-repository.git';

test('local-only admission does not require or snapshot an external repository pair', async t => {
  const f = await coding(await fixture(t, { compactPath: true }));
  const planPath = path.join(f.repo, 'docs', 'test-plan.md');
  const plan = await fs.readFile(planPath, 'utf8');
  await fs.writeFile(planPath, plan.split('\n').filter(line =>
    !line.startsWith('| T-dev |') && !line.startsWith('| T-staging |')).join('\n'));
  await writeJson(path.join(f.repo, '.sdlc', 'config.json'), {
    remote: 'selected-but-missing',
  });
  await f.runGit('remote', 'remove', 'origin');
  const { cycle } = await startCycle(f.store, {
    workItemId: f.workItemId, configDigest: 'local-only-configuration',
    cause: 'local tests have no hosted repository dependency',
  });
  assert.ok(cycle.tests.every(item => item.environment === 'local'));
  for (const testId of ['T-unit', 'T-integration']) {
    await recordTest(f.store, {
      workItemId: f.workItemId, cycleId: cycle.id, testId,
      status: 'Passed', expectedMet: true, owner: 'agent', host: 'local',
      evidenceRef: `fixture:local-only:${testId}`,
    });
  }
  const state = await f.store.load(f.workItemId);
  assert.equal(stagePassed(currentCycle(state.records, state.checkpoint),
    state.records, 'local', f.clock), true);
  assert.equal(state.repositoryIdentities.size, 0,
    'No fetch destination is inspected for a local-only validation transaction');
  assert.equal(selectedRepositoryIdentity(state.records, 'primary'), undefined);
});

async function provenCandidate(t, { secondary = false,
  snapshotBeforeProof = false } = {}) {
  const f = await coding(await fixture(t, { compactPath: true }));
  const configuration = {
    defaultBranch: 'refs/heads/main',
    environments: { DEV: { target: 'dev-target',
      configDigest: 'configuration-1', allowedStages: ['DEV'] } },
  };
  await writeJson(path.join(f.repo, '.sdlc', 'config.json'), configuration);
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Disposable proven candidate');
  let other;
  if (secondary) {
    other = await fixture(t, { initialize: false, compactPath: true });
    await fs.writeFile(path.join(other.repo, 'candidate.txt'), 'secondary source\n');
    await other.runGit('add', '.');
    await other.runGit('commit', '-qm', 'Disposable secondary candidate');
    await f.store.bindMember({ workItemId: f.workItemId,
      repositoryId: 'secondary', cwd: other.repo, sessionId: 'secondary-session' });
  }
  const repository = await observeFixtureRepository(f);
  const { cycle } = await startCycle(f.store, {
    workItemId: f.workItemId, configDigest: 'configuration-1',
    cause: 'prove the original checkout and fetch URL',
  });
  for (const testId of ['T-unit', 'T-integration']) {
    await recordTest(f.store, {
      workItemId: f.workItemId, cycleId: cycle.id, testId,
      status: 'Passed', expectedMet: true, owner: 'agent', host: 'local',
      evidenceRef: `fixture:local:${testId}`,
    });
  }
  await completeReview(f, cycle);
  await grant(f, 'dev-authorization', {
    cycleId: cycle.id, candidateDigest: cycle.candidateDigest,
    testSpecDigest: cycle.testSpecDigest, configDigest: cycle.configDigest,
    target: 'dev-target', completedStage: 'review',
  });
  if (snapshotBeforeProof) {
    const action = {
      class: 'build', repositoryId: 'primary', environment: 'DEV',
      target: 'dev-target', provider: repository.provider,
      pipeline: 'prepared-without-external-proof', monitorCapability: true,
      sourceRevision: cycle.sources[0].revision,
      configDigest: cycle.configDigest,
    };
    const { operation } = await prepareOperation(f.store, {
      workItemId: f.workItemId, sessionId: f.sessionId, action,
      request: { toolName: 'fixture_snapshot_build', toolArgs: { action },
        cwd: f.repo },
      correlationKey: 'prepared-without-external-proof',
      intent: 'Prepare only; do not claim external execution or artifact proof',
    });
    assert.equal(operation.status, 'prepared');
    assert.equal(operation.resultProof, undefined);
    const state = await f.store.load(f.workItemId);
    assert.equal(state.repositoryIdentities.size, 0,
      'Preparation alone creates no eligible hosted credit to snapshot during local reads');
  }
  const producer = await fixtureBuild(f, cycle);
  const artifact = await fixtureArtifact(f, cycle, producer);
  const deployment = await fixtureDeployment(f, cycle, artifact, {
    target: 'dev-target',
  });
  const action = {
    class: 'test', repositoryId: 'primary', environment: 'DEV',
    target: 'dev-target', configDigest: cycle.configDigest,
    testId: 'T-dev', owner: 'agent', host: 'development-machine',
    artifactId: artifact.artifactId, deploymentId: deployment.id,
  };
  const { operation } = await prepareOperation(f.store, {
    workItemId: f.workItemId, sessionId: f.sessionId, action,
    request: { toolName: 'fixture_test', toolArgs: {
      testId: action.testId, deploymentId: deployment.id }, cwd: f.repo },
    correlationKey: 'proven-dev-test', intent: 'Test the proven A deployment',
  });
  const request = registerFixtureProviderRequest(f, operation);
  await markDispatching(f.store, f.workItemId, operation.id);
  const executionRef = `run-${digest(request.providerRequestId).slice(0, 16)}`;
  const observedResult = registerFixtureProviderResult(f, operation, {
    providerResultId: `${executionRef}:not-applicable`,
    result: {
      executionRef, attemptCapability: 'none', attemptRef: 'not-applicable',
      executionIdentity: {
        provider: repository.provider, connection: repository.connection,
        scopeRef: repository.repositoryRef, executionRef,
        attemptKind: 'not-applicable',
      },
      remoteRepositoryURL: remoteA,
      sourceRevision: operation.intendedOutcome.requested.sourceRevision,
      configDigest: cycle.configDigest, candidateDigest: cycle.candidateDigest,
      testSpecDigest: cycle.testSpecDigest, environment: 'DEV',
      target: 'dev-target', testId: 'T-dev', expectedMet: true,
      artifactId: artifact.artifactId, deploymentId: deployment.id,
    },
  });
  const execution = await recordOperation(f.store, {
    workItemId: f.workItemId, operationId: operation.id,
    status: 'succeeded', observedResult,
  });
  assert.equal(execution.status, 'succeeded',
    'The regression requires genuine, complete execution proof before changing the remote');
  const input = {
    workItemId: f.workItemId, cycleId: cycle.id, testId: 'T-dev',
    status: 'Passed', expectedMet: true, owner: 'agent',
    host: 'development-machine', evidenceRef: 'fixture:proven-dev-test',
    artifactId: artifact.artifactId, deploymentId: deployment.id,
    operationId: execution.id,
  };
  const evidence = await recordTest(f.store, input);
  const state = await f.store.load(f.workItemId);
  assert.equal(stagePassed(currentCycle(state.records, state.checkpoint),
    state.records, 'DEV', f.clock), true);
  const history = await Promise.all([producer, artifact, deployment, execution,
    evidence].map(async record => ({
    file: f.store.recordPath(f.workItemId, record.id),
    bytes: await fs.readFile(f.store.recordPath(f.workItemId, record.id)),
  })));
  return { ...f, other, cycle, producer, artifact, deployment, execution,
    evidence, input, history, configuration };
}

async function unchangedHistory(f) {
  for (const { file, bytes } of f.history) {
    assert.deepEqual(await fs.readFile(file), bytes,
      'Prior A proofs must remain byte-for-byte historical evidence');
  }
}

test('preparation without hosted result proof does not snapshot pairs during unrelated local reads', async t => {
  const f = await provenCandidate(t, { snapshotBeforeProof: true });
  assertCurrentCredit(await f.store.load(f.workItemId), f, true);
});

function assertCurrentCredit(state, f, eligible) {
  const cycle = currentCycle(state.records, state.checkpoint);
  assert.equal(cycle.artifacts.DEV, eligible ? f.artifact.id : undefined);
  assert.equal(cycle.deployments.DEV, eligible ? f.deployment.id : undefined);
  assert.equal(currentArtifact(cycle, state.records, f.artifact), eligible);
  assert.equal(currentDeployment({ ...cycle, deployments: {
    ...cycle.deployments, DEV: f.deployment.id } }, state.records,
  f.deployment, 'DEV'), eligible);
  assert.equal(stagePassed(cycle, state.records, 'DEV', f.clock), eligible,
    'An A deployment cannot earn effective DEV credit for the currently selected B URL');
  assert.equal(currentTestEvidence(cycle, state.records,
    cycle.tests.find(item => item.id === 'T-dev'), f.clock)?.status,
  eligible ? 'Passed' : undefined);
  assert.equal(stagePassed(cycle, state.records, 'local', f.clock), true,
    'Changing a fetch URL must not invalidate content-bound local test credit');
}

test('public environment admission rejects A proof after fetch URL changes to B at the same HEAD and content', async t => {
  const f = await provenCandidate(t);
  const head = await f.runGit('rev-parse', 'HEAD');
  const contentStatus = await f.runGit('status', '--porcelain');
  await f.runGit('remote', 'set-url', 'origin', remoteB);
  assert.equal(await f.runGit('rev-parse', 'HEAD'), head);
  assert.equal(await f.runGit('status', '--porcelain'), contentStatus,
    'Only disposable Git remote configuration changed');
  await assert.rejects(recordTest(f.store, {
    ...f.input, evidenceRef: 'fixture:must-not-credit-stale-repository',
  }), error => ['EVIDENCE', 'STALE'].includes(error.code),
  'Public recordTest must reject stale repository proof, not accept another Passed result');
  await unchangedHistory(f);
});

test('load recovery and status do not restore stale A artifact, deployment or effective DEV credit', async t => {
  const f = await provenCandidate(t);
  await f.runGit('remote', 'set-url', 'origin', remoteB);
  assertCurrentCredit(await f.store.load(f.workItemId), f, false);
  const summary = await status(f.store, f.workItemId);
  assert.equal(summary.repositories[0].remoteRepositoryURL, remoteB);
  await f.store.transaction(f.workItemId, () => {});
  assertCurrentCredit(await f.store.load(f.workItemId), f, false);
  await unchangedHistory(f);
  await f.runGit('remote', 'set-url', 'origin', remoteA);
  assertCurrentCredit(await f.store.load(f.workItemId), f, true);
  await unchangedHistory(f);
});

test('missing or ambiguous fetch selection invalidates external credit explicitly and restoration needs still-valid proof', async t => {
  const f = await provenCandidate(t);
  await f.runGit('remote', 'remove', 'origin');
  assertCurrentCredit(await f.store.load(f.workItemId), f, false);
  assert.match((await status(f.store, f.workItemId)).repositories[0].evidenceGap,
    /unique|remote/u);
  await f.runGit('remote', 'add', 'origin', remoteA);
  await f.runGit('config', '--add', 'remote.origin.url', remoteB);
  assertCurrentCredit(await f.store.load(f.workItemId), f, false);
  assert.match((await status(f.store, f.workItemId)).repositories[0].evidenceGap,
    /single|URL/u);
  await f.runGit('config', '--unset-all', 'remote.origin.url');
  await f.runGit('config', '--add', 'remote.origin.url', remoteA);
  assertCurrentCredit(await f.store.load(f.workItemId), f, true);
  const legacyProducer = structuredClone(f.producer);
  delete legacyProducer.resultProof.executionIdentity;
  await writeJson(f.store.recordPath(f.workItemId, f.producer.id), legacyProducer);
  const legacyBytes = await fs.readFile(f.store.recordPath(f.workItemId, f.producer.id));
  assertCurrentCredit(await f.store.load(f.workItemId), f, false);
  assert.deepEqual(await fs.readFile(f.store.recordPath(f.workItemId, f.producer.id)),
    legacyBytes, 'Restoring A never upgrades an incomplete historical producer');
});

test('selected configuration and repository members cannot transfer external credit across hosted URLs', async t => {
  const f = await provenCandidate(t, { secondary: true });
  await f.other.runGit('remote', 'set-url', 'origin', remoteB);
  assertCurrentCredit(await f.store.load(f.workItemId), f, true);
  await f.runGit('remote', 'add', 'alternate', remoteB);
  await writeJson(path.join(f.repo, '.sdlc', 'config.json'), {
    ...f.configuration, remote: 'alternate',
  });
  assertCurrentCredit(await f.store.load(f.workItemId), f, false);
  await writeJson(path.join(f.repo, '.sdlc', 'config.json'), {
    ...f.configuration, remote: 'origin',
  });
  assertCurrentCredit(await f.store.load(f.workItemId), f, true);
  await f.runGit('remote', 'set-url', 'origin', remoteB);
  assertCurrentCredit(await f.store.load(f.workItemId), f, false);
  await unchangedHistory(f);
});

test('legacy environment execution proof without full hosted identity cannot earn new admission or recovery credit', async t => {
  const f = await provenCandidate(t);
  const legacyExecution = structuredClone(f.execution);
  delete legacyExecution.resultProof.executionIdentity;
  await writeJson(f.store.recordPath(f.workItemId, f.execution.id), legacyExecution);
  const legacyBytes = await fs.readFile(f.store.recordPath(f.workItemId, f.execution.id));
  await assert.rejects(recordTest(f.store, {
    ...f.input, evidenceRef: 'fixture:must-not-upgrade-legacy-test',
  }), { code: 'OPERATION' });
  const state = await f.store.load(f.workItemId);
  const cycle = currentCycle(state.records, state.checkpoint);
  assert.equal(cycle.artifacts.DEV, f.artifact.id);
  assert.equal(cycle.deployments.DEV, f.deployment.id);
  assert.equal(stagePassed(cycle, state.records, 'DEV', f.clock), false);
  assert.equal(stagePassed(cycle, state.records, 'local', f.clock), true);
  assert.equal(currentTestEvidence(cycle, state.records,
    cycle.tests.find(item => item.id === 'T-dev'), f.clock), null);
  await f.store.transaction(f.workItemId, () => {});
  assert.deepEqual(await fs.readFile(f.store.recordPath(f.workItemId, f.execution.id)),
    legacyBytes, 'Recovery must not fabricate full hosted execution identity');
});
