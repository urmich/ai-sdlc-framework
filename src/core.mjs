import { createHash, randomUUID } from 'node:crypto';

export const LIMITS = Object.freeze({
  checkpoint: 16 * 1024, context: 1536, record: 4096,
  decision: 64 * 1024,
  workingSet: 256 * 1024, input: 1024 * 1024, artifact: 4 * 1024 * 1024,
  unresolved: 20, blockers: 20,
});
export const PHASES = ['requirements', 'test-design', 'technical-design', 'coding'];
export class SdlcError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'SdlcError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
export function requireThat(condition, code, message, details) {
  if (!condition) throw new SdlcError(code, message, details);
}
export function object(value, allowed, required = []) {
  requireThat(value && typeof value === 'object' && !Array.isArray(value), 'INPUT', 'Expected a JSON object');
  for (const key of Object.keys(value)) {
    requireThat(allowed.includes(key), 'INPUT', `Unknown field: ${key}`);
  }
  for (const key of required) requireThat(value[key] !== undefined, 'INPUT', `Missing field: ${key}`);
  return value;
}
export function text(value, label, max = 512) {
  requireThat(typeof value === 'string' && value.trim().length > 0 &&
    value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value),
  'INPUT', `Invalid ${label}`);
  return value;
}
export function id(value, label = 'identifier') {
  text(value, label, 100);
  requireThat(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(value) && value !== '.' && value !== '..', 'INPUT', `Invalid ${label}`);
  return value;
}
export function choice(value, values, label) {
  requireThat(values.includes(value), 'INPUT', `Invalid ${label}; expected ${values.join(', ')}`);
  return value;
}
export function strings(value, label, max = 100) {
  requireThat(Array.isArray(value) && value.length <= max && value.every(v => typeof v === 'string'), 'INPUT', `Invalid ${label}`);
  value.forEach(v => text(v, label));
  requireThat(new Set(value).size === value.length, 'INPUT', `Duplicate ${label}`);
  return value;
}
export function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    requireThat(Number.isFinite(value), 'INPUT', 'Non-finite JSON number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  requireThat(value && Object.getPrototypeOf(value) === Object.prototype, 'INPUT', 'Only plain JSON data is supported');
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
export function digest(value) {
  return createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
}
export function byteSize(value) { return Buffer.byteLength(canonical(value)); }
export function budget(value, limit, label) {
  requireThat(byteSize(value) <= limit, 'CAPACITY', `${label} exceeds ${limit} UTF-8 bytes; no data was truncated`);
  return value;
}
export function safeRecord(value, limit = LIMITS.record) {
  const serialized = canonical(value);
  requireThat(!/(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:ghp|github_pat)_[a-zA-Z0-9_]{20,}|(?:password|accessToken|clientSecret|authorization)["']?\s*[:=]\s*["']?[^"\s,}]{4,})/iu.test(serialized),
    'UNSAFE', 'Record appears to contain credentials; use a sanitized reference');
  budget(value, limit, 'Record');
  return value;
}
export function recordLimit(record) {
  if (record.type === 'cycle') return LIMITS.workingSet;
  if (['event', 'pending-decision'].includes(record.type)) return LIMITS.decision;
  return LIMITS.record;
}
export function parseJson(input, limit = LIMITS.input) {
  requireThat(Buffer.byteLength(input) <= limit, 'CAPACITY', `JSON input exceeds ${limit} bytes`);
  try { return JSON.parse(input); }
  catch (error) { throw new SdlcError('JSON', 'Malformed JSON', { cause: error.message }); }
}
export const newId = prefix => `${prefix}-${randomUUID()}`;
export function now(clock = Date) { return new Date(clock.now()).toISOString(); }
export function timestamp(value) {
  requireThat(typeof value === 'string' && Number.isFinite(Date.parse(value)), 'INPUT', 'Expected an ISO timestamp');
  return value;
}
export function fingerprint(toolName, toolArgs, cwd) { return digest({ toolName, toolArgs, cwd }); }
