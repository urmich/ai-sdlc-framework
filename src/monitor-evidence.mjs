import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { digest, LIMITS, requireThat, text, canonical } from './core.mjs';
import { canonicalPath, readJson } from './files.mjs';
import { sameNativePath } from './platform.mjs';

const CREDENTIAL = /(?:(?<![\p{L}\p{N}])(?:headers?|(?:http|request|response)[_-]?headers?|authorization[_-]?headers?|authorization|proxy[_-]?authorization|x[_-]?api[_-]?key|x-amz-(?:signature|credential|security-token)|api[_-]?key|(?:access|refresh|session|auth|id)[_-]?token|client[_-]?secret|raw[_-]?provider[_-]?response|provider[_-]?payload|credentials?|password|passwd|secret|set[_-]?cookie|cookie|token|sig|signature|private[_-]?key|key|content[_-]?type|user[_-]?agent)(?:\\?["'])?\s*[:=]|\bBearer\s+\S+|\bBasic\s+[A-Za-z0-9+/=]+|(?:ghp|github_pat)_[A-Za-z0-9_]{20,}|-----BEGIN [^-]*PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}\b)/iu;
const SERIALIZED_PAYLOAD = /(?:\{\s*(?:\\*["'][^"'{}[\]\r\n]{1,100}\\*["']\s*:|\})|\[\s*(?:\{|\[|\\*["']|[\d-]|true\b|false\b|null\b|\]))/iu;
const EXECUTABLE = /(?:<\s*\/?\s*(?:script|iframe|object|embed)\b|javascript\s*:|data\s*:\s*(?:text\/html|application\/javascript)|\bon(?:error|load|click)\s*=|^#!|\$\(|`[^`]+`|(?:\bpowershell\b[^\n]*\s-(?:enc|encodedcommand)\b)|\b(?:eval|exec)\s*\(|\b(?:curl|wget)\b[^\n]*\|\s*(?:sh|bash)\b|\b(?:node|python|sh|bash|cmd)\s+(?:-e|-c|\/c)\s)/iu;
const QUERY_SECRET = /^(?:token|sig|signature|key|password|access[_-]?token|api[_-]?key|client[_-]?secret|authorization|x-amz-signature|x-amz-credential|x-amz-security-token)$/iu;
const FORBIDDEN_FIELD = /(?:header|payload|response|rawbody|requestbody|credential|password|secret|token|privatekey|authorization|cookie|signature|apikey)/iu;

function fields(value, allowed, required = []) {
  requireThat(value !== null && typeof value === 'object' &&
    !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype,
  'INPUT', 'Expected shallow evidence metadata');
  requireThat(Object.keys(value).every(key => allowed.includes(key)) &&
    required.every(key => Object.hasOwn(value, key)), 'INPUT',
  'Unsupported or missing evidence metadata field');
}

function inspectUrl(value) {
  for (const match of value.matchAll(/\bhttps?:\/\/[^\s<>"']+/giu)) {
    let url;
    try { url = new URL(match[0]); }
    catch { requireThat(false, 'INPUT', 'Invalid evidence URL'); }
    requireThat(!url.username && !url.password &&
      [...url.searchParams.keys()].every(key => !QUERY_SECRET.test(key)),
    'UNSAFE', 'Evidence URL contains credentials or a sensitive query key');
    let decoded;
    try { decoded = decodeURIComponent(match[0]); }
    catch { requireThat(false, 'INPUT', 'Invalid evidence URL encoding'); }
    requireThat(!CREDENTIAL.test(decoded), 'UNSAFE',
      'Evidence URL contains an encoded credential');
  }
}

function rejectUnsafeText(value) {
  let current = value;
  while (true) {
    requireThat(!/[\r\n\u007f]/u.test(current) && !CREDENTIAL.test(current) &&
      !SERIALIZED_PAYLOAD.test(current) && !EXECUTABLE.test(current),
    'UNSAFE', 'Evidence contains sensitive, serialized, or executable content');
    inspectUrl(current);
    const decoded = current.replace(/%([a-f\d]{2})/giu,
      (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
    if (decoded === current) break;
    current = decoded;
  }
}

function safeText(value, label) {
  text(value, label);
  rejectUnsafeText(value);
  return value;
}

function retrievalContext(value) {
  fields(value, ['provider', 'connection', 'scopeRef', 'retrievedAt'],
    ['provider', 'connection', 'scopeRef', 'retrievedAt']);
  const context = Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, safeText(item, key)]));
  requireThat(Number.isFinite(Date.parse(context.retrievedAt)) &&
    new Date(context.retrievedAt).toISOString() === context.retrievedAt,
  'INPUT', 'Retrieval time must be an ISO timestamp');
  return context;
}

function evidenceReference(value) {
  fields(value, ['locator', 'retrievalContext', 'sha256', 'immutableVersion'], ['locator']);
  const locator = safeText(value.locator, 'evidence locator');
  requireThat(!/[\\\s]/u.test(locator) && /^[a-z][a-z0-9+.-]*:/iu.test(locator),
    'INPUT', 'Evidence locator must be an absolute provider reference or HTTPS URL');
  const scheme = locator.slice(0, locator.indexOf(':')).toLowerCase();
  requireThat(!['http', 'file', 'data', 'javascript', 'ftp'].includes(scheme) &&
    (scheme !== 'https' || /^https:\/\/[^/]+/iu.test(locator)),
  'INPUT', 'Unsupported evidence locator');
  const reference = { locator };
  if (value.retrievalContext !== undefined) {
    reference.retrievalContext = retrievalContext(value.retrievalContext);
  }
  if (value.sha256 !== undefined) {
    requireThat(typeof value.sha256 === 'string' && /^[a-fA-F0-9]{64}$/u.test(value.sha256),
      'INPUT', 'Evidence SHA-256 must be 64 hexadecimal characters');
    reference.sha256 = value.sha256.toLowerCase();
  }
  if (value.immutableVersion !== undefined) {
    reference.immutableVersion = safeText(value.immutableVersion, 'immutable provider version');
  }
  requireThat(!(reference.sha256 && reference.immutableVersion), 'INPUT',
    'Specify one immutable evidence identity');
  requireThat(!(reference.sha256 || reference.immutableVersion) ||
    reference.retrievalContext, 'INPUT', 'Immutable evidence requires retrieval context');
  return reference;
}

// Measure the exact serialization used by writeJson, including its trailing newline.
export function assertMonitorRecordSize(record) {
  requireThat(Buffer.byteLength(`${canonical(record)}\n`, 'utf8') <= LIMITS.record,
    'CAPACITY', 'Monitor record exceeds 4096 on-disk UTF-8 bytes');
  const inspect = value => {
    if (typeof value === 'string') {
      requireThat(value.length <= 512, 'INPUT', 'Monitor text field exceeds 512 characters');
      rejectUnsafeText(value);
    } else if (Array.isArray(value)) {
      value.forEach(inspect);
    } else if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        requireThat(key.length <= 512 && !FORBIDDEN_FIELD.test(key),
          'UNSAFE', 'Monitor record contains an unsafe field');
        inspect(item);
      }
    }
  };
  inspect(record);
  return record;
}

export function validateMonitorEvidence(input) {
  fields(input, ['summary', 'reference']);
  requireThat(input.summary !== undefined || input.reference !== undefined,
    'INPUT', 'A summary or evidence reference is required');
  const evidence = {};
  if (input.summary !== undefined) evidence.summary = safeText(input.summary, 'poll summary');
  if (input.reference !== undefined) evidence.reference = evidenceReference(input.reference);
  return assertMonitorRecordSize(evidence);
}

export async function readMonitorEvidenceRecord(filePath) {
  requireThat(typeof filePath === 'string' && path.isAbsolute(filePath),
    'PATH', 'Monitor record path must be explicit and absolute');
  return assertMonitorRecordSize(await readJson(filePath, { limit: LIMITS.record }));
}

async function boundedEvidenceBytes(filePath) {
  requireThat(sameNativePath(await canonicalPath(filePath), path.resolve(filePath)),
    'PATH', 'Evidence file path must not traverse a symlink');
  const noFollow = process.platform === 'win32' ? 0 : (constants.O_NOFOLLOW ?? 0);
  const handle = await fs.open(filePath, constants.O_RDONLY | noFollow);
  try {
    const stat = await handle.stat();
    requireThat(stat.isFile(), 'PATH', 'Evidence must be a regular file');
    requireThat(stat.size <= LIMITS.artifact, 'CAPACITY', 'Evidence exceeds 4 MiB');
    requireThat(sameNativePath(await canonicalPath(filePath), path.resolve(filePath)),
      'PATH', 'Evidence file path changed during verification');
    const chunks = [];
    let count = 0;
    while (true) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, LIMITS.artifact + 1 - count));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      count += bytesRead;
      requireThat(count <= LIMITS.artifact, 'CAPACITY', 'Evidence grew beyond 4 MiB');
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, count);
  } finally { await handle.close(); }
}

// The caller supplies an explicit, local, read-only file; no locator is fetched here.
// A provider version can be proven only by a trusted adapter's verification callback.
export async function verifyReferencedEvidence(reference, {
  filePath, verifyProviderVersion,
} = {}) {
  const checked = evidenceReference(reference);
  requireThat(typeof filePath === 'string' && path.isAbsolute(filePath),
    'PATH', 'Evidence file path must be explicit and absolute');
  if (!checked.sha256 && !checked.immutableVersion) {
    return { verified: false, reason: 'immutable-identity-unavailable' };
  }
  let bytes;
  try { bytes = await boundedEvidenceBytes(filePath); }
  catch (error) {
    if (['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) {
      return { verified: false, reason: 'evidence-file-unavailable' };
    }
    throw error;
  }
  if (checked.sha256) {
    return digest(bytes) === checked.sha256 ?
      { verified: true, identity: 'sha256' } :
      { verified: false, reason: 'sha256-mismatch' };
  }
  if (typeof verifyProviderVersion !== 'function') {
    return { verified: false, reason: 'provider-version-unproven' };
  }
  return await verifyProviderVersion({
    locator: checked.locator,
    retrievalContext: checked.retrievalContext,
    immutableVersion: checked.immutableVersion,
    bytes,
  }) === true ?
    { verified: true, identity: 'provider-version' } :
    { verified: false, reason: 'provider-version-unproven' };
}
