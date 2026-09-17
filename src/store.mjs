import path from 'node:path';
import os from 'node:os';
import * as fs from 'node:fs/promises';
import { LIMITS, PHASES, budget, choice, digest, id, newId, object, recordLimit, requireThat, safeRecord, text } from './core.mjs';
import { atomicWrite, canonicalPath, exists, immutableJson, listJson, privateDirectory, readBytes, readJson, safePath, updateJson, withLock, writeJson } from './files.mjs';
import { bindingKey, identity, sameBinding, validateBinding } from './git.mjs';
import { validateManifest, validateRecord } from './schemas.mjs';
import { sameNativePath } from './platform.mjs';
import { currentTestEvidence, testCheckpoint } from './authority.mjs';

export function emptyCheckpoint(workItemId, repositoryId) {
  return { schemaVersion: 1, revision: 0, workItemId, lifecycleStatus: 'active', phase: 'requirements',
    manifestRef: `${repositoryId}:.sdlc/work-items/${workItemId}.json`, decisionRefs: [], operationRefs: [],
    blockerRefs: [], validationCycleRef: null, artifactGeneration: 0, policyGeneration: 0, activeTask: 'analyze requirements' };
}
export function projectCheckpoint(checkpoint, records) {
  const next = structuredClone(checkpoint);
  const events = records.filter(record => record.type === 'event').sort((a, b) => a.sequence - b.sequence);
  next.phase = 'requirements';
  next.policyGeneration = checkpoint.policyGeneration ?? 0;
  for (const event of events) {
    if (event.effect.transition) next.phase = event.effect.transition.to;
    if (event.effect.lifecycleStatus) next.lifecycleStatus = event.effect.lifecycleStatus;
    next.policyGeneration = Math.max(next.policyGeneration, event.sequence);
  }
  if (next.phase !== checkpoint.phase || (next.phase !== 'requirements' && next.activeTask === 'analyze requirements')) {
    next.activeTask = next.phase === 'coding' ? 'implement and validate the approved design' : `maintain ${next.phase} and prepare user completion review`;
  }
  next.decisionRefs = events.filter(event => !event.audit || event.kind !== 'revocation').map(event => event.id);
  next.operationRefs = records.filter(record => record.type === 'operation').map(record => record.id);
  next.blockerRefs = records.filter(record => record.type === 'conflict' && record.status === 'open').map(record => record.id);
  const cycles = records.filter(record => record.type === 'cycle').sort((a, b) => b.generation - a.generation);
  next.validationCycleRef = cycles[0]?.id ?? null;
  return next;
}
function recoverResultProjections(records, clock = Date) {
  const changed = [];
  for (const cycle of records.filter(record => record.type === 'cycle')) {
    if (cycle.assuranceInvalidated) continue;
    const invalidatedEnvironments = new Set(cycle.invalidatedEnvironments ?? []);
    let nextEvidenceSequence = Math.max(cycle.lastEvidenceSequence ?? 0,
      ...records.filter(record => record.type === 'test-evidence' &&
        record.cycleId === cycle.id)
        .map(record => record.sequence ?? 0));
    for (const operation of records.filter(record =>
      record.type === 'operation' && record.class === 'test' &&
      record.cycleId === cycle.id &&
      ['succeeded', 'failed', 'cancelled'].includes(record.status) &&
      !records.some(evidence => evidence.type === 'test-evidence' &&
        evidence.operationId === record.id &&
        ((record.status === 'succeeded' &&
          record.expectedMet === true && evidence.status === 'Passed') ||
        ((record.status === 'failed' ||
          record.expectedMet === false) && evidence.status === 'Failed') ||
        (record.status === 'cancelled' && evidence.status === 'NotRun'))))) {
      const test = cycle.tests.find(candidate =>
        candidate.id === operation.action?.testId);
      if (!test || !operation.updatedAt) continue;
      const evidence = {
        type: 'test-evidence',
        id: `evidence-${digest({
          operationId: operation.id,
          terminalSequence: operation.terminalSequence,
        }).slice(0, 40)}`,
        workItemId: cycle.workItemId,
        sequence: ++nextEvidenceSequence,
        cycleId: cycle.id,
        testId: test.id,
        testSpecDigest: cycle.testSpecDigest,
        candidateDigest: cycle.candidateDigest,
        environment: operation.action.environment,
        implementation: test.implementation,
        status: operation.status === 'cancelled' ? 'NotRun' :
          operation.status === 'succeeded' &&
            operation.expectedMet === true ? 'Passed' : 'Failed',
        observedAt: operation.updatedAt,
        activity: operation.status === 'cancelled' ?
          'pending' : 'complete',
        evidenceRef: operation.evidenceRef,
        expectedMet: operation.expectedMet,
        owner: operation.action.owner,
        host: operation.action.host,
        operationId: operation.id,
        ...(operation.action.artifactId ?
          { artifactId: operation.action.artifactId } : {}),
        ...(operation.action.deploymentId ?
          { deploymentId: operation.action.deploymentId } : {}),
      };
      validateRecord(evidence);
      safeRecord(evidence, recordLimit(evidence));
      records.push(evidence);
      changed.push(evidence.id);
    }
    const evidence = records.filter(record =>
      record.type === 'test-evidence' &&
      record.cycleId === cycle.id &&
      record.testSpecDigest === cycle.testSpecDigest);
    cycle.lastEvidenceSequence = Math.max(cycle.lastEvidenceSequence ?? 0,
      ...evidence.map(result => result.sequence ?? 0));
    for (const test of cycle.tests) {
      if (invalidatedEnvironments.has(test.environment)) continue;
      const inFlightRetest = records.some(record =>
        record.type === 'operation' && record.class === 'test' &&
        record.cycleId === cycle.id &&
        record.action?.testId === test.id &&
        ['dispatching', 'submitted', 'running', 'uncertain']
          .includes(record.status));
      if (inFlightRetest) {
        if (cycle.results[test.id]) {
          delete cycle.results[test.id];
          cycle.pendingPlanSync = true;
          changed.push(cycle.id);
        }
        if (testCheckpoint(test) === 'pre-review' && cycle.reviewRef) {
          cycle.reviewRef = null;
          changed.push(cycle.id);
        }
        continue;
      }
      const projectedBefore = cycle.results[test.id];
      if (test.environment !== 'STAGING') {
        const sourceTime = result => {
          const operation = result.operationId ? records.find(record =>
            record.id === result.operationId &&
            record.type === 'operation') : null;
          const event = result.eventId ? records.find(record =>
            record.id === result.eventId && record.type === 'event') : null;
          return Date.parse(operation?.updatedAt ?? event?.occurredAt ??
            result.observedAt);
        };
        const rank = { Passed: 0, NotRun: 1, Failed: 2 };
        const latest = evidence.filter(result => result.testId === test.id)
          .sort((left, right) => {
            const time = sourceTime(left) - sourceTime(right);
            if (time) return time;
            const direct = !left.operationId && !left.eventId &&
              !right.operationId && !right.eventId;
            return direct ?
              (left.sequence ?? 0) - (right.sequence ?? 0) :
              rank[left.status] - rank[right.status] ||
                (left.sequence ?? 0) - (right.sequence ?? 0);
          }).at(-1);
        if (latest) cycle.results[test.id] = latest.id;
      }
      const result = currentTestEvidence(cycle, records, test, clock);
      const resultId = result && !result.id.startsWith('derived-') ?
        result.id : undefined;
      if (projectedBefore === resultId) continue;
      if (resultId) cycle.results[test.id] = resultId;
      else delete cycle.results[test.id];
      cycle.pendingPlanSync = true;
      changed.push(cycle.id);
    }
    for (const environment of ['DEV', 'STAGING']) {
      if (invalidatedEnvironments.has(environment)) continue;
      const artifact = records.filter(record => record.type === 'artifact' && record.cycleId === cycle.id &&
        record.status === 'succeeded' && record.environment === environment)
        .sort((left, right) => left.sequence - right.sequence).at(-1);
      if (artifact && cycle.artifacts[environment] !== artifact.id) {
        cycle.artifacts[environment] = artifact.id;
        changed.push(cycle.id);
      }
    }
    const deployments = records.filter(record => record.type === 'operation' && record.class === 'deploy' &&
      record.deploymentSequence && record.cycleId === cycle.id && record.candidateDigest === cycle.candidateDigest);
    const deploymentHighWater = Math.max(0, cycle.lastDeploymentSequence ?? 0,
      ...deployments.map(record => record.deploymentSequence ?? 0),
      ...Object.values(cycle.environmentInvalidationSequences ?? {}));
    if (cycle.lastDeploymentSequence !== deploymentHighWater) {
      cycle.lastDeploymentSequence = deploymentHighWater;
      changed.push(cycle.id);
    }
    const latestFor = environment => deployments.filter(record =>
      record.action.environment === environment &&
      record.status === 'succeeded' &&
      record.deploymentSequence >
        (cycle.environmentInvalidationSequences?.[environment] ?? 0))
      .sort((left, right) => left.deploymentSequence - right.deploymentSequence).at(-1);
    const dev = latestFor('DEV');
    const staging = latestFor('STAGING');
    if (dev) {
      if ((cycle.invalidatedEnvironments ?? []).includes('DEV') ||
          cycle.environmentInvalidationSequences?.DEV !== undefined) {
        changed.push(cycle.id);
      }
      if (cycle.deployments.DEV !== dev.id) {
        cycle.deployments.DEV = dev.id;
        changed.push(cycle.id);
      }
      cycle.invalidatedEnvironments =
        (cycle.invalidatedEnvironments ?? []).filter(environment =>
          environment !== 'DEV');
      delete cycle.environmentInvalidationSequences?.DEV;
      const artifact = records.find(record => record.type === 'artifact' &&
        record.cycleId === cycle.id &&
        record.environment === 'DEV' &&
        record.artifactId === dev.artifactId &&
        record.status === 'succeeded');
      if (artifact && !cycle.artifacts.DEV) cycle.artifacts.DEV = artifact.id;
    }
    if (staging && (!dev || staging.deploymentSequence > dev.deploymentSequence)) {
      if ((cycle.invalidatedEnvironments ?? []).includes('STAGING') ||
          cycle.environmentInvalidationSequences?.STAGING !== undefined) {
        changed.push(cycle.id);
      }
      if (cycle.deployments.STAGING !== staging.id) {
        cycle.deployments.STAGING = staging.id;
        changed.push(cycle.id);
      }
      cycle.invalidatedEnvironments =
        (cycle.invalidatedEnvironments ?? []).filter(environment =>
          environment !== 'STAGING');
      delete cycle.environmentInvalidationSequences?.STAGING;
      const artifact = records.find(record => record.type === 'artifact' &&
        record.cycleId === cycle.id &&
        record.environment === 'STAGING' &&
        record.artifactId === staging.artifactId &&
        record.status === 'succeeded');
      if (artifact && !cycle.artifacts.STAGING) {
        cycle.artifacts.STAGING = artifact.id;
      }
    } else if (cycle.deployments.STAGING) {
      delete cycle.deployments.STAGING;
      changed.push(cycle.id);
    }
    const latestDeployment = [dev, staging].filter(Boolean)
      .sort((left, right) => left.deploymentSequence - right.deploymentSequence).at(-1);
    if (latestDeployment) {
      const environment = latestDeployment.action.environment;
      cycle.step = latestDeployment.status === 'succeeded' ?
        (environment === 'STAGING' ? 'awaiting-staging-result' : 'dev-running') :
        `${environment.toLowerCase()}-${latestDeployment.status}`;
    }
    const reviews = records.filter(record => record.type === 'event' && record.kind === 'review-result' &&
      record.effect.cycleId === cycle.id && record.effect.candidateDigest === cycle.candidateDigest &&
      record.effect.testSpecDigest === cycle.testSpecDigest && record.effect.configDigest === cycle.configDigest)
      .sort((left, right) => left.sequence - right.sequence);
    const review = reviews.at(-1);
    if (review && cycle.reviewRef !== review.id) {
      cycle.reviewRef = review.id;
      cycle.step = review.effect.status === 'Passed' ? 'awaiting-dev-authorization' :
        review.effect.status === 'ChangesRequired' ? 'review-changes-required' : 'review-blocked';
      changed.push(cycle.id);
    }
  }
  return [...new Set(changed)];
}
export function orderRecordRemovals(records, removals) {
  const byId = new Map(records.map(record => [record.id, record]));
  const depthCache = new Map();
  const eventDepth = (record, seen = new Set()) => {
    if (record?.type !== 'event' || record.kind !== 'revocation' || seen.has(record.id)) return 0;
    if (depthCache.has(record.id)) return depthCache.get(record.id);
    const nextSeen = new Set(seen).add(record.id);
    const depth = 1 + Math.max(0, ...record.effect.revokes.map(eventId =>
      eventDepth(byId.get(eventId), nextSeen)));
    depthCache.set(record.id, depth);
    return depth;
  };
  return [...removals].sort((left, right) => {
    const leftRecord = byId.get(left);
    const rightRecord = byId.get(right);
    const weight = record => record?.type === 'event' ?
      eventDepth(record) : record?.type === 'audit-reference' ? 1000 : 500;
    return weight(leftRecord) - weight(rightRecord) || left.localeCompare(right);
  });
}
export function isNonRepositoryFailure(error) {
  return error?.code === 'GIT' &&
    /\bfatal:\s+not a git repository\b/iu.test(error.details?.cause ?? '');
}
async function repositoryMetadataAbsent(cwd) {
  let current = await canonicalPath(cwd);
  while (true) {
    try {
      await fs.lstat(path.join(current, '.git'));
      return false;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) return true;
    current = parent;
  }
}
export async function isNonRepositoryWorkspace(cwd, error) {
  return isNonRepositoryFailure(error) && await repositoryMetadataAbsent(cwd);
}
export class Store {
  constructor(home = process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot'), options = {}) {
    this.home = path.resolve(home);
    this.runtime = path.join(this.home, 'sdlc', 'runtime');
    this.clock = options.clock ?? Date;
    this.fault = options.fault ?? (async () => {});
  }
  async ready() {
    this.home = await canonicalPath(this.home);
    this.runtime = path.join(this.home, 'sdlc', 'runtime');
    requireThat(sameNativePath(await canonicalPath(this.runtime), this.runtime), 'PATH', 'Runtime storage must not traverse symlinks');
    await privateDirectory(this.runtime);
    return this;
  }
  workPath(workItemId) { return path.join(this.runtime, 'work-items', id(workItemId)); }
  recordPath(workItemId, recordId) { return path.join(this.workPath(workItemId), 'records', `${id(recordId)}.json`); }
  sessionPath(sessionId) { return path.join(this.runtime, 'sessions', `${id(sessionId)}.json`); }
  recoveryPath(workItemId) { return path.join(this.workPath(workItemId), 'recovery-required.json'); }
  assurancePath(workItemId) { return path.join(this.workPath(workItemId), 'assurance-recheck-required.json'); }
  async markAssurancePending(workItemId, reason, { forceNewCycle = false } = {}) {
    const file = this.assurancePath(workItemId);
    return withLock(`${file}.lock`, async () => {
      const current = await readJson(file, { optional: true });
      const obligations = current?.obligations ?? (current?.token ? [{
        token: current.token,
        reason: current.reason,
        forceNewCycle: current.forceNewCycle === true,
      }] : []);
      requireThat(obligations.length < 256, 'CAPACITY',
        'Too many pending assurance rechecks; complete recovery before recording more');
      const token = newId('assurance');
      obligations.push({
        token,
        reason: text(reason, 'assurance recheck reason', 300),
        forceNewCycle,
      });
      await writeJson(file, {
        workItemId,
        required: true,
        forceNewCycle: obligations.some(obligation => obligation.forceNewCycle),
        obligations,
      });
      return token;
    });
  }
  async clearAssurancePending(workItemId, expectedToken) {
    const file = this.assurancePath(workItemId);
    return withLock(`${file}.lock`, async () => {
      const current = await readJson(file, { optional: true });
      if (!current) return true;
      if (expectedToken === undefined) {
        await fs.rm(file, { force: true });
        return true;
      }
      const obligations = current.obligations ?? (current.token ? [{
        token: current.token,
        reason: current.reason,
        forceNewCycle: current.forceNewCycle === true,
      }] : []);
      if (!obligations.some(obligation => obligation.token === expectedToken)) return false;
      const remaining = obligations.filter(obligation => obligation.token !== expectedToken);
      if (!remaining.length) await fs.rm(file, { force: true });
      else await writeJson(file, {
        workItemId,
        required: true,
        forceNewCycle: remaining.some(obligation => obligation.forceNewCycle),
        obligations: remaining,
      });
      return true;
    });
  }
  async beginRecovery(workItemId) {
    const token = newId('recovery');
    await withLock(path.join(this.workPath(workItemId), '.lock'), async () => {
      await writeJson(this.recoveryPath(workItemId), { workItemId, required: true, token });
    });
    return token;
  }
  async completeRecovery(workItemId, token) {
    await withLock(path.join(this.workPath(workItemId), '.lock'), async () => {
      requireThat(await exists(path.join(this.workPath(workItemId), 'checkpoint.json')),
        'RECOVERY', 'Cannot complete recovery without a persisted checkpoint');
      const marker = await readJson(this.recoveryPath(workItemId), { optional: true });
      requireThat(marker?.token === token, 'RECOVERY',
        'A newer recovery attempt superseded this completion; retain the mutation barrier');
      await fs.rm(this.recoveryPath(workItemId), { force: true });
    });
  }
  async records(workItemId) {
    const directory = path.join(this.workPath(workItemId), 'records');
    const records = [];
    for (const name of await listJson(directory)) {
      const file = await safePath(directory, name);
      const record = await readJson(file, { limit: LIMITS.workingSet });
      validateRecord(record);
      budget(record, recordLimit(record), 'Active record');
      requireThat(record.workItemId === workItemId && typeof record.type === 'string', 'SCHEMA', 'Record identity/type is invalid');
      if (record.type === 'event') {
        const { digest: expected, ...content } = record;
        requireThat(expected === digest(content), 'DIGEST', 'Effective event content digest mismatch; recover authoritative records');
      }
      records.push(record);
    }
    budget(records, LIMITS.workingSet, 'Active work-item records');
    return records;
  }
  async metadata(workItemId) {
    const metadata = await readJson(path.join(this.workPath(workItemId), 'binding.json'), { limit: LIMITS.checkpoint });
    object(metadata, ['schemaVersion', 'revision', 'workItemId', 'coordinatorId', 'members']);
    requireThat(metadata.workItemId === workItemId && metadata.schemaVersion === 1, 'SCHEMA', 'Invalid work-item binding');
    return metadata;
  }
  async manifest(workItemId) {
    const metadata = await this.metadata(workItemId);
    const coordinator = metadata.members.find(member => member.repositoryId === metadata.coordinatorId);
    requireThat(coordinator, 'BINDING', 'Coordinator mapping is unavailable');
    await validateBinding(coordinator);
    const file = await safePath(coordinator.root, `.sdlc/work-items/${workItemId}.json`);
    const manifest = await readJson(file, { limit: LIMITS.checkpoint });
    validateManifest(manifest);
    requireThat(manifest.workItemId === workItemId && manifest.coordinatorId === metadata.coordinatorId, 'BINDING', 'Manifest identity disagrees with runtime binding');
    return { manifest, file, metadata, coordinator };
  }
  async load(workItemId, { recoverCheckpoint = false } = {}) {
    const { manifest, metadata } = await this.manifest(workItemId);
    const records = await this.records(workItemId);
    const checkpointFile = path.join(this.workPath(workItemId), 'checkpoint.json');
    let saved;
    try {
      saved = await readJson(checkpointFile, { optional: true, limit: LIMITS.checkpoint });
      if (saved) validateCheckpoint(saved);
    } catch (error) {
      if (!recoverCheckpoint || !['JSON', 'SCHEMA', 'INPUT', 'CAPACITY'].includes(error.code)) throw error;
      const original = await readBytes(checkpointFile, LIMITS.input);
      await atomicWrite(path.join(this.workPath(workItemId), 'recovery', `checkpoint-${digest(original)}.bin`), original);
      saved = null;
    }
    const recoveredRecordIds = recoverResultProjections(records, this.clock);
    const checkpoint = projectCheckpoint(saved ?? emptyCheckpoint(workItemId, metadata.coordinatorId), records);
    const assuranceMarker = await readJson(this.assurancePath(workItemId), { optional: true });
    const assurancePending = Boolean(assuranceMarker);
    if (assurancePending) records.push({
      type: 'assurance-marker',
      id: `assurance-marker-${workItemId}`,
      workItemId,
      forceNewCycle: assuranceMarker.forceNewCycle === true,
      obligations: assuranceMarker.obligations ?? [],
    });
    const recoveryRequired = !saved || await exists(this.recoveryPath(workItemId));
    return { checkpoint, records, manifest, metadata, checkpointMissing: !saved,
      recoveryRequired, recoveredRecordIds, assurancePending,
      assuranceMarker };
  }
  async transaction(workItemId, action, { expectedRevision, recoverCheckpoint = false,
    allowRecoveryRequired = false } = {}) {
    return withLock(path.join(this.workPath(workItemId), '.lock'), () =>
      this._transactionLocked(workItemId, action, {
        expectedRevision,
        recoverCheckpoint,
        allowRecoveryRequired,
      }));
  }
  async withWorkItemLocks(workItemIds, action) {
    const ids = [...new Set(workItemIds.map(workItemId => id(workItemId)))]
      .sort();
    const acquire = index => index === ids.length ?
      action({
        preflight: (workItemId, options) => {
          requireThat(ids.includes(id(workItemId)), 'LOCK_OWNER',
            'Work item is outside the acquired lock set');
          return this._preflightTransaction(workItemId, options);
        },
        transaction: (workItemId, update, options) => {
          requireThat(ids.includes(id(workItemId)), 'LOCK_OWNER',
            'Work item is outside the acquired lock set');
          return this._transactionLocked(workItemId, update, options);
        },
      }) :
      withLock(path.join(this.workPath(ids[index]), '.lock'), () =>
        acquire(index + 1));
    return acquire(0);
  }
  async _preflightTransaction(workItemId, {
    expectedRevision,
    recoverCheckpoint = false,
    allowRecoveryRequired = false,
  } = {}) {
    const state = await this.load(workItemId, { recoverCheckpoint });
    requireThat(!state.recoveryRequired || recoverCheckpoint ||
      allowRecoveryRequired,
    'RECOVERY',
    'Run sdlc resume to restore audited sequence state before mutating this work item');
    if (expectedRevision !== undefined) {
      requireThat(state.checkpoint.revision === expectedRevision, 'STALE',
        'Work-item revision changed');
    }
    return state;
  }
  async _transactionLocked(workItemId, action, {
    expectedRevision,
    recoverCheckpoint = false,
    allowRecoveryRequired = false,
  } = {}) {
      const state = await this.load(workItemId, { recoverCheckpoint });
      if (state.recoveryRequired) {
        const marker = await readJson(this.recoveryPath(workItemId), { optional: true });
        if (!marker) await writeJson(this.recoveryPath(workItemId),
          { workItemId, required: true, token: newId('recovery') });
      }
      requireThat(!state.recoveryRequired || recoverCheckpoint || allowRecoveryRequired,
        'RECOVERY', 'Run sdlc resume to restore audited sequence state before mutating this work item');
      if (expectedRevision !== undefined) requireThat(state.checkpoint.revision === expectedRevision, 'STALE', 'Work-item revision changed');
      const pending = new Map(state.records.map(record => [record.id, record]));
      const writes = new Map(state.records.filter(record => state.recoveredRecordIds.includes(record.id)).map(record => [record.id, record]));
      const removals = new Set();
      const tx = {
        ...state,
        get: recordId => pending.get(recordId),
        all: () => [...pending.values()],
        put: record => {
          id(record.id);
          validateRecord(record);
          safeRecord(record, recordLimit(record));
          requireThat(record.workItemId === workItemId, 'BINDING', 'Record belongs to another work item');
          pending.set(record.id, record); writes.set(record.id, record); removals.delete(record.id);
        },
        remove: recordId => { pending.delete(recordId); writes.delete(recordId); removals.add(recordId); },
      };
      const result = await action(tx);
      const projected = projectCheckpoint(tx.checkpoint, [...pending.values()]);
      projected.revision = state.checkpoint.revision + 1;
      budget(projected, LIMITS.checkpoint, 'Checkpoint');
      budget([...pending.values()], LIMITS.workingSet, 'Active work-item records');
      requireThat(projected.blockerRefs.length <= LIMITS.blockers, 'CAPACITY', 'At most 20 active blockers are allowed');
      requireThat([...pending.values()].filter(r => r.type === 'operation' && !['succeeded', 'failed', 'cancelled', 'not-started'].includes(r.status)).length <= LIMITS.unresolved,
        'CAPACITY', 'At most 20 unresolved operations are allowed; reconcile existing work');
      // The effective event is the transaction's commit record. Its projection can always be rebuilt.
      const ordered = [...writes.values()].sort((a, b) => Number(a.type === 'event') - Number(b.type === 'event'));
      for (const record of ordered) {
        const file = this.recordPath(workItemId, record.id);
        if (record.type === 'event') await immutableJson(file, record);
        else await writeJson(file, record);
        await this.fault(`record:${record.type}`);
      }
      await writeJson(path.join(this.workPath(workItemId), 'checkpoint.json'), projected);
      await this.fault('checkpoint');
      const removalOrder = orderRecordRemovals(state.records, removals);
      for (const recordId of removalOrder) {
        const record = state.records.find(item => item.id === recordId);
        await fs.rm(this.recordPath(workItemId, recordId), { force: true });
        await this.fault(`remove:${record?.type ?? 'record'}:${record?.kind ?? ''}`);
      }
      return result ?? projected;
  }
  async init(input) {
    object(input, ['workItemId', 'repositoryId', 'cwd', 'sessionId', 'adopt', 'historyStartsAt', 'receiptId'], ['repositoryId', 'cwd', 'sessionId']);
    await this.ready();
    const workItemId = input.workItemId ? id(input.workItemId) : newId('wi');
    const member = await identity(input.cwd, input.repositoryId);
    const sessionId = id(input.sessionId);
    const session = await readJson(this.sessionPath(sessionId), { optional: true });
    const receiptId = input.receiptId ?? session?.lastReceiptId;
    requireThat(receiptId, 'PROVENANCE', 'Initialization requires a captured development request in this session');
    const receipt = await readJson(path.join(this.runtime, 'sessions', sessionId, 'receipts', `${id(receiptId)}.json`));
    requireThat(receipt.sessionId === sessionId && ['userPromptSubmitted', 'ask_user'].includes(receipt.source), 'PROVENANCE', 'Initialization request provenance is unavailable');
    const registryFile = path.join(this.runtime, 'registry.json');
    return withLock(`${registryFile}.lock`, async () => {
      const registry = await readJson(registryFile, { optional: true }) ?? { schemaVersion: 1, revision: 0, bindings: {} };
      const key = bindingKey(member);
      if (registry.bindings[key] && registry.bindings[key] !== workItemId) {
        const previousWork = await this.load(registry.bindings[key]);
        requireThat(previousWork.checkpoint.lifecycleStatus === 'completed' &&
          !previousWork.records.some(r => r.type === 'operation' && !['succeeded', 'failed', 'cancelled', 'not-started'].includes(r.status)),
        'BINDING', 'This checkout already has active work; use a separate worktree or explicitly complete/handoff it');
      }
      const directory = this.workPath(workItemId);
      return withLock(path.join(directory, '.lock'), async () => {
        const manifestFile = await safePath(member.root, `.sdlc/work-items/${workItemId}.json`);
        const previous = await readJson(manifestFile, { optional: true });
        const bindingFile = path.join(directory, 'binding.json');
        const oldBinding = await readJson(bindingFile, { optional: true });
        requireThat(!oldBinding || (oldBinding.coordinatorId === member.repositoryId && sameBinding(oldBinding.members[0], member)),
          'BINDING', 'Work item already bound elsewhere; use member mapping');
        if (previous) requireThat(previous.workItemId === workItemId && previous.coordinatorId === member.repositoryId, 'BINDING', 'Existing manifest conflicts');
        const manifest = previous ?? { schemaVersion: 1, revision: 0, workItemId, coordinatorId: member.repositoryId,
          repositoryIds: [member.repositoryId], artifacts: [], historyStartsAt: input.adopt ? (input.historyStartsAt ?? member.head) : null };
        if (input.historyStartsAt) requireThat(/^[a-f0-9]{40,64}$/u.test(input.historyStartsAt), 'INPUT', 'Adoption boundary must be a full commit ID');
        await writeJson(manifestFile, manifest);
        await writeJson(bindingFile, oldBinding ?? { schemaVersion: 1, revision: 0, workItemId, coordinatorId: member.repositoryId, members: [member] });
        const checkpointFile = path.join(directory, 'checkpoint.json');
        if (!(await exists(checkpointFile)) && (previous || oldBinding)) {
          await writeJson(this.recoveryPath(workItemId), { workItemId, required: true });
          requireThat(false, 'RECOVERY', 'Existing work item is missing its checkpoint; run sdlc resume instead of reinitializing');
        }
        if (!(await exists(checkpointFile))) {
          await writeJson(path.join(directory, 'checkpoint.json'), emptyCheckpoint(workItemId, member.repositoryId));
        }
        registry.bindings[key] = workItemId;
        registry.revision++;
        await writeJson(registryFile, registry);
        await this.bindSession(sessionId, workItemId, member);
        return { workItemId, phase: 'requirements', adopted: Boolean(input.adopt), binding: member,
          warning: input.adopt ? 'Adoption imports identity, not historical approval or Coding authority.' : undefined };
      });
    });
  }
  async bindSession(sessionId, workItemId, member) {
    return updateJson(this.sessionPath(sessionId), { schemaVersion: 1, revision: 0, sessionId }, session => ({
      ...session, workItemId, repositoryId: member.repositoryId, bindingKey: bindingKey(member),
      orientationGeneration: (session.orientationGeneration ?? 0) + 1, acknowledgedToken: null, pendingDecisionId: null,
    }));
  }
  async bindMember(input) {
    object(input, ['workItemId', 'repositoryId', 'cwd', 'sessionId', 'replace'], ['workItemId', 'repositoryId', 'cwd', 'sessionId']);
    const member = await identity(input.cwd, input.repositoryId);
    const registryFile = path.join(this.runtime, 'registry.json');
    return withLock(`${registryFile}.lock`, async () => {
      const registry = await readJson(registryFile, { optional: true }) ?? { schemaVersion: 1, revision: 0, bindings: {} };
      requireThat(!registry.bindings[bindingKey(member)] || registry.bindings[bindingKey(member)] === input.workItemId, 'BINDING', 'Member checkout belongs to other active work');
      return withLock(path.join(this.workPath(input.workItemId), '.lock'), async () => {
        const metadata = await this.metadata(input.workItemId);
        const old = metadata.members.find(m => m.repositoryId === member.repositoryId);
        if (old && !sameBinding(old, member)) {
          requireThat(input.replace === true, 'BINDING', 'Relocation or branch change requires explicit replace mapping');
          const records = await this.records(input.workItemId);
          requireThat(!records.some(r => r.type === 'operation' && !['succeeded', 'failed', 'cancelled', 'not-started'].includes(r.status)),
            'UNCERTAIN', 'Settle or hand off outstanding operations before rebinding');
          requireThat(old.branch === member.branch, 'BINDING', 'A different branch must not inherit phase authority; create a distinct work item');
          delete registry.bindings[bindingKey(old)];
        }
        metadata.members = [...metadata.members.filter(m => m.repositoryId !== member.repositoryId), member];
        metadata.revision++;
        const coordinator = metadata.members.find(m => m.repositoryId === metadata.coordinatorId);
        await validateBinding(coordinator);
        const file = await safePath(coordinator.root, `.sdlc/work-items/${input.workItemId}.json`);
        const manifest = await readJson(file);
        manifest.repositoryIds = [...new Set([...manifest.repositoryIds, member.repositoryId])];
        manifest.revision++;
        await writeJson(file, manifest);
        await writeJson(path.join(this.workPath(input.workItemId), 'binding.json'), metadata);
        registry.bindings[bindingKey(member)] = input.workItemId;
        registry.revision++;
        await writeJson(registryFile, registry);
        await this.bindSession(input.sessionId, input.workItemId, member);
        return member;
      });
    });
  }
  async resolve(cwd, sessionId, explicitId) {
    const session = await readJson(this.sessionPath(sessionId), { optional: true });
    let observed;
    try {
      observed = await identity(cwd, session?.repositoryId ?? 'discovery');
    } catch (error) {
      if (!await isNonRepositoryWorkspace(cwd, error) || !session?.workItemId) throw error;
      requireThat(!explicitId || explicitId === session.workItemId, 'BINDING',
        'Explicit work item disagrees with the session-bound repository');
      const metadata = await this.metadata(session.workItemId);
      const member = metadata.members.find(candidate =>
        candidate.repositoryId === session.repositoryId &&
        bindingKey(candidate) === session.bindingKey);
      requireThat(member, 'BINDING',
        'Session binding cannot resolve a repository from the non-Git workspace');
      await validateBinding(member);
      return { workItemId: session.workItemId, member, session,
        fallbackFromNonRepository: true };
    }
    const registry = await readJson(path.join(this.runtime, 'registry.json'), { optional: true });
    const candidates = new Set();
    if (explicitId) candidates.add(id(explicitId));
    if (!explicitId && session?.workItemId &&
        session.bindingKey === bindingKey(observed)) {
      candidates.add(session.workItemId);
    }
    if (registry?.bindings[bindingKey(observed)]) candidates.add(registry.bindings[bindingKey(observed)]);
    for (const file of await listJson(path.join(observed.root, '.sdlc', 'work-items'))) {
      const manifest = await readJson(await safePath(observed.root, `.sdlc/work-items/${file}`));
      if (explicitId && explicitId !== manifest.workItemId) continue;
      const binding = await readJson(path.join(this.workPath(manifest.workItemId), 'binding.json'), { optional: true });
      if (binding && !binding.members.some(member => bindingKey(member) === bindingKey(observed))) continue;
      const checkpoint = await readJson(path.join(this.workPath(manifest.workItemId), 'checkpoint.json'), { optional: true })
        .catch(error => { if (error.code === 'JSON') return null; throw error; });
      if (checkpoint?.lifecycleStatus === 'completed' && explicitId !== manifest.workItemId) continue;
      candidates.add(manifest.workItemId);
    }
    if (!candidates.size) {
      let directories = [];
      try { directories = await fs.readdir(path.join(this.runtime, 'work-items'), { withFileTypes: true }); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      requireThat(directories.length <= 1000, 'CAPACITY', 'Discovery index is missing and work-item scan is too large; provide an explicit work-item ID');
      for (const directory of directories.filter(entry => entry.isDirectory())) {
        const binding = await readJson(path.join(this.workPath(directory.name), 'binding.json'), { optional: true });
        if (binding?.members.some(member => bindingKey(member) === bindingKey(observed))) candidates.add(binding.workItemId);
      }
    }
    requireThat(candidates.size === 1, 'BINDING', candidates.size ? 'Multiple plausible work items; select explicitly and resolve conflicting bindings' : 'No recoverable work-item binding; initialize or explicitly map the coordinator');
    const workItemId = [...candidates][0];
    const metadata = await this.metadata(workItemId);
    const member = metadata.members.find(m => bindingKey(m) === bindingKey(observed));
    requireThat(member, 'BINDING', 'Current branch/worktree has no matching member binding; old phase is not authority');
    await validateBinding(member);
    return { workItemId, member, session };
  }
  async indexBinding(workItemId, member) {
    return updateJson(path.join(this.runtime, 'registry.json'), { schemaVersion: 1, revision: 0, bindings: {} }, registry => {
      const existing = registry.bindings[bindingKey(member)];
      requireThat(!existing || existing === workItemId, 'BINDING', 'Registry binding conflicts with recovered work');
      registry.bindings[bindingKey(member)] = workItemId;
      return registry;
    });
  }
  async invalidateSession(sessionId, reason = 'session-start') {
    return updateJson(this.sessionPath(sessionId), { schemaVersion: 1, revision: 0, sessionId }, session => ({
      ...session, orientationGeneration: (session.orientationGeneration ?? 0) + 1,
      acknowledgedToken: null, orientationReason: text(reason, 'orientation reason'), resumeToken: null,
    }));
  }
}
export function validateCheckpoint(value) {
  object(value, ['schemaVersion', 'revision', 'workItemId', 'lifecycleStatus', 'phase', 'manifestRef',
    'decisionRefs', 'operationRefs', 'validationCycleRef', 'blockerRefs', 'artifactGeneration', 'policyGeneration', 'activeTask']);
  requireThat(value.schemaVersion === 1 && Number.isSafeInteger(value.revision) && value.revision >= 0, 'SCHEMA', 'Invalid checkpoint schema/revision');
  id(value.workItemId); choice(value.phase, PHASES, 'phase');
  choice(value.lifecycleStatus, ['active', 'paused', 'completed'], 'lifecycle status');
  for (const key of ['decisionRefs', 'operationRefs', 'blockerRefs']) requireThat(Array.isArray(value[key]) && value[key].every(v => typeof v === 'string'), 'SCHEMA', `Invalid ${key}`);
  for (const key of ['artifactGeneration', 'policyGeneration']) requireThat(Number.isSafeInteger(value[key]) && value[key] >= 0, 'SCHEMA', `Invalid ${key}`);
  budget(value, LIMITS.checkpoint, 'Checkpoint');
  return value;
}
