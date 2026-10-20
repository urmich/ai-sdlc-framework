import { spawn } from 'node:child_process';
import { mkdir, open, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { availableParallelism, constants, totalmem } from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalUnitFiles, criticalSelection, readCriticalRiskSelectors, testTimingGuidance } from './test-profiles.mjs';
import { compileValidationInventory, discoverDeclarations, isValidationTestPath, matchesNodeSelection,
  reconcileNodeExecution, requiredFileWorkers } from './validation-inventory.mjs';
import { resolveValidationWorkers, scheduleValidationFiles, validationExecutionGroups,
  validationUnitAssertionIds } from './test-scheduling.mjs';
import { enterTestBudget } from './test-budget.mjs';
import { captureLocalExecution, recordLocalExecution, finalizeLocalExecution,
  localEvidenceFailureDiagnostic } from './test-local-evidence.mjs';
import { parseTestPlan } from '../src/artifacts.mjs';
import { digest, requireThat, SdlcError } from '../src/core.mjs';
import { exactPattern } from './test-profiles.mjs';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const unitFiles = canonicalUnitFiles;
const maxWorkers = 32;

export function parseOptions(argv, env = process.env) {
  const [profile, ...args] = argv;
  if (!['unit', 'critical', 'full', 'targeted', 'coverage'].includes(profile)) {
    throw new Error('Expected test profile: unit, critical, full, targeted or coverage.');
  }
  const options = { profile, files: [], workers: env.SDLC_TEST_WORKERS };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') {
      options.files.push(...args.slice(index + 1));
      break;
    }
    if (arg === '--affected') {
      if (profile !== 'critical' || !args[index + 1] || args[index + 1].startsWith('--')) {
        throw new Error('Explicit --affected test files require the critical profile.');
      }
      (options.affectedFiles ??= []).push(args[++index]);
    } else if (arg === '--workers' || arg === '--name' || arg === '--affected-name') {
      if (seen.has(arg) || !args[index + 1] || args[index + 1].startsWith('--')) {
        throw new Error(`Expected exactly one value for ${arg}.`);
      }
      seen.add(arg);
      options[arg === '--workers' ? 'workers' : arg === '--name' ? 'name' : 'affectedName'] = args[++index];
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      options.files.push(arg);
    }
  }
  if (profile !== 'targeted' && (options.files.length || options.name !== undefined)) {
    throw new Error('Explicit files and --name require the targeted profile.');
  }
  if (profile === 'targeted' && !options.files.length) {
    throw new Error('The targeted profile requires at least one test file.');
  }
  if (options.name !== undefined) new RegExp(options.name);
  if (options.affectedName !== undefined) {
    if (profile !== 'critical' || !options.affectedFiles?.length) {
      throw new Error('--affected-name requires explicit critical --affected files.');
    }
    new RegExp(options.affectedName);
  }
  if (options.workers !== undefined &&
      (!/^[1-9]\d*$/u.test(options.workers) || Number(options.workers) > maxWorkers)) {
    throw new Error(`Workers must be an integer from 1 to ${maxWorkers}.`);
  }
  options.workers = resolveValidationWorkers({ availableParallelism: availableParallelism(),
    totalMemoryBytes: totalmem(), requested: options.workers }).workers;
  return options;
}

function within(directory, file) {
  const relative = path.relative(directory, file);
  return relative !== '' && relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function createPlan(options, root = repositoryRoot) {
  const testRoot = await realpath(path.join(root, 'test'));
  let selected;
  let critical;
  let inventory;
  if (options.profile === 'unit') {
    selected = [...unitFiles];
  } else if (options.profile === 'targeted') {
    selected = options.files;
  } else {
    inventory = await compileValidationInventory(root);
    if (inventory.nodeUnresolved.length) {
      throw new Error(`Test declaration inventory is incomplete: ${JSON.stringify(inventory.nodeUnresolved)}`);
    }
    selected = inventory.files.map(file => file.file);
    if (options.profile === 'critical') {
      const declarations = [{ cases: inventory.cases, unresolved: inventory.nodeUnresolved }];
      const testPlan = await readFile(path.join(root, 'docs', 'sdlc', 'public-readiness', 'test-plan.md'), 'utf8');
      critical = criticalSelection(declarations, parseTestPlan(testPlan),
        { canonicalFiles: unitFiles, requiredSelectors: readCriticalRiskSelectors(testPlan) });
      critical.canonical.files = unitFiles.filter(file => critical.canonical.files.includes(file));
      critical.units.files = scheduleValidationFiles(inventory, { files: critical.units.files });
      critical.files = scheduleValidationFiles(inventory, { files: critical.files });
      selected = critical.files;
      options = { ...options, name: critical.name };
    }
    selected = scheduleValidationFiles(inventory, { files: selected });
  }
  if (!selected.length) throw new Error('The selected profile contains no test files.');
  const files = [];
  const resourceWeights = {};
  const declarations = [];
  const canonical = new Set();
  for (const file of selected) {
    const resolved = path.resolve(root, file);
    if (!within(path.join(root, 'test'), resolved) ||
        !isValidationTestPath(path.relative(root, resolved).split(path.sep).join('/'),
          { generated: options.profile === 'targeted' })) {
      throw new Error('Test files must be .test.mjs/.test.js/.test.cjs files inside the repository test directory.');
    }
    const actual = await realpath(resolved);
    if (!within(testRoot, actual) || !(await stat(actual)).isFile()) {
      throw new Error('Selected test file is not a regular file inside the test directory.');
    }
    if (canonical.has(actual)) throw new Error('A test file was selected more than once.');
    canonical.add(actual);
    files.push(resolved);
    const declaration = discoverDeclarations(await readFile(actual, 'utf8'),
      path.relative(root, resolved).split(path.sep).join('/'));
    declarations.push(declaration);
    const weight = requiredFileWorkers({ cases: declaration.cases, resources: declaration.declared.resources },
      options.name);
    if (weight > 1) resourceWeights[process.platform === 'win32' ? resolved.toLowerCase() : resolved] = weight;
  }
  const executionInventory = inventory ?? {
    files: declarations.map(({ file, sourceDigest }) => ({ file, sourceDigest })),
    cases: declarations.flatMap(declaration => declaration.cases),
    resourceRequirements: declarations.filter(declaration => declaration.declared.resources)
      .map(declaration => ({ file: declaration.file, ...declaration.declared.resources })),
    groupDeclarations: declarations.flatMap(declaration => (declaration.declared.groups ?? [])
      .map(group => ({ file: declaration.file, ...group }))),
  };
  const groups = validationExecutionGroups(executionInventory, {
    files: files.map(file => path.relative(root, file).split(path.sep).join('/')),
    pattern: options.name, preserveOrder: ['targeted', 'unit'].includes(options.profile),
  });
  return {
    ...options, files, root, resourceWeights, groups, ...(critical ? { critical } : {}),
    ...(inventory ? { inventory } : {}),
    testOptions: {
      files, concurrency: options.workers, cwd: root,
      coverage: options.profile === 'coverage',
      ...(options.name === undefined ? {} : { testNamePatterns: [options.name] }),
    },
    args: [
      ...(options.profile === 'coverage' ? ['--experimental-test-coverage'] : []),
      fileURLToPath(new URL('./test-worker.mjs', import.meta.url)),
    ],
  };
}

async function defaultReportPath(name = 'results') {
  const directory = path.join(repositoryRoot, '.test-data', 'executions', randomUUID());
  await mkdir(directory, { recursive: true });
  return path.join(directory, `${name}.json`);
}

async function runCritical(plan, reportPath) {
  const selectedReport = reportPath ?? process.env.SDLC_TEST_REPORT_FILE ??
    await defaultReportPath('critical');
  const evidenceRoot = await realpath(path.join(repositoryRoot, '.test-data'));
  const parent = await realpath(path.dirname(path.resolve(selectedReport)));
  if (parent !== evidenceRoot && !within(evidenceRoot, parent)) {
    throw new Error('Test evidence must remain inside repository-local .test-data.');
  }
  const unitReport = `${selectedReport}.unit.json`;
  const requiredUnitReport = `${selectedReport}.required-units.json`;
  const units = await createPlan({ ...parseOptions(['unit', '--workers', String(plan.workers)]),
    profile: 'unit' }, plan.root);
  const covered = new Set([...plan.critical.canonical.cases, ...plan.critical.units.cases,
    ...plan.critical.cases].map(test => test.id));
  const affected = { units: { files: [], cases: [], bindings: [], blockers: [], name: '(?!)' },
    integration: { files: [], cases: [], bindings: [], blockers: [], name: '(?!)' } };
  if (plan.affectedFiles?.length) {
    const requested = await createPlan(parseOptions(['targeted', '--workers', String(plan.workers),
      ...(plan.affectedName ? ['--name', plan.affectedName] : []), ...plan.affectedFiles]), plan.root);
    const requestedFiles = requested.files.map(file => path.relative(plan.root, file).split(path.sep).join('/'));
    requireThat(requestedFiles.every(file => plan.inventory.files.some(source => source.file === file)),
      'INVENTORY', 'Independent fixture projects keep their separate command/disposition, not framework checkpoint credit');
    const pattern = plan.affectedName ? new RegExp(plan.affectedName) : null;
    const rootKey = test => JSON.stringify([test.file, test.parents[0] ?? test.name]);
    const requestedRoots = new Set(plan.inventory.cases.filter(test => requestedFiles.includes(test.file) &&
      (!pattern || matchesNodeSelection(test, pattern))).map(rootKey));
    const remaining = plan.inventory.cases.filter(test =>
      requestedRoots.has(rootKey(test)) && !covered.has(test.id));
    const unitIds = validationUnitAssertionIds({
      cases: plan.inventory.cases, canonicalFiles: unitFiles,
      tests: parseTestPlan(await readFile(path.join(plan.root, 'docs', 'sdlc', 'public-readiness', 'test-plan.md'), 'utf8')),
    });
    for (const [stage, isUnit] of [['units', true], ['integration', false]]) {
      const cases = remaining.filter(test => unitIds.has(test.id) === isUnit);
      const files = requestedFiles.filter(file => cases.some(test => test.file === file));
      affected[stage] = { cases, files, bindings: [], blockers: [],
        name: cases.length ? exactPattern(cases.map(test => [...test.parents, test.name].join(' '))) : '(?!)' };
      const selected = new RegExp(affected[stage].name);
      for (const test of plan.inventory.cases) if (files.includes(test.file) &&
        matchesNodeSelection(test, selected) !== cases.some(expected => expected.id === test.id)) {
        affected[stage].blockers.push({ code: 'AMBIGUOUS_AFFECTED_SELECTOR', file: test.file, name: test.name });
      }
    }
  }
  const unitStages = [['required-units', plan.critical.units, requiredUnitReport]];
  if (affected.units.files.length || affected.units.blockers.length) unitStages.push([
    'affected-units', affected.units, `${selectedReport}.affected-units.json`,
  ]);
  const integrationStages = [['integration', plan.critical, selectedReport]];
  if (affected.integration.files.length || affected.integration.blockers.length) integrationStages.push([
    'affected', affected.integration, `${selectedReport}.affected.json`,
  ]);
  const selections = [plan.critical.canonical, ...unitStages.map(stage => stage[1]),
    ...integrationStages.map(stage => stage[1])].filter(selection => selection.cases.length || selection.blockers.length);
  const local = await captureLocalExecution({ root: plan.root, inventory: plan.inventory,
    selections, workers: plan.workers, budget: plan.activeBudget, environment: plan.environment });
  const sequence = { profile: 'critical', profileScope: 'automated-local-critical',
    unitReport, requiredUnitReport, reportPath: selectedReport, complete: false, stages: [],
    deferredCases: plan.critical.deferredCases,
    criticalBudget: plan.critical.budget, criticalMetrics: plan.critical.metrics,
    localCheckpoint: { scope: 'finite-local-sanity', status: 'NotRun', complete: false },
    plannedAcceptance: { scope: 'exhaustive-planned-cases', status: 'NotRun', complete: false,
      reason: 'Finite sanity observations do not complete exhaustive PR or procedure acceptance.' } };
  const finish = async (code, notRun) => {
    try {
      const evidence = await finalizeLocalExecution(local, {
        reportPrefix: selectedReport, deferredCases: plan.critical.deferredCases,
      });
      sequence.evidence = { status: evidence.evaluation.status, paths: evidence.paths,
        counts: evidence.evaluation.counts, sourceMatches: evidence.sourceMatches,
        configurationMatches: evidence.configurationMatches };
      sequence.localCheckpoint = evidence.localCheckpoint;
      if (code < 128) code = evidence.evaluation.exitCode;
    } catch (error) {
      if (!(error instanceof SdlcError)) throw error;
      const cause = localEvidenceFailureDiagnostic(error);
      sequence.evidence = { status: 'NotRun', code: cause.code, cause,
        diagnostic: 'Public local evidence could not be completed; original producer reports remain retained.' };
      if (code < 128) code = 2;
    }
    Object.assign(sequence, { complete: code === 0, exitCode: code, ...(notRun ? { notRun } : {}) });
    sequence.resources = { budget: await plan.activeBudget.snapshot() };
    const output = await open(`${selectedReport}.sequence.json`, 'wx');
    try {
      await output.writeFile(`${JSON.stringify(sequence)}\n`);
      await output.sync();
    } finally { await output.close(); }
    console.log(`[test-runner:sequence] ${JSON.stringify(sequence)}`);
    return code;
  };
  const executeStage = async ([stage, selection, output]) => {
    if (!selection.blockers.length && !selection.files.length) {
      sequence.stages.push({ stage, execution: 'not-required', required: 0 });
      return 0;
    }
    if (selection.blockers.length || !selection.files.length) {
      sequence.stages.push({ stage, exitCode: 2, blockers: selection.blockers });
      return 2;
    }
    const selected = stage === 'canonical-units' ? units : await createPlan(parseOptions([
      'targeted', '--workers', String(selection.workers ?? plan.workers), '--name', selection.name, ...selection.files,
    ]), plan.root);
    const exitCode = await run({ ...selected, profile: `critical-${stage}`,
      executionBudget: plan.executionBudget, localExecution: local, localSelection: selection,
      environment: plan.environment },
    { reportPath: output });
    let report;
    try {
      report = JSON.parse(await readFile(output, 'utf8'));
      if (!report || Object.getPrototypeOf(report) !== Object.prototype) {
        report = { kind: 'invalid-partial-report', complete: false, executions: [] };
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      report = { kind: 'missing-partial-report', complete: false, executions: [] };
    }
    const inventory = { cases: selection.cases, unresolved: [],
      files: selection.files.map(file => ({ file })), digest: digest(selection.cases) };
    const platform = { win32: 'windows', darwin: 'macos', linux: 'linux' }[process.platform];
    const reconciliation = reconcileNodeExecution(inventory, report, {
      files: selection.files, platform: `${platform}-${process.arch}`,
    });
    sequence.stages.push({ stage, reportPath: output, exitCode,
      bindings: selection.bindings,
      reconciliation: { status: reconciliation.status, counts: reconciliation.counts,
        blockers: reconciliation.blockers, inventoryDigest: reconciliation.inventoryDigest } });
    return exitCode || (reconciliation.status === 'Passed' ? 0 : 2);
  };
  const canonicalCode = await executeStage(['canonical-units', plan.critical.canonical, unitReport]);
  if (canonicalCode) return finish(canonicalCode, 'critical');
  const unitCodes = await Promise.all(unitStages.map(executeStage));
  if (unitCodes.some(Boolean)) return finish(unitCodes.includes(1) ? 1 : unitCodes.find(Boolean), 'critical');
  const integrationCodes = await Promise.all(integrationStages.map(executeStage));
  if (integrationCodes.some(Boolean)) return finish(integrationCodes.includes(1) ? 1 : integrationCodes.find(Boolean), 'critical');
  return finish(0);
}

export async function run(plan, { reportPath } = {}) {
  const control = plan.profile === 'critical' && !plan.unitFirstComplete;
  const budget = await enterTestBudget({ workers: plan.workers, fileCount: Math.max(1, plan.groups?.length ?? plan.files.length),
    control, ...plan.executionBudget });
  const selected = {
    ...plan, workers: budget.workers, requestedWorkers: plan.workers, activeBudget: budget,
    executionBudget: { inherited: budget.inherited, parent: budget.parent, slot: null },
    testOptions: { ...plan.testOptions, isolation: 'process',
      concurrency: Math.min(budget.workers, Math.max(1, plan.groups?.length ?? plan.files.length)),
      executionGroups: plan.groups,
      executionCapacity: budget.workers,
      execArgv: [...(plan.testOptions.coverage ? ['--experimental-test-coverage'] : []),
        '--import', new URL('./test-budget-worker.mjs', import.meta.url).href] },
  };
  try {
    if (control) return await runCritical(selected, reportPath);
    return await runProducer(selected, { reportPath, budget });
  } finally { await budget.close(); }
}

async function runProducer(plan, { reportPath, budget }) {
  const started = performance.now();
  const dispatchedAt = new Date().toISOString();
  const selectedReport = reportPath ?? process.env.SDLC_TEST_REPORT_FILE ?? await defaultReportPath();
  const metadata = {
    profile: plan.profile, workers: plan.workers,
    files: plan.files.map(file => path.relative(repositoryRoot, file).split(path.sep).join('/')),
    executable: process.execPath, node: process.version,
    platform: process.platform, architecture: process.arch,
    resources: { availableParallelism: availableParallelism(), totalMemoryBytes: totalmem(),
      workerBudget: budget.capacity, requestedWorkers: plan.requestedWorkers,
      fileConcurrency: plan.testOptions.concurrency, budgetId: budget.id },
    reportPath: path.relative(repositoryRoot, selectedReport).split(path.sep).join('/'),
    advisoryMs: plan.profile.startsWith('critical') ? testTimingGuidance.criticalMs :
      plan.profile === 'targeted' ? testTimingGuidance.affectedMs : null,
  };
  console.log(`[test-runner:start] ${JSON.stringify(metadata)}`);
  const env = { ...process.env, ...plan.environment, ...budget.environment };
  if (plan.testOptions.coverage) {
    const coverageWorkspace = path.join(path.dirname(path.resolve(selectedReport)), 'coverage-work');
    await mkdir(coverageWorkspace, { recursive: true });
    Object.assign(env, { TMPDIR: coverageWorkspace, TMP: coverageWorkspace, TEMP: coverageWorkspace });
    delete env.NODE_V8_COVERAGE;
  }
  env.SDLC_TEST_FILE_RESOURCES = JSON.stringify(plan.resourceWeights);
  env.SDLC_TEST_CWD = plan.testOptions.cwd;
  env.SDLC_TEST_REPORT_FILE = selectedReport;
  env.SDLC_TEST_REPORT_PROFILE = plan.profile;
  if (metadata.advisoryMs !== null) env.SDLC_TEST_REPORT_ADVISORY_MS = String(metadata.advisoryMs);
  else delete env.SDLC_TEST_REPORT_ADVISORY_MS;
  env.SDLC_TEST_EVIDENCE_ROOT = path.dirname(path.resolve(selectedReport));
  const command = [process.execPath, ...process.execArgv, ...process.argv.slice(1)];
  env.SDLC_TEST_REPORT_COMMAND = JSON.stringify(command.map((argument, index) =>
    ['--eval', '-e', '--print', '-p'].includes(command[index - 1]) ?
      { kind: 'inline-source', retained: false,
        reason: 'Inline code is not retained; use the actual worker command and source-bound selectors' } : argument));
  // This is a new test run even when a test invokes the public command.
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, plan.args, {
    cwd: repositoryRoot, env, stdio: ['pipe', 'inherit', 'inherit', 'ipc'], shell: false,
  });
  const dispatchedOptions = JSON.parse(JSON.stringify(plan.testOptions));
  let interruption;
  const interrupted = signal => {
    interruption ??= signal;
    if (child.connected) {
      child.send({ type: 'cancel', signal }, error => {
        if (error) console.error(`[test-runner:error] Cancellation delivery failed: ${error.message}`);
      });
    } else if (child.exitCode === null && child.signalCode === null) {
      console.error('[test-runner:error] Cancellation channel closed before the worker exited.');
    }
  };
  const interrupt = () => interrupted('SIGINT');
  const terminate = () => interrupted('SIGTERM');
  const lostAllocation = () => interrupted('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  budget.signal.addEventListener('abort', lostAllocation, { once: true });
  if (budget.signal.aborted) lostAllocation();
  try {
    let closed;
    const stopped = new Promise(resolve => {
      child.once('close', (code, signal) => {
        closed = { code, signal };
        resolve(closed);
      });
    });
    let result;
    try { result = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.stdin.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
      child.stdin.end(JSON.stringify(dispatchedOptions));
    }); } catch (error) {
      if (!closed && child.pid) {
        child.kill('SIGTERM');
        await stopped;
      }
      throw error;
    }
    const childCode = result.code ?? (128 + (constants.signals[result.signal] ?? 1));
    const exitCode = interruption && childCode === 0 ? 128 + constants.signals[interruption] : childCode;
    console.log(`[test-runner:end] ${JSON.stringify({
      ...metadata, elapsedMs: Math.round(performance.now() - started),
      timingIsAdvisory: true,
      exitCode, signal: result.signal, interruptedBy: interruption ?? null,
    })}`);
    if (plan.localExecution) await recordLocalExecution(plan.localExecution, {
      child, reportPath: selectedReport, selection: plan.localSelection, exitCode,
      interruptedBy: interruption, startedAt: dispatchedAt, finishedAt: new Date().toISOString(),
      options: dispatchedOptions, budget: await plan.activeBudget.snapshot(),
    });
    return exitCode;
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
    budget.signal.removeEventListener('abort', lostAllocation);
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    process.exitCode = await run(await createPlan(parseOptions(process.argv.slice(2))));
  } catch (error) {
    console.error(`[test-runner:error] ${error.message}`);
    process.exitCode = 1;
  }
}
