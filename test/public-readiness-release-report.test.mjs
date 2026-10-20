export const validationDeclarations = {
  "schemaVersion": 1,
  "surfaces": [{"coverage": "direct", "paths": ["scripts/release-report.mjs"]}]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonical, digest } from '../src/core.mjs';
import { parseTestPlan, testSpecificationDigest } from '../src/artifacts.mjs';
import { normalizeExecutionReport, evaluateReadiness, validationInventoryDigest, createEvidenceBundle } from 'ai-sdlc-framework/evidence';
import { composeReadinessReport, fileReportReader, writeReadinessReport } from '../scripts/release-report.mjs';
import { compileValidationInventory } from '../scripts/validation-inventory.mjs';
import { deriveLocalSanitySpecification } from '../scripts/test-local-evidence.mjs';

const sourceCommit = 'a'.repeat(40);
const observedAt = '2026-10-19T10:30:00.000Z';
const now = '2026-10-19T11:00:00.000Z';
const planFile = path.resolve('docs/sdlc/public-readiness/test-plan.md');
const plan = await fs.readFile(planFile, 'utf8');
const definitions = parseTestPlan(plan);
const localInventory = await compileValidationInventory(path.resolve('.'));
const localSanity = deriveLocalSanitySpecification({ inventory: localInventory, testPlan: plan });
const nativeCases = new Set(['T-PRD014-LX', 'T-PRD014-WX', 'T-PRD014-MA', 'T-PRD014-MI', 'T-PRD060-MA', 'T-PRD060-MI', 'T-PRD087']);
const preCases = new Set(['T-PRD079-LX', 'T-PRD079-WX', 'T-PRD079-MA', 'T-PRD079-MI']);
const postCases = new Set(['T-PRD038-WX', 'T-PRD038-MA', 'T-PRD038-MI', 'T-PRD039-WX', 'T-PRD039-MA', 'T-PRD039-MI', 'T-PRD042']);
const acceptanceCases = new Set(['T-PRD012', 'T-PRD025', 'T-PRD026', 'T-PRD050', 'T-PRD053', 'T-PRD055', 'T-PRD056', 'T-PRD074', 'T-PRD081', 'T-PRD086', 'T-PRD089']);
function stage(definition) {
  return preCases.has(definition.id) ? 'R-PRE' : postCases.has(definition.id) ? 'R-POST' :
    acceptanceCases.has(definition.id) ? 'A' : definition.id === 'T-PRD019' ? 'OBSERVERS' : 'PR';
}

function fixture({ legacyLocal = false, finiteCase = localSanity.specification.cases[0], affectedOutcome,
  localProfile = localSanity.specification.profile, retainedObjects = [] } = {}) {
  const bytes = new Map();
  const facts = new Map();
  const expectations = {};
  const verifiers = {};
  const manifest = { schemaVersion: 1, kind: 'repository-readiness-inputs',
    candidate: { sourceCommit, testSpecDigest: testSpecificationDigest(plan) },
    checkpoints: {}, releaseHistory: [], limitations: ['Controlled producer fixtures are not actual hosted/native readiness'] };
  function retain(id, filename, value) {
    const data = Buffer.from(canonical(value));
    bytes.set(filename, data);
    return { id, filename, sha256: digest(data), size: data.length };
  }
  const selected = definitions.map(definition => ({ definition, local: false }));
  if (!legacyLocal) selected.push({ definition: finiteCase, local: true });
  for (const [index, { definition, local }] of selected.entries()) {
    const id = `joined-${index + 1}`;
    const executionId = local ? 'local-process' : id;
    const specification = local ?
      { ...localSanity.specification, profile: localProfile, cases: [structuredClone(definition), ...(affectedOutcome ? [{
        id: 'T-LOCAL-AFFECTED', conditions: ['AC-201.3', 'AC-213.11'],
        expectedDigest: digest('Controlled optional regression'), executionId,
        mode: 'automated', owner: 'agent', location: 'development-machine', checkpoint: 'pre-review',
        assertions: [{ id: 'controlled-affected', selector: { procedure: 'Controlled optional regression' } }],
      }] : [])] } :
      { schemaVersion: 1, profile: id, cases: [{
      id: definition.id, conditions: definition.conditions, expectedDigest: digest(definition.expected),
      executionId: id, mode: definition.mode, owner: definition.owner, location: definition.location,
      checkpoint: definition.checkpoint, assertions: [{ id: 'fixture-contract',
        selector: { procedure: `Controlled observation for ${definition.id}` } }],
    }] };
    const context = { candidateDigest: 'b'.repeat(64), testSpecDigest: manifest.candidate.testSpecDigest,
      configDigest: 'c'.repeat(64), inventoryDigest: validationInventoryDigest(specification),
      sources: [{ repositoryId: 'repository-17', revision: sourceCommit, contentDigest: 'd'.repeat(64) }],
      profile: specification.profile, environment: definition.environment ?? 'local', location: definition.location,
      mode: definition.mode, owner: definition.owner,
      native: { kind: 'fixture', platform: 'linux', architecture: 'x64', image: 'controlled-only',
        toolchain: { node: '22.23.3' } },
      producer: { provider: 'fixture', connection: 'independent-reader', scopeRef: 'repository-17',
        definitionRef: 'controlled-reporter', executionRef: id, attemptKind: 'known', attemptRef: '1' },
      attemptCapability: 'distinct', jobRef: id, artifacts: [] };
    const failed = local && affectedOutcome === 'Failed';
    const results = specification.cases.flatMap(selectedCase =>
      selectedCase.assertions.map(assertion => {
        const status = selectedCase.id === 'T-LOCAL-AFFECTED' ? affectedOutcome : 'Passed';
        return { testId: selectedCase.id, assertionId: assertion.id,
          selector: assertion.selector, expectedDigest: selectedCase.expectedDigest,
          checkpoint: selectedCase.checkpoint, status, expectedMet: status === 'Passed', observedAt,
          durationMs: 1, exitCode: selectedCase.mode === 'automated' ? status === 'Passed' ? 0 : 1 : null,
          detail: 'A controlled producer observation, not actual native/provider or user completion proof' };
      })).map((result, index) => ({ ...result, sourceSequence: index + 1 }));
    const raw = { schemaVersion: 1, kind: 'test-execution', context,
      startedAt: observedAt, observedAt, finishedAt: observedAt,
      sequence: results.length, complete: true,
      exitCode: definition.mode === 'automated' ? failed ? 1 : 0 : null, results };
    const verify = input => facts.get(input.reportDigest) ?? null;
    facts.set(digest(Buffer.from(canonical(raw))), { verifierId: 'controlled-host', reportDigest: digest(Buffer.from(canonical(raw))),
      context, sourceTime: observedAt, sourceSequence: raw.sequence });
    const report = normalizeExecutionReport(raw, context, verify);
    const selection = { profile: specification.profile, executions: [{ id: executionId, context }], now,
      policy: { maxAgeMs: 3_600_000, revisionPolicy: 'exact', verifierIds: ['controlled-host'] } };
    const evaluation = evaluateReadiness(specification, [report], selection);
    assert.equal(evaluation.status, failed ? 'Failed' : 'Passed', definition.id);
    const ref = retain(id, `reports/${id}.json`, createEvidenceBundle(evaluation, index === 0 ? retainedObjects : []));
    const destination = local || legacyLocal && stage(definition) === 'PR' &&
      !nativeCases.has(definition.id) ? 'L' : stage(definition);
    (manifest.checkpoints[destination] ??= []).push(ref);
    expectations[id] = { specification, context: selection };
    verifiers[id] = verify;
  }
  manifest.benchmark = retain('benchmark', 'benchmark.json', { kind: 'validation-benchmark-comparison',
    comparability: 'equivalent', status: 'Passed', comparisons: [{ scope: 'critical', repeat: 1,
      baselineMs: 200, candidateMs: 100, deltaMs: -100, ratio: 2 }] });
  manifest.protections = retain('protections', 'protections.json', { status: 'Passed', contexts: ['framework/validation'] });
  manifest.releaseHistory.push(
    retain('failed-attempt', 'release/attempt-1.json', { status: 'Failed',
      invocationRef: 'https://github.com/urmich/ai-sdlc-framework/actions/runs/101/attempts/1',
      cases: [{ testId: 'T-PRD038-WX', status: 'Failed' }] }),
    retain('recovered-attempt', 'release/attempt-2.json', { status: 'Passed',
      invocationRef: 'https://github.com/urmich/ai-sdlc-framework/actions/runs/101/attempts/2',
      cases: [{ testId: 'T-PRD038-WX', status: 'Passed' }] }));
  const observation = async ({ data, sha256, expected }) => ({ verifierId: 'controlled-host',
    reportDigest: sha256, bindingDigest: digest(expected), outcome: data.status });
  const read = async ref => bytes.get(ref.filename);
  const input = { manifest, plan, read, expectations, verifiers, localInventory, now,
    benchmarkVerifier: observation, protectionVerifier: observation, releaseVerifier: observation };
  return { input, manifest, bytes, expectations, verifiers, read };
}

test('T-PRD037 joined readable readiness retains the complete canonical denominator, timings, protections and failed original recovery', async () => {
  const f = fixture();
  Object.assign(f.manifest.candidate, { sourceDigest: 'd'.repeat(64), configurationDigest: 'c'.repeat(64) });
  const before = [...f.bytes].map(([name, bytes]) => [name, digest(bytes)]);
  const { report, markdown } = await composeReadinessReport(f.input);
  assert.equal(report.status, 'Passed', JSON.stringify(report.checkpoints.map(row => row.blockers)));
  assert.equal(report.checkpoints.length, 5);
  assert.equal(report.checkpoints.filter(row => row.stage !== 'L').reduce((sum, row) => sum + row.totals.required, 0) +
    report.observers.reduce((sum, row) => sum + row.totals.required, 0), definitions.length);
  assert.equal(report.logicalPlanCases, definitions.length);
  assert.equal(report.checkpoints.find(row => row.stage === 'L').totals.required, 1);
  assert.equal(report.localSanity.requiredAssertions, 27);
  assert.deepEqual(report.checkpoints.filter(row => row.stage !== 'L').map(row => row.totals.required), [76, 4, 7, 11]);
  assert.ok(report.observers[0].cases.some(row => row.testId === 'T-PRD019'));
  assert.equal(report.releaseHistory[0].data.status, 'Failed');
  assert.equal(report.releaseHistory[1].data.status, 'Passed');
  assert.equal(report.protections.assessment, 'Passed');
  assert.deepEqual(report.benchmark.comparisons, JSON.parse(f.bytes.get('benchmark.json')).comparisons);
  assert.match(markdown, /baseline 200 ms; candidate 100 ms; delta -100 ms; measured ratio 2/u);
  assert.match(markdown, /T-PRD038-WX: Failed \(original historical outcome\)/u);
  assert.match(markdown, /grants no lifecycle, merge, publication or deployment authority/u);
  assert.deepEqual([...f.bytes].map(([name, bytes]) => [name, digest(bytes)]), before);
});

test('T-PRD054 saved Passed summaries, partial local scope, missing and stale evidence cannot manufacture joined readiness', async () => {
  for (const mode of ['no-origin', 'no-expectation', 'missing', 'corrupt', 'stale',
    'wrong-current-source', 'wrong-current-content', 'wrong-current-configuration']) {
    const f = fixture();
    const ref = f.manifest.checkpoints.PR[0];
    if (mode === 'no-origin') delete f.verifiers[ref.id];
    if (mode === 'no-expectation') delete f.expectations[ref.id];
    if (mode === 'missing') f.bytes.delete(ref.filename);
    if (mode === 'corrupt') f.bytes.set(ref.filename, Buffer.from('{}'));
    if (mode === 'stale') f.input.now = '2026-10-20T12:00:00.000Z';
    if (mode === 'wrong-current-source') f.manifest.candidate.sourceCommit = 'f'.repeat(40);
    if (mode === 'wrong-current-content') f.manifest.candidate.sourceDigest = 'f'.repeat(64);
    if (mode === 'wrong-current-configuration') f.manifest.candidate.configurationDigest = 'f'.repeat(64);
    const { report } = await composeReadinessReport(f.input);
    assert.equal(report.status, 'NotRun', mode);
    const pr = report.checkpoints.find(row => row.stage === 'PR');
    assert.equal(pr.status, 'NotRun', mode);
    assert.equal(pr.totals.required, 76, mode);
    assert.ok(pr.cases.some(row => row.status === 'NotRun'), mode);
  }
  const partial = fixture();
  partial.manifest.checkpoints.L = [];
  const { report } = await composeReadinessReport(partial.input);
  const local = report.checkpoints.find(row => row.stage === 'L');
  assert.equal(local.status, 'NotRun');
  assert.equal(local.totals.required, 1);
  assert.equal(local.scope, 'finite-local-sanity');
  for (const mode of ['missing-source', 'missing-assertion', 'foreign-selector', 'wrong-profile']) {
    const finiteCase = structuredClone(localSanity.specification.cases[0]);
    if (mode === 'missing-assertion') finiteCase.assertions.pop();
    if (mode === 'foreign-selector') finiteCase.assertions[0].selector.name = 'A different source assertion';
    const changed = fixture({ finiteCase, ...(mode === 'wrong-profile' ? { localProfile: 'an-opt-in-profile' } : {}) });
    if (mode === 'missing-source') delete changed.input.localInventory;
    const result = await composeReadinessReport(changed.input);
    const sanity = result.report.checkpoints.find(row => row.stage === 'L');
    assert.equal(sanity.status, 'NotRun', mode);
    assert.ok(sanity.blockers.length, mode);
  }
});

test('T-PRD054 legacy broad local observations cannot satisfy finite sanity or orphan required PR regressions', async () => {
  const f = fixture({ legacyLocal: true });
  delete f.input.localInventory;
  const { report } = await composeReadinessReport(f.input);
  const local = report.checkpoints.find(row => row.stage === 'L');
  const pr = report.checkpoints.find(row => row.stage === 'PR');
  const acceptance = report.checkpoints.find(row => row.stage === 'A');
  assert.equal(local.status, 'NotRun');
  assert.equal(local.scope, 'finite-local-sanity');
  assert.ok(local.blockers.some(reason => /independent.*finite.*sanity/iu.test(reason)));
  assert.ok(pr.cases.some(row => row.testId === 'T-PRD005'));
  assert.ok(pr.cases.some(row => row.testId === 'T-PRD041'));
  assert.ok(pr.cases.some(row => row.testId === 'T-PRD087'));
  assert.ok(pr.cases.some(row => row.testId === 'T-PRD088'));
  assert.ok(acceptance.cases.some(row => row.testId === 'T-PRD050'));
  assert.ok(acceptance.cases.some(row => row.testId === 'T-PRD089'));
  assert.deepEqual(report.observers.flatMap(row => row.cases.map(test => test.testId)), ['T-PRD019']);
  for (const affectedOutcome of ['Passed', 'Failed']) {
    const affected = fixture({ affectedOutcome });
    const result = await composeReadinessReport(affected.input);
    const sanity = result.report.checkpoints.find(row => row.stage === 'L');
    assert.equal(sanity.status, 'Passed', affectedOutcome);
    assert.equal(sanity.totals.required, 1, affectedOutcome);
    assert.equal(result.report.localSanity.requiredAssertions, 27, affectedOutcome);
    assert.deepEqual(sanity.additionalChecks.map(test => [test.testId, test.status]),
      [['T-LOCAL-AFFECTED', affectedOutcome]], affectedOutcome);
    assert.equal(result.report.status, affectedOutcome, affectedOutcome);
  }
});

test('T-PRD054 incomparable or unverified timings and unenforced protections stay distinct from successful evidence generation', async () => {
  for (const mode of ['unverified', 'incomparable', 'failed-benchmark', 'protection-failed', 'release-failed']) {
    const f = fixture();
    if (mode === 'unverified') f.input.benchmarkVerifier = undefined;
    if (mode === 'incomparable') {
      const value = { ...JSON.parse(f.bytes.get('benchmark.json')), comparability: 'incomparable' };
      const bytes = Buffer.from(canonical(value));
      f.bytes.set('benchmark.json', bytes);
      Object.assign(f.manifest.benchmark, { sha256: digest(bytes), size: bytes.length });
    }
    if (mode === 'failed-benchmark') f.input.benchmarkVerifier = async input => ({
      verifierId: 'controlled-host', reportDigest: input.sha256, bindingDigest: digest(input.expected), outcome: 'Failed' });
    if (mode === 'protection-failed') f.input.protectionVerifier = async input => ({
      verifierId: 'controlled-host', reportDigest: input.sha256, bindingDigest: digest(input.expected), outcome: 'Failed' });
    if (mode === 'release-failed') f.manifest.releaseHistory.pop();
    const { report } = await composeReadinessReport(f.input);
    assert.equal(report.generationStatus, 'Complete');
    assert.equal(report.status, ['failed-benchmark', 'protection-failed', 'release-failed'].includes(mode) ? 'Failed' : 'NotRun', mode);
    if (['unverified', 'incomparable', 'failed-benchmark'].includes(mode)) assert.deepEqual(report.benchmark.comparisons, []);
    if (mode === 'protection-failed') {
      assert.equal(report.protections.status, 'Verified');
      assert.equal(report.protections.assessment, 'Failed');
    }
  }
});

test('T-PRD037 clean data-only report regeneration requires immutable literal files and writes truthful unverified defaults', async t => {
  const capacity = fixture({ retainedObjects: [0, 1].map(index => ({
    schemaVersion: 1, kind: 'capacity-fixture', index, text: 'x'.repeat(2_200_000),
  })) });
  const large = capacity.manifest.checkpoints.PR[0];
  assert.ok(large.size > 4 * 1024 * 1024);
  delete capacity.verifiers[large.id];
  const restored = await composeReadinessReport(capacity.input);
  const pr = restored.report.checkpoints.find(row => row.stage === 'PR');
  assert.equal(restored.report.status, 'NotRun');
  assert.ok(pr.reports.some(row => row.id === large.id && row.status === 'NotRun'));
  assert.ok(pr.blockers.some(reason => reason === `Unverified producer: ${large.id}`));
  assert.ok(!pr.blockers.some(reason => /CAPACITY|unsafe diagnostics/u.test(reason)));
  const oversized = Buffer.from(canonical({ kind: 'validation-benchmark-comparison',
    status: 'Passed', comparability: 'equivalent', text: 'x'.repeat(4_400_000) }));
  capacity.bytes.set('oversized-benchmark.json', oversized);
  capacity.manifest.benchmark = { id: 'oversized-benchmark', filename: 'oversized-benchmark.json',
    sha256: digest(oversized), size: oversized.length };
  const rejected = await composeReadinessReport(capacity.input);
  assert.equal(rejected.report.benchmark.status, 'NotRun');
  assert.ok(rejected.report.blockers.some(reason => reason.startsWith('benchmark:')));
  const f = fixture();
  const directory = path.resolve('.test-data', `joined-report-${randomUUID()}`);
  await fs.mkdir(directory, { recursive: true });
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  for (const [filename, bytes] of f.bytes) {
    const file = path.join(directory, ...filename.split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, bytes, { flag: 'wx' });
  }
  const manifestFile = path.join(directory, 'manifest.json');
  await fs.writeFile(manifestFile, canonical(f.manifest));
  const outputDir = path.join(directory, 'output');
  const result = await writeReadinessReport({ manifestFile, planFile, outputDir, now });
  assert.equal(result.report.status, 'NotRun', 'A clean CLI cannot trust saved Passed flags without independent adapters');
  assert.equal(JSON.parse(await fs.readFile(path.join(outputDir, 'readiness.json'))).status, 'NotRun');
  assert.match(await fs.readFile(path.join(outputDir, 'readiness.md'), 'utf8'), /Overall current readiness: \*\*NotRun\*\*/u);
  const reader = await fileReportReader(directory);
  const ref = f.manifest.checkpoints.PR[0];
  assert.deepEqual(await reader(ref), f.bytes.get(ref.filename));
  await fs.appendFile(path.join(directory, ...ref.filename.split('/')), '\n');
  await assert.rejects(reader(ref), /changed|digest/u);
  await assert.rejects(reader({ ...ref, filename: '../outside.json' }), /bounded immutable data reference/u);
});
