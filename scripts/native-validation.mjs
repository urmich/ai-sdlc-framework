import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { canonical, digest, id, requireThat } from '../src/core.mjs';
import { parseTestPlan, testSpecificationDigest } from '../src/artifacts.mjs';
import { normalizeExecutionReport, evaluateReadiness, validationInventoryDigest,
  createEvidenceBundle, renderReadinessReport, requireReadinessEvaluation,
  validateExecutionContext, sanitizeExecutionPayload } from 'ai-sdlc-framework/evidence';
import { compileValidationInventory, compileValidationSourceInventory, reconcileNodeExecution,
  validationPlatforms, validationSourcePaths, isValidationTestPath } from './validation-inventory.mjs';
import { discoverGoDeclarations, executeValidationCommand, reconcileGoExecution } from './validation-tools.mjs';
import { repositoryRoot, unitFiles, validationSelectionDescriptor, validationSelectionProtocol,
  writeValidationSelection } from './test-runner.mjs';
import { verifyCandidate, archiveRecord } from './release-bundle.mjs';
import { readZip, canonical as releaseCanonical } from '../packaging/standalone/archive.mjs';
import { runtimePreflight } from '../packaging/standalone/runtime.mjs';
import { hostedValidationSelection, resolveValidationWorkers,
  validationSchedulingPolicyDigest, validationExecutionGroups, validationGroupProtocol } from './test-scheduling.mjs';
import { buildPlatforms, renderChecksums } from './package-platforms.mjs';
import { calculatorProjectFiles, calculatorSelection, calculatorCapability, calculatorBaselineCapability, reconcileCalculator,
  calculatorArguments } from './pr-calculator.mjs';
import { prCryptoFixture } from './pr-capabilities.mjs';
import { nativeToolchain } from './toolchain-baseline.mjs';
export { nativeToolchain } from './toolchain-baseline.mjs';
export { deriveNativeComponentSpecification, nativeComponentSelection,
  projectNativeComponentEvidence, replayNativeComponentEvidence,
  requireNativeComponentProjection } from './native-components.mjs';

const execute = promisify(execFile);
const suffixes = { 'linux-x64': 'LX', 'windows-x64': 'WX', 'macos-arm64': 'MA', 'macos-x64': 'MI' };
const platforms = { 'linux-x64': 'linux', 'windows-x64': 'win32',
  'macos-arm64': 'darwin', 'macos-x64': 'darwin' };
const locations = { 'linux-x64': 'github-linux-x64', 'windows-x64': 'github-windows-x64',
  'macos-arm64': 'github-macos-arm64', 'macos-x64': 'github-macos-x64' };
export const nativeWorkflowContract = Object.freeze({
  path: '.github/workflows/ci.yml',
  sourceJob: 'Freeze source candidate',
  intentJob: 'Classify native validation intent',
  minimumNodeJob: 'Minimum supported Node compatibility',
  jobs: Object.freeze(Object.fromEntries(validationPlatforms.map(target => [target, `native-${target}`]))),
  steps: Object.freeze({ checkout: 'Check out exact candidate', execution: 'Execute native validation',
    context: 'Record trusted execution context', sourceBytes: 'Materialize committed source bytes',
    retention: 'Retain native validation evidence', minimumNodeSetup: 'Select minimum supported Node',
    minimumNodeExecution: 'Exercise minimum-runtime compatibility',
    minimumNodeRetention: 'Retain minimum-runtime originals' }),
  artifactPrefix: 'native-evidence-',
  minimumNodeArtifactPrefix: 'minimum-node-evidence-',
  bootstrapArtifactPrefix: 'native-bootstrap-',
  stages: Object.freeze(['unit', 'required-units', 'regression']),
  reports: Object.freeze({ execution: 'execution.json', bundle: 'readiness-bundle.json', markdown: 'readiness.md',
    producer: 'producer.json', toolchain: 'toolchain.json', candidate: 'candidate-verification.json',
    homebrew: 'native-homebrew.json' }),
});
const goApplicable = (test, target) => target !== 'windows-x64' ||
  test.name !== 'TestNativePayloadRejectsTampering/extracted_mode_changed';
const canonicalIds = (target, profile) => [
  `T-PRD${profile === 'pr' ? '014' : '079'}-${suffixes[target]}`,
  ...(profile === 'pr' && target.startsWith('macos-') ? [`T-PRD060-${suffixes[target]}`] : []),
  ...(profile === 'pr' && target === 'linux-x64' ? ['T-PRD087'] : []),
];
const safe = value => sanitizeExecutionPayload(Buffer.from(JSON.stringify(value)));

export function nativeConfigurationDigest({ inventory, profile, configuredWorkers = null,
  calculator = calculatorCapability(inventory) }) {
  requireThat(inventory.complete && /^[a-f0-9]{64}$/u.test(inventory.digest) &&
    ['pr', 'r-pre'].includes(profile), 'INVENTORY', 'Native configuration needs the complete selected source inventory');
  const requested = configuredWorkers === null ? null : String(configuredWorkers);
  requireThat(requested === null || /^[1-9]\d*$/u.test(requested) && Number(requested) <= 32,
    'INVENTORY', 'Native configuration requires the exact selected worker request or explicit automatic allocation');
  requireThat(calculator?.namespace === 'calculator' && Number.isSafeInteger(calculator.tests) &&
    calculator.tests > 0 && Array.isArray(calculator.files) && calculator.files.length > 0 &&
    new Set(calculator.files).size === calculator.files.length &&
    calculator.files.every(file => /^test\/calculator\/(?:[^/]+\/)*[^/]+\.test\.(?:js|mjs|cjs)$/u.test(file)),
  'INVENTORY', 'Native calculator capability must preserve its complete independently selected files and assertion count');
  return digest({ nativeToolchain, inventory: inventory.digest, profile,
    schedulingPolicy: validationSchedulingPolicyDigest(), selectedWorkersRequest: requested,
    selectionTransport: validationSelectionProtocol,
    requiredCapabilities: { crypto: prCryptoFixture, calculator } });
}

export function nativeResourceFacts({ availableParallelism = os.availableParallelism(),
  totalMemoryBytes = os.totalmem(), configuredWorkers = process.env.SDLC_TEST_WORKERS ?? null } = {}) {
  const selected = resolveValidationWorkers({ availableParallelism, totalMemoryBytes, requested: configuredWorkers });
  return { availableParallelism, totalMemoryBytes, configuredWorkers: selected.requestedWorkers,
    workerCapacity: selected.capacity, schedulingPolicy: selected.policyDigest };
}

async function writeJson(file, value) {
  const handle = await fs.open(file, 'wx');
  try { await handle.writeFile(canonical(safe(value))); await handle.sync(); }
  finally { await handle.close(); }
}

export function nativeSpecification({ plan, inventory, goSources, target, profile }) {
  requireThat(validationPlatforms.includes(target) && ['pr', 'r-pre'].includes(profile) && inventory.complete,
    'INVENTORY', 'Native validation requires the complete declared inventory and an explicit profile/platform');
    calculatorSelection(inventory);
  const definitions = parseTestPlan(plan);
  const node = inventory.cases.filter(test => test.applicability.platforms.includes(target))
    .map(test => ({ id: test.id, selector: { file: test.file, name: test.name, parents: test.parents } }));
  const orderedGoSources = [...goSources].sort((left, right) =>
    left.file < right.file ? -1 : left.file > right.file ? 1 : 0);
  const go = discoverGoDeclarations(orderedGoSources).filter(test => goApplicable(test, target))
    .map(test => ({ id: `assertion-${digest(['go', test.file, test.name])}`,
      selector: { tool: 'go', file: test.file, name: test.name } }));
  const procedures = ['static', 'calculator', 'frozen-artifacts', ...(target.startsWith('macos-') ? ['native-homebrew'] : []),
    ...(profile === 'r-pre' && target === 'windows-x64' ? ['native-previous-current'] : [])]
    .map(name => ({ id: `assertion-${digest(['procedure', name])}`, selector: { procedure: name } }));
  return { schemaVersion: 1, profile: `${profile}-${target}`, cases: canonicalIds(target, profile).map(id => {
    const definition = definitions.find(test => test.id === id);
    requireThat(definition && definition.checkpoint === 'post-review' && definition.location === locations[target],
      'INVENTORY', 'The selected native case must exist at its exact native Test Plan location');
    return { id, conditions: definition.conditions, expectedDigest: digest(definition.expected),
      executionId: `native-${target}`, mode: definition.mode, owner: definition.owner,
      location: definition.location, checkpoint: definition.checkpoint,
      assertions: id === 'T-PRD087' ? procedures.filter(assertion => assertion.selector.procedure === 'calculator') :
        id.startsWith('T-PRD060-') ? [
        ...node.filter(assertion => assertion.selector.file === 'test/distribution-channels.test.mjs'),
        ...procedures.filter(assertion => assertion.selector.procedure === 'frozen-artifacts'),
      ] : [...node, ...go, ...procedures] };
  }) };
}

export function nativeArtifacts(candidate) {
  const files = candidate.descriptor.files.map(file => ({ name: file.filename, sha256: file.sha256 }));
  const mac = archiveRecord(candidate, 'macos-arm64');
  requireThat(mac.filename === archiveRecord(candidate, 'macos-x64').filename &&
    /-macos\.tar\.gz$/u.test(mac.filename), 'EVIDENCE', 'Both Macs must consume one frozen shared archive');
  requireThat(files.some(file => file.name === candidate.descriptor.payload.filename) &&
    new Set(files.map(file => file.name)).size === files.length,
  'EVIDENCE', 'Frozen artifact inventory must include the payload exactly once');
  return [{ name: 'frozen-descriptor', sha256: candidate.context.identity.descriptorSha256 },
    { name: 'frozen-checksums', sha256: candidate.context.identity.checksumsSha256 }, ...files]
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
}

export async function prepareNativeHostFixtures({ candidate, candidateDir, scratch, windowsLauncher,
  environment, build = buildPlatforms }) {
  requireThat(typeof build === 'function' && typeof candidate?.descriptor?.payload?.filename === 'string' &&
    Array.isArray(candidate.descriptor.files) &&
    candidate.descriptor.files.every(file => file && typeof file.filename === 'string') &&
    typeof candidateDir === 'string' && typeof scratch === 'string' && typeof windowsLauncher === 'string',
  'INPUT', 'Private host fixtures require the exact frozen payload/launcher and owned scratch');
  const selected = await build({
    artifact: path.join(candidateDir, 'assets', candidate.descriptor.payload.filename),
    outputDir: path.join(scratch, 'private-host-fixtures'), sourceCommit: candidate.descriptor.sourceCommit,
    windowsLauncher, environment, targets: ['macos', 'windows-x64', 'linux-x64'],
  });
  requireThat(Array.isArray(selected?.archives) && selected.archives.length === 3 &&
    ['macos', 'windows-x64', 'linux-x64'].every(target =>
      selected.archives.filter(archive => archive?.target === target).length === 1), 'EVIDENCE',
  'Private host fixtures must include every shared library target exactly once');
  for (const archive of selected.archives.filter(item => item.target !== 'linux-x64')) {
    const frozen = candidate.descriptor.files.find(file => file.filename === archive.filename);
    requireThat(frozen && archive.sha256 === frozen.sha256 && archive.size === frozen.size,
      'EVIDENCE', 'Private host fixtures must preserve the exact frozen published archive bytes');
  }
  return { ...selected, kind: 'private-test-library-only' };
}

function nativeContextMatches(context, { target, profile, sourceRevision, artifacts }) {
  const resources = context.native.toolchain.resources;
  let validResources = false;
  if (resources && typeof resources === 'object') {
    try { validResources = digest(resources) === digest(nativeResourceFacts(resources)); }
    catch (error) { if (!['INPUT', 'BUDGET', 'INVENTORY'].includes(error.code)) throw error; }
  }
  return validResources && context.profile === `${profile}-${target}` &&
    context.sources.length === 1 && context.sources[0].revision === sourceRevision &&
    context.native.kind === 'native' && context.native.platform === platforms[target] &&
    context.native.architecture === (target === 'macos-arm64' ? 'arm64' : 'x64') &&
    context.native.toolchain.node === nativeToolchain.node &&
    /^go version go1\.27\.1 /u.test(context.native.toolchain.go ?? '') &&
    context.native.toolchain.python === `Python ${nativeToolchain.python}` &&
    context.location === locations[target] && context.owner === 'provider' &&
    context.mode === 'automated' && context.environment === 'local' &&
    context.producer.provider === 'github' && context.producer.connection === 'repository-ci' &&
    context.attemptCapability === 'distinct' && context.producer.attemptKind === 'known' &&
    /^[1-9]\d*$/u.test(context.producer.executionRef) && /^[1-9]\d*$/u.test(context.producer.attemptRef) &&
    (profile === 'r-pre' ? typeof context.intentId === 'string' : context.intentId === undefined) &&
    context.jobRef === `native-${target}` &&
    digest(context.artifacts) === digest(validateExecutionContext({ ...context, artifacts }).artifacts);
}

export function aggregateNativeReadiness(evaluations, { profile, sourceRevision, artifacts, executions }) {
  requireThat(Array.isArray(evaluations) && ['pr', 'r-pre'].includes(profile) && /^[a-f0-9]{40}$/u.test(sourceRevision) &&
    Array.isArray(artifacts) && artifacts.length >= 5 &&
    artifacts.some(file => file.name === 'frozen-descriptor') &&
    artifacts.some(file => file.name === 'frozen-checksums') &&
    artifacts.some(file => /-macos\.tar\.gz$/u.test(file.name)) &&
    artifacts.some(file => /-windows-x64\.zip$/u.test(file.name)) &&
    artifacts.some(file => /\.tgz$/u.test(file.name)) &&
    Array.isArray(executions) && executions.length === validationPlatforms.length &&
    new Set(executions.map(item => item.target)).size === validationPlatforms.length &&
    executions.every(item => validationPlatforms.includes(item.target)),
  'INPUT', 'Native aggregation needs four independently expected execution contexts and the complete frozen artifact set');
  const expected = new Map(executions.map(({ target, context }) => {
    const actual = validateExecutionContext(context);
    requireThat(nativeContextMatches(actual, { target, profile, sourceRevision, artifacts }),
      'EVIDENCE', 'Expected native execution does not match source, artifacts, platform or baseline');
    return [target, actual];
  }));
  const baseline = expected.values().next().value;
  requireThat([...expected.values()].every(context =>
    digest(context.sources) === digest(baseline.sources) &&
    context.candidateDigest === baseline.candidateDigest && context.testSpecDigest === baseline.testSpecDigest &&
    context.configDigest === baseline.configDigest && digest(context.producer) === digest(baseline.producer) &&
    context.intentId === baseline.intentId), 'EVIDENCE',
  'Expected native lanes must belong to one exact source, configuration and producer attempt');
  const seen = new Set();
  const blockers = [];
  for (const { target, evaluation } of evaluations) {
    const protectedState = requireReadinessEvaluation(evaluation);
    if (!validationPlatforms.includes(target) || seen.has(target)) {
      blockers.push('Duplicate or unexpected native lane');
      continue;
    }
    seen.add(target);
    const selected = protectedState.context.executions;
    if (evaluation.profile !== `${profile}-${target}` || evaluation.status !== 'Passed' ||
        digest(evaluation.cases.map(test => test.testId).sort()) !== digest(canonicalIds(target, profile).sort()) ||
        selected.length !== 1 || selected[0].id !== `native-${target}` ||
        digest(selected[0].context) !== digest(expected.get(target))) {
      blockers.push(`Native ${target} evidence is incomplete or belongs to different inputs`);
    }
  }
  for (const target of validationPlatforms) if (!seen.has(target)) blockers.push(`Missing required native ${target} lane`);
  return { status: blockers.length ? 'NotRun' : 'Passed', blockers,
    requiredPlatforms: [...validationPlatforms],
    requiredCases: validationPlatforms.flatMap(target => canonicalIds(target, profile)) };
}

export function parseNativeOptions(args) {
  requireThat(Array.isArray(args) && args.length % 2 === 0, 'INPUT', 'Native options require explicit values');
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = { '--target': 'target', '--profile': 'profile', '--candidate-dir': 'candidateDir',
      '--evidence-dir': 'evidenceDir', '--build-candidate': 'buildCandidate', '--phase': 'phase' }[args[index]];
    requireThat(key && options[key] === undefined, 'INPUT', 'Unknown or repeated native option');
    requireThat(key !== 'buildCandidate' || ['true', 'false'].includes(args[index + 1]),
      'INPUT', '--build-candidate must be exactly true or false');
    options[key] = key === 'buildCandidate' ? args[index + 1] === 'true' : args[index + 1];
  }
  return options;
}

export function validateNativeRequest({ target, profile, candidateDir, evidenceDir, buildCandidate = false,
  phase = 'validation' },
  environment = process.env) {
  requireThat(validationPlatforms.includes(target) && ['pr', 'r-pre'].includes(profile) &&
    typeof buildCandidate === 'boolean' && ['candidate', 'validation'].includes(phase),
  'INPUT', 'Select an exact native platform, profile, phase and boolean build flag');
  requireThat(!buildCandidate || target === 'linux-x64', 'INPUT', 'Only the Linux producer may freeze a candidate');
  requireThat(phase !== 'candidate' || target === 'linux-x64' && buildCandidate,
    'INPUT', 'Source freeze requires the Linux candidate-building phase');
  if (profile === 'r-pre') id(environment.RELEASE_INTENT_ID, 'logical release intent');
  if (!buildCandidate) for (const name of ['EXPECTED_DESCRIPTOR_SHA256', 'EXPECTED_CHECKSUMS_SHA256']) {
    requireThat(/^[a-f0-9]{64}$/u.test(environment[name] ?? ''), 'INPUT', `Missing exact ${name}`);
  }
  requireThat(/^[a-f0-9]{40}$/u.test(environment.EXPECTED_SOURCE_COMMIT ?? ''), 'INPUT', 'Missing exact expected source');
  const local = path.join(repositoryRoot, '.test-data');
  const resolved = [candidateDir, evidenceDir].map(directory => {
    requireThat(typeof directory === 'string' && directory.trim().length > 0,
      'INPUT', 'Candidate and evidence paths must be explicit');
    const result = path.resolve(repositoryRoot, directory);
    const relative = path.relative(local, result);
    requireThat(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative), 'INPUT', 'Native output must be owned repository-local .test-data children');
    return result;
  });
  requireThat(resolved[0] !== resolved[1] &&
    !resolved.some((directory, index) => {
      const relative = path.relative(directory, resolved[1 - index]);
      return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    }), 'INPUT', 'Candidate and evidence directories must be disjoint');
  return { target, profile, candidateDir: resolved[0], evidenceDir: resolved[1], buildCandidate, phase };
}

export async function assertGitFreeAncestors(directory, { lstat = fs.lstat } = {}) {
  let current = path.resolve(directory);
  for (;;) {
    const stat = await lstat(current);
    requireThat(stat.isDirectory() && !stat.isSymbolicLink(), 'HOST',
      'Native ambient storage must not traverse linked or non-directory ancestors');
    let marker;
    try { marker = await lstat(path.join(current, '.git')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    requireThat(!marker, 'HOST', 'Native ambient temporary storage must be outside every Git working tree');
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

async function allocateAmbientDirectory() {
  requireThat(typeof process.env.GITHUB_WORKSPACE === 'string' && process.env.GITHUB_WORKSPACE,
    'HOST', 'Native ambient storage requires the actual hosted workspace parent');
  const workspace = path.resolve(process.env.GITHUB_WORKSPACE);
  requireThat(path.relative(workspace, repositoryRoot) === 'source', 'HOST',
    'The source checkout must be the isolated child of the hosted workspace');
  await assertGitFreeAncestors(workspace);
  const directory = path.join(workspace, `.sdlc-native-ambient-${randomUUID()}`);
  await fs.mkdir(directory);
  return { directory, async dispose() {
    requireThat(path.dirname(directory) === workspace &&
      /^\.sdlc-native-ambient-[a-f0-9-]{36}$/u.test(path.basename(directory)), 'HOST',
    'Cleanup is restricted to this exact owned ambient directory');
    const stat = await fs.lstat(directory);
    requireThat(stat.isDirectory() && !stat.isSymbolicLink(), 'HOST', 'Owned ambient storage was replaced');
    await fs.rm(directory, { recursive: true });
  } };
}

async function literalDirectory(directory, { create = false, empty = false } = {}) {
  const relative = path.relative(repositoryRoot, directory);
  requireThat(relative && relative.split(path.sep)[0] === '.test-data' &&
    !relative.split(path.sep).includes('..') && !path.isAbsolute(relative),
  'EVIDENCE', 'Native directories must remain in checkout-local .test-data');
  let current = repositoryRoot;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    let stat = await fs.lstat(current).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (!stat && create) { await fs.mkdir(current); stat = await fs.lstat(current); }
    requireThat(stat?.isDirectory() && !stat.isSymbolicLink(),
      'EVIDENCE', 'Native paths must be literal owned directories without linked ancestors');
  }
  if (empty) requireThat(!(await fs.readdir(directory)).length, 'EVIDENCE', 'Native output directory must be new and empty');
}

async function goSources() {
  return Promise.all((await fs.readdir(path.join(repositoryRoot, 'cmd', 'sdlc-launcher')))
    .filter(file => file.endsWith('_test.go')).map(async file => ({
      file, contents: await fs.readFile(path.join(repositoryRoot, 'cmd', 'sdlc-launcher', file), 'utf8'),
    })));
}

export async function assertCommittedNativeInputs() {
  const { stdout } = await execute('git', ['ls-tree', '-r', '-z', 'HEAD'],
    { cwd: repositoryRoot, maxBuffer: 8 * 1024 * 1024 });
  for (const entry of stdout.split('\0').filter(Boolean)) {
    const [, mode, oid, file] = /^(\d+) blob ([a-f0-9]+)\t([\s\S]+)$/u.exec(entry) ?? [];
    if (!file || (!/^(?:test|src|scripts|cmd|packaging|assets|\.github\/(?:workflows|actions))\//u.test(file) &&
        file !== '.github/release-requirements.txt' &&
        file !== 'docs/sdlc/public-readiness/test-plan.md' && file !== 'package.json')) continue;
    requireThat(['100644', '100755'].includes(mode), 'EVIDENCE', 'Validation source must be a committed regular blob');
    const selected = path.join(repositoryRoot, ...file.split('/'));
    const stat = await fs.lstat(selected);
    requireThat(stat.isFile() && !stat.isSymbolicLink(), 'EVIDENCE', 'Validation input cannot be a linked working-tree file');
    const bytes = await fs.readFile(selected);
    const actual = createHash(oid.length === 40 ? 'sha1' : 'sha256')
      .update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    requireThat(actual === oid, 'EVIDENCE',
      `Validation input ${file} differs from its committed bytes; CRLF/filter transformations cannot receive credit`);
  }
}

export function nativeGoObservations(sources, reports, target) {
  if (reports.length !== 1) return { status: 'NotRun', observations: [],
    blockers: [{ code: 'MISSING_OR_DUPLICATE_GO_REPORT', reports: reports.length }] };
  const checked = reconcileGoExecution(sources, reports[0]);
  if (reports[0].platform !== platforms[target] ||
      reports[0].architecture !== (target === 'macos-arm64' ? 'arm64' : 'x64') ||
      reports[0].node !== `v${nativeToolchain.node}`) {
    checked.blockers.push({ code: 'WRONG_NATIVE_GO_HOST' });
  }
  const observations = [];
  for (const definition of checked.expected.filter(test => goApplicable(test, target))) {
    const events = checked.executions.filter(event => event.Test === definition.name);
    if (events.length !== 1) continue;
    const event = events[0];
    if (!Number.isFinite(Date.parse(event.Time)) ||
        (event.Elapsed !== undefined && (!Number.isFinite(event.Elapsed) || event.Elapsed < 0))) {
      checked.blockers.push({ code: 'INVALID_GO_TERMINAL', name: event.Test });
      continue;
    }
    observations.push({ id: `assertion-${digest(['go', definition.file, definition.name])}`,
      status: event.Action === 'pass' ? 'Passed' : event.Action === 'fail' ? 'Failed' : 'Skipped',
      observedAt: event.Time, durationMs: (event.Elapsed ?? 0) * 1000,
      detail: event.Action === 'skip' ? 'Required Go assertion skipped; see original Go journal.' : '' });
  }
  return { ...checked, status: checked.blockers.length && checked.status === 'Passed' ? 'NotRun' :
    checked.status, observations };
}

export function nativeStageSelections(inventory, plan) {
  const selected = hostedValidationSelection({ inventory, tests: parseTestPlan(plan), canonicalFiles: unitFiles });
  requireThat(Object.values(selected).every(stage => !stage.blockers.length),
    'INVENTORY', 'Every required unit must have an executable binding before native admission');
  const stages = [
    { ...selected.canonical, files: unitFiles.filter(file => selected.canonical.files.includes(file)),
      name: 'unit', selectorName: selected.canonical.name },
    { ...selected.units, name: 'required-units', selectorName: selected.units.name },
    { ...selected.regression, name: 'regression', selectorName: selected.regression.name },
  ];
  requireThat(stages.every(stage => stage.cases.length > 0), 'INVENTORY', 'Native validation cannot use an empty stage');
  return stages.map(stage => {
    if (stage.name === 'unit') return stage;
    const { payload, ...selection } = validationSelectionDescriptor({ files: stage.files, name: stage.selectorName });
    return { ...stage, args: ['targeted', '--selection-file', selection.path], selection };
  });
}

export function validateNativeGroupReport({ inventory, stage, report, journal, target }) {
  requireThat(Array.isArray(report.selection?.namePatterns) &&
    digest(report.selection.namePatterns) === digest(stage.name === 'unit' ? [] : [stage.selectorName]) &&
    digest(report.selection?.skipPatterns ?? []) === digest([]) && report.selection?.coverage !== true,
  'EVIDENCE', 'Original native selection patterns must match the complete independently derived stage');
  const files = stage.files;
  const groups = validationExecutionGroups(inventory, {
    files, pattern: stage.name === 'unit' ? undefined : stage.selectorName, preserveOrder: true,
  });
  const retained = report.groupExecution;
  requireThat(retained?.schemaVersion === 1 && retained.protocol === validationGroupProtocol &&
    retained.policyDigest === validationSchedulingPolicyDigest() && retained.selectionDigest === digest(groups) &&
    Array.isArray(retained.groups) && retained.groups.length === groups.length &&
    new Set(retained.groups.map(group => group.id)).size === groups.length &&
    typeof journal === 'string' && journal.length > 0,
  'EVIDENCE', 'Original root-group protocol/selection/policy/journal is missing or differs from adopted source');
  const events = journal.trim().split('\n').map(line => JSON.parse(line));
  requireThat(events.every((event, index) => event.sequence === index + 1 &&
    Number.isFinite(Date.parse(event.observedAt))), 'EVIDENCE',
  'Original root-group journal must retain a complete ordered producer event sequence');
  const fields = ['id', 'rootId', 'root', 'file', 'sourceDigest', 'assertionIds', 'name',
    'minimumSlots', 'exclusiveResources', 'dependsOn'];
  const actual = new Map(retained.groups.map(group => [group.id, group]));
  for (const expected of groups) {
    const group = actual.get(expected.id);
    const applicable = inventory.cases.filter(test => expected.assertionIds.includes(test.id) &&
      test.applicability.platforms.includes(target));
    const starts = events.filter(event => event.kind === 'group-start' && event.groupId === expected.id);
    const ends = events.filter(event => event.kind === 'group-end' && event.groupId === expected.id);
    requireThat(group && fields.every(field => digest(group[field]) === digest(expected[field])) &&
      (applicable.length ? group.status === 'Passed' : group.status === 'NotRun' &&
        group.disposition === 'not-applicable-on-this-host') &&
      Number.isFinite(Date.parse(group.startedAt)) && Number.isFinite(Date.parse(group.finishedAt)) &&
      Date.parse(group.startedAt) <= Date.parse(group.finishedAt) &&
      Date.parse(group.startedAt) >= Date.parse(report.startedAt) &&
      Date.parse(group.finishedAt) <= Date.parse(report.finishedAt) &&
      Array.isArray(group.processIds) && group.processIds.length > 0 &&
      group.processIds.every(pid => Number.isSafeInteger(pid) && pid > 0) &&
      starts.length === 1 && ends.length === 1 &&
      starts[0].startedAt === group.startedAt && ends[0].finishedAt === group.finishedAt &&
      digest(starts[0].processIds) === digest(group.processIds) &&
      digest(ends[0].processIds) === digest(group.processIds) &&
      ends[0].status === group.status && digest(ends[0].summary) === digest(group.summary) &&
      report.executions.filter(row => row.groupId === expected.id).length === expected.assertionIds.length &&
      expected.assertionIds.every(id => {
        const definition = inventory.cases.find(test => test.id === id);
        const rows = report.executions.filter(row => row.groupId === expected.id && row.file === definition.file &&
          row.name === definition.name && digest(row.parents) === digest(definition.parents));
        const completions = events.filter(event => event.kind === 'completion' && event.groupId === expected.id &&
          event.file === definition.file && event.name === definition.name &&
          digest(event.parents) === digest(definition.parents));
        return rows.length === 1 && completions.length === 1 &&
          ['status', 'observedAt', 'sequence', 'durationMs'].every(field =>
            digest(rows[0][field]) === digest(completions[0][field]));
      }), 'EVIDENCE', 'Original root-group closure/process/timing/outcome does not match its independent source selection');
    requireThat(expected.dependsOn.every(id => actual.get(id)?.status === 'Passed' &&
      Date.parse(actual.get(id).finishedAt) <= Date.parse(group.startedAt)),
    'EVIDENCE', 'Original dependent root began before its prerequisite passed');
    for (const other of retained.groups.filter(other => other.id !== group.id &&
      other.exclusiveResources.some(resource => group.exclusiveResources.includes(resource)))) {
      requireThat(Date.parse(group.finishedAt) <= Date.parse(other.startedAt) ||
        Date.parse(other.finishedAt) <= Date.parse(group.startedAt),
      'EVIDENCE', 'Original roots overlapped an exclusively owned declared resource');
    }
  }
  requireThat(events.filter(event => event.kind === 'group-start').length === groups.length &&
    events.filter(event => event.kind === 'group-end').length === groups.length &&
    events.filter(event => event.kind === 'completion').length === groups.reduce((count, group) =>
      count + group.assertionIds.length, 0),
  'EVIDENCE', 'Original root-group journal contains unexpected group executions');
  return groups;
}

async function readOptional(file) {
  try {
    const stat = await fs.lstat(file);
    requireThat(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 64 * 1024 * 1024,
      'EVIDENCE', 'Native evidence must be a bounded regular file');
    try { return JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      return { schemaVersion: 1, kind: 'invalid-partial-report', complete: false,
        diagnostic: 'Original report contains incomplete or malformed JSON; original bytes remain retained.' };
    }
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function retainedToolReports(directory) {
  const found = [];
  async function walk(parent, depth) {
    requireThat(depth <= 3, 'EVIDENCE', 'Tool evidence nesting exceeds the native producer contract');
    for (const entry of await fs.readdir(parent, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && /^tools-[a-f0-9-]+$/u.test(entry.name)) {
        found.push(await readOptional(path.join(parent, entry.name, 'go-tests.json')));
      }
    }
  }
  await walk(directory, 0);
  return found.filter(Boolean);
}

async function collectExecution({ directory, data, inventory, sources, calculatorSources, target, stages, context, specification, startedAt,
  candidate, profile = context.profile.slice(0, -target.length - 1) }) {
  const observations = [];
  const diagnostics = [];
  let complete = true;
  let exitCode = 0;
  const read = name => data ? Promise.resolve(data[name] ?? null) : readOptional(path.join(directory, name));
  const smallContext = producerInputs(context, target);
  const commandMatches = (command, args, expectedContext, { before, after } = {}) =>
    command?.kind === 'validation-command' && command.complete === true && command.exitCode === 0 &&
    command.node === `v${nativeToolchain.node}` && command.platform === platforms[target] &&
    command.architecture === context.native.architecture && Array.isArray(command.command) &&
    digest(command.command.slice(1)) === digest(args) &&
    (expectedContext === null ? command.context === null :
      command.context && digest(command.context) === digest(expectedContext)) &&
    Number.isFinite(Date.parse(command.startedAt)) && Number.isFinite(Date.parse(command.finishedAt)) &&
    Date.parse(command.startedAt) >= Date.parse(startedAt) &&
    Date.parse(command.finishedAt) >= Date.parse(command.startedAt) &&
    (before === undefined || Date.parse(command.finishedAt) <= Date.parse(before)) &&
    (after === undefined || Date.parse(command.startedAt) >= Date.parse(after));
  const originalStages = [];
  for (const stage of stages) {
    const report = await read(`${stage.name}.json`);
    const command = await read(`${stage.name}-command.json`);
    if (!report || !command) {
      complete = false;
      diagnostics.push({ stage: stage.name, code: 'MISSING_STAGE_REPORT' });
      continue;
    }
    if (!Array.isArray(report.executions) || !Array.isArray(command.command)) {
      complete = false;
      diagnostics.push({ stage: stage.name, code: 'INVALID_PARTIAL_STAGE_REPORT' });
      continue;
    }
    const reconciliation = reconcileNodeExecution({ ...inventory, cases: stage.cases }, report,
      { platform: target, files: [...new Set(stage.cases.map(test => test.file))] });
    const expectedStageContext = stage.name === 'regression' ? context : producerInputs(context, target);
    const expectedResources = context.native.toolchain.resources;
    const resources = report.resources;
    const budget = resources?.budget;
    const capacity = expectedResources?.workerCapacity;
    let groupCount = 0;
    try {
      const journal = data ? data.texts?.[`${stage.name}.json.journal.ndjson`] :
        await fs.readFile(path.join(directory, `${stage.name}.json.journal.ndjson`), 'utf8');
      groupCount = validateNativeGroupReport({ inventory, stage, report, journal, target }).length;
    } catch (error) {
      complete = false;
      diagnostics.push({ stage: stage.name, code: error.code ?? 'INVALID_ORIGINAL_GROUP_EXECUTION', message: error.message });
    }
    const fileConcurrency = Math.min(capacity, Math.max(1, groupCount));
    const resourceMatches = expectedResources && resources && budget &&
      resources.availableParallelism === expectedResources.availableParallelism &&
      resources.totalMemoryBytes === expectedResources.totalMemoryBytes &&
      resources.fileConcurrency === fileConcurrency && report.selection?.concurrency === fileConcurrency &&
      budget.version === 2 && budget.allocationPolicy === 'dynamic-ready-worker-tokens-v2' &&
      typeof budget.id === 'string' && /^[a-f0-9-]{36}$/u.test(budget.id) &&
      budget.capacity === capacity && budget.producerLimit === capacity * 2 + 1 &&
      budget.controlLimit === capacity * 2 + 1 && budget.orchestrationLimit === capacity * 4 + 2 &&
      budget.residentLimit === capacity * 3 &&
      [['peakActiveWorkers', capacity], ['peakResidentWorkers', capacity * 3],
        ['peakPotentialResidentWorkers', capacity * 3], ['peakProducers', capacity * 2 + 1],
        ['peakControls', capacity * 2 + 1]].every(([field, limit]) =>
        Number.isSafeInteger(budget[field]) && budget[field] >= 0 && budget[field] <= limit);
    if (!resourceMatches) {
      complete = false;
      diagnostics.push({ stage: stage.name, code: 'INVALID_ORIGINAL_RESOURCE_ALLOCATION' });
    }
    if (reconciliation.status !== 'Passed' ||
        !commandMatches(command, ['scripts/test-runner.mjs', ...stage.args], expectedStageContext) ||
        report.node !== `v${nativeToolchain.node}` ||
        digest(report.context ?? null) !== digest(expectedStageContext) ||
        Date.parse(report.startedAt) < Date.parse(command.startedAt) ||
        Date.parse(report.finishedAt) > Date.parse(command.finishedAt) ||
        !Number.isFinite(Date.parse(report.startedAt)) || !Number.isFinite(Date.parse(report.finishedAt))) {
      complete = false;
      diagnostics.push({ stage: stage.name, code: 'INVALID_ORIGINAL_STAGE_COMMAND' });
    }
    originalStages.push(report);
    diagnostics.push({ stage: stage.name, status: reconciliation.status, blockers: reconciliation.blockers,
      dispositions: reconciliation.dispositions });
    for (const code of [report.exitCode, command.exitCode]) {
      if (Number.isSafeInteger(code) && code >= 0 && code <= 255) exitCode ||= code;
      else { complete = false; diagnostics.push({ stage: stage.name, code: 'INVALID_ORIGINAL_EXIT_CODE' }); }
    }
    for (const { assertionId, observation: row } of reconciliation.cases) {
      if (!row) continue;
      const duration = Number.isFinite(row.durationMs) && row.durationMs >= 0 ? row.durationMs : null;
      if (duration === null) {
        complete = false;
        diagnostics.push({ stage: stage.name, code: 'INVALID_NODE_DURATION', id: assertionId });
      }
      observations.push({
        id: assertionId, status: duration === null ? 'NotRun' : row.status, observedAt: row.observedAt,
        durationMs: duration, detail: row.diagnostic?.message ?? row.skipReason ?? '',
      });
    }
  }
  if (originalStages.length !== stages.length || originalStages.some((report, index) =>
    index > 0 && !(Date.parse(originalStages[index - 1].finishedAt) <= Date.parse(report.startedAt)))) {
    complete = false;
    diagnostics.push({ stage: 'ordering', code: 'INVALID_UNIT_FIRST_ORDER' });
  }
  for (const [name, args, expected] of [
    ['go-version', ['version'], context.native.toolchain.go],
    ['python-version', ['--version'], context.native.toolchain.python],
  ]) {
    const report = await read(`${name}.json`);
    if (!commandMatches(report, args, smallContext, { before: originalStages[0]?.startedAt }) ||
        typeof report?.stdout !== 'string' || report.stdout.trim() !== expected) {
      complete = false;
      diagnostics.push({ stage: name, code: 'INVALID_ORIGINAL_SDK_PREFLIGHT' });
    }
  }
  const goReports = data ? Object.entries(data).filter(([file]) =>
    /^tools-[a-f0-9-]+\/go-tests\.json$/u.test(file)).map(([, value]) => value) : await retainedToolReports(directory);
  const go = nativeGoObservations(sources, goReports, target);
  if (goReports.length === 1 && (!commandMatches(goReports[0],
    ['test', '-json', '-count=1', './...'], null, {
      after: originalStages.at(-1)?.startedAt, before: originalStages.at(-1)?.finishedAt,
    }) ||
    typeof goReports[0].cwd !== 'string' ||
    !/[\\/]cmd[\\/]sdlc-launcher[\\/]?$/u.test(goReports[0].cwd))) {
    complete = false;
    diagnostics.push({ stage: 'go', code: 'INVALID_ORIGINAL_GO_COMMAND' });
  }
  observations.push(...go.observations);
  if (go.status !== 'Passed') complete = false;
  diagnostics.push({ stage: 'go', status: go.status, blockers: go.blockers, dispositions: go.dispositions ?? [] });
  const procedure = (name, status, observedAt, detail = '') => observations.push({
    id: `assertion-${digest(['procedure', name])}`, status, detail,
    observedAt, durationMs: 0,
  });
  const calculatorReport = await read('calculator.json');
  const calculatorCommand = await read('calculator-command.json');
  const calculatorNodeCommand = await read('calculator-node-command.json');
  const calculatorJournal = data ? data.texts?.['calculator.json.journal.ndjson'] :
    await fs.readFile(path.join(directory, 'calculator.json.journal.ndjson'), 'utf8')
      .catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  let calculatorPassed = false;
  try {
    const expectedCalculator = calculatorSelection(inventory);
    const expectedFiles = calculatorProjectFiles(inventory);
    calculatorPassed = Array.isArray(calculatorSources) && calculatorSources.length === expectedFiles.length &&
      expectedFiles.every(file => calculatorSources.filter(source => source.file === file &&
        digest(source.contents) === expectedCalculator.find(test => test.file === file).sourceDigest).length === 1) &&
      reconcileCalculator(calculatorReport, expectedCalculator, calculatorJournal) &&
      calculatorReport.node === `v${nativeToolchain.node}` &&
      calculatorReport.platform === platforms[target] && calculatorReport.architecture === context.native.architecture &&
      digest(calculatorReport.context) === digest(context) &&
      commandMatches(calculatorNodeCommand, calculatorArguments(expectedCalculator), context,
        { after: calculatorCommand?.startedAt, before: calculatorCommand?.finishedAt }) &&
      commandMatches(calculatorCommand, ['scripts/pr-calculator.mjs', '--output',
        calculatorCommand?.command?.[3]], context, { after: originalStages.at(-1)?.finishedAt }) &&
      /(?:^|[\\/])calculator\.json$/u.test(calculatorCommand.command[3]) &&
      calculatorNodeCommand.stdout === calculatorJournal &&
      Date.parse(calculatorReport.startedAt) >= Date.parse(calculatorCommand.startedAt) &&
      Date.parse(calculatorReport.finishedAt) <= Date.parse(calculatorCommand.finishedAt);
  } catch (error) {
    diagnostics.push({ stage: 'calculator', code: error.code ?? 'INVALID_CALCULATOR_ORIGINAL', message: error.message });
  }
  procedure('calculator', calculatorPassed ? 'Passed' : 'NotRun', calculatorReport?.finishedAt ?? startedAt,
    digest(calculatorCapability(inventory)) === digest(calculatorBaselineCapability) ?
      'Independent calculator namespace: all 8 engine and 3 static assertions must execute; not framework assertion totals' :
      'Independent calculator namespace: every declared project assertion must execute; not framework assertion totals');
  if (!calculatorPassed) complete = false;
  const staticReport = await read('static.json');
  const staticMatches = commandMatches(staticReport, ['scripts/check.mjs'], smallContext);
  procedure('static', staticMatches ? 'Passed' :
    staticReport?.complete ? 'Failed' : 'NotRun', staticReport?.finishedAt ?? startedAt,
    staticReport?.diagnostic ?? staticReport?.stderr ?? 'Static check did not complete');
  if (!staticMatches) complete = false;
  const frozen = await read('candidate-verification.json');
  const frozenMatches = frozen && Array.isArray(frozen.artifacts) &&
    digest(frozen.artifacts) === digest(context.artifacts) &&
    frozen.sourceCommit === context.sources[0].revision && Number.isFinite(Date.parse(frozen.observedAt));
  procedure('frozen-artifacts', frozenMatches ? 'Passed' : 'NotRun', frozen?.observedAt ?? startedAt,
    frozenMatches ? '' : 'Original frozen-artifact verification is missing or mismatched');
  if (!frozenMatches) complete = false;
  if (target.startsWith('macos-')) {
    const homebrew = await read('native-homebrew.json');
    const homebrewCommand = await read('homebrew-command.json');
    let passed = false;
    const argumentsValid = Array.isArray(homebrewCommand?.command) && homebrewCommand.command.length === 13 &&
      homebrewCommand.command.every(argument => typeof argument === 'string');
    const script = argumentsValid ? homebrewCommand.command[1] : null;
    const homebrewArgs = typeof script === 'string' && /(?:^|[\\/])scripts[\\/]native-validation\.mjs$/u.test(script) ?
      [script, 'homebrew', '--target', target, '--profile', profile, '--candidate-dir',
        homebrewCommand.command[8], '--evidence-dir', homebrewCommand.command[10], '--build-candidate', 'false'] : [];
    if (candidate && homebrewArgs.length && commandMatches(homebrewCommand, homebrewArgs, context,
      { after: originalStages.at(-1)?.finishedAt })) {
      try {
        const { validateNativeHomebrewEvidence } = await import('./release-gate.mjs');
        requireThat(typeof validateNativeHomebrewEvidence === 'function',
          'EVIDENCE', 'Native Homebrew evidence validator is unavailable');
        validateNativeHomebrewEvidence(homebrew, { candidate, targetArch: context.native.architecture,
          mode: 'candidate', expectedNodeVersion: nativeToolchain.node });
        passed = true;
      } catch (error) {
        diagnostics.push({ stage: 'native-homebrew', code: error.code ?? 'INVALID_HOMEBREW_EVIDENCE',
          message: error.message });
      }
    }
    procedure('native-homebrew', passed ? 'Passed' : 'NotRun',
      homebrew?.observedAt ?? startedAt,
      passed ? 'Actual isolated native Homebrew audit/style/lifecycle' : 'Required Homebrew lifecycle is incomplete or unavailable');
    if (!passed) complete = false;
  }
  if (profile === 'r-pre' && target === 'windows-x64') {
    const previous = await read('native-previous-current.json');
    let passed = false;
    try {
      validateNativePreviousLifecycle(previous, { candidate, target });
      const commandNames = (data ? Object.keys(data) : await fs.readdir(directory))
        .filter(name => /^previous-current-[1-9]\d*\.json$/u.test(name))
        .sort((left, right) => Number(/\d+/u.exec(left)[0]) - Number(/\d+/u.exec(right)[0]));
      const commands = await Promise.all(commandNames.map(read));
      requireThat(commandNames.length >= 2 &&
        commandNames.every((name, index) => name === `previous-current-${index + 1}.json`) &&
        commands.every(command => Array.isArray(command?.command) &&
          command.command.every(argument => typeof argument === 'string') &&
          commandMatches(command, command.command.slice(1), context, {
            after: originalStages.at(-1)?.finishedAt, before: previous.observedAt,
          })) &&
        commands.some(command => /(?:^|[\\/])powershell\.exe$/iu.test(command.command[0]) &&
          digest(command.command.slice(1, 4)) === digest(['-NoProfile', '-NonInteractive', '-File'])) &&
        commands.some(command => /(?:^|[\\/])cmd\.exe$/iu.test(command.command[0]) &&
          digest(command.command.slice(1, 4)) === digest(['/d', '/s', '/c'])),
      'EVIDENCE', 'Original actual PowerShell/cmd prior-current commands are missing, failed or source/time mismatched');
      passed = true;
    }
    catch (error) {
      diagnostics.push({ stage: 'native-previous-current', code: error.code ?? 'EVIDENCE', message: error.message });
    }
    procedure('native-previous-current', passed ? 'Passed' : 'NotRun', previous?.observedAt ?? startedAt);
    if (!passed) complete = false;
  }
  const results = specification.cases.flatMap(test => test.assertions.flatMap(assertion => {
    const matching = observations.filter(row => row.id === assertion.id);
    if (matching.length !== 1) {
      complete = false;
      diagnostics.push({ stage: 'assertion', id: assertion.id, code: 'MISSING_OR_DUPLICATE_NATIVE_ASSERTION' });
      return [];
    }
    const row = matching[0];
    return [{ testId: test.id, assertionId: assertion.id, selector: assertion.selector,
      status: row.status, expectedMet: row.status === 'Passed' ? true : row.status === 'Failed' ? false : null,
      expectedDigest: test.expectedDigest, checkpoint: test.checkpoint, observedAt: row.observedAt,
      sourceSequence: 1, durationMs: row.durationMs, exitCode: row.status === 'Failed' ? 1 : 0,
      ...(row.detail === undefined || row.detail === '' ? {} : { detail: row.detail }) }];
  }));
  const observedAt = observations.reduce((latest, row) => Number.isFinite(Date.parse(row.observedAt)) &&
    Date.parse(row.observedAt) > Date.parse(latest) ? row.observedAt : latest, startedAt);
  const raw = { schemaVersion: 1, kind: 'test-execution', context, startedAt,
    finishedAt: complete ? observedAt : null, observedAt, sequence: 1, complete,
    exitCode: complete ? exitCode : exitCode || 2, results };
  return { raw, diagnostics };
}

export function reconcileNativeEvidenceData(options) {
  requireThat(options.data && Object.getPrototypeOf(options.data) === Object.prototype,
    'EVIDENCE', 'Data-only reconciliation requires the complete original report dictionary');
  return collectExecution(options);
}

export function validateNativePreviousLifecycle(report, { candidate, target }) {
  const selected = candidate?.context?.previousRelease;
  const descriptor = report?.previousMetadata?.descriptor;
  const checksums = report?.previousMetadata?.checksums;
  requireThat(selected && report?.status === 'Passed' && report.kind === 'frozen-candidate' &&
    report.publicAcceptance === 'NotRun' && report.nativePlatform === platforms[target] &&
    report.nativeArchitecture === target.split('-')[1] && report.upgradeKind === 'version' &&
    report.previousIdentity?.version === selected.version &&
    report.previousIdentity.descriptorSha256 === selected.descriptorSha256 &&
    report.previousIdentity.checksumsSha256 === selected.checksumsSha256 &&
    report.currentIdentity && digest(report.currentIdentity) === digest(candidate.context.identity) &&
    Array.isArray(report.shells) && report.shells.length === 2 &&
    ['powershell', 'cmd'].every(mode => report.shells.some(shell => shell &&
      shell.shell === mode && shell.status === 'Passed' && shell.upgradeKind === 'version' &&
      shell.previousVersion === selected.version && shell.version === candidate.context.identity.version)) &&
    report.previousIdentity.version !== report.currentIdentity.version &&
    descriptor && Array.isArray(descriptor.files) && descriptor.payload &&
    typeof checksums === 'string' && digest(Buffer.from(releaseCanonical(descriptor))) === selected.descriptorSha256 &&
    digest(Buffer.from(checksums)) === selected.checksumsSha256 &&
    renderChecksums(descriptor, Buffer.from(releaseCanonical(descriptor))) === checksums &&
    descriptor.version === report.previousIdentity.version &&
    descriptor.sourceCommit === report.previousIdentity.sourceCommit &&
    descriptor.payload.sha256 === report.previousIdentity.payloadSha256 &&
    Number.isFinite(Date.parse(report.observedAt)),
  'EVIDENCE', 'Actual Windows supported-previous/current lifecycle is missing, mismatched or incomplete');
  return report;
}

export function evaluateNativeExecution(specification, raw) {
  const context = validateExecutionContext(raw.context);
  const normalized = normalizeExecutionReport(raw, context, input => ({
    verifierId: 'native-process-host', reportDigest: input.reportDigest, context,
    sourceTime: raw.observedAt, sourceSequence: raw.sequence,
  }));
  return evaluateReadiness(specification, [normalized], {
    profile: specification.profile, executions: [{ id: `native-${context.native.platform === 'win32' ?
      'windows' : context.native.platform === 'darwin' ? 'macos' : 'linux'}-${context.native.architecture}`, context }],
    now: new Date().toISOString(), policy: {
      maxAgeMs: 24 * 60 * 60 * 1000, revisionPolicy: 'exact', verifierIds: ['native-process-host'],
    },
  });
}

export async function captureNativeDefinitionInputs({ target, profile }) {
  requireThat(validationPlatforms.includes(target) && ['pr', 'r-pre'].includes(profile),
    'INPUT', 'Definition capture needs the explicit native profile and target');
  requireThat(/^[1-9]\d*$/u.test(process.env.GITHUB_REPOSITORY_ID ?? ''),
    'HOST', 'Definition capture requires the independently selected provider repository ID');
  await assertCommittedNativeInputs();
  const sourceRevision = (await execute('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot })).stdout.trim();
  const treeSha = (await execute('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repositoryRoot })).stdout.trim();
  const tree = (await execute('git', ['ls-tree', '-r', '-z', 'HEAD'],
    { cwd: repositoryRoot, maxBuffer: 8 * 1024 * 1024 })).stdout;
  const files = [];
  for (const row of tree.split('\0').filter(Boolean)) {
    const match = /^(\d+) blob ([a-f0-9]+)\t([\s\S]+)$/u.exec(row);
    if (!match || !/^(?:test|src|scripts|cmd|packaging|assets|docs|bin|\.github\/(?:workflows|actions))\//u.test(match[3]) &&
        !['package.json', '.github/release-requirements.txt'].includes(match[3])) continue;
    requireThat(['100644', '100755'].includes(match[1]), 'EVIDENCE',
      'Native definitions cannot retain linked executable source');
    const selected = path.join(repositoryRoot, ...match[3].split('/'));
    const stat = await fs.lstat(selected);
    requireThat(stat.isFile() && !stat.isSymbolicLink(), 'EVIDENCE',
      'Captured source definitions must be literal committed files');
    const bytes = await fs.readFile(selected);
    const blob = createHash(match[2].length === 40 ? 'sha1' : 'sha256')
      .update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    requireThat(blob === match[2], 'EVIDENCE',
      `Captured source ${match[3]} differs from its exact committed byte identity`);
    let contents;
    try { contents = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch (error) {
      if (error.code !== 'ERR_ENCODING_INVALID_ENCODED_DATA') throw error;
      continue;
    }
    files.push({ file: match[3], contents });
  }
  const sourceFiles = files.sort((left, right) => left.file < right.file ? -1 : left.file > right.file ? 1 : 0);
  const selectedWorkersRequest = process.env.SDLC_TEST_WORKERS ?? null;
  const inputs = compileNativeDefinition({ target, profile, sourceFiles, selectedWorkersRequest });
  const definition = { schemaVersion: 1, kind: 'native-validation-definition', target, profile, sourceFiles,
    selectedWorkersRequest, ...inputs, source: { revision: sourceRevision, treeSha,
      repositoryId: `repository-${process.env.GITHUB_REPOSITORY_ID}` } };
  requireThat(Buffer.byteLength(canonical(definition)) <= 64 * 1024 * 1024, 'CAPACITY',
    'Exact native definitions exceed their bounded source-archive budget');
  return definition;
}

export function validateNativeSourceDefinitions(sourceFiles) {
  requireThat(Array.isArray(sourceFiles) && sourceFiles.length > 0 && sourceFiles.length <= 10000 &&
    sourceFiles.every(source => source && Object.getPrototypeOf(source) === Object.prototype &&
      Object.keys(source).length === 2 && Object.keys(source).every(key => ['file', 'contents'].includes(key)) &&
      typeof source.file === 'string' && !/[:\\\u0000-\u001f]/u.test(source.file) &&
      source.file.split('/').every(part => part && part !== '.' && part !== '..') &&
      typeof source.contents === 'string' && Buffer.byteLength(source.contents) <= 4 * 1024 * 1024 &&
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(source.contents)) &&
    new Set(sourceFiles.map(source => source.file)).size === sourceFiles.length &&
    sourceFiles.reduce((total, source) => total + Buffer.byteLength(source.contents), 0) <= 64 * 1024 * 1024,
  'EVIDENCE', 'Native source definitions must retain bounded distinct literal UTF-8 source bytes');
  for (const { file, contents } of sourceFiles) {
    const credential = /(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{40,255})(?![A-Za-z0-9_])/u;
    const privateKey = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s*(?:[A-Za-z0-9+/=]{32,}\s*)+-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u;
    requireThat(!credential.test(contents) && !privateKey.test(contents), 'UNSAFE',
      `Exact source ${file} contains credential-shaped material; no source bytes were redacted or archived`);
    for (const match of contents.matchAll(/(?<![A-Za-z0-9_-])([A-Za-z0-9_-]{8,})\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)(?![A-Za-z0-9_-])/gu)) {
      let header;
      try { header = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8')); }
      catch (error) { if (!(error instanceof SyntaxError)) throw error; }
      requireThat(!header || typeof header !== 'object' || typeof header.alg !== 'string', 'UNSAFE',
        `Exact source ${file} contains a literal credential-shaped JWT; no source bytes were redacted or archived`);
    }
    for (const match of contents.matchAll(/https?:\/\/[^\s"'`<>]+/gu)) {
      let selected;
      try { selected = new URL(match[0]); }
      catch (error) { if (error.code !== 'ERR_INVALID_URL') throw error; continue; }
      const fixtureHost = /(?:^|\.)(?:test|invalid|example)$/iu.test(selected.hostname) ||
        /^(?:example\.(?:com|net|org)|localhost|127\.0\.0\.1|\[::1\])$/iu.test(selected.hostname);
      const sensitive = [...selected.searchParams].some(([name, value]) =>
        /^(?:sig|signature|token|access_token|client_secret|api_key|password|x-amz-signature)$/iu.test(name) &&
        value.length >= 20 && !/^(?:fixture|controlled|example|dummy|not-a-real|redacted)[-_]/iu.test(value));
      requireThat(fixtureHost || !selected.password && !sensitive, 'UNSAFE',
        `Exact source ${file} contains a credential-bearing URL; no source bytes were redacted or archived`);
    }
  }
  return sourceFiles;
}

function compileNativeDefinition({ target, profile, sourceFiles, selectedWorkersRequest = null }) {
  validateNativeSourceDefinitions(sourceFiles);
  const paths = sourceFiles.map(source => source.file);
  const selected = new Set(validationSourcePaths(paths));
  const inventory = compileValidationSourceInventory({
    files: sourceFiles.filter(source => selected.has(source.file)), surfacePaths: paths,
  });
  requireThat(inventory.complete, 'INVENTORY', 'Original source definitions do not compile a complete native inventory');
  const goSources = sourceFiles.filter(source => /^cmd\/sdlc-launcher\/[^/]+_test\.go$/u.test(source.file))
    .map(source => ({ file: path.posix.basename(source.file), contents: source.contents }));
  const plan = sourceFiles.find(source => source.file === 'docs/sdlc/public-readiness/test-plan.md')?.contents;
  requireThat(typeof plan === 'string', 'EVIDENCE', 'The original native Test Plan bytes are required');
  const specification = nativeSpecification({ plan, inventory, goSources, target, profile });
  const calculatorSources = sourceFiles.filter(source => calculatorProjectFiles(inventory).includes(source.file));
  calculatorSelection(inventory);
  return { plan, inventory, goSources, calculatorSources, specification, stages: nativeStageSelections(inventory, plan),
    configDigest: nativeConfigurationDigest({ inventory, profile, configuredWorkers: selectedWorkersRequest }),
    testSpecDigest: testSpecificationDigest(plan), inventoryDigest: validationInventoryDigest(specification) };
}

export async function replayNativeEvidence({ definition, data, candidate, asOf, verifyArchive }) {
  const fields = ['schemaVersion', 'kind', 'target', 'profile', 'sourceFiles', 'selectedWorkersRequest',
    'plan', 'inventory', 'goSources', 'calculatorSources', 'specification', 'stages', 'configDigest', 'testSpecDigest',
    'inventoryDigest', 'source'];
  requireThat(definition && Object.getPrototypeOf(definition) === Object.prototype &&
    Object.keys(definition).every(field => fields.includes(field)) &&
    definition.schemaVersion === 1 && definition.kind === 'native-validation-definition' &&
    validationPlatforms.includes(definition.target) && ['pr', 'r-pre'].includes(definition.profile) &&
    /^[a-f0-9]{40}$/u.test(definition.source?.revision ?? '') &&
    /^[a-f0-9]{40}$/u.test(definition.source?.treeSha ?? '') &&
    /^repository-[1-9]\d*$/u.test(definition.source?.repositoryId ?? '') &&
    Object.keys(definition.source).length === 3 &&
    Object.keys(definition.source).every(field => ['revision', 'treeSha', 'repositoryId'].includes(field)) &&
    typeof asOf === 'string' && Number.isFinite(Date.parse(asOf)) && typeof verifyArchive === 'function',
  'EVIDENCE', 'Historical native replay requires archived definitions, an explicit as-of clock and an in-process archive verifier');
  const inputs = compileNativeDefinition(definition);
  requireThat(['plan', 'inventory', 'goSources', 'calculatorSources', 'specification', 'stages', 'configDigest',
    'testSpecDigest', 'inventoryDigest'].every(key => Object.hasOwn(definition, key) &&
      digest(inputs[key]) === digest(definition[key])),
  'EVIDENCE', 'Archived native definitions differ from their recompiled original source bytes');
  const raw = data?.['execution.json'];
  const claimedContext = validateExecutionContext(raw?.context);
  const definitionDigest = digest(definition);
  requireThat(typeof data?.texts?.['execution.json'] === 'string' &&
    digest(parseOriginal(data.texts['execution.json'])) === digest(raw), 'EVIDENCE',
  'Historical native replay needs the exact original execution bytes');
  const reportDigest = digest(data.texts['execution.json']);
  const verified = await verifyArchive({ definitionDigest, reportDigest,
    candidateIdentity: candidate?.context?.identity, claimedContext, asOf });
  requireThat(verified && typeof verified.verifierId === 'string' && verified.verifierId &&
    verified.definitionDigest === definitionDigest && verified.reportDigest === reportDigest &&
    digest(verified.context) === digest(claimedContext) &&
    verified.sourceTime === raw.observedAt && verified.sourceSequence === raw.sequence,
  'EVIDENCE', 'The authenticated archive verifier did not establish the original producer/context/bytes');
  const context = validateExecutionContext(verified.context);
  const bootstrap = data['toolchain.json'];
  requireThat(nativeContextMatches(context, { target: definition.target, profile: definition.profile,
    sourceRevision: definition.source.revision, artifacts: nativeArtifacts(candidate) }) &&
    context.candidateDigest === digest({ revision: definition.source.revision, tree: definition.source.treeSha }) &&
    context.sources[0].contentDigest === digest(definition.source.treeSha) &&
    context.sources[0].repositoryId === definition.source.repositoryId &&
    context.configDigest === inputs.configDigest && context.testSpecDigest === inputs.testSpecDigest &&
    context.inventoryDigest === inputs.inventoryDigest &&
    bootstrap?.status === 'Passed' && bootstrap.target === definition.target && bootstrap.native &&
    digest(context.native.toolchain.bootstrap) === digest(bootstrap.native), 'EVIDENCE',
  'Authenticated historical context differs from the original source/specification/configuration/artifact definitions');
  const reconstructed = await reconcileNativeEvidenceData({ ...inputs, sources: inputs.goSources, data,
    target: definition.target, profile: definition.profile, context, candidate, startedAt: raw.startedAt });
  requireThat(digest(reconstructed.raw.results) === digest(raw.results) &&
    reconstructed.raw.observedAt === raw.observedAt && reconstructed.raw.complete === raw.complete &&
    reconstructed.raw.exitCode === raw.exitCode, 'EVIDENCE',
  'Historical execution does not reconcile with every original command/assertion outcome');
  const normalized = normalizeExecutionReport(raw, context, () => ({
    verifierId: verified.verifierId, reportDigest, context,
    sourceTime: verified.sourceTime, sourceSequence: verified.sourceSequence,
  }));
  const evaluation = evaluateReadiness(inputs.specification, [normalized], {
    profile: inputs.specification.profile, executions: [{ id: `native-${definition.target}`, context }],
    now: asOf, policy: { maxAgeMs: 24 * 60 * 60 * 1000, revisionPolicy: 'exact',
      verifierIds: [verified.verifierId] },
  });
  return { evaluation, context, artifacts: context.artifacts, sourceCommit: definition.source.revision,
    diagnostics: reconstructed.diagnostics, historical: true, evaluatedAsOf: asOf, currentCredit: 'NotRun' };
}

function parseOriginal(text) {
  try { return JSON.parse(text); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    requireThat(false, 'EVIDENCE', 'Archived original execution contains malformed JSON');
  }
}

function producerInputs(context, target) {
  return { schemaVersion: 1, sourceCommit: context.sources[0].revision, target,
    profile: context.profile.slice(0, -target.length - 1), workflowRef: context.producer.definitionRef,
    repositoryId: context.sources[0].repositoryId, runId: context.producer.executionRef,
    attempt: context.producer.attemptRef };
}

export async function finalizeNativeEvidence({ directory, inventory, sources, calculatorSources, target, stages,
  context, specification, startedAt, candidate, failure = null, cancelled = false, completeReportRef }) {
  const collected = await collectExecution({ directory, inventory, sources, calculatorSources, target, stages,
    context, specification, startedAt, candidate });
  if (failure || cancelled) {
    collected.raw.complete = false;
    collected.raw.finishedAt = null;
    collected.raw.exitCode ||= 2;
  }
  const retainedRaw = safe(collected.raw);
  await writeJson(path.join(directory, 'execution.json'), retainedRaw);
  const evaluation = evaluateNativeExecution(specification, retainedRaw);
  await writeJson(path.join(directory, 'readiness-bundle.json'), createEvidenceBundle(evaluation));
  const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('`', '&#96;').replaceAll('\r', '').replaceAll('\n', ' ');
  const markdown = `# Native execution identity\n\n` +
    `- Source: \`${context.sources[0].revision}\`\n` +
    `- Native host: ${escape(context.native.platform)} / ${escape(context.native.architecture)}; image ${escape(context.native.image)}\n` +
    `- Run: ${escape(context.producer.executionRef)}; attempt ${escape(context.producer.attemptRef)}; job ${escape(context.jobRef)}\n` +
    `- Frozen artifacts: ${context.artifacts.length}; descriptor \`${context.artifacts.find(file => file.name === 'frozen-descriptor')?.sha256 ?? 'NotRun'}\`\n\n` +
    `Non-applicable assertion dispositions: ${collected.diagnostics.reduce((count, row) =>
      count + (row.dispositions?.length ?? 0), 0)} (NotRun, never counted as Passed). ` +
    `Their owners, reasons and raw skips remain in producer.json and the complete original reports.\n\n` +
    renderReadinessReport(evaluation, { completeReportRef });
  await fs.writeFile(path.join(directory, 'readiness.md'), markdown, { flag: 'wx' });
  return { evaluation, diagnostics: collected.diagnostics, markdown };
}

export function nativeFailureAnnotations(evaluation) {
  requireReadinessEvaluation(evaluation);
  const escape = value => String(value).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  return evaluation.cases.flatMap(test => test.assertions.filter(assertion =>
    assertion.status === 'Failed' && typeof assertion.selector.file === 'string' &&
    isValidationTestPath(assertion.selector.file)).map(assertion =>
    `::error file=${escape(assertion.selector.file).replaceAll(',', '%2C').replaceAll(':', '%3A')}::` +
    escape(`${test.testId}: ${assertion.detail || 'Required assertion failed; see retained complete reports.'}`)));
}

async function definitionInputs(target, profile) {
  const plan = await fs.readFile(path.join(repositoryRoot, 'docs', 'sdlc', 'public-readiness', 'test-plan.md'), 'utf8');
  const inventory = await compileValidationInventory(repositoryRoot);
  const sources = await goSources();
  const specification = nativeSpecification({ plan, inventory, goSources: sources, target, profile });
  const calculatorSources = await Promise.all(calculatorProjectFiles(inventory).map(async file =>
    ({ file, contents: await fs.readFile(path.join(repositoryRoot, ...file.split('/')), 'utf8') })));
  calculatorSelection(inventory);
  return { plan, inventory, sources, calculatorSources, specification, stages: nativeStageSelections(inventory, plan) };
}

export async function verifyNativeEvidence({ target, profile, candidateDir, evidenceDir,
  expectedSourceCommit, expectedRunId, expectedAttempt, releaseIntentId,
  expectedRepositoryId = process.env.GITHUB_REPOSITORY_ID, expectedWorkflowRef = process.env.GITHUB_WORKFLOW_REF }) {
  const actualSource = (await execute('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot })).stdout.trim();
  requireThat(actualSource === expectedSourceCommit, 'EVIDENCE', 'Replay must use the exact selected source definitions');
  await assertCommittedNativeInputs();
  const candidate = await verifyCandidate(candidateDir, { sourceCommit: expectedSourceCommit });
  const inputs = await definitionInputs(target, profile);
  const stored = await readOptional(path.join(evidenceDir, 'execution.json'));
  const context = validateExecutionContext(stored?.context);
  const bootstrap = await readOptional(path.join(evidenceDir, 'toolchain.json'));
  requireThat(bootstrap?.status === 'Passed' && bootstrap.target === target &&
    digest(context.native.toolchain.bootstrap) === digest(bootstrap.native),
  'EVIDENCE', 'Original native toolchain/host bootstrap is missing or differs');
  const tree = (await execute('git', ['rev-parse', `${expectedSourceCommit}^{tree}`], { cwd: repositoryRoot })).stdout.trim();
  requireThat(nativeContextMatches(context, { target, profile, sourceRevision: expectedSourceCommit,
    artifacts: nativeArtifacts(candidate) }) &&
    context.candidateDigest === digest({ revision: expectedSourceCommit, tree }) &&
    context.testSpecDigest === testSpecificationDigest(inputs.plan) &&
    context.configDigest === nativeConfigurationDigest({ inventory: inputs.inventory, profile,
      configuredWorkers: process.env.SDLC_TEST_WORKERS ?? null }) &&
    context.inventoryDigest === validationInventoryDigest(inputs.specification) &&
    context.sources[0].contentDigest === digest(tree) &&
    context.sources[0].repositoryId === `repository-${expectedRepositoryId}` &&
    context.producer.provider === 'github' && context.producer.connection === 'repository-ci' &&
    context.producer.scopeRef === `repository:${expectedRepositoryId}` &&
    context.producer.definitionRef === expectedWorkflowRef &&
    context.producer.executionRef === String(expectedRunId) &&
    context.producer.attemptRef === String(expectedAttempt) && context.attemptCapability === 'distinct' &&
    (profile === 'r-pre' ? context.intentId === id(releaseIntentId, 'logical release intent') :
      context.intentId === undefined),
  'EVIDENCE', 'Native evidence differs from independently selected source/specification/configuration/artifact/run inputs');
  const { raw, diagnostics } = await collectExecution({ directory: evidenceDir, ...inputs,
    target, context, startedAt: stored.startedAt, candidate });
  requireThat(digest(raw.results) === digest(stored.results) && raw.observedAt === stored.observedAt,
    'EVIDENCE', 'Stored normalized observations differ from the retained original stage/tool outcomes');
  if (stored.complete !== true || stored.exitCode !== 0) {
    raw.complete = false;
    raw.finishedAt = null;
    raw.exitCode ||= stored.exitCode || 2;
  }
  return { evaluation: evaluateNativeExecution(inputs.specification, raw), context,
    artifacts: context.artifacts, diagnostics, sourceCommit: expectedSourceCommit };
}

export async function runNativeValidation(options) {
  const request = validateNativeRequest(options);
  const { target, profile, candidateDir, evidenceDir, buildCandidate, phase } = request;
  requireThat(process.platform === platforms[target] &&
    process.arch === (target === 'macos-arm64' ? 'arm64' : 'x64') &&
    process.versions.node === nativeToolchain.node, 'HOST', 'Native validation requires its actual selected host and pinned Node');
  requireThat(process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted' &&
    process.env.ImageOS && process.env.ImageVersion && process.env.GITHUB_WORKFLOW_REF &&
    ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_REPOSITORY_ID'].every(key =>
      /^[1-9]\d*$/u.test(process.env[key] ?? '')),
  'HOST', 'Native validation needs actual hosted image, repository, workflow, run and attempt identities');
  const git = args => execute('git', args, { cwd: repositoryRoot });
  const revision = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  const sourceStatus = (await git(['status', '--porcelain'])).stdout.trim();
  requireThat(revision === process.env.EXPECTED_SOURCE_COMMIT &&
    !sourceStatus, 'EVIDENCE', 'Native validation requires the exact clean expected source',
  safe({ expectedSourceCommit: process.env.EXPECTED_SOURCE_COMMIT, actualSourceCommit: revision,
    sourceStatus }));
  await literalDirectory(evidenceDir, { create: true, empty: true });
  const directory = evidenceDir;
  const startedAt = new Date().toISOString();
  const cancellation = new AbortController();
  const interrupt = () => cancellation.abort();
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  let context;
  let candidate;
  let inputs;
  let failure;
  let evaluation;
  let ambient;
  let candidateReady = false;
  try {
    await assertCommittedNativeInputs();
    await runtimePreflight();
    inputs = await definitionInputs(target, profile);
    const scratch = path.join(directory, 'scratch');
    await fs.mkdir(scratch);
    ambient = await allocateAmbientDirectory();
    const environment = { ...Object.fromEntries(Object.entries(process.env)
      .filter(([name]) => !/^HOMEBREW_|^RUBYOPT$|^GEM_|^BUNDLE_/iu.test(name))),
      GOTOOLCHAIN: 'local', CGO_ENABLED: '0',
      GOCACHE: path.join(scratch, 'go-cache'), GOTMPDIR: scratch,
      TMPDIR: ambient.directory, TEMP: ambient.directory, TMP: ambient.directory,
      SDLC_TEST_EVIDENCE_ROOT: directory };
    environment.SDLC_TEST_REPORT_CONTEXT = JSON.stringify({ schemaVersion: 1, sourceCommit: revision, target,
      profile, workflowRef: process.env.GITHUB_WORKFLOW_REF,
      repositoryId: `repository-${process.env.GITHUB_REPOSITORY_ID}`,
      runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT });
    for (const name of ['NODE_AUTH_TOKEN', 'NPM_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN']) delete environment[name];
    const bootstrap = await readOptional(process.env.SDLC_NATIVE_TOOLCHAIN_REPORT ?? path.join(directory, 'missing-bootstrap.json'));
    const resources = nativeResourceFacts();
    requireThat(bootstrap?.status === 'Passed' && bootstrap.target === target &&
      bootstrap.native.node === process.versions.node && bootstrap.native.platform === process.platform &&
      bootstrap.native.architecture === process.arch &&
      bootstrap.native.resources && digest(bootstrap.native.resources) === digest(resources),
    'HOST', 'Required native toolchain bootstrap did not establish this actual host/resource allocation');
    await writeJson(path.join(directory, 'toolchain.json'), bootstrap);
    const runTool = options => executeValidationCommand({ outputDir: directory, environment,
      signal: cancellation.signal, ...options });
    const actualGo = await runTool({ name: 'go-version', command: process.env.SDLC_GO || 'go', args: ['version'] });
    const actualPython = await runTool({ name: 'python-version',
      command: process.env.SDLC_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), args: ['--version'] });
    requireThat(actualGo.complete && actualGo.exitCode === 0 &&
      actualGo.stdout.trim().split(/\s+/u)[2] === nativeToolchain.go &&
      actualPython.complete && actualPython.exitCode === 0 &&
      actualPython.stdout.trim() === `Python ${nativeToolchain.python}`,
    'HOST', 'Native toolchain baseline differs from the Test Plan');
    const tree = (await git(['rev-parse', 'HEAD^{tree}'])).stdout.trim();
    context = validateExecutionContext({
      candidateDigest: digest({ revision, tree }), testSpecDigest: testSpecificationDigest(inputs.plan),
      configDigest: nativeConfigurationDigest({ inventory: inputs.inventory, profile,
        configuredWorkers: resources.configuredWorkers }),
      inventoryDigest: validationInventoryDigest(inputs.specification),
      sources: [{ repositoryId: `repository-${process.env.GITHUB_REPOSITORY_ID}`, revision,
        contentDigest: digest(tree) }], profile: inputs.specification.profile,
      environment: 'local', location: locations[target], mode: 'automated', owner: 'provider',
      native: { kind: 'native', platform: process.platform, architecture: process.arch,
        image: `${process.env.ImageOS}/${process.env.ImageVersion}`, toolchain: {
          node: process.versions.node, go: actualGo.stdout.trim(), python: actualPython.stdout.trim(),
          os: os.release(), machine: os.machine(), git: (await git(['--version'])).stdout.trim(),
          bootstrap: bootstrap.native, resources,
        } },
      producer: { provider: 'github', connection: 'repository-ci',
        scopeRef: `repository:${process.env.GITHUB_REPOSITORY_ID}`,
        definitionRef: process.env.GITHUB_WORKFLOW_REF, executionRef: process.env.GITHUB_RUN_ID,
        attemptKind: 'known', attemptRef: process.env.GITHUB_RUN_ATTEMPT },
      attemptCapability: 'distinct', jobRef: `native-${target}`, artifacts: [],
      ...(profile === 'r-pre' ? { intentId: process.env.RELEASE_INTENT_ID } : {}),
    });
    const stage = async selected => {
      if (selected.selection) {
        const reference = await writeValidationSelection({ files: selected.files, name: selected.selectorName });
        requireThat(digest(reference) === digest(selected.selection), 'EVIDENCE',
          'Native selection transport differs from its independently derived stage identity');
      }
      const command = await runTool({ name: `${selected.name}-command`, command: process.execPath,
        args: ['scripts/test-runner.mjs', ...selected.args],
        environment: { ...environment, SDLC_TEST_REPORT_FILE: path.join(directory, `${selected.name}.json`) } });
      requireThat(command.complete && command.exitCode === 0, 'VALIDATION',
        `Native ${selected.name} did not complete successfully; original reports are retained`);
    };
    await stage(inputs.stages[0]);
    if (phase === 'validation') await stage(inputs.stages[1]);
    const staticReport = await runTool({ name: 'static', command: process.execPath, args: ['scripts/check.mjs'] });
    requireThat(staticReport.complete && staticReport.exitCode === 0, 'VALIDATION', 'Native static validation did not pass');
    if (buildCandidate) {
      await literalDirectory(candidateDir, { create: true, empty: true });
      const build = await runTool({ name: 'candidate-build', command: process.execPath,
        args: ['scripts/release-bundle.mjs', 'prepare', '--output-dir', candidateDir,
          '--repository', process.env.RELEASE_REPOSITORY ?? process.env.GITHUB_REPOSITORY, '--source-commit', revision],
        environment: { ...environment, GITHUB_OUTPUT: '' } });
      requireThat(build.complete && build.exitCode === 0, 'VALIDATION',
        'Frozen candidate construction did not complete; original build journals are retained');
    } else await literalDirectory(candidateDir);
    candidate = await verifyCandidate(candidateDir, { sourceCommit: revision,
      descriptorSha256: process.env.EXPECTED_DESCRIPTOR_SHA256,
      checksumsSha256: process.env.EXPECTED_CHECKSUMS_SHA256 });
    context = validateExecutionContext({ ...context, artifacts: nativeArtifacts(candidate) });
    await writeJson(path.join(directory, 'candidate-verification.json'), {
      artifacts: context.artifacts, sourceCommit: revision, observedAt: new Date().toISOString(),
    });
    candidateReady = true;
    if (phase === 'validation') {
    environment.SDLC_TEST_REPORT_CONTEXT = JSON.stringify(context);
    const windows = archiveRecord(candidate, 'windows-x64');
    const launcher = readZip(await fs.readFile(path.join(candidateDir, 'assets', windows.filename)))
      .find(entry => entry.path === 'bin/sdlc.exe');
    requireThat(launcher, 'EVIDENCE', 'Frozen candidate must contain the real Windows launcher');
    environment.SDLC_WINDOWS_LAUNCHER = path.join(scratch, 'sdlc.exe');
    await fs.writeFile(environment.SDLC_WINDOWS_LAUNCHER, launcher.data, { flag: 'wx' });
    environment.SDLC_RELEASE_DIR = path.join(candidateDir, 'assets');
    environment.SDLC_RELEASE_SOURCE_COMMIT = revision;
    environment.SDLC_DISTRIBUTION_TARGETS = 'macos,windows-x64';
    if (target === 'linux-x64') {
      const privateFixtures = await prepareNativeHostFixtures({
        candidate, candidateDir, scratch,
        windowsLauncher: environment.SDLC_WINDOWS_LAUNCHER, environment,
      });
      environment.SDLC_RELEASE_DIR = privateFixtures.outputDir;
      environment.SDLC_DISTRIBUTION_TARGETS = 'macos,windows-x64,linux-x64';
      await writeJson(path.join(directory, 'private-host-fixtures.json'), {
        kind: 'private-test-library-only', sourceCommit: revision,
        payloadSha256: candidate.descriptor.payload.sha256, archives: privateFixtures.archives,
      });
    }
    await stage(inputs.stages[2]);
    const calculator = await runTool({ name: 'calculator-command', command: process.execPath,
      args: ['scripts/pr-calculator.mjs', '--output', path.join(directory, 'calculator.json')] });
    requireThat(calculator.complete && calculator.exitCode === 0, 'VALIDATION',
      'Required independent calculator tests failed or were unavailable; see calculator originals');
    if (profile === 'r-pre' && target === 'windows-x64') {
      const { downloadPreviousRelease, verifySupportedPreviousLifecycle } = await import('./accept-release.mjs');
      const pins = candidate.context.previousRelease;
      requireThat(pins && typeof pins.repository === 'string' &&
        /^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/u.test(pins.repository),
        'RELEASE_INTEGRATION_BLOCKED', 'R-PRE Windows upgrade needs independently frozen previous-release pins');
      const previous = await downloadPreviousRelease({ ...pins,
        directory: path.join(scratch, 'previous-release') });
      const lifecycleRoot = path.join(scratch, 'previous-current-lifecycle');
      await fs.mkdir(lifecycleRoot);
      let commandSequence = 0;
      const lifecycle = await verifySupportedPreviousLifecycle({
        bundle: { context: candidate.context, identity: candidate.context.identity, descriptor: candidate.descriptor },
        downloaded: path.join(candidateDir, 'assets'), previous, root: lifecycleRoot,
        environment, run: async (command, args, options = {}) => {
          const result = await runTool({ name: `previous-current-${++commandSequence}`, command, args,
            cwd: options.cwd, environment: options.env ?? environment });
          requireThat(result.complete && result.exitCode === 0, 'VALIDATION',
            'Actual supported-previous lifecycle command did not complete successfully');
          return result;
        },
      });
      await writeJson(path.join(directory, 'native-previous-current.json'), {
        ...lifecycle, previousMetadata: { descriptor: previous.descriptor,
          checksums: previous.checksums ?? await fs.readFile(path.join(previous.directory, 'SHA256SUMS'), 'utf8') },
        observedAt: new Date().toISOString(),
      });
    }
    if (target.startsWith('macos-')) {
      const command = await runTool({ name: 'homebrew-command', command: process.execPath,
        args: [path.join(repositoryRoot, 'scripts', 'native-validation.mjs'), 'homebrew',
          '--target', target, '--profile', profile, '--candidate-dir', candidateDir,
          '--evidence-dir', evidenceDir, '--build-candidate', 'false'] });
      requireThat(command.complete && command.exitCode === 0, 'VALIDATION',
        'Native Homebrew did not complete successfully; original subprocess reports are retained');
    }
    }
    const finalCandidate = await verifyCandidate(candidateDir, { sourceCommit: revision,
      descriptorSha256: candidate.context.identity.descriptorSha256,
      checksumsSha256: candidate.context.identity.checksumsSha256 });
    requireThat(digest(nativeArtifacts(finalCandidate)) === digest(context.artifacts) &&
      !(await git(['status', '--porcelain'])).stdout.trim(), 'EVIDENCE',
    'Native validation cannot credit changed source or changed frozen artifacts');
  } catch (error) {
    failure = safe({ code: error.code ?? 'NATIVE_PRODUCER', message: error.message });
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
    if (ambient) {
      try { await ambient.dispose(); }
      catch (error) {
        failure = safe({ code: error.code ?? 'NATIVE_AMBIENT_CLEANUP', message: error.message });
      }
    }
  }
  const details = `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}/attempts/${process.env.GITHUB_RUN_ATTEMPT}`;
  let diagnostics = [];
  let markdown;
  if (context && phase === 'validation') {
    const finalized = await finalizeNativeEvidence({ directory, ...inputs, target, context, startedAt, candidate,
      failure, cancelled: cancellation.signal.aborted, completeReportRef: details });
    evaluation = finalized.evaluation;
    diagnostics = finalized.diagnostics;
    markdown = finalized.markdown;
  } else {
    markdown = `# Native ${target}: NotRun\n\n${phase === 'candidate' && candidateReady && !failure ?
      'Source candidate frozen after canonical units and static validation; native assertions have not executed.' :
      'Required producer prerequisites or unit-first validation did not complete.'} ` +
      `No execution origin or passing evidence was invented. See [complete partial reports](${details}) and producer.json.\n`;
    await fs.writeFile(path.join(directory, 'readiness.md'), markdown, { flag: 'wx' });
  }
  const status = evaluation?.status ?? 'NotRun';
  if (evaluation) for (const annotation of nativeFailureAnnotations(evaluation).slice(0, 10)) console.error(annotation);
  let presentationDiagnostic = null;
  if (process.env.GITHUB_STEP_SUMMARY) {
    try { await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, markdown); }
    catch (error) { presentationDiagnostic = safe({ code: error.code, message: 'Actions summary write failed; retained reports remain authoritative.' }); }
  }
  const result = { status, phase, candidateReady: phase === 'candidate' && candidateReady && !failure &&
    !cancellation.signal.aborted, context: phase === 'validation' ? context ?? null : null, sourceCommit: revision,
    descriptorSha256: candidate?.context.identity.descriptorSha256 ?? null,
    checksumsSha256: candidate?.context.identity.checksumsSha256 ?? null,
    artifacts: context?.artifacts ?? [], diagnostics, failure, presentationDiagnostic,
    complete: status === 'Passed', cancelled: cancellation.signal.aborted, startedAt, finishedAt: new Date().toISOString() };
  await writeJson(path.join(directory, 'producer.json'), result);
  return { ...result, evaluation };
}

async function runHomebrewProcedure(options) {
  const { target, candidateDir, evidenceDir } = validateNativeRequest(options);
  requireThat(target.startsWith('macos-') && process.platform === 'darwin' &&
    process.arch === (target === 'macos-arm64' ? 'arm64' : 'x64'), 'HOST',
  'The Homebrew subprocess must run on its actual selected native Mac architecture');
  await literalDirectory(candidateDir);
  await literalDirectory(evidenceDir);
  const candidate = await verifyCandidate(candidateDir, { sourceCommit: process.env.EXPECTED_SOURCE_COMMIT,
    descriptorSha256: process.env.EXPECTED_DESCRIPTOR_SHA256,
    checksumsSha256: process.env.EXPECTED_CHECKSUMS_SHA256 });
  try {
    const { verifyNativeHomebrew } = await import('./release-gate.mjs');
    const result = await verifyNativeHomebrew({ candidate, candidateDir, scratch: evidenceDir,
      targetArch: process.arch, mode: 'candidate' });
    await writeJson(path.join(evidenceDir, 'native-homebrew.json'), {
      ...result, observedAt: new Date().toISOString(),
    });
  } catch (error) {
    await writeJson(path.join(evidenceDir, 'native-homebrew.json'), {
      nativeValidation: 'NotRun', diagnostic: error.message, observedAt: new Date().toISOString(),
      evidence: error.homebrewResult?.evidence ?? null, quality: error.homebrewQuality ?? null,
    });
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args[0] === 'homebrew') {
    await runHomebrewProcedure(parseNativeOptions(args.slice(1)));
  } else {
    const result = await runNativeValidation(parseNativeOptions(args));
    if ((result.status === 'Passed' || result.candidateReady) && process.env.GITHUB_OUTPUT) {
      for (const field of ['sourceCommit', 'descriptorSha256', 'checksumsSha256']) {
        await fs.appendFile(process.env.GITHUB_OUTPUT, `${field}=${result[field]}\n`);
      }
    }
    process.exitCode = result.status === 'Passed' || result.candidateReady ? 0 : result.status === 'Failed' ? 1 : 2;
  }
}
