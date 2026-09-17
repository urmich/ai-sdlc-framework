import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fixture, artifact, completeReview, grant, coding } from './helpers.mjs';
import { registerArtifact } from '../src/artifacts.mjs';
import { captureReceipt, prepareDecision, applyDecision } from '../src/decisions.mjs';
import { resume } from '../src/recovery.mjs';
import { formatAudit, recordAudit, replayAudit, parseEvents } from '../src/audit.mjs';
import { check } from '../src/checks.mjs';
import { pruneWork } from '../src/operations.mjs';
import { recordTest, startCycle } from '../src/validation.mjs';
import { activeEvents, currentCycle, phaseAuthority, reviewPassed } from '../src/authority.mjs';
import { digest } from '../src/core.mjs';
import { writeJson } from '../src/files.mjs';

test('T-17 receipt-bound approval is idempotent, rejects fabricated evidence and survives checkpoint loss', async t => {
  const f = await fixture(t);
  const relative = await artifact(f, 'requirements', '# Requirements\n### FR-001 - Outcome\n**Definition of Done**\n- AC-001.1: Done.\n');
  await registerArtifact(f.store, { workItemId: f.workItemId, role: 'requirements', repositoryId: 'primary', path: relative });
  const pending = await prepareDecision(f.store, { workItemId: f.workItemId, sessionId: f.sessionId, kind: 'approval', effect: { transition: { from: 'requirements', to: 'test-design' } } });
  const receipt = await captureReceipt(f.store, { sessionId: f.sessionId, source: 'userPromptSubmitted', input: 'Approved; proceed to Test Design.' });
  const request = { workItemId: f.workItemId, sessionId: f.sessionId, decisionId: pending.id, receiptId: receipt.id, input: 'Approved; proceed to Test Design.' };
  await assert.rejects(applyDecision(f.store, { ...request, input: 'fabricated' }), { code: 'PROVENANCE' });
  await assert.rejects(applyDecision(f.store, { ...request, evidence: 'approved' }), { code: 'INPUT' });
  const first = await applyDecision(f.store, request);
  assert.equal((await applyDecision(f.store, request)).idempotent, true);
  await assert.rejects(applyDecision(f.store, { ...request, kind: 'override', effect: { rules: ['phase'], reason: 'different' } }), { code: 'ID_CONFLICT' });
  await fs.unlink(path.join(f.store.workPath(f.workItemId), 'checkpoint.json'));
  const recovered = await resume(f.store, { cwd: f.repo, sessionId: f.sessionId, workItemId: f.workItemId });
  assert.equal(recovered.phase, 'test-design');
  assert.ok((await f.store.records(f.workItemId)).some(r => r.id === first.event.id));
});
test('T-17 event-first persistence recovers after failure before checkpoint projection', async t => {
  const f = await fixture(t);
  const receipt = await captureReceipt(f.store, { sessionId: f.sessionId, source: 'userPromptSubmitted', input: 'Override only the phase guard for this work.' });
  const request = { workItemId: f.workItemId, sessionId: f.sessionId, receiptId: receipt.id, input: 'Override only the phase guard for this work.',
    kind: 'override', effect: { rules: ['phase'], reason: 'User knowingly skips phase sequence', transition: { from: 'requirements', to: 'coding' } } };
  f.store.fault = async stage => { if (stage === 'record:event') throw new Error('event persisted, checkpoint interrupted'); };
  await assert.rejects(applyDecision(f.store, request), /checkpoint interrupted/);
  f.store.fault = async () => {};
  assert.equal((await applyDecision(f.store, request)).idempotent, true);
  assert.equal((await f.store.load(f.workItemId)).checkpoint.phase, 'coding');
  assert.ok(!(await f.store.records(f.workItemId)).some(record => record.type === 'pending-decision'));
});
test('T-17 approval snapshots reject edits and wrong-session inputs', async t => {
  const f = await fixture(t);
  const relative = await artifact(f, 'requirements', 'approved snapshot');
  await registerArtifact(f.store, { workItemId: f.workItemId, role: 'requirements', repositoryId: 'primary', path: relative });
  const pending = await prepareDecision(f.store, { workItemId: f.workItemId, sessionId: f.sessionId, kind: 'approval', effect: { transition: { from: 'requirements', to: 'test-design' } } });
  const receipt = await captureReceipt(f.store, { sessionId: f.sessionId, source: 'userPromptSubmitted', input: 'Approve original' });
  await fs.writeFile(path.join(f.repo, relative), 'changed snapshot');
  await assert.rejects(applyDecision(f.store, { workItemId: f.workItemId, sessionId: f.sessionId, decisionId: pending.id, receiptId: receipt.id, input: 'Approve original' }), { code: 'STALE' });
  await assert.rejects(captureReceipt(f.store, { sessionId: f.sessionId, source: 'document', input: 'Approved' }), { code: 'PROVENANCE' });
});
test('T-30 failed resume with a valid checkpoint keeps all decisions blocked', async t => {
  const f = await fixture(t);
  f.store.fault = async stage => {
    if (stage === 'recovery-validation') throw new Error('valid-checkpoint recovery failed');
  };
  await assert.rejects(resume(f.store, { cwd: f.repo, sessionId: f.sessionId,
    workItemId: f.workItemId }), /valid-checkpoint recovery failed/);
  f.store.fault = async () => {};
  await assert.rejects(prepareDecision(f.store, { workItemId: f.workItemId,
    sessionId: f.sessionId, kind: 'scope-inclusion', effect: { itemId: 'blocked-during-recovery' } }),
  { code: 'RECOVERY' });
  await resume(f.store, { cwd: f.repo, sessionId: f.sessionId, workItemId: f.workItemId });
  const prepared = await prepareDecision(f.store, { workItemId: f.workItemId,
    sessionId: f.sessionId, kind: 'scope-inclusion', effect: { itemId: 'allowed-after-recovery' } });
  assert.equal(prepared.kind, 'scope-inclusion');
});
test('T-18 pruning a missing checkpoint preserves the recovery barrier', async t => {
  const f = await fixture(t);
  await fs.unlink(path.join(f.store.workPath(f.workItemId), 'checkpoint.json'));
  await pruneWork(f.store, f.workItemId);
  assert.equal((await f.store.load(f.workItemId)).recoveryRequired, true);
  await assert.rejects(prepareDecision(f.store, { workItemId: f.workItemId,
    sessionId: f.sessionId, kind: 'scope-inclusion', effect: { itemId: 'blocked-after-prune' } }),
  { code: 'RECOVERY' });
  await resume(f.store, { cwd: f.repo, sessionId: f.sessionId, workItemId: f.workItemId });
  assert.equal((await f.store.load(f.workItemId)).recoveryRequired, false);
});
test('T-15 legacy push authority remains readable but cannot authorize a new push', async t => {
  const f = await fixture(t);
  const input = 'User authorizes a legacy broad push grant.';
  const receipt = await captureReceipt(f.store, { sessionId: f.sessionId,
    source: 'userPromptSubmitted', input });
  const legacy = { type: 'event', schemaVersion: 1,
    id: `decision-${digest({ receiptId: receipt.id, workItemId: f.workItemId,
      kind: 'permission', scope: {}, itemId: null }).slice(0, 40)}`,
    workItemId: f.workItemId, sequence: 1, kind: 'permission', effect: { grant: 'push' },
    sourceReceiptId: receipt.id, sourceReceiptDigest: digest(receipt), inputDigest: receipt.inputDigest,
    sessionId: f.sessionId, repositoryIds: ['primary'], snapshots: [], occurredAt: receipt.capturedAt };
  const { digest: ignored, ...content } = legacy;
  legacy.digest = digest(content);
  await writeJson(f.store.recordPath(f.workItemId, legacy.id), legacy);
  assert.ok((await f.store.records(f.workItemId)).some(record => record.id === legacy.id));
  assert.equal((await import('../src/policy.mjs')).evaluatePolicy(await f.store.load(f.workItemId), {
    class: 'push', repositoryId: 'primary', target: 'origin',
    remoteUrlDigest: digest(['https://example.invalid/repository.git']),
    sourceRef: 'refs/heads/feature/fixture', targetRef: 'refs/heads/feature/fixture',
    force: false, delete: false,
  }, { clock: f.clock }).allowed, false);
  await fs.rm(f.store.recordPath(f.workItemId, legacy.id));
  await writeJson(path.join(f.store.workPath(f.workItemId), 'evidence', `${legacy.id}.json`), legacy);
  const retried = await applyDecision(f.store, { workItemId: f.workItemId, sessionId: f.sessionId,
    receiptId: receipt.id, input,
    kind: 'permission', effect: { grant: 'push' } });
  assert.equal(retried.idempotent, true);
});
test('T-15 selective replay restores missing revocation for retained local authority', async t => {
  const f = await fixture(t);
  const permission = await grant(f, 'permission', { grant: 'merge' });
  const revocation = await grant(f, 'revocation', { revokes: [permission.event.id],
    lifetime: { kind: 'until', expiresAt: new Date(f.clock.now() + 500).toISOString() } });
  const audit = await formatAudit(f.store, f.workItemId);
  await f.runGit('add', '.sdlc');
  await f.runGit('commit', '-qm', `Audit retained authority revocation\n\n${audit.trailers}`);
  await recordAudit(f.store, { workItemId: f.workItemId, repositoryId: 'primary',
    commit: await f.runGit('rev-parse', 'HEAD') });
  f.clock.advance(501);
  await fs.rm(f.store.recordPath(f.workItemId, revocation.event.id));
  await resume(f.store, { cwd: f.repo, sessionId: f.sessionId, workItemId: f.workItemId });
  assert.ok((await f.store.records(f.workItemId)).some(record => record.id === revocation.event.id));
  assert.ok(!activeEvents(await f.store.records(f.workItemId), { clock: f.clock }).some(event =>
    event.id === permission.event.id));
});
test('T-15 complete same-commit audit trailers replay lifetime and revocation, without rewriting history', async t => {
  const f = await fixture(t);
  const first = await grant(f, 'override', { rules: ['phase'], reason: 'Scoped user exception', scope: { repositoryIds: ['primary'], actions: ['code'] }, lifetime: { kind: 'work-item' } });
  await grant(f, 'revocation', { revokes: [first.event.id] });
  const formatted = await formatAudit(f.store, f.workItemId);
  await f.runGit('add', '.sdlc');
  await f.runGit('commit', '-qm', `Record scoped exception and revocation\n\nPreserve user authority separately from document status.\n\n${formatted.trailers}`);
  const commit = await f.runGit('rev-parse', 'HEAD');
  assert.equal((await recordAudit(f.store, { workItemId: f.workItemId, repositoryId: 'primary', commit })).verified.length, 2);
  const replay = await replayAudit(f.store, f.workItemId);
  assert.equal(replay.events[0].effect.lifetime.kind, 'work-item');
  assert.deepEqual(replay.events[1].effect.revokes, [first.event.id]);
  assert.throws(() => parseEvents(formatted.trailers.replace(/^SDLC-Applied:.*$/mu, ''), f.workItemId), { code: 'AUDIT' });
  assert.equal((await check(f.store, f.workItemId, 'history')).exitCode, 0);
  await pruneWork(f.store, f.workItemId);
  assert.ok(!(await f.store.records(f.workItemId)).some(record => record.id === first.event.id));
  assert.ok(await fs.stat(path.join(f.store.workPath(f.workItemId), 'evidence', `${first.event.id}.json`)));
});
test('T-15 cross-repository audit copies deduplicate without losing complete scoped authority', async t => {
  const f = await fixture(t);
  const secondary = await fixture(t, { initialize: false });
  await f.store.bindMember({ workItemId: f.workItemId, repositoryId: 'secondary', cwd: secondary.repo, sessionId: 'secondary-session' });
  await grant(f, 'override', { rules: ['phase'], reason: 'Explicit multi-repository exception',
    scope: { repositoryIds: ['primary', 'secondary'] }, lifetime: { kind: 'work-item' } });
  const { trailers } = await formatAudit(f.store, f.workItemId);
  await f.runGit('add', '.sdlc');
  await f.runGit('commit', '-qm', `Preserve coordinator identity\n\n${trailers}`);
  await secondary.runGit('commit', '--allow-empty', '-qm', `Record the same scoped member authorization\n\n${trailers}`);
  const replay = await replayAudit(f.store, f.workItemId);
  assert.equal(replay.events.length, 1);
  assert.equal(replay.locations.length, 2);
  assert.deepEqual(replay.events[0].repositoryIds, ['primary', 'secondary']);
});
test('T-15/T-18 pruning preserves current revoked Review and monotonic event sequences', async t => {
  const f = await coding(await fixture(t));
  const cycle = (await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: 'v1', cause: 'review pruning' })).cycle;
  for (const testId of ['T-unit', 'T-integration']) await recordTest(f.store, {
    workItemId: f.workItemId, cycleId: cycle.id, testId, status: 'Passed',
    expectedMet: true, evidenceRef: `fixture:${testId}`, owner: 'agent', host: 'local',
  });
  await completeReview(f, cycle);
  const latest = await completeReview(f, cycle);
  const codingApproval = (await f.store.records(f.workItemId)).filter(record =>
    record.type === 'event' && record.effect.transition?.to === 'coding').at(-1);
  await grant(f, 'revocation', { revokes: [latest.event.id], lifetime: { kind: 'until',
    expiresAt: new Date(f.clock.now() + 500).toISOString() } });
  await grant(f, 'revocation', { revokes: [codingApproval.id], lifetime: { kind: 'until',
    expiresAt: new Date(f.clock.now() + 500).toISOString() } });
  const audit = await formatAudit(f.store, f.workItemId);
  await f.runGit('add', '.sdlc');
  await f.runGit('commit', '-qm', `Audit current Review state\n\n${audit.trailers}`);
  await recordAudit(f.store, { workItemId: f.workItemId, repositoryId: 'primary',
    commit: await f.runGit('rev-parse', 'HEAD') });
  f.clock.advance(501);
  await pruneWork(f.store, f.workItemId);
  let state = await f.store.load(f.workItemId);
  const current = currentCycle(state.records, state.checkpoint);
  assert.equal(current.reviewRef, latest.event.id);
  assert.ok(state.records.some(record => record.id === latest.event.id));
  assert.equal(reviewPassed(current, state.records, f.clock), false);
  assert.equal(phaseAuthority(state.records, state.checkpoint, null, { clock: f.clock }).active, false);

  const expiring = await grant(f, 'permission', { grant: 'artifact-location',
    target: '/tmp/expired-artifact', lifetime: { kind: 'until',
      expiresAt: new Date(f.clock.now() + 1000).toISOString() } });
  const expiringAudit = await formatAudit(f.store, f.workItemId, [expiring.event.id]);
  await f.runGit('commit', '--allow-empty', '-qm', `Audit expiring authority\n\n${expiringAudit.trailers}`);
  await recordAudit(f.store, { workItemId: f.workItemId, repositoryId: 'primary',
    commit: await f.runGit('rev-parse', 'HEAD') });
  f.clock.advance(1001);
  await pruneWork(f.store, f.workItemId);
  assert.equal((await applyDecision(f.store, expiring.request)).idempotent, true);
  await fs.unlink(path.join(f.store.workPath(f.workItemId), 'checkpoint.json'));
  await assert.rejects(grant(f, 'scope-inclusion', { itemId: 'before-recovery' }), { code: 'RECOVERY' });
  await assert.rejects(f.store.init({ workItemId: f.workItemId, repositoryId: 'primary',
    cwd: f.repo, sessionId: f.sessionId }), { code: 'RECOVERY' });
  await assert.rejects(prepareDecision(f.store, { workItemId: f.workItemId,
    sessionId: f.sessionId, kind: 'scope-inclusion', effect: { itemId: 'prepared-before-recovery' } }),
  { code: 'RECOVERY' });
  f.store.fault = async stage => {
    if (stage === 'checkpoint') throw new Error('interrupted recovery projection');
  };
  await assert.rejects(resume(f.store, { cwd: f.repo, sessionId: f.sessionId,
    workItemId: f.workItemId }), /interrupted recovery projection/);
  f.store.fault = async () => {};
  await assert.rejects(prepareDecision(f.store, { workItemId: f.workItemId,
    sessionId: f.sessionId, kind: 'scope-inclusion', effect: { itemId: 'prepared-after-interruption' } }),
  { code: 'RECOVERY' });
  f.store.fault = async stage => {
    if (stage === 'recovery-validation') throw new Error('interrupted combined recovery validation');
  };
  await assert.rejects(resume(f.store, { cwd: f.repo, sessionId: f.sessionId,
    workItemId: f.workItemId }), /interrupted combined recovery validation/);
  f.store.fault = async () => {};
  await assert.rejects(prepareDecision(f.store, { workItemId: f.workItemId,
    sessionId: f.sessionId, kind: 'scope-inclusion', effect: { itemId: 'prepared-after-validation-failure' } }),
  { code: 'RECOVERY' });
  await resume(f.store, { cwd: f.repo, sessionId: f.sessionId, workItemId: f.workItemId });
  const next = await grant(f, 'scope-inclusion', { itemId: 'later-item' });
  assert.ok(next.event.sequence > expiring.event.sequence);
  const nextAudit = await formatAudit(f.store, f.workItemId, [next.event.id]);
  await f.runGit('commit', '--allow-empty', '-qm', `Audit later authority\n\n${nextAudit.trailers}`);
  await recordAudit(f.store, { workItemId: f.workItemId, repositoryId: 'primary',
    commit: await f.runGit('rev-parse', 'HEAD') });
  assert.equal((await replayAudit(f.store, f.workItemId)).gaps.length, 0);
  state = await f.store.load(f.workItemId);
  assert.ok(!state.records.some(record => record.id === expiring.event.id));
  assert.ok(state.checkpoint.policyGeneration >= next.event.sequence);
});
test('T-18 pruning preserves unresolved Review findings for the unchanged cycle', async t => {
  const f = await coding(await fixture(t));
  const cycle = (await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: 'v1', cause: 'unresolved review findings' })).cycle;
  for (const testId of ['T-unit', 'T-integration']) await recordTest(f.store, {
    workItemId: f.workItemId, cycleId: cycle.id, testId, status: 'Passed',
    expectedMet: true, evidenceRef: `fixture:${testId}`, owner: 'agent', host: 'local',
  });
  const binding = { cycleId: cycle.id, candidateDigest: cycle.candidateDigest,
    testSpecDigest: cycle.testSpecDigest, configDigest: cycle.configDigest };
  await grant(f, 'review-result', { ...binding, status: 'ChangesRequired',
    evidenceRef: 'copilot-cli:/review:findings', summary: 'Blocking issue',
    blockingFindings: ['Fix the issue'], lifetime: { kind: 'until',
      expiresAt: new Date(f.clock.now() + 500).toISOString() } });
  const blocked = await grant(f, 'review-result', { ...binding, status: 'Blocked',
    evidenceRef: 'copilot-cli:/review:blocked', summary: 'Review temporarily blocked',
    blockingFindings: [] });
  const audit = await formatAudit(f.store, f.workItemId);
  await f.runGit('add', '.sdlc');
  await f.runGit('commit', '-qm', `Audit unresolved review findings\n\n${audit.trailers}`);
  await recordAudit(f.store, { workItemId: f.workItemId, repositoryId: 'primary',
    commit: await f.runGit('rev-parse', 'HEAD') });
  f.clock.advance(501);
  await pruneWork(f.store, f.workItemId);
  await fs.rm(f.store.recordPath(f.workItemId, blocked.event.id));
  await resume(f.store, { cwd: f.repo, sessionId: f.sessionId, workItemId: f.workItemId });
  const recovered = await f.store.load(f.workItemId);
  assert.equal(currentCycle(recovered.records, recovered.checkpoint).reviewRef, blocked.event.id);
  assert.equal(reviewPassed(currentCycle(recovered.records, recovered.checkpoint),
    recovered.records, f.clock), false);
  await assert.rejects(grant(f, 'review-result', { ...binding, status: 'Passed',
    evidenceRef: 'copilot-cli:/review:clean', summary: 'No blocking findings',
    blockingFindings: [], completedStage: 'review' }), { code: 'EVIDENCE' });
});
test('T-16 interrupted pruning deletes revoked authority before its revocation tombstone', async t => {
  const f = await fixture(t);
  const permission = await grant(f, 'permission', { grant: 'artifact-location',
    target: '/tmp/retired', lifetime: { kind: 'until',
      expiresAt: new Date(f.clock.now() + 500).toISOString() } });
  await grant(f, 'revocation', { revokes: [permission.event.id], lifetime: { kind: 'until',
    expiresAt: new Date(f.clock.now() + 500).toISOString() } });
  const audit = await formatAudit(f.store, f.workItemId);
  await f.runGit('add', '.sdlc');
  await f.runGit('commit', '-qm', `Audit retired authority\n\n${audit.trailers}`);
  await recordAudit(f.store, { workItemId: f.workItemId, repositoryId: 'primary',
    commit: await f.runGit('rev-parse', 'HEAD') });
  f.clock.advance(501);
  f.store.fault = async stage => {
    if (stage === 'remove:event:permission') throw new Error('interrupt pruning after target removal');
  };
  await assert.rejects(pruneWork(f.store, f.workItemId), /interrupt pruning/);
  f.store.fault = async () => {};
  const records = await f.store.records(f.workItemId);
  assert.ok(!records.some(record => record.id === permission.event.id));
  assert.ok(records.some(record => record.kind === 'revocation'));
  assert.ok(!activeEvents(records, { clock: f.clock }).some(event =>
    event.kind === 'permission' && event.effect.target === '/tmp/retired'));
  f.store.fault = async stage => {
    if (stage === 'remove:audit-reference:') throw new Error('interrupt after revocation audit-reference deletion');
  };
  await assert.rejects(pruneWork(f.store, f.workItemId), /revocation audit-reference deletion/);
  f.store.fault = async () => {};
  assert.ok(!(await f.store.records(f.workItemId)).some(record => record.kind === 'revocation'));
});
test('T-16 pruning deletes an audited event before its audit reference', async t => {
  const f = await fixture(t);
  const permission = await grant(f, 'permission', { grant: 'artifact-location',
    target: '/tmp/audit-order', lifetime: { kind: 'until',
      expiresAt: new Date(f.clock.now() + 500).toISOString() } });
  const audit = await formatAudit(f.store, f.workItemId);
  await f.runGit('add', '.sdlc');
  await f.runGit('commit', '-qm', `Audit deletion ordering\n\n${audit.trailers}`);
  await recordAudit(f.store, { workItemId: f.workItemId, repositoryId: 'primary',
    commit: await f.runGit('rev-parse', 'HEAD') });
  f.clock.advance(501);
  f.store.fault = async stage => {
    if (stage === 'remove:audit-reference:') throw new Error('interrupt after audit-reference deletion');
  };
  await assert.rejects(pruneWork(f.store, f.workItemId), /audit-reference deletion/);
  f.store.fault = async () => {};
  assert.ok(!(await f.store.records(f.workItemId)).some(record => record.id === permission.event.id));
  await pruneWork(f.store, f.workItemId);
  assert.ok(!(await f.store.records(f.workItemId)).some(record =>
    record.type === 'audit-reference' && record.eventId === permission.event.id));
});
test('T-18 audited candidate-bound decisions retire with their superseded cycle', async t => {
  const f = await coding(await fixture(t));
  const firstCycle = (await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: 'v1', cause: 'first cycle' })).cycle;
  for (const testId of ['T-unit', 'T-integration']) await recordTest(f.store, {
    workItemId: f.workItemId, cycleId: firstCycle.id, testId, status: 'Passed',
    expectedMet: true, evidenceRef: `fixture:${testId}`, owner: 'agent', host: 'local',
  });
  const review = await completeReview(f, firstCycle);
  const audit = await formatAudit(f.store, f.workItemId);
  await f.runGit('add', '.sdlc');
  await f.runGit('commit', '-qm', `Audit first validation cycle\n\n${audit.trailers}`);
  await recordAudit(f.store, { workItemId: f.workItemId, repositoryId: 'primary',
    commit: await f.runGit('rev-parse', 'HEAD') });
  await fs.writeFile(path.join(f.repo, 'next-cycle.mjs'), 'export const next = true;\n');
  await startCycle(f.store, { workItemId: f.workItemId, configDigest: 'v1', cause: 'new candidate' });
  await pruneWork(f.store, f.workItemId);
  assert.ok(!(await f.store.records(f.workItemId)).some(record => record.id === review.event.id));
  await replayAudit(f.store, f.workItemId);
  assert.ok(!(await f.store.records(f.workItemId)).some(record => record.id === review.event.id));
});
