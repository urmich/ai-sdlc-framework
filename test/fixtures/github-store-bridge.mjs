import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { coding, fixture, grant, orient } from '../helpers.mjs';
import { Store } from '../../src/store.mjs';
import { digest, requireThat } from '../../src/core.mjs';
import { candidateContentDigest, candidateSnapshot, recordArtifact, recordTest, startCycle } from '../../src/validation.mjs';
import { loadConfig, resolveTestSpecification } from '../../src/artifacts.mjs';
import { createGitHubConnection } from '../../src/github/connection.mjs';
import { createGitHubTransport, requireGitHubCapture } from '../../src/github/transport.mjs';
import { requireGitHubRequestBinding } from '../../src/github/transport.mjs';
import { normalizeGitHubRepositoryIdentity, normalizeGitHubRepositoryObservation } from '../../src/github/repository.mjs';
import { validatePullRequestObservation } from '../../src/repository-observations.mjs';
import { createGitHubStoreBridge } from '../../src/github/store-bridge.mjs';

export const families = Object.freeze([
  'execution', 'test', 'artifact', 'deployment', 'pull-request', 'git-ref', 'merge', 'policy', 'notification',
]);
export const remote = 'https://github.com/bridge-owner/bridge-repo.git';
export const connectionId = 'bridge-fixture';
export const repositoryRef = 'repository:101';
export const configurationDigest = 'bridge-config-v1';
export const bytesDigest = createHash('sha256').update('immutable fixture artifact').digest('hex');

function frozen(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
}

/** Isolated real Store, grants, context and provider boundary; no normalizer/Store mocks. */
export async function bridgeFixture(t) {
  const f = await coding(await fixture(t, { compactPath: true }));
  await f.runGit('remote', 'set-url', 'origin', remote);
  await fs.writeFile(path.join(f.repo, '.sdlc', 'config.json'), JSON.stringify({
    defaultBranch: 'refs/heads/main',
    environments: { DEV: { target: 'bridge-dev', configDigest: configurationDigest } },
  }));
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Isolated bridge fixture source');
  const revision = await f.runGit('rev-parse', 'HEAD');
  await f.runGit('branch', 'main', revision);
  const time = () => new Date(f.clock.now()).toISOString();
  const repositoryBody = frozen({
    id: 101, node_id: 'R_101', name: 'bridge-repo', full_name: 'bridge-owner/bridge-repo',
    owner: { login: 'bridge-owner' }, html_url: 'https://github.com/bridge-owner/bridge-repo',
    clone_url: remote, ssh_url: 'git@github.com:bridge-owner/bridge-repo.git', default_branch: 'main',
    url: 'https://api.github.com/repos/bridge-owner/bridge-repo',
  });
  const replies = new Map();
  const calls = [];
  const connection = createGitHubConnection({
    id: connectionId, apiOrigin: 'https://api.github.com', webOrigin: 'https://github.com',
    scopes: [
      { kind: 'repository', id: '101', owner: 'bridge-owner', name: 'bridge-repo' },
      { kind: 'repository', id: '202', owner: 'fork-owner', name: 'fork-repo' },
    ],
    profiles: [
      { id: '2026-03-10', kind: 'rest', apiVersion: '2026-03-10' },
      { id: 'github-collaboration-2026-03-10', kind: 'graphql', schemaVersion: 'github-collaboration-2026-03-10' },
    ],
    credentialResolver: () => ({
      apiOrigin: 'https://api.github.com', tokenClass: 'fine-grained-pat',
      token: 'isolated-fixture-credential', generation: 'fixture-generation', actorVisibility: 'fixture-actor',
    }),
  });
  let denied = false;
  let deniedPath;
  let graphReply;
  const policyBefore = '2026-10-08T00:00:00.000Z';
  const policyAfter = '2026-10-08T00:00:01.000Z';
  let policyState = { version: policyBefore, autoMerge: null };
  const transport = createGitHubTransport({ connection, fetch: async (url, init) => {
    const selected = new URL(url);
    const key = `${init.method} ${selected.pathname}${selected.search}`;
    if (denied && (deniedPath === undefined || new URL(url).pathname === deniedPath)) {
      denied = false;
      deniedPath = undefined;
      calls.push({ key, denied: true });
      return new Response(JSON.stringify({ message: 'Resource not accessible by integration' }),
        { status: 403, headers: { 'content-type': 'application/json' } });
    }
    if (new URL(url).pathname === '/graphql') {
      assert.ok(graphReply);
      assert.deepEqual(JSON.parse(init.body), graphReply.payload);
      calls.push({ key, payload: graphReply.payload });
      if (!graphReply.body.errors) policyState = { version: policyAfter, autoMerge: { merge_method: 'merge' } };
      return new Response(JSON.stringify(graphReply.body),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const expected = replies.get(key);
    assert.ok(expected, `Undeclared provider request: ${key}`);
    assert.equal(init.headers['X-GitHub-Api-Version'] ?? init.headers['x-github-api-version'], '2026-03-10');
    if (expected.payload !== undefined) assert.deepEqual(JSON.parse(init.body), expected.payload);
    else assert.equal(init.body, undefined);
    calls.push({ key, payload: expected.payload });
    const responseBody = expected.policyReadback ? {
      ...expected.body, auto_merge: policyState.autoMerge, updated_at: policyState.version,
    } : expected.body;
    return new Response(JSON.stringify(responseBody), {
      status: expected.status ?? 200,
      headers: { 'content-type': 'application/json', etag: '"bridge-v1"', 'x-github-request-id': 'bridge-request' },
    });
  } });
  const base = '/repos/bridge-owner/bridge-repo';
  replies.set(`GET ${base}`, { body: repositoryBody });
  for (const branch of ['feature/fixture', 'main']) replies.set(`GET ${base}/branches/${encodeURIComponent(branch)}`,
    { body: { name: branch, commit: { sha: revision } } });
  async function acquire(method, route, body, { payload, status = 200, call, proofScope = 'repository:101' } = {}) {
    if (body !== undefined) replies.set(`${method} ${route}`, { body: frozen(structuredClone(body)), payload, status });
    const permission = route.includes('/protection/') ? 'administration' :
      route.includes('/check-') ? 'checks' : route.includes('/actions/') ? 'actions' :
        route.includes('/pulls') ? 'pull-requests' :
          route.includes('/git/') || route.includes('/contents/') ? 'contents' : 'metadata';
    const tokenClasses = ['classic-pat', 'oauth', 'fine-grained-pat', 'app-installation', 'app-user'];
    const request = transport.buildRestRequest({
      method, path: route, profile: '2026-03-10', mediaType: 'application/vnd.github+json',
      expectedStatuses: [status], proofScope,
      tokenClasses: method === 'GET' ? ['anonymous', ...tokenClasses] : tokenClasses,
      permissions: [{ name: permission, level: method === 'GET' ? 'read' : 'write' }], responseType: 'json',
      ...(payload === undefined ? {} : { payload }),
    });
    const capture = await transport.execute(request, call === undefined ? {} : {
      actionAuthority: { operationId: call.operation.id, authorityRef: 'fixture-grant',
        dispatchClaimId: call.hostCallId },
    });
    requireGitHubCapture(capture, connection);
    return capture;
  }

  const results = new Map();
  const exactHandles = new Map();
  const notificationContent = new Map();
  const notificationResponses = new Map();
  const resultAcquisition = observedResult => results.get(observedResult) ?? results.get(observedResult?.handle);
  const artifacts = new Map();
  const pullRequests = new Map();
  const originalPullRequests = new Map();
  const checks = new Map();
  let serial = 0;
  const bridge = createGitHubStoreBridge({
    clock: f.clock, identifier: () => `bridge-call-${++serial}`,
    verifiers: {
      async verifyRepository(input) {
        assert.equal(input.provider, 'github');
        const repoCapture = await acquire('GET', base);
        const branch = await acquire('GET', `${base}/branches/feature%2Ffixture`);
        const defaultBranch = await acquire('GET', `${base}/branches/main`);
        const fetchURL = await f.runGit('remote', 'get-url', 'origin');
        const pushURL = await f.runGit('remote', 'get-url', '--push', 'origin');
        const push = input.remoteRepositoryURL !== fetchURL;
        const normalized = normalizeGitHubRepositoryObservation({
          repository: { requestUrl: `https://api.github.com${base}`,
            body: Object.fromEntries(Object.entries(repoCapture.body).filter(([key]) => key !== 'url')) },
          branch: { requestUrl: `https://api.github.com${base}/branches/feature%2Ffixture`, body: branch.body },
          defaultBranch: { requestUrl: `https://api.github.com${base}/branches/main`, body: defaultBranch.body },
          observedAt: time(), evidenceRef: 'fixture:repository:101',
        }, {
          connection: connectionId, repositoryId: '101', repositoryNodeId: 'R_101',
          canonicalLocalRepositoryPath: f.repo, remoteRepositoryURL: input.remoteRepositoryURL,
          remoteDirection: push ? 'push' : 'fetch', selectedRemote: {
            selectedRemoteName: 'origin', ...(push ? { pushURLs: [pushURL] } : { fetchURLs: [fetchURL] }),
          },
          branchRef: 'refs/heads/feature/fixture',
        });
        return { ...normalized.verification, verifiedRevision: normalized.observation.revision,
          verifiedDefaultBranchRef: normalized.observation.defaultBranchRef,
          verifiedObservedAt: normalized.observation.observedAt,
          verifiedEvidenceRef: normalized.observation.evidenceRef };
      },
      verifyOperationResult({ operation, observedResult }) {
        const acquired = resultAcquisition(observedResult);
        requireThat(acquired, 'EVIDENCE', 'Only a privately retained acquisition handle is accepted');
        if (acquired.authenticatedSource) acquired.authenticatedSource.verify(operation);
        if (exactHandles.has(observedResult)) assert.equal(observedResult, exactHandles.get(observedResult));
        requireThat(acquired.operationId === operation.id &&
          acquired.intentDigest === operation.intendedOutcome.digest, 'EVIDENCE',
        'Private acquisition belongs to another operation or intended outcome');
        requireThat(acquired.producerId === undefined || acquired.producerId === '601', 'EVIDENCE',
          'Publication response came from another independently acquired producer');
        requireThat(acquired.actualProviderResultId === undefined ||
          acquired.verified.observation.providerResultId === acquired.actualProviderResultId,
        'EVIDENCE', 'Result identity differs from the privately retained actual provider response');
        requireThat(acquired.denied !== true, 'AUTHORITY',
          'Trusted host denies this exact fixture operation and repository scope');
        return acquired.verified;
      },
      verifyArtifact({ operation, observation }) {
        const acquired = artifacts.get(observation.handle);
        assert.ok(acquired);
        assert.equal(acquired.producerId, operation.id);
        return acquired.verification;
      },
      verifyPullRequest({ adapterObservation }) {
        const acquired = pullRequests.get(adapterObservation?.handle);
        assert.ok(acquired, 'PR verifier requires its private independent acquisition');
        const original = originalPullRequests.get(adapterObservation?.handle);
        if (original) {
          requireThat(original.context.acquisitionSequence === original.sequence, 'EVIDENCE',
            'Private PR acquisition sequence differs from its original observation');
          requireThat(original.expectedVersion === null ||
            original.expectedVersion === original.capture.headers.etag, 'STALE',
          'Private PR expected version differs from its original provider response');
          requireGitHubCapture(original.capture, connection);
        }
        return acquired;
      },
      verifyCheckResults({ adapterObservation }) {
        const acquired = checks.get(adapterObservation?.handle);
        assert.ok(acquired, 'Check verifier requires its private producer/checkout acquisition');
        acquired.verify();
        return acquired.verification;
      },
      verifyProviderVersion({ locator, immutableVersion, retrievalContext, bytes }) {
        return locator === 'fixture:immutable' && immutableVersion === 'v1' &&
          retrievalContext.provider === 'github' &&
          bytes.equals(Buffer.from('immutable fixture evidence'));
      },
    },
  });
  f.store = await new Store(f.home, bridge.storeOptions()).ready();
  f.bridge = bridge;
  f.revision = revision;
  f.calls = calls;
  f.connection = connection;
  f.transport = transport;
  f.denyNext = selectedPath => { denied = true; deniedPath = selectedPath; };
  f.acquire = acquire;
  f.repositoryBody = repositoryBody;
  f.forkRepository = frozen({
    ...repositoryBody, id: 202, node_id: 'R_202', owner: { login: 'fork-owner' },
    name: 'fork-repo', full_name: 'fork-owner/fork-repo',
    url: 'https://api.github.com/repos/fork-owner/fork-repo',
    html_url: 'https://github.com/fork-owner/fork-repo',
    clone_url: 'https://github.com/fork-owner/fork-repo.git',
    ssh_url: 'git@github.com:fork-owner/fork-repo.git',
    fork: true,
  });
  f.repositoryInput = {
    workItemId: f.workItemId, repositoryId: 'primary', selectedRemoteName: 'origin',
    localRepositoryPath: f.repo, remoteRepositoryURL: remote, provider: 'github',
    connection: connectionId, repositoryRef, revision, defaultBranchRef: 'refs/heads/main',
    verifiedBranch: { branchRef: 'refs/heads/feature/fixture', revision },
    observedAt: time(), evidenceRef: 'fixture:repository:101',
  };
  await f.store.observeRepository(f.repositoryInput);
  f.cycle = (await startCycle(f.store, {
    workItemId: f.workItemId, configDigest: configurationDigest, cause: 'isolated existing-consumer bridge',
  })).cycle;
  for (const testId of ['T-unit', 'T-integration']) await recordTest(f.store, {
    workItemId: f.workItemId, cycleId: f.cycle.id, testId, status: 'Passed',
    owner: 'agent', host: 'local', expectedMet: true, evidenceRef: `fixture:${testId}`,
  });
  await grant(f, 'override', {
    rules: ['candidate-review', 'review-completion', 'supported-operation'],
    reason: 'Fixture-only typed invocation, no passing review claimed',
    scope: { repositoryIds: ['primary'] }, lifetime: { kind: 'work-item' },
  });
  await grant(f, 'dev-authorization', {
    cycleId: f.cycle.id, candidateDigest: f.cycle.candidateDigest,
    testSpecDigest: f.cycle.testSpecDigest, configDigest: configurationDigest, target: 'bridge-dev',
  });
  await grant(f, 'pr-publication', {
    repositoryId: 'primary', sourceRef: 'refs/heads/feature/fixture', targetRef: 'refs/heads/main',
    draft: true, target: 'origin', localRepositoryPath: f.repo,
    remoteRepositoryURL: remote, sourceRepositoryURL: remote,
  });
  for (const permission of ['merge', 'auto-merge']) await grant(f, 'permission', { grant: permission });
  await grant(f, 'permission', {
    grant: 'push', target: 'origin', remoteUrlDigest: digest([remote]),
    sourceRef: 'refs/heads/feature/fixture', targetRef: 'refs/heads/feature/fixture',
    sourceRevision: revision, force: false, delete: false,
    localRepositoryPath: f.repo, remoteRepositoryURL: remote,
  });
  await orient(f);

  function actionFor(family) {
    const common = { repositoryId: 'primary', provider: 'github', localRepositoryPath: f.repo,
      remoteRepositoryURL: remote, sourceRevision: revision, configDigest: configurationDigest };
    const actions = {
      execution: { ...common, class: 'build', environment: 'DEV', target: 'bridge-dev',
        pipeline: '301', monitorCapability: true },
      test: { ...common, class: 'test', environment: 'DEV', target: 'bridge-dev',
        testId: 'T-dev', owner: 'agent', host: 'development-machine',
        artifactId: '901', deploymentId: f.deployment?.id },
      artifact: { repositoryId: 'primary', provider: 'github', localRepositoryPath: f.repo,
        remoteRepositoryURL: remote, configDigest: configurationDigest,
        class: 'artifact', artifactId: '901', artifactName: 'bridge.zip',
        artifactSha256: bytesDigest, producingExecutionRef: '401', producingAttemptRef: '2' },
      deployment: { ...common, class: 'deploy', environment: 'DEV', target: 'bridge-dev',
        artifactId: '901', artifactRef: 'artifact:901', artifactSha256: bytesDigest, monitorCapability: true },
      'pull-request': { ...common, class: 'pr-create', target: 'origin', draft: true,
        sourceRef: 'refs/heads/feature/fixture', targetRef: 'refs/heads/main',
        targetRevision: revision, sourceRepositoryURL: remote, requestedState: 'active' },
      'git-ref': { ...common, class: 'push', target: 'origin', remoteUrlDigest: digest([remote]),
        sourceRef: 'refs/heads/feature/fixture', targetRef: 'refs/heads/feature/fixture', force: false, delete: false },
      merge: { ...common, class: 'merge', prId: 'pull-request:801', targetRevision: revision },
      policy: { ...common, class: 'auto-merge', target: 'https://github.com/bridge-owner/bridge-repo/pull/1',
        prId: 'pull-request:801', policyVersion: policyAfter, previousPolicyVersion: policyBefore },
      notification: { ...common, class: 'notification', recipient: 'https://github.com/bridge-owner/bridge-repo/issues/1',
        contentDigest: digest('fixture publication') },
    };
    const action = actions[family];
    assert.ok(action, `Unknown family ${family}`);
    return action;
  }
  f.prepare = async (family, suffix = '', { claim = true } = {}) => {
    f.clock.advance(1);
    const action = actionFor(family);
    if (family === 'notification' && suffix) action.contentDigest = digest(`fixture publication:${suffix}`);
    const preparation = await bridge.legacyOperations.prepare({
      workItemId: f.workItemId, sessionId: f.sessionId, operationId: `op-${family}${suffix}`, action,
      request: { toolName: 'github-existing-consumer', toolArgs: { family, suffix }, cwd: f.repo },
      correlationKey: `family-${family}${suffix}`, intent: `Exercise ${family} existing consumer`,
    }, f.store);
    assert.equal(preparation.operation.intendedOutcome.family, family);
    if (family === 'notification') notificationContent.set(preparation.operation.id,
      suffix ? `fixture publication:${suffix}` : 'fixture publication');
    if (claim) return { preparation, claim: await bridge.legacyOperations.claimDispatch(preparation, f.store) };
    return { preparation, claim: { operation: preparation.operation, hostCallId: `bridge-call-${serial}`,
      adapterContract: bridge.adapterContract } };
  };
  f.result = async (prepared, patch = value => value, { status = 'succeeded' } = {}) => {
    f.clock.advance(1);
    const { operation } = prepared.claim;
    const { family, requested, target } = operation.intendedOutcome;
    const producingExecution = {
      provider: 'github', connection: connectionId, scopeRef: repositoryRef, definitionRef: '301',
      executionRef: '401', attemptKind: 'known', attemptRef: '2',
    };
    const result = { remoteRepositoryURL: remote };
    let producerId;
    let providerResultId, route, method = 'GET', native, executionCaptures;
    if (['execution', 'test'].includes(family)) {
      const runId = operation.id.includes('persist-failed') ? '403' :
        operation.id.includes('persist-pending') ? '404' : operation.id.endsWith('-failed') ?
          family === 'test' ? '408' : '406' :
          operation.id.endsWith('-pending') ? '407' : family === 'test' ? '402' : '401';
      const dispatched = await acquire('POST', `${base}/actions/workflows/301/dispatches`, {
        workflow_run_id: Number(runId), run_url: `https://api.github.com${base}/actions/runs/${runId}`,
        html_url: `https://github.com/bridge-owner/bridge-repo/actions/runs/${runId}`,
      }, { payload: { ref: 'refs/heads/feature/fixture', inputs: {} }, call: prepared.claim });
      assert.equal(dispatched.dispatchIndication.dispatchClaimId, prepared.claim.hostCallId);
      assert.equal(dispatched.body.workflow_run_id, Number(runId));
      route = `${base}/actions/runs/${runId}/attempts/2`;
      native = { id: Number(runId), workflow_id: 301, run_attempt: 2, repository: { id: 101 },
        head_sha: revision, status: status === 'running' ? 'in_progress' : 'completed',
        conclusion: status === 'running' ? null : status === 'failed' ? 'failure' : 'success' };
      const acquired = await acquire(method, route, native);
      executionCaptures = { dispatched, run: acquired };
      assert.equal(acquired.body.repository.id, 101);
      assert.equal(acquired.body.head_sha, f.revision);
      Object.assign(result, {
        executionRef: String(acquired.body.id), attemptCapability: 'distinct', attemptRef: String(acquired.body.run_attempt),
        executionIdentity: { ...producingExecution, executionRef: String(acquired.body.id) },
        sourceRevision: acquired.body.head_sha, configDigest: configurationDigest,
        candidateDigest: f.cycle.candidateDigest, testSpecDigest: f.cycle.testSpecDigest,
        provider: 'github', environment: target.environment, target: target.target,
        ...(family === 'test' ? { testId: 'T-dev', expectedMet: status !== 'failed', artifactId: '901',
          deploymentId: requested.deploymentId } : { pipeline: String(acquired.body.workflow_id) }),
      });
      providerResultId = `${result.executionRef}:${result.attemptRef}`;
    } else if (family === 'artifact') {
      const acquired = await acquire('GET', `${base}/actions/artifacts/901`, {
        id: 901, name: 'bridge.zip', expired: false, digest: `sha256:${bytesDigest}`,
        workflow_run: { id: 401, repository_id: 101, head_sha: revision },
      });
      assert.equal(acquired.body.expired, false);
      assert.equal(acquired.body.workflow_run.id, 401);
      Object.assign(result, {
        artifactId: String(acquired.body.id), artifactRef: 'artifact:901',
        artifactName: acquired.body.name, sha256: acquired.body.digest.slice(7),
        executionRef: '401', attemptCapability: 'distinct', attemptRef: '2',
        executionIdentity: producingExecution, sourceRevision: acquired.body.workflow_run.head_sha,
        configDigest: configurationDigest,
      });
      providerResultId = result.artifactRef;
    } else if (family === 'policy') {
      const policyBody = { id: 801, node_id: 'PR_801', auto_merge: null, updated_at: policyBefore };
      replies.set(`GET ${base}/pulls/1`, { body: policyBody, policyReadback: true });
      policyState = { version: policyBefore, autoMerge: null };
      const before = await acquire('GET', `${base}/pulls/1`);
      assert.equal(before.body.updated_at, requested.previousPolicyVersion);
      assert.equal(before.body.auto_merge, null);
      const document = `mutation GitHubAutoMergeEnable($input: EnablePullRequestAutoMergeInput!) {
        enablePullRequestAutoMerge(input: $input) { pullRequest {
          id fullDatabaseId number headRefOid baseRefOid headRefName baseRefName
          updatedAt merged mergeCommit { oid } repository { id nameWithOwner }
          autoMergeRequest { mergeMethod commitHeadline commitBody enabledAt }
        } }
      }`;
      const variables = { input: { pullRequestId: 'PR_801', expectedHeadOid: revision, mergeMethod: 'MERGE' } };
      const node = {
        id: 'PR_801', fullDatabaseId: 801, number: 1, headRefOid: revision, baseRefOid: revision,
        headRefName: 'feature/fixture', baseRefName: 'main', updatedAt: policyAfter,
        merged: false, mergeCommit: null, repository: { id: 'R_101', nameWithOwner: 'bridge-owner/bridge-repo' },
        autoMergeRequest: { mergeMethod: 'MERGE', commitHeadline: null, commitBody: null, enabledAt: policyAfter },
      };
      graphReply = { payload: { query: document, operationName: 'GitHubAutoMergeEnable', variables },
        body: { data: { enablePullRequestAutoMerge: { pullRequest: node } } } };
      const specification = {
        documentId: 'github-auto-merge-enable-v1', operationName: 'GitHubAutoMergeEnable', operationKind: 'mutation',
        document, variables, schemaProfile: 'github-collaboration-2026-03-10', proofScope: 'repository:101',
        tokenClasses: ['classic-pat', 'oauth', 'fine-grained-pat', 'app-installation', 'app-user'],
        permissions: [{ name: 'pull-requests', level: 'write' }],
        validateData: value => {
          requireThat(value?.enablePullRequestAutoMerge?.pullRequest?.id === 'PR_801',
            'EVIDENCE', 'Policy mutation must return its exact requested PR');
          return true;
        },
      };
      const mutation = await transport.execute(transport.buildGraphQLRequest(specification), {
        actionAuthority: { operationId: operation.id, authorityRef: 'fixture-auto-merge-permission',
          dispatchClaimId: prepared.claim.hostCallId },
      });
      requireGitHubCapture(mutation, connection);
      requireGitHubRequestBinding(mutation, specification);
      assert.equal(mutation.dispatchIndication.dispatchClaimId, prepared.claim.hostCallId);
      const readback = await acquire('GET', `${base}/pulls/1`);
      const returned = mutation.body.data.enablePullRequestAutoMerge.pullRequest;
      assert.equal(readback.body.id, returned.fullDatabaseId);
      assert.equal(readback.body.updated_at, returned.updatedAt);
      assert.notEqual(readback.body.updated_at, before.body.updated_at);
      assert.equal(readback.body.auto_merge.merge_method.toUpperCase(), returned.autoMergeRequest.mergeMethod);
      Object.assign(result, {
        target: target.target,
        policyVersion: readback.body.updated_at, previousPolicyVersion: before.body.updated_at,
        prId: `pull-request:${readback.body.id}`, autoMergeEnabled: readback.body.auto_merge !== null,
        changeApplied: returned.autoMergeRequest !== null && readback.body.updated_at !== before.body.updated_at,
      });
      providerResultId = `${result.target}:${result.policyVersion}`;
    } else {
      const contracts = {
        deployment: ['POST', `${base}/deployments`, { id: status === 'failed' ? 703 : 701,
          sha: revision, environment: 'DEV' },
          { ref: revision, environment: 'DEV', auto_merge: false }],
        'pull-request': ['POST', `${base}/pulls`, { id: 801, number: 1, draft: true,
          head: { ref: 'feature/fixture', sha: revision }, base: { ref: 'main', sha: revision } },
        { head: 'feature/fixture', base: 'main', draft: true, title: 'Fixture' }],
        'git-ref': ['PATCH', `${base}/git/refs/heads/feature/fixture`,
          { ref: 'refs/heads/feature/fixture', object: { sha: revision } }, { sha: revision, force: false }],
        merge: ['PUT', `${base}/pulls/1/merge`,
          { sha: revision, merged: true }, { sha: revision, merge_method: 'merge' }],
        notification: ['POST', `${base}/issues/1/comments`, { id: 1001, body: 'fixture publication', user: { id: 601 },
          html_url: 'https://github.com/bridge-owner/bridge-repo/issues/1#issuecomment-1001' },
        { body: 'fixture publication' }],
      };
      [method, route, native] = contracts[family];
      const payload = contracts[family][3];
      if (family === 'notification') {
        native.body = notificationContent.get(operation.id) ?? 'fixture publication';
        payload.body = native.body;
        native.id = operation.id.includes('scalar-reconcile') ? 1002 : 1001;
        native.html_url = `https://github.com/bridge-owner/bridge-repo/issues/1#issuecomment-${native.id}`;
      }
      const acquired = await acquire(method, route, native, { payload,
        status: method === 'POST' ? 201 : 200, call: method === 'GET' ? undefined : prepared.claim });
      const body = acquired.body;
      if (family === 'deployment') {
        const statusCapture = await acquire('GET', `${base}/deployments/${body.id}/statuses`, [
          { id: 702, state: status === 'running' ? 'in_progress' : status === 'failed' ? 'failure' : 'success',
            environment: 'DEV', deployment_url: `https://api.github.com${base}/deployments/${body.id}` },
        ]);
        assert.ok(['success', 'failure', 'in_progress'].includes(statusCapture.body[0].state));
        Object.assign(result, { deploymentRef: String(body.id), artifactId: '901', artifactRef: 'artifact:901',
          artifactSha256: bytesDigest, sourceRevision: body.sha, configDigest: configurationDigest,
          environment: body.environment, target: 'bridge-dev' });
        providerResultId = result.deploymentRef;
      } else if (family === 'pull-request') {
        Object.assign(result, { prId: `pull-request:${body.id}`, sourceRepositoryURL: remote,
          targetRepositoryURL: remote, sourceRef: `refs/heads/${body.head.ref}`, targetRef: `refs/heads/${body.base.ref}`,
          sourceRevision: body.head.sha, targetRevision: body.base.sha, draft: body.draft, state: 'active' });
        providerResultId = result.prId;
      } else if (family === 'git-ref') {
        Object.assign(result, { destination: 'origin', ref: body.ref, revision: body.object.sha,
          published: true, remoteUrlDigest: digest([remote]) });
        providerResultId = `${result.destination}:${result.ref}`;
      } else if (family === 'merge') {
        Object.assign(result, { prId: 'pull-request:801', merged: body.merged, mergeRevision: body.sha,
          sourceRevision: revision, targetRevision: revision });
        providerResultId = `${result.prId}:${result.mergeRevision}`;
      } else {
        assert.equal(digest(body.body), requested.contentDigest);
        notificationResponses.set(operation.id, frozen(structuredClone(body)));
        Object.assign(result, { recipient: 'https://github.com/bridge-owner/bridge-repo/issues/1',
          contentDigest: digest(body.body), deliveryReceipt: `comment:${body.id}`, delivered: true });
        providerResultId = result.deliveryReceipt;
        producerId = String(body.user.id);
      }
    }
    const resultStatus = status === 'running' && !['execution', 'test', 'deployment'].includes(family) ? 'uncertain' : status;
    if (status === 'failed') result.terminalStatus = 'failed';
    const verified = {
      dispatch: { id: operation.id, hostCallId: prepared.claim.hostCallId, hostCallSupported: true },
      observation: {
        status: resultStatus, family, target, intendedOutcomeDigest: operation.intendedOutcome.digest,
        providerStatus: resultStatus, providerVerified: true, providerResultId,
        causalProof: { kind: 'host-call', dispatchId: operation.id, resultId: providerResultId,
          supported: true, hostCallId: prepared.claim.hostCallId },
        ...(status === 'running' ? {} : { result }),
        ...(status === 'failed' ? { failure: { terminal: true, providerVerified: true } } : {}),
        evidence: { ref: `fixture:provider:${family}:${resultStatus}`, verified: true, sha256: digest(result) },
      },
      ...(['execution', 'test', 'artifact'].includes(family) ? {
        executionContext: { provider: 'github', connection: connectionId, scopeRef: repositoryRef,
          definitionRef: '301', attemptCapability: 'distinct' },
      } : {}),
    };
    const handle = `acquisition-${++serial}`;
    results.set(handle, { operationId: operation.id, intentDigest: operation.intendedOutcome.digest,
      actualProviderResultId: providerResultId, ...(producerId ? { producerId } : {}),
      verified: patch(structuredClone(verified)), executionCaptures });
    return { handle };
  };
  f.record = async (prepared, observedResult, { status = 'succeeded', reconcile = false } = {}) => {
    const input = {
      workItemId: f.workItemId, operationId: prepared.claim.operation.id, status, observedResult,
      ...(status === 'running' ? {
        handle: f.verified(observedResult).observation.providerResultId,
        requestFingerprint: prepared.claim.operation.requestFingerprint,
        correlationKey: prepared.claim.operation.correlationKey,
      } : {}),
    };
    return reconcile ? bridge.legacyOperations.reconcile(input, f.store) :
      bridge.legacyOperations.recordResult(prepared.preparation, input, f.store);
  };
  f.variant = (observedResult, mutate) => {
    const retained = resultAcquisition(observedResult);
    assert.ok(retained);
    const verified = structuredClone(retained.verified);
    mutate(verified);
    const handle = `acquisition-${++serial}`;
    results.set(handle, { ...retained, verified });
    return { handle };
  };
  f.verified = observedResult => frozen(structuredClone(resultAcquisition(observedResult).verified));
  f.authenticatedExecutionResult = async prepared => {
    const operation = prepared.claim.operation;
    const family = operation.intendedOutcome.family;
    assert.ok(['execution', 'test'].includes(family));
    const actual = await f.result(prepared);
    const retained = resultAcquisition(actual);
    const { dispatched, run } = retained.executionCaptures;
    const state = await f.store.load(f.workItemId);
    const configuration = await loadConfig(state.metadata, 'primary');
    const specification = await resolveTestSpecification(f.store, f.workItemId);
    const source = {
      repositoryId: 'primary', localRepositoryPath: f.repo, remoteRepositoryURL: await f.runGit('remote', 'get-url', 'origin'),
      sourceRevision: await f.runGit('rev-parse', 'HEAD'),
      configDigest: configuration.environments.DEV.configDigest,
      candidateDigest: candidateContentDigest(await candidateSnapshot(state.metadata, state.manifest)),
      testSpecDigest: specification.digest, environment: 'DEV', target: configuration.environments.DEV.target,
      ...(family === 'test' ? { artifactId: f.deployment.artifactId, deploymentId: f.deployment.id } : {}),
    };
    const runId = String(run.body.id);
    const identity = { provider: 'github', connection: connectionId, scopeRef: repositoryRef,
      definitionRef: '301', executionRef: runId, attemptKind: 'known', attemptRef: '2' };
    const original = { schemaVersion: 1, producer: { identity },
      dispatch: { operationId: operation.id, hostCallIdDigest: digest(prepared.claim.hostCallId),
        requestKey: dispatched.cacheIdentity.requestKey },
      source, requiredTests: family === 'test' ? ['T-dev'] : [],
      tests: family === 'test' ? [{ testId: 'T-dev', outcome: 'passed', expected: { exitCode: 0 }, actual: { exitCode: 0 } }] : [] };
    const key = randomBytes(32);
    function retain(manifest = original, { tamper = false } = {}) {
      const bytes = Buffer.from(JSON.stringify(manifest));
      const authentication = createHmac('sha256', key).update(bytes).digest();
      const acquiredBytes = tamper ? Buffer.from(`${bytes.toString()} `) : Buffer.from(bytes);
      const handle = `signed-source-${++serial}`;
      results.set(handle, { ...retained, authenticatedSource: {
        verify(selected) {
          requireThat(timingSafeEqual(createHmac('sha256', key).update(acquiredBytes).digest(), authentication),
            'EVIDENCE', 'Original runner result signature changed');
          const parsed = JSON.parse(acquiredBytes);
          requireGitHubCapture(dispatched, connection);
          requireGitHubCapture(run, connection);
          requireThat(parsed.dispatch.operationId === selected.id &&
            parsed.dispatch.hostCallIdDigest === selected.hostInvocation.hostCallIdDigest &&
            parsed.dispatch.requestKey === dispatched.cacheIdentity.requestKey &&
            dispatched.dispatchIndication.dispatchClaimId === prepared.claim.hostCallId &&
            dispatched.body.workflow_run_id === run.body.id &&
            digest(parsed.producer.identity) === digest(identity), 'EVIDENCE',
          'Authenticated runner result differs from the actual dispatch and producer');
          requireThat(parsed.source.sourceRevision === run.body.head_sha &&
            parsed.source.sourceRevision === selected.intendedOutcome.requested.sourceRevision,
          'EVIDENCE', 'Authenticated executed source differs from original acquired revision');
          requireThat(digest(parsed.source) === digest(source), 'EVIDENCE',
            'Authenticated execution differs from independently acquired candidate/spec/configuration');
          if (family === 'test') requireThat(digest(parsed.requiredTests) === digest(['T-dev']) &&
            parsed.tests.length === 1 && parsed.tests[0].testId === 'T-dev' &&
            parsed.tests[0].outcome === 'passed' && parsed.tests[0].actual.exitCode === 0 &&
            parsed.tests[0].expected.exitCode === 0, 'EVIDENCE',
          'Authenticated runner result lacks the actual selected test outcome');
        },
      } });
      return { handle };
    }
    const good = retain();
    return { good, apiHead: run.body.head_sha,
      wrongCheckout: checkoutRevision => retain({ ...original, source: { ...source, sourceRevision: checkoutRevision } }),
      tamperedBytes: () => retain(original, { tamper: true }),
      missingSelection: () => retain({ ...original, tests: [] }),
      verify(reference) {
        const acquired = resultAcquisition(reference);
        acquired.authenticatedSource.verify(operation);
        return frozen(structuredClone(acquired.verified));
      },
    };
  };
  // A host awaiting terminal verification may retain an exact response handle
  // as uncertain. This is not a provider 202 or permission to repeat its call.
  f.pendingResult = observedResult => f.variant(observedResult, value => {
    value.observation.status = 'uncertain';
    value.observation.providerStatus = 'uncertain';
    delete value.observation.result;
    delete value.observation.failure;
  });
  f.scalarResult = observedResult => {
    const retained = resultAcquisition(observedResult);
    assert.ok(retained);
    const handle = `private-scalar-${++serial}`;
    results.set(handle, retained);
    exactHandles.set(handle, handle);
    return handle;
  };
  f.opaqueResult = observedResult => {
    const retained = resultAcquisition(observedResult);
    assert.ok(retained);
    const handle = Object.freeze({ opaqueReference: `private-object-${++serial}` });
    results.set(handle, retained);
    exactHandles.set(handle, handle);
    return handle;
  };
  f.foreignProducer = async observedResult => {
    const retained = resultAcquisition(observedResult);
    const commentId = retained.verified.observation.providerResultId.slice('comment:'.length);
    const capture = await acquire('GET', `${base}/issues/comments/${commentId}`, {
      id: Number(commentId), body: 'fixture publication', user: { id: 999 },
    });
    const handle = `private-producer-${++serial}`;
    results.set(handle, { ...retained, producerId: String(capture.body.user.id) });
    return handle;
  };
  f.reacquireNotification = async observedResult => {
    const retained = resultAcquisition(observedResult);
    assert.ok(retained);
    const published = notificationResponses.get(retained.operationId);
    assert.ok(published);
    const commentId = retained.verified.observation.providerResultId.slice('comment:'.length);
    const capture = await acquire('GET', `${base}/issues/comments/${commentId}`, published);
    const verified = structuredClone(retained.verified);
    verified.observation.result.contentDigest = digest(capture.body.body);
    verified.observation.evidence = { ref: `fixture:reacquired-comment:${capture.body.id}`,
      verified: true, sha256: digest(capture.body) };
    const handle = `reacquired-notification-${++serial}`;
    results.set(handle, { ...retained, verified, producerId: String(capture.body.user.id),
      actualProviderResultId: `comment:${capture.body.id}` });
    return { handle };
  };
  f.failedResult = async prepared => {
    const operation = prepared.claim.operation;
    const family = operation.intendedOutcome.family;
    if (['execution', 'test', 'deployment'].includes(family)) {
      return f.result(prepared, value => value, { status: 'failed' });
    }
    const routes = {
      artifact: ['GET', `${base}/actions/artifacts/901`, undefined, 410],
      'pull-request': ['POST', `${base}/pulls`, { head: 'feature/fixture', base: 'main', title: 'Fixture' }, 422],
      'git-ref': ['PATCH', `${base}/git/refs/heads/feature/fixture`, { sha: revision, force: false }, 422],
      merge: ['PUT', `${base}/pulls/1/merge`, { sha: revision, merge_method: 'merge' }, 409],
      notification: ['POST', `${base}/issues/1/comments`, { body: 'fixture publication' }, 422],
    };
    let evidence;
    if (family === 'policy') {
      // Exact supported GraphQL input rejection, with unchanged independent readback.
      policyState = { version: policyBefore, autoMerge: null };
      const body = { id: 801, updated_at: policyBefore, auto_merge: null };
      replies.set(`GET ${base}/pulls/1`, { body, policyReadback: true });
      const before = await acquire('GET', `${base}/pulls/1`);
      const document = `mutation GitHubAutoMergeEnable($input: EnablePullRequestAutoMergeInput!) {
        enablePullRequestAutoMerge(input: $input) { pullRequest { id updatedAt } }
      }`;
      const variables = { input: { pullRequestId: 'PR_801', expectedHeadOid: revision, mergeMethod: 'MERGE' } };
      graphReply = { payload: { query: document, operationName: 'GitHubAutoMergeEnable', variables },
        body: { data: null, errors: [{ type: 'BAD_USER_INPUT', message: 'Expected head conflict' }] } };
      const request = transport.buildGraphQLRequest({
        documentId: 'fixture-auto-enable-rejection', operationName: 'GitHubAutoMergeEnable',
        operationKind: 'mutation', document, variables, schemaProfile: 'github-collaboration-2026-03-10',
        proofScope: 'repository:101', tokenClasses: ['fine-grained-pat'],
        permissions: [{ name: 'pull-requests', level: 'write' }], validateData: () => true,
      });
      await assert.rejects(transport.execute(request, { actionAuthority: {
        operationId: operation.id, authorityRef: 'fixture-auto-merge-permission', dispatchClaimId: prepared.claim.hostCallId,
      } }), { code: 'GRAPHQL' });
      const after = await acquire('GET', `${base}/pulls/1`);
      assert.deepEqual(before.body, after.body);
      evidence = { request: request.requestIdentity, unchangedVersion: after.body.updated_at };
    } else {
      const [method, route, payload, responseStatus] = routes[family];
      replies.set(`${method} ${route}`, { body: { message: family === 'artifact' ? 'Artifact has expired' :
        'Validation Failed', errors: [{ code: 'invalid', resource: family }] }, payload, status: responseStatus });
      await assert.rejects(acquire(method, route, undefined, {
        payload, call: method === 'GET' ? undefined : prepared.claim,
      }), error => {
        assert.equal(error.code, 'CONTRACT');
        assert.equal(error.details.status, responseStatus);
        assert.equal(error.details.connectionId, connectionId);
        evidence = { method, route, status: error.details.status,
          requestId: error.details.headers['x-github-request-id'] };
        return true;
      });
    }
    const failureRef = `failure:${family}:${operation.id}`;
    const verified = {
      dispatch: { id: operation.id, hostCallId: prepared.claim.hostCallId, hostCallSupported: true },
      observation: {
        status: 'failed', providerStatus: 'failed', providerVerified: true, family,
        target: operation.intendedOutcome.target, intendedOutcomeDigest: operation.intendedOutcome.digest,
        providerResultId: failureRef,
        causalProof: { kind: 'host-call', dispatchId: operation.id, resultId: failureRef,
          hostCallId: prepared.claim.hostCallId, supported: true },
        result: { failureRef, remoteRepositoryURL: remote,
          ...(family === 'git-ref' ? { remoteUrlDigest: digest([remote]) } : {}) },
        failure: { terminal: true, providerVerified: true, noEffect: true },
        evidence: { ref: `fixture:failed:${family}`, verified: true, sha256: digest(evidence) },
      },
    };
    const handle = `failure-${++serial}`;
    results.set(handle, { operationId: operation.id, intentDigest: operation.intendedOutcome.digest, verified });
    return { handle };
  };
  f.deniedResult = prepared => {
    const handle = `denied-${++serial}`;
    results.set(handle, { operationId: prepared.claim.operation.id,
      intentDigest: prepared.claim.operation.intendedOutcome.digest, denied: true });
    return { handle };
  };
  f.boundaryInput = {
    provider: 'github', localRepositoryPath: f.repo, remoteRepositoryURL: remote,
  };
  f.nonDispatch = (prepared, reason) => {
    assert.ok(['iam-denied', 'cancelled-before-claim'].includes(reason));
    const operation = prepared.preparation.operation;
    assert.equal(operation.status, 'prepared');
    assert.equal(operation.dispatchBound, false);
    if (reason === 'cancelled-before-claim') {
      const cancellation = new AbortController();
      cancellation.abort();
      assert.equal(cancellation.signal.aborted, true);
    } else {
      const authorize = selected => {
        assert.equal(selected.id, operation.id);
        assert.equal(selected.intendedOutcome.digest, operation.intendedOutcome.digest);
        return false;
      };
      assert.equal(authorize(operation), false);
    }
    const handle = `non-dispatch-${++serial}`;
    const verified = {
      dispatch: { id: operation.id, hostCallId: prepared.claim.hostCallId, hostCallSupported: true },
      observation: {
        status: 'not-started', family: operation.intendedOutcome.family, target: operation.intendedOutcome.target,
        intendedOutcomeDigest: operation.intendedOutcome.digest, providerStatus: 'not-started',
        nonDispatchProof: { kind: 'host-non-dispatch', hostSupported: true,
          dispatchId: operation.id, dispatchAttempted: false },
        evidence: { ref: `fixture:${reason}`, verified: true, sha256: digest({ reason, operationId: operation.id }) },
      },
    };
    results.set(handle, { operationId: operation.id, intentDigest: operation.intendedOutcome.digest, verified });
    return { handle };
  };
  f.artifact = async producer => {
    const acquired = await acquire('GET', `${base}/actions/artifacts/901`, {
      id: 901, name: 'bridge.zip', expired: false, digest: `sha256:${bytesDigest}`,
      workflow_run: { id: 401, repository_id: 101, head_sha: revision },
    });
    const run = await acquire('GET', `${base}/actions/runs/401/attempts/2`, {
      id: 401, workflow_id: 301, run_attempt: 2, repository: { id: 101 }, head_sha: revision,
    });
    assert.equal(acquired.body.workflow_run.id, run.body.id);
    assert.equal(run.body.head_sha, producer.intendedOutcome.requested.sourceRevision);
    const identity = producer.resultProof.executionIdentity;
    const verification = {
      repositoryId: 'primary', localRepositoryPath: f.repo, remoteRepositoryURL: remote,
      provider: 'github', connection: connectionId, repositoryRef, sourceRevision: revision,
      configDigest: configurationDigest, artifactId: '901', artifactRef: 'artifact:901', artifactSha256: bytesDigest,
      buildRunId: producer.resultProof.providerResultId, name: 'bridge.zip', evidenceRef: 'fixture:artifact:901',
      attemptCapability: 'distinct', attemptRef: '2', producingExecution: identity,
    };
    const handle = `acquisition-${++serial}`;
    artifacts.set(handle, { producerId: producer.id, verification });
    return { verification, input: {
      workItemId: f.workItemId, cycleId: f.cycle.id, artifactId: '901', environment: 'DEV',
      sourceDigest: f.cycle.candidateDigest, configDigest: configurationDigest,
      buildRunId: producer.resultProof.providerResultId, name: 'bridge.zip', artifactType: 'zip',
      evidenceRef: 'fixture:artifact:901', status: 'succeeded', repositoryId: 'primary',
      localRepositoryPath: f.repo, remoteRepositoryURL: remote, provider: 'github', connection: connectionId,
      repositoryRef, sourceRevision: revision, artifactRef: 'artifact:901', artifactSha256: bytesDigest,
      producingOperationId: producer.id, producerObservation: { handle },
    } };
  };
  f.selectArtifact = async producer => {
    const acquired = await f.artifact(producer);
    return recordArtifact(f.store, acquired.input);
  };
  f.artifactVariant = (acquired, mutate) => {
    const verification = structuredClone(acquired.verification);
    mutate(verification);
    const handle = `artifact-variant-${++serial}`;
    artifacts.set(handle, { producerId: acquired.input.producingOperationId, verification });
    return { ...acquired.input, producerObservation: { handle } };
  };
  let currentPrCapture;
  f.acquirePr = async ({ sequence = 1, previousObservationKey, headRef = 'feature/fixture',
    sourceRepository, state = 'open', omitHead = false, borrowHead = false } = {}) => {
    const repoCapture = await acquire('GET', base);
    const headRepo = sourceRepository ?? repositoryBody;
    const side = (repo, ref) => ({
      repositoryId: String(repo.id), owner: repo.owner.login, name: repo.name,
      url: repo.html_url, ref: `refs/heads/${ref}`, revision,
    });
    const scope = {
      kind: 'repository', provider: 'github', connection: connectionId,
      repositoryId: '101', owner: 'bridge-owner', name: 'bridge-repo',
      pullNumber: 1, pullRequestId: '801', pullRequestNodeId: 'PR_801',
      head: side(headRepo, headRef), base: side(repositoryBody, 'main'),
    };
    const primary = await acquire('GET', `${base}/pulls/1`, {
      id: 801, node_id: 'PR_801', number: 1, url: `https://api.github.com${base}/pulls/1`,
      html_url: 'https://github.com/bridge-owner/bridge-repo/pull/1',
      head: { ref: headRef, sha: revision, repo: headRepo },
      base: { ref: 'main', sha: revision, repo: repositoryBody },
      merged_at: null, merged: false, state, draft: true, title: 'Fixture PR', body: '',
      updated_at: time(), commits: 1, changed_files: 0,
    });
    const headRepository = headRepo.id === 101 ? await acquire('GET', base) :
      await acquire('GET', '/repos/fork-owner/fork-repo', headRepo, { proofScope: 'repository:202' });
    const captures = { primary, captureBundle: {
      repository: repoCapture, ...(omitHead ? {} : { headRepository: borrowHead ? repoCapture : headRepository }),
    } };
    const repositoryIdentity = capture => {
      requireGitHubCapture(capture, connection);
      const body = Object.fromEntries(Object.entries(capture.body).filter(([field]) =>
        !['url', 'fork'].includes(field)));
      const identity = normalizeGitHubRepositoryIdentity(body, { connection: connectionId });
      requireThat(capture.finalUrl === `https://api.github.com/repos/${identity.owner}/${identity.name}` &&
        body.clone_url === `${identity.url}.git`, 'EVIDENCE', 'Repository capture has another exact URL');
      return identity;
    };
    const targetRepository = repositoryIdentity(repoCapture);
    requireThat(captures.captureBundle.headRepository, 'PROOF_GAP',
      'Independent PR head repository acquisition is required');
    const sourceIdentity = repositoryIdentity(captures.captureBundle.headRepository);
    requireThat(sourceIdentity.repositoryId === String(primary.body.head.repo.id) &&
      sourceIdentity.repositoryNodeId === primary.body.head.repo.node_id &&
      targetRepository.repositoryId === String(primary.body.base.repo.id) &&
      primary.body.id === Number(scope.pullRequestId) &&
      primary.body.node_id === scope.pullRequestNodeId &&
      primary.body.number === scope.pullNumber, 'EVIDENCE',
    'Actual PR and independently acquired head/base repositories differ');
    const selectedURL = await f.runGit('remote', 'get-url', 'origin');
    requireThat(selectedURL === repoCapture.body.clone_url, 'EVIDENCE',
      'PR base repository does not identify the independently selected remote');
    const providerState = primary.body.merged ? 'merged' : primary.body.state === 'open' ? 'active' : 'closed';
    const observation = {
      localRepositoryPath: f.repo, remoteRepositoryURL: selectedURL,
      provider: 'github', connection: connectionId, repositoryRef: targetRepository.repositoryRef,
      pullRequestRef: `pull-request:${primary.body.id}`,
      ...(sourceIdentity.repositoryId !== targetRepository.repositoryId ?
        { sourceRepositoryURL: captures.captureBundle.headRepository.body.clone_url } : {}),
      sourceBranchRef: `refs/heads/${primary.body.head.ref}`,
      targetBranchRef: `refs/heads/${primary.body.base.ref}`,
      sourceRevision: primary.body.head.sha, targetRevision: primary.body.base.sha,
      state: providerState, observedAt: primary.body.updated_at,
      evidenceRef: `fixture:pr:${sequence}`,
    };
    const verification = {
      canonicalLocalRepositoryPath: observation.localRepositoryPath,
      verifiedRemoteRepositoryURL: observation.remoteRepositoryURL,
      verifiedProvider: observation.provider, verifiedConnection: observation.connection,
      verifiedRepositoryRef: observation.repositoryRef, verifiedPullRequestRef: observation.pullRequestRef,
      ...(observation.sourceRepositoryURL ? {
        verifiedSourceRepositoryURL: observation.sourceRepositoryURL,
        verifiedSourceRepositoryRef: sourceIdentity.repositoryRef,
      } : {}),
      verifiedSourceBranchRef: observation.sourceBranchRef, verifiedTargetBranchRef: observation.targetBranchRef,
      verifiedSourceRevision: observation.sourceRevision, verifiedTargetRevision: observation.targetRevision,
      verifiedState: observation.state, verifiedObservedAt: observation.observedAt,
      verifiedEvidenceRef: observation.evidenceRef,
    };
    validatePullRequestObservation({ ...observation, sequence,
      ...(previousObservationKey ? { previousObservationKey } : {}) }, verification);
    const original = { capture: primary, sequence, expectedVersion: null,
      context: { acquisitionSequence: sequence } };
    currentPrCapture = { captures, scope };
    const handle = `acquisition-${++serial}`;
    pullRequests.set(handle, frozen(verification));
    originalPullRequests.set(handle, original);
    return { observation: { repositoryId: 'primary', ...observation }, adapterObservation: { handle } };
  };
  f.originalPrVariant = (acquired, change) => {
    const handle = `original-pr-variant-${++serial}`;
    const original = originalPullRequests.get(acquired.adapterObservation.handle);
    assert.ok(original);
    originalPullRequests.set(handle, { ...original,
      context: { ...original.context, ...(change.sequence === undefined ? {} : { acquisitionSequence: change.sequence }) },
      ...(change.version === undefined ? {} : { expectedVersion: change.version }) });
    pullRequests.set(handle, pullRequests.get(acquired.adapterObservation.handle));
    return { ...acquired, adapterObservation: { handle } };
  };
  f.acquireChecks = async ({ wrongProducer = false, wrongApp = false, wrongCheckout = false,
    missingSelection = false } = {}) => {
    assert.ok(currentPrCapture);
    const selectedPr = currentPrCapture;
    const producer = { repositoryId: '101', workflowId: '301', runId: '401', attempt: '2',
      jobId: '501', checkId: '801', suiteId: '701', appId: '601' };
    const s = selectedPr.scope;
    const association = [{
      id: 801, number: 1, url: `https://api.github.com${base}/pulls/1`,
      head: { repo: { id: Number(s.head.repositoryId) }, ref: s.head.ref.slice(11), sha: revision },
      base: { repo: { id: 101 }, ref: 'main', sha: revision },
    }];
    const primary = await acquire('GET', `${base}/check-runs/801`, {
      id: 801, node_id: 'CR_801', url: `https://api.github.com${base}/check-runs/801`,
      head_sha: revision, app: { id: wrongApp ? 999 : 601 }, check_suite: { id: 701 },
      name: 'bridge-build', status: 'completed', conclusion: 'success', external_id: null,
      details_url: null, started_at: time(), completed_at: time(),
      output: { title: null, summary: null, text: null }, pull_requests: association,
    });
    const suite = await acquire('GET', `${base}/check-suites/701`, {
      id: 701, node_id: 'CS_701', url: `https://api.github.com${base}/check-suites/701`,
      app: { id: 601 }, repository: { id: 101 }, head_sha: revision, head_branch: 'main',
      status: 'completed', conclusion: 'success', pull_requests: association,
    });
    const run = await acquire('GET', `${base}/actions/runs/401/attempts/2`, {
      id: 401, workflow_id: 301, run_attempt: 2, repository: { id: 101 }, head_sha: revision,
      check_suite_id: 701, url: `https://api.github.com${base}/actions/runs/401`, pull_requests: association,
    });
    const job = await acquire('GET', `${base}/actions/jobs/501`, {
      id: 501, run_id: wrongProducer ? 999 : 401, run_attempt: 2, head_sha: revision,
      url: `https://api.github.com${base}/actions/jobs/501`, run_url: run.body.url,
      check_run_url: `https://api.github.com${base}/check-runs/801`,
    });
    const policy = await acquire('GET', `${base}/branches/main/protection/required_status_checks`, {
      checks: [{ context: 'bridge-build', app_id: 601 }],
    });
    const selection = { producer, revision, requiredTests: ['T-unit'], executedTests: ['T-unit'],
      evidenceRef: 'fixture:runner-selection' };
    const checkout = { producer, revision: wrongCheckout ? 'f'.repeat(40) : await f.runGit('rev-parse', 'HEAD'),
      evidenceRef: 'fixture:runner-checkout' };
    const bytes = Buffer.from(JSON.stringify({ producer, checkout,
      ...(missingSelection ? {} : { selection }) }));
    const key = randomBytes(32);
    const signature = createHmac('sha256', key).update(bytes).digest();
    const capturesToVerify = [primary, suite, run, job, policy,
      selectedPr.captures.primary, selectedPr.captures.captureBundle.repository,
      selectedPr.captures.captureBundle.headRepository];
    function verify() {
      for (const capture of capturesToVerify) requireGitHubCapture(capture, connection);
      requireThat(timingSafeEqual(createHmac('sha256', key).update(bytes).digest(), signature),
        'EVIDENCE', 'Original check source signature changed');
      const actual = JSON.parse(bytes);
      requireThat(actual.selection, 'PROOF_GAP', 'Original runner test selection is absent');
      requireThat(primary.body.check_suite.id === suite.body.id &&
        primary.body.app.id === suite.body.app.id &&
        primary.body.app.id === policy.body.checks[0].app_id &&
        primary.body.name === policy.body.checks[0].context &&
        job.body.run_id === run.body.id && job.body.run_attempt === run.body.run_attempt &&
        job.body.check_run_url === primary.body.url &&
        run.body.check_suite_id === suite.body.id &&
        actual.producer.runId === String(run.body.id) &&
        actual.producer.workflowId === String(run.body.workflow_id) &&
        actual.producer.attempt === String(run.body.run_attempt) &&
        actual.producer.jobId === String(job.body.id) &&
        actual.producer.checkId === String(primary.body.id) &&
        actual.producer.appId === String(primary.body.app.id) &&
        run.body.repository.id === suite.body.repository.id &&
        primary.body.head_sha === actual.checkout.revision &&
        primary.body.head_sha === actual.selection.revision &&
        digest(actual.selection.producer) === digest(actual.producer) &&
        digest(actual.checkout.producer) === digest(actual.producer) &&
        digest(actual.selection.requiredTests) === digest(['T-unit']) &&
        digest(actual.selection.executedTests) === digest(['T-unit']), 'EVIDENCE',
      'Check, run, job, App, executed checkout and original selected tests are not associated');
      const pr = selectedPr.captures.primary.body;
      for (const capture of [primary, suite, run]) {
        const joined = capture.body.pull_requests.find(value => value.id === pr.id);
        requireThat(joined && joined.head.repo.id === pr.head.repo.id &&
          joined.base.repo.id === pr.base.repo.id && joined.head.ref === pr.head.ref &&
          joined.base.ref === pr.base.ref && joined.head.sha === pr.head.sha &&
          joined.base.sha === pr.base.sha, 'EVIDENCE',
        'Original check source does not identify the exact independently acquired PR head/base');
      }
    }
    verify();
    const file = path.join(f.root, 'immutable-check-evidence.bin');
    await fs.writeFile(file, bytes);
    const evidenceReference = {
      locator: 'fixture:check:801', sha256: digest(bytes),
      retrievalContext: { provider: 'github', connection: connectionId, scopeRef: repositoryRef, retrievedAt: time() },
    };
    const identity = { provider: 'github', connection: connectionId, scopeRef: repositoryRef,
      definitionRef: String(run.body.workflow_id), executionRef: String(run.body.id),
      attemptKind: 'known', attemptRef: String(run.body.run_attempt) };
    const checkResults = [{
      requiredCheckRef: policy.body.checks[0].context, checkResultRef: `check:${primary.body.id}`,
      producerRef: String(run.body.workflow_id), testedRevision: JSON.parse(bytes).checkout.revision,
      evidenceRef: 'fixture:original-check', status: 'succeeded', localRepositoryPath: f.repo,
      remoteRepositoryURL: remote, repositoryRef, pullRequestRef: 'pull-request:801',
      sourceRepositoryURL: f.pr?.sourceRepositoryURL,
      sourceRevision: s.head.revision, targetRevision: s.base.revision,
    }];
    if (checkResults[0].sourceRepositoryURL === undefined) delete checkResults[0].sourceRepositoryURL;
    const verification = { identity, status: 'succeeded', evidenceReference, checkResults };
    const handle = `acquisition-${++serial}`;
    checks.set(handle, { verification: frozen(structuredClone(verification)), verify });
    return { identity, checkResults, checkObservation: { handle }, evidence: { reference: evidenceReference },
      evidenceFilePath: file };
  };
  return f;
}

export async function durableBytes(f) {
  const files = [];
  async function walk(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (let index = 0; index < entries.length;) {
      const entry = entries[index];
      if (entry.isDirectory()) {
        await walk(path.join(directory, entry.name));
        index++;
        continue;
      }
      const batch = [];
      while (index < entries.length && !entries[index].isDirectory() && batch.length < 16) {
        const next = entries[index++];
        if (!next.name.endsWith('.lock')) batch.push(path.join(directory, next.name));
      }
      const snapshots = await Promise.allSettled(batch.map(async file =>
        [path.relative(f.root, file),
          createHash('sha256').update(await fs.readFile(file)).digest('hex')]));
      for (const snapshot of snapshots) {
        if (snapshot.status === 'rejected') throw snapshot.reason;
        files.push(snapshot.value);
      }
    }
  }
  await walk(f.store.runtime);
  return files.sort(([left], [right]) => left.localeCompare(right));
}
