import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { canonical, digest } from '../src/core.mjs';
import { testSpecificationDigest } from '../src/artifacts.mjs';
import { prepareCoverage, renderCoverageSection } from '../src/coverage.mjs';
import { normalizeExecutionReport, evaluateReadiness, createEvidenceBundle,
  validateExecutionContext, validationInventoryDigest } from 'ai-sdlc-framework/evidence';
import { zip, readZip, canonical as releaseCanonical } from '../packaging/standalone/archive.mjs';
import { renderManifests } from '../packaging/winget/generate.mjs';
import { renderChecksums } from '../scripts/package-platforms.mjs';
import { archiveRecord } from '../scripts/release-bundle.mjs';
import { compileValidationSourceInventory, validationPlatforms, validationSourcePaths } from '../scripts/validation-inventory.mjs';
import { nativeSpecification, nativeConfigurationDigest, nativeArtifacts, nativeGoObservations,
  nativeWorkflowContract, nativeStageSelections, nativeProducerRole } from '../scripts/native-validation.mjs';
import { nativeLegacyPrParts, nativeFrameworkShardPlan, nativeFrameworkShardProtocol,
  nativeLegacyFrameworkShardProtocol, nativePartJobKey, nativePrPartsForProtocol } from '../scripts/native-validation.mjs';
import { nativeResourceFacts, nativeFrameworkUnitShardNames } from '../scripts/native-validation.mjs';
import { repositoryRoot, unitFiles } from '../scripts/test-runner.mjs';
import { createReadinessGitHubClient } from '../scripts/github-readiness-host.mjs';
import { createPrReadinessHost, statusConcurrencyGroup } from '../scripts/pr-observer.mjs';
import { calculatorFiles, calculatorSelection, calculatorCommandArguments } from '../scripts/pr-calculator.mjs';
import { validationExecutionGroups, validationGroupProtocol, validationSchedulingPolicyDigest } from '../scripts/test-scheduling.mjs';
import { nativeToolchain, homebrewToolchain } from '../scripts/toolchain-baseline.mjs';
import { nativeBootstrapCapability, nativeSdkRequirements, nativeBootstrapRequirements } from '../scripts/native-bootstrap-capability.mjs';

const repository = 'urmich/ai-sdlc-framework';
const repositoryId = 17;
const writerId = 42;
const runId = 101;
const toolDirectory = 'tools-11111111-1111-4111-8111-111111111111';
const epoch = Date.parse('2026-10-18T10:00:00.000Z');
const at = seconds => new Date(epoch + seconds * 1000).toISOString();
const platforms = { 'linux-x64': 'linux', 'windows-x64': 'win32',
  'macos-arm64': 'darwin', 'macos-x64': 'darwin' };
const labels = { 'linux-x64': 'ubuntu-24.04', 'windows-x64': 'windows-2022',
  'macos-arm64': 'macos-15', 'macos-x64': 'macos-15-intel' };
const locations = { 'linux-x64': 'github-linux-x64', 'windows-x64': 'github-windows-x64',
  'macos-arm64': 'github-macos-arm64', 'macos-x64': 'github-macos-x64' };
const suffixes = { 'linux-x64': 'LX', 'windows-x64': 'WX', 'macos-arm64': 'MA', 'macos-x64': 'MI' };
const reporterPaths = [
  '.github/workflows/ci.yml', 'scripts/native-validation.mjs', 'scripts/native-toolchain.mjs',
  'scripts/native-bootstrap-capability.mjs',
  'scripts/toolchain-baseline.mjs', 'scripts/native-homebrew-prefix.mjs',
  'scripts/validation-tools.mjs', 'scripts/test-runner.mjs', 'scripts/test-worker.mjs',
  'scripts/pr-capabilities.mjs', 'scripts/pr-calculator.mjs', 'scripts/pr-calculator-reporter.mjs',
  'scripts/verify-npm-attestation.mjs', 'scripts/accept-release.mjs', 'scripts/native-components.mjs',
  'scripts/test-profiles.mjs', 'scripts/validation-inventory.mjs', 'src/core.mjs', 'src/evidence.mjs',
  'scripts/workflow-policy.mjs', 'scripts/test-scheduling.mjs',
  'scripts/test-budget.mjs', 'scripts/test-budget-worker.mjs',
  'scripts/test-local-evidence.mjs',
  '.github/release-requirements.txt',
  'src/validation-evidence.mjs', 'src/validation-readiness.mjs', 'src/validation-catalog.mjs', 'src/artifacts.mjs',
];
const checkoutPin = 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262';
const calculatorSources = await Promise.all(calculatorFiles.map(async file => ({
  file, contents: await fs.readFile(path.join(repositoryRoot, ...file.split('/')), 'utf8'),
})));
const calculatorManifest = await fs.readFile(path.join(repositoryRoot, 'test', 'calculator', 'package.json'), 'utf8');

function writerDefinition() {
  return `on: workflow_dispatch
permissions:
  contents: read
  actions: read
  pull-requests: read
  statuses: write
concurrency:
  group: ${statusConcurrencyGroup}
  cancel-in-progress: false
jobs:
  observe:
    steps:
      - uses: ${checkoutPin}
        with:
          ref: \${{ github.event.repository.default_branch }}
          persist-credentials: false
`;
}

function sourceTree(files) {
  const blobs = new Map();
  const tree = [...files].sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([file, contents]) => {
      const bytes = Buffer.from(contents);
      const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      blobs.set(sha, { sha, size: bytes.length, encoding: 'base64', content: bytes.toString('base64') });
      return { path: file, type: 'blob', mode: '100644', sha, size: bytes.length };
    });
  return { files, blobs, tree, sha: createHash('sha1').update(canonical(tree)).digest('hex') };
}

function planCase(id, overrides = {}) {
  return { id, requirements: ['FR-203'], conditions: ['AC-203.4'], environment: 'local',
    level: 'integration', checkpoint: 'post-review', mode: 'automated', owner: 'provider',
    location: 'github-linux-x64', expected: 'Complete original assertions match this exact controlled provider fixture.',
    implementation: 'procedure: controlled-native-provider-fixture', status: 'NotRun', ...overrides };
}

function fixturePlan(names, additionalTests = []) {
  assert.ok(Array.isArray(additionalTests) && additionalTests.length <= 32 &&
    additionalTests.every(test => test && Object.getPrototypeOf(test) === Object.prototype &&
      typeof test.id === 'string' && /^T-[A-Z0-9]+(?:-[A-Z0-9]+)*$/u.test(test.id)) &&
    Buffer.byteLength(JSON.stringify(additionalTests)) <= 64 * 1024,
  'Additional replay tests must be a bounded plain canonical test-definition array');
  const tests = [
    ...names.map(({ id, file, name, stage, level }) => planCase(id, {
      checkpoint: 'post-review', level: level ?? (stage === 'regression' ? 'integration' : 'unit'),
      owner: 'provider', location: 'github-pr-matrix', implementation: `${file}#${name}`,
    })),
    ...validationPlatforms.flatMap(target => [
      planCase(`T-PRD014-${suffixes[target]}`, { location: locations[target] }),
      planCase(`T-PRD079-${suffixes[target]}`, { location: locations[target] }),
      ...(target.startsWith('macos-') ?
        [planCase(`T-PRD060-${suffixes[target]}`, { location: locations[target] })] : []),
    ]),
    planCase('T-PRD087'),
    ...structuredClone(additionalTests),
  ];
  assert.equal(new Set(tests.map(test => test.id)).size, tests.length,
    'Additional replay tests cannot replace or duplicate an original fixture definition');
  return JSON.stringify({ tests });
}

function fixtureSources(ci, { unadoptedReporter = false, unadoptedAssertion = false, docsOnly = false,
  narrowedRequiredScope = false, additionalTests = [], producerChange, bootstrapProtocol = null } = {}) {
  const names = [
    ...unitFiles.map((file, index) => ({ file, stage: 'unit', id: `T-FIX-CANONICAL-${index + 1}`,
      name: `T-FIX-CANONICAL-${index + 1} controlled canonical assertion` })),
    { file: 'test/observer-critical.unit.test.mjs', stage: 'required-units', id: 'T-FIX-UNIT',
      name: 'T-FIX-UNIT controlled required unit assertion' },
    { file: 'test/observer-unplanned.unit.test.mjs', stage: 'required-units', id: 'T-FIX-UNIT-FAMILY',
      level: 'integration', name: 'T-FIX-UNIT-FAMILY full hosted unit family, absent from local critical units' },
    { file: 'test/distribution-channels.test.mjs', stage: 'regression', id: 'T-FIX-INTEGRATION',
      name: `T-FIX-INTEGRATION controlled frozen lifecycle${unadoptedAssertion ? ' changed' : ''}` },
    { file: 'test/observation-retention-refresh.test.mjs', stage: 'regression', id: 'T-FIX-REFRESH',
      name: 'FR-063/064 real refresh and prune archive superseded observations/facts before exhaustion' },
    { file: 'test/public-readiness-ci.test.mjs', stage: 'regression', id: 'T-FIX-TOOLS',
      name: 'T-PRD015 actual pinned Go, Python schema and static validators execute valid and invalid owned inputs' },
    { file: 'test/observer-shard-body.test.mjs', stage: 'regression', id: 'T-FIX-BODY',
      name: 'T-FIX-BODY controlled independent regression body' },
    { file: 'test/observer-shard-extra.test.mjs', stage: 'regression', id: 'T-FIX-EXTRA',
      name: 'T-FIX-EXTRA controlled fourth independent regression body' },
  ];
  const goSources = [
    { file: 'main_test.go', contents: 'package main\nimport "testing"\n' +
      'const validationMainInventory = `{"schemaVersion":1,"tests":{"TestContract":["minimum"]}}`\n' +
      'func TestContract(t *testing.T) {}\n' },
    { file: 'integrity_test.go', contents: 'package main\nimport "testing"\n' +
      'const validationIntegrityInventory = `{"schemaVersion":1,"tests":{"TestIntegrity":[]}}`\n' +
      'func TestIntegrity(t *testing.T) {}\n' },
  ];
  const files = new Map(reporterPaths.map(file => [file,
    file.endsWith('.yml') ? ci : 'throw new Error("candidate reporter must never execute in the observer");\n']));
  files.set('scripts/toolchain-baseline.mjs',
    `${files.get('scripts/toolchain-baseline.mjs')}export const nativeToolchain = ${JSON.stringify(nativeToolchain)};\n` +
    `export const homebrewToolchain = ${JSON.stringify(homebrewToolchain)};\n`);
  if (bootstrapProtocol !== null) files.set('scripts/toolchain-baseline.mjs',
    `${files.get('scripts/toolchain-baseline.mjs')}export const nativeBootstrapProtocol = '${bootstrapProtocol}';\n`);
  files.set('.github/workflows/pr-readiness.yml', writerDefinition());
  files.set('.github/workflows/coverage-metadata.yml', writerDefinition());
  for (const { file, contents } of calculatorSources) files.set(file, contents);
  files.set('test/calculator/package.json', calculatorManifest);
  for (const source of goSources) files.set(`cmd/sdlc-launcher/${source.file}`, source.contents);
  const surfaces = [...files.keys()].filter(file => /^(?:src|scripts|cmd)\//u.test(file));
  for (const [index, { id, file, name }] of names.entries()) {
    files.set(file, `export const validationDeclarations = ${JSON.stringify({
      schemaVersion: 1,
      ...(index === 0 ? { surfaces: [{ coverage: 'fixture-only', paths: surfaces }],
        projects: [{ root: 'test/calculator', files: calculatorFiles, coverage: 'fixture-only',
          owner: 'controlled-observer-fixture', reason: 'Independent namespace; not framework assertion credit',
          command: ['node', '--test', 'test/*.test.js'], prerequisites: ['Owned calculator assets'] }] } : {}),
      plannedCases: [{ id, selectors: [{ name, parents: [] }] }],
    })};\n` +
      'import test from "node:test";\n' +
      'throw new Error("candidate test source must never execute in the trusted observer");\n' +
      `test(${JSON.stringify(name)},()=>{});\n`);
  }
  if (unadoptedReporter) files.set('scripts/test-worker.mjs',
    `${files.get('scripts/test-worker.mjs')}// unadopted producer modification\n`);
  if (producerChange === 'prefix-helper') {
    files.set('scripts/native-homebrew-prefix.mjs',
      `${files.get('scripts/native-homebrew-prefix.mjs')}// changed ownership enforcement\n`);
  } else if (producerChange === 'core-pin') {
    const original = files.get('scripts/toolchain-baseline.mjs');
    const changed = original.replace(homebrewToolchain.coreCommit, 'f'.repeat(40));
    assert.notEqual(changed, original);
    files.set('scripts/toolchain-baseline.mjs', changed);
  } else assert.equal(producerChange, undefined);
  const requirements = '# Requirements\n\n### FR-203: Complete native provider evidence\n\n' +
    (narrowedRequiredScope ? 'Classification: out-of-scope\n\n' : '') +
    '**Definition of Done**\n\n- AC-203.4: Admit only the complete current controlled provider inventory.\n';
  const plan = fixturePlan(names, additionalTests);
  files.set('docs/sdlc/public-readiness/requirements.md', requirements);
  files.set('docs/sdlc/public-readiness/test-plan.md', plan);
  files.set('docs/observer-controlled.md', docsOnly ? '# Actual candidate Markdown delta\n' : '# Adopted Markdown\n');
  const inventory = compileValidationSourceInventory({
    files: validationSourcePaths([...files.keys()]).map(file => ({ file, contents: files.get(file) })),
    surfacePaths: [...files.keys()],
  });
  assert.equal(inventory.complete, true, JSON.stringify(inventory.unresolved));
  return { ...sourceTree(files), inventory, goSources, names, requirements, plan };
}

function candidateData(sourceCommit, version = '1.2.3', includePrevious = true) {
  // Stable fixture metadata exposes real uppercase WinGet names; no release is built or published.
  const assets = [
    [`ai-sdlc-framework-${version}.tgz`, Buffer.from('opaque controlled npm fixture; never execute')],
    [`ai-sdlc-framework-${version}-macos.tar.gz`, Buffer.from('one shared controlled Mac fixture; never execute')],
    [`ai-sdlc-framework-${version}-windows-x64.zip`, Buffer.from('opaque controlled Windows fixture; never execute')],
  ];
  const records = assets.map(([filename, bytes]) => ({
    filename, kind: 'archive', sha256: digest(bytes), size: bytes.length,
  }));
  const mac = records.find(file => file.filename.endsWith('-macos.tar.gz'));
  const stableFormula = 'class AiSdlcFramework < Formula\n' +
    `  url "https://github.com/${repository}/releases/download/v${version}/${mac.filename}"\n` +
    `  sha256 "${mac.sha256}"\n  depends_on :macos\n  depends_on "${homebrewToolchain.formula}"\nend\n`;
  assets.push(['ai-sdlc-framework.rb', Buffer.from(stableFormula)]);
  records.push({ filename: 'ai-sdlc-framework.rb', kind: 'homebrew', sha256: digest(stableFormula),
    size: Buffer.byteLength(stableFormula) });
  for (const { content, ...metadata } of renderManifests({ version, releaseRepository: repository,
    archive: records.find(file => file.filename.endsWith('-windows-x64.zip')) })) {
    assets.push([metadata.filename, Buffer.from(content)]);
    records.push(metadata);
  }
  const payload = records.find(file => file.filename.endsWith('.tgz'));
  records.sort((left, right) => left.filename < right.filename ? -1 : left.filename > right.filename ? 1 : 0);
  const descriptor = { schemaVersion: 1, name: 'ai-sdlc-framework', version, sourceCommit,
    payload: { filename: payload.filename, sha256: payload.sha256,
      inventoryDigest: digest('controlled fixture payload inventory') }, files: records };
  const descriptorBytes = releaseCanonical(descriptor);
  const checksumBytes = renderChecksums(descriptor, descriptorBytes);
  const context = { schemaVersion: 1, releaseRepository: repository, prerelease: false,
    identity: { sourceCommit, version, payloadSha256: descriptor.payload.sha256,
      descriptorSha256: digest(descriptorBytes), checksumsSha256: digest(checksumBytes) },
    homebrew: { status: 'Generated' } };
  if (includePrevious) {
    const previous = candidateData('e'.repeat(40), '0.3.0', false);
    context.previousRelease = { repository, version: previous.candidate.context.identity.version,
      descriptorSha256: previous.candidate.context.identity.descriptorSha256,
      checksumsSha256: previous.candidate.context.identity.checksumsSha256 };
  }
  return { candidate: { context, descriptor }, entries: new Map([
    ['context.json', Buffer.from(releaseCanonical(context))],
    ['assets/release-descriptor.json', Buffer.from(descriptorBytes)],
    ['assets/SHA256SUMS', Buffer.from(checksumBytes)],
    ...assets.map(([name, bytes]) => [`assets/${name}`, bytes]),
  ]) };
}

export function nativeReplayCandidateFixture({ sourceCommit = 'c'.repeat(40), version = '1.2.3' } = {}) {
  return candidateData(sourceCommit, version);
}

export function nativeReplayPreviousFixture() {
  const previous = candidateData('e'.repeat(40), '0.3.0', false);
  return { descriptor: previous.candidate.descriptor, identity: previous.candidate.context.identity,
    checksums: previous.entries.get('assets/SHA256SUMS').toString('utf8') };
}

function homebrewData(candidate, targetArch, previousMetadata = nativeReplayPreviousFixture(), clock = at) {
  const archive = archiveRecord(candidate, `macos-${targetArch}`);
  const previousArchive = archiveRecord({ descriptor: previousMetadata.descriptor }, `macos-${targetArch}`);
  const candidateBaseUrl = 'http://127.0.0.1:8765/';
  const contents = '# Test-only local candidate; never publish to the stable tap.\n' +
    `class AiSdlcFramework < Formula\n  url "${candidateBaseUrl}${archive.filename}"\n` +
    `  version "${candidate.descriptor.version}" if version.to_s != "${candidate.descriptor.version}"\n` +
    `  sha256 "${archive.sha256}"\n  depends_on :macos\n  depends_on "${homebrewToolchain.formula}"\nend\n`;
  const brew = '/controlled-fixture/isolated/bin/brew';
  const style = { status: 'Passed', exitCode: 0, args: ['style', '/controlled-fixture/Formula/ai-sdlc-framework.rb'] };
  const audit = { status: 'Passed', exitCode: 0, args: ['audit', '--strict', '--formula', '--os=macos',
    `--arch=${targetArch === 'x64' ? 'intel' : 'arm'}`, 'local/sdlc-quality-abcdef/ai-sdlc-framework'] };
  return { nativeValidation: 'Passed', observedAt: clock(55),
    previousMetadata: { descriptor: previousMetadata.descriptor, checksums: previousMetadata.checksums },
    formula: { contents, candidateBaseUrl },
    quality: { validation: 'Passed', identity: candidate.context.identity, targetArch, mode: 'candidate',
      formula: { filename: 'ai-sdlc-framework.rb', kind: 'homebrew', sha256: digest(contents),
        size: Buffer.byteLength(contents) },
      nodeDependency: { validation: 'Passed', formula: homebrewToolchain.formula,
        major: homebrewToolchain.major, scope: 'runtime', conditional: false },
      nativeExecution: 'NotRun', tool: 'Homebrew', brew, brewVersion: 'Homebrew controlled provider fixture',
      style, audit, commands: [style, audit].map(command => ({ command: brew, args: command.args, exitCode: 0 })) },
    evidence: { passed: true, platform: 'darwin', architecture: targetArch,
      uname: targetArch === 'arm64' ? 'arm64' : 'x86_64', sysctlProcTranslated: '0',
      homebrewRuntime: { platform: 'darwin', arch: targetArch, major: homebrewToolchain.major },
      homebrewNodeVersion: nativeToolchain.node,
      upgradeKind: 'version', previousIdentity: previousMetadata.identity,
      currentIdentity: candidate.context.identity,
      archiveInputs: [previousArchive, archive], failedPromotionRetry: {
        passed: true, priorKeg: '/controlled-fixture/old-keg', candidateKeg: '/controlled-fixture/new-keg' },
      commands: [
        ...['install', 'test', 'uninstall', 'link', 'unlink', 'autoremove', 'tab'].map(name => ({
          command: brew, args: [name, 'local/controlled-fixture/ai-sdlc-framework'],
          success: true, noInstallCleanup: '1', homeBeforeSha256: digest('unchanged owned home'),
          homeAfterSha256: digest('unchanged owned home'),
        })),
        { command: '/controlled-fixture/node', args: ['fixture-cli', 'hook', 'sessionStart'], success: true },
        { command: '/controlled-fixture/node', args: ['fixture-cli', 'doctor'], success: true },
      ] } };
}

function commandRecord(name, target, context, args, start, finish, stdout = '', clock = at) {
  return { schemaVersion: 1, kind: 'validation-command', command: ['/controlled-fixture/node', ...args],
    cwd: '/controlled-fixture/source', startedAt: clock(start), finishedAt: clock(finish),
    complete: true, node: `v${nativeToolchain.node}`, platform: platforms[target],
    architecture: target === 'macos-arm64' ? 'arm64' : 'x64',
    context, stdout, stderr: '', exitCode: 0, signal: null, diagnostic: null,
    originalOutput: { stdout: { sha256: digest(stdout), bytes: Buffer.byteLength(stdout) },
      stderr: { sha256: digest(''), bytes: 0 } } };
}

function bundleFromOriginal(raw, specification, independentlyCapturedContext, asOf = at(60)) {
  const bytes = Buffer.from(canonical(raw));
  const normalized = normalizeExecutionReport(bytes, independentlyCapturedContext, input => ({
    verifierId: 'controlled-producer-fixture', reportDigest: input.reportDigest,
    context: independentlyCapturedContext, sourceTime: raw.observedAt, sourceSequence: raw.sequence,
  }));
  const evaluation = evaluateReadiness(specification, [normalized], {
    profile: specification.profile,
    executions: [{ id: independentlyCapturedContext.jobRef, context: independentlyCapturedContext }],
    now: asOf, policy: {
      maxAgeMs: 86400000, revisionPolicy: 'exact', verifierIds: ['controlled-producer-fixture'],
    },
  });
  assert.equal(evaluation.status, 'Passed', JSON.stringify(evaluation.blockers));
  return createEvidenceBundle(evaluation);
}

function laneData(source, candidate, revisions, target, { prNumber = 1, executionId = runId,
  profile = 'pr', releaseIntentId = 'controlled-release-intent', startTime = epoch,
  previousMetadata = nativeReplayPreviousFixture(), component = 'full', shard = null, frameworkShards = false,
  shardProtocol = nativeFrameworkShardProtocol, bootstrapProtocol = null } = {}) {
  const role = nativeProducerRole(target, component, shard);
  const assignment = shard === null ? null : nativeFrameworkShardPlan({
    inventory: source.inventory, plan: source.plan, target, protocol: shardProtocol,
  });
  const part = assignment?.parts.find(part => part.shard === shard);
  const tools = nativeSdkRequirements({ target, profile, component, shard, protocol: bootstrapProtocol });
  const resourcesRequired = nativeBootstrapRequirements({ target, profile, component, shard, protocol: bootstrapProtocol });
  const at = seconds => new Date(startTime + seconds * 1000).toISOString();
  const commandReport = (name, target, context, args, start, finish, stdout = '') =>
    commandRecord(name, target, context, args, start, finish, stdout, at);
  const architecture = target === 'macos-arm64' ? 'arm64' : 'x64';
  const ImageOS = target === 'linux-x64' ? 'ubuntu24' :
    target === 'windows-x64' ? 'win22' : 'macos15';
  const ImageVersion = `controlled-${target}-image-1`;
  const go = `go version go1.27.1 ${{ linux: 'linux', win32: 'windows', darwin: 'darwin' }[platforms[target]]}/${architecture === 'x64' ? 'amd64' : architecture}`;
  const resources = nativeResourceFacts({ availableParallelism: 4, totalMemoryBytes: 8 * 1024 ** 3,
    configuredWorkers: null });
  const bootstrap = { schemaVersion: 1, status: 'Passed', target,
    native: { platform: platforms[target], architecture, node: nativeToolchain.node, go,
      resources,
      os: 'controlled-provider-OS', machine: architecture, imageOS: ImageOS, imageVersion: ImageVersion,
      python: { version: '3.12.10', implementation: 'CPython', executable: '/controlled-fixture/python-base',
        machine: architecture === 'arm64' ? 'arm64' : 'x86_64' },
      schemaPackages: { attrs: '25.4.0', jsonschema: '4.26.0', 'jsonschema-specifications': '2025.9.1',
        PyYAML: '6.0.3', referencing: '0.37.0', 'rpds-py': '0.30.0', typing_extensions: '4.15.0' },
      git: 'git version 2.49.0 controlled fixture',
      executables: { node: '/controlled-fixture/node', go: '/controlled-fixture/go', python: '/controlled-fixture/python' } },
    reports: ['go-root', 'go-version', 'python-identity', 'schema-python-environment',
      'schema-dependency-probe', 'schema-dependencies-install', 'schema-dependencies-verify', 'git-version',
      ...(platforms[target] === 'win32' ? ['powershell-version', 'cmd-version'] : ['bash-version']),
      ...(target.startsWith('macos-') ? ['zsh-version', 'mac-uname', 'brew-git-init', 'brew-git-fetch',
        'brew-git-checkout', 'brew-git-identity', 'brew-prefix', 'brew-repository', 'brew-portable-ruby',
        'brew-ruby-identity', 'brew-ruby-path', 'brew-node-install', 'brew-node-prefix', 'brew-node-identity'] : []),
    ].map(name => ({ name, complete: true, exitCode: name === 'schema-dependency-probe' ? 1 : 0 })),
    cancelled: false };
  if (target.startsWith('macos-')) bootstrap.native.homebrew = {
    commit: homebrewToolchain.commit, ruby: homebrewToolchain.ruby,
    rubyExecutable: `/controlled-fixture/homebrew/Library/Homebrew/vendor/portable-ruby/${homebrewToolchain.ruby}/bin/ruby`,
    node: { version: nativeToolchain.node, platform: 'darwin', arch: architecture },
    nodePrefix: component === 'full' ? `/controlled-fixture/homebrew/opt/${homebrewToolchain.formula}` :
      `/opt/${digest(role).slice(0, 5)}/opt/${homebrewToolchain.formula}`,
    uname: architecture === 'arm64' ? 'arm64' : 'x86_64', translation: '0',
  };
  if (bootstrapProtocol !== null && component === 'framework' && shard !== null) {
    const capability = nativeBootstrapCapability({ target, profile, component, shard, role, protocol: bootstrapProtocol });
    bootstrap.native.bootstrapCapability = capability;
    bootstrap.native.runtimeProvider = { provider: capability.runtimeProvider, executable: bootstrap.native.executables.node,
      version: nativeToolchain.node, platform: platforms[target], architecture };
    if (target.startsWith('macos-')) {
      const prefix = `/opt/${digest(role).slice(0, 5)}`;
      bootstrap.native.homebrew = { commit: homebrewToolchain.commit, coreCommit: homebrewToolchain.coreCommit,
        ruby: homebrewToolchain.ruby,
        rubyExecutable: `${prefix}/Library/Homebrew/vendor/portable-ruby/${homebrewToolchain.ruby}/bin/ruby`,
        prefix, repository: prefix, nodeProvisioned: false, bottlesProvisioned: false,
        uname: architecture === 'arm64' ? 'arm64' : 'x86_64', translation: '0' };
      bootstrap.reports = bootstrap.reports.filter(report => !report.name.startsWith('brew-node-'));
      bootstrap.reports.push({ name: 'brew-core-identity', complete: true, exitCode: 0 });
    }
  }
  const specification = nativeSpecification({ plan: source.plan, inventory: source.inventory,
    goSources: source.goSources, target, profile, component, shard, shardProtocol });
  if (!tools.go) {
    delete bootstrap.native.go;
    delete bootstrap.native.executables.go;
    bootstrap.reports = bootstrap.reports.filter(report => !['go-root', 'go-version'].includes(report.name));
  }
  if (!tools.python) {
    delete bootstrap.native.python;
    delete bootstrap.native.schemaPackages;
    delete bootstrap.native.executables.python;
    bootstrap.reports = bootstrap.reports.filter(report => !/^(?:python-|schema-)/u.test(report.name));
  }
  if (!resourcesRequired.schema) {
    delete bootstrap.native.schemaPackages;
    bootstrap.reports = bootstrap.reports.filter(report => !report.name.startsWith('schema-'));
    if (tools.python) bootstrap.native.executables.python = bootstrap.native.python.executable;
  }
  if (!resourcesRequired.homebrew) {
    delete bootstrap.native.homebrew;
    bootstrap.reports = bootstrap.reports.filter(report => !report.name.startsWith('brew-'));
  }
  const context = validateExecutionContext({
    candidateDigest: digest({ revision: revisions.merge, tree: source.sha }),
    testSpecDigest: testSpecificationDigest(source.plan),
    configDigest: nativeConfigurationDigest({ inventory: source.inventory, profile, target, component, shard, shardProtocol, bootstrapProtocol,
      shardPlanDigest: assignment?.digest ?? null }),
    inventoryDigest: validationInventoryDigest(specification),
    sources: [{ repositoryId: `repository-${repositoryId}`, revision: revisions.merge,
      contentDigest: digest(source.sha) }],
    profile: specification.profile, environment: 'local', location: locations[target],
    mode: 'automated', owner: 'provider',
    native: { kind: 'native', platform: platforms[target], architecture,
      image: `${ImageOS}/${ImageVersion}`, toolchain: {
        node: nativeToolchain.node, ...(tools.go ? { go } : {}),
        ...(tools.python ? { python: 'Python 3.12.10' } : {}), os: 'controlled-provider-OS',
        machine: architecture, git: 'git version 2.49.0 controlled fixture', bootstrap: bootstrap.native,
        resources } },
    producer: { provider: 'github', connection: 'repository-ci', scopeRef: `repository:${repositoryId}`,
      definitionRef: profile === 'pr' ? `${repository}/${nativeWorkflowContract.path}@refs/pull/${prNumber}/merge` :
        `${repository}/.github/workflows/release.yml@refs/heads/main`,
      executionRef: String(executionId), attemptKind: 'known', attemptRef: '1' },
    attemptCapability: 'distinct', jobRef: `native-${role}`, artifacts: nativeArtifacts(candidate),
    ...(profile === 'r-pre' ? { intentId: releaseIntentId } : {}),
  });
  const smallContext = { schemaVersion: 1, sourceCommit: revisions.merge, target, profile,
    ...(component === 'full' ? {} : { component }),
    ...(shard === null ? {} : { frameworkShards: shardProtocol, shard,
      configDigest: context.configDigest, inventoryDigest: context.inventoryDigest }),
    workflowRef: context.producer.definitionRef, repositoryId: `repository-${repositoryId}`,
    runId: String(executionId), attempt: '1' };
  const data = new Map([['toolchain.json', bootstrap]]);
  const observations = new Map();
  const selectedStages = part?.stages ?? nativeStageSelections(source.inventory, source.plan);
  for (const selectedStage of selectedStages) {
    const stage = selectedStage.name;
    const index = nativeWorkflowContract.stages.indexOf(stage);
    const selected = source.names.filter(test => selectedStage.cases.some(assertion =>
      assertion.file === test.file && assertion.name === test.name));
    const { files, args, selectorName } = selectedStage;
    const pattern = stage === 'unit' ? undefined : selectorName;
    const [start, finish] = [[7, 10], [11, 14], [15, 50]][index];
    const expectedGroups = validationExecutionGroups(source.inventory, { files, pattern, preserveOrder: true });
    const concurrency = Math.min(resources.workerCapacity, expectedGroups.length);
    const executions = selected.map(({ file, name }, offset) => {
      const definition = source.inventory.cases.find(test => test.file === file && test.name === name);
      const row = { file, name, parents: [], nameDigest: digest(name), parentDigests: [],
        nesting: 0, line: definition.line, column: definition.column, type: 'test',
        groupId: expectedGroups.find(group => group.assertionIds.includes(definition.id)).id,
        sequence: expectedGroups.length + 4 + offset * 3, status: 'Passed', observedAt: at(finish),
        skipReason: null, todoReason: null, durationMs: 1 };
      observations.set(definition.id, row);
      return row;
    });
    const groups = expectedGroups.map((group, offset) => ({
      ...group, startedAt: at(start), finishedAt: at(finish), status: 'Passed',
      processIds: [2000 + index * 100 + offset],
      summary: { success: true, counts: { tests: group.assertionIds.length,
        passed: group.assertionIds.length, failed: 0, cancelled: 0, skipped: 0, todo: 0, suites: 0 } },
    }));
    data.set(`${stage}.json`, { schemaVersion: 1, profile: stage === 'unit' ? 'unit' : 'targeted',
      files, node: `v${nativeToolchain.node}`, executable: '/controlled-fixture/node',
      command: ['/controlled-fixture/node', '/controlled-fixture/source/scripts/test-runner.mjs', ...args],
      workerCommand: ['/controlled-fixture/node', '/controlled-fixture/source/scripts/test-worker.mjs'],
      platform: platforms[target], architecture, context: stage === 'regression' ? context : smallContext,
      selection: { namePatterns: pattern === undefined ? [] : [pattern], concurrency, coverage: false },
      resources: { availableParallelism: resources.availableParallelism, totalMemoryBytes: resources.totalMemoryBytes,
        fileConcurrency: concurrency, budget: {
          version: 2, allocationPolicy: 'dynamic-ready-worker-tokens-v2',
          id: `22222222-2222-4222-8222-22222222222${index}`,
          capacity: resources.workerCapacity, producerLimit: resources.workerCapacity * 2 + 1,
          controlLimit: resources.workerCapacity * 2 + 1, orchestrationLimit: resources.workerCapacity * 4 + 2,
          residentLimit: resources.workerCapacity * 3, peakActiveWorkers: concurrency,
          peakResidentWorkers: concurrency, peakPotentialResidentWorkers: concurrency,
          peakProducers: 1, peakControls: 1,
        } },
      startedAt: at(start), finishedAt: at(finish), complete: true, exitCode: 0, executions,
      groupExecution: { schemaVersion: 1, protocol: validationGroupProtocol,
        policyDigest: validationSchedulingPolicyDigest(), selectionDigest: digest(expectedGroups), groups },
      diagnostics: [], summary: { success: true, counts: {
        tests: executions.length, cancelled: 0, failed: 0, passed: executions.length,
        suites: 0, skipped: 0, todo: 0 }, durationMs: (finish - start) * 1000 } });
    data.set(`${stage}-command.json`, commandReport(stage, target, stage === 'regression' ? context : smallContext,
      ['scripts/test-runner.mjs', ...args], start, finish));
    data.set(`${stage}.json.journal.ndjson`, [
      { sequence: 1, kind: 'execution-start', observedAt: at(start), profile: stage === 'unit' ? 'unit' : 'targeted',
        files, context: stage === 'regression' ? context : smallContext },
      ...groups.map(group => ({ kind: 'group-start', observedAt: group.startedAt, groupId: group.id,
        rootId: group.rootId, startedAt: group.startedAt, processIds: group.processIds,
        minimumSlots: group.minimumSlots, exclusiveResources: group.exclusiveResources })),
      ...executions.flatMap(row => [
        { sequence: row.sequence - 2, kind: 'registration', observedAt: at(start), file: row.file, name: row.name },
        { sequence: row.sequence - 1, kind: 'start', observedAt: at(start), file: row.file, name: row.name },
        { ...row, kind: 'completion' },
      ]),
      ...groups.map(group => ({ kind: 'group-end', observedAt: group.finishedAt, groupId: group.id,
        rootId: group.rootId, finishedAt: group.finishedAt, processIds: group.processIds,
        status: group.status, summary: group.summary })),
    ].map((event, index) => JSON.stringify({ ...event, sequence: index + 1 })).join('\n') + '\n');
    data.set(`${stage}-command.journal.ndjson`, `${JSON.stringify({ sequence: 1, kind: 'command-end', complete: true })}\n`);
  }
  const goNames = ['TestContract', 'TestContract/minimum', 'TestIntegrity'];
  const stdout = [{ Time: at(31), Action: 'start', Package: 'controlled/launcher' }, ...goNames.flatMap(Test => [
    { Time: at(31), Action: 'run', Test, Package: 'controlled/launcher' },
    { Time: at(32), Action: 'pass', Test, Package: 'controlled/launcher', Elapsed: 0.001 },
  ]), { Time: at(32), Action: 'pass', Package: 'controlled/launcher', Elapsed: 0.003 }]
    .map(event => JSON.stringify(event)).join('\n') + '\n';
  // The worker removes its report-context environment before nested T-PRD015 tool processes run.
  const goReport = commandReport('go-tests', target, null, ['test', '-json', '-count=1', './...'], 31, 32, stdout);
  goReport.command[0] = '/controlled-fixture/go';
  goReport.cwd = '/controlled-fixture/source/cmd/sdlc-launcher';
  data.set(`${toolDirectory}/go-tests.json`, goReport);
  data.set(`${toolDirectory}/go-tests.journal.ndjson`, `${JSON.stringify({ sequence: 1, kind: 'command-end', complete: true })}\n`);
  for (const row of nativeGoObservations(source.goSources, [goReport], target).observations) observations.set(row.id, row);
  data.set('static.json', commandReport('static', target, smallContext, ['scripts/check.mjs'], 14, 14.5));
  const goVersion = commandReport('go-version', target, smallContext, ['version'], 6.1, 6.2, `${go}\n`);
  goVersion.command[0] = bootstrap.native.executables.go;
  const pythonVersion = commandReport('python-version', target, smallContext,
    ['--version'], 6.2, 6.3, 'Python 3.12.10\n');
  pythonVersion.command[0] = bootstrap.native.executables.python;
  if (tools.go) data.set('go-version.json', goVersion);
  if (tools.python) data.set('python-version.json', pythonVersion);
  const calculatorExpected = calculatorSelection(source.inventory);
  const calculatorEvents = calculatorExpected.map(test => ({
    type: 'test:pass', data: { file: `/controlled-fixture/source/${test.file}`,
      name: test.name, nesting: 0, details: { duration_ms: 1 } },
  })).map(event => JSON.stringify(event)).join('\n') + '\n';
  data.set('calculator.json', { schemaVersion: 1, namespace: 'calculator', node: `v${nativeToolchain.node}`,
    platform: platforms[target], architecture, context, command: ['/controlled-fixture/node', ...calculatorCommandArguments],
    selection: calculatorExpected, results: calculatorExpected.map(test => ({
      file: test.file, name: test.name, status: 'Passed', durationMs: 1,
    })), summary: { tests: 11, passed: 11, failed: 0, skipped: 0, cancelled: 0 },
    complete: true, exitCode: 0, startedAt: at(50.1), finishedAt: at(51) });
  data.set('calculator.json.journal.ndjson', calculatorEvents);
  data.set('calculator-command.json', commandReport('calculator', target, context,
    ['scripts/pr-calculator.mjs', '--output', '/controlled-fixture/source/.test-data/native/calculator.json'], 50, 52));
  data.set('calculator-node-command.json', commandReport('calculator-node', target, context,
    [...calculatorCommandArguments], 50.2, 50.9, calculatorEvents));
  if (target === 'linux-x64') data.set('candidate-build.json', commandReport('candidate-build', target, smallContext,
    ['scripts/release-bundle.mjs', 'prepare', '--output-dir', '/controlled-fixture/frozen-candidate',
      '--repository', repository, '--source-commit', revisions.merge], 14.5, 14.7));
  data.set('candidate-verification.json', { artifacts: context.artifacts,
    sourceCommit: revisions.merge, observedAt: at(14.8) });
  for (const [procedure, observedAt] of [['static', at(14.5)], ['calculator', at(51)], ['frozen-artifacts', at(14.8)]]) {
    observations.set(`assertion-${digest(['procedure', procedure])}`, {
      status: 'Passed', observedAt, durationMs: 0, detail: '' });
  }
  if (target.startsWith('macos-') && component !== 'framework') {
    data.set('native-homebrew.json', homebrewData(candidate, architecture, previousMetadata, at));
    data.set('homebrew-command.json', commandReport('homebrew', target, context,
      ['/controlled-fixture/source/scripts/native-validation.mjs', 'homebrew', '--target', target,
        '--profile', profile, '--candidate-dir', '/controlled-fixture/source/.test-data/frozen-candidate',
        '--evidence-dir', `/controlled-fixture/source/.test-data/native-${role}`,
        '--build-candidate', 'false', ...(component === 'full' ? [] : ['--component', component])], 53, 55));
    observations.set(`assertion-${digest(['procedure', 'native-homebrew'])}`, {
      status: 'Passed', observedAt: at(55), durationMs: 0, detail: '' });
  }
  if (profile === 'r-pre' && target === 'windows-x64') {
    data.set('native-previous-current.json', { status: 'Passed', kind: 'frozen-candidate',
      nativePlatform: 'win32', nativeArchitecture: 'x64', publicAcceptance: 'NotRun',
      previousIdentity: previousMetadata.identity, currentIdentity: candidate.context.identity,
      previousMetadata: { descriptor: previousMetadata.descriptor, checksums: previousMetadata.checksums },
      upgradeKind: 'version', observedAt: at(56), shells: ['powershell', 'cmd'].map(shell => ({
        shell, status: 'Passed', upgradeKind: 'version', previousVersion: previousMetadata.identity.version,
        version: candidate.context.identity.version,
      })) });
    const powershell = commandReport('previous-current-1', target, context,
      ['-NoProfile', '-NonInteractive', '-File', '/controlled-fixture/source/.test-data/previous-current/invoke-native.ps1'],
      52, 53);
    powershell.command[0] = 'powershell.exe';
    const cmd = commandReport('previous-current-2', target, context,
      ['/d', '/s', '/c', '"controlled source-bound previous/current fixture"'], 53, 54);
    cmd.command[0] = 'cmd.exe';
    data.set('previous-current-1.json', powershell);
    data.set('previous-current-2.json', cmd);
    observations.set(`assertion-${digest(['procedure', 'native-previous-current'])}`, {
      status: 'Passed', observedAt: at(56), durationMs: 0, detail: '',
    });
  }
  if (component === 'homebrew') for (const file of [...data.keys()]) {
    if (/^(?:unit|required-units|regression)(?:[.-]|$)|^tools-|^static[.]|^calculator[.-]/u.test(file)) data.delete(file);
  }
  if (part) for (const file of [...data.keys()]) {
    if (!part.go && file.startsWith('tools-') || !part.procedures.includes('calculator') && file.startsWith('calculator') ||
        !part.procedures.includes('static') && file === 'static.json') data.delete(file);
  }
  const observedAt = at(part ? nativeFrameworkUnitShardNames(target, shardProtocol).includes(shard) ? 14.8 : part.go ? 51 : 50 :
    target.startsWith('macos-') && component !== 'framework' ? 55 :
    profile === 'r-pre' && target === 'windows-x64' ? 56 : 51);
  const raw = { schemaVersion: 1, kind: 'test-execution', context, startedAt: at(6),
    finishedAt: observedAt, observedAt, sequence: 1, complete: true, exitCode: 0,
    results: specification.cases.flatMap(test => test.assertions.map(assertion => {
      const row = observations.get(assertion.id);
      assert.ok(row, `Missing fixture original ${target}/${assertion.id}`);
      return { testId: test.id, assertionId: assertion.id, selector: assertion.selector,
        status: row.status, expectedMet: true, expectedDigest: test.expectedDigest,
        checkpoint: test.checkpoint, observedAt: row.observedAt, sourceSequence: 1,
        durationMs: row.durationMs, exitCode: 0,
        ...(assertion.selector.procedure === 'native-homebrew' ? {
          detail: 'Actual isolated native Homebrew audit/style/lifecycle',
        } : assertion.selector.procedure === 'calculator' ? {
          detail: 'Independent calculator namespace: all 8 engine and 3 static assertions must execute; not framework assertion totals',
        } : {}) };
    })) };
  data.set('execution.json', raw);
  data.set('readiness-bundle.json', bundleFromOriginal(raw, specification, context, at(60)));
  data.set('producer.json', { status: 'Passed', complete: true, diagnostics: [] });
  data.set('readiness.md', '# Controlled provider fixture\nNot actual native acceptance.\n');
  for (const [file, report] of [...data]) {
    if (file.endsWith('.json') && report.kind === 'validation-command') {
      data.set(`${file.slice(0, -5)}.journal.ndjson`, [
        { sequence: 1, observedAt: report.startedAt, kind: 'command-start',
          command: report.command, cwd: report.cwd, context: report.context },
        { sequence: 2, observedAt: report.finishedAt, kind: 'command-end', complete: report.complete,
          exitCode: report.exitCode, signal: report.signal, diagnostic: report.diagnostic,
          originalOutput: report.originalOutput },
      ].map(event => JSON.stringify(event)).join('\n') + '\n');
    }
  }
  return { target, component, shard, frameworkShards, shardProtocol, role, context, specification, data, ImageOS, ImageVersion };
}

function cleanupData(lane, executionId = runId) {
  const brew = lane.context.native.toolchain.bootstrap.homebrew;
  const prefix = brew ? brew.prefix ?? path.posix.dirname(path.posix.dirname(brew.nodePrefix)) : undefined;
  const binding = { schemaVersion: 1, target: lane.target,
    host: { platform: 'darwin', architecture: lane.context.native.architecture,
      machine: lane.target === 'macos-arm64' ? 'arm64' : 'x86_64',
      release: '24.6.0', hostname: `controlled-${lane.role}`, uid: 501, gid: 20 },
    github: { GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: repository,
      GITHUB_REPOSITORY_ID: String(repositoryId), GITHUB_WORKSPACE: '/controlled-fixture',
      GITHUB_RUN_ID: String(executionId), GITHUB_RUN_ATTEMPT: '1',
      GITHUB_JOB: lane.frameworkShards ? nativePartJobKey(lane, lane.shardProtocol) : 'native',
      RUNNER_NAME: `controlled-${lane.role}`, RUNNER_ENVIRONMENT: 'github-hosted',
      RUNNER_OS: 'macOS', RUNNER_ARCH: lane.target === 'macos-arm64' ? 'ARM64' : 'X64' } };
  const request = { schemaVersion: 1, kind: 'owned-native-homebrew-prefix',
    repositoryRoot: '/controlled-fixture/source',
    bootstrapDirectory: `/controlled-fixture/source/.test-data/bootstrap-${lane.role}`,
    binding, prefix, nonce: digest(lane.role) };
  if (!brew) return new Map([
    ['toolchain.json', lane.data.get('toolchain.json')],
    ['native-homebrew-prefix-request.json', { schemaVersion: 1, kind: 'native-homebrew-prefix-not-required',
      repositoryRoot: request.repositoryRoot, bootstrapDirectory: request.bootstrapDirectory, binding }],
  ]);
  const requestDigest = digest(canonical(request));
  const prefixIdentity = { device: '1', inode: lane.role, created: '1', uid: 501, gid: 20 };
  return new Map([
    ['toolchain.json', lane.data.get('toolchain.json')],
    ['native-homebrew-prefix-request.json', request],
    ['native-homebrew-prefix-allocation.json', { schemaVersion: 1, requestDigest, prefixIdentity,
      markerDigest: digest('controlled marker'), markerIdentity: prefixIdentity }],
    ['native-homebrew-prefix-cleanup.json', { schemaVersion: 1, requestDigest, status: 'removed',
      prefixIdentity: { ...prefixIdentity } }],
  ]);
}

export function nativeReplayFixture({ candidate, target = 'linux-x64', profile = 'r-pre',
  sourceCommit = candidate?.descriptor?.sourceCommit, asOf,
  releaseIntentId = candidate?.context?.releaseIntentId ?? 'controlled-release-intent', executionId = runId,
  previousMetadata = nativeReplayPreviousFixture(), additionalTests = [] }) {
  assert.ok(candidate?.descriptor && candidate.context?.identity && /^[a-f0-9]{40}$/u.test(sourceCommit));
  assert.ok(typeof asOf === 'string' && Number.isFinite(Date.parse(asOf)));
  const ci = `name: Controlled archived native fixture\non: pull_request\npermissions: {contents: read}\n` +
    'jobs:\n  native:\n    strategy:\n      matrix:\n' +
    '        target: [linux-x64, windows-x64, macos-arm64, macos-x64]\n';
  const source = fixtureSources(ci, { additionalTests });
  const revisions = { head: 'a'.repeat(40), base: 'b'.repeat(40), merge: sourceCommit };
  const lane = laneData(source, candidate, revisions, target, { profile,
    startTime: Date.parse(asOf) - 60000, previousMetadata, releaseIntentId, executionId });
  const definition = { schemaVersion: 1, kind: 'native-validation-definition', target, profile,
    sourceFiles: [...source.files].map(([file, contents]) => ({ file, contents })),
    plan: source.plan, inventory: source.inventory, goSources: source.goSources, specification: lane.specification,
    calculatorSources,
    stages: nativeStageSelections(source.inventory, source.plan),
    configDigest: nativeConfigurationDigest({ inventory: source.inventory, profile }),
    testSpecDigest: testSpecificationDigest(source.plan), inventoryDigest: validationInventoryDigest(lane.specification),
    source: { revision: sourceCommit, treeSha: source.sha, repositoryId: `repository-${repositoryId}` } };
  const data = Object.fromEntries(lane.data);
  data.texts = Object.fromEntries([...lane.data].filter(([file]) => /\.(?:json|ndjson)$/u.test(file))
    .map(([file, value]) => [file, typeof value === 'string' ? value : canonical(value)]));
  return { definition, data, context: lane.context };
}

function archive(entries) {
  return zip([...entries].map(([file, value]) => ({
    path: file, mode: 0o644, data: Buffer.isBuffer(value) ? value :
      Buffer.from(typeof value === 'string' ? value : canonical(value)),
  })));
}

export async function observerApiFixture(t, options = {}) {
  const root = path.join(repositoryRoot, '.test-data', `observer-api-${randomUUID()}`);
  const scratch = path.join(root, 'scratch');
  await fs.mkdir(scratch, { recursive: true });
  const previous = Object.fromEntries(['TMPDIR', 'TMP', 'TEMP'].map(name => [name, process.env[name]]));
  const ambient = options.ambient !== false;
  if (ambient) for (const name of Object.keys(previous)) process.env[name] = scratch;
  t.after(async () => {
    if (ambient) for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    assert.equal(path.dirname(root), path.join(repositoryRoot, '.test-data'));
    await fs.rm(root, { recursive: true });
    await assert.rejects(fs.stat(root), { code: 'ENOENT' });
  });
  if (ambient) assert.equal(path.resolve(os.tmpdir()), scratch, 'SDK artifact scratch must stay inside this owned checkout root');
  const currentCi = await fs.readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const shardProtocol = options.shardProtocol ?? nativeFrameworkShardProtocol;
  const protocolParts = nativePrPartsForProtocol(shardProtocol);
  const protocolKeys = [...new Set(protocolParts.map(part => nativePartJobKey(part, shardProtocol)))];
  const historicalCi = `name: CI\non: pull_request\npermissions: {contents: read}\njobs:\n` +
    protocolKeys.map(key => {
      const part = protocolParts.find(part => nativePartJobKey(part, shardProtocol) === key);
      return `  ${key}:
    needs: ${JSON.stringify(['intent', 'source', ...(part.shard &&
    !nativeFrameworkUnitShardNames(part.target, shardProtocol).includes(part.shard) ?
    [nativePartJobKey({ ...part, shard: 'units' }, shardProtocol)] : [])])}
    timeout-minutes: 360
    strategy:
      fail-fast: false
      matrix:
        include: ${JSON.stringify(protocolParts.filter(part =>
    nativePartJobKey(part, shardProtocol) === key).map(part =>
    ({ ...part, os: labels[part.target], architecture: part.target.split('-')[1] })))}
    steps:
      - uses: ${checkoutPin}
        with:
          persist-credentials: false
`;
    }).join('') + (shardProtocol === nativeLegacyFrameworkShardProtocol ? '' :
      `  producer-summary:\n    permissions: {}\n    needs: ${JSON.stringify(['intent', 'minimum-node', 'source', ...protocolKeys])}\n` +
      '    steps:\n      - run: echo "Controlled historical summary; never execute"\n');
  const ci = options.frameworkShards ? shardProtocol === nativeFrameworkShardProtocol ? currentCi : historicalCi : `name: CI
on: pull_request
permissions:
  contents: read
jobs:
  native:
    strategy:
      fail-fast: false
      matrix:
        include: ${JSON.stringify(nativeLegacyPrParts.map(part => ({
    ...part, os: labels[part.target], architecture: part.target.split('-')[1],
  })))}
    steps:
      - uses: ${checkoutPin}
        with:
          persist-credentials: false
`;
  const revisions = { head: 'a'.repeat(40), base: 'b'.repeat(40), merge: 'c'.repeat(40), trusted: 'd'.repeat(40) };
  const adopted = fixtureSources(ci, { bootstrapProtocol: options.bootstrapProtocol });
  const source = fixtureSources(ci, options);
  const { candidate, entries } = candidateData(revisions.merge);
  const expectedParts = options.frameworkShards ? protocolParts : nativeLegacyPrParts;
  const parts = new Map(expectedParts.map(part => [part.role,
    laneData(source, candidate, revisions, part.target, { ...part, frameworkShards: Boolean(options.frameworkShards), shardProtocol,
      bootstrapProtocol: options.bootstrapProtocol,
      startTime: epoch + (part.shard &&
        !nativeFrameworkUnitShardNames(part.target, shardProtocol).includes(part.shard) ? 100000 : 0) })]));
  const lanes = new Map(validationPlatforms.map(target => [target, [...parts.values()].find(part =>
    part.target === target && part.component !== 'homebrew' && (!options.frameworkShards ||
      part.shard === nativeFrameworkShardPlan({ inventory: source.inventory, plan: source.plan, target, protocol: shardProtocol }).toolShard))]));
  const homebrewLanes = new Map([...parts.values()].filter(part => part.component === 'homebrew')
    .map(part => [part.target, part]));
  const cleanupReports = new Map([...parts.values()].filter(lane => lane.target.startsWith('macos-'))
    .map(lane => [lane.role, cleanupData(lane)]));
  const run = { id: runId, workflow_id: 99, run_attempt: 1, event: 'pull_request',
    path: nativeWorkflowContract.path, head_sha: revisions.head, head_repository: { id: 29 },
    repository: { id: repositoryId }, status: 'completed', conclusion: 'success', pull_requests: [] };
  const jobs = [...parts.values()].map(({ target, role, shard }, index) => {
    const shift = shard && !nativeFrameworkUnitShardNames(target, shardProtocol).includes(shard) ? 100 : 0;
    return ({
    id: 1000 + index, run_id: runId, name: `native-${role}`, head_sha: revisions.head,
    run_attempt: 1, status: 'completed', conclusion: 'success',
    labels: [labels[target]], started_at: at(shift), completed_at: at(shift + 80),
    steps: [
      [nativeWorkflowContract.steps.context, 0, 1],
      [nativeWorkflowContract.steps.checkout, 2, 3],
      [nativeWorkflowContract.steps.sourceBytes, 4, 5],
      ['Provision isolated native toolchain', 5, 5.9],
      ['Retain native bootstrap diagnostics', 5.9, 6],
      [nativeWorkflowContract.steps.execution, 6, 60],
      [nativeWorkflowContract.steps.retention, 61, 62],
      ...(target.startsWith('macos-') ? [
        ['Remove owned short Homebrew prefix', 63, 64],
        ['Retain native cleanup diagnostics', 65, 66],
      ] : []),
    ].map(([name, start, finish], offset) => ({ name, number: offset + 1, conclusion: 'success',
      started_at: at(start + shift), completed_at: at(finish + shift) })),
  }); });
  const logs = new Map(jobs.map(job => {
    const lane = parts.get(job.name.slice('native-'.length));
    const body = { repositoryId: String(repositoryId), prNumber: '1', headRepositoryId: '29',
      headSha: revisions.head, baseSha: revisions.base, mergeSha: revisions.merge,
      event: 'pull_request', runId: String(runId), attempt: '1', ImageOS: lane.ImageOS,
      ImageVersion: lane.ImageVersion, platform: lane.context.native.platform,
      architecture: lane.context.native.architecture, nativeRole: lane.role, nativeComponent: lane.component, resources: {
        availableParallelism: lane.context.native.toolchain.resources.availableParallelism,
        totalMemoryBytes: lane.context.native.toolchain.resources.totalMemoryBytes,
        configuredWorkers: lane.context.native.toolchain.resources.configuredWorkers,
      } };
    if (options.frameworkShards) body.nativeShard = lane.shard;
    const git = lane.context.native.platform === 'win32' ?
      '"C:\\Program Files\\Git\\bin\\git.exe"' : '/usr/bin/git';
    const shift = lane.shard &&
      !nativeFrameworkUnitShardNames(lane.target, shardProtocol).includes(lane.shard) ? 100 : 0;
    return [job.id, `${at(shift + 0.5)} sdlc-run-context:${JSON.stringify(body)}\n` +
      `${at(shift + 2)} [command]${git} log -1 --format=%H\n${at(shift + 2.1)} ${revisions.merge}\n`];
  }));
  const sourceJob = { ...structuredClone(jobs[0]), id: 1100, name: nativeWorkflowContract.sourceJob };
  sourceJob.steps.find(step => step.name === nativeWorkflowContract.steps.execution).name = 'Freeze exact source candidate';
  sourceJob.steps.find(step => step.name === nativeWorkflowContract.steps.retention).name = 'Retain frozen candidate';
  logs.set(sourceJob.id, logs.get(jobs[0].id));
  jobs.push(sourceJob);
  const intentJob = { id: 1101, run_id: runId, name: nativeWorkflowContract.intentJob,
    conclusion: 'success', steps: [{ name: 'Record validation intent', number: 1,
      conclusion: 'success', started_at: at(0), completed_at: at(1) }] };
  jobs.push(intentJob);
  const intent = { repositoryId: String(repositoryId), prNumber: '1',
    headSha: revisions.head, baseSha: revisions.base, mergeSha: revisions.merge,
    event: 'pull_request', action: 'opened', baseChanged: false, requiresNative: true,
    runId: String(runId), attempt: '1' };
  logs.set(intentJob.id, `${at(0.5)} sdlc-validation-intent:${JSON.stringify(intent)}\n`);
  const minimumNodeJob = { ...structuredClone(jobs[0]), id: 1102,
    name: nativeWorkflowContract.minimumNodeJob, steps: [
      [nativeWorkflowContract.steps.checkout, 2, 3],
      [nativeWorkflowContract.steps.minimumNodeSetup, 4, 5],
      [nativeWorkflowContract.steps.minimumNodeExecution, 6, 60],
      [nativeWorkflowContract.steps.minimumNodeRetention, 61, 62],
    ].map(([name, start, finish], index) => ({ name, number: index + 1, conclusion: 'success',
      started_at: at(start), completed_at: at(finish) })) };
  jobs.push(minimumNodeJob);
  logs.set(minimumNodeJob.id, `${at(2)} [command]/usr/bin/git log -1 --format=%H\n${at(2.1)} ${revisions.merge}\n`);
  const artifacts = new Map();
  const artifactBytes = new Map();
  let artifactId = 200;
  const putArtifact = (key, name, bytes, collection = artifacts, executionId = runId) => {
    const id = collection.get(key)?.id ?? ++artifactId;
    collection.set(key, { id, name, expired: false,
      digest: `sha256:${digest(bytes)}`, size_in_bytes: bytes.length,
      workflow_run: { id: executionId, repository_id: repositoryId, head_repository_id: 29,
        head_sha: revisions.head, head_branch: 'controlled-fixture' } });
    artifactBytes.set(id, bytes);
  };
  putArtifact('candidate', `frozen-candidate-${runId}-1`, archive(entries));
  putArtifact('minimum-node', `${nativeWorkflowContract.minimumNodeArtifactPrefix}${runId}-1`,
    archive(new Map([['minimum-runtime-fixture.json', { fixtureOnly: true }]])));
  for (const lane of parts.values()) {
    const key = options.frameworkShards ? lane.role : lane.component === 'homebrew' ? lane.role : lane.target;
    putArtifact(key, `native-evidence-${lane.role}-${runId}-1`, archive(lane.data));
    putArtifact(`bootstrap-${lane.role}`, `native-bootstrap-${lane.role}-${runId}-1`,
      archive(new Map([['toolchain.json', lane.data.get('toolchain.json')]])));
    if (cleanupReports.has(lane.role)) putArtifact(`cleanup-${lane.role}`,
      `native-cleanup-${lane.role}-${runId}-1`, archive(cleanupReports.get(lane.role)));
  }
  const coverageInput = { repositoryId: 'primary', sourceRevision: revisions.head,
    requirements: [{ artifactId: 'public-readiness', path: 'docs/sdlc/public-readiness/requirements.md',
      contents: source.requirements }],
    testPlans: [{ artifactId: 'public-readiness', path: 'docs/sdlc/public-readiness/test-plan.md',
      contents: source.plan }] };
  const pr = { number: 1, state: 'open', user: { id: 22 }, mergeable: true, merge_commit_sha: revisions.merge,
    head: { sha: revisions.head, repo: { id: 29 } },
    base: { sha: revisions.base, ref: 'main', repo: { id: repositoryId } },
    body: renderCoverageSection(prepareCoverage(coverageInput)) };
  const calls = [];
  const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  const sources = new Map([[revisions.head, source], [revisions.merge, source],
    [revisions.base, adopted], [revisions.trusted, adopted]]);
  const mergeParents = new Map([[revisions.merge, [{ sha: revisions.base }, { sha: revisions.head }]]]);
  const allTrees = new Map([source, adopted].map(tree => [tree.sha, tree]));
  const allBlobs = new Map([...[...adopted.blobs], ...[...source.blobs]]);
  const reviewRows = [{ id: 1, user: { id: 11 }, state: 'APPROVED', commit_id: revisions.head }];
  const members = new Map([[1, { pr, reviews: reviewRows, threads: [] }]]);
  const runs = new Map([[runId, { run, jobs, artifacts }]]);
  const statuses = [];
  const writes = [];
  let statusId = 0;
  const fetch = async (url, request) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://api.github.com', 'No real or foreign-origin network is permitted');
    calls.push({ url, method: request.method });
    if (parsed.pathname === '/graphql') {
      const input = JSON.parse(request.body);
      assert.equal(input.operationName, 'ReadinessThreads');
      const member = members.get(input.variables.number);
      assert.ok(member);
      return json({ data: { repository: { databaseId: repositoryId, pullRequest: {
        number: member.pr.number, headRefOid: member.pr.head.sha,
        reviewThreads: { nodes: member.threads, pageInfo: { hasNextPage: false, endCursor: null } },
      } } } });
    }
    const prefix = `/repos/${repository}`;
    assert.ok(parsed.pathname.startsWith(prefix));
    const route = parsed.pathname.slice(prefix.length);
    let match = /^\/statuses\/([a-f0-9]{40})$/u.exec(route);
    if (request.method === 'POST' && match) {
      const input = JSON.parse(request.body);
      assert.ok(['framework/approval', 'framework/validation', 'framework/coverage'].includes(input.context));
      const record = { id: ++statusId, sha: match[1], ...input, creator: { id: writerId } };
      statuses.push(record);
      writes.push(record);
      return new Response(JSON.stringify(record), { status: 201,
        headers: { 'content-type': 'application/json' } });
    }
    assert.equal(request.method, 'GET', 'Only exact controlled status mutations are supported');
    match = /^\/commits\/([a-f0-9]{40})\/statuses$/u.exec(route);
    if (match) return json(statuses.filter(item => item.sha === match[1]));
    if (route === '') return json({ id: repositoryId, full_name: repository,
      default_branch: 'main', owner: { id: 11, type: 'User' } });
    if (route === '/branches/main') return json({ commit: { sha: revisions.trusted } });
    if (route === '/branches/main/protection') {
      if (options.protectionStatus) return new Response(JSON.stringify({ message: 'Controlled denied capability' }),
        { status: options.protectionStatus, headers: { 'content-type': 'application/json' } });
      return json({ required_conversation_resolution: { enabled: true } });
    }
    if (route === '/pulls') return json([...members.values()].map(member => member.pr)
      .filter(pr => pr.state === 'open'));
    match = /^\/pulls\/(\d+)(\/reviews)?$/u.exec(route);
    if (match) {
      const member = members.get(Number(match[1]));
      assert.ok(member);
      return json(match[2] ? member.reviews : member.pr);
    }
    if (route === '/actions/workflows/ci.yml') return json({ id: 99, path: nativeWorkflowContract.path });
    if (route === '/actions/workflows/99/runs') return json({ total_count: runs.size,
      workflow_runs: [...runs.values()].map(item => item.run) });
    match = /^\/actions\/runs\/(\d+)(\/attempts\/1\/jobs|\/artifacts)?$/u.exec(route);
    if (match) {
      const execution = runs.get(Number(match[1]));
      assert.ok(execution);
      if (match[2] === '/attempts/1/jobs') return json({ total_count: execution.jobs.length, jobs: execution.jobs });
      if (match[2] === '/artifacts') return json({ total_count: execution.artifacts.size,
        artifacts: [...execution.artifacts.values()] });
      return json(execution.run);
    }
    match = /^\/actions\/jobs\/(\d+)\/logs$/u.exec(route);
    if (match) {
      assert.ok(logs.has(Number(match[1])), 'Unknown actual job log');
      return new Response(logs.get(Number(match[1])), { headers: { 'content-type': 'text/plain' } });
    }
    match = /^\/actions\/artifacts\/(\d+)\/zip$/u.exec(route);
    if (match) {
      assert.ok(artifactBytes.has(Number(match[1])), 'Unknown actual artifact ZIP');
      return new Response(artifactBytes.get(Number(match[1])), { headers: { 'content-type': 'application/zip' } });
    }
    if (route.startsWith('/git/commits/')) {
      const sha = route.split('/').at(-1);
      assert.ok(sources.has(sha));
      return json({ sha, tree: { sha: sources.get(sha).sha }, parents: mergeParents.get(sha) ?? [] });
    }
    if (route.startsWith('/git/trees/')) {
      const sha = route.split('/').at(-1);
      assert.ok(allTrees.has(sha));
      return json({ sha, truncated: false, tree: allTrees.get(sha).tree });
    }
    if (route.startsWith('/git/blobs/')) {
      const sha = route.split('/').at(-1);
      assert.ok(allBlobs.has(sha));
      return json(allBlobs.get(sha));
    }
    throw new Error(`Unexpected controlled provider route ${route}`);
  };
  const connect = () => {
    const runArtifactReader = options.nodeArtifactReader ? async (command, args) => {
      assert.equal(args[0], '-I');
      const kind = args[args.indexOf('--kind') + 1];
      const ownedPrefix = !args.includes('--owned-prefix');
      const entries = readZip(await fs.readFile(args[args.indexOf('--archive') + 1]));
      const texts = Object.fromEntries(entries.filter(entry => kind !== 'candidate' ||
        ['context.json', 'assets/release-descriptor.json', 'assets/SHA256SUMS'].includes(entry.path))
        .map(entry => [entry.path, entry.data.toString('utf8')]));
      if (kind === 'cleanup') {
        assert.ok(Object.hasOwn(texts, 'toolchain.json') &&
          Object.hasOwn(texts, 'native-homebrew-prefix-request.json'));
        for (const name of ['native-homebrew-prefix-allocation.json', 'native-homebrew-prefix-cleanup.json']) {
          assert.equal(Object.hasOwn(texts, name), ownedPrefix);
        }
      }
      return { stdout: JSON.stringify({ texts, files: entries.map(entry => ({
        filename: entry.path, size: entry.data.length, sha256: digest(entry.data),
      })) }) };
    } : undefined;
    const client = createReadinessGitHubClient({ repository, repositoryId, writerId,
      token: 'controlled-fixture-ephemeral-token', generation: 'observer-integration-fixture',
      scratchDirectory: scratch,
      python: process.env.SDLC_OBSERVER_PYTHON || process.env.SDLC_PYTHON ||
        (process.platform === 'win32' ? 'python' : 'python3'), fetch,
      ...(runArtifactReader ? { runArtifactReader } : {}) });
    return { client, ...createPrReadinessHost({ api: client, defaultRevision: revisions.trusted,
      writerId, now: () => epoch + 10 * 60 * 1000,
      detailsUrl: `https://github.com/${repository}/actions/runs/999/attempts/1` }) };
  };
  const changedFiles = [...new Set([...source.files.keys(), ...adopted.files.keys()])]
    .filter(file => source.tree.find(entry => entry.path === file)?.sha !==
      adopted.tree.find(entry => entry.path === file)?.sha);
  return { root, scratch, revisions, source, candidate, lanes, homebrewLanes, parts, cleanupReports,
    run, jobs, logs, artifacts, artifactBytes, pr, calls, connect,
    changedFiles, intent, intentJob, members, runs, statuses, writes, coverageInput, mergeParents,
    addPr({ number, authorId, missingCoverage = false, mergeSha = 'f'.repeat(40) }) {
      assert.ok(!members.has(number) && number > 1);
      const executionId = runId + number;
      const currentRevisions = { ...revisions, merge: mergeSha };
      const frozen = candidateData(mergeSha);
      const currentParts = expectedParts.map(part => laneData(source, frozen.candidate, currentRevisions, part.target,
        { ...part, prNumber: number, executionId, frameworkShards: Boolean(options.frameworkShards), shardProtocol,
          startTime: epoch + (part.shard &&
            !nativeFrameworkUnitShardNames(part.target, shardProtocol).includes(part.shard) ? 100000 : 0) }));
      const currentLanes = new Map(validationPlatforms.map(target => [target, currentParts.find(part =>
        part.target === target && part.component !== 'homebrew' && (!options.frameworkShards ||
          part.shard === nativeFrameworkShardPlan({ inventory: source.inventory, plan: source.plan, target, protocol: shardProtocol }).toolShard))]));
      const currentHomebrewLanes = new Map(currentParts.filter(part => part.component === 'homebrew')
        .map(part => [part.target, part]));
      const currentJobs = jobs.map(job => ({ ...structuredClone(job), id: job.id + number * 10000,
        run_id: executionId }));
      for (const job of currentJobs) {
        const original = jobs.find(selected => selected.name === job.name);
        const originalText = logs.get(original.id);
        logs.set(job.id, originalText.replaceAll(`"prNumber":"1"`, `"prNumber":"${number}"`)
          .replaceAll(`"runId":"${runId}"`, `"runId":"${executionId}"`)
          .replaceAll(revisions.merge, mergeSha));
      }
      const currentArtifacts = new Map();
      putArtifact('candidate', `frozen-candidate-${executionId}-1`, archive(frozen.entries),
        currentArtifacts, executionId);
      putArtifact('minimum-node', `${nativeWorkflowContract.minimumNodeArtifactPrefix}${executionId}-1`,
        archive(new Map([['minimum-runtime-fixture.json', { fixtureOnly: true }]])), currentArtifacts, executionId);
      for (const lane of currentParts) {
        const key = options.frameworkShards ? lane.role : lane.component === 'homebrew' ? lane.role : lane.target;
        putArtifact(key, `native-evidence-${lane.role}-${executionId}-1`, archive(lane.data), currentArtifacts, executionId);
        putArtifact(`bootstrap-${lane.role}`, `native-bootstrap-${lane.role}-${executionId}-1`,
          archive(new Map([['toolchain.json', lane.data.get('toolchain.json')]])), currentArtifacts, executionId);
        if (lane.target.startsWith('macos-')) putArtifact(`cleanup-${lane.role}`,
          `native-cleanup-${lane.role}-${executionId}-1`, archive(cleanupData(lane, executionId)), currentArtifacts, executionId);
      }
      const currentPr = { ...structuredClone(pr), number, user: { id: authorId }, merge_commit_sha: mergeSha,
        body: missingCoverage ? '' : pr.body };
      const member = { pr: currentPr, reviews: authorId === 11 ? [] :
        [{ id: number, user: { id: 11 }, state: 'APPROVED', commit_id: revisions.head }], threads: [],
      lanes: currentLanes, homebrewLanes: currentHomebrewLanes, jobs: currentJobs, artifacts: currentArtifacts };
      const parents = [{ sha: currentPr.base.sha }, { sha: currentPr.head.sha }];
      if (mergeParents.has(mergeSha)) assert.deepEqual(mergeParents.get(mergeSha), parents,
        'A shared immutable merge commit cannot have different parent identities');
      else mergeParents.set(mergeSha, parents);
      members.set(number, member);
      runs.set(executionId, { run: { ...structuredClone(run), id: executionId },
        jobs: currentJobs, artifacts: currentArtifacts });
      sources.set(mergeSha, source);
      return member;
    },
    toolDirectory,
    refresh(target) {
        const lane = lanes.get(target) ?? parts.get(target);
        const key = options.frameworkShards ? lane.role : lane.component === 'homebrew' ? lane.role : lane.target;
      putArtifact(key, `native-evidence-${lane.role}-${runId}-1`, archive(lane.data));
    },
    refreshCleanup(role) {
      putArtifact(`cleanup-${role}`, `native-cleanup-${role}-${runId}-1`, archive(cleanupReports.get(role)));
    },
    replaceCandidate(mutator) {
      const changed = new Map(entries);
      mutator(changed);
      putArtifact('candidate', `frozen-candidate-${runId}-1`, archive(changed));
    },
    swap(left, right) {
      const first = artifactBytes.get(artifacts.get(left).id);
      const second = artifactBytes.get(artifacts.get(right).id);
      const leftRole = (lanes.get(left) ?? parts.get(left)).role;
      const rightRole = (lanes.get(right) ?? parts.get(right)).role;
      putArtifact(left, `native-evidence-${leftRole}-${runId}-1`, second);
      putArtifact(right, `native-evidence-${rightRole}-${runId}-1`, first);
    },
    assertReadOnly() {
      assert.ok(calls.every(call => call.method === 'GET' ||
        (call.method === 'POST' && new URL(call.url).pathname === '/graphql')));
    },
  };
}
