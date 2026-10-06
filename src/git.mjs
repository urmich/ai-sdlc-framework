import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { canonicalPath, safePath, readBytes } from './files.mjs';
import { requireThat, id, object, text, digest, SdlcError, LIMITS } from './core.mjs';
import { sameNativePath } from './platform.mjs';

const execute = promisify(execFile);
export function gitEnvironment(environment = process.env) {
  return { ...environment, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', LANG: 'C' };
}
export async function git(cwd, args, { optional = false, maxBuffer = LIMITS.artifact, trim = true } = {}) {
  try {
    const result = await execute('git', ['--no-pager', '--no-optional-locks', ...args], {
      cwd, encoding: 'utf8', maxBuffer, timeout: 5000,
      env: gitEnvironment(),
    });
    return trim ? result.stdout.trimEnd() : result.stdout;
  } catch (error) {
    if (optional && error.code === 1) return null;
    throw new SdlcError('GIT', `Git ${args[0]} failed`, { cause: error.stderr?.trim() || error.message });
  }
}
export async function identity(cwd, repositoryId) {
  id(repositoryId, 'repository ID');
  const root = await canonicalPath(await git(cwd, ['rev-parse', '--show-toplevel']));
  const commonDir = await canonicalPath(await git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
  const gitDir = await canonicalPath(await git(root, ['rev-parse', '--absolute-git-dir']));
  const branch = await git(root, ['symbolic-ref', '-q', 'HEAD'], { optional: true });
  requireThat(branch?.startsWith('refs/heads/'), 'BINDING', 'Detached HEAD requires an explicitly selected branch/worktree');
  const head = await git(root, ['rev-parse', '--verify', '-q', 'HEAD'], { optional: true });
  return { repositoryId, root, commonDir, branch, head, linkedWorktree: !sameNativePath(gitDir, commonDir),
    defaultBranch: null };
}
export function validateRemoteName(name) {
  requireThat(typeof name === 'string' && name.length > 0 &&
    name.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name) &&
    name !== '.' && name !== '..' && !name.endsWith('.lock'), 'INPUT',
  'Select an actual Git remote by name');
  return name;
}
async function selectedRemoteName(member, configuredName, requestedName, direction) {
  await validateBinding(member);
  if (configuredName !== undefined) validateRemoteName(configuredName);
  if (requestedName !== undefined) validateRemoteName(requestedName);
  requireThat(!configuredName || !requestedName || configuredName === requestedName,
    'CONFIG', 'Selected Git remote conflicts with repository configuration');
  const names = (await git(member.root, ['remote'])).split(/\r?\n/u).filter(Boolean);
  const name = configuredName ?? requestedName ?? (names.length === 1 ? names[0] : undefined);
  requireThat(name, 'EVIDENCE',
    `Select a Git remote: no unique current ${direction} destination is available`);
  requireThat(names.includes(name), 'EVIDENCE', 'Selected Git remote does not exist');
  return name;
}
export async function selectedFetchRemote(member, configuredName, requestedName) {
  const name = await selectedRemoteName(member, configuredName, requestedName, 'fetch');
  const fetchURLs = (await git(member.root, ['remote', 'get-url', '--all', name]))
    .split(/\r?\n/u).filter(Boolean);
  return { selectedRemoteName: name, fetchURLs };
}
export async function selectedPushRemote(member, configuredName, requestedName) {
  const name = await selectedRemoteName(member, configuredName, requestedName, 'push');
  const pushURLs = (await git(member.root, ['remote', 'get-url', '--push', '--all', name]))
    .split(/\r?\n/u).filter(Boolean);
  return { selectedRemoteName: name, pushURLs };
}
export function bindingKey(member) { return digest({ root: member.root, commonDir: member.commonDir, branch: member.branch }); }
export function sameBinding(left, right) {
  return left.repositoryId === right.repositoryId &&
    sameNativePath(left.root, right.root) &&
    sameNativePath(left.commonDir, right.commonDir) &&
    left.branch === right.branch;
}
export async function validateBinding(member) {
  const current = await identity(member.root, member.repositoryId);
  requireThat(sameBinding(member, current), 'BINDING', 'Repository/worktree/branch changed; explicitly bind and resume before mutation');
  return current;
}
export async function publicationPaths(member, sourceRevision, targetRevision) {
  for (const [label, revision] of [['source', sourceRevision], ['target', targetRevision]]) {
    requireThat(typeof revision === 'string' && /^[a-f0-9]{40,64}$/u.test(revision), 'INPUT',
      `Early draft ${label} revision must be a full commit ID`);
    await git(member.root, ['cat-file', '-e', `${revision}^{commit}`]);
  }
  requireThat((await git(member.root, ['rev-parse', 'HEAD'])) === sourceRevision,
    'STALE', 'Early draft source revision is no longer the bound worktree HEAD');
  return (await git(member.root, ['diff', '--name-only', '-z', `${targetRevision}..${sourceRevision}`, '--']))
    .split('\0').filter(Boolean).sort();
}
export async function verifyPublicationBase(member, remote, baseRef, targetRevision,
  records, clock = Date, destination = {}) {
  requireThat(/^[A-Za-z0-9._-]+$/u.test(remote), 'INPUT', 'Early draft push needs a configured remote name');
  requireThat(typeof baseRef === 'string' && /^refs\/heads\/[A-Za-z0-9._/-]+$/u.test(baseRef) &&
    !baseRef.includes('..') && !baseRef.endsWith('/'),
    'INPUT', 'Early draft push needs the intended PR target branch');
  await git(member.root, ['check-ref-format', baseRef]);
  object(destination, ['actionClass', 'remoteRepositoryURL', 'configuredRemote']);
  const publicationClass = destination.actionClass ?? 'push';
  requireThat(['push', 'pr-create', 'pr-update'].includes(publicationClass),
    'INPUT', 'Early draft requires a push or PR publication action');
  let selectedURL;
  if (publicationClass === 'push') {
    const push = await selectedPushRemote(member, undefined, remote);
    requireThat(push.pushURLs.length === 1 &&
      (destination.remoteRepositoryURL === undefined ||
        push.pushURLs[0] === destination.remoteRepositoryURL), 'EVIDENCE',
    'Early draft requires the current selected push destination');
    selectedURL = push.pushURLs[0];
  } else {
    requireThat(typeof destination.remoteRepositoryURL === 'string', 'EVIDENCE',
      'Early draft PR requires an exact approved hosting URL');
    const { selectedPublicationRepositoryURL } =
      await import('./repository-observations.mjs');
    selectedURL = (await selectedPublicationRepositoryURL(member,
      destination.configuredRemote, destination.remoteRepositoryURL,
      remote)).remoteRepositoryURL;
  }
  requireThat(Array.isArray(records), 'EVIDENCE',
    'Early draft requires a trusted hosted branch observation');
  const observations = records.filter(record =>
    record.type === 'repository-observation' &&
    record.repositoryId === member.repositoryId &&
    record.localRepositoryPath === member.root &&
    record.remoteRepositoryURL === selectedURL)
    .sort((left, right) => right.observedAt.localeCompare(left.observedAt));
  const latest = observations[0];
  requireThat(latest && (observations.length === 1 ||
    observations[1].observedAt !== latest.observedAt ||
    digest(observations[1]) === digest(latest)), 'EVIDENCE',
  'Early draft has no unambiguous current hosted branch observation');
  requireThat(latest.verifiedBranch?.branchRef === baseRef &&
    latest.verifiedBranch.revision === targetRevision, 'EVIDENCE',
  'Early draft base branch and revision are not proven for the selected hosted destination');
  const age = clock.now() - Date.parse(latest.observedAt);
  requireThat(Number.isFinite(age) && age >= 0 && age <= 60_000, 'STALE',
    'Early draft hosted branch observation is older than 60 seconds or from the future');
  await git(member.root, ['cat-file', '-e', `${targetRevision}^{commit}`]);
  return latest.verifiedBranch.revision;
}
export async function contentSnapshot(member, relative) {
  const file = await safePath(member.root, relative);
  const bytes = await readBytes(file, LIMITS.artifact);
  return { repositoryId: member.repositoryId, path: relative, digest: digest(bytes), bytes };
}
export async function history(member, boundary = null) {
  await validateBinding(member);
  if (!member.head && !(await identity(member.root, member.repositoryId)).head) return [];
  if (boundary) text(boundary, 'history boundary', 128);
  const range = boundary ? `${boundary}..HEAD` : 'HEAD';
  requireThat(!range.startsWith('-'), 'INPUT', 'Invalid revision');
  const output = await git(member.root, ['log', '--reverse', '--format=%H%x00%B%x00%x1e', range, '--']);
  return output.split('\x1e').map(row => row.trim()).filter(Boolean).map(row => {
    const [commit, message] = row.split('\0');
    return { repositoryId: member.repositoryId, commit, message };
  });
}
export async function commitMessage(member, commit) {
  requireThat(/^[a-f0-9]{40,64}$/u.test(commit), 'INPUT', 'Use a full Git commit ID');
  await git(member.root, ['merge-base', '--is-ancestor', commit, 'HEAD']);
  return git(member.root, ['show', '-s', '--format=%B', commit, '--']);
}
