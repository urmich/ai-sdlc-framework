import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonical, digest, requireThat, safeSummary } from '../src/core.mjs';
import { parseTestPlan, testSpecificationDigest } from '../src/artifacts.mjs';
import { readEvidenceBundle, renderReadinessReport,
  sanitizeExecutionPayload, validationInventoryDigest } from 'ai-sdlc-framework/evidence';
import { validateRetainedEvidenceBundle } from '../src/validation-readiness.mjs';
import { emptyDirectory, options, writeJson } from './release-bundle.mjs';
import { compileValidationInventory } from './validation-inventory.mjs';
import { deriveLocalSanitySpecification } from './test-local-evidence.mjs';

const stages = ['L', 'PR', 'R-PRE', 'R-POST', 'A'];
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outcome = value => ['Passed', 'Failed', 'NotRun'].includes(value) ? value : 'NotRun';
const hash = value => /^[a-f0-9]{64}$/u.test(value ?? '');
const membership = {
  PR: ['T-PRD014-LX', 'T-PRD014-WX', 'T-PRD014-MA', 'T-PRD014-MI', 'T-PRD060-MA', 'T-PRD060-MI', 'T-PRD087'],
  'R-PRE': ['T-PRD079-LX', 'T-PRD079-WX', 'T-PRD079-MA', 'T-PRD079-MI'],
  'R-POST': ['T-PRD038-WX', 'T-PRD038-MA', 'T-PRD038-MI', 'T-PRD039-WX', 'T-PRD039-MA', 'T-PRD039-MI', 'T-PRD042'],
  A: ['T-PRD012', 'T-PRD025', 'T-PRD026', 'T-PRD050', 'T-PRD053', 'T-PRD055', 'T-PRD056', 'T-PRD074', 'T-PRD081', 'T-PRD086', 'T-PRD089'],
  OBSERVERS: ['T-PRD019'],
};

function catalog(plan, localInventory, localPlatform) {
  const definitions = parseTestPlan(plan);
  const ids = new Set(definitions.map(test => test.id));
  requireThat(ids.size === definitions.length, 'RELEASE_REPORT', 'Canonical readiness cases must have unique identities');
  for (const id of Object.values(membership).flat()) requireThat(ids.has(id), 'RELEASE_REPORT',
    `The canonical report definition is missing ${id}`);
  const assigned = new Set(Object.values(membership).flat());
  const components = definitions.filter(test => !assigned.has(test.id));
  requireThat(components.every(test => test.mode === 'automated'), 'RELEASE_REPORT',
    'A new procedural readiness case requires an explicit acceptance profile, not implicit PR execution');
  const local = localInventory ?
    deriveLocalSanitySpecification({ inventory: localInventory, testPlan: plan, platform: localPlatform }) : null;
  return { definitions, local, membership: { ...membership,
    L: ['T-LOCAL-REGRESSIONS'], PR: [...membership.PR, ...components.map(test => test.id)] } };
}

function reference(value) {
  requireThat(value && /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/u.test(value.id ?? '') &&
    typeof value.filename === 'string' && /^[A-Za-z0-9_./+-]+$/u.test(value.filename) &&
    !value.filename.includes('\\') && !value.filename.startsWith('/') &&
    !value.filename.split('/').some(part => !part || part === '.' || part === '..') &&
    hash(value.sha256) && Number.isSafeInteger(value.size) && value.size >= 0 && value.size <= 64 * 1024 * 1024,
  'RELEASE_REPORT', 'Readiness composition requires a bounded immutable data reference');
  return value;
}

export async function fileReportReader(directory) {
  const rootStat = await fs.lstat(directory);
  requireThat(rootStat.isDirectory() && !rootStat.isSymbolicLink(), 'RELEASE_REPORT',
    'Report input root must be a literal directory');
  const root = await fs.realpath(directory);
  return async input => {
    const ref = reference(input);
    const file = path.join(root, ...ref.filename.split('/'));
    const stat = await fs.lstat(file);
    const actual = await fs.realpath(file);
    const relative = path.relative(root, actual);
    requireThat(stat.isFile() && !stat.isSymbolicLink() && relative && !relative.startsWith('..') &&
      !path.isAbsolute(relative) && stat.size === ref.size, 'RELEASE_REPORT', 'Report input escaped or changed');
    const bytes = await fs.readFile(file);
    requireThat(digest(bytes) === ref.sha256, 'RELEASE_REPORT', 'Readiness input digest differs');
    return bytes;
  };
}

async function inputJson(ref, read) {
  reference(ref);
  const bytes = await read(ref);
  requireThat(bytes instanceof Uint8Array && bytes.length === ref.size && digest(Buffer.from(bytes)) === ref.sha256,
    'RELEASE_REPORT', 'A retained report input is missing, corrupt or oversized');
  const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  return { data, bytes };
}

async function inputData(ref, read) {
  const { data, bytes } = await inputJson(ref, read);
  requireThat(digest(sanitizeExecutionPayload(Buffer.from(bytes))) === digest(data),
    'RELEASE_REPORT', 'A report input contains unsafe diagnostics or identity material; retain a sanitized producer record');
  return data;
}

async function inputBundle(ref, read) {
  const { data } = await inputJson(ref, read);
  // Reference bundles use the SDK's per-object bounds, not a single log-payload limit.
  return { bundle: data, retained: validateRetainedEvidenceBundle(data) };
}

async function verifiedObservation(ref, read, verifier, expected) {
  const data = await inputData(ref, read);
  if (typeof verifier !== 'function') return { status: 'NotRun', data, reason: 'Independent origin verification unavailable' };
  const proof = await verifier({ data, sha256: ref.sha256, expected });
  requireThat(proof && proof.reportDigest === ref.sha256 && proof.bindingDigest === digest(expected),
    'RELEASE_REPORT', 'Observation does not match independently selected report inputs');
  return { status: 'Verified', data, origin: { verifierId: proof.verifierId ?? 'trusted-host',
    reportDigest: proof.reportDigest, bindingDigest: proof.bindingDigest,
    assessment: outcome(proof.outcome) } };
}

export async function composeReadinessReport({ manifest, plan, read, expectations = {}, verifiers = {},
  localInventory, localPlatform, benchmarkVerifier, protectionVerifier, releaseVerifier,
  now = new Date().toISOString() }) {
  requireThat(manifest?.schemaVersion === 1 && manifest.kind === 'repository-readiness-inputs' &&
    typeof read === 'function' && Number.isFinite(Date.parse(now)) &&
    /^[a-f0-9]{40}$/u.test(manifest.candidate?.sourceCommit ?? '') &&
    (manifest.candidate.sourceDigest === undefined || hash(manifest.candidate.sourceDigest)) &&
    (manifest.candidate.configurationDigest === undefined || hash(manifest.candidate.configurationDigest)) &&
    manifest.candidate.testSpecDigest === testSpecificationDigest(plan),
  'RELEASE_REPORT', 'Select the exact current source and authoritative complete Test Plan before composing readiness');
  const { definitions, local, membership: required } = catalog(plan, localInventory, localPlatform);
  requireThat(digest(sanitizeExecutionPayload(Buffer.from(canonical(manifest)))) === digest(manifest),
    'RELEASE_REPORT', 'Input manifest contains unsafe links or diagnostics');
  const result = { schemaVersion: 2, kind: 'repository-readiness-report', candidate: manifest.candidate,
    generatedAt: now, generationStatus: 'Complete', authority: 'observation-only',
    logicalPlanCases: definitions.length,
    localSanity: { policy: local?.policy ?? 'finite-local-sanity-v1',
      requiredAssertions: local?.requiredAssertionIds.length ?? null, metrics: local?.metrics ?? null },
    checkpoints: [], observers: [], benchmark: { status: 'NotRun' }, protections: { status: 'NotRun' },
    releaseHistory: [], limitations: [...(manifest.limitations ?? [])], blockers: [] };
  const readable = [`# Repository readiness\n\nSource: \`${manifest.candidate.sourceCommit}\`\n\n` +
    'This generated projection grants no lifecycle, merge, publication or deployment authority.\n'];
  for (const stage of [...stages, 'OBSERVERS']) {
    const cases = required[stage].map(testId => ({ testId, status: 'NotRun', diagnostics: ['No matching current execution'] }));
    const section = { stage, cases, status: 'NotRun', blockers: [], reports: [], additionalChecks: [] };
    if (stage === 'L') {
      section.scope = 'finite-local-sanity';
      if (!local) section.blockers.push('Independent source-derived finite local sanity expectations are unavailable');
    }
    const seen = new Set();
    for (const ref of manifest.checkpoints?.[stage] ?? []) {
      try {
        const { bundle, retained } = await inputBundle(ref, read);
        const independent = expectations[ref.id];
        if (!independent) section.blockers.push(`Independent current expectation is missing: ${ref.id}`);
        const expected = independent ?? { specification: retained.specification,
          context: { ...retained.context, now } };
        if (independent) for (const execution of independent.context.executions) {
          requireThat(execution.context.sources.length === 1 &&
            execution.context.sources[0].revision === manifest.candidate.sourceCommit &&
            execution.context.testSpecDigest === manifest.candidate.testSpecDigest &&
            (manifest.candidate.sourceDigest === undefined ||
              execution.context.sources[0].contentDigest === manifest.candidate.sourceDigest) &&
            (manifest.candidate.configurationDigest === undefined ||
              execution.context.configDigest === manifest.candidate.configurationDigest),
          'RELEASE_REPORT', 'A joined input belongs to another independently selected source, specification or configuration');
          if (stage === 'L') requireThat(local &&
            independent.context.profile === local.specification.profile &&
            execution.context.profile === local.specification.profile &&
            execution.context.environment === 'local' && execution.context.mode === 'automated' &&
            execution.context.owner === 'agent' && execution.context.location === 'development-machine',
          'RELEASE_REPORT', 'A local input differs from the independent finite sanity execution profile or host role');
        }
        const replay = readEvidenceBundle(bundle, { specification: expected.specification,
          context: { ...expected.context, now } }, independent ? verifiers[ref.id] : undefined);
        if (!verifiers[ref.id]) section.blockers.push(`Unverified producer: ${ref.id}`);
        if (stage === 'L') requireThat(local &&
          replay.retainedSpecification.profile === local.specification.profile,
        'RELEASE_REPORT', 'A local input belongs to another finite sanity execution profile');
        for (const test of replay.retainedSpecification.cases) {
          if (stage === 'L') {
            if (test.id === 'T-LOCAL-AFFECTED') {
              const base = local.specification.cases[0];
              requireThat(independent && verifiers[ref.id] &&
                ['executionId', 'mode', 'owner', 'location', 'checkpoint'].every(key => test[key] === base[key]),
              'RELEASE_REPORT',
                'Optional affected observations require their independent specification and verified origin');
              continue;
            }
            requireThat(local && test.id === 'T-LOCAL-REGRESSIONS' &&
              validationInventoryDigest({ ...local.specification, cases: [test] }) ===
                validationInventoryDigest(local.specification),
            'RELEASE_REPORT', 'A local input differs from independent finite local sanity source definitions');
            continue;
          }
          const definition = definitions.find(row => row.id === test.id);
          requireThat(required[stage].includes(test.id) && definition &&
            test.expectedDigest === digest(definition.expected) &&
            digest([...test.conditions].sort()) === digest([...definition.conditions].sort()) &&
            test.mode === definition.mode && test.owner === definition.owner &&
            test.location === definition.location && test.checkpoint === definition.checkpoint,
          'RELEASE_REPORT', 'A retained profile changes the canonical checkpoint denominator or expected result');
        }
        const accepted = [];
        for (const test of replay.evaluation.cases) {
          if (stage === 'L' && test.testId === 'T-LOCAL-AFFECTED') {
            section.additionalChecks.push({ testId: test.testId, status: outcome(test.status),
              diagnostics: test.blockers ?? [], reportId: ref.id });
            continue;
          }
          requireThat(!seen.has(test.testId), 'RELEASE_REPORT', 'Duplicate/conflicting case observations in a joined checkpoint');
          const row = cases.find(value => value.testId === test.testId);
          requireThat(row, 'RELEASE_REPORT', 'Foreign logical case cannot enter this checkpoint');
          accepted.push({ row, test });
        }
        if (independent && verifiers[ref.id]) for (const { row, test } of accepted) {
          seen.add(test.testId);
          row.status = outcome(test.status);
          row.diagnostics = test.blockers ?? [];
        }
        section.reports.push({ id: ref.id, sha256: ref.sha256, profile: replay.evaluation.profile,
          status: replay.evaluation.status, historicalSummary: replay.historicalSummary });
        readable.push(renderReadinessReport(replay.evaluation, { completeReportRef: ref.filename }));
      } catch (error) { section.blockers.push(safeSummary(`${ref?.id ?? 'unknown-input'}: ${error.code ?? 'INVALID_INPUT'}: ${error.message}`)); }
    }
    const totals = { required: cases.length, passed: cases.filter(test => test.status === 'Passed').length,
      failed: cases.filter(test => test.status === 'Failed').length, notRun: cases.filter(test => test.status === 'NotRun').length };
    section.totals = totals;
    section.status = totals.failed ? 'Failed' :
      !section.blockers.length && totals.required > 0 && totals.passed === totals.required ? 'Passed' : 'NotRun';
    if (stage === 'OBSERVERS') {
      section.scope = 'Observations such as T-PRD019 are outputs, never prerequisites of the production gate they observe';
      result.observers.push(section);
    } else result.checkpoints.push(section);
    readable.push(`\n## ${stage}\n\n${section.status}: required ${totals.required}; Passed ${totals.passed}; ` +
      `Failed ${totals.failed}; NotRun ${totals.notRun}.\n` +
      cases.map(test => `- ${test.testId}: ${test.status}\n`).join('') +
      section.blockers.map(reason => `- Blocked: ${reason}\n`).join(''));
  }
  for (const [name, ref, verifier] of [
    ['benchmark', manifest.benchmark, benchmarkVerifier], ['protections', manifest.protections, protectionVerifier],
  ]) {
    if (!ref) { result.blockers.push(`${name}: no retained observation`); continue; }
    try {
      result[name] = await verifiedObservation(ref, read, verifier, manifest.candidate);
      if (name === 'benchmark') {
        const data = result[name].data;
        const equivalent = result[name].status === 'Verified' && data.kind === 'validation-benchmark-comparison' &&
          result[name].origin.assessment === 'Passed' && data.comparability === 'equivalent' && data.status === 'Passed';
        result[name].comparisons = equivalent ? data.comparisons : [];
        result[name].timingClaim = equivalent ? 'Measured comparable observations only' : 'No verified ratio or speedup claim';
      }
      if (name === 'protections') result[name].assessment = result[name].origin?.assessment ?? 'NotRun';
    } catch (error) { result[name] = { status: 'NotRun', reason: error.message }; result.blockers.push(`${name}: ${error.message}`); }
  }
  for (const ref of manifest.releaseHistory ?? []) {
    try { result.releaseHistory.push(await verifiedObservation(ref, read, releaseVerifier, manifest.candidate)); }
    catch (error) { result.releaseHistory.push({ status: 'NotRun', reference: ref, reason: error.message }); }
  }
  result.status = result.checkpoints.some(section => section.status === 'Failed' ||
      section.additionalChecks.some(test => test.status === 'Failed')) ||
    result.benchmark.status === 'Verified' && result.benchmark.origin?.assessment === 'Failed' ||
    result.protections.status === 'Verified' && result.protections.assessment === 'Failed' ||
    result.releaseHistory.at(-1)?.status === 'Verified' && result.releaseHistory.at(-1).origin.assessment === 'Failed' ? 'Failed' :
    result.checkpoints.every(section => section.status === 'Passed') &&
      result.observers.every(section => section.status === 'Passed') &&
      result.benchmark.status === 'Verified' && result.benchmark.data?.comparability === 'equivalent' &&
      result.benchmark.data?.status === 'Passed' && result.benchmark.origin?.assessment === 'Passed' &&
      result.protections.status === 'Verified' &&
      result.protections.assessment === 'Passed' &&
      result.releaseHistory.length > 0 && result.releaseHistory.every(row => row.status === 'Verified') &&
      result.releaseHistory.at(-1).origin.assessment === 'Passed' &&
      !result.blockers.length ? 'Passed' : 'NotRun';
  readable.push(`\n## Measurements and external observations\n\nBenchmark: ${result.benchmark.status}; ` +
    `${result.benchmark.timingClaim ?? 'No timing claim'}.\n\nEffective protection origin: ${result.protections.status}; ` +
    `assessment: ${result.protections.assessment ?? 'NotRun'}.\n\n` +
    'Historical channel/attempt outcomes remain original observations, never renewed current credit.\n' +
    (result.benchmark.comparisons ?? []).map(row => `\n- ${row.scope}, repeat ${row.repeat}: baseline ${row.baselineMs} ms; ` +
      `candidate ${row.candidateMs} ms; delta ${row.deltaMs} ms; measured ratio ${row.ratio}.\n`).join('') +
    result.releaseHistory.map((entry, index) => `\n- Attempt input ${index + 1}: ${entry.status}; ` +
      `${entry.data?.status ?? entry.reason ?? 'Unknown'}\n` +
      (entry.data?.cases ?? []).map(test => `  - ${test.testId}: ${test.status} (original historical outcome)\n`).join('')).join('') +
    result.limitations.map(reason => `\n- Limitation: ${reason}\n`).join('') +
    `\nOverall current readiness: **${result.status}**.\n`);
  return { report: result, markdown: readable.join('\n') };
}

export async function writeReadinessReport({ manifestFile, planFile, outputDir, ...trusted }) {
  const bytes = await fs.readFile(manifestFile);
  requireThat(bytes.length <= 256 * 1024, 'RELEASE_REPORT', 'Report input graph exceeds its bounded manifest budget');
  const manifest = JSON.parse(bytes);
  const read = await fileReportReader(path.dirname(manifestFile));
  const plan = await fs.readFile(planFile, 'utf8');
  const localInventory = trusted.localInventory ?? await compileValidationInventory(repositoryRoot);
  const result = await composeReadinessReport({ manifest, plan, read, ...trusted, localInventory });
  await emptyDirectory(outputDir);
  await writeJson(path.join(outputDir, 'readiness.json'), result.report);
  await fs.writeFile(path.join(outputDir, 'readiness.md'), result.markdown, { flag: 'wx' });
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await writeReadinessReport(options(process.argv.slice(2)));
  console.log(canonical({ status: result.report.status, authority: result.report.authority }));
  if (result.report.status !== 'Passed') process.exitCode = 2;
}
