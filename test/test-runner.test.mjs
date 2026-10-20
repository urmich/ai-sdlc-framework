export const validationDeclarations = {
  "schemaVersion": 1,
  "surfaces": [{"coverage": "process", "paths": ["scripts/test-runner.mjs", "scripts/test-worker.mjs"]}],
  "resources": {
    "workers": 2,
    "names": [
      "T-130 SIGINT cancels active file workers before the public runner returns",
      "T-130 SIGTERM cancels active file workers before the public runner returns",
      "T-136 public runner enforces 2 real file workers and executes every file once"
    ],
    "owner": "runner-resource-contract",
    "reason": "These actual overlap/cancellation callbacks need two slots reserved before their deadlines start."
  },
  "applicability": [{
    "names": [
      "T-130 SIGINT cancels active file workers before the public runner returns",
      "T-130 SIGTERM cancels active file workers before the public runner returns",
      "T-136 public runner enforces 1 real file workers and executes every file once",
      "T-136 public runner enforces 2 real file workers and executes every file once"
    ],
    "platforms": ["linux-x64", "windows-x64", "macos-arm64", "macos-x64"],
    "owner": "runner-resource-contract",
    "reason": "The requested real worker count is an execution prerequisite, not permission to multiply a nested host allocation.",
    "prerequisites": ["Aggregate host allocation supports the declared one/two actual file workers"]
  }],
  "variants": [
    {"expression": "`T-130 ${signal} cancels active file workers before the public runner returns`", "domains": {"signal": ["SIGINT", "SIGTERM"]}},
    {"expression": "`T-136 public runner enforces ${workers} real file workers and executes every file once`", "domains": {"workers": ["1", "2"]}}
  ],
  "plannedCases": [
    {"id": "T-PRD010", "selectors": [
      {"name": "T-130 public runner preserves caller file order rather than sorting the expensive-first queue", "parents": []},
      {"name": "T-136 public runner enforces 1 real file workers and executes every file once", "parents": []},
      {"name": "T-136 public runner enforces 2 real file workers and executes every file once", "parents": []}
    ]},
    {"id": "T-PRD007", "selectors": [
      {"name": "T-130 public runner preserves a real failing child and still executes the passing sibling", "parents": []},
      {"name": "T-130 SIGINT cancels active file workers before the public runner returns", "parents": []},
      {"name": "T-130 SIGTERM cancels active file workers before the public runner returns", "parents": []}
    ]},
    {"id": "T-PRD018", "selectors": [
      {"name": "T-GHB24 native execution evidence distinguishes passing, failing and skipped assertions without overwriting reports", "parents": []},
      {"name": "T-130 SIGINT cancels active file workers before the public runner returns", "parents": []},
      {"name": "T-130 SIGTERM cancels active file workers before the public runner returns", "parents": []}
    ]}
  ]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { createPlan, parseOptions, repositoryRoot, unitFiles } from '../scripts/test-runner.mjs';
import { readTestBudget } from '../scripts/test-budget.mjs';
import { digest } from '../src/core.mjs';
import { sanitizeExecutionPayload } from '../src/validation-evidence.mjs';

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

function invoke(args, environment = {}) {
  const child = spawn(process.execPath, [
    path.join(repositoryRoot, 'scripts', 'test-runner.mjs'), ...args,
  ], { cwd: repositoryRoot, env: { ...process.env, SDLC_TEST_WORKERS: '2', ...environment }, shell: false });
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
    assert.equal(path.basename(plan.files[0]), 'observation-retention-refresh.test.mjs');
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
  const missing = await invoke(['targeted', '--workers', '1', '--name', '^no matching assertion$', file]).done;
  assert.equal(missing.code, 2, missing.stdout + missing.stderr);
  assert.match(missing.stderr, /no test assertions/u);
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

test('T-GHB24 native execution evidence distinguishes passing, failing and skipped assertions without overwriting reports', async t => {
  const directory = await scratch(t);
  const evidence = await fs.mkdtemp(path.join(repositoryRoot, '.test-data', 'runner-evidence-'));
  t.after(() => fs.rm(evidence, { recursive: true, force: true }));
  const file = path.join(directory, 'outcomes.test.mjs');
  await fs.writeFile(file, `import test from 'node:test';
import assert from 'node:assert/strict';
test('actual passing assertion', () => assert.equal(2 + 2, 4));
test('actual failing assertion', () => assert.equal(2 + 2, 5));
test('unexecuted assertion', {skip: 'Owned unavailable-adapter fixture'}, () => assert.fail('must not execute'));
`);
  const reportPath = path.join(evidence, 'outcomes.json');
  const result = await invoke(['targeted', '--workers', '1', file], { SDLC_TEST_REPORT_FILE: reportPath }).done;
  assert.equal(result.code, 1, result.stdout + result.stderr);
  const retainedReport = await fs.readFile(reportPath, 'utf8');
  assert.ok(retainedReport.trim(), result.stdout + result.stderr);
  const report = JSON.parse(retainedReport);
  assert.equal(report.profile, 'targeted');
  assert.equal(report.platform, process.platform);
  assert.equal(report.architecture, process.arch);
  const outcomes = Object.fromEntries(report.executions.map(item => [item.name, item.status]));
  assert.equal(outcomes['actual passing assertion'], 'Passed');
  assert.equal(outcomes['actual failing assertion'], 'Failed');
  assert.equal(outcomes['unexecuted assertion'], 'Skipped');
  assert.equal(report.executions.find(item => item.name === 'unexecuted assertion').skipReason,
    'Owned unavailable-adapter fixture');
  assert.ok(report.command.includes('targeted'));
  assert.equal(report.executable, process.execPath);
  assert.equal(report.summary.success, false);
  assert.equal(report.complete, true);
  assert.equal(report.exitCode, 1);
  assert.ok(Date.parse(report.finishedAt) >= Date.parse(report.startedAt));
  const journalPath = `${reportPath}.journal.ndjson`;
  const originalJournal = await fs.readFile(journalPath);
  const journal = originalJournal.toString('utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(journal[0].kind, 'execution-start');
  assert.equal(journal.at(-1).kind, 'execution-end');
  assert.ok(journal.some(event => event.kind === 'registration'));
  assert.ok(journal.some(event => event.kind === 'start'));
  assert.deepEqual(journal.map(event => event.sequence),
    Array.from({ length: journal.length }, (_, index) => index + 1));
  assert.ok(journal.some(event => event.kind === 'completion' &&
    event.status === 'Failed' && event.diagnostic.message));
  assert.deepEqual([report.summary.counts.passed, report.summary.counts.failed,
    report.summary.counts.skipped], [1, 1, 1]);
  assert.ok(report.executions.every(item => item.file.startsWith('test/') && !path.isAbsolute(item.file)));
  const original = await fs.readFile(reportPath);
  const overwrite = await invoke(['targeted', file], { SDLC_TEST_REPORT_FILE: reportPath }).done;
  assert.equal(overwrite.code, 1);
  assert.deepEqual(await fs.readFile(reportPath), original);
  assert.deepEqual(await fs.readFile(journalPath), originalJournal);
  const outside = await invoke(['targeted', file],
    { SDLC_TEST_REPORT_FILE: path.join(directory, 'outside.json') }).done;
  assert.equal(outside.code, 1);
  await assert.rejects(fs.stat(path.join(directory, 'outside.json')), { code: 'ENOENT' });
});

test('T-PRD018 unsafe failure diagnostics terminate without hanging or manufacturing complete evidence',
  { timeout: 30000 }, async t => {
    const directory = await scratch(t);
    const evidence = await fs.mkdtemp(path.join(repositoryRoot, '.test-data', 'runner-rejected-'));
    t.after(() => fs.rm(evidence, { recursive: true, force: true }));
    const file = path.join(directory, 'rejected.test.mjs');
    await fs.writeFile(file, "import test from 'node:test';import assert from 'node:assert/strict';" +
      "test('unsupported diagnostic fixture',()=>assert.fail(\"unsupported ['quoted diagnostic']\"));\n");
    const reportPath = path.join(evidence, 'rejected.json');
    const pending = invoke(['targeted', file], { SDLC_TEST_REPORT_FILE: reportPath });
    t.after(async () => {
      if (pending.child.exitCode === null && pending.child.signalCode === null) pending.child.kill();
      await pending.done;
    });
    const result = await pending.done;
    assert.notEqual(result.code, 0);
    const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    assert.equal(report.complete, false);
    assert.equal(report.evidenceError.code, 'UNSAFE');
    assert.ok(!report.executions.some(row => row.status === 'Passed'));
    const rows = (await fs.readFile(`${reportPath}.journal.ndjson`, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(rows.some(row => row.kind === 'evidence-rejected' && row.code === 'UNSAFE'));
    assert.ok(rows.some(row => row.kind === 'evidence-rejected' && row.cause?.message &&
      /^[a-f0-9]{64}$/u.test(row.original?.sha256) && row.original.bytes > 0));
    assert.equal(report.executions.find(row => row.name === 'unsupported diagnostic fixture').status, 'Failed');
    assert.equal(rows.at(-1).kind, 'execution-end');
    assert.equal(rows.at(-1).complete, false);

    const legitimate = path.join(directory, 'markdown-failure.test.mjs');
    const identityFile = path.join(directory, 'message-identity.json');
    const siblingMarker = path.join(directory, 'sibling-finished');
    const privateValue = 'fixture-worker-private-value';
    const guide = `# Current installation\n\n\`\`\`js\nconst config = { authorization: '${privateValue}' };\n\`\`\`\n`;
    await fs.writeFile(legitimate, `import test from 'node:test';import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
test('legitimate Markdown assertion failure',()=>{
  try{assert.match(${JSON.stringify(guide)},/Old local title/u);}
  catch(error){writeFileSync(${JSON.stringify(identityFile)},JSON.stringify({
    sha256:createHash('sha256').update(error.message).digest('hex'),bytes:Buffer.byteLength(error.message)
  }));throw error;}
});
test('passing sibling after diagnostic rejection',async()=>{
  await delay(75);writeFileSync(${JSON.stringify(siblingMarker)},'finished');
});
`);
    const legitimateReportPath = path.join(evidence, 'markdown-failure.json');
    const observed = await invoke(['targeted', '--workers', '1', legitimate], {
      SDLC_TEST_REPORT_FILE: legitimateReportPath,
    }).done;
    assert.equal(observed.code, 1, 'Keep the genuine failed assertion non-passing');
    const preserved = JSON.parse(await fs.readFile(legitimateReportPath, 'utf8'));
    assert.equal(preserved.complete, false, 'Rejected diagnostic text must not manufacture complete evidence');
    assert.equal(preserved.evidenceError.scope, 'failure-diagnostic');
    assert.equal(preserved.evidenceError.fatal, false);
    assert.deepEqual([preserved.summary.counts.failed, preserved.summary.counts.passed,
      preserved.summary.counts.cancelled], [1, 1, 0]);
    const failed = preserved.executions.find(row => row.name === 'legitimate Markdown assertion failure');
    assert.equal(failed.status, 'Failed');
    assert.equal(failed.diagnostic.retention.status, 'Rejected');
    assert.deepEqual(failed.diagnostic.originalMessage, JSON.parse(await fs.readFile(identityFile, 'utf8')));
    assert.equal(await fs.readFile(siblingMarker, 'utf8'), 'finished');
    const journalText = await fs.readFile(`${legitimateReportPath}.journal.ndjson`, 'utf8');
    const notices = journalText.trim().split('\n').map(JSON.parse);
    const rejected = notices.find(row => row.kind === 'evidence-rejected');
    assert.equal(rejected.scope, 'failure-diagnostic');
    assert.equal(rejected.nameDigest, digest(failed.name));
    assert.equal(rejected.groupId, failed.groupId);
    assert.ok(rejected.original.bytes > failed.diagnostic.originalMessage.bytes);
    assert.deepEqual(rejected.original, preserved.evidenceError.original);
    const { status, ...cause } = failed.diagnostic.retention;
    assert.equal(status, 'Rejected');
    assert.deepEqual(rejected.cause, cause, 'Retain the actual sanitizer cause identity, not a manufactured exception');
    assert.match(rejected.cause.message, /structured log fragment/u);
    assert.deepEqual(notices.filter(row => row.kind === 'completion').map(({ kind, ...row }) => row),
      preserved.executions);
    assert.ok(notices.every((row, index) => row.sequence === index + 1));
    for (const text of [journalText, JSON.stringify(preserved), observed.stdout, observed.stderr]) {
      assert.ok(!text.includes(privateValue), 'Rejected failure text must not escape through artifacts or the reporter');
    }
    sanitizeExecutionPayload(Buffer.from(JSON.stringify({ stdout: observed.stdout, stderr: observed.stderr })));
    const budget = preserved.resources.budget;
    assert.ok(budget.activeWorkers <= budget.capacity && budget.peakActiveWorkers <= budget.capacity);
    assert.ok(budget.residentWorkers <= budget.residentLimit &&
      budget.peakResidentWorkers <= budget.residentLimit &&
      budget.peakPotentialResidentWorkers <= budget.residentLimit);
    assert.ok(budget.producers <= budget.producerLimit && budget.peakProducers <= budget.producerLimit &&
      budget.controls <= budget.controlLimit && budget.peakControls <= budget.controlLimit);
    const owned = preserved.groupExecution.groups;
    assert.equal(owned.length, 2);
    assert.equal(new Set(owned.flatMap(group => group.processIds)).size, 2);
    for (const group of owned) {
      assert.equal(group.processes.length, 1);
      const lease = group.processes[0];
      assert.deepEqual(group.processIds, [lease.pid]);
      assert.ok(Number.isFinite(Date.parse(lease.startedAt)) && Number.isFinite(Date.parse(lease.finishedAt)) &&
        Date.parse(lease.finishedAt) >= Date.parse(lease.startedAt), 'Every owned worker lease must be closed');
      assert.equal(group.finishedAt, lease.finishedAt);
      assert.throws(() => process.kill(lease.pid, 0), error => error.code === 'ESRCH',
        'No owned file process may survive the nested command');
    }
    if (process.env.SDLC_TEST_BUDGET) {
      assert.equal(budget.id, (await readTestBudget()).id,
        'Nested validation must share its real ancestor allocation, not create a replacement budget');
    } else {
      assert.equal(budget.activeWorkers, 0);
      assert.equal(budget.residentWorkers, 0);
      assert.equal(budget.pendingParentRestorations, 0);
    }

    const opaque = path.join(directory, 'opaque-diagnostic.test.mjs');
    await fs.writeFile(opaque, "import test from 'node:test';" +
      "test('opaque non-failure diagnostic',t=>t.diagnostic('opaque \\u001b[31m payload'));");
    const opaquePath = path.join(evidence, 'opaque-diagnostic.json');
    const denied = await invoke(['targeted', opaque], { SDLC_TEST_REPORT_FILE: opaquePath }).done;
    assert.notEqual(denied.code, 0);
    const incomplete = JSON.parse(await fs.readFile(opaquePath, 'utf8'));
    assert.equal(incomplete.complete, false);
    assert.equal(incomplete.evidenceError.scope, 'event');
    assert.equal(incomplete.evidenceError.fatal, true);
    assert.equal(incomplete.evidenceError.cause.code, 'UNSAFE');
    assert.ok(!denied.stdout.includes('\u001b'));
  });

test('T-PRD018 nested concurrent results retain exact ancestry and safe original selector identities', async t => {
  const directory = await scratch(t);
  const evidence = await fs.mkdtemp(path.join(repositoryRoot, '.test-data', 'runner-nested-'));
  t.after(() => fs.rm(evidence, { recursive: true, force: true }));
  const file = path.join(directory, 'nested.test.mjs');
  await fs.writeFile(file, `export const validationDeclarations = {"schemaVersion":1,"variants":[
  {"expression":"name","names":["first","second"]}
]};
import test from 'node:test';
import assert from 'node:assert/strict';
test('outer', {concurrency: 2}, async parent => {
  await Promise.all(['first','second'].map(name => parent.test(name, async child => {
    await child.test('same leaf name', () => assert.equal(name.length > 0, true));
  })));
});
`);
  const reportPath = path.join(evidence, 'nested.json');
  const result = await invoke(['targeted', file], { SDLC_TEST_REPORT_FILE: reportPath }).done;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  assert.equal(report.complete, true);
  const leaves = report.executions.filter(item => item.name === 'same leaf name');
  assert.equal(leaves.length, 2);
  assert.deepEqual(leaves.map(item => item.parents).sort(),
    [['outer', 'first'], ['outer', 'second']]);
  assert.ok(leaves.every(item => item.nameDigest && item.parentDigests.length === 2));
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
    const allocation = process.env.SDLC_TEST_BUDGET ? await readTestBudget() : null;
    if (allocation && allocation.capacity < 2) { t.skip('Two real file workers require two host slots'); return; }
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
    const evidence = await fs.mkdtemp(path.join(repositoryRoot, '.test-data', 'runner-cancellation-'));
    t.after(() => fs.rm(evidence, { recursive: true, force: true }));
    const reportPath = path.join(evidence, 'cancelled.json');
    env.SDLC_TEST_REPORT_FILE = reportPath;
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
      await waitFor(async () => {
        const contents = await fs.readFile(`${reportPath}.journal.ndjson`, 'utf8');
        return contents.includes('"kind":"start"');
      }, 'durably flushed running output before final report');
      assert.equal((await fs.readFile(reportPath)).length, 0);
      await new Promise((resolve, reject) =>
        child.send({ signal }, error => error ? reject(error) : resolve()));
      const actual = await done;
      assert.equal(actual, exitCode, stdout + stderr);
      assert.match(stdout, /\bcancelled [1-9]\d*\b/u);
      assert.equal(summary(stdout, 'end').interruptedBy, signal);
      assert.ok(pids.every(pid => !processRunning(pid)), 'Runner returned with surviving file workers');
      const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
      assert.equal(report.complete, false);
      assert.equal(report.exitCode, exitCode);
      assert.ok(report.summary.counts.cancelled > 0);
      assert.ok(report.executions.some(item => item.status === 'Cancelled'));
    } finally {
      await fs.writeFile(path.join(release, 'stop'), '');
      await done;
      await waitFor(() => pids.every(pid => !processRunning(pid)), 'owned worker cleanup');
    }
  });
}

for (const workers of [1, 2]) {
  test(`T-136 public runner enforces ${workers} real file workers and executes every file once`, async t => {
    const allocation = process.env.SDLC_TEST_BUDGET ? await readTestBudget() : null;
    if (allocation && allocation.capacity < workers) { t.skip('Requested real workers exceed the host allocation'); return; }
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
