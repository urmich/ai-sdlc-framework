export const validationDeclarations = {
  "schemaVersion": 1,
  "surfaces": [
    {"coverage": "direct", "paths": ["scripts/native-validation.mjs", "scripts/native-toolchain.mjs", "scripts/pr-capabilities.mjs", "scripts/pr-calculator.mjs", "scripts/pr-calculator-reporter.mjs", "scripts/native-components.mjs"]}
  ]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest } from '../src/core.mjs';
import { normalizeExecutionReport, evaluateReadiness, validationInventoryDigest,
  createEvidenceBundle, requireReadinessEvaluation, validateExecutionContext } from 'ai-sdlc-framework/evidence';
import { aggregateNativeReadiness, nativeArtifacts, nativeSpecification, nativeGoObservations,
  parseNativeOptions, validateNativeRequest, evaluateNativeExecution,
  finalizeNativeEvidence, nativeFailureAnnotations, assertGitFreeAncestors,
  nativeResourceFacts, prepareNativeHostFixtures,
  validateNativeSourceDefinitions, validateNativeGroupReport, nativeConfigurationDigest,
  deriveNativeComponentSpecification } from '../scripts/native-validation.mjs';
import { validateBootstrapRequest } from '../scripts/native-toolchain.mjs';
import { reconcileGoExecution, executeValidationCommand } from '../scripts/validation-tools.mjs';
import { repositoryRoot, createPlan, parseOptions, run as runTests } from '../scripts/test-runner.mjs';
import { discoverDeclarations, compileValidationSourceInventory } from '../scripts/validation-inventory.mjs';
import { runCalculator, calculatorFiles, calculatorSelection, calculatorArguments,
  calculatorCommandArguments, reconcileCalculator } from '../scripts/pr-calculator.mjs';
import { fetchPinnedFixture, provisionPrCryptoFixture } from '../scripts/pr-capabilities.mjs';

const targets = ['linux-x64', 'windows-x64', 'macos-arm64', 'macos-x64'];
const nativePlatforms = { 'linux-x64': 'linux', 'windows-x64': 'win32',
  'macos-arm64': 'darwin', 'macos-x64': 'darwin' };
const sourceRevision = 'a'.repeat(40);
const sources = [{ file: 'contract_test.go', contents:
  'const validationContractInventory = `{"schemaVersion":1,"tests":{"TestContract":["one","two"]}}`\n' +
  'func TestContract(t *testing.T) {}\n' }];
const plan = await fs.readFile(path.join(repositoryRoot, 'docs', 'sdlc', 'public-readiness', 'test-plan.md'), 'utf8');
const baselineCalculatorSources = await Promise.all(calculatorFiles.map(async file =>
  ({ file, contents: await fs.readFile(path.join(repositoryRoot, ...file.split('/')), 'utf8') })));
const calculatorManifest = await fs.readFile(path.join(repositoryRoot, 'test', 'calculator', 'package.json'), 'utf8');
function calculatorFixtureSources(selected) {
  const policy = { schemaVersion: 1,
    surfaces: [{ coverage: 'fixture-only', paths: ['scripts/pr-calculator-reporter.mjs'] }],
    projects: [{ root: 'test/calculator', files: selected.map(source => source.file),
      coverage: 'fixture-only', owner: 'owned-calculator-fixture', reason: 'Independent source selection regression',
      command: ['node', '--test', 'test/*.test.js'], prerequisites: ['Owned calculator assets'] }] };
  return [{ file: 'test/calculator-project.test.mjs', contents:
    `export const validationDeclarations=${JSON.stringify(policy)};import test from 'node:test';test('project policy',()=>{});` },
  { file: 'test/calculator/package.json', contents: calculatorManifest }, ...selected];
}
function calculatorFixtureInventory(selected) {
  const files = calculatorFixtureSources(selected);
  return compileValidationSourceInventory({ files,
    surfacePaths: [...files.map(source => source.file), 'scripts/pr-calculator-reporter.mjs'] });
}
const baselineCalculatorInventory = calculatorFixtureInventory(baselineCalculatorSources);
const inventory = { complete: true, digest: digest('fixture-inventory'), cases: [{
  id: 'distribution-contract', file: 'test/distribution-channels.test.mjs',
  name: 'native frozen lifecycle', parents: [], applicability: { platforms: targets },
}], independentProjects: baselineCalculatorInventory.independentProjects };
const candidate = { descriptor: { version: '1.2.3', payload: { filename: 'ai-sdlc-framework-1.2.3.tgz' },
  files: [
    { filename: 'ai-sdlc-framework-1.2.3.tgz', sha256: '1'.repeat(64), kind: 'npm' },
    { filename: 'ai-sdlc-framework-1.2.3-macos.tar.gz', sha256: '2'.repeat(64), kind: 'archive' },
    { filename: 'ai-sdlc-framework-1.2.3-windows-x64.zip', sha256: '3'.repeat(64), kind: 'archive' },
  ] }, context: { identity: { descriptorSha256: '4'.repeat(64), checksumsSha256: '5'.repeat(64) } } };

test('T-PRD015 required public crypto fixture provisioning rejects missing CI capability and unpinned bytes', async t => {
  const bytes = Buffer.from('public verification material');
  const pin = { url: 'https://fixtures.example/public', sha256: digest(bytes) };
  // Fixture transport is controlled here; T-PRD041 separately invokes the real cryptographic verifier.
  const { createHash } = await import('node:crypto');
  pin.sha256 = createHash('sha256').update(bytes).digest('hex');
  let options;
  const fetcher = async (_url, selected) => {
    options = selected;
    return { ok: true, arrayBuffer: async () => bytes };
  };
  assert.deepEqual(await fetchPinnedFixture(pin, fetcher), bytes);
  assert.equal(options.redirect, 'error');
  await assert.rejects(fetchPinnedFixture({ ...pin, sha256: '0'.repeat(64) }, fetcher), /integrity mismatch/u);
  await assert.rejects(fetchPinnedFixture(pin, async () => ({ ok: false })), /unavailable/u);
  await assert.rejects(provisionPrCryptoFixture({ root: 'never-created', environment: {} }), /only in CI/u);
  const root = path.join(repositoryRoot, '.test-data', `crypto-missing-input-${randomUUID()}`);
  await fs.mkdir(root, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true }));
  const environment = { ...process.env, GITHUB_ACTIONS: 'true' };
  for (const name of Object.keys(environment)) if (name.startsWith('SDLC_NPM_')) delete environment[name];
  delete environment.NODE_TEST_CONTEXT;
  const missing = await executeValidationCommand({ name: 'missing-pr-crypto', command: process.execPath,
    args: ['--test', '--test-reporter=tap', '--test-name-pattern=T-PRD041 retained signed fixtures',
      'test/public-readiness-release-consumer.test.mjs'], environment, outputDir: root });
  assert.equal(missing.complete, true);
  assert.equal(missing.exitCode, 1);
  assert.match(missing.stdout, /Required PR crypto inputs are missing/u);
  assert.match(missing.stdout, /# skipped 0/u);
});

test('T-PRD087 independent calculator PR command retains eleven namespaced originals and rejects partial skipped or duplicate credit', async t => {
  const root = path.join(repositoryRoot, '.test-data', `calculator-evidence-${randomUUID()}`);
  await fs.mkdir(root, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true }));
  const output = path.join(root, 'calculator.json');
  const report = await runCalculator({ root: repositoryRoot, output, context: { source: 'owned focused execution' } });
  const expected = calculatorSelection(baselineCalculatorInventory);
  const journal = await fs.readFile(`${output}.journal.ndjson`, 'utf8');
  assert.equal(reconcileCalculator(report, expected, journal), true);
  assert.deepEqual(report.summary, { tests: 11, passed: 11, failed: 0, skipped: 0, cancelled: 0 });
  assert.equal(expected.filter(test => test.file === calculatorFiles[0]).length, 8);
  assert.equal(expected.filter(test => test.file === calculatorFiles[1]).length, 3);
  for (const alter of [
    value => { value.results.pop(); },
    value => { value.results[0].status = 'Skipped'; },
    value => { value.results[1] = value.results[0]; },
    value => { value.complete = false; },
    value => { value.selection[0].sourceDigest = '0'.repeat(64); },
  ]) {
    const changed = structuredClone(report);
    alter(changed);
    assert.equal(reconcileCalculator(changed, expected, journal), false);
  }
  assert.equal(reconcileCalculator(report, expected, ''), false);
});

test('T-PRD087 calculator source selection includes declared growth and rejects unsupported or ambiguous selectors', () => {
  const expected = calculatorSelection(baselineCalculatorInventory);
  assert.equal(expected.length, 11);
  assert.deepEqual(calculatorArguments(expected), calculatorCommandArguments);
  const legacy = baselineCalculatorSources.flatMap(source =>
    [...source.contents.matchAll(/^test\('([^'\r\n]+)', \(\) => \{/gmu)].map(match => ({
      namespace: 'calculator', file: source.file, name: match[1], sourceDigest: digest(source.contents),
    })));
  assert.deepEqual(expected, legacy, 'Historical two-file selector identities and ordering remain unchanged');
  const extra = { file: 'test/calculator/test/additional.test.js',
    contents: `const test=require('node:test');test(${JSON.stringify(expected[0].name)},()=>{});` };
  const grown = calculatorFixtureInventory([...baselineCalculatorSources, extra]);
  assert.equal(grown.complete, true);
  assert.equal(calculatorSelection(grown).length, 12);
  assert.equal(calculatorSelection(grown).filter(test => test.name === expected[0].name).length, 2);
  assert.ok(calculatorArguments(calculatorSelection(grown)).includes(extra.file));
  const components = deriveNativeComponentSpecification({ inventory: grown, testPlan: plan,
    adapterSourceDigest: 'a'.repeat(64) });
  assert.equal(components.calculator.tests, 12);
  assert.equal(components.calculator.files.length, 3);
  assert.equal(nativeConfigurationDigest({ inventory: grown, profile: 'pr' }),
    nativeConfigurationDigest({ inventory: { complete: true, digest: grown.digest }, profile: 'pr',
      calculator: components.calculator }),
  'Component source/config replay binds the grown project rather than falling back to the eleven-test baseline');
  const appended = baselineCalculatorSources.map(source => ({ ...source }));
  appended[0].contents += "\ntest('added assertion with different quoting',()=>{});\n";
  assert.equal(calculatorSelection(calculatorFixtureInventory(appended)).length, 12);
  const nested = { ...extra, contents: "const test=require('node:test');" +
    "test('root',async t=>{await t.test('nested',()=>{});});" };
  assert.throws(() => calculatorSelection(calculatorFixtureInventory([...baselineCalculatorSources, nested])),
    /supported flat tests/u);
  const wrongCommand = structuredClone(grown);
  wrongCommand.independentProjects[0].command = ['node', '--test', 'test/calculator.test.js'];
  assert.throws(() => calculatorSelection(wrongCommand), /Every declared calculator test file/u);
});

test('T-PRD087 actual calculator command executes an added declared file and appended assertion without borrowing eleven-test success', async t => {
  const root = path.join(repositoryRoot, '.test-data', `calculator-growth-${randomUUID()}`);
  await fs.mkdir(root, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true }));
  const assets = ['calculator.js', 'index.html', 'styles.css', 'favicon.svg', 'favicon.ico',
    'docs/requirements.md', 'docs/test-plan.md', 'docs/technical-design.md'];
  for (const mode of ['declared-file', 'appended-assertion']) {
    const fixtureRoot = path.join(root, mode);
    await fs.mkdir(path.join(fixtureRoot, 'scripts'), { recursive: true });
    await fs.mkdir(path.join(fixtureRoot, '.test-data'));
    await fs.copyFile(path.join(repositoryRoot, 'scripts', 'pr-calculator-reporter.mjs'),
      path.join(fixtureRoot, 'scripts', 'pr-calculator-reporter.mjs'));
    const selected = baselineCalculatorSources.map(source => ({ ...source }));
    const baselineName = calculatorSelection(baselineCalculatorInventory)[0].name;
    if (mode === 'declared-file') selected.push({
      file: 'test/calculator/test/additional.test.js',
      contents: "const test=require('node:test');const assert=require('node:assert/strict');" +
        `test(${JSON.stringify(baselineName)},()=>assert.equal(6*7,42));`,
    });
    else selected[0].contents += `\ntest(${JSON.stringify(baselineName + ' extended')},()=>assert.equal(6*7,42));\n`;
    for (const source of calculatorFixtureSources(selected)) {
      const file = path.join(fixtureRoot, ...source.file.split('/'));
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, source.contents);
    }
    for (const asset of assets) {
      const destination = path.join(fixtureRoot, 'test', 'calculator', ...asset.split('/'));
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(path.join(repositoryRoot, 'test', 'calculator', ...asset.split('/')), destination);
    }
    const compiled = calculatorFixtureInventory(selected);
    const expected = calculatorSelection(compiled);
    const output = path.join(fixtureRoot, '.test-data', 'calculator.json');
    const report = await runCalculator({ root: fixtureRoot, output });
    const journal = await fs.readFile(`${output}.journal.ndjson`, 'utf8');
    assert.equal(report.exitCode, 0);
    assert.deepEqual(report.summary, { tests: 12, passed: 12, failed: 0, skipped: 0, cancelled: 0 });
    if (mode === 'declared-file') {
      assert.equal(new Set(report.results.filter(row => row.name === baselineName).map(row => row.file)).size, 2);
    }
    assert.equal(reconcileCalculator(report, expected, journal), true);
    assert.equal(reconcileCalculator(report, calculatorSelection(baselineCalculatorInventory), journal), false);
    const swapped = journal.trim().split('\n').map(JSON.parse);
    const terminal = swapped.find(event => event.type === 'test:pass' && event.data.nesting === 0);
    terminal.data.file = '/unrelated/test/calculator/test/not-declared.test.js';
    assert.equal(reconcileCalculator(report, expected, swapped.map(JSON.stringify).join('\n')), false);
    const renamed = structuredClone(report);
    renamed.results[0].name = renamed.results[0].name.slice(0, -1);
    assert.equal(reconcileCalculator(renamed, expected, journal), false);
  }
});

test('T-PRD021 native collector admits real isolated root originals with declared dependencies and rejects journal substitution', async t => {
  const root = path.join(repositoryRoot, '.test-data', `native-group-contract-${randomUUID()}`);
  await fs.mkdir(path.join(root, 'test'), { recursive: true });
  t.after(() => fs.rm(root, { recursive: true }));
  const file = 'test/group-contract.test.mjs';
  const source = `export const validationDeclarations=${JSON.stringify({ schemaVersion: 1, groups: [
    { root: 'second root', dependsOn: ['first root'], exclusiveResources: ['owned-resource'] },
    { root: 'first root', exclusiveResources: ['owned-resource'] },
  ] })};\n` +
    'import test from "node:test";import assert from "node:assert/strict";\n' +
    'test("first root",async t=>{await t.test("causal child",()=>assert.equal(1+1,2));});\n' +
    'test("second root",()=>assert.equal(2+2,4));\n';
  await fs.writeFile(path.join(root, ...file.split('/')), source);
  const declared = discoverDeclarations(source, file);
  assert.deepEqual(declared.unresolved, []);
  const inventory = { complete: true, files: [{ file }], cases: declared.cases,
    groupDeclarations: declared.declared.groups.map(group => ({ file, ...group })) };
  const selected = await createPlan(parseOptions(['targeted', '--workers', '2',
    path.join(root, ...file.split('/'))]), root);
  const output = path.join(root, 'original.json');
  const code = await runTests(selected, { reportPath: output });
  assert.equal(code, 0);
  const report = JSON.parse(await fs.readFile(output, 'utf8'));
  const journal = await fs.readFile(`${output}.journal.ndjson`, 'utf8');
  const stage = { name: 'unit', files: [file], cases: declared.cases };
  const target = process.platform === 'win32' ? 'windows-x64' :
    process.platform === 'darwin' ? `macos-${process.arch}` : 'linux-x64';
  assert.equal(validateNativeGroupReport({ inventory, stage, report, journal, target }).length, 2);
  assert.throws(() => validateNativeGroupReport({ inventory, stage, report,
    journal: journal.split('\n').filter(line => !line.includes('"kind":"group-start"')).join('\n'), target }),
  { code: 'EVIDENCE' });
});

test('T-PRD023 native ambient scratch checks every Git ancestor and rejects linked storage rather than inheriting checkout Git', async () => {
  const directory = path.join(repositoryRoot, '.test-data', 'virtual-native-ambient');
  const visited = [];
  const directoryStat = { isDirectory: () => true, isSymbolicLink: () => false };
  const lstat = async file => {
    visited.push(file);
    if (path.basename(file) === '.git') throw Object.assign(new Error('Absent marker'), { code: 'ENOENT' });
    return directoryStat;
  };
  await assertGitFreeAncestors(directory, { lstat });
  assert.ok(visited.includes(path.join(repositoryRoot, '.git')));
  assert.ok(visited.includes(path.join(path.parse(directory).root, '.git')));
  await assert.rejects(assertGitFreeAncestors(directory, { lstat: async file =>
    file === path.join(repositoryRoot, '.git') ? { isDirectory: () => false, isSymbolicLink: () => false } :
      lstat(file) }), { code: 'HOST' });
  await assert.rejects(assertGitFreeAncestors(directory, { lstat: async file =>
    file === path.dirname(directory) ? { isDirectory: () => true, isSymbolicLink: () => true } :
      lstat(file) }), { code: 'HOST' });
});

test('T-PRD016 private Linux library fixtures preserve frozen published bytes without adding a Linux distribution', async () => {
  const frozen = structuredClone(candidate);
  frozen.descriptor.sourceCommit = sourceRevision;
  for (const file of frozen.descriptor.files) file.size = 16;
  const before = structuredClone(frozen);
  let selected;
  const build = async input => {
    selected = input;
    return { outputDir: input.outputDir, archives: [
      ...frozen.descriptor.files.filter(file => file.kind === 'archive').map(file =>
        ({ ...file, target: file.filename.endsWith('-macos.tar.gz') ? 'macos' : 'windows-x64' })),
      { target: 'linux-x64', filename: 'private-linux-fixture.tar.gz', sha256: 'f'.repeat(64), size: 16 },
    ] };
  };
  const options = { candidate: frozen, candidateDir: path.join(repositoryRoot, '.test-data', 'virtual-candidate'),
    scratch: path.join(repositoryRoot, '.test-data', 'virtual-scratch'), windowsLauncher: 'owned-frozen-launcher',
    environment: {}, build };
  const fixtures = await prepareNativeHostFixtures(options);
  assert.equal(fixtures.kind, 'private-test-library-only');
  assert.equal(selected.artifact, path.join(options.candidateDir, 'assets', frozen.descriptor.payload.filename));
  assert.equal(selected.sourceCommit, sourceRevision);
  assert.deepEqual(selected.targets, ['macos', 'windows-x64', 'linux-x64']);
  assert.deepEqual(frozen, before);
  assert.ok(!nativeArtifacts(frozen).some(file => file.name.includes('linux')),
    'Native credit still binds only the unchanged frozen published asset inventory');
  await assert.rejects(prepareNativeHostFixtures({ ...options, build: async input => {
    const result = await build(input);
    result.archives[0].sha256 = 'e'.repeat(64);
    return result;
  } }), { code: 'EVIDENCE' });
  await assert.rejects(prepareNativeHostFixtures({ ...options, build: async input => {
    const result = await build(input);
    result.archives.pop();
    return result;
  } }), { code: 'EVIDENCE' });
});

test('T-PRD074 exact typed native source retains code and credential-negative fixtures without becoming sanitized log text', () => {
  const files = [{ file: 'test/controlled-source.test.mjs',
    contents: '\uFEFFconst fixture = {token:"fixture-value", headers:{Authorization:"Bearer fixture-token"}};\n' +
      'const reserved = "https://owner:dummy@example.test/path?sig=fixture-only-signature-value";\n' }];
  const original = Buffer.from(files[0].contents);
  assert.equal(validateNativeSourceDefinitions(files), files);
  assert.deepEqual(Buffer.from(files[0].contents), original);
  for (const text of [
    `"${'ghp_' + 'a'.repeat(36)}"`,
    `"${Buffer.from('{"alg":"HS256"}').toString('base64url')}.` +
      `${Buffer.from('{"fixture":true}').toString('base64url')}.fixtureSignature"`,
    `"https://github.com/fixture/repo?token=${'a'.repeat(40)}"`,
    `"-----BEGIN PRIVATE KEY-----\n${'A'.repeat(64)}\n-----END PRIVATE KEY-----"`,
  ]) {
    assert.throws(() => validateNativeSourceDefinitions([{ file: 'src/unsafe-source.mjs', contents: text }]),
      error => error.code === 'UNSAFE' && !error.message.includes(text));
  }
});
function fixture(profile = 'pr', frozenCandidate = candidate) {
  const artifacts = nativeArtifacts(frozenCandidate);
  const lanes = targets.map(target => {
    const specification = nativeSpecification({ plan, inventory, goSources: sources, target, profile });
    const context = {
      candidateDigest: digest('candidate'), testSpecDigest: digest('specification'), configDigest: digest(profile),
      inventoryDigest: validationInventoryDigest(specification),
      sources: [{ repositoryId: 'repository-123', revision: sourceRevision, contentDigest: digest('source-tree') }],
      profile: specification.profile, environment: 'local',
      location: specification.cases[0].location, mode: 'automated', owner: 'provider',
      native: { kind: 'native', platform: nativePlatforms[target],
        architecture: target === 'macos-arm64' ? 'arm64' : 'x64', image: `actual-${target}/20261019.1`,
        toolchain: { node: '22.23.3', go: 'go version go1.27.1 fixture-native',
          python: 'Python 3.12.10', resources: nativeResourceFacts({
            availableParallelism: 4, totalMemoryBytes: 8 * 1024 ** 3, configuredWorkers: null,
          }) } },
      producer: { provider: 'github', connection: 'repository-ci', scopeRef: 'repository:123',
        definitionRef: 'fixture/repo/.github/workflows/ci.yml@refs/pull/7/merge',
        executionRef: '12345', attemptKind: 'known', attemptRef: '1' },
      attemptCapability: 'distinct', jobRef: `native-${target}`, artifacts: structuredClone(artifacts),
      ...(profile === 'r-pre' ? { intentId: 'release-fixture-1' } : {}),
    };
    return { target, specification, context };
  });
  const expected = { profile, sourceRevision, artifacts,
    executions: lanes.map(({ target, context }) => ({ target, context: structuredClone(context) })) };
  const report = (lane, mutate = () => {}) => {
    const observedAt = new Date(Date.now() - 1000).toISOString();
    const raw = { schemaVersion: 1, kind: 'test-execution', context: structuredClone(lane.context),
      startedAt: observedAt, finishedAt: observedAt, observedAt, sequence: 1, complete: true, exitCode: 0,
      results: lane.specification.cases.flatMap(test => test.assertions.map(assertion => ({
        testId: test.id, assertionId: assertion.id, selector: structuredClone(assertion.selector),
        status: 'Passed', expectedMet: true, expectedDigest: test.expectedDigest, checkpoint: test.checkpoint,
        observedAt, sourceSequence: 1, durationMs: 1, exitCode: 0,
      }))) };
    mutate(raw);
    return raw;
  };
  const evaluate = (lane, mutate, spec = lane.specification) => {
    const raw = report(lane, mutate);
    raw.context.inventoryDigest = validationInventoryDigest(spec);
    const normalized = normalizeExecutionReport(raw, raw.context, input => ({
      verifierId: 'fixture-native-host', reportDigest: input.reportDigest, context: raw.context,
      sourceTime: raw.observedAt, sourceSequence: raw.sequence,
    }));
    return evaluateReadiness(spec, [normalized], { profile: spec.profile,
      executions: [{ id: `native-${lane.target}`, context: raw.context }], now: new Date().toISOString(),
      policy: { maxAgeMs: 3600000, revisionPolicy: 'exact', verifierIds: ['fixture-native-host'] } });
  };
  const passing = () => lanes.map(lane => ({ target: lane.target, evaluation: evaluate(lane) }));
  return { lanes, expected, report, evaluate, passing };
}

test('T-PRD004 native policy rejects fixture, metadata and cross-build credit and uses protected evaluation inputs', () => {
  const f = fixture();
  assert.equal(aggregateNativeReadiness(f.passing(), f.expected).status, 'Passed');
  for (const kind of ['fixture', 'cross-build', 'metadata']) {
    const evaluations = f.passing();
    evaluations[2] = { target: f.lanes[2].target, context: f.lanes[2].context,
      evaluation: f.evaluate(f.lanes[2], raw => { raw.context.native.kind = kind; }) };
    assert.equal(evaluations[2].evaluation.status, 'Passed', 'Generic fixture truth is distinct from native policy');
    assert.equal(aggregateNativeReadiness(evaluations, f.expected).status, 'NotRun');
  }
  const forged = f.passing();
  forged[0].evaluation = JSON.parse(JSON.stringify(forged[0].evaluation));
  assert.throws(() => aggregateNativeReadiness(forged, f.expected), { code: 'EVIDENCE' });
  const lane = f.lanes[0];
  const unverified = normalizeExecutionReport(f.report(lane), lane.context);
  for (const report of [unverified, JSON.parse(JSON.stringify(unverified))]) {
    const evaluation = evaluateReadiness(lane.specification, [report], {
      profile: lane.specification.profile,
      executions: [{ id: `native-${lane.target}`, context: lane.context }], now: new Date().toISOString(),
      policy: { maxAgeMs: 3600000, revisionPolicy: 'exact', verifierIds: ['fixture-native-host'] },
    });
    assert.equal(evaluation.status, 'NotRun', 'Data-only Passed outcomes cannot supply their own origin proof');
  }
  assert.throws(() => validateBootstrapRequest({ target: 'foreign-platform', outputDir: '.test-data/never-created' }),
    { code: 'HOST' });
});

test('T-PRD016 native aggregation closes four platforms and six PR or four R-PRE cases without JSON Passed bypasses', () => {
  for (const profile of ['pr', 'r-pre']) {
    const f = fixture(profile);
    const passing = f.passing();
    const good = aggregateNativeReadiness(passing, f.expected);
    assert.equal(good.status, 'Passed');
    assert.equal(good.requiredCases.filter(id => id !== 'T-PRD087').length, profile === 'pr' ? 6 : 4);
    assert.equal(good.requiredCases.includes('T-PRD087'), profile === 'pr');
    assert.equal(aggregateNativeReadiness(passing.slice(0, -1), f.expected).status, 'NotRun');
    assert.equal(aggregateNativeReadiness([...passing, passing[0]], f.expected).status, 'NotRun');
    assert.equal(aggregateNativeReadiness([...passing.slice(0, -1), { ...passing[3], target: 'macos-universal' }],
      f.expected).status, 'NotRun');
    for (const mutate of [
      raw => { raw.context.sources[0].revision = 'b'.repeat(40); },
      raw => { raw.context.sources[0].repositoryId = 'foreign-repository'; },
      raw => { raw.context.testSpecDigest = digest('changed native specification'); },
      raw => { raw.context.configDigest = digest('changed native configuration'); },
      raw => { raw.context.producer.attemptRef = '2'; },
      raw => { raw.context.native.architecture = 'arm64'; },
      raw => { raw.context.artifacts[2].sha256 = 'f'.repeat(64); },
      raw => { raw.context.artifacts.pop(); },
      raw => { raw.context.artifacts.push({ name: 'undeclared.tgz', sha256: 'f'.repeat(64) }); },
      raw => { raw.context.native.toolchain.python = 'Python 3.13.0'; },
      raw => { raw.results[0].status = 'Failed'; raw.results[0].expectedMet = false; raw.results[0].exitCode = 1; raw.exitCode = 1; },
      raw => { raw.results[0].status = 'Skipped'; raw.results[0].expectedMet = null; },
      raw => { raw.results[0].status = 'Cancelled'; raw.results[0].expectedMet = null; },
      raw => { raw.complete = false; raw.finishedAt = null; raw.exitCode = 2; },
      raw => {
        const expired = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
        raw.startedAt = expired; raw.finishedAt = expired; raw.observedAt = expired;
        for (const result of raw.results) result.observedAt = expired;
      },
    ]) {
      const changed = f.passing();
      changed[0] = { target: f.lanes[0].target, evaluation: f.evaluate(f.lanes[0], mutate),
        context: structuredClone(f.lanes[0].context) };
      assert.notEqual(aggregateNativeReadiness(changed, f.expected).status, 'Passed');
    }
    const wrongCases = f.passing();
    const lane = f.lanes[2];
    const spec = structuredClone(lane.specification);
    spec.cases = [spec.cases[0], { ...spec.cases[0], id: 'T-UNDECLARED-NATIVE' }];
    wrongCases[2] = { target: lane.target, evaluation: f.evaluate(lane, raw => {
      raw.results = spec.cases.flatMap(test => test.assertions.map(assertion => ({
        ...raw.results[0], testId: test.id, assertionId: assertion.id, selector: assertion.selector,
        expectedDigest: test.expectedDigest,
      })));
    }, spec) };
    assert.notEqual(aggregateNativeReadiness(wrongCases, f.expected).status, 'Passed');
    const other = fixture(profile === 'pr' ? 'r-pre' : 'pr');
    assert.equal(aggregateNativeReadiness(other.passing(), f.expected).status, 'NotRun');
  }
});

test('T-PRD016 native artifact ordering preserves complete stable metadata and rejects a changed WinGet digest', () => {
  const stable = structuredClone(candidate);
  stable.descriptor.files.push(
    { filename: 'Urmich.AISDLCFramework.yaml', kind: 'winget', sha256: '6'.repeat(64) },
    { filename: 'Urmich.AISDLCFramework.installer.yaml', kind: 'winget', sha256: '7'.repeat(64) },
    { filename: 'Urmich.AISDLCFramework.locale.en-US.yaml', kind: 'winget', sha256: '8'.repeat(64) },
    { filename: 'ai-sdlc-framework.rb', kind: 'homebrew', sha256: '9'.repeat(64) },
  );
  const f = fixture('pr', stable);
  const artifacts = nativeArtifacts(stable);
  const context = validateExecutionContext(f.lanes[0].context);
  assert.deepEqual(artifacts, context.artifacts);
  assert.equal(digest(nativeArtifacts(structuredClone(stable))), digest(context.artifacts),
    'Unchanged final candidate must match the execution-context artifact identity exactly');
  assert.deepEqual(new Set(artifacts.map(file => file.name)), new Set([
    ...stable.descriptor.files.map(file => file.filename), 'frozen-descriptor', 'frozen-checksums',
  ]));
  assert.equal(aggregateNativeReadiness(f.passing(), f.expected).status, 'Passed');
  const changed = structuredClone(stable);
  changed.descriptor.files.find(file => file.filename === 'Urmich.AISDLCFramework.installer.yaml').sha256 =
    'f'.repeat(64);
  assert.notEqual(digest(nativeArtifacts(changed)), digest(context.artifacts));
  assert.equal(aggregateNativeReadiness(fixture('pr', changed).passing(), f.expected).status, 'NotRun');
});

test('T-PRD016 native input validation rejects invalid R-PRE intent and build booleans before filesystem mutation', async () => {
  const options = { target: 'linux-x64', profile: 'r-pre', candidateDir: '.test-data/native-never-candidate',
    evidenceDir: '.test-data/native-never-evidence', buildCandidate: true };
  options.candidateDir += `-${randomUUID()}`;
  options.evidenceDir += `-${randomUUID()}`;
  const environment = { EXPECTED_SOURCE_COMMIT: sourceRevision };
  for (const intent of [undefined, '', 'contains spaces', 'line\nbreak']) {
    assert.throws(() => validateNativeRequest(options, { ...environment, RELEASE_INTENT_ID: intent }));
  }
  assert.equal(validateNativeRequest(options, { ...environment, RELEASE_INTENT_ID: 'release-1' }).profile, 'r-pre');
  for (const value of ['TRUE', '1', '', 'falsey']) {
    assert.throws(() => parseNativeOptions(['--build-candidate', value]), { code: 'INPUT' });
  }
  assert.equal(parseNativeOptions(['--build-candidate', 'false']).buildCandidate, false);
  assert.equal(parseNativeOptions(['--build-candidate', 'true']).buildCandidate, true);
  assert.throws(() => validateNativeRequest({ ...options, buildCandidate: 'false' }, environment), { code: 'INPUT' });
  assert.throws(() => validateNativeRequest({ ...options, profile: 'pr', evidenceDir: options.candidateDir }, environment),
    { code: 'INPUT' });
  for (const directory of [options.candidateDir, options.evidenceDir]) {
    await assert.rejects(fs.stat(path.join(repositoryRoot, directory)), { code: 'ENOENT' });
  }
});

test('T-PRD040 unavailable Intel runtime and denied required clients remain explicit non-passing native dispositions', () => {
  const f = fixture();
  const missing = aggregateNativeReadiness(f.passing().filter(lane => lane.target !== 'macos-x64'), f.expected);
  assert.equal(missing.status, 'NotRun');
  assert.ok(missing.blockers.some(blocker => blocker.includes('macos-x64')));
  for (const detail of ['Required native Intel runtime is unavailable', 'Corporate policy denied required native client']) {
    const evaluations = f.passing();
    evaluations[3] = { target: 'macos-x64', evaluation: f.evaluate(f.lanes[3], raw => {
      raw.results[0].status = 'Blocked';
      raw.results[0].expectedMet = null;
      raw.results[0].detail = detail;
    }) };
    assert.equal(aggregateNativeReadiness(evaluations, f.expected).status, 'NotRun');
    assert.ok(JSON.stringify(evaluations[3].evaluation).includes(detail));
  }
});

function goReport() {
  const Time = new Date().toISOString();
  return { complete: true, exitCode: 0, platform: 'linux', architecture: 'x64', node: 'v22.23.3', stdout: [
    ...['TestContract', 'TestContract/one', 'TestContract/two'].flatMap(Test =>
      [{ Time, Action: 'run', Test }, { Time, Action: 'pass', Test, Elapsed: 0.001 }]),
    { Time, Action: 'pass', Package: 'fixture-launcher', Elapsed: 0.003 },
  ].map(JSON.stringify).join('\n') };
}

test('T-PRD018 malformed unknown duplicate and missing Go terminals retain diagnostics without throwing or receiving credit', () => {
  const good = goReport();
  assert.equal(nativeGoObservations(sources, [good], 'linux-x64').status, 'Passed');
  const original = structuredClone(good);
  for (const stdout of [
    `${good.stdout}\nnot-json`,
    `${good.stdout}\n${JSON.stringify({ Action: 'pass', Test: 'TestForeign', Time: new Date().toISOString() })}`,
    `${good.stdout}\n${good.stdout.split('\n')[1]}`,
    good.stdout.split('\n').filter(line => !line.includes('TestContract/two')).join('\n'),
  ]) {
    const result = nativeGoObservations(sources, [{ ...good, stdout }], 'linux-x64');
    assert.notEqual(result.status, 'Passed');
    assert.ok(result.blockers.length > 0);
  }
  assert.equal(nativeGoObservations(sources, [], 'linux-x64').status, 'NotRun');
  assert.equal(nativeGoObservations(sources, [good, good], 'linux-x64').status, 'NotRun');
  assert.equal(reconcileGoExecution(sources, { ...good, complete: false, exitCode: null }).status, 'NotRun');
  assert.deepEqual(good, original, 'Reconciliation does not rewrite original diagnostics');
  const failed = { ...good, stdout: good.stdout.replace('"Action":"pass","Test":"TestContract/one"',
    '"Action":"fail","Test":"TestContract/one"'), exitCode: 1 };
  assert.equal(nativeGoObservations(sources, [failed], 'linux-x64').status, 'Failed');
});

test('T-PRD018 partial native reports retain original generic evidence and cannot pass by completed sibling assertions', () => {
  const f = fixture();
  const lane = f.lanes[0];
  const raw = f.report(lane, raw => {
    raw.complete = false;
    raw.finishedAt = null;
    raw.exitCode = 2;
    raw.results[0].status = 'Cancelled';
    raw.results[0].expectedMet = null;
    raw.results[0].detail = 'Owned native process was interrupted; original journal retained.';
  });
  const evaluation = evaluateNativeExecution(lane.specification, raw);
  assert.notEqual(evaluation.status, 'Passed');
  const protectedState = requireReadinessEvaluation(evaluation);
  assert.equal(protectedState.context.executions[0].context.sources[0].revision, sourceRevision);
  const bundle = createEvidenceBundle(evaluation);
  assert.ok(JSON.stringify(bundle).includes('execution-bytes'));
  assert.ok(JSON.stringify(evaluation).includes('interrupted'));
  assert.throws(() => requireReadinessEvaluation({ ...evaluation, status: 'Passed' }), { code: 'EVIDENCE' });
});

test('T-PRD018 native finalization persists missing-stage failure bundles and preserves partial journals without overwrites', async t => {
  const f = fixture();
  const lane = f.lanes[0];
  const directory = path.join(repositoryRoot, '.test-data', `native-partial-${randomUUID()}`);
  await fs.mkdir(directory, { recursive: true });
  t.after(async () => {
    assert.equal(path.dirname(directory), path.join(repositoryRoot, '.test-data'));
    await fs.rm(directory, { recursive: true });
    await assert.rejects(fs.stat(directory), { code: 'ENOENT' });
  });
  const journal = '{"sequence":1,"kind":"registered","name":"native frozen lifecycle"}\n';
  await fs.writeFile(path.join(directory, 'regression.json.journal.ndjson'), journal, { flag: 'wx' });
  await fs.writeFile(path.join(directory, 'static.json'), '', { flag: 'wx' });
  const args = { directory, inventory, sources, target: lane.target,
    stages: [{ name: 'regression', cases: inventory.cases, args: ['targeted'] }],
    context: lane.context, specification: lane.specification, startedAt: new Date(Date.now() - 1000).toISOString(),
    cancelled: true, completeReportRef: 'https://github.com/fixture/repo/actions/runs/1/attempts/1' };
  const result = await finalizeNativeEvidence(args);
  assert.notEqual(result.evaluation.status, 'Passed');
  const raw = JSON.parse(await fs.readFile(path.join(directory, 'execution.json'), 'utf8'));
  assert.equal(raw.complete, false);
  assert.equal(raw.finishedAt, null);
  assert.notEqual(raw.exitCode, 0);
  assert.ok(result.diagnostics.some(row => row.code === 'MISSING_STAGE_REPORT'));
  assert.equal(await fs.readFile(path.join(directory, 'regression.json.journal.ndjson'), 'utf8'), journal);
  const bundle = JSON.parse(await fs.readFile(path.join(directory, 'readiness-bundle.json'), 'utf8'));
  const original = bundle.objects.find(object => object.value.kind === 'execution-bytes').value;
  const executionBytes = await fs.readFile(path.join(directory, 'execution.json'));
  assert.equal(original.sha256, digest(executionBytes));
  assert.deepEqual(Buffer.from(original.content, 'base64'), executionBytes);
  assert.match(await fs.readFile(path.join(directory, 'readiness.md'), 'utf8'), /NotRun|Failed/u);
  await assert.rejects(finalizeNativeEvidence(args), { code: 'EEXIST' });
});

test('T-PRD018 native failure annotations escape workflow-command injection without changing the underlying failure', () => {
  const f = fixture();
  const lane = f.lanes[0];
  const evaluation = f.evaluate(lane, raw => {
    raw.results[0].status = 'Failed';
    raw.results[0].expectedMet = false;
    raw.results[0].exitCode = 1;
    raw.results[0].detail = '50% failed\r\n::notice::not another annotation';
    raw.exitCode = 1;
  });
  const annotations = nativeFailureAnnotations(evaluation);
  assert.equal(annotations.length, 1);
  assert.match(annotations[0], /50%25 failed%0D%0A::notice::/u);
  assert.ok(!/[\r\n]/u.test(annotations[0]));
  assert.equal(evaluation.status, 'Failed');
});
