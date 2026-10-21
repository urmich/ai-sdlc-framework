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
import { createPlan, parseOptions, repositoryRoot, unitFiles, validationSelectionDescriptor,
  validationSelectionProtocol, writeValidationSelection } from '../scripts/test-runner.mjs';
import { discoverDeclarations } from '../scripts/validation-inventory.mjs';
import { nativeStageSelections, validateNativeGroupReport } from '../scripts/native-validation.mjs';
import { readTestBudget } from '../scripts/test-budget.mjs';
import { digest } from '../src/core.mjs';
import { sanitizeExecutionPayload } from '../src/validation-evidence.mjs';
import { executeValidationCommand, processDiagnostic } from '../scripts/validation-tools.mjs';

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

async function scratch(t, root = repositoryRoot) {
  const directory = await fs.mkdtemp(path.join(root, 'test', '.runner-fixture-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

function invoke(args, environment = {}, root = repositoryRoot) {
  const child = spawn(process.execPath, [
    path.join(root, 'scripts', 'test-runner.mjs'), ...args,
  ], { cwd: root, env: { ...process.env, SDLC_TEST_WORKERS: '2', ...environment }, shell: false });
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

function runnerFailureDiagnostic({ stdout, stderr = '', ...context }) {
  const errorPrefix = /^(?:\[(?:test-runner|test-worker):error\] |(?:[A-Za-z]+)?Error(?: \[[A-Z0-9_]+\])?: )/u;
  const errors = `${stdout}\n${stderr}`.split(/\r?\n/u)
    .filter(line => errorPrefix.test(line))
    .slice(0, 4).map(line => processDiagnostic(line.replace(errorPrefix, '')));
  return JSON.stringify({ kind: 'runner-subprocess-failure', ...context, errors,
    originalOutput: {
      stdout: { sha256: digest(stdout), bytes: Buffer.byteLength(stdout) },
      stderr: { sha256: digest(stderr), bytes: Buffer.byteLength(stderr) },
    } });
}

function summary(output, kind) {
  const prefix = `[test-runner:${kind}] `;
  const line = output.split(/\r?\n/u).find(value => value.startsWith(prefix));
  assert.ok(line, line ? undefined : runnerFailureDiagnostic({ stdout: output, expectedSummary: kind }));
  return JSON.parse(line.slice(prefix.length));
}

test('T-PRD018 runner assertion diagnostics retain subprocess identities without inline source', () => {
  const source = 'JSON.stringify({platform:process.platform,arch:process.arch,major:Number(process.versions.node.split(".")[0])})';
  const stdout = `[test-runner:error] Owned cancellation fixture did not complete\n` +
    `[test-runner:start] ${JSON.stringify({ command: ['node', '--eval', source] })}\n`;
  assert.throws(() => summary(stdout, 'end'), error => {
    const retained = sanitizeExecutionPayload(Buffer.from(JSON.stringify({ message: error.message })));
    const diagnostic = JSON.parse(retained.message.split('\n')[0]);
    assert.equal(diagnostic.kind, 'runner-subprocess-failure');
    assert.equal(diagnostic.expectedSummary, 'end');
    assert.equal(diagnostic.errors[0].message, 'Owned cancellation fixture did not complete');
    assert.deepEqual(diagnostic.originalOutput.stdout, { sha256: digest(stdout), bytes: Buffer.byteLength(stdout) });
    assert.ok(!retained.message.includes(source));
    return true;
  });
  assert.throws(() => assert.equal(1, 130, runnerFailureDiagnostic({
    stdout, stderr: 'Error: Owned cancellation delivery failed\n',
    expectedExitCode: 130, actualExitCode: 1,
  })), error => {
    const retained = sanitizeExecutionPayload(Buffer.from(JSON.stringify({ message: error.message })));
    const diagnostic = JSON.parse(retained.message.split('\n')[0]);
    assert.equal(diagnostic.expectedExitCode, 130);
    assert.equal(diagnostic.actualExitCode, 1);
    assert.equal(diagnostic.errors[1].message, 'Owned cancellation delivery failed');
    assert.ok(!retained.message.includes(source));
    return true;
  });
  const structured = JSON.stringify({ detail: 'x'.repeat(2100) });
  const stderr = `Error: ${structured}\n`;
  assert.throws(() => assert.equal(1, 130, runnerFailureDiagnostic({
    stdout: structured, stderr, expectedExitCode: 130, actualExitCode: 1,
  })), error => {
    const retained = sanitizeExecutionPayload(Buffer.from(JSON.stringify({ message: error.message })));
    const diagnostic = JSON.parse(retained.message.split('\n')[0]);
    assert.equal(diagnostic.actualExitCode, 1);
    assert.equal(diagnostic.expectedExitCode, 130);
    assert.deepEqual(diagnostic.originalOutput.stdout,
      { sha256: digest(structured), bytes: Buffer.byteLength(structured) });
    assert.deepEqual(diagnostic.originalOutput.stderr,
      { sha256: digest(stderr), bytes: Buffer.byteLength(stderr) });
    assert.deepEqual(diagnostic.errors[0].original,
      { sha256: digest(structured), bytes: Buffer.byteLength(structured) });
    assert.ok(diagnostic.errors[0].message.length <= 2000);
    return true;
  });
});

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

test('T-PRD017 owned selection files preserve a complete large native stage without Windows-sized argv', async t => {
  const directory = await scratch(t);
  const evidence = await fs.mkdtemp(path.join(repositoryRoot, '.test-data', 'selection-transport-'));
  t.after(() => fs.rm(evidence, { recursive: true, force: true }));
  const marker = path.join(directory, 'executed');
  const file = path.join(directory, 'large.unit.test.mjs');
  const relative = path.relative(repositoryRoot, file).split(path.sep).join('/');
  const names = [0, 1].map(index => `large selected unit ${index} ${'x'.repeat(22000)}`);
  const source = "import test from 'node:test';import {appendFile} from 'node:fs/promises';" +
    names.map((name, index) =>
      `test(${JSON.stringify(name)},()=>appendFile(${JSON.stringify(marker)},'${index}\\n'));`).join('\n');
  await fs.writeFile(file, source);
  const declarations = [
    ...unitFiles.map((unit, index) => discoverDeclarations(
      `import test from 'node:test';test('canonical fixture ${index}',()=>{});`, unit)),
    discoverDeclarations(source, relative),
    discoverDeclarations("import test from 'node:test';test('remaining regression fixture',()=>{});",
      'test/transport-remainder.test.mjs'),
  ];
  const inventory = { complete: true, unresolved: [], nodeUnresolved: [],
    files: declarations.map(({ file, sourceDigest }) => ({ file, sourceDigest })),
    cases: declarations.flatMap(declaration => declaration.cases) };
  const stages = nativeStageSelections(inventory, JSON.stringify({ tests: [] }));
  const stage = stages.find(stage => stage.name === 'required-units');
  assert.deepEqual(stages.map(stage => stage.name), ['unit', 'required-units', 'regression']);
  assert.deepEqual(stages[0].args, ['unit']);
  assert.ok(stage.selectorName.length > 32767);
  assert.deepEqual(stage.cases.map(test => test.name), names);
  assert.deepEqual(stage.args, ['targeted', '--selection-file', stage.selection.path]);
  assert.ok(stage.args.join(' ').length < 200);
  const legacyArgs = ['--eval', 'process.exit(0)', '--', 'scripts/test-runner.mjs',
    'targeted', '--name', stage.selectorName, ...stage.files];
  let launch;
  try {
    const child = spawn(process.execPath, legacyArgs, { cwd: repositoryRoot, stdio: 'ignore', shell: false });
    launch = await new Promise(resolve => {
      child.once('error', error => resolve({ error: error.code, pid: child.pid }));
      child.once('close', code => resolve({ code, pid: child.pid }));
    });
  } catch (error) { launch = { error: error.code }; }
  if (process.platform === 'win32') {
    assert.equal(launch.error, 'ENAMETOOLONG');
    assert.equal(launch.pid, undefined);
  } else assert.equal(launch.code, 0, 'The inert compatibility probe must never execute fixture tests');
  const reference = await writeValidationSelection({ files: stage.files, name: stage.selectorName });
  t.after(() => fs.unlink(path.join(repositoryRoot, reference.path)));
  assert.deepEqual(reference, stage.selection);
  assert.deepEqual(await writeValidationSelection({ files: stage.files, name: stage.selectorName }), reference);
  const selected = await createPlan(parseOptions([...stage.args, '--workers', '1'], {}));
  assert.deepEqual(selected.testOptions.testNamePatterns, [stage.selectorName]);
  assert.deepEqual(selected.groups.flatMap(group => group.assertionIds).sort(),
    stage.cases.map(test => test.id).sort());
  const reportPath = path.join(evidence, 'large-stage.json');
  const result = await invoke([...stage.args, '--workers', '1'], { SDLC_TEST_REPORT_FILE: reportPath }).done;
  assert.equal(result.code, 0, 'The bounded public command must execute every large-selected fixture root');
  assert.deepEqual((await fs.readFile(marker, 'utf8')).trim().split('\n'), ['0', '1']);
  const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  assert.equal(report.complete, true);
  assert.deepEqual(report.selection.namePatterns, [stage.selectorName]);
  assert.deepEqual(report.executions.map(test => test.name), names);
  assert.equal(report.summary.counts.passed, 2);
  assert.deepEqual(report.command.slice(2), [...stage.args, '--workers', '1']);
  const journal = await fs.readFile(`${reportPath}.journal.ndjson`, 'utf8');
  const target = `${{ win32: 'windows', darwin: 'macos', linux: 'linux' }[process.platform]}-${process.arch}`;
  assert.equal(validateNativeGroupReport({ inventory, stage, report, journal, target }).length, 2);
  const changed = structuredClone(report);
  changed.selection.namePatterns = ['different selector'];
  assert.throws(() => validateNativeGroupReport({ inventory, stage, report: changed, journal, target }),
    /selection patterns/u);

  const malformed = [
    { ...validationSelectionDescriptor({ files: [relative] }).payload, workers: 32 },
    { schemaVersion: 2, protocol: validationSelectionProtocol, files: [relative] },
    { schemaVersion: 1, protocol: 'unknown', files: [relative] },
    { schemaVersion: 1, protocol: validationSelectionProtocol, files: [relative, relative] },
    { schemaVersion: 1, protocol: validationSelectionProtocol, files: ['test/../outside.test.mjs'] },
    { schemaVersion: 1, protocol: validationSelectionProtocol, files: ['src/outside.test.mjs'] },
    { schemaVersion: 1, protocol: validationSelectionProtocol, files: [relative], name: '[' },
  ];
  const inputs = malformed.map(value => Buffer.from(JSON.stringify(value)));
  inputs.push(Buffer.from('{'), Buffer.from([255]), Buffer.from(
    `{"schemaVersion":1,"protocol":${JSON.stringify(validationSelectionProtocol)},"files":[${JSON.stringify(relative)}],"files":[${JSON.stringify(relative)}]}`));
  await fs.unlink(marker);
  for (const bytes of inputs) {
    const ref = `.test-data/test-selections/${digest(bytes)}.json`;
    const absolute = path.join(repositoryRoot, ref);
    try {
      await fs.writeFile(absolute, bytes, { flag: 'wx' });
      t.after(() => fs.unlink(absolute));
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      assert.deepEqual(await fs.readFile(absolute), bytes);
    }
    const denied = await invoke(['targeted', '--selection-file', ref]).done;
    assert.notEqual(denied.code, 0, 'Malformed, unknown or escaping input cannot reach a callback');
    await assert.rejects(fs.stat(marker), { code: 'ENOENT' });
  }
  const tampered = `.test-data/test-selections/${digest(`mismatched-${relative}`)}.json`;
  await fs.writeFile(path.join(repositoryRoot, tampered),
    JSON.stringify(validationSelectionDescriptor({ files: [relative] }).payload), { flag: 'wx' });
  t.after(() => fs.unlink(path.join(repositoryRoot, tampered)));
  assert.notEqual((await invoke(['targeted', '--selection-file', tampered]).done).code, 0);
  await assert.rejects(fs.stat(marker), { code: 'ENOENT' });
  for (const args of [
    ['unit', '--selection-file', reference.path],
    ['targeted', '--selection-file', reference.path, relative],
    ['targeted', '--selection-file', reference.path, '--name', 'inline override'],
    ['targeted', '--selection-file', '../outside.json'],
    ['targeted', '--selection-file', path.join(evidence, 'outside.json')],
  ]) assert.throws(() => parseOptions(args, {}));
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

test('T-PRD018 coded failures preserve safe command output and do not interrupt sibling roots', async t => {
  const directory = await scratch(t);
  const evidence = await fs.mkdtemp(path.join(repositoryRoot, '.test-data', 'runner-coded-failure-'));
  t.after(() => fs.rm(evidence, { recursive: true, force: true }));
  const fail = path.join(directory, 'coded-failure.test.mjs');
  const pass = path.join(directory, 'sibling.test.mjs');
  const marker = path.join(directory, 'sibling-finished');
  await fs.writeFile(fail, "import test from 'node:test';test('owned coded failure',()=>{" +
    "throw Object.assign(new Error('Owned lock contention'),{code:'LOCK_BUSY',details:{lock:'owned-lock'}});});\n");
  await fs.writeFile(pass, "import test from 'node:test';import {writeFile} from 'node:fs/promises';" +
    `test('passing independent root',()=>writeFile(${JSON.stringify(marker)},'finished'));\n`);
  const reportPath = path.join(evidence, 'runner.json');
  const environment = { ...process.env, NO_COLOR: '1', SDLC_TEST_REPORT_FILE: reportPath };
  delete environment.FORCE_COLOR;
  const result = await executeValidationCommand({
    name: 'coded-failure', command: process.execPath,
    args: ['scripts/test-runner.mjs', 'targeted', '--workers', '1', fail, pass],
    cwd: repositoryRoot, outputDir: evidence, signal: t.signal,
    environment,
  });
  assert.equal(result.complete, true, result.diagnostic);
  assert.equal(result.exitCode, 1, 'The genuine failed assertion remains non-passing');
  assert.deepEqual(result.causes, []);
  assert.match(result.stdout, /Owned lock contention/u);
  assert.equal(await fs.readFile(marker, 'utf8'), 'finished');
  const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  assert.equal(report.complete, true);
  assert.deepEqual([report.summary.counts.failed, report.summary.counts.passed,
    report.summary.counts.cancelled], [1, 1, 0]);
  assert.equal(report.executions.find(row => row.name === 'owned coded failure').diagnostic.message,
    'Owned lock contention');
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

async function assertJournalCheckpoint(reportPath, report) {
  const journal = await fs.readFile(`${reportPath}.journal.ndjson`);
  const reference = report.checkpoint.originalJournalPrefix;
  assert.equal(report.checkpoint.journalDurable, true);
  assert.ok(journal.length >= reference.bytes);
  const prefix = journal.subarray(0, reference.bytes);
  assert.equal(digest(prefix), reference.sha256);
  const rows = prefix.length ? prefix.toString('utf8').trim().split('\n').map(JSON.parse) : [];
  assert.equal(rows.at(-1)?.sequence ?? 0, report.checkpoint.journalSequence);
  assert.ok(rows.every((row, index) => row.sequence === index + 1));
  return rows;
}

async function assertDurableRunningCheckpoint(t, { hiddenLease = false } = {}) {
    let root = repositoryRoot;
    if (hiddenLease) {
      root = await fs.mkdtemp(path.join(repositoryRoot, '.test-data', 'checkpoint-observer-copy-'));
      t.after(() => fs.rm(root, { recursive: true, force: true }));
      await Promise.all(['src', 'scripts', 'packaging'].map(directory =>
        fs.cp(path.join(repositoryRoot, directory), path.join(root, directory), { recursive: true })));
      await fs.copyFile(path.join(repositoryRoot, 'package.json'), path.join(root, 'package.json'));
      await fs.mkdir(path.join(root, 'test'));
      await fs.mkdir(path.join(root, '.test-data'));
    }
    const directory = await scratch(t, root);
    const evidence = await fs.mkdtemp(path.join(repositoryRoot, '.test-data', 'runner-checkpoint-'));
    let preserveFailure = false;
    t.after(() => preserveFailure ? undefined : fs.rm(evidence, { recursive: true, force: true }));
    const marker = path.join(directory, 'entered.json');
    const release = path.join(directory, 'release');
    const file = path.join(directory, 'silent.test.mjs');
    await fs.writeFile(file, `import test from 'node:test';import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';import {setTimeout as delay} from 'node:timers/promises';
test('completed root before blocker',()=>assert.equal(2+2,4));
test('silent blocked root',async()=>{
  await fs.writeFile(${JSON.stringify(`${marker}.pending`)},JSON.stringify({pid:process.pid,producerPid:process.ppid}),{flag:'wx'});
  await fs.rename(${JSON.stringify(`${marker}.pending`)},${JSON.stringify(marker)});
  const deadline=Date.now()+20000;
  while(!(await fs.stat(${JSON.stringify(release)}).catch(error=>{
    if(error.code!=='ENOENT')throw error;return null;
  }))){
    assert.ok(Date.now()<deadline,'Owned checkpoint fixture release timed out');await delay(20);
  }
});
test('queued root must remain unstarted',()=>assert.fail('queued root executed'));
`);
    const reportPath = path.join(hiddenLease ? path.join(root, '.test-data') : evidence, 'partial.json');
    const gate = path.join(directory, 'lease-visible');
    const observationPath = path.join(directory, 'lease-observations.ndjson');
    if (hiddenLease) {
      const plan = await createPlan(parseOptions(['targeted', '--workers', '1', file], {}), root);
      const group = plan.groups.find(group => group.name.includes('silent blocked root'));
      assert.ok(group);
      await fs.rename(path.join(root, 'scripts', 'test-budget.mjs'),
        path.join(root, 'scripts', 'test-budget-observer-original.mjs'));
      await fs.writeFile(path.join(root, 'scripts', 'test-budget.mjs'), `
export * from './test-budget-observer-original.mjs';
import {readTestGroupProcesses as actualProcesses,readTestBudget as actualBudget}
  from './test-budget-observer-original.mjs';
import {existsSync} from 'node:fs';import {appendFile} from 'node:fs/promises';
export async function readTestGroupProcesses(groupId){
  const hidden=groupId===${JSON.stringify(group.id)}&&!existsSync(${JSON.stringify(gate)});
  const processes=await actualProcesses(groupId);
  if(groupId===${JSON.stringify(group.id)})await appendFile(${JSON.stringify(observationPath)},
    JSON.stringify({hidden,groupId,processes,returned:hidden?[]:processes,budget:await actualBudget()})+'\\n');
  return hidden?[]:processes;
}
`);
    }
    const pending = invoke(['targeted', '--workers', '1', file], { SDLC_TEST_REPORT_FILE: reportPath }, root);
    let owned;
    try {
      await waitFor(async () => {
        try { owned = JSON.parse(await fs.readFile(marker, 'utf8')); return true; }
        catch (error) { if (error.code !== 'ENOENT') throw error; return false; }
      }, 'silent fixture process identity');
      if (hiddenLease) {
        await waitFor(async () => {
          let observations;
          try { observations = (await fs.readFile(observationPath, 'utf8')).split('\n').slice(0, -1).map(JSON.parse); }
          catch (error) { if (error.code !== 'ENOENT') throw error; return false; }
          const events = (await fs.readFile(`${reportPath}.journal.ndjson`, 'utf8'))
            .split('\n').slice(0, -1).map(JSON.parse);
          return observations.some(row => row.hidden && row.returned.length === 0) &&
            events.some(row => row.kind === 'start' && row.name === 'silent blocked root') &&
            events.some(row => row.kind === 'group-end' && row.status === 'Passed');
        }, 'dequeued root whose first lease observation was withheld');
        await fs.writeFile(gate, '', { flag: 'wx' });
      }
      let report;
      await waitFor(async () => {
        const bytes = await fs.readFile(reportPath);
        if (!bytes.length) return false;
        report = JSON.parse(bytes);
        return report.groupExecution.groups.some(group =>
          report.checkpoint.activeGroupIds.includes(group.id) && group.processIds.includes(owned.pid));
      }, 'periodic durable checkpoint while the next root is silently blocked');
      assert.equal(report.process.pid, owned.producerPid);
      assert.ok(processRunning(owned.pid) && processRunning(owned.producerPid));
      assert.equal(report.complete, false);
      assert.equal(report.finishedAt, null);
      assert.equal(report.exitCode, null);
      assert.equal(report.summary, null);
      assert.deepEqual(report.executions.map(row => [row.name, row.status]),
        [['completed root before blocker', 'Passed']]);
      assert.equal(report.checkpoint.pendingGroups, 1);
      const active = report.groupExecution.groups.find(group => group.startedAt && !group.finishedAt);
      assert.deepEqual(active.processIds, [owned.pid]);
      assert.equal(active.finishedAt, null);
      const events = await assertJournalCheckpoint(reportPath, report);
      assert.ok(events.some(row => row.kind === 'start' && row.name === 'silent blocked root'));
      assert.ok(events.some(row => row.kind === 'group-start' && row.groupId === active.id));
      assert.deepEqual(events.filter(row => row.kind === 'completion').map(row => [row.name, row.status]),
        [['completed root before blocker', 'Passed']]);
      assert.ok(events.find(row => row.kind === 'group-start' && row.groupId === active.id).sequence >
        events.find(row => row.kind === 'completion').sequence);
      if (hiddenLease) {
        const observations = (await fs.readFile(observationPath, 'utf8')).trim().split('\n').map(JSON.parse);
        assert.equal(observations[0].hidden, true);
        assert.deepEqual(observations[0].returned, []);
        assert.ok(observations.length <= 3, 'Startup queries and one periodic refresh must remain bounded');
        assert.equal(observations.filter(row => !row.hidden).length, 1,
          'Concurrent progress requests must coalesce into one real refresh');
        const visible = observations.find(row => !row.hidden);
        assert.ok(visible, 'A periodic refresh must query the real broker again after the first miss');
        assert.deepEqual(visible.returned, visible.processes);
        assert.deepEqual(active.processes, visible.processes);
        assert.deepEqual(visible.processes.map(process => process.pid), [owned.pid]);
        for (const { budget } of observations) {
          for (const [peak, limit] of [['peakActiveWorkers', 'capacity'],
            ['peakResidentWorkers', 'residentLimit'], ['peakPotentialResidentWorkers', 'residentLimit'],
            ['peakProducers', 'producerLimit'], ['peakControls', 'controlLimit']]) {
            assert.ok(budget[peak] <= budget[limit], `${peak} must remain within the actual broker allocation`);
          }
        }
      }
      process.kill(owned.producerPid, 'SIGKILL');
      await waitFor(() => !processRunning(owned.producerPid), 'owned producer termination');
      const preserved = await fs.readFile(reportPath);
      await fs.writeFile(release, '');
      const result = await pending.done;
      assert.notEqual(result.code, 0);
      assert.deepEqual(await fs.readFile(reportPath), preserved);
      await assertJournalCheckpoint(reportPath, JSON.parse(preserved));
      assert.deepEqual(JSON.parse(preserved).executions.map(row => [row.name, row.status]),
        [['completed root before blocker', 'Passed']]);
    } catch (error) {
      preserveFailure = true;
      const [snapshot, journal] = await Promise.all([
        fs.readFile(reportPath), fs.readFile(`${reportPath}.journal.ndjson`),
      ]);
      await fs.writeFile(path.join(evidence, 'failure-progress-original.json'), snapshot, { flag: 'wx' });
      await fs.writeFile(path.join(evidence, 'failure-journal-original.ndjson'), journal, { flag: 'wx' });
      if (hiddenLease) {
        await fs.writeFile(path.join(evidence, 'failure-lease-observations.ndjson'),
          await fs.readFile(observationPath), { flag: 'wx' });
      }
      const progress = snapshot.length ? JSON.parse(snapshot) : null;
      t.diagnostic(JSON.stringify({
        evidence: path.relative(repositoryRoot, evidence).split(path.sep).join('/'), owned,
        checkpoint: progress?.checkpoint,
        groups: progress?.groupExecution.groups.map(group => ({
          id: group.id, name: group.name, startedAt: group.startedAt,
          finishedAt: group.finishedAt, processIds: group.processIds,
        })),
        journal: { sha256: digest(journal), bytes: journal.length,
          events: journal.toString('utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
            .filter(row => ['group-start', 'group-end', 'start', 'completion'].includes(row.kind))
            .map(({ kind, name, groupId, status, processIds }) => ({ kind, name, groupId, status, processIds })) },
      }));
      throw error;
    } finally {
      await fs.writeFile(release, '');
      if (owned && processRunning(owned.producerPid)) process.kill(owned.producerPid, 'SIGTERM');
      if (owned && processRunning(owned.pid)) process.kill(owned.pid, 'SIGKILL');
      await pending.done;
      await waitFor(() => !owned || !processRunning(owned.pid), 'owned silent worker cleanup');
    }
}

test('T-PRD018 silent active roots retain durable partial JSON and original journal after abrupt producer termination',
  { timeout: 30000 }, t => assertDurableRunningCheckpoint(t));

test('T-PRD018 periodic checkpoints refresh a hidden real worker lease before retaining progress',
  { timeout: 30000 }, t => assertDurableRunningCheckpoint(t, { hiddenLease: true }));

test('T-PRD018 checkpoint capacity rejection preserves a bounded incomplete report and the original journal',
  { timeout: 30000 }, async t => {
    const directory = await scratch(t);
    const evidence = await fs.mkdtemp(path.join(repositoryRoot, '.test-data', 'runner-checkpoint-bound-'));
    t.after(() => fs.rm(evidence, { recursive: true, force: true }));
    const file = path.join(directory, 'bounded.test.mjs');
    await fs.writeFile(file, "import test from 'node:test';test('large safe diagnostic fixture',t=>{" +
      "for(let index=0;index<12;index++)t.diagnostic('safe original diagnostic '+index+' '+'x'.repeat(350000));});");
    const reportPath = path.join(evidence, 'bounded.json');
    const result = await invoke(['targeted', '--workers', '1', file], {
      SDLC_TEST_REPORT_FILE: reportPath,
    }).done;
    assert.equal(result.code, 2, result.stderr.slice(0, 2000));
    const bytes = await fs.readFile(reportPath);
    assert.ok(bytes.length > 0 && bytes.length <= 4 * 1024 * 1024);
    const report = JSON.parse(bytes);
    assert.equal(report.kind, 'invalid-partial-report');
    assert.equal(report.complete, false);
    assert.equal(report.evidenceError.code, 'CAPACITY');
    assert.ok(report.evidenceError.original.bytes > 4 * 1024 * 1024);
    assert.deepEqual(report.executions, []);
    const journal = await fs.readFile(`${reportPath}.journal.ndjson`);
    const events = journal.toString('utf8').trim().split('\n').map(JSON.parse);
    assert.equal(events.filter(row => row.kind === 'diagnostic' &&
      row.message.startsWith('safe original diagnostic ')).length, 12);
    assert.ok(events.some(row => row.kind === 'completion' &&
      row.name === 'large safe diagnostic fixture' && row.status === 'Passed'));
    assert.equal(events.at(-1).kind, 'checkpoint-rejected');
    assert.equal(events.at(-1).code, 'CAPACITY');
    await assertJournalCheckpoint(reportPath, report);
  });

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
      const partial = JSON.parse(await fs.readFile(reportPath, 'utf8'));
      assert.equal(partial.complete, false);
      assert.equal(partial.finishedAt, null);
      assert.equal(partial.exitCode, null);
      await assertJournalCheckpoint(reportPath, partial);
      await new Promise((resolve, reject) =>
        child.send({ signal }, error => error ? reject(error) : resolve()));
      const actual = await done;
      assert.equal(actual, exitCode, actual === exitCode ? undefined :
        runnerFailureDiagnostic({ stdout, stderr, expectedExitCode: exitCode, actualExitCode: actual }));
      assert.match(stdout, /\bcancelled [1-9]\d*\b/u);
      assert.equal(summary(stdout, 'end').interruptedBy, signal);
      assert.ok(pids.every(pid => !processRunning(pid)), 'Runner returned with surviving file workers');
      const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
      assert.equal(report.complete, false);
      assert.equal(report.exitCode, exitCode);
      assert.ok(report.summary.counts.cancelled > 0);
      assert.ok(report.executions.some(item => item.status === 'Cancelled'));
      assert.equal(report.checkpoint.phase, 'finished');
      await assertJournalCheckpoint(reportPath, report);
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
