import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { prepareOperation, markDispatching, recordOperation } from '../src/operations.mjs';
import { evaluateGate } from '../src/gate.mjs';
import { isExternalAction, isHostedConfiguration } from '../src/policy.mjs';
import { Store } from '../src/store.mjs';
import { deriveIntendedOutcome } from '../src/external-results.mjs';
import { digest } from '../src/core.mjs';
import {
  fixture, coding, observeFixtureRepository, orient,
  registerFixtureProviderRequest, registerFixtureProviderResult,
} from './helpers.mjs';

async function configurationFixture(t, { omitHostedURL = false } = {}) {
  const f = await coding(await fixture(t));
  const remoteRepositoryURL = await f.runGit('remote', 'get-url', 'origin');
  const action = {
    class: 'configuration', repositoryId: 'primary',
    ...(!omitHostedURL ? { localRepositoryPath: f.repo, remoteRepositoryURL } : {}),
    target: 'branch-protection', policyVersion: 'policyVersionv2',
  };
  const request = {
    toolName: 'fixture_policy_update',
    toolArgs: { target: action.target, policyVersion: action.policyVersion,
      ...(!omitHostedURL ? { remoteRepositoryURL } : {}) },
    cwd: f.repo,
  };
  await fs.writeFile(path.join(f.repo, '.sdlc', 'config.json'),
    JSON.stringify({
      defaultBranch: 'refs/heads/main',
      toolAdapters: [{
        toolName: request.toolName,
        arguments: {
          target: { required: true, type: 'string', actionField: 'target' },
          policyVersion: { required: true, type: 'string',
            actionField: 'policyVersion' },
          remoteRepositoryURL: { type: 'string',
            actionField: 'remoteRepositoryURL' },
        },
        action: { class: 'configuration',
          ...(!omitHostedURL ? { localRepositoryPath: f.repo } : {}) },
      }],
    }));
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Isolated hosted configuration candidate');
  await observeFixtureRepository(f);
  const prepare = (correlationKey, overrides = {}) =>
    prepareOperation(f.store, {
      workItemId: f.workItemId, sessionId: f.sessionId, action, request,
      correlationKey, intent: 'Update the exact hosted branch protection version',
      ...overrides,
    });
  return { f, action, request, prepare, remoteRepositoryURL };
}

function policyResult(f, operation) {
  return registerFixtureProviderResult(f, operation, {
    providerResultId: `${operation.target}:${operation.action.policyVersion}`,
    result: {
      target: operation.target, policyVersion: operation.action.policyVersion,
      remoteRepositoryURL: operation.intendedOutcome.target.remoteRepositoryURL,
      changeApplied: true,
    },
  });
}

function executionRecordingFixture() {
  const action = {
    class: 'build', repositoryId: 'primary', environment: 'DEV',
    target: 'dev-target', provider: 'fixture', pipeline: 'fixture-build',
    remoteRepositoryURL: 'https://example.invalid/repository.git',
    sourceRevision: 'a'.repeat(40), configDigest: 'config-v1',
  };
  const intendedOutcome = deriveIntendedOutcome(action);
  const operation = {
    id: 'context-operation', type: 'operation', workItemId: 'context-work',
    class: action.class, action, target: action.target, status: 'dispatching',
    cycleId: null, intendedOutcome,
  };
  const records = new Map([[operation.id, operation]]);
  const executionContext = {
    provider: action.provider, connection: 'execution-connection',
    scopeRef: 'project:execution', definitionRef: action.pipeline,
    attemptCapability: 'distinct',
  };
  const result = {
    executionRef: 'run-42', attemptCapability: 'distinct', attemptRef: '2',
    executionIdentity: {
      provider: executionContext.provider, connection: executionContext.connection,
      scopeRef: executionContext.scopeRef, definitionRef: executionContext.definitionRef,
      executionRef: 'run-42', attemptKind: 'known', attemptRef: '2',
    },
    provider: action.provider, pipeline: action.pipeline,
    environment: action.environment, target: action.target,
    sourceRevision: action.sourceRevision, configDigest: action.configDigest,
    remoteRepositoryURL: action.remoteRepositoryURL,
  };
  const verified = {
    dispatch: { id: operation.id, providerRequestId: 'request-42',
      providerRequestSupported: true },
    executionContext,
    observation: {
      status: 'succeeded', providerStatus: 'succeeded', providerVerified: true,
      family: intendedOutcome.family, target: intendedOutcome.target,
      intendedOutcomeDigest: intendedOutcome.digest, providerResultId: 'run-42:2',
      causalProof: { kind: 'provider-request', dispatchId: operation.id,
        providerRequestId: 'request-42', resultId: 'run-42:2',
        supported: true, accepted: true },
      result, evidence: { ref: 'fixture:context-result', verified: true,
        sha256: digest(result) },
    },
  };
  let archiveReads = 0;
  const store = {
    clock: { now: () => Date.parse('2026-09-08T00:00:00Z') },
    async transaction(workItemId, callback) {
      assert.equal(workItemId, operation.workItemId);
      return callback({
        get: key => records.get(key),
        all: () => [...records.values()],
        put: record => records.set(record.id, record),
        checkpoint: {},
        metadata: { members: [{ repositoryId: 'primary' }] },
      });
    },
    async verifyOperationResult({ operation: prepared, observedResult }) {
      assert.equal(prepared.id, operation.id);
      assert.deepEqual(observedResult, { fixtureResultId: 'run-42:2' });
      return verified;
    },
    async archivedOperationProofs() {
      archiveReads++;
      return [];
    },
  };
  const input = { workItemId: operation.workItemId, operationId: operation.id,
    status: 'succeeded', observedResult: { fixtureResultId: 'run-42:2' } };
  return { store, input, verified, records, archiveReads: () => archiveReads };
}

test('adapter execution context binds recording and reconciliation to independently proven execution facts', async () => {
  for (const [field, wrong] of [
    ['provider', 'other-provider'],
    ['connection', 'other-connection'],
    ['scopeRef', 'project:other'],
    ['definitionRef', 'other-definition'],
    ['attemptCapability', 'none'],
  ]) {
    const f = executionRecordingFixture();
    const original = f.verified.executionContext[field];
    f.verified.executionContext[field] = wrong;
    const recorded = await recordOperation(f.store, f.input);
    assert.equal(recorded.status, 'uncertain', field);
    assert.equal(recorded.resultGap, 'inconsistent-execution-identity', field);
    assert.equal(recorded.resultProof, undefined, field);
    assert.equal(f.archiveReads(), 0, field);
    f.verified.executionContext[field] = original;
    const reconciled = await recordOperation(f.store, f.input, { reconcile: true });
    assert.equal(reconciled.status, 'succeeded', field);
    assert.deepEqual(reconciled.resultProof.executionIdentity,
      f.verified.observation.result.executionIdentity, field);
    assert.equal(f.archiveReads(), 1, field);
    assert.deepEqual(await recordOperation(f.store, f.input), reconciled, field);
  }
});

test('adapter execution context is checked again after archived proof lookup', async () => {
  const f = executionRecordingFixture();
  let archiveReads = 0;
  f.store.archivedOperationProofs = async () => {
    archiveReads++;
    f.verified.observation.result.executionIdentity.connection = 'different-connection';
    return [];
  };
  const recorded = await recordOperation(f.store, f.input);
  assert.equal(archiveReads, 1);
  assert.equal(recorded.status, 'uncertain');
  assert.equal(recorded.resultGap, 'inconsistent-execution-identity');
  assert.equal(recorded.resultProof, undefined);
});

test('adapter execution context remains optional, is snapshotted once and cannot be supplied by caller JSON', async () => {
  const absent = executionRecordingFixture();
  delete absent.verified.executionContext;
  absent.records.set('repository-observation', {
    type: 'repository-observation', id: 'repository-observation',
    repositoryId: 'primary', provider: 'fixture',
    connection: 'repository-connection', repositoryRef: 'not-execution-scope',
    remoteRepositoryURL: 'https://example.invalid/repository.git',
  });
  const completed = await recordOperation(absent.store, absent.input);
  assert.equal(completed.status, 'succeeded');
  assert.equal(completed.resultProof.executionIdentity.connection, 'execution-connection');
  assert.equal(completed.resultProof.executionIdentity.scopeRef, 'project:execution');

  const snapshot = executionRecordingFixture();
  snapshot.store.archivedOperationProofs = async () => {
    snapshot.verified.executionContext.connection = 'changed-after-verification';
    return [];
  };
  assert.equal((await recordOperation(snapshot.store, snapshot.input)).status,
    'succeeded');
  const caller = executionRecordingFixture();
  await assert.rejects(recordOperation(caller.store, {
    ...caller.input, executionContext: caller.verified.executionContext,
  }), { code: 'INPUT' });
  assert.equal(caller.records.get(caller.input.operationId).status, 'dispatching');
  for (const executionContext of [null, [], { unprovenScope: 'not-allowed' }]) {
    const invalid = executionRecordingFixture();
    invalid.verified.executionContext = executionContext;
    await assert.rejects(recordOperation(invalid.store, invalid.input),
      { code: 'INPUT' });
    assert.equal(invalid.records.get(invalid.input.operationId).status, 'dispatching');
  }
});

test('hosted configuration classification preserves local actions and cannot be hidden by an omitted URL', () => {
  for (const action of [
    { class: 'configuration' },
    { class: 'configuration', paths: ['.sdlc/config.json'] },
    { class: 'configuration', target: 'local', environment: 'local',
      paths: ['.sdlc/config.json'] },
    { class: 'bookkeeping' },
    { class: 'code' },
    { class: 'local-build' },
    { class: 'test', environment: 'local' },
  ]) {
    assert.equal(isHostedConfiguration(action), false, JSON.stringify(action));
    assert.equal(isExternalAction(action), false, JSON.stringify(action));
  }
  for (const hostedFields of [
    { target: 'branch-protection' },
    { policyVersion: 'policyVersionv2' },
    { previousPolicyVersion: 'policyVersionv1' },
    { remoteRepositoryURL: 'https://example.invalid/repository.git' },
    { remoteUrlDigest: 'a'.repeat(64) },
    { provider: 'fixture' },
    { requestedState: 'enabled' },
    { environment: 'DEV' },
    { implicitEnvironments: ['STAGING'] },
  ]) {
    const action = { class: 'configuration', environment: 'local',
      paths: ['.sdlc/config.json'], ...hostedFields };
    assert.equal(isHostedConfiguration(action), true, JSON.stringify(action));
    assert.equal(isExternalAction(action), true, JSON.stringify(action));
  }
  for (const className of ['push', 'build', 'deploy', 'pipeline', 'pr-create',
    'pr-update', 'pr-validation', 'merge', 'auto-merge', 'policy-bypass']) {
    assert.equal(isExternalAction({ class: className }), true, className);
  }
  assert.equal(isExternalAction({ class: 'test', environment: 'DEV' }), true);
});

test('T-107 public hosted configuration cannot succeed with only an evidence string and request fingerprint', async t => {
  const { f, prepare } = await configurationFixture(t);
  const { operation } = await prepare('bare-hosted-success');
  await markDispatching(f.store, f.workItemId, operation.id);
  const recorded = await recordOperation(f.store, {
    workItemId: f.workItemId, operationId: operation.id, status: 'succeeded',
    evidenceRef: 'fixture:unverified-policy-result',
    target: operation.target, requestFingerprint: operation.requestFingerprint,
  });
  assert.equal(recorded.status, 'uncertain',
    'A hosted policy change must not gain success without a verified causal result');
  assert.equal(recorded.resultProof, undefined);
  assert.equal((await f.store.records(f.workItemId)).find(record =>
    record.id === operation.id).status, 'uncertain');
});

test('T-107 hosted configuration uses the existing verifier for exact causal results, reconciliation and terminal replay', async t => {
  const { f, prepare } = await configurationFixture(t);
  const { operation } = await prepare('verified-hosted-success');
  assert.equal(operation.intendedOutcome.family, 'policy');
  assert.equal(operation.intendedOutcome.requested.policyVersion, 'policyVersionv2');
  assert.equal(operation.intendedOutcome.target.localRepositoryPath, f.repo);
  registerFixtureProviderRequest(f, operation);
  await markDispatching(f.store, f.workItemId, operation.id);
  const observedResult = policyResult(f, operation);
  const input = { workItemId: f.workItemId, operationId: operation.id,
    status: 'succeeded', observedResult };
  const unverifiedStore = await new Store(f.home, { clock: f.clock }).ready();
  const missingVerifier = await recordOperation(unverifiedStore, input);
  assert.equal(missingVerifier.status, 'uncertain');
  assert.equal(missingVerifier.resultGap, 'hosting-service-result-adapter-unavailable');
  assert.equal(missingVerifier.resultProof, undefined);

  const verified = structuredClone(f.providerResults.get(operation.id));
  for (const [name, mutate, reason] of [
    ['missing causal link', result => { delete result.observation.causalProof; },
      'missing-dispatch-to-result-proof'],
    ['wrong dispatch', result => {
      result.observation.causalProof.dispatchId = 'different-operation';
    }, 'missing-dispatch-to-result-proof'],
    ['wrong target', result => {
      result.observation.result.target = 'different-policy';
    }, 'wrong-or-incomplete-result'],
    ['wrong version', result => {
      result.observation.result.policyVersion = 'policyVersionv1';
    }, 'wrong-or-incomplete-result'],
    ['wrong repository', result => {
      result.observation.result.remoteRepositoryURL = 'https://other.invalid/repository.git';
    }, 'wrong-or-incomplete-result'],
    ['unchanged policy', result => {
      result.observation.result.changeApplied = false;
    }, 'wrong-or-incomplete-result'],
    ['unverified provider', result => {
      result.observation.providerVerified = false;
    }, 'unverified-terminal-status'],
  ]) {
    const changed = structuredClone(verified);
    mutate(changed);
    f.providerResults.set(operation.id, changed);
    const recorded = await recordOperation(f.store, input, { reconcile: true });
    assert.equal(recorded.status, 'uncertain', name);
    assert.equal(recorded.resultGap, reason, name);
    assert.equal(recorded.resultProof, undefined, name);
  }
  f.providerResults.set(operation.id, verified);
  await assert.rejects(recordOperation(f.store, input), { code: 'UNCERTAIN' });
  const completed = await recordOperation(f.store, input, { reconcile: true });
  assert.equal(completed.status, 'succeeded');
  assert.equal(completed.resultProof.status, 'succeeded');
  assert.equal(completed.resultProof.dispatchId, operation.id);
  assert.equal(completed.resultProof.intendedOutcomeDigest, operation.intendedOutcome.digest);
  assert.equal(completed.handle, 'branch-protection:policyVersionv2');
  assert.deepEqual(await recordOperation(f.store, input), completed);
  await assert.rejects(recordOperation(f.store, {
    workItemId: f.workItemId, operationId: operation.id, status: 'succeeded',
    evidenceRef: completed.evidenceRef,
    target: operation.target, requestFingerprint: operation.requestFingerprint,
  }), { code: 'ID_CONFLICT' });
  const changed = structuredClone(verified);
  changed.observation.evidence.ref = 'fixture:changed-terminal-evidence';
  f.providerResults.set(operation.id, changed);
  await assert.rejects(recordOperation(f.store, input), { code: 'ID_CONFLICT' });
  assert.deepEqual((await f.store.records(f.workItemId)).find(record =>
    record.id === operation.id).resultProof, completed.resultProof);
});

test('T-107 hosted targets without a URL still require preparation, dispatch proof and current bound identity', async t => {
  const { f, action, request, prepare, remoteRepositoryURL } =
    await configurationFixture(t, { omitHostedURL: true });
  await orient(f);
  const unprepared = await evaluateGate(f.store, {
    ...request, sessionId: f.sessionId,
  });
  assert.equal(unprepared.error, 'OPERATION');
  assert.match(unprepared.permissionDecisionReason, /Prepare and mark-dispatching/u);
  const { policyVersion: omittedVersion, ...withoutVersion } = action;
  const { target: omittedTarget, ...withoutTarget } = action;
  void omittedVersion;
  void omittedTarget;
  for (const incomplete of [
    withoutVersion,
    withoutTarget,
    { ...action, localRepositoryPath: f.repo,
      remoteRepositoryURL: 'https://other.invalid/repository.git' },
    { ...action, localRepositoryPath: path.dirname(f.repo), remoteRepositoryURL },
    { ...action, provider: 'other-provider' },
  ]) {
    await assert.rejects(prepare('invalid-hosted-intent', { action: incomplete }),
      { code: 'EVIDENCE' });
  }
  const { operation } = await prepare('url-omitted-hosted');
  assert.equal(operation.action.remoteRepositoryURL, remoteRepositoryURL);
  assert.equal(operation.intendedOutcome.target.remoteRepositoryURL, remoteRepositoryURL);
  assert.equal(operation.intendedOutcome.target.localRepositoryPath, f.repo);
  const intendedOutcome = structuredClone(operation.intendedOutcome);
  await f.store.transaction(f.workItemId, tx => {
    const prepared = tx.get(operation.id);
    delete prepared.intendedOutcome;
    tx.put(prepared);
  });
  await assert.rejects(markDispatching(f.store, f.workItemId, operation.id),
    { code: 'EVIDENCE' });
  await f.store.transaction(f.workItemId, tx => {
    const prepared = tx.get(operation.id);
    prepared.intendedOutcome = intendedOutcome;
    tx.put(prepared);
  });
  registerFixtureProviderRequest(f, operation);
  await markDispatching(f.store, f.workItemId, operation.id);
  assert.deepEqual(await evaluateGate(f.store, {
    ...request, sessionId: f.sessionId,
  }), {});
  const bound = (await f.store.records(f.workItemId)).find(record =>
    record.id === operation.id);
  assert.equal(bound.dispatchBound, true);
  const repeated = await evaluateGate(f.store, {
    ...request, sessionId: f.sessionId,
  });
  assert.equal(repeated.error, 'OPERATION');
  const completed = await recordOperation(f.store, {
    workItemId: f.workItemId, operationId: operation.id, status: 'succeeded',
    observedResult: policyResult(f, operation),
  });
  assert.equal(completed.status, 'succeeded');
  await f.store.transaction(f.workItemId, tx => {
    const legacy = tx.get(operation.id);
    delete legacy.intendedOutcome;
    delete legacy.resultProof;
    tx.put(legacy);
  });
  await assert.rejects(recordOperation(f.store, {
    workItemId: f.workItemId, operationId: operation.id, status: 'succeeded',
    evidenceRef: completed.evidenceRef,
    target: operation.target, requestFingerprint: operation.requestFingerprint,
  }, { reconcile: true }), { code: 'ID_CONFLICT' });
});

test('T-107 local configuration edits retain their existing gate, recording and bookkeeping behavior', async t => {
  const { f } = await configurationFixture(t);
  const action = { class: 'configuration', repositoryId: 'primary',
    paths: ['.sdlc/config.json'] };
  const request = { toolName: 'edit', cwd: f.repo,
    toolArgs: { path: path.join(f.repo, '.sdlc', 'config.json'),
      old_str: 'old', new_str: 'new' } };
  await orient(f);
  assert.deepEqual(await evaluateGate(f.store, {
    ...request, sessionId: f.sessionId,
  }), {});
  const { operation } = await prepareOperation(f.store, {
    workItemId: f.workItemId, sessionId: f.sessionId,
    action, request, correlationKey: 'local-configuration-edit',
    intent: 'Edit the local framework configuration only',
  });
  assert.equal(operation.intendedOutcome, undefined);
  assert.equal(operation.hostInvocation, undefined);
  assert.equal(operation.action.remoteRepositoryURL, undefined);
  await markDispatching(f.store, f.workItemId, operation.id);
  assert.deepEqual(await evaluateGate(f.store, {
    ...request, sessionId: f.sessionId,
  }), {});
  const input = {
    workItemId: f.workItemId, operationId: operation.id, status: 'succeeded',
    target: operation.target, requestFingerprint: operation.requestFingerprint,
    evidenceRef: 'fixture:local-configuration-edit',
  };
  const completed = await recordOperation(f.store, input);
  assert.equal(completed.status, 'succeeded');
  assert.equal(completed.resultProof, undefined);
  assert.deepEqual(await recordOperation(f.store, input), completed);
  assert.deepEqual(await evaluateGate(f.store, {
    cwd: f.repo, sessionId: f.sessionId, toolName: 'powershell',
    toolArgs: { command: `node "${path.resolve('bin', 'sdlc.mjs')}" status` },
  }), {});
});
