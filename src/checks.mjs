import path from 'node:path';
import { LIMITS, PHASES, byteSize, digest, recordLimit, requireThat } from './core.mjs';
import { exists, readBytes, readJson } from './files.mjs';
import { artifactDocumentId, artifactPath, artifactRepositoryId,
  currentTestSpecification, parseRequirements, parseTestPlan } from './artifacts.mjs';
import { activeEvents, applicableOverride, currentCycle, currentTestEvidence, hasStagingCompletion, reviewPassed } from './authority.mjs';
import { replayAudit } from './audit.mjs';
import { verifyEvent } from './decisions.mjs';
import { validateCheckpoint } from './store.mjs';
import { validateBinding } from './git.mjs';
import { candidateContentDigest, candidateSnapshot } from './validation.mjs';

export const EXIT_CODES = { satisfied: 0, 'not-applicable': 0, 'authorized-deviation': 0, violation: 2, unverified: 3, error: 4 };
export function aggregate(findings) {
  const precedence = ['error', 'violation', 'unverified', 'authorized-deviation', 'satisfied', 'not-applicable'];
  const verdict = precedence.find(value => findings.some(f => f.verdict === value)) ?? 'not-applicable';
  return { verdict, exitCode: EXIT_CODES[verdict], findings,
    summary: `${verdict}: ${findings.length} finding(s); ${findings.filter(f => f.verdict === 'unverified').length} require evidence.` };
}
function reporter(findings, state, clock) {
  return (rule, verdict, reason, details = {}) => {
    const cycle = currentCycle(state.records, state.checkpoint);
    const override = ['violation', 'unverified'].includes(verdict) ?
      applicableOverride(state.records, rule, { class: 'check' }, { cycleId: cycle?.id, clock }) : null;
    findings.push({ rule, verdict: override ? 'authorized-deviation' : verdict, reason, ...details,
      ...(override ? { eventId: override.id, originalVerdict: verdict } : {}) });
  };
}
async function artifactChecks(store, state, report) {
  const due = PHASES.indexOf(state.checkpoint.phase);
  const texts = { requirements: [], 'test-plan': [], 'technical-design': [] };
  for (const [index, role] of ['requirements', 'test-plan', 'technical-design'].entries()) {
    if (index > due) { report(`artifact:${role}`, 'not-applicable', `Not due until ${PHASES[index]}`); continue; }
    const locators = state.manifest.artifacts.filter(artifact => artifact.role === role);
    if (!locators.length) {
      report(`artifact:${role}`, 'unverified',
        'At least one registered canonical artifact is required when due');
      continue;
    }
    let retrievable = true;
    for (const locator of locators) {
      const repositoryId = artifactRepositoryId(locator, state.manifest);
      const artifactId = artifactDocumentId(locator);
      try {
        const text = (await readBytes(await artifactPath(store,
          state.checkpoint.workItemId, locator, state.metadata),
        LIMITS.artifact)).toString('utf8');
        texts[role].push({ locator, repositoryId, text });
        report(`artifact:${role}:${repositoryId}:${artifactId}`, 'satisfied',
          'Canonical member artifact is retrievable');
      } catch (error) {
        if (!['ENOENT', 'EACCES'].includes(error.code)) throw error;
        retrievable = false;
        report(`artifact:${role}:${repositoryId}:${artifactId}`, 'unverified',
          'Registered member artifact is unavailable');
      }
    }
    report(`artifact:${role}`, retrievable ? 'satisfied' : 'unverified',
      retrievable ? 'Every registered canonical artifact is retrievable' :
        'One or more registered canonical artifacts are unavailable');
  }
  const requirements = texts.requirements.flatMap(document =>
    parseRequirements(document.text));
  if (texts.requirements.length) {
    report('requirement-ids', requirements.length && new Set(requirements.map(r => r.id)).size === requirements.length ? 'satisfied' : 'violation', 'Requirements need unique stable FR identifiers');
    for (const requirement of requirements.filter(r => !r.outOfScope)) report(`dod:${requirement.id}`, requirement.dod ? 'satisfied' : 'violation', 'Each requirement needs an explicit Definition of Done');
  }
  if (texts['test-plan'].length) {
    const tests = texts['test-plan'].flatMap(document =>
      parseTestPlan(document.text));
    report('test-ids', tests.length && new Set(tests.map(test => test.id)).size === tests.length ? 'satisfied' : 'violation', 'The Test Plan needs unique stable test identifiers');
    for (const test of tests) {
      report(`status:${test.id}`, ['NotRun', 'Passed', 'Failed'].includes(test.status) ? 'satisfied' : 'violation', 'Execution status is separate from implementation readiness and blockers');
      report(`mode:${test.id}`, ['Automated', 'Semi-automated', 'Manual', 'automated', 'semi-automated', 'manual'].includes(test.mode) ? 'satisfied' : 'violation', 'Declare execution mode independently of owner/location');
      if (due === 3 && !test.outOfScope) report(`implementation:${test.id}`, test.implementation ? 'satisfied' : 'unverified', 'Coding completion needs a runnable implementation, agent flow or user procedure reference');
    }
    for (const requirement of requirements.filter(r => !r.outOfScope)) {
      const linked = tests.filter(test => !test.outOfScope && test.requirements?.includes(requirement.id));
      report(`coverage:${requirement.id}`, linked.length ? 'satisfied' : 'violation', 'Each in-scope requirement needs planned coverage');
      const missing = requirement.conditions.filter(condition => !linked.some(test => test.conditions?.includes(condition)));
      if (missing.length) report('coverage-depth', 'unverified', `${requirement.id} acceptance-condition coverage is not explicitly established`, { missing });
    }
  }
}
async function stateChecks(store, state, report) {
  validateCheckpoint(state.checkpoint);
  for (const member of state.metadata.members) await validateBinding(member);
  report('state-schema', 'satisfied', 'Checkpoint schema, size and member bindings are valid');
  for (const event of state.records.filter(r => r.type === 'event')) verifyEvent(event);
  report('record-budgets', state.records.every(r => byteSize(r) <= recordLimit(r)) && byteSize(state.records) <= LIMITS.workingSet ? 'satisfied' : 'violation', 'Active records are bounded and retain recovery-critical metadata');
  if (state.checkpointMissing) report('checkpoint', 'unverified', 'Checkpoint is missing; run resume to persist the reconstructed projection');
  for (const reference of [...state.checkpoint.decisionRefs, ...state.checkpoint.operationRefs, ...state.checkpoint.blockerRefs]) {
    report(`reference:${reference}`, state.records.some(r => r.id === reference) ? 'satisfied' : 'unverified', 'Active reference resolves to a durable record');
  }
}
async function historyChecks(store, state, report) {
  const replay = await replayAudit(store, state.checkpoint.workItemId, { persist: false });
  if (replay.historyStartsAt) report('adopted-history', 'unverified', 'Commits preceding the adopted boundary are pre-framework/unverified');
  for (const event of state.records.filter(r => r.type === 'event')) {
    report(`audit:${event.id}`, replay.events.some(e => e.id === event.id && e.digest === event.digest) ? 'satisfied' : 'unverified', 'Effective event must be auditable in the same relevant commit or ancestors');
    const receipt = path.join(store.runtime, 'sessions', event.sessionId, 'receipts', `${event.sourceReceiptId}.json`);
    if (await exists(receipt)) requireThat(digest(await readJson(receipt)) === event.sourceReceiptDigest, 'PROVENANCE', 'Captured receipt content differs from its effective event');
    report(`provenance:${event.id}`, await exists(receipt) ? 'satisfied' : 'unverified', 'Original local input provenance availability; Git alone records an authorization claim');
  }
  for (const gap of replay.gaps) report('event-sequence', 'unverified', gap);
  if (!replay.events.length) report('history-authority', 'unverified', 'No reachable complete audit events; absence does not prove no approval occurred');
}
async function evidenceChecks(store, state, report) {
  const cycle = currentCycle(state.records, state.checkpoint);
  if (!cycle) {
    report('validation-cycle', state.checkpoint.phase === 'coding' ? 'unverified' : 'not-applicable', 'Execution evidence is due during Coding, not before implementation');
    return;
  }
  const candidateCurrent = candidateContentDigest(await candidateSnapshot(
    state.metadata, state.manifest)) === cycle.candidateDigest;
  const specificationCurrent = await currentTestSpecification(store,
    state.checkpoint.workItemId, cycle.tests) === cycle.testSpecDigest;
  report('candidate-identity', candidateCurrent ? 'satisfied' : 'unverified',
    'Current implementation content must match the validation candidate');
  report('test-specification-identity',
    specificationCurrent ? 'satisfied' : 'unverified',
    'Current Test Plan specification must match the validation cycle');
  for (const test of cycle.tests) {
    const result = currentTestEvidence(cycle, state.records, test, store.clock);
    if (!result || result.status === 'NotRun') { report(`test:${test.id}`, 'unverified', 'No conclusive current-cycle result; NotRun is not a pass'); continue; }
    report(`test:${test.id}`, result.status === 'Failed' ? 'violation' : result.evidenceRef ? 'satisfied' : 'unverified',
      'Result must match candidate, environment, expected outcome and current test specification');
    if (result.evidenceRef?.startsWith('file:')) {
      try { await readBytes(new URL(result.evidenceRef), LIMITS.artifact); }
      catch (error) { if (!['ENOENT', 'EACCES'].includes(error.code)) throw error; report(`evidence:${test.id}`, 'unverified', 'Referenced execution evidence is unavailable'); }
    }
  }
  for (const operation of state.records.filter(r => r.type === 'operation')) {
    report(`operation:${operation.id}`, ['succeeded', 'failed', 'cancelled', 'not-started'].includes(operation.status) && operation.evidenceRef ? 'satisfied' : 'unverified',
      'Submission, timeout and missing handles are not successful external outcomes');
  }
  const review = state.records.find(record => record.id === cycle.reviewRef && record.type === 'event' && record.kind === 'review-result');
  report('candidate-review', reviewPassed(cycle, state.records, store.clock) ? 'satisfied' :
    review?.effect.status === 'ChangesRequired' ? 'violation' : 'unverified',
  'Current candidate needs passing GitHub Copilot CLI /review evidence');
  const stagingTests = cycle.tests.some(test => test.environment === 'STAGING');
  if (stagingTests) {
    report('staging-completion', hasStagingCompletion(state.records, cycle, store.clock) ? 'satisfied' : 'unverified',
      'Every planned STAGING test needs passing deployment-bound evidence and explicit completion confirmation');
  }
}
export async function check(store, workItemId, kind) {
  const findings = [];
  try {
    requireThat(['artifacts', 'state', 'history', 'evidence', 'all'].includes(kind), 'INPUT', 'Unknown conformance check');
    const state = await store.load(workItemId);
    const report = reporter(findings, state, store.clock);
    const checks = { artifacts: artifactChecks, state: stateChecks, history: historyChecks, evidence: evidenceChecks };
    for (const [name, run] of Object.entries(checks)) if (kind === name || kind === 'all') await run(store, state, report);
  } catch (error) {
    findings.push({ rule: 'checker', verdict: 'error', reason: `${error.code ?? 'ERROR'}: ${error.message}` });
  }
  return aggregate(findings);
}
