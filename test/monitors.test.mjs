import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { attachMonitor, refreshMonitorCapabilities, claimMonitor, beginPoll, observeMonitor, verifyMonitorLink, monitorNotice, interruptMonitor, dueMonitors, pruneMonitor } from '../src/monitors.mjs';
import { azureDevOpsScopeRef, registerProviderAdapter } from '../src/provider-adapters.mjs';

const identity = (executionRef, overrides = {}) => ({
  provider: 'azure-devops',
  connection: 'fixture',
  scopeRef: azureDevOpsScopeRef({
    projectId: 'project-id',
    repositoryId: 'repository-id',
  }),
  definitionRef: '17',
  executionRef,
  ...overrides,
});
const observation = (executionRef, {
  definitionId = '17',
  metadataBuildId = executionRef,
  finalBuildId = executionRef,
  accessible = true,
} = {}) => ({
  connection: 'fixture',
  build: {
    id: executionRef,
    project: { id: 'project-id' },
    repository: { id: 'repository-id' },
    definition: { id: definitionId },
    _links: {
      web: {
        href: `https://dev.azure.com/example/project/_build/results?buildId=${metadataBuildId}&view=results`,
      },
    },
  },
  access: {
    accessible,
    finalUrl: `https://dev.azure.com/example/project/_build/results?buildId=${finalBuildId}&view=summary`,
  },
});

test('T-25/T-30 standalone user-reported runs poll immediately and every fake-clock minute without granting authority', async t => {
  const f = await fixture(t, { initialize: false });
  const runIdentity = identity('42');
  const attached = await attachMonitor(f.store, { identity: runIdentity,
    origin: 'user-reported', reportingReceiptId: 'receipt-reported', environment: 'PROD', schedulerAvailable: true, readAvailable: true });
  const claim = await claimMonitor(f.store, { runKey: attached.key, workerId: 'worker-one' });
  await assert.rejects(pruneMonitor(f.store, { runKey: attached.key }), { code: 'MONITOR' });
  const worker = { runKey: attached.key, workerId: 'worker-one', claimGeneration: claim.claimGeneration };
  let poll = await beginPoll(f.store, worker);
  await assert.rejects(beginPoll(f.store, worker), { code: 'MONITOR' });
  await claimMonitor(f.store, { runKey: attached.key, workerId: 'worker-one' });
  await assert.rejects(beginPoll(f.store, worker), { code: 'MONITOR' });
  let result = await observeMonitor(f.store, { ...worker,
    pollGeneration: poll.pollGeneration, identity: runIdentity,
    status: 'running', evidenceRef: 'fixture:run-read' });
  const firstPollGeneration = poll.pollGeneration;
  assert.equal(result.monitorStatus, 'active');
  assert.equal(result.link.status, 'pending');
  assert.equal(Date.parse(result.nextPollAt), f.clock.now() + 60000);
  await verifyMonitorLink(f.store, { runKey: attached.key,
    adapterId: 'azure-devops',
    observation: observation('42', {
      finalBuildId: '999',
    }),
    evidenceRef: 'fixture:wrong-final-run' });
  assert.equal((await monitorNotice(f.store, { runKey: attached.key })).link.status, 'unverified');
  f.clock.advance(60000);
  assert.equal((await dueMonitors(f.store)).length, 1);
  poll = await beginPoll(f.store, worker);
  await assert.rejects(observeMonitor(f.store, { ...worker,
    pollGeneration: firstPollGeneration, identity: runIdentity,
    status: 'running', evidenceRef: 'fixture:stale-poll' }),
  { code: 'STALE' });
  result = await observeMonitor(f.store, { ...worker,
    pollGeneration: poll.pollGeneration, identity: runIdentity,
    status: 'waiting-approval', evidenceRef: 'fixture:approval-wait' });
  assert.equal(result.monitorStatus, 'active');
  await verifyMonitorLink(f.store, { runKey: attached.key,
    adapterId: 'azure-devops', observation: observation('42'),
    evidenceRef: 'fixture:run-page' });
  const priorNotice = await monitorNotice(f.store, { runKey: attached.key });
  f.clock.advance(60000);
  poll = await beginPoll(f.store, worker);
  result = await observeMonitor(f.store, { ...worker,
    pollGeneration: poll.pollGeneration, identity: runIdentity,
    status: 'succeeded', evidenceRef: 'fixture:terminal' });
  assert.equal(result.nextPollAt, null);
  const notice = await monitorNotice(f.store, { runKey: attached.key });
  assert.match(notice.message, /user-reported/u);
  assert.equal(notice.notice.kind, 'terminal');
  assert.equal(notice.link.status, 'verified');
  await assert.rejects(monitorNotice(f.store, {
    runKey: attached.key,
    deliveredRef: 'fixture:stale-notification',
    noticeGeneration: priorNotice.notice.generation,
  }), { code: 'STALE' });
  assert.equal((await monitorNotice(f.store, {
    runKey: attached.key,
    deliveredRef: 'fixture:user-notified',
    noticeGeneration: notice.notice.generation,
  })).notice.status, 'delivered');
  assert.deepEqual(await dueMonitors(f.store), []);
  assert.equal((await pruneMonitor(f.store, { runKey: attached.key })).archived, true);
  assert.equal((await monitorNotice(f.store, { runKey: attached.key })).notice.status, 'delivered');
});
test('T-25 stale monitor workers, wrong run links and read failures retain observable gaps', async t => {
  const f = await fixture(t, { initialize: false });
  const runIdentity = identity('2', { definitionRef: '1' });
  const attached = await attachMonitor(f.store, { identity: runIdentity,
    origin: 'framework', schedulerAvailable: true, readAvailable: true });
  const claim = await claimMonitor(f.store, { runKey: attached.key, workerId: 'old-worker' });
  const old = { runKey: attached.key, workerId: 'old-worker', claimGeneration: claim.claimGeneration };
  const poll = await beginPoll(f.store, old);
  await observeMonitor(f.store, { ...old,
    pollGeneration: poll.pollGeneration, identity: runIdentity,
    error: 'Provider read access unavailable' });
  f.clock.advance(180000);
  assert.equal((await dueMonitors(f.store))[0].gapDetected, true);
  await interruptMonitor(f.store, { runKey: attached.key, reason: 'Host stopped; polling was interrupted' });
  const replacement = await claimMonitor(f.store, { runKey: attached.key, workerId: 'new-worker', replaceInterrupted: true });
  await assert.rejects(beginPoll(f.store, old), { code: 'STALE' });
  assert.ok(replacement.gapCount > 0);
  const link = await verifyMonitorLink(f.store, { runKey: attached.key,
    adapterId: 'azure-devops',
    observation: observation('2', {
      definitionId: '1',
      metadataBuildId: '999',
    }),
    evidenceRef: 'fixture:wrong-run' });
  assert.equal(link.link.status, 'unverified');
  await assert.rejects(attachMonitor(f.store, { identity: runIdentity,
    origin: 'user-reported', reportingReceiptId: 'receipt-other', schedulerAvailable: true, readAvailable: true }), { code: 'ID_CONFLICT' });
});
test('T-25 blocked monitor capabilities recover only through explicit refresh evidence', async t => {
  const f = await fixture(t, { initialize: false });
  await assert.rejects(attachMonitor(f.store, { identity: identity('bad'),
    origin: 'framework',
    schedulerAvailable: 'false', readAvailable: 'false' }), { code: 'INPUT' });
  const attached = await attachMonitor(f.store, { identity: identity('3', {
    definitionRef: 'blocked',
  }), origin: 'framework', schedulerAvailable: false, readAvailable: false });
  await assert.rejects(claimMonitor(f.store, { runKey: attached.key, workerId: 'worker-blocked' }), { code: 'CAPABILITY' });
  await assert.rejects(beginPoll(f.store, { runKey: attached.key, workerId: null, claimGeneration: 0 }), { code: 'STALE' });
  const refreshed = await refreshMonitorCapabilities(f.store, { runKey: attached.key,
    schedulerAvailable: true, readAvailable: true, evidenceRef: 'fixture:capabilities-restored' });
  assert.equal(refreshed.monitorStatus, 'pending');
  const claim = await claimMonitor(f.store, { runKey: attached.key, workerId: 'worker-restored' });
  assert.equal(claim.workerId, 'worker-restored');
});

test('T-48 stale link callbacks cannot overwrite newer verification', async t => {
  const f = await fixture(t, { initialize: false });
  const provider = 'delayed-fixture-provider';
  let release;
  let started;
  const startedPromise = new Promise(resolve => { started = resolve; });
  const releasePromise = new Promise(resolve => { release = resolve; });
  registerProviderAdapter({
    id: provider,
    linkKinds: ['summary'],
    async normalizeLinkObservation(input) {
      if (input.delayed) {
        started();
        await releasePromise;
      }
      return {
        identity: input.identity,
        url: 'https://ci.example.invalid/job/api',
        kind: 'summary',
        accessible: input.accessible,
      };
    },
  });
  const runIdentity = {
    provider,
    connection: 'fixture',
    scopeRef: 'scope',
    definitionRef: 'definition',
    executionRef: 'execution',
  };
  const monitor = await attachMonitor(f.store, {
    identity: runIdentity,
    origin: 'framework',
    schedulerAvailable: true,
    readAvailable: true,
  });
  const older = verifyMonitorLink(f.store, {
    runKey: monitor.key,
    adapterId: provider,
    observation: {
      identity: runIdentity,
      delayed: true,
      accessible: true,
    },
    evidenceRef: 'fixture:older-success',
  });
  await startedPromise;
  const newer = await verifyMonitorLink(f.store, {
    runKey: monitor.key,
    adapterId: provider,
    observation: {
      identity: runIdentity,
      accessible: false,
    },
    evidenceRef: 'fixture:newer-failure',
  });
  assert.equal(newer.link.status, 'unverified');
  release();
  await older;
  assert.equal((await monitorNotice(f.store, {
    runKey: monitor.key,
  })).link.status, 'unverified');
});
