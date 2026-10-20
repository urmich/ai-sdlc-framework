import { digest, requireThat } from '../src/core.mjs';
import { parseTestPlan, testSpecificationDigest } from '../src/artifacts.mjs';
import { normalizeExecutionReport, evaluateReadiness, validationInventoryDigest,
  validateExecutionContext, createEvidenceBundle, readEvidenceBundle,
  requireReadinessEvaluation } from 'ai-sdlc-framework/evidence';
import { validationPlatforms } from './validation-inventory.mjs';
// The shared native configuration recipe is invoked only after module initialization.
import { nativeConfigurationDigest } from './native-validation.mjs';
import { calculatorCapability, calculatorBaselineCapability } from './pr-calculator.mjs';

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
const sourceTimes = values => [...values].sort((a, b) => Date.parse(a) - Date.parse(b));
const prefix = name => /^(T-[A-Z0-9]+(?:-[A-Z0-9]+)*)(?:\s|$)/u.exec(name)?.[1];
const bindingDigest = assertion => digest({ id: assertion.id, file: assertion.file,
  name: assertion.name, parents: assertion.parents, sourceDigest: assertion.sourceDigest,
  applicability: assertion.applicability });

export function deriveNativeComponentSpecification({ inventory, testPlan, adapterSourceDigest }) {
  requireThat(inventory?.complete === true && /^[a-f0-9]{64}$/u.test(inventory.digest ?? '') &&
    typeof testPlan === 'string' && /^[a-f0-9]{64}$/u.test(adapterSourceDigest ?? ''),
  'INVENTORY', 'Component expectations require complete adopted source, canonical Plan and exact adapter source digest');
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
          sourceTestId: `T-PRD014-${suffixes[target]}`, selector });
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
  const specification = { schemaVersion: 1, profile: nativeComponentPolicy.profile, cases };
  validationInventoryDigest(specification);
  const calculator = calculatorCapability(inventory);
  const definition = { schemaVersion: 1, policy: nativeComponentPolicy,
    adapterSourceDigest, sourceInventoryDigest: inventory.digest, testSpecDigest: testSpecificationDigest(testPlan),
    requiredCaseIds: cases.map(test => test.id), requiredPlatforms: [...validationPlatforms],
    specification, bindings: bindings.sort((a, b) => a.assertionId.localeCompare(b.assertionId, 'en')), blockers,
    ...(digest(calculator) === digest(calculatorBaselineCapability) ? {} : { calculator }) };
  return { ...definition, adapterDefinitionDigest: digest(definition) };
}

function checkDefinition(definition) {
  requireThat(definition && Object.getPrototypeOf(definition) === Object.prototype,
    'EVIDENCE', 'Component projection requires its independently derived definition');
  const { adapterDefinitionDigest, ...inputs } = definition;
  requireThat(digest(inputs) === adapterDefinitionDigest &&
    digest(definition.policy) === digest(nativeComponentPolicy), 'EVIDENCE',
  'Component adapter definition differs from its independently derived source-bound identity');
  validationInventoryDigest(definition.specification);
}

function expectedMatrix(expectedLanes, definition) {
  requireThat(Array.isArray(expectedLanes) && expectedLanes.length === validationPlatforms.length &&
    expectedLanes.every(lane => lane && Object.getPrototypeOf(lane) === Object.prototype) &&
    new Set(expectedLanes.map(lane => lane.target)).size === validationPlatforms.length,
  'EVIDENCE', 'Component expectation requires four independently established native lane contexts');
  const lanes = validationPlatforms.map(target => {
    const selected = expectedLanes.find(lane => lane.target === target);
    requireThat(selected, 'EVIDENCE', `Missing independently expected native ${target} context`);
    const context = validateExecutionContext(selected.context);
    const configuredWorkers = context.native.toolchain.resources?.configuredWorkers;
    requireThat(context.profile === `pr-${target}` && context.jobRef === `native-${target}` &&
      context.location === `github-${target}` && context.owner === 'provider' &&
      context.mode === 'automated' && context.environment === 'local' &&
      context.producer.provider === 'github' && context.producer.connection === 'repository-ci' &&
      context.native.kind === 'native' && context.native.platform === platforms[target] &&
      context.native.architecture === target.split('-')[1] &&
      context.testSpecDigest === definition.testSpecDigest && configuredWorkers !== undefined &&
      context.configDigest === nativeConfigurationDigest({
        inventory: { complete: true, digest: definition.sourceInventoryDigest },
        profile: 'pr', configuredWorkers, calculator: definition.calculator ?? calculatorBaselineCapability,
      }),
    'EVIDENCE', 'Component expectations must preserve actual native host and original specification identities');
    return { target, context };
  });
  const first = lanes[0].context;
  requireThat(lanes.every(({ context }) => context.candidateDigest === first.candidateDigest &&
    context.configDigest === first.configDigest && digest(context.sources) === digest(first.sources) &&
    digest(context.artifacts) === digest(first.artifacts) && digest(context.producer) === digest(first.producer)),
  'EVIDENCE', 'Component native lanes belong to different source/configuration/artifact/producer identities');
  return lanes;
}

export function nativeComponentSelection({ definition, expectedLanes, now }) {
  checkDefinition(definition);
  const lanes = expectedMatrix(expectedLanes, definition);
  const baseline = lanes[0].context;
  const matrix = lanes.map(({ target, context }) => ({
    target, contextDigest: digest(context), platform: context.native.platform,
    architecture: context.native.architecture, image: context.native.image,
    toolchainDigest: digest(context.native.toolchain),
  }));
  const executions = definition.specification.cases.map(test => ({
    id: test.executionId, context: validateExecutionContext({
      candidateDigest: baseline.candidateDigest, testSpecDigest: definition.testSpecDigest,
      configDigest: digest({ adapter: definition.adapterDefinitionDigest, matrix }),
      inventoryDigest: validationInventoryDigest(definition.specification),
      sources: baseline.sources, profile: definition.specification.profile,
      environment: 'local', location: nativeComponentPolicy.location, mode: test.mode, owner: test.owner,
      native: { kind: 'metadata', platform: 'verified-native-matrix', architecture: 'x64-and-arm64',
        image: 'derived-from-four-native-jobs', toolchain: {
          adapter: nativeComponentPolicy.protocol, adapterDefinitionDigest: definition.adapterDefinitionDigest, matrix,
        } },
      producer: baseline.producer, attemptCapability: baseline.attemptCapability,
      jobRef: `native-component-projection/${test.id}`, artifacts: baseline.artifacts,
    }),
  }));
  return { profile: definition.specification.profile, executions, now,
    policy: { maxAgeMs: 24 * 60 * 60 * 1000, revisionPolicy: 'exact',
      verifierIds: [nativeComponentPolicy.verifierId] } };
}

export function projectNativeComponentEvidence({ definition, expectedLanes, originals, verifyOriginal, now }) {
  checkDefinition(definition);
  requireThat(Array.isArray(originals) && originals.length <= validationPlatforms.length &&
    originals.every(original => original && Object.getPrototypeOf(original) === Object.prototype) &&
    typeof verifyOriginal === 'function', 'EVIDENCE',
    'Component projection consumes original bytes and an in-process authentic native-origin verifier');
  const selected = nativeComponentSelection({ definition, expectedLanes, now });
  const lanes = expectedMatrix(expectedLanes, definition);
  const normalized = new Map();
  const provenance = [];
  const blockers = [...definition.blockers];
  for (const { target, context } of lanes) {
    const matches = originals.filter(original => original.target === target);
    if (matches.length !== 1 || typeof matches[0].text !== 'string') {
      blockers.push({ target, code: 'MISSING_OR_DUPLICATE_NATIVE_ORIGINAL' });
      continue;
    }
    let proof;
    const report = normalizeExecutionReport(matches[0].text, context, input => {
      proof = verifyOriginal({ target, ...input });
      return proof;
    });
    requireThat(proof && proof.reportDigest === digest(matches[0].text) &&
      digest(proof.context) === digest(context) && proof.sourceTime === report.observedAt &&
      proof.sourceSequence === report.sequence && typeof proof.verifierId === 'string',
    'EVIDENCE', 'Component source original lacks its authentic native origin/context/time proof');
    requireThat(digest(report.context) === digest(context), 'EVIDENCE',
      'Component original source/native context differs from independently expected lanes');
    normalized.set(target, report);
    provenance.push({ target, reportDigest: proof.reportDigest, verifierId: proof.verifierId,
      context, sourceTime: proof.sourceTime, sourceSequence: proof.sourceSequence });
  }
  requireThat(originals.every(original => validationPlatforms.includes(original.target)),
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
    let complete = normalized.size === lanes.length && normalized.size > 0 &&
      [...normalized.values()].every(report => report.complete && report.exitCode === 0);
    for (const assertion of test.assertions) {
      const binding = definition.bindings.find(binding => binding.testId === test.id &&
        binding.assertionId === assertion.id);
      if (!binding) { complete = false; continue; }
      const source = normalized.get(binding.target);
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
      verifierId: nativeComponentPolicy.verifierId, reportDigest: input.reportDigest, context,
      sourceTime: raw.observedAt, sourceSequence: raw.sequence,
    } : null));
  }
  const evaluation = evaluateReadiness(definition.specification, reports, selected);
  const projection = { schemaVersion: 1, kind: 'native-component-projection',
    definition, selection: selected, evaluation, bundle: createEvidenceBundle(evaluation),
    originals: projectedOriginals,
    sourceOriginals: originals.filter(original => normalized.has(original.target)).map(original => ({
      target: original.target, text: original.text, sha256: digest(original.text),
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
      verifierId: nativeComponentPolicy.verifierId, reportDigest: original.sha256, context: raw.context,
      sourceTime: raw.observedAt, sourceSequence: raw.sequence,
    } : null;
  });
  return { ...restored, reconstructed, adapterDefinitionDigest: inputs.definition.adapterDefinitionDigest };
}
