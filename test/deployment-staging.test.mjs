import {
  test, assert, path, fs, fixture,
  coding, completeReview, finishFixtureOperation, fixtureArtifact, fixtureBuild,
  fixtureDeployment, grant, observeFixtureRepository, prepareFixtureDeployment, registerFixtureProviderRequest,
  testDefinitions, orient, startCycle, recordArtifact, recordTest,
  stagingHandoff, readJson, writeJson, prepareOperation, markDispatching,
  pruneWork, recordOperation, evaluatePolicy, currentCycle, currentTestEvidence,
  hasStagingCompletion, hasStageCompletion, latestStagingResultEvent, stagePassed, gate,
  loadConfig, synchronizeTestPlan, testSpecificationDigest, formatAudit, recordAudit,
  nextAction, stagingExecutionGuidance,
} from './deployment-support.mjs';

test('T-27 legacy STAGING confirmations without current deployment proof do not complete the stage', () => {
  const cycle = { id: 'cycle-1', candidateDigest: 'candidate', testSpecDigest: 'spec', configDigest: 'config',
    pendingPlanSync: false, deployments: { STAGING: 'deploy-1' },
    tests: [{ id: 'staging-a', environment: 'STAGING' }, { id: 'staging-b', environment: 'STAGING' }],
    results: { 'staging-a': 'evidence-a', 'staging-b': 'evidence-b' } };
  const records = [
    { id: 'deploy-1', type: 'operation', status: 'succeeded', artifactId: 'artifact-1' },
    { id: 'evidence-a', type: 'test-evidence', testId: 'staging-a',
      status: 'Passed', cycleId: cycle.id,
      candidateDigest: cycle.candidateDigest, testSpecDigest: cycle.testSpecDigest, deploymentId: 'deploy-1',
      artifactId: 'artifact-1', environment: 'STAGING', owner: 'user',
      host: 'authorized-machine', eventId: 'event-a' },
    { id: 'evidence-b', type: 'test-evidence', testId: 'staging-b',
      status: 'Passed', cycleId: cycle.id,
      candidateDigest: cycle.candidateDigest, testSpecDigest: cycle.testSpecDigest, deploymentId: 'deploy-1',
      artifactId: 'artifact-1', environment: 'STAGING', owner: 'user',
      host: 'authorized-machine', eventId: 'event-b' },
    { id: 'event-a', type: 'event', sequence: 1, kind: 'staging-result', effect: {
      cycleId: cycle.id, candidateDigest: cycle.candidateDigest, testSpecDigest: cycle.testSpecDigest,
      configDigest: cycle.configDigest, deploymentId: 'deploy-1', artifactId: 'artifact-1',
      testIds: ['staging-a'], outcome: 'Passed', owner: 'user',
      host: 'authorized-machine', evidenceRef: 'fixture:event-a' },
      occurredAt: '2026-09-16T00:00:01.000Z' },
  ];
  assert.equal(hasStagingCompletion(records, cycle), false);
  records.push({ id: 'event-b', type: 'event', sequence: 2, kind: 'staging-result', effect: {
    cycleId: cycle.id, candidateDigest: cycle.candidateDigest, testSpecDigest: cycle.testSpecDigest,
    configDigest: cycle.configDigest, deploymentId: 'deploy-1', artifactId: 'artifact-1',
    testIds: ['staging-b'], outcome: 'Passed', owner: 'user',
    host: 'authorized-machine', evidenceRef: 'fixture:event-b' },
    occurredAt: '2026-09-16T00:00:02.000Z' });
  assert.notEqual(currentTestEvidence(cycle, records, cycle.tests[0])?.status, 'Passed');
  assert.notEqual(currentTestEvidence(cycle, records, cycle.tests[1])?.status, 'Passed');
  assert.equal(hasStagingCompletion(records, cycle), false);
  records.push({ id: 'staging-complete', type: 'event', sequence: 3,
    kind: 'stage-completion', effect: {
      cycleId: cycle.id, candidateDigest: cycle.candidateDigest,
      testSpecDigest: cycle.testSpecDigest, configDigest: cycle.configDigest,
      completedStage: 'STAGING', deploymentId: 'deploy-1',
      target: 'staging-target' } });
  assert.equal(hasStagingCompletion(records, cycle), false);
    records.push({ id: 'event-a-new', type: 'event', sequence: 4, kind: 'staging-result', effect: {
      cycleId: cycle.id, candidateDigest: cycle.candidateDigest, testSpecDigest: cycle.testSpecDigest,
      configDigest: cycle.configDigest, deploymentId: 'deploy-1', artifactId: 'artifact-1',
      testIds: ['staging-a'], outcome: 'Passed', owner: 'user',
      host: 'authorized-machine', evidenceRef: 'fixture:event-a-new' },
      occurredAt: '2026-09-16T00:00:03.000Z' });
    records.find(record => record.id === 'evidence-a').eventId = 'event-a-new';
    assert.equal(latestStagingResultEvent(records, cycle, 'staging-a'), null);
    assert.equal(latestStagingResultEvent(records, cycle, 'staging-b'), null);
    assert.ok(records.some(record => record.id === 'event-a-new'));
    assert.ok(records.some(record => record.id === 'event-b'));
    assert.equal(hasStagingCompletion(records, cycle), false);
});

test('T-50 STAGING execution policy and legacy unproven deployment cannot grant a pass', async t => {
  const f = await coding(await fixture(t));
  const cycle = (await startCycle(f.store, {
    workItemId: f.workItemId,
    configDigest: 'policy-v1',
    cause: 'STAGING execution policy',
  })).cycle;
  const state = await f.store.load(f.workItemId);
  const current = currentCycle(state.records, state.checkpoint);
  current.deployments.STAGING = 'deploy-policy';
  state.records.push({
    type: 'operation',
    id: 'deploy-policy',
    class: 'deploy',
    status: 'dispatching',
    artifactId: 'artifact-policy',
    repositoryId: 'primary',
  });

  {
    const f = await coding(await fixture(t));
    const planPath = path.join(f.repo, 'docs/test-plan.md');
    const plan = await fs.readFile(planPath, 'utf8');
    const agentPlan = plan.split('\n').map(line =>
      line.startsWith('| T-staging |') ?
        line.replace('| user | authorized-machine |',
          '| agent | staging-runner |') : line).join('\n');
    assert.notEqual(agentPlan, plan);
    await fs.writeFile(planPath, agentPlan);
    await writeJson(path.join(f.repo, '.sdlc/config.json'), {
      defaultBranch: 'refs/heads/main',
      environments: {
        STAGING: {
          target: 'staging-target',
          configDigest: 'agent-policy-v1',
          allowedStages: ['STAGING'],
          execution: { owner: 'agent', locations: ['staging-runner'] },
        },
      },
    });
    const cycle = (await startCycle(f.store, {
      workItemId: f.workItemId,
      configDigest: 'agent-policy-v1',
      cause: 'agent-owned STAGING evidence',
    })).cycle;
    await f.store.transaction(f.workItemId, tx => {
      tx.put({
        type: 'operation',
        id: 'deploy-agent-staging',
        workItemId: f.workItemId,
        sessionId: f.sessionId,
        repositoryId: 'primary',
        bindingKey: 'fixture-binding',
        class: 'deploy',
        action: {
          class: 'deploy',
          repositoryId: 'primary',
          environment: 'STAGING',
          target: 'staging-target',
          artifactId: 'artifact-agent-staging',
        },
        target: 'staging-target',
        status: 'dispatching',
        correlationKey: 'deploy-agent-staging',
        requestFingerprint: 'deploy-agent-staging-request',
        effectFingerprint: 'deploy-agent-staging-effect',
        intent: 'Fixture STAGING deployment',
        createdAt: '2026-09-16T00:00:00.000Z',
        dispatchBound: true,
        cycleId: cycle.id,
        candidateDigest: cycle.candidateDigest,
        candidateStamp: 'fixture-stamp',
        artifactId: 'artifact-agent-staging',
        deploymentSequence: 1,
      });
      tx.put({
        type: 'operation',
        id: 'test-agent-staging',
        workItemId: f.workItemId,
        sessionId: f.sessionId,
        repositoryId: 'primary',
        bindingKey: 'fixture-binding',
        class: 'test',
        action: {
          class: 'test',
          repositoryId: 'primary',
          environment: 'STAGING',
          target: 'staging-target',
          configDigest: 'agent-policy-v1',
          testId: 'T-staging',
          owner: 'agent',
          host: 'staging-runner',
          deploymentId: 'deploy-agent-staging',
          artifactId: 'artifact-agent-staging',
        },
        target: 'staging-target',
        status: 'dispatching',
        correlationKey: 'test-agent-staging',
        requestFingerprint: 'test-agent-staging-request',
        effectFingerprint: 'test-agent-staging-effect',
        intent: 'Fixture agent-owned STAGING test',
        createdAt: '2026-09-16T00:01:00.000Z',
        dispatchBound: true,
        cycleId: cycle.id,
        candidateDigest: cycle.candidateDigest,
        candidateStamp: 'fixture-stamp',
        expectedMet: true,
      });
    });
    await recordOperation(f.store, {
      workItemId: f.workItemId,
      operationId: 'deploy-agent-staging',
      status: 'succeeded',
      handle: 'run-agent-staging',
      target: 'staging-target',
      requestFingerprint: 'deploy-agent-staging-request',
      evidenceRef: 'fixture:agent-staging-deployment',
    });
    const preparedState = await f.store.load(f.workItemId);
    const preparedCycle = currentCycle(preparedState.records,
      preparedState.checkpoint);
    assert.equal(preparedCycle.deployments.STAGING, undefined);
    const unverifiedDeployment = preparedState.records.find(record =>
      record.id === 'deploy-agent-staging');
    assert.equal(unverifiedDeployment.status, 'uncertain');
    assert.equal(unverifiedDeployment.resultProof, undefined);
    assert.equal(unverifiedDeployment.resultGap, 'current-result-observation-required');
    assert.equal(unverifiedDeployment.artifactId, 'artifact-agent-staging');
    await assert.rejects(stagingHandoff(f.store, f.workItemId), { code: 'EVIDENCE' });
    await assert.rejects(grant(f, 'staging-result', {
      cycleId: cycle.id,
      candidateDigest: cycle.candidateDigest,
      testSpecDigest: cycle.testSpecDigest,
      configDigest: cycle.configDigest,
      target: 'staging-target',
      deploymentId: 'deploy-agent-staging',
      artifactId: 'artifact-agent-staging',
      testIds: ['T-staging'],
      outcome: 'Failed',
      owner: 'agent',
      host: 'staging-runner',
      evidenceRef: 'fixture:older-agent-failure',
    }), { code: 'EVIDENCE' });
    await recordOperation(f.store, {
      workItemId: f.workItemId, operationId: 'test-agent-staging',
      status: 'succeeded', target: 'staging-target',
      requestFingerprint: 'test-agent-staging-request',
      evidenceRef: 'fixture:agent-staging-operation', expectedMet: true,
    });
    const legacyState = await f.store.load(f.workItemId);
    const legacyCycle = currentCycle(legacyState.records, legacyState.checkpoint);
    assert.equal(legacyState.records.find(record => record.id === 'test-agent-staging').status,
      'uncertain');
    assert.notEqual(currentTestEvidence(legacyCycle, legacyState.records,
      legacyCycle.tests.find(item => item.id === 'T-staging'), f.clock)?.status, 'Passed');
    assert.equal(hasStagingCompletion(legacyState.records, legacyCycle, f.clock), false);

    await grant(f, 'override', {
      rules: ['staging-execution-contract'],
      reason: 'Use an authorized user fallback for this STAGING test',
      scope: {
        repositoryIds: ['primary'],
        actions: ['test', 'staging-result'],
        environment: 'STAGING',
        target: 'staging-target',
        owner: 'user',
        host: 'fallback-machine',
      },
      lifetime: { kind: 'cycle', cycleId: cycle.id },
    });
    await assert.rejects(stagingHandoff(f.store, f.workItemId), { code: 'EVIDENCE' });
    await assert.rejects(grant(f, 'staging-result', {
      cycleId: cycle.id,
      candidateDigest: cycle.candidateDigest,
      testSpecDigest: cycle.testSpecDigest,
      configDigest: cycle.configDigest,
      target: 'staging-target',
      deploymentId: 'deploy-agent-staging',
      artifactId: 'artifact-agent-staging',
      testIds: ['T-staging'],
      outcome: 'Passed',
      owner: 'user',
      host: 'fallback-machine',
      evidenceRef: 'fixture:fallback-user-result',
    }), { code: 'EVIDENCE' });
    await assert.rejects(recordTest(f.store, {
      workItemId: f.workItemId,
      cycleId: cycle.id,
      testId: 'T-staging',
      status: 'Passed',
      evidenceRef: 'fixture:fallback-user-result',
      artifactId: 'artifact-agent-staging',
      deploymentId: 'deploy-agent-staging',
      expectedMet: true,
      owner: 'user',
      host: 'fallback-machine',
    }), { code: 'EVIDENCE' });
  }
  const stagingTest = current.tests.find(test =>
    test.environment === 'STAGING');
  const actionFor = (owner, host) => ({
    class: 'test',
    repositoryId: 'primary',
    environment: 'STAGING',
    target: 'staging-target',
    configDigest: cycle.configDigest,
    testId: stagingTest.id,
    owner,
    host,
    deploymentId: 'deploy-policy',
    artifactId: 'artifact-policy',
  });
  for (const owner of ['agent', 'provider', 'external-system']) {
    const candidate = structuredClone(state);
    const candidateCycle = currentCycle(candidate.records,
      candidate.checkpoint);
    const test = candidateCycle.tests.find(item =>
      item.id === stagingTest.id);
    test.owner = owner;
    test.location = `${owner}-runner`;
    const configuration = {
      environments: {
        STAGING: {
          target: 'staging-target',
          configDigest: cycle.configDigest,
          allowedStages: ['STAGING'],
          execution: { owner, locations: [`${owner}-runner`] },
        },
      },
    };
    const decision = evaluatePolicy(candidate,
      actionFor(owner, `${owner}-runner`),
      { configuration, clock: f.clock });
    assert.ok(!decision.findings.some(finding =>
      ['staging-execution-policy', 'staging-execution-contract',
        'staging-user-handoff'].includes(finding.rule)), owner);
    const guidance = stagingExecutionGuidance({
      resolved: true,
      owner,
      locations: [`${owner}-runner`],
    });
    assert.equal(guidance.state, 'ready-for-authorized-execution');
    assert.match(guidance.instruction,
      new RegExp(`authorized ${owner} path`, 'u'));
  }
  const multiLocation = stagingExecutionGuidance({
    resolved: true,
    owner: 'provider',
    locations: ['runner-a', 'runner-b'],
  }, [
    { location: 'runner-a' },
    { location: 'runner-b' },
  ]);
  assert.equal(multiLocation.location, undefined);
  assert.match(multiLocation.instruction, /runner-a, runner-b/u);

  const userConfiguration = {
    environments: {
      STAGING: {
        target: 'staging-target',
        configDigest: cycle.configDigest,
        allowedStages: ['STAGING'],
        execution: {
          owner: 'user',
          locations: ['authorized-machine'],
        },
      },
    },
  };
  assert.ok(evaluatePolicy(state,
    actionFor('user', 'authorized-machine'),
    { configuration: userConfiguration, clock: f.clock }).findings
    .some(finding => finding.rule === 'staging-user-handoff'));
  assert.ok(evaluatePolicy(state,
    actionFor('agent', 'unauthorized-machine'),
    { configuration: userConfiguration, clock: f.clock }).findings
    .some(finding => finding.rule === 'staging-execution-contract'));
  assert.ok(evaluatePolicy(state, {
    ...actionFor('agent', 'agent-runner'),
    externalPermission: false,
  }, {
    configuration: {
      environments: {
        STAGING: {
          target: 'staging-target',
          configDigest: cycle.configDigest,
          allowedStages: ['STAGING'],
          execution: { owner: 'agent', locations: ['agent-runner'] },
        },
      },
    },
    clock: f.clock,
  }).findings.some(finding => finding.rule === 'external-permission'));
  assert.ok(evaluatePolicy(state,
    actionFor('agent', 'agent-runner'),
    { configuration: { environments: {
      STAGING: {
        target: 'staging-target',
        configDigest: cycle.configDigest,
        allowedStages: ['STAGING'],
      },
    } }, clock: f.clock }).findings
    .some(finding => finding.rule === 'staging-execution-policy'));

  const fallbackState = structuredClone(state);
  fallbackState.records.push({
    type: 'event',
    id: 'fallback-agent',
    kind: 'override',
    effect: {
      rules: ['staging-execution-contract'],
      reason: 'Use the authorized agent runner for this cycle',
      scope: {
        repositoryIds: ['primary'],
        actions: ['test'],
        itemId: 'staging-suite',
        paths: ['tests/staging-suite.mjs'],
        environment: 'STAGING',
        target: 'staging-target',
        owner: 'agent',
        host: 'agent-runner',
      },
      lifetime: { kind: 'cycle', cycleId: cycle.id },
    },
  });
  const fallback = evaluatePolicy(fallbackState,
    { ...actionFor('agent', 'agent-runner'), itemId: 'staging-suite',
      paths: ['tests/staging-suite.mjs'] },
    { configuration: userConfiguration, clock: f.clock });
  assert.ok(!fallback.findings.some(finding =>
    finding.rule === 'staging-execution-contract'));
  const wrongScope = structuredClone(fallbackState);
  wrongScope.records.at(-1).effect.scope.paths = ['tests/other.mjs'];
  assert.ok(evaluatePolicy(wrongScope,
    { ...actionFor('agent', 'agent-runner'), itemId: 'staging-suite',
      paths: ['tests/staging-suite.mjs'] },
    { configuration: userConfiguration, clock: f.clock }).findings
    .some(finding => finding.rule === 'staging-execution-contract'));

  await assert.rejects(grant(f, 'override', {
    rules: ['staging-execution-contract'],
    reason: 'Invalid fallback without a target',
    scope: {
      repositoryIds: ['primary'],
      actions: ['test'],
      environment: 'STAGING',
      owner: 'agent',
      host: 'agent-runner',
    },
    lifetime: { kind: 'cycle', cycleId: cycle.id },
  }), { code: 'INPUT' });
  const recordedFallback = await grant(f, 'override', {
    rules: ['staging-execution-contract'],
    reason: 'Use the authorized agent runner for this cycle',
    scope: {
      repositoryIds: ['primary'],
      actions: ['test'],
      environment: 'STAGING',
      target: 'staging-target',
      owner: 'agent',
      host: 'agent-runner',
    },
    lifetime: { kind: 'cycle', cycleId: cycle.id },
  });
  assert.equal(recordedFallback.event.effect.scope.owner, 'agent');

  const metadata = await f.store.metadata(f.workItemId);
  for (const execution of [
    { owner: 'invalid', locations: ['runner'] },
    { owner: 'agent', locations: [] },
  ]) {
    await writeJson(path.join(f.repo, '.sdlc/config.json'), {
      environments: {
        STAGING: {
          target: 'staging-target',
          configDigest: cycle.configDigest,
          execution,
        },
      },
    });
    await assert.rejects(loadConfig(metadata, 'primary'), error =>
      ['CONFIG', 'INPUT'].includes(error.code));
  }
});

test('T-50 host-contract admission is checked against a genuinely proven STAGING deployment', async t => {
  const f = await coding(await fixture(t, { compactPath: true }));
  const planPath = path.join(f.repo, 'docs/test-plan.md');
  const plan = await fs.readFile(planPath, 'utf8');
  await fs.writeFile(planPath, plan.split('\n').map(line =>
    line.startsWith('| T-staging |') ?
      line.replace('| user | authorized-machine |',
        '| agent | staging-runner |') : line).join('\n'));
  await writeJson(path.join(f.repo, '.sdlc/config.json'), {
    defaultBranch: 'refs/heads/main',
    environments: {
      DEV: { target: 'dev-target', configDigest: 'host-contract-v1',
        allowedStages: ['DEV'] },
      STAGING: { target: 'staging-target', configDigest: 'host-contract-v1',
        allowedStages: ['STAGING'],
        execution: { owner: 'agent', locations: ['staging-runner'] } },
    },
  });
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Disposable proven host-contract candidate');
  await observeFixtureRepository(f);
  const { cycle } = await startCycle(f.store, {
    workItemId: f.workItemId, configDigest: 'host-contract-v1',
    cause: 'host-contract evidence with a complete deployment chain',
  });
  for (const testId of ['T-unit', 'T-integration']) {
    await recordTest(f.store, {
      workItemId: f.workItemId, cycleId: cycle.id, testId,
      status: 'Passed', expectedMet: true, owner: 'agent', host: 'local',
      evidenceRef: `fixture:host-contract:${testId}`,
    });
  }
  await completeReview(f, cycle);
  const binding = { cycleId: cycle.id, candidateDigest: cycle.candidateDigest,
    testSpecDigest: cycle.testSpecDigest, configDigest: cycle.configDigest };
  await grant(f, 'dev-authorization', { ...binding,
    target: 'dev-target', completedStage: 'review' });
  const producer = await fixtureBuild(f, cycle);
  const devArtifact = await fixtureArtifact(f, cycle, producer, {
    artifactId: 'host-contract-dev', environment: 'DEV',
  });
  const devDeployment = await fixtureDeployment(f, cycle, devArtifact, {
    target: 'dev-target',
  });
  await recordTest(f.store, {
    workItemId: f.workItemId, cycleId: cycle.id, testId: 'T-dev',
    status: 'Passed', expectedMet: true, owner: 'agent',
    host: 'development-machine', evidenceRef: 'fixture:host-contract-dev',
    artifactId: devArtifact.artifactId, deploymentId: devDeployment.id,
  });
  await grant(f, 'stage-completion', { ...binding, completedStage: 'DEV',
    target: 'dev-target', deploymentId: devDeployment.id });
  await grant(f, 'staging-promotion', { ...binding, completedStage: 'DEV',
    target: 'staging-target', deploymentId: devDeployment.id });
  const stagingArtifact = await fixtureArtifact(f, cycle, producer, {
    artifactId: 'host-contract-staging', environment: 'STAGING',
  });
  const deployment = await fixtureDeployment(f, cycle, stagingArtifact, {
    target: 'staging-target',
  });
  const handoff = await stagingHandoff(f.store, f.workItemId);
  assert.equal(handoff.deploymentId, deployment.id);
  assert.equal(handoff.owner, 'agent');
  const input = {
    workItemId: f.workItemId, cycleId: cycle.id, testId: 'T-staging',
    status: 'Passed', expectedMet: true,
    artifactId: stagingArtifact.artifactId, deploymentId: deployment.id,
    evidenceRef: 'fixture:host-contract-test',
  };
  await assert.rejects(recordTest(f.store, { ...input,
    owner: 'agent', host: 'unauthorized-machine' }), { code: 'HOST' });
  await grant(f, 'override', {
    rules: ['staging-execution-contract'],
    reason: 'Use the authorized user fallback for the proven deployment',
    scope: { repositoryIds: ['primary'], actions: ['test', 'staging-result'],
      environment: 'STAGING', target: 'staging-target',
      owner: 'user', host: 'fallback-machine' },
    lifetime: { kind: 'cycle', cycleId: cycle.id },
  });
  await assert.rejects(recordTest(f.store, { ...input,
    owner: 'user', host: 'unauthorized-machine' }), { code: 'HOST' });
  const result = await grant(f, 'staging-result', { ...binding,
    target: 'staging-target', deploymentId: deployment.id,
    artifactId: stagingArtifact.artifactId, testIds: ['T-staging'],
    outcome: 'Passed', owner: 'user', host: 'fallback-machine',
    evidenceRef: 'fixture:proven-host-contract-fallback' });
  await recordTest(f.store, { ...input,
    owner: 'user', host: 'fallback-machine', eventId: result.event.id });
  const state = await f.store.load(f.workItemId);
  assert.equal(stagePassed(currentCycle(state.records, state.checkpoint),
    state.records, 'STAGING', f.clock), true);
});
