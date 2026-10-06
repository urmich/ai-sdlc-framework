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
const sensitiveKey = /^(?:rawPrompt|fullPrompt|prompt|rawProviderResponse|providerPayload|accessToken|access_token|clientSecret|client_secret|password|authorization|credentials|secret|headers|token|sig|signature|apiKey|api_key)$/iu;
const credentialQueryKey = /^(?:sig|signature|token|access[_-]?token|client[_-]?secret|api[_-]?key|key|password|authorization|x-amz-(?:signature|credential|security-token))$/iu;
const credentialAssignment = /(?<![\p{L}\p{N}_])(?:\\?["'])?(?:rawPrompt|fullPrompt|prompt|rawProviderResponse|providerPayload|accessToken|access_token|clientSecret|client_secret|password|authorization|credentials|secret|headers|token|sig|signature|apiKey|api_key|x-amz-(?:signature|credential|security-token))(?:\\?["'])?\s*[:=]/iu;
const credentialAssignments = new RegExp(credentialAssignment.source, 'giu');
const queryPair = /([?&]([^=&#\s"'\\]+)=)([^&#\s<>;,]+)/gu;
const webUrl = /https?:\/\/[^\s<>`]+/giu;
const redactedValue = /^\[redacted(?::[a-f0-9]{64})?\]$/iu;
function decodeCredentialText(value) {
  try { return decodeURIComponent(value); }
  catch {
    return value.replace(/%([a-f\d]{2})/giu,
      (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
  }
}
function isCredentialQueryKey(key) {
  let current = key;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (credentialQueryKey.test(current) || sensitiveKey.test(current)) return true;
    const decoded = decodeCredentialText(current);
    if (decoded === current) break;
    current = decoded;
  }
  return credentialQueryKey.test(current) || sensitiveKey.test(current);
}
function hasCredentialClue(value) {
  let current = value;
  for (let attempt = 0; attempt < 3; attempt++) {
    if ([...current.matchAll(credentialAssignments)].some(match =>
      !redactedValue.test(current.slice(match.index + match[0].length).trim())) ||
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:ghp|github_pat)_[a-zA-Z0-9_]{20,}/iu.test(current)) return true;
    const decoded = decodeCredentialText(current);
    if (decoded === current) break;
    current = decoded;
  }
  return false;
}
function redactCredentialUrls(value) {
  return value.replace(webUrl, match => {
    const trailing = match.match(/[,;.)}]+$/u)?.[0] ?? '';
    const candidate = match.slice(0, match.length - trailing.length);
    let url;
    try { url = new URL(candidate); }
    catch { return `[unparseable-url:${digest(candidate)}]${trailing}`; }
    let changed = Boolean(url.username || url.password);
    url.username = '';
    url.password = '';
    if (hasCredentialClue(url.pathname)) {
      url.pathname = '/[redacted]';
      changed = true;
    }
    if (hasCredentialClue(url.hash)) {
      url.hash = '#[redacted]';
      changed = true;
    }
    const pairs = [...url.searchParams];
    const rawPairs = url.search ? url.search.slice(1).split('&') : [];
    if (pairs.length !== rawPairs.length) return `[unparseable-url:${digest(candidate)}]${trailing}`;
    const sanitizedPairs = rawPairs.map((raw, index) => {
      const [key, queryValue] = pairs[index];
      if (redactedValue.test(queryValue)) return raw;
      if (!isCredentialQueryKey(key) && !hasCredentialClue(queryValue)) return raw;
      changed = true;
      return `${raw.slice(0, raw.indexOf('=') + 1)}[redacted]`;
    });
    if (changed && rawPairs.length) url.search = `?${sanitizedPairs.join('&')}`;
    return (changed ? url.href : candidate) + trailing;
  });
}
function redactCredentialQueries(value) {
  return value.replace(queryPair, (pair, prefix, key, queryValue) =>
    (isCredentialQueryKey(key) || hasCredentialClue(queryValue)) &&
      !redactedValue.test(queryValue) ? `${prefix}[redacted]` : pair);
}
function redactPlainText(value) {
  return redactCredentialQueries(value)
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|$)/giu,
      match => `[redacted:${digest(match)}]`)
    .replace(/(?:ghp|github_pat)_[A-Za-z0-9_]{20,}/giu,
      match => `[redacted:${digest(match)}]`);
}
function redactTextUrls(value) {
  const assigned = redactSensitiveAssignments(value);
  let result = '';
  let start = 0;
  for (const match of assigned.matchAll(webUrl)) {
    result += redactPlainText(assigned.slice(start, match.index));
    result += redactCredentialUrls(match[0]);
    start = match.index + match[0].length;
  }
  return result + redactPlainText(assigned.slice(start));
}
function jsonFragmentEnd(value, start) {
  const stack = [];
  let quoted = false;
  let escaped = false;
  for (let index = start; index < value.length; index++) {
    const character = value[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === '{' || character === '[') stack.push(character);
    else if (character === '}' || character === ']') {
      if (stack.pop() !== (character === '}' ? '{' : '[')) return -1;
      if (stack.length === 0) return index;
    }
  }
  return -1;
}
function sensitiveAssignmentSpans(value) {
  const spans = [];
  let cursor = 0;
  for (const match of value.matchAll(credentialAssignments)) {
    if (match.index < cursor) continue;
    const start = match.index + match[0].length;
    let end = start;
    while ([' ', '\t', '\r', '\n'].includes(value[end])) end++;
    const first = value[end];
    if (!first || first === ';') continue;
    if (first === '"' || first === "'") {
      const quote = first;
      let escaped = false;
      end++;
      while (end < value.length) {
        const character = value[end++];
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === quote) break;
      }
    } else if (first === '{' || first === '[') {
      const closed = jsonFragmentEnd(value, end);
      end = closed < 0 ? value.length : closed + 1;
      const query = ['?', '&', '#'].includes(value[match.index - 1]);
      while (end < value.length && !/[\r\n;]/u.test(value[end]) &&
        !(query && (value[end] === '&' || value[end] === '#'))) end++;
    } else {
      const query = ['?', '&', '#'].includes(value[match.index - 1]);
      while (end < value.length &&
        !/[\r\n;]/u.test(value[end]) &&
        !(query && (value[end] === '&' || value[end] === '#'))) end++;
    }
    if (first === '"' || first === "'") {
      const quotedEnd = end;
      while (value[end] === ' ' || value[end] === '\t') end++;
      if (value[end] !== '\r' && value[end] !== '\n') end = quotedEnd;
    }
    if (value.slice(start, end).includes('\n') || value[end] === '\r' || value[end] === '\n') {
      while (end < value.length && value[end] !== ';') end++;
    }
    spans.push({ start, end, query: ['?', '&', '#'].includes(value[match.index - 1]) });
    cursor = end;
  }
  return spans;
}
function redactSensitiveAssignments(value) {
  let result = '';
  let cursor = 0;
  for (const { start, end, query } of sensitiveAssignmentSpans(value)) {
    const original = value.slice(start, end);
    const unquoted = original.trim().replace(/^["']/u, '').replace(/["']$/u, '');
    result += value.slice(cursor, start) +
      (redactedValue.test(unquoted) ?
        original : query ? '[redacted]' :
          `[redacted:${digest(original)}]`);
    cursor = end;
  }
  return result + value.slice(cursor);
}
export function unsafeSummaryContent(value) {
  if (typeof value === 'string') return safeSummary(value) !== value;
  if (Array.isArray(value)) return value.some(unsafeSummaryContent);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) =>
    sensitiveKey.test(key) ||
    unsafeSummaryContent(item));
}
export function safeSummary(value) {
  if (typeof value === 'string') {
    if (/^\s*[\[{]/u.test(value)) {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object') {
          return unsafeSummaryContent(parsed) ?
            JSON.stringify(safeSummary(parsed)) : value;
        }
      } catch {
        // Continue with safe treatment of a fragment or malformed value.
      }
    }
    let result = '';
    let start = 0;
    const assignments = sensitiveAssignmentSpans(value);
    let assignmentIndex = 0;
    const urls = [...value.matchAll(webUrl)].map(match =>
      [match.index, match.index + match[0].length]);
    for (let index = 0; index < value.length; index++) {
      if (value[index] !== '{' && value[index] !== '[') continue;
      while (assignmentIndex < assignments.length &&
          index >= assignments[assignmentIndex].end) assignmentIndex++;
      const assignment = assignments[assignmentIndex];
      if (assignment && index >= assignment.start &&
          index < assignment.end) {
        index = assignment.end - 1;
        continue;
      }
      const containingUrl = urls.find(([from, to]) => index >= from && index < to);
      if (containingUrl) {
        index = containingUrl[1] - 1;
        continue;
      }
      const end = jsonFragmentEnd(value, index);
      if (end < 0) continue;
      const fragment = value.slice(index, end + 1);
      let parsed;
      try {
        parsed = JSON.parse(fragment);
      } catch { continue; }
      result += redactTextUrls(value.slice(start, index));
      const sanitized = safeSummary(parsed);
      result += unsafeSummaryContent(parsed) ? JSON.stringify(sanitized) : fragment;
      start = end + 1;
      index = end;
    }
    return result + redactTextUrls(value.slice(start));
  }
  if (Array.isArray(value)) return value.map(safeSummary);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, sensitiveKey.test(key) ?
      (typeof item === 'string' && redactedValue.test(item) ?
        item : `[redacted:${digest(item === undefined ? 'undefined' : item)}]`) :
      safeSummary(item)]));
}
export function shellArgument(value) {
  if (/^[a-zA-Z0-9._:/\\-]+$/u.test(value)) return value;
  return `'${value.replaceAll("'", process.platform === 'win32' ? "''" : "'\\''")}'`;
}
export function detailCommand(command, workItemId, home) {
  return `sdlc ${command} --work-item ${shellArgument(workItemId)}` +
    (home ? ` --home ${shellArgument(home)}` : '');
}
export const SUMMARY_PAGE_LIMIT = 1000;
export const SUMMARY_MAX_OFFSET = 1_000_000;
export function summaryPage(items, base, field, { offset = 0, limit = 100, command, digestItems = items }) {
  requireThat(Number.isSafeInteger(offset) && offset >= 0 &&
    offset <= SUMMARY_MAX_OFFSET && offset <= items.length,
    'INPUT', 'Invalid summary offset');
  requireThat(Number.isSafeInteger(limit) && limit > 0 && limit <= SUMMARY_PAGE_LIMIT,
    'INPUT', `Invalid summary limit; expected 1..${SUMMARY_PAGE_LIMIT}`);
  let count = Math.min(limit, items.length - offset);
  while (true) {
    const nextOffset = offset + count < items.length ? offset + count : null;
    const page = { ...base, total: items.length, count, offset, nextOffset,
      omittedDigest: digest([...digestItems.slice(0, offset),
        ...digestItems.slice(offset + count)]),
      [field]: items.slice(offset, offset + count),
      ...(nextOffset === null ? {} : { detailCommand: `${command} --offset ${nextOffset} --limit ${limit}` }) };
    if (Buffer.byteLength(JSON.stringify(page)) + 1 <= LIMITS.workingSet) return page;
    requireThat(count > 1, 'CAPACITY', 'A summary item cannot fit in the working-set budget');
    count = Math.floor(count / 2);
  }
}
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
