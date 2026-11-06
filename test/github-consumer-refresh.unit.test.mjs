export const validationDeclarations = {
  "schemaVersion": 1,
  "assertionNamespace": "test/github-existing-consumer-boundaries.unit.test.mjs"
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { adoptPr } from '../src/pr.mjs';
import { attachMonitor, verifyMonitorLink, readMonitor } from '../src/monitors.mjs';
import { registerGitHubAdapter } from '../src/github/execution-adapter.mjs';
import { verifyProviderLink } from '../src/provider-adapters.mjs';
import { grant, orient } from './helpers.mjs';
import { bridgeFixture, durableBytes, remote, repositoryRef } from './fixtures/github-store-bridge.mjs';

const base = '/repos/bridge-owner/bridge-repo';

test('GH36/GH37 PR refresh and exact repository boundary gaps use their actual consumers', async t => {
  const f = await bridgeFixture(t);
  const repositoryInput = { ...f.repositoryInput, observedAt: new Date(f.clock.now()).toISOString() };
  await f.store.observeRepository(repositoryInput);
  const reject = async (callback, code = 'EVIDENCE') => {
    const before = await durableBytes(f);
    await assert.rejects(callback, { code });
    assert.deepEqual(await durableBytes(f), before);
  };
  await t.test('T-GH-36-ADO08-remote-handle', async () => {
    await f.runGit('remote', 'rename', 'origin', 'selected-upstream');
    try {
      const current = await f.store.currentRepositoryObservation(f.workItemId, 'primary', 'selected-upstream');
      assert.equal(current.selectedFetchRemote.selectedRemoteName, 'selected-upstream');
      assert.equal(current.observation.repositoryRef, repositoryRef);
      assert.equal(current.observation.remoteRepositoryURL, remote);
    } finally { await f.runGit('remote', 'rename', 'selected-upstream', 'origin'); }
  });
  await t.test('T-GH-36-ADO10-stale-default', async () => {
    assert.equal((await f.store.currentRepositoryObservation(f.workItemId, 'primary', 'origin')).observation.defaultBranchRef,
      'refs/heads/main');
    await reject(() => f.store.observeRepository({ ...repositoryInput, defaultBranchRef: 'refs/heads/obsolete-default' }));
  });
  await t.test('T-GH-36-ADO10-prefix-search', async () => {
    assert.deepEqual((await f.store.currentRepositoryObservation(f.workItemId, 'primary', 'origin')).observation.verifiedBranch,
      { branchRef: 'refs/heads/feature/fixture', revision: f.revision });
    await reject(() => f.store.observeRepository({ ...repositoryInput,
      verifiedBranch: { branchRef: 'refs/heads/feature/fixture-copy', revision: f.revision } }));
  });
  await t.test('T-GH-36-ADO05-login', async () => {
    registerGitHubAdapter();
    const identity = { provider: 'github', connection: 'bridge-fixture', scopeRef: repositoryRef,
      definitionRef: '301', executionRef: '401', attemptKind: 'known', attemptRef: '2' };
    const native = await f.acquire('GET', `${base}/actions/runs/401/attempts/2`, {
      id: 401, workflow_id: 301, run_attempt: 2, repository: Object.fromEntries(
        Object.entries(f.repositoryBody).filter(([name]) => name !== 'url')),
      html_url: 'https://github.com/bridge-owner/bridge-repo/actions/runs/401',
    });
    const observation = { connection: 'bridge-fixture', run: native.body,
      access: { accessible: true, finalUrl: 'https://github.com/bridge-owner/bridge-repo/actions/runs/401/attempts/2' } };
    const attached = await attachMonitor(f.store, { identity, origin: 'framework',
      workItemId: f.workItemId, schedulerAvailable: true, readAvailable: true });
    assert.equal((await verifyMonitorLink(f.store, { runKey: attached.key, adapterId: 'github',
      observation, evidenceRef: 'fixture:original-accessible-page' })).link.status, 'verified');
    const before = await durableBytes(f);
    const rejected = await verifyProviderLink('github', identity, { ...observation,
      access: { accessible: true, finalUrl: 'https://github.com/login' } });
    assert.equal(rejected.verified, false);
    assert.match(rejected.reason, /final page does not identify/u);
    assert.deepEqual(await durableBytes(f), before);
    assert.equal((await readMonitor(f.store, attached.key)).link.status, 'verified');
  });
  const pr = await f.acquirePr();
  const adopted = (await adoptPr(f.store, { workItemId: f.workItemId, ...pr })).observation;
  f.clock.advance(1);
  const refresh = await f.acquirePr({ sequence: 2, previousObservationKey: adopted.id });
  await t.test('T-GH-37-pull-request-wrong-sequence', async () => {
    const wrong = f.originalPrVariant(refresh, { sequence: 999 });
    await reject(() => adoptPr(f.store, { workItemId: f.workItemId, ...wrong,
      previousObservationKey: adopted.id }));
  });
  await t.test('T-GH-37-pull-request-wrong-version', async () => {
    const wrong = f.originalPrVariant(refresh, { version: 'foreign-original-provider-version' });
    await reject(() => adoptPr(f.store, { workItemId: f.workItemId, ...wrong,
      previousObservationKey: adopted.id }), 'STALE');
  });
  const actual = (await adoptPr(f.store, { workItemId: f.workItemId, ...refresh,
    previousObservationKey: adopted.id })).observation;
  assert.equal(actual.sequence, 2);
  await t.test('T-GH-retained-history exact current PR and rejected delayed acquisition preserve predecessor', async () => {
    assert.equal(actual.previousObservationKey, adopted.id);
    const state = await f.store.load(f.workItemId);
    assert.equal(state.records.find(value => value.id === actual.id).sequence, 2);
    const archived = JSON.parse(await fs.readFile(path.join(
      f.store.workPath(f.workItemId), 'evidence', `${adopted.id}.json`), 'utf8'));
    assert.deepEqual(archived, adopted);
    await reject(() => adoptPr(f.store, { workItemId: f.workItemId, ...pr }), 'STALE');
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(
      f.store.workPath(f.workItemId), 'evidence', `${adopted.id}.json`), 'utf8')), adopted);
    assert.deepEqual((await f.store.load(f.workItemId)).records.find(value => value.id === actual.id), actual);
  });
  await t.test('T-GH-36-ADO22-policy-denied', async () => {
    const merge = await f.prepare('merge');
    assert.equal((await f.record(merge, await f.result(merge))).status, 'succeeded');
    const prepared = await f.prepare('policy', '-revoked-policy', { claim: false });
    const event = (await f.store.records(f.workItemId)).find(value =>
      value.type === 'event' && value.kind === 'permission' && value.effect.grant === 'auto-merge');
    assert.ok(event);
    await grant(f, 'revocation', { revokes: [event.id] });
    await orient(f);
    const calls = f.calls.length;
    await reject(() => f.bridge.legacyOperations.claimDispatch(prepared.preparation, f.store), 'GATE');
    assert.equal(f.calls.length, calls);
  });
});
