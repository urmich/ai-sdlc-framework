import path from 'node:path';
import * as fs from 'node:fs/promises';
import { LIMITS, canonical, choice, digest, id, now, object, requireThat, safeRecord, text } from './core.mjs';
import { exists, immutableJson, listJson, readJson, safePath, updateJson, withLock,
  writeJson } from './files.mjs';
import { legacyExecutionRunKey, sameExecutionIdentity, validateExecutionIdentity, verifyProviderLink } from './provider-adapters.mjs';
import { validateAdapterExecutionIdentity } from './provider-adapters.mjs';
import { assertMonitorRecordSize, validateMonitorEvidence,
  verifyReferencedEvidence } from './monitor-evidence.mjs';
import { validateCheckpoint } from './store.mjs';

const TERMINAL = ['succeeded', 'failed', 'cancelled'];
function nextNotice(record, kind) {
  return {
    status: 'pending',
    kind,
    generation: (record.notice?.generation ?? 0) + 1,
  };
}
export function runKey(run) {
  const identity = validateExecutionIdentity(run.identity ?? run);
  return `run-${digest(identity).slice(0, 40)}`;
}
function monitorRunKeys(identity) {
  const key = runKey(identity);
  if (identity.attemptKind === 'unknown') return [key];
  const current = identity.attemptKind === undefined ? {
    ...identity,
    attemptKind: identity.attemptRef === undefined ? 'not-applicable' : 'known',
  } : identity;
  try {
    validateAdapterExecutionIdentity(current.provider, current);
  } catch (error) {
    // Missing or incompatible adapter proof leaves these filenames distinct.
    if (!['ADAPTER', 'EVIDENCE'].includes(error.code)) throw error;
    return [key];
  }
  // Prove filename equivalence without upgrading the stored identity or evidence.
  return [...new Set([key, runKey(current), legacyExecutionRunKey(current)])];
}
const monitorPath = (store, key) => path.join(store.runtime, 'pipeline-monitors', `${id(key)}.json`);
export const monitorAssociationKey = input => `monitor-association-${digest(
  input.prObservationKey ? {
    runKey: input.runKey, workItemId: input.workItemId,
    prObservationKey: input.prObservationKey, requiredCheckRef: input.requiredCheckRef,
    checkResultRef: input.checkResultRef, producerRef: input.producerRef,
  } : {
    runKey: input.runKey, workItemId: input.workItemId,
    prRecordId: input.prRecordId, checkId: input.checkId,
  }).slice(0, 40)}`;
const associationPath = (store, input) => path.join(store.runtime, 'pipeline-monitor-associations',
  `${monitorAssociationKey(input)}.json`);
async function readStoredMonitor(store, key) {
  return await readJson(monitorPath(store, key), { optional: true, limit: LIMITS.record + 1 }) ??
    await readJson(path.join(store.runtime, 'pipeline-monitors', 'archive', `${id(key)}.json`), { optional: true, limit: LIMITS.record + 1 });
}
const noticeReceiptPath = (store, record) => {
  requireThat(Number.isSafeInteger(record.notice?.generation) &&
    record.notice.generation > 0, 'SCHEMA', 'Monitor notice generation is invalid');
  return path.join(store.runtime, 'pipeline-monitor-notices',
    `${id(record.key)}-${record.notice.generation}.json`);
};
async function deliveredMonitor(store, record) {
  if (!record || record.notice?.status === 'delivered') return record;
  const receipt = await readJson(noticeReceiptPath(store, record), {
    optional: true, limit: LIMITS.record,
  });
  if (!receipt) return record;
  object(receipt, ['schemaVersion', 'runKey', 'identityDigest', 'noticeDigest', 'notice'],
    ['schemaVersion', 'runKey', 'identityDigest', 'noticeDigest', 'notice']);
  object(receipt.notice, ['status', 'kind', 'generation', 'evidenceRef', 'deliveredAt'],
    ['status', 'kind', 'generation', 'evidenceRef', 'deliveredAt']);
  assertMonitorRecordSize(receipt);
  text(receipt.notice.evidenceRef, 'notification evidence');
  requireThat(receipt.schemaVersion === 1 && receipt.runKey === record.key &&
    receipt.identityDigest === digest(record.identity) &&
    receipt.noticeDigest === digest(record.notice) &&
    receipt.notice.status === 'delivered' &&
    receipt.notice.kind === record.notice.kind &&
    receipt.notice.generation === record.notice.generation &&
    Number.isFinite(Date.parse(receipt.notice.deliveredAt)) &&
    new Date(receipt.notice.deliveredAt).toISOString() === receipt.notice.deliveredAt,
  'EVIDENCE', 'Delivery receipt does not match the exact monitor notice');
  return { ...record, notice: receipt.notice };
}
export async function readMonitor(store, key) {
  return deliveredMonitor(store, await readStoredMonitor(store, key));
}
export async function readActiveMonitor(store, key) {
  return deliveredMonitor(store, await readJson(monitorPath(store, key), {
    optional: true,
    limit: LIMITS.record + 1,
  }));
}
export async function withMonitorLocks(store, runKeys, action) {
  const keys = [...new Set(runKeys)].sort();
  for (const key of keys) id(key);
  const acquire = index => index === keys.length ? action() :
    withLock(`${monitorPath(store, keys[index])}.lock`, () =>
      acquire(index + 1));
  return acquire(0);
}
export async function readMonitorAssociation(store, input) {
  return readJson(associationPath(store, input), { optional: true, limit: LIMITS.record + 1 });
}

function currentPr(records, candidate) {
  const matching = records.filter(record => record.type === 'pr-observation' &&
    record.repositoryId === candidate.repositoryId &&
    record.localRepositoryPath === candidate.localRepositoryPath &&
    record.remoteRepositoryURL === candidate.remoteRepositoryURL &&
    record.provider === candidate.provider &&
    record.connection === candidate.connection &&
    record.repositoryRef === candidate.repositoryRef &&
    record.pullRequestRef === candidate.pullRequestRef);
  const newest = matching.sort((left, right) => left.sequence - right.sequence).at(-1);
  if (records.some(other => other.type === 'pr-observation' &&
    other.id !== candidate.id &&
    other.repositoryId === candidate.repositoryId &&
    other.provider === candidate.provider &&
    other.connection === candidate.connection &&
    other.repositoryRef === candidate.repositoryRef &&
    other.pullRequestRef === candidate.pullRequestRef &&
    other.observedAt >= candidate.observedAt &&
    (other.localRepositoryPath !== candidate.localRepositoryPath ||
      other.remoteRepositoryURL !== candidate.remoteRepositoryURL))) return undefined;
  return newest;
}

function validatedCheckAssociation(input, monitor, pr) {
  const fields = ['localRepositoryPath', 'remoteRepositoryURL', 'prObservationKey',
    'requiredCheckRef', 'checkResultRef', 'producerRef', 'testedRevision'];
  for (const field of fields) text(input[field], field);
  requireThat(pr?.type === 'pr-observation' && pr.id === input.prObservationKey &&
    pr.localRepositoryPath === input.localRepositoryPath &&
    pr.remoteRepositoryURL === input.remoteRepositoryURL &&
    pr.sourceRevision === input.sourceRevision &&
    pr.targetRevision === input.targetRevision, 'EVIDENCE',
  'Check association does not identify the exact observed PR, checkout, hosted URL and revisions');
  requireThat(input.prRecordId === pr.id && input.checkId === input.requiredCheckRef,
    'EVIDENCE', 'Required-check definition and observed PR must match the association');
  requireThat(monitor?.key === input.runKey &&
    monitor.capability?.schedulerAvailable === true &&
    monitor.capability?.readAvailable === true &&
    monitor.link?.status === 'verified', 'EVIDENCE',
  'An active monitor with verified provider run link and read capability is required');
  const identity = validateAdapterExecutionIdentity(monitor.identity.provider, monitor.identity);
  requireThat(identity.attemptKind !== 'unknown' && input.producerRef === identity.definitionRef,
    'EVIDENCE', 'Required-check producer and complete execution attempt must be proven');
  const evidence = input.evidence && validateMonitorEvidence(input.evidence);
  requireThat(evidence?.reference && monitor.evidence?.reference &&
    monitor.evidenceVerification?.verified === true &&
    digest(monitor.evidence?.reference) === digest(evidence.reference),
  'EVIDENCE', 'Exact check requires verified bounded result evidence from this poll');
  const matching = monitor.checkResults?.filter(result =>
    result.checkResultRef === input.checkResultRef);
  requireThat(matching?.length === 1 &&
    matching[0].requiredCheckRef === input.requiredCheckRef &&
    matching[0].producerRef === input.producerRef &&
    matching[0].testedRevision === input.testedRevision &&
    matching[0].localRepositoryPath === pr.localRepositoryPath &&
    matching[0].remoteRepositoryURL === pr.remoteRepositoryURL &&
    matching[0].repositoryRef === pr.repositoryRef &&
    matching[0].pullRequestRef === pr.pullRequestRef &&
    matching[0].sourceRepositoryURL === pr.sourceRepositoryURL &&
    matching[0].sourceRevision === pr.sourceRevision &&
    matching[0].targetRevision === pr.targetRevision &&
    matching[0].evidenceRef === input.evidenceRef &&
    matching[0].status === 'succeeded' &&
    monitor.runStatus === 'succeeded', 'EVIDENCE',
  'Check result and required-check producer must match one successful result of this execution attempt');
  requireThat(input.testedRevision === pr.sourceRevision ||
    (input.mergeContext?.sourceRevision === pr.sourceRevision &&
      input.mergeContext?.targetRevision === pr.targetRevision &&
      input.mergeContext?.mergeRevision === input.testedRevision &&
      input.mergeContext?.evidenceRef &&
      digest(matching[0].mergeContext) === digest(input.mergeContext)), 'EVIDENCE',
  'Provider must prove the tested source revision or generated merge context');
  if (input.mergeContext !== undefined) {
    object(input.mergeContext, ['sourceRevision', 'targetRevision',
      'mergeRevision', 'evidenceRef'],
    ['sourceRevision', 'targetRevision', 'mergeRevision', 'evidenceRef']);
    text(input.mergeContext.evidenceRef, 'merge context evidence');
  }
  return identity;
}
export async function associateMonitor(store, input) {
  object(input, ['runKey', 'workItemId', 'prRecordId', 'checkId', 'sourceRevision', 'targetRevision', 'evidenceRef',
    'prObservationKey', 'localRepositoryPath', 'remoteRepositoryURL', 'requiredCheckRef',
    'checkResultRef', 'producerRef', 'testedRevision', 'mergeContext', 'evidence'],
  ['runKey', 'workItemId', 'prRecordId', 'checkId', 'sourceRevision', 'targetRevision', 'evidenceRef']);
  for (const field of ['workItemId', 'prRecordId', 'checkId', 'sourceRevision', 'targetRevision', 'evidenceRef']) text(input[field], field);
  return withMonitorLocks(store, [input.runKey], () =>
    store.transaction(input.workItemId, async tx => {
      const monitor = await readActiveMonitor(store, input.runKey);
      requireThat(monitor, 'MONITOR', 'Active monitor record is unavailable for PR association');
      const pr = tx.get(input.prRecordId);
      requireThat(pr && pr.provider === monitor.identity.provider &&
        pr.connection === monitor.identity.connection, 'EVIDENCE',
      'Monitor provider/connection does not match the PR');
      requireThat(pr.sourceRevision === input.sourceRevision &&
        pr.targetRevision === input.targetRevision, 'EVIDENCE',
      'Monitor association revisions do not match the PR observation');
      let identity;
      if (input.prObservationKey !== undefined) {
        requireThat(currentPr(tx.all(), pr)?.id === pr.id, 'STALE',
          'Monitor association belongs to an obsolete PR observation');
        identity = validatedCheckAssociation(input, monitor, pr);
      } else {
        requireThat(pr.type === 'pr', 'EVIDENCE',
          'Current PR checks require the exact PR observation and check result');
      }
      const file = associationPath(store, input);
      const existing = await readJson(file, { optional: true, limit: LIMITS.record });
      if (existing) {
        const { associatedAt, schemaVersion, key, ...stored } = existing;
        void associatedAt; void schemaVersion; void key;
        const expected = input.prObservationKey === undefined ?
          { runKey: monitor.key, workItemId: input.workItemId,
            prRecordId: input.prRecordId, checkId: input.checkId,
            sourceRevision: input.sourceRevision, targetRevision: input.targetRevision,
            evidenceRef: input.evidenceRef } :
          { ...input, runKey: monitor.key, identity, evidenceVerified: true };
        requireThat(digest(stored) === digest(expected), 'ID_CONFLICT',
          'Existing check-result association has contradictory evidence');
        return existing;
      }
      const association = safeRecord({ schemaVersion: 1,
        key: monitorAssociationKey(input), runKey: monitor.key,
        ...(input.prObservationKey === undefined ? {
          workItemId: input.workItemId, prRecordId: input.prRecordId,
          checkId: input.checkId, sourceRevision: input.sourceRevision,
          targetRevision: input.targetRevision, evidenceRef: input.evidenceRef,
        } : { ...input, identity, evidenceVerified: true }),
        associatedAt: now(store.clock) });
      assertMonitorRecordSize(association);
      await immutableJson(file, association);
      return association;
    }));
}
export async function attachMonitor(store, input) {
  object(input, ['identity', 'origin', 'reportingReceiptId', 'workItemId', 'cycleId',
    'candidateDigest', 'environment', 'prRecordId', 'checkId', 'sourceRevision', 'targetRevision',
    'associationEvidenceRef', 'schedulerAvailable', 'readAvailable'],
  ['identity', 'origin', 'schedulerAvailable', 'readAvailable']);
  const identity = validateExecutionIdentity(input.identity);
  choice(input.origin, ['framework', 'user-reported'], 'trigger origin');
  requireThat(typeof input.schedulerAvailable === 'boolean' && typeof input.readAvailable === 'boolean',
    'INPUT', 'Monitor capabilities must be explicit booleans');
  if (input.origin === 'user-reported') text(input.reportingReceiptId, 'reporting receipt');
  const prFields = ['prRecordId', 'checkId', 'sourceRevision', 'targetRevision', 'associationEvidenceRef'];
  if (prFields.some(field => input[field] !== undefined)) {
    for (const field of prFields) text(input[field], field);
    text(input.workItemId, 'work item ID');
  }
  const key = runKey(identity);
  const keys = monitorRunKeys(identity);
  const capable = input.schedulerAvailable === true && input.readAvailable === true;
  const file = monitorPath(store, key);
  const record = await withMonitorLocks(store, keys, async () => {
    const existing = [];
    for (const candidateKey of keys) {
      const active = await readActiveMonitor(store, candidateKey);
      if (active?.identity) existing.push({ record: active, active: true });
      const archived = await deliveredMonitor(store, await readJson(path.join(store.runtime,
        'pipeline-monitors', 'archive', `${candidateKey}.json`), {
        optional: true,
        limit: LIMITS.record + 1,
      }));
      if (archived) existing.push({ record: archived, active: false });
      for (const record of [active, archived]) {
        if (!record?.identity) continue;
        requireThat(record.key === candidateKey &&
          keys.includes(runKey(record.identity)), 'ID_CONFLICT',
        'Existing monitor does not identify an equivalent execution');
      }
    }
    requireThat(existing.filter(candidate => candidate.active).length <= 1,
      'ID_CONFLICT', 'Multiple active monitors refer to the same execution');
    const found = existing.find(candidate => candidate.active) ?? existing[0];
    if (found) {
      requireThat(found.record.origin === input.origin, 'ID_CONFLICT',
        'Existing monitor trigger origin cannot be relabeled');
      return found.record;
    }
    const previous = await readJson(file, {
      optional: true,
      limit: LIMITS.record + 1,
    });
    if (previous?.identity) {
      requireThat(previous.origin === input.origin, 'ID_CONFLICT', 'Existing monitor trigger origin cannot be relabeled');
      return previous;
    }
    const { schedulerAvailable, readAvailable, prRecordId, checkId, sourceRevision, targetRevision,
      associationEvidenceRef, identity: ignoredIdentity, ...details } = input;
    void ignoredIdentity;
    const created = safeRecord({ schemaVersion: 1,
      revision: (previous?.revision ?? 0) + 1, key,
      identity, ...details,
      pollIntervalSeconds: 60, monitorStatus: capable ? 'pending' : 'blocked', workerId: null, claimGeneration: 0,
      pollGeneration: 0, inFlight: false, runStatus: 'unknown',
      nextPollAt: now(store.clock), lastPollStartedAt: null, lastSuccessfulPollAt: null,
      link: { status: 'pending', generation: 0 },
      notice: { status: 'pending', kind: 'attached', generation: 1 }, gapCount: 0,
      capability: { schedulerAvailable, readAvailable } });
    assertMonitorRecordSize(created);
    await writeJson(file, created);
    return created;
  });
  if (input.prRecordId) await associateMonitor(store, { runKey: record.key, workItemId: input.workItemId,
    prRecordId: input.prRecordId, checkId: input.checkId, sourceRevision: input.sourceRevision,
    targetRevision: input.targetRevision, evidenceRef: input.associationEvidenceRef });
  return record;
}
export async function claimMonitor(store, input) {
  object(input, ['runKey', 'workerId', 'replaceInterrupted'], ['runKey', 'workerId']);
  id(input.workerId);
  return updateMonitor(store, input.runKey, record => {
    requireThat(record.capability.schedulerAvailable === true && record.capability.readAvailable === true,
      'CAPABILITY', 'Monitoring scheduler/read capability is unavailable');
    requireThat(!TERMINAL.includes(record.runStatus), 'MONITOR', 'Run is terminal; deliver its notice instead');
    requireThat(!record.workerId || record.workerId === input.workerId ||
      (input.replaceInterrupted === true && ['interrupted', 'suspended'].includes(record.monitorStatus)), 'LOCK_BUSY', 'Another monitor worker owns this run');
    if (record.workerId === input.workerId && !['interrupted', 'suspended'].includes(record.monitorStatus)) return record;
    if (record.workerId !== input.workerId) record.claimGeneration++;
    record.workerId = input.workerId;
    record.inFlight = false;
    record.monitorStatus = 'pending';
    record.nextPollAt = now(store.clock);
    return record;
  });
}
export async function refreshMonitorCapabilities(store, input) {
  object(input, ['runKey', 'schedulerAvailable', 'readAvailable', 'evidenceRef'],
    ['runKey', 'schedulerAvailable', 'readAvailable', 'evidenceRef']);
  requireThat(typeof input.schedulerAvailable === 'boolean' && typeof input.readAvailable === 'boolean',
    'INPUT', 'Monitor capabilities must be explicit booleans');
  text(input.evidenceRef, 'capability evidence reference');
  return mutateActiveMonitor(store, input.runKey, record => {
    const changed = record.capability.schedulerAvailable !== input.schedulerAvailable ||
      record.capability.readAvailable !== input.readAvailable;
    record.capability = { schedulerAvailable: input.schedulerAvailable, readAvailable: input.readAvailable };
    record.capabilityEvidenceRef = input.evidenceRef;
    record.capabilityUpdatedAt = now(store.clock);
    if (changed && !TERMINAL.includes(record.runStatus)) {
      record.claimGeneration++;
      record.workerId = null;
      record.inFlight = false;
      record.monitorStatus = input.schedulerAvailable && input.readAvailable ? 'pending' : 'blocked';
      record.nextPollAt = now(store.clock);
      record.notice = nextNotice(record, 'capability');
    }
    return safeRecord(record);
  }, { invalidatePrFacts: !input.schedulerAvailable || !input.readAvailable });
}
function verifyClaim(record, input) {
  requireThat(typeof input.workerId === 'string' && typeof record.workerId === 'string' &&
    record.workerId === input.workerId && record.claimGeneration === input.claimGeneration,
    'STALE', 'Monitor callback belongs to an obsolete worker claim');
  requireThat(record.capability.schedulerAvailable === true && record.capability.readAvailable === true,
    'CAPABILITY', 'Monitoring scheduler/read capability is unavailable');
}
export async function beginPoll(store, input) {
  object(input, ['runKey', 'workerId', 'claimGeneration'], ['runKey', 'workerId', 'claimGeneration']);
  return updateMonitor(store, input.runKey, record => {
    verifyClaim(record, input);
    requireThat(!record.inFlight && !TERMINAL.includes(record.runStatus), 'MONITOR', 'Run is terminal or already has a poll in flight');
    requireThat(store.clock.now() >= Date.parse(record.nextPollAt), 'NOT_DUE', 'Poll is not yet due');
    if (store.clock.now() - Date.parse(record.nextPollAt) >= 60000) record.gapCount++;
    record.pollGeneration = (record.pollGeneration ?? 0) + 1;
    record.inFlight = true; record.lastPollStartedAt = now(store.clock);
    record.scheduledPollAt = record.nextPollAt;
    return record;
  });
}
export async function observeMonitor(store, input) {
  object(input, ['runKey', 'workerId', 'claimGeneration', 'identity', 'status',
    'evidenceRef', 'error', 'pollGeneration', 'evidence', 'evidenceFilePath',
    'checkResults', 'checkObservation'],
  ['runKey', 'workerId', 'claimGeneration', 'identity', 'pollGeneration']);
  const identity = validateExecutionIdentity(input.identity);
  requireThat(input.evidenceFilePath === undefined || input.evidence?.reference,
    'INPUT', 'Evidence file requires bounded reference metadata');
  requireThat(!input.error || (input.status === undefined &&
    input.evidence === undefined && input.checkResults === undefined &&
    input.checkObservation === undefined),
  'INPUT', 'A failed poll cannot also report a successful result');
  const evidence = input.evidence === undefined ? undefined :
    validateMonitorEvidence(input.evidence);
  const evidenceVerification = evidence?.reference ?
    input.evidenceFilePath ? await verifyReferencedEvidence(evidence.reference,
      { filePath: input.evidenceFilePath,
        verifyProviderVersion: store.verifyProviderVersion }) :
      { verified: false, reason: 'evidence-file-unavailable' } :
    undefined;
  let checkResults;
  if (input.checkResults !== undefined || input.checkObservation !== undefined) {
    requireThat(evidenceVerification?.verified === true, 'EVIDENCE',
      'Passing check results require matching immutable bounded evidence');
    // Only the provider adapter can attest which check result the immutable run evidence contains.
    requireThat(typeof store.verifyCheckResults === 'function', 'ADAPTER',
      'Passing check results require a trusted hosting-service check verifier');
    const verified = await store.verifyCheckResults({
      identity, status: input.status, evidenceReference: evidence.reference,
      adapterObservation: input.checkObservation,
    });
    object(verified, ['identity', 'status', 'evidenceReference', 'checkResults'],
      ['identity', 'status', 'evidenceReference', 'checkResults']);
    requireThat(sameExecutionIdentity(identity, verified.identity) &&
      verified.status === input.status &&
      digest(validateMonitorEvidence({ reference: verified.evidenceReference }).reference) ===
        digest(evidence.reference), 'EVIDENCE',
    'Provider check result does not match this execution, status, or immutable evidence');
    checkResults = verified.checkResults;
    requireThat(input.checkResults === undefined ||
      digest(input.checkResults) === digest(checkResults), 'EVIDENCE',
    'Requested check results do not match the trusted provider observation');
    requireThat(Array.isArray(checkResults) && checkResults.length > 0 &&
      checkResults.length <= 10,
    'EVIDENCE', 'Observed check results require a verified bounded evidence reference');
    const seen = new Set();
    for (const result of checkResults) {
      object(result, ['requiredCheckRef', 'checkResultRef', 'producerRef', 'displayName',
        'testedRevision', 'evidenceRef', 'status', 'mergeContext',
        'localRepositoryPath', 'remoteRepositoryURL', 'repositoryRef',
        'pullRequestRef', 'sourceRepositoryURL', 'sourceRevision', 'targetRevision'],
      ['requiredCheckRef', 'checkResultRef', 'producerRef',
        'testedRevision', 'evidenceRef', 'status', 'localRepositoryPath',
        'remoteRepositoryURL', 'repositoryRef', 'pullRequestRef',
        'sourceRevision', 'targetRevision']);
      for (const field of ['requiredCheckRef', 'checkResultRef', 'producerRef',
        'testedRevision', 'evidenceRef', 'localRepositoryPath',
        'remoteRepositoryURL', 'repositoryRef', 'pullRequestRef',
        'sourceRevision', 'targetRevision']) text(result[field], field);
      if (result.sourceRepositoryURL !== undefined) text(result.sourceRepositoryURL,
        'fork source repository URL');
      if (result.displayName !== undefined) text(result.displayName, 'check display name');
      choice(result.status, [...TERMINAL, 'pending'], 'check result status');
      if (result.mergeContext !== undefined) {
        object(result.mergeContext, ['sourceRevision', 'targetRevision',
          'mergeRevision', 'evidenceRef'],
        ['sourceRevision', 'targetRevision', 'mergeRevision', 'evidenceRef']);
        for (const field of ['sourceRevision', 'targetRevision',
          'mergeRevision', 'evidenceRef']) text(result.mergeContext[field], field);
        requireThat(result.testedRevision === result.mergeContext.mergeRevision,
          'EVIDENCE', 'Generated merge check must test the proven merge revision');
      }
      requireThat(!seen.has(result.checkResultRef), 'EVIDENCE',
        'Duplicate provider check-result identity is ambiguous');
      seen.add(result.checkResultRef);
    }
    requireThat(input.status === 'succeeded', 'EVIDENCE',
      'Successful check results require the matching terminal execution');
  }
  return updateMonitor(store, input.runKey, record => {
    verifyClaim(record, input);
    requireThat(record.inFlight, 'MONITOR', 'Begin a poll before recording its result');
    requireThat(input.pollGeneration === record.pollGeneration, 'STALE',
      'Monitor callback belongs to an older poll');
    requireThat(sameExecutionIdentity(record.identity, identity), 'EVIDENCE',
      'Observation is for a different execution');
    const old = record.runStatus;
    if (input.error) {
      text(input.error, 'read failure', 300);
      record.monitorStatus = 'degraded'; record.lastError = input.error;
    } else {
      choice(input.status, ['queued', 'running', 'waiting-approval', ...TERMINAL], 'run status');
      requireThat(input.evidenceRef !== undefined || evidence !== undefined, 'INPUT',
        'Poll requires a sanitized reference or bounded evidence');
      if (input.evidenceRef !== undefined) text(input.evidenceRef, 'provider observation reference');
      record.runStatus = input.status;
      if (input.evidenceRef !== undefined) record.evidenceRef = input.evidenceRef;
      if (evidence !== undefined) record.evidence = evidence;
      else delete record.evidence;
      if (evidenceVerification !== undefined) record.evidenceVerification = evidenceVerification;
      else delete record.evidenceVerification;
      if (checkResults !== undefined) record.checkResults = checkResults;
      else delete record.checkResults;
      record.lastSuccessfulPollAt = now(store.clock); delete record.lastError;
      record.monitorStatus = TERMINAL.includes(input.status) ? 'completed' : 'active';
    }
    record.inFlight = false;
    const planned = Date.parse(record.scheduledPollAt) + 60000;
    const missed = Math.max(0, Math.floor((store.clock.now() - planned) / 60000) + 1);
    record.nextPollAt = TERMINAL.includes(record.runStatus) ? null : new Date(planned + missed * 60000).toISOString();
    if (missed) record.gapCount += missed;
    if (old !== record.runStatus || TERMINAL.includes(record.runStatus) || input.error) {
      record.notice = nextNotice(record,
        TERMINAL.includes(record.runStatus) ? 'terminal' : 'changed');
    }
    return safeRecord(record);
  });
}
function updateMonitor(store, runKeyValue, update) {
  return updateJson(monitorPath(store, runKeyValue), {}, async record => {
    const after = await update(record);
    return assertMonitorRecordSize({ ...after, revision: after.revision + 1 });
  }, { limit: LIMITS.record });
}
export async function verifyMonitorLink(store, input) {
  object(input, ['runKey', 'adapterId', 'observation', 'evidenceRef'],
    ['runKey', 'adapterId', 'observation', 'evidenceRef']);
  text(input.adapterId, 'provider adapter ID');
  const pending = await mutateActiveMonitor(store, input.runKey, record => {
      record.link = {
        status: 'pending',
        generation: (record.link?.generation ?? 0) + 1,
        adapterId: input.adapterId,
      };
      record.notice = nextNotice(record, 'link');
      return record;
    }, { invalidatePrFacts: true });
  const verification = await verifyProviderLink(input.adapterId,
    pending.identity, input.observation);
  return mutateActiveMonitor(store, input.runKey, record => {
    requireThat(sameExecutionIdentity(record.identity, pending.identity),
      'STALE', 'Monitor identity changed during link verification');
    if (record.link.generation !== pending.link.generation) return record;
    record.link = {
      status: verification.verified ? 'verified' : 'unverified',
      verifiedAt: now(store.clock),
      evidenceRef: text(input.evidenceRef, 'link evidence'),
      adapterId: input.adapterId,
      generation: pending.link.generation,
    };
    if (verification.verified) {
      record.link.url = verification.url;
      record.link.kind = verification.kind;
    } else {
      record.link.reason = verification.reason;
    }
    record.notice = nextNotice(record,
      TERMINAL.includes(record.runStatus) ? 'terminal' : 'link');
    return record;
  });
}
async function invalidateAssociatedPrFacts(store, runKey) {
  const directory = path.join(store.runtime, 'pipeline-monitor-associations');
  const associations = [];
  for (const name of await listJson(directory)) {
    const association = await readJson(await safePath(directory, name), {
      limit: LIMITS.record,
    });
    if (association.runKey === runKey) associations.push(association);
  }
  if (!associations.length) return;
  await store.withWorkItemLocks(
    associations.map(association => association.workItemId),
    async locked => {
      for (const workItemId of new Set(associations.map(association =>
        association.workItemId))) {
        await locked.preflight(workItemId);
      }
      for (const association of associations) {
        await locked.transaction(association.workItemId, tx => {
          const facts = tx.get(`facts-${association.prRecordId}`);
          if (!facts?.runMonitorRefs?.includes(association.key)) return;
          facts.runMonitorRefs = facts.runMonitorRefs.filter(reference =>
            reference !== association.key);
          tx.put(facts);
        });
      }
    });
}
async function mutateActiveMonitor(store, runKey, update, {
  invalidatePrFacts = false,
} = {}) {
  const file = monitorPath(store, runKey);
  return withLock(`${file}.lock`, async () => {
    const before = await readJson(file, {
      optional: true,
      limit: LIMITS.record,
    });
    requireThat(before, 'MONITOR',
      'Active monitor record is unavailable');
    const after = await update(structuredClone(before));
    after.revision = before.revision + 1;
    assertMonitorRecordSize(after);
    if (invalidatePrFacts) {
      await invalidateAssociatedPrFacts(store, runKey);
    }
    await writeJson(file, after);
    return after;
  });
}
export async function monitorNotice(store, input) {
  object(input, ['runKey', 'deliveredRef', 'noticeGeneration'], ['runKey']);
  const record = input.deliveredRef === undefined ?
    await readMonitor(store, input.runKey) :
    await withMonitorLocks(store, [input.runKey], async () => {
      const stored = await readStoredMonitor(store, input.runKey);
      requireThat(stored, 'MONITOR', 'Monitor record is unavailable');
      const current = await deliveredMonitor(store, stored);
      requireThat(Number.isSafeInteger(input.noticeGeneration) &&
        input.noticeGeneration === current.notice.generation,
      'STALE', 'Notification acknowledgement belongs to an obsolete notice');
      const evidenceRef = text(input.deliveredRef, 'notification evidence');
      const notice = { ...current.notice, status: 'delivered', evidenceRef,
        deliveredAt: now(store.clock) };
      const receipt = assertMonitorRecordSize({
        schemaVersion: 1, runKey: stored.key,
        identityDigest: digest(stored.identity),
        noticeDigest: digest(stored.notice), notice,
      });
      if (current.notice.status === 'delivered') {
        requireThat(current.notice.evidenceRef === evidenceRef, 'ID_CONFLICT',
          'Notification delivery was already acknowledged with different evidence');
        return current;
      }
      requireThat(current.notice.status === 'pending' &&
        await readActiveMonitor(store, input.runKey), 'MONITOR',
      'Only an active pending monitor notice can acknowledge first delivery');
      const after = { ...stored, notice, revision: stored.revision + 1 };
      // A full observation must never consume the space needed to acknowledge it.
      // Keep its bytes intact and bind overflow delivery metadata to this exact notice.
      if (Buffer.byteLength(`${canonical(after)}\n`) > LIMITS.record) {
        await immutableJson(noticeReceiptPath(store, stored), receipt,
          { fault: store.fault });
        return { ...stored, notice };
      }
      assertMonitorRecordSize(after);
      await writeJson(monitorPath(store, input.runKey), after, { fault: store.fault });
      return after;
    });
  requireThat(record, 'MONITOR', 'Monitor record is unavailable');
  return { runKey: record.key, origin: record.origin, status: record.runStatus, monitorStatus: record.monitorStatus,
    link: record.link, notice: record.notice, nextPollAt: record.nextPollAt, gapCount: record.gapCount,
    message: `${record.origin === 'user-reported' ? 'Attached monitoring to user-reported' : 'Monitoring framework-triggered'} execution ${record.identity.executionRef}${record.identity.definitionRef ? ` of definition ${record.identity.definitionRef}` : ''}: ${record.runStatus}. ${record.monitorStatus === 'active' ? 'Polling every 60 seconds.' : `Monitoring ${record.monitorStatus}.`} ${record.link.status === 'verified' ? record.link.url : 'Run link verification pending or unavailable.'}` };
}
export async function interruptMonitor(store, input) {
  object(input, ['runKey', 'reason'], ['runKey', 'reason']);
  return updateMonitor(store, input.runKey, record => {
    record.monitorStatus = 'interrupted'; record.inFlight = false; record.claimGeneration++;
    record.gapCount++; record.lastError = text(input.reason, 'interruption reason', 300);
    record.notice = nextNotice(record, 'interrupted');
    return record;
  });
}
export async function dueMonitors(store) {
  const directory = path.join(store.runtime, 'pipeline-monitors');
  const due = [];
  for (const name of await listJson(directory)) {
    const record = await readJson(await safePath(directory, name), { limit: LIMITS.record });
    if (!TERMINAL.includes(record.runStatus) && record.nextPollAt && Date.parse(record.nextPollAt) <= store.clock.now()) {
      due.push({ runKey: record.key, workerId: record.workerId, claimGeneration: record.claimGeneration,
        inFlight: record.inFlight, dueAt: record.nextPollAt, gapDetected: store.clock.now() - Date.parse(record.nextPollAt) >= 60000 });
    }
  }
  return due;
}
async function monitorDependencyRecords(store, workItemId) {
  // This is retention inspection, not evidence admission: no live checkout,
  // result projection or refreshed authority is needed to discover consumers.
  const metadata = await store.metadata(workItemId);
  id(metadata.coordinatorId);
  requireThat(Array.isArray(metadata.members) && metadata.members.length > 0 &&
    metadata.members.some(member => member.repositoryId === metadata.coordinatorId),
  'BINDING', 'Durable monitor dependency repository mapping is unavailable');
  for (const member of metadata.members) {
    id(member.repositoryId);
    requireThat(typeof member.root === 'string' && path.isAbsolute(member.root) &&
      typeof member.commonDir === 'string' && path.isAbsolute(member.commonDir) &&
      typeof member.branch === 'string' && member.branch.startsWith('refs/heads/'),
    'BINDING', 'Durable monitor dependency repository identity is invalid');
  }
  const checkpoint = await readJson(path.join(store.workPath(workItemId),
    'checkpoint.json'), { optional: true, limit: LIMITS.checkpoint });
  requireThat(checkpoint, 'RECOVERY',
    'Retain monitor evidence until missing dependency state is recovered');
  validateCheckpoint(checkpoint);
  requireThat(checkpoint.workItemId === workItemId, 'BINDING',
    'Monitor dependency checkpoint belongs to another work item');
  const references = [...checkpoint.decisionRefs, ...checkpoint.operationRefs,
    ...checkpoint.blockerRefs,
    ...(checkpoint.validationCycleRef ? [checkpoint.validationCycleRef] : [])];
  const directory = path.join(store.workPath(workItemId), 'records');
  try {
    requireThat((await fs.stat(directory)).isDirectory(), 'RECOVERY',
      'Monitor dependency records are unavailable');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // Initialization creates no records directory until the first record write.
    requireThat(checkpoint.revision === 0 && !references.length &&
      checkpoint.artifactGeneration === 0 && checkpoint.policyGeneration === 0 &&
      checkpoint.phase === 'requirements' && checkpoint.lifecycleStatus === 'active',
    'RECOVERY', 'Retain monitor evidence until missing dependency storage is recovered');
  }
  const records = await store.records(workItemId);
  requireThat(references.every(reference => records.some(record =>
    record.id === reference)), 'RECOVERY',
  'Retain monitor evidence until missing dependency records are recovered');
  requireThat(!await exists(store.recoveryPath(workItemId)),
    'RECOVERY', 'Retain monitor evidence needed for incomplete recovery');
  return records;
}
export async function pruneMonitor(store, input) {
  object(input, ['runKey'], ['runKey']);
  const file = monitorPath(store, input.runKey);
  return withLock(`${file}.lock`, async () => {
    const record = await readJson(file, { optional: true, limit: LIMITS.record });
    if (!record) return { archived: false, reason: 'No active monitor record exists.' };
    requireThat(record.key === input.runKey, 'EVIDENCE',
      'Active monitor identity disagrees with its storage key');
    const delivered = await deliveredMonitor(store, record);
    requireThat(TERMINAL.includes(record.runStatus) && delivered.notice.status === 'delivered', 'MONITOR', 'Retain nonterminal runs and undelivered completion notices');
    const directory = path.join(store.runtime, 'pipeline-monitor-associations');
    const associations = [];
    for (const name of await listJson(directory)) {
      const association = await readJson(await safePath(directory, name), {
        limit: LIMITS.record,
      });
      object(association, ['schemaVersion', 'key', 'runKey', 'workItemId',
        'prRecordId', 'checkId', 'sourceRevision', 'targetRevision', 'evidenceRef',
        'associatedAt', 'prObservationKey', 'localRepositoryPath',
        'remoteRepositoryURL', 'requiredCheckRef', 'checkResultRef', 'producerRef',
        'testedRevision', 'mergeContext', 'evidence', 'identity', 'evidenceVerified'],
      ['schemaVersion', 'key', 'runKey', 'workItemId', 'prRecordId', 'checkId',
        'sourceRevision', 'targetRevision', 'evidenceRef', 'associatedAt']);
      requireThat(association.schemaVersion === 1 &&
        association.key === monitorAssociationKey(association) &&
        name === `${association.key}.json`, 'EVIDENCE',
      'Monitor dependency association identity is inconsistent');
      id(association.workItemId);
      id(association.runKey);
      assertMonitorRecordSize(association);
      if (association.runKey === record.key) associations.push(association);
    }
    let entries;
    try {
      entries = await fs.readdir(path.join(store.runtime, 'work-items'),
        { withFileTypes: true });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      entries = [];
    }
    requireThat(!entries.some(entry => entry.isSymbolicLink()), 'PATH',
      'Work-item dependency storage must not traverse symlinks');
    const workItemIds = [...new Set([
      ...entries.filter(entry => entry.isDirectory()).map(entry => id(entry.name)),
      ...associations.map(association => association.workItemId),
      ...(record.workItemId ? [record.workItemId] : []),
    ])];
    return store.withWorkItemLocks(workItemIds, async () => {
      for (const workItemId of workItemIds) {
        const records = await monitorDependencyRecords(store, workItemId);
        const references = associations.filter(item => item.workItemId === workItemId);
        const dependent = references.some(association => {
          const pr = records.find(item => item.id === association.prRecordId);
          return pr?.type === 'pr-observation' &&
            currentPr(records, pr)?.id === pr.id;
        }) || records.some(item =>
          [record.key, ...references.map(reference => reference.key)]
            .some(key => JSON.stringify(item).includes(key)));
        requireThat(!dependent, 'MONITOR',
          'Retain a monitor needed for PR readiness, action, audit or recovery');
      }
      assertMonitorRecordSize(record);
      await immutableJson(path.join(store.runtime, 'pipeline-monitors',
        'archive', `${record.key}.json`), record);
      await fs.unlink(file);
      return { archived: true, runKey: record.key,
        evidence: 'Terminal observation and delivered notification remain retrievable in the archive.' };
    });
  });
}
