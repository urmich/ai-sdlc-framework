import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fixture, coding, completeReview, grant, testDefinitions,
  registerFixtureProviderRequest, registerFixtureProviderResult } from './helpers.mjs';

const adapter = path.resolve('test/fixtures/cli-provider-verifiers.mjs');
const bin = path.resolve('bin/sdlc.mjs');
const remoteRepositoryURL = 'https://example.invalid/repository.git';

function invoke(f, script, args, input, facts, extraEnv = {}) {
  const env = {
    Path: process.env.Path, PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
    TEMP: process.env.TEMP, TMP: process.env.TMP,
    HOME: f.home, USERPROFILE: f.home, COPILOT_HOME: f.home,
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(f.root, 'empty-git-config'),
    GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '',
    FIXTURE_COPILOT_HOME: f.home,
    FIXTURE_PROVIDER_FACTS: JSON.stringify(facts),
    ...extraEnv,
  };
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [script, ...args], {
      cwd: f.repo, env, maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error && typeof error.code !== 'number') return reject(error);
      try {
        assert.equal(stderr, '');
        const lines = stdout.trim().split(/\r?\n/u);
        assert.equal(lines.length, 1, `Expected one JSON response, got ${stdout}`);
        resolve({ code: error?.code ?? 0, result: JSON.parse(lines[0]) });
      } catch (failure) {
        reject(failure);
      }
    });
    child.stdin.end(input === undefined ? '' : JSON.stringify(input));
  });
}

test('public CLI verifier injection survives process boundaries and rejects mismatched evidence', async t => {
  const f = await coding(await fixture(t, { compactPath: true }));
  await fs.writeFile(path.join(f.root, 'empty-git-config'), '');
  await fs.writeFile(path.join(f.repo, '.sdlc', 'config.json'), JSON.stringify({
    defaultBranch: 'refs/heads/main',
    environments: { DEV: { target: 'dev-target',
      configDigest: 'configuration-1', allowedStages: ['DEV'] } },
  }));
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Fixture candidate');
  const revision = await f.runGit('rev-parse', 'HEAD');
  const now = f.clock.now();
  const observedAt = new Date(now).toISOString();
  const repository = {
    canonicalLocalRepositoryPath: f.repo,
    verifiedRemoteRepositoryURL: remoteRepositoryURL,
    verifiedProvider: 'fixture', verifiedConnection: 'fixture-connection',
    verifiedRepositoryRef: 'repository-17', verifiedRevision: revision,
    verifiedDefaultBranchRef: 'refs/heads/main',
    verifiedObservedAt: observedAt, verifiedEvidenceRef: 'fixture:repository-17',
  };
  const pr = {
    repositoryId: 'primary', localRepositoryPath: f.repo, remoteRepositoryURL,
    provider: 'fixture', connection: 'fixture-connection',
    repositoryRef: 'repository-17', pullRequestRef: 'pr-19',
    sourceBranchRef: 'refs/heads/feature/fixture',
    targetBranchRef: 'refs/heads/main',
    sourceRevision: revision, targetRevision: 'b'.repeat(40),
    state: 'active', observedAt, evidenceRef: 'fixture:pr-19',
  };
  const facts = {
    now, repository,
    pullRequest: {
      canonicalLocalRepositoryPath: f.repo,
      verifiedRemoteRepositoryURL: remoteRepositoryURL,
      verifiedProvider: 'fixture', verifiedConnection: 'fixture-connection',
      verifiedRepositoryRef: 'repository-17',
      verifiedPullRequestRef: pr.pullRequestRef,
      verifiedSourceBranchRef: pr.sourceBranchRef,
      verifiedTargetBranchRef: pr.targetBranchRef,
      verifiedSourceRevision: pr.sourceRevision,
      verifiedTargetRevision: pr.targetRevision,
      verifiedState: pr.state, verifiedObservedAt: pr.observedAt,
      verifiedEvidenceRef: pr.evidenceRef,
    },
  };
  const args = (...command) => [
    ...command, '--home', f.home, '--cwd', f.repo, '--work-item', f.workItemId,
    '--session', f.sessionId,
  ];
  const call = (command, input, trusted = facts, script = adapter, extraEnv) =>
    invoke(f, script, args(...command), input, trusted, extraEnv);

  const observation = {
    workItemId: f.workItemId, repositoryId: 'primary',
    selectedRemoteName: 'origin', localRepositoryPath: f.repo,
    remoteRepositoryURL, provider: 'fixture', connection: 'fixture-connection',
    repositoryRef: 'repository-17', revision,
    defaultBranchRef: 'refs/heads/main',
    observedAt, evidenceRef: 'fixture:repository-17',
  };
  const unconfigured = await call(['repository', 'observe'], observation, facts, bin);
  assert.equal(unconfigured.code, 4);
  assert.equal(unconfigured.result.error.code, 'ADAPTER');
  assert.equal((await f.store.records(f.workItemId)).some(record =>
    record.type === 'repository-observation'), false);

  const wrongHome = path.join(f.root, 'another-copilot-home');
  await fs.mkdir(wrongHome);
  assert.notEqual(await fs.realpath(wrongHome), await fs.realpath(f.home));
  const wrong = await invoke(f, adapter,
    ['repository', 'observe', '--home', wrongHome, '--cwd', f.repo,
      '--work-item', f.workItemId], observation, facts,
    { FIXTURE_WRONG_HOME: '1', FIXTURE_READY_FACTORY: '1' });
  assert.equal(wrong.code, 4);
  assert.equal(wrong.result.error.code, 'ADAPTER');
  assert.deepEqual(await fs.readdir(wrongHome), []);

  const observed = await call(['repository', 'observe'], observation);
  assert.equal(observed.code, 0);
  assert.deepEqual(Object.fromEntries([
    'localRepositoryPath', 'remoteRepositoryURL', 'provider', 'connection',
    'repositoryRef', 'revision', 'defaultBranchRef', 'observedAt', 'evidenceRef',
  ].map(key => [key, observed.result[key]])), observationToRecord(observation));
  const wrongRepository = await call(['repository', 'observe'], {
    ...observation, repositoryRef: 'other-repository',
  });
  assert.equal(wrongRepository.code, 4);
  assert.equal(wrongRepository.result.error.code, 'EVIDENCE');

  const wrongPr = await call(['pr', 'adopt'], {
    workItemId: f.workItemId, observation: { ...pr, pullRequestRef: 'pr-20' },
  });
  assert.equal(wrongPr.code, 4);
  assert.equal(wrongPr.result.error.code, 'EVIDENCE');
  const unconfiguredPr = await call(['pr', 'adopt'], {
    workItemId: f.workItemId, observation: pr,
  }, facts, bin);
  assert.equal(unconfiguredPr.code, 4);
  assert.equal(unconfiguredPr.result.error.code, 'ADAPTER');
  const adopted = await call(['pr', 'adopt'], {
    workItemId: f.workItemId, observation: pr,
  });
  assert.equal(adopted.code, 0);
  assert.deepEqual(Object.fromEntries(Object.keys(pr).map(key =>
    [key, adopted.result.observation[key]])), pr);
  assert.equal(adopted.result.authority,
    'observation-only; adoption grants no publish, merge or deployment permission');
  const status = await call(['status']);
  assert.equal(status.code, 0);
  assert.deepEqual(status.result.pullRequests.map(item => ({
    localRepositoryPath: item.localRepositoryPath,
    remoteRepositoryURL: item.remoteRepositoryURL,
    pullRequestRef: item.pullRequestRef, sourceRevision: item.sourceRevision,
    targetRevision: item.targetRevision,
  })), [{
    localRepositoryPath: f.repo, remoteRepositoryURL,
    pullRequestRef: 'pr-19', sourceRevision: revision,
    targetRevision: pr.targetRevision,
  }]);

  const identity = {
    provider: 'fixture', connection: 'fixture-connection',
    scopeRef: 'repository-17', definitionRef: 'fixture-checks',
    executionRef: 'fixture-check-run-1', attemptKind: 'not-applicable',
  };
  const evidenceFile = path.join(f.root, 'verified-check-result.bin');
  const bytes = Buffer.from('trusted fixture check result for pr-19');
  await fs.writeFile(evidenceFile, bytes);
  const evidence = { reference: {
    locator: 'fixture:check-run-1',
    retrievalContext: { provider: 'fixture',
      connection: 'fixture-connection', scopeRef: 'repository-17',
      retrievedAt: observedAt },
    sha256: createHash('sha256').update(bytes).digest('hex'),
  } };
  const checks = [{
    requiredCheckRef: 'build', checkResultRef: 'result-1',
    producerRef: 'fixture-checks', testedRevision: revision,
    evidenceRef: 'fixture:check-result-1', status: 'succeeded',
    localRepositoryPath: f.repo, remoteRepositoryURL,
    repositoryRef: 'repository-17', pullRequestRef: 'pr-19',
    sourceRevision: revision, targetRevision: pr.targetRevision,
  }];
  facts.checks = {
    identity, status: 'succeeded',
    evidenceReference: evidence.reference, checkResults: checks,
  };
  const attached = await call(['monitor', 'attach'], {
    identity, origin: 'framework', workItemId: f.workItemId,
    schedulerAvailable: true, readAvailable: true,
  });
  assert.equal(attached.code, 0);
  const claimed = await call(['monitor', 'claim'], {
    runKey: attached.result.key, workerId: 'fixture-worker',
  });
  assert.equal(claimed.code, 0);
  const poll = await call(['monitor', 'begin-poll'], {
    runKey: attached.result.key, workerId: 'fixture-worker',
    claimGeneration: claimed.result.claimGeneration,
  });
  assert.equal(poll.code, 0);
  const observationInput = {
    runKey: attached.result.key, workerId: 'fixture-worker',
    claimGeneration: claimed.result.claimGeneration,
    pollGeneration: poll.result.pollGeneration, identity, status: 'succeeded',
    evidence, checkResults: checks,
  };
  const checkArgs = args('monitor', 'observe', '--evidence-file', evidenceFile);
  const wrongCheck = await invoke(f, adapter, checkArgs, {
    ...observationInput, checkResults: [
      { ...checks[0], checkResultRef: 'another-result' },
    ],
  }, facts);
  assert.equal(wrongCheck.code, 4);
  assert.equal(wrongCheck.result.error.code, 'EVIDENCE');
  const unconfiguredCheck = await invoke(f, bin, checkArgs, observationInput, facts);
  assert.equal(unconfiguredCheck.code, 4);
  assert.equal(unconfiguredCheck.result.error.code, 'ADAPTER');
  const checked = await invoke(f, adapter, checkArgs, observationInput, facts);
  assert.equal(checked.code, 0);
  assert.deepEqual(checked.result.checkResults, checks);
  assert.deepEqual(checked.result.evidenceVerification,
    { verified: true, identity: 'sha256' });

  const started = await call(['cycle', 'start'], {
    workItemId: f.workItemId, tests: testDefinitions(),
    configDigest: 'configuration-1', cause: 'isolated provider fixture',
  });
  assert.equal(started.code, 0);
  const cycle = started.result.cycle;
  for (const testId of ['T-unit', 'T-integration']) {
    const evidence = await call(['evidence', 'test'], {
      workItemId: f.workItemId, cycleId: cycle.id, testId,
      status: 'Passed', owner: 'agent', host: 'local',
      expectedMet: true, evidenceRef: `fixture:${testId}`,
    });
    assert.equal(evidence.code, 0);
  }
  await completeReview(f, cycle);
  await grant(f, 'dev-authorization', {
    cycleId: cycle.id, candidateDigest: cycle.candidateDigest,
    testSpecDigest: cycle.testSpecDigest, configDigest: cycle.configDigest,
    target: 'dev-target', completedStage: 'review',
  });
  facts.now = f.clock.now();
  const prepared = await call(['op', 'prepare'], {
    workItemId: f.workItemId, sessionId: f.sessionId,
    action: { class: 'build', repositoryId: 'primary', environment: 'DEV',
      target: 'dev-target', provider: 'fixture', pipeline: 'fixture-build',
      monitorCapability: true, sourceRevision: revision,
      configDigest: cycle.configDigest },
    request: { toolName: 'fixture_build', toolArgs: { revision }, cwd: f.repo },
    correlationKey: 'public-cli-provider-build', intent: 'Build the fixture candidate',
  });
  assert.equal(prepared.code, 0);
  const operation = prepared.result.operation;
  assert.equal(operation.intendedOutcome.family, 'execution');
  registerFixtureProviderRequest(f, operation);
  const dispatched = await call(['op', 'mark-dispatching', '--operation', operation.id]);
  assert.equal(dispatched.code, 0);
  assert.equal(dispatched.result.status, 'dispatching');
  const executionRef = 'fixture-run-42';
  const providerResultId = `${executionRef}:not-applicable`;
  const executionIdentity = {
    provider: 'fixture', connection: 'fixture-connection',
    scopeRef: 'repository-17', definitionRef: 'fixture-build',
    executionRef, attemptKind: 'not-applicable',
  };
  const handle = registerFixtureProviderResult(f, operation, {
    providerResultId,
    result: { executionRef, attemptCapability: 'none',
      attemptRef: 'not-applicable', sourceRevision: revision,
      configDigest: cycle.configDigest, candidateDigest: cycle.candidateDigest,
      testSpecDigest: cycle.testSpecDigest,
      environment: 'DEV', target: 'dev-target', provider: 'fixture',
      pipeline: 'fixture-build', remoteRepositoryURL, executionIdentity },
  });
  facts.operation = {
    id: operation.id, handle, verification: f.providerResults.get(operation.id),
  };
  const mismatchedRun = await call(['op', 'record'], {
    workItemId: f.workItemId, operationId: operation.id,
    status: 'succeeded', observedResult: handle,
  }, { ...facts, operation: {
    ...facts.operation,
    verification: { ...facts.operation.verification,
      observation: { ...facts.operation.verification.observation,
        providerResultId: 'other-run:not-applicable' } },
  } });
  assert.equal(mismatchedRun.code, 0);
  assert.equal(mismatchedRun.result.status, 'uncertain');
  assert.equal(mismatchedRun.result.resultProof, undefined);
  const unconfiguredResult = await call(['op', 'reconcile'], {
    workItemId: f.workItemId, operationId: operation.id,
    status: 'succeeded', observedResult: handle,
  }, facts, bin);
  assert.equal(unconfiguredResult.code, 0);
  assert.equal(unconfiguredResult.result.status, 'uncertain');
  assert.equal(unconfiguredResult.result.resultProof, undefined);
  const recorded = await call(['op', 'reconcile'], {
    workItemId: f.workItemId, operationId: operation.id,
    status: 'succeeded', observedResult: handle,
  });
  assert.equal(recorded.code, 0);
  assert.equal(recorded.result.status, 'succeeded');
  assert.equal(recorded.result.resultProof.providerResultId, providerResultId);
  assert.equal(recorded.result.resultProof.dispatchId, operation.id);
  assert.deepEqual(recorded.result.resultProof.executionIdentity, executionIdentity);
  const shown = await call(['op', 'show', '--operation', operation.id]);
  assert.equal(shown.code, 0);
  assert.equal(shown.result.operation.resultProof.providerResultId, providerResultId);

  const artifactRef = 'fixture-artifact-42';
  const artifactSha256 = createHash('sha256').update('fixture artifact bytes')
    .digest('hex');
  const artifactFields = {
    repositoryId: 'primary', localRepositoryPath: f.repo,
    remoteRepositoryURL, provider: 'fixture', connection: 'fixture-connection',
    repositoryRef: 'repository-17', sourceRevision: revision,
    configDigest: cycle.configDigest, artifactId: 'fixture-package',
    artifactRef, artifactSha256, buildRunId: providerResultId,
    name: 'package', evidenceRef: 'fixture:artifact-42',
  };
  facts.artifact = {
    operationId: operation.id, handle: { fixtureArtifactRef: artifactRef },
    verification: { ...artifactFields,
      attemptCapability: 'none', attemptRef: 'not-applicable',
      producingExecution: executionIdentity },
  };
  const artifactInput = {
    workItemId: f.workItemId, cycleId: cycle.id, environment: 'DEV',
    sourceDigest: cycle.candidateDigest, artifactType: 'archive',
    status: 'succeeded', producingOperationId: operation.id,
    ...artifactFields, producerObservation: facts.artifact.handle,
  };
  const wrongArtifact = await call(['evidence', 'artifact'], {
    ...artifactInput, artifactRef: 'different-artifact',
  });
  assert.equal(wrongArtifact.code, 4);
  assert.equal(wrongArtifact.result.error.code, 'EVIDENCE');
  const unconfiguredArtifact = await call(['evidence', 'artifact'],
    artifactInput, facts, bin);
  assert.equal(unconfiguredArtifact.code, 4);
  assert.equal(unconfiguredArtifact.result.error.code, 'ADAPTER');
  const admitted = await call(['evidence', 'artifact'], artifactInput);
  assert.equal(admitted.code, 0);
  assert.deepEqual(Object.fromEntries(Object.keys(artifactFields).map(key =>
    [key, admitted.result[key]])), artifactFields);
  assert.equal(admitted.result.producingOperationId, operation.id);
  assert.deepEqual(admitted.result.producingExecution, executionIdentity);
  const readback = await invoke(f, adapter,
    ['fixture-readback', f.home, f.workItemId, attached.result.key],
    undefined, facts);
  assert.equal(readback.code, 0);
  assert.deepEqual(readback.result.records.filter(record =>
    record.type === 'artifact').map(record => ({
    artifactId: record.artifactId, buildRunId: record.buildRunId,
    remoteRepositoryURL: record.remoteRepositoryURL,
    sourceRevision: record.sourceRevision,
    artifactSha256: record.artifactSha256,
    producingOperationId: record.producingOperationId,
  })), [{
    artifactId: 'fixture-package', buildRunId: providerResultId,
    remoteRepositoryURL, sourceRevision: revision, artifactSha256,
    producingOperationId: operation.id,
  }]);
  assert.equal(readback.result.records.filter(record =>
    record.type === 'repository-observation').length, 1);
  assert.deepEqual(readback.result.monitor.checkResults, checks);
  assert.deepEqual(readback.result.monitor.evidenceVerification,
    { verified: true, identity: 'sha256' });

  await t.test('initialized Store accepts a real selected-home alias, not a different home', async aliasTest => {
    const alias = path.join(f.root, 'copilot-home-alias');
    const unavailable = new Set(['EPERM', 'EACCES', 'ENOTSUP', 'ENOSYS']);
    let linked = false;
    try {
      for (const kind of process.platform === 'win32' ?
        ['junction', 'dir'] : ['dir']) {
        try {
          await fs.symlink(f.home, alias, kind);
          linked = true;
          break;
        } catch (error) {
          if (!unavailable.has(error.code)) throw error;
        }
      }
      if (!linked) {
        aliasTest.skip('NotRun: this host cannot create a directory junction or symlink');
        return;
      }
      assert.equal((await fs.lstat(alias)).isSymbolicLink(), true);
      const canonical = value => process.platform === 'win32' ?
        value.toLowerCase() : value;
      assert.equal(canonical(await fs.realpath(alias)),
        canonical(await fs.realpath(f.home)));

      const aliasedSelection = await invoke(f, adapter,
        ['repository', 'observe', '--home', alias, '--cwd', f.repo,
          '--work-item', f.workItemId, '--session', f.sessionId],
        observation, facts, {
          FIXTURE_FACTORY_HOME: f.home, FIXTURE_READY_FACTORY: '1',
        });
      assert.equal(aliasedSelection.code, 0);
      assert.deepEqual(aliasedSelection.result, observed.result);

      const aliasedFactory = await invoke(f, adapter, args('status'),
        undefined, facts, {
          FIXTURE_FACTORY_HOME: alias, FIXTURE_READY_FACTORY: '1',
        });
      assert.equal(aliasedFactory.code, 0);
      assert.equal(aliasedFactory.result.workItemId, f.workItemId);
      assert.deepEqual(aliasedFactory.result.pullRequests,
        status.result.pullRequests);
    } finally {
      if (linked) {
        await fs.unlink(alias);
        await assert.rejects(fs.lstat(alias), { code: 'ENOENT' });
      }
    }
  });
});

function observationToRecord(observation) {
  const { localRepositoryPath, remoteRepositoryURL, provider,
    connection, repositoryRef, revision, defaultBranchRef,
    observedAt, evidenceRef } = observation;
  return { localRepositoryPath, remoteRepositoryURL, provider,
    connection, repositoryRef, revision, defaultBranchRef,
    observedAt, evidenceRef };
}
