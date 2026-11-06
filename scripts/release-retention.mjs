import * as fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { canonical, readTarGzip, sha256 } from '../packaging/standalone/archive.mjs';
import { digest, requireThat } from '../src/core.mjs';
import { parseTestPlan, testSpecificationDigest } from '../src/artifacts.mjs';
import { readEvidenceBundle, validationInventoryDigest } from 'ai-sdlc-framework/evidence';
import { verifyRelease } from './verify-platform-package.mjs';
import { INPUT_FILENAME } from '../packaging/windows-tester/generate.mjs';
import { ROOT, RELEASE_GATE_TARGETS, RELEASE_PRE_CASES, RELEASE_SCOPE, emptyDirectory, options, releaseRepository } from './release-bundle.mjs';
import { immutablePublicationBinding } from './release-history.mjs';

const execute = promisify(execFile);
const hash = value => /^[a-f0-9]{64}$/u.test(value ?? '');
const source = value => /^[a-f0-9]{40}$/u.test(value ?? '');
const regularName = value => typeof value === 'string' && /^[A-Za-z0-9_./+-]+$/u.test(value) &&
  !value.startsWith('/') && !value.split('/').some(part => !part || part === '.' || part === '..');

export function historicalProvenanceBindingDiagnostics({ provenance, raw, expected, inputs, expectedSourceCommit, asOf }) {
  const same = (left, right) => left !== undefined && right !== undefined && canonical(left) === canonical(right);
  const fingerprint = value => value === undefined ? null : digest(value);
  const sources = raw.context?.sources;
  const singleSource = Array.isArray(sources) && sources.length === 1;
  const age = Date.parse(asOf) - Date.parse(raw.observedAt);
  return {
    checks: {
      specification: same(provenance.specification, expected),
      context: same(raw.context, provenance.context),
      testSpecificationDigest: raw.context?.testSpecDigest === inputs.specification.definitionDigest,
      sourceCount: singleSource,
      sourceRevision: singleSource && sources[0].revision === expectedSourceCommit,
      sourceContentDigest: singleSource && sources[0].contentDigest === digest(inputs.source.tree),
      sourceTime: typeof provenance.sourceTime === 'string' && provenance.sourceTime === raw.observedAt,
      sourceSequence: provenance.sourceSequence === 1,
      reportSequence: raw.sequence === 1,
    },
    digests: {
      specification: fingerprint(provenance.specification), expectedSpecification: fingerprint(expected),
      context: fingerprint(raw.context), authenticatedContext: fingerprint(provenance.context),
      profile: fingerprint(provenance.specification?.profile), expectedProfile: fingerprint(expected.profile),
      sourceTime: fingerprint(provenance.sourceTime), rawObservedAt: fingerprint(raw.observedAt),
      asOf: fingerprint(asOf),
    },
    ageMs: Number.isFinite(age) ? age : null,
  };
}

export async function captureReleaseReplayInputs({ bundle, directory, captureDefinition,
  observedAt = new Date().toISOString(), sourceRepository = process.env.GITHUB_REPOSITORY }) {
  captureDefinition ??= (await import('./native-validation.mjs')).captureNativeDefinitionInputs;
  const entries = [];
  const definitions = [];
  const origins = bundle.producerVerification;
  const available = origins?.origins?.length === 4 && origins.contexts?.length === 4 &&
    origins.contexts.every(row => Number.isFinite(Date.parse(row.sourceTime)) &&
      Number.isSafeInteger(row.sourceSequence) && row.sourceSequence > 0);
  if (available) for (const target of RELEASE_GATE_TARGETS) {
    const definition = await captureDefinition({ target, profile: 'r-pre' });
    requireThat(definition.source?.revision === bundle.identity.sourceCommit &&
      definition.target === target && definition.profile === 'r-pre',
    'RELEASE_REPLAY', 'Retained definitions differ from the original adopted candidate');
    const filename = `replay/definitions/${target}.json`;
    const bytes = Buffer.from(canonical(definition));
    definitions.push({ target, filename, sha256: sha256(bytes), size: bytes.length,
      definitionDigest: digest(definition) });
    entries.push({ path: filename, data: bytes, mode: 0o644 });
  }
  const template = await fs.readFile(path.join(ROOT, 'packaging', 'windows-tester', 'prompt.md.template'));
  entries.push({ path: 'replay/windows-tester-template.txt', data: template, mode: 0o644 });
  const bundleSha256 = sha256(await fs.readFile(path.join(directory, 'bundle.json')));
  const graph = { schemaVersion: 1, kind: 'release-verification-graph',
    bundleSha256, identity: bundle.identity, releaseRepository: bundle.releaseRepository,
    releaseIntentId: bundle.releaseIntentId, sourceRepository: sourceRepository ?? 'urmich/ai-sdlc-framework',
    observedAt, historicalReplay: available ? 'Available' : 'NotRun-origin-capability-unavailable',
    definitions, producerFacts: origins?.origins ?? [], expectedContexts: origins?.contexts ?? [],
    attemptHistory: origins?.history ?? null,
    template: { filename: 'replay/windows-tester-template.txt', sha256: sha256(template), size: template.length },
    files: bundle.files.map(file => ({ ...file, retrieval: file.filename.startsWith('assets/') ?
      { kind: 'public-asset', url: `https://github.com/${bundle.releaseRepository}/releases/download/v${encodeURIComponent(bundle.identity.version)}/${encodeURIComponent(file.filename.slice(7))}` } :
      { kind: 'embedded' } })) };
  entries.push({ path: 'replay-inputs.json', data: Buffer.from(canonical(graph)), mode: 0o644 });
  return { graph, entries };
}

export async function verifyArchiveWithGh({ archive, attestationBundle, expectedArchiveSha256,
  expectedSourceCommit, sourceRepository = 'urmich/ai-sdlc-framework', trustedRoot,
  expectedTrustedRootSha256, run = execute }) {
  requireThat(attestationBundle && hash(expectedArchiveSha256) && source(expectedSourceCommit),
    'RELEASE_REPLAY', 'Use externally selected source/archive pins and a retained signed attestation bundle');
  const args = ['attestation', 'verify', archive, '--bundle', attestationBundle,
    '--repo', releaseRepository(sourceRepository), '--signer-workflow', `${sourceRepository}/.github/workflows/release.yml`,
    '--signer-digest', expectedSourceCommit, '--source-digest', expectedSourceCommit,
    '--source-ref', 'refs/heads/main', '--deny-self-hosted-runners',
    '--predicate-type', 'https://slsa.dev/provenance/v1', '--format', 'json'];
  if (trustedRoot) {
    requireThat(hash(expectedTrustedRootSha256) &&
      sha256(await fs.readFile(trustedRoot)) === expectedTrustedRootSha256,
    'RELEASE_REPLAY', 'An archive cannot select its own trust root; supply an independent expected root digest');
    args.push('--custom-trusted-root', trustedRoot);
  }
  const output = await run('gh', args, { cwd: path.dirname(path.resolve(archive)), timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024, env: process.env });
  const verified = JSON.parse(output.stdout);
  requireThat(Array.isArray(verified) && verified.some(row =>
    row.verificationResult?.statement?.subject?.length === 1 &&
    row.verificationResult.statement.subject[0].digest?.sha256 === expectedArchiveSha256 &&
    row.verificationResult.verifiedTimestamps?.some(time => /^tlog$/iu.test(time.type ?? ''))),
  'RELEASE_REPLAY', 'Retained signature/certificate/transparency verification did not establish the exact subject');
  return { verifierId: 'gh-attestation-verify', archiveSha256: expectedArchiveSha256,
    sourceCommit: expectedSourceCommit, sourceRepository,
    mechanisms: { signature: 'Passed', certificate: 'Passed', transparency: 'Passed' } };
}

function readEntry(files, filename, expected) {
  requireThat(regularName(filename), 'RELEASE_REPLAY', 'Unsafe immutable retrieval name');
  const bytes = files.get(filename);
  requireThat(bytes && (!expected || bytes.length === expected.size && sha256(bytes) === expected.sha256),
    'RELEASE_REPLAY', `Required retained verification input is missing or changed: ${filename}`);
  return bytes;
}

export function releaseEvidenceName(name) {
  return /^release-(?:prepublication|completion)-[A-Za-z0-9_-]+-([a-f0-9]{64})\.tar\.gz$/u.exec(name) ??
    /^release-(?:attestation|trust)-[A-Za-z0-9_-]+-([a-f0-9]{64})\.(?:json|jsonl)$/u.exec(name);
}

export async function retainAttestationMaterial({ archive, attestationBundle, expectedArchiveSha256,
  expectedSourceCommit, releaseIntentId, outputDir, sourceRepository = 'urmich/ai-sdlc-framework',
  runId = process.env.GITHUB_RUN_ID, attempt = process.env.GITHUB_RUN_ATTEMPT, run = execute }) {
  requireThat(releaseEvidenceName(path.basename(archive)) && hash(expectedArchiveSha256) &&
    source(expectedSourceCommit) && /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/u.test(releaseIntentId ?? '') &&
    /^[1-9]\d*$/u.test(runId ?? '') && /^[1-9]\d*$/u.test(attempt ?? ''),
  'RELEASE_REPLAY', 'Retain exact signed subject and physical attempt before publishing evidence');
  const stat = await fs.lstat(attestationBundle);
  requireThat(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 8 * 1024 * 1024,
    'RELEASE_REPLAY', 'Signed trust material must be bounded regular data from the approved attestor');
  const bytes = await fs.readFile(attestationBundle);
  let bundles;
  try {
    const value = JSON.parse(bytes);
    bundles = Array.isArray(value) ? value : [value];
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    bundles = bytes.toString('utf8').trim().split(/\r?\n/u).map(line => JSON.parse(line));
  }
  for (const value of bundles) {
    const bundle = value.bundle ?? value;
    requireThat(bundle.verificationMaterial && typeof bundle.dsseEnvelope?.payload === 'string' &&
      Array.isArray(bundle.dsseEnvelope.signatures) && bundle.dsseEnvelope.signatures.length > 0,
    'RELEASE_REPLAY', 'Expected the actual signed Sigstore bundle, not a saved verification status');
  }
  requireThat(sha256(await fs.readFile(archive)) === expectedArchiveSha256,
    'RELEASE_REPLAY', 'Signed evidence subject changed before trust retention');
  const verification = await verifyArchiveWithGh({ archive, attestationBundle, expectedArchiveSha256,
    expectedSourceCommit, sourceRepository, run });
  const root = await fs.lstat(outputDir);
  requireThat(root.isDirectory() && !root.isSymbolicLink(), 'RELEASE_REPLAY', 'Trust retention requires an owned literal evidence directory');
  const attestationFilename = `release-attestation-${releaseIntentId}-${runId}-${attempt}-${sha256(bytes)}.jsonl`;
  await fs.writeFile(path.join(outputDir, attestationFilename), bytes, { flag: 'wx' });
  const trust = { schemaVersion: 1, kind: 'retained-release-trust',
    subject: { filename: path.basename(archive), sha256: expectedArchiveSha256 },
    attestation: { filename: attestationFilename, sha256: sha256(bytes), size: bytes.length },
    sourceRepository, sourceCommit: expectedSourceCommit, signerWorkflow: '.github/workflows/release.yml',
    physicalAttempt: { runId, attempt }, verification,
    trustPolicy: 'Reverify retained signed bytes with independently trusted host roots; this record is not authority' };
  const trustBytes = Buffer.from(canonical(trust));
  const trustFilename = `release-trust-${releaseIntentId}-${runId}-${attempt}-${sha256(trustBytes)}.json`;
  await fs.writeFile(path.join(outputDir, trustFilename), trustBytes, { flag: 'wx' });
  return { attestationFilename, attestationSha256: sha256(bytes), trustFilename, trustSha256: sha256(trustBytes) };
}

async function authenticatedEvidence({ archive, attestationBundle, expectedArchiveSha256, expectedSourceCommit,
  sourceRepository, asOf, verifyArchive, trustedRoot, expectedTrustedRootSha256 }) {
  requireThat(hash(expectedArchiveSha256) && source(expectedSourceCommit), 'RELEASE_REPLAY',
    'Historical evidence requires independent archive and source pins');
  const stat = await fs.lstat(archive);
  requireThat(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 128 * 1024 * 1024,
    'RELEASE_REPLAY', 'Historical evidence must be a bounded regular archive');
  const bytes = await fs.readFile(archive);
  requireThat(sha256(bytes) === expectedArchiveSha256, 'RELEASE_REPLAY', 'Retained evidence archive digest differs');
  const proof = verifyArchive ? await verifyArchive({ archive, archiveSha256: expectedArchiveSha256,
    sourceCommit: expectedSourceCommit, sourceRepository, asOf, attestationBundle, trustedRoot, expectedTrustedRootSha256 }) :
    await verifyArchiveWithGh({ archive, attestationBundle, expectedArchiveSha256, expectedSourceCommit,
      sourceRepository, trustedRoot, expectedTrustedRootSha256 });
  requireThat(proof?.archiveSha256 === expectedArchiveSha256 && proof.sourceCommit === expectedSourceCommit &&
    proof.sourceRepository === sourceRepository && typeof proof.verifierId === 'string' && proof.verifierId &&
    ['signature', 'certificate', 'transparency'].every(name => proof.mechanisms?.[name] === 'Passed'),
  'RELEASE_REPLAY', 'A stored Passed flag or boolean cannot authenticate historical producer evidence');
  return { proof, files: new Map(readTarGzip(bytes).map(entry => [entry.path, entry.data])) };
}

export async function verifyHistoricalRelease({ archive, attestationBundle, expectedArchiveSha256,
  expectedBundleSha256, expectedSourceCommit, expectedReleaseIntentId, asOf,
  sourceRepository = 'urmich/ai-sdlc-framework', assetsDirectory, materializeDirectory, fetchAsset,
  verifyArchive, replayNative, trustedRoot, expectedTrustedRootSha256 }) {
  requireThat(hash(expectedArchiveSha256) && hash(expectedBundleSha256) && source(expectedSourceCommit) &&
    typeof expectedReleaseIntentId === 'string' && Number.isFinite(Date.parse(asOf)),
  'RELEASE_REPLAY', 'Historical verification requires independent immutable pins and an explicit as-of time');
  const { proof, files } = await authenticatedEvidence({ archive, attestationBundle, expectedArchiveSha256,
    expectedSourceCommit, sourceRepository, asOf, verifyArchive, trustedRoot, expectedTrustedRootSha256 });
  const manifestBytes = readEntry(files, 'bundle.json');
  requireThat(sha256(manifestBytes) === expectedBundleSha256, 'RELEASE_REPLAY', 'Retained full bundle manifest differs');
  const bundle = JSON.parse(manifestBytes);
  const graph = JSON.parse(readEntry(files, 'replay-inputs.json'));
  const readiness = JSON.parse(readEntry(files, 'readiness.json'));
  requireThat(graph.schemaVersion === 1 && graph.kind === 'release-verification-graph' &&
    graph.historicalReplay === 'Available' && graph.bundleSha256 === expectedBundleSha256 &&
    graph.identity?.sourceCommit === expectedSourceCommit && graph.releaseIntentId === expectedReleaseIntentId &&
    graph.sourceRepository === sourceRepository && graph.releaseIntentId === bundle.releaseIntentId &&
    graph.releaseRepository === bundle.releaseRepository &&
    canonical(graph.identity) === canonical(bundle.identity) &&
    canonical(graph.files.map(({ retrieval, ...file }) => file)) === canonical(bundle.files) &&
    Date.parse(asOf) >= Date.parse(graph.observedAt) && graph.definitions?.length === 4 &&
    graph.expectedContexts?.length === 4 && graph.producerFacts?.length === 4,
  'RELEASE_REPLAY', 'Retained verification graph is incomplete, foreign or not available as of the selected time');
  requireThat(readiness.schemaVersion === 1 && readiness.profile === 'r-pre' && readiness.status === 'Passed' &&
    readiness.bundleSha256 === expectedBundleSha256 && readiness.releaseIntentId === expectedReleaseIntentId &&
    canonical(readiness.identity) === canonical(bundle.identity) &&
    canonical(readiness.requiredCases) === canonical(RELEASE_PRE_CASES) &&
    Array.isArray(readiness.originalExecutions) && readiness.originalExecutions.length === RELEASE_GATE_TARGETS.length,
  'RELEASE_REPLAY', 'Original retained acyclic readiness input is incomplete or belongs to another bundle');
  for (const target of RELEASE_GATE_TARGETS) {
    const gate = JSON.parse(readEntry(files, `evidence/${target}.json`));
    const selected = readiness.originalExecutions.filter(row => row.target === target);
    requireThat(selected.length === 1 && canonical(gate.identity) === canonical(bundle.identity) &&
      gate.releaseIntentId === expectedReleaseIntentId && gate.required === RELEASE_SCOPE[target].required &&
      gate.validation === RELEASE_SCOPE[target].validation && gate.caseId === RELEASE_PRE_CASES[target] &&
      gate.profile === 'r-pre' && gate.status === 'Passed' && gate.nativeValidation === 'Passed' &&
      canonical(selected[0].run) === canonical(gate.run) && selected[0].caseId === gate.caseId &&
      selected[0].finishedAt === gate.finishedAt &&
      selected[0].executionSha256 === sha256(readEntry(files, `evidence/native/${target}/execution.json`)),
    'RELEASE_REPLAY', 'Original native gate/readiness/physical execution references are not closed');
  }
  const allowed = new Set(['bundle.json', 'readiness.json', 'replay-inputs.json', graph.template.filename,
    ...graph.definitions.map(file => file.filename),
    ...bundle.files.filter(file => !file.filename.startsWith('assets/')).map(file => file.filename)]);
  requireThat([...files.keys()].every(filename => allowed.has(filename)), 'RELEASE_REPLAY', 'Unlisted historical archive data');
  await emptyDirectory(materializeDirectory);
  for (const file of graph.files) {
    requireThat(regularName(file.filename) && hash(file.sha256) && Number.isSafeInteger(file.size),
      'RELEASE_REPLAY', 'Malformed retained bundle file');
    let data;
    if (file.retrieval.kind === 'embedded') data = readEntry(files, file.filename, file);
    else {
      requireThat(file.filename.startsWith('assets/') && file.retrieval.kind === 'public-asset' &&
        file.retrieval.url === `https://github.com/${releaseRepository(bundle.releaseRepository)}/releases/download/v${encodeURIComponent(bundle.identity.version)}/${encodeURIComponent(file.filename.slice(7))}`,
      'RELEASE_REPLAY', 'Historical asset cannot redirect independent retrieval to another destination');
      data = assetsDirectory ? await fs.readFile(path.join(assetsDirectory, file.filename.slice(7))) :
        typeof fetchAsset === 'function' ? await fetchAsset(file.retrieval.url) : null;
      requireThat(data instanceof Uint8Array && data.length === file.size && sha256(Buffer.from(data)) === file.sha256,
        'RELEASE_REPLAY', `Exact immutable public distribution asset is unavailable: ${file.filename}`);
    }
    const destination = path.join(materializeDirectory, ...file.filename.split('/'));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, data, { flag: 'wx' });
  }
  await fs.writeFile(path.join(materializeDirectory, 'bundle.json'), manifestBytes, { flag: 'wx' });
  const release = await verifyRelease({ outputDir: path.join(materializeDirectory, 'assets'),
    targets: ['macos', 'windows-x64'], rebuild: false });
  const context = JSON.parse(readEntry(files, 'context.json'));
  const tester = JSON.parse(readEntry(files, INPUT_FILENAME));
  const binding = JSON.parse(readEntry(files, 'handoff/windows-tester-prompt.json'));
  const prompt = readEntry(files, 'handoff/windows-tester-prompt.md');
  const template = readEntry(files, graph.template.filename, graph.template);
  const { prompt: citedPrompt, ...citedBinding } = binding;
  requireThat(canonical(context.identity) === canonical(bundle.identity) &&
    context.releaseIntentId === expectedReleaseIntentId && context.releaseRepository === bundle.releaseRepository &&
    canonical(context.scope) === canonical(RELEASE_SCOPE) &&
    canonical(tester.identity) === canonical(bundle.identity) && tester.templateSha256 === sha256(template) &&
    canonical(citedBinding.identity) === canonical(bundle.identity) && sha256(prompt) === citedPrompt.sha256 &&
    prompt.length === citedPrompt.size && template.toString().split('{{binding}}').length === 2 &&
    template.toString().replace('{{binding}}', canonical(citedBinding).trimEnd()) === prompt.toString() &&
    release.descriptorSha256 === bundle.identity.descriptorSha256 && release.checksumsSha256 === bundle.identity.checksumsSha256,
  'RELEASE_REPLAY', 'Retained root context/tester/handoff or immutable distribution graph is not closed');
  replayNative ??= (await import('./native-validation.mjs')).replayNativeEvidence;
  const historical = [];
  for (const target of RELEASE_GATE_TARGETS) {
    const definitionRef = graph.definitions.find(row => row.target === target);
    const definition = JSON.parse(readEntry(files, definitionRef?.filename, definitionRef));
    requireThat(digest(definition) === definitionRef.definitionDigest && definition.source.revision === expectedSourceCommit,
      'RELEASE_REPLAY', 'Original adopted native definitions changed');
    const prefix = `evidence/native/${target}/`;
    const texts = Object.fromEntries([...files].filter(([name]) => name.startsWith(prefix))
      .map(([name, value]) => [name.slice(prefix.length), value.toString('utf8')]));
    const records = {};
    for (const [name, text] of Object.entries(texts)) if (name.endsWith('.json')) records[name] = JSON.parse(text);
    const expected = graph.expectedContexts.find(row => row.target === target);
    const actualReportDigest = sha256(Buffer.from(texts['execution.json'] ?? ''));
    const result = await replayNative({ definition, data: { texts, ...records },
      candidate: { context, descriptor: release.descriptor }, asOf, verifyArchive: input => {
        requireThat(input.definitionDigest === definitionRef.definitionDigest &&
          input.reportDigest === actualReportDigest && canonical(input.candidateIdentity) === canonical(bundle.identity) &&
          canonical(input.claimedContext) === canonical(expected?.context),
        'RELEASE_REPLAY', 'Historical source/spec/config/artifact/original producer input changed');
        return { verifierId: proof.verifierId, definitionDigest: input.definitionDigest, reportDigest: input.reportDigest,
          context: expected.context, sourceTime: expected.sourceTime, sourceSequence: expected.sourceSequence };
      } });
    requireThat(result.historical === true && result.currentCredit === 'NotRun',
      'RELEASE_REPLAY', 'Historical replay cannot renew current publication credit');
    historical.push({ target, status: result.evaluation.status, originalContext: result.context });
  }
  return { schemaVersion: 1, kind: 'historical-release-verification', identity: bundle.identity,
    releaseIntentId: bundle.releaseIntentId, archiveSha256: expectedArchiveSha256, bundleSha256: expectedBundleSha256,
    evaluatedAsOf: asOf, historical: { status: historical.some(row => row.status === 'Failed') ? 'Failed' :
      historical.every(row => row.status === 'Passed') ? 'Passed' : 'NotRun',
      executions: historical }, current: { status: 'NotRun', reason: 'Historical/as-of reconstruction grants no current test or publication credit' },
    publicationReady: false };
}

export async function verifyHistoricalCompletion({ archive, attestationBundle, expectedArchiveSha256,
  prepublicationArchive, prepublicationAttestationBundle, expectedPrepublicationArchiveSha256,
  expectedBundleSha256, expectedSourceCommit, expectedReleaseIntentId, asOf,
  sourceRepository = 'urmich/ai-sdlc-framework', assetsDirectory, materializeDirectory, fetchAsset,
  verifyArchive, replayNative, trustedRoot, expectedTrustedRootSha256 }) {
  requireThat(hash(expectedBundleSha256) && hash(expectedPrepublicationArchiveSha256) &&
    typeof expectedReleaseIntentId === 'string' && Number.isFinite(Date.parse(asOf)),
  'RELEASE_REPLAY', 'Completion replay needs independently pinned completion and prepublication inputs plus an explicit as-of time');
  const authenticated = await authenticatedEvidence({ archive, attestationBundle, expectedArchiveSha256,
    expectedSourceCommit, sourceRepository, asOf, verifyArchive, trustedRoot, expectedTrustedRootSha256 });
  const files = authenticated.files;
  const completion = JSON.parse(readEntry(files, 'completion.json'));
  const inputBytes = readEntry(files, 'completion-inputs.json');
  const inputs = JSON.parse(inputBytes);
  requireThat(completion.inputClosure?.filename === 'completion-inputs.json' &&
    completion.inputClosure.sha256 === sha256(inputBytes) &&
    inputs.schemaVersion === 1 && inputs.kind === 'release-completion-inputs' &&
    inputs.source?.repository === sourceRepository && inputs.source.revision === expectedSourceCommit &&
    /^[a-f0-9]{40}$/u.test(inputs.source.tree ?? '') &&
    inputs.releaseIntentId === expectedReleaseIntentId && inputs.bundleSha256 === expectedBundleSha256 &&
    inputs.prepublicationEvidence?.sha256 === expectedPrepublicationArchiveSha256 &&
    (!inputs.prepublicationEvidence.filename || inputs.prepublicationEvidence.filename === path.basename(prepublicationArchive)) &&
    inputs.policy?.maxAgeMs === 86_400_000 && inputs.policy.revisionPolicy === 'exact' &&
    Number.isFinite(Date.parse(inputs.observedAt)) && Date.parse(inputs.observedAt) <= Date.parse(asOf) &&
    typeof inputs.specification?.text === 'string' &&
    sha256(Buffer.from(inputs.specification.text)) === inputs.specification.sha256 &&
    testSpecificationDigest(inputs.specification.text) === inputs.specification.definitionDigest &&
    Array.isArray(inputs.consumers),
  'RELEASE_REPLAY', 'Completion archive lost its original source/specification/producer/previous-release closure');
  const prepublicationDirectory = path.join(materializeDirectory, 'prepublication');
  const prepublication = await verifyHistoricalRelease({ archive: prepublicationArchive,
    attestationBundle: prepublicationAttestationBundle, expectedArchiveSha256: expectedPrepublicationArchiveSha256,
    expectedBundleSha256, expectedSourceCommit, expectedReleaseIntentId, asOf, sourceRepository,
    assetsDirectory, materializeDirectory: prepublicationDirectory, fetchAsset, verifyArchive, replayNative,
    trustedRoot, expectedTrustedRootSha256 });
  const bundle = JSON.parse(await fs.readFile(path.join(prepublicationDirectory, 'bundle.json')));
  bundle.context = JSON.parse(await fs.readFile(path.join(prepublicationDirectory, 'context.json')));
  bundle.descriptor = JSON.parse(await fs.readFile(path.join(prepublicationDirectory, 'assets', 'release-descriptor.json')));
  const prepublicationFiles = new Map(readTarGzip(await fs.readFile(prepublicationArchive)).map(entry => [entry.path, entry.data]));
  const graph = JSON.parse(readEntry(prepublicationFiles, 'replay-inputs.json'));
  requireThat(canonical(inputs.identity) === canonical(bundle.identity) &&
    canonical(completion.identity) === canonical(bundle.identity) && completion.releaseIntentId === expectedReleaseIntentId &&
    canonical(inputs.previousRelease) === canonical(bundle.context.previousRelease) &&
    inputs.scope?.repository === sourceRepository &&
    String(inputs.source.repositoryId).replace(/^repository-/u, '') === String(inputs.scope.repositoryId) &&
    graph.definitions.every(ref => {
      const definition = JSON.parse(readEntry(prepublicationFiles, ref.filename, ref));
      return definition.source.treeSha === inputs.source.tree &&
        definition.source.repositoryId === `repository-${String(inputs.scope.repositoryId)}` &&
        definition.plan === inputs.specification.text;
    }),
  'RELEASE_REPLAY', 'Completion input definitions are not the exact original source and Test Plan used before publication');
  const { evaluateConsumerOriginal } = await import('./consumer-evidence.mjs');
  const { consumerLifecyclePassed } = await import('./accept-release.mjs');
  const targets = ['windows-x64', 'macos-arm64', 'macos-x64'];
  const cases = [];
  const executions = [];
  const admitted = new Map();
  const childBindings = new Map();
  const blockers = [];
  const allowed = new Set(['completion.json', 'completion.md', 'completion-inputs.json']);
  if (inputs.publicationHistory) {
    const ref = inputs.publicationHistory;
    requireThat(ref.filename === 'npm-publication-history.json' && hash(ref.sha256) &&
      Number.isSafeInteger(ref.size), 'RELEASE_REPLAY', 'Original publication history receipt is incomplete');
    const manifest = JSON.parse(readEntry(files, ref.filename, ref));
    const expectedBinding = immutablePublicationBinding({ releaseIntentId: expectedReleaseIntentId, sourceRepository,
      sourceCommit: expectedSourceCommit, packageName: bundle.descriptor.name, version: bundle.identity.version,
      sha256: bundle.identity.payloadSha256, releaseBinding: { releaseRepository: bundle.releaseRepository,
        descriptorSha256: bundle.identity.descriptorSha256, checksumsSha256: bundle.identity.checksumsSha256 } });
    requireThat(manifest.schemaVersion === 1 && manifest.kind === 'npm-publication-history-originals' &&
      canonical(manifest.binding) === canonical(expectedBinding) && Array.isArray(manifest.originals) &&
      Array.isArray(ref.originals), 'RELEASE_REPLAY', 'Original publisher history belongs to different immutable release inputs');
    requireThat(new Set(ref.originals.map(row => row.filename)).size === ref.originals.length &&
      ref.originals.every(row => manifest.originals.some(original =>
        original.filename === row.filename && original.sha256 === row.sha256 && original.size === row.size)),
    'RELEASE_REPLAY', 'Publisher history closure rewrites or duplicates an original');
    const completeHistory = ref.complete === true && manifest.complete === true &&
      ref.originals.length === manifest.originals.length && !ref.diagnostics?.length;
    allowed.add(ref.filename);
    for (const retained of ref.originals) {
      const record = manifest.originals.find(row => row.filename === retained.filename);
      requireThat(record.filename === `npm-history-${record.artifact?.id}.json` &&
        /^[1-9]\d*$/u.test(record.artifact.id ?? '') && /^sha256:[a-f0-9]{64}$/u.test(record.artifact.digest ?? '') &&
        ['publication-dispatch.json', 'npm-publication-result.json'].includes(record.member),
      'RELEASE_REPLAY', 'Original publication artifact reference is malformed');
      const data = JSON.parse(readEntry(files, record.filename, record));
      requireThat(canonical(data.artifact) === canonical(record.artifact) && data.member === record.member &&
        hash(data.originalSemanticSha256) && data.retainedSemanticSha256 === sha256(Buffer.from(canonical(data.value))) &&
        canonical(data.value.binding) === canonical(expectedBinding),
      'RELEASE_REPLAY', 'Original publication diagnostic bytes or original-to-sanitized receipt changed');
      allowed.add(record.filename);
    }
    if (!completeHistory) blockers.push('Original publication history could not be completely independently acquired');
  }
  for (const target of targets) {
    const originals = inputs.consumers.filter(row => row.target === target);
    requireThat(originals.length === 1, 'RELEASE_REPLAY', 'Missing or duplicate original consumer closure');
    const original = originals[0];
    const records = original.retained?.records;
    requireThat(Array.isArray(records) && Array.isArray(original.retained.diagnostics),
      'RELEASE_REPLAY', 'Original consumer retention receipts are unavailable');
    for (const record of records) {
      requireThat(regularName(record.filename) && hash(record.originalSha256) &&
        Number.isSafeInteger(record.originalSize) && record.originalSize >= 0,
      'RELEASE_REPLAY', 'Malformed original consumer receipt');
      readEntry(files, record.filename, record);
      allowed.add(record.filename);
      if (original.origin) {
        const providerRecord = original.origin.origin?.files?.find(row => row.filename === record.filename);
        requireThat(providerRecord && providerRecord.sha256 === record.originalSha256 &&
          providerRecord.size === record.originalSize,
        'RELEASE_REPLAY', 'Retained sanitized bytes are not linked to their independently acquired original producer bytes');
      }
    }
    const suffix = { 'windows-x64': 'WX', 'macos-arm64': 'MA', 'macos-x64': 'MI' }[target];
    const selectedCases = ['038', '039'].map(number => ({ testId: `T-PRD${number}-${suffix}`, status: 'NotRun' }));
    cases.push(...selectedCases);
    if (!original.origin || !original.expectedContext || !original.resultFile || !original.reportFile) {
      blockers.push(`Original consumer could not be independently bound: ${target}`);
      continue;
    }
    const resultRecord = records.find(row => row.filename === original.resultFile);
    const reportRecord = records.find(row => row.filename === original.reportFile);
    requireThat(resultRecord && reportRecord &&
      original.resultFile === `${target}.json` && original.reportFile === `${target}.json.execution.json` &&
      canonical(original.origin.scope) === canonical(inputs.scope) &&
      original.sourceTime === original.origin.finishedAt && original.sourceSequence === 1,
    'RELEASE_REPLAY', 'Original consumer physical context or original time was rewritten');
    const result = JSON.parse(readEntry(files, original.resultFile, resultRecord));
    const report = JSON.parse(readEntry(files, original.reportFile, reportRecord));
    const replay = evaluateConsumerOriginal({ bundle, plan: inputs.specification.text,
      tree: inputs.source.tree, target, result, report, now: asOf, verifyOrigin: input => {
        requireThat(input.target === target && input.sourceCommit === expectedSourceCommit &&
          input.releaseIntentId === expectedReleaseIntentId &&
          input.resultSha256 === sha256(Buffer.from(canonical(result))) &&
          input.reportSha256 === sha256(Buffer.from(canonical(report))),
        'RELEASE_REPLAY', 'Historical consumer bridge changed identity-bearing or assertion-bearing data');
        return original.origin;
      } });
    requireThat(canonical(replay.context) === canonical(original.expectedContext),
      'RELEASE_REPLAY', 'Original consumer source/specification/configuration/artifact context differs');
    const bootstrapRecord = records.find(row => row.filename === `${target}.json.toolchain.json`);
    const bootstrap = bootstrapRecord && JSON.parse(readEntry(files, bootstrapRecord.filename, bootstrapRecord));
    let lifecyclePassed = null;
    const complete = replay.evaluation.status === 'Passed' && result.status === 'Passed' &&
      original.origin.producerPassed === true && !original.retained.diagnostics.length &&
      bootstrap?.status === 'Passed' && bootstrap.target === target &&
      canonical(bootstrap.native) === canonical(original.origin.native.bootstrap) &&
      (lifecyclePassed = consumerLifecyclePassed(result, target, inputs.previousRelease.version,
        bundle.identity.version, expectedPrepublicationArchiveSha256));
    const mechanismChecks = {};
    for (const channel of ['npm', 'github']) for (const mechanism of ['signature', 'certificate', 'transparency']) {
      const value = result.provenance?.[channel]?.mechanisms?.[mechanism];
      mechanismChecks[`${channel}${mechanism[0].toUpperCase()}${mechanism.slice(1)}Passed`] =
        value?.required === true && value.status === 'Passed';
    }
    childBindings.set(target, {
      admitted: complete, evaluationPassed: replay.evaluation.status === 'Passed',
      resultPassed: result.status === 'Passed', producerPassed: original.origin.producerPassed === true,
      retentionComplete: original.retained.diagnostics.length === 0,
      bootstrapPassed: bootstrap?.status === 'Passed', bootstrapTarget: bootstrap?.target === target,
      bootstrapNative: bootstrap?.status === 'Passed' && bootstrap.target === target &&
        canonical(bootstrap.native) === canonical(original.origin.native.bootstrap),
      lifecyclePassed, mechanismChecks, run: { id: result.run.id, attempt: result.run.attempt },
      originalSha256: resultRecord.originalSha256, retainedSha256: resultRecord.sha256,
      canonicalRetainedSha256: sha256(Buffer.from(canonical(result))), sanitized: resultRecord.sanitized === true,
      contextSha256: digest(replay.context), expectedContextSha256: digest(original.expectedContext),
    });
    for (const test of replay.evaluation.cases) {
      const selected = selectedCases.find(row => row.testId === test.testId);
      requireThat(selected, 'RELEASE_REPLAY', 'Foreign logical case entered historical consumer inventory');
      selected.status = test.status === 'Failed' ? 'Failed' : complete ? test.status : 'NotRun';
    }
    executions.push({ target, status: complete ? 'Passed' : replay.evaluation.status === 'Failed' ? 'Failed' : 'NotRun',
      originalContext: replay.context, origin: original.origin.origin,
      sourceTime: replay.sourceTime, sourceSequence: replay.sourceSequence });
    if (complete) admitted.set(target, { result, record: resultRecord });
    else blockers.push(`Original consumer assertion, producer, lifecycle or provenance did not pass: ${target}`);
  }
  requireThat(inputs.consumers.length === targets.length, 'RELEASE_REPLAY', 'Unexpected consumer narrowed or extended the original denominator');
  const provenanceCase = { testId: 'T-PRD042', status: 'NotRun' };
  cases.push(provenanceCase);
  const provenance = inputs.provenance;
  let provenanceBinding = null;
  if (provenance) {
    requireThat(provenance.reportFile === 'provenance-execution.json' &&
      provenance.readinessFile === 'provenance-readiness-bundle.json' &&
      hash(provenance.reportSha256) && hash(provenance.readinessSha256),
    'RELEASE_REPLAY', 'Original provenance references are incomplete');
    const rawBytes = readEntry(files, provenance.reportFile);
    const retainedBundle = readEntry(files, provenance.readinessFile);
    requireThat(sha256(rawBytes) === provenance.reportSha256 && sha256(retainedBundle) === provenance.readinessSha256,
      'RELEASE_REPLAY', 'Original provenance inputs changed');
    allowed.add(provenance.reportFile);
    allowed.add(provenance.readinessFile);
    const raw = JSON.parse(rawBytes);
    const definition = parseTestPlan(inputs.specification.text).find(row => row.id === 'T-PRD042');
    const expected = { schemaVersion: 1, profile: 'r-post-provenance', cases: [{
      id: definition.id, conditions: definition.conditions, expectedDigest: digest(definition.expected),
      executionId: 'release-provenance', mode: definition.mode, owner: definition.owner,
      location: definition.location, checkpoint: definition.checkpoint,
      assertions: targets.map(target => ({ id: `provenance-${target}`,
        selector: { procedure: 'native-published-provenance', target } })),
    }] };
    provenanceBinding = historicalProvenanceBindingDiagnostics({ provenance, raw, expected, inputs, expectedSourceCommit, asOf });
    requireThat(Object.values(provenanceBinding.checks).every(Boolean),
      'RELEASE_REPLAY', 'Original provenance denominator/context/source time differs from the authenticated definitions: ' +
        canonical({ archiveSha256: expectedArchiveSha256, ...provenanceBinding }).trimEnd());
    for (const row of raw.results) {
      const target = row.selector?.target;
      requireThat(targets.includes(target), 'RELEASE_REPLAY', 'Unexpected provenance child target');
      const child = admitted.get(target);
      const detail = child ?
        `Independently verified original native consumer ${child.result.run.id}/${child.result.run.attempt}; ` +
          `source record SHA-256 ${child.record.originalSha256}` : null;
      const claimed = typeof row.detail === 'string' ?
        /^Independently verified original native consumer ([1-9]\d{0,19})\/([1-9]\d{0,19}); source record SHA-256 ([a-f0-9]{64})$/u.exec(row.detail) : null;
      const childBinding = { archiveSha256: expectedArchiveSha256, target, rowPassed: row.status === 'Passed',
        childPresent: child !== undefined, detailMatches: child !== undefined && row.detail === detail,
        claimedRun: claimed ? { id: claimed[1], attempt: claimed[2] } : null,
        claimedSourceSha256: claimed?.[3] ?? null,
        detailSha256: typeof row.detail === 'string' ? sha256(Buffer.from(row.detail)) : null,
        expectedDetailSha256: detail === null ? null : sha256(Buffer.from(detail)),
        child: childBindings.get(target) ?? null };
      requireThat(row.status !== 'Passed' || child &&
        row.detail === detail,
      'RELEASE_REPLAY', 'Provenance aggregate cannot invent successful or relabeled original native children: ' +
        canonical(childBinding).trimEnd());
    }
    const selection = { profile: expected.profile,
      executions: [{ id: 'release-provenance', context: provenance.context }], now: asOf,
      policy: { maxAgeMs: 86_400_000, revisionPolicy: 'exact', verifierIds: [authenticated.proof.verifierId] } };
    const replay = readEvidenceBundle(JSON.parse(retainedBundle), { specification: expected, context: selection }, input => {
      requireThat([digest(raw), sha256(rawBytes)].includes(input.reportDigest),
        'RELEASE_REPLAY', 'Retained provenance bundle substituted a different raw execution');
      return { verifierId: authenticated.proof.verifierId, reportDigest: input.reportDigest,
        context: provenance.context, sourceTime: provenance.sourceTime, sourceSequence: provenance.sourceSequence };
    });
    const evaluation = replay.evaluation;
    const retainedInventoryDigest = validationInventoryDigest(replay.retainedSpecification);
    const expectedInventoryDigest = validationInventoryDigest(expected);
    requireThat(retainedInventoryDigest === expectedInventoryDigest && replay.reports.length === 1,
      'RELEASE_REPLAY', 'Retained provenance specification differs from the authenticated canonical denominator: ' +
        canonical({ archiveSha256: expectedArchiveSha256, retainedInventoryDigest, expectedInventoryDigest,
          reports: replay.reports.length }).trimEnd());
    provenanceCase.status = evaluation.status === 'Failed' ? 'Failed' :
      admitted.size === targets.length ? evaluation.status : 'NotRun';
  }
  requireThat([...files.keys()].every(filename => allowed.has(filename)), 'RELEASE_REPLAY', 'Unlisted completion archive input');
  const publication = completion.publication;
  const channelsPassed = ['PublishedAndBytesVerified', 'AlreadyPublishedIdentical'].includes(publication?.npm?.status) &&
    publication.npm.sourceCommit === expectedSourceCommit && publication.npm.releaseIntentId === expectedReleaseIntentId &&
    publication.npm.bundleSha256 === expectedBundleSha256 && publication.github?.github?.status === 'Published' &&
    canonical(publication.github.identity) === canonical(bundle.identity);
  const status = prepublication.historical.status === 'Failed' || cases.some(row => row.status === 'Failed') ? 'Failed' :
    prepublication.historical.status === 'Passed' && channelsPassed && !blockers.length &&
      cases.every(row => row.status === 'Passed') ? 'Passed' : 'NotRun';
  return { schemaVersion: 1, kind: 'historical-release-completion', identity: bundle.identity,
    releaseIntentId: expectedReleaseIntentId, archiveSha256: expectedArchiveSha256,
    prepublicationArchiveSha256: expectedPrepublicationArchiveSha256, bundleSha256: expectedBundleSha256,
    evaluatedAsOf: asOf, originalStatus: completion.status,
    historical: { status, cases, executions, blockers, provenanceBinding }, current: { status: 'NotRun',
      reason: 'Authenticated historical completion retains original observations and grants no current readiness or publication authority' },
    publicationReady: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const retain = process.argv[2] === 'retain-trust';
  const completion = process.argv[2] === 'completion';
  const result = await (retain ? retainAttestationMaterial : completion ? verifyHistoricalCompletion :
    verifyHistoricalRelease)(options(process.argv.slice(retain || completion ? 3 : 2)));
  if (retain && process.env.GITHUB_OUTPUT) for (const key of ['attestationFilename', 'attestationSha256', 'trustFilename', 'trustSha256']) {
    await fs.appendFile(process.env.GITHUB_OUTPUT, `${key}=${result[key]}\n`);
  }
  console.log(JSON.stringify(result, null, 2));
  if (!retain && result.historical.status !== 'Passed') process.exitCode = 2;
}
