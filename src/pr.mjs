import { choice, digest, now, object, requireThat, strings, text } from './core.mjs';
import { activeEvents, assurancePending, currentCycle, matchesScope } from './authority.mjs';
import { validateBinding } from './git.mjs';
import { loadConfig } from './artifacts.mjs';
import { currentArtifact, publicationDestination } from './current-evidence.mjs';
import { archiveSupersededObservations, withObservationRetention } from './observation-retention.mjs';
export { readArchivedPrFacts } from './observation-retention.mjs';
import { monitorAssociationKey, readActiveMonitor, readMonitorAssociation,
  runKey as monitorRunKey, withMonitorLocks } from './monitors.mjs';
import { sameExecutionIdentity, validateAdapterExecutionIdentity,
  validateExecutionIdentity } from './provider-adapters.mjs';
import { pullRequestIdentityKey, pullRequestObservationKey,
  validatePullRequestObservation, validatePullRequestTransition,
  validateRepositoryIdentity,
  requirePublicationSourceObservation,
  selectedPublicationRepositoryURL } from './repository-observations.mjs';

const observationVerification = observation => ({
  canonicalLocalRepositoryPath: observation.localRepositoryPath,
  verifiedRemoteRepositoryURL: observation.remoteRepositoryURL,
  verifiedProvider: observation.provider,
  verifiedConnection: observation.connection,
  verifiedRepositoryRef: observation.repositoryRef,
  verifiedPullRequestRef: observation.pullRequestRef,
  ...(observation.sourceRepositoryURL === undefined ? {} :
    { verifiedSourceRepositoryURL: observation.sourceRepositoryURL }),
});

function prObservationValue(record) {
  return Object.fromEntries(['localRepositoryPath', 'remoteRepositoryURL',
    'provider', 'connection', 'repositoryRef', 'pullRequestRef',
    'sourceRepositoryURL', 'sourceBranchRef', 'targetBranchRef',
    'sourceRevision', 'targetRevision', 'state', 'sequence',
    'previousObservationKey', 'observedAt', 'evidenceRef']
    .filter(field => record[field] !== undefined)
    .map(field => [field, record[field]]));
}

function currentPrObservation(records, candidate) {
  const identity = pullRequestIdentityKey(prObservationValue(candidate),
    observationVerification(candidate));
  return records.filter(record => record.type === 'pr-observation' &&
    pullRequestIdentityKey(prObservationValue(record),
      observationVerification(record)) === identity)
    .sort((left, right) => left.sequence - right.sequence).at(-1);
}

function currentObservation(records, record) {
  return record?.type === 'pr-observation' &&
    currentPrObservation(records, record)?.id === record.id &&
    !records.some(other => other.type === 'pr-observation' &&
      other.id !== record.id && other.repositoryId === record.repositoryId &&
      other.provider === record.provider &&
      other.connection === record.connection &&
      other.repositoryRef === record.repositoryRef &&
      other.pullRequestRef === record.pullRequestRef &&
      other.observedAt >= record.observedAt &&
      (other.localRepositoryPath !== record.localRepositoryPath ||
        other.remoteRepositoryURL !== record.remoteRepositoryURL));
}

async function observedPr(store, input, tx) {
  object(input.observation, ['repositoryId', 'localRepositoryPath', 'remoteRepositoryURL',
    'provider', 'connection', 'repositoryRef', 'pullRequestRef', 'sourceRepositoryURL',
    'sourceBranchRef', 'targetBranchRef', 'sourceRevision', 'targetRevision',
    'state', 'observedAt', 'evidenceRef'],
  ['repositoryId', 'localRepositoryPath', 'remoteRepositoryURL', 'provider',
    'connection', 'repositoryRef', 'pullRequestRef', 'sourceBranchRef',
    'targetBranchRef', 'sourceRevision', 'targetRevision', 'state',
    'observedAt', 'evidenceRef']);
  const source = input.observation;
  choice(source.state, ['active', 'merged', 'closed'], 'PR state');
  const member = tx.metadata.members.find(item => item.repositoryId === source.repositoryId);
  requireThat(member && member.root === source.localRepositoryPath, 'BINDING',
    'PR observation does not belong to the bound checkout');
  const config = await loadConfig(tx.metadata, source.repositoryId);
  await selectedPublicationRepositoryURL(member, config.remote,
    source.remoteRepositoryURL, input.selectedRemoteName);
  const repository = tx.all().filter(record =>
    record.type === 'repository-observation' &&
    record.repositoryId === source.repositoryId &&
    record.localRepositoryPath === source.localRepositoryPath &&
    record.remoteRepositoryURL === source.remoteRepositoryURL)
    .sort((left, right) => left.observedAt.localeCompare(right.observedAt)).at(-1);
  requireThat(repository && repository.provider === source.provider &&
    repository.connection === source.connection &&
    repository.repositoryRef === source.repositoryRef, 'EVIDENCE',
  'A current verified repository observation is required for this checkout and hosted URL');
  // CLI-supplied provider fields cannot attest to their own PR identity or revisions.
  requireThat(typeof store.verifyPullRequest === 'function', 'ADAPTER',
    'A trusted hosting-service PR verifier is required');
  const verification = await store.verifyPullRequest({
    provider: source.provider, adapterObservation: input.adapterObservation,
    localRepositoryPath: source.localRepositoryPath,
    remoteRepositoryURL: source.remoteRepositoryURL,
  });
  object(verification, ['canonicalLocalRepositoryPath',
    'verifiedRemoteRepositoryURL', 'verifiedProvider', 'verifiedConnection',
    'verifiedRepositoryRef', 'verifiedPullRequestRef', 'verifiedSourceRepositoryURL',
    'verifiedSourceRepositoryRef',
    'verifiedSourceBranchRef', 'verifiedTargetBranchRef',
    'verifiedSourceRevision', 'verifiedTargetRevision', 'verifiedState',
    'verifiedObservedAt', 'verifiedEvidenceRef'],
  ['canonicalLocalRepositoryPath', 'verifiedRemoteRepositoryURL',
    'verifiedProvider', 'verifiedConnection', 'verifiedRepositoryRef',
    'verifiedPullRequestRef', 'verifiedSourceBranchRef', 'verifiedTargetBranchRef',
    'verifiedSourceRevision', 'verifiedTargetRevision', 'verifiedState',
    'verifiedObservedAt', 'verifiedEvidenceRef']);
  for (const [field, observed] of [
    ['verifiedSourceBranchRef', source.sourceBranchRef],
    ['verifiedTargetBranchRef', source.targetBranchRef],
    ['verifiedSourceRevision', source.sourceRevision],
    ['verifiedTargetRevision', source.targetRevision],
    ['verifiedState', source.state],
    ['verifiedObservedAt', source.observedAt],
    ['verifiedEvidenceRef', source.evidenceRef],
  ]) {
    requireThat(verification[field] === observed, 'EVIDENCE',
      `Hosting-service adapter did not verify ${field}`);
  }
  const verifiedRepository = {
    canonicalLocalRepositoryPath: verification.canonicalLocalRepositoryPath,
    verifiedRemoteRepositoryURL: verification.verifiedRemoteRepositoryURL,
    verifiedProvider: verification.verifiedProvider,
    verifiedConnection: verification.verifiedConnection,
    verifiedRepositoryRef: verification.verifiedRepositoryRef,
  };
  validateRepositoryIdentity({
    localRepositoryPath: source.localRepositoryPath,
    remoteRepositoryURL: source.remoteRepositoryURL,
    provider: source.provider,
    connection: source.connection,
    repositoryRef: source.repositoryRef,
  }, verifiedRepository);
  requireThat(source.pullRequestRef === verification.verifiedPullRequestRef &&
    source.sourceRepositoryURL === verification.verifiedSourceRepositoryURL,
  'EVIDENCE', 'Hosting-service adapter identified another PR or fork source');
  if (source.sourceBranchRef === source.targetBranchRef) {
    requireThat(source.sourceRepositoryURL &&
      source.sourceRepositoryURL !== source.remoteRepositoryURL,
    'EVIDENCE', 'Equal PR branch refs require a distinct verified fork source');
    const sourceObservation = tx.all().find(record =>
      record.type === 'repository-observation' &&
      record.remoteRepositoryURL === source.sourceRepositoryURL &&
      record.provider === source.provider &&
      tx.metadata.members.some(candidate =>
        candidate.repositoryId === record.repositoryId &&
        candidate.root === record.localRepositoryPath));
    requireThat(!sourceObservation ||
      sourceObservation.repositoryRef !== repository.repositoryRef,
    'EVIDENCE', 'Different Git URLs do not prove different hosted repositories');
    if (verification.verifiedSourceRepositoryRef !== undefined) {
      text(verification.verifiedSourceRepositoryRef, 'verified fork source repository');
      requireThat(verification.verifiedSourceRepositoryRef !== repository.repositoryRef &&
        (!sourceObservation ||
          sourceObservation.repositoryRef === verification.verifiedSourceRepositoryRef),
      'EVIDENCE', 'Hosting-service fork identity conflicts with the hosted repository');
    } else {
      const verifiedSource = await requirePublicationSourceObservation(
        tx.metadata, tx.all(), repository, source.sourceRepositoryURL);
      requireThat(verifiedSource.repositoryRef !== repository.repositoryRef,
      'EVIDENCE', 'Equal PR branch refs require a distinct verified fork');
    }
  }
  const predecessor = currentPrObservation(tx.all(), {
    ...source, sequence: 1,
  });
  requireThat(input.previousObservationKey === predecessor?.id, 'STALE',
    'PR refresh must name the current observation (or omit it for a new PR)');
  requireThat(!predecessor || source.observedAt > predecessor.observedAt,
    'STALE', 'PR refresh must have a later provider observation time');
  const observation = validatePullRequestObservation({
    ...prObservationValue(source), sequence: (predecessor?.sequence ?? 0) + 1,
    ...(predecessor ? { previousObservationKey: predecessor.id } : {}),
  }, {
    ...verifiedRepository,
    verifiedPullRequestRef: verification.verifiedPullRequestRef,
    ...(verification.verifiedSourceRepositoryURL === undefined ? {} :
      { verifiedSourceRepositoryURL: verification.verifiedSourceRepositoryURL }),
  });
  if (predecessor) validatePullRequestTransition(prObservationValue(predecessor), observation,
    observationVerification(predecessor), observationVerification(observation));
  const id = pullRequestObservationKey(observation, observationVerification(observation));
  return { ...observation, id, type: 'pr-observation',
    workItemId: input.workItemId, repositoryId: source.repositoryId };
}

export function validatePrIdentity(pr, { hostedRepository, sourceRepository } = {}) {
  for (const field of ['provider', 'connection', 'repositoryId', 'sourceRef', 'targetRef', 'sourceRevision', 'targetRevision']) text(pr[field], field);
  for (const field of ['sourceRef', 'targetRef']) requireThat(pr[field].startsWith('refs/heads/'), 'INPUT', 'PR branch must be a full refs/heads/ reference');
  if (pr.sourceRef === pr.targetRef) {
    requireThat(hostedRepository?.type === 'repository-observation' &&
      sourceRepository?.type === 'repository-observation' &&
      hostedRepository.provider === pr.provider &&
      hostedRepository.connection === pr.connection &&
      sourceRepository.provider === pr.provider &&
      hostedRepository.remoteRepositoryURL !== sourceRepository.remoteRepositoryURL &&
      hostedRepository.repositoryRef !== sourceRepository.repositoryRef &&
      (pr.localRepositoryPath === undefined ||
        pr.localRepositoryPath === hostedRepository.localRepositoryPath) &&
      (pr.remoteRepositoryURL === undefined ||
        pr.remoteRepositoryURL === hostedRepository.remoteRepositoryURL) &&
      (pr.sourceRepositoryURL === undefined ||
        pr.sourceRepositoryURL === sourceRepository.remoteRepositoryURL),
    'EVIDENCE', 'Equal PR branch refs require independently verified distinct hosted and fork repositories');
  }
  requireThat(typeof pr.draft === 'boolean', 'INPUT', 'PR draft intent must be explicit');
}
export function prMatches(left, right) {
  return ['provider', 'connection', 'repositoryId', 'sourceRef', 'targetRef', 'sourceRevision'].every(key => left[key] === right[key]);
}
export function publicationAuthority(records, pr, clock = Date, { cycleId, allowUnreservedOnce = false } = {}) {
  const action = { class: pr.class ?? 'pr-create', repositoryId: pr.repositoryId,
    sourceRef: pr.sourceRef, targetRef: pr.targetRef, draft: pr.draft,
    localRepositoryPath: pr.localRepositoryPath,
    remoteRepositoryURL: pr.remoteRepositoryURL,
    ...(pr.class === 'push' ? { remoteUrlDigest: pr.remoteUrlDigest } : {}),
    sourceRepositoryURL: pr.sourceRepositoryURL ??
      (pr.class === 'push' ? pr.remoteRepositoryURL : undefined) };
  if (!publicationDestination(records, action,
    { push: pr.class === 'push' })) return undefined;
  for (const field of ['operationId', 'paths', 'itemId', 'outOfScope', 'environment', 'target']) {
    if (pr[field] !== undefined) action[field] = pr[field];
  }
  return activeEvents(records, { clock, cycleId }).find(event => {
    if (event.kind !== 'pr-publication' || event.effect.repositoryId !== pr.repositoryId ||
      event.effect.sourceRef !== pr.sourceRef || event.effect.targetRef !== pr.targetRef ||
      event.effect.draft !== pr.draft ||
      !['localRepositoryPath', 'remoteRepositoryURL', 'sourceRepositoryURL',
        'target'].every(field => event.effect[field] !== undefined &&
          event.effect[field] === action[field])) return false;
    if (event.effect.lifetime?.kind === 'once' && !action.operationId) {
      if (!allowUnreservedOnce || records.some(record => record.type === 'reservation' && record.eventId === event.id)) return false;
      action.operationId = `unreserved-${event.id}`;
    }
    return matchesScope(event, action, records);
  });
}
export async function preparePr(store, input) {
  object(input, ['workItemId', 'provider', 'connection', 'repositoryId', 'sourceRef', 'targetRef', 'sourceRevision',
    'targetRevision', 'remoteSourceRevision', 'draft', 'scope', 'matches',
    'localRepositoryPath', 'remoteRepositoryURL', 'sourceRepositoryURL', 'target'],
  ['workItemId', 'remoteSourceRevision', 'matches']);
  requireThat(Array.isArray(input.matches), 'INPUT', 'Supply the provider search result, including an empty list when no PR exists');
  return store.transaction(input.workItemId, async tx => {
    const member = tx.metadata.members.find(m => m.repositoryId === input.repositoryId);
    requireThat(member?.branch === input.sourceRef, 'BINDING', 'PR source differs from the bound member');
    requireThat((await validateBinding(member)).head === input.sourceRevision, 'EVIDENCE', 'PR source revision does not match the actual committed member HEAD');
    const configuration = await loadConfig(tx.metadata, member.repositoryId);
    const selected = await selectedPublicationRepositoryURL(member,
      configuration.remote, input.remoteRepositoryURL, input.target);
    requireThat(input.localRepositoryPath === member.root &&
      typeof input.sourceRepositoryURL === 'string',
    'EVIDENCE', 'PR preparation requires the selected verified local checkout, hosted URL and source repository');
    const hostedObservation = tx.all().find(record =>
      record.type === 'repository-observation' &&
      record.repositoryId === member.repositoryId &&
      record.localRepositoryPath === member.root &&
      record.remoteRepositoryURL === selected.remoteRepositoryURL &&
      record.provider === input.provider && record.connection === input.connection);
    requireThat(hostedObservation, 'EVIDENCE',
      'PR preparation requires a trusted observation of its hosted repository');
    const sourceObservation = await requirePublicationSourceObservation(tx.metadata, tx.all(),
      hostedObservation, input.sourceRepositoryURL);
    const verifiedRepositories = {
      hostedRepository: hostedObservation, sourceRepository: sourceObservation,
    };
    validatePrIdentity(input, verifiedRepositories);
    requireThat(input.remoteSourceRevision === input.sourceRevision, 'EVIDENCE', 'Commit/push the authorized candidate before publishing a PR');
    requireThat(publicationAuthority(tx.all(), input, store.clock, {
      cycleId: currentCycle(tx.all(), tx.checkpoint)?.id, allowUnreservedOnce: true,
    }), 'AUTHORITY', 'PR prerequisite is not publication consent; request the missing authority once');
    const existing = tx.all().find(r => r.type === 'pr-intent' &&
      prMatches(r, input) &&
      ['localRepositoryPath', 'remoteRepositoryURL', 'sourceRepositoryURL',
        'target', 'targetRevision', 'draft'].every(field => r[field] === input[field]));
    if (existing) return { intent: existing, action: existing.status === 'recorded' ? 'reuse' : 'reconcile-before-create' };
    const matches = input.matches.filter(pr => prMatches(pr, input) && pr.state === 'active');
    requireThat(matches.length <= 1, 'CONFLICT', 'Multiple appropriate PRs; resolve ambiguity instead of creating another');
    if (matches.length === 1) {
      requireThat(tx.all().some(record => record.type === 'pr-observation' &&
        currentObservation(tx.all(), record) &&
        record.repositoryId === input.repositoryId &&
        record.localRepositoryPath === input.localRepositoryPath &&
        record.remoteRepositoryURL === input.remoteRepositoryURL &&
        (record.sourceRepositoryURL ?? record.remoteRepositoryURL) ===
          input.sourceRepositoryURL &&
        record.provider === input.provider && record.connection === input.connection &&
        record.pullRequestRef === matches[0].prId &&
        record.sourceBranchRef === input.sourceRef &&
        record.targetBranchRef === input.targetRef &&
        record.sourceRevision === input.sourceRevision &&
        record.targetRevision === input.targetRevision &&
        record.state === 'active'), 'EVIDENCE',
      'An existing PR needs a current trusted observation of the exact hosted and source repositories');
      const pr = normalizedPr(input.workItemId, matches[0], verifiedRepositories);
      requireThat(pr.draft === input.draft, 'CONFLICT', 'Existing PR draft/ready state differs from requested intent');
      tx.put(pr);
      return { pr, action: 'reuse' };
    }
    const { matches: ignored, remoteSourceRevision, ...identity } = input;
    const intent = { ...identity, id: `pr-intent-${digest(identity).slice(0, 40)}`, type: 'pr-intent', status: 'prepared', createdAt: now(store.clock) };
    tx.put(intent);
    return { intent, action: 'prepare-operation', nextAction: 'Prepare and bind a pr-create operation before invoking the provider. Do not retry an uncertain create.' };
  });
}
function normalizedPr(workItemId, input, verifiedRepositories) {
  object(input, ['provider', 'connection', 'repositoryId', 'sourceRef', 'targetRef', 'sourceRevision', 'targetRevision', 'draft',
    'prId', 'url', 'state', 'evidenceRef', 'autoMerge', 'scope', 'mergeRevision'], ['prId', 'url', 'state', 'evidenceRef']);
  validatePrIdentity(input, verifiedRepositories);
  text(input.prId, 'PR ID'); text(input.evidenceRef, 'provider evidence');
  const url = new URL(input.url);
  requireThat(url.protocol === 'https:' && !url.username && !url.password && !/\/(?:login|signin)(?:\/|$)/iu.test(url.pathname), 'INPUT', 'Provide the actual credential-free PR web URL');
  choice(input.state, ['active', 'merged', 'closed'], 'PR state');
  return { ...input, id: `pr-${digest({ provider: input.provider, connection: input.connection, repositoryId: input.repositoryId, prId: input.prId }).slice(0, 40)}`, type: 'pr', workItemId };
}
export async function adoptPr(store, input) {
  object(input, ['workItemId', 'pr', 'observation', 'adapterObservation',
    'selectedRemoteName', 'previousObservationKey',
    'intentId', 'operationId'], ['workItemId']);
  requireThat((input.pr === undefined) !== (input.observation === undefined),
    'INPUT', 'Supply exactly one legacy PR or current verified PR observation');
  return withObservationRetention(store, input.workItemId, async (tx, monitorDependencies) => {
    if (input.observation !== undefined) {
      requireThat(input.intentId === undefined && input.operationId === undefined,
        'EVIDENCE', 'Observing a PR does not reconcile a publication operation');
      const observation = await observedPr(store, input, tx);
      tx.put(observation);
      await archiveSupersededObservations(store, tx, { monitorDependencies });
      return { pr: observation, observation,
        authority: 'observation-only; adoption grants no publish, merge or deployment permission' };
    }
    let intent;
    let verifiedRepositories;
    if (input.intentId !== undefined || input.operationId !== undefined) {
      requireThat(input.intentId && input.operationId, 'EVIDENCE',
        'PR creation result requires both the prepared intent and proven operation');
      intent = tx.get(input.intentId);
      requireThat(intent?.type === 'pr-intent' &&
        ['provider', 'connection', 'repositoryId', 'sourceRef', 'targetRef',
          'sourceRevision', 'targetRevision', 'draft']
          .every(field => intent[field] === input.pr[field]),
      'EVIDENCE', 'PR result differs from publication intent');
      const operation = tx.get(input.operationId);
      requireThat(operation?.class === 'pr-create' &&
        operation.status === 'succeeded' &&
        operation.intendedOutcome?.family === 'pull-request' &&
        operation.resultProof?.status === 'succeeded' &&
        operation.resultProof.dispatchId === operation.id &&
        operation.resultProof.intendedOutcomeDigest === operation.intendedOutcome?.digest &&
        operation.resultProof.providerResultId === input.pr.prId &&
        operation.handle === input.pr.prId,
      'EVIDENCE', 'PR creation requires a causally proven matching provider result');
      requireThat(operation.repositoryId === intent.repositoryId &&
        ['sourceRef', 'targetRef', 'sourceRevision', 'targetRevision', 'draft']
          .every(field => operation.action[field] === intent[field]) &&
        operation.action.localRepositoryPath === intent.localRepositoryPath &&
        operation.action.remoteRepositoryURL === intent.remoteRepositoryURL &&
        operation.action.sourceRepositoryURL === intent.sourceRepositoryURL &&
        operation.action.target === intent.target &&
        operation.intendedOutcome.target.remoteRepositoryURL === intent.remoteRepositoryURL &&
        operation.intendedOutcome.requested.sourceRepositoryURL === intent.sourceRepositoryURL,
      'EVIDENCE', 'PR identity does not match its dispatched publication operation');
      const member = tx.metadata.members.find(candidate =>
        candidate.repositoryId === intent.repositoryId &&
        candidate.root === intent.localRepositoryPath);
      requireThat(member, 'BINDING',
        'PR publication intent no longer belongs to the bound checkout');
      const config = await loadConfig(tx.metadata, member.repositoryId);
      await selectedPublicationRepositoryURL(member, config.remote,
        intent.remoteRepositoryURL, intent.target);
      const hostedRepository = tx.all().filter(record =>
        record.type === 'repository-observation' &&
        record.repositoryId === member.repositoryId &&
        record.localRepositoryPath === member.root &&
        record.remoteRepositoryURL === intent.remoteRepositoryURL &&
        record.provider === input.pr.provider &&
        record.connection === input.pr.connection)
        .sort((left, right) => left.observedAt.localeCompare(right.observedAt)).at(-1);
      requireThat(hostedRepository, 'EVIDENCE',
        'PR result requires a current trusted hosted repository observation');
      const sourceRepository = await requirePublicationSourceObservation(
        tx.metadata, tx.all(), hostedRepository, intent.sourceRepositoryURL);
      verifiedRepositories = { hostedRepository, sourceRepository };
    }
    const pr = normalizedPr(input.workItemId, input.pr, verifiedRepositories);
    requireThat(tx.metadata.members.some(m => m.repositoryId === pr.repositoryId), 'BINDING', 'PR is outside the work item');
    const previousPr = tx.get(pr.id);
    if (previousPr?.type === 'pr' &&
        (previousPr.sourceRevision !== pr.sourceRevision ||
          previousPr.targetRevision !== pr.targetRevision ||
          previousPr.sourceRef !== pr.sourceRef ||
          previousPr.targetRef !== pr.targetRef ||
          previousPr.draft !== pr.draft ||
          previousPr.state !== pr.state)) {
      tx.remove(`facts-${pr.id}`);
    }
    if (intent) {
      requireThat(intent.status !== 'recorded' || intent.prRecordId === pr.id,
        'ID_CONFLICT', 'Recorded PR intent cannot be reassigned to another PR');
      intent.status = 'recorded'; intent.prRecordId = pr.id; tx.put(intent);
    }
    tx.put(pr);
    return { pr, authority: 'observation-only; adoption grants no publish, merge or deployment permission',
      warning: pr.autoMerge ? 'Existing PR has auto-merge enabled; surface this side effect, do not assume it is authorized.' : null };
  });
}
export async function updatePrFacts(store, input) {
  object(input, ['workItemId', 'prRecordId', 'policyVersion', 'sourceRevision', 'targetRevision', 'requiredChecks',
    'checks', 'reviewsSatisfied', 'merged', 'providerEvidenceRef', 'mergeContext', 'runMonitorRefs'],
  ['workItemId', 'prRecordId', 'policyVersion', 'sourceRevision', 'targetRevision', 'requiredChecks', 'checks', 'providerEvidenceRef']);
  strings(input.requiredChecks, 'required checks', 30);
  requireThat(Array.isArray(input.checks) && input.checks.length <= 30, 'INPUT', 'Invalid check facts');
  for (const check of input.checks) {
    object(check, ['id', 'status', 'sourceRevision', 'targetRevision', 'mergeRevision', 'evidenceRef', 'runKey',
      'identity', 'requiredCheckRef', 'checkResultRef', 'producerRef', 'testedRevision'],
    ['id', 'status', 'evidenceRef']);
    choice(check.status, ['succeeded', 'failed', 'pending', 'cancelled', 'missing'], 'check status');
    text(check.id, 'check identity'); text(check.evidenceRef, 'check evidence');
    if (check.runKey) {
      text(check.runKey, 'check monitor identity');
      check.identity = validateExecutionIdentity(check.identity);
      requireThat(check.runKey === monitorRunKey(check.identity),
        'EVIDENCE',
        'Check runKey does not match its provider execution identity');
    }
  }
  requireThat(new Set(input.checks.map(c => c.id)).size === input.checks.length, 'INPUT', 'Duplicate check identities');
  if (input.mergeContext) object(input.mergeContext, ['sourceRevision', 'targetRevision', 'mergeRevision', 'evidenceRef'],
    ['sourceRevision', 'targetRevision', 'mergeRevision', 'evidenceRef']);
  if (input.runMonitorRefs) strings(input.runMonitorRefs, 'run monitor references', 30);
  return withMonitorLocks(store,
    input.checks.flatMap(check => check.runKey ? [check.runKey] : []),
    async () => {
      const state = await store.load(input.workItemId);
      const observedPr = state.records.find(record =>
        record.id === input.prRecordId && ['pr', 'pr-observation'].includes(record.type));
      requireThat(observedPr, 'INPUT', 'PR record is unavailable');
      requireThat(observedPr.type !== 'pr-observation' ||
        currentObservation(state.records, observedPr), 'STALE',
      'Checks belong to an older PR observation');
      if (observedPr.type === 'pr-observation') {
        for (const check of input.checks.filter(item => item.runKey)) {
          for (const field of ['requiredCheckRef', 'checkResultRef',
            'producerRef', 'testedRevision']) text(check[field], field);
          validateAdapterExecutionIdentity(check.identity.provider, check.identity);
        }
      }
      const verifiedMonitorRefs = [];
      for (const check of input.checks) {
        if (!check.runKey) continue;
        const monitor = await readActiveMonitor(store, check.runKey);
        const association = await readMonitorAssociation(store, {
          runKey: check.runKey,
          workItemId: input.workItemId,
          prRecordId: input.prRecordId,
          checkId: check.id,
          ...(observedPr.type === 'pr-observation' ? {
            prObservationKey: observedPr.id, requiredCheckRef: check.requiredCheckRef,
            checkResultRef: check.checkResultRef, producerRef: check.producerRef,
          } : {}),
        });
        const isCurrent = observedPr.type === 'pr-observation';
        if (monitor?.key === check.runKey &&
          check.identity.provider === observedPr.provider &&
          check.identity.connection === observedPr.connection &&
          sameExecutionIdentity(monitor.identity, check.identity) &&
          association?.workItemId === input.workItemId &&
          association.prRecordId === input.prRecordId &&
          association.checkId === check.id &&
          (!isCurrent || (
            association.prObservationKey === observedPr.id &&
            association.localRepositoryPath === observedPr.localRepositoryPath &&
            association.remoteRepositoryURL === observedPr.remoteRepositoryURL &&
            association.requiredCheckRef === check.requiredCheckRef &&
            association.checkResultRef === check.checkResultRef &&
            association.producerRef === check.producerRef &&
            association.testedRevision === check.testedRevision &&
            association.evidenceRef === check.evidenceRef &&
            association.evidenceVerified === true &&
            association.identity?.attemptKind !== 'unknown' &&
            sameExecutionIdentity(association.identity, check.identity) &&
            (check.testedRevision === observedPr.sourceRevision ||
              (check.mergeRevision === check.testedRevision &&
                association.mergeContext?.mergeRevision === check.testedRevision &&
                association.mergeContext?.sourceRevision === observedPr.sourceRevision &&
                association.mergeContext?.targetRevision === observedPr.targetRevision))
          )) &&
          association.sourceRevision ===
            (check.sourceRevision ?? input.sourceRevision) &&
          association.targetRevision ===
            (check.targetRevision ?? input.targetRevision) &&
          monitor.capability?.schedulerAvailable === true &&
          monitor.capability?.readAvailable === true &&
          monitor.link?.status === 'verified' &&
          monitor.runStatus === check.status) {
          verifiedMonitorRefs.push(association.key);
        }
      }
      requireThat((input.runMonitorRefs ?? []).every(reference =>
        verifiedMonitorRefs.includes(reference)),
      'EVIDENCE',
      'Supplied PR monitor references must resolve to matching verified monitor records');
      return store.transaction(input.workItemId, tx => {
        const pr = tx.get(input.prRecordId);
        requireThat(['pr', 'pr-observation'].includes(pr?.type), 'INPUT',
          'PR record is unavailable');
        requireThat(pr.type !== 'pr-observation' ||
          currentObservation(tx.all(), pr), 'STALE',
        'PR facts cannot be updated for an older observation');
        requireThat(pr.sourceRevision === input.sourceRevision &&
          pr.targetRevision === input.targetRevision,
        'STALE',
        'Provider facts do not match the current PR source/target observation');
        const facts = {
          ...input,
          runMonitorRefs: verifiedMonitorRefs,
          id: `facts-${input.prRecordId}`,
          type: 'pr-facts',
          observedAt: now(store.clock),
        };
        tx.put(facts);
        return facts;
      });
    });
}
export function evaluateReadiness(records, input, { clock = Date, maxAgeMs = 60000, cycle } = {}) {
  object(input, ['environment', 'repositoryId', 'prRecordId',
    'sourceRevision', 'targetRevision', 'policyVersion', 'policy',
    'localRepositoryPath', 'remoteRepositoryURL', 'prId',
    'requireArtifact', 'artifactId'],
    ['environment']);
  choice(input.environment, ['DEV', 'STAGING', 'PROD'], 'environment');
  const policy = { required: input.environment === 'PROD', validation: input.environment === 'PROD',
    reviews: false, merge: false, ...(input.policy ?? {}) };
  if (input.environment === 'PROD') { policy.required = true; policy.validation = true; }
  const gaps = [];
  const artifactEnvironment = input.environment === 'PROD' ? 'STAGING' :
    input.environment;
  if (input.requireArtifact && (assurancePending(cycle, records) ||
    !records.some(record =>
    input.localRepositoryPath && input.remoteRepositoryURL &&
    record.type === 'artifact' &&
    record.id === cycle?.artifacts[artifactEnvironment] &&
    record.artifactId === input.artifactId &&
    record.localRepositoryPath === input.localRepositoryPath &&
    record.remoteRepositoryURL === input.remoteRepositoryURL &&
    currentArtifact(cycle, records, record, input.repositoryId)))) {
    gaps.push('current-deployable-artifact-unverified');
  }
  if (!policy.required && !policy.validation && !policy.reviews && !policy.merge) return {
    verdict: gaps.length ? 'unverified' : 'not-applicable',
    ready: gaps.length === 0, gaps,
    permissions: { publish: false, merge: false, deploy: false },
    reason: 'This environment does not require a PR; artifact/deployment authority remains separate.' };
  const pr = records.find(r => r.id === input.prRecordId &&
    ['pr', 'pr-observation'].includes(r.type));
  const facts = records.find(r => r.type === 'pr-facts' && r.prRecordId === pr?.id);
  if (!pr) gaps.push('qualifying-pr-missing');
  if (pr?.type === 'pr') gaps.push('pr-observation-unverified');
  if (pr?.type === 'pr-observation' && !currentObservation(records, pr))
    gaps.push('current-pr-observation-differs');
  if (pr?.type === 'pr-observation' &&
      (pr.localRepositoryPath !== input.localRepositoryPath ||
        pr.remoteRepositoryURL !== input.remoteRepositoryURL)) {
    gaps.push('pr-hosted-repository-mismatch');
  }
  if (pr?.type === 'pr-observation' &&
      pr.pullRequestRef !== input.prId) {
    gaps.push('pr-hosted-id-mismatch');
  }
  if (pr && input.repositoryId &&
      pr.repositoryId !== input.repositoryId) {
    gaps.push('pr-repository-mismatch');
  }
  if (pr?.state === 'closed') gaps.push('pr-closed-without-merge');
  if (!facts) gaps.push('provider-policy-or-check-metadata-unavailable');
  if (facts) {
    if (pr.sourceRevision !== input.sourceRevision ||
        pr.targetRevision !== input.targetRevision) {
      gaps.push('current-pr-revision-differs');
    }
    if (!input.policyVersion || facts.policyVersion !== input.policyVersion) gaps.push('policy-version-unverified');
    if (!input.sourceRevision || !input.targetRevision || facts.sourceRevision !== input.sourceRevision || facts.targetRevision !== input.targetRevision) gaps.push('stale-source-or-target');
    if (clock.now() - Date.parse(facts.observedAt) > maxAgeMs) gaps.push('re-read-provider-readiness-before-dependent-step');
    if (policy.validation) {
      if (facts.requiredChecks.length === 0) gaps.push('required-check-set-unverified');
      for (const required of facts.requiredChecks) {
        const matching = facts.checks.filter(c =>
          pr?.type === 'pr-observation' ? c.requiredCheckRef === required : c.id === required);
        if (matching.length !== 1 && pr?.type === 'pr-observation')
          gaps.push(`check:${required}:result-ambiguous`);
        const check = matching.length === 1 ? matching[0] : undefined;
        if (!check || check.status !== 'succeeded') { gaps.push(`check:${required}:${check?.status ?? 'missing'}`); continue; }
        const direct = check.testedRevision === input.sourceRevision &&
          check.sourceRevision === input.sourceRevision && check.targetRevision === input.targetRevision;
        const merged = check.testedRevision === check.mergeRevision &&
          facts.mergeContext?.evidenceRef && facts.mergeContext.sourceRevision === input.sourceRevision &&
          facts.mergeContext.targetRevision === input.targetRevision && facts.mergeContext.mergeRevision === check.mergeRevision;
        if (!direct && !merged) gaps.push(`check:${required}:revision-provenance-unverified`);
        if (!check.runKey) gaps.push(`check:${required}:monitor-identity-missing`);
        else {
          const associationKey = monitorAssociationKey({ runKey: check.runKey, workItemId: pr.workItemId,
            prRecordId: pr.id, checkId: check.id,
            ...(pr.type === 'pr-observation' ? {
              prObservationKey: pr.id, requiredCheckRef: check.requiredCheckRef,
              checkResultRef: check.checkResultRef, producerRef: check.producerRef,
            } : {}) });
          if (!facts.runMonitorRefs?.includes(associationKey)) gaps.push(`check:${required}:monitor-not-attached-or-verified`);
        }
      }
    }
    if (policy.reviews && facts.reviewsSatisfied !== true) gaps.push('required-reviews-missing');
    if (policy.merge && (facts.merged !== true || pr?.state !== 'merged')) gaps.push('required-merge-missing');
  }
  return { verdict: gaps.length ? 'unverified' : 'satisfied', ready: gaps.length === 0, gaps,
    permissions: { publish: false, merge: false, deploy: false }, prUrl: pr?.url ?? null };
}
