import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { canonicalPath, safePath, readBytes } from './files.mjs';
import { requireThat, id, text, digest, SdlcError, LIMITS } from './core.mjs';
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
  const defaultBranch = await git(root, ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD'], { optional: true });
  return { repositoryId, root, commonDir, branch, head, linkedWorktree: !sameNativePath(gitDir, commonDir),
    defaultBranch: defaultBranch?.replace('refs/remotes/origin/', 'refs/heads/') ?? null };
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
  const base = await git(member.root, ['merge-base', sourceRevision, targetRevision]);
  return (await git(member.root, ['diff', '--name-only', '-z', `${base}..${sourceRevision}`, '--']))
    .split('\0').filter(Boolean).sort();
}
export async function verifyPublicationBase(member, remote, baseRef, targetRevision) {
  requireThat(/^[A-Za-z0-9._-]+$/u.test(remote), 'INPUT', 'Early draft push needs a configured remote name');
  requireThat(typeof baseRef === 'string' && /^refs\/heads\/[A-Za-z0-9._/-]+$/u.test(baseRef) &&
    !baseRef.includes('..') && !baseRef.endsWith('/'),
    'INPUT', 'Early draft push needs the intended PR target branch');
  await git(member.root, ['check-ref-format', baseRef]);
  const trackingRef = `refs/remotes/${remote}/${baseRef.slice('refs/heads/'.length)}`;
  const actual = await git(member.root, ['show-ref', '--verify', '--hash', trackingRef]);
  requireThat(actual === targetRevision, 'STALE',
    'Early draft comparison revision does not match the intended remote PR target');
  return trackingRef;
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
