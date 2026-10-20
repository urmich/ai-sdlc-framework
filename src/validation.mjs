import { LIMITS, budget, choice, digest, id, newId, now, object, requireThat, text } from './core.mjs';
import { readBytes, readJson, safePath } from './files.mjs';
import { git, validateBinding } from './git.mjs';
import { currentTestSpecification, loadConfig, resolveTestSpecification,
  synchronizeTestPlan } from './artifacts.mjs';
import { applicableOverride, assurancePending, boundToCycle, currentCycle, currentTestEvidence, hasEnvironmentGrant, latestStagingResultEvent, stagePassed, testCheckpoint } from './authority.mjs';
import { cycleTests, OUTCOME_PAGE_SIZE, requireCatalogSpecification, stageValidationObject,
  validateTestDefinitions } from './validation-catalog.mjs';
import { appendTestObservation, bindExecutionEvidence, initializeReferencedCycle,
  lookupOperation, lookupTestEvidence, observationAfterReset, resetCycleResults, retainedPayloadReference,
  sameExecutionSources, selectTestObservation, testResetBarrier } from './validation-evidence.mjs';
import { createEvidenceBundle, readinessCaseProof, refreshReadinessEvaluation,
  requireReadinessEvaluation } from './validation-readiness.mjs';
import { effectiveStagingExecution, stagingExecutionGuidance,
  stagingExecutionMatches } from './staging.mjs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { currentDeployment, hasCurrentExecutionProof, hasImmutableArtifactIdentity, matchesProducerExecution,
  requireCurrentCandidateRevisions, requireCurrentDeployment,
  requireCurrentRepositoryEvidence, verifiedDestination } from './current-evidence.mjs';
import { selectedFetchRemote } from './git.mjs';
import { validateSelectedFetchRemote } from './repository-observations.mjs';
import { validateCurrentExecutionIdentity } from './provider-adapters.mjs';

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
          // Windows metadata churn is not a source edit; bind exact bytes instead.
          dirty.push([name, digest(await readBytes(file, LIMITS.artifact)), String(stat.mode)]);
        }
      } catch (error) { if (error.code === 'ENOENT') dirty.push([name, 'deleted']); else throw error; }
    }
    members.push({ repositoryId: member.repositoryId, revision: actual.head, index: digest(indexed), dirty });
  }
  return digest(members);
}
export function validateTests(tests) {
  validateTestDefinitions(tests, { inline: true });
}
export async function startCycle(store, input, transactionOptions = {}) {
  object(input, ['workItemId', 'tests', 'configDigest', 'cause', 'assuranceToken'], ['workItemId', 'configDigest', 'cause']);
  text(input.configDigest, 'configuration digest'); text(input.cause, 'restart cause', 300);
  if (input.assuranceToken) text(input.assuranceToken, 'assurance token');
  let assuranceTokens = [];
  const result = await store.transaction(input.workItemId, async tx => {
    const specification = await resolveTestSpecification(store, input.workItemId, input.tests);
    validateTestDefinitions(specification.tests, { inline: specification.tests.length <= 100 });
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
      requireCatalogSpecification(previous, specification);
      if (digest(previous.sources) !== digest(sources)) {
        const revisionChanged = previous.sources.some(source =>
          sources.find(current => current.repositoryId === source.repositoryId)?.revision !== source.revision);
        if (revisionChanged) {
          previous.artifacts = {};
          previous.deployments = {};
          resetCycleResults(tx, previous, test => test.environment !== 'local');
          previous.invalidatedEnvironments = [...new Set([
            ...(previous.invalidatedEnvironments ?? []), 'DEV', 'STAGING',
          ])];
          previous.environmentInvalidationSequences ??= {};
          for (const environment of ['DEV', 'STAGING']) {
            previous.environmentInvalidationSequences[environment] = Math.max(
              previous.environmentInvalidationSequences[environment] ?? 0,
              previous.lastDeploymentSequence ?? 0);
          }
          previous.step = 'local-testing';
          previous.pendingPlanSync = true;
        }
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
    if (specification.tests.length > 100) initializeReferencedCycle(tx, cycle, specification);
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
    resetCycleResults(tx, cycle);
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
      resetCycleResults(tx, cycle, test => test.environment === environment);
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
export function checkTestStart(cycle, records, test, { unitFirstOverride = false, clock = Date } = {}) {
  requireThat(cycle, 'EVIDENCE', 'Start a validation cycle first');
  if (testCheckpoint(test) === 'pre-review' && test.level !== 'unit' && !unitFirstOverride) {
    const units = cycleTests(cycle).filter(t => testCheckpoint(t) === 'pre-review' && t.level === 'unit');
    requireThat(units.every(t => currentTestEvidence(cycle, records, t, clock)?.status === 'Passed'),
      'UNIT_FIRST', 'Run the full required local unit suite before other local tests');
  }
}
async function recordTestInTransaction(store, input, tx) {
  object(input, ['workItemId', 'cycleId', 'testId', 'status', 'evidenceRef', 'runId', 'artifactId', 'deploymentId', 'operationId', 'expectedMet', 'owner', 'host', 'activity', 'eventId'],
    ['workItemId', 'cycleId', 'testId', 'status']);
  choice(input.status, ['NotRun', 'Passed', 'Failed'], 'test status');
    const cycle = currentCycle(tx.all(), tx.checkpoint);
    requireThat(cycle?.id === input.cycleId, 'STALE', 'Late result belongs to a historical validation cycle');
    requireThat(!assurancePending(cycle, tx.all()), 'STALE',
      'Validation assurance was invalidated; start a new cycle before recording test evidence');
    if (!tx.testAdmissionSnapshot) {
      const sources = await candidateSnapshot(tx.metadata, tx.manifest);
      requireThat(candidateContentDigest(sources) === cycle.candidateDigest &&
        digest(sources) === digest(cycle.sources), 'STALE', 'Candidate source changed; restart or reselect the validation cycle');
      const specification = await resolveTestSpecification(store, input.workItemId, cycleTests(cycle));
      requireThat(specification.digest === cycle.testSpecDigest, 'STALE', 'Test specification changed; restart validation');
      requireCatalogSpecification(cycle, specification);
      tx.testAdmissionSnapshot = { sources, specification };
    }
    const test = cycleTests(cycle).find(t => t.id === input.testId);
    requireThat(test, 'INPUT', 'Test is not part of the current specification');
    requireThat(!cycle.invalidatedEnvironments?.includes(test.environment), 'STALE',
      `${test.environment} assurance is invalidated; reconcile or complete a new managed deployment`);
    if (test.environment !== 'local') {
      await requireCurrentCandidateRevisions(tx.metadata, cycle, tx.all());
      const deployment = tx.get(cycle.deployments[test.environment]);
      requireCurrentDeployment(cycle, tx.all(), deployment, test.environment);
      await requireCurrentRepositoryEvidence(tx.metadata, cycle, tx.all(),
        deployment.repositoryId, deployment.intendedOutcome?.target);
    }
    let operation;
    let stagingExecution;
    if (input.operationId) {
      const operationId = id(input.operationId, 'operation ID');
      operation = lookupOperation(tx.all(), operationId);
      requireThat(operation?.type === 'operation' && operation.class === 'test' &&
        operation.id === operationId && operation.workItemId === input.workItemId &&
        operation.cycleId === cycle.id && operation.candidateDigest === cycle.candidateDigest &&
        ['dispatching', 'submitted', 'running', 'succeeded', 'failed', 'cancelled'].includes(operation.status) &&
        operation.action.testId === test.id && operation.action.environment === test.environment &&
        (test.environment === 'local' || input.status === 'NotRun' ||
          (hasCurrentExecutionProof(operation, tx.all()) &&
            operation.resultProof?.status === operation.status &&
            operation.resultProof.dispatchId === operation.id &&
            operation.resultProof.intendedOutcomeDigest === operation.intendedOutcome?.digest)) &&
        (test.environment !== 'DEV' || (operation.action.deploymentId === input.deploymentId &&
          operation.action.artifactId === input.artifactId)),
      'OPERATION', 'Test evidence operation does not match the planned test execution');
      if (input.status === 'NotRun') {
        requireThat(['dispatching', 'submitted', 'running'].includes(operation.status) ||
          operation.status === 'cancelled' &&
            (input.activity === undefined || input.activity === 'cancelled'),
        'OPERATION', 'A terminal test operation cannot accept late pending or running progress');
        requireThat((input.expectedMet === undefined || input.expectedMet === false) &&
          (input.owner === undefined || input.owner === operation.action.owner) &&
          (input.host === undefined || input.host === operation.action.host),
        'EVIDENCE', 'Nonconclusive evidence cannot claim a met expectation or a different execution owner/host');
      }
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
        requireThat(currentDeployment(cycle, tx.all(), deployment, 'STAGING') &&
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
        const normalized = tx.normalizedImports?.get(test.id);
        if (normalized) requireThat(
          digest(operation.resultProof?.executionIdentity ?? null) === digest(normalized.context.producer) &&
            operation.resultProof?.attemptCapability === normalized.context.attemptCapability,
          'PROVENANCE', 'Normalized report belongs to a different managed execution or attempt');
      }
    }
    const testAction = operation ? { ...operation.action, operationId: operation.id } : {
      class: 'test', repositoryId: tx.metadata.coordinatorId, environment: test.environment,
      testId: test.id, owner: input.owner ?? test.owner,
      host: input.host ?? test.location,
    };
    const unitFirstOverride = applicableOverride(tx.all(), 'unit-first', testAction,
      { cycleId: cycle.id, clock: store.clock });
    if (!(tx.normalizedImports?.has(test.id) && input.status === 'NotRun')) {
      checkTestStart(cycle, tx.all(), test, { unitFirstOverride: Boolean(unitFirstOverride), clock: store.clock });
    }
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
      requireThat(currentDeployment(cycle, tx.all(), deployment, 'STAGING') &&
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
      requireThat(currentDeployment(cycle, tx.all(), deployment, 'DEV') &&
        deployment.id === input.deploymentId &&
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
      if (tx.normalizedImports?.has(test.id) && test.environment !== 'local') {
        const artifact = tx.get(cycle.artifacts[test.environment]);
        requireThat(artifact?.type === 'artifact' && artifact.artifactId === input.artifactId &&
          tx.normalizedImports.get(test.id).context.artifacts.some(item =>
          item.sha256 === artifact.artifactSha256), 'EVIDENCE',
        'Normalized environment evidence did not test the current deployed artifact');
      }
    }
    const evidence = { type: 'test-evidence', id: newId('evidence'), workItemId: input.workItemId,
      sequence: Math.max(cycle.lastEvidenceSequence ?? 0,
        ...tx.all().filter(r => r.type === 'test-evidence' && r.cycleId === cycle.id).map(r => r.sequence ?? 0)) + 1,
      cycleId: cycle.id, testId: test.id, testSpecDigest: cycle.testSpecDigest, candidateDigest: cycle.candidateDigest,
      environment: test.environment, implementation: test.implementation, status: input.status,
      observedAt: now(store.clock), activity: input.activity ?? (input.status === 'NotRun' ? 'pending' : 'complete') };
    for (const key of ['evidenceRef', 'runId', 'artifactId', 'deploymentId', 'operationId', 'expectedMet', 'owner', 'host', 'eventId']) if (input[key] !== undefined) evidence[key] = input[key];
    if (operation && evidence.status === 'NotRun') {
      evidence.owner ??= operation.action.owner;
      evidence.host ??= operation.action.host;
      if (operation.status === 'cancelled') evidence.activity = 'cancelled';
    }
    const imported = tx.normalizedImports?.get(test.id);
    if (imported) Object.assign(evidence, imported.source, {
      configDigest: imported.context.configDigest,
      executionSources: structuredClone(imported.context.sources),
      executionSourceDigest: digest(imported.context.sources),
      retainedPayloadRef: imported.ref,
    });
    requireThat(observationAfterReset(cycle, tx.all(), evidence), 'STALE',
      'Result belongs to an execution before the current reset barrier');
    await bindExecutionEvidence(store, tx, cycle, test, evidence);
    const committed = lookupTestEvidence(cycle, tx.all(), evidence.id);
    if (committed) {
      const content = ({ sequence, observedAt, ...record }) => record;
      requireThat(digest(content(committed)) === digest(content(evidence)), 'ID_CONFLICT',
        'Execution report identity was reused with a different result');
      requireThat(observationAfterReset(cycle, tx.all(), committed), 'STALE',
        'Committed execution report predates the current reset barrier');
      return committed;
    }
    appendTestObservation(tx, cycle, evidence);
    selectTestObservation(cycle, test.id, currentTestEvidence(cycle, tx.all(), test, store.clock));
    cycle.lastEvidenceSequence = evidence.sequence;
    cycle.step = stagePassed(cycle, tx.all(), 'DEV', store.clock) ? 'awaiting-dev-completion' :
      stagePassed(cycle, tx.all(), 'local', store.clock) ? 'awaiting-local-completion' : 'local-testing';
    tx.put(cycle);
    cycle.pendingPlanSync = true;
    return evidence;
}
export async function recordTests(store, input) {
  object(input, ['workItemId', 'cycleId', 'results'], ['workItemId', 'cycleId', 'results']);
  requireThat(Array.isArray(input.results) && input.results.length > 0,
    'INPUT', 'Supply individual test results');
  budget(input, LIMITS.input, 'Test result submission');
  requireThat(new Set(input.results.map(result => result.testId)).size === input.results.length,
    'INPUT', 'A submission cannot contain duplicate test IDs');
  const result = await store.transaction(input.workItemId, async tx => {
    const evidence = [];
    for (const row of input.results) {
      object(row, ['testId', 'status', 'evidenceRef', 'runId', 'artifactId', 'deploymentId',
        'operationId', 'expectedMet', 'owner', 'host', 'activity', 'eventId'], ['testId', 'status']);
      evidence.push(await recordTestInTransaction(store, {
        ...row, workItemId: input.workItemId, cycleId: input.cycleId,
      }, tx));
    }
    requireThat(digest(await candidateSnapshot(tx.metadata, tx.manifest)) ===
      digest(tx.testAdmissionSnapshot.sources) &&
      (await resolveTestSpecification(store, input.workItemId)).digest ===
        tx.testAdmissionSnapshot.specification.digest,
    'STALE', 'Candidate or specification changed during evidence admission');
    return evidence;
  });
  await synchronizeTestPlan(store, input.workItemId);
  return result;
}
function retainReadinessObject(tx, workItemId, content) {
  return stageValidationObject(tx, {
    schemaVersion: 1, kind: 'execution-payload', workItemId, content,
    provenance: { sourceDigest: digest(content), sanitizer: 'sdlc-normalized-v1' },
  });
}
function retainReadinessBundle(tx, workItemId, bundle) {
  const mappings = bundle.objects.map(entry => ({
    originalRef: entry.ref, retainedRef: retainReadinessObject(tx, workItemId, entry.value),
  }));
  const objectMapRefs = [];
  for (let index = 0; index < mappings.length; index += OUTCOME_PAGE_SIZE) {
    objectMapRefs.push(retainReadinessObject(tx, workItemId, {
      kind: 'normalized-object-map', index: objectMapRefs.length,
      objects: mappings.slice(index, index + OUTCOME_PAGE_SIZE),
    }));
  }
  return retainReadinessObject(tx, workItemId, {
    kind: 'normalized-readiness-import', manifest: bundle.manifest,
    manifestRef: bundle.manifestRef, objectMapRefs,
  });
}
export async function recordReadiness(store, input) {
  object(input, ['workItemId', 'cycleId', 'evaluation', 'bindings'],
    ['workItemId', 'cycleId', 'evaluation']);
  id(input.workItemId); id(input.cycleId);
  requireReadinessEvaluation(input.evaluation);
  const bindings = input.bindings ?? [];
  requireThat(Array.isArray(bindings) && new Set(bindings.map(binding => binding.testId)).size ===
    bindings.length, 'INPUT', 'Supply unique managed case bindings');
  for (const binding of bindings) {
    object(binding, ['testId', 'operationId', 'eventId', 'artifactId', 'deploymentId'], ['testId']);
    Object.values(binding).forEach(value => id(value));
  }
  const result = await store.transaction(input.workItemId, async tx => {
    const cycle = currentCycle(tx.all(), tx.checkpoint);
    requireThat(cycle?.id === input.cycleId && tx.checkpoint.phase === 'coding' &&
      !assurancePending(cycle, tx.all()), 'STALE',
    'Normalized admission requires the legitimate current Coding validation cycle');
    const sources = await candidateSnapshot(tx.metadata, tx.manifest);
    const specification = await resolveTestSpecification(store, input.workItemId, cycleTests(cycle));
    requireThat(candidateContentDigest(sources) === cycle.candidateDigest &&
      digest(sources) === digest(cycle.sources) && specification.digest === cycle.testSpecDigest,
    'STALE', 'Candidate or Test Plan changed before normalized admission');
    requireCatalogSpecification(cycle, specification);
    tx.testAdmissionSnapshot = { sources, specification };
    const original = requireReadinessEvaluation(input.evaluation);
    const tests = cycleTests(cycle);
    requireThat(original.spec.cases.every(test => tests.some(planned => planned.id === test.id)) &&
      bindings.every(binding => original.spec.cases.some(test => test.id === binding.testId)),
    'EVIDENCE', 'Normalized cases or bindings are not part of the current managed Test Plan');
    const barriers = original.spec.cases.flatMap(test => {
      const barrier = testResetBarrier(cycle, test.id);
      return barrier ? [{ testId: test.id, notBefore: barrier.at }] : [];
    });
    const evaluation = refreshReadinessEvaluation(input.evaluation, {
      now: now(store.clock), barriers,
    });
    const proofs = evaluation.cases.map(result => readinessCaseProof(evaluation, result.testId));
    for (const proof of proofs) {
      const test = tests.find(test => test.id === proof.definition.id);
      const trace = specification.traceability?.find(row => row.testId === test.id);
      requireThat(proof.context.candidateDigest === cycle.candidateDigest &&
        proof.context.testSpecDigest === cycle.testSpecDigest &&
        proof.context.configDigest === cycle.configDigest &&
        sameExecutionSources(proof.context.sources, cycle.sources) &&
        proof.context.environment === test.environment &&
        proof.definition.mode === test.mode && proof.definition.owner === test.owner &&
        proof.definition.location === test.location &&
        proof.definition.checkpoint === testCheckpoint(test) &&
        proof.definition.expectedDigest === digest(test.expected) &&
        (!trace || digest([...proof.definition.conditions].sort()) ===
          digest([...trace.conditions].sort())),
      'EVIDENCE', 'Normalized execution does not match the authoritative managed case definition');
    }
    const importRef = retainReadinessBundle(tx, input.workItemId, createEvidenceBundle(evaluation));
    const evidence = [];
    const blocked = [];
    tx.normalizedImports = new Map();
    proofs.sort((left, right) => Number(tests.find(test => test.id === right.definition.id).level === 'unit') -
      Number(tests.find(test => test.id === left.definition.id).level === 'unit') ||
      (left.source?.sourceObservedAt ?? '').localeCompare(right.source?.sourceObservedAt ?? ''));
    for (const proof of proofs) {
      const test = tests.find(test => test.id === proof.definition.id);
      const units = tests.filter(test => testCheckpoint(test) === 'pre-review' && test.level === 'unit');
      if (testCheckpoint(test) === 'pre-review' && test.level !== 'unit' &&
          !units.every(unit => {
            const current = currentTestEvidence(cycle, tx.all(), unit, store.clock);
            return current?.status === 'Passed' && current.sourceCompletedAt &&
              proof.source && Date.parse(current.sourceCompletedAt) <= Date.parse(proof.source.sourceStartedAt);
          })) {
        const problem = { testId: test.id, code: 'UNIT_FIRST',
          message: 'Every required local unit execution must complete successfully before this execution starts' };
        blocked.push(problem);
        proof.status = 'NotRun';
        proof.blockers = [...proof.blockers, problem];
        proof.source = null;
      }
      const barrier = testResetBarrier(cycle, test.id);
      if (proof.status === 'NotRun' && barrier && proof.source &&
          Date.parse(proof.source.sourceObservedAt) <= Date.parse(barrier.at)) proof.source = null;
      const assertionPageRefs = [];
      for (let index = 0; index < proof.selected.length; index += OUTCOME_PAGE_SIZE) {
        assertionPageRefs.push(retainReadinessObject(tx, input.workItemId, {
          kind: 'normalized-case-observations', testId: test.id, index: assertionPageRefs.length,
          observations: proof.selected.slice(index, index + OUTCOME_PAGE_SIZE),
        }));
      }
      const ref = retainReadinessObject(tx, input.workItemId, {
        kind: 'normalized-case-admission', cycleId: cycle.id, testId: test.id,
        status: proof.status, importRef, assertionPageRefs, blockers: proof.blockers,
      });
      tx.normalizedImports.set(test.id, { ...proof, ref });
      const binding = bindings.find(binding => binding.testId === test.id) ?? {};
      evidence.push(await recordTestInTransaction(store, {
        ...binding, workItemId: input.workItemId, cycleId: cycle.id, testId: test.id,
        status: proof.status, expectedMet: proof.status === 'Passed',
        owner: test.owner, host: test.location, evidenceRef: retainedPayloadReference(ref),
        activity: proof.status === 'NotRun' ? 'blocked' : 'complete',
      }, tx));
    }
    requireThat(digest(await candidateSnapshot(tx.metadata, tx.manifest)) === digest(sources) &&
      (await resolveTestSpecification(store, input.workItemId)).digest === specification.digest,
    'STALE', 'Candidate or Test Plan changed during normalized admission');
    return { evaluation, evidence, blocked, importRef };
  });
  await synchronizeTestPlan(store, input.workItemId);
  return result;
}
export async function recordTest(store, input) {
  const { workItemId, cycleId, ...result } = input;
  return (await recordTests(store, { workItemId, cycleId, results: [result] }))[0];
}
export async function recordArtifact(store, input) {
  object(input, ['workItemId', 'cycleId', 'artifactId', 'environment', 'sourceDigest', 'configDigest', 'buildRunId', 'name', 'artifactType', 'evidenceRef', 'status',
    'repositoryId', 'localRepositoryPath', 'remoteRepositoryURL',
    'provider', 'connection', 'repositoryRef', 'sourceRevision',
    'artifactRef', 'artifactSha256', 'artifactImmutableVersion',
    'artifactRetrievalContext', 'producingOperationId', 'producerObservation'],
  ['workItemId', 'cycleId', 'artifactId', 'environment', 'sourceDigest',
    'configDigest', 'buildRunId', 'name', 'artifactType', 'evidenceRef', 'status',
    'repositoryId', 'localRepositoryPath', 'remoteRepositoryURL',
    'provider', 'connection', 'repositoryRef', 'sourceRevision',
    'artifactRef', 'producingOperationId', 'producerObservation']);
  const hasDigest = /^[a-f0-9]{64}$/u.test(input.artifactSha256 ?? '') &&
    input.artifactImmutableVersion === undefined &&
    input.artifactRetrievalContext === undefined;
  const hasVersion = input.artifactSha256 === undefined &&
    typeof input.artifactImmutableVersion === 'string' &&
    input.artifactImmutableVersion.length > 0 &&
    typeof input.artifactRetrievalContext === 'string' &&
    input.artifactRetrievalContext.length > 0;
  requireThat(hasDigest || hasVersion, 'INPUT',
    'Artifact requires a SHA-256 digest or immutable version with retrieval context');
  return store.transaction(input.workItemId, async tx => {
    const cycle = currentCycle(tx.all(), tx.checkpoint);
    requireThat(cycle?.id === input.cycleId && cycle.candidateDigest === input.sourceDigest && cycle.configDigest === input.configDigest, 'STALE', 'Artifact source/configuration differs from the candidate');
    requireThat(!assurancePending(cycle, tx.all()), 'STALE',
      'Validation assurance was invalidated; start a new cycle before selecting artifacts');
    const source = cycle.sources.find(item => item.repositoryId === input.repositoryId);
    const member = tx.metadata.members.find(item => item.repositoryId === input.repositoryId);
    requireThat(member && source?.revision === input.sourceRevision &&
      /^[a-f0-9]{40,64}$/u.test(input.sourceRevision) &&
      (await validateBinding(member)).head === input.sourceRevision &&
      member.root === input.localRepositoryPath,
    'STALE', 'Artifact must match the current bound checkout and exact full candidate commit');
    const config = await loadConfig(tx.metadata, member.repositoryId);
    const selected = await selectedFetchRemote(member, config.remote);
    requireThat(input.remoteRepositoryURL === validateSelectedFetchRemote(selected) &&
      verifiedDestination(tx.all(), input.repositoryId,
        input.localRepositoryPath, input.remoteRepositoryURL, {
          provider: input.provider, connection: input.connection,
          repositoryRef: input.repositoryRef,
        }),
    'EVIDENCE', 'Artifact requires the current verified local checkout and hosted repository');
    const producingOperationId = id(input.producingOperationId, 'producing operation ID');
    const producer = lookupOperation(tx.all(), producingOperationId);
    requireThat(producer?.type === 'operation' &&
      producer.id === producingOperationId &&
      producer.workItemId === input.workItemId &&
      ['build', 'pipeline'].includes(producer.class) &&
      producer.status === 'succeeded' &&
      hasCurrentExecutionProof(producer, tx.all()) &&
      producer.resultProof?.status === 'succeeded' &&
      producer.resultProof.dispatchId === producer.id &&
      producer.resultProof.intendedOutcomeDigest === producer.intendedOutcome?.digest &&
      producer.resultProof.providerResultId === input.buildRunId &&
      producer.cycleId === cycle.id &&
      producer.candidateDigest === cycle.candidateDigest &&
      producer.repositoryId === input.repositoryId &&
      producer.action.provider === input.provider &&
      producer.intendedOutcome.requested.sourceRevision === input.sourceRevision &&
      producer.intendedOutcome.requested.configDigest === input.configDigest &&
      producer.intendedOutcome.target.localRepositoryPath === input.localRepositoryPath &&
      producer.intendedOutcome.target.remoteRepositoryURL === input.remoteRepositoryURL,
    'EVIDENCE', 'Artifact requires a proven producing execution for this revision and configuration');
    requireThat(typeof store.verifyArtifact === 'function', 'ADAPTER',
      'A trusted hosting-service artifact verifier is required');
    const verified = await store.verifyArtifact({
      operation: producer, observation: input.producerObservation,
    });
    object(verified, ['repositoryId', 'localRepositoryPath', 'remoteRepositoryURL',
      'provider', 'connection', 'repositoryRef',
      'sourceRevision', 'configDigest', 'artifactId', 'artifactRef',
      'artifactSha256', 'artifactImmutableVersion', 'artifactRetrievalContext',
      'versionVerified', 'buildRunId', 'name', 'evidenceRef',
      'attemptCapability', 'attemptRef', 'producingExecution'],
    ['repositoryId', 'localRepositoryPath', 'remoteRepositoryURL',
      'provider', 'connection', 'repositoryRef',
      'sourceRevision', 'configDigest', 'artifactId', 'artifactRef',
      'buildRunId', 'name', 'evidenceRef',
      'attemptCapability', 'attemptRef', 'producingExecution']);
    for (const field of ['repositoryId', 'localRepositoryPath',
      'provider', 'connection', 'repositoryRef',
      'remoteRepositoryURL', 'sourceRevision', 'configDigest', 'artifactId',
      'artifactRef', 'artifactSha256', 'artifactImmutableVersion',
      'artifactRetrievalContext', 'buildRunId', 'name', 'evidenceRef']) {
      requireThat(verified[field] === input[field], 'EVIDENCE',
        `Artifact producer did not verify ${field}`);
    }
    requireThat(hasImmutableArtifactIdentity({
      ...verified, artifactVersionVerified: verified.versionVerified,
    }) && (input.artifactImmutableVersion === undefined ||
      verified.versionVerified === true), 'EVIDENCE',
    'Artifact content requires verified immutable identity and retrieval context');
    requireThat(matchesProducerExecution(producer.resultProof, {
      ...input, producingExecution: verified.producingExecution,
      producingAttemptCapability: verified.attemptCapability,
      producingAttemptRef: verified.attemptRef,
    }), 'EVIDENCE',
    'Artifact producing connection, scope, definition, run or attempt differs from its proven execution');
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
    const { producerObservation, ...artifact } = input;
    void producerObservation;
    const currentConfig = await loadConfig(tx.metadata, member.repositoryId);
    requireThat((await validateBinding(member)).head === input.sourceRevision &&
      input.localRepositoryPath === member.root &&
      validateSelectedFetchRemote(await selectedFetchRemote(member, currentConfig.remote)) ===
        input.remoteRepositoryURL &&
      verifiedDestination(tx.all(), input.repositoryId, member.root,
        input.remoteRepositoryURL, {
          provider: input.provider, connection: input.connection,
          repositoryRef: input.repositoryRef,
        }), 'STALE',
    'Bound checkout commit or hosted fetch URL changed during artifact verification');
    const record = { ...artifact, type: 'artifact',
      producingAttemptCapability: verified.attemptCapability,
      producingAttemptRef: verified.attemptRef,
      producingExecution: validateCurrentExecutionIdentity(
        verified.producingExecution, verified.attemptCapability),
      ...(verified.versionVerified === true ?
        { artifactVersionVerified: true } : {}),
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
  await requireCurrentCandidateRevisions(state.metadata, cycle, state.records);
  const deployment = state.records.find(r => r.id === cycle?.deployments.STAGING);
  requireCurrentDeployment(cycle, state.records, deployment, 'STAGING');
  await requireCurrentRepositoryEvidence(state.metadata, cycle, state.records,
    deployment.repositoryId, deployment.intendedOutcome?.target);
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
  const tests = cycleTests(cycle).filter(test => test.environment === 'STAGING');
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
