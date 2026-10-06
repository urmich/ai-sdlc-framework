import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { digest } from '../src/core.mjs';
import { prepareOperation, markDispatching, recordOperation } from '../src/operations.mjs';
import { fixture, coding, grant, observeFixtureRepository } from './helpers.mjs';

async function setup(t) {
  const f = await coding(await fixture(t));
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Verified provider retry fixture');
  const repository = await observeFixtureRepository(f);
  const action = { class: 'configuration', repositoryId: 'primary',
    target: 'branch-protection', policyVersion: 'policy-v2' };
  const prepare = (key, supplied = action, extra = {}) =>
    prepareOperation(f.store, {
      workItemId: f.workItemId, sessionId: f.sessionId,
      correlationKey: key, intent: 'Update the isolated hosted policy',
      action: supplied, request: { toolName: 'fixture_policy',
        toolArgs: { attempt: key, ...supplied }, cwd: f.repo }, ...extra,
    });
  const uncertain = async operation => {
    await markDispatching(f.store, f.workItemId, operation.id);
    return recordOperation(f.store, { workItemId: f.workItemId,
      operationId: operation.id, status: 'uncertain' });
  };
  return { f, repository, action, prepare, uncertain };
}

test('T-127 omitted then explicitly proven provider cannot bypass an uncertain public operation', async t => {
  const { f, repository, action, prepare, uncertain } = await setup(t);
  const first = await uncertain((await prepare('omitted')).operation);
  await assert.rejects(prepare('explicit', { ...action,
    provider: repository.provider }), { code: 'UNCERTAIN' });
  assert.deepEqual((await f.store.records(f.workItemId))
    .find(record => record.id === first.id), first);
});

test('T-127 explicit then omitted provider has the same identity and exact retry exceptions remain required', async t => {
  const { f, repository, action, prepare, uncertain } = await setup(t);
  const first = await uncertain((await prepare('explicit-first', {
    ...action, provider: repository.provider,
  })).operation);
  await assert.rejects(prepare('omitted-retry'), { code: 'UNCERTAIN' });
  const operationId = 'exact-provider-replacement';
  const exception = await grant(f, 'override', {
    rules: ['uncertain-retry'], scope: { repositoryIds: ['primary'],
      actions: ['configuration'], target: action.target, operationId },
    reason: 'Fixture user permits exactly one replacement of the uncertain effect',
  });
  const replacement = (await prepare('allowed', action, { operationId })).operation;
  assert.equal(replacement.intendedOutcome.digest, first.intendedOutcome.digest);
  assert.equal(replacement.retryOverrideId, exception.event.id);
  assert.equal(replacement.priorUncertainOperationId, first.id);
  await markDispatching(f.store, f.workItemId, replacement.id);
  await assert.rejects(prepare('unscoped-next'), { code: 'UNCERTAIN' });
});

test('T-127 independently verified omitted path URL source and provider canonicalize before action comparison', async t => {
  const { f, repository, action, prepare } = await setup(t);
  const first = (await prepare('canonical', action, { operationId: 'canonical-operation' })).operation;
  assert.equal(first.action.provider, repository.provider);
  assert.equal(first.intendedOutcome.requested.sourceRevision,
    await f.runGit('rev-parse', 'HEAD'));
  assert.equal(first.action.localRepositoryPath, f.repo);
  assert.equal(first.action.remoteRepositoryURL, repository.remoteRepositoryURL);
  const explicit = { ...action, provider: repository.provider,
    localRepositoryPath: f.repo, remoteRepositoryURL: repository.remoteRepositoryURL,
    sourceRevision: await f.runGit('rev-parse', 'HEAD') };
  // Exact tool-call identity stays distinct from the equivalent effect identity.
  await assert.rejects(prepare('canonical', explicit, {
    operationId: first.id,
  }), { code: 'ID_CONFLICT' });
  await assert.rejects(prepare('equivalent-effect', explicit), { code: 'UNCERTAIN' });
});

test('T-127 a conflicting explicit provider rejects instead of being overwritten', async t => {
  const { action, prepare } = await setup(t);
  await assert.rejects(prepare('wrong-provider', { ...action,
    provider: 'unverified-provider' }), { code: 'EVIDENCE' });
});

test('T-127 proof for another selected URL never supplies the current provider', async t => {
  const { f, action, prepare } = await setup(t);
  await f.runGit('remote', 'set-url', 'origin', 'https://example.invalid/other.git');
  await assert.rejects(prepare('changed-url', { ...action,
    provider: 'fixture' }), { code: 'EVIDENCE' });
});

test('T-127 local configuration remains local and gains no provider or external outcome', async t => {
  const { f, prepare } = await setup(t);
  await fs.writeFile(path.join(f.repo, 'local-config.json'), '{}\n');
  const local = (await prepare('local-config', { class: 'configuration',
    repositoryId: 'primary', target: 'local', paths: ['local-config.json'] })).operation;
  assert.equal(local.action.provider, undefined);
  assert.equal(local.intendedOutcome, undefined);
});

async function historicalOutcome(f, operation, { incomplete = false } = {}) {
  const old = structuredClone(operation);
  delete old.action.provider;
  delete old.intendedOutcome.target.provider;
  if (incomplete) {
    delete old.action.sourceRevision;
    delete old.action.configDigest;
    delete old.intendedOutcome.requested.sourceRevision;
    delete old.intendedOutcome.requested.configDigest;
  }
  const { digest: ignoredDigest, ...content } = old.intendedOutcome;
  void ignoredDigest;
  old.intendedOutcome.digest = digest(content);
  const { operationId: ignoredId, ...effect } = old.action;
  void ignoredId;
  old.effectFingerprint = digest(effect);
  await f.store.transaction(f.workItemId, tx => tx.put(old));
  return { old, bytes: await fs.readFile(f.store.recordPath(f.workItemId, old.id)) };
}

test('closure historical normalized outcome without provider still blocks an equivalent current retry without rewriting bytes', async t => {
  const { f, action, repository, prepare, uncertain } = await setup(t);
  const first = await uncertain((await prepare('historical-normalized')).operation);
  const { old, bytes } = await historicalOutcome(f, first);
  assert.notEqual(old.intendedOutcome.digest, first.intendedOutcome.digest);
  await assert.rejects(prepare('historical-current-retry', {
    ...action, provider: repository.provider,
  }), { code: 'UNCERTAIN' });
  assert.deepEqual(await fs.readFile(f.store.recordPath(f.workItemId, old.id)), bytes);
  const different = (await prepare('known-different-change', {
    ...action, policyVersion: 'policy-v3', provider: repository.provider,
  })).operation;
  assert.equal(different.status, 'prepared');
  assert.equal(different.priorUncertainOperationId, undefined);
});

test('closure incomplete historical outcome cannot borrow current HEAD and an exception remains exact action scoped', async t => {
  const { f, action, repository, prepare, uncertain } = await setup(t);
  const first = await uncertain((await prepare('historical-incomplete')).operation);
  const { old, bytes } = await historicalOutcome(f, first, { incomplete: true });
  await fs.writeFile(path.join(f.repo, 'later-source.mjs'), 'export const later = true;\n');
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Later source cannot fill historical identity gaps');
  f.clock.advance(1);
  await observeFixtureRepository(f);
  const current = { ...action, provider: repository.provider,
    sourceRevision: await f.runGit('rev-parse', 'HEAD'), configDigest: 'config-v2' };
  await assert.rejects(prepare('unknown-history-retry', current), { code: 'UNCERTAIN' });
  const operationId = 'historical-exact-replacement';
  await grant(f, 'override', { rules: ['uncertain-retry'],
    scope: { actions: ['artifact'], operationId },
    reason: 'Fixture grant for the wrong exact action must not permit configuration' });
  await assert.rejects(prepare('unknown-history-retry', current, { operationId }),
    { code: 'UNCERTAIN' });
  const exception = await grant(f, 'override', { rules: ['uncertain-retry'],
    scope: { repositoryIds: ['primary'], actions: ['configuration'],
      target: current.target, operationId },
    reason: 'Fixture user permits only this current replacement of incomplete history' });
  const replacement = (await prepare('unknown-history-retry', current, { operationId })).operation;
  assert.equal(replacement.retryOverrideId, exception.event.id);
  assert.equal(replacement.priorUncertainOperationId, old.id);
  assert.deepEqual(await fs.readFile(f.store.recordPath(f.workItemId, old.id)), bytes);
});
