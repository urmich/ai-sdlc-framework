export const validationDeclarations = {
  "schemaVersion": 1,
  "surfaces": [{"coverage": "direct", "paths": ["scripts/macos-runner-admission.mjs"]}],
  "groups": [
    {"root": "T-MACADM025 ready ARM frontier reserves all bodies and refresh before Intel secondaries and auxiliaries", "dependsOn": [], "minimumSlots": 1, "exclusiveResources": []},
    {"root": "T-MACADM026 ready ARM frontier observations retain allocation changes cancellation and failed reads", "dependsOn": [], "minimumSlots": 1, "exclusiveResources": []},
    {"root": "T-MACADM023 Intel secondary requests wait for actual primary allocation without reserving future ARM units", "dependsOn": [], "minimumSlots": 1, "exclusiveResources": []},
    {"root": "T-MACADM024 primary-first admission preserves authentic v9 graphs and rejects v9 v10 relabels", "dependsOn": [], "minimumSlots": 1, "exclusiveResources": []},
    {"root": "T-MACADM019 Intel auxiliaries yield to ready critical bodies across architectures without waiting for future units", "dependsOn": [], "minimumSlots": 1, "exclusiveResources": []},
    {"root": "T-MACADM020 mandatory ARM refresh takes a bounded fair turn without the full body allocation chain", "dependsOn": [], "minimumSlots": 1, "exclusiveResources": []},
    {"root": "T-MACADM021 readiness fairness cannot relabel historical source admission graphs", "dependsOn": [], "minimumSlots": 1, "exclusiveResources": []},
    {"root": "T-MACADM022 readiness observations retain changing critical cohorts allocation and bounded failures", "dependsOn": [], "minimumSlots": 1, "exclusiveResources": []},
    {"root": "T-MACADM018 queued ARM allocation cannot suppress own-unit-ready Intel critical requests", "dependsOn": [], "minimumSlots": 1, "exclusiveResources": []},
    {"root": "T-MACADM009 Linux admission preserves all twenty-five native identities barriers pins limits and critical budget", "dependsOn": [], "minimumSlots": 1, "exclusiveResources": []}
  ]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { evaluateMacAdmission, waitForMacAdmission } from '../scripts/macos-runner-admission.mjs';
import { parseWorkflow } from '../scripts/workflow-policy.mjs';
import { nativePrParts } from '../scripts/native-validation.mjs';
import { criticalProfileBudget } from '../scripts/test-profiles.mjs';
import { inspectWorkflowTrust } from '../scripts/pr-observer.mjs';

// Every provider record in this file is synthetic; no fetch reaches a network.
const expected = { repository: 'fixture/repository', runId: 52, attempt: 2,
  headSha: 'a'.repeat(40), event: 'pull_request' };
const prefix = 'https://api.github.com/repos/fixture/repository/actions/runs/52/attempts/2';
const names = ['refresh', 'body-0', 'body-1', 'body-2']
  .map(shard => `native-macos-arm64-framework-${shard}`);
const startedAt = '2026-10-23T10:42:05Z';
function run(changes = {}) {
  return { id: 52, run_attempt: 2, repository: { full_name: expected.repository },
    head_sha: expected.headSha, event: 'pull_request', status: 'in_progress', conclusion: null, ...changes };
}
function jobs(changes = {}) {
  return names.map((name, index) => ({ id: index + 1, name, run_id: 52, run_attempt: 2,
    run_url: 'https://api.github.com/repos/fixture/repository/actions/runs/52',
    head_sha: expected.headSha, status: 'queued', conclusion: null, started_at: startedAt,
    runner_name: '', steps: [], ...changes }));
}
function observation(selected = jobs(), selectedRun = run()) {
  return { jobs: selected, run: selectedRun, complete: true };
}
function criticalJobs() {
  const units = ['macos-arm64-framework-units', 'macos-x64-framework-units',
    'macos-x64-framework-units-1'].map((role, index) => ({
    ...jobs()[0], id: 100 + index, name: `native-${role}`, status: 'completed',
    conclusion: 'success', runner_name: 'synthetic-unit-worker', completed_at: startedAt,
  }));
  const bodies = ['arm64', 'x64'].flatMap((arch, platform) => [0, 1, 2].map(index => ({
    ...jobs()[0], id: 200 + platform * 3 + index,
    name: `native-macos-${arch}-framework-body-${index}`,
    created_at: '2026-10-23T10:42:06Z',
  })));
  return [...units, ...bodies];
}
function allocate(record) {
  Object.assign(record, { status: 'in_progress', runner_name: 'synthetic-body-worker',
    started_at: '2026-10-23T10:42:07Z' });
}
function frontierJobs() {
  return [...criticalJobs(), { ...jobs()[0], id: 300, created_at: startedAt }];
}
function restoreV10Groups(ci) {
  const primary = ci.jobs['intel-retained-admission'].steps[4];
  primary.name = 'Wait for actual Intel primary body worker allocation';
  primary.run = primary.run.replace('--group intel-secondaries-ready-arm-frontier', '--group intel-primary-body');
  for (const key of ['intel-admission', 'intel-homebrew-admission']) {
    const step = ci.jobs[key].steps[4];
    step.name = 'Admit Intel auxiliaries after ready critical bodies';
    step.run = step.run.replace('--group intel-auxiliaries-ready-arm-frontier', '--group intel-auxiliaries-ready');
  }
}
function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}
function adapter({ selectedJobs = jobs({ status: 'in_progress', runner_name: 'synthetic-worker' }),
  selectedRun = run(), respond } = {}) {
  const calls = [];
  let time = 0;
  const options = {
    token: 'synthetic-no-credential', timeoutMs: 30, pollMs: 3, now: () => time,
    sleep: async ms => { time += ms; },
    fetch: async (url, request) => {
      assert.equal(request.method, 'GET');
      assert.equal(request.redirect, 'error');
      assert.equal(request.headers.Authorization, 'Bearer synthetic-no-credential');
      assert.ok(url.startsWith(prefix));
      calls.push(url);
      if (respond) return respond(url, request, calls.length);
      return json(url === prefix ? selectedRun : { total_count: selectedJobs.length, jobs: selectedJobs });
    },
  };
  return { options, calls };
}

test('T-MACADM001 queued started_at placeholders never admit ARM regression', () => {
  const queued = jobs();
  queued[0].steps = [{ status: 'queued', started_at: startedAt }];
  queued[1].steps = [{ status: 'completed', conclusion: 'skipped', started_at: startedAt }];
  const result = evaluateMacAdmission(observation(queued), expected);
  assert.equal(result.admitted, false);
  assert.deepEqual(result.parts.map(part => part.allocated), [false, false, false, false]);
  assert.equal(evaluateMacAdmission(observation(queued.slice(0, 3)), expected).parts[3].proof, 'missing');
});

test('T-MACADM002 all four worker allocations admit without waiting for completion or Intel', () => {
  const allocated = jobs({ status: 'in_progress', runner_name: 'synthetic-worker' });
  allocated[1] = { ...allocated[1], runner_name: '', steps: [
    { status: 'in_progress', conclusion: null, started_at: startedAt }] };
  allocated[2] = { ...allocated[2], status: 'completed', conclusion: 'failure' };
  const intel = { ...jobs()[0], id: 99, name: 'native-macos-x64-framework-body-0' };
  const result = evaluateMacAdmission(observation([...allocated, intel]), expected);
  assert.equal(result.admitted, true);
  assert.deepEqual(result.parts.map(part => part.proof), ['runner', 'started-step', 'runner', 'runner']);
  assert.equal(result.parts[2].conclusion, 'failure', 'Admission is not a native correctness pass');
  assert.ok(!JSON.stringify(result).includes('synthetic-worker'), 'Runner identity is not retained');
  assert.equal(evaluateMacAdmission(observation(allocated.map(job => ({
    ...job, status: 'completed', conclusion: 'success',
  })), run({ status: 'completed', conclusion: 'success' })), expected).admitted, true);
});

test('T-MACADM003 wrong repository source event run attempt duplicates and incomplete lists fail closed', () => {
  for (const change of [
    { repository: { full_name: 'other/repository' } }, { head_sha: 'b'.repeat(40) },
    { id: 53 }, { run_attempt: 1 }, { event: 'push' },
  ]) assert.throws(() => evaluateMacAdmission(observation(jobs(), run(change)), expected),
    { code: 'ADMISSION_IDENTITY' });
  for (const change of [
    { run_id: 53 }, { run_attempt: 1 }, { head_sha: 'b'.repeat(40) },
    { run_url: 'https://api.github.com/repos/other/repository/actions/runs/52' },
    { id: 2 }, { status: 'unreadable' },
  ]) {
    const selected = jobs();
    selected[0] = { ...selected[0], ...change };
    assert.throws(() => evaluateMacAdmission(observation(selected), expected), { code: 'ADMISSION_IDENTITY' });
  }
  const duplicate = [...jobs(), { ...jobs()[0], id: 99 }];
  assert.throws(() => evaluateMacAdmission(observation(duplicate), expected), { code: 'ADMISSION_IDENTITY' });
  assert.throws(() => evaluateMacAdmission({ ...observation(), complete: false }, expected),
    { code: 'ADMISSION_IDENTITY' });
});

test('T-MACADM004 cancelled unallocated and terminal missing jobs preserve explicit non-admission', () => {
  const selected = jobs();
  selected[0] = { ...selected[0], status: 'completed', conclusion: 'cancelled' };
  assert.throws(() => evaluateMacAdmission(observation(selected), expected), error =>
    error.code === 'ADMISSION_TERMINATED' && error.observation.parts[0].allocated === false);
  assert.throws(() => evaluateMacAdmission(observation([], run({
    status: 'completed', conclusion: 'cancelled',
  })), expected), { code: 'ADMISSION_TERMINATED' });
});

test('T-MACADM005 bounded adapter reads only the exact attempt and returns at allocation', async () => {
  const ready = adapter();
  assert.equal((await waitForMacAdmission(expected, ready.options)).admitted, true);
  assert.deepEqual(ready.calls, [prefix, `${prefix}/jobs?per_page=100&page=1`]);
  const finished = adapter({
    selectedRun: run({ status: 'completed', conclusion: 'success' }),
    selectedJobs: jobs({ status: 'completed', conclusion: 'success', runner_name: 'synthetic-worker' }),
  });
  assert.equal((await waitForMacAdmission(expected, finished.options)).admitted, true);
});

test('T-MACADM006 complete bounded pagination rejects omissions drift duplicates and foreign links', async () => {
  const all = [...jobs({ status: 'in_progress', runner_name: 'synthetic-worker' }),
    ...Array.from({ length: 97 }, (_, index) => ({
      ...jobs()[0], id: index + 10, name: `synthetic-other-${index}`,
    }))];
  const next = `<${prefix}/jobs?per_page=100&page=2>; rel="next"`;
  const paged = adapter({ respond: url => url === prefix ? json(run()) :
    json({ total_count: 101, jobs: url.endsWith('page=1') ? all.slice(0, 100) : all.slice(100) },
      200, url.endsWith('page=1') ? { link: next } : {}) });
  assert.equal((await waitForMacAdmission(expected, paged.options)).admitted, true);
  assert.equal(paged.calls.length, 3);
  for (const respond of [
    () => json({ total_count: 101, jobs: all.slice(0, 100) }),
    () => json({ total_count: 101, jobs: all.slice(0, 99) }, 200, { link: next }),
    () => json({ total_count: 2001, jobs: [] }),
    () => json({ total_count: 101, jobs: all.slice(0, 100) }, 200,
      { link: next.replace('api.github.com', 'untrusted.invalid') }),
    url => json(url.endsWith('page=1') ? { total_count: 101, jobs: all.slice(0, 100) } :
      { total_count: 100, jobs: all.slice(100) }, 200, url.endsWith('page=1') ? { link: next } : {}),
    url => json({ total_count: 101, jobs: url.endsWith('page=1') ? all.slice(0, 100) : [all[0]] },
      200, url.endsWith('page=1') ? { link: next } : {}),
  ]) {
    const invalid = adapter({ respond: url => url === prefix ? json(run()) : respond(url) });
    await assert.rejects(waitForMacAdmission(expected, invalid.options), { code: 'ADMISSION_IDENTITY' });
  }
});

test('T-MACADM007 timeout cancellation and unreadable provider never return success and retain observation', async () => {
  const pending = adapter({ selectedJobs: jobs() });
  await assert.rejects(waitForMacAdmission(expected, pending.options), error =>
    error.code === 'ADMISSION_TIMEOUT' && error.observation.admitted === false);
  const controller = new AbortController();
  const cancelled = adapter({ selectedJobs: jobs() });
  cancelled.options.signal = controller.signal;
  cancelled.options.sleep = async () => { controller.abort(); };
  await assert.rejects(waitForMacAdmission(expected, cancelled.options), error =>
    error.code === 'ADMISSION_CANCELLED' && error.observation.parts.length === 4);
  const denied = adapter({ respond: () => json({ private: 'not retained' }, 403) });
  await assert.rejects(waitForMacAdmission(expected, denied.options), { code: 'ADMISSION_HTTP' });
  assert.equal(denied.calls.length, 1, 'Authorization failure must not retry or retrieve credentials');
  const unreadable = adapter({ respond: () => new Response('not JSON') });
  await assert.rejects(waitForMacAdmission(expected, unreadable.options), { code: 'ADMISSION_PROVIDER' });
});

test('T-MACADM008 only classified transient GET failures retry finitely without losing the original pending fact', async () => {
  let transient = 0;
  const recovered = adapter({ respond: url => {
    if (transient++ === 0) return json({}, 503);
    return json(url === prefix ? run() : {
      total_count: 4, jobs: jobs({ status: 'in_progress', runner_name: 'synthetic-worker' }),
    });
  } });
  recovered.options.timeoutMs = 10000;
  assert.equal((await waitForMacAdmission(expected, recovered.options)).admitted, true);
  assert.equal(recovered.calls.length, 3);
  const failed = adapter({ respond: () => json({}, 503) });
  failed.options.timeoutMs = 10000;
  await assert.rejects(waitForMacAdmission(expected, failed.options), { code: 'ADMISSION_HTTP' });
  assert.equal(failed.calls.length, 3);
  const lost = adapter({ respond: (url, request, count) => count > 2 ? json({}, 401) :
    json(url === prefix ? run() : { total_count: 4, jobs: jobs() }) });
  await assert.rejects(waitForMacAdmission(expected, lost.options), error =>
    error.code === 'ADMISSION_HTTP' && error.observation.admitted === false);
});

test('T-MACADM017 delayed provider allocation remains observable without waiving timeout or terminal failure', async () => {
  const identity = { ...expected, group: 'arm-bodies' };
  for (const outcome of ['allocated', 'pending', 'terminated']) {
    let time = 0;
    let observedPastOldCutoff = false;
    const options = {
      token: 'synthetic-no-credential', pollMs: 5000, now: () => time,
      sleep: async ms => { time += ms; },
      fetch: async (url, request) => {
        assert.equal(request.method, 'GET');
        assert.equal(request.redirect, 'error');
        assert.ok(url.startsWith(prefix));
        if (time > 8 * 60 * 1000) observedPastOldCutoff = true;
        const late = time >= 11 * 60 * 1000;
        if (url === prefix) return json(run());
        return json({ total_count: 3, jobs: jobs().slice(1).map(job => ({
          ...job,
          ...(late && outcome === 'allocated' ?
            { status: 'in_progress', runner_name: 'synthetic-late-worker' } : {}),
          ...(late && outcome === 'terminated' ?
            { status: 'completed', conclusion: 'cancelled' } : {}),
        })) });
      },
    };
    if (outcome === 'allocated') {
      const result = await waitForMacAdmission(identity, options);
      assert.equal(result.admitted, true);
      assert.equal(time, 11 * 60 * 1000);
      assert.ok(result.parts.every(part => part.proof === 'runner' && part.conclusion === null));
    } else {
      await assert.rejects(waitForMacAdmission(identity, options), error =>
        error.code === (outcome === 'pending' ? 'ADMISSION_TIMEOUT' : 'ADMISSION_TERMINATED') &&
        error.observation.admitted === false);
      assert.equal(time, (outcome === 'pending' ? 20 : 11) * 60 * 1000);
    }
    assert.equal(observedPastOldCutoff, true);
  }
});

// PR-only: owned synthetic metadata, no provider, timers, shared resources or critical promotion.
test('T-MACADM025 ready ARM frontier reserves all bodies and refresh before Intel secondaries and auxiliaries', async () => {
  const ci = parseWorkflow({ file: '.github/workflows/ci.yml',
    contents: await fs.readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8') });
  assert.equal(ci.env.SDLC_MAC_ADMISSION_POLICY, 'arm-regression-allocation-v11-ready-arm-frontier');
  assert.match(ci.jobs['intel-retained-admission'].steps[4].run, /--group intel-secondaries-ready-arm-frontier /u);
  for (const key of ['intel-admission', 'intel-homebrew-admission'])
    assert.match(ci.jobs[key].steps[4].run, /--group intel-auxiliaries-ready-arm-frontier /u);
  for (const [group, intelBodies] of [
    ['intel-secondaries-ready-arm-frontier', 1], ['intel-auxiliaries-ready-arm-frontier', 3],
  ]) {
    const identity = { ...expected, group };
    const records = frontierJobs();
    const admitted = selected => evaluateMacAdmission(observation(selected), identity);
    const arm = records.filter(record => record.name.includes('arm64-framework-') && !record.name.endsWith('units'));
    const intel = records.filter(record => record.name.includes('x64-framework-body'));
    allocate(intel[0]);
    assert.equal(admitted(records).admitted, false, 'Actual Intel primary cannot overtake the ready ARM frontier');
    allocate(arm[0]);
    assert.equal(evaluateMacAdmission(observation(records),
      { ...expected, group: 'arm-refresh-ready' }).admitted, true,
    'Independent Intel primary supplies the Intel turn; ARM refresh cannot cycle on gated secondaries');
    for (const record of arm.filter(record => !record.name.endsWith('refresh'))) allocate(record);
    assert.equal(admitted(records).admitted, false, 'Mandatory ARM refresh must also receive actual allocation');
    allocate(arm.find(record => record.name.endsWith('refresh')));
    assert.equal(admitted(records).admitted, intelBodies === 1,
      'Secondaries need only Intel primary; auxiliaries retain every ready Intel body requirement');
    for (const record of intel.slice(1)) allocate(record);
    const ready = admitted(records);
    assert.equal(ready.admitted, true, 'Executing producers need not finish to release Intel requests');
    assert.deepEqual(ready.readiness.map(platform => [platform.target, platform.minimumAllocations]),
      [['macos-arm64', 4], ['macos-x64', intelBodies]]);
    assert.equal(ready.parts.length, 4 + intelBodies);
    assert.ok(ready.parts.every(part => part.status === 'in_progress' && part.conclusion === null));
    const completed = records.map(record => ({ ...record, status: 'completed',
      conclusion: 'success', completed_at: startedAt }));
    assert.equal(admitted(completed).admitted, true, 'Completed allocated frontier parts remain proof');
    for (const name of [...arm.map(record => record.name), intel[0].name]) {
      const placeholders = records.map(record => record.name === name ? { ...record, status: 'queued',
        runner_name: '', steps: [{ status: 'completed', conclusion: 'skipped', started_at: startedAt }] } : record);
      assert.equal(admitted(placeholders).admitted, false, `Queued timestamp cannot prove ${name}`);
    }
    const future = frontierJobs();
    Object.assign(future[0], { status: 'in_progress', conclusion: null });
    for (const record of future.filter(record => record.name.includes('x64-framework-body')).slice(0, intelBodies)) allocate(record);
    assert.equal(admitted(future).admitted, true, 'Unfinished foreign units must not reserve future allocation');
    assert.equal(admitted(future.filter(record => record.id !== 100)).admitted, true);
    assert.equal(admitted(records.filter(record => record.id !== 102)).admitted, false,
      'Both complete own Intel unit producers are required');
    assert.throws(() => admitted(records.map(record => record.id === 102 ?
      { ...record, conclusion: 'failure' } : record)), { code: 'ADMISSION_TERMINATED' });
    assert.throws(() => admitted([...records, { ...records.find(record => record.id === 300), id: 999 }]),
      { code: 'ADMISSION_IDENTITY' }, 'Refresh identity is part of the closed frontier');
    const cancelled = records.map(record => record.id === 300 ? { ...record, runner_name: '',
      status: 'completed', conclusion: 'cancelled' } : record);
    assert.throws(() => admitted(cancelled), { code: 'ADMISSION_TERMINATED' });
    const historical = evaluateMacAdmission(observation(records.filter(record => record.id !== 300)),
      { ...expected, group: 'intel-auxiliaries-ready' });
    assert.equal(historical.admitted, true, 'Historical v9/v10 auxiliary semantics do not acquire a refresh wait');
    assert.equal(evaluateMacAdmission(observation([intel[0]]),
      { ...expected, group: 'intel-primary-body' }).admitted, true, 'Historical primary group stays allocation-only');
  }
});

// PR-only: native-validation maintainer, one-slot synthetic GET metadata and private clock.
test('T-MACADM026 ready ARM frontier observations retain allocation changes cancellation and failed reads', async () => {
  for (const group of ['intel-secondaries-ready-arm-frontier', 'intel-auxiliaries-ready-arm-frontier']) {
    const identity = { ...expected, group };
    const records = frontierJobs();
    for (const record of records.filter(record => record.name.includes('framework-body'))) allocate(record);
    Object.assign(records[0], { status: 'in_progress', conclusion: null });
    const primary = records.find(record => record.name.endsWith('x64-framework-body-0'));
    Object.assign(primary, { status: 'queued', runner_name: '' });
    const source = adapter({ selectedJobs: records });
    let time = 0;
    source.options.now = () => time;
    source.options.sleep = async ms => {
      time += ms;
      if (time === 3) {
        Object.assign(records[0], { status: 'completed', conclusion: 'success' });
        allocate(primary);
      } else allocate(records.find(record => record.id === 300));
    };
    const result = await waitForMacAdmission(identity, source.options);
    assert.deepEqual(result.observations.map(row => [row.elapsedMs, row.admitted]),
      [[0, false], [3, false], [6, true]]);
    assert.deepEqual(result.observations.map(row => row.readiness[0].ready), [false, true, true]);
    assert.ok(result.observations[1].parts.some(part => part.name.endsWith('refresh') && !part.allocated));
    for (const mode of ['timeout', 'cancel', 'denied', 'unreadable', 'terminal']) {
      const pending = frontierJobs();
      const controller = new AbortController();
      const transport = adapter({ selectedJobs: pending });
      transport.options.signal = controller.signal;
      if (mode === 'cancel') transport.options.sleep = async () => controller.abort();
      if (mode === 'denied' || mode === 'unreadable') transport.options.fetch = async url =>
        transport.calls.push(url) <= 2 ? json(url === prefix ? run() :
          { total_count: pending.length, jobs: pending }) :
          mode === 'denied' ? json({}, 403) : new Response('not JSON');
      if (mode === 'terminal') Object.assign(pending.find(record => record.id === 300),
        { status: 'completed', conclusion: 'cancelled' });
      await assert.rejects(waitForMacAdmission(identity, transport.options), error =>
        error.code === ({ timeout: 'ADMISSION_TIMEOUT', cancel: 'ADMISSION_CANCELLED', denied: 'ADMISSION_HTTP',
          unreadable: 'ADMISSION_PROVIDER', terminal: 'ADMISSION_TERMINATED' })[mode] &&
        error.observation.admitted === false && error.observation.observations.length >= 1);
    }
  }
});

test('T-MACADM019 Intel auxiliaries yield to ready critical bodies across architectures without waiting for future units', () => {
  const identity = { ...expected, group: 'intel-auxiliaries-ready' };
  const records = criticalJobs();
  const admitted = selected => evaluateMacAdmission(observation(selected), identity);
  for (const body of records.filter(record => record.name.includes('x64-framework-body'))) allocate(body);
  assert.equal(admitted(records).admitted, false,
    'Three Intel allocations cannot let refresh/Homebrew overtake already-ready queued ARM bodies');
  for (const body of records.filter(record => record.name.includes('arm64-framework-body'))) {
    allocate(body);
    if (body.name.endsWith('body-1')) assert.equal(admitted(records).admitted, false);
  }
  const ready = admitted(records);
  assert.equal(ready.admitted, true, 'All six bodies may still be executing when auxiliaries are requested');
  assert.equal(ready.parts.length, 6);
  assert.ok(ready.parts.every(part => part.status === 'in_progress' && part.conclusion === null));
  assert.deepEqual(ready.readiness.map(platform => [platform.target, platform.ready]),
    [['macos-arm64', true], ['macos-x64', true]]);
  const future = criticalJobs();
  future[0].status = 'in_progress';
  future[0].conclusion = null;
  for (const body of future.filter(record => record.name.includes('x64-framework-body'))) allocate(body);
  assert.equal(admitted(future).admitted, true, 'Unfinished foreign units must not reserve a future turn');
  assert.equal(admitted(future.filter(record => record.id !== 100)).admitted, true);
  assert.equal(admitted(records.filter(record => record.id !== 102)).admitted, false,
    'Both real Intel unit origins remain mandatory');
  assert.throws(() => admitted(records.map(record => record.id === 102 ?
    { ...record, conclusion: 'failure' } : record)), { code: 'ADMISSION_TERMINATED' });
  for (const change of [{ run_attempt: 1 }, { head_sha: 'b'.repeat(40) }]) {
    assert.throws(() => admitted(records.map(record => record.id === 100 ? { ...record, ...change } : record)),
      { code: 'ADMISSION_IDENTITY' });
  }
  assert.throws(() => admitted([...records, { ...records[0], id: 999 }]), { code: 'ADMISSION_IDENTITY' });
});

test('T-MACADM020 mandatory ARM refresh takes a bounded fair turn without the full body allocation chain', async () => {
  const contents = await fs.readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const ci = parseWorkflow({ file: '.github/workflows/ci.yml', contents });
  assert.deepEqual(ci.jobs['native-ma-refresh'].needs, ['intent', 'source', 'native-units-ma', 'mac-admission']);
  const identity = { ...expected, group: 'arm-refresh-ready' };
  const records = criticalJobs();
  const admitted = selected => evaluateMacAdmission(observation(selected), identity);
  assert.equal(admitted(records).admitted, false, 'Refresh cannot eagerly overtake every ready critical body');
  allocate(records.find(record => record.name.endsWith('arm64-framework-body-2')));
  assert.equal(admitted(records).admitted, false, 'The ready Intel cohort also receives its first critical turn');
  allocate(records.find(record => record.name.endsWith('x64-framework-body-1')));
  const ready = admitted(records);
  assert.equal(ready.admitted, true,
    'One actual body allocation per ready architecture gives mandatory refresh a starvation-safe turn');
  assert.equal(ready.parts.filter(part => part.allocated).length, 2);
  assert.equal(ready.parts.filter(part => !part.allocated).length, 4,
    'Queued bodies and the unallocated Intel primary must not recreate the historical full chain');
  assert.equal(ready.parts.find(part => part.name.endsWith('x64-framework-body-0')).allocated, false);
  const laterIntel = records.map(record => record.id === 101 || record.id === 102 ?
    { ...record, status: 'in_progress', conclusion: null } : record);
  assert.equal(admitted(laterIntel).admitted, true, 'ARM refresh does not wait for future Intel unit completion');
  assert.equal(admitted(records.filter(record => record.id !== 100)).admitted, false);
  assert.deepEqual(ci.jobs['arm-refresh-admission'].needs,
    ['intent', 'source', 'native-units-ma', 'mac-admission']);
  assert.match(ci.jobs['mac-admission'].steps[4].run, /--group arm-refresh-ready /u);
  for (const key of ['intel-admission', 'intel-homebrew-admission']) {
    assert.deepEqual(ci.jobs[key].needs, ['intent', 'source', 'native-units-mi']);
    assert.match(ci.jobs[key].steps[4].run, /--group intel-auxiliaries-ready-arm-frontier /u);
  }
  assert.deepEqual(ci.jobs['native-mi-retained'].needs, ['intent', 'source', 'native-units-mi']);
  assert.deepEqual(ci.jobs['native-mi'].needs,
    ['intent', 'source', 'native-units-mi', 'intel-retained-admission']);
  assert.deepEqual(ci.jobs['native-ma'].needs, ['intent', 'source', 'native-units-ma']);
});

test('T-MACADM021 readiness fairness cannot relabel historical source admission graphs', async () => {
  const contents = await fs.readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const ci = parseWorkflow({ file: '.github/workflows/ci.yml', contents });
  restoreV10Groups(ci);
  ci.env.SDLC_MAC_ADMISSION_POLICY = 'arm-regression-allocation-v9-ready-critical-fairness';
  ci.env.SDLC_NATIVE_FRAMEWORK_SHARD_PROTOCOL = 'native-framework-shards-v6-stable-cost-components';
  ci.jobs['native-mi'].needs = ['intent', 'source', 'native-units-mi'];
  const inspect = document => inspectWorkflowTrust([{ file: '.github/workflows/ci.yml',
    contents: Object.entries(document).map(([key, value]) =>
      `${JSON.stringify(key)}: ${JSON.stringify(value)}`).join('\n') + '\n' }]);
  assert.equal(ci.env.SDLC_MAC_ADMISSION_POLICY, 'arm-regression-allocation-v9-ready-critical-fairness');
  assert.equal(inspect(ci).complete, true, JSON.stringify(inspect(ci).blockers));
  const v8 = structuredClone(ci);
  v8.env.SDLC_MAC_ADMISSION_POLICY = 'arm-regression-allocation-v8-own-platform-critical';
  v8.env.SDLC_NATIVE_FRAMEWORK_SHARD_PROTOCOL = 'native-framework-shards-v5-root-components';
  for (const key of ['native-ma-refresh', 'arm-refresh-admission']) {
    v8.jobs[key].needs = ['intent', 'source', 'native-units-ma', 'intel-retained-admission', 'mac-admission'];
  }
  v8.jobs['mac-admission'].steps[4].name = 'Wait for actual ARM body worker allocation';
  v8.jobs['mac-admission'].steps[4].run =
    v8.jobs['mac-admission'].steps[4].run.replace('--group arm-refresh-ready', '--group arm-bodies');
  for (const key of ['intel-admission', 'intel-homebrew-admission']) {
    v8.jobs[key].steps[4].name = `Wait for actual Intel ${key === 'intel-admission' ? '' : 'critical '}body worker allocation`;
    v8.jobs[key].steps[4].run =
      v8.jobs[key].steps[4].run.replace('--group intel-auxiliaries-ready', '--group intel-bodies');
  }
  assert.equal(inspect(v8).complete, true, JSON.stringify(inspect(v8).blockers));
  const v7 = structuredClone(v8);
  v7.env.SDLC_MAC_ADMISSION_POLICY = 'arm-regression-allocation-v7-bounded-queue-wait';
  for (const key of ['native-mi-retained', 'intel-retained-admission']) v7.jobs[key].needs.push('mac-admission');
  for (const key of ['native-mi', 'intel-admission', 'intel-homebrew-admission']) v7.jobs[key].needs.push('arm-refresh-admission');
  for (const key of ['native-ma-refresh', 'arm-refresh-admission']) {
    v7.jobs[key].needs = v7.jobs[key].needs.filter(dep => dep !== 'mac-admission');
  }
  assert.equal(inspect(v7).complete, true, JSON.stringify(inspect(v7).blockers));
  for (const historical of [v7, v8]) {
    const relabeled = structuredClone(historical);
    relabeled.env.SDLC_MAC_ADMISSION_POLICY = ci.env.SDLC_MAC_ADMISSION_POLICY;
    assert.equal(inspect(relabeled).complete, false, 'A historical allocation graph is not readiness-aware v9');
    const mislabeled = structuredClone(ci);
    mislabeled.env.SDLC_MAC_ADMISSION_POLICY = historical.env.SDLC_MAC_ADMISSION_POLICY;
    assert.equal(inspect(mislabeled).complete, false, 'New readiness decisions cannot borrow historical identity');
  }
  for (const key of ['mac-admission', 'intel-admission', 'intel-homebrew-admission']) {
    const hybrid = structuredClone(ci);
    hybrid.jobs[key].steps[4] = v8.jobs[key].steps[4];
    assert.equal(inspect(hybrid).complete, false, 'The authenticated recipe must select the matching closed group');
  }
});

test('T-MACADM022 readiness observations retain changing critical cohorts allocation and bounded failures', async () => {
  const records = criticalJobs();
  records[0].status = 'in_progress';
  records[0].conclusion = null;
  for (const record of records.filter(record => record.name.includes('x64-framework-body') &&
    !record.name.endsWith('body-2'))) allocate(record);
  let time = 0;
  const source = adapter({ selectedJobs: records });
  source.options.now = () => time;
  source.options.sleep = async ms => {
    time += ms;
    if (time === 3) {
      Object.assign(records[0], { status: 'completed', conclusion: 'success' });
      allocate(records.find(record => record.name.endsWith('x64-framework-body-2')));
    } else for (const record of records.filter(record => record.name.includes('arm64-framework-body'))) allocate(record);
  };
  const identity = { ...expected, group: 'intel-auxiliaries-ready' };
  const ready = await waitForMacAdmission(identity, source.options);
  assert.equal(time, 6, 'A newly ready foreign critical cohort must be observed before admission');
  assert.deepEqual(ready.observations.map(row => row.elapsedMs), [0, 3, 6]);
  assert.deepEqual(ready.observations.map(row => row.readiness[0].ready), [false, true, true]);
  assert.deepEqual(ready.observations.map(row => row.admitted), [false, false, true]);
  assert.equal(ready.parts[0].requestedAt, '2026-10-23T10:42:06Z');
  assert.equal(ready.readiness[1].units.length, 2);
  for (const mode of ['timeout', 'cancel', 'terminal']) {
    const pending = criticalJobs();
    const transport = adapter({ selectedJobs: pending });
    const controller = new AbortController();
    transport.options.signal = controller.signal;
    if (mode === 'cancel') transport.options.sleep = async () => controller.abort();
    if (mode === 'terminal') Object.assign(pending.find(record => record.id === 200),
      { status: 'completed', conclusion: 'cancelled' });
    await assert.rejects(waitForMacAdmission(identity, transport.options), error =>
      error.code === ({ timeout: 'ADMISSION_TIMEOUT', cancel: 'ADMISSION_CANCELLED',
        terminal: 'ADMISSION_TERMINATED' })[mode] && error.observation.admitted === false &&
      error.observation.observations.length >= 1);
  }
});

// PR-only: native-validation maintainer; one-slot Node/source and synthetic metadata, no shared resources.
test('T-MACADM023 Intel secondary requests wait for actual primary allocation without reserving future ARM units', async () => {
  const contents = await fs.readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const ci = parseWorkflow({ file: '.github/workflows/ci.yml', contents });
  const results = new Map([['intent', 'success'], ['source', 'success'], ['native-units-mi', 'success']]);
  const eligible = key => ci.jobs[key].needs.every(dep => results.get(dep) === 'success');
  assert.equal(eligible('native-mi-retained'), true);
  assert.equal(eligible('intel-retained-admission'), true);
  assert.equal(eligible('native-mi'), false,
    'Simultaneous secondary requests must not compete with the unallocated primary');
  assert.deepEqual(ci.jobs['native-mi'].strategy.matrix.include.map(part => part.shard), ['body-1', 'body-2']);
  const group = /--group ([a-z-]+)/u.exec(ci.jobs['intel-retained-admission'].steps[4].run)[1];
  const records = criticalJobs();
  Object.assign(records[0], { status: 'queued', conclusion: null, runner_name: '', steps: [] });
  allocate(records.find(record => record.name.endsWith('x64-framework-body-1')));
  const identity = { ...expected, group };
  const admitted = () => evaluateMacAdmission(observation(records), identity);
  assert.equal(admitted().admitted, false,
    'Queued primary timestamps and an allocated secondary cannot release the secondary matrix');
  const primary = records.find(record => record.name.endsWith('x64-framework-body-0'));
  Object.assign(primary, { status: 'in_progress', runner_name: '',
    steps: [{ name: 'Set up job', status: 'in_progress', started_at: startedAt }] });
  const allocation = admitted();
  assert.equal(allocation.admitted, true);
  assert.deepEqual(allocation.parts.map(part => [part.name, part.proof, part.conclusion]),
    [['native-macos-x64-framework-body-0', 'started-step', null]]);
  const transport = adapter({ selectedJobs: records });
  assert.equal((await waitForMacAdmission(identity, transport.options)).admitted, true);
  assert.deepEqual(transport.calls, [prefix, `${prefix}/jobs?per_page=100&page=1`]);
  results.set('intel-retained-admission', 'success');
  assert.equal(eligible('native-mi'), true,
    'Primary allocation releases secondaries while primary and foreign units remain unfinished');
  assert.equal(eligible('native-homebrew-mi'), false);
  assert.equal(eligible('native-mi-refresh'), false);
  for (const result of ['failure', undefined]) {
    results.set('native-units-mi', result);
    for (const key of ['native-mi-retained', 'intel-retained-admission', 'native-mi']) {
      assert.equal(eligible(key), false, 'Both actual own-unit origins remain prerequisites');
    }
  }
  const coordinators = Object.values(ci.jobs).filter(job =>
    job.steps?.some(step => /scripts\/macos-runner-admission\.mjs/u.test(step.run ?? '')));
  assert.equal(coordinators.length, 5);
  assert.ok(coordinators.every(job => job['runs-on'] === 'ubuntu-24.04' && job['timeout-minutes'] === 22));
  assert.equal(Object.values(ci.jobs).reduce((count, job) =>
    count + (job.strategy?.matrix?.include?.length ?? 1), 0), 34);
});

test('T-MACADM024 primary-first admission preserves authentic v9 graphs and rejects v9 v10 relabels', async () => {
  const contents = await fs.readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const current = parseWorkflow({ file: '.github/workflows/ci.yml', contents });
  const inspect = document => inspectWorkflowTrust([{ file: '.github/workflows/ci.yml',
    contents: Object.entries(document).map(([key, value]) =>
      `${JSON.stringify(key)}: ${JSON.stringify(value)}`).join('\n') + '\n' }]);
  const v10 = structuredClone(current);
  restoreV10Groups(v10);
  v10.env.SDLC_MAC_ADMISSION_POLICY = 'arm-regression-allocation-v10-intel-primary-first';
  v10.jobs['native-mi'].needs = ['intent', 'source', 'native-units-mi', 'intel-retained-admission'];
  assert.equal(inspect(v10).complete, true, JSON.stringify(inspect(v10).blockers));
  const v9 = structuredClone(v10);
  v9.env.SDLC_MAC_ADMISSION_POLICY = 'arm-regression-allocation-v9-ready-critical-fairness';
  v9.env.SDLC_NATIVE_FRAMEWORK_SHARD_PROTOCOL = 'native-framework-shards-v6-stable-cost-components';
  v9.jobs['native-mi'].needs = ['intent', 'source', 'native-units-mi'];
  assert.equal(inspect(v9).complete, true, JSON.stringify(inspect(v9).blockers));
  assert.equal(inspect(current).complete, true, JSON.stringify(inspect(current).blockers));
  for (const [graph, policy] of [[v10, current.env.SDLC_MAC_ADMISSION_POLICY],
    [current, v10.env.SDLC_MAC_ADMISSION_POLICY]]) {
    const relabeled = structuredClone(graph);
    relabeled.env.SDLC_MAC_ADMISSION_POLICY = policy;
    assert.ok(inspect(relabeled).blockers.some(blocker => blocker.code === 'MAC_ADMISSION_POLICY_DIFFERS'),
      'V10 and v11 have different closed allocation groups despite the same producer graph');
  }
  for (const key of ['intel-retained-admission', 'intel-admission', 'intel-homebrew-admission']) {
    const hybrid = structuredClone(current);
    hybrid.jobs[key].steps[4] = v10.jobs[key].steps[4];
    assert.equal(inspect(hybrid).complete, false, 'Each v11 gate must observe the ready ARM frontier');
  }
  for (const [graph, policy] of [[v9, v10.env.SDLC_MAC_ADMISSION_POLICY],
    [v10, v9.env.SDLC_MAC_ADMISSION_POLICY]]) {
    const relabeled = structuredClone(graph);
    relabeled.env.SDLC_MAC_ADMISSION_POLICY = policy;
    assert.ok(inspect(relabeled).blockers.some(blocker => blocker.code === 'NATIVE_COMPONENT_MATRIX_DIFFERS'),
      'The two source request graphs cannot borrow each other’s protocol identity');
  }
  for (const [key, dependency] of [['native-mi', 'native-mi-retained'],
    ['native-mi-retained', 'native-mi'], ['intel-retained-admission', 'native-mi']]) {
    const completionWait = structuredClone(v10);
    if (key === 'native-mi') completionWait.jobs[key].needs =
      completionWait.jobs[key].needs.filter(dep => dep !== 'intel-retained-admission');
    completionWait.jobs[key].needs.push(dependency);
    assert.equal(inspect(completionWait).complete, false,
      'Primary completion waits and observed-producer dependency cycles are not v10');
  }
  const wrongGroup = structuredClone(v10);
  wrongGroup.jobs['intel-retained-admission'].steps[4].run =
    wrongGroup.jobs['intel-retained-admission'].steps[4].run.replace('--group intel-primary-body', '--group intel-bodies');
  assert.equal(inspect(wrongGroup).complete, false,
    'The gate cannot observe its own downstream secondary matrix');
});

// PR-only: native-validation maintainer; Node-only, isolated read-only workflow and synthetic metadata.
test('T-MACADM018 queued ARM allocation cannot suppress own-unit-ready Intel critical requests', async () => {
  const contents = await fs.readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const ci = parseWorkflow({ file: '.github/workflows/ci.yml', contents });
  const results = new Map([['intent', 'success'], ['source', 'success'], ['native-units-mi', 'success']]);
  const eligible = key => ci.jobs[key].needs.every(dep => results.get(dep) === 'success');
  const arm = evaluateMacAdmission(observation(jobs()), { ...expected, group: 'arm-bodies' });
  assert.equal(arm.admitted, false, 'Queued timestamp placeholders remain unverified allocation');
  for (const key of ['native-mi-retained', 'intel-retained-admission',
    'intel-admission', 'intel-homebrew-admission']) {
    assert.equal(eligible(key), true, `${key} must not wait for queued ARM bodies or refresh`);
    for (const unitResult of ['failure', undefined]) {
      results.set('native-units-mi', unitResult);
      assert.equal(eligible(key), false, `${key} must require the complete successful Intel unit matrix`);
    }
    results.set('native-units-mi', 'success');
  }
  assert.equal(eligible('native-mi'), false, 'The allocation observer still gates secondaries');
  assert.equal(ci.jobs['native-units-mi'].strategy.matrix.include.length, 2);
  assert.equal(eligible('native-homebrew-mi'), false);
  assert.equal(eligible('native-mi-refresh'), false);
  const intel = [0, 1, 2].map(index => ({ ...jobs()[0], id: 50 + index,
    name: `native-macos-x64-framework-body-${index}` }));
  const allocated = () => evaluateMacAdmission(observation(intel), { ...expected, group: 'intel-bodies' });
  assert.equal(allocated().admitted, false);
  allocate(intel[0]);
  assert.equal(evaluateMacAdmission(observation(intel), { ...expected, group: 'intel-primary-body' }).admitted, true);
  results.set('intel-retained-admission', 'success');
  assert.equal(eligible('native-mi'), true, 'Missing foreign unit origins cannot reserve future ARM capacity');
  for (const record of intel) Object.assign(record, { status: 'in_progress', runner_name: 'synthetic-intel' });
  assert.equal(allocated().admitted, true, 'Actual allocation, not ARM completion, releases opportunistic work');
  results.set('intel-admission', 'success');
  results.set('intel-homebrew-admission', 'success');
  assert.equal(eligible('native-homebrew-mi'), true);
  assert.equal(eligible('native-mi-refresh'), true);
  for (const key of ['native-ma-refresh', 'arm-refresh-admission']) {
    assert.ok(ci.jobs[key].needs.includes('mac-admission'), 'ARM refresh retains the readiness-aware fair-turn gate');
    assert.ok(ci.jobs[key].needs.includes('native-units-ma'));
  }
});

test('T-MACADM009 Linux admission preserves all twenty-five native identities barriers pins limits and critical budget', async () => {
  const contents = await fs.readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const ci = parseWorkflow({ file: '.github/workflows/ci.yml', contents });
  const macJobs = Object.entries(ci.jobs).flatMap(([key, job]) =>
    (job.strategy?.matrix?.include ?? []).filter(part => part.target?.startsWith('macos-'))
      .map(part => ({ key, part, needs: job.needs })));
  const records = macJobs.map(({ part }, index) => ({
    ...jobs()[0], id: 100 + index, name: `native-${part.role}`,
  }));
  const active = new Set();
  const trace = [];
  const gates = new Set();
  const initial = new Set(['intent', 'source']);
  const done = key => initial.has(key) || gates.has(key) ||
    macJobs.some(job => job.key === key) && macJobs.filter(job => job.key === key)
      .every(job => records.find(record => record.name === `native-${job.part.role}`).status === 'completed');
  const allocate = name => {
    const record = records.find(record => record.name === name);
    assert.ok(record && record.status === 'queued');
    record.status = 'in_progress';
    record.runner_name = 'controlled-allocation-worker';
    active.add(name);
    assert.ok(active.size <= 5, 'The controlled shared Mac pool must never exceed five allocations');
    trace.push({ name, active: active.size });
  };
  const completeWorker = name => {
    const record = records.find(record => record.name === name);
    assert.equal(record.status, 'in_progress');
    record.status = 'completed';
    record.conclusion = 'success';
    record.completed_at = startedAt;
    active.delete(name);
  };
  for (const { part } of macJobs.filter(job => job.part.shard?.startsWith('units') ||
    job.part.target === 'macos-arm64' && job.part.component === 'homebrew')) {
    allocate(`native-${part.role}`);
    completeWorker(`native-${part.role}`);
  }
  for (let index = 0; index < 3; index++) allocate(`native-macos-arm64-framework-body-${index}`);
  const advance = () => {
    let changed;
    do {
      changed = false;
      for (const [key, job] of Object.entries(ci.jobs).filter(([, job]) =>
        job.steps?.some(step => /scripts\/macos-runner-admission\.mjs/u.test(step.run ?? '')))) {
        if (gates.has(key) || !job.needs.every(done)) continue;
        const command = job.steps.find(step => /scripts\/macos-runner-admission\.mjs/u.test(step.run ?? '')).run;
        const group = /--group ([a-z-]+)/u.exec(command)?.[1] ?? 'arm-regressions';
        if (evaluateMacAdmission(observation(records), { ...expected, group }).admitted) {
          gates.add(key);
          changed = true;
        }
      }
      for (const job of macJobs) {
        const name = `native-${job.part.role}`;
        if (active.size < 5 && records.find(record => record.name === name).status === 'queued' &&
          job.needs.every(done)) {
          allocate(name);
          changed = true;
        }
      }
    } while (changed);
  };
  advance();
  assert.equal(trace.find(row => /^native-macos-x64-framework-body-/u.test(row.name))?.name,
    'native-macos-x64-framework-body-0',
    'The first declared Intel critical body receives allocation after both own unit origins');
  for (let index = 0; index < 3; index++) {
    completeWorker(`native-macos-arm64-framework-body-${index}`);
    advance();
  }
  while (active.size) {
    completeWorker(active.values().next().value);
    advance();
  }
  assert.ok(records.every(record => record.status === 'completed'), 'Every old native part must make progress');
  assert.equal(new Set(trace.map(row => row.name)).size, records.length);
  assert.equal(trace.length, records.length, 'No native part may be substituted or allocated twice');
  assert.ok(gates.has('intel-retained-admission') && gates.has('arm-refresh-admission') &&
    gates.has('intel-homebrew-admission') && gates.has('intel-admission'));
  const coordinator = ci.jobs['mac-admission'];
  assert.equal(coordinator.name, 'Mac regression admission');
  assert.equal(coordinator['runs-on'], 'ubuntu-24.04');
  assert.equal(coordinator['timeout-minutes'], 22);
  assert.equal(coordinator.strategy, undefined);
  assert.deepEqual(coordinator.permissions, { actions: 'read', contents: 'read' });
  assert.deepEqual(coordinator.needs, ['intent', 'source', 'native-units-ma']);
  assert.deepEqual(ci.jobs['native-mi'].needs,
    ['intent', 'source', 'native-units-mi', 'intel-retained-admission']);
  assert.deepEqual(ci.jobs['native-ma'].needs, ['intent', 'source', 'native-units-ma']);
  assert.deepEqual(ci.jobs['native-units-ma'].needs, ['intent', 'source']);
  assert.deepEqual(ci.jobs['native-units-mi'].needs, ['intent', 'source']);
  assert.deepEqual(ci.jobs['intel-admission'].needs, ['intent', 'source', 'native-units-mi']);
  assert.deepEqual(ci.jobs['native-mi-refresh'].needs,
    ['intent', 'source', 'native-units-mi', 'intel-admission']);
  assert.deepEqual(ci.jobs['native-homebrew'].needs, ['intent', 'source']);
  assert.deepEqual(ci.jobs['native-homebrew-mi'].needs, ['intent', 'source', 'intel-homebrew-admission']);
  assert.deepEqual(ci.jobs['native-mi'].strategy.matrix.include.map(part => part.shard),
    ['body-1', 'body-2']);
  assert.deepEqual(ci.jobs['native-ma'].strategy.matrix.include.map(part => part.shard),
    ['body-0', 'body-1', 'body-2']);
  assert.deepEqual(ci.jobs['native-mi-retained'].needs,
    ['intent', 'source', 'native-units-mi']);
  assert.deepEqual(ci.jobs['native-mi-retained'].strategy.matrix.include.map(part => part.shard), ['body-0']);
  assert.deepEqual(ci.jobs['native-ma-refresh'].needs,
    ['intent', 'source', 'native-units-ma', 'mac-admission']);
  assert.deepEqual(ci.jobs['native-ma-refresh'].strategy.matrix.include.map(part => part.shard), ['refresh']);
  assert.equal(ci.jobs['native-mi-refresh'].strategy.matrix.include.length, 1);
  assert.equal(ci.jobs['native-homebrew'].strategy.matrix.include[0].target, 'macos-arm64');
  assert.equal(ci.jobs['native-homebrew'].strategy.matrix.include.length, 1);
  assert.equal(ci.jobs['native-homebrew-mi'].strategy.matrix.include[0].target, 'macos-x64');
  const intelGate = ci.jobs['intel-admission'];
  assert.equal(intelGate.name, 'Intel body admission');
  assert.equal(intelGate['runs-on'], 'ubuntu-24.04');
  assert.equal(intelGate['timeout-minutes'], 22);
  assert.deepEqual(intelGate.permissions, { actions: 'read', contents: 'read' });
  assert.match(intelGate.steps.find(step => step.name === 'Admit Intel auxiliaries after ready bodies and ARM refresh').run,
    /--group intel-auxiliaries-ready-arm-frontier --output \.test-data\/intel-admission\.json/u);
  const homebrewGate = ci.jobs['intel-homebrew-admission'];
  assert.deepEqual(homebrewGate.needs, ['intent', 'source', 'native-units-mi']);
  assert.equal(homebrewGate.name, 'Intel Homebrew admission');
  assert.equal(homebrewGate['runs-on'], 'ubuntu-24.04');
  assert.equal(homebrewGate['timeout-minutes'], 22);
  assert.equal(homebrewGate.strategy, undefined);
  assert.deepEqual(homebrewGate.permissions, { actions: 'read', contents: 'read' });
  assert.match(homebrewGate.steps.find(step => step.name === 'Admit Intel auxiliaries after ready bodies and ARM refresh').run,
    /--group intel-auxiliaries-ready-arm-frontier --output \.test-data\/intel-homebrew-admission\.json/u);
  for (const [key, needs, group] of [
    ['intel-retained-admission', ['intent', 'source', 'native-units-mi'], 'intel-secondaries-ready-arm-frontier'],
    ['arm-refresh-admission', ['intent', 'source', 'native-units-ma', 'mac-admission'], 'arm-refresh'],
  ]) {
    const gate = ci.jobs[key];
    assert.deepEqual(gate.needs, needs);
    assert.equal(gate['runs-on'], 'ubuntu-24.04');
    assert.equal(gate['timeout-minutes'], 22);
    assert.equal(gate.strategy, undefined);
    assert.ok(!gate.name.startsWith('native-'));
    assert.deepEqual(gate.permissions, { actions: 'read', contents: 'read' });
    assert.ok(gate.steps[4].run.includes(`--group ${group} --output .test-data/${key}.json`));
  }
  const visiting = new Set();
  const complete = new Set();
  const visit = key => {
    assert.ok(ci.jobs[key], `Unknown prerequisite ${key}`);
    assert.ok(!visiting.has(key), `Dependency cycle at ${key}`);
    if (complete.has(key)) return;
    visiting.add(key);
    for (const dep of [ci.jobs[key].needs ?? []].flat()) visit(dep);
    visiting.delete(key);
    complete.add(key);
  };
  for (const key of Object.keys(ci.jobs)) visit(key);
  assert.ok(ci.jobs['producer-summary'].needs.includes('mac-admission'));
  assert.ok(ci.jobs['producer-summary'].needs.includes('intel-admission'));
  assert.ok(ci.jobs['producer-summary'].needs.includes('intel-homebrew-admission'));
  assert.ok(ci.jobs['producer-summary'].needs.includes('intel-retained-admission'));
  assert.ok(ci.jobs['producer-summary'].needs.includes('arm-refresh-admission'));
  const summary = ci.jobs['producer-summary'].steps[0];
  assert.equal(summary.env.MAC_ADMISSION_RESULT, '${{ needs.mac-admission.result }}');
  assert.match(summary.run, /"\$MAC_ADMISSION_RESULT"/u);
  const native = Object.entries(ci.jobs).filter(([, job]) => job.name === 'native-${{ matrix.role }}');
  const parts = native.flatMap(([, job]) => job.strategy.matrix.include)
    .map(({ target, component, shard, role }) => ({
      target, component, role, ...(shard === undefined ? {} : { shard }),
    }));
  assert.equal(parts.length, 25);
  assert.deepEqual(parts.sort((a, b) => a.role.localeCompare(b.role)),
    [...nativePrParts].sort((a, b) => a.role.localeCompare(b.role)));
  for (const [, job] of native) {
    assert.equal(job['timeout-minutes'], 360);
    assert.equal(job.strategy['fail-fast'], false);
  }
  assert.equal(ci.jobs['native-ma'].env.SDLC_TEST_WORKERS, '14');
  assert.equal(ci.jobs['native-ma-refresh'].env.SDLC_TEST_WORKERS,
    ci.jobs['native-ma'].env.SDLC_TEST_WORKERS);
  assert.equal(ci.jobs['native-units-ma'].env.SDLC_TEST_WORKERS, '7');
  assert.equal(ci.jobs['native-mi'].env.SDLC_TEST_WORKERS, '14');
  assert.equal(ci.jobs['native-units-mi'].env.SDLC_TEST_WORKERS, '4');
  assert.ok(parts.filter(part => part.target === 'macos-arm64').every(part =>
    native.some(([, job]) => job.strategy.matrix.include.some(row => row.role === part.role && row.os === 'macos-15'))));
  const checkout = coordinator.steps.find(step => step.name === 'Check out exact candidate');
  assert.equal(checkout.with.ref, '${{ needs.source.outputs.source-commit }}');
  assert.equal(checkout.with['persist-credentials'], false);
  assert.equal(coordinator.steps.find(step => step.name === 'Select pinned native Node').with['node-version'], '24.20.0');
  assert.match(coordinator.steps.find(step => step.name === 'Admit ARM refresh after ready critical turns').run,
    /--attempt "\$GITHUB_RUN_ATTEMPT".*--head-sha "\$ADMISSION_HEAD_SHA"/u);
  assert.match(coordinator.steps[4].run, /--group arm-refresh-ready/u);
  assert.equal(criticalProfileBudget.maximumRootChecks, 27);
  assert.equal(criticalProfileBudget.maximumAssertions, 27);
});

test('T-MACADM012 closed Intel group admits three allocated long bodies without waiting for completion or short roles', () => {
  const intel = jobs({ status: 'in_progress', runner_name: 'synthetic-worker' }).slice(0, 3)
    .map((job, index) => ({ ...job, name: `native-macos-x64-framework-body-${index}` }));
  const identity = { ...expected, group: 'intel-bodies' };
  const queued = intel.map(job => ({ ...job, status: 'queued', runner_name: '' }));
  assert.equal(evaluateMacAdmission(observation(queued), identity).admitted, false);
  assert.equal(evaluateMacAdmission(observation(intel.slice(0, 2)), identity).admitted, false);
  const shortRoles = ['native-macos-x64-framework-refresh', 'native-macos-x64-homebrew']
    .map((name, index) => ({ ...jobs()[0], id: 99 + index, name }));
  const result = evaluateMacAdmission(observation([...intel, ...shortRoles]), identity);
  assert.equal(result.admitted, true);
  assert.equal(result.group, 'intel-bodies');
  assert.equal(result.parts.length, 3);
  assert.equal(evaluateMacAdmission(observation(intel), expected).admitted, false);
  assert.equal(evaluateMacAdmission(observation(jobs({ status: 'in_progress', runner_name: 'worker' })),
    identity).admitted, false);
  assert.throws(() => evaluateMacAdmission(observation(intel), { ...expected, group: 'arbitrary-jobs' }),
    { code: 'ADMISSION_IDENTITY' });
  assert.throws(() => evaluateMacAdmission(observation(intel), { ...expected, group: ['intel-bodies'] }),
    { code: 'ADMISSION_IDENTITY' });
  assert.throws(() => evaluateMacAdmission(observation(intel), { ...expected, group: null }),
    { code: 'ADMISSION_IDENTITY' });
  assert.throws(() => evaluateMacAdmission(observation([...intel, { ...intel[0], id: 90 }]), identity),
    { code: 'ADMISSION_IDENTITY' });
  assert.throws(() => evaluateMacAdmission(observation([
    ...intel.slice(0, 2), { ...queued[2], status: 'completed', conclusion: 'cancelled' },
  ]), identity), { code: 'ADMISSION_TERMINATED' });
});

test('T-MACADM016 current Homebrew yields free Mac capacity until all three critical Intel bodies are allocated', async () => {
  const contents = await fs.readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const ci = parseWorkflow({ file: '.github/workflows/ci.yml', contents });
  const coordinator = ci.jobs['intel-homebrew-admission'];
  const command = coordinator.steps.find(step => /scripts\/macos-runner-admission\.mjs/u.test(step.run ?? '')).run;
  const group = /--group ([a-z-]+)/u.exec(command)[1];
  const intel = [0, 1, 2].map((index) => ({ ...jobs()[0], id: 50 + index,
    name: `native-macos-x64-framework-body-${index}` }));
  const arm = jobs({ status: 'in_progress', runner_name: 'synthetic-arm-worker' });
  const allocated = record => Object.assign(record, { status: 'in_progress', runner_name: 'synthetic-worker' });
  allocated(intel[0]);
  const records = [...criticalJobs().slice(0, 3), ...arm, ...intel];
  const done = new Set(['intent', 'source', 'native-units-mi', 'native-units-ma',
    'mac-admission', 'intel-retained-admission', 'arm-refresh-admission']);
  const eligible = key => ci.jobs[key].needs.every(dep => done.has(dep));
  assert.equal(eligible('native-mi'), true,
    'Waiting critical body-1/2 must be runnable independently of Homebrew allocation or completion');
  const admitted = () => evaluateMacAdmission(observation(records), { ...expected, group }).admitted;
  assert.equal(admitted(), false, 'Early body-0 plus queued timestamp placeholders must not release Homebrew');
  assert.equal(eligible('native-homebrew-mi'), false);
  const active = () => records.filter(record => record.status === 'in_progress').length;
  assert.equal(active(), 5, 'Three ARM bodies, ARM refresh and early Intel body use exactly five slots');
  for (const index of [1, 2]) {
    Object.assign(arm[index], { status: 'completed', conclusion: 'success' });
    assert.equal(active(), 4);
    assert.equal(eligible('native-mi'), true);
    assert.equal(eligible('native-homebrew-mi'), false, 'Homebrew cannot compete for the newly free slot');
    allocated(intel[index]);
    assert.equal(active(), 5);
    if (index === 1) assert.equal(admitted(), false);
  }
  assert.equal(admitted(), true, 'Allocation alone releases Homebrew while all Intel bodies are still running');
  assert.ok(intel.every(record => record.status === 'in_progress' && record.conclusion === null));
  done.add('intel-homebrew-admission');
  assert.equal(eligible('native-homebrew-mi'), true);
  for (const change of [{ head_sha: 'b'.repeat(40) }, { run_attempt: 1 },
    { run_url: 'https://api.github.com/repos/other/repository/actions/runs/52' }]) {
    assert.throws(() => evaluateMacAdmission(observation(records.map(record =>
      record.id === intel[2].id ? { ...record, ...change } : record)), { ...expected, group }),
    { code: 'ADMISSION_IDENTITY' });
  }
  assert.equal(evaluateMacAdmission(observation(records.map(record => record.id === intel[2].id ?
    { ...record, status: 'queued', runner_name: '', steps: [] } : record)), { ...expected, group }).admitted, false);
  assert.equal(Object.values(ci.jobs).filter(job =>
    job.steps?.some(step => /scripts\/macos-runner-admission\.mjs/u.test(step.run ?? ''))).length, 5);
});

test('T-MACADM013 Intel wait uses the same bounded attempt-scoped transport and cannot pass timeout cancellation or wrong identity', async () => {
  const selectedJobs = jobs({ status: 'in_progress', runner_name: 'synthetic-worker' }).slice(0, 3)
    .map((job, index) => ({ ...job, name: `native-macos-x64-framework-body-${index}` }));
  const identity = { ...expected, group: 'intel-bodies' };
  const ready = adapter({ selectedJobs });
  assert.equal((await waitForMacAdmission(identity, ready.options)).admitted, true);
  assert.deepEqual(ready.calls, [prefix, `${prefix}/jobs?per_page=100&page=1`]);
  const queued = adapter({ selectedJobs: selectedJobs.map(job => ({ ...job, runner_name: '', status: 'queued' })) });
  await assert.rejects(waitForMacAdmission(identity, queued.options), error =>
    error.code === 'ADMISSION_TIMEOUT' && error.observation.group === 'intel-bodies');
  const cancelled = adapter({ selectedJobs: [] });
  const controller = new AbortController();
  cancelled.options.signal = controller.signal;
  cancelled.options.sleep = async () => controller.abort();
  await assert.rejects(waitForMacAdmission(identity, cancelled.options), { code: 'ADMISSION_CANCELLED' });
  const foreign = adapter({ selectedJobs: selectedJobs.map(job => ({ ...job, run_attempt: 1 })) });
  await assert.rejects(waitForMacAdmission(identity, foreign.options), { code: 'ADMISSION_IDENTITY' });
});

test('T-MACADM014 Intel Homebrew admission requires its own worker allocation but never command completion', async () => {
  const identity = { ...expected, group: 'intel-homebrew' };
  const queued = { ...jobs()[0], name: 'native-macos-x64-homebrew' };
  assert.equal(evaluateMacAdmission(observation([queued]), identity).admitted, false,
    'Queued timestamps do not admit the Homebrew worker');
  const allocated = { ...queued, status: 'in_progress', runner_name: 'synthetic-homebrew-worker' };
  const result = evaluateMacAdmission(observation([allocated]), identity);
  assert.equal(result.admitted, true);
  assert.equal(result.group, 'intel-homebrew');
  assert.equal(result.parts.length, 1);
  assert.equal(result.parts[0].conclusion, null);
  assert.equal(evaluateMacAdmission(observation([{
    ...allocated, runner_name: '', steps: [{ status: 'in_progress', started_at: startedAt }],
  }]), identity).parts[0].proof, 'started-step');
  assert.equal(evaluateMacAdmission(observation([{
    ...allocated, name: 'native-macos-x64-framework-refresh',
  }]), identity).admitted, false);
  assert.equal(evaluateMacAdmission(observation([allocated]), expected).admitted, false);
  assert.equal(evaluateMacAdmission(observation([allocated]), {
    ...expected, group: 'intel-bodies',
  }).admitted, false);
  assert.throws(() => evaluateMacAdmission(observation([
    allocated, { ...allocated, id: 99 },
  ]), identity), { code: 'ADMISSION_IDENTITY' });
  assert.throws(() => evaluateMacAdmission(observation([{
    ...allocated, head_sha: 'b'.repeat(40),
  }]), identity), { code: 'ADMISSION_IDENTITY' });
  assert.throws(() => evaluateMacAdmission(observation([{
    ...queued, status: 'completed', conclusion: 'cancelled',
  }]), identity), { code: 'ADMISSION_TERMINATED' });
  const ready = adapter({ selectedJobs: [allocated] });
  assert.equal((await waitForMacAdmission(identity, ready.options)).admitted, true);
  assert.deepEqual(ready.calls, [prefix, `${prefix}/jobs?per_page=100&page=1`]);
  const pending = adapter({ selectedJobs: [queued] });
  await assert.rejects(waitForMacAdmission(identity, pending.options), error =>
    error.code === 'ADMISSION_TIMEOUT' && error.observation.group === 'intel-homebrew' &&
      error.observation.parts[0].allocated === false);
  const controller = new AbortController();
  const cancelled = adapter({ selectedJobs: [queued] });
  cancelled.options.signal = controller.signal;
  cancelled.options.sleep = async () => controller.abort();
  await assert.rejects(waitForMacAdmission(identity, cancelled.options), error =>
    error.code === 'ADMISSION_CANCELLED' && error.observation.group === 'intel-homebrew');
  const denied = adapter({ respond: () => json({}, 403) });
  await assert.rejects(waitForMacAdmission(identity, denied.options), { code: 'ADMISSION_HTTP' });
  assert.equal(denied.calls.length, 1);
});

test('T-MACADM015 retained-first groups admit only their exact allocated workers and never queued placeholders or completion', async () => {
  for (const [group, names] of [
    ['arm-bodies', [0, 1, 2].map(index => `native-macos-arm64-framework-body-${index}`)],
    ['intel-retained-body', ['native-macos-x64-framework-body-1']],
    ['intel-primary-body', ['native-macos-x64-framework-body-0']],
    ['arm-refresh', ['native-macos-arm64-framework-refresh']],
  ]) {
    const identity = { ...expected, group };
    const queued = names.map((name, index) => ({ ...jobs()[0], id: index + 1, name }));
    assert.equal(evaluateMacAdmission(observation(queued), identity).admitted, false);
    const allocated = queued.map(job => ({ ...job, status: 'in_progress', runner_name: 'synthetic-worker' }));
    const result = evaluateMacAdmission(observation(allocated), identity);
    assert.equal(result.admitted, true);
    assert.equal(result.group, group);
    assert.equal(result.parts.length, names.length);
    assert.ok(result.parts.every(part => part.conclusion === null));
    assert.equal(evaluateMacAdmission(observation(allocated), expected).admitted, false,
      'New groups cannot substitute for the historical four-part ARM group');
    assert.equal(evaluateMacAdmission(observation(allocated.slice(0, -1)), identity).admitted, false);
    assert.equal(evaluateMacAdmission(observation([{
      ...allocated[0], name: 'native-macos-x64-homebrew',
    }]), identity).admitted, false);
    assert.throws(() => evaluateMacAdmission(observation([...allocated, {
      ...allocated[0], id: 99,
    }]), identity), { code: 'ADMISSION_IDENTITY' });
    const ready = adapter({ selectedJobs: allocated });
    assert.equal((await waitForMacAdmission(identity, ready.options)).admitted, true);
    const pending = adapter({ selectedJobs: queued });
    await assert.rejects(waitForMacAdmission(identity, pending.options), error =>
      error.code === 'ADMISSION_TIMEOUT' && error.observation.group === group);
  }
  const retained = [{ ...jobs()[0], name: 'native-macos-x64-framework-body-1',
    status: 'in_progress', runner_name: 'synthetic-worker' }];
  const primary = [{ ...retained[0], name: 'native-macos-x64-framework-body-0' }];
  assert.equal(evaluateMacAdmission(observation(retained), { ...expected, group: 'intel-primary-body' }).admitted, false);
  assert.equal(evaluateMacAdmission(observation(primary), { ...expected, group: 'intel-retained-body' }).admitted, false);
});

test('T-MACADM010 cancellation and the overall deadline interrupt in-flight synthetic HTTP without admission', async () => {
  for (const mode of ['cancel', 'timeout']) {
    const controller = new AbortController();
    const pending = adapter({ respond: (url, request) => new Promise((resolve, reject) => {
      request.signal.addEventListener('abort', () => reject(new DOMException('Synthetic abort', 'AbortError')),
        { once: true });
      if (mode === 'cancel') queueMicrotask(() => controller.abort());
    }) });
    pending.options.signal = controller.signal;
    pending.options.timeoutMs = mode === 'timeout' ? 10 : 1000;
    await assert.rejects(waitForMacAdmission(expected, pending.options), {
      code: mode === 'cancel' ? 'ADMISSION_CANCELLED' : 'ADMISSION_TIMEOUT',
      observation: null,
    });
    assert.equal(pending.calls.length, 1);
  }
});

test('T-MACADM011 CLI binds synthetic event context and owned receipt without credential fallback or token leakage', async t => {
  const root = path.resolve('.test-data', `mac-admission-cli-${randomUUID()}`);
  await fs.mkdir(root);
  t.after(async () => {
    await fs.rm(root, { recursive: true });
    await assert.rejects(fs.stat(root), { code: 'ENOENT' });
  });
  const eventFile = path.join(root, 'synthetic-event.json');
  await fs.writeFile(eventFile, JSON.stringify({ repository: { full_name: expected.repository },
    pull_request: { head: { sha: expected.headSha }, base: { repo: { full_name: expected.repository } } } }));
  const output = path.join(root, 'receipt.json');
  const args = ['scripts/macos-runner-admission.mjs', '--repository', expected.repository,
    '--run-id', '52', '--attempt', '2', '--head-sha', expected.headSha, '--output', output];
  const env = { SystemRoot: process.env.SystemRoot ?? '', GITHUB_REPOSITORY: expected.repository,
    GITHUB_RUN_ID: '52', GITHUB_RUN_ATTEMPT: '2', GITHUB_API_URL: 'https://api.github.com',
    GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: eventFile, GITHUB_TOKEN: '', GH_TOKEN: '' };
  const execute = promisify(execFile);
  await assert.rejects(execute(process.execPath, args, { env }), error =>
    error.code === 1 && /Mac regression admission: Failed/u.test(error.stdout));
  const receipt = JSON.parse(await fs.readFile(output, 'utf8'));
  assert.equal(receipt.status, 'Failed');
  assert.equal(receipt.nativeCorrectness, 'NotEvaluated');
  assert.equal(receipt.observation, null);
  assert.equal(receipt.code, 'ADMISSION_IDENTITY');
  await fs.unlink(output);
  for (const group of ['intel-bodies', 'intel-homebrew', 'arm-bodies', 'intel-retained-body', 'intel-primary-body', 'arm-refresh']) {
    await assert.rejects(execute(process.execPath, [...args, '--group', group], { env }), { code: 1 });
    assert.equal(JSON.parse(await fs.readFile(output, 'utf8')).identity.group, group);
    await fs.unlink(output);
  }
  await assert.rejects(execute(process.execPath, [...args, '--group', 'arbitrary-jobs'], { env }), { code: 1 });
  await assert.rejects(fs.stat(output), { code: 'ENOENT' });
  for (const invalid of [
    { ...env, GITHUB_RUN_ATTEMPT: '1', GITHUB_TOKEN: 'synthetic-never-log' },
    { ...env, GITHUB_REPOSITORY: 'other/repository', GITHUB_TOKEN: 'synthetic-never-log' },
  ]) {
    await assert.rejects(execute(process.execPath, args, { env: invalid }), error =>
      error.code === 1 && !`${error.stdout}${error.stderr}`.includes('synthetic-never-log'));
    await assert.rejects(fs.stat(output), { code: 'ENOENT' });
  }
  const outside = path.resolve('mac-admission-forbidden-receipt.json');
  await assert.rejects(execute(process.execPath, [...args.slice(0, -1), outside], { env }), { code: 1 });
  await assert.rejects(fs.stat(outside), { code: 'ENOENT' });
});
