import { LIMITS, choice, digest, id, newId, now, object, requireThat, text } from './core.mjs';
import { readJson, safePath } from './files.mjs';
import { git, validateBinding } from './git.mjs';
import { currentTestSpecification, loadConfig, resolveTestSpecification,
  synchronizeTestPlan } from './artifacts.mjs';
import { applicableOverride, assurancePending, boundToCycle, currentCycle, hasEnvironmentGrant, latestStagingResultEvent, stagePassed, testCheckpoint } from './authority.mjs';
import { effectiveStagingExecution, stagingExecutionGuidance,
  stagingExecutionMatches, STAGING_OWNERS } from './staging.mjs';
import { createHash } from 'node:crypto';
import path from 'node:path';

function gitBlobId(bytes, algorithm) {
  return createHash(algorithm).update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

export async function candidateSnapshot(metadata, manifest) {
  const sources = [];
  for (const member of metadata.members) {
    const actual = await validateBinding(member);
    const documents = new Set(manifest.artifacts.filter(a => a.kind === 'git' && a.repositoryId === member.repositoryId).map(a => a.path));
    const included = name => !documents.has(name) && (!name.startsWith('.sdlc/') || name === '.sdlc/config.json');
    const indexEntries = (await git(member.root, ['ls-files', '--stage', '-z'])).split('\0').filter(Boolean)
      .filter(entry => included(entry.slice(entry.indexOf('\t') + 1)));
    requireThat(indexEntries.length <= 20000, 'CAPACITY', 'Candidate index exceeds 20,000 files; use a scoped member checkout');
    const effective = new Map();
    for (const entry of indexEntries) {
      const tab = entry.indexOf('\t');
      const [mode, objectId, stage] = entry.slice(0, tab).split(' ');
      const name = entry.slice(tab + 1);
      const values = effective.get(name) ?? [];
      values.push([mode, objectId, stage]);
      effective.set(name, values);
    }
    const changed = await git(member.root, ['diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z']);
    const untracked = await git(member.root, ['ls-files', '--others', '--exclude-standard', '-z']);
    const names = [...new Set([...changed.split('\0'), ...untracked.split('\0')].filter(name => name && included(name)))].sort();
    requireThat(names.length <= 20000, 'CAPACITY', 'Candidate working changes exceed 20,000 files; use a scoped member checkout');
    const objectFormat = await git(member.root, ['rev-parse', '--show-object-format']);
    const coreFileMode = (await git(member.root, ['config', '--bool', 'core.filemode'], { optional: true })) !== 'false';
    for (const name of names) {
      try {
        await safePath(member.root, name);
        const file = path.resolve(member.root, name);
        const stat = await fs.lstat(file);
        let objectId, mode;
        if (stat.isSymbolicLink()) {
          const target = await fs.readlink(file);
          await safePath(member.root, path.relative(member.root, path.resolve(path.dirname(file), target)));
          const link = Buffer.from(target);
          requireThat(link.length <= LIMITS.artifact, 'CAPACITY', `Symlink target exceeds ${LIMITS.artifact} bytes: ${name}`);
          objectId = gitBlobId(link, objectFormat);
          mode = '120000';
        } else {
          requireThat(stat.size <= LIMITS.artifact, 'CAPACITY', `Changed file exceeds ${LIMITS.artifact} bytes: ${name}`);
          objectId = await git(member.root, ['hash-object', `--path=${name}`, '--', name]);
          const indexedMode = effective.get(name)?.find(entry => entry[2] === '0')?.[0];
          mode = !coreFileMode ?
            (['100644', '100755'].includes(indexedMode) ? indexedMode : '100644') :
            (stat.mode & 0o100) ? '100755' : '100644';
        }
        effective.set(name, [[mode, objectId, '0']]);
      } catch (error) {
        if (error.code === 'ENOENT') effective.delete(name);
        else throw error;
      }
    }
    const files = [...effective].map(([name, entries]) => [name, entries.sort()]).sort(([left], [right]) => left.localeCompare(right));
    sources.push({ repositoryId: member.repositoryId, revision: actual.head, contentDigest: digest(files) });
  }
  return sources;
}
export function candidateContentDigest(sources) {
  return digest(sources.map(source => ({
    repositoryId: source.repositoryId,
    contentDigest: source.contentDigest,
  })));
}
export async function committedSourceSnapshot(member, manifest, revision) {
  requireThat(typeof revision === 'string' && /^[a-f0-9]{40,64}$/u.test(revision),
    'INPUT', 'Committed candidate source revision must be a full commit ID');
  const documents = new Set(manifest.artifacts.filter(artifact =>
    artifact.kind === 'git' && artifact.repositoryId === member.repositoryId).map(artifact => artifact.path));
  const included = name => !documents.has(name) &&
    (!name.startsWith('.sdlc/') || name === '.sdlc/config.json');
  const entries = (await git(member.root, ['ls-tree', '-r', '-z', revision])).split('\0').filter(Boolean);
  const files = entries.map(entry => {
    const tab = entry.indexOf('\t');
    const [mode, type, objectId] = entry.slice(0, tab).split(' ');
    const name = entry.slice(tab + 1);
    return { name, mode, type, objectId };
  }).filter(entry => included(entry.name))
    .map(entry => [entry.name, [[entry.mode, entry.objectId, '0']]])
    .sort(([left], [right]) => left.localeCompare(right));
  return { repositoryId: member.repositoryId, revision, contentDigest: digest(files) };
}
export async function candidateStamp(metadata, manifest) {
  const members = [];
  for (const member of metadata.members) {
    const actual = await validateBinding(member);
    const index = await git(member.root, ['ls-files', '--stage', '-z']);
    const changed = await git(member.root, ['diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z']);
    const untracked = await git(member.root, ['ls-files', '--others', '--exclude-standard', '-z']);
    const documents = new Set(manifest.artifacts.filter(a => a.kind === 'git' && a.repositoryId === member.repositoryId).map(a => a.path));
    const included = name => !documents.has(name) && (!name.startsWith('.sdlc/') || name === '.sdlc/config.json');
    const indexed = index.split('\0').filter(Boolean).filter(entry => included(entry.slice(entry.indexOf('\t') + 1)));
    const names = [...new Set([...changed.split('\0'), ...untracked.split('\0')].filter(name => name && included(name)))].sort();
    requireThat(names.length <= 20000, 'CAPACITY', 'Too many changed files for a bounded managed dispatch check');
    const dirty = [];
    for (const name of names) {
      try {
        await safePath(member.root, name);
        const file = path.resolve(member.root, name);
        const stat = await fs.lstat(file, { bigint: true });
        if (stat.isSymbolicLink()) {
          const link = await fs.readlink(file);
          await safePath(member.root, path.relative(member.root, path.resolve(path.dirname(file), link)));
          dirty.push([name, 'symlink', link]);
        } else {
          dirty.push([name, String(stat.size), String(stat.mtimeNs), String(stat.ctimeNs), String(stat.mode)]);
        }
      } catch (error) { if (error.code === 'ENOENT') dirty.push([name, 'deleted']); else throw error; }
    }
    members.push({ repositoryId: member.repositoryId, revision: actual.head, index: digest(indexed), dirty });
  }
  return digest(members);
}
export function validateTests(tests) {
  requireThat(Array.isArray(tests) && tests.length > 0 && tests.length <= 100, 'INPUT', 'Provide 1..100 required test definitions');
  requireThat(new Set(tests.map(test => test.id)).size === tests.length, 'INPUT', 'Duplicate test ID');
  for (const test of tests) {
    object(test, ['id', 'environment', 'level', 'checkpoint', 'mode', 'owner', 'location', 'implementation', 'expected'],
      ['id', 'environment', 'level', 'checkpoint', 'mode', 'owner', 'location', 'implementation', 'expected']);
    id(test.id); choice(test.environment, ['local', 'DEV', 'STAGING'], 'test environment');
    choice(test.checkpoint, ['pre-review', 'review', 'post-review', 'DEV', 'STAGING'], 'test checkpoint');
    requireThat((test.environment === 'DEV') === (test.checkpoint === 'DEV') &&
      (test.environment === 'STAGING') === (test.checkpoint === 'STAGING') &&
      (test.environment === 'local') === ['pre-review', 'review', 'post-review'].includes(test.checkpoint),
    'INPUT', 'Test checkpoint must match its execution environment');
    choice(test.mode, ['automated', 'semi-automated', 'manual'], 'test mode');
    choice(test.owner, STAGING_OWNERS, 'test execution owner');
    for (const field of ['level', 'location', 'implementation']) text(test[field], field, 500);
    text(test.expected, 'expected', 2000);
    if (test.mode === 'manual') requireThat(test.owner === 'user', 'HOST', 'Manual tests belong to the user');
  }
  requireThat(tests.some(test => testCheckpoint(test) === 'pre-review' && test.level === 'unit'),
    'INPUT', 'The required pre-Review local sequence must begin with unit tests');
}
export async function startCycle(store, input, transactionOptions = {}) {
  object(input, ['workItemId', 'tests', 'configDigest', 'cause', 'assuranceToken'], ['workItemId', 'configDigest', 'cause']);
  const specification = await resolveTestSpecification(store, input.workItemId, input.tests);
  validateTests(specification.tests); text(input.configDigest, 'configuration digest'); text(input.cause, 'restart cause', 300);
  if (input.assuranceToken) text(input.assuranceToken, 'assurance token');
  let assuranceTokens = [];
  const result = await store.transaction(input.workItemId, async tx => {
    const marker = tx.all().find(record => record.type === 'assurance-marker');
    assuranceTokens = input.assuranceToken ? [input.assuranceToken] :
      (marker?.obligations ?? []).map(obligation => obligation.token);
    requireThat(tx.checkpoint.phase === 'coding', 'PHASE', 'Validation cycles require Coding authority');
    const sources = await candidateSnapshot(tx.metadata, tx.manifest);
    const candidateDigest = candidateContentDigest(sources);
    const testSpecDigest = specification.digest;
    const previous = currentCycle(tx.all(), tx.checkpoint);
    const assuranceMarker = tx.all().find(record => record.type === 'assurance-marker');
    const assuranceMarkerPending = Boolean(assuranceMarker);
    const assuranceForceNewCycle = assuranceMarker?.forceNewCycle === true ||
      (assuranceMarkerPending && !input.assuranceToken);
    if (previous && !previous.assuranceInvalidated &&
        !assuranceForceNewCycle &&
        previous.candidateDigest === candidateDigest &&
        previous.testSpecDigest === testSpecDigest &&
        previous.configDigest === input.configDigest) {
      if (digest(previous.sources) !== digest(sources)) {
        previous.sources = sources;
        tx.put(previous);
      }
      return { cycle: previous, reset: false, assuranceRechecked: assuranceMarkerPending };
    }
    const cycle = { type: 'cycle', id: newId('cycle'), workItemId: input.workItemId,
      generation: (previous?.generation ?? 0) + 1, candidateDigest, sources, configDigest: input.configDigest,
      testSpecDigest, tests: specification.tests, results: {}, artifacts: {}, deployments: {}, reviewRef: null,
      step: 'local-testing', pendingPlanSync: true, cause: input.cause, createdAt: now(store.clock),
      lastDeploymentSequence: 0 };
    tx.put(cycle);
    tx.checkpoint.artifactGeneration++;
    return { cycle, reset: true, nextAction: 'Run the full local unit suite, then all remaining required local tests. No DEV action is authorized.' };
  }, transactionOptions);
  for (const assuranceToken of assuranceTokens) {
    requireThat(await store.clearAssurancePending(input.workItemId, assuranceToken),
      'STALE', 'Another tool action requires a newer candidate assurance recheck');
  }
  try {
    await synchronizeTestPlan(store, input.workItemId, transactionOptions);
  } catch (error) {
    await store.markAssurancePending(input.workItemId,
      `Test Plan synchronization failed (${error.code ?? 'ERROR'})`,
      { forceNewCycle: true });
    throw error;
  }
  return result;
}
export async function invalidateCycleAssurance(store, workItemId, cause) {
  text(cause, 'cycle invalidation cause', 300);
  await store.markAssurancePending(workItemId, cause, { forceNewCycle: true });
  return store.transaction(workItemId, tx => {
    const cycle = currentCycle(tx.all(), tx.checkpoint);
    if (!cycle) return { invalidated: false };
    cycle.results = {};
    cycle.artifacts = {};
    cycle.deployments = {};
    cycle.reviewRef = null;
    cycle.assuranceInvalidated = true;
    cycle.step = 'candidate-unverified';
    cycle.pendingPlanSync = true;
    cycle.cause = cause;
    tx.put(cycle);
    tx.checkpoint.artifactGeneration++;
    return { invalidated: true, cycleId: cycle.id };
  }, { allowRecoveryRequired: true });
}
export async function invalidateEnvironmentAssurance(store, workItemId, environments, cause) {
  const requested = new Set(environments.filter(environment =>
    ['DEV', 'STAGING'].includes(environment)));
  if (requested.has('DEV')) requested.add('STAGING');
  const affected = [...requested];
  if (!affected.length) return { invalidated: false };
  text(cause, 'environment invalidation cause', 300);
  return store.transaction(workItemId, tx => {
    const cycle = currentCycle(tx.all(), tx.checkpoint);
    if (!cycle) return { invalidated: false };
    for (const environment of affected) {
      delete cycle.artifacts[environment];
      delete cycle.deployments[environment];
      for (const test of cycle.tests.filter(item => item.environment === environment)) {
        delete cycle.results[test.id];
      }
      cycle.invalidatedEnvironments = [...new Set([
        ...(cycle.invalidatedEnvironments ?? []),
        ...affected,
      ])].sort();
      cycle.environmentInvalidationSequences ??= {};
      for (const environment of affected) {
        const latestSequence = Math.max(0, ...tx.all().filter(record =>
          record.type === 'operation' &&
          record.class === 'deploy' &&
          record.cycleId === cycle.id &&
          record.action.environment === environment)
          .map(record => record.deploymentSequence ?? 0));
        cycle.environmentInvalidationSequences[environment] = Math.max(
          cycle.environmentInvalidationSequences[environment] ?? 0,
          latestSequence);
      }
    }
    cycle.step = 'environment-unmanaged-uncertain';
    cycle.pendingPlanSync = true;
    cycle.cause = cause;
    tx.put(cycle);
    tx.checkpoint.artifactGeneration++;
    return { invalidated: true, environments: affected };
  }, { allowRecoveryRequired: true });
}
export function checkTestStart(cycle, records, test, { unitFirstOverride = false } = {}) {
  requireThat(cycle, 'EVIDENCE', 'Start a validation cycle first');
  if (testCheckpoint(test) === 'pre-review' && test.level !== 'unit' && !unitFirstOverride) {
    const units = cycle.tests.filter(t => testCheckpoint(t) === 'pre-review' && t.level === 'unit');
    requireThat(units.every(t => records.find(r => r.id === cycle.results[t.id])?.status === 'Passed'),
      'UNIT_FIRST', 'Run the full required local unit suite before other local tests');
  }
}
function testEvidenceSourceTime(evidence, records) {
  if (!evidence) return Number.NEGATIVE_INFINITY;
  if (evidence.operationId) {
    const operation = records.find(record =>
      record.id === evidence.operationId && record.type === 'operation');
    const observed = Date.parse(operation?.updatedAt);
    if (Number.isFinite(observed)) return observed;
  }
  if (evidence.eventId) {
    const event = records.find(record =>
      record.id === evidence.eventId && record.type === 'event');
    const observed = Date.parse(event?.occurredAt);
    if (Number.isFinite(observed)) return observed;
  }
  const observed = Date.parse(evidence.observedAt);
  return Number.isFinite(observed) ? observed : Number.NEGATIVE_INFINITY;
}
export async function recordTest(store, input) {
  object(input, ['workItemId', 'cycleId', 'testId', 'status', 'evidenceRef', 'runId', 'artifactId', 'deploymentId', 'operationId', 'expectedMet', 'owner', 'host', 'activity', 'eventId'],
    ['workItemId', 'cycleId', 'testId', 'status']);
  choice(input.status, ['NotRun', 'Passed', 'Failed'], 'test status');
  const result = await store.transaction(input.workItemId, async tx => {
    const cycle = currentCycle(tx.all(), tx.checkpoint);
    requireThat(cycle?.id === input.cycleId, 'STALE', 'Late result belongs to a historical validation cycle');
    requireThat(!assurancePending(cycle, tx.all()), 'STALE',
      'Validation assurance was invalidated; start a new cycle before recording test evidence');
    requireThat(candidateContentDigest(await candidateSnapshot(tx.metadata, tx.manifest)) === cycle.candidateDigest, 'STALE', 'Candidate changed; start local revalidation from unit tests');
    requireThat(await currentTestSpecification(store, input.workItemId, cycle.tests) === cycle.testSpecDigest, 'STALE', 'Test specification changed; restart validation');
    const test = cycle.tests.find(t => t.id === input.testId);
    requireThat(test, 'INPUT', 'Test is not part of the current specification');
    requireThat(!cycle.invalidatedEnvironments?.includes(test.environment), 'STALE',
      `${test.environment} assurance is invalidated; reconcile or complete a new managed deployment`);
    let operation;
    let stagingExecution;
    if (input.operationId) {
      const operationId = id(input.operationId, 'operation ID');
      operation = tx.get(operationId);
      if (!operation) {
        operation = await readJson(path.join(store.workPath(input.workItemId),
          'evidence', `${operationId}.json`), { optional: true });
        if (operation) tx.put(operation);
      }
      requireThat(operation?.type === 'operation' && operation.class === 'test' &&
        operation.id === operationId && operation.workItemId === input.workItemId &&
        operation.cycleId === cycle.id && operation.candidateDigest === cycle.candidateDigest &&
        ['dispatching', 'running', 'succeeded', 'failed'].includes(operation.status) &&
        operation.action.testId === test.id && operation.action.environment === test.environment &&
        (test.environment !== 'DEV' || (operation.action.deploymentId === input.deploymentId &&
          operation.action.artifactId === input.artifactId)),
      'OPERATION', 'Test evidence operation does not match the planned test execution');
      if (test.environment === 'STAGING') {
        const deployment = tx.get(cycle.deployments.STAGING);
        const configuration = await loadConfig(tx.metadata,
          deployment?.repositoryId ?? operation.repositoryId);
        stagingExecution = effectiveStagingExecution(tx.all(), cycle,
          configuration, {
            action: operation.action,
            clock: store.clock,
          });
        requireThat(stagingExecutionMatches(stagingExecution,
          operation.action.owner, operation.action.host),
        'OPERATION',
        'STAGING test operation owner/location differs from the effective execution contract');
        requireThat(stagingExecution.overrideId ||
          (operation.action.owner === test.owner &&
            operation.action.host === test.location),
        'OPERATION',
        'STAGING test operation owner/location differs from the Test Plan');
        requireThat(deployment?.status === 'succeeded' &&
          deployment.id === input.deploymentId &&
          deployment.artifactId === input.artifactId &&
          deployment.target === operation.target &&
          deployment.target === operation.action.target &&
          operation.action.deploymentId === input.deploymentId &&
          operation.action.artifactId === input.artifactId,
        'OPERATION',
        'STAGING test operation does not match the current deployment and artifact');
      } else {
        requireThat(operation.action.owner === test.owner &&
          operation.action.host === test.location,
        'OPERATION',
        'Test evidence operation does not match the planned owner/location');
      }
      if (input.status !== 'NotRun') {
        requireThat(['succeeded', 'failed'].includes(operation.status),
          'OPERATION', 'Conclusive test evidence requires a terminal execution operation');
        if (operation.status === 'failed') requireThat(input.status === 'Failed',
          'EVIDENCE', 'A failed test operation cannot produce a passing test result');
        if (operation.expectedMet !== undefined) requireThat(operation.expectedMet === input.expectedMet,
          'EVIDENCE', 'Test evidence expected-result evaluation differs from its operation');
      }
    }
    const testAction = operation ? { ...operation.action, operationId: operation.id } : {
      class: 'test', repositoryId: tx.metadata.coordinatorId, environment: test.environment,
      testId: test.id, owner: input.owner ?? test.owner,
      host: input.host ?? test.location,
    };
    const unitFirstOverride = applicableOverride(tx.all(), 'unit-first', testAction,
      { cycleId: cycle.id, clock: store.clock });
    checkTestStart(cycle, tx.all(), test, { unitFirstOverride: Boolean(unitFirstOverride) });
    if (test.environment === 'STAGING') {
      const deployment = tx.get(cycle.deployments.STAGING);
      testAction.repositoryId = deployment?.repositoryId ??
        testAction.repositoryId;
      testAction.target = deployment?.target;
      testAction.deploymentId = deployment?.id;
      testAction.artifactId = deployment?.artifactId;
      if (!stagingExecution) {
        const configuration = await loadConfig(tx.metadata,
          deployment?.repositoryId ?? tx.metadata.coordinatorId);
        stagingExecution = effectiveStagingExecution(tx.all(), cycle,
          configuration, { action: testAction, clock: store.clock });
      }
      requireThat(deployment?.status === 'succeeded' &&
        stagingExecutionMatches(stagingExecution,
          testAction.owner, testAction.host) &&
        (stagingExecution.overrideId ||
          (testAction.owner === test.owner &&
            testAction.host === test.location)),
      'HOST',
      'STAGING evidence owner/location does not match its effective execution contract');
      if (!operation) {
        const decision = tx.get(input.eventId);
        requireThat(decision?.kind === 'staging-result' &&
          boundToCycle(decision.effect, cycle) &&
          decision.effect.testIds?.includes(test.id) &&
          decision.effect.outcome === input.status &&
          decision.effect.owner === testAction.owner &&
          decision.effect.host === testAction.host &&
          deployment.id === decision.effect.deploymentId &&
          decision.effect.artifactId === deployment.artifactId &&
          latestStagingResultEvent(tx.all(), cycle, test.id,
            store.clock)?.id === decision.id,
        'PROVENANCE',
        'STAGING evidence requires a matching captured result for this planned test');
        requireThat(input.deploymentId === decision.effect.deploymentId &&
          input.artifactId === decision.effect.artifactId,
        'EVIDENCE',
        'STAGING evidence identity differs from the captured result');
      }
    }
    if (test.environment === 'DEV') {
      const deployment = tx.get(cycle.deployments.DEV);
      requireThat(deployment?.status === 'succeeded' && deployment.id === input.deploymentId &&
        deployment.artifactId === input.artifactId, 'EVIDENCE', 'DEV tests require the current successful deployment and artifact');
      if (operation) requireThat(operation.target === deployment.target &&
        operation.action.target === deployment.target, 'EVIDENCE',
      'DEV test operation target differs from the current deployment target');
      const authorizationAction = operation ? testAction : {
        ...testAction, repositoryId: deployment.repositoryId, target: deployment.target,
      };
      requireThat(hasEnvironmentGrant(tx.all(), cycle, 'DEV', { ...authorizationAction,
        configDigest: cycle.configDigest }, store.clock),
        'AUTHORITY', 'Current-candidate DEV execution authority is absent');
    }
    if (input.status !== 'NotRun') {
      text(input.evidenceRef, 'execution evidence reference');
      requireThat(typeof input.expectedMet === 'boolean' && input.expectedMet === (input.status === 'Passed'), 'EVIDENCE', 'Conclusive status must match the expected-result evaluation');
      requireThat(test.environment === 'STAGING' ?
        stagingExecutionMatches(stagingExecution, input.owner, input.host) &&
          (stagingExecution.overrideId ||
            (input.owner === test.owner &&
              input.host === test.location)) :
        input.owner === test.owner && input.host === test.location,
      'HOST',
      'Execution owner/location does not match the effective Test Plan contract');
    }
    const evidence = { type: 'test-evidence', id: newId('evidence'), workItemId: input.workItemId,
      sequence: Math.max(cycle.lastEvidenceSequence ?? 0,
        ...tx.all().filter(r => r.type === 'test-evidence' && r.cycleId === cycle.id).map(r => r.sequence ?? 0)) + 1,
      cycleId: cycle.id, testId: test.id, testSpecDigest: cycle.testSpecDigest, candidateDigest: cycle.candidateDigest,
      environment: test.environment, implementation: test.implementation, status: input.status,
      observedAt: now(store.clock), activity: input.activity ?? (input.status === 'NotRun' ? 'pending' : 'complete') };
    for (const key of ['evidenceRef', 'runId', 'artifactId', 'deploymentId', 'operationId', 'expectedMet', 'owner', 'host', 'eventId']) if (input[key] !== undefined) evidence[key] = input[key];
    tx.put(evidence);
    const previous = tx.get(cycle.results[test.id]);
    const rank = { Passed: 0, NotRun: 1, Failed: 2 };
    const nextTime = testEvidenceSourceTime(evidence, tx.all());
    const previousTime = testEvidenceSourceTime(previous, tx.all());
    const directTie = nextTime === previousTime &&
      !evidence.operationId && !evidence.eventId &&
      !previous?.operationId && !previous?.eventId;
    if (!previous || nextTime > previousTime ||
        (directTie && evidence.sequence > previous.sequence) ||
        (nextTime === previousTime && !directTie &&
          rank[evidence.status] >= rank[previous.status])) {
      cycle.results[test.id] = evidence.id;
    }
    cycle.lastEvidenceSequence = evidence.sequence;
    cycle.step = stagePassed(cycle, tx.all(), 'DEV') ? 'awaiting-dev-completion' :
      stagePassed(cycle, tx.all(), 'local') ? 'awaiting-local-completion' : 'local-testing';
    tx.put(cycle);
    cycle.pendingPlanSync = true;
    return evidence;
  });
  await synchronizeTestPlan(store, input.workItemId);
  return result;
}
export async function recordArtifact(store, input) {
  object(input, ['workItemId', 'cycleId', 'artifactId', 'environment', 'sourceDigest', 'configDigest', 'buildRunId', 'name', 'artifactType', 'evidenceRef', 'status'],
    ['workItemId', 'cycleId', 'artifactId', 'environment', 'sourceDigest', 'configDigest', 'buildRunId', 'name', 'artifactType', 'evidenceRef', 'status']);
  return store.transaction(input.workItemId, async tx => {
    const cycle = currentCycle(tx.all(), tx.checkpoint);
    requireThat(cycle?.id === input.cycleId && cycle.candidateDigest === input.sourceDigest && cycle.configDigest === input.configDigest, 'STALE', 'Artifact source/configuration differs from the candidate');
    requireThat(!assurancePending(cycle, tx.all()), 'STALE',
      'Validation assurance was invalidated; start a new cycle before selecting artifacts');
    choice(input.environment, ['DEV', 'STAGING'], 'artifact environment');
    requireThat(input.status === 'succeeded', 'EVIDENCE', 'Only successful, available artifacts may be selected');
    for (const key of ['artifactId', 'buildRunId', 'name', 'artifactType', 'evidenceRef']) text(input[key], key);
    const archived = [];
    for (const name of await fs.readdir(path.join(
      store.workPath(input.workItemId), 'evidence')).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    })) {
      if (!name.endsWith('.json')) continue;
      const record = await readJson(path.join(store.workPath(input.workItemId),
        'evidence', name), { limit: LIMITS.workingSet });
      if (record.type === 'artifact' && record.cycleId === cycle.id &&
          record.environment === input.environment) archived.push(record);
    }
    const sequence = Math.max(0, ...[...tx.all(), ...archived]
      .filter(item => item.type === 'artifact' &&
        item.cycleId === cycle.id &&
        item.environment === input.environment)
      .map(item => item.sequence ?? 0)) + 1;
    const record = { ...input, type: 'artifact',
      id: `artifact-${digest({ cycle: cycle.id, environment: input.environment,
        artifactId: input.artifactId, sequence }).slice(0, 40)}`,
      sequence,
      selectedAt: now(store.clock) };
    tx.put(record);
    cycle.artifacts[input.environment] = record.id;
    tx.put(cycle);
    return record;
  });
}
export async function stagingHandoff(store, workItemId) {
  const state = await store.load(workItemId);
  const cycle = currentCycle(state.records, state.checkpoint);
  const deployment = state.records.find(r => r.id === cycle?.deployments.STAGING);
  requireThat(deployment?.status === 'succeeded', 'EVIDENCE', 'No current successful STAGING deployment is available');
  const configuration = await loadConfig(state.metadata,
    deployment.repositoryId);
  const action = {
    class: 'test',
    repositoryId: deployment.repositoryId,
    environment: 'STAGING',
    target: deployment.target,
  };
  const execution = effectiveStagingExecution(state.records, cycle,
    configuration, { action, clock: store.clock });
  requireThat(execution.resolved, 'CONFIG', execution.reason);
  const tests = cycle.tests.filter(test => test.environment === 'STAGING');
  requireThat(tests.length > 0, 'INPUT',
    'No STAGING tests are planned');
  requireThat(execution.overrideId || tests.every(test =>
    stagingExecutionMatches(execution, test.owner, test.location)),
  'CONFIG',
  'STAGING Test Plan owner/location does not match the environment contract');
  const guidance = stagingExecutionGuidance(execution, tests);
  return { ...guidance, cycleId: cycle.id, candidateDigest: cycle.candidateDigest,
    testSpecDigest: cycle.testSpecDigest, deploymentId: deployment.id, artifactId: deployment.artifactId,
    target: deployment.target, runId: deployment.handle,
    overrideId: execution.overrideId, tests };
}
import * as fs from 'node:fs/promises';
