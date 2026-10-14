import { choice, object, requireThat } from '../core.mjs';
import { registerProviderAdapter } from '../provider-adapters.mjs';
import { normalizeGitHubRepositoryIdentity } from './repository.mjs';
import {
  githubRepositoryScopeRef,
  validateGitHubId,
  validateGitHubWebUrl,
} from './schemas.mjs';

/**
 * Normalize trusted bounded REST run fields and a host-acquired human-page access result.
 * `access.accessible` must exclude login walls, even when they retain the requested URL.
 * Run metadata may name the run overview; only an exact attempt final page proves access.
 * Returns only the existing adapter link keys. Malformed projections throw INPUT;
 * contradictory repository metadata throws EVIDENCE; unavailable/wrong pages remain false.
 * No acquisition, authority, clock access or registration is performed.
 */
export function normalizeGitHubExecutionLink(observation) {
  object(observation, ['connection', 'run', 'access', 'kind'],
    ['connection', 'run', 'access']);
  if (observation.kind !== undefined) {
    choice(observation.kind, ['summary'], 'GitHub execution link kind');
  }
  object(observation.run, ['id', 'workflow_id', 'run_attempt', 'repository', 'html_url'],
    ['id', 'workflow_id', 'run_attempt', 'repository', 'html_url']);
  object(observation.access, ['accessible', 'finalUrl'], ['accessible', 'finalUrl']);
  requireThat(typeof observation.access.accessible === 'boolean', 'INPUT',
    'GitHub page accessibility must be boolean');
  const repository = normalizeGitHubRepositoryIdentity(observation.run.repository, {
    connection: observation.connection,
  });
  const executionRef = validateGitHubId(observation.run.id, 'GitHub run ID');
  const definitionRef = validateGitHubId(observation.run.workflow_id, 'GitHub workflow ID');
  const attemptRef = validateGitHubId(observation.run.run_attempt, 'GitHub run attempt');
  const metadataUrl = validateGitHubWebUrl(observation.run.html_url, 'GitHub run metadata page URL');
  const finalUrl = validateGitHubWebUrl(observation.access.finalUrl, 'GitHub final execution page URL');
  const runPage = `${repository.url}/actions/runs/${executionRef}`;
  const attemptPage = `${runPage}/attempts/${attemptRef}`;
  const sameAttempt = (metadataUrl.href === runPage || metadataUrl.href === attemptPage) &&
    finalUrl.href === attemptPage;
  const accessible = observation.access.accessible && sameAttempt;
  return {
    identity: {
      provider: 'github', connection: repository.connection,
      scopeRef: githubRepositoryScopeRef(repository.repositoryId),
      definitionRef, executionRef, attemptKind: 'known', attemptRef,
    },
    url: attemptPage, kind: 'summary', accessible,
    ...(!accessible ? { reason: sameAttempt ?
      'GitHub execution page is not accessible' :
      'GitHub metadata or final page does not identify the observed repository, run and exact attempt' } : {}),
  };
}

/** Construct the in-process descriptor without registering it or performing host work. */
export function createGitHubExecutionAdapter() {
  return Object.freeze({
    id: 'github', linkKinds: Object.freeze(['summary']), attemptCapability: 'distinct',
    normalizeLinkObservation: normalizeGitHubExecutionLink,
  });
}

/** Explicit registration only; existing duplicate-ID errors are preserved. */
export function registerGitHubAdapter() {
  return registerProviderAdapter(createGitHubExecutionAdapter());
}
