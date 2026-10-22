import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIMITS, canonical, choice, createSummarySanitizer, digest, id, object, recordLimit, requireThat,
  safeRecord, safeSummary } from './core.mjs';
import { readBytes, readJson, readJsonEntries, safePath } from './files.mjs';
import { validateRecord } from './schemas.mjs';
import { bindCycleCatalog, buildTestCatalog, cycleTests, OUTCOME_PAGE_SIZE,
  readValidationObject, stageValidationObject, validateObjectReference } from './validation-catalog.mjs';
import { MAX_BUNDLE_BYTES, MAX_OBJECTS, validateRetainedEvidenceBundle } from './validation-readiness.mjs';

const views = new WeakMap();
const operationHistories = new WeakMap();
const recordHistories = new WeakMap();
const terminal = new Set(['succeeded', 'failed', 'cancelled', 'not-started']);
const rank = { Passed: 0, NotRun: 1, Failed: 2 };
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const redactedPayloadValue = /^\[redacted(?::[a-f0-9]{64})?\]$/u;
const sensitiveHeader = /^(?:authorization|proxy[-_]authorization|cookie|set[-_]cookie|x[-_]api[-_]key|x[-_]auth[-_]token|x[-_]amz[-_]security[-_]token)$/iu;
const environmentSecret = /(?:^|_)(?:secret|password|passwd|token|jwt|credential|credentials|private_key|access_key|api_key|client_secret)(?:_|$)/iu;

function sensitivePayloadKey(key) {
  const normalized = key.replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
    .replace(/[.-]/gu, '_');
  return sensitiveHeader.test(key) ||
    sensitiveHeader.test(normalized) ||
    /^[A-Za-z_][A-Za-z0-9_]*$/u.test(normalized) && environmentSecret.test(normalized);
}
function unsupportedPayloadFragment(value) {
  if (/["'\\]/u.test(value)) return true;
  return [...value.matchAll(/([A-Za-z_][A-Za-z0-9_.-]*)[ \t]*[:=]/gu)]
    .some(match => sensitivePayloadKey(match[1]));
}
function redactPayloadValue(value) {
  return typeof value === 'string' && redactedPayloadValue.test(value) ?
    value : `[redacted:${digest(value)}]`;
}
function payloadSanitizerState() {
  return { nodes: 0, parsedBytes: 0, scannedCharacters: 0, summarize: createSummarySanitizer() };
}
function checkPayloadWork(state, depth) {
  requireThat(depth <= 32 && ++state.nodes <= 65536, 'CAPACITY',
    'Retained payload exceeds bounded sanitizer structure or decode depth');
}
function payloadJsonEnd(value, start, state) {
  const stack = [];
  let quoted = false;
  let escaped = false;
  for (let index = start; index < value.length; index++) {
    requireThat(++state.scannedCharacters <= LIMITS.artifact * 4, 'CAPACITY',
      'Structured log scanning exceeds bounded sanitizer work');
    const character = value[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') {
        quoted = false;
        if (stack.length === 0) return index;
      }
    } else if (character === '"') quoted = true;
    else if (character === '{' || character === '[') {
      requireThat(stack.length < 32, 'CAPACITY', 'Structured log exceeds bounded JSON depth');
      stack.push(character);
    }
    else if (character === '}' || character === ']') {
      if (stack.pop() !== (character === '}' ? '{' : '[')) return -1;
      if (stack.length === 0) return index;
    }
  }
  return -1;
}
function sanitizePayloadText(value, state = payloadSanitizerState(), depth = 0) {
  requireThat(Buffer.byteLength(value) <= LIMITS.artifact, 'CAPACITY',
    'Retained text exceeds the immutable-object byte budget');
  if (redactedPayloadValue.test(value)) return value;
  let text = '';
  let start = 0;
  for (let index = 0; index < value.length; index++) {
    if (!['{', '[', '"'].includes(value[index])) continue;
    const marker = value.startsWith('[redacted', index) ?
      /^\[redacted(?::[a-f0-9]{64})?\]/u.exec(value.slice(index, index + 80)) : null;
    if (marker) { index += marker[0].length - 1; continue; }
    const end = payloadJsonEnd(value, index, state);
    if (end < 0) {
      requireThat(!unsupportedPayloadFragment(value.slice(index)), 'UNSAFE',
        'Incomplete structured log fragment cannot be safely retained');
      break;
    }
    const fragment = value.slice(index, end + 1);
    state.parsedBytes += Buffer.byteLength(fragment);
    requireThat(state.parsedBytes <= LIMITS.artifact * 4, 'CAPACITY',
      'Embedded payload JSON exceeds bounded decode work');
    let parsed;
    try { parsed = JSON.parse(fragment); }
    catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      requireThat(!unsupportedPayloadFragment(fragment), 'UNSAFE',
        'Unsupported structured log fragment cannot be safely retained');
      index = end;
      continue;
    }
    const sanitized = sanitizeRetainedValue(parsed, state, depth + 1);
    text += value.slice(start, index) +
      (canonical(parsed) === canonical(sanitized) ? fragment : JSON.stringify(sanitized));
    start = end + 1;
    index = end;
  }
  text += value.slice(start);
  const headers = text.replace(
    /(^|\r?\n)([ \t]*(?:Authorization|Proxy-Authorization|Cookie|Set-Cookie|X-API-Key|X-Auth-Token|X-Amz-Security-Token)[ \t]*:[ \t]*)([^\r\n]*(?:\r?\n[ \t]+[^\r\n]*)*)/giu,
    (_, start, name, content) => `${start}${name}${redactPayloadValue(content.trim())}`);
  const assignments = headers.replace(
    /(?<![A-Za-z0-9_])([A-Za-z_][A-Za-z0-9_]*)([ \t]*=[ \t]*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s;&]+)/gu,
    (assignment, name, separator, content) => sensitivePayloadKey(name) ?
      `${name}${separator}${redactPayloadValue(content)}` : assignment);
  return state.summarize(assignments);
}
function sanitizeRetainedValue(value, state = payloadSanitizerState(), depth = 0) {
  checkPayloadWork(state, depth);
  if (typeof value === 'string') return sanitizePayloadText(value, state, depth);
  if (Array.isArray(value)) return value.map(item => sanitizeRetainedValue(item, state, depth + 1));
  if (!value || typeof value !== 'object') return value;
  return state.summarize(Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, sensitivePayloadKey(key) ? redactPayloadValue(item) :
      sanitizeRetainedValue(item, state, depth + 1)])));
}
export function validateRetainedPayload(value) {
  requireThat(canonical(sanitizeRetainedValue(value)) === canonical(value),
    'UNSAFE', 'Retained payload or provenance contains unsupported sensitive content');
}

export function reduceTestHistory(history, { sourceTime = evidence => evidence.observedAt,
  eligible = () => true } = {}) {
  let newest = Number.NEGATIVE_INFINITY;
  let group = [];
  const ids = new Map();
  for (const evidence of history) {
    const prior = ids.get(evidence.id);
    requireThat(!prior || digest(prior) === digest(evidence), 'ID_CONFLICT',
      'Observation identity contains conflicting history');
    if (prior) continue;
    ids.set(evidence.id, evidence);
    if (!eligible(evidence)) continue;
    choice(evidence.status, ['NotRun', 'Passed', 'Failed'], 'test outcome');
    const timestamp = Date.parse(sourceTime(evidence));
    requireThat(Number.isFinite(timestamp), 'EVIDENCE', 'Observation source time is invalid');
    if (timestamp > newest) { newest = timestamp; group = [evidence]; }
    else if (timestamp === newest) group.push(evidence);
  }
  const producers = new Map();
  for (const evidence of group) {
    const direct = !evidence.operationId && !evidence.eventId;
    const producer = evidence.executionProducerKey ? `execution:${evidence.executionProducerKey}` :
      evidence.operationId ? `operation:${evidence.operationId}` :
      evidence.eventId ? `event:${evidence.eventId}` :
        `direct:${digest([evidence.owner ?? null, evidence.host ?? null,
          evidence.executionSourceDigest ?? null])}`;
    const previous = producers.get(producer);
    const tie = item => canonical([producer, item.id, digest(item)]);
    const sequence = item => item.sourceSequence ?? item.sequence ?? 0;
    if (!previous || (direct ?
      sequence(evidence) > sequence(previous) ||
        sequence(evidence) === sequence(previous) &&
          compare(tie(evidence), tie(previous)) > 0 :
      rank[evidence.status] > rank[previous.status] ||
        rank[evidence.status] === rank[previous.status] &&
          compare(tie(evidence), tie(previous)) > 0)) producers.set(producer, evidence);
  }
  return [...producers].sort(([leftKey, left], [rightKey, right]) =>
    rank[left.status] - rank[right.status] ||
      compare(canonical([leftKey, left.id, digest(left)]),
        canonical([rightKey, right.id, digest(right)]))).at(-1)?.[1] ?? null;
}
export function sanitizeExecutionPayload(bytes) {
  requireThat(bytes instanceof Uint8Array && bytes.byteLength <= LIMITS.artifact, 'CAPACITY',
    'Execution payload exceeds the immutable-object byte budget');
  let contents;
  try { contents = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { requireThat(false, 'UNSAFE', 'Execution payload must be supported UTF-8 text or JSON'); }
  requireThat(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(contents),
    'UNSAFE', 'Opaque execution payload cannot be retained safely');
  let value = contents;
  if (/^\s*[\[{]/u.test(contents)) {
    try { value = JSON.parse(contents); }
    catch { requireThat(false, 'JSON', 'Structured execution payload is malformed'); }
  }
  const sanitized = sanitizeRetainedValue(value);
  if (value && typeof value === 'object' && !Array.isArray(value) &&
      Object.hasOwn(value, 'cases')) {
    const reportIdentity = report => Object.fromEntries([
      'cycleId', 'candidateDigest', 'testSpecDigest', 'configDigest', 'executionSources', 'cases',
    ].filter(field => Object.hasOwn(report, field)).map(field => [field, report[field]]));
    requireThat(digest(reportIdentity(value)) === digest(reportIdentity(sanitized)),
      'UNSAFE', 'Sanitization would remove required case identity or assertion proof');
  }
  validateRetainedPayload(sanitized);
  return sanitized;
}
export async function prepareValidationHistory(store, workItemId, active) {
  const history = new Map();
  const evidence = new Map();
  const events = new Map();
  const directory = path.join(store.workPath(workItemId), 'evidence');
  for await (const { name, record } of readJsonEntries(directory, { limit: LIMITS.workingSet + 1 })) {
    if (['test-evidence', 'event'].includes(record.type)) {
      requireThat(record.workItemId === workItemId && record.id === name.slice(0, -5),
        'BINDING', 'Archived evidence or event identity differs from its locator');
      validateRecord(record); safeRecord(record, recordLimit(record));
      (record.type === 'event' ? events : evidence).set(record.id, record);
      continue;
    }
    if (record.type !== 'operation') continue;
    requireThat(record.workItemId === workItemId, 'BINDING', 'Historical operation belongs to another work item');
    requireThat(record.id === name.slice(0, -5) && terminal.has(record.status),
      'OPERATION', 'Historical operation identity or terminal state is invalid');
    validateRecord(record);
    safeRecord(record, recordLimit(record));
    history.set(record.id, record);
  }
  for (const record of active.filter(item => item.type === 'operation')) {
    const archived = history.get(record.id);
    requireThat(!archived || digest(archived) === digest(record), 'ID_CONFLICT',
      'Active and archived operation versions conflict');
  }
  return { operations: history, evidence, events };
}
export async function prepareOperationHistory(store, workItemId, active) {
  return (await prepareValidationHistory(store, workItemId, active)).operations;
}
export function bindOperationHistory(records, history, evidence = new Map()) {
  operationHistories.set(records, history);
  recordHistories.set(records, evidence);
  return records;
}
export function lookupOperation(records, operationId) {
  return records.find(record => record.type === 'operation' && record.id === operationId) ??
    operationHistories.get(records)?.get(operationId);
}
export function allOperationClaims(records) {
  const history = new Map(operationHistories.get(records) ?? []);
  for (const record of records.filter(item => item.type === 'operation')) history.set(record.id, record);
  return [...history.values()];
}
function viewFor(cycle) {
  const view = views.get(cycle);
  requireThat(view, 'EVIDENCE', 'Referenced validation outcomes are not prepared');
  return view;
}
export function cycleResultIds(cycle) {
  return cycle?.storageVersion === 2 ? viewFor(cycle).results : cycle?.results ?? {};
}
export function testResetDigest(cycle, testId) {
  return digest(testResetBarrier(cycle, testId));
}
export function testResetBarrier(cycle, testId) {
  return cycle.storageVersion === 2 ? viewFor(cycle).slots.get(testId)?.barrier ?? null :
    cycle.resultBarriers?.[testId] ?? null;
}
export function validateResetBarrier(barrier) {
  object(barrier, ['sequence', 'eventSequence', 'at', 'operationId', 'eventId'],
    ['sequence', 'eventSequence', 'at']);
  requireThat(Number.isSafeInteger(barrier.sequence) && barrier.sequence >= 0 &&
    Number.isSafeInteger(barrier.eventSequence) && barrier.eventSequence >= 0 &&
    Number.isFinite(Date.parse(barrier.at)), 'EVIDENCE', 'Reset barrier is invalid');
  if (barrier.operationId) id(barrier.operationId);
  if (barrier.eventId) id(barrier.eventId);
  return barrier;
}
export function restoreTestReset(cycle, testId, barrier) {
  validateResetBarrier(barrier);
  if (digest(testResetBarrier(cycle, testId)) === digest(barrier)) return false;
  delete cycleResultIds(cycle)[testId];
  if (cycle.storageVersion === 2) {
    const slot = dirtySlot(cycle, testId);
    slot.selected = null; slot.barrier = structuredClone(barrier);
  } else {
    cycle.resultBarriers ??= {};
    cycle.resultBarriers[testId] = structuredClone(barrier);
  }
  cycle.pendingPlanSync = true;
  return true;
}
export function testHistory(cycle, records, testId) {
  if (cycle.storageVersion === 2) return viewFor(cycle).slots.get(testId)?.history ?? [];
  const history = new Map(recordHistories.get(records) ?? []);
  for (const record of records.filter(item => item.type === 'test-evidence')) {
    const previous = history.get(record.id);
    requireThat(!previous || digest(previous) === digest(record), 'ID_CONFLICT', 'Evidence history identity conflicts');
    history.set(record.id, record);
  }
  return [...history.values()].filter(record => record.cycleId === cycle.id && record.testId === testId);
}
export function lookupTestEvidence(cycle, records, evidenceId) {
  if (!evidenceId) return null;
  return cycle.storageVersion === 2 ? viewFor(cycle).evidence.get(evidenceId) ?? null :
    records.find(record => record.type === 'test-evidence' && record.id === evidenceId) ??
      recordHistories.get(records)?.get(evidenceId) ?? null;
}
export function observationAfterReset(cycle, records, evidence) {
  const barrier = cycle.storageVersion === 2 ?
    viewFor(cycle).slots.get(evidence.testId)?.barrier : cycle.resultBarriers?.[evidence.testId];
  if (!barrier) return true;
  if (evidence.sourceObservedAt !== undefined &&
      (!Number.isFinite(Date.parse(evidence.sourceObservedAt)) ||
        Date.parse(evidence.sourceObservedAt) <= Date.parse(barrier.at))) return false;
  if (evidence.eventId) {
    const event = records.find(record => record.id === evidence.eventId);
    return evidence.eventId === barrier.eventId || Boolean(event && event.sequence > barrier.eventSequence);
  }
  if (evidence.operationId) {
    if (evidence.operationId === barrier.operationId) return true;
    const operation = lookupOperation(records, evidence.operationId);
    return Boolean(operation && Date.parse(operation.dispatchStartedAt ?? operation.createdAt) > Date.parse(barrier.at));
  }
  return (evidence.sequence ?? evidence.sourceSequence ?? 0) > barrier.sequence;
}
export function sameExecutionSources(left, right, { requireRevision = true } = {}) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
    new Set(left.map(source => source.repositoryId)).size === left.length &&
    new Set(right.map(source => source.repositoryId)).size === right.length &&
    left.every(source => right.some(selected =>
      selected.repositoryId === source.repositoryId &&
      selected.contentDigest === source.contentDigest &&
      (!requireRevision || selected.revision === source.revision)));
}
export function executionSourceEligible(cycle, evidence,
  { requireRevision = evidence.environment !== 'local' } = {}) {
  if (!evidence.executionSources) return cycle.storageVersion !== 2;
  return evidence.configDigest === cycle.configDigest &&
    evidence.candidateDigest === cycle.candidateDigest &&
    evidence.testSpecDigest === cycle.testSpecDigest &&
    evidence.executionSourceDigest === digest(evidence.executionSources) &&
    sameExecutionSources(evidence.executionSources, cycle.sources, { requireRevision });
}
export function validateExecutionSource(source, operation) {
  object(source, ['schemaVersion', 'kind', 'workItemId', 'operationId', 'cycleId',
    'candidateDigest', 'testSpecDigest', 'configDigest', 'sources', 'sourceDigest'],
  ['schemaVersion', 'kind', 'workItemId', 'operationId', 'cycleId',
    'candidateDigest', 'testSpecDigest', 'configDigest', 'sources', 'sourceDigest']);
  requireThat(source.schemaVersion === 1 && source.kind === 'execution-source' &&
    source.workItemId === operation.workItemId && source.operationId === operation.id &&
    source.cycleId === operation.cycleId && source.candidateDigest === operation.candidateDigest &&
    Array.isArray(source.sources) && source.sources.length > 0 &&
    source.sourceDigest === digest(source.sources) &&
    /^[a-f0-9]{64}$/u.test(source.testSpecDigest) &&
    typeof source.configDigest === 'string', 'EVIDENCE',
  'Immutable execution source differs from its dispatch identity');
  requireThat(new Set(source.sources.map(item => item.repositoryId)).size === source.sources.length,
    'EVIDENCE', 'Execution source repositories must be unique');
  for (const item of source.sources) {
    object(item, ['repositoryId', 'revision', 'contentDigest'], ['repositoryId', 'revision', 'contentDigest']);
    id(item.repositoryId);
    requireThat(item.revision === null || /^[a-f0-9]{40,64}$/u.test(item.revision),
      'EVIDENCE', 'Execution source requires an exact commit or an explicit unborn revision');
    requireThat(/^[a-f0-9]{64}$/u.test(item.contentDigest), 'EVIDENCE', 'Execution content digest is invalid');
  }
  return source;
}
export function captureOperationExecutionSource(tx, cycle, operation, sources) {
  requireThat(digest(sources) === digest(cycle.sources), 'STALE',
    'Dispatch source selection changed; reselect the current validation cycle');
  const source = validateExecutionSource({
    schemaVersion: 1, kind: 'execution-source', workItemId: operation.workItemId,
    operationId: operation.id, cycleId: cycle.id, candidateDigest: cycle.candidateDigest,
    testSpecDigest: cycle.testSpecDigest, configDigest: cycle.configDigest,
    sources: structuredClone(sources), sourceDigest: digest(sources),
  }, operation);
  const ref = stageValidationObject(tx, source);
  requireThat(!operation.executionSourceRef || digest(operation.executionSourceRef) === digest(ref),
    'STALE', 'Dispatch cannot relabel its immutable original execution source');
  operation.executionSourceRef = ref;
}
function newPage(workItemId, cycleId, index, tests) {
  return { schemaVersion: 1, kind: 'outcome-page', workItemId, cycleId, index,
    slots: tests.map(test => ({ testId: test.id, history: [], historyRef: null,
      events: [], selected: null, barrier: null })) };
}
function rootValue(cycle, pageRefs, previous = null) {
  return { schemaVersion: 1, kind: 'outcome-root', workItemId: cycle.workItemId,
    cycleId: cycle.id, testCatalogRef: cycle.testCatalogRef,
    candidateDigest: cycle.candidateDigest, testSpecDigest: cycle.testSpecDigest,
    configDigest: cycle.configDigest, selectionSources: cycle.sources,
    selectionSourceDigest: digest(cycle.sources), sequence: cycle.lastEvidenceSequence ?? 0,
    localEligibility: 'exact-content-spec-config', pageRefs, previous };
}
function attachView(cycle, pages, pageRefs, root) {
  const slots = new Map(pages.flatMap(page => page.slots.map(slot => [slot.testId, slot])));
  const evidence = new Map([...slots.values()].flatMap(slot => slot.history.map(item => [item.id, item])));
  const results = Object.fromEntries([...slots.values()].filter(slot => slot.selected)
    .map(slot => [slot.testId, slot.selected]));
  const view = { pages, pageRefs, slots, evidence, results, root, prefixes: new Map(),
    dirty: new Set(), dirtyRoot: false };
  views.set(cycle, view);
  return view;
}
export function initializeReferencedCycle(tx, cycle, specification) {
  for (const snapshot of specification.sourceSnapshots ?? []) stageValidationObject(tx, snapshot);
  const catalog = buildTestCatalog(cycle.workItemId, specification);
  cycle.storageVersion = 2;
  cycle.testCatalogRef = stageValidationObject(tx, catalog);
  delete cycle.tests;
  delete cycle.results;
  bindCycleCatalog(cycle, catalog);
  const pages = [];
  for (let index = 0; index < catalog.tests.length; index += OUTCOME_PAGE_SIZE) {
    pages.push(newPage(cycle.workItemId, cycle.id, pages.length,
      catalog.tests.slice(index, index + OUTCOME_PAGE_SIZE)));
  }
  const refs = pages.map(page => stageValidationObject(tx, page));
  const root = rootValue(cycle, refs);
  cycle.testOutcomeRef = stageValidationObject(tx, root);
  attachView(cycle, pages, refs, root);
}
async function prepareRetainedReadinessEvidence(store, cycle, evidence, payload, context) {
  const admission = payload.content;
  if (admission?.kind !== 'normalized-case-admission') return;
  object(admission, ['kind', 'cycleId', 'testId', 'status', 'importRef', 'assertionPageRefs', 'blockers'],
    ['kind', 'cycleId', 'testId', 'status', 'importRef', 'assertionPageRefs', 'blockers']);
  requireThat(admission.cycleId === cycle.id && admission.testId === evidence.testId &&
    admission.status === evidence.status && Array.isArray(admission.assertionPageRefs),
  'EVIDENCE', 'Retained normalized admission differs from its immutable case result');
  const readContent = async ref => {
    const retained = await readValidationObject(store, cycle.workItemId, ref, context);
    requireThat(retained.kind === 'execution-payload' &&
      retained.provenance?.sanitizer === 'sdlc-normalized-v1' &&
      retained.provenance.sourceDigest === digest(retained.content),
    'EVIDENCE', 'Normalized evidence dependency is not its original retained content');
    return retained.content;
  };
  validateObjectReference(admission.importRef);
  const imports = context.normalizedReadinessImports ??= new Map();
  let imported = imports.get(admission.importRef.sha256);
  if (imported) requireThat(imported.bytes === admission.importRef.bytes, 'DIGEST',
    'Normalized import reference length differs from its retained bytes');
  else {
    const retained = await readContent(admission.importRef);
    object(retained, ['kind', 'manifest', 'manifestRef', 'objectMapRefs'],
      ['kind', 'manifest', 'manifestRef', 'objectMapRefs']);
    requireThat(retained.kind === 'normalized-readiness-import' &&
      Array.isArray(retained.manifest?.objectRefs) &&
      retained.manifest.objectRefs.length > 0 &&
      retained.manifest.objectRefs.length <= MAX_OBJECTS &&
      Array.isArray(retained.objectMapRefs) &&
      retained.objectMapRefs.length === Math.ceil(retained.manifest.objectRefs.length / OUTCOME_PAGE_SIZE),
    'EVIDENCE', 'Normalized import has no complete bounded object mapping');
    const objects = [];
    let bytes = 0;
    for (const [index, ref] of retained.objectMapRefs.entries()) {
      const page = await readContent(ref);
      object(page, ['kind', 'index', 'objects'], ['kind', 'index', 'objects']);
      const count = Math.min(OUTCOME_PAGE_SIZE,
        retained.manifest.objectRefs.length - objects.length);
      requireThat(page.kind === 'normalized-object-map' && page.index === index &&
        Array.isArray(page.objects) && page.objects.length === count,
      'EVIDENCE', 'Normalized object-map page is unavailable or incomplete');
      for (const entry of page.objects) {
        object(entry, ['originalRef', 'retainedRef'], ['originalRef', 'retainedRef']);
        validateObjectReference(entry.originalRef);
        bytes += entry.originalRef.bytes;
        requireThat(bytes <= MAX_BUNDLE_BYTES, 'CAPACITY',
          'Normalized import exceeds the retained bundle byte budget');
        objects.push({ ref: entry.originalRef, value: await readContent(entry.retainedRef) });
      }
    }
    imported = { bytes: admission.importRef.bytes,
      ...validateRetainedEvidenceBundle({
        manifest: retained.manifest, manifestRef: retained.manifestRef, objects,
      }) };
    imports.set(admission.importRef.sha256, imported);
  }
  const definition = imported.specification.cases.find(test => test.id === evidence.testId);
  const test = cycleTests(cycle).find(test => test.id === evidence.testId);
  const execution = imported.context.executions.find(item => item.id === definition?.executionId)?.context;
  requireThat(definition && test && definition.expectedDigest === digest(test.expected) &&
    execution && execution.candidateDigest === evidence.candidateDigest &&
    execution.testSpecDigest === evidence.testSpecDigest &&
    execution.configDigest === evidence.configDigest &&
    sameExecutionSources(execution.sources, evidence.executionSources) &&
    admission.assertionPageRefs.length <= Math.ceil(definition.assertions.length / OUTCOME_PAGE_SIZE),
  'EVIDENCE', 'Retained normalized input is not bound to its original managed case');
  const assertions = new Set();
  for (const [index, ref] of admission.assertionPageRefs.entries()) {
    const page = await readContent(ref);
    object(page, ['kind', 'testId', 'index', 'observations'],
      ['kind', 'testId', 'index', 'observations']);
    requireThat(page.kind === 'normalized-case-observations' &&
      page.testId === test.id && page.index === index &&
      Array.isArray(page.observations) && page.observations.length > 0 &&
      page.observations.length <= OUTCOME_PAGE_SIZE,
    'EVIDENCE', 'Normalized admission assertion page is unavailable or misbound');
    for (const selected of page.observations) {
      const report = imported.reports.find(item => item.id === selected.reportId);
      const observation = report?.observations.find(item => item.id === selected.observationId);
      requireThat(observation && observation.testId === test.id &&
        definition.assertions.some(item => item.id === observation.assertionId) &&
        !assertions.has(observation.assertionId) &&
        digest(selected) === digest({
          reportId: report.id, observationId: observation.id,
          observedAt: observation.observedAt, sourceSequence: observation.sourceSequence,
          startedAt: report.startedAt, completedAt: report.finishedAt,
        }),
      'EVIDENCE', 'Normalized admission relabeled or duplicated an original assertion');
      assertions.add(observation.assertionId);
    }
  }
  requireThat(admission.status !== 'Passed' || assertions.size === definition.assertions.length,
    'EVIDENCE', 'Passing normalized admission is missing original assertion proof');
}
export async function prepareCycleEvidence(store, cycle, context) {
  if (cycle.storageVersion !== 2) {
    for (const test of cycleTests(cycle)) {
      for (const evidence of testHistory(cycle, context.all(), test.id)) {
        if (!evidence.retainedPayloadRef) continue;
        const payload = await readValidationObject(store, cycle.workItemId, evidence.retainedPayloadRef, context);
        await prepareRetainedReadinessEvidence(store, cycle, evidence, payload, context);
      }
    }
    return;
  }
  const catalog = await readValidationObject(store, cycle.workItemId, cycle.testCatalogRef, context);
  bindCycleCatalog(cycle, catalog);
  for (const binding of catalog.bindings) if (binding.snapshotRef) {
    await readValidationObject(store, cycle.workItemId, binding.snapshotRef, context);
  }
  const root = await readValidationObject(store, cycle.workItemId, cycle.testOutcomeRef, context);
  object(root, ['schemaVersion', 'kind', 'workItemId', 'cycleId', 'testCatalogRef',
    'candidateDigest', 'testSpecDigest', 'configDigest', 'selectionSources',
    'selectionSourceDigest', 'sequence', 'localEligibility', 'pageRefs', 'previous'],
  ['schemaVersion', 'kind', 'workItemId', 'cycleId', 'testCatalogRef', 'candidateDigest',
    'testSpecDigest', 'configDigest', 'selectionSources', 'selectionSourceDigest',
    'sequence', 'localEligibility', 'pageRefs', 'previous']);
  requireThat(root.schemaVersion === 1 && root.kind === 'outcome-root' &&
    root.cycleId === cycle.id && digest(root.testCatalogRef) === digest(cycle.testCatalogRef) &&
    root.candidateDigest === cycle.candidateDigest && root.testSpecDigest === cycle.testSpecDigest &&
    root.configDigest === cycle.configDigest && digest(root.selectionSources) === digest(cycle.sources) &&
    root.selectionSourceDigest === digest(cycle.sources) &&
    root.sequence === (cycle.lastEvidenceSequence ?? 0) &&
    root.localEligibility === 'exact-content-spec-config' &&
    Array.isArray(root.pageRefs) && root.pageRefs.length === Math.ceil(catalog.tests.length / OUTCOME_PAGE_SIZE),
  'EVIDENCE', 'Outcome root differs from its exact cycle selection or complete catalog');
  const pages = [];
  const prefixes = new Map();
  const ids = new Set();
  const observationIds = new Set();
  const payloads = new Map();
  for (let index = 0; index < root.pageRefs.length; index++) {
    const page = await readValidationObject(store, cycle.workItemId, root.pageRefs[index], context);
    object(page, ['schemaVersion', 'kind', 'workItemId', 'cycleId', 'index', 'slots'],
      ['schemaVersion', 'kind', 'workItemId', 'cycleId', 'index', 'slots']);
    const tests = catalog.tests.slice(index * OUTCOME_PAGE_SIZE, (index + 1) * OUTCOME_PAGE_SIZE);
    requireThat(page.schemaVersion === 1 && page.kind === 'outcome-page' &&
      page.cycleId === cycle.id && page.index === index &&
      Array.isArray(page.slots) && page.slots.length === tests.length,
    'EVIDENCE', 'Outcome page does not cover its exact catalog slots');
    for (let offset = 0; offset < tests.length; offset++) {
      const slot = page.slots[offset];
      object(slot, ['testId', 'history', 'historyRef', 'events', 'selected', 'barrier'],
        ['testId', 'history', 'historyRef', 'events', 'selected', 'barrier']);
      requireThat(slot.testId === tests[offset].id && !ids.has(slot.testId) &&
        Array.isArray(slot.history) && Array.isArray(slot.events), 'EVIDENCE', 'Outcome slots are not a catalog bijection');
      ids.add(slot.testId);
      if (slot.barrier !== null) validateResetBarrier(slot.barrier);
      if (slot.historyRef) {
        const chunks = [];
        let ref = slot.historyRef;
        const seen = new Set();
        while (ref) {
          validateObjectReference(ref);
          requireThat(!seen.has(ref.sha256), 'EVIDENCE', 'Case history contains a reference cycle');
          seen.add(ref.sha256);
          const chunk = await readValidationObject(store, cycle.workItemId, ref, context);
          object(chunk, ['schemaVersion', 'kind', 'workItemId', 'cycleId', 'testId', 'history', 'previous'],
            ['schemaVersion', 'kind', 'workItemId', 'cycleId', 'testId', 'history', 'previous']);
          requireThat(chunk.schemaVersion === 1 && chunk.kind === 'test-history' &&
            chunk.cycleId === cycle.id && chunk.testId === slot.testId &&
            Array.isArray(chunk.history) && chunk.history.length > 0 &&
            chunk.history.length <= OUTCOME_PAGE_SIZE, 'EVIDENCE', 'Case history chunk identity is invalid');
          chunks.push(chunk.history);
          ref = chunk.previous;
        }
        const prefix = chunks.reverse().flat();
        prefixes.set(slot.testId, { ref: slot.historyRef, length: prefix.length });
        slot.history = [...prefix, ...slot.history];
      }
      for (const item of slot.history) {
        requireThat(!observationIds.has(item.id), 'EVIDENCE', 'Duplicate committed observation identity');
        observationIds.add(item.id);
        validateRecord(item); safeRecord(item, LIMITS.record);
        requireThat(item.type === 'test-evidence' && item.workItemId === cycle.workItemId &&
          item.cycleId === cycle.id && item.testId === slot.testId &&
          item.candidateDigest === cycle.candidateDigest && item.testSpecDigest === cycle.testSpecDigest &&
          item.configDigest === cycle.configDigest && Number.isSafeInteger(item.sequence) &&
          item.sequence > 0 && item.sequence <= root.sequence &&
          item.executionSourceDigest === digest(item.executionSources),
        'EVIDENCE', 'Retained observation identity is incomplete or inconsistent');
        if (item.operationId) {
          const operation = lookupOperation(context.all(), item.operationId);
          requireThat(operation && (item.operationDigest === undefined ||
            item.operationDigest === digest(operation)), 'EVIDENCE',
          'Retained observation has no matching authoritative operation proof');
          requireThat(operation.executionSourceRef, 'EVIDENCE',
            'Retained operation evidence has no original dispatch source');
          const source = validateExecutionSource(await readValidationObject(store, cycle.workItemId,
            operation.executionSourceRef, context), operation);
          requireThat(item.executionSourceDigest === source.sourceDigest &&
            digest(item.executionSources) === digest(source.sources) &&
            item.testSpecDigest === source.testSpecDigest && item.configDigest === source.configDigest,
          'EVIDENCE', 'Retained observation relabeled its producer execution source');
        }
        if (item.retainedPayloadRef && !payloads.has(item.retainedPayloadRef.sha256)) {
          const payload = await readValidationObject(store, cycle.workItemId, item.retainedPayloadRef, context);
          await prepareRetainedReadinessEvidence(store, cycle, item, payload, context);
          payloads.set(item.retainedPayloadRef.sha256, payload);
        }
      }
      requireThat(slot.selected === null || slot.history.some(item => item.id === slot.selected),
        'EVIDENCE', 'Selected observation is missing from complete history');
      for (const eventRef of slot.events) {
        const retained = await readValidationObject(store, cycle.workItemId, eventRef, context);
        requireThat(retained.kind === 'result-event' && retained.event?.kind === 'staging-result' &&
          retained.event.effect.testIds?.includes(slot.testId) &&
          retained.event.effect.cycleId === cycle.id, 'EVIDENCE', 'Retained result event differs from its case');
        validateRecord(retained.event);
      }
    }
    pages.push(page);
  }
  requireThat(ids.size === catalog.tests.length, 'EVIDENCE', 'Required catalog slots are missing');
  attachView(cycle, pages, root.pageRefs, root).prefixes = prefixes;
  let previous = root.previous;
  const seen = new Set([cycle.testOutcomeRef.sha256]);
  while (previous) {
    validateObjectReference(previous);
    requireThat(!seen.has(previous.sha256), 'EVIDENCE', 'Outcome history contains a reference cycle');
    seen.add(previous.sha256);
    const historical = await readValidationObject(store, cycle.workItemId, previous, context);
    requireThat(historical.kind === 'outcome-root' && historical.schemaVersion === 1 &&
      historical.cycleId === cycle.id && historical.candidateDigest === cycle.candidateDigest &&
      historical.testSpecDigest === cycle.testSpecDigest &&
      historical.configDigest === cycle.configDigest && Array.isArray(historical.pageRefs) &&
      historical.pageRefs.length === root.pageRefs.length,
    'EVIDENCE', 'Historical outcome root differs from its immutable cycle identity');
    for (const pageRef of historical.pageRefs) {
      const page = await readValidationObject(store, cycle.workItemId, pageRef, context);
      requireThat(page.kind === 'outcome-page' && page.cycleId === cycle.id,
        'EVIDENCE', 'Historical outcome page is unavailable or inconsistent');
    }
    previous = historical.previous;
  }
}
export function stageCycleEvidence(tx, cycle) {
  if (cycle.storageVersion !== 2) return;
  const view = viewFor(cycle);
  if (!view.dirty.size && !view.dirtyRoot && digest(view.root.selectionSources) === digest(cycle.sources)) return;
  for (const index of view.dirty) {
    const page = view.pages[index];
    const slots = page.slots.map(slot => {
      let prefix = view.prefixes.get(slot.testId) ?? { ref: null, length: 0 };
      const through = Math.max(prefix.length, slot.history.length - OUTCOME_PAGE_SIZE);
      for (let from = prefix.length; from < through; from += OUTCOME_PAGE_SIZE) {
        const next = Math.min(through, from + OUTCOME_PAGE_SIZE);
        prefix = { ref: stageValidationObject(tx, {
          schemaVersion: 1, kind: 'test-history', workItemId: cycle.workItemId,
          cycleId: cycle.id, testId: slot.testId, previous: prefix.ref,
          history: slot.history.slice(from, next),
        }), length: next };
      }
      view.prefixes.set(slot.testId, prefix);
      slot.historyRef = prefix.ref;
      return { ...slot, history: slot.history.slice(prefix.length) };
    });
    view.pageRefs[index] = stageValidationObject(tx, { ...page, slots });
  }
  const root = rootValue(cycle, view.pageRefs, cycle.testOutcomeRef);
  cycle.testOutcomeRef = stageValidationObject(tx, root);
  view.root = root; view.dirty.clear(); view.dirtyRoot = false;
  tx.put(cycle);
}
function dirtySlot(cycle, testId) {
  const view = viewFor(cycle);
  requireThat(view.slots.has(testId), 'INPUT', 'Test is not in the complete catalog');
  view.dirty.add(Math.floor(cycleTests(cycle).findIndex(test => test.id === testId) / OUTCOME_PAGE_SIZE));
  view.dirtyRoot = true;
  return view.slots.get(testId);
}
export function appendTestObservation(tx, cycle, evidence) {
  if (cycle.storageVersion !== 2) { tx.put(evidence); return; }
  const slot = dirtySlot(cycle, evidence.testId);
  const previous = slot.history.find(item => item.id === evidence.id);
  requireThat(!previous || digest(previous) === digest(evidence), 'ID_CONFLICT', 'Observation ID reused');
  if (!previous) slot.history.push(evidence);
  viewFor(cycle).evidence.set(evidence.id, evidence);
}
export function selectTestObservation(cycle, testId, evidence) {
  const results = cycleResultIds(cycle);
  const selected = evidence && !evidence.id.startsWith('derived-') ? evidence.id : null;
  if ((results[testId] ?? null) === selected) return;
  if (evidence && !evidence.id.startsWith('derived-')) results[testId] = evidence.id;
  else delete results[testId];
  if (cycle.storageVersion === 2) dirtySlot(cycle, testId).selected = results[testId] ?? null;
}
export function resetCycleResults(tx, cycle, predicate = () => true, { operationId, eventId } = {}) {
  const barrier = { sequence: cycle.lastEvidenceSequence ?? 0,
    eventSequence: tx.checkpoint.policyGeneration, at: new Date(tx.storeClock.now()).toISOString(),
    ...(operationId ? { operationId } : {}), ...(eventId ? { eventId } : {}) };
  for (const test of cycleTests(cycle).filter(predicate)) {
    restoreTestReset(cycle, test.id, barrier);
  }
  cycle.pendingPlanSync = true;
}
export function cycleNeedsEvidenceWrite(cycle) {
  return cycle.storageVersion === 2 && (viewFor(cycle).dirtyRoot ||
    digest(viewFor(cycle).root.selectionSources) !== digest(cycle.sources));
}
export function captureCycleResultEvents(context, cycle, events) {
  if (cycle.storageVersion !== 2) return;
  for (const event of events) {
    if (event.kind !== 'staging-result' || event.effect.cycleId !== cycle.id ||
        event.effect.candidateDigest !== cycle.candidateDigest ||
        event.effect.testSpecDigest !== cycle.testSpecDigest ||
        event.effect.configDigest !== cycle.configDigest) continue;
    const value = { schemaVersion: 1, kind: 'result-event', workItemId: cycle.workItemId, event };
    const ref = { sha256: digest(canonical(value)), bytes: Buffer.byteLength(canonical(value)) };
    for (const testId of event.effect.testIds) {
      const slot = viewFor(cycle).slots.get(testId);
      requireThat(slot, 'EVIDENCE', 'Result event references a case outside its catalog');
      if (slot.events.some(previous => previous.sha256 === ref.sha256)) continue;
      stageValidationObject(context, value);
      dirtySlot(cycle, testId).events.push(ref);
    }
  }
}
export function retainedPayloadReference(ref) {
  validateObjectReference(ref);
  return `validation-evidence:${ref.sha256}:${ref.bytes}`;
}
export async function retainExecutionEvidence(store, tx, input) {
  const cache = tx.retainedPayloads ??= new Map();
  if (cache.has(input.evidenceRef)) return cache.get(input.evidenceRef);
  let payload;
  let ref;
  const match = /^validation-evidence:([a-f0-9]{64}):([1-9]\d*)$/u.exec(input.evidenceRef ?? '');
  if (match) {
    ref = { sha256: match[1], bytes: Number(match[2]) };
    payload = await readValidationObject(store, input.workItemId, ref, tx);
    requireThat(payload.kind === 'execution-payload', 'EVIDENCE', 'Reference is not retained execution evidence');
  } else {
    requireThat(input.evidenceRef?.startsWith('file:'), 'EVIDENCE',
      'Catalog results require retained execution evidence or a local file reference');
    const file = fileURLToPath(new URL(input.evidenceRef));
    const bytes = await readBytes(file, LIMITS.artifact);
    payload = { schemaVersion: 1, kind: 'execution-payload', workItemId: input.workItemId,
      content: sanitizeExecutionPayload(bytes),
      provenance: { sourceDigest: digest(bytes), sanitizer: 'sdlc-text-json-v4',
        reference: sanitizePayloadText(input.evidenceRef) } };
    ref = stageValidationObject(tx, payload);
  }
  const result = { ref, payload, cases: new Map(Array.isArray(payload.content?.cases) ?
    payload.content.cases.map(item => [item.testId, item]) : []) };
  requireThat(!Array.isArray(payload.content?.cases) ||
    result.cases.size === payload.content.cases.length, 'EVIDENCE', 'Execution report has duplicate case IDs');
  cache.set(input.evidenceRef, result);
  return result;
}
export async function bindExecutionEvidence(store, tx, cycle, test, evidence) {
  let operation;
  if (evidence.operationId) {
    operation = lookupOperation(tx.all(), evidence.operationId);
    requireThat(operation?.type === 'operation' && operation.class === 'test' &&
      operation.workItemId === evidence.workItemId && operation.cycleId === cycle.id &&
      operation.candidateDigest === cycle.candidateDigest && operation.action?.testId === test.id &&
      operation.action.environment === test.environment &&
      (evidence.status === 'NotRun' ?
        ['dispatching', 'submitted', 'running', 'cancelled'].includes(operation.status) :
        ['succeeded', 'failed'].includes(operation.status)),
    'EVIDENCE', evidence.status === 'NotRun' ?
      'Nonconclusive evidence requires the exact dispatched test operation' :
      'Terminal operation proof is unavailable');
    if (evidence.status === 'NotRun') evidence.operationState = operation.status;
    if (operation.executionSourceRef) {
      const source = validateExecutionSource(await readValidationObject(store, cycle.workItemId,
        operation.executionSourceRef, tx), operation);
      if (tx.normalizedImports?.has(test.id)) requireThat(
        evidence.configDigest === source.configDigest &&
          sameExecutionSources(evidence.executionSources, source.sources),
        'EVIDENCE', 'Normalized report differs from the original dispatched execution source');
      evidence.configDigest = source.configDigest;
      evidence.executionSources = structuredClone(source.sources);
      evidence.executionSourceDigest = source.sourceDigest;
      requireThat(executionSourceEligible(cycle, evidence), 'STALE',
        'Producer execution source is not eligible for the current candidate/spec/config');
    } else requireThat(cycle.storageVersion !== 2 && terminal.has(operation.status), 'EVIDENCE',
      'Dispatched test evidence requires the original immutable execution source');
  }
  if (tx.normalizedImports?.has(test.id)) {
    requireThat(executionSourceEligible(cycle, evidence, { requireRevision: true }),
      'STALE', 'Normalized execution does not match the current managed source/specification/configuration');
    if (operation) evidence.operationDigest = digest(operation);
    return;
  }
  if (cycle.storageVersion !== 2) return;
  if (!operation) {
    evidence.configDigest = cycle.configDigest;
    evidence.executionSources = structuredClone(cycle.sources);
    evidence.executionSourceDigest = digest(evidence.executionSources);
  }
  if (evidence.status === 'NotRun') return;
  if (operation) {
    evidence.operationDigest = digest(operation);
    evidence.retainedPayloadRef = stageValidationObject(tx, {
      schemaVersion: 1, kind: 'execution-payload', workItemId: cycle.workItemId,
      content: { operationId: operation.id, operationDigest: evidence.operationDigest,
        resultProof: operation.resultProof ?? null },
      provenance: { reference: sanitizePayloadText(operation.evidenceRef ?? ''), sanitizer: 'sdlc-proof-v2' },
    });
  } else if (evidence.eventId) {
    const event = tx.get(evidence.eventId);
    requireThat(event?.type === 'event', 'PROVENANCE', 'Captured execution result is unavailable');
    evidence.retainedPayloadRef = stageValidationObject(tx, {
      schemaVersion: 1, kind: 'execution-payload', workItemId: cycle.workItemId,
      content: { eventId: event.id, eventDigest: event.digest },
      provenance: { reference: `receipt:${event.sourceReceiptId}`, sanitizer: 'sdlc-proof-v1' },
    });
  } else {
    const retained = await retainExecutionEvidence(store, tx, evidence);
    const report = retained.payload.content;
    const result = retained.cases.get(test.id);
    requireThat(report && report.cycleId === cycle.id &&
      report.candidateDigest === cycle.candidateDigest &&
      report.testSpecDigest === cycle.testSpecDigest && report.configDigest === cycle.configDigest &&
      digest(report.executionSources) === digest(cycle.sources) && result &&
      result.status === evidence.status && result.expectedMet === evidence.expectedMet &&
      result.resetDigest === testResetDigest(cycle, test.id) &&
      result.expectedDigest === digest(test.expected) && Array.isArray(result.assertions) &&
      result.assertions.length > 0 && result.assertions.every(assertion =>
        typeof assertion.name === 'string' && assertion.name.trim() && typeof assertion.passed === 'boolean') &&
      result.assertions.every(assertion => assertion.passed) === (evidence.status === 'Passed'),
    'EVIDENCE', 'Execution report must contain this exact case, assertion outcomes and source/spec/config identity');
    evidence.retainedPayloadRef = retained.ref;
    evidence.evidenceRef = retainedPayloadReference(retained.ref);
    evidence.id = `evidence-${digest({ cycleId: cycle.id, testId: test.id,
      payload: retained.ref.sha256 }).slice(0, 40)}`;
  }
  safeRecord(evidence, LIMITS.record);
}
export async function retainTestEvidence(store, input) {
  object(input, ['workItemId', 'evidenceRef'], ['workItemId', 'evidenceRef']);
  return store.transaction(input.workItemId, async tx => {
    const { ref } = await retainExecutionEvidence(store, tx, input);
    return { evidenceRef: retainedPayloadReference(ref), ref };
  });
}
export async function readTestEvidence(store, input) {
  object(input, ['workItemId', 'cycleId', 'testId'], ['workItemId', 'cycleId', 'testId']);
  id(input.cycleId); id(input.testId);
  const state = await store.load(input.workItemId);
  let cycle = state.records.find(record => record.type === 'cycle' && record.id === input.cycleId);
  const historicalOnly = !cycle || cycle.id !== state.checkpoint.validationCycleRef;
  if (!cycle) {
    cycle = await readJson(path.join(store.workPath(input.workItemId), 'evidence', `${input.cycleId}.json`),
      { limit: LIMITS.workingSet + 1 });
    validateRecord(cycle); safeRecord(cycle, recordLimit(cycle));
    requireThat(cycle.type === 'cycle' && cycle.id === input.cycleId &&
      cycle.workItemId === input.workItemId, 'BINDING', 'Historical cycle identity differs');
    const context = { ...state, all: () => state.records };
    await prepareCycleEvidence(store, cycle, context);
  }
  const test = cycleTests(cycle).find(item => item.id === input.testId);
  requireThat(test, 'INPUT', 'Test is not part of this complete specification');
  const { currentTestEvidence } = await import('./authority.mjs');
  const history = testHistory(cycle, state.records, test.id);
  return { cycleId: cycle.id, testId: test.id, historicalOnly,
    status: historicalOnly ? 'NotRun' :
      currentTestEvidence(cycle, state.records, test, store.clock)?.status ?? 'NotRun',
    observations: history, sourceSelection: cycle.sources,
    reportedEvents: cycle.storageVersion === 2 ? await Promise.all(viewFor(cycle).slots.get(test.id).events
      .map(async ref => (await readValidationObject(store, input.workItemId, ref)).event)) : [],
    note: historicalOnly ? 'Historical observations do not confer current readiness or authority.' :
      'Current status is reduced from complete committed evidence.' };
}
