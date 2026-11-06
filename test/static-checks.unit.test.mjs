export const validationDeclarations = {
  "schemaVersion": 1,
  "surfaces": [
    {"coverage": "direct", "paths": ["scripts/check.mjs"]}
  ],
  "groups": [
    {"root": "T-PRD015 syntax checks use actual parsing without executing source and preserve the first failing file", "minimumSlots": 2},
    {"root": "T-PRD015 syntax checks preserve explicit full-check imports and reject invalid hook metadata", "minimumSlots": 2}
  ]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { setImmediate as turn } from 'node:timers/promises';
import { checkSyntaxSources, syntaxCheckWorkers } from '../scripts/check.mjs';

function gate() {
  let resolve;
  let reject;
  const promise = new Promise((pass, fail) => { resolve = pass; reject = fail; });
  return { promise, resolve, reject };
}

test('T-PRD015 syntax checks reuse released capacity without exceeding their worker bound', async () => {
  const gates = Array.from({ length: 5 }, gate);
  const calls = [];
  let active = 0;
  let peak = 0;
  const pending = checkSyntaxSources(['a', 'b', 'c', 'd', 'e'], {
    workers: 2,
    run: async (command, args) => {
      assert.equal(command, process.execPath);
      assert.equal(args[0], '--check');
      const index = calls.length;
      calls.push(args[1]);
      peak = Math.max(peak, ++active);
      try { await gates[index].promise; }
      finally { active--; }
    },
  });
  try {
    assert.deepEqual(calls, ['a', 'b']);
    gates[1].resolve();
    await turn();
    assert.deepEqual(calls, ['a', 'b', 'c']);
    assert.equal(active, 2);
    gates[2].resolve();
    await turn();
    assert.deepEqual(calls, ['a', 'b', 'c', 'd']);
    gates[0].resolve();
    await turn();
    assert.deepEqual(calls, ['a', 'b', 'c', 'd', 'e']);
    gates[3].resolve();
    gates[4].resolve();
    await pending;
    assert.equal(peak, 2);
    assert.equal(active, 0);
  } finally {
    for (const item of gates) item.resolve();
    await pending;
  }
});

test('T-PRD015 syntax checks drain dispatched siblings before returning the ordered primary error', async () => {
  const left = gate();
  const right = gate();
  const firstError = new Error('Earlier source failed');
  const laterError = new Error('Later source failed first');
  const calls = [];
  let completed = false;
  const pending = checkSyntaxSources(['first', 'second', 'never-started'], {
    workers: 2,
    run: async (_command, args) => {
      calls.push(args[1]);
      await (args[1] === 'first' ? left.promise : right.promise);
    },
  });
  const settled = pending.then(() => ({ passed: true }), error => ({ passed: false, error }))
    .finally(() => { completed = true; });
  try {
    right.reject(laterError);
    await turn();
    assert.equal(completed, false);
    assert.deepEqual(calls, ['first', 'second']);
    left.reject(firstError);
    const result = await settled;
    assert.equal(result.passed, false);
    assert.equal(result.error, firstError);
    assert.deepEqual(calls, ['first', 'second']);
  } finally {
    left.resolve();
    right.resolve();
    await settled;
  }
});

test('T-PRD015 syntax checks use actual parsing without executing source and preserve the first failing file', async t => {
  const root = path.resolve('.test-data', `syntax-check-${randomUUID()}`);
  await fs.mkdir(root, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, maxRetries: 10, retryDelay: 100 }));
  const good = path.join(root, 'good.mjs');
  const bad = path.join(root, 'first-bad.mjs');
  const later = path.join(root, 'later-bad.mjs');
  const declarations = Array.from({ length: 20000 }, (_, index) => `export const value${index} = ${index};`).join('\n');
  await fs.writeFile(good, `${declarations}\nthrow new Error("Syntax checks must not execute source");\n`);
  await fs.writeFile(bad, `${declarations}\nexport const broken = ;\n`);
  await fs.writeFile(later, 'export const alsoBroken = ;\n');
  const execute = promisify(execFile);
  const children = [];
  const run = (...args) => {
    const pending = execute(...args);
    const record = { pid: pending.child.pid, started: null, closed: null };
    children.push(record);
    pending.child.once('spawn', () => { record.started = process.hrtime.bigint(); });
    pending.child.once('close', () => { record.closed = process.hrtime.bigint(); });
    return pending;
  };
  await checkSyntaxSources([good], { workers: 2, run });
  const offset = children.length;
  await assert.rejects(checkSyntaxSources([good, bad, later], { workers: 2, run }), error => {
    assert.equal(error.code, 1);
    assert.ok(error.stderr.includes(bad));
    assert.match(error.stderr, /SyntaxError/u);
    return true;
  });
  const parallel = children.slice(offset);
  assert.ok(parallel.every(child => Number.isSafeInteger(child.pid) && child.started !== null && child.closed !== null));
  assert.ok(parallel.some((left, index) => parallel.slice(index + 1)
    .some(right => left.started < right.closed && right.started < left.closed)),
  'Independent real parser children must have overlapping observed lifetimes');
  t.diagnostic(JSON.stringify({ kind: 'syntax-parser-overlap', children: parallel.map(child => ({
    pid: child.pid, startedNs: child.started.toString(), closedNs: child.closed.toString(),
  })) }));
});

test('T-PRD015 syntax checks respect inherited allocation and reject invalid limits before dispatch', async () => {
  assert.equal(syntaxCheckWorkers({ parallelism: 3, inheritedBudget: '' }), 3);
  assert.equal(syntaxCheckWorkers({ parallelism: 64, inheritedBudget: '' }), 32);
  assert.equal(syntaxCheckWorkers({ parallelism: 16, inheritedBudget: 'inherited-allocation' }), 1);
  assert.throws(() => syntaxCheckWorkers({ parallelism: 0, inheritedBudget: '' }));
  let calls = 0;
  for (const workers of [0, -1, 1.5, 33]) {
    await assert.rejects(checkSyntaxSources(['source'], { workers, run: async () => { calls++; } }));
  }
  assert.equal(calls, 0);
});

test('T-PRD015 syntax checks preserve explicit full-check imports and reject invalid hook metadata', async t => {
  const root = path.resolve('.test-data', `static-negative-${randomUUID()}`);
  await fs.mkdir(root, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, maxRetries: 10, retryDelay: 100 }));
  for (const directory of ['src', 'bin', 'scripts', 'test', 'assets/hooks']) {
    await fs.mkdir(path.join(root, directory), { recursive: true });
  }
  await fs.writeFile(path.join(root, 'src', 'valid.mjs'), 'throw new Error("Syntax checks must not execute source");\n');
  await fs.writeFile(path.join(root, 'assets', 'hooks', 'sdlc.json'), JSON.stringify({ version: 99 }));
  const moduleURL = pathToFileURL(path.resolve('scripts', 'check.mjs')).href;
  const wrapper = path.join(root, 'verify-static.mjs');
  await fs.writeFile(wrapper, `await import(${JSON.stringify(moduleURL)});\n`);
  const imported = await promisify(execFile)(process.execPath, [wrapper], { cwd: root });
  assert.equal(imported.stdout, '');
  assert.equal(imported.stderr, '');
  await fs.writeFile(wrapper, `
try { const { check } = await import(${JSON.stringify(moduleURL)}); await check(); }
catch (error) {
  if (error.code !== 'ERR_ASSERTION') throw error;
  console.error(JSON.stringify({code:error.code,message:error.message,actual:error.actual,expected:error.expected}));
  process.exitCode=1;
}
`);
  await assert.rejects(promisify(execFile)(process.execPath, [wrapper], { cwd: root }), error => {
    assert.equal(error.code, 1);
    const diagnostic = JSON.parse(error.stderr);
    assert.equal(diagnostic.code, 'ERR_ASSERTION');
    assert.equal(diagnostic.actual, 99);
    assert.equal(diagnostic.expected, 1);
    assert.match(diagnostic.message, /99 !== 1/u);
    return true;
  });
});
