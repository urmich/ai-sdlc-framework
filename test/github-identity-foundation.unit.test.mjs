export const validationDeclarations = {
  "schemaVersion": 1,
  "surfaces": [{"coverage": "direct", "paths": ["src/github/execution-adapter.mjs", "src/github/repository.mjs", "src/github/schemas.mjs"]}],
  "variants": [
    {"expression": "`FR-140/141 rejects ${name} as a provider ID`", "domains": {"name": ["absent", "null", "zero", "negative", "fraction", "unsafe JSON number", "NaN", "infinity", "boolean", "object", "empty", "leading zero", "zero string", "whitespace", "trailing whitespace", "exponent", "signed", "decimal"]}},
    {"expression": "`FR-141 rejects malformed node ID ${JSON.stringify(value)}`", "domains": {"JSON.stringify(value)": ["undefined", "17", "\"\"", "\" R_fixture17\"", "\"R_fixture17\\n\"", "\"node id\""]}},
    {"expression": "`AC-140.2 ${source} ${name} cannot verify the observed attempt`", "domains": {"source": ["metadata", "final"], "name": ["API URL", "API-shaped web path", "login", "SSO login", "wrong repository", "wrong owner", "wrong run", "wrong attempt", "job path", "trailing slash", "untrusted host"]}},
    {"expression": "`FR-140 rejects ${name} instead of inventing execution proof`", "domains": {"name": ["missing attempt", "zero attempt", "unknown attempt", "missing workflow", "missing repository", "unsafe repository ID", "missing node ID", "undefined access", "nonboolean access", "unsupported kind", "expected identity injection", "repository alias"]}},
    {"expression": "`AC-140.2 rejects ${source} ${name} without retaining unsafe URL text`", "domains": {"source": ["metadata", "final"], "name": ["credentials", "userinfo", "token query", "encoded token query", "fragment", "HTTP", "dot normalization", "backslash normalization"]}},
    {"expression": "`expected ${field} never becomes its own provider proof`", "domains": {"field": ["connection", "scopeRef", "definitionRef", "executionRef", "attemptRef", "attemptKind"]}},
    {"expression": "`FR-141 rejects ${name} without satisfying repository/branch proof`", "domains": {"name": ["different numeric repository", "different node repository", "wrong captured repository URL", "repository prefix endpoint", "matching-ref prefix endpoint", "branch read in another repository", "branch response prefix", "wrong requested branch", "missing selected branch capture", "short SHA", "uppercase SHA", "unsupported SHA format", "missing commit", "missing trusted repository ID", "missing trusted node ID", "missing trusted context", "unnormalized connection", "unselected URL", "multiple selected URLs", "fetch URLs as push proof", "relative checkout", "noncanonical checkout", "unverified HTTPS alias", "unverified SSH alias", "inconsistent provider clone URL", "inconsistent provider SSH URL", "unsafe captured request", "credentialed repository page", "missing provider default", "invalid observation time", "missing evidence reference", "provider self-attestation", "invalid full ref", "invalid ref component", "stale default name", "contradictory duplicate default capture", "fork numeric ID as base repository", "fork node ID as base repository"]}}
  ]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  githubRepositoryScopeRef,
  validateGitHubId,
  validateGitHubNodeId,
} from '../src/github/schemas.mjs';
import {
  createGitHubExecutionAdapter,
  normalizeGitHubExecutionLink,
  registerGitHubAdapter,
} from '../src/github/execution-adapter.mjs';
import {
  normalizeGitHubRepositoryIdentity,
  normalizeGitHubRepositoryObservation,
} from '../src/github/repository.mjs';
import {
  azureDevOpsScopeRef,
  providerAdapterIds,
  validateAdapterExecutionIdentity,
  verifyProviderLink,
} from '../src/provider-adapters.mjs';
import {
  resolveDefaultBranch,
  validateRepositoryIdentity,
  validateRepositoryObservation,
} from '../src/repository-observations.mjs';

const web = 'https://github.com/fixture-owner/fixture-repo';
const api = 'https://api.github.com/repos/fixture-owner/fixture-repo';
const sha = 'a'.repeat(40);
const checkout = path.resolve('fixture', 'github-identity-foundation');
const adaptersAfterImport = providerAdapterIds();
const repository = () => ({
  id: 17, node_id: 'R_fixture17', name: 'fixture-repo',
  full_name: 'fixture-owner/fixture-repo', owner: { login: 'fixture-owner' },
  html_url: web,
});
const identity = () => ({
  provider: 'github', connection: 'fixture-connection',
  scopeRef: 'repository:17', definitionRef: '23', executionRef: '42',
  attemptKind: 'known', attemptRef: '2',
});
const execution = () => ({
  connection: 'fixture-connection',
  run: { id: 42, workflow_id: 23, run_attempt: 2, repository: repository(),
    html_url: `${web}/actions/runs/42` },
  access: { accessible: true, finalUrl: `${web}/actions/runs/42/attempts/2` },
});
const branchCapture = (name = 'main', revision = sha) => ({
  requestUrl: `${api}/branches/${encodeURIComponent(name)}`,
  body: { name, commit: { sha: revision } },
});
const repositoryCapture = () => ({
  repository: { requestUrl: api, body: { ...repository(),
    clone_url: `${web}.git`, ssh_url: 'git@github.com:fixture-owner/fixture-repo.git',
    default_branch: 'main' } },
  branch: branchCapture(),
  observedAt: '2026-10-07T12:00:00.000Z', evidenceRef: 'fixture-repository-read',
});
const context = () => ({
  connection: 'fixture-connection', repositoryId: 17, repositoryNodeId: 'R_fixture17',
  canonicalLocalRepositoryPath: checkout, remoteRepositoryURL: `${web}.git`,
  remoteDirection: 'fetch',
  selectedRemote: { selectedRemoteName: 'arbitrary-handle', fetchURLs: [`${web}.git`] },
  branchRef: 'refs/heads/main',
});
function changedExecution(change) {
  const observation = execution();
  change(observation);
  return observation;
}
function changedRepository(change) {
  const observation = repositoryCapture();
  const trustedContext = context();
  change(observation, trustedContext);
  return { observation, trustedContext };
}

test('FR-140/141 exact provider scalars preserve numeric JSON and opaque node identities', () => {
  assert.equal(validateGitHubId(17, 'repository ID'), '17');
  assert.equal(validateGitHubId('17', 'repository ID'), '17');
  assert.equal(validateGitHubId(Number.MAX_SAFE_INTEGER, 'run ID'), '9007199254740991');
  assert.equal(validateGitHubId('9007199254740993', 'run ID'), '9007199254740993');
  assert.equal(validateGitHubNodeId('MDEwOlJlcG9zaXRvcnkxNw=='), 'MDEwOlJlcG9zaXRvcnkxNw==');
  assert.equal(validateGitHubNodeId('R_fixture17'), 'R_fixture17');
  assert.equal(githubRepositoryScopeRef(17), 'repository:17');
});

for (const [name, value] of [
  ['absent', undefined], ['null', null], ['zero', 0], ['negative', -1],
  ['fraction', 1.5], ['unsafe JSON number', Number.MAX_SAFE_INTEGER + 1],
  ['NaN', NaN], ['infinity', Infinity], ['boolean', true], ['object', {}],
  ['empty', ''], ['leading zero', '017'], ['zero string', '0'],
  ['whitespace', ' 17'], ['trailing whitespace', '17 '],
  ['exponent', '1e3'], ['signed', '+17'], ['decimal', '17.0'],
]) {
  test(`FR-140/141 rejects ${name} as a provider ID`, () => {
    assert.throws(() => validateGitHubId(value, 'provider ID'), { code: 'INPUT' });
  });
}
for (const value of [undefined, 17, '', ' R_fixture17', 'R_fixture17\n', 'node id']) {
  test(`FR-141 rejects malformed node ID ${JSON.stringify(value)}`, () => {
    assert.throws(() => validateGitHubNodeId(value), { code: 'INPUT' });
  });
}

test('FR-140 attempt identity comes from provider fields and the normalized output is bounded', () => {
  const observation = execution();
  const before = structuredClone(observation);
  assert.deepEqual(normalizeGitHubExecutionLink(observation), {
    identity: identity(), url: `${web}/actions/runs/42/attempts/2`,
    kind: 'summary', accessible: true,
  });
  assert.deepEqual(observation, before);
  observation.run.html_url = observation.access.finalUrl;
  assert.equal(normalizeGitHubExecutionLink(observation).accessible, true);
  observation.run.id = '9007199254740993';
  observation.run.workflow_id = '9007199254740995';
  observation.run.run_attempt = '3';
  observation.run.html_url = `${web}/actions/runs/9007199254740993`;
  observation.access.finalUrl = `${web}/actions/runs/9007199254740993/attempts/3`;
  const normalized = normalizeGitHubExecutionLink(observation);
  assert.equal(normalized.identity.executionRef, '9007199254740993');
  assert.equal(normalized.identity.definitionRef, '9007199254740995');
  assert.equal(normalized.identity.attemptRef, '3');
});

const badLinkPaths = [
  ['API URL', 'https://api.github.com/repos/fixture-owner/fixture-repo/actions/runs/42'],
  ['API-shaped web path', `${web}/api/actions/runs/42/attempts/2`],
  ['login', 'https://github.com/login'],
  ['SSO login', 'https://github.com/orgs/fixture-owner/sso'],
  ['wrong repository', 'https://github.com/fixture-owner/another/actions/runs/42/attempts/2'],
  ['wrong owner', 'https://github.com/other-owner/fixture-repo/actions/runs/42/attempts/2'],
  ['wrong run', `${web}/actions/runs/43/attempts/2`],
  ['wrong attempt', `${web}/actions/runs/42/attempts/1`],
  ['job path', `${web}/actions/runs/42/job/101`],
  ['trailing slash', `${web}/actions/runs/42/attempts/2/`],
  ['untrusted host', 'https://elsewhere.invalid/fixture-owner/fixture-repo/actions/runs/42/attempts/2'],
];
for (const [name, url] of badLinkPaths) {
  for (const source of ['metadata', 'final']) {
    test(`AC-140.2 ${source} ${name} cannot verify the observed attempt`, () => {
      const observation = changedExecution(value => {
        if (source === 'metadata') value.run.html_url = url;
        else value.access.finalUrl = url;
      });
      const normalized = normalizeGitHubExecutionLink(observation);
      assert.equal(normalized.accessible, false);
      assert.equal(normalized.reason,
        'GitHub metadata or final page does not identify the observed repository, run and exact attempt');
    });
  }
}
test('AC-140.3 latest run page is not proof of an exact attempt', () => {
  const observation = changedExecution(value => {
    value.access.finalUrl = value.run.html_url;
  });
  assert.equal(normalizeGitHubExecutionLink(observation).accessible, false);
});
test('AC-140.2 inaccessible human page stays unverified', () => {
  const observation = changedExecution(value => { value.access.accessible = false; });
  assert.deepEqual(normalizeGitHubExecutionLink(observation), {
    identity: identity(), url: `${web}/actions/runs/42/attempts/2`, kind: 'summary',
    accessible: false, reason: 'GitHub execution page is not accessible',
  });
});

for (const [name, change] of [
  ['missing attempt', value => { delete value.run.run_attempt; }],
  ['zero attempt', value => { value.run.run_attempt = 0; }],
  ['unknown attempt', value => { value.run.run_attempt = 'unknown'; }],
  ['missing workflow', value => { delete value.run.workflow_id; }],
  ['missing repository', value => { delete value.run.repository; }],
  ['unsafe repository ID', value => { value.run.repository.id = Number.MAX_SAFE_INTEGER + 1; }],
  ['missing node ID', value => { delete value.run.repository.node_id; }],
  ['undefined access', value => { value.access = undefined; }],
  ['nonboolean access', value => { value.access.accessible = 'true'; }],
  ['unsupported kind', value => { value.kind = 'logs'; }],
  ['expected identity injection', value => { value.identity = identity(); }],
  ['repository alias', value => { value.run.repository.full_name = 'fixture-owner/alias'; }],
]) {
  test(`FR-140 rejects ${name} instead of inventing execution proof`, () => {
    assert.throws(() => normalizeGitHubExecutionLink(changedExecution(change)),
      { code: name === 'repository alias' ? 'EVIDENCE' : 'INPUT' });
  });
}
for (const [name, url] of [
  ['credentials', 'https://user:secret@github.com/fixture-owner/fixture-repo/actions/runs/42/attempts/2'],
  ['userinfo', 'https://user@github.com/fixture-owner/fixture-repo/actions/runs/42/attempts/2'],
  ['token query', `${web}/actions/runs/42/attempts/2?token=fixture-secret`],
  ['encoded token query', `${web}/actions/runs/42/attempts/2?%74oken=fixture-secret`],
  ['fragment', `${web}/actions/runs/42/attempts/2#token=fixture-secret`],
  ['HTTP', `${web.replace('https:', 'http:')}/actions/runs/42/attempts/2`],
  ['dot normalization', `${web}/actions/runs/43/../42/attempts/2`],
  ['backslash normalization', `${web}\\actions\\runs\\42\\attempts\\2`],
]) {
  for (const source of ['metadata', 'final']) {
    test(`AC-140.2 rejects ${source} ${name} without retaining unsafe URL text`, () => {
      assert.throws(() => normalizeGitHubExecutionLink(changedExecution(value => {
        if (source === 'metadata') value.run.html_url = url;
        else value.access.finalUrl = url;
      })), error => error.code === 'INPUT' && !error.message.includes('fixture-secret'));
    });
  }
}
test('FR-140 malformed top-level observations reject', () => {
  for (const value of [undefined, null, [], {}, { ...execution(), unexpected: true }]) {
    assert.throws(() => normalizeGitHubExecutionLink(value), { code: 'INPUT' });
  }
});

test('AC-145.2 import has no GitHub registration and construction is pure', () => {
  assert.ok(!adaptersAfterImport.includes('github'));
  const before = providerAdapterIds();
  const adapter = createGitHubExecutionAdapter();
  assert.equal(adapter.id, 'github');
  assert.equal(adapter.attemptCapability, 'distinct');
  assert.deepEqual(adapter.linkKinds, ['summary']);
  assert.equal(adapter.normalizeLinkObservation, normalizeGitHubExecutionLink);
  assert.deepEqual(providerAdapterIds(), before);
});

// The portable runner isolates this file in its own process; the registry has no unregister API.
test('FR-140/145 registered adapter exercises existing verification and preserves Azure behavior', async t => {
  assert.equal(registerGitHubAdapter(), 'github');
  assert.throws(() => registerGitHubAdapter(), { code: 'ADAPTER' });
  assert.deepEqual(validateAdapterExecutionIdentity('github', identity()), identity());
  await t.test('actual exact identity is admitted through verifyProviderLink', async () => {
    assert.deepEqual(await verifyProviderLink('github', identity(), execution()), {
      verified: true, identity: identity(),
      url: `${web}/actions/runs/42/attempts/2`, kind: 'summary',
    });
  });
  for (const [field, value] of [
    ['connection', 'other-connection'], ['scopeRef', 'repository:18'],
    ['definitionRef', '24'], ['executionRef', '43'], ['attemptRef', '1'],
    ['attemptKind', 'unknown'],
  ]) {
    await t.test(`expected ${field} never becomes its own provider proof`, async () => {
      const expected = { ...identity(), [field]: value };
      if (field === 'attemptKind') delete expected.attemptRef;
      assert.equal((await verifyProviderLink('github', expected, execution())).verified, false);
    });
  }
  await t.test('missing expected attempt and unsupported attempt kind are not credited', async () => {
    const missing = identity();
    delete missing.attemptRef;
    delete missing.attemptKind;
    assert.equal((await verifyProviderLink('github', missing, execution())).verified, false);
    const notApplicable = { ...identity(), attemptKind: 'not-applicable' };
    delete notApplicable.attemptRef;
    assert.equal((await verifyProviderLink('github', notApplicable, execution())).verified, false);
  });
  await t.test('different provider repository ID is independently rejected', async () => {
    const observation = changedExecution(value => {
      value.run.repository.id = 18;
    });
    assert.equal((await verifyProviderLink('github', identity(), observation)).verified, false);
  });
  await t.test('different provider attempt is independently rejected', async () => {
    const observation = changedExecution(value => {
      value.run.run_attempt = 3;
      value.access.finalUrl = `${web}/actions/runs/42/attempts/3`;
    });
    assert.equal((await verifyProviderLink('github', identity(), observation)).verified, false);
  });
  await t.test('wrong final URL and malformed native IDs reject through generic consumer', async () => {
    for (const observation of [
      changedExecution(value => { value.access.finalUrl = 'https://github.com/login'; }),
      changedExecution(value => { value.run.id = undefined; }),
      changedExecution(value => { value.kind = 'unsupported'; }),
    ]) {
      assert.equal((await verifyProviderLink('github', identity(), observation)).verified, false);
    }
  });
  await t.test('existing Azure adapter still verifies its native build page', async () => {
    const expected = {
      provider: 'azure-devops', connection: 'azure-fixture',
      scopeRef: azureDevOpsScopeRef({ projectId: 'project-id', repositoryId: 'repo-id' }),
      definitionRef: '23', executionRef: '42', attemptKind: 'not-applicable',
    };
    const observation = {
      connection: 'azure-fixture',
      build: { id: 42, project: { id: 'project-id' }, repository: { id: 'repo-id' },
        definition: { id: 23 }, _links: { web: {
          href: 'https://dev.azure.com/fixture/project/_build/results?buildId=42',
        } } },
      access: { accessible: true,
        finalUrl: 'https://dev.azure.com/fixture/project/_build/results?buildId=42&view=results' },
    };
    assert.equal((await verifyProviderLink('azure-devops', expected, observation)).verified, true);
    observation.access.finalUrl = 'https://dev.azure.com/fixture/project/_build/results?buildId=43';
    assert.equal((await verifyProviderLink('azure-devops', expected, observation)).verified, false);
  });
});

test('AC-141.1 canonical repository projection binds numeric and node IDs without decoding', () => {
  assert.deepEqual(normalizeGitHubRepositoryIdentity(repository(), {
    connection: 'fixture-connection',
  }), {
    provider: 'github', connection: 'fixture-connection', repositoryRef: 'repository:17',
    repositoryId: '17', repositoryNodeId: 'R_fixture17',
    owner: 'fixture-owner', name: 'fixture-repo', url: web,
  });
});
test('AC-141.1 large repository ID strings are preserved through actual repository consumers', () => {
  const { observation, trustedContext } = changedRepository((value, trusted) => {
    value.repository.body.id = '9007199254740993';
    trusted.repositoryId = '9007199254740993';
  });
  const normalized = normalizeGitHubRepositoryObservation(observation, trustedContext);
  assert.equal(normalized.repository.repositoryId, '9007199254740993');
  assert.equal(validateRepositoryObservation(normalized.observation, normalized.verification)
    .repositoryRef, 'repository:9007199254740993');
});
test('AC-141.1/3 exact captured repository and branch are admitted by existing consumers', () => {
  const capture = repositoryCapture();
  const trustedContext = context();
  const before = structuredClone({ capture, trustedContext });
  const normalized = normalizeGitHubRepositoryObservation(capture, trustedContext);
  const expected = {
    localRepositoryPath: checkout, remoteRepositoryURL: `${web}.git`,
    provider: 'github', connection: 'fixture-connection', repositoryRef: 'repository:17',
    revision: sha, defaultBranchRef: 'refs/heads/main',
    verifiedBranch: { branchRef: 'refs/heads/main', revision: sha },
    observedAt: capture.observedAt, evidenceRef: capture.evidenceRef,
  };
  assert.deepEqual(normalized.observation, expected);
  assert.deepEqual(normalized.verification, {
    canonicalLocalRepositoryPath: checkout, verifiedRemoteRepositoryURL: `${web}.git`,
    verifiedProvider: 'github', verifiedConnection: 'fixture-connection',
    verifiedRepositoryRef: 'repository:17',
    verifiedBranch: { branchRef: 'refs/heads/main', revision: sha },
  });
  assert.deepEqual(validateRepositoryObservation(expected, normalized.verification), expected);
  assert.deepEqual(resolveDefaultBranch({
    selectedFetchRemote: trustedContext.selectedRemote,
    repositoryObservation: expected, verification: normalized.verification,
  }), { resolved: true, branchRef: 'refs/heads/main', source: 'provider-observation' });
  assert.deepEqual({ capture, trustedContext }, before);
  assert.deepEqual(Object.keys(normalized).sort(), ['observation', 'repository', 'verification']);
});
test('AC-141.2 effective push is selected independently and exact SSH metadata proves its URL', () => {
  const { observation, trustedContext } = changedRepository((_, value) => {
    value.remoteDirection = 'push';
    value.remoteRepositoryURL = 'git@github.com:fixture-owner/fixture-repo.git';
    value.selectedRemote = { selectedRemoteName: 'publish-anywhere',
      pushURLs: [value.remoteRepositoryURL] };
  });
  const normalized = normalizeGitHubRepositoryObservation(observation, trustedContext);
  assert.equal(normalized.verification.verifiedRemoteRepositoryURL,
    trustedContext.remoteRepositoryURL);
  assert.equal(normalized.observation.repositoryRef, 'repository:17');
});
test('AC-141.3 selected branch is exact and default name alone supplies no full default-branch proof', () => {
  const { observation, trustedContext } = changedRepository((value, trusted) => {
    value.branch = branchCapture('feature/topic', 'b'.repeat(40));
    trusted.branchRef = 'refs/heads/feature/topic';
  });
  const normalized = normalizeGitHubRepositoryObservation(observation, trustedContext);
  assert.equal(normalized.observation.defaultBranchRef, undefined);
  assert.deepEqual(normalized.observation.verifiedBranch, {
    branchRef: 'refs/heads/feature/topic', revision: 'b'.repeat(40),
  });
  observation.defaultBranch = branchCapture();
  const withDefault = normalizeGitHubRepositoryObservation(observation, trustedContext);
  assert.equal(withDefault.observation.defaultBranchRef, 'refs/heads/main');
});
test('AC-141.2 explicitly captured rename retains stable ID but never aliases the old URL', () => {
  const { observation, trustedContext } = changedRepository((value, trusted) => {
    const body = value.repository.body;
    body.name = 'renamed';
    body.full_name = 'fixture-owner/renamed';
    body.html_url = 'https://github.com/fixture-owner/renamed';
    body.clone_url = `${body.html_url}.git`;
    body.ssh_url = 'git@github.com:fixture-owner/renamed.git';
    value.repository.requestUrl = 'https://api.github.com/repos/fixture-owner/renamed';
    value.branch.requestUrl = `${value.repository.requestUrl}/branches/main`;
    trusted.remoteRepositoryURL = body.clone_url;
    trusted.selectedRemote.fetchURLs = [body.clone_url];
  });
  assert.equal(normalizeGitHubRepositoryObservation(observation, trustedContext)
    .observation.repositoryRef, 'repository:17');
  trustedContext.remoteRepositoryURL = `${web}.git`;
  trustedContext.selectedRemote.fetchURLs = [`${web}.git`];
  assert.throws(() => normalizeGitHubRepositoryObservation(observation, trustedContext),
    { code: 'EVIDENCE' });
});
test('AC-141.4 repository facts grant no authority and existing exact proof guards remain active', () => {
  const normalized = normalizeGitHubRepositoryObservation(repositoryCapture(), context());
  for (const value of [normalized.observation, normalized.verification, normalized.repository]) {
    assert.equal(value.authority, undefined);
    assert.equal(value.permissions, undefined);
  }
  assert.throws(() => validateRepositoryIdentity({
    localRepositoryPath: checkout, remoteRepositoryURL: `${web}.git`, provider: 'github',
    connection: 'fixture-connection', repositoryRef: 'repository:18',
  }, normalized.verification), { code: 'EVIDENCE' });
  assert.throws(() => validateRepositoryObservation({
    ...normalized.observation,
    verifiedBranch: { branchRef: 'refs/heads/main', revision: 'b'.repeat(40) },
  }, normalized.verification), { code: 'EVIDENCE' });
});

for (const [name, code, change] of [
  ['different numeric repository', 'EVIDENCE', value => { value.repository.body.id = 18; }],
  ['different node repository', 'EVIDENCE', value => { value.repository.body.node_id = 'R_other'; }],
  ['wrong captured repository URL', 'EVIDENCE', value => { value.repository.requestUrl = `${api}-fork`; }],
  ['repository prefix endpoint', 'EVIDENCE', value => { value.repository.requestUrl = 'https://api.github.com/user/repos'; }],
  ['matching-ref prefix endpoint', 'EVIDENCE', value => { value.branch.requestUrl = `${api}/git/matching-refs/heads/main`; }],
  ['branch read in another repository', 'EVIDENCE', value => { value.branch.requestUrl = `${api}-fork/branches/main`; }],
  ['branch response prefix', 'EVIDENCE', value => { value.branch.body.name = 'main-extra'; }],
  ['wrong requested branch', 'EVIDENCE', (_, trusted) => { trusted.branchRef = 'refs/heads/other'; }],
  ['missing selected branch capture', 'INPUT', value => { delete value.branch; }],
  ['short SHA', 'INPUT', value => { value.branch.body.commit.sha = 'abc123'; }],
  ['uppercase SHA', 'INPUT', value => { value.branch.body.commit.sha = 'A'.repeat(40); }],
  ['unsupported SHA format', 'INPUT', value => { value.branch.body.commit.sha = 'a'.repeat(64); }],
  ['missing commit', 'INPUT', value => { delete value.branch.body.commit; }],
  ['missing trusted repository ID', 'INPUT', (_, trusted) => { delete trusted.repositoryId; }],
  ['missing trusted node ID', 'INPUT', (_, trusted) => { delete trusted.repositoryNodeId; }],
  ['missing trusted context', 'INPUT', (_, trusted) => { delete trusted.connection; }],
  ['unnormalized connection', 'INPUT', (_, trusted) => { trusted.connection = ' fixture-connection'; }],
  ['unselected URL', 'EVIDENCE', (_, trusted) => { trusted.selectedRemote.fetchURLs = [`${web}-other.git`]; }],
  ['multiple selected URLs', 'EVIDENCE', (_, trusted) => { trusted.selectedRemote.fetchURLs.push(`${web}-other.git`); }],
  ['fetch URLs as push proof', 'INPUT', (_, trusted) => { trusted.remoteDirection = 'push'; }],
  ['relative checkout', 'INPUT', (_, trusted) => { trusted.canonicalLocalRepositoryPath = 'checkout'; }],
  ['noncanonical checkout', 'INPUT', (_, trusted) => { trusted.canonicalLocalRepositoryPath = `${checkout}${path.sep}..${path.sep}checkout`; }],
  ['unverified HTTPS alias', 'EVIDENCE', (_, trusted) => {
    trusted.remoteRepositoryURL = web; trusted.selectedRemote.fetchURLs = [web];
  }],
  ['unverified SSH alias', 'EVIDENCE', (_, trusted) => {
    trusted.remoteRepositoryURL = 'ssh://git@github.com/fixture-owner/fixture-repo.git';
    trusted.selectedRemote.fetchURLs = [trusted.remoteRepositoryURL];
  }],
  ['inconsistent provider clone URL', 'EVIDENCE', value => { value.repository.body.clone_url = `${web}-fork.git`; }],
  ['inconsistent provider SSH URL', 'EVIDENCE', value => { value.repository.body.ssh_url = 'git@github.com:other/repo.git'; }],
  ['unsafe captured request', 'INPUT', value => { value.repository.requestUrl = `${api}?token=fixture-secret`; }],
  ['credentialed repository page', 'INPUT', value => {
    value.repository.body.html_url = 'https://user:secret@github.com/fixture-owner/fixture-repo';
  }],
  ['missing provider default', 'INPUT', value => { delete value.repository.body.default_branch; }],
  ['invalid observation time', 'INPUT', value => { value.observedAt = 'yesterday'; }],
  ['missing evidence reference', 'INPUT', value => { delete value.evidenceRef; }],
  ['provider self-attestation', 'INPUT', value => { value.verification = { verifiedRepositoryRef: 'repository:17' }; }],
  ['invalid full ref', 'INPUT', (_, trusted) => { trusted.branchRef = 'main'; }],
  ['invalid ref component', 'INPUT', (_, trusted) => { trusted.branchRef = 'refs/heads/topic/.hidden'; }],
  ['stale default name', 'EVIDENCE', value => {
    value.repository.body.default_branch = 'new-default'; value.defaultBranch = branchCapture();
  }],
  ['contradictory duplicate default capture', 'EVIDENCE', value => {
    value.defaultBranch = branchCapture('main', 'b'.repeat(40));
  }],
  ['fork numeric ID as base repository', 'EVIDENCE', value => { value.repository.body.id = 88; }],
  ['fork node ID as base repository', 'EVIDENCE', value => { value.repository.body.node_id = 'R_fork88'; }],
]) {
  test(`FR-141 rejects ${name} without satisfying repository/branch proof`, () => {
    const { observation, trustedContext } = changedRepository(change);
    assert.throws(() => normalizeGitHubRepositoryObservation(observation, trustedContext), { code });
  });
}
test('FR-141 unknown, absent and wrongly typed repository envelopes reject', () => {
  for (const value of [undefined, null, [], {}, { ...repositoryCapture(), authority: 'yes' }]) {
    assert.throws(() => normalizeGitHubRepositoryObservation(value, context()), { code: 'INPUT' });
  }
  assert.throws(() => normalizeGitHubRepositoryObservation(repositoryCapture(), undefined),
    { code: 'INPUT' });
});
