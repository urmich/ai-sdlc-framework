export const validationDeclarations = {
  "schemaVersion": 1,
  "groups": [{
    "root": "complete functional per-case reports obey unit prerequisites and full aggregate coverage",
    "minimumSlots": 7
  }, {
    "root": "published references are fresh-checked after cache use and missing/corrupt pages cannot become success",
    "minimumSlots": 6
  }],
  "applicability": [{
    "names": ["complete functional per-case reports obey unit prerequisites and full aggregate coverage"],
    "platforms": ["linux-x64", "windows-x64", "macos-arm64", "macos-x64"],
    "owner": "catalog-resource-contract",
    "reason": "PR-only functional catalog integration root. Reserve its worker, CLI and five concurrent candidate-snapshot Git readers; direct fixture arithmetic and sequential Git setup require fewer slots. Preserve all original assertions and deadlines; no critical promotion or hosted process-peak/timing claim.",
    "prerequisites": ["Node, Git and seven aggregate worker slots; owned repository-local repository and Copilot home"]
  }, {
    "names": ["published references are fresh-checked after cache use and missing/corrupt pages cannot become success"],
    "platforms": ["linux-x64", "windows-x64", "macos-arm64", "macos-x64"],
    "owner": "catalog-service-contract",
    "reason": "PR-only owned producer/admission boundary. Real fixture execution and admission do not depend on an unused caller-authored report; starting the producer needs the bound working directory, not replay of prior outcomes. Immutable-page corruption and loss still fail closed at admission and fresh reload.",
    "prerequisites": ["Node, Git and six aggregate worker slots; owned repository-local repository and Copilot home"]
  }],
  "variants": [
    {"expression": "`delayed local operation preserves dispatch source A under selection B${interrupted ? ' through terminal recovery' : ''}`", "domains": {"interrupted ? ' through terminal recovery' : ''": ["", " through terminal recovery"]}},
    {"expression": "`Store STAGING equal-time ${outcomes.join('/')} stays Failed after reload and delayed older events`", "domains": {"outcomes.join('/')": ["Failed/Passed", "Passed/Failed"]}},
    {"expression": "`${referenced ? 'referenced' : 'inline'} NotRun pending/running evidence keeps immutable dispatch source without completion credit`", "domains": {"referenced ? 'referenced' : 'inline'": ["inline", "referenced"]}},
    {"expression": "`${referenced ? 'referenced' : 'inline'} late progress cannot replace tied-time terminal Passed Failed or cancelled NotRun`", "domains": {"referenced ? 'referenced' : 'inline'": ["inline", "referenced"]}},
    {"expression": "`public automated ${count}-case cycle requires retained original proof regardless of inline storage`", "domains": {"count": ["2", "100", "101"]}},
    {"expression": "`public ${referenced ? 'referenced' : 'inline'} manual and semi-automated procedures retain their real owner and evidence contract`", "domains": {"referenced ? 'referenced' : 'inline'": ["inline", "referenced"]}}
  ]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { artifact, cli, coding, completeReview, fixture, fixtureArtifact, fixtureBuild,
  fixtureDeployment, finishFixtureOperation, grant, observeFixtureRepository, orient,
  executeFixtureReadiness, recordFixtureTest, recordFixtureTests, registerFixtureProviderRequest } from './helpers.mjs';
import { registerArtifact, parseTestPlan, resolveTestSpecification } from '../src/artifacts.mjs';
import { startCycle, recordReadiness, recordTest, recordTests, stagingHandoff } from '../src/validation.mjs';
import { applicableOverride, currentCycle, currentTestEvidence, hasStagingCompletion, stagePassed } from '../src/authority.mjs';
import { cycleTests, flushValidationObjects, readValidationObject, stageValidationObject, validationObjectPath } from '../src/validation-catalog.mjs';
import { appendTestObservation, testHistory, cycleResultIds, initializeReferencedCycle, readTestEvidence, testResetDigest, retainTestEvidence } from '../src/validation-evidence.mjs';
import { claimOperationDispatch, prepareOperation, markDispatching, recordOperation, pruneWork } from '../src/operations.mjs';
import { status, resume } from '../src/recovery.mjs';
import { byteSize, digest, LIMITS } from '../src/core.mjs';
import { check } from '../src/checks.mjs';
import { bridgeFixture } from './fixtures/github-store-bridge.mjs';
import { Store } from '../src/store.mjs';
import { formatAudit, recordAudit } from '../src/audit.mjs';

function catalogFixturePlan() {
  return JSON.stringify({ tests: Array.from({ length: 6 }, (_, index) => ({
    id: `T-catalog-${index}`,
    environment: 'local',
    level: index < 2 ? 'unit' : index < 4 ? 'integration' :
      index < 5 ? 'review' : 'regression',
    checkpoint: index < 4 ? 'pre-review' : index < 5 ? 'review' : 'post-review',
    mode: 'automated', owner: 'agent', location: 'local',
    implementation: 'test/catalog-fixture.mjs',
    expected: `Independently accounted catalog fixture case ${index}`,
    status: 'NotRun',
  })) });
}

async function referenceFixtureCycle(f) {
  const specification = await resolveTestSpecification(f.store, f.workItemId);
  await f.store.transaction(f.workItemId, tx => {
    const cycle = currentCycle(tx.all(), tx.checkpoint);
    initializeReferencedCycle(tx, cycle, specification);
    tx.put(cycle);
  });
  const state = await f.store.load(f.workItemId);
  return currentCycle(state.records, state.checkpoint);
}

async function largeFixture(t, contents) {
  const referenced = contents === undefined;
  contents ??= catalogFixturePlan();
  const f = await coding(await fixture(t));
  if (contents.trimStart().startsWith('{')) {
    const plan = JSON.parse(contents);
    plan.tests = plan.tests.map(test => ({ ...test,
      requirements: ['FR-001'], conditions: ['AC-001.1'] }));
    contents = JSON.stringify(plan);
  }
  const relative = await artifact(f, 'test-plan', contents);
  await registerArtifact(f.store, { workItemId: f.workItemId, role: 'test-plan',
    repositoryId: 'primary', path: relative });
  await fs.writeFile(path.join(f.repo, 'source.mjs'), 'export const fixture = true;\n');
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Isolated catalog fixture');
  const started = await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: digest('fixture-config'), cause: 'Functional catalog fixture, not real GitHub acceptance' });
  return { ...f, cycle: referenced ? await referenceFixtureCycle(f) : started.cycle };
}
async function report(f, cycle, tests, statuses = {}) {
  const state = await f.store.load(f.workItemId);
  const current = currentCycle(state.records, state.checkpoint);
  const cases = tests.map(definition => {
    assert.match(definition.id, /^T-/u);
    assert.ok(definition.expected.length > 0);
    const outcome = statuses[definition.id] ?? 'Passed';
    return { testId: definition.id, status: outcome, expectedMet: outcome === 'Passed',
      resetDigest: testResetDigest(current, definition.id),
      expectedDigest: digest(definition.expected),
      assertions: [{ name: `Isolated report fixture for ${definition.id}`, passed: outcome === 'Passed' }] };
  });
  const file = path.join(f.root, `execution-${digest(cases).slice(0, 16)}.json`);
  await fs.writeFile(file, JSON.stringify({ cycleId: cycle.id, candidateDigest: cycle.candidateDigest,
    testSpecDigest: cycle.testSpecDigest, configDigest: cycle.configDigest,
    executionSources: cycle.sources, cases, password: 'fixture-do-not-retain' }));
  return { file, evidenceRef: pathToFileURL(file).href };
}
async function submit(f, cycle, tests, statuses = {}) {
  await recordFixtureTests(f.store, cycle, tests, statuses);
}
async function localOperation(f, cycle, testId, correlationKey) {
  return (await prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId,
    action: { class: 'test', repositoryId: 'primary', environment: 'local',
      testId, owner: 'agent', host: 'local', configDigest: cycle.configDigest },
    request: { toolName: 'fixture_test', toolArgs: { testId }, cwd: f.repo },
    correlationKey, intent: 'Execute one isolated local validation case' })).operation;
}
async function finishLocal(f, operation, evaluation) {
  const result = await recordOperation(f.store, { workItemId: f.workItemId, operationId: operation.id,
    status: 'succeeded', target: operation.target, requestFingerprint: operation.requestFingerprint,
    evidenceRef: `fixture:${operation.id}`, expectedMet: true });
  if (evaluation) await recordReadiness(f.store, { workItemId: f.workItemId,
    cycleId: operation.cycleId, evaluation,
    bindings: [{ testId: operation.action.testId, operationId: operation.id }] });
  else await recordFixtureTest(f.store, { workItemId: f.workItemId, cycleId: operation.cycleId,
    testId: operation.action.testId, operationId: operation.id, status: 'Passed',
    expectedMet: true, owner: 'agent', host: 'local', evidenceRef: `fixture:${operation.id}` });
  return result;
}

async function orderingFixture(t, modes) {
  const tests = modes.map((mode, index) => ({
    id: `T-order-unit-${index}`, environment: 'local', level: 'unit', checkpoint: 'pre-review',
    mode, owner: mode === 'automated' ? 'agent' : 'user',
    location: mode === 'automated' ? 'local' : 'procedure-host',
    implementation: 'procedure:owned-unit-observation', expected: 'Observed unit outcome matches the procedure',
    status: 'NotRun',
  }));
  tests.push({ id: 'T-order-integration', environment: 'local', level: 'integration',
    checkpoint: 'pre-review', mode: 'automated', owner: 'agent', location: 'local',
    implementation: 'node:owned-arithmetic-fixture', expected: 'Controlled arithmetic succeeds', status: 'NotRun' });
  const f = await largeFixture(t, JSON.stringify({ tests }));
  f.store.clock = Date;
  return { ...f, tests: cycleTests(f.cycle), integration: cycleTests(f.cycle).at(-1) };
}

test('F02 normalized scoped unit-first override preserves proof and current context', async t => {
  const f = await orderingFixture(t, ['automated']);
  const action = { class: 'test', repositoryId: 'primary', environment: 'local',
    testId: f.integration.id, owner: 'agent', host: 'local' };
  const override = await grant(f, 'override', {
    rules: ['unit-first'], reason: 'Authorize this independently executed integration before units',
    scope: { repositoryIds: ['primary'], actions: ['test'], environment: 'local', owner: 'agent', host: 'local' },
    lifetime: { kind: 'cycle', cycleId: f.cycle.id },
  });
  const state = await f.store.load(f.workItemId);
  assert.equal(applicableOverride(state.records, 'unit-first', action,
    { cycleId: f.cycle.id, clock: f.store.clock }).id, override.event.id);
  await assert.rejects(recordTest(f.store, { workItemId: f.workItemId, cycleId: f.cycle.id,
    testId: f.integration.id, status: 'Passed', expectedMet: true,
    owner: 'agent', host: 'local', evidenceRef: 'fixture:caller-asserted-pass' }), { code: 'EVIDENCE' });
  const evaluation = await executeFixtureReadiness(f.store, f.cycle, [f.integration]);
  assert.equal(evaluation.status, 'Passed');
  const result = await recordReadiness(f.store, { workItemId: f.workItemId,
    cycleId: f.cycle.id, evaluation });
  assert.equal(result.evidence[0].status, 'Passed');
  assert.deepEqual(result.blocked, []);
  const loaded = await f.store.load(f.workItemId);
  const cycle = currentCycle(loaded.records, loaded.checkpoint);
  assert.equal(currentTestEvidence(cycle, loaded.records, f.integration).status, 'Passed');
  assert.equal(currentTestEvidence(cycle, loaded.records, f.tests[0]), null);
  assert.equal(stagePassed(cycle, loaded.records, 'local'), false);
  await fs.writeFile(path.join(f.repo, 'source.mjs'), 'export const fixture = false;\n');
  const next = (await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: cycle.configDigest, cause: 'The old cycle override must not transfer' })).cycle;
  const currentEvaluation = await executeFixtureReadiness(f.store, next, [f.integration]);
  assert.equal(currentEvaluation.status, 'Passed');
  const blocked = await recordReadiness(f.store, { workItemId: f.workItemId,
    cycleId: next.id, evaluation: currentEvaluation });
  assert.equal(blocked.evidence[0].status, 'NotRun');
  assert.deepEqual(blocked.blocked.map(row => row.code), ['UNIT_FIRST']);
  await grant(f, 'override', { rules: ['unit-first'], reason: 'A different owner has a scoped exception',
    scope: { actions: ['test'], environment: 'local', owner: 'user' },
    lifetime: { kind: 'cycle', cycleId: next.id } });
  const mismatched = await recordReadiness(f.store, { workItemId: f.workItemId,
    cycleId: next.id, evaluation: currentEvaluation });
  assert.equal(mismatched.evidence[0].status, 'NotRun');
  assert.deepEqual(mismatched.blocked.map(row => row.code), ['UNIT_FIRST']);
});

test('F02 observed manual and semi-automated unit timing orders normalized integration', async t => {
  const f = await orderingFixture(t, ['manual', 'semi-automated']);
  const first = await executeFixtureReadiness(f.store, f.cycle, [f.integration]);
  assert.equal(first.status, 'Passed');
  const unknown = await recordReadiness(f.store, { workItemId: f.workItemId,
    cycleId: f.cycle.id, evaluation: first });
  assert.equal(unknown.evidence[0].status, 'NotRun');
  assert.deepEqual(unknown.blocked.map(row => row.code), ['UNIT_FIRST']);
  const observations = [];
  for (const unit of f.tests.slice(0, -1)) {
    const input = { workItemId: f.workItemId, cycleId: f.cycle.id, testId: unit.id,
      status: 'Passed', expectedMet: true, owner: unit.owner, host: unit.location,
      activity: 'complete', evidenceRef: `procedure:observed-${unit.id}` };
    await assert.rejects(recordTest(f.store, { ...input, host: 'different-host' }), { code: 'HOST' });
    observations.push(await recordTest(f.store, input));
  }
  assert.ok(observations.every(row => row.sourceCompletedAt === undefined));
  const late = await recordReadiness(f.store, { workItemId: f.workItemId,
    cycleId: f.cycle.id, evaluation: first });
  assert.equal(late.evidence[0].status, 'NotRun');
  assert.deepEqual(late.blocked.map(row => row.code), ['UNIT_FIRST']);
  const fresh = await executeFixtureReadiness(f.store, f.cycle, [f.integration]);
  assert.equal(fresh.status, 'Passed');
  const result = await recordReadiness(f.store, { workItemId: f.workItemId,
    cycleId: f.cycle.id, evaluation: fresh });
  assert.equal(result.evidence[0].status, 'Passed');
  assert.deepEqual(result.blocked, []);
  assert.ok(observations.every(row =>
    Date.parse(row.observedAt) <= Date.parse(result.evidence[0].sourceStartedAt)));
  const reopened = await new Store(f.home, { clock: Date }).ready();
  const loaded = await reopened.load(f.workItemId);
  const cycle = currentCycle(loaded.records, loaded.checkpoint);
  assert.equal(stagePassed(cycle, loaded.records, 'local'), true);
  for (const [index, unit] of f.tests.slice(0, -1).entries()) {
    const current = currentTestEvidence(cycle, loaded.records, unit);
    assert.equal(current.status, 'Passed');
    assert.equal(current.observedAt, observations[index].observedAt);
    assert.equal(current.owner, unit.owner);
    assert.equal(current.host, unit.location);
  }
  await fs.writeFile(path.join(f.repo, 'source.mjs'), 'export const fixture = false;\n');
  const next = (await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: cycle.configDigest, cause: 'Prior manual observations stay historical' })).cycle;
  await assert.rejects(recordReadiness(f.store, { workItemId: f.workItemId,
    cycleId: next.id, evaluation: fresh }), { code: 'EVIDENCE' });
  const state = await f.store.load(f.workItemId);
  assert.ok(f.tests.slice(0, -1).every(unit =>
    currentTestEvidence(currentCycle(state.records, state.checkpoint), state.records, unit) === null));
});

test('F02 caller-authored assertions cannot acquire automated credit through recording or retained replay', async t => {
  const tests = Array.from({ length: 2 }, (_, index) => ({
    id: `T-authored-${index}`, environment: 'local', level: 'unit', checkpoint: 'pre-review',
    mode: 'automated', owner: 'agent', location: 'local',
    implementation: 'test/unexecuted.mjs', expected: `Unexecuted assertion ${index}`, status: 'NotRun',
  }));
  const f = await largeFixture(t, JSON.stringify({ tests }));
  const authored = await report(f, f.cycle, tests);
  const rows = tests.map(definition => ({ testId: definition.id, status: 'Passed',
    expectedMet: true, owner: definition.owner, host: definition.location, evidenceRef: authored.evidenceRef }));
  await assert.rejects(recordTests(f.store, { workItemId: f.workItemId, cycleId: f.cycle.id,
    results: rows }), { code: 'EVIDENCE' });
  const retained = await retainTestEvidence(f.store, { workItemId: f.workItemId,
    evidenceRef: authored.evidenceRef });
  await assert.rejects(recordTest(f.store, { ...rows[0], workItemId: f.workItemId,
    cycleId: f.cycle.id, evidenceRef: retained.evidenceRef }), { code: 'EVIDENCE' });
  await f.store.transaction(f.workItemId, tx => {
    const selected = currentCycle(tx.all(), tx.checkpoint);
    for (const [index, definition] of tests.entries()) appendTestObservation(tx, selected, {
      type: 'test-evidence', id: `evidence-authored-${index}`, workItemId: f.workItemId,
      sequence: index + 1, cycleId: selected.id, testId: definition.id,
      candidateDigest: selected.candidateDigest, testSpecDigest: selected.testSpecDigest,
      configDigest: selected.configDigest, executionSources: selected.sources,
      executionSourceDigest: digest(selected.sources), retainedPayloadRef: retained.ref,
      environment: 'local', implementation: definition.implementation, status: 'Passed',
      expectedMet: true, owner: definition.owner, host: definition.location,
      evidenceRef: retained.evidenceRef, observedAt: new Date(f.clock.now()).toISOString(),
    });
    selected.lastEvidenceSequence = tests.length;
    tx.put(selected);
  });
  const fresh = await new Store(f.home, { clock: f.clock }).ready();
  const state = await fresh.load(f.workItemId);
  const selected = currentCycle(state.records, state.checkpoint);
  assert.equal(stagePassed(selected, state.records, 'local', f.clock), false);
  for (const definition of tests) {
    assert.equal(currentTestEvidence(selected, state.records, definition, f.clock), null);
    const history = await readTestEvidence(fresh, { workItemId: f.workItemId,
      cycleId: selected.id, testId: definition.id });
    assert.equal(history.status, 'NotRun');
    assert.equal(history.observations[0].status, 'Passed');
  }
});

// 100/101 exercise the actual public inline-storage boundary, not a workload target.
for (const count of [2, 100, 101]) {
  test(`public automated ${count}-case cycle requires retained original proof regardless of inline storage`, async t => {
    const tests = Array.from({ length: count }, (_, index) => ({
      id: `T-proof-${index}`, environment: 'local', level: index === 0 ? 'unit' : 'integration',
      checkpoint: 'pre-review', mode: 'automated', owner: 'agent', location: 'local',
      implementation: 'test/proof-fixture.mjs', expected: `Original outcome ${index}`, status: 'NotRun',
    }));
    const f = await largeFixture(t, JSON.stringify({ tests }));
    const cycle = f.cycle;
    assert.equal(cycle.storageVersion, count > 100 ? 2 : undefined);
    const input = { workItemId: f.workItemId, cycleId: cycle.id, testId: tests[0].id,
      status: 'Passed', expectedMet: true, owner: 'agent', host: 'local', evidenceRef: 'x' };
    const opaque = await cli(f, ['evidence', 'test', '--json', '--work-item', f.workItemId],
      { ...input, workItemId: undefined });
    assert.notEqual(opaque.code, 0, 'Opaque execution reference must not acquire managed credit');
    assert.equal(opaque.json.error.code, 'EVIDENCE');
    await assert.rejects(recordTest(f.store, { ...input, testId: tests[1].id }), { code: 'UNIT_FIRST' });
    const retained = await report(f, cycle, tests);
    await assert.rejects(recordTest(f.store, { ...input, evidenceRef: retained.evidenceRef,
      owner: 'user' }), { code: 'HOST' });
    const validReport = JSON.parse(await fs.readFile(retained.file, 'utf8'));
    for (const field of ['candidateDigest', 'testSpecDigest', 'configDigest', 'executionSources']) {
      await fs.writeFile(retained.file, JSON.stringify({ ...validReport,
        [field]: field === 'executionSources' ? [{ ...cycle.sources[0], contentDigest: digest('different source') }] :
          digest(`different ${field}`) }));
      await assert.rejects(recordTest(f.store, { ...input, evidenceRef: retained.evidenceRef }),
        { code: 'EVIDENCE' });
    }
    await submit(f, cycle, tests);
    const fresh = await new Store(f.home, { clock: f.clock }).ready();
    const assertReady = async () => {
      const state = await fresh.load(f.workItemId);
      const selected = currentCycle(state.records, state.checkpoint);
      assert.equal(stagePassed(selected, state.records, 'local', f.clock), true);
      assert.equal(currentTestEvidence(selected, state.records, tests[0], f.clock).status, 'Passed');
      return { state, selected };
    };
    const { state, selected } = await assertReady();
    const original = currentTestEvidence(selected, state.records, tests[0], f.clock);
    const file = validationObjectPath(fresh, f.workItemId, original.retainedPayloadRef);
    const bytes = await fs.readFile(file);
    await fs.unlink(retained.file);
    await assertReady();
    await fs.writeFile(file, '{"corrupt":true}');
    await assert.rejects(fresh.load(f.workItemId), { code: 'DIGEST' });
    await fs.writeFile(file, bytes);
    await assertReady();
    await fs.unlink(file);
    await assert.rejects(fresh.load(f.workItemId), { code: 'ENOENT' });
    await fs.writeFile(file, bytes);
    await fresh.transaction(f.workItemId, tx => {
      const value = JSON.parse(bytes);
      value.content.testId = 'T-different-case';
      const ref = stageValidationObject(tx, value);
      const selectedCycle = currentCycle(tx.all(), tx.checkpoint);
      const altered = { ...original, id: 'evidence-misbound-proof',
        sequence: selectedCycle.lastEvidenceSequence + 1, retainedPayloadRef: ref };
      appendTestObservation(tx, selectedCycle, altered);
      selectedCycle.lastEvidenceSequence = altered.sequence;
      tx.put(selectedCycle);
    });
    await assert.rejects(fresh.load(f.workItemId), { code: 'EVIDENCE' });
  });
}

for (const referenced of [false, true]) {
  test(`public ${referenced ? 'referenced' : 'inline'} manual and semi-automated procedures retain their real owner and evidence contract`, async t => {
    const tests = Array.from({ length: 2 }, (_, index) => ({
      id: `T-procedure-${index}`, environment: 'local', level: 'unit', checkpoint: 'pre-review',
      mode: index % 2 ? 'semi-automated' : 'manual', owner: index % 2 ? 'agent' : 'user',
      location: 'procedure-host', implementation: `Observe declared procedure ${index}`,
      expected: `Observed procedure outcome ${index}`, status: 'NotRun',
    }));
    const f = await largeFixture(t, JSON.stringify({ tests }));
    if (referenced) f.cycle = await referenceFixtureCycle(f);
    await recordTests(f.store, { workItemId: f.workItemId, cycleId: f.cycle.id,
      results: tests.map(definition => ({ testId: definition.id, status: 'Passed', expectedMet: true,
        owner: definition.owner, host: definition.location, evidenceRef: `procedure:${definition.id}` })) });
    const fresh = await new Store(f.home, { clock: f.clock }).ready();
    const state = await fresh.load(f.workItemId);
    const selected = currentCycle(state.records, state.checkpoint);
    assert.equal(stagePassed(selected, state.records, 'local', f.clock), true);
    for (const definition of tests) {
      const evidence = currentTestEvidence(selected, state.records, definition, f.clock);
      assert.equal(evidence.evidenceRef, `procedure:${definition.id}`);
      assert.equal(evidence.owner, definition.owner);
      assert.equal(evidence.retainedPayloadRef, undefined);
      assert.deepEqual(evidence.executionSources, selected.sources);
    }
    await assert.rejects(recordTest(f.store, { workItemId: f.workItemId, cycleId: f.cycle.id,
      testId: tests[0].id, status: 'Passed', expectedMet: true, owner: 'agent',
      host: 'procedure-host', evidenceRef: 'procedure:wrong-owner' }), { code: 'HOST' });
  });
}

test('public CLI and Store retain every functional NotRun slot in thin-cycle storage', async t => {
  const f = await largeFixture(t);
  const state = await f.store.load(f.workItemId);
  const cycle = currentCycle(state.records, state.checkpoint);
  assert.equal(cycle.storageVersion, 2);
  assert.equal(cycle.tests, undefined);
  assert.equal(cycle.results, undefined);
  const tests = cycleTests(cycle);
  assert.equal(tests.length, 6);
  assert.equal(tests.filter(item => item.level === 'unit').length, 2);
  assert.deepEqual(['pre-review', 'review', 'post-review'].map(checkpoint =>
    tests.filter(item => item.checkpoint === checkpoint).length), [4, 1, 1]);
  const root = await readValidationObject(f.store, f.workItemId, cycle.testOutcomeRef);
  assert.equal(root.pageRefs.length, 1);
  assert.equal((await readValidationObject(f.store, f.workItemId, root.pageRefs[0])).slots.length, 6);
  assert.ok(tests.every(item => currentTestEvidence(cycle, state.records, item) === null));
  assert.ok(byteSize(state.records) < LIMITS.workingSet);
  assert.ok(byteSize(state.checkpoint) < LIMITS.checkpoint);
  const started = await cli(f, ['cycle', 'start', '--json', '--work-item', f.workItemId],
    { configDigest: digest('fixture-config'), cause: 'CLI complete-catalog reuse' });
  assert.equal(started.code, 0, started.stderr);
  assert.equal(started.json.reset, false);
  assert.equal(started.json.cycle.id, cycle.id);
  const listed = await cli(f, ['status', '--json', '--work-item', f.workItemId,
    '--offset', '0', '--limit', '100']);
  assert.equal(listed.code, 0, listed.stderr);
  assert.equal(listed.json.inventory.tests.count, 6);
});

test('current canonical 133-case plan retains each core variant and separate execution checkpoint', async t => {
  const contents = await fs.readFile(path.resolve('docs', 'sdlc', 'github-integration', 'test-plan.md'), 'utf8');
  const f = await largeFixture(t, contents);
  const state = await f.store.load(f.workItemId);
  const cycle = currentCycle(state.records, state.checkpoint);
  const tests = cycleTests(cycle);
  assert.equal(tests.length, 133);
  assert.equal(tests.filter(item => item.level === 'unit').length, 65);
  assert.deepEqual(['pre-review', 'review', 'post-review'].map(checkpoint =>
    tests.filter(item => item.checkpoint === checkpoint).length), [128, 1, 4]);
  assert.ok(tests.every(item => currentTestEvidence(cycle, state.records, item) === null));
  const root = await readValidationObject(f.store, f.workItemId, cycle.testOutcomeRef);
  assert.equal(root.pageRefs.length, 3);
  assert.equal((await readValidationObject(f.store, f.workItemId, root.pageRefs[2])).slots.length, 5);
  const canonical = await resolveTestSpecification(f.store, f.workItemId);
  assert.deepEqual(new Set(tests.map(item => item.id)), new Set(canonical.tests.map(item => item.id)));
  assert.equal(tests.filter(item => /^T-GHB\d{2}$/u.test(item.id)).length, 36);
  for (let claim = 1; claim <= 22; claim++) {
    for (const variant of ['P', 'N', 'G', 'D']) {
      const testId = `T-GHC${String(claim).padStart(2, '0')}-${variant}`;
      const row = tests.find(item => item.id === testId);
      assert.ok(row, `Missing current canonical core variant ${testId}`);
      assert.equal(row.checkpoint, 'pre-review');
    }
  }
  assert.equal((await cli(f, ['status', '--json', '--work-item', f.workItemId,
    '--offset', '0', '--limit', '100'])).json.inventory.tests.count, 133);
  assert.ok(byteSize(state.records) < LIMITS.workingSet);
});

test('complete functional per-case reports obey unit prerequisites and full aggregate coverage', async t => {
  const f = await largeFixture(t);
  let state = await f.store.load(f.workItemId);
  let cycle = currentCycle(state.records, state.checkpoint);
  const tests = cycleTests(cycle);
  const units = tests.filter(item => item.checkpoint === 'pre-review' && item.level === 'unit');
  const other = tests.filter(item => item.checkpoint === 'pre-review' && item.level !== 'unit');
  const early = await report(f, cycle, [other[0]]);
  await assert.rejects(recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id,
    testId: other[0].id, status: 'Passed', expectedMet: true,
    owner: other[0].owner, host: other[0].location, evidenceRef: early.evidenceRef }), { code: 'UNIT_FIRST' });
  const unitReport = await report(f, cycle, units);
  const admitted = await cli(f, ['evidence', 'tests', '--json', '--work-item', f.workItemId], {
    cycleId: cycle.id, results: units.map(definition => ({
      testId: definition.id, status: 'Passed', expectedMet: true,
      evidenceRef: unitReport.evidenceRef, owner: definition.owner, host: definition.location,
    })),
  });
  assert.notEqual(admitted.code, 0);
  assert.equal(admitted.json.error.code, 'EVIDENCE');
  assert.equal((await recordFixtureTests(f.store, cycle, units)).evidence.length, units.length);
  state = await f.store.load(f.workItemId);
  cycle = currentCycle(state.records, state.checkpoint);
  const first = currentTestEvidence(cycle, state.records, units[0]);
  const repeated = await recordTest(f.store, { workItemId: f.workItemId,
    cycleId: cycle.id, testId: units[0].id, status: 'Passed', expectedMet: true,
    evidenceRef: first.evidenceRef, owner: units[0].owner, host: units[0].location });
  assert.equal(repeated.id, first.id);
  assert.equal(repeated.sequence, first.sequence);
  assert.equal(stagePassed(cycle, state.records, 'local'), false);
  await submit(f, cycle, other.slice(0, -1));
  state = await f.store.load(f.workItemId);
  assert.equal(stagePassed(currentCycle(state.records, state.checkpoint), state.records, 'local'), false);
  await submit(f, cycle, other.slice(-1));
  state = await f.store.load(f.workItemId);
  cycle = currentCycle(state.records, state.checkpoint);
  assert.equal(stagePassed(cycle, state.records, 'local'), true);
  assert.equal(Object.keys(cycleResultIds(cycle)).length, units.length + other.length);
  assert.equal(tests.filter(item => currentTestEvidence(cycle, state.records, item)?.status === 'Passed').length, units.length + other.length);
  assert.ok(tests.filter(item => item.checkpoint !== 'pre-review')
    .every(item => currentTestEvidence(cycle, state.records, item) === null));
  assert.equal(parseTestPlan(await fs.readFile(path.join(f.repo, 'docs', 'test-plan.md'), 'utf8'))
    .filter(item => item.status === 'Passed').length, units.length + other.length);
  const retained = testHistory(cycle, state.records, units[0].id)[0].retainedPayloadRef;
  const payload = await readValidationObject(f.store, f.workItemId, retained);
  assert.doesNotMatch(JSON.stringify(payload), /fixture-do-not-retain/u);
  await fs.unlink(unitReport.file);
  await pruneWork(f.store, f.workItemId);
  state = await f.store.load(f.workItemId);
  assert.equal(stagePassed(currentCycle(state.records, state.checkpoint), state.records, 'local'), true);
  assert.ok(byteSize(state.records) < LIMITS.workingSet);
  const checked = await check(f.store, f.workItemId, 'state');
  assert.equal(checked.exitCode, 0);
  assert.equal((await status(f.store, f.workItemId, { offset: 0, limit: 100 })).inventory.tests.count, tests.length);
});

test('immutable execution sources survive revision-only root replacement; content drift resets every slot', async t => {
  const f = await largeFixture(t);
  let state = await f.store.load(f.workItemId);
  let cycle = currentCycle(state.records, state.checkpoint);
  const unit = cycleTests(cycle).find(item => item.level === 'unit');
  await submit(f, cycle, [unit]);
  const original = cycle.sources[0].revision;
  const priorRoot = (await f.store.load(f.workItemId)).records.find(item => item.id === cycle.id).testOutcomeRef;
  await f.runGit('commit', '--allow-empty', '-qm', 'Same content, different selected revision');
  const selected = await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: cycle.configDigest, cause: 'Revision-only reselection' });
  assert.equal(selected.reset, false);
  state = await f.store.load(f.workItemId);
  cycle = currentCycle(state.records, state.checkpoint);
  assert.notEqual(cycle.testOutcomeRef.sha256, priorRoot.sha256);
  assert.notEqual(cycle.sources[0].revision, original);
  const result = currentTestEvidence(cycle, state.records, unit);
  assert.equal(result.status, 'Passed');
  assert.equal(result.executionSources[0].revision, original);
  assert.deepEqual(cycle.artifacts, {});
  assert.deepEqual(cycle.deployments, {});
  await fs.writeFile(path.join(f.repo, 'source.mjs'), 'export const fixture = false;\n');
  const changed = await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: cycle.configDigest, cause: 'Actual candidate change' });
  assert.equal(changed.reset, true);
  state = await f.store.load(f.workItemId);
  const next = currentCycle(state.records, state.checkpoint);
  assert.ok(cycleTests(next).every(item => currentTestEvidence(next, state.records, item) === null));
  await pruneWork(f.store, f.workItemId);
  assert.equal((await fs.stat(path.join(f.store.workPath(f.workItemId), 'evidence', `${cycle.id}.json`))).isFile(), true);
  const archived = await readTestEvidence(f.store, {
    workItemId: f.workItemId, cycleId: cycle.id, testId: unit.id,
  });
  assert.equal(archived.historicalOnly, true);
  assert.equal(archived.observations[0].executionSources[0].revision, original);
  assert.equal(archived.status, 'NotRun');
});

test('archived operations keep identity ownership and durable retest barriers reject late pre-reset passes', async t => {
  const f = await largeFixture(t);
  await orient(f);
  let state = await f.store.load(f.workItemId);
  let cycle = currentCycle(state.records, state.checkpoint);
  const unit = cycleTests(cycle).find(item => item.level === 'unit');
  const first = await localOperation(f, cycle, unit.id, 'first-unit');
  await markDispatching(f.store, f.workItemId, first.id);
  await finishLocal(f, first);
  await pruneWork(f.store, f.workItemId);
  assert.ok(!(await f.store.records(f.workItemId)).some(item => item.id === first.id));
  assert.equal((await localOperation(f, cycle, unit.id, 'first-unit')).status, 'succeeded');
  f.clock.advance(1);
  const second = await localOperation(f, cycle, unit.id, 'second-unit');
  let interrupted = false;
  f.store.fault = async point => {
    if (!interrupted && point === 'record:operation') {
      interrupted = true;
      throw new Error('Fixture interrupted between dispatch and cycle reset');
    }
  };
  await assert.rejects(markDispatching(f.store, f.workItemId, second.id), /between dispatch and cycle reset/u);
  f.store.fault = async () => {};
  await resume(f.store, { workItemId: f.workItemId, sessionId: f.sessionId, cwd: f.repo });
  state = await f.store.load(f.workItemId);
  cycle = currentCycle(state.records, state.checkpoint);
  assert.equal(currentTestEvidence(cycle, state.records, unit), null);
  const root = await readValidationObject(f.store, f.workItemId, cycle.testOutcomeRef);
  const page = await readValidationObject(f.store, f.workItemId, root.pageRefs[0]);
  assert.equal(page.slots.find(slot => slot.testId === unit.id).barrier.operationId, second.id);
  await assert.rejects(recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id,
    testId: unit.id, operationId: first.id, status: 'Passed', expectedMet: true,
    owner: unit.owner, host: unit.location, evidenceRef: 'fixture:late-old-operation' }), { code: 'STALE' });
  state = await f.store.load(f.workItemId);
  assert.equal(currentTestEvidence(currentCycle(state.records, state.checkpoint), state.records, unit), null);
});

test('published references are fresh-checked after cache use and missing/corrupt pages cannot become success', async t => {
  const f = await largeFixture(t);
  const state = await f.store.load(f.workItemId);
  const cycle = currentCycle(state.records, state.checkpoint);
  const root = await readValidationObject(f.store, f.workItemId, cycle.testOutcomeRef);
  const file = validationObjectPath(f.store, f.workItemId, root.pageRefs[0]);
  const bytes = await fs.readFile(file);
  await fs.writeFile(file, Buffer.from('{"corrupt":true}'));
  await assert.rejects(f.store.load(f.workItemId), { code: 'DIGEST' });
  await fs.writeFile(file, bytes);
  await f.store.load(f.workItemId);
  await fs.unlink(file);
  await assert.rejects(f.store.load(f.workItemId), { code: 'ENOENT' });
  const unit = cycleTests(cycle).find(test => test.level === 'unit');
  const evaluation = await executeFixtureReadiness(f.store, cycle, [unit]);
  assert.equal(evaluation.status, 'Passed');
  await assert.rejects(recordReadiness(f.store, {
    workItemId: f.workItemId, cycleId: cycle.id, evaluation,
  }), { code: 'ENOENT' });
  await fs.writeFile(file, bytes);
  const admitted = await recordReadiness(f.store, {
    workItemId: f.workItemId, cycleId: cycle.id, evaluation,
  });
  assert.equal(admitted.evidence.length, 1);
  assert.equal(admitted.evidence[0].status, 'Passed');
  const reopened = await new Store(f.home, { clock: f.clock }).ready();
  const current = await reopened.load(f.workItemId);
  const selected = currentCycle(current.records, current.checkpoint);
  assert.equal(currentTestEvidence(selected, current.records, unit, f.clock).status, 'Passed');
  assert.equal(Object.keys(cycleResultIds(selected)).length, 1);
  assert.equal(stagePassed(selected, current.records, 'local', f.clock), false);
  const nextUnit = cycleTests(selected).find(test => test.level === 'unit' && test.id !== unit.id);
  const originalWriteFile = fsPromises.writeFile;
  const restoreWriteFile = () => {
    fsPromises.writeFile = originalWriteFile;
    syncBuiltinESMExports();
  };
  t.after(restoreWriteFile);
  fsPromises.writeFile = async (target, ...args) => {
    if (typeof target === 'string' && path.dirname(target) === f.root &&
        /^execution-[a-f0-9]{16}\.json$/u.test(path.basename(target))) {
      throw Object.assign(new Error('An unused caller-authored report is not an execution prerequisite'),
        { code: 'UNUSED_FIXTURE_REPORT' });
    }
    return originalWriteFile(target, ...args);
  };
  syncBuiltinESMExports();
  try { await submit(f, selected, [nextUnit]); }
  finally { restoreWriteFile(); }
  const fresh = await reopened.load(f.workItemId);
  const recorded = currentCycle(fresh.records, fresh.checkpoint);
  assert.equal(currentTestEvidence(recorded, fresh.records, nextUnit, f.clock).status, 'Passed');
  assert.equal(Object.keys(cycleResultIds(recorded)).length, 2);
  assert.equal(stagePassed(recorded, fresh.records, 'local', f.clock), false);
});

test('immutable validation publication bounds overlap and drains ordered failures before later batches', async t => {
  const f = await fixture(t);
  const originalOpen = fsPromises.open;
  t.after(() => { fsPromises.open = originalOpen; syncBuiltinESMExports(); });
  for (const failure of ['none', 'flush', 'readback', 'fault', 'corrupt']) {
    const directory = path.join(f.root, `publication-${failure}`);
    const context = { validationObjects: new Map() };
    const refs = Array.from({ length: 9 }, (_, index) =>
      stageValidationObject(context, { kind: 'publication-fixture', workItemId: f.workItemId, index }));
    let active = 0;
    let maximum = 0;
    const entered = [];
    const completed = [];
    const faults = [];
    const flushed = [];
    let directoryFlushes = 0;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let ready;
    const allEntered = new Promise(resolve => { ready = resolve; });
    const store = { workPath: () => directory, fault: async point => {
      assert.equal(point, 'validation:object');
      assert.equal(active, 0, 'Every dispatched publication must settle before ordered fault replay');
      faults.push(point);
      if (failure === 'fault') throw new Error('First ordered publication fault');
    } };
    if (failure === 'corrupt') {
      const file = validationObjectPath(store, f.workItemId, refs[0]);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, 'corrupt-existing-object');
    }
    fsPromises.open = async (file, ...args) => {
      if (String(file) === path.join(directory, 'validation', 'objects')) directoryFlushes++;
      const handle = await originalOpen(file, ...args);
      const index = refs.findIndex(ref => path.basename(String(file)).startsWith(`.${ref.sha256}.json.`));
      if (index < 0) return handle;
      const originalSync = handle.sync.bind(handle);
      const originalClose = handle.close.bind(handle);
      const originalWrite = handle.writeFile.bind(handle);
      handle.writeFile = (contents, ...options) => originalWrite(
        failure === 'readback' && index === 1 ? 'corrupt-new-object' : contents, ...options);
      handle.sync = async () => {
        active++;
        maximum = Math.max(maximum, active);
        entered.push(index);
        if (entered.length === (failure === 'corrupt' ? 3 : 4)) ready();
        await gate;
        await originalSync();
        flushed.push(index);
        if (failure === 'flush' && [1, 2].includes(index)) throw new Error(`Flush failure ${index}`);
      };
      handle.close = async () => {
        try { return await originalClose(); }
        finally { if (!completed.includes(index)) { completed.push(index); active--; } }
      };
      return handle;
    };
    syncBuiltinESMExports();
    const pending = flushValidationObjects(store, f.workItemId, context);
    pending.catch(() => {});
    let timer;
    try {
      await Promise.race([allEntered, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Independent publications did not overlap')), 5000);
      })]);
    } finally {
      clearTimeout(timer);
      release();
      await pending.catch(() => {});
      fsPromises.open = originalOpen;
      syncBuiltinESMExports();
    }
    assert.equal(maximum, failure === 'corrupt' ? 3 : 4);
    assert.equal(active, 0);
    assert.deepEqual(new Set(completed), new Set(entered));
    assert.deepEqual(new Set(flushed), new Set(entered), 'Every owned file reaches its real durability flush');
    assert.equal(directoryFlushes, failure === 'flush' ? 2 : entered.length);
    if (failure === 'none') {
      await pending;
      assert.equal(entered.length, 9);
      assert.equal(faults.length, 9);
      for (const ref of refs) {
        assert.deepEqual(await fs.readFile(validationObjectPath(store, f.workItemId, ref)),
          context.validationObjects.get(ref.sha256));
      }
    } else {
      await assert.rejects(pending, failure === 'flush' ? /Flush failure 1/u :
        failure === 'fault' ? /First ordered publication fault/u : { code: 'DIGEST' });
      assert.equal(entered.length, failure === 'corrupt' ? 3 : 4);
      assert.equal(faults.length, ['flush', 'readback', 'fault'].includes(failure) ? 1 : 0);
      if (failure === 'corrupt') assert.equal(await fs.readFile(
        validationObjectPath(store, f.workItemId, refs[0]), 'utf8'), 'corrupt-existing-object');
    }
    assert.ok((await fs.readdir(path.join(directory, 'validation', 'objects')))
      .every(name => /^[a-f0-9]{64}\.json$/u.test(name)), 'All owned atomic-write temporaries are cleaned');
  }
});

test('retained execution payload persists no environment-secret or Cookie sentinel bytes', async t => {
  const f = await fixture(t);
  const file = path.join(f.root, 'execution-environment.txt');
  await fs.writeFile(file, 'AWS_SECRET_ACCESS_KEY=fixture-not-a-real-secret\n' +
    'Cookie: session=fixture-not-a-real-cookie\ncase T-one: Passed\n');
  const retained = await retainTestEvidence(f.store, {
    workItemId: f.workItemId, evidenceRef: pathToFileURL(file).href,
  });
  const persisted = await fs.readFile(validationObjectPath(f.store, f.workItemId, retained.ref), 'utf8');
  assert.doesNotMatch(persisted, /fixture-not-a-real-secret|fixture-not-a-real-cookie/u);
  assert.match(persisted, /case T-one: Passed/u);
});

for (const interrupted of [false, true]) {
  test(`delayed local operation preserves dispatch source A under selection B${interrupted ? ' through terminal recovery' : ''}`, async t => {
    const f = await largeFixture(t);
    const state = await f.store.load(f.workItemId);
    const cycle = currentCycle(state.records, state.checkpoint);
    const unit = cycleTests(cycle).find(item => item.level === 'unit');
    const sourceA = structuredClone(cycle.sources);
    const operation = await localOperation(f, cycle, unit.id, 'delayed-test-source-A');
    await markDispatching(f.store, f.workItemId, operation.id);
    const evaluation = await executeFixtureReadiness(f.store, cycle, [unit], {}, { operation });
    await f.runGit('commit', '--allow-empty', '-qm', 'Select B with unchanged candidate content');
    const selected = await startCycle(f.store, { workItemId: f.workItemId,
      configDigest: cycle.configDigest, cause: 'Reselect B before delayed test completion' });
    assert.equal(selected.reset, false);
    assert.notEqual(selected.cycle.sources[0].revision, sourceA[0].revision);
    if (interrupted) {
      f.store.fault = async point => {
        if (point === 'record:operation') throw new Error('Interrupted before terminal test projection');
      };
      await assert.rejects(finishLocal(f, operation, evaluation), /terminal test projection/u);
      f.store.fault = async () => {};
      await resume(f.store, { workItemId: f.workItemId, sessionId: f.sessionId, cwd: f.repo });
      const recovered = await f.store.load(f.workItemId);
      assert.equal(currentTestEvidence(currentCycle(recovered.records, recovered.checkpoint),
        recovered.records, unit), null);
      await recordReadiness(f.store, { workItemId: f.workItemId, cycleId: cycle.id,
        evaluation, bindings: [{ testId: unit.id, operationId: operation.id }] });
    } else await finishLocal(f, operation, evaluation);
    const reloaded = await f.store.load(f.workItemId);
    const current = currentCycle(reloaded.records, reloaded.checkpoint);
    const result = currentTestEvidence(current, reloaded.records, unit);
    assert.equal(result.status, 'Passed');
    assert.deepEqual(result.executionSources, sourceA);
    assert.equal(result.executionSourceDigest, digest(sourceA));
    assert.notEqual(current.sources[0].revision, sourceA[0].revision);
    await pruneWork(f.store, f.workItemId);
    const afterPrune = await f.store.load(f.workItemId);
    assert.deepEqual(currentTestEvidence(currentCycle(afterPrune.records, afterPrune.checkpoint),
      afterPrune.records, unit).executionSources, sourceA);
  });
}

test('object-publication failure cannot commit an orphan pass and checkpoint restart retains a complete root', async t => {
  const f = await largeFixture(t);
  let state = await f.store.load(f.workItemId);
  const cycle = currentCycle(state.records, state.checkpoint);
  const unit = cycleTests(cycle).find(item => item.level === 'unit');
  const priorRoot = cycle.testOutcomeRef.sha256;
  const evaluation = await executeFixtureReadiness(f.store, cycle, [unit]);
  let injected = false;
  f.store.fault = async point => {
    if (point === 'validation:object' && !injected) { injected = true; throw new Error('Fixture publication interruption'); }
  };
  await assert.rejects(recordReadiness(f.store, { workItemId: f.workItemId, cycleId: cycle.id,
    evaluation }), /publication interruption/u);
  f.store.fault = async () => {};
  state = await f.store.load(f.workItemId);
  assert.equal(currentCycle(state.records, state.checkpoint).testOutcomeRef.sha256, priorRoot);
  assert.equal(currentTestEvidence(currentCycle(state.records, state.checkpoint), state.records, unit), null);
  await submit(f, cycle, [unit]);
  const resumed = await resume(f.store, { workItemId: f.workItemId, sessionId: f.sessionId, cwd: f.repo });
  assert.equal(resumed.workItemId, f.workItemId);
  state = await f.store.load(f.workItemId);
  assert.equal(currentTestEvidence(currentCycle(state.records, state.checkpoint), state.records, unit).status, 'Passed');
  assert.equal((await resolveTestSpecification(f.store, f.workItemId)).tests.length, cycleTests(cycle).length);
});

async function stagingFixture(t) {
  const f = await coding(await fixture(t));
  const tests = Array.from({ length: 2 }, (_, index) => ({
    id: `T-unit-${index}`, environment: 'local', level: 'unit', checkpoint: 'pre-review',
    mode: 'automated', owner: 'agent', location: 'local',
    implementation: 'test/fixture.mjs', expected: `Unit fixture ${index}`, status: 'NotRun',
    requirements: ['FR-001'], conditions: ['AC-001.1'],
  }));
  tests.push({ id: 'T-staging', environment: 'STAGING', level: 'integration',
    checkpoint: 'STAGING', mode: 'automated', owner: 'user', location: 'authorized-machine',
    implementation: 'test/staging-fixture.mjs', expected: 'Deployment-bound fixture result', status: 'NotRun',
    requirements: ['FR-001'], conditions: ['AC-001.1'] });
  await fs.writeFile(path.join(f.repo, 'docs', 'test-plan.md'), JSON.stringify({ tests }));
  await registerArtifact(f.store, { workItemId: f.workItemId, role: 'test-plan',
    repositoryId: 'primary', path: 'docs/test-plan.md' });
  await fs.writeFile(path.join(f.repo, '.sdlc', 'config.json'), JSON.stringify({
    defaultBranch: 'refs/heads/main', environments: {
      DEV: { target: 'dev-target', configDigest: digest('fixture-config'), allowedStages: ['DEV'] },
      STAGING: { target: 'staging-target', configDigest: digest('fixture-config'), allowedStages: ['STAGING'],
        execution: { owner: 'user', locations: ['authorized-machine'] } },
    },
  }));
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Isolated deployment-bound catalog fixture');
  await observeFixtureRepository(f);
  await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: digest('fixture-config'), cause: 'Referenced STAGING fixture' });
  const cycle = await referenceFixtureCycle(f);
  const state = await f.store.load(f.workItemId);
  await submit(f, cycle, cycleTests(currentCycle(state.records, state.checkpoint))
    .filter(item => item.environment === 'local'));
  await completeReview(f, cycle);
  const binding = { cycleId: cycle.id, candidateDigest: cycle.candidateDigest,
    testSpecDigest: cycle.testSpecDigest, configDigest: cycle.configDigest };
  await grant(f, 'dev-authorization', { ...binding, target: 'dev-target', completedStage: 'review' });
  const devBuild = await fixtureBuild(f, cycle);
  const devArtifact = await fixtureArtifact(f, cycle, devBuild);
  const devDeployment = await fixtureDeployment(f, cycle, devArtifact, { target: 'dev-target' });
  await grant(f, 'override', { rules: ['dev-validation', 'dev-completion'],
    scope: { environment: 'STAGING' }, reason: 'Explicit isolated STAGING-only fixture progression' });
  await grant(f, 'staging-promotion', { ...binding, target: 'staging-target',
    completedStage: 'DEV', deploymentId: devDeployment.id });
  const build = await fixtureBuild(f, cycle, { environment: 'STAGING', target: 'staging-target' });
  const artifact = await fixtureArtifact(f, cycle, build, { environment: 'STAGING' });
  const deployment = await fixtureDeployment(f, cycle, artifact, { target: 'staging-target' });
  const handoff = await stagingHandoff(f.store, f.workItemId);
  assert.equal(handoff.tests.length, 1);
  assert.equal(handoff.deploymentId, deployment.id);
  const result = { ...binding, target: 'staging-target', deploymentId: deployment.id,
    artifactId: artifact.artifactId, testIds: ['T-staging'], owner: 'user', host: 'authorized-machine',
    evidenceRef: 'fixture:actual-captured-staging-results' };
  return { f, cycle, artifact, deployment, result };
}

test('F02 audited superseded STAGING receipt proof survives pruning and historical reads without current credit', async t => {
  const { f, cycle, artifact, deployment, result } = await stagingFixture(t);
  const first = await grant(f, 'staging-result', { ...result, outcome: 'Passed' });
  await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id, testId: 'T-staging',
    status: 'Passed', expectedMet: true, owner: 'user', host: 'authorized-machine',
    deploymentId: deployment.id, artifactId: artifact.artifactId,
    eventId: first.event.id, evidenceRef: 'fixture:original-staging-receipt' });
  f.clock.advance(1);
  const later = await grant(f, 'staging-result', { ...result, outcome: 'Failed' });
  const audit = await formatAudit(f.store, f.workItemId, [first.event.id, later.event.id]);
  await f.runGit('add', '.sdlc', 'docs');
  await f.runGit('commit', '--allow-empty', '-qm',
    `Audit original receipt observations\n\n${audit.trailers}`);
  const commit = await f.runGit('rev-parse', 'HEAD');
  await recordAudit(f.store, { workItemId: f.workItemId, repositoryId: 'primary', commit });
  const pruned = await pruneWork(f.store, f.workItemId);
  assert.ok(pruned.archived.includes(first.event.id));
  const fresh = await new Store(f.home, { clock: f.clock }).ready();
  const loaded = await fresh.load(f.workItemId);
  assert.equal(loaded.records.some(record => record.id === first.event.id), false);
  const retained = await readTestEvidence(fresh, { workItemId: f.workItemId,
    cycleId: cycle.id, testId: 'T-staging' });
  assert.equal(retained.observations.some(row => row.eventId === first.event.id && row.status === 'Passed'), true);
  assert.equal(stagePassed(currentCycle(loaded.records, loaded.checkpoint),
    loaded.records, 'STAGING', f.clock), false);
  await fs.writeFile(path.join(f.repo, 'new-candidate.mjs'), 'export const changed = true;\n');
  const next = await startCycle(fresh, { workItemId: f.workItemId,
    configDigest: cycle.configDigest, cause: 'Historical receipt proof remains readable' });
  assert.equal(next.reset, true);
  await pruneWork(fresh, f.workItemId);
  const historical = await readTestEvidence(fresh, { workItemId: f.workItemId,
    cycleId: cycle.id, testId: 'T-staging' });
  assert.equal(historical.historicalOnly, true);
  assert.equal(historical.status, 'NotRun');
  assert.ok(historical.observations.some(row => row.eventId === first.event.id && row.status === 'Passed'));
});

test('catalog STAGING handoff, captured results and failure history use current deployment proof without completion credit', async t => {
  const { f, cycle, artifact, deployment, result } = await stagingFixture(t);
  const captured = await grant(f, 'staging-result', { ...result, outcome: 'Passed' });
  await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id,
    testId: 'T-staging', status: 'Passed', expectedMet: true, owner: 'user',
    host: 'authorized-machine', deploymentId: deployment.id, artifactId: artifact.artifactId,
    eventId: captured.event.id, evidenceRef: 'fixture:captured-staging-result' });
  const state = await f.store.load(f.workItemId);
  assert.equal(stagePassed(currentCycle(state.records, state.checkpoint), state.records, 'STAGING', f.clock), true);
  assert.equal(hasStagingCompletion(state.records, currentCycle(state.records, state.checkpoint), f.clock), false);
  await grant(f, 'staging-result', { ...result, outcome: 'Failed' });
  const shown = await readTestEvidence(f.store, {
    workItemId: f.workItemId, cycleId: cycle.id, testId: 'T-staging',
  });
  assert.equal(shown.status, 'Failed');
  assert.equal(shown.reportedEvents.length, 2);
});

for (const outcomes of [['Failed', 'Passed'], ['Passed', 'Failed']]) {
  test(`Store STAGING equal-time ${outcomes.join('/')} stays Failed after reload and delayed older events`, async t => {
    const { f, cycle, artifact, deployment, result } = await stagingFixture(t);
    const time = f.clock.now() + 100;
    for (const outcome of outcomes) {
      f.clock.value = time - 1;
      const captured = await grant(f, 'staging-result', { ...result, outcome }, {
        input: `Isolated actual STAGING ${outcome} result at ${time}`,
      });
      if (outcome === 'Passed' && outcomes[0] === 'Passed') {
        await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id,
          testId: 'T-staging', status: 'Passed', expectedMet: true, owner: 'user',
          host: 'authorized-machine', deploymentId: deployment.id, artifactId: artifact.artifactId,
          eventId: captured.event.id, evidenceRef: 'fixture:captured-equal-time-result' });
      }

    }
    const state = await f.store.load(f.workItemId);
    const current = currentCycle(state.records, state.checkpoint);
    const planned = cycleTests(current).find(item => item.id === 'T-staging');
    assert.equal(currentTestEvidence(current, state.records, planned, f.clock)?.status, 'Failed');
    assert.equal(stagePassed(current, state.records, 'STAGING', f.clock), false);
    assert.equal(parseTestPlan(await fs.readFile(path.join(f.repo, 'docs', 'test-plan.md'), 'utf8'))
      .find(item => item.id === 'T-staging').status, 'Failed');
    f.clock.value = time - 10;
    await grant(f, 'staging-result', { ...result, outcome: 'Passed' }, {
      input: 'Isolated delayed older STAGING Passed observation',
    });
    f.clock.value = time;
    await pruneWork(f.store, f.workItemId);
    const reloaded = await f.store.load(f.workItemId);
    assert.equal(currentTestEvidence(currentCycle(reloaded.records, reloaded.checkpoint),
      reloaded.records, planned, f.clock)?.status, 'Failed');
    assert.equal(stagePassed(currentCycle(reloaded.records, reloaded.checkpoint),
      reloaded.records, 'STAGING', f.clock), false);
  });
}

test('real GitHub bridge preparation uses shared atomic claim without a split-write fault window or external call', async t => {
  const f = await bridgeFixture(t);
  const suffix = '-atomic-shared-fault';
  const prepared = await f.prepare('notification', suffix, { claim: false });
  const input = { workItemId: f.workItemId, operationId: prepared.preparation.operation.id,
    invocation: { sessionId: f.sessionId, toolName: 'github-existing-consumer',
      toolArgs: { family: 'notification', suffix }, cwd: f.repo },
    adapterContract: prepared.claim.adapterContract, hostCallId: prepared.claim.hostCallId };
  const acquisitions = f.calls.length;
  let beforeWrite = true;
  f.store.fault = async point => {
    if (point === 'dispatch:validated' && beforeWrite) {
      beforeWrite = false;
      throw new Error('Actual bridge preparation pre-write claim failure');
    }
  };
  await assert.rejects(claimOperationDispatch(f.store, input), /pre-write claim failure/u);
  let operation = (await f.store.records(f.workItemId)).find(item => item.id === input.operationId);
  assert.equal(operation.status, 'prepared');
  assert.equal(operation.dispatchBound, false);
  f.store.fault = async point => {
    if (point === 'record:operation') throw new Error('Actual bridge committed-claim response lost');
  };
  await assert.rejects(claimOperationDispatch(f.store, input), /committed-claim response lost/u);
  f.store.fault = async () => {};
  operation = (await f.store.records(f.workItemId)).find(item => item.id === input.operationId);
  assert.equal(operation.status, 'dispatching');
  assert.equal(operation.dispatchBound, true);
  assert.equal(f.calls.length, acquisitions);
  await assert.rejects(claimOperationDispatch(f.store, input), { code: 'UNCERTAIN' });
  await resume(f.store, { workItemId: f.workItemId, sessionId: f.sessionId, cwd: f.repo });
  operation = (await f.store.records(f.workItemId)).find(item => item.id === input.operationId);
  assert.equal(operation.status, 'uncertain');
  assert.equal(operation.dispatchBound, true);
});

test('persisted embedded JSON logs contain no nested or escaped secret/cookie sentinels', async t => {
  const f = await fixture(t);
  const embedded = JSON.stringify({
    AWS_SECRET_ACCESS_KEY: 'fixture-embedded-secret', Cookie: 'session=fixture-embedded-cookie',
  });
  const file = path.join(f.root, 'embedded-logs.json');
  await fs.writeFile(file, JSON.stringify({
    log: embedded, twice: JSON.stringify(embedded), arrays: [JSON.stringify([{ log: embedded }])],
    fragment: `before ${embedded} after`,
    escapedFragment: `capture ${JSON.stringify(embedded)} tail`,
    header: JSON.stringify({ log: 'Cookie: session=fixture-nested-header' }),
    safe: 'case T-one: Passed',
  }));
  const retained = await retainTestEvidence(f.store, {
    workItemId: f.workItemId, evidenceRef: pathToFileURL(file).href,
  });
  const bytes = await fs.readFile(validationObjectPath(f.store, f.workItemId, retained.ref), 'utf8');
  assert.doesNotMatch(bytes, /fixture-embedded-secret|fixture-embedded-cookie|fixture-nested-header/u);
  const reloaded = await readValidationObject(f.store, f.workItemId, retained.ref);
  assert.equal(reloaded.content.safe, 'case T-one: Passed');
});

async function atomicEnvironmentFixture(t) {
  const f = await coding(await fixture(t));
  const toolArgs = { pipeline: 'fixture-pipeline' };
  const action = { class: 'pipeline', repositoryId: 'primary', environment: 'DEV',
    target: 'dev-target', provider: 'fixture', pipeline: toolArgs.pipeline,
    configDigest: digest('fixture-config'), monitorCapability: true };
  await fs.writeFile(path.join(f.repo, '.sdlc', 'config.json'), JSON.stringify({
    defaultBranch: 'refs/heads/main',
    environments: { DEV: { target: 'dev-target', configDigest: digest('fixture-config'), allowedStages: ['DEV'] } },
    toolAdapters: [{ toolName: 'fixture_pipeline', match: toolArgs, action }],
  }));
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Post-claim environment synchronization fixture');
  await observeFixtureRepository(f);
  const cycle = (await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: digest('fixture-config'), cause: 'Post-claim synchronization regression' })).cycle;
  for (const testId of ['T-unit', 'T-integration']) await recordFixtureTest(f.store, {
    workItemId: f.workItemId, cycleId: cycle.id, testId, status: 'Passed', expectedMet: true,
    owner: 'agent', host: 'local', evidenceRef: `fixture:${testId}`,
  });
  await completeReview(f, cycle);
  await grant(f, 'dev-authorization', { cycleId: cycle.id, candidateDigest: cycle.candidateDigest,
    testSpecDigest: cycle.testSpecDigest, configDigest: cycle.configDigest,
    target: 'dev-target', completedStage: 'review' });
  await orient(f);
  const host = { hostCallId: 'fixture-environment-call', adapterContract: {
    adapterId: 'fixture-environment', propagatesUniqueCallId: true,
    dispatchIdField: 'dispatch.callId', resultIdField: 'result.callId',
  } };
  const request = { toolName: 'fixture_pipeline', toolArgs, cwd: f.repo };
  const { operation } = await prepareOperation(f.store, { workItemId: f.workItemId,
    sessionId: f.sessionId, action, request, correlationKey: 'fixture-environment-pipeline',
    intent: 'Execute one exact DEV pipeline in the isolated fixture' }, host);
  registerFixtureProviderRequest(f, operation);
  return { f, cycle, operation, claim: { workItemId: f.workItemId, operationId: operation.id,
    invocation: { sessionId: f.sessionId, ...request }, ...host } };
}

test('atomic environment claim synchronizes after commit and preserves next current-candidate environment action', async t => {
  const { f, cycle, operation, claim } = await atomicEnvironmentFixture(t);
  let state = await f.store.load(f.workItemId);
  assert.equal(stagePassed(currentCycle(state.records, state.checkpoint), state.records, 'local', f.clock), true);
  const claimed = await claimOperationDispatch(f.store, claim);
  assert.equal(claimed.dispatchBound, true);
  assert.equal(claimed.environmentBoundaryApplied, true);
  await finishFixtureOperation(f, operation, { alreadyDispatched: true });
  state = await f.store.load(f.workItemId);
  const current = currentCycle(state.records, state.checkpoint);
  assert.equal(current.pendingPlanSync, false);
  assert.equal(stagePassed(current, state.records, 'local', f.clock), true);
  assert.equal(current.candidateDigest, cycle.candidateDigest);
  const next = await fixtureBuild(f, current, { correlationKey: 'next-current-dev-build' });
  assert.equal(next.status, 'succeeded');
  assert.equal(next.candidateDigest, cycle.candidateDigest);
});

test('post-commit atomic plan-sync failure leaves a durable claim and never authorizes retry', async t => {
  const { f, claim } = await atomicEnvironmentFixture(t);
  const plan = path.join(f.repo, 'docs', 'test-plan.md');
  const backup = path.join(f.root, 'owned-plan-sync-backup');
  let moved = false;
  f.store.fault = async point => {
    if (point === 'checkpoint' && !moved) {
      await fs.rename(plan, backup);
      moved = true;
    }
  };
  try {
    await assert.rejects(claimOperationDispatch(f.store, claim), { code: 'ENOENT' });
  } finally {
    f.store.fault = async () => {};
    if (moved) await fs.rename(backup, plan);
  }
  let state = await f.store.load(f.workItemId);
  let operation = state.records.find(item => item.id === claim.operationId);
  assert.equal(operation.status, 'dispatching');
  assert.equal(operation.dispatchBound, true);
  assert.equal(currentCycle(state.records, state.checkpoint).pendingPlanSync, true);
  await assert.rejects(claimOperationDispatch(f.store, claim), { code: 'UNCERTAIN' });
  await resume(f.store, { workItemId: f.workItemId, sessionId: f.sessionId, cwd: f.repo });
  state = await f.store.load(f.workItemId);
  operation = state.records.find(item => item.id === claim.operationId);
  assert.equal(operation.status, 'uncertain');
  assert.equal(operation.dispatchBound, true);
  await assert.rejects(claimOperationDispatch(f.store, claim), { code: 'UNCERTAIN' });
});

for (const referenced of [false, true]) {
  test(`${referenced ? 'referenced' : 'inline'} NotRun pending/running evidence keeps immutable dispatch source without completion credit`, async t => {
    const f = await coding(await fixture(t));
    const tests = Array.from({ length: 2 }, (_, index) => ({
      id: `T-pending-${index}`, environment: 'local', level: 'unit', checkpoint: 'pre-review',
      mode: 'automated', owner: 'agent', location: 'local',
      implementation: 'test/pending-fixture.mjs', expected: `Pending case ${index}`, status: 'NotRun',
      requirements: ['FR-001'], conditions: ['AC-001.1'],
    }));
    await fs.writeFile(path.join(f.repo, 'docs', 'test-plan.md'), JSON.stringify({ tests }));
    await registerArtifact(f.store, { workItemId: f.workItemId, role: 'test-plan',
      repositoryId: 'primary', path: 'docs/test-plan.md' });
    await f.runGit('add', '.');
    await f.runGit('commit', '-qm', 'Nonconclusive operation evidence fixture');
    let cycle = (await startCycle(f.store, { workItemId: f.workItemId,
      configDigest: digest('fixture-config'), cause: 'Pending operation evidence regression' })).cycle;
    if (referenced) cycle = await referenceFixtureCycle(f);
    const original = structuredClone(cycle.sources);
    const operation = await localOperation(f, cycle, tests[0].id, 'pending-case');
    await markDispatching(f.store, f.workItemId, operation.id);
    const input = { workItemId: f.workItemId, cycleId: cycle.id, testId: tests[0].id,
      status: 'NotRun', operationId: operation.id, activity: 'pending', owner: 'agent', host: 'local' };
    const pending = await recordTest(f.store, input);
    assert.equal(pending.status, 'NotRun');
    assert.equal(pending.operationState, 'dispatching');
    assert.deepEqual(pending.executionSources, original);
    await recordOperation(f.store, { workItemId: f.workItemId, operationId: operation.id, status: 'running',
      handle: 'fixture-pending-run', evidenceRef: 'fixture:running', requestFingerprint: operation.requestFingerprint,
      correlationKey: operation.correlationKey });
    await f.runGit('commit', '--allow-empty', '-qm', 'Same content selected under a new revision');
    const selected = await startCycle(f.store, { workItemId: f.workItemId,
      configDigest: cycle.configDigest, cause: 'Pending execution source remains original' });
    assert.equal(selected.reset, false);
    cycle = selected.cycle;
    const running = await recordTest(f.store, { ...input, activity: 'running' });
    assert.equal(running.status, 'NotRun');
    assert.equal(running.operationState, 'running');
    assert.deepEqual(running.executionSources, original);
    assert.notEqual(cycle.sources[0].revision, original[0].revision);
    const state = await f.store.load(f.workItemId);
    assert.equal(stagePassed(currentCycle(state.records, state.checkpoint), state.records, 'local', f.clock), false);
    assert.equal(testHistory(currentCycle(state.records, state.checkpoint), state.records, tests[0].id).length, 2);
    await assert.rejects(recordTest(f.store, { ...input, testId: tests[1].id }), { code: 'OPERATION' });
    await assert.rejects(recordTest(f.store, { ...input, cycleId: 'cycle-foreign' }), { code: 'STALE' });
    await assert.rejects(recordTest(f.store, { ...input, status: 'Passed', expectedMet: true,
      evidenceRef: 'fixture:unearned-pass' }), { code: 'OPERATION' });
    await assert.rejects(recordTest(f.store, { ...input, expectedMet: true }), { code: 'EVIDENCE' });
    await assert.rejects(recordTest(f.store, { ...input, owner: 'other-owner' }), { code: 'EVIDENCE' });
    await finishLocal(f, operation);
    const completed = await f.store.load(f.workItemId);
    const completedCycle = currentCycle(completed.records, completed.checkpoint);
    const terminal = currentTestEvidence(completedCycle, completed.records, tests[0], f.clock);
    assert.equal(terminal.status, 'Passed');
    assert.deepEqual(terminal.executionSources, original);
    const history = [...testHistory(completedCycle, completed.records, tests[0].id)]
      .sort((left, right) => left.sequence - right.sequence);
    assert.deepEqual(history.map(item => item.status), ['NotRun', 'NotRun', 'Passed', 'Passed']);
    assert.notEqual(history[2].id, terminal.id);
    assert.equal(history[3].id, terminal.id);
    await fs.writeFile(path.join(f.repo, 'candidate-drift.mjs'), 'export const changed = true;\n');
    await assert.rejects(recordTest(f.store, input), { code: 'STALE' });
  });
}

test('actual retention rejects unsupported credential mappings without persisting their bytes or erasing diagnostics', async t => {
  const f = await fixture(t);
  const file = path.join(f.root, 'python-style-log.txt');
  const directory = path.join(f.store.workPath(f.workItemId), 'validation', 'objects');
  const objectFiles = async () => {
    try { return await fs.readdir(directory); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  };
  const before = await objectFiles();
  for (const log of [
    "log{'AWS_SECRET_ACCESS_KEY':'fixture-python-secret','Cookie':'session=fixture-python-cookie'}end",
    "log{'aws-secret-access-key':'fixture-python-secret'}end",
    'log{"AWS_SECRET_ACCESS_KEY":\'fixture-python-secret\'}end',
    'log{AWS_SECRET_ACCESS_KEY:fixture-python-secret}end',
    JSON.stringify({ log: "log{'Cookie':'session=fixture-python-cookie'}end" }),
    JSON.stringify({ array: [JSON.stringify("log{'x_api_key':'fixture-python-secret'}end")] }),
  ]) {
    await fs.writeFile(file, log);
    await assert.rejects(retainTestEvidence(f.store, {
      workItemId: f.workItemId, evidenceRef: pathToFileURL(file).href,
    }), { code: 'UNSAFE' });
    assert.deepEqual(await objectFiles(), before);
  }
  await fs.writeFile(file, JSON.stringify({
    diagnostics: "worker's diagnostic {count:2} complete",
    json: 'log{"AWS_SECRET_ACCESS_KEY":"fixture-json-secret","Cookie":"fixture-json-cookie"}end',
    escaped: JSON.stringify('{"AWS_SECRET_ACCESS_KEY":"fixture-json-secret"}'),
  }));
  const retained = await retainTestEvidence(f.store, {
    workItemId: f.workItemId, evidenceRef: pathToFileURL(file).href,
  });
  const bytes = await fs.readFile(validationObjectPath(f.store, f.workItemId, retained.ref), 'utf8');
  assert.doesNotMatch(bytes, /fixture-python-secret|fixture-python-cookie|fixture-json-secret|fixture-json-cookie/u);
  assert.match(bytes, /worker's diagnostic \{count:2\} complete/u);
});

for (const referenced of [false, true]) {
  test(`${referenced ? 'referenced' : 'inline'} late progress cannot replace tied-time terminal Passed Failed or cancelled NotRun`, async t => {
    const f = await coding(await fixture(t));
    const outcomes = ['succeeded', 'failed', 'cancelled'];
    const tests = Array.from({ length: outcomes.length }, (_, index) => ({
      id: `T-terminal-${index}`, environment: 'local', level: 'unit', checkpoint: 'pre-review',
      mode: 'automated', owner: 'agent', location: 'local',
      implementation: 'test/terminal-fixture.mjs', expected: `Terminal case ${index}`, status: 'NotRun',
      requirements: ['FR-001'], conditions: ['AC-001.1'],
    }));
    await fs.writeFile(path.join(f.repo, 'docs', 'test-plan.md'), JSON.stringify({ tests }));
    await registerArtifact(f.store, { workItemId: f.workItemId, role: 'test-plan',
      repositoryId: 'primary', path: 'docs/test-plan.md' });
    await f.runGit('add', '.');
    await f.runGit('commit', '-qm', 'Late progress terminal-state fixture');
    let cycle = (await startCycle(f.store, { workItemId: f.workItemId,
      configDigest: digest('fixture-config'), cause: 'Late progress cannot displace terminal evidence' })).cycle;
    if (referenced) cycle = await referenceFixtureCycle(f);
    for (const [index, terminalStatus] of outcomes.entries()) {
      const testId = tests[index].id;
      const operation = await localOperation(f, cycle, testId, `terminal-${terminalStatus}`);
      await markDispatching(f.store, f.workItemId, operation.id);
      await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id,
        testId, operationId: operation.id, status: 'NotRun', activity: 'pending' });
      await recordOperation(f.store, { workItemId: f.workItemId, operationId: operation.id,
        status: 'running', handle: `fixture-run-${index}`, evidenceRef: 'fixture:running',
        requestFingerprint: operation.requestFingerprint, correlationKey: operation.correlationKey });
      await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id,
        testId, operationId: operation.id, status: 'NotRun', activity: 'running' });
      const completedInput = { workItemId: f.workItemId, operationId: operation.id,
        status: terminalStatus, target: operation.target, requestFingerprint: operation.requestFingerprint,
        evidenceRef: `fixture:terminal-${terminalStatus}`, expectedMet: terminalStatus === 'succeeded',
        providerStatus: terminalStatus };
      await recordOperation(f.store, completedInput);
      const expected = terminalStatus === 'succeeded' ? 'Passed' :
        terminalStatus === 'failed' ? 'Failed' : 'NotRun';
      if (terminalStatus !== 'cancelled') await recordFixtureTest(f.store, {
        workItemId: f.workItemId, cycleId: cycle.id, testId, operationId: operation.id,
        status: expected, expectedMet: terminalStatus === 'succeeded',
        owner: 'agent', host: 'local', evidenceRef: `fixture:terminal-${terminalStatus}`,
      });
      const currentStatus = async () => {
        const state = await f.store.load(f.workItemId);
        return currentTestEvidence(currentCycle(state.records, state.checkpoint),
          state.records, tests[index], f.clock)?.status;
      };
      assert.equal(await currentStatus(), expected);
      for (const activity of ['running', 'pending', 'complete']) {
        await assert.rejects(recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id,
          testId, operationId: operation.id, status: 'NotRun', activity }), { code: 'OPERATION' });
      }
      if (terminalStatus === 'cancelled') {
        const cancellation = await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id,
          testId, operationId: operation.id, status: 'NotRun', activity: 'cancelled' });
        assert.equal(cancellation.operationState, 'cancelled');
        assert.equal(cancellation.status, 'NotRun');
        const legacyCancellation = await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id,
          testId, operationId: operation.id, status: 'NotRun' });
        assert.equal(legacyCancellation.operationState, 'cancelled');
        assert.equal(legacyCancellation.activity, 'cancelled');
        assert.equal(legacyCancellation.status, 'NotRun');
      }
      await recordOperation(f.store, completedInput);
      assert.equal(await currentStatus(), expected);
      await pruneWork(f.store, f.workItemId);
      assert.equal(await currentStatus(), expected);
    }
    const state = await f.store.load(f.workItemId);
    assert.equal(stagePassed(currentCycle(state.records, state.checkpoint), state.records, 'local', f.clock), false);
  });
}
