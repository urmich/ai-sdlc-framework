export const validationDeclarations = {
  "schemaVersion": 1,
  "surfaces": [{"coverage": "direct", "paths": ["src/coverage.mjs", "src/coverage-cli.mjs", "src/evidence.mjs"]}]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { prepareCoverage, renderCoverageSection, inspectCoverage, readCoverageSection, normalizeExecutionReport,
  evaluateReadiness, validationInventoryDigest, createEvidenceBundle,
  readEvidenceBundle } from 'ai-sdlc-framework/evidence';
import { candidateSnapshot, candidateContentDigest } from '../src/validation.mjs';
import { identity } from '../src/git.mjs';
import { compileCoverage } from '../src/coverage.mjs';
import { normalizeTestDefinition, testSpecificationDigest } from '../src/artifacts.mjs';
import { digest } from '../src/core.mjs';

const execute = promisify(execFile);
const sourceRoot = path.resolve('.');
const sourceEntry = path.join(sourceRoot, 'bin', 'sdlc.mjs');
const requirementPath = 'docs/orders/requirements.md';
const planPath = 'docs/orders/test-plan.md';
const requirements = `# Consumer requirements

### FR-801: Preserve the balance

**Definition of Done**

- AC-801.1: Reject an overdraft without changing the starting balance.
- AC-801.2: Subtract the exact accepted debit.
`;
const plan = `# Consumer Test Plan

| ID | Requirements | Environment | Level | Checkpoint | Mode | Owner | Location | Expected outcome | Implementation | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-BALANCE | FR-801; AC-801.1; AC-801.2 | local | unit | pre-review | automated | agent | local | Invalid debit preserves the balance; valid debit returns the exact remainder | python -m unittest test_balance.BalanceTests | NotRun |
`;
function references(body) {
  return {
    repositoryId: 'consumer',
    requirements: [{ artifactId: 'orders', path: requirementPath }],
    testPlans: [{ artifactId: 'orders', path: planPath }],
    ...(body === undefined ? {} : { body }),
  };
}
async function files(directory, prefix = '') {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await files(path.join(directory, entry.name), relative));
    else result.push(relative);
  }
  return result.sort();
}
async function consumer(t, { crlf = false, bom = false, canonical = false } = {}) {
  await fs.mkdir(path.resolve('.test-data'), { recursive: true });
  const root = await fs.mkdtemp(path.resolve('.test-data', 'coverage-consumer-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve('.test-data'));
    await fs.rm(root, { recursive: true });
    await assert.rejects(fs.stat(root), { code: 'ENOENT' });
  });
  const repo = path.join(root, 'independent consumer with spaces');
  const home = path.join(root, 'candidate copilot home');
  const documentPaths = canonical ? {
    requirements: 'docs/sdlc/orders/requirements.md', plan: 'docs/sdlc/orders/test-plan.md',
  } : { requirements: requirementPath, plan: planPath };
  await fs.mkdir(path.dirname(path.join(repo, documentPaths.requirements)), { recursive: true });
  await fs.mkdir(path.join(repo, '.github', 'workflows'), { recursive: true });
  const newline = value => (bom ? '\uFEFF' : '') + (crlf ? value.replaceAll('\n', '\r\n') : value);
  await fs.writeFile(path.join(repo, documentPaths.requirements), newline(requirements));
  await fs.writeFile(path.join(repo, documentPaths.plan), newline(plan));
  await fs.writeFile(path.join(repo, '.github', 'workflows', 'existing.yml'),
    'name: Consumer-owned CI\non: push\n');
  await fs.writeFile(path.join(repo, 'test_balance.py'), `import unittest

def debit(balance, amount):
    if amount < 0 or amount > balance:
        raise ValueError("invalid debit")
    return balance - amount

class BalanceTests(unittest.TestCase):
    def test_balance(self):
        balance = 100
        with self.assertRaises(ValueError):
            debit(balance, 101)
        self.assertEqual(balance, 100)
        self.assertEqual(debit(balance, 25), 75)
`);
  const env = {
    ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    GIT_TERMINAL_PROMPT: '0',
    HOME: path.join(root, 'isolated user'), USERPROFILE: path.join(root, 'isolated user'),
    COPILOT_HOME: home, XDG_CACHE_HOME: path.join(root, 'cache'),
    TMPDIR: path.join(root, 'tmp'), TMP: path.join(root, 'tmp'), TEMP: path.join(root, 'tmp'),
    PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1',
  };
  await fs.mkdir(env.HOME, { recursive: true });
  await fs.mkdir(env.TMP, { recursive: true });
  const runGit = async (...args) => (await execute('git', args, { cwd: repo, env,
    timeout: 10000 })).stdout;
  await runGit('init', '-q', '-b', 'feature/coverage');
  await runGit('config', 'core.autocrlf', crlf ? 'true' : 'false');
  await runGit('add', '.');
  await runGit('commit', '-qm', 'Create the owned consumer fixture');
  const revision = (await runGit('rev-parse', 'HEAD')).trim();
  const initialFiles = await files(repo);
  const initialCi = await fs.readFile(path.join(repo, '.github', 'workflows', 'existing.yml'), 'utf8');
  return { root, repo, home, env, runGit, revision, initialFiles, initialCi, documentPaths };
}
async function cli(fixture, entry, args, input, expectedExit = 0) {
  const job = execute(process.execPath, [entry, ...args, '--cwd', fixture.repo,
    '--home', fixture.home], {
    cwd: fixture.repo, env: fixture.env, maxBuffer: 1024 * 1024, timeout: 60000,
  });
  job.child.stdin.end(typeof input === 'string' ? input : JSON.stringify(input));
  let output;
  try { output = { ...await job, exitCode: 0 }; }
  catch (error) {
    if (!Number.isInteger(error.code)) throw error;
    output = { stdout: error.stdout, stderr: error.stderr, exitCode: error.code };
  }
  assert.equal(output.exitCode, expectedExit, `${output.stdout}\n${output.stderr}`);
  return JSON.parse(output.stdout);
}
async function preserved(fixture) {
  assert.deepEqual(await files(fixture.repo), fixture.initialFiles);
  assert.equal(await fs.readFile(path.join(fixture.repo, '.github', 'workflows', 'existing.yml'),
    'utf8'), fixture.initialCi);
}

test('T-PRD084 headless coverage commands use real source without a ledger, sidecar or consumer CI change', async t => {
  const fixture = await consumer(t);
  const prepared = await cli(fixture, sourceEntry, ['coverage', 'prepare'], references('Human purpose.'));
  assert.equal(prepared.complete, true);
  assert.equal(prepared.sourceMatches, true);
  assert.deepEqual(prepared.uncovered, []);
  assert.deepEqual(readCoverageSection(prepared.body), prepared.metadata);
  assert.equal(prepared.metadata.sourceRevision, fixture.revision);
  assert.ok(prepared.body.startsWith('Human purpose.'));
  const inspected = await cli(fixture, sourceEntry, ['coverage', 'inspect'],
    references(prepared.body));
  assert.equal(inspected.complete, true);
  const missing = await cli(fixture, sourceEntry, ['coverage', 'inspect'],
    references('Human purpose without coverage.'), 2);
  assert.equal(missing.complete, false);
  assert.ok(missing.diagnostics.length > 0);
  const malformed = await cli(fixture, sourceEntry, ['coverage', 'prepare'],
    '{"private-prose-not-for-diagnostics":', 4);
  assert.equal(malformed.error.code, 'JSON');
  assert.ok(!JSON.stringify(malformed).includes('private-prose'));
  await preserved(fixture);
  await assert.rejects(fs.stat(fixture.home), { code: 'ENOENT' });
});

test('T-PRD084 shipped instructions and installed public interfaces prepare independent non-Node coverage', async t => {
  const fixture = await consumer(t);
  const installed = await cli(fixture, sourceEntry, ['install', '--source-root', sourceRoot], {});
  assert.equal(installed.installed, true);
  const packageRoot = path.join(fixture.home, 'sdlc');
  const entry = path.join(packageRoot, 'bin', 'sdlc.mjs');
  const guide = await fs.readFile(path.join(packageRoot, 'templates', 'pr-coverage.md'), 'utf8');
  const schema = JSON.parse(await fs.readFile(path.join(packageRoot, 'templates',
    'pr-coverage.schema.json'), 'utf8'));
  assert.ok(guide.includes('coverage prepare'));
  assert.equal(schema.properties.schemaVersion.const, 1);
  const prepared = await cli(fixture, entry, ['coverage', 'prepare'], references());
  assert.equal(prepared.complete, true);
  const sdk = await execute(process.execPath, ['--input-type=module', '-e', `
    import {prepareCoverage,renderCoverageSection,inspectCoverage} from 'ai-sdlc-framework/evidence';
    const input=JSON.parse(process.argv[1]);
    const metadata=prepareCoverage(input);
    const report=inspectCoverage({...input,body:renderCoverageSection(metadata)});
    console.log(JSON.stringify({metadata,complete:report.complete}));
  `, JSON.stringify({
    repositoryId: 'consumer', sourceRevision: fixture.revision,
    requirements: [{ artifactId: 'orders', path: requirementPath, contents: requirements }],
    testPlans: [{ artifactId: 'orders', path: planPath, contents: plan }],
  })], { cwd: packageRoot, env: fixture.env, timeout: 30000 });
  const result = JSON.parse(sdk.stdout);
  assert.equal(result.complete, true);
  assert.deepEqual(result.metadata, prepared.metadata);
  assert.deepEqual(prepared.metadata.coverage.flatMap(item => item.tests),
    ['T-BALANCE', 'T-BALANCE']);
  await preserved(fixture);
});

test('T-PRD084 Git canonical source survives CRLF checkouts and exposes uncommitted definitions', async t => {
  for (const bom of [false, true]) {
    const fixture = await consumer(t, { crlf: true, bom });
    const prepared = await cli(fixture, sourceEntry, ['coverage', 'prepare'], references());
    assert.equal(prepared.complete, true, JSON.stringify({ bom, diagnostics: prepared.diagnostics }));
    assert.equal(prepared.sourceMatches, true);
    assert.equal(prepared.metadata.requirements[0].sha256,
      digest(await fixture.runGit('show', `HEAD:${requirementPath}`)));
    const source = await fs.readFile(path.join(fixture.repo, requirementPath), 'utf8');
    await fs.writeFile(path.join(fixture.repo, requirementPath), source.replace(
      '- AC-801.2:', '- AC-801.3: Require another observable result.\r\n- AC-801.2:'));
    const changed = await cli(fixture, sourceEntry, ['coverage', 'prepare'], references());
    assert.equal(changed.complete, false);
    assert.equal(changed.sourceMatches, false);
    assert.deepEqual(changed.uncovered, ['AC-801.3']);
    assert.ok(changed.diagnostics.some(item => item.code === 'UNCOMMITTED_SPECIFICATION'));
    await fs.writeFile(path.join(fixture.repo, requirementPath), source);
    const newPlanPath = 'docs/orders/new-test-plan.md';
    await fs.writeFile(path.join(fixture.repo, newPlanPath), plan);
    const input = references();
    input.testPlans[0].path = newPlanPath;
    const untracked = await cli(fixture, sourceEntry, ['coverage', 'prepare'], input);
    assert.equal(untracked.complete, false);
    assert.equal(untracked.sourceMatches, false);
    assert.deepEqual(untracked.diagnostics.at(-1).paths, [newPlanPath]);
    await fs.rm(path.join(fixture.repo, newPlanPath));
    await preserved(fixture);
  }
});

test('T-PRD083 fenced examples cannot define requirements or satisfy real coverage obligations', () => {
  for (const [opening, closing, indentation = ''] of [
    ['~~~markdown', '~~~'], ['````markdown', '````'], ['~~~~markdown', '~~~~~'],
    ['```markdown', '```', '    '], ['~~~markdown', '~~~', '    '],
    ['````markdown', '````', '    '], ['', '', '    '], ['', '', '\t'],
    ['~~~markdown', '~~~', '\t'],
  ]) {
    const example = contents => {
      const body = opening ? `${opening}\n\`\`\`\n${contents}\n\`\`\`\n${closing}` : contents;
      return `\n${body.split('\n').map(line => indentation + line).join('\n')}\n`;
    };
    const sources = {
      repositoryId: 'consumer',
      requirements: [{ path: requirementPath, contents: requirements + (indentation ? '' : example(
        '### FR-802: Example only\n**Definition of Done**\n- AC-802.1: Not a real requirement.')) }],
      testPlans: [{ path: planPath,
        contents: plan.replace('FR-801; AC-801.1; AC-801.2', 'FR-801; AC-801.1') +
          example(plan.replace('T-BALANCE', 'T-EXAMPLE')
            .replace('FR-801; AC-801.1; AC-801.2', 'FR-801; AC-801.2')) }],
    };
    const compiled = compileCoverage(sources);
    assert.deepEqual(compiled.definitions.map(item => item.id), ['FR-801']);
    assert.deepEqual(compiled.tests.map(item => item.id), ['T-BALANCE']);
    const input = { ...sources, sourceRevision: 'a'.repeat(40) };
    const inspected = inspectCoverage({ ...input,
      body: renderCoverageSection(prepareCoverage(input)) });
    assert.equal(inspected.complete, false);
    assert.deepEqual(inspected.uncovered, ['AC-801.2']);
  }
  for (const indentation of ['    ', '\t']) {
    const input = {
      repositoryId: 'consumer', sourceRevision: 'a'.repeat(40),
      requirements: [{ path: requirementPath, contents: requirements.replace(
        '- AC-801.2:', `- Additional required conditions:\n${indentation}- AC-801.2:`) }],
      testPlans: [{ path: planPath,
        contents: plan.replace('FR-801; AC-801.1; AC-801.2', 'FR-801; AC-801.1') }],
    };
    const inspected = inspectCoverage({ ...input,
      body: renderCoverageSection(prepareCoverage(input)) });
    assert.equal(inspected.complete, false);
    assert.deepEqual(inspected.uncovered, ['AC-801.2']);
  }
});

test('T-PRD084 offline coverage prepare and inspect never execute configured Git filters', async t => {
  const fixture = await consumer(t);
  const marker = path.join(fixture.root, 'filter-executed');
  const probe = path.join(fixture.root, 'smudge-probe.mjs');
  await fs.writeFile(probe,
    "import {appendFileSync} from 'node:fs';\n" +
    "appendFileSync(process.argv[2],'executed\\n');\nprocess.stdin.pipe(process.stdout);\n");
  const quoted = value => `"${value.replaceAll('\\', '/')}"`;
  await fixture.runGit('config', 'filter.coverage-probe.smudge',
    [process.execPath, probe, marker].map(quoted).join(' '));
  await fs.writeFile(path.join(fixture.repo, '.gitattributes'),
    'docs/orders/*.md filter=coverage-probe\n');
  await fixture.runGit('add', '.gitattributes');
  await fixture.runGit('commit', '-qm', 'Configure an owned offline filter probe');
  fixture.initialFiles = await files(fixture.repo);
  const prepared = await cli(fixture, sourceEntry, ['coverage', 'prepare'], references());
  assert.equal(prepared.complete, true);
  const inspected = await cli(fixture, sourceEntry, ['coverage', 'inspect'],
    references(prepared.section));
  assert.equal(inspected.complete, true);
  await assert.rejects(fs.stat(marker), { code: 'ENOENT' });
  await preserved(fixture);
});

test('T-PRD084 SDK preparation preserves inputs and provides no action authority', () => {
  const input = {
    repositoryId: 'consumer', sourceRevision: 'a'.repeat(40),
    requirements: [{ path: requirementPath, contents: requirements }],
    testPlans: [{ path: planPath, contents: plan }],
  };
  const before = structuredClone(input);
  const metadata = prepareCoverage(input);
  assert.deepEqual(input, before);
  assert.ok(!Object.hasOwn(metadata, 'status'));
  assert.ok(!Object.hasOwn(metadata, 'approved'));
  assert.ok(!Object.hasOwn(metadata, 'verified'));
  assert.deepEqual(metadata.coverage.map(item => item.condition), ['AC-801.1', 'AC-801.2']);
});

function pythonExecutionReport(value, capture) {
  const { context, startedAt, observedAt, exitCode, planned, specification } = capture;
  return {
    schemaVersion: 1, kind: 'test-execution', context, startedAt,
    finishedAt: observedAt, observedAt, sequence: 1, complete: true,
    exitCode,
    sourceSummary: { tests: value.tests, failures: value.failures,
      errors: value.errors, skips: value.skips },
    results: [{
      testId: planned.id, assertionId: 'balance',
      selector: specification.cases[0].assertions[0].selector,
      status: value.ok ? 'Passed' : 'Failed', expectedMet: value.ok,
      expectedDigest: digest(planned.expected), checkpoint: planned.checkpoint,
      observedAt, sourceSequence: 1, durationMs: value.durationMs,
      exitCode,
      ...(value.diagnostics.length ? { detail: value.diagnostics.join('\n') } : {}),
    }],
  };
}
async function actualPythonProducer(t, { fail = false, guide = false } = {}) {
  const fixture = await consumer(t, { canonical: guide });
  if (guide) await cli(fixture, sourceEntry, ['install', '--source-root', sourceRoot], {});
  if (fail) {
    const file = path.join(fixture.repo, 'test_balance.py');
    const contents = await fs.readFile(file, 'utf8');
    await fs.writeFile(file, contents.replace('debit(balance, 25), 75', 'debit(balance, 25), 74'));
  }
  const source = {
    repositoryId: 'consumer',
    requirements: [{ artifactId: 'orders', path: fixture.documentPaths.requirements, contents: requirements }],
    testPlans: [{ artifactId: 'orders', path: fixture.documentPaths.plan, contents: plan }],
  };
  const parsed = compileCoverage(source);
  const planned = parsed.tests[0];
  const specification = {
    schemaVersion: 1, profile: 'independent-consumer',
    cases: [{
      id: planned.id, conditions: planned.conditions, expectedDigest: digest(planned.expected),
      executionId: 'python', mode: planned.mode, owner: planned.owner,
      location: planned.location, checkpoint: planned.checkpoint,
      assertions: [{ id: 'balance', selector: {
        language: 'python', module: 'test_balance', class: 'BalanceTests', method: 'test_balance',
      } }],
    }],
  };
  const producerScript = `
import contextlib, io, json, platform, sys, time, unittest
captured = io.StringIO()
started = time.perf_counter()
with contextlib.redirect_stdout(captured), contextlib.redirect_stderr(captured):
    suite = unittest.defaultTestLoader.loadTestsFromName("test_balance.BalanceTests")
    result = unittest.TextTestRunner(stream=captured).run(suite)
diagnostics = [trace.splitlines()[-1] for case, trace in result.failures + result.errors]
print(json.dumps({"suite": "balance", "ok": result.wasSuccessful(),
    "tests": result.testsRun, "failures": len(result.failures), "errors": len(result.errors),
    "skips": len(result.skipped), "diagnostics": diagnostics,
    "durationMs": (time.perf_counter() - started) * 1000,
    "interpreter": sys.version.split()[0], "executable": sys.executable,
    "platform": sys.platform, "architecture": platform.machine()}))
sys.exit(0 if result.wasSuccessful() else 1)
`;
  const startedAt = new Date().toISOString();
  let execution;
  try {
    execution = { ...await execute(process.env.SDLC_PYTHON ?? 'python', ['-c', producerScript], {
      cwd: fixture.repo, env: fixture.env, timeout: 30000,
    }), exitCode: 0 };
  } catch (error) {
    if (!Number.isInteger(error.code)) throw error;
    execution = { stdout: error.stdout, stderr: error.stderr, exitCode: error.code };
  }
  const observedAt = new Date().toISOString();
  const output = JSON.parse(execution.stdout);
  const manifest = { artifacts: [
    { kind: 'git', role: 'requirements', repositoryId: 'consumer', path: fixture.documentPaths.requirements },
    { kind: 'git', role: 'test-plan', repositoryId: 'consumer', path: fixture.documentPaths.plan },
  ] };
  const snapshotSources = async () => candidateSnapshot({
    members: [await identity(fixture.repo, 'consumer')],
  }, manifest);
  const sources = await snapshotSources();
  const configuration = { command: 'python -c unittest-driver', producerScript };
  const context = {
    candidateDigest: candidateContentDigest(sources),
    testSpecDigest: digest({
      tests: testSpecificationDigest(parsed.tests.map(normalizeTestDefinition)),
      plan: testSpecificationDigest(plan),
    }),
    configDigest: digest(configuration),
    inventoryDigest: validationInventoryDigest(specification), sources,
    profile: specification.profile, environment: 'local', mode: planned.mode,
    owner: planned.owner, location: planned.location,
    native: { kind: 'fixture', platform: output.platform, architecture: output.architecture,
      image: `${os.platform()}:${os.release()}`,
      toolchain: { python: output.interpreter, executable: output.executable } },
    producer: { provider: 'local', connection: 'independent-python-host',
      scopeRef: 'owned-consumer', definitionRef: 'unittest-driver',
      executionRef: `python-${randomUUID()}`, attemptKind: 'not-applicable' },
    attemptCapability: 'none', jobRef: 'actual-consumer-process', artifacts: [],
  };
  const original = Buffer.from(execution.stdout);
  const facts = {
    verifierId: 'actual-python-host-v1', reportDigest: digest(original), context,
    sourceTime: observedAt, sourceSequence: 1,
  };
  const capture = { context, startedAt, observedAt, exitCode: execution.exitCode,
    planned, specification };
  const adapter = {
    id: 'python-unittest-summary-v1',
    normalize: value => pythonExecutionReport(value, capture),
    verify: supplied => supplied.reportDigest === facts.reportDigest ? facts : null,
  };
  const report = normalizeExecutionReport(original, context, adapter);
  const selection = {
    profile: specification.profile, executions: [{ id: 'python', context }],
    now: new Date().toISOString(),
    policy: { maxAgeMs: 60000, revisionPolicy: 'exact', verifierIds: ['actual-python-host-v1'] },
    barriers: [],
  };
  return { fixture, output, execution, specification, context, selection, report, adapter,
    capture, configuration, snapshotSources };
}

test('T-PRD075 an independent real non-Node producer uses the same evidence contract for success and failure', async t => {
  const passing = await actualPythonProducer(t);
  assert.equal(passing.execution.exitCode, 0);
  assert.equal(passing.output.tests, 1);
  assert.equal(evaluateReadiness(passing.specification,
    [passing.report], passing.selection).status, 'Passed');
  const failing = await actualPythonProducer(t, { fail: true });
  assert.equal(failing.execution.exitCode, 1);
  const result = evaluateReadiness(failing.specification, [failing.report], failing.selection);
  assert.equal(result.status, 'Failed');
  assert.equal(result.cases[0].assertions[0].rawStatus, 'Failed');
  assert.ok(result.cases[0].assertions[0].detail.includes('AssertionError'));
  await preserved(passing.fixture);
  assert.ok(!(await files(failing.fixture.repo)).some(file => /coverage|validation\.json/iu.test(file)));
});

test('T-PRD075 real consumer history cannot satisfy missing, expired or changed source specification and configuration', async t => {
  const input = await actualPythonProducer(t);
  const original = JSON.stringify(input.report);
  const initial = evaluateReadiness(input.specification, [input.report], input.selection);
  assert.equal(initial.status, 'Passed');
  const bundle = JSON.parse(JSON.stringify(createEvidenceBundle(initial)));
  const bundleBytes = JSON.stringify(bundle);
  const notCurrent = (specification, selection, label) => {
    const result = evaluateReadiness(specification, [input.report], selection);
    assert.equal(result.status, 'NotRun', label);
    assert.equal(result.counts.passed, 0, label);
    const replay = readEvidenceBundle(bundle, { specification, context: selection },
      { 'python-unittest-summary-v1': input.adapter });
    assert.equal(replay.evaluation.status, 'NotRun', label);
    assert.equal(replay.historicalSummary.status, 'Passed', label);
  };
  const missing = evaluateReadiness(input.specification, [], input.selection);
  assert.equal(missing.status, 'NotRun');
  assert.equal(missing.counts.required, initial.counts.required);
  assert.equal(missing.counts.passed, 0);
  const expired = structuredClone(input.selection);
  expired.now = new Date(Date.parse(input.capture.observedAt) +
    expired.policy.maxAgeMs + 1).toISOString();
  notCurrent(input.specification, expired, 'expired real execution');
  const sourceFile = path.join(input.fixture.repo, 'test_balance.py');
  const sourceBytes = await fs.readFile(sourceFile);
  try {
    await fs.appendFile(sourceFile, '\n# Changed after the recorded execution.\n');
    const sources = await input.snapshotSources();
    assert.notEqual(sources[0].contentDigest, input.context.sources[0].contentDigest);
    const selected = structuredClone(input.selection);
    Object.assign(selected.executions[0].context, {
      sources, candidateDigest: candidateContentDigest(sources),
    });
    notCurrent(input.specification, selected, 'changed actual Python source');
  } finally {
    await fs.writeFile(sourceFile, sourceBytes);
  }
  const planFile = path.join(input.fixture.repo, input.fixture.documentPaths.plan);
  const planBytes = await fs.readFile(planFile);
  try {
    const changedPlan = planBytes.toString('utf8').replace('exact remainder',
      'exact remainder without rounding');
    await fs.writeFile(planFile, changedPlan);
    const parsed = compileCoverage({
      repositoryId: 'consumer',
      requirements: [{ path: input.fixture.documentPaths.requirements, contents: requirements }],
      testPlans: [{ path: input.fixture.documentPaths.plan, contents: changedPlan }],
    });
    const specification = structuredClone(input.specification);
    specification.cases[0].expectedDigest = digest(parsed.tests[0].expected);
    const sources = await input.snapshotSources();
    const selected = structuredClone(input.selection);
    Object.assign(selected.executions[0].context, {
      sources, candidateDigest: candidateContentDigest(sources),
      inventoryDigest: validationInventoryDigest(specification),
      testSpecDigest: digest({
        tests: testSpecificationDigest(parsed.tests.map(normalizeTestDefinition)),
        plan: testSpecificationDigest(changedPlan),
      }),
    });
    notCurrent(specification, selected, 'changed authoritative consumer specification');
  } finally {
    await fs.writeFile(planFile, planBytes);
  }
  const configured = structuredClone(input.selection);
  configured.executions[0].context.configDigest = digest({
    ...input.configuration, command: `${input.configuration.command} --failfast`,
  });
  notCurrent(input.specification, configured, 'changed independently selected runner configuration');
  assert.equal(JSON.stringify(input.report), original);
  assert.equal(JSON.stringify(bundle), bundleBytes);
  await preserved(input.fixture);
});

test('T-PRD072 installed offline core decodes real Python output while host network and process APIs are denied', async t => {
  const input = await actualPythonProducer(t, { guide: true });
  const entry = path.join(input.fixture.root, 'offline-consumer.mjs');
  const facade = pathToFileURL(path.join(input.fixture.home, 'sdlc', 'src', 'evidence.mjs')).href;
  await fs.writeFile(entry, `
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {createHash} from 'node:crypto';
const packet=JSON.parse(fs.readFileSync(0,'utf8'));
let attempts=0;
const deny=()=>{attempts++;throw new Error('OFFLINE_HOST_CALL_DENIED');};
for(const [module,names] of [
  [http,['request','get']],[https,['request','get']],
  [net,['connect','createConnection']],[tls,['connect']],
  [dns,['lookup','resolve','resolve4','resolve6']],
  [dns.promises,['lookup','resolve','resolve4','resolve6']],
  [childProcess,['exec','execFile','spawn','fork','execSync','execFileSync','spawnSync']],
])for(const name of names)module[name]=deny;
net.Socket.prototype.connect=deny;
globalThis.fetch=deny;
globalThis.WebSocket=class{constructor(){deny();}};
syncBuiltinESMExports();
assert.throws(()=>http.request('https://example.invalid'),/OFFLINE_HOST_CALL_DENIED/);
assert.throws(()=>childProcess.spawn('unreachable-fixture-command'),/OFFLINE_HOST_CALL_DENIED/);
attempts=0;
const {normalizeExecutionReport,evaluateReadiness,createEvidenceBundle,readEvidenceBundle}=await import(${JSON.stringify(facade)});
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):
  Array.isArray(value)?'['+value.map(canonical).join(',')+']':
  '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const digest=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:canonical(value)).digest('hex');
const decode=${pythonExecutionReport.toString()};
const original=Buffer.from(packet.stdout);
const facts={verifierId:'actual-python-host-v1',reportDigest:digest(original),
  context:packet.capture.context,sourceTime:packet.capture.observedAt,sourceSequence:1};
const adapter={id:'python-unittest-summary-v1',normalize:value=>decode(value,packet.capture),
  verify:request=>request.reportDigest===facts.reportDigest?facts:null};
const report=normalizeExecutionReport(original,packet.capture.context,adapter);
const evaluation=evaluateReadiness(packet.specification,[report],packet.selection);
assert.equal(evaluation.status,'Passed');
assert.equal(JSON.parse(packet.stdout).tests,1);
assert.equal(evaluation.counts.required,1);
const bundle=JSON.parse(JSON.stringify(createEvidenceBundle(evaluation)));
const replay=readEvidenceBundle(bundle,{specification:packet.specification,context:packet.selection},
  {'python-unittest-summary-v1':adapter});
assert.equal(replay.evaluation.status,'Passed');
assert.equal(evaluateReadiness(packet.specification,[],packet.selection).status,'NotRun');
assert.equal(attempts,0);
console.log(JSON.stringify({status:evaluation.status,replay:replay.evaluation.status,
  attemptedHostCalls:attempts,deniedControls:2,scope:'controlled-host-API-denial-not-OS-isolation'}));
`, { flag: 'wx' });
  const job = execute(process.execPath, [entry], {
    cwd: input.fixture.repo, env: input.fixture.env, timeout: 30000,
  });
  job.child.stdin.end(JSON.stringify({
    stdout: input.execution.stdout, capture: input.capture,
    specification: input.specification, selection: input.selection,
  }));
  const result = JSON.parse((await job).stdout);
  assert.equal(result.status, 'Passed');
  assert.equal(result.replay, 'Passed');
  assert.equal(result.attemptedHostCalls, 0);
  assert.equal(result.deniedControls, 2);
  assert.equal(result.scope, 'controlled-host-API-denial-not-OS-isolation');
  await preserved(input.fixture);
});

test('T-PRD077 installed consumer guidance runs its public coverage, producer, retention and replay examples with real inputs', async t => {
  const input = await actualPythonProducer(t, { guide: true });
  const packageRoot = path.join(input.fixture.home, 'sdlc');
  const guide = await fs.readFile(path.join(packageRoot, 'docs', 'usage', 'evidence.md'), 'utf8');
  const examples = [...guide.matchAll(/```js\r?\n([\s\S]*?)\r?\n```/gu)].map(match => match[1]);
  assert.equal(examples.length, 2);
  const modules = [];
  for (const [index, example] of examples.entries()) {
    const imports = /^import[\s\S]*?from 'ai-sdlc-framework\/evidence';\r?\n/u.exec(example);
    assert.ok(imports, 'The consumer example must import the shipped public SDK');
    const file = path.join(packageRoot, `guide-example-${index}-${randomUUID()}.mjs`);
    const variables = index === 0 ?
      'sourceRevision,requirementText,planText,currentPrBody' :
      'originalBytes,executionContext,decodeActualProducerOutput,independentlyVerifyProducer,specification,selection,independentlySelectedContext,trustedAdapter';
    const returned = index === 0 ? 'metadata,inspection,nextBody' : 'evaluation,readable,bundle,replay';
    await fs.writeFile(file, `${imports[0]}
export function run(input) {
  const {${variables}} = input;
  ${example.slice(imports[0].length)}
  return {${returned}};
}
`, { flag: 'wx' });
    modules.push(await import(pathToFileURL(file).href));
  }
  const coverage = modules[0].run({
    sourceRevision: input.fixture.revision,
    requirementText: await fs.readFile(path.join(input.fixture.repo, input.fixture.documentPaths.requirements), 'utf8'),
    planText: await fs.readFile(path.join(input.fixture.repo, input.fixture.documentPaths.plan), 'utf8'),
    currentPrBody: 'Keep the consumer-owned purpose.',
  });
  assert.equal(coverage.inspection.complete, true);
  assert.equal(coverage.metadata.sourceRevision, input.fixture.revision);
  assert.ok(coverage.nextBody.startsWith('Keep the consumer-owned purpose.'));
  const selection = { ...input.selection, now: new Date().toISOString() };
  const parameters = {
    originalBytes: Buffer.from(input.execution.stdout), executionContext: input.context,
    decodeActualProducerOutput: input.adapter.normalize, independentlyVerifyProducer: input.adapter.verify,
    specification: input.specification, selection, independentlySelectedContext: selection,
    trustedAdapter: { ...input.adapter, id: 'consumer-runner-v1' },
  };
  const result = modules[1].run(parameters);
  assert.equal(result.evaluation.status, 'Passed');
  assert.equal(result.replay.evaluation.status, 'Passed');
  assert.match(result.readable, /T-BALANCE/u);
  const retained = path.join(input.fixture.root, 'retained-evidence.json');
  await fs.writeFile(retained, JSON.stringify(result.bundle), { flag: 'wx' });
  assert.deepEqual(JSON.parse(await fs.readFile(retained, 'utf8')).manifestRef, result.bundle.manifestRef);
  assert.throws(() => modules[1].run({
    ...parameters, selection: { ...selection, profile: 'wrong-consumer-profile' },
  }), { code: 'EVIDENCE' });
  await preserved(input.fixture);
});

test('T-PRD082 real headless execution and clean replay require no fabricated phase receipts or stored verification flags', async t => {
  const input = await actualPythonProducer(t);
  const result = evaluateReadiness(input.specification, [input.report], input.selection);
  const bundle = createEvidenceBundle(result);
  const restored = readEvidenceBundle(JSON.parse(JSON.stringify(bundle)), {
    specification: input.specification, context: input.selection,
  }, { 'python-unittest-summary-v1': input.adapter });
  assert.equal(restored.evaluation.status, 'Passed');
  assert.ok(!Object.hasOwn(restored.evaluation, 'cycleId'));
  assert.ok(!Object.hasOwn(restored.evaluation, 'approved'));
  await assert.rejects(fs.stat(input.fixture.home), { code: 'ENOENT' });
  await preserved(input.fixture);
});
