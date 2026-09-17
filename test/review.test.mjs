import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { coding, completeReview, fixture, grant, grantPush, orient, pushAction, pushPermission, syntheticPushAction, testDefinitions } from './helpers.mjs';
import { evaluatePolicy } from '../src/policy.mjs';
import { nextAction, resume } from '../src/recovery.mjs';
import { candidateStamp, recordTest, startCycle } from '../src/validation.mjs';
import { writeJson } from '../src/files.mjs';
import { markDispatching, prepareOperation } from '../src/operations.mjs';
import { evaluateGate as gate } from '../src/gate.mjs';
import { currentCycle, stagePassed } from '../src/authority.mjs';
import { testSpecificationDigest } from '../src/artifacts.mjs';

async function passLocal(f, cycle) {
  for (const testId of ['T-unit', 'T-integration']) {
    await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id, testId,
      status: 'Passed', expectedMet: true, evidenceRef: `fixture:${testId}`,
      owner: 'agent', host: 'local' });
  }
}

test('T-35 canonical tests and candidate-bound /review gate publication and DEV', async t => {
  const f = await coding(await fixture(t));
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Record the approved design baseline');
  const baseRevision = await f.runGit('rev-parse', 'HEAD');
  await fs.writeFile(path.join(f.repo, 'already-in-target.mjs'), 'export const existing = true;\n');
  await f.runGit('add', 'already-in-target.mjs');
  await f.runGit('commit', '-qm', 'Add code already present in the intended target');
  const targetRevision = await f.runGit('rev-parse', 'HEAD');
  await f.runGit('branch', 'trunk', targetRevision);
  await fs.appendFile(path.join(f.repo, 'docs/requirements.md'), '\nClarify the reviewed document.\n');
  await f.runGit('add', 'docs/requirements.md');
  await f.runGit('commit', '-qm', 'Clarify the requirements document');
  const sourceRevision = await f.runGit('rev-parse', 'HEAD');
  const configuration = { defaultBranch: 'refs/heads/main', environments: {
    DEV: { target: 'dev-target', configDigest: 'config-v1', allowedStages: ['DEV'] },
  } };
  await writeJson(path.join(f.repo, '.sdlc/config.json'), configuration);
  await assert.rejects(startCycle(f.store, { workItemId: f.workItemId,
    tests: [testDefinitions()[0]], configDigest: 'config-v1', cause: 'incomplete selection' }), { code: 'ARTIFACT' });
  let cycle = (await startCycle(f.store, { workItemId: f.workItemId, configDigest: 'config-v1', cause: 'canonical plan' })).cycle;
  assert.equal(cycle.tests.length, testDefinitions().length);
  await grant(f, 'pr-publication', { repositoryId: 'primary', sourceRef: 'refs/heads/feature/fixture',
    targetRef: 'refs/heads/trunk', draft: true });
  const earlyDraft = { class: 'pr-create', repositoryId: 'primary', sourceRef: 'refs/heads/feature/fixture',
    targetRef: 'refs/heads/trunk', sourceRevision, targetRevision,
    draft: true, earlyDraft: true, paths: ['docs/requirements.md'] };
  assert.equal(evaluatePolicy(await f.store.load(f.workItemId), earlyDraft, { configuration, clock: f.clock }).allowed, true);
  assert.equal(evaluatePolicy(await f.store.load(f.workItemId), { ...earlyDraft, paths: ['source.mjs'] },
    { configuration, clock: f.clock }).allowed, false);
  await assert.rejects(prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId,
    action: { ...earlyDraft, targetRevision: baseRevision },
    request: { toolName: 'fixture_create_pr', toolArgs: { draft: true, staleTarget: true }, cwd: f.repo },
    correlationKey: 'early-doc-pr-stale-target', intent: 'Attempt document-only classification against the wrong target revision' }),
  { code: 'EVIDENCE' });
  await prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId, action: earlyDraft,
    request: { toolName: 'fixture_create_pr', toolArgs: { draft: true }, cwd: f.repo },
    correlationKey: 'early-doc-pr', intent: 'Publish only the explicitly authorized draft document change' });
  await assert.rejects(grant(f, 'review-result', { cycleId: cycle.id, candidateDigest: cycle.candidateDigest,
    testSpecDigest: cycle.testSpecDigest, configDigest: cycle.configDigest, status: 'Passed',
    evidenceRef: 'copilot-cli:/review:too-early', summary: 'No findings',
    blockingFindings: [], completedStage: 'review' }), { code: 'EVIDENCE' });
  await passLocal(f, cycle);
  const push = syntheticPushAction();
  await grant(f, 'permission', pushPermission(push));
  assert.equal(evaluatePolicy(await f.store.load(f.workItemId), push, { configuration, clock: f.clock }).allowed, false);
  await grant(f, 'review-result', { cycleId: cycle.id, candidateDigest: cycle.candidateDigest,
    testSpecDigest: cycle.testSpecDigest, configDigest: cycle.configDigest,
    status: 'ChangesRequired', evidenceRef: 'copilot-cli:/review:first',
    summary: 'One blocking issue', blockingFindings: ['Incorrect retry state transition'] });
  assert.match(nextAction(await f.store.load(f.workItemId), f.clock), /blocking \/review findings/u);
  await grant(f, 'review-result', { cycleId: cycle.id, candidateDigest: cycle.candidateDigest,
    testSpecDigest: cycle.testSpecDigest, configDigest: cycle.configDigest,
    status: 'Blocked', evidenceRef: 'copilot-cli:/review:blocked',
    summary: 'Review tooling temporarily unavailable', blockingFindings: [] });
  await assert.rejects(grant(f, 'review-result', { cycleId: cycle.id, candidateDigest: cycle.candidateDigest,
    testSpecDigest: cycle.testSpecDigest, configDigest: cycle.configDigest,
    status: 'Passed', evidenceRef: 'copilot-cli:/review:second',
    summary: 'No blocking findings', blockingFindings: [], completedStage: 'review' }), { code: 'EVIDENCE' });
  await fs.writeFile(path.join(f.repo, 'changed-after-review.mjs'), 'export const changed = true;\n');
  cycle = (await startCycle(f.store, { workItemId: f.workItemId, configDigest: 'config-v1', cause: 'post-review fix' })).cycle;
  assert.equal(cycle.reviewRef, null);
  assert.equal(evaluatePolicy(await f.store.load(f.workItemId), push, { configuration, clock: f.clock }).allowed, false);
  await passLocal(f, cycle);
  await completeReview(f, cycle);
  assert.equal(evaluatePolicy(await f.store.load(f.workItemId), push, { configuration, clock: f.clock }).allowed, true);
  await grant(f, 'dev-authorization', { cycleId: cycle.id, candidateDigest: cycle.candidateDigest,
    testSpecDigest: cycle.testSpecDigest, configDigest: cycle.configDigest,
    target: 'dev-target', completedStage: 'review' });
  const build = { class: 'build', repositoryId: 'primary', environment: 'DEV',
    target: 'dev-target', configDigest: 'config-v1', stages: ['DEV'], monitorCapability: true };
  assert.equal(evaluatePolicy(await f.store.load(f.workItemId), build, { configuration, clock: f.clock }).allowed, true);
  const firstBuild = await prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId,
    action: { ...build, artifactId: 'artifact-a' },
    request: { toolName: 'fixture_build', toolArgs: { artifact: 'a' }, cwd: f.repo },
    correlationKey: 'build-a', intent: 'Build the first distinct artifact' });
  const secondBuild = await prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId,
    action: { ...build, artifactId: 'artifact-b' },
    request: { toolName: 'fixture_build', toolArgs: { artifact: 'b' }, cwd: f.repo },
    correlationKey: 'build-b', intent: 'Build the second distinct artifact' });
  assert.notEqual(firstBuild.operation.effectFingerprint, secondBuild.operation.effectFingerprint);
});

test('T-35 Review remains current only while local prerequisites and authority remain active', async t => {
  const f = await coding(await fixture(t));
  const cycle = (await startCycle(f.store, { workItemId: f.workItemId, configDigest: 'v1', cause: 'review eligibility' })).cycle;
  await passLocal(f, cycle);
  const review = await completeReview(f, cycle);
  const push = syntheticPushAction();
  await grant(f, 'permission', pushPermission(push));
  assert.equal(evaluatePolicy(await f.store.load(f.workItemId), push, { clock: f.clock }).allowed, true);
  await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id, testId: 'T-unit',
    status: 'Failed', expectedMet: false, evidenceRef: 'fixture:unit-regression', owner: 'agent', host: 'local' });
  assert.equal(evaluatePolicy(await f.store.load(f.workItemId), push, { clock: f.clock }).allowed, false);
  await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id, testId: 'T-unit',
    status: 'Passed', expectedMet: true, evidenceRef: 'fixture:unit-recovered', owner: 'agent', host: 'local' });
  await grant(f, 'revocation', { revokes: [review.event.id] });
  assert.equal(evaluatePolicy(await f.store.load(f.workItemId), push, { clock: f.clock }).allowed, false);
});

test('T-35 Review waits only for pre-Review checkpoints, not for its own observation', async t => {
  const f = await coding(await fixture(t));
  const plan = path.join(f.repo, 'docs/test-plan.md');
  await fs.writeFile(plan, '# Plan\n' +
    '| ID | Requirements | Conditions | Environment | Level | Checkpoint | Mode | Owner | Location | Expected outcome | Implementation | Status |\n' +
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n' +
    '| T-unit | FR-001 | AC-001.1 | local | unit | pre-review | automated | agent | local | Unit passes | test/unit.mjs | NotRun |\n' +
    '| T-review | FR-001 | AC-001.1 | local | review | review | automated | user | development-machine | Review is completed | GitHub Copilot CLI /review | NotRun |\n' +
    '| T-review-extra | FR-001 | AC-001.1 | local | review | review | automated | agent | local | Extra Review check passes | test/review-extra.mjs | NotRun |\n');
  const cycle = (await startCycle(f.store, { workItemId: f.workItemId, configDigest: 'v1', cause: 'checkpoint ordering' })).cycle;
  await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id, testId: 'T-unit',
    status: 'Passed', expectedMet: true, evidenceRef: 'fixture:unit', owner: 'agent', host: 'local' });
  const state = await f.store.load(f.workItemId);
  assert.equal(stagePassed(currentCycle(state.records, state.checkpoint), state.records, 'local', f.clock), true);
  await completeReview(f, cycle);
  assert.equal((await f.store.load(f.workItemId)).records.some(record =>
    record.type === 'test-evidence' && record.testId === 'T-review'), false);
  assert.match(await fs.readFile(plan, 'utf8'), /T-review.*Passed/u);
  await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id,
    testId: 'T-review-extra', status: 'Failed', expectedMet: false,
    evidenceRef: 'fixture:review-extra-failed', owner: 'agent', host: 'local' });
  assert.match(nextAction(await f.store.load(f.workItemId), f.clock),
    /Diagnose failed required later-checkpoint tests: T-review-extra/u);
});

test('T-20/T-32 push authorization binds actual remote, refs and destructive options', async t => {
  const f = await coding(await fixture(t));
  await f.runGit('remote', 'add', 'approved-origin', 'https://example.invalid/approved.git');
  await f.runGit('remote', 'add', 'unrelated-remote', 'https://example.invalid/unrelated.git');
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Commit candidate before push binding tests');
  const cycle = (await startCycle(f.store, { workItemId: f.workItemId, configDigest: 'v1', cause: 'push binding' })).cycle;
  await passLocal(f, cycle);
  await completeReview(f, cycle);
  const approvedCommand = 'git push --no-follow-tags --no-recurse-submodules approved-origin refs/heads/feature/fixture:refs/heads/feature/fixture';
  const maliciousCommand = 'git push --no-follow-tags --no-recurse-submodules unrelated-remote refs/heads/feature/fixture:refs/heads/main --force';
  const approved = await grantPush(f, approvedCommand);
  const wrongBranch = await pushAction(f, 'git push --no-follow-tags --no-recurse-submodules approved-origin refs/heads/feature/fixture:refs/heads/main');
  assert.equal(evaluatePolicy(await f.store.load(f.workItemId), wrongBranch, { clock: f.clock }).allowed, false);
  const operation = await prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId,
    action: approved.action,
    request: { toolName: 'bash', toolArgs: { command: maliciousCommand }, cwd: f.repo },
    correlationKey: 'mismatched-push', intent: 'Attempt to publish to a different destructive destination' });
  await orient(f);
  await markDispatching(f.store, f.workItemId, operation.operation.id);
  const result = await gate(f.store, { sessionId: f.sessionId, cwd: f.repo,
    toolName: 'bash', toolArgs: { command: maliciousCommand } });
  assert.equal(result.permissionDecision, 'deny');
  assert.match(result.permissionDecisionReason, /Prepared target differs|force-push/u);
  await assert.rejects(prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId,
    action: await pushAction(f, 'git push --no-follow-tags --no-recurse-submodules approved-origin +refs/heads/feature/fixture:refs/heads/main'),
    request: { toolName: 'bash', toolArgs: { command: 'git push --no-follow-tags --no-recurse-submodules approved-origin +refs/heads/feature/fixture:refs/heads/main' }, cwd: f.repo },
    correlationKey: 'force-push', intent: 'Attempt a force push' }), { code: 'GATE' });
  await assert.rejects(pushAction(f, 'git push --no-follow-tags --no-recurse-submodules approved-origin refs/heads/feature/fixture:refs/tags/release'), { code: 'HOOK' });
  await f.runGit('config', 'remote.approved-origin.push',
    'refs/heads/feature/fixture:refs/heads/remapped-by-config');
  await assert.rejects(pushAction(f, 'git push --no-follow-tags --no-recurse-submodules approved-origin refs/heads/feature/fixture'), { code: 'HOOK' });
  await f.runGit('config', 'push.followTags', 'true');
  await assert.rejects(pushAction(f,
    'git push --no-recurse-submodules approved-origin refs/heads/feature/fixture:refs/heads/feature/fixture'), { code: 'HOOK' });
  await f.runGit('config', 'push.recurseSubmodules', 'on-demand');
  await assert.rejects(pushAction(f,
    'git push --no-follow-tags approved-origin refs/heads/feature/fixture:refs/heads/feature/fixture'), { code: 'HOOK' });
  await f.runGit('config', '--add', 'remote.approved-origin.pushurl', 'https://example.invalid/approved.git');
  await f.runGit('config', '--add', 'remote.approved-origin.pushurl', 'https://example.invalid/second.git');
  await assert.rejects(pushAction(f, approvedCommand), { code: 'HOOK' });
});

test('T-28/T-29 candidate and Test Plan identities ignore staging and execution-only metadata', async t => {
  const f = await coding(await fixture(t));
  await fs.writeFile(path.join(f.repo, 'large-clean.bin'), Buffer.alloc(4 * 1024 * 1024 + 1, 1));
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Add a large clean tracked fixture');
  await fs.writeFile(path.join(f.repo, 'candidate.mjs'), 'export const stable = true;\n');
  const result = await startCycle(f.store, { workItemId: f.workItemId, configDigest: 'v1', cause: 'large clean tracked file' });
  await f.runGit('add', 'candidate.mjs');
  const staged = await startCycle(f.store, { workItemId: f.workItemId, configDigest: 'v1', cause: 'staging only' });
  assert.equal(staged.reset, false);
  assert.equal(currentCycle((await f.store.load(f.workItemId)).records, (await f.store.load(f.workItemId)).checkpoint).id, result.cycle.id);
  await f.runGit('commit', '-qm', 'Commit unchanged reviewed candidate bytes');
  await resume(f.store, { cwd: f.repo, sessionId: f.sessionId, workItemId: f.workItemId });
  const committedState = await f.store.load(f.workItemId);
  const committed = currentCycle(committedState.records, committedState.checkpoint);
  assert.equal(committed.id, result.cycle.id);
  assert.equal(committed.sources[0].revision, await f.runGit('rev-parse', 'HEAD'));
  const first = '| ID | Evidence | Status |\n| --- | --- | --- |\n| T-one | run-1 | Passed |\n';
  const second = first.replace('run-1', 'run-2');
  assert.equal(testSpecificationDigest(first), testSpecificationDigest(second));
  const procedureOne = '| ID | Status |\n| --- | --- |\n| T-one | NotRun |\n\n## T-one procedure\nAssert rejection.\n';
  const procedureTwo = procedureOne.replace('Assert rejection.', 'Assert acceptance.');
  assert.notEqual(testSpecificationDigest(procedureOne), testSpecificationDigest(procedureTwo));
  const jsonOne = JSON.stringify({ tests: [{ id: 'T-json', status: 'Passed' }],
    procedure: 'Assert 403' });
  const jsonTwo = JSON.stringify({ tests: [{ id: 'T-json', status: 'NotRun' }],
    procedure: 'Assert 200' });
  assert.notEqual(testSpecificationDigest(jsonOne), testSpecificationDigest(jsonTwo));
  await f.runGit('config', 'core.autocrlf', 'true');
  await fs.writeFile(path.join(f.repo, 'normalized.txt'), 'first\r\nsecond\r\n');
  const normalized = await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: 'v1', cause: 'normalized text candidate' });
  await f.runGit('add', 'normalized.txt');
  const normalizedStaged = await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: 'v1', cause: 'normalized text staging only' });
  assert.equal(normalizedStaged.reset, false);
  assert.equal(normalizedStaged.cycle.id, normalized.cycle.id);
});
test('T-20/T-32 push commit must contain the complete reviewed candidate', async t => {
  const f = await coding(await fixture(t));
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Commit candidate baseline');
  await fs.writeFile(path.join(f.repo, 'part-a.mjs'), 'export const a = true;\n');
  await fs.writeFile(path.join(f.repo, 'part-b.mjs'), 'export const b = true;\n');
  const cycle = (await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: 'v1', cause: 'two-part candidate' })).cycle;
  await passLocal(f, cycle);
  await completeReview(f, cycle);
  await f.runGit('add', 'part-a.mjs');
  await f.runGit('commit', '-qm', 'Commit only part of the reviewed candidate');
  await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: 'v1', cause: 'partial content-preserving commit' });
  const partial = await grantPush(f);
  const request = { toolName: 'bash', toolArgs: {
    command: 'git push --no-follow-tags --no-recurse-submodules origin refs/heads/feature/fixture:refs/heads/feature/fixture',
  }, cwd: f.repo };
  await assert.rejects(prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId,
    action: partial.action, request, correlationKey: 'partial-push',
    intent: 'Attempt to push an incomplete reviewed candidate' }), { code: 'STALE' });
  await f.runGit('add', 'part-b.mjs');
  await f.runGit('commit', '-qm', 'Commit the complete reviewed candidate');
  await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: 'v1', cause: 'complete content-preserving commit' });
  const complete = await grantPush(f);
  const prepared = await prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId,
    action: complete.action, request, correlationKey: 'complete-push',
    intent: 'Push the complete reviewed candidate' });
  assert.equal(prepared.operation.status, 'prepared');
});
test('T-06/T-20 explicit validation overrides permit a normal push without a cycle', async t => {
  const f = await fixture(t);
  await f.runGit('add', '.sdlc');
  await f.runGit('commit', '-qm', 'Commit explicitly overridden publication candidate');
  for (const rule of ['local-validation', 'candidate-review', 'review-completion']) {
    await grant(f, 'override', { rules: [rule],
      reason: `User explicitly waives ${rule} for this publication`,
      scope: { repositoryIds: ['primary'], actions: ['push'] } });
  }
  const command = 'git push --no-follow-tags --no-recurse-submodules origin refs/heads/feature/fixture:refs/heads/feature/fixture';
  const push = await grantPush(f, command);
  const prepared = await prepareOperation(f.store, { workItemId: f.workItemId,
    sessionId: f.sessionId, action: push.action,
    request: { toolName: 'bash', toolArgs: { command }, cwd: f.repo },
    correlationKey: 'overridden-push', intent: 'Publish under explicit validation deviations' });
  assert.equal(prepared.operation.cycleId, null);
});
test('T-28/T-32 symlink changes remain part of the reviewed candidate identity', async t => {
  const f = await coding(await fixture(t));
  await fs.writeFile(path.join(f.repo, 'target.mjs'), 'export const value = 1;\n');
  await fs.writeFile(path.join(f.repo, 'entry.mjs'), 'export const value = 1;\n');
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Commit regular-file candidate baseline');
  await fs.unlink(path.join(f.repo, 'entry.mjs'));
  await fs.symlink('target.mjs', path.join(f.repo, 'entry.mjs'));
  const cycle = (await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: 'v1', cause: 'symlink candidate' })).cycle;
  await passLocal(f, cycle);
  await completeReview(f, cycle);
  const push = await grantPush(f);
  await assert.rejects(prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId,
    action: push.action, request: { toolName: 'bash', toolArgs: {
      command: 'git push --no-follow-tags --no-recurse-submodules origin refs/heads/feature/fixture:refs/heads/feature/fixture',
    }, cwd: f.repo }, correlationKey: 'uncommitted-symlink',
    intent: 'Attempt to push without committing the reviewed symlink change' }), { code: 'STALE' });
  const dangling = path.join(f.repo, 'dangling-link');
  await fs.symlink('missing-a', dangling);
  const state = await f.store.load(f.workItemId);
  const firstStamp = await candidateStamp(state.metadata, state.manifest);
  await fs.unlink(dangling);
  await fs.symlink('missing-b', dangling);
  const secondStamp = await candidateStamp(state.metadata, state.manifest);
  assert.notEqual(firstStamp, secondStamp);
});
test('T-28/T-29 candidate modes respect core.filemode during staging', async t => {
  const f = await coding(await fixture(t));
  await f.runGit('config', 'core.filemode', 'false');
  const script = path.join(f.repo, 'script.sh');
  await fs.writeFile(script, '#!/bin/sh\nexit 0\n', { mode: 0o644 });
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Commit non-executable script baseline');
  await fs.writeFile(script, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const cycle = await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: 'v1', cause: 'filemode-disabled candidate' });
  await f.runGit('add', 'script.sh');
  const staged = await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: 'v1', cause: 'filemode-disabled staging' });
  assert.equal(staged.reset, false);
  assert.equal(staged.cycle.id, cycle.cycle.id);
  const untracked = path.join(f.repo, 'new-script.sh');
  await fs.writeFile(untracked, '#!/bin/sh\nexit 2\n', { mode: 0o755 });
  const untrackedCycle = await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: 'v1', cause: 'untracked executable with filemode disabled' });
  await f.runGit('add', 'new-script.sh');
  const untrackedStaged = await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: 'v1', cause: 'stage untracked executable with filemode disabled' });
  assert.equal(untrackedStaged.reset, false);
  assert.equal(untrackedStaged.cycle.id, untrackedCycle.cycle.id);

  await fs.writeFile(path.join(f.repo, 'link-target'), 'target');
  await fs.symlink('link-target', path.join(f.repo, 'entry-link'));
  await f.runGit('add', 'link-target', 'entry-link');
  await f.runGit('commit', '-qm', 'Commit symlink mode baseline');
  await fs.unlink(path.join(f.repo, 'entry-link'));
  await fs.writeFile(path.join(f.repo, 'entry-link'), 'link-target');
  const regularCycle = await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: 'v1', cause: 'replace symlink with regular file' });
  await f.runGit('add', 'entry-link');
  const regularStaged = await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: 'v1', cause: 'stage regular replacement with filemode disabled' });
  assert.equal(regularStaged.reset, false);
  assert.equal(regularStaged.cycle.id, regularCycle.cycle.id);
});
