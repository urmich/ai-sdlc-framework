import { fingerprint, now, requireThat } from './core.mjs';
import { canonicalPath, readJson } from './files.mjs';
import { captureReceipt } from './decisions.mjs';
import { classifyTool, isReadOnlyHook, normalizeCommandHook,
  normalizeHook } from './gate.mjs';
import { pruneWork, recordOperation } from './operations.mjs';
import { currentCycle } from './authority.mjs';
import { invalidateCycleAssurance, invalidateEnvironmentAssurance, startCycle } from './validation.mjs';
import { loadConfig } from './artifacts.mjs';
import { resolveActionEnvironment } from './policy.mjs';

export async function handleHook(store, event, payload) {
  const rawNormalized = normalizeHook(payload);
  const sessionId = rawNormalized.sessionId;
  requireThat(sessionId, 'HOOK', 'Hook payload needs a session ID');
  let preloadedSession;
  let assuranceToken;
  if (['postToolUse', 'postToolUseFailure'].includes(event) &&
      rawNormalized.toolName !== 'ask_user') {
    preloadedSession = await readJson(store.sessionPath(sessionId), { optional: true });
    if (preloadedSession?.workItemId) {
      assuranceToken = await store.markAssurancePending(preloadedSession.workItemId,
        `Recheck candidate after ${event}:${rawNormalized.toolName ?? 'unknown-tool'}`);
    }
  }
  let normalized;
  try {
    normalized = await normalizeCommandHook(rawNormalized);
  } catch (error) {
    if (preloadedSession?.workItemId) {
      try {
        await invalidateEnvironmentAssurance(store, preloadedSession.workItemId,
          ['DEV', 'STAGING'],
          `Shell normalization failed after tool execution (${error.code ?? 'ERROR'})`);
      } catch {
        await store.markAssurancePending(preloadedSession.workItemId,
          `Shell normalization and environment invalidation failed (${error.code ?? 'ERROR'})`,
          { forceNewCycle: true });
      }
    }
    throw error;
  }
  if (['sessionStart', 'preCompact', 'sessionEnd'].includes(event)) {
    await store.invalidateSession(sessionId, event);
    if (event === 'sessionStart') return { additionalContext: 'AI SDLC lifecycle stages are advisory: classify the request and honor an explicit user stage override after at most one warning. For managed assurance on existing development, run sdlc resume, read relevant artifacts and acknowledge the orientation token. Other framework findings make actions unmanaged/uncredited but never block the tool; actual enforcement remains with Copilot and host/external controls. Reported pipeline monitoring alone needs no development work item.' };
    return {};
  }
  if (event === 'userPromptSubmitted') {
    const prompt = normalized.prompt;
    requireThat(typeof prompt === 'string', 'HOOK', 'userPromptSubmitted requires the actual user prompt');
    const timestamp = typeof normalized.timestamp === 'number' ?
      new Date(normalized.timestamp).toISOString() :
      normalized.timestamp ?? now(store.clock);
    await captureReceipt(store, { sessionId, source: 'userPromptSubmitted', input: prompt, timestamp });
    return {};
  }
  if (event === 'postToolUse' && normalized.toolName === 'ask_user') {
    const result = normalized.toolResult?.textResultForLlm ?? normalized.toolResult?.text_result_for_llm;
    requireThat(typeof result === 'string', 'HOOK', 'Unsupported ask_user response payload; use a plain user prompt instead');
    await captureReceipt(store, { sessionId, source: 'ask_user', input: result });
    return {};
  }
  if (!['postToolUse', 'postToolUseFailure', 'agentStop'].includes(event)) return {};
  const session = preloadedSession ??
    await readJson(store.sessionPath(sessionId), { optional: true });
  if (!session?.workItemId) return {};
  if (event === 'agentStop') { await pruneWork(store, session.workItemId); return {}; }
  assuranceToken ??= await store.markAssurancePending(session.workItemId,
    `Recheck candidate after ${event}:${normalized.toolName ?? 'unknown-tool'}`);
  let state;
  try {
    state = await store.load(session.workItemId);
  } catch (error) {
    await store.markAssurancePending(session.workItemId,
      `Candidate verification could not load framework state (${error.code ?? 'ERROR'})`,
      { forceNewCycle: true });
    throw error;
  }
  const requestFingerprint = fingerprint(rawNormalized.toolName, rawNormalized.toolArgs,
    await canonicalPath(rawNormalized.cwd));
  const operation = state.records.find(r => r.type === 'operation' &&
    r.requestFingerprint === requestFingerprint &&
    r.sessionId === sessionId &&
    r.status === 'dispatching' &&
    r.dispatchBound === true &&
    !session.unmanagedFingerprintOverflow &&
    !session.unmanagedRequestFingerprints?.includes(requestFingerprint));
  if (operation) {
    await recordOperation(store, {
      workItemId: session.workItemId,
      operationId: operation.id,
      status: 'uncertain',
    });
  }
  if (['postToolUse', 'postToolUseFailure'].includes(event)) {
    const cycle = currentCycle(state.records, state.checkpoint);
    if (cycle) {
      const member = state.metadata.members.find(item => item.repositoryId === session.repositoryId);
      if (member) {
        let cause = 'Observed tool completion; rechecked candidate and Test Plan identity';
        let actions = [];
        let unknownEnvironmentRisk = false;
        try {
          const configuration = await loadConfig(state.metadata,
            member.repositoryId);
          const classified = await classifyTool(store, normalized, state,
            member, configuration);
          const resolutions = classified.map(action =>
            resolveActionEnvironment(action, configuration));
          actions = resolutions.map(resolution => resolution.action);
          if (resolutions.some(resolution => !resolution.resolved)) {
            unknownEnvironmentRisk = true;
          }
          if (actions.some(action => ['code', 'configuration', 'document'].includes(action.class))) {
            cause = 'Observed implementation/test/configuration mutation';
          } else if (actions.some(action => action.class === 'unknown')) {
            cause = 'Observed unmanaged tool action; conservatively rechecked candidate identity';
            unknownEnvironmentRisk = true;
          }
        } catch (error) {
          cause = `Tool classification was unavailable (${error.code ?? 'ERROR'}); conservatively rechecked candidate identity`;
          unknownEnvironmentRisk = !isReadOnlyHook(normalized);
        }
        const environmentUncertainty = unknownEnvironmentRisk ? ['DEV', 'STAGING'] :
          actions.flatMap(action =>
          action.class === 'deploy' || action.class === 'pipeline' ||
          action.implicitEnvironments?.length ?
            [action.environment, ...(action.stages ?? []),
              ...(action.implicitEnvironments ?? [])].filter(Boolean) : []);
        if (environmentUncertainty.length &&
            (!operation?.environmentBoundaryApplied ||
              unknownEnvironmentRisk)) {
          try {
            await invalidateEnvironmentAssurance(store, session.workItemId,
              environmentUncertainty,
              'Observed deployment-capable tool action without attempt-specific result identity');
          } catch (error) {
            await store.markAssurancePending(session.workItemId,
              `Environment invalidation failed (${error.code ?? 'ERROR'})`,
              { forceNewCycle: true });
            throw error;
          }
        }
        let result;
        try {
          result = await startCycle(store, { workItemId: session.workItemId,
            configDigest: cycle.configDigest, cause, assuranceToken });
        } catch (error) {
          await invalidateCycleAssurance(store, session.workItemId,
            `Candidate verification failed after tool execution (${error.code ?? 'ERROR'})`);
          return { additionalContext: 'AI SDLC could not re-derive the candidate or Test Plan after the tool action. Previous tests, artifacts, deployments and /review are now historical/unverified. Repair the artifacts and start a new validation cycle; the completed tool action was not blocked.' };
        }
        if (result.reset) return { additionalContext: 'Candidate or Test Plan changed: current tests reset to NotRun and prior /review evidence is stale. Run the full local unit suite first, then remaining local tests and /review. No remote pipelines were queued.' };
      }
    } else {
      await store.clearAssurancePending(session.workItemId, assuranceToken);
    }
  }
  return {};
}
