import { PHASES, object, choice, requireThat, strings, text } from './core.mjs';
import { activeEvents, applicableOverride, assurancePending, currentCycle, hasEnvironmentGrant, hasStagingCompletion, hasStageCompletion, matchesScope, permissionMatches, phaseAuthority, reviewPassed, stagePassed } from './authority.mjs';
import { evaluateReadiness, publicationAuthority } from './pr.mjs';
import { checkTestStart } from './validation.mjs';
import { effectiveStagingExecution, stagingExecutionMatches } from './staging.mjs';

export const ACTIONS = ['read', 'bookkeeping', 'document', 'configuration', 'code', 'local-build', 'test', 'push', 'build', 'deploy',
  'pipeline', 'pr-create', 'pr-update', 'pr-validation', 'merge', 'auto-merge', 'policy-bypass', 'destructive', 'unknown', 'recommend-staging', 'recommend-prod'];
const CANONICAL_ENVIRONMENTS = ['DEV', 'STAGING', 'PROD'];
const ENVIRONMENT_ACTIONS = new Set(['build', 'deploy', 'pipeline',
  'pr-validation']);
export function validateAction(action) {
  object(action, ['class', 'repositoryId', 'paths', 'environment', 'target', 'configDigest', 'stages', 'itemId', 'outOfScope',
    'testId', 'owner', 'host', 'operationId', 'sourceRef', 'targetRef', 'draft', 'sourceRevision', 'targetRevision',
    'policyVersion', 'prRecordId', 'artifactId', 'externalPermission', 'monitorCapability', 'implicitEnvironments', 'preservesChanges',
    'earlyDraft', 'baseRef', 'remoteUrlDigest', 'force', 'delete', 'deploymentId',
    'provider', 'pipeline'],
  ['class']);
  choice(action.class, ACTIONS, 'operation class');
  for (const key of ['paths', 'stages', 'implicitEnvironments']) if (action[key]) strings(action[key], key);
  if (action.environment) choice(action.environment, ['local', 'DEV', 'STAGING', 'PROD'], 'target environment');
  for (const field of ['provider', 'pipeline']) {
    if (action[field]) text(action[field], field);
  }
  if (action.earlyDraft !== undefined) requireThat(action.earlyDraft === true && action.draft === true,
    'INPUT', 'earlyDraft must explicitly identify draft publication');
  if (action.earlyDraft) {
    for (const field of ['sourceRevision', 'targetRevision']) requireThat(
      typeof action[field] === 'string' && /^[a-f0-9]{40,64}$/u.test(action[field]),
      'INPUT', `earlyDraft requires a full ${field}`);
    if (action.class === 'push') requireThat(typeof action.baseRef === 'string' &&
      /^refs\/heads\/[A-Za-z0-9._/-]+$/u.test(action.baseRef) && !action.baseRef.includes('..') &&
      !action.baseRef.endsWith('/'), 'INPUT', 'earlyDraft push requires a literal intended PR baseRef');
  }
  if (action.remoteUrlDigest) requireThat(/^[a-f0-9]{64}$/u.test(action.remoteUrlDigest), 'INPUT', 'Invalid remote URL digest');
  for (const field of ['force', 'delete']) if (action[field] !== undefined) requireThat(typeof action[field] === 'boolean', 'INPUT', `${field} must be boolean`);
  return action;
}
export function effectiveEnvironments(action) {
  return new Set([action.environment, ...(action.implicitEnvironments ?? []), ...(action.stages ?? [])]
    .filter(environment => CANONICAL_ENVIRONMENTS.includes(environment)));
}
function mappingMatches(mapping, action, label) {
  return mapping.label === label &&
    mapping.provider === action.provider &&
    mapping.pipeline === action.pipeline &&
    mapping.target === action.target &&
    mapping.configDigest === action.configDigest;
}
export function resolveActionEnvironment(action, configuration = {}) {
  const environments = new Set();
  const unresolvedImplicit = [];
  if (CANONICAL_ENVIRONMENTS.includes(action.environment)) {
    environments.add(action.environment);
  }
  const mappings = configuration.environmentMappings ?? [];
  for (const label of action.implicitEnvironments ?? []) {
    if (CANONICAL_ENVIRONMENTS.includes(label)) {
      environments.add(label);
      continue;
    }
    const matches = mappings.filter(mapping =>
      mappingMatches(mapping, action, label));
    if (!matches.length) {
      unresolvedImplicit.push(label);
      continue;
    }
    for (const mapping of matches) {
      environments.add(mapping.environment);
    }
  }
  for (const stage of action.stages ?? []) {
    if (CANONICAL_ENVIRONMENTS.includes(stage)) {
      environments.add(stage);
      continue;
    }
    for (const mapping of mappings.filter(mapping =>
      mappingMatches(mapping, action, stage))) {
      environments.add(mapping.environment);
    }
  }
  const required = ENVIRONMENT_ACTIONS.has(action.class) ||
    (action.class === 'test' && action.environment !== 'local');
  const reasons = [];
  if (unresolvedImplicit.length) {
    reasons.push(`Unmapped implicit environment labels: ${unresolvedImplicit.join(', ')}`);
  }
  if (required && environments.size === 0) {
    reasons.push('Deployment-capable operation has no resolved DEV, STAGING, or PROD environment');
  }
  if (environments.size > 1) {
    reasons.push(`Operation resolves to conflicting environments: ${[...environments].sort().join(', ')}`);
  }
  if (required && action.environment === 'local') {
    reasons.push('Deployment-capable operation cannot use the local environment');
  }
  const resolved = reasons.length === 0 && (!required || environments.size === 1);
  const normalized = { ...action };
  if (environments.size === 1) {
    normalized.environment = [...environments][0];
  }
  return {
    action: normalized,
    resolved,
    required,
    environments,
    reason: reasons.join('; '),
  };
}
export function evaluatePolicy(state, action, {
  clock = Date,
  configuration = {},
  environmentResolution,
} = {}) {
  validateAction(action);
  const resolution = environmentResolution ??
    resolveActionEnvironment(action, configuration);
  action = resolution.action;
  const records = state.records ?? state.all();
  const checkpoint = state.checkpoint;
  const cycle = currentCycle(records, checkpoint);
  const context = { cycleId: cycle?.id, clock };
  const findings = [];
  function rule(name, met, reason, external = false) {
    if (met) return;
    const override = external ? null : applicableOverride(records, name, action, context);
    findings.push({ rule: name, verdict: override ? 'authorized-deviation' : 'violation', reason, ...(override ? { eventId: override.id } : {}) });
  }
  if (['read', 'bookkeeping'].includes(action.class)) {
    return { allowed: true, findings, action };
  }
  for (const conflict of configuration.detectedConflicts ?? []) {
    if (action.environment === conflict.environment || (conflict.environment === 'PROD' && action.class === 'recommend-prod')) {
      rule(conflict.rule, false, conflict.reason);
    }
  }
  rule('active-work', checkpoint.lifecycleStatus === 'active', 'Work item is paused or completed');
  rule('cycle-assurance', !assurancePending(cycle, records),
    'Candidate assurance was invalidated; start a new validation cycle before managed credit');
  rule('supported-operation', action.class !== 'unknown', 'Unsupported executable form; use an explicit adapter or narrowly scoped override');
  if (resolution.required || resolution.reason) {
    rule('environment-resolution', resolution.resolved,
      resolution.reason || 'Operation environment is unresolved',
      true);
  }
  const earlyDraft = action.earlyDraft === true && ['push', 'pr-create', 'pr-update'].includes(action.class) &&
    action.draft === true && action.paths?.length > 0 && action.paths.every(file =>
      file.startsWith('.sdlc/work-items/') || state.manifest.artifacts.some(artifact =>
        artifact.kind === 'git' && artifact.repositoryId === action.repositoryId && artifact.path === file));
  if (action.earlyDraft) rule('early-draft-documents', earlyDraft,
    'Early draft publication must contain only registered documents/framework manifest paths');
  if (earlyDraft && action.class === 'push') {
    rule('pr-publication', Boolean(publicationAuthority(records, {
      ...action, targetRef: action.baseRef,
    }, clock, { cycleId: cycle?.id })), 'Early draft push authority must match the intended PR source/base/draft');
  }
  const candidateRemoteAction = (
    ['push', 'pr-create', 'pr-update'].includes(action.class) ||
    (['build', 'deploy', 'pipeline', 'pr-validation', 'test'].includes(action.class) && action.environment !== 'local')
  ) && !earlyDraft;
  if (candidateRemoteAction) {
    rule('local-validation', stagePassed(cycle, records, 'local', clock), 'Current pre-Review local validation has not passed');
    rule('candidate-review', reviewPassed(cycle, records, clock), 'Current candidate has no active passing GitHub Copilot CLI /review evidence');
    rule('review-completion', hasStageCompletion(records, cycle, 'review', clock), 'User confirmation of current candidate Review completion is missing');
  }
  if (['code', 'local-build', 'test', 'build', 'deploy', 'pipeline'].includes(action.class)) {
    rule('phase', checkpoint.phase === 'coding' && phaseAuthority(records, checkpoint, action, context).active,
      'Coding authority is absent, revoked, expired or outside the granted scope');
  }
  if (action.class === 'document') {
    const roles = (action.paths ?? []).map(file => state.manifest.artifacts.find(a =>
      (a.kind === 'git' && a.path === file && a.repositoryId === action.repositoryId) ||
      (a.kind === 'external-file' &&
        (a.repositoryId ?? state.manifest.coordinatorId) === action.repositoryId &&
        records.some(record => record.type === 'locator' &&
          record.id === a.locatorId && record.path === file)))?.role);
    rule('artifact-role', roles.length > 0 && roles.every(role => role && PHASES.indexOf(checkpoint.phase) >= ['requirements', 'test-plan', 'technical-design'].indexOf(role)),
      'Only registered documents from the current or earlier phase may be maintained');
  }
  for (const conflict of records.filter(record => record.type === 'conflict' && record.status === 'open')) {
    const scopeEvent = { effect: { scope: conflict.scope } };
    if (matchesScope(scopeEvent, action)) rule(`conflict:${conflict.id}`, false, conflict.reason);
  }
  if (action.outOfScope) {
    const scopedInclusion = activeEvents(records, context).some(r =>
      r.kind === 'scope-inclusion' &&
      r.effect.itemId === action.itemId &&
      matchesScope(r, action, records));
    const kind = action.class === 'document' ? 'out-of-scope-documentation' : 'out-of-scope-execution';
    rule(kind, scopedInclusion || activeEvents(records, context).some(e => e.kind === kind && e.effect.itemId === action.itemId && matchesScope(e, action, records)),
      'Out-of-scope execution and documentation need separate explicit authority; scope classification remains unchanged');
  }
  const permission = grant => activeEvents(records, context).some(event => permissionMatches(event, grant, action, records));
  for (const operation of ['push', 'merge', 'auto-merge', 'policy-bypass']) if (action.class === operation) rule(operation, permission(operation), `Explicit ${operation} authority is absent`);
  if (action.class === 'push') {
    rule('force-push', action.force !== true, 'Force push requires an explicit scoped override');
    rule('remote-ref-delete', action.delete !== true, 'Deleting a remote ref requires an explicit scoped override');
  }
  if (action.externalPermission === false) rule('external-permission', false, 'External access/policy denies this action; a framework override cannot grant access', true);
  if (action.class === 'destructive') rule('protect-existing-changes', action.preservesChanges === true, 'Destructive operation requires explicit preservation/handoff of existing changes');
  if (['pr-create', 'pr-update'].includes(action.class)) rule('pr-publication',
    Boolean(publicationAuthority(records, action, clock, { cycleId: cycle?.id })),
    'Publication authority does not match source/target/draft intent or remaining scoped lifetime');
  const environments = effectiveEnvironments(action);
  for (const environment of environments) {
    const config = configuration.environments?.[environment];
    if (action.stages) {
      rule('allowed-stages',
        Boolean(config && action.stages.every(stage =>
          config.allowedStages?.includes(stage))),
      'Pipeline may run unauthorized stages');
    }
    if (['build', 'deploy', 'pipeline'].includes(action.class)) {
      const readiness = evaluateReadiness(records, {
        environment,
        repositoryId: action.repositoryId,
        policy: config?.pr ?? {},
        prRecordId: action.prRecordId,
        sourceRevision: action.sourceRevision,
        targetRevision: action.targetRevision,
        policyVersion: action.policyVersion,
      }, { clock });
      rule('pr-readiness', readiness.ready, readiness.gaps.join('; '));
      if (config?.pr?.required || config?.pr?.validation ||
          environment === 'PROD') {
        const source = cycle?.sources.find(candidate =>
          candidate.repositoryId === action.repositoryId);
        const facts = records.find(record =>
          record.type === 'pr-facts' &&
          record.prRecordId === action.prRecordId);
        const candidateMatches = source?.revision &&
          (source.revision === action.sourceRevision ||
            (facts?.mergeContext?.mergeRevision === source.revision &&
              facts.mergeContext.sourceRevision === action.sourceRevision));
        rule('pr-candidate-provenance', Boolean(candidateMatches),
          'PR validation source/merge context must match the actual delivery candidate');
      }
    }
    if (environment === 'PROD') {
      if (action.class !== 'recommend-prod') {
        rule('prod-execution', permission('prod-execution'), 'PROD is recommendation-only without a separate explicit production instruction');
        rule('configured-target', Boolean(config && config.target === action.target && config.configDigest === action.configDigest),
          'Explicit production execution still requires the configured production target and configuration');
      }
      continue;
    }
    if (['recommend-staging', 'recommend-prod'].includes(action.class)) continue;
    const grant = hasEnvironmentGrant(records, cycle, environment, action, clock);
    rule(`${environment.toLowerCase()}-authorization`, Boolean(grant), `Current candidate/cycle/target ${environment} authorization is missing`);
    rule('local-validation', stagePassed(cycle, records, 'local', clock), 'Required unit-first local validation has not passed');
    if (environment === 'STAGING') {
      rule('dev-validation', stagePassed(cycle, records, 'DEV', clock), 'Current DEV tests must pass before STAGING');
      rule('dev-completion', hasStageCompletion(records, cycle, 'DEV', clock), 'User-confirmed DEV completion is missing');
    }
    rule('configured-target', Boolean(config && config.target === action.target && config.configDigest === action.configDigest),
      'Target/configuration is not the selected environment contract');
  }
  if (action.class === 'deploy' && action.environment !== 'PROD') {
    const artifact = records.find(r => r.id === cycle?.artifacts[action.environment]);
    rule('artifact-provenance', Boolean(artifact && artifact.artifactId === action.artifactId && artifact.sourceDigest === cycle.candidateDigest && artifact.environment === action.environment),
      'A successful matching deployable artifact is required; green PR validation alone is insufficient');
  }
  if (action.class === 'test') {
    const test = cycle?.tests.find(t => t.id === action.testId);
    rule('test-specification', Boolean(test), 'Declare the test in the current validation cycle');
    if (test) {
      rule('test-target', test.environment === action.environment, 'Execution environment differs from the Test Plan');
      if (test.environment === 'STAGING') {
        const execution = effectiveStagingExecution(records, cycle,
          configuration, { action, clock });
        rule('staging-execution-policy', execution.resolved,
          execution.reason ?? 'STAGING execution policy is unresolved', true);
        rule('staging-execution-contract',
          stagingExecutionMatches(execution, action.owner, action.host) &&
            (execution.overrideId ||
              (test.owner === action.owner &&
                test.location === action.host)),
        'STAGING execution owner/location differs from its environment contract or Test Plan');
        if (execution.resolved && execution.owner === 'user') {
          rule('staging-user-handoff', false,
            'User-owned STAGING tests require handoff rather than agent dispatch');
        }
        const deployment = records.find(r =>
          r.id === cycle.deployments.STAGING);
        rule('deployment-before-test',
          deployment?.status === 'succeeded' &&
            deployment.id === action.deploymentId &&
            deployment.artifactId === action.artifactId &&
            deployment.target === action.target,
        'STAGING testing requires the actual current successful deployment and artifact');
      } else {
        rule('test-owner',
          test.owner === action.owner && test.location === action.host,
        'Execution owner or authorized host differs from the plan');
      }
      try { checkTestStart(cycle, records, test); }
      catch (error) { if (error.code !== 'UNIT_FIRST') throw error; rule('unit-first', false, error.message); }
      if (test.environment === 'DEV') {
        const deployment = records.find(r => r.id === cycle.deployments.DEV);
        rule('deployment-before-test', deployment?.status === 'succeeded' &&
          deployment.id === action.deploymentId && deployment.artifactId === action.artifactId,
        'DEV testing requires the actual current successful deployment and artifact');
      }
    }
  }
  if (['build', 'deploy', 'pipeline', 'pr-validation'].includes(action.class) && action.environment !== 'local') {
    rule('monitor-capability', action.monitorCapability === true, 'Verify scheduler and provider read capabilities before triggering a pipeline');
  }
  if (action.class === 'recommend-staging') rule('dev-completion', hasStageCompletion(records, cycle, 'DEV', clock), 'Confirm current DEV completion before recommending STAGING');
  if (action.class === 'recommend-prod') {
    rule('staging-completion', hasStagingCompletion(records, cycle, clock), 'Current deployment-bound user-confirmed STAGING success is missing');
    const readiness = evaluateReadiness(records, { environment: 'PROD', policy: configuration.environments?.PROD?.pr ?? {},
      repositoryId: action.repositoryId,
      prRecordId: action.prRecordId, sourceRevision: action.sourceRevision, targetRevision: action.targetRevision, policyVersion: action.policyVersion }, { clock });
    rule('prod-pr-readiness', readiness.ready, `Resolve PR prerequisites before presenting PROD as ready: ${readiness.gaps.join('; ')}`);
  }
  return {
    allowed: !findings.some(f => f.verdict === 'violation'),
    findings,
    action,
  };
}
