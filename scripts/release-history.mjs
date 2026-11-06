import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { canonical, digest, requireThat, safeRecord, safeSummary } from '../src/core.mjs';

const targets = Object.freeze(['linux-x64', 'windows-x64', 'macos-arm64', 'macos-x64']);
const numeric = /^[1-9]\d*$/u;
const sha = /^[a-f0-9]{64}$/u;
const statuses = ['Passed', 'Failed', 'NotRun'];
const maxArchiveBytes = 64 * 1024 * 1024;

function bounded(value) {
  return safeRecord(value, 4 * 1024 * 1024);
}

export function releaseHistoryBinding(value) {
  requireThat(value && /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/u.test(value.releaseIntentId ?? '') &&
    /^[a-f0-9]{40}$/u.test(value.sourceCommit ?? '') &&
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value.releaseRepository ?? '') &&
    typeof value.version === 'string' && value.version.length <= 128 &&
    (!value.descriptorSha256 || sha.test(value.descriptorSha256)) &&
    (!value.checksumsSha256 || sha.test(value.checksumsSha256)),
  'RELEASE_HISTORY', 'Select the exact immutable release intent/source/version/destination');
  return bounded({ releaseIntentId: value.releaseIntentId, sourceCommit: value.sourceCommit,
    version: value.version, releaseRepository: value.releaseRepository,
    ...(value.descriptorSha256 ? { descriptorSha256: value.descriptorSha256 } : {}),
    ...(value.checksumsSha256 ? { checksumsSha256: value.checksumsSha256 } : {}) });
}

export function readReleaseArtifactJson(bytes, filename) {
  requireThat(Buffer.isBuffer(bytes) && bytes.length >= 22 && bytes.length <= maxArchiveBytes,
    'RELEASE_HISTORY', 'Release history requires a bounded provider artifact ZIP');
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
    if (bytes.readUInt32LE(at) === 0x06054b50 && at + 22 + bytes.readUInt16LE(at + 20) === bytes.length) {
      end = at;
      break;
    }
  }
  requireThat(end >= 0 && bytes.readUInt32LE(end + 4) === 0 &&
    bytes.readUInt16LE(end + 8) === bytes.readUInt16LE(end + 10),
  'RELEASE_HISTORY', 'Incomplete or multi-disk history artifact');
  const count = bytes.readUInt16LE(end + 10);
  const start = bytes.readUInt32LE(end + 16);
  const size = bytes.readUInt32LE(end + 12);
  requireThat(count > 0 && count <= 2000 && start + size === end,
    'RELEASE_HISTORY', 'Unsupported history artifact directory');
  let cursor = start;
  let selected;
  const names = new Set();
  for (let index = 0; index < count; index++) {
    requireThat(cursor + 46 <= end && bytes.readUInt32LE(cursor) === 0x02014b50,
      'RELEASE_HISTORY', 'Truncated history artifact directory');
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const compressed = bytes.readUInt32LE(cursor + 20);
    const expanded = bytes.readUInt32LE(cursor + 24);
    const length = bytes.readUInt16LE(cursor + 28);
    const extra = bytes.readUInt16LE(cursor + 30);
    const comment = bytes.readUInt16LE(cursor + 32);
    const local = bytes.readUInt32LE(cursor + 42);
    requireThat(cursor + 46 + length + extra + comment <= end && !(flags & 1) &&
      [0, 8].includes(method) && local + 30 <= start && bytes.readUInt32LE(local) === 0x04034b50,
    'RELEASE_HISTORY', 'Unsafe history artifact member');
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + length);
    const name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes);
    requireThat(!names.has(name.toLowerCase()) && !name.includes('\\') &&
      !name.startsWith('/') && !name.split('/').some(part => part === '..' || part === '.'),
    'RELEASE_HISTORY', 'Duplicate or escaping history artifact member');
    names.add(name.toLowerCase());
    if (name === filename) {
      const type = (bytes.readUInt32LE(cursor + 38) >>> 16) & 0o170000;
      requireThat(selected === undefined && expanded <= 4 * 1024 * 1024 &&
        [0, 0o100000].includes(type) &&
        bytes.readUInt16LE(local + 8) === method &&
        nameBytes.equals(bytes.subarray(local + 30, local + 30 + bytes.readUInt16LE(local + 26))),
      'RELEASE_HISTORY', 'Invalid selected history member');
      const from = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      requireThat(from + compressed <= start, 'RELEASE_HISTORY', 'Truncated selected history member');
      const stored = bytes.subarray(from, from + compressed);
      const content = method === 0 ? stored : inflateRawSync(stored, { maxOutputLength: expanded + 1 });
      requireThat(content.length === expanded, 'RELEASE_HISTORY', 'History member length differs');
      selected = bounded(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content)));
    }
    cursor += 46 + length + extra + comment;
  }
  requireThat(cursor === end && selected !== undefined, 'RELEASE_HISTORY', 'Required history input is absent');
  return selected;
}

async function providerValue(api, route, options) {
  const response = await api(route, options);
  requireThat(response.status !== 404 && response.value !== undefined, 'RELEASE_HISTORY',
    'Independent release-attempt facts are unavailable');
  return response.value;
}

async function paginate(api, route, field, maximum = 5000) {
  const rows = [];
  for (let page = 1; ; page++) {
    const value = await providerValue(api, `${route}${route.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    requireThat(Array.isArray(value[field]) && Number.isSafeInteger(value.total_count) &&
      value.total_count >= 0 && rows.length + value[field].length <= maximum,
    'RELEASE_HISTORY', 'Incomplete or oversized independent attempt pagination');
    rows.push(...value[field]);
    if (rows.length >= value.total_count) return rows;
    requireThat(value[field].length > 0, 'RELEASE_HISTORY', 'Release history pagination stopped early');
  }
}

async function artifactJson(api, prefix, artifact, filename, retainOriginal) {
  requireThat(artifact && numeric.test(String(artifact.id)) && !artifact.expired &&
    /^sha256:[a-f0-9]{64}$/u.test(artifact.digest ?? ''), 'RELEASE_HISTORY',
  'Required original release history artifact is missing or expired');
  const bytes = await providerValue(api, `${prefix}/actions/artifacts/${artifact.id}/zip`, { binary: true });
  requireThat(Buffer.isBuffer(bytes) &&
    createHash('sha256').update(bytes).digest('hex') === artifact.digest.slice(7),
  'RELEASE_HISTORY', 'Release history artifact differs from its independently acquired digest');
  const value = readReleaseArtifactJson(bytes, filename);
  if (retainOriginal) await retainOriginal({ artifact: { id: String(artifact.id), digest: artifact.digest, name: artifact.name },
    member: filename, value });
  return value;
}

function requestMatches(request, binding) {
  return request.releaseIntentId === binding.releaseIntentId &&
    request.sourceCommit === binding.sourceCommit && request.version === binding.version &&
    (request.repository ?? request.releaseRepository) === binding.releaseRepository;
}

function nativeStatus(job) {
  if (!job) return 'NotRun';
  if (job.conclusion === 'failure') return 'Failed';
  if (job.conclusion !== 'success') return 'NotRun';
  return job.steps?.some(step =>
    step.name === 'Fresh complete native R-PRE inventory against the frozen unpublished bytes' &&
    step.conclusion === 'success') ? 'Passed' : 'NotRun';
}

export async function collectReleaseAttemptHistory({ api, sourceRepository, binding,
  notBefore, now = new Date().toISOString(), currentRunId }) {
  binding = releaseHistoryBinding(binding);
  requireThat(typeof api === 'function' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(sourceRepository ?? '') &&
    Number.isFinite(Date.parse(notBefore)) && Number.isFinite(Date.parse(now)),
  'RELEASE_HISTORY', 'Release history needs a trusted provider reader and an explicit observation interval');
  const prefix = `/repos/${sourceRepository}`;
  const runs = await paginate(api, `${prefix}/actions/workflows/release.yml/runs?event=workflow_dispatch&head_sha=${binding.sourceCommit}`,
    'workflow_runs');
  const artifacts = await paginate(api, `${prefix}/actions/artifacts`, 'artifacts');
  const attempts = [];
  for (const run of runs.filter(row => row.head_sha === binding.sourceCommit &&
    Date.parse(row.created_at) >= Date.parse(notBefore) && String(row.id) !== currentRunId)) {
    requireThat(run.path === '.github/workflows/release.yml' && run.event === 'workflow_dispatch' &&
      numeric.test(String(run.id)) && Number.isSafeInteger(run.run_number) && run.run_number > 0 &&
      Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0 && run.run_attempt <= 64,
    'RELEASE_HISTORY', 'Unexpected release workflow/run origin');
    let request;
    let requestOrigin;
    for (let attempt = 1; attempt <= run.run_attempt; attempt++) {
      const physical = await providerValue(api, `${prefix}/actions/runs/${run.id}/attempts/${attempt}`);
      requireThat(physical.head_sha === binding.sourceCommit && physical.path === run.path &&
        physical.event === run.event && Number(physical.run_attempt) === attempt,
      'RELEASE_HISTORY', 'Physical release attempt changed source or workflow');
      const jobs = await paginate(api, `${prefix}/actions/runs/${run.id}/attempts/${attempt}/jobs`, 'jobs');
      const preflights = artifacts.filter(artifact => artifact.name === `release-preflight-${run.id}-${attempt}` &&
        String(artifact.workflow_run?.id) === String(run.id) && artifact.workflow_run?.head_sha === binding.sourceCommit);
      requireThat(preflights.length <= 1, 'RELEASE_HISTORY', 'Duplicate original release preflight');
      if (preflights.length) {
        request = await artifactJson(api, prefix, preflights[0], 'release-preflight.json');
        requestOrigin = { artifactId: String(preflights[0].id), sourceSequence: attempt };
      }
      const nativeJobs = jobs.filter(job => targets.some(target => job.name === `native-${target}`));
      requireThat(new Set(nativeJobs.map(job => job.name)).size === nativeJobs.length,
        'RELEASE_HISTORY', 'Duplicate native producer jobs in one physical attempt');
      if (!request) {
        requireThat(!nativeJobs.some(job => job.started_at), 'RELEASE_HISTORY',
          'A newer native replacement lacks its original intent binding; older credit cannot be assumed current');
        continue;
      }
      if (request.releaseIntentId !== binding.releaseIntentId) continue;
      requireThat(requestMatches(request, binding), 'RELEASE_HISTORY',
        'A physical attempt reuses this intent for conflicting immutable inputs');
      const preflight = jobs.find(job => job.name === 'preflight');
      if (preflight && preflight.conclusion !== 'success' && !nativeJobs.some(job => job.started_at)) continue;
      const notScheduled = request.validationMode === 'reuse-r-pre' ?
        nativeJobs.filter(job => !job.started_at && job.conclusion === 'skipped') : [];
      const observations = nativeJobs.filter(job => !notScheduled.includes(job)).map(job => {
        const target = targets.find(value => job.name === `native-${value}`);
        return { target, status: nativeStatus(job), rawConclusion: job.conclusion ?? job.status ?? null,
          jobId: String(job.id), startedAt: job.started_at ?? null, finishedAt: job.completed_at ?? null };
      });
      if (request.validationMode?.startsWith('fresh-') && nativeJobs.length &&
          nativeJobs.length < targets.length && attempt === 1) {
        for (const target of targets.filter(target => !observations.some(row => row.target === target))) {
          observations.push({ target, status: 'NotRun', rawConclusion: 'missing', jobId: null,
            startedAt: physical.created_at ?? run.created_at, finishedAt: null });
        }
      }
      attempts.push({ runId: String(run.id), attempt: String(attempt), runNumber: run.run_number,
        workflowId: String(run.workflow_id), createdAt: run.created_at, status: physical.status,
        conclusion: physical.conclusion ?? null, binding, observations,
        notScheduledNative: notScheduled.map(job => ({ target: targets.find(value => job.name === `native-${value}`),
          jobId: String(job.id), rawConclusion: job.conclusion })),
        invocationRef: `https://github.com/${sourceRepository}/actions/runs/${run.id}/attempts/${attempt}`,
        requestOrigin: { ...requestOrigin } });
    }
  }
  attempts.sort((left, right) => left.runNumber - right.runNumber || Number(left.attempt) - Number(right.attempt));
  requireThat(new Set(attempts.map(row => `${row.runId}/${row.attempt}`)).size === attempts.length,
    'RELEASE_HISTORY', 'Duplicate physical release history');
  return bounded({ schemaVersion: 1, kind: 'release-attempt-history', binding, complete: true,
    observedAt: now, attempts });
}

export function requireCurrentReleaseGates(history, gates) {
  requireThat(history?.schemaVersion === 1 && history.kind === 'release-attempt-history' &&
    history.complete === true && Array.isArray(history.attempts) && Array.isArray(gates),
  'RELEASE_HISTORY', 'Complete independently acquired release attempt history is required');
  releaseHistoryBinding(history.binding);
  for (const gate of gates) {
    requireThat(gate.releaseIntentId === history.binding.releaseIntentId &&
      gate.identity?.sourceCommit === history.binding.sourceCommit &&
      gate.identity?.version === history.binding.version,
    'RELEASE_HISTORY', 'Selected native proof belongs to a different release intent');
    const original = history.attempts.find(row => row.runId === gate.run.id && row.attempt === gate.run.attempt);
    requireThat(original, 'RELEASE_HISTORY', 'Selected original native attempt is unavailable');
    const latest = history.attempts.filter(row => row.observations.some(observation => observation.target === gate.target)).at(-1);
    const observation = latest?.observations.find(row => row.target === gate.target);
    requireThat(latest && latest.runId === gate.run.id && latest.attempt === gate.run.attempt &&
      observation?.status === 'Passed' && statuses.includes(observation.status),
    'RELEASE_HISTORY', `A newer failed, cancelled, incomplete or replacement ${gate.target} attempt supersedes selected older credit`);
  }
  return history;
}

export async function collectPublicationAttempts({ api, sourceRepository, handoff, retainOriginal }) {
  const binding = immutablePublicationBinding(handoff);
  requireThat(typeof api === 'function', 'RELEASE_HISTORY', 'Publication recovery needs an independent provider reader');
  requireThat(retainOriginal === undefined || typeof retainOriginal === 'function',
    'RELEASE_HISTORY', 'Original publication retention is an in-process data capability');
  const prefix = `/repos/${sourceRepository}`;
  const artifacts = await paginate(api, `${prefix}/actions/artifacts`, 'artifacts');
  const name = `npm-publication-dispatch-${binding.releaseIntentId}-`;
  const originals = [];
  const pending = artifacts.filter(artifact => artifact.name.startsWith(name));
  const seen = new Set();
  while (pending.length) {
    const artifact = pending.shift();
    if (seen.has(String(artifact.id))) continue;
    seen.add(String(artifact.id));
    requireThat(seen.size <= 64, 'RELEASE_HISTORY', 'Publication history exceeds its bounded physical-attempt budget');
    const match = /^([1-9]\d*)-([1-9]\d*)$/u.exec(artifact.name.slice(name.length));
    requireThat(match && String(artifact.workflow_run?.id) === match[1] &&
      artifact.workflow_run?.head_sha === binding.sourceCommit, 'RELEASE_HISTORY',
    'Publication dispatch artifact has a foreign source or physical origin');
    const [runId, attempt] = match.slice(1);
    const run = await providerValue(api, `${prefix}/actions/runs/${runId}/attempts/${attempt}`);
    requireThat(run.head_sha === binding.sourceCommit && run.event === 'workflow_dispatch' &&
      run.path === '.github/workflows/release.yml' && String(run.run_attempt) === attempt,
    'RELEASE_HISTORY', 'Publication dispatch is not from the adopted exact release caller');
    const dispatch = await artifactJson(api, prefix, artifact, 'publication-dispatch.json', retainOriginal);
    requireThat(dispatch.kind === 'npm-publication-attempt' && dispatch.schemaVersion === 1 &&
      digest(dispatch.binding) === digest(binding) && dispatch.run?.id === runId && dispatch.run?.attempt === attempt &&
      ['publish', 'reconcile-only'].includes(dispatch.mode),
    'RELEASE_HISTORY', 'Original dispatch conflicts with the immutable logical release intent');
    const jobs = await paginate(api, `${prefix}/actions/runs/${runId}/attempts/${attempt}/jobs`, 'jobs');
    const publishers = jobs.filter(job => ['publish', 'npm-handoff / publish'].includes(job.name));
    requireThat(publishers.length === 1, 'RELEASE_HISTORY', 'Original protected publisher identity is missing or ambiguous');
    const step = publishers[0].steps?.find(value => value.name === 'Publish exact tgz through OIDC only, with automatic npm provenance');
    const results = artifacts.filter(value => value.name === `npm-oidc-result-${runId}-${attempt}` &&
      String(value.workflow_run?.id) === runId && value.workflow_run?.head_sha === binding.sourceCommit);
    requireThat(results.length <= 1, 'RELEASE_HISTORY', 'Original npm result identity is ambiguous');
    let result;
    if (results.length) result = await artifactJson(api, prefix, results[0], 'npm-publication-result.json', retainOriginal);
    if (result) requireThat(digest(result.binding) === digest(binding) &&
      result.run?.id === runId && result.run?.attempt === attempt,
    'RELEASE_HISTORY', 'Original npm outcome belongs to different immutable inputs');
    let confirmedEffect = 'Uncertain';
    if (result?.observedExisting === true) confirmedEffect = 'VersionObserved';
    else if (step && !step.started_at && step.conclusion === 'skipped') confirmedEffect = 'NotStarted';
    else if (result && result.publishAttempted === false && result.effect === 'NotStarted' && result.command === null) {
      confirmedEffect = 'NotStarted';
    }
    else if (result?.command?.confirmedRejected === true && Number.isInteger(result.command.exitCode) &&
        result.command.exitCode !== 0 && !result.command.signal &&
        ['E400', 'E401', 'E403', 'E422', 'EOTP', 'ENEEDAUTH'].includes(result.command.rejectionCode)) {
      confirmedEffect = 'RejectedWithoutEffect';
    } else if (['PublishedAndBytesVerified', 'AlreadyPublishedIdentical'].includes(result?.status)) {
      confirmedEffect = 'Published';
    }
    for (const reference of dispatch.priorDispatchArtifacts ?? []) {
      requireThat(numeric.test(reference.id ?? ''), 'RELEASE_HISTORY', 'Invalid original publication dependency');
      let dependency = artifacts.find(value => String(value.id) === reference.id);
      dependency ??= await providerValue(api, `${prefix}/actions/artifacts/${reference.id}`);
      requireThat(dependency.name.startsWith(name) && dependency.digest === reference.digest,
        'RELEASE_HISTORY', 'Original unresolved publication dependency disappeared or changed');
      pending.push(dependency);
    }
    originals.push({ ...dispatch, confirmedEffect,
      dispatchArtifact: { id: String(artifact.id), digest: artifact.digest },
      ...(result ? {
        resultArtifact: { id: String(results[0].id), digest: results[0].digest, filename: 'npm-publication-result.json' },
        result: { status: result.status ?? null, run: result.run, publishAttempted: result.publishAttempted === true,
          effect: result.effect ?? null, reason: result.reason ? safeSummary(result.reason) : null,
          command: result.command ? Object.fromEntries(['exitCode', 'code', 'signal', 'killed', 'rejectionCode',
            'confirmedRejected', 'stdoutSha256', 'stderrSha256'].filter(key => Object.hasOwn(result.command, key))
            .map(key => [key, result.command[key]])) : null },
      } : {}),
      provider: { jobId: String(publishers[0].id), stepStatus: step?.conclusion ?? step?.status ?? 'missing',
        stepStartedAt: step?.started_at ?? null },
      invocationRef: `https://github.com/${sourceRepository}/actions/runs/${runId}/attempts/${attempt}` });
  }
  originals.sort((left, right) => Number(left.run.id) - Number(right.run.id) ||
    Number(left.run.attempt) - Number(right.run.attempt));
  return publicationRecoveryDecision(originals, binding);
}

export function immutablePublicationBinding(handoff) {
  requireThat(handoff?.releaseBinding &&
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(handoff.releaseBinding.releaseRepository ?? '') &&
    ['descriptorSha256', 'checksumsSha256'].every(key => sha.test(handoff.releaseBinding[key] ?? '')),
  'RELEASE_HISTORY', 'Publication requires immutable channel destinations and descriptor/checksum bindings');
  return bounded({ releaseIntentId: handoff.releaseIntentId, sourceRepository: handoff.sourceRepository,
    sourceCommit: handoff.sourceCommit, releaseRepository: handoff.releaseBinding.releaseRepository,
    packageName: handoff.packageName, version: handoff.version, payloadSha256: handoff.sha256,
    descriptorSha256: handoff.releaseBinding.descriptorSha256,
    checksumsSha256: handoff.releaseBinding.checksumsSha256, registry: 'https://registry.npmjs.org' });
}

export function publicationRecoveryDecision(attempts, binding) {
  requireThat(Array.isArray(attempts) && attempts.length <= 1000, 'RELEASE_HISTORY', 'Publication history is incomplete');
  const history = attempts.map(attempt => {
    requireThat(attempt?.kind === 'npm-publication-attempt' && attempt.schemaVersion === 1 &&
      digest(attempt.binding) === digest(binding) && numeric.test(attempt.run?.id ?? '') &&
      numeric.test(attempt.run?.attempt ?? '') && ['publish', 'reconcile-only'].includes(attempt.mode) &&
      numeric.test(attempt.dispatchArtifact?.id ?? '') && /^sha256:[a-f0-9]{64}$/u.test(attempt.dispatchArtifact?.digest ?? '') &&
      attempt.invocationRef === `https://github.com/${binding.sourceRepository}/actions/runs/${attempt.run.id}/attempts/${attempt.run.attempt}` &&
      (attempt.priorDispatchArtifacts === undefined || Array.isArray(attempt.priorDispatchArtifacts)),
    'RELEASE_HISTORY', 'Original publication attempt conflicts with this immutable intent');
    return bounded(attempt);
  });
  requireThat(new Set(history.map(attempt => `${attempt.run.id}/${attempt.run.attempt}`)).size === history.length &&
    new Set(history.map(attempt => attempt.dispatchArtifact.id)).size === history.length,
  'RELEASE_HISTORY', 'Original physical publication attempts and artifact identities must be distinct');
  requireThat(history.every(attempt => attempt.mode !== 'reconcile-only' || attempt.priorDispatchArtifacts?.length > 0),
    'RELEASE_HISTORY', 'Publication reconciliation cannot forget its original publish root');
  for (const attempt of history) for (const reference of attempt.priorDispatchArtifacts ?? []) {
    const original = history.find(row => row.dispatchArtifact.id === reference?.id &&
      row.dispatchArtifact.digest === reference.digest);
    requireThat(original && original !== attempt && original.mode === 'publish' &&
      (BigInt(original.run.id) < BigInt(attempt.run.id) ||
        original.run.id === attempt.run.id && BigInt(original.run.attempt) < BigInt(attempt.run.attempt)), 'RELEASE_HISTORY',
    'Publication reconciliation cannot forget an unresolved original dispatch');
  }
  const uncertain = history.filter(attempt => attempt.mode === 'publish' &&
    !['NotStarted', 'RejectedWithoutEffect'].includes(attempt.confirmedEffect));
  return bounded({ schemaVersion: 1, kind: 'npm-publication-recovery', binding,
    history, mayDispatch: uncertain.length === 0,
    disposition: uncertain.length ? 'ReconcileOnly' : 'NoUnresolvedPriorEffect',
    unresolvedAttempts: uncertain.map(attempt => ({ run: attempt.run, invocationRef: attempt.invocationRef })) });
}

export function requireSanitizedHistory(value, sanitize) {
  requireThat(typeof sanitize === 'function', 'RELEASE_HISTORY', 'Use the shared execution sanitizer');
  const sanitized = sanitize(Buffer.from(canonical(value)));
  requireThat(digest(sanitized.binding ?? null) === digest(value.binding ?? null), 'RELEASE_HISTORY',
    'Sanitization cannot rewrite immutable release identity');
  return sanitized;
}
