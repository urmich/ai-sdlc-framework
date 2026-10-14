import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { digest } from '../src/core.mjs';
import { recordArtifact } from '../src/validation.mjs';
import { adoptPr } from '../src/pr.mjs';
import { attachMonitor, verifyMonitorLink, readMonitor } from '../src/monitors.mjs';
import { registerGitHubAdapter } from '../src/github/execution-adapter.mjs';
import { verifyProviderLink } from '../src/provider-adapters.mjs';
import { grant, orient } from './helpers.mjs';
import { bridgeFixture, durableBytes, remote, repositoryRef } from './fixtures/github-store-bridge.mjs';

const base = '/repos/bridge-owner/bridge-repo';
const revision = 'f'.repeat(40);
const consumer = 'createGitHubStoreBridge.legacyOperations.recordResult -> recordOperation -> validateOperationResult';

// These are source-binding aliases, not additional tests or acceptance credit.
export const existingAssertionCandidates = Object.freeze([
  ...['execution', 'test', 'artifact', 'deployment', 'pull-request', 'notification'].map(family => ({
    id: `T-GH-37-${family}-wrong-item`,
    file: 'test/github-operation-results.unit.test.mjs', selector: `T-GH-37-${family}-N`,
    assertion: `negatives.${family}; f.record rejects EVIDENCE and durableBytes is unchanged`, consumer,
  })),
  { id: 'T-GH-37-policy-wrong-version', file: 'test/github-operation-results.unit.test.mjs',
    selector: 'T-GH-37-policy-N', assertion: 'result.policyVersion differs independently; EVIDENCE; immutable durable state', consumer },
  { id: 'T-GH-37-git-ref-wrong-revision', file: 'test/github-operation-results.unit.test.mjs',
    selector: 'T-GH-37-git-ref-N', assertion: 'result.revision differs independently; EVIDENCE; immutable durable state', consumer },
  { id: 'T-GH-37-notification-wrong-producer', file: 'test/github-operation-results.unit.test.mjs',
    selector: 'independently acquired different publication producer',
    assertion: 'actual comment read returns user.id=999; private producer reference rejected by recordResult/reconcile', consumer },
  { id: 'T-GH-37-local-build', file: 'test/github-operation-results.unit.test.mjs',
    selector: 'local build remains a real local operation without GitHub execution or result proof',
    assertion: 'real local operation has no intendedOutcome or hosted resultProof', consumer },
  { id: 'T-GH-36-ADO03-attempt', file: 'test/github-provider-consumers.test.mjs', selector: 'T-GH-36-ADO14-N',
    assertion: 'expected attempt 1 versus actually observed attempt 2 is unverified', consumer: 'verifyProviderLink' },
  { id: 'T-GH-36-ADO05-mismatch', file: 'test/github-provider-consumers.test.mjs', selector: 'T-GH-36-ADO05-N',
    assertion: 'accessible final run 999 cannot match run 401', consumer: 'verifyProviderLink' },
  { id: 'T-GH-36-ADO08-alias-positive', file: 'test/github-provider-consumers.test.mjs', selector: 'T-GH-36-ADO09-P',
    assertion: 'actual SSH push URL explicitly verified from native repository fields and admitted with stable repository ID',
    consumer: 'Store.observeRepository' },
  { id: 'T-GH-36-ADO21-publication', file: 'test/github-provider-consumers.test.mjs', selector: 'T-GH-36-ADO21-P',
    assertion: 'claimed git-ref operation persists exact destination/ref/full revision publication proof', consumer },
  { id: 'T-GH-36-ADO22-merge', file: 'test/github-provider-consumers.test.mjs', selector: 'T-GH-36-ADO22-P',
    assertion: 'actual merged=true and mergeRevision are admitted independently of applied policy', consumer },
  { id: 'T-GH-36-ADO22-policy', file: 'test/github-provider-consumers.test.mjs', selector: 'T-GH-36-ADO22-P',
    assertion: 'actual GraphQL mutation plus independent versioned readback persists applied policy proof', consumer },
  { id: 'T-GH-36-ADO24-offline-rejected', file: 'test/github-provider-consumers.test.mjs', selector: 'T-GH-36-ADO24-G',
    assertion: 'installed ordinary CLI without injected verifier rejects provider facts; P separately admits', consumer: 'runCli -> Store.observeRepository' },
  { id: 'T-GH-36-ADO19-config', file: 'test/github-existing-consumer-boundaries.unit.test.mjs',
    selector: 'T-GH-37-deployment-wrong-version', assertion: 'Only result.configDigest changes; actual deployed artifact unchanged', consumer },
  { id: 'T-GH-36-ADO21-destination', file: 'test/github-existing-consumer-boundaries.unit.test.mjs',
    selector: 'T-GH-37-git-ref-wrong-item', assertion: 'Only destination changes; full ref/revision unchanged', consumer },
  { id: 'T-GH-36-ADO10-default', file: 'test/github-existing-consumer-boundaries.unit.test.mjs',
    selector: 'T-GH-36-ADO10-stale-default', assertion: 'Current native default admitted, stale cached branch independently rejected',
    consumer: 'Store.observeRepository' },
  { id: 'T-GH-36-ADO10-selected', file: 'test/github-existing-consumer-boundaries.unit.test.mjs',
    selector: 'T-GH-36-ADO10-prefix-search', assertion: 'Current full ref/SHA verified, different prefix ref independently rejected',
    consumer: 'Store.observeRepository' },
]);

export const resultBoundaryCases = Object.freeze({
  execution: [
    ['repository', 'executionIdentity.scopeRef', 'repository:202', 'inconsistent-execution-identity'],
    ['producer', 'executionIdentity.definitionRef', '999', 'inconsistent-execution-identity'],
    ['attempt', 'attemptRef', '1', 'inconsistent-execution-identity'],
    ['version', 'configDigest', 'foreign-source-config', 'wrong-or-incomplete-result'],
  ],
  test: [
    ['repository', 'executionIdentity.scopeRef', 'repository:202', 'inconsistent-execution-identity'],
    ['producer', 'executionIdentity.definitionRef', '999', 'inconsistent-execution-identity'],
    ['attempt', 'attemptRef', '1', 'inconsistent-execution-identity'],
    ['version', 'configDigest', 'foreign-test-config', 'wrong-or-incomplete-result'],
  ],
  artifact: [
    ['repository', 'executionIdentity.scopeRef', 'repository:202', 'inconsistent-execution-identity'],
    ['revision', 'sourceRevision', revision, 'wrong-or-incomplete-result'],
    ['producer', 'executionIdentity.definitionRef', '999', 'inconsistent-execution-identity'],
    ['attempt', 'attemptRef', '1', 'inconsistent-execution-identity'],
    ['version', 'sha256', 'f'.repeat(64), 'wrong-or-incomplete-result'],
  ],
  deployment: [
    ['repository', 'remoteRepositoryURL', 'https://github.com/foreign/deployment.git', 'wrong-or-incomplete-result'],
    ['revision', 'sourceRevision', revision, 'wrong-or-incomplete-result'],
    ['version', 'configDigest', 'foreign-deployment-config', 'wrong-or-incomplete-result'],
  ],
  'pull-request': [
    ['repository', 'targetRepositoryURL', 'https://github.com/foreign/base.git', 'wrong-or-incomplete-result'],
    ['ref', 'targetRef', 'refs/heads/foreign-base', 'wrong-or-incomplete-result'],
    ['revision', 'sourceRevision', revision, 'wrong-or-incomplete-result'],
  ],
  'git-ref': [
    ['repository', 'remoteRepositoryURL', 'https://github.com/foreign/destination.git', 'wrong-or-incomplete-result'],
    ['item', 'destination', 'foreign-destination', 'wrong-or-incomplete-result'],
    ['ref', 'ref', 'refs/heads/foreign-destination', 'wrong-or-incomplete-result'],
  ],
  merge: [
    ['repository', 'remoteRepositoryURL', 'https://github.com/foreign/base.git', 'wrong-or-incomplete-result'],
    ['revision', 'mergeRevision', revision, 'result-identity-disagrees'],
    ['item', 'prId', 'pull-request:999', 'wrong-or-incomplete-result'],
    ['version', 'sourceRevision', revision, 'wrong-or-incomplete-result'],
  ],
  policy: [
    ['repository', 'remoteRepositoryURL', 'https://github.com/foreign/policy.git', 'wrong-or-incomplete-result'],
    ['item', 'target', 'https://github.com/bridge-owner/bridge-repo/pull/999', 'wrong-or-incomplete-result'],
  ],
  notification: [
    ['repository', 'remoteRepositoryURL', 'https://github.com/foreign/publication.git', 'wrong-or-incomplete-result'],
  ],
});

// These are current join dependencies, not missing GitHub features or a claim
// that opaque source services cannot implement them. No caller-added JSON field
// is used as an original producer/ref/sequence authentication substitute.
export const unresolvedContractAxes = Object.freeze({
  execution: { ref: 'Current authenticated runner manifest does not bind executed full ref to the original operation',
    sequence: 'Original run definition does not seal replay context/order; exact private acquisition currentness join required' },
  test: { ref: 'Current authenticated named-test manifest does not bind tested full ref to the original operation',
    sequence: 'Original check receipt can seal acquisition context; Store projection needs that actual retained source association' },
  artifact: { ref: 'Artifact result has no authenticated producing source full ref comparison',
    sequence: 'Result family has no provenance observation sequence' },
  deployment: { ref: 'Deployment result has no selected full source ref comparison',
    sequence: 'Deployment result schema carries no original status-history ordering' },
  'pull-request': { producer: 'Original PR SDK receipt must be selected under the mutation operation/call and passed to its result projection' },
  'git-ref': { producer: 'Ref result schema has no original authenticated response-producer identity',
    version: 'Exact original source-config/result guard is required; configDigest mismatch is admitted by the current legacy git-ref result consumer',
    sequence: 'Ref result schema has no original ref observation sequence' },
  merge: { ref: 'Merge result schema does not compare destination full ref',
    producer: 'Merge result schema has no independently authenticated response-producer identity',
    sequence: 'Merge result schema has no original terminal observation ordering' },
  policy: { producer: 'Original applied-change factory receipt must be retained under the exact claim and selected by the result verifier',
    sequence: 'Policy result has no original policy observation ordering' },
  notification: { sequence: 'Original publication receipt order must be retained by the result source and selected under the exact claim' },
});

function assign(value, field, replacement) {
  const keys = field.split('.');
  const name = keys.pop();
  const parent = keys.reduce((node, key) => node[key], value);
  parent[name] = replacement;
}

async function observedAxis(f, prepared, acquisition, field, replacement) {
  const family = prepared.claim.operation.intendedOutcome.family;
  const original = f.verified(acquisition).observation.result;
  const projected = structuredClone(original);
  assign(projected, field, replacement);
  if (['execution', 'test'].includes(family) && field !== 'configDigest') {
    const requestPath = `${base}/actions/runs/${original.executionRef}/attempts/${original.attemptRef}`;
    const body = { id: Number(original.executionRef), repository: { id: 101 }, workflow_id: 301,
      run_attempt: 2, head_sha: original.sourceRevision, status: 'completed', conclusion: 'success' };
    const fields = { 'executionIdentity.scopeRef': 'repository.id', sourceRevision: 'head_sha',
      'executionIdentity.definitionRef': 'workflow_id', attemptRef: 'run_attempt' };
    const converted = field === 'executionIdentity.scopeRef' ? 202 :
      field === 'executionIdentity.definitionRef' || field === 'attemptRef' ? Number(replacement) : replacement;
    assign(body, fields[field], converted);
    const acquired = await f.acquire('GET', requestPath, body);
    assert.equal(acquired.status, 200);
    const actual = fields[field].split('.').reduce((node, key) => node[key], acquired.body);
    assign(projected, field, field === 'executionIdentity.scopeRef' ? `repository:${actual}` :
      ['executionIdentity.definitionRef', 'attemptRef'].includes(field) ? String(actual) : actual);
  }
  // Other values are closed existing verifier output fields, not REST fields.
  // The host retains the genuine native acquisition privately; this adverse
  // reference exercises a single contradictory projection against the same
  // real operation and existing consumer (never a JSON trust certificate).
  return f.variant(acquisition, value => { value.observation.result = projected; });
}

test('GH37 independently named existing-consumer boundary axes retain exact claimed history', async t => {
  const f = await bridgeFixture(t);
  const order = ['execution', 'artifact', 'deployment', 'test', 'pull-request', 'git-ref', 'merge', 'policy', 'notification'];
  for (const family of order) {
    const prepared = await f.prepare(family);
    const acquisition = await f.result(prepared);
    // Validate the exact positive through the REAL current bridge before any
    // negative, but reserve terminal admission until all rejected axes finish.
    const positive = await f.store.verifyOperationResult({
      operation: prepared.claim.operation, observedResult: acquisition,
    });
    assert.equal(positive.observation.status, 'succeeded');
    for (const [axis, field, replacement, reason] of resultBoundaryCases[family]) {
      await t.test(`T-GH-37-${family}-wrong-${axis}`, async () => {
        const variant = await observedAxis(f, prepared, acquisition, field, replacement);
        const before = await durableBytes(f);
        const calls = f.calls.length;
        await assert.rejects(f.record(prepared, variant), error => {
          assert.equal(error.code, 'EVIDENCE');
          assert.ok(error.message.includes(reason), error.message);
          return true;
        });
        assert.deepEqual(await durableBytes(f), before);
        assert.equal(f.calls.length, calls, 'Rejected evidence must not redispatch or acquire new authority');
      });
    }
    if (family === 'deployment') await t.test('T-GH-36-ADO19-artifact', async () => {
      const wrong = f.variant(acquisition, value => { value.observation.result.artifactId = 'foreign-artifact-902'; });
      const before = await durableBytes(f);
      await assert.rejects(f.record(prepared, wrong), { code: 'EVIDENCE' });
      assert.deepEqual(await durableBytes(f), before);
    });
    if (family === 'pull-request') await t.test('T-GH-36-ADO20-state', async () => {
      const wrong = f.variant(acquisition, value => { value.observation.result.state = 'closed'; });
      const before = await durableBytes(f);
      await assert.rejects(f.record(prepared, wrong), { code: 'EVIDENCE' });
      assert.deepEqual(await durableBytes(f), before);
    });
    await t.test(`T-GH-37-${family}-wrong-cause`, async () => {
      const before = await durableBytes(f);
      const wrong = f.variant(acquisition, value => { value.observation.causalProof.hostCallId = 'foreign-exact-call'; });
      await assert.rejects(f.record(prepared, wrong), error => {
        assert.equal(error.code, 'EVIDENCE');
        assert.match(error.message, /missing-dispatch-to-result-proof/u);
        return true;
      });
      assert.deepEqual(await durableBytes(f), before);
    });
    const completed = await f.record(prepared, acquisition);
    assert.equal(completed.status, 'succeeded');
    if (family === 'execution') await f.selectArtifact(completed);
    if (family === 'deployment') f.deployment = completed;
    if (family === 'test') {
      const evidence = (await f.store.records(f.workItemId)).find(value => value.type === 'test-evidence' &&
        value.operationId === completed.id);
      assert.equal(evidence.status, 'Passed');
    }
    if (family === 'execution') {
      const artifact = await f.artifact(completed);
      for (const [id, mutate] of [
        ['T-GH-36-ADO18-attempt', value => { value.attemptRef = '1'; }],
        ['T-GH-36-ADO18-bytes', value => { value.artifactSha256 = 'f'.repeat(64); }],
      ]) await t.test(id, async () => {
        const before = await durableBytes(f);
        const input = f.artifactVariant(artifact, mutate);
        await assert.rejects(recordArtifact(f.store, input), { code: 'EVIDENCE' });
        assert.deepEqual(await durableBytes(f), before);
      });
    }
  }
});

test('GH36/GH37 PR refresh and exact repository boundary gaps use their actual consumers', async t => {
  const f = await bridgeFixture(t);
  const repositoryInput = { ...f.repositoryInput, observedAt: new Date(f.clock.now()).toISOString() };
  await f.store.observeRepository(repositoryInput);
  const reject = async (callback, code = 'EVIDENCE') => {
    const before = await durableBytes(f);
    await assert.rejects(callback, { code });
    assert.deepEqual(await durableBytes(f), before);
  };
  await t.test('T-GH-36-ADO08-remote-handle', async () => {
    await f.runGit('remote', 'rename', 'origin', 'selected-upstream');
    try {
      const current = await f.store.currentRepositoryObservation(f.workItemId, 'primary', 'selected-upstream');
      assert.equal(current.selectedFetchRemote.selectedRemoteName, 'selected-upstream');
      assert.equal(current.observation.repositoryRef, repositoryRef);
      assert.equal(current.observation.remoteRepositoryURL, remote);
    } finally { await f.runGit('remote', 'rename', 'selected-upstream', 'origin'); }
  });
  await t.test('T-GH-36-ADO10-stale-default', async () => {
    assert.equal((await f.store.currentRepositoryObservation(f.workItemId, 'primary', 'origin')).observation.defaultBranchRef,
      'refs/heads/main');
    await reject(() => f.store.observeRepository({ ...repositoryInput, defaultBranchRef: 'refs/heads/obsolete-default' }));
  });
  await t.test('T-GH-36-ADO10-prefix-search', async () => {
    assert.deepEqual((await f.store.currentRepositoryObservation(f.workItemId, 'primary', 'origin')).observation.verifiedBranch,
      { branchRef: 'refs/heads/feature/fixture', revision: f.revision });
    await reject(() => f.store.observeRepository({ ...repositoryInput,
      verifiedBranch: { branchRef: 'refs/heads/feature/fixture-copy', revision: f.revision } }));
  });
  await t.test('T-GH-36-ADO05-login', async () => {
    registerGitHubAdapter();
    const identity = { provider: 'github', connection: 'bridge-fixture', scopeRef: repositoryRef,
      definitionRef: '301', executionRef: '401', attemptKind: 'known', attemptRef: '2' };
    const native = await f.acquire('GET', `${base}/actions/runs/401/attempts/2`, {
      id: 401, workflow_id: 301, run_attempt: 2, repository: Object.fromEntries(
        Object.entries(f.repositoryBody).filter(([name]) => name !== 'url')),
      html_url: 'https://github.com/bridge-owner/bridge-repo/actions/runs/401',
    });
    const observation = { connection: 'bridge-fixture', run: native.body,
      access: { accessible: true, finalUrl: 'https://github.com/bridge-owner/bridge-repo/actions/runs/401/attempts/2' } };
    const attached = await attachMonitor(f.store, { identity, origin: 'framework',
      workItemId: f.workItemId, schedulerAvailable: true, readAvailable: true });
    assert.equal((await verifyMonitorLink(f.store, { runKey: attached.key, adapterId: 'github',
      observation, evidenceRef: 'fixture:original-accessible-page' })).link.status, 'verified');
    const before = await durableBytes(f);
    const rejected = await verifyProviderLink('github', identity, { ...observation,
      access: { accessible: true, finalUrl: 'https://github.com/login' } });
    assert.equal(rejected.verified, false);
    assert.match(rejected.reason, /final page does not identify/u);
    assert.deepEqual(await durableBytes(f), before);
    assert.equal((await readMonitor(f.store, attached.key)).link.status, 'verified');
  });
  const pr = await f.acquirePr();
  const adopted = (await adoptPr(f.store, { workItemId: f.workItemId, ...pr })).observation;
  f.clock.advance(1);
  const refresh = await f.acquirePr({ sequence: 2, previousObservationKey: adopted.id });
  await t.test('T-GH-37-pull-request-wrong-sequence', async () => {
    const wrong = f.originalPrVariant(refresh, { sequence: 999 });
    await reject(() => adoptPr(f.store, { workItemId: f.workItemId, ...wrong,
      previousObservationKey: adopted.id }));
  });
  await t.test('T-GH-37-pull-request-wrong-version', async () => {
    const wrong = f.originalPrVariant(refresh, { version: 'foreign-original-provider-version' });
    await reject(() => adoptPr(f.store, { workItemId: f.workItemId, ...wrong,
      previousObservationKey: adopted.id }), 'STALE');
  });
  const actual = (await adoptPr(f.store, { workItemId: f.workItemId, ...refresh,
    previousObservationKey: adopted.id })).observation;
  assert.equal(actual.sequence, 2);
  await t.test('T-GH-retained-history exact current PR and rejected delayed acquisition preserve predecessor', async () => {
    assert.equal(actual.previousObservationKey, adopted.id);
    const state = await f.store.load(f.workItemId);
    assert.equal(state.records.find(value => value.id === actual.id).sequence, 2);
    const archived = JSON.parse(await fs.readFile(path.join(
      f.store.workPath(f.workItemId), 'evidence', `${adopted.id}.json`), 'utf8'));
    assert.deepEqual(archived, adopted);
    await reject(() => adoptPr(f.store, { workItemId: f.workItemId, ...pr }), 'STALE');
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(
      f.store.workPath(f.workItemId), 'evidence', `${adopted.id}.json`), 'utf8')), adopted);
    assert.deepEqual((await f.store.load(f.workItemId)).records.find(value => value.id === actual.id), actual);
  });
  await t.test('T-GH-36-ADO22-policy-denied', async () => {
    const merge = await f.prepare('merge');
    assert.equal((await f.record(merge, await f.result(merge))).status, 'succeeded');
    const prepared = await f.prepare('policy', '-revoked-policy', { claim: false });
    const event = (await f.store.records(f.workItemId)).find(value =>
      value.type === 'event' && value.kind === 'permission' && value.effect.grant === 'auto-merge');
    assert.ok(event);
    await grant(f, 'revocation', { revokes: [event.id] });
    await orient(f);
    const calls = f.calls.length;
    await reject(() => f.bridge.legacyOperations.claimDispatch(prepared.preparation, f.store), 'GATE');
    assert.equal(f.calls.length, calls);
  });
});

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
