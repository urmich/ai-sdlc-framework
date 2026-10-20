export const validationDeclarations = {
  "schemaVersion": 1,
  "surfaces": [{"coverage": "direct", "paths": ["src/validation-readiness.mjs", "src/validation-report.mjs", "src/readiness-cli.mjs", "src/validation.mjs", "src/authority.mjs"]}]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { canonical, digest } from '../src/core.mjs';
import { runCli } from '../src/cli.mjs';
import { Store } from '../src/store.mjs';
import { validationObjectPath } from '../src/validation-catalog.mjs';
import { fixture as managedFixture, artifact, coding, testDefinitions } from './helpers.mjs';
import { startCycle, recordTests } from '../src/validation.mjs';
import { currentCycle, currentTestEvidence, stagePassed } from '../src/authority.mjs';
import { evaluatePolicy } from '../src/policy.mjs';
import { resetCycleResults } from '../src/validation-evidence.mjs';
import { normalizeExecutionReport, evaluateReadiness, validationInventoryDigest,
  createEvidenceBundle, readEvidenceBundle, renderReadinessReport,
  sanitizeExecutionPayload, recordReadiness, readValidationObject,
  requireReadinessEvaluation } from 'ai-sdlc-framework/evidence';

function fixture({ count = 1, assertions = 1, mode = 'automated' } = {}) {
  const owner = mode === 'manual' ? 'user' : mode === 'semi-automated' ? 'agent' : 'provider';
  const cases = Array.from({ length: count }, (_, index) => ({
    id: `T-CONSUMER-${String(index + 1).padStart(3, '0')}`,
    conditions: [`AC-901.${index + 1}`],
    expectedDigest: digest(`Observable consumer outcome ${index + 1}`),
    executionId: 'consumer-ci', mode, owner, location: 'consumer-host',
    checkpoint: 'post-review',
    assertions: Array.from({ length: assertions }, (_, offset) => ({
      id: `assertion-${offset + 1}`,
      selector: mode === 'automated' ?
        { language: 'python', module: `orders_${index + 1}`, method: `check_${offset + 1}` } :
        { procedure: `Observe consumer behavior ${index + 1}/${offset + 1}` },
    })),
  }));
  const specification = { schemaVersion: 1, profile: 'consumer-validation', cases };
  const context = {
    candidateDigest: 'c'.repeat(64), testSpecDigest: 'd'.repeat(64), configDigest: 'e'.repeat(64),
    inventoryDigest: validationInventoryDigest(specification),
    sources: [{ repositoryId: 'consumer', revision: 'a'.repeat(40), contentDigest: 'b'.repeat(64) }],
    profile: specification.profile, environment: 'local', location: 'consumer-host', mode, owner,
    native: { kind: 'fixture', platform: 'linux', architecture: 'x64', image: 'fixture-image-v1',
      toolchain: { python: '3.12.10' } },
    producer: { provider: 'fixture', connection: 'offline-host', scopeRef: 'consumer-project',
      definitionRef: 'independent-runner', executionRef: 'consumer-run', attemptKind: 'known',
      attemptRef: '1' },
    attemptCapability: 'distinct', jobRef: 'consumer-job',
    artifacts: [{ name: 'consumer-payload.tgz', sha256: 'f'.repeat(64) }],
  };
  const selection = {
    profile: specification.profile, executions: [{ id: 'consumer-ci', context }],
    now: '2026-10-18T10:00:00.000Z',
    policy: { maxAgeMs: 3600000, revisionPolicy: 'exact', verifierIds: ['fixture-host-v1'] },
    barriers: [],
  };
  const facts = new Map();
  const verify = input => facts.get(input.reportDigest) ?? null;
  const report = ({ sequence = 1, status = 'Passed', complete = true } = {}) => {
    const observedAt = new Date(Date.parse('2026-10-18T09:00:00.000Z') +
      sequence * 60000).toISOString();
    return {
      schemaVersion: 1, kind: 'test-execution', context: structuredClone(context),
      startedAt: '2026-10-18T09:00:00.000Z',
      finishedAt: complete ? observedAt : null, observedAt, sequence, complete,
      exitCode: complete ? mode === 'automated' ? status === 'Failed' ? 1 : 0 : null : null,
      results: cases.flatMap(test => test.assertions.map(assertion => ({
        testId: test.id, assertionId: assertion.id, selector: structuredClone(assertion.selector),
        status, expectedMet: status === 'Passed' ? true : status === 'Failed' ? false : null,
        expectedDigest: test.expectedDigest, checkpoint: test.checkpoint,
        observedAt, sourceSequence: sequence,
        durationMs: ['Passed', 'Failed'].includes(status) ? 12.5 : null,
        exitCode: null,
      }))),
    };
  };
  const register = (raw, standard = raw) => {
    const bytes = typeof raw === 'string' ? Buffer.from(raw) : Buffer.from(canonical(raw));
    facts.set(digest(bytes), {
      verifierId: 'fixture-host-v1', reportDigest: digest(bytes),
      context: structuredClone(standard.context), sourceTime: standard.observedAt,
      sourceSequence: standard.sequence,
    });
  };
  const capture = raw => {
    register(raw);
    return normalizeExecutionReport(raw, raw.context, verify);
  };
  return { specification, context, selection, report, capture, verify, register, facts };
}

async function managedReports(t, { selected = ['T-unit', 'T-integration'], definitions } = {}) {
  const f = await coding(await managedFixture(t));
  if (definitions) await artifact(f, 'test-plan',
    '# Consumer plan\n| ID | Requirements | Conditions | Environment | Level | Checkpoint | Mode | Owner | Location | Expected outcome | Implementation | Status |\n' +
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n' +
    definitions.map(test => `| ${test.id} | FR-001 | AC-001.1 | ${test.environment} | ${test.level} | ${test.checkpoint} | ${test.mode} | ${test.owner} | ${test.location} | ${test.expected} | ${test.implementation} | NotRun |`).join('\n') + '\n');
  const { cycle } = await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: digest('consumer configuration'), cause: 'Normalized import fixture' });
  const tests = definitions ?? testDefinitions().filter(test => selected.includes(test.id));
  const spec = { schemaVersion: 1, profile: 'consumer-validation',
    cases: tests.map(test => ({
      id: test.id, conditions: ['AC-001.1'], expectedDigest: digest(test.expected),
      executionId: `execution-${test.id}`, mode: test.mode, owner: test.owner,
      location: test.location, checkpoint: test.checkpoint,
      assertions: [{ id: 'observable-contract',
        selector: test.mode === 'automated' ?
          { file: test.implementation, name: 'observable contract' } :
          { procedure: test.implementation } }],
    })) };
  const contexts = tests.map(test => ({
    candidateDigest: cycle.candidateDigest, testSpecDigest: cycle.testSpecDigest,
    configDigest: cycle.configDigest, inventoryDigest: validationInventoryDigest(spec),
    sources: structuredClone(cycle.sources), profile: spec.profile,
    environment: test.environment, location: test.location, mode: test.mode, owner: test.owner,
    native: { kind: 'fixture', platform: process.platform, architecture: process.arch,
      image: 'fixture-host', toolchain: { node: process.version } },
    producer: { provider: 'fixture', connection: 'isolated-host', scopeRef: 'consumer',
      definitionRef: test.implementation, executionRef: `run-${test.id}`,
      attemptKind: 'known', attemptRef: '1' },
    attemptCapability: 'distinct', jobRef: `job-${test.id}`, artifacts: [],
  }));
  const baseline = f.clock.now();
  f.clock.advance(60000);
  const captures = ({ sequence = 1, outcomes = {}, integrationStartsAt = 3000,
    timeOffset = 0, unmapped = false } = {}) => tests.map((test, index) => {
    const observedAt = new Date(baseline + timeOffset +
      (test.id === 'T-unit' ? 2000 : 4000)).toISOString();
    const status = outcomes[test.id] ?? 'Passed';
    const context = contexts[index];
    const raw = {
      schemaVersion: 1, kind: 'test-execution', context,
      startedAt: new Date(baseline + timeOffset +
        (test.id === 'T-unit' ? 1000 : integrationStartsAt)).toISOString(),
      finishedAt: observedAt, observedAt, sequence, complete: true,
      exitCode: status === 'Failed' ? 1 : 0,
      results: [{
        testId: test.id, assertionId: 'observable-contract',
        selector: spec.cases[index].assertions[0].selector,
        status, expectedMet: status === 'Passed', expectedDigest: digest(test.expected),
        checkpoint: test.checkpoint, observedAt, sourceSequence: sequence,
        durationMs: 1, exitCode: status === 'Failed' ? 1 : 0,
      }],
    };
    if (unmapped) raw.results.push({ ...raw.results[0], assertionId: 'undeclared-assertion' });
    const facts = { verifierId: 'fixture-host-v1', reportDigest: digest(Buffer.from(canonical(raw))),
      context: structuredClone(context), sourceTime: observedAt, sourceSequence: sequence };
    return normalizeExecutionReport(raw, context, input =>
      input.reportDigest === facts.reportDigest ? facts : null);
  });
  const evaluate = reports => evaluateReadiness(spec, reports, {
    profile: spec.profile,
    executions: contexts.map((context, index) => ({ id: spec.cases[index].executionId, context })),
    now: new Date(f.clock.now()).toISOString(),
    policy: { maxAgeMs: 3600000, revisionPolicy: 'exact', verifierIds: ['fixture-host-v1'] },
    barriers: [],
  });
  const admit = evaluation => recordReadiness(f.store, {
    workItemId: f.workItemId, cycleId: cycle.id, evaluation,
  });
  return { f, cycle, tests, spec, contexts, captures, evaluate, admit };
}

async function assertRetainedAdmissionGraph(t, definitions) {
  const input = await managedReports(t, { definitions });
  const result = await input.admit(input.evaluate(input.captures()));
  const selected = result.evidence[0];
  const admission = await readValidationObject(input.f.store, input.f.workItemId,
    selected.retainedPayloadRef);
  const imported = await readValidationObject(input.f.store, input.f.workItemId, result.importRef);
  const mapping = (await Promise.all(imported.content.objectMapRefs.map(ref =>
    readValidationObject(input.f.store, input.f.workItemId, ref))))
    .flatMap(page => page.content.objects);
  const retainedRef = originalRef => {
    const entry = mapping.find(entry => entry.originalRef.sha256 === originalRef.sha256);
    assert.ok(entry, 'The complete imported bundle must retain this original object');
    return entry.retainedRef;
  };
  const summaryRef = retainedRef(imported.content.manifest.evaluationRef);
  const summary = await readValidationObject(input.f.store, input.f.workItemId, summaryRef);
  const pageRef = retainedRef(summary.content.pageRefs[0]);
  const page = await readValidationObject(input.f.store, input.f.workItemId, pageRef);
  const reportEntry = mapping.find(entry =>
    entry.originalRef.sha256 === imported.content.manifest.reportRefs[0].sha256);
  const report = await readValidationObject(input.f.store, input.f.workItemId, reportEntry.retainedRef);
  const targets = [
    ['admission', selected.retainedPayloadRef],
    ['import', result.importRef],
    ['object map', imported.content.objectMapRefs.at(-1)],
    ['selected assertions', admission.content.assertionPageRefs[0]],
    ['original producer bytes', retainedRef(report.content.payloadRef)],
    ['specification', retainedRef(imported.content.manifest.specificationRef)],
    ['normalized report', reportEntry.retainedRef],
    ['outcome summary', summaryRef],
    ['outcome page', pageRef],
    ['outcome assertions', retainedRef(page.content.cases[0].assertionPageRefs[0])],
  ];
  const records = () => input.f.store.records(input.f.workItemId)
    .then(records => canonical(records.sort((left, right) => left.id.localeCompare(right.id))));
  const fresh = async () => new Store(input.f.home, { clock: input.f.clock }).ready();
  const assertCurrent = async () => {
    const state = await (await fresh()).load(input.f.workItemId);
    assert.equal(stagePassed(currentCycle(state.records, state.checkpoint),
      state.records, 'local', input.f.clock), true);
  };
  await assertCurrent();
  const originalRecords = await records();
  for (const [label, ref] of targets) {
    const file = validationObjectPath(input.f.store, input.f.workItemId, ref);
    const bytes = await readFile(file);
    await rm(file);
    try {
      await assert.rejects((await fresh()).load(input.f.workItemId),
        { code: 'ENOENT', path: file }, `${label}: missing proof must not retain current credit`);
    } finally {
      await writeFile(file, bytes);
    }
    try {
      await writeFile(file, '{}\n');
      await assert.rejects((await fresh()).load(input.f.workItemId),
        { code: 'DIGEST' }, `${label}: corrupt proof must not retain current credit`);
    } finally {
      await writeFile(file, bytes);
    }
    await assertCurrent();
  }
  assert.equal(await records(), originalRecords);
}

test('T-PRD070 inline managed reload verifies every retained admission dependency without rewriting history', async t => {
  await assertRetainedAdmissionGraph(t);
});

test('T-PRD076 referenced managed reload verifies every retained admission dependency without rewriting history', async t => {
  await assertRetainedAdmissionGraph(t, Array.from({ length: 101 }, (_, index) => ({
    ...testDefinitions()[0], id: `T-graph-${String(index).padStart(3, '0')}`,
    expected: `Retained consumer contract ${index} holds`,
  })));
});

test('T-PRD064 managed normalized admission retains original bytes and passes only the current legitimate cycle', async t => {
  const input = await managedReports(t);
  const reports = input.captures();
  const originals = canonical(reports);
  const evaluation = input.evaluate(reports);
  const result = await input.admit(evaluation);
  assert.deepEqual(result.evidence.map(item => item.status), ['Passed', 'Passed']);
  assert.deepEqual(result.blocked, []);
  const records = await input.f.store.records(input.f.workItemId);
  const cycle = records.find(record => record.id === input.cycle.id);
  assert.equal(stagePassed(cycle, records, 'local', input.f.clock), true);
  const action = { class: 'test', repositoryId: 'primary', environment: 'local',
    testId: 'T-integration', owner: 'agent', host: 'local' };
  const state = await input.f.store.load(input.f.workItemId);
  assert.ok(!evaluatePolicy(state, action, { clock: input.f.clock }).findings.some(finding =>
    finding.rule === 'unit-first'));
  for (const evidence of result.evidence) {
    const report = reports.find(report => report.observations[0].testId === evidence.testId);
    assert.equal(evidence.sourceObservedAt, report.observations[0].observedAt);
    assert.equal(evidence.sourceStartedAt, report.startedAt);
    assert.equal(evidence.sourceCompletedAt, report.finishedAt);
    assert.notEqual(evidence.observedAt, evidence.sourceObservedAt);
    assert.deepEqual(evidence.executionSources, report.context.sources);
    const retained = await readValidationObject(input.f.store, input.f.workItemId, evidence.retainedPayloadRef);
    assert.equal(retained.content.status, 'Passed');
  }
  const root = await readValidationObject(input.f.store, input.f.workItemId, result.importRef);
  const entries = (await Promise.all(root.content.objectMapRefs.map(ref =>
    readValidationObject(input.f.store, input.f.workItemId, ref)))).flatMap(page => page.content.objects);
  for (const report of reports) {
    const original = entries.find(entry => entry.originalRef.sha256 === report.payloadRef.sha256);
    const retained = await readValidationObject(input.f.store, input.f.workItemId, original.retainedRef);
    assert.equal(digest(Buffer.from(retained.content.content, 'base64')), retained.content.sha256);
  }
  assert.equal(canonical(reports), originals);
  input.f.clock.advance(3600001);
  assert.ok(evaluatePolicy(await input.f.store.load(input.f.workItemId), action,
    { clock: input.f.clock }).findings.some(finding => finding.rule === 'unit-first'));
  await assert.rejects(input.admit(JSON.parse(JSON.stringify(evaluation))), { code: 'EVIDENCE' });
  await assert.rejects(recordTests(input.f.store, { workItemId: input.f.workItemId,
    cycleId: cycle.id, results: [{ testId: 'T-unit', status: 'Passed',
      sourceObservedAt: reports[0].observedAt }] }), { code: 'INPUT' });
});

test('T-PRD064 importing unit results first cannot manufacture unit-first execution chronology', async t => {
  const input = await managedReports(t);
  const detached = input.evaluate(input.captures({ integrationStartsAt: 1000 }));
  assert.equal(detached.status, 'Passed');
  const result = await input.admit(detached);
  assert.equal(result.evidence.find(item => item.testId === 'T-unit').status, 'Passed');
  assert.equal(result.evidence.find(item => item.testId === 'T-integration').status, 'NotRun');
  assert.equal(result.blocked[0].code, 'UNIT_FIRST');
  const records = await input.f.store.records(input.f.workItemId);
  assert.equal(stagePassed(records.find(record => record.id === input.cycle.id),
    records, 'local', input.f.clock), false);
});

test('T-PRD067 managed import reevaluates freshness and resets without freshening old passes or erasing failures', async t => {
  const input = await managedReports(t, { selected: ['T-unit'] });
  const initial = input.captures();
  const before = input.evaluate(initial);
  await input.admit(before);
  const failed = input.captures({ sequence: 2, timeOffset: 5000, outcomes: { 'T-unit': 'Failed' } });
  await input.admit(input.evaluate(failed));
  await input.admit(before);
  let records = await input.f.store.records(input.f.workItemId);
  const test = input.tests[0];
  assert.equal(currentTestEvidence(records.find(record => record.id === input.cycle.id),
    records, test, input.f.clock).status, 'Failed');
  input.f.clock.advance(1000);
  await input.f.store.transaction(input.f.workItemId, tx => {
    const cycle = currentCycle(tx.all(), tx.checkpoint);
    resetCycleResults(tx, cycle);
    tx.put(cycle);
  });
  const reset = await input.admit(before);
  assert.equal(reset.evaluation.status, 'NotRun');
  assert.equal(reset.evidence[0].status, 'NotRun');
  assert.equal(reset.evidence[0].sourceObservedAt, undefined);
  records = await input.f.store.records(input.f.workItemId);
  assert.equal(stagePassed(records.find(record => record.id === input.cycle.id),
    records, 'local', input.f.clock), false);
  const recovery = input.captures({ sequence: 3, timeOffset: 62000 });
  input.f.clock.advance(10000);
  assert.equal((await input.admit(input.evaluate(recovery))).evidence[0].status, 'Passed');
  input.f.clock.advance(3600001);
  records = await input.f.store.records(input.f.workItemId);
  assert.equal(currentTestEvidence(records.find(record => record.id === input.cycle.id),
    records, test, input.f.clock), null);
  assert.ok(records.some(record => record.type === 'test-evidence' && record.status === 'Passed'));
  const expired = await input.admit(input.evaluate(recovery));
  assert.equal(expired.evidence[0].status, 'NotRun');
  records = await input.f.store.records(input.f.workItemId);
  assert.equal(stagePassed(records.find(record => record.id === input.cycle.id),
    records, 'local', input.f.clock), false);
  assert.ok(records.some(record => record.type === 'test-evidence' && record.status === 'Failed'));
});

test('T-PRD068 a producer blocker cannot turn passing case rows into managed checkpoint success', async t => {
  const input = await managedReports(t, { selected: ['T-unit'] });
  const reports = input.captures();
  const unverified = JSON.parse(JSON.stringify(reports[0]));
  const result = await input.admit(input.evaluate([unverified, reports[0]]));
  assert.equal(result.evidence[0].status, 'Passed');
  const serialized = input.evaluate([unverified]);
  assert.equal(serialized.status, 'NotRun');
  await assert.rejects(input.admit(serialized), { code: 'EVIDENCE' });
  const unmapped = input.evaluate(input.captures({ sequence: 2, timeOffset: 5000, unmapped: true }));
  assert.equal(unmapped.cases[0].status, 'Passed');
  assert.equal(unmapped.status, 'NotRun');
  assert.equal((await input.admit(unmapped)).evidence[0].status, 'NotRun');
  const records = await input.f.store.records(input.f.workItemId);
  assert.equal(stagePassed(records.find(record => record.id === input.cycle.id),
    records, 'local', input.f.clock), false);
  const mismatched = structuredClone(input.spec);
  mismatched.cases[0].expectedDigest = digest('A different expected outcome');
  const bad = evaluateReadiness(mismatched, [], {
    profile: mismatched.profile, executions: [{
      id: mismatched.cases[0].executionId, context: {
        ...input.contexts[0], inventoryDigest: validationInventoryDigest(mismatched),
      },
    }], now: new Date(input.f.clock.now()).toISOString(),
    policy: { maxAgeMs: 3600000, revisionPolicy: 'exact', verifierIds: ['fixture-host-v1'] },
    barriers: [],
  });
  await assert.rejects(input.admit(bad), { code: 'EVIDENCE' });
});

test('T-PRD076 normalized adoption retains referenced catalogs and all case evidence beyond the inline limit', async t => {
  const definitions = Array.from({ length: 101 }, (_, index) => ({
    ...testDefinitions()[0], id: `T-consumer-${String(index).padStart(3, '0')}`,
    expected: `Consumer contract ${index} holds`,
  }));
  const input = await managedReports(t, { definitions });
  assert.equal(input.cycle.storageVersion, 2);
  const result = await input.admit(input.evaluate(input.captures()));
  assert.equal(result.evidence.length, definitions.length);
  assert.ok(result.evidence.every(item => item.status === 'Passed'));
  const state = await input.f.store.load(input.f.workItemId);
  const cycle = currentCycle(state.records, state.checkpoint);
  assert.equal(stagePassed(cycle, state.records, 'local', input.f.clock), true);
  for (const test of definitions) {
    const evidence = currentTestEvidence(cycle, state.records, test, input.f.clock);
    assert.equal(evidence.status, 'Passed');
    assert.ok(evidence.retainedPayloadRef);
  }
  const root = await readValidationObject(input.f.store, input.f.workItemId, result.importRef);
  assert.ok(root.content.objectMapRefs.length > 1);
});

test('T-PRD067 managed admission refuses changed source instead of relabeling detached execution', async t => {
  const input = await managedReports(t);
  const evaluation = input.evaluate(input.captures());
  await writeFile(path.join(input.f.repo, 'changed-source.mjs'), 'export const changed = true;\n');
  await assert.rejects(input.admit(evaluation), { code: 'STALE' });
  assert.equal(evaluation.status, 'Passed');
  const records = await input.f.store.records(input.f.workItemId);
  assert.ok(!records.some(record => record.type === 'test-evidence'));
});

test('T-PRD082 detached environment success never creates a managed deployment or execution authority', async t => {
  for (const testId of ['T-dev', 'T-staging']) {
    const input = await managedReports(t, { selected: [testId] });
    const evaluation = input.evaluate(input.captures());
    assert.equal(evaluation.status, 'Passed');
    await assert.rejects(input.admit(evaluation), /deployment/iu);
    const records = await input.f.store.records(input.f.workItemId);
    assert.ok(!records.some(record => record.type === 'operation'));
    assert.ok(!records.some(record => record.type === 'test-evidence'));
  }
});

test('T-PRD064 normalized automated and observed procedures retain their actual ownership and outcomes', () => {
  for (const mode of ['automated', 'semi-automated', 'manual']) {
    const input = fixture({ mode });
    const raw = input.report();
    const normalized = input.capture(raw);
    const result = evaluateReadiness(input.specification, [normalized], input.selection);
    assert.equal(result.status, 'Passed');
    assert.equal(normalized.context.mode, mode);
    assert.equal(normalized.context.owner, mode === 'manual' ? 'user' :
      mode === 'semi-automated' ? 'agent' : 'provider');
    assert.equal(result.cases[0].assertions[0].durationMs, 12.5);
    assert.equal(raw.results[0].status, 'Passed');
    assert.ok(Object.isFrozen(normalized));
    assert.ok(!Object.isFrozen(raw));
  }
});

test('T-PRD065 normalized records bind required fields and preserve skip/cancel diagnostics separately', () => {
  const input = fixture();
  for (const status of ['Skipped', 'Todo', 'Cancelled', 'Running', 'Blocked', 'NotRun']) {
    const normalized = input.capture(input.report({ status }));
    const result = evaluateReadiness(input.specification, [normalized], input.selection);
    assert.equal(result.status, 'NotRun');
    assert.equal(result.cases[0].assertions[0].rawStatus, status);
    assert.equal(result.counts.passed, 0);
  }
  for (const mutate of [
    raw => { delete raw.context.native; },
    raw => { delete raw.context.producer; },
    raw => { delete raw.context.attemptCapability; },
    raw => { delete raw.results[0].selector; },
    raw => { delete raw.results[0].expectedDigest; },
    raw => { delete raw.results[0].observedAt; },
    raw => { raw.results[0].durationMs = null; },
    raw => { raw.results[0].expectedMet = false; },
    raw => { raw.results[0].exitCode = 1; },
  ]) {
    const raw = input.report();
    mutate(raw);
    assert.throws(() => normalizeExecutionReport(raw, input.context, input.verify));
  }
  let accessed = false;
  const raw = input.report();
  Object.defineProperty(raw, 'private', { enumerable: true, get() { accessed = true; return 'hidden'; } });
  assert.throws(() => normalizeExecutionReport(raw, input.context, input.verify), { code: 'INPUT' });
  assert.equal(accessed, false);
});

test('T-PRD066 complete explicit assertion inventories pass; empty, missing and conflicting output cannot', () => {
  const input = fixture({ assertions: 2 });
  const passing = input.capture(input.report());
  const result = evaluateReadiness(input.specification, [passing], input.selection);
  assert.equal(result.status, 'Passed');
  assert.equal(result.counts.requiredAssertions, 2);
  const missing = input.report({ sequence: 2 });
  missing.results.pop();
  assert.equal(evaluateReadiness(input.specification, [passing, input.capture(missing)],
    input.selection).status, 'NotRun');
  const duplicate = input.report();
  duplicate.results.push(structuredClone(duplicate.results[0]));
  assert.throws(() => input.capture(duplicate), { code: 'INPUT' });
  const empty = structuredClone(input.specification);
  empty.cases = [];
  assert.throws(() => evaluateReadiness(empty, [], input.selection));
  const unexpected = input.report({ sequence: 3 });
  unexpected.results.push({ ...structuredClone(unexpected.results[0]), assertionId: 'unmapped' });
  const extra = evaluateReadiness(input.specification, [input.capture(unexpected)], input.selection);
  assert.equal(extra.status, 'NotRun');
  assert.ok(extra.producerBlockers.some(problem => problem.code === 'UNMAPPED_OBSERVATION'));
  const conflict = input.report({ status: 'Failed' });
  assert.equal(evaluateReadiness(input.specification,
    [passing, input.capture(conflict)], input.selection).status, 'NotRun');
});

test('T-PRD067 changed source, specification, configuration, native context and artifact invalidate current credit', () => {
  const input = fixture();
  const normalized = input.capture(input.report());
  const before = canonical(normalized);
  for (const mutate of [
    context => { context.candidateDigest = '1'.repeat(64); },
    context => { context.testSpecDigest = '2'.repeat(64); },
    context => { context.configDigest = '3'.repeat(64); },
    context => { context.sources[0].revision = '4'.repeat(40); },
    context => { context.sources[0].contentDigest = '5'.repeat(64); },
    context => { context.native.platform = 'darwin'; },
    context => { context.native.architecture = 'arm64'; },
    context => { context.native.kind = 'native'; },
    context => { context.native.image = 'different-image'; },
    context => { context.native.toolchain.python = 'different-runtime'; },
    context => { context.artifacts[0].sha256 = '6'.repeat(64); },
    context => { context.producer.attemptRef = '2'; },
  ]) {
    const selected = structuredClone(input.selection);
    mutate(selected.executions[0].context);
    const result = evaluateReadiness(input.specification, [normalized], selected);
    assert.equal(result.status, 'NotRun');
    assert.equal(result.cases[0].status, 'NotRun');
  }
  const expired = structuredClone(input.selection);
  expired.now = '2026-10-18T12:00:00.000Z';
  assert.equal(evaluateReadiness(input.specification, [normalized], expired).status, 'NotRun');
  assert.equal(canonical(normalized), before);
});

test('T-PRD067 original event time and source sequence prevent late import from hiding reset or failure', () => {
  const input = fixture();
  const first = input.capture(input.report());
  const laterFailure = input.capture(input.report({ sequence: 2, status: 'Failed' }));
  assert.equal(evaluateReadiness(input.specification,
    [laterFailure, first], input.selection).status, 'Failed');
  const recovery = input.capture(input.report({ sequence: 3 }));
  assert.equal(evaluateReadiness(input.specification,
    [recovery, laterFailure, first], input.selection).status, 'Passed');
  const reset = structuredClone(input.selection);
  reset.barriers.push({ testId: input.specification.cases[0].id,
    notBefore: '2026-10-18T09:02:00.000Z' });
  assert.equal(evaluateReadiness(input.specification, [first], reset).status, 'NotRun');
  assert.equal(evaluateReadiness(input.specification, [recovery, first], reset).status, 'Passed');
});

test('T-PRD068 authored Passed JSON or serialized verification flags cannot become trusted execution evidence', () => {
  const input = fixture();
  const raw = input.report();
  const unverified = normalizeExecutionReport(raw, input.context);
  assert.equal(evaluateReadiness(input.specification, [unverified], input.selection).status, 'NotRun');
  assert.throws(() => normalizeExecutionReport(raw, input.context, true), { code: 'INPUT' });
  assert.throws(() => normalizeExecutionReport(raw, input.context, () => true), { code: 'INPUT' });
  const genuine = input.capture(raw);
  const serialized = JSON.parse(JSON.stringify(genuine));
  assert.equal(evaluateReadiness(input.specification, [serialized], input.selection).status, 'NotRun');
  const wrongOrigin = normalizeExecutionReport(raw, input.context, () => ({
    verifierId: 'fixture-host-v1', reportDigest: '0'.repeat(64), context: input.context,
    sourceTime: raw.observedAt, sourceSequence: raw.sequence,
  }));
  assert.equal(evaluateReadiness(input.specification, [wrongOrigin], input.selection).status, 'NotRun');
  assert.equal(evaluateReadiness(input.specification, [genuine], input.selection).status, 'Passed');
});

test('T-PRD069 prepublication readiness is separate from postpublication completion and action authority', () => {
  const input = fixture();
  const report = input.capture(input.report());
  const pre = evaluateReadiness(input.specification, [report], input.selection);
  assert.equal(pre.status, 'Passed');
  const postSpecification = structuredClone(input.specification);
  postSpecification.profile = 'public-consumers';
  postSpecification.cases[0].id = 'T-PUBLIC-CONSUMER';
  const post = structuredClone(input.selection);
  post.profile = postSpecification.profile;
  post.executions[0].context.profile = postSpecification.profile;
  post.executions[0].context.inventoryDigest = validationInventoryDigest(postSpecification);
  assert.equal(evaluateReadiness(postSpecification, [report], post).status, 'NotRun');
  assert.ok(!Object.hasOwn(pre, 'approved'));
  assert.ok(!Object.hasOwn(pre, 'publicationAuthorized'));
});

test('T-PRD036 a configured publisher dispatches only complete current prepublication evidence and retains separate consumer completion', () => {
  const effects = [];
  const publisher = evaluation => {
    requireReadinessEvaluation(evaluation);
    if (evaluation.status !== 'Passed') return false;
    effects.push({ profile: evaluation.profile });
    return true;
  };
  for (const variant of ['missing', 'failed', 'skipped', 'stale']) {
    const input = fixture();
    const raw = input.report({ status: variant === 'failed' ? 'Failed' : 'Passed' });
    if (variant === 'skipped') {
      raw.results[0].status = 'Skipped';
      raw.results[0].expectedMet = null;
    }
    const selection = structuredClone(input.selection);
    if (variant === 'stale') selection.now = '2026-10-19T10:00:00.000Z';
    const reports = variant === 'missing' ? [] : [input.capture(raw)];
    const evaluation = evaluateReadiness(input.specification, reports, selection);
    assert.notEqual(evaluation.status, 'Passed', variant);
    assert.equal(publisher(evaluation), false, variant);
  }
  assert.equal(effects.length, 0);
  const input = fixture();
  const prepublication = evaluateReadiness(input.specification,
    [input.capture(input.report())], input.selection);
  assert.equal(publisher(prepublication), true);
  assert.equal(effects.length, 1);
  assert.throws(() => publisher(JSON.parse(JSON.stringify(prepublication))), { code: 'EVIDENCE' });
  const postSpecification = structuredClone(input.specification);
  postSpecification.profile = 'published-consumers';
  const postSelection = structuredClone(input.selection);
  postSelection.profile = postSpecification.profile;
  postSelection.executions[0].context.profile = postSpecification.profile;
  postSelection.executions[0].context.inventoryDigest = validationInventoryDigest(postSpecification);
  const completion = evaluateReadiness(postSpecification, [], postSelection);
  assert.equal(completion.status, 'NotRun');
  assert.equal(publisher(completion), false);
  assert.equal(effects.length, 1, 'Consumer failure does not invent rollback or another publication');
});

test('T-PRD070 retained content-addressed bundles replay from bytes but never trust saved passing verdicts', () => {
  const input = fixture({ count: 130 });
  const observed = input.capture(input.report());
  const originals = [observed];
  const evaluation = evaluateReadiness(input.specification, originals, input.selection);
  originals.length = 0;
  const bundle = createEvidenceBundle(evaluation);
  const copy = JSON.parse(JSON.stringify(bundle));
  assert.equal(bundle.objects.filter(entry => entry.value.kind === 'readiness-page').length, 3);
  assert.ok(bundle.objects.every(entry => entry.ref.bytes <= 4 * 1024 * 1024));
  assert.ok(!bundle.manifest.objectRefs.some(ref => ref.sha256 === bundle.manifestRef.sha256));
  const expected = { specification: input.specification, context: input.selection };
  const replayed = readEvidenceBundle(copy, expected, input.verify);
  assert.equal(replayed.evaluation.status, 'Passed');
  assert.equal(replayed.evaluation.counts.required, 130);
  assert.equal(readEvidenceBundle(copy, expected).evaluation.status, 'NotRun');
  assert.equal(readEvidenceBundle(copy, expected).historicalSummary.status, 'Passed');
  const tampered = structuredClone(copy);
  tampered.objects[0].value.schemaVersion = 999;
  assert.throws(() => readEvidenceBundle(tampered, expected, input.verify), { code: 'DIGEST' });
  const missing = structuredClone(copy);
  missing.objects.pop();
  assert.throws(() => readEvidenceBundle(missing, expected, input.verify));
  const expired = structuredClone(expected);
  expired.context.now = '2026-10-19T10:00:00.000Z';
  assert.equal(readEvidenceBundle(copy, expired, input.verify).evaluation.status, 'NotRun');
});

test('T-PRD071 newest incomplete snapshots cannot borrow old passes, and later complete recovery preserves history', () => {
  const input = fixture({ assertions: 2 });
  const first = input.capture(input.report());
  const partial = input.report({ sequence: 2, complete: false });
  partial.results = [];
  const interrupted = input.capture(partial);
  const notReady = evaluateReadiness(input.specification, [interrupted, first], input.selection);
  assert.equal(notReady.status, 'NotRun');
  assert.equal(notReady.cases[0].assertions.filter(assertion => assertion.status === 'NotRun').length, 2);
  const complete = input.capture(input.report({ sequence: 3 }));
  assert.equal(evaluateReadiness(input.specification,
    [first, interrupted, complete], input.selection).status, 'Passed');
  const stillMissing = input.report({ sequence: 4 });
  stillMissing.results.pop();
  assert.equal(evaluateReadiness(input.specification,
    [first, complete, input.capture(stillMissing)], input.selection).status, 'NotRun');
});

test('T-PRD071 independent rejection variants and complete recovery preserve the original retained execution', async t => {
  await mkdir(path.resolve('.test-data'), { recursive: true });
  const root = await mkdtemp(path.resolve('.test-data', 'readiness-recovery-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve('.test-data'));
    await rm(root, { recursive: true });
    await assert.rejects(stat(root), { code: 'ENOENT' });
  });
  for (const variant of ['missing', 'skipped', 'source', 'specification', 'artifact',
    'platform', 'stale', 'interrupted', 'failed', 'recovery']) {
    const input = fixture({ assertions: 2 });
    const first = input.capture(input.report());
    const firstBytes = canonical(first);
    const firstEvaluation = evaluateReadiness(input.specification, [first], input.selection);
    assert.equal(firstEvaluation.status, 'Passed');
    const original = JSON.stringify(createEvidenceBundle(firstEvaluation));
    const file = path.join(root, `${variant}.json`);
    await writeFile(file, original, { flag: 'wx' });
    const selection = structuredClone(input.selection);
    const raw = input.report({ sequence: 2,
      status: ['failed', 'recovery'].includes(variant) ? 'Failed' :
        variant === 'skipped' ? 'Skipped' : 'Passed',
      complete: variant !== 'interrupted' });
    if (variant === 'missing' || variant === 'interrupted') raw.results = [];
    if (variant === 'source') selection.executions[0].context.sources[0].contentDigest = '9'.repeat(64);
    if (variant === 'specification') selection.executions[0].context.testSpecDigest = '8'.repeat(64);
    if (variant === 'artifact') selection.executions[0].context.artifacts[0].sha256 = '7'.repeat(64);
    if (variant === 'platform') selection.executions[0].context.native.platform = 'win32';
    if (variant === 'stale') selection.now = '2026-10-19T10:00:00.000Z';
    const reports = [first, input.capture(raw)];
    if (variant === 'recovery') reports.push(input.capture(input.report({ sequence: 3 })));
    const result = evaluateReadiness(input.specification, reports, selection);
    assert.equal(result.status, variant === 'failed' ? 'Failed' :
      variant === 'recovery' ? 'Passed' : 'NotRun', variant);
    assert.equal(result.counts.required, 1, variant);
    assert.equal(result.counts.passed, variant === 'recovery' ? 1 : 0, variant);
    assert.equal(canonical(first), firstBytes, variant);
    assert.equal(await readFile(file, 'utf8'), original, variant);
    const restored = readEvidenceBundle(JSON.parse(await readFile(file, 'utf8')), {
      specification: input.specification, context: input.selection,
    }, input.verify);
    assert.equal(restored.historicalSummary.status, 'Passed', variant);
    assert.equal(canonical(restored.reports[0]), firstBytes, variant);
  }
});

test('T-PRD067 a new envelope cannot refresh old events or hide a newer failed assertion', () => {
  const input = fixture();
  const firstRaw = input.report();
  const first = input.capture(firstRaw);
  const failed = input.capture(input.report({ sequence: 2, status: 'Failed' }));
  const regressed = input.report({ sequence: 3 });
  regressed.results = structuredClone(firstRaw.results);
  const result = evaluateReadiness(input.specification,
    [first, failed, input.capture(regressed)], input.selection);
  assert.equal(result.status, 'Failed');
  assert.equal(result.cases[0].assertions[0].status, 'Failed');
  assert.ok(result.cases[0].blockers.some(reason => reason.code === 'REGRESSED_ASSERTION'));
  const renewedEnvelope = input.report({ sequence: 30 });
  renewedEnvelope.results = structuredClone(firstRaw.results);
  const late = structuredClone(input.selection);
  late.now = '2026-10-18T10:30:00.000Z';
  assert.equal(evaluateReadiness(input.specification,
    [input.capture(renewedEnvelope)], late).status, 'NotRun');
});

test('T-PRD072 independent UTF-8 producer formats use explicit in-process adapters, never module paths in JSON', () => {
  const input = fixture();
  const standard = input.report();
  const xml = '<consumer-suite><balance-check outcome="ok"/></consumer-suite>';
  input.register(xml, standard);
  const adapter = {
    id: 'consumer-xml-v1',
    normalize: payload => {
      assert.equal(payload, xml);
      return structuredClone(standard);
    },
    verify: input.verify,
  };
  const report = normalizeExecutionReport(xml, input.context, adapter);
  const result = evaluateReadiness(input.specification, [report], input.selection);
  assert.equal(result.status, 'Passed');
  const bundle = createEvidenceBundle(result);
  const expected = { specification: input.specification, context: input.selection };
  assert.equal(readEvidenceBundle(bundle, expected,
    { 'consumer-xml-v1': adapter }).evaluation.status, 'Passed');
  assert.throws(() => readEvidenceBundle(bundle, expected), { code: 'ADAPTER' });
  assert.throws(() => normalizeExecutionReport(xml, input.context,
    { id: 'consumer-xml-v1', normalize: 'load-untrusted-module' }), { code: 'ADAPTER' });
});

test('T-PRD037 unsafe source data is rejected until sanitized without altering case or assertion outcomes', () => {
  const input = fixture();
  const raw = input.report();
  raw.results[0].detail = 'MY_API_TOKEN="fake-sensitive-test-sentinel"';
  assert.throws(() => input.capture(raw), { code: 'UNSAFE' });
  const safe = sanitizeExecutionPayload(Buffer.from(canonical(raw)));
  input.register(safe);
  const report = normalizeExecutionReport(safe, input.context, input.verify);
  assert.equal(evaluateReadiness(input.specification, [report], input.selection).status, 'Passed');
  assert.ok(!canonical(report).includes('fake-sensitive-test-sentinel'));
  assert.equal(report.observations[0].status, 'Passed');
});

test('T-PRD070 readable reports expose successes, failures and bounded explicit overflow references', () => {
  const input = fixture({ count: 12, assertions: 3 });
  const raw = input.report();
  raw.results[0].status = 'Failed';
  raw.results[0].expectedMet = false;
  raw.results[0].detail = 'Expected exact value.\nObserved a different value.';
  raw.exitCode = 1;
  const result = evaluateReadiness(input.specification, [input.capture(raw)], input.selection);
  const text = renderReadinessReport(result);
  assert.ok(text.includes('Failed'));
  assert.ok(text.includes('Passed'));
  assert.ok(text.includes('Expected exact value.'));
  const bounded = renderReadinessReport(result, {
    maxBytes: 2048, completeReportRef: 'validation-bundle:declared-retained-report',
  });
  assert.ok(Buffer.byteLength(bounded) <= 2048);
  assert.ok(bounded.includes('Summary omitted'));
  assert.ok(bounded.includes('Complete report:'));
  assert.throws(() => renderReadinessReport(result, { maxBytes: 2048 }), { code: 'EVIDENCE' });
  assert.throws(() => renderReadinessReport(JSON.parse(JSON.stringify(result))), { code: 'EVIDENCE' });
});

test('T-PRD073 offline CLI evaluation reports origin gaps instead of accepting saved passing JSON', async () => {
  const input = fixture();
  const report = input.capture(input.report());
  const body = { specification: input.specification, context: input.selection,
    reports: [JSON.parse(JSON.stringify(report))] };
  const evaluated = await runCli(['readiness', 'evaluate'], {
    stdin: Readable.from([JSON.stringify(body)]),
  });
  assert.equal(evaluated.exitCode, 2);
  assert.equal(evaluated.result.status, 'NotRun');
  const readable = await runCli(['readiness', 'report'], {
    stdin: Readable.from([JSON.stringify(body)]),
  });
  assert.equal(readable.exitCode, 2);
  assert.ok(readable.result.markdown.includes('ORIGIN'));
  assert.ok(!Object.hasOwn(evaluated.result, 'approved'));
});
