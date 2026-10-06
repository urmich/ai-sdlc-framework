import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {
  prepareOperation, markDispatching, recordOperation,
} from '../src/operations.mjs';
import { digest } from '../src/core.mjs';
import { captureReceipt } from '../src/decisions.mjs';
import { startCycle } from '../src/validation.mjs';
import {
  fixture, coding, grant, observeFixtureRepository, testDefinitions,
  registerFixtureProviderRequest, registerFixtureProviderResult,
} from './helpers.mjs';

async function retryFixture(t, { withCycle = false, objectFormat = 'sha1' } = {}) {
  const f = await fixture(t, { initialize: objectFormat === 'sha1' });
  if (objectFormat === 'sha256') {
    const repo = path.join(f.root, 'SHA-256 repository');
    await fs.mkdir(repo);
    const runGit = f.runGit;
    f.runGit = (...args) => runGit('-C', repo, ...args);
    await f.runGit('init', '-q', '--object-format=sha256', '-b', 'feature/fixture');
    await f.runGit('remote', 'add', 'origin', 'https://example.invalid/repository.git');
    assert.equal(await f.runGit('rev-parse', '--show-object-format'), 'sha256');
    f.repo = repo;
    await captureReceipt(f.store, {
      sessionId: f.sessionId, source: 'userPromptSubmitted',
      input: 'Create the isolated SHA-256 retry fixture.',
    });
    await f.store.init({
      workItemId: f.workItemId, repositoryId: 'primary',
      cwd: repo, sessionId: f.sessionId,
    });
  }
  await coding(f);
  if (withCycle) {
    await fs.writeFile(path.join(f.repo, '.sdlc', 'config.json'),
      JSON.stringify({
        defaultBranch: 'refs/heads/main',
        environments: {
          DEV: { target: 'dev-resource', configDigest: 'config-v1' },
        },
      }));
  }
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Isolated normalized retry candidate');
  const repository = await observeFixtureRepository(f);
  const sourceRevision = await f.runGit('rev-parse', 'HEAD');
  const cycle = withCycle ? (await startCycle(f.store, {
    workItemId: f.workItemId, tests: testDefinitions(),
    configDigest: 'config-v1', cause: 'Isolated normalized retry boundary',
  })).cycle : null;
  const action = {
    class: 'configuration', repositoryId: 'primary',
    target: 'branch-protection', policyVersion: 'policy-v2',
  };
  const prepare = (correlationKey, suppliedAction = action, toolArgs = {
    target: action.target, policyVersion: action.policyVersion,
  }, extra = {}) => prepareOperation(f.store, {
    workItemId: f.workItemId, sessionId: f.sessionId,
    action: suppliedAction,
    request: { toolName: 'fixture_policy_update', toolArgs, cwd: f.repo },
    correlationKey, intent: 'Apply the exact isolated hosted policy version',
    ...extra,
  });
  const uncertain = async operation => {
    registerFixtureProviderRequest(f, operation);
    await markDispatching(f.store, f.workItemId, operation.id);
    return recordOperation(f.store, {
      workItemId: f.workItemId, operationId: operation.id, status: 'uncertain',
    });
  };
  return { f, action, sourceRevision, prepare, uncertain, repository, cycle };
}

async function policySuccess(f, operation) {
  registerFixtureProviderRequest(f, operation);
  await markDispatching(f.store, f.workItemId, operation.id);
  const observedResult = registerFixtureProviderResult(f, operation, {
    providerResultId: `${operation.target}:${operation.action.policyVersion}`,
    result: {
      target: operation.target, policyVersion: operation.action.policyVersion,
      remoteRepositoryURL: operation.intendedOutcome.target.remoteRepositoryURL,
      changeApplied: true,
    },
  });
  return recordOperation(f.store, {
    workItemId: f.workItemId, operationId: operation.id,
    status: 'succeeded', observedResult,
  });
}

async function seedLegacyOperation(f, operation, suppliedAction) {
  // Preserve the HEAD-era operation shape and only the action facts supplied then.
  const legacy = Object.fromEntries([
    'type', 'id', 'workItemId', 'sessionId', 'repositoryId', 'bindingKey',
    'class', 'target', 'status', 'correlationKey', 'requestFingerprint',
    'intent', 'createdAt', 'dispatchBound', 'cycleId', 'candidateDigest',
    'candidateStamp', 'reservedEventIds', 'dispatchStartedAt', 'updatedAt',
  ].filter(field => operation[field] !== undefined)
    .map(field => [field, operation[field]]));
  legacy.action = { ...suppliedAction, operationId: operation.id };
  legacy.target = suppliedAction.target ?? 'local';
  legacy.effectFingerprint = digest(suppliedAction);
  await f.store.transaction(f.workItemId, tx => tx.put(legacy));
  const stored = (await f.store.records(f.workItemId))
    .find(record => record.id === legacy.id);
  assert.deepEqual(stored, legacy);
  assert.equal(stored.intendedOutcome, undefined);
  assert.equal(stored.resultProof, undefined);
  return stored;
}

test('T-124 SHA-256 legacy abbreviated revisions cannot exclude the same full commit or ambiguous hash width', async t => {
  const { f, action, sourceRevision, prepare, uncertain } =
    await retryFixture(t, { objectFormat: 'sha256' });
  assert.equal(sourceRevision.length, 64);
  const suppliedAction = { ...action, sourceRevision, configDigest: 'config-v1' };
  const first = (await prepare('sha256-original', suppliedAction,
    { attempt: 1, sourceRevision: sourceRevision.slice(0, 40) })).operation;
  const recorded = await uncertain(first);
  let legacy;
  for (const width of [40, 41, 63]) {
    const abbreviation = sourceRevision.slice(0, width);
    assert.equal(await f.runGit('rev-parse', '--verify', `${abbreviation}^{commit}`),
      sourceRevision);
    legacy = await seedLegacyOperation(f, recorded, {
      ...suppliedAction, sourceRevision: abbreviation,
    });
    await assert.rejects(prepare(`sha256-full-retry-${width}`, suppliedAction,
      { attempt: 2, width, sourceRevision }), { code: 'UNCERTAIN' },
    'A Git-proven abbreviation of the same commit cannot authorize another dispatch');
    assert.deepEqual((await f.store.records(f.workItemId))
      .find(record => record.id === legacy.id), legacy);
  }
  await f.runGit('branch', 'historical-source', sourceRevision);
  await fs.writeFile(path.join(f.repo, 'changed-source.mjs'), 'export const changed = true;\n');
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Later isolated SHA-256 source');
  f.clock.advance(1);
  await observeFixtureRepository(f);
  const laterRevision = await f.runGit('rev-parse', 'HEAD');
  assert.notEqual(laterRevision, sourceRevision);
  assert.equal(await f.runGit('rev-parse', 'refs/heads/historical-source'), sourceRevision);
  legacy = await seedLegacyOperation(f, recorded, {
    ...suppliedAction, sourceRevision: sourceRevision.slice(0, 40),
  });
  await assert.rejects(prepare('sha256-unknown-historical-format', {
    ...suppliedAction, sourceRevision: laterRevision,
  }, { attempt: 3, sourceRevision: laterRevision }), { code: 'UNCERTAIN' },
  'Different hash widths cannot prove a distinct historical identity without its stored format');
  assert.deepEqual((await f.store.records(f.workItemId))
    .filter(record => record.type === 'operation'), [legacy]);
});

test('T-124 current local configuration preparation does not block independent hosted configuration', async t => {
  const { f, action, sourceRevision, prepare } = await retryFixture(t);
  for (const [index, localAction] of [
    { class: 'configuration', repositoryId: 'primary', paths: ['.sdlc/config.json'] },
    { class: 'configuration', repositoryId: 'primary',
      environment: 'local', paths: ['.sdlc/config.json'] },
    { class: 'configuration', repositoryId: 'primary', target: 'local',
      environment: 'local', paths: ['.sdlc/config.json'] },
  ].entries()) {
    const local = (await prepare(`local-before-hosted-${index}`, localAction,
      { localEdit: index, path: '.sdlc/config.json' })).operation;
    assert.equal(local.intendedOutcome, undefined);
    assert.equal(local.target, 'local');
    const hosted = (await prepare(`hosted-after-local-${index}`, {
      ...action, sourceRevision, policyVersion: `policy-v${index + 2}`,
    }, { hostedUpdate: index, sourceRevision })).operation;
    assert.equal(hosted.retryOverrideId, undefined);
    assert.equal(hosted.priorUncertainOperationId, undefined);
    assert.equal(hosted.intendedOutcome.family, 'policy');
    assert.equal(hosted.intendedOutcome.target.target, action.target);
    assert.equal(hosted.intendedOutcome.requested.sourceRevision, sourceRevision);
    const completed = await policySuccess(f, hosted);
    assert.equal(completed.resultProof.dispatchId, hosted.id);
    assert.equal(completed.resultProof.intendedOutcomeDigest, hosted.intendedOutcome.digest);
    assert.equal(completed.resultProof.status, 'succeeded');
    assert.deepEqual((await f.store.records(f.workItemId))
      .find(record => record.id === local.id), local);
  }
});

test('T-124 SHA-256 known distinct source and target refs remain independent while target prefixes stay ambiguous', { concurrency: 2 }, async t => {
  await Promise.all(['sourceRevision', 'targetRevision'].map(field =>
    t.test(`T-124 SHA-256 ${field} comparison`, async child => {
      const { f, action, sourceRevision, prepare, uncertain } =
        await retryFixture(child, { objectFormat: 'sha256' });
      await f.runGit('branch', 'historical-reference', sourceRevision);
      let historicalAction = { ...action, sourceRevision, configDigest: 'config-v1' };
      let legacy;
      if (field === 'sourceRevision') {
        legacy = await seedLegacyOperation(f, await uncertain(
          (await prepare('sha256-known-original', historicalAction, { attempt: 1 })).operation),
        historicalAction);
      }
      await fs.writeFile(path.join(f.repo, 'distinct-source.mjs'), 'export const distinct = true;\n');
      await f.runGit('add', '.');
      await f.runGit('commit', '-qm', 'Distinct isolated SHA-256 reference');
      f.clock.advance(1);
      await observeFixtureRepository(f);
      const laterRevision = await f.runGit('rev-parse', 'HEAD');
      assert.equal(laterRevision.length, 64);
      assert.notEqual(laterRevision, sourceRevision);
      assert.equal(await f.runGit('rev-parse', 'refs/heads/historical-reference'), sourceRevision);
      if (field === 'targetRevision') {
        historicalAction = {
          ...historicalAction, sourceRevision: laterRevision,
          targetRef: 'refs/heads/historical-reference', targetRevision: sourceRevision,
        };
        legacy = await seedLegacyOperation(f, await uncertain(
          (await prepare('sha256-known-target', historicalAction, { attempt: 1 })).operation),
        historicalAction);
        const prefixAction = { ...historicalAction, policyVersion: 'policy-v3' };
        const recorded = await uncertain(
          (await prepare('sha256-target-prefix-original', prefixAction, { attempt: 2 })).operation);
        for (const width of [40, 41, 63]) {
          const abbreviation = sourceRevision.slice(0, width);
          assert.equal(await f.runGit('rev-parse', '--verify', `${abbreviation}^{commit}`),
            sourceRevision);
          const prefixLegacy = await seedLegacyOperation(f, recorded, {
            ...prefixAction, targetRevision: abbreviation,
          });
          await assert.rejects(prepare(`sha256-target-prefix-retry-${width}`, prefixAction,
            { attempt: 3, targetRevision: sourceRevision, width }), { code: 'UNCERTAIN' });
          assert.deepEqual((await f.store.records(f.workItemId))
            .find(record => record.id === prefixLegacy.id), prefixLegacy);
        }
        await f.runGit('branch', '-f', 'historical-reference', laterRevision);
      }
      const nextAction = { ...historicalAction, [field]: laterRevision };
      const next = (await prepare(`sha256-known-different-${field}`, nextAction,
        { attempt: 4, [field]: laterRevision })).operation;
      assert.equal(next.retryOverrideId, undefined);
      assert.equal(next.intendedOutcome.requested[field], laterRevision);
      assert.notEqual(next.intendedOutcome.requested[field], legacy.action[field]);
      assert.equal(legacy.action[field].length, 64);
      assert.deepEqual((await f.store.records(f.workItemId))
        .find(record => record.id === legacy.id), legacy);
    })));
});

test('T-124 legacy uncertain operation with stored same source and configuration blocks an equivalent explicit retry', async t => {
  const { f, action, sourceRevision, prepare, uncertain } = await retryFixture(t);
  const historicalAction = { ...action, sourceRevision, configDigest: 'config-v1' };
  const first = (await prepare('legacy-stored-source', historicalAction,
    { attempt: 1, policyVersion: action.policyVersion })).operation;
  const legacy = await seedLegacyOperation(f, await uncertain(first), historicalAction);
  assert.equal(legacy.action.sourceRevision, sourceRevision);
  assert.equal(legacy.action.configDigest, 'config-v1');
  assert.equal(legacy.action.remoteRepositoryURL, undefined);
  await assert.rejects(prepare('legacy-explicit-retry', historicalAction,
    { attempt: 2, sourceRevision, configDigest: 'config-v1' }),
  { code: 'UNCERTAIN' },
  'Missing modern outcome evidence must not permit credit for the same stored legacy effect');
  const operations = (await f.store.records(f.workItemId))
    .filter(record => record.type === 'operation');
  assert.deepEqual(operations, [legacy]);
});

test('T-124 legacy known different destinations revisions configurations and targets remain independent', { concurrency: 3 }, async t => {
  await Promise.all(['destination', 'revision', 'configuration', 'target']
    .map(difference => t.test(`T-124 legacy different ${difference}`, async child => {
      const { f, action, sourceRevision, repository, prepare, uncertain } =
        await retryFixture(child);
      const historicalAction = difference === 'destination' ? {
        class: 'push', repositoryId: 'primary', target: 'origin',
        sourceRef: 'refs/heads/feature/fixture',
        targetRef: 'refs/heads/feature/fixture', sourceRevision,
        remoteUrlDigest: digest([repository.remoteRepositoryURL]),
        force: false, delete: false,
      } : { ...action, sourceRevision, configDigest: 'config-v1' };
      if (difference === 'destination') {
        await grant(f, 'override', {
          rules: ['push', 'local-validation', 'candidate-review', 'review-completion'],
          scope: { repositoryIds: ['primary'], actions: ['push'] },
          reason: 'Isolated destination comparison waives delivery gates; no Git push is executed',
        });
      }
      const first = (await prepare(`legacy-before-${difference}`, historicalAction,
        { attempt: 1 })).operation;
      const legacy = await seedLegacyOperation(f, await uncertain(first), historicalAction);
      let nextAction = { ...historicalAction };
      if (difference === 'destination') {
        await f.runGit('remote', 'set-url', 'origin',
          'https://example.invalid/different-repository.git');
        const nextRepository = await observeFixtureRepository(f);
        nextAction.remoteUrlDigest = digest([nextRepository.remoteRepositoryURL]);
      } else if (difference === 'revision') {
        await fs.writeFile(path.join(f.repo, 'next-source.mjs'), 'export const next = true;\n');
        await f.runGit('add', '.');
        await f.runGit('commit', '-qm', 'Different isolated source revision');
        f.clock.advance(1);
        await observeFixtureRepository(f);
        nextAction.sourceRevision = await f.runGit('rev-parse', 'HEAD');
        assert.notEqual(nextAction.sourceRevision, legacy.action.sourceRevision);
      } else if (difference === 'configuration') {
        nextAction.configDigest = 'config-v2';
      } else {
        nextAction.target = 'different-branch-protection';
      }
      const next = (await prepare(`legacy-after-${difference}`, nextAction,
        { attempt: 2, difference })).operation;
      assert.notEqual(next.requestFingerprint, legacy.requestFingerprint);
      assert.notEqual(next.effectFingerprint, legacy.effectFingerprint);
      assert.equal(next.retryOverrideId, undefined);
      if (difference === 'destination') {
        assert.notEqual(next.intendedOutcome.target.remoteUrlDigest,
          legacy.action.remoteUrlDigest);
      } else {
        const field = difference === 'revision' ? 'sourceRevision' :
          difference === 'configuration' ? 'configDigest' : 'target';
        const scope = field === 'target' ?
          next.intendedOutcome.target : next.intendedOutcome.requested;
        assert.notEqual(scope[field], legacy.action[field]);
      }
      assert.deepEqual((await f.store.records(f.workItemId))
        .find(record => record.id === legacy.id), legacy);
    })));
});

test('T-124 legacy absent abbreviated and ambiguous scope stays unresolved only for plausible matching work', async t => {
  const { f, action, sourceRevision, prepare, uncertain } = await retryFixture(t);
  const historicalAction = { ...action, sourceRevision, configDigest: 'config-v1' };
  const first = (await prepare('legacy-incomplete-base', historicalAction,
    { attempt: 1 })).operation;
  const recorded = await uncertain(first);
  const variants = [
    { ...action, configDigest: 'config-v1' },
    { ...action, sourceRevision },
    { ...action, sourceRevision: 'unknown', configDigest: 'unknown' },
    { ...action, sourceRevision, configDigest: false },
    { ...action, sourceRevision: sourceRevision.slice(0, 12), configDigest: 'config-v1' },
    { class: 'configuration', repositoryId: 'primary',
      paths: ['.sdlc/config.json'], policyVersion: action.policyVersion },
    { class: 'configuration', repositoryId: 'primary',
      paths: ['.sdlc/config.json'], implicitEnvironments: ['historical-unknown-label'] },
    { class: 'configuration', repositoryId: 'primary' },
  ];
  for (const [index, suppliedAction] of variants.entries()) {
    const legacy = await seedLegacyOperation(f, recorded, suppliedAction);
    await assert.rejects(prepare(`legacy-incomplete-${index}`, historicalAction,
      { attempt: index + 2, sourceRevision, configDigest: 'config-v1' }),
    { code: 'UNCERTAIN' });
    assert.deepEqual((await f.store.records(f.workItemId))
      .find(record => record.id === legacy.id), legacy);
  }
  const local = (await prepare('unrelated-local-work', {
    class: 'configuration', repositoryId: 'primary', paths: ['.sdlc/config.json'],
  }, { path: '.sdlc/config.json', localEdit: true })).operation;
  assert.equal(local.intendedOutcome, undefined);
  await grant(f, 'override', {
    rules: ['merge'],
    scope: { repositoryIds: ['primary'], actions: ['merge'], target: 'origin' },
    reason: 'Isolated distinct family preparation; no merge is executed',
  });
  const merge = (await prepare('unrelated-external-family', {
    class: 'merge', repositoryId: 'primary', target: 'origin',
    prId: 'fixture-pr-42', sourceRevision, targetRevision: sourceRevision,
  }, { prId: 'fixture-pr-42', merge: true })).operation;
  assert.equal(merge.intendedOutcome.family, 'merge');
  assert.equal(merge.retryOverrideId, undefined);
  assert.equal((await f.store.records(f.workItemId))
    .find(record => record.id === first.id).status, 'uncertain');
});

test('T-124 legacy unknown revision and hosted identity cannot be reconstructed from current HEAD or remote', async t => {
  const { f, action, sourceRevision, prepare, uncertain } = await retryFixture(t);
  const first = (await prepare('legacy-unknown-source', action,
    { attempt: 1 })).operation;
  const legacy = await seedLegacyOperation(f, await uncertain(first), action);
  await fs.writeFile(path.join(f.repo, 'later-source.mjs'), 'export const later = true;\n');
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Later isolated checkout and destination');
  await f.runGit('remote', 'set-url', 'origin',
    'https://example.invalid/later-repository.git');
  const repository = await observeFixtureRepository(f);
  const laterRevision = await f.runGit('rev-parse', 'HEAD');
  assert.notEqual(laterRevision, sourceRevision);
  assert.equal(legacy.action.sourceRevision, undefined);
  assert.equal(legacy.action.remoteRepositoryURL, undefined);
  assert.equal(legacy.action.remoteUrlDigest, undefined);
  await assert.rejects(prepare('legacy-current-defaults', {
    ...action, sourceRevision: laterRevision,
    localRepositoryPath: f.repo, remoteRepositoryURL: repository.remoteRepositoryURL,
  }, { attempt: 2, sourceRevision: laterRevision,
    remoteRepositoryURL: repository.remoteRepositoryURL }), { code: 'UNCERTAIN' });
  assert.deepEqual((await f.store.records(f.workItemId))
    .find(record => record.id === legacy.id), legacy);
});

test('T-124 legacy retry requires the exact scoped exception and leaves all historical evidence unchanged', async t => {
  const { f, action, sourceRevision, prepare, uncertain } = await retryFixture(t);
  const historicalAction = { ...action, sourceRevision, configDigest: 'config-v1' };
  const first = (await prepare('legacy-exception-original', historicalAction,
    { attempt: 1 })).operation;
  const legacy = await seedLegacyOperation(f, await uncertain(first), historicalAction);
  const operationId = 'legacy-exact-replacement';
  const extra = { operationId };
  for (const scope of [
    { repositoryIds: ['different-repository'] },
    { target: 'different-policy' },
    { actions: ['merge'] },
    { operationId: 'different-replacement' },
  ]) {
    await grant(f, 'override', {
      rules: ['uncertain-retry'], scope,
      reason: 'Isolated legacy exception outside the requested replacement scope',
    });
    await assert.rejects(prepare('legacy-exact-exception', historicalAction,
      { attempt: 2 }, extra), { code: 'UNCERTAIN' });
  }
  const exception = await grant(f, 'override', {
    rules: ['uncertain-retry'],
    scope: { repositoryIds: ['primary'], actions: ['configuration'],
      target: action.target, operationId },
    reason: 'Isolated user permits exactly this replacement of an unresolved historical effect',
  });
  const replacement = (await prepare('legacy-exact-exception', historicalAction,
    { attempt: 2 }, extra)).operation;
  assert.equal(replacement.retryOverrideId, exception.event.id);
  assert.equal(replacement.priorUncertainOperationId, legacy.id);
  assert.equal(replacement.intendedOutcome.requested.sourceRevision,
    legacy.action.sourceRevision);
  assert.equal(replacement.intendedOutcome.requested.configDigest,
    legacy.action.configDigest);
  const completed = await policySuccess(f, replacement);
  assert.equal(completed.resultProof.status, 'succeeded');
  assert.equal(completed.resultProof.dispatchId, replacement.id);
  assert.equal(completed.resultProof.intendedOutcomeDigest, replacement.intendedOutcome.digest);
  assert.deepEqual((await f.store.records(f.workItemId))
    .find(record => record.id === legacy.id), legacy);
  await assert.rejects(prepare('legacy-exception-not-transferred', historicalAction,
    { attempt: 3 }, { operationId: 'legacy-other-replacement' }), { code: 'UNCERTAIN' });
});

test('T-124 multiple historical records cannot hide a later matching unresolved effect', async t => {
  const { f, action, sourceRevision, prepare, uncertain } = await retryFixture(t);
  const unrelatedAction = { ...action, sourceRevision, policyVersion: 'policy-v1' };
  const unrelated = await seedLegacyOperation(f, await uncertain(
    (await prepare('legacy-unrelated-first', unrelatedAction, { attempt: 1 })).operation),
  unrelatedAction);
  const matchingAction = { ...action, sourceRevision, configDigest: 'config-v1' };
  const matching = await seedLegacyOperation(f, await uncertain(
    (await prepare('legacy-matching-second', matchingAction, { attempt: 2 })).operation),
  matchingAction);
  await assert.rejects(prepare('legacy-search-all-records', matchingAction,
    { attempt: 3, sourceRevision }), { code: 'UNCERTAIN' });
  const exception = await grant(f, 'override', {
    rules: ['uncertain-retry'],
    scope: { repositoryIds: ['primary'], actions: ['configuration'],
      target: action.target, operationId: 'legacy-multiple-replacement' },
    reason: 'Isolated user permits the exact matching historical replacement',
  });
  const replacement = (await prepare('legacy-search-all-records', matchingAction,
    { attempt: 3, sourceRevision },
    { operationId: 'legacy-multiple-replacement' })).operation;
  assert.equal(replacement.retryOverrideId, exception.event.id);
  assert.equal(replacement.priorUncertainOperationId, matching.id);
  for (const historical of [unrelated, matching]) {
    assert.deepEqual((await f.store.records(f.workItemId))
      .find(record => record.id === historical.id), historical);
  }
});

test('T-124 legacy prepared effect takes precedence over uncertain predecessors even with a retry exception', async t => {
  const { f, action, sourceRevision, prepare, uncertain } = await retryFixture(t);
  const firstAction = { ...action, sourceRevision, configDigest: 'config-v1' };
  const first = await uncertain((await prepare('legacy-uncertain-before-prepared',
    firstAction, { attempt: 1 })).operation);
  const secondAction = { ...action, sourceRevision, configDigest: 'config-v2' };
  const second = (await prepare('legacy-prepared-after-uncertain', secondAction,
    { attempt: 2 })).operation;
  const { configDigest: omittedConfiguration, ...unknownConfiguration } = firstAction;
  assert.equal(omittedConfiguration, 'config-v1');
  const legacyUncertain = await seedLegacyOperation(f, first, unknownConfiguration);
  const legacyPrepared = await seedLegacyOperation(f, second, secondAction);
  await grant(f, 'override', {
    rules: ['uncertain-retry'],
    scope: { repositoryIds: ['primary'], actions: ['configuration'],
      target: action.target },
    reason: 'Isolated exception for uncertain effects cannot authorize a second prepared effect',
  });
  await assert.rejects(prepare('legacy-prepared-blocks-retry', secondAction,
    { attempt: 3 }), { code: 'UNCERTAIN' });
  for (const historical of [legacyUncertain, legacyPrepared]) {
    assert.deepEqual((await f.store.records(f.workItemId))
      .find(record => record.id === historical.id), historical);
  }
});

test('T-124 uncertain hosted configuration blocks an explicit same-HEAD retry after omitted sourceRevision', async t => {
  const { f, action, sourceRevision, prepare, uncertain } = await retryFixture(t);
  const first = (await prepare('omitted-source')).operation;
  assert.equal(first.action.sourceRevision, undefined);
  assert.equal(first.intendedOutcome.requested.sourceRevision, sourceRevision);
  const recorded = await uncertain(first);
  assert.equal(recorded.status, 'uncertain');
  assert.equal(recorded.resultProof, undefined);

  await assert.rejects(prepare('explicit-same-source', {
    ...action, sourceRevision,
  }, { target: action.target, policyVersion: action.policyVersion, sourceRevision }),
  { code: 'UNCERTAIN' },
  'An explicit default and different request must not bypass the unresolved intended outcome');
  const operations = (await f.store.records(f.workItemId))
    .filter(record => record.type === 'operation');
  assert.equal(operations.length, 1);
  assert.equal(operations[0].id, first.id);
  assert.equal(operations[0].status, 'uncertain');
  assert.equal(operations[0].resultProof, undefined);
});

test('T-124 exact operation replay remains idempotent and equivalent changed input remains an ID conflict', async t => {
  const { f, action, sourceRevision, prepare, uncertain } = await retryFixture(t);
  const first = (await prepare('exact-replay', action, undefined,
    { operationId: 'explicit-operation-id' })).operation;
  const recorded = await uncertain(first);
  const replay = await prepare('exact-replay', action, undefined,
    { operationId: first.id });
  assert.deepEqual(replay.operation, recorded);
  assert.equal(replay.action, 'resume-or-reconcile; never blindly redispatch');
  await assert.rejects(prepare('exact-replay', { ...action, sourceRevision },
    undefined, { operationId: first.id }), { code: 'ID_CONFLICT' });
  await assert.rejects(prepare('exact-replay', action, { changedRequest: true },
    { operationId: first.id }), { code: 'ID_CONFLICT' });
  assert.equal((await f.store.records(f.workItemId))
    .filter(record => record.type === 'operation').length, 1);
});

test('T-124 a request fingerprint still blocks a changed intended outcome while distinct requests and outcomes are permitted', async t => {
  const { f, action, prepare, uncertain } = await retryFixture(t);
  const first = (await prepare('first-policy')).operation;
  await uncertain(first);
  const nextAction = { ...action, policyVersion: 'policy-v3',
    configDigest: 'config-v2' };
  await assert.rejects(prepare('same-request-different-policy', nextAction),
    { code: 'UNCERTAIN' });
  const next = (await prepare('different-policy', nextAction, {
    target: nextAction.target, policyVersion: nextAction.policyVersion,
    configDigest: nextAction.configDigest,
  })).operation;
  assert.notEqual(next.requestFingerprint, first.requestFingerprint);
  assert.notEqual(next.intendedOutcome.digest, first.intendedOutcome.digest);
  assert.equal(next.intendedOutcome.requested.configDigest, 'config-v2');
  const completed = await policySuccess(f, next);
  assert.equal(completed.resultProof.dispatchId, next.id);
  assert.equal(completed.resultProof.intendedOutcomeDigest, next.intendedOutcome.digest);
  assert.equal(completed.resultProof.status, 'succeeded');
  const replay = await prepare('different-policy', nextAction, {
    target: nextAction.target, policyVersion: nextAction.policyVersion,
    configDigest: nextAction.configDigest,
  });
  assert.equal(replay.action, 'already-terminal');
  assert.deepEqual(replay.operation, completed);
  const original = (await f.store.records(f.workItemId))
    .find(record => record.id === first.id);
  assert.equal(original.status, 'uncertain');
  assert.equal(original.resultProof, undefined);
});

test('T-124 only a current scoped retry exception allows the same normalized outcome and never completes the earlier dispatch', async t => {
  const { f, action, sourceRevision, prepare, uncertain } = await retryFixture(t);
  const first = (await prepare('before-exception')).operation;
  await uncertain(first);
  const explicitAction = { ...action, sourceRevision };
  const retryArgs = { target: action.target, sourceRevision, attempt: 2 };
  for (const scope of [
    { target: 'different-policy' },
    { repositoryIds: ['different-repository'] },
    { actions: ['merge'] },
  ]) {
    await grant(f, 'override', {
      rules: ['uncertain-retry'], scope,
      reason: 'Isolated retry exception deliberately outside this action',
    });
    await assert.rejects(prepare('out-of-scope-exception',
      explicitAction, retryArgs), { code: 'UNCERTAIN' });
  }
  await grant(f, 'override', {
    rules: ['uncertain-retry'],
    scope: { target: action.target },
    lifetime: { kind: 'until',
      expiresAt: new Date(f.clock.now() + 1000).toISOString() },
    reason: 'Isolated expiring retry exception',
  });
  f.clock.advance(1000);
  await assert.rejects(prepare('expired-exception', explicitAction, retryArgs),
    { code: 'UNCERTAIN' });
  const revoked = await grant(f, 'override', {
    rules: ['uncertain-retry'], scope: { target: action.target },
    reason: 'Isolated retry exception subsequently revoked',
  });
  await grant(f, 'revocation', { revokes: [revoked.event.id] });
  await assert.rejects(prepare('revoked-exception', explicitAction, retryArgs),
    { code: 'UNCERTAIN' });
  const authorized = await grant(f, 'override', {
    rules: ['uncertain-retry'],
    scope: { repositoryIds: ['primary'], actions: [action.class],
      target: action.target },
    reason: 'Isolated user explicitly accepts a second dispatch of this policy',
  });
  const retry = (await prepare('authorized-retry', explicitAction, retryArgs))
    .operation;
  assert.equal(retry.intendedOutcome.digest, first.intendedOutcome.digest);
  assert.notEqual(retry.requestFingerprint, first.requestFingerprint);
  assert.notEqual(retry.effectFingerprint, first.effectFingerprint);
  assert.equal(retry.retryOverrideId, authorized.event.id);
  assert.equal(retry.priorUncertainOperationId, first.id);
  await assert.rejects(prepare('third-attempt', explicitAction,
    { ...retryArgs, attempt: 3 }), { code: 'UNCERTAIN' },
  'A persistent exception must not hide the already prepared replacement');
  const completed = await policySuccess(f, retry);
  assert.equal(completed.resultProof.dispatchId, retry.id);
  assert.equal(completed.resultProof.intendedOutcomeDigest, first.intendedOutcome.digest);
  assert.equal(completed.resultProof.status, 'succeeded');
  const original = (await f.store.records(f.workItemId))
    .find(record => record.id === first.id);
  assert.equal(original.status, 'uncertain');
  assert.equal(original.resultProof, undefined);
});

test('T-124 once-only retry authority is reserved and revocation before dispatch is enforced', async t => {
  const { f, action, sourceRevision, prepare, uncertain } = await retryFixture(t);
  const first = (await prepare('once-original')).operation;
  await uncertain(first);
  const authorized = await grant(f, 'override', {
    rules: ['uncertain-retry'], lifetime: { kind: 'once' },
    scope: { repositoryIds: ['primary'], actions: [action.class],
      target: action.target },
    reason: 'Isolated user permits exactly one replacement attempt',
  });
  const retry = (await prepare('once-retry', { ...action, sourceRevision },
    { attempt: 2, sourceRevision })).operation;
  const reservation = (await f.store.records(f.workItemId)).find(record =>
    record.type === 'reservation' && record.eventId === authorized.event.id);
  assert.equal(reservation.operationId, retry.id);
  await assert.rejects(prepare('once-extra-retry', action, { attempt: 3 }),
    { code: 'UNCERTAIN' });
  await grant(f, 'revocation', { revokes: [authorized.event.id] });
  await assert.rejects(markDispatching(f.store, f.workItemId, retry.id),
    { code: 'AUTHORITY' });
  const records = await f.store.records(f.workItemId);
  assert.equal(records.find(record => record.id === retry.id).status, 'prepared');
  assert.equal(records.find(record => record.id === first.id).status, 'uncertain');
});

test('T-124 concurrent omitted and explicit defaults admit one causal effect and reject preparation after contention', async t => {
  const { f, action, sourceRevision, prepare } = await retryFixture(t);
  const attempts = [
    () => prepare('concurrent-omitted', action, { policyVersion: action.policyVersion }),
    () => prepare('concurrent-explicit', { ...action, sourceRevision },
      { policyVersion: action.policyVersion, sourceRevision }),
  ];
  const results = await Promise.allSettled(attempts.map(attempt => attempt()));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejectedIndex = results.findIndex(result => result.status === 'rejected');
  assert.ok(['LOCK_BUSY', 'UNCERTAIN'].includes(results[rejectedIndex].reason.code));
  await assert.rejects(attempts[rejectedIndex](), { code: 'UNCERTAIN' },
    'After the work-item lock is released, the losing preparation still cannot create a duplicate');
  const operations = (await f.store.records(f.workItemId))
    .filter(record => record.type === 'operation');
  assert.equal(operations.length, 1);
  assert.equal(operations[0].intendedOutcome.requested.sourceRevision, sourceRevision);
  assert.equal(operations[0].status, 'prepared');
});

test('T-124 cycle candidate and test specification defaults match explicit values without inventing configuration defaults', async t => {
  const { f, action, sourceRevision, repository, cycle, prepare, uncertain } =
    await retryFixture(t, { withCycle: true });
  const first = (await prepare('cycle-defaults')).operation;
  await uncertain(first);
  assert.equal(first.intendedOutcome.requested.candidateDigest, cycle.candidateDigest);
  assert.equal(first.intendedOutcome.requested.testSpecDigest, cycle.testSpecDigest);
  assert.equal(first.intendedOutcome.requested.configDigest, undefined);
  await assert.rejects(prepare('explicit-cycle-defaults', {
    ...action, sourceRevision, localRepositoryPath: f.repo,
    remoteRepositoryURL: repository.remoteRepositoryURL,
    candidateDigest: cycle.candidateDigest, testSpecDigest: cycle.testSpecDigest,
  }, { sourceRevision, candidateDigest: cycle.candidateDigest,
    testSpecDigest: cycle.testSpecDigest }), { code: 'UNCERTAIN' });
  const configured = (await prepare('explicit-configuration', {
    ...action, configDigest: cycle.configDigest,
  }, { configDigest: cycle.configDigest })).operation;
  assert.notEqual(configured.intendedOutcome.digest, first.intendedOutcome.digest);
  assert.equal(configured.intendedOutcome.requested.configDigest, cycle.configDigest);
});

test('T-124 remote configuration is required rather than defaulted and stale explicit source cannot gain credit', async t => {
  const { f, sourceRevision, cycle, prepare, uncertain } =
    await retryFixture(t, { withCycle: true });
  const action = {
    class: 'build', repositoryId: 'primary', environment: 'DEV',
    target: 'dev-resource', configDigest: cycle.configDigest,
    provider: 'fixture', pipeline: 'fixture-build', monitorCapability: true,
  };
  await grant(f, 'override', {
    rules: ['local-validation', 'candidate-review', 'review-completion',
      'dev-authorization'],
    scope: { repositoryIds: ['primary'], actions: ['build'], target: action.target },
    reason: 'Isolated configuration boundary waives unrelated delivery gates without inventing passed tests',
  });
  const first = (await prepare('configured-build', action, { attempt: 1 })).operation;
  await uncertain(first);
  const { configDigest: omittedConfiguration, ...unconfigured } = action;
  assert.equal(omittedConfiguration, cycle.configDigest);
  await assert.rejects(prepare('unconfigured-build', unconfigured, { attempt: 2 }),
    error => error.code === 'GATE' &&
      error.details.some(finding => finding.rule === 'configured-target' &&
        finding.verdict === 'violation'));
  const staleRevision = (sourceRevision[0] === 'a' ? 'b' : 'a').repeat(40);
  await assert.rejects(prepare('stale-build', {
    ...action, sourceRevision: staleRevision,
  }, { attempt: 3, sourceRevision: staleRevision }), { code: 'STALE' });
  const operations = (await f.store.records(f.workItemId))
    .filter(record => record.type === 'operation');
  assert.equal(operations.length, 1);
  assert.equal(operations[0].intendedOutcome.requested.configDigest, cycle.configDigest);
  assert.equal(operations[0].resultProof, undefined);
});

test('T-124 public external action families reject omitted versus explicit supported defaults', { concurrency: 3 }, async t => {
  await Promise.all([
    'configuration', 'build', 'pipeline', 'pr-validation', 'test', 'deploy',
    'pr-create', 'pr-update', 'merge', 'auto-merge', 'policy-bypass', 'push',
  ].map(kind => t.test(`T-124 ${kind} normalized retry`, async child => {
    const { f, action: policy, sourceRevision, repository, cycle,
      prepare, uncertain } = await retryFixture(child, { withCycle: true });
    const hosted = {
      localRepositoryPath: f.repo,
      remoteRepositoryURL: repository.remoteRepositoryURL,
    };
    const execution = {
      implicitEnvironments: ['DEV'], target: 'dev-resource',
      configDigest: cycle.configDigest,
      provider: 'fixture', pipeline: 'fixture-build', monitorCapability: true,
    };
    const pullRequest = {
      ...hosted, target: 'origin',
      sourceRepositoryURL: repository.remoteRepositoryURL,
      sourceRef: 'refs/heads/feature/fixture', targetRef: 'refs/heads/main',
      targetRevision: sourceRevision, draft: true,
    };
    const actions = {
      configuration: policy,
      build: execution,
      pipeline: execution,
      'pr-validation': execution,
      test: { ...execution, testId: 'T-dev', owner: 'agent',
        host: 'development-machine', artifactId: 'isolated-artifact',
        deploymentId: 'isolated-deployment' },
      deploy: { ...execution, artifactId: 'isolated-artifact',
        artifactRef: 'isolated-immutable-artifact', artifactSha256: 'a'.repeat(64) },
      'pr-create': pullRequest,
      'pr-update': { ...pullRequest, prId: 'fixture-pr-42' },
      merge: { target: 'origin', prId: 'fixture-pr-42',
        targetRevision: sourceRevision },
      'auto-merge': { ...policy, prId: 'fixture-pr-42' },
      'policy-bypass': policy,
      push: { target: 'origin', targetRef: 'refs/heads/retired-fixture',
        remoteUrlDigest: digest([repository.remoteRepositoryURL]),
        force: false, delete: true },
    };
    const action = { ...actions[kind], class: kind, repositoryId: 'primary' };
    await grant(f, 'override', {
      rules: [
        'local-validation', 'candidate-review', 'review-completion',
        'dev-authorization', 'artifact-provenance', 'deployment-before-test',
        'unit-first', 'push', 'remote-ref-delete', 'pr-publication',
        'merge', 'auto-merge', 'policy-bypass',
      ],
      scope: { repositoryIds: ['primary'], actions: [kind], target: action.target },
      reason: 'Isolated identity test waives unrelated delivery gates; tests remain NotRun and no provider is called',
    });
    const first = (await prepare(`${kind}-omitted`, action,
      { action: kind, attempt: 1 })).operation;
    assert.equal(first.action.sourceRevision, undefined);
    assert.equal(first.intendedOutcome.requested.sourceRevision, sourceRevision);
    assert.equal(first.intendedOutcome.requested.candidateDigest, cycle.candidateDigest);
    await uncertain(first);
    await assert.rejects(prepare(`${kind}-explicit`, {
      ...action, ...hosted, sourceRevision,
      ...(first.action.environment ? { environment: first.action.environment } : {}),
      candidateDigest: cycle.candidateDigest, testSpecDigest: cycle.testSpecDigest,
    }, { action: kind, attempt: 2, sourceRevision,
      ...(action.configDigest ? { configDigest: action.configDigest } : {}) }),
    { code: 'UNCERTAIN' });
    const operations = (await f.store.records(f.workItemId))
      .filter(record => record.type === 'operation');
    assert.equal(operations.length, 1);
    assert.equal(operations[0].resultProof, undefined);
    assert.equal(operations[0].status, 'uncertain');
  })));
});
