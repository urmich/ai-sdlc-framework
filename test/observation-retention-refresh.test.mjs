export const validationDeclarations = {
  "schemaVersion": 1,
  "assertionNamespace": "test/observation-retention-regression.test.mjs"
};
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import { LIMITS, canonical } from '../src/core.mjs';
import { retentionFixture, observeFixtureRepository, refreshPr, factsInput,
  updatePrFacts, pruneWork, evaluateReadiness, archivedBytes } from './observation-retention-fixture.mjs';

test('FR-063/064 real refresh and prune archive superseded observations/facts before exhaustion', async t => {
  const f = await retentionFixture(t);
  const first = await observeFixtureRepository(f);
  const firstBytes = await fs.readFile(f.store.recordPath(f.workItemId, first.id));
  let pr = await refreshPr(f, first);
  const firstPr = pr;
  const prBytes = await fs.readFile(f.store.recordPath(f.workItemId, pr.id));
  const firstFacts = await updatePrFacts(f.store, factsInput(f, pr));
  const factsBytes = await fs.readFile(f.store.recordPath(f.workItemId, firstFacts.id));
  f.clock.advance(1);
  let repository = await observeFixtureRepository(f);
  pr = await refreshPr(f, repository, pr);
  await pruneWork(f.store, f.workItemId);
  const active = await f.store.records(f.workItemId);
  assert.equal(active.some(record => record.id === first.id), false,
    'superseded repository observation must leave the active working set after refresh/prune');
  assert.equal(active.some(record => record.id === firstPr.id), false,
    'superseded PR observation must leave the active working set');
  assert.equal(active.some(record => record.id === firstFacts.id), false,
    'superseded PR facts must leave the active working set');
  assert.deepEqual(await archivedBytes(f, first.id), firstBytes);
  assert.deepEqual(await archivedBytes(f, firstPr.id), prBytes);
  assert.deepEqual(await archivedBytes(f, firstFacts.id), factsBytes);

  for (let index = 0; index < 550; index++) {
    f.clock.advance(1);
    repository = await observeFixtureRepository(f);
    if (index % 2 === 0) {
      pr = await refreshPr(f, repository, pr);
      await updatePrFacts(f.store, factsInput(f, pr));
    }
    if (index % 50 === 0) await pruneWork(f.store, f.workItemId);
    const records = await f.store.records(f.workItemId);
    assert.ok(Buffer.byteLength(canonical(records)) < LIMITS.workingSet,
      `refresh ${index} must be admitted below the unchanged working-set budget`);
    assert.ok(records.filter(record => ['repository-observation',
      'pr-observation', 'pr-facts'].includes(record.type)).length <= 6,
    `refresh ${index} must keep superseded history bounded, not wait for capacity failure`);
  }
  const records = await f.store.records(f.workItemId);
  const history = await fs.readdir(path.join(f.store.workPath(f.workItemId), 'evidence'));
  assert.ok(history.filter(name => name.startsWith('repository-observation-')).length >= 550);
  assert.ok(history.filter(name => name.startsWith('pr-observation-')).length >= 275);
  assert.ok(records.some(record => record.id === repository.id));
  assert.ok(records.some(record => record.id === pr.id));
  assert.equal((await f.store.currentRepositoryObservation(f.workItemId,
    'primary')).observation.id, repository.id);
  const oldReadiness = evaluateReadiness(records, {
    environment: 'PROD', prRecordId: firstPr.id,
    localRepositoryPath: first.localRepositoryPath,
    remoteRepositoryURL: first.remoteRepositoryURL,
    prId: firstPr.pullRequestRef, sourceRevision: firstPr.sourceRevision,
    targetRevision: firstPr.targetRevision, policyVersion: 'policy-1',
  }, { clock: f.clock });
  assert.equal(oldReadiness.ready, false);
  assert.ok(oldReadiness.gaps.includes('qualifying-pr-missing'));
  await assert.rejects(updatePrFacts(f.store, factsInput(f, firstPr)),
    { code: 'INPUT' });
});
