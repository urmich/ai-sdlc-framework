export const validationDeclarations = {
  "schemaVersion": 1,
  "surfaces": [
    {"coverage": "direct", "paths": ["src/evidence.mjs", "src/validation.mjs", "src/authority.mjs", "src/validation-evidence.mjs"]},
    {"coverage": "direct", "paths": ["src/install.mjs", "src/gate.mjs", "src/hooks.mjs"]}
  ],
  "plannedCases": [
    {"id": "T-PRD064", "selectors": [
      {"name": "T-PRD067 reverse-registered repository members admit only the exact source bijection", "parents": []},
      {"name": "T-PRD067 normalized DEV and STAGING admission binds artifact records, deployments and native execution proofs", "parents": []}
    ]},
    {"id": "T-PRD067", "selectors": [
      {"name": "T-PRD076 supported legacy adoption preserves original records and grants only new current normalized credit", "parents": []}
    ]},
    {"id": "T-PRD073", "selectors": [
      {"name": "T-PRD009 an installed independent consumer retains its own unit-first checkpoint and advisory contract", "parents": []}
    ]},
    {"id": "T-PRD068", "selectors": [
      {"name": "T-PRD073 explicit captured stage overrides fall through without readiness or publisher credit", "parents": []}
    ]}
  ]
};

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { canonical, digest, newId } from '../src/core.mjs';
import { registerArtifact, parseTestPlan, synchronizeTestPlan } from '../src/artifacts.mjs';
import { captureReceipt, prepareDecision, applyDecision } from '../src/decisions.mjs';
import { currentCycle, currentTestEvidence, stagePassed, hasStageCompletion } from '../src/authority.mjs';
import { startCycle } from '../src/validation.mjs';
import { prepareOperation, markDispatching } from '../src/operations.mjs';
import { evaluateGate, gate } from '../src/gate.mjs';
import { handleHook } from '../src/hooks.mjs';
import { install } from '../src/install.mjs';
import { Store } from '../src/store.mjs';
import { validateRecord } from '../src/schemas.mjs';
import { formatAudit, recordAudit } from '../src/audit.mjs';
import { fixture, artifact, grant, completeReview, observeFixtureRepository,
  fixtureBuild, fixtureArtifact, fixtureDeployment, registerFixtureProviderRequest,
  finishFixtureOperation } from './helpers.mjs';
import { normalizeExecutionReport, evaluateReadiness, validationInventoryDigest,
  recordReadiness, requireReadinessEvaluation, readTestEvidence,
  readValidationObject } from 'ai-sdlc-framework/evidence';

const execute = promisify(execFile);
const sourceRoot = path.resolve('.');
const unit = {
  id: 'T-ADOPTION-UNIT', environment: 'local', level: 'unit',
  checkpoint: 'pre-review', mode: 'automated', owner: 'agent', location: 'local',
  implementation: 'test/consumer-unit.mjs', expected: 'An invalid debit preserves the exact balance',
};
const integration = {
  ...unit, id: 'T-ADOPTION-INTEGRATION', level: 'integration',
  implementation: 'test/consumer-integration.mjs', expected: 'The debit reaches only the selected account',
};
const environmentDefinitions = [
  unit, integration,
  {...integration, id: 'T-ADOPTION-DEV', environment: 'DEV', checkpoint: 'DEV',
    location: 'development-machine'},
  {...integration, id: 'T-ADOPTION-STAGING', environment: 'STAGING', checkpoint: 'STAGING',
    location: 'authorized-machine'},
];
const requirements = '# Consumer requirements\n### FR-901: Preserve an account\n' +
  '**Definition of Done**\n- AC-901.1: A debit changes only the selected account by the accepted amount.\n';

function plan(definitions) {
  return '# Consumer Test Plan\n' +
    '| ID | Requirements | Conditions | Environment | Level | Checkpoint | Mode | Owner | Location | Expected outcome | Implementation | Status |\n' +
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n' +
    definitions.map(row => `| ${row.id} | FR-901 | AC-901.1 | ${row.environment} | ${row.level} | ${row.checkpoint} | ${row.mode} | ${row.owner} | ${row.location} | ${row.expected} | ${row.implementation} | NotRun |`).join('\n') + '\n';
}

async function approvePlan(f, definitions) {
  for (const [role, contents] of [
    ['requirements', requirements],
    ['test-plan', plan(definitions)],
    ['technical-design', '# Consumer design\nDebit only the selected account; retain original observations.\n'],
  ]) {
    const relative = await artifact(f, role, contents);
    await registerArtifact(f.store, { workItemId: f.workItemId,
      repositoryId: 'primary', role, path: relative });
  }
  const phases = ['requirements', 'test-design', 'technical-design', 'coding'];
  for (let index = 0; index < 3; index++) await grant(f, 'approval', {
    transition: { from: phases[index], to: phases[index + 1] },
  }, { prepared: true });
}

async function gitAt(repo, ...args) {
  return (await execute('git', args, { cwd: repo, timeout: 10000,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
      GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
      GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
      GIT_TERMINAL_PROMPT: '0' } })).stdout.trim();
}

async function managed(t, { definitions = [unit, integration], multiMember = false,
  configuration = { defaultBranch: 'refs/heads/main' }, compactPath = false } = {}) {
  const f = await fixture(t, { compactPath });
  await fs.writeFile(path.join(f.repo, 'account.mjs'), 'export const balance = 100;\n');
  await fs.writeFile(path.join(f.repo, '.sdlc', 'config.json'), JSON.stringify(configuration) + '\n');
  if (multiMember) {
    const other = path.join(f.root, 'alpha member');
    await fs.mkdir(other);
    await gitAt(other, 'init', '-q', '-b', 'feature/alpha');
    await fs.writeFile(path.join(other, 'account.mjs'), 'export const balance = 200;\n');
    await gitAt(other, 'add', '.');
    await gitAt(other, 'commit', '-qm', 'Independent alpha source');
    await f.store.bindMember({ workItemId: f.workItemId, repositoryId: 'alpha',
      cwd: other, sessionId: f.sessionId });
    const metadata = await f.store.metadata(f.workItemId);
    assert.deepEqual(metadata.members.map(member => member.repositoryId), ['primary', 'alpha']);
    await f.store.bindSession(f.sessionId, f.workItemId,
      metadata.members.find(member => member.repositoryId === 'primary'));
  }
  await approvePlan(f, definitions);
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Owned normalized-adoption candidate');
  const { cycle } = await startCycle(f.store, { workItemId: f.workItemId,
    configDigest: digest(configuration), cause: 'Focused normalized-adoption regression' });
  return { f, cycle, definitions };
}

function producerReports(input, { definitions = input.definitions, sequence = 1,
  outcomes = {}, operation, artifact: testedArtifact, observedAt, startedAt,
  mutateContext = () => {}, maxAgeMs = 60000, api, observations, reportedIds } = {}) {
  const evidence = api ?? { normalizeExecutionReport, evaluateReadiness, validationInventoryDigest };
  const specification = {
    schemaVersion: 1, profile: 'consumer-account-checkpoint',
    cases: definitions.map(row => ({
      id: row.id, conditions: ['AC-901.1'], expectedDigest: digest(row.expected),
      executionId: `execution-${row.id}`, mode: row.mode, owner: row.owner,
      location: row.location, checkpoint: row.checkpoint,
      assertions: [{ id: 'account-boundary', selector: { file: row.implementation, name: row.expected } }],
    })),
  };
  const baseline = input.f.clock.now();
  const facts = new Map();
  const contexts = definitions.map(row => {
    const context = {
      candidateDigest: input.cycle.candidateDigest, testSpecDigest: input.cycle.testSpecDigest,
      configDigest: input.cycle.configDigest,
      inventoryDigest: evidence.validationInventoryDigest(specification),
      sources: structuredClone(input.cycle.sources), profile: specification.profile,
      environment: row.environment, location: row.location, mode: row.mode, owner: row.owner,
      native: { kind: 'fixture', platform: process.platform, architecture: process.arch,
        image: 'owned-account-host', toolchain: { node: process.version } },
      producer: operation ? structuredClone(operation.resultProof.executionIdentity) : {
        provider: 'fixture', connection: 'owned-local-host', scopeRef: 'consumer-account',
        definitionRef: row.implementation,
        executionRef: observations?.get(row.id)?.executionRef ?? `execution-${row.id}`,
        attemptKind: 'known', attemptRef: '1',
      },
      attemptCapability: operation?.resultProof.attemptCapability ?? 'distinct',
      jobRef: `account-job-${row.id}`,
      artifacts: testedArtifact ?
        [{ name: testedArtifact.name, sha256: testedArtifact.artifactSha256 }] : [],
    };
    mutateContext(context, row);
    return context;
  });
  const raw = definitions.map((row, index) => {
    const observation = observations?.get(row.id);
    const status = observation?.status ?? outcomes[row.id] ?? 'Passed';
    const time = observation?.observedAt ?? observedAt ??
      new Date(baseline + 100 + index * 100).toISOString();
    return {
      schemaVersion: 1, kind: 'test-execution', context: contexts[index],
      startedAt: observation?.startedAt ?? startedAt ?? new Date(Date.parse(time) - 50).toISOString(),
      finishedAt: time, observedAt: time, sequence, complete: true,
      exitCode: observation?.exitCode ?? (status === 'Failed' ? 1 : 0),
      results: [{
        testId: row.id, assertionId: 'account-boundary',
        selector: specification.cases[index].assertions[0].selector,
        expectedDigest: digest(row.expected), checkpoint: row.checkpoint,
        status, expectedMet: status === 'Passed' ? true : status === 'Failed' ? false : null,
        observedAt: time, sourceSequence: sequence,
        durationMs: ['Passed', 'Failed'].includes(status) ? observation?.durationMs ?? 50 : null,
        exitCode: observation?.exitCode ?? (status === 'Failed' ? 1 : 0),
        ...(observation?.detail ? { detail: observation.detail } : {}),
      }],
    };
  }).filter(report => !reportedIds || reportedIds.includes(report.results[0].testId));
  for (const report of raw) facts.set(digest(Buffer.from(canonical(report))), {
    verifierId: 'owned-process-host-v1', reportDigest: digest(Buffer.from(canonical(report))),
    context: structuredClone(report.context), sourceTime: report.observedAt,
    sourceSequence: report.sequence,
  });
  const normalized = raw.map(report => evidence.normalizeExecutionReport(report, report.context,
    request => facts.get(request.reportDigest) ?? null));
  const selection = {
    profile: specification.profile,
    executions: contexts.map((context, index) => ({
      id: specification.cases[index].executionId, context,
    })),
    now: new Date(input.f.clock.now()).toISOString(),
    policy: { maxAgeMs, revisionPolicy: 'exact', verifierIds: ['owned-process-host-v1'] },
    barriers: [],
  };
  const evaluate = (reports = normalized, selected = {}) => evidence.evaluateReadiness(
    specification, reports, { ...selection, now: new Date(input.f.clock.now()).toISOString(), ...selected });
  return { specification, contexts, raw, normalized, evaluate, selection };
}

async function admit(input, reports, bindings = []) {
  return recordReadiness(input.f.store, { workItemId: input.f.workItemId,
    cycleId: input.cycle.id, evaluation: reports.evaluate(), bindings });
}

async function current(input, testDefinition = input.definitions[0], store = input.f.store) {
  const state = await store.load(input.f.workItemId);
  const cycle = currentCycle(state.records, state.checkpoint);
  return { state, cycle, evidence: currentTestEvidence(cycle, state.records,
    testDefinition, input.f.clock), passed: stagePassed(cycle, state.records,
    testDefinition.environment, input.f.clock) };
}

async function recordBytes(f, ids) {
  return new Map(await Promise.all(ids.map(async id =>
    [id, await fs.readFile(f.store.recordPath(f.workItemId, id))])));
}

async function assertRecordBytes(f, originals) {
  for (const [id, bytes] of originals) {
    assert.deepEqual(await fs.readFile(f.store.recordPath(f.workItemId, id)), bytes,
      `Adoption must not rewrite ${id}`);
  }
}

test('T-PRD064 canonical external-system ownership survives plan, report and managed admission', async t => {
  const definition = { ...unit, owner: 'external-system', location: 'account-check-service' };
  const input = await managed(t, { definitions: [definition] });
  const reports = producerReports(input);
  input.f.clock.advance(1000);
  const original = canonical(reports.raw);
  assert.equal(parseTestPlan(await fs.readFile(path.join(input.f.repo, 'docs', 'test-plan.md'),
    'utf8'))[0].owner, 'external-system');
  assert.equal(reports.normalized[0].context.owner, 'external-system');
  const admitted = await admit(input, reports);
  assert.deepEqual(admitted.blocked, []);
  assert.equal(admitted.evidence[0].owner, 'external-system');
  assert.equal((await current(input)).evidence.id, admitted.evidence[0].id);
  assert.equal((await current(input)).passed, true);
  const retained = await readValidationObject(input.f.store, input.f.workItemId,
    admitted.evidence[0].retainedPayloadRef);
  assert.equal(retained.content.kind, 'normalized-case-admission');
  assert.equal(retained.content.testId, definition.id);
  assert.equal(retained.content.status, 'Passed');
  const originals = await recordBytes(input.f, admitted.evidence.map(row => row.id));
  const wrongOwner = producerReports(input, {
    definitions: [{ ...definition, owner: 'provider' }],
    observedAt: reports.raw[0].observedAt, startedAt: reports.raw[0].startedAt,
  });
  assert.equal(wrongOwner.evaluate().status, 'Passed');
  await assert.rejects(admit(input, wrongOwner), { code: 'EVIDENCE' });
  assert.equal((await current(input)).evidence.id, admitted.evidence[0].id);
  await assertRecordBytes(input.f, originals);
  assert.equal(canonical(reports.raw), original);
});

test('T-PRD067 reverse-registered repository members admit only the exact source bijection', async t => {
  const input = await managed(t, { definitions: [unit], multiMember: true });
  const reports = producerReports(input);
  input.f.clock.advance(1000);
  assert.deepEqual(input.cycle.sources.map(source => source.repositoryId), ['primary', 'alpha']);
  assert.deepEqual(reports.normalized[0].context.sources.map(source => source.repositoryId),
    ['alpha', 'primary']);
  assert.notEqual(input.cycle.sources[0].contentDigest, input.cycle.sources[1].contentDigest);
  const originalReports = canonical(reports.normalized);
  const admitted = await admit(input, reports);
  assert.equal(admitted.evidence[0].status, 'Passed');
  assert.equal((await current(input)).passed, true);
  const originals = await recordBytes(input.f, admitted.evidence.map(row => row.id));
  for (const mutateContext of [
    context => { [context.sources[0].contentDigest, context.sources[1].contentDigest] =
      [context.sources[1].contentDigest, context.sources[0].contentDigest]; },
    context => { context.sources[0].repositoryId = 'foreign'; },
    context => { context.sources[0].revision = digest('another commit').slice(0, 40); },
    context => { context.sources[0].contentDigest = digest('different source bytes'); },
  ]) {
    const wrong = producerReports(input, { mutateContext,
      observedAt: reports.raw[0].observedAt, startedAt: reports.raw[0].startedAt });
    assert.equal(wrong.evaluate().status, 'Passed');
    await assert.rejects(admit(input, wrong), { code: 'EVIDENCE' });
    assert.equal((await current(input)).evidence.id, admitted.evidence[0].id);
    await assertRecordBytes(input.f, originals);
  }
  assert.equal(canonical(reports.normalized), originalReports);
});

async function environmentFixture(t) {
  const configuration = {
    defaultBranch: 'refs/heads/main',
    environments: {
      DEV: { target: 'd', allowedStages: ['DEV'] },
      STAGING: { target: 's', allowedStages: ['STAGING'],
        execution: { owner: 'agent', locations: ['authorized-machine'] } },
    },
  };
  const configDigest = digest('owned account environment configuration');
  for (const environment of Object.values(configuration.environments)) environment.configDigest = configDigest;
  const input = await managed(t, {
    definitions: environmentDefinitions, configuration, compactPath: true,
  });
  // The configured environment identity is independent of the config file's content digest.
  const selected = await startCycle(input.f.store, { workItemId: input.f.workItemId,
    configDigest, cause: 'Select configured environment contract' });
  input.cycle = selected.cycle;
  await observeFixtureRepository(input.f, { connection: 'c', repositoryRef: 'r' });
  const local = producerReports(input, { definitions: [unit, integration], maxAgeMs: 3600000 });
  input.f.clock.advance(1000);
  await admit(input, local);
  assert.equal((await current(input, unit)).passed, true);
  await completeReview(input.f, input.cycle);
  const binding = {
    cycleId: input.cycle.id, candidateDigest: input.cycle.candidateDigest,
    testSpecDigest: input.cycle.testSpecDigest, configDigest: input.cycle.configDigest,
  };
  const devAuthority = await grant(input.f, 'dev-authorization', {
    ...binding, target: 'd', completedStage: 'review',
  });
  const build = await fixtureBuild(input.f, input.cycle, { target: 'd', pipeline: 'b' });
  const devArtifact = await fixtureArtifact(input.f, input.cycle, build, { artifactId: 'a-d' });
  const devDeployment = await fixtureDeployment(input.f, input.cycle, devArtifact, { target: 'd' });
  return { ...input, binding, devAuthority, devArtifact, devDeployment };
}

async function executedTest(input, definition, deployment, testedArtifact,
  { status = 'succeeded', correlationKey = `test-${definition.id}`, sourceTime } = {}) {
  const action = {
    class: 'test', repositoryId: 'primary', environment: definition.environment,
    testId: definition.id, owner: definition.owner, host: definition.location,
    target: deployment.target, configDigest: input.cycle.configDigest,
    sourceRevision: input.cycle.sources.find(source => source.repositoryId === 'primary').revision,
    artifactId: testedArtifact.artifactId, deploymentId: deployment.id,
  };
  const { operation } = await prepareOperation(input.f.store, {
    workItemId: input.f.workItemId, sessionId: input.f.sessionId, action,
    request: { toolName: 'owned_account_test', toolArgs: { testId: definition.id, correlationKey },
      cwd: input.f.repo }, correlationKey,
    intent: `Observe the owned ${definition.environment} account fixture`,
  });
  registerFixtureProviderRequest(input.f, operation);
  await markDispatching(input.f.store, input.f.workItemId, operation.id);
  const startedAt = new Date(sourceTime ?? input.f.clock.now()).toISOString();
  input.f.clock.advance(100);
  const observedAt = new Date((sourceTime ?? input.f.clock.now() - 100) + 50).toISOString();
  const terminal = await finishFixtureOperation(input.f, operation, {
    alreadyDispatched: true, status, expectedMet: status === 'succeeded',
  });
  assert.equal(terminal.status, status);
  assert.equal(terminal.resultProof.dispatchId, terminal.id);
  assert.equal(terminal.resultProof.intendedOutcomeDigest, terminal.intendedOutcome.digest);
  assert.deepEqual(terminal.resultProof.executionIdentity,
    input.f.providerExecutions.get(operation.id).identity);
  return { operation: terminal, startedAt, observedAt };
}

function boundReports(input, definition, execution, testedArtifact, options = {}) {
  return producerReports(input, {
    definitions: [definition], operation: execution.operation, artifact: testedArtifact,
    observedAt: execution.observedAt, startedAt: execution.startedAt, ...options,
  });
}

function bindingFor(definition, execution, testedArtifact, deployment) {
  return { testId: definition.id, operationId: execution.operation.id,
    artifactId: testedArtifact.artifactId, deploymentId: deployment.id };
}

async function stagingDeployment(input) {
  const promotion = await grant(input.f, 'staging-promotion', {
    ...input.binding, target: 's', completedStage: 'DEV',
    deploymentId: input.devDeployment.id,
  });
  const build = await fixtureBuild(input.f, input.cycle, {
    environment: 'STAGING', target: 's', pipeline: 'b',
  });
  const artifact = await fixtureArtifact(input.f, input.cycle, build, {
    environment: 'STAGING', artifactId: 'a-s',
  });
  const deployment = await fixtureDeployment(input.f, input.cycle, artifact, {
    target: 's',
  });
  return { promotion, artifact, deployment };
}

test('T-PRD067 normalized DEV and STAGING admission binds artifact records, deployments and native execution proofs', async t => {
  const input = await environmentFixture(t);
  const devDefinition = environmentDefinitions[2];
  const stagingDefinition = environmentDefinitions[3];
  const devExecution = await executedTest(input, devDefinition, input.devDeployment, input.devArtifact);
  const devReports = boundReports(input, devDefinition, devExecution, input.devArtifact);
  const devBinding = bindingFor(devDefinition, devExecution, input.devArtifact, input.devDeployment);
  const dev = await admit(input, devReports, [devBinding]);
  assert.equal(dev.evidence[0].status, 'Passed');
  assert.equal((await current(input, devDefinition)).passed, true);
  const { promotion, artifact: stagingArtifact, deployment: deploymentSTAGING } =
    await stagingDeployment(input);
  const stagingExecution = await executedTest(input, stagingDefinition, deploymentSTAGING, stagingArtifact);
  const stagingReports = boundReports(input, stagingDefinition, stagingExecution, stagingArtifact);
  const stagingBinding = bindingFor(stagingDefinition, stagingExecution, stagingArtifact, deploymentSTAGING);
  const staging = await admit(input, stagingReports, [stagingBinding]);
  const state = await input.f.store.load(input.f.workItemId);
  const cycle = currentCycle(state.records, state.checkpoint);
  for (const [environment, definition, execution, testedArtifact, deployment, reports, binding, admitted] of [
    ['DEV', devDefinition, devExecution, input.devArtifact, input.devDeployment, devReports, devBinding, dev],
    ['STAGING', stagingDefinition, stagingExecution, stagingArtifact, deploymentSTAGING, stagingReports, stagingBinding, staging],
  ]) {
    assert.equal(cycle.artifacts[environment], testedArtifact.id);
    assert.notEqual(testedArtifact.id, testedArtifact.artifactId);
    assert.notEqual(testedArtifact.id, testedArtifact.artifactRef);
    assert.equal(cycle.deployments[environment], deployment.id);
    assert.equal(admitted.evidence[0].operationId, execution.operation.id);
    assert.equal(admitted.evidence[0].cycleId, cycle.id);
    assert.equal(admitted.evidence[0].candidateDigest, cycle.candidateDigest);
    assert.equal(admitted.evidence[0].testSpecDigest, cycle.testSpecDigest);
    assert.equal(admitted.evidence[0].configDigest, cycle.configDigest);
    assert.equal(admitted.evidence[0].deploymentId, deployment.id);
    assert.equal(admitted.evidence[0].artifactId, testedArtifact.artifactId);
    assert.equal(stagePassed(cycle, state.records, environment, input.f.clock), true);
    const originals = await recordBytes(input.f, [execution.operation.id, testedArtifact.id,
      deployment.id, admitted.evidence[0].id]);
    await assert.rejects(admit(input, reports, [{ ...binding, artifactId: testedArtifact.id }]),
      { code: 'OPERATION' });
    await assert.rejects(admit(input, reports, [{ ...binding, deploymentId: 'op-unrelated-deployment' }]),
      { code: 'OPERATION' });
    for (const mutateContext of [
      context => { context.artifacts[0].sha256 = digest('different tested archive'); },
      context => { context.sources[0].contentDigest = digest('another tested source'); },
      context => { context.testSpecDigest = digest('another planned assertion contract'); },
      context => { context.configDigest = digest('another environment configuration'); },
    ]) {
      const wrong = boundReports(input, definition, execution, testedArtifact, { mutateContext });
      assert.equal(wrong.evaluate().status, 'Passed');
      await assert.rejects(admit(input, wrong, [binding]), { code: 'EVIDENCE' });
    }
    const wrongExecution = boundReports(input, definition, execution, testedArtifact, {
      mutateContext: context => { context.producer.executionRef = 'unrelated-physical-execution'; },
    });
    assert.equal(wrongExecution.evaluate().status, 'Passed');
    await assert.rejects(admit(input, wrongExecution, [binding]), { code: 'PROVENANCE' });
    const wrongNative = boundReports(input, definition, execution, testedArtifact, {
      mutateContext: context => { context.native.image = 'another native runner image'; },
    });
    assert.equal(wrongNative.evaluate(wrongNative.normalized, {
      executions: reports.selection.executions,
    }).status, 'NotRun');
    assert.equal((await current(input, definition)).evidence.id, admitted.evidence[0].id);
    await assertRecordBytes(input.f, originals);
  }
  assert.equal(input.devAuthority.event.kind, 'dev-authorization');
  assert.equal(promotion.event.kind, 'staging-promotion');
  assert.equal(hasStageCompletion(state.records, cycle, 'STAGING', input.f.clock), false);
  assert.ok(!state.records.some(row => row.type === 'event' &&
    ['permission', 'pr-publication', 'work-completion'].includes(row.kind)));
});

async function assertOperationSourceClock(t, environment) {
  const input = await environmentFixture(t);
  let definition = environmentDefinitions[2];
  let testedArtifact = input.devArtifact;
  let deployment = input.devDeployment;
  if (environment === 'STAGING') {
    const devExecution = await executedTest(input, definition, deployment, testedArtifact);
    await admit(input, boundReports(input, definition, devExecution, testedArtifact,
      { maxAgeMs: 3600000 }), [bindingFor(definition, devExecution, testedArtifact, deployment)]);
    const staging = await stagingDeployment(input);
    definition = environmentDefinitions[3];
    testedArtifact = staging.artifact;
    deployment = staging.deployment;
  }
  const sourceTime = input.f.clock.now();
  const initial = await executedTest(input, definition, deployment, testedArtifact,
    { correlationKey: 'initial-source-pass', sourceTime });
  const initialReports = boundReports(input, definition, initial, testedArtifact, { sequence: 1 });
  const initialAdmission = await admit(input, initialReports, [
    bindingFor(definition, initial, testedArtifact, deployment),
  ]);
  const imported = initialAdmission.evidence[0];
  const companions = (await input.f.store.records(input.f.workItemId)).filter(row =>
    row.type === 'test-evidence' && row.operationId === initial.operation.id && row.id !== imported.id);
  assert.ok(companions.some(row => row.status === 'Passed' && row.sourceObservedAt === undefined),
    'recordOperation must have created the actual unnormalized terminal companion');
  assert.equal(imported.sourceObservedAt, initial.observedAt);
  assert.equal(imported.sourceSequence, 1);
  assert.equal(imported.operationDigest, digest(initial.operation));
  assert.deepEqual(imported.executionSources, initialReports.normalized[0].context.sources);
  assert.equal((await current(input, definition)).evidence.id, imported.id);
  const future = boundReports(input, definition, initial, testedArtifact, {
    sequence: 2, observedAt: new Date(input.f.clock.now() + 1000).toISOString(),
  });
  assert.equal(future.evaluate().status, 'NotRun');
  await assert.rejects(admit(input, future, [
    bindingFor(definition, initial, testedArtifact, deployment),
  ]), { code: 'OPERATION' });
  assert.equal((await current(input, definition)).evidence.id, imported.id);
  const originals = await recordBytes(input.f, [initial.operation.id, imported.id,
    ...companions.map(row => row.id)]);
  input.f.clock.value = Date.parse(initial.observedAt) - 1;
  assert.equal((await current(input, definition)).evidence, null,
    'A future source observation must not fall back to the operation companion');
  input.f.clock.value = Date.parse(imported.sourceExpiresAt) + 1;
  const reopened = await new Store(input.f.home, { clock: input.f.clock }).ready();
  assert.equal((await current(input, definition, reopened)).evidence, null,
    'An expired normalized import must not resurrect its auto-generated companion');
  assert.equal((await current(input, definition, reopened)).passed, false);
  await assertRecordBytes(input.f, originals);
  await synchronizeTestPlan(input.f.store, input.f.workItemId);

  const lateOld = await executedTest(input, definition, deployment, testedArtifact, {
    correlationKey: 'delayed-old-source-pass',
  });
  const lateReports = boundReports(input, definition, lateOld, testedArtifact, { sequence: 2 });
  const lateOriginal = canonical(lateReports.normalized);
  const lateOperationBytes = await recordBytes(input.f, [lateOld.operation.id]);
  const failure = await executedTest(input, definition, deployment, testedArtifact,
    { status: 'failed', correlationKey: 'newer-source-failure' });
  const failedReports = boundReports(input, definition, failure, testedArtifact,
    { sequence: 3, outcomes: { [definition.id]: 'Failed' } });
  const failed = await admit(input, failedReports, [
    bindingFor(definition, failure, testedArtifact, deployment),
  ]);
  assert.equal((await current(input, definition)).evidence.id, failed.evidence[0].id);
  const failureBytes = await recordBytes(input.f, [failure.operation.id, failed.evidence[0].id]);
  const failedOriginal = canonical(failedReports.normalized);
  assert.ok(Date.parse(lateOld.operation.updatedAt) < Date.parse(failure.operation.updatedAt));
  assert.ok(Date.parse(lateOld.observedAt) < Date.parse(failure.observedAt));
  assert.equal(lateReports.evaluate().status, 'Passed',
    'The delayed old report is still fresh detached evidence, not an expiry-only rejection');
  await assert.rejects(admit(input, lateReports, [
    bindingFor(definition, lateOld, testedArtifact, deployment),
  ]), { code: 'OPERATION' });
  assert.equal(lateReports.normalized[0].observations[0].sourceSequence, 2);
  assert.equal((await current(input, definition)).evidence.id, failed.evidence[0].id);
  assert.equal((await current(input, definition)).evidence.status, 'Failed');
  assert.equal((await current(input, definition)).passed, false);
  assert.equal(failed.evidence[0].sourceSequence, 3);
  assert.equal(canonical(lateReports.normalized), lateOriginal);
  assert.equal(canonical(failedReports.normalized), failedOriginal);
  await assertRecordBytes(input.f, lateOperationBytes);
  await assertRecordBytes(input.f, failureBytes);
  await assertRecordBytes(input.f, originals);
}

test('T-PRD067 operation companions cannot freshen normalized source clocks, expiry or a later failure', async t => {
  await assertOperationSourceClock(t, 'DEV');
});

test('T-PRD067 STAGING companions cannot outlive imported expiry or mask a later source failure', async t => {
  await assertOperationSourceClock(t, 'STAGING');
});

test('T-PRD076 supported legacy adoption preserves original records and grants only new current normalized credit', async t => {
  const legacyDefinition = {
    id: 'T-LEGACY-STAGING', environment: 'STAGING', level: 'integration',
    checkpoint: 'STAGING', mode: 'automated', owner: 'user', location: 'authorized-machine',
    implementation: 'test/legacy-staging.mjs', expected: 'The original deployment preserves the account',
  };
  const legacyUnit = { ...unit, id: 'T-LEGACY-UNIT' };
  const input = await managed(t, { definitions: [legacyUnit, legacyDefinition] });
  const event = await grant(input.f, 'scope-inclusion', { itemId: 'legacy-account-history' });
  const audit = await formatAudit(input.f.store, input.f.workItemId, [event.event.id]);
  const sourceCommit = await input.f.runGit('rev-parse', 'HEAD');
  await input.f.runGit('add', '.sdlc');
  await input.f.runGit('commit', '--allow-empty', '-qm',
    `Preserve supported legacy decision\n\n${audit.trailers}`);
  const commit = await input.f.runGit('rev-parse', 'HEAD');
  assert.notEqual(commit, sourceCommit);
  assert.equal(await input.f.runGit('rev-parse', `${commit}^{tree}`),
    await input.f.runGit('rev-parse', `${sourceCommit}^{tree}`));
  assert.deepEqual((await recordAudit(input.f.store, {
    workItemId: input.f.workItemId, repositoryId: 'primary', commit,
  })).verified, [event.event.id]);
  const originalCycle = (await input.f.store.records(input.f.workItemId)).find(row =>
    row.id === input.cycle.id);
  const legacyArtifactId = newId('artifact');
  const legacyDeploymentId = newId('op');
  const legacyEvidenceId = newId('evidence');
  const legacyArtifactName = 'account-package-before-normalized-transport';
  const legacy = [
    { ...originalCycle,
      tests: originalCycle.tests.map(row => row.id === legacyDefinition.id ? {
        id: legacyDefinition.id, environment: legacyDefinition.environment,
        owner: legacyDefinition.owner, location: legacyDefinition.location,
        implementation: legacyDefinition.implementation,
      } : row),
      results: { [legacyDefinition.id]: legacyEvidenceId },
      artifacts: { STAGING: legacyArtifactId }, deployments: { STAGING: legacyDeploymentId } },
    {
      type: 'artifact', id: legacyArtifactId, workItemId: input.f.workItemId,
      sequence: 1, cycleId: originalCycle.id, artifactId: legacyArtifactName,
      environment: 'STAGING', sourceDigest: originalCycle.candidateDigest,
      configDigest: originalCycle.configDigest, buildRunId: 'legacy-account-build',
      name: 'account package', artifactType: 'archive', evidenceRef: 'fixture:legacy-account-artifact',
      status: 'succeeded',
    },
    {
      type: 'operation', id: legacyDeploymentId, workItemId: input.f.workItemId,
      repositoryId: 'primary', class: 'deploy', target: 'legacy-account-target',
      action: { class: 'deploy', environment: 'STAGING', target: 'legacy-account-target',
        artifactId: legacyArtifactName, configDigest: originalCycle.configDigest },
      status: 'succeeded', dispatchBound: true, correlationKey: 'legacy-account-deployment',
      requestFingerprint: digest(['legacy-account-deployment', originalCycle.sources]),
      cycleId: originalCycle.id, candidateDigest: originalCycle.candidateDigest,
      artifactId: legacyArtifactName, evidenceRef: 'fixture:legacy-account-deployment',
    },
    {
      type: 'test-evidence', id: legacyEvidenceId, workItemId: input.f.workItemId,
      cycleId: originalCycle.id, testId: legacyDefinition.id,
      candidateDigest: originalCycle.candidateDigest, testSpecDigest: originalCycle.testSpecDigest,
      environment: 'STAGING', implementation: legacyDefinition.implementation,
      status: 'Passed', observedAt: new Date(input.f.clock.now()).toISOString(),
      activity: 'complete', evidenceRef: 'fixture:legacy-account-observation',
      artifactId: legacyArtifactName, deploymentId: legacyDeploymentId,
      owner: legacyDefinition.owner, host: legacyDefinition.location,
    },
  ];
  // Supported schema1 fixtures intentionally lack modern producer/normalized proof, as older stores do.
  await input.f.store.transaction(input.f.workItemId, tx => {
    for (const row of legacy) { assert.equal(validateRecord(row), row); tx.put(row); }
  });
  const history = await input.f.store.records(input.f.workItemId);
  const originals = await recordBytes(input.f, history.filter(row => row.type !== 'cycle')
    .map(row => row.id));
  const snapshots = new Map(await Promise.all(history.filter(row => row.type === 'event')
    .flatMap(row => row.snapshots).map(async snapshot => {
      const file = path.join(input.f.store.workPath(input.f.workItemId), 'snapshots', snapshot.digest);
      return [file, await fs.readFile(file)];
    })));
  const reopened = await new Store(input.f.home, { clock: input.f.clock }).ready();
  input.f.clock.advance(1);
  await captureReceipt(reopened, { sessionId: input.f.sessionId, source: 'userPromptSubmitted',
    input: 'Adopt the supported older account records without changing their original history or granting new validation credit.' });
  const adopted = await reopened.init({ workItemId: input.f.workItemId, repositoryId: 'primary',
    cwd: input.f.repo, sessionId: input.f.sessionId, adopt: true, historyStartsAt: commit });
  assert.equal(adopted.adopted, true);
  const restored = await reopened.load(input.f.workItemId);
  assert.equal(restored.checkpoint.phase, 'coding');
  assert.equal(currentTestEvidence(currentCycle(restored.records, restored.checkpoint),
    restored.records, legacyDefinition, input.f.clock), null);
  assert.equal(stagePassed(currentCycle(restored.records, restored.checkpoint),
    restored.records, 'STAGING', input.f.clock), false);
  assert.equal(restored.records.find(row => row.id === legacyEvidenceId).status, 'Passed');
  await assertRecordBytes(input.f, originals);

  input.f.store = reopened;
  await artifact(input.f, 'test-plan', plan([unit, integration]));
  const currentSelection = await startCycle(reopened, { workItemId: input.f.workItemId,
    configDigest: originalCycle.configDigest, cause: 'Adopt normalized transport for current account cases' });
  assert.equal(currentSelection.reset, true);
  assert.notEqual(currentSelection.cycle.id, originalCycle.id);
  input.cycle = currentSelection.cycle;
  input.definitions = [unit, integration];
  const reports = producerReports(input);
  input.f.clock.advance(1000);
  const normalized = await admit(input, reports);
  assert.deepEqual(normalized.evidence.map(row => row.testId), [unit.id, integration.id]);
  assert.equal((await current(input)).passed, true);
  const retainedHistory = await readTestEvidence(reopened, {
    workItemId: input.f.workItemId, cycleId: originalCycle.id, testId: legacyDefinition.id,
  });
  assert.equal(retainedHistory.historicalOnly, true);
  assert.equal(retainedHistory.status, 'NotRun');
  assert.equal(retainedHistory.observations.find(row => row.id === legacyEvidenceId).status, 'Passed');
  assert.ok(!normalized.evidence.some(row => row.testId === legacyDefinition.id));
  assert.equal((await current(input)).cycle.testSpecDigest, input.cycle.testSpecDigest);
  const oldCycle = (await reopened.records(input.f.workItemId)).find(row => row.id === originalCycle.id);
  assert.equal(oldCycle.testSpecDigest, originalCycle.testSpecDigest);
  assert.equal(oldCycle.candidateDigest, originalCycle.candidateDigest);
  assert.deepEqual(oldCycle.tests, legacy[0].tests);
  await assertRecordBytes(input.f, originals);
  for (const [file, bytes] of snapshots) assert.deepEqual(await fs.readFile(file), bytes);
});

function consumerConfiguration(definition, attempts) {
  return {
    schemaVersion: 1, defaultBranch: 'refs/heads/main',
    toolAdapters: attempts.map(attempt => ({
      toolName: 'owned_consumer_checkpoint',
      match: { case: definition.id, attempt },
      action: { class: 'test', repositoryId: 'primary', environment: 'local',
        testId: definition.id, owner: definition.owner, host: definition.location },
    })),
  };
}

function configuredPublisher(candidateDigest, api = { requireReadinessEvaluation }) {
  const effects = [];
  return {
    effects,
    publish(evaluation, authority) {
      const selection = api.requireReadinessEvaluation(evaluation);
      assert.equal(evaluation.status, 'Passed', 'The independent publisher rejects non-passing readiness');
      assert.ok(selection.context.executions.every(row => row.context.candidateDigest === candidateDigest),
        'The independent publisher requires the selected candidate');
      assert.deepEqual(authority, { candidateDigest,
        profile: evaluation.profile, destination: 'owned-fixture-channel' },
      'Readiness does not supply publication authority');
      effects.push({ candidateDigest, profile: evaluation.profile });
    },
  };
}

async function rejectIncompleteCompletion(input, api = { prepareDecision, captureReceipt, applyDecision }) {
  const effect = {
    cycleId: input.cycle.id, candidateDigest: input.cycle.candidateDigest,
    testSpecDigest: input.cycle.testSpecDigest, configDigest: input.cycle.configDigest,
    completedStage: 'local',
  };
  const pending = await api.prepareDecision(input.f.store, {
    workItemId: input.f.workItemId, sessionId: input.f.sessionId, kind: 'stage-completion', effect,
  });
  const completionInput = 'I confirm local completion of this independent consumer checkpoint.';
  const receipt = await api.captureReceipt(input.f.store, {
    sessionId: input.f.sessionId, source: 'userPromptSubmitted', input: completionInput,
  });
  await assert.rejects(api.applyDecision(input.f.store, {
    workItemId: input.f.workItemId, sessionId: input.f.sessionId, kind: 'stage-completion',
    effect, decisionId: pending.id, receiptId: receipt.id, input: completionInput,
  }), { code: 'EVIDENCE' });
}

test('T-PRD073 explicit captured stage overrides fall through without readiness or publisher credit', async t => {
  const input = await managed(t, {
    configuration: consumerConfiguration(integration, ['missing', 'failed', 'skipped', 'stale']),
  });
  const publisher = configuredPublisher(input.cycle.candidateDigest);
  for (const attempt of ['missing', 'failed', 'skipped', 'stale']) {
    const reports = producerReports(input, {
      outcomes: attempt === 'failed' ? { [unit.id]: 'Failed' } :
        attempt === 'skipped' ? { [unit.id]: 'Skipped', [integration.id]: 'Skipped' } : {},
      reportedIds: attempt === 'missing' ? [] : input.definitions.map(row => row.id),
      ...(attempt === 'stale' ? {
        observedAt: new Date(input.f.clock.now() - 60001).toISOString(),
      } : {}),
    });
    input.f.clock.advance(1000);
    const evaluation = reports.evaluate();
    assert.equal(evaluation.status, attempt === 'failed' ? 'Failed' : 'NotRun');
    assert.equal(evaluation.counts.required, 2);
    assert.equal(reports.normalized.length, attempt === 'missing' ? 0 : 2);
    if (attempt === 'skipped') assert.ok(reports.normalized.every(report =>
      report.observations.every(row => row.rawStatus === 'Skipped')));
    if (attempt === 'stale') assert.ok(reports.normalized.every(report =>
      report.observations.every(row => row.status === 'Passed') &&
      input.f.clock.now() - Date.parse(report.observedAt) > reports.selection.policy.maxAgeMs));
    const admitted = await admit(input, reports);
    assert.notEqual((await current(input)).evidence?.status, 'Passed');
    assert.equal((await current(input)).passed, false);
    await rejectIncompleteCompletion(input);
    const originals = await recordBytes(input.f, admitted.evidence.map(row => row.id));
    const request = { cwd: input.f.repo, sessionId: input.f.sessionId,
      toolName: 'owned_consumer_checkpoint', toolArgs: { case: integration.id, attempt } };
    const strict = await evaluateGate(input.f.store, request);
    assert.equal(strict.permissionDecision, 'deny');
    assert.ok(strict.findings.some(row => row.rule === 'unit-first' && row.verdict === 'violation'));
    const overrideInput = `Skip unit-first and orientation for this ${attempt} local checkpoint attempt. ` +
      'Let the tool run uncredited; do not mark validation complete or authorize publication.';
    await handleHook(input.f.store, 'userPromptSubmitted', {
      sessionId: input.f.sessionId, cwd: input.f.repo,
      prompt: overrideInput,
    });
    const session = JSON.parse(await fs.readFile(input.f.store.sessionPath(input.f.sessionId), 'utf8'));
    const receipt = JSON.parse(await fs.readFile(path.join(input.f.store.runtime, 'sessions',
      input.f.sessionId, 'receipts', `${session.lastReceiptId}.json`), 'utf8'));
    assert.equal(receipt.inputDigest, digest(overrideInput));
    assert.equal(receipt.source, 'userPromptSubmitted');
    const fallthrough = await gate(input.f.store, request);
    assert.equal(fallthrough.permissionDecision, undefined);
    assert.equal(fallthrough.stageOverride, true);
    assert.equal(fallthrough.managedDispatchBound, false);
    await handleHook(input.f.store, 'postToolUse', {
      ...request, toolResult: { textResultForLlm: 'Owned local command finished without managed dispatch' },
    });
    const state = await input.f.store.load(input.f.workItemId);
    const cycle = currentCycle(state.records, state.checkpoint);
    assert.equal(stagePassed(cycle, state.records, 'local', input.f.clock), false);
    assert.equal(hasStageCompletion(state.records, cycle, 'local', input.f.clock), false);
    assert.ok(!state.records.some(row => row.type === 'operation'));
    assert.ok(!state.records.some(row => row.type === 'event' &&
      ['permission', 'pr-publication', 'stage-completion'].includes(row.kind)));
    assert.throws(() => publisher.publish(evaluation,
      { candidateDigest: input.cycle.candidateDigest, profile: evaluation.profile,
        destination: 'owned-fixture-channel' }), /rejects non-passing readiness/u);
    assert.deepEqual(publisher.effects, []);
    await assertRecordBytes(input.f, originals);
  }
  const complete = producerReports(input);
  input.f.clock.advance(1000);
  const evaluation = complete.evaluate();
  assert.equal(evaluation.status, 'Passed');
  assert.equal(evaluation.counts.passed, evaluation.counts.required);
  const stale = complete.evaluate(complete.normalized, {
    now: new Date(input.f.clock.now() + 60001).toISOString(),
  });
  assert.equal(stale.status, 'NotRun');
  assert.throws(() => publisher.publish(stale, {}), /rejects non-passing readiness/u);
  assert.throws(() => publisher.publish(JSON.parse(JSON.stringify(evaluation)), {
    candidateDigest: input.cycle.candidateDigest, profile: evaluation.profile,
    destination: 'owned-fixture-channel',
  }), { code: 'EVIDENCE' });
  assert.throws(() => publisher.publish(evaluation, undefined), /does not supply publication authority/u);
  assert.throws(() => publisher.publish(evaluation, {
    candidateDigest: digest('another candidate'), profile: evaluation.profile,
    destination: 'owned-fixture-channel',
  }), /does not supply publication authority/u);
  assert.throws(() => publisher.publish(evaluation, {
    candidateDigest: input.cycle.candidateDigest, profile: evaluation.profile,
    destination: 'another-channel',
  }), /does not supply publication authority/u);
  assert.deepEqual(publisher.effects, []);
  publisher.publish(evaluation, { candidateDigest: input.cycle.candidateDigest,
    profile: evaluation.profile, destination: 'owned-fixture-channel' });
  assert.deepEqual(publisher.effects, [
    { candidateDigest: input.cycle.candidateDigest, profile: evaluation.profile },
  ]);
  assert.equal((await current(input)).passed, false,
    'Even a separate detached publisher result cannot create managed completion');
});

async function repositoryFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await repositoryFiles(path.join(directory, entry.name), relative));
    else files.push(relative);
  }
  return files.sort();
}

async function installedConsumer(t) {
  const f = await fixture(t, { initialize: false });
  f.clock.value = Date.now();
  const definitions = [
    { ...unit, id: 'T-LEDGER-GUARD', implementation: 'test/ledger-guard.mjs' },
    { ...integration, id: 'T-LEDGER-DEBIT', implementation: 'test/ledger-debit.mjs' },
    { ...integration, id: 'T-LEDGER-AUDIT', implementation: 'test/ledger-audit.mjs',
      expected: 'An unrelated account remains byte-identical' },
  ];
  const configuration = consumerConfiguration(definitions[1], ['before-units']);
  const consumerFiles = new Map([
    ['account.mjs', `export function debit(account, amount) {
  if (amount < 0 || amount > account.balance) throw new RangeError('invalid debit');
  return { ...account, balance: account.balance - amount };
}
`],
    ['README.md', '# Independently owned account service\nUse the account checkpoint, not framework repository CI.\n'],
    [path.join('.github', 'workflows', 'existing.yml'), 'name: Consumer account CI\non: push\n'],
    [path.join('.sdlc', 'config.json'), JSON.stringify(configuration) + '\n'],
    [path.join('test', 'ledger-guard.mjs'),
      "const account = { id: 'selected', balance: 100 }; assert.throws(() => debit(account, 101), RangeError); assert.deepEqual(account, { id: 'selected', balance: 100 });"],
    [path.join('test', 'ledger-debit.mjs'),
      "assert.deepEqual(debit({ id: 'selected', balance: 100 }, 25), { id: 'selected', balance: 75 });"],
    [path.join('test', 'ledger-audit.mjs'),
      "const other = { id: 'unrelated', balance: 200 }; const before = JSON.stringify(other); debit({ id: 'selected', balance: 100 }, 25); assert.equal(JSON.stringify(other), before);"],
  ]);
  for (const [file, content] of consumerFiles) {
    const target = path.join(f.repo, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const isTest = file.startsWith(`test${path.sep}`);
    await fs.writeFile(target, isTest ?
      `import assert from 'node:assert/strict';\nimport { debit } from '../account.mjs';\n${content}\n` :
      content);
  }
  const preserved = new Map(await Promise.all([...consumerFiles.keys()].map(async file =>
    [file, await fs.readFile(path.join(f.repo, file))])));
  const installed = await install(f.store, { sourceRoot });
  assert.equal(installed.installed, true);
  const packageRoot = path.join(f.home, 'sdlc');
  const load = name => import(pathToFileURL(path.join(packageRoot, 'src', `${name}.mjs`)).href);
  const [storage, decisions, artifacts, validation, evidence, authority, hooks, gates, recovery] =
    await Promise.all(['store', 'decisions', 'artifacts', 'validation', 'evidence',
      'authority', 'hooks', 'gate', 'recovery'].map(load));
  f.store = await new storage.Store(f.home, { clock: f.clock }).ready();
  const request = 'Adopt this independent account service and its own complete local checkpoint.';
  await decisions.captureReceipt(f.store, { sessionId: f.sessionId,
    source: 'userPromptSubmitted', input: request });
  const adopted = await f.store.init({ workItemId: f.workItemId, repositoryId: 'primary',
    cwd: f.repo, sessionId: f.sessionId, adopt: true });
  assert.equal(adopted.adopted, true);
  for (const [role, contents] of [
    ['requirements', requirements], ['test-plan', plan(definitions)],
    ['technical-design', '# Independent account design\nRetain consumer-owned policy and exact balance assertions.\n'],
  ]) {
    const relative = await artifact(f, role, contents);
    await artifacts.registerArtifact(f.store, { workItemId: f.workItemId,
      repositoryId: 'primary', role, path: relative });
  }
  const phases = ['requirements', 'test-design', 'technical-design', 'coding'];
  for (let index = 0; index < 3; index++) {
    const effect = { transition: { from: phases[index], to: phases[index + 1] } };
    const pending = await decisions.prepareDecision(f.store, {
      workItemId: f.workItemId, sessionId: f.sessionId, kind: 'approval', effect,
    });
    f.clock.advance(1);
    const input = `Approve this consumer's ${phases[index]} and proceed to ${phases[index + 1]}.`;
    const receipt = await decisions.captureReceipt(f.store, {
      sessionId: f.sessionId, source: 'userPromptSubmitted', input,
    });
    await decisions.applyDecision(f.store, {
      workItemId: f.workItemId, sessionId: f.sessionId, kind: 'approval', effect,
      decisionId: pending.id, receiptId: receipt.id, input,
    });
  }
  await f.runGit('add', '.');
  await f.runGit('commit', '-qm', 'Independent installed consumer checkpoint');
  const { cycle } = await validation.startCycle(f.store, { workItemId: f.workItemId,
    configDigest: digest(configuration), cause: 'Exercise the installed consumer checkpoint' });
  return { f, cycle, definitions, preserved, packageRoot,
    api: { ...decisions, ...validation, ...evidence, ...authority, ...hooks, ...gates, ...recovery } };
}

async function observeConsumerProcess(input, definition) {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const execution = execute(process.execPath, [path.join(input.f.repo, definition.implementation)],
    { cwd: input.f.repo, timeout: 10000, env: { ...process.env,
      COPILOT_HOME: input.f.home, SDLC_SESSION_ID: input.f.sessionId } });
  const processId = execution.child.pid;
  const result = await execution;
  const observedAt = new Date().toISOString();
  input.f.clock.value = Math.max(input.f.clock.now(), Date.parse(observedAt) + 1);
  return { status: 'Passed', expectedMet: true, exitCode: 0, startedAt, observedAt,
    executionRef: `owned-process-${processId}-${Date.parse(startedAt)}`,
    durationMs: performance.now() - started,
    detail: `Owned process ${definition.implementation}; stdout ${digest(result.stdout)}; stderr ${digest(result.stderr)}` };
}

test('T-PRD009 an installed independent consumer retains its own unit-first checkpoint and advisory contract', async t => {
  const input = await installedConsumer(t);
  const initialFiles = await repositoryFiles(input.f.repo);
  const [guard, debit, audit] = input.definitions;
  const observations = new Map([[debit.id, await observeConsumerProcess(input, debit)]]);
  const reports = () => producerReports(input, { api: input.api, observations,
    reportedIds: [...observations.keys()], maxAgeMs: 3600000 });
  const record = bundle => input.api.recordReadiness(input.f.store, {
    workItemId: input.f.workItemId, cycleId: input.cycle.id, evaluation: bundle.evaluate(),
  });
  const state = async () => {
    const state = await input.f.store.load(input.f.workItemId);
    const cycle = input.api.currentCycle(state.records, state.checkpoint);
    return { ...state, cycle };
  };
  const beforeUnit = reports();
  assert.equal(beforeUnit.evaluate().status, 'NotRun');
  const early = await record(beforeUnit);
  assert.equal(early.evidence.find(row => row.testId === debit.id).status, 'NotRun');
  assert.ok(early.blocked.some(row => row.testId === debit.id && row.code === 'UNIT_FIRST'));
  let loaded = await state();
  assert.equal(input.api.stagePassed(loaded.cycle, loaded.records, 'local', input.f.clock), false);
  const hook = { cwd: input.f.repo, sessionId: input.f.sessionId,
    toolName: 'owned_consumer_checkpoint', toolArgs: { case: debit.id, attempt: 'before-units' } };
  const strict = await input.api.evaluateGate(input.f.store, hook);
  assert.equal(strict.permissionDecision, 'deny');
  assert.ok(strict.findings.some(row => row.rule === 'unit-first'));
  await input.api.handleHook(input.f.store, 'userPromptSubmitted', {
    sessionId: input.f.sessionId, cwd: input.f.repo,
    prompt: 'Skip unit-first and orientation for this one consumer-local command. Run uncredited; ' +
      'do not change the required checkpoint, mark it Passed, or install framework-repository CI policy.',
  });
  const override = await input.api.gate(input.f.store, hook);
  assert.equal(override.permissionDecision, undefined);
  assert.equal(override.stageOverride, true);
  assert.equal(override.managedDispatchBound, false);
  await input.api.handleHook(input.f.store, 'postToolUse', {
    ...hook, toolResult: { textResultForLlm: 'Owned independent consumer command completed' },
  });
  loaded = await state();
  assert.equal(input.api.stagePassed(loaded.cycle, loaded.records, 'local', input.f.clock), false);
  assert.equal(input.api.hasStageCompletion(loaded.records, loaded.cycle, 'local', input.f.clock), false);
  assert.ok(!loaded.records.some(row => row.type === 'operation'));

  observations.set(guard.id, await observeConsumerProcess(input, guard));
  const unitOnly = await record(reports());
  assert.equal(unitOnly.evidence.find(row => row.testId === guard.id).status, 'Passed');
  assert.equal(unitOnly.evidence.find(row => row.testId === debit.id).status, 'NotRun',
    'Importing the unit later cannot repair the actual early integration execution');
  observations.set(debit.id, await observeConsumerProcess(input, debit));
  const missing = reports();
  const incomplete = missing.evaluate();
  assert.deepEqual(incomplete.counts, {
    required: 3, passed: 2, failed: 0, notRun: 1, requiredAssertions: 3, failedExecutions: 0,
  });
  assert.equal(incomplete.cases.find(row => row.testId === audit.id).status, 'NotRun');
  await record(missing);
  loaded = await state();
  assert.equal(input.api.stagePassed(loaded.cycle, loaded.records, 'local', input.f.clock), false);
  await rejectIncompleteCompletion(input, input.api);
  observations.set(audit.id, await observeConsumerProcess(input, audit));
  const complete = reports();
  assert.equal(complete.evaluate().status, 'Passed');
  assert.equal(complete.evaluate().counts.required, 3);
  const admitted = await record(complete);
  assert.deepEqual(admitted.blocked, []);
  loaded = await state();
  assert.deepEqual(loaded.cycle.tests.map(row => row.id), [guard.id, debit.id, audit.id]);
  assert.equal(input.api.stagePassed(loaded.cycle, loaded.records, 'local', input.f.clock), true);
  assert.equal(input.api.hasStageCompletion(loaded.records, loaded.cycle, 'local', input.f.clock), false);
  assert.ok(!loaded.records.some(row => row.type === 'event' &&
    ['permission', 'pr-publication', 'dev-authorization', 'staging-promotion'].includes(row.kind)));
  for (const [file, bytes] of input.preserved) {
    assert.deepEqual(await fs.readFile(path.join(input.f.repo, file)), bytes);
  }
  assert.deepEqual(await repositoryFiles(input.f.repo), initialFiles);
  assert.deepEqual(input.api.currentCycle(loaded.records, loaded.checkpoint).tests.map(row => row.id),
    input.definitions.map(row => row.id));
});
