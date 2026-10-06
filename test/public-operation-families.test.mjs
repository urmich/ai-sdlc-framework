import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { digest } from '../src/core.mjs';
import { ACTIONS, isExternalAction, evaluatePolicy } from '../src/policy.mjs';
import { prepareOperation, markDispatching, recordOperation, pruneWork } from '../src/operations.mjs';
import { classifyTool, evaluateGate, gate } from '../src/gate.mjs';
import { Store } from '../src/store.mjs';
import { currentArtifact } from '../src/current-evidence.mjs';
import { loadConfig } from '../src/artifacts.mjs';
import { startCycle, recordArtifact } from '../src/validation.mjs';
import { fixture, coding, grant, orient, observeFixtureRepository,
  registerFixtureProviderRequest, registerFixtureProviderResult,
  finishFixtureOperation, testDefinitions } from './helpers.mjs';

async function setup(t) {
  const f = await coding(await fixture(t));
  await fs.writeFile(path.join(f.repo, '.sdlc', 'config.json'), JSON.stringify({
    defaultBranch: 'refs/heads/main',
    environments: { DEV: { target: 'dev-target', configDigest: 'config-v1' },
      STAGING: { target: 'staging-target', configDigest: 'config-v1' } },
  }));
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Public operation families fixture');
  const repository = await observeFixtureRepository(f);
  const revision = await f.runGit('rev-parse', 'HEAD');
  const base = { repositoryId: 'primary', localRepositoryPath: f.repo,
    remoteRepositoryURL: repository.remoteRepositoryURL,
    provider: repository.provider, sourceRevision: revision, configDigest: 'config-v1' };
  const prepare = (key, action) => prepareOperation(f.store, {
    workItemId: f.workItemId, sessionId: f.sessionId, action,
    correlationKey: key, intent: 'Exercise the isolated public operation boundary',
    request: { toolName: `fixture_${action.class}`,
      toolArgs: { action, attempt: key }, cwd: f.repo },
  });
  return { f, repository, base, prepare };
}

async function authorizeFixture(f, action) {
  const state = await f.store.load(f.workItemId);
  const decision = evaluatePolicy(state, action, {
    clock: f.clock, configuration: await loadConfig(state.metadata, 'primary'),
  });
  const rules = [...new Set(decision.findings.filter(finding => finding.verdict === 'violation')
    .map(finding => finding.rule))];
  if (rules.length) await grant(f, 'override', { rules,
    scope: { repositoryIds: ['primary'], actions: [action.class],
      ...(action.target === undefined ? {} : { target: action.target }) },
    reason: 'Isolated family proof test deliberately waives lifecycle prerequisites only',
  });
}

async function complete(f, operation, result, providerResultId, { reconcile = false } = {}) {
  registerFixtureProviderRequest(f, operation);
  await markDispatching(f.store, f.workItemId, operation.id);
  if (reconcile) await recordOperation(f.store, { workItemId: f.workItemId,
    operationId: operation.id, status: 'uncertain' });
  const observedResult = registerFixtureProviderResult(f, operation, {
    providerResultId, result,
  });
  const input = { workItemId: f.workItemId, operationId: operation.id,
    status: 'succeeded', observedResult };
  const recorded = await recordOperation(f.store, input, { reconcile });
  assert.equal(recorded.status, 'succeeded', recorded.resultGap);
  assert.deepEqual(await recordOperation(f.store, input), recorded);
  return recorded;
}

test('T-129 valid artifact and notification actions prepare through the public API', async t => {
  const { f, base, prepare } = await setup(t);
  for (const kind of ['artifact', 'artifact-produce', 'notification']) {
    const action = { ...base, class: kind, ...(kind === 'notification' ?
      { recipient: 'fixture-recipient', contentDigest: digest('message') } :
      { artifactId: `package-${kind}`, artifactName: 'package',
        producingExecutionRef: 'build-run', producingAttemptRef: 'not-applicable' }) };
    const operation = (await prepare(`prepare-${kind}`, action)).operation;
    assert.ok(ACTIONS.includes(kind), `${kind} must be publicly registered`);
    assert.equal(isExternalAction(action), true);
    assert.equal(operation.status, 'prepared');
    assert.equal(operation.intendedOutcome.family, kind === 'notification' ? 'notification' : 'artifact');
    await assert.rejects(prepare(`duplicate-${kind}`, action), { code: 'UNCERTAIN' });
  }
  assert.equal((await f.store.records(f.workItemId))
    .filter(record => record.type === 'operation').length, 3);
});

test('T-129 all hosted public families prepare dispatch and reconcile their exact result', async t => {
  const { f, base, prepare } = await setup(t);
  const branch = 'refs/heads/feature/fixture';
  const main = 'refs/heads/main';
  const pr = { sourceRepositoryURL: base.remoteRepositoryURL,
    sourceRef: branch, targetRef: main, targetRevision: base.sourceRevision, draft: true };
  const execution = { executionRef: 'family-run', attemptCapability: 'none',
    attemptRef: 'not-applicable', provider: base.provider,
    sourceRevision: base.sourceRevision, configDigest: base.configDigest,
    executionIdentity: { provider: base.provider, connection: 'fixture-connection',
      scopeRef: 'family-scope', executionRef: 'family-run', attemptKind: 'not-applicable' } };
  const examples = [
    ...['build', 'pipeline', 'pr-validation'].map(kind => [kind,
      { environment: 'DEV', target: 'dev-target', pipeline: `family-${kind}` },
      { ...execution, environment: 'DEV', target: 'dev-target', pipeline: `family-${kind}`,
        executionIdentity: { ...execution.executionIdentity, definitionRef: `family-${kind}` } },
      'family-run:not-applicable']),
    ['test', { environment: 'DEV', target: 'dev-target', testId: 'T-dev',
      artifactId: 'package', deploymentId: 'deployment' },
    { ...execution, environment: 'DEV', target: 'dev-target', testId: 'T-dev',
      artifactId: 'package', deploymentId: 'deployment', expectedMet: true },
    'family-run:not-applicable'],
    ...['artifact', 'artifact-produce'].map(kind => [kind,
      { artifactId: kind, artifactName: 'package', producingExecutionRef: 'family-run',
        producingAttemptRef: 'not-applicable' },
      { ...execution, artifactId: kind, artifactName: 'package', artifactRef: `${kind}-ref`,
        sha256: digest(kind) }, `${kind}-ref`]),
    ['deploy', { environment: 'DEV', target: 'dev-target', artifactId: 'package',
      artifactRef: 'package-ref', artifactSha256: digest('package') },
    { environment: 'DEV', target: 'dev-target', artifactId: 'package',
      artifactRef: 'package-ref', artifactSha256: digest('package'), deploymentRef: 'deployment',
      sourceRevision: base.sourceRevision, configDigest: base.configDigest }, 'deployment'],
    ['pr-create', pr, { ...pr, sourceRevision: base.sourceRevision,
      targetRepositoryURL: base.remoteRepositoryURL, prId: '123' }, '123'],
    ['pr-update', { ...pr, prId: '123' }, { ...pr, sourceRevision: base.sourceRevision,
      targetRepositoryURL: base.remoteRepositoryURL, prId: '123' }, '123'],
    ['push', { target: 'origin', sourceRef: branch, targetRef: branch,
      remoteUrlDigest: digest([base.remoteRepositoryURL]), force: false, delete: false },
    { destination: 'origin', ref: branch, revision: base.sourceRevision, published: true,
      remoteUrlDigest: digest([base.remoteRepositoryURL]) }, `origin:${branch}`],
    ['merge', { prId: '123', targetRevision: base.sourceRevision },
    { prId: '123', targetRevision: base.sourceRevision, sourceRevision: base.sourceRevision,
      merged: true, mergeRevision: 'b'.repeat(40) }, `123:${'b'.repeat(40)}`],
    ...['configuration', 'auto-merge', 'policy-bypass'].map(kind => [kind,
      { target: `policy-${kind}`, policyVersion: 'v2', ...(kind === 'auto-merge' ? { prId: '123' } : {}) },
      { target: `policy-${kind}`, policyVersion: 'v2', changeApplied: true,
        ...(kind === 'auto-merge' ? { prId: '123', autoMergeEnabled: true } : {}) }, `policy-${kind}:v2`]),
    ['notification', { recipient: 'recipient', contentDigest: digest('notice') },
    { recipient: 'recipient', contentDigest: digest('notice'), delivered: true,
      deliveryReceipt: 'delivery-receipt' }, 'delivery-receipt'],
  ];
  for (const [kind, requested, result, resultId] of examples) {
    await t.test(kind, async () => {
      const action = { ...base, class: kind, ...requested };
      await authorizeFixture(f, action);
      const operation = (await prepare(`public-${kind}`, action)).operation;
      const observed = { remoteRepositoryURL: base.remoteRepositoryURL, ...result };
      if (['build', 'pipeline', 'pr-validation', 'test'].includes(kind)) {
        observed.executionRef = `${kind}-run`;
        observed.executionIdentity = { ...observed.executionIdentity,
          executionRef: observed.executionRef };
      }
      await complete(f, operation, observed,
        ['build', 'pipeline', 'pr-validation', 'test'].includes(kind) ?
          `${observed.executionRef}:not-applicable` : resultId, { reconcile: true });
    });
  }
});

test('T-129 notification labels queues wrong recipient or missing receipt cannot grant success or environment authority', async t => {
  const { f, base, prepare } = await setup(t);
  const action = { ...base, class: 'notification',
    recipient: 'recipient', contentDigest: digest('notice') };
  const operation = (await prepare('notification-proof', action)).operation;
  registerFixtureProviderRequest(f, operation);
  await markDispatching(f.store, f.workItemId, operation.id);
  const label = await recordOperation(f.store, { workItemId: f.workItemId,
    operationId: operation.id, status: 'succeeded', evidenceRef: 'fixture:queued' });
  assert.equal(label.status, 'uncertain');
  for (const mutation of [{ recipient: 'other' }, { contentDigest: digest('other') },
    { delivered: false }, { deliveryReceipt: undefined }]) {
    const observedResult = registerFixtureProviderResult(f, operation, {
      providerResultId: 'delivery', result: JSON.parse(JSON.stringify({ remoteRepositoryURL: base.remoteRepositoryURL,
        recipient: action.recipient, contentDigest: action.contentDigest,
        delivered: true, deliveryReceipt: 'delivery', ...mutation })),
    });
    const result = await recordOperation(f.store, { workItemId: f.workItemId,
      operationId: operation.id, status: 'succeeded', observedResult }, { reconcile: true });
    assert.equal(result.status, 'uncertain');
    assert.equal(result.resultProof, undefined);
  }
  const observedResult = registerFixtureProviderResult(f, operation, {
    providerResultId: 'delivery', result: { remoteRepositoryURL: base.remoteRepositoryURL,
      recipient: action.recipient, contentDigest: action.contentDigest,
      delivered: true, deliveryReceipt: 'delivery' },
  });
  assert.equal((await recordOperation(f.store, { workItemId: f.workItemId,
    operationId: operation.id, status: 'succeeded', observedResult }, { reconcile: true })).status, 'succeeded');
  const state = await f.store.load(f.workItemId);
  assert.equal(state.records.filter(record => record.type === 'test-evidence').length, 0);
  const denied = evaluatePolicy(state, { ...base, class: 'build',
    pipeline: 'build', environment: 'DEV', target: 'dev-target' },
  { clock: f.clock, configuration: await loadConfig(state.metadata, 'primary') });
  assert.equal(denied.allowed, false);
  assert.ok(denied.findings.some(finding => finding.rule === 'dev-authorization' &&
    finding.verdict === 'violation'));
});

test('T-129 public artifact production corroborates the build and recordArtifact chain', async t => {
  const { f, repository, base, prepare } = await setup(t);
  const cycle = (await startCycle(f.store, { workItemId: f.workItemId,
    tests: testDefinitions(), configDigest: base.configDigest, cause: 'Artifact chain' })).cycle;
  const buildAction = { ...base, class: 'build', environment: 'DEV',
    target: 'dev-target', pipeline: 'artifact-build' };
  await authorizeFixture(f, buildAction);
  const build = await finishFixtureOperation(f, (await prepare('artifact-build', buildAction)).operation);
  const action = { ...base, class: 'artifact-produce', artifactId: 'package',
    artifactName: 'package', producingExecutionRef: build.resultProof.executionRef,
    producingAttemptRef: build.resultProof.attemptRef };
  const operation = (await prepare('artifact-production', action)).operation;
  const producingExecution = build.resultProof.executionIdentity;
  const fields = { repositoryId: 'primary', localRepositoryPath: f.repo,
    remoteRepositoryURL: base.remoteRepositoryURL, provider: base.provider,
    connection: repository.connection, repositoryRef: repository.repositoryRef,
    sourceRevision: base.sourceRevision, configDigest: base.configDigest,
    artifactId: action.artifactId, artifactRef: 'package-ref', artifactSha256: digest('bytes'),
    buildRunId: build.resultProof.providerResultId, name: 'package', evidenceRef: 'fixture:package' };
  await complete(f, operation, { remoteRepositoryURL: base.remoteRepositoryURL,
    artifactId: fields.artifactId, artifactRef: fields.artifactRef, artifactName: fields.name,
    sha256: fields.artifactSha256, sourceRevision: fields.sourceRevision,
    configDigest: fields.configDigest, executionRef: build.resultProof.executionRef,
    attemptCapability: build.resultProof.attemptCapability, attemptRef: build.resultProof.attemptRef,
    executionIdentity: producingExecution }, fields.artifactRef);
  f.artifactVerifications.set(build.id, { ...fields, producingExecution,
    attemptCapability: build.resultProof.attemptCapability, attemptRef: build.resultProof.attemptRef });
  const selected = await recordArtifact(f.store, { ...fields, workItemId: f.workItemId,
    cycleId: cycle.id, environment: 'DEV', sourceDigest: cycle.candidateDigest,
    producingOperationId: build.id, artifactType: 'archive', status: 'succeeded',
    producerObservation: { fixtureArtifactRef: fields.artifactRef } });
  assert.equal(selected.artifactSha256, fields.artifactSha256);
  assert.deepEqual(selected.producingExecution, producingExecution);
  assert.equal(selected.producingOperationId, build.id);
  const ready = await f.store.load(f.workItemId);
  assert.equal(currentArtifact(ready.records.find(record => record.id === cycle.id),
    ready.records, selected), true);
  await f.store.transaction(f.workItemId, tx => {
    const historicalBuild = tx.get(build.id);
    delete historicalBuild.resultProof.executionIdentity;
    tx.put(historicalBuild);
  });
  const historical = await f.store.load(f.workItemId);
  assert.equal(currentArtifact(historical.records.find(record => record.id === cycle.id),
    historical.records, selected), false,
  'Readable historical producer proof with unknown identity cannot retain artifact readiness');
});

test('T-129 public artifact proof rejects incomplete immutable content producer attempt and source', async t => {
  const { f, base, prepare } = await setup(t);
  const action = { ...base, class: 'artifact', artifactId: 'package',
    artifactName: 'package', artifactRef: 'package-ref', artifactSha256: digest('bytes'),
    producingExecutionRef: 'producer', producingAttemptRef: '2' };
  const operation = (await prepare('artifact-proof', action)).operation;
  registerFixtureProviderRequest(f, operation);
  await markDispatching(f.store, f.workItemId, operation.id);
  const result = { remoteRepositoryURL: base.remoteRepositoryURL,
    artifactId: action.artifactId, artifactName: action.artifactName,
    artifactRef: action.artifactRef, sha256: action.artifactSha256,
    sourceRevision: base.sourceRevision, configDigest: base.configDigest,
    executionRef: 'producer', attemptCapability: 'distinct', attemptRef: '2',
    executionIdentity: { provider: base.provider, connection: 'fixture-connection',
      scopeRef: 'producer-scope', executionRef: 'producer', attemptKind: 'known', attemptRef: '2' } };
  for (const mutation of [{ sha256: undefined }, { sha256: digest('other') },
    { executionIdentity: undefined }, { executionRef: 'other' },
    { attemptRef: 'unknown' }, { sourceRevision: 'b'.repeat(40) },
    { configDigest: 'other' }]) {
    const observedResult = registerFixtureProviderResult(f, operation, {
      providerResultId: action.artifactRef,
      result: JSON.parse(JSON.stringify({ ...result, ...mutation })),
    });
    const checked = await recordOperation(f.store, { workItemId: f.workItemId,
      operationId: operation.id, status: 'succeeded', observedResult }, { reconcile: true });
    assert.equal(checked.status, 'uncertain');
    assert.equal(checked.resultProof, undefined);
  }
  const observedResult = registerFixtureProviderResult(f, operation, {
    providerResultId: action.artifactRef, result,
  });
  assert.equal((await recordOperation(f.store, { workItemId: f.workItemId,
    operationId: operation.id, status: 'succeeded', observedResult }, { reconcile: true })).status, 'succeeded');
});

test('T-129 a configured notification adapter binds the public gate without transferring authority', async t => {
  const { f, base, prepare } = await setup(t);
  const action = { ...base, class: 'notification',
    recipient: 'recipient', contentDigest: digest('gate-message') };
  const toolArgs = { action, attempt: 'notification-gate' };
  const configPath = path.join(f.repo, '.sdlc', 'config.json');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  config.toolAdapters = [{ toolName: 'fixture_notification', match: toolArgs, action }];
  await fs.writeFile(configPath, JSON.stringify(config));
  await orient(f);
  const request = { sessionId: f.sessionId, cwd: f.repo,
    toolName: 'fixture_notification', toolArgs };
  const state = await f.store.load(f.workItemId);
  const member = state.metadata.members[0];
  const classified = await classifyTool(f.store, request, state, member,
    await loadConfig(state.metadata, 'primary'));
  assert.equal(classified[0].class, 'notification');
  assert.equal((await evaluateGate(f.store, request)).error, 'OPERATION');
  const operation = (await prepare('notification-gate', action)).operation;
  await markDispatching(f.store, f.workItemId, operation.id);
  const gate = await evaluateGate(f.store, request);
  assert.equal(gate.error, undefined, gate.permissionDecisionReason);
  assert.equal((await f.store.records(f.workItemId))
    .find(record => record.id === operation.id).dispatchBound, true);
});

test('T-129 public local build and local test retain their local result contract', async t => {
  const { f, prepare } = await setup(t);
  for (const kind of ['local-build', 'test']) {
    const action = { class: kind, repositoryId: 'primary', target: 'local',
      ...(kind === 'test' ? { environment: 'local', testId: 'T-unit' } : {}) };
    await authorizeFixture(f, action);
    const operation = (await prepare(`local-${kind}`, action)).operation;
    assert.equal(isExternalAction(action), false);
    assert.equal(operation.intendedOutcome, undefined);
    await markDispatching(f.store, f.workItemId, operation.id);
    const completed = await recordOperation(f.store, { workItemId: f.workItemId,
      operationId: operation.id, status: 'succeeded', target: operation.target,
      requestFingerprint: operation.requestFingerprint, evidenceRef: `fixture:local-${kind}`,
      ...(kind === 'test' ? { expectedMet: true } : {}) });
    assert.equal(completed.status, 'succeeded');
  }
});

test('closure artifact aliases share unresolved effect identity but retain exact scoped action authority', async t => {
  const { f, base, prepare } = await setup(t);
  for (const [firstKind, retryKind] of [['artifact', 'artifact-produce'],
    ['artifact-produce', 'artifact']]) {
    const action = { ...base, class: firstKind, artifactId: `alias-${firstKind}`,
      artifactName: 'package', producingExecutionRef: 'producer',
      producingAttemptRef: '2' };
    const first = (await prepare(`alias-first-${firstKind}`, action)).operation;
    await markDispatching(f.store, f.workItemId, first.id);
    await recordOperation(f.store, { workItemId: f.workItemId,
      operationId: first.id, status: 'uncertain' });
    if (firstKind === 'artifact-produce') await f.store.transaction(f.workItemId, tx => {
      const historical = tx.get(first.id);
      delete historical.action.provider;
      delete historical.intendedOutcome.target.provider;
      const { digest: ignoredDigest, ...content } = historical.intendedOutcome;
      void ignoredDigest;
      historical.intendedOutcome.digest = digest(content);
      const { operationId: ignoredId, ...effect } = historical.action;
      void ignoredId;
      historical.effectFingerprint = digest(effect);
      tx.put(historical);
    });
    const bytes = await fs.readFile(f.store.recordPath(f.workItemId, first.id));
    const retry = { ...action, class: retryKind };
    await assert.rejects(prepare(`alias-retry-${firstKind}`, retry), { code: 'UNCERTAIN' });
    const operationId = `alias-exact-${firstKind}`;
    await grant(f, 'override', { rules: ['uncertain-retry'],
      scope: { actions: [firstKind], operationId },
      reason: 'Equivalent effect does not transfer literal action-scoped authority' });
    await assert.rejects(prepareOperation(f.store, {
      workItemId: f.workItemId, sessionId: f.sessionId, operationId,
      correlationKey: `alias-exception-${firstKind}`, action: retry,
      intent: 'Fixture alias retry', request: { toolName: 'fixture_alias',
        toolArgs: { retryKind }, cwd: f.repo },
    }), { code: 'UNCERTAIN' });
    const exception = await grant(f, 'override', { rules: ['uncertain-retry'],
      scope: { repositoryIds: ['primary'], actions: [retryKind], operationId },
      reason: 'Fixture user explicitly permits this exact alias replacement' });
    const replacement = (await prepareOperation(f.store, {
      workItemId: f.workItemId, sessionId: f.sessionId, operationId,
      correlationKey: `alias-exception-${firstKind}`, action: retry,
      intent: 'Fixture alias retry', request: { toolName: 'fixture_alias',
        toolArgs: { retryKind }, cwd: f.repo },
    })).operation;
    assert.equal(replacement.action.class, retryKind);
    assert.equal(replacement.intendedOutcome.actionClass, retryKind);
    assert.equal(replacement.retryOverrideId, exception.event.id);
    assert.equal(replacement.priorUncertainOperationId, first.id);
    assert.deepEqual(await fs.readFile(f.store.recordPath(f.workItemId, first.id)), bytes);
  }
});

function producedArtifact(base, overrides = {}) {
  return { remoteRepositoryURL: base.remoteRepositoryURL, artifactId: 'resource',
    artifactName: 'package', artifactRef: 'immutable-resource',
    sha256: digest('immutable-bytes'), sourceRevision: base.sourceRevision,
    configDigest: base.configDigest, executionRef: 'producer',
    attemptCapability: 'distinct', attemptRef: '2',
    executionIdentity: { provider: base.provider, connection: 'fixture-connection',
      scopeRef: 'producer-scope', definitionRef: 'producer-definition',
      executionRef: 'producer', attemptKind: 'known', attemptRef: '2' },
    ...overrides };
}

async function reloadFixtureStore(f) {
  const original = f.store;
  f.store = await new Store(f.home, { clock: f.clock,
    verifyRepository: original.verifyRepository,
    verifyOperationResult: original.verifyOperationResult,
    verifyArtifact: original.verifyArtifact,
  }).ready();
  return f.store.load(f.workItemId);
}

for (const archived of [false, true]) {
  for (const incomplete of [false, true]) {
    test(`closure ${archived ? 'archived' : 'active'} ${incomplete ? 'historical incomplete' : 'current'} artifact resource cannot be borrowed by a predeclared retry after Store reload`, async t => {
      const { f, base, prepare } = await setup(t);
      const action = { ...base, class: 'artifact', artifactId: 'resource', artifactName: 'package' };
      const first = await complete(f, (await prepare('resource-first', action)).operation,
        producedArtifact(base), 'immutable-resource');
      if (incomplete) await f.store.transaction(f.workItemId, tx => {
        const historical = tx.get(first.id);
        delete historical.resultProof.artifactIdentity;
        tx.put(historical);
      });
      let recordPath = f.store.recordPath(f.workItemId, first.id);
      if (archived) {
        assert.ok((await pruneWork(f.store, f.workItemId)).archived.includes(first.id));
        recordPath = path.join(f.store.workPath(f.workItemId), 'evidence', `${first.id}.json`);
      }
      const bytes = await fs.readFile(recordPath);
      await reloadFixtureStore(f);
      const second = (await prepare('resource-predeclared', { ...action,
        artifactRef: 'immutable-resource', artifactSha256: digest('immutable-bytes'),
        producingExecutionRef: 'producer', producingAttemptRef: '2' })).operation;
      registerFixtureProviderRequest(f, second);
      await markDispatching(f.store, f.workItemId, second.id);
      const observedResult = registerFixtureProviderResult(f, second, {
        providerResultId: 'immutable-resource', result: producedArtifact(base),
      });
      const recorded = await recordOperation(f.store, { workItemId: f.workItemId,
        operationId: second.id, status: 'succeeded', observedResult });
      assert.equal(recorded.status, 'uncertain',
        'A different intended digest is not another immutable produced resource');
      assert.equal(recorded.resultGap, 'result-or-request-belongs-to-another-dispatch');
      assert.equal(recorded.resultProof, undefined);
      const loaded = await reloadFixtureStore(f);
      assert.equal(loaded.records.find(record => record.id === second.id).status, 'uncertain');
      assert.equal(loaded.records.some(record => record.type === 'artifact' ||
        record.type === 'test-evidence'), false);
      assert.deepEqual(await fs.readFile(recordPath), bytes);
    });
  }
}

test('closure observed artifact identities keep genuinely different producers resources and immutable versions distinct', async t => {
  const { f, base, prepare } = await setup(t);
  const action = { ...base, class: 'artifact', artifactId: 'resource', artifactName: 'package' };
  const first = await complete(f, (await prepare('distinct-first', action)).operation,
    producedArtifact(base), 'immutable-resource');
  assert.ok(first.resultProof.artifactIdentity);
  const saved = await reloadFixtureStore(f);
  assert.deepEqual(saved.records.find(record => record.id === first.id).resultProof.artifactIdentity,
    first.resultProof.artifactIdentity);
  const cases = [
    { artifactRef: 'another-resource' },
    { executionRef: 'different-producer',
      executionIdentity: { ...producedArtifact(base).executionIdentity, executionRef: 'different-producer' } },
    { attemptRef: '3', executionIdentity: { ...producedArtifact(base).executionIdentity, attemptRef: '3' } },
    { executionIdentity: { ...producedArtifact(base).executionIdentity, connection: 'other-connection' } },
    { executionIdentity: { ...producedArtifact(base).executionIdentity, scopeRef: 'other-scope' } },
    { sha256: digest('other-bytes') },
    { sha256: undefined, immutableVersion: 'fixed-v1', retrievalContext: 'provider:versioned-resource',
      versionVerified: true },
    { sha256: undefined, immutableVersion: 'fixed-v2', retrievalContext: 'provider:versioned-resource',
      versionVerified: true },
  ];
  for (const [index, mutation] of cases.entries()) {
    const result = JSON.parse(JSON.stringify(producedArtifact(base, mutation)));
    const operation = (await prepare(`distinct-${index}`, action)).operation;
    const recorded = await complete(f, operation, result, result.artifactRef);
    assert.ok(recorded.resultProof.artifactIdentity, `${index}: complete observed identity persists`);
  }
  assert.equal((await reloadFixtureStore(f)).records
    .filter(record => record.type === 'operation' && record.status === 'succeeded').length, 9);
});

test('closure proven artifact versions cannot be borrowed across digest omission and alias representations', async t => {
  const { f, base, prepare } = await setup(t);
  const action = { ...base, class: 'artifact', artifactId: 'resource', artifactName: 'package' };
  const result = producedArtifact(base);
  delete result.sha256;
  Object.assign(result, { immutableVersion: 'fixed-v1',
    retrievalContext: 'provider:versioned-resource', versionVerified: true });
  const first = await complete(f, (await prepare('version-first', action)).operation,
    result, result.artifactRef);
  await pruneWork(f.store, f.workItemId);
  await reloadFixtureStore(f);
  const second = (await prepare('version-declared', { ...action, class: 'artifact-produce',
    artifactRef: result.artifactRef, artifactImmutableVersion: result.immutableVersion,
    artifactRetrievalContext: result.retrievalContext })).operation;
  registerFixtureProviderRequest(f, second);
  await markDispatching(f.store, f.workItemId, second.id);
  const observedResult = registerFixtureProviderResult(f, second, {
    providerResultId: result.artifactRef, result,
  });
  assert.equal((await recordOperation(f.store, { workItemId: f.workItemId,
    operationId: second.id, status: 'succeeded', observedResult })).status, 'uncertain');
  assert.ok(first.resultProof.artifactIdentity);
});

test('closure artifact producer fields must match independent classification and mismatches stay advisory unmanaged', async t => {
  const { f, base } = await setup(t);
  const cases = [
    ['artifact', { producingExecutionRef: 'wrong-run' }],
    ['artifact-produce', { producingAttemptRef: 'wrong-attempt' }],
    ['artifact-produce', { producingExecutionRef: 'wrong-run', producingAttemptRef: 'wrong-attempt' }],
  ];
  const configPath = path.join(f.repo, '.sdlc', 'config.json');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  config.toolAdapters = cases.map(([kind], index) => ({
    toolName: `fixture_producer_${index}`, match: { produce: 'run-A', attempt: '1' },
    action: { ...base, class: kind, artifactId: `gate-${index}`, artifactName: 'package',
      producingExecutionRef: 'run-A', producingAttemptRef: '1' },
  }));
  await fs.writeFile(configPath, JSON.stringify(config));
  await orient(f);
  for (const [index, [kind, wrong]] of cases.entries()) {
    const actual = config.toolAdapters[index];
    const request = { toolName: actual.toolName, toolArgs: actual.match, cwd: f.repo };
    const state = await f.store.load(f.workItemId);
    const classified = (await classifyTool(f.store, request, state, state.metadata.members[0],
      await loadConfig(state.metadata, 'primary')))[0];
    assert.equal(classified.producingExecutionRef, 'run-A');
    assert.equal(classified.producingAttemptRef, '1');
    const operation = (await prepareOperation(f.store, {
      workItemId: f.workItemId, sessionId: f.sessionId,
      correlationKey: `gate-mismatch-${index}`, intent: 'Fixture independently classified producer mismatch',
      action: { ...actual.action, ...wrong }, request,
    })).operation;
    assert.equal(operation.class, kind);
    await markDispatching(f.store, f.workItemId, operation.id);
    const advisory = await gate(f.store, { ...request, sessionId: f.sessionId });
    assert.equal(advisory.unmanaged, true);
    assert.equal(advisory.permissionDecision, undefined, 'The advisory hook never vetoes the host tool');
    assert.match(advisory.unmanagedReason, /Prepared producing(?:Execution|Attempt)Ref differs/u);
    const stored = (await f.store.records(f.workItemId)).find(record => record.id === operation.id);
    assert.equal(stored.dispatchBound, false);
    assert.equal(stored.status, 'uncertain');
    assert.equal(stored.resultProof, undefined);
  }
});
