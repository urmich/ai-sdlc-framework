export const validationDeclarations = {
  "schemaVersion": 1,
  "surfaces": [{"coverage": "direct", "paths": ["scripts/release-history.mjs"]}],
  "groups": [
    {"root": "T-PRD034 release history ignores unrelated repository artifacts and reconciles every selected run page", "dependsOn": [], "minimumSlots": 1, "exclusiveResources": []},
    {"root": "T-PRD037 publication recovery finds unresolved originals without scanning unrelated repository artifacts", "dependsOn": [], "minimumSlots": 1, "exclusiveResources": []},
    {"root": "T-PRD037 scoped publication discovery still rejects reuse of an intent from a conflicting source", "dependsOn": [], "minimumSlots": 1, "exclusiveResources": []}
  ],
  "applicability": [{
    "names": [
      "T-PRD034 release history ignores unrelated repository artifacts and reconciles every selected run page",
      "T-PRD034 independent run chronology rejects A-pass B-fail C-reusing-A instead of trusting the selected older artifact",
      "T-PRD034 distinct physical reruns preserve original unchanged targets but invalidate newer cancelled or missing work",
      "T-PRD034 source intent, original preflight digest and missing newer-origin bindings fail closed",
      "T-PRD037 publication recovery finds unresolved originals without scanning unrelated repository artifacts",
      "T-PRD037 scoped publication discovery still rejects reuse of an intent from a conflicting source",
      "T-PRD037 independent original publication effects survive job restart and prevent uncertain republishing"
    ],
    "platforms": ["linux-x64", "windows-x64", "macos-arm64", "macos-x64"],
    "owner": "release-workflow",
    "reason": "PR-only FR-206/207 history and publication-recovery coverage uses actual collector APIs with paginated in-memory provider records. Unrelated repository artifacts cannot exhaust selected release history; late-page originals, supersession, immutable-source conflicts and uncertain effects remain enforced. No critical promotion or provider/package-manager effects.",
    "prerequisites": ["Node; owned in-memory provider and ZIP fixtures, independent process-isolated roots with no shared resources or external access"]
  }]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, sha256, zip } from '../packaging/standalone/archive.mjs';
import { collectReleaseAttemptHistory, requireCurrentReleaseGates, collectPublicationAttempts,
  immutablePublicationBinding, publicationRecoveryDecision, readReleaseArtifactJson } from '../scripts/release-history.mjs';

const repository = 'urmich/ai-sdlc-framework';
const sourceCommit = 'a'.repeat(40);
const targets = ['linux-x64', 'windows-x64', 'macos-arm64', 'macos-x64'];
const startedAt = '2026-10-19T10:00:00.000Z';
const now = '2026-10-19T11:00:00.000Z';
const binding = { releaseIntentId: 'controlled-immutable-release', sourceCommit,
  releaseRepository: repository, version: '0.5.0', descriptorSha256: 'b'.repeat(64), checksumsSha256: 'c'.repeat(64) };
const handoff = { ...binding, sourceRepository: repository, releaseBinding: binding,
  packageName: 'ai-sdlc-framework', sha256: 'd'.repeat(64) };
const publicationBinding = immutablePublicationBinding(handoff);
const preflightRequest = { ...binding, repository, validationMode: 'fresh-native' };
const successJobs = () => targets.map((target, index) => ({ id: 500 + index, name: `native-${target}`,
  conclusion: 'success', started_at: startedAt, completed_at: now,
  steps: [{ name: 'Fresh complete native R-PRE inventory against the frozen unpublished bytes', conclusion: 'success' }] }));
const gates = (runId = '101', attempt = '1') => targets.map(target => ({ target,
  identity: { sourceCommit, version: binding.version }, releaseIntentId: binding.releaseIntentId,
  run: { id: runId, attempt } }));

function providerFixture() {
  const runs = [];
  const artifacts = [];
  const payloads = new Map();
  const physical = new Map();
  const jobs = new Map();
  const requests = [];
  const prefix = `/repos/${repository}`;
  const page = (rows, field, route) => {
    const query = new URL(route, 'https://api.github.com').searchParams;
    const number = Number(query.get('page') ?? 1);
    const size = Number(query.get('per_page') ?? 100);
    return { status: 200, value: { total_count: rows.length,
      [field]: rows.slice((number - 1) * size, number * size) } };
  };
  function artifact(name, runId, filename, data) {
    const bytes = zip([{ path: filename, mode: 0o644, data: Buffer.from(canonical(data)) }]);
    const value = { id: artifacts.length + 1000, name, expired: false, digest: `sha256:${sha256(bytes)}`,
      workflow_run: { id: Number(runId), head_sha: sourceCommit } };
    artifacts.push(value);
    payloads.set(String(value.id), bytes);
    return value;
  }
  function addRun(id, runNumber, attempts = [{ jobs: successJobs(), request: preflightRequest }]) {
    const run = { id: Number(id), run_number: runNumber, run_attempt: attempts.length, workflow_id: 17,
      path: '.github/workflows/release.yml', event: 'workflow_dispatch', head_sha: sourceCommit, created_at: startedAt };
    runs.push(run);
    for (const [index, input] of attempts.entries()) {
      const attempt = index + 1;
      physical.set(`${id}/${attempt}`, { ...run, run_attempt: attempt, status: 'completed', conclusion: 'success' });
      jobs.set(`${id}/${attempt}`, input.jobs);
      if (input.request) artifact(`release-preflight-${id}-${attempt}`, id, 'release-preflight.json', input.request);
    }
    return run;
  }
  const api = async (route, options) => {
    requests.push({ route, options });
    if (route.startsWith(`${prefix}/actions/workflows/release.yml/runs?`)) {
      const selectedSource = new URL(route, 'https://api.github.com').searchParams.get('head_sha');
      return page(runs.filter(row => !selectedSource || row.head_sha === selectedSource), 'workflow_runs', route);
    }
    if (route.startsWith(`${prefix}/actions/artifacts?`)) {
      return page(artifacts, 'artifacts', route);
    }
    const runArtifacts = new RegExp(`^${prefix}/actions/runs/(\\d+)/artifacts\\?`, 'u').exec(route);
    if (runArtifacts) return page(artifacts.filter(row => String(row.workflow_run?.id) === runArtifacts[1]),
      'artifacts', route);
    const file = new RegExp(`^${prefix}/actions/artifacts/(\\d+)(/zip)?$`, 'u').exec(route);
    if (file) return { status: 200, value: file[2] ? payloads.get(file[1]) : artifacts.find(row => String(row.id) === file[1]) };
    const run = new RegExp(`^${prefix}/actions/runs/(\\d+)/attempts/(\\d+)(/jobs\\?.*)?$`, 'u').exec(route);
    assert.ok(run, `Unexpected controlled release provider route: ${route}`);
    const key = `${run[1]}/${run[2]}`;
    const rows = jobs.get(key);
    return { status: 200, value: run[3] ? { total_count: rows.length, jobs: rows } : physical.get(key) };
  };
  return { api, artifact, addRun, artifacts, payloads, physical, jobs, requests };
}

function collect(fixture) {
  return collectReleaseAttemptHistory({ api: fixture.api, sourceRepository: repository, binding,
    notBefore: startedAt, now });
}

function addBusyRepositoryArtifacts(fixture) {
  for (const [runId, count, firstId] of [['999', 5001, 20000], ['101', 100, 30000]]) {
    fixture.artifacts.push(...Array.from({ length: count }, (_, index) => ({
      id: firstId + index, name: `ci-diagnostic-${runId}-${index}`,
      workflow_run: { id: Number(runId), head_sha: sourceCommit },
    })));
  }
}

test('T-PRD034 release history ignores unrelated repository artifacts and reconciles every selected run page', async () => {
  const f = providerFixture();
  addBusyRepositoryArtifacts(f);
  f.addRun('101', 4);
  const history = requireCurrentReleaseGates(await collect(f), gates());
  assert.deepEqual(history.attempts.map(row => row.runId), ['101']);
  assert.equal(history.attempts[0].observations.length, targets.length);
  assert.ok(f.requests.some(({ route }) =>
    route === `/repos/${repository}/actions/runs/101/artifacts?per_page=100&page=2`));
  assert.equal(f.requests.some(({ route }) => route.startsWith(`/repos/${repository}/actions/artifacts?`)), false);
});

test('T-PRD034 independent run chronology rejects A-pass B-fail C-reusing-A instead of trusting the selected older artifact', async () => {
  const f = providerFixture();
  f.addRun('101', 4);
  assert.equal(requireCurrentReleaseGates(await collect(f), gates()).attempts.length, 1);
  const failed = successJobs();
  failed[3].conclusion = 'failure';
  f.addRun('202', 5, [{ request: preflightRequest, jobs: failed }]);
  f.addRun('303', 6, [{ request: { ...preflightRequest, validationMode: 'reuse-r-pre' }, jobs: [] }]);
  const history = await collect(f);
  assert.deepEqual(history.attempts.map(row => row.runId), ['101', '202', '303']);
  assert.throws(() => requireCurrentReleaseGates(history, gates()), /newer failed|supersedes/u);
  assert.equal(history.attempts[0].observations[3].status, 'Passed');
  assert.equal(history.attempts[1].observations[3].status, 'Failed');
  assert.equal(history.attempts[0].invocationRef,
    `https://github.com/${repository}/actions/runs/101/attempts/1`);
});

test('T-PRD034 distinct physical reruns preserve original unchanged targets but invalidate newer cancelled or missing work', async () => {
  for (const conclusion of ['cancelled', 'skipped', null]) {
    const f = providerFixture();
    const replacement = { ...successJobs()[0], conclusion };
    f.addRun('101', 4, [{ request: preflightRequest, jobs: successJobs() },
      { jobs: [replacement] }]);
    const history = await collect(f);
    const observed = history.attempts[1].observations.find(row => row.target === 'linux-x64');
    assert.equal(observed.status, 'NotRun');
    assert.equal(observed.rawConclusion, conclusion);
    assert.deepEqual(JSON.parse(JSON.stringify(history)), history);
    assert.throws(() => requireCurrentReleaseGates(history, gates()), /supersedes/u);
    const selected = gates().map(gate => gate.target === 'linux-x64' ?
      { ...gate, run: { id: '101', attempt: '2' } } : gate);
    assert.throws(() => requireCurrentReleaseGates(history, selected), /supersedes/u);
  }
  const f = providerFixture();
  f.addRun('101', 4, [{ request: preflightRequest, jobs: successJobs() }, { jobs: [successJobs()[0]] }]);
  const selected = gates().map(gate => gate.target === 'linux-x64' ?
    { ...gate, run: { id: '101', attempt: '2' } } : gate);
  assert.equal(requireCurrentReleaseGates(await collect(f), selected).complete, true);
  const reuse = providerFixture();
  reuse.addRun('101', 4);
  reuse.addRun('202', 5, [{ request: { ...preflightRequest, validationMode: 'reuse-r-pre' },
    jobs: successJobs().map(job => ({ ...job, started_at: null, completed_at: now, conclusion: 'skipped' })) }]);
  const reused = await collect(reuse);
  assert.equal(requireCurrentReleaseGates(reused, gates()).complete, true,
    'The explicitly unscheduled reuse lanes do not impersonate replacement native executions');
  assert.equal(reused.attempts[1].observations.length, 0);
  assert.equal(reused.attempts[1].notScheduledNative.length, 4);
});

test('T-PRD034 source intent, original preflight digest and missing newer-origin bindings fail closed', async () => {
  for (const mutate of [
    f => { f.artifacts[0].digest = `sha256:${'0'.repeat(64)}`; },
    f => { f.artifacts[0].expired = true; },
    f => { f.physical.get('101/1').head_sha = 'b'.repeat(40); },
    f => { f.artifacts.length = 0; },
  ]) {
    const f = providerFixture();
    f.addRun('101', 4);
    mutate(f);
    await assert.rejects(collect(f), /digest|expired|source|binding|missing/iu);
  }
  const f = providerFixture();
  f.addRun('101', 4);
  f.addRun('202', 5, [{ jobs: successJobs(), request: { ...preflightRequest, version: '9.0.0' } }]);
  await assert.rejects(collect(f), /conflicting immutable inputs/u);
});

test('T-PRD034 original provider artifact reader rejects duplicate names and escaping data without extracting it', () => {
  const bytes = zip([{ path: 'release-preflight.json', data: Buffer.from(canonical(preflightRequest)), mode: 0o644 }]);
  assert.deepEqual(readReleaseArtifactJson(bytes, 'release-preflight.json'), preflightRequest);
  const rename = (archive, before, after) => {
    assert.equal(Buffer.byteLength(before), Buffer.byteLength(after));
    const result = Buffer.from(archive);
    for (let at = result.indexOf(before); at !== -1; at = result.indexOf(before, at + after.length)) {
      result.write(after, at);
    }
    return result;
  };
  const escaped = rename(zip([{ path: 'aa/release-preflight.json', data: Buffer.from('{}'), mode: 0o644 }]),
    'aa/release-preflight.json', '../release-preflight.json');
  const duplicate = rename(zip([{ path: 'release-preflight.json', data: Buffer.from('{}'), mode: 0o644 },
    { path: 'RELEASE-PREFLIGHT.JSOX', data: Buffer.from('{}'), mode: 0o644 }]),
  'RELEASE-PREFLIGHT.JSOX', 'RELEASE-PREFLIGHT.JSON');
  for (const archive of [escaped, duplicate]) {
    assert.throws(() => readReleaseArtifactJson(archive, 'release-preflight.json'), /Duplicate|escaping/u);
  }
  assert.throws(() => readReleaseArtifactJson(bytes.subarray(0, -1), 'release-preflight.json'), /Incomplete/u);
});

test('T-PRD037 publication recovery finds unresolved originals without scanning unrelated repository artifacts', async () => {
  const f = providerFixture();
  addBusyRepositoryArtifacts(f);
  f.addRun('101', 4);
  f.artifact(`npm-publication-dispatch-${binding.releaseIntentId}-101-1`, '101',
    'publication-dispatch.json', { schemaVersion: 1, kind: 'npm-publication-attempt', binding: publicationBinding,
      run: { id: '101', attempt: '1' }, mode: 'publish',
      invocationRef: `https://github.com/${repository}/actions/runs/101/attempts/1` });
  f.jobs.set('101/1', [{ id: 600, name: 'npm-handoff / publish', steps: [{
    name: 'Publish exact tgz through OIDC only, with automatic npm provenance',
    started_at: startedAt, conclusion: 'failure',
  }] }]);
  const result = await collectPublicationAttempts({ api: f.api, sourceRepository: repository, handoff });
  assert.equal(result.mayDispatch, false);
  assert.equal(result.disposition, 'ReconcileOnly');
  assert.deepEqual(result.unresolvedAttempts, [{ run: { id: '101', attempt: '1' },
    invocationRef: `https://github.com/${repository}/actions/runs/101/attempts/1` }]);
  assert.ok(f.requests.some(({ route }) =>
    route === `/repos/${repository}/actions/runs/101/artifacts?per_page=100&page=2`));
  assert.equal(f.requests.some(({ route }) => route.startsWith(`/repos/${repository}/actions/artifacts?`)), false);
});

test('T-PRD037 scoped publication discovery still rejects reuse of an intent from a conflicting source', async () => {
  const f = providerFixture();
  const run = f.addRun('202', 5);
  run.head_sha = 'b'.repeat(40);
  f.physical.get('202/1').head_sha = run.head_sha;
  const artifact = f.artifact(`npm-publication-dispatch-${binding.releaseIntentId}-202-1`, '202',
    'publication-dispatch.json', { schemaVersion: 1, kind: 'npm-publication-attempt',
      binding: { ...publicationBinding, sourceCommit: run.head_sha },
      run: { id: '202', attempt: '1' }, mode: 'publish',
      invocationRef: `https://github.com/${repository}/actions/runs/202/attempts/1` });
  artifact.workflow_run.head_sha = run.head_sha;
  await assert.rejects(collectPublicationAttempts({ api: f.api, sourceRepository: repository, handoff }),
    /foreign source|immutable/u);
});

test('T-PRD037 independent original publication effects survive job restart and prevent uncertain republishing', async () => {
  for (const [outcome, mayDispatch] of [['Uncertain', false], ['Published', false],
    ['NotStarted', true], ['RejectedWithoutEffect', true]]) {
    const f = providerFixture();
    f.addRun('101', 4);
    const dispatch = { schemaVersion: 1, kind: 'npm-publication-attempt', binding: publicationBinding,
      run: { id: '101', attempt: '1' }, mode: 'publish',
      invocationRef: `https://github.com/${repository}/actions/runs/101/attempts/1` };
    f.artifact(`npm-publication-dispatch-${binding.releaseIntentId}-101-1`, '101',
      'publication-dispatch.json', dispatch);
    f.jobs.set('101/1', [{ id: 600, name: 'npm-handoff / publish', steps: [{
      name: 'Publish exact tgz through OIDC only, with automatic npm provenance',
      ...(outcome === 'NotStarted' ? { conclusion: 'skipped' } : { started_at: startedAt, conclusion: 'failure' }),
    }] }]);
    if (outcome === 'Published' || outcome === 'RejectedWithoutEffect') {
      f.artifact('npm-oidc-result-101-1', '101', 'npm-publication-result.json', {
        binding: publicationBinding, run: dispatch.run, status: outcome === 'Published' ? 'PublishedAndBytesVerified' : 'RejectedWithoutEffect',
        history: [{ largePriorOriginal: 'x'.repeat(16_000) }],
        command: outcome === 'Published' ? { exitCode: 0 } :
          { exitCode: 1, signal: null, confirmedRejected: true, rejectionCode: 'E403', stderr: 'x'.repeat(16_000) },
      });
    }
    const retained = [];
    const result = await collectPublicationAttempts({ api: f.api, sourceRepository: repository, handoff,
      retainOriginal: input => { retained.push(input); } });
    assert.equal(result.mayDispatch, mayDispatch, outcome);
    assert.equal(result.history[0].confirmedEffect, outcome);
    assert.equal(result.history[0].run.attempt, '1');
    if (outcome === 'Published' || outcome === 'RejectedWithoutEffect') {
      assert.equal(result.history[0].resultArtifact.filename, 'npm-publication-result.json');
      assert.equal(Object.hasOwn(result.history[0].result, 'history'), false);
      assert.equal(Object.hasOwn(result.history[0].result.command, 'stderr'), false);
      assert.ok(Buffer.byteLength(canonical(result)) < 4000, 'Recovery retains immutable references, not recursive copies of prior diagnostics');
      const original = retained.find(row => row.member === 'npm-publication-result.json');
      assert.equal(original.value.history[0].largePriorOriginal.length, 16_000);
      assert.match(original.artifact.digest, /^sha256:[a-f0-9]{64}$/u);
      if (outcome === 'RejectedWithoutEffect') assert.equal(original.value.command.stderr.length, 16_000);
    }
    const restored = publicationRecoveryDecision(result.history, publicationBinding);
    assert.equal(restored.disposition, mayDispatch ? 'NoUnresolvedPriorEffect' : 'ReconcileOnly');
  }
});

test('T-PRD037 recovery cannot clear unresolved originals by dropping dependencies or changing immutable inputs', () => {
  const original = { schemaVersion: 1, kind: 'npm-publication-attempt', binding: publicationBinding,
    run: { id: '101', attempt: '1' }, mode: 'publish', confirmedEffect: 'Uncertain',
    invocationRef: `https://github.com/${repository}/actions/runs/101/attempts/1`,
    dispatchArtifact: { id: '1001', digest: `sha256:${'a'.repeat(64)}` } };
  const retry = { ...original, run: { id: '202', attempt: '1' }, mode: 'reconcile-only',
    invocationRef: `https://github.com/${repository}/actions/runs/202/attempts/1`,
    dispatchArtifact: { id: '1002', digest: `sha256:${'b'.repeat(64)}` },
    priorDispatchArtifacts: [original.dispatchArtifact] };
  const immutableOriginal = canonical(original);
  const immutableRetry = canonical(retry);
  const blocked = publicationRecoveryDecision([original, retry], publicationBinding);
  assert.equal(blocked.mayDispatch, false);
  assert.equal(blocked.disposition, 'ReconcileOnly');
  assert.deepEqual(blocked.unresolvedAttempts, [{ run: original.run, invocationRef: original.invocationRef }]);
  assert.throws(() => publicationRecoveryDecision([retry], publicationBinding), /forget/u);
  assert.throws(() => publicationRecoveryDecision([{ ...retry, dispatchArtifact: original.dispatchArtifact }], publicationBinding),
    /forget/u);
  assert.throws(() => publicationRecoveryDecision([{ ...retry, priorDispatchArtifacts: [] }], publicationBinding), /forget/u);
  assert.throws(() => publicationRecoveryDecision([original, { ...retry, dispatchArtifact: original.dispatchArtifact }], publicationBinding),
    /distinct/u);
  const alias = { ...retry, run: { id: '303', attempt: '1' },
    invocationRef: `https://github.com/${repository}/actions/runs/303/attempts/1`,
    dispatchArtifact: { id: '1003', digest: `sha256:${'c'.repeat(64)}` },
    priorDispatchArtifacts: [retry.dispatchArtifact] };
  assert.throws(() => publicationRecoveryDecision([retry, alias], publicationBinding), /forget/u);
  assert.equal(publicationRecoveryDecision([{ ...original, confirmedEffect: 'RejectedWithoutEffect' }, retry],
    publicationBinding).mayDispatch, true, 'An independently confirmed no-effect root remains distinguishable from uncertainty');
  assert.throws(() => publicationRecoveryDecision([original], { ...publicationBinding, sourceCommit: 'b'.repeat(40) }),
    /conflicts/u);
  assert.equal(canonical(original), immutableOriginal);
  assert.equal(canonical(retry), immutableRetry);
});
