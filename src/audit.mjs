import path from 'node:path';
import { LIMITS, canonical, digest, object, requireThat } from './core.mjs';
import { listJson, readJson } from './files.mjs';
import { commitMessage, history } from './git.mjs';
import { verifyEvent } from './decisions.mjs';
import { activeEvents, boundToCycle, currentCycle, currentStagingResultEventIds, eventAppliesToCycle } from './authority.mjs';

export function formatEvents(events) {
  requireThat(events.length > 0, 'INPUT', 'Select at least one effective event to audit');
  const workItemId = events[0].workItemId;
  const lines = [`SDLC-Work-Item: ${workItemId}`];
  for (const event of events) {
    verifyEvent(event);
    requireThat(event.workItemId === workItemId, 'BINDING', 'An audit block must identify one work item');
    lines.push(`SDLC-Event: ${Buffer.from(canonical(event)).toString('base64url')}`);
    lines.push(`SDLC-Applied: ${event.id} ${event.digest}`);
  }
  const result = lines.join('\n');
  requireThat(Buffer.byteLength(result) <= 128 * 1024, 'CAPACITY',
    'Audit payload exceeds 128 KiB; audit smaller complete event batches');
  return result;
}
export function parseEvents(message, workItemId) {
  const workItems = [...message.matchAll(/^SDLC-Work-Item:\s*(\S+)\s*$/gmu)].map(match => match[1]);
  const applied = new Set([...message.matchAll(/^SDLC-Applied:\s*(\S+)\s+([a-f0-9]{64})\s*$/gmu)].map(match => `${match[1]} ${match[2]}`));
  const events = [];
  const encodedEventLimit = Math.ceil(LIMITS.decision * 4 / 3) + 16;
  for (const match of message.matchAll(/^SDLC-Event:\s*(\S+)\s*$/gmu)) {
    requireThat(/^[A-Za-z0-9_-]+$/u.test(match[1]) &&
      match[1].length <= encodedEventLimit,
    'AUDIT', 'Malformed or oversized audit payload');
    const decoded = Buffer.from(match[1], 'base64url');
    requireThat(decoded.length <= LIMITS.decision, 'AUDIT',
      'Decoded audit event exceeds the decision limit');
    let event;
    try { event = JSON.parse(decoded.toString('utf8')); }
    catch { requireThat(false, 'AUDIT', 'Malformed audit event JSON'); }
    verifyEvent(event);
    if (event.workItemId !== workItemId) continue;
    requireThat(workItems.includes(workItemId) && applied.has(`${event.id} ${event.digest}`), 'AUDIT', 'Complete work-item/event/applied trailers are required');
    events.push(event);
  }
  if (workItems.includes(workItemId)) {
    for (const entry of applied) requireThat(events.some(event => `${event.id} ${event.digest}` === entry), 'AUDIT', 'Applied reference lacks its complete event');
  }
  return events;
}
export async function formatAudit(store, workItemId, eventIds = []) {
  const state = await store.load(workItemId);
  const events = state.records.filter(r => r.type === 'event' && (!eventIds.length || eventIds.includes(r.id)));
  requireThat(!eventIds.length || events.length === eventIds.length, 'AUDIT', 'Requested event is unavailable');
  return { trailers: formatEvents(events), eventIds: events.map(event => event.id), note: 'Review the sanitized trailers and write a meaningful commit subject/body. This command does not commit.' };
}
export async function recordAudit(store, input) {
  object(input, ['workItemId', 'repositoryId', 'commit'], ['workItemId', 'repositoryId', 'commit']);
  return store.transaction(input.workItemId, async tx => {
    const member = tx.metadata.members.find(m => m.repositoryId === input.repositoryId);
    requireThat(member, 'BINDING', 'Audit repository is not a member');
    const message = await commitMessage(member, input.commit);
    const events = parseEvents(message, input.workItemId);
    requireThat(events.length > 0, 'AUDIT', 'Commit contains no complete applicable audit events');
    for (const event of events) {
      const local = tx.get(event.id);
      requireThat(local?.digest === event.digest, 'AUDIT', 'Committed event does not match the effective local event');
      requireThat(event.repositoryIds.includes(member.repositoryId), 'AUDIT',
        'Audit event does not include the repository containing its trailer');
      tx.put({ type: 'audit-reference', id: `audit-${digest({ id: event.id, repositoryId: member.repositoryId }).slice(0, 40)}`,
        workItemId: input.workItemId, eventId: event.id, eventDigest: event.digest, repositoryId: member.repositoryId, commit: input.commit });
    }
    return { verified: events.map(event => event.id), commit: input.commit };
  });
}
export async function replayAudit(store, workItemId, { persist = false, recovery = false } = {}) {
  const { metadata, manifest } = await store.manifest(workItemId);
  const archived = [];
  for (const name of await listJson(path.join(store.workPath(workItemId),
    'evidence'))) {
    archived.push(await readJson(path.join(store.workPath(workItemId),
      'evidence', name), { limit: LIMITS.workingSet }));
  }
  const byId = new Map(), bySequence = new Map(), locations = [];
  for (const member of metadata.members) {
    const boundary = member.repositoryId === metadata.coordinatorId ? manifest.historyStartsAt : null;
    for (const commit of await history(member, boundary)) {
      for (const event of parseEvents(commit.message, workItemId)) {
        requireThat(event.repositoryIds.includes(member.repositoryId), 'AUDIT', 'Audit event does not include this member repository');
        requireThat(!byId.has(event.id) || byId.get(event.id).digest === event.digest, 'ID_CONFLICT', 'Conflicting cross-repository copies of an audit event');
        requireThat(!bySequence.has(event.sequence) || bySequence.get(event.sequence) === event.id, 'SEQUENCE', 'Conflicting events share a work-item sequence');
        byId.set(event.id, event); bySequence.set(event.sequence, event.id);
        locations.push({ eventId: event.id, repositoryId: member.repositoryId, commit: commit.commit });
      }
    }
  }
  const events = [...byId.values()].sort((a, b) => a.sequence - b.sequence);
  const gaps = [];
  for (let index = 0; index < events.length; index++) if (events[index].sequence !== index + 1) gaps.push(`sequence-before-${events[index].sequence}-unavailable`);
  if (persist) {
    const state = await store.load(workItemId);
    requireThat(recovery === true && state.recoveryRequired,
      'RECOVERY', 'Persistent audit replay is restricted to an active sdlc resume');
  }
  if (persist) await store.transaction(workItemId, tx => {
    const cycle = currentCycle(tx.all(), tx.checkpoint);
    tx.checkpoint.policyGeneration = Math.max(tx.checkpoint.policyGeneration ?? 0,
      ...events.map(event => event.sequence));
    const currentStagingResultIds = currentStagingResultEventIds([...tx.all(), ...events], cycle, store.clock);
    const required = new Set(activeEvents(events, { cycleId: cycle?.id, clock: store.clock })
      .filter(event => eventAppliesToCycle(event, cycle) &&
        (event.kind !== 'staging-result' || currentStagingResultIds.has(event.id))).map(event => event.id));
    for (const event of tx.all().filter(record => record.type === 'event')) required.add(event.id);
    for (const event of events) if (event.effect.transition || event.effect.lifecycleStatus) required.add(event.id);
    for (const event of events) if (event.kind === 'review-result' &&
      event.effect.status === 'ChangesRequired' && boundToCycle(event.effect, cycle)) required.add(event.id);
    const latestReview = events.filter(event => event.kind === 'review-result' && boundToCycle(event.effect, cycle))
      .sort((left, right) => left.sequence - right.sequence).at(-1);
    if (latestReview) required.add(latestReview.id);
    for (const record of tx.all()) {
      if (record.type === 'reservation') required.add(record.eventId);
      if (record.type === 'test-evidence' && record.eventId) required.add(record.eventId);
    }
    const consumed = new Map();
    for (const record of [...tx.all(), ...archived]) {
      if (record.type === 'reservation') {
        const previous = consumed.get(record.eventId);
        requireThat(!previous || previous === record.operationId,
          'AUTHORITY', 'Once-only event has conflicting reservations');
        consumed.set(record.eventId, record.operationId);
      }
      if (record.type === 'operation') {
        for (const eventId of record.reservedEventIds ?? []) {
          const previous = consumed.get(eventId);
          requireThat(!previous || previous === record.id,
            'AUTHORITY', 'Once-only event was consumed by multiple operations');
          consumed.set(eventId, record.id);
        }
      }
    }
    for (const eventId of consumed.keys()) required.add(eventId);
    if (cycle?.reviewRef) required.add(cycle.reviewRef);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const event of events.filter(candidate => candidate.kind === 'revocation')) {
        if (!event.effect.revokes.some(eventId => required.has(eventId)) || required.has(event.id)) continue;
        required.add(event.id);
        expanded = true;
      }
    }
    for (const event of events) {
      if (!required.has(event.id)) continue;
      const old = tx.get(event.id);
      requireThat(!old || old.digest === event.digest, 'ID_CONFLICT', 'Git and local event disagree');
      tx.put(event);
    }
    for (const [eventId, operationId] of consumed) {
      if (!required.has(eventId)) continue;
      tx.put({
        type: 'reservation',
        id: `reservation-${digest(eventId).slice(0, 40)}`,
        workItemId,
        eventId,
        operationId,
      });
    }
  }, { allowRecoveryRequired: true });
  return { events, locations, gaps, historyStartsAt: manifest.historyStartsAt, provenance: 'Git proves the recorded claim, not independent user intent or edit execution time.' };
}
