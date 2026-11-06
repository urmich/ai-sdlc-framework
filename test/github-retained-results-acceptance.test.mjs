export const validationDeclarations = {
  "schemaVersion": 1,
  "variants": [
    {"expression": "name", "names": ["T-GHB17 changed retrieval bytes fail integrity", "T-GHB17 independently acquired digest contradiction fails integrity", "T-GHC10-N another producer cannot reuse immutable bytes", "T-GHC10-G nullable metadata without independent producer stays unverified", "T-GHB18 hashing bytes without independent original byte proof cannot admit", "T-GHB19 expired artifact cannot replace current selection or establish historical absence", "T-GHC21-N mutable tag cannot prove selected delivered revision", "T-GHC21-N another full candidate revision cannot borrow release lineage", "T-GHC21-N unrelated asset release cannot borrow candidate lineage", "T-GHC21-G missing destination cannot establish delivered release"]},
    {"expression": "`T-GHC14 exact ${mergeMethod} method rejects another acquired merge method`", "domains": {"mergeMethod": ["merge", "squash", "rebase"]}}
  ]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Store } from '../src/store.mjs';
import { digest, requireThat } from '../src/core.mjs';
import { recordArtifact } from '../src/validation.mjs';
import { currentArtifact } from '../src/current-evidence.mjs';
import { createGitHubStoreBridge } from '../src/github/store-bridge.mjs';
import { createGitHubTransport, requireGitHubCapture, requireGitHubRequestBinding } from '../src/github/transport.mjs';
import { grant, orient } from './helpers.mjs';
import { bridgeFixture, durableBytes, configurationDigest, remote, repositoryRef } from './fixtures/github-store-bridge.mjs';

const base = '/repos/bridge-owner/bridge-repo';
const bytes = Buffer.from('immutable fixture artifact');
const sha256 = value => createHash('sha256').update(value).digest('hex');

function sourceTransport(f) {
  const replies = new Map();
  const calls = [];
  const transport = createGitHubTransport({
    connection: f.connection,
    fetch: async (url, init) => {
      const key = `${init.method} ${new URL(url).pathname}`;
      const reply = replies.get(key);
      assert.notEqual(reply, undefined, `Undeclared fixture request ${key}`);
      const payload = init.body === undefined ? undefined : JSON.parse(init.body);
      assert.deepEqual(payload, reply.payload);
      calls.push({ key, payload });
      return new Response(reply.status === 204 ? null :
        reply.bytes ?? JSON.stringify(reply.body), {
        status: reply.status,
        headers: { 'content-type': reply.bytes ? 'application/octet-stream' : 'application/json' },
      });
    },
  });
  async function acquire(method, route, body, {
    status = 200, payload, content, claim,
  } = {}) {
    replies.set(`${method} ${route}`, { body: structuredClone(body), status, payload, bytes: content });
    const specification = {
      method, path: route, profile: '2026-03-10', mediaType: 'application/vnd.github+json',
      expectedStatuses: [200, 201, 204], proofScope: repositoryRef,
      tokenClasses: ['fine-grained-pat'],
      permissions: [{ name: route.includes('/actions/') ? 'actions' : 'contents',
        level: method === 'GET' ? 'read' : 'write' }],
      responseType: content ? 'bytes' : status === 204 ? 'empty' : 'json',
      ...(payload === undefined ? {} : { payload }),
    };
    const capture = await transport.execute(transport.buildRestRequest(specification),
      claim ? { actionAuthority: { operationId: claim.operation.id,
        authorityRef: 'fixture-separate-effect-grant', dispatchClaimId: claim.hostCallId } } : {});
    requireGitHubCapture(capture, f.connection);
    requireGitHubRequestBinding(capture, specification);
    return capture;
  }
  return { acquire, calls };
}

async function rejectedWithoutChange(f, callback, code, message) {
  const before = await durableBytes(f);
  await assert.rejects(callback, error => {
    assert.equal(error.code, code);
    if (message) assert.match(error.message, message);
    assert.doesNotMatch(JSON.stringify(error), /isolated-fixture-credential|signed-download-secret/u);
    return true;
  });
  assert.deepEqual(await durableBytes(f), before);
}

test('retained artifact and release lineage uses original producer receipt and acquired immutable bytes', async t => {
  const f = await bridgeFixture(t);
  const build = await f.prepare('execution');
  const producer = await f.record(build, await f.result(build));
  const source = sourceTransport(f);
  const acquisitions = new Map();
  const authenticationKey = Buffer.from('isolated-original-producer-signing-key');
  let serial = 0;
  async function acquireArtifact({
    providerDigest = null, providerAttempt = null, content = bytes, expired = false,
    status = 200, producerRun = '401', omitProducer = false, omitByteProof = false,
    releaseRevision = f.revision, assetRelease = '501', omitDestination = false,
  } = {}) {
    const artifact = await source.acquire('GET', `${base}/actions/artifacts/901`, {
      id: 901, name: 'bridge.zip', digest: providerDigest, run_attempt: providerAttempt, expired,
      workflow_run: { id: 401, repository_id: 101, head_sha: f.revision },
    }, { status });
    const run = await source.acquire('GET', `${base}/actions/runs/401/attempts/2`, {
      id: 401, workflow_id: 301, run_attempt: 2, repository: { id: 101 }, head_sha: f.revision,
    });
    const release = await source.acquire('GET', `${base}/releases/501`, {
      id: 501, tag_name: 'v-fixture', target_commitish: releaseRevision, draft: false,
      url: `https://api.github.com${base}/releases/501`,
    });
    const asset = await source.acquire('GET', `${base}/releases/assets/901`, {
      id: 901, name: 'bridge.zip', digest: null, state: 'uploaded',
      url: `https://api.github.com${base}/releases/assets/901`,
    });
    const manifest = {
      artifactId: '901', releaseId: assetRelease, assetId: '901', sourceRevision: f.revision,
      configDigest: configurationDigest, repositoryURL: remote,
      ...(omitByteProof ? {} : { sha256: sha256(bytes) }),
      ...(omitProducer ? {} : { producer: { provider: 'github', connection: 'bridge-fixture',
        scopeRef: repositoryRef, definitionRef: '301', executionRef: producerRun,
        attemptKind: 'known', attemptRef: '2' } }),
      ...(omitDestination ? {} : { destination: remote }),
    };
    const original = Buffer.from(JSON.stringify(manifest));
    const signature = createHmac('sha256', authenticationKey).update(original).digest();
    const receipt = await source.acquire('GET', `${base}/actions/artifacts/902/zip`,
      undefined, { content: original });
    const downloaded = await source.acquire('GET', `${base}/releases/assets/901`,
      undefined, { content });
    const handle = `retained-artifact-${++serial}`;
    acquisitions.set(handle, { artifact, run, release, asset, receipt, signature, downloaded });
    return { handle };
  }
  const artifactBridge = createGitHubStoreBridge({
    verifiers: {
      verifyArtifact({ observation }) {
        const actual = acquisitions.get(observation.handle);
        requireThat(actual, 'PROOF_GAP', 'Original artifact acquisition is unavailable');
        for (const capture of [actual.artifact, actual.run, actual.release,
          actual.asset, actual.receipt, actual.downloaded]) requireGitHubCapture(capture, f.connection);
        requireThat(timingSafeEqual(createHmac('sha256', authenticationKey)
          .update(actual.receipt.body).digest(), actual.signature), 'INTEGRITY',
        'Original producer receipt bytes changed');
        const manifest = JSON.parse(Buffer.from(actual.receipt.body).toString('utf8'));
        requireThat(actual.artifact.body.expired === false, 'UNAVAILABLE', 'Selected artifact has expired');
        requireThat(manifest.producer && manifest.sha256 && manifest.destination,
          'PROOF_GAP', 'Independent producer, byte and destination proof is required');
        requireThat(actual.artifact.body.workflow_run.id === actual.run.body.id &&
          actual.artifact.body.workflow_run.repository_id === actual.run.body.repository.id &&
          manifest.producer.executionRef === String(actual.run.body.id) &&
          manifest.producer.definitionRef === String(actual.run.body.workflow_id) &&
          manifest.producer.attemptRef === String(actual.run.body.run_attempt) &&
          manifest.sourceRevision === actual.run.body.head_sha &&
          manifest.repositoryURL === remote && manifest.destination === remote &&
          manifest.artifactId === String(actual.artifact.body.id) &&
          manifest.releaseId === String(actual.release.body.id) &&
          manifest.assetId === String(actual.asset.body.id) &&
          actual.release.body.target_commitish === manifest.sourceRevision &&
          actual.asset.body.name === actual.artifact.body.name,
        'EVIDENCE', 'Release asset differs from independently proven producer, candidate or destination');
        const contentDigest = sha256(actual.downloaded.body);
        requireThat(contentDigest === manifest.sha256 &&
          (actual.artifact.body.digest === null ||
            actual.artifact.body.digest === `sha256:${contentDigest}`),
        'INTEGRITY', 'Retrieved artifact bytes or provider digest contradict original producer proof');
        requireThat(actual.artifact.body.run_attempt === null ||
          String(actual.artifact.body.run_attempt) === manifest.producer.attemptRef,
        'EVIDENCE', 'Provider attempt contradicts original producer proof');
        return {
          repositoryId: 'primary', localRepositoryPath: f.repo, remoteRepositoryURL: manifest.repositoryURL,
          provider: manifest.producer.provider, connection: manifest.producer.connection,
          repositoryRef: manifest.producer.scopeRef, sourceRevision: manifest.sourceRevision,
          configDigest: manifest.configDigest, artifactId: String(actual.artifact.body.id),
          artifactRef: `artifact:${actual.artifact.body.id}`, artifactSha256: contentDigest,
          buildRunId: `${actual.run.body.id}:${manifest.producer.attemptRef}`,
          name: actual.asset.body.name, evidenceRef: `fixture:release:${actual.release.body.id}:asset:${actual.asset.body.id}`,
          attemptCapability: 'distinct', attemptRef: manifest.producer.attemptRef,
          producingExecution: manifest.producer,
        };
      },
    },
  });
  f.store.verifyArtifact = artifactBridge.storeOptions().verifyArtifact;
  const input = observation => ({
    workItemId: f.workItemId, cycleId: f.cycle.id, artifactId: '901', environment: 'DEV',
    sourceDigest: f.cycle.candidateDigest, configDigest: configurationDigest, buildRunId: '401:2',
    name: 'bridge.zip', artifactType: 'zip', evidenceRef: 'fixture:release:501:asset:901',
    status: 'succeeded', repositoryId: 'primary', localRepositoryPath: f.repo,
    remoteRepositoryURL: remote, provider: 'github', connection: 'bridge-fixture',
    repositoryRef, sourceRevision: f.revision, artifactRef: 'artifact:901',
    artifactSha256: sha256(bytes), producingOperationId: producer.id, producerObservation: observation,
  });
  const good = await acquireArtifact();
  await t.test('T-GHB18 nullable provider digest and attempt admit only independent exact producer and bytes', async () => {
    const native = acquisitions.get(good.handle);
    assert.equal(native.artifact.body.digest, null);
    assert.equal(native.artifact.body.run_attempt, null);
    assert.equal(native.asset.body.digest, null);
    const selected = await recordArtifact(f.store, input(good));
    assert.equal(selected.artifactSha256, sha256(bytes));
    assert.deepEqual(selected.producingExecution, producer.resultProof.executionIdentity);
    assert.equal(selected.producingAttemptRef, '2');
    assert.equal(selected.producingOperationId, producer.id);
    assert.equal(selected.evidenceRef, 'fixture:release:501:asset:901');
    const state = await f.store.load(f.workItemId);
    assert.equal(currentArtifact(state.records.find(row => row.id === f.cycle.id), state.records, selected), true);
  });
  for (const [name, options, code, message] of [
    ['T-GHB17 changed retrieval bytes fail integrity', { content: Buffer.from('unrelated retrieval bytes') }, 'INTEGRITY', /bytes or provider digest/u],
    ['T-GHB17 independently acquired digest contradiction fails integrity', { providerDigest: `sha256:${'f'.repeat(64)}` }, 'INTEGRITY', /bytes or provider digest/u],
    ['T-GHC10-N another producer cannot reuse immutable bytes', { producerRun: '999' }, 'EVIDENCE', /independently proven/u],
    ['T-GHC10-G nullable metadata without independent producer stays unverified', { omitProducer: true }, 'PROOF_GAP', /Independent producer/u],
    ['T-GHB18 hashing bytes without independent original byte proof cannot admit', { omitByteProof: true }, 'PROOF_GAP', /Independent producer/u],
    ['T-GHB19 expired artifact cannot replace current selection or establish historical absence', { expired: true }, 'UNAVAILABLE', /has expired/u],
    ['T-GHC21-N mutable tag cannot prove selected delivered revision', { releaseRevision: 'v-fixture' }, 'EVIDENCE', /candidate or destination/u],
    ['T-GHC21-N another full candidate revision cannot borrow release lineage', { releaseRevision: 'f'.repeat(40) }, 'EVIDENCE', /candidate or destination/u],
    ['T-GHC21-N unrelated asset release cannot borrow candidate lineage', { assetRelease: '999' }, 'EVIDENCE', /candidate or destination/u],
    ['T-GHC21-G missing destination cannot establish delivered release', { omitDestination: true }, 'PROOF_GAP', /destination proof/u],
  ]) await t.test(name, async () => {
    const observation = await acquireArtifact(options);
    await rejectedWithoutChange(f, () => recordArtifact(f.store, input(observation)), code, message);
  });
  await t.test('T-GHB19 deleted and inaccessible retrieval stay unavailable without historical absence', async () => {
    for (const [status, code, message] of [
      [410, 'CONTRACT', /endpoint contract/u], [403, 'PERMISSION', /acquisition was denied/u],
    ]) await rejectedWithoutChange(f, () => acquireArtifact({ status }), code, message);
    const state = await f.store.load(f.workItemId);
    const selected = state.records.find(row => row.type === 'artifact');
    assert.equal(selected.artifactId, '901');
    assert.equal(selected.artifactSha256, sha256(bytes));
    assert.equal(selected.sequence, 1);
    assert.equal(state.records.find(row => row.id === producer.id).status, 'succeeded');
  });
  await t.test('T-GHC10-D artifact producer read HTTP403 is distinct from trusted admission denial', async () => {
    const before = await durableBytes(f);
    await assert.rejects(source.acquire('GET', `${base}/actions/runs/401/attempts/2`,
      { message: 'signed-download-secret' }, { status: 403 }), error => {
      assert.equal(error.code, 'PERMISSION');
      assert.equal(error.details.status, 403);
      assert.doesNotMatch(JSON.stringify(error), /signed-download-secret/u);
      return true;
    });
    assert.deepEqual(await durableBytes(f), before);
  });
  await t.test('T-GHC21-P exact release asset bytes flow into selected deployment and required test without promotion', async () => {
    const deploy = await f.prepare('deployment');
    f.deployment = await f.record(deploy, await f.result(deploy));
    const selectedTest = await f.prepare('test');
    const native = await f.authenticatedExecutionResult(selectedTest);
    assert.equal((await f.record(selectedTest, native.good)).status, 'succeeded');
    const state = await f.store.load(f.workItemId);
    const selected = state.records.find(row => row.type === 'artifact' && row.artifactId === '901');
    assert.equal(selected.sourceDigest, f.cycle.candidateDigest);
    assert.equal(selected.configDigest, configurationDigest);
    assert.equal(f.deployment.action.artifactRef, selected.artifactRef);
    assert.equal(f.deployment.action.artifactSha256, selected.artifactSha256);
    assert.equal(f.deployment.action.target, 'bridge-dev');
    const evidence = state.records.find(row => row.type === 'test-evidence' && row.operationId === selectedTest.claim.operation.id);
    assert.equal(evidence.status, 'Passed');
    assert.equal(evidence.artifactId, selected.artifactId);
    assert.equal(evidence.deploymentId, f.deployment.id);
    assert.equal(evidence.candidateDigest, f.cycle.candidateDigest);
    const cycle = state.records.find(row => row.id === f.cycle.id);
    assert.equal(cycle.deployments.DEV, f.deployment.id);
    assert.equal(cycle.deployments.STAGING, undefined);
    assert.equal(state.records.filter(row => row.type === 'operation' && row.action.environment === 'PROD').length, 0);
  });
  await t.test('T-GHC21-D selected release publication HTTP403 cannot establish release completion', async () => {
    const prepared = await f.prepare('artifact', '-release-denied');
    const before = await durableBytes(f);
    await assert.rejects(source.acquire('POST', `${base}/releases`, { message: 'signed-download-secret' },
      { status: 403, payload: { tag_name: 'v-fixture', target_commitish: f.revision },
        claim: prepared.claim }), error => {
      assert.equal(error.code, 'PERMISSION');
      assert.equal(error.details.status, 403);
      assert.doesNotMatch(JSON.stringify(error), /signed-download-secret/u);
      return true;
    });
    assert.deepEqual(await durableBytes(f), before);
    const operation = (await f.store.records(f.workItemId)).find(row => row.id === prepared.claim.operation.id);
    assert.equal(operation.status, 'dispatching');
    assert.equal(operation.resultProof, undefined);
  });
});

test('retained exact ref deletion and merge methods use acquired request bindings through public operations', async t => {
  const f = await bridgeFixture(t);
  const source = sourceTransport(f);
  const acquired = new Map();
  let serial = 0;
  const bridge = createGitHubStoreBridge({
    clock: f.clock, identifier: () => `retained-effect-call-${++serial}`,
    verifiers: {
      verifyOperationResult({ operation, observedResult }) {
        const actual = acquired.get(observedResult.handle);
        requireThat(actual && actual.claim.operation.id === operation.id, 'PROOF_GAP',
          'Original requested effect acquisition is missing');
        requireGitHubCapture(actual.capture, f.connection);
        const original = actual.claim.operation;
        const merge = original.class === 'merge';
        const route = merge ? `${base}/pulls/${original.action.toolOptions.pullNumber}/merge` :
          `${base}/git/refs/${original.action.targetRef.slice(5)}`;
        requireGitHubRequestBinding(actual.capture, {
          method: merge ? 'PUT' : 'DELETE', path: route,
          ...(merge ? { payload: { sha: original.action.sourceRevision,
            merge_method: original.action.toolOptions.mergeMethod } } : {}),
        });
        requireThat(actual.capture.dispatchIndication.dispatchClaimId === actual.claim.hostCallId,
          'EVIDENCE', 'Requested effect is not associated with original dispatch');
        const result = merge ? {
          remoteRepositoryURL: remote, prId: original.action.prId,
          merged: actual.capture.body.merged, mergeRevision: actual.capture.body.sha,
          sourceRevision: original.action.sourceRevision, targetRevision: original.action.targetRevision,
        } : {
          remoteRepositoryURL: remote, remoteUrlDigest: digest([remote]), destination: 'origin',
          ref: `refs/${actual.capture.requestIdentity.path.split('/git/refs/')[1]}`,
          deleted: actual.capture.status === 204, deletionConfirmed: actual.capture.status === 204,
        };
        const providerResultId = merge ? `${result.prId}:${result.mergeRevision}` : `${result.destination}:${result.ref}`;
        return {
          dispatch: { id: original.id, hostCallId: actual.claim.hostCallId, hostCallSupported: true },
          observation: { status: 'succeeded', providerStatus: 'succeeded', providerVerified: true,
            family: merge ? 'merge' : 'git-ref', target: original.intendedOutcome.target,
            intendedOutcomeDigest: original.intendedOutcome.digest, providerResultId,
            causalProof: { kind: 'host-call', supported: true, dispatchId: original.id,
              hostCallId: actual.claim.hostCallId, resultId: providerResultId },
            result, evidence: { ref: 'fixture:independently-acquired-effect', verified: true, sha256: digest(result) } },
        };
      },
    },
  });
  f.store = await new Store(f.home, { ...f.bridge.storeOptions(),
    verifyOperationResult: bridge.storeOptions().verifyOperationResult }).ready();
  const common = { repositoryId: 'primary', provider: 'github', localRepositoryPath: f.repo,
    remoteRepositoryURL: remote, sourceRevision: f.revision, configDigest: configurationDigest };
  async function prepare(action, operationId) {
    const preparation = await bridge.legacyOperations.prepare({
      workItemId: f.workItemId, sessionId: f.sessionId, operationId, action,
      request: { toolName: 'github-existing-consumer', toolArgs: { operationId, action }, cwd: f.repo },
      correlationKey: operationId, intent: 'Fixture-only exact requested method and destination',
    }, f.store);
    return { preparation, claim: await bridge.legacyOperations.claimDispatch(preparation, f.store) };
  }
  async function observe(prepared, method, route, body, options) {
    const capture = await source.acquire(method, route, body, { ...options, claim: prepared.claim });
    const handle = `retained-effect-${++serial}`;
    acquired.set(handle, { claim: prepared.claim, capture });
    return { handle };
  }
  const record = (prepared, observedResult) => bridge.legacyOperations.recordResult(prepared.preparation, {
    workItemId: f.workItemId, operationId: prepared.claim.operation.id, status: 'succeeded', observedResult,
  }, f.store);
  for (const [index, mergeMethod] of ['merge', 'squash', 'rebase'].entries()) {
    await t.test(`T-GHC14 exact ${mergeMethod} method rejects another acquired merge method`, async () => {
      const action = { ...common, class: 'merge', prId: `pull-request:${801 + index}`,
        targetRevision: f.revision, toolOptions: { mergeMethod, pullNumber: index + 1 } };
      const prepared = await prepare(action, `retained-merge-${mergeMethod}`);
      const route = `${base}/pulls/${index + 1}/merge`;
      const body = { merged: true, sha: digest(`independent-${mergeMethod}-merge`).slice(0, 40) };
      const wrong = await observe(prepared, 'PUT', route, body,
        { payload: { sha: f.revision, merge_method: mergeMethod === 'merge' ? 'squash' : 'merge' } });
      await rejectedWithoutChange(f, () => record(prepared, wrong), 'EVIDENCE', /payload differs/u);
      const good = await observe(prepared, 'PUT', route, body, { payload: { sha: f.revision, merge_method: mergeMethod } });
      const result = await record(prepared, good);
      assert.equal(result.status, 'succeeded');
      assert.equal(result.intendedOutcome.requested.toolOptions.mergeMethod, mergeMethod);
      assert.equal(result.resultProof.providerResultId, `${action.prId}:${body.sha}`);
      assert.deepEqual(source.calls.at(-1), { key: `PUT ${route}`, payload: { sha: f.revision, merge_method: mergeMethod } });
    });
  }
  const deletion = { ...common, class: 'push', target: 'origin', remoteUrlDigest: digest([remote]),
    sourceRef: 'refs/heads/feature/fixture', targetRef: 'refs/heads/feature/fixture', force: false, delete: true };
  await t.test('T-GHC13-N ordinary publication authority cannot authorize exact ref deletion', async () => {
    await rejectedWithoutChange(f, () => prepare(deletion, 'retained-delete-ungranted'), 'GATE', /^Operation is not authorized$/u);
  });
  await grant(f, 'override', { rules: ['remote-ref-delete'], reason: 'Isolated fixture deletion only',
    scope: { repositoryIds: ['primary'] }, lifetime: { kind: 'work-item' } });
  await grant(f, 'permission', { grant: 'push', target: 'origin', remoteUrlDigest: digest([remote]),
    sourceRef: deletion.sourceRef, targetRef: deletion.targetRef, sourceRevision: f.revision,
    force: false, delete: true, localRepositoryPath: f.repo, remoteRepositoryURL: remote });
  await orient(f);
  await t.test('T-GHC13-P exact acquired DELETE differs from publication PATCH and another full ref', async () => {
    const prepared = await prepare(deletion, 'retained-delete');
    const route = `${base}/git/refs/heads/feature/fixture`;
    const publication = await observe(prepared, 'PATCH', route,
      { ref: deletion.targetRef, object: { sha: f.revision } }, { payload: { sha: f.revision, force: false } });
    await rejectedWithoutChange(f, () => record(prepared, publication), 'EVIDENCE', /request differs/u);
    const wrongRef = await observe(prepared, 'DELETE', `${base}/git/refs/heads/other`, undefined, { status: 204 });
    await rejectedWithoutChange(f, () => record(prepared, wrongRef), 'EVIDENCE', /request differs/u);
    const good = await observe(prepared, 'DELETE', route, undefined, { status: 204 });
    const result = await record(prepared, good);
    assert.equal(result.status, 'succeeded');
    assert.equal(result.intendedOutcome.requested.delete, true);
    assert.equal(result.resultProof.providerResultId, 'origin:refs/heads/feature/fixture');
    assert.deepEqual(source.calls.at(-1), { key: `DELETE ${route}`, payload: undefined });
  });
});
