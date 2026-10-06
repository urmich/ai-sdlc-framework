import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { artifact, fixture, coding, completeReview, grant, grantPush, observeFixtureRepository, pushAction,
  orient, registerFixtureProviderRequest, registerFixtureProviderResult,
  testDefinitions, cli } from './helpers.mjs';
import { startCycle, recordArtifact, recordTest } from '../src/validation.mjs';
import { nextAction, resume } from '../src/recovery.mjs';
import { readJson, writeJson } from '../src/files.mjs';
import { currentCycle } from '../src/authority.mjs';
import { prepareOperation, markDispatching, recordOperation, pruneWork } from '../src/operations.mjs';
import { evaluatePolicy } from '../src/policy.mjs';
import { evaluateGate as gate } from '../src/gate.mjs';
import { registerArtifact } from '../src/artifacts.mjs';
import { handleHook } from '../src/hooks.mjs';
import { captureReceipt } from '../src/decisions.mjs';
import { isNonRepositoryFailure } from '../src/store.mjs';
import { gitEnvironment } from '../src/git.mjs';
import { digest } from '../src/core.mjs';
const execute = promisify(execFile);

async function provenArtifact(f, cycle, repositoryObservation, artifactId, executionRef) {
  const sourceRevision = await f.runGit('rev-parse', 'HEAD');
  const action = { class: 'build', repositoryId: 'primary', environment: 'DEV',
    target: 'dev-target', configDigest: cycle.configDigest, stages: ['DEV'],
    provider: repositoryObservation.provider, pipeline: 'fixture-build', artifactId,
    sourceRevision, monitorCapability: true };
  const { operation } = await prepareOperation(f.store, {
    workItemId: f.workItemId, sessionId: f.sessionId, action,
    request: { toolName: 'fixture_build', toolArgs: { artifactId }, cwd: f.repo },
    correlationKey: `build-${artifactId}`, intent: 'Build the current candidate artifact',
  });
  registerFixtureProviderRequest(f, operation);
  await markDispatching(f.store, f.workItemId, operation.id);
  const buildRunId = `${executionRef}:not-applicable`;
  const producingExecution = {
    provider: repositoryObservation.provider, connection: repositoryObservation.connection,
    scopeRef: repositoryObservation.repositoryRef, definitionRef: action.pipeline,
    executionRef, attemptKind: 'not-applicable',
  };
  const observedResult = registerFixtureProviderResult(f, operation, {
    providerResultId: buildRunId,
    result: { executionRef, attemptCapability: 'none',
      attemptRef: 'not-applicable', executionIdentity: producingExecution, sourceRevision,
      configDigest: cycle.configDigest, provider: action.provider,
      pipeline: action.pipeline, environment: 'DEV', target: action.target,
      candidateDigest: cycle.candidateDigest, testSpecDigest: cycle.testSpecDigest,
      remoteRepositoryURL: repositoryObservation.remoteRepositoryURL },
  });
  const producer = await recordOperation(f.store, { workItemId: f.workItemId, operationId: operation.id,
    status: 'succeeded', observedResult });
  assert.deepEqual(producer.resultProof.executionIdentity, producingExecution);
  const artifactRef = `fixture:${artifactId}`;
  const artifactSha256 = digest(artifactId);
  const evidenceRef = `fixture:artifact:${artifactId}`;
  const verification = { repositoryId: 'primary', localRepositoryPath: f.repo,
    remoteRepositoryURL: repositoryObservation.remoteRepositoryURL,
    provider: repositoryObservation.provider, connection: repositoryObservation.connection,
    repositoryRef: repositoryObservation.repositoryRef, sourceRevision,
    configDigest: cycle.configDigest, artifactId, artifactRef, artifactSha256,
    buildRunId, name: artifactId, evidenceRef,
    attemptCapability: producer.resultProof.attemptCapability,
    attemptRef: producer.resultProof.attemptRef,
    producingExecution: producer.resultProof.executionIdentity };
  f.artifactVerifications.set(operation.id, verification);
  const { attemptCapability, attemptRef, producingExecution: verifiedExecution,
    ...artifactFields } = verification;
  void attemptCapability; void attemptRef; void verifiedExecution;
  const input = { workItemId: f.workItemId, cycleId: cycle.id, artifactId,
    environment: 'DEV', sourceDigest: cycle.candidateDigest,
    configDigest: cycle.configDigest, buildRunId, name: artifactId,
    artifactType: 'archive', evidenceRef, status: 'succeeded',
    ...artifactFields, producingOperationId: operation.id,
    producerObservation: { operationId: operation.id } };
  return { input, artifactRef, artifactSha256, sourceRevision };
}
async function provenDeploymentResult(f, operation, artifact) {
  const observedResult = registerFixtureProviderResult(f, operation, {
    providerResultId: `deploy-${operation.correlationKey}`,
    result: { deploymentRef: `deploy-${operation.correlationKey}`,
      artifactId: artifact.input.artifactId, artifactRef: artifact.artifactRef,
      artifactSha256: artifact.artifactSha256, sourceRevision: artifact.sourceRevision,
      configDigest: artifact.input.configDigest, environment: 'DEV',
      target: operation.target,
      remoteRepositoryURL: artifact.input.remoteRepositoryURL },
  });
  return { workItemId: f.workItemId, operationId: operation.id,
    status: 'succeeded', observedResult };
}

test('T-01/T-19 non-Git workspace can bootstrap and use an explicitly bound child repository', async t => {
  const f = await fixture(t);
  const outside = await fs.realpath(await fs.mkdtemp(
    path.join(os.tmpdir(), 'sdlc-non-git-workspace-')));
  t.after(async () => fs.rm(outside, { recursive: true, force: true }));
  const resolved = await f.store.resolve(outside, f.sessionId);
  assert.equal(resolved.workItemId, f.workItemId);
  assert.equal(resolved.member.root, f.repo);

  const read = await gate(f.store, { cwd: outside, sessionId: f.sessionId,
    toolName: 'powershell', toolArgs: { command: 'Get-ChildItem -LiteralPath docs' } });
  assert.equal(read.permissionDecision, undefined, JSON.stringify(read));
  for (const command of ['artifact register', 'op show', 'cycle start', 'evidence test']) {
    const framework = await gate(f.store, { cwd: outside, sessionId: f.sessionId,
      toolName: 'bash', toolArgs: {
        command: `"${process.execPath}" "${path.resolve('bin/sdlc.mjs')}" ${command} --cwd "${f.repo}"`,
      } });
    assert.equal(framework.permissionDecision, undefined, `${command}: ${JSON.stringify(framework)}`);
  }

  await writeJson(path.join(f.repo, '.sdlc/config.json'),
    { defaultBranch: 'refs/heads/main', commands: [
      { command: 'npm run build', action: { class: 'configuration' } },
      { command: 'node scripts/status.mjs', action: { class: 'read' } },
      { command: 'node scripts/bookkeeping.mjs', action: { class: 'bookkeeping' } },
    ] });
  await orient(f);
  const config = await gate(f.store, { cwd: outside, sessionId: f.sessionId,
    toolName: 'edit', toolArgs: { path: path.join(f.repo, '.sdlc/config.json'),
      old_str: 'old', new_str: 'new' } });
  assert.equal(config.permissionDecision, undefined, JSON.stringify(config));
  const outerBuild = await gate(f.store, { cwd: outside, sessionId: f.sessionId,
    toolName: 'powershell', toolArgs: { command: 'npm run build' } });
  assert.equal(outerBuild.permissionDecision, 'deny');
  assert.equal(outerBuild.error, 'BINDING');
  const rawParentGitCwd = await gate(f.store, { cwd: outside, sessionId: f.sessionId,
    toolName: 'bash', toolArgs: {
      command: `git -C "${f.repo}/link/.." add .`,
    } });
  assert.equal(rawParentGitCwd.permissionDecision, 'deny');
  assert.equal(rawParentGitCwd.error, 'BINDING');
  const repositorySubdirectory = path.join(f.repo, 'src');
  await fs.mkdir(repositorySubdirectory, { recursive: true });
  const boundRootFromSubdirectory = await gate(f.store, { cwd: repositorySubdirectory,
    sessionId: f.sessionId, toolName: 'bash',
    toolArgs: { command: `git -C "${f.repo}" add .sdlc/config.json` } });
  assert.equal(boundRootFromSubdirectory.permissionDecision, undefined,
    JSON.stringify(boundRootFromSubdirectory));
  for (const command of ['node scripts/status.mjs', 'node scripts/bookkeeping.mjs']) {
    const outerConfigured = await gate(f.store, { cwd: outside,
      sessionId: f.sessionId, toolName: 'powershell', toolArgs: { command } });
    assert.equal(outerConfigured.permissionDecision, 'deny', command);
    assert.equal(outerConfigured.error, 'BINDING');
  }

  const other = await fixture(t, { initialize: false });
  const wrongRepository = await gate(f.store, { cwd: other.repo, sessionId: f.sessionId,
    toolName: 'edit', toolArgs: { path: path.join(f.repo, '.sdlc/config.json'),
      old_str: 'old', new_str: 'new' } });
  assert.equal(wrongRepository.permissionDecision, 'deny');
  assert.equal(wrongRepository.error, 'BINDING');
  await assert.rejects(f.store.resolve(path.join(other.repo, '.git'), f.sessionId),
    { code: 'GIT' });
  assert.equal(isNonRepositoryFailure({ code: 'GIT',
    details: { cause: 'fatal: detected dubious ownership in repository' } }), false);
  assert.equal(isNonRepositoryFailure({ code: 'GIT',
    details: { cause: 'fatal: not a git repository (or any parent): .git' } }), true);
  assert.equal(gitEnvironment({ LANG: 'fr_FR.UTF-8', LC_ALL: 'fr_FR.UTF-8' }).LC_ALL, 'C');
  const malformed = await fs.realpath(await fs.mkdtemp(
    path.join(os.tmpdir(), 'sdlc-malformed-git-')));
  t.after(async () => fs.rm(malformed, { recursive: true, force: true }));
  await fs.writeFile(path.join(malformed, '.git'), 'gitdir: missing-directory\n');
  await assert.rejects(f.store.resolve(malformed, f.sessionId), { code: 'GIT' });
  const boundMetadataFailure = await gate(f.store, {
    cwd: path.join(other.repo, '.git'), sessionId: f.sessionId,
    toolName: 'bash', toolArgs: { command: 'git init unrelated-project' },
  });
  assert.equal(boundMetadataFailure.permissionDecision, 'deny');
  assert.equal(boundMetadataFailure.error, 'GIT');
});

test('T-01 captured development request permits repository bootstrap outside Git', async t => {
  const f = await fixture(t, { initialize: false });
  const outside = await fs.realpath(await fs.mkdtemp(
    path.join(os.tmpdir(), 'sdlc-empty-workspace-')));
  t.after(async () => fs.rm(outside, { recursive: true, force: true }));
  await captureReceipt(f.store, { sessionId: f.sessionId,
    source: 'userPromptSubmitted', input: 'Clone the requested project and develop it.' });
  for (const [toolName, command] of [
    ['bash', 'git clone https://example.invalid/project.git project'],
    ['powershell', 'git clone https://example.invalid/project.git project'],
    ['cmd', 'git clone https://example.invalid/project.git project'],
    ['bash', 'git init project'],
  ]) {
    const decision = await gate(f.store, { cwd: outside, sessionId: f.sessionId,
      toolName, toolArgs: { command } });
    assert.equal(decision.permissionDecision, undefined, JSON.stringify(decision));
  }
  const bootstrapRepo = path.join(outside, 'bootstrapped-repository');
  await execute('git', ['init', '-q', '-b', 'main', bootstrapRepo]);
  const previousWorkTree = process.env.GIT_WORK_TREE;
  process.env.GIT_WORK_TREE = path.join(outside, 'redirected-worktree');
  try {
    const redirected = await gate(f.store, { cwd: outside, sessionId: f.sessionId,
      toolName: 'bash',
      toolArgs: { command: `git -C "${bootstrapRepo}" switch -c feature/redirected` } });
    assert.equal(redirected.permissionDecision, 'deny');
  } finally {
    if (previousWorkTree === undefined) delete process.env.GIT_WORK_TREE;
    else process.env.GIT_WORK_TREE = previousWorkTree;
  }
  for (const command of [
    `git -C "${bootstrapRepo}" switch -c feature/bootstrap-test`,
    `git -C "${bootstrapRepo}" worktree add worktree`,
  ]) {
    const decision = await gate(f.store, { cwd: outside, sessionId: f.sessionId,
      toolName: 'bash', toolArgs: { command } });
    assert.equal(decision.permissionDecision, undefined, command);
  }
  for (const command of [
    `git -C "${bootstrapRepo}" switch --discard-changes main`,
    `git -C "${bootstrapRepo}" worktree remove --force worktree`,
    `git -C "${bootstrapRepo}" worktree add worktree --force`,
    `git -C "${bootstrapRepo}" worktree add worktree -ff`,
  ]) {
    const decision = await gate(f.store, { cwd: outside, sessionId: f.sessionId,
      toolName: 'bash', toolArgs: { command } });
    assert.equal(decision.permissionDecision, 'deny', command);
  }

  const denied = await gate(f.store, { cwd: outside, sessionId: 'session-without-receipt',
    toolName: 'bash',
    toolArgs: { command: 'git clone https://example.invalid/project.git project' } });
  assert.equal(denied.permissionDecision, 'deny');
  assert.equal(denied.error, 'GIT');

  const stopParsing = await gate(f.store, { cwd: outside, sessionId: f.sessionId,
    toolName: 'powershell',
    toolArgs: { command: 'git diff --% %SDLC_REVIEW_LITERAL%' } });
  assert.equal(stopParsing.permissionDecision, 'deny');
  assert.equal(stopParsing.error, 'HOOK');
  const smartQuotes = await gate(f.store, { cwd: outside, sessionId: f.sessionId,
    toolName: 'powershell',
    toolArgs: { command: 'git diff “--output=outside.txt”' } });
  assert.equal(smartQuotes.permissionDecision, 'deny');
  assert.equal(smartQuotes.error, 'HOOK');
  const lowSmartQuotes = await gate(f.store, { cwd: outside, sessionId: f.sessionId,
    toolName: 'powershell',
    toolArgs: { command: 'git diff „--output=outside.txt„' } });
  assert.equal(lowSmartQuotes.permissionDecision, 'deny');
  assert.equal(lowSmartQuotes.error, 'HOOK');
  for (const command of [
    "git diff '--out\"\"put=outside.txt'",
    "git init '\"\"../outside-project'",
    'git diff "HEAD"--output=outside.txt',
    "git diff 'HEAD'\"--output=outside.txt\"",
    "git diff \"HEAD\"'--output=outside.txt'",
    "git diff '--%' %\"SDLC_PROBE\"%",
  ]) {
    const legacyQuotes = await gate(f.store, { cwd: outside, sessionId: f.sessionId,
      toolName: 'powershell', toolArgs: { command } });
    assert.equal(legacyQuotes.permissionDecision, 'deny', command);
    assert.equal(legacyQuotes.error, 'HOOK');
  }
  const backslashQuotes = await gate(f.store, { cwd: outside, sessionId: f.sessionId,
    toolName: 'powershell',
    toolArgs: { command: 'git diff --src-prefix="\\" --output=outside.txt --dst-prefix=\\""' } });
  assert.equal(backslashQuotes.permissionDecision, 'deny');
  const sourceEntry = path.resolve('bin/sdlc.mjs');
  const doubledQuoteEntry = sourceEntry.replace('sdlc.mjs', "sd''lc.mjs");
  const doubledQuotes = await gate(f.store, { cwd: outside, sessionId: f.sessionId,
    toolName: 'powershell',
    toolArgs: { command:
      `"${process.execPath}" '${doubledQuoteEntry}' artifact register --cwd "${bootstrapRepo}"` } });
  assert.equal(doubledQuotes.permissionDecision, 'deny');

  const cloneOption = await gate(f.store, { cwd: outside, sessionId: f.sessionId,
    toolName: 'powershell',
    toolArgs: { command: 'git clone --upload-pack=helper https://example.invalid/project.git project' } });
  assert.equal(cloneOption.permissionDecision, 'deny');
  for (const command of [
    'git clone https://example.invalid/project.git --separate-git-dir=outside',
    'git clone https://example.invalid/project.git --template=outside',
    'git init ~/outside-project',
    'git init link/../outside-project',
    `git -C ${f.root} init child-project`,
    `git -C ${f.repo} init`,
    'git clone https://example.invalid/project.git',
    'git -C link/../repository switch -c feature/bootstrap',
    'git init -b {main,--separate-git-dir=../outside} child-project',
    'git clone https://example.invalid/{project,other}.git child-project',
  ]) {
    const result = await gate(f.store, { cwd: outside, sessionId: f.sessionId,
      toolName: 'bash', toolArgs: { command } });
    assert.equal(result.permissionDecision, 'deny', command);
  }

  const malformed = await fs.realpath(await fs.mkdtemp(
    path.join(os.tmpdir(), 'sdlc-prebind-malformed-git-')));
  t.after(async () => fs.rm(malformed, { recursive: true, force: true }));
  await fs.writeFile(path.join(malformed, '.git'), 'gitdir: missing-directory\n');
  const malformedClone = await gate(f.store, { cwd: malformed, sessionId: f.sessionId,
    toolName: 'bash',
    toolArgs: { command: 'git clone https://example.invalid/project.git project' } });
  assert.equal(malformedClone.permissionDecision, 'deny');
  assert.equal(malformedClone.error, 'GIT');
});

test('T-16/T-19 interrupted result projection and corrupt checkpoint recover without repeating tests', async t => {
  const f = await coding(await fixture(t));
  const { cycle } = await startCycle(f.store, { workItemId: f.workItemId, tests: testDefinitions(), configDigest: 'v1', cause: 'first validation' });
  f.store.fault = async stage => { if (stage === 'record:test-evidence') throw new Error('crash after durable evidence'); };
  await assert.rejects(recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id, testId: 'T-unit', status: 'Passed',
    expectedMet: true, evidenceRef: 'fixture:units-complete', owner: 'agent', host: 'local' }), /crash after durable evidence/);
  f.store.fault = async () => {};
  await fs.writeFile(path.join(f.store.workPath(f.workItemId), 'checkpoint.json'), '{damaged checkpoint');
  await resume(f.store, { cwd: f.repo, sessionId: f.sessionId, workItemId: f.workItemId });
  const state = await f.store.load(f.workItemId);
  const recovered = currentCycle(state.records, state.checkpoint);
  assert.equal(recovered.id, cycle.id);
  assert.equal(state.records.find(r => r.id === recovered.results['T-unit']).status, 'Passed');
  assert.match(await fs.readFile(path.join(f.repo, 'docs/test-plan.md'), 'utf8'), /T-unit.*Passed/u);
  assert.equal((await fs.readdir(path.join(f.store.workPath(f.workItemId), 'recovery'))).length, 1);
});
test('T-16 evidence sequence remains above pruned current-cycle high-water', async t => {
  const f = await coding(await fixture(t));
  const { cycle } = await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: 'v1', cause: 'evidence sequence recovery' });
  await f.store.transaction(f.workItemId, tx => {
    const current = tx.get(cycle.id);
    current.lastEvidenceSequence = 5;
    delete current.results['T-unit'];
    tx.put(current);
  });
  f.store.fault = async stage => {
    if (stage === 'record:test-evidence') throw new Error('interrupt after high-sequence evidence');
  };
  await assert.rejects(recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id,
    testId: 'T-unit', status: 'Passed', expectedMet: true,
    evidenceRef: 'fixture:unit-after-prune', owner: 'agent', host: 'local' }), /high-sequence evidence/);
  f.store.fault = async () => {};
  const state = await f.store.load(f.workItemId);
  const current = currentCycle(state.records, state.checkpoint);
  const evidence = state.records.find(record => record.id === current.results['T-unit']);
  assert.equal(evidence.sequence, 6);
});
test('T-16 interrupted terminal deployment repairs the active cycle projection', async t => {
  const f = await coding(await fixture(t));
  await writeJson(path.join(f.repo, '.sdlc/config.json'), { defaultBranch: 'refs/heads/main', environments: {
    DEV: { target: 'dev-target', configDigest: 'v1', allowedStages: ['DEV'] },
  } });
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Commit deployment recovery candidate');
  const repositoryObservation = await observeFixtureRepository(f);
  const { cycle } = await startCycle(f.store, { workItemId: f.workItemId, tests: testDefinitions(), configDigest: 'v1', cause: 'deployment recovery' });
  for (const testId of ['T-unit', 'T-integration']) {
    await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id, testId,
      status: 'Passed', expectedMet: true, evidenceRef: `fixture:${testId}`, owner: 'agent', host: 'local' });
  }
  await completeReview(f, cycle);
  await grant(f, 'dev-authorization', { cycleId: cycle.id, candidateDigest: cycle.candidateDigest,
    testSpecDigest: cycle.testSpecDigest, configDigest: cycle.configDigest,
    target: 'dev-target', completedStage: 'review' });
  f.artifactVerifications = new Map();
  f.store.verifyArtifact = ({ operation, observation }) => {
    assert.equal(observation.operationId, operation.id);
    const verification = f.artifactVerifications.get(operation.id);
    assert.ok(verification, 'The fixture must register a producing build first');
    return verification;
  };
  const oldArtifact = await provenArtifact(f, cycle, repositoryObservation,
    'artifact-old', 'build-old');
  await recordArtifact(f.store, oldArtifact.input);
  const artifact = await provenArtifact(f, cycle, repositoryObservation,
    'artifact-dev', 'build-1');
  f.store.fault = async stage => { if (stage === 'record:artifact') throw new Error('crash after replacement artifact'); };
  await assert.rejects(recordArtifact(f.store, artifact.input), /crash after replacement artifact/);
  f.store.fault = async () => {};
  const artifactState = await f.store.load(f.workItemId);
  const artifactCycle = currentCycle(artifactState.records, artifactState.checkpoint);
  assert.equal(artifactState.records.find(record => record.id === artifactCycle.artifacts.DEV).artifactId, 'artifact-dev');
  const action = { class: 'deploy', repositoryId: 'primary', environment: 'DEV', target: 'dev-target',
    configDigest: 'v1', stages: ['DEV'], artifactId: 'artifact-dev',
    artifactRef: artifact.artifactRef, artifactSha256: artifact.artifactSha256,
    sourceRevision: artifact.sourceRevision, monitorCapability: true };
  const request = { toolName: 'fixture_deploy', toolArgs: { target: 'dev-target' }, cwd: f.repo };
  const { operation } = await prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId,
    action, request, correlationKey: 'deploy-recovery', intent: 'Deploy current reviewed candidate' });
  registerFixtureProviderRequest(f, operation);
  await markDispatching(f.store, f.workItemId, operation.id);
  const result = await provenDeploymentResult(f, operation, artifact);
  f.store.fault = async stage => { if (stage === 'record:operation') throw new Error('crash after terminal operation'); };
  await assert.rejects(recordOperation(f.store, result), /crash after terminal operation/);
  f.store.fault = async () => {};
  await recordOperation(f.store, result);
  let recoveredState = await f.store.load(f.workItemId);
  let recovered = currentCycle(recoveredState.records, recoveredState.checkpoint);
  assert.equal(recovered.deployments.DEV, operation.id);
  const replacementRequest = { toolName: 'fixture_deploy', toolArgs: { target: 'dev-target', attempt: 2 }, cwd: f.repo };
  const replacement = await prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId,
    action, request: replacementRequest, correlationKey: 'deploy-replacement', intent: 'Replace the current DEV deployment' });
  registerFixtureProviderRequest(f, replacement.operation);
  await markDispatching(f.store, f.workItemId, replacement.operation.id);
  const replacementResult = await provenDeploymentResult(f, replacement.operation, artifact);
  f.store.fault = async stage => { if (stage === 'record:operation') throw new Error('crash after replacement deployment'); };
  await assert.rejects(recordOperation(f.store, replacementResult), /crash after replacement deployment/);
  f.store.fault = async () => {};
  await recordOperation(f.store, replacementResult);
  recoveredState = await f.store.load(f.workItemId);
  recovered = currentCycle(recoveredState.records, recoveredState.checkpoint);
  assert.equal(recovered.deployments.DEV, replacement.operation.id);
});
test('T-20 prepared operations cannot mask a differently classified environment', async t => {
  const f = await coding(await fixture(t));
  await writeJson(path.join(f.repo, '.sdlc/config.json'), {
    defaultBranch: 'refs/heads/main',
    environments: {
      DEV: { target: 'dev-target', configDigest: 'v1', allowedStages: ['DEV'] },
      PROD: { target: 'prod-target', configDigest: 'v1', allowedStages: ['PROD'] },
    },
    toolAdapters: [
      { toolName: 'fixture_deploy', match: { slot: 'prod' },
        action: { class: 'deploy', environment: 'PROD', target: 'prod-target',
          configDigest: 'v1', stages: ['PROD'], monitorCapability: true } },
      { toolName: 'fixture_scoped_build', match: { item: 'excluded' },
        action: { class: 'build', environment: 'DEV', target: 'dev-target',
          configDigest: 'v1', stages: ['DEV'], monitorCapability: true,
          outOfScope: true, itemId: 'excluded-item' } },
    ],
  });
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Commit classified deployment candidate');
  const repositoryObservation = await observeFixtureRepository(f);
  const { cycle } = await startCycle(f.store, { workItemId: f.workItemId, configDigest: 'v1', cause: 'classifier mismatch' });
  for (const testId of ['T-unit', 'T-integration']) {
    await recordTest(f.store, { workItemId: f.workItemId, cycleId: cycle.id, testId,
      status: 'Passed', expectedMet: true, evidenceRef: `fixture:${testId}`, owner: 'agent', host: 'local' });
  }
  await completeReview(f, cycle);
  await grant(f, 'dev-authorization', { cycleId: cycle.id, candidateDigest: cycle.candidateDigest,
    testSpecDigest: cycle.testSpecDigest, configDigest: cycle.configDigest,
    target: 'dev-target', completedStage: 'review' });
  f.artifactVerifications = new Map();
  f.store.verifyArtifact = ({ operation, observation }) => {
    assert.equal(observation.operationId, operation.id);
    const verification = f.artifactVerifications.get(operation.id);
    assert.ok(verification, 'The fixture must register a producing build first');
    return verification;
  };
  const artifact = await provenArtifact(f, cycle, repositoryObservation,
    'artifact-dev', 'build-1');
  await recordArtifact(f.store, artifact.input);
  const request = { toolName: 'fixture_deploy', toolArgs: { slot: 'prod' }, cwd: f.repo };
  const { operation } = await prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId,
    action: { class: 'deploy', repositoryId: 'primary', environment: 'DEV', target: 'dev-target',
      configDigest: 'v1', stages: ['DEV'], artifactId: 'artifact-dev',
      artifactRef: artifact.artifactRef, artifactSha256: artifact.artifactSha256,
      sourceRevision: artifact.sourceRevision, monitorCapability: true },
    request, correlationKey: 'masked-environment', intent: 'Attempt to mask a PROD classification as DEV' });
  await orient(f);
  await markDispatching(f.store, f.workItemId, operation.id);
  const result = await gate(f.store, { ...request, sessionId: f.sessionId });
  assert.equal(result.permissionDecision, 'deny');
  assert.match(result.permissionDecisionReason, /Prepared environment differs/u);
  const scopedRequest = { toolName: 'fixture_scoped_build', toolArgs: { item: 'excluded' }, cwd: f.repo };
  const scoped = await prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId,
    action: { class: 'build', repositoryId: 'primary', environment: 'DEV', target: 'dev-target',
      configDigest: 'v1', stages: ['DEV'], artifactId: 'build-output',
      provider: 'fixture', pipeline: 'fixture-build',
      sourceRevision: artifact.sourceRevision, monitorCapability: true },
    request: scopedRequest, correlationKey: 'masked-scope', intent: 'Attempt to discard independently classified out-of-scope metadata' });
  await markDispatching(f.store, f.workItemId, scoped.operation.id);
  const scopedResult = await gate(f.store, { ...scopedRequest, sessionId: f.sessionId });
  assert.equal(scopedResult.permissionDecision, 'deny');
  assert.match(scopedResult.permissionDecisionReason, /Prepared outOfScope differs/u);
});
test('T-19 secondary member recovers a lost registry and session through explicit common work-item metadata', async t => {
  const f = await fixture(t);
  const secondary = path.join(f.root, 'secondary member');
  await fs.mkdir(secondary);
  await execute('git', ['init', '-q', '-b', 'feature/member'], { cwd: secondary });
  await f.store.bindMember({ workItemId: f.workItemId, repositoryId: 'secondary', cwd: secondary, sessionId: 'session-secondary' });
  await fs.unlink(path.join(f.store.runtime, 'registry.json'));
  await fs.unlink(f.store.sessionPath('session-secondary'));
  const result = await resume(f.store, { cwd: secondary, sessionId: 'session-replacement' });
  assert.equal(result.workItemId, f.workItemId);
  assert.equal(result.phase, 'requirements');
  assert.equal(Object.values((await readJson(path.join(f.store.runtime, 'registry.json'))).bindings)[0], f.workItemId);
});
test('T-20 phase overrides never leak outside scope or survive revocation; configuration cannot hide push', async t => {
  const f = await fixture(t);
  const override = await grant(f, 'override', { rules: ['phase'], reason: 'User authorizes only a specific file',
    transition: { from: 'requirements', to: 'coding' }, scope: { paths: ['one.mjs'] } });
  assert.equal(evaluatePolicy(await f.store.load(f.workItemId), { class: 'code', repositoryId: 'primary', paths: ['one.mjs'] }, { clock: f.clock }).allowed, true);
  assert.equal(evaluatePolicy(await f.store.load(f.workItemId), { class: 'code', repositoryId: 'primary', paths: ['other.mjs'] }, { clock: f.clock }).allowed, false);
  await grant(f, 'revocation', { revokes: [override.event.id] });
  const revokedState = await f.store.load(f.workItemId);
  assert.equal(evaluatePolicy(revokedState, { class: 'code', repositoryId: 'primary', paths: ['one.mjs'] }, { clock: f.clock }).allowed, false);
  assert.match(nextAction(revokedState, f.clock), /phase authority is revoked/u);
  await writeJson(path.join(f.repo, '.sdlc/config.json'), { defaultBranch: 'refs/heads/main',
    commands: [
      { command: 'git push --no-follow-tags --no-recurse-submodules origin refs/heads/feature/fixture:refs/heads/feature/fixture', action: { class: 'read' } },
      { command: 'git symbolic-ref HEAD refs/heads/unapproved', action: { class: 'read' } },
      { command: 'git symbolic-ref --delete refs/heads/temporary', action: { class: 'read' } },
    ],
    toolAdapters: [{ toolName: 'bash', match: { command: 'git push --no-follow-tags --no-recurse-submodules origin refs/heads/feature/fixture:refs/heads/adapter-branch' }, action: { class: 'read' } }] });
  await orient(f);
  const result = await gate(f.store, { cwd: f.repo, sessionId: f.sessionId, toolName: 'bash', toolArgs: { command: 'git push --no-follow-tags --no-recurse-submodules origin refs/heads/feature/fixture:refs/heads/feature/fixture' } });
  assert.equal(result.permissionDecision, 'deny');
  assert.match(result.permissionDecisionReason, /cannot (?:relabel|replace)/u);
  const adapterResult = await gate(f.store, { cwd: f.repo, sessionId: f.sessionId,
    toolName: 'bash', toolArgs: { command: 'git push --no-follow-tags --no-recurse-submodules origin refs/heads/feature/fixture:refs/heads/adapter-branch' } });
  assert.equal(adapterResult.permissionDecision, 'deny');
  assert.match(adapterResult.permissionDecisionReason, /Tool adapters? cannot (?:relabel|replace)/u);
  const symbolicResult = await gate(f.store, { cwd: f.repo, sessionId: f.sessionId,
    toolName: 'bash', toolArgs: { command: 'git symbolic-ref HEAD refs/heads/unapproved' } });
  assert.equal(symbolicResult.permissionDecision, 'deny');
  assert.match(symbolicResult.permissionDecisionReason, /cannot (?:relabel a symbolic-ref write|replace independently classified)/u);
  const symbolicDelete = await gate(f.store, { cwd: f.repo, sessionId: f.sessionId,
    toolName: 'bash', toolArgs: { command: 'git symbolic-ref --delete refs/heads/temporary' } });
  assert.equal(symbolicDelete.permissionDecision, 'deny');
  assert.match(symbolicDelete.permissionDecisionReason, /cannot (?:relabel a symbolic-ref write|replace independently classified)/u);
});
test('T-20/T-23 exact external artifact exemption does not authorize a second file or compound command', async t => {
  const f = await fixture(t);
  const external = path.join(f.root, 'authorized external requirements.md');
  await fs.writeFile(external, '# External requirements');
  const authorization = await grant(f, 'permission', { grant: 'artifact-location', target: external });
  await registerArtifact(f.store, { workItemId: f.workItemId, role: 'requirements', externalPath: external, authorizationId: authorization.event.id });
  await writeJson(path.join(f.repo, '.sdlc/config.json'), { defaultBranch: 'refs/heads/main' });
  await orient(f);
  assert.equal((await gate(f.store, { cwd: f.repo, sessionId: f.sessionId, toolName: 'edit', toolArgs: { path: external, old_str: 'External', new_str: 'Current' } })).permissionDecision, undefined);
  const patch = `*** Begin Patch\n*** Update File: ${external}\n@@\n-old\n+new\n*** Add File: unapproved-code.mjs\n+code\n*** End Patch`;
  assert.equal((await gate(f.store, { cwd: f.repo, sessionId: f.sessionId, toolName: 'apply_patch', toolArgs: patch })).permissionDecision, 'deny');
  assert.equal((await gate(f.store, { cwd: f.repo, sessionId: f.sessionId, toolName: 'bash', toolArgs: { command: 'git status && git push' } })).permissionDecision, 'deny');
});
test('T-20 git commit -a cannot hide unstaged implementation changes behind staged documents', async t => {
  const f = await fixture(t);
  const requirements = await artifact(f, 'requirements', '# Requirements\n');
  await registerArtifact(f.store, { workItemId: f.workItemId, role: 'requirements',
    repositoryId: 'primary', path: requirements });
  await fs.writeFile(path.join(f.repo, 'tracked-code.mjs'), 'export const value = 1;\n');
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Create tracked document and implementation fixtures');
  await fs.appendFile(path.join(f.repo, requirements), 'Updated requirement\n');
  await fs.writeFile(path.join(f.repo, 'tracked-code.mjs'), 'export const value = 2;\n');
  await writeJson(path.join(f.repo, '.sdlc/config.json'), { defaultBranch: 'refs/heads/main', commands: [
    { command: 'git add docs/requirements.md',
      action: { class: 'document', outOfScope: true, itemId: 'restricted-doc', externalPermission: false } },
    { command: 'git commit -m "Restricted document"',
      action: { class: 'document', outOfScope: true, itemId: 'restricted-doc', externalPermission: false } },
  ] });
  await orient(f);
  const restrictedAdd = await gate(f.store, { cwd: f.repo, sessionId: f.sessionId,
    toolName: 'bash', toolArgs: { command: 'git add docs/requirements.md' } });
  assert.equal(restrictedAdd.permissionDecision, 'deny');
  assert.match(restrictedAdd.permissionDecisionReason, /out-of-scope|External access/u);
  await f.runGit('add', requirements);
  const restrictedCommit = await gate(f.store, { cwd: f.repo, sessionId: f.sessionId,
    toolName: 'bash', toolArgs: { command: 'git commit -m "Restricted document"' } });
  assert.equal(restrictedCommit.permissionDecision, 'deny');
  assert.match(restrictedCommit.permissionDecisionReason, /out-of-scope|External access/u);
  const result = await gate(f.store, { cwd: f.repo, sessionId: f.sessionId,
    toolName: 'bash', toolArgs: { command: 'git commit -am \"Hide implementation change\"' } });
  assert.equal(result.permissionDecision, 'deny');
  assert.match(result.permissionDecisionReason, /index-only git commit/u);
  for (const command of [
    'git commit -S -a --no-gpg-sign -m "Hide implementation change"',
    'git commit --gpg-sign --amend -m "Rewrite the document commit"',
  ]) {
    const hidden = await gate(f.store, { cwd: f.repo, sessionId: f.sessionId,
      toolName: 'bash', toolArgs: { command } });
    assert.equal(hidden.permissionDecision, 'deny');
    assert.match(hidden.permissionDecisionReason, /index-only git commit/u);
  }
  for (const command of [
    'git commit -S:--all --no-gpg-sign -m "Hide implementation change"',
    'git commit -S:--amend --no-gpg-sign -m "Rewrite the document commit"',
  ]) {
    const hidden = await gate(f.store, { cwd: f.repo, sessionId: f.sessionId,
      toolName: 'powershell', toolArgs: { command } });
    assert.equal(hidden.permissionDecision, 'deny');
    assert.match(hidden.permissionDecisionReason, /PowerShell tokenization/u);
  }
  await fs.mkdir(path.join(f.repo, 'src'));
  await fs.writeFile(path.join(f.repo, 'src/hidden.mjs'), 'export const hidden = true;\n');
  const wildcard = await gate(f.store, { cwd: f.repo, sessionId: f.sessionId,
    toolName: 'bash', toolArgs: { command: "git add docs/requirements.md 'src/*.mjs'" } });
  assert.equal(wildcard.permissionDecision, 'deny');
  assert.match(wildcard.permissionDecisionReason, /wildcard\/magic/u);
  const relativeDirectory = await gate(f.store, { cwd: f.repo, sessionId: f.sessionId,
    toolName: 'bash', toolArgs: { command: 'git add docs/requirements.md ./src' } });
  assert.equal(relativeDirectory.permissionDecision, 'deny');
  assert.match(relativeDirectory.permissionDecisionReason, /canonical literal repository paths/u);
  const braceExpansion = await gate(f.store, { cwd: f.repo, sessionId: f.sessionId,
    toolName: 'bash', toolArgs: { command: 'git add docs/requirements.md src/{gate,policy}.mjs' } });
  assert.equal(braceExpansion.permissionDecision, 'deny');
  assert.match(braceExpansion.permissionDecisionReason, /canonical literal repository paths/u);
  const escapedPath = await gate(f.store, { cwd: f.repo, sessionId: f.sessionId,
    toolName: 'bash', toolArgs: { command: "git add docs/requirements.md 'src/\\hidden.mjs'" } });
  assert.equal(escapedPath.permissionDecision, 'deny');
  assert.match(escapedPath.permissionDecisionReason, /canonical literal repository paths/u);
  const multipleC = await gate(f.store, { cwd: f.repo, sessionId: f.sessionId,
    toolName: 'bash', toolArgs: { command: 'git -C "/" -C "." push' } });
  assert.equal(multipleC.permissionDecision, 'deny');
  assert.match(multipleC.permissionDecisionReason, /Multiple git -C options/u);
  const symbolicWrite = await gate(f.store, { cwd: f.repo, sessionId: f.sessionId,
    toolName: 'bash', toolArgs: { command: 'git symbolic-ref HEAD refs/heads/unapproved' } });
  assert.equal(symbolicWrite.permissionDecision, 'deny');
  const symbolicDelete = await gate(f.store, { cwd: f.repo, sessionId: f.sessionId,
    toolName: 'bash', toolArgs: { command: 'git symbolic-ref -qd refs/heads/temporary' } });
  assert.equal(symbolicDelete.permissionDecision, 'deny');
  const symbolicBrace = await gate(f.store, { cwd: f.repo, sessionId: f.sessionId,
    toolName: 'bash', toolArgs: { command: 'git symbolic-ref {HEAD,refs/heads/unapproved}' } });
  assert.equal(symbolicBrace.permissionDecision, 'deny');
});
test('T-17 once-only grants reserve one operation; revoked grants cannot dispatch already prepared work', async t => {
  const f = await coding(await fixture(t));
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Commit candidate before push authorization');
  const repositoryObservation = await observeFixtureRepository(f);
  const cycle = (await startCycle(f.store, { workItemId: f.workItemId, configDigest: 'v1', cause: 'once-only push' })).cycle;
  for (const testId of ['T-unit', 'T-integration']) await recordTest(f.store, { workItemId: f.workItemId,
    cycleId: cycle.id, testId, status: 'Passed', expectedMet: true,
    evidenceRef: `fixture:${testId}`, owner: 'agent', host: 'local' });
  await completeReview(f, cycle);
  const firstCommand = 'git push --no-follow-tags --no-recurse-submodules origin refs/heads/feature/fixture:refs/heads/feature/fixture';
  const authority = await grantPush(f, firstCommand, {
    repositoryObservation, effect: { lifetime: { kind: 'once' } },
  });
  const first = await prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId, action: authority.action,
    request: { toolName: 'bash', toolArgs: { command: firstCommand }, cwd: f.repo }, correlationKey: 'first', intent: 'First authorized publication' });
  await f.runGit('remote', 'add', 'alternate', 'https://example.invalid/alternate.git');
  await observeFixtureRepository(f, { remoteName: 'alternate' });
  const alternateCommand = 'git push --no-follow-tags --no-recurse-submodules alternate refs/heads/feature/fixture:refs/heads/feature/fixture';
  await assert.rejects(prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId,
    action: await pushAction(f, alternateCommand),
    request: { toolName: 'bash', toolArgs: { command: alternateCommand }, cwd: f.repo },
    correlationKey: 'second', intent: 'Second publication' }), { code: 'GATE' });
  await grant(f, 'revocation', { revokes: [authority.grant.event.id] });
  await assert.rejects(markDispatching(f.store, f.workItemId, first.operation.id), { code: 'GATE' });
});
test('T-22 documented hook payloads capture receipts and invalidate only their own session', async t => {
  const f = await fixture(t);
  const start = await cli(f, ['hook', 'sessionStart'], { sessionId: f.sessionId, cwd: f.repo, source: 'resume', timestamp: f.clock.now() });
  assert.equal(start.code, 0);
  assert.ok(start.json.additionalContext.includes('resume'));
  await cli(f, ['hook', 'userPromptSubmitted'], { sessionId: f.sessionId, cwd: f.repo, prompt: 'The actual fixture user message', timestamp: f.clock.now() });
  const latest = await cli(f, ['receipt', 'latest']);
  assert.ok(latest.json.receiptId);
  const file = path.join(f.store.runtime, 'sessions', f.sessionId, 'receipts', `${latest.json.receiptId}.json`);
  assert.ok(!(await fs.readFile(file, 'utf8')).includes('The actual fixture user message'));
  const before = await readJson(f.store.sessionPath(f.sessionId));
  await cli(f, ['hook', 'preCompact'], { sessionId: f.sessionId, cwd: f.repo, trigger: 'auto', timestamp: f.clock.now() });
  assert.equal((await readJson(f.store.sessionPath(f.sessionId))).orientationGeneration, before.orientationGeneration + 1);
});
test('T-29 Test Plan edits automatically derive a new canonical validation cycle', async t => {
  const f = await coding(await fixture(t));
  const first = await startCycle(f.store, { workItemId: f.workItemId, configDigest: 'v1', cause: 'initial plan' });
  await orient(f);
  const plan = path.join(f.repo, 'docs/test-plan.md');
  const original = await fs.readFile(plan, 'utf8');
  await fs.writeFile(plan, original.replace('Integration contract holds', 'Updated integration contract holds'));
  const hook = await handleHook(f.store, 'postToolUse', {
    sessionId: f.sessionId, cwd: f.repo, toolName: 'edit',
    toolArgs: { path: 'docs/test-plan.md', old_str: 'Integration contract holds', new_str: 'Updated integration contract holds' },
  });
  assert.match(hook.additionalContext, /Test Plan changed/u);
  const state = await f.store.load(f.workItemId);
  const current = currentCycle(state.records, state.checkpoint);
  assert.notEqual(current.id, first.cycle.id);
  assert.equal(current.generation, first.cycle.generation + 1);
  assert.equal(current.tests.find(test => test.id === 'T-integration').expected, 'Updated integration contract holds');
  await fs.writeFile(plan, (await fs.readFile(plan, 'utf8')).replace('Updated integration contract holds', 'Recovered integration contract holds'));
  await resume(f.store, { cwd: f.repo, sessionId: f.sessionId, workItemId: f.workItemId });
  const recoveredState = await f.store.load(f.workItemId);
  const recovered = currentCycle(recoveredState.records, recoveredState.checkpoint);
  assert.equal(recovered.generation, current.generation + 1);
  assert.equal(recovered.tests.find(test => test.id === 'T-integration').expected, 'Recovered integration contract holds');
});
test('T-30 failed candidate reconciliation keeps the recovery barrier active', async t => {
  const f = await coding(await fixture(t));
  await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: 'v1', cause: 'recovery barrier through reconciliation' });
  const plan = path.join(f.repo, 'docs/test-plan.md');
  const original = await fs.readFile(plan, 'utf8');
  await fs.writeFile(plan, '# Invalid plan without tests\n');
  await assert.rejects(resume(f.store, { cwd: f.repo, sessionId: f.sessionId,
    workItemId: f.workItemId }), { code: 'ARTIFACT' });
  assert.equal((await f.store.load(f.workItemId)).recoveryRequired, true);
  await assert.rejects(grant(f, 'scope-inclusion', { itemId: 'blocked-after-reconcile-failure' }),
    { code: 'RECOVERY' });
  await fs.writeFile(plan, original);
  await resume(f.store, { cwd: f.repo, sessionId: f.sessionId, workItemId: f.workItemId });
  assert.equal((await f.store.load(f.workItemId)).recoveryRequired, false);
});
test('T-18/T-20 one exact pre-tool dispatch binds once and a lost post-tool handle remains uncertain', async t => {
  const f = await coding(await fixture(t));
  await writeJson(path.join(f.repo, '.sdlc/config.json'), { defaultBranch: 'refs/heads/main' });
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Commit exact push candidate');
  const repositoryObservation = await observeFixtureRepository(f);
  const cycle = (await startCycle(f.store, { workItemId: f.workItemId, configDigest: 'v1', cause: 'exact push' })).cycle;
  for (const testId of ['T-unit', 'T-integration']) await recordTest(f.store, { workItemId: f.workItemId,
    cycleId: cycle.id, testId, status: 'Passed', expectedMet: true,
    evidenceRef: `fixture:${testId}`, owner: 'agent', host: 'local' });
  await completeReview(f, cycle);
  const request = { toolName: 'bash', toolArgs: { command: 'git push --no-follow-tags --no-recurse-submodules origin refs/heads/feature/fixture:refs/heads/feature/fixture' }, cwd: f.repo };
  const push = await grantPush(f, request.toolArgs.command, { repositoryObservation });
  const { operation } = await prepareOperation(f.store, { workItemId: f.workItemId, sessionId: f.sessionId,
    action: push.action, request, correlationKey: 'exact-dispatch', intent: 'Publish only the authorized branch' });
  await orient(f);
  await markDispatching(f.store, f.workItemId, operation.id);
  const payload = { ...request, sessionId: f.sessionId, timestamp: f.clock.now() };
  const firstGate = await gate(f.store, payload);
  assert.equal(firstGate.permissionDecision, undefined, JSON.stringify(firstGate));
  const state = await f.store.load(f.workItemId);
  const member = state.metadata.members.find(item => item.repositoryId === 'primary');
  await f.store.bindSession('session-b', f.workItemId, member);
  await handleHook(f.store, 'postToolUse', {
    ...payload,
    sessionId: 'session-b',
    toolResult: { textResultForLlm: '{"id":"run-from-other-session"}' },
  });
  assert.equal((await f.store.records(f.workItemId))
    .find(record => record.id === operation.id).status, 'dispatching');
  assert.equal((await gate(f.store, payload)).permissionDecision, 'deny');
  await handleHook(f.store, 'postToolUseFailure', { ...payload, error: 'The provider response was lost after dispatch' });
  assert.equal((await f.store.records(f.workItemId)).find(r => r.id === operation.id).status, 'uncertain');
});
test('T-18 completed operations retire beyond the unresolved limit and archived IDs remain idempotent', async t => {
  const f = await coding(await fixture(t));
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Commit repeated push candidate');
  const repositoryObservation = await observeFixtureRepository(f);
  const cycle = (await startCycle(f.store, { workItemId: f.workItemId, configDigest: 'v1', cause: 'repeated pushes' })).cycle;
  for (const testId of ['T-unit', 'T-integration']) await recordTest(f.store, { workItemId: f.workItemId,
    cycleId: cycle.id, testId, status: 'Passed', expectedMet: true,
    evidenceRef: `fixture:${testId}`, owner: 'agent', host: 'local' });
  await completeReview(f, cycle);
  let original;
  for (let index = 0; index < 22; index++) {
    const command = `git push --no-follow-tags --no-recurse-submodules origin refs/heads/feature/fixture:refs/heads/publication-${index}`;
    const { action } = await grantPush(f, command, { repositoryObservation });
    const input = { workItemId: f.workItemId, sessionId: f.sessionId,
      action,
      request: { toolName: 'bash', toolArgs: { command }, cwd: f.repo },
      correlationKey: `publication-${index}`, intent: 'Record a distinct authorized publication fixture' };
    original ??= input;
    const { operation } = await prepareOperation(f.store, input);
    registerFixtureProviderRequest(f, operation);
    await markDispatching(f.store, f.workItemId, operation.id);
    const observedResult = registerFixtureProviderResult(f, operation, {
      providerResultId: `origin:${action.targetRef}`,
      result: { destination: action.target, ref: action.targetRef,
        revision: action.sourceRevision, published: true,
        remoteRepositoryURL: repositoryObservation.remoteRepositoryURL,
        remoteUrlDigest: action.remoteUrlDigest },
    });
    await recordOperation(f.store, { workItemId: f.workItemId, operationId: operation.id, status: 'succeeded',
      observedResult });
    await pruneWork(f.store, f.workItemId);
  }
  assert.equal((await f.store.records(f.workItemId)).filter(record => record.type === 'operation').length, 0);
  assert.equal((await prepareOperation(f.store, original)).action, 'already-terminal');
});
