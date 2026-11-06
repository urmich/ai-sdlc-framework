import { digest, object, requireThat, text } from './core.mjs';
import { runCoverageCommand } from './coverage-cli.mjs';
import { readCoverageSection } from './coverage.mjs';
import { validateBinding } from './git.mjs';

export const PR_DESCRIPTION_FIELDS = Object.freeze([
  'descriptionDigest', 'coverageDigest', 'previousDescriptionDigest', 'descriptionVersion',
]);

export function prDescriptionWriteConflicts(proposed, previous) {
  if (proposed.id === previous.id ||
      !['pr-create', 'pr-update'].includes(proposed.class) ||
      !['pr-create', 'pr-update'].includes(previous.class) ||
      !['dispatching', 'submitted', 'running', 'uncertain'].includes(previous.status) ||
      proposed.action?.descriptionDigest === undefined &&
        previous.action?.descriptionDigest === undefined) return false;
  const left = proposed.action;
  const right = previous.action ?? {};
  if (!['repositoryId', 'provider', 'localRepositoryPath', 'remoteRepositoryURL']
    .every(field => left[field] === right[field])) return false;
  if (proposed.class === 'pr-update' && previous.class === 'pr-update') {
    return left.prId === right.prId;
  }
  return ['sourceRepositoryURL', 'sourceRef', 'targetRef']
    .every(field => left[field] === right[field]);
}

export function validatePrDescriptionBinding(value, actionClass) {
  object(value, PR_DESCRIPTION_FIELDS, ['descriptionDigest', 'coverageDigest']);
  requireThat(['pr-create', 'pr-update'].includes(actionClass), 'INPUT',
    'Description publication requires a PR create or update');
  for (const field of ['descriptionDigest', 'coverageDigest', 'previousDescriptionDigest']) {
    if (value[field] !== undefined) requireThat(
      typeof value[field] === 'string' && /^[a-f0-9]{64}$/u.test(value[field]),
      'INPUT', `Invalid ${field}`);
  }
  if (actionClass === 'pr-update') {
    text(value.descriptionVersion, 'current PR description version', 200);
    requireThat(value.previousDescriptionDigest !== undefined, 'INPUT',
      'PR update requires the previously read description digest');
  } else requireThat(value.previousDescriptionDigest === undefined &&
    value.descriptionVersion === undefined, 'INPUT',
  'PR creation cannot name an existing description version');
  return value;
}

export function validatePrDescriptionAction(action) {
  const fields = PR_DESCRIPTION_FIELDS.filter(field => action[field] !== undefined);
  if (!fields.length) return;
  validatePrDescriptionBinding(Object.fromEntries(fields.map(field =>
    [field, action[field]])), action.class);
  const allowed = ['class', 'repositoryId', 'provider', 'localRepositoryPath',
    'remoteRepositoryURL', 'sourceRepositoryURL', 'sourceRef', 'targetRef',
    'sourceRevision', 'targetRevision', 'draft', 'target', 'prId', 'operationId',
    'earlyDraft', 'paths', 'outOfScope', 'itemId', 'externalPermission',
    'candidateDigest', 'testSpecDigest', ...PR_DESCRIPTION_FIELDS];
  requireThat(Object.keys(action).every(field => allowed.includes(field)), 'INPUT',
    'Coverage description authority cannot authorize other PR fields or effects');
}

// The body is a transient host handoff. Only the small binding goes into records.
export async function preparePrDescription(store, input) {
  object(input, ['workItemId', 'repositoryId', 'sourceRevision', 'class', 'body',
    'descriptionVersion'], ['workItemId', 'repositoryId', 'sourceRevision', 'class', 'body']);
  const { metadata } = await store.manifest(input.workItemId);
  const member = metadata.members.find(item => item.repositoryId === input.repositoryId);
  requireThat(member, 'BINDING', 'Description source must be a bound member');
  requireThat((await validateBinding(member)).head === input.sourceRevision, 'STALE',
    'Description source differs from the current bound commit');
  const { result } = await runCoverageCommand(store, {
    subcommand: 'prepare', cwd: member.root, flags: {},
    input: { workItemId: input.workItemId, repositoryId: input.repositoryId, body: input.body },
  });
  requireThat(result.sourceMatches && result.metadata.sourceRevision === input.sourceRevision,
    'STALE', 'Commit the canonical definitions before preparing publication metadata');
  const binding = {
    descriptionDigest: digest(result.body),
    coverageDigest: digest(result.metadata),
    ...(input.class === 'pr-update' ? {
      previousDescriptionDigest: digest(input.body),
      descriptionVersion: input.descriptionVersion,
    } : {}),
  };
  requireThat(input.class !== 'pr-create' || input.descriptionVersion === undefined,
    'INPUT', 'PR creation cannot name an existing description version');
  validatePrDescriptionBinding(binding, input.class);
  return {
    body: result.body, binding, diagnostics: result.diagnostics,
    uncovered: result.uncovered,
    authority: 'Declaration only; this handoff grants no publication permission or test credit',
  };
}

function intentMatchesOperation(intent, operation) {
  return intent?.type === 'pr-intent' && operation?.type === 'operation' &&
    operation.class === intent.class &&
    (intent.operationId === undefined || intent.operationId === operation.id) &&
    operation.intendedOutcome?.family === 'pull-request' &&
    ['provider', 'repositoryId', 'sourceRef', 'targetRef', 'sourceRevision', 'targetRevision',
      'draft', 'localRepositoryPath', 'remoteRepositoryURL', 'sourceRepositoryURL',
      'target', 'prId', ...PR_DESCRIPTION_FIELDS]
      .every(field => operation.action[field] === intent[field]);
}

function observedPrMatches(intent, pr) {
  return pr?.state === 'active' &&
    ['provider', 'connection', 'repositoryId', 'sourceRef', 'targetRef',
      'sourceRevision', 'targetRevision', 'draft', 'remoteRepositoryURL',
      'sourceRepositoryURL'].every(field => pr[field] === intent[field]) &&
    typeof pr.prId === 'string' && pr.prId.length > 0;
}

async function publicationIntent(store, input) {
  const state = await store.load(input.workItemId);
  const intent = state.records.find(record => record.id === input.intentId);
  const operation = state.records.find(record => record.id === input.operationId);
  requireThat(intent?.type === 'pr-intent' && intent.descriptionDigest !== undefined,
    'INPUT', 'A prepared description publication intent is required');
  requireThat(intentMatchesOperation(intent, operation), 'EVIDENCE',
    'Description intent and operation differ in source, PR, field scope or body binding');
  return { intent, operation, state };
}

async function recordDescriptionResult(store, input, options) {
  const { recordOperation } = await import('./operations.mjs');
  const operation = await recordOperation(store, {
    workItemId: input.workItemId, operationId: input.operationId,
    status: input.status ?? 'succeeded', observedResult: input.observedResult,
  }, options);
  if (operation.status === 'succeeded') {
    await store.transaction(input.workItemId, tx => {
      const intent = tx.get(input.intentId);
      requireThat(intentMatchesOperation(intent, tx.get(operation.id)), 'EVIDENCE',
        'Publication intent changed before result retention');
      requireThat(!intent.operationId || intent.operationId === operation.id, 'ID_CONFLICT',
        'Description intent already belongs to another operation');
      tx.put({ ...intent, status: 'recorded', operationId: operation.id });
    });
  }
  return { operation, action: operation.status === 'succeeded' ?
    'recorded' : 'reconcile-before-write' };
}

/**
 * Trusted host integration: read performs a fresh provider search/read; write
 * must conditionally compare the supplied version AND body digest for updates.
 * It returns the opaque observedResult consumed by store.verifyOperationResult.
 * Neither callback is accepted from serialized CLI input.
 */
export async function publishPrDescription(store, input, host) {
  object(input, ['workItemId', 'intentId', 'operationId', 'body'],
    ['workItemId', 'intentId', 'operationId', 'body']);
  object(host, ['invocation', 'adapterContract', 'hostCallId', 'read', 'write'],
    ['invocation', 'adapterContract', 'hostCallId', 'read', 'write']);
  requireThat(typeof host.read === 'function' && typeof host.write === 'function',
    'ADAPTER', 'Description publication needs trusted read and conditional-write callbacks');
  const { intent, operation, state } = await publicationIntent(store, input);
  if (operation.status !== 'prepared' || operation.dispatchBound) return {
    operation, action: 'reconcile-before-write',
  };
  requireThat(!state.records.some(other => prDescriptionWriteConflicts(operation, other)),
    'UNCERTAIN', 'Reconcile the previous write to this PR before dispatching another');
  requireThat(digest(input.body) === intent.descriptionDigest &&
    digest(readCoverageSection(input.body)) === intent.coverageDigest, 'EVIDENCE',
  'Transient description differs from the authorized body or coverage');
  const { publicationAuthority } = await import('./pr.mjs');
  const { currentCycle } = await import('./authority.mjs');
  requireThat(publicationAuthority(state.records, operation.action, store.clock, {
    cycleId: currentCycle(state.records, state.checkpoint)?.id,
  }), 'AUTHORITY', 'Description publication requires exact separate publication authority');
  const member = state.metadata.members.find(item => item.repositoryId === intent.repositoryId);
  const { result } = await runCoverageCommand(store, {
    subcommand: 'inspect', cwd: member.root, flags: {},
    input: { workItemId: input.workItemId, repositoryId: intent.repositoryId, body: input.body },
  });
  requireThat(result.sourceMatches &&
    result.metadata?.sourceRevision === intent.sourceRevision &&
    digest(result.metadata) === intent.coverageDigest &&
    !result.diagnostics.some(item => item.code !== 'UNCOVERED_CRITERIA' &&
      item.code !== 'EMPTY_SCOPE'), 'STALE',
  'Refresh description metadata after canonical source or definition changes');
  const observed = await host.read({ intent: structuredClone(intent) });
  object(observed, ['matches'], ['matches']);
  requireThat(Array.isArray(observed.matches), 'ADAPTER',
    'Trusted provider read must return its complete matching PR search');
  if (intent.class === 'pr-create') {
    requireThat(observed.matches.length === 0, 'CONFLICT',
      'A PR exists or the search is ambiguous; reconcile instead of creating another');
  } else {
    requireThat(observed.matches.length === 1, 'CONFLICT',
      'Update requires one current provider PR');
    const current = observed.matches[0];
    object(current, ['pr', 'body', 'descriptionVersion'], ['pr', 'body', 'descriptionVersion']);
    requireThat(observedPrMatches(intent, current.pr) &&
      current.pr.prId === intent.prId, 'EVIDENCE',
    'Current provider description belongs to another PR or source');
    requireThat(current.descriptionVersion === intent.descriptionVersion &&
      digest(current.body) === intent.previousDescriptionDigest, 'STALE',
    'Description changed concurrently; re-read, regenerate and obtain separate update authority');
    requireThat((await preparePrDescription(store, {
      workItemId: input.workItemId, repositoryId: intent.repositoryId,
      sourceRevision: intent.sourceRevision, class: 'pr-update',
      body: current.body, descriptionVersion: current.descriptionVersion,
    })).body === input.body, 'EVIDENCE',
    'Update may change only the owned Requirements Coverage section');
  }
  const { claimOperationDispatch, recordOperation } = await import('./operations.mjs');
  const claimed = await claimOperationDispatch(store, {
    workItemId: input.workItemId, operationId: input.operationId,
    invocation: host.invocation, adapterContract: host.adapterContract,
    hostCallId: host.hostCallId,
  });
  let response;
  try {
    response = await host.write({
      operation: claimed, body: input.body,
      ...(intent.class === 'pr-update' ? {
        prId: intent.prId, expectedVersion: intent.descriptionVersion,
        expectedBodyDigest: intent.previousDescriptionDigest,
      } : {}),
    });
  } catch {
    // Dispatch was claimed before invoking the host, so even a rejected/lost
    // response cannot prove non-dispatch or authorize a second write.
    return {
      operation: await recordOperation(store, {
        workItemId: input.workItemId, operationId: input.operationId, status: 'uncertain',
      }),
      action: 'reconcile-before-write',
    };
  }
  object(response, ['observedResult', 'status'], ['observedResult']);
  return recordDescriptionResult(store, { ...input, ...response });
}

export async function reconcilePrDescription(store, input) {
  object(input, ['workItemId', 'intentId', 'operationId', 'observedResult', 'status'],
    ['workItemId', 'intentId', 'operationId', 'observedResult']);
  const { operation } = await publicationIntent(store, input);
  requireThat(operation.dispatchBound && operation.status !== 'prepared', 'EVIDENCE',
    'Reconciliation needs an actually claimed operation; observation cannot create dispatch proof');
  return recordDescriptionResult(store, input, { reconcile: true });
}
