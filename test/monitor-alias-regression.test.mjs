import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { associateMonitor, attachMonitor, beginPoll, claimMonitor, dueMonitors,
  interruptMonitor, monitorNotice, observeMonitor, pruneMonitor,
  readActiveMonitor, readMonitor, readMonitorAssociation, runKey,
  verifyMonitorLink, withMonitorLocks } from '../src/monitors.mjs';
import { registerProviderAdapter } from '../src/provider-adapters.mjs';
import { Store } from '../src/store.mjs';
import { digest } from '../src/core.mjs';
import { pullRequestObservationKey } from '../src/repository-observations.mjs';
import { fixture as workItemFixture } from './helpers.mjs';

const provider = registerProviderAdapter({
  id: 'monitor-alias-distinct-fixture',
  attemptCapability: 'distinct',
  linkKinds: ['summary'],
  normalizeLinkObservation: input => input,
});
const identity = (overrides = {}) => ({
  provider, connection: 'fixture-connection', scopeRef: 'fixture-scope',
  definitionRef: 'fixture-definition', executionRef: 'fixture-run',
  attemptRef: 'attempt-2', ...overrides,
});
const currentIdentity = overrides => identity({ attemptKind: 'known', ...overrides });
const noAttemptsProvider = registerProviderAdapter({
  id: 'monitor-alias-none-fixture', attemptCapability: 'none',
  linkKinds: ['summary'], normalizeLinkObservation: input => input,
});
const linkOnlyProvider = registerProviderAdapter({
  id: 'monitor-alias-link-only-fixture',
  linkKinds: ['summary'], normalizeLinkObservation: input => input,
});
const unknownProvider = registerProviderAdapter({
  id: 'monitor-alias-unknown-fixture', attemptCapability: 'unknown',
  linkKinds: ['summary'], normalizeLinkObservation: input => input,
});

async function fixture(t) {
  const parent = path.resolve('.test-data');
  await fs.mkdir(parent, { recursive: true });
  const runtime = await fs.mkdtemp(path.join(parent, 'monitor-alias-'));
  t.after(async () => {
    assert.equal(path.dirname(runtime), parent);
    await fs.rm(runtime, { recursive: true });
    await assert.rejects(fs.stat(runtime), { code: 'ENOENT' });
  });
  const clock = { value: Date.parse('2026-09-08T00:00:00Z'),
    now() { return this.value; }, advance(ms) { this.value += ms; } };
  return new Store(runtime, { clock }).ready();
}
const attach = (store, identity) => attachMonitor(store, {
  identity, origin: 'framework', schedulerAvailable: true, readAvailable: true,
});
const worker = record => ({
  runKey: record.key, workerId: record.workerId,
  claimGeneration: record.claimGeneration,
});
const activePath = (store, key) =>
  path.join(store.runtime, 'pipeline-monitors', `${key}.json`);
const archivePath = (store, key) =>
  path.join(store.runtime, 'pipeline-monitors', 'archive', `${key}.json`);

async function complete(store, record) {
  const claimed = await claimMonitor(store, {
    runKey: record.key, workerId: 'terminal-worker',
  });
  const poll = await beginPoll(store, worker(claimed));
  await observeMonitor(store, {
    ...worker(claimed), pollGeneration: poll.pollGeneration,
    identity: record.identity, status: 'succeeded',
    evidence: { summary: 'Historical diagnostic result, not verified check proof.' },
  });
  const notice = await monitorNotice(store, { runKey: record.key });
  return monitorNotice(store, {
    runKey: record.key, noticeGeneration: notice.notice.generation,
    deliveredRef: 'fixture:terminal-notice-delivered',
  });
}

for (const order of ['historical-first', 'current-first']) {
  test(`FR-059 ${order} non-Azure aliases have exactly one public poll owner`, async t => {
    const store = await fixture(t);
    const identities = order === 'historical-first' ?
      [identity(), currentIdentity()] : [currentIdentity(), identity()];
    assert.notEqual(runKey(identities[0]), runKey(identities[1]));
    const first = await attach(store, identities[0]);
    const claimed = await claimMonitor(store, {
      runKey: first.key, workerId: 'first-worker',
    });
    const firstPoll = await beginPoll(store, worker(claimed));
    const before = await fs.readFile(activePath(store, first.key));
    const second = await attach(store, identities[1]);
    const secondClaims = await Promise.allSettled([claimMonitor(store, {
      runKey: second.key, workerId: 'second-worker',
    })]);
    const owners = [firstPoll];
    for (const result of secondClaims) {
      if (result.status === 'fulfilled') {
        owners.push(await beginPoll(store, worker(result.value)));
      } else {
        assert.equal(result.reason.code, 'LOCK_BUSY');
      }
    }
    assert.equal(owners.length, 1,
      'Equivalent historical/current execution keys must not admit two in-flight poll owners');
    assert.equal(second.key, first.key);
    assert.deepEqual(second, firstPoll);
    assert.deepEqual((await dueMonitors(store)).map(record => record.runKey), [first.key]);
    assert.deepEqual(await readMonitor(store, first.key), firstPoll);
    assert.deepEqual(await fs.readFile(activePath(store, first.key)), before);
    assert.equal(await readMonitor(store, runKey(identities[1])), null);
  });
}

test('FR-059 concurrent non-Azure alias attaches and competing claims admit one poll owner', async t => {
  const store = await fixture(t);
  const [historical, current] = await Promise.all([
    attach(store, identity()), attach(store, currentIdentity()),
  ]);
  assert.equal(historical.key, current.key);
  const claims = await Promise.allSettled([
    claimMonitor(store, { runKey: historical.key, workerId: 'historical-worker' }),
    claimMonitor(store, { runKey: current.key, workerId: 'current-worker' }),
  ]);
  const claimed = claims.filter(result => result.status === 'fulfilled');
  assert.equal(claimed.length, 1);
  assert.equal(claims.find(result => result.status === 'rejected').reason.code, 'LOCK_BUSY');
  const polls = await Promise.allSettled([
    beginPoll(store, worker(claimed[0].value)),
    beginPoll(store, worker(claimed[0].value)),
  ]);
  assert.equal(polls.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(polls.find(result => result.status === 'rejected').reason.code, 'MONITOR');
  assert.deepEqual((await dueMonitors(store)).map(record => ({
    key: record.runKey, workerId: record.workerId, inFlight: record.inFlight,
  })), [{ key: historical.key, workerId: claimed[0].value.workerId, inFlight: true }]);
});

for (const order of ['historical-first', 'current-first']) {
  test(`FR-059 ${order} non-Azure no-attempt aliases use trusted adapter proof`, async t => {
    const store = await fixture(t);
    const historical = identity({ provider: noAttemptsProvider, attemptRef: undefined });
    const current = { ...historical, attemptKind: 'not-applicable' };
    const identities = order === 'historical-first' ? [historical, current] : [current, historical];
    const first = await attach(store, identities[0]);
    const claimed = await claimMonitor(store, { runKey: first.key, workerId: 'none-worker' });
    const poll = await beginPoll(store, worker(claimed));
    assert.deepEqual(await attach(store, identities[1]), poll);
    assert.deepEqual((await dueMonitors(store)).map(record => record.runKey), [first.key]);
    await assert.rejects(claimMonitor(store, {
      runKey: first.key, workerId: 'duplicate-none-worker',
    }), { code: 'LOCK_BUSY' });
  });

  test(`FR-059/063 ${order} archived alias attaches retain bytes and cannot restart polling`, async t => {
    const store = await fixture(t);
    const identities = order === 'historical-first' ?
      [identity(), currentIdentity()] : [currentIdentity(), identity()];
    const first = await attach(store, identities[0]);
    await complete(store, first);
    assert.equal((await pruneMonitor(store, { runKey: first.key })).archived, true);
    const bytes = await fs.readFile(archivePath(store, first.key));
    const archived = await readMonitor(store, first.key);
    assert.deepEqual(await attach(store, identities[1]), archived);
    assert.deepEqual(archived.identity, first.identity);
    assert.equal(archived.evidenceVerification, undefined);
    assert.equal(archived.checkResults, undefined);
    assert.deepEqual(await fs.readFile(archivePath(store, first.key)), bytes);
    assert.equal(await readActiveMonitor(store, first.key), null);
    assert.equal(await readMonitor(store, runKey(identities[1])), null);
    assert.deepEqual(await dueMonitors(store), []);
    await assert.rejects(claimMonitor(store, {
      runKey: archived.key, workerId: 'restart-worker',
    }), { code: 'SCHEMA' });
  });

  test(`FR-063 ${order} alias attach racing archive leaves one immutable history record`, async t => {
    const store = await fixture(t);
    const identities = order === 'historical-first' ?
      [identity(), currentIdentity()] : [currentIdentity(), identity()];
    const first = await attach(store, identities[0]);
    await complete(store, first);
    const before = await fs.readFile(activePath(store, first.key));
    const [pruned, attached] = await Promise.all([
      pruneMonitor(store, { runKey: first.key }), attach(store, identities[1]),
    ]);
    assert.equal(pruned.archived, true);
    assert.equal(attached.key, first.key);
    assert.deepEqual(await fs.readFile(archivePath(store, first.key)), before);
    assert.equal(await readActiveMonitor(store, first.key), null);
    assert.equal(await readMonitor(store, runKey(identities[1])), null);
    assert.deepEqual(await dueMonitors(store), []);
  });
}

const distinctCases = [
  ['provider', currentIdentity({ provider: noAttemptsProvider, attemptRef: undefined,
    attemptKind: 'not-applicable' })],
  ['connection', currentIdentity({ connection: 'other-connection' })],
  ['scope', currentIdentity({ scopeRef: 'other-scope' })],
  ['definition', currentIdentity({ definitionRef: 'other-definition' })],
  ['missing definition', currentIdentity({ definitionRef: undefined })],
  ['run', currentIdentity({ executionRef: 'other-run' })],
  ['attempt', currentIdentity({ attemptRef: 'attempt-3' })],
  ['unknown attempt', identity({ attemptRef: undefined, attemptKind: 'unknown' })],
  ['historical unknown attempt', identity({ attemptRef: undefined })],
];
for (const [field, other] of distinctCases) {
  test(`FR-059 different ${field} is not conflated with a known historical attempt`, async t => {
    const store = await fixture(t);
    const first = await attach(store, identity());
    const second = await attach(store, other);
    assert.notEqual(first.key, second.key);
    const claims = await Promise.all([
      claimMonitor(store, { runKey: first.key, workerId: 'first-worker' }),
      claimMonitor(store, { runKey: second.key, workerId: 'second-worker' }),
    ]);
    const polls = await Promise.all(claims.map(record => beginPoll(store, worker(record))));
    assert.deepEqual(polls.map(record => record.identity), [first.identity, second.identity]);
    assert.equal((await dueMonitors(store)).length, 2);
  });
}

for (const [name, historical, current] of [
  ['missing adapter', identity({ provider: 'monitor-alias-unregistered' }),
    currentIdentity({ provider: 'monitor-alias-unregistered' })],
  ['link-only adapter', identity({ provider: linkOnlyProvider }),
    currentIdentity({ provider: linkOnlyProvider })],
  ['unknown adapter capability', identity({ provider: unknownProvider }),
    currentIdentity({ provider: unknownProvider })],
  ['incompatible adapter capability', identity({ provider: noAttemptsProvider }),
    currentIdentity({ provider: noAttemptsProvider })],
  ['unknown distinct attempt', identity({ attemptRef: undefined }),
    identity({ attemptRef: undefined, attemptKind: 'unknown' })],
  ['unknown provider attempt', identity({ provider: unknownProvider, attemptRef: undefined }),
    identity({ provider: unknownProvider, attemptRef: undefined, attemptKind: 'unknown' })],
]) {
  test(`FR-059 ${name} does not prove historical/current equivalence`, async t => {
    const store = await fixture(t);
    const first = await attach(store, historical);
    const second = await attach(store, current);
    assert.notEqual(first.key, second.key);
    assert.deepEqual((await dueMonitors(store)).map(record => record.runKey).sort(),
      [first.key, second.key].sort());
  });
}

test('FR-059 an alias cannot relabel trigger origin or steal a live worker lease', async t => {
  const store = await fixture(t);
  const first = await attach(store, identity());
  const claimed = await claimMonitor(store, { runKey: first.key, workerId: 'lease-owner' });
  const poll = await beginPoll(store, worker(claimed));
  await assert.rejects(attachMonitor(store, {
    identity: currentIdentity(), origin: 'user-reported',
    reportingReceiptId: 'receipt-other-origin',
    schedulerAvailable: true, readAvailable: true,
  }), { code: 'ID_CONFLICT' });
  assert.deepEqual(await readMonitor(store, first.key), poll);
  assert.equal(await readMonitor(store, runKey(currentIdentity())), null);
});

test('FR-059 alias attach preserves interrupted generations and rejects the replaced worker', async t => {
  const store = await fixture(t);
  const first = await attach(store, identity());
  const claimed = await claimMonitor(store, { runKey: first.key, workerId: 'old-worker' });
  const poll = await beginPoll(store, worker(claimed));
  const interrupted = await interruptMonitor(store, {
    runKey: first.key, reason: 'Fixture host stopped.',
  });
  assert.deepEqual(await attach(store, currentIdentity()), interrupted);
  const replacement = await claimMonitor(store, {
    runKey: first.key, workerId: 'new-worker', replaceInterrupted: true,
  });
  assert.ok(replacement.claimGeneration > claimed.claimGeneration);
  await assert.rejects(observeMonitor(store, {
    ...worker(claimed), pollGeneration: poll.pollGeneration, identity: identity(),
    status: 'succeeded', evidenceRef: 'fixture:obsolete-worker',
  }), { code: 'STALE' });
  await assert.rejects(beginPoll(store, worker(claimed)), { code: 'STALE' });
  const currentPoll = await beginPoll(store, worker(replacement));
  assert.equal(currentPoll.workerId, 'new-worker');
  assert.deepEqual((await dueMonitors(store)).map(record => record.runKey), [first.key]);
});

test('FR-058/059 alias discovery cannot upgrade historical poll identity into current proof', async t => {
  const store = await fixture(t);
  const historical = await attach(store, identity());
  const claim = await claimMonitor(store, { runKey: historical.key, workerId: 'history-worker' });
  const poll = await beginPoll(store, worker(claim));
  assert.deepEqual(await attach(store, currentIdentity()), poll);
  const before = await fs.readFile(activePath(store, historical.key));
  await assert.rejects(observeMonitor(store, {
    ...worker(claim), pollGeneration: poll.pollGeneration, identity: currentIdentity(),
    status: 'succeeded', evidenceRef: 'fixture:current-result-on-history',
  }), { code: 'EVIDENCE' });
  assert.deepEqual(await fs.readFile(activePath(store, historical.key)), before);
  assert.equal((await readMonitor(store, historical.key)).identity.attemptKind, undefined);
});

test('FR-059 all alias locks are held before either active or archived record is selected', async t => {
  const store = await fixture(t);
  const current = await attach(store, currentIdentity());
  const before = await fs.readFile(activePath(store, current.key));
  const aliasKeys = [current.key, runKey(identity())].sort();
  // Hold the last lock: attach must acquire the first and cannot read/select until both are held.
  await withMonitorLocks(store, [aliasKeys[1]], async () => {
    await assert.rejects(attach(store, identity()), { code: 'LOCK_BUSY' });
    await assert.rejects(fs.stat(`${activePath(store, aliasKeys[0])}.lock`), { code: 'ENOENT' });
    assert.deepEqual(await fs.readFile(activePath(store, current.key)), before);
    assert.equal(await readMonitor(store, runKey(identity())), null);
  });
  assert.deepEqual(await attach(store, identity()), current);
});

test('FR-059 already duplicated active aliases fail explicitly without merging live leases', async t => {
  const store = await fixture(t);
  const historical = await attach(store, identity());
  const first = await claimMonitor(store, { runKey: historical.key, workerId: 'historical-worker' });
  const currentKey = runKey(currentIdentity());
  const current = { ...first, key: currentKey, identity: currentIdentity(), workerId: 'current-worker' };
  await fs.writeFile(activePath(store, currentKey), `${JSON.stringify(current)}\n`);
  const historicalBytes = await fs.readFile(activePath(store, historical.key));
  const currentBytes = await fs.readFile(activePath(store, currentKey));
  await assert.rejects(attach(store, currentIdentity()), { code: 'ID_CONFLICT' });
  await assert.rejects(attach(store, identity()), { code: 'ID_CONFLICT' });
  assert.deepEqual(await fs.readFile(activePath(store, historical.key)), historicalBytes);
  assert.deepEqual(await fs.readFile(activePath(store, currentKey)), currentBytes);
});

test('FR-058/063 historical alias keeps operation and PR association references and archive dependencies', async t => {
  const f = await workItemFixture(t);
  const historical = await attachMonitor(f.store, {
    identity: identity(), origin: 'framework', workItemId: f.workItemId,
    schedulerAvailable: true, readAvailable: true,
  });
  const operation = {
    type: 'operation', id: 'op-alias-consumer', workItemId: f.workItemId,
    repositoryId: 'primary', class: 'build', action: { class: 'build' },
    target: 'fixture-build', status: 'uncertain', correlationKey: 'fixture-alias',
    requestFingerprint: digest('fixture-alias'), dispatchBound: true,
    evidenceRef: historical.key,
  };
  const pr = {
    type: 'pr', id: 'pr-alias-consumer', workItemId: f.workItemId,
    repositoryId: 'primary', provider, connection: 'fixture-connection',
    sourceRevision: 'a'.repeat(40), targetRevision: 'b'.repeat(40),
  };
  await f.store.transaction(f.workItemId, tx => {
    tx.put(operation);
    tx.put(pr);
  });
  const associationInput = {
    runKey: historical.key, workItemId: f.workItemId, prRecordId: pr.id,
    checkId: 'check-alias', sourceRevision: pr.sourceRevision,
    targetRevision: pr.targetRevision, evidenceRef: 'fixture:association',
  };
  const association = await associateMonitor(f.store, associationInput);
  const before = await f.store.records(f.workItemId);
  assert.equal((await attach(f.store, currentIdentity())).key, historical.key);
  assert.deepEqual(await readMonitorAssociation(f.store, associationInput), association);
  assert.deepEqual(await f.store.records(f.workItemId), before);
  assert.equal(before.find(record => record.id === operation.id).evidenceRef, historical.key);
  await complete(f.store, historical);
  await assert.rejects(pruneMonitor(f.store, { runKey: historical.key }), { code: 'MONITOR' });
  assert.equal((await attach(f.store, currentIdentity())).key, historical.key);
  assert.equal(await readMonitor(f.store, runKey(currentIdentity())), null);
  await f.store.transaction(f.workItemId, tx => tx.remove(operation.id));
  assert.equal((await pruneMonitor(f.store, { runKey: historical.key })).archived, true);
  assert.equal((await attach(f.store, currentIdentity())).key, historical.key);
  assert.deepEqual(await readMonitorAssociation(f.store, associationInput), association);
});

test('FR-058 historical alias cannot satisfy a current PR check even with freshly verified result bytes', async t => {
  const f = await workItemFixture(t);
  const observation = {
    provider, connection: 'fixture-connection',
    localRepositoryPath: f.repo, remoteRepositoryURL: 'https://example.invalid/repository.git',
    repositoryRef: 'repository', pullRequestRef: 'pull-request',
    sourceBranchRef: 'refs/heads/feature', targetBranchRef: 'refs/heads/main',
    sourceRevision: 'a'.repeat(40), targetRevision: 'b'.repeat(40),
    state: 'active', sequence: 1, observedAt: new Date(f.clock.now()).toISOString(),
    evidenceRef: 'fixture:pr-observation',
  };
  const pr = {
    type: 'pr-observation', workItemId: f.workItemId, repositoryId: 'primary',
    ...observation,
    id: pullRequestObservationKey(observation, {
      canonicalLocalRepositoryPath: observation.localRepositoryPath,
      verifiedRemoteRepositoryURL: observation.remoteRepositoryURL,
      verifiedProvider: provider, verifiedConnection: observation.connection,
      verifiedRepositoryRef: observation.repositoryRef,
      verifiedPullRequestRef: observation.pullRequestRef,
    }),
  };
  await f.store.transaction(f.workItemId, tx => tx.put(pr));
  const historical = await attach(f.store, identity());
  const claimed = await claimMonitor(f.store, {
    runKey: historical.key, workerId: 'history-check-worker',
  });
  const poll = await beginPoll(f.store, worker(claimed));
  const file = path.join(f.root, 'alias-result.bin');
  const bytes = Buffer.from('Fixture immutable check result');
  await fs.writeFile(file, bytes);
  const evidence = { reference: {
    locator: 'fixture:alias-check',
    retrievalContext: { provider, connection: 'fixture-connection',
      scopeRef: 'fixture-scope', retrievedAt: new Date(f.clock.now()).toISOString() },
    sha256: digest(bytes),
  } };
  const result = {
    requiredCheckRef: 'required-check', checkResultRef: 'check-result',
    producerRef: historical.identity.definitionRef, testedRevision: pr.sourceRevision,
    evidenceRef: 'fixture:check-result', status: 'succeeded',
    localRepositoryPath: pr.localRepositoryPath, remoteRepositoryURL: pr.remoteRepositoryURL,
    repositoryRef: pr.repositoryRef, pullRequestRef: pr.pullRequestRef,
    sourceRevision: pr.sourceRevision, targetRevision: pr.targetRevision,
  };
  f.store.verifyCheckResults = () => ({
    identity: historical.identity, status: 'succeeded',
    evidenceReference: evidence.reference, checkResults: [result],
  });
  const observed = await observeMonitor(f.store, {
    ...worker(claimed), pollGeneration: poll.pollGeneration, identity: historical.identity,
    status: 'succeeded', evidence, evidenceFilePath: file, checkResults: [result],
  });
  assert.equal(observed.evidenceVerification.verified, true);
  const linked = await verifyMonitorLink(f.store, {
    runKey: historical.key, adapterId: provider,
    observation: { identity: historical.identity, url: 'https://ci.example.invalid/run',
      kind: 'summary', accessible: true },
    evidenceRef: 'fixture:alias-link',
  });
  assert.equal(linked.link.status, 'verified');
  assert.deepEqual(await attach(f.store, currentIdentity()), linked);
  const associationInput = {
    runKey: historical.key, workItemId: f.workItemId,
    prRecordId: pr.id, prObservationKey: pr.id, checkId: result.requiredCheckRef,
    localRepositoryPath: pr.localRepositoryPath, remoteRepositoryURL: pr.remoteRepositoryURL,
    requiredCheckRef: result.requiredCheckRef, checkResultRef: result.checkResultRef,
    producerRef: result.producerRef, testedRevision: pr.sourceRevision,
    sourceRevision: pr.sourceRevision, targetRevision: pr.targetRevision,
    evidenceRef: result.evidenceRef, evidence,
  };
  await assert.rejects(associateMonitor(f.store, associationInput), {
    code: 'EVIDENCE',
    message: 'Current execution identity requires an explicit attempt kind',
  });
  assert.equal(await readMonitorAssociation(f.store, associationInput), null);
  assert.deepEqual(await readMonitor(f.store, historical.key), linked);
});

test('FR-059 active current alias wins over historical archive without rewriting either record', async t => {
  const store = await fixture(t);
  const historical = await attach(store, identity());
  await complete(store, historical);
  await pruneMonitor(store, { runKey: historical.key });
  const bytes = await fs.readFile(archivePath(store, historical.key));
  const currentKey = runKey(currentIdentity());
  const active = { ...historical, key: currentKey, identity: currentIdentity(),
    workerId: 'current-owner', claimGeneration: 3, pollGeneration: 2, inFlight: true };
  await fs.writeFile(activePath(store, currentKey), `${JSON.stringify(active)}\n`);
  const activeBytes = await fs.readFile(activePath(store, currentKey));
  assert.deepEqual(await attach(store, identity()), active);
  assert.deepEqual(await attach(store, currentIdentity()), active);
  assert.deepEqual(await fs.readFile(activePath(store, currentKey)), activeBytes);
  assert.deepEqual(await fs.readFile(archivePath(store, historical.key)), bytes);
  await assert.rejects(claimMonitor(store, {
    runKey: currentKey, workerId: 'wrong-owner',
  }), { code: 'LOCK_BUSY' });
  assert.deepEqual((await dueMonitors(store)).map(record => record.runKey), [currentKey]);
});

test('FR-059 an alias filename with a contradictory identity fails without changing evidence', async t => {
  const store = await fixture(t);
  const historical = await attach(store, identity());
  const currentKey = runKey(currentIdentity());
  const contradictory = { ...historical, key: currentKey,
    identity: currentIdentity({ attemptRef: 'attempt-other' }) };
  await fs.unlink(activePath(store, historical.key));
  await fs.mkdir(path.dirname(archivePath(store, currentKey)), { recursive: true });
  await fs.writeFile(archivePath(store, currentKey),
    `${JSON.stringify(contradictory)}\n`, { flag: 'wx' });
  const before = await fs.readFile(archivePath(store, currentKey));
  await assert.rejects(attach(store, identity()), { code: 'ID_CONFLICT' });
  assert.deepEqual(await fs.readFile(archivePath(store, currentKey)), before);
  assert.equal(await readActiveMonitor(store, historical.key), null);
  assert.equal(await readActiveMonitor(store, currentKey), null);
});
