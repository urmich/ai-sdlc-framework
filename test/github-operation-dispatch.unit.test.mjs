export const validationDeclarations = {
  "schemaVersion": 1,
  "assertionNamespace": "test/github-operation-results.unit.test.mjs"
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { candidateStamp } from '../src/validation.mjs';
import { orient } from './helpers.mjs';
import { bridgeFixture, durableBytes } from './fixtures/github-store-bridge.mjs';

test('bridge atomic dispatch regressions', async t => {
  const f = await bridgeFixture(t);
  await t.test('IAM denial and preclaim cancellation admit exact affirmative non-dispatch without a claim', async () => {
    for (const reason of ['iam-denied', 'cancelled-before-claim']) {
      const prepared = await f.prepare('notification', `-${reason}`, { claim: false });
      const observedResult = f.nonDispatch(prepared, reason);
      const before = await durableBytes(f);
      const calls = f.calls.length;
      for (const mutate of [
        value => { value.dispatch.hostCallId = 'wrong-call'; },
        value => { value.observation.nonDispatchProof.dispatchId = 'wrong-operation'; },
        value => { value.observation.nonDispatchProof.dispatchAttempted = true; },
        value => { delete value.observation.nonDispatchProof; },
      ]) await assert.rejects(f.bridge.legacyOperations.recordResult(prepared.preparation, {
        workItemId: f.workItemId, operationId: prepared.preparation.operation.id, status: 'not-started',
        observedResult: f.variant(observedResult, mutate),
      }, f.store), { code: 'EVIDENCE' });
      assert.deepEqual(await durableBytes(f), before);
      const result = await f.bridge.legacyOperations.recordResult(prepared.preparation, {
        workItemId: f.workItemId, operationId: prepared.preparation.operation.id, status: 'not-started', observedResult,
      }, f.store);
      assert.equal(result.status, 'not-started');
      assert.equal(result.dispatchBound, false);
      assert.equal(result.resultProof.status, 'not-started');
      assert.equal(f.calls.length, calls);
    }
  });
  await t.test('local build remains a real local operation without GitHub execution or result proof', async () => {
    const preparation = await f.bridge.legacyOperations.prepare({
      workItemId: f.workItemId, sessionId: f.sessionId, operationId: 'local-build',
      action: { class: 'local-build', repositoryId: 'primary' },
      request: { toolName: 'github-existing-consumer', toolArgs: { class: 'local-build' }, cwd: f.repo },
      correlationKey: 'local-build', intent: 'Build locally without a GitHub execution',
    }, f.store);
    const claim = await f.bridge.legacyOperations.claimDispatch(preparation, f.store);
    assert.equal(claim.hostCallId, null);
    const result = await f.bridge.legacyOperations.recordResult(preparation, {
      workItemId: f.workItemId, operationId: preparation.operation.id, status: 'succeeded',
      target: 'local', requestFingerprint: preparation.operation.requestFingerprint, evidenceRef: 'fixture:local-build',
    }, f.store);
    assert.equal(result.class, 'local-build');
    assert.equal(result.intendedOutcome, undefined);
    assert.equal(result.resultProof, undefined);
  });
  await t.test('local selected test remains local without a hosted identity or deployment', async () => {
    const preparation = await f.bridge.legacyOperations.prepare({
      workItemId: f.workItemId, sessionId: f.sessionId, operationId: 'local-selected-test',
      action: { class: 'test', repositoryId: 'primary', environment: 'local', target: 'local',
        testId: 'T-unit', owner: 'agent', host: 'local' },
      request: { toolName: 'github-existing-consumer', toolArgs: { class: 'test' }, cwd: f.repo },
      correlationKey: 'local-selected-test', intent: 'Run the local selected test without a hosted run',
    }, f.store);
    const claim = await f.bridge.legacyOperations.claimDispatch(preparation, f.store);
    const calls = f.calls.length;
    const result = await f.bridge.legacyOperations.recordResult(preparation, {
      workItemId: f.workItemId, operationId: preparation.operation.id, status: 'succeeded',
      target: 'local', expectedMet: true, requestFingerprint: preparation.operation.requestFingerprint,
      evidenceRef: 'fixture:local-selected-test',
    }, f.store);
    assert.equal(claim.hostCallId, null);
    assert.equal(result.status, 'succeeded');
    assert.equal(result.action.environment, 'local');
    assert.equal(result.intendedOutcome, undefined);
    assert.equal(result.resultProof, undefined);
    assert.equal(result.action.deploymentId, undefined);
    assert.equal(f.calls.length, calls);
  });
  await t.test('T-GHC08-G empty acknowledgement cannot invent a causal hosted execution or redispatch', async () => {
    const prepared = await f.prepare('execution', '-empty-acknowledgement');
    const calls = f.calls.length;
    const result = await f.record(prepared, undefined);
    assert.equal(result.status, 'uncertain');
    assert.equal(result.resultGap, 'current-result-observation-required');
    assert.equal(result.handle, undefined);
    assert.equal(result.resultProof, undefined);
    await assert.rejects(f.bridge.legacyOperations.claimDispatch(prepared.preparation, f.store), { code: 'UNCERTAIN' });
    assert.equal(f.calls.length, calls);
  });
  await t.test('real Store transaction fault preserves an unclaimed dispatch, revalidates resume, and forbids redispatch', async () => {
    const prepared = await f.prepare('notification', '-interrupted', { claim: false });
    const calls = f.calls.length;
    const before = await durableBytes(f);
    let interrupted = false;
    f.store.fault = async phase => {
      if (phase === 'dispatch:validated' && !interrupted) {
        interrupted = true;
        throw new Error('fixture interruption before the atomic claim write');
      }
    };
    try {
      await assert.rejects(f.bridge.legacyOperations.claimDispatch(prepared.preparation, f.store),
        /fixture interruption before the atomic claim write/u);
    } finally { f.store.fault = async () => {}; }
    assert.equal(interrupted, true);
    assert.deepEqual(await durableBytes(f), before);
    await orient(f);
    const unclaimed = (await f.store.records(f.workItemId)).find(value => value.id === prepared.preparation.operation.id);
    assert.equal(unclaimed.status, 'prepared');
    assert.equal(unclaimed.dispatchBound, false);
    assert.equal(f.calls.length, calls);
    let persisted = false;
    f.store.fault = async phase => {
      if (phase === 'record:operation') {
        persisted = true;
        throw new Error('fixture interruption after the atomic claim write');
      }
    };
    try {
      await assert.rejects(f.bridge.legacyOperations.claimDispatch(prepared.preparation, f.store),
        /fixture interruption after the atomic claim write/u);
    } finally { f.store.fault = async () => {}; }
    assert.equal(persisted, true);
    const claimed = (await f.store.records(f.workItemId)).find(value => value.id === prepared.preparation.operation.id);
    assert.equal(claimed.status, 'dispatching');
    assert.equal(claimed.dispatchBound, true);
    assert.deepEqual(claimed.hostInvocation, prepared.preparation.operation.hostInvocation);
    assert.equal(f.calls.length, calls);
    await assert.rejects(f.bridge.legacyOperations.claimDispatch(prepared.preparation, f.store), { code: 'UNCERTAIN' });
    assert.equal(f.calls.length, calls);
    await orient(f);
    const uncertain = (await f.store.records(f.workItemId)).find(value => value.id === prepared.preparation.operation.id);
    assert.equal(uncertain.status, 'uncertain');
    assert.equal(uncertain.dispatchBound, true);
    await assert.rejects(f.bridge.legacyOperations.claimDispatch(prepared.preparation, f.store), { code: 'UNCERTAIN' });
    assert.equal(f.calls.length, calls);
  });
  await t.test('atomic public gate rejects an uncommitted candidate after real Store preparation with zero effects', async () => {
    const prepared = await f.prepare('notification', '-stale', { claim: false });
    const source = path.join(f.repo, 'uncommitted-currentness-regression.mjs');
    const calls = f.calls.length;
    await fs.writeFile(source, 'export const changed = true;\n');
    try {
      const state = await f.store.load(f.workItemId);
      const before = await durableBytes(f);
      assert.notEqual(await candidateStamp(state.metadata, state.manifest), prepared.preparation.operation.candidateStamp);
      await assert.rejects(f.bridge.legacyOperations.claimDispatch(prepared.preparation, f.store), { code: 'STALE' });
      const result = (await f.store.records(f.workItemId)).find(value => value.id === prepared.preparation.operation.id);
      assert.equal(result.status, 'prepared');
      assert.equal(result.dispatchBound, false);
      assert.deepEqual(await durableBytes(f), before);
      assert.equal(f.calls.length, calls);
    } finally { await fs.unlink(source); }
  });
});
