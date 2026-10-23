import * as fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const admissionGroups = Object.freeze({
  'arm-regressions': ['refresh', 'body-0', 'body-1', 'body-2']
    .map(shard => `native-macos-arm64-framework-${shard}`),
  'intel-bodies': ['body-0', 'body-1', 'body-2']
    .map(shard => `native-macos-x64-framework-${shard}`),
});
const api = 'https://api.github.com';
const maximumWaitMs = 8 * 60 * 1000;
const maximumPages = 20;
const maximumBodyBytes = 2 * 1024 * 1024;
const positive = value => Number.isSafeInteger(value) && value > 0;
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}
function requireFact(condition, message) {
  if (!condition) fail('ADMISSION_IDENTITY', message);
}
function validateExpected(expected) {
  const group = expected.group === undefined ? 'arm-regressions' : expected.group;
  requireFact(/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/u.test(expected.repository ?? '') &&
    positive(expected.runId) && positive(expected.attempt) &&
    /^[a-f0-9]{40}$/u.test(expected.headSha ?? '') &&
    ['pull_request', 'push', 'workflow_dispatch'].includes(expected.event) &&
    typeof group === 'string' && Object.hasOwn(admissionGroups, group),
  'Admission requires an exact repository, run, attempt, source and supported event');
}

function validateRun(run, expected) {
  requireFact(run?.id === expected.runId && run.run_attempt === expected.attempt &&
    run.repository?.full_name === expected.repository && run.head_sha === expected.headSha &&
    run.event === expected.event &&
    ['queued', 'waiting', 'pending', 'requested', 'in_progress', 'completed'].includes(run.status),
  'Provider run identity differs from the current caller');
}

// This is only a resource-allocation fact, never a native correctness verdict.
export function evaluateMacAdmission({ run, jobs, complete }, expected) {
  validateExpected(expected);
  validateRun(run, expected);
  const group = expected.group ?? 'arm-regressions';
  const requiredNames = admissionGroups[group];
  requireFact(complete === true && Array.isArray(jobs), 'A complete attempt-scoped job list is required');
  const ids = new Set();
  const names = new Set();
  for (const job of jobs) {
    requireFact(positive(job?.id) && !ids.has(job.id) && typeof job.name === 'string' &&
      job.run_id === expected.runId && job.run_attempt === expected.attempt &&
      job.head_sha === expected.headSha &&
      job.run_url === `${api}/repos/${expected.repository}/actions/runs/${expected.runId}`,
    'Job identity is missing, duplicated or outside the selected run attempt');
    ids.add(job.id);
    if (requiredNames.includes(job.name)) {
      requireFact(!names.has(job.name), 'A required Mac part has duplicate provider jobs');
      names.add(job.name);
    }
  }
  const parts = requiredNames.map(name => {
    const job = jobs.find(item => item.name === name);
    if (!job) return { name, allocated: false, proof: 'missing' };
    requireFact(['queued', 'waiting', 'pending', 'requested', 'in_progress', 'completed'].includes(job.status),
      'A required Mac part has an unreadable provider status');
    const startedStep = Array.isArray(job.steps) && job.steps.some(step =>
      ['in_progress', 'completed'].includes(step.status) && step.conclusion !== 'skipped' &&
      timestamp(step.started_at));
    const runner = typeof job.runner_name === 'string' && job.runner_name.trim().length > 0;
    // GitHub supplies started_at for some queued placeholders; it is not worker proof.
    const allocated = runner || startedStep;
    return { id: job.id, name, status: job.status, conclusion: job.conclusion ?? null,
      allocated, proof: allocated ? runner ? 'runner' : 'started-step' : 'unallocated' };
  });
  const observation = { repository: expected.repository, runId: expected.runId,
    attempt: expected.attempt, headSha: expected.headSha, event: expected.event, group, parts,
    admitted: parts.every(part => part.allocated) };
  if (parts.some(part => !part.allocated && part.status === 'completed') ||
      !observation.admitted && (run.status === 'completed' || run.conclusion != null)) {
    throw Object.assign(new Error('Mac admission ended with missing worker allocation'),
      { code: 'ADMISSION_TERMINATED', observation });
  }
  return observation;
}

function nextPage(headers, base, page, pages) {
  const link = headers.get('link');
  if (!link) {
    requireFact(page === pages, 'Provider pagination omitted the next page');
    return;
  }
  const entries = link.split(',').map(value => /^<([^>]+)>;\s*rel="([^"]+)"$/u.exec(value.trim()));
  requireFact(entries.every(Boolean), 'Provider pagination is unreadable');
  requireFact(new Set(entries.map(entry => entry[2])).size === entries.length,
    'Provider pagination repeated a relation');
  const next = entries.filter(entry => entry[2] === 'next');
  requireFact(next.length === (page < pages ? 1 : 0), 'Provider pagination is incomplete or inconsistent');
  for (const [, url, relation] of entries) {
    const parsed = new URL(url);
    requireFact(parsed.origin === api && parsed.pathname === base &&
      parsed.searchParams.get('per_page') === '100' &&
      /^[1-9]\d*$/u.test(parsed.searchParams.get('page') ?? '') &&
      [...parsed.searchParams.keys()].length === 2 && !parsed.hash && !parsed.username && !parsed.password,
    'Provider pagination escaped the selected attempt');
    const target = Number(parsed.searchParams.get('page'));
    requireFact(target <= pages &&
      ({ first: target === 1, last: target === pages, prev: target === page - 1,
        next: target === page + 1 })[relation] === true,
    'Provider pagination relations disagree with its complete count');
    if (relation === 'next') requireFact(Number(parsed.searchParams.get('page')) === page + 1,
      'Provider pagination skipped or repeated a page');
  }
}

export async function waitForMacAdmission(expected, {
  token, fetch = globalThis.fetch, signal, now = () => performance.now(),
  sleep = (ms, options) => delay(ms, undefined, options),
  timeoutMs = maximumWaitMs, pollMs = 3000,
} = {}) {
  validateExpected(expected);
  requireFact(typeof token === 'string' && token.length > 0 && !/[\r\n]/u.test(token),
    'A caller-supplied read-only Actions token is required');
  requireFact(positive(timeoutMs) && timeoutMs <= maximumWaitMs &&
    positive(pollMs) && pollMs <= 5000, 'Admission wait must remain bounded');
  const deadline = now() + timeoutMs;
  const bounded = new AbortController();
  const cancel = () => bounded.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const timer = setTimeout(cancel, timeoutMs);
  let lastObservation = null;
  const check = () => {
    if (signal?.aborted) fail('ADMISSION_CANCELLED', 'Mac admission was cancelled');
    if (bounded.signal.aborted || now() >= deadline) fail('ADMISSION_TIMEOUT', 'Mac admission exceeded its bounded wait');
  };
  const get = async relative => {
    for (let attempt = 0; attempt < 3; attempt++) {
      check();
      const requestSignal = AbortSignal.any([bounded.signal, AbortSignal.timeout(15000)]);
      try {
        const response = await fetch(`${api}${relative}`, {
          method: 'GET', redirect: 'error', signal: requestSignal,
          headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28' },
        });
        check();
        if (!response.ok) {
          await response.body?.cancel();
          const error = Object.assign(new Error(`GitHub job metadata HTTP ${response.status}`),
            { code: 'ADMISSION_HTTP', transient: [408, 500, 502, 503, 504].includes(response.status) });
          throw error;
        }
        requireFact(response.status === 200 && response.body, 'Provider metadata response is unreadable');
        const reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            requireFact(size <= maximumBodyBytes, 'Provider metadata exceeded the response bound');
            chunks.push(value);
          }
        } finally { await reader.cancel(); }
        check();
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { fail('ADMISSION_PROVIDER', 'Provider metadata is not valid JSON'); }
        return { body, headers: response.headers };
      } catch (error) {
        check();
        const transient = error.transient === true || requestSignal.aborted ||
          ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT'].includes(error.cause?.code);
        if (!transient || attempt === 2) {
          fail(error.code?.startsWith('ADMISSION_') ? error.code : 'ADMISSION_PROVIDER',
            error.code?.startsWith('ADMISSION_') ? error.message : 'GitHub job metadata could not be read');
        }
        await sleep(Math.min(1000 * (attempt + 1), deadline - now()), { signal: bounded.signal });
      }
    }
  };
  const prefix = `/repos/${expected.repository}/actions/runs/${expected.runId}/attempts/${expected.attempt}`;
  try {
    // Finite observations also bound an injected/nonadvancing clock.
    for (let poll = 0; poll <= Math.ceil(timeoutMs / pollMs); poll++) {
      check();
      const { body: run } = await get(prefix);
      validateRun(run, expected);
      const jobs = [];
      let total;
      let pages = 1;
      for (let page = 1; page <= pages; page++) {
        const response = await get(`${prefix}/jobs?per_page=100&page=${page}`);
        const data = response.body;
        requireFact(Number.isSafeInteger(data?.total_count) && data.total_count >= 0 &&
          data.total_count <= maximumPages * 100 && Array.isArray(data.jobs),
        'Provider job pagination has no bounded complete count');
        if (page === 1) {
          total = data.total_count;
          pages = Math.max(1, Math.ceil(total / 100));
        }
        requireFact(data.total_count === total &&
          data.jobs.length === Math.min(100, total - jobs.length),
        'Provider job pagination changed or omitted records');
        nextPage(response.headers, `${prefix}/jobs`, page, pages);
        jobs.push(...data.jobs);
      }
      lastObservation = evaluateMacAdmission({ run, jobs, complete: jobs.length === total }, expected);
      check();
      if (lastObservation.admitted) return lastObservation;
      await sleep(Math.min(pollMs, deadline - now()), { signal: bounded.signal });
    }
    fail('ADMISSION_TIMEOUT', 'Mac admission exceeded its bounded observation count');
  } catch (error) {
    if (error.observation) lastObservation = error.observation;
    const code = signal?.aborted ? 'ADMISSION_CANCELLED' :
      bounded.signal.aborted || now() >= deadline ? 'ADMISSION_TIMEOUT' : error.code ?? 'ADMISSION_PROVIDER';
    throw Object.assign(new Error(code === 'ADMISSION_CANCELLED' ? 'Mac admission was cancelled' :
      code === 'ADMISSION_TIMEOUT' ? 'Mac admission exceeded its bounded wait' : error.message),
    { code, observation: lastObservation });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

async function main() {
  const options = {};
  const flags = ['repository', 'run-id', 'attempt', 'head-sha', 'output'];
  for (let index = 2; index < process.argv.length; index += 2) {
    const flag = process.argv[index]?.slice(2);
    requireFact(process.argv[index]?.startsWith('--') && [...flags, 'group'].includes(flag) &&
      options[flag] === undefined && process.argv[index + 1], 'Admission CLI options are invalid');
    options[flag] = process.argv[index + 1];
  }
  requireFact(flags.every(flag => options[flag]), 'Admission CLI requires all exact identity and output options');
  const env = process.env;
  const expected = { repository: options.repository, runId: Number(options['run-id']),
    attempt: Number(options.attempt), headSha: options['head-sha'], event: env.GITHUB_EVENT_NAME,
    group: options.group ?? 'arm-regressions' };
  validateExpected(expected);
  requireFact(/^[1-9]\d*$/u.test(options['run-id']) && /^[1-9]\d*$/u.test(options.attempt) &&
    env.GITHUB_REPOSITORY === expected.repository && env.GITHUB_RUN_ID === options['run-id'] &&
    env.GITHUB_RUN_ATTEMPT === options.attempt && env.GITHUB_API_URL === api,
  'Admission CLI identity differs from the current GitHub caller');
  const event = JSON.parse(await fs.readFile(env.GITHUB_EVENT_PATH, 'utf8'));
  requireFact(event.repository?.full_name === expected.repository &&
    (expected.event === 'pull_request' ? event.pull_request?.head?.sha === expected.headSha &&
      event.pull_request?.base?.repo?.full_name === expected.repository :
      env.GITHUB_SHA === expected.headSha &&
      (expected.event !== 'push' || event.after === expected.headSha)),
  'Admission event source differs from the caller');
  const root = await fs.realpath('.test-data');
  const output = path.resolve(options.output);
  const parent = await fs.realpath(path.dirname(output));
  requireFact(root === path.resolve('.test-data') && parent === path.dirname(output) &&
    (parent === root || parent.startsWith(`${root}${path.sep}`)) &&
    path.relative(root, parent).split(path.sep).every(part => part !== '..'),
  'Admission receipt must use an owned existing .test-data directory');
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  let receipt;
  try {
    const observation = await waitForMacAdmission(expected, {
      token: env.GITHUB_TOKEN || env.GH_TOKEN, signal: controller.signal,
    });
    receipt = { status: 'Admitted', observedAt: new Date().toISOString(), observation,
      nativeCorrectness: 'NotEvaluated' };
  } catch (error) {
    receipt = { status: 'Failed', observedAt: new Date().toISOString(), identity: expected,
      code: error.code ?? 'ADMISSION_PROVIDER', observation: error.observation ?? null,
      nativeCorrectness: 'NotEvaluated' };
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
  await fs.writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  console.log(`Mac regression admission: ${receipt.status} (resource allocation only)`);
  if (env.GITHUB_STEP_SUMMARY) await fs.appendFile(env.GITHUB_STEP_SUMMARY,
    `Mac regression admission: **${receipt.status}**. This is not native correctness evidence.\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => {
    console.error('Mac regression admission failed: invalid caller, receipt path or provider metadata');
    process.exitCode = 1;
  });
}
