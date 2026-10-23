export const validationDeclarations = {
  "schemaVersion": 1,
  "surfaces": [{"coverage": "direct", "paths": ["scripts/macos-runner-admission.mjs"]}]
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

test('T-MACADM009 Linux admission preserves all twenty-five native identities barriers pins limits and critical budget', async () => {
  const contents = await fs.readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const ci = parseWorkflow({ file: '.github/workflows/ci.yml', contents });
  const coordinator = ci.jobs['mac-admission'];
  assert.equal(coordinator.name, 'Mac regression admission');
  assert.equal(coordinator['runs-on'], 'ubuntu-24.04');
  assert.equal(coordinator['timeout-minutes'], 10);
  assert.equal(coordinator.strategy, undefined);
  assert.deepEqual(coordinator.permissions, { actions: 'read', contents: 'read' });
  assert.deepEqual(coordinator.needs, ['intent', 'source', 'native-units-ma']);
  assert.deepEqual(ci.jobs['native-mi'].needs, ['intent', 'source', 'native-units-mi', 'mac-admission']);
  assert.deepEqual(ci.jobs['native-ma'].needs, ['intent', 'source', 'native-units-ma']);
  assert.deepEqual(ci.jobs['native-units-ma'].needs, ['intent', 'source']);
  assert.deepEqual(ci.jobs['native-units-mi'].needs, ['intent', 'source']);
  assert.ok(ci.jobs['producer-summary'].needs.includes('mac-admission'));
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
  assert.equal(ci.jobs['native-ma'].env.SDLC_TEST_WORKERS, '7');
  assert.equal(ci.jobs['native-mi'].env.SDLC_TEST_WORKERS, '14');
  assert.equal(ci.jobs['native-units-mi'].env.SDLC_TEST_WORKERS, '4');
  assert.ok(parts.filter(part => part.target === 'macos-arm64').every(part =>
    native.some(([, job]) => job.strategy.matrix.include.some(row => row.role === part.role && row.os === 'macos-15'))));
  const checkout = coordinator.steps.find(step => step.name === 'Check out exact candidate');
  assert.equal(checkout.with.ref, '${{ needs.source.outputs.source-commit }}');
  assert.equal(checkout.with['persist-credentials'], false);
  assert.equal(coordinator.steps.find(step => step.name === 'Select pinned native Node').with['node-version'], '24.20.0');
  assert.match(coordinator.steps.find(step => step.name === 'Wait for actual ARM worker allocation').run,
    /--attempt "\$GITHUB_RUN_ATTEMPT".*--head-sha "\$ADMISSION_HEAD_SHA"/u);
  assert.equal(criticalProfileBudget.maximumRootChecks, 27);
  assert.equal(criticalProfileBudget.maximumAssertions, 27);
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
    pending.options.now = () => performance.now();
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
