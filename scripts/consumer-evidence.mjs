import * as fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { canonical, sha256 } from '../packaging/standalone/archive.mjs';
import { choice, digest, object, requireThat, text } from '../src/core.mjs';
import { parseTestPlan, testSpecificationDigest } from '../src/artifacts.mjs';
import { validateRetainedPayload } from '../src/validation-evidence.mjs';
import { immutablePublicationBinding } from './release-history.mjs';
import { nativeToolchain } from './toolchain-baseline.mjs';
import { normalizeExecutionReport, evaluateReadiness, sanitizeExecutionPayload,
  validationInventoryDigest } from 'ai-sdlc-framework/evidence';

export const consumerEvidenceSuffixes = ['', '.execution.json', '.readiness-bundle.json',
  '.readiness.md', '.commands.jsonl', '.toolchain.json'];
export const consumerEvidenceMarker = 'sdlc-consumer-evidence:';
export const consumerTargetSuffixes = Object.freeze({ 'windows-x64': 'WX', 'macos-arm64': 'MA', 'macos-x64': 'MI' });
const maximumFileBytes = 4 * 1024 * 1024;
const runners = { 'windows-x64': 'windows-2022', 'macos-arm64': 'macos-15', 'macos-x64': 'macos-15-intel' };

export function consumerSpecification(plan, target) {
  const definitions = parseTestPlan(plan);
  const suffix = consumerTargetSuffixes[target];
  if (!suffix) throw new Error('Consumer profile requires Windows x64, Mac arm64 or Mac Intel');
  return { schemaVersion: 1, profile: `r-post-${target}`,
    cases: ['038', '039'].map(number => {
      const definition = definitions.find(test => test.id === `T-PRD${number}-${suffix}`);
      if (!definition) throw new Error('Native consumer case is missing from the authoritative Test Plan');
      const procedures = number === '038' ? ['public-assets', 'standalone'] :
        ['npm', ...(target.startsWith('macos-') ? ['homebrew'] : [])];
      return { id: definition.id, conditions: definition.conditions, expectedDigest: digest(definition.expected),
        executionId: `consumer-${target}`, mode: definition.mode, owner: definition.owner,
        location: definition.location, checkpoint: definition.checkpoint,
        assertions: procedures.map(name => ({ id: `consumer-${name}`, selector: { procedure: name } })) };
    }) };
}

export function expectedConsumerContext({ bundle, specification, plan, tree, target, native, scope }) {
  assert.match(tree, /^[a-f0-9]{40}$/u, 'Independently resolved frozen source tree is required');
  const platform = target === 'windows-x64' ? 'win32' : 'darwin';
  const architecture = target === 'macos-arm64' ? 'arm64' : 'x64';
  const bootstrap = native?.bootstrap;
  assert.ok(runners[target] && native?.kind === 'native' && native.platform === platform &&
    native.architecture === architecture && native.node === nativeToolchain.node &&
    bootstrap?.platform === platform && bootstrap.architecture === architecture &&
    bootstrap.node === nativeToolchain.node && bootstrap.os && bootstrap.machine &&
    bootstrap.imageOS && bootstrap.imageVersion &&
    native.image === `${bootstrap.imageOS}/${bootstrap.imageVersion}`,
  'Independent consumer host/bootstrap facts do not satisfy the exact native baseline');
  for (const key of ['repositoryId', 'runId', 'attempt']) assert.match(String(scope[key]), /^[1-9]\d*$/u);
  assert.equal(scope.workflowRef, `${scope.repository}/.github/workflows/release.yml@refs/heads/main`);
  return {
    candidateDigest: digest({ revision: bundle.identity.sourceCommit, tree }),
    testSpecDigest: testSpecificationDigest(plan),
    configDigest: digest({ profile: specification.profile, node: nativeToolchain.node, npm: '11.16.0',
      procedures: specification.cases.map(test => test.assertions), releaseIntentId: bundle.releaseIntentId }),
    inventoryDigest: validationInventoryDigest(specification), profile: specification.profile,
    sources: [{ repositoryId: `repository-${scope.repositoryId}`,
      revision: bundle.identity.sourceCommit, contentDigest: digest(tree) }],
    native: { kind: 'native', platform, architecture, image: native.image,
      toolchain: { node: native.node, bootstrap } },
    producer: { provider: 'github', connection: 'repository-ci', scopeRef: `repository:${scope.repositoryId}`,
      definitionRef: scope.workflowRef, executionRef: String(scope.runId),
      attemptKind: 'known', attemptRef: String(scope.attempt) },
    attemptCapability: 'distinct', jobRef: `consumer-${target}`, intentId: bundle.releaseIntentId,
    environment: 'local', location: specification.cases[0].location, mode: 'automated', owner: 'provider',
    artifacts: [{ name: 'frozen-descriptor', sha256: bundle.identity.descriptorSha256 },
      { name: 'frozen-checksums', sha256: bundle.identity.checksumsSha256 },
      ...bundle.descriptor.files.map(file => ({ name: file.filename, sha256: file.sha256 }))],
  };
}

// The host authenticates provider facts or a retained signed archive before
// supplying this callback. A historical `now` reconstructs history, not current credit.
export function evaluateConsumerOriginal({ bundle, plan, tree, target, result, report, verifyOrigin,
  now = new Date().toISOString() }) {
  assert.equal(typeof verifyOrigin, 'function', 'Consumer evaluation requires an in-process independent origin verifier');
  const origin = verifyOrigin({ target, sourceCommit: bundle.identity.sourceCommit, releaseIntentId: bundle.releaseIntentId,
    resultSha256: sha256(Buffer.from(canonical(result))), reportSha256: sha256(Buffer.from(canonical(report))) });
  assert.ok(origin && typeof origin === 'object' && typeof origin.then !== 'function',
    'Origin verification must return synchronous acquired facts, not a saved verification flag');
  const specification = consumerSpecification(plan, target);
  const context = expectedConsumerContext({ bundle, specification, plan, tree, target,
    native: origin.native, scope: origin.scope });
  assert.equal(result.profile, 'r-post');
  assert.equal(result.target, target);
  assert.deepEqual(result.identity, bundle.identity);
  assert.equal(result.releaseIntentId, bundle.releaseIntentId);
  assert.deepEqual(result.native, origin.native, 'Consumer result host differs from its independently verified producer');
  assert.equal(result.run?.id, origin.scope.runId);
  assert.equal(result.run?.attempt, origin.scope.attempt);
  assert.equal(report.sequence, 1, 'Unexpected consumer producer sequence');
  const first = Date.parse(origin.startedAt);
  const last = Date.parse(origin.finishedAt);
  assert.ok(Number.isFinite(first) && Number.isFinite(last) && last >= first &&
    Date.parse(report.startedAt) >= first && Date.parse(report.observedAt) <= last &&
    Date.parse(report.observedAt) >= first &&
    (report.finishedAt === null || (Date.parse(report.finishedAt) >= first && Date.parse(report.finishedAt) <= last)),
  'Consumer report times fall outside its independently verified provider job');
  const normalized = normalizeExecutionReport(report, context, input => ({
    verifierId: 'published-consumer-host', reportDigest: input.reportDigest, context,
    sourceTime: origin.finishedAt, sourceSequence: 1,
  }));
  const evaluation = evaluateReadiness(specification, [normalized], {
    profile: specification.profile, executions: [{ id: `consumer-${target}`, context }], now,
    policy: { maxAgeMs: 86_400_000, revisionPolicy: 'exact', verifierIds: ['published-consumer-host'] },
  });
  return { evaluation, specification, context, origin, sourceTime: origin.finishedAt, sourceSequence: 1 };
}

export async function consumerOriginalInventory(file) {
  const records = [];
  for (const suffix of consumerEvidenceSuffixes) {
    try {
      const stat = await fs.lstat(`${file}${suffix}`);
      assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Consumer originals must be literal regular files');
      assert.ok(stat.size > 0 && stat.size <= maximumFileBytes, 'Consumer original exceeds the bounded retention policy');
      const bytes = await fs.readFile(`${file}${suffix}`);
      records.push({ filename: `${path.basename(file)}${suffix}`, size: bytes.length, sha256: sha256(bytes) });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return records;
}

function publicProofText(value, label, limit) {
  text(value, label, limit);
  requireThat(Buffer.byteLength(value) <= limit && /^[\x20-\x7e]+$/u.test(value) &&
    !/[{}\[\]"'\\`]/u.test(value) && !/%[a-f0-9]{2}/iu.test(value) &&
    !/&(?:#(?:x[a-f0-9]+|\d+)|[a-z][a-z0-9]+);/iu.test(value) &&
    !/\b(?:Bearer|Basic)\s+\S+/iu.test(value) && !/\/\/[^\s/]*@/u.test(value),
  'CONSUMER_PROOF_SCHEMA', `Unsupported ${label} encoding`);
  for (const match of value.matchAll(/https?:\/\/[^\s]+/giu)) {
    let url;
    try { url = new URL(match[0]); }
    catch {
      requireThat(false, 'CONSUMER_PROOF_SCHEMA', `Unsupported ${label} URL`);
    }
    requireThat(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash,
      'CONSUMER_PROOF_SCHEMA', `Unsupported ${label} URL credentials or parameters`);
  }
}

function signatureProofMetadata(value, channel) {
  const allowed = ['required', 'status', 'verifier', 'policy', 'reason'];
  requireThat(value && Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).every(key => allowed.includes(key)),
  'CONSUMER_PROOF_SCHEMA', 'Unsupported consumer signature metadata shape');
  object(value, allowed, ['required', 'status']);
  requireThat(typeof value.required === 'boolean', 'CONSUMER_PROOF_SCHEMA',
    'Consumer signature metadata needs its original required flag');
  choice(value.status, ['Passed', 'Failed', 'NotRun'], 'consumer signature metadata status');
  requireThat(Object.hasOwn(value, 'policy') || Object.hasOwn(value, 'reason'),
    'CONSUMER_PROOF_SCHEMA', 'Consumer signature metadata needs its original policy or reason');
  requireThat(value.status !== 'Passed' || Object.hasOwn(value, 'policy'),
    'CONSUMER_PROOF_SCHEMA', 'Passed consumer signature metadata needs its original verification policy');
  for (const key of ['policy', 'reason']) {
    if (Object.hasOwn(value, key)) publicProofText(value[key], `consumer signature ${key}`, 1024);
  }
  if (Object.hasOwn(value, 'verifier')) {
    const verifier = value.verifier;
    const keys = ['id', 'version', 'npmVersion'];
    requireThat(verifier && Object.getPrototypeOf(verifier) === Object.prototype &&
      Object.keys(verifier).every(key => keys.includes(key)),
    'CONSUMER_PROOF_SCHEMA', 'Unsupported consumer signature verifier shape');
    object(verifier, keys, ['id']);
    publicProofText(verifier.id, 'consumer signature verifier ID', 128);
    requireThat(verifier.id === (channel === 'npm' ? 'npm-bundled-sigstore' : 'gh-attestation-verify'),
      'CONSUMER_PROOF_SCHEMA', 'Unsupported consumer signature verifier identity');
    if (Object.hasOwn(verifier, 'version')) publicProofText(verifier.version, 'consumer signature verifier version', 256);
    if (Object.hasOwn(verifier, 'npmVersion')) {
      publicProofText(verifier.npmVersion, 'consumer signature npm version', 64);
      requireThat(channel === 'npm' && /^\d+\.\d+\.\d+$/u.test(verifier.npmVersion),
        'CONSUMER_PROOF_SCHEMA', 'Unsupported consumer signature npm version');
    }
  }
  validateRetainedPayload(value);
  return structuredClone(value);
}

export function sanitizeConsumerResultPayload(bytes) {
  const sanitized = sanitizeExecutionPayload(bytes);
  let original;
  try { original = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return sanitized;
  }
  if (original?.schemaVersion !== 1 || original.profile !== 'r-post' ||
      typeof original.target !== 'string' || !Object.hasOwn(consumerTargetSuffixes, original.target)) return sanitized;
  for (const channel of ['npm', 'github']) {
    const mechanisms = original.provenance?.[channel]?.mechanisms;
    if (!mechanisms || !Object.hasOwn(mechanisms, 'signature') ||
        mechanisms.signature === null || typeof mechanisms.signature === 'string') continue;
    // Only bounded public mechanism metadata, never arbitrary signature data,
    // can override the generic sensitive-key treatment at these two exact paths.
    const metadata = signatureProofMetadata(mechanisms.signature, channel);
    const target = sanitized.provenance?.[channel]?.mechanisms;
    requireThat(target && Object.getPrototypeOf(target) === Object.prototype,
      'CONSUMER_PROOF_SCHEMA', 'Consumer signature metadata lost its structured parent');
    target.signature = metadata;
  }
  return sanitized;
}

export async function retainConsumerOriginals({ file, outputDir }) {
  const records = [];
  const diagnostics = [];
  for (const suffix of consumerEvidenceSuffixes) {
    const source = `${file}${suffix}`;
    let original;
    try {
      const stat = await fs.lstat(source);
      assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Consumer original is linked or not a literal file');
      assert.ok(stat.size > 0 && stat.size <= maximumFileBytes, 'Consumer original exceeds the bounded retention policy');
      const bytes = await fs.readFile(source);
      original = bytes;
      const safe = suffix === '.commands.jsonl'
        ? bytes.toString('utf8').trimEnd().split('\n').map(line =>
          canonical(sanitizeExecutionPayload(Buffer.from(line))).trimEnd()).join('\n') + '\n'
        : suffix === '' ? sanitizeConsumerResultPayload(bytes) : sanitizeExecutionPayload(bytes);
      const retained = Buffer.from(typeof safe === 'string' ? safe : canonical(safe));
      const filename = `${path.basename(file)}${suffix}`;
      await fs.writeFile(path.join(outputDir, filename), retained, { flag: 'wx' });
      records.push({ filename, originalSha256: sha256(bytes), originalSize: bytes.length,
        sha256: sha256(retained), size: retained.length, sanitized: !retained.equals(bytes) });
    } catch (error) {
      diagnostics.push({ filename: `${path.basename(file)}${suffix}`,
        ...(original ? { originalSha256: sha256(original), originalSize: original.length } : {}),
        code: error.code ?? 'INVALID_ORIGINAL', reason: error.message });
    }
  }
  return { records, diagnostics };
}

export async function retainPublicationHistoryOriginals({ directory, outputDir, bundle, sourceRepository }) {
  if (!directory) return null;
  const directoryStat = await fs.lstat(directory);
  assert.ok(directoryStat.isDirectory() && !directoryStat.isSymbolicLink(),
    'Publication history needs a literal retained-artifact directory');
  const read = async filename => {
    const stat = await fs.lstat(path.join(directory, filename));
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= maximumFileBytes,
      'Publication history originals must be bounded literal JSON files');
    const bytes = await fs.readFile(path.join(directory, filename));
    const value = JSON.parse(bytes);
    validateRetainedPayload(value);
    return { bytes, value };
  };
  const filename = 'npm-publication-history.json';
  const { bytes, value: manifest } = await read(filename);
  assert.ok(manifest?.schemaVersion === 1 && manifest.kind === 'npm-publication-history-originals' &&
    typeof manifest.complete === 'boolean' && Array.isArray(manifest.originals) &&
    manifest.originals.length <= 128, 'Malformed publication history manifest');
  const receipt = { filename, sha256: sha256(bytes), size: bytes.length,
    complete: false, originals: [], diagnostics: [] };
  const binding = immutablePublicationBinding({ releaseIntentId: bundle.releaseIntentId, sourceRepository,
    sourceCommit: bundle.identity.sourceCommit, packageName: bundle.descriptor.name, version: bundle.identity.version,
    sha256: bundle.identity.payloadSha256, releaseBinding: { releaseRepository: bundle.releaseRepository,
      descriptorSha256: bundle.identity.descriptorSha256, checksumsSha256: bundle.identity.checksumsSha256 } });
  await fs.writeFile(path.join(outputDir, filename), bytes, { flag: 'wx' });
  if (canonical(manifest.binding) !== canonical(binding)) {
    receipt.diagnostics.push({ code: 'BINDING', reason: 'Publication history belongs to another immutable release binding' });
  }
  if (!manifest.complete) receipt.diagnostics.push({ code: 'INCOMPLETE',
    reason: 'Original publication history collection did not complete; known originals remain retained' });
  const names = new Set([filename]);
  let retainedBytes = bytes.length;
  for (const record of manifest.originals) {
    let selected;
    try {
      assert.ok(/^[1-9]\d*$/u.test(record?.artifact?.id ?? '') &&
        /^sha256:[a-f0-9]{64}$/u.test(record.artifact.digest ?? '') &&
        typeof record.artifact.name === 'string' && record.artifact.name.length > 0 &&
        record.artifact.name.length <= 256 &&
        ['publication-dispatch.json', 'npm-publication-result.json'].includes(record.member) &&
        record.filename === `npm-history-${record.artifact.id}.json` &&
        /^[a-f0-9]{64}$/u.test(record.sha256 ?? '') && Number.isSafeInteger(record.size) &&
        record.size > 0 && record.size <= maximumFileBytes && !names.has(record.filename),
      'Invalid or duplicate original publication artifact/member reference');
      selected = record.filename;
      names.add(selected);
      const original = await read(selected);
      assert.equal(original.bytes.length, record.size);
      assert.equal(sha256(original.bytes), record.sha256, 'Original publication history byte digest differs');
      assert.equal(canonical(original.value.artifact), canonical(record.artifact));
      assert.equal(original.value.member, record.member);
      assert.match(original.value.originalSemanticSha256 ?? '', /^[a-f0-9]{64}$/u);
      assert.equal(original.value.retainedSemanticSha256,
        sha256(Buffer.from(canonical(original.value.value))), 'Retained publication semantic digest differs');
      assert.equal(canonical(original.value.value?.binding), canonical(binding),
        'Original publication value conflicts with the independently selected immutable binding');
      assert.match(original.value.value?.run?.id ?? '', /^[1-9]\d*$/u);
      assert.match(original.value.value?.run?.attempt ?? '', /^[1-9]\d*$/u);
      retainedBytes += original.bytes.length;
      assert.ok(retainedBytes <= 64 * 1024 * 1024, 'Publication history exceeds the existing host archive bound');
      await fs.writeFile(path.join(outputDir, selected), original.bytes, { flag: 'wx' });
      receipt.originals.push({ filename: selected, sha256: record.sha256, size: record.size });
    } catch (error) {
      receipt.diagnostics.push({ ...(selected ? { filename: selected } : {}),
        code: error.code ?? 'INVALID_ORIGINAL', reason: error.message });
    }
  }
  try {
    for (const name of await fs.readdir(directory)) {
      if (!names.has(name)) receipt.diagnostics.push({ code: 'UNLISTED',
        reason: 'Publication history contains an unlisted artifact member; it was not copied' });
    }
  } catch (error) {
    receipt.diagnostics.push({ code: error.code ?? 'INCOMPLETE_INVENTORY',
      reason: `Publication history inventory could not be completed: ${error.message}` });
  }
  receipt.complete = manifest.complete && receipt.diagnostics.length === 0;
  return receipt;
}

async function required(api, route, options) {
  const result = await api(route, options);
  if (result.status === 404 || !result.value) throw new Error('Independent consumer provider facts are unavailable');
  return result.value;
}

export async function acquireConsumerOrigin({ bundle, target, file, api, scope }) {
  const prefix = `/repos/${scope.repository}`;
  const run = await required(api, `${prefix}/actions/runs/${scope.runId}/attempts/${scope.attempt}`);
  assert.equal(String(run.id), String(scope.runId));
  assert.equal(String(run.run_attempt), String(scope.attempt));
  assert.equal(String(run.repository?.id), String(scope.repositoryId));
  assert.equal(run.repository?.full_name, scope.repository);
  assert.equal(run.head_sha, bundle.identity.sourceCommit);
  assert.equal(run.path, '.github/workflows/release.yml');
  assert.equal(run.event, 'workflow_dispatch');
  assert.equal(run.head_branch, 'main');
  const jobs = [];
  for (let page = 1; page <= 50; page++) {
    const response = await required(api,
      `${prefix}/actions/runs/${scope.runId}/attempts/${scope.attempt}/jobs?per_page=100&page=${page}`);
    assert.ok(Array.isArray(response.jobs) && Number.isSafeInteger(response.total_count));
    jobs.push(...response.jobs);
    if (jobs.length === response.total_count) break;
    assert.ok(response.jobs.length && jobs.length < response.total_count && page < 50,
      'Incomplete consumer job pagination');
  }
  const selected = jobs.filter(job => [`acceptance / consumer-${target}`, `consumer-${target}`].includes(job.name));
  assert.equal(selected.length, 1, 'Missing or duplicate native consumer producer job');
  const [job] = selected;
  assert.ok(job.labels?.includes(runners[target]), 'Native consumer ran on the wrong provider runner');
  assert.equal(job.head_sha, bundle.identity.sourceCommit);
  assert.match(String(job.id), /^[1-9]\d*$/u);
  assert.equal(job.status, 'completed', 'An active or interrupted provider job cannot supply completed consumer proof');
  const startedAt = Date.parse(job.started_at);
  const finishedAt = Date.parse(job.completed_at);
  assert.ok(Number.isFinite(startedAt) && Number.isFinite(finishedAt) && finishedAt >= startedAt &&
    finishedAt <= Date.now() + 30_000, 'Consumer provider execution times are missing or invalid');
  const step = job.steps?.filter(item =>
    item.name === 'Anonymous exact public downloads, real prior-version upgrades and cryptographic provenance');
  assert.equal(step?.length, 1, 'Required native consumer step is missing or duplicated');
  const logBytes = await required(api, `${prefix}/actions/jobs/${job.id}/logs`, { binary: true });
  assert.ok(Buffer.isBuffer(logBytes) && logBytes.length <= 16 * 1024 * 1024, 'Oversized consumer provider logs');
  const markers = logBytes.toString('utf8').split(/\r?\n/u)
    .filter(line => line.includes(consumerEvidenceMarker))
    .map(line => line.slice(line.indexOf(consumerEvidenceMarker) + consumerEvidenceMarker.length));
  assert.equal(markers.length, 1, 'Exactly one original consumer evidence binding is required in actual job logs');
  assert.ok(Buffer.byteLength(markers[0]) <= maximumFileBytes, 'Oversized consumer origin binding');
  const facts = JSON.parse(markers[0]);
  assert.equal(facts.target, target);
  assert.equal(facts.sourceCommit, bundle.identity.sourceCommit);
  assert.equal(facts.releaseIntentId, bundle.releaseIntentId);
  assert.deepEqual(facts.scope, scope, 'Consumer log origin is foreign to the independently selected provider scope');
  const originals = await consumerOriginalInventory(file);
  assert.deepEqual(facts.files, originals, 'Downloaded consumer originals differ from the actual producer log digests');
  assert.ok(['', '.execution.json', '.toolchain.json'].every(suffix =>
    originals.some(record => record.filename === `${target}.json${suffix}`)),
  'Consumer result, execution and independent bootstrap originals are required to establish origin');
  return { native: facts.native, scope, producerPassed: job.conclusion === 'success' && step[0].conclusion === 'success',
    conclusion: job.conclusion, stepConclusion: step[0].conclusion, startedAt: job.started_at, finishedAt: job.completed_at,
    origin: { provider: 'github', repositoryId: scope.repositoryId, runId: scope.runId, attempt: scope.attempt,
      jobId: String(job.id), jobUrl: `https://github.com/${scope.repository}/actions/runs/${scope.runId}/job/${job.id}`,
      runUrl: `https://github.com/${scope.repository}/actions/runs/${scope.runId}/attempts/${scope.attempt}`,
      files: originals } };
}
