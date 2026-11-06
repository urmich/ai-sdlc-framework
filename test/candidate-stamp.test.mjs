import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import { setImmediate } from 'node:timers/promises';
import { fixture } from './helpers.mjs';
import { candidateSnapshot, candidateStamp } from '../src/validation.mjs';
import { LIMITS } from '../src/core.mjs';

const candidateQueries = [
  ['ls-files', '--stage', '-z'],
  ['diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z'],
  ['ls-files', '--others', '--exclude-standard', '-z'],
  ['rev-parse', '--show-object-format'],
  ['config', '--bool', 'core.filemode'],
];

test('T-PRD013 candidate Git reads overlap after fresh binding without changing complete source identities', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.repo, 'tracked.txt'), 'committed');
  await f.runGit('add', 'tracked.txt');
  await f.runGit('commit', '-qm', 'Create owned candidate identity fixture');
  await fs.writeFile(path.join(f.repo, 'tracked.txt'), 'unstaged');
  await fs.writeFile(path.join(f.repo, 'untracked.txt'), 'untracked');
  const state = await f.store.load(f.workItemId);
  for (const [read, expectedCount] of [[candidateStamp, 3], [candidateSnapshot, 5]]) {
    const expected = await read(state.metadata, state.manifest);
    const calls = [];
    let active = 0, peak = 0, bound = false, beforeBinding = false;
    const observe = ({ process: child }) => {
      child.once('spawn', () => {
        const args = child.spawnargs.slice(3);
        if (args[0] === 'for-each-ref') child.once('close', () => { bound = true; });
        if (!candidateQueries.some(query => JSON.stringify(query) === JSON.stringify(args))) return;
        beforeBinding ||= !bound;
        calls.push(args);
        peak = Math.max(peak, ++active);
        child.once('close', () => { active--; });
      });
    };
    subscribe('child_process', observe);
    try {
      assert.deepEqual(await read(state.metadata, state.manifest), expected);
    } finally {
      unsubscribe('child_process', observe);
    }
    assert.equal(beforeBinding, false);
    assert.deepEqual(calls, candidateQueries.slice(0, expectedCount));
    assert.equal(peak, expectedCount, 'Independent Git reads must not wait for one another');
    assert.equal(active, 0, 'Every dispatched read must finish before returning its identity');
  }
});

test('T-PRD013 candidate Git failures drain every dispatched process before exposing the ordered primary error', async t => {
  const f = await fixture(t);
  const state = await f.store.load(f.workItemId);
  await f.runGit('config', 'diff.algorithm', 'fixture-invalid-diff-algorithm');
  await assert.rejects(f.runGit(...candidateQueries[1]), error =>
    error.code !== 0 && /diff algorithm|diff\.algorithm/iu.test(error.stderr));
  for (const [read, expectedCount] of [[candidateStamp, 3], [candidateSnapshot, 5]]) {
    let active = 0, settled = false, release;
    const held = Promise.withResolvers();
    const observe = ({ process: child }) => {
      child.once('spawn', () => {
        const args = child.spawnargs.slice(3);
        const index = candidateQueries.findIndex(query => JSON.stringify(query) === JSON.stringify(args));
        if (index < 0) return;
        active++;
        child.once('close', () => { active--; });
        if (index === expectedCount - 1) {
          const emit = child.emit;
          child.emit = function (event, ...values) {
            if (event !== 'close') return emit.call(this, event, ...values);
            child.emit = emit;
            release = () => emit.call(child, event, ...values);
            held.resolve(true);
            return true;
          };
        }
      });
    };
    subscribe('child_process', observe);
    const result = read(state.metadata, state.manifest).then(value => {
      settled = true;
      return { value };
    }, error => {
      settled = true;
      return { error };
    });
    try {
      assert.equal(await Promise.race([held.promise, result.then(() => false)]), true,
        'All independent reads must dispatch even when an earlier read fails');
      await setImmediate();
      assert.equal(settled, false, 'A failed read must not escape while another completion is held');
      release();
      release = undefined;
      const outcome = await result;
      assert.equal(outcome.error?.code, 'GIT');
      assert.equal(outcome.error.message, 'Git diff failed');
      assert.equal(active, 0);
    } finally {
      release?.();
      await result;
      unsubscribe('child_process', observe);
    }
  }
});

test('candidate stamp ignores filesystem timestamp churn when exact file bytes and mode are unchanged', async t => {
  const f = await fixture(t);
  const file = path.join(f.repo, '.sdlc', 'config.json');
  const bytes = Buffer.from('{"defaultBranch":"refs/heads/main"}\n');
  await fs.writeFile(file, bytes);
  await fs.utimes(file, new Date('2000-01-01'), new Date('2000-01-01'));
  const state = await f.store.load(f.workItemId);
  const before = await candidateStamp(state.metadata, state.manifest);
  const previous = await fs.stat(file, { bigint: true });
  await fs.utimes(file, new Date('2010-01-01'), new Date('2010-01-01'));
  const current = await fs.stat(file, { bigint: true });
  assert.notEqual(current.mtimeNs, previous.mtimeNs);
  assert.equal(current.mode, previous.mode);
  assert.deepEqual(await fs.readFile(file), bytes);
  assert.equal(await candidateStamp(state.metadata, state.manifest), before);
});

test('candidate stamp detects same-size byte changes with restored modification time', async t => {
  const f = await fixture(t);
  const file = path.join(f.repo, 'candidate.txt');
  const time = new Date('2000-01-01');
  await fs.writeFile(file, 'before');
  await fs.utimes(file, time, time);
  const state = await f.store.load(f.workItemId);
  const before = await candidateStamp(state.metadata, state.manifest);
  const previous = await fs.stat(file, { bigint: true });
  await fs.writeFile(file, 'after!');
  await fs.utimes(file, time, time);
  const current = await fs.stat(file, { bigint: true });
  assert.equal(current.size, previous.size);
  assert.equal(current.mtimeNs, previous.mtimeNs);
  assert.equal(current.mode, previous.mode);
  assert.notEqual(await candidateStamp(state.metadata, state.manifest), before);
});

test('candidate stamp retains staged-index and branch identity guards', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.repo, 'candidate.txt'), 'content');
  const state = await f.store.load(f.workItemId);
  const before = await candidateStamp(state.metadata, state.manifest);
  await f.runGit('add', 'candidate.txt');
  assert.notEqual(await candidateStamp(state.metadata, state.manifest), before);
  await f.runGit('switch', '-c', 'feature/foreign');
  await assert.rejects(candidateStamp(state.metadata, state.manifest), { code: 'BINDING' });
});

test('candidate stamp refuses oversized dirty bytes without truncating its identity', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.repo, 'oversized.bin'), Buffer.alloc(LIMITS.artifact + 1));
  const state = await f.store.load(f.workItemId);
  await assert.rejects(candidateStamp(state.metadata, state.manifest), { code: 'CAPACITY' });
});
