export const validationDeclarations = {
  "schemaVersion": 1,
  "surfaces": [{"coverage": "direct", "paths": [
    "src/pr.mjs", "src/pr-description.mjs", "src/operations.mjs",
    "src/policy.mjs", "src/tool-arguments.mjs", "src/external-results.mjs",
    "src/decisions.mjs", "src/schemas.mjs", "src/cli.mjs"
  ]}]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { fixture, grant, observeFixtureRepository, orient } from './helpers.mjs';
import { install } from '../src/install.mjs';
import { digest } from '../src/core.mjs';

const requirementPath = 'docs/sdlc/wallet/requirements.md';
const planPath = 'docs/sdlc/wallet/test-plan.md';
const requirements = `# Independent wallet requirements
### FR-815: Keep the starting balance safe
**Definition of Done**
- AC-815.1: A rejected withdrawal does not change the balance.
`;
const plan = `# Independent wallet Test Plan
| ID | Requirements | Environment | Level | Checkpoint | Mode | Owner | Location | Expected outcome | Implementation | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-WALLET-SAFE | FR-815; AC-815.1 | local | unit | pre-review | automated | agent | local | A rejected withdrawal preserves the original balance | python -m unittest wallet_tests | NotRun |
`;
const contract = {
  adapterId: 'wallet-pr-host', propagatesUniqueCallId: true,
  dispatchIdField: 'dispatch.hostCallId', resultIdField: 'observation.causalProof.hostCallId',
};
const actionFields = ['sourceRevision', 'targetRevision', 'prId',
  'descriptionDigest', 'coverageDigest', 'previousDescriptionDigest', 'descriptionVersion'];

async function repositoryFiles(root, prefix = '') {
  const entries = [];
  for (const entry of await fs.readdir(path.join(root, prefix), { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) entries.push(...await repositoryFiles(root, relative));
    else entries.push(relative);
  }
  return entries.sort();
}

async function installedConsumer(t) {
  const f = await fixture(t, { compactPath: true });
  // Production Git inherits host configuration; both invocation paths must match the LF fixture bytes.
  await f.runGit('config', 'core.autocrlf', 'false');
  await f.runGit('config', 'core.eol', 'lf');
  await install(f.store, { sourceRoot: path.resolve('.') });
  const installed = name => import(pathToFileURL(
    path.join(f.home, 'sdlc', 'src', `${name}.mjs`)).href);
  const [pr, operations, artifacts, { Store }, coverage, { runCli }] = await Promise.all([
    installed('pr'), installed('operations'), installed('artifacts'),
    installed('store'), installed('coverage'), installed('cli'),
  ]);
  const verifier = f.store.verifyRepository;
  const results = new Map();
  f.store = await new Store(f.home, {
    clock: f.clock, verifyRepository: verifier,
    verifyOperationResult: ({ operation, observedResult }) => {
      const captured = results.get(observedResult?.capture);
      assert.ok(captured, 'Only an actual controlled provider acquisition is accepted');
      assert.equal(captured.dispatch.id, operation.id);
      return structuredClone(captured);
    },
  }).ready();
  await fs.mkdir(path.dirname(path.join(f.repo, requirementPath)), { recursive: true });
  await fs.mkdir(path.join(f.repo, '.github', 'workflows'), { recursive: true });
  const ciPath = path.join(f.repo, '.github', 'workflows', 'consumer.yml');
  const ci = 'name: Existing consumer policy\non: push\n';
  await fs.writeFile(ciPath, ci);
  await fs.writeFile(path.join(f.repo, 'wallet_tests.py'),
    'import unittest\n\ndef withdraw(balance, amount):\n' +
    '    if amount < 0 or amount > balance:\n        raise ValueError("invalid withdrawal")\n' +
    '    return balance - amount\n\nclass Wallet(unittest.TestCase):\n' +
    '    def test_safe(self):\n        balance = 100\n' +
    '        with self.assertRaises(ValueError):\n            withdraw(balance, 101)\n' +
    '        self.assertEqual(balance, 100)\n        self.assertEqual(withdraw(balance, 25), 75)\n');
  for (const [role, relative, contents] of [
    ['requirements', requirementPath, requirements], ['test-plan', planPath, plan],
    ['technical-design', 'docs/sdlc/wallet/technical-design.md',
      '# Wallet technical design\nUse the existing Python runner and provider.\n'],
  ]) {
    await fs.writeFile(path.join(f.repo, relative), contents);
    await artifacts.registerArtifact(f.store, {
      workItemId: f.workItemId, repositoryId: 'primary', artifactId: 'wallet', role, path: relative,
    });
  }
  const remote = await f.runGit('remote', 'get-url', 'origin');
  const destination = {
    provider: 'fixture', repositoryId: 'primary', target: 'origin',
    localRepositoryPath: f.repo, remoteRepositoryURL: remote, sourceRepositoryURL: remote,
    sourceRef: 'refs/heads/feature/fixture', targetRef: 'refs/heads/main', draft: true,
  };
  const toolAdapters = ['pr-create', 'pr-update'].map(actionClass => ({
    toolName: actionClass === 'pr-create' ? 'wallet_pr_create' : 'wallet_pr_update',
    action: { class: actionClass, ...destination },
    arguments: Object.fromEntries(actionFields
      .filter(field => actionClass === 'pr-update' ||
        !['prId', 'previousDescriptionDigest', 'descriptionVersion'].includes(field))
      .map(field => [field, { type: 'string', required: true, actionField: field }])),
  }));
  await fs.writeFile(path.join(f.repo, '.sdlc', 'config.json'), JSON.stringify({
    schemaVersion: 1, defaultBranch: 'refs/heads/main', remote: 'origin', toolAdapters,
  }));
  for (const [from, to] of [['requirements', 'test-design'],
    ['test-design', 'technical-design'], ['technical-design', 'coding']]) {
    await grant(f, 'approval', { transition: { from, to } }, { prepared: true });
  }
  await grant(f, 'override', {
    rules: ['local-validation', 'candidate-review', 'review-completion'],
    reason: 'Isolated provider fixture tests the publication boundary, not executed Python/review evidence',
    scope: { repositoryIds: ['primary'], actions: ['pr-create', 'pr-update'] },
  });
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Independent consumer definitions and pre-existing CI');
  await f.runGit('branch', 'main');
  await observeFixtureRepository(f, { defaultBranchRef: 'refs/heads/main' });
  const sourceRevision = await f.runGit('rev-parse', 'HEAD');
  const targetRevision = sourceRevision;
  const identity = { ...destination, connection: 'fixture-connection',
    sourceRevision, targetRevision };
  const legacy = await pr.adoptPr(f.store, {
    workItemId: f.workItemId, pr: {
      provider: 'fixture', connection: 'historical', repositoryId: 'primary',
      sourceRef: 'refs/heads/legacy', targetRef: 'refs/heads/main',
      sourceRevision: 'legacy-source', targetRevision: 'legacy-target',
      draft: false, prId: 'historic-4', url: 'https://example.invalid/pull/historic-4',
      state: 'closed', evidenceRef: 'fixture:retained-legacy-pr',
    },
  });
  const history = (await f.store.records(f.workItemId)).filter(record =>
    record.type === 'event' || record.id === legacy.pr.id);
  const initialFiles = await repositoryFiles(f.repo);
  const provider = {
    live: null, writes: [], attempts: 0, reads: 0,
    loseResponse: false, raceBeforeRead: false, raceBeforeWrite: false,
  };
  let serial = 0;

  async function observe() {
    assert.ok(provider.live);
    f.clock.advance(1);
    const live = provider.live.pr;
    const observation = {
      repositoryId: 'primary', localRepositoryPath: f.repo, remoteRepositoryURL: remote,
      provider: 'fixture', connection: 'fixture-connection', repositoryRef: `repository-${digest(remote).slice(0, 16)}`,
      pullRequestRef: live.prId, sourceRepositoryURL: remote,
      sourceBranchRef: live.sourceRef, targetBranchRef: live.targetRef,
      sourceRevision: live.sourceRevision, targetRevision: live.targetRevision,
      state: 'active', observedAt: new Date(f.clock.now()).toISOString(),
      evidenceRef: `fixture:read-pr:${++serial}`,
    };
    f.store.verifyPullRequest = () => ({
      canonicalLocalRepositoryPath: f.repo, verifiedRemoteRepositoryURL: remote,
      verifiedProvider: observation.provider, verifiedConnection: observation.connection,
      verifiedRepositoryRef: observation.repositoryRef, verifiedPullRequestRef: live.prId,
      verifiedSourceRepositoryURL: remote,
      verifiedSourceBranchRef: live.sourceRef, verifiedTargetBranchRef: live.targetRef,
      verifiedSourceRevision: live.sourceRevision, verifiedTargetRevision: live.targetRevision,
      verifiedState: 'active', verifiedObservedAt: observation.observedAt,
      verifiedEvidenceRef: observation.evidenceRef,
    });
    const previous = (await f.store.records(f.workItemId)).filter(record =>
      record.type === 'pr-observation' && record.pullRequestRef === live.prId).at(-1);
    await pr.adoptPr(f.store, {
      workItemId: f.workItemId, observation,
      ...(previous ? { previousObservationKey: previous.id } : {}),
    });
  }

  const search = () => provider.live ? [{
    ...provider.live.pr, url: `https://example.invalid/pull/${provider.live.pr.prId}`,
    evidenceRef: 'fixture:searched-pr',
  }].map(({ localRepositoryPath, remoteRepositoryURL, sourceRepositoryURL, target, ...match }) => match) : [];

  function effectFor(actionClass, description) {
    return {
      repositoryId: 'primary', sourceRef: identity.sourceRef, targetRef: identity.targetRef,
      draft: true, target: 'origin', localRepositoryPath: f.repo,
      remoteRepositoryURL: remote, sourceRepositoryURL: remote,
      publicationAction: actionClass, sourceRevision: identity.sourceRevision,
      ...(actionClass === 'pr-update' ? { prId: provider.live.pr.prId } : {}),
      ...description.binding, scope: { repositoryIds: ['primary'], actions: [actionClass] },
      lifetime: { kind: 'once' },
    };
  }

  function captureProviderResult(operation, hostCallId, result, status = 'succeeded') {
    const capture = `provider-capture-${operation.id}`;
    const providerResultId = status === 'succeeded' ? result.prId : result.failureRef;
    results.set(capture, {
      dispatch: { id: operation.id, hostCallId, hostCallSupported: true },
      observation: {
        status, family: 'pull-request', target: operation.intendedOutcome.target,
        intendedOutcomeDigest: operation.intendedOutcome.digest,
        providerStatus: status, providerVerified: true, providerResultId,
        causalProof: { kind: 'host-call', dispatchId: operation.id,
          resultId: providerResultId, hostCallId, supported: true },
        result, evidence: { ref: `fixture:${capture}`, verified: true, sha256: digest(result) },
        ...(status === 'failed' ?
          { failure: { terminal: true, providerVerified: true, noEffect: true } } : {}),
      },
    });
    return { capture };
  }

  async function prepare(actionClass, { consent = true, body, effectMutation } = {}) {
    const currentBody = body ?? (actionClass === 'pr-update' ?
      provider.live.body : `Purpose: preserve human text.\n${'A large human description. '.repeat(200)}\nEnd of human purpose.`);
    const descriptionInput = {
      body: currentBody,
      ...(actionClass === 'pr-update' ?
        { descriptionVersion: provider.live.descriptionVersion } : {}),
    };
    const prepared = await pr.preparePrDescription(f.store, {
      workItemId: f.workItemId, repositoryId: 'primary', sourceRevision: identity.sourceRevision,
      class: actionClass, ...descriptionInput,
    });
    let authorization;
    if (consent) {
      const effect = effectFor(actionClass, prepared);
      effectMutation?.(effect);
      authorization = await grant(f, 'pr-publication', effect, { prepared: true });
    }
    const publication = await pr.preparePr(f.store, {
      workItemId: f.workItemId, ...identity, class: actionClass,
      ...(actionClass === 'pr-update' ? { prId: provider.live.pr.prId } : {}),
      remoteSourceRevision: identity.sourceRevision,
      description: descriptionInput, matches: search(),
    });
    assert.equal(publication.action, 'prepare-operation');
    assert.equal(publication.description.body, prepared.body);
    const action = {
      class: actionClass, ...destination, sourceRevision: identity.sourceRevision,
      targetRevision: identity.targetRevision, ...prepared.binding,
      ...(actionClass === 'pr-update' ? { prId: provider.live.pr.prId } : {}),
    };
    const toolName = actionClass === 'pr-create' ? 'wallet_pr_create' : 'wallet_pr_update';
    const toolArgs = Object.fromEntries(actionFields
      .filter(field => action[field] !== undefined).map(field => [field, action[field]]));
    const request = { toolName, toolArgs, cwd: f.repo };
    const hostCallId = `wallet-call-${++serial}`;
    await orient(f);
    const { operation } = await operations.prepareOperation(f.store, {
      workItemId: f.workItemId, sessionId: f.sessionId, action, request,
      correlationKey: `wallet-publication-${serial}`, intent: 'Publish only canonical PR description coverage',
    }, { adapterContract: contract, hostCallId });
    const input = {
      workItemId: f.workItemId, intentId: publication.intent.id,
      operationId: operation.id, body: prepared.body,
    };
    const host = {
      invocation: { sessionId: f.sessionId, ...request }, adapterContract: contract, hostCallId,
      read: async () => {
        provider.reads++;
        if (provider.raceBeforeRead) {
          provider.live.body += '\nConcurrent human addition.';
          provider.live.descriptionVersion = `human-${++serial}`;
          provider.raceBeforeRead = false;
        }
        return { matches: provider.live ? [structuredClone(provider.live)] : [] };
      },
      write: async ({ operation: claimed, body: writtenBody, prId, expectedVersion, expectedBodyDigest }) => {
        assert.equal(claimed.status, 'dispatching');
        assert.equal(claimed.dispatchBound, true, 'Provider mutation must follow the actual atomic claim');
        provider.attempts++;
        if (provider.raceBeforeWrite) {
          provider.live.body += '\nHuman edit after the current read.';
          provider.live.descriptionVersion = `human-${++serial}`;
          provider.raceBeforeWrite = false;
        }
        const previous = provider.live && structuredClone(provider.live);
        if (claimed.class === 'pr-create') assert.equal(provider.live, null);
        else {
          if (prId !== previous.pr.prId || expectedVersion !== previous.descriptionVersion ||
              expectedBodyDigest !== digest(previous.body)) {
            captureProviderResult(claimed, hostCallId, {
              failureRef: `conditional-rejection-${claimed.id}`, remoteRepositoryURL: remote,
            }, 'failed');
            throw new Error('Provider conditional write conflict');
          }
        }
        const nextPrId = previous?.pr.prId ?? '71';
        provider.live = {
          pr: { ...identity, prId: nextPrId, state: 'active' },
          body: writtenBody, descriptionVersion: `provider-${++serial}`,
        };
        provider.writes.push(structuredClone(provider.live));
        const result = {
          prId: nextPrId, sourceRepositoryURL: remote, targetRepositoryURL: remote,
          remoteRepositoryURL: remote, sourceRef: identity.sourceRef, targetRef: identity.targetRef,
          sourceRevision: identity.sourceRevision, targetRevision: identity.targetRevision,
          draft: true, state: 'active', descriptionDigest: digest(provider.live.body),
          coverageDigest: digest(coverage.readCoverageSection(provider.live.body)),
          descriptionVersion: provider.live.descriptionVersion,
          ...(previous ? {
            previousDescriptionDigest: digest(previous.body),
            previousDescriptionVersion: previous.descriptionVersion,
          } : {}),
        };
        const observedResult = captureProviderResult(claimed, hostCallId, result);
        if (provider.loseResponse) {
          provider.loseResponse = false;
          throw new Error('Provider write committed but response was lost');
        }
        return { observedResult };
      },
    };
    return { ...publication, prepared, action, operation, input, host, authorization,
      observedResult: { capture: `provider-capture-${operation.id}` } };
  }
  async function preserve() {
    assert.deepEqual(await repositoryFiles(f.repo), initialFiles,
      'Publication must not create coverage/body/index/policy sidecars');
    assert.equal(await fs.readFile(ciPath, 'utf8'), ci);
    assert.equal(await fs.readFile(path.join(f.repo, planPath), 'utf8'), plan,
      'Publication metadata cannot rewrite NotRun into test execution credit');
    const records = await f.store.records(f.workItemId);
    for (const historical of history) {
      assert.deepEqual(records.find(record => record.id === historical.id), historical,
        'Adoption/publication must not rewrite historical decisions, snapshots or legacy PRs');
    }
    for (const record of records.filter(record => ['pr-intent', 'operation'].includes(record.type))) {
      assert.ok(Buffer.byteLength(JSON.stringify(record)) <= 4096);
      assert.equal(Object.hasOwn(record, 'body'), false);
      assert.equal(Object.hasOwn(record, 'description'), false);
      assert.equal(Object.hasOwn(record.action ?? {}, 'body'), false);
    }
  }
  return { ...f, pr, operations, coverage, identity, provider, prepare, observe,
    effectFor, preserve, results, destination, initialFiles, runCli };
}

test('T-PRD084 installed authorized create and refreshed update preserve unrelated description, canonical history and consumer policy', async t => {
  const f = await installedConsumer(t);
  const cliPrepared = await f.runCli(['pr', 'description-prepare',
    '--work-item', f.workItemId, '--home', f.home, '--cwd', f.repo], {
    stdin: Readable.from([JSON.stringify({
      repositoryId: 'primary', sourceRevision: f.identity.sourceRevision,
      class: 'pr-create', body: 'CLI human purpose.',
    })]),
  }, { createStore: () => f.store });
  assert.equal(cliPrepared.exitCode, 0);
  assert.ok(cliPrepared.result.body.startsWith('CLI human purpose.'));
  assert.equal(f.provider.attempts, 0, 'Installed CLI handoff is in-memory and offline');
  const created = await f.prepare('pr-create');
  assert.equal(f.provider.writes.length, 0, 'Pure preparation never invokes the provider');
  assert.ok(Buffer.byteLength(created.prepared.body) > 4096, 'Body bytes exceed the managed record budget');
  const create = await f.pr.publishPrDescription(f.store, created.input, created.host);
  assert.equal(create.operation.status, 'succeeded');
  assert.equal(f.provider.writes.length, 1);
  assert.equal(f.provider.live.body, created.prepared.body);
  assert.equal(f.coverage.readCoverageSection(f.provider.live.body).sourceRevision, f.identity.sourceRevision);
  const { localRepositoryPath, remoteRepositoryURL, sourceRepositoryURL, target, ...createdPr } = f.provider.live.pr;
  const adopted = await f.pr.adoptPr(f.store, {
    workItemId: f.workItemId, intentId: created.intent.id, operationId: created.operation.id,
    pr: { ...createdPr, url: 'https://example.invalid/pull/71', evidenceRef: 'fixture:created-provider-pr' },
  });
  assert.equal(adopted.pr.prId, '71', 'Existing create-result adoption accepts the causally bound description intent');
  const originalIntent = (await f.store.records(f.workItemId))
    .find(record => record.id === created.intent.id);
  await f.observe();

  const originalBody = f.provider.live.body;
  const oldCoverage = f.coverage.readCoverageSection(originalBody);
  await fs.appendFile(path.join(f.repo, requirementPath),
    '- AC-815.2: An accepted withdrawal returns the exact remainder.\n');
  await f.runGit('add', requirementPath);
  await f.runGit('commit', '-qm', 'Extend the independent consumer definition');
  f.identity.sourceRevision = await f.runGit('rev-parse', 'HEAD');
  f.provider.live.pr.sourceRevision = f.identity.sourceRevision;
  await observeFixtureRepository(f, { defaultBranchRef: 'refs/heads/main' });
  await f.observe();
  await assert.rejects(f.prepare('pr-update', { consent: false }), { code: 'AUTHORITY' });
  assert.equal(f.provider.writes.length, 1, 'Old create authority cannot refresh changed definitions');
  const updated = await f.prepare('pr-update');
  assert.deepEqual(updated.prepared.uncovered, ['AC-815.2']);
  const update = await f.pr.publishPrDescription(f.store, updated.input, updated.host);
  assert.equal(update.operation.status, 'succeeded', 'Coverage gaps are declared, not invented passing results or a publication veto');
  const currentCoverage = f.coverage.readCoverageSection(f.provider.live.body);
  assert.equal(currentCoverage.sourceRevision, f.identity.sourceRevision);
  assert.notEqual(currentCoverage.requirements[0].sha256, oldCoverage.requirements[0].sha256);
  assert.equal(f.provider.live.body,
    f.coverage.replaceCoverageSection(originalBody, currentCoverage),
    'Only the owned block changes; the large human prefix/suffix remain byte-identical');
  const beforeReplay = f.provider.attempts;
  assert.equal((await f.pr.publishPrDescription(f.store, updated.input, updated.host)).action,
    'reconcile-before-write');
  assert.equal(f.provider.attempts, beforeReplay);
  assert.deepEqual((await f.store.records(f.workItemId))
    .find(record => record.id === created.intent.id), originalIntent,
  'Refreshing source-bound metadata must not rewrite the old publication intent');
  await f.preserve();
});

test('T-PRD084 absent or mismatched publication authority and body bindings dispatch zero unauthorized provider writes', async t => {
  const f = await installedConsumer(t);
  await assert.rejects(f.prepare('pr-create', { consent: false }), { code: 'AUTHORITY' });
  await assert.rejects(f.prepare('pr-create', {
    effectMutation: effect => { effect.descriptionDigest = 'f'.repeat(64); },
  }), { code: 'AUTHORITY' });
  const prepared = await f.prepare('pr-create');
  const records = await f.store.records(f.workItemId);
  assert.equal(f.pr.publicationAuthority(records, {
    ...prepared.action, operationId: prepared.operation.id,
  }, f.clock)?.kind, 'pr-publication');
  for (const action of [
    { ...prepared.action, sourceRevision: 'a'.repeat(40) },
    { ...prepared.action, descriptionDigest: 'b'.repeat(64) },
    { ...prepared.action, coverageDigest: 'c'.repeat(64) },
    { ...prepared.action, class: 'pr-update', prId: 'another-pr' },
    { ...prepared.action, descriptionDigest: undefined, coverageDigest: undefined },
  ]) assert.equal(f.pr.publicationAuthority(records, {
    ...action, operationId: prepared.operation.id,
  }, f.clock), undefined, 'Consent cannot be reused for a different source, PR, field scope or body');
  await assert.rejects(f.pr.publishPrDescription(f.store, {
    ...prepared.input, body: prepared.input.body.replace('human text', 'unauthorized human text'),
  }, prepared.host), { code: 'EVIDENCE' });
  await assert.rejects(f.operations.prepareOperation(f.store, {
    workItemId: f.workItemId, sessionId: f.sessionId,
    action: { ...prepared.action, toolOptions: { title: 'An unauthorized title edit' } },
    request: {
      toolName: prepared.host.invocation.toolName, toolArgs: prepared.host.invocation.toolArgs,
      cwd: f.repo,
    },
    correlationKey: 'wrong-body-field-scope', intent: 'Attempt to reuse body-only consent for another PR field',
  }), { code: 'INPUT' });
  await assert.rejects(f.pr.reconcilePrDescription(f.store, {
    workItemId: f.workItemId, intentId: prepared.intent.id, operationId: prepared.operation.id,
    observedResult: { capture: 'forged', verified: true, authorized: true },
  }), { code: 'EVIDENCE' });
  assert.equal(f.provider.attempts, 0);
  assert.equal(f.provider.writes.length, 0);
  const stored = (await f.store.records(f.workItemId)).find(record => record.id === prepared.operation.id);
  assert.equal(stored.dispatchBound, false);
  f.provider.live = {
    pr: { ...f.identity, prId: 'provider-existing-91', state: 'active' },
    body: prepared.prepared.body, descriptionVersion: 'provider-existing-v1',
  };
  await assert.rejects(f.pr.publishPrDescription(f.store, prepared.input, prepared.host),
    { code: 'CONFLICT' });
  assert.equal(f.provider.live.pr.prId, 'provider-existing-91');
  f.provider.live = null;
  await grant(f, 'revocation', { revokes: [prepared.authorization.event.id] });
  await assert.rejects(f.pr.publishPrDescription(f.store, prepared.input, prepared.host),
    { code: 'AUTHORITY' });
  assert.equal(f.provider.writes.length, 0, 'A fresh duplicate search and revoked consent both prevent provider mutation');
  await f.preserve();
});

test('T-PRD084 lost create and update responses require read-only causal reconciliation and never duplicate provider writes', async t => {
  const f = await installedConsumer(t);
  const created = await f.prepare('pr-create');
  f.provider.loseResponse = true;
  const lost = await f.pr.publishPrDescription(f.store, created.input, created.host);
  assert.equal(lost.operation.status, 'uncertain');
  assert.equal(lost.operation.dispatchBound, true);
  assert.equal(f.provider.writes.length, 1);
  assert.equal((await f.pr.publishPrDescription(f.store, created.input, created.host)).action,
    'reconcile-before-write');
  await assert.rejects(f.pr.reconcilePrDescription(f.store, {
    workItemId: f.workItemId, intentId: created.intent.id, operationId: created.operation.id,
    observedResult: { capture: 'forged', verified: true, authorized: true },
  }), /Only an actual controlled provider acquisition is accepted/u);
  await assert.rejects(f.prepare('pr-create', { body: 'A differently worded purpose.' }),
    { code: 'UNCERTAIN' });
  assert.equal(f.provider.writes.length, 1);
  const create = await f.pr.reconcilePrDescription(f.store, {
    workItemId: f.workItemId, intentId: created.intent.id, operationId: created.operation.id,
    observedResult: created.observedResult,
  });
  assert.equal(create.operation.status, 'succeeded');
  assert.equal(f.provider.attempts, 1);
  await f.observe();
  const update = await f.prepare('pr-update');
  f.provider.loseResponse = true;
  const lostUpdate = await f.pr.publishPrDescription(f.store, update.input, update.host);
  assert.equal(lostUpdate.operation.status, 'uncertain');
  assert.equal(f.provider.writes.length, 2);
  assert.equal((await f.pr.publishPrDescription(f.store, update.input, update.host)).action,
    'reconcile-before-write');
  const wrongBody = structuredClone(f.results.get(update.observedResult.capture));
  wrongBody.observation.result.descriptionDigest = 'd'.repeat(64);
  wrongBody.observation.evidence.sha256 = digest(wrongBody.observation.result);
  f.results.set('wrong-provider-body', wrongBody);
  assert.equal((await f.pr.reconcilePrDescription(f.store, {
    workItemId: f.workItemId, intentId: update.intent.id, operationId: update.operation.id,
    observedResult: { capture: 'wrong-provider-body' },
  })).operation.status, 'uncertain', 'Even a causal result for the PR must prove the exact authorized body');
  const reconciled = await f.pr.reconcilePrDescription(f.store, {
    workItemId: f.workItemId, intentId: update.intent.id, operationId: update.operation.id,
    observedResult: update.observedResult,
  });
  assert.equal(reconciled.operation.status, 'succeeded');
  assert.equal(f.provider.attempts, 2);
  await f.preserve();
});

test('T-PRD084 concurrent human edits are re-read and conditional provider updates never blindly overwrite them', async t => {
  const f = await installedConsumer(t);
  const create = await f.prepare('pr-create');
  await f.pr.publishPrDescription(f.store, create.input, create.host);
  await f.observe();
  const beforeRead = await f.prepare('pr-update');
  const read = beforeRead.host.read;
  beforeRead.host.read = async () => ({
    matches: [{ ...structuredClone(f.provider.live),
      pr: { ...f.provider.live.pr, prId: 'another-provider-pr' } }],
  });
  await assert.rejects(f.pr.publishPrDescription(f.store, beforeRead.input, beforeRead.host),
    { code: 'EVIDENCE' });
  beforeRead.host.read = read;
  f.provider.raceBeforeRead = true;
  await assert.rejects(f.pr.publishPrDescription(f.store, beforeRead.input, beforeRead.host),
    { code: 'STALE' });
  assert.equal(f.provider.attempts, 1);
  assert.ok(f.provider.live.body.endsWith('Concurrent human addition.'));
  const afterRead = await f.prepare('pr-update');
  f.provider.raceBeforeWrite = true;
  const conflict = await f.pr.publishPrDescription(f.store, afterRead.input, afterRead.host);
  assert.equal(conflict.operation.status, 'uncertain');
  assert.equal(f.provider.writes.length, 1, 'CAS rejects a race between read and conditional mutation');
  assert.ok(f.provider.live.body.endsWith('Human edit after the current read.'));
  assert.equal((await f.pr.publishPrDescription(f.store, afterRead.input, afterRead.host)).action,
    'reconcile-before-write');
  assert.equal(f.provider.attempts, 2);
  const rejected = await f.pr.reconcilePrDescription(f.store, {
    workItemId: f.workItemId, intentId: afterRead.intent.id, operationId: afterRead.operation.id,
    observedResult: afterRead.observedResult, status: 'failed',
  });
  assert.equal(rejected.operation.status, 'failed', 'Read-only provider proof establishes the rejected conditional update');
  const humanBody = f.provider.live.body;
  const refreshed = await f.prepare('pr-update');
  assert.equal((await f.pr.publishPrDescription(f.store, refreshed.input, refreshed.host))
    .operation.status, 'succeeded');
  assert.equal(f.provider.writes.length, 2);
  assert.equal(f.provider.live.body, f.coverage.replaceCoverageSection(humanBody,
    f.coverage.readCoverageSection(f.provider.live.body)));
  assert.ok(f.provider.live.body.endsWith('Human edit after the current read.'));
  assert.equal((await f.store.records(f.workItemId))
    .find(record => record.id === afterRead.operation.id).status, 'failed',
  'A later successful refresh must retain the original provider rejection unchanged');
  await f.preserve();
});
