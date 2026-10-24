import path from 'node:path';
import { LIMITS, budget, canonical, choice, digest, id, object, parseJson,
  requireThat, safeRecord, text } from './core.mjs';
import { atomicWrite, canonicalPath, exists, readBytes } from './files.mjs';
import { sameNativePath } from './platform.mjs';
import { STAGING_OWNERS } from './staging.mjs';
import { validateRetainedPayload } from './validation-evidence.mjs';

const catalogs = new WeakMap();
const hashPattern = /^[a-f0-9]{64}$/u;
export const OUTCOME_PAGE_SIZE = 64;

export function validateObjectReference(ref) {
  object(ref, ['sha256', 'bytes'], ['sha256', 'bytes']);
  requireThat(hashPattern.test(ref.sha256) && Number.isSafeInteger(ref.bytes) &&
    ref.bytes > 0 && ref.bytes <= LIMITS.artifact, 'SCHEMA', 'Invalid immutable validation reference');
  return ref;
}
export function validationObjectPath(store, workItemId, ref) {
  validateObjectReference(ref);
  return path.join(store.workPath(workItemId), 'validation', 'objects', `${ref.sha256}.json`);
}
export function objectReference(value) {
  const bytes = Buffer.from(canonical(value));
  budget(value, LIMITS.artifact, 'Immutable validation object');
  return { sha256: digest(bytes), bytes: bytes.length };
}
export function stageValidationObject(context, value) {
  validateSafeObject(value);
  const ref = objectReference(value);
  requireThat(context.validationObjects instanceof Map, 'RECOVERY',
    'Validation object staging requires a prepared transaction');
  context.validationObjects.set(ref.sha256, Buffer.from(canonical(value)));
  return ref;
}
export async function readValidationObject(store, workItemId, ref, context) {
  validateObjectReference(ref);
  const cached = context?.validationReadObjects?.get(ref.sha256);
  if (cached) {
    requireThat(cached.bytes === ref.bytes, 'DIGEST', 'Reference length differs from checked object bytes');
    return structuredClone(cached.value);
  }
  const file = validationObjectPath(store, workItemId, ref);
  requireThat(sameNativePath(await canonicalPath(file), file), 'PATH',
    'Validation storage cannot traverse links');
  const bytes = context?.validationObjects?.get(ref.sha256) ??
    await readBytes(file, LIMITS.artifact);
  requireThat(bytes.length === ref.bytes && digest(bytes) === ref.sha256,
    'DIGEST', 'Immutable validation object bytes differ from their reference');
  let contents;
  try { contents = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { requireThat(false, 'JSON', 'Validation objects require valid UTF-8'); }
  const value = parseJson(contents, LIMITS.artifact);
  requireThat(value.workItemId === workItemId, 'BINDING',
    'Immutable validation object belongs to another work item');
  validateSafeObject(value);
  if (context) {
    context.validationReadObjects ??= new Map();
    context.validationReadObjects.set(ref.sha256, { bytes: bytes.length, value: structuredClone(value) });
  }
  return value;
}
function validateSafeObject(value) {
  if (value.kind === 'execution-payload') {
    budget(value, LIMITS.artifact, 'Retained execution payload');
    validateRetainedPayload(value);
  } else safeRecord(value, LIMITS.artifact);
}
export async function flushValidationObjects(store, workItemId, context) {
  for (const [sha256, bytes] of context.validationObjects) {
    const ref = { sha256, bytes: bytes.length };
    const file = validationObjectPath(store, workItemId, ref);
    if (await exists(file)) await readValidationObject(store, workItemId, ref);
    else {
      await atomicWrite(file, bytes);
      await readValidationObject(store, workItemId, ref);
    }
    await store.fault('validation:object');
  }
}
export function validateTestDefinitions(tests, { inline = false, requireUnitFirst = true } = {}) {
  requireThat(typeof requireUnitFirst === 'boolean', 'INPUT', 'Invalid definition validation policy');
  requireThat(Array.isArray(tests) && tests.length > 0 &&
    (!inline || tests.length <= 100), 'INPUT',
  inline ? 'Provide 1..100 required test definitions' : 'Provide complete required test definitions');
  requireThat(new Set(tests.map(test => test.id)).size === tests.length, 'INPUT', 'Duplicate test ID');
  for (const test of tests) {
    object(test, ['id', 'environment', 'level', 'checkpoint', 'mode', 'owner',
      'location', 'implementation', 'expected'],
    ['id', 'environment', 'level', 'checkpoint', 'mode', 'owner', 'location', 'implementation', 'expected']);
    id(test.id);
    choice(test.environment, ['local', 'DEV', 'STAGING'], 'test environment');
    choice(test.checkpoint, ['pre-review', 'review', 'post-review', 'DEV', 'STAGING'], 'test checkpoint');
    requireThat((test.environment === 'DEV') === (test.checkpoint === 'DEV') &&
      (test.environment === 'STAGING') === (test.checkpoint === 'STAGING') &&
      (test.environment === 'local') === ['pre-review', 'review', 'post-review'].includes(test.checkpoint),
    'INPUT', 'Test checkpoint must match its execution environment');
    choice(test.mode, ['automated', 'semi-automated', 'manual'], 'test mode');
    choice(test.owner, STAGING_OWNERS, 'test execution owner');
    for (const field of ['level', 'location', 'implementation']) text(test[field], field, 500);
    text(test.expected, 'expected', 2000);
    if (test.mode === 'manual') requireThat(test.owner === 'user', 'HOST', 'Manual tests belong to the user');
  }
  requireThat(!requireUnitFirst || tests.some(test => test.checkpoint === 'pre-review' && test.level === 'unit'),
    'INPUT', 'The required pre-Review local sequence must begin with unit tests');
}
export function buildTestCatalog(workItemId, specification) {
  id(workItemId);
  validateTestDefinitions(specification.tests);
  const catalog = { schemaVersion: 1, kind: 'test-catalog', workItemId,
    testSpecDigest: specification.digest, bindings: specification.bindings,
    traceability: specification.traceability ?? specification.tests.map(test =>
      ({ testId: test.id, requirements: [], conditions: [] })),
    tests: [...specification.tests].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) };
  validateTestCatalog(catalog, workItemId);
  safeRecord(catalog, LIMITS.artifact);
  return catalog;
}
export function validateTestCatalog(catalog, workItemId) {
  object(catalog, ['schemaVersion', 'kind', 'workItemId', 'testSpecDigest', 'bindings', 'traceability', 'tests'],
    ['schemaVersion', 'kind', 'workItemId', 'testSpecDigest', 'bindings', 'traceability', 'tests']);
  requireThat(catalog.schemaVersion === 1 && catalog.kind === 'test-catalog',
    'SCHEMA', 'Unsupported test catalog');
  requireThat(catalog.workItemId === workItemId, 'BINDING', 'Catalog belongs to another work item');
  requireThat(hashPattern.test(catalog.testSpecDigest) && Array.isArray(catalog.bindings) &&
    catalog.bindings.length > 0 && Array.isArray(catalog.traceability), 'SCHEMA', 'Invalid catalog source bindings');
  validateTestDefinitions(catalog.tests);
  requireThat(catalog.traceability.length === catalog.tests.length &&
    new Set(catalog.traceability.map(item => item.testId)).size === catalog.tests.length &&
    catalog.traceability.every(item => catalog.tests.some(test => test.id === item.testId) &&
      Array.isArray(item.requirements) && Array.isArray(item.conditions)),
  'SCHEMA', 'Catalog traceability must cover every execution ID exactly');
  requireThat(catalog.tests.every((test, index) => !index ||
    catalog.tests[index - 1].id < test.id), 'SCHEMA', 'Catalog IDs must have deterministic unique ordering');
  return catalog;
}
export function bindCycleCatalog(cycle, catalog) {
  validateTestCatalog(catalog, cycle.workItemId);
  requireThat(catalog.testSpecDigest === cycle.testSpecDigest, 'STALE', 'Catalog specification differs from its cycle');
  catalogs.set(cycle, catalog);
}
export function cycleCatalog(cycle) {
  const catalog = catalogs.get(cycle);
  requireThat(catalog, 'EVIDENCE', 'Referenced validation catalog is not prepared');
  return catalog;
}
export function cycleTests(cycle) {
  if (!cycle) return [];
  return cycle.storageVersion === 2 ? cycleCatalog(cycle).tests : cycle.tests;
}
export function catalogBindingDigest(specification) {
  return digest(specification.bindings.map(({ snapshotRef, ...binding }) => binding));
}
export function requireCatalogSpecification(cycle, specification) {
  if (cycle.storageVersion !== 2) return;
  requireThat(cycle.testSpecDigest === specification.digest &&
    catalogBindingDigest(cycleCatalog(cycle)) === catalogBindingDigest(specification),
  'STALE', 'Canonical catalog source or specification changed; restart validation');
}
