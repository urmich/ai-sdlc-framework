import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { createPlan, parseOptions, repositoryRoot, unitFiles } from '../scripts/test-runner.mjs';

const canonicalNames = [
  'T-101 selected fetch remote requires exactly one credential-free URL',
  'T-101 current canonical checkout, exact hosted URL and provider reference bind repository identity',
  'T-101 one checkout with different URLs and two checkouts with one URL stay distinct',
  'T-105 attempt capability is explicit, not guessed from a missing reference',
  'T-105 current run keys vary by full execution and legacy keys remain historical',
  'T-105 Azure DevOps build links verify both historical and current attempt identities',
  'T-106 artifact identity binds producer, hosted reference, bytes and exact candidate commit',
  'T-106 absent, contradictory or mutable artifact provenance cannot be admitted',
  'T-109 legacy match is exact over the entire nested argument object',
  'T-109 declared required and optional arguments are exhaustive',
  'T-109 mutations of every variable accepted argument alter action and call identity',
  'T-109 differing matches conflict in either order, including different meaning',
  'T-109 shell and independently recognized actions cannot be disguised',
  'T-109 malformed configuration and invalid action mapping cannot classify',
  'T-109 configured adapters classify only complete direct calls and expose conflicts',
  'T-109 the gate rejects a prepared PR ID different from the actual tool argument',
];

async function scratch(t) {
  const directory = await fs.mkdtemp(path.join(repositoryRoot, 'test', '.runner-fixture-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

function invoke(args) {
  const child = spawn(process.execPath, [
    path.join(repositoryRoot, 'scripts', 'test-runner.mjs'), ...args,
  ], { cwd: repositoryRoot, env: { ...process.env, SDLC_TEST_WORKERS: '2' }, shell: false });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return { child, done };
}

function summary(output, kind) {
  const prefix = `[test-runner:${kind}] `;
  const line = output.split(/\r?\n/u).find(value => value.startsWith(prefix));
  assert.ok(line, output);
  return JSON.parse(line.slice(prefix.length));
}

test('T-130 canonical fast manifest preserves the exact three files and 16 original case names', async () => {
  assert.deepEqual(unitFiles, [
    'test/provider-observations.unit.test.mjs',
    'test/execution-artifact-identity.test.mjs',
    'test/tool-adapters.test.mjs',
  ]);
  const plan = await createPlan(parseOptions(['unit'], {}));
  assert.deepEqual(plan.files.map(file => path.relative(repositoryRoot, file).split(path.sep).join('/')),
    [...unitFiles]);
  const names = [];
  for (const file of plan.files) {
    const source = await fs.readFile(file, 'utf8');
    names.push(...[...source.matchAll(/^test\('([^']+)'/gmu)].map(match => match[1]));
  }
  assert.deepEqual(names, canonicalNames);
});

test('T-130 full and coverage profiles discover every top-level test file exactly once', async () => {
  const expected = (await fs.readdir(path.join(repositoryRoot, 'test')))
    .filter(file => file.endsWith('.test.mjs')).sort();
  for (const profile of ['full', 'coverage']) {
    const plan = await createPlan(parseOptions([profile], {}));
    assert.deepEqual(plan.files.map(file => path.basename(file)).sort(), expected);
    assert.equal(new Set(plan.files).size, expected.length);
    assert.equal(plan.args.includes('--experimental-test-coverage'), profile === 'coverage');
    assert.equal(path.basename(plan.files[0]), 'deployment.test.mjs');
  }
});

test('T-130 options reject missing profiles, malformed workers, unknown options and partial selections', () => {
  for (const args of [[], ['other'], ['targeted'], ['full', 'test/test-runner.test.mjs'],
    ['unit', '--name', 'T-130'], ['targeted', '--bogus'], ['unit', '--workers'],
    ['unit', '--workers', '1', '--workers', '2'], ['targeted', '--name', '[', 'test/a.test.mjs']]) {
    assert.throws(() => parseOptions(args, {}));
  }
  for (const workers of ['', '0', '-1', '1.5', 'NaN', '33', 'Infinity', '2;echo bad']) {
    assert.throws(() => parseOptions(['full'], { SDLC_TEST_WORKERS: workers }));
    assert.throws(() => parseOptions(['full', '--workers', workers], {}));
  }
  assert.equal(parseOptions(['full'], { SDLC_TEST_WORKERS: '1' }).workers, 1);
  assert.equal(parseOptions(['full', '--workers', '32'], { SDLC_TEST_WORKERS: '1' }).workers, 32);
  const defaults = parseOptions(['full'], {}).workers;
  assert.ok(defaults >= 1 && defaults <= 16);
});

test('T-130 targeted selection rejects missing, escaping, non-test and duplicate files', async t => {
  const directory = await scratch(t);
  const notTest = path.join(directory, 'support.mjs');
  await fs.writeFile(notTest, 'export const value = 1;');
  const known = unitFiles[0];
  for (const files of [
    ['test/does-not-exist.test.mjs'], ['test/../outside.test.mjs'],
    [notTest], [known, known], [known, 'test/does-not-exist.test.mjs'],
  ]) {
    await assert.rejects(createPlan(parseOptions(['targeted', ...files], {})));
  }
});

test('T-130 public targeted runner supports filenames with spaces and exact name filtering', async t => {
  const directory = await scratch(t);
  const file = path.join(directory, 'test with spaces.test.mjs');
  const marker = path.join(directory, 'selected');
  await fs.writeFile(file, `import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
test('selected case', () => writeFile(${JSON.stringify(marker)}, 'selected'));
test('unselected failure', () => assert.fail('must not run'));
`);
  const result = await invoke(['targeted', '--workers', '1', '--name', '^selected case$', file]).done;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(await fs.readFile(marker, 'utf8'), 'selected');
  const start = summary(result.stdout, 'start');
  const end = summary(result.stdout, 'end');
  assert.equal(start.workers, 1);
  assert.equal(start.files.length, 1);
  assert.equal(start.executable, process.execPath);
  assert.equal(start.node, process.version);
  assert.equal(start.platform, process.platform);
  assert.equal(start.architecture, process.arch);
  assert.ok(end.elapsedMs > 0);
  assert.equal(end.exitCode, 0);
  assert.equal(end.signal, null);
});

test('T-130 public runner preserves a real failing child and still executes the passing sibling', async t => {
  const directory = await scratch(t);
  const fail = path.join(directory, 'fail.test.mjs');
  const pass = path.join(directory, 'pass.test.mjs');
  const marker = path.join(directory, 'passed');
  await fs.writeFile(fail, "import test from 'node:test';import assert from 'node:assert/strict';test('intentional runner failure',()=>assert.fail('runner failure diagnostic'));\n");
  await fs.writeFile(pass, `import test from 'node:test';import {writeFile} from 'node:fs/promises';test('passing sibling',()=>writeFile(${JSON.stringify(marker)},'passed'));\n`);
  const result = await invoke(['targeted', fail, pass]).done;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /runner failure diagnostic/u);
  assert.equal(await fs.readFile(marker, 'utf8'), 'passed');
  assert.equal(summary(result.stdout, 'end').exitCode, 1);
});

test('T-130 public runner preserves caller file order rather than sorting the expensive-first queue', async t => {
  const directory = await scratch(t);
  const marker = path.join(directory, 'order');
  const files = [];
  for (const id of ['z', 'a']) {
    const file = path.join(directory, `${id}.test.mjs`);
    await fs.writeFile(file, `import test from 'node:test';import {appendFile} from 'node:fs/promises';test('order ${id}',()=>appendFile(${JSON.stringify(marker)},'${id}\\n'));\n`);
    files.push(file);
  }
  const result = await invoke(['targeted', '--workers', '1', ...files]).done;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.deepEqual((await fs.readFile(marker, 'utf8')).trim().split(/\r?\n/u), ['z', 'a']);
});

async function waitFor(condition, description) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await delay(20);
  }
  assert.fail(`Timed out waiting for ${description}`);
}

function processRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

for (const [signal, exitCode] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  test(`T-130 ${signal} cancels active file workers before the public runner returns`, async t => {
    const directory = await scratch(t);
    const entered = path.join(directory, 'entered');
    const release = path.join(directory, 'release');
    await fs.mkdir(entered);
    await fs.mkdir(release);
    const files = [];
    for (const id of ['0', '1']) {
      const file = path.join(directory, `${id}.test.mjs`);
      await fs.writeFile(file, `import test from 'node:test';
import * as fs from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
test('cancel worker ${id}', async () => {
  await fs.mkdir(${JSON.stringify(entered)}+'/'+process.pid);
  const deadline=Date.now()+15000;
  while(!(await fs.readdir(${JSON.stringify(release)})).includes('stop')) {
    if(Date.now()>=deadline) throw new Error('Cancellation fixture release timed out');
    await delay(20);
  }
});
`);
      files.push(file);
    }
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const runner = pathToFileURL(path.join(repositoryRoot, 'scripts', 'test-runner.mjs')).href;
    const child = spawn(process.execPath, ['--input-type=module', '--eval', `
import {createPlan,parseOptions,run} from ${JSON.stringify(runner)};
process.once('message', ({signal}) => process.emit(signal));
const plan=await createPlan(parseOptions(${JSON.stringify(['targeted', '--workers', '2', ...files])}));
process.exitCode=await run(plan);
if(process.connected) process.disconnect();
`], { cwd: repositoryRoot, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    const done = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', code => resolve(code));
    });
    let pids = [];
    try {
      await waitFor(async () => (await fs.readdir(entered)).length === 2, 'two running cancellation workers');
      pids = (await fs.readdir(entered)).map(Number);
      assert.ok(pids.every(processRunning));
      await new Promise((resolve, reject) =>
        child.send({ signal }, error => error ? reject(error) : resolve()));
      const actual = await done;
      assert.equal(actual, exitCode, stdout + stderr);
      assert.match(stdout, /\bcancelled [1-9]\d*\b/u);
      assert.equal(summary(stdout, 'end').interruptedBy, signal);
      assert.ok(pids.every(pid => !processRunning(pid)), 'Runner returned with surviving file workers');
    } finally {
      await fs.writeFile(path.join(release, 'stop'), '');
      await done;
      await waitFor(() => pids.every(pid => !processRunning(pid)), 'owned worker cleanup');
    }
  });
}

for (const workers of [1, 2]) {
  test(`T-136 public runner enforces ${workers} real file workers and executes every file once`, async t => {
    const directory = await scratch(t);
    const entered = path.join(directory, 'entered');
    const finished = path.join(directory, 'finished');
    const release = path.join(directory, 'release');
    await Promise.all([entered, finished, release].map(file => fs.mkdir(file)));
    const ids = ['0', '1', '2', '3'];
    const files = [];
    for (const id of ids) {
      const file = path.join(directory, `${id}.test.mjs`);
      await fs.writeFile(file, `import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
test('worker ${id}', async () => {
  await fs.writeFile(${JSON.stringify(path.join(entered, id))}, '', {flag:'wx'});
  const deadline=Date.now()+20000;
  while(!(await fs.readdir(${JSON.stringify(release)})).includes('${id}')) {
    assert.ok(Date.now()<deadline,'worker release timed out');
    await delay(20);
  }
  await fs.writeFile(${JSON.stringify(path.join(finished, id))}, '', {flag:'wx'});
});
`);
      files.push(file);
    }
    const execution = invoke(['targeted', '--workers', String(workers), ...files]);
    let maxActive = 0;
    try {
      for (let count = 0; count < ids.length; count += workers) {
        await waitFor(async () => {
          const started = await fs.readdir(entered);
          const ended = new Set(await fs.readdir(finished));
          const active = started.filter(id => !ended.has(id));
          maxActive = Math.max(maxActive, active.length);
          assert.ok(active.length <= workers, `Observed ${active.length} workers, limit ${workers}`);
          return started.length === count + workers && active.length === workers;
        }, `${workers} active workers`);
        const ended = new Set(await fs.readdir(finished));
        const active = (await fs.readdir(entered)).filter(id => !ended.has(id));
        await Promise.all(active.map(id => fs.writeFile(path.join(release, id), '')));
        await waitFor(async () => (await fs.readdir(finished)).length === count + workers,
          'released batch completion');
      }
      const result = await execution.done;
      assert.equal(result.code, 0, result.stdout + result.stderr);
      assert.equal(maxActive, workers);
      assert.deepEqual((await fs.readdir(entered)).sort(), ids);
      assert.deepEqual((await fs.readdir(finished)).sort(), ids);
    } finally {
      await Promise.all(ids.map(id => fs.writeFile(path.join(release, id), '')));
      await execution.done;
    }
  });
}
