export const validationDeclarations = {
  "schemaVersion": 1,
  "surfaces": [{"coverage": "direct", "paths": ["src/github/store-bridge.mjs"]}],
  "variants": [
    {"expression": "`actual host ${family} result`", "domains": {"family": ["execution", "artifact", "deployment", "test", "pull-request", "git-ref", "merge", "policy", "notification"]}},
    {"expression": "timing", "names": ["before", "during-IAM", "rejecting-IAM", "rejecting-unaborted-IAM"]},
    {"expression": "kind", "names": ["default", "private-error", "private-object", "ordinary-error"], "parentNames": {"default": ["before", "during-IAM", "rejecting-IAM"], "private-error": ["before", "during-IAM", "rejecting-IAM"], "private-object": ["before", "during-IAM", "rejecting-IAM"], "ordinary-error": ["rejecting-unaborted-IAM"]}},
    {"expression": "mode", "names": ["missing", "non-true"]}
  ]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubHost, createGitHubStore } from 'ai-sdlc-framework/github';
import { bridgeFixture, durableBytes, families } from './fixtures/github-store-bridge.mjs';
import { digest } from '../src/core.mjs';
import { recordTest } from '../src/validation.mjs';
import { claimOperationDispatch } from '../src/operations.mjs';

function trustedVerifiers(f) {
  const { clock, ...verifiers } = f.bridge.storeOptions();
  void clock;
  return verifiers;
}

test('public host legacy bridge denies IAM before claim and admits one exact actual publication through the existing consumer', async t => {
  const f = await bridgeFixture(t);
  const seed = await f.prepare('notification', '', { claim: false });
  const action = { ...seed.preparation.operation.action };
  delete action.operationId;
  await f.bridge.legacyOperations.recordResult(seed.preparation, {
    workItemId: f.workItemId, operationId: seed.preparation.operation.id, status: 'not-started',
    observedResult: f.nonDispatch(seed, 'cancelled-before-claim'),
  }, f.store);
  let allowed = false, sequence = 0;
  const authorized = [];
  const host = createGitHubHost({
    connections: [{ connection: f.connection, transport: f.transport }],
    clock: f.clock, identifier: () => `host-legacy-${++sequence}`, verifiers: trustedVerifiers(f),
    authorize(operation) { authorized.push(operation); return allowed; },
  });
  const store = await createGitHubStore(f.home, host).ready();
  const preparation = await host.legacyOperations.prepare({
    workItemId: f.workItemId, sessionId: f.sessionId, operationId: 'op-host-publication', action,
    request: { toolName: 'github-existing-consumer',
      toolArgs: { family: 'notification', suffix: '-host-publication' }, cwd: f.repo },
    correlationKey: 'host-publication', intent: 'Publish the exactly authorized controlled fixture content',
  }, store);
  const calls = f.calls.length;
  await assert.rejects(host.legacyOperations.claimDispatch(preparation, store), { code: 'AUTHORITY' });
  assert.equal(f.calls.length, calls);
  assert.equal((await store.records(f.workItemId)).find(record => record.id === preparation.operation.id)
    .dispatchBound, false);
  assert.equal(authorized[0].id, preparation.operation.id);
  assert.throws(() => { preparation.operation.action.recipient = 'foreign'; }, TypeError);
  allowed = true;
  const fault = store.fault;
  store.fault = async point => {
    if (point === 'dispatch:validated') throw new Error('Controlled host pre-claim fault');
  };
  await assert.rejects(host.legacyOperations.claimDispatch(preparation, store), /Controlled host pre-claim fault/u);
  const unclaimed = (await store.records(f.workItemId)).find(record => record.id === preparation.operation.id);
  assert.equal(unclaimed.status, 'prepared');
  assert.equal(unclaimed.dispatchBound, false);
  assert.equal(f.calls.length, calls);
  store.fault = fault;
  const claim = await host.legacyOperations.claimDispatch(preparation, store);
  assert.equal(claim.operation.dispatchBound, true);
  const observedResult = await f.result({ preparation, claim });
  const result = await host.legacyOperations.recordResult(preparation, {
    workItemId: f.workItemId, operationId: claim.operation.id, status: 'succeeded', observedResult,
  }, store);
  assert.equal(result.status, 'succeeded');
  assert.equal(result.intendedOutcome.family, 'notification');
  assert.equal(result.resultProof.providerResultId, 'comment:1001');
  assert.equal(result.resultProof.dispatchId, claim.operation.id);
  assert.equal(result.resultProof.causalKey, `host:${digest(claim.hostCallId)}`);
  assert.equal(result.nativeIntent, undefined);
  await assert.rejects(host.legacyOperations.claimDispatch(preparation, store), { code: 'EVIDENCE' });
  assert.equal(f.calls.length, calls + 1);
});

test('host bridge post-claim environment projection failure remains durably uncertain and never dispatches or retries', async t => {
  const f = await bridgeFixture(t);
  const seed = await f.prepare('execution', '', { claim: false });
  const action = { ...seed.preparation.operation.action, implicitEnvironments: ['DEV'] };
  delete action.operationId;
  await f.bridge.legacyOperations.recordResult(seed.preparation, {
    workItemId: f.workItemId, operationId: seed.preparation.operation.id, status: 'not-started',
    observedResult: f.nonDispatch(seed, 'cancelled-before-claim'),
  }, f.store);
  let sequence = 0;
  const host = createGitHubHost({
    connections: [{ connection: f.connection, transport: f.transport }],
    clock: f.clock, verifiers: trustedVerifiers(f), identifier: () => `projection-host-${++sequence}`,
    authorize: () => true,
  });
  const store = await createGitHubStore(f.home, host).ready();
  const preparation = await host.legacyOperations.prepare({
    workItemId: f.workItemId, sessionId: f.sessionId, operationId: 'op-host-projection-fault', action,
    request: { toolName: 'github-existing-consumer', toolArgs: { family: 'execution' }, cwd: f.repo },
    correlationKey: 'host-projection-fault', intent: 'Validate controlled post-claim projection interruption',
  }, store);
  const transaction = store.transaction.bind(store);
  let interrupted = false;
  store.transaction = async (workItemId, callback, options) => {
    const saved = (await store.records(workItemId)).find(record => record.id === preparation.operation.id);
    if (!interrupted && saved?.status === 'dispatching' && saved.dispatchBound === true) {
      interrupted = true;
      throw new Error('Controlled post-claim projection interruption');
    }
    return transaction(workItemId, callback, options);
  };
  const calls = f.calls.length;
  await assert.rejects(host.legacyOperations.claimDispatch(preparation, store),
    /Controlled post-claim projection interruption/u);
  assert.equal(interrupted, true);
  const saved = (await store.records(f.workItemId)).find(record => record.id === preparation.operation.id);
  assert.equal(saved.status, 'uncertain');
  assert.equal(saved.dispatchBound, true);
  assert.deepEqual(saved.hostInvocation, preparation.operation.hostInvocation);
  assert.equal(f.calls.length, calls);
  await assert.rejects(host.legacyOperations.claimDispatch(preparation, store), { code: 'EVIDENCE' });
  assert.equal(f.calls.length, calls);
});

test('all nine result families use public host atomic claims and actual existing Store admission', async t => {
  const f = await bridgeFixture(t);
  let counter = 0;
  const host = createGitHubHost({
    connections: [{ connection: f.connection, transport: f.transport }],
    verifiers: trustedVerifiers(f), clock: f.clock,
    identifier: () => `nine-family-host-${++counter}`, authorize: () => true,
  });
  const store = await createGitHubStore(f.home, host).ready();
  const executed = [];
  for (const family of ['execution', 'artifact', 'deployment', 'test', 'pull-request', 'git-ref', 'merge', 'policy', 'notification']) {
    await t.test(`actual host ${family} result`, async () => {
      if (['test', 'pull-request', 'git-ref'].includes(family)) {
        for (const testId of ['T-unit', 'T-integration']) await recordTest(store, {
          workItemId: f.workItemId, cycleId: f.cycle.id, testId, status: 'Passed',
          owner: 'agent', host: 'local', expectedMet: true, evidenceRef: `fixture:host-before-${family}:${testId}`,
        });
      }
      const seed = await f.prepare(family, '', { claim: false });
      await f.bridge.legacyOperations.recordResult(seed.preparation, {
        workItemId: f.workItemId, operationId: seed.preparation.operation.id, status: 'not-started',
        observedResult: f.nonDispatch(seed, 'cancelled-before-claim'),
      }, f.store);
      const action = { ...seed.preparation.operation.action };
      delete action.operationId;
      const preparation = await host.legacyOperations.prepare({
        workItemId: f.workItemId, sessionId: f.sessionId, operationId: `op-host-${family}`, action,
        request: { toolName: 'github-existing-consumer', toolArgs: { family }, cwd: f.repo },
        correlationKey: `host-family-${family}`, intent: `Admit the actual controlled ${family} result`,
      }, store);
      const claim = await host.legacyOperations.claimDispatch(preparation, store);
      assert.equal(claim.operation.status, 'dispatching');
      assert.equal(claim.operation.dispatchBound, true);
      const observedResult = await f.result({ preparation, claim });
      const bad = f.variant(observedResult, value => { value.observation.causalProof.hostCallId = 'other-call'; });
      const beforeRejection = await store.records(f.workItemId);
      await assert.rejects(host.legacyOperations.recordResult(preparation, {
        workItemId: f.workItemId, operationId: claim.operation.id, status: 'succeeded', observedResult: bad,
      }, store), { code: 'EVIDENCE' });
      assert.deepEqual(await store.records(f.workItemId), beforeRejection);
      const result = await host.legacyOperations.recordResult(preparation, {
        workItemId: f.workItemId, operationId: claim.operation.id, status: 'succeeded', observedResult,
      }, store);
      assert.equal(result.status, 'succeeded');
      assert.equal(result.nativeIntent, undefined);
      assert.equal(result.intendedOutcome.family, family);
      assert.equal(result.resultProof.dispatchId, result.id);
      assert.equal(result.resultProof.causalKey, `host:${digest(claim.hostCallId)}`);
      assert.deepEqual((await store.records(f.workItemId)).find(record => record.id === result.id).resultProof,
        result.resultProof);
      if (family === 'execution') await f.selectArtifact(result);
      if (family === 'deployment') f.deployment = result;
      executed.push(family);
    });
  }
  assert.deepEqual([...executed].sort(), [...families].sort());
});

test('host cancellation before and during awaited IAM leaves the original operation unclaimed with zero effects', async t => {
  const f = await bridgeFixture(t);
  let counter = 0, authorizations = 0, cancellation, reason, timing;
  const host = createGitHubHost({
    clock: f.clock, verifiers: trustedVerifiers(f), identifier: () => `cancellation-${++counter}`,
    async authorize() {
      authorizations++;
      await Promise.resolve();
      if (timing === 'rejecting-unaborted-IAM') throw reason;
      cancellation.abort(reason);
      if (timing === 'rejecting-IAM') cancellation.signal.throwIfAborted();
      return true;
    },
  });
  const store = await createGitHubStore(f.home, host).ready();
  const preparation = await host.legacyOperations.prepare({
    workItemId: f.workItemId, sessionId: f.sessionId, operationId: 'op-cancel',
    action: { class: 'local-build', repositoryId: 'primary' },
    request: { toolName: 'github-existing-consumer', toolArgs: { cancellation: true }, cwd: f.repo },
    correlationKey: 'cancel', intent: 'Cancel the original isolated host claim',
  }, store);
  for (timing of ['before', 'during-IAM', 'rejecting-IAM', 'rejecting-unaborted-IAM']) {
    await t.test(timing, async timingTest => {
      const kinds = timing === 'rejecting-unaborted-IAM' ? ['ordinary-error'] :
        ['default', 'private-error', 'private-object'];
      for (const kind of kinds) {
        await timingTest.test(kind, async () => {
          let getterReads = 0;
          reason = kind === 'ordinary-error' ? new Error('Controlled IAM authorization failure') :
            kind === 'default' ? undefined : kind === 'private-error' ?
            new Error('fake-private-authorization', { cause: { response: 'fake-private-response' } }) :
            { message: 'fake-private-object', cause: { response: 'fake-private-response' } };
          if (reason) Object.defineProperty(reason, 'privateDetails', {
            get() { getterReads++; throw new Error('fake-private-getter'); },
          });
          cancellation = new AbortController();
          if (timing === 'before') cancellation.abort(reason);
          const before = await durableBytes(f);
          const calls = f.calls.length, iam = authorizations;
          await assert.rejects(host.legacyOperations.claimDispatch(preparation, store,
            { signal: cancellation.signal }), error => {
            if (timing === 'rejecting-unaborted-IAM') {
              assert.equal(error, reason);
              return true;
            }
            assert.equal(error.name, 'AbortError');
            assert.equal(error.message, 'GitHub dispatch was cancelled');
            assert.notEqual(error, reason);
            assert.equal(error.cause, undefined);
            assert.equal(Object.hasOwn(error, 'privateDetails'), false);
            assert.doesNotMatch(String(error.stack), /fake-private-/u);
            return true;
          });
          assert.equal(getterReads, 0);
          assert.equal(authorizations, iam + (timing === 'before' ? 0 : 1));
          assert.equal(f.calls.length, calls);
          assert.deepEqual(await durableBytes(f), before);
          const saved = (await store.records(f.workItemId)).find(record => record.id === preparation.operation.id);
          assert.equal(saved.status, 'prepared');
          assert.equal(saved.dispatchBound, false);
        });
      }
    });
  }
});

test('T-GHB11 concurrent public host claims preserve the winner and one causal publication', async t => {
  const f = await bridgeFixture(t);
  const seed = await f.prepare('notification', '', { claim: false });
  const action = { ...seed.preparation.operation.action };
  delete action.operationId;
  await f.bridge.legacyOperations.recordResult(seed.preparation, {
    workItemId: f.workItemId, operationId: seed.preparation.operation.id,
    status: 'not-started', observedResult: f.nonDispatch(seed, 'cancelled-before-claim'),
  }, f.store);
  let arrivals = 0, release, entered;
  const barrier = new Promise(resolve => { release = resolve; });
  const authorizing = new Promise(resolve => { entered = resolve; });
  const host = createGitHubHost({
    clock: f.clock, verifiers: trustedVerifiers(f), identifier: () => 'concurrent-host-call',
    async authorize() {
      if (++arrivals === 1) {
        entered();
        await barrier;
      }
      return true;
    },
  });
  const store = await createGitHubStore(f.home, host).ready();
  const preparation = await host.legacyOperations.prepare({
    workItemId: f.workItemId, sessionId: f.sessionId,
    operationId: 'op-concurrent-publication', action,
    request: { toolName: 'github-existing-consumer',
      toolArgs: { family: 'notification', concurrent: true }, cwd: f.repo },
    correlationKey: 'concurrent-publication', intent: 'Claim one exact controlled publication concurrently',
  }, store);
  const calls = f.calls.length;
  const first = Promise.allSettled([host.legacyOperations.claimDispatch(preparation, store)]);
  await authorizing;
  let second;
  try {
    second = await Promise.allSettled([host.legacyOperations.claimDispatch(preparation, store)]);
  } finally { release(); }
  const outcomes = [...await first, ...second];
  assert.equal(arrivals, 1);
  const winners = outcomes.filter(outcome => outcome.status === 'fulfilled');
  const losers = outcomes.filter(outcome => outcome.status === 'rejected');
  assert.equal(winners.length, 1);
  assert.equal(losers.length, 1);
  const saved = (await store.records(f.workItemId)).find(record => record.id === preparation.operation.id);
  assert.equal(saved.status, 'dispatching', 'A losing duplicate claim must not invalidate its successful winner');
  assert.ok(['UNCERTAIN', 'EVIDENCE'].includes(losers[0].reason.code));
  assert.equal(saved.dispatchBound, true);
  assert.equal(f.calls.length, calls);
  const claim = winners[0].value;
  const observedResult = await f.result({ preparation, claim });
  const result = await host.legacyOperations.recordResult(preparation, {
    workItemId: f.workItemId, operationId: claim.operation.id, status: 'succeeded', observedResult,
  }, store);
  assert.equal(result.status, 'succeeded');
  assert.equal(result.resultProof.dispatchId, preparation.operation.id);
  assert.equal(f.calls.length, calls + 1);
  await assert.rejects(host.legacyOperations.claimDispatch(preparation, store), { code: 'EVIDENCE' });
  assert.equal(f.calls.length, calls + 1);
});

test('public host concurrent claims across Store instances preserve one durable winner', async t => {
  const f = await bridgeFixture(t);
  const seed = await f.prepare('notification', '', { claim: false });
  const action = { ...seed.preparation.operation.action };
  delete action.operationId;
  await f.bridge.legacyOperations.recordResult(seed.preparation, {
    workItemId: f.workItemId, operationId: seed.preparation.operation.id,
    status: 'not-started', observedResult: f.nonDispatch(seed, 'cancelled-before-claim'),
  }, f.store);
  let arrivals = 0, release, entered;
  const barrier = new Promise(resolve => { release = resolve; });
  const authorizing = new Promise(resolve => { entered = resolve; });
  const host = createGitHubHost({
    clock: f.clock, verifiers: trustedVerifiers(f), identifier: () => 'shared-store-host-call',
    async authorize() {
      if (++arrivals === 1) {
        entered();
        await barrier;
      }
      return true;
    },
  });
  const stores = await Promise.all([1, 2].map(() => createGitHubStore(f.home, host).ready()));
  const input = {
    workItemId: f.workItemId, sessionId: f.sessionId, operationId: 'op-shared-store-publication', action,
    request: { toolName: 'github-existing-consumer',
      toolArgs: { family: 'notification', sharedStores: true }, cwd: f.repo },
    correlationKey: 'shared-store-publication', intent: 'Preserve the winning claim across selected-home Stores',
  };
  const preparations = [];
  for (const store of stores) preparations.push(await host.legacyOperations.prepare(input, store));
  const calls = f.calls.length;
  const first = Promise.allSettled([host.legacyOperations.claimDispatch(preparations[0], stores[0])]);
  await authorizing;
  let second;
  try {
    second = await Promise.allSettled([host.legacyOperations.claimDispatch(preparations[1], stores[1])]);
  } finally { release(); }
  const outcomes = [...await first, ...second];
  const winners = outcomes.flatMap((outcome, index) =>
    outcome.status === 'fulfilled' ? [{ ...outcome, index }] : []);
  assert.equal(winners.length, 1);
  assert.equal(outcomes.filter(outcome => outcome.status === 'rejected').length, 1);
  const saved = (await stores[0].records(f.workItemId)).find(record => record.id === input.operationId);
  assert.equal(saved.status, 'dispatching', 'The losing Store must not invalidate another Store claim');
  assert.equal(saved.dispatchBound, true);
  assert.equal(arrivals, 1);
  assert.equal(f.calls.length, calls);
  const winner = winners[0];
  const preparation = preparations[winner.index];
  const observedResult = await f.result({ preparation, claim: winner.value });
  const result = await host.legacyOperations.recordResult(preparation, {
    workItemId: f.workItemId, operationId: input.operationId, status: 'succeeded', observedResult,
  }, stores[winner.index]);
  assert.equal(result.status, 'succeeded');
  assert.equal(result.resultProof.dispatchId, input.operationId);
  assert.equal(f.calls.length, calls + 1);
});

test('a competing atomic claim is not changed to uncertain by a losing public host', async t => {
  const f = await bridgeFixture(t);
  const seed = await f.prepare('notification', '', { claim: false });
  const action = { ...seed.preparation.operation.action };
  delete action.operationId;
  await f.bridge.legacyOperations.recordResult(seed.preparation, {
    workItemId: f.workItemId, operationId: seed.preparation.operation.id,
    status: 'not-started', observedResult: f.nonDispatch(seed, 'cancelled-before-claim'),
  }, f.store);
  let release, entered;
  const barrier = new Promise(resolve => { release = resolve; });
  const authorizing = new Promise(resolve => { entered = resolve; });
  const hostCallId = 'competing-atomic-host-call';
  const host = createGitHubHost({
    clock: f.clock, verifiers: trustedVerifiers(f), identifier: () => hostCallId,
    async authorize() { entered(); await barrier; return true; },
  });
  const store = await createGitHubStore(f.home, host).ready();
  const competitor = await createGitHubStore(f.home, host).ready();
  const request = { toolName: 'github-existing-consumer',
    toolArgs: { family: 'notification', competingAtomicClaim: true }, cwd: f.repo };
  const preparation = await host.legacyOperations.prepare({
    workItemId: f.workItemId, sessionId: f.sessionId, operationId: 'op-competing-atomic-publication',
    action, request, correlationKey: 'competing-atomic-publication',
    intent: 'Retain another successful atomic claim without granting a second effect',
  }, store);
  const calls = f.calls.length;
  const pending = Promise.allSettled([host.legacyOperations.claimDispatch(preparation, store)]);
  await authorizing;
  let operation;
  try {
    operation = await claimOperationDispatch(competitor, {
      workItemId: f.workItemId, operationId: preparation.operation.id,
      invocation: { ...request, sessionId: f.sessionId },
      adapterContract: host.adapterContract, hostCallId,
    });
  } finally { release(); }
  const [loser] = await pending;
  assert.equal(loser.status, 'rejected');
  assert.equal(loser.reason.code, 'UNCERTAIN');
  const saved = (await store.records(f.workItemId)).find(record => record.id === operation.id);
  assert.equal(saved.status, 'dispatching', 'A refused atomic claim must leave the winner unchanged');
  assert.equal(saved.dispatchBound, true);
  assert.equal(f.calls.length, calls);
  const claim = { operation, hostCallId, adapterContract: host.adapterContract };
  const observedResult = await f.result({ preparation, claim });
  const result = await host.legacyOperations.recordResult(preparation, {
    workItemId: f.workItemId, operationId: operation.id, status: 'succeeded', observedResult,
  }, store);
  assert.equal(result.status, 'succeeded');
  assert.equal(f.calls.length, calls + 1);
});

test('T-GHB12 missing and non-true IAM leave preparations unclaimed without effects', async t => {
  for (const mode of ['missing', 'non-true']) {
    await t.test(mode, async t => {
      const f = await bridgeFixture(t);
      let authorization;
      const host = createGitHubHost({
        clock: f.clock, verifiers: trustedVerifiers(f),
        ...(mode === 'missing' ? {} : { authorize: async () => authorization }),
      });
      const store = await createGitHubStore(f.home, host).ready();
      const preparation = await host.legacyOperations.prepare({
        workItemId: f.workItemId, sessionId: f.sessionId,
        operationId: `op-iam-${mode}`, action: { class: 'local-build', repositoryId: 'primary' },
        request: { toolName: 'github-existing-consumer', toolArgs: { iamVariant: mode }, cwd: f.repo },
        correlationKey: `iam-${mode}`, intent: 'Reject absent or non-true independent host permission',
      }, store);
      const before = await durableBytes(f), calls = f.calls.length;
      for (const value of mode === 'missing' ? [undefined] : [false, undefined, null, 0, 1, 'true', {}]) {
        authorization = value;
        await assert.rejects(host.legacyOperations.claimDispatch(preparation, store), { code: 'AUTHORITY' });
      }
      assert.deepEqual(await durableBytes(f), before);
      const saved = (await store.records(f.workItemId)).find(record => record.id === preparation.operation.id);
      assert.equal(saved.status, 'prepared');
      assert.equal(saved.dispatchBound, false);
      assert.equal(f.calls.length, calls);
    });
  }
});
