export const validationDeclarations = {
  "schemaVersion": 1,
  "assertionNamespace": "test/github-operation-results.unit.test.mjs",
  "variants": [
    {
      "expression": "name",
      "names": [
        "wrong scalar acquisition handle",
        "independently acquired different publication producer",
        "wrong comment ID with otherwise unchanged proof",
        "self-consistent wrong comment ID cannot replace privately captured publication",
        "additional noncanonical content digest regression"
      ]
    }
  ]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import { digest } from '../src/core.mjs';
import { recordOperation } from 'ai-sdlc-framework/operations';
import { bridgeFixture, durableBytes } from './fixtures/github-store-bridge.mjs';

test('scalar acquisition handles and wrong publication IDs cross the real claimed Store boundary', async t => {
  const f = await bridgeFixture(t);
  const prepared = await f.prepare('notification');
  const acquired = await f.result(prepared);
  const scalar = f.scalarResult(acquired);
  assert.equal(typeof scalar, 'string');
  const input = observedResult => ({
    workItemId: f.workItemId, operationId: prepared.claim.operation.id, status: 'succeeded', observedResult,
  });
  const before = await durableBytes(f);
  for (const [name, rejected] of [
    ['wrong scalar acquisition handle', 'private-scalar-not-acquired'],
    ['independently acquired different publication producer', await f.foreignProducer(scalar)],
    ['wrong comment ID with otherwise unchanged proof', f.scalarResult(f.variant(scalar,
      value => { value.observation.result.deliveryReceipt = 'comment:999'; }))],
    ['self-consistent wrong comment ID cannot replace privately captured publication', f.scalarResult(f.variant(scalar, value => {
      value.observation.providerResultId = 'comment:999';
      value.observation.causalProof.resultId = 'comment:999';
      value.observation.result.deliveryReceipt = 'comment:999';
    }))],
    ['additional noncanonical content digest regression', f.scalarResult(f.variant(scalar,
      value => { value.observation.result.contentDigest = digest('wrong-content'); }))],
  ]) {
    await t.test(name, async () => {
      await assert.rejects(f.bridge.legacyOperations.recordResult(prepared.preparation, input(rejected), f.store),
        { code: 'EVIDENCE' });
      await assert.rejects(f.bridge.legacyOperations.reconcile(input(rejected), f.store), { code: 'EVIDENCE' });
      assert.deepEqual(await durableBytes(f), before);
    });
  }
  await t.test('recordResult preserves a scalar private handle just like existing recordOperation', async () => {
    const result = await f.bridge.legacyOperations.recordResult(prepared.preparation, input(scalar), f.store);
    assert.equal(result.status, 'succeeded');
    assert.equal(result.resultProof.providerResultId, 'comment:1001');
    assert.equal((await recordOperation(f.store, input(scalar))).resultProof.resultDigest, result.resultProof.resultDigest);
  });
  await t.test('reconcile preserves scalar and opaque object identity and rejects foreign operations', async () => {
    const pending = await f.prepare('notification', '-scalar-reconcile');
    const readback = await f.result(pending);
    const scalarReadback = f.scalarResult(readback);
    await f.bridge.legacyOperations.recordResult(pending.preparation, {
      workItemId: f.workItemId, operationId: pending.claim.operation.id, status: 'uncertain',
    }, f.store);
    const reconcile = observedResult => ({
      workItemId: f.workItemId, operationId: pending.claim.operation.id, status: 'succeeded', observedResult,
    });
    const unchanged = await durableBytes(f);
    await assert.rejects(f.bridge.legacyOperations.reconcile(reconcile(scalar), f.store), { code: 'EVIDENCE' });
    assert.deepEqual(await durableBytes(f), unchanged);
    const result = await f.bridge.legacyOperations.reconcile(reconcile(scalarReadback), f.store);
    assert.equal(result.status, 'succeeded');
    assert.equal(result.resultProof.providerResultId, 'comment:1002');
    const opaque = f.opaqueResult(readback);
    assert.equal((await f.bridge.legacyOperations.reconcile(reconcile(opaque), f.store)).resultProof.resultDigest,
      result.resultProof.resultDigest);
  });
});
