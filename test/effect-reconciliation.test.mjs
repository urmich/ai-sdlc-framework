import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveIntendedOutcome, validateOperationResult } from '../src/external-results.mjs';
import { recordOperation } from '../src/operations.mjs';

const remote = 'https://example.invalid/org/repository';
const base = { repositoryId: 'member', remoteRepositoryURL: remote,
  sourceRevision: 'a'.repeat(40), configDigest: 'config-1' };
const run = { executionRef: 'run-42', attemptCapability: 'distinct',
  attemptRef: '2', sourceRevision: base.sourceRevision,
  configDigest: base.configDigest };
const executionContext = {
  provider: 'provider', connection: 'fixture-ci', scopeRef: 'project:fixture',
  attemptCapability: 'distinct',
};
const executionIdentity = {
  provider: 'provider', connection: 'fixture-ci', scopeRef: 'project:fixture',
  executionRef: 'run-42', attemptKind: 'known', attemptRef: '2',
};
const definitions = { build: 'build', pipeline: 'pipeline',
  'pr-validation': 'pr-validation' };

function fixture(action, result, { status = 'succeeded', dispatchId = 'dispatch-1',
  proofKind = 'provider-request' } = {}) {
  const intended = deriveIntendedOutcome(action);
  const dispatch = { id: dispatchId, status: 'dispatching',
    hostCallId: `host-${dispatchId}`, hostCallSupported: true,
    providerRequestId: `request-${dispatchId}`,
    providerIdempotencyToken: `token-${dispatchId}`,
    providerRequestSupported: true };
  const providerResultId = action.class === 'push' ?
    `${result.destination}:${result.ref}` :
    action.class === 'notification' ? result.deliveryReceipt :
    action.class === 'artifact' ? result.artifactRef :
    action.class === 'deploy' ? result.deploymentRef :
    action.class === 'pr-create' || action.class === 'pr-update' ? result.prId :
    action.class === 'merge' ? `${result.prId}:${result.mergeRevision}` :
    ['configuration', 'auto-merge'].includes(action.class) ?
      `${result.target}:${result.policyVersion}` :
    `${result.executionRef}:${result.attemptRef}`;
  const causalProof = { kind: proofKind, dispatchId,
    resultId: providerResultId, supported: true,
    ...(proofKind === 'host-call' ? { hostCallId: dispatch.hostCallId } :
      proofKind === 'provider-idempotency' ?
        { providerIdempotencyToken: dispatch.providerIdempotencyToken,
          accepted: true } :
        { providerRequestId: dispatch.providerRequestId, accepted: true }) };
  const observed = { status, family: intended.family,
    target: intended.target, intendedOutcomeDigest: intended.digest,
    providerStatus: status, providerVerified: true,
    providerResultId, causalProof, result: {
      ...result, remoteRepositoryURL: action.remoteRepositoryURL,
      ...(!['local-build'].includes(action.class) &&
        (action.class !== 'test' || action.environment !== 'local') &&
        ['build', 'pipeline', 'pr-validation', 'test'].includes(action.class) ?
        { environment: action.environment, target: action.target } : {}) },
    evidence: { ref: 'fixture:evidence', verified: true,
      sha256: 'b'.repeat(64) } };
  const hosted = ['build', 'pipeline', 'pr-validation'].includes(action.class) ||
    action.class === 'test' && action.environment !== 'local';
  return { intended, dispatch, observed,
    ...(hosted ? { executionContext: {
      ...executionContext,
      ...(definitions[action.class] ? { definitionRef: definitions[action.class] } : {}),
    } } : {}) };
}

const examples = [
  ['local build', { ...base, class: 'local-build' },
    { ...run, local: true }],
  ['remote build', { ...base, class: 'build', environment: 'DEV',
    target: 'dev', provider: 'provider', pipeline: 'build' },
  { ...run, provider: 'provider', pipeline: 'build',
    executionIdentity: { ...executionIdentity, definitionRef: 'build' } }],
  ['pipeline', { ...base, class: 'pipeline', environment: 'DEV',
    target: 'dev', provider: 'provider', pipeline: 'pipeline' },
  { ...run, provider: 'provider', pipeline: 'pipeline',
    executionIdentity: { ...executionIdentity, definitionRef: 'pipeline' } }],
  ['local test', { ...base, class: 'test', environment: 'local',
    testId: 'T-1' }, { ...run, testId: 'T-1', expectedMet: true }],
  ['remote test', { ...base, class: 'test', environment: 'STAGING',
    target: 'staging', testId: 'T-2', artifactId: 'current-artifact',
    deploymentId: 'current-deployment' },
  { ...run, executionIdentity, testId: 'T-2', expectedMet: true,
    artifactId: 'current-artifact', deploymentId: 'current-deployment' }],
  ['artifact', { ...base, class: 'artifact', artifactId: 'local-artifact',
    artifactName: 'archive' },
  { artifactRef: 'hosted-artifact-1', artifactId: 'local-artifact',
      artifactName: 'archive', executionRef: 'run-42',
      attemptCapability: 'distinct', attemptRef: '2', sha256: 'a'.repeat(64),
      sourceRevision: base.sourceRevision, configDigest: base.configDigest }],
  ['deployment', { ...base, class: 'deploy', artifactId: 'local-artifact',
    artifactRef: 'hosted-artifact-1', artifactSha256: 'a'.repeat(64),
    environment: 'DEV', target: 'dev' },
  { deploymentRef: 'deploy-42', artifactId: 'local-artifact',
    artifactRef: 'hosted-artifact-1', artifactSha256: 'a'.repeat(64),
    environment: 'DEV', target: 'dev', sourceRevision: base.sourceRevision,
    configDigest: base.configDigest }],
  ['PR create', { ...base, class: 'pr-create',
    sourceRepositoryURL: remote,
    sourceRef: 'refs/heads/feature', targetRef: 'refs/heads/main',
    targetRevision: 'b'.repeat(40), draft: true },
  { prId: '123', sourceRepositoryURL: remote, targetRepositoryURL: remote,
    sourceRef: 'refs/heads/feature', targetRef: 'refs/heads/main',
    sourceRevision: base.sourceRevision, targetRevision: 'b'.repeat(40),
    draft: true }],
  ['PR update', { ...base, class: 'pr-update', prId: '123',
    sourceRepositoryURL: remote,
    sourceRef: 'refs/heads/feature', targetRef: 'refs/heads/main',
    targetRevision: 'b'.repeat(40), draft: false },
  { prId: '123', sourceRepositoryURL: remote, targetRepositoryURL: remote,
    sourceRef: 'refs/heads/feature', targetRef: 'refs/heads/main',
    sourceRevision: base.sourceRevision, targetRevision: 'b'.repeat(40),
    draft: false }],
  ['Git publication', { ...base, class: 'push', target: 'hosted',
    targetRef: 'refs/heads/feature' },
  { destination: 'hosted', ref: 'refs/heads/feature',
    revision: base.sourceRevision, published: true }],
  ['Git deletion', { ...base, class: 'push', target: 'hosted',
    targetRef: 'refs/heads/feature', delete: true },
  { destination: 'hosted', ref: 'refs/heads/feature',
    deleted: true, deletionConfirmed: true }],
  ['merge', { ...base, class: 'merge', prId: '123',
    targetRevision: 'b'.repeat(40) },
    { prId: '123', mergeRevision: 'c'.repeat(40), merged: true,
      sourceRevision: base.sourceRevision, targetRevision: 'b'.repeat(40) }],
  ['configuration', { ...base, class: 'configuration',
    target: 'branch-protection', policyVersion: 'version-2' },
  { target: 'branch-protection', policyVersion: 'version-2',
    changeApplied: true }],
  ['auto-merge', { ...base, class: 'auto-merge', prId: '123',
    target: 'branch-protection', policyVersion: 'version-2' },
  { target: 'branch-protection', policyVersion: 'version-2',
    changeApplied: true, prId: '123', autoMergeEnabled: true }],
  ['notification', { ...base, class: 'notification',
    recipient: 'person', contentDigest: 'content-hash' },
  { deliveryReceipt: 'receipt-42', recipient: 'person',
    contentDigest: 'content-hash', delivered: true }],
];

test('T-107 each action family requires a terminal causally linked exact result', () => {
  for (const [name, action, result] of examples) {
    const { intended, dispatch, observed } = fixture(action, result);
    assert.equal(validateOperationResult(intended, dispatch, observed).status,
      'succeeded', name);
    for (const mutation of [
      { ...observed, family: 'different-family' },
      { ...observed, target: { ...observed.target, repositoryId: 'other' } },
      { ...observed, intendedOutcomeDigest: 'old-outcome' },
      { ...observed, providerResultId: 'other-result' },
      { ...observed, causalProof: null },
      ...(action.class === 'local-build' ||
        action.class === 'test' && action.environment === 'local' ?
        [] : [{ ...observed, result: { ...observed.result,
          remoteRepositoryURL: 'https://wrong.invalid/repository' } }]),
      { ...observed, status: 'submitted', providerStatus: 'submitted' },
      { ...observed, result: { ...result, ...(
        action.class === 'push' ? { ref: 'refs/heads/wrong' } :
          action.class === 'notification' ? { recipient: 'wrong' } :
          action.class === 'artifact' ? { artifactId: 'wrong' } :
          action.class === 'deploy' ? { environment: 'STAGING' } :
          action.class.startsWith('pr-') ? { targetRevision: 'wrong' } :
          action.class === 'merge' ? { merged: false } :
          ['configuration', 'auto-merge'].includes(action.class) ?
            { policyVersion: 'old' } :
          { sourceRevision: 'wrong' }) } },
      ...(['build', 'pipeline', 'test'].includes(action.class) &&
        action.environment !== 'local' ?
        [{ ...observed, result: { ...observed.result,
          environment: 'wrong' } }] : []),
    ]) assert.equal(validateOperationResult(intended, dispatch, mutation).status,
      'uncertain', `${name}: wrong or partial result`);
  }
});

test('T-107 pre-dispatch intent is immutable and cannot learn an observed result ID', () => {
  const action = { ...examples[1][1] };
  const intended = deriveIntendedOutcome(action);
  const originalDigest = intended.digest;
  action.sourceRevision = 'b'.repeat(40);
  assert.equal(intended.requested.sourceRevision, 'a'.repeat(40));
  assert.equal(intended.digest, originalDigest);
  assert.throws(() => { intended.target.target = 'elsewhere'; }, TypeError);
  assert.notEqual(deriveIntendedOutcome(action).digest, originalDigest);
  assert.throws(() => deriveIntendedOutcome({ ...action, executionRef: 'returned-later' }),
    /pre-dispatch/);
  assert.throws(() => deriveIntendedOutcome({
    ...examples[7][1], prId: 'guessed-new-PR' }), /post-dispatch/);
});

test('T-107 matching state without current causal ID never completes a new attempt', () => {
  const { intended, dispatch, observed } = fixture(examples[1][1],
    examples[1][2]);
  assert.equal(validateOperationResult(intended, dispatch,
    { ...observed, causalProof: null }).reason,
  'missing-dispatch-to-result-proof');
  const second = { ...dispatch, id: 'dispatch-2', providerRequestId: 'request-2' };
  assert.equal(validateOperationResult(intended, second, observed).status,
    'uncertain');
  const prior = validateOperationResult(intended, dispatch, observed);
  const forged = { ...observed, causalProof: { ...observed.causalProof,
    dispatchId: 'dispatch-2', providerRequestId: 'request-2' } };
  assert.equal(validateOperationResult(intended, second, forged,
    { priorResults: [prior] }).reason, 'result-or-request-belongs-to-another-dispatch');
  assert.equal(validateOperationResult(intended, dispatch, observed,
    { previousTerminal: prior }), prior);
  assert.throws(() => validateOperationResult(intended, dispatch,
    { ...observed, evidence: { ref: 'fixture:different', verified: true,
      sha256: 'b'.repeat(64) } },
    { previousTerminal: prior }), error => error.code === 'ID_CONFLICT');
});

test('T-107 host calls and provider tokens are supported only with exact dispatch binding', () => {
  for (const proofKind of ['host-call', 'provider-idempotency']) {
    const { intended, dispatch, observed } = fixture(examples[1][1],
      examples[1][2], { proofKind });
    assert.equal(validateOperationResult(intended, dispatch, observed).status,
      'succeeded');
    assert.equal(validateOperationResult(intended, dispatch,
      { ...observed, causalProof: { ...observed.causalProof,
        supported: false } }).status, 'uncertain');
    assert.equal(validateOperationResult(intended, { ...dispatch,
      hostCallSupported: false, providerRequestSupported: false },
    observed).status, 'uncertain');
  }
});

test('T-107 concurrent attempts cannot claim the same provider request proof', () => {
  const { intended, dispatch, observed } = fixture(examples[1][1],
    examples[1][2]);
  const first = validateOperationResult(intended, dispatch, observed);
  const secondDispatch = { ...dispatch, id: 'dispatch-2' };
  const secondResult = { ...observed,
    causalProof: { ...observed.causalProof, dispatchId: 'dispatch-2' },
    providerResultId: 'new-run:3',
    result: { ...observed.result, executionRef: 'new-run', attemptRef: '3',
      executionIdentity: { ...observed.result.executionIdentity,
        executionRef: 'new-run', attemptRef: '3' } } };
  secondResult.causalProof.resultId = 'new-run:3';
  assert.equal(validateOperationResult(intended, secondDispatch, secondResult,
    { priorResults: [first] }).reason,
  'result-or-request-belongs-to-another-dispatch');
  assert.equal(first.causalKey.includes(dispatch.providerRequestId), false);
  assert.equal(validateOperationResult(intended, dispatch, observed,
    { priorResults: [first] }).status, 'succeeded');
});

test('T-107 a fresh request may update an existing PR, but cannot reuse its old request', () => {
  const { intended, dispatch, observed } = fixture(examples[8][1],
    examples[8][2]);
  const first = validateOperationResult(intended, dispatch, observed);
  const later = fixture(examples[8][1], examples[8][2],
    { dispatchId: 'dispatch-2' });
  assert.equal(validateOperationResult(intended, later.dispatch, later.observed,
    { priorResults: [first] }).status, 'succeeded');
  assert.equal(validateOperationResult(intended, { ...later.dispatch,
    providerRequestId: dispatch.providerRequestId },
    { ...later.observed, causalProof: { ...later.observed.causalProof,
      providerRequestId: dispatch.providerRequestId } },
    { priorResults: [first] }).status, 'uncertain');
});

test('T-107 an environment test rejects an old deployment or artifact despite current dispatch proof', () => {
  for (const environment of ['DEV', 'STAGING']) {
    const action = { ...examples[4][1], environment };
    const { intended, dispatch, observed } = fixture(action, examples[4][2]);
    assert.equal(validateOperationResult(intended, dispatch, observed).status,
      'succeeded');
    for (const [field, value] of [
      ['deploymentId', 'previous-deployment'],
      ['artifactId', 'previous-artifact'],
      ['deploymentId', null],
      ['artifactId', null],
    ]) {
      const result = { ...observed.result };
      if (value === null) delete result[field];
      else result[field] = value;
      assert.equal(validateOperationResult(intended, dispatch,
        { ...observed, result }).reason, 'wrong-or-incomplete-result',
      `${environment}: ${field}`);
    }
    for (const field of ['artifactId', 'deploymentId']) {
      const incompleteAction = { ...action };
      delete incompleteAction[field];
      assert.throws(() => deriveIntendedOutcome(incompleteAction),
        { code: 'INPUT' }, `${environment}: missing ${field} at preparation`);
    }
  }
  const local = fixture(examples[3][1], examples[3][2]);
  assert.equal(validateOperationResult(local.intended, local.dispatch,
    local.observed).status, 'succeeded');
});

test('T-107 independently proven repeat publication of a resource survives archived prior proof', () => {
  for (const index of [8, 9, 10, 12]) {
    const [name, action, result] = examples[index];
    const first = fixture(action, result);
    const prior = validateOperationResult(first.intended, first.dispatch,
      first.observed);
    const next = fixture(action, result, { dispatchId: 'dispatch-2' });
    assert.equal(validateOperationResult(next.intended, next.dispatch,
      next.observed, { priorResults: [{ ...prior, archived: true }] }).status,
    'succeeded', name);
    assert.equal(validateOperationResult(next.intended, {
      ...next.dispatch, providerRequestId: first.dispatch.providerRequestId,
    }, { ...next.observed, causalProof: { ...next.observed.causalProof,
      providerRequestId: first.dispatch.providerRequestId } },
    { priorResults: [prior] }).reason,
    'result-or-request-belongs-to-another-dispatch', `${name}: reused request`);
  }
  const runFirst = fixture(examples[1][1], examples[1][2]);
  const priorRun = validateOperationResult(runFirst.intended, runFirst.dispatch,
    runFirst.observed);
  const runNext = fixture(examples[1][1], examples[1][2],
    { dispatchId: 'dispatch-2' });
  assert.equal(validateOperationResult(runNext.intended, runNext.dispatch,
    runNext.observed, { priorResults: [{ ...priorRun, archived: true }] }).reason,
  'result-or-request-belongs-to-another-dispatch');
});

test('T-107 host-call and idempotency proof keys cannot be shared by separate publications', () => {
  for (const [proofKind, field] of [
    ['host-call', 'hostCallId'],
    ['provider-idempotency', 'providerIdempotencyToken'],
  ]) {
    const action = examples[9][1];
    const result = examples[9][2];
    const first = fixture(action, result, { proofKind });
    const previous = validateOperationResult(first.intended, first.dispatch,
      first.observed);
    const second = fixture(action, result, {
      proofKind, dispatchId: 'dispatch-2',
    });
    assert.equal(validateOperationResult(second.intended, second.dispatch,
      second.observed, { priorResults: [previous] }).status, 'succeeded');
    assert.equal(validateOperationResult(second.intended, {
      ...second.dispatch, [field]: first.dispatch[field],
    }, { ...second.observed, causalProof: {
      ...second.observed.causalProof, [field]: first.dispatch[field],
    } }, { priorResults: [previous] }).reason,
    'result-or-request-belongs-to-another-dispatch', proofKind);
  }
});

test('T-107 incomplete run attempts, artifacts and forked PRs stay uncertain', () => {
  const build = fixture(examples[1][1], examples[1][2]);
  for (const result of [
    { ...build.observed.result, attemptCapability: 'distinct',
      attemptRef: 'unknown' },
    { ...build.observed.result, attemptCapability: 'none', attemptRef: '1' },
    { ...build.observed.result, sourceRevision: 7 },
  ]) assert.equal(validateOperationResult(build.intended, build.dispatch,
    { ...build.observed, result }).status, 'uncertain');

  const artifact = fixture(examples[5][1], examples[5][2]);
  assert.equal(validateOperationResult(artifact.intended, artifact.dispatch,
    { ...artifact.observed, result: { ...artifact.observed.result,
      sha256: 'not-a-digest' } }).status, 'uncertain');
  assert.equal(validateOperationResult(artifact.intended, artifact.dispatch,
    { ...artifact.observed, evidence: { ref: 'fixture:mutable',
      verified: true } }).reason, 'missing-verified-evidence');

  const fork = 'https://fork.invalid/contributor/repository';
  const action = { ...examples[7][1], sourceRepositoryURL: fork };
  const pr = fixture(action, { ...examples[7][2], sourceRepositoryURL: fork });
  assert.equal(validateOperationResult(pr.intended, pr.dispatch,
    pr.observed).status, 'succeeded');
  assert.equal(validateOperationResult(pr.intended, pr.dispatch,
    { ...pr.observed, result: { ...pr.observed.result,
      sourceRepositoryURL: remote } }).status, 'uncertain');
});

test('T-107 no dispatch, failures and cancellations need affirmative exact proof', () => {
  const { intended, dispatch, observed } = fixture(examples[1][1],
    examples[1][2]);
  const nonDispatch = { status: 'not-started', family: intended.family,
    target: intended.target, intendedOutcomeDigest: intended.digest,
    evidence: { ref: 'fixture:host-non-dispatch', verified: true,
      sha256: 'b'.repeat(64) },
    nonDispatchProof: { kind: 'host-non-dispatch',
      hostSupported: true, dispatchId: dispatch.id, dispatchAttempted: false } };
  assert.equal(validateOperationResult(intended, dispatch, nonDispatch).status,
    'uncertain');
  assert.equal(validateOperationResult(intended, { ...dispatch,
    status: 'prepared' }, nonDispatch).status, 'not-started');
  assert.equal(validateOperationResult(intended, { ...dispatch,
    status: 'prepared' }, { ...nonDispatch, nonDispatchProof: null }).status,
  'uncertain');
  assert.equal(validateOperationResult(intended, { ...dispatch,
    status: 'prepared' }, { ...nonDispatch, result: observed.result }).status,
  'uncertain');
  for (const status of ['failed', 'cancelled']) {
    const terminal = { ...observed, status, providerStatus: status };
    assert.equal(validateOperationResult(intended, dispatch, terminal).status,
      'uncertain', `${status} without verified failure classification`);
    assert.equal(validateOperationResult(intended, dispatch, { ...terminal,
      result: { ...terminal.result, terminalStatus: status },
      failure: { terminal: true, providerVerified: true } }).status,
    status);
  }
  assert.equal(validateOperationResult(intended, dispatch,
    { ...observed, providerStatus: 'failed' }).status, 'uncertain');
});

test('T-107 provider-confirmed no-effect failures do not require a fabricated resource', () => {
  const { intended, dispatch, observed } = fixture(examples[7][1],
    examples[7][2]);
  const failed = { ...observed, status: 'failed',
    providerStatus: 'failed', providerResultId: 'provider-error-1',
    result: { remoteRepositoryURL: remote,
      failureRef: 'provider-error-1' },
    causalProof: { ...observed.causalProof,
      resultId: 'provider-error-1' },
    failure: { terminal: true, providerVerified: true, noEffect: true } };
  assert.equal(validateOperationResult(intended, dispatch, failed).status,
    'failed');
  assert.equal(validateOperationResult(intended, dispatch,
    { ...failed, failure: { ...failed.failure, noEffect: false } }).status,
  'uncertain');
  assert.equal(validateOperationResult(intended, dispatch,
    { ...failed, result: { ...failed.result, prId: 'created-despite-failure' } })
    .status, 'uncertain');
});

test('T-107 operation recording only credits an adapter-verified current dispatch', async () => {
  const { intended, dispatch, observed, executionContext } = fixture(examples[1][1],
    examples[1][2], { dispatchId: 'operation-1' });
  const records = new Map();
  records.set(dispatch.id, { id: dispatch.id, type: 'operation',
    workItemId: 'work-1', status: 'dispatching', class: 'build',
    action: examples[1][1], target: 'dev',
    requestFingerprint: 'request-1', cycleId: null, intendedOutcome: intended });
  const store = {
    clock: { now: () => Date.parse('2026-09-08T00:00:00Z') },
    archivedOperationProofs: async () => [],
    async transaction(workItemId, callback) {
      assert.equal(workItemId, 'work-1');
      return callback({
        get: key => records.get(key),
        all: () => [...records.values()],
        put: record => records.set(record.id, record),
        checkpoint: {},
      });
    },
    async verifyOperationResult({ operation, observedResult }) {
      assert.equal(operation.id, dispatch.id);
      return { dispatch, observation: observedResult, executionContext };
    },
  };
  const input = { workItemId: 'work-1', operationId: dispatch.id,
    status: 'succeeded' };
  const noObservation = await recordOperation(store, input);
  assert.equal(noObservation.status, 'uncertain');
  assert.equal(noObservation.resultGap, 'current-result-observation-required');
  const unlinked = await recordOperation(store, { ...input,
    observedResult: { ...observed, causalProof: null } }, { reconcile: true });
  assert.equal(unlinked.status, 'uncertain');
  assert.equal(unlinked.resultGap, 'missing-dispatch-to-result-proof');
  const trustedVerifier = store.verifyOperationResult;
  delete store.verifyOperationResult;
  assert.equal((await recordOperation(store, { ...input,
    observedResult: observed }, { reconcile: true })).resultGap,
  'hosting-service-result-adapter-unavailable');
  store.verifyOperationResult = trustedVerifier;
  const completed = await recordOperation(store, {
    ...input, observedResult: observed,
  }, { reconcile: true });
  assert.equal(completed.status, 'succeeded');
  assert.equal(completed.resultProof.resultDigest,
    validateOperationResult(intended, dispatch, observed).resultDigest);
  assert.equal(completed.evidenceRef, 'fixture:evidence');
  assert.equal(completed.handle, 'run-42:2');
  assert.equal(await recordOperation(store, {
    ...input, observedResult: structuredClone(observed),
  }), completed);
  await assert.rejects(recordOperation(store, {
    ...input, observedResult: { ...observed,
      evidence: { ...observed.evidence, ref: 'fixture:changed' } },
  }), { code: 'ID_CONFLICT' });
});

test('T-107 recordOperation cannot project an environment test for an old deployment', async () => {
  const action = examples[4][1];
  const { intended, dispatch, observed, executionContext } = fixture(action, examples[4][2],
    { dispatchId: 'test-operation-1' });
  const records = new Map([[dispatch.id, {
    id: dispatch.id, type: 'operation', workItemId: 'work-1',
    status: 'dispatching', class: 'test', action,
    target: action.target, requestFingerprint: 'test-request',
    cycleId: null, intendedOutcome: intended,
  }]]);
  const store = {
    clock: { now: () => Date.parse('2026-09-08T00:00:00Z') },
    archivedOperationProofs: async () => [],
    async transaction(workItemId, callback) {
      assert.equal(workItemId, 'work-1');
      return callback({
        get: key => records.get(key),
        all: () => [...records.values()],
        put: record => records.set(record.id, record),
        checkpoint: {},
      });
    },
    async verifyOperationResult({ operation, observedResult }) {
      assert.equal(operation.id, dispatch.id);
      return { dispatch, observation: observedResult, executionContext };
    },
  };
  const recorded = await recordOperation(store, {
    workItemId: 'work-1', operationId: dispatch.id, status: 'succeeded',
    observedResult: { ...observed, result: { ...observed.result,
      deploymentId: 'previous-deployment' } },
  }, { reconcile: true });
  assert.equal(recorded.status, 'uncertain');
  assert.equal(recorded.resultGap, 'wrong-or-incomplete-result');
  assert.equal(recorded.resultProof, undefined);
});

test('T-107 recordOperation credits a fresh publication of an archived resource, not a reused request', async () => {
  const action = examples[9][1];
  const first = fixture(action, examples[9][2], { dispatchId: 'publication-1' });
  const second = fixture(action, examples[9][2], { dispatchId: 'publication-2' });
  const firstProof = validateOperationResult(first.intended, first.dispatch,
    first.observed);
  const records = new Map([
    [first.dispatch.id, {
      id: first.dispatch.id, type: 'operation', workItemId: 'work-1',
      status: 'succeeded', class: 'push', action,
      resultProof: { ...firstProof, archived: true },
    }],
    [second.dispatch.id, {
      id: second.dispatch.id, type: 'operation', workItemId: 'work-1',
      status: 'dispatching', class: 'push', action,
      target: action.target, requestFingerprint: 'publication-request',
      cycleId: null, intendedOutcome: second.intended,
    }],
  ]);
  const store = {
    clock: { now: () => Date.parse('2026-09-08T00:00:00Z') },
    archivedOperationProofs: async () => [firstProof],
    async transaction(workItemId, callback) {
      assert.equal(workItemId, 'work-1');
      return callback({
        get: key => records.get(key),
        all: () => [...records.values()],
        put: record => records.set(record.id, record),
        checkpoint: {},
      });
    },
    async verifyOperationResult({ operation, observedResult }) {
      assert.equal(operation.id, second.dispatch.id);
      return { dispatch: { ...second.dispatch,
        providerRequestId: observedResult.causalProof.providerRequestId },
      observation: observedResult };
    },
  };
  const input = { workItemId: 'work-1', operationId: second.dispatch.id,
    status: 'succeeded' };
  const reusedRequest = await recordOperation(store, {
    ...input, observedResult: {
      ...second.observed, causalProof: {
        ...second.observed.causalProof,
        providerRequestId: first.dispatch.providerRequestId,
      },
    },
  }, { reconcile: true });
  assert.equal(reusedRequest.status, 'uncertain');
  assert.equal(reusedRequest.resultGap,
    'result-or-request-belongs-to-another-dispatch');
  const completed = await recordOperation(store, {
    ...input, observedResult: second.observed,
  }, { reconcile: true });
  assert.equal(completed.status, 'succeeded');
  assert.equal(completed.resultProof.providerResultId,
    firstProof.providerResultId);
  assert.notEqual(completed.resultProof.causalKey, firstProof.causalKey);
});
