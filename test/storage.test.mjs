import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fixture } from './helpers.mjs';
import { canonical, digest } from '../src/core.mjs';
import { atomicWrite, readJson, updateJson, withLock, writeJson, safePath } from '../src/files.mjs';
import { identity } from '../src/git.mjs';
import { orderRecordRemovals } from '../src/store.mjs';

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
  await Promise.all(Array.from({ length: 8 }, () => updateJson(file, { revision: 0, count: 0 }, value => ({ ...value, count: value.count + 1 }), { waitMs: 3000 })));
  assert.deepEqual(await readJson(file), { revision: 8, count: 8 });
  await assert.rejects(updateJson(file, {}, value => value, { expectedRevision: 1 }), { code: 'STALE' });
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
