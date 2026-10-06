import path from 'node:path';
import { digest, fingerprint, id, newId, now, object, requireThat, text, choice } from './core.mjs';
import { canonicalPath, immutableJson, readBytes, readJson, safePath } from './files.mjs';
import { bindingKey, publicationPaths, selectedFetchRemote, selectedPushRemote,
  validateBinding, verifyPublicationBase } from './git.mjs';
import { requirePublicationSourceObservation, selectedPublicationRepositoryURL,
  validateSelectedFetchRemote, validateSelectedPushRemote } from './repository-observations.mjs';
import { operationMatchesCurrentSource, requireCurrentCandidateRevisions,
  requireCurrentSourceRevision } from './current-evidence.mjs';
import { deriveIntendedOutcome, effectActionClass, intendedOutcomesMayMatch,
  operationResultProof, validateOperationResult } from './external-results.mjs';
import { prepareHostInvocation } from './host-invocations.mjs';
import { loadConfig, synchronizeTestPlan } from './artifacts.mjs';
import { effectiveEnvironments, evaluatePolicy, isExternalAction,
  isHostedConfiguration, resolveActionEnvironment, validateAction } from './policy.mjs';
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
  if (operation.class !== 'deploy' || operation.status !== 'succeeded' ||
      operation.resultProof?.status !== 'succeeded') return;
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
async function preparedIntendedOutcome(tx, member, current, action, config, cycle) {
  if (!isExternalAction(action)) return {};
  let remoteRepositoryURL;
  let hostedObservation;
  try {
    if (action.class === 'push') {
      const selected = await selectedPushRemote(member, undefined, action.target);
      remoteRepositoryURL = validateSelectedPushRemote(selected);
      requireThat(action.remoteUrlDigest === digest(selected.pushURLs), 'EVIDENCE',
        'Prepared publication does not match the current push destination');
    } else if (['pr-create', 'pr-update'].includes(action.class)) {
      remoteRepositoryURL = (await selectedPublicationRepositoryURL(member,
        config.remote, action.remoteRepositoryURL, action.target)).remoteRepositoryURL;
    } else {
      remoteRepositoryURL = validateSelectedFetchRemote(
        await selectedFetchRemote(member, config.remote));
    }
    hostedObservation = tx.all().filter(record =>
      record.type === 'repository-observation' &&
      record.repositoryId === member.repositoryId &&
      record.localRepositoryPath === current.root &&
      record.remoteRepositoryURL === remoteRepositoryURL)
      .sort((left, right) => left.observedAt.localeCompare(right.observedAt))
      .at(-1);
    requireThat(hostedObservation,
      'EVIDENCE', 'Current hosted repository observation is required');
    requireThat(action.provider === undefined ||
      action.provider === hostedObservation.provider, 'EVIDENCE',
    'Action hosting service differs from the trusted repository observation');
    requireThat(action.localRepositoryPath === undefined ||
      action.localRepositoryPath === current.root, 'EVIDENCE',
    'Prepared checkout differs from the current bound repository');
    if (['pr-create', 'pr-update'].includes(action.class)) {
      await requirePublicationSourceObservation(tx.metadata, tx.all(),
        hostedObservation, action.sourceRepositoryURL);
    }
    if (action.remoteRepositoryURL !== undefined) {
      requireThat(action.remoteRepositoryURL === remoteRepositoryURL,
        'EVIDENCE', 'Prepared destination differs from the current hosted URL');
    }
    const sourceRevision = action.sourceRevision ?? current.head;
    if (action.sourceRevision !== undefined || cycle) {
      requireThat(/^[a-f0-9]{40,64}$/u.test(sourceRevision) &&
        current.head === sourceRevision, 'STALE',
      'Requested source revision differs from the current bound checkout commit');
    }
    if (cycle) {
      const source = cycle.sources.find(item =>
        item.repositoryId === member.repositoryId);
      requireThat(source?.revision === current.head, 'STALE',
        'Current bound checkout commit differs from the validation cycle');
    }
    const environmentResolution = resolveActionEnvironment({
      ...action, localRepositoryPath: current.root, remoteRepositoryURL,
      provider: hostedObservation.provider,
    }, config);
    const verifiedAction = environmentResolution.action;
    const intendedOutcome = deriveIntendedOutcome({
      ...verifiedAction,
      ...(sourceRevision ? { sourceRevision } : {}),
      ...(cycle ? { candidateDigest: cycle.candidateDigest,
        testSpecDigest: cycle.testSpecDigest } : {}),
    });
    return { intendedOutcome, verifiedAction, environmentResolution };
  } catch (error) {
    if (hostedObservation && action.provider !== undefined &&
        action.provider !== hostedObservation.provider) throw error;
    if (!['INPUT', 'EVIDENCE'].includes(error.code)) throw error;
    return { intendedOutcomeGap: error.message };
  }
}
export async function verifyPreparedIntendedOutcome(tx, member, action,
  config, cycle, prepared, clock) {
  requireThat(prepared, 'EVIDENCE',
    'No complete current intended outcome was prepared; dispatch is unmanaged');
  const current = await validateBinding(member);
  if (action.earlyDraft) {
    const verifiedBaseRevision = await verifyPublicationBase(current, action.target,
      action.class === 'push' ? action.baseRef : action.targetRef,
      action.targetRevision, tx.all(), clock,
      { actionClass: action.class, remoteRepositoryURL: action.remoteRepositoryURL,
        configuredRemote: config.remote });
    requireThat(digest(await publicationPaths(current,
      action.sourceRevision, verifiedBaseRevision)) ===
      digest([...action.paths].sort()), 'EVIDENCE',
    'Early draft publication no longer matches the hosted source-to-target diff');
  }
  const refreshed = await preparedIntendedOutcome(tx, member, current,
    action, config, cycle);
  requireThat(refreshed.intendedOutcome?.digest === prepared.digest, 'STALE',
    'The hosted destination or candidate changed after preparation');
}
function operationMayMatch(operation, action, intended) {
  if (!isExternalAction(action)) return false;
  if (operation.intendedOutcome) return Boolean(intended) &&
    intendedOutcomesMayMatch(operation.intendedOutcome, intended);
  const stored = operation.action ?? {};
  const explicitlyLocal = stored.target === 'local' ||
    stored.environment === 'local' ||
    Array.isArray(stored.paths) && stored.paths.length > 0 &&
      stored.paths.every(file => typeof file === 'string' && file.length > 0);
  if (operation.class === 'configuration' && stored.class === operation.class &&
      operation.target === 'local' && explicitlyLocal &&
      !stored.stages?.length && !stored.implicitEnvironments?.length &&
      !isHostedConfiguration(stored)) return false;
  const scope = intended ? {
    class: intended.actionClass, ...intended.target, ...intended.requested,
  } : Object.fromEntries([
    'class', 'repositoryId', 'target', 'environment', 'provider', 'pipeline',
    'remoteRepositoryURL', 'remoteUrlDigest', 'sourceRevision', 'configDigest',
  ].filter(field => action[field] !== undefined)
    .map(field => [field, action[field]]));
  const publication = ['push', 'pr-create', 'pr-update'].includes(action.class);
  const known = (field, value) => {
    if (['sourceRevision', 'targetRevision'].includes(field)) {
      return typeof value === 'string' &&
        /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value);
    }
    if (['draft', 'force', 'delete', 'earlyDraft'].includes(field)) {
      return typeof value === 'boolean';
    }
    return typeof value === 'string' && value.trim().length > 0 &&
      !['unknown', 'not-applicable'].includes(value);
  };
  for (const [field, expected] of Object.entries(scope)) {
    // Publication targets are remote handles, not historical hosted identities.
    if (field === 'target' && publication) continue;
    if (!known(field, expected)) continue;
    const values = [stored[field]];
    if (['class', 'repositoryId', 'candidateDigest', 'artifactId'].includes(field) ||
        field === 'target' && operation.target !== 'local') {
      values.push(operation[field]);
    }
    const supplied = values.filter(value => value !== undefined && value !== null)
      .map(value => field === 'class' ? effectActionClass(value) : value);
    // Unknown or conflicting historical facts cannot prove a different effect.
    if (supplied.length && supplied.every(value =>
      known(field, value) && value === supplied[0]) &&
        supplied[0] !== (field === 'class' ? effectActionClass(expected) : expected)) {
      // Different hash widths may represent an abbreviation, not another commit.
      if (['sourceRevision', 'targetRevision'].includes(field) &&
          supplied[0].length !== expected.length) continue;
      return false;
    }
  }
  return true;
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
export async function prepareOperation(store, input, host = {}) {
  object(input, ['workItemId', 'sessionId', 'operationId', 'action', 'request', 'correlationKey', 'intent'],
    ['workItemId', 'sessionId', 'action', 'request', 'correlationKey', 'intent']);
  object(host, ['adapterContract', 'hostCallId']);
  const { adapterContract, hostCallId } = host;
  requireThat((adapterContract === undefined) === (hostCallId === undefined) &&
    (adapterContract === undefined || adapterContract?.propagatesUniqueCallId === true),
  'ADAPTER', 'Host call proof requires a documented trusted adapter and call ID');
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
    let verifiedAction = input.action;
    if (input.action.class === 'push') {
      const selected = await selectedPushRemote(member, undefined, input.action.target);
      const remoteRepositoryURL = validateSelectedPushRemote(selected);
      requireThat(input.action.remoteUrlDigest === digest(selected.pushURLs) &&
        (input.action.localRepositoryPath === undefined ||
          input.action.localRepositoryPath === current.root) &&
        (input.action.remoteRepositoryURL === undefined ||
          input.action.remoteRepositoryURL === remoteRepositoryURL),
      'EVIDENCE', 'Push request differs from its current bound checkout or push URL');
      verifiedAction = { ...input.action, localRepositoryPath: current.root,
        remoteRepositoryURL,
        ...(input.action.earlyDraft ?
          { sourceRepositoryURL: remoteRepositoryURL } : {}) };
    } else if (input.action.class === 'deploy' ||
        isHostedConfiguration(input.action)) {
      const remoteRepositoryURL = validateSelectedFetchRemote(
        await selectedFetchRemote(member, configuration.remote));
      requireThat(
        (input.action.localRepositoryPath === undefined ||
          input.action.localRepositoryPath === current.root) &&
        (input.action.remoteRepositoryURL === undefined ||
          input.action.remoteRepositoryURL === remoteRepositoryURL),
      'EVIDENCE', 'Hosted action differs from its bound checkout or current hosted URL');
      verifiedAction = { ...input.action, localRepositoryPath: current.root,
        remoteRepositoryURL };
    }
    const cycle = currentCycle(tx.all(), tx.checkpoint);
    const { verifiedAction: normalizedAction,
      environmentResolution: verifiedResolution, ...outcome } =
      await preparedIntendedOutcome(tx, member, current,
        verifiedAction, configuration, cycle);
    verifiedAction = normalizedAction ?? verifiedAction;
    const initialResolution = verifiedResolution ??
      resolveActionEnvironment(verifiedAction, configuration);
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
    const effectFingerprint = digest({ ...effectAction,
      class: effectActionClass(effectAction.class) });
    const previous = tx.get(operationId) ?? await readJson(path.join(store.workPath(input.workItemId), 'evidence', `${operationId}.json`), { optional: true });
    if (previous) {
      requireThat(previous.requestFingerprint === requestFingerprint &&
        digest(previous.action) === digest(action),
      'ID_CONFLICT', 'Operation/correlation ID reused for a different request');
      return { operation: previous, action: TERMINAL.includes(previous.status) ? 'already-terminal' : 'resume-or-reconcile; never blindly redispatch' };
    }
    const duplicates = tx.all().filter(r => r.type === 'operation' &&
      !TERMINAL.includes(r.status) &&
      (r.requestFingerprint === requestFingerprint ||
        r.effectFingerprint === effectFingerprint ||
        outcome.intendedOutcome &&
          r.intendedOutcome?.digest === outcome.intendedOutcome.digest ||
        operationMayMatch(r, action, outcome.intendedOutcome)));
    const duplicate = duplicates.find(r => r.status !== 'uncertain') ??
      duplicates[0];
    const retryOverride = duplicate?.status === 'uncertain' && applicableOverride(tx.all(), 'uncertain-retry',
      action, { cycleId: tx.checkpoint.validationCycleRef, clock: store.clock });
    requireThat(!duplicate || retryOverride, 'UNCERTAIN', 'An unresolved matching operation already exists; reconcile it before preparing another');
    if (action.earlyDraft) {
      const verifiedBaseRevision = await verifyPublicationBase(current, action.target,
        action.class === 'push' ? action.baseRef : action.targetRef,
        action.targetRevision, tx.all(), store.clock,
        { actionClass: action.class, remoteRepositoryURL: action.remoteRepositoryURL,
          configuredRemote: configuration.remote });
      const actualPaths = await publicationPaths(current, action.sourceRevision, verifiedBaseRevision);
      requireThat(digest(actualPaths) === digest([...action.paths].sort()), 'EVIDENCE',
        'Early draft paths must exactly match the current source-vs-target Git diff');
    }
    if (action.class === 'deploy' && action.environment !== 'local') {
      await requireCurrentCandidateRevisions(tx.metadata, cycle, tx.all());
    }
    const decision = evaluatePolicy({ ...tx, records: tx.all() }, action, {
      clock: store.clock,
      configuration,
      environmentResolution,
    });
    requireThat(decision.allowed, 'GATE', 'Operation is not authorized', decision.findings);
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
    if (['push', 'pr-create', 'pr-update', 'artifact', 'artifact-produce',
      'notification'].includes(action.class) ||
        isHostedConfiguration(action)) requireThat(outcome.intendedOutcome,
      'EVIDENCE', outcome.intendedOutcomeGap ??
        'Verify the publication URLs with the trusted hosting-service repository verifier');
    requireThat(outcome.intendedOutcome || hostCallId === undefined, 'ADAPTER',
      'Host call proof requires a supported prepared external outcome');
    const hostInvocation = outcome.intendedOutcome ?
      await prepareHostInvocation({
        sessionId: input.sessionId, toolName: input.request.toolName,
        toolArgs: normalizedToolArgs, cwd, hostCallId,
      }, { adapterContract }) : null;
    const operation = { type: 'operation', id: operationId, workItemId: input.workItemId, sessionId: input.sessionId,
      repositoryId: member.repositoryId, bindingKey: bindingKey(current), class: action.class, action,
      target: action.target ?? 'local', status: 'prepared', correlationKey: input.correlationKey,
      requestFingerprint, effectFingerprint, intent: input.intent, createdAt: now(store.clock), dispatchBound: false,
      cycleId: cycle?.id ?? null, candidateDigest: cycle?.candidateDigest ?? null, candidateStamp: stamp,
      reservedEventIds: [],
      ...(hostInvocation ? { hostInvocation } : {}), ...outcome };
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
    const configuration = await loadConfig(tx.metadata, member.repositoryId);
    const policy = evaluatePolicy({ ...tx, records: tx.all() },
      operation.action, { clock: store.clock, configuration });
    requireThat(policy.allowed, 'GATE', 'Authority changed before dispatch', policy.findings);
    const cycle = currentCycle(tx.all(), tx.checkpoint);
    requireThat(!operation.cycleId || operation.cycleId === cycle?.id, 'STALE', 'Prepared operation belongs to a superseded cycle');
    if (isExternalAction(operation.action)) {
      await verifyPreparedIntendedOutcome(tx, member, operation.action,
        configuration, cycle, operation.intendedOutcome, store.clock);
    }
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
    'expectedMet', 'dispatchAttempted', 'providerStatus', 'observedResult', 'correlationKey'],
  ['workItemId', 'operationId', 'status']);
  choice(input.status, ['submitted', 'running', 'succeeded', 'failed', 'cancelled', 'uncertain', 'not-started'], 'operation result');
  const result = await store.transaction(input.workItemId, async tx => {
    const operation = tx.get(input.operationId);
    requireThat(operation?.type === 'operation', 'OPERATION', 'Operation is unavailable');
    if (operation.status === 'uncertain' &&
        input.status !== 'uncertain') requireThat(reconcile, 'UNCERTAIN',
      'Use read-only reconciliation to resolve this operation');
    let checked;
    let verifiedObservation;
    if (operation.intendedOutcome && input.observedResult !== undefined) {
      if (typeof store.verifyOperationResult === 'function') {
        const verified = await store.verifyOperationResult({
          operation, observedResult: input.observedResult,
        });
        requireThat(verified?.dispatch?.id === operation.id &&
          verified.observation, 'ADAPTER',
        'Hosting-service result adapter must bind the exact prepared operation');
        const executionContext = verified.executionContext === undefined ? {} :
          { ...object(verified.executionContext, ['provider', 'connection',
            'scopeRef', 'definitionRef', 'attemptCapability']) };
        verifiedObservation = verified.observation;
        if (verified.observation.causalProof?.kind === 'host-call' ||
            verified.observation.status === 'not-started') {
          requireThat(operation.hostInvocation?.hostCallIdDigest &&
            verified.dispatch.hostCallSupported === true &&
            typeof verified.dispatch.hostCallId === 'string' &&
            verified.dispatch.hostCallId.length > 0 &&
            digest(verified.dispatch.hostCallId) ===
              operation.hostInvocation.hostCallIdDigest,
          'EVIDENCE', 'Host-call proof lacks a supported dispatch binding');
        }
        const dispatch = { ...verified.dispatch, status: operation.status };
        const provisional = validateOperationResult(operation.intendedOutcome,
          dispatch, verified.observation, {
            executionContext,
            requireArtifactExecutionIdentity: true,
            previousTerminal: operation.resultProof ?? null,
          });
        const archivedProofs = provisional.status === 'uncertain' ? [] :
          await store.archivedOperationProofs(input.workItemId, provisional);
        checked = validateOperationResult(operation.intendedOutcome,
          dispatch, verified.observation, {
            executionContext,
            requireArtifactExecutionIdentity: true,
            priorResults: [
              ...tx.all().filter(record =>
                record.type === 'operation' && record.resultProof)
                .map(operationResultProof),
              ...archivedProofs,
            ],
            previousTerminal: operation.resultProof ?? null,
          });
        if (checked.status !== 'uncertain') {
          for (const [field, value] of [
            ['status', checked.status],
            ['evidenceRef', verified.observation.evidence.ref],
            ['handle', checked.providerResultId],
            ['providerStatus', verified.observation.providerStatus],
            ['expectedMet', verified.observation.result?.expectedMet],
          ]) if (input[field] !== undefined) requireThat(input[field] === value,
            'EVIDENCE', `Caller ${field} conflicts with the verified result`);
        }
      } else checked = { status: 'uncertain',
        reason: 'hosting-service-result-adapter-unavailable' };
    }
    const requiresCurrentProof = Boolean(operation.intendedOutcome) ||
      isExternalAction(operation.action);
    if (TERMINAL.includes(operation.status)) {
      requireThat(operation.status === input.status &&
        (requiresCurrentProof ?
          operation.resultProof &&
            checked?.resultDigest === operation.resultProof.resultDigest :
          operation.evidenceRef === input.evidenceRef),
      'ID_CONFLICT', 'Terminal operation cannot be silently rewritten');
      repairDeploymentProjection(tx, operation);
      return operation;
    }
    let status = input.status;
    if (requiresCurrentProof && TERMINAL.includes(status)) {
      status = checked?.status ?? 'uncertain';
      if (status === 'uncertain') operation.resultGap =
        checked?.reason ?? operation.intendedOutcomeGap ??
          'current-result-observation-required';
    } else if (requiresCurrentProof && status === 'uncertain') {
      operation.resultGap ??= operation.intendedOutcomeGap ??
        'host-call-id-or-provider-request-proof-required';
    } else if (status === 'not-started') requireThat(operation.status === 'prepared' && input.dispatchAttempted === false && input.evidenceRef,
      'UNCERTAIN', 'Not-started requires evidence that dispatch was never attempted');
    if (status !== 'not-started') requireThat(operation.status !== 'prepared' ||
      status === 'uncertain', 'OPERATION',
    'Mark dispatching before recording a provider response');
    if (['submitted', 'running'].includes(status) && !input.handle) status = 'uncertain';
    if (!requiresCurrentProof && TERMINAL.includes(status) && status !== 'not-started') {
      requireThat(input.evidenceRef && input.target === operation.target && input.requestFingerprint === operation.requestFingerprint,
        'EVIDENCE', 'Terminal outcome requires matching target, request fingerprint and provider evidence');
      if (operation.class === 'test') requireThat(typeof input.expectedMet === 'boolean', 'EVIDENCE', 'Test outcome requires expected-result evaluation');
      if (input.status === 'failed' && !input.providerStatus) status = 'uncertain';
      if (['build', 'deploy', 'pipeline', 'pr-create', 'pr-validation'].includes(operation.class) && !input.handle && !operation.handle) status = 'uncertain';
    }
    if (input.handle && operation.handle) requireThat(input.handle === operation.handle, 'EVIDENCE', 'Provider handle changed; reconcile run identity');
    const activeDiagnostic = ['submitted', 'running'].includes(input.status) &&
      (input.handle !== undefined || input.evidenceRef !== undefined);
    if (activeDiagnostic) {
      requireThat(operation.status !== 'prepared' &&
        input.requestFingerprint === operation.requestFingerprint &&
        input.correlationKey === operation.correlationKey,
      'EVIDENCE', 'In-flight diagnostic must match the dispatched request and correlation');
      if (input.handle !== undefined) text(input.handle, 'provider handle');
      if (input.evidenceRef !== undefined) text(input.evidenceRef, 'evidence reference');
    }
    operation.status = status;
    if (checked && status !== 'uncertain' && TERMINAL.includes(status)) {
      operation.resultProof = checked;
      operation.evidenceRef = verifiedObservation.evidence.ref;
      if (checked.providerResultId) operation.handle = checked.providerResultId;
      operation.providerStatus = status;
      if (verifiedObservation.result?.expectedMet !== undefined) {
        operation.expectedMet = verifiedObservation.result.expectedMet;
      }
    }
    if (TERMINAL.includes(status) && operation.terminalSequence === undefined) {
      operation.terminalSequence = Math.max(0, ...tx.all().filter(record => record.type === 'operation' &&
        TERMINAL.includes(record.status) && record.cycleId === operation.cycleId &&
        record.class === operation.class && record.action.environment === operation.action.environment)
        .map(record => record.terminalSequence ?? 0)) + 1;
    }
    for (const key of ['handle', 'evidenceRef', 'expectedMet', 'providerStatus']) {
      if (input[key] !== undefined && ((activeDiagnostic &&
          ['handle', 'evidenceRef'].includes(key)) || !requiresCurrentProof ||
          checked?.status === status && status !== 'uncertain')) {
        operation[key] = input[key];
      }
    }
    operation.updatedAt = now(store.clock);
    tx.put(operation);
    const cycle = currentCycle(tx.all(), tx.checkpoint);
    if (operation.class === 'test' &&
        ['succeeded', 'failed', 'cancelled'].includes(status) &&
        cycle?.id === operation.cycleId &&
        cycle.candidateDigest === operation.candidateDigest) {
      const test = cycle.tests.find(candidate =>
        candidate.id === operation.action.testId);
      let currentRevision = true;
      if (test && test.environment !== 'local') {
        if (!operationMatchesCurrentSource(cycle, operation)) {
          currentRevision = false;
          operation.resultGap = 'Result belongs to an earlier candidate commit';
          tx.put(operation);
        } else {
          try {
            await requireCurrentSourceRevision(tx.metadata, cycle,
              operation.repositoryId);
          } catch (error) {
            if (error.code !== 'STALE') throw error;
            currentRevision = false;
            operation.resultGap = 'Current checkout commit differs from the tested deployment';
            tx.put(operation);
            cycle.invalidatedEnvironments = [...new Set([
              ...(cycle.invalidatedEnvironments ?? []), 'DEV', 'STAGING',
            ])].sort();
            cycle.environmentInvalidationSequences ??= {};
            for (const environment of ['DEV', 'STAGING']) {
              cycle.environmentInvalidationSequences[environment] = Math.max(
                cycle.environmentInvalidationSequences[environment] ?? 0,
                ...tx.all().filter(record =>
                  record.type === 'operation' && record.class === 'deploy' &&
                  record.cycleId === cycle.id &&
                  record.action.environment === environment)
                  .map(record => record.deploymentSequence ?? 0));
              delete cycle.artifacts[environment];
              delete cycle.deployments[environment];
              for (const planned of cycle.tests.filter(item =>
                item.environment === environment)) delete cycle.results[planned.id];
            }
            cycle.pendingPlanSync = true;
            cycle.step = 'local-testing';
            tx.put(cycle);
          }
        }
      }
      if (test && currentRevision) {
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
  const { archiveSupersededObservations, withObservationRetention } =
    await import('./observation-retention.mjs');
  const archived = [];
  await withObservationRetention(store, workItemId, async (tx, monitorDependencies) => {
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
    for (const artifact of tx.all().filter(record =>
      record.type === 'artifact' &&
      dependencies.has(record.id) && record.producingOperationId)) {
      dependencies.add(artifact.producingOperationId);
    }
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
    archived.push(...await archiveSupersededObservations(store, tx, { monitorDependencies }));
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
