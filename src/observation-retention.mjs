import path from 'node:path';
import * as fs from 'node:fs/promises';
import { LIMITS, budget, canonical, digest, id, object, parseJson, recordLimit, requireThat,
  safeRecord } from './core.mjs';
import { atomicWrite, listJson, readBytes, readJson, safePath } from './files.mjs';
import { readMonitor, withMonitorLocks } from './monitors.mjs';
import { validateRecord } from './schemas.mjs';

const observationTypes = new Set(['repository-observation', 'pr-observation', 'pr-facts']);
const terminal = new Set(['succeeded', 'failed', 'cancelled', 'not-started']);
const identityFields = ['repositoryId', 'localRepositoryPath', 'remoteRepositoryURL',
  'provider', 'connection', 'repositoryRef'];
const retentionSnapshots = new WeakMap();

function identityKey(record) {
  return canonical([...identityFields.map(field => record[field] ?? null),
    ...(record.type === 'pr-observation' ? [record.pullRequestRef] : [])]);
}

function newest(records) {
  return records.reduce((latest, record) => !latest ||
    (record.type === 'pr-observation' && record.sequence !== latest.sequence ?
      record.sequence > latest.sequence :
      record.observedAt > latest.observedAt ||
        record.observedAt === latest.observedAt && record.id > latest.id) ?
    record : latest, null);
}

function walk(value, visit) {
  if (typeof value === 'string') visit(value);
  else if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (value.type === 'pr-observation' && key === 'previousObservationKey') continue;
      visit(key);
      walk(item, visit);
    }
  }
}

async function monitorIndex(store, workItemId) {
  const associations = [];
  const associationDirectory = path.join(store.runtime, 'pipeline-monitor-associations');
  for (const name of await listJson(associationDirectory)) {
    const record = await readJson(await safePath(associationDirectory, name),
      { limit: LIMITS.record + 1 });
    if (record.workItemId === workItemId) associations.push(record);
  }
  const keys = new Set(associations.map(record => id(record.runKey)));
  const monitorDirectory = path.join(store.runtime, 'pipeline-monitors');
  for (const name of await listJson(monitorDirectory)) {
    const record = await readJson(await safePath(monitorDirectory, name),
      { limit: LIMITS.record + 1 });
    if (record.workItemId === workItemId) keys.add(id(record.key));
  }
  return { keys: [...keys].sort(), associations };
}

/**
 * Discover monitor locks before taking the work-item lock, then recheck one
 * dependency snapshot. A newly associated run produces STALE rather than
 * acquiring a monitor lock in the reverse order. The callback receives
 * (tx, [{ monitor, associations }]); this wrapper performs no provider calls.
 */
export async function withObservationRetention(store, workItemId, action, options = {}) {
  id(workItemId);
  const discovered = await monitorIndex(store, workItemId);
  return withMonitorLocks(store, discovered.keys, () =>
    store.transaction(workItemId, async tx => {
      const snapshot = await monitorIndex(store, workItemId);
      requireThat(snapshot.keys.every(key => discovered.keys.includes(key)),
        'STALE', 'Monitor dependencies changed; retry observation retention with current monitor locks');
      const dependencies = [];
      for (const key of snapshot.keys) {
        dependencies.push({ monitor: await readMonitor(store, key),
          associations: snapshot.associations.filter(record => record.runKey === key) });
      }
      // load() may already have repaired projections in memory; reserve against
      // the durable versions that still coexist with those pending repairs.
      const records = await store.records(workItemId);
      retentionSnapshots.set(tx, {
        records, all: () => records,
        checkpoint: structuredClone(tx.checkpoint),
        manifest: structuredClone(tx.manifest),
        recoveryRequired: tx.recoveryRequired,
        earlyRemovedIds: new Set(),
      });
      try { return await action(tx, dependencies); }
      finally { retentionSnapshots.delete(tx); }
    }, options));
}

function retainedObservationIds(tx, monitorDependencies) {
  const records = tx.all();
  const byId = new Map(records.map(record => [record.id, record]));
  const retained = new Set();
  const queue = [];
  const retain = recordId => {
    if (typeof recordId !== 'string') return;
    for (const match of recordId.matchAll(/(?:facts-)?(?:repository|pr)-observation-[a-f0-9]{40}/gu)) {
      if (match[0] !== recordId) retain(match[0]);
    }
    if (!byId.has(recordId) || retained.has(recordId)) return;
    retained.add(recordId);
    queue.push(byId.get(recordId));
  };
  const groups = new Map();
  for (const record of records) {
    if (!['repository-observation', 'pr-observation'].includes(record.type)) continue;
    const key = `${record.type}:${identityKey(record)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  for (const group of groups.values()) retain(newest(group).id);
  for (const record of records.filter(record => !observationTypes.has(record.type))) {
    retain(record.id);
  }
  walk(tx.checkpoint, retain);
  walk(tx.manifest, retain);
  if (tx.recoveryRequired) {
    for (const record of records) retain(record.id);
  }
  for (const dependency of monitorDependencies) {
    const { monitor, associations } = dependency;
    let referenced = false;
    const keys = new Set([monitor?.key, ...associations.map(record => record.key)]
      .filter(Boolean));
    for (const record of records.filter(record => !observationTypes.has(record.type))) {
      walk(record, value => {
        if ([...keys].some(key => value.includes(key))) referenced = true;
      });
    }
    if (!monitor || !terminal.has(monitor.runStatus) ||
        monitor.notice?.status !== 'delivered' || monitor.inFlight || referenced ||
        tx.recoveryRequired) {
      walk(monitor, retain);
      for (const association of associations) walk(association, retain);
    }
  }
  const repositoryObservations = records.filter(record =>
    record.type === 'repository-observation');
  const preserveRepository = context => {
    const revision = context.sourceRevision ?? context.revision;
    if (!context.localRepositoryPath && !context.remoteRepositoryURL &&
        !(context.repositoryId && revision)) return;
    const matching = repositoryObservations.filter(observation =>
      identityFields.every(field => context[field] === undefined ||
        context[field] === observation[field]) &&
      (revision === undefined || observation.revision === revision ||
        observation.verifiedBranch?.revision === revision));
    const matchingGroups = new Map();
    for (const record of matching) {
      const key = identityKey(record);
      if (!matchingGroups.has(key)) matchingGroups.set(key, []);
      matchingGroups.get(key).push(record);
    }
    for (const group of matchingGroups.values()) retain(newest(group).id);
  };
  const visitContexts = (value, inherited = {}) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) visitContexts(item, inherited);
      return;
    }
    const context = { ...inherited };
    for (const field of [...identityFields, 'sourceRevision', 'revision']) {
      if (value[field] !== undefined) context[field] = value[field];
    }
    preserveRepository(context);
    for (const [field, item] of Object.entries(value)) {
      if (field !== 'previousObservationKey') visitContexts(item, context);
    }
  };
  for (let index = 0; index < queue.length; index++) {
    const record = queue[index];
    walk(record, retain);
    visitContexts(record);
    if (record.type === 'pr-observation' || record.type === 'pr') {
      for (const facts of records.filter(candidate =>
        candidate.type === 'pr-facts' && candidate.prRecordId === record.id)) retain(facts.id);
    }
  }
  return retained;
}

function factsArchiveValue(bytes, workItemId, factsId) {
  const facts = parseJson(bytes.toString('utf8'), LIMITS.record + 1);
  requireThat(facts?.type === 'pr-facts' && facts.id === factsId &&
    facts.workItemId === workItemId && facts.id === `facts-${facts.prRecordId}`,
  'ID_CONFLICT', 'Archived PR facts do not match their work item and current identifier');
  validateRecord(facts);
  safeRecord(facts, recordLimit(facts));
  return facts;
}

async function archiveFactsVersion(directory, bytes) {
  const archiveId = `pr-facts-version-${digest(bytes)}`;
  const destination = await safePath(directory, `${archiveId}.json`);
  const archived = await readJsonBytes(destination, LIMITS.record + 1);
  if (archived) {
    requireThat(archived.equals(bytes), 'ID_CONFLICT',
      'Archived PR fact version contains different bytes');
  } else await atomicWrite(destination, bytes);
}

async function readJsonBytes(file, limit) {
  try { return await readBytes(file, limit); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

/**
 * Read exact historical bytes by facts ID and optional byte SHA-256. Without
 * sha256, read the first-snapshot compatibility archive, never active facts.
 * Retrieval is read-only and does not project history into current readiness.
 */
export async function readArchivedPrFacts(store, input) {
  object(input, ['workItemId', 'factsId', 'sha256'], ['workItemId', 'factsId']);
  id(input.workItemId);
  id(input.factsId);
  if (input.sha256 !== undefined) requireThat(/^[a-f0-9]{64}$/u.test(input.sha256),
    'INPUT', 'Archived PR facts require a full byte SHA-256');
  const archiveId = input.sha256 === undefined ? input.factsId :
    `pr-facts-version-${input.sha256}`;
  const evidenceRef = await safePath(path.join(store.workPath(input.workItemId),
    'evidence'), `${archiveId}.json`);
  const bytes = await readBytes(evidenceRef, LIMITS.record + 1);
  const sha256 = digest(bytes);
  requireThat(input.sha256 === undefined || sha256 === input.sha256,
    'ID_CONFLICT', 'Archived PR fact version contains different bytes');
  const facts = factsArchiveValue(bytes, input.workItemId, input.factsId);
  return { facts, bytes, archiveId, sha256, evidenceRef, historicalOnly: true };
}

async function archiveObservation(store, workItemId, record) {
  const directory = path.join(store.workPath(workItemId), 'evidence');
  const destination = await safePath(directory, `${id(record.id)}.json`);
  let bytes;
  const limit = recordLimit(record) + 1;
  try {
    bytes = await readBytes(store.recordPath(workItemId, record.id), limit);
    requireThat(digest(parseJson(bytes.toString('utf8'), limit)) === digest(record),
      'ID_CONFLICT', 'Observation changed before archival; retain its active evidence');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    bytes = Buffer.from(`${canonical(record)}\n`);
  }
  const archived = await readJsonBytes(destination, limit);
  if (record.type === 'pr-facts') {
    // A failed refresh leaves these facts mutable. Keep the first-snapshot
    // locator for old consumers, but freeze every byte version independently.
    if (archived) {
      factsArchiveValue(archived, workItemId, record.id);
      await archiveFactsVersion(directory, archived);
    }
    await archiveFactsVersion(directory, bytes);
    await store.fault('archive:pr-facts:version');
    if (!archived) await atomicWrite(destination, bytes);
  } else if (archived) {
    requireThat(digest(parseJson(archived.toString('utf8'), limit)) === digest(record),
      'ID_CONFLICT', 'Archived observation identifier contains different evidence');
  } else {
    await atomicWrite(destination, bytes);
  }
  await store.fault(`archive:${record.type}`);
}

function commitWorkingSet(snapshot, pending, earlyRemovedIds) {
  const records = new Map(snapshot.records.filter(record =>
    !earlyRemovedIds.has(record.id)).map(record => [record.id, record]));
  for (const record of pending) {
    const original = records.get(record.id);
    if (!original || Buffer.byteLength(canonical(record)) >
        Buffer.byteLength(canonical(original))) records.set(record.id, record);
  }
  return [...records.values()];
}

/**
 * Call only inside a work-item transaction, passing the snapshot from
 * withObservationRetention, after the last put. Original and replacement heads
 * must coexist within the budget until Store finishes its writes. If necessary,
 * reclaim only durably archived observations obsolete in both dependency
 * snapshots before those writes; never reorder current heads or dependencies.
 * Returns archived IDs; historical predecessor links do not pin refresh chains.
 */
export async function archiveSupersededObservations(store, tx, { monitorDependencies = [] } = {}) {
  const snapshot = retentionSnapshots.get(tx);
  requireThat(snapshot, 'LOCK_OWNER',
    'Observation retention requires the original snapshot from withObservationRetention');
  const retained = retainedObservationIds(tx, monitorDependencies);
  const obsolete = tx.all().filter(record =>
    observationTypes.has(record.type) && !retained.has(record.id));
  for (const record of obsolete) {
    await archiveObservation(store, record.workItemId, record);
    tx.remove(record.id);
  }
  const pending = tx.all();
  const peak = commitWorkingSet(snapshot, pending, snapshot.earlyRemovedIds);
  const earlyRemovals = [];
  if (Buffer.byteLength(canonical(peak)) > LIMITS.workingSet) {
    const originallyRetained = retainedObservationIds(snapshot, monitorDependencies);
    const originalIds = new Set(snapshot.records.map(record => record.id));
    earlyRemovals.push(...obsolete.filter(record =>
      originalIds.has(record.id) && !originallyRetained.has(record.id)));
  }
  const earlyRemovedIds = new Set([
    ...snapshot.earlyRemovedIds, ...earlyRemovals.map(record => record.id),
  ]);
  budget(commitWorkingSet(snapshot, pending, earlyRemovedIds),
    LIMITS.workingSet, 'Observation replacement commit working set');
  for (const record of earlyRemovals) {
    await fs.rm(store.recordPath(record.workItemId, record.id), { force: true });
    snapshot.earlyRemovedIds.add(record.id);
    await store.fault(`retention:remove:${record.type}`);
  }
  return obsolete.map(record => record.id);
}
