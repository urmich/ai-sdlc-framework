import path from 'node:path';
import { digest, fingerprint, id, newId, now, object, requireThat, text, choice } from './core.mjs';
import { canonicalPath, immutableJson, readBytes, readJson, safePath } from './files.mjs';
import { bindingKey, publicationPaths, validateBinding, verifyPublicationBase } from './git.mjs';
import { loadConfig, synchronizeTestPlan } from './artifacts.mjs';
import { effectiveEnvironments, evaluatePolicy, resolveActionEnvironment, validateAction } from './policy.mjs';
import { activeEvents, applicableOverride, assurancePending, boundToCycle,
  currentCycle, currentStagingResultEventIds, currentTestEvidence,
  eventAppliesToCycle, isCycleBoundEvent, matchesScope, permissionMatches,
phaseAuthority,
testCheckpoint } from './authority.mjs';
import { candidateContentDigest, candidateSnapshot, candidateStamp, committedSourceSnapshot } from './validation.mjs';
import { normalizeToolName, sameNativePath } from './platform.mjs';

export const TERMINAL = ['succeeded', 'failed', 'cancelled', 'not-started'];
export function nextDeploymentSequence(cycle, records) {
  return Math.max(
    cycle.lastDeploymentSequence ?? 0,
    ...records.filter(record => record.type === 'operation' &&
      record.class === 'deploy' && record.cycleId === cycle.id)
      .map(record => record.deploymentSequence ?? 0),
    ...Object.values(cycle.environmentInvalidationSequences ?? {}),
  ) + 1;
}
export function reserveOnceAuthorities(tx, operation, decision, cycle,
  clock = Date, action = operation.action) {
  const phaseEventId = phaseAuthority(tx.all(), tx.checkpoint, action, {
    cycleId: cycle?.id,
    clock,
  }).eventId;
  for (const event of activeEvents(tx.all(), {
    cycleId: cycle?.id,
    clock,
  })) {
    if (event.effect.lifetime?.kind !== 'once') continue;
    const authorizes = authorizesOperation(event, action, decision, cycle,
      tx.all()) || event.id === operation.retryOverrideId ||
      event.id === phaseEventId;
    if (!authorizes) continue;
    const reservation = tx.all().find(record =>
      record.type === 'reservation' && record.eventId === event.id);
    requireThat(!reservation || reservation.operationId === operation.id,
      'AUTHORITY', 'Once-only grant is reserved by another operation');
    tx.put({ type: 'reservation',
      id: `reservation-${digest(event.id).slice(0, 40)}`,
      workItemId: operation.workItemId, eventId: event.id,
      operationId: operation.id });
    operation.reservedEventIds ??= [];
    if (!operation.reservedEventIds.includes(event.id)) {
      operation.reservedEventIds.push(event.id);
    }
  }
}
function repairDeploymentProjection(tx, operation) {
  if (operation.class !== 'deploy' || operation.status !== 'succeeded') return;
  const cycle = currentCycle(tx.all(), tx.checkpoint);
  if (cycle?.id !== operation.cycleId ||
      assurancePending(cycle, tx.all()) ||
      cycle.candidateDigest !== operation.candidateDigest) return;
  const latestSequence = Math.max(0, ...tx.all().filter(record =>
    record.type === 'operation' &&
    record.class === 'deploy' &&
    record.cycleId === cycle.id &&
    record.action.environment === operation.action.environment)
    .map(record => record.deploymentSequence ?? 0));
  if ((operation.deploymentSequence ?? 0) !== latestSequence) return;
  const invalidationSequence =
    cycle.environmentInvalidationSequences?.[operation.action.environment] ?? 0;
  if ((operation.deploymentSequence ?? 0) <= invalidationSequence) return;
  cycle.deployments[operation.action.environment] = operation.id;
  cycle.invalidatedEnvironments = (cycle.invalidatedEnvironments ?? [])
    .filter(environment => environment !== operation.action.environment);
  if (cycle.environmentInvalidationSequences) {
    delete cycle.environmentInvalidationSequences[operation.action.environment];
  }
  cycle.step = operation.action.environment === 'STAGING' ?
    'awaiting-staging-result' : 'dev-running';
  tx.put(cycle);
}
function authorizesOperation(event, action, decision, cycle, records) {
  if (event.kind === 'override') {
    return decision.findings.some(finding => finding.eventId === event.id) ||
      (event.effect.rules?.includes('orientation') &&
        matchesScope(event, action, records));
  }
  if (event.kind === 'permission') {
    const direct = event.effect.grant === action.class;
    const production = event.effect.grant === 'prod-execution' && effectiveEnvironments(action).has('PROD');
    return (direct && permissionMatches(event, action.class, action, records)) ||
      (production && permissionMatches(event, 'prod-execution', action, records));
  }
  if (event.kind === 'pr-publication') {
    const earlyPush = action.class === 'push' && action.earlyDraft === true;
    return (['pr-create', 'pr-update'].includes(action.class) || earlyPush) &&
      event.effect.repositoryId === action.repositoryId && event.effect.sourceRef === action.sourceRef &&
      event.effect.targetRef === (earlyPush ? action.baseRef : action.targetRef) &&
      event.effect.draft === action.draft &&
      matchesScope(event, action, records);
  }
  if (event.kind === 'dev-authorization') {
    return effectiveEnvironments(action).has('DEV') &&
      boundToCycle(event.effect, cycle) && event.effect.target === action.target &&
      event.effect.configDigest === action.configDigest && matchesScope(event, action, records);
  }
  if (event.kind === 'staging-promotion') {
    return effectiveEnvironments(action).has('STAGING') &&
      boundToCycle(event.effect, cycle) && event.effect.target === action.target &&
      event.effect.configDigest === action.configDigest && matchesScope(event, action, records);
  }
  if (event.kind === 'out-of-scope-execution') {
    return action.class !== 'document' && action.outOfScope === true &&
      event.effect.itemId === action.itemId && matchesScope(event, action, records);
  }
  if (event.kind === 'out-of-scope-documentation') {
    return action.class === 'document' && action.outOfScope === true &&
      event.effect.itemId === action.itemId && matchesScope(event, action, records);
  }
  if (event.kind === 'scope-inclusion') {
    return action.outOfScope === true &&
      event.effect.itemId === action.itemId &&
      matchesScope(event, action, records);
  }
  return false;
}
export async function prepareOperation(store, input) {
  object(input, ['workItemId', 'sessionId', 'operationId', 'action', 'request', 'correlationKey', 'intent'],
    ['workItemId', 'sessionId', 'action', 'request', 'correlationKey', 'intent']);
  validateAction(input.action);
  object(input.request, ['toolName', 'toolArgs', 'cwd'], ['toolName', 'toolArgs', 'cwd']);
  text(input.request.toolName, 'tool name'); text(input.correlationKey, 'correlation key'); text(input.intent, 'intended effect', 300);
  const cwd = await canonicalPath(input.request.cwd);
  const normalizedToolName = normalizeToolName(input.request.toolName);
  let normalizedToolArgs = input.request.toolArgs;
  if (typeof normalizedToolArgs === 'string') {
    try {
      const parsed = JSON.parse(normalizedToolArgs);
      normalizedToolArgs = parsed && typeof parsed === 'object' &&
        !Array.isArray(parsed) ? parsed :
        ['bash', 'powershell', 'cmd'].includes(normalizedToolName) ?
          { command: input.request.toolArgs } : input.request.toolArgs;
    } catch {
      if (['bash', 'powershell', 'cmd'].includes(normalizedToolName)) {
        normalizedToolArgs = { command: input.request.toolArgs };
      }
    }
  }
  const requestFingerprint = fingerprint(
    normalizedToolName, normalizedToolArgs, cwd);
  return store.transaction(input.workItemId, async tx => {
    const operationId = input.operationId ?? `op-${digest({ workItemId: input.workItemId, correlationKey: input.correlationKey }).slice(0, 40)}`;
    id(operationId);
    const member = tx.metadata.members.find(m => m.repositoryId === input.action.repositoryId);
    requireThat(member, 'BINDING', 'Operation requires a participating repository');
    const current = await validateBinding(member);
    requireThat(sameNativePath(cwd, current.root), 'BINDING', 'Prepared request cwd must match the member worktree root');
    const configuration = await loadConfig(tx.metadata, member.repositoryId);
    const initialResolution = resolveActionEnvironment(input.action,
      configuration);
    const action = {
      ...initialResolution.action,
      operationId,
    };
    const environmentResolution = {
      ...initialResolution,
      action,
    };
    const { operationId: ignoredOperationId, ...effectAction } = action;
    void ignoredOperationId;
    const effectFingerprint = digest(effectAction);
    const previous = tx.get(operationId) ?? await readJson(path.join(store.workPath(input.workItemId), 'evidence', `${operationId}.json`), { optional: true });
    if (previous) {
      requireThat(previous.requestFingerprint === requestFingerprint &&
        digest(previous.action) === digest(action),
      'ID_CONFLICT', 'Operation/correlation ID reused for a different request');
      return { operation: previous, action: TERMINAL.includes(previous.status) ? 'already-terminal' : 'resume-or-reconcile; never blindly redispatch' };
    }
    const duplicate = tx.all().find(r => r.type === 'operation' &&
      (r.requestFingerprint === requestFingerprint || r.effectFingerprint === effectFingerprint) && !TERMINAL.includes(r.status));
    const retryOverride = duplicate?.status === 'uncertain' && applicableOverride(tx.all(), 'uncertain-retry',
      action, { cycleId: tx.checkpoint.validationCycleRef, clock: store.clock });
    requireThat(!duplicate || retryOverride, 'UNCERTAIN', 'An unresolved matching operation already exists; reconcile it before preparing another');
    if (action.earlyDraft) {
      if (action.class === 'push') await verifyPublicationBase(current, action.target,
        action.baseRef, action.targetRevision);
      const actualPaths = await publicationPaths(current, action.sourceRevision, action.targetRevision);
      requireThat(digest(actualPaths) === digest([...action.paths].sort()), 'EVIDENCE',
        'Early draft paths must exactly match the current source-vs-target Git diff');
    }
    const decision = evaluatePolicy({ ...tx, records: tx.all() }, action, {
      clock: store.clock,
      configuration,
      environmentResolution,
    });
    requireThat(decision.allowed, 'GATE', 'Operation is not authorized', decision.findings);
    const cycle = currentCycle(tx.all(), tx.checkpoint);
    if (action.class === 'push') {
      if (!action.delete) requireThat(action.sourceRevision === current.head, 'STALE',
        'Push source revision must be the current bound commit');
      if (!action.earlyDraft && !action.delete) {
        const waived = ['local-validation', 'candidate-review', 'review-completion'].every(rule =>
          decision.findings.some(finding => finding.rule === rule &&
            finding.verdict === 'authorized-deviation'));
        requireThat(cycle || waived, 'STALE',
          'Normal push requires a current reviewed validation cycle or explicit validation/Review overrides');
        if (cycle) {
          const reviewedSource = cycle.sources.find(source => source.repositoryId === action.repositoryId);
          const committedSource = await committedSourceSnapshot(current, tx.manifest, action.sourceRevision);
          requireThat(reviewedSource?.contentDigest === committedSource.contentDigest, 'STALE',
            'The pushed commit does not contain the complete reviewed candidate; commit all candidate changes and re-evaluate without changing content');
        }
      }
    }
    const stamp = await candidateStamp(tx.metadata, tx.manifest);
    if (cycle) requireThat(candidateContentDigest(await candidateSnapshot(tx.metadata, tx.manifest)) === cycle.candidateDigest, 'STALE', 'Candidate changed; restart local validation before remote work');
    requireThat(await candidateStamp(tx.metadata, tx.manifest) === stamp, 'STALE', 'Candidate changed during preparation; recompute the operation');
    const operation = { type: 'operation', id: operationId, workItemId: input.workItemId, sessionId: input.sessionId,
      repositoryId: member.repositoryId, bindingKey: bindingKey(current), class: action.class, action,
      target: action.target ?? 'local', status: 'prepared', correlationKey: input.correlationKey,
      requestFingerprint, effectFingerprint, intent: input.intent, createdAt: now(store.clock), dispatchBound: false,
      cycleId: cycle?.id ?? null, candidateDigest: cycle?.candidateDigest ?? null, candidateStamp: stamp,
      reservedEventIds: [] };
    if (retryOverride) { operation.retryOverrideId = retryOverride.id; operation.priorUncertainOperationId = duplicate.id; }
    if (action.artifactId) operation.artifactId = action.artifactId;
    reserveOnceAuthorities(tx, operation, decision, cycle, store.clock,
      action);
    tx.put(operation);
    return { operation, action: 'mark-dispatching-before-provider-call' };
  });
}
export async function markDispatching(store, workItemId, operationId) {
  let deploymentChanged = false;
  const result = await store.transaction(workItemId, async tx => {
    const operation = tx.get(operationId);
    requireThat(operation?.type === 'operation', 'OPERATION', 'Prepared operation is unavailable');
    requireThat(operation.status === 'prepared' || (operation.status === 'dispatching' && !operation.dispatchBound), 'UNCERTAIN', 'Operation was dispatched or is uncertain; reconcile instead of retrying');
    const member = tx.metadata.members.find(m => m.repositoryId === operation.repositoryId);
    await validateBinding(member);
    const policy = evaluatePolicy({ ...tx, records: tx.all() }, operation.action, { clock: store.clock, configuration: await loadConfig(tx.metadata, member.repositoryId) });
    requireThat(policy.allowed, 'GATE', 'Authority changed before dispatch', policy.findings);
    const cycle = currentCycle(tx.all(), tx.checkpoint);
    requireThat(!operation.cycleId || operation.cycleId === cycle?.id, 'STALE', 'Prepared operation belongs to a superseded cycle');
    if (operation.retryOverrideId) {
      requireThat(activeEvents(tx.all(), {
        cycleId: cycle?.id,
        clock: store.clock,
      }).some(event => event.id === operation.retryOverrideId),
      'AUTHORITY', 'Uncertain-retry authority is revoked or expired');
    }
    if (operation.class === 'test' && cycle?.id === operation.cycleId) {
      const test = cycle.tests.find(candidate =>
        candidate.id === operation.action.testId);
      if (test) {
        delete cycle.results[test.id];
        cycle.pendingPlanSync = true;
        if (testCheckpoint(test) === 'pre-review') {
          cycle.reviewRef = null;
          cycle.step = 'local-testing';
        }
        tx.put(cycle);
      }
    }
    reserveOnceAuthorities(tx, operation, policy, cycle, store.clock);
    operation.status = 'dispatching';
    operation.dispatchStartedAt ??= now(store.clock);
    const environmentEffects = new Set(
      operation.class === 'deploy' || operation.class === 'pipeline' ||
      operation.action.implicitEnvironments?.length ?
        [operation.action.environment, ...(operation.action.stages ?? []),
          ...(operation.action.implicitEnvironments ?? [])]
          .filter(environment => ['DEV', 'STAGING'].includes(environment)) : []);
    if (environmentEffects.has('DEV')) environmentEffects.add('STAGING');
    if (environmentEffects.size && cycle?.id === operation.cycleId) {
      if (operation.class === 'deploy') {
        operation.deploymentSequence ??= nextDeploymentSequence(cycle, tx.all());
        cycle.lastDeploymentSequence = Math.max(
          cycle.lastDeploymentSequence ?? 0,
          operation.deploymentSequence);
      }
      operation.environmentBoundaryApplied = true;
      const invalidated = new Set(cycle.invalidatedEnvironments ?? []);
      for (const environment of environmentEffects) invalidated.add(environment);
      cycle.invalidatedEnvironments = [...invalidated].sort();
      cycle.environmentInvalidationSequences ??= {};
      for (const environment of environmentEffects) {
        const previousSequence = Math.max(0, ...tx.all().filter(record =>
          record.type === 'operation' &&
          record.class === 'deploy' &&
          record.cycleId === cycle.id &&
          record.action.environment === environment &&
          record.id !== operation.id)
          .map(record => record.deploymentSequence ?? 0));
        cycle.environmentInvalidationSequences[environment] = Math.max(
          cycle.environmentInvalidationSequences[environment] ?? 0,
          previousSequence);
        if (!(operation.class === 'deploy' &&
            environment === operation.action.environment)) {
          delete cycle.artifacts[environment];
        }
        delete cycle.deployments[environment];
        for (const test of cycle.tests) {
          if (testCheckpoint(test) === environment) delete cycle.results[test.id];
        }
      }
      if (operation.class === 'deploy') {
        cycle.deployments[operation.action.environment] = operation.id;
      }
      cycle.pendingPlanSync = true;
      cycle.step = operation.class === 'deploy' ?
        `${operation.action.environment.toLowerCase()}-running` :
        'environment-pipeline-running';
      tx.put(cycle);
      deploymentChanged = true;
    }
    tx.put(operation);
    return operation;
  });
  if (deploymentChanged) await synchronizeTestPlan(store, workItemId);
  return result;
}
export async function recordOperation(store, input, { reconcile = false } = {}) {
  object(input, ['workItemId', 'operationId', 'status', 'handle', 'evidenceRef', 'requestFingerprint', 'target',
    'expectedMet', 'dispatchAttempted', 'providerStatus'], ['workItemId', 'operationId', 'status']);
  choice(input.status, ['submitted', 'running', 'succeeded', 'failed', 'cancelled', 'uncertain', 'not-started'], 'operation result');
  const result = await store.transaction(input.workItemId, tx => {
    const operation = tx.get(input.operationId);
    requireThat(operation?.type === 'operation', 'OPERATION', 'Operation is unavailable');
    if (operation.status === 'uncertain') requireThat(reconcile, 'UNCERTAIN', 'Use read-only reconciliation to resolve this operation');
    if (TERMINAL.includes(operation.status)) {
      requireThat(operation.status === input.status && operation.evidenceRef === input.evidenceRef, 'ID_CONFLICT', 'Terminal operation cannot be silently rewritten');
      repairDeploymentProjection(tx, operation);
      return operation;
    }
    let status = input.status;
    if (status === 'not-started') requireThat(operation.status === 'prepared' && input.dispatchAttempted === false && input.evidenceRef,
      'UNCERTAIN', 'Not-started requires evidence that dispatch was never attempted');
    else requireThat(operation.status !== 'prepared', 'OPERATION', 'Mark dispatching before recording a provider response');
    if (['submitted', 'running'].includes(status) && !input.handle) status = 'uncertain';
    if (TERMINAL.includes(status) && status !== 'not-started') {
      requireThat(input.evidenceRef && input.target === operation.target && input.requestFingerprint === operation.requestFingerprint,
        'EVIDENCE', 'Terminal outcome requires matching target, request fingerprint and provider evidence');
      if (operation.class === 'test') requireThat(typeof input.expectedMet === 'boolean', 'EVIDENCE', 'Test outcome requires expected-result evaluation');
      if (input.status === 'failed' && !input.providerStatus) status = 'uncertain';
      if (['build', 'deploy', 'pipeline', 'pr-create', 'pr-validation'].includes(operation.class) && !input.handle && !operation.handle) status = 'uncertain';
    }
    if (input.handle && operation.handle) requireThat(input.handle === operation.handle, 'EVIDENCE', 'Provider handle changed; reconcile run identity');
    operation.status = status;
    if (TERMINAL.includes(status) && operation.terminalSequence === undefined) {
      operation.terminalSequence = Math.max(0, ...tx.all().filter(record => record.type === 'operation' &&
        TERMINAL.includes(record.status) && record.cycleId === operation.cycleId &&
        record.class === operation.class && record.action.environment === operation.action.environment)
        .map(record => record.terminalSequence ?? 0)) + 1;
    }
    for (const key of ['handle', 'evidenceRef', 'expectedMet', 'providerStatus']) if (input[key] !== undefined) operation[key] = input[key];
    operation.updatedAt = now(store.clock);
    tx.put(operation);
    const cycle = currentCycle(tx.all(), tx.checkpoint);
    if (operation.class === 'test' &&
        ['succeeded', 'failed', 'cancelled'].includes(status) &&
        cycle?.id === operation.cycleId &&
        cycle.candidateDigest === operation.candidateDigest) {
      const test = cycle.tests.find(candidate =>
        candidate.id === operation.action.testId);
      if (test) {
        const testStatus = status === 'cancelled' ? 'NotRun' :
          status === 'succeeded' &&
            operation.expectedMet === true ? 'Passed' : 'Failed';
        const evidence = {
          type: 'test-evidence',
          id: `evidence-${digest({
            operationId: operation.id,
            terminalSequence: operation.terminalSequence,
          }).slice(0, 40)}`,
          workItemId: input.workItemId,
          sequence: Math.max(cycle.lastEvidenceSequence ?? 0,
            ...tx.all().filter(record =>
              record.type === 'test-evidence' &&
              record.cycleId === cycle.id)
              .map(record => record.sequence ?? 0)) + 1,
          cycleId: cycle.id,
          testId: test.id,
          testSpecDigest: cycle.testSpecDigest,
          candidateDigest: cycle.candidateDigest,
          environment: operation.action.environment,
          implementation: test.implementation,
          status: testStatus,
          observedAt: operation.updatedAt,
          activity: status === 'cancelled' ? 'pending' : 'complete',
          evidenceRef: operation.evidenceRef,
          expectedMet: operation.expectedMet,
          owner: operation.action.owner,
          host: operation.action.host,
          operationId: operation.id,
          ...(operation.action.artifactId ?
            { artifactId: operation.action.artifactId } : {}),
          ...(operation.action.deploymentId ?
            { deploymentId: operation.action.deploymentId } : {}),
        };
        tx.put(evidence);
        cycle.results[test.id] = evidence.id;
        cycle.lastEvidenceSequence = evidence.sequence;
        cycle.pendingPlanSync = true;
        tx.put(cycle);
      }
    }
    if (operation.class === 'deploy' && cycle?.id === operation.cycleId &&
      !assurancePending(cycle, tx.all()) &&
      cycle.candidateDigest === operation.candidateDigest) {
      if (status === 'succeeded') {
        repairDeploymentProjection(tx, operation);
      } else if (cycle.deployments[operation.action.environment] === operation.id) {
        cycle.step = `${operation.action.environment.toLowerCase()}-${status}`;
        tx.put(cycle);
      }
    }
    return operation;
  });
  if (result.class === 'test' &&
      ['succeeded', 'failed', 'cancelled'].includes(result.status)) {
    await synchronizeTestPlan(store, input.workItemId);
  }
  return result;
}
export async function pruneWork(store, workItemId) {
  const archived = [];
  await store.transaction(workItemId, async tx => {
    const cycle = currentCycle(tx.all(), tx.checkpoint);
    const selectedEvidence = (cycle?.tests ?? []).map(test =>
      currentTestEvidence(cycle, tx.all(), test, store.clock))
      .filter(Boolean);
    const currentEvidenceIds = new Set(selectedEvidence
      .map(evidence => evidence.id)
      .filter(id => !id.startsWith('derived-')));
    const selectedEventIds = new Set(selectedEvidence
      .map(evidence => evidence.eventId).filter(Boolean));
    const dependencies = new Set([cycle?.id, cycle?.reviewRef,
      ...Object.values(cycle?.deployments ?? {}),
      ...Object.values(cycle?.results ?? {}), ...currentEvidenceIds,
      ...Object.values(cycle?.artifacts ?? {})].filter(Boolean));
    for (const evidence of tx.all().filter(record =>
      record.type === 'test-evidence' &&
      dependencies.has(record.id) && record.operationId)) {
      dependencies.add(evidence.operationId);
    }
    const liveCycleIds = new Set(tx.all().filter(r => r.type === 'operation' && !TERMINAL.includes(r.status)).map(r => r.cycleId));
    const currentStagingResultIds = currentStagingResultEventIds(tx.all(), cycle, store.clock);
    const activeEventIds = new Set(activeEvents(tx.all(), { cycleId: cycle?.id, clock: store.clock })
      .filter(event => eventAppliesToCycle(event, cycle) &&
        (event.kind !== 'staging-result' ||
          currentStagingResultIds.has(event.id) ||
          selectedEventIds.has(event.id))).map(event => event.id));
    const auditedEventIds = new Set(tx.all().filter(record => record.type === 'audit-reference').map(record => record.eventId));
    const obsoleteReservationIds = new Set(tx.all().filter(record => {
      if (record.type !== 'reservation') return false;
      const event = tx.get(record.eventId);
      return event && isCycleBoundEvent(event) && !boundToCycle(event.effect, cycle) &&
        !liveCycleIds.has(event.effect.cycleId);
    }).map(record => record.id));
    const referencedEventIds = new Set([
      ...tx.all().filter(record => record.type === 'reservation' &&
        !obsoleteReservationIds.has(record.id)).map(record => record.eventId),
      ...tx.all().filter(record => record.type === 'test-evidence' &&
        dependencies.has(record.id) && record.eventId).map(record => record.eventId),
      ...selectedEventIds,
    ]);
    const authorityDependencies = new Set([...dependencies, ...referencedEventIds]);
    for (const event of tx.all().filter(record => record.type === 'event')) {
      if (event.effect.transition || event.effect.lifecycleStatus ||
        !auditedEventIds.has(event.id) || activeEventIds.has(event.id)) authorityDependencies.add(event.id);
    }
    for (const event of tx.all().filter(record => record.type === 'event' &&
      record.kind === 'review-result' && record.effect.status === 'ChangesRequired' &&
      boundToCycle(record.effect, cycle))) authorityDependencies.add(event.id);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const event of tx.all().filter(record => record.type === 'event' && record.kind === 'revocation')) {
        if (!event.effect.revokes.some(eventId => authorityDependencies.has(eventId)) || authorityDependencies.has(event.id)) continue;
        authorityDependencies.add(event.id);
        expanded = true;
      }
    }
    for (const record of tx.all()) {
      const terminalOperation = record.type === 'operation' && TERMINAL.includes(record.status) && record.evidenceRef && !dependencies.has(record.id);
      const resolvedConflict = record.type === 'conflict' && record.status === 'resolved';
      const obsoleteEvidence = ['test-evidence', 'artifact'].includes(record.type) &&
        !dependencies.has(record.id) && !liveCycleIds.has(record.cycleId);
      const oldCycle = record.type === 'cycle' && record.id !== cycle?.id && !liveCycleIds.has(record.id);
      const obsoleteEvent = record.type === 'event' && auditedEventIds.has(record.id) &&
        !authorityDependencies.has(record.id) && !activeEventIds.has(record.id) && !referencedEventIds.has(record.id) &&
        !record.effect.transition && !record.effect.lifecycleStatus;
      const obsoleteAuditReference = record.type === 'audit-reference' &&
        !authorityDependencies.has(record.eventId);
      const obsoleteReservation = record.type === 'reservation' && obsoleteReservationIds.has(record.id);
      if (!terminalOperation && !resolvedConflict && !obsoleteEvidence && !oldCycle &&
        !obsoleteEvent && !obsoleteAuditReference && !obsoleteReservation) continue;
      await immutableJson(path.join(store.workPath(workItemId), 'evidence', `${record.id}.json`), record);
      tx.remove(record.id); archived.push(record.id);
    }
  }, { allowRecoveryRequired: true });
  return { archived, retained: 'Uncertain/in-progress operations, active dependencies and unaudited decisions are never pruned.' };
}
export async function addConflict(store, input) {
  object(input, ['workItemId', 'id', 'reason', 'scope', 'references'], ['workItemId', 'reason', 'references']);
  text(input.reason, 'conflict reason', 600);
  requireThat(Array.isArray(input.references) && input.references.length >= 2, 'INPUT', 'Reference both conflicting rules');
  return store.transaction(input.workItemId, tx => {
    const record = { ...input, type: 'conflict', id: input.id ?? newId('conflict'), scope: input.scope ?? {}, status: 'open' };
    requireThat(!tx.get(record.id), 'ID_CONFLICT', 'Conflict ID already exists');
    tx.put(record); return record;
  });
}
export async function resolveConflict(store, input) {
  object(input, ['workItemId', 'conflictId', 'eventId', 'correctionRef'], ['workItemId', 'conflictId']);
  return store.transaction(input.workItemId, async tx => {
    const conflict = tx.get(input.conflictId);
    requireThat(conflict?.type === 'conflict', 'INPUT', 'Conflict is unavailable');
    const cycle = currentCycle(tx.all(), tx.checkpoint);
    const event = activeEvents(tx.all(), {
      cycleId: cycle?.id,
      clock: store.clock,
    }).find(candidate => candidate.id === input.eventId);
    if (event?.effect.lifetime?.kind === 'once') {
      const reservation = tx.all().find(record =>
        record.type === 'reservation' && record.eventId === event.id);
      const resolutionId = `conflict:${conflict.id}`;
      requireThat(!reservation || reservation.operationId === resolutionId,
        'AUTHORITY', 'Once-only conflict override was already consumed');
      tx.put({
        type: 'reservation',
        id: `reservation-${digest(event.id).slice(0, 40)}`,
        workItemId: input.workItemId,
        eventId: event.id,
        operationId: resolutionId,
      });
    }
    requireThat(input.correctionRef || (event?.kind === 'override' && event.effect.rules?.includes(`conflict:${conflict.id}`)),
      'AUTHORITY', 'Resolve through a verifiable configuration correction or a scoped user override');
    if (event) requireThat(Object.entries(event.effect.scope ?? {}).every(([key, value]) => digest(value) === digest(conflict.scope[key] ?? null)),
      'AUTHORITY', 'A narrower override cannot globally resolve the conflict; it only waives matching affected actions');
    if (input.correctionRef) {
      const match = /^([A-Za-z0-9._-]+):(.+)@sha256:([a-f0-9]{64})$/u.exec(input.correctionRef);
      requireThat(match, 'EVIDENCE', 'Correction reference must be repository:path@sha256:<content-digest>');
      const member = tx.metadata.members.find(member => member.repositoryId === match[1]);
      requireThat(member && digest(await readBytes(await safePath(member.root, match[2]))) === match[3], 'EVIDENCE', 'Corrected configuration content is unavailable or does not match its digest');
    }
    conflict.status = 'resolved';
    conflict.resolution = input.correctionRef ?? input.eventId;
    tx.put(conflict);
    tx.checkpoint.artifactGeneration++;
    return conflict;
  });
}
