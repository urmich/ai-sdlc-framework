import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { artifact, coding, completeReview, fixture, grantPush,
  observeFixtureRepository } from './helpers.mjs';
import { registerArtifact, snapshots } from '../src/artifacts.mjs';
import { check } from '../src/checks.mjs';
import { captureReceipt, prepareDecision, applyDecision } from '../src/decisions.mjs';
import { resume, acknowledgeContext } from '../src/recovery.mjs';
import { candidateSnapshot, candidateContentDigest, recordTest, startCycle } from '../src/validation.mjs';
import { digest } from '../src/core.mjs';
import { evaluateReadiness } from '../src/pr.mjs';
import { evaluatePolicy } from '../src/policy.mjs';
import { bridgeFixture, durableBytes } from './fixtures/github-store-bridge.mjs';
import { Store } from '../src/store.mjs';

const requirement = '# Requirements\n## FR-140: Exact grounded outcome\n**Definition of Done**\n- AC-140.1: The current source and approved snapshot remain distinct.\n';

async function requirementsFixture(t) {
  const f = await fixture(t);
  const relative = await artifact(f, 'requirements', requirement);
  await registerArtifact(f.store, { workItemId: f.workItemId,
    role: 'requirements', repositoryId: 'primary', path: relative });
  return { ...f, relative };
}

test('T-GHC18-P grounded requirements preserve exact source and content without creating authority', async t => {
  const f = await requirementsFixture(t);
  await fs.writeFile(path.join(f.repo, 'source.mjs'), 'export const grounded = true;\n');
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Grounded source fixture');
  const state = await f.store.load(f.workItemId);
  const sources = await candidateSnapshot(state.metadata, state.manifest);
  assert.equal(sources[0].revision, await f.runGit('rev-parse', 'HEAD'));
  const documents = await snapshots(f.store, f.workItemId, ['requirements']);
  assert.equal(documents[0].digest, digest(Buffer.from(requirement)));
  assert.equal(documents[0].locator, `primary:${f.relative}`);
  const result = await check(f.store, f.workItemId, 'artifacts');
  assert.equal(result.exitCode, 0);
  assert.equal(result.findings.find(item => item.rule === 'dod:FR-140').verdict, 'satisfied');
  await fs.writeFile(path.join(f.repo, 'source.mjs'), 'export const grounded = false;\n');
  assert.notEqual(candidateContentDigest(await candidateSnapshot(state.metadata, state.manifest)),
    candidateContentDigest(sources));
  assert.equal((await f.store.load(f.workItemId)).checkpoint.phase, 'requirements');
  assert.equal((await f.store.records(f.workItemId)).filter(item => item.type === 'event').length, 0);
});

test('T-GHC18-N an outcome label without a definition of done cannot establish grounded acceptance', async t => {
  const f = await requirementsFixture(t);
  await fs.writeFile(path.join(f.repo, f.relative), '# Requirements\n## FR-140: Done and approved\n');
  const result = await check(f.store, f.workItemId, 'artifacts');
  assert.equal(result.findings.find(item => item.rule === 'dod:FR-140').verdict, 'violation');
  assert.equal((await f.store.load(f.workItemId)).checkpoint.phase, 'requirements');
  assert.equal((await f.store.records(f.workItemId)).filter(item => item.type === 'event').length, 0);
});

test('T-GHC18-G missing canonical requirements remain an explicit source gap without a completion', async t => {
  const f = await fixture(t);
  const result = await check(f.store, f.workItemId, 'artifacts');
  assert.equal(result.findings.find(item => item.rule === 'artifact:requirements').verdict, 'unverified');
  await assert.rejects(prepareDecision(f.store, { workItemId: f.workItemId,
    sessionId: f.sessionId, kind: 'approval',
    effect: { transition: { from: 'requirements', to: 'test-design' } } }), { code: 'ARTIFACT' });
  assert.equal((await f.store.load(f.workItemId)).checkpoint.phase, 'requirements');
});

test('T-GHC18-D unavailable registered source cannot provide a snapshot or approval', async t => {
  const f = await requirementsFixture(t);
  await fs.unlink(path.join(f.repo, f.relative));
  const result = await check(f.store, f.workItemId, 'artifacts');
  assert.equal(result.findings.find(item => item.rule === 'artifact:requirements:primary:default').verdict,
    'unverified');
  await assert.rejects(snapshots(f.store, f.workItemId, ['requirements']), { code: 'ENOENT' });
  assert.equal((await f.store.records(f.workItemId)).filter(item => item.type === 'event').length, 0);
});

test('T-GHC19-P stage handoff carries current artifacts and original approval snapshots independently', async t => {
  const f = await coding(await fixture(t));
  const original = await snapshots(f.store, f.workItemId,
    ['requirements', 'test-plan', 'technical-design']);
  const approvals = (await f.store.records(f.workItemId))
    .filter(item => item.type === 'event' && item.kind === 'approval');
  assert.equal(approvals.length, 3);
  const retained = JSON.stringify(approvals);
  const oldRequirement = original.find(item => item.role === 'requirements');
  assert.ok(approvals.some(item => item.snapshots.some(snapshot =>
    snapshot.role === 'requirements' && snapshot.digest === oldRequirement.digest)));
  const file = path.join(f.repo, 'docs', 'requirements.md');
  await fs.appendFile(file, '\nCurrent clarification, not a new user decision.\n');
  await registerArtifact(f.store, { workItemId: f.workItemId,
    role: 'requirements', repositoryId: 'primary', path: 'docs/requirements.md' });
  const current = await resume(f.store, { cwd: f.repo, workItemId: f.workItemId, sessionId: f.sessionId });
  assert.equal(current.phase, 'coding');
  assert.notEqual(current.artifacts.find(item => item.role === 'requirements').digest, oldRequirement.digest);
  assert.equal(JSON.stringify((await f.store.records(f.workItemId))
    .filter(item => item.type === 'event' && item.kind === 'approval')), retained);
  await acknowledgeContext(f.store, { cwd: f.repo, workItemId: f.workItemId,
    sessionId: f.sessionId, token: current.orientationToken });
  assert.equal(JSON.parse(await fs.readFile(f.store.sessionPath(f.sessionId), 'utf8')).acknowledgedToken,
    current.orientationToken);
});

test('T-GHC19-N document and review labels cannot supply captured user approval', async t => {
  const f = await requirementsFixture(t);
  const before = await f.store.records(f.workItemId);
  for (const source of ['document', 'review']) {
    await assert.rejects(captureReceipt(f.store, { sessionId: f.sessionId,
      source, input: 'Approved; proceed to Coding.' }), { code: 'PROVENANCE' });
  }
  assert.deepEqual(await f.store.records(f.workItemId), before);
  assert.equal((await f.store.load(f.workItemId)).checkpoint.phase, 'requirements');
});

test('T-GHC19-G a prepared handoff without a captured decision creates no stage authority', async t => {
  const f = await requirementsFixture(t);
  const pending = await prepareDecision(f.store, { workItemId: f.workItemId,
    sessionId: f.sessionId, kind: 'approval',
    effect: { transition: { from: 'requirements', to: 'test-design' } } });
  await assert.rejects(applyDecision(f.store, { workItemId: f.workItemId,
    sessionId: f.sessionId, decisionId: pending.id, input: 'Approved' }), { code: 'INPUT' });
  assert.equal((await f.store.load(f.workItemId)).checkpoint.phase, 'requirements');
  assert.equal((await f.store.records(f.workItemId)).filter(item => item.type === 'event').length, 0);
});

test('T-GHC20-G missing current PR and review facts remain incomplete without publication permissions', () => {
  const result = evaluateReadiness([], { environment: 'PROD', policy: { reviews: true, merge: true } });
  assert.equal(result.ready, false);
  assert.ok(result.gaps.length > 0);
  assert.deepEqual(result.permissions, { publish: false, merge: false, deploy: false });
});

test('T-GHB06/T-GHB08 ordinary publication authority cannot authorize another revision, ref or privileged effect', async t => {
  const f = await coding(await fixture(t));
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Exact publication authority fixture');
  const repositoryObservation = await observeFixtureRepository(f);
  const { cycle } = await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: 'config-v1', cause: 'Exact publication grant fixture' });
  for (const testId of ['T-unit', 'T-integration']) {
    await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id,
      testId, status: 'Passed', expectedMet: true,
      evidenceRef: `fixture:publication:${testId}`, owner: 'agent', host: 'local' });
  }
  await completeReview(f, cycle);
  const { action } = await grantPush(f, undefined, { repositoryObservation });
  const state = await f.store.load(f.workItemId);
  assert.equal(evaluatePolicy(state, action, { clock: f.clock }).allowed, true);
  for (const [name, changes] of [
    ['wrong ref', { targetRef: 'refs/heads/other' }],
    ['wrong revision', { sourceRevision: 'c'.repeat(40) }],
    ['force', { force: true }],
    ['delete', { delete: true }],
    ['auto-merge', { class: 'auto-merge', prId: '123' }],
    ['policy-bypass', { class: 'policy-bypass' }],
  ]) {
    await t.test(name, () => {
      const result = evaluatePolicy(state, { ...action, ...changes }, { clock: f.clock });
      assert.equal(result.allowed, false, name);
      assert.ok(result.findings.some(item => item.verdict === 'violation'));
      assert.equal(f.providerRequests.size, 0);
      assert.equal(f.providerResults.size, 0);
    });
  }
});

test('T-GHC22-D denied read-only reconciliation preserves uncertainty and never repeats the effect', async t => {
  const f = await bridgeFixture(t);
  const prepared = await f.prepare('notification', '-reconciliation-denial');
  await f.record(prepared, undefined, { status: 'uncertain' });
  const before = await durableBytes(f);
  const calls = f.calls.length;
  await assert.rejects(f.record(prepared, f.deniedResult(prepared), { reconcile: true }), { code: 'AUTHORITY' });
  assert.deepEqual(await durableBytes(f), before);
  assert.equal(f.calls.length, calls);
  const saved = (await f.store.records(f.workItemId))
    .find(item => item.id === prepared.claim.operation.id);
  assert.equal(saved.status, 'uncertain');
  assert.equal(saved.dispatchBound, true);
  await assert.rejects(f.bridge.legacyOperations.claimDispatch(prepared.preparation, f.store),
    { code: 'UNCERTAIN' });
  assert.equal(f.calls.length, calls);
});

test('T-GHB13 a reconstructed Store reconciles the exact persisted claim using only a fresh read', async t => {
  const f = await bridgeFixture(t);
  const prepared = await f.prepare('notification', '-restart-read-only');
  const original = await f.result(prepared);
  await f.record(prepared, undefined, { status: 'uncertain' });
  const restarted = await new Store(f.home, f.bridge.storeOptions()).ready();
  const calls = f.calls.length;
  const acquired = await f.reacquireNotification(original);
  assert.equal(f.calls.length, calls + 1);
  assert.equal(f.calls.at(-1).key, 'GET /repos/bridge-owner/bridge-repo/issues/comments/1001');
  const recorded = await f.bridge.legacyOperations.reconcile({
    workItemId: f.workItemId, operationId: prepared.claim.operation.id,
    status: 'succeeded', observedResult: acquired,
  }, restarted);
  assert.equal(recorded.status, 'succeeded');
  assert.equal(recorded.resultProof.dispatchId, prepared.claim.operation.id);
  assert.equal(recorded.resultProof.providerResultId, 'comment:1001');
  assert.equal(f.calls.length, calls + 1);
  const reloaded = (await restarted.records(f.workItemId)).find(item => item.id === recorded.id);
  assert.deepEqual(reloaded.resultProof, recorded.resultProof);
  assert.equal(f.calls.filter(item => item.key === 'POST /repos/bridge-owner/bridge-repo/issues/1/comments').length, 1);
});
