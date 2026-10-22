import { digest, requireThat } from '../src/core.mjs';
import { parseTestPlan, testSpecificationDigest } from '../src/artifacts.mjs';
import { normalizeExecutionReport, evaluateReadiness, validationInventoryDigest,
  validateExecutionContext, createEvidenceBundle, readEvidenceBundle,
  requireReadinessEvaluation } from 'ai-sdlc-framework/evidence';
import { validationPlatforms } from './validation-inventory.mjs';
// The shared native configuration recipe is invoked only after module initialization.
import { nativeConfigurationDigest, nativeProducerRole, nativePrPartsForProtocol, nativeFrameworkShardPlan,
  nativeSpecification, nativeFrameworkShardProtocol, requireNativeShardUnitOrder } from './native-validation.mjs';
import { nativeFrameworkShardProtocols, nativeFourBodyFrameworkShardProtocol } from './native-validation.mjs';
import { calculatorCapability, calculatorBaselineCapability } from './pr-calculator.mjs';
import { nativeBootstrapProtocol } from './toolchain-baseline.mjs';
import { nativeBootstrapRequirements } from './native-bootstrap-capability.mjs';

const projections = new WeakMap();
const suffixes = { 'linux-x64': 'LX', 'windows-x64': 'WX', 'macos-arm64': 'MA', 'macos-x64': 'MI' };
const platforms = { 'linux-x64': 'linux', 'windows-x64': 'win32', 'macos-arm64': 'darwin', 'macos-x64': 'darwin' };
export const nativeComponentPolicy = Object.freeze({
  schemaVersion: 1, protocol: 'native-component-projection-v1',
  profile: 'pr-components', location: 'github-pr-matrix',
  binding: 'adopted-plan-and-source-plannedCases-prefix-causal-root-closure',
  variants: 'every-source-applicable-native-target', origins: 'all-four-original-native-executions',
  missing: 'required-unresolved-assertion-never-empty-pass',
  verifierId: 'github-native-component-projection-v1',
  excludedCases: Object.freeze(['T-PRD012', 'T-PRD019', 'T-PRD025', 'T-PRD026',
    'T-PRD050', 'T-PRD053', 'T-PRD055', 'T-PRD056', 'T-PRD074', 'T-PRD081',
    'T-PRD086', 'T-PRD089']),
});
const shardPolicy = Object.freeze({ ...nativeComponentPolicy,
  protocol: 'native-component-projection-shards-v1', profile: 'pr-components-shards-v1',
  origins: 'all-eighteen-original-native-framework-executions',
  verifierId: 'github-native-component-projection-shards-v1' });
const fourBodyShardPolicy = Object.freeze({ ...shardPolicy,
  protocol: 'native-component-projection-shards-v2', profile: 'pr-components-shards-v2',
  origins: 'all-twenty-two-original-native-framework-executions',
  verifierId: 'github-native-component-projection-shards-v2' });
const splitUnitShardPolicy = Object.freeze({ ...shardPolicy,
  protocol: 'native-component-projection-shards-v3', profile: 'pr-components-shards-v3',
  origins: 'all-twenty-three-original-native-framework-executions',
  verifierId: 'github-native-component-projection-shards-v3' });
const componentPolicy = protocol => !protocol ? nativeComponentPolicy :
  protocol === nativeFrameworkShardProtocol ? splitUnitShardPolicy :
    protocol === nativeFourBodyFrameworkShardProtocol ? fourBodyShardPolicy : shardPolicy;
const sourceTimes = values => [...values].sort((a, b) => Date.parse(a) - Date.parse(b));
const prefix = name => /^(T-[A-Z0-9]+(?:-[A-Z0-9]+)*)(?:\s|$)/u.exec(name)?.[1];
const bindingDigest = assertion => digest({ id: assertion.id, file: assertion.file,
  name: assertion.name, parents: assertion.parents, sourceDigest: assertion.sourceDigest,
  applicability: assertion.applicability });

export function deriveNativeComponentSpecification({ inventory, testPlan, adapterSourceDigest,
  frameworkShards = false, goSources = [], shardProtocol = nativeFrameworkShardProtocol, bootstrapProtocol = null }) {
  requireThat(inventory?.complete === true && /^[a-f0-9]{64}$/u.test(inventory.digest ?? '') &&
    typeof testPlan === 'string' && /^[a-f0-9]{64}$/u.test(adapterSourceDigest ?? ''),
  'INVENTORY', 'Component expectations require complete adopted source, canonical Plan and exact adapter source digest');
  requireThat(typeof frameworkShards === 'boolean' && (!frameworkShards || goSources.length > 0 &&
    nativeFrameworkShardProtocols.includes(shardProtocol)),
    'INVENTORY', 'Shard component expectations require exact complete Go source definitions');
  const policy = componentPolicy(frameworkShards ? shardProtocol : null);
  const assignments = frameworkShards ? new Map(validationPlatforms.map(target =>
    [target, nativeFrameworkShardPlan({ inventory, plan: testPlan, target, protocol: shardProtocol })])) : null;
  const tests = parseTestPlan(testPlan).filter(test => !test.outOfScope &&
    test.location === nativeComponentPolicy.location && !nativeComponentPolicy.excludedCases.includes(test.id));
  const roots = inventory.cases.filter(test => test.parents.length === 0);
  const blockers = [];
  const bindings = [];
  const cases = tests.map(test => {
    const selectedRoots = roots.filter(root => inventory.cases.some(assertion =>
      assertion.file === root.file && (assertion.id === root.id || assertion.parents[0] === root.name) &&
      [...(assertion.plannedCases ?? []), ...assertion.parents.map(prefix), prefix(assertion.name)].includes(test.id)));
    const assertions = [];
    if (test.mode !== 'automated' || test.owner !== 'provider' || test.checkpoint !== 'post-review') {
      blockers.push({ testId: test.id, code: 'UNRESOLVED_COMPONENT_PROCEDURE',
        message: 'Automated native originals cannot establish this declared procedural mode/owner/checkpoint' });
    } else for (const assertion of inventory.cases.filter(assertion => selectedRoots.some(root =>
      assertion.file === root.file && (assertion.id === root.id || assertion.parents[0] === root.name)))) {
      for (const target of validationPlatforms.filter(target => assertion.applicability.platforms.includes(target))) {
        const selector = { target, sourceAssertionId: assertion.id,
          definitionDigest: bindingDigest(assertion), file: assertion.file,
          name: assertion.name, parents: assertion.parents };
        const id = `component-${digest([test.id, selector])}`;
        assertions.push({ id, selector });
        bindings.push({ testId: test.id, assertionId: id, target, sourceAssertionId: assertion.id,
          sourceTestId: `T-PRD014-${suffixes[target]}`, selector,
          ...(frameworkShards ? { sourceRole: assignments.get(target).parts.find(part =>
            part.assertionIds.includes(assertion.id)).role } : {}) });
      }
    }
    if (!assertions.length) {
      blockers.push({ testId: test.id, code: 'MISSING_COMPONENT_BINDING',
        message: 'No complete source-bound executable root closure establishes the declared component case' });
      assertions.push({ id: `unresolved-${test.id}`, selector: {
        procedure: 'unresolved-component-binding', testId: test.id,
      } });
    }
    return { id: test.id, conditions: test.conditions, expectedDigest: digest(test.expected),
      executionId: `native-component-${test.id}`, mode: test.mode, owner: test.owner,
      location: test.location, checkpoint: test.checkpoint,
      assertions: assertions.sort((a, b) => a.id.localeCompare(b.id, 'en')) };
  }).sort((a, b) => a.id.localeCompare(b.id, 'en'));
  requireThat(cases.length > 0, 'INVENTORY', 'The adopted Plan must explicitly declare required native component cases');
  const specification = { schemaVersion: 1, profile: policy.profile, cases };
  validationInventoryDigest(specification);
  const calculator = calculatorCapability(inventory);
  const definition = { schemaVersion: 1, policy,
    ...(bootstrapProtocol === null ? {} : { bootstrapProtocol }),
    adapterSourceDigest, sourceInventoryDigest: inventory.digest, testSpecDigest: testSpecificationDigest(testPlan),
    requiredCaseIds: cases.map(test => test.id), requiredPlatforms: [...validationPlatforms],
    specification, bindings: bindings.sort((a, b) => a.assertionId.localeCompare(b.assertionId, 'en')), blockers,
    ...(digest(calculator) === digest(calculatorBaselineCapability) ? {} : { calculator }),
    ...(frameworkShards ? { frameworkShards: shardProtocol,
      shardParts: nativePrPartsForProtocol(shardProtocol).filter(part => part.component === 'framework').map(part => ({
        ...part, assignmentDigest: assignments.get(part.target).digest,
        ...(bootstrapProtocol === nativeBootstrapProtocol ? {
          bootstrapTools: nativeBootstrapRequirements({ inventory, plan: testPlan, ...part, profile: 'pr',
            protocol: bootstrapProtocol, assignment: assignments.get(part.target) }),
        } : {}),
        inventoryDigest: validationInventoryDigest(nativeSpecification({
          plan: testPlan, inventory, goSources, ...part, profile: 'pr', shardProtocol,
        })),
      })) } : {}) };
  return { ...definition, adapterDefinitionDigest: digest(definition) };
}

function checkDefinition(definition) {
  requireThat(definition && Object.getPrototypeOf(definition) === Object.prototype,
    'EVIDENCE', 'Component projection requires its independently derived definition');
  const { adapterDefinitionDigest, ...inputs } = definition;
  requireThat(digest(inputs) === adapterDefinitionDigest &&
    digest(definition.policy) === digest(componentPolicy(definition.frameworkShards)), 'EVIDENCE',
  'Component adapter definition differs from its independently derived source-bound identity');
  validationInventoryDigest(definition.specification);
  requireThat(definition.frameworkShards === undefined ||
    nativeFrameworkShardProtocols.includes(definition.frameworkShards) &&
    Array.isArray(definition.shardParts) &&
    definition.shardParts.length === nativePrPartsForProtocol(definition.frameworkShards).length - 2 &&
    new Set(definition.shardParts.map(part => part.role)).size === definition.shardParts.length &&
    nativePrPartsForProtocol(definition.frameworkShards).filter(part => part.component === 'framework').every(expected =>
      definition.shardParts.some(part => part.target === expected.target && part.component === expected.component &&
        part.shard === expected.shard && part.role === expected.role &&
        /^[a-f0-9]{64}$/u.test(part.assignmentDigest ?? '') && /^[a-f0-9]{64}$/u.test(part.inventoryDigest ?? ''))),
  'EVIDENCE', 'Shard projection needs its complete versioned independently derived producer definition');
}

function expectedMatrix(expectedLanes, definition) {
  const parts = definition.frameworkShards ? definition.shardParts : validationPlatforms.map(target => ({ target }));
  requireThat(Array.isArray(expectedLanes) && expectedLanes.length === parts.length &&
    expectedLanes.every(lane => lane && Object.getPrototypeOf(lane) === Object.prototype) &&
    new Set(expectedLanes.map(lane => definition.frameworkShards ? lane.context?.jobRef : lane.target)).size === parts.length,
  'EVIDENCE', 'Component expectation requires every independently established native producer context');
  const lanes = parts.map(part => {
    const { target } = part;
    const selected = expectedLanes.find(lane => lane.target === target &&
      (!definition.frameworkShards || lane.context?.jobRef === `native-${part.role}`));
    requireThat(selected, 'EVIDENCE', `Missing independently expected native ${target} context`);
    const context = validateExecutionContext(selected.context);
    const component = definition.frameworkShards ? 'framework' :
      target.startsWith('macos-') && context.profile === `pr-framework-${target}` ?
      'framework' : 'full';
    const shard = part.shard ?? null;
    const configuredWorkers = context.native.toolchain.resources?.configuredWorkers;
    requireThat(context.profile === `pr-${component === 'full' ? '' : 'framework-'}${shard === null ? '' : shard + '-'}${target}` &&
      context.jobRef === `native-${nativeProducerRole(target, component, shard)}` &&
      context.location === `github-${target}` && context.owner === 'provider' &&
      context.mode === 'automated' && context.environment === 'local' &&
      context.producer.provider === 'github' && context.producer.connection === 'repository-ci' &&
      context.native.kind === 'native' && context.native.platform === platforms[target] &&
      context.native.architecture === target.split('-')[1] &&
      context.testSpecDigest === definition.testSpecDigest && configuredWorkers !== undefined &&
      context.configDigest === nativeConfigurationDigest({
        target,
        bootstrapProtocol: definition.bootstrapProtocol ?? null,
        bootstrapTools: part.bootstrapTools ?? null,
        inventory: { complete: true, digest: definition.sourceInventoryDigest },
        profile: 'pr', component, configuredWorkers, calculator: definition.calculator ?? calculatorBaselineCapability,
        shard, shardPlanDigest: part.assignmentDigest ?? null,
        shardProtocol: definition.frameworkShards ?? nativeFrameworkShardProtocol,
      }) && (!definition.frameworkShards || context.inventoryDigest === part.inventoryDigest),
    'EVIDENCE', 'Component expectations must preserve actual native host and original specification identities');
    return { target, context, component, ...(definition.frameworkShards ? { role: part.role } : {}) };
  });
  const first = lanes[0].context;
  requireThat(lanes.every(({ context }) => context.candidateDigest === first.candidateDigest &&
    digest(context.sources) === digest(first.sources) &&
    digest(context.artifacts) === digest(first.artifacts) && digest(context.producer) === digest(first.producer)),
  'EVIDENCE', 'Component native lanes belong to different source/configuration/artifact/producer identities');
  return lanes;
}

export function nativeComponentSelection({ definition, expectedLanes, now, unitOrder }) {
  checkDefinition(definition);
  const lanes = expectedMatrix(expectedLanes, definition);
  if (definition.frameworkShards) requireNativeShardUnitOrder(unitOrder, expectedLanes, definition.frameworkShards);
  const baseline = lanes[0].context;
  const matrix = lanes.map(({ target, context, role }) => ({
    target, contextDigest: digest(context), platform: context.native.platform,
    ...(role ? { role } : {}),
    architecture: context.native.architecture, image: context.native.image,
    toolchainDigest: digest(context.native.toolchain),
  }));
  const executions = definition.specification.cases.map(test => ({
    id: test.executionId, context: validateExecutionContext({
      candidateDigest: baseline.candidateDigest, testSpecDigest: definition.testSpecDigest,
      configDigest: digest({ adapter: definition.adapterDefinitionDigest, matrix,
        ...(definition.frameworkShards ? { unitOrder: digest(unitOrder) } : {}) }),
      inventoryDigest: validationInventoryDigest(definition.specification),
      sources: baseline.sources, profile: definition.specification.profile,
      environment: 'local', location: definition.policy.location, mode: test.mode, owner: test.owner,
      native: { kind: 'metadata', platform: 'verified-native-matrix', architecture: 'x64-and-arm64',
        image: definition.frameworkShards ? 'derived-from-eighteen-native-framework-jobs' : 'derived-from-four-native-jobs', toolchain: {
          adapter: definition.policy.protocol, adapterDefinitionDigest: definition.adapterDefinitionDigest, matrix,
        } },
      producer: baseline.producer, attemptCapability: baseline.attemptCapability,
      jobRef: `native-component-projection/${test.id}`, artifacts: baseline.artifacts,
    }),
  }));
  return { profile: definition.specification.profile, executions, now,
    policy: { maxAgeMs: 24 * 60 * 60 * 1000, revisionPolicy: 'exact',
      verifierIds: [definition.policy.verifierId] } };
}

export function projectNativeComponentEvidence({ definition, expectedLanes, originals, verifyOriginal, now, unitOrder,
  nativeEvaluations }) {
  checkDefinition(definition);
  const expectedCount = definition.frameworkShards ? definition.shardParts.length : validationPlatforms.length;
  requireThat(Array.isArray(originals) && originals.length <= expectedCount &&
    originals.every(original => original && Object.getPrototypeOf(original) === Object.prototype) &&
    typeof verifyOriginal === 'function', 'EVIDENCE',
    'Component projection consumes original bytes and an in-process authentic native-origin verifier');
  const selected = nativeComponentSelection({ definition, expectedLanes, now, unitOrder });
  const lanes = expectedMatrix(expectedLanes, definition);
  const normalized = new Map();
  const provenance = [];
  const blockers = [...definition.blockers];
  const sourceEvaluations = new Map();
  let evaluationsPassed = true;
  if (definition.frameworkShards) {
    requireThat(Array.isArray(nativeEvaluations) && nativeEvaluations.length === lanes.length &&
      new Set(nativeEvaluations.map(part => part.role)).size === lanes.length,
    'EVIDENCE', 'Shard composition requires every reacquired protected native SDK evaluation');
    for (const lane of lanes) {
      const selected = nativeEvaluations.find(part => part.role === lane.role);
      requireThat(selected, 'EVIDENCE', 'A protected native shard evaluation is missing');
      const state = requireReadinessEvaluation(selected.evaluation);
      requireThat(state.context.executions.length === 1 && state.context.executions[0].id === lane.context.jobRef &&
        digest(state.context.executions[0].context) === digest(lane.context) &&
        validationInventoryDigest(state.spec) === lane.context.inventoryDigest &&
        state.reports.length === 1, 'EVIDENCE',
      'Native SDK shard facts differ from the independently expected source/profile/selection/producer');
      const refreshed = evaluateReadiness(state.spec, state.reports, { ...state.context, now });
      if (refreshed.status !== 'Passed') {
        evaluationsPassed = false;
        blockers.push({ role: lane.role, code: 'INCOMPLETE_NATIVE_SHARD_EVALUATION' });
      }
      sourceEvaluations.set(lane.role, state.reports[0].id);
    }
  }
  for (const { target, context, role } of lanes) {
    const key = role ?? target;
    const matches = originals.filter(original => original.target === target &&
      (!definition.frameworkShards || original.role === role));
    if (matches.length !== 1 || typeof matches[0].text !== 'string') {
      blockers.push({ target, ...(role ? { role } : {}), code: 'MISSING_OR_DUPLICATE_NATIVE_ORIGINAL' });
      continue;
    }
    let proof;
    const report = normalizeExecutionReport(matches[0].text, context, input => {
      proof = verifyOriginal({ target, ...(role ? { role } : {}), ...input });
      return proof;
    });
    requireThat(proof && proof.reportDigest === digest(matches[0].text) &&
      digest(proof.context) === digest(context) && proof.sourceTime === report.observedAt &&
      proof.sourceSequence === report.sequence && typeof proof.verifierId === 'string',
    'EVIDENCE', 'Component source original lacks its authentic native origin/context/time proof');
    if (definition.frameworkShards) {
      const job = unitOrder.jobs.find(job => job.role === role);
      requireThat(sourceEvaluations.get(role) === report.id &&
        Date.parse(report.startedAt) >= Date.parse(job.startedAt) &&
        Date.parse(report.observedAt) < Date.parse(job.completedAt) + 1000,
      'EVIDENCE', 'Component source bytes/times differ from their protected native SDK facts and actual job');
    }
    requireThat(digest(report.context) === digest(context), 'EVIDENCE',
      'Component original source/native context differs from independently expected lanes');
    normalized.set(key, report);
    provenance.push({ target, reportDigest: proof.reportDigest, verifierId: proof.verifierId,
      ...(role ? { role } : {}), context, sourceTime: proof.sourceTime, sourceSequence: proof.sourceSequence });
  }
  requireThat(originals.every(original => validationPlatforms.includes(original.target) &&
    (!definition.frameworkShards || definition.shardParts.some(part =>
      part.target === original.target && part.role === original.role))),
    'EVIDENCE', 'Unexpected native source cannot supply component evidence');
  requireThat(normalized.size > 0, 'EVIDENCE',
    'No authenticated native original exists; component source time and outcomes remain unverified');
  const reports = [];
  const projectedOriginals = [];
  const times = [...normalized.values()].map(report => report.observedAt);
  const observedAt = sourceTimes(times).at(-1);
  const startedAt = sourceTimes([...normalized.values()].map(report => report.startedAt))[0];
  for (const test of definition.specification.cases) {
    const context = selected.executions.find(execution => execution.id === test.executionId).context;
    const results = [];
    let complete = evaluationsPassed && normalized.size === lanes.length && normalized.size > 0 &&
      [...normalized.values()].every(report => report.complete && report.exitCode === 0);
    for (const assertion of test.assertions) {
      const binding = definition.bindings.find(binding => binding.testId === test.id &&
        binding.assertionId === assertion.id);
      if (!binding) { complete = false; continue; }
      const source = normalized.get(binding.sourceRole ?? binding.target);
      const matches = source?.observations.filter(row => row.testId === binding.sourceTestId &&
        row.assertionId === binding.sourceAssertionId) ?? [];
      if (matches.length !== 1 || digest(matches[0].selector) !== digest({
        file: binding.selector.file, name: binding.selector.name, parents: binding.selector.parents,
      })) {
        complete = false;
        blockers.push({ testId: test.id, target: binding.target,
          assertionId: assertion.id, code: 'MISSING_OR_MISMATCHED_COMPONENT_ORIGINAL' });
        continue;
      }
      const row = matches[0];
      results.push({ testId: test.id, assertionId: assertion.id, selector: assertion.selector,
        status: row.rawStatus, expectedMet: row.expectedMet, expectedDigest: test.expectedDigest,
        checkpoint: test.checkpoint, observedAt: row.observedAt, sourceSequence: row.sourceSequence,
        durationMs: row.durationMs, exitCode: row.exitCode,
        ...(row.detail ? { detail: row.detail } : {}) });
    }
    const raw = { schemaVersion: 1, kind: 'test-execution', context, startedAt,
      finishedAt: complete ? observedAt : null, observedAt,
      sequence: Math.max(1, ...[...normalized.values()].map(report => report.sequence)),
      complete, exitCode: complete ? 0 : 2, results,
      sourceSummary: { kind: 'verified-native-component-derivation',
        adapterDefinitionDigest: definition.adapterDefinitionDigest,
        sources: provenance.map(({ context, ...source }) => ({ ...source, contextDigest: digest(context) })) } };
    const text = JSON.stringify(raw);
    projectedOriginals.push({ executionId: test.executionId, text, sha256: digest(text) });
    reports.push(normalizeExecutionReport(text, context, input => normalized.size ? {
      verifierId: definition.policy.verifierId, reportDigest: input.reportDigest, context,
      sourceTime: raw.observedAt, sourceSequence: raw.sequence,
    } : null));
  }
  const evaluation = evaluateReadiness(definition.specification, reports, selected);
  const projection = { schemaVersion: 1, kind: 'native-component-projection',
    definition, selection: selected, evaluation, bundle: createEvidenceBundle(evaluation),
    ...(definition.frameworkShards ? { unitOrderFacts: unitOrder } : {}),
    originals: projectedOriginals,
    sourceOriginals: originals.filter(original => normalized.has(original.role ?? original.target)).map(original => ({
      target: original.target, ...(definition.frameworkShards ? { role: original.role } : {}),
      text: original.text, sha256: digest(original.text),
    })), provenance, blockers };
  projections.set(projection, digest(projection));
  return projection;
}

export function requireNativeComponentProjection(projection) {
  requireThat(projections.get(projection) === digest(projection), 'EVIDENCE',
    'Component evidence must originate from the verified-original adapter, not serialized passing flags');
  requireReadinessEvaluation(projection.evaluation);
  return projection;
}

export function replayNativeComponentEvidence({ bundle, ...inputs }) {
  const reconstructed = projectNativeComponentEvidence(inputs);
  const restored = readEvidenceBundle(bundle, {
    specification: inputs.definition.specification, context: reconstructed.selection,
  }, input => {
    const original = reconstructed.originals.find(original => original.sha256 === input.reportDigest);
    if (!original) return null;
    const raw = JSON.parse(original.text);
    return digest(raw.context) === digest(input.claimedContext) ? {
      verifierId: inputs.definition.policy.verifierId, reportDigest: original.sha256, context: raw.context,
      sourceTime: raw.observedAt, sourceSequence: raw.sequence,
    } : null;
  });
  return { ...restored, reconstructed, adapterDefinitionDigest: inputs.definition.adapterDefinitionDigest };
}
