import path from 'node:path';
import { LIMITS, PHASES, digest, id, now, object, recordLimit, requireThat, safeRecord, text } from './core.mjs';
import { immutableJson, readBytes, readJson, updateJson } from './files.mjs';
import { currentTestSpecification, loadConfig, snapshots,
  synchronizeTestPlan } from './artifacts.mjs';
import { applicableOverride, assurancePending, boundToCycle, currentCycle,
  hasStageCompletion, matchesScope, reviewPassed, stagePassed,
  validateEffect } from './authority.mjs';
import { candidateContentDigest, candidateSnapshot } from './validation.mjs';
import { effectiveStagingExecution, stagingExecutionMatches } from './staging.mjs';

export async function captureReceipt(store, input) {
  object(input, ['sessionId', 'source', 'input', 'timestamp', 'pendingDecisionId', 'sourceRef'],
    ['sessionId', 'source', 'input']);
  requireThat(['userPromptSubmitted', 'ask_user'].includes(input.source), 'PROVENANCE', 'Unsupported input source; documents and agent-authored text cannot authorize work');
  id(input.sessionId);
  text(input.input, 'complete user input', LIMITS.input);
  const sessionFile = store.sessionPath(input.sessionId);
  let receipt;
  await updateJson(sessionFile, { schemaVersion: 1, revision: 0, sessionId: input.sessionId, orientationGeneration: 1, acknowledgedToken: null }, async session => {
    const pendingDecisionId = input.pendingDecisionId ?? session.pendingDecisionId ?? null;
    requireThat(!input.pendingDecisionId || input.pendingDecisionId === session.pendingDecisionId, 'PROVENANCE', 'Receipt pending decision differs from session');
    const capturedAt = input.timestamp ?? now(store.clock);
    requireThat(Number.isFinite(Date.parse(capturedAt)), 'INPUT', 'Invalid input capture timestamp');
    receipt = { type: 'receipt', schemaVersion: 1, id: `receipt-${digest({ sessionId: input.sessionId, source: input.source, capturedAt, inputDigest: digest(input.input), pendingDecisionId }).slice(0, 40)}`,
      sessionId: input.sessionId, source: input.source, capturedAt, inputDigest: digest(input.input), pendingDecisionId };
    if (input.sourceRef) receipt.sourceRef = text(input.sourceRef, 'source reference');
    safeRecord(receipt);
    await immutableJson(path.join(store.runtime, 'sessions', input.sessionId, 'receipts', `${receipt.id}.json`), receipt);
    session.lastReceiptId = receipt.id;
    return session;
  });
  return receipt;
}
export async function prepareDecision(store, input) {
  object(input, ['workItemId', 'sessionId', 'kind', 'effect', 'id'], ['workItemId', 'sessionId', 'kind', 'effect']);
  validateEffect(input.kind, input.effect, { strict: true });
  const requestedId = input.id ? id(input.id) : null;
  requireThat(!requestedId || requestedId.length <= 94, 'INPUT',
    'Decision ID must leave room for the durable event prefix');
  return store.transaction(input.workItemId, async tx => {
    const roles = input.kind === 'approval' ? ['requirements', 'test-plan', 'technical-design'].slice(0, PHASES.indexOf(input.effect.transition.to)) : [];
    const preparedSnapshots = await snapshots(store, input.workItemId, roles, { persist: true });
    const decisionId = requestedId ?? `decision-${digest({
      workItemId: input.workItemId,
      sessionId: input.sessionId,
      kind: input.kind,
      effect: input.effect,
      snapshots: preparedSnapshots,
      policyGeneration: tx.checkpoint.policyGeneration,
    }).slice(0, 40)}`;
    const pending = { type: 'pending-decision', id: decisionId, workItemId: input.workItemId, sessionId: input.sessionId,
      kind: input.kind, effect: input.effect, snapshots: preparedSnapshots, policyGeneration: tx.checkpoint.policyGeneration };
    const previous = tx.get(decisionId);
    requireThat(!previous || digest(previous) === digest(pending), 'ID_CONFLICT', 'Decision ID already binds different content');
    tx.put(pending);
    await updateJson(store.sessionPath(input.sessionId), { schemaVersion: 1, revision: 0, sessionId: input.sessionId }, session => {
      requireThat(session.workItemId === input.workItemId, 'BINDING', 'Decision session is not bound to this work item');
      session.pendingDecisionId = decisionId;
      return session;
    });
    return pending;
  });
}
async function validateCycleDecision(kind, effect, tx, store) {
  if (!['stage-completion', 'dev-authorization', 'review-result', 'staging-promotion', 'staging-result'].includes(kind)) return;
  const cycle = currentCycle(tx.all(), tx.checkpoint);
  requireThat(!assurancePending(cycle, tx.all()), 'STALE',
    'Validation assurance was invalidated; start a new cycle before recording stage decisions');
  requireThat(boundToCycle(effect, cycle), 'STALE', 'Decision does not match the current candidate, cycle, configuration and test specification');
  requireThat(candidateContentDigest(await candidateSnapshot(tx.metadata, tx.manifest)) === cycle.candidateDigest &&
    await currentTestSpecification(store, tx.checkpoint.workItemId, cycle.tests) === cycle.testSpecDigest,
  'STALE', 'Candidate or Test Plan changed; start a new validation cycle before applying this decision');
  const records = tx.all();
  const action = { class: kind, environment: kind === 'dev-authorization' ? 'DEV' :
    ['staging-promotion', 'staging-result'].includes(kind) ? 'STAGING' :
      kind === 'stage-completion' &&
        ['DEV', 'STAGING'].includes(effect.completedStage) ?
        effect.completedStage : undefined, target: effect.target,
    owner: effect.owner, host: effect.host,
    repositoryId: effect.scope?.repositoryIds?.length === 1 ?
      effect.scope.repositoryIds[0] : tx.metadata.coordinatorId };
  const waive = rule => applicableOverride(records, rule, action, { cycleId: cycle.id, clock: store.clock });
  if (kind === 'stage-completion') {
    const complete = effect.completedStage === 'review' ? reviewPassed(cycle, records, store.clock) :
      stagePassed(cycle, records, effect.completedStage, store.clock);
    requireThat(complete || waive('stage-evidence'), 'EVIDENCE', 'Stage completion requires current successful evidence or explicit override');
    if (['DEV', 'STAGING'].includes(effect.completedStage)) requireThat(effect.deploymentId === cycle.deployments[effect.completedStage] || waive('stage-evidence'),
      'EVIDENCE', 'Environment completion must identify the current deployment attempt');
    if (effect.completedStage === 'STAGING') {
      const deployment = tx.get(cycle.deployments.STAGING);
      action.repositoryId = deployment?.repositoryId;
      requireThat(effect.target === deployment?.target &&
        matchesScope({ effect }, action, records),
      'AUTHORITY',
      'STAGING completion target and scope must match the current environment');
    }
  }
  if (kind === 'dev-authorization') {
    requireThat(stagePassed(cycle, records, 'local', store.clock) || waive('local-validation'), 'EVIDENCE', 'Required local tests must pass before DEV authorization');
    requireThat(reviewPassed(cycle, records, store.clock) || waive('candidate-review'), 'EVIDENCE', 'Current candidate /review evidence must pass before DEV authorization');
    requireThat(effect.completedStage === 'review' || hasStageCompletion(records, cycle, 'review', store.clock) || waive('review-completion'),
      'AUTHORITY', 'Confirm Review completion separately or in this decision');
    text(effect.target, 'DEV target');
  }
  if (kind === 'review-result') {
    requireThat(stagePassed(cycle, records, 'local', store.clock) || waive('local-validation'),
      'EVIDENCE', 'Run every required local test before accepting a /review result');
    const unresolvedFindings = records.some(record => record.type === 'event' && record.kind === 'review-result' &&
      boundToCycle(record.effect, cycle) && record.effect.status === 'ChangesRequired');
    requireThat(!(unresolvedFindings && effect.status === 'Passed') || waive('review-findings'),
      'EVIDENCE', 'Blocking /review findings require a changed candidate/new cycle or an explicit scoped override');
  }
  if (kind === 'staging-promotion') {
    requireThat(stagePassed(cycle, records, 'DEV', store.clock) || waive('dev-validation'), 'EVIDENCE', 'DEV tests must pass before STAGING promotion');
    requireThat(effect.completedStage === 'DEV' || hasStageCompletion(records, cycle, 'DEV', store.clock) || waive('dev-completion'), 'AUTHORITY', 'Confirm DEV completion separately or in this decision');
    if (effect.completedStage === 'DEV') requireThat(
      (Boolean(cycle.deployments.DEV) && effect.deploymentId === cycle.deployments.DEV) || waive('dev-completion'),
      'EVIDENCE', 'Combined DEV completion must identify the current deployment attempt');
    text(effect.target, 'STAGING target');
  }
  if (kind === 'staging-result') {
    const deployment = tx.get(cycle.deployments.STAGING);
    action.repositoryId = deployment?.repositoryId;
    requireThat(deployment?.status === 'succeeded' && effect.deploymentId === deployment.id &&
      effect.artifactId === deployment.artifactId && effect.target === deployment.target,
    'EVIDENCE', 'STAGING result must match the current successful deployment, target and artifact');
    const configuration = await loadConfig(tx.metadata,
      deployment.repositoryId);
    const execution = effectiveStagingExecution(records, cycle,
      configuration, { action, clock: store.clock });
    requireThat(stagingExecutionMatches(execution, effect.owner, effect.host),
      'HOST',
      'STAGING result owner/location does not match the effective execution contract');
    requireThat(matchesScope({ effect }, action, records), 'AUTHORITY',
      'STAGING result scope does not match the current deployment');
    requireThat(effect.testIds.every(testId => cycle.tests.some(test =>
      test.id === testId && test.environment === 'STAGING' &&
      (execution.overrideId ||
        (test.owner === effect.owner && test.location === effect.host)))),
    'EVIDENCE',
    'STAGING result includes a test outside the effective STAGING execution plan');
  }
}
export async function applyDecision(store, input) {
  object(input, ['workItemId', 'sessionId', 'receiptId', 'input', 'decisionId', 'kind', 'effect'], ['workItemId', 'sessionId', 'receiptId', 'input']);
  const receipt = await readJson(path.join(store.runtime, 'sessions', id(input.sessionId), 'receipts', `${id(input.receiptId)}.json`), { limit: LIMITS.record });
  requireThat(receipt.sessionId === input.sessionId && ['userPromptSubmitted', 'ask_user'].includes(receipt.source) &&
    receipt.inputDigest === digest(input.input), 'PROVENANCE', 'Complete input does not match the captured user receipt/session');
  const result = await store.transaction(input.workItemId, async tx => {
    requireThat(!tx.checkpointMissing, 'RECOVERY',
      'The checkpoint is missing; run sdlc resume and restore audited sequence state before applying a decision');
    const priorEvent = input.decisionId ? tx.get(`event-${input.decisionId}`) : null;
    const archivedPrior = input.decisionId ? await readJson(path.join(store.workPath(input.workItemId),
      'evidence', `event-${input.decisionId}.json`), { optional: true }) : null;
    const pending = input.decisionId ? tx.get(input.decisionId) : null;
    const preliminaryKind = input.kind ?? pending?.kind ?? priorEvent?.kind ?? archivedPrior?.kind;
    const preliminaryEffect = input.effect ?? pending?.effect ?? priorEvent?.effect ?? archivedPrior?.effect;
    const eventId = input.decisionId ? `event-${input.decisionId}` :
      `decision-${digest({ receiptId: receipt.id, workItemId: input.workItemId, kind: preliminaryKind,
        scope: preliminaryEffect?.scope ?? {}, itemId: preliminaryEffect?.itemId ?? null }).slice(0, 40)}`;
    const archivedExisting = await readJson(path.join(store.workPath(input.workItemId),
      'evidence', `${eventId}.json`), { optional: true });
    const existing = tx.all().find(record => record.type === 'event' && record.id === eventId) ??
      archivedPrior ?? archivedExisting;
    requireThat(!input.decisionId || pending?.type === 'pending-decision' || priorEvent?.type === 'event' || archivedPrior?.type === 'event',
      'PROVENANCE', 'Prepared decision is unavailable');
    const kind = preliminaryKind ?? existing?.kind;
    const effect = preliminaryEffect ?? existing?.effect;
    validateEffect(kind, effect, { strict: !existing });
    if (existing) {
      requireThat(existing.sourceReceiptId === receipt.id && digest(existing.effect) === digest(effect) && existing.kind === kind,
        'ID_CONFLICT', 'Effective decision ID reused with different content');
      if (pending) tx.remove(pending.id);
      return { event: existing, idempotent: true };
    }
    if (pending) {
      requireThat(pending.sessionId === input.sessionId && pending.workItemId === input.workItemId &&
        receipt.pendingDecisionId === pending.id, 'PROVENANCE', 'Receipt is not bound to this prepared decision');
      requireThat(pending.kind === kind && digest(pending.effect) === digest(effect), 'ID_CONFLICT', 'Applied interpretation differs from prepared decision');
      requireThat(pending.policyGeneration === tx.checkpoint.policyGeneration, 'STALE', 'Policy changed while awaiting the decision');
      const currentSnapshots = await snapshots(store, input.workItemId,
        [...new Set(pending.snapshots.map(snapshot => snapshot.role))]);
      const contentBindings = items => items.map(({ git, ...content }) => content);
      requireThat(digest(contentBindings(currentSnapshots)) === digest(contentBindings(pending.snapshots)), 'STALE', 'Artifacts changed after the approval request');
      for (const snapshot of pending.snapshots) requireThat(digest(await readBytes(path.join(store.workPath(input.workItemId), 'snapshots', snapshot.digest), LIMITS.artifact)) === snapshot.digest,
        'PROVENANCE', 'Approval snapshot is unavailable or corrupt');
    } else {
      requireThat(kind !== 'approval', 'PROVENANCE', 'Phase approvals require decision prepare and retrievable snapshots');
    }
    if (effect.transition) requireThat(effect.transition.from === tx.checkpoint.phase, 'TRANSITION', 'Transition does not start at the current phase');
    await validateCycleDecision(kind, effect, tx, store);
    const event = { type: 'event', schemaVersion: 1, id: eventId, workItemId: input.workItemId,
      sequence: Math.max(tx.checkpoint.policyGeneration ?? 0,
        ...tx.all().filter(r => r.type === 'event').map(r => r.sequence)) + 1, kind, effect,
      sourceReceiptId: receipt.id, sourceReceiptDigest: digest(receipt), inputDigest: receipt.inputDigest,
      sessionId: input.sessionId, repositoryIds: tx.metadata.members.map(member => member.repositoryId).sort(),
      snapshots: pending?.snapshots ?? [], occurredAt: receipt.capturedAt };
    event.digest = digest(event);
    safeRecord(event, recordLimit(event));
    if (pending) tx.remove(pending.id);
    tx.put(event);
    if (kind === 'review-result') {
      const cycle = currentCycle(tx.all(), tx.checkpoint);
      cycle.reviewRef = event.id;
      cycle.step = effect.status === 'Passed' ? 'awaiting-dev-authorization' :
        effect.status === 'ChangesRequired' ? 'review-changes-required' : 'review-blocked';
      cycle.pendingPlanSync = true;
      tx.put(cycle);
    }
    if (kind === 'staging-result') {
      const cycle = currentCycle(tx.all(), tx.checkpoint);
      for (const testId of effect.testIds) {
        const evidence = tx.get(cycle.results[testId]);
        const operation = evidence?.operationId ?
          tx.get(evidence.operationId) : null;
        if (!operation?.updatedAt ||
            Date.parse(receipt.capturedAt) >=
              Date.parse(operation.updatedAt)) {
          delete cycle.results[testId];
        }
      }
      cycle.pendingPlanSync = true;
      tx.put(cycle);
    }
    return { event, idempotent: false };
  });
  if (input.decisionId) await updateJson(store.sessionPath(input.sessionId), {}, session => {
    if (session.pendingDecisionId === input.decisionId) session.pendingDecisionId = null;
    return session;
  });
  if (['staging-result', 'review-result', 'revocation'].includes(result.event.kind)) {
    await synchronizeTestPlan(store, input.workItemId);
  }
  return result;
}
export function verifyEvent(event) {
  object(event, ['type', 'schemaVersion', 'id', 'workItemId', 'sequence', 'kind', 'effect', 'sourceReceiptId',
    'sourceReceiptDigest', 'inputDigest', 'sessionId', 'repositoryIds', 'snapshots', 'occurredAt', 'digest'],
  ['type', 'schemaVersion', 'id', 'workItemId', 'sequence', 'kind', 'effect', 'sourceReceiptId',
    'sourceReceiptDigest', 'inputDigest', 'sessionId', 'repositoryIds', 'snapshots', 'occurredAt', 'digest']);
  requireThat(event.type === 'event' && event.schemaVersion === 1 && Number.isSafeInteger(event.sequence) && event.sequence > 0, 'SCHEMA', 'Invalid audit event schema/sequence');
  id(event.id); id(event.workItemId); validateEffect(event.kind, event.effect);
  const { digest: expected, ...content } = event;
  requireThat(expected === digest(content), 'DIGEST', 'Event content digest mismatch');
  safeRecord(event, recordLimit(event));
  return event;
}
