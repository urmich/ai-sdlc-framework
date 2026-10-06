import { canonical, digest, requireThat } from './core.mjs';
import { normalizeToolName } from './platform.mjs';

const SHELL_TOOLS = new Set(['bash', 'powershell', 'cmd']);
export const MAPPABLE_FIELDS = new Set([
  'target', 'environment', 'configDigest', 'provider', 'pipeline',
  'remoteUrlDigest', 'sourceRef', 'targetRef', 'sourceRevision',
  'targetRevision', 'baseRef', 'draft', 'artifactId', 'deploymentId',
  'policyVersion', 'prRecordId', 'testId', 'force', 'delete',
  'recipient', 'contentDigest', 'remoteRepositoryURL',
  'sourceRepositoryURL', 'prId', 'paths', 'stages',
  'implicitEnvironments', 'toolOptions', 'preservesChanges',
]);
const BOOLEAN_FIELDS = new Set(['draft', 'force', 'delete', 'preservesChanges']);
const ARRAY_FIELDS = new Set(['paths', 'stages', 'implicitEnvironments']);
const TYPES = new Set(['string', 'number', 'integer', 'boolean', 'null',
  'object', 'array']);

function plain(value) {
  return value !== null && typeof value === 'object' &&
    !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function json(value) {
  canonical(value);
  return value;
}

function typeMatches(value, type) {
  switch (type) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return Number.isSafeInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    case 'object': return plain(value);
    case 'array': return Array.isArray(value);
    default: return false;
  }
}

function validateRule(rule, nested = false) {
  requireThat(plain(rule), 'CONFIG', 'Argument rule must be an object');
  const allowed = ['required', 'value', 'type', 'values', 'properties',
    'items', 'actionField'];
  requireThat(Object.keys(rule).every(key => allowed.includes(key)),
    'CONFIG', 'Unknown argument rule field');
  requireThat(rule.required === undefined || typeof rule.required === 'boolean',
    'CONFIG', 'Argument required flag must be boolean');
  requireThat(rule.actionField === undefined ||
    (!nested && MAPPABLE_FIELDS.has(rule.actionField)), 'CONFIG',
  'Argument mapping must name a top-level effect field');
  const hasValue = Object.hasOwn(rule, 'value');
  const hasValues = Object.hasOwn(rule, 'values');
  requireThat(Number(hasValue) + Number(hasValues) +
    Number(rule.type !== undefined) === 1, 'CONFIG',
  'Argument rule must declare exactly one of value, values, or type');
  if (hasValue) json(rule.value);
  if (hasValues) {
    requireThat(Array.isArray(rule.values) && rule.values.length > 0,
      'CONFIG', 'Allowed argument values must be a nonempty array');
    for (const entry of rule.values) json(entry);
    requireThat(new Set(rule.values.map(value => canonical(value))).size ===
      rule.values.length, 'CONFIG', 'Duplicate allowed argument values');
  }
  if (rule.type !== undefined) requireThat(TYPES.has(rule.type),
    'CONFIG', 'Unsupported argument type');
  if (rule.properties !== undefined) {
    requireThat(rule.type === 'object' && plain(rule.properties),
      'CONFIG', 'Nested properties require an object type');
    for (const child of Object.values(rule.properties)) validateRule(child, true);
  }
  if (rule.items !== undefined) {
    requireThat(rule.type === 'array', 'CONFIG',
      'Array items require an array type');
    validateRule(rule.items, true);
    requireThat(rule.items.required === undefined, 'CONFIG',
      'An array item cannot be optional');
  }
  if (rule.type === 'object') requireThat(rule.properties !== undefined,
    'CONFIG', 'Object arguments require recursive declared properties');
  if (rule.type === 'array') requireThat(rule.items !== undefined,
    'CONFIG', 'Array arguments require recursive declared items');
  if (rule.actionField) {
    const matchesField = value => rule.actionField === 'toolOptions' ?
      plain(value) : ARRAY_FIELDS.has(rule.actionField) ?
        Array.isArray(value) && value.every(item => typeof item === 'string') :
        BOOLEAN_FIELDS.has(rule.actionField) ? typeof value === 'boolean' :
          typeof value === 'string' && value.length > 0;
    requireThat(hasValue ? matchesField(rule.value) :
      hasValues ? rule.values.every(matchesField) :
        rule.actionField === 'toolOptions' ? rule.type === 'object' :
          ARRAY_FIELDS.has(rule.actionField) ? rule.type === 'array' &&
            rule.items.type === 'string' :
            BOOLEAN_FIELDS.has(rule.actionField) ?
              rule.type === 'boolean' : rule.type === 'string',
    'CONFIG', 'Mapped argument type must agree with its action field');
  }
  if (!nested && !hasValue && rule.actionField === undefined) {
    requireThat(false, 'CONFIG',
      'Variable arguments must be mapped into the action');
  }
  if (!nested && rule.required !== true && rule.actionField === undefined) {
    requireThat(false, 'CONFIG',
      'Optional arguments must be mapped into the action');
  }
}

function valueMatches(rule, value) {
  if (Object.hasOwn(rule, 'value')) return canonical(rule.value) === canonical(value);
  if (Object.hasOwn(rule, 'values')) return rule.values.some(option =>
    canonical(option) === canonical(value));
  if (!typeMatches(value, rule.type)) return false;
  if (rule.type === 'object') return objectMatches(rule.properties, value);
  if (rule.type === 'array') return value.every(item => valueMatches(rule.items, item));
  return true;
}

function objectMatches(properties, args) {
  return Object.keys(args).every(key => Object.hasOwn(properties, key)) &&
    Object.entries(properties).every(([key, rule]) =>
      Object.hasOwn(args, key) ? valueMatches(rule, args[key]) :
        rule.required !== true);
}

function adapterContract(adapter) {
  requireThat(plain(adapter) && typeof adapter.toolName === 'string' &&
    adapter.toolName.length > 0 && plain(adapter.action) &&
    typeof adapter.action.class === 'string', 'CONFIG',
  'Tool adapter needs a tool name and action');
  requireThat(Object.keys(adapter).every(key =>
    ['toolName', 'match', 'arguments', 'action'].includes(key)),
  'CONFIG', 'Unknown tool adapter field');
  requireThat(Object.hasOwn(adapter, 'match') !==
    Object.hasOwn(adapter, 'arguments'), 'CONFIG',
  'Declare either exact legacy match or an argument contract');
  if (Object.hasOwn(adapter, 'match')) {
    requireThat(plain(adapter.match), 'CONFIG',
      'Legacy match must be an exact complete argument object');
    json(adapter.match);
  } else {
    requireThat(plain(adapter.arguments), 'CONFIG',
      'Argument contract must declare every accepted field');
    for (const rule of Object.values(adapter.arguments)) validateRule(rule);
  }

}

export function validateToolAdapter(adapter) {
  adapterContract(adapter);
  return adapter;
}

function matchedAction(adapter, args) {
  adapterContract(adapter);
  if (Object.hasOwn(adapter, 'match')) {
    if (canonical(adapter.match) !== canonical(args)) return null;
    return { action: adapter.action, meaning: { match: adapter.match } };
  }
  if (!objectMatches(adapter.arguments, args)) return null;
  const action = { ...adapter.action };
  const mapping = {};
  for (const [argument, rule] of Object.entries(adapter.arguments)) {
    if (!Object.hasOwn(args, argument) || !rule.actionField) continue;
    const field = rule.actionField;
    if (Object.hasOwn(action, field) &&
        canonical(action[field]) !== canonical(args[argument])) return null;
    action[field] = args[argument];
    mapping[argument] = field;
  }
  return { action, meaning: { mapping } };
}

// Shell commands are classified separately by the parent command parser.
export function classifyToolArguments(toolName, args, adapters, {
  repositoryId, protectedAction,
} = {}) {
  requireThat(typeof toolName === 'string' && toolName.length > 0 &&
    Array.isArray(adapters), 'INPUT', 'Expected a tool name and adapter list');
  const normalizedToolName = normalizeToolName(toolName);
  if (SHELL_TOOLS.has(normalizedToolName) ||
      normalizedToolName === 'ambiguous-shell') {
    return { status: 'unmanaged', reason: 'shell-requires-command-classification' };
  }
  if (!plain(args)) return { status: 'unmanaged', reason: 'arguments-not-an-object' };
  try { json(args); } catch {
    return { status: 'unmanaged', reason: 'non-json-arguments' };
  }
  const matches = [];
  for (const adapter of adapters) {
    if (adapter.toolName !== toolName) continue;
    const found = matchedAction(adapter, args);
    if (found) matches.push(found);
  }
  if (!matches.length) return { status: 'unmanaged', reason: 'no-full-argument-match' };
  const classified = matches.map(({ action, meaning }) => {
    const result = { ...action };
    if (repositoryId !== undefined) {
      requireThat(!Object.hasOwn(result, 'repositoryId') ||
        result.repositoryId === repositoryId, 'CONFIG',
      'Adapter cannot change the bound repository');
      result.repositoryId = repositoryId;
    }
    return { action: result, meaning };
  });
  if (protectedAction && classified.some(({ action }) =>
    canonical(action) !== canonical(protectedAction))) {
    return { status: 'conflict', reason: 'adapter-relabels-protected-action',
      protectedActionDigest: digest(protectedAction),
      matches: classified.map(({ action, meaning }) => ({
        actionDigest: digest(action), meaningDigest: digest(meaning),
      })) };
  }
  if (classified.some(({ action, meaning }) =>
    canonical(action) !== canonical(classified[0].action) ||
    canonical(meaning) !== canonical(classified[0].meaning))) {
    return { status: 'conflict', reason: 'adapters-disagree',
      matches: classified.map(({ action, meaning }) => ({
        actionDigest: digest(action), meaningDigest: digest(meaning),
      })) };
  }
  const action = JSON.parse(JSON.stringify(classified[0].action));
  const argumentDigest = digest(args);
  return { status: 'matched', action, argumentDigest,
    actionDigest: digest(action) };
}
