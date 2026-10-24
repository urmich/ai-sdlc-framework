export const validationDeclarations = {
  "schemaVersion": 1,
  "surfaces": [{"coverage": "direct", "paths": ["src/validation-catalog.mjs"]}]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { buildTestCatalog, flushValidationObjects, readValidationObject,
  stageValidationObject, validateTestCatalog, validateTestDefinitions,
  validationObjectPath } from '../src/validation-catalog.mjs';
import { digest, LIMITS } from '../src/core.mjs';
import { readBytes } from '../src/files.mjs';
import { fixture } from './helpers.mjs';
import { appendTestObservation, initializeReferencedCycle, prepareCycleEvidence,
  stageCycleEvidence, testHistory } from '../src/validation-evidence.mjs';

function definition(index) {
  return { id: `T-${index}`, environment: 'local', level: 'unit',
    checkpoint: 'pre-review', mode: 'automated', owner: 'agent',
    location: 'local', implementation: 'test/fixture.mjs',
    expected: `Case ${index} has its own assertion` };
}
function specification(count) {
  return { tests: Array.from({ length: count }, (_, index) => definition(index)),
    digest: 'a'.repeat(64), bindings: [{ locator: 'primary:plan.md',
      specificationDigest: 'b'.repeat(64) }] };
}

test('catalog retains all 2249 definitions without raising the inline 100 limit', () => {
  const spec = specification(2249);
  assert.throws(() => validateTestDefinitions(spec.tests, { inline: true }), { code: 'INPUT' });
  const catalog = buildTestCatalog('wi-test', spec);
  assert.equal(catalog.tests.length, 2249);
  assert.equal(new Set(catalog.tests.map(item => item.id)).size, 2249);
  assert.ok(Buffer.byteLength(JSON.stringify(catalog)) < LIMITS.artifact);
  assert.equal(validateTestCatalog(catalog, 'wi-test').testSpecDigest, spec.digest);
});

test('catalog rejects duplicates, wrong identity and malformed definitions', () => {
  const catalog = buildTestCatalog('wi-test', specification(2));
  assert.throws(() => validateTestCatalog(catalog, 'wi-other'), { code: 'BINDING' });
  assert.throws(() => buildTestCatalog('wi-test', {
    ...specification(2), tests: [definition(0), definition(0)],
  }), { code: 'INPUT' });
  assert.throws(() => validateTestDefinitions([{ ...definition(1), checkpoint: 'DEV' }]),
    { code: 'INPUT' });
  const modified = structuredClone(catalog);
  modified.tests[1].expected = 'Changed assertion';
  assert.notEqual(digest(modified), digest(catalog));
});

test('immutable object reads enforce actual bytes, bounded growth, links and regular files', async t => {
  const f = await fixture(t);
  const context = { validationObjects: new Map() };
  const value = { workItemId: f.workItemId, kind: 'fixture', contents: 'Exact bytes' };
  const ref = stageValidationObject(context, value);
  await flushValidationObjects(f.store, f.workItemId, context);
  assert.deepEqual(await readValidationObject(f.store, f.workItemId, ref), value);
  await assert.rejects(readValidationObject(f.store, f.workItemId, { ...ref, bytes: ref.bytes + 1 }),
    { code: 'DIGEST' });
  assert.throws(() => validationObjectPath(f.store, f.workItemId,
    { ...ref, sha256: '../escape' }), { code: 'SCHEMA' });
  assert.throws(() => stageValidationObject(context, {
    ...value, contents: 'x'.repeat(LIMITS.artifact),
  }), { code: 'CAPACITY' });
  const directory = path.dirname(validationObjectPath(f.store, f.workItemId, ref));
  await assert.rejects(readBytes(directory), { code: 'PATH' });
  const link = path.join(f.root, 'linked-objects');
  await fs.symlink(directory, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(readBytes(path.join(link, `${ref.sha256}.json`)), { code: 'PATH' });
});

test('scheduled removals cannot hide a persisted active-record peak over 256 KiB', async t => {
  const f = await fixture(t);
  const record = index => ({ type: 'conflict', id: `resolved-${index}`,
    workItemId: f.workItemId, reason: 'Capacity fixture', references: [],
    status: 'resolved', scope: {}, resolution: 'x'.repeat(3500) });
  await f.store.transaction(f.workItemId, tx => {
    for (let index = 0; index < 65; index++) tx.put(record(index));
  });

  await assert.rejects(f.store.transaction(f.workItemId, tx => {
    for (let index = 0; index < 10; index++) tx.remove(`resolved-${index}`);
    for (let index = 65; index < 75; index++) tx.put(record(index));
  }), { code: 'CAPACITY' });
  const records = await f.store.records(f.workItemId);
  assert.equal(records.length, 65);
  assert.ok(records.some(item => item.id === 'resolved-0'));
  assert.ok(records.every(item => Number(item.id.slice(9)) < 65));
  const state = await f.store.load(f.workItemId);
  assert.doesNotThrow(() => structuredClone(state));
});

test('bounded history chunks preserve every committed observation beyond an inline history page', async t => {
  const f = await fixture(t);
  const spec = specification(101);
  const sources = [{ repositoryId: 'primary', revision: null, contentDigest: 'c'.repeat(64) }];
  const cycle = { type: 'cycle', id: 'cycle-history', workItemId: f.workItemId,
    generation: 1, candidateDigest: 'd'.repeat(64), sources, configDigest: 'fixture-config',
    testSpecDigest: spec.digest, lastEvidenceSequence: 130, artifacts: {}, deployments: {},
    pendingPlanSync: true, step: 'local-testing', reviewRef: null,
    cause: 'History storage fixture', createdAt: new Date(f.clock.now()).toISOString() };
  const context = { validationObjects: new Map(), put: () => {}, all: () => [],
    storeClock: f.clock, checkpoint: { policyGeneration: 0 } };
  initializeReferencedCycle(context, cycle, spec);
  for (let sequence = 1; sequence <= 130; sequence++) {
    appendTestObservation(context, cycle, { type: 'test-evidence', id: `evidence-${sequence}`,
      workItemId: f.workItemId, cycleId: cycle.id, testId: 'T-0', sequence,
      candidateDigest: cycle.candidateDigest, testSpecDigest: spec.digest,
      configDigest: cycle.configDigest, executionSources: sources,
      executionSourceDigest: digest(sources), environment: 'local',
      implementation: 'test/fixture.mjs', status: 'NotRun', owner: 'agent', host: 'local',
      observedAt: new Date(f.clock.now()).toISOString(), activity: 'pending' });
  }
  stageCycleEvidence(context, cycle);
  await flushValidationObjects(f.store, f.workItemId, context);
  const root = await readValidationObject(f.store, f.workItemId, cycle.testOutcomeRef);
  const page = await readValidationObject(f.store, f.workItemId, root.pageRefs[0]);
  assert.equal(page.slots[0].history.length, 64);
  assert.ok(page.slots[0].historyRef);
  await prepareCycleEvidence(f.store, cycle, { validationObjects: new Map(), all: () => [] });
  assert.deepEqual(testHistory(cycle, [], 'T-0').map(item => item.sequence),
    Array.from({ length: 130 }, (_, index) => index + 1));
});

test('bounded reader confirms unchanged bytes under metadata churn but rejects changed same-size content', async t => {
  const f = await fixture(t);
  const file = path.join(f.root, 'metadata-only.json');
  const original = Buffer.from('{"state":"first"}');
  const changed = Buffer.from('{"state":"other"}');
  assert.equal(original.length, changed.length);
  await fs.writeFile(file, original);
  const open = fsPromises.open;
  let mutate = false;
  let handles = 0;
  fsPromises.open = async (...args) => {
    const handle = await open(...args);
    if (path.resolve(args[0]) !== file) return handle;
    handles++;
    const stat = handle.stat.bind(handle);
    let calls = 0;
    handle.stat = async options => {
      calls++;
      if (calls === 2 && mutate) await fs.writeFile(file, changed);
      const result = await stat(options);
      if (calls >= 2) result.ctimeNs += 1n;
      return result;
    };
    return handle;
  };
  syncBuiltinESMExports();
  try {
    assert.deepEqual(await readBytes(file), original);
    assert.equal(handles, 1);
    mutate = true;
    await assert.rejects(readBytes(file), { code: 'STALE' });
    assert.equal(handles, 2);
  } finally {
    fsPromises.open = open;
    syncBuiltinESMExports();
  }
});

test('immutable object read rejects same-size mutation across bounded confirmations', async t => {
  const f = await fixture(t);
  const context = { validationObjects: new Map() };
  const original = { workItemId: f.workItemId, kind: 'fixture', contents: 'first' };
  const ref = stageValidationObject(context, original);
  await flushValidationObjects(f.store, f.workItemId, context);
  const file = validationObjectPath(f.store, f.workItemId, ref);
  const originalBytes = await fs.readFile(file);
  const changedBytes = Buffer.from(originalBytes.toString('utf8').replace('"first"', '"other"'));
  assert.equal(changedBytes.length, originalBytes.length);
  assert.notEqual(digest(changedBytes), ref.sha256);
  const open = fsPromises.open;
  let handles = 0;
  let reads = 0;
  let stats = 0;
  let closed = 0;
  let dataPasses = 0;
  fsPromises.open = async (...args) => {
    const handle = await open(...args);
    if (path.resolve(args[0]) !== file) return handle;
    handles++;
    const stat = handle.stat.bind(handle);
    const read = handle.read.bind(handle);
    const close = handle.close.bind(handle);
    handle.stat = async options => {
      stats++;
      if (stats === 2) {
        const metadataTime = new Date('2026-10-11T00:00:02.000Z');
        await fs.utimes(file, metadataTime, metadataTime);
      }
      return stat(options);
    };
    handle.read = async (...readArgs) => {
      reads++;
      const result = await read(...readArgs);
      if (readArgs[3] === 0 && result.bytesRead > 0) {
        dataPasses++;
        if (dataPasses === 2) {
          await fs.writeFile(file, changedBytes);
          const changedTime = new Date('2026-10-11T00:00:04.000Z');
          await fs.utimes(file, changedTime, changedTime);
        }
      }
      return result;
    };
    handle.close = async () => { closed++; return close(); };
    return handle;
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(readValidationObject(f.store, f.workItemId, ref), { code: 'STALE' });
    assert.equal(handles, 1);
    assert.equal(dataPasses, 3);
    assert.equal(reads, 6);
    assert.equal(stats, 4);
    assert.equal(closed, 1);
  } finally {
    fsPromises.open = open;
    syncBuiltinESMExports();
  }
  assert.deepEqual(await fs.readFile(file), changedBytes);
  await assert.rejects(readValidationObject(f.store, f.workItemId, ref), { code: 'DIGEST' });
});
