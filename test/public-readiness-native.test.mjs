export const validationDeclarations = {
  "schemaVersion": 1,
  "surfaces": [
    {"coverage": "direct", "paths": ["scripts/native-validation.mjs", "scripts/native-toolchain.mjs", "scripts/toolchain-baseline.mjs", "scripts/native-bootstrap-capability.mjs", "scripts/pr-capabilities.mjs", "scripts/pr-calculator.mjs", "scripts/pr-calculator-reporter.mjs", "scripts/native-components.mjs"]}
  ]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest } from '../src/core.mjs';
import { normalizeExecutionReport, evaluateReadiness, validationInventoryDigest,
  createEvidenceBundle, readEvidenceBundle, requireReadinessEvaluation, validateExecutionContext,
  sanitizeExecutionPayload } from 'ai-sdlc-framework/evidence';
import { aggregateNativeReadiness, nativeArtifacts, nativeSpecification, nativeGoObservations,
  parseNativeOptions, validateNativeRequest, evaluateNativeExecution,
  finalizeNativeEvidence, writeNativeReadinessBundle, nativeFailureAnnotations, assertGitFreeAncestors,
  nativeResourceFacts, prepareNativeHostFixtures,
  validateNativeSourceDefinitions, validateNativeGroupReport, nativeConfigurationDigest,
  deriveNativeComponentSpecification, writeNativeHomebrewReport,
  nativePrParts, nativeLegacyPrParts, nativeProducerRole,
  nativeFrameworkShardPlan, verifyNativeShardUnitOrder,
  nativeFrameworkShardProtocol, nativeLegacyFrameworkShardProtocol,
  nativePlatformUnitFrameworkShardProtocol, nativeFourBodyFrameworkShardProtocol,
  nativeFrameworkUnitShardNames, nativeStageSelections, nativePrPartsForProtocol } from '../scripts/native-validation.mjs';
import { observerApiFixture } from './readiness-observer-fixture.mjs';
import { validateBootstrapRequest } from '../scripts/native-toolchain.mjs';
import { reconcileGoExecution, executeValidationCommand, validationCommandArguments } from '../scripts/validation-tools.mjs';
import { repositoryRoot, createPlan, parseOptions, run as runTests } from '../scripts/test-runner.mjs';
import { discoverDeclarations, compileValidationSourceInventory, validationSourcePaths } from '../scripts/validation-inventory.mjs';
import { runCalculator, calculatorFiles, calculatorSelection, calculatorArguments,
  calculatorCommandArguments, reconcileCalculator } from '../scripts/pr-calculator.mjs';
import { fetchPinnedFixture, provisionPrCryptoFixture } from '../scripts/pr-capabilities.mjs';
import { nativeToolchain } from '../scripts/toolchain-baseline.mjs';
import { nativeBootstrapProtocol, nativeSdkBootstrapProtocol, homebrewToolchain } from '../scripts/toolchain-baseline.mjs';
import { sourceNativeBootstrapProtocol, nativeBootstrapCapability, bootstrapRequestCapability,
  requireNativeBootstrapCapability, nativeSdkRequirements, nativeSdkContextMatches,
  nativeBootstrapRequirements, probeNativeSdk } from '../scripts/native-bootstrap-capability.mjs';

test('T-PRD015 refresh SDK dispatch omits unused commands while historical and other roles probe exact tools in order', async () => {
  const request = { target: 'macos-arm64', profile: 'pr', component: 'framework', shard: 'refresh',
    protocol: nativeSdkBootstrapProtocol };
  assert.deepEqual(await probeNativeSdk(request, () => { throw new Error('Unused Go/Python invoked'); }), {});
  for (const change of [{ protocol: null }, { protocol: 'native-bootstrap-role-capabilities-v2' }, { shard: 'units' },
    { target: 'macos-x64', shard: 'units-1' },
    { shard: 'body-0' }, { component: 'full', shard: null }, { component: 'homebrew', shard: null }]) {
    const calls = [];
    const facts = await probeNativeSdk({ ...request, ...change }, async command => {
      calls.push({ name: command.name, args: command.args });
      return { complete: true, exitCode: 0, stdout: command.name === 'go-version' ?
        `go version ${nativeToolchain.go} darwin/arm64\n` : `Python ${nativeToolchain.python}\n` };
    });
    assert.deepEqual(calls, [{ name: 'go-version', args: ['version'] }, { name: 'python-version', args: ['--version'] }]);
    assert.equal(facts.python, `Python ${nativeToolchain.python}`);
    await assert.rejects(probeNativeSdk({ ...request, ...change }, async () => ({
      complete: true, exitCode: 0, stdout: 'NotRequired',
    })), { code: 'HOST' });
  }
});

test('T-PRD015 refresh SDK requirements reject producer downgrades and retain historical full tool identities', () => {
  const request = { target: 'macos-arm64', profile: 'pr', component: 'framework', shard: 'refresh',
    protocol: nativeSdkBootstrapProtocol };
  const actual = { go: `go version ${nativeToolchain.go} darwin/arm64`, python: `Python ${nativeToolchain.python}` };
  assert.deepEqual(nativeSdkRequirements(request), { go: false, python: false });
  assert.equal(nativeSdkContextMatches({}, request), true);
  assert.equal(nativeSdkContextMatches(actual, request), false);
  for (const protocol of [null, 'native-bootstrap-role-capabilities-v2']) {
    assert.deepEqual(nativeSdkRequirements({ ...request, protocol }), { go: true, python: true });
    assert.equal(nativeSdkContextMatches({}, { ...request, protocol }), false);
    assert.equal(nativeSdkContextMatches(actual, { ...request, protocol }), true);
  }
  for (const shard of ['units', 'body-0', 'body-1', 'body-2']) {
    assert.equal(nativeSdkContextMatches({}, { ...request, shard }), false);
    assert.equal(nativeSdkContextMatches(actual, { ...request, shard }), true);
  }
  assert.throws(() => nativeSdkRequirements({ ...request, protocol: 'producer-not-required' }), { code: 'INPUT' });
  assert.throws(() => nativeSdkRequirements({ ...request, profile: 'r-pre' }), { code: 'INPUT' });
  assert.throws(() => nativeSdkRequirements({ ...request, role: 'macos-arm64-framework-units' }), { code: 'INPUT' });
});

test('T-PRD015 role bootstrap is source-selected and cannot downgrade full release or historical configurations', () => {
  const inventory = { complete: true, digest: '1'.repeat(64) };
  const calculator = { namespace: 'calculator', tests: 1, files: ['test/calculator/capability.test.js'] };
  const source = value => [{ file: 'scripts/toolchain-baseline.mjs', contents: value }];
  assert.equal(sourceNativeBootstrapProtocol(source('export const nativeToolchain = {};')), null);
  assert.equal(sourceNativeBootstrapProtocol(source(`export const nativeBootstrapProtocol = '${nativeBootstrapProtocol}';`)),
    nativeBootstrapProtocol);
  for (const text of [`export const nativeBootstrapProtocol = 'unknown';`,
    `export const nativeBootstrapProtocol = "${nativeBootstrapProtocol}";`]) {
    assert.throws(() => sourceNativeBootstrapProtocol(source(text)), { code: 'EVIDENCE' });
  }
  assert.equal(bootstrapRequestCapability({ target: 'macos-arm64' }), null);
  const request = { target: 'macos-arm64', profile: 'pr', component: 'framework',
    shard: 'units', role: 'macos-arm64-framework-units' };
  assert.equal(bootstrapRequestCapability(request).homebrew, 'not-required');
  for (const change of [{ profile: 'r-pre' }, { component: 'full' }, { component: 'homebrew' },
    { shard: 'body-3' }, { role: 'macos-x64-framework-units' }, { profile: undefined }]) {
    assert.throws(() => bootstrapRequestCapability({ ...request, ...change }), { code: 'INPUT' });
  }
  const options = { inventory, calculator, target: request.target, profile: 'pr', component: 'framework', shard: 'units',
    shardPlanDigest: 'a'.repeat(64) };
  assert.notEqual(nativeConfigurationDigest(options),
    nativeConfigurationDigest({ ...options, bootstrapProtocol: nativeBootstrapProtocol }));
  for (const profile of ['pr', 'r-pre']) assert.equal(
    nativeConfigurationDigest({ inventory, calculator, profile }),
    nativeConfigurationDigest({ inventory, calculator, profile, bootstrapProtocol: nativeBootstrapProtocol }));
});

test('T-PRD015 role bootstrap rejects forged runtime providers borrowed prefixes and invented bottle evidence', () => {
  const request = { target: 'macos-arm64', profile: 'pr', component: 'framework',
    shard: 'units', role: 'macos-arm64-framework-units', protocol: nativeSdkBootstrapProtocol };
  const prefix = '/opt/abcde';
  const bootstrap = { status: 'Passed', target: request.target, native: {
    platform: 'darwin', architecture: 'arm64', node: nativeToolchain.node,
    bootstrapCapability: nativeBootstrapCapability(request),
    executables: { node: '/hostedtoolcache/node/bin/node' },
    runtimeProvider: { provider: 'actions/setup-node', executable: '/hostedtoolcache/node/bin/node',
      version: nativeToolchain.node, platform: 'darwin', architecture: 'arm64' },
    homebrew: { prefix, repository: prefix, commit: homebrewToolchain.commit, coreCommit: homebrewToolchain.coreCommit,
      ruby: homebrewToolchain.ruby,
      rubyExecutable: `${prefix}/Library/Homebrew/vendor/portable-ruby/${homebrewToolchain.ruby}/bin/ruby`,
      nodeProvisioned: false, bottlesProvisioned: false },
  }, reports: ['brew-git-identity', 'brew-prefix', 'brew-repository', 'brew-ruby-identity',
    'brew-ruby-path', 'brew-core-identity'].map(name => ({ name, complete: true, exitCode: 0 })) };
  assert.deepEqual(requireNativeBootstrapCapability({ ...request, bootstrap, prefix }), bootstrap.native.bootstrapCapability);
  const refreshRequest = { ...request, shard: 'refresh', role: 'macos-arm64-framework-refresh' };
  const refresh = structuredClone(bootstrap);
  refresh.native.bootstrapCapability = nativeBootstrapCapability(refreshRequest);
  assert.deepEqual(requireNativeBootstrapCapability({ ...refreshRequest, bootstrap: refresh, prefix }),
    refresh.native.bootstrapCapability);
  for (const mutate of [
    value => { value.native.go = 'NotRequired'; },
    value => { value.native.python = { status: 'Passed' }; },
    value => { value.reports.push({ name: 'go-version', complete: true, exitCode: 0 }); },
    value => { value.reports.pop(); },
  ]) {
    const changed = structuredClone(refresh);
    mutate(changed);
    assert.throws(() => requireNativeBootstrapCapability({ ...refreshRequest, bootstrap: changed, prefix }),
      { code: 'EVIDENCE' });
  }
  for (const mutate of [
    value => { value.native.bootstrapCapability.tools.go = false; },
    value => { value.native.bootstrapCapability.tools.python = false; },
    value => { value.native.runtimeProvider.executable = '/other/node'; },
    value => { value.native.runtimeProvider.architecture = 'x64'; },
    value => { value.native.homebrew.prefix = '/opt/fffff'; },
    value => { value.native.homebrew.coreCommit = 'f'.repeat(40); },
    value => { value.native.homebrew.nodePrefix = `${prefix}/opt/node@24`; },
    value => { value.native.homebrew.bottleReceiptsDigest = 'a'.repeat(64); },
    value => { value.native.homebrew.nodeProvisioned = true; },
    value => { value.reports.pop(); },
    value => { value.reports.push({ name: 'brew-node-install', complete: true, exitCode: 0 }); },
  ]) {
    const changed = structuredClone(bootstrap);
    mutate(changed);
    assert.throws(() => requireNativeBootstrapCapability({ ...request, bootstrap: changed, prefix }), { code: 'EVIDENCE' });
  }
  assert.throws(() => requireNativeBootstrapCapability({ ...request, bootstrap, protocol: null }), { code: 'EVIDENCE' });
  assert.throws(() => requireNativeBootstrapCapability({ ...request, bootstrap, component: 'homebrew' }), { code: 'EVIDENCE' });
});

test('T-PRD015 v4 unit runtime is required while unused SDK schema and prefix evidence cannot be invented', async () => {
  for (const target of ['linux-x64', 'windows-x64', 'macos-arm64', 'macos-x64']) {
    for (const shard of ['units', ...(target === 'macos-x64' ? ['units-1'] : []), 'refresh']) {
      const request = { target, profile: 'pr', component: 'framework', shard,
        protocol: nativeBootstrapProtocol };
      const python = shard !== 'refresh';
      assert.deepEqual(nativeBootstrapRequirements(request),
        { go: false, python, schema: false, homebrew: false, ownedPrefix: false });
      const calls = [];
      assert.deepEqual(await probeNativeSdk(request, async command => {
        calls.push(command.name);
        return { complete: true, exitCode: 0, stdout: `Python ${nativeToolchain.python}\n` };
      }), python ? { python: `Python ${nativeToolchain.python}` } : {});
      assert.deepEqual(calls, python ? ['python-version'] : []);
      if (python) await assert.rejects(probeNativeSdk(request, async () =>
        ({ complete: false, exitCode: 1, stdout: '' })), { code: 'HOST' });
      const platform = target.startsWith('macos-') ? 'darwin' : target === 'windows-x64' ? 'win32' : 'linux';
      const architecture = target === 'macos-arm64' ? 'arm64' : 'x64';
      const executable = '/controlled-fixture/python';
      const bootstrap = { status: 'Passed', target, native: {
        platform, architecture, node: nativeToolchain.node,
        bootstrapCapability: nativeBootstrapCapability(request),
        executables: { node: '/controlled-fixture/node', ...(python ? { python: executable } : {}) },
        runtimeProvider: { provider: 'actions/setup-node', executable: '/controlled-fixture/node',
          version: nativeToolchain.node, platform, architecture },
        ...(python ? { python: { executable, version: nativeToolchain.python,
          implementation: 'CPython', machine: architecture === 'arm64' ? 'arm64' : 'x86_64' } } : {}),
      }, reports: python ? [{ name: 'python-identity', complete: true, exitCode: 0 }] : [] };
      assert.deepEqual(requireNativeBootstrapCapability({ ...request, bootstrap }),
        bootstrap.native.bootstrapCapability);
      for (const mutate of [
        value => { value.native.go = 'NotRequired'; },
        value => { value.native.schemaPackages = {}; },
        value => { value.native.homebrew = { prefix: '/opt/abcde' }; },
        value => { value.native.prefix = '/opt/abcde'; },
        value => { value.reports.push({ name: 'schema-dependency-probe', complete: true, exitCode: 0 }); },
        value => { value.reports.push({ name: 'brew-prefix', complete: true, exitCode: 0 }); },
        ...['go', 'python', 'schema', 'homebrew', 'ownedPrefix'].map(tool => value => {
          value.native.bootstrapCapability.tools[tool] = 'false';
        }),
        value => { value.native.bootstrapCapability.tools.unknown = false; },
        value => { value.native.bootstrapCapability.role = `${target}-framework-body-0`; },
        value => { value.native.runtimeProvider.provider = 'producer-claimed'; },
        value => { value.native.bootstrapCapability.tools.python = !python; },
        value => {
          if (python) delete value.native.python;
          else value.native.python = { status: 'Passed' };
        },
      ]) {
        const changed = structuredClone(bootstrap);
        mutate(changed);
        assert.throws(() => requireNativeBootstrapCapability({ ...request, bootstrap: changed }),
          { code: 'EVIDENCE' });
      }
      assert.throws(() => requireNativeBootstrapCapability({ ...request, bootstrap, prefix: '/opt/abcde' }),
        { code: 'EVIDENCE' });
    }
    for (const options of [
      { profile: 'pr', component: 'framework', shard: 'body-0', protocol: nativeBootstrapProtocol },
      { profile: 'pr', component: 'homebrew', protocol: nativeBootstrapProtocol },
      { profile: 'r-pre', component: 'full', protocol: nativeBootstrapProtocol },
      { profile: 'pr', component: 'framework', shard: 'units', protocol: nativeSdkBootstrapProtocol },
      { profile: 'pr', component: 'framework', shard: 'refresh', protocol: 'native-bootstrap-role-capabilities-v2' },
      { profile: 'pr', component: 'full', protocol: null },
    ]) {
      const mac = target.startsWith('macos-');
      assert.deepEqual(nativeBootstrapRequirements({ target, ...options }),
        { go: true, python: true, schema: true, homebrew: mac, ownedPrefix: mac });
    }
  }
});

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
function fixture(profile = 'pr', frozenCandidate = candidate, components = false) {
  const artifacts = nativeArtifacts(frozenCandidate);
  const parts = components ? nativeLegacyPrParts : targets.map(target => ({ target, component: 'full', role: target }));
  const lanes = parts.map(({ target, component, role }) => {
    const specification = nativeSpecification({ plan, inventory, goSources: sources, target, profile, component });
    const context = {
      candidateDigest: digest('candidate'), testSpecDigest: digest('specification'), configDigest: digest(profile),
      inventoryDigest: validationInventoryDigest(specification),
      sources: [{ repositoryId: 'repository-123', revision: sourceRevision, contentDigest: digest('source-tree') }],
      profile: specification.profile, environment: 'local',
      location: specification.cases[0].location, mode: 'automated', owner: 'provider',
      native: { kind: 'native', platform: nativePlatforms[target],
        architecture: target === 'macos-arm64' ? 'arm64' : 'x64', image: `actual-${target}/20261019.1`,
        toolchain: { node: nativeToolchain.node, go: 'go version go1.27.1 fixture-native',
          python: 'Python 3.12.10', resources: nativeResourceFacts({
            availableParallelism: 4, totalMemoryBytes: 8 * 1024 ** 3, configuredWorkers: null,
          }) } },
      producer: { provider: 'github', connection: 'repository-ci', scopeRef: 'repository:123',
        definitionRef: 'fixture/repo/.github/workflows/ci.yml@refs/pull/7/merge',
        executionRef: '12345', attemptKind: 'known', attemptRef: '1' },
      attemptCapability: 'distinct', jobRef: `native-${role}`, artifacts: structuredClone(artifacts),
      ...(profile === 'r-pre' ? { intentId: 'release-fixture-1' } : {}),
    };
    return { target, component, specification, context };
  });
  const expected = { profile, sourceRevision, artifacts, components,
    executions: lanes.map(({ target, component, context }) => ({ target, component, context: structuredClone(context) })) };
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
      executions: [{ id: raw.context.jobRef, context: raw.context }], now: new Date().toISOString(),
      policy: { maxAgeMs: 3600000, revisionPolicy: 'exact', verifierIds: ['fixture-native-host'] } });
  };
  const passing = () => lanes.map(lane => ({ target: lane.target, component: lane.component, evaluation: evaluate(lane) }));
  return { lanes, expected, report, evaluate, passing };
}

test('T-PRD016 PR Mac components partition the complete original framework closure and reject non-PR partial requests', () => {
  const environment = { EXPECTED_SOURCE_COMMIT: sourceRevision,
    EXPECTED_DESCRIPTOR_SHA256: 'a'.repeat(64), EXPECTED_CHECKSUMS_SHA256: 'b'.repeat(64) };
  const selectedInventory = { ...inventory, digest: digest('component-causal-fixture'),
    cases: [...inventory.cases, { ...inventory.cases[0], id: 'distribution-child',
      name: 'retained causal child', parents: [inventory.cases[0].name] }] };
  for (const target of ['macos-arm64', 'macos-x64']) {
    const options = { target, profile: 'pr', candidateDir: '.test-data/component-candidate',
      evidenceDir: '.test-data/component-evidence', buildCandidate: false, component: 'framework' };
    assert.equal(validateNativeRequest(options, environment).component, 'framework');
    assert.equal(parseNativeOptions(['--component', 'homebrew']).component, 'homebrew');
    for (const delta of [
      { target: 'linux-x64' }, { target: 'windows-x64' }, { profile: 'r-pre' },
      { phase: 'candidate' }, { buildCandidate: true }, { component: 'unknown' }, { component: '' },
    ]) assert.throws(() => validateNativeRequest({ ...options, ...delta }, environment), { code: 'INPUT' });
    const inputs = { plan, inventory: selectedInventory, goSources: sources, target, profile: 'pr' };
    const full = nativeSpecification(inputs);
    assert.deepEqual(full, nativeSpecification({ ...inputs, component: 'full' }),
      'The existing whole-native CLI profile, selectors and execution identities are unchanged');
    const framework = nativeSpecification({ ...inputs, component: 'framework' });
    const homebrew = nativeSpecification({ ...inputs, component: 'homebrew' });
    assert.deepEqual(framework.cases[0].assertions,
      full.cases[0].assertions.filter(assertion => assertion.selector.procedure !== 'native-homebrew'));
    assert.deepEqual(homebrew.cases[0].assertions,
      full.cases[0].assertions.filter(assertion =>
        ['native-homebrew', 'frozen-artifacts'].includes(assertion.selector.procedure)));
    assert.equal(framework.cases.length, 1);
    assert.match(framework.cases[0].id, /^T-PRD014-/u);
    assert.equal(homebrew.cases.length, 1);
    assert.match(homebrew.cases[0].id, /^T-PRD060-/u);
    assert.equal(homebrew.cases[0].assertions.some(assertion => assertion.selector.file), false);
    assert.deepEqual(framework.cases[0].assertions.filter(assertion => assertion.selector.file && !assertion.selector.tool)
      .map(assertion => assertion.id), selectedInventory.cases.map(assertion => assertion.id));
    assert.deepEqual(framework.cases[0].assertions.find(assertion => assertion.id === 'distribution-child').selector.parents,
      [inventory.cases[0].name], 'The native root and descendant identities remain in one unchanged framework closure');
    assert.notEqual(nativeConfigurationDigest({ inventory, profile: 'pr', component: 'framework' }),
      nativeConfigurationDigest({ inventory, profile: 'pr', component: 'homebrew' }));
    const release = nativeSpecification({ ...inputs, profile: 'r-pre' });
    assert.deepEqual(release, nativeSpecification({ ...inputs, profile: 'r-pre', component: 'full' }));
    assert.ok(release.cases[0].assertions.some(assertion => assertion.selector.procedure === 'native-homebrew'));
    assert.throws(() => nativeSpecification({ ...inputs, profile: 'r-pre', component: 'homebrew' }), { code: 'INPUT' });
    assert.equal(framework.cases[0].executionId, `native-${nativeProducerRole(target, 'framework')}`);
  }
});

test('T-PRD016 six PR producer parts require both exact Mac originals and reject duplicate swapped failed or stale parts', () => {
  const f = fixture('pr', candidate, true);
  const passing = f.passing();
  const result = aggregateNativeReadiness(passing, f.expected);
  assert.equal(result.status, 'Passed');
  assert.equal(result.requiredParts.length, 6);
  assert.equal(result.requiredCases.length, 7);
  assert.equal(aggregateNativeReadiness(passing.slice(0, -1), f.expected).status, 'NotRun');
  assert.equal(aggregateNativeReadiness([...passing, passing[2]], f.expected).status, 'NotRun');
  const swapped = [...passing];
  swapped[2] = { ...passing[2], component: 'homebrew' };
  assert.equal(aggregateNativeReadiness(swapped, f.expected).status, 'NotRun');
  const index = f.lanes.findIndex(lane => lane.component === 'homebrew');
  assert.throws(() => f.evaluate(f.lanes[index], raw => {
    raw.context.jobRef = `native-${f.lanes[index].target}-framework`;
  }), { code: 'EVIDENCE', message: 'Case execution owner/location/checkpoint differs from the expected producer' });
  for (const mutate of [
    raw => { raw.context.sources[0].revision = 'b'.repeat(40); },
    raw => { raw.context.producer.attemptRef = '2'; },
    raw => { raw.context.artifacts[0].sha256 = 'f'.repeat(64); },
    raw => { raw.results[0].status = 'Skipped'; raw.results[0].expectedMet = null; },
    raw => { raw.results[0].status = 'Failed'; raw.results[0].expectedMet = false;
      raw.results[0].exitCode = 1; raw.exitCode = 1; },
  ]) {
    const changed = [...passing];
    changed[index] = { ...passing[index], evaluation: f.evaluate(f.lanes[index], mutate) };
    assert.equal(aggregateNativeReadiness(changed, f.expected).status, 'NotRun');
  }
});

test('T-PRD016 twenty-five native shard selections preserve complete root unions and require both actual Intel unit origins', async t => {
  const f = await observerApiFixture(t, { frameworkShards: true });
  assert.equal(f.parts.size, 25);
  const request = { target: 'linux-x64', profile: 'pr', component: 'framework', shard: 'units',
    candidateDir: '.test-data/shard-candidate', evidenceDir: '.test-data/shard-evidence' };
  const environment = { EXPECTED_SOURCE_COMMIT: f.revisions.merge,
    EXPECTED_DESCRIPTOR_SHA256: 'a'.repeat(64), EXPECTED_CHECKSUMS_SHA256: 'b'.repeat(64) };
  assert.equal(validateNativeRequest(request, environment).shard, 'units');
  for (const delta of [{ shard: 'body-4' }, { shard: '' }, { component: 'full' },
    { component: 'homebrew' }, { profile: 'r-pre' }, { phase: 'candidate' }, { buildCandidate: true }]) {
    assert.throws(() => validateNativeRequest({ ...request, ...delta }, environment), { code: 'INPUT' });
  }
  assert.equal(parseNativeOptions(['--framework-shard', 'body-1']).shard, 'body-1');
  assert.equal(validateNativeRequest({ ...request, shard: 'body-3' }, environment).shard, 'body-3');
  for (const shardProtocol of [nativeLegacyFrameworkShardProtocol, nativePlatformUnitFrameworkShardProtocol]) {
    assert.throws(() => nativeSpecification({ plan: f.source.plan, inventory: f.source.inventory,
      goSources: f.source.goSources, target: 'linux-x64', profile: 'pr',
      component: 'framework', shard: 'body-3', shardProtocol }), { code: 'INPUT' });
  }
  for (const target of targets) {
    const assignment = nativeFrameworkShardPlan({ inventory: f.source.inventory, plan: f.source.plan, target });
    const selected = assignment.parts.flatMap(part => part.assertionIds);
    assert.deepEqual([...selected].sort(), f.source.inventory.cases.map(test => test.id).sort());
    assert.equal(new Set(selected).size, selected.length);
    assert.equal(assignment.parts.filter(part => part.go).length, 1);
    assert.equal(assignment.parts.find(part => part.shard === 'refresh').assertionIds.length, 1);
    assert.equal(assignment.parts.length, target === 'macos-arm64' ? 5 : 6);
    assert.ok(assignment.parts.filter(part => part.shard.startsWith('body-')).every(part => part.assertionIds.length));
    const unitShards = nativeFrameworkUnitShardNames(target);
    assert.ok(assignment.parts.every(part => digest(part.prerequisites) === digest(unitShards.includes(part.shard) ?
      [] : unitShards.map(shard => nativeProducerRole(target, 'framework', shard)))));
    const unitParts = assignment.parts.filter(part => unitShards.includes(part.shard));
    const stageSelection = nativeStageSelections(f.source.inventory, f.source.plan);
    assert.deepEqual(unitParts.flatMap(part => part.stages.filter(stage => stage.name === 'unit'))
      .flatMap(stage => stage.cases.map(test => test.id)),
    stageSelection.find(stage => stage.name === 'unit').cases.map(test => test.id),
    'Canonical assertions execute once, on the original units producer');
    assert.deepEqual(unitParts.flatMap(part => part.stages.filter(stage => stage.name === 'required-units'))
      .flatMap(stage => stage.cases.map(test => test.id)).sort(),
    stageSelection.find(stage => stage.name === 'required-units').cases.map(test => test.id).sort());
    assert.ok(unitParts.every(part => part.stages.every(stage => stage.cases.length > 0)));
    const fourBody = nativeFrameworkShardPlan({ inventory: f.source.inventory, plan: f.source.plan,
      target, protocol: nativeFourBodyFrameworkShardProtocol });
    assert.deepEqual(fourBody.parts.filter(part => part.shard !== 'units').map(part => part.assertionIds),
      assignment.parts.filter(part => !unitShards.includes(part.shard)).map(part => part.assertionIds),
      'The new unit host does not move regression roots or change the refresh boundary');
    const global = nativeFrameworkShardPlan({ inventory: f.source.inventory, plan: f.source.plan,
      target, protocol: nativeLegacyFrameworkShardProtocol });
    const previous = nativeFrameworkShardPlan({ inventory: f.source.inventory, plan: f.source.plan,
      target, protocol: nativePlatformUnitFrameworkShardProtocol });
    assert.notEqual(global.digest, assignment.digest);
    assert.deepEqual(global.parts.map(part => part.assertionIds), previous.parts.map(part => part.assertionIds));
    assert.equal(previous.parts.length, target.startsWith('macos-') ? 5 : 4);
    assert.deepEqual(global.parts.flatMap(part => part.assertionIds).sort(), [...selected].sort());
    assert.ok(previous.parts.every(part => digest(part.prerequisites) === digest(part.shard === 'units' ?
      [] : [nativeProducerRole(target, 'framework', 'units')])));
    assert.ok(global.parts.filter(part => part.shard !== 'units').every(part => part.prerequisites.length === 4));
  }
  const executions = [...f.parts.values()].map(part => ({
    target: part.target, component: part.component, shard: part.shard, context: part.context,
    job: f.jobs.find(job => job.name === `native-${part.role}`),
  }));
  const unitOrder = verifyNativeShardUnitOrder(executions);
  const evaluations = [...f.parts.values()].map(part => {
    const raw = part.data.get('execution.json');
    const report = normalizeExecutionReport(raw, part.context, input => ({
      verifierId: 'controlled-shard-origin', reportDigest: input.reportDigest, context: part.context,
      sourceTime: raw.observedAt, sourceSequence: raw.sequence,
    }));
    return { target: part.target, component: part.component, shard: part.shard,
      evaluation: evaluateReadiness(part.specification, [report], {
        profile: part.specification.profile, executions: [{ id: part.context.jobRef, context: part.context }],
        now: new Date(Date.parse(raw.observedAt) + 1000).toISOString(),
        policy: { maxAgeMs: 86400000, revisionPolicy: 'exact', verifierIds: ['controlled-shard-origin'] },
      }) };
  });
  const expected = { profile: 'pr', components: true, frameworkShards: true,
    sourceRevision: f.revisions.merge, artifacts: nativeArtifacts(f.candidate), executions,
    inventory: f.source.inventory, plan: f.source.plan, goSources: f.source.goSources, unitOrder };
  assert.equal(aggregateNativeReadiness(evaluations, expected).status, 'Passed');
  assert.equal(unitOrder.protocol, nativeFrameworkShardProtocol);
  assert.equal(aggregateNativeReadiness(evaluations, expected).requiredCases.length, 7);
  assert.equal(aggregateNativeReadiness(evaluations.slice(0, -1), expected).status, 'NotRun');
  assert.equal(aggregateNativeReadiness([...evaluations, evaluations[0]], expected).status, 'NotRun');
  const swapped = [...evaluations];
  swapped[1] = { ...swapped[1], shard: 'units' };
  assert.equal(aggregateNativeReadiness(swapped, expected).status, 'NotRun');
  assert.throws(() => aggregateNativeReadiness(evaluations,
    { ...expected, unitOrder: JSON.parse(JSON.stringify(unitOrder)) }), { code: 'EVIDENCE' });
  assert.throws(() => verifyNativeShardUnitOrder(executions, { protocol: nativeLegacyFrameworkShardProtocol }),
    { code: 'EVIDENCE' });
  assert.throws(() => verifyNativeShardUnitOrder(executions, { protocol: nativePlatformUnitFrameworkShardProtocol }),
    { code: 'EVIDENCE' });
  assert.throws(() => aggregateNativeReadiness(evaluations, { ...expected,
    shardProtocol: nativePlatformUnitFrameworkShardProtocol }),
    { code: 'INPUT' });
  const staggered = executions.map(part => ({ ...part, job: structuredClone(part.job) }));
  const intelUnit = staggered.find(part => part.target === 'macos-x64' && part.shard === 'units');
  intelUnit.job.completed_at = '2026-10-18T10:01:50.000Z';
  for (const part of staggered.filter(part => part.target === 'macos-x64' &&
    part.shard && !nativeFrameworkUnitShardNames(part.target).includes(part.shard))) {
    part.job.started_at = '2026-10-18T10:02:00.000Z';
  }
  assert.equal(verifyNativeShardUnitOrder(staggered).protocol, nativeFrameworkShardProtocol);
  assert.throws(() => verifyNativeShardUnitOrder(staggered, { protocol: nativeLegacyFrameworkShardProtocol }),
    { code: 'EVIDENCE' });
  intelUnit.job.status = 'in_progress';
  assert.throws(() => verifyNativeShardUnitOrder(staggered), { code: 'EVIDENCE' });
  const early = executions.map(part => ({ ...part, job: structuredClone(part.job) }));
  early.find(part => part.shard === 'refresh').job.started_at = early[0].job.started_at;
  assert.throws(() => verifyNativeShardUnitOrder(early), { code: 'EVIDENCE' });
  const failed = executions.map(part => ({ ...part, job: structuredClone(part.job) }));
  failed[0].job.conclusion = 'failure';
  assert.throws(() => verifyNativeShardUnitOrder(failed), { code: 'EVIDENCE' });
  failed[0].job.conclusion = 'skipped';
  assert.throws(() => verifyNativeShardUnitOrder(failed), { code: 'EVIDENCE' });
  failed[0].job.conclusion = 'success';
  failed[0].job.run_attempt++;
  assert.throws(() => verifyNativeShardUnitOrder(failed), { code: 'EVIDENCE' });
  assert.throws(() => verifyNativeShardUnitOrder(executions.slice(1)), { code: 'EVIDENCE' });
  assert.throws(() => verifyNativeShardUnitOrder(executions, { protocol: 'unknown' }), { code: 'EVIDENCE' });
  const duplicateJobs = executions.map(part => ({ ...part, job: structuredClone(part.job) }));
  duplicateJobs[1].job.id = duplicateJobs[0].job.id;
  assert.throws(() => verifyNativeShardUnitOrder(duplicateJobs), { code: 'EVIDENCE' });
  const intelExtra = executions.find(part => part.target === 'macos-x64' && part.shard === 'units-1');
  for (const mutate of [
    job => { job.conclusion = 'failure'; },
    job => { job.conclusion = 'cancelled'; },
    job => { job.conclusion = 'skipped'; },
    job => { job.run_attempt++; },
    job => { job.run_id++; },
  ]) {
    const changed = executions.map(part => ({ ...part, job: structuredClone(part.job) }));
    mutate(changed.find(part => part.target === 'macos-x64' && part.shard === 'units-1').job);
    assert.throws(() => verifyNativeShardUnitOrder(changed), { code: 'EVIDENCE' });
  }
  const foreign = executions.map(part => ({ ...part, context: structuredClone(part.context) }));
  foreign.find(part => part.target === 'macos-x64' && part.shard === 'units-1')
    .context.sources[0].revision = 'f'.repeat(40);
  assert.throws(() => aggregateNativeReadiness(evaluations, { ...expected, executions: foreign }),
    { code: 'EVIDENCE' });
  for (const shard of ['refresh', 'body-0', 'body-1', 'body-2']) {
    const earlyIntel = executions.map(part => ({ ...part, job: structuredClone(part.job) }));
    earlyIntel.find(part => part.target === 'macos-x64' && part.shard === shard).job.started_at =
      new Date(Date.parse(intelExtra.job.completed_at) - 1000).toISOString();
    assert.throws(() => verifyNativeShardUnitOrder(earlyIntel), { code: 'EVIDENCE' },
      `${shard} must wait for the second Intel units producer, not just the original`);
  }
  assert.throws(() => verifyNativeShardUnitOrder(executions.filter(part => part !== intelExtra)), { code: 'EVIDENCE' });
  const extraEvaluation = evaluations.findIndex(part => part.target === 'macos-x64' && part.shard === 'units-1');
  assert.equal(aggregateNativeReadiness(evaluations.filter((_, index) => index !== extraEvaluation),
    expected).status, 'NotRun', 'Six of seven Intel parts cannot pass the logical lane');
  assert.equal(nativePrPartsForProtocol(nativeLegacyFrameworkShardProtocol).length, 20);
  assert.equal(nativePrPartsForProtocol(nativePlatformUnitFrameworkShardProtocol).length, 20);
  assert.equal(nativePrPartsForProtocol(nativeFourBodyFrameworkShardProtocol).length, 24);
  assert.equal(f.calls.length, 0, 'No provider, native toolchain or Python execution is needed for this controlled proof');
});

test('T-PRD016 split native units execute disjoint complete root closures with real isolated Node workers', async t => {
  const f = await observerApiFixture(t, { frameworkShards: true });
  const sourceFiles = [...f.source.files].map(([file, contents]) => ({ file, contents: contents.replace(
    'throw new Error("candidate test source must never execute in the trusted observer");', '') }));
  const extended = sourceFiles.filter(source => /observer-(?:critical|unplanned)\.unit\.test\.mjs$/u.test(source.file));
  const firstRoot = f.source.names.find(test => test.file === extended[0].file).name;
  extended[0].contents = `export const validationDeclarations=${JSON.stringify({ schemaVersion: 1, groups: [
    { root: firstRoot, exclusiveResources: ['owned-unit-fixture'] },
    { root: 'dependent unit root', dependsOn: [firstRoot], exclusiveResources: ['owned-unit-fixture'] },
  ] })};\nimport test from 'node:test';import assert from 'node:assert/strict';\n` +
    `test(${JSON.stringify(firstRoot)},async t=>{await t.test('complete child',()=>assert.equal(2+2,4));});\n` +
    "test('dependent unit root',()=>assert.equal(3+3,6));\n";
  const testPaths = new Set(validationSourcePaths(sourceFiles.map(source => source.file)));
  const inventory = compileValidationSourceInventory({ files: sourceFiles.filter(source => testPaths.has(source.file)),
    surfacePaths: sourceFiles.map(source => source.file) });
  assert.equal(inventory.complete, true, JSON.stringify(inventory.unresolved));
  const assignment = nativeFrameworkShardPlan({ inventory, plan: f.source.plan, target: 'macos-x64' });
  const units = assignment.parts.filter(part => nativeFrameworkUnitShardNames('macos-x64').includes(part.shard));
  const actual = [];
  const target = process.platform === 'win32' ? 'windows-x64' :
    process.platform === 'darwin' ? `macos-${process.arch}` : 'linux-x64';
  for (const part of units) for (const stage of part.stages) {
    for (const file of stage.files) {
      const source = sourceFiles.find(source => source.file === file);
      const destination = path.join(f.root, ...file.split('/'));
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, source.contents.replace(
        'throw new Error("candidate test source must never execute in the trusted observer");', ''));
    }
    const selected = await createPlan(parseOptions(['targeted', '--workers', '2',
      ...(stage.name === 'unit' ? [] : ['--name', stage.selectorName]),
      ...stage.files.map(file => path.join(f.root, ...file.split('/')))]), f.root);
    const reportPath = path.join(f.root, `${part.shard}-${stage.name}.json`);
    assert.equal(await runTests(selected, { reportPath }), 0);
    const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    const journal = await fs.readFile(`${reportPath}.journal.ndjson`, 'utf8');
    validateNativeGroupReport({ inventory, stage, report, journal, target });
    actual.push(...report.executions.filter(row => row.status === 'Passed').map(row =>
      [row.file, row.parents, row.name]));
  }
  const selectedCases = units.flatMap(part => part.stages.flatMap(stage => stage.cases));
  assert.deepEqual(actual.map(digest).sort(),
    selectedCases.map(test => digest([test.file, test.parents, test.name])).sort());
  assert.equal(new Set(actual.map(digest)).size, actual.length);
  assert.ok(actual.some(([, parents, name]) => parents[0] === firstRoot && name === 'complete child'));
  const conflicting = structuredClone(inventory);
  conflicting.groupDeclarations.push({ file: extended[1].file,
    root: f.source.names.find(test => test.file === extended[1].file).name,
    exclusiveResources: ['owned-unit-fixture'] });
  assert.throws(() => nativeFrameworkShardPlan({ inventory: conflicting,
    plan: f.source.plan, target: 'macos-x64' }), { code: 'INVENTORY' },
  'Cross-host shared exclusive resources must be rejected rather than split');
});

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
      raw => { raw.context.native.toolchain.node = '22.23.3'; },
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
  return { complete: true, exitCode: 0, platform: 'linux', architecture: 'x64', node: `v${nativeToolchain.node}`, stdout: [
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

test('T-PRD018 native readiness persistence retains large paged failure bundles without whole-container sanitizer limits', async t => {
  const f = fixture();
  const lane = f.lanes[0];
  const largeInventory = { ...inventory, cases: Array.from({ length: 1800 }, (_, index) => ({
    ...inventory.cases[0], id: `native-large-${index}`, name: `native incomplete assertion ${index}`,
  })) };
  const specification = nativeSpecification({ plan, inventory: largeInventory, goSources: sources,
    target: lane.target, profile: 'pr' });
  const context = { ...lane.context, inventoryDigest: validationInventoryDigest(specification) };
  const directory = path.join(repositoryRoot, '.test-data', `native-partial-large-${randomUUID()}`);
  await fs.mkdir(directory, { recursive: true });
  t.after(async () => {
    assert.equal(path.dirname(directory), path.join(repositoryRoot, '.test-data'));
    await fs.rm(directory, { recursive: true });
    await assert.rejects(fs.stat(directory), { code: 'ENOENT' });
  });
  const raw = f.report({ ...lane, context, specification }, report => {
    report.complete = false;
    report.finishedAt = null;
    report.exitCode = 2;
  });
  const evaluation = evaluateNativeExecution(specification, raw);
  const file = path.join(directory, 'readiness-bundle.json');
  await writeNativeReadinessBundle(file, evaluation);
  assert.equal(evaluation.status, 'NotRun');
  const bundle = JSON.parse(await fs.readFile(file, 'utf8'));
  const original = bundle.objects.find(object => object.value.kind === 'execution-bytes').value;
  assert.equal(original.sha256, digest(raw));
  assert.deepEqual(JSON.parse(Buffer.from(original.content, 'base64').toString('utf8')), raw);
  const replayed = readEvidenceBundle(bundle, { specification,
    context: requireReadinessEvaluation(evaluation).context });
  assert.equal(replayed.evaluation.status, 'NotRun');
  assert.equal(replayed.evaluation.cases[0].assertions.length, specification.cases[0].assertions.length);
  await assert.rejects(writeNativeReadinessBundle(file, evaluation), { code: 'EEXIST' });
});

test('T-PRD018 native Homebrew CLI failures retain structured diagnostics without unsafe stack output', async t => {
  const directory = path.join(repositoryRoot, '.test-data', `native-cli-error-${randomUUID()}`);
  await fs.mkdir(directory, { recursive: true });
  t.after(async () => {
    assert.equal(path.dirname(directory), path.join(repositoryRoot, '.test-data'));
    await fs.rm(directory, { recursive: true });
    await assert.rejects(fs.stat(directory), { code: 'ENOENT' });
  });
  const report = await executeValidationCommand({ name: 'homebrew-cli-error', command: process.execPath,
    args: [path.join(repositoryRoot, 'scripts', 'native-validation.mjs'), 'homebrew',
      '--unsupported-option', 'fixture'], outputDir: directory });
  assert.equal(report.complete, true, JSON.stringify({ diagnostic: report.diagnostic, causes: report.causes }));
  assert.equal(report.exitCode, 1);
  const diagnostic = JSON.parse(report.stderr);
  assert.equal(diagnostic.code, 'INPUT');
  assert.equal(diagnostic.message, 'Unknown or repeated native option');
  assert.equal(report.cleanup.requested, false);
  assert.deepEqual(report.causes, []);
});

test('T-PRD018 Homebrew command evidence omits inline source while preserving its identity and actual execution', async t => {
  const directory = await fs.mkdtemp(path.join(repositoryRoot, '.test-data', 'homebrew-inline-'));
  t.after(() => fs.rm(directory, { recursive: true }));
  const source = 'JSON.stringify({platform:process.platform,arch:process.arch,major:Number(process.versions.node.split(".")[0])})';
  const expected = `[inline source omitted; sha256=${digest(source)}; bytes=${Buffer.byteLength(source)}]`;
  assert.throws(() => sanitizeExecutionPayload(Buffer.from(JSON.stringify({
    command: process.execPath, args: ['-p', source],
  }))), { code: 'UNSAFE' });
  for (const flag of ['--eval', '-e', '--print', '-p', '-c']) {
    assert.deepEqual(validationCommandArguments([flag, source, '--version']), [flag, expected, '--version']);
  }
  const report = await executeValidationCommand({ name: 'homebrew-inline', command: process.execPath,
    args: ['-p', source], outputDir: directory });
  assert.equal(report.complete, true);
  assert.equal(report.exitCode, 0);
  assert.deepEqual(JSON.parse(report.stdout), { platform: process.platform, arch: process.arch,
    major: Number(process.versions.node.split('.')[0]) });
  assert.deepEqual(report.command, [process.execPath, '-p', expected]);
  await writeNativeHomebrewReport(directory, { nativeValidation: 'Failed', stage: 'lifecycle',
    evidence: { passed: false, commands: [{ command: process.execPath,
      args: validationCommandArguments(['-p', source]), success: true, stdout: report.stdout }] } });
  const retained = JSON.parse(await fs.readFile(path.join(directory, 'native-homebrew.json'), 'utf8'));
  assert.equal(retained.nativeValidation, 'Failed');
  assert.deepEqual(retained.evidence.commands[0].args, ['-p', expected]);
});

test('T-PRD018 Homebrew report rejection preserves the primary failure and safe stage without false passing credit', async t => {
  for (const kind of ['unsafe', 'capacity']) {
    const directory = await fs.mkdtemp(path.join(repositoryRoot, '.test-data', 'homebrew-retention-'));
    t.after(() => fs.rm(directory, { recursive: true }));
    const primary = Object.assign(new Error('Homebrew lifecycle command failed'), { code: 'BREW_FAILED' });
    const evidence = kind === 'unsafe' ? { stderr: 'unsupported({ password: "owned-fixture-secret" })' } :
      { commands: Array.from({ length: 66000 }, () => ({ success: true })) };
    await assert.rejects(writeNativeHomebrewReport(directory,
      { nativeValidation: 'Failed', stage: 'lifecycle', evidence }, primary), error => error === primary);
    const bytes = await fs.readFile(path.join(directory, 'native-homebrew.json'));
    const retained = JSON.parse(bytes);
    assert.equal(retained.nativeValidation, 'NotRun');
    assert.equal(retained.stage, 'lifecycle');
    assert.equal(retained.diagnostic.code, 'BREW_FAILED');
    assert.equal(retained.diagnostic.message, primary.message);
    assert.equal(retained.diagnostic.original.sha256, digest(primary.message));
    assert.equal(retained.retentionDiagnostic.code, kind === 'unsafe' ? 'UNSAFE' : 'CAPACITY');
    assert.deepEqual(retained.original, { sha256: digest(JSON.stringify({
      nativeValidation: 'Failed', stage: 'lifecycle', evidence, observedAt: retained.observedAt,
    })), bytes: Buffer.byteLength(JSON.stringify({
      nativeValidation: 'Failed', stage: 'lifecycle', evidence, observedAt: retained.observedAt,
    })) });
    assert.ok(bytes.length < 2000);
    assert.ok(!bytes.includes(Buffer.from('owned-fixture-secret')));
  }
});

test('T-PRD018 unretainable successful Homebrew evidence fails explicitly and cannot replace an original report', async t => {
  const directory = await fs.mkdtemp(path.join(repositoryRoot, '.test-data', 'homebrew-success-retention-'));
  t.after(() => fs.rm(directory, { recursive: true }));
  await assert.rejects(writeNativeHomebrewReport(directory, { nativeValidation: 'Passed',
    evidence: { stdout: 'JSON.stringify({platform:process.platform,arch:process.arch,major:Number(process.versions.node.split(".")[0])})' } }),
  { code: 'UNSAFE' });
  const original = await fs.readFile(path.join(directory, 'native-homebrew.json'));
  const report = JSON.parse(original);
  assert.equal(report.nativeValidation, 'NotRun');
  assert.equal(report.stage, 'evidence-retention');
  assert.equal(report.diagnostic.code, 'UNSAFE');
  await assert.rejects(writeNativeHomebrewReport(directory, { nativeValidation: 'Passed' }), { code: 'EEXIST' });
  assert.deepEqual(await fs.readFile(path.join(directory, 'native-homebrew.json')), original);
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
