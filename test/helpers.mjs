import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { registerArtifact } from '../src/artifacts.mjs';
import { captureReceipt, prepareDecision, applyDecision } from '../src/decisions.mjs';
import { resume, acknowledgeContext } from '../src/recovery.mjs';
import { classifyTool } from '../src/gate.mjs';
import { loadConfig } from '../src/artifacts.mjs';
import { digest } from '../src/core.mjs';
import { recordArtifact } from '../src/validation.mjs';
import { prepareOperation, markDispatching, recordOperation } from '../src/operations.mjs';
import { validateCurrentExecutionIdentity } from '../src/provider-adapters.mjs';
const execute = promisify(execFile);
export async function fixture(t, { initialize = true, compactPath = false } = {}) {
  const root = path.resolve('.test-data', compactPath ?
    randomUUID().slice(0, 16) : randomUUID());
  await fs.mkdir(root, { recursive: true });
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve('.test-data'));
    await fs.rm(root, { recursive: true });
    await assert.rejects(fs.stat(root), { code: 'ENOENT' });
  });
  const repo = path.join(root, 'repository with spaces');
  const home = path.join(root, 'isolated copilot home');
  await fs.mkdir(repo);
  const runGit = async (...args) => (await execute('git', args, { cwd: repo,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Fixture',
      GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
      GIT_TERMINAL_PROMPT: '0' } })).stdout.trim();
  await runGit('init', '-q', '-b', 'feature/fixture');
  await runGit('remote', 'add', 'origin', 'https://example.invalid/repository.git');
  const clock = { value: Date.parse('2026-09-08T00:00:00Z'), now() { return this.value; }, advance(ms) { this.value += ms; } };
  const repositoryVerifications = new Map();
  const providerRequests = new Map();
  const providerResults = new Map();
  const providerExecutions = new Map();
  const artifactVerifications = new Map();
  const store = await new Store(home, { clock,
    verifyRepository: ({ provider, localRepositoryPath, remoteRepositoryURL }) => {
      const verification = repositoryVerifications.get(remoteRepositoryURL);
      assert.ok(verification, 'The fixture must register this hosted repository before observation');
      assert.equal(verification.canonicalLocalRepositoryPath, localRepositoryPath);
      assert.equal(verification.verifiedProvider, provider);
      return verification;
    },
    verifyOperationResult: ({ operation, observedResult }) => {
      const verified = providerResults.get(operation.id);
      assert.ok(verified, 'The fixture must register a provider result for this operation');
      assert.deepEqual(observedResult, { fixtureResultId: verified.observation.providerResultId });
      return verified;
    },
    verifyArtifact: ({ operation, observation }) => {
      const verified = artifactVerifications.get(operation.id);
      assert.ok(verified, 'The producing operation must supply the artifact');
      assert.deepEqual(observation, { fixtureArtifactRef: verified.artifactRef });
      assert.equal(operation.resultProof?.providerResultId, verified.buildRunId);
      assert.equal(operation.resultProof?.status, 'succeeded');
      return verified;
    },
  }).ready();
  if (initialize) {
    await captureReceipt(store, { sessionId: 'session-a', source: 'userPromptSubmitted', input: 'Create the isolated component fixture work item.' });
    await store.init({ workItemId: 'wi-test', repositoryId: 'primary', cwd: repo, sessionId: 'session-a' });
  }
  return { root, repo, home, store, clock, runGit, repositoryVerifications,
    providerRequests, providerResults, providerExecutions, artifactVerifications,
    workItemId: 'wi-test', sessionId: 'session-a' };
}
export async function observeFixtureRepository(f, { remoteName = 'origin',
  provider = 'fixture', connection = 'fixture-connection',
  repositoryRef, revision, defaultBranchRef = 'refs/heads/main',
  verifiedBranch } = {}) {
  const remoteRepositoryURL = await f.runGit('remote', 'get-url', remoteName);
  const observedRevision = revision ?? await f.runGit('rev-parse', 'HEAD');
  const observedAt = new Date(f.clock.now()).toISOString();
  const evidenceRef = `fixture:repository:${remoteName}:${observedAt}`;
  const verifiedRepositoryRef = repositoryRef ?? `repository-${digest(remoteRepositoryURL).slice(0, 16)}`;
  const verification = {
    canonicalLocalRepositoryPath: f.repo,
    verifiedRemoteRepositoryURL: remoteRepositoryURL,
    verifiedProvider: provider,
    verifiedConnection: connection,
    verifiedRepositoryRef,
    verifiedRevision: observedRevision,
    verifiedDefaultBranchRef: defaultBranchRef,
    ...(verifiedBranch === undefined ? {} : { verifiedBranch }),
    verifiedObservedAt: observedAt,
    verifiedEvidenceRef: evidenceRef,
  };
  f.repositoryVerifications.set(remoteRepositoryURL, verification);
  return f.store.observeRepository({
    workItemId: f.workItemId, repositoryId: 'primary',
    selectedRemoteName: remoteName, localRepositoryPath: f.repo,
    remoteRepositoryURL, provider, connection,
    repositoryRef: verifiedRepositoryRef, revision: observedRevision,
    defaultBranchRef, ...(verifiedBranch === undefined ? {} : { verifiedBranch }),
    observedAt, evidenceRef,
  });
}
export function registerFixtureProviderRequest(f, operation) {
  assert.equal(operation.status, 'prepared');
  assert.ok(operation.intendedOutcome, 'A complete intended outcome must precede provider dispatch');
  assert.equal(f.providerRequests.has(operation.id), false);
  f.providerRequests.set(operation.id, {
    providerRequestId: `fixture-request-${operation.id}`,
    intendedOutcomeDigest: operation.intendedOutcome.digest,
  });
  return f.providerRequests.get(operation.id);
}
export function registerFixtureProviderResult(f, operation, {
  providerResultId, result, status = 'succeeded',
}) {
  assert.ok(operation.intendedOutcome, 'A complete intended outcome must precede a provider result');
  assert.ok(providerResultId, 'The provider must identify its actual result');
  const request = f.providerRequests.get(operation.id);
  assert.ok(request, 'The fixture must register its provider request before dispatch');
  assert.equal(request.intendedOutcomeDigest, operation.intendedOutcome.digest);
  const { providerRequestId } = request;
  const observation = {
    status, family: operation.intendedOutcome.family,
    target: operation.intendedOutcome.target,
    intendedOutcomeDigest: operation.intendedOutcome.digest,
    providerStatus: status, providerVerified: true,
    providerResultId,
    causalProof: { kind: 'provider-request', dispatchId: operation.id,
      resultId: providerResultId, supported: true, providerRequestId,
      accepted: true },
    result,
    evidence: { ref: `fixture:provider:${operation.id}`, verified: true,
      sha256: digest(result) },
  };
  f.providerResults.set(operation.id, {
    dispatch: { id: operation.id, providerRequestId,
      providerRequestSupported: true },
    observation,
    ...(f.providerExecutions.has(operation.id) ? {
      executionContext: f.providerExecutions.get(operation.id).context,
    } : {}),
  });
  return { fixtureResultId: providerResultId };
}
export async function finishFixtureOperation(f, operation, { status = 'succeeded',
  expectedMet = true, alreadyDispatched = false } = {}) {
  const request = alreadyDispatched ?
    f.providerRequests.get(operation.id) : registerFixtureProviderRequest(f, operation);
  assert.ok(request, 'The fixture request must exist before recording its result');
  if (!alreadyDispatched) await markDispatching(f.store, f.workItemId, operation.id);
  const { family, target, requested } = operation.intendedOutcome;
  const result = { remoteRepositoryURL: target.remoteRepositoryURL };
  let providerResultId;
  if (family === 'execution' || family === 'test') {
    const executionRef = `run-${digest(request.providerRequestId).slice(0, 16)}`;
    providerResultId = `${executionRef}:not-applicable`;
    const hosted = operation.class !== 'local-build' && target.environment !== 'local';
    const repository = hosted ?
      (await f.store.records(f.workItemId)).find(record =>
        record.type === 'repository-observation' &&
        record.repositoryId === operation.repositoryId &&
        record.localRepositoryPath === target.localRepositoryPath &&
        record.remoteRepositoryURL === target.remoteRepositoryURL &&
        (target.provider === undefined || record.provider === target.provider)) : null;
    if (hosted) {
      assert.ok(repository, 'The fixture CI service must have a registered hosted repository');
      // This fixture CI service uses its registered repository ID as execution scope.
      const identity = validateCurrentExecutionIdentity({
        provider: repository.provider, connection: repository.connection,
        scopeRef: repository.repositoryRef,
        ...(target.pipeline ? { definitionRef: target.pipeline } : {}),
        executionRef, attemptKind: 'not-applicable',
      }, 'none');
      f.providerExecutions.set(operation.id, {
        identity,
        context: {
          provider: identity.provider, connection: identity.connection,
          scopeRef: identity.scopeRef,
          ...(identity.definitionRef ? { definitionRef: identity.definitionRef } : {}),
          attemptCapability: 'none',
        },
      });
    }
    Object.assign(result, {
      executionRef, attemptCapability: 'none', attemptRef: 'not-applicable',
      sourceRevision: requested.sourceRevision, configDigest: requested.configDigest,
      candidateDigest: requested.candidateDigest, testSpecDigest: requested.testSpecDigest,
      environment: target.environment, target: target.target,
      ...(hosted ? {
        provider: f.providerExecutions.get(operation.id).identity.provider,
        executionIdentity: f.providerExecutions.get(operation.id).identity,
      } : {}),
      ...(family === 'execution' ?
        { pipeline: target.pipeline,
          ...(operation.class === 'local-build' ? { local: true } : {}) } :
        { testId: requested.testId, expectedMet,
          ...(target.environment === 'local' ? {} : {
            artifactId: requested.artifactId,
            deploymentId: requested.deploymentId,
          }) }),
    });
  } else if (family === 'deployment') {
    providerResultId = `deploy-${digest(request.providerRequestId).slice(0, 16)}`;
    Object.assign(result, {
      deploymentRef: providerResultId, artifactId: requested.artifactId,
      artifactRef: requested.artifactRef, artifactSha256: requested.artifactSha256,
      sourceRevision: requested.sourceRevision, configDigest: requested.configDigest,
      environment: target.environment, target: target.target,
    });
  } else {
    assert.fail(`Unexpected fixture operation family: ${family}`);
  }
  if (status === 'failed') result.terminalStatus = 'failed';
  const observedResult = registerFixtureProviderResult(f, operation, {
    providerResultId, result, status,
  });
  if (status === 'failed') {
    f.providerResults.get(operation.id).observation.failure = {
      terminal: true, providerVerified: true,
    };
  }
  return recordOperation(f.store, {
    workItemId: f.workItemId, operationId: operation.id, status,
    observedResult,
  });
}
export async function fixtureBuild(f, cycle, { target = 'dev-target',
  environment = 'DEV', pipeline = 'fixture-build', correlationKey = `build-${environment}` } = {}) {
  const repository = (await f.store.records(f.workItemId)).find(record =>
    record.type === 'repository-observation' && record.repositoryId === 'primary' &&
    record.localRepositoryPath === f.repo);
  assert.ok(repository, 'The fixture build requires a verified hosted repository');
  const action = {
    class: 'build', repositoryId: 'primary', environment, target,
    provider: repository.provider, pipeline, monitorCapability: true,
    sourceRevision: cycle.sources.find(source => source.repositoryId === 'primary').revision,
    configDigest: cycle.configDigest,
  };
  const { operation } = await prepareOperation(f.store, {
    workItemId: f.workItemId, sessionId: f.sessionId, action,
    request: { toolName: 'fixture_build', toolArgs: { action }, cwd: f.repo },
    correlationKey, intent: 'Build the fixture candidate at its exact revision',
  });
  return finishFixtureOperation(f, operation);
}
export async function fixtureArtifact(f, cycle, producer, {
  environment = 'DEV', artifactId = 'fixture-package', name = 'package',
} = {}) {
  assert.equal(producer.class, 'build');
  assert.equal(producer.status, 'succeeded');
  const producingExecution = validateCurrentExecutionIdentity(
    producer.resultProof?.executionIdentity, producer.resultProof?.attemptCapability);
  const repository = (await f.store.records(f.workItemId)).find(record =>
    record.type === 'repository-observation' && record.repositoryId === 'primary' &&
    record.localRepositoryPath === f.repo &&
    record.remoteRepositoryURL === producer.intendedOutcome.target.remoteRepositoryURL);
  assert.ok(repository, 'The hosted repository must be observed before artifact admission');
  const artifactRef = `artifact-${digest(f.providerRequests.get(producer.id).providerRequestId).slice(0, 16)}`;
  const artifactSha256 = createHash('sha256')
    .update(`fixture artifact bytes:${artifactRef}`).digest('hex');
  const fields = {
    repositoryId: 'primary', localRepositoryPath: f.repo,
    remoteRepositoryURL: repository.remoteRepositoryURL,
    provider: repository.provider, connection: repository.connection,
    repositoryRef: repository.repositoryRef,
    sourceRevision: producer.action.sourceRevision, configDigest: cycle.configDigest,
    artifactId, artifactRef, artifactSha256,
    buildRunId: producer.resultProof.providerResultId, name,
    evidenceRef: `fixture:artifact:${artifactRef}`,
  };
  f.artifactVerifications.set(producer.id, {
    ...fields, attemptCapability: producer.resultProof.attemptCapability,
    attemptRef: producer.resultProof.attemptRef, producingExecution,
  });
  return recordArtifact(f.store, {
    workItemId: f.workItemId, cycleId: cycle.id, environment,
    sourceDigest: cycle.candidateDigest, artifactType: 'archive',
    status: 'succeeded', producingOperationId: producer.id, ...fields,
    producerObservation: { fixtureArtifactRef: artifactRef },
  });
}
export async function prepareFixtureDeployment(f, cycle, artifact, {
  target, correlationKey = `deploy-${artifact.environment}`,
} = {}) {
  const action = {
    class: 'deploy', repositoryId: 'primary', environment: artifact.environment,
    target, configDigest: cycle.configDigest,
    monitorCapability: true, artifactId: artifact.artifactId,
    artifactRef: artifact.artifactRef, artifactSha256: artifact.artifactSha256,
    sourceRevision: artifact.sourceRevision,
  };
  return prepareOperation(f.store, {
    workItemId: f.workItemId, sessionId: f.sessionId, action,
    request: { toolName: 'fixture_deploy',
      toolArgs: { environment: artifact.environment, artifactId: artifact.artifactId,
        target, correlationKey }, cwd: f.repo },
    correlationKey, intent: `Deploy the fixture artifact to ${artifact.environment}`,
  });
}
export async function fixtureDeployment(f, cycle, artifact, options = {}) {
  const { operation } = await prepareFixtureDeployment(f, cycle, artifact, options);
  return finishFixtureOperation(f, operation);
}
export async function artifact(f, role, contents) {
  const relative = `docs/${role}.md`;
  await fs.mkdir(path.join(f.repo, 'docs'), { recursive: true });
  await fs.writeFile(path.join(f.repo, relative), contents);
  return relative;
}
export async function cli(f, args, input) {
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [path.resolve('bin/sdlc.mjs'), ...args], {
      cwd: f.repo, env: { ...process.env, COPILOT_HOME: f.home, SDLC_SESSION_ID: f.sessionId },
      maxBuffer: 2 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error && typeof error.code !== 'number') reject(error);
      else {
        const lines = stdout.trim().split('\n').filter(Boolean);
        const final = lines.filter(line => {
          try { return JSON.parse(line).type !== 'progress'; }
          catch { return true; }
        }).at(-1);
        resolve({ code: error?.code ?? 0, stdout, stderr, json: final ? JSON.parse(final) : null });
      }
    });
    if (input !== undefined) child.stdin.end(JSON.stringify(input)); else child.stdin.end();
  });
}
export async function grant(f, kind, effect, { prepared = false, sessionId = f.sessionId, input = `User explicitly authorizes ${kind}` } = {}) {
  const decision = prepared ? await prepareDecision(f.store, { workItemId: f.workItemId, sessionId, kind, effect }) : null;
  f.clock.advance(1);
  const receipt = await captureReceipt(f.store, { sessionId, source: 'userPromptSubmitted', input });
  const request = { workItemId: f.workItemId, sessionId, kind, effect, receiptId: receipt.id, input,
    ...(decision ? { decisionId: decision.id } : {}) };
  return { ...(await applyDecision(f.store, request)), request, receipt, decision };
}
export async function coding(f) {
  for (const [role, content] of [
    ['requirements', '# Requirements\n### FR-001 - Safe work\n**Definition of Done**\n- AC-001.1: A request is safely handled.\n'],
    ['test-plan', '# Plan\n| ID | Requirements | Conditions | Environment | Level | Checkpoint | Mode | Owner | Location | Expected outcome | Implementation | Status |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n' +
      testDefinitions().map(test => `| ${test.id} | FR-001 | AC-001.1 | ${test.environment} | ${test.level} | ${test.checkpoint} | ${test.mode} | ${test.owner} | ${test.location} | ${test.expected} | ${test.implementation} | NotRun |`).join('\n') + '\n'],
    ['technical-design', '# Technical Design\nUse an offline ledger.\n'],
  ]) {
    const relative = await artifact(f, role, content);
    await registerArtifact(f.store, { workItemId: f.workItemId, role, repositoryId: 'primary', path: relative });
  }
  const phases = ['requirements', 'test-design', 'technical-design', 'coding'];
  for (let index = 0; index < 3; index++) await grant(f, 'approval', { transition: { from: phases[index], to: phases[index + 1] } }, { prepared: true });
  return f;
}
export async function orient(f, sessionId = f.sessionId) {
  const result = await resume(f.store, { cwd: f.repo, sessionId, workItemId: f.workItemId });
  await acknowledgeContext(f.store, { cwd: f.repo, sessionId, workItemId: f.workItemId, token: result.orientationToken });
  return result.orientationToken;
}
export async function completeReview(f, cycle) {
  const review = await grant(f, 'review-result', {
    cycleId: cycle.id, candidateDigest: cycle.candidateDigest, testSpecDigest: cycle.testSpecDigest,
    configDigest: cycle.configDigest, status: 'Passed', evidenceRef: 'copilot-cli:/review:fixture',
    summary: 'No blocking findings', blockingFindings: [], completedStage: 'review',
  }, { input: 'I ran GitHub Copilot CLI /review for this candidate; it reported no blocking findings. Continue.' });
  return review;
}
export async function pushAction(f, command = 'git push --no-follow-tags --no-recurse-submodules origin refs/heads/feature/fixture:refs/heads/feature/fixture') {
  const state = await f.store.load(f.workItemId);
  const member = state.metadata.members.find(item => item.repositoryId === 'primary');
  return (await classifyTool(f.store, { toolName: 'bash', toolArgs: { command }, cwd: f.repo },
    state, member, await loadConfig(state.metadata, member.repositoryId)))[0];
}
export function pushPermission(action) {
  return { grant: 'push', target: action.target, remoteUrlDigest: action.remoteUrlDigest,
    sourceRef: action.sourceRef, targetRef: action.targetRef,
    ...(action.localRepositoryPath ? {
      localRepositoryPath: action.localRepositoryPath,
      remoteRepositoryURL: action.remoteRepositoryURL,
    } : {}),
    ...(action.sourceRevision ? { sourceRevision: action.sourceRevision } : {}),
    force: action.force, delete: action.delete };
}
export async function grantPush(f, command = 'git push --no-follow-tags --no-recurse-submodules origin refs/heads/feature/fixture:refs/heads/feature/fixture', options = {}) {
  const { effect = {}, repositoryObservation, ...grantOptions } = options;
  const classified = await pushAction(f, command);
  const action = repositoryObservation ? {
    ...classified, localRepositoryPath: repositoryObservation.localRepositoryPath,
    remoteRepositoryURL: repositoryObservation.remoteRepositoryURL,
  } : classified;
  if (repositoryObservation) {
    assert.equal(repositoryObservation.localRepositoryPath, f.repo);
    assert.equal(repositoryObservation.remoteRepositoryURL,
      await f.runGit('remote', 'get-url', '--push', classified.target));
  }
  return { action, grant: await grant(f, 'permission', { ...pushPermission(action), ...effect }, grantOptions) };
}
export function syntheticPushAction(target = 'origin') {
  return { class: 'push', repositoryId: 'primary', target, remoteUrlDigest: digest([target]),
    sourceRef: 'refs/heads/feature/fixture', targetRef: 'refs/heads/feature/fixture',
    force: false, delete: false };
}
export const testDefinitions = () => [
  { id: 'T-unit', environment: 'local', level: 'unit', checkpoint: 'pre-review', mode: 'automated', owner: 'agent', location: 'local', implementation: 'test/unit.mjs', expected: 'All assertions pass' },
  { id: 'T-integration', environment: 'local', level: 'integration', checkpoint: 'pre-review', mode: 'automated', owner: 'agent', location: 'local', implementation: 'test/integration.mjs', expected: 'Integration contract holds' },
  { id: 'T-dev', environment: 'DEV', level: 'integration', checkpoint: 'DEV', mode: 'semi-automated', owner: 'agent', location: 'development-machine', implementation: 'docs/dev-flow.md', expected: 'DEV scenario succeeds' },
  { id: 'T-staging', environment: 'STAGING', level: 'integration', checkpoint: 'STAGING', mode: 'automated', owner: 'user', location: 'authorized-machine', implementation: 'docs/staging-suite.md', expected: 'STAGING suite passes' },
];
