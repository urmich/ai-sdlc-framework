import { choice, digest, now, object, requireThat, strings, text } from './core.mjs';
import { activeEvents, currentCycle, matchesScope } from './authority.mjs';
import { validateBinding } from './git.mjs';
import { monitorAssociationKey, readActiveMonitor, readMonitorAssociation,
  runKey as monitorRunKey, withMonitorLocks } from './monitors.mjs';
import { sameExecutionIdentity, validateExecutionIdentity } from './provider-adapters.mjs';

export function validatePrIdentity(pr) {
  for (const field of ['provider', 'connection', 'repositoryId', 'sourceRef', 'targetRef', 'sourceRevision', 'targetRevision']) text(pr[field], field);
  for (const field of ['sourceRef', 'targetRef']) requireThat(pr[field].startsWith('refs/heads/'), 'INPUT', 'PR branch must be a full refs/heads/ reference');
  requireThat(pr.sourceRef !== pr.targetRef, 'INPUT', 'PR source and target must differ');
  requireThat(typeof pr.draft === 'boolean', 'INPUT', 'PR draft intent must be explicit');
}
export function prMatches(left, right) {
  return ['provider', 'connection', 'repositoryId', 'sourceRef', 'targetRef', 'sourceRevision'].every(key => left[key] === right[key]);
}
export function publicationAuthority(records, pr, clock = Date, { cycleId, allowUnreservedOnce = false } = {}) {
  const action = { class: pr.class ?? 'pr-create', repositoryId: pr.repositoryId,
    sourceRef: pr.sourceRef, targetRef: pr.targetRef, draft: pr.draft };
  for (const field of ['operationId', 'paths', 'itemId', 'outOfScope', 'environment', 'target']) {
    if (pr[field] !== undefined) action[field] = pr[field];
  }
  return activeEvents(records, { clock, cycleId }).find(event => {
    if (event.kind !== 'pr-publication' || event.effect.repositoryId !== pr.repositoryId ||
      event.effect.sourceRef !== pr.sourceRef || event.effect.targetRef !== pr.targetRef ||
      event.effect.draft !== pr.draft) return false;
    if (event.effect.lifetime?.kind === 'once' && !action.operationId) {
      if (!allowUnreservedOnce || records.some(record => record.type === 'reservation' && record.eventId === event.id)) return false;
      action.operationId = `unreserved-${event.id}`;
    }
    return matchesScope(event, action, records);
  });
}
export async function preparePr(store, input) {
  object(input, ['workItemId', 'provider', 'connection', 'repositoryId', 'sourceRef', 'targetRef', 'sourceRevision',
    'targetRevision', 'remoteSourceRevision', 'draft', 'scope', 'matches'], ['workItemId', 'remoteSourceRevision', 'matches']);
  validatePrIdentity(input);
  requireThat(Array.isArray(input.matches), 'INPUT', 'Supply the provider search result, including an empty list when no PR exists');
  return store.transaction(input.workItemId, async tx => {
    const member = tx.metadata.members.find(m => m.repositoryId === input.repositoryId);
    requireThat(member?.branch === input.sourceRef, 'BINDING', 'PR source differs from the bound member');
    requireThat((await validateBinding(member)).head === input.sourceRevision, 'EVIDENCE', 'PR source revision does not match the actual committed member HEAD');
    requireThat(input.remoteSourceRevision === input.sourceRevision, 'EVIDENCE', 'Commit/push the authorized candidate before publishing a PR');
    requireThat(publicationAuthority(tx.all(), input, store.clock, {
      cycleId: currentCycle(tx.all(), tx.checkpoint)?.id, allowUnreservedOnce: true,
    }), 'AUTHORITY', 'PR prerequisite is not publication consent; request the missing authority once');
    const existing = tx.all().find(r => r.type === 'pr-intent' && prMatches(r, input));
    if (existing) return { intent: existing, action: existing.status === 'recorded' ? 'reuse' : 'reconcile-before-create' };
    const matches = input.matches.filter(pr => prMatches(pr, input) && pr.state === 'active');
    requireThat(matches.length <= 1, 'CONFLICT', 'Multiple appropriate PRs; resolve ambiguity instead of creating another');
    if (matches.length === 1) {
      const pr = normalizedPr(input.workItemId, matches[0]);
      requireThat(pr.draft === input.draft, 'CONFLICT', 'Existing PR draft/ready state differs from requested intent');
      tx.put(pr);
      return { pr, action: 'reuse' };
    }
    const { matches: ignored, remoteSourceRevision, ...identity } = input;
    const intent = { ...identity, id: `pr-intent-${digest(identity).slice(0, 40)}`, type: 'pr-intent', status: 'prepared', createdAt: now(store.clock) };
    tx.put(intent);
    return { intent, action: 'prepare-operation', nextAction: 'Prepare and bind a pr-create operation before invoking the provider. Do not retry an uncertain create.' };
  });
}
function normalizedPr(workItemId, input) {
  object(input, ['provider', 'connection', 'repositoryId', 'sourceRef', 'targetRef', 'sourceRevision', 'targetRevision', 'draft',
    'prId', 'url', 'state', 'evidenceRef', 'autoMerge', 'scope', 'mergeRevision'], ['prId', 'url', 'state', 'evidenceRef']);
  validatePrIdentity(input);
  text(input.prId, 'PR ID'); text(input.evidenceRef, 'provider evidence');
  const url = new URL(input.url);
  requireThat(url.protocol === 'https:' && !url.username && !url.password && !/\/(?:login|signin)(?:\/|$)/iu.test(url.pathname), 'INPUT', 'Provide the actual credential-free PR web URL');
  choice(input.state, ['active', 'merged', 'closed'], 'PR state');
  return { ...input, id: `pr-${digest({ provider: input.provider, connection: input.connection, repositoryId: input.repositoryId, prId: input.prId }).slice(0, 40)}`, type: 'pr', workItemId };
}
export async function adoptPr(store, input) {
  object(input, ['workItemId', 'pr', 'intentId', 'operationId'], ['workItemId', 'pr']);
  return store.transaction(input.workItemId, tx => {
    const pr = normalizedPr(input.workItemId, input.pr);
    requireThat(tx.metadata.members.some(m => m.repositoryId === pr.repositoryId), 'BINDING', 'PR is outside the work item');
    const previousPr = tx.get(pr.id);
    if (previousPr?.type === 'pr' &&
        (previousPr.sourceRevision !== pr.sourceRevision ||
          previousPr.targetRevision !== pr.targetRevision ||
          previousPr.sourceRef !== pr.sourceRef ||
          previousPr.targetRef !== pr.targetRef ||
          previousPr.draft !== pr.draft ||
          previousPr.state !== pr.state)) {
      tx.remove(`facts-${pr.id}`);
    }
    if (input.intentId) {
      const intent = tx.get(input.intentId);
      requireThat(intent?.type === 'pr-intent' && prMatches(intent, pr) && intent.draft === pr.draft, 'EVIDENCE', 'PR result differs from publication intent');
      const operation = tx.get(input.operationId);
      requireThat(operation?.class === 'pr-create' && ['submitted', 'running', 'succeeded'].includes(operation.status), 'OPERATION', 'Record a matching dispatched PR operation result first');
      requireThat(operation.repositoryId === pr.repositoryId && operation.action.sourceRef === pr.sourceRef &&
        operation.action.targetRef === pr.targetRef && operation.handle === pr.prId, 'EVIDENCE', 'PR identity does not match its dispatched publication operation');
      intent.status = 'recorded'; intent.prRecordId = pr.id; tx.put(intent);
    }
    tx.put(pr);
    return { pr, authority: 'observation-only; adoption grants no publish, merge or deployment permission',
      warning: pr.autoMerge ? 'Existing PR has auto-merge enabled; surface this side effect, do not assume it is authorized.' : null };
  });
}
export async function updatePrFacts(store, input) {
  object(input, ['workItemId', 'prRecordId', 'policyVersion', 'sourceRevision', 'targetRevision', 'requiredChecks',
    'checks', 'reviewsSatisfied', 'merged', 'providerEvidenceRef', 'mergeContext', 'runMonitorRefs'],
  ['workItemId', 'prRecordId', 'policyVersion', 'sourceRevision', 'targetRevision', 'requiredChecks', 'checks', 'providerEvidenceRef']);
  strings(input.requiredChecks, 'required checks', 30);
  requireThat(Array.isArray(input.checks) && input.checks.length <= 30, 'INPUT', 'Invalid check facts');
  for (const check of input.checks) {
    object(check, ['id', 'status', 'sourceRevision', 'targetRevision', 'mergeRevision', 'evidenceRef', 'runKey',
      'identity'], ['id', 'status', 'evidenceRef']);
    choice(check.status, ['succeeded', 'failed', 'pending', 'cancelled', 'missing'], 'check status');
    text(check.id, 'check identity'); text(check.evidenceRef, 'check evidence');
    if (check.runKey) {
      text(check.runKey, 'check monitor identity');
      check.identity = validateExecutionIdentity(check.identity);
      requireThat(check.runKey === monitorRunKey(check.identity),
        'EVIDENCE',
        'Check runKey does not match its provider execution identity');
    }
  }
  requireThat(new Set(input.checks.map(c => c.id)).size === input.checks.length, 'INPUT', 'Duplicate check identities');
  if (input.mergeContext) object(input.mergeContext, ['sourceRevision', 'targetRevision', 'mergeRevision', 'evidenceRef'],
    ['sourceRevision', 'targetRevision', 'mergeRevision', 'evidenceRef']);
  if (input.runMonitorRefs) strings(input.runMonitorRefs, 'run monitor references', 30);
  return withMonitorLocks(store,
    input.checks.flatMap(check => check.runKey ? [check.runKey] : []),
    async () => {
      const state = await store.load(input.workItemId);
      const observedPr = state.records.find(record =>
        record.id === input.prRecordId && record.type === 'pr');
      requireThat(observedPr, 'INPUT', 'PR record is unavailable');
      const verifiedMonitorRefs = [];
      for (const check of input.checks) {
        if (!check.runKey) continue;
        const monitor = await readActiveMonitor(store, check.runKey);
        const association = await readMonitorAssociation(store, {
          runKey: check.runKey,
          workItemId: input.workItemId,
          prRecordId: input.prRecordId,
          checkId: check.id,
        });
        if (monitor?.key === check.runKey &&
          check.identity.provider === observedPr.provider &&
          check.identity.connection === observedPr.connection &&
          sameExecutionIdentity(monitor.identity, check.identity) &&
          association?.workItemId === input.workItemId &&
          association.prRecordId === input.prRecordId &&
          association.checkId === check.id &&
          association.sourceRevision ===
            (check.sourceRevision ?? input.sourceRevision) &&
          association.targetRevision ===
            (check.targetRevision ?? input.targetRevision) &&
          monitor.capability?.schedulerAvailable === true &&
          monitor.capability?.readAvailable === true &&
          monitor.link?.status === 'verified' &&
          monitor.runStatus === check.status) {
          verifiedMonitorRefs.push(association.key);
        }
      }
      requireThat((input.runMonitorRefs ?? []).every(reference =>
        verifiedMonitorRefs.includes(reference)),
      'EVIDENCE',
      'Supplied PR monitor references must resolve to matching verified monitor records');
      return store.transaction(input.workItemId, tx => {
        const pr = tx.get(input.prRecordId);
        requireThat(pr?.type === 'pr', 'INPUT',
          'PR record is unavailable');
        requireThat(pr.sourceRevision === input.sourceRevision &&
          pr.targetRevision === input.targetRevision,
        'STALE',
        'Provider facts do not match the current PR source/target observation');
        const facts = {
          ...input,
          runMonitorRefs: verifiedMonitorRefs,
          id: `facts-${input.prRecordId}`,
          type: 'pr-facts',
          observedAt: now(store.clock),
        };
        tx.put(facts);
        return facts;
      });
    });
}
export function evaluateReadiness(records, input, { clock = Date, maxAgeMs = 60000 } = {}) {
  object(input, ['environment', 'repositoryId', 'prRecordId',
    'sourceRevision', 'targetRevision', 'policyVersion', 'policy',
    'requireArtifact', 'artifactId'],
    ['environment']);
  choice(input.environment, ['DEV', 'STAGING', 'PROD'], 'environment');
  const policy = { required: input.environment === 'PROD', validation: input.environment === 'PROD',
    reviews: false, merge: false, ...(input.policy ?? {}) };
  if (input.environment === 'PROD') { policy.required = true; policy.validation = true; }
  const gaps = [];
  if (!policy.required && !policy.validation && !policy.reviews && !policy.merge) return { verdict: 'not-applicable', ready: true,
    gaps, permissions: { publish: false, merge: false, deploy: false }, reason: 'This environment does not require a PR; artifact/deployment authority remains separate.' };
  const pr = records.find(r => r.id === input.prRecordId && r.type === 'pr');
  const facts = records.find(r => r.type === 'pr-facts' && r.prRecordId === pr?.id);
  if (!pr) gaps.push('qualifying-pr-missing');
  if (pr && input.repositoryId &&
      pr.repositoryId !== input.repositoryId) {
    gaps.push('pr-repository-mismatch');
  }
  if (pr?.state === 'closed') gaps.push('pr-closed-without-merge');
  if (!facts) gaps.push('provider-policy-or-check-metadata-unavailable');
  if (facts) {
    if (pr.sourceRevision !== input.sourceRevision ||
        pr.targetRevision !== input.targetRevision) {
      gaps.push('current-pr-revision-differs');
    }
    if (!input.policyVersion || facts.policyVersion !== input.policyVersion) gaps.push('policy-version-unverified');
    if (!input.sourceRevision || !input.targetRevision || facts.sourceRevision !== input.sourceRevision || facts.targetRevision !== input.targetRevision) gaps.push('stale-source-or-target');
    if (clock.now() - Date.parse(facts.observedAt) > maxAgeMs) gaps.push('re-read-provider-readiness-before-dependent-step');
    if (policy.validation) {
      if (facts.requiredChecks.length === 0) gaps.push('required-check-set-unverified');
      for (const required of facts.requiredChecks) {
        const check = facts.checks.find(c => c.id === required);
        if (!check || check.status !== 'succeeded') { gaps.push(`check:${required}:${check?.status ?? 'missing'}`); continue; }
        const direct = check.sourceRevision === input.sourceRevision && check.targetRevision === input.targetRevision;
        const merged = facts.mergeContext?.evidenceRef && facts.mergeContext.sourceRevision === input.sourceRevision &&
          facts.mergeContext.targetRevision === input.targetRevision && facts.mergeContext.mergeRevision === check.mergeRevision;
        if (!direct && !merged) gaps.push(`check:${required}:revision-provenance-unverified`);
        if (!check.runKey) gaps.push(`check:${required}:monitor-identity-missing`);
        else {
          const associationKey = monitorAssociationKey({ runKey: check.runKey, workItemId: pr.workItemId,
            prRecordId: pr.id, checkId: check.id });
          if (!facts.runMonitorRefs?.includes(associationKey)) gaps.push(`check:${required}:monitor-not-attached-or-verified`);
        }
      }
    }
    if (policy.reviews && facts.reviewsSatisfied !== true) gaps.push('required-reviews-missing');
    if (policy.merge && (facts.merged !== true || pr?.state !== 'merged')) gaps.push('required-merge-missing');
  }
  if (input.requireArtifact && !records.some(r => r.type === 'artifact' && r.artifactId === input.artifactId && r.status === 'succeeded')) gaps.push('deployable-artifact-missing');
  return { verdict: gaps.length ? 'unverified' : 'satisfied', ready: gaps.length === 0, gaps,
    permissions: { publish: false, merge: false, deploy: false }, prUrl: pr?.url ?? null };
}
