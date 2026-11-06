import { ChildProcess, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { readFile, readdir, lstat, readlink, open, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { digest, requireThat, SdlcError } from '../src/core.mjs';
import { parseTestPlan, testSpecificationDigest } from '../src/artifacts.mjs';
import { normalizeExecutionReport, evaluateReadiness, validationInventoryDigest,
  createEvidenceBundle, renderReadinessReport, validateExecutionContext } from '../src/evidence.mjs';
import { sanitizeExecutionPayload } from '../src/validation-evidence.mjs';
import { compileValidationInventory, reconcileNodeExecution, validationPlatforms } from './validation-inventory.mjs';
import { canonicalUnitFiles, criticalSelection, readCriticalRiskSelectors } from './test-profiles.mjs';
import { validationSchedulingPolicyDigest } from './test-scheduling.mjs';

const execute = promisify(execFile);
const captures = new WeakMap();
const verifierId = 'local-node-process-host';
const sourceDirectories = ['bin', 'src', 'scripts', 'assets', 'packaging', 'cmd', 'test', 'docs', '.github'];
export function localEvidenceFailureDiagnostic(error) {
  const bytes = Buffer.from(JSON.stringify({ code: error.code, message: error.message }));
  const original = { sha256: digest(bytes), bytes: bytes.length };
  try {
    const safe = sanitizeExecutionPayload(Buffer.from(error.message));
    const message = (typeof safe === 'string' ? safe : JSON.stringify(safe)) ||
      'No safe cause message was available.';
    return {
      code: typeof error.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/u.test(error.code) ? error.code : 'ERROR',
      message: message.slice(0, 1000), original, truncated: message.length > 1000,
    };
  } catch (problem) {
    if (!(problem instanceof SdlcError) || !['UNSAFE', 'CAPACITY', 'JSON'].includes(problem.code)) throw problem;
    return { code: 'LOCAL_EVIDENCE_CAUSE_REJECTED',
      message: 'The cause could not be safely retained; only its original digest and size are available.',
      original, sanitizationCode: problem.code };
  }
}
function environmentDigest(overrides = {}) {
  const values = Object.fromEntries(Object.entries({ ...process.env, ...overrides }).filter(([key, value]) =>
    value !== undefined &&
    /^(?:NODE_OPTIONS|NODE_PATH|UV_THREADPOOL_SIZE|TZ|LANG|LC_ALL|SDLC_TEST_WORKERS|SDLC_DISTRIBUTION_TARGETS|SDLC_NATIVE_[A-Z0-9_]+|RUNNER_RISK_REGRESSION|RUNNER_TIMING_FAIL|RUNNER_MUTATE_SOURCE)$/u.test(key) &&
    !/TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTHORIZATION/u.test(key)));
  const safe = sanitizeExecutionPayload(Buffer.from(JSON.stringify(values)));
  requireThat(digest(values) === digest(safe), 'UNSAFE',
    'Unsafe execution configuration cannot be retained as a local origin claim');
  return digest(values);
}
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
async function sourceSnapshot(root) {
  const files = [];
  const visited = new Set();
  let revision = null;
  let repositoryFiles;
  try {
    const top = (await execute('git', ['rev-parse', '--show-toplevel'], { cwd: root })).stdout.trim();
    if (await realpath(top) === await realpath(root)) {
      revision = (await execute('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
      repositoryFiles = (await execute('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
        { cwd: root, maxBuffer: 4 * 1024 * 1024 })).stdout.split('\0').filter(Boolean);
    }
  } catch (error) {
    if (!Number.isInteger(error.code) || !/not a git repository|unknown revision|ambiguous argument/iu.test(error.stderr ?? '')) {
      throw error;
    }
  }
  async function walk(relative) {
    if (visited.has(relative)) return;
    visited.add(relative);
    const absolute = path.join(root, ...relative.split('/'));
    let info;
    try { info = await lstat(absolute); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (info.isSymbolicLink()) {
      files.push({ file: relative, kind: 'link', sha256: digest(await readlink(absolute)) });
    } else if (info.isDirectory()) {
      for (const entry of await readdir(absolute)) {
        if (['node_modules', '.git', '.test-data'].includes(entry) || entry.startsWith('.runner-fixture-')) continue;
        await walk(`${relative}/${entry}`);
      }
    } else if (info.isFile()) {
      requireThat(info.size <= 16 * 1024 * 1024 && files.length < 20000,
        'CAPACITY', 'Local source identity exceeds its bounded input inventory');
      const bytes = await readFile(absolute);
      const definition = /^docs\/sdlc\/[^/]+\/test-plan\.md$/u.test(relative);
      files.push({ file: relative, kind: definition ? 'test-plan-definition' : 'file',
        sha256: definition ? testSpecificationDigest(bytes.toString('utf8')) : digest(bytes) });
    }
  }
  if (repositoryFiles) {
    for (const file of [...new Set(repositoryFiles)].sort()) {
      if (file.split('/').some(part => ['.git', '.test-data', 'node_modules'].includes(part)) ||
        file.startsWith('test/.runner-fixture-')) continue;
      await walk(file);
    }
  }
  for (const directory of sourceDirectories) await walk(directory);
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isFile() && (/\.(?:json|mjs|js|cjs|md|sh|ps1|py|go|yaml|yml|txt)$/u.test(entry.name) ||
      entry.name === 'LICENSE')) await walk(entry.name);
  }
  files.sort((left, right) => left.file.localeCompare(right.file, 'en'));
  return { revision, contentDigest: digest(files), files };
}
export { sourceSnapshot as captureLocalSourceInputs };
function assertionSelector(test) {
  return { file: test.file, name: test.name, parents: test.parents, definitionDigest: test.definitionDigest };
}
function localSpecification({ profile, selections, riskSelectors, finiteAssertionIds,
  platform = `${{ linux: 'linux', win32: 'windows', darwin: 'macos' }[process.platform]}-${process.arch}` }) {
  const allAssertions = [...new Map(selections.flatMap(selection => selection.cases)
    .map(test => [test.id, test])).values()];
  requireThat(validationPlatforms.includes(platform), 'INVENTORY',
    'Local sanity expectations require an explicit supported native platform');
  const assertions = allAssertions.filter(test => test.applicability.platforms.includes(platform));
  const cases = [];
  const dispositions = [];
  // Sanity observations are not partial passing projections of exhaustive planned cases.
  const finite = new Set(finiteAssertionIds ?? allAssertions.map(test => test.id));
  const supplemental = assertions.filter(test => finite.has(test.id));
  const affected = assertions.filter(test => !finite.has(test.id));
  const missingRisk = riskSelectors.filter(([file, name]) => !allAssertions.some(test =>
    test.file === file && test.name === name)).map(([file, name]) => ({
    id: `missing-${digest([file, name])}`, selector: { file, name, unresolved: true },
  }));
  if (supplemental.length || missingRisk.length) cases.push({
    id: 'T-LOCAL-REGRESSIONS', conditions: ['AC-201.2', 'AC-213.11'],
    expectedDigest: digest(supplemental.map(test => [test.id, test.definitionDigest])),
    executionId: 'local-process', mode: 'automated', owner: 'agent',
    location: 'development-machine', checkpoint: 'pre-review',
    assertions: [...supplemental.map(test => ({ id: test.id, selector: assertionSelector(test) })), ...missingRisk],
  });
  if (affected.length) cases.push({
    id: 'T-LOCAL-AFFECTED', conditions: ['AC-201.3', 'AC-213.11'],
    expectedDigest: digest(affected.map(test => [test.id, test.definitionDigest])),
    executionId: 'local-process', mode: 'automated', owner: 'agent',
    location: 'development-machine', checkpoint: 'pre-review',
    assertions: affected.map(test => ({ id: test.id, selector: assertionSelector(test) })),
  });
  for (const test of cases) test.assertions.sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  cases.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  return { specification: { schemaVersion: 1, profile, cases }, dispositions };
}

export function deriveLocalSanitySpecification({ inventory, testPlan, platform }) {
  requireThat(inventory && Array.isArray(inventory.cases) && Array.isArray(inventory.files) &&
    typeof testPlan === 'string', 'INVENTORY',
  'Derive local sanity expectations from independently adopted source inventory and canonical Plan bytes');
  const critical = criticalSelection([{
    cases: inventory.cases, unresolved: inventory.nodeUnresolved ?? inventory.unresolved ?? [],
  }], parseTestPlan(testPlan), {
    canonicalFiles: canonicalUnitFiles, requiredSelectors: readCriticalRiskSelectors(testPlan),
  });
  const blockers = [...critical.canonical.blockers, ...critical.units.blockers, ...critical.blockers];
  requireThat(!blockers.length, 'INVENTORY', 'The finite local sanity source/Plan membership is incomplete or exceeds its explicit budget');
  const selections = [critical.canonical, critical.units, critical];
  const result = localSpecification({ profile: 'automated-local-critical', selections,
    riskSelectors: critical.requiredSelectors, platform });
  return { schemaVersion: 1, policy: 'finite-local-sanity-v1', ...result,
    metrics: critical.metrics, budget: critical.budget,
    requiredAssertionIds: result.specification.cases.flatMap(test => test.assertions.map(assertion => assertion.id)) };
}

export async function captureLocalExecution({ root, inventory, selections, workers, budget, environment = {},
  profile = 'automated-local-critical' }) {
  const source = await sourceSnapshot(root);
  for (const file of inventory.sourceFiles ?? inventory.files) {
    requireThat(source.files.some(actual => actual.file === file.file && actual.sha256 === file.sourceDigest),
      'STALE', 'Declared local test inputs differ from independently captured source bytes');
  }
  const plan = await readFile(path.join(root, 'docs', 'sdlc', 'public-readiness', 'test-plan.md'), 'utf8');
  const tests = parseTestPlan(plan);
  const independent = await compileValidationInventory(root);
  requireThat(digest(independent.cases) === digest(inventory.cases) &&
    independent.digest === inventory.digest, 'EVIDENCE',
  'Local expected assertions must match independent nonexecuting source discovery');
  const critical = criticalSelection([{ cases: independent.cases, unresolved: independent.nodeUnresolved }],
    tests, { canonicalFiles: canonicalUnitFiles, requiredSelectors: readCriticalRiskSelectors(plan) });
  const expected = [...critical.canonical.cases, ...critical.units.cases, ...critical.cases];
  requireThat(expected.every(test => selections.some(selection =>
    selection.cases.some(selected => selected.id === test.id &&
      digest(assertionSelector(selected)) === digest(assertionSelector(test))))) &&
    selections.every(selection => selection.cases.every(selected => independent.cases.some(test =>
      test.id === selected.id && digest(assertionSelector(test)) === digest(assertionSelector(selected))))),
  'EVIDENCE', 'Local selections cannot omit critical obligations or invent executable assertions');
  const { specification, dispositions } = localSpecification({
    profile, selections, riskSelectors: critical.requiredSelectors,
    finiteAssertionIds: expected.map(test => test.id),
  });
  const selectedInputs = freeze(JSON.parse(JSON.stringify(selections)));
  const allocation = await budget.snapshot();
  const environmentIdentity = environmentDigest(environment);
  const configuration = freeze({ profile, workers, environmentDigest: environmentIdentity,
    selections: selections.map(selection => ({ files: selection.files, ids: selection.cases.map(test => test.id),
      workers: selection.workers ?? workers })),
    schedulingPolicyDigest: validationSchedulingPolicyDigest(),
    budget: { capacity: allocation.capacity, producerLimit: allocation.producerLimit,
      residentLimit: allocation.residentLimit, policy: 'shared-host-worker-tokens-v2' } });
  const context = validateExecutionContext({
    candidateDigest: source.contentDigest, testSpecDigest: testSpecificationDigest(plan),
    configDigest: digest(configuration),
    inventoryDigest: validationInventoryDigest(specification),
    sources: [{ repositoryId: 'primary', revision: source.revision, contentDigest: source.contentDigest }],
    profile, environment: 'local', location: 'development-machine', mode: 'automated', owner: 'agent',
    native: { kind: 'native', platform: process.platform, architecture: process.arch,
      image: `${os.type()} ${os.release()}`, toolchain: {
        node: process.version, executable: process.execPath,
        availableParallelism: os.availableParallelism(), totalMemoryBytes: os.totalmem(),
      } },
    producer: { provider: 'local-process', connection: 'local-node-host',
      scopeRef: `source:${digest(await realpath(root))}`, definitionRef: 'scripts/test-runner.mjs',
      executionRef: `${process.pid}:${randomUUID()}`, attemptKind: 'not-applicable',
    },
    attemptCapability: 'none', jobRef: randomUUID(), artifacts: [],
  });
  const capture = freeze({ context, specification });
  captures.set(capture, { root, inventory: freeze(JSON.parse(JSON.stringify(independent))),
    selections: selectedInputs, source, context, specification,
    reports: [], dispositions, configuration, environmentIdentity,
    environment: { ...environment }, startedAt: new Date().toISOString() });
  return capture;
}
export async function recordLocalExecution(capture, {
  child, reportPath, selection, exitCode, interruptedBy, startedAt, finishedAt, options, budget,
}) {
  const state = captures.get(capture);
  requireThat(state && child instanceof ChildProcess && Number.isSafeInteger(child.pid) &&
    (child.exitCode !== null || child.signalCode !== null) &&
    child.spawnfile === process.execPath, 'EVIDENCE', 'Local observations require an owned, closed real process');
  const selected = state.selections.find(expected =>
    digest([...expected.files].sort()) === digest([...selection.files].sort()) &&
    digest(expected.cases.map(test => test.id).sort()) === digest(selection.cases.map(test => test.id).sort()));
  requireThat(selected, 'EVIDENCE', 'The process selection was not independently captured before dispatch');
  let bytes;
  let report;
  let problem;
  try {
    bytes = await readFile(reportPath);
    const safe = sanitizeExecutionPayload(bytes);
    report = typeof safe === 'string' ? JSON.parse(safe) : safe;
    if (digest(JSON.parse(bytes.toString('utf8'))) !== digest(report)) problem = 'UNSAFE_LOCAL_REPORT';
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError) &&
        !['JSON', 'UNSAFE', 'CAPACITY'].includes(error.code)) throw error;
    problem = error.code ?? 'INVALID_PARTIAL_REPORT';
  }
  if (report && (!Array.isArray(report.workerCommand) || !Array.isArray(report.executions) ||
      report.process?.pid !== child.pid || report.executable !== process.execPath ||
      report.node !== process.version || report.platform !== process.platform ||
      report.architecture !== process.arch || digest(report.workerCommand) !== digest(child.spawnargs) ||
      report.resources?.availableParallelism !== state.context.native.toolchain.availableParallelism ||
      report.resources?.totalMemoryBytes !== state.context.native.toolchain.totalMemoryBytes ||
      report.selection?.concurrency !== options.concurrency ||
      digest(report.selection?.namePatterns ?? null) !== digest(options.testNamePatterns ?? []) ||
      digest(report.selection?.skipPatterns ?? null) !== digest(options.testSkipPatterns ?? []) ||
      report.resources?.budget?.id !== budget.id || report.resources?.budget?.capacity !== budget.capacity ||
      report.resources?.budget?.peakActiveWorkers > budget.capacity)) {
    problem = 'LOCAL_PROCESS_CONTEXT_MISMATCH';
  }
  state.reports.push({ reportPath, report: problem ? null : report,
    bytes: problem ? null : bytes, originalDigest: bytes ? digest(bytes) : null,
    problem: problem ?? null, selection: selected, exitCode, interruptedBy: interruptedBy ?? null,
    process: { pid: child.pid, command: child.spawnargs, startedAt, finishedAt,
      inputDigest: digest(options), allocation: { id: budget.id, capacity: budget.capacity,
        concurrency: options.concurrency },
      exitCode: child.exitCode, signal: child.signalCode } });
}
async function writeImmutable(file, value) {
  const output = await open(file, 'wx');
  try { await output.writeFile(value); await output.sync(); }
  finally { await output.close(); }
}
export async function finalizeLocalExecution(capture, { reportPrefix, deferredCases = [], now } = {}) {
  const state = captures.get(capture);
  requireThat(state, 'EVIDENCE', 'A serialized local context is not a process-host verification capability');
  const after = await sourceSnapshot(state.root);
  const sourceMatches = digest(after) === digest(state.source);
  const currentEnvironment = environmentDigest(state.environment);
  const configurationMatches = currentEnvironment === state.environmentIdentity;
  const inputsMatch = sourceMatches && configurationMatches;
  const currentContext = inputsMatch ? state.context : { ...state.context,
    candidateDigest: after.contentDigest,
    configDigest: digest({ ...state.configuration, environmentDigest: currentEnvironment }),
    sources: [{ ...state.context.sources[0], revision: after.revision, contentDigest: after.contentDigest }] };
  const observed = new Map();
  const blockers = [];
  let complete = true;
  let code = 0;
  const originalObjects = [];
  const platform = { linux: 'linux', win32: 'windows', darwin: 'macos' }[process.platform];
  for (const retained of state.reports) {
    const { report, selection } = retained;
    code ||= retained.exitCode;
    if (!report) {
      complete = false;
      blockers.push({ code: retained.problem, reportPath: retained.reportPath });
      continue;
    }
    const reconciliation = reconcileNodeExecution({
      ...state.inventory, files: selection.files.map(file => ({ file })),
      cases: selection.cases, unresolved: [],
    }, report, { files: selection.files, platform: `${platform}-${process.arch}` });
    if (!report.complete || retained.interruptedBy || reconciliation.blockers.some(blocker =>
      !['UNEXECUTED_REQUIRED_ASSERTION'].includes(blocker.code))) complete = false;
    blockers.push(...reconciliation.blockers);
    originalObjects.push({ schemaVersion: 1, kind: 'execution-bytes',
      sha256: digest(retained.bytes), content: retained.bytes.toString('base64') });
    for (const projected of reconciliation.cases) {
      if (!projected.observation) continue;
      const rows = observed.get(projected.assertionId) ?? [];
      rows.push(projected.observation);
      observed.set(projected.assertionId, rows);
    }
  }
  if (!sourceMatches) blockers.push({ code: 'LOCAL_SOURCE_CHANGED_DURING_EXECUTION' });
  if (!configurationMatches) blockers.push({ code: 'LOCAL_CONFIGURATION_CHANGED_DURING_EXECUTION' });
  const results = state.specification.cases.flatMap(test => test.assertions.flatMap(assertion => {
    const rows = observed.get(assertion.id);
    if (rows?.length !== 1) { complete = false; return []; }
    const row = rows[0];
    const validDuration = Number.isFinite(row.durationMs) && row.durationMs >= 0;
    const conclusive = ['Passed', 'Failed'].includes(row.status);
    if (conclusive && !validDuration) complete = false;
    const status = conclusive && !validDuration ? 'NotRun' : row.status;
    const detail = [row.diagnostic?.message, row.skipReason, row.todoReason]
      .find(value => typeof value === 'string' && value.trim());
    return [{ testId: test.id, assertionId: assertion.id, selector: assertion.selector,
      status, expectedMet: status === 'Passed' ? true : status === 'Failed' ? false : null,
      expectedDigest: test.expectedDigest, checkpoint: test.checkpoint,
      observedAt: row.observedAt, sourceSequence: 1, durationMs: validDuration ? row.durationMs : null,
      exitCode: status === 'Failed' ? 1 : 0,
      ...(detail === undefined ? {} : { detail }) }];
  }));
  const observations = state.reports.map(report => report.process.finishedAt);
  const observedAt = observations.sort().at(-1) ?? state.startedAt;
  const raw = { schemaVersion: 1, kind: 'test-execution', context: state.context,
    startedAt: state.startedAt, observedAt, finishedAt: complete ? observedAt : null,
    sequence: 1, complete, exitCode: code || (complete ? 0 : 2), results,
    sourceSummary: { scope: 'automated-local-critical', sourceMatches, configurationMatches, blockers,
      dispositions: state.dispositions,
      deferredCases, reports: state.reports.map(report => ({
        reportPath: path.relative(state.root, report.reportPath).split(path.sep).join('/'),
        sha256: report.originalDigest, process: report.process, problem: report.problem,
      })) } };
  const bytes = Buffer.from(`${JSON.stringify(raw)}\n`);
  const report = normalizeExecutionReport(bytes, currentContext, input =>
    inputsMatch && input.reportDigest === digest(bytes) ? {
      verifierId, reportDigest: input.reportDigest, context: state.context,
      sourceTime: raw.observedAt, sourceSequence: raw.sequence,
    } : null);
  const evaluation = evaluateReadiness(state.specification, [report], {
    profile: state.specification.profile, executions: [{ id: 'local-process', context: currentContext }],
    now: now ?? new Date().toISOString(),
    policy: { maxAgeMs: 24 * 60 * 60 * 1000, revisionPolicy: 'exact', verifierIds: [verifierId] },
  });
  const bundle = createEvidenceBundle(evaluation, originalObjects);
  const paths = { execution: `${reportPrefix}.execution.json`,
    bundle: `${reportPrefix}.evidence-bundle.json`, readiness: `${reportPrefix}.readiness.json`,
    readable: `${reportPrefix}.readiness.md` };
  const evidenceRoot = await realpath(path.join(state.root, '.test-data'));
  const parent = await realpath(path.dirname(path.resolve(reportPrefix)));
  const relative = path.relative(evidenceRoot, parent);
  requireThat(relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
    'PATH', 'Local evidence stays in its declared repository-local evidence directory');
  await writeImmutable(paths.execution, bytes);
  await writeImmutable(paths.bundle, `${JSON.stringify(bundle)}\n`);
  await writeImmutable(paths.readiness, `${JSON.stringify(evaluation)}\n`);
  const scope = [
    '', '## Local scope', '',
    `Finite local sanity checkpoint: **${evaluation.status}**. This is critical plus explicitly affected observations.`,
    'Exhaustive planned-case acceptance remains **NotRun**; a finite sanity pass is not a passing projection of those cases.',
    ...deferredCases.map(test => `- ${test.testId}: **NotRun** (${test.mode}; ${test.reason})`),
    '',
  ].join('\n');
  await writeImmutable(paths.readable, renderReadinessReport(evaluation, { completeReportRef: paths.bundle }) + scope);
  return { evaluation, bundle, paths, sourceMatches, configurationMatches,
    profileScope: 'automated-local-critical',
    localCheckpoint: { scope: 'finite-local-sanity',
      status: evaluation.cases.find(test => test.testId === 'T-LOCAL-REGRESSIONS')?.status ?? 'NotRun',
      complete: evaluation.cases.find(test => test.testId === 'T-LOCAL-REGRESSIONS')?.status === 'Passed' } };
}
