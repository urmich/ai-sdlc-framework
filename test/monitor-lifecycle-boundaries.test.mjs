import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './helpers.mjs';
import { canonical, digest } from '../src/core.mjs';
import { writeJson } from '../src/files.mjs';
import {
  associateMonitor, attachMonitor, beginPoll, claimMonitor, dueMonitors,
  interruptMonitor, monitorNotice, observeMonitor, pruneMonitor, readActiveMonitor,
  readMonitor, verifyMonitorLink,
} from '../src/monitors.mjs';
import { registerProviderAdapter } from '../src/provider-adapters.mjs';
import { pullRequestObservationKey } from '../src/repository-observations.mjs';

registerProviderAdapter({ id: 'fixture', attemptCapability: 'none',
  linkKinds: ['summary'], normalizeLinkObservation: observation => observation });

const serializedSize = record => Buffer.byteLength(`${canonical(record)}\n`);
const activePath = (f, key) => path.join(f.store.runtime,
  'pipeline-monitors', `${key}.json`);

async function terminalMonitor(f, { bytes, summary = 'Verified terminal result.',
  workItemId, executionRef = 'lifecycle-boundary', checkResults } = {}) {
  const identity = {
    provider: 'fixture', connection: bytes ? 'c'.repeat(512) : 'connection',
    scopeRef: bytes ? 's'.repeat(512) : 'scope',
    definitionRef: bytes ? 'd'.repeat(512) : 'definition',
    executionRef, attemptKind: 'not-applicable',
  };
  const attached = await attachMonitor(f.store, {
    identity, origin: 'framework', schedulerAvailable: true, readAvailable: true,
    ...(workItemId === undefined ? {} : { workItemId }),
  });
  const claimed = await claimMonitor(f.store, {
    runKey: attached.key, workerId: 'lifecycle-worker',
  });
  const worker = { runKey: attached.key, workerId: claimed.workerId,
    claimGeneration: claimed.claimGeneration };
  const poll = await beginPoll(f.store, worker);
  const content = Buffer.from('Immutable terminal proof.');
  const evidenceFilePath = path.join(f.root, `${executionRef}.bin`);
  await fs.writeFile(evidenceFilePath, content);
  const evidence = { summary, reference: {
    locator: 'fixture:terminal',
    retrievalContext: { provider: 'fixture', connection: 'connection',
      scopeRef: 'scope', retrievedAt: new Date(f.clock.now()).toISOString() },
    sha256: digest(content),
  } };
  const predicted = {
    ...poll, revision: poll.revision + 1, runStatus: 'succeeded',
    monitorStatus: 'completed', inFlight: false, nextPollAt: null,
    lastSuccessfulPollAt: new Date(f.clock.now()).toISOString(),
    notice: { status: 'pending', kind: 'terminal',
      generation: poll.notice.generation + 1 },
    evidence, evidenceVerification: { verified: true, identity: 'sha256' },
    ...(checkResults === undefined ? {} : { checkResults }),
  };
  if (bytes !== undefined) {
    for (const [object, key] of [
      [evidence, 'summary'], [evidence.reference, 'locator'],
      [evidence.reference.retrievalContext, 'scopeRef'],
      [evidence.reference.retrievalContext, 'connection'],
    ]) {
      const remaining = bytes - serializedSize(predicted);
      assert.ok(remaining >= 0, 'The initial public observation must fit the target');
      object[key] += 'x'.repeat(Math.min(remaining, 512 - object[key].length));
    }
    assert.equal(serializedSize(predicted), bytes, 'Fixture must reach the exact boundary');
  }
  if (checkResults !== undefined) f.store.verifyCheckResults = () => ({
    identity, status: 'succeeded', evidenceReference: evidence.reference,
    checkResults,
  });
  const observed = await observeMonitor(f.store, {
    ...worker, pollGeneration: poll.pollGeneration, identity, status: 'succeeded',
    evidence, evidenceFilePath,
    ...(checkResults === undefined ? {} : { checkResults }),
  });
  assert.deepEqual(observed, predicted);
  assert.deepEqual(observed.evidenceVerification, { verified: true, identity: 'sha256' });
  assert.equal((await fs.stat(activePath(f, attached.key))).size, serializedSize(observed));
  return { key: attached.key, observed, evidence };
}

async function deliver(store, key, deliveredRef = 'fixture:delivered') {
  const pending = await monitorNotice(store, { runKey: key });
  assert.equal(pending.notice.kind, 'terminal');
  assert.equal(pending.notice.status, 'pending');
  return monitorNotice(store, {
    runKey: key, noticeGeneration: pending.notice.generation, deliveredRef,
  });
}

async function recordUnrelatedHistory(f, { complete = false } = {}) {
  await f.store.transaction(f.workItemId, tx => {
    tx.put({
      type: 'operation', id: 'op-unrelated-history', workItemId: f.workItemId,
      repositoryId: 'primary', class: 'build', action: { class: 'build' },
      target: 'fixture-build', status: 'succeeded', correlationKey: 'unrelated-action',
      requestFingerprint: digest('unrelated-action'), dispatchBound: true,
      evidenceRef: 'fixture:unrelated-history',
    });
    if (complete) tx.checkpoint.lifecycleStatus = 'completed';
  });
}

test('T-125 public observe accepts 4086 bytes and terminal notice delivery must still permit pruning', async t => {
  const f = await fixture(t, { initialize: false });
  const { key, evidence } = await terminalMonitor(f, { bytes: 4086 });
  const delivered = await deliver(f.store, key, 'x');
  assert.equal(delivered.notice.status, 'delivered');
  assert.ok((await fs.stat(activePath(f, key))).size <= 4096);
  assert.deepEqual((await readMonitor(f.store, key)).evidence, evidence);
  assert.equal((await pruneMonitor(f.store, { runKey: key })).archived, true);
  assert.deepEqual((await readMonitor(f.store, key)).evidence, evidence);
  assert.equal((await monitorNotice(f.store, { runKey: key })).notice.evidenceRef, 'x');
});

test('T-126 standalone terminal monitor archives despite an unrelated completed repository being removed', async t => {
  const f = await fixture(t);
  await recordUnrelatedHistory(f, { complete: true });
  await fs.rename(f.repo, path.join(f.root, 'retired repository'));
  await assert.rejects(f.store.load(f.workItemId), error =>
    ['ENOENT', 'GIT'].includes(error.code), 'The live checkout is genuinely unavailable');
  const { key, evidence } = await terminalMonitor(f);
  await deliver(f.store, key);
  assert.equal((await pruneMonitor(f.store, { runKey: key })).archived, true);
  assert.deepEqual((await readMonitor(f.store, key)).evidence, evidence);
});

async function assertBoundedFiles(f, key) {
  for (const directory of ['pipeline-monitors', 'pipeline-monitor-notices',
    path.join('pipeline-monitors', 'archive')]) {
    let names;
    try { names = await fs.readdir(path.join(f.store.runtime, directory)); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      continue;
    }
    for (const name of names.filter(name => name.startsWith(key) &&
      name.endsWith('.json'))) {
      const file = path.join(f.store.runtime, directory, name);
      const bytes = await fs.readFile(file);
      assert.ok(bytes.length <= 4096);
      assert.equal(serializedSize(JSON.parse(bytes)), bytes.length);
    }
  }
}

for (const bytes of [4095, 4096]) {
  test(`T-125 existing ${bytes}-byte terminal observation retains multibyte proof and a 512-character delivery reference`, async t => {
    const f = await fixture(t, { initialize: false });
    const { key, observed, evidence } = await terminalMonitor(f, {
      bytes, summary: '\u754c'.repeat(100),
    });
    const original = await fs.readFile(activePath(f, key));
    const deliveredRef = `fixture:${'\u754c'.repeat(504)}`;
    assert.equal(deliveredRef.length, 512);
    const delivered = await deliver(f.store, key, deliveredRef);
    assert.equal(delivered.notice.evidenceRef, deliveredRef);
    assert.deepEqual(await fs.readFile(activePath(f, key)), original);
    assert.deepEqual((await readActiveMonitor(f.store, key)).evidence, evidence);
    assert.deepEqual((await readActiveMonitor(f.store, key)).evidenceVerification,
      observed.evidenceVerification);
    await assertBoundedFiles(f, key);
    f.clock.advance(60000);
    const replay = await monitorNotice(f.store, {
      runKey: key, noticeGeneration: delivered.notice.generation, deliveredRef,
    });
    assert.deepEqual(replay, delivered);
    assert.equal((await pruneMonitor(f.store, { runKey: key })).archived, true);
    assert.equal(await readActiveMonitor(f.store, key), null);
    const archivedPath = path.join(f.store.runtime, 'pipeline-monitors',
      'archive', `${key}.json`);
    assert.deepEqual(await fs.readFile(archivedPath), original);
    assert.deepEqual(await monitorNotice(f.store, {
      runKey: key, noticeGeneration: delivered.notice.generation, deliveredRef,
    }), delivered);
    assert.deepEqual(await attachMonitor(f.store, {
      identity: observed.identity, origin: 'framework',
      schedulerAvailable: true, readAvailable: true,
    }), await readMonitor(f.store, key));
    assert.deepEqual((await readMonitor(f.store, key)).evidence, evidence);
    await assertBoundedFiles(f, key);
    assert.deepEqual(await dueMonitors(f.store), []);
  });
}

test('T-125 a 4097-byte public observation is rejected without replacing the in-flight poll', async t => {
  const f = await fixture(t, { initialize: false });
  await assert.rejects(terminalMonitor(f, { bytes: 4097 }), { code: 'CAPACITY' });
  const names = await fs.readdir(path.join(f.store.runtime, 'pipeline-monitors'));
  const record = JSON.parse(await fs.readFile(path.join(f.store.runtime,
    'pipeline-monitors', names.find(name => name.endsWith('.json')))));
  assert.equal(record.inFlight, true);
  assert.equal(record.runStatus, 'unknown');
  assert.equal(record.notice.kind, 'attached');
  assert.equal(record.evidence, undefined);
});

for (const bytes of [undefined, 4096]) {
  test(`T-125 ${bytes ?? 'small'}-byte acknowledgment is exactly replayable and concurrent duplicates do not issue another notice`, async t => {
    const f = await fixture(t, { initialize: false });
    const { key, observed } = await terminalMonitor(f, { bytes });
    const input = { runKey: key, noticeGeneration: observed.notice.generation,
      deliveredRef: 'fixture:one-delivery' };
    const [first, second] = await Promise.all([
      monitorNotice(f.store, input), monitorNotice(f.store, input),
    ]);
    assert.deepEqual(first, second);
    f.clock.advance(60000);
    assert.deepEqual(await monitorNotice(f.store, input), first);
    await assert.rejects(monitorNotice(f.store, {
      ...input, deliveredRef: 'fixture:different-delivery',
    }), { code: 'ID_CONFLICT' });
    await assert.rejects(monitorNotice(f.store, {
      ...input, noticeGeneration: observed.notice.generation - 1,
    }), { code: 'STALE' });
    assert.deepEqual(await monitorNotice(f.store, { runKey: key }), first);
    assert.deepEqual(await dueMonitors(f.store), []);
    await assertBoundedFiles(f, key);
  });
}

test('T-125 conflicting concurrent acknowledgments preserve exactly one delivery identity', async t => {
  const f = await fixture(t, { initialize: false });
  const { key, observed } = await terminalMonitor(f, { bytes: 4096 });
  const results = await Promise.allSettled(['first', 'second'].map(name =>
    monitorNotice(f.store, { runKey: key,
      noticeGeneration: observed.notice.generation, deliveredRef: `fixture:${name}` })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'ID_CONFLICT');
  assert.deepEqual(await monitorNotice(f.store, { runKey: key }),
    results.find(result => result.status === 'fulfilled').value);
});

for (const stage of ['written', 'replaced']) {
  test(`T-125 delivery write failure at ${stage} leaves proof intact and retry reconciles only durable acknowledgment`, async t => {
    const f = await fixture(t, { initialize: false });
    const { key, observed } = await terminalMonitor(f, { bytes: 4096 });
    const original = await fs.readFile(activePath(f, key));
    const input = { runKey: key, noticeGeneration: observed.notice.generation,
      deliveredRef: 'fixture:faulted-delivery' };
    f.store.fault = point => {
      if (point === stage) throw Object.assign(new Error('Injected delivery write failure'),
        { code: 'FIXTURE_IO' });
    };
    await assert.rejects(monitorNotice(f.store, input), { code: 'FIXTURE_IO' });
    assert.deepEqual(await fs.readFile(activePath(f, key)), original);
    const afterFailure = await monitorNotice(f.store, { runKey: key });
    assert.equal(afterFailure.notice.status, stage === 'written' ? 'pending' : 'delivered');
    f.store.fault = async () => {};
    f.clock.advance(60000);
    const retried = await monitorNotice(f.store, input);
    assert.equal(retried.notice.status, 'delivered');
    if (stage === 'replaced') assert.deepEqual(retried, afterFailure);
    assert.equal((await pruneMonitor(f.store, { runKey: key })).archived, true);
    await assertBoundedFiles(f, key);
  });
}

test('T-125 invalid acknowledgment fails before persistence and does not consume the notice', async t => {
  const f = await fixture(t, { initialize: false });
  const { key, observed } = await terminalMonitor(f, { bytes: 4096 });
  const original = await fs.readFile(activePath(f, key));
  for (const [deliveredRef, code] of [
    ['', 'INPUT'], ['x'.repeat(513), 'INPUT'],
    ['Authorization: synthetic-value', 'UNSAFE'],
  ]) {
    await assert.rejects(monitorNotice(f.store, { runKey: key,
      noticeGeneration: observed.notice.generation, deliveredRef }), { code });
    assert.deepEqual(await fs.readFile(activePath(f, key)), original);
    assert.equal((await monitorNotice(f.store, { runKey: key })).notice.status, 'pending');
  }
  await deliver(f.store, key);
});

test('T-125 delivery receipts cannot acknowledge a later notice or lose a concurrent prune race', async t => {
  const f = await fixture(t, { initialize: false });
  const { key, observed } = await terminalMonitor(f, { bytes: 4096 });
  const input = { runKey: key, noticeGeneration: observed.notice.generation,
    deliveredRef: 'fixture:racing-delivery' };
  const [acknowledgment, pruning] = await Promise.allSettled([
    monitorNotice(f.store, input), pruneMonitor(f.store, { runKey: key }),
  ]);
  assert.equal(acknowledgment.status, 'fulfilled');
  if (pruning.status === 'rejected') {
    assert.equal(pruning.reason.code, 'MONITOR');
    assert.equal((await pruneMonitor(f.store, { runKey: key })).archived, true);
  } else assert.equal(pruning.value.archived, true);
  assert.deepEqual(await monitorNotice(f.store, input), acknowledgment.value);
  const small = await terminalMonitor(f, { executionRef: 'new-notice' });
  const first = await deliver(f.store, small.key);
  await interruptMonitor(f.store, { runKey: small.key, reason: 'Explicit interruption notice' });
  const next = await monitorNotice(f.store, { runKey: small.key });
  assert.equal(next.notice.status, 'pending');
  assert.equal(next.notice.generation, first.notice.generation + 1);
  await assert.rejects(monitorNotice(f.store, { runKey: small.key,
    noticeGeneration: first.notice.generation, deliveredRef: first.notice.evidenceRef }),
  { code: 'STALE' });
});

for (const damage of ['wrong identity', 'wrong notice', 'invalid JSON', 'missing evidence']) {
  test(`T-125 a delivery receipt with ${damage} remains an explicit gap and cannot permit archival`, async t => {
    const f = await fixture(t, { initialize: false });
    const { key, observed } = await terminalMonitor(f, { bytes: 4096 });
    const original = await fs.readFile(activePath(f, key));
    await deliver(f.store, key);
    const receiptPath = path.join(f.store.runtime, 'pipeline-monitor-notices',
      `${key}-${observed.notice.generation}.json`);
    const receipt = JSON.parse(await fs.readFile(receiptPath));
    if (damage === 'wrong identity') receipt.identityDigest = '0'.repeat(64);
    if (damage === 'wrong notice') receipt.notice.generation++;
    if (damage === 'missing evidence') delete receipt.notice.evidenceRef;
    if (damage === 'invalid JSON') await fs.writeFile(receiptPath, '{');
    else await writeJson(receiptPath, receipt);
    const code = damage === 'invalid JSON' ? 'JSON' :
      damage === 'missing evidence' ? 'INPUT' : 'EVIDENCE';
    await assert.rejects(readMonitor(f.store, key), { code });
    await assert.rejects(pruneMonitor(f.store, { runKey: key }), { code });
    assert.deepEqual(await fs.readFile(activePath(f, key)), original);
  });
}

test('T-126 an unrelated completed checkout changing branch cannot block a work-linked but unreferenced monitor', async t => {
  const f = await fixture(t);
  await recordUnrelatedHistory(f, { complete: true });
  const { key } = await terminalMonitor(f, { workItemId: f.workItemId });
  await deliver(f.store, key);
  await f.runGit('symbolic-ref', 'HEAD', 'refs/heads/switched');
  await assert.rejects(f.store.load(f.workItemId), { code: 'BINDING' });
  assert.equal((await pruneMonitor(f.store, { runKey: key })).archived, true);
  await assert.rejects(f.store.load(f.workItemId), { code: 'BINDING' });
});

for (const status of ['succeeded', 'uncertain']) {
  test(`T-126 a genuinely referenced ${status} action retains its monitor even when its checkout is retired`, async t => {
    const f = await fixture(t);
    const { key, evidence } = await terminalMonitor(f, { workItemId: f.workItemId });
    await deliver(f.store, key);
    await f.store.transaction(f.workItemId, tx => tx.put({
      type: 'operation', id: 'op-monitor-consumer', workItemId: f.workItemId,
      repositoryId: 'primary', class: 'build', action: { class: 'build' },
      target: 'fixture-build', status, correlationKey: 'fixture-action',
      requestFingerprint: digest('fixture-action'), dispatchBound: true,
      evidenceRef: key,
    }));
    await fs.rename(f.repo, path.join(f.root, 'retired repository'));
    await assert.rejects(pruneMonitor(f.store, { runKey: key }), { code: 'MONITOR' });
    assert.deepEqual((await readActiveMonitor(f.store, key)).evidence, evidence);
    assert.equal((await f.store.records(f.workItemId)).find(record =>
      record.id === 'op-monitor-consumer').status, status);
  });
}

test('T-126 a current PR association retains a terminal monitor after its live checkout is removed', async t => {
  const f = await fixture(t);
  const observation = {
    localRepositoryPath: f.repo, remoteRepositoryURL: 'https://example.invalid/repository.git',
    provider: 'fixture', connection: 'connection', repositoryRef: 'repository-id',
    pullRequestRef: 'pr-current', sourceBranchRef: 'refs/heads/feature',
    targetBranchRef: 'refs/heads/main', sourceRevision: 'a'.repeat(40),
    targetRevision: 'b'.repeat(40), state: 'active', sequence: 1,
    observedAt: new Date(f.clock.now()).toISOString(), evidenceRef: 'fixture:pr-read',
  };
  const pr = { type: 'pr-observation', workItemId: f.workItemId,
    repositoryId: 'primary', ...observation,
    id: pullRequestObservationKey(observation, {
      canonicalLocalRepositoryPath: f.repo,
      verifiedRemoteRepositoryURL: observation.remoteRepositoryURL,
      verifiedProvider: observation.provider, verifiedConnection: observation.connection,
      verifiedRepositoryRef: observation.repositoryRef,
      verifiedPullRequestRef: observation.pullRequestRef,
    }) };
  await f.store.transaction(f.workItemId, tx => tx.put(pr));
  const result = {
    requiredCheckRef: 'build', checkResultRef: 'result-current', producerRef: 'definition',
    testedRevision: pr.sourceRevision, evidenceRef: 'fixture:check-read', status: 'succeeded',
    localRepositoryPath: f.repo, remoteRepositoryURL: pr.remoteRepositoryURL,
    repositoryRef: pr.repositoryRef, pullRequestRef: pr.pullRequestRef,
    sourceRevision: pr.sourceRevision, targetRevision: pr.targetRevision,
  };
  const { key, observed, evidence } = await terminalMonitor(f, {
    workItemId: f.workItemId, checkResults: [result],
  });
  await verifyMonitorLink(f.store, {
    runKey: key, adapterId: 'fixture', evidenceRef: 'fixture:run-page',
    observation: { identity: observed.identity, accessible: true,
      url: 'https://example.invalid/runs/lifecycle-boundary', kind: 'summary' },
  });
  await deliver(f.store, key);
  const association = await associateMonitor(f.store, {
    runKey: key, workItemId: f.workItemId, prRecordId: pr.id, prObservationKey: pr.id,
    localRepositoryPath: f.repo, remoteRepositoryURL: pr.remoteRepositoryURL,
    checkId: result.requiredCheckRef, requiredCheckRef: result.requiredCheckRef,
    checkResultRef: result.checkResultRef, producerRef: result.producerRef,
    testedRevision: result.testedRevision, sourceRevision: pr.sourceRevision,
    targetRevision: pr.targetRevision, evidenceRef: result.evidenceRef, evidence,
  });
  await fs.rename(f.repo, path.join(f.root, 'retired repository'));
  await assert.rejects(pruneMonitor(f.store, { runKey: key }), { code: 'MONITOR' });
  assert.equal(association.runKey, key);
  assert.deepEqual((await readActiveMonitor(f.store, key)).evidence, evidence);
});

for (const damage of ['missing checkpoint', 'corrupt checkpoint', 'missing binding', 'corrupt binding',
  'missing records', 'corrupt record', 'missing referenced record', 'recovery']) {
  test(`T-126 ${damage} in durable dependency state cannot be treated as an absent consumer`, async t => {
    const f = await fixture(t);
    await recordUnrelatedHistory(f);
    const { key, evidence } = await terminalMonitor(f);
    await deliver(f.store, key);
    const workPath = f.store.workPath(f.workItemId);
    let code;
    if (damage === 'missing checkpoint') {
      await fs.unlink(path.join(workPath, 'checkpoint.json'));
      code = 'RECOVERY';
    } else if (damage === 'corrupt checkpoint') {
      await fs.writeFile(path.join(workPath, 'checkpoint.json'), '{');
      code = 'JSON';
    } else if (damage === 'missing binding') {
      await fs.unlink(path.join(workPath, 'binding.json'));
      code = 'ENOENT';
    } else if (damage === 'corrupt binding') {
      const binding = await f.store.metadata(f.workItemId);
      binding.members = [];
      await writeJson(path.join(workPath, 'binding.json'), binding);
      code = 'BINDING';
    } else if (damage === 'missing records') {
      await fs.rename(path.join(workPath, 'records'), path.join(workPath, 'retired-records'));
      code = 'RECOVERY';
    } else if (damage === 'corrupt record') {
      await fs.writeFile(path.join(workPath, 'records', 'corrupt.json'), '{');
      code = 'JSON';
    } else if (damage === 'missing referenced record') {
      await f.store.transaction(f.workItemId, tx => tx.put({
        type: 'operation', id: 'op-missing-consumer', workItemId: f.workItemId,
        repositoryId: 'primary', class: 'build', action: { class: 'build' },
        target: 'fixture-build', status: 'uncertain', correlationKey: 'fixture-action',
        requestFingerprint: digest('fixture-action'), dispatchBound: true, evidenceRef: key,
      }));
      await fs.unlink(f.store.recordPath(f.workItemId, 'op-missing-consumer'));
      code = 'RECOVERY';
    } else {
      await f.store.beginRecovery(f.workItemId);
      code = 'RECOVERY';
    }
    await fs.rename(f.repo, path.join(f.root, 'retired repository'));
    await assert.rejects(pruneMonitor(f.store, { runKey: key }), { code });
    assert.deepEqual((await readActiveMonitor(f.store, key)).evidence, evidence);
  });
}

for (const damage of ['invalid JSON', 'missing identities']) {
  test(`T-126 association ${damage} cannot hide a possible monitor dependency`, async t => {
    const f = await fixture(t, { initialize: false });
    const { key, evidence } = await terminalMonitor(f);
    await deliver(f.store, key);
    const directory = path.join(f.store.runtime, 'pipeline-monitor-associations');
    await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, 'damaged.json'),
      damage === 'invalid JSON' ? '{' : '{}\n');
    await assert.rejects(pruneMonitor(f.store, { runKey: key }),
      { code: damage === 'invalid JSON' ? 'JSON' : 'INPUT' });
    assert.deepEqual((await readActiveMonitor(f.store, key)).evidence, evidence);
  });
}

for (const [label, content] of [
  ['null', 'null\n'], ['false', 'false\n'], ['0', '0\n'],
  ['empty object', '{}\n'], ['corrupt JSON', '{'], ['missing', undefined],
]) {
  test(`T-126 recovery marker presence (${label}) controls public prune regardless of parsed truthiness`, async t => {
    const f = await fixture(t);
    await recordUnrelatedHistory(f, { complete: true });
    const markerPath = f.store.recoveryPath(f.workItemId);
    if (content !== undefined) await fs.writeFile(markerPath, content);
    assert.equal((await f.store.load(f.workItemId)).recoveryRequired,
      content !== undefined);
    await fs.rename(f.repo, path.join(f.root, 'retired repository'));
    const { key, evidence } = await terminalMonitor(f);
    await deliver(f.store, key);
    const original = await fs.readFile(activePath(f, key));
    if (content !== undefined) {
      await assert.rejects(pruneMonitor(f.store, { runKey: key }), { code: 'RECOVERY' });
      assert.deepEqual(await fs.readFile(activePath(f, key)), original);
      assert.deepEqual((await readActiveMonitor(f.store, key)).evidence, evidence);
      assert.equal((await readActiveMonitor(f.store, key)).notice.status, 'delivered');
      await assert.rejects(fs.stat(path.join(f.store.runtime, 'pipeline-monitors',
        'archive', `${key}.json`)), { code: 'ENOENT' });
      await fs.unlink(markerPath);
    }
    assert.equal((await pruneMonitor(f.store, { runKey: key })).archived, true);
    assert.deepEqual((await readMonitor(f.store, key)).evidence, evidence);
    assert.equal((await readMonitor(f.store, key)).evidenceVerification.verified, true);
  });
}

test('T-126 a recovery marker cannot conceal a genuine consumer when its retired worktree no longer grants live authority', async t => {
  const f = await fixture(t);
  const { key, evidence } = await terminalMonitor(f, { workItemId: f.workItemId });
  await deliver(f.store, key);
  await f.store.transaction(f.workItemId, tx => tx.put({
    type: 'operation', id: 'op-recovery-monitor-consumer', workItemId: f.workItemId,
    repositoryId: 'primary', class: 'build', action: { class: 'build' },
    target: 'fixture-build', status: 'uncertain', correlationKey: 'recovery-action',
    requestFingerprint: digest('recovery-action'), dispatchBound: true, evidenceRef: key,
  }));
  const markerPath = f.store.recoveryPath(f.workItemId);
  await fs.writeFile(markerPath, 'false\n');
  assert.equal((await f.store.load(f.workItemId)).recoveryRequired, true);
  await fs.rename(f.repo, path.join(f.root, 'retired repository'));
  await assert.rejects(pruneMonitor(f.store, { runKey: key }), { code: 'RECOVERY' });
  await fs.unlink(markerPath);
  await assert.rejects(pruneMonitor(f.store, { runKey: key }), { code: 'MONITOR' });
  assert.deepEqual((await readActiveMonitor(f.store, key)).evidence, evidence);
  assert.equal((await readActiveMonitor(f.store, key)).evidenceVerification.verified, true);
});
