import { requireThat, text } from '../core.mjs';

/** Preserve canonical positive decimal IDs; unsafe JSON numbers cannot be recovered. */
export function validateGitHubId(value, label = 'GitHub provider ID') {
  requireThat((Number.isSafeInteger(value) && value > 0) ||
    (typeof value === 'string' && /^[1-9][0-9]{0,99}$/u.test(value)),
  'INPUT', `${label} must be an exact positive integer`);
  return String(value);
}

/** Node IDs are opaque provider values, never decoded to manufacture numeric ID proof. */
export function validateGitHubNodeId(value) {
  text(value, 'GitHub node ID');
  requireThat(/^[A-Za-z0-9_+/=-]+$/u.test(value), 'INPUT',
    'GitHub node ID must be a normalized opaque provider identifier');
  return value;
}

export function validateGitHubConnection(value) {
  text(value, 'GitHub connection');
  requireThat(value === value.trim() && !/[\r\n\t]/u.test(value), 'INPUT',
    'GitHub connection must be normalized');
  return value;
}

export function githubRepositoryScopeRef(repositoryId) {
  return `repository:${validateGitHubId(repositoryId, 'GitHub repository ID')}`;
}

/** This foundation supports GitHub's documented SHA-1 repository/branch response contract. */
export function validateGitHubRevision(value) {
  requireThat(typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value),
    'INPUT', 'GitHub revision must be a full lowercase SHA-1 commit ID');
  return value;
}

export function validateGitHubBranchRef(value) {
  text(value, 'GitHub branch ref', 1024);
  requireThat(value.startsWith('refs/heads/') &&
    !/[\s\\~^:?*[\]\u0000-\u001f\u007f]/u.test(value) &&
    !value.includes('..') && !value.includes('@{') &&
    value.slice('refs/heads/'.length).split('/').every(component =>
      component.length > 0 && !component.startsWith('.') &&
      !component.endsWith('.') && !component.endsWith('.lock')),
  'INPUT', 'GitHub branch must be an exact full refs/heads ref');
  return value;
}

/** Queries/fragments are unsupported here, so credentials cannot be retained in either. */
export function validateGitHubWebUrl(value, label = 'GitHub URL') {
  text(value, label, 2048);
  requireThat(!/[\s\\]/u.test(value), 'INPUT',
    `${label} must be a canonical credential-free HTTPS URL`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    requireThat(false, 'INPUT', `${label} must be a valid HTTPS URL`);
  }
  requireThat(parsed.protocol === 'https:' && !parsed.username && !parsed.password &&
    !parsed.search && !parsed.hash && parsed.href === value,
  'INPUT', `${label} must be a canonical credential-free HTTPS URL without a query or fragment`);
  return parsed;
}
