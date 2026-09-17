import { LIMITS, budget, byteSize, digest, object, requireThat } from './core.mjs';
import { readBytes, readJson, updateJson } from './files.mjs';
import { bindingKey } from './git.mjs';
import { artifactDocumentId, artifactLocator, artifactPath, artifactRepositoryId, currentTestSpecification, loadConfig, snapshotLocators, snapshots, synchronizeTestPlan, testSpecificationDigest } from './artifacts.mjs';
import { activeEvents, applicableOverride, currentCycle, currentTestEvidence, hasStagingCompletion, hasStageCompletion, phaseAuthority, reviewPassed, stagePassed, testCheckpoint } from './authority.mjs';
import { replayAudit } from './audit.mjs';
import { verifyEvent } from './decisions.mjs';
import { effectiveEnvironments } from './policy.mjs';
import { candidateContentDigest, candidateSnapshot, startCycle } from './validation.mjs';
import { TERMINAL } from './operations.mjs';

export async function orientationToken(store, workItemId, member, session, state) {
  const materialized = state.manifest.artifacts.filter(artifact => !artifact.planned && artifact.digest !== 'pending');
  const artifacts = await snapshotLocators(store, workItemId, materialized,
    state.manifest, state.metadata);
  for (const artifact of state.manifest.artifacts.filter(item => item.planned || item.digest === 'pending')) {
    artifacts.push({ role: artifact.role,
      repositoryId: artifactRepositoryId(artifact, state.manifest),
      artifactId: artifactDocumentId(artifact),
      locator: artifactLocator(artifact, state.manifest),
      digest: 'pending' });
  }
  artifacts.sort((left, right) => left.role.localeCompare(right.role) ||
    left.locator.localeCompare(right.locator));
  for (const artifact of artifacts) delete artifact.git;
  for (const plan of artifacts.filter(artifact =>
    artifact.role === 'test-plan' && artifact.digest !== 'pending')) {
    const locator = state.manifest.artifacts.find(artifact =>
      artifact.role === 'test-plan' &&
      artifactLocator(artifact, state.manifest) === plan.locator);
    plan.digest = testSpecificationDigest((await readBytes(
      await artifactPath(store, workItemId, locator, state.metadata),
    LIMITS.artifact)).toString('utf8'));
  }
  return digest({ workItemId, binding: bindingKey(member), sessionId: session.sessionId,
    orientationGeneration: session.orientationGeneration ?? 0, policyGeneration: state.checkpoint.policyGeneration,
    artifactGeneration: state.checkpoint.artifactGeneration, artifacts,
    configuration: await loadConfig(state.metadata, member.repositoryId), manifestRevision: state.manifest.revision });
}
export async function assertOriented(store, workItemId, member, state, sessionId) {
  const session = await readJson(store.sessionPath(sessionId), { optional: true });
  requireThat(session?.workItemId === workItemId && session.bindingKey === bindingKey(member), 'ORIENTATION', 'Bind this session and run sdlc resume');
  const token = await orientationToken(store, workItemId, member, session, state);
  requireThat(session.acknowledgedToken === token, 'ORIENTATION', 'Run sdlc resume, retrieve the relevant authoritative content, then sdlc context ack with its current token');
  return token;
}
function laterCheckpointAction(cycle, records, clock) {
  const tests = cycle.tests.filter(test => ['review', 'post-review'].includes(testCheckpoint(test)));
  const failed = tests.filter(test => currentTestEvidence(cycle, records, test, clock)?.status === 'Failed');
  const describe = items => {
    const visible = items.slice(0, 5).map(test => test.id).join(', ');
    return items.length > 5 ? `${visible} (+${items.length - 5} more; use sdlc status for details)` : visible;
  };
  if (failed.length) return `Diagnose failed required later-checkpoint tests: ${describe(failed)}.`;
  const pending = tests.filter(test => currentTestEvidence(cycle, records, test, clock)?.status !== 'Passed');
  if (pending.length) return `Run remaining required later-checkpoint tests: ${describe(pending)}.`;
  return null;
}
export function nextAction(state, clock = Date) {
  const { checkpoint, records } = state;
  const uncertain = records.filter(r => r.type === 'operation' && ['dispatching', 'uncertain'].includes(r.status));
  if (uncertain.length) return 'Reconcile uncertain external operations read-only before any retry.';
  if (checkpoint.blockerRefs.length) return 'Resolve the scoped configuration conflicts before affected work.';
  if (checkpoint.lifecycleStatus === 'paused') return 'Work is paused. Await an explicit user instruction to resume it.';
  if (checkpoint.lifecycleStatus === 'completed') return 'Work is completed. No further lifecycle advancement is pending.';
  if (!phaseAuthority(records, checkpoint, null, { clock }).active) return `Current ${checkpoint.phase} phase authority is revoked or expired; obtain a new captured approval or scoped override before dependent work.`;
  if (checkpoint.phase !== 'coding') return `Continue ${checkpoint.phase}; obtain captured user approval before advancing.`;
  const cycle = currentCycle(records, checkpoint);
  if (!cycle) return 'Implement the authorized design, then start a unit-first local validation cycle.';
  if (!stagePassed(cycle, records, 'local', clock)) return 'Run the full pre-Review local unit suite first, then all other required pre-Review local tests.';
  const review = records.find(record => record.id === cycle.reviewRef && record.type === 'event' && record.kind === 'review-result');
  if (!reviewPassed(cycle, records, clock)) {
    if (review?.effect.status === 'ChangesRequired') return 'Resolve the blocking /review findings, then restart unit-first local validation.';
    if (review?.effect.status === 'Blocked') return 'Resolve the reported /review capability or evidence blocker.';
    return 'Run GitHub Copilot CLI /review for the current locally validated candidate, then capture the user-confirmed result.';
  }
  const hasDev = cycle.tests.some(test => testCheckpoint(test) === 'DEV');
  const hasStaging = cycle.tests.some(test => testCheckpoint(test) === 'STAGING');
  const stagingDeployment = records.find(record => record.id === cycle.deployments.STAGING);
  const stagingPromotions = activeEvents(records, { cycleId: cycle.id, clock }).filter(event =>
    event.kind === 'staging-promotion' && event.effect.cycleId === cycle.id);
  const stagingOperations = records.filter(record => record.type === 'operation' &&
    record.cycleId === cycle.id && effectiveEnvironments(record.action).has('STAGING') &&
    ['build', 'deploy', 'pipeline'].includes(record.class) && !TERMINAL.includes(record.status));
  const dispatchedStagingOperation = stagingOperations.find(record => record.status !== 'prepared');
  const preparedStagingOperation = stagingOperations.find(record => record.status === 'prepared');
  if (dispatchedStagingOperation) {
    return 'Monitor or reconcile the current STAGING operation before preparing any replacement.';
  }
  if (stagingDeployment) {
    if (stagingDeployment.status !== 'succeeded') {
      if (['dispatching', 'submitted', 'running', 'uncertain'].includes(stagingDeployment.status)) {
        return 'Monitor or reconcile the current STAGING deployment before test handoff.';
      }
      return `STAGING deployment is ${stagingDeployment.status}; diagnose or retry only with current authorization before test handoff.`;
    }
    if (!stagePassed(cycle, records, 'STAGING', clock)) {
      return 'Run handoff staging to resolve the configured or explicitly overridden STAGING owner/location, then execute remaining deployment-bound tests and await explicit completion confirmation.';
    }
    if (!hasStagingCompletion(records, cycle, clock)) {
      return 'All required STAGING tests passed; retain their results and capture explicit current-deployment STAGING completion before PROD readiness.';
    }
    const later = laterCheckpointAction(cycle, records, clock);
    if (later) return later;
    return 'Evaluate current PROD PR readiness; recommend the configured pipeline or missing prerequisites. Never automatically queue PROD.';
  }
  const overrideEvents = activeEvents(records, { cycleId: cycle.id, clock }).filter(event =>
    event.kind === 'override' && (!event.effect.scope?.environment ||
      event.effect.scope.environment === 'STAGING'));
  const repositoryIds = new Set(state.metadata.members.map(member => member.repositoryId));
  const targets = new Set([undefined]);
  for (const event of [...overrideEvents, ...stagingPromotions]) {
    for (const repositoryId of event.effect.scope?.repositoryIds ?? []) {
      repositoryIds.add(repositoryId);
    }
    if (event.effect.scope?.target) targets.add(event.effect.scope.target);
  }
  const contexts = [...repositoryIds].flatMap(repositoryId => [...targets].map(target => ({
    repositoryId,
    ...(target ? { target } : {}),
  })));
  const promotionPrerequisitesAuthorized = contexts.some(context =>
    ['recommend-staging', 'staging-promotion'].some(actionClass => {
      const action = { class: actionClass, environment: 'STAGING', ...context };
      return Boolean(applicableOverride(records, 'dev-validation', action, { cycleId: cycle.id, clock })) &&
        Boolean(applicableOverride(records, 'dev-completion', action, { cycleId: cycle.id, clock }));
    }));
  const stagingWithoutDevAuthorized = !hasDev && hasStaging &&
    (Boolean(stagingDeployment) || stagingPromotions.length > 0 || promotionPrerequisitesAuthorized);
  if (!hasDev && hasStaging && !stagingWithoutDevAuthorized) {
    return 'Resolve the Test Plan: STAGING validation requires a DEV checkpoint or an explicit documented workflow override.';
  }
  if (!hasDev && !hasStaging) return laterCheckpointAction(cycle, records, clock) ??
    'Request user confirmation that the reviewed local-only work is complete.';
  if (hasDev) {
    const dev = activeEvents(records, { cycleId: cycle.id, clock }).some(e => e.kind === 'dev-authorization' && e.effect.cycleId === cycle.id);
    if (!dev) return 'Await DEV authorization. Local success does not queue any remote work.';
    if (!stagePassed(cycle, records, 'DEV')) return 'Within the authorized DEV attempt, obtain the matching artifact, deploy, and execute planned DEV tests.';
    if (!hasStageCompletion(records, cycle, 'DEV', clock)) return 'Request current DEV completion confirmation before recommending STAGING.';
  }
  if (!hasStaging) return laterCheckpointAction(cycle, records, clock) ??
    'Request user confirmation that the reviewed DEV-validated work is complete.';
  const staging = stagingPromotions.length > 0;
  if (!staging) return 'Recommend STAGING and await explicit promotion consent; do not deploy yet.';
  if (preparedStagingOperation) {
    return 'Revalidate current policy for the prepared STAGING operation, then dispatch it only if its exact scope remains authorized.';
  }
  return 'Prepare the concrete STAGING build/deployment, then dispatch only if current policy authorizes its exact target, repository, paths, item and lifetime scope.';
}
export async function status(store, workItemId) {
  const state = await store.load(workItemId);
  const cycle = currentCycle(state.records, state.checkpoint);
  return { workItemId, phase: state.checkpoint.phase, lifecycleStatus: state.checkpoint.lifecycleStatus,
    revision: state.checkpoint.revision, activeTask: state.checkpoint.activeTask,
    phaseAuthority: phaseAuthority(state.records, state.checkpoint, null, { clock: store.clock }),
    artifacts: state.manifest.artifacts.map(artifact => ({
      ...artifact,
      repositoryId: artifactRepositoryId(artifact, state.manifest),
      artifactId: artifactDocumentId(artifact),
    })),
    pendingDecisions: state.records.filter(record => record.type === 'pending-decision').map(record => ({ id: record.id, kind: record.kind, effect: record.effect })),
    cycle: cycle ? { id: cycle.id, step: cycle.step, candidateDigest: cycle.candidateDigest,
      review: state.records.find(record => record.id === cycle.reviewRef && record.type === 'event' && record.kind === 'review-result')?.effect ?? null,
      tests: cycle.tests.map(test => ({ id: test.id, environment: test.environment,
        checkpoint: test.checkpoint,
        status: currentTestEvidence(cycle, state.records, test, store.clock)?.status ?? 'NotRun',
        detail: currentTestEvidence(cycle, state.records, test, store.clock)?.activity ??
          (test.checkpoint === 'pre-review' ? 'due' : 'awaiting-checkpoint-or-execution') })) } : null,
    conflicts: state.records.filter(r => r.type === 'conflict' && r.status === 'open'),
    operations: state.records.filter(r => r.type === 'operation').map(r => ({ id: r.id, status: r.status, target: r.target, handle: r.handle ?? null })),
    overrides: activeEvents(state.records, { cycleId: cycle?.id, clock: store.clock }).filter(e => e.kind === 'override').map(e => ({ id: e.id, effect: e.effect })),
    pullRequests: state.records.filter(r => r.type === 'pr').map(r => ({ id: r.id, url: r.url, state: r.state, sourceRevision: r.sourceRevision })),
    nextAction: nextAction(state, store.clock) };
}
export async function resume(store, input) {
  object(input, ['cwd', 'sessionId', 'workItemId'], ['cwd', 'sessionId']);
  const resolved = await store.resolve(input.cwd, input.sessionId, input.workItemId);
  const { workItemId, member } = resolved;
  await store.indexBinding(workItemId, member);
  if (!resolved.session || resolved.session.workItemId !== workItemId || resolved.session.bindingKey !== bindingKey(member)) await store.bindSession(input.sessionId, workItemId, member);
  const recoveryToken = await store.beginRecovery(workItemId);
  await store.transaction(workItemId, () => {}, { recoverCheckpoint: true });
  const replay = await replayAudit(store, workItemId, { persist: true, recovery: true });
  await store.transaction(workItemId, tx => {
    const events = tx.all().filter(r => r.type === 'event');
    const sequences = new Map();
    for (const event of events) {
      verifyEvent(event);
      requireThat(!sequences.has(event.sequence) || sequences.get(event.sequence) === event.id, 'SEQUENCE', 'Conflicting local event sequences');
      sequences.set(event.sequence, event.id);
    }
    for (const operation of tx.all().filter(r => r.type === 'operation' && r.status === 'dispatching')) {
      operation.status = 'uncertain'; tx.put(operation);
    }
    return store.fault('recovery-validation');
  }, { allowRecoveryRequired: true });
  let state = await store.load(workItemId);
  const cycle = currentCycle(state.records, state.checkpoint);
  const pendingTestPlans = state.manifest.artifacts.some(artifact =>
    artifact.role === 'test-plan' &&
    (artifact.planned || artifact.digest === 'pending'));
  if (cycle) {
    if (pendingTestPlans) {
      await store.transaction(workItemId, tx => {
        const current = currentCycle(tx.all(), tx.checkpoint);
        current.assuranceInvalidated = true;
        current.pendingPlanSync = true;
        current.step = 'test-plan-materialization-pending';
        current.cause = 'A registered Test Plan is planned but not materialized';
        tx.put(current);
      }, { allowRecoveryRequired: true });
      state = await store.load(workItemId);
    } else {
      const sources = await candidateSnapshot(state.metadata, state.manifest);
      const contentChanged = candidateContentDigest(sources) !== cycle.candidateDigest;
      const specificationChanged = await currentTestSpecification(store, workItemId) !== cycle.testSpecDigest;
      const revisionsChanged = digest(sources) !== digest(cycle.sources);
      if (state.assurancePending || cycle.assuranceInvalidated ||
          contentChanged || specificationChanged || revisionsChanged) {
        await startCycle(store, { workItemId, configDigest: cycle.configDigest,
          cause: state.assurancePending || cycle.assuranceInvalidated ?
            'Candidate assurance requires revalidation after an unverified tool action' :
            'Candidate content or source revision changed during interruption' },
        { allowRecoveryRequired: true });
        state = await store.load(workItemId);
      }
    }
  } else if (state.assurancePending) {
    await store.clearAssurancePending(workItemId);
  }
  if (!pendingTestPlans) {
    await synchronizeTestPlan(store, workItemId, { allowRecoveryRequired: true });
  }
  state = await store.load(workItemId);
  let token;
  await updateJson(store.sessionPath(input.sessionId), {}, async session => {
    token = await orientationToken(store, workItemId, member, session, state);
    session.resumeToken = token;
    return session;
  });
  const reconciliation = state.records.filter(r => r.type === 'operation' && !TERMINAL.includes(r.status)).map(r => ({
    operationId: r.id, status: r.status, target: r.target, correlationKey: r.correlationKey,
    handle: r.handle ?? null, action: r.status === 'prepared' ? 'Review and dispatch only if still authorized' : 'Query provider read-only; never assume a missing response means no effect',
  }));
  const summary = { workItemId, phase: state.checkpoint.phase, nextAction: nextAction(state, store.clock),
    orientationToken: token, artifacts: state.manifest.artifacts.map(artifact => ({
      role: artifact.role,
      repositoryId: artifactRepositoryId(artifact, state.manifest),
      artifactId: artifactDocumentId(artifact),
      locator: artifactLocator(artifact, state.manifest),
      digest: artifact.digest,
      ...(artifact.planned ? { planned: true } : {}),
    })),
    pendingOperations: reconciliation.length, detailCommand: `sdlc status --work-item ${workItemId}` };
  const result = { ...summary, reconciliation: { count: reconciliation.length,
    instruction: 'Read operation IDs in status; use op show for target, time and correlation key, then query the provider read-only before any retry.' },
    historyGaps: replay.gaps.length,
    limits: 'Only recorded authority is recovered. Missing operation evidence does not prove nothing was dispatched.' };
  if (byteSize(result) > LIMITS.context) {
    result.artifacts = state.manifest.artifacts.map(artifact => ({
      role: artifact.role,
      repositoryId: artifactRepositoryId(artifact, state.manifest),
      artifactId: artifactDocumentId(artifact),
      state: artifact.digest === 'pending' ? 'pending' : 'materialized',
      ...(artifact.planned ? { planned: true } : {}),
    }));
    if (result.reconciliation.count === 0) delete result.reconciliation;
    result.limits = 'Recorded authority only; missing evidence is not proof of no dispatch.';
    result.detailNotice = 'Use the detail command for full digests and operation metadata.';
  }
  if (byteSize(result) > LIMITS.context) {
    const inventory = state.manifest.artifacts.map(artifact => ({
      role: artifact.role,
      repositoryId: artifactRepositoryId(artifact, state.manifest),
      artifactId: artifactDocumentId(artifact),
      locator: artifactLocator(artifact, state.manifest),
      digest: artifact.digest,
    }));
    delete result.artifacts;
    result.artifactSummary = {
      count: inventory.length,
      pending: inventory.filter(artifact => artifact.digest === 'pending').length,
      byRole: Object.fromEntries(['requirements', 'test-plan', 'technical-design']
        .map(role => [role, inventory.filter(artifact => artifact.role === role).length])),
      inventoryDigest: digest(inventory),
    };
    result.detailNotice = 'Artifact inventory is grouped; use the detail command for every identity, locator and digest.';
  }
  budget(result, LIMITS.context, 'Orientation summary');
  await store.completeRecovery(workItemId, recoveryToken);
  return result;
}
export async function acknowledgeContext(store, input) {
  object(input, ['cwd', 'sessionId', 'workItemId', 'token'], ['cwd', 'sessionId', 'token']);
  const { workItemId, member } = await store.resolve(input.cwd, input.sessionId, input.workItemId);
  return store.transaction(workItemId, async tx => updateJson(store.sessionPath(input.sessionId), {}, async session => {
    const token = await orientationToken(store, workItemId, member, session, { ...tx, records: tx.all() });
    requireThat(input.token === token && session.resumeToken === token, 'STALE', 'Orientation token is stale or was not returned by resume in this session');
    session.acknowledgedToken = token;
    return session;
  }));
}
