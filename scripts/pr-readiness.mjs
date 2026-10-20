import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { canonical, digest, requireThat, SdlcError } from '../src/core.mjs';
import { normalizeExecutionReport, evaluateReadiness, validationInventoryDigest,
  validateExecutionContext, createEvidenceBundle, sanitizeExecutionPayload } from 'ai-sdlc-framework/evidence';
import { executeValidationCommand } from './validation-tools.mjs';
import { inspectCoverage, prepareCoverage, renderCoverageSection } from '../src/coverage.mjs';

export const statusContexts = Object.freeze([
  'framework/validation', 'framework/approval', 'framework/coverage',
]);
export const normalStatusLimit = 998;
const statusLimit = 1000;
export const disposableStatusLimits = Object.freeze({ normal: 8, hard: 10 });
const sha = /^[a-f0-9]{40}$/u;
const marker = projection => `sdlc:v1:${digest(projection)}`;

export function validateDisposableProbeRequest(value, { repository, repositoryId, writerId }) {
  const keys = ['schemaVersion', 'kind', 'id', 'repository', 'repositoryId', 'prNumber', 'headRef', 'baseRef',
    'headSha', 'baseSha', 'mergeSha', 'sourceCommit', 'statusWriterId', 'statusAppId', 'protectionDigest'];
  requireThat(value && Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)) &&
    value.schemaVersion === 1 && value.kind === 'disposable-readiness-probe' &&
    /^[a-z][a-z0-9-]{5,31}$/u.test(value.id ?? '') &&
    value.repository === repository && value.repositoryId === repositoryId && value.statusWriterId === writerId &&
    Number.isSafeInteger(value.prNumber) && value.prNumber > 0 &&
    Number.isSafeInteger(value.statusAppId) && value.statusAppId > 0 &&
    ['headSha', 'baseSha', 'mergeSha', 'sourceCommit'].every(key => sha.test(value[key] ?? '')) &&
    /^[a-f0-9]{64}$/u.test(value.protectionDigest ?? '') &&
    value.headRef === `readiness-probe/${value.id}/head` &&
    value.baseRef === `readiness-probe/${value.id}/base`,
  'SCOPE', 'Probe authority must select one precreated disposable PR/ref/source/protection/writer/app scope');
  return { ...value, contexts: ['coverage', 'validation'].map(name => `framework/disposable/${value.id}/${name}`) };
}

export function planDisposableStatusUpdate(scope, history, value) {
  requireThat(scope && value && Object.getPrototypeOf(value) === Object.prototype &&
    Array.isArray(scope.contexts) && scope.contexts.includes(value.context) &&
    /^framework\/disposable\/[a-z][a-z0-9-]{5,31}\/(?:coverage|validation)$/u.test(value.context) &&
    !statusContexts.includes(value.context) && history?.complete === true && Array.isArray(history.items) &&
    ['pending', 'success', 'failure', 'error'].includes(value.state) &&
    typeof value.description === 'string' && value.description.length > 0 && value.description.length <= 140 &&
    history.items.every(item => item && Object.getPrototypeOf(item) === Object.prototype),
  'SCOPE', 'Disposable status updates cannot target production contexts or change their fixed budget');
  const items = history.items.filter(item => item.context === value.context);
  requireThat(items.every(item => Number.isSafeInteger(item.id) && item.id > 0) &&
    new Set(items.map(item => item.id)).size === items.length, 'PROOF_GAP',
  'Disposable quota decisions require the complete distinct actual status history');
  const last = [...items].sort((left, right) => right.id - left.id)[0];
  const description = `sdlc:disposable:capacity:${scope.id}`;
  if (items.length >= disposableStatusLimits.normal) {
    if (last?.creatorId === scope.statusWriterId && last.state === 'error' && last.description === description) {
      return { action: 'reuse', state: 'error', capacity: true, count: items.length };
    }
    if (items.length >= disposableStatusLimits.hard) return {
      action: 'blocked', capacity: true, count: items.length,
      reason: 'Disposable status budget is exhausted; production quota and contexts are unchanged',
    };
    return { action: 'write', state: 'error', description, capacity: true, count: items.length };
  }
  return { action: 'write', ...value, capacity: false, count: items.length };
}

export function evaluateApproval(pr, { ownerId, now, maxAgeMs }) {
  const blockers = [];
  const current = facts => facts?.complete === true && Number.isFinite(Date.parse(facts.observedAt)) &&
    Date.parse(facts.observedAt) <= now && now - Date.parse(facts.observedAt) <= maxAgeMs &&
    facts.headSha === pr.headSha;
  requireThat(Number.isSafeInteger(ownerId) && ownerId > 0 && Number.isFinite(now) &&
    Number.isSafeInteger(maxAgeMs) && maxAgeMs > 0, 'INPUT', 'Select an explicit approval policy and clock');
  if (!sha.test(pr.headSha ?? '') || !Number.isSafeInteger(pr.authorId) || pr.authorId <= 0) {
    blockers.push('PR author/source identity is unavailable');
  }
  if (pr.authorId !== ownerId) {
    if (!current(pr.reviews) || !Array.isArray(pr.reviews.items)) blockers.push('Current complete maintainer review facts are unavailable');
    else {
      const reviews = pr.reviews.items.filter(review => review.actorId === ownerId)
        .sort((left, right) => right.id - left.id);
      const latest = reviews.find(review => ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state));
      if (!latest || latest.state !== 'APPROVED' || latest.commitSha !== pr.headSha) {
        blockers.push('External contributions require current non-dismissed maintainer approval');
      }
    }
  }
  return { status: blockers.length ? 'NotRun' : 'Passed', blockers,
    enforcement: 'provider-enforcement-unverified' };
}

export function evaluateConversations(pr, { now, maxAgeMs }) {
  requireThat(Number.isFinite(now) && Number.isSafeInteger(maxAgeMs) && maxAgeMs > 0,
    'INPUT', 'Conversation observation requires an explicit freshness policy');
  const facts = pr.threads;
  const current = facts?.complete === true && facts.headSha === pr.headSha &&
    Number.isFinite(Date.parse(facts.observedAt)) && Date.parse(facts.observedAt) <= now &&
    now - Date.parse(facts.observedAt) <= maxAgeMs && Number.isSafeInteger(facts.unresolved) &&
    facts.unresolved >= 0;
  const blockers = !current ? ['Current complete conversation facts are unavailable'] :
    facts.unresolved ? ['All review conversations must be resolved'] : [];
  if (pr.protection?.observed !== true || pr.protection.conversations !== true) {
    blockers.push(`Native conversation enforcement is ${pr.protection?.capability ?? 'Unavailable'}`);
  }
  return { status: blockers.length ? 'NotRun' : 'Passed', blockers,
    enforcement: pr.protection?.observed === true && pr.protection.conversations === true ?
      'observed-native-conversation-rule' : 'provider-enforcement-unverified',
    capability: pr.protection?.capability ?? 'Unavailable' };
}

export function sharedStatusKeys(snapshot) {
  requireThat(snapshot && Array.isArray(snapshot.prs) &&
    Number.isSafeInteger(snapshot.repositoryId) && snapshot.repositoryId > 0,
  'INPUT', 'Use an independently acquired repository/PR snapshot');
  requireThat(new Set(snapshot.prs.map(pr => pr.number)).size === snapshot.prs.length,
    'INPUT', 'Complete PR membership cannot contain duplicate provider identities');
  const keys = new Map();
  for (const pr of snapshot.prs) {
    requireThat(Number.isSafeInteger(pr.number) && pr.number > 0 && sha.test(pr.headSha),
      'INPUT', 'PR status membership needs actual PR and head identities');
    for (const target of new Set([pr.headSha, ...(sha.test(pr.mergeSha ?? '') ? [pr.mergeSha] : [])])) {
      for (const context of statusContexts) {
        const key = `${snapshot.repositoryId}:${target}:${context}`;
        const group = keys.get(key) ?? {
          repositoryId: snapshot.repositoryId, sha: target, context, members: [],
        };
        const verdict = pr.verdicts[context];
        requireThat(verdict && ['Passed', 'Failed', 'NotRun'].includes(verdict.status),
          'INPUT', 'Each context needs its independently evaluated member verdict');
        group.members.push({
          number: pr.number, headSha: pr.headSha, baseSha: pr.baseSha, mergeSha: pr.mergeSha,
          inputDigest: verdict.inputDigest, status: verdict.status, blockers: verdict.blockers,
          ...(verdict.diagnostics ? { diagnostics: verdict.diagnostics } : {}),
          ...(verdict.uncovered ? { uncovered: verdict.uncovered } : {}),
        });
        keys.set(key, group);
      }
    }
  }
  return [...keys.values()].map(group => {
    group.members.sort((left, right) => left.number - right.number);
    const complete = snapshot.complete === true && group.members.every(member =>
      sha.test(member.baseSha ?? '') && sha.test(member.mergeSha ?? '') &&
      /^[a-f0-9]{64}$/u.test(member.inputDigest ?? ''));
    const status = group.members.some(member => member.status === 'Failed') ? 'Failed' :
      complete && group.members.every(member => member.status === 'Passed') ? 'Passed' : 'NotRun';
    const projection = { repositoryId: group.repositoryId, sha: group.sha, context: group.context,
      complete, members: group.members, status };
    return { ...projection, description: marker(projection) };
  });
}

export function planStatusUpdate(group, history, { writerId, writerControl }) {
  requireThat(statusContexts.includes(group.context) && sha.test(group.sha) &&
    Number.isSafeInteger(writerId) && writerId > 0,
  'INPUT', 'Select a fixed status context and independently established writer');
  if (!history.complete || writerControl !== true) return {
    action: 'blocked', reason: 'Complete status pagination and verified writer control are required',
  };
  const statuses = history.items.filter(status => status.context === group.context);
  requireThat(statuses.every(status => Number.isSafeInteger(status.id) && status.id > 0) &&
    new Set(statuses.map(status => status.id)).size === statuses.length,
  'INPUT', 'Status history must contain distinct actual provider records');
  const latest = [...statuses].sort((left, right) => right.id - left.id)[0];
  const capacity = `sdlc:v1:capacity:${group.context}`;
  const selectedWriter = latest?.creatorId === writerId;
  if (statuses.length >= normalStatusLimit) {
    if (selectedWriter && latest.state === 'error' && latest.description === capacity) {
      return { action: 'reuse', state: 'error', capacity: true, count: statuses.length };
    }
    if (statuses.length >= statusLimit) return {
      action: 'blocked', reason: latest?.state === 'success' ?
        'Exhausted key has old success; enforcement is unavailable until an authorized fresh source identity' :
        'Status capacity is exhausted; an authorized fresh source identity is required',
      count: statuses.length,
    };
    return { action: 'write', state: 'error', description: capacity,
      capacity: true, count: statuses.length };
  }
  const state = group.status === 'Passed' ? 'success' :
    group.status === 'Failed' || group.context === 'framework/coverage' ? 'failure' : 'pending';
  if (selectedWriter && latest.state === state && latest.description === group.description) {
    return { action: 'reuse', state, capacity: false, count: statuses.length };
  }
  if (state === 'success' && !(selectedWriter && latest.state === 'pending' &&
      latest.description === group.description)) {
    return { action: 'write', state: 'pending', description: group.description,
      capacity: false, count: statuses.length };
  }
  return { action: 'write', state, description: group.description,
    capacity: false, count: statuses.length };
}

async function publishObserved(host, key, update, policy, history) {
  let posted;
  let uncertainty;
  try {
    posted = await host.publish(key, {
      state: update.state, description: update.description, target_url: policy.detailsUrl,
    });
  } catch (error) {
    uncertainty = error.code ?? 'UNKNOWN';
  }
  const observed = await host.statuses(key);
  const matching = observed.complete && observed.items.filter(status => status.context === key.context &&
    status.creatorId === policy.writerId && status.state === update.state &&
    status.description === update.description &&
    !history.items.some(previous => previous.id === status.id));
  if (!matching || matching.length !== 1 || posted && matching[0].id !== posted.id) {
    return { status: 'NotRun', reason: uncertainty ?
      'Status POST outcome is uncertain; retained history requires reconciliation, not a blind retry' :
      'Status publication could not be independently reconciled',
    uncertainty: uncertainty ?? null };
  }
  return { observed: true };
}

async function invalidateChangedKey(host, key, policy, group) {
  const nonPassing = { ...group, status: 'NotRun',
    description: marker({ ...group, status: 'NotRun', reason: 'Inputs changed during status publication' }) };
  const history = await host.statuses(key);
  const update = planStatusUpdate(nonPassing, history, {
    writerId: policy.writerId, writerControl: await host.verifyWriterControl(),
  });
  if (update.action === 'write') {
    const effect = await publishObserved(host, key, update, policy, history);
    if (!effect.observed) return { key, ...effect, members: group.members };
  } else if (update.action === 'blocked') return { key, status: 'NotRun', ...update, members: group.members };
  return { key, status: 'NotRun', reason: 'Changed PR inputs invalidated the previous success',
    state: update.state, capacity: update.capacity, members: group.members };
}

export async function reconcileStatusKey(host, key, policy) {
  requireThat(['snapshot', 'statuses', 'publish', 'verifyWriterControl'].every(name =>
    typeof host[name] === 'function'), 'HOST', 'Status reconciliation requires trusted in-process acquisition and dispatch');
  requireThat(key.repositoryId === policy.repositoryId, 'SCOPE',
    'The status key must belong to the independently selected repository');
  let latestMembers = [];
  for (let pass = 0; pass < 3; pass++) {
    const snapshot = await host.snapshot();
    const group = sharedStatusKeys(snapshot).find(group => group.repositoryId === key.repositoryId &&
      group.sha === key.sha && group.context === key.context);
    if (!group) return { key, status: 'NotRun', reason: 'No current open PR consumes this status key' };
    latestMembers = group.members;
    const history = await host.statuses(key);
    const update = planStatusUpdate(group, history, {
      writerId: policy.writerId, writerControl: await host.verifyWriterControl(),
    });
    if (update.action === 'blocked') return { key, status: 'NotRun', ...update, members: group.members };
    if (update.action === 'write') {
      const effect = await publishObserved(host, key, update, policy, history);
      if (!effect.observed) return { key, ...effect, members: group.members };
    }
    const refreshed = sharedStatusKeys(await host.snapshot()).find(group =>
      group.repositoryId === key.repositoryId && group.sha === key.sha && group.context === key.context);
    if (update.capacity) return { key, status: 'NotRun', state: 'error', capacity: true, members: group.members };
    if (update.state === 'success' && refreshed?.description !== group.description) {
      return invalidateChangedKey(host, key, policy, refreshed ?? group);
    }
    if (update.action === 'reuse' && refreshed?.description === group.description) {
      return { key, status: update.state === 'success' ? 'Passed' :
        group.status === 'Failed' ? 'Failed' : 'NotRun', ...update, members: group.members };
    }
    if (refreshed?.description === group.description && update.state !== 'pending') {
      return { key, status: update.state === 'success' ? 'Passed' :
        group.status === 'Failed' ? 'Failed' : 'NotRun', state: update.state, members: group.members };
    }
  }
  return { key, status: 'NotRun', members: latestMembers,
    reason: 'PR inputs changed during bounded reconciliation; no current success is credited' };
}

export async function reconcilePrReadiness(host, policy) {
  const snapshot = await host.snapshot();
  const results = [];
  const pending = sharedStatusKeys(snapshot);
  const seen = new Set();
  for (const key of pending) {
    const identity = `${key.repositoryId}:${key.sha}:${key.context}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    results.push(await reconcileStatusKey(host, key, policy));
    for (const next of sharedStatusKeys(await host.snapshot())) {
      if (!seen.has(`${next.repositoryId}:${next.sha}:${next.context}`)) pending.push(next);
    }
    requireThat(seen.size <= 10000, 'CAPACITY', 'PR status reconciliation exceeded its bounded key inventory');
  }
  const conversations = snapshot.prs.filter(pr => pr.conversations).map(pr =>
    ({ number: pr.number, ...pr.conversations }));
  return { status: snapshot.complete && results.length && results.every(result => result.status === 'Passed') &&
    conversations.every(item => item.status === 'Passed') ? 'Passed' : 'NotRun',
  results, ...(conversations.length ? { conversations } : {}) };
}

async function probeDirectory(directory) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  requireThat(typeof directory === 'string' && directory.trim(), 'SCOPE', 'Probe output must be explicit');
  const selected = path.resolve(root, directory);
  const relative = path.relative(root, selected);
  requireThat(relative.split(path.sep)[0] === '.test-data' && relative.split(path.sep).length >= 2 &&
    !relative.split(path.sep).includes('..') && !path.isAbsolute(relative), 'SCOPE',
  'Probe evidence must be a new owned checkout-local .test-data child');
  let current = root;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    await fs.mkdir(current).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const stat = await fs.lstat(current);
    requireThat(stat.isDirectory() && !stat.isSymbolicLink(), 'SCOPE', 'Probe output cannot traverse linked storage');
  }
  requireThat(!(await fs.readdir(selected)).length, 'SCOPE', 'Probe output must be new; original attempts are immutable');
  return selected;
}

async function probeFixture(directory, scope, execution) {
  const fixture = path.join(directory, `owned-fixture-${randomUUID()}`);
  await fs.mkdir(fixture);
  const source = "import test from 'node:test';import assert from 'node:assert/strict';\n" +
    "test('controlled required failure',()=>assert.equal(process.env.SDLC_PROBE_FAILURE,'false'));\n" +
    "test('controlled required sibling',()=>assert.equal(2+2,4));\n";
  const filename = path.join(fixture, 'controlled.test.mjs');
  await fs.writeFile(filename, source, { flag: 'wx' });
  await fs.writeFile(path.join(directory, 'fixture-source.json'), canonical({
    kind: 'disposable-policy-fixture-source', sha256: digest(source), contents: source,
  }), { flag: 'wx' });
  const environment = { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' };
  for (const name of ['GITHUB_TOKEN', 'GH_TOKEN', 'NPM_TOKEN', 'NODE_AUTH_TOKEN']) delete environment[name];
  let positive;
  let failure;
  try {
    const run = (name, fail) => executeValidationCommand({ name, command: process.execPath,
      args: ['--test', '--test-reporter=tap', filename], outputDir: directory,
      environment: { ...environment, SDLC_PROBE_FAILURE: fail ? 'true' : 'false' } });
    positive = await run('fixture-positive', false);
    failure = await run('fixture-failure', true);
    requireThat(positive.complete && positive.exitCode === 0 &&
      /^ok \d+ - controlled required failure$/mu.test(positive.stdout) &&
      /^ok \d+ - controlled required sibling$/mu.test(positive.stdout) &&
      failure.complete && failure.exitCode !== 0 &&
      /^not ok \d+ - controlled required failure$/mu.test(failure.stdout) &&
      /^ok \d+ - controlled required sibling$/mu.test(failure.stdout), 'PROBE_FIXTURE',
    'Actual positive/failing child outcomes and passing sibling are required before provider probes');
  } finally {
    const stat = await fs.lstat(fixture);
    requireThat(stat.isDirectory() && !stat.isSymbolicLink() && path.dirname(fixture) === directory,
      'SCOPE', 'Only the exact owned local probe fixture may be removed');
    await fs.rm(fixture, { recursive: true });
  }
  const specification = { schemaVersion: 1, profile: 'disposable-policy-fixture',
    cases: ['required', 'sibling'].map(name => ({ id: `T-DISPOSABLE-${name}`, conditions: ['AC-205.3'],
      expectedDigest: digest(`Controlled ${name} outcome, never native acceptance`),
      executionId: 'disposable-fixture', mode: 'automated', owner: 'provider', location: 'provider-policy',
      checkpoint: 'post-review', assertions: [{ id: `assertion-${name}`,
        selector: { procedure: `controlled-${name}` } }] })) };
  const context = validateExecutionContext({
    candidateDigest: digest(scope.headSha), testSpecDigest: digest(specification),
    configDigest: digest({ scope, disposableStatusLimits }),
    inventoryDigest: validationInventoryDigest(specification),
    sources: [{ repositoryId: `repository-${scope.repositoryId}`, revision: scope.sourceCommit,
      contentDigest: digest(source) }], profile: specification.profile,
    environment: 'local', location: 'provider-policy', mode: 'automated', owner: 'provider',
    native: { kind: 'fixture', platform: process.platform, architecture: process.arch,
      image: `${process.env.ImageOS ?? 'controlled-host'}/${process.env.ImageVersion ?? 'local-fixture'}`,
      toolchain: { node: process.versions.node } },
    producer: { provider: 'github', connection: 'disposable-policy', scopeRef: `repository:${scope.repositoryId}`,
      definitionRef: execution.workflowRef, executionRef: String(execution.runId),
      attemptRef: String(execution.attempt), attemptKind: 'known' },
    attemptCapability: 'distinct', jobRef: 'disposable-fixture', artifacts: [],
  });
  const evaluate = (name, command, statuses) => {
    const raw = { schemaVersion: 1, kind: 'test-execution', context, startedAt: command.startedAt,
      finishedAt: command.finishedAt, observedAt: command.finishedAt, sequence: 1, complete: true,
      exitCode: name === 'failure' ? command.exitCode : 0,
      results: specification.cases.flatMap(test => {
        const selected = statuses[test.id];
        if (!selected) return [];
        return [{ testId: test.id, assertionId: test.assertions[0].id, selector: test.assertions[0].selector,
          status: selected, expectedMet: selected === 'Passed' ? true : selected === 'Failed' ? false : null,
          expectedDigest: test.expectedDigest, checkpoint: test.checkpoint, observedAt: command.finishedAt,
          sourceSequence: 1, durationMs: Date.parse(command.finishedAt) - Date.parse(command.startedAt),
          exitCode: selected === 'Failed' ? command.exitCode : 0 }];
      }) };
    const normalized = normalizeExecutionReport(raw, context, input => ({
      verifierId: 'owned-disposable-fixture-host', reportDigest: input.reportDigest,
      context, sourceTime: raw.observedAt, sourceSequence: raw.sequence,
    }));
    return evaluateReadiness(specification, name === 'missing-job' ? [] : [normalized], {
      profile: specification.profile, executions: [{ id: 'disposable-fixture', context }],
      now: new Date().toISOString(), policy: { maxAgeMs: 300000, revisionPolicy: 'exact',
        verifierIds: ['owned-disposable-fixture-host'] },
    });
  };
  const baseline = evaluate('baseline', positive, { 'T-DISPOSABLE-required': 'Passed', 'T-DISPOSABLE-sibling': 'Passed' });
  requireThat(baseline.status === 'Passed', 'PROBE_FIXTURE', 'The actual controlled positive baseline is incomplete');
  const scenarios = [
    ['failure', evaluate('failure', failure, { 'T-DISPOSABLE-required': 'Failed', 'T-DISPOSABLE-sibling': 'Passed' })],
    ['missing-job', evaluate('missing-job', positive, {})],
    ['skipped', evaluate('skipped', positive, { 'T-DISPOSABLE-required': 'Skipped', 'T-DISPOSABLE-sibling': 'Passed' })],
    ['missing-prerequisite', evaluate('missing-prerequisite', positive, { 'T-DISPOSABLE-sibling': 'Passed' })],
  ];
  for (const [name, evaluation] of [['baseline', baseline], ...scenarios]) {
    await fs.writeFile(path.join(directory, `generic-${name}.json`), canonical(createEvidenceBundle(evaluation)), { flag: 'wx' });
  }
  requireThat(scenarios.every(([, result]) => result.status !== 'Passed') &&
    scenarios[0][1].status === 'Failed', 'PROBE_FIXTURE',
  'Missing/failed/skipped/prerequisite fixture observations must remain non-passing');
  return { baseline, scenarios, context, positive, failure };
}

export async function runDisposablePolicyProbe({ client, request, authorize, evidenceDir, execution,
  poll = async operation => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const result = await operation();
      if (result) return result;
      if (attempt < 5) await delay(10000);
    }
    return null;
  } }) {
  const { requireReadinessGitHubClient } = await import('./github-readiness-host.mjs');
  requireReadinessGitHubClient(client);
  const admission = await client.authorizeDisposableProbe(request, authorize);
  if (admission.activity !== 'authorized') {
    const directory = await probeDirectory(evidenceDir);
    const result = { ...admission, kind: 'disposable-policy-probe', requestDigest: digest(request),
      nativeAcceptance: 'NotRun' };
    await fs.writeFile(path.join(directory, 'probe-result.json'),
      canonical(sanitizeExecutionPayload(Buffer.from(JSON.stringify(result)))), { flag: 'wx' });
    return result;
  }
  requireThat(execution && /^[1-9]\d*$/u.test(String(execution.runId)) &&
    /^[1-9]\d*$/u.test(String(execution.attempt)) && typeof execution.workflowRef === 'string',
  'HOST', 'Probe originals need the actual selected workflow execution and attempt');
  const directory = await probeDirectory(evidenceDir);
  const journal = await fs.open(path.join(directory, 'probe-events.ndjson'), 'wx');
  const { capability, scope } = admission;
  let sequence = 0;
  const records = [];
  const retain = async value => {
    const record = sanitizeExecutionPayload(Buffer.from(JSON.stringify({
      sequence: ++sequence, observedAt: new Date().toISOString(), ...value,
    })));
    records.push(record);
    await journal.write(`${JSON.stringify(record)}\n`);
    await journal.sync();
  };
  const publish = async (context, state, label) => {
    await retain({ kind: 'dispatching', context, state, label, sourceCommit: scope.sourceCommit,
      headSha: scope.headSha, requestDigest: admission.requestDigest, execution });
    try {
      const result = await client.publishDisposable(capability, { context, state, description: `Disposable ${scope.id}: ${label}` });
      await retain({ kind: 'dispatch-result', context, label, result });
      return result;
    } catch (error) {
      await retain({ kind: 'dispatch-uncertain-or-rejected', context, label, code: error.code ?? 'UNKNOWN',
        message: error.message, retry: 'No automatic retry; retain and reconcile this original attempt' });
      throw error;
    }
  };
  const observe = async (label, expected) => {
    const actual = await poll(async () => {
      const facts = await client.observeDisposable(capability);
      await retain({ kind: 'provider-observation', label, expected, facts });
      return facts.pr.mergeState === expected ? facts : null;
    });
    requireThat(actual, 'PROBE_OBSERVATION',
      `Normal provider merge eligibility did not establish ${expected} for ${label}; no merge or policy change was attempted`);
  };
  let result;
  try {
    await retain({ kind: 'admission', requestDigest: admission.requestDigest,
      scope, facts: admission.facts, limits: disposableStatusLimits, execution });
    const fixture = await probeFixture(directory, scope, execution);
    const coverageContext = scope.contexts.find(context => context.endsWith('/coverage'));
    const validationContext = scope.contexts.find(context => context.endsWith('/validation'));
    const baseline = async label => {
      await publish(validationContext, 'success', label);
      await observe(label, 'clean');
    };
    await publish(coverageContext, 'success', 'complete controlled coverage baseline');
    await publish(validationContext, 'success', 'complete controlled native-policy fixture baseline');
    await observe('complete baseline', 'clean');
    const coverageSource = { repositoryId: 'probe-fixture', sourceRevision: scope.headSha,
      requirements: [{ artifactId: 'probe', path: 'requirements.md',
        contents: '# Requirements\n### FR-205: Probe\n**Definition of Done**\n- AC-205.3: Required controlled observation.\n' }],
      testPlans: [{ artifactId: 'probe', path: 'test-plan.md', contents: JSON.stringify({ tests: [{
        id: 'T-DISPOSABLE', requirements: ['FR-205'], conditions: ['AC-205.3'], environment: 'local',
        level: 'unit', checkpoint: 'pre-review', mode: 'automated', owner: 'agent', location: 'development-machine',
        expected: 'Controlled coverage exists', implementation: 'procedure: disposable-policy-fixture',
      }] }) }] };
    requireThat(inspectCoverage({ ...coverageSource, body: renderCoverageSection(prepareCoverage(coverageSource)) }).complete,
      'PROBE_FIXTURE', 'Controlled coverage baseline must be valid');
    const missingCoverage = inspectCoverage({ ...coverageSource, body: '' });
    requireThat(!missingCoverage.complete, 'PROBE_FIXTURE', 'Missing controlled coverage must be rejected');
    await retain({ kind: 'coverage-fixture', result: missingCoverage });
    await publish(coverageContext, 'failure', 'missing coverage');
    await observe('missing coverage', 'blocked');
    await publish(coverageContext, 'success', 'restored controlled coverage baseline');
    await observe('restored coverage baseline', 'clean');
    for (const [index, [name, evaluation]] of fixture.scenarios.entries()) {
      await publish(validationContext, evaluation.status === 'Failed' ? 'failure' : 'pending', name);
      await observe(name, 'blocked');
      if (index < fixture.scenarios.length - 1) await baseline(`restored before ${fixture.scenarios[index + 1][0]}`);
    }
    for (const context of scope.contexts) {
      let frozen;
      for (let slot = 0; slot <= disposableStatusLimits.hard; slot++) {
        const update = await publish(context, 'pending', `bounded capacity ${slot + 1}`);
        if (update.capacity) { frozen = update; break; }
      }
      requireThat(frozen?.state === 'error' && frozen.count < disposableStatusLimits.hard,
        'PROBE_OBSERVATION', 'A bounded disposable context must freeze non-passing before hard capacity');
      const repeated = await publish(context, 'success', 'must not renew success after capacity');
      requireThat(repeated.action === 'reuse' && repeated.state === 'error' && repeated.capacity,
        'PROBE_OBSERVATION', 'Confirmed disposable capacity must stay frozen without another POST');
    }
    await observe('terminal disposable capacity', 'blocked');
    result = { status: 'Passed', kind: 'disposable-policy-probe', scope, requestDigest: admission.requestDigest,
      execution, limits: disposableStatusLimits, fixtureCredit: 'NotRun', nativeAcceptance: 'NotRun',
      productionStatusDispatches: 0, remoteCleanup: 'Precreated PR/refs/rules and final non-passing statuses retained; no deletion authority assumed' };
  } catch (error) {
    result = { status: 'NotRun', kind: 'disposable-policy-probe', scope, requestDigest: admission.requestDigest,
      execution, blocker: { code: error.code ?? 'PROBE', message: error.message },
      nativeAcceptance: 'NotRun', retry: 'Reconcile original retained effects before a separately authorized retry' };
  } finally { await journal.close(); }
  await fs.writeFile(path.join(directory, 'probe-result.json'),
    canonical(sanitizeExecutionPayload(Buffer.from(JSON.stringify(result)))), { flag: 'wx' });
  return result;
}

async function runAuthorizedProbeCli(args) {
  requireThat(args.length === 3 && args[0] === 'probe' && args[1] === '--evidence-dir',
    'INPUT', 'Usage: pr-readiness.mjs probe --evidence-dir .test-data/<new-owned-run>');
  const env = process.env;
  requireThat(env.GITHUB_ACTIONS === 'true' && env.RUNNER_ENVIRONMENT === 'github-hosted' &&
    env.GITHUB_REPOSITORY === 'urmich/ai-sdlc-framework' && env.GITHUB_EVENT_NAME === 'workflow_dispatch' &&
    env.GITHUB_TOKEN && env.SDLC_DISPOSABLE_REQUEST && env.GITHUB_SHA &&
    ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_REPOSITORY_ID', 'READINESS_STATUS_CREATOR_ID']
      .every(name => /^[1-9]\d*$/u.test(env[name] ?? '')),
  'HOST', 'Disposable probes run only from an explicit trusted owner workflow_dispatch');
  const { createReadinessGitHubClient } = await import('./github-readiness-host.mjs');
  const client = createReadinessGitHubClient({ repository: env.GITHUB_REPOSITORY,
    repositoryId: Number(env.GITHUB_REPOSITORY_ID), writerId: Number(env.READINESS_STATUS_CREATOR_ID),
    token: env.GITHUB_TOKEN, generation: `disposable-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}` });
  const request = JSON.parse(env.SDLC_DISPOSABLE_REQUEST);
  const run = await client.get(`/actions/runs/${env.GITHUB_RUN_ID}`);
  const result = await runDisposablePolicyProbe({ client, request, evidenceDir: args[2],
    execution: { runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT, workflowRef: env.GITHUB_WORKFLOW_REF },
    authorize: async ({ request: scope, requestDigest, facts }) =>
      run.event === 'workflow_dispatch' && run.path === '.github/workflows/pr-policy-refresh.yml' &&
      run.repository?.id === client.repositoryId && run.actor?.id === facts.repository.ownerId &&
      run.triggering_actor?.id === facts.repository.ownerId && run.head_sha === scope.sourceCommit &&
      run.head_sha === env.GITHUB_SHA && String(run.run_attempt) === env.GITHUB_RUN_ATTEMPT &&
      run.head_branch === facts.repository.defaultBranch &&
      env.GITHUB_REF === `refs/heads/${facts.repository.defaultBranch}` &&
      requestDigest === digest(request) });
  console.log(JSON.stringify({ status: result.status, kind: result.kind ?? 'disposable-policy-probe',
    blocker: result.blocker ?? null, nativeAcceptance: 'NotRun' }));
  process.exitCode = result.status === 'Passed' ? 0 : 2;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  let ownedDirectory;
  try {
    requireThat(args.length === 3 && args[0] === 'probe' && args[1] === '--evidence-dir',
      'INPUT', 'Usage: pr-readiness.mjs probe --evidence-dir .test-data/<new-owned-run>');
    ownedDirectory = await probeDirectory(args[2]);
    await runAuthorizedProbeCli(args);
  } catch (error) {
    if (!(error instanceof SdlcError) && !(error instanceof SyntaxError)) throw error;
    const result = { status: 'NotRun', kind: 'disposable-policy-probe', nativeAcceptance: 'NotRun',
      blocker: { code: error instanceof SyntaxError ? 'INPUT' : error.code,
        message: error instanceof SyntaxError ? 'The scoped disposable request must be valid JSON' : error.message } };
    if (ownedDirectory) await fs.writeFile(path.join(ownedDirectory, 'probe-host-blocker.json'),
      canonical(result), { flag: 'wx' });
    console.error(JSON.stringify(result));
    process.exitCode = 2;
  }
}
