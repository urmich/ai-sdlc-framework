export const validationDeclarations = {
  "schemaVersion": 1,
  "surfaces": [{"coverage": "direct", "paths": ["src/core.mjs", "src/files.mjs", "src/git.mjs", "src/store.mjs", "src/schemas.mjs", "src/audit.mjs", "src/validation-evidence.mjs"]}],
  "variants": [
    {"expression": "scenario", "names": ["settling-metadata", "changing-content", "changing-identity", "changing-size", "continued-churn"]}
  ],
  "plannedCases": [
    {"id": "T-PRD010", "selectors": [
      {"name": "T-PRD010 real JSON entry reads overlap within sixteen slots and admit every sorted record", "parents": []}
    ]},
    {"id": "T-PRD013", "selectors": [
      {"name": "T-PRD013 JSON entry failures and consumer exits drain dispatched reads without admitting queued files", "parents": []},
      {"name": "T-PRD013 real archived history retains original records and rejects changed identities and active conflicts", "parents": []},
      {"name": "T-PRD013 bounded reads allocate for observed bytes while preserving short-read and growth failures", "parents": []}
    ]}
  ]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fixture, grant, observeFixtureRepository } from './helpers.mjs';
import { canonical, digest, LIMITS } from '../src/core.mjs';
import { atomicWrite, readBytes, readJson, readJsonEntries, updateJson, withLock, writeJson, safePath } from '../src/files.mjs';
import { identity, validateBinding } from '../src/git.mjs';
import { Store, orderRecordRemovals } from '../src/store.mjs';
import { validateRecord } from '../src/schemas.mjs';
import { repositoryObservationKey, pullRequestObservationKey } from '../src/repository-observations.mjs';
import { parseArguments, runCli } from '../src/cli.mjs';
import { attachMonitor, readMonitor } from '../src/monitors.mjs';
import { currentCycle, currentTestEvidence, stagePassed } from '../src/authority.mjs';
import { currentArtifact, currentDeployment } from '../src/current-evidence.mjs';
import { formatAudit, recordAudit, replayAudit } from '../src/audit.mjs';
import { prepareValidationHistory } from '../src/validation-evidence.mjs';

async function waitForStorageReadBarrier(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Storage read barrier was not reached')), 10000);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

test('T-PRD010 real JSON entry reads overlap within sixteen slots and admit every sorted record', async t => {
  const f = await fixture(t);
  const directory = path.join(f.root, 'entry-overlap');
  await fs.mkdir(directory);
  const names = Array.from({ length: 33 }, (_, index) => `${String(index).padStart(2, '0')}.json`);
  const expected = names.map((name, index) => ({ name, record: { index } }));
  for (const { name, record } of [...expected].reverse()) {
    await fs.writeFile(path.join(directory, name), JSON.stringify(record));
  }
  await fs.writeFile(path.join(directory, 'ignored.txt'), 'not JSON');
  const gates = Array.from({ length: 3 }, () => Promise.withResolvers());
  const ready = Array.from({ length: 3 }, () => Promise.withResolvers());
  const started = [];
  const closed = [];
  const draining = [];
  const admitted = [];
  let active = 0;
  let maximum = 0;
  const open = fsPromises.open;
  const mocked = t.mock.method(fsPromises, 'open', async (selected, ...options) => {
    const handle = await open(selected, ...options);
    if (path.dirname(selected) !== directory) return handle;
    const name = path.basename(selected);
    const index = names.indexOf(name);
    const batch = Math.floor(index / 16);
    const drained = Promise.withResolvers();
    draining.push(drained.promise);
    const read = handle.read.bind(handle);
    const close = handle.close.bind(handle);
    let entered = false;
    handle.read = async (...args) => {
      if (!entered) {
        entered = true;
        active++;
        maximum = Math.max(maximum, active);
        started.push(name);
        if (started.length === Math.min((batch + 1) * 16, names.length)) ready[batch].resolve();
      }
      await gates[batch].promise;
      return read(...args);
    };
    handle.close = async () => {
      try { return await close(); }
      finally {
        if (entered) active--;
        closed.push(name);
        drained.resolve();
      }
    };
    return handle;
  });
  syncBuiltinESMExports();
  const reading = (async () => {
    for await (const entry of readJsonEntries(directory)) {
      assert.equal(active, 0, 'A batch must settle before record admission');
      admitted.push(entry);
    }
  })().then(() => ({ error: null }), error => ({ error }));
  try {
    for (let batch = 0; batch < gates.length; batch++) {
      await waitForStorageReadBarrier(ready[batch].promise);
      const start = batch * 16;
      const end = Math.min(start + 16, names.length);
      assert.deepEqual([...started].sort(), names.slice(0, end));
      assert.deepEqual([...closed].sort(), names.slice(0, start));
      assert.deepEqual(admitted, expected.slice(0, start));
      assert.equal(active, end - start);
      assert.ok(maximum <= 16);
      gates[batch].resolve();
    }
    const result = await reading;
    if (result.error) throw result.error;
    assert.deepEqual(admitted, expected);
    assert.deepEqual([...closed].sort(), names);
    assert.equal(new Set(started).size, names.length);
    assert.equal(active, 0);
  } finally {
    for (const gate of gates) gate.resolve();
    await reading;
    await Promise.allSettled(draining);
    mocked.mock.restore();
    syncBuiltinESMExports();
  }
  const alias = path.join(f.root, 'entry-overlap-alias');
  await fs.symlink(directory, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const internal = path.join(directory, 'internal');
  await fs.mkdir(internal);
  const linkedRecord = { index: 'internal' };
  const target = path.join(internal, 'target.json');
  await fs.writeFile(target, JSON.stringify(linkedRecord));
  await fs.symlink(target, path.join(directory, 'linked.json'), 'file');
  const aliased = [];
  for await (const entry of readJsonEntries(alias)) aliased.push(entry);
  assert.deepEqual(aliased, [...expected, { name: 'linked.json', record: linkedRecord }]);
  const outside = path.join(f.root, 'outside-entry.json');
  await fs.writeFile(outside, '{"outside":true}');
  await fs.symlink(outside, path.join(directory, '00-escape.json'), 'file');
  await assert.rejects(readJsonEntries(alias).next(), { code: 'PATH' });
  await fs.unlink(path.join(directory, '00-escape.json'));
  const canonicalDirectory = await fs.realpath(directory);
  const readdir = fsPromises.readdir;
  let replaced = false;
  const staleListing = t.mock.method(fsPromises, 'readdir', async (selected, ...options) => {
    const entries = await readdir(selected, ...options);
    if (selected === canonicalDirectory && !replaced) {
      const listed = entries.find(entry =>
        (typeof entry === 'string' ? entry : entry.name) === names[0]);
      assert.ok(listed);
      if (typeof listed !== 'string') assert.equal(listed.isSymbolicLink(), false);
      const file = path.join(canonicalDirectory, names[0]);
      await fs.unlink(file);
      await fs.symlink(outside, file, 'file');
      replaced = true;
    }
    return entries;
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(readJsonEntries(alias).next(), { code: 'PATH' });
    assert.equal(replaced, true);
  } finally {
    staleListing.mock.restore();
    syncBuiltinESMExports();
  }
});

test('T-PRD013 JSON entry failures and consumer exits drain dispatched reads without admitting queued files', async t => {
  const f = await fixture(t);
  for (const outcome of ['malformed', 'oversized', 'io', 'break', 'consumer-throw']) {
    const directory = path.join(f.root, `entry-${outcome}`);
    await fs.mkdir(directory);
    const names = Array.from({ length: 17 }, (_, index) => `${String(index).padStart(2, '0')}.json`);
    for (const name of names) await fs.writeFile(path.join(directory, name), '{"value":1}');
    const failure = ['malformed', 'oversized', 'io'].includes(outcome);
    const firstFailure = path.join(directory, names[1]);
    if (outcome === 'malformed') await fs.writeFile(firstFailure, '{');
    if (outcome === 'oversized') await fs.writeFile(firstFailure, JSON.stringify('x'.repeat(64)));
    const ioError = Object.assign(new Error('Owned fixture read failed'), { code: 'EIO' });
    const laterError = Object.assign(new Error('Later ordered fixture read failed'), { code: 'EACCES' });
    const consumerError = new Error('Owned fixture admission failed');
    const ready = Promise.withResolvers();
    const release = Promise.withResolvers();
    const releaseFirstFailure = Promise.withResolvers();
    const firstClosed = Promise.withResolvers();
    const laterFailed = Promise.withResolvers();
    const opened = [];
    const closed = [];
    const draining = [];
    const admitted = [];
    let active = 0;
    let settled = false;
    const open = fsPromises.open;
    const mocked = t.mock.method(fsPromises, 'open', async (selected, ...options) => {
      if (path.dirname(selected) !== directory) return open(selected, ...options);
      const drained = Promise.withResolvers();
      draining.push(drained.promise);
      let handle;
      try { handle = await open(selected, ...options); }
      catch (error) { drained.resolve(); throw error; }
      const name = path.basename(selected);
      const close = handle.close.bind(handle);
      active++;
      opened.push(name);
      handle.close = async () => {
        try { return await close(); }
        finally {
          active--;
          closed.push(name);
          drained.resolve();
          if (name === names[1]) firstClosed.resolve();
        }
      };
      if (opened.length === 16) ready.resolve();
      if (failure && name === names[3]) {
        await handle.close();
        laterFailed.resolve();
        throw laterError;
      }
      await (failure && name === names[1] ? releaseFirstFailure.promise : release.promise);
      if (outcome === 'io' && name === names[1]) {
        await handle.close();
        throw ioError;
      }
      return handle;
    });
    syncBuiltinESMExports();
    const reading = (async () => {
      for await (const entry of readJsonEntries(directory, { limit: 64 })) {
        admitted.push(entry.name);
        if (outcome === 'break') break;
        if (outcome === 'consumer-throw') throw consumerError;
      }
    })().then(() => { settled = true; return { error: null }; },
      error => { settled = true; return { error }; });
    try {
      await waitForStorageReadBarrier(ready.promise);
      assert.deepEqual([...opened].sort(), names.slice(0, 16), outcome);
      assert.deepEqual(admitted, []);
      if (failure) {
        await waitForStorageReadBarrier(laterFailed.promise);
        releaseFirstFailure.resolve();
        await waitForStorageReadBarrier(firstClosed.promise);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(settled, false, 'A failed read must not leave dispatched siblings pending');
        assert.equal(active, 14);
      } else {
        assert.equal(active, 16);
      }
      release.resolve();
      const result = await reading;
      if (outcome === 'malformed') assert.equal(result.error?.code, 'JSON');
      if (outcome === 'oversized') assert.equal(result.error?.code, 'CAPACITY');
      if (outcome === 'io') assert.equal(result.error, ioError);
      if (outcome === 'consumer-throw') assert.equal(result.error, consumerError);
      if (outcome === 'break') assert.equal(result.error, null);
      assert.deepEqual(admitted, names.slice(0, 1), outcome);
      assert.deepEqual([...closed].sort(), names.slice(0, 16), outcome);
      assert.equal(active, 0, outcome);
    } finally {
      releaseFirstFailure.resolve();
      release.resolve();
      await reading;
      await Promise.allSettled(draining);
      mocked.mock.restore();
      syncBuiltinESMExports();
    }
  }
});

test('T-PRD013 real archived history retains original records and rejects changed identities and active conflicts', async t => {
  const f = await fixture(t);
  const directory = path.join(f.store.workPath(f.workItemId), 'evidence');
  const operation = {
    type: 'operation', id: 'repository-observation-archived-operation',
    workItemId: f.workItemId, repositoryId: 'primary', class: 'build',
    action: { class: 'build' }, target: 'owned-fixture-build',
    status: 'succeeded', correlationKey: 'archived-build',
    requestFingerprint: digest('archived fixture request'), dispatchBound: true,
    handle: 'fixture-run', evidenceRef: 'fixture:archived-build',
  };
  const eventContent = {
    type: 'event', id: 'event-archived', workItemId: f.workItemId,
    schemaVersion: 1, sequence: 1, kind: 'scope-inclusion',
    effect: { itemId: 'archived-item' }, sourceReceiptId: 'receipt-archived',
    sourceReceiptDigest: digest('fixture receipt'), inputDigest: digest('fixture input'),
    sessionId: f.sessionId, repositoryIds: ['primary'], snapshots: [],
    occurredAt: new Date(f.clock.now()).toISOString(),
  };
  const event = { ...eventContent, digest: digest(eventContent) };
  const evidence = {
    type: 'test-evidence', id: 'evidence-archived', workItemId: f.workItemId,
    cycleId: 'cycle-archived', testId: 'T-archived', status: 'Passed',
    observedAt: new Date(f.clock.now()).toISOString(),
    evidenceRef: 'fixture:archived-test',
  };
  const records = [operation, event, evidence, ...Array.from({ length: 14 }, (_, index) => ({
    type: 'pr', id: `pr-archived-${index}`, workItemId: f.workItemId,
    provider: 'fixture', connection: 'fixture', repositoryId: 'primary',
    sourceRef: 'refs/heads/feature', targetRef: 'refs/heads/main',
    sourceRevision: 'a'.repeat(40), targetRevision: 'b'.repeat(40),
    prId: String(index), state: 'active',
  }))];
  for (const record of records) {
    validateRecord(record);
    await writeJson(path.join(directory, `${record.id}.json`), record);
  }
  const originalBytes = await Promise.all(records.map(record =>
    fs.readFile(path.join(directory, `${record.id}.json`))));
  const loaded = await f.store.load(f.workItemId);
  assert.deepEqual([...loaded.operationHistory.values()], [operation]);
  assert.deepEqual([...loaded.archivedTestEvidence.values()], [evidence]);
  assert.equal(loaded.records.some(record => records.some(archived => archived.id === record.id)), false);
  const history = await prepareValidationHistory(f.store, f.workItemId, loaded.records);
  assert.deepEqual([...history.events.values()], [event]);
  assert.deepEqual([...history.operations.values()], [operation]);
  assert.deepEqual([...history.evidence.values()], [evidence]);
  for (const [original, invalid, code] of [
    [operation, { ...operation, workItemId: 'wi-other' }, 'BINDING'],
    [operation, { ...operation, id: 'operation-wrong-locator' }, 'OPERATION'],
    [operation, { ...operation, status: 'running' }, 'OPERATION'],
    [operation, { ...operation, unexpected: true }, 'INPUT'],
    [event, { ...event, workItemId: 'wi-other' }, 'BINDING'],
    [event, { ...event, id: 'event-wrong-locator' }, 'BINDING'],
    [event, { ...event, effect: { itemId: 'changed-item' } }, 'DIGEST'],
    [evidence, { ...evidence, workItemId: 'wi-other' }, 'BINDING'],
    [evidence, { ...evidence, id: 'evidence-wrong-locator' }, 'BINDING'],
    [evidence, { ...evidence, status: 'successful' }, 'INPUT'],
  ]) {
    const file = path.join(directory, `${original.id}.json`);
    try {
      await writeJson(file, invalid);
      await assert.rejects(f.store.load(f.workItemId), { code });
    } finally {
      await writeJson(file, original);
    }
  }
  const activeFile = f.store.recordPath(f.workItemId, operation.id);
  await writeJson(activeFile, operation);
  assert.deepEqual((await f.store.load(f.workItemId)).operationHistory.get(operation.id), operation);
  await writeJson(activeFile, { ...operation, status: 'failed' });
  await assert.rejects(f.store.load(f.workItemId), { code: 'ID_CONFLICT' });
  await fs.unlink(activeFile);
  const unrelated = path.join(directory, 'repository-observation-unrelated.json');
  await fs.writeFile(unrelated, '{');
  await assert.rejects(f.store.load(f.workItemId), { code: 'JSON' });
  await fs.writeFile(unrelated, JSON.stringify('x'.repeat(LIMITS.workingSet + 1)));
  await assert.rejects(f.store.load(f.workItemId), { code: 'CAPACITY' });
  await fs.unlink(unrelated);
  assert.deepEqual((await f.store.load(f.workItemId)).operationHistory.get(operation.id), operation);
  assert.deepEqual(await Promise.all(records.map(record =>
    fs.readFile(path.join(directory, `${record.id}.json`)))), originalBytes);
});

test('T-PRD013 bounded reads allocate for observed bytes while preserving short-read and growth failures', async t => {
  const f = await fixture(t);
  const cases = [
    ...[0, 1, 1024, 65535, 65536, 65537].map(size => ({ name: `stable-${size}`, size })),
    { name: 'short-reads', size: 1024, shortReads: true },
    { name: 'growing-within-limit', size: 4, growth: 4, limit: 64, code: 'STALE' },
    { name: 'growing-beyond-limit', size: 4, growth: 80, limit: 64, code: 'CAPACITY' },
  ];
  for (const entry of cases) {
    entry.file = path.join(f.root, `${entry.name}.bin`);
    entry.bytes = Buffer.alloc(entry.size, 0x61);
    entry.reads = [];
    entry.closed = false;
    await fs.writeFile(entry.file, entry.bytes);
  }
  const open = fsPromises.open;
  const mocked = t.mock.method(fsPromises, 'open', async (selected, ...options) => {
    const handle = await open(selected, ...options);
    const entry = cases.find(item => item.file === selected);
    if (!entry) return handle;
    const read = handle.read.bind(handle);
    const close = handle.close.bind(handle);
    handle.read = async (buffer, offset, length, position) => {
      if (entry.growth && !entry.grown) {
        entry.grown = true;
        const writer = await open(entry.file, 'a');
        try { await writer.writeFile(Buffer.alloc(entry.growth, 0x62)); }
        finally { await writer.close(); }
      }
      const result = await read(buffer, offset,
        entry.shortReads ? Math.min(length, 17) : length, position);
      entry.reads.push({ allocated: buffer.length, position, bytesRead: result.bytesRead });
      return result;
    };
    handle.close = async () => {
      try { return await close(); }
      finally { entry.closed = true; }
    };
    return handle;
  });
  syncBuiltinESMExports();
  try {
    for (const entry of cases) {
      if (entry.growth) {
        await assert.rejects(readBytes(entry.file, entry.limit), { code: entry.code });
        assert.equal((await fs.stat(entry.file)).size, entry.size + entry.growth, entry.name);
        assert.equal(entry.reads[0].allocated, entry.size + 1, entry.name);
        assert.ok(entry.reads.slice(1).some(read => read.allocated > entry.size + 1),
          'A file exceeding its observed size must leave the small-file allocation path');
        const bytesRead = entry.reads.reduce((total, read) => total + read.bytesRead, 0);
        assert.ok(bytesRead >= (entry.code === 'CAPACITY' ? entry.limit + 1 : entry.size + entry.growth),
          'Growth must be read and rejected rather than silently truncated');
      } else {
        assert.deepEqual(await readBytes(entry.file), entry.bytes, entry.name);
        assert.ok(entry.reads.every(read =>
          read.allocated <= Math.min(65536, entry.size + 1)),
        'Small stable files must not allocate full 64 KiB read buffers');
        assert.deepEqual(entry.reads.at(-1), {
          allocated: 1, position: entry.size, bytesRead: 0,
        }, entry.name);
        assert.equal(entry.reads.reduce((total, read) => total + read.bytesRead, 0),
          entry.size, entry.name);
        if (entry.shortReads) {
          assert.ok(entry.reads.filter(read => read.bytesRead > 0).length > 1);
        }
      }
      assert.equal(entry.closed, true, entry.name);
    }
  } finally {
    mocked.mock.restore();
    syncBuiltinESMExports();
  }
});

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
test('T-16 bounded file confirmation tolerates settling metadata but rejects content changes and continued churn', async t => {
  for (const scenario of ['settling-metadata', 'changing-content', 'changing-identity', 'changing-size', 'continued-churn']) {
    await t.test(scenario, async child => {
      const f = await fixture(child);
      const file = path.join(f.root, 'bounded-confirmation.json');
      const original = Buffer.from('unchanged');
      await fs.writeFile(file, original);
      const open = fsPromises.open;
      const times = scenario === 'settling-metadata' ? [0n, 1n, 2n, 2n] :
        scenario === 'continued-churn' ? [0n, 1n, 2n, 3n] : [0n, 1n, 1n, 1n];
      let stats = 0;
      const mocked = child.mock.method(fsPromises, 'open', async (selected, ...options) => {
        const handle = await open(selected, ...options);
        if (selected === file) {
          const stat = handle.stat.bind(handle);
          handle.stat = async (...args) => {
            if (scenario === 'changing-content' && stats === 1) {
              await fs.writeFile(file, 'modified!');
            }
            const observed = await stat(...args);
            const index = stats++;
            const time = times[Math.min(index, times.length - 1)];
            return Object.assign(Object.create(Object.getPrototypeOf(observed)),
              observed, {
                mtimeNs: 1000n + time, ctimeNs: 2000n + time,
                ino: observed.ino + (scenario === 'changing-identity' && index >= 2 ? 1n : 0n),
                size: observed.size + (scenario === 'changing-size' && index >= 2 ? 1n : 0n),
              });
          };
        }
        return handle;
      });
      syncBuiltinESMExports();
      try {
        if (scenario === 'settling-metadata') {
          assert.deepEqual(await readBytes(file, original.length), original);
          assert.equal(stats, 4);
        } else {
          await assert.rejects(readBytes(file, original.length), { code: 'STALE' });
          assert.ok(stats <= 4, 'Metadata confirmation must remain bounded');
        }
      } finally {
        mocked.mock.restore();
        syncBuiltinESMExports();
      }
    });
  }
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
test('T-16 a changing recovery-guard owner remains contention without stealing ownership', async t => {
  const f = await fixture(t);
  const lock = path.join(f.root, 'changing-owner.lock');
  const guard = `${lock}.recovery-guard`;
  const ownerFile = path.join(guard, 'owner.json');
  const owner = { token: 'original', host: os.hostname(), pid: process.pid };
  await writeJson(ownerFile, owner);
  const lstat = fsPromises.lstat;
  let changed = false;
  let actionRan = false;
  const mocked = t.mock.method(fsPromises, 'lstat', async (file, options) => {
    const stat = await lstat(file, options);
    if (file === ownerFile && options?.bigint && !changed) {
      changed = true;
      await writeJson(ownerFile, { ...owner, token: 'replacement' });
    }
    return stat;
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(withLock(lock, () => { actionRan = true; },
      { waitMs: 0 }), { code: 'LOCK_BUSY' });
    assert.equal(changed, true);
    assert.equal(actionRan, false);
    assert.equal((await readJson(ownerFile)).token, 'replacement');
    await assert.rejects(fs.stat(lock), { code: 'ENOENT' });
  } finally {
    mocked.mock.restore();
    syncBuiltinESMExports();
    await fs.unlink(ownerFile);
    await fs.rmdir(guard);
  }
  assert.equal(await withLock(lock, () => 'guard available'), 'guard available');
});
test('T-16 a changing lock owner during inspection remains contention without removing its replacement', async t => {
  const f = await fixture(t);
  const lock = path.join(f.root, 'changing-lock-owner.lock');
  const owner = { token: 'original', host: os.hostname(), pid: process.pid };
  await writeJson(lock, owner);
  const lstat = fsPromises.lstat;
  let changed = false;
  let actionRan = false;
  const mocked = t.mock.method(fsPromises, 'lstat', async (file, options) => {
    const stat = await lstat(file, options);
    if (file === lock && options?.bigint && !changed) {
      await writeJson(lock, { ...owner, token: 'replacement' });
      changed = true;
    }
    return stat;
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(withLock(lock, () => { actionRan = true; },
      { waitMs: 0 }), { code: 'LOCK_BUSY' });
    assert.equal(changed, true);
    assert.equal(actionRan, false);
    assert.equal((await readJson(lock)).token, 'replacement');
    await assert.rejects(fs.stat(`${lock}.recovery-guard`), { code: 'ENOENT' });
  } finally {
    mocked.mock.restore();
    syncBuiltinESMExports();
  }
  await fs.unlink(lock);
  assert.equal(await withLock(lock, () => 'lock available'), 'lock available');
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
test('T-19 manifest binding checks fresh paths and branch without unused revision reads', async t => {
  const f = await fixture(t);
  const calls = [];
  const observe = ({ process: child }) => {
    child.once('close', () => {
      if (child.spawnargs[0] === 'git') calls.push(child.spawnargs.slice(1));
    });
  };
  subscribe('child_process', observe);
  try {
    const unborn = await f.store.manifest(f.workItemId);
    assert.equal(unborn.coordinator.root, f.repo);
    assert.deepEqual(calls.map(args => args[2]), ['rev-parse', 'symbolic-ref'],
      'An unborn manifest binding needs current paths and branch, not a revision');
    await f.runGit('commit', '--allow-empty', '-qm', 'Advance manifest binding fixture');
    calls.length = 0;
    const committed = await f.store.manifest(f.workItemId);
    assert.deepEqual(committed.metadata, unborn.metadata);
    assert.deepEqual(calls.map(args => args[2]), ['rev-parse', 'symbolic-ref']);
    await f.runGit('checkout', '-qb', 'feature/manifest-same-head');
    calls.length = 0;
    await assert.rejects(f.store.manifest(f.workItemId), { code: 'BINDING' });
    assert.deepEqual(calls.map(args => args[2]), ['rev-parse', 'symbolic-ref']);
  } finally {
    unsubscribe('child_process', observe);
  }
});

test('T-19 manifest binding guards recheck the branch after all canonical path checks', async t => {
  const f = await fixture(t);
  await f.runGit('commit', '--allow-empty', '-qm', 'Create manifest binding race fixture');
  await f.runGit('branch', 'feature/manifest-path-race');
  const gitDir = await fs.realpath(path.join(f.repo, '.git'));
  const realpath = fsPromises.realpath;
  let checks = 0;
  const mocked = t.mock.method(fsPromises, 'realpath', async (...args) => {
    const resolved = await realpath(...args);
    if (resolved === gitDir && ++checks === 2) {
      await f.runGit('checkout', '-q', 'feature/manifest-path-race');
    }
    return resolved;
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(f.store.manifest(f.workItemId), { code: 'BINDING' });
    assert.equal(checks, 2, 'Both common-directory and Git-directory checks must precede the branch read');
  } finally {
    mocked.mock.restore();
    syncBuiltinESMExports();
  }
});

test('Git identity batches fresh path queries and preserves unborn and linked worktrees', async t => {
  const f = await fixture(t);
  await f.runGit('add', '.sdlc');
  await f.runGit('commit', '-qm', 'Create owned identity fixture');
  const nested = path.join(f.repo, 'nested folder');
  await fs.mkdir(nested);
  const calls = [];
  const observe = ({ process: child }) => {
    child.once('close', () => calls.push(child.spawnargs.slice(1)));
  };
  let original;
  subscribe('child_process', observe);
  try {
    original = await identity(nested, 'primary');
  } finally {
    unsubscribe('child_process', observe);
  }
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0], ['--no-pager', '--no-optional-locks', 'rev-parse',
    '--path-format=absolute', '--show-toplevel', '--git-common-dir', '--absolute-git-dir']);
  assert.equal(original.root, await fs.realpath(f.repo));
  assert.equal(original.commonDir, await fs.realpath(path.join(f.repo, '.git')));
  assert.equal(original.linkedWorktree, false);
  assert.equal(original.head, await f.runGit('rev-parse', 'HEAD'));

  await f.runGit('commit', '--allow-empty', '-qm', 'Advance owned identity fixture');
  const changed = await identity(nested, 'primary');
  assert.notEqual(changed.head, original.head);
  assert.equal(changed.head, await f.runGit('rev-parse', 'HEAD'));
  assert.equal(changed.branch, original.branch);
  const worktree = path.join(f.root, 'identity linked tree');
  await f.runGit('worktree', 'add', '-qb', 'feature/identity-linked', worktree);
  const linked = await identity(worktree, 'primary');
  assert.equal(linked.root, await fs.realpath(worktree));
  assert.equal(linked.commonDir, original.commonDir);
  assert.equal(linked.branch, 'refs/heads/feature/identity-linked');
  assert.equal(linked.head, changed.head);
  assert.equal(linked.linkedWorktree, true);

  const unborn = path.join(f.root, 'identity unborn');
  await f.runGit('init', '-q', unborn);
  await f.runGit('-C', unborn, 'symbolic-ref', 'HEAD', 'refs/heads/feature/unborn');
  const empty = await identity(unborn, 'primary');
  assert.equal(empty.branch, 'refs/heads/feature/unborn');
  assert.equal(empty.head, null);
  assert.equal(empty.linkedWorktree, false);
  await f.runGit('checkout', '-q', '--detach', changed.head);
  await assert.rejects(identity(f.repo, 'primary'), { code: 'BINDING' });
});
test('Git binding proves the current exact ref without trusting its stored branch or HEAD', async t => {
  const f = await fixture(t);
  await f.runGit('add', '.sdlc');
  await f.runGit('commit', '-qm', 'Create owned binding fixture');
  const original = await identity(f.repo, 'primary');
  const calls = [];
  const observe = ({ process: child }) => {
    child.once('close', () => calls.push(child.spawnargs.slice(1)));
  };
  let current;
  subscribe('child_process', observe);
  try {
    current = await validateBinding(original);
  } finally {
    unsubscribe('child_process', observe);
  }
  assert.deepEqual(current, original);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], ['--no-pager', '--no-optional-locks', 'for-each-ref',
    '--count=1', '--format=%(HEAD)%00%(refname)%00%(objectname)', '--', original.branch]);

  await f.runGit('commit', '--allow-empty', '-qm', 'Advance owned binding fixture');
  const advanced = await validateBinding(original);
  assert.notEqual(advanced.head, original.head);
  assert.equal(advanced.head, await f.runGit('rev-parse', 'HEAD'));
  await f.runGit('checkout', '-qb', 'feature/binding-same-head');
  assert.equal(await f.runGit('rev-parse', 'HEAD'), advanced.head);
  await assert.rejects(validateBinding(original), { code: 'BINDING' });

  await f.runGit('checkout', '-qb', 'feature/binding-prefix/child');
  await assert.rejects(validateBinding({ ...original, branch: 'refs/heads/feature/binding-prefix' }),
    { code: 'BINDING' });
  await f.runGit('checkout', '-q', original.branch.slice('refs/heads/'.length));
  await assert.rejects(validateBinding({ ...original, branch: `${original.branch}\0` }),
    { code: 'BINDING' });

  const worktree = path.join(f.root, 'binding linked tree');
  await f.runGit('worktree', 'add', '-qb', 'feature/binding-linked', worktree);
  const linked = await identity(worktree, 'primary');
  assert.deepEqual(await validateBinding(linked), linked);
  const unborn = path.join(f.root, 'binding unborn');
  await f.runGit('init', '-q', unborn);
  await f.runGit('-C', unborn, 'symbolic-ref', 'HEAD', 'refs/heads/binding/unborn');
  const empty = await identity(unborn, 'primary');
  assert.equal(empty.head, null);
  assert.deepEqual(await validateBinding(empty), empty);

  await f.runGit('symbolic-ref', 'refs/heads/binding-alias', original.branch);
  await f.runGit('symbolic-ref', 'HEAD', 'refs/heads/binding-alias');
  const alias = await identity(f.repo, 'primary');
  assert.deepEqual(await validateBinding(alias), alias);
  await f.runGit('checkout', '-q', '--detach', advanced.head);
  await assert.rejects(validateBinding(original), { code: 'BINDING' });
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
