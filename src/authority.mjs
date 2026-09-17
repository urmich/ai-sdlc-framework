import { PHASES, choice, id, object, requireThat, strings, text, timestamp } from './core.mjs';

export const KINDS = ['approval', 'stage-completion', 'override', 'out-of-scope-execution',
  'out-of-scope-documentation', 'scope-inclusion', 'pr-publication', 'dev-authorization',
  'review-result', 'staging-promotion', 'staging-result', 'revocation', 'permission', 'work-completion'];
export function validateEffect(kind, effect, { strict = false } = {}) {
  choice(kind, KINDS, 'decision kind');
  object(effect, ['transition', 'completedStage', 'cycleId', 'candidateDigest', 'testSpecDigest', 'target',
    'configDigest', 'deploymentId', 'artifactId', 'outcome', 'rules', 'scope', 'lifetime', 'grant', 'repositoryId',
    'sourceRef', 'targetRef', 'draft', 'itemId', 'revokes', 'lifecycleStatus', 'reason', 'confirmation', 'host', 'testIds',
    'owner', 'status', 'evidenceRef', 'summary', 'blockingFindings', 'remoteUrlDigest', 'sourceRevision', 'force', 'delete']);
  const cycleFields = ['cycleId', 'candidateDigest', 'testSpecDigest', 'configDigest', 'target'];
  const kindFields = {
    approval: ['transition'],
    'stage-completion': [...cycleFields, 'completedStage', 'deploymentId'],
    override: ['rules', 'transition'],
    'out-of-scope-execution': ['itemId'],
    'out-of-scope-documentation': ['itemId'],
    'scope-inclusion': ['itemId'],
    'pr-publication': ['repositoryId', 'sourceRef', 'targetRef', 'draft'],
    'dev-authorization': [...cycleFields, 'completedStage'],
    'review-result': ['cycleId', 'candidateDigest', 'testSpecDigest', 'configDigest', 'status', 'evidenceRef', 'summary', 'blockingFindings', 'completedStage'],
    'staging-promotion': [...cycleFields, 'completedStage', 'deploymentId'],
    'staging-result': [...cycleFields, 'deploymentId', 'artifactId',
      'testIds', 'outcome', 'owner', 'host', 'evidenceRef'],
    revocation: ['revokes'],
    permission: ['grant', 'target', 'remoteUrlDigest', 'sourceRef', 'targetRef', 'sourceRevision', 'force', 'delete'],
    'work-completion': ['lifecycleStatus'],
  };
  object(effect, [...kindFields[kind], 'scope', 'lifetime', 'reason']);
  if (effect.completedStage) {
    choice(effect.completedStage, ['local', 'review', 'DEV', 'STAGING'], 'completed stage');
    if (kind === 'dev-authorization') requireThat(['local', 'review'].includes(effect.completedStage), 'INPUT', 'DEV authorization can only combine local or Review completion');
    if (kind === 'staging-promotion') requireThat(effect.completedStage === 'DEV', 'INPUT', 'STAGING promotion can only combine DEV completion');
  }
  if (effect.transition) {
    object(effect.transition, ['from', 'to'], ['from', 'to']);
    choice(effect.transition.from, PHASES, 'source phase');
    choice(effect.transition.to, PHASES, 'destination phase');
    requireThat(kind === 'approval' || kind === 'override', 'AUTHORITY', 'Only approval or explicit override may advance phases');
    if (kind === 'approval') requireThat(PHASES.indexOf(effect.transition.to) === PHASES.indexOf(effect.transition.from) + 1, 'TRANSITION', 'Approval advances exactly one phase');
  }
  if (kind === 'approval') requireThat(effect.transition, 'INPUT', 'Approval requires a transition');
  if (effect.rules) strings(effect.rules, 'rule identifiers', 30);
  if (kind === 'override') requireThat(effect.rules?.length && effect.reason, 'INPUT', 'Override requires identified rules and consequence/reason');
  if (effect.reason) text(effect.reason, 'reason', 600);
  if (effect.scope) {
    object(effect.scope, ['repositoryIds', 'paths', 'actions', 'itemId',
      'operationId', 'environment', 'target', 'owner', 'host']);
    for (const key of ['repositoryIds', 'paths', 'actions']) if (effect.scope[key]) strings(effect.scope[key], key, 30);
    for (const key of ['owner', 'host']) {
      if (effect.scope[key]) text(effect.scope[key], `scope ${key}`);
    }
  }
  if (kind === 'override' &&
      effect.rules?.includes('staging-execution-contract')) {
    requireThat(effect.scope?.environment === 'STAGING' &&
      effect.scope.owner && effect.scope.host &&
      effect.scope.target &&
      effect.scope.repositoryIds?.length === 1 &&
      effect.scope.actions?.length > 0 &&
      effect.lifetime?.kind === 'cycle',
    'INPUT',
    'STAGING execution fallback requires cycle lifetime, environment, owner, host, target, one repository and action scope');
    choice(effect.scope.owner, ['user', 'agent', 'provider',
      'external-system'], 'STAGING fallback owner');
  }
  if (effect.lifetime) {
    object(effect.lifetime, ['kind', 'expiresAt', 'cycleId'], ['kind']);
    choice(effect.lifetime.kind, ['work-item', 'cycle', 'once', 'until'], 'lifetime');
    if (effect.lifetime.kind === 'until') timestamp(effect.lifetime.expiresAt);
    if (effect.lifetime.kind === 'cycle') id(effect.lifetime.cycleId);
  }
  if (kind === 'revocation') strings(effect.revokes, 'revoked events', 30);
  if (['out-of-scope-execution', 'out-of-scope-documentation', 'scope-inclusion'].includes(kind)) id(effect.itemId, 'scope item');
  if (kind === 'pr-publication') {
    for (const field of ['repositoryId', 'sourceRef', 'targetRef']) text(effect[field], field);
    requireThat(typeof effect.draft === 'boolean', 'INPUT', 'PR authority must identify draft or ready intent');
  }
  if (kind === 'permission') {
    choice(effect.grant, ['push', 'merge', 'auto-merge', 'policy-bypass', 'prod-execution', 'artifact-location'], 'permission');
    if (effect.grant === 'push') {
      const required = effect.delete === true ?
        ['target', 'remoteUrlDigest', 'targetRef', 'force', 'delete'] :
        ['target', 'remoteUrlDigest', 'sourceRef', 'targetRef', 'force', 'delete'];
      const complete = required.every(field => effect[field] !== undefined);
      if (strict) requireThat(complete, 'INPUT', 'New push permission must bind remote, refs and destructive behavior');
      for (const field of ['target', 'remoteUrlDigest', 'sourceRef', 'targetRef']) if (effect[field] !== undefined) text(effect[field], field);
      if (effect.remoteUrlDigest !== undefined) requireThat(/^[a-f0-9]{64}$/u.test(effect.remoteUrlDigest), 'INPUT', 'Push permission remote URL digest is invalid');
      for (const field of ['sourceRef', 'targetRef']) if (effect[field] !== undefined) requireThat(effect[field].startsWith('refs/heads/'), 'INPUT', 'Push permission refs must be branch refs');
      if (effect.sourceRevision) requireThat(/^[a-f0-9]{40,64}$/u.test(effect.sourceRevision), 'INPUT', 'Push permission source revision is invalid');
      for (const field of ['force', 'delete']) if (effect[field] !== undefined) requireThat(typeof effect[field] === 'boolean', 'INPUT', `Push permission ${field} must be boolean`);
    }
  }
  if (kind === 'review-result') {
    choice(effect.status, ['Passed', 'ChangesRequired', 'Blocked'], 'review outcome');
    text(effect.evidenceRef, 'review evidence reference');
    requireThat(/^copilot-cli:\/review(?::|\/|$)/u.test(effect.evidenceRef),
      'PROVENANCE', 'Review evidence must reference GitHub Copilot CLI /review');
    text(effect.summary, 'review summary', 600);
    strings(effect.blockingFindings, 'blocking review findings', 20);
    requireThat(effect.status !== 'Passed' || (effect.blockingFindings.length === 0 && effect.completedStage === 'review'),
      'EVIDENCE', 'A passed review needs no blocking findings and must complete the Review stage');
    requireThat(effect.status !== 'ChangesRequired' || effect.blockingFindings.length > 0,
      'EVIDENCE', 'ChangesRequired must identify at least one blocking finding');
    requireThat(effect.status === 'Passed' || effect.completedStage === undefined,
      'EVIDENCE', 'Only a passed review can complete the Review stage');
  }
  if (kind === 'staging-result') {
    strings(effect.testIds, 'STAGING test IDs');
    requireThat(effect.testIds.length > 0, 'INPUT', 'STAGING result must identify at least one planned test');
    choice(effect.outcome, ['Passed', 'Failed', 'NotRun'], 'STAGING outcome');
    choice(effect.owner, ['user', 'agent', 'provider', 'external-system'],
      'STAGING execution owner');
    text(effect.host, 'STAGING execution host');
    text(effect.evidenceRef, 'STAGING result evidence');
  }
  if (kind === 'work-completion') choice(effect.lifecycleStatus, ['active', 'paused', 'completed'], 'lifecycle status');
  return effect;
}
export function activeEvents(records, { cycleId, clock = Date } = {}) {
  const events = records.filter(record => record.type === 'event');
  const revoked = new Set(events.flatMap(event => event.effect.revokes ?? []));
  return events.filter(event => {
    if (revoked.has(event.id)) return false;
    const lifetime = event.effect.lifetime;
    if (lifetime?.kind === 'until' && Date.parse(lifetime.expiresAt) <= clock.now()) return false;
    if (lifetime?.kind === 'cycle' && lifetime.cycleId !== cycleId) return false;
    return true;
  });
}
export function matchesScope(event, action, records = []) {
  const scope = event.effect.scope ?? {};
  for (const key of ['itemId', 'operationId', 'environment', 'target',
    'owner', 'host']) {
    if (scope[key] && scope[key] !== action[key]) return false;
  }
  if (scope.repositoryIds && !scope.repositoryIds.includes(action.repositoryId)) return false;
  if (scope.actions && !scope.actions.includes(action.class)) return false;
  if (scope.paths && (!action.paths?.length || !action.paths.every(file => scope.paths.includes(file)))) return false;
  if (event.effect.lifetime?.kind === 'once') {
    if (!action.operationId) return false;
    const reservation = records.find(record => record.type === 'reservation' && record.eventId === event.id);
    if (reservation && reservation.operationId !== action.operationId) return false;
  }
  return true;
}
export function findAuthority(records, kind, action, context = {}) {
  return activeEvents(records, context).find(event => event.kind === kind && matchesScope(event, action, records));
}
export function applicableOverride(records, rule, action, context = {}) {
  return activeEvents(records, context).find(event => event.kind === 'override' && event.effect.rules?.includes(rule) && matchesScope(event, action, records));
}
export function permissionMatches(event, grant, action, records = []) {
  if (event.kind !== 'permission' || event.effect.grant !== grant ||
    (event.effect.target && event.effect.target !== action.target) ||
    !matchesScope(event, action, records)) return false;
  if (grant !== 'push') return true;
  const required = event.effect.delete === true ?
    ['target', 'remoteUrlDigest', 'targetRef', 'force', 'delete'] :
    ['target', 'remoteUrlDigest', 'sourceRef', 'targetRef', 'force', 'delete'];
  if (!required.every(field => event.effect[field] !== undefined)) return false;
  return ['remoteUrlDigest', 'sourceRef', 'targetRef', 'sourceRevision', 'force', 'delete'].every(field =>
    event.effect[field] === undefined || event.effect[field] === action[field]);
}
export function currentCycle(records, checkpoint) {
  return records.find(record => record.id === checkpoint.validationCycleRef && record.type === 'cycle') ?? null;
}
export function phaseAuthority(records, checkpoint, action = null, context = {}) {
  if (checkpoint.phase === 'requirements' && !records.some(record => record.type === 'event' && record.effect.transition)) {
    return { active: true, eventId: null };
  }
  const event = records.filter(record => record.type === 'event' && record.effect.transition)
    .sort((left, right) => right.sequence - left.sequence)[0];
  const transitionAuthority = event?.kind === 'approval' || (event?.kind === 'override' &&
    event.effect.rules?.includes('phase') && (!action || applicableOverride(records, 'phase', action, context)?.id === event.id));
  const active = event && activeEvents(records, context).some(candidate => candidate.id === event.id) &&
    (!action || matchesScope(event, action, records)) && transitionAuthority;
  return { active: Boolean(active), eventId: event?.id ?? null };
}
export function boundToCycle(effect, cycle) {
  return cycle && effect.cycleId === cycle.id && effect.candidateDigest === cycle.candidateDigest &&
    effect.testSpecDigest === cycle.testSpecDigest && effect.configDigest === cycle.configDigest;
}
export function isCycleBoundEvent(event) {
  return ['stage-completion', 'dev-authorization', 'review-result',
    'staging-promotion', 'staging-result'].includes(event.kind);
}
export function eventAppliesToCycle(event, cycle) {
  return !isCycleBoundEvent(event) || boundToCycle(event.effect, cycle);
}
export function currentStagingResultEventIds(records, cycle, clock = Date) {
  const deployment = records.find(record => record.id === cycle?.deployments.STAGING);
  if (!deployment) return new Set();
  const candidates = records.filter(event => event.type === 'event' &&
    event.kind === 'staging-result' && boundToCycle(event.effect, cycle) &&
    event.effect.deploymentId === deployment.id && event.effect.artifactId === deployment.artifactId);
  const activeIds = new Set(activeEvents(records, {
    cycleId: cycle.id,
    clock,
  }).map(event => event.id));
  const result = new Set();
  for (const test of cycle.tests.filter(item => testCheckpoint(item) === 'STAGING')) {
    const rank = { Passed: 0, NotRun: 1, Failed: 2 };
    const latest = candidates.filter(event => event.effect.testIds?.includes(test.id))
      .sort((left, right) =>
        Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
        rank[left.effect.outcome] - rank[right.effect.outcome] ||
        left.sequence - right.sequence).at(-1);
    if (latest && activeIds.has(latest.id)) result.add(latest.id);
  }
  return result;
}
export function latestStagingResultEvent(records, cycle, testId, clock = Date) {
  const deployment = records.find(record => record.id === cycle?.deployments.STAGING);
  if (!deployment) return null;
  const rank = { Passed: 0, NotRun: 1, Failed: 2 };
  const latest = records.filter(event => event.type === 'event' &&
    event.kind === 'staging-result' && boundToCycle(event.effect, cycle) &&
    event.effect.deploymentId === deployment.id && event.effect.artifactId === deployment.artifactId &&
    event.effect.testIds?.includes(testId))
    .sort((left, right) =>
      Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
      rank[left.effect.outcome] - rank[right.effect.outcome] ||
      left.sequence - right.sequence).at(-1) ?? null;
  if (!latest) return null;
  return activeEvents(records, {
    cycleId: cycle.id,
    clock,
  }).some(event => event.id === latest.id) ? latest : null;
}
export function testCheckpoint(test) {
  if (test.checkpoint) return test.checkpoint;
  if (test.environment === 'DEV') return 'DEV';
  if (test.environment === 'STAGING') return 'STAGING';
  return test.level === 'review' ? 'review' : 'pre-review';
}
export function currentTestEvidence(cycle, records, test, clock = Date) {
  if (assurancePending(cycle, records)) return null;
  if (cycle?.invalidatedEnvironments?.includes(test.environment)) return null;
  if (records.some(record => record.type === 'operation' &&
      record.class === 'test' && record.cycleId === cycle?.id &&
      record.action?.testId === test.id &&
      ['dispatching', 'submitted', 'running', 'uncertain']
        .includes(record.status))) return null;
  const evidence = records.find(record => record.id === cycle?.results[test.id] && record.type === 'test-evidence');
  if (testCheckpoint(test) === 'review' && /(?:^|[\s/])\/review(?:$|[\s/:])/u.test(test.implementation)) {
    const review = activeEvents(records, { cycleId: cycle?.id, clock }).find(record =>
      record.id === cycle?.reviewRef && record.kind === 'review-result' && boundToCycle(record.effect, cycle));
    if (!review) return null;
    if (review.effect.status === 'Blocked') return null;
    return { type: 'test-evidence', id: `derived-${review.id}-${test.id}`, workItemId: review.workItemId,
      cycleId: cycle.id, testId: test.id, candidateDigest: cycle.candidateDigest,
      testSpecDigest: cycle.testSpecDigest, environment: 'local', implementation: test.implementation,
      status: review.effect.status === 'Passed' ? 'Passed' : 'Failed',
      evidenceRef: review.effect.evidenceRef, expectedMet: review.effect.status === 'Passed',
      owner: 'user', host: test.location, eventId: review.id, observedAt: review.occurredAt,
      activity: 'complete' };
  }
  if (test.environment === 'STAGING') {
    const deployment = records.find(record =>
      record.id === cycle?.deployments.STAGING &&
      record.type === 'operation' && record.status === 'succeeded');
    if (!deployment) return null;
    const observations = [];
    for (const candidate of records.filter(record =>
      record.type === 'test-evidence' &&
      record.testId === test.id &&
      record.cycleId === cycle.id &&
      record.candidateDigest === cycle.candidateDigest &&
      record.testSpecDigest === cycle.testSpecDigest &&
      record.deploymentId === deployment.id &&
      record.artifactId === deployment.artifactId &&
      record.environment === 'STAGING')) {
      if (candidate.operationId) {
        const operation = records.find(record =>
          record.id === candidate.operationId &&
          record.type === 'operation' &&
          ['succeeded', 'failed', 'cancelled'].includes(record.status) &&
          record.class === 'test' &&
          record.cycleId === cycle.id &&
          record.candidateDigest === cycle.candidateDigest &&
          record.action?.testId === test.id &&
          record.action.environment === 'STAGING' &&
          record.action.configDigest === cycle.configDigest &&
          record.action.deploymentId === deployment.id &&
          record.action.artifactId === deployment.artifactId &&
          record.action.target === deployment.target &&
          record.target === deployment.target &&
          record.action.owner === candidate.owner &&
          record.action.host === candidate.host &&
          (candidate.status === 'Passed' ?
            record.status === 'succeeded' &&
              record.expectedMet === true :
            candidate.status === 'Failed' ?
              (record.status === 'failed' ||
                record.expectedMet === false) :
              candidate.status === 'NotRun' &&
                record.status === 'cancelled'));
        if (!operation || !Number.isFinite(Date.parse(operation.updatedAt))) {
          continue;
        }
        observations.push({
          evidence: candidate,
          observedAt: operation.updatedAt,
        });
        continue;
      }
      if (candidate.eventId) {
        const event = activeEvents(records, {
          cycleId: cycle.id,
          clock,
        }).find(record => record.id === candidate.eventId &&
          record.kind === 'staging-result' &&
          boundToCycle(record.effect, cycle) &&
          record.effect.deploymentId === deployment.id &&
          record.effect.artifactId === deployment.artifactId &&
          record.effect.testIds?.includes(test.id) &&
          record.effect.outcome === candidate.status);
        if (event) observations.push({
          evidence: candidate,
          observedAt: event.occurredAt,
        });
      }
    }
    for (const event of activeEvents(records, {
      cycleId: cycle.id,
      clock,
    }).filter(record => record.kind === 'staging-result' &&
      boundToCycle(record.effect, cycle) &&
      record.effect.deploymentId === deployment.id &&
      record.effect.artifactId === deployment.artifactId &&
      record.effect.testIds?.includes(test.id) &&
      ['Failed', 'NotRun'].includes(record.effect.outcome))) {
      observations.push({
        observedAt: event.occurredAt,
        evidence: {
          type: 'test-evidence',
          id: `derived-${event.id}-${test.id}`,
          workItemId: event.workItemId,
          cycleId: cycle.id,
          testId: test.id,
          candidateDigest: cycle.candidateDigest,
          testSpecDigest: cycle.testSpecDigest,
          environment: 'STAGING',
          implementation: test.implementation,
          deploymentId: deployment.id,
          artifactId: event.effect.artifactId,
          status: event.effect.outcome,
          evidenceRef: event.effect.evidenceRef ??
            `receipt:${event.sourceReceiptId}`,
          expectedMet: false,
          owner: event.effect.owner,
          host: event.effect.host,
          eventId: event.id,
          observedAt: event.occurredAt,
          activity: event.effect.outcome === 'Failed' ?
            'complete' : 'pending',
        },
      });
    }
    const allEvents = records.filter(record => record.type === 'event' &&
      record.kind === 'staging-result' &&
      boundToCycle(record.effect, cycle) &&
      record.effect.deploymentId === deployment.id &&
      record.effect.artifactId === deployment.artifactId &&
      record.effect.testIds?.includes(test.id));
    const rank = { Passed: 0, NotRun: 1, Failed: 2 };
    const latestAll = allEvents.sort((left, right) =>
      Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
      rank[left.effect.outcome] - rank[right.effect.outcome] ||
      left.sequence - right.sequence).at(-1);
    const activeIds = new Set(activeEvents(records, {
      cycleId: cycle.id,
      clock,
    }).map(event => event.id));
    if (latestAll && !activeIds.has(latestAll.id)) {
      observations.push({
        observedAt: latestAll.occurredAt,
        evidence: {
          type: 'test-evidence',
          id: `derived-expired-${latestAll.id}-${test.id}`,
          workItemId: latestAll.workItemId,
          cycleId: cycle.id,
          testId: test.id,
          candidateDigest: cycle.candidateDigest,
          testSpecDigest: cycle.testSpecDigest,
          environment: 'STAGING',
          implementation: test.implementation,
          deploymentId: deployment.id,
          artifactId: deployment.artifactId,
          status: 'NotRun',
          evidenceRef: latestAll.effect.evidenceRef,
          expectedMet: false,
          owner: latestAll.effect.owner,
          host: latestAll.effect.host,
          eventId: latestAll.id,
          observedAt: latestAll.occurredAt,
          activity: 'pending',
        },
      });
    }
    return observations.sort((left, right) =>
      Date.parse(left.observedAt) - Date.parse(right.observedAt) ||
      rank[left.evidence.status] - rank[right.evidence.status] ||
      left.evidence.id.localeCompare(right.evidence.id)).at(-1)?.evidence ??
      null;
  }
  if (!evidence || evidence.cycleId !== cycle.id || evidence.candidateDigest !== cycle.candidateDigest ||
    evidence.testSpecDigest !== cycle.testSpecDigest) return null;
  if (evidence.environment !== test.environment ||
      evidence.owner !== test.owner ||
      evidence.host !== test.location) return null;
  if (test.environment !== 'local') {
    const deployment = records.find(record => record.id === cycle.deployments[test.environment]);
    if (deployment?.status !== 'succeeded' || evidence.deploymentId !== deployment.id) return null;
  }
  return evidence;
}
export function stagePassed(cycle, records, environment, clock = Date) {
  if (cycle?.pendingPlanSync || assurancePending(cycle, records)) return false;
  if (cycle?.invalidatedEnvironments?.includes(environment)) return false;
  const checkpoint = environment === 'local' ? 'pre-review' : environment;
  const tests = cycle?.tests.filter(test => testCheckpoint(test) === checkpoint) ?? [];
  return tests.length > 0 && tests.every(test => {
    const evidence = currentTestEvidence(cycle, records, test, clock);
    return evidence?.status === 'Passed';
  });
}
export function assurancePending(cycle, records) {
  return Boolean(cycle?.assuranceInvalidated ||
    records.some(record => record.type === 'assurance-marker' &&
      record.workItemId === cycle?.workItemId));
}
export function reviewPassed(cycle, records, clock = Date) {
  if (!stagePassed(cycle, records, 'local', clock)) return false;
  const review = activeEvents(records, { cycleId: cycle?.id, clock }).find(record =>
    record.id === cycle?.reviewRef && record.kind === 'review-result');
  return Boolean(review && review.effect.status === 'Passed' && boundToCycle(review.effect, cycle));
}
export function hasStageCompletion(records, cycle, stage, clock = Date) {
  return activeEvents(records, { cycleId: cycle?.id, clock }).some(event =>
    event.effect.completedStage === stage && boundToCycle(event.effect, cycle) &&
    (!['DEV', 'STAGING'].includes(stage) ||
      (Boolean(cycle.deployments[stage]) && event.effect.deploymentId === cycle.deployments[stage])));
}
export function hasEnvironmentGrant(records, cycle, environment, action, clock = Date) {
  const kind = environment === 'DEV' ? 'dev-authorization' : 'staging-promotion';
  return activeEvents(records, { cycleId: cycle?.id, clock }).find(event => event.kind === kind &&
    boundToCycle(event.effect, cycle) && event.effect.target === action.target &&
    event.effect.configDigest === action.configDigest && matchesScope(event, action, records));
}
export function hasStagingCompletion(records, cycle, clock = Date) {
  return stagePassed(cycle, records, 'STAGING', clock) &&
    hasStageCompletion(records, cycle, 'STAGING', clock);
}
