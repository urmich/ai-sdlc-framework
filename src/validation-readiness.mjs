import { LIMITS, SdlcError, canonical, choice, digest, id, object, requireThat,
  safeRecord, strings, text } from './core.mjs';
import { objectReference, validateObjectReference, OUTCOME_PAGE_SIZE } from './validation-catalog.mjs';
import { executionSourceEligible, observationAfterReset, reduceTestHistory,
  validateRetainedPayload } from './validation-evidence.mjs';
import { canCreditExecutionIdentity, validateCurrentExecutionIdentity } from './provider-adapters.mjs';

const reports = new WeakMap();
const evaluations = new WeakMap();
const hash = /^[a-f0-9]{64}$/u;
const revision = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const condition = /^AC-\d+\.\d+$/u;
const outcomes = ['Passed', 'Failed', 'NotRun'];
const rawOutcomes = [...outcomes, 'Skipped', 'Todo', 'Cancelled', 'Running', 'Pending', 'Blocked'];
const checkpoints = ['pre-review', 'review', 'post-review', 'DEV', 'STAGING'];
const owners = ['agent', 'provider', 'user', 'external-system'];
const modes = ['automated', 'semi-automated', 'manual'];
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
export const MAX_OBJECTS = 10000;
export const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;

function jsonData(value, limit = LIMITS.artifact) {
  let nodes = 0;
  const maxNodes = Math.max(200000, Math.floor(limit / 16));
  function visit(item, depth) {
    requireThat(depth <= 32 && ++nodes <= maxNodes, 'CAPACITY',
      'Validation data exceeds the bounded JSON structure budget');
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'string') {
      requireThat(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(item),
        'UNSAFE', 'Validation data contains unsupported control characters');
      return;
    }
    if (typeof item === 'number') {
      requireThat(Number.isFinite(item), 'INPUT', 'Validation data contains a non-finite number');
      return;
    }
    requireThat(item && typeof item === 'object' &&
      (Array.isArray(item) ? Object.getPrototypeOf(item) === Array.prototype :
        Object.getPrototypeOf(item) === Object.prototype) &&
      Object.getOwnPropertySymbols(item).length === 0,
    'INPUT', 'Validation data must be plain JSON without executable values');
    const fields = Object.getOwnPropertyDescriptors(item);
    requireThat(Object.values(fields).every(field => Object.hasOwn(field, 'value')),
      'INPUT', 'Validation data cannot contain accessors');
    for (const key of Object.keys(item)) visit(fields[key].value, depth + 1);
  }
  visit(value, 0);
  requireThat(Buffer.byteLength(canonical(value)) <= limit, 'CAPACITY',
    'Validation data exceeds its byte budget');
  return value;
}
export function validateReadinessData(value, limit = LIMITS.artifact) {
  jsonData(value, limit);
  validateRetainedPayload(value);
  return value;
}
function record(value, allowed, required = allowed) {
  requireThat(value && Object.getPrototypeOf(value) === Object.prototype &&
    Object.values(Object.getOwnPropertyDescriptors(value)).every(field =>
      Object.hasOwn(field, 'value')), 'INPUT', 'Expected plain validation data');
  requireThat(Object.keys(value).every(key => allowed.includes(key)),
    'INPUT', 'Unknown validation field');
  return object(value, allowed, required);
}
function identity(value, label, max = 512) {
  text(value, label, max);
  requireThat(value === value.trim() && !/[\u0000-\u001f]/u.test(value),
    'INPUT', `Invalid ${label}`);
  return value;
}
function sha(value, label) {
  requireThat(typeof value === 'string' && hash.test(value), 'INPUT', `Invalid ${label}`);
  return value;
}
function at(value, label) {
  requireThat(typeof value === 'string' && Number.isFinite(Date.parse(value)),
    'INPUT', `Invalid ${label}`);
  return new Date(value).toISOString();
}
function list(value, label, { empty = false, max = 10000 } = {}) {
  requireThat(Array.isArray(value) && (empty || value.length > 0) && value.length <= max,
    'INPUT', `Invalid ${label}`);
  return value;
}
function unique(values, label) {
  requireThat(new Set(values).size === values.length, 'INPUT', `Duplicate ${label}`);
}
function clone(value) { return JSON.parse(canonical(value)); }
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
function checkpointEnvironment(checkpoint) {
  return checkpoint === 'DEV' || checkpoint === 'STAGING' ? checkpoint : 'local';
}
function selector(value) {
  validateReadinessData(value, 4096);
  requireThat(value && Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).length > 0, 'INPUT', 'An assertion needs an exact selector/procedure');
  return clone(value);
}
export function validateExecutionContext(value) {
  validateReadinessData(value, LIMITS.decision);
  record(value, ['candidateDigest', 'testSpecDigest', 'configDigest', 'inventoryDigest',
    'sources', 'profile', 'environment', 'location', 'mode', 'owner', 'native',
    'producer', 'attemptCapability', 'jobRef', 'artifacts', 'intentId'],
  ['candidateDigest', 'testSpecDigest', 'configDigest', 'inventoryDigest', 'sources',
    'profile', 'environment', 'location', 'mode', 'owner', 'native', 'producer',
    'attemptCapability', 'jobRef', 'artifacts']);
  const sources = list(value.sources, 'execution sources', { max: 100 }).map(source => {
    record(source, ['repositoryId', 'revision', 'contentDigest']);
    requireThat(source.revision === null || revision.test(source.revision),
      'INPUT', 'Execution source needs an exact revision or explicit unborn state');
    return { repositoryId: id(source.repositoryId), revision: source.revision,
      contentDigest: sha(source.contentDigest, 'execution source digest') };
  }).sort((left, right) => compare(left.repositoryId, right.repositoryId));
  unique(sources.map(source => source.repositoryId), 'execution repository');
  record(value.native, ['kind', 'platform', 'architecture', 'image', 'toolchain']);
  choice(value.native.kind, ['native', 'cross-build', 'metadata', 'fixture'], 'execution kind');
  requireThat(value.native.toolchain &&
    Object.getPrototypeOf(value.native.toolchain) === Object.prototype,
  'INPUT', 'Capture the actual toolchain identity');
  const native = {
    kind: value.native.kind, platform: identity(value.native.platform, 'native platform'),
    architecture: identity(value.native.architecture, 'native architecture'),
    image: identity(value.native.image, 'image identity'),
    toolchain: clone(value.native.toolchain),
  };
  const artifacts = list(value.artifacts, 'tested artifacts', { empty: true, max: 1000 })
    .map(artifact => {
      record(artifact, ['name', 'sha256']);
      return { name: identity(artifact.name, 'tested artifact name'),
        sha256: sha(artifact.sha256, 'tested artifact digest') };
    }).sort((left, right) => compare(left.name, right.name));
  unique(artifacts.map(artifact => artifact.name), 'tested artifact');
  const producer = validateCurrentExecutionIdentity(value.producer, value.attemptCapability);
  choice(value.environment, ['local', 'DEV', 'STAGING'], 'execution environment');
  choice(value.mode, modes, 'execution mode');
  choice(value.owner, owners, 'execution owner');
  if (value.mode === 'manual') requireThat(value.owner === 'user',
    'HOST', 'Manual observations belong to their actual user owner');
  return {
    candidateDigest: sha(value.candidateDigest, 'candidate digest'),
    testSpecDigest: sha(value.testSpecDigest, 'test specification digest'),
    configDigest: sha(value.configDigest, 'configuration digest'),
    inventoryDigest: sha(value.inventoryDigest, 'assertion inventory digest'),
    sources, profile: id(value.profile, 'validation profile'), environment: value.environment,
    location: identity(value.location, 'execution location'), mode: value.mode,
    owner: value.owner, native, producer, attemptCapability: value.attemptCapability,
    jobRef: identity(value.jobRef, 'producer job reference'), artifacts,
    ...(value.intentId !== undefined ? { intentId: id(value.intentId, 'logical intent') } : {}),
  };
}
function specification(value) {
  jsonData(value);
  record(value, ['schemaVersion', 'profile', 'cases']);
  requireThat(value.schemaVersion === 1, 'INPUT', 'Unsupported validation specification version');
  const cases = list(value.cases, 'required profile cases').map(test => {
    record(test, ['id', 'conditions', 'expectedDigest', 'executionId',
      'mode', 'owner', 'location', 'checkpoint', 'assertions']);
    strings(test.conditions, 'case AC identities', 10000);
    requireThat(test.conditions.length > 0 &&
      test.conditions.every(item => condition.test(item)),
    'INPUT', 'Each required case needs explicit AC identities');
    choice(test.mode, modes, 'case mode');
    choice(test.owner, owners, 'case owner');
    choice(test.checkpoint, checkpoints, 'case checkpoint');
    const assertions = list(test.assertions, 'required case assertions').map(assertion => {
      record(assertion, ['id', 'selector']);
      return { id: id(assertion.id, 'assertion ID'), selector: selector(assertion.selector) };
    }).sort((left, right) => compare(left.id, right.id));
    unique(assertions.map(assertion => assertion.id), 'case assertion ID');
    unique(assertions.map(assertion => digest(assertion.selector)), 'case selector');
    return { id: id(test.id, 'test ID'), conditions: [...test.conditions].sort(compare),
      expectedDigest: sha(test.expectedDigest, 'expected-result definition'),
      executionId: id(test.executionId, 'expected execution ID'),
      mode: test.mode, owner: test.owner, location: identity(test.location, 'case location'),
      checkpoint: test.checkpoint, assertions };
  }).sort((left, right) => compare(left.id, right.id));
  unique(cases.map(test => test.id), 'required test ID');
  return safeRecord({ schemaVersion: 1, profile: id(value.profile, 'validation profile'), cases },
    LIMITS.artifact);
}
export function validationInventoryDigest(value) {
  return digest(specification(value));
}
function selection(value, spec) {
  jsonData(value);
  record(value, ['profile', 'executions', 'now', 'policy', 'barriers'],
    ['profile', 'executions', 'now', 'policy']);
  record(value.policy, ['maxAgeMs', 'revisionPolicy', 'verifierIds']);
  requireThat(value.policy.maxAgeMs === null ||
    Number.isSafeInteger(value.policy.maxAgeMs) && value.policy.maxAgeMs > 0,
  'INPUT', 'Declare the required freshness policy');
  choice(value.policy.revisionPolicy, ['exact', 'content'], 'source revision policy');
  strings(value.policy.verifierIds, 'trusted verifier IDs', 100);
  value.policy.verifierIds.forEach(value => id(value, 'trusted verifier ID'));
  requireThat(value.policy.verifierIds.length > 0, 'INPUT', 'Declare trusted host verifiers');
  const executions = list(value.executions, 'expected profile executions').map(execution => {
    record(execution, ['id', 'context']);
    return { id: id(execution.id), context: validateExecutionContext(execution.context) };
  }).sort((left, right) => compare(left.id, right.id));
  unique(executions.map(execution => execution.id), 'expected execution ID');
  const inventoryDigest = digest(spec);
  requireThat(value.profile === spec.profile && executions.every(execution =>
    execution.context.profile === spec.profile &&
    execution.context.inventoryDigest === inventoryDigest),
  'EVIDENCE', 'Expected execution inventory/profile differs from the complete specification');
  for (const test of spec.cases) {
    const execution = executions.find(item => item.id === test.executionId);
    requireThat(execution && execution.context.mode === test.mode &&
      execution.context.owner === test.owner && execution.context.location === test.location &&
      execution.context.environment === checkpointEnvironment(test.checkpoint),
    'EVIDENCE', 'Case execution owner/location/checkpoint differs from the expected producer');
  }
  const barriers = list(value.barriers ?? [], 'reset barriers', { empty: true }).map(barrier => {
    record(barrier, ['testId', 'notBefore']);
    requireThat(spec.cases.some(test => test.id === barrier.testId),
      'INPUT', 'Reset barrier names an unknown case');
    return { testId: barrier.testId, notBefore: at(barrier.notBefore, 'reset time') };
  });
  unique(barriers.map(barrier => barrier.testId), 'reset test ID');
  return safeRecord({ profile: spec.profile, executions, now: at(value.now, 'evaluation time'),
    policy: clone(value.policy), barriers }, LIMITS.artifact);
}
function parsePayload(input, { allowText = false } = {}) {
  const bytes = input instanceof Uint8Array ? Buffer.from(input) :
    typeof input === 'string' ? Buffer.from(input, 'utf8') :
    Buffer.from(canonical(validateReadinessData(input)));
  requireThat(bytes.length > 0 && bytes.length <= LIMITS.artifact * 0.7,
    'CAPACITY', 'Execution payload exceeds its encoded immutable-object budget');
  let contents;
  try { contents = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw new SdlcError('EVIDENCE', 'Execution payload must be valid UTF-8');
  }
  let value;
  try { value = JSON.parse(contents); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    requireThat(allowText, 'EVIDENCE', 'A non-JSON producer needs its trusted result adapter');
    value = contents;
  }
  validateReadinessData(value);
  return { value, bytes };
}
function adapters(value) {
  if (value === undefined) return { format: 'sdlc-execution-v1' };
  if (typeof value === 'function') return { format: 'sdlc-execution-v1', verify: value };
  record(value, ['id', 'normalize', 'verify'], []);
  requireThat(value.normalize === undefined || typeof value.normalize === 'function',
    'ADAPTER', 'Result normalization requires a trusted in-process function');
  requireThat(value.verify === undefined || typeof value.verify === 'function',
    'ADAPTER', 'Origin verification requires a trusted in-process function');
  requireThat(!value.normalize || value.id, 'ADAPTER', 'A result adapter needs a stable format ID');
  return { format: value.id ? id(value.id, 'adapter format') : 'sdlc-execution-v1',
    normalize: value.normalize, verify: value.verify };
}
function exitCode(value) {
  requireThat(value === null || Number.isSafeInteger(value) &&
    value >= -128 && value <= 255, 'INPUT', 'Invalid actual command exit');
  return value;
}
function normalizeRow(row, context, report) {
  record(row, ['testId', 'assertionId', 'selector', 'status', 'expectedMet',
    'expectedDigest', 'checkpoint', 'observedAt', 'sourceSequence', 'durationMs', 'exitCode', 'detail'],
  ['testId', 'assertionId', 'selector', 'status', 'expectedMet', 'expectedDigest',
    'checkpoint', 'observedAt', 'sourceSequence', 'durationMs', 'exitCode']);
  choice(row.status, rawOutcomes, 'producer assertion outcome');
  choice(row.checkpoint, checkpoints, 'assertion checkpoint');
  requireThat(context.environment === checkpointEnvironment(row.checkpoint),
    'EVIDENCE', 'Assertion checkpoint differs from the execution environment');
  const conclusive = ['Passed', 'Failed'].includes(row.status);
  requireThat(conclusive ?
    row.expectedMet === (row.status === 'Passed') :
    row.expectedMet === null || row.expectedMet === false,
  'EVIDENCE', 'Producer status contradicts its expected-result evaluation');
  const code = exitCode(row.exitCode);
  requireThat(row.status !== 'Passed' || code === null || code === 0,
    'EVIDENCE', 'A failed command cannot supply a passing assertion');
  requireThat(conclusive ?
    typeof row.durationMs === 'number' && Number.isFinite(row.durationMs) && row.durationMs >= 0 :
    row.durationMs === null || typeof row.durationMs === 'number' &&
      Number.isFinite(row.durationMs) && row.durationMs >= 0,
  'INPUT', 'Capture the actual assertion duration');
  const observedAt = at(row.observedAt, 'assertion source time');
  requireThat(Number.isSafeInteger(row.sourceSequence) && row.sourceSequence > 0 &&
    row.sourceSequence <= report.sequence, 'EVIDENCE', 'Invalid original assertion sequence');
  requireThat(Date.parse(observedAt) >= Date.parse(report.startedAt) &&
    Date.parse(observedAt) <= Date.parse(report.observedAt),
  'EVIDENCE', 'Assertion time is outside its producer observation interval');
  const selected = selector(row.selector);
  if (context.mode !== 'automated') identity(selected.procedure, 'observed procedure');
  if (row.detail !== undefined) text(row.detail, 'assertion diagnostic', LIMITS.artifact);
  return {
    testId: id(row.testId, 'test ID'), assertionId: id(row.assertionId, 'assertion ID'),
    selector: selected, status: conclusive ? row.status : 'NotRun', rawStatus: row.status,
    expectedMet: row.expectedMet, expectedDigest: sha(row.expectedDigest, 'expected-result digest'),
    checkpoint: row.checkpoint, observedAt, durationMs: row.durationMs, exitCode: code,
    sourceSequence: row.sourceSequence,
    executionProducerKey: digest([context.producer, context.jobRef]),
    ...(row.detail !== undefined ? { detail: row.detail.length <= 2000 ? row.detail :
      `${row.detail.slice(0, 1900)}\n[Excerpt; full diagnostic is retained in the producer report]` } : {}),
  };
}
export function normalizeExecutionReport(input, context, verifier) {
  const adapter = adapters(verifier);
  const original = parsePayload(input, { allowText: Boolean(adapter.normalize) });
  const acquired = validateExecutionContext(context);
  const value = adapter.normalize ?
    adapter.normalize(freeze(clone(original.value)), freeze(clone(acquired))) : original.value;
  validateReadinessData(value);
  record(value, ['schemaVersion', 'kind', 'context', 'startedAt', 'finishedAt',
    'observedAt', 'sequence', 'complete', 'exitCode', 'results', 'sourceSummary'],
  ['schemaVersion', 'kind', 'context', 'startedAt', 'finishedAt', 'observedAt',
    'sequence', 'complete', 'exitCode', 'results']);
  requireThat(value.schemaVersion === 1 && value.kind === 'test-execution',
    'EVIDENCE', 'Unsupported execution producer format');
  const actual = validateExecutionContext(value.context);
  const startedAt = at(value.startedAt, 'execution start');
  const observedAt = at(value.observedAt, 'execution observation time');
  const finishedAt = value.finishedAt === null ? null : at(value.finishedAt, 'execution finish');
  requireThat(typeof value.complete === 'boolean' &&
    Number.isSafeInteger(value.sequence) && value.sequence > 0 &&
    Date.parse(observedAt) >= Date.parse(startedAt) &&
    (finishedAt === null || Date.parse(finishedAt) >= Date.parse(startedAt) &&
      Date.parse(finishedAt) <= Date.parse(observedAt)),
  'EVIDENCE', 'Execution timing/completeness is invalid');
  const code = exitCode(value.exitCode);
  requireThat(!value.complete || finishedAt !== null &&
    (code !== null || actual.mode !== 'automated'),
    'EVIDENCE', 'Complete execution needs its actual finish and command exit');
  const sourceObject = {
    schemaVersion: 1, kind: 'execution-bytes', sha256: digest(original.bytes),
    content: original.bytes.toString('base64'),
  };
  const payloadRef = objectReference(sourceObject);
  const rows = list(value.results, 'producer assertion results', { empty: true })
    .map(row => normalizeRow(row, actual, { startedAt, observedAt, sequence: value.sequence }));
  unique(rows.map(row => canonical([row.testId, row.assertionId])), 'producer assertion result');
  const observations = rows.map(row => ({
    id: `observation-${digest({ payloadRef, format: adapter.format, context: actual, ...row })}`,
    ...row,
  })).sort((left, right) => compare(left.testId, right.testId) ||
    compare(left.assertionId, right.assertionId));
  const data = {
    schemaVersion: 1, kind: 'normalized-execution', format: adapter.format,
    context: actual, startedAt, finishedAt, observedAt, sequence: value.sequence,
    complete: value.complete, exitCode: code, payloadRef,
    observations,
    ...(value.sourceSummary !== undefined ? { sourceSummary: clone(value.sourceSummary) } : {}),
  };
  validateReadinessData(data);
  const report = freeze({ id: `execution-${digest(data)}`, ...data });
  let proof = null;
  let verificationGap = 'No trusted host origin verifier was supplied';
  if (adapter.verify) {
    const facts = adapter.verify(freeze({
      reportDigest: sourceObject.sha256, context: clone(acquired),
      claimedContext: clone(actual), sourceTime: observedAt, sourceSequence: value.sequence,
    }));
    if (facts !== null && facts !== undefined) {
      validateReadinessData(facts, LIMITS.decision);
      record(facts, ['verifierId', 'reportDigest', 'context', 'sourceTime', 'sourceSequence']);
      const protectedContext = validateExecutionContext(facts.context);
      const matches = facts.reportDigest === sourceObject.sha256 &&
        canonical(protectedContext) === canonical(acquired) &&
        canonical(protectedContext) === canonical(actual) &&
        at(facts.sourceTime, 'verified source time') === observedAt &&
        facts.sourceSequence === value.sequence &&
        canCreditExecutionIdentity(actual.producer, actual.attemptCapability);
      if (matches) proof = freeze({
        verifierId: id(facts.verifierId, 'host verifier ID'),
        reportDigest: sourceObject.sha256, context: protectedContext,
        sourceTime: observedAt, sourceSequence: value.sequence,
      });
      else verificationGap = 'Host origin facts do not match the claimed execution';
    } else verificationGap = 'The host did not establish this execution origin';
  }
  reports.set(report, { proof, verificationGap, sourceObject,
    normalizedDigest: digest(report) });
  return report;
}
function normalizedReport(value) {
  validateReadinessData(value);
  record(value, ['id', 'schemaVersion', 'kind', 'format', 'context', 'startedAt',
    'finishedAt', 'observedAt', 'sequence', 'complete', 'exitCode', 'payloadRef',
    'observations', 'sourceSummary'],
  ['id', 'schemaVersion', 'kind', 'format', 'context', 'startedAt', 'finishedAt',
    'observedAt', 'sequence', 'complete', 'exitCode', 'payloadRef', 'observations']);
  requireThat(value.kind === 'normalized-execution' && value.schemaVersion === 1,
    'EVIDENCE', 'Normalize producer results before readiness evaluation');
  validateObjectReference(value.payloadRef);
  const { id: reportId, ...data } = value;
  requireThat(reportId === `execution-${digest(data)}`,
    'DIGEST', 'Normalized report identity differs from its immutable contents');
  validateExecutionContext(value.context);
  list(value.observations, 'normalized assertion observations', { empty: true });
  requireThat(typeof value.complete === 'boolean' && Number.isSafeInteger(value.sequence) &&
    value.sequence > 0, 'EVIDENCE', 'Invalid normalized execution state');
  at(value.startedAt, 'normalized execution start');
  at(value.observedAt, 'normalized execution source time');
  if (value.finishedAt !== null) at(value.finishedAt, 'normalized execution finish');
  exitCode(value.exitCode);
  const state = reports.get(value);
  requireThat(!state || state.normalizedDigest === digest(value), 'DIGEST',
    'Normalized report changed after host verification');
  if (!state) {
    for (const observation of value.observations) {
      record(observation, ['id', 'testId', 'assertionId', 'selector', 'status',
        'rawStatus', 'expectedMet', 'expectedDigest', 'checkpoint', 'observedAt',
        'durationMs', 'exitCode', 'sourceSequence', 'executionProducerKey', 'detail'],
      ['id', 'testId', 'assertionId', 'selector', 'status', 'rawStatus', 'expectedMet',
        'expectedDigest', 'checkpoint', 'observedAt', 'durationMs', 'exitCode',
        'sourceSequence', 'executionProducerKey']);
      const normalized = normalizeRow({
        testId: observation.testId, assertionId: observation.assertionId,
        selector: observation.selector, status: observation.rawStatus,
        expectedMet: observation.expectedMet, expectedDigest: observation.expectedDigest,
        checkpoint: observation.checkpoint, observedAt: observation.observedAt,
        sourceSequence: observation.sourceSequence,
        durationMs: observation.durationMs, exitCode: observation.exitCode,
        ...(observation.detail !== undefined ? { detail: observation.detail } : {}),
      }, value.context, value);
      const restored = {
        id: `observation-${digest({ payloadRef: value.payloadRef, format: value.format,
          context: value.context, ...normalized })}`,
        ...normalized,
      };
      requireThat(canonical(restored) === canonical(observation), 'DIGEST',
        'Serialized assertion differs from its normalized source projection');
    }
  }
  return state;
}
function contextMatches(actual, expected, policy) {
  const selection = { storageVersion: 2, candidateDigest: expected.candidateDigest,
    testSpecDigest: expected.testSpecDigest, configDigest: expected.configDigest,
    sources: expected.sources };
  return executionSourceEligible(selection, {
    candidateDigest: actual.candidateDigest, testSpecDigest: actual.testSpecDigest,
    configDigest: actual.configDigest, executionSources: actual.sources,
    executionSourceDigest: digest(actual.sources), environment: actual.environment,
  }, { requireRevision: policy.revisionPolicy === 'exact' }) &&
    canonical({ ...actual, sources: expected.sources }) === canonical(expected);
}
function reportMeaning(report) {
  return digest({
    context: report.context, startedAt: report.startedAt, finishedAt: report.finishedAt,
    observedAt: report.observedAt, sequence: report.sequence, complete: report.complete,
    exitCode: report.exitCode,
    observations: report.observations.map(({ id: observationId, ...row }) => row),
  });
}
function currentSnapshot(candidates, selected) {
  const versions = new Map();
  for (const item of candidates) {
    const key = canonical([item.report.observedAt, item.report.sequence]);
    const version = versions.get(key) ?? { key, items: [], meanings: new Set() };
    version.items.push(item);
    version.meanings.add(reportMeaning(item.report));
    versions.set(key, version);
  }
  const versionRows = [...versions.values()].map(version => {
    const report = version.items[0].report;
    return { id: `version-${digest(version.key)}`, status: 'NotRun',
      observedAt: report.observedAt, sourceSequence: report.sequence,
      executionProducerKey: digest([report.context.producer, report.context.jobRef]),
      key: version.key };
  });
  const latest = reduceTestHistory(versionRows);
  if (!latest) return { current: null, conflict: false };
  const version = versions.get(latest.key);
  if (version.meanings.size !== 1) return { current: null, conflict: true };
  const trusted = item => Boolean(item.state?.proof &&
    selected.policy.verifierIds.includes(item.state.proof.verifierId));
  version.items.sort((left, right) => Number(trusted(right)) - Number(trusted(left)) ||
    compare(left.report.id, right.report.id));
  return { current: version.items[0], conflict: false };
}
export function evaluateReadiness(inputSpecification, observations, context) {
  const spec = specification(inputSpecification);
  const selected = selection(context, spec);
  const inputReports = list(observations, 'normalized execution reports', { empty: true });
  const checked = [];
  let reportBytes = 0;
  for (const report of inputReports) {
    const state = normalizedReport(report);
    reportBytes += Buffer.byteLength(canonical(report));
    requireThat(reportBytes <= MAX_BUNDLE_BYTES, 'CAPACITY',
      'Selected execution reports exceed the combined byte budget');
    checked.push({ report, state });
  }
  const diagnostics = [];
  const blockers = [];
  const producerBlockers = [];
  const results = [];
  const now = Date.parse(selected.now);
  const barriers = Object.fromEntries(selected.barriers.map(barrier => [barrier.testId,
    { sequence: 0, eventSequence: 0, at: barrier.notBefore }]));
  const executionViews = new Map();
  for (const execution of selected.executions) {
    const candidates = checked.filter(item =>
      contextMatches(item.report.context, execution.context, selected.policy));
    const snapshot = currentSnapshot(candidates, selected);
    const view = { report: null, rows: new Map(), history: [], blockers: [] };
    const problem = (code, message, reportId, details = {}) => {
      const value = { code, executionId: execution.id, message,
        ...(reportId ? { reportId } : {}), ...details };
      view.blockers.push(value);
      producerBlockers.push(value);
    };
    if (snapshot.conflict) problem('CONFLICTING_REPORTS',
      'A producer supplied different results at one source version');
    else if (!snapshot.current) problem('MISSING_EXECUTION',
      'No matching execution report exists for this required producer');
    else {
      const { report, state } = snapshot.current;
      if (!state?.proof || !selected.policy.verifierIds.includes(state.proof.verifierId)) {
        problem('ORIGIN_UNVERIFIED',
          state?.verificationGap ?? 'Serialized origin flags are not host verification', report.id);
      } else {
        const age = now - Date.parse(report.observedAt);
        if (age < 0 || selected.policy.maxAgeMs !== null && age > selected.policy.maxAgeMs) {
          problem('STALE_EXECUTION', 'Execution is outside the declared freshness window', report.id);
        } else {
          view.report = report;
          view.history = candidates.filter(item => item.state?.proof &&
            selected.policy.verifierIds.includes(item.state.proof.verifierId) &&
            now >= Date.parse(item.report.observedAt) &&
            (selected.policy.maxAgeMs === null ||
              now - Date.parse(item.report.observedAt) <= selected.policy.maxAgeMs));
          for (const observation of report.observations) {
            const test = spec.cases.find(item => item.executionId === execution.id &&
              item.id === observation.testId);
            if (!test || !test.assertions.some(assertion => assertion.id === observation.assertionId)) {
              problem('UNMAPPED_OBSERVATION',
                'Current-profile output contains an unmapped assertion', report.id,
                { testId: observation.testId, assertionId: observation.assertionId });
              continue;
            }
            const rows = view.rows.get(test.id) ?? [];
            rows.push(observation);
            view.rows.set(test.id, rows);
          }
          if (!report.complete) problem('INCOMPLETE_EXECUTION',
            'The latest producer snapshot is incomplete or interrupted', report.id);
          else if (report.exitCode !== null && report.exitCode !== 0) problem('EXECUTION_FAILED',
            'Producer command exited unsuccessfully', report.id);
        }
      }
    }
    executionViews.set(execution.id, view);
  }
  for (const test of spec.cases) {
    const view = executionViews.get(test.executionId);
    const history = new Map(test.assertions.map(assertion => [assertion.id, []]));
    const caseIssues = [];
    if (view.report) {
      const report = view.report;
      for (const observation of view.rows.get(test.id) ?? []) {
        const assertion = test.assertions.find(item => item.id === observation.assertionId);
        if (!assertion || canonical(assertion.selector) !== canonical(observation.selector) ||
            observation.expectedDigest !== test.expectedDigest ||
            observation.checkpoint !== test.checkpoint) {
          caseIssues.push({ code: 'ASSERTION_MISMATCH', reportId: report.id,
            assertionId: observation.assertionId,
            message: 'Observed selector/expected result is not in the required case binding' });
          continue;
        }
        const age = now - Date.parse(observation.observedAt);
        if (age < 0 || selected.policy.maxAgeMs !== null && age > selected.policy.maxAgeMs) {
          caseIssues.push({ code: 'STALE_ASSERTION', assertionId: assertion.id,
            message: 'The actual assertion event is outside the freshness window' });
          continue;
        }
        const candidates = view.history.flatMap(item => item.report.observations
          .filter(row => row.testId === test.id && row.assertionId === assertion.id &&
            row.expectedDigest === test.expectedDigest && row.checkpoint === test.checkpoint &&
            canonical(row.selector) === canonical(assertion.selector))
          .map(row => ({ report: item.report, observation: row })));
        for (const original of candidates) {
          const row = original.observation;
          const source = original.report;
          const evidence = {
            ...row, status: report.complete && source.complete || row.status === 'Failed' ?
              row.status : 'NotRun',
            candidateDigest: source.context.candidateDigest,
            testSpecDigest: source.context.testSpecDigest, configDigest: source.context.configDigest,
            executionSources: source.context.sources,
            executionSourceDigest: digest(source.context.sources),
            environment: source.context.environment, sourceObservedAt: row.observedAt,
            owner: source.context.owner, host: source.context.location, reportId: source.id,
          };
          if (observationAfterReset({ resultBarriers: barriers }, [], evidence)) {
            history.get(assertion.id).push(evidence);
          }
        }
        const newest = reduceTestHistory(history.get(assertion.id));
        if (newest && (Date.parse(newest.observedAt) > Date.parse(observation.observedAt) ||
            newest.observedAt === observation.observedAt &&
              newest.sourceSequence > observation.sourceSequence)) {
          caseIssues.push({ code: 'REGRESSED_ASSERTION', assertionId: assertion.id,
            message: 'The latest snapshot regressed to an older assertion event' });
        }
      }
    }
    const assertions = test.assertions.map(assertion => {
      const observation = reduceTestHistory(history.get(assertion.id));
      return { id: assertion.id, selector: assertion.selector,
        status: observation?.status ?? 'NotRun',
        rawStatus: observation?.rawStatus ?? null,
        evidenceId: observation?.id ?? null, reportId: observation?.reportId ?? null,
        durationMs: observation?.durationMs ?? null,
        detail: observation?.detail ?? null };
    });
    const status = assertions.some(assertion => assertion.status === 'Failed') ? 'Failed' :
      assertions.every(assertion => assertion.status === 'Passed') && caseIssues.length === 0 ?
        'Passed' : 'NotRun';
    const caseBlockers = [...view.blockers, ...caseIssues];
    if (assertions.some(assertion => assertion.status === 'NotRun')) caseBlockers.push({
      code: 'MISSING_ASSERTIONS', message: 'Required assertions have no current matching passing evidence',
      ids: assertions.filter(assertion => assertion.status === 'NotRun').map(assertion => assertion.id),
    });
    if (status !== 'Passed') blockers.push({ testId: test.id, reasons: caseBlockers });
    results.push({ testId: test.id, conditions: test.conditions, executionId: test.executionId,
      status, assertions, blockers: caseBlockers });
  }
  for (const { report } of checked) {
    if (!selected.executions.some(execution => contextMatches(report.context,
      execution.context, selected.policy))) diagnostics.push({
      code: 'INELIGIBLE_CONTEXT', reportId: report.id,
      message: 'Historical/foreign profile, source, host, toolchain or artifact is not current evidence',
    });
  }
  const counts = {
    required: results.length, passed: results.filter(test => test.status === 'Passed').length,
    failed: results.filter(test => test.status === 'Failed').length,
    notRun: results.filter(test => test.status === 'NotRun').length,
    requiredAssertions: results.reduce((count, test) => count + test.assertions.length, 0),
    failedExecutions: producerBlockers.filter(problem => problem.code === 'EXECUTION_FAILED').length,
  };
  const status = counts.failed > 0 || counts.failedExecutions > 0 ? 'Failed' :
    counts.passed === counts.required && producerBlockers.length === 0 ? 'Passed' : 'NotRun';
  const evaluation = freeze({
    schemaVersion: 1, kind: 'validation-readiness', profile: spec.profile, status,
    exitCode: status === 'Passed' ? 0 : status === 'Failed' ? 1 : 2,
    evaluatedAt: selected.now, specificationDigest: digest(spec),
    contextDigest: digest(selected), inputReportIds: [...new Set(inputReports.map(report => report.id))].sort(compare),
    counts, cases: results, blockers, producerBlockers, diagnostics,
    authority: 'Observational readiness only; no lifecycle, merge, publication or deployment authority',
  });
  jsonData(evaluation, MAX_BUNDLE_BYTES);
  const retainedReports = new Map();
  for (const report of inputReports) {
    const previous = retainedReports.get(report.id);
    if (!previous || reports.get(report)?.proof && !reports.get(previous)?.proof ||
        reports.has(report) && !reports.has(previous)) retainedReports.set(report.id, report);
  }
  evaluations.set(evaluation, freeze({
    spec, context: selected,
    reports: [...retainedReports.values()].map(report =>
      reports.has(report) ? report : freeze(clone(report))),
    digest: digest(evaluation),
  }));
  return evaluation;
}
export function requireReadinessEvaluation(evaluation) {
  const state = evaluations.get(evaluation);
  requireThat(state && state.digest === digest(evaluation), 'EVIDENCE',
    'Re-evaluate inputs before reporting or bundling readiness');
  return state;
}
export function verifiedExecutionReport(report) {
  const state = normalizedReport(report);
  requireThat(state?.proof, 'PROVENANCE', 'A trusted host must verify the original producer');
  return { proof: clone(state.proof), sourceObject: clone(state.sourceObject) };
}
export function refreshReadinessEvaluation(evaluation, { now, barriers }) {
  const state = requireReadinessEvaluation(evaluation);
  const resets = new Map(state.context.barriers.map(barrier => [barrier.testId, barrier]));
  for (const barrier of barriers) {
    const previous = resets.get(barrier.testId);
    if (!previous || Date.parse(previous.notBefore) < Date.parse(barrier.notBefore)) {
      resets.set(barrier.testId, barrier);
    }
  }
  return evaluateReadiness(state.spec, state.reports, {
    ...state.context, now, barriers: [...resets.values()],
  });
}
export function readinessCaseProof(evaluation, testId) {
  const state = requireReadinessEvaluation(evaluation);
  const definition = state.spec.cases.find(test => test.id === testId);
  requireThat(definition, 'INPUT', 'Readiness does not contain the selected managed case');
  const result = evaluation.cases.find(test => test.testId === testId);
  const execution = state.context.executions.find(item => item.id === definition.executionId);
  const candidates = state.reports.filter(report =>
    contextMatches(report.context, execution.context, state.context.policy))
    .map(report => ({ report, state: normalizedReport(report) }));
  const snapshot = currentSnapshot(candidates, state.context).current?.report ?? null;
  const selected = result.assertions.filter(assertion => assertion.evidenceId).map(assertion => {
    const report = state.reports.find(report => report.id === assertion.reportId);
    const observation = report?.observations.find(row => row.id === assertion.evidenceId);
    requireThat(observation && reports.get(report)?.proof, 'PROVENANCE',
      'Managed observations require the original independently verified producer');
    return { reportId: report.id, observationId: observation.id,
      observedAt: observation.observedAt, sourceSequence: observation.sourceSequence,
      startedAt: report.startedAt, completedAt: report.finishedAt };
  });
  const status = result.status === 'Passed' && result.blockers.length ? 'NotRun' : result.status;
  const times = selected.map(item => Date.parse(item.observedAt));
  const originalTime = status !== 'NotRun' && times.length ?
    new Date(Math.max(...times)).toISOString() : snapshot?.observedAt ?? null;
  const conclusive = status !== 'NotRun' && selected.length > 0;
  return {
    definition, context: snapshot?.context ?? execution.context, status,
    blockers: result.blockers, assertions: result.assertions, selected,
    source: snapshot ? {
      sourceObservedAt: originalTime, sourceSequence: conclusive ?
        Math.max(...selected.filter(item => item.observedAt === originalTime)
          .map(item => item.sourceSequence)) : snapshot.sequence,
      executionProducerKey: digest([snapshot.context.producer, snapshot.context.jobRef]),
      sourceStartedAt: conclusive ?
        new Date(Math.min(...selected.map(item => Date.parse(item.startedAt)))).toISOString() :
        snapshot.startedAt,
      sourceCompletedAt: conclusive && selected.every(item => item.completedAt) ?
        new Date(Math.max(...selected.map(item => Date.parse(item.completedAt)))).toISOString() :
        snapshot.finishedAt,
      sourceExpiresAt: state.context.policy.maxAgeMs === null ? null :
        new Date((conclusive ? Math.min(...times) : Date.parse(snapshot.observedAt)) +
          state.context.policy.maxAgeMs).toISOString(),
    } : null,
  };
}
function sourceBytes(value) {
  record(value, ['schemaVersion', 'kind', 'sha256', 'content']);
  requireThat(value.schemaVersion === 1 && value.kind === 'execution-bytes' &&
    typeof value.content === 'string', 'EVIDENCE', 'Invalid retained execution bytes');
  const bytes = Buffer.from(value.content, 'base64');
  requireThat(bytes.toString('base64') === value.content && digest(bytes) === value.sha256,
    'DIGEST', 'Retained producer bytes differ from their original digest');
  parsePayload(bytes, { allowText: true });
  return bytes;
}
export function createEvidenceBundle(evaluation, retainedObjects = []) {
  const state = requireReadinessEvaluation(evaluation);
  list(retainedObjects, 'retained evidence objects', { empty: true, max: MAX_OBJECTS });
  const objects = new Map();
  let total = 0;
  const add = (value, validatedDefinition = false) => {
    if (validatedDefinition) { jsonData(value); safeRecord(value, LIMITS.artifact); }
    else validateReadinessData(value);
    if (value.kind === 'execution-bytes') sourceBytes(value);
    const ref = objectReference(value);
    if (!objects.has(ref.sha256)) {
      total += ref.bytes;
      requireThat(objects.size < MAX_OBJECTS && total <= MAX_BUNDLE_BYTES,
        'CAPACITY', 'Evidence bundle exceeds its object/total-byte budget');
      objects.set(ref.sha256, { ref, value: clone(value) });
    }
    return ref;
  };
  for (const value of retainedObjects) add(value);
  const specificationRef = add({ schemaVersion: 1, kind: 'validation-specification',
    specification: state.spec }, true);
  const contextRef = add({ schemaVersion: 1, kind: 'validation-selection',
    context: state.context }, true);
  const references = state.reports.map(report => {
    const verified = normalizedReport(report);
    if (verified?.sourceObject) add(verified.sourceObject);
    requireThat(objects.has(report.payloadRef.sha256), 'EVIDENCE',
      'Bundle needs the original safe producer bytes, not just a remembered result');
    return add(report);
  });
  const reportRefs = [...new Map(references.map(ref => [ref.sha256, ref])).values()]
    .sort((left, right) => compare(left.sha256, right.sha256));
  const paged = (values, makeValue) => {
    const refs = [];
    for (let from = 0; from < values.length;) {
      let length = Math.min(OUTCOME_PAGE_SIZE, values.length - from);
      while (true) {
        try {
          refs.push(add(makeValue(values.slice(from, from + length), refs.length)));
          break;
        } catch (error) {
          if (!(error instanceof SdlcError) || error.code !== 'CAPACITY' || length === 1) throw error;
          length = Math.max(1, Math.floor(length / 2));
        }
      }
      from += length;
    }
    return refs;
  };
  const summaries = evaluation.cases.map(test => {
    const { assertions, ...summary } = test;
    return {
      ...summary, assertionCount: assertions.length,
      assertionPageRefs: paged(assertions, (values, index) => ({
        schemaVersion: 1, kind: 'readiness-assertions', testId: test.testId, index,
        assertions: values,
      })),
    };
  });
  const pages = paged(summaries, (values, index) => ({
    schemaVersion: 1, kind: 'readiness-page', index, cases: values,
  }));
  const { cases, ...summary } = evaluation;
  const evaluationRef = add({ schemaVersion: 1, kind: 'readiness-summary',
    evaluation: summary, pageRefs: pages }, true);
  const manifest = {
    schemaVersion: 1, kind: 'validation-bundle', specificationRef, contextRef,
    reportRefs, evaluationRef,
    objectRefs: [...objects.values()].map(item => item.ref)
      .sort((left, right) => compare(left.sha256, right.sha256)),
  };
  const manifestRef = objectReference(manifest);
  return freeze({ manifest, manifestRef,
    objects: [...objects.values()].sort((left, right) => compare(left.ref.sha256, right.ref.sha256)) });
}
function retainedBundleObjects(bundle) {
  jsonData(bundle, MAX_BUNDLE_BYTES * 2);
  record(bundle, ['manifest', 'manifestRef', 'objects']);
  validateObjectReference(bundle.manifestRef);
  requireThat(canonical(objectReference(bundle.manifest)) === canonical(bundle.manifestRef),
    'DIGEST', 'Evidence bundle manifest changed');
  record(bundle.manifest, ['schemaVersion', 'kind', 'specificationRef', 'contextRef',
    'reportRefs', 'evaluationRef', 'objectRefs']);
  requireThat(bundle.manifest.schemaVersion === 1 && bundle.manifest.kind === 'validation-bundle',
    'EVIDENCE', 'Unsupported evidence bundle');
  const objects = new Map();
  let total = 0;
  for (const entry of list(bundle.objects, 'bundle objects', { max: MAX_OBJECTS })) {
    record(entry, ['ref', 'value']);
    validateObjectReference(entry.ref);
    jsonData(entry.value);
    requireThat(canonical(objectReference(entry.value)) === canonical(entry.ref) &&
      !objects.has(entry.ref.sha256), 'DIGEST', 'Bundle object is missing, duplicated or corrupt');
    total += entry.ref.bytes;
    requireThat(total <= MAX_BUNDLE_BYTES, 'CAPACITY', 'Evidence bundle exceeds its byte budget');
    objects.set(entry.ref.sha256, entry);
  }
  requireThat(canonical([...objects.values()].map(entry => entry.ref)
    .sort((left, right) => compare(left.sha256, right.sha256))) ===
    canonical(bundle.manifest.objectRefs), 'EVIDENCE', 'Evidence bundle object inventory is incomplete');
  const get = ref => {
    validateObjectReference(ref);
    const entry = objects.get(ref.sha256);
    requireThat(entry && entry.ref.bytes === ref.bytes, 'EVIDENCE', 'Required retained object is unavailable');
    return entry.value;
  };
  const storedSpecification = get(bundle.manifest.specificationRef);
  const storedContext = get(bundle.manifest.contextRef);
  requireThat(storedSpecification.kind === 'validation-specification' &&
    storedContext.kind === 'validation-selection', 'EVIDENCE', 'Bundle specification/context types differ');
  record(storedSpecification, ['schemaVersion', 'kind', 'specification']);
  record(storedContext, ['schemaVersion', 'kind', 'context']);
  const retainedSpec = specification(storedSpecification.specification);
  selection(storedContext.context, retainedSpec);
  for (const entry of objects.values()) {
    if ([bundle.manifest.specificationRef.sha256, bundle.manifest.contextRef.sha256,
      bundle.manifest.evaluationRef.sha256].includes(entry.ref.sha256)) {
      safeRecord(entry.value, LIMITS.artifact);
    } else validateReadinessData(entry.value);
  }
  return { get, retainedSpec, storedSpecification, storedContext };
}
function retainedBundleOutcomes(bundle, { get, retainedSpec }) {
  const prior = get(bundle.manifest.evaluationRef);
  record(prior, ['schemaVersion', 'kind', 'evaluation', 'pageRefs']);
  requireThat(prior.schemaVersion === 1 && prior.kind === 'readiness-summary' &&
    Array.isArray(prior.pageRefs),
    'EVIDENCE', 'Bundle outcome summary is unavailable');
  const retainedCases = [];
  for (const [index, ref] of prior.pageRefs.entries()) {
    const page = get(ref);
    requireThat(page.kind === 'readiness-page' && page.schemaVersion === 1 &&
      page.index === index && Array.isArray(page.cases) &&
      page.cases.length > 0 && page.cases.length <= OUTCOME_PAGE_SIZE,
    'EVIDENCE', 'Bundle outcome page is unavailable or incomplete');
    for (const test of page.cases) {
      const assertions = [];
      for (const [assertionIndex, assertionRef] of test.assertionPageRefs.entries()) {
        const values = get(assertionRef);
        requireThat(values.kind === 'readiness-assertions' && values.schemaVersion === 1 &&
          values.testId === test.testId && values.index === assertionIndex &&
          Array.isArray(values.assertions) && values.assertions.length > 0 &&
          values.assertions.length <= OUTCOME_PAGE_SIZE,
        'EVIDENCE', 'Bundle assertion outcome page is unavailable or misbound');
        assertions.push(...values.assertions);
      }
      const definition = retainedSpec.cases.find(item => item.id === test.testId);
      requireThat(definition && assertions.length === test.assertionCount &&
        canonical(assertions.map(assertion => assertion.id)) ===
          canonical(definition.assertions.map(assertion => assertion.id)),
      'EVIDENCE', 'Retained outcome assertions differ from the complete specification');
      retainedCases.push(test.testId);
    }
  }
  requireThat(canonical(retainedCases) === canonical(retainedSpec.cases.map(test => test.id)) &&
    retainedCases.length === prior.evaluation.counts.required,
  'EVIDENCE', 'Retained outcomes omit a required case');
  return prior;
}
export function validateRetainedEvidenceBundle(bundle) {
  const state = retainedBundleObjects(bundle);
  const reports = bundle.manifest.reportRefs.map(ref => {
    const report = state.get(ref);
    normalizedReport(report);
    sourceBytes(state.get(report.payloadRef));
    return report;
  });
  retainedBundleOutcomes(bundle, state);
  // Integrity replay preserves an admitted history; it does not recreate provider verification.
  return { specification: state.retainedSpec, context: state.storedContext.context, reports };
}
export function readEvidenceBundle(bundle, expected, verifier) {
  const state = retainedBundleObjects(bundle);
  const { get, retainedSpec, storedSpecification, storedContext } = state;
  record(expected, ['specification', 'context']);
  const restored = bundle.manifest.reportRefs.map(ref => {
    const report = get(ref);
    normalizedReport(report);
    const bytes = sourceBytes(get(report.payloadRef));
    let adapter = verifier;
    if (verifier && typeof verifier === 'object' &&
        !['normalize', 'verify', 'id'].some(key => Object.hasOwn(verifier, key))) {
      requireThat(Object.getPrototypeOf(verifier) === Object.prototype &&
        Object.values(Object.getOwnPropertyDescriptors(verifier)).every(field =>
          Object.hasOwn(field, 'value')) && Object.hasOwn(verifier, report.format),
      'ADAPTER', 'Supply the trusted result adapter for this retained producer format');
      adapter = verifier[report.format];
    }
    requireThat(adapters(adapter).format === report.format, 'ADAPTER',
      'Retained data cannot choose or load executable result adapters');
    const rebuilt = normalizeExecutionReport(bytes, report.context, adapter);
    requireThat(rebuilt.id === report.id, 'DIGEST', 'Retained observations differ from original producer bytes');
    return rebuilt;
  });
  const prior = retainedBundleOutcomes(bundle, state);
  return {
    evaluation: evaluateReadiness(expected.specification, restored, expected.context),
    reports: restored, retainedSpecification: storedSpecification.specification,
    retainedContext: storedContext.context,
    historicalSummary: prior.evaluation,
    note: 'Stored verdicts are historical; current readiness requires fresh trusted origin verification',
  };
}
