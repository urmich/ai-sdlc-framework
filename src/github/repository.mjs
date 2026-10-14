import { choice, object, requireThat } from '../core.mjs';
import {
  validateRepositoryObservation,
  validateSelectedFetchRemote,
  validateSelectedPushRemote,
} from '../repository-observations.mjs';
import {
  githubRepositoryScopeRef,
  validateGitHubBranchRef,
  validateGitHubConnection,
  validateGitHubId,
  validateGitHubNodeId,
  validateGitHubRevision,
  validateGitHubWebUrl,
} from './schemas.mjs';

/**
 * Project bounded provider repository fields into stable numeric/node identity.
 * The two IDs must come from the same trusted response; no node-ID decoding or alias guessing.
 * This increment supports github.com, not an inferred enterprise/API host profile.
 */
export function normalizeGitHubRepositoryIdentity(repository, context) {
  object(context, ['connection'], ['connection']);
  const connection = validateGitHubConnection(context.connection);
  object(repository, ['id', 'node_id', 'name', 'full_name', 'owner', 'html_url',
    'clone_url', 'ssh_url', 'default_branch'],
  ['id', 'node_id', 'name', 'full_name', 'owner', 'html_url']);
  object(repository.owner, ['login'], ['login']);
  const repositoryId = validateGitHubId(repository.id, 'GitHub repository ID');
  const repositoryNodeId = validateGitHubNodeId(repository.node_id);
  const owner = repository.owner.login;
  const name = repository.name;
  requireThat(typeof owner === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/u.test(owner),
    'INPUT', 'GitHub repository owner must be an exact login');
  requireThat(typeof name === 'string' && /^[A-Za-z0-9_.-]{1,100}$/u.test(name) &&
    name !== '.' && name !== '..', 'INPUT', 'GitHub repository name is invalid');
  const url = validateGitHubWebUrl(repository.html_url, 'GitHub repository page URL');
  requireThat(repository.full_name === `${owner}/${name}` &&
    url.href === `https://github.com/${owner}/${name}`, 'EVIDENCE',
  'GitHub repository metadata does not identify one exact owner and repository');
  return {
    provider: 'github', connection, repositoryRef: githubRepositoryScopeRef(repositoryId),
    repositoryId, repositoryNodeId, owner, name, url: url.href,
  };
}

function captureBody(capture, expectedUrl, label) {
  object(capture, ['requestUrl', 'body'], ['requestUrl', 'body']);
  const url = validateGitHubWebUrl(capture.requestUrl, `GitHub ${label} request URL`);
  requireThat(url.href === expectedUrl, 'EVIDENCE',
    `GitHub ${label} response was not acquired for the exact requested resource`);
  return capture.body;
}

function verifiedBranch(capture, branchRef, repositoryApiUrl) {
  const name = validateGitHubBranchRef(branchRef).slice('refs/heads/'.length);
  const body = captureBody(capture,
    `${repositoryApiUrl}/branches/${encodeURIComponent(name)}`, 'branch');
  object(body, ['name', 'commit'], ['name', 'commit']);
  object(body.commit, ['sha'], ['sha']);
  requireThat(body.name === name, 'EVIDENCE',
    'GitHub branch response does not identify the exact requested branch');
  return { branchRef, revision: validateGitHubRevision(body.commit.sha) };
}

/**
 * Normalize trusted captures `{repository:{requestUrl,body}, branch:{requestUrl,body},
 * defaultBranch?, observedAt, evidenceRef}` with an independently acquired host context.
 * Context pins connection, numeric/node repository IDs, canonical checkout, full selected
 * branch and exact selected fetch OR effective push URL (never an interchangeable alias).
 * Returns `{repository, observation, verification}` for existing repository consumers.
 * INPUT denotes malformed/unsupported data; EVIDENCE denotes identity/capture contradictions.
 * Captures/context are host inputs, not a mechanism for repository JSON to self-attest.
 * Host acquisition, currentness and authority enforcement belong to the next increment.
 */
export function normalizeGitHubRepositoryObservation(observation, context) {
  object(observation, ['repository', 'branch', 'defaultBranch', 'observedAt', 'evidenceRef'],
    ['repository', 'branch', 'observedAt', 'evidenceRef']);
  object(context, ['connection', 'repositoryId', 'repositoryNodeId',
    'canonicalLocalRepositoryPath', 'remoteRepositoryURL', 'remoteDirection',
    'selectedRemote', 'branchRef'],
  ['connection', 'repositoryId', 'repositoryNodeId', 'canonicalLocalRepositoryPath',
    'remoteRepositoryURL', 'remoteDirection', 'selectedRemote', 'branchRef']);
  object(observation.repository, ['requestUrl', 'body'], ['requestUrl', 'body']);
  const body = observation.repository.body;
  const repository = normalizeGitHubRepositoryIdentity(body, {
    connection: context.connection,
  });
  requireThat(repository.repositoryId === validateGitHubId(context.repositoryId,
    'trusted GitHub repository ID') &&
    repository.repositoryNodeId === validateGitHubNodeId(context.repositoryNodeId),
  'EVIDENCE', 'GitHub repository numeric or node ID differs from the trusted context');
  const apiUrl = `https://api.github.com/repos/${repository.owner}/${repository.name}`;
  captureBody(observation.repository, apiUrl, 'repository');
  object(body, ['id', 'node_id', 'name', 'full_name', 'owner', 'html_url',
    'clone_url', 'ssh_url', 'default_branch'],
  ['clone_url', 'ssh_url', 'default_branch']);
  requireThat(body.clone_url === `${repository.url}.git` &&
    body.ssh_url === `git@github.com:${repository.owner}/${repository.name}.git`,
  'EVIDENCE', 'GitHub clone URLs do not identify the captured repository');
  choice(context.remoteDirection, ['fetch', 'push'], 'GitHub selected remote direction');
  const selectedUrl = context.remoteDirection === 'fetch' ?
    validateSelectedFetchRemote(context.selectedRemote) :
    validateSelectedPushRemote(context.selectedRemote);
  requireThat(selectedUrl === context.remoteRepositoryURL &&
    [body.clone_url, body.ssh_url].includes(selectedUrl), 'EVIDENCE',
  'GitHub repository does not prove the exact selected fetch or effective push URL');
  requireThat(typeof body.default_branch === 'string', 'INPUT',
    'GitHub default branch must be the provider-observed branch name');
  const defaultBranchRef = validateGitHubBranchRef(`refs/heads/${body.default_branch}`);
  const branch = verifiedBranch(observation.branch, context.branchRef, apiUrl);
  const defaultBranch = observation.defaultBranch === undefined ? undefined :
    verifiedBranch(observation.defaultBranch, defaultBranchRef, apiUrl);
  requireThat(defaultBranch === undefined || defaultBranch.branchRef !== branch.branchRef ||
    defaultBranch.revision === branch.revision, 'EVIDENCE',
  'GitHub selected and default branch captures contain contradictory revisions');
  const verification = {
    canonicalLocalRepositoryPath: context.canonicalLocalRepositoryPath,
    verifiedRemoteRepositoryURL: selectedUrl, verifiedProvider: repository.provider,
    verifiedConnection: repository.connection, verifiedRepositoryRef: repository.repositoryRef,
    verifiedBranch: branch,
  };
  const normalized = validateRepositoryObservation({
    localRepositoryPath: context.canonicalLocalRepositoryPath, remoteRepositoryURL: selectedUrl,
    provider: repository.provider, connection: repository.connection,
    repositoryRef: repository.repositoryRef, revision: branch.revision,
    ...(branch.branchRef === defaultBranchRef || defaultBranch !== undefined ?
      { defaultBranchRef } : {}),
    verifiedBranch: branch, observedAt: observation.observedAt, evidenceRef: observation.evidenceRef,
  }, verification);
  return { repository, observation: normalized, verification };
}
