import * as fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { digest, requireThat, SdlcError } from '../src/core.mjs';
import { sanitizeExecutionPayload } from '../src/validation-evidence.mjs';
import { inspectCoverage, compileCoverage } from '../src/coverage.mjs';
import { testSpecificationDigest } from '../src/artifacts.mjs';
import { readEvidenceBundle, validateExecutionContext,
  validationInventoryDigest } from 'ai-sdlc-framework/evidence';
import { compileValidationSourceInventory, compareValidationInventory,
  reconcileNodeExecution, validationPlatforms, validationSourcePaths } from './validation-inventory.mjs';
import * as native from './native-validation.mjs';
import { validateNativeHomebrewEvidence } from './release-gate.mjs';
import { createReadinessGitHubClient, requireReadinessGitHubClient } from './github-readiness-host.mjs';
import { evaluateApproval, evaluateConversations, reconcilePrReadiness, statusContexts } from './pr-readiness.mjs';
import { inspectWorkflowPolicy } from './workflow-policy.mjs';
import { calculatorProjectFiles, calculatorSelection, reconcileCalculator } from './pr-calculator.mjs';
import { deriveNativeComponentSpecification, projectNativeComponentEvidence,
  requireNativeComponentProjection } from './native-components.mjs';

const execute = promisify(execFile);
export const readinessRepository = 'urmich/ai-sdlc-framework';
export const statusConcurrencyGroup = 'framework-readiness-status-writer';
export const coverageArtifacts = Object.freeze([{
  artifactId: 'public-readiness', directory: 'docs/sdlc/public-readiness',
}]);
const writerPaths = ['.github/workflows/pr-readiness.yml', '.github/workflows/coverage-metadata.yml'];
const reporterPaths = [
  '.github/workflows/ci.yml', 'scripts/native-validation.mjs', 'scripts/native-toolchain.mjs',
  'scripts/toolchain-baseline.mjs', 'scripts/native-homebrew-prefix.mjs',
  'scripts/validation-tools.mjs',
  'scripts/pr-capabilities.mjs', 'scripts/pr-calculator.mjs', 'scripts/pr-calculator-reporter.mjs',
  'scripts/verify-npm-attestation.mjs', 'scripts/accept-release.mjs', 'scripts/native-components.mjs',
  'scripts/workflow-policy.mjs', 'scripts/test-scheduling.mjs',
  'scripts/test-budget.mjs', 'scripts/test-budget-worker.mjs',
  'scripts/test-local-evidence.mjs',
  '.github/release-requirements.txt',
  'scripts/test-runner.mjs', 'scripts/test-worker.mjs', 'scripts/test-profiles.mjs',
  'scripts/validation-inventory.mjs', 'src/core.mjs', 'src/evidence.mjs',
  'src/validation-evidence.mjs', 'src/validation-readiness.mjs', 'src/validation-catalog.mjs',
  'src/artifacts.mjs',
];
const revision = /^[a-f0-9]{40}$/u;
const sha256 = /^[a-f0-9]{64}$/u;
const checkoutCommitPattern = /^\[command\](?:"(?:[A-Za-z]:[\\/]|\/)[^"\r\n]*[\\/]git(?:\.exe)?"|(?:[A-Za-z]:[\\/]|\/)[^\s"]*[\\/]git(?:\.exe)?|git(?:\.exe)?)\s+log -1 --format=%H\s*$/u;
const labels = { 'linux-x64': 'ubuntu-24.04', 'windows-x64': 'windows-2022',
  'macos-arm64': 'macos-15', 'macos-x64': 'macos-15-intel' };
const platforms = { 'linux-x64': 'linux', 'windows-x64': 'win32',
  'macos-arm64': 'darwin', 'macos-x64': 'darwin' };
function parseProof(text) {
  try { return JSON.parse(text); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new SdlcError('EVIDENCE', 'Actual producer log proof contains malformed JSON');
  }
}

export function readTrustedValidationIntent(job, logs, { repositoryId, runId, attempt, pr }) {
  requireThat(job?.run_id === runId && job.name === native.nativeWorkflowContract.intentJob &&
    job.conclusion === 'success' && typeof logs === 'string' && Array.isArray(job.steps) &&
    job.steps.every(step => step && typeof step.name === 'string'), 'EVIDENCE',
  'The actual successful validation-intent job is required');
  const steps = job.steps.filter(step => step.name === 'Record validation intent' && step.conclusion === 'success');
  requireThat(steps.length === 1, 'EVIDENCE', 'The actual validation-intent step must be unambiguous');
  const records = logs.split(/\r?\n/u).flatMap(line => {
    const match = /^(\d{4}-\d\d-\d\dT\S+Z)\s+sdlc-validation-intent:(.*)$/u.exec(line);
    return match && Date.parse(match[1]) >= Date.parse(steps[0].started_at) &&
      Date.parse(match[1]) < Date.parse(steps[0].completed_at) + 1000 ? [parseProof(match[2])] : [];
  });
  requireThat(records.length === 1, 'EVIDENCE', 'One time-bounded intent proof is required');
  const facts = records[0];
  requireThat(facts && Object.getPrototypeOf(facts) === Object.prototype,
    'EVIDENCE', 'The actual intent proof must be one literal record');
  requireThat(String(facts.repositoryId) === String(repositoryId) &&
    String(facts.runId) === String(runId) && String(facts.attempt) === String(attempt) &&
    facts.event === 'pull_request' && /^[1-9]\d*$/u.test(String(facts.prNumber)) &&
    revision.test(facts.headSha ?? '') && revision.test(facts.baseSha ?? '') &&
    revision.test(facts.mergeSha ?? '') && typeof facts.baseChanged === 'boolean' &&
    typeof facts.requiresNative === 'boolean' && typeof facts.action === 'string' &&
    ['opened', 'synchronize', 'reopened', 'ready_for_review', 'edited'].includes(facts.action) &&
    facts.requiresNative === (facts.action !== 'edited' || facts.baseChanged),
  'EVIDENCE', 'Actual validation intent does not match this current PR/source/event');
  if (String(facts.prNumber) === String(pr.number)) requireThat(facts.headSha === pr.head.sha &&
    facts.baseSha === pr.base.sha && facts.mergeSha === pr.merge_commit_sha, 'EVIDENCE',
  'The current PR producer intent has a stale source tuple');
  return facts;
}

export function readTrustedMinimumNodeJob(job, logs, { runId, attempt, expectedHead, expectedMerge }) {
  requireThat(job?.name === native.nativeWorkflowContract.minimumNodeJob &&
    Number.isSafeInteger(job.id) && job.id > 0 &&
    revision.test(expectedHead ?? '') && revision.test(expectedMerge ?? '') &&
    job.run_id === runId && job.run_attempt === attempt && job.head_sha === expectedHead &&
    job.status === 'completed' && job.conclusion === 'success' &&
    Array.isArray(job.labels) && job.labels.includes(labels['linux-x64']) &&
    typeof logs === 'string' && Array.isArray(job.steps), 'EVIDENCE',
  'T-PRD014-LX requires the successful current minimum-runtime compatibility job');
  const names = [native.nativeWorkflowContract.steps.checkout,
    native.nativeWorkflowContract.steps.minimumNodeSetup,
    native.nativeWorkflowContract.steps.minimumNodeExecution,
    native.nativeWorkflowContract.steps.minimumNodeRetention];
  const steps = names.map(name => {
    const matches = job.steps.filter(step => step?.name === name);
    requireThat(matches.length === 1 && matches[0].conclusion === 'success' &&
      Number.isSafeInteger(matches[0].number) && matches[0].number > 0, 'EVIDENCE',
    'A required minimum-runtime compatibility step is missing, failed or ambiguous');
    return matches[0];
  });
  requireThat(steps.every((step, index) => index === 0 || step.number > steps[index - 1].number),
    'EVIDENCE', 'Minimum-runtime compatibility checkout/setup/execution/retention ordering differs');
  const checkout = steps[0];
  const lines = logs.split(/\r?\n/u).flatMap(line => {
    const match = /^(\d{4}-\d\d-\d\dT\S+Z)\s+(.*)$/u.exec(line);
    return match && Date.parse(match[1]) >= Date.parse(checkout.started_at) &&
      Date.parse(match[1]) < Date.parse(checkout.completed_at) + 1000 ? [match[2]] : [];
  });
  requireThat(lines.some((line, index) => checkoutCommitPattern.test(line) &&
    lines[index + 1]?.trim() === expectedMerge), 'EVIDENCE',
  'Minimum-runtime compatibility checkout does not establish the current tested merge commit');
  return { jobId: job.id, runId, attempt, headSha: job.head_sha, mergeSha: expectedMerge };
}

async function mapReads(values, operation) {
  const result = [];
  for (let offset = 0; offset < values.length; offset += 4) {
    result.push(...await Promise.all(values.slice(offset, offset + 4).map(operation)));
  }
  return result;
}

export function inspectWorkflowTrust(workflows) {
  const result = inspectWorkflowPolicy(workflows);
  for (const selected of result.workflows.filter(item => item.file === native.nativeWorkflowContract.path)) {
    const matrix = selected.document.jobs?.native?.strategy?.matrix;
    const runners = JSON.stringify(matrix ?? null);
    for (const label of Object.values(labels)) if (!runners.includes(`"${label}"`)) {
      result.blockers.push({ file: selected.file, code: 'MISSING_NATIVE_RUNNER', label });
    }
  }
  return { ...result, complete: result.blockers.length === 0 };
}

export function readTrustedJobContext(job, logs, {
  repositoryId, runId, attempt, expectedMerge, prNumber, requireSuccess = true, requiredSteps = [
    native.nativeWorkflowContract.steps.context, native.nativeWorkflowContract.steps.checkout,
    native.nativeWorkflowContract.steps.sourceBytes, 'Provision isolated native toolchain',
    native.nativeWorkflowContract.steps.execution,
    native.nativeWorkflowContract.steps.retention,
  ],
}) {
  requireThat(job?.run_id === runId && (!requireSuccess || job.conclusion === 'success') &&
    typeof logs === 'string' && Array.isArray(job.steps) && job.steps.every(step =>
      step && typeof step.name === 'string' && Number.isSafeInteger(step.number) && step.number > 0),
    'EVIDENCE', 'Required native job did not complete successfully in this run');
  const steps = requiredSteps.map(name => {
    const matches = job.steps.filter(step => step.name === name && step.conclusion === 'success');
    requireThat(matches.length === 1, 'EVIDENCE', 'A required actual producer step is missing, failed or ambiguous');
    return matches[0];
  });
  requireThat(steps.every((step, index) => index === 0 || step.number > steps[index - 1].number),
    'EVIDENCE', 'Trusted context/checkout/producer/upload ordering differs from the adopted workflow');
  const lines = logs.replace(/^\uFEFF/u, '').split(/\r?\n/u).flatMap(line => {
    const match = /^(\d{4}-\d\d-\d\dT\S+Z)\s+(.*)$/u.exec(line);
    return match && Number.isFinite(Date.parse(match[1])) ?
      [{ at: Date.parse(match[1]), text: match[2] }] : [];
  });
  const within = (line, step) => line.at >= Date.parse(step.started_at) &&
    line.at < Date.parse(step.completed_at) + 1000;
  const contexts = lines.filter(line => within(line, steps[0]) &&
    line.text.startsWith('sdlc-run-context:')).map(line =>
    parseProof(line.text.slice('sdlc-run-context:'.length)));
  requireThat(contexts.length === 1, 'EVIDENCE', 'One actual pre-candidate runner context is required');
  const context = contexts[0];
  requireThat(context && Object.getPrototypeOf(context) === Object.prototype,
    'EVIDENCE', 'The actual runner context must be one literal record');
  const providerId = value => typeof value === 'number' ? value :
    /^[1-9]\d*$/u.test(value ?? '') ? Number(value) : NaN;
  const normalized = { ...context, repositoryId: providerId(context.repositoryId),
    prNumber: providerId(context.prNumber), headRepositoryId: providerId(context.headRepositoryId) };
  const resources = context.resources;
  requireThat(resources && Object.getPrototypeOf(resources) === Object.prototype &&
    Number.isSafeInteger(resources.availableParallelism) && resources.availableParallelism > 0 &&
    Number.isSafeInteger(resources.totalMemoryBytes) && resources.totalMemoryBytes > 0 &&
    (resources.configuredWorkers === null || typeof resources.configuredWorkers === 'string' &&
      /^[1-9]\d*$/u.test(resources.configuredWorkers) && Number(resources.configuredWorkers) <= 32),
  'EVIDENCE', 'Trusted pre-candidate CPU, memory and exact configured-worker request are required');
  requireThat(normalized.repositoryId === repositoryId && String(context.runId) === String(runId) &&
    String(context.attempt) === String(attempt) && context.event === 'pull_request' &&
    Number.isSafeInteger(normalized.prNumber) && normalized.prNumber > 0 &&
    Number.isSafeInteger(normalized.headRepositoryId) && normalized.headRepositoryId > 0 &&
    (prNumber === undefined || normalized.prNumber === prNumber) &&
    revision.test(context.headSha) && revision.test(context.baseSha) && revision.test(context.mergeSha) &&
    (expectedMerge === undefined || context.mergeSha === expectedMerge) &&
    typeof context.ImageOS === 'string' && context.ImageOS.length > 0 &&
    typeof context.ImageVersion === 'string' && context.ImageVersion.length > 0 &&
    job.head_sha === context.headSha && ['linux', 'win32', 'darwin'].includes(context.platform) &&
    ['x64', 'arm64'].includes(context.architecture),
  'EVIDENCE', 'Trusted runner context differs from the current PR/source/attempt');
  if (steps.length > 1) {
    const checkout = lines.filter(line => within(line, steps[1]));
    requireThat(checkout.some((line, index) => checkoutCommitPattern.test(line.text) &&
      checkout[index + 1]?.text.trim() === context.mergeSha),
    'EVIDENCE', 'Actual checkout output does not establish the tested merge commit');
  }
  return normalized;
}

export function verifyFrozenCandidateData(data, sourceRevision) {
  requireThat(data && typeof data === 'object' && Array.isArray(data.files) &&
    data.files.every(file => file && typeof file.filename === 'string') &&
    data.texts && typeof data.texts['assets/SHA256SUMS'] === 'string',
  'EVIDENCE', 'Frozen artifact acquisition must retain its complete bounded literal file/text inventory');
  const context = data['context.json'];
  const descriptor = data['assets/release-descriptor.json'];
  requireThat(context && descriptor && descriptor.sourceCommit === sourceRevision &&
    context.identity?.sourceCommit === sourceRevision && context.identity.version === descriptor.version &&
    typeof descriptor.version === 'string' && descriptor.version.length > 0 &&
    descriptor.payload && typeof descriptor.payload.filename === 'string' && sha256.test(descriptor.payload.sha256 ?? '') &&
    (descriptor.payload.size === undefined || Number.isSafeInteger(descriptor.payload.size) && descriptor.payload.size >= 0) &&
    Array.isArray(descriptor.files) && descriptor.files.length > 0 && descriptor.files.length <= 256 &&
    descriptor.files.every(file => file && Object.getPrototypeOf(file) === Object.prototype),
  'EVIDENCE', 'Frozen candidate documents do not match this tested source/version');
  const files = new Map(data.files.map(file => [file.filename, file]));
  requireThat(files.size === data.files.length &&
    context.identity.descriptorSha256 === files.get('assets/release-descriptor.json')?.sha256 &&
    context.identity.checksumsSha256 === files.get('assets/SHA256SUMS')?.sha256,
  'EVIDENCE', 'Frozen descriptor/checksum bytes differ from the source-bound candidate identity');
  const names = new Set();
  const expected = new Map([['release-descriptor.json',
    context.identity.descriptorSha256]]);
  for (const file of descriptor.files) {
    requireThat(typeof file.filename === 'string' && /^[A-Za-z0-9_.+-]+$/u.test(file.filename) &&
      !['.', '..', 'release-descriptor.json', 'SHA256SUMS'].includes(file.filename) &&
      !names.has(file.filename.toLowerCase()) && sha256.test(file.sha256) &&
      Number.isSafeInteger(file.size) && file.size >= 0,
    'EVIDENCE', 'Frozen asset records must have literal unique names and exact byte identities');
    names.add(file.filename.toLowerCase());
    const actual = files.get(`assets/${file.filename}`);
    requireThat(actual?.sha256 === file.sha256 && actual.size === file.size,
      'DIGEST', 'Frozen asset bytes differ from the independently acquired descriptor');
    expected.set(file.filename, file.sha256);
  }
  const checksums = data.texts['assets/SHA256SUMS'].trimEnd().split(/\r?\n/u).map(line => {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9_.+-]+)$/u.exec(line);
    requireThat(match, 'EVIDENCE', 'Frozen checksum lines are malformed');
    return [match[2], match[1]];
  });
  requireThat(checksums.length === expected.size && new Set(checksums.map(([name]) => name)).size === expected.size &&
    checksums.every(([name, hash]) => expected.get(name) === hash) &&
    [...files.keys()].filter(file => file.startsWith('assets/')).length === expected.size + 1 &&
    descriptor.payload?.sha256 === files.get(`assets/${descriptor.payload?.filename}`)?.sha256 &&
    context.identity.payloadSha256 === descriptor.payload.sha256,
  'EVIDENCE', 'The complete frozen checksum/payload inventory is inconsistent');
  const candidate = { context, descriptor };
  return { candidate, artifacts: native.nativeArtifacts(candidate) };
}

export async function verifyOriginalNativeRows({
  data, raw, specification, inventory, goSources, target, candidate, sourceFiles, plan, context,
}) {
  requireThat(Array.isArray(raw.results) && raw.results.every(row => row &&
    Object.getPrototypeOf(row) === Object.prototype), 'EVIDENCE',
  'Original derived native results must be a complete literal result collection');
  const expectedStages = native.nativeStageSelections(inventory, plan);
  const smallContext = {
    schemaVersion: 1, sourceCommit: context.sources[0].revision, target, profile: 'pr',
    workflowRef: context.producer.definitionRef, repositoryId: context.sources[0].repositoryId,
    runId: context.producer.executionRef, attempt: context.producer.attemptRef,
  };
  const stages = expectedStages.map(stage => data[`${stage.name}.json`]);
  requireThat(stages.every(Boolean), 'EVIDENCE', 'Original unit-first producer reports are missing');
  for (const [name, args, expected] of [
    ['go-version', ['version'], context.native.toolchain.go],
    ['python-version', ['--version'], context.native.toolchain.python],
  ]) {
    const command = data[`${name}.json`];
    requireThat(command?.kind === 'validation-command' && command.complete === true &&
      command.exitCode === 0 && command.node === `v${native.nativeToolchain.node}` &&
      command.platform === context.native.platform && command.architecture === context.native.architecture &&
      digest(command.context) === digest(smallContext) && Array.isArray(command.command) &&
      digest(command.command.slice(1)) === digest(args) &&
      typeof command.stdout === 'string' && command.stdout.trim() === expected &&
      Date.parse(command.startedAt) >= Date.parse(raw.startedAt) &&
      Date.parse(command.finishedAt) <= Date.parse(stages[0].startedAt),
    'EVIDENCE', 'Original SDK preflight did not establish the selected native toolchain before unit execution');
  }
  const observations = new Map();
  for (const stage of expectedStages) {
    const report = data[`${stage.name}.json`];
    const command = data[`${stage.name}-command.json`];
    const expectedContext = stage.name === 'regression' ? context : smallContext;
    requireThat(command?.kind === 'validation-command' && command.complete === true &&
      command.exitCode === 0 && Array.isArray(command.command) &&
      command.node === `v${native.nativeToolchain.node}` &&
      report.node === `v${native.nativeToolchain.node}` &&
      command.platform === context.native.platform && command.architecture === context.native.architecture &&
      digest(command.context) === digest(expectedContext) &&
      digest(report.context) === digest(expectedContext) &&
      digest(command.command.slice(1)) === digest(['scripts/test-runner.mjs', ...stage.args]),
    'EVIDENCE', 'Original stage command did not complete with the independently required source and selection');
    requireThat(reconcileNodeExecution({ ...inventory, cases: stage.cases }, report, {
      platform: target, files: [...new Set(stage.cases.map(test => test.file))],
    }).status === 'Passed', 'EVIDENCE', 'Original assertions do not reconcile against the independently declared inventory');
    for (const row of report.executions) {
      const definition = inventory.cases.find(test => test.file === row.file &&
        test.name === row.name && digest(test.parents) === digest(row.parents));
      requireThat(definition && !observations.has(definition.id), 'EVIDENCE',
        'A native assertion is unbound or executed more than once across stages');
      observations.set(definition.id, row);
    }
  }
  requireThat(observations.size === inventory.cases.length &&
    Date.parse(stages[0].finishedAt) <= Date.parse(stages[1].startedAt) &&
    Date.parse(stages[1].finishedAt) <= Date.parse(stages[2].startedAt),
  'EVIDENCE', 'The complete inventory must actually execute once with units before integration');
  const goReports = Object.entries(data).filter(([file]) =>
    /^tools-[a-f0-9-]+\/go-tests\.json$/u.test(file)).map(([, report]) => report);
  const checkedGo = native.nativeGoObservations(goSources, goReports, target);
  requireThat(checkedGo.status === 'Passed', 'EVIDENCE', 'Original Go execution is incomplete or mismatched');
  for (const row of checkedGo.observations) observations.set(row.id, row);
  const staticReport = data['static.json'];
  requireThat(staticReport?.complete === true && staticReport.exitCode === 0 &&
    Array.isArray(staticReport.command) && staticReport.command.at(-1) === 'scripts/check.mjs',
  'EVIDENCE', 'The actual static validation command did not complete');
  observations.set(`assertion-${digest(['procedure', 'static'])}`, {
    status: 'Passed', observedAt: staticReport.finishedAt,
  });
  const calculatorSources = sourceFiles.filter(source => calculatorProjectFiles(inventory).includes(source.file));
  const calculator = data['calculator.json'];
  requireThat(reconcileCalculator(calculator, calculatorSelection(inventory),
    data.texts?.['calculator.json.journal.ndjson']), 'EVIDENCE',
  'The independent calculator namespace requires every declared original test outcome');
  observations.set(`assertion-${digest(['procedure', 'calculator'])}`, {
    status: 'Passed', observedAt: calculator.finishedAt,
  });
  const frozen = data['candidate-verification.json'];
  const expectedArtifacts = validateExecutionContext({
    ...context, artifacts: native.nativeArtifacts(candidate),
  }).artifacts;
  requireThat(frozen?.sourceCommit === candidate.descriptor.sourceCommit &&
    digest(frozen.artifacts) === digest(expectedArtifacts),
  'EVIDENCE', 'Original candidate verification differs from independently acquired frozen bytes');
  observations.set(`assertion-${digest(['procedure', 'frozen-artifacts'])}`, {
    status: 'Passed', observedAt: frozen.observedAt,
  });
  if (target.startsWith('macos-')) {
    const homebrew = data['native-homebrew.json'];
    try {
      validateNativeHomebrewEvidence(homebrew, { candidate, targetArch: target.split('-')[1], mode: 'candidate' });
    } catch (error) {
      if (!(error instanceof Error) || error instanceof SdlcError) throw error;
      throw new SdlcError('EVIDENCE', `Original native Homebrew proof is invalid: ${error.message}`);
    }
    observations.set(`assertion-${digest(['procedure', 'native-homebrew'])}`, {
      status: 'Passed', observedAt: homebrew.observedAt,
    });
  }
  for (const test of specification.cases) for (const assertion of test.assertions) {
    const original = observations.get(assertion.id);
    const matches = raw.results.filter(row => row.testId === test.id && row.assertionId === assertion.id);
    requireThat(original && matches.length === 1 && original.status === matches[0].status &&
      Date.parse(original.observedAt) === Date.parse(matches[0].observedAt),
    'EVIDENCE', 'A derived result differs from its retained original outcome/time');
  }
  const reconstructed = await native.reconcileNativeEvidenceData({ data, raw, specification, inventory,
    sources: goSources, calculatorSources, target, candidate, stages: expectedStages, context, startedAt: raw.startedAt });
  const resultsMatch = digest(reconstructed.raw.results) === digest(raw.results);
  const observedAtMatch = reconstructed.raw.observedAt === raw.observedAt;
  if (!reconstructed.raw.complete || reconstructed.raw.exitCode !== 0 || !resultsMatch || !observedAtMatch) {
    const fields = ['status', 'expectedMet', 'observedAt', 'sourceSequence', 'durationMs', 'exitCode',
      'detail', 'selector', 'expectedDigest', 'checkpoint'];
    const differing = reconstructed.raw.results.flatMap(row => {
      const original = raw.results.find(item => item.testId === row.testId && item.assertionId === row.assertionId);
      const changed = original ? fields.filter(field =>
        digest(row[field] ?? null) !== digest(original[field] ?? null)) : ['missing-original'];
      return changed.length ? [{ assertionId: row.assertionId, fields: changed }] : [];
    });
    const summary = { target, complete: reconstructed.raw.complete, exitCode: reconstructed.raw.exitCode,
      resultsMatch, observedAtMatch, resultCount: reconstructed.raw.results.length,
      originalCount: raw.results.length, differences: differing.slice(0, 4),
      diagnostics: reconstructed.diagnostics.filter(item => item.code || item.status && item.status !== 'Passed')
        .slice(0, 4).map(item => ({ stage: item.stage, code: item.code ?? item.status })) };
    throw new SdlcError('EVIDENCE',
      `Original native commands/procedures do not reconcile to the retained execution report: ${JSON.stringify(summary)}`,
      summary);
  }
}

async function sourceDefinitions(api, sha) {
  const tree = await api.tree(sha);
  const regular = [...tree.paths].filter(([, entry]) => entry.type === 'blob');
  for (const [file, entry] of regular) if (/^(?:bin|src|scripts|packaging|cmd|test)\//u.test(file)) {
    requireThat(['100644', '100755'].includes(entry.mode), 'EVIDENCE', 'Candidate source may not substitute linked executable definitions');
  }
  const tests = validationSourcePaths(regular.map(([file]) => file));
  const files = await mapReads(tests, async file => ({ file, contents: await api.file(tree, file) }));
  let inventory;
  try { inventory = compileValidationSourceInventory({ files, surfacePaths: regular.map(([file]) => file) }); }
  catch (error) {
    if (error instanceof SdlcError) throw error;
    if (error.constructor !== Error && !(error instanceof SyntaxError)) throw error;
    throw new SdlcError('INVENTORY', 'Candidate source declarations could not be compiled safely');
  }
  const go = regular.filter(([file]) => /^cmd\/sdlc-launcher\/[^/]+_test\.go$/u.test(file));
  const goSources = await mapReads(go, async ([file]) => ({
    file: path.posix.basename(file), contents: await api.file(tree, file),
  }));
  const requirements = await mapReads(coverageArtifacts, async artifact => ({
    artifactId: artifact.artifactId, path: `${artifact.directory}/requirements.md`,
    contents: await api.file(tree, `${artifact.directory}/requirements.md`),
  }));
  const testPlans = await mapReads(coverageArtifacts, async artifact => ({
    artifactId: artifact.artifactId, path: `${artifact.directory}/test-plan.md`,
    contents: await api.file(tree, `${artifact.directory}/test-plan.md`),
  }));
  const adapterSource = { file: 'scripts/native-components.mjs',
    contents: await api.file(tree, 'scripts/native-components.mjs') };
  return { tree, inventory, goSources, requirements, testPlans, files, adapterSource,
    coverage: { repositoryId: 'primary', sourceRevision: sha, requirements, testPlans },
    plan: testPlans.find(plan => plan.artifactId === 'public-readiness').contents };
}

function failedVerdict(code, details = []) {
  return { status: 'NotRun', blockers: [code, ...details],
    inputDigest: digest({ code, details }) };
}

async function observedVerdict(operation) {
  try { return await operation(); }
  catch (error) {
    if (!(error instanceof SdlcError)) throw error;
    return failedVerdict(error.code, [error.message]);
  }
}

export function createPrReadinessHost({
  api, defaultRevision, adoptedRevision = defaultRevision, writerId,
  now = Date.now, detailsUrl,
}) {
  requireReadinessGitHubClient(api);
  requireThat(api.repository === readinessRepository && api.writerId === writerId &&
    revision.test(defaultRevision) && revision.test(adoptedRevision),
  'SCOPE', 'Only this repository adopts these required PR guardrails');
  requireThat(/^https:\/\/github\.com\/urmich\/ai-sdlc-framework\/actions\/runs\/[1-9]\d*\/attempts\/[1-9]\d*$/u.test(detailsUrl),
    'INPUT', 'Status details must link to the actual observer run/attempt in this repository');
  const definitions = new Map();
  const componentEvidence = new Map();
  const selectedSource = sha => {
    if (!definitions.has(sha)) definitions.set(sha, sourceDefinitions(api, sha));
    return definitions.get(sha);
  };
  const logCache = new Map();
  const log = job => {
    if (!logCache.has(job.id)) logCache.set(job.id, api.bytes(`/actions/jobs/${job.id}/logs`)
      .then(bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    return logCache.get(job.id);
  };
  async function control() {
    const repository = await api.get('');
    requireThat(repository?.id === api.repositoryId && repository.full_name === readinessRepository &&
      typeof repository.default_branch === 'string', 'SCOPE', 'Current provider repository identity changed');
    const branch = await api.get(`/branches/${encodeURIComponent(repository.default_branch)}`);
    if (branch?.commit?.sha !== defaultRevision) return false;
    const source = await api.tree(defaultRevision);
    const files = [...source.paths].filter(([file, entry]) => entry.type === 'blob' &&
      (/^\.github\/workflows\/[^/]+\.ya?ml$/u.test(file) ||
        /^\.github\/actions\/.+\/action\.ya?ml$/u.test(file)));
    const workflows = await mapReads(files, async ([file]) => ({ file, contents: await api.file(source, file) }));
    return writerPaths.every(file => workflows.some(workflow => workflow.file === file)) &&
      inspectWorkflowTrust(workflows).complete;
  }
  async function producerAdopted(source) {
    const adopted = await api.tree(adoptedRevision);
    const paths = new Set([...reporterPaths, ...[...adopted.paths.keys()].filter(file =>
      /^\.github\/actions\//u.test(file) ||
      /^test\/.*\.(?:mjs|js|cjs)$/u.test(file) && !/\.test\.(?:mjs|js|cjs)$/u.test(file))]);
    return [...paths].every(file => adopted.paths.get(file)?.sha &&
      source.tree.paths.get(file)?.sha === adopted.paths.get(file).sha);
  }
  async function nativeVerdict(pr, source, { workflowId, runs }) {
    if (!(await producerAdopted(source))) return failedVerdict('Producer definitions have not been maintainer-adopted');
    const adopted = await selectedSource(adoptedRevision);
    if (!compareValidationInventory(source.inventory, adopted.inventory).complete ||
        digest(source.goSources) !== digest(adopted.goSources)) {
      return failedVerdict('Assertion definitions or required bindings have not been maintainer-adopted');
    }
    const candidates = runs.filter(run => run.event === 'pull_request' &&
      run.head_sha === pr.head.sha && run.head_repository?.id === pr.head.repo.id)
      .sort((left, right) => right.id - left.id || right.run_attempt - left.run_attempt);
    for (const listed of candidates) {
      const run = await api.get(`/actions/runs/${listed.id}`);
      requireThat(run.workflow_id === workflowId && run.path === native.nativeWorkflowContract.path &&
        run.repository?.id === api.repositoryId, 'EVIDENCE', 'Actual producer workflow/repository differs from this selected execution');
      const jobs = await api.list(`/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`, 'jobs');
      const intents = jobs.filter(job => job.name === native.nativeWorkflowContract.intentJob);
      requireThat(intents.length === 1, 'EVIDENCE', 'Current producer intent job is missing or ambiguous');
      const intent = readTrustedValidationIntent(intents[0], await log(intents[0]), {
        repositoryId: api.repositoryId, runId: run.id, attempt: run.run_attempt, pr,
      });
      if (String(intent.prNumber) !== String(pr.number)) continue;
      if (!intent.requiresNative) continue;
      const minimumJobs = jobs.filter(job => job.name === native.nativeWorkflowContract.minimumNodeJob);
      requireThat(minimumJobs.length === 1, 'EVIDENCE',
        'T-PRD014-LX minimum-runtime compatibility job is missing or ambiguous');
      const minimumNode = readTrustedMinimumNodeJob(minimumJobs[0], await log(minimumJobs[0]), {
        runId: run.id, attempt: run.run_attempt, expectedHead: pr.head.sha, expectedMerge: pr.merge_commit_sha,
      });
      const freezes = jobs.filter(job => job.name === native.nativeWorkflowContract.sourceJob);
      requireThat(freezes.length === 1, 'EVIDENCE', 'Required source freeze job is missing or ambiguous');
      readTrustedJobContext(freezes[0], await log(freezes[0]), {
        repositoryId: api.repositoryId, runId: run.id, attempt: run.run_attempt,
        expectedMerge: pr.merge_commit_sha, prNumber: pr.number,
        requiredSteps: [native.nativeWorkflowContract.steps.context, native.nativeWorkflowContract.steps.checkout,
          native.nativeWorkflowContract.steps.sourceBytes, 'Provision isolated native toolchain',
          'Freeze exact source candidate', 'Retain frozen candidate'],
      });
      const linux = jobs.find(job => job.name === 'native-linux-x64');
      if (!linux) return failedVerdict('Required current native Linux job is missing');
      let first;
      try {
        first = readTrustedJobContext(linux, await log(linux), {
          repositoryId: api.repositoryId, runId: run.id, attempt: run.run_attempt,
          requireSuccess: false, requiredSteps: [native.nativeWorkflowContract.steps.context],
        });
      } catch (error) {
        if (!(error instanceof SdlcError) || error.code !== 'EVIDENCE') throw error;
        return failedVerdict('Current producer checkout/PR/native association is unverified', [error.message]);
      }
      if (first.prNumber !== pr.number) continue;
      if (run.status !== 'completed') return failedVerdict('Current candidate validation is still running');
      if (first.headSha !== pr.head.sha || first.baseSha !== pr.base.sha ||
          first.mergeSha !== pr.merge_commit_sha || first.headRepositoryId !== pr.head.repo.id) {
        return failedVerdict('Actual producer source tuple is stale or belongs to another PR');
      }
      const artifacts = await api.list(`/actions/runs/${run.id}/artifacts?per_page=100`, 'artifacts');
      const minimumArtifacts = artifacts.filter(artifact =>
        artifact.name === `${native.nativeWorkflowContract.minimumNodeArtifactPrefix}${run.id}-${run.run_attempt}` &&
        artifact.expired === false);
      requireThat(minimumArtifacts.length === 1, 'EVIDENCE',
        'T-PRD014-LX requires one exact retained minimum-runtime compatibility artifact');
      const minimumArtifact = minimumArtifacts[0];
      requireThat(minimumArtifact.workflow_run?.id === run.id &&
        minimumArtifact.workflow_run.repository_id === api.repositoryId &&
        minimumArtifact.workflow_run.head_repository_id === pr.head.repo.id &&
        minimumArtifact.workflow_run.head_sha === pr.head.sha &&
        Number.isSafeInteger(minimumArtifact.id) && minimumArtifact.id > 0 &&
        /^sha256:[a-f0-9]{64}$/u.test(minimumArtifact.digest ?? '') &&
        Number.isSafeInteger(minimumArtifact.size_in_bytes) && minimumArtifact.size_in_bytes > 0,
      'EVIDENCE', 'Minimum-runtime compatibility retention differs from the current source/run artifact');
      const candidates = artifacts.filter(artifact =>
        artifact.name === `frozen-candidate-${run.id}-${run.run_attempt}` && artifact.expired === false);
      requireThat(candidates.length === 1, 'EVIDENCE', 'One exact Linux-frozen candidate artifact is required');
      const frozen = verifyFrozenCandidateData(await api.artifact(candidates[0], { kind: 'candidate' }),
        pr.merge_commit_sha);
      const acquired = [];
      for (const target of validationPlatforms) {
        const matches = jobs.filter(job => job.name === `native-${target}`);
        requireThat(matches.length === 1, 'EVIDENCE', 'The complete native job inventory must exist exactly once');
        const job = matches[0];
        requireThat(Array.isArray(job.labels) && job.labels.includes(labels[target]),
          'EVIDENCE', 'Actual required runner family differs from the Test Plan');
        const facts = readTrustedJobContext(job, await log(job), {
          repositoryId: api.repositoryId, runId: run.id, attempt: run.run_attempt,
          expectedMerge: pr.merge_commit_sha, prNumber: pr.number,
        });
        requireThat(facts.platform === platforms[target] && facts.architecture === target.split('-')[1] &&
          facts.headSha === pr.head.sha && facts.baseSha === pr.base.sha,
        'EVIDENCE', 'Required native/image/source proof differs between jobs');
        const reported = artifacts.filter(artifact =>
          artifact.name === `${native.nativeWorkflowContract.artifactPrefix}${target}-${run.id}-${run.run_attempt}` &&
            artifact.expired === false);
        requireThat(reported.length === 1, 'EVIDENCE', 'One exact current native report artifact is required');
        const data = await api.artifact(reported[0]);
        acquired.push({ target, job, facts, metadata: reported[0], data });
      }
      const executions = [];
      const evaluations = await Promise.all(acquired.map(async ({ target, job, facts, data }) => {
        const raw = data['execution.json'];
        requireThat(raw?.context?.native?.toolchain && data['toolchain.json']?.native,
          'EVIDENCE', 'Original native/bootstrap execution context is missing');
        requireThat(data['toolchain.json'].status === 'Passed' && data['toolchain.json'].target === target,
          'EVIDENCE', 'Report context differs from the successful copied native/bootstrap target');
        const specification = native.nativeSpecification({
          plan: source.plan, inventory: source.inventory, goSources: source.goSources, target, profile: 'pr',
        });
        const toolchain = raw.context.native.toolchain;
        const expectedResources = native.nativeResourceFacts(facts.resources);
        requireThat(typeof toolchain.go === 'string' && typeof toolchain.python === 'string' &&
          toolchain.bootstrap && data['toolchain.json'].native &&
          toolchain.resources && data['toolchain.json'].native.resources &&
          digest(toolchain.resources) === digest(expectedResources) &&
          digest(data['toolchain.json'].native.resources) === digest(expectedResources) &&
          toolchain.node === native.nativeToolchain.node &&
          toolchain.go.startsWith(`go version ${native.nativeToolchain.go} `) &&
          toolchain.python === `Python ${native.nativeToolchain.python}` &&
          digest(toolchain.bootstrap) === digest(data['toolchain.json'].native),
        'EVIDENCE', 'Native tool identities differ from their actual adopted bootstrap records');
        const context = validateExecutionContext({
          candidateDigest: digest({ revision: pr.merge_commit_sha, tree: source.tree.treeSha }),
          testSpecDigest: testSpecificationDigest(source.plan),
          configDigest: native.nativeConfigurationDigest({ inventory: source.inventory, profile: 'pr',
            configuredWorkers: expectedResources.configuredWorkers }),
          inventoryDigest: validationInventoryDigest(specification),
          sources: [{ repositoryId: `repository-${api.repositoryId}`, revision: pr.merge_commit_sha,
            contentDigest: digest(source.tree.treeSha) }],
          profile: specification.profile, environment: 'local', mode: 'automated', owner: 'provider',
          location: specification.cases[0].location,
          native: { kind: 'native', platform: facts.platform, architecture: facts.architecture,
            image: `${facts.ImageOS}/${facts.ImageVersion}`, toolchain: { ...toolchain, resources: expectedResources } },
          producer: { provider: 'github', connection: 'repository-ci', scopeRef: `repository:${api.repositoryId}`,
            definitionRef: `${readinessRepository}/${native.nativeWorkflowContract.path}@refs/pull/${pr.number}/merge`,
            executionRef: String(run.id), attemptRef: String(run.run_attempt), attemptKind: 'known' },
          attemptCapability: 'distinct', jobRef: `native-${target}`, artifacts: frozen.artifacts,
        });
        requireThat(digest(context) === digest(raw.context), 'EVIDENCE',
          'Report context does not match independently acquired source/producer/native/artifact facts');
        requireThat(Date.parse(raw.startedAt) >= Date.parse(job.started_at) &&
          Date.parse(raw.observedAt) < Date.parse(job.completed_at) + 1000,
        'EVIDENCE', 'Original execution times do not belong to this actual job');
        await verifyOriginalNativeRows({ data, raw, specification, inventory: source.inventory,
          goSources: source.goSources, target, candidate: frozen.candidate,
          sourceFiles: source.files, plan: source.plan, context });
        const rawDigest = digest(data.texts[native.nativeWorkflowContract.reports.execution]);
        const selection = {
          profile: specification.profile, executions: [{ id: `native-${target}`, context }],
          now: new Date(now()).toISOString(),
          policy: { maxAgeMs: 24 * 60 * 60 * 1000, revisionPolicy: 'exact', verifierIds: ['github-actions-observer'] },
        };
        const restored = readEvidenceBundle(data['readiness-bundle.json'], {
          specification, context: selection,
        }, input => input.reportDigest === rawDigest ? {
          verifierId: 'github-actions-observer', reportDigest: rawDigest, context,
          sourceTime: raw.observedAt, sourceSequence: raw.sequence,
        } : null);
        executions.push({ target, context });
        return { target, evaluation: restored.evaluation,
          originalText: data.texts[native.nativeWorkflowContract.reports.execution] };
      }));
      const result = native.aggregateNativeReadiness(evaluations, {
        profile: 'pr', sourceRevision: pr.merge_commit_sha, artifacts: frozen.artifacts, executions,
      });
      const definition = deriveNativeComponentSpecification({ inventory: source.inventory,
        testPlan: source.plan, adapterSourceDigest: digest(source.adapterSource.contents) });
      const projection = projectNativeComponentEvidence({ definition, expectedLanes: executions,
        originals: evaluations.map(({ target, originalText }) => ({ target, text: originalText })),
        now: new Date(now()).toISOString(), verifyOriginal: input => {
          const original = acquired.find(lane => lane.target === input.target)?.data;
          const raw = original?.['execution.json'];
          const expected = executions.find(lane => lane.target === input.target)?.context;
          return raw && expected && input.reportDigest === digest(original.texts['execution.json']) &&
            digest(input.claimedContext ?? input.context) === digest(expected) &&
            input.sourceTime === raw.observedAt && input.sourceSequence === raw.sequence ? {
              verifierId: 'github-actions-observer', reportDigest: input.reportDigest, context: expected,
              sourceTime: raw.observedAt, sourceSequence: raw.sequence,
            } : null;
        } });
      componentEvidence.set(pr.number, { prNumber: pr.number, sourceCommit: pr.merge_commit_sha, projection,
        sourceArtifacts: acquired.map(({ target, job, metadata }) => ({
          target, artifactId: metadata.id, artifactDigest: metadata.digest, jobId: job.id,
          runId: run.id, attempt: run.run_attempt,
        })) });
      const passed = result.status === 'Passed' && projection.evaluation.status === 'Passed';
      return { status: passed ? 'Passed' : 'NotRun',
        blockers: [...result.blockers, ...projection.evaluation.cases.filter(test => test.status !== 'Passed')
          .map(test => `Required component ${test.testId}: ${test.status}`)],
        inputDigest: digest({ run: run.id, attempt: run.run_attempt,
          minimumNode,
          source: pr.merge_commit_sha, artifacts: artifacts.map(artifact =>
            ({ id: artifact.id, digest: artifact.digest, expired: artifact.expired })),
          cases: [...result.requiredCases, ...definition.requiredCaseIds],
          componentDefinition: definition.adapterDefinitionDigest,
          status: passed ? 'Passed' : 'NotRun' }) };
    }
    return failedVerdict('No current PR producer execution exists for this exact source');
  }
  const host = {
    async snapshot() {
      componentEvidence.clear();
      const repository = await api.get('');
      requireThat(repository?.id === api.repositoryId && repository.full_name === readinessRepository &&
        repository.owner?.type === 'User' && Number.isSafeInteger(repository.owner.id) && repository.owner.id > 0 &&
        typeof repository.default_branch === 'string' && repository.default_branch.length > 0,
      'SCOPE', 'This policy is bound to the actual personal repository');
      const listed = await api.list(`/pulls?state=open&base=${encodeURIComponent(repository.default_branch)}&per_page=100`);
      requireThat(new Set(listed.map(pr => pr.number)).size === listed.length, 'PROOF_GAP', 'PR membership pagination duplicated an identity');
      let runsPromise;
      const runs = () => {
        runsPromise ??= (async () => {
          const workflow = await api.get('/actions/workflows/ci.yml');
          requireThat(workflow.path === native.nativeWorkflowContract.path &&
            Number.isSafeInteger(workflow.id), 'EVIDENCE', 'Actual PR workflow identity is unavailable');
          return { workflowId: workflow.id,
            runs: await api.list(`/actions/workflows/${workflow.id}/runs?event=pull_request&per_page=100`, 'workflow_runs') };
        })();
        return runsPromise;
      };
      const prs = await mapReads(listed, async item => {
        const pr = await api.get(`/pulls/${item.number}`);
        requireThat(pr && pr.number === item.number && revision.test(pr.head?.sha ?? '') &&
          revision.test(pr.base?.sha ?? '') && Number.isSafeInteger(pr.user?.id) &&
          pr.base?.repo && typeof pr.base.ref === 'string',
        'CONTRACT', 'Actual PR membership needs complete immutable source, target and author facts');
        const verdicts = Object.fromEntries(statusContexts.map(context => [context, failedVerdict('Current facts unavailable')]));
        const base = { number: pr.number, headSha: pr.head.sha, baseSha: pr.base.sha,
          mergeSha: pr.mergeable === true ? pr.merge_commit_sha : null, verdicts };
        if (pr.state !== 'open' || pr.base.repo.id !== api.repositoryId ||
            pr.base.ref !== repository.default_branch) return base;
        verdicts['framework/coverage'] = await observedVerdict(async () => {
          const source = await selectedSource(pr.head.sha);
          const coverage = inspectCoverage({ ...source.coverage, body: pr.body ?? '' });
          const { sourceRevision: baselineRevision, ...baselineInput } = (await selectedSource(adoptedRevision)).coverage;
          const { sourceRevision: currentRevision, ...currentInput } = source.coverage;
          const baseline = compileCoverage(baselineInput);
          const current = compileCoverage(currentInput);
          const narrowed = baseline.coverage.filter(required => !current.coverage.some(candidate =>
            candidate.requirement === required.requirement && candidate.condition === required.condition));
          if (narrowed.length) return { status: 'NotRun', blockers: ['ADOPTED_SCOPE_NARROWED'],
            diagnostics: [{ code: 'ADOPTED_SCOPE_NARROWED',
              message: 'Candidate metadata cannot narrow adopted active required coverage',
              requirements: [...new Set(narrowed.map(item => item.requirement))],
              ids: narrowed.map(item => item.condition) }],
            uncovered: narrowed.map(item => item.condition),
            inputDigest: digest({ head: pr.head.sha, body: digest(pr.body ?? ''), narrowed, baseline, current }) };
          return { status: coverage.complete ? 'Passed' : 'NotRun',
            blockers: coverage.diagnostics.map(diagnostic => diagnostic.code),
            diagnostics: coverage.diagnostics, uncovered: current.uncovered,
            inputDigest: digest({ head: pr.head.sha, body: digest(pr.body ?? ''),
              coverage, specifications: source.coverage }) };
        });
        verdicts['framework/approval'] = await observedVerdict(async () => {
          const reviews = await api.list(`/pulls/${pr.number}/reviews?per_page=100`);
          const reviewFacts = reviews.map(review => ({ id: review.id, actorId: review.user.id,
            state: review.state, commitSha: review.commit_id }));
          const approval = evaluateApproval({
            headSha: pr.head.sha, authorId: pr.user.id,
            reviews: { complete: true, headSha: pr.head.sha, observedAt: new Date(now()).toISOString(),
              items: reviewFacts },
          }, { ownerId: repository.owner.id, now: now(), maxAgeMs: 300000 });
          return { ...approval,
            inputDigest: digest({ head: pr.head.sha, author: pr.user.id, reviews: reviewFacts,
              status: approval.status }) };
        });
        base.conversations = await observedVerdict(async () => {
          const [threads, protection] = await Promise.all([
            api.threads(pr.number, pr.head.sha), api.conversationRule(repository.default_branch),
          ]);
          const observedAt = new Date(now()).toISOString();
          return { ...evaluateConversations({ headSha: pr.head.sha, protection,
            threads: { ...threads, observedAt: new Date(now()).toISOString() } },
          { now: now(), maxAgeMs: 300000 }), headSha: pr.head.sha, observedAt,
          unresolved: threads.unresolved, fingerprint: threads.fingerprint, protection };
        });
        verdicts['framework/validation'] = await observedVerdict(async () => {
          if (revision.test(base.mergeSha ?? '') && pr.head.repo) {
            const merge = await api.get(`/git/commits/${base.mergeSha}`);
            requireThat(merge.parents?.length === 2 &&
              merge.parents.some(parent => parent.sha === pr.head.sha) &&
              merge.parents.some(parent => parent.sha === pr.base.sha),
            'EVIDENCE', 'The current provider test-merge does not bind this head/base pair');
            return nativeVerdict(pr, await selectedSource(base.mergeSha), await runs());
          }
          return failedVerdict('Current complete test-merge/source identity is unavailable');
        });
        return base;
      });
      return { repositoryId: api.repositoryId, complete: true, prs };
    },
    async statuses(key) {
      const items = await api.list(`/commits/${key.sha}/statuses?per_page=100`);
      return { complete: true, items: items.map(item => ({ ...item, creatorId: item.creator?.id })) };
    },
    publish: (key, value) => api.publish(key, value),
    verifyWriterControl: control,
  };
  host.componentEvidence = () => [...componentEvidence.values()];
  return { host, policy: { repositoryId: api.repositoryId, writerId, detailsUrl } };
}

export function renderObserverSummary(result, { completeReportRef, maxBytes = 900 * 1024 }) {
  requireThat(Number.isSafeInteger(maxBytes) && maxBytes >= 1024 && maxBytes <= 900 * 1024 &&
    /^https:\/\/github\.com\/urmich\/ai-sdlc-framework\/actions\/runs\/[1-9]\d*\/attempts\/[1-9]\d*$/u.test(completeReportRef),
  'INPUT', 'Observer summaries need a bounded UI budget and the matching complete-report run');
  const cell = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replace(/([\\|`*_[\]()])/gu, '\\$1')
    .replaceAll('\r', '').replaceAll('\n', '<br>');
  const lines = ['## Repository PR guardrails', '', `**${cell(result.status)}**`, '',
    'Coverage, maintainer approval and native execution are independent verdicts.',
    'NotRun/blocked is not a passing test or proof that provider enforcement is active.', '',
    '| SHA / context | Verdict | PR members | Diagnostic |', '| --- | --- | --- | --- |'];
  const footer = ['', `Complete machine-readable outcomes: ${completeReportRef} (observer artifact).`];
  const reserve = Buffer.byteLength(footer.join('\n')) + 256;
  let bytes = Buffer.byteLength(lines.join('\n'));
  requireThat(bytes + reserve < maxBytes, 'CAPACITY', 'Observer summary budget cannot fit its required header/link');
  const diagnosticBudget = Math.min(8192, Math.max(256, Math.floor((maxBytes - bytes - reserve) / 3)));
  const excerpt = value => {
    let text = '';
    let used = 0;
    for (const character of value) {
      const size = Buffer.byteLength(cell(character));
      if (used + size > diagnosticBudget) return `${text} … [complete diagnostics in observer artifact]`;
      text += character;
      used += size;
    }
    return text;
  };
  let omitted = 0;
  for (const conversation of result.conversations ?? []) {
    const diagnostic = [conversation.enforcement, conversation.capability,
      ...(conversation.blockers ?? [])].filter(Boolean).join('; ');
    const line = `| Native conversations / ${cell(conversation.headSha)} | ${cell(conversation.status)} | ` +
      `PR #${cell(conversation.number)} | ${cell(excerpt(diagnostic))} |`;
    if (bytes + Buffer.byteLength(line) + 1 > maxBytes - reserve) { omitted++; continue; }
    lines.push(line);
    bytes += Buffer.byteLength(line) + 1;
  }
  for (const row of result.results ?? []) {
    const members = row.members?.map(member => member.number).join(', ') ?? '';
    const memberDiagnostics = (row.members ?? []).flatMap(member => [
      ...(member.diagnostics ?? []).map(item => `PR #${member.number}` +
        ([...(item.requirements ?? []), ...(item.ids ?? item.conditions ?? [])].length ?
          ` [${[...(item.requirements ?? []), ...(item.ids ?? item.conditions ?? [])].join(', ')}]` : '') +
        ` ${item.code}: ${item.message}`),
      ...(member.uncovered?.length ? [`PR #${member.number} uncovered: ${member.uncovered.join(', ')}`] : []),
      ...(!member.diagnostics?.length ? (member.blockers ?? []).map(item => `PR #${member.number}: ${item}`) : []),
    ]).join('; ');
    const diagnostic = [row.reason, row.capacity ?
      'Status capacity frozen; an authorized fresh source is required' : '', memberDiagnostics].filter(Boolean).join('; ');
    const line = `| ${cell(row.key?.sha)} / ${cell(row.key?.context)} | ${cell(row.status)} | ${cell(members)} | ${cell(excerpt(diagnostic))} |`;
    if (bytes + Buffer.byteLength(line) + 1 > maxBytes - reserve) { omitted++; continue; }
    lines.push(line);
    bytes += Buffer.byteLength(line) + 1;
  }
  if (omitted) lines.push('', `UI excerpt omitted ${omitted} keys; all outcomes remain in the complete retained report.`);
  lines.push(...footer);
  return `${lines.join('\n')}\n`;
}

export async function retainObserverResult(result, directory, { componentEvidence = [] } = {}) {
  await fs.mkdir(directory, { recursive: true });
  let total = 0;
  const files = [];
  for (const row of result.results ?? []) {
    const text = `${JSON.stringify(row)}\n`;
    const size = Buffer.byteLength(text);
    total += size;
    requireThat(size <= 4 * 1024 * 1024 && total <= 64 * 1024 * 1024,
      'CAPACITY', 'Complete observer outcomes exceed the retained evidence budget');
    const filename = `key-${digest(row.key)}.json`;
    await fs.writeFile(path.join(directory, filename), text, { flag: 'wx' });
    files.push({ filename, sha256: digest(text), size });
  }
  const components = [];
  for (const { prNumber, sourceCommit, projection, sourceArtifacts = [] } of componentEvidence) {
    requireNativeComponentProjection(projection);
    requireThat(Number.isSafeInteger(prNumber) && prNumber > 0 && revision.test(sourceCommit),
      'EVIDENCE', 'Retained component projection requires its actual PR/source identity');
    requireThat(Array.isArray(sourceArtifacts) && sourceArtifacts.length <= 4 &&
      new Set(sourceArtifacts.map(item => item.target)).size === sourceArtifacts.length &&
      sourceArtifacts.every(item => Object.keys(item).length === 6 &&
        Object.keys(item).every(key => ['target', 'artifactId', 'artifactDigest', 'jobId', 'runId', 'attempt'].includes(key)) &&
        validationPlatforms.includes(item.target) && /^sha256:[a-f0-9]{64}$/u.test(item.artifactDigest ?? '') &&
        ['artifactId', 'jobId', 'runId', 'attempt'].every(key => Number.isSafeInteger(item[key]) && item[key] > 0)),
    'EVIDENCE', 'Native artifact references must preserve bounded actual provider identities, never serialized origin authority');
    const retain = async (filename, value, maximum = 4 * 1024 * 1024) => {
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      const size = Buffer.byteLength(text);
      total += size;
      requireThat(size <= maximum && total <= 64 * 1024 * 1024, 'CAPACITY',
        'Complete component SDK evidence exceeds its bounded observer artifact budget');
      await fs.writeFile(path.join(directory, filename), text, { flag: 'wx' });
      return { filename, sha256: digest(text), size };
    };
    const prefix = `components-pr-${prNumber}`;
    const bundle = await retain(`${prefix}-bundle.json`, projection.bundle, 64 * 1024 * 1024);
    const definition = await retain(`${prefix}-definition.json`, projection.definition);
    const provenance = await retain(`${prefix}-native-origins.json`, projection.provenance);
    const originals = [];
    for (const original of projection.originals) originals.push(
      await retain(`${prefix}-${original.executionId}.json`, original.text));
    const nativeOriginals = [];
    for (const original of projection.sourceOriginals) nativeOriginals.push({
      target: original.target,
      ...await retain(`${prefix}-native-${original.target}-execution.json`, original.text),
    });
    components.push({ prNumber, sourceCommit, status: projection.evaluation.status,
      adapterDefinitionDigest: projection.definition.adapterDefinitionDigest,
      bundle, definition, provenance, originals, nativeOriginals, sourceArtifacts });
  }
  const { results, ...summary } = result;
  await fs.writeFile(path.join(directory, 'observer-result.json'),
    `${JSON.stringify({ ...summary, requiredKeys: files.length, files, components })}\n`, { flag: 'wx' });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const env = process.env;
  let result;
  let componentEvidence = [];
  try {
    requireThat(env.GITHUB_ACTIONS === 'true' && env.RUNNER_ENVIRONMENT === 'github-hosted' &&
      env.GITHUB_REPOSITORY === readinessRepository && env.GITHUB_TOKEN &&
      env.GITHUB_SERVER_URL === 'https://github.com' && env.GITHUB_API_URL === 'https://api.github.com' &&
      ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'READINESS_STATUS_CREATOR_ID', 'GITHUB_REPOSITORY_ID']
        .every(field => /^[1-9]\d*$/u.test(env[field] ?? '')),
    'HOST', 'Trusted observer requires actual scoped Actions/writer configuration');
    const defaultRevision = (await execute('git', ['rev-parse', 'HEAD'])).stdout.trim();
    const client = createReadinessGitHubClient({
      repository: readinessRepository, repositoryId: Number(env.GITHUB_REPOSITORY_ID),
      writerId: Number(env.READINESS_STATUS_CREATOR_ID), token: env.GITHUB_TOKEN,
      generation: `run-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`,
      archiveOrigins: JSON.parse(env.READINESS_ARTIFACT_ORIGINS || '[]'),
    });
    const { host, policy } = createPrReadinessHost({
      api: client, defaultRevision, adoptedRevision: env.READINESS_PRODUCER_REVISION || defaultRevision,
      writerId: Number(env.READINESS_STATUS_CREATOR_ID),
      detailsUrl: `https://github.com/${readinessRepository}/actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT}`,
    });
    result = await reconcilePrReadiness(host, policy);
    componentEvidence = host.componentEvidence();
  } catch (error) {
    if (!(error instanceof SdlcError) && !(error instanceof SyntaxError) && error.code !== 'ENOENT') throw error;
    const diagnostic = {
      code: error instanceof SdlcError ? error.code : 'OBSERVER_CONFIGURATION',
      message: error instanceof SdlcError ? error.message :
        'Observer acquisition requires valid configuration and the selected installed tools',
    };
    const safeDiagnostic = sanitizeExecutionPayload(Buffer.from(JSON.stringify(diagnostic)));
    console.error(`[pr-observer:error] ${safeDiagnostic.code}: ${safeDiagnostic.message}`);
    result = { status: 'NotRun', results: [], diagnostic: {
      ...safeDiagnostic,
    } };
  }
  const safe = sanitizeExecutionPayload(Buffer.from(JSON.stringify(result)));
  await retainObserverResult(safe, path.resolve('.test-data', 'pr-observer'), { componentEvidence });
  const reference = `https://github.com/${readinessRepository}/actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT}`;
  if (env.GITHUB_STEP_SUMMARY && /^[1-9]\d*$/u.test(env.GITHUB_RUN_ID ?? '') &&
      /^[1-9]\d*$/u.test(env.GITHUB_RUN_ATTEMPT ?? '')) {
    await fs.appendFile(env.GITHUB_STEP_SUMMARY, renderObserverSummary(safe, { completeReportRef: reference }));
  }
  console.log(JSON.stringify({ status: safe.status, keys: safe.results.length,
    diagnostic: safe.diagnostic ?? null }));
  process.exitCode = safe.status === 'Passed' ? 0 : 2;
}
