import path from 'node:path';
import * as fs from 'node:fs/promises';
import { LIMITS, choice, digest, id, now, object, requireThat, safeRecord, text } from './core.mjs';
import { immutableJson, listJson, readJson, safePath, updateJson, withLock,
  writeJson } from './files.mjs';
import { sameExecutionIdentity, validateExecutionIdentity, verifyProviderLink } from './provider-adapters.mjs';

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
const monitorPath = (store, key) => path.join(store.runtime, 'pipeline-monitors', `${id(key)}.json`);
export const monitorAssociationKey = input => `monitor-association-${digest({
  runKey: input.runKey, workItemId: input.workItemId, prRecordId: input.prRecordId, checkId: input.checkId,
}).slice(0, 40)}`;
const associationPath = (store, input) => path.join(store.runtime, 'pipeline-monitor-associations',
  `${monitorAssociationKey(input)}.json`);
export async function readMonitor(store, key) {
  return await readJson(monitorPath(store, key), { optional: true, limit: LIMITS.record }) ??
    await readJson(path.join(store.runtime, 'pipeline-monitors', 'archive', `${id(key)}.json`), { optional: true, limit: LIMITS.record });
}
export async function readActiveMonitor(store, key) {
  return readJson(monitorPath(store, key), {
    optional: true,
    limit: LIMITS.record,
  });
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
  return readJson(associationPath(store, input), { optional: true, limit: LIMITS.record });
}
export async function associateMonitor(store, input) {
  object(input, ['runKey', 'workItemId', 'prRecordId', 'checkId', 'sourceRevision', 'targetRevision', 'evidenceRef'],
    ['runKey', 'workItemId', 'prRecordId', 'checkId', 'sourceRevision', 'targetRevision', 'evidenceRef']);
  for (const field of ['workItemId', 'prRecordId', 'checkId', 'sourceRevision', 'targetRevision', 'evidenceRef']) text(input[field], field);
  const monitor = await readMonitor(store, input.runKey);
  requireThat(monitor, 'MONITOR', 'Monitor record is unavailable for PR association');
  const state = await store.load(input.workItemId);
  const pr = state.records.find(record => record.id === input.prRecordId && record.type === 'pr');
  requireThat(pr && pr.provider === monitor.identity.provider &&
    pr.connection === monitor.identity.connection,
    'EVIDENCE', 'Monitor provider/connection does not match the PR');
  requireThat(pr.sourceRevision === input.sourceRevision && pr.targetRevision === input.targetRevision,
    'EVIDENCE', 'Monitor association revisions do not match the current PR record');
  const file = associationPath(store, input);
  const existing = await readJson(file, { optional: true, limit: LIMITS.record });
  if (existing) {
    for (const field of ['runKey', 'workItemId', 'prRecordId', 'checkId', 'sourceRevision', 'targetRevision']) {
      requireThat(existing[field] === input[field], 'ID_CONFLICT', 'Existing monitor association has conflicting PR context');
    }
    return existing;
  }
  const association = safeRecord({ schemaVersion: 1, key: monitorAssociationKey(input),
    runKey: monitor.key, workItemId: input.workItemId,
    prRecordId: input.prRecordId, checkId: input.checkId, sourceRevision: input.sourceRevision,
    targetRevision: input.targetRevision, evidenceRef: input.evidenceRef, associatedAt: now(store.clock) });
  await immutableJson(file, association);
  return association;
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
  const capable = input.schedulerAvailable === true && input.readAvailable === true;
  const file = monitorPath(store, key);
  const record = await withLock(`${file}.lock`, async () => {
    const archived = await readJson(path.join(store.runtime,
      'pipeline-monitors', 'archive', `${key}.json`), {
      optional: true,
      limit: LIMITS.record,
    });
    if (archived) {
      requireThat(archived.origin === input.origin, 'ID_CONFLICT',
        'Archived trigger origin cannot be relabeled');
      return archived;
    }
    const previous = await readJson(file, {
      optional: true,
      limit: LIMITS.record,
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
    await writeJson(file, created);
    return created;
  });
  if (input.prRecordId) await associateMonitor(store, { runKey: key, workItemId: input.workItemId,
    prRecordId: input.prRecordId, checkId: input.checkId, sourceRevision: input.sourceRevision,
    targetRevision: input.targetRevision, evidenceRef: input.associationEvidenceRef });
  return record;
}
export async function claimMonitor(store, input) {
  object(input, ['runKey', 'workerId', 'replaceInterrupted'], ['runKey', 'workerId']);
  id(input.workerId);
  return updateJson(monitorPath(store, input.runKey), {}, record => {
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
  }, { limit: LIMITS.record });
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
  return updateJson(monitorPath(store, input.runKey), {}, record => {
    verifyClaim(record, input);
    requireThat(!record.inFlight && !TERMINAL.includes(record.runStatus), 'MONITOR', 'Run is terminal or already has a poll in flight');
    requireThat(store.clock.now() >= Date.parse(record.nextPollAt), 'NOT_DUE', 'Poll is not yet due');
    if (store.clock.now() - Date.parse(record.nextPollAt) >= 60000) record.gapCount++;
    record.pollGeneration = (record.pollGeneration ?? 0) + 1;
    record.inFlight = true; record.lastPollStartedAt = now(store.clock);
    record.scheduledPollAt = record.nextPollAt;
    return record;
  }, { limit: LIMITS.record });
}
export async function observeMonitor(store, input) {
  object(input, ['runKey', 'workerId', 'claimGeneration', 'identity', 'status',
    'evidenceRef', 'error', 'pollGeneration'],
  ['runKey', 'workerId', 'claimGeneration', 'identity', 'pollGeneration']);
  const identity = validateExecutionIdentity(input.identity);
  return updateJson(monitorPath(store, input.runKey), {}, record => {
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
      text(input.evidenceRef, 'provider observation reference');
      record.runStatus = input.status; record.evidenceRef = input.evidenceRef;
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
    safeRecord(after);
    if (invalidatePrFacts) {
      await invalidateAssociatedPrFacts(store, runKey);
    }
    await writeJson(file, after);
    return after;
  });
}
export async function monitorNotice(store, input) {
  object(input, ['runKey', 'deliveredRef', 'noticeGeneration'], ['runKey']);
  if (input.deliveredRef) await updateJson(monitorPath(store, input.runKey), {}, record => {
    requireThat(Number.isSafeInteger(input.noticeGeneration) &&
      input.noticeGeneration === record.notice.generation &&
      record.notice.status === 'pending',
    'STALE', 'Notification acknowledgement belongs to an obsolete notice');
    record.notice = { ...record.notice, status: 'delivered',
      evidenceRef: text(input.deliveredRef, 'notification evidence'),
      deliveredAt: now(store.clock) };
    return record;
  }, { limit: LIMITS.record });
  const record = await readMonitor(store, input.runKey);
  requireThat(record, 'MONITOR', 'Monitor record is unavailable');
  return { runKey: record.key, origin: record.origin, status: record.runStatus, monitorStatus: record.monitorStatus,
    link: record.link, notice: record.notice, nextPollAt: record.nextPollAt, gapCount: record.gapCount,
    message: `${record.origin === 'user-reported' ? 'Attached monitoring to user-reported' : 'Monitoring framework-triggered'} execution ${record.identity.executionRef}${record.identity.definitionRef ? ` of definition ${record.identity.definitionRef}` : ''}: ${record.runStatus}. ${record.monitorStatus === 'active' ? 'Polling every 60 seconds.' : `Monitoring ${record.monitorStatus}.`} ${record.link.status === 'verified' ? record.link.url : 'Run link verification pending or unavailable.'}` };
}
export async function interruptMonitor(store, input) {
  object(input, ['runKey', 'reason'], ['runKey', 'reason']);
  return updateJson(monitorPath(store, input.runKey), {}, record => {
    record.monitorStatus = 'interrupted'; record.inFlight = false; record.claimGeneration++;
    record.gapCount++; record.lastError = text(input.reason, 'interruption reason', 300);
    record.notice = nextNotice(record, 'interrupted');
    return record;
  }, { limit: LIMITS.record });
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
export async function pruneMonitor(store, input) {
  object(input, ['runKey'], ['runKey']);
  const file = monitorPath(store, input.runKey);
  return withLock(`${file}.lock`, async () => {
    const record = await readJson(file, { optional: true, limit: LIMITS.record });
    if (!record) return { archived: false, reason: 'No active monitor record exists.' };
    requireThat(TERMINAL.includes(record.runStatus) && record.notice.status === 'delivered', 'MONITOR', 'Retain nonterminal runs and undelivered completion notices');
    await invalidateAssociatedPrFacts(store, input.runKey);
    await immutableJson(path.join(store.runtime, 'pipeline-monitors', 'archive', `${record.key}.json`), record);
    await fs.unlink(file);
    return { archived: true, runKey: record.key, evidence: 'Terminal observation and delivered notification remain retrievable in the archive.' };
  });
}
