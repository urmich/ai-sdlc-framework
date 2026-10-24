export const validationDeclarations = {
  "schemaVersion": 1,
  "surfaces": [
    {"coverage": "direct", "paths": ["scripts/github-readiness-host.mjs", "scripts/pr-observer.mjs"]},
    {"coverage": "process", "paths": ["scripts/read-validation-artifact.py"]}
  ],
  "groups": [{
    "root": "T-PRD021 versioned twenty-five twenty-four and twenty-part originals require exact closures cleanup and protected SDK replay",
    "minimumSlots": 4
  }, {
    "root": "T-PRD021 protocol row pool drains failed children stops dispatch and respects one-slot fallback",
    "minimumSlots": 2
  }],
  "applicability": [{
    "names": ["T-PRD021 protocol row pool drains failed children stops dispatch and respects one-slot fallback"],
    "platforms": ["linux-x64", "windows-x64", "macos-arm64", "macos-x64"],
    "owner": "runner-resource-contract",
    "reason": "PR-only controlled Node children prove failure drain and overlap before testing a serial fallback; no external tools or credentials.",
    "prerequisites": ["Aggregate test-worker capacity of at least two"]
  }]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { digest } from '../src/core.mjs';
import { canonical } from '../src/core.mjs';
import { observerApiFixture, nativeReplayFixture } from './readiness-observer-fixture.mjs';
import { reconcilePrReadiness } from '../scripts/pr-readiness.mjs';
import { readTrustedMinimumNodeJob, renderObserverSummary, retainObserverResult,
  nativeLaneTimings, verifyNativeCleanup, verifyOriginalNativeRows, inspectWorkflowTrust } from '../scripts/pr-observer.mjs';
import { nativeStageSelections, nativeConfigurationDigest, replayNativeEvidence,
  validateNativePreviousLifecycle, nativeWorkflowContract, nativeSpecification,
  verifyNativeShardUnitOrder, nativeFrameworkShardProtocol,
  nativeLegacyFrameworkShardProtocol, nativeFourBodyFrameworkShardProtocol, nativeFrameworkShardPlan,
  nativePlatformUnitFrameworkShardProtocol, nativePrPartsForProtocol } from '../scripts/native-validation.mjs';
import { testSpecificationDigest } from '../src/artifacts.mjs';
import { validationInventoryDigest, normalizeExecutionReport, evaluateReadiness } from 'ai-sdlc-framework/evidence';
import { calculatorFiles } from '../scripts/pr-calculator.mjs';
import { deriveNativeComponentSpecification, nativeComponentSelection,
  projectNativeComponentEvidence, replayNativeComponentEvidence } from '../scripts/native-components.mjs';
import { compileValidationSourceInventory } from '../scripts/validation-inventory.mjs';
import { nativeBootstrapProtocol, nativeBodyBootstrapProtocol, nativeUnitBootstrapProtocol } from '../scripts/toolchain-baseline.mjs';
import { runProtocolPool, reconcileProtocolRows } from './readiness-protocol-pool.mjs';
import { protocolPairs } from './readiness-protocol-row.mjs';

test('T-PRD021 source-bound role bootstrap preserves all producer origins and thirteen independent Mac cleanups', async t => {
  for (const protocol of ['native-bootstrap-role-capabilities-v3', nativeUnitBootstrapProtocol,
    nativeBodyBootstrapProtocol, nativeBootstrapProtocol]) {
  const f = await observerApiFixture(t, { frameworkShards: true, bootstrapProtocol: protocol,
    nodeArtifactReader: true });
  const { host, client } = f.connect();
  const observed = verdict(await host.snapshot());
  assert.equal(observed.status, 'Passed', JSON.stringify(observed.blockers));
  const metadata = (await client.list(`/actions/runs/${f.run.id}/artifacts?per_page=100`, 'artifacts'))[0];
  for (const options of [{ kind: 'cleanup', ownedPrefix: 'false' },
    { kind: 'cleanup', ownedPrefix: 0 }, { kind: 'cleanup', expectedTools: false }]) {
    await assert.rejects(client.artifact(metadata, options), { code: 'INPUT' });
  }
  assert.equal(f.parts.size, 25);
  assert.equal(f.cleanupReports.size, 13);
  const prefixes = [];
  for (const part of f.parts.values()) {
    const bootstrap = part.data.get('toolchain.json');
    if (part.component === 'framework') {
      assert.equal(bootstrap.native.bootstrapCapability.role, part.role);
      assert.equal(bootstrap.native.runtimeProvider.provider, 'actions/setup-node');
      if (part.target.startsWith('macos-') && bootstrap.native.homebrew) {
        assert.equal(bootstrap.native.homebrew.nodeProvisioned, false);
        assert.equal(Object.hasOwn(bootstrap.native.homebrew, 'nodePrefix'), false);
      }
    } else {
      assert.equal(bootstrap.native.homebrew.node.version, '24.20.0');
      assert.equal(Object.hasOwn(bootstrap.native, 'bootstrapCapability'),
        [nativeBodyBootstrapProtocol, nativeBootstrapProtocol].includes(protocol));
      if ([nativeBodyBootstrapProtocol, nativeBootstrapProtocol].includes(protocol)) {
        assert.equal(Object.hasOwn(bootstrap.native, 'go'), false);
        assert.equal(Object.hasOwn(bootstrap.native, 'python'), false);
        assert.equal(Object.hasOwn(bootstrap.native, 'schemaPackages'), false);
      }
    }
    if (f.cleanupReports.has(part.role)) {
      const entries = f.cleanupReports.get(part.role);
      const data = { ...Object.fromEntries(entries), texts: Object.fromEntries([...entries]
        .map(([file, value]) => [file, typeof value === 'string' ? value : canonical(value)])) };
      const expected = { inventory: f.source.inventory, plan: f.source.plan,
        ...part, bootstrapProtocol: protocol, jobKey: part.jobKey };
      const checked = verifyNativeCleanup(data, expected);
      if (['native-mi-refresh', 'native-homebrew-mi', 'native-ma-refresh', 'native-mi-retained'].includes(part.jobKey)) {
        const staleJob = structuredClone(data);
        staleJob['native-homebrew-prefix-request.json'].binding.github.GITHUB_JOB =
          part.component === 'homebrew' ? 'native-homebrew' :
            part.target === 'macos-arm64' ? 'native-ma' : 'native-mi';
        assert.throws(() => verifyNativeCleanup(staleJob, expected), { code: 'EVIDENCE' });
      }
      if (checked.prefix) prefixes.push(checked.prefix);
      else {
        assert.equal(checked.status, 'not-required');
        for (const file of ['native-homebrew-prefix-allocation.json', 'native-homebrew-prefix-cleanup.json']) {
          const invented = structuredClone(data);
          invented[file] = { status: 'Passed', prefix: '/opt/abcde' };
          assert.throws(() => verifyNativeCleanup(invented, expected), { code: 'EVIDENCE' });
        }
        const foreign = structuredClone(data);
        foreign['native-homebrew-prefix-request.json'].binding.github.GITHUB_RUN_ATTEMPT = '2';
        assert.throws(() => verifyNativeCleanup(foreign, expected), { code: 'EVIDENCE' });
      }
      if (part.component === 'framework' && checked.prefix) {
        const borrowed = structuredClone(data);
        borrowed['toolchain.json'].native.homebrew.prefix = '/opt/fffff';
        assert.throws(() => verifyNativeCleanup(borrowed, expected), { code: 'EVIDENCE' });
        assert.throws(() => verifyNativeCleanup(data, { ...expected, bootstrapProtocol: null }), { code: 'EVIDENCE' });
      }
    }
  }
  assert.equal(prefixes.length, [nativeBodyBootstrapProtocol, nativeBootstrapProtocol].includes(protocol) ? 2 :
    protocol === nativeUnitBootstrapProtocol ? 8 : 13);
  assert.equal(new Set(prefixes).size, prefixes.length);
  const retained = host.componentEvidence();
  assert.equal(retained[0].projection.definition.bootstrapProtocol, protocol);
  assert.equal(retained[0].projection.provenance.length, 23);
  if (protocol === nativeBootstrapProtocol) {
    const required = [...f.parts.values()].find(part => part.data.get('toolchain.json').native.cryptoFixture);
    const omitted = [...f.parts.values()].find(part => !part.data.get('toolchain.json').native.cryptoFixture);
    for (const [part, mutate] of [
      [required, value => { value.native.cryptoFixture.trustSha256 = '0'.repeat(64); }],
      [required, value => { value.native.bootstrapCapability.tools.crypto = false; }],
      [omitted, value => { value.native.cryptoFixture = { status: 'NotRequired' }; }],
      [omitted, value => { value.native.bootstrapCapability.tools.crypto = 'false'; }],
    ]) {
      const original = part.data.get('toolchain.json');
      const altered = structuredClone(original);
      mutate(altered);
      part.data.set('toolchain.json', altered);
      f.refresh(part.role);
      assert.notEqual(verdict(await host.snapshot()).status, 'Passed');
      part.data.set('toolchain.json', original);
      f.refresh(part.role);
    }
  }
  }
});

test('T-PRD021 native component projection retains four verified original platforms and replays exact source-bound SDK evidence', async t => {
  const f = await observerApiFixture(t);
  const { host } = f.connect();
  assert.equal(verdict(await host.snapshot()).status, 'Passed');
  const retained = host.componentEvidence();
  assert.equal(retained.length, 1);
  const projection = retained[0].projection;
  const definition = deriveNativeComponentSpecification({ inventory: f.source.inventory,
    testPlan: f.source.plan, adapterSourceDigest: digest(f.source.files.get('scripts/native-components.mjs')) });
  assert.deepEqual(projection.definition, definition);
  const expectedLanes = [...f.lanes.values()].map(lane => ({ target: lane.target, context: lane.context }));
  const originals = [...f.lanes.values()].map(lane => ({
    target: lane.target, text: canonical(lane.data.get('execution.json')),
  }));
  const verifyOriginal = input => {
    const original = originals.find(original => original.target === input.target);
    const raw = original && JSON.parse(original.text);
    return raw && input.reportDigest === digest(original.text) &&
      digest(input.claimedContext) === digest(raw.context) ? {
        verifierId: 'github-actions-observer', reportDigest: input.reportDigest,
        context: raw.context, sourceTime: raw.observedAt, sourceSequence: raw.sequence,
      } : null;
  };
  const inputs = { definition, expectedLanes, originals, verifyOriginal,
    now: projection.selection.now };
  const selected = nativeComponentSelection(inputs);
  assert.deepEqual(selected, projection.selection);
  assert.equal(projection.evaluation.status, 'Passed');
  assert.equal(projection.provenance.length, 4);
  assert.ok(projection.evaluation.cases.length > 0);
  assert.ok(projection.evaluation.cases.every(test => test.assertions.length === 4 && test.status === 'Passed'));
  for (const original of projection.originals) {
    const raw = JSON.parse(original.text);
    assert.equal(raw.context.location, 'github-pr-matrix');
    assert.equal(raw.context.native.kind, 'metadata', 'The derived view never invents a fifth native execution');
    assert.equal(raw.context.native.toolchain.matrix.length, 4);
    assert.equal(raw.observedAt, '2026-10-18T10:00:51.000Z');
    for (const row of raw.results) {
      const lane = f.lanes.get(row.selector.target);
      const source = lane.data.get('execution.json').results.find(source =>
        source.testId === `T-PRD014-${{ 'linux-x64': 'LX', 'windows-x64': 'WX',
          'macos-arm64': 'MA', 'macos-x64': 'MI' }[row.selector.target]}` &&
        source.assertionId === row.selector.sourceAssertionId);
      assert.equal(row.observedAt, source.observedAt);
      assert.equal(row.status, source.status);
    }
  }
  assert.equal(replayNativeComponentEvidence({ ...inputs, bundle: projection.bundle }).evaluation.status, 'Passed');
  assert.equal(projectNativeComponentEvidence({ ...inputs, originals: originals.slice(0, 1) }).evaluation.status, 'NotRun');
  const partial = originals.map(original => ({ ...original }));
  const partialRaw = JSON.parse(partial[0].text);
  partialRaw.complete = false;
  partialRaw.finishedAt = null;
  partialRaw.exitCode = 2;
  partial[0].text = JSON.stringify(partialRaw);
  const verifyControlledChanged = input => {
    const raw = JSON.parse(partial.find(original => original.target === input.target).text);
    return { verifierId: 'controlled-partial-original-fixture', reportDigest: input.reportDigest,
      context: raw.context, sourceTime: raw.observedAt, sourceSequence: raw.sequence };
  };
  assert.equal(projectNativeComponentEvidence({ ...inputs, originals: partial,
    verifyOriginal: verifyControlledChanged }).evaluation.status, 'NotRun');
  const outerOnly = originals.map(original => {
    const raw = JSON.parse(original.text);
    raw.results = [];
    return { ...original, text: JSON.stringify(raw) };
  });
  assert.equal(projectNativeComponentEvidence({ ...inputs, originals: outerOnly,
    verifyOriginal: input => {
      const raw = JSON.parse(outerOnly.find(original => original.target === input.target).text);
      return { verifierId: 'controlled-outer-only-fixture', reportDigest: input.reportDigest,
        context: raw.context, sourceTime: raw.observedAt, sourceSequence: raw.sequence };
    } }).evaluation.status, 'NotRun');
  const swapped = originals.map(original => ({ ...original }));
  swapped[0].text = swapped[1].text;
  assert.throws(() => projectNativeComponentEvidence({ ...inputs, originals: swapped }), { code: 'EVIDENCE' });
  const changedSource = { ...definition, sourceInventoryDigest: '0'.repeat(64) };
  const { adapterDefinitionDigest: previousDigest, ...changedInputs } = changedSource;
  changedSource.adapterDefinitionDigest = digest(changedInputs);
  assert.throws(() => projectNativeComponentEvidence({ ...inputs, definition: changedSource }), { code: 'EVIDENCE' });
  assert.equal(replayNativeComponentEvidence({ ...inputs, bundle: projection.bundle,
    now: '2026-10-20T10:01:00.000Z' }).evaluation.status, 'NotRun');
  const output = path.join(f.root, 'retained-components');
  await retainObserverResult({ status: 'Passed', results: [] }, output, { componentEvidence: retained });
  const manifest = JSON.parse(await fs.readFile(path.join(output, 'observer-result.json'), 'utf8'));
  assert.equal(manifest.components[0].adapterDefinitionDigest, definition.adapterDefinitionDigest);
  assert.equal(manifest.components[0].nativeOriginals.length, 4);
  assert.equal(manifest.components[0].sourceArtifacts.length, 4);
  for (const original of manifest.components[0].nativeOriginals) {
    assert.equal(await fs.readFile(path.join(output, original.filename), 'utf8'),
      originals.find(source => source.target === original.target).text);
  }
  const saved = JSON.parse(await fs.readFile(path.join(output, manifest.components[0].bundle.filename), 'utf8'));
  assert.equal(replayNativeComponentEvidence({ ...inputs, bundle: saved }).evaluation.status, 'Passed');
  await assert.rejects(retainObserverResult({ status: 'Passed', results: [] },
    path.join(f.root, 'forged-components'), { componentEvidence: [{ ...retained[0],
      projection: JSON.parse(JSON.stringify(projection)) }] }), { code: 'EVIDENCE' });
  const source = 'export const validationDeclarations=' + JSON.stringify({ schemaVersion: 1,
    plannedCases: [{ id: 'T-PRD006', selectors: [{ name: 'causal child', parents: ['T-PRD005 causal root'] }] }] }) +
    ';import test from "node:test";test("T-PRD005 causal root",async t=>{' +
    'await t.test("causal child",()=>{});await t.test("second child",()=>{});});';
  const inventory = compileValidationSourceInventory({
    files: [...f.source.inventory.sourceFiles.map(source => ({
      file: source.file, contents: f.source.files.get(source.file),
    })), { file: 'test/component.test.mjs', contents: source }],
    surfacePaths: [...f.source.files.keys(), 'test/component.test.mjs'],
  });
  const testPlan = JSON.stringify({ tests: ['T-PRD005', 'T-PRD006'].map(id => ({
    id, requirements: ['FR-203'], conditions: ['AC-203.4'], environment: 'local', level: 'integration',
    checkpoint: 'post-review', mode: 'automated', owner: 'provider', location: 'github-pr-matrix',
    expected: 'Complete original causal root on every applicable platform',
    implementation: 'test/component.test.mjs', status: 'NotRun',
  })) });
  const inherited = deriveNativeComponentSpecification({ inventory, testPlan, adapterSourceDigest: 'a'.repeat(64) });
  assert.ok(inherited.specification.cases.every(test => test.assertions.length === 12),
    'Prefix inheritance and explicit child binding both preserve the complete three-assertion causal root across four hosts');
  f.assertReadOnly();
});

test('T-PRD021 unbound native component procedures remain required NotRun rather than borrowing outer success', async t => {
  const f = await observerApiFixture(t, { additionalTests: [{
    id: 'T-FIX-UNBOUND', requirements: ['FR-203'], conditions: ['AC-203.4'], environment: 'local',
    level: 'integration', checkpoint: 'post-review', mode: 'automated', owner: 'provider',
    location: 'github-pr-matrix', expected: 'An actual bound required component procedure',
    implementation: 'procedure: unavailable-required-component', status: 'NotRun',
  }] });
  const { host } = f.connect();
  const result = verdict(await host.snapshot());
  assert.equal(result.status, 'NotRun');
  const projection = host.componentEvidence()[0].projection;
  const missing = projection.evaluation.cases.find(test => test.testId === 'T-FIX-UNBOUND');
  assert.equal(missing.status, 'NotRun');
  assert.equal(missing.assertions.length, 1);
  assert.ok(projection.blockers.some(blocker => blocker.testId === 'T-FIX-UNBOUND' &&
    blocker.code === 'MISSING_COMPONENT_BINDING'));
  f.assertReadOnly();
});

const verdict = snapshot => snapshot.prs[0].verdicts['framework/validation'];

test('T-PRD016 minimum-runtime prerequisite rejects missing failed skipped or unbound provider jobs despite four passing native lanes', async t => {
  const f = await observerApiFixture(t);
  const selected = f.jobs.find(job => job.name === nativeWorkflowContract.minimumNodeJob);
  const original = structuredClone(selected);
  const originalLogs = f.logs.get(selected.id);
  const expected = { runId: f.run.id, attempt: f.run.run_attempt,
    expectedHead: f.revisions.head, expectedMerge: f.revisions.merge };
  assert.deepEqual(readTrustedMinimumNodeJob(selected, originalLogs, expected), {
    jobId: selected.id, runId: f.run.id, attempt: f.run.run_attempt,
    headSha: f.revisions.head, mergeSha: f.revisions.merge,
  });
  assert.equal(f.jobs.filter(job => job.name.startsWith('native-') && job.conclusion === 'success').length, 6);
  for (const change of [
    () => { f.jobs.splice(f.jobs.indexOf(selected), 1); },
    () => { selected.conclusion = 'failure'; },
    () => { selected.conclusion = 'skipped'; },
    () => { selected.status = 'in_progress'; },
    () => { selected.run_attempt++; },
    () => { selected.head_sha = f.revisions.base; },
    () => { selected.labels = ['windows-2022']; },
    () => { selected.steps[2].name = 'Unrelated successful command'; },
    () => { selected.steps[2].conclusion = 'skipped'; },
    () => { selected.steps[3].conclusion = 'failure'; },
    () => { selected.steps[2].number = selected.steps[1].number; },
    () => { f.jobs.push(structuredClone(selected)); },
    () => { f.logs.set(selected.id, originalLogs.replaceAll(f.revisions.merge, f.revisions.head)); },
    () => { f.logs.set(selected.id, originalLogs.replaceAll('10:00:02', '10:00:20')); },
  ]) {
    Object.assign(selected, structuredClone(original));
    f.logs.set(selected.id, originalLogs);
    if (!f.jobs.includes(selected)) f.jobs.push(selected);
    change();
    const snapshot = await f.connect().host.snapshot();
    assert.equal(snapshot.complete, true);
    assert.equal(verdict(snapshot).status, 'NotRun');
    assert.ok(verdict(snapshot).blockers.some(message => /minimum-runtime/iu.test(message)));
    assert.equal(f.calls.some(call => /\/actions\/artifacts\/\d+\/zip$/u.test(new URL(call.url).pathname)), false,
      'An unproven prerequisite cannot borrow the passing native artifacts');
    f.jobs.splice(0, f.jobs.length, ...f.jobs.filter(job =>
      job.name !== nativeWorkflowContract.minimumNodeJob || job === selected));
  }
  Object.assign(selected, structuredClone(original));
  f.logs.set(selected.id, originalLogs);
  const artifact = structuredClone(f.artifacts.get('minimum-node'));
  for (const change of [
    () => { f.artifacts.delete('minimum-node'); },
    () => { f.artifacts.get('minimum-node').expired = true; },
    () => { f.artifacts.get('minimum-node').name = 'minimum-node-evidence-101-2'; },
    () => { f.artifacts.get('minimum-node').workflow_run.id++; },
    () => { f.artifacts.get('minimum-node').workflow_run.head_sha = f.revisions.base; },
    () => { f.artifacts.get('minimum-node').digest = null; },
  ]) {
    f.artifacts.set('minimum-node', structuredClone(artifact));
    change();
    const snapshot = await f.connect().host.snapshot();
    assert.equal(verdict(snapshot).status, 'NotRun');
    assert.ok(verdict(snapshot).blockers.some(message => /minimum-runtime/iu.test(message)));
    assert.equal(f.calls.some(call => /\/actions\/artifacts\/\d+\/zip$/u.test(new URL(call.url).pathname)), false);
  }
  f.assertReadOnly();
});

test('T-PRD016 API-only native admission composes six producer parts and four complete logical lanes without candidate execution', async t => {
  const f = await observerApiFixture(t);
  const definition = { plan: f.source.plan, inventory: f.source.inventory, goSources: f.source.goSources,
    target: 'linux-x64', profile: 'pr' };
  assert.equal(digest(nativeSpecification(definition)),
    digest(nativeSpecification({ ...definition, goSources: [...definition.goSources].reverse() })),
  'Native assertion order must not depend on filesystem versus API Git-tree Go source traversal');
  const stages = nativeStageSelections(f.source.inventory, f.source.plan);
  assert.ok(stages.every((stage, index) => stage.name === nativeWorkflowContract.stages[index]),
    'Producer report stage IDs must not be overwritten by selector regex names');
  const original = f.lanes.get('linux-x64').data;
  for (const stage of stages) {
    assert.ok(original.has(`${stage.name}.json`) && original.has(`${stage.name}-command.json`),
      `Original reports must use the stable ${stage.name} protocol ID`);
    assert.ok(stage.name === 'unit' || stage.args[1] === '--selection-file' &&
      stage.args[2] === stage.selection.path &&
      stage.selection.path.endsWith(`/${stage.selection.sha256}.json`) && stage.args.join(' ').length < 200,
    'Targeted transport must bind its exact source-derived selection without embedding it in argv');
    assert.deepEqual(original.get(`${stage.name}.json`).selection.namePatterns,
      stage.name === 'unit' ? [] : [stage.selectorName]);
  }
  const { host } = f.connect();
  const snapshot = await host.snapshot();
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.prs.length, 1);
  assert.equal(verdict(snapshot).status, 'Passed', JSON.stringify(verdict(snapshot).blockers));
  assert.deepEqual(verdict(snapshot).blockers, []);
  assert.equal(snapshot.prs[0].headSha, f.revisions.head);
  assert.equal(snapshot.prs[0].mergeSha, f.revisions.merge);
  assert.deepEqual(f.run.pull_requests, [], 'Association comes from actual adopted context/checkout logs, not an assumed API PR list');
  assert.equal(snapshot.prs[0].verdicts['framework/coverage'].status, 'Passed');
  assert.equal(snapshot.prs[0].verdicts['framework/approval'].status, 'Passed');
  assert.equal(await host.verifyWriterControl(), true);
  const downloads = f.calls.filter(call => /\/actions\/artifacts\/\d+\/zip$/u.test(new URL(call.url).pathname));
  assert.equal(downloads.length, 11, 'Frozen candidate, six original native artifacts and four guarded cleanup artifacts must be acquired');
  const retained = host.componentEvidence()[0];
  assert.equal(retained.nativeParts.length, 6);
  assert.equal(retained.nativeParts.filter(part => part.cleanupArtifactId).length, 4);
  assert.equal(new Set(retained.nativeParts.map(part => part.artifactId)).size, 6);
  assert.equal(new Set(retained.nativeParts.map(part => part.bootstrapArtifactId)).size, 6);
  assert.equal(new Set(retained.nativeParts.filter(part => part.cleanupArtifactId)
    .map(part => part.cleanupArtifactId)).size, 4);
  assert.ok(retained.laneTimings.every(lane => lane.durationMs === 80000 && lane.withinBudget &&
    lane.parts.every(part => part.providerQueueMs === null)));
  for (const job of f.jobs) {
    assert.ok(f.calls.some(call => new URL(call.url).pathname.endsWith(`/actions/jobs/${job.id}/logs`)));
  }
  assert.deepEqual(await fs.readdir(f.scratch), [], 'The real bounded reader cleans its exact owned scratch roots');
  f.assertReadOnly();
});

test('T-PRD016 API-only twenty-five-part admission restores both Intel unit origins and thirteen guarded cleanups', async t => {
  const f = await observerApiFixture(t, { frameworkShards: true });
  const { host, client } = f.connect();
  const helper = 'scripts/macos-runner-admission.mjs';
  const helperBytes = await fs.readFile(new URL(`../${helper}`, import.meta.url), 'utf8');
  const helperEntry = f.source.tree.find(entry => entry.path === helper);
  assert.ok(helperEntry);
  assert.equal(f.source.files.get(helper), helperBytes);
  for (const revision of [f.revisions.merge, f.revisions.trusted]) {
    const tree = await client.tree(revision);
    assert.equal(tree.paths.get(helper).sha, helperEntry.sha);
    assert.equal(await client.file(tree, helper), helperBytes,
      'Candidate and adopted API source must bind the actual registered helper blob, never a reporter stub');
  }
  const snapshot = await host.snapshot();
  assert.equal(verdict(snapshot).status, 'Passed', JSON.stringify(verdict(snapshot).blockers));
  const retained = host.componentEvidence()[0];
  assert.equal(retained.nativeParts.length, 25);
  assert.equal(retained.nativeParts.filter(part => part.cleanupArtifactId).length, 13);
  assert.equal(retained.sourceArtifacts.length, 23);
  assert.equal(retained.projection.provenance.length, 23);
  assert.ok(retained.laneTimings.every(lane => lane.durationMs === 180000));
  const output = path.join(f.root, 'current-api-retained');
  await retainObserverResult({ status: 'Passed', results: [] }, output, { componentEvidence: [retained] });
  const saved = JSON.parse(await fs.readFile(path.join(output, 'observer-result.json'), 'utf8')).components[0];
  assert.equal(saved.nativeOriginals.length, 23);
  assert.equal(saved.nativeParts.length, 25);
  assert.equal(new Set(saved.nativeOriginals.map(original => original.filename)).size, 23);
  assert.ok(saved.unitOrder);
  const blob = f.source.blobs.get(helperEntry.sha);
  const originalContent = blob.content;
  try {
    blob.content = Buffer.from(`${helperBytes}\n// Corrupted controlled API blob response.\n`).toString('base64');
    const fresh = f.connect().client;
    await assert.rejects(fresh.file(await fresh.tree(f.revisions.merge), helper), { code: 'EVIDENCE' });
  } finally { blob.content = originalContent; }
  for (const options of [
    { admissionHelper: 'missing' },
    { adoptedAdmissionHelper: 'missing' },
    { admissionHelper: 'missing', adoptedAdmissionHelper: 'missing' },
    { admissionHelper: 'mutated' },
    { adoptedAdmissionHelper: 'mutated' },
  ]) {
    const unadopted = await observerApiFixture(t, {
      frameworkShards: true, nodeArtifactReader: true, ambient: false, ...options,
    });
    const rejected = verdict(await unadopted.connect().host.snapshot());
    assert.equal(rejected.status, 'NotRun', JSON.stringify(options));
    assert.ok(rejected.blockers.includes('Producer definitions have not been maintainer-adopted'));
    assert.ok(!unadopted.calls.some(call =>
      /\/actions\/artifacts\/\d+\/zip$/u.test(new URL(call.url).pathname)));
    unadopted.assertReadOnly();
  }
  const historical = await observerApiFixture(t, { frameworkShards: true,
    shardProtocol: nativeLegacyFrameworkShardProtocol, nodeArtifactReader: true, ambient: false });
  assert.equal(historical.source.files.has(helper), false);
  assert.equal(verdict(await historical.connect().host.snapshot()).status, 'Passed');
  historical.assertReadOnly();
  const part = f.jobs.find(job => job.name === 'native-macos-x64-framework-units-1');
  part.steps.find(step => step.name === 'Remove owned short Homebrew prefix').conclusion = 'skipped';
  assert.equal(verdict(await f.connect().host.snapshot()).status, 'NotRun');
  part.steps.find(step => step.name === 'Remove owned short Homebrew prefix').conclusion = 'success';
  const extra = f.jobs.splice(f.jobs.indexOf(part), 1)[0];
  assert.equal(verdict(await f.connect().host.snapshot()).status, 'NotRun',
    'Six of seven successful Intel jobs cannot complete the new lane');
  f.jobs.push(extra);
  const cleanup = f.cleanupReports.get('macos-x64-framework-units-1');
  const borrowed = f.cleanupReports.get('macos-x64-framework-units').get('native-homebrew-prefix-cleanup.json');
  cleanup.set('native-homebrew-prefix-cleanup.json', structuredClone(borrowed));
  f.refreshCleanup('macos-x64-framework-units-1');
  assert.equal(verdict(await f.connect().host.snapshot()).status, 'NotRun',
    'The second Intel unit host cannot borrow the original unit host cleanup receipt');
  f.assertReadOnly();
});

test('T-PRD016 complete API admission rejects missing lanes artifacts originals and swapped native evidence', async t => {
  const f = await observerApiFixture(t);
  assert.equal(verdict(await f.connect().host.snapshot()).status, 'Passed');
  const originalJobs = [...f.jobs];
  const originalArtifacts = new Map(f.artifacts);
  f.jobs.splice(f.jobs.findIndex(job => job.name === 'native-macos-x64-framework'), 1);
  let result = verdict(await f.connect().host.snapshot());
  assert.equal(result.status, 'NotRun');
  assert.ok(result.blockers.some(message => /producer inventory|native job inventory/u.test(message)));
  f.jobs.splice(0, f.jobs.length, ...originalJobs);
  f.artifacts.delete('windows-x64');
  result = verdict(await f.connect().host.snapshot());
  assert.equal(result.status, 'NotRun');
  assert.ok(result.blockers.some(message => /producer role artifact|native report artifact/u.test(message)));
  f.artifacts.clear();
  for (const [key, value] of originalArtifacts) f.artifacts.set(key, value);
  const lane = f.lanes.get('linux-x64');
  const goFile = `${f.toolDirectory}/go-tests.json`;
  const originalGo = lane.data.get(goFile);
  lane.data.delete(goFile);
  f.refresh('linux-x64');
  result = verdict(await f.connect().host.snapshot());
  assert.equal(result.status, 'NotRun');
  assert.ok(result.blockers.some(message => message.includes('Original Go execution')));
  lane.data.set(goFile, originalGo);
  f.refresh('linux-x64');
  const mac = f.homebrewLanes.get('macos-arm64');
  const previous = structuredClone(mac.data.get('native-homebrew.json'));
  for (const change of [
    report => { report.previousMetadata.descriptor.sourceCommit = f.revisions.head; },
    report => { report.previousMetadata.checksums = report.previousMetadata.checksums.trimEnd(); },
    report => { report.evidence.previousIdentity.sourceCommit = f.revisions.head; },
  ]) {
    const changed = structuredClone(previous);
    change(changed);
    mac.data.set('native-homebrew.json', changed);
    f.refresh(mac.role);
    const snapshot = await f.connect().host.snapshot();
    result = verdict(snapshot);
    assert.equal(snapshot.complete, true);
    assert.equal(result.status, 'NotRun');
    assert.ok(result.blockers.some(message => message.includes('supported-previous identity')),
      'A tampered original byte/source identity must remain a per-PR verification blocker');
  }
  mac.data.set('native-homebrew.json', previous);
  f.refresh(mac.role);
  assert.equal(verdict(await f.connect().host.snapshot()).status, 'Passed');
  f.swap('macos-arm64', 'macos-x64');
  result = verdict(await f.connect().host.snapshot());
  assert.equal(result.status, 'NotRun');
  assert.ok(result.blockers.some(message => message.includes('Report context')));
  f.assertReadOnly();
});

test('T-PRD016 Mac part originals reject failed skipped swapped procedures and foreign or unproven cleanup without native execution', async t => {
  const f = await observerApiFixture(t);
  const role = 'macos-arm64-homebrew';
  const lane = f.parts.get(role);
  const originalData = new Map([...lane.data].map(([file, value]) => [file, structuredClone(value)]));
  const dictionary = entries => ({ ...Object.fromEntries(entries),
    texts: Object.fromEntries([...entries].map(([file, value]) =>
      [file, typeof value === 'string' ? value : canonical(value)])) });
  const input = { raw: lane.data.get('execution.json'), specification: lane.specification,
    inventory: f.source.inventory, goSources: f.source.goSources, target: lane.target, component: 'homebrew',
    candidate: f.candidate, sourceFiles: [...f.source.files].map(([file, contents]) => ({ file, contents })),
    plan: f.source.plan, context: lane.context };
  await verifyOriginalNativeRows({ ...input, data: dictionary(originalData) });
  for (const change of [
    data => { data.get('native-homebrew.json').nativeValidation = 'NotRun'; },
    data => { data.get('homebrew-command.json').exitCode = 1; },
    data => { data.get('homebrew-command.json').complete = false; },
    data => { data.get('homebrew-command.json').context = f.lanes.get(lane.target).context; },
    data => { data.delete('homebrew-command.json'); },
  ]) {
    const data = structuredClone(originalData);
    change(data);
    await assert.rejects(verifyOriginalNativeRows({ ...input, data: dictionary(data) }), { code: 'EVIDENCE' });
  }
  const originalSupport = f.cleanupReports.get(role);
  const expected = { target: lane.target, role, context: lane.context };
  assert.equal(verifyNativeCleanup(dictionary(originalSupport), expected).role, role);
  for (const change of [
    data => { data.delete('native-homebrew-prefix-cleanup.json'); },
    data => { data.get('native-homebrew-prefix-cleanup.json').status = 'rolled-back'; },
    data => { data.get('native-homebrew-prefix-cleanup.json').prefixIdentity.inode = 'different-prefix'; },
    data => { data.get('native-homebrew-prefix-request.json').binding.github.GITHUB_RUN_ATTEMPT = '2'; },
    data => { data.get('native-homebrew-prefix-request.json').binding.github.GITHUB_RUN_ID = '202'; },
    data => { data.get('native-homebrew-prefix-request.json').binding.github.GITHUB_REPOSITORY_ID = '33'; },
    data => { data.set('toolchain.json', f.lanes.get(lane.target).data.get('toolchain.json')); },
  ]) {
    const data = structuredClone(originalSupport);
    change(data);
    assert.throws(() => verifyNativeCleanup(dictionary(data), expected), { code: 'EVIDENCE' });
  }
  assert.equal(f.calls.length, 0, 'Node-only regressions never invoke provider acquisition, Python, Homebrew or native tests');
});

test('T-PRD020 logical native latency spans earliest required worker through the last independent cleanup and reports queue separately', () => {
  const targets = ['linux-x64', 'windows-x64', 'macos-arm64', 'macos-x64'];
  const epoch = Date.parse('2026-10-18T10:00:00.000Z');
  const at = seconds => new Date(epoch + seconds * 1000).toISOString();
  const parts = targets.flatMap(target =>
    (target.startsWith('macos-') ? ['framework', 'homebrew'] : ['full']).map((component, index) => ({
      target, role: component === 'full' ? target : `${target}-${component}`,
      job: { id: 100 + index, created_at: at(0), started_at: at(index ? 700 : 100),
        completed_at: at(index ? 1300 : 600) },
    })));
  const timings = nativeLaneTimings(parts, { frameworkShards: false });
  assert.ok(timings.filter(lane => lane.target.startsWith('macos-')).every(lane =>
    lane.durationMs === 1200000 && !lane.withinBudget && lane.parts.length === 2),
  'Both isolated parts are below fifteen minutes, but their complete required logical span is not');
  assert.deepEqual(timings[2].parts.map(part => part.providerQueueMs), [100000, 700000]);
  assert.throws(() => nativeLaneTimings(parts.slice(0, -1), { frameworkShards: false }), { code: 'EVIDENCE' });
});

test('T-PRD021 versioned twenty-five twenty-four and twenty-part originals require exact closures cleanup and protected SDK replay', async t => {
  const result = await runProtocolPool(t);
  assert.equal(result.rows.length, 17);
  t.diagnostic(JSON.stringify({ protocolPool: result }));
});

test('T-PRD021 protocol row outcomes reject missing duplicate unknown incomplete and source or pair mismatches', () => {
  const rows = protocolPairs.slice(0, 2);
  const sourceDigest = digest('controlled-protocol-row-source');
  const outcomes = rows.map((pair, index) => {
    const slot = `${index}`.repeat(36);
    return { index, pair, sourceDigest, groupId: digest({ sourceDigest, index, pair }),
      status: 'Passed', cleaned: true, pid: 100 + index, slot,
      lease: { pid: 100 + index, slot, minimumSlots: 1,
        startedAt: '2026-10-22T10:00:00.000Z', finishedAt: null },
      finishedAt: '2026-10-22T10:00:01.000Z' };
  });
  assert.deepEqual(reconcileProtocolRows(rows, [...outcomes].reverse(), sourceDigest), outcomes);
  for (const mutate of [
    values => values.pop(),
    values => { values[1] = values[0]; },
    values => { values[1].index = 17; },
    values => { values[1].pair = protocolPairs[2]; },
    values => { values[1].sourceDigest = digest('foreign-source'); },
    values => { values[1].groupId = digest('foreign-group'); },
    values => { values[1].status = 'NotRun'; },
    values => { values[1].cleaned = false; },
    values => { values[1].lease.pid++; },
    values => { values[1].lease.slot = values[0].slot; },
    values => { values[1].lease.finishedAt = values[1].finishedAt; },
    values => { values[1].finishedAt = 'incomplete'; },
  ]) {
    const changed = structuredClone(outcomes);
    mutate(changed);
    assert.throws(() => reconcileProtocolRows(rows, changed, sourceDigest));
  }
});

test('T-PRD021 protocol row pool drains failed children stops dispatch and respects one-slot fallback', async t => {
  const root = path.resolve('.test-data', `protocol-control-${randomUUID()}`);
  await fs.mkdir(root, { recursive: true });
  t.after(async () => {
    await fs.rm(root, { recursive: true });
    await assert.rejects(fs.stat(root), { code: 'ENOENT' });
  });
  await assert.rejects(observerApiFixture(t, { rootParent: path.resolve('.') }),
    /owned checkout-local scratch directory/u);
  const budgetUrl = new URL('../scripts/test-budget.mjs', import.meta.url).href;
  const diagnosticsUrl = new URL('../scripts/validation-tools.mjs', import.meta.url).href;
  const workerSource = fail => `
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { acquireTestWorker, readTestGroupProcesses } from ${JSON.stringify(budgetUrl)};
import { processDiagnostic } from ${JSON.stringify(diagnosticsUrl)};
const [indexText, sourceDigest, scratch, groupId, pairText] = process.argv.slice(2);
const index = Number(indexText);
const pair = JSON.parse(pairText);
const allocation = await acquireTestWorker(1, { groupId });
const parent = path.dirname(scratch);
const wait = async predicate => {
  const deadline = performance.now() + 10000;
  while (!await predicate()) {
    assert.ok(performance.now() < deadline, 'Controlled child barrier expired');
    await delay(10);
  }
};
const exists = async file => {
  try { await fs.stat(file); return true; } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return false;
  }
};
try {
  await fs.writeFile(path.join(parent, 'started-' + index), String(process.pid), { flag: 'wx' });
  if (${fail} && index === 0) {
    await wait(() => exists(path.join(parent, 'started-1')));
    await fs.mkdir(path.join(scratch, 'owned-failed-row-residue'));
    console.error(JSON.stringify(processDiagnostic(new Error('controlled-row-failure'))));
    process.exitCode = 17;
  } else {
    if (${fail}) await wait(async () => !await exists(path.join(parent, 'scratch-0')));
    assert.deepEqual(await fs.readdir(scratch), []);
    const [lease] = await readTestGroupProcesses(groupId);
    console.log(JSON.stringify({ index, pair, sourceDigest, groupId, status: 'Passed',
      cleaned: true, pid: process.pid, slot: allocation.slot, lease,
      finishedAt: new Date().toISOString() }));
  }
} finally { allocation.close(); }
`;
  const failureWorker = path.join(root, 'failure.mjs');
  const serialWorker = path.join(root, 'serial.mjs');
  await fs.writeFile(failureWorker, workerSource(true));
  await fs.writeFile(serialWorker, workerSource(false));
  let failure;
  try {
    await runProtocolPool(t, { workers: 2, worker: pathToFileURL(failureWorker),
      rows: protocolPairs.slice(0, 4) });
  } catch (error) { failure = error; }
  assert.ok(failure, 'The real failing child must fail the controller');
  t.diagnostic(JSON.stringify({ protocolFailure: failure.protocolPool }));
  assert.match(failure.message, /Protocol row 0 child failed/u);
  assert.equal(failure.protocolPool.reports.length, 2, 'Do not dispatch queued rows after failure');
  const [failed, drained] = failure.protocolPool.reports;
  assert.equal(failed.index, 0);
  assert.equal(failed.exitCode, 17);
  assert.equal(drained.index, 1);
  assert.equal(drained.exitCode, 0);
  assert.ok(failure.protocolPool.reports.every(report => report.complete && report.cleanup.rootExitObserved));
  for (const report of failure.protocolPool.reports) {
    await assert.rejects(fs.stat(report.command[4]), { code: 'ENOENT' });
  }
  assert.equal(JSON.parse(failed.stderr).message, 'controlled-row-failure');
  assert.ok(Date.parse(failed.finishedAt) >= Date.parse(drained.startedAt),
    'The two actual owned child processes must overlap');
  const serial = await runProtocolPool(t, { workers: 1, worker: pathToFileURL(serialWorker),
    rows: protocolPairs.slice(0, 2) });
  assert.equal(serial.workers, 1);
  assert.equal(serial.rows.length, 2);
  assert.ok(Date.parse(serial.reports[1].startedAt) >= Date.parse(serial.reports[0].finishedAt),
    'A caller allocation of one must never start a second concurrent row');
  for (const record of [failure.protocolPool, serial]) {
    const allocation = record.allocation;
    assert.ok(allocation.peakActiveWorkers <= allocation.capacity);
    assert.ok(allocation.peakResidentWorkers <= allocation.residentLimit);
    assert.ok(allocation.peakProducers <= allocation.producerLimit);
    assert.ok(allocation.peakControls <= allocation.controlLimit);
  }
  t.diagnostic(JSON.stringify({ protocolControl: { failure: failure.protocolPool, serial } }));
});

test('T-PRD021 acquired native ZIP identities and original outcomes reject forged passing summaries and candidate swaps', async t => {
  const f = await observerApiFixture(t);
  assert.equal(verdict(await f.connect().host.snapshot()).status, 'Passed');
  const lane = f.lanes.get('linux-x64');
  const original = structuredClone(lane.data.get('unit.json'));
  lane.data.get('unit.json').executions[0].status = 'Failed';
  lane.data.get('unit.json').exitCode = 1;
  lane.data.get('unit.json').summary.success = false;
  lane.data.get('unit.json').summary.counts.failed = 1;
  f.refresh('linux-x64');
  let result = verdict(await f.connect().host.snapshot());
  assert.equal(result.status, 'NotRun');
  assert.ok(result.blockers.some(message => message.includes('Original assertions')));
  lane.data.set('unit.json', original);
  const originalBundle = lane.data.get('readiness-bundle.json');
  lane.data.set('readiness-bundle.json', { status: 'Passed', verified: true });
  f.refresh('linux-x64');
  result = verdict(await f.connect().host.snapshot());
  assert.equal(result.status, 'NotRun', 'Serialized Passed/verified fields are not a generic evaluation or provider proof');
  lane.data.set('readiness-bundle.json', originalBundle);
  f.refresh('linux-x64');
  f.replaceCandidate(entries => {
    const file = [...entries.keys()].find(name => name.endsWith('-macos.tar.gz'));
    entries.set(file, Buffer.from('swapped frozen Mac bytes'));
  });
  result = verdict(await f.connect().host.snapshot());
  assert.equal(result.status, 'NotRun');
  assert.ok(result.blockers.some(message => message.includes('Frozen asset bytes')));
  const { client } = f.connect();
  const records = await client.list('/actions/runs/101/artifacts?per_page=100', 'artifacts');
  await assert.rejects(client.artifact({ ...records[1], verified: true }), { code: 'EVIDENCE' });
  f.assertReadOnly();
});

test('T-PRD021 native admission rejects aggregate-only groups altered source closures journals and missing independent calculator originals', async t => {
  const f = await observerApiFixture(t);
  const lane = f.lanes.get('linux-x64');
  const original = new Map([...lane.data].map(([name, value]) => [name, structuredClone(value)]));
  for (const mutate of [
    data => { delete data.get('unit.json').groupExecution; },
    data => { data.get('unit.json').groupExecution.groups[0].assertionIds.pop(); },
    data => { data.get('unit.json').groupExecution.selectionDigest = '0'.repeat(64); },
    data => { data.get('unit.json').groupExecution.groups[0].sourceDigest = '0'.repeat(64); },
    data => { data.set('unit.json.journal.ndjson', ''); },
    data => { data.delete('calculator.json'); },
    data => { data.delete('calculator-node-command.json'); },
    data => { data.get('calculator.json').results[0].status = 'Skipped'; },
    data => { data.get('calculator.json').results.pop(); },
    data => { data.set('calculator.json.journal.ndjson', ''); },
  ]) {
    lane.data.clear();
    for (const [name, value] of original) lane.data.set(name, structuredClone(value));
    mutate(lane.data);
    f.refresh('linux-x64');
    const result = verdict(await f.connect().host.snapshot());
    assert.equal(result.status, 'NotRun', JSON.stringify(result));
  }
  lane.data.clear();
  for (const [name, value] of original) lane.data.set(name, value);
  f.refresh('linux-x64');
  assert.equal(verdict(await f.connect().host.snapshot()).status, 'Passed');
  f.assertReadOnly();
});

test('T-PRD021 helper-only and core-pin-only producer changes require adoption before native evidence acquisition', async t => {
  const baseline = await observerApiFixture(t);
  assert.equal(verdict(await baseline.connect().host.snapshot()).status, 'Passed');
  const config = nativeConfigurationDigest({ inventory: baseline.source.inventory, profile: 'pr' });
  for (const [producerChange, file] of [
    ['prefix-helper', 'scripts/native-homebrew-prefix.mjs'],
    ['core-pin', 'scripts/toolchain-baseline.mjs'],
  ]) {
    const f = await observerApiFixture(t, { producerChange });
    assert.deepEqual(f.changedFiles, [file], 'The counterexample changes only the selected producer dependency');
    assert.equal(f.source.inventory.digest, baseline.source.inventory.digest);
    assert.equal(nativeConfigurationDigest({ inventory: f.source.inventory, profile: 'pr' }), config);
    const result = verdict(await f.connect().host.snapshot());
    assert.equal(result.status, 'NotRun', producerChange);
    assert.ok(result.blockers.some(message => message.includes('Producer definitions have not been maintainer-adopted')));
    assert.ok(!f.calls.some(call => /\/actions\/artifacts\/\d+\/zip$/u.test(new URL(call.url).pathname)));
    f.assertReadOnly();
  }
  baseline.assertReadOnly();
});

test('T-PRD021 API-acquired reporter changes cannot self-adopt complete passing fixture evidence', async t => {
  const f = await observerApiFixture(t, { unadoptedReporter: true });
  const result = verdict(await f.connect().host.snapshot());
  assert.equal(result.status, 'NotRun');
  assert.ok(result.blockers.some(message => message.includes('Producer definitions have not been maintainer-adopted')));
  assert.ok(!f.calls.some(call => /\/actions\/artifacts\/\d+\/zip$/u.test(new URL(call.url).pathname)));
  f.assertReadOnly();
});

test('T-PRD021 API-acquired required assertions cannot self-adopt complete passing fixture evidence', async t => {
  const f = await observerApiFixture(t, { unadoptedAssertion: true });
  const result = verdict(await f.connect().host.snapshot());
  assert.equal(result.status, 'NotRun');
  assert.ok(result.blockers.some(message => message.includes('Assertion definitions or required bindings')));
  assert.ok(!f.calls.some(call => /\/actions\/artifacts\/\d+\/zip$/u.test(new URL(call.url).pathname)));
  f.assertReadOnly();
});

test('T-PRD021 original stage command failure cannot borrow unchanged passing Node rows or a readiness bundle', async t => {
  const f = await observerApiFixture(t);
  assert.equal(verdict(await f.connect().host.snapshot()).status, 'Passed');
  const lane = f.lanes.get('linux-x64');
  const file = 'required-units-command.json';
  const original = lane.data.get(file);
  for (const change of [
    report => { report.complete = false; report.exitCode = null; report.diagnostic = 'Interrupted original stage command'; },
    report => { report.exitCode = 7; },
    report => { report.context.sourceCommit = 'e'.repeat(40); },
    report => { report.command = ['/controlled-fixture/node', 'scripts/test-runner.mjs', 'unit']; },
  ]) {
    const changed = structuredClone(original);
    change(changed);
    lane.data.set(file, changed);
    f.refresh('linux-x64');
    const result = verdict(await f.connect().host.snapshot());
    assert.equal(result.status, 'NotRun',
      'Original command completeness, exit, source and exact selection must match independently expected stage inputs');
  }
  lane.data.set(file, original);
  f.refresh('linux-x64');
  assert.equal(verdict(await f.connect().host.snapshot()).status, 'Passed');
  for (const [versionFile, wrongSDK] of [
    ['go-version.json', 'go version go1.26.0 linux/amd64\n'],
    ['python-version.json', 'Python 3.13.0\n'],
  ]) {
    const originalVersion = lane.data.get(versionFile);
    for (const mutation of ['missing', 'failed', 'stale-source', 'wrong-sdk']) {
      const changed = structuredClone(originalVersion);
      if (mutation === 'missing') lane.data.delete(versionFile);
      else {
        if (mutation === 'failed') changed.exitCode = 7;
        if (mutation === 'stale-source') changed.context.sourceCommit = 'e'.repeat(40);
        if (mutation === 'wrong-sdk') {
          changed.stdout = wrongSDK;
          changed.originalOutput.stdout = { sha256: digest(wrongSDK), bytes: Buffer.byteLength(wrongSDK) };
        }
        lane.data.set(versionFile, changed);
      }
      f.refresh('linux-x64');
      const result = verdict(await f.connect().host.snapshot());
      assert.equal(result.status, 'NotRun',
        `${versionFile} ${mutation} must not borrow passing stage rows, toolchain metadata or bundle`);
      lane.data.set(versionFile, originalVersion);
    }
    f.refresh('linux-x64');
  }
  assert.equal(verdict(await f.connect().host.snapshot()).status, 'Passed');
  f.assertReadOnly();
});

test('T-PRD085 actual API metadata edits remain independent of complete passing native admission on the same head', async t => {
  const f = await observerApiFixture(t);
  const { host } = f.connect();
  const initial = await host.snapshot();
  assert.equal(verdict(initial).status, 'Passed');
  assert.equal(initial.prs[0].verdicts['framework/coverage'].status, 'Passed');
  f.pr.body = '';
  const changed = await host.snapshot();
  assert.equal(changed.prs[0].headSha, initial.prs[0].headSha);
  assert.equal(verdict(changed).status, 'Passed', 'Missing metadata cannot erase or manufacture actual native execution results');
  assert.equal(changed.prs[0].verdicts['framework/coverage'].status, 'NotRun');
  assert.notEqual(changed.prs[0].verdicts['framework/coverage'].inputDigest,
    initial.prs[0].verdicts['framework/coverage'].inputDigest);
  f.assertReadOnly();
});

test('T-PRD024 composed API owner and external members retain mandatory native CI and share only actual status keys', async t => {
  const f = await observerApiFixture(t);
  const owner = f.addPr({ number: 2, authorId: 11, missingCoverage: true });
  const { host, policy } = f.connect();
  const snapshot = await host.snapshot();
  assert.equal(snapshot.prs.length, 2);
  for (const member of snapshot.prs) {
    assert.equal(member.verdicts['framework/validation'].status, 'Passed',
      JSON.stringify({ stage: 'initial-native', pr: member.number,
        blockers: member.verdicts['framework/validation'].blockers }));
    assert.equal(member.verdicts['framework/approval'].status, 'Passed',
      JSON.stringify({ stage: 'initial-approval', pr: member.number,
        blockers: member.verdicts['framework/approval'].blockers }));
    assert.equal(member.conversations.status, 'Passed',
      JSON.stringify({ stage: 'initial-conversations', pr: member.number, blockers: member.conversations.blockers }));
  }
  const result = await reconcilePrReadiness(host, policy);
  const coverage = sha => result.results.find(row => row.key.sha === sha &&
    row.key.context === 'framework/coverage');
  assert.equal(coverage(f.revisions.head).status, 'NotRun');
  assert.deepEqual(coverage(f.revisions.head).members.map(member => [member.number, member.status]),
    [[1, 'Passed'], [2, 'NotRun']]);
  assert.equal(coverage(f.revisions.merge).status, 'Passed',
    JSON.stringify({ stage: 'external-distinct-merge', reason: coverage(f.revisions.merge).reason,
      members: coverage(f.revisions.merge).members }));
  assert.equal(coverage(owner.pr.merge_commit_sha).status, 'NotRun');
  assert.ok(f.writes.some(row => row.sha === f.revisions.head && row.context === 'framework/coverage' &&
    row.state === 'failure'));
  const parents = f.mergeParents.get(owner.pr.merge_commit_sha);
  f.mergeParents.set(owner.pr.merge_commit_sha, [{ sha: 'e'.repeat(40) }, { sha: owner.pr.head.sha }]);
  const unbound = await f.connect().host.snapshot();
  assert.equal(unbound.prs.find(member => member.number === 2).verdicts['framework/validation'].status, 'NotRun');
  assert.ok(unbound.prs.find(member => member.number === 2).verdicts['framework/validation'].blockers
    .some(message => message.includes('test-merge')));
  assert.equal(unbound.prs.find(member => member.number === 1).verdicts['framework/validation'].status, 'Passed');
  f.mergeParents.set(owner.pr.merge_commit_sha, parents);
  owner.jobs.splice(owner.jobs.findIndex(job => job.name === 'native-windows-x64'), 1);
  const missing = await f.connect().host.snapshot();
  assert.equal(missing.prs.find(member => member.number === 2).verdicts['framework/validation'].status, 'NotRun',
    'Owner authorship never waives native CI');
  assert.equal(missing.prs.find(member => member.number === 1).verdicts['framework/validation'].status, 'Passed',
    JSON.stringify({ stage: 'external-native-after-owner-missing',
      blockers: missing.prs.find(member => member.number === 1).verdicts['framework/validation'].blockers }));
  assert.ok(f.calls.every(call => call.method === 'GET' || new URL(call.url).pathname === '/graphql' ||
    /\/statuses\/[a-f0-9]{40}$/u.test(new URL(call.url).pathname)));
});

test('T-PRD080 actual same-head conversation resolve and reopen are independent of approval and unsupported workflow events', async t => {
  const f = await observerApiFixture(t);
  const member = f.members.get(1);
  member.threads.push({ id: 'thread-controlled-1', isResolved: false });
  const before = await f.connect().host.snapshot();
  const approval = before.prs[0].verdicts['framework/approval'];
  assert.equal(approval.status, 'Passed');
  assert.equal(before.prs[0].conversations.status, 'NotRun');
  member.threads[0].isResolved = true;
  const resolved = await f.connect().host.snapshot();
  assert.equal(resolved.prs[0].conversations.status, 'Passed');
  assert.deepEqual(resolved.prs[0].verdicts['framework/approval'], approval);
  member.threads[0].isResolved = false;
  const reopened = await f.connect().host.snapshot();
  assert.equal(reopened.prs[0].conversations.status, 'NotRun');
  assert.deepEqual(reopened.prs[0].verdicts['framework/approval'], approval);
  assert.equal(reopened.prs[0].headSha, before.prs[0].headSha);
  assert.equal(f.writes.length, 0);
  f.assertReadOnly();
});

test('T-PRD027 API denied and unavailable conversation controls retain exact capability blockers without settings dispatch', async t => {
  const options = { protectionStatus: 403 };
  const f = await observerApiFixture(t, options);
  for (const protectionStatus of [403, 404]) {
    options.protectionStatus = protectionStatus;
    const result = (await f.connect().host.snapshot()).prs[0].conversations;
    assert.equal(result.status, 'NotRun');
    assert.equal(result.capability, protectionStatus === 403 ? 'Denied' : 'Unavailable');
    assert.equal(result.enforcement, 'provider-enforcement-unverified');
    assert.match(result.blockers.join(' '), /Native conversation enforcement/u);
    assert.equal(f.writes.length, 0);
    f.assertReadOnly();
  }
});

test('T-PRD074 archived native reconstruction uses original source and commands at an explicit as-of time without renewing current credit', async t => {
  const f = await observerApiFixture(t);
  const lane = f.lanes.get('linux-x64');
  const definition = { schemaVersion: 1, kind: 'native-validation-definition',
    target: lane.target, profile: 'pr', sourceFiles: [...f.source.files].map(([file, contents]) => ({ file, contents })),
    plan: f.source.plan, inventory: f.source.inventory, goSources: f.source.goSources,
    calculatorSources: [...f.source.files].filter(([file]) => calculatorFiles.includes(file))
      .map(([file, contents]) => ({ file, contents })),
    specification: lane.specification, stages: nativeStageSelections(f.source.inventory, f.source.plan),
    configDigest: nativeConfigurationDigest({ inventory: f.source.inventory, profile: 'pr' }),
    testSpecDigest: testSpecificationDigest(f.source.plan), inventoryDigest: validationInventoryDigest(lane.specification),
    source: { revision: f.revisions.merge, treeSha: f.source.sha, repositoryId: 'repository-17' } };
  const data = Object.fromEntries(lane.data);
  data.texts = Object.fromEntries([...lane.data].filter(([file]) => /\.(?:json|ndjson)$/u.test(file))
    .map(([file, value]) => [file, typeof value === 'string' ? value : canonical(value)]));
  const original = structuredClone(data['execution.json']);
  const definitionDigest = digest(definition);
  const reportDigest = digest(data.texts['execution.json']);
  const verifyArchive = input => {
    assert.equal(input.definitionDigest, definitionDigest);
    assert.equal(input.reportDigest, reportDigest);
    return { verifierId: 'authenticated-original-archive-fixture', definitionDigest, reportDigest,
      context: lane.context, sourceTime: original.observedAt, sourceSequence: original.sequence };
  };
  const input = { definition, data, candidate: f.candidate,
    asOf: '2026-10-18T10:10:00.000Z', verifyArchive };
  const restored = await replayNativeEvidence(input);
  assert.equal(restored.evaluation.status, 'Passed', JSON.stringify(restored.diagnostics));
  assert.equal(restored.historical, true);
  assert.equal(restored.currentCredit, 'NotRun');
  assert.equal(restored.evaluatedAsOf, input.asOf);
  const expired = await replayNativeEvidence({ ...input, asOf: '2026-10-20T10:10:00.000Z' });
  assert.equal(expired.evaluation.status, 'NotRun', 'The explicit clock does not waive the original 24-hour window');
  await assert.rejects(replayNativeEvidence({ ...input, verifyArchive: { verified: true, status: 'Passed' } }),
    { code: 'EVIDENCE' });
  await assert.rejects(replayNativeEvidence({ ...input, verifyArchive: () => null }), { code: 'EVIDENCE' });
  const changed = structuredClone(definition);
  changed.sourceFiles.find(source => source.file.endsWith('observer-unplanned.unit.test.mjs')).contents +=
    '\ntest("unadopted extra assertion",()=>{});\n';
  await assert.rejects(replayNativeEvidence({ ...input, definition: changed }),
    error => ['EVIDENCE', 'INVENTORY'].includes(error.code));
  const changedData = structuredClone(data);
  changedData['required-units-command.json'].command = ['/controlled-fixture/node', 'scripts/test-runner.mjs', 'unit'];
  await assert.rejects(replayNativeEvidence({ ...input, data: changedData }), { code: 'EVIDENCE' });
  assert.deepEqual(data['execution.json'], original);
  assert.equal(f.calls.length, 0, 'Historical data reconstruction never asks a current provider for replacement evidence');
});

test('T-PRD074 archived scheduling reconstructs only its authenticated captured literal policy without current-credit fallback', async t => {
  const f = await observerApiFixture(t, { nodeArtifactReader: true });
  const currentSource = await fs.readFile(new URL('../scripts/test-scheduling.mjs', import.meta.url), 'utf8');
  const source63 = ['github-provider-consumers.test.mjs', 'package.test.mjs', 'pr-facts-archive-recovery.test.mjs',
    'distribution-channels.test.mjs', 'test-runner.test.mjs'].reduce((contents, file) =>
    contents.replace(`  '${file}',\n`, ''), currentSource)
    .replace("schemaVersion: 6, algorithm: 'source-bound-ready-root-v6'",
      "schemaVersion: 5, algorithm: 'source-bound-ready-root-v5'");
  const previousSource = source63.replace("  'public-readiness-ci.test.mjs',\n", '')
    .replace("  'public-readiness-evidence.test.mjs',\n", '')
    .replace("schemaVersion: 5, algorithm: 'source-bound-ready-root-v5'",
      "schemaVersion: 4, algorithm: 'source-bound-ready-root-v4'");
  const middleSource = previousSource.replace("  'winget-launcher-native.test.mjs',\n", '')
    .replace("  'public-readiness-release-report.test.mjs',\n", '')
    .replace("schemaVersion: 4, algorithm: 'source-bound-ready-root-v4'",
      "schemaVersion: 3, algorithm: 'source-bound-ready-root-v3'");
  const legacySource = middleSource.replace("  'validation-catalog.test.mjs',\n", '')
    .replace("schemaVersion: 3, algorithm: 'source-bound-ready-root-v3'",
      "schemaVersion: 2, algorithm: 'source-bound-ready-root-v2'");
  for (const schedulingSource of [legacySource, middleSource, previousSource, source63, currentSource]) {
    const captured = nativeReplayFixture({ candidate: f.candidate, sourceCommit: f.revisions.merge,
      asOf: '2026-10-18T10:00:00.000Z', schedulingSource });
    const files = captured.definition.stages.find(stage=>stage.name==='regression').files;
    const retainedIndex = files.indexOf('test/github-retained-identity-acceptance.test.mjs');
    const catalogIndex = files.indexOf('test/validation-catalog.test.mjs');
    assert.ok(retainedIndex >= 0 && catalogIndex > retainedIndex);
    if (schedulingSource === legacySource) assert.ok(catalogIndex > retainedIndex + 1);
    else assert.equal(catalogIndex, retainedIndex + 1);
    const launcherIndex = files.indexOf('test/winget-launcher-native.test.mjs');
    const reportIndex = files.indexOf('test/public-readiness-release-report.test.mjs');
    assert.ok(launcherIndex >= 0 && reportIndex >= 0);
    if ([currentSource, source63, previousSource].includes(schedulingSource)) {
      assert.equal(launcherIndex, catalogIndex + 1);
      assert.equal(reportIndex, launcherIndex + 1);
    }
    const ciIndex = files.indexOf('test/public-readiness-ci.test.mjs');
    const evidenceIndex = files.indexOf('test/public-readiness-evidence.test.mjs');
    assert.ok(ciIndex >= 0 && evidenceIndex >= 0);
    if (schedulingSource === currentSource || schedulingSource === source63) {
      assert.equal(evidenceIndex, ciIndex + 1);
      assert.ok(ciIndex < retainedIndex && evidenceIndex < retainedIndex);
    } else {
      assert.ok(ciIndex > retainedIndex && evidenceIndex > retainedIndex);
    }
    const tailIndexes = ['github-provider-consumers.test.mjs', 'package.test.mjs',
      'pr-facts-archive-recovery.test.mjs', 'distribution-channels.test.mjs', 'test-runner.test.mjs']
      .map(file => files.indexOf(`test/${file}`));
    assert.ok(tailIndexes.every(index => index >= 0));
    if (schedulingSource === currentSource) {
      assert.deepEqual(tailIndexes, tailIndexes.map((_, index) => evidenceIndex + index + 1));
      assert.equal(retainedIndex, tailIndexes.at(-1) + 1);
    }
    const definitionDigest = digest(captured.definition), reportDigest = digest(captured.data.texts['execution.json']);
    const verifyArchive = input => {
      assert.equal(input.definitionDigest, definitionDigest);
      assert.equal(input.reportDigest, reportDigest);
      return { verifierId: 'source-bound-scheduling-archive', definitionDigest, reportDigest,
        context: captured.context, sourceTime: captured.data['execution.json'].observedAt,
        sourceSequence: captured.data['execution.json'].sequence };
    };
    const input = { ...captured, candidate: f.candidate, asOf: '2026-10-18T10:10:00.000Z', verifyArchive };
    const restored = await replayNativeEvidence(input);
    assert.equal(restored.evaluation.status, 'Passed', JSON.stringify(restored.diagnostics));
    assert.equal(restored.currentCredit, 'NotRun');
    const badSource = structuredClone(captured.definition);
    badSource.sourceFiles.find(source=>source.file==='scripts/test-scheduling.mjs').contents =
      currentSource.replace('maxWorkers: 32','maxWorkers: 31');
    await assert.rejects(replayNativeEvidence({ ...input, definition: badSource }), { code: 'EVIDENCE' });
    const badGroup = structuredClone(captured.data);
    badGroup['unit.json'].groupExecution.policyDigest = schedulingSource === legacySource ?
      '6274c99ad21f86dff3a67164c7f486bcb35cae3e9fcf67fb71deec2c72859c3f' :
      '0217489f1d88ac4649cee4e85b81777276297c70c140e4ab9346eef2770ee6db';
    await assert.rejects(replayNativeEvidence({ ...input, data: badGroup }), { code: 'EVIDENCE' });
    await assert.rejects(replayNativeEvidence({ ...input, verifyArchive: () => null }), { code: 'EVIDENCE' });
  }
  for (const schedulingSource of [legacySource, middleSource, previousSource, source63]) {
  const oldShard = await observerApiFixture(t, { frameworkShards: true, bootstrapProtocol: nativeBootstrapProtocol,
    schedulingSource, nodeArtifactReader: true, ambient: false });
  const part = oldShard.parts.get('macos-arm64-framework-body-1');
  const assignment = nativeFrameworkShardPlan({ inventory: oldShard.source.inventory,
    plan: oldShard.source.plan, target: part.target, schedulingPolicy: oldShard.source.schedulingPolicy });
  const definition = { schemaVersion: 1, kind: 'native-validation-definition', target: part.target,
    profile: 'pr', component: 'framework', shard: 'body-1', frameworkShards: nativeFrameworkShardProtocol,
    bootstrapProtocol: nativeBootstrapProtocol, selectedWorkersRequest: null,
    sourceFiles: [...oldShard.source.files].map(([file, contents]) => ({ file, contents })),
    plan: oldShard.source.plan, inventory: oldShard.source.inventory, goSources: oldShard.source.goSources,
    calculatorSources: [...oldShard.source.files].filter(([file])=>calculatorFiles.includes(file))
      .map(([file,contents])=>({file,contents})),
    specification: part.specification, stages: assignment.parts.find(item=>item.shard==='body-1').stages,
    configDigest: part.context.configDigest, testSpecDigest: part.context.testSpecDigest,
    inventoryDigest: part.context.inventoryDigest,
    source: { revision: oldShard.revisions.merge, treeSha: oldShard.source.sha, repositoryId: 'repository-17' } };
  const data = Object.fromEntries(part.data);
  data.texts = Object.fromEntries([...part.data].filter(([file])=>/\.(?:json|ndjson)$/u.test(file))
    .map(([file,value])=>[file,typeof value==='string'?value:canonical(value)]));
  const definitionDigest = digest(definition), reportDigest = digest(data.texts['execution.json']);
  const restoredShard = await replayNativeEvidence({ definition, data, candidate: oldShard.candidate,
    asOf: '2026-10-18T10:10:00.000Z', verifyArchive: input => {
      assert.equal(input.definitionDigest,definitionDigest);assert.equal(input.reportDigest,reportDigest);
      return { verifierId:'source-bound-old-shard',definitionDigest,reportDigest,context:part.context,
        sourceTime:data['execution.json'].observedAt,sourceSequence:data['execution.json'].sequence };
    } });
  assert.equal(restoredShard.evaluation.status,'Passed',JSON.stringify(restoredShard.diagnostics));
  assert.equal(restoredShard.currentCredit,'NotRun');
  assert.equal(oldShard.calls.length,0);
  }
  assert.equal(f.calls.length, 0, 'Historical reconstruction never fetches replacement provider evidence');
});

test('T-PRD079-WX native previous-current evidence requires both real-host shell outcomes and independently pinned original metadata', async t => {
  const f = await observerApiFixture(t);
  const fixture = nativeReplayFixture({ candidate: f.candidate, target: 'windows-x64', profile: 'r-pre',
    sourceCommit: f.revisions.merge, asOf: '2026-10-18T10:01:00.000Z' });
  const original = fixture.data['native-previous-current.json'];
  const expected = { candidate: f.candidate, target: 'windows-x64' };
  assert.equal(validateNativePreviousLifecycle(original, expected).status, 'Passed');
  for (const change of [
    value => { value.shells.pop(); },
    value => { value.shells[1].status = 'Failed'; },
    value => { value.previousIdentity.sourceCommit = 'f'.repeat(40); },
    value => { value.previousMetadata.checksums += 'tampered\n'; },
    value => { value.previousIdentity.version = value.currentIdentity.version; },
    value => { value.publicAcceptance = 'Passed'; },
  ]) {
    const report = structuredClone(original);
    change(report);
    assert.throws(() => validateNativePreviousLifecycle(report, expected), { code: 'EVIDENCE' });
  }
  assert.equal(f.calls.length, 0);
});

test('T-PRD085 adopted active scope cannot become out-of-scope with unchanged raw AC identifiers', async t => {
  const f = await observerApiFixture(t, { narrowedRequiredScope: true });
  const result = (await f.connect().host.snapshot()).prs[0].verdicts['framework/coverage'];
  assert.equal(result.status, 'NotRun');
  assert.ok(f.source.requirements.includes('AC-203.4'), 'The original raw condition ID is deliberately retained');
  assert.equal(result.diagnostics[0].code, 'ADOPTED_SCOPE_NARROWED');
  assert.deepEqual(result.diagnostics[0].requirements, ['FR-203']);
  assert.deepEqual(result.diagnostics[0].ids, ['AC-203.4']);
  f.assertReadOnly();
});

test('T-PRD085 actual coverage diagnostics survive API verdict reconciliation retention and bounded normal UI', async t => {
  const f = await observerApiFixture(t, { narrowedRequiredScope: true });
  const { host, policy } = f.connect();
  const result = await reconcilePrReadiness(host, policy);
  const key = result.results.find(row => row.key.sha === f.revisions.head &&
    row.key.context === 'framework/coverage');
  assert.equal(key.members[0].diagnostics[0].code, 'ADOPTED_SCOPE_NARROWED');
  const directory = path.join(f.root, 'retained-observer');
  await retainObserverResult(result, directory);
  const record = JSON.parse(await fs.readFile(path.join(directory, `key-${digest(key.key)}.json`), 'utf8'));
  assert.deepEqual(record.members[0].diagnostics[0].ids, ['AC-203.4']);
  const summary = renderObserverSummary(result, {
    completeReportRef: 'https://github.com/urmich/ai-sdlc-framework/actions/runs/999/attempts/1', maxBytes: 4096,
  });
  assert.match(summary, /PR #1/u);
  assert.match(summary, /FR-203/u);
  assert.match(summary, /AC-203\.4/u);
  assert.match(summary, /ADOPTED\\?_SCOPE\\?_NARROWED/u);
  assert.ok(Buffer.byteLength(summary) <= 4096);
});

test('T-PRD021 malformed native toolchain fields remain per-PR NotRun rather than aborting complete observation', async t => {
  const f = await observerApiFixture(t);
  const original = f.lanes.get('linux-x64').data.get('execution.json');
  for (const value of [null, 42, {}, []]) {
    const changed = structuredClone(original);
    changed.context.native.toolchain.go = value;
    f.lanes.get('linux-x64').data.set('execution.json', changed);
    f.refresh('linux-x64');
    const snapshot = await f.connect().host.snapshot();
    assert.equal(snapshot.complete, true);
    assert.equal(verdict(snapshot).status, 'NotRun');
    assert.ok(verdict(snapshot).blockers.some(message => message.includes('Native tool identities')));
  }
  f.assertReadOnly();
});

test('T-PRD021 trusted pre-checkout host resources and exact stage budget prevent self-reported allocation reuse', async t => {
  const f = await observerApiFixture(t);
  assert.equal(verdict(await f.connect().host.snapshot()).status, 'Passed');
  const lane = f.lanes.get('linux-x64');
  const unit = lane.data.get('unit.json');
  const original = structuredClone(unit.resources);
  for (const change of [
    value => { value.availableParallelism = 8; },
    value => { value.totalMemoryBytes *= 2; },
    value => { value.fileConcurrency = 1; },
    value => { value.budget.capacity = 2; },
    value => { value.budget.peakActiveWorkers = value.budget.capacity + 1; },
    value => { value.budget.peakPotentialResidentWorkers = value.budget.capacity * 3 + 1; },
  ]) {
    unit.resources = structuredClone(original);
    change(unit.resources);
    f.refresh('linux-x64');
    const result = verdict(await f.connect().host.snapshot());
    assert.equal(result.status, 'NotRun');
    assert.ok(result.blockers.some(message => message.includes('Original native commands/procedures')));
  }
  unit.resources = original;
  f.refresh('linux-x64');
  const job = f.jobs.find(job => job.name === 'native-linux-x64');
  const logs = f.logs.get(job.id);
  f.logs.set(job.id, logs.replace('"configuredWorkers":null', '"configuredWorkers":"2"'));
  const changed = verdict(await f.connect().host.snapshot());
  assert.equal(changed.status, 'NotRun');
  assert.ok(changed.blockers.some(message => message.includes('Native tool identities')));
  f.logs.set(job.id, logs);
  assert.equal(verdict(await f.connect().host.snapshot()).status, 'Passed');
  f.assertReadOnly();
});
