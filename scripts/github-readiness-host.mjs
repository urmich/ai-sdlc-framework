import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createGitHubConnection, createGitHubTransport, requireGitHubCapture } from 'ai-sdlc-framework/github';
import { digest, requireThat, SdlcError } from '../src/core.mjs';
import { validateDisposableProbeRequest, planDisposableStatusUpdate } from './pr-readiness.mjs';

const execute = promisify(execFile);
const clients = new WeakSet();
const revision = /^[a-f0-9]{40}$/u;
const hash = /^[a-f0-9]{64}$/u;
const maxSourceBytes = 64 * 1024 * 1024;
const permissions = Object.freeze([
  { name: 'contents', level: 'read' }, { name: 'actions', level: 'read' },
  { name: 'pull-requests', level: 'read' }, { name: 'statuses', level: 'write' },
]);
const threadsDocument = `query ReadinessThreads($owner:String!,$name:String!,$number:Int!,$after:String) {
  repository(owner:$owner,name:$name) {
    databaseId
    pullRequest(number:$number) {
      number headRefOid
      reviewThreads(first:100,after:$after) {
        nodes { id isResolved }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

export function createReadinessGitHubClient({
  repository, repositoryId, writerId, token, generation, archiveOrigins = [], fetch = globalThis.fetch,
  python = process.env.SDLC_OBSERVER_PYTHON || process.env.SDLC_PYTHON || 'python3',
  scratchDirectory = fileURLToPath(new URL('../.test-data/', import.meta.url)),
}) {
  requireThat(/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/u.test(repository) &&
    Number.isSafeInteger(repositoryId) && repositoryId > 0 &&
    Number.isSafeInteger(writerId) && writerId > 0,
  'INPUT', 'Bind the observer to independently selected repository and writer identities');
  const [owner, name] = repository.split('/');
  const proofScope = `repository:${repositoryId}`;
  const connection = createGitHubConnection({
    id: 'repository-readiness', apiOrigin: 'https://api.github.com', webOrigin: 'https://github.com',
    scopes: [{ kind: 'repository', id: repositoryId, owner, name }],
    profiles: [
      { id: '2022-11-28', kind: 'rest', apiVersion: '2022-11-28' },
      { id: 'readiness-threads-v1', kind: 'graphql', schemaVersion: 'review-threads-v1' },
    ],
    archiveOrigins,
    credentialResolver: () => ({
      apiOrigin: 'https://api.github.com', tokenClass: 'app-installation', token,
      generation, actorVisibility: `readiness-writer-${writerId}`, permissions,
    }),
  });
  const transport = createGitHubTransport({
    connection, fetch, maxResponseBytes: 8 * 1024 * 1024,
    maxPages: 100, timeoutMs: 30000,
  });
  const archiveTransport = createGitHubTransport({
    connection, fetch, maxResponseBytes: 128 * 1024 * 1024,
    maxPages: 100, timeoutMs: 30000,
  });
  const prefix = `/repos/${owner}/${name}`;
  const conditionals = new Map();
  let observation = 0;
  const request = (relative, options = {}) => transport.buildRestRequest({
    method: 'GET', path: `${prefix}${relative}`, profile: '2022-11-28',
    mediaType: 'application/vnd.github+json', expectedStatuses: [200],
    proofScope, tokenClasses: ['app-installation'], ...options,
  });
  const get = async relative => {
    const capture = await transport.execute(request(relative), conditionals.has(relative) ?
      { cacheEntry: conditionals.get(relative) } : {});
    requireGitHubCapture(capture, connection);
    if (capture.status === 200 && typeof capture.headers.etag === 'string') {
      conditionals.set(relative, transport.createCacheEntry(capture, {
        observationVersion: `readiness-${++observation}`,
      }));
    }
    return capture.body;
  };
  const list = async (relative, field) => {
    const acquired = await transport.paginateRest(request(relative));
    requireThat(acquired.pagination.complete === true, 'PROOF_GAP', 'Required API pagination is incomplete');
    return acquired.pages.flatMap(page => {
      requireGitHubCapture(page, connection);
      const rows = field === undefined ? page.body : page.body?.[field];
      requireThat(Array.isArray(rows) && rows.every(row => row && Object.getPrototypeOf(row) === Object.prototype),
        'CONTRACT', 'Required provider collection must contain literal provider records');
      if (field === 'artifacts') {
        requireThat(/^\/actions\/runs\/[1-9]\d*\/artifacts\?/u.test(relative),
          'SCOPE', 'Acquire artifact metadata from an exact selected run');
        for (const row of rows) {
          requireThat(row && typeof row === 'object', 'CONTRACT', 'Artifact metadata must be an actual provider record');
          artifactOrigins.set(row, relative);
        }
      }
      return rows;
    });
  };
  const blobs = new Map();
  const trees = new Map();
  const artifacts = new Map();
  const disposableCapabilities = new WeakMap();
  const artifactOrigins = new WeakMap();
  let sourceBytes = 0;
  async function tree(sha) {
    requireThat(revision.test(sha), 'INPUT', 'Read source by an exact immutable commit');
    if (!trees.has(sha)) trees.set(sha, (async () => {
      const commit = await get(`/git/commits/${sha}`);
      requireThat(commit.sha === sha && revision.test(commit.tree?.sha),
        'EVIDENCE', 'Provider commit/tree identity is inconsistent');
      const data = await get(`/git/trees/${commit.tree.sha}?recursive=1`);
      requireThat(data.sha === commit.tree.sha && data.truncated === false && Array.isArray(data.tree),
        'PROOF_GAP', 'The complete source tree is required');
      const paths = new Map();
      for (const entry of data.tree) {
        requireThat(typeof entry.path === 'string' && !entry.path.includes('\\') &&
          !/[:\u0000-\u001f]/u.test(entry.path) && entry.path.split('/').every(part =>
            part && part !== '.' && part !== '..') && !paths.has(entry.path),
        'EVIDENCE', 'Provider tree paths must be literal and unique');
        paths.set(entry.path, entry);
      }
      return { revision: sha, treeSha: commit.tree.sha, paths };
    })());
    return trees.get(sha);
  }
  async function file(source, file) {
    const entry = source.paths.get(file);
    requireThat(entry?.type === 'blob' && ['100644', '100755'].includes(entry.mode) &&
      revision.test(entry.sha) && Number.isSafeInteger(entry.size) && entry.size <= 4 * 1024 * 1024,
    'EVIDENCE', 'Required source is absent, linked or oversized');
    if (!blobs.has(entry.sha)) blobs.set(entry.sha, (async () => {
      const data = await get(`/git/blobs/${entry.sha}`);
      requireThat(data.sha === entry.sha && data.encoding === 'base64' && typeof data.content === 'string' &&
        /^[A-Za-z0-9+/=\r\n]*$/u.test(data.content),
      'EVIDENCE', 'Source blob encoding or identity is invalid');
      const bytes = Buffer.from(data.content.replace(/[\r\n]/gu, ''), 'base64');
      const actual = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      sourceBytes += bytes.length;
      requireThat(actual === entry.sha && bytes.length === entry.size && data.size === bytes.length &&
        sourceBytes <= maxSourceBytes, 'EVIDENCE', 'Source bytes differ from the complete bounded Git inventory');
      try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch (error) {
        if (error.code !== 'ERR_ENCODING_INVALID_ENCODED_DATA') throw error;
        throw new SdlcError('EVIDENCE', 'Required source is not supported UTF-8 text');
      }
    })());
    return blobs.get(entry.sha);
  }
  async function threads(number, headSha) {
    requireThat(Number.isSafeInteger(number) && number > 0 && revision.test(headSha),
      'INPUT', 'Select actual PR/head identities for conversation reads');
    const selected = transport.buildGraphQLRequest({
      documentId: 'readiness-threads-v1', document: threadsDocument,
      operationName: 'ReadinessThreads', operationKind: 'query',
      variables: { owner, name, number, after: null }, schemaProfile: 'readiness-threads-v1',
      proofScope, tokenClasses: ['app-installation'],
      validateData: data => data.repository?.databaseId === repositoryId &&
        data.repository.pullRequest?.number === number &&
        data.repository.pullRequest.headRefOid === headSha &&
        Array.isArray(data.repository.pullRequest.reviewThreads?.nodes) &&
        data.repository.pullRequest.reviewThreads.nodes.every(row =>
          typeof row.id === 'string' && typeof row.isResolved === 'boolean') &&
        typeof data.repository.pullRequest.reviewThreads.pageInfo?.hasNextPage === 'boolean',
    });
    const result = await transport.paginateGraphQL(selected, {
      cursorVariable: 'after',
      readPageInfo: data => data.repository.pullRequest.reviewThreads.pageInfo,
    });
    const rows = result.pages.flatMap(page => page.body.data.repository.pullRequest.reviewThreads.nodes);
    requireThat(new Set(rows.map(row => row.id)).size === rows.length, 'PROOF_GAP', 'Duplicate review-thread identities');
    return { complete: result.pagination.complete, headSha,
      unresolved: rows.filter(row => !row.isResolved).length,
      fingerprint: digest([...rows].sort((left, right) => left.id.localeCompare(right.id))) };
  }
  async function conversationRule(branch) {
    requireThat(typeof branch === 'string' && branch.length > 0 && branch.length <= 255,
      'INPUT', 'Conversation enforcement must be observed on the actual target branch');
    let capture;
    try { capture = await transport.execute(request(`/branches/${encodeURIComponent(branch)}/protection`)); }
    catch (error) {
      if (!(error instanceof SdlcError) || !['PERMISSION', 'INACCESSIBLE'].includes(error.code)) throw error;
      return { observed: false, conversations: false,
        capability: error.code === 'PERMISSION' ? 'Denied' : 'Unavailable',
        providerStatus: error.code === 'PERMISSION' ? 403 : 404 };
    }
    requireGitHubCapture(capture, connection);
    return { observed: true,
      conversations: capture.body.required_conversation_resolution?.enabled === true,
      capability: 'Available' };
  }
  async function bytes(relative) {
    const selected = archiveTransport.buildRestRequest({
      method: 'GET', path: `${prefix}${relative}`, profile: '2022-11-28',
      mediaType: 'application/vnd.github+json', expectedStatuses: [200],
      proofScope, tokenClasses: ['app-installation'], responseType: 'bytes',
    });
    const capture = await archiveTransport.downloadArchive(selected);
    requireGitHubCapture(capture, connection);
    return Buffer.from(capture.body);
  }
  async function artifact(metadata, { kind = 'native' } = {}) {
    requireThat(artifactOrigins.has(metadata) && Number.isSafeInteger(metadata.id) &&
      metadata.id > 0 && metadata.expired === false &&
      /^sha256:[a-f0-9]{64}$/u.test(metadata.digest ?? '') &&
      Number.isSafeInteger(metadata.size_in_bytes) && metadata.size_in_bytes > 0 &&
      metadata.size_in_bytes <= 128 * 1024 * 1024,
    'EVIDENCE', 'Native evidence needs a current digest-bound provider artifact');
    requireThat(['native', 'candidate', 'cleanup'].includes(kind), 'INPUT', 'Select a declared data-only artifact format');
    const key = `${metadata.id}:${metadata.digest}:${kind}`;
    if (!artifacts.has(key)) artifacts.set(key, (async () => {
      const archive = await bytes(`/actions/artifacts/${metadata.id}/zip`);
      requireThat(digest(archive) === metadata.digest.slice(7), 'DIGEST', 'Downloaded Actions artifact digest mismatch');
      const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
      requireThat(typeof scratchDirectory === 'string', 'SCOPE', 'Artifact scratch must be an explicit owned directory');
      const parent = path.resolve(scratchDirectory);
      const relative = path.relative(sourceRoot, parent);
      requireThat(relative.split(path.sep)[0] === '.test-data' && !relative.split(path.sep).includes('..') &&
        !path.isAbsolute(relative), 'SCOPE', 'Artifact scratch must stay in owned checkout-local .test-data');
      let current = sourceRoot;
      for (const part of relative.split(path.sep)) {
        current = path.join(current, part);
        await fs.mkdir(current).catch(error => { if (error.code !== 'EEXIST') throw error; });
        const stat = await fs.lstat(current);
        requireThat(stat.isDirectory() && !stat.isSymbolicLink(), 'SCOPE', 'Artifact scratch cannot traverse linked storage');
      }
      const root = await fs.mkdtemp(path.join(parent, 'readiness-data-'));
      try {
        const zip = path.join(root, 'results.zip');
        await fs.writeFile(zip, archive, { flag: 'wx' });
        const reader = fileURLToPath(new URL('./read-validation-artifact.py', import.meta.url));
        let result;
        try {
          result = await execute(python, ['-I', '-S', '-B', reader, '--archive', zip, '--kind', kind], {
            cwd: root, env: { ...process.env, PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1' },
            maxBuffer: 128 * 1024 * 1024, timeout: 120000,
          });
        } catch (error) {
          if (error.code === 'ENOENT') throw new SdlcError('HOST', 'The pinned standard-library artifact reader is unavailable');
          if (typeof error.code === 'number' || error.killed) {
            throw new SdlcError('EVIDENCE', 'Artifact data failed bounded, non-executing validation');
          }
          throw error;
        }
        try {
          const data = JSON.parse(result.stdout);
          requireThat(data.texts && Array.isArray(data.files), 'CONTRACT', 'Artifact reader omitted its original data inventory');
          return { ...Object.fromEntries(Object.entries(data.texts).filter(([file]) =>
            file.endsWith('.json')).map(([file, text]) => [file, JSON.parse(text)])),
          texts: data.texts, files: data.files };
        }
        catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
          throw new SdlcError('CONTRACT', 'Artifact reader did not return valid bounded result data');
        }
      } finally {
        await fs.rm(root, { recursive: true });
      }
    })());
    return artifacts.get(key);
  }
  async function publish(key, value) {
    requireThat(key.repositoryId === repositoryId && revision.test(key.sha) &&
      ['framework/validation', 'framework/approval', 'framework/coverage'].includes(key.context),
    'SCOPE', 'Status dispatch must stay within the selected repository/SHA/context');
    const selected = request(`/statuses/${key.sha}`, {
      method: 'POST', expectedStatuses: [201], payload: { ...value, context: key.context },
      permissions: [{ name: 'statuses', level: 'write' }],
    });
    const claim = digest({ key, value, generation });
    conditionals.clear();
    const capture = await transport.execute(selected, { actionAuthority: {
      operationId: `status-${claim}`, authorityRef: `trusted-workflow-${generation}`,
      dispatchClaimId: `dispatch-${claim}`,
    } });
    requireGitHubCapture(capture, connection);
    requireThat(capture.body.context === key.context && capture.body.creator?.id === writerId,
      'EVIDENCE', 'Actual status writer/context differs from the selected provider identity');
    return { ...capture.body, creatorId: capture.body.creator.id };
  }
  async function disposableFacts(scope) {
    const repository = await get('');
    requireThat(repository?.id === repositoryId && repository.full_name === scope.repository &&
      repository.owner?.type === 'User' && Number.isSafeInteger(repository.owner.id) &&
      typeof repository.default_branch === 'string' &&
      ![scope.headRef, scope.baseRef].includes(repository.default_branch), 'SCOPE',
    'Disposable probes may not select the default or a foreign repository branch');
    const [branch, pr] = await Promise.all([
      get(`/branches/${encodeURIComponent(repository.default_branch)}`), get(`/pulls/${scope.prNumber}`),
    ]);
    requireThat(branch?.commit?.sha === scope.sourceCommit && scope.headSha !== scope.sourceCommit &&
      pr?.state === 'open' && pr.number === scope.prNumber && Number.isSafeInteger(pr.user?.id) && pr.user.id > 0 &&
      pr.base?.repo?.id === repositoryId && pr.head?.repo?.id === repositoryId &&
      pr.head.ref === scope.headRef && pr.base.ref === scope.baseRef &&
      pr.head.sha === scope.headSha && pr.base.sha === scope.baseSha &&
      pr.merge_commit_sha === scope.mergeSha && pr.mergeable === true,
    'SCOPE', 'The exact precreated disposable PR/ref/source tuple changed or is unavailable');
    const capture = await transport.execute(request(`/branches/${encodeURIComponent(scope.baseRef)}/protection`));
    requireGitHubCapture(capture, connection);
    const protection = capture.body;
    const checks = protection?.required_status_checks?.checks;
    requireThat(digest(protection) === scope.protectionDigest && Array.isArray(checks) &&
      checks.length === scope.contexts.length && scope.contexts.every(context =>
        checks.some(check => check.context === context && check.app_id === scope.statusAppId)),
    'SCOPE', 'The disposable branch must already require exactly the independently approved disposable contexts/app');
    return { repository: { id: repository.id, fullName: repository.full_name, ownerId: repository.owner.id,
      defaultBranch: repository.default_branch, sourceCommit: branch.commit.sha },
    pr: { number: pr.number, authorId: pr.user?.id, headRef: pr.head.ref, baseRef: pr.base.ref,
      headSha: pr.head.sha, baseSha: pr.base.sha, mergeSha: pr.merge_commit_sha,
      mergeable: pr.mergeable, mergeState: pr.mergeable_state },
    protection, protectionDigest: digest(protection), authorizationSource: capture };
  }
  async function authorizeDisposableProbe(input, authorize) {
    const scope = validateDisposableProbeRequest(input, { repository, repositoryId, writerId });
    if (typeof authorize !== 'function') return { status: 'NotRun', activity: 'blocked',
      blocker: { code: 'MISSING_SCOPED_AUTHORITY', message: 'An in-process scoped authorizer is required; JSON approval flags grant nothing' } };
    try {
      const facts = await disposableFacts(scope);
      const { authorizationSource, ...publicFacts } = facts;
      const existing = await list(`/commits/${scope.headSha}/statuses?per_page=100`);
      if (existing.some(item => scope.contexts.includes(item.context))) return {
        status: 'NotRun', activity: 'blocked', blocker: { code: 'DISPOSABLE_HISTORY_EXISTS',
          message: 'Original disposable attempts already exist; reconcile them instead of replacing their identity or retrying automatically' },
      };
      if (await authorize({ request: structuredClone(scope), requestDigest: digest(input), facts: publicFacts }) !== true) {
        return { status: 'NotRun', activity: 'blocked',
          blocker: { code: 'MISSING_SCOPED_AUTHORITY', message: 'The exact disposable operation has not been authorized' } };
      }
      const capability = Object.freeze(Object.create(null));
      disposableCapabilities.set(capability, { scope: structuredClone(scope),
        requestDigest: digest(input), authorizationSource });
      return { status: 'NotRun', activity: 'authorized', capability, facts: publicFacts,
        scope: structuredClone(scope), requestDigest: digest(input) };
    } catch (error) {
      if (!(error instanceof SdlcError)) throw error;
      return { status: 'NotRun', activity: 'blocked', blocker: { code: error.code,
        ...(['PERMISSION', 'INACCESSIBLE'].includes(error.code) ? {
          capability: error.code === 'PERMISSION' ? 'Denied' : 'Unavailable',
        } : {}),
        message: error.message } };
    }
  }
  async function publishDisposable(capability, value) {
    const authority = disposableCapabilities.get(capability);
    requireThat(authority, 'AUTHORITY', 'Disposable publication requires this client’s opaque in-process scoped capability');
    const { scope } = authority;
    const facts = await disposableFacts(scope);
    const { authorizationSource, ...publicFacts } = facts;
    const history = await list(`/commits/${scope.headSha}/statuses?per_page=100`);
    const update = planDisposableStatusUpdate(scope, {
      complete: true, items: history.map(item => ({ ...item, creatorId: item.creator?.id })),
    }, value);
    if (update.action !== 'write') return { status: 'NotRun', ...update, facts: publicFacts };
    const selected = request(`/statuses/${scope.headSha}`, {
      method: 'POST', expectedStatuses: [201],
      payload: { context: value.context, state: update.state, description: update.description },
      permissions: [{ name: 'statuses', level: 'write' }],
    });
    const claim = digest({ request: authority.requestDigest, context: value.context, count: update.count,
      state: update.state, description: update.description, generation });
    conditionals.clear();
    const capture = await transport.execute(selected, {
      authorizationSource: authority.authorizationSource,
      actionAuthority: { operationId: `disposable-${claim}`,
        authorityRef: `owner-disposable-${scope.id}-${authority.requestDigest}`, dispatchClaimId: `dispatch-${claim}` },
    });
    requireGitHubCapture(capture, connection);
    requireThat(capture.body.creator?.id === writerId && capture.body.context === value.context &&
      capture.body.state === update.state && capture.body.description === update.description, 'EVIDENCE',
    'The actual disposable status response differs from the selected writer/context/outcome');
    return { status: 'NotRun', ...update, record: capture.body };
  }
  async function observeDisposable(capability) {
    const authority = disposableCapabilities.get(capability);
    requireThat(authority, 'AUTHORITY', 'Disposable observations require the authenticated scoped capability');
    conditionals.clear();
    const facts = await disposableFacts(authority.scope);
    const { authorizationSource, ...publicFacts } = facts;
    return publicFacts;
  }
  const client = Object.freeze({ repository, repositoryId, writerId, get, list, tree, file,
    threads, conversationRule, artifact, bytes, publish,
    authorizeDisposableProbe, publishDisposable, observeDisposable });
  clients.add(client);
  return client;
}

export function requireReadinessGitHubClient(client) {
  requireThat(clients.has(client), 'HOST', 'Use the trusted in-process GitHub acquisition capability');
  return client;
}
