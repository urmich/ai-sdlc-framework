export const validationDeclarations = {
  "schemaVersion": 1,
  "applicability": [
    {"names": ["T-PRD054 producer consumer originals preserve typed provenance through completion admission"], "platforms": ["linux-x64", "windows-x64", "macos-arm64", "macos-x64"], "owner": "release-consumer", "reason": "PR-only producer serialization and completion-admission regression; owned filesystem and controlled provider observations, no network/native/public acceptance or critical-profile growth.", "prerequisites": ["Node >=22", "Owned repository-local fixture with isolated cleanup"]},
    {"names": ["T-PRD041 retained signed fixtures use the actual verifier for payload signature certificate and transparency failures"], "platforms": ["linux-x64", "windows-x64", "macos-arm64", "macos-x64"], "owner": "consumer-crypto-fixture", "reason": "Every native PR job provisions public authentic verification material; missing capability fails rather than skips. Optional local reproduction never supplies PR credit.", "prerequisites": ["SHA-pinned recorded public Sigstore bundle and public trust root", "Integrity-pinned npm 11.16.0 with its actual bundled verifier", "Exact recorded certificate identity and issuer; offline verification without network fallback"]}
  ],
  "surfaces": [
    {"coverage": "direct", "paths": ["scripts/consumer-evidence.mjs", "scripts/consumer-lifecycle.mjs", "scripts/accept-release.mjs", "scripts/verify-npm-attestation.mjs"]},
    {"coverage": "fixture-only", "paths": ["scripts/homebrew-lifecycle.mjs", "scripts/homebrew-switch.mjs"]}
  ],
  "plannedCases": [
    {"id": "T-PRD037", "selectors": [
      {"name": "T-PRD054 rejected and failed consumer originals retain sanitized bytes, digests and immutable prior outcomes", "parents": []}
    ]}
  ]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { canonical, sha256 } from '../packaging/standalone/archive.mjs';
import { digest } from '../src/core.mjs';
import { normalizeExecutionReport, evaluateReadiness, createEvidenceBundle,
  renderReadinessReport, sanitizeExecutionPayload } from 'ai-sdlc-framework/evidence';
import { consumerSpecification, acceptPublicHomebrew, consumerLifecyclePassed,
  retainConsumerResult } from '../scripts/accept-release.mjs';
import { expectedConsumerContext, evaluateConsumerOriginal, acquireConsumerOrigin, retainConsumerOriginals,
  sanitizeConsumerResultPayload, consumerOriginalInventory, consumerEvidenceMarker,
  consumerEvidenceSuffixes } from '../scripts/consumer-evidence.mjs';
import { assertConsumerUpdate, assertConsumerUninstall, npmPublicCommand } from '../scripts/consumer-lifecycle.mjs';
import { publicHomebrewFormula, verifyHomebrewUpgradeInputs } from '../scripts/homebrew-lifecycle.mjs';
import { verifyHomebrewHooks, runHomebrewCommand } from '../scripts/homebrew-switch.mjs';
import { verifyRetainedNpmAttestation } from '../scripts/verify-npm-attestation.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const plan = await fs.readFile(path.join(ROOT, 'docs', 'sdlc', 'public-readiness', 'test-plan.md'), 'utf8');
const scope = { repository: 'urmich/ai-sdlc-framework', repositoryId: '123', runId: '456', attempt: '2',
  workflowRef: 'urmich/ai-sdlc-framework/.github/workflows/release.yml@refs/heads/main' };
const bundle = { identity: { version: '1.2.3', sourceCommit: 'a'.repeat(40), payloadSha256: '1'.repeat(64),
  descriptorSha256: '2'.repeat(64), checksumsSha256: '3'.repeat(64) },
  releaseIntentId: 'controlled-consumer-fixture',
  descriptor: { files: [{ filename: 'ai-sdlc-framework-1.2.3.tgz', sha256: '1'.repeat(64) }] } };
const native = { kind: 'native', platform: 'win32', architecture: 'x64', node: '22.23.3', image: 'win22/20261019.1',
  bootstrap: { platform: 'win32', architecture: 'x64', node: '22.23.3', imageOS: 'win22',
    imageVersion: '20261019.1', os: 'fixture-OS-build', machine: 'AMD64' } };
const specification = consumerSpecification(plan, 'windows-x64');
const context = expectedConsumerContext({ bundle, specification, plan, tree: 'b'.repeat(40),
  target: 'windows-x64', native, scope });
const write = (file, value) => fs.writeFile(file, typeof value === 'string' ? value : canonical(value));
const signedFixtureUnavailable = !['SDLC_NPM_SIGNED_FIXTURE_BUNDLE', 'SDLC_NPM_SIGNED_FIXTURE_SHA256',
  'SDLC_NPM_SIGNED_FIXTURE_CERTIFICATE_IDENTITY', 'SDLC_NPM_TOOL_ROOT', 'SDLC_NPM_TUF_CACHE']
  .every(name => typeof process.env[name] === 'string' && process.env[name].length);

async function fixture(t) {
  const root = path.join(ROOT, '.test-data', `consumer-correction-${randomUUID()}`);
  await fs.mkdir(root, { recursive: true });
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await assert.rejects(fs.lstat(root), { code: 'ENOENT' });
  });
  return root;
}

function execution() {
  const observedAt = new Date().toISOString();
  return { schemaVersion: 1, kind: 'test-execution', context: structuredClone(context),
    startedAt: observedAt, finishedAt: observedAt, observedAt, sequence: 1, complete: true, exitCode: 0,
    results: specification.cases.flatMap(definition => definition.assertions.map(assertion => ({
      testId: definition.id, assertionId: assertion.id, selector: assertion.selector, status: 'Passed',
      expectedMet: true, expectedDigest: definition.expectedDigest, checkpoint: definition.checkpoint,
      observedAt, sourceSequence: 1, durationMs: 1, exitCode: 0, detail: 'Controlled host boundary fixture only',
    }))) };
}

function credit(report) {
  const normalized = normalizeExecutionReport(report, context, input => ({
    verifierId: 'published-consumer-host', reportDigest: input.reportDigest, context,
    sourceTime: report.observedAt, sourceSequence: 1,
  }));
  return evaluateReadiness(specification, [normalized], { profile: specification.profile,
    executions: [{ id: 'consumer-windows-x64', context }], now: new Date().toISOString(),
    policy: { maxAgeMs: 86_400_000, revisionPolicy: 'exact', verifierIds: ['published-consumer-host'] } });
}

function successfulConsumer() {
  const maintenance = () => ({ idempotentUpdate: { status: 'Passed' }, ordinaryUninstall: { status: 'Passed' },
    purge: { status: 'Passed' }, installedEvents: 8 });
  const signature = channel => ({ required: true, status: 'Passed',
    policy: channel === 'npm' ? 'sigstore DSSE signature' : 'gh attestation verify',
    verifier: channel === 'npm' ? { id: 'npm-bundled-sigstore', version: '4.1.0', npmVersion: '11.16.0' } :
      { id: 'gh-attestation-verify', version: 'gh version 2.83.0 (controlled fixture)' } });
  const mechanisms = channel => ({ signature: signature(channel),
    certificate: { required: true, status: 'Passed', policy: 'Controlled certificate identity fixture' },
    transparency: { required: true, status: 'Passed', policy: 'Controlled witnessed-proof fixture' } });
  const evidenceSha256 = 'd'.repeat(64);
  const consumer = { schemaVersion: 1, profile: 'r-post', target: 'windows-x64', identity: bundle.identity,
    releaseIntentId: bundle.releaseIntentId, native, run: { id: scope.runId, attempt: scope.attempt }, status: 'Passed',
    publicAssets: { status: 'Passed' }, fixtureOnly: true,
    standalone: { status: 'Passed', upgradeKind: 'version', previousVersion: '1.2.2', version: bundle.identity.version,
      shells: ['cmd', 'powershell'].map(shell => ({ shell, status: 'Passed', upgradeKind: 'version',
        previousVersion: '1.2.2', version: bundle.identity.version, ...maintenance() })) },
    npm: { status: 'Passed', upgradeKind: 'version', previousVersion: '1.2.2', version: bundle.identity.version,
      command: 'npm-generated-sdlc.cmd', ...maintenance() },
    provenance: { status: 'Passed',
      npm: { cryptographicSignatureVerification: 'Passed',
        verifier: { id: 'npm-bundled-sigstore', version: '4.1.0', npmVersion: '11.16.0' },
        mechanisms: { ...mechanisms('npm'), registrySignature: { required: true, status: 'Passed',
          verifier: { id: 'npm-audit-signatures', version: '11.16.0' } } } },
      github: { cryptographicSignatureVerification: 'Passed', subjectSha256: evidenceSha256,
        verifier: { id: 'gh-attestation-verify', version: 'gh version 2.83.0 (controlled fixture)' },
        mechanisms: mechanisms('github') } } };
  return { consumer, evidenceSha256 };
}

test('T-PRD041 consumer context derives source, specification, configuration, artifacts and producer independently', () => {
  assert.equal(credit(execution()).status, 'Passed', 'Controlled fixture baseline, not native execution proof');
  const mutations = [
    value => { value.candidateDigest = 'c'.repeat(64); },
    value => { value.testSpecDigest = 'c'.repeat(64); },
    value => { value.configDigest = 'c'.repeat(64); },
    value => { value.inventoryDigest = 'c'.repeat(64); },
    value => { value.sources[0].repositoryId = 'repository-999'; },
    value => { value.sources[0].revision = 'c'.repeat(40); },
    value => { value.sources[0].contentDigest = 'c'.repeat(64); },
    value => { value.sources.push({ ...value.sources[0], repositoryId: 'repository-888' }); },
    value => { value.profile = 'r-post-macos-x64'; },
    value => { value.jobRef = 'consumer-macos-x64'; },
    value => { value.intentId = 'foreign-release'; },
    value => { value.native.kind = 'fixture'; },
    value => { value.native.platform = 'darwin'; },
    value => { value.native.architecture = 'arm64'; },
    value => { value.native.image = 'win22/other-image'; },
    value => { value.native.toolchain.node = '22.0.0'; },
    value => { value.native.toolchain.bootstrap.os = 'other-build'; },
    value => { value.producer.provider = 'other-provider'; },
    value => { value.producer.connection = 'foreign-connection'; },
    value => { value.producer.scopeRef = 'repository:999'; },
    value => { value.producer.definitionRef = 'foreign-workflow'; },
    value => { value.producer.executionRef = '999'; },
    value => { value.producer.attemptRef = '1'; },
    value => { value.attemptCapability = 'unknown'; },
    value => { value.artifacts[0].sha256 = 'c'.repeat(64); },
    value => { value.artifacts[0].name = 'foreign-descriptor'; },
    value => { value.artifacts.pop(); },
    value => { value.environment = 'DEV'; },
    value => { value.location = 'foreign-host'; },
    value => { value.owner = 'agent'; },
  ];
  for (const mutate of mutations) {
    const report = execution();
    mutate(report.context);
    let status;
    try { status = credit(report).status; }
    catch (error) {
      assert.ok(typeof error.code === 'string', `Unexpected rejection rather than evidence validation: ${error}`);
      status = 'NotRun';
    }
    assert.notEqual(status, 'Passed', mutate.toString());
    assert.equal(credit(execution()).status, 'Passed', 'One invalid report must not change independent expected inputs');
  }
});

test('T-PRD054 retained consumer inputs replay as-of without renewing freshness or requiring live Git/provider access', () => {
  const report = execution();
  const result = { profile: 'r-post', target: 'windows-x64', identity: structuredClone(bundle.identity),
    releaseIntentId: bundle.releaseIntentId, native: structuredClone(native), run: { id: scope.runId, attempt: scope.attempt },
    status: 'Passed' };
  const origin = { native: structuredClone(native), scope: structuredClone(scope), producerPassed: true,
    conclusion: 'success', stepConclusion: 'success',
    startedAt: new Date(Date.parse(report.observedAt) - 60_000).toISOString(), finishedAt: report.observedAt };
  const retainedReport = canonical(report);
  const retainedResult = canonical(result);
  const request = { bundle, plan, tree: 'b'.repeat(40), target: 'windows-x64', result, report,
    now: report.observedAt, verifyOrigin: input => {
      assert.equal(input.reportSha256, sha256(Buffer.from(retainedReport)));
      assert.equal(input.resultSha256, sha256(Buffer.from(retainedResult)));
      assert.equal(input.sourceCommit, bundle.identity.sourceCommit);
      assert.equal(input.releaseIntentId, bundle.releaseIntentId);
      return structuredClone(origin);
    } };
  const original = evaluateConsumerOriginal(request);
  assert.equal(original.evaluation.status, 'Passed', 'Controlled signed-host boundary fixture, not native/public proof');
  assert.deepEqual(original.context, context);
  assert.equal(original.sourceTime, origin.finishedAt);
  assert.equal(original.sourceSequence, 1);
  assert.equal(evaluateConsumerOriginal({ ...request,
    now: new Date(Date.parse(report.observedAt) + 25 * 60 * 60 * 1000).toISOString() }).evaluation.status, 'NotRun',
  'Historical success must not renew the unchanged twenty-four-hour currentness contract');
  assert.equal(original.evaluation.status, 'Passed', 'A later evaluation cannot rewrite the immutable original outcome');
  assert.throws(() => evaluateConsumerOriginal({ ...request, verifyOrigin: { verified: true, ...origin } }),
    /in-process independent origin verifier/u);
  assert.throws(() => evaluateConsumerOriginal({ ...request, verifyOrigin: () => {
    throw new Error('Actual retained archive origin is not verified');
  } }), /not verified/u);
  const failedReport = structuredClone(report);
  const failure = failedReport.results.find(row => row.assertionId === 'consumer-standalone');
  Object.assign(failure, { status: 'Failed', expectedMet: false, exitCode: 7, detail: 'Original controlled failure' });
  failedReport.exitCode = 7;
  const failed = evaluateConsumerOriginal({ ...request, report: failedReport, result: { ...result, status: 'Failed' },
    verifyOrigin: () => ({ ...structuredClone(origin), producerPassed: false,
      conclusion: 'failure', stepConclusion: 'failure' }) });
  assert.equal(failed.evaluation.status, 'Failed', 'Known matching failed producer origin must remain replayable as Failed');
  assert.equal(canonical(report), retainedReport);
  assert.equal(canonical(result), retainedResult);
});

test('T-PRD054 rejected and failed consumer originals retain sanitized bytes, digests and immutable prior outcomes', async t => {
  const root = await fixture(t);
  const file = path.join(root, 'windows-x64.json');
  const failed = { status: 'Failed', reason: 'Actual controlled command failed', run: { id: '456', attempt: '1' } };
  await write(file, failed);
  await write(`${file}.execution.json`, { status: 'Failed', context, detail: 'Initial failed controlled attempt' });
  await write(`${file}.readiness-bundle.json`, { status: 'Failed', fixtureOnly: true });
  await write(`${file}.readiness.md`, '# Controlled failure\n\nFailed, not native proof.\n');
  await write(`${file}.commands.jsonl`, `${canonical({ exitCode: 7, stderr: 'MY_API_TOKEN=fixture-secret-sentinel' })}\n`);
  await write(`${file}.toolchain.json`, { status: 'Passed', fixtureOnly: true });
  const original = await fs.readFile(`${file}.commands.jsonl`);
  const outputDir = path.join(root, 'failed-originals');
  await fs.mkdir(outputDir);
  const retained = await retainConsumerOriginals({ file, outputDir });
  assert.deepEqual(retained.diagnostics, []);
  assert.equal(retained.records.length, 6);
  const command = retained.records.find(record => record.filename.endsWith('.commands.jsonl'));
  assert.equal(command.originalSha256, sha256(original));
  assert.equal(command.sanitized, true);
  const safe = await fs.readFile(path.join(outputDir, command.filename));
  assert.equal(command.sha256, sha256(safe));
  assert.ok(!safe.toString().includes('fixture-secret-sentinel'));
  assert.equal(JSON.parse(safe).exitCode, 7);
  assert.deepEqual(await fs.readFile(`${file}.commands.jsonl`), original, 'Original attempt bytes must remain immutable');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(outputDir, 'windows-x64.json'))), failed);
  const passed = { status: 'Passed', run: { id: '456', attempt: '2' }, fixtureOnly: true };
  await write(file, passed);
  const recovered = path.join(root, 'later-originals');
  await fs.mkdir(recovered);
  await retainConsumerOriginals({ file, outputDir: recovered });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(outputDir, 'windows-x64.json'))), failed,
    'Later recovery must preserve the original failed physical attempt and outcome');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(recovered, 'windows-x64.json'))), passed);

  const { consumer, evidenceSha256 } = successfulConsumer();
  const lifecycle = value => consumerLifecyclePassed(value, 'windows-x64', '1.2.2', bundle.identity.version, evidenceSha256);
  const proofBytes = Buffer.from(canonical(consumer));
  assert.equal(lifecycle(consumer), true, 'Otherwise-valid controlled facts, not actual native/cryptographic proof');
  assert.equal(lifecycle(sanitizeExecutionPayload(proofBytes)), false,
    'Generic log redaction loses the original typed signature mechanism objects');
  const typed = sanitizeConsumerResultPayload(proofBytes);
  for (const channel of ['npm', 'github']) {
    assert.deepEqual(typed.provenance[channel].mechanisms.signature, consumer.provenance[channel].mechanisms.signature);
  }
  assert.equal(lifecycle(typed), true, 'Retention must preserve the original independently bound metadata, not weaken admission');
  assert.equal(canonical(sanitizeConsumerResultPayload(Buffer.from(canonical(typed)))), canonical(typed));
  const withoutProof = structuredClone(consumer);
  for (const channel of ['npm', 'github']) Object.assign(withoutProof.provenance[channel].mechanisms.signature,
    { required: false, status: 'NotRun', reason: 'No verifier capability was available' });
  const unverified = sanitizeConsumerResultPayload(Buffer.from(canonical(withoutProof)));
  assert.equal(lifecycle(unverified), false);
  for (const channel of ['npm', 'github']) {
    assert.equal(unverified.provenance[channel].mechanisms.signature.required, false);
    assert.equal(unverified.provenance[channel].mechanisms.signature.status, 'NotRun');
  }
  const logged = structuredClone(consumer);
  logged.signature = 'untyped-signature-secret-sentinel';
  logged.detail = 'MY_API_TOKEN=generic-log-secret-sentinel';
  const safeLogs = sanitizeConsumerResultPayload(Buffer.from(canonical(logged)));
  assert.ok(!canonical(safeLogs).includes('untyped-signature-secret-sentinel'));
  assert.ok(!canonical(safeLogs).includes('generic-log-secret-sentinel'));
  const untyped = structuredClone(consumer);
  untyped.provenance.npm.mechanisms.signature = 'untyped-mechanism-secret-sentinel';
  const redacted = sanitizeConsumerResultPayload(Buffer.from(canonical(untyped)));
  assert.ok(!canonical(redacted).includes('untyped-mechanism-secret-sentinel'));
  assert.equal(lifecycle(redacted), false);

  const jwt = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.` +
    `${Buffer.from(JSON.stringify({ sub: 'controlled-fixture' })).toString('base64url')}.controlled`;
  const privateKey = ['-----BEGIN ', 'PRIVATE KEY-----\n', 'controlled-not-a-real-key\n',
    '-----END ', 'PRIVATE KEY-----'].join('');
  const corruptions = [
    value => { value.token = 'controlled-credential'; },
    value => { value.verifier.authorization = 'Bearer controlled-credential'; },
    value => { value.policy = { text: 'Unsupported structured policy' }; },
    value => { value.reason = jwt; },
    value => { value.reason = 'Authorization: Bearer controlled-credential'; },
    value => { value.policy = 'https://user:controlled-credential@example.invalid/evidence'; },
    value => { value.policy = 'https://example.invalid/evidence?signature=controlled-credential'; },
    value => { value.reason = privateKey; },
    value => { value.policy = encodeURIComponent('https://example.invalid/evidence?token=controlled-credential'); },
    value => { value.policy = 'p'.repeat(1025); },
    value => { value.required = 'true'; },
    value => { value.status = 'Verified'; },
    value => { delete value.policy; delete value.reason; },
    value => { delete value.policy; value.reason = 'Saved status without a verification policy'; },
  ];
  for (const channel of ['npm', 'github']) for (const corrupt of corruptions) {
    const unsafe = structuredClone(consumer);
    corrupt(unsafe.provenance[channel].mechanisms.signature);
    assert.throws(() => sanitizeConsumerResultPayload(Buffer.from(canonical(unsafe))),
      error => ['CONSUMER_PROOF_SCHEMA', 'INPUT', 'UNSAFE'].includes(error.code));
  }

  const proofSource = path.join(root, 'proof-source');
  await fs.mkdir(proofSource);
  const proofFile = path.join(proofSource, 'windows-x64.json');
  const proofReport = execution();
  await fs.writeFile(proofFile, proofBytes);
  await write(`${proofFile}.execution.json`, proofReport);
  await write(`${proofFile}.readiness-bundle.json`, createEvidenceBundle(credit(proofReport)));
  await write(`${proofFile}.readiness.md`, '# Controlled proof retention fixture, not native/public evidence\n\n' +
    renderReadinessReport(credit(proofReport)));
  await write(`${proofFile}.commands.jsonl`, '{"exitCode":0,"stderr":"MY_API_TOKEN=controlled-log-secret"}\n');
  await write(`${proofFile}.toolchain.json`, { schemaVersion: 1, status: 'Passed', target: 'windows-x64',
    native: native.bootstrap });
  const proofOutput = path.join(root, 'proof-retained');
  await fs.mkdir(proofOutput);
  const proofRetention = await retainConsumerOriginals({ file: proofFile, outputDir: proofOutput });
  assert.deepEqual(proofRetention.diagnostics, []);
  const proofRef = proofRetention.records.find(record => record.filename === 'windows-x64.json');
  const proofRetainedBytes = await fs.readFile(path.join(proofOutput, proofRef.filename));
  assert.equal(proofRef.originalSha256, sha256(proofBytes));
  assert.equal(proofRef.originalSize, proofBytes.length);
  assert.equal(proofRef.sha256, sha256(proofRetainedBytes));
  assert.equal(proofRef.size, proofRetainedBytes.length);
  assert.equal(proofRef.sanitized, !proofRetainedBytes.equals(proofBytes));
  assert.deepEqual(proofRetainedBytes, proofBytes, 'Known public proof metadata needs no lossy byte rewrite');
  assert.equal(lifecycle(JSON.parse(proofRetainedBytes)), true);
  assert.deepEqual(await fs.readFile(proofFile), proofBytes);
  const rejected = structuredClone(consumer);
  rejected.provenance.github.mechanisms.signature.token = 'controlled-credential';
  const rejectedBytes = Buffer.from(canonical(rejected));
  await fs.writeFile(proofFile, rejectedBytes);
  const rejectedOutput = path.join(root, 'proof-rejected');
  await fs.mkdir(rejectedOutput);
  const refusal = await retainConsumerOriginals({ file: proofFile, outputDir: rejectedOutput });
  assert.ok(!refusal.records.some(record => record.filename === 'windows-x64.json'));
  const diagnostic = refusal.diagnostics.find(record => record.filename === 'windows-x64.json');
  assert.equal(diagnostic.code, 'CONSUMER_PROOF_SCHEMA');
  assert.equal(diagnostic.originalSha256, sha256(rejectedBytes));
  assert.equal(diagnostic.originalSize, rejectedBytes.length);
  await assert.rejects(fs.lstat(path.join(rejectedOutput, 'windows-x64.json')), { code: 'ENOENT' });
  assert.deepEqual(await fs.readFile(path.join(proofOutput, proofRef.filename)), proofRetainedBytes,
    'Rejected replacement cannot alter the retained original proof bytes');
});

test('T-PRD054 producer consumer originals preserve typed provenance through completion admission', async t => {
  const root = await fixture(t);
  const file = path.join(root, 'windows-x64.json');
  const commandFile = path.join(root, 'commands.jsonl');
  const { consumer, evidenceSha256 } = successfulConsumer();
  const report = execution();
  Object.assign(consumer, { startedAt: report.startedAt, finishedAt: report.finishedAt,
    signature: 'arbitrary-signature-secret', detail: 'MY_API_TOKEN=arbitrary-result-secret' });
  await write(`${file}.execution.json`, report);
  await write(`${file}.readiness-bundle.json`, createEvidenceBundle(credit(report)));
  await write(`${file}.readiness.md`, renderReadinessReport(credit(report)));
  await write(commandFile, '{"exitCode":0,"stderr":"already sanitized fixture command"}\n');
  let producerOutput = '';
  const stdout = t.mock.method(process.stdout, 'write', value => { producerOutput += value; return true; });
  try {
    await retainConsumerResult({ result: consumer, bundle, outputFile: file, commandFile, scope,
      toolchain: { schemaVersion: 1, status: 'Passed', target: 'windows-x64', native: native.bootstrap } });
  } finally {
    stdout.mock.restore();
  }
  const originalBytes = await fs.readFile(file);
  const result = JSON.parse(originalBytes);
  for (const channel of ['npm', 'github']) {
    assert.deepEqual(result.provenance[channel].mechanisms.signature,
      consumer.provenance[channel].mechanisms.signature, `${channel} producer must preserve typed public metadata`);
  }
  assert.equal(originalBytes.includes('arbitrary-signature-secret'), false);
  assert.equal(originalBytes.includes('arbitrary-result-secret'), false);
  const marker = JSON.parse(producerOutput.slice(consumerEvidenceMarker.length));
  assert.equal(marker.files.find(record => record.filename === 'windows-x64.json').sha256, sha256(originalBytes),
    'Producer origin must bind the final sanitized bytes, not the unsanitized result');
  const job = { id: 789, name: 'consumer-windows-x64', head_sha: bundle.identity.sourceCommit,
    conclusion: 'success', status: 'completed',
    started_at: new Date(Date.parse(report.startedAt) - 60_000).toISOString(), completed_at: report.finishedAt,
    labels: ['windows-2022'], steps: [{
      name: 'Anonymous exact public downloads, real prior-version upgrades and cryptographic provenance', conclusion: 'success',
    }] };
  const api = async route => ({ status: 200, value: route.endsWith('/logs') ? Buffer.from(producerOutput) :
    route.includes('/jobs?') ? { total_count: 1, jobs: [job] } : {
      id: 456, run_attempt: 2, repository: { id: 123, full_name: scope.repository },
      head_sha: bundle.identity.sourceCommit, path: '.github/workflows/release.yml',
      event: 'workflow_dispatch', head_branch: 'main',
    } });
  const origin = await acquireConsumerOrigin({ bundle, target: 'windows-x64', file, api, scope });
  const replay = evaluateConsumerOriginal({ bundle, plan, tree: 'b'.repeat(40), target: 'windows-x64', result, report,
    now: report.observedAt, verifyOrigin: ({ resultSha256, reportSha256 }) => {
      assert.equal(resultSha256, origin.origin.files.find(record => record.filename === 'windows-x64.json').sha256);
      assert.equal(reportSha256,
        origin.origin.files.find(record => record.filename === 'windows-x64.json.execution.json').sha256);
      return origin;
    } });
  assert.equal(replay.evaluation.status, 'Passed', 'Controlled producer facts must remain admissible at completion');
  assert.equal(consumerLifecyclePassed(result, 'windows-x64', '1.2.2', bundle.identity.version, evidenceSha256), true,
    'Persisted producer result must satisfy the unchanged completion lifecycle/provenance postconditions');
  const outputDir = path.join(root, 'retained');
  await fs.mkdir(outputDir);
  const retained = await retainConsumerOriginals({ file, outputDir });
  assert.deepEqual(retained.diagnostics, []);
  assert.deepEqual(await fs.readFile(path.join(outputDir, 'windows-x64.json')), originalBytes);
  assert.deepEqual(await fs.readFile(file), originalBytes, 'Completion retention cannot rewrite producer originals');
});

test('T-PRD054 provider-acquired native original bindings reject foreign runs, changed bytes and unsuccessful steps', async t => {
  const root = await fixture(t);
  const file = path.join(root, 'windows-x64.json');
  for (const suffix of consumerEvidenceSuffixes) {
    await write(`${file}${suffix}`, suffix.endsWith('.md') ? '# Controlled original\n' :
      suffix.endsWith('.jsonl') ? '{"exitCode":0}\n' : { fixtureOnly: true });
  }
  const marker = { target: 'windows-x64', sourceCommit: bundle.identity.sourceCommit,
    releaseIntentId: bundle.releaseIntentId, scope, native, files: await consumerOriginalInventory(file) };
  const run = { id: 456, run_attempt: 2, repository: { id: 123, full_name: scope.repository },
    head_sha: bundle.identity.sourceCommit, path: '.github/workflows/release.yml', event: 'workflow_dispatch', head_branch: 'main' };
  const job = { id: 789, name: 'consumer-windows-x64', head_sha: bundle.identity.sourceCommit,
    conclusion: 'success', status: 'completed', started_at: new Date(Date.now() - 60_000).toISOString(),
    completed_at: new Date().toISOString(), labels: ['windows-2022'], steps: [{
      name: 'Anonymous exact public downloads, real prior-version upgrades and cryptographic provenance', conclusion: 'success',
    }] };
  const api = async route => ({ status: 200, value: route.endsWith('/logs') ?
    Buffer.from(`${consumerEvidenceMarker}${canonical(marker)}\n`) :
    route.includes('/jobs?') ? { total_count: 1, jobs: [job] } : run });
  const acquire = () => acquireConsumerOrigin({ bundle, target: 'windows-x64', file, api, scope });
  assert.equal((await acquire()).producerPassed, true);
  run.head_sha = 'f'.repeat(40);
  await assert.rejects(acquire());
  run.head_sha = bundle.identity.sourceCommit;
  marker.native = structuredClone(native);
  marker.native.bootstrap.os = 'different-original-build';
  assert.notDeepEqual((await acquire()).native, native, 'Host facts come from original provider logs, not uploaded report.context');
  marker.native = native;
  await fs.appendFile(file, '\n');
  await assert.rejects(acquire(), /originals differ/u);
  await write(file, { fixtureOnly: true });
  for (const conclusion of ['failure', 'cancelled', null]) {
    job.conclusion = conclusion;
    job.steps[0].conclusion = conclusion;
    assert.equal((await acquire()).producerPassed, false, 'A verified origin alone is not passing execution');
  }
});

async function installedFixture(root) {
  const home = path.join(root, randomUUID());
  await fs.mkdir(path.join(home, 'sdlc', 'runtime'), { recursive: true });
  await write(path.join(home, 'sdlc', 'owned.mjs'), 'owned bytes\n');
  await write(path.join(home, 'sdlc', 'runtime', 'keep.json'), '{"keep":true}\n');
  await write(path.join(home, 'copilot-instructions.md'),
    'Unrelated instructions.\n<!-- ai-sdlc-framework:start -->\nOwned\n<!-- ai-sdlc-framework:end -->\n');
  await write(path.join(home, 'notes.txt'), 'Unrelated user content.\n');
  await write(path.join(home, 'sdlc', 'install-manifest.json'), {
    schemaVersion: 1, owner: 'ai-sdlc-framework', version: '1.2.3',
    files: { 'sdlc/owned.mjs': digest(Buffer.from('owned bytes\n')) },
  });
  return home;
}

test('T-PRD041 update and uninstall consumers reject changed bytes and successful no-op removals', async t => {
  const root = await fixture(t);
  const home = await installedFixture(root);
  const invoke = async () => ({ stdout: '{"installed":true,"changedFiles":[]}' });
  assert.equal((await assertConsumerUpdate({ home, version: '1.2.3', invoke })).status, 'Passed');
  let calls = 0;
  await assert.rejects(assertConsumerUpdate({ home, version: '1.2.3', invoke: async () => {
    if (++calls === 2) await write(path.join(home, 'sdlc', 'owned.mjs'), 'unexpected rewrite\n');
    return invoke();
  } }), /Installed owned bytes differ/u);
  await write(path.join(home, 'sdlc', 'owned.mjs'), 'owned bytes\n');
  await assert.rejects(assertConsumerUninstall({ home,
    invoke: async () => ({ stdout: '{"uninstalled":true,"preserved":[],"removed":[]}' }) }), /no-op uninstall/u);
  await assert.rejects(assertConsumerUninstall({ home,
    invoke: async () => ({ stdout: '{"uninstalled":true,"preserved":[],"removed":["sdlc/owned.mjs"]}' }) }),
  /Missing expected rejection/u);
  const preserve = async () => {
    assert.equal(await fs.readFile(path.join(home, 'notes.txt'), 'utf8'), 'Unrelated user content.\n');
    assert.equal(await fs.readFile(path.join(home, 'sdlc', 'runtime', 'keep.json'), 'utf8'), '{"keep":true}\n');
  };
  assert.equal((await assertConsumerUninstall({ home, preserve, invoke: async () => {
    await fs.unlink(path.join(home, 'sdlc', 'owned.mjs'));
    await fs.unlink(path.join(home, 'sdlc', 'install-manifest.json'));
    await write(path.join(home, 'copilot-instructions.md'), 'Unrelated instructions.\n');
    return { stdout: '{"uninstalled":true,"preserved":[],"removed":["sdlc/owned.mjs","sdlc/install-manifest.json"]}' };
  } })).status, 'Passed');
});

test('T-PRD041 npm consumer invokes the public generated command and refuses malformed bin metadata', async t => {
  const root = await fixture(t);
  const packageRoot = path.join(root, 'node_modules', 'ai-sdlc-framework');
  await fs.mkdir(packageRoot, { recursive: true });
  await fs.mkdir(path.join(root, 'node_modules', '.bin'));
  await write(path.join(packageRoot, 'package.json'), { name: 'ai-sdlc-framework', bin: { sdlc: './bin/sdlc.mjs' } });
  await write(path.join(root, 'node_modules', '.bin', 'sdlc'), 'controlled public-shim fixture\n');
  await write(path.join(root, 'node_modules', '.bin', 'sdlc.cmd'), '@rem controlled Windows shim fixture\n');
  const calls = [];
  const run = async (command, args, options) => { calls.push({ command, args, options }); return { stdout: '{}' }; };
  const posix = await npmPublicCommand({ prefix: root, packageName: 'ai-sdlc-framework', environment: {}, run, platform: 'darwin' });
  await posix(['doctor']);
  assert.equal(calls[0].command, path.join(root, 'node_modules', '.bin', 'sdlc'));
  const windows = await npmPublicCommand({ prefix: root, packageName: 'ai-sdlc-framework', environment: {}, run, platform: 'win32' });
  await windows(['doctor']);
  assert.equal(calls[1].command, 'cmd.exe');
  assert.ok(calls[1].args.at(-1).includes('sdlc.cmd'));
  await write(path.join(packageRoot, 'package.json'), { name: 'ai-sdlc-framework', bin: { sdlc: './missing-entry.mjs' } });
  await assert.rejects(npmPublicCommand({ prefix: root, packageName: 'ai-sdlc-framework', environment: {}, run }),
    /does not declare/u);
  assert.equal(calls.length, 2, 'Malformed metadata must not execute an internal entry as a fallback');
});

test('T-PRD041 all eight installed hooks require valid payloads and reject fail-open empty responses', async t => {
  const root = await fixture(t);
  const home = path.join(root, 'home');
  await fs.mkdir(path.join(home, 'sdlc'), { recursive: true });
  await fs.cp(path.join(ROOT, 'src'), path.join(home, 'sdlc', 'src'), { recursive: true });
  await fs.cp(path.join(ROOT, 'bin'), path.join(home, 'sdlc', 'bin'), { recursive: true });
  await fs.copyFile(path.join(ROOT, 'package.json'), path.join(home, 'sdlc', 'package.json'));
  await fs.mkdir(path.join(home, 'hooks'));
  await write(path.join(home, 'copilot-instructions.md'), 'Isolated hook consumer.\n');
  const hooks = JSON.parse(await fs.readFile(path.join(ROOT, 'assets', 'hooks', 'sdlc.json'), 'utf8'));
  for (const handlers of Object.values(hooks.hooks)) for (const handler of handlers) {
    handler.exec = process.execPath;
    handler.args = handler.args.map(arg => arg === '__SDLC_ENTRY__' ? path.join(home, 'sdlc', 'bin', 'sdlc.mjs') : arg);
    handler.args.push('--home', home);
  }
  await write(path.join(home, 'hooks', 'sdlc.json'), hooks);
  const doctor = { home, installed: true, findings: [] };
  const environment = { ...process.env, HOME: home, USERPROFILE: home, COPILOT_HOME: home, NODE_OPTIONS: '', NODE_PATH: '' };
  const sessions = new Map();
  const copiedCli = path.join(home, 'sdlc', 'bin', 'sdlc.mjs');
  await verifyHomebrewHooks({ doctor, node: await fs.realpath(process.execPath),
    executeHooks: true, environment, run: async (command, args, options) => {
      const payload = JSON.parse(options.input);
      const entry = args.indexOf(copiedCli);
      assert.ok(entry >= 0);
      const event = args[entry + 1] === 'gate' ? 'preToolUse' : args[entry + 2];
      const events = sessions.get(payload.sessionId) ?? [];
      events.push(event);
      sessions.set(payload.sessionId, events);
      return runHomebrewCommand(command, args, options);
    } });
  assert.equal(sessions.size, 2, 'Public and strict hook invocations must use separate genuinely initialized sessions');
  for (const events of sessions.values()) {
    assert.deepEqual(events, ['sessionStart', 'userPromptSubmitted', 'preToolUse', 'postToolUse',
      'postToolUseFailure', 'preCompact', 'agentStop', 'sessionEnd'],
    'Every session must execute all eight public hook events in lifecycle order regardless of serialized key order');
  }
  await assert.rejects(verifyHomebrewHooks({ doctor, executeHooks: true, environment,
    run: async () => ({ stdout: '{}\n' }) }), /AI SDLC lifecycle stages are advisory/u);
  delete hooks.hooks.sessionEnd;
  await write(path.join(home, 'hooks', 'sdlc.json'), hooks);
  await assert.rejects(verifyHomebrewHooks({ doctor }), /All eight/u);
});

test('T-PRD041 public Homebrew executes exact formula bytes while candidate loopback never grants public acceptance', async t => {
  const root = await fixture(t);
  const directory = path.join(root, 'current');
  const old = path.join(root, 'previous');
  await fs.mkdir(directory);
  await fs.mkdir(old);
  const filename = 'ai-sdlc-framework-1.2.3-macos.tar.gz';
  const contents = `class AiSdlcFramework < Formula\n  url "https://github.com/urmich/ai-sdlc-framework/releases/download/v1.2.3/${filename}"\nend\n`;
  const descriptor = { version: '1.2.3', files: [
    { filename, kind: 'archive', sha256: 'a'.repeat(64), size: 1 },
    { filename: 'ai-sdlc-framework.rb', kind: 'homebrew', sha256: sha256(Buffer.from(contents)), size: Buffer.byteLength(contents) },
  ] };
  await write(path.join(directory, 'ai-sdlc-framework.rb'), contents);
  const selected = { ...bundle, descriptor };
  const previous = { directory: old, identity: { version: '1.2.2' },
    descriptor: { files: [{ kind: 'homebrew', filename: 'ai-sdlc-framework.rb', sha256: 'c'.repeat(64) }] } };
  const verifyLifecycle = async options => {
    if (options.mode !== 'public') return { passed: true, upgradeKind: 'version', platform: 'darwin', architecture: process.arch };
    const exact = await publicHomebrewFormula(options.upgradeDirectory, descriptor);
    if (exact.contents.includes('broken-published-formula')) throw new Error('Actual public formula execution failed');
    return { passed: true, mode: 'public', publicAcceptance: 'Passed', upgradeKind: 'version',
      platform: 'darwin', architecture: process.arch, previousIdentity: previous.identity, currentIdentity: selected.identity,
      formulas: { candidate: { source: 'exact-published-bytes', sha256: 'c'.repeat(64) },
        upgrade: { source: 'exact-published-bytes', sha256: exact.sha256 } } };
  };
  const accept = () => acceptPublicHomebrew({ bundle: selected, downloaded: directory, previous,
    root: path.join(root, randomUUID()), brew: process.execPath, verifyLifecycle });
  assert.equal((await accept()).status, 'Passed', 'Controlled public-adapter fixture, not actual Homebrew execution');
  const broken = `${contents}raise "broken-published-formula"\n`;
  await write(path.join(directory, 'ai-sdlc-framework.rb'), broken);
  Object.assign(descriptor.files[1], { sha256: sha256(Buffer.from(broken)), size: Buffer.byteLength(broken) });
  await assert.rejects(accept(), /Actual public formula execution failed/u);
  await assert.rejects(verifyHomebrewUpgradeInputs({ candidateDirectory: old, upgradeDirectory: directory,
    previous: bundle.identity, current: bundle.identity }), /formula revision/u);
  await assert.rejects(verifyHomebrewUpgradeInputs({ candidateDirectory: old, upgradeDirectory: directory }),
    { code: 'RELEASE_INTEGRATION_BLOCKED' });
});

test('T-PRD041 pinned npm verifier rejects module links outside its tool root before import', async t => {
  const root = await fixture(t);
  for (const mode of ['internal', 'package-link', 'modules-link']) {
    const directory = path.join(root, mode);
    const toolRoot = path.join(directory, 'npm');
    const external = path.join(directory, 'external');
    const moduleRoot = path.join(mode === 'internal' ? toolRoot : external,
      'node_modules', 'sigstore');
    const imported = path.join(directory, 'imported.json');
    await fs.mkdir(toolRoot, { recursive: true });
    await fs.mkdir(moduleRoot, { recursive: true });
    await write(path.join(toolRoot, 'package.json'), { name: 'npm', version: '11.16.0' });
    await write(path.join(moduleRoot, 'package.json'),
      { name: 'sigstore', version: '0.0.0-fixture', main: 'index.cjs' });
    await write(path.join(moduleRoot, 'index.cjs'),
      `require('node:fs').writeFileSync(${JSON.stringify(imported)}, 'loaded');\n` +
      'exports.verify = async () => { throw new Error("Fixture must not verify signatures"); };\n');
    if (mode === 'package-link') {
      await fs.mkdir(path.join(toolRoot, 'node_modules'));
      await fs.symlink(moduleRoot, path.join(toolRoot, 'node_modules', 'sigstore'),
        process.platform === 'win32' ? 'junction' : 'dir');
    } else if (mode === 'modules-link') {
      await fs.symlink(path.join(external, 'node_modules'), path.join(toolRoot, 'node_modules'),
        process.platform === 'win32' ? 'junction' : 'dir');
    }
    const request = { toolRoot, bundleFile: path.join(directory, 'absent-bundle.json'),
      certificateIdentity: 'https://example.test/workflow' };
    let code;
    await assert.rejects(verifyRetainedNpmAttestation(request), error => {
      code = error.code;
      return true;
    });
    const loaded = await fs.lstat(imported).then(() => true, error => {
      if (error.code === 'ENOENT') return false;
      throw error;
    });
    t.diagnostic(JSON.stringify({ kind: 'verifier-module-boundary', mode, code, loaded }));
    if (mode === 'internal') {
      assert.equal(code, 'ENOENT');
      assert.equal(await fs.readFile(imported, 'utf8'), 'loaded',
        'An ordinary bundled module reaches the missing-fixture boundary, not cryptographic success');
    } else {
      assert.equal(code, 'VERIFIER_UNAVAILABLE', `${mode} must reject external verifier resolution`);
      assert.equal(loaded, false, `${mode} must reject before executing the external module`);
    }
  }
});

test('T-PRD041 retained signed fixtures use the actual verifier for payload signature certificate and transparency failures',
  { skip: signedFixtureUnavailable && process.env.GITHUB_ACTIONS !== 'true' ?
    'Local host lacks retained public crypto fixture; every native PR job must provision it' : false },
  async t => {
    assert.equal(signedFixtureUnavailable, false,
      'Required PR crypto inputs are missing: run scripts/native-toolchain.mjs provisioning; absence cannot skip T-PRD041');
    const root = await fixture(t);
    const inputs = Object.fromEntries(['SDLC_NPM_SIGNED_FIXTURE_BUNDLE', 'SDLC_NPM_TOOL_ROOT', 'SDLC_NPM_TUF_CACHE']
      .map(name => [name, path.resolve(process.env[name])]));
    for (const selected of Object.values(inputs)) {
      const relative = path.relative(path.join(ROOT, '.test-data'), await fs.realpath(selected));
      assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
        'Signed fixtures and verifier/trust material must already be retained in the approved owned fixture location');
    }
    const original = await fs.readFile(inputs.SDLC_NPM_SIGNED_FIXTURE_BUNDLE);
    assert.equal(sha256(original), process.env.SDLC_NPM_SIGNED_FIXTURE_SHA256);
    const saved = JSON.parse(original);
    const bundleFile = path.join(root, 'signed-fixture.json');
    await fs.writeFile(bundleFile, original);
    const cachePath = path.join(root, 'offline-trust');
    await fs.cp(inputs.SDLC_NPM_TUF_CACHE, cachePath, { recursive: true });
    const request = { toolRoot: inputs.SDLC_NPM_TOOL_ROOT, bundleFile,
      certificateIdentity: process.env.SDLC_NPM_SIGNED_FIXTURE_CERTIFICATE_IDENTITY,
      certificateIdentityKind: process.env.SDLC_NPM_SIGNED_FIXTURE_CERTIFICATE_IDENTITY_KIND ?? 'uri',
      certificateIssuer: process.env.SDLC_NPM_SIGNED_FIXTURE_CERTIFICATE_ISSUER,
      ...(process.env.SDLC_NPM_SIGNED_FIXTURE_TRUST_SHA256 ? {
        trustedRootFile: path.join(cachePath, 'fixture-trusted-root.json'),
        trustedRootSha256: process.env.SDLC_NPM_SIGNED_FIXTURE_TRUST_SHA256,
      } : {}),
      cachePath, offline: true };
    const baseline = await verifyRetainedNpmAttestation(request);
    assert.equal(baseline.bundleSha256, sha256(original));
    assert.deepEqual(Object.values(baseline.mechanisms).map(item => item.status), ['Passed', 'Passed', 'Passed']);
    assert.equal(baseline.statementSha256, sha256(Buffer.from(saved.dsseEnvelope.payload, 'base64')));
    const tamper = value => {
      const bytes = Buffer.from(value, 'base64');
      assert.ok(bytes.length);
      bytes[0] ^= 1;
      return bytes.toString('base64');
    };
    const badSignature = structuredClone(saved);
    badSignature.dsseEnvelope.signatures[0].sig = tamper(badSignature.dsseEnvelope.signatures[0].sig);
    await write(bundleFile, badSignature);
    await assert.rejects(verifyRetainedNpmAttestation(request), /signature|verification|transparency|log/iu);
    const badPayload = structuredClone(saved);
    const statement = JSON.parse(Buffer.from(badPayload.dsseEnvelope.payload, 'base64'));
    statement.subject[0].digest.sha512 = '0'.repeat(128);
    badPayload.dsseEnvelope.payload = Buffer.from(JSON.stringify(statement)).toString('base64');
    await write(bundleFile, badPayload);
    await assert.rejects(verifyRetainedNpmAttestation(request), /signature|verification|transparency|log/iu);
    await fs.writeFile(bundleFile, original);
    await assert.rejects(verifyRetainedNpmAttestation({ ...request,
      certificateIdentity: 'https://github.com/unrelated/fixture/.github/workflows/other.yml@refs/heads/main' }),
    /identity|alternative|policy|match/iu);
    const badCertificate = structuredClone(saved);
    const certificate = badCertificate.verificationMaterial.certificate ??
      badCertificate.verificationMaterial.x509CertificateChain.certificates[0];
    certificate.rawBytes = tamper(certificate.rawBytes);
    await write(bundleFile, badCertificate);
    await assert.rejects(verifyRetainedNpmAttestation(request), /certificate|verification|ASN|sequence|parse/iu);
    const badTransparency = structuredClone(saved);
    const entry = badTransparency.verificationMaterial.tlogEntries[0];
    if (entry.inclusionPromise?.signedEntryTimestamp) {
      entry.inclusionPromise.signedEntryTimestamp = tamper(entry.inclusionPromise.signedEntryTimestamp);
    }
    if (entry.inclusionProof?.checkpoint?.envelope) {
      entry.inclusionProof.checkpoint.envelope = entry.inclusionProof.checkpoint.envelope.replace(/.$/u, '!');
    }
    assert.ok(entry.inclusionPromise?.signedEntryTimestamp || entry.inclusionProof?.checkpoint?.envelope,
      'Retained fixture has no supported verifiable transparency proof');
    await write(bundleFile, badTransparency);
    await assert.rejects(verifyRetainedNpmAttestation(request), /transparency|checkpoint|signature|log|timestamp/iu);
    await fs.writeFile(bundleFile, original);
    assert.equal((await verifyRetainedNpmAttestation(request)).bundleSha256, baseline.bundleSha256,
      'Invalid signed fixtures must not alter the original retained valid fixture');
  });
