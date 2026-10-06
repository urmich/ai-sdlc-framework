import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fixture, grant, observeFixtureRepository } from './helpers.mjs';
import { canonical, digest } from '../src/core.mjs';
import { atomicWrite, readJson, updateJson, withLock, writeJson, safePath } from '../src/files.mjs';
import { identity } from '../src/git.mjs';
import { Store, orderRecordRemovals } from '../src/store.mjs';
import { validateRecord } from '../src/schemas.mjs';
import { repositoryObservationKey, pullRequestObservationKey } from '../src/repository-observations.mjs';
import { parseArguments, runCli } from '../src/cli.mjs';
import { attachMonitor, readMonitor } from '../src/monitors.mjs';
import { currentCycle, currentTestEvidence, stagePassed } from '../src/authority.mjs';
import { currentArtifact, currentDeployment } from '../src/current-evidence.mjs';
import { formatAudit, recordAudit, replayAudit } from '../src/audit.mjs';

test('T-16 canonical data, atomic replacement, and deterministic write-boundary failures preserve old/new state', async t => {
  const f = await fixture(t);
  assert.equal(canonical({ z: 1, a: [2] }), '{"a":[2],"z":1}');
  assert.equal(digest({ z: 1, a: 2 }), digest({ a: 2, z: 1 }));
  for (const boundary of ['created', 'written', 'flushed', 'replaced', 'directory-flushed']) {
    const file = path.join(f.root, `atomic-${boundary}`);
    await fs.writeFile(file, 'old');
    await assert.rejects(atomicWrite(file, 'new', { fault: async stage => {
      if (stage === boundary) throw new Error('injected');
    } }), /injected/);
    assert.equal(await fs.readFile(file, 'utf8'), ['replaced', 'directory-flushed'].includes(boundary) ? 'new' : 'old');
  }
  assert.equal((await fs.readdir(f.root)).filter(name => name.includes('.write-')).length, 0);
});
test('T-16 old live locks are never stolen; concurrent revision updates serialize', async t => {
  const f = await fixture(t);
  const lock = path.join(f.root, 'old.lock');
  await writeJson(lock, { token: 'live', host: os.hostname(), pid: process.pid, acquiredAt: '1900-01-01' });
  await assert.rejects(withLock(lock, () => assert.fail('must not enter'), { waitMs: 0 }), { code: 'LOCK_BUSY' });
  assert.equal((await readJson(lock)).token, 'live');
  await fs.unlink(lock);
  const observed = await withLock(lock, () => readJson(lock));
  assert.equal(observed.host, os.hostname());
  assert.equal(observed.pid, process.pid);
  assert.ok(observed.token);
  assert.ok(!(await fs.readdir(f.root)).some(name =>
    name.includes('.candidate')));
  let actionRan = false;
  await assert.rejects(withLock(lock, () => {
    actionRan = true;
  }, {
    fault: async stage => {
      if (stage === 'candidate-published') {
        const error = new Error('candidate cleanup failed');
        error.code = 'EACCES';
        throw error;
      }
    },
  }), /candidate cleanup failed/u);
  assert.equal(actionRan, false);
  await assert.rejects(fs.stat(lock), { code: 'ENOENT' });
  assert.equal(await withLock(lock, () => 'retry succeeded'),
    'retry succeeded');
  for (const name of await fs.readdir(f.root)) {
    if (name.includes('.candidate')) await fs.unlink(path.join(f.root, name));
  }
  const file = path.join(f.root, 'registry.json');
  const updates = await Promise.allSettled(Array.from({ length: 8 }, () =>
    updateJson(file, { revision: 0, count: 0 },
      value => ({ ...value, count: value.count + 1 }), { waitMs: 3000 })));
  for (const update of updates) if (update.status === 'rejected') throw update.reason;
  assert.deepEqual(await readJson(file), { revision: 8, count: 8 });
  await assert.rejects(updateJson(file, {}, value => value, { expectedRevision: 1 }), { code: 'STALE' });
});
test('T-48 batch work-item locks are acquired before any invalidation action', async t => {
  const f = await fixture(t);
  const secondWorkItem = 'wi-z-second-lock';
  await fs.mkdir(f.store.workPath(secondWorkItem), { recursive: true });
  let release;
  let started;
  const startedPromise = new Promise(resolve => { started = resolve; });
  const releasePromise = new Promise(resolve => { release = resolve; });
  const held = withLock(path.join(f.store.workPath(secondWorkItem), '.lock'),
    async () => {
      started();
      await releasePromise;
    });
  await startedPromise;
  let actionRan = false;
  await assert.rejects(f.store.withWorkItemLocks([
    f.workItemId,
    secondWorkItem,
  ], () => {
    actionRan = true;
  }), { code: 'LOCK_BUSY' });
  assert.equal(actionRan, false);
  release();
  await held;
});
test('T-19 bindings resolve linked worktrees and refuse stale branch authority', async t => {
  const f = await fixture(t);
  await f.runGit('add', '.sdlc');
  await f.runGit('commit', '-qm', 'Create fixture manifest');
  const worktree = path.join(f.root, 'linked tree');
  await f.runGit('worktree', 'add', '-qb', 'feature/second', worktree);
  const original = await identity(f.repo, 'primary');
  const linked = await identity(worktree, 'primary');
  assert.equal(original.commonDir, linked.commonDir);
  assert.equal(linked.linkedWorktree, true);
  await assert.rejects(f.store.resolve(worktree, f.sessionId), { code: 'BINDING' });
  await f.runGit('checkout', '-qb', 'feature/other');
  await assert.rejects(f.store.resolve(f.repo, f.sessionId), { code: 'BINDING' });
});
test('T-23 symlink escapes and unsafe identifiers are rejected', async t => {
  const f = await fixture(t);
  await fs.symlink(f.home, path.join(f.repo, 'escape'));
  await assert.rejects(safePath(f.repo, 'escape/file'), { code: 'PATH' });
  assert.throws(() => f.store.workPath('../escape'), { code: 'INPUT' });
});
test('T-16 confirmed terminated owner is recoverable, while unverifiable host ownership is preserved', async t => {
  const f = await fixture(t);
  const child = await promisify(execFile)(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']);
  const deadPid = Number(child.stdout);
  const lock = path.join(f.root, 'dead-owner.lock');
  await writeJson(lock, { token: 'terminated-owner', host: os.hostname(), pid: deadPid, acquiredAt: '1900-01-01' });
  assert.equal(await withLock(lock, () => 'recovered'), 'recovered');
  await writeJson(lock, { token: 'unverifiable', host: 'another-host.invalid', pid: deadPid, acquiredAt: '1900-01-01' });
  await assert.rejects(withLock(lock, () => assert.fail('unverifiable owner'), { waitMs: 0 }), { code: 'LOCK_BUSY' });
  assert.equal((await readJson(lock)).token, 'unverifiable');
});
test('T-30 older recovery completion cannot clear a newer recovery marker', async t => {
  const f = await fixture(t);
  const older = await f.store.beginRecovery(f.workItemId);
  const newer = await f.store.beginRecovery(f.workItemId);
  await assert.rejects(f.store.completeRecovery(f.workItemId, older), { code: 'RECOVERY' });
  assert.equal((await f.store.load(f.workItemId)).recoveryRequired, true);
  await f.store.completeRecovery(f.workItemId, newer);
  assert.equal((await f.store.load(f.workItemId)).recoveryRequired, false);
});
test('T-16 revocation removal ordering is bounded for overlapping graphs', () => {
  const records = [{ type: 'event', id: 'event-base', kind: 'permission', effect: {} }];
  for (let index = 1; index <= 30; index++) {
    records.push({ type: 'event', id: `event-revoke-${index}`, kind: 'revocation',
      effect: { revokes: records.filter(record => record.type === 'event').map(record => record.id) } });
  }
  for (const event of [...records]) records.push({ type: 'audit-reference',
    id: `audit-${event.id}`, eventId: event.id });
  const started = Date.now();
  const ordered = orderRecordRemovals(records, records.map(record => record.id));
  assert.ok(Date.now() - started < 1000);
  assert.ok(ordered.indexOf('event-base') < ordered.indexOf('event-revoke-30'));
  assert.ok(ordered.indexOf('event-revoke-30') < ordered.indexOf('audit-event-revoke-30'));
});

test('T-101 two checkout paths sharing a hosted URL preserve separate observation records', async t => {
  const first = await fixture(t);
  const second = await fixture(t);
  const url = 'https://git.example.invalid/team/repo.git';
  const observedAt = '2026-09-08T00:00:00.000Z';
  const records = [];
  for (const f of [first, second]) {
    await f.runGit('remote', 'set-url', 'origin', url);
    const store = new Store(f.home, {
      clock: f.clock,
      verifyRepository: async context => ({
        canonicalLocalRepositoryPath: context.localRepositoryPath,
        verifiedRemoteRepositoryURL: context.remoteRepositoryURL,
        verifiedProvider: 'fixture', verifiedConnection: 'connection-a',
        verifiedRepositoryRef: 'repo-a', verifiedRevision: 'a'.repeat(40),
        verifiedDefaultBranchRef: 'refs/heads/main', verifiedObservedAt: observedAt,
        verifiedEvidenceRef: 'reference-a',
      }),
    });
    records.push(await store.observeRepository({
      workItemId: f.workItemId, repositoryId: 'primary',
      localRepositoryPath: f.repo, remoteRepositoryURL: url,
      provider: 'fixture', connection: 'connection-a', repositoryRef: 'repo-a',
      revision: 'a'.repeat(40), defaultBranchRef: 'refs/heads/main',
      observedAt, evidenceRef: 'reference-a',
    }));
    assert.equal((await store.records(f.workItemId))
      .find(record => record.id === records.at(-1).id).localRepositoryPath, f.repo);
  }
  assert.notEqual(records[0].id, records[1].id);
});

test('T-111 schema1 historical records stay readable while new repository and PR observations validate exact fields', () => {
  const localRepositoryPath = path.resolve('fixture', 'checkout');
  const remoteRepositoryURL = 'https://git.example.invalid/team/repo.git';
  const observation = {
    localRepositoryPath, remoteRepositoryURL, provider: 'fixture',
    connection: 'connection-a', repositoryRef: 'repo-a',
    revision: 'a'.repeat(40), defaultBranchRef: 'refs/heads/main',
    observedAt: '2026-09-08T00:00:00.000Z', evidenceRef: 'read-a',
  };
  const verification = {
    canonicalLocalRepositoryPath: localRepositoryPath,
    verifiedRemoteRepositoryURL: remoteRepositoryURL,
    verifiedProvider: 'fixture', verifiedConnection: 'connection-a',
    verifiedRepositoryRef: 'repo-a',
  };
  const repository = {
    type: 'repository-observation',
    id: repositoryObservationKey(observation, verification),
    workItemId: 'wi-example', repositoryId: 'primary', ...observation,
  };
  assert.equal(validateRecord(repository), repository);
  assert.throws(() => validateRecord({ ...repository, unexpected: true }), { code: 'INPUT' });
  assert.throws(() => validateRecord({ ...repository, evidenceRef: 'other' }), { code: 'SCHEMA' });
  const pr = {
    ...observation, pullRequestRef: 'pr-5',
    sourceRepositoryURL: 'https://git.example.invalid/team/fork.git',
    sourceBranchRef: 'refs/heads/main', targetBranchRef: 'refs/heads/main',
    sourceRevision: 'b'.repeat(40), targetRevision: 'c'.repeat(40),
    state: 'active', sequence: 1,
  };
  delete pr.revision; delete pr.defaultBranchRef;
  const prRecord = {
    type: 'pr-observation', id: pullRequestObservationKey(pr, {
      ...verification, verifiedPullRequestRef: pr.pullRequestRef,
      verifiedSourceRepositoryURL: pr.sourceRepositoryURL,
    }),
    workItemId: 'wi-example', repositoryId: 'primary', ...pr,
  };
  assert.equal(validateRecord(prRecord), prRecord);
  assert.throws(() => validateRecord({ ...prRecord, sequence: 2 }), { code: 'SCHEMA' });
  const historical = { type: 'pr', id: 'pr-historical', workItemId: 'wi-example',
    provider: 'fixture', connection: 'connection-a', repositoryId: 'primary',
    sourceRef: 'refs/heads/main', targetRef: 'refs/heads/main',
    sourceRevision: 'b'.repeat(40), targetRevision: 'c'.repeat(40),
    prId: '5', state: 'active' };
  const before = JSON.stringify(historical);
  assert.equal(validateRecord(historical), historical);
  assert.equal(JSON.stringify(historical), before);
});

test('T-111 old decisions, actions, runs, artifacts, PRs, audits and tests load byte-for-byte without new STAGING credit', async t => {
  const f = await fixture(t);
  const { event } = await grant(f, 'scope-inclusion',
    { itemId: 'historical-item' });
  const run = await attachMonitor(f.store, {
    identity: {
      provider: 'azure-devops', connection: 'fixture',
      scopeRef: 'project-id:repository-id', definitionRef: '17',
      executionRef: 'historical-run',
    },
    origin: 'framework', schedulerAvailable: true, readAvailable: true,
  });
  assert.equal(run.identity.attemptKind, undefined);
  const cycle = {
    type: 'cycle', id: 'cycle-historical', workItemId: f.workItemId,
    generation: 1, candidateDigest: digest('old candidate'),
    sources: [], configDigest: digest('old config'),
    testSpecDigest: digest('old plan'),
    tests: [{
      id: 'T-historical-staging', environment: 'STAGING',
      owner: 'user', location: 'authorized-machine',
      implementation: 'historical-suite',
    }],
    results: { 'T-historical-staging': 'evidence-historical' },
    artifacts: { STAGING: 'artifact-historical' },
    deployments: { STAGING: 'op-historical-deployment' },
  };
  const oldRecords = [
    cycle,
    {
      type: 'operation', id: 'op-historical-action',
      workItemId: f.workItemId, repositoryId: 'primary', class: 'build',
      action: { class: 'build' }, target: 'historical-build',
      status: 'succeeded', correlationKey: 'old-build',
      requestFingerprint: digest('old build request'), dispatchBound: true,
      handle: 'historical-run', evidenceRef: 'fixture:old-run',
    },
    {
      type: 'operation', id: 'op-historical-deployment',
      workItemId: f.workItemId, repositoryId: 'primary', class: 'deploy',
      action: { class: 'deploy', environment: 'STAGING',
        target: 'staging-target', artifactId: 'old-package',
        configDigest: cycle.configDigest },
      target: 'staging-target', status: 'succeeded',
      correlationKey: 'old-deploy', requestFingerprint: digest('old deploy request'),
      dispatchBound: true, cycleId: cycle.id,
      candidateDigest: cycle.candidateDigest, artifactId: 'old-package',
      evidenceRef: 'fixture:old-deployment',
    },
    {
      type: 'artifact', id: 'artifact-historical', workItemId: f.workItemId,
      sequence: 1, cycleId: cycle.id, artifactId: 'old-package',
      environment: 'STAGING', sourceDigest: cycle.candidateDigest,
      configDigest: cycle.configDigest, buildRunId: 'historical-run',
      name: 'package', artifactType: 'archive',
      evidenceRef: 'fixture:old-artifact', status: 'succeeded',
    },
    {
      type: 'pr', id: 'pr-historical-read', workItemId: f.workItemId,
      provider: 'azure-devops', connection: 'fixture', repositoryId: 'primary',
      sourceRef: 'refs/heads/feature', targetRef: 'refs/heads/main',
      sourceRevision: 'a'.repeat(40), targetRevision: 'b'.repeat(40),
      prId: '17', state: 'active', evidenceRef: 'fixture:old-pr',
    },
    {
      type: 'test-evidence', id: 'evidence-historical',
      workItemId: f.workItemId, cycleId: cycle.id,
      testId: 'T-historical-staging', testSpecDigest: cycle.testSpecDigest,
      candidateDigest: cycle.candidateDigest, environment: 'STAGING',
      implementation: 'historical-suite', status: 'Passed',
      observedAt: new Date(f.clock.now()).toISOString(),
      activity: 'complete', evidenceRef: 'fixture:old-test',
      artifactId: 'old-package', deploymentId: 'op-historical-deployment',
      owner: 'user', host: 'authorized-machine',
    },
  ];
  for (const record of oldRecords) assert.equal(validateRecord(record), record);
  const oldAudit = await formatAudit(f.store, f.workItemId, [event.id]);
  await f.runGit('add', '.sdlc');
  await f.runGit('commit', '-qm', `Audit historical scope decision\n\n${oldAudit.trailers}`);
  const oldCommit = await f.runGit('rev-parse', 'HEAD');
  assert.deepEqual((await recordAudit(f.store, {
    workItemId: f.workItemId, repositoryId: 'primary', commit: oldCommit,
  })).verified, [event.id]);
  const oldReference = (await f.store.records(f.workItemId)).find(record =>
    record.type === 'audit-reference' && record.eventId === event.id);
  assert.equal(oldReference.commit, oldCommit);
  const storedBytes = ids => Promise.all(ids.map(id =>
    fs.readFile(f.store.recordPath(f.workItemId, id))));
  const oldAuditBytes = await storedBytes([event.id, oldReference.id]);
  const newDecision = await grant(f, 'scope-inclusion', { itemId: 'current-item' });
  const newRepository = await observeFixtureRepository(f);
  const newAudit = await formatAudit(f.store, f.workItemId, [newDecision.event.id]);
  await f.runGit('commit', '--allow-empty', '-qm',
    `Audit current scope decision\n\n${newAudit.trailers}`);
  const newCommit = await f.runGit('rev-parse', 'HEAD');
  assert.deepEqual((await recordAudit(f.store, {
    workItemId: f.workItemId, repositoryId: 'primary', commit: newCommit,
  })).verified, [newDecision.event.id]);
  const newReference = (await f.store.records(f.workItemId)).find(record =>
    record.type === 'audit-reference' && record.eventId === newDecision.event.id);
  assert.deepEqual(await storedBytes([event.id, oldReference.id]), oldAuditBytes);
  await f.store.transaction(f.workItemId, tx => {
    for (const record of oldRecords) tx.put(record);
  });
  const oldIds = [event.id, oldReference.id, ...oldRecords.map(record => record.id)];
  const oldBytes = await storedBytes(oldIds);
  const ids = [...oldIds, newDecision.event.id, newRepository.id, newReference.id];
  const before = await storedBytes(ids);
  const checkpointPath = path.join(f.store.workPath(f.workItemId), 'checkpoint.json');
  const checkpointBefore = await fs.readFile(checkpointPath);
  const monitorPath = path.join(f.store.runtime, 'pipeline-monitors', `${run.key}.json`);
  const monitorBefore = await fs.readFile(monitorPath);
  const recoveryToken = await f.store.beginRecovery(f.workItemId);
  const reopened = await new Store(f.home, { clock: f.clock }).ready();
  const loaded = await reopened.load(f.workItemId);
  assert.equal(loaded.recoveryRequired, true);
  const historical = await reopened.records(f.workItemId);
  assert.deepEqual(historical.filter(record => ids.includes(record.id))
    .map(record => record.id).sort(), [...ids].sort());
  for (const record of oldRecords) assert.deepEqual(
    historical.find(item => item.id === record.id), record);
  assert.equal(historical.find(item => item.id === event.id).digest, event.digest);
  assert.deepEqual(historical.find(item => item.id === oldReference.id), oldReference);
  assert.equal(historical.find(item => item.id === newRepository.id).remoteRepositoryURL,
    'https://example.invalid/repository.git');
  assert.deepEqual(await readMonitor(reopened, run.key), run);
  const credited = state => {
    const current = currentCycle(state.records, state.checkpoint);
    assert.equal(current.id, cycle.id);
    return {
      artifact: currentArtifact(current, state.records,
        state.records.find(record => record.id === 'artifact-historical')),
      deployment: currentDeployment(current, state.records,
        state.records.find(record => record.id === 'op-historical-deployment'),
        'STAGING'),
      test: currentTestEvidence(current, state.records, current.tests[0], f.clock),
      stage: stagePassed(current, state.records, 'STAGING', f.clock),
      operations: state.records.filter(record => record.type === 'operation')
        .map(record => ({ id: record.id, status: record.status })).sort((a, b) =>
          a.id.localeCompare(b.id)),
      testEvidence: state.records.filter(record => record.type === 'test-evidence')
        .map(record => ({ id: record.id, status: record.status })),
    };
  };
  const beforeCredit = credited(loaded);
  assert.deepEqual(beforeCredit, {
    artifact: false, deployment: false, test: null, stage: false,
    operations: [
      { id: 'op-historical-action', status: 'succeeded' },
      { id: 'op-historical-deployment', status: 'succeeded' },
    ],
    testEvidence: [{ id: 'evidence-historical', status: 'Passed' }],
  });
  const auditBefore = await replayAudit(f.store, f.workItemId);
  const auditAfter = await replayAudit(reopened, f.workItemId);
  for (const replay of [auditBefore, auditAfter]) {
    assert.deepEqual(replay.events.map(record => ({
      id: record.id, sequence: record.sequence,
    })), [
      { id: event.id, sequence: event.sequence },
      { id: newDecision.event.id, sequence: newDecision.event.sequence },
    ]);
    assert.deepEqual(replay.locations.map(entry => ({
      eventId: entry.eventId, commit: entry.commit,
    })), [
      { eventId: event.id, commit: oldCommit },
      { eventId: newDecision.event.id, commit: newCommit },
    ]);
    assert.deepEqual(replay.gaps, []);
  }
  assert.deepEqual(credited(await reopened.load(f.workItemId)), beforeCredit);
  assert.deepEqual(await storedBytes(oldIds), oldBytes);
  assert.deepEqual(await storedBytes(ids), before);
  assert.deepEqual(await fs.readFile(checkpointPath), checkpointBefore);
  assert.deepEqual(await fs.readFile(monitorPath), monitorBefore);
  await reopened.completeRecovery(f.workItemId, recoveryToken);
  assert.equal((await reopened.load(f.workItemId)).recoveryRequired, false);
  assert.deepEqual(credited(await reopened.load(f.workItemId)), beforeCredit);
});

test('--evidence-file is a valued monitor-observe-only option and cannot override a JSON path', async t => {
  assert.deepEqual(parseArguments(['monitor', 'observe', '--evidence-file', 'observation.json'])
    .flags, { 'evidence-file': 'observation.json' });
  assert.throws(() => parseArguments(['monitor', 'observe', '--evidence-file']), { code: 'INPUT' });
  const f = await fixture(t);
  await assert.rejects(runCli(['monitor', 'observe',
    '--evidence-file', 'intended.json', '--home', f.home,
    '--cwd', f.repo], {
    stdin: { isTTY: false, async *[Symbol.asyncIterator]() {
      yield JSON.stringify({ evidenceFilePath: 'different.json' });
    } },
  }), { code: 'INPUT' });
  await assert.rejects(runCli(['monitor', 'observe', '--home', f.home,
    '--cwd', f.repo], {
    stdin: { isTTY: false, async *[Symbol.asyncIterator]() {
      yield JSON.stringify({ evidenceFilePath: 'different.json' });
    } },
  }), { code: 'INPUT' });
  assert.equal((await fs.readdir(f.root)).includes('different.json'), false);
});
