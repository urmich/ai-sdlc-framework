export const validationDeclarations = {
  "schemaVersion": 1,
  "assertionNamespace": "test/github-operation-results.unit.test.mjs",
  "variants": [
    {
      "expression": "`T-GH-37-${family}-failed`",
      "domains": {
        "family": [
          "execution",
          "artifact",
          "deployment",
          "test",
          "pull-request",
          "git-ref",
          "merge",
          "policy",
          "notification"
        ]
      }
    },
    {
      "expression": "`T-GH-37-${family}-N`",
      "domains": {
        "family": [
          "execution",
          "artifact",
          "deployment",
          "test",
          "pull-request",
          "git-ref",
          "merge",
          "policy",
          "notification"
        ]
      }
    },
    {
      "expression": "`T-GH-37-${family}-G`",
      "domains": {
        "family": [
          "execution",
          "artifact",
          "deployment",
          "test",
          "pull-request",
          "git-ref",
          "merge",
          "policy",
          "notification"
        ]
      }
    },
    {
      "expression": "`T-GH-37-${family}-missing-required-effect`",
      "domains": {
        "family": [
          "artifact",
          "policy",
          "notification"
        ]
      }
    },
    {
      "expression": "`T-GH-37-${family}-D`",
      "domains": {
        "family": [
          "execution",
          "artifact",
          "deployment",
          "test",
          "pull-request",
          "git-ref",
          "merge",
          "policy",
          "notification"
        ]
      }
    },
    {
      "expression": "`T-GH-37-${family}-pending`",
      "domains": {
        "family": [
          "execution",
          "artifact",
          "deployment",
          "test",
          "pull-request",
          "git-ref",
          "merge",
          "policy",
          "notification"
        ]
      }
    },
    {
      "expression": "`T-GH-37-${family}-missing-artifact-join`",
      "domains": {
        "family": [
          "deployment",
          "test"
        ]
      }
    },
    {
      "expression": "`T-GH-37-${family}-P`",
      "domains": {
        "family": [
          "execution",
          "artifact",
          "deployment",
          "test",
          "pull-request",
          "git-ref",
          "merge",
          "policy",
          "notification"
        ]
      }
    }
  ]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { digest } from '../src/core.mjs';
import { createGitHubStoreBridge } from '../src/github/store-bridge.mjs';
import { bridgeFixture, durableBytes } from './fixtures/github-store-bridge.mjs';

const negatives = {
  execution: value => { value.observation.result.executionRef = '999'; },
  test: value => { value.observation.result.testId = 'wrong-test'; },
  artifact: value => { value.observation.result.artifactId = '999'; },
  deployment: value => { value.observation.result.deploymentRef = '999'; },
  'pull-request': value => { value.observation.result.prId = 'pull-request:999'; },
  'git-ref': value => { value.observation.result.revision = 'f'.repeat(40); },
  merge: value => { value.observation.result.mergeRevision = 'f'.repeat(40); },
  policy: value => { value.observation.result.policyVersion = 'wrong-version'; },
  notification: value => { value.observation.result.deliveryReceipt = 'comment:999'; },
};

const gaps = {
  artifact: value => { delete value.observation.result.sha256; },
  policy: value => { delete value.observation.result.changeApplied; },
  notification: value => { delete value.observation.result.deliveryReceipt; },
};

const deniedRequests = {
  execution: ['POST', '/actions/workflows/301/dispatches', { ref: 'refs/heads/feature/fixture', inputs: {} }],
  test: ['GET', '/actions/runs/402/attempts/2'],
  artifact: ['GET', '/actions/artifacts/901'],
  deployment: ['POST', '/deployments', { ref: null, environment: 'DEV', auto_merge: false }],
  'pull-request': ['POST', '/pulls', { head: 'feature/fixture', base: 'main', draft: true, title: 'Fixture' }],
  'git-ref': ['PATCH', '/git/refs/heads/feature/fixture', { sha: null, force: false }],
  merge: ['PUT', '/pulls/1/merge', { sha: null, merge_method: 'merge' }],
  policy: ['POST', '/graphql'],
  notification: ['POST', '/issues/1/comments', { body: 'fixture publication' }],
};

test('GH-37 exact mandatory family quartets and non-success outcomes', async t => {
  const f = await bridgeFixture(t);
  const order = ['execution', 'artifact', 'deployment', 'test', 'pull-request', 'git-ref', 'merge', 'policy', 'notification'];
  for (const family of order) {
    await t.test(`T-GH-37-${family}-failed`, async () => {
      const failedCase = await f.prepare(family, '-failed');
      const failed = await f.failedResult(failedCase);
      const operation = await f.record(failedCase, failed, { status: 'failed' });
      assert.equal(operation.status, 'failed');
      assert.equal(operation.resultProof.status, 'failed');
      assert.equal(operation.resultProof.dispatchId, failedCase.claim.operation.id);
      const retained = (await f.store.records(f.workItemId)).find(value => value.id === operation.id);
      assert.deepEqual(retained.resultProof, operation.resultProof);
      if (family === 'test') {
        const evidence = (await f.store.records(f.workItemId)).find(value => value.type === 'test-evidence' &&
          value.operationId === operation.id);
        assert.equal(evidence.status, 'Failed');
      }
    });
    const prepared = await f.prepare(family);
    const acquisition = await f.result(prepared);
    const before = await durableBytes(f);
    await t.test(`T-GH-37-${family}-N`, async () => {
      await assert.rejects(f.record(prepared, f.variant(acquisition, negatives[family])),
        { code: 'EVIDENCE' });
      if (family === 'notification') await assert.rejects(f.record(prepared, f.variant(acquisition, value => {
        value.observation.result.personalReceipt = true;
        value.observation.result.read = true;
      })), { code: 'EVIDENCE', message: 'GitHub result proof rejected: unsupported-result-shape' });
      assert.deepEqual(await durableBytes(f), before);
    });
    await t.test(`T-GH-37-${family}-G`, async () => {
      await assert.rejects(f.record(prepared, f.variant(acquisition,
        value => { delete value.observation.causalProof; })), error => {
        assert.equal(error.code, 'EVIDENCE');
        assert.equal(error.message, 'GitHub result proof rejected: missing-dispatch-to-result-proof');
        return true;
      });
      assert.deepEqual(await durableBytes(f), before);
    });
    if (gaps[family]) await t.test(`T-GH-37-${family}-missing-required-effect`, async () => {
      await assert.rejects(f.record(prepared, f.variant(acquisition, gaps[family])), { code: 'EVIDENCE' });
      assert.deepEqual(await durableBytes(f), before);
    });
    await t.test(`T-GH-37-${family}-D`, async () => {
      const [method, suffix, originalPayload] = deniedRequests[family];
      const route = family === 'policy' ? suffix : `/repos/bridge-owner/bridge-repo${suffix}`;
      const payload = originalPayload && structuredClone(originalPayload);
      if (payload?.sha === null) payload.sha = f.revision;
      if (payload?.ref === null) payload.ref = f.revision;
      const callsBeforeDenial = f.calls.length;
      f.denyNext(route);
      const acquireDenied = family === 'policy' ? () => f.transport.execute(f.transport.buildGraphQLRequest({
        documentId: 'fixture-denied-auto-merge', operationName: 'GitHubAutoMergeEnable', operationKind: 'mutation',
        document: 'mutation GitHubAutoMergeEnable($input: EnablePullRequestAutoMergeInput!) { enablePullRequestAutoMerge(input: $input) { pullRequest { id updatedAt } } }',
        variables: { input: { pullRequestId: 'PR_801', expectedHeadOid: f.revision, mergeMethod: 'MERGE' } },
        schemaProfile: 'github-collaboration-2026-03-10', proofScope: 'repository:101',
        tokenClasses: ['fine-grained-pat'], permissions: [{ name: 'pull-requests', level: 'write' }],
        validateData: value => value?.enablePullRequestAutoMerge?.pullRequest?.id === 'PR_801',
      }), { actionAuthority: { operationId: prepared.claim.operation.id,
        authorityRef: 'fixture-auto-merge-permission', dispatchClaimId: prepared.claim.hostCallId } }) :
        () => f.acquire(method, route, undefined, {
        payload, ...(method === 'GET' ? {} : { call: prepared.claim }),
      });
      await assert.rejects(acquireDenied, error => {
        assert.equal(error.code, 'PERMISSION');
        assert.equal(error.message, 'GitHub acquisition was denied');
        assert.equal(error.details.status, 403);
        assert.equal(error.details.connectionId, 'bridge-fixture');
        assert.doesNotMatch(JSON.stringify(error), /isolated-fixture-credential|Resource not accessible/u);
        return true;
      });
      assert.deepEqual(f.calls.slice(callsBeforeDenial), [{ key: `${method} ${route}`, denied: true }]);
      assert.deepEqual(await durableBytes(f), before);
      const calls = f.calls.length;
      await assert.rejects(f.record(prepared, f.deniedResult(prepared)), {
        code: 'AUTHORITY', message: 'Trusted host denies this exact fixture operation and repository scope',
      });
      assert.equal(f.calls.length, calls);
      assert.deepEqual(await durableBytes(f), before);
    });
    await t.test(`T-GH-37-${family}-pending`, async () => {
      const calls = f.calls.length;
      const pending = f.pendingResult(acquisition);
      const verified = f.verified(pending);
      const operation = await f.record(prepared, pending, { status: verified.observation.status });
      assert.equal(operation.status, verified.observation.status);
      assert.equal(operation.resultProof, undefined);
      const retained = (await f.store.records(f.workItemId)).find(value => value.id === operation.id);
      assert.equal(retained.status, operation.status);
      assert.equal(retained.resultProof, undefined);
      assert.equal(f.calls.length, calls, 'Pending retention must not repeat the actual mutation');
    });
    if (['deployment', 'test'].includes(family)) await t.test(`T-GH-37-${family}-missing-artifact-join`, async () => {
      const unchanged = await durableBytes(f);
      await assert.rejects(f.record(prepared, f.variant(acquisition, value => {
        delete value.observation.result.artifactId;
        if (family === 'test') delete value.observation.result.deploymentId;
      })), { code: 'EVIDENCE' });
      assert.deepEqual(await durableBytes(f), unchanged);
    });
    await t.test(`T-GH-37-${family}-P`, async () => {
      const operation = await f.record(prepared, acquisition, { reconcile: true });
      assert.equal(operation.status, 'succeeded');
      assert.equal(operation.resultProof.providerResultId, f.verified(acquisition).observation.providerResultId);
      assert.equal(operation.resultProof.resultDigest, digest(f.verified(acquisition).observation));
      assert.equal(operation.resultProof.dispatchId, prepared.claim.operation.id);
      assert.equal(operation.resultProof.intendedOutcomeDigest, prepared.claim.operation.intendedOutcome.digest);
      assert.equal(operation.resultProof.causalKey, `host:${digest(prepared.claim.hostCallId)}`);
      if (family === 'execution') await f.selectArtifact(operation);
      if (family === 'deployment') f.deployment = operation;
      if (family === 'test') {
        const evidence = (await f.store.records(f.workItemId)).find(value => value.operationId === operation.id &&
          value.type === 'test-evidence');
        assert.equal(evidence.status, 'Passed');
        assert.equal(evidence.deploymentId, f.deployment.id);
        assert.equal(evidence.testSpecDigest, f.cycle.testSpecDigest);
      }
      if (family === 'notification') {
        assert.equal(operation.resultProof.providerResultId, 'comment:1001');
        assert.equal(operation.intendedOutcome.requested.recipient,
          'https://github.com/bridge-owner/bridge-repo/issues/1');
        assert.equal(operation.resultProof.personalReceipt, undefined);
      }
      const calls = f.calls.length;
      assert.deepEqual(await f.record(prepared, acquisition, { reconcile: true }), operation);
      const completed = await durableBytes(f);
      await assert.rejects(f.record(prepared, f.variant(acquisition, value => {
        value.observation.evidence.ref = 'fixture:changed-terminal-history';
      }), { reconcile: true }), { code: 'ID_CONFLICT' });
      assert.deepEqual(await durableBytes(f), completed);
      assert.equal(f.calls.length, calls, 'Exact replay and conflicting history must remain result-only');
    });
  }

  await t.test('existing Store retains native failed and running results without a successful requested-effect proof', async () => {
    for (const [suffix, status] of [['persist-failed', 'failed'], ['persist-pending', 'running']]) {
      const prepared = await f.prepare('execution', `-${suffix}`);
      const observedResult = await f.result(prepared, value => value, { status });
      const verified = f.verified(observedResult);
      const operation = await f.bridge.legacyOperations.recordResult(prepared.preparation, {
        workItemId: f.workItemId, operationId: prepared.claim.operation.id, status, observedResult,
        ...(status === 'running' ? {
          handle: verified.observation.providerResultId,
          requestFingerprint: prepared.claim.operation.requestFingerprint,
          correlationKey: prepared.claim.operation.correlationKey,
        } : {}),
      }, f.store);
      assert.equal(operation.status, status);
      assert.notEqual(operation.resultProof?.status, 'succeeded');
      if (status === 'failed') assert.equal(operation.resultProof.status, 'failed');
      else assert.equal(operation.resultProof, undefined);
    }
  });
});

test('construction rejects self-attested callbacks and missing acquisitions do not confer trust', async () => {
  assert.throws(() => createGitHubStoreBridge({ verifiers: { verifyRepository: true } }), { code: 'ADAPTER' });
  assert.throws(() => createGitHubStoreBridge({ verifiers: { verifyOperationResult: { trusted: true } } }), { code: 'ADAPTER' });
  const bridge = createGitHubStoreBridge();
  await assert.rejects(bridge.storeOptions().verifyRepository({
    provider: 'github', localRepositoryPath: path.resolve('fixture'), remoteRepositoryURL: 'https://github.com/o/r.git',
  }), { code: 'ADAPTER' });
  assert.deepEqual(bridge.missingVerifiers, [
    'verifyRepository', 'verifyPullRequest', 'verifyCheckResults',
    'verifyOperationResult', 'verifyArtifact', 'verifyProviderVersion',
  ]);
});
