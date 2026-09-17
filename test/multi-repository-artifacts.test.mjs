import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { artifact, coding, fixture, grant } from './helpers.mjs';
import {
  artifactPath,
  currentTestSpecification,
  registerArtifact,
  resolveTestSpecification,
  snapshots,
  testSpecificationDigest,
} from '../src/artifacts.mjs';
import { check } from '../src/checks.mjs';
import { captureReceipt, applyDecision, prepareDecision } from '../src/decisions.mjs';
import { currentCycle } from '../src/authority.mjs';
import { resume, status } from '../src/recovery.mjs';
import { recordTest, startCycle } from '../src/validation.mjs';
import { validateManifest } from '../src/schemas.mjs';
import { byteSize, digest } from '../src/core.mjs';
import { formatEvents, parseEvents } from '../src/audit.mjs';

const execute = promisify(execFile);

async function member(f, repositoryId) {
  const root = path.join(f.root, `repository ${repositoryId}`);
  await fs.mkdir(root);
  await execute('git', ['init', '-q', '-b', `feature/${repositoryId}`], { cwd: root });
  await f.store.bindMember({
    workItemId: f.workItemId,
    repositoryId,
    cwd: root,
    sessionId: `session-${repositoryId}`,
  });
  return root;
}

async function document(root, relative, contents) {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, contents);
  return relative;
}

function requirement(id, outcome) {
  return `# Requirements\n#### ${id} - ${outcome}\n**Definition of Done**\n- AC-${id.slice(3)}.1: ${outcome} is observable.\n`;
}

function plan(testId, requirementId, expected) {
  return `# Test Plan
| ID | Requirements | Conditions | Environment | Level | Checkpoint | Mode | Owner | Location | Expected outcome | Implementation | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ${testId} | ${requirementId} | AC-${requirementId.slice(3)}.1 | local | unit | pre-review | Automated | agent | local | ${expected} | test/${testId}.mjs | NotRun |
`;
}

test('T-45 same-role artifacts are retained and replaced per repository', async t => {
  assert.doesNotThrow(() => validateManifest({
    schemaVersion: 1,
    revision: 0,
    workItemId: 'wi-legacy',
    coordinatorId: 'primary',
    repositoryIds: ['primary'],
    artifacts: [{
      role: 'requirements',
      kind: 'external-file',
      locatorId: 'locator-requirements',
      digest: 'a'.repeat(64),
    }],
    historyStartsAt: null,
  }));
  const f = await fixture(t);
  const beta = await member(f, 'beta');
  const gamma = await member(f, 'gamma');
  const registrations = [
    ['primary', f.repo, 'FR-101'],
    ['beta', beta, 'FR-102'],
    ['gamma', gamma, 'FR-103'],
  ];
  for (const [repositoryId, root, requirementId] of registrations) {
    const relative = await document(root, 'docs/requirements.md',
      requirement(requirementId, `${repositoryId} outcome`));
    await registerArtifact(f.store, {
      workItemId: f.workItemId,
      role: 'requirements',
      repositoryId,
      path: relative,
    });
  }

  let manifest = (await f.store.manifest(f.workItemId)).manifest;
  assert.deepEqual(manifest.artifacts.map(locator =>
    [locator.role, locator.repositoryId, locator.path]), [
    ['requirements', 'beta', 'docs/requirements.md'],
    ['requirements', 'gamma', 'docs/requirements.md'],
    ['requirements', 'primary', 'docs/requirements.md'],
  ]);
  assert.equal((await snapshots(f.store, f.workItemId, ['requirements'])).length, 3);
  for (const [artifactId, requirementId] of [
    ['api', 'FR-104'],
    ['security', 'FR-105'],
  ]) {
    await document(f.repo, `docs/requirements-${artifactId}.md`,
      requirement(requirementId, `${artifactId} requirements`));
    await registerArtifact(f.store, {
      workItemId: f.workItemId,
      role: 'requirements',
      repositoryId: 'primary',
      artifactId,
      path: `docs/requirements-${artifactId}.md`,
    });
  }
  assert.equal((await snapshots(f.store, f.workItemId, ['requirements'])).length, 5);
  assert.equal((await check(f.store, f.workItemId, 'artifacts')).exitCode, 0);
  await document(f.repo, 'docs/requirements-api-v2.md',
    requirement('FR-104', 'api replacement'));
  await registerArtifact(f.store, {
    workItemId: f.workItemId,
    role: 'requirements',
    repositoryId: 'primary',
    artifactId: 'api',
    path: 'docs/requirements-api-v2.md',
  });
  manifest = (await f.store.manifest(f.workItemId)).manifest;
  assert.equal(manifest.artifacts.find(locator =>
    locator.repositoryId === 'primary' &&
    locator.artifactId === 'api').path, 'docs/requirements-api-v2.md');
  assert.equal(manifest.artifacts.find(locator =>
    locator.repositoryId === 'primary' &&
    locator.artifactId === 'security').path,
  'docs/requirements-security.md');

  const replacement = await document(beta, 'docs/requirements-v2.md',
    requirement('FR-102', 'beta replacement'));
  await registerArtifact(f.store, {
    workItemId: f.workItemId,
    role: 'requirements',
    repositoryId: 'beta',
    path: replacement,
  });
  manifest = (await f.store.manifest(f.workItemId)).manifest;
  assert.equal(manifest.artifacts.find(locator =>
    locator.repositoryId === 'beta').path, replacement);
  assert.equal(manifest.artifacts.find(locator =>
    locator.repositoryId === 'primary' && !locator.artifactId).path,
  'docs/requirements.md');
  assert.equal(manifest.artifacts.find(locator =>
    locator.repositoryId === 'gamma').path, 'docs/requirements.md');

  const beforeDuplicate = structuredClone(manifest.artifacts);
  await registerArtifact(f.store, {
    workItemId: f.workItemId,
    role: 'requirements',
    repositoryId: 'beta',
    path: replacement,
  });
  assert.deepEqual((await f.store.manifest(f.workItemId)).manifest.artifacts,
    beforeDuplicate);
  await assert.rejects(registerArtifact(f.store, {
    workItemId: f.workItemId,
    role: 'test-plan',
    repositoryId: 'beta',
    artifactId: 'duplicate-path',
    path: replacement,
  }), { code: 'ARTIFACT' });

  const currentStatus = await status(f.store, f.workItemId);
  assert.equal(currentStatus.artifacts.filter(locator =>
    locator.role === 'requirements').length, 5);
  assert.ok(currentStatus.artifacts.every(locator => locator.repositoryId));
  await registerArtifact(f.store, {
    workItemId: f.workItemId,
    role: 'requirements',
    repositoryId: 'gamma',
    artifactId: 'planned',
    path: 'docs/requirements-planned.md',
    planned: true,
  });
  const resumed = await resume(f.store, {
    cwd: f.repo,
    sessionId: f.sessionId,
    workItemId: f.workItemId,
  });
  assert.equal(resumed.artifacts.filter(locator =>
    locator.role === 'requirements').length, 6);
  assert.ok(resumed.artifacts.some(locator =>
    locator.repositoryId === 'gamma' &&
    locator.artifactId === 'planned' &&
    locator.state === 'pending' &&
    locator.planned === true));
  assert.equal(new Set(resumed.artifacts.map(locator =>
    locator.repositoryId)).size, 3);
});

test('T-45 approvals snapshot every repository artifact and external rebinding', async t => {
  const f = await fixture(t);
  const beta = await member(f, 'beta');
  await document(f.repo, 'docs/requirements.md',
    requirement('FR-201', 'primary approval'));
  await document(beta, 'docs/requirements.md',
    requirement('FR-202', 'beta approval'));
  for (const [repositoryId, root] of [['primary', f.repo], ['beta', beta]]) {
    await registerArtifact(f.store, {
      workItemId: f.workItemId,
      role: 'requirements',
      repositoryId,
      path: path.relative(root, path.join(root, 'docs/requirements.md')),
    });
  }
  await document(f.repo, 'docs/requirements-domain.md',
    requirement('FR-204', 'primary domain approval'));
  await registerArtifact(f.store, {
    workItemId: f.workItemId,
    role: 'requirements',
    repositoryId: 'primary',
    artifactId: 'domain',
    path: 'docs/requirements-domain.md',
  });
  const pending = await prepareDecision(f.store, {
    workItemId: f.workItemId,
    sessionId: f.sessionId,
    kind: 'approval',
    effect: { transition: { from: 'requirements', to: 'test-design' } },
  });
  assert.equal(pending.snapshots.length, 3);
  assert.deepEqual(pending.snapshots.map(snapshot => snapshot.locator).sort(),
    ['beta:docs/requirements.md', 'primary:docs/requirements.md',
      'primary:domain:docs/requirements-domain.md']);

  await fs.writeFile(path.join(beta, 'docs/requirements.md'),
    requirement('FR-202', 'changed beta approval'));
  const receipt = await captureReceipt(f.store, {
    sessionId: f.sessionId,
    source: 'userPromptSubmitted',
    input: 'Approve the multi-repository Requirements.',
  });
  await assert.rejects(applyDecision(f.store, {
    workItemId: f.workItemId,
    sessionId: f.sessionId,
    decisionId: pending.id,
    receiptId: receipt.id,
    input: 'Approve the multi-repository Requirements.',
  }), { code: 'STALE' });

  const externalOne = path.join(f.root, 'external one.md');
  const externalTwo = path.join(f.root, 'external two.md');
  await fs.writeFile(externalOne, requirement('FR-203', 'external approval'));
  await fs.writeFile(externalTwo, requirement('FR-203', 'external approval'));
  const permissionOne = await grant(f, 'permission', {
    grant: 'artifact-location',
    target: externalOne,
  });
  const permissionTwo = await grant(f, 'permission', {
    grant: 'artifact-location',
    target: externalTwo,
  });
  await registerArtifact(f.store, {
    workItemId: f.workItemId,
    role: 'requirements',
    repositoryId: 'primary',
    externalPath: externalOne,
    authorizationId: permissionOne.event.id,
  });
  const externalPending = await prepareDecision(f.store, {
    workItemId: f.workItemId,
    sessionId: f.sessionId,
    id: 'decision-external-rebind',
    kind: 'approval',
    effect: { transition: { from: 'requirements', to: 'test-design' } },
  });
  await assert.rejects(registerArtifact(f.store, {
    workItemId: f.workItemId,
    role: 'requirements',
    repositoryId: 'primary',
    externalPath: externalTwo,
    authorizationId: permissionTwo.event.id,
  }, {
    fault: async stage => {
      if (stage === 'before-manifest') throw new Error('interrupted external replacement');
    },
  }), /interrupted external replacement/u);
  const beforeReplacement = await f.store.manifest(f.workItemId);
  const primaryExternal = beforeReplacement.manifest.artifacts.find(locator =>
    locator.role === 'requirements' &&
    locator.repositoryId === 'primary' &&
    locator.kind === 'external-file');
  assert.equal(await artifactPath(f.store, f.workItemId, primaryExternal,
    beforeReplacement.metadata), externalOne);
  assert.equal((await f.store.records(f.workItemId))
    .filter(record => record.type === 'locator').length, 1);
  await assert.rejects(registerArtifact(f.store, {
    workItemId: f.workItemId,
    role: 'requirements',
    repositoryId: 'primary',
    externalPath: externalTwo,
    authorizationId: permissionTwo.event.id,
  }, {
    fault: async stage => {
      if (stage === 'after-manifest') throw new Error('manifest committed before response');
    },
  }), /manifest committed before response/u);
  const committedReplacement = await f.store.manifest(f.workItemId);
  const committedExternal = committedReplacement.manifest.artifacts.find(locator =>
    locator.role === 'requirements' &&
    locator.repositoryId === 'primary' &&
    locator.kind === 'external-file');
  assert.equal(await artifactPath(f.store, f.workItemId, committedExternal,
    committedReplacement.metadata), externalTwo);
  assert.equal((await f.store.records(f.workItemId))
    .filter(record => record.type === 'locator').length, 2);
  await registerArtifact(f.store, {
    workItemId: f.workItemId,
    role: 'requirements',
    repositoryId: 'primary',
    externalPath: externalTwo,
    authorizationId: permissionTwo.event.id,
  });
  assert.equal((await f.store.records(f.workItemId))
    .filter(record => record.type === 'locator').length, 1);
  const externalReceipt = await captureReceipt(f.store, {
    sessionId: f.sessionId,
    source: 'userPromptSubmitted',
    input: 'Approve the external Requirements binding.',
  });
  await assert.rejects(applyDecision(f.store, {
    workItemId: f.workItemId,
    sessionId: f.sessionId,
    decisionId: externalPending.id,
    receiptId: externalReceipt.id,
    input: 'Approve the external Requirements binding.',
  }), { code: 'STALE' });

  const repoAB = await member(f, 'a-b');
  const repoA = await member(f, 'a');
  void repoAB;
  void repoA;
  const collisionOne = path.join(f.root, 'collision one.md');
  const collisionTwo = path.join(f.root, 'collision two.md');
  await fs.writeFile(collisionOne, '# Design one\n');
  await fs.writeFile(collisionTwo, '# Design two\n');
  const collisionPermissionOne = await grant(f, 'permission', {
    grant: 'artifact-location',
    target: collisionOne,
  });
  const collisionPermissionTwo = await grant(f, 'permission', {
    grant: 'artifact-location',
    target: collisionTwo,
  });
  const firstCollision = await registerArtifact(f.store, {
    workItemId: f.workItemId,
    role: 'technical-design',
    repositoryId: 'a-b',
    artifactId: 'c',
    externalPath: collisionOne,
    authorizationId: collisionPermissionOne.event.id,
  });
  const secondCollision = await registerArtifact(f.store, {
    workItemId: f.workItemId,
    role: 'technical-design',
    repositoryId: 'a',
    artifactId: 'b-c',
    externalPath: collisionTwo,
    authorizationId: collisionPermissionTwo.event.id,
  });
  assert.notEqual(firstCollision.locatorId, secondCollision.locatorId);
  const collisionManifest = await f.store.manifest(f.workItemId);
  assert.equal(await artifactPath(f.store, f.workItemId, firstCollision,
    collisionManifest.metadata), collisionOne);
  assert.equal(await artifactPath(f.store, f.workItemId, secondCollision,
    collisionManifest.metadata), collisionTwo);
});

test('T-45 multiple Test Plans combine and synchronize without changing legacy identity', async t => {
  const legacy = await coding(await fixture(t));
  const first = await startCycle(legacy.store, {
    workItemId: legacy.workItemId,
    configDigest: 'legacy-v1',
    cause: 'single-plan compatibility',
  });
  const legacyContents = await fs.readFile(path.join(legacy.repo,
    'docs/test-plan.md'), 'utf8');
  assert.equal(first.cycle.testSpecDigest, digest({
    tests: testSpecificationDigest(first.cycle.tests),
    plan: testSpecificationDigest(legacyContents),
  }));
  assert.equal(await currentTestSpecification(legacy.store, legacy.workItemId),
    first.cycle.testSpecDigest);
  assert.deepEqual((await snapshots(legacy.store, legacy.workItemId,
    ['requirements', 'test-plan', 'technical-design']))
    .map(snapshot => snapshot.role),
  ['requirements', 'test-plan', 'technical-design']);
  await recordTest(legacy.store, {
    workItemId: legacy.workItemId,
    cycleId: first.cycle.id,
    testId: 'T-unit',
    status: 'Passed',
    expectedMet: true,
    evidenceRef: 'fixture:legacy-unit',
    owner: 'agent',
    host: 'local',
  });
  const legacyBeta = await member(legacy, 'legacy-beta');
  await registerArtifact(legacy.store, {
    workItemId: legacy.workItemId,
    role: 'test-plan',
    repositoryId: 'legacy-beta',
    path: 'docs/test-plan.md',
    planned: true,
  });
  const pendingPlanResume = await resume(legacy.store, {
    cwd: legacy.repo,
    sessionId: legacy.sessionId,
    workItemId: legacy.workItemId,
  });
  assert.ok(pendingPlanResume.artifacts.some(item =>
    item.repositoryId === 'legacy-beta' &&
    item.role === 'test-plan' &&
    (item.digest === 'pending' || item.state === 'pending')));
  let pendingPlanState = await legacy.store.load(legacy.workItemId);
  assert.equal(currentCycle(pendingPlanState.records,
    pendingPlanState.checkpoint).id, first.cycle.id);
  assert.equal(currentCycle(pendingPlanState.records,
    pendingPlanState.checkpoint).assuranceInvalidated, true);
  await document(legacyBeta, 'docs/test-plan.md',
    plan('T-legacy-beta', 'FR-001', 'Secondary legacy behavior passes'));
  await registerArtifact(legacy.store, {
    workItemId: legacy.workItemId,
    role: 'test-plan',
    repositoryId: 'legacy-beta',
    path: 'docs/test-plan.md',
  });
  await resume(legacy.store, {
    cwd: legacy.repo,
    sessionId: legacy.sessionId,
    workItemId: legacy.workItemId,
  });
  const expandedLegacy = await legacy.store.load(legacy.workItemId);
  const expandedCycle = currentCycle(expandedLegacy.records,
    expandedLegacy.checkpoint);
  assert.notEqual(expandedCycle.id, first.cycle.id);
  assert.deepEqual(expandedCycle.tests.map(item => item.id).sort(),
    ['T-dev', 'T-integration', 'T-legacy-beta', 'T-staging', 'T-unit']);
  assert.equal(expandedCycle.results['T-unit'], undefined);

  const f = await fixture(t);
  const beta = await member(f, 'beta');
  for (const [repositoryId, root, requirementId] of [
    ['primary', f.repo, 'FR-301'],
    ['beta', beta, 'FR-302'],
  ]) {
    await document(root, 'docs/requirements.md',
      requirement(requirementId, `${repositoryId} combined plan`));
    await registerArtifact(f.store, {
      workItemId: f.workItemId,
      role: 'requirements',
      repositoryId,
      path: 'docs/requirements.md',
    });
  }
  await grant(f, 'approval', {
    transition: { from: 'requirements', to: 'test-design' },
  }, { prepared: true });
  await document(f.repo, 'docs/test-plan.md',
    plan('T-primary', 'FR-301', 'Primary behavior passes'));
  await document(beta, 'docs/test-plan.md',
    plan('T-beta', 'FR-302', 'Beta behavior passes'));
  for (const [repositoryId] of [['primary'], ['beta']]) {
    await registerArtifact(f.store, {
      workItemId: f.workItemId,
      role: 'test-plan',
      repositoryId,
      path: 'docs/test-plan.md',
    });
  }
  await document(f.repo, 'docs/test-plan-integration.md',
    plan('T-primary-integration', 'FR-301',
      'Primary integration behavior passes'));
  await registerArtifact(f.store, {
    workItemId: f.workItemId,
    role: 'test-plan',
    repositoryId: 'primary',
    artifactId: 'integration',
    path: 'docs/test-plan-integration.md',
  });
  assert.equal((await check(f.store, f.workItemId, 'artifacts')).exitCode, 0);
  const specification = await resolveTestSpecification(f.store, f.workItemId);
  assert.deepEqual(specification.tests.map(item => item.id).sort(),
    ['T-beta', 'T-primary', 'T-primary-integration']);
  assert.equal(specification.plans.length, 3);

  const testDesignPending = await prepareDecision(f.store, {
    workItemId: f.workItemId,
    sessionId: f.sessionId,
    kind: 'approval',
    effect: { transition: { from: 'test-design', to: 'technical-design' } },
  });
  assert.equal(testDesignPending.snapshots.filter(snapshot =>
    snapshot.role === 'test-plan').length, 3);
  await grant(f, 'approval', {
    transition: { from: 'test-design', to: 'technical-design' },
  }, { prepared: true });
  for (const [repositoryId, root] of [['primary', f.repo], ['beta', beta]]) {
    await document(root, 'docs/technical-design.md',
      `# Technical Design\nDesign for ${repositoryId}.\n`);
    await registerArtifact(f.store, {
      workItemId: f.workItemId,
      role: 'technical-design',
      repositoryId,
      path: 'docs/technical-design.md',
    });
  }
  await document(f.repo, 'docs/technical-design-security.md',
    '# Technical Design\nSecurity design for primary.\n');
  await registerArtifact(f.store, {
    workItemId: f.workItemId,
    role: 'technical-design',
    repositoryId: 'primary',
    artifactId: 'security',
    path: 'docs/technical-design-security.md',
  });
  const technicalPending = await prepareDecision(f.store, {
    workItemId: f.workItemId,
    sessionId: f.sessionId,
    kind: 'approval',
    effect: { transition: { from: 'technical-design', to: 'coding' } },
  });
  assert.equal(technicalPending.snapshots.filter(snapshot =>
    snapshot.role === 'technical-design').length, 3);
  await grant(f, 'approval', {
    transition: { from: 'technical-design', to: 'coding' },
  }, { prepared: true });
  assert.equal((await check(f.store, f.workItemId, 'artifacts')).exitCode, 0);
  const { cycle } = await startCycle(f.store, {
    workItemId: f.workItemId,
    configDigest: 'combined-v1',
    cause: 'combined member plans',
  });
  assert.deepEqual(cycle.tests.map(item => item.id).sort(),
    ['T-beta', 'T-primary', 'T-primary-integration']);
  await recordTest(f.store, {
    workItemId: f.workItemId,
    cycleId: cycle.id,
    testId: 'T-primary',
    status: 'Passed',
    expectedMet: true,
    evidenceRef: 'fixture:primary',
    owner: 'agent',
    host: 'local',
  });
  assert.match(await fs.readFile(path.join(f.repo, 'docs/test-plan.md'), 'utf8'),
    /T-primary.*Passed/u);
  assert.match(await fs.readFile(path.join(beta, 'docs/test-plan.md'), 'utf8'),
    /T-beta.*NotRun/u);
  assert.match(await fs.readFile(path.join(f.repo,
    'docs/test-plan-integration.md'), 'utf8'),
  /T-primary-integration.*NotRun/u);
  const multiResume = await resume(f.store, {
    cwd: f.repo,
    sessionId: f.sessionId,
    workItemId: f.workItemId,
  });
  assert.equal(multiResume.artifacts.length, 8);
});

test('T-45 external Test Plan status refresh keeps specification identity and bounded mappings', async t => {
  const f = await fixture(t);
  await document(f.repo, 'docs/requirements.md',
    requirement('FR-401', 'external plan requirements'));
  await registerArtifact(f.store, {
    workItemId: f.workItemId,
    role: 'requirements',
    repositoryId: 'primary',
    path: 'docs/requirements.md',
  });
  await grant(f, 'approval', {
    transition: { from: 'requirements', to: 'test-design' },
  }, { prepared: true });

  const externalA = path.join(f.root, 'external plan a.md');
  const externalB = path.join(f.root, 'external plan b.md');
  await fs.writeFile(externalA,
    plan('T-external-a', 'FR-401', 'External A passes'));
  await fs.writeFile(externalB,
    plan('T-external-b', 'FR-401', 'External B passes'));
  const permissionA = await grant(f, 'permission', {
    grant: 'artifact-location',
    target: externalA,
  });
  const permissionB = await grant(f, 'permission', {
    grant: 'artifact-location',
    target: externalB,
  });
  await registerArtifact(f.store, {
    workItemId: f.workItemId,
    role: 'test-plan',
    repositoryId: 'primary',
    artifactId: 'external-a',
    externalPath: externalA,
    authorizationId: permissionA.event.id,
  });
  await registerArtifact(f.store, {
    workItemId: f.workItemId,
    role: 'test-plan',
    repositoryId: 'primary',
    artifactId: 'external-b',
    externalPath: externalB,
    authorizationId: permissionB.event.id,
  });
  const before = await resolveTestSpecification(f.store, f.workItemId);
  await fs.writeFile(externalA, (await fs.readFile(externalA, 'utf8'))
    .replace('NotRun', 'Passed'));
  await registerArtifact(f.store, {
    workItemId: f.workItemId,
    role: 'test-plan',
    repositoryId: 'primary',
    artifactId: 'external-a',
    externalPath: externalA,
    authorizationId: permissionA.event.id,
  });
  const after = await resolveTestSpecification(f.store, f.workItemId);
  assert.equal(after.digest, before.digest);
  assert.equal((await f.store.records(f.workItemId))
    .filter(record => record.type === 'locator').length, 2);
});

test('T-45 compact resume groups large valid artifact inventories without blocking recovery', async t => {
  const f = await fixture(t);
  for (let index = 0; index < 12; index++) {
    await registerArtifact(f.store, {
      workItemId: f.workItemId,
      role: 'requirements',
      repositoryId: 'primary',
      artifactId: `planned-${index}`,
      path: `docs/requirements-${index}.md`,
      planned: true,
    });
  }
  const result = await resume(f.store, {
    cwd: f.repo,
    sessionId: f.sessionId,
    workItemId: f.workItemId,
  });
  assert.equal(result.artifacts, undefined);
  assert.equal(result.artifactSummary.count, 12);
  assert.equal(result.artifactSummary.pending, 12);
  assert.match(result.artifactSummary.inventoryDigest, /^[a-f0-9]{64}$/u);
  assert.equal((await f.store.load(f.workItemId)).recoveryRequired, false);
});

test('T-45 snapshot-bearing approvals support multiple documents beyond 4 KiB', async t => {
  const f = await fixture(t);
  for (let index = 0; index < 4; index++) {
    await document(f.repo, `docs/requirements-${index}.md`,
      requirement(`FR-5${index}1`, `requirements ${index}`));
    await registerArtifact(f.store, {
      workItemId: f.workItemId,
      role: 'requirements',
      repositoryId: 'primary',
      artifactId: `requirements-${index}`,
      path: `docs/requirements-${index}.md`,
    });
  }
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Commit multiple Requirements documents');
  await grant(f, 'approval', {
    transition: { from: 'requirements', to: 'test-design' },
  }, { prepared: true });
  for (let index = 0; index < 4; index++) {
    await document(f.repo, `docs/test-plan-${index}.md`,
      plan(`T-plan-${index}`, `FR-5${index}1`, `Plan ${index} passes`));
    await registerArtifact(f.store, {
      workItemId: f.workItemId,
      role: 'test-plan',
      repositoryId: 'primary',
      artifactId: `plan-${index}`,
      path: `docs/test-plan-${index}.md`,
    });
  }
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Commit multiple Test Plan documents');
  await grant(f, 'approval', {
    transition: { from: 'test-design', to: 'technical-design' },
  }, { prepared: true });
  for (let index = 0; index < 4; index++) {
    await document(f.repo, `docs/technical-design-${index}.md`,
      `# Technical Design\nDesign ${index}.\n`);
    await registerArtifact(f.store, {
      workItemId: f.workItemId,
      role: 'technical-design',
      repositoryId: 'primary',
      artifactId: `design-${index}`,
      path: `docs/technical-design-${index}.md`,
    });
  }
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Commit multiple Technical Design documents');
  const pending = await prepareDecision(f.store, {
    workItemId: f.workItemId,
    sessionId: f.sessionId,
    kind: 'approval',
    effect: { transition: { from: 'technical-design', to: 'coding' } },
  });
  assert.equal(pending.snapshots.length, 12);
  assert.ok(byteSize(pending) > 4096);
  const approval = await grant(f, 'approval', {
    transition: { from: 'technical-design', to: 'coding' },
  }, { prepared: true });
  const trailers = formatEvents([approval.event]);
  assert.deepEqual(parseEvents(trailers, f.workItemId)
    .map(event => event.id), [approval.event.id]);
  assert.equal((await f.store.load(f.workItemId)).checkpoint.phase, 'coding');
});
