import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import { LIMITS, canonical, digest } from '../src/core.mjs';
import { fixture, observeFixtureRepository } from './helpers.mjs';
import { adoptPr, evaluateReadiness, updatePrFacts } from '../src/pr.mjs';
import { readArchivedPrFacts } from 'ai-sdlc-framework/pr';
import { archiveSupersededObservations,
  withObservationRetention } from '../src/observation-retention.mjs';
import { associateMonitor, attachMonitor, beginPoll, claimMonitor,
  monitorNotice, observeMonitor, readActiveMonitor,
  verifyMonitorLink } from '../src/monitors.mjs';
import { azureDevOpsScopeRef } from '../src/provider-adapters.mjs';

async function factsFixture(t) {
  const f = await fixture(t);
  await f.runGit('commit', '--allow-empty', '-qm', 'Facts recovery baseline');
  const repository = await observeFixtureRepository(f, {
    provider: 'azure-devops', connection: 'fixture', repositoryRef: 'repository-id',
  });
  f.store.verifyPullRequest = ({ adapterObservation: observation }) => ({
    canonicalLocalRepositoryPath: observation.localRepositoryPath,
    verifiedRemoteRepositoryURL: observation.remoteRepositoryURL,
    verifiedProvider: observation.provider,
    verifiedConnection: observation.connection,
    verifiedRepositoryRef: observation.repositoryRef,
    verifiedPullRequestRef: observation.pullRequestRef,
    verifiedSourceBranchRef: observation.sourceBranchRef,
    verifiedTargetBranchRef: observation.targetBranchRef,
    verifiedSourceRevision: observation.sourceRevision,
    verifiedTargetRevision: observation.targetRevision,
    verifiedState: observation.state,
    verifiedObservedAt: observation.observedAt,
    verifiedEvidenceRef: observation.evidenceRef,
  });
  const refresh = async predecessor => {
    f.clock.advance(1);
    const observation = {
      repositoryId: repository.repositoryId,
      localRepositoryPath: repository.localRepositoryPath,
      remoteRepositoryURL: repository.remoteRepositoryURL,
      provider: repository.provider, connection: repository.connection,
      repositoryRef: repository.repositoryRef, pullRequestRef: 'facts-recovery-pr',
      sourceBranchRef: 'refs/heads/feature/fixture',
      targetBranchRef: 'refs/heads/main',
      sourceRevision: repository.revision, targetRevision: 'b'.repeat(40),
      state: 'active', observedAt: new Date(f.clock.now()).toISOString(),
      evidenceRef: `fixture:pr:${f.clock.now()}`,
    };
    return (await adoptPr(f.store, {
      workItemId: f.workItemId, observation, adapterObservation: observation,
      ...(predecessor ? { previousObservationKey: predecessor.id } : {}),
    })).observation;
  };
  const pr = await refresh();
  const input = {
    workItemId: f.workItemId, prRecordId: pr.id, policyVersion: 'policy-1',
    sourceRevision: pr.sourceRevision, targetRevision: pr.targetRevision,
    requiredChecks: [], checks: [], reviewsSatisfied: true,
    providerEvidenceRef: 'fixture:policy',
  };
  return { ...f, repository, pr, input, refresh };
}

async function verifiedCheck(f) {
  const identity = {
    provider: 'azure-devops', connection: 'fixture',
    scopeRef: azureDevOpsScopeRef({
      projectId: 'project-id', repositoryId: 'repository-id',
    }),
    definitionRef: 'facts-check', executionRef: 'facts-run',
    attemptKind: 'not-applicable',
  };
  const evidenceFilePath = path.join(f.root, 'verified-check.bin');
  const bytes = Buffer.from('Verified check for the original current PR');
  await fs.writeFile(evidenceFilePath, bytes);
  const evidence = { reference: {
    locator: 'fixture:facts-check',
    retrievalContext: {
      provider: identity.provider, connection: identity.connection,
      scopeRef: identity.scopeRef, retrievedAt: new Date(f.clock.now()).toISOString(),
    },
    sha256: digest(bytes),
  } };
  const result = {
    requiredCheckRef: identity.definitionRef, checkResultRef: 'facts-check-result',
    producerRef: identity.definitionRef, testedRevision: f.pr.sourceRevision,
    evidenceRef: 'fixture:check-result', status: 'succeeded',
    localRepositoryPath: f.repo, remoteRepositoryURL: f.repository.remoteRepositoryURL,
    repositoryRef: f.repository.repositoryRef, pullRequestRef: f.pr.pullRequestRef,
    sourceRevision: f.pr.sourceRevision, targetRevision: f.pr.targetRevision,
  };
  const monitor = await attachMonitor(f.store, {
    identity, origin: 'framework', workItemId: f.workItemId,
    schedulerAvailable: true, readAvailable: true,
  });
  const workerId = 'facts-worker';
  const claim = await claimMonitor(f.store, { runKey: monitor.key, workerId });
  const poll = await beginPoll(f.store, {
    runKey: monitor.key, workerId, claimGeneration: claim.claimGeneration,
  });
  f.store.verifyCheckResults = () => ({
    identity, status: 'succeeded', evidenceReference: evidence.reference,
    checkResults: [result],
  });
  await observeMonitor(f.store, {
    runKey: monitor.key, workerId, claimGeneration: claim.claimGeneration,
    pollGeneration: poll.pollGeneration, identity, status: 'succeeded',
    evidence, evidenceFilePath, checkResults: [result],
  });
  const url = 'https://dev.azure.com/example/project/_build/results?buildId=facts-run';
  await verifyMonitorLink(f.store, {
    runKey: monitor.key, adapterId: 'azure-devops',
    observation: {
      connection: 'fixture',
      build: {
        id: identity.executionRef, project: { id: 'project-id' },
        repository: { id: 'repository-id' }, definition: { id: identity.definitionRef },
        _links: { web: { href: url } },
      },
      access: { accessible: true, finalUrl: url },
    },
    evidenceRef: 'fixture:run-link',
  });
  const association = await associateMonitor(f.store, {
    runKey: monitor.key, workItemId: f.workItemId,
    prRecordId: f.pr.id, prObservationKey: f.pr.id,
    localRepositoryPath: f.repo, remoteRepositoryURL: f.repository.remoteRepositoryURL,
    checkId: result.requiredCheckRef, requiredCheckRef: result.requiredCheckRef,
    checkResultRef: result.checkResultRef, producerRef: result.producerRef,
    testedRevision: result.testedRevision,
    sourceRevision: result.sourceRevision, targetRevision: result.targetRevision,
    evidenceRef: result.evidenceRef, evidence,
  });
  await monitorNotice(f.store, {
    runKey: monitor.key, deliveredRef: 'fixture:delivered',
    noticeGeneration: (await readActiveMonitor(f.store, monitor.key)).notice.generation,
  });
  return { ...f.input, requiredChecks: [result.requiredCheckRef],
    checks: [{
      id: result.requiredCheckRef, requiredCheckRef: result.requiredCheckRef,
      checkResultRef: result.checkResultRef, producerRef: result.producerRef,
      testedRevision: result.testedRevision, sourceRevision: result.sourceRevision,
      targetRevision: result.targetRevision, runKey: monitor.key, identity,
      status: 'succeeded', evidenceRef: result.evidenceRef,
    }],
    runMonitorRefs: [association.key],
  };
}

const archivedBytes = (f, archiveId) => fs.readFile(path.join(
  f.store.workPath(f.workItemId), 'evidence', `${archiveId}.json`));
const versionId = bytes => `pr-facts-version-${digest(bytes)}`;
const pruneFacts = f => withObservationRetention(f.store, f.workItemId,
  (tx, monitorDependencies) =>
    archiveSupersededObservations(f.store, tx, { monitorDependencies }));
const readVersion = (f, facts, bytes) => readArchivedPrFacts(f.store, {
  workItemId: f.workItemId, factsId: facts.id, sha256: digest(bytes),
});

async function assertVersion(f, facts, bytes) {
  const result = await readVersion(f, facts, bytes);
  assert.equal(result.archiveId, versionId(bytes));
  assert.equal(result.sha256, digest(bytes));
  assert.equal(result.historicalOnly, true);
  assert.deepEqual(result.facts, facts);
  assert.deepEqual(result.bytes, bytes);
  assert.deepEqual(await fs.readFile(result.evidenceRef), bytes);
  return result;
}
const readiness = (f, pr = f.pr) => ({
  environment: 'PROD', repositoryId: 'primary', prRecordId: pr.id,
  localRepositoryPath: f.repo, remoteRepositoryURL: f.repository.remoteRepositoryURL,
  prId: pr.pullRequestRef, sourceRevision: pr.sourceRevision,
  targetRevision: pr.targetRevision, policyVersion: 'policy-1',
  policy: { reviews: true },
});

test('FR-063/064 current facts update after archive-before-replacement interruption must not poison refresh', async t => {
  const f = await factsFixture(t);
  const input = await verifiedCheck(f);
  const original = await updatePrFacts(f.store, input);
  const originalBytes = Buffer.from(`${JSON.stringify(original, null, 2)}\n`);
  await fs.writeFile(f.store.recordPath(f.workItemId, original.id), originalBytes);
  assert.deepEqual(original.runMonitorRefs, input.runMonitorRefs);
  assert.equal(evaluateReadiness(await f.store.records(f.workItemId),
    readiness(f), { clock: f.clock }).ready, true);
  const checkpointFile = path.join(f.store.workPath(f.workItemId), 'checkpoint.json');
  const checkpointBytes = await fs.readFile(checkpointFile);
  let interrupted = false;
  f.store.fault = async point => {
    if (!interrupted && point === 'archive:pr-facts') {
      interrupted = true;
      throw new Error('fixture fault after facts archive before replacement write');
    }
  };
  await assert.rejects(f.refresh(f.pr), {
    message: 'fixture fault after facts archive before replacement write',
  });
  assert.equal(interrupted, true);
  assert.deepEqual(await fs.readFile(checkpointFile), checkpointBytes);
  assert.deepEqual(await archivedBytes(f, original.id), originalBytes);
  assert.deepEqual((await f.store.records(f.workItemId)).filter(record =>
    record.type === 'pr-observation').map(record => record.id), [f.pr.id],
  'The original observation must still be the only durable current PR');
  f.store.fault = async () => {};
  const changed = await updatePrFacts(f.store, {
    ...input, reviewsSatisfied: false, providerEvidenceRef: 'fixture:updated-policy',
  });
  assert.equal(changed.id, original.id);
  assert.deepEqual(changed.checks, original.checks);
  assert.deepEqual(changed.runMonitorRefs, original.runMonitorRefs);
  assert.deepEqual(evaluateReadiness(await f.store.records(f.workItemId),
    readiness(f), { clock: f.clock }).gaps, ['required-reviews-missing']);
  const changedBytes = await fs.readFile(f.store.recordPath(f.workItemId, changed.id));
  t.diagnostic('Real observe/adopt/updateFacts -> archive:pr-facts fault -> same-ID current facts update -> refresh');
  const latest = await f.refresh(f.pr);
  assert.equal(latest.sequence, f.pr.sequence + 1);
  assert.equal((await f.store.records(f.workItemId)).some(record =>
    record.id === original.id), false);
  assert.deepEqual(await archivedBytes(f, original.id), originalBytes);
  assert.notEqual(versionId(originalBytes), versionId(changedBytes));
  await assertVersion(f, original, originalBytes);
  await assertVersion(f, changed, changedBytes);
  const legacy = await readArchivedPrFacts(f.store, {
    workItemId: f.workItemId, factsId: original.id,
  });
  assert.deepEqual(legacy.bytes, originalBytes);
  const active = await f.store.records(f.workItemId);
  assert.equal(active.some(record => record.id === f.pr.id), false);
  assert.equal(evaluateReadiness(active, readiness(f), { clock: f.clock }).ready, false);
  assert.deepEqual(evaluateReadiness(active, readiness(f, latest),
    { clock: f.clock }).gaps, ['provider-policy-or-check-metadata-unavailable']);
  await assert.rejects(updatePrFacts(f.store, input), { code: 'INPUT' });
  await assert.rejects(updatePrFacts(f.store, {
    ...input, prRecordId: latest.id, runMonitorRefs: [],
    targetRevision: 'c'.repeat(40),
  }), { code: 'STALE' });
  await assert.rejects(updatePrFacts(f.store, {
    ...input, prRecordId: latest.id,
  }), { code: 'EVIDENCE' });
  const latestFacts = await updatePrFacts(f.store, {
    ...input, prRecordId: latest.id, runMonitorRefs: [],
  });
  assert.equal(latestFacts.id, `facts-${latest.id}`);
  assert.deepEqual(latestFacts.checks, original.checks);
  assert.deepEqual(latestFacts.runMonitorRefs, [],
    'A new observation must not borrow the previous observation check association');
  assert.deepEqual(evaluateReadiness(await f.store.records(f.workItemId),
    readiness(f, latest), { clock: f.clock }).gaps,
  ['check:facts-check:monitor-not-attached-or-verified']);
  const again = await f.refresh(latest);
  await pruneFacts(f);
  await assertVersion(f, original, originalBytes);
  await assertVersion(f, changed, changedBytes);
  assert.equal(again.sequence, latest.sequence + 1);
});

for (const interruption of ['archive:pr-facts:version', 'archive:pr-facts',
  'record:pr-observation', 'checkpoint', 'remove:pr-facts:', 'remove:pr-observation:']) {
  test(`FR-064 fact versions recover after ${interruption} and repeated refresh`, async t => {
    const f = await factsFixture(t);
    const original = await updatePrFacts(f.store, f.input);
    const bytes = await fs.readFile(f.store.recordPath(f.workItemId, original.id));
    let interrupted = false;
    f.store.fault = async point => {
      if (!interrupted && point === interruption) {
        interrupted = true;
        throw new Error(`fixture interruption: ${point}`);
      }
    };
    await assert.rejects(f.refresh(f.pr), {
      message: `fixture interruption: ${interruption}`,
    });
    assert.equal(interrupted, true);
    await assertVersion(f, original, bytes);
    f.store.fault = async () => {};
    const recovered = await f.store.load(f.workItemId, { recoverCheckpoint: true });
    assert.equal(recovered.recoveryRequired, false);
    const current = recovered.records.filter(record => record.type === 'pr-observation')
      .sort((a, b) => a.sequence - b.sequence).at(-1);
    let changed;
    let changedBytes;
    if (current.id === f.pr.id) {
      changed = await updatePrFacts(f.store, {
        ...f.input, providerEvidenceRef: `fixture:updated:${interruption}`,
      });
      assert.equal(changed.id, original.id);
      changedBytes = await fs.readFile(f.store.recordPath(f.workItemId, changed.id));
    } else {
      await assert.rejects(updatePrFacts(f.store, f.input), error =>
        ['INPUT', 'STALE'].includes(error.code));
    }
    const latest = await f.refresh(current);
    await pruneFacts(f);
    const active = await f.store.records(f.workItemId);
    assert.ok(Buffer.byteLength(canonical(active)) <= LIMITS.workingSet);
    assert.deepEqual(active.filter(record => record.type === 'pr-observation')
      .map(record => record.id), [latest.id]);
    assert.equal(active.some(record => record.id === original.id), false);
    await assertVersion(f, original, bytes);
    if (changed) await assertVersion(f, changed, changedBytes);
    assert.deepEqual(await pruneFacts(f), []);
    await assertVersion(f, original, bytes);
  });
}

test('FR-064 restored read-only legacy fact history stays exact and gains distinct retrievable versions', async t => {
  const f = await factsFixture(t);
  const original = await updatePrFacts(f.store, f.input);
  const originalBytes = Buffer.from(`${JSON.stringify(original, null, 2)}\r\n`);
  const directory = path.join(f.store.workPath(f.workItemId), 'evidence');
  await fs.mkdir(directory, { recursive: true });
  const legacyFile = path.join(directory, `${original.id}.json`);
  await fs.writeFile(legacyFile, originalBytes);
  await fs.chmod(legacyFile, 0o444);
  try {
    const before = await fs.readdir(directory);
    assert.deepEqual((await readArchivedPrFacts(f.store, {
      workItemId: f.workItemId, factsId: original.id,
    })).bytes, originalBytes);
    assert.deepEqual(await fs.readdir(directory), before,
      'Retrieving restored legacy history must not perform a migration');
    f.clock.advance(1);
    const changed = await updatePrFacts(f.store, {
      ...f.input, providerEvidenceRef: 'fixture:changed-after-restoration',
    });
    const changedBytes = await fs.readFile(f.store.recordPath(f.workItemId, changed.id));
    await f.refresh(f.pr);
    await assertVersion(f, original, originalBytes);
    await assertVersion(f, changed, changedBytes);
    assert.deepEqual(await fs.readFile(legacyFile), originalBytes);
    const restoredVersion = path.join(directory, `${versionId(originalBytes)}.json`);
    await fs.chmod(restoredVersion, 0o444);
    try {
      const history = await fs.readdir(directory);
      await assertVersion(f, original, originalBytes);
      await pruneFacts(f);
      assert.deepEqual(await fs.readdir(directory), history);
      assert.deepEqual(await fs.readFile(legacyFile), originalBytes);
    } finally { await fs.chmod(restoredVersion, 0o600); }
  } finally { await fs.chmod(legacyFile, 0o600); }
});

test('FR-064 byte-version corruption remains an explicit conflict without removing active evidence', async t => {
  const f = await factsFixture(t);
  const original = await updatePrFacts(f.store, f.input);
  const bytes = await fs.readFile(f.store.recordPath(f.workItemId, original.id));
  const directory = path.join(f.store.workPath(f.workItemId), 'evidence');
  await fs.mkdir(directory, { recursive: true });
  const versionFile = path.join(directory, `${versionId(bytes)}.json`);
  const corrupt = Buffer.from(`${canonical({
    ...original, providerEvidenceRef: 'fixture:conflicting-version',
  })}\n`);
  await fs.writeFile(versionFile, corrupt);
  const checkpointFile = path.join(f.store.workPath(f.workItemId), 'checkpoint.json');
  const checkpointBytes = await fs.readFile(checkpointFile);
  await assert.rejects(f.refresh(f.pr), { code: 'ID_CONFLICT' });
  await assert.rejects(readVersion(f, original, bytes), { code: 'ID_CONFLICT' });
  assert.deepEqual(await fs.readFile(versionFile), corrupt);
  assert.deepEqual(await fs.readFile(checkpointFile), checkpointBytes);
  assert.deepEqual(await fs.readFile(f.store.recordPath(f.workItemId, original.id)), bytes);
  assert.deepEqual((await f.store.records(f.workItemId)).filter(record =>
    record.type === 'pr-observation').map(record => record.id), [f.pr.id]);
});

test('FR-064 unrelated legacy facts and mismatched public retrieval identities are rejected', async t => {
  const f = await factsFixture(t);
  const original = await updatePrFacts(f.store, f.input);
  const bytes = await fs.readFile(f.store.recordPath(f.workItemId, original.id));
  const directory = path.join(f.store.workPath(f.workItemId), 'evidence');
  await fs.mkdir(directory, { recursive: true });
  const legacyFile = path.join(directory, `${original.id}.json`);
  const unrelated = Buffer.from(`${canonical({ ...original, workItemId: 'other-work' })}\n`);
  await fs.writeFile(legacyFile, unrelated);
  await assert.rejects(f.refresh(f.pr), { code: 'ID_CONFLICT' });
  await assert.rejects(readArchivedPrFacts(f.store, {
    workItemId: f.workItemId, factsId: original.id,
  }), { code: 'ID_CONFLICT' });
  assert.deepEqual(await fs.readFile(legacyFile), unrelated);
  await fs.unlink(legacyFile);
  await f.refresh(f.pr);
  await assertVersion(f, original, bytes);
  await assert.rejects(readArchivedPrFacts(f.store, {
    workItemId: f.workItemId, factsId: 'facts-other-pr', sha256: digest(bytes),
  }), { code: 'ID_CONFLICT' });
  await assert.rejects(readArchivedPrFacts(f.store, {
    workItemId: f.workItemId, factsId: original.id, sha256: '../invalid',
  }), { code: 'INPUT' });
  await assert.rejects(readArchivedPrFacts(f.store, {
    workItemId: f.workItemId, factsId: original.id, sha256: 'f'.repeat(64),
  }), { code: 'ENOENT' });
});

test('FR-063 facts consumers and immutable audit references pin original dependencies until release', async t => {
  const f = await factsFixture(t);
  const facts = await updatePrFacts(f.store, f.input);
  const bytes = await fs.readFile(f.store.recordPath(f.workItemId, facts.id));
  const event = {
    type: 'event', id: 'facts-audit-event', workItemId: f.workItemId,
    schemaVersion: 1, sequence: 1, kind: 'review-result',
    effect: {
      cycleId: 'cycle-history', candidateDigest: 'c'.repeat(64),
      testSpecDigest: 'd'.repeat(64), configDigest: 'e'.repeat(64),
      status: 'Blocked', evidenceRef: `copilot-cli:/review:${facts.id}`,
      summary: 'Retain historical facts referenced by the audit',
      blockingFindings: ['fixture:missing-proof'],
    },
    sourceReceiptId: 'receipt-fixture', sourceReceiptDigest: 'a'.repeat(64),
    inputDigest: 'b'.repeat(64), sessionId: f.sessionId,
    repositoryIds: ['primary'], snapshots: [], occurredAt: new Date(f.clock.now()).toISOString(),
  };
  event.digest = digest(event);
  await f.store.transaction(f.workItemId, tx => {
    tx.put(event);
    tx.put({ type: 'audit-reference', id: 'facts-audit', workItemId: f.workItemId,
      eventId: event.id, eventDigest: event.digest,
      repositoryId: 'primary', commit: f.repository.revision });
    tx.put({ type: 'conflict', id: 'facts-consumer', workItemId: f.workItemId,
      reason: 'Keep the sole fact consumer', status: 'open', references: [facts.id] });
  });
  const auditBytes = await fs.readFile(f.store.recordPath(f.workItemId, event.id));
  await f.refresh(f.pr);
  await pruneFacts(f);
  let active = await f.store.records(f.workItemId);
  for (const record of [f.repository, f.pr, facts]) {
    assert.ok(active.some(candidate => candidate.id === record.id));
  }
  await f.store.transaction(f.workItemId, tx => tx.remove('facts-consumer'));
  await pruneFacts(f);
  active = await f.store.records(f.workItemId);
  assert.ok(active.some(record => record.id === facts.id), 'The audit is still a sole consumer');
  assert.deepEqual(await fs.readFile(f.store.recordPath(f.workItemId, event.id)), auditBytes);
  await f.store.transaction(f.workItemId, tx => {
    tx.remove('facts-audit');
    tx.remove(event.id);
  });
  await pruneFacts(f);
  assert.equal((await f.store.records(f.workItemId)).some(record =>
    record.id === facts.id), false);
  await assertVersion(f, facts, bytes);
});

async function crowdedFactsFixture(t) {
  const f = await factsFixture(t);
  const facts = await updatePrFacts(f.store, f.input);
  const factsBytes = await fs.readFile(f.store.recordPath(f.workItemId, facts.id));
  const consumer = {
    type: 'conflict', id: 'capacity-dependency', workItemId: f.workItemId,
    reason: 'Retain the original sole repository dependency', status: 'open',
    references: [f.repository.id],
  };
  const roots = [f.pr, facts, consumer];
  const backlog = [f.repository];
  const target = 262044;
  const identify = observation => {
    const { type, id: ignored, workItemId, repositoryId, ...value } = observation;
    void type; void ignored; void workItemId; void repositoryId;
    return { ...observation, id: `repository-observation-${digest(value).slice(0, 40)}` };
  };
  while (true) {
    f.clock.advance(1);
    const observation = identify({
      ...f.repository, observedAt: new Date(f.clock.now()).toISOString(),
      evidenceRef: `fixture:facts-capacity:${f.clock.now()}`,
    });
    if (Buffer.byteLength(canonical([...roots, ...backlog, observation])) > target) break;
    backlog.push(observation);
  }
  let remaining = target - Buffer.byteLength(canonical([...roots, ...backlog]));
  for (let index = backlog.length - 1; index > 0 && remaining; index--) {
    const padding = Math.min(remaining, 512 - backlog[index].evidenceRef.length);
    backlog[index] = identify({
      ...backlog[index], evidenceRef: backlog[index].evidenceRef + 'x'.repeat(padding),
    });
    remaining -= padding;
  }
  assert.equal(remaining, 0);
  assert.equal(Buffer.byteLength(canonical([...roots, ...backlog])), target);
  assert.ok(backlog.length > 200);
  await f.store.transaction(f.workItemId, tx => {
    tx.put(consumer);
    for (const observation of backlog) tx.put(observation);
  });
  const bytes = new Map(await Promise.all(backlog.map(async observation => [
    observation.id, await fs.readFile(f.store.recordPath(f.workItemId, observation.id)),
  ])));
  return { f, facts, factsBytes, consumer, backlog, bytes };
}

for (const interruption of ['retention:remove:repository-observation', 'record:pr-observation']) {
  test(`FR-063/064 facts refresh at 262044 bytes recovers ${interruption} within original/pending union budget`, async t => {
    const { f, facts, factsBytes, consumer, backlog, bytes } = await crowdedFactsFixture(t);
    const checkpointFile = path.join(f.store.workPath(f.workItemId), 'checkpoint.json');
    const checkpointBytes = await fs.readFile(checkpointFile);
    let interrupted = false;
    f.store.fault = async point => {
      if (!interrupted && point === interruption) {
        interrupted = true;
        throw new Error(`fixture near-budget interruption: ${point}`);
      }
    };
    await assert.rejects(f.refresh(f.pr), {
      message: `fixture near-budget interruption: ${interruption}`,
    });
    assert.equal(interrupted, true);
    f.store.fault = async () => {};
    const recovered = await f.store.load(f.workItemId, { recoverCheckpoint: true });
    assert.ok(Buffer.byteLength(canonical(recovered.records)) <= 262144);
    assert.equal(LIMITS.workingSet, 262144);
    for (const original of [f.pr, facts, f.repository, consumer, backlog.at(-1)]) {
      assert.ok(recovered.records.some(record => record.id === original.id),
        `Original head/dependency ${original.id} must survive the interruption`);
    }
    if (interruption.startsWith('retention:')) {
      assert.deepEqual(await fs.readFile(checkpointFile), checkpointBytes);
      assert.deepEqual(recovered.records.filter(record => record.type === 'pr-observation')
        .map(record => record.id), [f.pr.id]);
    }
    await assertVersion(f, facts, factsBytes);
    for (const observation of backlog) {
      const saved = recovered.records.some(record => record.id === observation.id) ?
        await fs.readFile(f.store.recordPath(f.workItemId, observation.id)) :
        await archivedBytes(f, observation.id);
      assert.deepEqual(saved, bytes.get(observation.id));
    }
    const current = recovered.records.filter(record => record.type === 'pr-observation')
      .sort((a, b) => a.sequence - b.sequence).at(-1);
    const latest = await f.refresh(current);
    await pruneFacts(f);
    const active = await f.store.records(f.workItemId);
    assert.ok(Buffer.byteLength(canonical(active)) <= LIMITS.workingSet);
    for (const dependency of [f.repository, consumer, backlog.at(-1), latest]) {
      assert.ok(active.some(record => record.id === dependency.id));
    }
    assert.equal(active.some(record => record.id === facts.id), false);
    await assertVersion(f, facts, factsBytes);
  });
}
