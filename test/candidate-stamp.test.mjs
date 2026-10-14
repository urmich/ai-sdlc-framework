import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import { fixture } from './helpers.mjs';
import { candidateStamp } from '../src/validation.mjs';
import { LIMITS } from '../src/core.mjs';

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
