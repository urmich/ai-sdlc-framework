export const validationDeclarations = {
  "schemaVersion": 1,
  "assertionNamespace": "test/github-existing-consumer-boundaries.unit.test.mjs",
  "variants": [
    {
      "expression": "id",
      "names": [
        "T-GH-37-deployment-wrong-producer",
        "T-GH-37-deployment-wrong-attempt"
      ]
    }
  ]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { recordArtifact } from '../src/validation.mjs';
import { bridgeFixture, durableBytes } from './fixtures/github-store-bridge.mjs';

const revision = 'f'.repeat(40);

test('GH37 original authenticated checkout and prepared source configuration axes', async t => {
  const f = await bridgeFixture(t);
  const build = await f.prepare('execution');
  const nativeBuild = await f.authenticatedExecutionResult(build);
  assert.equal(nativeBuild.apiHead, f.revision);
  assert.equal(nativeBuild.verify(nativeBuild.good).observation.status, 'succeeded');
  await t.test('authenticated execution bytes cannot be replaced by an altered report with unchanged API head', async () => {
    const before = await durableBytes(f);
    await assert.rejects(f.record(build, nativeBuild.tamperedBytes()), error => {
      assert.equal(error.code, 'EVIDENCE');
      assert.match(error.message, /Original runner result signature changed/u);
      return true;
    });
    assert.equal(nativeBuild.apiHead, f.revision);
    assert.deepEqual(await durableBytes(f), before);
  });
  await t.test('T-GH-37-execution-wrong-revision', async () => {
    const wrong = await nativeBuild.wrongCheckout(revision);
    const before = await durableBytes(f);
    await assert.rejects(f.record(build, wrong), error => {
      assert.equal(error.code, 'EVIDENCE');
      assert.match(error.message, /Authenticated executed source differs from original acquired revision/u);
      return true;
    });
    assert.equal(nativeBuild.apiHead, f.revision, 'API head SHA remains unchanged');
    assert.deepEqual(await durableBytes(f), before);
  });
  const producer = await f.record(build, nativeBuild.good);
  await f.selectArtifact(producer);
  const originalArtifact = await f.artifact(producer);
  for (const [id, mutate] of [
    ['T-GH-37-deployment-wrong-producer', value => { value.producingExecution.definitionRef = '999'; }],
    ['T-GH-37-deployment-wrong-attempt', value => {
      value.attemptRef = '1';
      value.producingExecution.attemptRef = '1';
    }],
  ]) await t.test(id, async () => {
    const before = await durableBytes(f);
    const badProducer = f.artifactVariant(originalArtifact, mutate);
    await assert.rejects(recordArtifact(f.store, badProducer), error => {
      assert.equal(error.code, 'EVIDENCE');
      assert.match(error.message, /exact proven producer/u);
      return true;
    });
    assert.deepEqual(await durableBytes(f), before);
    const current = await f.store.load(f.workItemId);
    const artifact = current.records.find(value => value.type === 'artifact' && value.artifactId === '901');
    assert.deepEqual(artifact.producingExecution, producer.resultProof.executionIdentity,
      'Rejected source producer must not replace the deployable artifact selection');
  });
  const deploy = await f.prepare('deployment');
  f.deployment = await f.record(deploy, await f.result(deploy));
  const selected = await f.prepare('test');
  const nativeTest = await f.authenticatedExecutionResult(selected);
  assert.equal(nativeTest.verify(nativeTest.good).observation.result.expectedMet, true);
  await t.test('authenticated aggregate success without the selected test outcome cannot pass the existing test consumer', async () => {
    const before = await durableBytes(f);
    await assert.rejects(f.record(selected, nativeTest.missingSelection()), error => {
      assert.equal(error.code, 'EVIDENCE');
      assert.match(error.message, /actual selected test outcome/u);
      return true;
    });
    assert.deepEqual(await durableBytes(f), before);
  });
  await t.test('T-GH-37-test-wrong-revision', async () => {
    const wrong = await nativeTest.wrongCheckout(revision);
    const before = await durableBytes(f);
    await assert.rejects(f.record(selected, wrong), error => {
      assert.equal(error.code, 'EVIDENCE');
      assert.match(error.message, /Authenticated executed source differs from original acquired revision/u);
      return true;
    });
    assert.equal(nativeTest.apiHead, f.revision, 'Check/run API head is not changed to simulate executed checkout');
    assert.deepEqual(await durableBytes(f), before);
  });
  assert.equal((await f.record(selected, nativeTest.good)).status, 'succeeded');
  await t.test('T-GH-37-git-ref-wrong-version', async () => {
    const prepared = await f.prepare('git-ref', '-original-config', { claim: false });
    const file = path.join(f.repo, '.sdlc', 'config.json');
    const bytes = await fs.readFile(file);
    const configuration = JSON.parse(bytes);
    configuration.environments.DEV.configDigest = 'foreign-original-source-config';
    await fs.writeFile(file, JSON.stringify(configuration));
    try {
      const before = await durableBytes(f);
      const calls = f.calls.length;
      await assert.rejects(f.bridge.legacyOperations.claimDispatch(prepared.preparation, f.store), { code: 'STALE' });
      const operation = (await f.store.records(f.workItemId)).find(value => value.id === prepared.preparation.operation.id);
      assert.equal(operation.status, 'prepared');
      assert.equal(operation.dispatchBound, false);
      assert.deepEqual(await durableBytes(f), before);
      assert.equal(f.calls.length, calls);
    } finally { await fs.writeFile(file, bytes); }
  });
});
