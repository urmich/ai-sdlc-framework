import { activeEvents, matchesScope } from './authority.mjs';

export const STAGING_OWNERS = ['user', 'agent', 'provider',
  'external-system'];

export function effectiveStagingExecution(records, cycle, configuration, {
  action = {},
  clock = Date,
} = {}) {
  const base = configuration?.environments?.STAGING?.execution;
  if (!base) {
    return {
      resolved: false,
      reason: 'STAGING execution owner and locations are not configured',
    };
  }
  const context = {
    class: action.class ?? 'test',
    repositoryId: action.repositoryId,
    environment: 'STAGING',
    target: action.target,
    owner: action.owner,
    host: action.host,
    operationId: action.operationId,
    itemId: action.itemId,
    paths: action.paths,
  };
  const fallbacks = activeEvents(records, {
    cycleId: cycle?.id,
    clock,
  }).filter(event => event.kind === 'override' &&
    event.effect.rules?.includes('staging-execution-contract') &&
    event.effect.scope?.owner &&
    event.effect.scope?.host &&
    matchesScope(event, {
      ...context,
      owner: action.owner ?? event.effect.scope.owner,
      host: action.host ?? event.effect.scope.host,
    }, records));
  if (fallbacks.length > 1) {
    return {
      resolved: false,
      reason: 'Multiple STAGING execution fallbacks match this operation',
    };
  }
  if (fallbacks.length === 1) {
    return {
      resolved: true,
      owner: fallbacks[0].effect.scope.owner,
      locations: [fallbacks[0].effect.scope.host],
      overrideId: fallbacks[0].id,
    };
  }
  return {
    resolved: true,
    owner: base.owner,
    locations: [...base.locations],
  };
}

export function stagingExecutionMatches(execution, owner, host) {
  return Boolean(execution?.resolved &&
    execution.owner === owner &&
    execution.locations.includes(host));
}

export function stagingExecutionGuidance(execution, tests = []) {
  if (!execution?.resolved) {
    return {
      state: 'execution-policy-unresolved',
      instruction: execution?.reason ??
        'Resolve the STAGING execution owner and authorized location',
    };
  }
  const plannedLocations = [...new Set(tests.map(test => test.location)
    .filter(location => execution.locations.includes(location)))];
  const locations = plannedLocations.length ? plannedLocations :
    [...execution.locations];
  const location = locations.length === 1 ? locations[0] : undefined;
  const locationText = location ?? `each test's planned location (${locations.join(', ')})`;
  return {
    state: execution.owner === 'user' ? 'awaiting-user-execution' :
      'ready-for-authorized-execution',
    owner: execution.owner,
    location,
    locations,
    instruction: execution.owner === 'user' ?
      `Run these tests at ${locationText} and report the result for this exact deployment. Deployment success is not test success.` :
      `Execute these tests through the authorized ${execution.owner} path at ${locationText}. Record actual results for this exact deployment; deployment success is not test success.`,
  };
}
