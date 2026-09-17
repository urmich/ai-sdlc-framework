import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { coding, completeReview, fixture, grant, grantPush } from './helpers.mjs';
import { currentCycle, stagePassed } from '../src/authority.mjs';
import { fingerprint } from '../src/core.mjs';
import { captureReceipt } from '../src/decisions.mjs';
import { canonicalPath } from '../src/files.mjs';
import { evaluateGate, gate, recordStageAdvisory } from '../src/gate.mjs';
import { handleHook } from '../src/hooks.mjs';
import { doctor, install, selectMaintenanceSource } from '../src/install.mjs';
import { markDispatching, nextDeploymentSequence, prepareOperation, recordOperation } from '../src/operations.mjs';
import { resume } from '../src/recovery.mjs';
import { recordArtifact, recordTest, startCycle } from '../src/validation.mjs';

const entry = path.resolve('bin/sdlc.mjs');

function runEntry(executable, args, input) {
  return new Promise((resolve, reject) => {
    const child = execFile(executable, args, { encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') reject(error);
        else resolve({ code: error?.code ?? 0, stdout, stderr });
      });
    child.stdin.end(input);
  });
}

function runFile(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(executable, args, options, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stdout, stderr }));
      else resolve({ stdout, stderr });
    });
  });
}

function finalHookOutput(stdout) {
  const lines = stdout.trim().split(/\r?\n/u).filter(Boolean);
  return JSON.parse(lines.filter(line => {
    try { return JSON.parse(line).type !== 'progress'; }
    catch { return true; }
  }).at(-1));
}

test('T-41 only lifecycle-stage findings become one-time advisories', async t => {
  const f = await fixture(t, { initialize: false });
  const outside = await fs.realpath(await fs.mkdtemp(
    path.join(os.tmpdir(), 'sdlc-advisory-workspace-')));
  t.after(async () => fs.rm(outside, { recursive: true, force: true }));
  const requests = [
    { cwd: outside, sessionId: 'no-binding', toolName: 'powershell',
      toolArgs: { command: 'git status (Remove-Item victim)' } },
    { cwd: outside, sessionId: 'no-binding', toolName: 'cmd',
      toolArgs: { command: 'node arbitrary.mjs & echo chained' } },
    { cwd: '\\/server/share/repo', sessionId: 'no-binding', toolName: 'cmd',
      toolArgs: { command: 'git status --short' } },
    { cwd: outside, sessionId: 'no-binding', toolName: 'bash',
      toolArgs: { command: 'node arbitrary.mjs' } },
    { toolName: 'bash', toolArgs: { command: 'git status' } },
  ];
  for (const request of requests) {
    const strict = await evaluateGate(f.store, request);
    assert.equal(strict.permissionDecision, 'deny', JSON.stringify(request));
    const publicResult = await gate(f.store, request);
    assert.equal(publicResult.permissionDecision, undefined);
    assert.equal(publicResult.advisory, undefined);
    assert.equal(publicResult.unmanaged, true);
    assert.ok(publicResult.unmanagedReason);
  }

  const bound = await fixture(t);
  const phaseRequest = {
    cwd: bound.repo,
    sessionId: bound.sessionId,
    toolName: 'create',
    toolArgs: { path: 'source.mjs', file_text: 'export const value = 1;\n' },
  };
  const mixed = await gate(bound.store, {
    ...phaseRequest,
    toolArgs: { path: 'mixed.mjs', file_text: 'export const mixed = true;\n' },
  });
  assert.equal(mixed.permissionDecision, undefined);
  assert.equal(mixed.unmanaged, true);
  assert.match(mixed.unmanagedReason, /repository-workflow/u);
  await fs.writeFile(path.join(bound.repo, '.sdlc', 'config.json'),
    '{"defaultBranch":"refs/heads/main"}\n');
  assert.equal((await evaluateGate(bound.store, phaseRequest)).permissionDecision, 'deny');
  const phaseAdvisory = await gate(bound.store, phaseRequest);
  assert.equal(phaseAdvisory.permissionDecision, undefined);
  assert.equal(phaseAdvisory.advisory, true);
  assert.match(phaseAdvisory.advisoryReason, /phase|orientation|repository-workflow/iu);
  const repeated = await gate(bound.store, phaseRequest);
  assert.equal(repeated.permissionDecision, undefined);
  assert.equal(repeated.advisory, undefined);
  assert.equal(repeated.unmanaged, true);
  const multiFile = await gate(bound.store, {
    cwd: bound.repo,
    sessionId: bound.sessionId,
    toolName: 'apply_patch',
    toolArgs: `*** Begin Patch
*** Add File: one.mjs
+export const one = 1;
*** Add File: two.mjs
+export const two = 2;
*** End Patch`,
  });
  assert.equal(multiFile.advisory, true);
  assert.equal(multiFile.advisoryReason, undefined);

  const notPersisted = await recordStageAdvisory(bound.store, bound.sessionId,
    'injected-advisory-key', {
      write: async (file, initial, update) => {
        await update({ ...initial });
        throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
      },
    });
  assert.equal(notPersisted, false);

  for (let index = 0; index < 33; index++) {
    await gate(f.store, {
      cwd: outside,
      sessionId: 'overflow-session',
      toolName: 'bash',
      toolArgs: { command: `node unmanaged-${index}.mjs` },
    });
  }
  const overflow = JSON.parse(await fs.readFile(
    f.store.sessionPath('overflow-session'), 'utf8'));
  assert.equal(overflow.unmanagedFingerprintOverflow, true);
});

test('T-41 command-hook launcher fails open for malformed input and import failure', async t => {
  const malformed = await runEntry(process.execPath, [entry, 'gate'], '{not-json');
  assert.equal(malformed.code, 0);
  assert.equal(malformed.stderr, '');
  assert.deepEqual(finalHookOutput(malformed.stdout), {});
  assert.doesNotMatch(malformed.stdout, /advisory/iu);

  const root = await fs.realpath(await fs.mkdtemp(
    path.join(os.tmpdir(), 'sdlc-missing-runtime-')));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  const copiedEntry = path.join(root, 'bin', 'sdlc.mjs');
  await fs.mkdir(path.dirname(copiedEntry), { recursive: true });
  await fs.copyFile(entry, copiedEntry);
  const missingRuntime = await runEntry(process.execPath, [copiedEntry, 'gate'], '{}');
  assert.equal(missingRuntime.code, 0);
  assert.deepEqual(finalHookOutput(missingRuntime.stdout), {});
  assert.doesNotMatch(missingRuntime.stdout, /advisory/iu);

  const launcher = await fs.readFile(entry, 'utf8');
  assert.doesNotMatch(launcher, /^import\s/mu);
  assert.doesNotMatch(launcher, /permissionDecision['"]?\s*:\s*['"]deny/u);

  const unmanagedHome = path.join(root, 'unmanaged hook home');
  const unmanaged = await runEntry(process.execPath,
    [entry, 'gate', '--home', unmanagedHome],
    JSON.stringify({
      cwd: root,
      sessionId: 'unmanaged-hook-session',
      toolName: 'powershell',
      toolArgs: { command: 'node arbitrary.mjs; Remove-Item victim' },
    }));
  assert.equal(unmanaged.code, 0);
  assert.deepEqual(finalHookOutput(unmanaged.stdout), {});
});

test('T-41 unmanaged tool execution invalidates stale candidate evidence when files changed', async t => {
  const f = await coding(await fixture(t));
  const first = await startCycle(f.store, {
    workItemId: f.workItemId,
    configDigest: 'advisory-v1',
    cause: 'initial advisory candidate',
  });
  await fs.writeFile(path.join(f.repo, 'unmanaged-change.mjs'),
    'export const unmanaged = true;\n');
  const result = await handleHook(f.store, 'postToolUse', {
    sessionId: f.sessionId,
    cwd: f.repo,
    toolName: 'unknown_mutator',
    toolArgs: { target: 'unmanaged-change.mjs' },
    toolResult: { textResultForLlm: 'completed' },
  });
  assert.match(result.additionalContext, /Candidate or Test Plan changed/u);
  const state = await f.store.load(f.workItemId);
  assert.notEqual(currentCycle(state.records, state.checkpoint).id, first.cycle.id);
});

test('T-41 failed unmanaged candidate recheck clears current assurance', async t => {
  const f = await coding(await fixture(t));
  const { cycle } = await startCycle(f.store, {
    workItemId: f.workItemId,
    configDigest: 'advisory-v1',
    cause: 'candidate before invalid specification',
  });
  for (const testId of ['T-unit', 'T-integration']) {
    await recordTest(f.store, {
      workItemId: f.workItemId,
      cycleId: cycle.id,
      testId,
      status: 'Passed',
      expectedMet: true,
      evidenceRef: `fixture:${testId}`,
      owner: 'agent',
      host: 'local',
    });
  }
  let before = await f.store.load(f.workItemId);
  assert.equal(stagePassed(currentCycle(before.records, before.checkpoint),
    before.records, 'local', f.clock), true);
  await fs.writeFile(path.join(f.repo, 'docs/test-plan.md'), '# Invalid empty Test Plan\n');
  const result = await handleHook(f.store, 'postToolUse', {
    sessionId: f.sessionId,
    cwd: f.repo,
    toolName: 'unknown_mutator',
    toolArgs: { target: 'docs/test-plan.md' },
    toolResult: { textResultForLlm: 'completed' },
  });
  assert.match(result.additionalContext, /historical\/unverified/u);
  const after = await f.store.load(f.workItemId);
  const invalidated = currentCycle(after.records, after.checkpoint);
  assert.deepEqual(invalidated.results, {});
  assert.deepEqual(invalidated.artifacts, {});
  assert.deepEqual(invalidated.deployments, {});
  assert.equal(invalidated.reviewRef, null);
  assert.equal(stagePassed(invalidated, after.records, 'local', f.clock), false);
  await assert.rejects(recordTest(f.store, {
    workItemId: f.workItemId,
    cycleId: cycle.id,
    testId: 'T-unit',
    status: 'Passed',
    expectedMet: true,
    evidenceRef: 'fixture:late-unit',
    owner: 'agent',
    host: 'local',
  }), { code: 'STALE' });
  await assert.rejects(recordArtifact(f.store, {
    workItemId: f.workItemId,
    cycleId: cycle.id,
    artifactId: 'late-artifact',
    environment: 'DEV',
    sourceDigest: cycle.candidateDigest,
    configDigest: cycle.configDigest,
    buildRunId: 'late-build',
    name: 'late',
    artifactType: 'archive',
    evidenceRef: 'fixture:late-artifact',
    status: 'succeeded',
  }), { code: 'STALE' });
});

test('T-41 manifest corruption leaves an independent invalidation marker', async t => {
  const f = await coding(await fixture(t));
  const { cycle } = await startCycle(f.store, {
    workItemId: f.workItemId,
    configDigest: 'manifest-v1',
    cause: 'candidate before manifest corruption',
  });
  for (const testId of ['T-unit', 'T-integration']) {
    await recordTest(f.store, {
      workItemId: f.workItemId,
      cycleId: cycle.id,
      testId,
      status: 'Passed',
      expectedMet: true,
      evidenceRef: `fixture:${testId}`,
      owner: 'agent',
      host: 'local',
    });
  }
  const manifest = path.join(f.repo, '.sdlc', 'work-items', `${f.workItemId}.json`);
  const original = await fs.readFile(manifest);
  await fs.writeFile(manifest, '{corrupt');
  await assert.rejects(handleHook(f.store, 'postToolUse', {
    sessionId: f.sessionId,
    cwd: f.repo,
    toolName: 'unknown_mutator',
    toolArgs: { target: manifest },
    toolResult: { textResultForLlm: 'completed' },
  }), { code: 'JSON' });
  await fs.writeFile(manifest, original);
  await f.store.markAssurancePending(f.workItemId,
    'Later callback must not clear forced restart');
  const marker = JSON.parse(await fs.readFile(f.store.assurancePath(f.workItemId), 'utf8'));
  assert.equal(marker.forceNewCycle, true);

  const pending = await f.store.load(f.workItemId);
  const pendingCycle = currentCycle(pending.records, pending.checkpoint);
  assert.equal(pending.assurancePending, true);
  assert.ok(pending.records.some(record => record.type === 'assurance-marker'));
  assert.equal(stagePassed(pendingCycle, pending.records, 'local', f.clock), false);

  await resume(f.store, {
    cwd: f.repo,
    sessionId: f.sessionId,
    workItemId: f.workItemId,
  });
  const restarted = await f.store.load(f.workItemId);
  assert.notEqual(currentCycle(restarted.records, restarted.checkpoint).id, cycle.id);
  assert.equal(restarted.assurancePending, false);
});

test('T-41 concurrent assurance obligations clear only their own callback token', async t => {
  const f = await fixture(t);
  const deploymentToken = await f.store.markAssurancePending(f.workItemId,
    'Unmanaged deployment callback is still evaluating');
  const readToken = await f.store.markAssurancePending(f.workItemId,
    'Read callback is still evaluating');
  assert.equal(await f.store.clearAssurancePending(f.workItemId, readToken), true);
  let marker = JSON.parse(await fs.readFile(f.store.assurancePath(f.workItemId), 'utf8'));
  assert.deepEqual(marker.obligations.map(obligation => obligation.token),
    [deploymentToken]);
  assert.equal((await f.store.load(f.workItemId)).assurancePending, true);
  assert.equal(await f.store.clearAssurancePending(f.workItemId, deploymentToken), true);
  assert.equal((await f.store.load(f.workItemId)).assurancePending, false);
});

test('T-41 recovery treats an unfinished callback obligation as a forced new cycle', async t => {
  const f = await coding(await fixture(t));
  const { cycle } = await startCycle(f.store, {
    workItemId: f.workItemId,
    configDigest: 'unfinished-callback-v1',
    cause: 'candidate before interrupted callback',
  });
  await f.store.markAssurancePending(f.workItemId,
    'Callback ended before candidate and environment checks completed');
  await resume(f.store, {
    cwd: f.repo,
    sessionId: f.sessionId,
    workItemId: f.workItemId,
  });
  const state = await f.store.load(f.workItemId);
  assert.notEqual(currentCycle(state.records, state.checkpoint).id, cycle.id);
  assert.equal(state.assurancePending, false);
});

test('T-44 an unrecorded stage advisory never binds managed operation credit', async t => {
  const f = await coding(await fixture(t));
  await fs.writeFile(path.join(f.repo, '.sdlc', 'config.json'),
    '{"defaultBranch":"refs/heads/main"}\n');
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Create stage advisory publication candidate');
  const { cycle } = await startCycle(f.store, {
    workItemId: f.workItemId,
    configDigest: 'advisory-push',
    cause: 'stage advisory dispatch',
  });
  for (const testId of ['T-unit', 'T-integration']) {
    await recordTest(f.store, {
      workItemId: f.workItemId,
      cycleId: cycle.id,
      testId,
      status: 'Passed',
      expectedMet: true,
      evidenceRef: `fixture:${testId}`,
      owner: 'agent',
      host: 'local',
    });
  }
  await completeReview(f, cycle);
  const command = 'git push --no-follow-tags --no-recurse-submodules origin ' +
    'refs/heads/feature/fixture:refs/heads/feature/fixture';
  const push = await grantPush(f, command);
  const request = { toolName: 'bash', toolArgs: { command }, cwd: f.repo };
  const { operation } = await prepareOperation(f.store, {
    workItemId: f.workItemId,
    sessionId: f.sessionId,
    action: push.action,
    request,
    correlationKey: 'stage-advisory-dispatch',
    intent: 'Publish after explicit orientation-stage override',
  });
  await markDispatching(f.store, f.workItemId, operation.id);
  const result = await gate(f.store, { ...request, sessionId: f.sessionId });
  assert.equal(result.permissionDecision, undefined);
  assert.equal(result.stageOverride, true);
  assert.equal(result.managedDispatchBound, false);
  const unrecorded = (await f.store.records(f.workItemId))
    .find(record => record.id === operation.id);
  assert.equal(unrecorded.dispatchBound, false);
  assert.equal(unrecorded.status, 'uncertain');
  assert.equal(unrecorded.dispatchAmbiguous, true);

  await handleHook(f.store, 'postToolUse', {
    ...request,
    sessionId: f.sessionId,
    toolResult: { textResultForLlm: '{"id":"ambiguous-push-run"}' },
  });
  const unresolved = (await f.store.records(f.workItemId))
    .find(record => record.id === operation.id);
  assert.equal(unresolved.status, 'uncertain');
  assert.equal(unresolved.handle, undefined);

  await grant(f, 'override', {
    rules: ['uncertain-retry'],
    reason: 'User accepts duplicate-effect risk for one explicit retry',
  });
  const retryOperation = (await prepareOperation(f.store, {
    workItemId: f.workItemId,
    sessionId: f.sessionId,
    action: push.action,
    request,
    correlationKey: 'stage-advisory-retry',
    intent: 'Explicitly retry the ambiguous publication',
  })).operation;
  await markDispatching(f.store, f.workItemId, retryOperation.id);
  const retryGate = await gate(f.store, { ...request, sessionId: f.sessionId });
  assert.equal(retryGate.permissionDecision, undefined);
  await handleHook(f.store, 'postToolUse', {
    ...request,
    sessionId: f.sessionId,
    toolResult: { textResultForLlm: '{"id":"delayed-original-run"}' },
  });
  const retryUncertain = (await f.store.records(f.workItemId))
    .find(record => record.id === retryOperation.id);
  assert.equal(retryUncertain.status, 'uncertain');
  assert.equal(retryUncertain.handle, undefined);
});

test('T-44 a receipt-bound explicit stage override can bind one managed invocation', async t => {
  const f = await coding(await fixture(t));
  const command = 'npm run local-build';
  await fs.writeFile(path.join(f.repo, '.sdlc', 'config.json'), JSON.stringify({
    defaultBranch: 'refs/heads/main',
    commands: [{ command, action: { class: 'local-build' } }],
  }));
  const request = { toolName: 'bash', toolArgs: { command }, cwd: f.repo };
  const operationId = 'op-local-orientation-once';
  const itemId = 'local-build-item';
  const orientationOverride = await grant(f, 'override', {
    rules: ['orientation'],
    reason: 'User explicitly skips session orientation for this local build',
    scope: { operationId, itemId },
    lifetime: { kind: 'once' },
  });
  const operation = (await prepareOperation(f.store, {
    workItemId: f.workItemId,
    sessionId: f.sessionId,
    operationId,
    action: { class: 'local-build', repositoryId: 'primary', itemId },
    request,
    correlationKey: 'local-build-once',
    intent: 'Run one local build with an orientation-stage override',
  })).operation;
  assert.ok((await f.store.records(f.workItemId)).some(record =>
    record.type === 'reservation' &&
    record.eventId === orientationOverride.event.id &&
    record.operationId === operation.id));
  await markDispatching(f.store, f.workItemId, operation.id);
  const first = await gate(f.store, { ...request, sessionId: f.sessionId });
  assert.equal(first.permissionDecision, undefined);
  assert.equal(first.advisory, undefined);
  const bound = (await f.store.records(f.workItemId))
    .find(record => record.id === operation.id);
  assert.equal(bound.dispatchBound, true);
  const second = await gate(f.store, { ...request, sessionId: f.sessionId });
  assert.equal(second.unmanaged, true);
  const ambiguous = (await f.store.records(f.workItemId))
    .find(record => record.id === operation.id);
  assert.equal(ambiguous.status, 'uncertain');
  assert.equal(ambiguous.dispatchAmbiguous, true);
});

test('T-41 an unmanaged invocation prevents a later identical managed binding', async t => {
  const f = await coding(await fixture(t));
  const command = 'npm run delayed-local-build';
  await fs.writeFile(path.join(f.repo, '.sdlc', 'config.json'), JSON.stringify({
    defaultBranch: 'refs/heads/main',
    commands: [{ command, action: { class: 'local-build' } }],
  }));
  const request = { toolName: 'bash', toolArgs: { command }, cwd: f.repo };
  const operation = (await prepareOperation(f.store, {
    workItemId: f.workItemId,
    sessionId: f.sessionId,
    action: { class: 'local-build', repositoryId: 'primary' },
    request,
    correlationKey: 'delayed-local-build',
    intent: 'Exercise an invocation before dispatch bookkeeping',
  })).operation;

  const first = await gate(f.store, { ...request, sessionId: f.sessionId });
  assert.equal(first.stageOverride, true);
  assert.equal(first.managedDispatchBound, false);
  await markDispatching(f.store, f.workItemId, operation.id);
  const later = await gate(f.store, { ...request, sessionId: f.sessionId });
  assert.equal(later.unmanaged, true);
  const ambiguous = (await f.store.records(f.workItemId))
    .find(record => record.id === operation.id);
  assert.equal(ambiguous.status, 'uncertain');
  assert.equal(ambiguous.dispatchAmbiguous, true);

  await handleHook(f.store, 'postToolUse', {
    ...request,
    sessionId: f.sessionId,
    toolResult: { textResultForLlm: '{"id":"delayed-unmanaged-result"}' },
  });
  const unresolved = (await f.store.records(f.workItemId))
    .find(record => record.id === operation.id);
  assert.equal(unresolved.status, 'uncertain');
  assert.equal(unresolved.handle, undefined);
});

test('T-41 unmanaged deployment-capable actions invalidate environment assurance', async t => {
  const f = await coding(await fixture(t));
  await fs.writeFile(path.join(f.repo, '.sdlc', 'config.json'), JSON.stringify({
    defaultBranch: 'refs/heads/main',
    environments: {
      DEV: {
        target: 'dev-target',
        configDigest: 'env-v1',
        allowedStages: ['pre-production'],
      },
    },
    environmentMappings: [{
      provider: 'ci-provider',
      pipeline: 'application-delivery',
      label: 'pre-production',
      environment: 'DEV',
      target: 'dev-target',
      configDigest: 'env-v1',
    }],
    toolAdapters: [{
      toolName: 'fixture_deploy',
      match: { slot: 'dev' },
      action: {
        class: 'deploy',
        provider: 'ci-provider',
        pipeline: 'application-delivery',
        target: 'dev-target',
        configDigest: 'env-v1',
        stages: ['pre-production'],
        monitorCapability: true,
        artifactId: 'artifact-old',
      },
    }],
  }));
  const { cycle } = await startCycle(f.store, {
    workItemId: f.workItemId,
    configDigest: 'env-v1',
    cause: 'environment before unmanaged redeployment',
  });
  await f.store.transaction(f.workItemId, tx => {
    const current = tx.get(cycle.id);
    current.artifacts.DEV = 'artifact-record-old';
    current.artifacts.STAGING = 'artifact-record-staging-old';
    current.deployments.DEV = 'deployment-old';
    current.deployments.STAGING = 'deployment-staging-old';
    current.results['T-dev'] = 'evidence-dev-old';
    current.results['T-staging'] = 'evidence-staging-old';
    tx.put(current);
    tx.put({
      type: 'artifact',
      id: 'artifact-record-old',
      workItemId: f.workItemId,
      sequence: 1,
      selectedAt: '2026-09-10T00:00:00.000Z',
      cycleId: cycle.id,
      artifactId: 'artifact-old',
      environment: 'DEV',
      sourceDigest: cycle.candidateDigest,
      configDigest: cycle.configDigest,
      buildRunId: 'build-old',
      name: 'package-old',
      artifactType: 'archive',
      evidenceRef: 'fixture:artifact-old',
      status: 'succeeded',
    });
    tx.put({
      type: 'operation',
      id: 'deployment-old',
      workItemId: f.workItemId,
      sessionId: f.sessionId,
      repositoryId: 'primary',
      bindingKey: 'fixture-binding',
      class: 'deploy',
      action: {
        class: 'deploy',
        repositoryId: 'primary',
        environment: 'DEV',
        target: 'dev-target',
        configDigest: cycle.configDigest,
        artifactId: 'artifact-old',
      },
      target: 'dev-target',
      status: 'succeeded',
      correlationKey: 'deployment-old',
      requestFingerprint: 'deployment-old-fingerprint',
      effectFingerprint: 'deployment-old-effect',
      intent: 'Historical successful DEV deployment',
      createdAt: '2026-09-10T00:00:00.000Z',
      dispatchBound: true,
      cycleId: cycle.id,
      candidateDigest: cycle.candidateDigest,
      candidateStamp: 'deployment-old-stamp',
      deploymentSequence: 1,
    });
    tx.put({
      type: 'test-evidence',
      id: 'evidence-dev-old',
      workItemId: f.workItemId,
      sequence: 1,
      cycleId: cycle.id,
      testId: 'T-dev',
      testSpecDigest: cycle.testSpecDigest,
      candidateDigest: cycle.candidateDigest,
      environment: 'DEV',
      implementation: 'docs/dev-flow.md',
      status: 'Passed',
      observedAt: '2026-09-10T00:00:00.000Z',
      activity: 'complete',
      evidenceRef: 'fixture:dev-old',
      artifactId: 'artifact-old',
      deploymentId: 'deployment-old',
      expectedMet: true,
      owner: 'agent',
      host: 'development-machine',
    });
  });

  await handleHook(f.store, 'postToolUse', {
    sessionId: f.sessionId,
    cwd: f.repo,
    toolName: 'fixture_deploy',
    toolArgs: { slot: 'dev' },
    toolResult: { textResultForLlm: '{"id":"unmanaged-deployment"}' },
  });
  const state = await f.store.load(f.workItemId);
  const invalidated = currentCycle(state.records, state.checkpoint);
  assert.equal(invalidated.artifacts.DEV, undefined);
  assert.equal(invalidated.artifacts.STAGING, undefined);
  assert.equal(invalidated.deployments.DEV, undefined);
  assert.equal(invalidated.deployments.STAGING, undefined);
  assert.equal(invalidated.results['T-dev'], undefined);
  assert.equal(invalidated.results['T-staging'], undefined);
  assert.equal(invalidated.step, 'environment-unmanaged-uncertain');
  assert.deepEqual(invalidated.invalidatedEnvironments, ['DEV', 'STAGING']);
  assert.equal(invalidated.environmentInvalidationSequences.DEV, 1);
  await recordOperation(f.store, {
    workItemId: f.workItemId,
    operationId: 'deployment-old',
    status: 'succeeded',
  });
  const reloaded = await f.store.load(f.workItemId);
  const recovered = currentCycle(reloaded.records, reloaded.checkpoint);
  assert.equal(recovered.artifacts.DEV, undefined);
  assert.equal(recovered.deployments.DEV, undefined);
  assert.ok(recovered.invalidatedEnvironments.includes('DEV'));
  assert.equal(stagePassed(recovered, reloaded.records, 'STAGING', f.clock), false);

  const deployRequest = {
    toolName: 'fixture_deploy',
    toolArgs: { slot: 'dev' },
    cwd: f.repo,
  };
  const deployFingerprint = fingerprint(deployRequest.toolName,
    deployRequest.toolArgs, await canonicalPath(f.repo));
  await f.store.transaction(f.workItemId, tx => {
    const current = tx.get(cycle.id);
    current.deployments.DEV = 'deployment-new';
    tx.put(current);
    tx.put({
      type: 'operation',
      id: 'deployment-new',
      workItemId: f.workItemId,
      sessionId: f.sessionId,
      repositoryId: 'primary',
      bindingKey: 'fixture-binding',
      class: 'deploy',
      action: {
        class: 'deploy',
        repositoryId: 'primary',
        environment: 'DEV',
        target: 'dev-target',
        configDigest: cycle.configDigest,
        artifactId: 'artifact-old',
      },
      target: 'dev-target',
      status: 'dispatching',
      correlationKey: 'deployment-new',
      requestFingerprint: deployFingerprint,
      effectFingerprint: 'deployment-new-effect',
      intent: 'Managed replacement DEV deployment',
      createdAt: '2026-09-10T00:01:00.000Z',
      dispatchBound: true,
      environmentBoundaryApplied: true,
      cycleId: cycle.id,
      candidateDigest: cycle.candidateDigest,
      candidateStamp: 'deployment-new-stamp',
      deploymentSequence: 2,
    });
  });
  await handleHook(f.store, 'postToolUse', {
    ...deployRequest,
    sessionId: f.sessionId,
    toolResult: { textResultForLlm: '{"id":"deployment-new-run"}' },
  });
  let managed = (await f.store.records(f.workItemId))
    .find(record => record.id === 'deployment-new');
  assert.equal(managed.status, 'uncertain');
  await recordOperation(f.store, {
    workItemId: f.workItemId,
    operationId: managed.id,
    status: 'succeeded',
    handle: 'deployment-new-run',
    target: managed.target,
    requestFingerprint: managed.requestFingerprint,
    evidenceRef: 'fixture:reconciled-new-deployment',
  }, { reconcile: true });
  const reconciled = await f.store.load(f.workItemId);
  const reconciledCycle = currentCycle(reconciled.records, reconciled.checkpoint);
  assert.equal(reconciledCycle.deployments.DEV, 'deployment-new');
  assert.ok(!reconciledCycle.invalidatedEnvironments.includes('DEV'));
  assert.ok(reconciledCycle.invalidatedEnvironments.includes('STAGING'));
  await handleHook(f.store, 'postToolUse', {
    sessionId: f.sessionId,
    cwd: f.repo,
    toolName: 'bash',
    toolArgs: { command: 'az webapp deploy --name dev-app' },
    toolResult: { textResultForLlm: '{"status":"completed"}' },
  });
  const unknownDeployment = await f.store.load(f.workItemId);
  const unknownCycle = currentCycle(unknownDeployment.records,
    unknownDeployment.checkpoint);
  assert.deepEqual(unknownCycle.invalidatedEnvironments, ['DEV', 'STAGING']);
  assert.equal(unknownCycle.deployments.DEV, undefined);
  assert.equal(nextDeploymentSequence({
    ...reconciledCycle,
    lastDeploymentSequence: 7,
    environmentInvalidationSequences: { DEV: 7 },
  }, []), 8);
});

test('T-41 post-hook shell normalization failures still invalidate environments', async t => {
  const f = await coding(await fixture(t));
  const { cycle } = await startCycle(f.store, {
    workItemId: f.workItemId,
    configDigest: 'shell-normalization-v1',
    cause: 'candidate before invalid shell callback',
  });
  await f.store.transaction(f.workItemId, tx => {
    const current = tx.get(cycle.id);
    current.deployments.DEV = 'previous-dev';
    current.results['T-dev'] = 'previous-dev-evidence';
    tx.put(current);
  });
  await assert.rejects(handleHook(f.store, 'postToolUse', {
    sessionId: f.sessionId,
    cwd: '\\/server/share/repository',
    toolName: 'cmd',
    toolArgs: { command: 'az webapp deploy --name dev-app' },
    toolResult: { textResultForLlm: '{"status":"completed"}' },
  }), { code: 'HOOK' });
  const state = await f.store.load(f.workItemId);
  const invalidated = currentCycle(state.records, state.checkpoint);
  assert.equal(state.assurancePending, true);
  assert.deepEqual(invalidated.invalidatedEnvironments, ['DEV', 'STAGING']);
  assert.equal(invalidated.deployments.DEV, undefined);
});

test('T-42 direct framework maintenance is trusted outside Git across shell adapters', async t => {
  const f = await fixture(t, { initialize: false });
  const outside = await fs.realpath(await fs.mkdtemp(
    path.join(os.tmpdir(), 'sdlc-maintenance-workspace-')));
  t.after(async () => fs.rm(outside, { recursive: true, force: true }));
  const home = path.join(outside, 'copilot home with spaces');
  for (const toolName of ['bash', 'powershell', 'cmd']) {
    for (const command of ['doctor', 'install', 'update', 'uninstall']) {
      const source = command === 'update' ? ` --source-root "${path.resolve('.')}"` : '';
      const request = {
        cwd: outside,
        sessionId: `maintenance-${toolName}`,
        toolName,
        toolArgs: {
          command: `node "${entry}" ${command} --home "${home}"${source}`,
        },
      };
      assert.equal((await evaluateGate(f.store, request)).permissionDecision, undefined,
        `${toolName}: ${command}`);
      assert.equal((await gate(f.store, request)).permissionDecision, undefined,
        `${toolName}: ${command}`);
    }
  }
});

test('T-42 receipt-selected framework source is trusted; variants stay advisory', async t => {
  const f = await fixture(t, { initialize: false });
  const outside = await fs.realpath(await fs.mkdtemp(
    path.join(os.tmpdir(), 'sdlc-selected-source-')));
  t.after(async () => fs.rm(outside, { recursive: true, force: true }));
  const selected = path.join(outside, 'selected framework');
  await fs.mkdir(path.join(selected, 'bin'), { recursive: true });
  await fs.writeFile(path.join(selected, 'bin', 'sdlc.mjs'), '// selected entry\n');
  await fs.writeFile(path.join(selected, 'package.json'),
    `${JSON.stringify({ name: 'ai-sdlc-framework', version: '9.9.9' })}\n`);
  const command = `node "${path.join(selected, 'bin', 'sdlc.mjs')}" update ` +
    `--home "${path.join(outside, 'copilot home')}" --source-root "${selected}"`;
  const request = { cwd: outside, sessionId: f.sessionId, toolName: 'powershell',
    toolArgs: { command } };
  const installedEntryRequest = {
    ...request,
    toolArgs: {
      command: `node "${entry}" update --home "${path.join(outside, 'copilot home')}" ` +
        `--source-root "${selected}"`,
    },
  };
  await captureReceipt(f.store, { sessionId: f.sessionId,
    source: 'userPromptSubmitted', input: 'Unrelated user request.' });
  assert.equal((await evaluateGate(f.store, request)).permissionDecision, 'deny');
  assert.equal((await evaluateGate(f.store, installedEntryRequest)).permissionDecision, 'deny');
  assert.equal((await gate(f.store, installedEntryRequest)).unmanaged, true);
  const input = `Use the framework checkout at ${selected} to update.`;
  const receipt = await captureReceipt(f.store, { sessionId: f.sessionId,
    source: 'userPromptSubmitted', input });
  await selectMaintenanceSource(f.store, {
    sessionId: f.sessionId,
    receiptId: receipt.id,
    input,
    sourceRoot: selected,
  });
  assert.equal((await evaluateGate(f.store, request)).permissionDecision, undefined);
  assert.equal((await evaluateGate(f.store, installedEntryRequest)).permissionDecision, undefined);

  for (const malicious of [
    `node "${path.join(selected, 'bin', 'other.mjs')}" update --home "${outside}"`,
    `${command}; Remove-Item victim`,
    `${command} > result.txt`,
    `node arbitrary.mjs update --home "${outside}"`,
  ]) {
    const candidate = { ...request, toolArgs: { command: malicious } };
    assert.equal((await evaluateGate(f.store, candidate)).permissionDecision, 'deny',
      malicious);
    const strict = await gate(f.store, candidate);
    assert.equal(strict.permissionDecision, undefined);
    assert.equal(strict.advisory, undefined);
    assert.equal(strict.unmanaged, true);
  }
});

async function oldSourceRoot(root) {
  const source = path.join(root, 'version 1.2.0 source');
  await fs.mkdir(source, { recursive: true });
  let listed;
  try {
    listed = await runFile('git', ['ls-tree', '-r', '--name-only', 'v1.2.0',
      '--', 'bin', 'src', 'assets', 'docs/cli.md', 'package.json'], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
    });
  } catch {
    return null;
  }
  const names = listed.stdout.trim().split('\n').filter(Boolean);
  assert.ok(names.includes('bin/sdlc.mjs'));
  assert.ok(names.includes('src/install.mjs'));
  for (const name of names) {
    const file = path.join(source, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const historical = await runFile('git', ['show', `v1.2.0:${name}`], {
      cwd: path.resolve('.'),
      encoding: 'buffer',
      maxBuffer: 2 * 1024 * 1024,
    });
    await fs.writeFile(file, historical.stdout);
  }
  return source;
}

test('T-42 intact 1.2.0 installation updates while conflicts preserve owned content', async t => {
  const intact = await fixture(t, { initialize: false });
  const old = await oldSourceRoot(intact.root);
  if (!old) {
    t.skip('Authentic v1.2.0 source is unavailable in this non-Git OSS workspace');
    return;
  }
  await install(intact.store, { sourceRoot: old });
  const runtime = path.join(intact.home, 'sdlc', 'runtime', 'retained.json');
  await fs.mkdir(path.dirname(runtime), { recursive: true });
  await fs.writeFile(runtime, '{"retained":true}\n');
  await fs.writeFile(path.join(intact.home, 'unowned.txt'), 'keep\n');
  assert.equal((await doctor(intact.store)).frameworkVersion, '1.2.0');
  const installedEntry = path.join(intact.home, 'sdlc', 'bin', 'sdlc.mjs');
  const updated = await runEntry(process.execPath, [
    installedEntry,
    'update',
    '--home',
    intact.home,
    '--source-root',
    path.resolve('.'),
  ], '');
  assert.equal(updated.code, 0);
  assert.equal(JSON.parse(updated.stdout).installed, true);
  const current = await doctor(intact.store);
  assert.equal(current.installed, true);
  assert.equal(current.frameworkVersion, packageVersion);
  assert.deepEqual(current.findings, []);
  assert.equal(await fs.readFile(runtime, 'utf8'), '{"retained":true}\n');
  assert.equal(await fs.readFile(path.join(intact.home, 'unowned.txt'), 'utf8'), 'keep\n');

  const conflicted = await fixture(t, { initialize: false });
  const conflictedOld = await oldSourceRoot(conflicted.root);
  await install(conflicted.store, { sourceRoot: conflictedOld });
  const owned = path.join(conflicted.home, 'skills', 'sdlc', 'SKILL.md');
  await fs.appendFile(owned, '\nUser-owned modification.\n');
  const before = await fs.readFile(owned, 'utf8');
  await assert.rejects(install(conflicted.store), { code: 'INSTALL_CONFLICT' });
  assert.equal(await fs.readFile(owned, 'utf8'), before);
  const report = await doctor(conflicted.store);
  assert.equal(report.frameworkVersion, '1.2.0');
  assert.ok(report.findings.some(finding => finding.includes('skills/sdlc/SKILL.md')));
});

test('T-42 README documents cross-platform npm migration and complete maintenance procedures', async () => {
  const readme = await fs.readFile('README.md', 'utf8');
  const migrationStart = readme.indexOf('### Clean migration from the private or an earlier installation');
  assert.ok(migrationStart >= 0);
  const migrationEnd = readme.indexOf('For a repository on a UNC share', migrationStart);
  const migration = readme.slice(migrationStart, migrationEnd);
  assert.equal((migration.match(/sdlc install --purge-existing/gu) ?? []).length, 1);
  assert.match(migration, /single cross-platform command/iu);
  assert.match(migration, /Close every Copilot CLI process first/iu);
  assert.match(migration, /preserves unrelated[\s\S]*Copilot files/iu);
  const updateStart = readme.indexOf('## Update the framework');
  const uninstallStart = readme.indexOf('## Uninstall the framework');
  const nextStart = readme.indexOf('## What gets installed');
  assert.ok(updateStart >= 0 && uninstallStart > updateStart && nextStart > uninstallStart);
  const update = readme.slice(updateStart, uninstallStart);
  const uninstall = readme.slice(uninstallStart, nextStart);
  for (const platform of ['macOS or Linux', 'Windows PowerShell', 'Windows Command Prompt']) {
    assert.ok(update.includes(`### Update on ${platform}`), platform);
    assert.ok(uninstall.includes(`### Uninstall on ${platform}`), platform);
  }
  assert.equal((update.match(/\bupdate --home\b/gu) ?? []).length, 3);
  assert.equal((update.match(/\bdoctor --home\b/gu) ?? []).length, 3);
  assert.equal((update.match(/--clobber/gu) ?? []).length, 3);
  assert.ok(update.includes('node "$COPILOT_HOME/sdlc/bin/sdlc.mjs"'));
  assert.ok(update.includes('Join-Path $CopilotHome "sdlc\\bin\\sdlc.mjs"'));
  assert.ok(update.includes('node "%FRAMEWORK_HOME%\\sdlc\\bin\\sdlc.mjs" update'));
  assert.doesNotMatch(update, /\buninstall --home\b/u);
  assert.equal((uninstall.match(/\buninstall --home\b/gu) ?? []).length, 3);
  assert.doesNotMatch(uninstall, /\bupdate --home\b/u);
  assert.match(uninstall, /always retains[\s\S]*sdlc\/runtime/iu);
});
