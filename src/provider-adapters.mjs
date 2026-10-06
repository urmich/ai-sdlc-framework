import { choice, digest, object, requireThat, text } from './core.mjs';

const LINK_KINDS = ['summary', 'job', 'logs', 'deployment'];
const adapters = new Map();

export function validateExecutionIdentity(input) {
  object(input, ['provider', 'connection', 'scopeRef', 'definitionRef',
    'executionRef', 'attemptRef', 'attemptKind'],
  ['provider', 'connection', 'scopeRef', 'executionRef']);
  for (const field of ['provider', 'connection', 'scopeRef', 'executionRef']) {
    text(input[field], `execution identity ${field}`);
  }
  for (const field of ['definitionRef', 'attemptRef']) {
    if (input[field] !== undefined) {
      text(input[field], `execution identity ${field}`);
    }
  }
  if (input.attemptKind !== undefined) {
    choice(input.attemptKind, ['known', 'not-applicable', 'unknown'], 'execution attempt kind');
    requireThat((input.attemptKind === 'known') === (input.attemptRef !== undefined),
      'INPUT', 'Only a known execution attempt has an attempt reference');
  }
  return {
    provider: input.provider,
    connection: input.connection,
    scopeRef: input.scopeRef,
    ...(input.definitionRef !== undefined ?
      { definitionRef: input.definitionRef } : {}),
    executionRef: input.executionRef,
    ...(input.attemptRef !== undefined ? { attemptRef: input.attemptRef } : {}),
    ...(input.attemptKind !== undefined ? { attemptKind: input.attemptKind } : {}),
  };
}

// The capability is established by a trusted provider adapter, never inferred from an absent attempt.
export function validateCurrentExecutionIdentity(input, attemptCapability) {
  const identity = validateExecutionIdentity(input);
  requireThat(Object.values(identity).every(value => value === value.trim()),
    'EVIDENCE', 'Current execution identity must use normalized references');
  requireThat(identity.attemptKind !== 'known' ||
    !['unknown', 'not-applicable'].includes(identity.attemptRef),
  'EVIDENCE', 'A known execution attempt requires its actual reference');
  choice(attemptCapability, ['distinct', 'none', 'unknown'], 'adapter attempt capability');
  requireThat(identity.attemptKind !== undefined, 'EVIDENCE',
    'Current execution identity requires an explicit attempt kind');
  requireThat(
    (attemptCapability === 'none' && identity.attemptKind === 'not-applicable') ||
    (attemptCapability === 'distinct' &&
      ['known', 'unknown'].includes(identity.attemptKind)) ||
    (attemptCapability === 'unknown' && identity.attemptKind === 'unknown'),
  'EVIDENCE', 'Execution attempt does not match the adapter capability');
  return identity;
}

export function validateExecutionResultIdentity(result, expected = {}) {
  object(expected, ['provider', 'connection', 'scopeRef', 'definitionRef',
    'attemptCapability']);
  const identity = validateCurrentExecutionIdentity(
    result?.executionIdentity, result?.attemptCapability);
  for (const field of ['provider', 'connection', 'scopeRef', 'definitionRef']) {
    if (expected[field] !== undefined) {
      text(expected[field], `expected execution ${field}`);
      requireThat(identity[field] === expected[field], 'EVIDENCE',
        `Execution identity differs from the trusted ${field}`);
    }
  }
  requireThat((expected.attemptCapability === undefined ||
      result.attemptCapability === expected.attemptCapability) &&
    (result.provider === undefined || identity.provider === result.provider) &&
    (result.pipeline === undefined || identity.definitionRef === result.pipeline) &&
    identity.executionRef === result.executionRef &&
    (identity.attemptKind === 'known' ?
      identity.attemptRef === result.attemptRef &&
        result.attemptCapability === 'distinct' :
      identity.attemptKind === 'not-applicable' &&
        result.attemptCapability === 'none' &&
        result.attemptRef === 'not-applicable') &&
    (result.providerResultId === undefined ||
      result.providerResultId === `${result.executionRef}:${result.attemptRef}`),
  'EVIDENCE', 'Execution identity differs from the proven execution result');
  return identity;
}

export function currentExecutionRunKey(input, attemptCapability) {
  return `run-${digest(validateCurrentExecutionIdentity(input, attemptCapability)).slice(0, 40)}`;
}

// Old monitor filenames were hashed without attemptKind; preserve them for history lookups only.
export function legacyExecutionRunKey(input) {
  const { attemptKind, ...historical } = validateExecutionIdentity(input);
  void attemptKind;
  return `run-${digest(historical).slice(0, 40)}`;
}

export function canCreditExecutionIdentity(input, attemptCapability) {
  return validateCurrentExecutionIdentity(input, attemptCapability).attemptKind !== 'unknown';
}

export function validateAdapterExecutionIdentity(adapterId, input) {
  const adapter = adapters.get(adapterId);
  requireThat(adapter, 'ADAPTER', `No registered provider adapter is available for ${adapterId}`);
  requireThat(input?.provider === adapterId, 'EVIDENCE',
    'Provider adapter does not match the execution identity');
  return validateCurrentExecutionIdentity(input, adapter.attemptCapability ?? 'unknown');
}

export function sameExecutionIdentity(left, right) {
  return digest(validateExecutionIdentity(left)) ===
    digest(validateExecutionIdentity(right));
}

export function registerProviderAdapter(adapter) {
  object(adapter, ['id', 'linkKinds', 'normalizeLinkObservation', 'attemptCapability'],
    ['id', 'linkKinds', 'normalizeLinkObservation']);
  requireThat(/^[a-z0-9][a-z0-9-]{1,63}$/u.test(adapter.id),
    'ADAPTER', 'Provider adapter ID must be a stable lowercase identifier');
  requireThat(Array.isArray(adapter.linkKinds) &&
    adapter.linkKinds.length > 0 &&
    adapter.linkKinds.every(kind => LINK_KINDS.includes(kind)) &&
    new Set(adapter.linkKinds).size === adapter.linkKinds.length,
  'ADAPTER', 'Provider adapter link kinds are invalid');
  requireThat(typeof adapter.normalizeLinkObservation === 'function',
    'ADAPTER', 'Provider adapter requires a normalization function');
  if (adapter.attemptCapability !== undefined) {
    choice(adapter.attemptCapability, ['distinct', 'none', 'unknown'],
      'adapter attempt capability');
  }
  requireThat(!adapters.has(adapter.id), 'ADAPTER',
    `Provider adapter is already registered: ${adapter.id}`);
  adapters.set(adapter.id, Object.freeze({ ...adapter }));
  return adapter.id;
}

export function providerAdapterIds() {
  return [...adapters.keys()].sort();
}

function safeWebUrl(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    return { valid: false, reason: `${name} is not a nonempty string` };
  }
  let url;
  try { url = new URL(value); }
  catch {
    return { valid: false, reason: `${name} is not a valid URL` };
  }
  const valid = url.protocol === 'https:' && !url.username && !url.password;
  return {
    valid,
    url,
    reason: valid ? undefined :
      `${name} must be a credential-free HTTPS execution page`,
  };
}

export async function verifyProviderLink(adapterId, expectedIdentity,
  observation) {
  const expected = validateExecutionIdentity(expectedIdentity);
  const adapter = adapters.get(adapterId);
  if (!adapter) {
    return {
      verified: false,
      reason: `No registered provider adapter is available for ${adapterId}`,
    };
  }
  if (adapterId !== expected.provider) {
    return {
      verified: false,
      reason: 'Provider adapter does not match the monitored execution identity',
    };
  }
  let normalized;
  let checkedUrl;
  try {
    if (expected.attemptKind !== undefined) {
      validateAdapterExecutionIdentity(adapterId, expected);
    }
    normalized = await adapter.normalizeLinkObservation(observation);
    object(normalized, ['identity', 'url', 'kind', 'accessible', 'reason'],
      ['identity', 'url', 'kind', 'accessible']);
    normalized.identity = validateExecutionIdentity(normalized.identity);
    if (expected.attemptKind !== undefined) {
      const capability = adapter.attemptCapability ?? 'unknown';
      if (normalized.identity.attemptKind === undefined && capability === 'none') {
        normalized.identity = { ...normalized.identity, attemptKind: 'not-applicable' };
      }
      normalized.identity = validateCurrentExecutionIdentity(normalized.identity, capability);
    }
    requireThat(adapter.linkKinds.includes(normalized.kind), 'ADAPTER',
      'Provider adapter returned an unsupported link kind');
    requireThat(typeof normalized.accessible === 'boolean', 'ADAPTER',
      'Provider adapter accessibility must be boolean');
    checkedUrl = safeWebUrl(normalized.url, 'Provider execution URL');
  } catch (error) {
    return {
      verified: false,
      reason: `Provider observation is invalid (${error?.code ?? 'ERROR'}): ${error instanceof Error ? error.message : 'adapter rejected the observation without an error'}`,
    };
  }
  if (!sameExecutionIdentity(expected, normalized.identity)) {
    return {
      verified: false,
      reason: 'Provider observation identifies a different execution',
    };
  }
  if (!normalized.accessible) {
    return {
      verified: false,
      reason: normalized.reason || 'Provider execution URL is not accessible',
    };
  }
  if (!checkedUrl.valid) {
    return { verified: false, reason: checkedUrl.reason };
  }
  return {
    verified: true,
    identity: normalized.identity,
    url: checkedUrl.url.href,
    kind: normalized.kind,
  };
}

export function azureDevOpsScopeRef({ projectId, repositoryId }) {
  text(projectId, 'Azure DevOps project ID');
  if (repositoryId !== undefined) {
    text(repositoryId, 'Azure DevOps repository ID');
  }
  return `project:${encodeURIComponent(projectId)}${repositoryId === undefined ?
    '' : `/repository:${encodeURIComponent(repositoryId)}`}`;
}

registerProviderAdapter({
  id: 'azure-devops',
  linkKinds: ['summary'],
  attemptCapability: 'none',
  normalizeLinkObservation(observation) {
    object(observation, ['connection', 'build', 'access'],
      ['connection', 'build', 'access']);
    text(observation.connection, 'Azure DevOps connection');
    object(observation.build, ['id', 'project', 'repository', 'definition',
      '_links'], ['id', 'project', 'definition', '_links']);
    object(observation.build.project, ['id'], ['id']);
    object(observation.build.definition, ['id'], ['id']);
    if (observation.build.repository !== undefined) {
      object(observation.build.repository, ['id'], ['id']);
    }
    object(observation.build._links, ['web'], ['web']);
    object(observation.build._links.web, ['href'], ['href']);
    object(observation.access, ['accessible', 'finalUrl'],
      ['accessible', 'finalUrl']);
    requireThat(typeof observation.access.accessible === 'boolean', 'ADAPTER',
      'Azure DevOps link accessibility must be boolean');
    const nativeId = (value, name) => {
      requireThat((typeof value === 'string' && value.trim()) ||
        (Number.isSafeInteger(value) && value >= 0),
      'ADAPTER', `Azure DevOps ${name} is invalid`);
      return String(value);
    };
    const buildId = nativeId(observation.build.id, 'build ID');
    const definitionId = nativeId(observation.build.definition.id,
      'definition ID');
    const projectId = nativeId(observation.build.project.id, 'project ID');
    const repositoryId = observation.build.repository?.id === undefined ?
      undefined : nativeId(observation.build.repository.id, 'repository ID');
    const metadataUrl = safeWebUrl(observation.build._links.web.href,
      'Azure DevOps build web URL');
    const finalUrl = safeWebUrl(observation.access.finalUrl,
      'Azure DevOps final build URL');
    const finalBuildId = finalUrl.url?.searchParams.get('buildId');
    const sameBuild = metadataUrl.valid && finalUrl.valid &&
      metadataUrl.url.searchParams.get('buildId') === buildId &&
      finalBuildId === buildId &&
      metadataUrl.url.origin === finalUrl.url.origin &&
      metadataUrl.url.pathname === finalUrl.url.pathname &&
      /\/_build\/results\/?$/u.test(metadataUrl.url.pathname);
    return {
      identity: {
        provider: 'azure-devops',
        connection: observation.connection,
        scopeRef: azureDevOpsScopeRef({ projectId, repositoryId }),
        definitionRef: definitionId,
        executionRef: buildId,
      },
      url: metadataUrl.url?.href ?? observation.build._links.web.href,
      kind: 'summary',
      accessible: observation.access.accessible && sameBuild,
      ...(!sameBuild ? {
        reason: 'Azure DevOps metadata or final URL does not identify the observed build',
      } : {}),
    };
  },
});
