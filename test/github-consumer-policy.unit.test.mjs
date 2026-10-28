export const validationDeclarations = {
  "schemaVersion": 1,
  "assertionNamespace": "test/github-existing-consumer-boundaries.unit.test.mjs",
  "variants": [
    {
      "expression": "`T-GH-37-${family}-wrong-${axis}`",
      "names": [
        "T-GH-37-policy-wrong-ref",
        "T-GH-37-policy-wrong-revision",
        "T-GH-37-notification-wrong-ref",
        "T-GH-37-notification-wrong-revision",
        "T-GH-37-notification-wrong-version"
      ]
    }
  ]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { bridgeFixture, durableBytes } from './fixtures/github-store-bridge.mjs';

test('GH37 policy and notification use original prepared action-source guards', async t => {
  const f = await bridgeFixture(t);
  const merge = await f.prepare('merge');
  assert.equal((await f.record(merge, await f.result(merge))).status, 'succeeded');
  const configFile = path.join(f.repo, '.sdlc', 'config.json');
  const configBytes = await fs.readFile(configFile);
  const originalRef = await f.runGit('symbolic-ref', 'HEAD');
  const foreignRef = 'refs/heads/original-source-axis';
  await f.runGit('update-ref', foreignRef, f.revision);
  const tree = await f.runGit('rev-parse', 'HEAD^{tree}');
  const foreignRevision = await f.runGit('commit-tree', tree, '-p', f.revision,
    '-m', 'Isolated original source revision axis');
  assert.notEqual(foreignRevision, f.revision);

  for (const family of ['policy', 'notification']) {
    const positive = await f.prepare(family, '-source-positive');
    assert.equal(positive.claim.operation.dispatchBound, true);
    assert.equal((await f.record(positive, await f.result(positive))).status, 'succeeded');
    for (const axis of family === 'policy' ? ['ref', 'revision'] : ['ref', 'revision', 'version']) {
      await t.test(`T-GH-37-${family}-wrong-${axis}`, async () => {
        const prepared = await f.prepare(family, `-source-${axis}`, { claim: false });
        const change = async () => {
          if (axis === 'ref') await f.runGit('symbolic-ref', 'HEAD', foreignRef);
          else if (axis === 'revision') await f.runGit('update-ref', 'HEAD', foreignRevision, f.revision);
          else {
            const config = JSON.parse(configBytes);
            config.environments.DEV.configDigest = 'foreign-original-notification-config';
            await fs.writeFile(configFile, JSON.stringify(config));
          }
        };
        const restore = async () => {
          if (axis === 'ref') await f.runGit('symbolic-ref', 'HEAD', originalRef);
          else if (axis === 'revision') await f.runGit('update-ref', 'HEAD', f.revision, foreignRevision);
          else await fs.writeFile(configFile, configBytes);
        };
        await change();
        try {
          assert.equal(await f.runGit('rev-parse', 'HEAD'), axis === 'revision' ? foreignRevision : f.revision);
          assert.equal(await f.runGit('symbolic-ref', 'HEAD'), axis === 'ref' ? foreignRef : originalRef);
          if (axis !== 'version') assert.deepEqual(await fs.readFile(configFile), configBytes);
          const before = await durableBytes(f);
          const calls = f.calls.length;
          await assert.rejects(f.bridge.legacyOperations.claimDispatch(prepared.preparation, f.store), error => {
            assert.equal(error.code, axis === 'ref' ? 'BINDING' : 'STALE');
            assert.match(error.message, axis === 'ref' ?
              /Repository\/worktree\/branch changed/u : /Candidate changed after operation preparation/u);
            return true;
          });
          assert.deepEqual(await durableBytes(f), before);
          assert.equal(f.calls.length, calls);
          const operation = (await f.store.records(f.workItemId)).find(value =>
            value.id === prepared.preparation.operation.id);
          assert.equal(operation.status, 'prepared');
          assert.equal(operation.dispatchBound, false);
        } finally { await restore(); }
        prepared.claim = await f.bridge.legacyOperations.claimDispatch(prepared.preparation, f.store);
        assert.equal(prepared.claim.operation.dispatchBound, true);
        const failure = await f.record(prepared, await f.failedResult(prepared), { status: 'failed' });
        assert.equal(failure.status, 'failed');
        assert.equal(failure.dispatchBound, true, 'An actual later provider rejection is not preclaim non-dispatch');
      });
    }
  }
});
