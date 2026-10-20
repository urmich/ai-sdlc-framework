import { readFile, mkdir, open, realpath, readdir, lstat, readlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { requireThat, digest } from '../src/core.mjs';
import { validateReadinessData } from '../src/validation-readiness.mjs';
import { createPlan, parseOptions, repositoryRoot, run } from './test-runner.mjs';
import { compileValidationInventory, reconcileNodeExecution, requiredFileWorkers } from './validation-inventory.mjs';
import { exactPattern } from './test-profiles.mjs';
import { enterTestBudget } from './test-budget.mjs';
import { scheduleValidationFiles, validationExecutionGroups, validationGroupProtocol,
  validationSchedulingPolicyDigest } from './test-scheduling.mjs';
import { safePath } from '../src/files.mjs';
import { captureLocalSourceInputs } from './test-local-evidence.mjs';

const verifiedMeasurements = new WeakMap();
const requiredSlots = ['full:1', 'full:2', 'focused:1', 'focused:2'];
const invariantFields = ['native', 'toolchain', 'resources', 'workers', 'cache', 'environmentPolicyDigest'];
function measurementFacts(value) {
  return { measurementDigest: digest(value) };
}
function validMeasurement(value) {
  try { validateReadinessData(value, 1024 * 1024); }
  catch (error) {
    if (['INPUT', 'UNSAFE', 'CAPACITY'].includes(error.code)) return false;
    throw error;
  }
  const hash = /^[a-f0-9]{64}$/u;
  return value && Object.getPrototypeOf(value) === Object.prototype &&
    Object.values(Object.getOwnPropertyDescriptors(value)).every(field => Object.hasOwn(field, 'value')) &&
    ['reportDigest', 'sourceDigest', 'testSpecDigest', 'configurationDigest',
      'assertionsDigest', 'environmentPolicyDigest'].every(field => hash.test(value[field] ?? '')) &&
    ['full', 'focused'].includes(value.scope) && [1, 2].includes(value.repeat) &&
    typeof value.complete === 'boolean' && Number.isFinite(value.wallMs) && value.wallMs > 0 &&
    Number.isFinite(Date.parse(value.startedAt)) && Number.isFinite(Date.parse(value.finishedAt)) &&
    Date.parse(value.finishedAt) >= Date.parse(value.startedAt) &&
    Number.isInteger(value.workers) && value.workers > 0 && value.workers <= 32 &&
    ['cold', 'warm'].includes(value.cache) &&
    ['native', 'toolchain', 'resources', 'counts'].every(field => value[field] &&
      Object.getPrototypeOf(value[field]) === Object.prototype) &&
    ['linux', 'win32', 'darwin'].includes(value.native.platform) &&
    ['x64', 'arm64'].includes(value.native.architecture) &&
    typeof value.native.image === 'string' && value.native.image.trim() &&
    typeof value.toolchain.node === 'string' && value.toolchain.node.trim() &&
    typeof value.toolchain.executable === 'string' && value.toolchain.executable.trim() &&
    Number.isSafeInteger(value.resources.availableParallelism) && value.resources.availableParallelism > 0 &&
    Number.isSafeInteger(value.resources.totalMemoryBytes) && value.resources.totalMemoryBytes > 0 &&
    Number.isInteger(value.resources.capacity) && value.resources.capacity > 0 &&
    value.resources.capacity <= 32 && value.workers <= value.resources.capacity &&
    ['required', 'passed', 'failed', 'skipped', 'cancelled'].every(field =>
      Number.isSafeInteger(value.counts[field]) && value.counts[field] >= 0) &&
    Array.isArray(value.assertions) && value.assertions.every(test =>
      test && typeof test.id === 'string' && hash.test(test.definitionDigest) &&
      hash.test(test.applicabilityDigest) &&
      Number.isInteger(test.resourceWorkers) && test.resourceWorkers > 0 && test.resourceWorkers <= 32 &&
      typeof test.applicable === 'boolean' && Array.isArray(test.platforms) && test.platforms.length > 0 &&
      test.platforms.every(platform => ['linux-x64', 'windows-x64', 'macos-arm64', 'macos-x64'].includes(platform)) &&
      ['Passed', 'Failed', 'Skipped', 'Todo', 'Cancelled', 'NotRun'].includes(test.status)) &&
    Array.isArray(value.unexpectedSkips);
}
export function compareValidationBenchmarks({ baseline, candidate, originalAssertionIds,
  focusedAssertionIds, addedAssertionIds = [] }, verifyMeasurement) {
  requireThat(Array.isArray(originalAssertionIds) && originalAssertionIds.length > 0 &&
    new Set(originalAssertionIds).size === originalAssertionIds.length &&
    Array.isArray(focusedAssertionIds) && focusedAssertionIds.length > 0 &&
    focusedAssertionIds.every(id => originalAssertionIds.includes(id)) &&
    new Set(focusedAssertionIds).size === focusedAssertionIds.length,
  'INPUT', 'Benchmark comparison requires complete original and focused assertion identities');
  const blockers = [];
  let failure = false;
  const trusted = new Map();
  for (const [version, input] of Object.entries({ baseline, candidate })) {
    requireThat(input && Array.isArray(input.measurements), 'INPUT', 'Supply both original measurement sets');
    const slots = input.measurements.map(value => `${value?.scope}:${value?.repeat}`);
    if (slots.length !== requiredSlots.length || new Set(slots).size !== slots.length ||
      requiredSlots.some(slot => !slots.includes(slot))) blockers.push({
      code: 'MISSING_OR_DUPLICATE_MEASUREMENT', version,
    });
    for (const value of input.measurements) {
      if (!validMeasurement(value)) {
        blockers.push({ code: 'INVALID_BENCHMARK_MEASUREMENT', version });
        continue;
      }
      const slot = `${value.scope}:${value.repeat}`;
      const proof = verifiedMeasurements.get(value) ?? verifyMeasurement?.(Object.freeze({
        version, measurement: value, facts: measurementFacts(value),
      }));
      if (!proof || digest(proof) !== digest(measurementFacts(value))) {
        blockers.push({ code: 'UNVERIFIED_BENCHMARK_MEASUREMENT', version, slot });
        continue;
      }
      trusted.set(`${version}:${slot}`, value);
      const expected = value.scope === 'full' ? originalAssertionIds : focusedAssertionIds;
      if (new Set(value.assertions.map(test => test.id)).size !== expected.length ||
        value.assertions.length !== expected.length ||
        expected.some(id => !value.assertions.some(test => test.id === id)) ||
        value.assertionsDigest !== digest(value.assertions) ||
        value.sourceDigest !== input.sourceDigest) blockers.push({
        code: 'CHANGED_BENCHMARK_ASSERTION_INVENTORY', version, slot,
      });
      if (value.complete !== true || !Number.isFinite(value.wallMs) || value.wallMs <= 0 ||
        !value.counts || value.counts.required !== expected.length ||
        value.counts.passed + value.counts.failed + value.counts.skipped !== value.counts.required ||
        value.counts.cancelled !== 0 || value.unexpectedSkips?.length ||
        value.exitCode !== 0 || value.counts.failed > 0) {
        blockers.push({ code: 'INCOMPLETE_OR_FAILED_BENCHMARK_MEASUREMENT', version, slot });
        failure ||= value.counts?.failed > 0;
      }
      const platform = `${{ linux: 'linux', win32: 'windows', darwin: 'macos' }[value.native.platform]}-${value.native.architecture}`;
      const derived = {
        passed: value.assertions.filter(test => test.status === 'Passed').length,
        failed: value.assertions.filter(test => test.status === 'Failed').length,
        skipped: value.assertions.filter(test => !['Passed', 'Failed'].includes(test.status)).length,
      };
      if (Object.entries(derived).some(([field, count]) => value.counts[field] !== count) ||
        value.assertions.some(test => test.applicable !== test.platforms.includes(platform) ||
          test.applicable && test.status !== 'Passed')) blockers.push({
        code: 'BENCHMARK_OUTCOME_OR_APPLICABILITY_MISMATCH', version, slot,
      });
      failure ||= derived.failed > 0;
      if (value.cache !== (value.repeat === 1 ? 'cold' : 'warm')) blockers.push({
        code: 'UNCONTROLLED_BENCHMARK_CACHE', version, slot,
      });
      const first = input.measurements.find(item => item?.scope === value.scope && item.repeat === 1);
      if (!value.cacheEvidence || !Number.isSafeInteger(value.cacheEvidence.files) ||
        value.cacheEvidence.files < 0 || !/^[a-f0-9]{64}$/u.test(value.cacheEvidence.digest ?? '') ||
        value.cache === 'cold' && (value.cacheEvidence.files !== 0 ||
          value.cacheEvidence.digest !== digest([]) || value.cacheEvidence.seededFrom !== null) ||
        value.cache === 'warm' && (value.cacheEvidence.seededFrom !== first?.reportDigest ||
          Date.parse(value.startedAt) < Date.parse(first?.finishedAt))) blockers.push({
        code: 'UNCONTROLLED_BENCHMARK_CACHE', version, slot,
      });
    }
    const intervals = [...trusted.values()].sort((left, right) =>
      Date.parse(left.startedAt) - Date.parse(right.startedAt));
    for (let index = 1; index < intervals.length; index++) if (
      Date.parse(intervals[index].startedAt) < Date.parse(intervals[index - 1].finishedAt)) blockers.push({
      code: 'OVERLAPPING_BENCHMARK_MEASUREMENTS',
    });
  }
  for (const slot of requiredSlots) {
    const left = trusted.get(`baseline:${slot}`);
    const right = trusted.get(`candidate:${slot}`);
    if (!left || !right) continue;
    for (const field of [...invariantFields, 'testSpecDigest', 'configurationDigest']) {
      if (digest(left[field]) !== digest(right[field])) blockers.push({
        code: 'UNLIKE_BENCHMARK_CONDITIONS', slot, field,
      });
    }
    const definitions = value => value.assertions.map(test =>
      [test.id, test.definitionDigest, test.applicabilityDigest, test.resourceWorkers, test.platforms])
      .sort(([left], [right]) => left.localeCompare(right, 'en'));
    if (digest(definitions(left)) !== digest(definitions(right))) blockers.push({
      code: 'CHANGED_ORIGINAL_ASSERTION_DEFINITIONS', slot,
    });
  }
  const status = failure ? 'Failed' : blockers.length ? 'NotRun' : 'Passed';
  const comparisons = status === 'Passed' ? requiredSlots.map(slot => {
    const [scope, repeat] = slot.split(':');
    const left = trusted.get(`baseline:${slot}`);
    const right = trusted.get(`candidate:${slot}`);
    return { scope, repeat: Number(repeat), baselineMs: left.wallMs, candidateMs: right.wallMs,
      deltaMs: right.wallMs - left.wallMs, ratio: right.wallMs / left.wallMs };
  }) : [];
  return { schemaVersion: 1, kind: 'validation-benchmark-comparison', status,
    comparability: status === 'Passed' ? 'equivalent' : 'rejected',
    baseline, candidate, originalAssertionIds, focusedAssertionIds, addedAssertionIds,
    comparisons, blockers, authority: 'measurement-only',
    limitations: [
      'Timing is advisory; a complete comparison does not assert a speedup or authorize publication.',
      'Serialized measurement flags are not host verification; replay needs independently verified original reports.',
      'Cold/warm refers to the owned application-cache roots; OS caches are not flushed or asserted.',
    ] };
}
async function immutable(file, value) {
  const output = await open(file, 'wx');
  try { await output.writeFile(`${JSON.stringify(value)}\n`); await output.sync(); }
  finally { await output.close(); }
}
function signature(cases) {
  return cases.map(test => ({ id: test.id, definitionDigest: test.definitionDigest,
    applicabilityDigest: digest(test.applicability), resourceWorkers: test.resourceWorkers ?? 1,
    platforms: test.applicability.platforms }))
    .sort((left, right) => left.id.localeCompare(right.id, 'en'));
}
async function verifyBudgetProtocol(root) {
  for (const file of ['test-budget.mjs', 'test-budget-worker.mjs']) {
    requireThat(digest(await readFile(path.join(root, 'scripts', file))) ===
      digest(await readFile(new URL(file, import.meta.url))), 'EVIDENCE',
    'Both benchmark workspaces must use the same adopted aggregate budget protocol');
  }
  const runner = await readFile(path.join(root, 'scripts', 'test-runner.mjs'), 'utf8');
  requireThat(runner.includes("from './test-budget.mjs'") &&
    runner.includes('enterTestBudget('), 'EVIDENCE',
  'A legacy unbudgeted nested runner cannot be measured as an equivalent allocated host');
}
export async function captureBenchmarkCache(root) {
  const files = [];
  async function walk(relative) {
    const absolute = path.join(root, relative);
    const info = await lstat(absolute);
    requireThat(files.length < 10000 && info.size < 64 * 1024 * 1024,
      'CAPACITY', 'Benchmark cache observation exceeds its bounded owned input set');
    if (info.isSymbolicLink()) files.push([relative, digest(await readlink(absolute))]);
    else if (info.isDirectory()) {
      for (const entry of await readdir(absolute)) await walk(path.join(relative, entry));
    } else if (info.isFile()) files.push([relative, digest(await readFile(absolute))]);
  }
  await walk('');
  files.sort(([left], [right]) => left.localeCompare(right, 'en'));
  return { files: files.length, digest: digest(files) };
}
export async function runValidationBenchmark({ baselineRoot, candidateRoot, outputDirectory,
  workers, focusedAssertionIds }) {
  requireThat(Number.isInteger(workers) && workers > 0 && workers <= 32,
    'INPUT', 'Benchmark allocation is explicit and bounded to 1..32 workers');
  const roots = { baseline: await realpath(baselineRoot), candidate: await realpath(candidateRoot) };
  requireThat(roots.baseline !== roots.candidate, 'INPUT', 'Benchmark versions need independent owned workspaces');
  await Promise.all(Object.values(roots).map(verifyBudgetProtocol));
  const adoptedInventories = Object.fromEntries(await Promise.all(Object.entries(roots).map(async ([version, root]) => {
    const inventory = await compileValidationInventory(root);
    requireThat(inventory.complete && !inventory.nodeUnresolved.length, 'INVENTORY',
      'Benchmark declarations and executable-surface inventory must be complete before measurement');
    return [version, inventory];
  })));
  const inventories = Object.fromEntries(Object.entries(adoptedInventories).map(([version, inventory]) =>
    [version, { ...inventory, cases: inventory.cases.map(test => ({
      ...test, resourceWorkers: requiredFileWorkers({ cases: [test],
        resources: inventory.resourceRequirements.find(requirement => requirement.file === test.file) }),
    })) }]));
  const originals = inventories.baseline.cases.map(test => test.id);
  requireThat(Array.isArray(focusedAssertionIds) && focusedAssertionIds.length > 0 &&
    focusedAssertionIds.every(id => originals.includes(id)), 'INPUT', 'Select exact original focused assertions');
  const candidateOriginals = inventories.candidate.cases.filter(test => originals.includes(test.id));
  requireThat(digest(signature(inventories.baseline.cases)) === digest(signature(candidateOriginals)),
    'INVENTORY', 'Changed or missing original assertions cannot create a comparable benchmark');
  const focusedRoots = new Set(inventories.baseline.cases.filter(test => focusedAssertionIds.includes(test.id))
    .map(test => JSON.stringify([test.file, test.parents[0] ?? test.name])));
  const requestedFocusedAssertionIds = [...focusedAssertionIds];
  focusedAssertionIds = inventories.baseline.cases.filter(test =>
    focusedRoots.has(JSON.stringify([test.file, test.parents[0] ?? test.name]))).map(test => test.id);
  const sources = Object.fromEntries(await Promise.all(Object.entries(roots).map(async ([version, root]) =>
    [version, await captureLocalSourceInputs(root)])));
  const output = await safePath(repositoryRoot, path.relative(repositoryRoot, path.resolve(outputDirectory)));
  const evidenceRoot = path.join(repositoryRoot, '.test-data');
  const relative = path.relative(evidenceRoot, output);
  requireThat(relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
    'PATH', 'Benchmark evidence stays in the runner host repository-local evidence directory');
  const directory = path.join(output, randomUUID());
  await mkdir(directory, { recursive: true });
  const allocation = await enterTestBudget({ workers, control: true });
  const resultSets = { baseline: { sourceDigest: sources.baseline.contentDigest, measurements: [] },
    candidate: { sourceDigest: sources.candidate.contentDigest, measurements: [] } };
  try {
    requireThat(allocation.workers === workers && allocation.capacity >= workers, 'BUDGET',
      'The explicit comparable benchmark allocation is unavailable in this ancestor scope');
    measurements: for (const scope of ['full', 'focused']) for (const repeat of [1, 2]) {
      for (const version of ['baseline', 'candidate']) {
        const inventory = inventories[version];
        const expected = scope === 'full' ? originals : focusedAssertionIds;
        const cases = inventory.cases.filter(test => expected.includes(test.id));
        const files = scheduleValidationFiles(inventory, { files: [...new Set(cases.map(test => test.file))] });
        const extra = inventory.cases.filter(test => !expected.includes(test.id) && files.includes(test.file));
        const cache = repeat === 1 ? 'cold' : 'warm';
        const cacheRoot = path.join(directory, 'cache', version, scope);
        await mkdir(cacheRoot, { recursive: true });
        const cacheBefore = await captureBenchmarkCache(cacheRoot);
        const reportPath = path.join(directory, `${version}-${scope}-${repeat}.json`);
        const plan = await createPlan(parseOptions(['targeted', '--workers', String(workers),
          '--name', exactPattern(cases.map(test => [...test.parents, test.name].join(' '))), ...files]),
        roots[version]);
        plan.testOptions.testSkipPatterns = extra.length ?
          [exactPattern(extra.map(test => [...test.parents, test.name].join(' ')))] : [];
        const groups = validationExecutionGroups(adoptedInventories[version],
          { files, pattern: plan.name, preserveOrder: true });
        plan.executionBudget = { inherited: allocation.inherited, parent: allocation.parent, slot: null };
        plan.environment = {
          HOME: path.join(cacheRoot, 'home'), USERPROFILE: path.join(cacheRoot, 'home'),
          COPILOT_HOME: path.join(cacheRoot, 'copilot'), XDG_CONFIG_HOME: path.join(cacheRoot, 'config'),
          XDG_CACHE_HOME: path.join(cacheRoot, 'cache'), npm_config_cache: path.join(cacheRoot, 'npm'),
          NODE_COMPILE_CACHE: path.join(cacheRoot, 'node-compile'),
          GOCACHE: path.join(cacheRoot, 'go'), GOMODCACHE: path.join(cacheRoot, 'gomod'),
          PYTHONPYCACHEPREFIX: path.join(cacheRoot, 'python'),
        };
        const startedAt = new Date().toISOString();
        const started = performance.now();
        await Promise.all(Object.values(plan.environment).map(directory => mkdir(directory, { recursive: true })));
        let exitCode = 2;
        let problem = null;
        try { exitCode = await run(plan, { reportPath }); }
        catch (error) {
          if (!['BUDGET', 'EVIDENCE', 'INVENTORY', 'PATH', 'STALE', 'ENOENT'].includes(error.code)) throw error;
          problem = { code: error.code, message: 'The original measurement did not complete; its available output remains retained.' };
        }
        const wallMs = performance.now() - started;
        const finishedAt = new Date().toISOString();
        let bytes;
        let report;
        try { bytes = await readFile(reportPath); report = JSON.parse(bytes.toString('utf8')); }
        catch (error) {
          if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
          problem = { code: error.code ?? 'INVALID_PARTIAL_REPORT',
            message: 'Required original measurement output is missing or incomplete.' };
        }
        const platform = `${{ linux: 'linux', win32: 'windows', darwin: 'macos' }[process.platform]}-${process.arch}`;
        const reconciliation = report && Object.getPrototypeOf(report) === Object.prototype ?
          reconcileNodeExecution({ ...inventory, cases }, report, { platform, files }) :
          { status: 'NotRun', cases: [] };
        const after = await captureLocalSourceInputs(roots[version]);
        const observations = cases.map(test => {
          const row = report?.executions?.find(row => row.file === test.file && row.name === test.name &&
            digest(row.parents) === digest(test.parents));
          return { id: test.id, definitionDigest: test.definitionDigest,
            applicabilityDigest: digest(test.applicability), resourceWorkers: test.resourceWorkers,
            platforms: test.applicability.platforms, applicable: test.applicability.platforms.includes(platform),
            status: row?.status ?? 'NotRun' };
        }).sort((left, right) => left.id.localeCompare(right.id, 'en'));
        const budgetState = await allocation.snapshot();
        requireThat(Number.isInteger(budgetState.version) && budgetState.version > 0 &&
          typeof budgetState.allocationPolicy === 'string' && budgetState.allocationPolicy,
        'BUDGET', 'Benchmark measurements require the actual allocated budget protocol identity');
        const completion = { report: !problem && report?.complete === true,
          assertions: reconciliation.status === 'Passed',
          source: after.contentDigest === sources[version].contentDigest,
          allocation: report?.resources?.budget?.id === allocation.id &&
            report.resources.budget.version === budgetState.version &&
            report.resources.budget.allocationPolicy === budgetState.allocationPolicy,
          groups: report?.groupExecution?.protocol === validationGroupProtocol &&
            report.groupExecution.selectionDigest === digest(groups),
          concurrency: report?.selection?.concurrency === Math.min(workers, groups.length) };
        const measurement = {
          scope, repeat, cache, sourceDigest: sources[version].contentDigest,
          reportDigest: bytes ? digest(bytes) : null, testSpecDigest: digest(signature(cases)),
          configurationDigest: digest({ scope, repeat, originalIds: [...expected].sort(),
            policy: validationSchedulingPolicyDigest(), groupSelectionDigest: digest(groups) }),
          inventoryDigest: digest(signature(cases)), assertions: observations,
          assertionsDigest: digest(observations), complete: Object.values(completion).every(Boolean), completion,
          exitCode, wallMs, startedAt, finishedAt,
          counts: { required: cases.length, passed: observations.filter(test => test.status === 'Passed').length,
            failed: observations.filter(test => test.status === 'Failed').length,
            skipped: observations.filter(test => test.status !== 'Passed' && test.status !== 'Failed').length,
            cancelled: report?.summary?.counts?.cancelled ?? 0 },
          unexpectedSkips: reconciliation.cases.filter(test => test.status === 'NotRun').map(test => test.assertionId),
          native: { platform: process.platform, architecture: process.arch, image: `${os.type()} ${os.release()}` },
          toolchain: { node: process.version, executable: process.execPath },
          resources: { availableParallelism: os.availableParallelism(), totalMemoryBytes: os.totalmem(),
            capacity: allocation.capacity, policy: budgetState.allocationPolicy, protocolVersion: budgetState.version },
          workers, fileConcurrency: report?.selection?.concurrency ?? null,
          cacheEvidence: { ...cacheBefore, seededFrom: repeat === 1 ? null :
            resultSets[version].measurements.find(item => item.scope === scope && item.repeat === 1)?.reportDigest ?? null },
          environmentPolicyDigest: digest({ isolatedHome: true, sharedWarmCache: repeat === 2, scope }),
          reportPath, problem,
        };
        if (bytes && report && !problem) verifiedMeasurements.set(measurement, measurementFacts(measurement));
        resultSets[version].measurements.push(measurement);
        await immutable(`${reportPath}.measurement.json`, measurement);
        if (!measurement.complete || exitCode !== 0) break measurements;
      }
    }
  } finally { await allocation.close(); }
  const comparison = compareValidationBenchmarks({
    ...resultSets, originalAssertionIds: originals, focusedAssertionIds,
    addedAssertionIds: inventories.candidate.cases.filter(test => !originals.includes(test.id)).map(test => test.id),
  });
  comparison.requestedFocusedAssertionIds = requestedFocusedAssertionIds;
  const comparisonPath = path.join(directory, 'benchmark-comparison.json');
  await immutable(comparisonPath, comparison);
  return { comparison, comparisonPath };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const flags = new Map();
    for (let index = 2; index < process.argv.length; index += 2) {
      const key = process.argv[index];
      requireThat(['--baseline', '--candidate', '--output', '--workers', '--focused'].includes(key) &&
        !flags.has(key) && process.argv[index + 1], 'INPUT', 'Supply unique literal benchmark arguments');
      flags.set(key, process.argv[index + 1]);
    }
    const result = await runValidationBenchmark({
      baselineRoot: flags.get('--baseline'), candidateRoot: flags.get('--candidate'),
      outputDirectory: flags.get('--output'), workers: Number(flags.get('--workers')),
      focusedAssertionIds: JSON.parse(flags.get('--focused')),
    });
    console.log(JSON.stringify({ comparisonPath: result.comparisonPath, status: result.comparison.status }));
    process.exitCode = result.comparison.status === 'Passed' ? 0 : result.comparison.status === 'Failed' ? 1 : 2;
  } catch (error) {
    console.error(`[validation-benchmark:error] ${error.code ?? 'ERROR'}: ${error.message}`);
    process.exitCode = 2;
  }
}
