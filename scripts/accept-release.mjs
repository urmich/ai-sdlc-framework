import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { canonical, readTarGzip, readZip, sha256, tarGzip } from '../packaging/standalone/archive.mjs';
import { extractEntries, payloadIdentity, TARGETS, verifyEntries } from '../packaging/standalone/protocol.mjs';
import { runtimePreflight } from '../packaging/standalone/runtime.mjs';
import { verifyReleaseChecksums, verifyRelease } from './verify-platform-package.mjs';
import { npmInvocation } from './package.mjs';
import { boundedReadback, githubRequest, registryPackage, verifyRegistryPayload } from './publish-release.mjs';
import { assertNativeMacHost, verifyCopiedHomebrewInstallation } from './homebrew-switch.mjs';
import { verifyHomebrewLifecycle, verifyHomebrewUpgradeInputs } from './homebrew-lifecycle.mjs';
import { assertConsumerUpdate, assertConsumerUninstall, installedConsumerSnapshot, npmPublicCommand,
  seedConsumerPreservation } from './consumer-lifecycle.mjs';
import { consumerSpecification, consumerTargetSuffixes, evaluateConsumerOriginal,
  expectedConsumerContext, acquireConsumerOrigin, retainConsumerOriginals, retainPublicationHistoryOriginals,
  sanitizeConsumerResultPayload, consumerOriginalInventory, consumerEvidenceMarker } from './consumer-evidence.mjs';
export { consumerSpecification } from './consumer-evidence.mjs';
import { parseTestPlan, testSpecificationDigest } from '../src/artifacts.mjs';
import { digest } from '../src/core.mjs';
import { normalizeExecutionReport, evaluateReadiness, validationInventoryDigest,
  createEvidenceBundle, renderReadinessReport, sanitizeExecutionPayload } from 'ai-sdlc-framework/evidence';
import { ROOT, RELEASE_TARGETS, archiveRecord, emptyDirectory, options,
  releaseRepository, requirePublicationReady, trustedEnvironment, verifyBundle, writeJson } from './release-bundle.mjs';

const executeFile = promisify(execFile);
function execute(command, args, { input = '', ...options } = {}) {
  const pending = executeFile(command, args, options);
  pending.child.stdin?.end(input);
  return pending;
}
const suffixes = consumerTargetSuffixes;
const NPM_TOOL_INTEGRITY = 'sha512-A74XL8OxmcegZDMWPkWb5bEQppg8HdYwW3rBD2sPoS4UQHVajfaxBkqyzLeJ3wR0kZ+5xoTjItxXaF7eIXUsyw==';
const blocked = reason => Object.assign(new Error(reason), { code: 'RELEASE_INTEGRATION_BLOCKED' });

async function anonymousBytes(url, fetcher = fetch, deadline = Date.now() + 600_000) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw Object.assign(new Error('Anonymous publication readback exceeded the ten-minute phase budget'),
    { code: 'PUBLICATION_UNCERTAIN' });
  return boundedReadback(async () => {
    if (Date.now() >= deadline) return null;
    const response = await fetcher(url, { signal: AbortSignal.timeout(Math.max(1, Math.min(30_000, deadline - Date.now()))) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Anonymous public download failed: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }, { timeoutMs: Math.min(600_000, remaining) });
}

export async function downloadPublicAssets(bundle, directory, fetcher = fetch) {
  await emptyDirectory(directory);
  const base = `https://github.com/${bundle.releaseRepository}/releases/download/v${encodeURIComponent(bundle.identity.version)}`;
  const records = bundle.files.filter(file => file.filename.startsWith('assets/'));
  const deadline = Date.now() + 600_000;
  // Descriptor/checksum pins are authenticated by the saved bundle, not by downloaded executable code.
  for (const name of ['release-descriptor.json', 'SHA256SUMS',
    ...records.map(file => file.filename.slice(7)).filter(name => !['release-descriptor.json', 'SHA256SUMS'].includes(name))]) {
    const record = records.find(file => file.filename === `assets/${name}`);
    const bytes = await anonymousBytes(`${base}/${encodeURIComponent(name)}`, fetcher, deadline);
    if (bytes.length !== record.size || sha256(bytes) !== record.sha256) {
      throw new Error(`Anonymous release asset differs from prepublication evidence: ${name}`);
    }
    await fs.writeFile(path.join(directory, name), bytes, { flag: 'wx' });
  }
  await verifyReleaseChecksums({ outputDir: directory,
    expectedDescriptorSha256: bundle.identity.descriptorSha256,
    expectedChecksumsSha256: bundle.identity.checksumsSha256 });
  await verifyRelease({ outputDir: directory, targets: RELEASE_TARGETS, rebuild: false });
  return { status: 'Passed', authentication: 'anonymous', descriptorSha256: bundle.identity.descriptorSha256,
    checksumsSha256: bundle.identity.checksumsSha256, files: records.length };
}

export async function downloadPreviousRelease({ repository, version, descriptorSha256, checksumsSha256,
      directory, fetcher = fetch }) {
      releaseRepository(repository);
      if (!/^\d+\.\d+\.\d+$/u.test(version ?? '') ||
          !/^[a-f0-9]{64}$/u.test(descriptorSha256 ?? '') || !/^[a-f0-9]{64}$/u.test(checksumsSha256 ?? '')) {
        throw blocked('Authentic prior public release identity is required; never synthesize an old package for acceptance');
      }
      await emptyDirectory(directory);
      const base = `https://github.com/${repository}/releases/download/v${version}/`;
      const deadline = Date.now() + 600_000;
      for (const [name, hash] of [['release-descriptor.json', descriptorSha256], ['SHA256SUMS', checksumsSha256]]) {
        const bytes = await anonymousBytes(`${base}${name}`, fetcher, deadline);
        if (sha256(bytes) !== hash) throw new Error('Previous release metadata differs from the independently saved public identity');
        await fs.writeFile(path.join(directory, name), bytes, { flag: 'wx' });
      }
      const { descriptor } = await verifyReleaseChecksums({ outputDir: directory, selectedFiles: [],
        expectedDescriptorSha256: descriptorSha256, expectedChecksumsSha256: checksumsSha256 });
      if (descriptor.version !== version) throw new Error('Previous release descriptor version mismatch');
      for (const record of descriptor.files) {
        const bytes = await anonymousBytes(`${base}${encodeURIComponent(record.filename)}`, fetcher, deadline);
        if (bytes.length !== record.size || sha256(bytes) !== record.sha256) throw new Error('Previous public release asset integrity mismatch');
        await fs.writeFile(path.join(directory, record.filename), bytes, { flag: 'wx' });
      }
      const targets = descriptor.files.filter(file => file.kind === 'archive' && file.filename !== descriptor.payload.filename)
        .map(file => Object.keys(TARGETS).find(target =>
          file.filename === `ai-sdlc-framework-${version}-${target}.${TARGETS[target].extension}`));
      if (targets.some(target => !target)) throw new Error('Unknown previous public archive contract');
      await verifyRelease({ outputDir: directory, targets, rebuild: false });
      return { descriptor, directory, identity: { version, sourceCommit: descriptor.sourceCommit,
        descriptorSha256, checksumsSha256, payloadSha256: descriptor.payload.sha256 } };
    }

    export async function pinnedNpmTool({ root, environment, run = execute, fetcher = fetch }) {
      const bytes = await anonymousBytes('https://registry.npmjs.org/npm/-/npm-11.16.0.tgz', fetcher);
      const { createHash } = await import('node:crypto');
      if (`sha512-${createHash('sha512').update(bytes).digest('base64')}` !== NPM_TOOL_INTEGRITY) {
        throw new Error('Pinned npm 11.16.0 tooling integrity mismatch');
      }
      const artifact = path.join(root, 'npm-tool.tgz');
      await fs.writeFile(artifact, bytes, { flag: 'wx' });
      const invocation = npmInvocation(['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
        '--bin-links=false', '--prefix', path.join(root, 'npm-tool'), artifact]);
      await run(invocation.command, invocation.args, { env: environment, cwd: root });
      const prefix = [path.join(root, 'npm-tool', 'node_modules', 'npm', 'bin', 'npm-cli.js')];
      if ((await run(process.execPath, [...prefix, '--version'], { env: environment, cwd: root })).stdout.trim() !== '11.16.0') {
        throw new Error('Consumer npm signature verifier differs from the pinned tool');
      }
      return { command: process.execPath, prefix, version: '11.16.0', integrity: NPM_TOOL_INTEGRITY,
        root: path.join(root, 'npm-tool', 'node_modules', 'npm') };
    }

    export async function verifyPublishedProvenance({ bundle, metadata, root, tool, environment, evidenceAsset,
      run = execute, fetcher = fetch }) {
      const pendingMechanisms = () => Object.fromEntries(['signature', 'certificate', 'transparency'].map(name =>
        [name, { required: true, status: 'NotRun', reason: 'No applicable verifier result retained' }]));
      const partial = { status: 'NotRun', npm: { semanticBinding: 'NotRun', mechanisms: pendingMechanisms() },
        github: { mechanisms: pendingMechanisms() } };
      try {
      if (!metadata.dist?.attestations?.url || !metadata.dist?.signatures?.length) throw new Error('Registry signatures/provenance are required');
      const provenanceUrl = new URL(metadata.dist.attestations.url);
      if (provenanceUrl.origin !== 'https://registry.npmjs.org' || provenanceUrl.username || provenanceUrl.password ||
          provenanceUrl.search || provenanceUrl.hash || decodeURIComponent(provenanceUrl.pathname) !==
          `/-/npm/v1/attestations/${bundle.descriptor.name}@${bundle.identity.version}`) throw new Error('Unexpected npm provenance endpoint');
      const envelopeBytes = await anonymousBytes(provenanceUrl, fetcher);
      if (envelopeBytes.length > 4 * 1024 * 1024) throw new Error('Oversized npm provenance envelope');
      partial.npm.envelopeSha256 = sha256(envelopeBytes);
      const envelope = JSON.parse(envelopeBytes).attestations
        ?.filter(item => item.predicateType === 'https://slsa.dev/provenance/v1');
      if (envelope?.length !== 1) throw new Error('Missing or ambiguous npm source provenance');
      const dsse = envelope[0].bundle?.dsseEnvelope;
      if (dsse?.payloadType !== 'application/vnd.in-toto+json' ||
          typeof dsse.payload !== 'string' || dsse.payload.length > 4 * 1024 * 1024) throw new Error('Malformed npm provenance data');
      const signedBytes = Buffer.from(canonical(envelope[0].bundle));
      partial.npm.signedBundle = envelope[0].bundle;
      partial.npm.bundleSha256 = sha256(signedBytes);
      const signedFile = path.join(root, 'npm-source-attestation.sigstore.json');
      await fs.writeFile(signedFile, signedBytes, { flag: 'wx' });
      if (!tool.root || !path.isAbsolute(tool.root)) {
        throw blocked('The approved pinned npm tool must expose its bundled Sigstore verifier; audit counts cannot prove provenance identity');
      }
      const certificateIdentity = 'https://github.com/urmich/ai-sdlc-framework/.github/workflows/release.yml@refs/heads/main';
      const exact = await run(process.execPath, [path.join(ROOT, 'scripts', 'verify-npm-attestation.mjs'),
        '--tool-root', tool.root, '--bundle', signedFile, '--certificate-identity', certificateIdentity,
        '--cache-path', path.join(root, 'sigstore-trust')], { env: environment, cwd: root,
        timeout: 600_000, maxBuffer: 8 * 1024 * 1024 });
      const verified = JSON.parse(exact.stdout);
      const statementBytes = Buffer.from(dsse.payload, 'base64');
      if (verified.bundleSha256 !== sha256(signedBytes) || verified.statementSha256 !== sha256(statementBytes) ||
          canonical(verified.statement) !== canonical(JSON.parse(statementBytes)) ||
          verified.verifier?.id !== 'npm-bundled-sigstore' || verified.verifier.npmVersion !== '11.16.0' ||
          !['signature', 'certificate', 'transparency'].every(name =>
            verified.mechanisms?.[name]?.required === true && verified.mechanisms[name].status === 'Passed')) {
        throw new Error('Cryptographically verified npm statement differs from the exact retained provenance bytes or required mechanism policy');
      }
      const statement = verified.statement;
      Object.assign(partial.npm, { mechanisms: verified.mechanisms, verifier: verified.verifier,
        statementSha256: verified.statementSha256 });
      const definition = statement.predicate?.buildDefinition;
      const workflow = definition?.externalParameters?.workflow;
      if (workflow?.repository !== 'https://github.com/urmich/ai-sdlc-framework' ||
          workflow.path !== '.github/workflows/release.yml' || workflow.ref !== 'refs/heads/main' ||
          statement._type !== 'https://in-toto.io/Statement/v1' ||
          statement.predicateType !== 'https://slsa.dev/provenance/v1' ||
          definition.buildType !== 'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1' ||
          definition.resolvedDependencies?.length !== 1 ||
          definition.resolvedDependencies[0].uri !== 'git+https://github.com/urmich/ai-sdlc-framework@refs/heads/main' ||
          definition.resolvedDependencies[0].digest?.gitCommit !== bundle.identity.sourceCommit ||
          statement.predicate.runDetails?.builder?.id !== 'https://github.com/actions/runner/github-hosted' ||
          statement.subject?.length !== 1 || decodeURIComponent(statement.subject[0].name ?? '') !==
            `pkg:npm/${bundle.descriptor.name}@${bundle.identity.version}` ||
          statement.subject[0].digest?.sha512 !== Buffer.from(metadata.dist.integrity.slice('sha512-'.length), 'base64').toString('hex')) {
        throw new Error('Published npm provenance does not match the exact source, package and root release.yml caller');
      }
      partial.npm.semanticBinding = 'Passed';
      const audit = path.join(root, 'registry-audit');
      await fs.mkdir(audit);
      const invoke = args => run(tool.command, [...tool.prefix, ...args], { env: { ...environment,
        npm_config_offline: 'false', npm_config_registry: 'https://registry.npmjs.org', npm_config_color: 'false' },
        cwd: audit, timeout: 600_000, maxBuffer: 8 * 1024 * 1024 });
      await invoke(['install', '--prefix', audit, '--ignore-scripts', '--bin-links=false', '--no-audit',
        '--no-fund', '--save-exact', `${bundle.descriptor.name}@${bundle.identity.version}`,
        '--registry', 'https://registry.npmjs.org']);
      const lock = JSON.parse(await fs.readFile(path.join(audit, 'package-lock.json'), 'utf8'));
      const item = lock.packages?.[`node_modules/${bundle.descriptor.name}`];
      if (!item || item.version !== bundle.identity.version || item.integrity !== metadata.dist.integrity ||
          item.resolved !== metadata.dist.tarball || Object.keys(lock.packages).length !== 2) {
        throw new Error('Signature audit must contain exactly the selected registry package, not a local tgz or empty project');
      }
      const { entries } = payloadIdentity(await fs.readFile(path.join(root, bundle.descriptor.payload.filename)));
      for (const entry of entries) {
        const bytes = await fs.readFile(path.join(audit, 'node_modules', bundle.descriptor.name, ...entry.path.split('/').slice(1)));
        if (!bytes.equals(entry.data)) throw new Error('Registry audit installation differs from the verified frozen payload');
      }
      const auditResult = await invoke(['audit', 'signatures', '--prefix', audit, '--registry', 'https://registry.npmjs.org']);
      if (!/\baudited 1 package\b/u.test(auditResult.stdout) ||
          !/\b1 package has a verified registry signature\b/u.test(auditResult.stdout) ||
          !/\b1 package has a verified attestation\b/u.test(auditResult.stdout)) {
        throw new Error('npm did not cryptographically verify the exact registry package signature and provenance');
      }
      Object.assign(partial.npm, { cryptographicSignatureVerification: 'Passed', packagesVerified: 1,
        toolVersion: tool.version, stdout: auditResult.stdout });
      partial.npm.mechanisms.registrySignature = { required: true, status: 'Passed',
        policy: 'pinned npm audit signatures; exact registry lock and payload',
        verifier: { id: 'npm-audit-signatures', version: tool.version } };
      if (!evidenceAsset || !/^[A-Za-z0-9_.-]+\.tar\.gz$/u.test(evidenceAsset.filename) ||
          !/^[a-f0-9]{64}$/u.test(evidenceAsset.sha256 ?? '')) throw new Error('Exact saved prepublication evidence asset is required');
      const asset = path.join(root, evidenceAsset.filename);
      const bytes = await anonymousBytes(`https://github.com/${bundle.releaseRepository}/releases/download/v${bundle.identity.version}/${evidenceAsset.filename}`, fetcher);
      if (sha256(bytes) !== evidenceAsset.sha256) throw new Error('Public prepublication evidence asset differs from the saved identity');
      await fs.writeFile(asset, bytes, { flag: 'wx' });
      const githubVersion = (await run('gh', ['--version'], { env: environment, cwd: root })).stdout.split(/\r?\n/u)[0];
      if (!/^gh version \d+\.\d+\.\d+\b/u.test(githubVersion)) throw blocked('GitHub attestation verifier identity is unavailable');
      const github = await run('gh', ['attestation', 'verify', asset, '--repo', 'urmich/ai-sdlc-framework',
        '--signer-workflow', 'urmich/ai-sdlc-framework/.github/workflows/release.yml',
        '--signer-digest', bundle.identity.sourceCommit, '--source-digest', bundle.identity.sourceCommit,
        '--source-ref', 'refs/heads/main', '--predicate-type', 'https://slsa.dev/provenance/v1',
        '--deny-self-hosted-runners', '--format', 'json'], { env: { ...environment,
        ...(process.env.GH_TOKEN ? { GH_TOKEN: process.env.GH_TOKEN } : {}) }, cwd: root,
        timeout: 600_000, maxBuffer: 8 * 1024 * 1024 });
      const attestations = JSON.parse(github.stdout);
      partial.github.attestations = attestations;
      partial.github.subjectSha256 = evidenceAsset.sha256;
      const witnessed = Array.isArray(attestations) ? attestations.filter(item =>
        item.verificationResult?.statement?.subject?.length === 1 &&
        item.verificationResult.statement.subject[0].digest?.sha256 === evidenceAsset.sha256) : [];
      if (witnessed.length !== 1) {
        throw new Error('GitHub attestation verifier did not establish the exact subject and signature');
      }
      partial.github.verifier = { id: 'gh-attestation-verify', version: githubVersion };
      partial.github.mechanisms.signature = { required: true, status: 'Passed', policy: 'gh attestation verify' };
      partial.github.mechanisms.certificate = { required: true, status: 'Passed',
        policy: 'exact repository/signer/source/ref/hosted-runner CLI restrictions' };
      if (!witnessed[0].verificationResult.verifiedTimestamps?.some(timestamp => /^tlog$/iu.test(timestamp.type ?? ''))) {
        throw blocked('GitHub verifier did not establish the required witnessed transparency mechanism; TSA-only or unsupported proof remains NotRun');
      }
      return { status: 'Passed', npm: { cryptographicSignatureVerification: 'Passed', packagesVerified: 1,
        toolVersion: tool.version, stdout: auditResult.stdout, verifier: verified.verifier,
        envelopeSha256: sha256(envelopeBytes),
        bundleSha256: verified.bundleSha256, statementSha256: verified.statementSha256,
        signedBundle: envelope[0].bundle, statement, mechanisms: { ...verified.mechanisms,
          registrySignature: { required: true, status: 'Passed', policy: 'pinned npm audit signatures; exact registry lock and payload',
            verifier: { id: 'npm-audit-signatures', version: tool.version } } } },
      github: { cryptographicSignatureVerification: 'Passed', subjectSha256: evidenceAsset.sha256, attestations,
        verifier: { id: 'gh-attestation-verify', version: githubVersion,
          policy: 'exact repository/signer/source/ref/subject; deny self-hosted runners' },
        mechanisms: {
          signature: { required: true, status: 'Passed', policy: 'gh attestation verify' },
          certificate: { required: true, status: 'Passed', policy: { repository: 'urmich/ai-sdlc-framework',
            signerWorkflow: '.github/workflows/release.yml', source: bundle.identity.sourceCommit, ref: 'refs/heads/main' } },
          transparency: { required: true, status: 'Passed', policy: 'verified Tlog timestamp; TSA alone is insufficient' },
        } } };
      } catch (error) {
        if (error.stdout?.trim().startsWith('{')) {
          let failure;
          try { failure = JSON.parse(error.stdout); } catch (parseError) {
            if (!(parseError instanceof SyntaxError)) throw parseError;
          }
          if (failure?.mechanisms && ['NotRun', 'Failed'].includes(failure.status)) {
            partial.npm.mechanisms = failure.mechanisms;
            if (failure.status === 'NotRun') error.code = 'RELEASE_INTEGRATION_BLOCKED';
          }
        }
        partial.status = error.code === 'RELEASE_INTEGRATION_BLOCKED' ? 'NotRun' : 'Failed';
        partial.reason = error.message;
        error.provenance = partial;
        throw error;
      }
    }
export async function acceptPublicHomebrew({ bundle, downloaded, previous, root,
  environment = process.env, brew = process.env.SDLC_PUBLIC_HOMEBREW_BREW ?? process.env.SDLC_HOMEBREW_BREW,
  verifyLifecycle = verifyHomebrewLifecycle }) {
  const formulas = bundle.descriptor.files.filter(file => file.kind === 'homebrew');
  if (formulas.length !== 1 || formulas[0].filename !== 'ai-sdlc-framework.rb') {
    throw new Error('Stable public Homebrew acceptance requires one frozen formula');
  }
  const formulaPath = path.join(downloaded, formulas[0].filename);
  const formulaBytes = await fs.readFile(formulaPath);
  if (formulaBytes.length !== formulas[0].size || sha256(formulaBytes) !== formulas[0].sha256) {
    throw new Error('Downloaded Homebrew formula differs from the frozen release metadata');
  }
  if (!brew || !path.isAbsolute(brew) || !previous || !root) {
    throw blocked('Native public Homebrew acceptance requires an owned prefix and an authentic previous release');
  }
  await fs.access(brew, fs.constants.X_OK);
  if (previous.identity.version === bundle.identity.version) throw new Error('A same-version reinstall is not a prior-version upgrade');
  const priorFormulas = previous.descriptor?.files?.filter(file => file.kind === 'homebrew') ?? [];
  if (priorFormulas.length !== 1) throw blocked('Supported previous public Homebrew formula identity is unavailable');
  const evidence = await verifyLifecycle({ brew, candidateDirectory: previous.directory,
    upgradeDirectory: downloaded, root, targetArch: process.arch, mode: 'public',
    expectedPreviousIdentity: previous.identity, expectedCurrentIdentity: bundle.identity,
    expectedNodeVersion: '22.23.3', environment });
  if (evidence.passed !== true || evidence.upgradeKind !== 'version' ||
      evidence.mode !== 'public' || evidence.publicAcceptance !== 'Passed' ||
      evidence.formulas?.candidate?.source !== 'exact-published-bytes' ||
      evidence.formulas.candidate.sha256 !== priorFormulas[0].sha256 ||
      evidence.formulas?.upgrade?.source !== 'exact-published-bytes' ||
      evidence.formulas.upgrade.sha256 !== formulas[0].sha256 ||
      canonical(evidence.previousIdentity) !== canonical(previous.identity) ||
      canonical(evidence.currentIdentity) !== canonical(bundle.identity) ||
      evidence.platform !== 'darwin' || evidence.architecture !== process.arch || evidence.cleanupError) {
    throw new Error('Actual native Homebrew prior-version upgrade/lifecycle did not pass');
  }
  return { status: 'Passed', authentication: 'anonymous', formulaSha256: formulas[0].sha256,
    nativePlatform: process.platform, nativeArchitecture: process.arch, previous: previous.identity, evidence };
}

async function verifyInstalledHome({ home, version, environment, run, forbidden = [] }) {
  return verifyCopiedHomebrewInstallation({ home, node: process.execPath, frameworkVersion: version,
    forbiddenKegs: forbidden, environment, run });
}

export async function verifyStandaloneConsumer(options) {
  const modes = process.platform === 'win32' ? ['powershell', 'cmd'] : ['bash', 'zsh'];
  const shells = [];
  for (const mode of modes) {
    const root = path.join(options.root, `standalone-${mode}`);
    await fs.mkdir(root);
    shells.push(await verifyStandaloneShell({ ...options, root, mode }));
  }
  return { status: 'Passed', previousVersion: options.previous.identity.version,
    version: options.bundle.identity.version, upgradeKind: 'version', shells };
}

export async function verifySupportedPreviousLifecycle({ bundle, downloaded, previous, ...options }) {
  if (!previous || !['win32', 'darwin'].includes(process.platform)) {
    throw blocked('Supported-previous native lifecycle needs authenticated previous assets and a supported native host');
  }
  requireSupportedPrevious(bundle, previous.identity);
  await verifyHomebrewUpgradeInputs({ candidateDirectory: previous.directory, upgradeDirectory: downloaded,
    previous: previous.identity, current: bundle.identity });
  const result = await verifyStandaloneConsumer({ bundle, downloaded, previous, ...options });
  return { ...result, kind: 'frozen-candidate', previousIdentity: previous.identity, currentIdentity: bundle.identity,
    nativePlatform: process.platform, nativeArchitecture: process.arch, publicAcceptance: 'NotRun' };
}

function requireSupportedPrevious(bundle, selected) {
  const previous = bundle.context?.previousRelease;
  if (!previous || !previous.version || !previous.descriptorSha256 || !previous.checksumsSha256 || !previous.repository) {
    throw blocked('The frozen candidate must independently select the supported previous public release and exact metadata pins');
  }
  for (const key of ['version', 'descriptorSha256', 'checksumsSha256']) {
    if (selected[key] !== previous[key]) throw new Error(`Supported previous release differs from the frozen ${key}`);
  }
  releaseRepository(previous.repository);
  return previous;
}

async function verifyStandaloneShell({ bundle, downloaded, previous, root, environment, mode, run = execute }) {
  const target = process.platform === 'win32' ? 'windows-x64' : `macos-${process.arch}`;
  const currentSource = path.join(root, 'current archive');
  const oldSource = path.join(root, 'previous archive');
  const channel = path.join(root, 'standalone channel');
  const home = path.join(root, 'standalone home');
  await fs.mkdir(home);
  const instructions = path.join(home, 'copilot-instructions.md');
  await fs.writeFile(instructions, 'Unrelated consumer instructions.\n', { flag: 'wx' });
  const preserveUserContent = await seedConsumerPreservation(home);
  for (const [release, sourceDirectory, extracted] of [[bundle, downloaded, currentSource], [previous, previous.directory, oldSource]]) {
    const archive = archiveRecord(release, target);
    const bytes = await fs.readFile(path.join(sourceDirectory, archive.filename));
    if (sha256(bytes) !== archive.sha256) throw new Error('Standalone consumer archive changed after public verification');
    const entries = archive.filename.endsWith('.zip') ? readZip(bytes) : readTarGzip(bytes);
    verifyEntries(entries, { expectedPlatform: process.platform, expectedArch: process.arch });
    await extractEntries(entries, extracted);
  }
  const env = { ...environment, COPILOT_HOME: home, SDLC_NODE: process.execPath };
  const throughCmd = (command, args) => {
    const quote = value => {
      if (/["%!\r\n]/u.test(value)) throw blocked('Unsupported cmd argument path; do not weaken shell policy to run acceptance');
      return `"${value}"`;
    };
    return run('cmd.exe', ['/d', '/s', '/c', `"${[command, ...args].map(quote).join(' ')}"`],
      { env, windowsVerbatimArguments: true });
  };
  const install = async (source, args) => {
    const command = process.platform === 'win32' ? 'powershell.exe' : `/bin/${mode}`;
    const prefix = process.platform === 'win32' ?
      ['-NoProfile', '-NonInteractive', '-File', path.join(source, 'install.ps1')] : [path.join(source, 'install.sh')];
    const forwarded = [...prefix, ...args, '--channel-root', channel, '--home', home];
    return mode === 'cmd' ? throughCmd(command, forwarded) : run(command, forwarded, { env });
  };
  await install(oldSource, ['install']);
  await preserveUserContent();
  await verifyInstalledHome({ home, version: previous.identity.version, environment: env, run });
  await installedConsumerSnapshot(home, previous.identity.version);
  const retained = path.join(home, 'sdlc', 'runtime', 'retained.json');
  await fs.mkdir(path.dirname(retained), { recursive: true });
  await fs.writeFile(retained, '{"preserved":true}\n');
  const preserve = async () => {
    await preserveUserContent();
    assert.equal(await fs.readFile(retained, 'utf8'), '{"preserved":true}\n');
    assert.match(await fs.readFile(instructions, 'utf8'), /^Unrelated consumer instructions\.\n/u);
    await fs.access(process.execPath);
  };
  await install(currentSource, ['install']);
  await preserve();
  await installedConsumerSnapshot(home, bundle.identity.version);
  const launcher = path.join(channel, 'versions', bundle.identity.version, 'bin', process.platform === 'win32' ? 'sdlc.exe' : 'sdlc');
  const invoke = args => mode === 'cmd' ? throughCmd(launcher, [...args, '--home', home]) :
    process.platform === 'win32' ?
      run('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(root, 'invoke-native.ps1'),
        launcher, ...args, '--home', home], { env }) :
      run(`/bin/${mode}`, ['-c', 'exec "$@"', 'sdlc-consumer', launcher, ...args, '--home', home], { env });
  if (mode === 'powershell') await fs.writeFile(path.join(root, 'invoke-native.ps1'),
    '$launcher = $args[0]\n$forwarded = @($args | Select-Object -Skip 1)\n& $launcher @forwarded\nexit $LASTEXITCODE\n', { flag: 'wx' });
  assert.equal(JSON.parse((await invoke(['doctor'])).stdout).frameworkVersion, bundle.identity.version);
  const idempotentUpdate = await assertConsumerUpdate({ home, version: bundle.identity.version, invoke, preserve });
  await fs.rm(oldSource, { recursive: true });
  await fs.rm(path.join(channel, 'versions', previous.identity.version), { recursive: true });
  await verifyInstalledHome({ home, version: bundle.identity.version, environment: env, run,
    forbidden: [oldSource, path.join(channel, 'versions', previous.identity.version)] });
  await preserve();
  const ordinaryUninstall = await assertConsumerUninstall({ home, invoke, preserve });
  assert.equal(JSON.parse((await invoke(['install', '--purge-existing'])).stdout).purgedExisting, true);
  await assert.rejects(fs.access(retained), { code: 'ENOENT' });
  await verifyInstalledHome({ home, version: bundle.identity.version, environment: env, run });
  await installedConsumerSnapshot(home, bundle.identity.version);
  await preserveUserContent();
  const purge = await assertConsumerUninstall({ home, invoke, purge: true, preserve: async () => {
    await preserveUserContent();
    await fs.access(process.execPath);
    assert.match(await fs.readFile(instructions, 'utf8'), /^Unrelated consumer instructions\.\n+$/u);
  } });
  assert.match(await fs.readFile(instructions, 'utf8'), /^Unrelated consumer instructions\.\n+$/u);
  return { status: 'Passed', previousVersion: previous.identity.version,
    version: bundle.identity.version, upgradeKind: 'version', shell: mode,
    idempotentUpdate, ordinaryUninstall, purge, installedEvents: 8 };
}

export async function verifyNpmConsumer({ bundle, previous, root, environment, tool, run = execute }) {
  const prefix = path.join(root, 'npm prefix');
  const home = path.join(root, 'npm home');
  await fs.mkdir(home);
  await fs.writeFile(path.join(home, 'copilot-instructions.md'), 'Unrelated npm consumer instructions.\n');
  const preserveUserContent = await seedConsumerPreservation(home);
  const env = { ...environment, COPILOT_HOME: home };
  const install = artifact => run(tool.command, [...tool.prefix, 'install', '--offline', '--prefix', prefix,
    '--ignore-scripts', '--bin-links=true', '--no-audit', '--no-fund', artifact], { env, cwd: root });
  let publicCommand;
  const invoke = args => publicCommand([...args, '--home', home]);
  await install(path.join(previous.directory, previous.descriptor.payload.filename));
  publicCommand = await npmPublicCommand({ prefix, packageName: bundle.descriptor.name, environment: env, run });
  await invoke(['install']);
  await preserveUserContent();
  await verifyInstalledHome({ home, version: previous.identity.version, environment: env, run });
  await installedConsumerSnapshot(home, previous.identity.version);
  const retained = path.join(home, 'sdlc', 'runtime', 'retained.json');
  await fs.mkdir(path.dirname(retained), { recursive: true });
  await fs.writeFile(retained, '{"preserved":true}\n');
  const preserve = async () => {
    await preserveUserContent();
    assert.equal(await fs.readFile(retained, 'utf8'), '{"preserved":true}\n');
    assert.match(await fs.readFile(path.join(home, 'copilot-instructions.md'), 'utf8'), /^Unrelated npm consumer instructions\.\n/u);
    await fs.access(process.execPath);
  };
  await install(path.join(root, bundle.descriptor.payload.filename));
  await preserve();
  publicCommand = await npmPublicCommand({ prefix, packageName: bundle.descriptor.name, environment: env, run });
  assert.equal(JSON.parse(await fs.readFile(path.join(prefix, 'node_modules', bundle.descriptor.name, 'package.json'))).version,
    bundle.identity.version, 'npm did not actually replace the previous package');
  const idempotentUpdate = await assertConsumerUpdate({ home, version: bundle.identity.version, invoke, preserve });
  await verifyInstalledHome({ home, version: bundle.identity.version, environment: env, run });
  const ordinaryUninstall = await assertConsumerUninstall({ home, invoke, preserve });
  assert.equal(JSON.parse((await invoke(['install', '--purge-existing'])).stdout).purgedExisting, true);
  await assert.rejects(fs.access(retained), { code: 'ENOENT' });
  await verifyInstalledHome({ home, version: bundle.identity.version, environment: env, run });
  await installedConsumerSnapshot(home, bundle.identity.version);
  await preserveUserContent();
  const purge = await assertConsumerUninstall({ home, invoke, purge: true, preserve: async () => {
    await preserveUserContent();
    await fs.access(process.execPath);
    assert.match(await fs.readFile(path.join(home, 'copilot-instructions.md'), 'utf8'), /^Unrelated npm consumer instructions\.\n+$/u);
  } });
  assert.match(await fs.readFile(path.join(home, 'copilot-instructions.md'), 'utf8'), /^Unrelated npm consumer instructions\.\n+$/u);
  await run(tool.command, [...tool.prefix, 'uninstall', '--offline', '--prefix', prefix, '--ignore-scripts', '--no-audit',
    '--no-fund', bundle.descriptor.name], { env, cwd: root });
  await assert.rejects(fs.lstat(path.join(prefix, 'node_modules', bundle.descriptor.name)), { code: 'ENOENT' });
  await assert.rejects(fs.lstat(path.join(prefix, 'node_modules', '.bin',
    process.platform === 'win32' ? 'sdlc.cmd' : 'sdlc')), { code: 'ENOENT' });
  await preserveUserContent();
  return { status: 'Passed', previousVersion: previous.identity.version,
    version: bundle.identity.version, upgradeKind: 'version', authentication: 'anonymous',
    command: process.platform === 'win32' ? 'npm-generated-sdlc.cmd' : 'npm-generated-sdlc',
    idempotentUpdate, ordinaryUninstall, purge, installedEvents: 8 };
}

export function consumerScope(environment = process.env) {
  return { repository: environment.GITHUB_REPOSITORY, repositoryId: environment.GITHUB_REPOSITORY_ID,
    workflowRef: environment.GITHUB_WORKFLOW_REF, runId: environment.GITHUB_RUN_ID,
    attempt: environment.GITHUB_RUN_ATTEMPT };
}

async function retainConsumerExecution({ result, bundle, outputFile }) {
  if (!suffixes[result.target] || !result.native) return;
  const plan = await fs.readFile(path.join(ROOT, 'docs', 'sdlc', 'public-readiness', 'test-plan.md'), 'utf8');
  const specification = consumerSpecification(plan, result.target);
  const tree = (await execute('git', ['rev-parse', `${bundle.identity.sourceCommit}^{tree}`], { cwd: ROOT })).stdout.trim();
  const context = expectedConsumerContext({ bundle, specification, plan, tree, target: result.target,
    native: result.native, scope: consumerScope() });
  const report = { schemaVersion: 1, kind: 'test-execution', context,
    startedAt: result.startedAt, finishedAt: result.finishedAt, observedAt: result.finishedAt,
    sequence: 1, complete: result.status !== 'NotRun', exitCode: result.status === 'Passed' ? 0 : 1,
    results: specification.cases.flatMap(test => test.assertions.map(assertion => {
      const status = result[assertion.selector.procedure === 'public-assets' ? 'publicAssets' : assertion.selector.procedure]?.status ?? 'NotRun';
      return { testId: test.id, assertionId: assertion.id, selector: assertion.selector, status,
        expectedMet: status === 'Passed' ? true : status === 'Failed' ? false : null,
        expectedDigest: test.expectedDigest, checkpoint: test.checkpoint,
        observedAt: result.finishedAt, sourceSequence: 1, durationMs: Date.parse(result.finishedAt) - Date.parse(result.startedAt),
        exitCode: status === 'Passed' ? 0 : 1, detail: 'Actual anonymous native consumer procedure; original commands retained separately' };
    })) };
  const normalized = normalizeExecutionReport(report, context, input => ({
    verifierId: 'published-consumer-host', reportDigest: input.reportDigest, context,
    sourceTime: result.finishedAt, sourceSequence: 1,
  }));
  const evaluation = evaluateReadiness(specification, [normalized], {
    profile: specification.profile, executions: [{ id: `consumer-${result.target}`, context }],
    now: new Date().toISOString(), policy: { maxAgeMs: 24 * 60 * 60 * 1000,
      revisionPolicy: 'exact', verifierIds: ['published-consumer-host'] },
  });
  await writeJson(`${outputFile}.execution.json`, report);
  await writeJson(`${outputFile}.readiness-bundle.json`, createEvidenceBundle(evaluation));
  const readable = renderReadinessReport(evaluation, { completeReportRef:
    `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${result.run.id}/attempts/${result.run.attempt}` });
  await fs.writeFile(`${outputFile}.readiness.md`, readable, { flag: 'wx' });
  if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, readable);
  if (evaluation.status !== 'Passed' && result.status === 'Passed') throw new Error('Complete consumer readiness did not pass');
}

export async function retainConsumerResult({ result, bundle, outputFile, commandFile, toolchain,
  scope = consumerScope() }) {
  await writeJson(outputFile, sanitizeConsumerResultPayload(Buffer.from(JSON.stringify(result))));
  await fs.copyFile(commandFile, `${outputFile}.commands.jsonl`).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (toolchain) await writeJson(`${outputFile}.toolchain.json`,
    sanitizeExecutionPayload(Buffer.from(JSON.stringify(toolchain))));
  if (result.native) {
    const binding = { target: result.target, sourceCommit: bundle.identity.sourceCommit,
      releaseIntentId: bundle.releaseIntentId, scope, native: result.native,
      files: await consumerOriginalInventory(outputFile) };
    process.stdout.write(`${consumerEvidenceMarker}${canonical(binding)}\n`);
  }
}

export async function acceptRelease({ directory, outputFile, target, previousVersion,
  previousDescriptorSha256, previousChecksumsSha256, evidenceFilename, evidenceSha256, ...expected }) {
  const bundle = await verifyBundle({ directory, ...expected });
  requirePublicationReady(bundle);
  const root = path.join(ROOT, '.test-data', `release-acceptance-${randomUUID()}`);
  await fs.mkdir(root, { recursive: true });
  const result = { schemaVersion: 1, identity: bundle.identity,
    releaseIntentId: bundle.releaseIntentId, target, profile: 'r-post', status: 'NotRun',
    run: { id: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT },
    startedAt: new Date().toISOString(), commands: [],
    publicAssets: { status: 'NotRun' }, standalone: { status: 'NotRun' },
    npm: { status: 'NotRun' }, provenance: { status: 'NotRun' }, homebrew: bundle.context.prerelease ?
      { status: 'NotApplicable', reason: 'Prereleases do not publish stable Homebrew metadata' } :
      { status: 'NotRun', reason: 'Required exact public Homebrew lifecycle has not executed' },
    wingetCommunity: { status: 'NotRun', reason: 'Community/client access needs separately authorized capabilities' },
    corporateWindows: { status: 'NotRun', reason: 'No corporate-managed-device or IT-policy bypass is performed' },
    windowsNetworkDenial: { status: 'NotRun', reason: 'No validated approved native Windows denial adapter exists' } };
  let toolchain;
  const procedure = async (name, action) => {
    try { return result[name] = await action(); }
    catch (error) {
      result[name] = error.provenance ?? {
        status: error.code === 'RELEASE_INTEGRATION_BLOCKED' ? 'NotRun' : 'Failed', reason: error.message };
      throw error;
    }
  };
  const command = async (executable, args, options = {}) => {
    const record = { executable, args, startedAt: new Date().toISOString(), exitCode: null };
    result.commands.push(record);
    try {
      const output = await execute(executable, args, { cwd: ROOT, timeout: 600_000,
        maxBuffer: 8 * 1024 * 1024, ...options });
      Object.assign(record, { exitCode: 0, stdout: output.stdout, stderr: output.stderr });
      return output;
    } catch (error) {
      Object.assign(record, { exitCode: Number.isInteger(error.code) ? error.code : null,
        diagnostic: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? error.message });
      throw error;
    } finally {
      record.finishedAt = new Date().toISOString();
      await fs.appendFile(path.join(root, 'commands.jsonl'),
        `${JSON.stringify(sanitizeExecutionPayload(Buffer.from(JSON.stringify(record))))}\n`);
    }
  };
  try {
    const actualTarget = process.platform === 'win32' ? `windows-${process.arch}` :
      process.platform === 'darwin' ? `macos-${process.arch}` : null;
    if (!suffixes[target] || actualTarget !== target || process.versions.node !== '22.23.3' ||
        process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
        !process.env.ImageOS || !process.env.ImageVersion ||
        !['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_REPOSITORY_ID'].every(key => /^[1-9]\d*$/u.test(process.env[key] ?? ''))) {
      throw blocked('Postpublication consumers require their exact native hosted Windows/ARM/Intel target and Node 22.23.3');
    }
    await runtimePreflight();
    if (!process.env.SDLC_NATIVE_TOOLCHAIN_REPORT) throw blocked('Native consumer bootstrap report is unavailable');
    toolchain = JSON.parse(await fs.readFile(process.env.SDLC_NATIVE_TOOLCHAIN_REPORT, 'utf8').catch(error => {
      if (error.code === 'ENOENT') throw blocked('Native consumer bootstrap report is unavailable');
      throw error;
    }));
    if (toolchain.status !== 'Passed' || toolchain.target !== target) throw blocked('Exact native bootstrap evidence is unavailable');
    if (process.platform === 'darwin') result.nativeProbe = await assertNativeMacHost(command);
    result.native = { kind: 'native', platform: process.platform, architecture: process.arch,
      node: process.versions.node, image: `${process.env.ImageOS}/${process.env.ImageVersion}`, bootstrap: toolchain.native };
    const downloaded = path.join(root, 'public-assets');
    await procedure('publicAssets', () => downloadPublicAssets(bundle, downloaded));
    const previousPins = requireSupportedPrevious(bundle, { version: previousVersion,
      descriptorSha256: previousDescriptorSha256, checksumsSha256: previousChecksumsSha256 });
    const previous = await downloadPreviousRelease({ repository: previousPins.repository,
      version: previousVersion, descriptorSha256: previousDescriptorSha256, checksumsSha256: previousChecksumsSha256,
      directory: path.join(root, 'previous-public-assets') });
    if (previous.identity.version === bundle.identity.version) throw new Error('Consumers require an actual prior-version upgrade');
    await verifyHomebrewUpgradeInputs({ candidateDirectory: previous.directory, upgradeDirectory: downloaded,
      previous: previous.identity, current: bundle.identity });
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !/token|credential|password|secret|auth|proxy|^npm_|^node_options$|^node_path$|^copilot_home$/iu.test(key)));
    Object.assign(env, { HOME: path.join(root, 'home'), USERPROFILE: path.join(root, 'home'),
      TMPDIR: root, TMP: root, TEMP: root, npm_config_cache: path.join(root, 'npm-cache'),
      npm_config_userconfig: path.join(root, 'npmrc'), npm_config_globalconfig: path.join(root, 'global-npmrc'),
      npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false',
      npm_config_update_notifier: 'false', SDLC_NODE: process.execPath });
    await fs.mkdir(env.HOME);
    await fs.writeFile(env.npm_config_userconfig, '');
    await fs.writeFile(env.npm_config_globalconfig, '');
    {
      const identity = { name: bundle.descriptor.name, version: bundle.identity.version,
        sha256: bundle.identity.payloadSha256 };
      const metadata = await boundedReadback(() => registryPackage(identity.name, identity.version));
      const bytes = await verifyRegistryPayload(metadata, identity);
      const artifact = path.join(root, bundle.descriptor.payload.filename);
      await fs.writeFile(artifact, bytes, { flag: 'wx' });
      payloadIdentity(bytes);
      const previousMetadata = await registryPackage(identity.name, previous.identity.version);
      if (!previousMetadata) throw blocked('The authentic supported previous npm version is unavailable');
      const oldBytes = await verifyRegistryPayload(previousMetadata, { name: identity.name, version: previous.identity.version,
        sha256: previous.identity.payloadSha256 });
      assert.ok(oldBytes.equals(await fs.readFile(path.join(previous.directory, previous.descriptor.payload.filename))),
        'Previous npm and GitHub payload bytes differ');
      const tool = await pinnedNpmTool({ root, environment: env, run: command });
      await procedure('provenance', () => verifyPublishedProvenance({ bundle, metadata, root, tool,
        environment: env, run: command, evidenceAsset: { filename: evidenceFilename, sha256: evidenceSha256 } }));
      await procedure('npm', () => verifyNpmConsumer({ bundle, previous, root, environment: env, tool, run: command }));
    }
    await procedure('standalone', () => verifyStandaloneConsumer({ bundle, downloaded, previous, root, environment: env, run: command }));
    if (process.platform === 'darwin' && !bundle.context.prerelease) {
      await procedure('homebrew', () => acceptPublicHomebrew({ bundle, downloaded, previous,
        root: path.join(root, 'homebrew-public-native'), environment: env }));
    }
    result.status = 'Passed';
    return result;
  } catch (error) {
    result.status = error.code === 'RELEASE_INTEGRATION_BLOCKED' ? 'NotRun' : 'Failed';
    if (error.code === 'RELEASE_INTEGRATION_BLOCKED') result.diagnosticStatus = 'Blocked';
    result.reason = error.message;
    if (error.provenance) result.provenance = error.provenance;
    if (error.stdout) process.stdout.write(error.stdout);
    if (error.stderr) process.stderr.write(error.stderr);
    throw error;
  } finally {
    result.finishedAt = new Date().toISOString();
    let readinessError;
    try { await retainConsumerExecution({ result, bundle, outputFile }); }
    catch (error) {
      readinessError = error;
      if (result.status === 'Passed') result.status = 'NotRun';
      result.readinessDiagnostic = error.message;
    }
    await retainConsumerResult({ result, bundle, outputFile,
      commandFile: path.join(root, 'commands.jsonl'), toolchain });
    await fs.rm(root, { recursive: true, force: true });
    if (readinessError) throw readinessError;
  }
}

async function releaseSourceTree(revision) {
  return (await execute('git', ['rev-parse', `${revision}^{tree}`], { cwd: ROOT })).stdout.trim();
}

async function releaseTestPlan() {
  return fs.readFile(path.join(ROOT, 'docs', 'sdlc', 'public-readiness', 'test-plan.md'), 'utf8');
}

async function retainProvenanceExecution({ plan, bundle, consumers, outputDir, environment = process.env,
  readSourceTree = releaseSourceTree, sourceTree }) {
  const definition = parseTestPlan(plan).find(test => test.id === 'T-PRD042');
  if (!definition) throw new Error('The required provenance case is missing from the Test Plan');
  const observedAt = new Date().toISOString();
  const specification = { schemaVersion: 1, profile: 'r-post-provenance', cases: [{
    id: definition.id, conditions: definition.conditions, expectedDigest: digest(definition.expected),
    executionId: 'release-provenance', mode: definition.mode, owner: definition.owner,
    location: definition.location, checkpoint: definition.checkpoint,
    assertions: Object.keys(suffixes).map(target => ({ id: `provenance-${target}`,
      selector: { procedure: 'native-published-provenance', target } })),
  }] };
  const tree = sourceTree ?? await readSourceTree(bundle.identity.sourceCommit);
  const scope = consumerScope(environment);
  const context = {
    candidateDigest: digest({ revision: bundle.identity.sourceCommit, tree }), testSpecDigest: testSpecificationDigest(plan),
    configDigest: digest({ profile: specification.profile, npm: '11.16.0', sourceWorkflow: '.github/workflows/release.yml' }),
    inventoryDigest: validationInventoryDigest(specification), profile: specification.profile,
    sources: [{ repositoryId: `repository-${scope.repositoryId}`, revision: bundle.identity.sourceCommit,
      contentDigest: digest(tree) }], environment: 'local', location: definition.location, mode: definition.mode, owner: definition.owner,
    native: { kind: 'native', platform: process.platform, architecture: process.arch,
      image: `${environment.ImageOS}/${environment.ImageVersion}`, toolchain: { node: process.versions.node } },
    producer: { provider: 'github', connection: 'repository-ci', scopeRef: `repository:${scope.repositoryId}`,
      definitionRef: scope.workflowRef, executionRef: scope.runId,
      attemptKind: 'known', attemptRef: scope.attempt },
    attemptCapability: 'distinct', jobRef: 'completion', intentId: bundle.releaseIntentId,
    artifacts: [{ name: 'frozen-descriptor', sha256: bundle.identity.descriptorSha256 },
      { name: 'frozen-checksums', sha256: bundle.identity.checksumsSha256 },
      ...bundle.descriptor.files.map(file => ({ name: file.filename, sha256: file.sha256 }))],
  };
  const results = specification.cases[0].assertions.flatMap(assertion => {
    const original = consumers.find(result => result.target === assertion.selector.target);
    if (!original) return [];
    return [{ testId: definition.id, assertionId: assertion.id, selector: assertion.selector, status: 'Passed',
      expectedMet: true, expectedDigest: specification.cases[0].expectedDigest, checkpoint: definition.checkpoint,
      observedAt, sourceSequence: 1, durationMs: 0, exitCode: 0,
      detail: `Independently verified original native consumer ${original.run.id}/${original.run.attempt}; source record SHA-256 ${sha256(Buffer.from(canonical(original)))}` }];
  });
  const raw = { schemaVersion: 1, kind: 'test-execution', context, startedAt: observedAt, finishedAt: observedAt,
    observedAt, sequence: 1, complete: results.length === 3, exitCode: 0, results };
  const normalized = normalizeExecutionReport(raw, context, input => ({
    verifierId: 'release-completion-host', reportDigest: input.reportDigest, context, sourceTime: observedAt, sourceSequence: 1,
  }));
  const evaluation = evaluateReadiness(specification, [normalized], {
    profile: specification.profile, executions: [{ id: 'release-provenance', context }], now: observedAt,
    policy: { maxAgeMs: 86_400_000, revisionPolicy: 'exact', verifierIds: ['release-completion-host'] },
  });
  const reportFile = 'provenance-execution.json';
  const readinessFile = 'provenance-readiness-bundle.json';
  await writeJson(path.join(outputDir, reportFile), raw);
  await writeJson(path.join(outputDir, readinessFile), createEvidenceBundle(evaluation));
  return { status: evaluation.status, specification, context, sourceTime: observedAt, sourceSequence: 1,
    reportFile, reportSha256: sha256(await fs.readFile(path.join(outputDir, reportFile))),
    readinessFile, readinessSha256: sha256(await fs.readFile(path.join(outputDir, readinessFile))) };
}

export function consumerLifecyclePassed(result, target, previousVersion, version, evidenceSha256) {
  const maintenance = item => item?.idempotentUpdate?.status === 'Passed' &&
    item.ordinaryUninstall?.status === 'Passed' && item.purge?.status === 'Passed' && item.installedEvents === 8;
  const mechanisms = item => ['signature', 'certificate', 'transparency'].every(name =>
    item?.mechanisms?.[name]?.required === true && item.mechanisms[name].status === 'Passed');
  return result.standalone?.upgradeKind === 'version' && result.npm?.upgradeKind === 'version' &&
    result.standalone.previousVersion === previousVersion && result.npm.previousVersion === previousVersion &&
    result.standalone.version === version && result.npm.version === version &&
    result.standalone.shells?.length === 2 && result.standalone.shells.every(shell =>
      shell.status === 'Passed' && shell.upgradeKind === 'version' && shell.previousVersion === previousVersion &&
      shell.version === version && maintenance(shell)) &&
    canonical(result.standalone.shells.map(shell => shell.shell).sort()) ===
      canonical((target === 'windows-x64' ? ['cmd', 'powershell'] : ['bash', 'zsh']).sort()) &&
    maintenance(result.npm) &&
    result.npm.command === (target === 'windows-x64' ? 'npm-generated-sdlc.cmd' : 'npm-generated-sdlc') &&
    result.provenance?.status === 'Passed' &&
    result.provenance.npm?.cryptographicSignatureVerification === 'Passed' &&
    result.provenance.github?.cryptographicSignatureVerification === 'Passed' &&
    mechanisms(result.provenance.npm) && mechanisms(result.provenance.github) &&
    result.provenance.npm.mechanisms.registrySignature?.required === true &&
    result.provenance.npm.mechanisms.registrySignature.status === 'Passed' &&
    result.provenance.npm.mechanisms.registrySignature.verifier?.id === 'npm-audit-signatures' &&
    result.provenance.npm.mechanisms.registrySignature.verifier.version === '11.16.0' &&
    result.provenance.npm.verifier?.id === 'npm-bundled-sigstore' &&
    result.provenance.npm.verifier.npmVersion === '11.16.0' &&
    result.provenance.github.verifier?.id === 'gh-attestation-verify' &&
    result.provenance.github.subjectSha256 === evidenceSha256 &&
    (target === 'windows-x64' || (result.homebrew?.status === 'Passed' &&
      result.homebrew.evidence?.mode === 'public' && result.homebrew.evidence.publicAcceptance === 'Passed' &&
      result.homebrew.evidence.upgradeKind === 'version' &&
      result.homebrew.evidence.previousIdentity?.version === previousVersion &&
      canonical(result.homebrew.evidence.currentIdentity) === canonical(result.identity) &&
      result.homebrew.evidence.formulas?.upgrade?.sha256 === result.homebrew.formulaSha256 &&
      result.homebrew.evidence.formulas.upgrade.source === 'exact-published-bytes' &&
      !result.homebrew.evidence.cleanupError));
}

export async function completeRelease({ directory, evidenceDir, npmResultFile, githubResultFile, draftResultFile,
  prepublicationEvidenceSha256, prepublicationEvidenceFilename, publicationHistoryDir,
  outputDir, api = githubRequest, environment = process.env,
  verifyConsumerOrigin = acquireConsumerOrigin, readSourceTree = releaseSourceTree,
  readTestPlan = releaseTestPlan, ...expected }) {
  const bundle = await verifyBundle({ directory, ...expected });
  requirePublicationReady(bundle);
  await emptyDirectory(outputDir);
  const completion = { schemaVersion: 1, profile: 'r-post', identity: bundle.identity,
    releaseIntentId: bundle.releaseIntentId, status: 'NotRun', blockers: [], consumers: [], consumerAttempts: [],
    cases: [...Object.values(suffixes).flatMap(suffix => ['038', '039'].map(number =>
      ({ testId: `T-PRD${number}-${suffix}`, status: 'NotRun' }))), { testId: 'T-PRD042', status: 'NotRun' }],
    publication: { npm: { status: 'NotRun' }, github: { status: 'NotRun' } } };
  const optionalJson = async file => {
    if (!file) return null;
    try {
      const stat = await fs.lstat(file);
      assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 4 * 1024 * 1024,
        'Completion input must be a bounded literal JSON original');
      return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') completion.blockers.push(`Rejected completion original ${path.basename(file)}: ${error.message}`);
      return null;
    }
  };
  completion.publication.npm = await optionalJson(npmResultFile) ?? completion.publication.npm;
  completion.publication.github = await optionalJson(githubResultFile) ?? completion.publication.github;
  if (draftResultFile) completion.publication.github.draftAttempt = await optionalJson(draftResultFile) ??
    { status: 'NotRun', reason: 'Original draft attempt evidence is unavailable' };
  if (!['PublishedAndBytesVerified', 'AlreadyPublishedIdentical'].includes(completion.publication.npm.status) ||
      completion.publication.npm.sourceCommit !== bundle.identity.sourceCommit ||
      completion.publication.npm.bundleSha256 !== expected.expectedBundleSha256 ||
      completion.publication.npm.releaseIntentId !== bundle.releaseIntentId ||
      completion.publication.github.github?.status !== 'Published' ||
      canonical(completion.publication.github.identity) !== canonical(bundle.identity)) {
    completion.blockers.push('Exact npm/GitHub publication effects are incomplete; partial channel outcomes are retained');
  }
  const plan = await readTestPlan();
  assert.equal(typeof plan, 'string', 'Completion needs the independently selected canonical Test Plan text');
  const planPath = 'docs/sdlc/public-readiness/test-plan.md';
  const { validateNativeSourceDefinitions } = await import('./native-validation.mjs');
  validateNativeSourceDefinitions([{ file: planPath, contents: plan }]);
  if (!/^[a-f0-9]{64}$/u.test(prepublicationEvidenceSha256 ?? '')) completion.blockers.push('Exact selected prepublication evidence digest is unavailable');
  const validPrepublicationFilename = prepublicationEvidenceFilename &&
    /^release-prepublication-[A-Za-z0-9_-]+-[1-9]\d*-[1-9]\d*-[a-f0-9]{64}\.tar\.gz$/u.test(prepublicationEvidenceFilename) &&
    prepublicationEvidenceFilename.endsWith(`-${prepublicationEvidenceSha256}.tar.gz`);
  if (prepublicationEvidenceFilename && !validPrepublicationFilename) {
    completion.blockers.push('Prepublication evidence filename does not match its exact immutable archive digest');
  }
  let sourceTree = null;
  try {
    sourceTree = await readSourceTree(bundle.identity.sourceCommit);
    assert.match(sourceTree, /^[a-f0-9]{40}$/u, 'Frozen source tree is unavailable');
  } catch (error) {
    sourceTree = null;
    completion.blockers.push(`Independent frozen source tree is unavailable: ${error.message}`);
  }
  const inputs = { schemaVersion: 1, kind: 'release-completion-inputs', identity: bundle.identity,
    releaseIntentId: bundle.releaseIntentId, bundleSha256: sha256(await fs.readFile(path.join(directory, 'bundle.json'))),
    source: { repository: environment.GITHUB_REPOSITORY, repositoryId: environment.GITHUB_REPOSITORY_ID,
      revision: bundle.identity.sourceCommit, tree: sourceTree },
    specification: { path: planPath, text: plan,
      sha256: sha256(Buffer.from(plan)), definitionDigest: testSpecificationDigest(plan) },
    scope: consumerScope(environment), previousRelease: bundle.context?.previousRelease ?? null,
    prepublicationEvidence: { sha256: prepublicationEvidenceSha256 ?? null,
      ...(validPrepublicationFilename ? { filename: prepublicationEvidenceFilename } : {}) },
    policy: { maxAgeMs: 86_400_000, revisionPolicy: 'exact' }, consumers: [], provenance: null, publicationHistory: null };
  try {
    inputs.publicationHistory = await retainPublicationHistoryOriginals({ directory: publicationHistoryDir,
      outputDir, bundle, sourceRepository: environment.GITHUB_REPOSITORY });
    if (publicationHistoryDir && !inputs.publicationHistory?.complete) {
      completion.blockers.push('Original npm publication history is incomplete or invalid; retained records remain available');
    }
  } catch (error) {
    completion.blockers.push(`Original npm publication history is unavailable or rejected: ${error.message}`);
  }
  const previousVersion = bundle.context?.previousRelease?.version;
  if (!previousVersion || previousVersion !== environment.SUPPORTED_PREVIOUS_VERSION) {
    completion.blockers.push('Supported previous release selection differs from the independently frozen candidate');
  }
  for (const target of Object.keys(suffixes)) {
    const file = path.join(evidenceDir, `${target}.json`);
    const retained = await retainConsumerOriginals({ file, outputDir });
    const originalInput = { target, resultFile: `${target}.json`, reportFile: `${target}.json.execution.json`,
      retained, origin: null, expectedContext: null, sourceTime: null, sourceSequence: 1, evaluatedAt: null };
    inputs.consumers.push(originalInput);
    const attempt = { target, status: 'NotRun', originalOutcome: 'NotRun',
      retained, origin: { kind: 'unverified-local-original' } };
    completion.consumerAttempts.push(attempt);
    if (retained.diagnostics.length) {
      completion.blockers.push(`Consumer original retention is incomplete: ${target}; see retained diagnostics`);
    }
    if (!retained.records.some(record => record.filename === `${target}.json`) ||
        !retained.records.some(record => record.filename === `${target}.json.execution.json`)) {
      completion.blockers.push(`Missing complete actual native consumer: ${target}`);
      continue;
    }
    const result = await optionalJson(file);
    const report = await optionalJson(`${file}.execution.json`);
    if (!result || !report) {
      completion.blockers.push(`Missing complete actual native consumer: ${target}`);
      continue;
    }
    attempt.originalOutcome = result.status;
    const specification = consumerSpecification(plan, target);
    if (result.profile !== 'r-post' || result.target !== target ||
        canonical(result.identity) !== canonical(bundle.identity) ||
        result.releaseIntentId !== bundle.releaseIntentId) {
      attempt.reason = 'Foreign consumer result identity; retained for diagnostics without current credit';
      completion.blockers.push(`Native consumer identity mismatch: ${target}`);
      continue;
    }
    let origin;
    let context;
    try {
      origin = await verifyConsumerOrigin({ bundle, target, file, api, scope: consumerScope(environment) });
      originalInput.origin = origin;
      context = expectedConsumerContext({ bundle, specification, plan, tree: sourceTree, target,
        native: origin.native, scope: origin.scope });
      originalInput.expectedContext = context;
      originalInput.sourceTime = origin.finishedAt;
      const bootstrap = await optionalJson(`${file}.toolchain.json`);
      assert.ok(bootstrap?.status === 'Passed' && bootstrap.target === target &&
        canonical(bootstrap.native) === canonical(origin.native.bootstrap),
      'Original native bootstrap differs from the independently acquired producer facts');
      attempt.origin = origin.origin;
    } catch (error) {
      attempt.reason = `Consumer origin/context unavailable or mismatched: ${error.message}`;
      completion.blockers.push(`Native consumer independent binding failed: ${target}; ${error.message}`);
      continue;
    }
    let evaluation;
    try {
      originalInput.evaluatedAt = new Date().toISOString();
      const replay = evaluateConsumerOriginal({ bundle, plan, tree: sourceTree, target, result, report,
        now: originalInput.evaluatedAt, verifyOrigin: ({ resultSha256, reportSha256 }) => {
          assert.equal(resultSha256, origin.origin.files.find(record => record.filename === `${target}.json`)?.sha256,
            'Parsed consumer result differs from its independently acquired original');
          assert.equal(reportSha256, origin.origin.files.find(record => record.filename === `${target}.json.execution.json`)?.sha256,
            'Parsed consumer report differs from its independently acquired original');
          return origin;
        },
      });
      evaluation = replay.evaluation;
    } catch (error) {
      attempt.reason = `Rejected original consumer execution: ${error.message}`;
      completion.blockers.push(`Native consumer execution binding failed: ${target}; ${error.message}`);
      continue;
    }
    for (const test of evaluation.cases) completion.cases.find(row => row.testId === test.testId).status = test.status;
    attempt.status = evaluation.status;
    attempt.reason = result.reason ?? '';
    attempt.producerConclusion = origin.conclusion;
    attempt.stepConclusion = origin.stepConclusion;
    if (evaluation.status !== 'Passed' || result.status !== 'Passed' || !origin.producerPassed || retained.diagnostics.length) {
      if (evaluation.status === 'Passed') {
        for (const test of evaluation.cases) completion.cases.find(row => row.testId === test.testId).status = 'NotRun';
        attempt.status = 'NotRun';
      }
      completion.blockers.push(`Native consumer assertion inventory did not pass: ${target}`);
      continue;
    }
    if (!consumerLifecyclePassed(result, target, previousVersion,
      bundle.identity.version, prepublicationEvidenceSha256)) {
      for (const test of evaluation.cases) completion.cases.find(row => row.testId === test.testId).status = 'NotRun';
      attempt.status = 'NotRun';
      attempt.reason = 'Required lifecycle/public formula/individual provenance mechanism postconditions are incomplete';
      completion.blockers.push(`Native consumer lifecycle/provenance mismatch: ${target}`);
      continue;
    }
    completion.consumers.push(result);
  }
  const provenance = completion.consumers.length ? await retainProvenanceExecution({
    plan, bundle, consumers: completion.consumers.filter(result => result.provenance.status === 'Passed'), outputDir,
    environment, readSourceTree, sourceTree }) : null;
  inputs.provenance = provenance;
  completion.cases.find(test => test.testId === 'T-PRD042').status = provenance?.status ?? 'NotRun';
  if (completion.cases.length !== 7 || completion.cases.some(test => test.status !== 'Passed')) {
    completion.blockers.push('R-POST requires all six native consumer cases and cryptographic provenance');
  }
  completion.status = completion.cases.some(test => test.status === 'Failed') ? 'Failed' :
    completion.blockers.length ? 'NotRun' : 'Passed';
  inputs.observedAt = new Date().toISOString();
  const { specification: exactSpecification, ...diagnosticInputs } = inputs;
  const retainedInputs = { ...sanitizeExecutionPayload(Buffer.from(canonical(diagnosticInputs))),
    specification: exactSpecification };
  const bindings = value => ({ identity: value.identity, releaseIntentId: value.releaseIntentId,
    bundleSha256: value.bundleSha256, source: value.source, specification: value.specification,
    scope: value.scope, previousRelease: value.previousRelease, prepublicationEvidence: value.prepublicationEvidence,
    publicationHistory: value.publicationHistory ? Object.fromEntries(Object.entries(value.publicationHistory)
      .filter(([name]) => name !== 'diagnostics')) : null,
    policy: value.policy, observedAt: value.observedAt, provenance: value.provenance,
    consumers: value.consumers.map(({ retained, ...input }) => input) });
  assert.equal(canonical(bindings(retainedInputs)), canonical(bindings(inputs)),
    'Completion retention cannot sanitize away independently verified identity or origin bindings');
  await writeJson(path.join(outputDir, 'completion-inputs.json'), retainedInputs);
  completion.inputClosure = { filename: 'completion-inputs.json',
    sha256: sha256(await fs.readFile(path.join(outputDir, 'completion-inputs.json'))) };
  await writeJson(path.join(outputDir, 'completion.json'), sanitizeExecutionPayload(Buffer.from(JSON.stringify(completion))));
  const readable = sanitizeExecutionPayload(Buffer.from(`# Release completion\n\nStatus: **${completion.status}**\n\n` +
    `Source: \`${bundle.identity.sourceCommit}\`\n\nIntent: \`${bundle.releaseIntentId}\`\n\n` +
    `Retained input closure: \`completion-inputs.json\` (SHA-256 \`${completion.inputClosure.sha256}\`), captured \`${inputs.observedAt}\`.\n\n` +
    `Npm publication originals: ${inputs.publicationHistory ? `${inputs.publicationHistory.originals.length} retained; ` +
      `${inputs.publicationHistory.complete ? 'complete' : 'incomplete'} collection in \`npm-publication-history.json\`` :
      'none selected or unavailable; see blockers for any required missing history'}.\n\n` +
    completion.cases.map(test => `- ${test.testId}: ${test.status}\n`).join('') +
    completion.consumerAttempts.map(attempt =>
      `- ${attempt.target}: ${attempt.status}; original ${attempt.originalOutcome}; ${attempt.reason ?? ''}` +
      `${attempt.origin.jobUrl ? `; execution: ${attempt.origin.jobUrl}` : '; origin unverified'}` +
      `; ${attempt.retained.records.length} sanitized originals retained with original/retained digests\n`).join('') +
    completion.blockers.map(reason => `- Blocked: ${reason}\n`).join('') +
    '\nWinGet community/corporate-device availability and unsupported Windows network denial remain explicit NotRun limitations, not release support claims.\n'));
  await fs.writeFile(path.join(outputDir, 'completion.md'), readable, { flag: 'wx' });
  const entries = await Promise.all((await fs.readdir(outputDir)).map(async name => ({
    path: name, data: await fs.readFile(path.join(outputDir, name)), mode: 0o644,
  })));
  const bytes = tarGzip(entries);
  const filename = `release-completion-${bundle.releaseIntentId}-${environment.GITHUB_RUN_ID}-${environment.GITHUB_RUN_ATTEMPT}-${sha256(bytes)}.tar.gz`;
  await fs.writeFile(path.join(outputDir, filename), bytes, { flag: 'wx' });
  if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, readable);
  return { status: completion.status, evidenceFilename: filename, evidenceSha256: sha256(bytes) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.env.EXPECTED_BUNDLE_SHA256) throw new Error('Acceptance requires the saved prepublication bundle digest');
  const complete = process.argv[2] === 'complete';
  const result = await (complete ? completeRelease : acceptRelease)({
    ...options(process.argv.slice(complete ? 3 : 2)), ...trustedEnvironment() });
  if (process.env.GITHUB_OUTPUT) for (const name of ['status', 'evidenceFilename', 'evidenceSha256']) {
    if (result[name] !== undefined) await fs.appendFile(process.env.GITHUB_OUTPUT, `${name}=${result[name]}\n`);
  }
  console.log(JSON.stringify(result, null, 2));
  if (complete && result.status !== 'Passed') process.exitCode = result.status === 'Failed' ? 1 : 2;
}
