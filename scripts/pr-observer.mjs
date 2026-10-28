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
import { inspectWorkflowPolicy, workflowActionPins } from './workflow-policy.mjs';
import { calculatorProjectFiles, calculatorSelection, reconcileCalculator } from './pr-calculator.mjs';
import { homebrewToolchain } from './toolchain-baseline.mjs';
import { sourceNativeBootstrapProtocol, requireNativeBootstrapCapability,
  nativeSdkContextMatches, nativeSdkRequirements, nativeBootstrapRequirements } from './native-bootstrap-capability.mjs';
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
const nativeLaneLimits = Object.freeze({
  'linux-x64': { maximumMs: 460000, maximumInclusive: true },
  'windows-x64': { maximumMs: 665000, maximumInclusive: true },
  'macos-arm64': { maximumMs: 627000, maximumInclusive: true },
  'macos-x64': { maximumMs: 1200000, maximumInclusive: false },
});
function nativeLaneBudgetDescription({ maximumMs, maximumInclusive }) {
  return `${maximumInclusive ? 'at most' : 'strictly below'} ${maximumMs}ms`;
}
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

const macAdmissionResourcePolicy = 'arm-regression-allocation-v1';
const intelPriorityResourcePolicy = 'arm-regression-allocation-v2-priority-intel-bodies';
const intelHomebrewResourcePolicy = 'arm-regression-allocation-v3-intel-homebrew-first';
const retainedFirstResourcePolicy = 'arm-regression-allocation-v4-retained-first';
const criticalBodyResourcePolicy = 'arm-regression-allocation-v5-critical-body-first';
const allCriticalBodiesResourcePolicy = 'arm-regression-allocation-v6-all-critical-bodies-first';
const priorityPolicies = [intelPriorityResourcePolicy, intelHomebrewResourcePolicy,
  retainedFirstResourcePolicy, criticalBodyResourcePolicy, allCriticalBodiesResourcePolicy];
const admissionPolicies = [macAdmissionResourcePolicy, ...priorityPolicies];

function resourceJobKey(part, protocol, resourcePolicy) {
  if ([retainedFirstResourcePolicy, criticalBodyResourcePolicy, allCriticalBodiesResourcePolicy].includes(resourcePolicy)) {
    if (part.target === 'macos-arm64' && part.shard === 'refresh') return 'native-ma-refresh';
    if (part.target === 'macos-x64' &&
      part.shard === (resourcePolicy === retainedFirstResourcePolicy ? 'body-1' : 'body-0')) return 'native-mi-retained';
  }
  if (priorityPolicies.includes(resourcePolicy) && part.target === 'macos-x64') {
    if (part.component === 'homebrew') return 'native-homebrew-mi';
    if (part.shard === 'refresh') return 'native-mi-refresh';
  }
  return native.nativePartJobKey(part, protocol);
}

function expectedMacAdmissionJob(group = 'arm-regressions', retainedFirst = false, allCriticalBodies = false) {
  const job = {
    needs: ['intent', 'source', 'native-units-ma'],
    if: "${{ needs.intent.outputs.requires-native == 'true' }}",
    name: 'Mac regression admission', 'runs-on': labels['linux-x64'], 'timeout-minutes': 10,
    permissions: { actions: 'read', contents: 'read' },
    env: {
      SDLC_REPOSITORY_ID: '${{ github.repository_id }}',
      SDLC_PR_NUMBER: "${{ github.event.pull_request.number || '' }}",
      SDLC_HEAD_REPOSITORY_ID: "${{ github.event.pull_request.head.repo.id || '' }}",
      SDLC_HEAD_SHA: "${{ github.event.pull_request.head.sha || '' }}",
      SDLC_BASE_SHA: "${{ github.event.pull_request.base.sha || '' }}",
      SDLC_MERGE_SHA: '${{ github.sha }}', SDLC_EVENT: '${{ github.event_name }}',
    },
    steps: [
      { name: 'Record trusted execution context', 'working-directory': '${{ github.workspace }}',
        run: 'node -e \'const e=process.env;console.log("sdlc-run-context:"+JSON.stringify({repositoryId:e.SDLC_REPOSITORY_ID,prNumber:e.SDLC_PR_NUMBER||null,headRepositoryId:e.SDLC_HEAD_REPOSITORY_ID||null,headSha:e.SDLC_HEAD_SHA||null,baseSha:e.SDLC_BASE_SHA||null,mergeSha:e.SDLC_MERGE_SHA,event:e.SDLC_EVENT,runId:e.GITHUB_RUN_ID,attempt:e.GITHUB_RUN_ATTEMPT,platform:process.platform,architecture:process.arch}));\'\n' },
      { name: 'Check out exact candidate', uses: `actions/checkout@${workflowActionPins['actions/checkout']}`,
        with: { path: 'source', ref: '${{ needs.source.outputs.source-commit }}', 'persist-credentials': false } },
      { name: 'Materialize committed source bytes',
        run: 'git config --local core.autocrlf false\ngit config --local core.eol lf\n' +
          'git -c core.autocrlf=false -c core.eol=lf checkout-index --force --all\n' },
      { name: 'Select pinned native Node', uses: `actions/setup-node@${workflowActionPins['actions/setup-node']}`,
        with: { 'node-version': '24.20.0', architecture: 'x64', 'check-latest': false } },
      { name: 'Wait for actual ARM worker allocation',
        env: { GITHUB_TOKEN: '${{ github.token }}',
          ADMISSION_HEAD_SHA: '${{ github.event.pull_request.head.sha || github.sha }}' },
        run: 'mkdir -p .test-data\nnode scripts/macos-runner-admission.mjs --repository "$GITHUB_REPOSITORY" ' +
          '--run-id "$GITHUB_RUN_ID" --attempt "$GITHUB_RUN_ATTEMPT" --head-sha "$ADMISSION_HEAD_SHA" ' +
          '--output .test-data/mac-admission.json\n' },
      { name: 'Retain Mac admission observation', if: '${{ always() }}',
        uses: `actions/upload-artifact@${workflowActionPins['actions/upload-artifact']}`,
        with: { name: 'mac-admission-${{ github.run_id }}-${{ github.run_attempt }}',
          path: 'source/.test-data/mac-admission.json', 'if-no-files-found': 'warn', 'retention-days': 90 } },
    ],
  };
  if (group === 'intel-bodies') {
    job.needs = ['intent', 'source', 'native-units-mi', 'mac-admission'];
    job.name = 'Intel body admission';
    job.steps[4].name = 'Wait for actual Intel body worker allocation';
    job.steps[4].run = job.steps[4].run.replace('--output .test-data/mac-admission.json',
      '--group intel-bodies --output .test-data/intel-admission.json');
    job.steps[5].name = 'Retain Intel admission observation';
    job.steps[5].with.name = 'intel-admission-${{ github.run_id }}-${{ github.run_attempt }}';
    job.steps[5].with.path = 'source/.test-data/intel-admission.json';
  }
  if (group === 'intel-homebrew') {
    job.needs = ['intent', 'source', 'native-units-mi', 'intel-admission'];
    job.name = 'Intel Homebrew admission';
    job.steps[4].name = 'Wait for actual Intel Homebrew worker allocation';
    job.steps[4].run = job.steps[4].run.replace('--output .test-data/mac-admission.json',
      '--group intel-homebrew --output .test-data/intel-homebrew-admission.json');
    job.steps[5].name = 'Retain Intel Homebrew admission observation';
    job.steps[5].with.name = 'intel-homebrew-admission-${{ github.run_id }}-${{ github.run_attempt }}';
    job.steps[5].with.path = 'source/.test-data/intel-homebrew-admission.json';
  }
  if (retainedFirst && group === 'intel-bodies') {
    job.needs = ['intent', 'source', 'native-units-mi', 'intel-homebrew-admission'];
  }
  if (retainedFirst && group === 'intel-homebrew') {
    job.needs = ['intent', 'source', 'native-units-mi', 'arm-refresh-admission'];
  }
  if (allCriticalBodies && group === 'intel-bodies') {
    job.needs = ['intent', 'source', 'native-units-mi', 'arm-refresh-admission'];
  }
  if (allCriticalBodies && group === 'intel-homebrew') {
    job.steps[4].name = 'Wait for actual Intel critical body worker allocation';
    job.steps[4].run = job.steps[4].run.replace('--group intel-homebrew', '--group intel-bodies');
  }
  if (group === 'arm-bodies') {
    job.steps[4].name = 'Wait for actual ARM body worker allocation';
    job.steps[4].run = job.steps[4].run.replace('--output .test-data/mac-admission.json',
      '--group arm-bodies --output .test-data/mac-admission.json');
  }
  for (const [selected, id, name, needs] of [
    ['intel-retained-body', 'intel-retained-admission', 'Intel retained admission',
      ['intent', 'source', 'native-units-mi', 'mac-admission']],
    ['intel-primary-body', 'intel-retained-admission', 'Intel retained admission',
      ['intent', 'source', 'native-units-mi', 'mac-admission']],
    ['arm-refresh', 'arm-refresh-admission', 'ARM refresh admission',
      ['intent', 'source', 'native-units-ma', 'intel-retained-admission']],
  ]) if (group === selected) {
    job.needs = needs;
    job.name = name;
    job.steps[4].name = `Wait for actual ${selected === 'arm-refresh' ? 'ARM refresh' :
      selected === 'intel-primary-body' ? 'Intel primary body' : 'Intel retained body'} worker allocation`;
    job.steps[4].run = job.steps[4].run.replace('--output .test-data/mac-admission.json',
      `--group ${selected} --output .test-data/${id}.json`);
    job.steps[5].name = `Retain ${name} observation`;
    job.steps[5].with.name = `${id}-\${{ github.run_id }}-\${{ github.run_attempt }}`;
    job.steps[5].with.path = `source/.test-data/${id}.json`;
  }
  return job;
}

function macAdmissionPolicyMatches(document, protocol, priority, homebrewFirst, retainedFirst) {
  const allCriticalBodies = document.env?.SDLC_MAC_ADMISSION_POLICY === allCriticalBodiesResourcePolicy;
  const summary = document.jobs?.['producer-summary'];
  const expectedSummary = {
    permissions: {}, name: 'Native producer completeness', if: '${{ always() }}',
    needs: summary?.needs ?? null, 'runs-on': labels['linux-x64'], 'timeout-minutes': 5,
    steps: [{
      name: 'Report complete producer scheduling', 'working-directory': '${{ github.workspace }}',
      env: {
        SOURCE_RESULT: '${{ needs.source.result }}', MINIMUM_NODE_RESULT: '${{ needs.minimum-node.result }}',
        NATIVE_RESULT: '${{ needs.native.result }}', UNITS_RESULT: '${{ needs.native-units.result }}',
        HOMEBREW_RESULT: '${{ needs.native-homebrew.result }}',
        WX_UNITS_RESULT: '${{ needs.native-units-wx.result }}', WX_NATIVE_RESULT: '${{ needs.native-wx.result }}',
        MA_UNITS_RESULT: '${{ needs.native-units-ma.result }}', MA_NATIVE_RESULT: '${{ needs.native-ma.result }}',
        MI_UNITS_RESULT: '${{ needs.native-units-mi.result }}', MI_NATIVE_RESULT: '${{ needs.native-mi.result }}',
        MAC_ADMISSION_RESULT: '${{ needs.mac-admission.result }}',
        INTENT_RESULT: '${{ needs.intent.result }}', REQUIRES_NATIVE: '${{ needs.intent.outputs.requires-native }}',
      },
      shell: 'bash',
      run: [
        'test "$INTENT_RESULT" = success',
        'results=("$UNITS_RESULT" "$NATIVE_RESULT" "$WX_UNITS_RESULT" "$WX_NATIVE_RESULT"',
        '  "$MA_UNITS_RESULT" "$MA_NATIVE_RESULT" "$MI_UNITS_RESULT" "$MI_NATIVE_RESULT" "$HOMEBREW_RESULT"',
        '  "$MAC_ADMISSION_RESULT")',
        'if test "$REQUIRES_NATIVE" = false; then',
        "  printf 'Metadata-only edit: native assertions were not executed; this is not native passing evidence.\\n'",
        '  test "$SOURCE_RESULT" = skipped',
        '  test "$MINIMUM_NODE_RESULT" = skipped',
        '  for result in "${results[@]}"; do test "$result" = skipped; done',
        '  exit',
        'fi',
        'test "$REQUIRES_NATIVE" = true',
        'test "$MINIMUM_NODE_RESULT" = success',
        'printf \'Source freeze: %s\\nFour logical lanes / twenty-four required native producer parts: %s\\n\' "$SOURCE_RESULT" "$NATIVE_RESULT"',
        "printf 'Provider-verified framework/validation is evaluated independently by the trusted observer.\\n'",
        'test "$SOURCE_RESULT" = success',
        'for result in "${results[@]}"; do test "$result" = success; done',
        '',
      ].join('\n'),
    }],
  };
  if (priority) {
    const reporting = expectedSummary.steps[0];
    Object.assign(reporting.env, {
      MI_REFRESH_RESULT: '${{ needs.native-mi-refresh.result }}',
      MI_HOMEBREW_RESULT: '${{ needs.native-homebrew-mi.result }}',
      INTEL_ADMISSION_RESULT: '${{ needs.intel-admission.result }}',
    });
    reporting.run = reporting.run.replace('  "$MAC_ADMISSION_RESULT")',
      '  "$MAC_ADMISSION_RESULT" "$INTEL_ADMISSION_RESULT" "$MI_REFRESH_RESULT" "$MI_HOMEBREW_RESULT")');
  }
  if (homebrewFirst) {
    const reporting = expectedSummary.steps[0];
    reporting.env.INTEL_HOMEBREW_ADMISSION_RESULT = '${{ needs.intel-homebrew-admission.result }}';
    reporting.run = reporting.run.replace(' "$MI_HOMEBREW_RESULT")',
      ' "$MI_HOMEBREW_RESULT" "$INTEL_HOMEBREW_ADMISSION_RESULT")');
  }
  if (retainedFirst) {
    const reporting = expectedSummary.steps[0];
    Object.assign(reporting.env, {
      ARM_REFRESH_RESULT: '${{ needs.native-ma-refresh.result }}',
      MI_RETAINED_RESULT: '${{ needs.native-mi-retained.result }}',
      INTEL_RETAINED_ADMISSION_RESULT: '${{ needs.intel-retained-admission.result }}',
      ARM_REFRESH_ADMISSION_RESULT: '${{ needs.arm-refresh-admission.result }}',
    });
    reporting.run = reporting.run.replace(' "$INTEL_HOMEBREW_ADMISSION_RESULT")',
      ' "$INTEL_HOMEBREW_ADMISSION_RESULT" "$ARM_REFRESH_RESULT" "$MI_RETAINED_RESULT" ' +
      '"$INTEL_RETAINED_ADMISSION_RESULT" "$ARM_REFRESH_ADMISSION_RESULT")');
  }
  const sameRecipe = (left, right) => {
    if (!left || !right) return false;
    const copy = structuredClone(left);
    copy.needs = right.needs;
    copy.strategy = right.strategy;
    return digest(copy) === digest(right);
  };
  return protocol === native.nativeFrameworkShardProtocol &&
    digest(document.jobs?.['mac-admission'] ?? null) ===
      digest(expectedMacAdmissionJob(retainedFirst ? 'arm-bodies' : 'arm-regressions')) &&
    (priority ? digest(document.jobs?.['intel-admission'] ?? null) ===
      digest(expectedMacAdmissionJob('intel-bodies', retainedFirst, allCriticalBodies)) : document.jobs?.['intel-admission'] === undefined) &&
    (homebrewFirst ? digest(document.jobs?.['intel-homebrew-admission'] ?? null) ===
      digest(expectedMacAdmissionJob('intel-homebrew', retainedFirst, allCriticalBodies)) :
      document.jobs?.['intel-homebrew-admission'] === undefined) &&
    (!retainedFirst || digest(document.jobs?.['intel-retained-admission'] ?? null) ===
      digest(expectedMacAdmissionJob(document.env?.SDLC_MAC_ADMISSION_POLICY === retainedFirstResourcePolicy ?
        'intel-retained-body' : 'intel-primary-body')) &&
      digest(document.jobs?.['arm-refresh-admission'] ?? null) ===
      digest(expectedMacAdmissionJob('arm-refresh')) &&
      sameRecipe(document.jobs?.['native-mi-retained'], document.jobs?.['native-mi']) &&
      sameRecipe(document.jobs?.['native-ma-refresh'], document.jobs?.['native-ma'])) &&
    (!priority || sameRecipe(document.jobs?.['native-mi-refresh'], document.jobs?.['native-mi']) &&
      sameRecipe(document.jobs?.['native-homebrew-mi'], document.jobs?.['native-homebrew']) &&
      document.concurrency === undefined) &&
    digest(document.defaults?.run ?? null) === digest({ 'working-directory': 'source', shell: 'bash' }) &&
    !Object.keys(document.env ?? {}).some(name =>
      /^(?:GITHUB_|GH_TOKEN$|NODE_OPTIONS$|NODE_PATH$|ADMISSION_HEAD_SHA$)/u.test(name)) &&
    // The exact producer dependency set is checked separately below.
    digest(summary ?? null) === digest(expectedSummary);
}

export function inspectWorkflowTrust(workflows) {
  const result = inspectWorkflowPolicy(workflows);
  let nativeProtocol = null;
  let nativeResourcePolicy = null;
  for (const selected of result.workflows.filter(item => item.file === native.nativeWorkflowContract.path)) {
    const jobs = selected.document.jobs;
    const sharded = jobs?.['native-units'] !== undefined;
    const platformBarrier = ['native-units-wx', 'native-wx', 'native-units-ma', 'native-ma',
      'native-units-mi', 'native-mi'].some(key => jobs?.[key] !== undefined);
    const fourBody = Object.values(jobs ?? {}).some(job => job?.strategy?.matrix?.include?.some(row =>
      ['linux-x64', 'windows-x64'].includes(row.target) && ['body-2', 'body-3'].includes(row.shard)));
    const splitUnits = jobs?.['native-units-mi']?.strategy?.matrix?.include?.some(row => row.shard === 'units-1');
    const protocol = platformBarrier ? splitUnits ? native.nativeFrameworkShardProtocol :
      fourBody ? native.nativeFourBodyFrameworkShardProtocol :
      native.nativePlatformUnitFrameworkShardProtocol :
      sharded ? native.nativeLegacyFrameworkShardProtocol : null;
    nativeProtocol = protocol;
    const resourcePolicy = selected.document.env?.SDLC_MAC_ADMISSION_POLICY;
    const admission = admissionPolicies.includes(resourcePolicy);
    const priority = priorityPolicies.includes(resourcePolicy);
    const allCriticalBodies = resourcePolicy === allCriticalBodiesResourcePolicy;
    const retainedFirst = [retainedFirstResourcePolicy, criticalBodyResourcePolicy,
      allCriticalBodiesResourcePolicy].includes(resourcePolicy);
    const homebrewFirst = retainedFirst || resourcePolicy === intelHomebrewResourcePolicy;
    nativeResourcePolicy = resourcePolicy ?? null;
    if ((resourcePolicy !== undefined &&
        (!admission || !macAdmissionPolicyMatches(selected.document, protocol, priority, homebrewFirst, retainedFirst))) ||
        (!admission && (jobs?.['mac-admission'] !== undefined || jobs?.['intel-admission'] !== undefined)) ||
        (!homebrewFirst && jobs?.['intel-homebrew-admission'] !== undefined) ||
        (!retainedFirst && ['native-ma-refresh', 'native-mi-retained',
          'intel-retained-admission', 'arm-refresh-admission'].some(key => jobs?.[key] !== undefined)) ||
        (!priority && (jobs?.['native-mi-refresh'] !== undefined || jobs?.['native-homebrew-mi'] !== undefined))) {
      result.blockers.push({ file: selected.file, code: 'MAC_ADMISSION_POLICY_DIFFERS' });
    }
    const expectedParts = protocol ? native.nativePrPartsForProtocol(protocol) : native.nativeLegacyPrParts;
    const keys = protocol ? [...new Set(expectedParts.map(part =>
      resourceJobKey(part, protocol, resourcePolicy)))] : ['native'];
    const entries = keys.flatMap(key => jobs?.[key]?.strategy?.matrix?.include ?? []);
    const runners = JSON.stringify(entries);
    for (const label of Object.values(labels)) if (!runners.includes(`"${label}"`)) {
      result.blockers.push({ file: selected.file, code: 'MISSING_NATIVE_RUNNER', label });
    }
    const expected = expectedParts.map(part => ({
      ...part, os: labels[part.target], architecture: part.target.split('-')[1],
    }));
    if (entries.length !== expected.length ||
        new Set(entries.map(entry => entry?.role)).size !== expected.length ||
        expected.some(part => !entries.some(entry => digest(entry) === digest(part))) ||
        protocol && keys.some(key => {
          const part = expectedParts.find(part => resourceJobKey(part, protocol, resourcePolicy) === key);
          const needs = ['intent', 'source', ...(part.shard &&
            !native.nativeFrameworkUnitShardNames(part.target, protocol).includes(part.shard) ?
            [native.nativePartJobKey({ ...part, shard: 'units' }, protocol)] : []),
          ...(admission && key === 'native-mi' ?
            [allCriticalBodies ? 'arm-refresh-admission' :
              retainedFirst ? 'intel-homebrew-admission' : 'mac-admission'] : []),
          ...(priority && ['native-mi-refresh', 'native-homebrew-mi'].includes(key) ?
            [retainedFirst ? key === 'native-mi-refresh' ? 'intel-admission' :
              allCriticalBodies ? 'intel-homebrew-admission' : 'arm-refresh-admission' :
              homebrewFirst && key === 'native-mi-refresh' ? 'intel-homebrew-admission' : 'intel-admission'] : []),
          ...(retainedFirst && key === 'native-mi-retained' ? ['mac-admission'] : []),
          ...(retainedFirst && key === 'native-ma-refresh' ? ['intel-retained-admission'] : [])];
          return jobs[key]?.strategy?.['fail-fast'] !== false || jobs[key]?.['timeout-minutes'] !== 360 ||
            priority && (jobs[key]?.name !== 'native-${{ matrix.role }}' ||
              jobs[key]?.['runs-on'] !== '${{ matrix.os }}' ||
              digest(Object.keys(jobs[key]?.strategy ?? {}).sort()) !== digest(['fail-fast', 'matrix']) ||
              digest(Object.keys(jobs[key]?.strategy?.matrix ?? {})) !== digest(['include'])) ||
            jobs[key]?.strategy?.matrix?.include?.some(row => resourceJobKey(row, protocol, resourcePolicy) !== key) ||
            digest(jobs[key]?.needs ?? null) !== digest(needs);
        }) ||
        platformBarrier &&
          digest([...(jobs['producer-summary']?.needs ?? [])].sort()) !==
            digest(['intent', 'minimum-node', 'source', ...keys, ...(admission ? ['mac-admission'] : []),
              ...(priority ? ['intel-admission'] : []),
              ...(homebrewFirst ? ['intel-homebrew-admission'] : []),
              ...(retainedFirst ? ['intel-retained-admission', 'arm-refresh-admission'] : [])].sort())) {
      result.blockers.push({ file: selected.file, code: 'NATIVE_COMPONENT_MATRIX_DIFFERS' });
    }
  }
  return { ...result, nativeProtocol, nativeResourcePolicy, complete: result.blockers.length === 0 };
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

export function verifyNativeCleanup(data, { target, role, context, jobKey = 'native',
  component = 'full', shard = null, bootstrapProtocol = null, inventory, plan,
  assignment, shardProtocol = native.nativeFrameworkShardProtocol }) {
  const request = data?.['native-homebrew-prefix-request.json'];
  const allocation = data?.['native-homebrew-prefix-allocation.json'];
  const cleanup = data?.['native-homebrew-prefix-cleanup.json'];
  const binding = request?.binding;
  const github = binding?.github;
  const prefix = request?.prefix;
  const capability = requireNativeBootstrapCapability({ bootstrap: data?.['toolchain.json'],
    inventory, plan, assignment, shardProtocol, target, profile: 'pr', component, shard, role, protocol: bootstrapProtocol, prefix });
  const resources = nativeBootstrapRequirements({ inventory, plan, assignment, shardProtocol, target, profile: 'pr', component, shard, role,
    protocol: bootstrapProtocol });
  requireThat(request?.schemaVersion === 1 &&
    request.repositoryRoot === `${github?.GITHUB_WORKSPACE}/source` &&
    request.bootstrapDirectory === `${request.repositoryRoot}/.test-data/bootstrap-${role}` &&
    binding?.target === target && binding.host?.platform === 'darwin' &&
    binding.host.architecture === context.native.architecture &&
    binding.host.machine === (context.native.architecture === 'arm64' ? 'arm64' : 'x86_64') &&
    /^24\./u.test(binding.host.release ?? '') &&
    Number.isSafeInteger(binding.host.uid) && binding.host.uid > 0 &&
    Number.isSafeInteger(binding.host.gid) && binding.host.gid > 0 &&
    binding.schemaVersion === 1 && github?.GITHUB_SERVER_URL === 'https://github.com' &&
    github.GITHUB_REPOSITORY === readinessRepository &&
    `repository-${github.GITHUB_REPOSITORY_ID}` === context.sources[0].repositoryId &&
    github.GITHUB_RUN_ID === context.producer.executionRef &&
    github.GITHUB_RUN_ATTEMPT === context.producer.attemptRef && github.GITHUB_JOB === jobKey &&
    github.RUNNER_ENVIRONMENT === 'github-hosted' && github.RUNNER_OS === 'macOS' &&
    github.RUNNER_ARCH === (context.native.architecture === 'arm64' ? 'ARM64' : 'X64') &&
    data['toolchain.json']?.status === 'Passed' &&
    digest(data['toolchain.json'].native) === digest(context.native.toolchain.bootstrap),
  'EVIDENCE', 'Mac resource diagnostics differ from their own bootstrap, source or run attempt');
  if (!resources.ownedPrefix) {
    const expected = { schemaVersion: 1, kind: 'native-homebrew-prefix-not-required',
      repositoryRoot: request.repositoryRoot, bootstrapDirectory: request.bootstrapDirectory, binding };
    requireThat(digest(request) === digest(expected) &&
      typeof data.texts?.['native-homebrew-prefix-request.json'] === 'string' &&
      digest(JSON.parse(data.texts['native-homebrew-prefix-request.json'])) === digest(expected) &&
      !Object.hasOwn(data, 'native-homebrew-prefix-allocation.json') &&
      !Object.hasOwn(data, 'native-homebrew-prefix-cleanup.json') &&
      !Object.hasOwn(data.texts, 'native-homebrew-prefix-allocation.json') &&
      !Object.hasOwn(data.texts, 'native-homebrew-prefix-cleanup.json'),
    'EVIDENCE', 'Prefix-free roles require source-bound nonallocation proof, not allocated or borrowed prefix facts');
    return { role, status: 'not-required' };
  }
  requireThat(request.kind === 'owned-native-homebrew-prefix' &&
    typeof prefix === 'string' && /^\/opt\/[a-f0-9]{5}$/u.test(prefix) &&
    /^[a-f0-9]{64}$/u.test(request.nonce ?? '') &&
    (capability && component === 'framework' ? context.native.toolchain.bootstrap.homebrew?.prefix === prefix :
      context.native.toolchain.bootstrap.homebrew?.nodePrefix === `${prefix}/opt/${homebrewToolchain.formula}`) &&
    typeof data.texts?.['native-homebrew-prefix-request.json'] === 'string' &&
    allocation?.schemaVersion === 1 &&
    allocation.requestDigest === digest(data.texts['native-homebrew-prefix-request.json']) &&
    /^[a-f0-9]{64}$/u.test(allocation.markerDigest ?? '') &&
    allocation.prefixIdentity?.uid === binding.host.uid && allocation.prefixIdentity?.gid === binding.host.gid &&
    cleanup?.schemaVersion === 1 && cleanup.status === 'removed' &&
    cleanup.requestDigest === allocation.requestDigest &&
    digest(cleanup.prefixIdentity) === digest(allocation.prefixIdentity),
  'EVIDENCE', 'Required Mac producer cleanup differs from its own allocated prefix, bootstrap, source or run attempt');
  return { role, prefix, requestDigest: allocation.requestDigest };
}

export function nativeLaneTimings(parts, { frameworkShards = true,
  shardProtocol = native.nativeFrameworkShardProtocol } = {}) {
  const expectedParts = frameworkShards ? native.nativePrPartsForProtocol(shardProtocol) : native.nativeLegacyPrParts;
  requireThat(Array.isArray(parts) && parts.length === expectedParts.length &&
    new Set(parts.map(part => part.role)).size === expectedParts.length &&
    parts.every(part => expectedParts.some(expected =>
      expected.target === part.target && expected.role === part.role)),
  'EVIDENCE', 'Logical timing needs the exact complete six-role native producer inventory');
  return validationPlatforms.map(target => {
    const selected = parts.filter(part => part.target === target);
    const expected = expectedParts.filter(part => part.target === target);
    requireThat(selected.length === expected.length &&
      expected.every(part => selected.filter(item => item.role === part.role).length === 1) &&
      selected.every(({ job }) => Number.isFinite(Date.parse(job?.started_at)) &&
        Number.isFinite(Date.parse(job?.completed_at)) &&
        Date.parse(job.completed_at) >= Date.parse(job.started_at) &&
        (job.created_at === undefined || job.created_at === null || Number.isFinite(Date.parse(job.created_at)) &&
          Date.parse(job.created_at) <= Date.parse(job.started_at))),
    'EVIDENCE', 'Logical lane timing requires every exact required worker start and completed cleanup/evidence job');
    const startedAt = new Date(Math.min(...selected.map(({ job }) => Date.parse(job.started_at)))).toISOString();
    const completedAt = new Date(Math.max(...selected.map(({ job }) => Date.parse(job.completed_at)))).toISOString();
    const durationMs = Date.parse(completedAt) - Date.parse(startedAt);
    const { maximumMs, maximumInclusive } = nativeLaneLimits[target];
    return { target, startedAt, completedAt, durationMs, maximumMs, maximumInclusive,
      withinBudget: durationMs < maximumMs || maximumInclusive && durationMs === maximumMs,
      parts: selected.map(({ role, job }) => ({ role, jobId: job.id,
        startedAt: job.started_at, completedAt: job.completed_at,
        providerQueueMs: Number.isFinite(Date.parse(job.created_at)) ?
          Date.parse(job.started_at) - Date.parse(job.created_at) : null })) };
  });
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
  component = 'full', shard = null, shardProtocol = native.nativeFrameworkShardProtocol,
  bootstrapProtocol = null,
}) {
  requireThat(Array.isArray(raw.results) && raw.results.every(row => row &&
    Object.getPrototypeOf(row) === Object.prototype), 'EVIDENCE',
  'Original derived native results must be a complete literal result collection');
  if (shard !== null) {
    const assignment = native.nativeExpectedAssignment({ inventory, plan, target, protocol: shardProtocol });
    const part = assignment.parts.find(part => part.shard === shard);
    requireThat(part && digest(specification) === digest(native.nativeSpecification({
      inventory, plan, goSources, target, profile: 'pr', component, shard, shardProtocol,
    })), 'EVIDENCE', 'Native shard specification differs from the independently derived assignment');
    const calculatorSources = sourceFiles.filter(source => calculatorProjectFiles(inventory).includes(source.file));
    const reconstructed = await native.reconcileNativeEvidenceData({ data, inventory, plan, shardProtocol, bootstrapProtocol,
      sources: goSources, calculatorSources, target, component, shard, candidate,
      stages: part.stages, context, specification, startedAt: raw.startedAt });
    requireThat(reconstructed.raw.complete && reconstructed.raw.exitCode === 0 &&
      raw.complete && raw.exitCode === 0 && digest(reconstructed.raw.results) === digest(raw.results) &&
      reconstructed.raw.observedAt === raw.observedAt && reconstructed.raw.finishedAt === raw.finishedAt,
    'EVIDENCE', 'Original shard commands, selected root closures or procedures do not reconcile');
    return;
  }
  const expectedStages = component === 'homebrew' ? [] : native.nativeStageSelections(inventory, plan);
  const smallContext = {
    schemaVersion: 1, sourceCommit: context.sources[0].revision, target, profile: 'pr',
    ...(component === 'full' ? {} : { component }),
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
    if (!nativeSdkRequirements({ inventory, plan, target, profile: 'pr', component, shard,
      protocol: bootstrapProtocol })[name === 'go-version' ? 'go' : 'python']) {
      requireThat(command === undefined, 'EVIDENCE', 'Omitted SDK preflight cannot contain fabricated tool reports');
      continue;
    }
    requireThat(command?.kind === 'validation-command' && command.complete === true &&
      command.exitCode === 0 && command.node === `v${native.nativeToolchain.node}` &&
      command.platform === context.native.platform && command.architecture === context.native.architecture &&
      digest(command.context) === digest(smallContext) && Array.isArray(command.command) &&
      digest(command.command.slice(1)) === digest(args) &&
      typeof command.stdout === 'string' && command.stdout.trim() === expected &&
      Date.parse(command.startedAt) >= Date.parse(raw.startedAt) &&
      Date.parse(command.finishedAt) <= Date.parse(stages[0]?.startedAt ??
        data['candidate-verification.json']?.observedAt),
    'EVIDENCE', 'Original SDK preflight did not establish the selected native toolchain before unit execution');
  }
  const observations = new Map();
  if (component !== 'homebrew') {
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
  }
  const calculatorSources = sourceFiles.filter(source => calculatorProjectFiles(inventory).includes(source.file));
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
  if (target.startsWith('macos-') && component !== 'framework') {
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
    plan, bootstrapProtocol, sources: goSources, calculatorSources, target, component, candidate,
    stages: expectedStages, context, startedAt: raw.startedAt });
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
  const workflow = { file: native.nativeWorkflowContract.path,
    contents: await api.file(tree, native.nativeWorkflowContract.path) };
  const trust = inspectWorkflowTrust([workflow]);
  requireThat(trust.complete, 'EVIDENCE', 'Native producer role/dependency definition differs from the adopted topology');
  const frameworkShards = trust.nativeProtocol !== null;
  const bootstrapProtocol = sourceNativeBootstrapProtocol([{ file: 'scripts/toolchain-baseline.mjs',
    contents: await api.file(tree, 'scripts/toolchain-baseline.mjs') }]);
  return { tree, inventory, goSources, requirements, testPlans, files, adapterSource,
    frameworkShards, shardProtocol: trust.nativeProtocol, resourcePolicy: trust.nativeResourcePolicy, bootstrapProtocol,
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
    if (source.bootstrapProtocol !== null) paths.add('scripts/native-bootstrap-capability.mjs');
    if (admissionPolicies.includes(source.resourcePolicy)) paths.add('scripts/macos-runner-admission.mjs');
    return [...paths].every(file => adopted.paths.get(file)?.sha &&
      source.tree.paths.get(file)?.sha === adopted.paths.get(file).sha);
  }
  async function nativeVerdict(pr, source, { workflowId, runs }) {
    return native.withNativeDefinitionPass({
      inventory: source.inventory, plan: source.plan, goSources: source.goSources,
      frameworkShards: source.frameworkShards,
      shardProtocol: source.shardProtocol ?? native.nativeFrameworkShardProtocol,
    }, owned => nativeVerdictForPass(pr, {
      ...source, inventory: owned.inventory, plan: owned.plan, goSources: owned.goSources,
    }, { workflowId, runs }));
  }
  async function nativeVerdictForPass(pr, source, { workflowId, runs }) {
    const frameworkShards = source.frameworkShards;
    const shardProtocol = source.shardProtocol ?? native.nativeFrameworkShardProtocol;
    const expectedParts = frameworkShards ? native.nativePrPartsForProtocol(shardProtocol) : native.nativeLegacyPrParts;
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
      const linux = jobs.find(job => job.name === (frameworkShards ?
        'native-linux-x64-framework-units' : 'native-linux-x64'));
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
      const artifactFor = name => {
        const matches = artifacts.filter(artifact => artifact.name === name && artifact.expired === false);
        requireThat(matches.length === 1, 'EVIDENCE', 'One exact current producer role artifact is required');
        const artifact = matches[0];
        requireThat(artifact.workflow_run?.id === run.id &&
          artifact.workflow_run.repository_id === api.repositoryId &&
          artifact.workflow_run.head_repository_id === pr.head.repo.id &&
          artifact.workflow_run.head_sha === pr.head.sha &&
          Number.isSafeInteger(artifact.id) && artifact.id > 0 &&
          /^sha256:[a-f0-9]{64}$/u.test(artifact.digest ?? '') &&
          Number.isSafeInteger(artifact.size_in_bytes) && artifact.size_in_bytes > 0,
        'EVIDENCE', 'Producer artifact source, run, repository or digest differs from the selected attempt');
        return artifact;
      };
      const frozen = verifyFrozenCandidateData(await api.artifact(artifactFor(candidates[0].name),
        { kind: 'candidate' }), pr.merge_commit_sha);
      for (const [prefix, parts] of [
        [native.nativeWorkflowContract.artifactPrefix, expectedParts],
        [native.nativeWorkflowContract.bootstrapArtifactPrefix, expectedParts],
        [native.nativeWorkflowContract.cleanupArtifactPrefix,
          expectedParts.filter(part => part.target.startsWith('macos-'))],
      ]) {
        const current = artifacts.filter(artifact => artifact.name.startsWith(prefix) &&
          artifact.name.endsWith(`-${run.id}-${run.run_attempt}`) && artifact.expired === false);
        requireThat(current.length === parts.length && current.every(artifact =>
          parts.some(part => artifact.name === `${prefix}${part.role}-${run.id}-${run.run_attempt}`)),
        'EVIDENCE', 'The exact native report artifact role inventory is missing, duplicate or unexpected');
      }
      requireThat(jobs.filter(job => job.name.startsWith('native-')).length === expectedParts.length,
        'EVIDENCE', 'The exact native producer inventory must not contain missing, duplicate or unexpected roles');
      const acquired = [];
      for (const { target, component, role, shard = null } of expectedParts) {
        const matches = jobs.filter(job => job.name === `native-${role}`);
        requireThat(matches.length === 1, 'EVIDENCE', 'The complete native job inventory must exist exactly once');
        const job = matches[0];
        requireThat(Number.isSafeInteger(job.id) && job.id > 0 &&
          job.run_attempt === run.run_attempt && job.status === 'completed' &&
          Array.isArray(job.labels) && job.labels.includes(labels[target]),
          'EVIDENCE', 'Actual required runner family differs from the Test Plan');
        const requiredSteps = [
          native.nativeWorkflowContract.steps.context, native.nativeWorkflowContract.steps.checkout,
          native.nativeWorkflowContract.steps.sourceBytes, 'Provision isolated native toolchain',
          'Retain native bootstrap diagnostics', native.nativeWorkflowContract.steps.execution,
          native.nativeWorkflowContract.steps.retention,
          ...(target.startsWith('macos-') ?
            ['Remove owned short Homebrew prefix', 'Retain native cleanup diagnostics'] : []),
        ];
        const facts = readTrustedJobContext(job, await log(job), {
          repositoryId: api.repositoryId, runId: run.id, attempt: run.run_attempt,
          expectedMerge: pr.merge_commit_sha, prNumber: pr.number, requiredSteps,
        });
        requireThat(facts.platform === platforms[target] && facts.architecture === target.split('-')[1] &&
          facts.headSha === pr.head.sha && facts.baseSha === pr.base.sha &&
          facts.nativeRole === role && facts.nativeComponent === component &&
          (!frameworkShards || facts.nativeShard === shard),
        'EVIDENCE', 'Required native/image/source proof differs between jobs');
        const metadata = artifactFor(`${native.nativeWorkflowContract.artifactPrefix}${role}-${run.id}-${run.run_attempt}`);
        const bootstrapMetadata = artifactFor(
          `${native.nativeWorkflowContract.bootstrapArtifactPrefix}${role}-${run.id}-${run.run_attempt}`);
        const data = await api.artifact(metadata);
        let cleanupData;
        let cleanupMetadata;
        if (target.startsWith('macos-')) {
          cleanupMetadata = artifactFor(
            `${native.nativeWorkflowContract.cleanupArtifactPrefix}${role}-${run.id}-${run.run_attempt}`);
          cleanupData = await api.artifact(cleanupMetadata, { kind: 'cleanup',
            ownedPrefix: nativeBootstrapRequirements({ inventory: source.inventory, plan: source.plan,
              target, profile: 'pr', component, shard, role,
              protocol: source.bootstrapProtocol }).ownedPrefix });
        }
        acquired.push({ target, component, role, shard, job, facts, metadata, data,
          bootstrapMetadata, cleanupMetadata, cleanupData });
      }
      const artifactIds = acquired.flatMap(part => [part.metadata.id, part.bootstrapMetadata.id,
        ...(part.cleanupMetadata ? [part.cleanupMetadata.id] : [])]);
      requireThat(new Set(acquired.map(part => part.job.id)).size === acquired.length &&
        new Set(artifactIds).size === artifactIds.length, 'EVIDENCE',
      'Native producer parts require distinct actual jobs and separate native/bootstrap/cleanup artifacts');
      const executions = [];
      const evaluations = await Promise.all(acquired.map(async ({ target, component, role, shard, job, facts, data, cleanupData }) => {
        const raw = data['execution.json'];
        requireThat(raw?.context?.native?.toolchain && data['toolchain.json']?.native,
          'EVIDENCE', 'Original native/bootstrap execution context is missing');
        requireThat(data['toolchain.json'].status === 'Passed' && data['toolchain.json'].target === target,
          'EVIDENCE', 'Report context differs from the successful copied native/bootstrap target');
        const specification = native.nativeSpecification({
          plan: source.plan, inventory: source.inventory, goSources: source.goSources,
          target, component, shard, profile: 'pr', shardProtocol,
        });
        const assignment = shard === null ? null : native.nativeExpectedAssignment({
          inventory: source.inventory, plan: source.plan, target, protocol: shardProtocol,
        });
        const toolchain = raw.context.native.toolchain;
        requireNativeBootstrapCapability({ bootstrap: data['toolchain.json'], inventory: source.inventory, plan: source.plan, assignment, target,
          profile: 'pr', component, shard, role, protocol: source.bootstrapProtocol });
        const expectedResources = native.nativeResourceFacts(facts.resources);
        requireThat(nativeSdkContextMatches(toolchain, {
          inventory: source.inventory, plan: source.plan, assignment, target, profile: 'pr', component, shard, protocol: source.bootstrapProtocol }) &&
          toolchain.bootstrap && data['toolchain.json'].native &&
          toolchain.resources && data['toolchain.json'].native.resources &&
          digest(toolchain.resources) === digest(expectedResources) &&
          digest(data['toolchain.json'].native.resources) === digest(expectedResources) &&
          toolchain.node === native.nativeToolchain.node &&
          digest(toolchain.bootstrap) === digest(data['toolchain.json'].native),
        'EVIDENCE', 'Native tool identities differ from their actual adopted bootstrap records');
        const context = validateExecutionContext({
          candidateDigest: digest({ revision: pr.merge_commit_sha, tree: source.tree.treeSha }),
          testSpecDigest: testSpecificationDigest(source.plan),
          configDigest: native.nativeConfigurationDigest({ inventory: source.inventory, plan: source.plan, assignment, profile: 'pr', target, component, shard, shardProtocol,
            bootstrapProtocol: source.bootstrapProtocol,
            shardPlanDigest: assignment?.digest ?? null,
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
          attemptCapability: 'distinct', jobRef: `native-${role}`, artifacts: frozen.artifacts,
        });
        requireThat(digest(context) === digest(raw.context), 'EVIDENCE',
          'Report context does not match independently acquired source/producer/native/artifact facts');
        requireThat(Date.parse(raw.startedAt) >= Date.parse(job.started_at) &&
          Date.parse(raw.observedAt) < Date.parse(job.completed_at) + 1000,
        'EVIDENCE', 'Original execution times do not belong to this actual job');
        await verifyOriginalNativeRows({ data, raw, specification, inventory: source.inventory,
          goSources: source.goSources, target, component, shard, shardProtocol, candidate: frozen.candidate,
          sourceFiles: source.files, plan: source.plan, context, bootstrapProtocol: source.bootstrapProtocol });
        if (cleanupData) verifyNativeCleanup(cleanupData, { target, role, context,
          inventory: source.inventory, plan: source.plan, assignment, shardProtocol,
          component, shard, bootstrapProtocol: source.bootstrapProtocol,
          jobKey: frameworkShards ?
            resourceJobKey({ target, shard, component }, shardProtocol, source.resourcePolicy) : 'native' });
        const rawDigest = digest(data.texts[native.nativeWorkflowContract.reports.execution]);
        const selection = {
          profile: specification.profile, executions: [{ id: `native-${role}`, context }],
          now: new Date(now()).toISOString(),
          policy: { maxAgeMs: 24 * 60 * 60 * 1000, revisionPolicy: 'exact', verifierIds: ['github-actions-observer'] },
        };
        const restored = readEvidenceBundle(data['readiness-bundle.json'], {
          specification, context: selection,
        }, input => input.reportDigest === rawDigest ? {
          verifierId: 'github-actions-observer', reportDigest: rawDigest, context,
          sourceTime: raw.observedAt, sourceSequence: raw.sequence,
        } : null);
        executions.push({ target, component, shard, context });
        return { target, component, shard, role, evaluation: restored.evaluation,
          originalText: data.texts[native.nativeWorkflowContract.reports.execution] };
      }));
      const unitOrder = frameworkShards ? native.verifyNativeShardUnitOrder(executions.map(part => ({
        ...part, job: acquired.find(original => original.role === part.context.jobRef.slice('native-'.length)).job,
      })), { protocol: shardProtocol }) : null;
      const prefixParts = expectedParts.filter(part => part.target.startsWith('macos-') &&
        nativeBootstrapRequirements({ inventory: source.inventory, plan: source.plan,
          ...part, profile: 'pr', protocol: source.bootstrapProtocol }).ownedPrefix);
      const prefixes = acquired.filter(part => prefixParts.some(expected => expected.role === part.role)).map(part =>
        part.cleanupData?.['native-homebrew-prefix-request.json']?.prefix);
      requireThat(prefixes.every(prefix => typeof prefix === 'string') &&
        prefixes.length === prefixParts.length && new Set(prefixes).size === prefixes.length, 'EVIDENCE',
        'Every required Mac producer must retain its own distinct guarded prefix allocation');
      const result = native.aggregateNativeReadiness(evaluations, {
        profile: 'pr', components: true, frameworkShards, sourceRevision: pr.merge_commit_sha,
        artifacts: frozen.artifacts, executions, inventory: source.inventory, plan: source.plan,
        goSources: source.goSources, unitOrder, shardProtocol, bootstrapProtocol: source.bootstrapProtocol,
      });
      const laneTimings = nativeLaneTimings(acquired, { frameworkShards, shardProtocol });
      const auxiliaryJobs = [freezes[0], minimumJobs[0]].map(job => ({
        name: job.name, jobId: job.id, startedAt: job.started_at, completedAt: job.completed_at,
        durationMs: Date.parse(job.completed_at) - Date.parse(job.started_at),
        providerQueueMs: Number.isFinite(Date.parse(job.created_at)) ?
          Date.parse(job.started_at) - Date.parse(job.created_at) : null,
      }));
      const frameworkExecutions = executions.filter(part => part.component !== 'homebrew');
      const frameworkEvaluations = evaluations.filter(part => part.component !== 'homebrew');
      const definition = deriveNativeComponentSpecification({ inventory: source.inventory,
        testPlan: source.plan, adapterSourceDigest: digest(source.adapterSource.contents),
        frameworkShards, goSources: source.goSources, shardProtocol, bootstrapProtocol: source.bootstrapProtocol });
      const projection = projectNativeComponentEvidence({ definition, expectedLanes: frameworkExecutions,
        ...(frameworkShards ? { unitOrder, nativeEvaluations: frameworkEvaluations.map(part => ({
          role: part.role, evaluation: part.evaluation,
        })) } : {}),
        originals: frameworkEvaluations.map(({ target, role, originalText }) => ({
          target, ...(frameworkShards ? { role } : {}), text: originalText,
        })),
        now: new Date(now()).toISOString(), verifyOriginal: input => {
          const original = acquired.find(lane => lane.target === input.target && lane.component !== 'homebrew' &&
            (!frameworkShards || lane.role === input.role))?.data;
          const raw = original?.['execution.json'];
          const expected = frameworkExecutions.find(lane => lane.target === input.target &&
            (!frameworkShards || lane.context.jobRef === `native-${input.role}`))?.context;
          return raw && expected && input.reportDigest === digest(original.texts['execution.json']) &&
            digest(input.claimedContext ?? input.context) === digest(expected) &&
            input.sourceTime === raw.observedAt && input.sourceSequence === raw.sequence ? {
              verifierId: 'github-actions-observer', reportDigest: input.reportDigest, context: expected,
              sourceTime: raw.observedAt, sourceSequence: raw.sequence,
            } : null;
        } });
      componentEvidence.set(pr.number, { prNumber: pr.number, sourceCommit: pr.merge_commit_sha, projection,
        laneTimings, auxiliaryJobs,
        nativeParts: acquired.map(({ target, component, role, shard, job, metadata, bootstrapMetadata, cleanupMetadata }) => ({
          target, component, role, jobId: job.id,
          ...(shard === null ? {} : { shard }),
          artifactId: metadata.id, artifactDigest: metadata.digest,
          bootstrapArtifactId: bootstrapMetadata.id, bootstrapArtifactDigest: bootstrapMetadata.digest,
          ...(cleanupMetadata ? { cleanupArtifactId: cleanupMetadata.id, cleanupArtifactDigest: cleanupMetadata.digest } : {}),
          runId: run.id, attempt: run.run_attempt,
        })),
        sourceArtifacts: acquired.filter(part => part.component !== 'homebrew').map(({ target, role, job, metadata }) => ({
          target, artifactId: metadata.id, artifactDigest: metadata.digest, jobId: job.id,
          ...(frameworkShards ? { role } : {}),
          runId: run.id, attempt: run.run_attempt,
        })) });
      const timingBlockers = laneTimings.filter(lane => !lane.withinBudget)
        .map(lane => `Native ${lane.target} complete required worker span ${lane.durationMs}ms exceeds its ` +
          `${nativeLaneBudgetDescription(lane)} limit`);
      const passed = result.status === 'Passed' && projection.evaluation.status === 'Passed' && !timingBlockers.length;
      return { status: passed ? 'Passed' : 'NotRun',
        laneTimings,
        blockers: [...result.blockers, ...timingBlockers, ...projection.evaluation.cases.filter(test => test.status !== 'Passed')
          .map(test => `Required component ${test.testId}: ${test.status}`)],
        inputDigest: digest({ run: run.id, attempt: run.run_attempt,
          minimumNode,
          source: pr.merge_commit_sha, artifacts: artifacts.map(artifact =>
            ({ id: artifact.id, digest: artifact.digest, expired: artifact.expired })),
          cases: [...result.requiredCases, ...definition.requiredCaseIds],
          componentDefinition: definition.adapterDefinitionDigest, laneTimings,
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

export function renderObserverSummary(result, { completeReportRef, maxBytes = 900 * 1024,
  componentEvidence = [] }) {
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
  for (const entry of componentEvidence) for (const lane of entry.laneTimings ?? []) {
    const queues = lane.parts.map(part =>
      `${part.role}: ${part.providerQueueMs === null ? 'unknown' : `${part.providerQueueMs}ms`}`).join('; ');
    const line = `| Native span / ${cell(lane.target)} | ${lane.withinBudget ? 'Within budget' : 'Over budget'} | ` +
      `PR #${cell(entry.prNumber)} | Earliest required worker to last job completion: ${cell(lane.durationMs)}ms ` +
      `(includes bootstrap, evidence and guarded cleanup); limit ${cell(nativeLaneBudgetDescription(lane))}. ` +
      `Provider queue separately: ${cell(queues)} |`;
    if (bytes + Buffer.byteLength(line) + 1 > maxBytes - reserve) { omitted++; continue; }
    lines.push(line);
    bytes += Buffer.byteLength(line) + 1;
  }
  for (const entry of componentEvidence) for (const job of entry.auxiliaryJobs ?? []) {
    const line = `| Upstream prerequisite / ${cell(job.name)} | Required separately | PR #${cell(entry.prNumber)} | ` +
      `Worker wall: ${cell(job.durationMs)}ms; provider queue: ` +
      `${job.providerQueueMs === null ? 'unknown' : `${cell(job.providerQueueMs)}ms`}. Not hidden in native part timings. |`;
    if (bytes + Buffer.byteLength(line) + 1 > maxBytes - reserve) { omitted++; continue; }
    lines.push(line);
    bytes += Buffer.byteLength(line) + 1;
  }
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
  for (const { prNumber, sourceCommit, projection, sourceArtifacts = [], laneTimings = [],
    nativeParts = [], auxiliaryJobs = [] } of componentEvidence) {
    requireNativeComponentProjection(projection);
    requireThat(Number.isSafeInteger(prNumber) && prNumber > 0 && revision.test(sourceCommit),
      'EVIDENCE', 'Retained component projection requires its actual PR/source identity');
    const sharded = Boolean(projection.definition.frameworkShards);
    const expectedParts = sharded ? native.nativePrPartsForProtocol(projection.definition.frameworkShards) :
      native.nativeLegacyPrParts;
    const frameworkCount = expectedParts.filter(part => part.component === 'framework').length;
    requireThat(!sharded || sourceArtifacts.length === frameworkCount && nativeParts.length === expectedParts.length,
      'EVIDENCE', 'Current shard retention requires complete original and producer artifact provenance');
    requireThat(Array.isArray(sourceArtifacts) && sourceArtifacts.length <= (sharded ? frameworkCount : 4) &&
      new Set(sourceArtifacts.map(item => sharded ? item.role : item.target)).size === sourceArtifacts.length &&
      sourceArtifacts.every(item => Object.keys(item).length === (sharded ? 7 : 6) &&
        Object.keys(item).every(key => ['target', 'artifactId', 'artifactDigest', 'jobId', 'runId', 'attempt',
          ...(sharded ? ['role'] : [])].includes(key)) &&
        validationPlatforms.includes(item.target) && /^sha256:[a-f0-9]{64}$/u.test(item.artifactDigest ?? '') &&
        (!sharded || projection.definition.shardParts.some(part => part.target === item.target && part.role === item.role)) &&
        ['artifactId', 'jobId', 'runId', 'attempt'].every(key => Number.isSafeInteger(item[key]) && item[key] > 0)),
    'EVIDENCE', 'Native artifact references must preserve bounded actual provider identities, never serialized origin authority');
    requireThat(Array.isArray(nativeParts) && (nativeParts.length === 0 || nativeParts.length === expectedParts.length) &&
      new Set(nativeParts.map(part => part.role)).size === nativeParts.length &&
      nativeParts.every(part => expectedParts.some(expected => expected.role === part.role &&
        expected.target === part.target && expected.component === part.component &&
        (expected.shard ?? null) === (part.shard ?? null)) &&
        ['artifactId', 'bootstrapArtifactId', 'jobId', 'runId', 'attempt'].every(key =>
          Number.isSafeInteger(part[key]) && part[key] > 0) &&
        /^sha256:[a-f0-9]{64}$/u.test(part.artifactDigest ?? '') &&
        /^sha256:[a-f0-9]{64}$/u.test(part.bootstrapArtifactDigest ?? '') &&
        (!part.target.startsWith('macos-') || Number.isSafeInteger(part.cleanupArtifactId) &&
          part.cleanupArtifactId > 0 && /^sha256:[a-f0-9]{64}$/u.test(part.cleanupArtifactDigest ?? ''))),
    'EVIDENCE', 'Native producer references require every distinct role and its own bootstrap/cleanup artifacts');
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
    const unitOrder = sharded ? await retain(`${prefix}-unit-order.json`, projection.unitOrderFacts) : null;
    const originals = [];
    for (const original of projection.originals) originals.push(
      await retain(`${prefix}-${original.executionId}.json`, original.text));
    const nativeOriginals = [];
    for (const original of projection.sourceOriginals) nativeOriginals.push({
      target: original.target,
      ...(original.role ? { role: original.role } : {}),
      ...await retain(`${prefix}-native-${original.role ?? original.target}-execution.json`, original.text),
    });
    components.push({ prNumber, sourceCommit, status: projection.evaluation.status,
      adapterDefinitionDigest: projection.definition.adapterDefinitionDigest,
      bundle, definition, provenance, originals, nativeOriginals, sourceArtifacts, nativeParts, laneTimings, auxiliaryJobs,
      ...(unitOrder ? { unitOrder } : {}) });
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
    await fs.appendFile(env.GITHUB_STEP_SUMMARY, renderObserverSummary(safe, {
      completeReportRef: reference, componentEvidence,
    }));
  }
  console.log(JSON.stringify({ status: safe.status, keys: safe.results.length,
    diagnostic: safe.diagnostic ?? null }));
  process.exitCode = safe.status === 'Passed' ? 0 : 2;
}
