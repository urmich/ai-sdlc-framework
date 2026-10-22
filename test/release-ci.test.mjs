export const validationDeclarations = {
  "schemaVersion": 1,
  "applicability": [
    {"options": "{skip:packagePrerelease?'Stable Homebrew publication metadata is not generated for prereleases':false}", "platforms": ["linux-x64", "windows-x64", "macos-arm64", "macos-x64"], "owner": "maintainer", "reason": "Stable-channel formula negatives remain required; a prerelease source cannot silently waive this declared profile.", "prerequisites": ["Stable source version for the required Homebrew release profile"]},
    {"options": "{skip:packagePrerelease?'Stable Homebrew acceptance is not applicable to prereleases':false}", "platforms": ["linux-x64", "windows-x64", "macos-arm64", "macos-x64"], "owner": "maintainer", "reason": "Controlled public-consumer adapter tests do not substitute for actual later native consumers.", "prerequisites": ["Stable source version for the required Homebrew release profile"]}
  ],
  "surfaces": [
    {"coverage": "direct", "paths": ["scripts/release-bundle.mjs", "scripts/release-gate.mjs", "scripts/accept-release.mjs", "scripts/publish-release.mjs", "scripts/npm-handoff.mjs", "scripts/release-orchestration.mjs", "scripts/release-retention.mjs", "scripts/homebrew-quality.mjs", "packaging/windows-tester/generate.mjs"]},
    {"coverage": "fixture-only", "paths": ["scripts/homebrew-lifecycle.mjs"]}
  ],
  "plannedCases": [
    {"id": "T-PRD054", "selectors": [
      {"name": "T-PRD037 later successful native completion preserves the failed physical attempt and separately retained archive", "parents": []}
    ]},
    {"id": "T-PRD070", "selectors": [
      {"name": "T-PRD037 release-lifetime archive reconstructs all original inputs as of their original time without renewing current credit", "parents": []}
    ]}
  ]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { canonical, readTarGzip, readZip, sha256, tarGzip, zip } from '../packaging/standalone/archive.mjs';
import { isPrerelease, platformEntries, TARGETS, validateWindowsLauncher, verifyEntries } from '../packaging/standalone/protocol.mjs';
import { generateManifests } from '../packaging/winget/generate.mjs';
import { generateWindowsTesterPrompt, INPUT_FILENAME, renderWindowsTesterPrompt,
  validateWindowsTesterPrompt } from '../packaging/windows-tester/generate.mjs';
import { buildPackage } from '../scripts/package.mjs';
import { buildPlatforms, writeReleaseMetadata } from '../scripts/package-platforms.mjs';
import { RELEASE_SCOPE, RELEASE_TARGETS, RELEASE_EXECUTION_PLATFORMS, RELEASE_GATE_TARGETS, RELEASE_PRE_CASES, archiveRecord, evidenceIdentity, options,
  copyNativeReports, homebrewMetadata, releaseRepository, sealBundle as sealProductionBundle, selectGateFiles, validateGates, verifyBundle as verifyProductionBundle,
  prepareRelease, prepublicationEvidence, reuseBundle, resumeCandidate, verifyCandidate, windowsTesterInput, windowsTesterReadiness, writeJson } from '../scripts/release-bundle.mjs';
import { boundedReadback, preflightRelease, promoteRelease, publishApprovedDraft, publishDraft, validateReleaseActions, verifyRegistryPayload } from '../scripts/publish-release.mjs';
import { NPM_TRUST, npmHandoffFromVerifiedBundle, prepareNpmHandoff } from '../scripts/npm-handoff.mjs';
import { acceptPublicHomebrew, completeRelease, downloadPublicAssets } from '../scripts/accept-release.mjs';
import { verifyIntelFormula, verifyMacosArchives, verifyNativeHomebrew, validateNativeHomebrewEvidence } from '../scripts/release-gate.mjs';
import { verifyHomebrewQuality } from '../scripts/homebrew-quality.mjs';
import { digest } from '../src/core.mjs';
import { parseTestPlan } from '../src/artifacts.mjs';
import { evaluateReadiness, normalizeExecutionReport, validationInventoryDigest } from '../src/evidence.mjs';
import { createCompletionFixture } from './readiness-release-consumer-fixture.mjs';
import { admitAcceptanceHandoff, prepareAcceptanceHandoff, runReleaseAcceptance,
  releaseConsumerTargets } from '../scripts/release-orchestration.mjs';
import { readWorkflowPolicySources } from '../scripts/workflow-policy.mjs';
import { immutablePublicationBinding } from '../scripts/release-history.mjs';
import { fixtureWindowsLauncher } from './winget-payload-fixture.mjs';
import { nativeReplayFixture } from './readiness-observer-fixture.mjs';
import { retainAttestationMaterial, verifyArchiveWithGh, verifyHistoricalRelease,
  verifyHistoricalCompletion } from '../scripts/release-retention.mjs';
import { nativeToolchain, homebrewToolchain } from '../scripts/toolchain-baseline.mjs';

const execute = promisify(execFile);

let root;
let base;
let payload;
let originalTmp;
let previousFixture;
let originalPreviousEnvironment = {};
const repository = NPM_TRUST.repository;
const sourceCommit = 'a'.repeat(40);
const releaseIntentId = 'unit-fixture-release-not-provider-proof';
const candidateBaseUrl = 'http://127.0.0.1:8765/';
const packagePrerelease = isPrerelease(
  JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8')).version);

function fixtureFormula(descriptor, { mode = 'stable', candidateBaseUrl } = {}) {
  const base = mode === 'candidate' ? candidateBaseUrl :
    `https://github.com/${repository}/releases/download/v${descriptor.version}/`;
  const shared = descriptor.files.find(file => file.filename === `ai-sdlc-framework-${descriptor.version}-macos.tar.gz`);
  if (shared) {
    return (mode === 'candidate' ? '# Test-only local candidate; never publish to the stable tap.\n' : '') +
      `class AiSdlcFramework < Formula\n  url "${base}${shared.filename}"\n` +
      (mode === 'candidate' ? `  version "${descriptor.version}" if version.to_s != "${descriptor.version}"\n` : '') +
      `  sha256 "${shared.sha256}"\n  depends_on :macos\n  depends_on "${homebrewToolchain.formula}"\nend\n`;
  }
  return (mode === 'candidate' ? '# Test-only local candidate; never publish to the stable tap.\n' : '') +
    `class AiSdlcFramework < Formula\n  depends_on :macos\n  depends_on "${homebrewToolchain.formula}"\n\n  on_macos do\n` +
    ['arm64', 'x64'].map(arch => {
      const archive = archiveRecord({ descriptor }, `macos-${arch}`);
      return `    on_${arch === 'arm64' ? 'arm' : 'intel'} do\n      url "${base}${archive.filename}"\n` +
        (mode === 'candidate' ? `      version "${descriptor.version}" if version.to_s != "${descriptor.version}"\n` : '') +
        `      sha256 "${archive.sha256}"\n    end\n`;
    }).join('') + '  end\nend\n';
}

function fixtureGenerator({ descriptor, mode, candidateBaseUrl }) {
  const contents = fixtureFormula(descriptor, { mode, candidateBaseUrl });
  return { filename: 'ai-sdlc-framework.rb', kind: 'homebrew', mode,
    contents, sha256: sha256(Buffer.from(contents)), size: Buffer.byteLength(contents) };
}

function simulatedQuality(candidate, formula, targetArch, mode = 'stable') {
  // Mock evidence for unit tests only; it is never used in the retained release candidate.
  const brew = '/unit-test/isolated/bin/brew';
  const style = { status: 'Passed', exitCode: 0, args: ['style', '/unit-test/Formula/ai-sdlc-framework.rb'] };
  const audit = { status: 'Passed', exitCode: 0, args: ['audit', '--strict', '--formula', '--os=macos',
    `--arch=${targetArch === 'x64' ? 'intel' : 'arm'}`, 'local/sdlc-quality-abcdef/ai-sdlc-framework'] };
  return { validation: 'Passed', identity: candidate.context.identity, formula, targetArch, mode,
    nodeDependency: { validation: 'Passed', formula: homebrewToolchain.formula,
      major: homebrewToolchain.major, scope: 'runtime', conditional: false },
    nativeExecution: 'NotRun', tool: 'Homebrew', brew, brewVersion: 'Homebrew unit-test fixture',
    style, audit, commands: [style, audit].map(stage => ({ command: brew, args: stage.args, exitCode: 0 })) };
}

async function mockQuality({ candidate, formulaPath, targetArch, mode }) {
  const bytes = await fs.readFile(formulaPath);
  return simulatedQuality(candidate, { filename: 'ai-sdlc-framework.rb', kind: 'homebrew',
    sha256: sha256(bytes), size: bytes.length }, targetArch, mode);
}

function simulatedNativeHomebrew(candidate, targetArch) {
  const brew = '/unit-test/isolated/bin/brew';
  return { passed: true, platform: 'darwin', architecture: targetArch,
    mode: 'candidate', upgradeKind: 'version', publicAcceptance: 'NotRun',
    previousIdentity: previousFixture.identity, currentIdentity: candidate.context.identity,
    uname: targetArch === 'arm64' ? 'arm64' : 'x86_64', sysctlProcTranslated: '0',
    homebrewRuntime: { platform: 'darwin', arch: targetArch, major: homebrewToolchain.major },
    homebrewNodeVersion: nativeToolchain.node,
    archiveInputs: [archiveRecord(previousFixture, `macos-${targetArch}`), archiveRecord(candidate, `macos-${targetArch}`)],
    failedPromotionRetry: { passed: true, priorKeg: '/fixture/old', candidateKeg: '/fixture/new' },
    commands: [
      ...['install', 'test', 'uninstall', 'link', 'unlink', 'autoremove', 'tab'].map(name => ({
        command: brew, args: [name, 'local/fixture/ai-sdlc-framework'], success: true, noInstallCleanup: '1',
        homeBeforeSha256: 'a'.repeat(64), homeAfterSha256: 'a'.repeat(64),
      })),
      { command: '/fixture/node', args: ['fixture-cli', 'hook', 'sessionStart'], success: true },
      { command: '/fixture/node', args: ['fixture-cli', 'doctor'], success: true },
    ] };
}

function simulatedGates(candidate) {
  return RELEASE_GATE_TARGETS.map(target => {
    const [platform, architecture] = target.split('-');
    return { schemaVersion: 1, target, identity: candidate.context.identity,
      required: true, validation: RELEASE_SCOPE[target].validation, profile: 'r-pre',
      caseId: RELEASE_PRE_CASES[target], releaseIntentId, status: 'Passed', nativeValidation: 'Passed',
      reportDirectory: `native/${target}`, finishedAt: new Date().toISOString(),
      run: { id: '123', attempt: '1' },
      host: { kind: 'native', platform: { linux: 'linux', windows: 'win32', macos: 'darwin' }[platform],
        architecture, image: 'unit-fixture-not-real-native-proof', toolchain: { node: nativeToolchain.node } } };
  });
}

async function unitNativeVerifier({ target, evidenceDir }) {
  const gate = JSON.parse(await fs.readFile(path.resolve(evidenceDir, '..', '..', `${target}.json`)));
  const spec = { schemaVersion: 1, profile: `r-pre-${target}`, cases: [{
    id: RELEASE_PRE_CASES[target], conditions: ['AC-206.2'], expectedDigest: 'b'.repeat(64),
    executionId: `native-${target}`, mode: 'automated', owner: 'provider', location: `github-${target}`,
    checkpoint: 'post-review', assertions: [{ id: 'fixture-only', selector: { procedure: 'fixture-capability' } }],
  }] };
  const context = { candidateDigest: 'c'.repeat(64), testSpecDigest: 'd'.repeat(64), configDigest: 'e'.repeat(64),
    inventoryDigest: validationInventoryDigest(spec), sources: [{ repositoryId: 'repository-123',
      revision: sourceCommit, contentDigest: 'f'.repeat(64) }], profile: spec.profile,
    environment: 'local', location: `github-${target}`, mode: 'automated', owner: 'provider',
    native: gate.host, producer: { provider: 'github', connection: 'repository-ci', scopeRef: 'repository:123',
      definitionRef: 'unit-fixture-release-workflow', executionRef: '123', attemptKind: 'known', attemptRef: '1' },
    attemptCapability: 'distinct', jobRef: `native-${target}`, artifacts: [], intentId: releaseIntentId };
  const report = { schemaVersion: 1, kind: 'test-execution', context, startedAt: gate.finishedAt,
    finishedAt: gate.finishedAt, observedAt: gate.finishedAt, sequence: 1, complete: true, exitCode: 0,
    results: [{ testId: RELEASE_PRE_CASES[target], assertionId: 'fixture-only', selector: { procedure: 'fixture-capability' },
      status: 'Passed', expectedMet: true, expectedDigest: 'b'.repeat(64), checkpoint: 'post-review',
      observedAt: gate.finishedAt, sourceSequence: 1, durationMs: 0, exitCode: 0, detail: 'Fixture capability only' }] };
  const normalized = normalizeExecutionReport(report, context, input => ({
    verifierId: 'unit-native-fixture', reportDigest: input.reportDigest, context, sourceTime: gate.finishedAt, sourceSequence: 1,
  }));
  return { context, evaluation: evaluateReadiness(spec, [normalized], { profile: spec.profile,
    executions: [{ id: `native-${target}`, context }], now: new Date().toISOString(),
    policy: { maxAgeMs: 86_400_000, revisionPolicy: 'exact', verifierIds: ['unit-native-fixture'] } }) };
}
// This in-process fixture capability is never selectable from the CLI or serialized input.
const sealBundle = options => sealProductionBundle({ ...options, sourceCommit, releaseIntentId, verifyEvidence: unitNativeVerifier });
const verifyBundle = options => verifyProductionBundle({ ...options, verifyEvidence: unitNativeVerifier });

test.before(async () => {
  root = path.resolve('.test-data', `release-unit-${randomUUID()}`);
  await fs.mkdir(path.join(root, 'scratch'), { recursive: true });
  originalTmp = process.env.TMPDIR;
  originalPreviousEnvironment = Object.fromEntries(['SUPPORTED_PREVIOUS_VERSION', 'SUPPORTED_PREVIOUS_DESCRIPTOR_SHA256',
    'SUPPORTED_PREVIOUS_CHECKSUMS_SHA256', 'SUPPORTED_PREVIOUS_REPOSITORY'].map(key => [key, process.env[key]]));
  for (const key of Object.keys(originalPreviousEnvironment)) delete process.env[key];
  process.env.TMPDIR = path.join(root, 'scratch');
  payload = await buildPackage({ outputDir: path.join(root, 'npm') });
  const pe = Buffer.alloc(256);
  pe.write('MZ');
  pe.writeUInt32LE(128, 60);
  pe.writeUInt32LE(0x4550, 128);
  pe.writeUInt16LE(0x8664, 132);
  pe.writeUInt16LE(0x20b, 152);
  const launcher = path.join(root, 'nonexecutable-PE-test-fixture');
  await fs.writeFile(launcher, pe);
  base = path.join(root, 'base');
  const built = await buildPlatforms({ artifact: payload.artifact, outputDir: path.join(base, 'assets'),
    windowsLauncher: launcher, sourceCommit, targets: RELEASE_TARGETS });
  const prerelease = isPrerelease(built.descriptor.version);
  const archive = archiveRecord(built, 'windows-x64');
  const winget = await generateManifests({ version: built.descriptor.version, releaseRepository: repository,
    archive, archivePath: path.join(base, 'assets', archive.filename), outputDir: path.join(root, 'winget'),
    ...(prerelease ? { testOnly: true, candidateUrl: `${candidateBaseUrl}${archive.filename}` } : {}) });
  const formula = path.join(root, 'ai-sdlc-framework.rb');
  await fs.writeFile(formula, fixtureFormula(built.descriptor,
    prerelease ? { mode: 'candidate', candidateBaseUrl } : {}));
  await fs.mkdir(path.join(base, 'homebrew'), { recursive: true });
  await fs.copyFile(formula, path.join(base, 'homebrew', 'ai-sdlc-framework.rb'));
  const final = await writeReleaseMetadata({ outputDir: path.join(base, 'assets'), artifact: payload.artifact,
    sourceCommit, targets: RELEASE_TARGETS,
    metadataFiles: prerelease ? [] : [...winget.files, { artifact: formula, kind: 'homebrew' }] });
  const previousRoot = path.join(root, 'controlled-previous-version-input');
  await fs.mkdir(previousRoot);
  const previousPayload = tarGzip(readTarGzip(await fs.readFile(payload.artifact)).map(entry =>
    entry.path === 'package/package.json' ? { ...entry,
      data: Buffer.from(JSON.stringify({ ...JSON.parse(entry.data), version: '0.3.0' })) } : entry));
  const previousArtifact = path.join(previousRoot, 'ai-sdlc-framework-0.3.0.tgz');
  await fs.writeFile(previousArtifact, previousPayload);
  const previousAssets = path.join(previousRoot, 'assets');
  await fs.mkdir(previousAssets);
  // The release builder accepts only the checkout version; older fixtures use the same archive codec directly.
  for (const target of RELEASE_TARGETS) {
    const { entries, manifest } = platformEntries(previousPayload, target, pe);
    const extension = TARGETS[target].extension;
    const encode = extension === 'zip' ? zip : tarGzip;
    await fs.writeFile(path.join(previousAssets, `${manifest.name}-${manifest.version}-${target}.${extension}`), encode(entries));
  }
  const old = await writeReleaseMetadata({ outputDir: previousAssets, artifact: previousArtifact,
    sourceCommit: 'b'.repeat(40), targets: RELEASE_TARGETS });
  const oldFormula = path.join(previousRoot, 'ai-sdlc-framework.rb');
  await fs.writeFile(oldFormula, fixtureFormula(old.descriptor));
  const previousRelease = await writeReleaseMetadata({ outputDir: path.join(previousRoot, 'assets'), artifact: previousArtifact,
    sourceCommit: 'b'.repeat(40), targets: RELEASE_TARGETS, metadataFiles: [{ artifact: oldFormula, kind: 'homebrew' }] });
  previousFixture = { ...previousRelease, directory: path.join(previousRoot, 'assets'),
    checksums: await fs.readFile(path.join(previousRoot, 'assets', 'SHA256SUMS'), 'utf8'),
    identity: { version: '0.3.0', sourceCommit: 'b'.repeat(40),
      payloadSha256: previousRelease.descriptor.payload.sha256,
      descriptorSha256: previousRelease.descriptorSha256, checksumsSha256: previousRelease.checksumsSha256 } };
  await writeJson(path.join(base, INPUT_FILENAME), windowsTesterInput(final, repository, sha256(pe)));
  await writeJson(path.join(base, 'context.json'), { schemaVersion: 1, releaseRepository: repository,
    releaseIntentId,
    previousRelease: { version: previousFixture.identity.version, descriptorSha256: previousFixture.identity.descriptorSha256,
      checksumsSha256: previousFixture.identity.checksumsSha256, repository },
    identity: evidenceIdentity(final), scope: RELEASE_SCOPE, prerelease,
    launcher: { sha256: sha256(pe) },
    homebrew: { status: prerelease ? 'NotPublishedPrerelease' : 'Generated' } });
});

test.after(async () => {
  if (originalTmp === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = originalTmp;
  for (const [key, value] of Object.entries(originalPreviousEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await fs.rm(root, { recursive: true, force: true });
});

async function fixture(t) {
  const directory = path.join(root, randomUUID());
  const candidateDir = path.join(directory, 'candidate');
  const evidenceDir = path.join(directory, 'simulated-evidence');
  const outputDir = path.join(directory, 'bundle');
  await fs.cp(base, candidateDir, { recursive: true });
  const candidate = await verifyCandidate(candidateDir);
  for (const gate of simulatedGates(candidate)) {
    await writeJson(path.join(evidenceDir, `${gate.target}.json`), gate);
    await writeJson(path.join(evidenceDir, 'native', gate.target, 'execution.json'),
      { fixtureOnly: true, observedAt: gate.finishedAt, sequence: 1 });
  }
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { directory, candidateDir, evidenceDir, outputDir, candidate };
}

test('T-PRD057 two archive targets retain four mandatory native execution platforms without Linux standalone support', () => {
  assert.deepEqual(RELEASE_TARGETS, ['macos', 'windows-x64']);
  assert.deepEqual(RELEASE_EXECUTION_PLATFORMS, ['linux-x64', 'windows-x64', 'macos-arm64', 'macos-x64']);
  assert.deepEqual(RELEASE_GATE_TARGETS, RELEASE_EXECUTION_PLATFORMS);
  assert.equal(RELEASE_SCOPE['macos-x64'].publish, true);
  assert.equal(RELEASE_SCOPE['macos-x64'].homebrew, true);
  assert.equal(RELEASE_SCOPE['macos-x64'].required, true);
  assert.equal(RELEASE_SCOPE['macos-x64'].validation, 'native-full-regression');
  assert.equal(RELEASE_SCOPE['linux-x64'].publish, false);
  for (const invalid of ['', 'https://github.com/owner/repo', 'owner/../repo', 'owner/repo\nx']) {
    assert.throws(() => releaseRepository(invalid), /explicitly approved/u);
  }
  assert.equal(releaseRepository(repository), repository);
  assert.deepEqual(options(['--candidate-dir', 'with spaces', '--target', 'macos-arm64']),
    { candidateDir: 'with spaces', target: 'macos-arm64' });
  assert.throws(() => options(['--target', 'x', '--target', 'y']), /Duplicate/u);
});

test('release preparation cannot attribute candidate bytes to a different source commit', async t => {
  const f = await fixture(t);
  const outputDir = path.join(f.directory, 'wrong-revision');
  await assert.rejects(prepareRelease({ outputDir, repository, sourceCommit }),
    /exact clean committed source revision/u);
  await assert.rejects(fs.stat(outputDir), { code: 'ENOENT' });
});

test('T-PRD063 future Mac output leaves the separate Windows v1 PE and cross-platform npm bytes intact', async t => {
  const f = await fixture(t);
  const original = await fs.readFile(payload.artifact);
  const future = tarGzip(readTarGzip(original).map(entry => entry.path === 'package/package.json' ?
    { ...entry, data: Buffer.from(JSON.stringify({ ...JSON.parse(entry.data), version: '0.5.0' })) } : entry));
  const built = await fixtureWindowsLauncher({ outputDir: path.join(f.directory, 'real-pinned-Windows-launcher') });
  const launcher = await fs.readFile(built.artifact);
  validateWindowsLauncher(launcher);
  assert.equal(launcher.length, built.size);
  assert.equal(sha256(launcher), built.sha256);
  assert.ok(launcher.length > 256, 'The separate Windows channel must contain the real pinned-compiler launcher, not a fake PE header');
  const windows = platformEntries(future, 'windows-x64', launcher);
  const verified = verifyEntries(readZip(zip(windows.entries)), { expectedPlatform: 'win32', expectedArch: 'x64' });
  assert.equal(verified.platform.schemaVersion, 1);
  assert.equal(verified.platform.arch, 'x64');
  assert.equal(verified.platform.launcherSha256, sha256(launcher));
  assert.deepEqual(verified.entries.find(entry => entry.path === 'bin/sdlc.exe').data, launcher);
  assert.deepEqual(verified.entries.find(entry => entry.path === verified.manifest.payload.filename).data, future);
  assert.equal(platformEntries(future, 'macos').platform.schemaVersion, 2);
  assert.equal(sha256(await fs.readFile(payload.artifact)), sha256(original));
  const legacyDescriptor = { version: '0.3.0', files: ['arm64', 'x64'].map(arch => ({
    filename: `ai-sdlc-framework-0.3.0-macos-${arch}.tar.gz`, kind: 'archive',
    sha256: (arch === 'arm64' ? 'a' : 'b').repeat(64), size: 1,
  })) };
  const unchanged = canonical(legacyDescriptor);
  assert.notDeepEqual(archiveRecord({ descriptor: legacyDescriptor }, 'macos-arm64'),
    archiveRecord({ descriptor: legacyDescriptor }, 'macos-x64'));
  assert.equal(canonical(legacyDescriptor), unchanged);
  const protectedRoot = path.join(f.directory, 'owned-installed-0.4-sentinel');
  await fs.mkdir(protectedRoot);
  const protectedBytes = Buffer.from('Controlled installed 0.4 sentinel; never the real Copilot home');
  await fs.writeFile(path.join(protectedRoot, 'installed.json'), protectedBytes);
  await sealBundle(f);
  const bundle = await verifyBundle({ directory: f.outputDir });
  const provider = githubFixture(bundle, f.outputDir);
  await publishApprovedDraft({ directory: f.outputDir, repository, bundle }, provider.api);
  provider.makePublic();
  const existingAssets = provider.assets.map(asset => ({ ...asset, bytes: Buffer.from(asset.bytes) }));
  const tagIdentity = provider.getTag();
  provider.assets[0].bytes = Buffer.from('Controlled immutable existing-version conflict');
  provider.assets[0].size = provider.assets[0].bytes.length;
  const mutations = provider.calls.filter(call => call.method).length;
  await assert.rejects(publishApprovedDraft({ directory: f.outputDir, repository, bundle }, provider.api), /Existing asset conflicts/u);
  assert.equal(provider.calls.filter(call => call.method).length, mutations, 'Existing versions must not be overwritten or repaired');
  assert.ok(provider.calls.filter(call => call.route.includes('/git/ref/tags/')).every(call => !call.method));
  assert.equal(provider.getTag(), tagIdentity);
  assert.deepEqual(await fs.readFile(path.join(protectedRoot, 'installed.json')), protectedBytes);
  for (const asset of existingAssets.slice(1)) assert.deepEqual(provider.assets.find(row => row.name === asset.name).bytes, asset.bytes);
});

test('T-PRD062 bundle seals exact shared payload and final manager metadata before descriptor/checksum pins', async t => {
  const f = await fixture(t);
  const sealed = await sealBundle(f);
  const bundle = await verifyBundle({ directory: f.outputDir, expectedBundleSha256: sealed.bundleSha256 });
  assert.equal(bundle.identity.payloadSha256, payload.sha256);
  assert.equal(bundle.descriptor.files.filter(file => file.kind === 'winget').length, packagePrerelease ? 0 : 3);
  assert.equal(bundle.descriptor.files.filter(file => file.kind === 'archive').length, 3);
  assert.ok(bundle.files.filter(file => file.filename.startsWith('assets/'))
    .every(file => !file.filename.includes('linux')));
  assert.ok(bundle.files.some(file => file.filename === 'evidence/native/linux-x64/execution.json'));
  assert.ok(bundle.files.some(file => file.filename === `assets/ai-sdlc-framework-${payload.version}-macos.tar.gz`));
  assert.ok(!bundle.files.some(file => /-macos-(?:arm64|x64)\.tar\.gz$/u.test(file.filename)));
  assert.deepEqual(archiveRecord(bundle, 'macos-arm64'), archiveRecord(bundle, 'macos-x64'));
  const stale = structuredClone(bundle);
  stale.descriptor.files.push({ ...archiveRecord(bundle, 'macos'),
    filename: `ai-sdlc-framework-${payload.version}-macos-arm64.tar.gz` });
  assert.throws(() => archiveRecord(stale, 'macos-x64'), /stale CPU/u);
  assert.equal(bundle.context.homebrew.status, packagePrerelease ? 'NotPublishedPrerelease' : 'Generated');
  assert.equal(bundle.publicationReady, true, 'Validated complete T-60 content authorizes publication');
  const names = bundle.files.map(file => file.filename);
  assert.ok(names.includes('assets/release-descriptor.json'));
  assert.ok(names.includes('assets/SHA256SUMS'));
  assert.ok(names.includes('handoff/windows-tester-prompt.md'));
  assert.ok(!names.includes('assets/windows-tester-prompt.md'), 'Final-digest-bound prompts cannot enter the descriptor hash cycle');
  await assert.rejects(verifyBundle({ directory: f.outputDir, expectedBundleSha256: '0'.repeat(64) }), /digest mismatch/u);
  await assert.rejects(verifyCandidate(f.candidateDir, { sourceCommit: 'b'.repeat(40) }), /trusted evidence/u);
});

test('T-PRD061 Homebrew adapter requires the same Mac URL and checksum for the approved destination',
  { skip: packagePrerelease ? 'Stable Homebrew publication metadata is not generated for prereleases' : false }, async t => {
  const f = await fixture(t);
  const descriptor = f.candidate.descriptor;
  const generator = async input => {
    assert.deepEqual(input, { descriptor, artifactDirectory: path.join(f.candidateDir, 'assets'),
      mode: 'stable', architectures: ['arm64', 'x64'] });
    return fixtureGenerator(input);
  };
  const args = { descriptor, artifactDirectory: path.join(f.candidateDir, 'assets'),
    outputDir: path.join(f.directory, 'formula'), repository, generator };
  const result = await homebrewMetadata(args);
  assert.equal(result.status, 'Generated');
  assert.equal(result.nativeValidation, 'NotRun');
  assert.equal(result.files[0].sha256, sha256(await fs.readFile(result.files[0].artifact)));
  await assert.rejects(homebrewMetadata({ ...args, repository: 'wrong/repo' }), /shared archive contract/u);
  await assert.rejects(homebrewMetadata({ ...args, generator: async input =>
    ({ ...await generator(input), sha256: '0'.repeat(64) }) }), /invalid formula record/u);
  const armDigest = archiveRecord({ descriptor }, 'macos-arm64').sha256;
  const intelDigest = '0'.repeat(64);
  assert.equal(archiveRecord({ descriptor }, 'macos-x64').sha256, armDigest);
  for (const mutate of [
    contents => contents.replace('  depends_on :macos', '  depends_on arch: :arm64\n  depends_on :macos'),
    contents => contents.replace('  url ', '  on_arm do\n  url '),
    contents => contents.replace('  url ', '  on_linux do\n  url '),
    contents => contents.replace(armDigest, intelDigest),
    contents => contents.replaceAll('macos.tar.gz', 'macos-arm64.tar.gz'),
    contents => contents.replaceAll(armDigest, 'TEMP').replaceAll(intelDigest, armDigest).replaceAll('TEMP', intelDigest),
    contents => contents.replace('  sha256', '  # sha256'),
    contents => `${contents}url "https://example.invalid/override"\n`,
    contents => contents.replace(`  depends_on "${homebrewToolchain.formula}"\n`, ''),
    contents => contents.replace(`  depends_on "${homebrewToolchain.formula}"\n`, `    depends_on "${homebrewToolchain.formula}"\n`),
    contents => contents.replace(`  depends_on "${homebrewToolchain.formula}"\n`, `  depends_on "${homebrewToolchain.formula}" => :build\n`),
    contents => contents.replace(`  depends_on "${homebrewToolchain.formula}"\n`, `  depends_on "${homebrewToolchain.formula}" if Hardware::CPU.arm?\n`),
    contents => contents.replace(`  depends_on "${homebrewToolchain.formula}"\n`, `  depends_on "${homebrewToolchain.formula}"\n  depends_on "node@20"\n`),
    contents => contents.replace(`  depends_on "${homebrewToolchain.formula}"\n`, `  depends_on "${homebrewToolchain.formula}"\n  depends_on "${homebrewToolchain.formula}"\n`),
  ]) {
    await assert.rejects(homebrewMetadata({ ...args, generator: async input => {
      const formula = await generator(input);
      const contents = mutate(formula.contents);
      return { ...formula, contents, sha256: sha256(Buffer.from(contents)), size: Buffer.byteLength(contents) };
    } }), /Homebrew.*(?:stanzas|contract)/u);
  }
});

test('candidate verification independently rejects checksum-consistent stale CPU formula metadata',
  { skip: packagePrerelease ? 'Stable Homebrew publication metadata is not generated for prereleases' : false }, async t => {
  const f = await fixture(t);
  const file = path.join(f.directory, 'ai-sdlc-framework.rb');
  const correct = fixtureFormula(f.candidate.descriptor);
  for (const corrupt of [false, true]) {
    await fs.writeFile(file, corrupt ? correct.replace('macos.tar.gz', 'macos-arm64.tar.gz') : correct);
    const metadataFiles = f.candidate.descriptor.files.filter(item => !['archive', 'homebrew'].includes(item.kind))
      .map(item => ({ ...item, artifact: path.join(f.candidateDir, 'assets', item.filename) }));
    const final = await writeReleaseMetadata({ outputDir: path.join(f.candidateDir, 'assets'),
      artifact: payload.artifact, sourceCommit, targets: RELEASE_TARGETS,
      metadataFiles: [...metadataFiles, { artifact: file, kind: 'homebrew' }] });
    await fs.unlink(path.join(f.candidateDir, 'context.json'));
    await writeJson(path.join(f.candidateDir, 'context.json'), { ...f.candidate.context,
      identity: evidenceIdentity(final), homebrew: { status: 'Generated', nativeValidation: 'NotRun' } });
    await fs.unlink(path.join(f.candidateDir, INPUT_FILENAME));
    await writeJson(path.join(f.candidateDir, INPUT_FILENAME),
      windowsTesterInput(final, repository, f.candidate.context.launcher.sha256));
    if (corrupt) await assert.rejects(verifyCandidate(f.candidateDir), /shared archive contract/u);
    else assert.equal((await verifyCandidate(f.candidateDir)).context.homebrew.status, 'Generated');
  }
});

test('Intel metadata helpers reproduce bytes but cannot substitute for the required native gate', async t => {
  const f = await fixture(t);
  const scratch = path.join(f.directory, 'intel-cross');
  const archive = await verifyMacosArchives({ candidate: f.candidate, candidateDir: f.candidateDir, scratch });
  assert.equal(archive.validation, 'Passed');
  assert.equal(archive.arch, 'x64');
  assert.equal(archive.platform, 'darwin');
  assert.equal(archive.sha256, archiveRecord(f.candidate, 'macos-x64').sha256);
  let calls = 0;
  const homebrew = await verifyIntelFormula({ candidate: f.candidate, candidateDir: f.candidateDir, scratch,
    verifyQuality: mockQuality,
    generator: async input => {
      calls++;
      assert.ok(input.descriptor.files.every(file => file.kind === 'archive'));
      assert.deepEqual(input.architectures, ['arm64', 'x64']);
      return fixtureGenerator(input);
    } });
  assert.equal(calls, 2);
  assert.equal(homebrew.deterministicGeneration, 'Passed');
  assert.equal(homebrew.nativeValidation, 'NotRun');
  const gates = simulatedGates(f.candidate).map(gate => gate.target === 'macos-x64' ?
    { ...gate, deterministicArchive: archive, homebrew, nativeValidation: 'NotRun' } : gate);
  assert.throws(() => windowsTesterReadiness(f.candidate, gates), /native R-PRE/u);
});

test('Intel formula validation rejects nondeterminism and differences from frozen metadata', async t => {
  const f = await fixture(t);
  let calls = 0;
  await assert.rejects(verifyIntelFormula({ candidate: f.candidate, candidateDir: f.candidateDir,
    scratch: path.join(f.directory, 'nondeterministic'),
    generator: async input => {
      const formula = fixtureGenerator(input);
      const contents = formula.contents + `# invocation ${++calls}\n`;
      return { ...formula, contents, sha256: sha256(Buffer.from(contents)), size: Buffer.byteLength(contents) };
    } }), /generations differ/u);
  if (!packagePrerelease) {
    await assert.rejects(verifyIntelFormula({ candidate: f.candidate, candidateDir: f.candidateDir,
      scratch: path.join(f.directory, 'frozen-mismatch'),
      generator: async input => {
        const formula = fixtureGenerator(input);
        const contents = formula.contents + '# different implementation\n';
        return { ...formula, contents, sha256: sha256(Buffer.from(contents)), size: Buffer.byteLength(contents) };
      } }), /frozen public Homebrew/u);
  }
});

test('Intel prerelease formula checks remain test-only and never require stable metadata', async t => {
  const f = await fixture(t);
  const version = `${payload.version}-rc.1`;
  const candidate = structuredClone(f.candidate);
  candidate.context.prerelease = true;
  candidate.descriptor.version = version;
  candidate.descriptor.files = candidate.descriptor.files.filter(file => file.kind === 'archive')
    .map(file => ({ ...file, filename: file.filename.replace(payload.version, version) }));
  const result = await verifyIntelFormula({ candidate, candidateDir: f.candidateDir,
    scratch: path.join(f.directory, 'prerelease-formula'), generator: fixtureGenerator, verifyQuality: mockQuality });
  assert.equal(result.mode, 'candidate');
  assert.equal(result.publication, 'NotPublishedPrerelease');
  assert.equal(result.nativeValidation, 'NotRun');
  assert.ok(result.architectures.every(record => record.url.startsWith('http://127.0.0.1:8765/')));
});

test('T-PRD062 shared Mac archive must exist and declare both architectures despite consistent outer checksums', async t => {
  const f = await fixture(t);
  const directory = path.join(f.candidateDir, 'assets');
  const intel = archiveRecord(f.candidate, 'macos-x64');
  await fs.unlink(path.join(directory, intel.filename));
  await assert.rejects(verifyCandidate(f.candidateDir), { code: 'ENOENT' });
  const payloadBytes = await fs.readFile(payload.artifact);
  await fs.writeFile(path.join(directory, intel.filename), tarGzip(platformEntries(payloadBytes, 'macos-arm64').entries));
  const metadataFiles = f.candidate.descriptor.files.filter(file => file.kind !== 'archive')
    .map(file => ({ artifact: path.join(directory, file.filename), kind: file.kind }));
  await writeReleaseMetadata({ outputDir: directory, artifact: payload.artifact, sourceCommit,
    targets: RELEASE_TARGETS, metadataFiles });
  await assert.rejects(verifyCandidate(f.candidateDir), /Wrong-version or wrong-platform/u);
});

async function qualityFixture(t) {
  const f = await fixture(t);
  const prefix = path.join(path.resolve('.test-data'), `brew-${randomUUID().slice(0, 12)}`);
  t.after(() => fs.rm(prefix, { recursive: true, force: true }));
  const brew = path.join(prefix, 'bin/brew');
  await fs.mkdir(path.dirname(brew), { recursive: true });
  await fs.writeFile(brew, '#!/bin/sh\nexit 99\n', { mode: 0o755 });
  const calls = [];
  const run = async (command, args, options) => {
    assert.equal(command, brew);
    calls.push({ args, options });
    assert.ok(['--prefix', '--repository', '--version', 'style', 'audit'].includes(args[0]),
      'The metadata runner must never install, test or execute the target package');
    if (['--prefix', '--repository'].includes(args[0])) return { stdout: `${prefix}\n`, stderr: '' };
    if (args[0] === '--version') return { stdout: 'Homebrew mocked quality tool\n', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  return { ...f, prefix, brew, calls, run,
    formulaPath: path.join(f.candidateDir, 'homebrew/ai-sdlc-framework.rb'),
    mode: f.candidate.context.prerelease ? 'candidate' : 'stable',
    candidateBaseUrl: f.candidate.context.prerelease ? candidateBaseUrl : undefined };
}

test('Homebrew quality runner requires actual style and strict macOS/architecture audit commands without target execution', async t => {
  const f = await qualityFixture(t);
  for (const targetArch of ['arm64', 'x64']) {
    const quality = await verifyHomebrewQuality({ candidate: f.candidate, formulaPath: f.formulaPath,
      mode: f.mode, candidateBaseUrl: f.candidateBaseUrl,
      targetArch, outputDir: path.join(f.directory, `quality-${targetArch}`),
      brew: f.brew, run: f.run, environment: { ...process.env, HOMEBREW_TEST_SETTING: 'remove',
        NODE_AUTH_TOKEN: 'unit-test-placeholder', RUBOCOP_OPTS: '--except-cops=all',
        GIT_DIR: f.candidateDir, BUNDLE_PATH: '/unit-test-external-cache' } });
    assert.equal(quality.style.status, 'Passed');
    assert.equal(quality.audit.status, 'Passed');
    assert.equal(quality.nodeDependency.formula, homebrewToolchain.formula);
    assert.equal(quality.nativeExecution, 'NotRun');
    assert.ok(quality.audit.args.includes(`--arch=${targetArch === 'x64' ? 'intel' : 'arm'}`));
    assert.ok(quality.audit.args.includes('--os=macos'));
    assert.ok(quality.audit.args.includes('--strict'));
    const env = f.calls.at(-1).options.env;
    assert.equal(env.NODE_AUTH_TOKEN, undefined);
    assert.equal(env.HOMEBREW_TEST_SETTING, undefined);
    assert.equal(env.RUBOCOP_OPTS, undefined);
    assert.equal(env.GIT_DIR, undefined);
    assert.equal(env.BUNDLE_PATH, undefined);
    assert.equal(env.HOMEBREW_NO_AUTO_UPDATE, '1');
    assert.deepEqual(await fs.readdir(path.join(f.prefix, 'Library/Taps/local')), [], 'Owned temporary tap is cleaned');
  }
});

test('audit/style failures and formula mutation fail closed, with no native lifecycle or autofix', async t => {
  for (const failure of ['style', 'audit', 'mutation']) {
    const f = await qualityFixture(t);
    const outputDir = path.join(f.directory, 'failed-quality');
    await assert.rejects(verifyHomebrewQuality({ candidate: f.candidate, formulaPath: f.formulaPath,
      mode: f.mode, candidateBaseUrl: f.candidateBaseUrl, targetArch: 'x64', outputDir, brew: f.brew,
      run: async (command, args, options) => {
        const result = await f.run(command, args, options);
        if (args[0] === failure) throw Object.assign(new Error(`${failure} offense`), { code: 1, stderr: 'offense' });
        if (failure === 'mutation' && args[0] === 'style') await fs.appendFile(args[1], '# mutated by tool\n');
        return result;
      } }), /offense|changed the frozen formula/u);
    const evidence = JSON.parse(await fs.readFile(path.join(outputDir, 'quality-evidence.json'), 'utf8'));
    assert.equal(evidence.validation, 'Failed');
    assert.equal(evidence.nativeExecution, 'NotRun');
    assert.ok(f.calls.every(call => !call.args.includes('--fix') && !call.args.includes('--skip-style')));
    if (failure === 'style') assert.ok(!f.calls.some(call => call.args[0] === 'audit'));
  }
});

test('Node metadata and audit prerequisites are checked before lifecycle or target commands', async t => {
  const f = await qualityFixture(t);
  const wrongFormula = path.join(f.directory, 'wrong-node.rb');
  await fs.writeFile(wrongFormula, (await fs.readFile(f.formulaPath, 'utf8')).replace(homebrewToolchain.formula, 'node@20'));
  await assert.rejects(verifyHomebrewQuality({ candidate: f.candidate, formulaPath: wrongFormula,
    mode: f.mode, candidateBaseUrl: f.candidateBaseUrl,
    targetArch: 'arm64', outputDir: path.join(f.directory, 'wrong-node-quality'),
    brew: f.brew, run: f.run }), /Node dependency contract/u);
  assert.equal(f.calls.length, 0);
  await assert.rejects(verifyHomebrewQuality({ candidate: f.candidate, formulaPath: f.formulaPath,
    mode: f.mode, candidateBaseUrl: f.candidateBaseUrl,
    targetArch: 'x64', outputDir: path.join(f.directory, 'missing-tool'), brew: '' }),
  { code: 'RELEASE_INTEGRATION_BLOCKED' });
  await assert.rejects(verifyNativeHomebrew({ candidate: f.candidate, candidateDir: f.candidateDir,
    scratch: f.directory, brew: f.brew, previous: previousFixture,
    verifyLifecycle: async () => assert.fail('Lifecycle must not run after failed metadata audit'),
    verifyQuality: async args => ({ ...await mockQuality(args), audit: { status: 'NotRun' } }) }),
  /audit\/style\/Node dependency evidence/u);
});

test('Homebrew quality rejects linked scratch and tap parents without touching their targets', async t => {
  const f = await qualityFixture(t);
  const unrelated = path.join(f.directory, 'unrelated');
  await fs.mkdir(unrelated);
  await fs.writeFile(path.join(unrelated, 'keep'), 'keep');
  const link = path.join(f.directory, 'linked-output-parent');
  await fs.symlink(unrelated, link);
  const args = { candidate: f.candidate, formulaPath: f.formulaPath, mode: f.mode,
    candidateBaseUrl: f.candidateBaseUrl,
    targetArch: 'x64', brew: f.brew, run: f.run };
  await assert.rejects(verifyHomebrewQuality({ ...args, outputDir: path.join(link, 'quality') }), /literal directory/u);
  assert.deepEqual(await fs.readdir(unrelated), ['keep']);
  await fs.symlink(unrelated, path.join(f.prefix, 'Library'));
  await assert.rejects(verifyHomebrewQuality({ ...args, outputDir: path.join(f.directory, 'quality-tap-link') }), /literal directory/u);
  assert.deepEqual(await fs.readdir(unrelated), ['keep']);
});

test('T-60 prompt deterministically binds final metadata and explicitly does not claim native execution', async t => {
  const f = await fixture(t);
  const input = { ...f.candidate.testerInput,
    readiness: windowsTesterReadiness(f.candidate, simulatedGates(f.candidate)) };
  const first = renderWindowsTesterPrompt(input);
  assert.deepEqual(first, renderWindowsTesterPrompt(structuredClone(input)));
  for (const field of ['sourceCommit', 'payloadSha256', 'descriptorSha256', 'checksumsSha256']) {
    assert.ok(first.contents.includes(input.identity[field]));
  }
  assert.ok(first.contents.includes(input.archive.sha256));
  assert.ok(first.contents.includes(input.inventoryDigest));
  assert.ok(first.contents.includes(input.launcherSha256));
  assert.match(first.contents, /Content status: \*\*Complete\*\*/u);
  assert.match(first.contents, /previous private framework generation may be installed as \*\*v1\.2\.4\*\*/u);
  assert.match(first.contents, /all GitHub Copilot CLI\s+processes closed/u);
  assert.match(first.contents, /install --purge-existing/u);
  assert.match(first.contents, /Do not store an npm publishing token/u);
  assert.equal(first.manifest.nativeExecution, 'NotRun');
  const outputDir = path.join(f.directory, 'prompt');
  const result = await generateWindowsTesterPrompt({ ...input, outputDir });
  assert.equal(result.generationValidation, 'Passed');
  assert.equal(result.nativeExecution, 'NotRun');
  assert.equal(result.completionValidation, 'Passed');
  const changedIdentity = { ...input.identity, checksumsSha256: '0'.repeat(64) };
  await assert.rejects(validateWindowsTesterPrompt({ ...input, outputDir,
    identity: changedIdentity, readiness: { ...input.readiness, identity: changedIdentity } }), /not bound/u);
  await assert.rejects(validateWindowsTesterPrompt({ ...input, outputDir,
    releaseRepository: 'different/public-assets' }), /not bound/u);
  await fs.appendFile(path.join(outputDir, 'windows-tester-prompt.md'), '\nNative execution: Passed\n');
  await assert.rejects(validateWindowsTesterPrompt({ ...input, outputDir }), /not bound/u);
  assert.throws(() => renderWindowsTesterPrompt({ ...input,
    archive: { ...input.archive, filename: input.archive.filename.replace('windows-x64', 'macos-x64') } }), /exact Windows/u);
  assert.throws(() => renderWindowsTesterPrompt({ ...input, launcherSha256: undefined }), /exact final candidate/u);
});

test('T-60 generation waits for completed native validation and only identity inputs exist in a candidate', async t => {
  const f = await fixture(t);
  await assert.rejects(fs.stat(path.join(f.candidateDir, 'handoff')), { code: 'ENOENT' });
  const outputDir = path.join(f.directory, 'premature-prompt');
  await assert.rejects(generateWindowsTesterPrompt({ ...f.candidate.testerInput, outputDir }),
    /completed implementation/u);
  await assert.rejects(fs.stat(outputDir), { code: 'ENOENT' });
  await fs.writeFile(path.join(f.candidateDir, INPUT_FILENAME), '{}');
  await assert.rejects(verifyCandidate(f.candidateDir), /T-60 input/u);
});

test('missing, failed, stale, skipped or emulated required evidence blocks sealing', async t => {
  const f = await fixture(t);
  const gates = simulatedGates(f.candidate);
  for (const mutate of [
    values => values.pop(),
    values => { values[0].status = 'NotRun'; },
    values => { values[0].host.architecture = 'arm64'; },
    values => { values[0].identity = { ...values[0].identity, payloadSha256: '0'.repeat(64) }; },
    values => { values.find(item => item.target === 'windows-x64').nativeValidation = 'NotRun'; },
    values => { values.find(item => item.target === 'windows-x64').host.platform = 'linux'; },
    values => { values[0].profile = 'pr'; },
    values => { values[0].caseId = 'T-PRD014-LX'; },
    values => { values.find(item => item.target === 'macos-x64').status = 'NotRun'; },
    values => { values.find(item => item.target === 'macos-x64').nativeValidation = 'NotRun'; },
    values => { values.find(item => item.target === 'macos-x64').host.kind = 'metadata'; },
    values => { values[0].finishedAt = new Date(Date.now() - 86_400_001).toISOString(); },
    values => { values[0].finishedAt = new Date(Date.now() + 60_000).toISOString(); },
    values => { values[0].run.attempt = ''; },
  ]) {
    const copy = structuredClone(gates);
    mutate(copy);
    assert.throws(() => validateGates(copy, f.candidate.context.identity));
  }
  await fs.unlink(path.join(f.evidenceDir, 'macos-arm64.json'));
  await assert.rejects(sealBundle(f), /every scoped mandatory gate/u);
});

test('missing Homebrew integration blocks the required native gate; an adapter cannot hide bad native evidence', async t => {
  const f = await fixture(t);
  const args = { candidate: f.candidate, candidateDir: f.candidateDir, scratch: f.directory, previous: previousFixture };
  await assert.rejects(verifyNativeHomebrew({ ...args,
    candidate: { ...f.candidate, context: { ...f.candidate.context, homebrew: { status: 'NotIntegrated' } } } }),
  { code: 'RELEASE_INTEGRATION_BLOCKED' });
  await assert.rejects(verifyNativeHomebrew({ ...args, brew: '', verifyLifecycle: async () => ({ passed: true }) }),
    { code: 'RELEASE_INTEGRATION_BLOCKED' });
  const evidence = simulatedNativeHomebrew(f.candidate, 'arm64');
  const passed = await verifyNativeHomebrew({ ...args, brew: path.join(f.directory, 'isolated/bin/brew'), verifyQuality: mockQuality,
    verifyLifecycle: async input => {
      assert.equal(input.candidateDirectory, previousFixture.directory);
      assert.equal(input.upgradeDirectory, path.join(f.candidateDir, 'assets'));
      assert.deepEqual(input.expectedPreviousIdentity, previousFixture.identity);
      assert.deepEqual(input.expectedCurrentIdentity, f.candidate.context.identity);
      return evidence;
    } });
  assert.equal(passed.nativeValidation, 'Passed');
  const intel = await verifyNativeHomebrew({ ...args, scratch: path.join(f.directory, 'native-intel'),
    targetArch: 'x64', mode: 'candidate', brew: path.join(f.directory, 'isolated/bin/brew'), verifyQuality: mockQuality,
    verifyLifecycle: async input => {
      assert.equal(input.targetArch, 'x64');
      assert.equal(input.mode, 'candidate', 'Stable candidates must not fetch unpublished stable formula URLs');
      return simulatedNativeHomebrew(f.candidate, 'x64');
    } });
  assert.equal(intel.evidence.uname, 'x86_64');
  assert.throws(() => validateNativeHomebrewEvidence({ ...passed,
    evidence: { ...passed.evidence, upgradeKind: 'formula-revision' } },
  { candidate: f.candidate, targetArch: 'arm64', mode: 'candidate' }), /upgrade|native/iu);
  await assert.rejects(verifyNativeHomebrew({ ...args, scratch: path.join(f.directory, 'bad-native'),
    brew: path.join(f.directory, 'isolated/bin/brew'), verifyQuality: mockQuality,
    verifyLifecycle: async () => ({ ...evidence, architecture: 'x64' }) }), /did not pass/u);
});

test('T-PRD029 all four real native profiles are required before sealing the same frozen bytes', async t => {
  const f = await fixture(t);
  const sealed = await sealBundle(f);
  await verifyBundle({ directory: f.outputDir, expectedBundleSha256: sealed.bundleSha256 });
  const intel = JSON.parse(await fs.readFile(path.join(f.outputDir, 'evidence/macos-x64.json'), 'utf8'));
  assert.equal(intel.status, 'Passed');
  assert.equal(intel.nativeValidation, 'Passed');
  assert.equal(intel.required, true);
  await fs.unlink(path.join(f.evidenceDir, 'macos-x64.json'));
  await assert.rejects(sealBundle({ ...f, outputDir: path.join(f.directory, 'missing-intel-bundle') }), /every scoped mandatory gate/u);
});

test('T-PRD029 every native original is independently verified before publication readiness', async t => {
  const f = await fixture(t);
  await sealBundle(f);
  const visited = [];
  const finalTarget = [...RELEASE_GATE_TARGETS].sort().at(-1);
  const bundle = await verifyProductionBundle({ directory: f.outputDir, verifyEvidence: async input => {
    visited.push(input.target);
    if (input.target === finalTarget) throw new Error('Controlled final-native evidence rejection');
    return unitNativeVerifier(input);
  } }).catch(error => {
    assert.match(error.message, /final-native evidence rejection/u);
    return null;
  });
  assert.equal(bundle, null, 'A successful first platform must not bypass the remaining native verifier calls');
  assert.deepEqual([...visited].sort(), [...RELEASE_GATE_TARGETS].sort());
  const verified = await verifyBundle({ directory: f.outputDir });
  assert.deepEqual(verified.producerVerification.contexts.map(row => row.target).sort(), [...RELEASE_GATE_TARGETS].sort());
});

test('T-PRD029 report transport preserves original NDJSON bytes without copying executable scratch or caches', async t => {
  const f = await fixture(t);
  const source = path.join(f.directory, 'original-native-reports');
  const target = path.join(f.directory, 'staged-native-reports');
  await fs.mkdir(path.join(source, 'tools-a1'), { recursive: true });
  await fs.mkdir(path.join(source, 'scratch', 'cache'), { recursive: true });
  const journal = Buffer.from('{"event":"start","id":"one"}\n{"event":"complete","status":"Passed"}\n');
  await fs.writeFile(path.join(source, 'unit.json.journal.ndjson'), journal);
  await fs.writeFile(path.join(source, 'tools-a1', 'go-tests.journal.ndjson'), journal);
  await fs.writeFile(path.join(source, 'execution.json'), '{"fixtureOnly":true}\n');
  await fs.writeFile(path.join(source, 'scratch', 'cache', 'untrusted.exe'), 'Never copy or execute fixture caches');
  await copyNativeReports(source, target);
  assert.deepEqual(await fs.readFile(path.join(target, 'unit.json.journal.ndjson')), journal);
  assert.deepEqual(await fs.readFile(path.join(target, 'tools-a1', 'go-tests.journal.ndjson')), journal);
  assert.deepEqual((await fs.readdir(target)).sort(), ['execution.json', 'tools-a1', 'unit.json.journal.ndjson']);
  await assert.rejects(fs.access(path.join(target, 'scratch')), { code: 'ENOENT' });
});

test('partial workflow reruns retain prior successful targets but never hide a newer failed gate', async t => {
  const f = await fixture(t);
  const evidenceDir = path.join(f.directory, 'downloaded-gate-artifacts');
  const gates = simulatedGates(f.candidate);
  for (const gate of gates) {
    await writeJson(path.join(evidenceDir, `release-gate-${gate.target}-123-1`, `${gate.target}.json`),
      { ...gate, run: { id: '123', attempt: '1' } });
  }
  const failed = { ...gates[0], status: 'Failed', run: { id: '123', attempt: '2' } };
  await writeJson(path.join(evidenceDir, `release-gate-${failed.target}-123-2`, `${failed.target}.json`), failed);
  const selected = await selectGateFiles(evidenceDir, '123');
  assert.ok(selected.find(file => file.includes(gates[0].target)).includes('-123-2'));
  await assert.rejects(sealBundle({ ...f, evidenceDir, runId: '123' }), /Required gate did not pass/u);
  await assert.rejects(selectGateFiles(evidenceDir, '124'), /Unexpected gate artifact/u);
});

test('immutable bundle rejects modified, extra, empty-directory and linked content', async t => {
  const f = await fixture(t);
  await sealBundle(f);
  const extra = path.join(f.outputDir, 'unexpected');
  await fs.mkdir(extra);
  await assert.rejects(verifyBundle({ directory: f.outputDir }), /empty directories/u);
  await fs.rmdir(extra);
  await fs.writeFile(extra, 'changed');
  await assert.rejects(verifyBundle({ directory: f.outputDir }), /files changed/u);
  await fs.unlink(extra);
  await fs.symlink(path.join(f.outputDir, 'context.json'), extra);
  await assert.rejects(verifyBundle({ directory: f.outputDir }), /regular files/u);
  await fs.unlink(extra);
  await fs.appendFile(path.join(f.outputDir, 'assets', payload.filename), 'changed');
  await assert.rejects(verifyBundle({ directory: f.outputDir }), /files changed/u);
});

test('checksum-consistent Linux archives cannot enter the supported release', async t => {
  for (const target of ['linux-x64']) {
    const f = await fixture(t);
    const filename = `ai-sdlc-framework-${payload.version}-${target}.tar.gz`;
    await fs.writeFile(path.join(f.candidateDir, 'assets', filename),
      tarGzip(platformEntries(await fs.readFile(payload.artifact), target).entries));
    const metadataFiles = f.candidate.descriptor.files.filter(file => file.kind !== 'archive')
      .map(file => ({ ...file, artifact: path.join(f.candidateDir, 'assets', file.filename) }));
    await writeReleaseMetadata({ outputDir: path.join(f.candidateDir, 'assets'), artifact: payload.artifact,
      sourceCommit, targets: [...RELEASE_TARGETS, target], metadataFiles });
    await assert.rejects(verifyCandidate(f.candidateDir), /wrong-platform/u);
  }
});

function nativeProducerFixture(candidate, gates) {
  const routes = [];
  const artifacts = [];
  const archives = new Map();
  const runs = [];
  const physical = new Map();
  const jobs = new Map();
  const prefix = `/repos/${repository}`;
  const nativeStep = 'Fresh complete native R-PRE inventory against the frozen unpublished bytes';
  function addRun(id, number, selected = gates) {
    const created_at = new Date(Math.min(...gates.map(gate => Date.parse(gate.finishedAt))) - 60_000).toISOString();
    const run = { id: Number(id), run_number: number, run_attempt: 1, created_at,
      head_sha: sourceCommit, event: 'workflow_dispatch', path: '.github/workflows/release.yml', workflow_id: 17,
      status: 'completed', conclusion: selected.every(gate => gate.status === 'Passed') ? 'success' : 'failure' };
    runs.push(run);
    physical.set(`${id}/1`, run);
    jobs.set(`${id}/1`, [{ id: 100, name: 'preflight', conclusion: 'success', steps: [{
      name: 'Verify publishing toolchain availability and integrity before any tag or asset effect', conclusion: 'success',
    }] }, ...selected.map((gate, index) => ({ id: index + 101, name: `native-${gate.target}`,
      conclusion: gate.status === 'Passed' ? 'success' : gate.status === 'Failed' ? 'failure' : 'cancelled',
      started_at: created_at, completed_at: gate.finishedAt,
      labels: [{ 'linux-x64': 'ubuntu-24.04', 'windows-x64': 'windows-2022',
        'macos-arm64': 'macos-15', 'macos-x64': 'macos-15-intel' }[gate.target]],
      steps: [{ name: nativeStep, conclusion: gate.status === 'Passed' ? 'success' : 'failure' }] }))]);
    const bytes = zip([{ path: 'release-preflight.json', mode: 0o644, data: Buffer.from(canonical({
      releaseIntentId: candidate.context.releaseIntentId, sourceCommit, version: candidate.context.identity.version,
      repository, validationMode: 'fresh-native',
    })) }]);
    const idNumber = 900 + runs.length;
    artifacts.push({ id: idNumber, name: `release-preflight-${id}-1`, expired: false,
      digest: `sha256:${sha256(bytes)}`, workflow_run: { id: Number(id), head_sha: sourceCommit } });
    archives.set(String(idNumber), bytes);
  }
  addRun(gates[0].run.id, 1);
  const api = async route => {
    routes.push(route);
    if (route.startsWith(`${prefix}/actions/workflows/release.yml/runs?`)) {
      return { status: 200, value: { total_count: runs.length, workflow_runs: runs } };
    }
    if (route.startsWith(`${prefix}/actions/artifacts?`)) {
      return { status: 200, value: { total_count: artifacts.length, artifacts } };
    }
    const artifact = new RegExp(`^${prefix}/actions/artifacts/(\\d+)(/zip)?$`, 'u').exec(route);
    if (artifact) return { status: 200, value: artifact[2] ? archives.get(artifact[1]) :
      artifacts.find(row => String(row.id) === artifact[1]) };
    const run = new RegExp(`^${prefix}/actions/runs/(\\d+)/attempts/(\\d+)(/jobs\\?.*)?$`, 'u').exec(route);
    assert.ok(run, `Unexpected native producer route: ${route}`);
    const rows = jobs.get(`${run[1]}/${run[2]}`);
    return { status: 200, value: run[3] ? { total_count: rows.length, jobs: rows } :
      physical.get(`${run[1]}/${run[2]}`) };
  };
  return { api, artifacts, archives, addRun, jobs, runs, routes };
}

function githubFixture(bundle, directory) {
  let release;
  let duplicateDraft;
  const assets = [];
  const calls = [];
  let tagCommit = sourceCommit;
  let privateRepo = false;
  const api = async (route, options = {}) => {
    calls.push({ route, ...options });
    if (route === `/repos/${repository}`) return { status: 200, value: { private: privateRepo } };
    if (route.includes('/git/ref/tags/')) return tagCommit === null ? { status: 404 } :
      { status: 200, value: { object: { type: 'commit', sha: tagCommit } } };
    if (route.endsWith('/git/refs') && options.method === 'POST') {
      tagCommit = options.body.sha;
      return { status: 201, value: { object: { type: 'commit', sha: tagCommit } } };
    }
    if (route.includes('/releases/tags/')) {
      return release && !release.draft ? { status: 200, value: release } : { status: 404 };
    }
    if (route.includes('/releases?per_page=')) {
      return { status: 200, value: [release, duplicateDraft].filter(Boolean) };
    }
    if (route === `/repos/${repository}/releases` && options.method === 'POST') {
      release = { id: 7, ...options.body };
      return { status: 201, value: release };
    }
    if (route === `/repos/${repository}/releases/7` && options.method === 'PATCH') {
      Object.assign(release, options.body);
      return { status: 200, value: release };
    }
    if (route.includes('/assets?per_page=')) return { status: 200, value: assets };
    if (route.startsWith('/uploads/')) {
      const name = new URL(`https://example.invalid${route}`).searchParams.get('name');
      const asset = { name, id: assets.length + 100, size: options.bytes.length,
        state: 'uploaded', bytes: Buffer.from(options.bytes) };
      assets.push(asset);
      return { status: 201, value: asset };
    }
    const id = Number(route.split('/').at(-1));
    return { status: 200, value: assets.find(asset => asset.id === id).bytes };
  };
  return { api, calls, assets, directory, bundle,
    getTag: () => tagCommit,
    setTag: value => { tagCommit = value; }, setPrivate: value => { privateRepo = value; },
    makePublic: () => { release.draft = false; },
    duplicateDraft: () => { duplicateDraft = { ...release, id: release.id + 1 }; },
    clearDuplicateDraft: () => { duplicateDraft = undefined; } };
}

test('T-PRD029 completed native readiness seals an acyclic data-only publication handoff', async t => {
  const f = await fixture(t);
  const sealed = await sealBundle(f);
  const proofDir = path.join(f.directory, 'prepublication');
  await prepublicationEvidence({ directory: f.outputDir, outputDir: proofDir, expectedBundleSha256: sealed.bundleSha256,
    runId: '123', attempt: '1', verifyEvidence: unitNativeVerifier });
  const handoff = await prepareNpmHandoff({ directory: f.outputDir, sourceRepository: repository,
    api: nativeProducerFixture(f.candidate, simulatedGates(f.candidate)).api,
    expectedBundleSha256: sealed.bundleSha256, verifyEvidence: unitNativeVerifier,
    bundleArtifactId: '50', bundleArtifactDigest: 'a'.repeat(64), sourceRunId: '123',
    evidenceArtifactId: '51', evidenceArtifactDigest: 'b'.repeat(64), readinessFile: path.join(proofDir, 'readiness.json'),
    environment: { GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1',
      GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/release.yml@refs/heads/main` } });
  assert.equal(handoff.version, payload.version);
  const manifest = JSON.parse(await fs.readFile(path.join(f.outputDir, 'bundle.json'), 'utf8'));
  await fs.writeFile(path.join(f.outputDir, 'bundle.json'), canonical({ ...manifest, publicationReady: false }));
  await assert.rejects(verifyBundle({ directory: f.outputDir }), /readiness mismatch/u);
});

test('T-PRD037 successful recovery durably retains full original publisher diagnostics without recursive privileged handoffs', async t => {
  const f = await fixture(t);
  const sealed = await sealBundle(f);
  const bundle = await verifyBundle({ directory: f.outputDir });
  const provider = nativeProducerFixture(f.candidate, simulatedGates(f.candidate));
  const baseHandoff = await npmHandoffFromVerifiedBundle({ directory: f.outputDir, bundle, sourceRepository: repository,
    bundleSha256: sealed.bundleSha256 });
  const binding = immutablePublicationBinding({ ...baseHandoff, releaseIntentId,
    releaseBinding: { releaseRepository: repository, descriptorSha256: bundle.identity.descriptorSha256,
      checksumsSha256: bundle.identity.checksumsSha256 } });
  const originalDispatch = { schemaVersion: 1, kind: 'npm-publication-attempt', binding,
    run: { id: '123', attempt: '1' }, mode: 'publish',
    invocationRef: `https://github.com/${repository}/actions/runs/123/attempts/1` };
  const originalDiagnostic = 'Controlled original uncertain publication diagnostic '.repeat(400);
  const result = { binding, run: originalDispatch.run, status: 'FailedOrIncomplete', effect: 'Uncertain',
    publishAttempted: true, command: { exitCode: 1, signal: null, confirmedRejected: false,
      stderr: originalDiagnostic, stderrSha256: sha256(Buffer.from(originalDiagnostic)) } };
  for (const [id, name, member, value] of [
    [71, `npm-publication-dispatch-${releaseIntentId}-123-1`, 'publication-dispatch.json', originalDispatch],
    [72, 'npm-oidc-result-123-1', 'npm-publication-result.json', result],
  ]) {
    const bytes = zip([{ path: member, data: Buffer.from(canonical(value)), mode: 0o644 }]);
    provider.artifacts.push({ id, name, expired: false, digest: `sha256:${sha256(bytes)}`,
      workflow_run: { id: 123, head_sha: sourceCommit } });
    provider.archives.set(String(id), bytes);
  }
  provider.jobs.get('123/1').push({ id: 299, name: 'npm-handoff / publish', steps: [{
    name: 'Publish exact tgz through OIDC only, with automatic npm provenance',
    conclusion: 'failure', started_at: new Date().toISOString(),
  }] });
  const proofDir = path.join(f.directory, 'original-publisher-proof');
  await prepublicationEvidence({ directory: f.outputDir, outputDir: proofDir, expectedBundleSha256: sealed.bundleSha256,
    runId: '123', attempt: '1', verifyEvidence: unitNativeVerifier });
  const publicationHistoryDir = path.join(f.directory, 'retained-original-publications');
  const handoffOptions = { directory: f.outputDir, sourceRepository: repository,
    expectedBundleSha256: sealed.bundleSha256, verifyEvidence: unitNativeVerifier, api: provider.api,
    bundleArtifactId: '50', bundleArtifactDigest: 'a'.repeat(64), sourceRunId: '123',
    evidenceArtifactId: '51', evidenceArtifactDigest: 'b'.repeat(64), publicationHistoryDir,
    readinessFile: path.join(proofDir, 'readiness.json'),
    environment: { GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2',
      GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/release.yml@refs/heads/main` } };
  const handoff = await prepareNpmHandoff(handoffOptions);
  assert.equal(handoff.publicationRecovery.mayDispatch, false);
  assert.ok(Buffer.byteLength(canonical(handoff)) < 32 * 1024);
  assert.equal(JSON.stringify(handoff).includes(originalDiagnostic), false);
  assert.equal(handoff.publicationRecovery.history[0].result.command.exitCode, 1);
  const manifest = JSON.parse(await fs.readFile(path.join(publicationHistoryDir, 'npm-publication-history.json')));
  assert.equal(manifest.complete, true);
  assert.equal(manifest.originals.length, 2);
  const original = JSON.parse(await fs.readFile(path.join(publicationHistoryDir, 'npm-history-72.json')));
  assert.equal(original.value.command.stderr, originalDiagnostic);
  assert.equal(original.originalSemanticSha256, sha256(Buffer.from(canonical(result))));
  const completed = await createCompletionFixture(t, { directory: f.directory, bundle, bundleDirectory: f.outputDir,
    expected: { expectedBundleSha256: sealed.bundleSha256 }, verifyEvidence: unitNativeVerifier });
  completed.request.publicationHistoryDir = publicationHistoryDir;
  const completion = await completed.complete();
  assert.equal(completion.result.status, 'Passed', JSON.stringify(completion.completion.blockers));
  const archived = readTarGzip(await fs.readFile(path.join(completion.outputDir, completion.result.evidenceFilename)));
  const retained = JSON.parse(archived.find(entry => entry.path === 'npm-history-72.json').data);
  assert.equal(retained.value.command.stderr, originalDiagnostic);
  assert.equal(retained.value.status, 'FailedOrIncomplete', 'Recovery must retain the original outcome, not rewrite it to current success');
  const closure = JSON.parse(archived.find(entry => entry.path === 'completion-inputs.json').data);
  assert.equal(closure.publicationHistory.filename, 'npm-publication-history.json');
  assert.equal(closure.publicationHistory.originals.length, 2);
  const originalArchive = await fs.readFile(path.join(completion.outputDir, completion.result.evidenceFilename));
  for (const mode of ['missing-history', 'changed-history']) {
    const incomplete = await createCompletionFixture(t, { directory: f.directory, bundle, bundleDirectory: f.outputDir,
      expected: { expectedBundleSha256: sealed.bundleSha256 }, verifyEvidence: unitNativeVerifier });
    incomplete.request.publicationHistoryDir = mode === 'missing-history' ?
      path.join(f.directory, 'unavailable-history') : publicationHistoryDir;
    if (mode === 'changed-history') await fs.appendFile(path.join(publicationHistoryDir, 'npm-history-72.json'), 'changed');
    const failed = await incomplete.complete();
    assert.equal(failed.result.status, 'NotRun', mode);
    assert.match(failed.completion.blockers.join('\n'), /publication|history/iu, mode);
  }
  assert.deepEqual(await fs.readFile(path.join(completion.outputDir, completion.result.evidenceFilename)), originalArchive);
  const oversized = structuredClone(result);
  oversized.command.stderr = '';
  oversized.command.stderr = 'x'.repeat(4 * 1024 * 1024 - Buffer.byteLength(canonical(oversized)) - 1);
  const bytes = zip([{ path: 'npm-publication-result.json', data: Buffer.from(canonical(oversized)), mode: 0o644 }]);
  provider.artifacts.find(row => row.id === 72).digest = `sha256:${sha256(bytes)}`;
  provider.archives.set('72', bytes);
  const capacityDir = path.join(f.directory, 'bounded-history-before-effect');
  await assert.rejects(prepareNpmHandoff({ ...handoffOptions, publicationHistoryDir: capacityDir }),
    /capacity|budget|bounded|exceed|oversized/iu);
  const partial = JSON.parse(await fs.readFile(path.join(capacityDir, 'npm-publication-history.json')));
  assert.equal(partial.complete, false, 'History capacity gaps must stop the read-only handoff, not surprise completion after publication');
});

test('T-PRD034 identical draft retry preserves assets and rejects conflicting bytes without tag movement', async t => {
  const f = await fixture(t);
  await sealBundle(f);
  const bundle = await verifyBundle({ directory: f.outputDir });
  const mock = githubFixture(bundle, f.outputDir);
  // Transport tests simulate the separate approval layer; all remote requests remain mocked.
  const request = { directory: f.outputDir, repository, bundle: { ...bundle, publicationReady: true } };
  assert.equal((await publishApprovedDraft(request, mock.api)).status, 'DraftAssetsVerified');
  const mutations = mock.calls.filter(call => call.method === 'POST').length;
  await publishApprovedDraft(request, mock.api);
  assert.equal(mock.calls.filter(call => call.method === 'POST').length, mutations);
  assert.ok(mock.calls.every(call => !['DELETE', 'PATCH', 'PUT'].includes(call.method)));
  mock.duplicateDraft();
  await assert.rejects(publishApprovedDraft(request, mock.api), /ambiguous resume/u);
  mock.clearDuplicateDraft();
  mock.assets[0].bytes[0] ^= 255;
  mock.setTag(null);
  await assert.rejects(publishApprovedDraft(request, mock.api), /conflicts/u);
  assert.equal(mock.calls.filter(call => call.method === 'POST').length, mutations);
  mock.assets[0].bytes[0] ^= 255;
  await publishApprovedDraft(request, mock.api);
  assert.equal(mock.calls.filter(call => call.route.endsWith('/git/refs') && call.method === 'POST').length, 1);
  const original = simulatedGates(f.candidate);
  const physicalAttempts = canonical(original.map(gate => gate.run));
  for (const change of [
    gate => { gate.releaseIntentId = 'different-logical-intent'; },
    gate => { gate.finishedAt = new Date(Date.now() - 86_400_001).toISOString(); },
    gate => { gate.identity = { ...gate.identity, sourceCommit: 'b'.repeat(40) }; },
  ]) {
    const different = structuredClone(original);
    change(different[0]);
    assert.throws(() => validateGates(different, f.candidate.context.identity, { releaseIntentId }));
  }
  validateGates(original, f.candidate.context.identity, { releaseIntentId });
  assert.equal(canonical(original.map(gate => gate.run)), physicalAttempts, 'Reuse never relabels original physical attempts');
});

test('T-PRD034 production bundle reuse retains exact original identities at the 24-hour boundary and rejects replacements', async t => {
  const f = await fixture(t);
  const sealed = await sealBundle(f);
  const gates = await Promise.all(RELEASE_GATE_TARGETS.map(target =>
    fs.readFile(path.join(f.outputDir, 'evidence', `${target}.json`), 'utf8').then(JSON.parse)));
  const provider = nativeProducerFixture(f.candidate, gates);
  const proofDir = path.join(f.directory, 'reusable-original-evidence');
  const proof = await prepublicationEvidence({ directory: f.outputDir, outputDir: proofDir,
    expectedBundleSha256: sealed.bundleSha256, runId: '123', attempt: '1', verifyEvidence: unitNativeVerifier });
  provider.artifacts.push(
    { id: 50, name: `release-bundle-${f.candidate.context.identity.version}-123-1`, expired: false,
      digest: `sha256:${'5'.repeat(64)}`, workflow_run: { id: 123, head_sha: sourceCommit } },
    { id: 51, name: 'release-prepublication-123-1', expired: false,
      digest: `sha256:${'6'.repeat(64)}`, workflow_run: { id: 123, head_sha: sourceCommit } });
  const originalBytes = await fs.readFile(path.join(proofDir, 'readiness.json'));
  const originalExecutionBytes = await fs.readFile(path.join(f.outputDir, 'evidence', 'native', 'macos-x64', 'execution.json'));
  const boundary = Math.min(...gates.map(gate => Date.parse(gate.finishedAt))) + 86_400_000;
  let cryptoCalls = 0;
  const request = { directory: f.outputDir, evidenceDir: proofDir, runId: '123', bundleArtifactId: '50',
    evidenceArtifactId: '51', expectedBundleSha256: sealed.bundleSha256,
    sourceRepository: repository, api: provider.api, verifyEvidence: unitNativeVerifier,
    clock: () => boundary, verifyAttestation: async input => {
      cryptoCalls++;
      assert.equal(input.sha256, proof.evidenceSha256);
      assert.ok(input.args.includes('--source-digest') && input.args.includes(sourceCommit));
      return [{ verificationResult: { statement: { subject: [{ digest: { sha256: input.sha256 } }] },
        verifiedTimestamps: [{ type: 'Tlog' }] } }];
    } };
  assert.equal((await reuseBundle(request)).publicationReady, true);
  assert.equal(cryptoCalls, 1);
  assert.deepEqual(await fs.readFile(path.join(proofDir, 'readiness.json')), originalBytes);
  assert.deepEqual(await fs.readFile(path.join(f.outputDir, 'evidence', 'native', 'macos-x64', 'execution.json')), originalExecutionBytes);
  await assert.rejects(reuseBundle({ ...request, clock: () => boundary + 1 }), /stale|24 hours|fresh/iu);
  for (const [change, expected] of [
    [{ releaseIntentId: 'another-intent' }, /intent/u],
    [{ expectedBundleSha256: '0'.repeat(64) }, /digest|SHA|identity/iu],
    [{ sourceCommit: 'b'.repeat(40) }, /source|identity/iu],
  ]) await assert.rejects(reuseBundle({ ...request, ...change }), expected);
  const artifact = provider.artifacts.find(row => row.id === 50);
  const original = { ...artifact };
  for (const change of [{ expired: true }, { name: 'unrelated-role-123-1' },
    { workflow_run: { id: 124, head_sha: sourceCommit } }, { digest: null }]) {
    Object.assign(artifact, original, change);
    await assert.rejects(reuseBundle(request), /artifact|origin|producer role/iu);
  }
  Object.assign(artifact, original);
  provider.addRun('124', 2, gates.map(gate => gate.target === 'macos-x64' ? { ...gate, status: 'Failed' } : gate));
  await assert.rejects(reuseBundle(request), /newer failed|supersedes/u);
  assert.equal(cryptoCalls, 1, 'Rejected recovery must not reach attestation admission or publication');
});

test('T-PRD034 frozen candidate recovery admits only its exact original artifact and successful producer step', async t => {
  const f = await fixture(t);
  const gates = simulatedGates(f.candidate);
  const provider = nativeProducerFixture(f.candidate, gates);
  const artifact = { id: 52, name: 'release-candidate-123-1', expired: false,
    digest: `sha256:${'9'.repeat(64)}`, workflow_run: { id: 123, head_sha: sourceCommit } };
  provider.artifacts.push(artifact);
  const producer = { id: 199, name: 'candidate', conclusion: 'success', steps: [{
    name: 'Freeze exact npm, shared Mac, Windows PE and manager metadata once', conclusion: 'success' }] };
  provider.jobs.get('123/1').push(producer);
  const request = { candidateDir: f.candidateDir, artifactId: '52', runId: '123',
    identity: JSON.stringify({ descriptorSha256: f.candidate.context.identity.descriptorSha256,
      checksumsSha256: f.candidate.context.identity.checksumsSha256 }),
    releaseIntentId, sourceCommit, sourceRepository: repository, repository, api: provider.api };
  assert.deepEqual(await resumeCandidate(request), f.candidate.context.identity);
  artifact.name = 'release-bundle-0.4.0-123-1';
  await assert.rejects(resumeCandidate(request), /original immutable release candidate/u);
  artifact.name = 'release-candidate-123-1';
  producer.conclusion = 'failure';
  await assert.rejects(resumeCandidate(request), /successful freeze step/u);
  producer.conclusion = 'success';
  provider.runs[0].path = '.github/workflows/ci.yml';
  await assert.rejects(resumeCandidate(request), /foreign original producer/u);
});

test('approved draft transport rejects private repos, wrong tag commits and unexpected assets while reconciling identical public releases', async t => {
  const f = await fixture(t);
  await sealBundle(f);
  const bundle = await verifyBundle({ directory: f.outputDir });
  const mock = githubFixture(bundle, f.outputDir);
  const request = { directory: f.outputDir, repository, bundle: { ...bundle, publicationReady: true } };
  await assert.rejects(publishApprovedDraft({ ...request, repository: 'other/repo' }, mock.api), /frozen metadata/u);
  mock.setPrivate(true);
  await assert.rejects(publishApprovedDraft(request, mock.api), /public repository/u);
  mock.setPrivate(false);
  mock.setTag('b'.repeat(40));
  await assert.rejects(publishApprovedDraft(request, mock.api), /exact validated source/u);
  mock.setTag(sourceCommit);
  await publishApprovedDraft(request, mock.api);
  mock.assets.push({ name: 'unowned.txt' });
  await assert.rejects(publishApprovedDraft(request, mock.api), /unexpected assets/u);
  mock.assets.pop();
  mock.makePublic();
  const before = mock.calls.filter(call => call.method === 'POST').length;
  assert.equal((await publishApprovedDraft(request, mock.api)).status, 'PublicAssetsVerified');
  assert.equal(mock.calls.filter(call => call.method === 'POST').length, before);
});

test('anonymous public acceptance compares saved hashes before extraction or native execution', async t => {
  const f = await fixture(t);
  await sealBundle(f);
  const bundle = await verifyBundle({ directory: f.outputDir });
  const requests = [];
  const fetcher = async (url, options) => {
    assert.equal(options?.headers, undefined, 'Anonymous asset downloads never send authentication headers');
    requests.push(url);
    const filename = decodeURIComponent(new URL(url).pathname.split('/').at(-1));
    const bytes = await fs.readFile(path.join(f.outputDir, 'assets', filename));
    return new Response(bytes);
  };
  assert.equal((await downloadPublicAssets(bundle, path.join(f.directory, 'public-download'), fetcher)).status, 'Passed');
  assert.ok(requests[0].endsWith('release-descriptor.json'));
  assert.ok(requests[1].endsWith('SHA256SUMS'));
  await assert.rejects(downloadPublicAssets(bundle, path.join(f.directory, 'corrupt-download'),
    async () => new Response('bad bytes')), /prepublication evidence/u);
  await assert.rejects(downloadPublicAssets(bundle, path.join(f.directory, 'unpublished-download'),
    async () => new Response('', { status: 503 })), /download failed/u);
});

test('stable public Homebrew acceptance requires an authentic prior-version lifecycle instead of reinstall',
  { skip: packagePrerelease ? 'Stable Homebrew acceptance is not applicable to prereleases' : false }, async t => {
  const f = await fixture(t);
  await sealBundle(f);
  const bundle = await verifyBundle({ directory: f.outputDir });
  const downloaded = path.join(f.directory, 'public-homebrew');
  await fs.mkdir(downloaded);
  const formula = bundle.descriptor.files.find(file => file.kind === 'homebrew');
  await fs.copyFile(path.join(f.outputDir, 'assets', formula.filename), path.join(downloaded, formula.filename));
  const brew = path.join(f.directory, 'brew');
  await fs.writeFile(brew, '#!/bin/sh\nexit 99\n', { mode: 0o755 });
  await assert.rejects(acceptPublicHomebrew({ bundle, downloaded, brew }), { code: 'RELEASE_INTEGRATION_BLOCKED' });
  const previous = previousFixture;
  const result = await acceptPublicHomebrew({ bundle, downloaded, brew,
    previous, root: path.join(f.directory, 'native-homebrew'),
    verifyLifecycle: async options => {
      assert.equal(options.candidateDirectory, previous.directory);
      assert.equal(options.upgradeDirectory, downloaded);
      assert.equal(options.mode, 'public');
      assert.deepEqual(options.expectedPreviousIdentity, previous.identity);
      assert.deepEqual(options.expectedCurrentIdentity, bundle.identity);
      assert.equal(options.expectedNodeVersion, nativeToolchain.node);
      return { passed: true, upgradeKind: 'version', mode: 'public', publicAcceptance: 'Passed',
        previousIdentity: previous.identity, currentIdentity: bundle.identity,
        formulas: { candidate: { source: 'exact-published-bytes',
          sha256: previous.descriptor.files.find(file => file.kind === 'homebrew').sha256 },
        upgrade: { source: 'exact-published-bytes', sha256: formula.sha256 } },
        platform: 'darwin', architecture: process.arch };
    } });
  assert.equal(result.status, 'Passed');
  assert.equal(result.previous.version, '0.3.0');
});

test('read-only npm handoff binds the exact bundle, package and approved public repository', async t => {
  const f = await fixture(t);
  const sealed = await sealBundle(f);
  const bytes = await fs.readFile(payload.artifact);
  const pkg = JSON.parse(readTarGzip(bytes).find(entry => entry.path === 'package/package.json').data);
  const metadata = { name: pkg.name, version: pkg.version, dist: {
    tarball: `https://registry.npmjs.org/${pkg.name}/-/${payload.filename}`,
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` } };
  const fetcher = async url => new Response(String(url).endsWith('.tgz') ? bytes : JSON.stringify(metadata));
  const sourceRepository = pkg.repository.url.slice('https://github.com/'.length, -4);
  const bundle = { ...await verifyBundle({ directory: f.outputDir }), publicationReady: true };
  const result = await npmHandoffFromVerifiedBundle({ directory: f.outputDir, sourceRepository, bundle,
    bundleSha256: sealed.bundleSha256 });
  assert.equal(result.filename, payload.filename);
  assert.equal(result.sha256, payload.sha256);
  assert.equal(result.integrity, metadata.dist.integrity);
  assert.equal(result.bundleSha256, sealed.bundleSha256);
  await assert.rejects(npmHandoffFromVerifiedBundle({ directory: f.outputDir, sourceRepository: 'wrong/repo', bundle,
    bundleSha256: sealed.bundleSha256 }), /trusted source repository/u);
  await assert.rejects(verifyRegistryPayload(metadata, { name: pkg.name, version: pkg.version,
    sha256: '0'.repeat(64) }, fetcher), /immutable release payload/u);
});

test('T-PRD032 one exact maintainer dispatch owns the automated native release graph without tag or PR triggers', async () => {
  const ci = await fs.readFile('.github/workflows/ci.yml', 'utf8');
  const workflow = await fs.readFile('.github/workflows/release.yml', 'utf8');
  assert.doesNotMatch(ci, /publish-npm|publish-release|--clobber|gh release/u);
  assert.match(workflow, /target: macos-arm64\s+runner: macos-15/u);
  assert.match(workflow, /target: windows-x64\s+runner: windows-2022/u);
  assert.match(workflow, /target: macos-x64\s+runner: macos-15-intel/u);
  assert.match(workflow, /target: linux-x64\s+runner: ubuntu-24\.04/u);
  assert.match(workflow, /needs: \[preflight, candidate, release-gates\]/u);
  for (const input of ['source_commit', 'version', 'release_repository', 'release_intent_id']) {
    assert.match(workflow, new RegExp(`      ${input}:\\r?\\n[\\s\\S]*?required: true`, 'u'));
  }
  assert.match(workflow, /test "\$EXPECTED_SOURCE_COMMIT" = "\$GITHUB_SHA"/u);
  assert.ok(workflow.indexOf('Reject invalid release entry') < workflow.indexOf('actions/checkout@'),
    'Invalid input must fail before executing a selected checkout, not green an entirely skipped workflow');
  assert.match(workflow, /needs: \[release-bundle, promote\]/u);
  assert.match(workflow, /uses: \.\/\.github\/workflows\/release-acceptance\.yml/u);
  assert.ok(!/publish_draft|publish_npm|--clobber|mktemp/u.test(workflow),
    'Release automation must not expose publication toggles, clobber assets or use an unowned scratch directory');
  const sources = await readWorkflowPolicySources(path.resolve('.'));
  const policy = validateReleaseActions(sources);
  const releaseDocument = policy.workflows.find(source => source.file === '.github/workflows/release.yml').document;
  const acceptanceDocument = policy.workflows.find(source => source.file === '.github/workflows/release-acceptance.yml').document;
  assert.deepEqual(Object.keys(releaseDocument.on), ['workflow_dispatch']);
  assert.deepEqual(Object.keys(acceptanceDocument.on), ['workflow_call']);
  assert.equal(releaseDocument.jobs.acceptance.secrets, undefined);
  assert.ok(Object.values(acceptanceDocument.jobs).every(job => job.secrets === undefined),
    'Native acceptance must not inherit or forward secrets');
  const completeJob = workflow.slice(workflow.indexOf('\n  completion:'));
  assert.match(completeJob, /continue-on-error: true[\s\S]*pattern: release-acceptance-/u);
  assert.match(completeJob, /Re-evaluate all seven R-POST cases[\s\S]*continue-on-error: true/u);
  assert.match(completeJob, /Overall completion requires every publication and native-consumer result[\s\S]*test "\$COMPLETION_STATUS" = Passed/u);
  assert.throws(() => validateReleaseActions(sources.map(source => source.file === '.github/workflows/release.yml' ?
    { ...source, contents: source.contents.replace('actions/checkout@11d5960a326750d5838078e36cf38b85af677262', 'actions/checkout@v4') } : source)),
  /action|pin|policy/iu);
  const acceptance = await fs.readFile('.github/workflows/release-acceptance.yml', 'utf8');
  assert.match(acceptance, /artifact-ids: \$\{\{ fromJSON\(inputs\.acceptance_handoff\)\.bundle\.artifactId \}\}/u);
  assert.match(acceptance, /EXPECTED_BUNDLE_SHA256/u);
  assert.match(acceptance, /ref: \$\{\{ fromJSON\(inputs\.acceptance_handoff\)\.identity\.sourceCommit \}\}/u);
  const dispatchableAcceptance = sources.map(source => source.file === '.github/workflows/release-acceptance.yml' ?
    { ...source, contents: source.contents.replace('  workflow_call:', '  workflow_dispatch:') } : source);
  assert.throws(() => validateReleaseActions(dispatchableAcceptance), error =>
    error.code === 'WORKFLOW_POLICY' && error.message.includes('UNSAFE_WORKFLOW_EVENT'));
  const inheritedSecrets = sources.map(source => source.file === '.github/workflows/release.yml' ?
    { ...source, contents: source.contents.replace(/^  acceptance:\r?$/mu, '  acceptance:\n    secrets: inherit') } : source);
  assert.throws(() => validateReleaseActions(inheritedSecrets), error =>
    error.code === 'WORKFLOW_POLICY' && error.message.includes('INHERITED_SECRETS'));
  validateReleaseActions(sources);
});

test('postpublication Homebrew acceptance uses an isolated pinned workspace prefix', async () => {
  const acceptance = await fs.readFile('.github/workflows/release-acceptance.yml', 'utf8');
  assert.match(acceptance, /node scripts\/native-toolchain\.mjs --target "\$NATIVE_TARGET" --output-dir \.test-data\/consumer-tools/u);
  assert.match(acceptance, /target: macos-x64\s+runner: macos-15-intel/u);
  assert.ok(acceptance.indexOf('scripts/native-toolchain.mjs') < acceptance.indexOf('scripts/release-orchestration.mjs consume'));
  assert.doesNotMatch(acceptance, /brew (?:unlink|link .*--overwrite)|HOMEBREW_NO_REQUIRE_TAP_TRUST/u);
});

test('T-PRD028 preflight rejects wrong source, destination, settings and trust before any publication mutation', async () => {
  const environment = {
    GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
    GITHUB_REPOSITORY: repository, GITHUB_SHA: sourceCommit, GITHUB_ACTOR: 'fixture-maintainer',
    GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', RELEASE_REPOSITORY: repository,
    GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/release.yml@refs/heads/main`,
    NPM_TRUSTED_PUBLISHER_REPOSITORY: repository, NPM_TRUSTED_PUBLISHER_CALLER: 'release.yml',
    NPM_TRUSTED_PUBLISHER_ENVIRONMENT: 'npm', SUPPORTED_PREVIOUS_VERSION: '0.3.0',
    SUPPORTED_PREVIOUS_DESCRIPTOR_SHA256: 'b'.repeat(64), SUPPORTED_PREVIOUS_CHECKSUMS_SHA256: 'c'.repeat(64),
  };
  const contexts = ['framework/validation', 'framework/approval', 'framework/coverage'];
  let wrongProtection = false;
  const calls = [];
  const api = async (route, options = {}) => {
    calls.push({ route, ...options });
    if (route.endsWith('/permission')) return { status: 200, value: { permission: 'maintain' } };
    if (route.endsWith('/branches/main/protection')) return { status: 200, value: {
      required_status_checks: { strict: !wrongProtection, contexts }, required_pull_request_reviews: {},
      required_conversation_resolution: { enabled: true }, enforce_admins: { enabled: true },
      allow_force_pushes: { enabled: false }, allow_deletions: { enabled: false } } };
    if (route.endsWith('/branches/main')) return { status: 200, value: { protected: true, commit: { sha: sourceCommit } } };
    if (route.endsWith('/status')) return { status: 200, value: { statuses: contexts.map(context => ({ context, state: 'success' })) } };
    if (route.endsWith('/environments/npm')) return { status: 200, value: { protection_rules: [] } };
    if (route.includes('/actions/artifacts?')) return { status: 200, value: { artifacts: [], total_count: 0 } };
    if (route.includes('/git/ref/')) return { status: 404 };
    return { status: 200, value: { private: false } };
  };
  const input = { sourceCommit, version: payload.version, repository, releaseIntentId, environment };
  for (const invalid of [
    { repository: '' }, { sourceCommit: 'f'.repeat(40) }, { version: '999.0.0' },
    { environment: { ...environment, GITHUB_EVENT_NAME: 'pull_request' } },
    { environment: { ...environment, RELEASE_REPOSITORY: '' } },
    { environment: { ...environment, NPM_TRUSTED_PUBLISHER_CALLER: 'other.yml' } },
  ]) await assert.rejects(preflightRelease({ ...input, ...invalid }, api, async () => null));
  wrongProtection = true;
  await assert.rejects(preflightRelease(input, api, async () => null), /Effective protected-main/u);
  wrongProtection = false;
  assert.equal((await preflightRelease(input, api, async () => null)).status, 'Passed');
  assert.ok(calls.every(call => !call.method), 'Preflight must never dispatch an irreversible effect');
});

test('T-PRD030 successful publication preserves exact release IDs and schedules automatic saved-bundle acceptance', async t => {
  const f = await fixture(t);
  const sealed = await sealBundle(f);
  const bundle = await verifyBundle({ directory: f.outputDir });
  const provider = githubFixture(bundle, f.outputDir);
  const result = await promoteRelease({ directory: f.outputDir, repository, expectedBundleSha256: sealed.bundleSha256,
    verifyEvidence: unitNativeVerifier, readRegistry: async () => ({ dist: { attestations: { url: 'fixture-metadata' } } }),
    verifyPayload: async (_metadata, identity) => assert.equal(identity.sha256, bundle.identity.payloadSha256) }, provider.api);
  assert.equal(result.github.status, 'Published');
  assert.equal(result.github.releaseId, 7);
  assert.equal(result.completion, 'NotRun', 'Publishing is not evidence of completed native consumers');
  const publicationFile = path.join(f.directory, 'published-for-acceptance.json');
  await writeJson(publicationFile, result);
  const originalPublicationBytes = await fs.readFile(publicationFile);
  const environment = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REPOSITORY: repository,
    GITHUB_REF: 'refs/heads/main', GITHUB_SHA: sourceCommit, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2',
    GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/release.yml@refs/heads/main` };
  const evidenceSha256 = 'e'.repeat(64);
  const handoffOptions = { directory: f.outputDir, publicationFile,
    bundleArtifactId: '91', sourceRunId: '123', expectedBundleSha256: sealed.bundleSha256,
    evidenceFilename: `release-prepublication-${releaseIntentId}-123-1-${evidenceSha256}.tar.gz`,
    evidenceSha256, previousVersion: previousFixture.identity.version,
    previousDescriptorSha256: previousFixture.identity.descriptorSha256,
    previousChecksumsSha256: previousFixture.identity.checksumsSha256,
    environment, verifyEvidence: unitNativeVerifier, sourceCommit, releaseIntentId };
  const handoff = await prepareAcceptanceHandoff(handoffOptions);
  const calls = [];
  for (const target of releaseConsumerTargets) await runReleaseAcceptance({ handoff, target,
    directory: f.outputDir, environment, consumer: async input => {
      calls.push(input);
      return { status: 'Passed', target, identity: bundle.identity, releaseIntentId, run: { id: '123', attempt: '2' } };
    } });
  assert.deepEqual(calls.map(input => input.target), [...releaseConsumerTargets]);
  for (const input of calls) {
    assert.equal(input.expectedBundleSha256, sealed.bundleSha256);
    assert.equal(input.sourceCommit, sourceCommit);
    assert.equal(input.previousDescriptorSha256, previousFixture.identity.descriptorSha256);
    assert.equal(input.evidenceSha256, evidenceSha256);
  }
  for (const run of [undefined, { id: '999', attempt: '2' }, { id: '123', attempt: '1' }]) {
    await assert.rejects(runReleaseAcceptance({ handoff, target: 'windows-x64', directory: f.outputDir, environment,
      consumer: async () => ({ target: 'windows-x64', identity: bundle.identity, releaseIntentId, run }) }),
    /physical execution handle/u);
  }
  for (const changed of [{ GITHUB_SHA: 'b'.repeat(40) }, { GITHUB_RUN_ATTEMPT: '3' },
    { GITHUB_EVENT_NAME: 'push' }, { GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/other.yml@refs/heads/main` }]) {
    assert.throws(() => admitAcceptanceHandoff(handoff, { environment: { ...environment, ...changed } }),
      /caller|source|selection|invocation/u);
  }
  const unpublishedFile = path.join(f.directory, 'unpublished-acceptance', 'publication-result.json');
  await writeJson(unpublishedFile, { ...result, github: { ...result.github, status: 'DraftAssetsVerified' } });
  await assert.rejects(prepareAcceptanceHandoff({ ...handoffOptions, publicationFile: unpublishedFile }),
    /confirmed before scheduling/u);
  assert.ok((await fs.readFile(publicationFile)).equals(originalPublicationBytes),
    'Rejected acceptance must not overwrite the confirmed publication receipt');
  const workflow = await fs.readFile('.github/workflows/release.yml', 'utf8');
  assert.match(workflow, /scripts\/release-orchestration\.mjs prepare/u);
  assert.match(workflow, /acceptance_handoff: \$\{\{ needs\.promote\.outputs\.acceptance_handoff \}\}/u);
});

test('T-PRD035 partial channels and missing consumers remain incomplete without fabricated rollback', async t => {
  const f = await fixture(t);
  const sealed = await sealBundle(f);
  const bundle = await verifyBundle({ directory: f.outputDir });
  const make = () => createCompletionFixture(t, { directory: f.directory, bundle, bundleDirectory: f.outputDir,
    expected: { expectedBundleSha256: sealed.bundleSha256 }, verifyEvidence: unitNativeVerifier });
  const baseline = await (await make()).complete();
  assert.equal(baseline.result.status, 'Passed', JSON.stringify(baseline.completion.blockers));
  assert.equal(baseline.completion.cases.length, 7);
  assert.ok(baseline.completion.cases.every(row => row.status === 'Passed'));
  for (const [name, mutate, expectedReason] of [
    ['npm-only', async input => fs.unlink(input.request.githubResultFile), /publication effects/u],
    ['github-only', async input => fs.unlink(input.request.npmResultFile), /publication effects/u],
    ['absent-handle', async input => {
      delete input.consumers.get('windows-x64').result.run.id;
      await input.writeConsumer('windows-x64');
    }, /binding|inventory/u],
    ['missing-consumer', async input => fs.unlink(input.consumers.get('macos-x64').file), /Missing complete/u],
    ['cancelled-consumer', async input => { input.provider.get('macos-arm64').conclusion = 'cancelled'; }, /inventory/u],
    ['stale-consumer', async input => {
      const old = new Date(Date.now() - 86_400_001).toISOString();
      const original = input.consumers.get('macos-arm64');
      Object.assign(original.report, { startedAt: old, finishedAt: old, observedAt: old });
      for (const row of original.report.results) row.observedAt = old;
      Object.assign(input.provider.get('macos-arm64'), { started_at: old, completed_at: old });
      await input.writeConsumer('macos-arm64');
    }, /inventory/u],
    ['failed-consumer', async input => {
      const original = input.consumers.get('windows-x64');
      original.result.status = 'Failed';
      original.report.exitCode = 1;
      Object.assign(original.report.results[0], { status: 'Failed', expectedMet: false, exitCode: 1 });
      input.provider.get('windows-x64').conclusion = 'failure';
      await input.writeConsumer('windows-x64');
    }, /inventory/u],
  ]) {
    const input = await make();
    await mutate(input);
    const { result, completion } = await input.complete();
    assert.notEqual(result.status, 'Passed', name);
    assert.equal(completion.cases.length, 7, name);
    assert.match(completion.blockers.join('\n'), expectedReason, name);
    assert.equal(JSON.stringify(completion).includes('RolledBack'), false);
    if (name === 'npm-only') assert.equal(completion.publication.npm.status, 'PublishedAndBytesVerified');
    if (name === 'github-only') assert.equal(completion.publication.github.github.status, 'Published');
    if (name === 'failed-consumer') {
      assert.equal(completion.status, 'Failed');
      assert.equal(completion.consumerAttempts.find(row => row.target === 'windows-x64').originalOutcome, 'Failed');
    }
  }
});

test('T-PRD034 bounded readback expires observably without retrying an irreversible effect', async () => {
  let clock = 0;
  const waits = [];
  const observations = [];
  let reads = 0;
  await assert.rejects(boundedReadback(async () => { reads++; return null; }, {
    timeoutMs: 10_000, now: () => clock, sleep: async ms => { waits.push(ms); clock += ms; },
    observe: record => observations.push(record),
  }), { code: 'PUBLICATION_UNCERTAIN' });
  assert.deepEqual(waits, [1000, 2000, 4000, 3000]);
  assert.equal(clock, 10_000);
  assert.equal(reads, observations.length);
  assert.equal(observations.at(-1).remainingMs, 0);
});

test('T-PRD054 failed preflight, lost upload response and missing acceptance never fabricate release success', async t => {
  let mutations = 0;
  await assert.rejects(preflightRelease({ sourceCommit: 'f'.repeat(40), version: payload.version,
    repository, releaseIntentId, environment: {} }, async () => { mutations++; throw new Error('Unexpected preflight effect'); }));
  assert.equal(mutations, 0);
  const f = await fixture(t);
  const sealed = await sealBundle(f);
  const bundle = await verifyBundle({ directory: f.outputDir });
  const provider = githubFixture(bundle, f.outputDir);
  let lost = false;
  const api = async (route, options) => {
    const result = await provider.api(route, options);
    if (!lost && route.startsWith('/uploads/')) {
      lost = true;
      throw new Error('Unit fixture lost the upload response after its effect');
    }
    return result;
  };
  const published = await promoteRelease({ directory: f.outputDir, repository, verifyEvidence: unitNativeVerifier,
    expectedBundleSha256: sealed.bundleSha256,
    readRegistry: async () => ({ dist: { attestations: { url: 'fixture-metadata-only' } } }),
    verifyPayload: async () => {} }, api);
  assert.equal(published.github.status, 'Published');
  assert.equal(lost, true);
  assert.equal(new Set(provider.assets.map(asset => asset.name)).size, provider.assets.length);
  const npm = path.join(f.directory, 'npm-outcome.json');
  const github = path.join(f.directory, 'github-outcome.json');
  await writeJson(npm, { status: 'PublishedAndBytesVerified', sourceCommit, releaseIntentId,
    bundleSha256: sealed.bundleSha256 });
  await writeJson(github, published);
  const result = await completeRelease({ directory: f.outputDir, expectedBundleSha256: sealed.bundleSha256,
    evidenceDir: path.join(f.directory, 'missing-acceptance'), npmResultFile: npm, githubResultFile: github,
    outputDir: path.join(f.directory, 'failed-completion'), verifyEvidence: unitNativeVerifier });
  assert.equal(result.status, 'NotRun');
  const retained = JSON.parse(await fs.readFile(path.join(f.directory, 'failed-completion', 'completion.json')));
  assert.equal(retained.publication.github.github.status, 'Published');
  assert.equal(retained.publication.npm.status, 'PublishedAndBytesVerified');
  assert.ok(retained.blockers.some(reason => reason.includes('native consumer')));
});

test('T-PRD037 later successful native completion preserves the failed physical attempt and separately retained archive', async t => {
  const f = await fixture(t);
  const sealed = await sealBundle(f);
  const bundle = await verifyBundle({ directory: f.outputDir });
  const initial = await createCompletionFixture(t, { directory: f.directory, bundle, bundleDirectory: f.outputDir,
    expected: { expectedBundleSha256: sealed.bundleSha256 }, verifyEvidence: unitNativeVerifier, runId: '456', attempt: '2' });
  const windows = initial.consumers.get('windows-x64');
  windows.result.status = 'Failed';
  windows.result.reason = 'Controlled first native upgrade failure';
  windows.report.exitCode = 1;
  Object.assign(windows.report.results[0], { status: 'Failed', expectedMet: false, exitCode: 1 });
  initial.provider.get('windows-x64').conclusion = 'failure';
  await initial.writeConsumer('windows-x64');
  const failed = await initial.complete();
  assert.equal(failed.result.status, 'Failed');
  const originalCompletion = await fs.readFile(path.join(failed.outputDir, 'completion.json'));
  const originalArchive = await fs.readFile(path.join(failed.outputDir, failed.result.evidenceFilename));
  assert.ok(failed.completion.consumerAttempts.some(row => row.originalOutcome === 'Failed'));
  const recovered = await createCompletionFixture(t, { directory: f.directory, bundle, bundleDirectory: f.outputDir,
    expected: { expectedBundleSha256: sealed.bundleSha256 }, verifyEvidence: unitNativeVerifier, runId: '456', attempt: '3' });
  const passed = await recovered.complete();
  assert.equal(passed.result.status, 'Passed', JSON.stringify(passed.completion.blockers));
  assert.equal(passed.completion.consumerAttempts.find(row => row.target === 'windows-x64').originalOutcome, 'Passed');
  assert.deepEqual(await fs.readFile(path.join(failed.outputDir, 'completion.json')), originalCompletion);
  assert.deepEqual(await fs.readFile(path.join(failed.outputDir, failed.result.evidenceFilename)), originalArchive);
  assert.notEqual(failed.result.evidenceFilename, passed.result.evidenceFilename);
  assert.notEqual(failed.result.evidenceSha256, passed.result.evidenceSha256);
  const originals = readTarGzip(originalArchive);
  assert.ok(originals.some(entry => entry.path.includes('windows-x64.json')));
  assert.ok(originals.some(entry => entry.path.endsWith('completion.json') && JSON.parse(entry.data).status === 'Failed'));
});

test('T-PRD037 release-lifetime archive reconstructs all original inputs as of their original time without renewing current credit', async t => {
  const f = await fixture(t);
  const simulatedOriginals = await Promise.all(RELEASE_GATE_TARGETS.flatMap(target =>
    [`${target}.json`, `native/${target}/execution.json`]).map(async filename =>
    ({ filename, bytes: await fs.readFile(path.join(f.evidenceDir, ...filename.split('/'))) })));
  const nativeEvidenceDir = path.join(f.directory, 'full-native-originals');
  const capturedAt = new Date().toISOString();
  const lanes = new Map();
  const nativeGates = [];
  const additionalTests = parseTestPlan(await fs.readFile('docs/sdlc/public-readiness/test-plan.md', 'utf8'))
    .filter(definition => /^T-PRD0(?:38|39)-(?:WX|MA|MI)$|^T-PRD042$/u.test(definition.id));
  assert.equal(additionalTests.length, 7);
  for (const target of RELEASE_GATE_TARGETS) {
    const lane = nativeReplayFixture({ candidate: f.candidate, target, profile: 'r-pre',
      sourceCommit, asOf: capturedAt, releaseIntentId, executionId: '123',
      previousMetadata: previousFixture, additionalTests });
    lanes.set(target, lane);
    const report = lane.data['execution.json'];
    for (const [filename, text] of Object.entries(lane.data.texts)) {
      await fs.mkdir(path.dirname(path.join(nativeEvidenceDir, 'native', target, ...filename.split('/'))), { recursive: true });
      await fs.writeFile(path.join(nativeEvidenceDir, 'native', target, ...filename.split('/')), text, { flag: 'wx' });
    }
    const gate = { ...simulatedGates(f.candidate).find(row => row.target === target),
      host: lane.context.native, finishedAt: report.observedAt, run: { id: '123', attempt: '1' } };
    nativeGates.push(gate);
    await writeJson(path.join(nativeEvidenceDir, `${target}.json`), gate);
  }
  const provider = nativeProducerFixture(f.candidate, nativeGates);
  const verifyEvidence = async ({ target }) => {
    const lane = lanes.get(target);
    const raw = lane.data['execution.json'];
    const normalized = normalizeExecutionReport(raw, lane.context, input => ({
      verifierId: 'controlled-archive-host', reportDigest: input.reportDigest, context: lane.context,
      sourceTime: raw.observedAt, sourceSequence: raw.sequence,
    }));
    const evaluation = evaluateReadiness(lane.definition.specification, [normalized], {
      profile: lane.definition.specification.profile, executions: [{ id: lane.context.jobRef, context: lane.context }],
      now: capturedAt, policy: { maxAgeMs: 86_400_000, revisionPolicy: 'exact', verifierIds: ['controlled-archive-host'] },
    });
    return { context: lane.context, evaluation };
  };
  const trusted = { verifyEvidence, api: provider.api, sourceRepository: repository };
  const sealed = await sealProductionBundle({ ...f, ...trusted, evidenceDir: nativeEvidenceDir, sourceCommit, releaseIntentId,
    clock: () => Date.parse(capturedAt) });
  for (const original of simulatedOriginals) {
    assert.ok((await fs.readFile(path.join(f.evidenceDir, ...original.filename.split('/')))).equals(original.bytes),
      `Independent native staging must preserve the earlier original ${original.filename}`);
  }
  const evidenceDir = path.join(f.directory, 'durable-data-only-evidence');
  const retained = await prepublicationEvidence({ directory: f.outputDir, outputDir: evidenceDir,
    expectedBundleSha256: sealed.bundleSha256, runId: '123', attempt: '1', ...trusted,
    captureDefinition: async ({ target }) => lanes.get(target).definition });
  const archive = path.join(evidenceDir, retained.evidenceFilename);
  const original = await fs.readFile(archive);
  const entries = readTarGzip(original);
  const graph = JSON.parse(entries.find(entry => entry.path === 'replay-inputs.json').data);
  assert.equal(graph.historicalReplay, 'Available');
  assert.equal(graph.expectedContexts.length, 4);
  assert.equal(graph.producerFacts.length, 4);
  assert.deepEqual(graph.definitions.map(ref => ref.target).sort(), [...RELEASE_GATE_TARGETS].sort());
  const manifest = JSON.parse(entries.find(entry => entry.path === 'bundle.json').data);
  for (const file of manifest.files.filter(file => !file.filename.startsWith('assets/'))) {
    assert.ok(entries.some(entry => entry.path === file.filename && sha256(entry.data) === file.sha256), file.filename);
  }
  assert.equal(entries.some(entry => entry.path.startsWith('assets/')), false);
  const asOf = new Date(Date.now() + 120_000).toISOString();
  const verifyArchive = async input => ({ verifierId: 'controlled-signature-host',
    archiveSha256: input.archiveSha256, sourceCommit: input.sourceCommit, sourceRepository: repository,
    mechanisms: { signature: 'Passed', certificate: 'Passed', transparency: 'Passed' } });
  const request = { archive, expectedArchiveSha256: retained.evidenceSha256, expectedBundleSha256: sealed.bundleSha256,
    expectedSourceCommit: sourceCommit, expectedReleaseIntentId: releaseIntentId, asOf, sourceRepository: repository,
    assetsDirectory: path.join(f.outputDir, 'assets'), verifyArchive };
  const replay = await verifyHistoricalRelease({ ...request, materializeDirectory: path.join(f.directory, 'clean-reconstructed-receiver') });
  assert.equal(replay.historical.status, 'Passed');
  assert.equal(replay.historical.executions.length, 4);
  assert.equal(replay.current.status, 'NotRun');
  assert.equal(replay.publicationReady, false);
  assert.equal(replay.evaluatedAsOf, asOf);
  const bundle = await verifyProductionBundle({ directory: f.outputDir, ...trusted });
  const originalDefinition = lanes.get('linux-x64').definition;
  const completions = [];
  for (const attempt of ['2', '3']) {
    const completed = await createCompletionFixture(t, { directory: f.directory, bundle, bundleDirectory: f.outputDir,
      expected: { expectedBundleSha256: sealed.bundleSha256 }, verifyEvidence,
      runId: '456', attempt, repositoryId: '17', plan: originalDefinition.plan, tree: originalDefinition.source.treeSha });
    completed.request.prepublicationEvidenceSha256 = retained.evidenceSha256;
    completed.request.prepublicationEvidenceFilename = retained.evidenceFilename;
    for (const target of ['windows-x64', 'macos-arm64', 'macos-x64']) {
      completed.consumers.get(target).result.provenance.github.subjectSha256 = retained.evidenceSha256;
      await completed.writeConsumer(target);
    }
    if (attempt === '2') {
      const failed = completed.consumers.get('windows-x64');
      failed.result.status = 'Failed';
      failed.report.exitCode = 1;
      Object.assign(failed.report.results[0], { status: 'Failed', expectedMet: false, exitCode: 1 });
      completed.provider.get('windows-x64').conclusion = 'failure';
      await completed.writeConsumer('windows-x64');
    }
    const result = await completed.complete();
    assert.equal(result.result.status, attempt === '2' ? 'Failed' : 'Passed', JSON.stringify(result.completion.blockers));
    const archive = path.join(result.outputDir, result.result.evidenceFilename);
    const bytes = await fs.readFile(archive);
    const historical = await verifyHistoricalCompletion({ archive, expectedArchiveSha256: result.result.evidenceSha256,
      prepublicationArchive: request.archive, expectedPrepublicationArchiveSha256: retained.evidenceSha256,
      expectedBundleSha256: sealed.bundleSha256, expectedSourceCommit: sourceCommit,
      expectedReleaseIntentId: releaseIntentId, asOf: new Date(Date.now() + 120_000).toISOString(),
      sourceRepository: repository, assetsDirectory: path.join(f.outputDir, 'assets'), verifyArchive,
      materializeDirectory: path.join(f.directory, `historical-completion-${attempt}`) });
    if (process.env.SDLC_RELEASE_HISTORY_DIAGNOSTICS === '1') {
      process.stdout.write(`${JSON.stringify({ kind: 'historical-provenance-binding-diagnostic', attempt,
        originalStatus: historical.originalStatus, historicalStatus: historical.historical.status,
        currentStatus: historical.current.status, archiveSha256: historical.archiveSha256,
        prepublicationArchiveSha256: historical.prepublicationArchiveSha256, bundleSha256: historical.bundleSha256,
        binding: historical.historical.provenanceBinding })}\n`);
    }
    assert.equal(historical.historical.status, attempt === '2' ? 'Failed' : 'Passed', JSON.stringify(historical.historical.blockers));
    assert.equal(historical.historical.cases.length, 7);
    assert.equal(historical.originalStatus, result.result.status);
    assert.equal(historical.current.status, 'NotRun');
    assert.equal(historical.publicationReady, false);
    completions.push({ archive, bytes, result });
  }
  for (const original of completions) assert.deepEqual(await fs.readFile(original.archive), original.bytes);
  const passedCompletion = completions[1];
  const completionEntries = readTarGzip(passedCompletion.bytes);
  const changedClockInputs = JSON.parse(completionEntries.find(entry => entry.path === 'completion-inputs.json').data);
  changedClockInputs.provenance.sourceTime =
    new Date(Date.parse(changedClockInputs.provenance.sourceTime) + 1000).toISOString();
  const changedClockBytes = Buffer.from(canonical(changedClockInputs));
  const changedClockCompletion = JSON.parse(completionEntries.find(entry => entry.path === 'completion.json').data);
  changedClockCompletion.inputClosure.sha256 = sha256(changedClockBytes);
  const changedClockArchiveBytes = tarGzip(completionEntries.map(entry => entry.path === 'completion-inputs.json' ?
    { ...entry, data: changedClockBytes } : entry.path === 'completion.json' ?
      { ...entry, data: Buffer.from(canonical(changedClockCompletion)) } : entry));
  const changedClockArchive = path.join(f.directory, 'changed-provenance-clock.tar.gz');
  await fs.writeFile(changedClockArchive, changedClockArchiveBytes, { flag: 'wx' });
  await assert.rejects(verifyHistoricalCompletion({ archive: changedClockArchive,
    expectedArchiveSha256: sha256(changedClockArchiveBytes), prepublicationArchive: request.archive,
    expectedPrepublicationArchiveSha256: retained.evidenceSha256, expectedBundleSha256: sealed.bundleSha256,
    expectedSourceCommit: sourceCommit, expectedReleaseIntentId: releaseIntentId,
    asOf: new Date(Date.now() + 120_000).toISOString(), sourceRepository: repository,
    assetsDirectory: path.join(f.outputDir, 'assets'), verifyArchive,
    materializeDirectory: path.join(f.directory, 'changed-clock-completion-receiver') }), error =>
    error.code === 'RELEASE_REPLAY' && error.message.includes('"sourceTime":false') &&
      error.message.includes('"specification":true') && error.message.includes('"context":true'));
  const missingClosure = tarGzip(completionEntries.filter(entry => entry.path !== 'completion-inputs.json'));
  const damagedCompletion = path.join(f.directory, 'missing-completion-inputs.tar.gz');
  await fs.writeFile(damagedCompletion, missingClosure);
  await assert.rejects(verifyHistoricalCompletion({ archive: damagedCompletion,
    expectedArchiveSha256: sha256(missingClosure), prepublicationArchive: request.archive,
    expectedPrepublicationArchiveSha256: retained.evidenceSha256, expectedBundleSha256: sealed.bundleSha256,
    expectedSourceCommit: sourceCommit, expectedReleaseIntentId: releaseIntentId,
    asOf: new Date(Date.now() + 120_000).toISOString(), sourceRepository: repository,
    assetsDirectory: path.join(f.outputDir, 'assets'), verifyArchive,
    materializeDirectory: path.join(f.directory, 'missing-closure-completion-receiver') }), /missing|changed/iu);
  await assert.rejects(verifyProductionBundle({ directory: f.outputDir, ...trusted, verifyEvidence: async input => ({
    ...await verifyEvidence(input), historical: true, currentCredit: 'NotRun',
  }) }), /Historical\/as-of verification cannot provide current/u);
  for (const filename of ['readiness.json', 'context.json', INPUT_FILENAME, 'handoff/windows-tester-prompt.json',
    'handoff/windows-tester-prompt.md', graph.template.filename, ...graph.definitions.map(ref => ref.filename),
    ...RELEASE_GATE_TARGETS.map(target => `evidence/${target}.json`),
    ...RELEASE_GATE_TARGETS.map(target => `evidence/native/${target}/execution.json`)]) {
    const bytes = tarGzip(entries.filter(entry => entry.path !== filename));
    const damaged = path.join(f.directory, `missing-${randomUUID()}.tar.gz`);
    await fs.writeFile(damaged, bytes);
    await assert.rejects(verifyHistoricalRelease({ ...request, archive: damaged,
      expectedArchiveSha256: sha256(bytes), materializeDirectory: path.join(f.directory, `receiver-${randomUUID()}`) }),
    /missing|changed|incomplete|identity/iu, filename);
  }
  await assert.rejects(verifyHistoricalRelease({ ...request, expectedArchiveSha256: '0'.repeat(64),
    materializeDirectory: path.join(f.directory, 'corrupt-receiver') }), /archive digest differs/u);
  await assert.rejects(verifyHistoricalRelease({ ...request, verifyArchive: async () => true,
    materializeDirectory: path.join(f.directory, 'unverified-receiver') }), /cannot authenticate/u);
  const expired = await verifyHistoricalRelease({ ...request, asOf: new Date(Date.parse(asOf) + 172_800_000).toISOString(),
    materializeDirectory: path.join(f.directory, 'expired-as-of-receiver') });
  assert.equal(expired.historical.status, 'NotRun');
  assert.equal(expired.current.status, 'NotRun');
  assert.deepEqual(await fs.readFile(archive), original);
});

test('T-PRD037 retained signed material remains an exact separate immutable subject graph and cannot choose its own trust root', async t => {
  const f = await fixture(t);
  const archiveBytes = Buffer.from('Controlled signed subject bytes; never actual release evidence');
  const archiveSha256 = sha256(archiveBytes);
  const archive = path.join(f.directory, `release-prepublication-${releaseIntentId}-123-1-${archiveSha256}.tar.gz`);
  const signed = Buffer.from(`${JSON.stringify({ verificationMaterial: { certificate: 'controlled-fixture-only' },
    dsseEnvelope: { payloadType: 'application/vnd.in-toto+json', payload: Buffer.from('{}').toString('base64'),
      signatures: [{ sig: 'controlled-host-verifier-only' }] } })}\n`);
  const attestationBundle = path.join(f.directory, 'original-signed-bundle.jsonl');
  await fs.writeFile(archive, archiveBytes);
  await fs.writeFile(attestationBundle, signed);
  const outputDir = path.join(f.directory, 'trust-sidecars');
  await fs.mkdir(outputDir);
  let verifications = 0;
  const run = async (command, args) => {
    verifications++;
    assert.equal(command, 'gh');
    assert.equal(args[args.indexOf('--bundle') + 1], attestationBundle);
    assert.equal(args[args.indexOf('--signer-digest') + 1], sourceCommit);
    return { stdout: JSON.stringify([{ verificationResult: {
      statement: { subject: [{ digest: { sha256: archiveSha256 } }] }, verifiedTimestamps: [{ type: 'Tlog' }],
    } }]) };
  };
  const retained = await retainAttestationMaterial({ archive, attestationBundle, expectedArchiveSha256: archiveSha256,
    expectedSourceCommit: sourceCommit, releaseIntentId, outputDir, sourceRepository: repository, runId: '123', attempt: '1', run });
  assert.equal(verifications, 1);
  assert.deepEqual(await fs.readFile(path.join(outputDir, retained.attestationFilename)), signed);
  const trust = JSON.parse(await fs.readFile(path.join(outputDir, retained.trustFilename)));
  assert.deepEqual(trust.subject, { filename: path.basename(archive), sha256: archiveSha256 });
  assert.equal(trust.attestation.sha256, sha256(signed));
  assert.deepEqual(await fs.readFile(archive), archiveBytes, 'Attestation retention must never hash itself back into the subject');
  const trustedRoot = path.join(f.directory, 'untrusted-root.json');
  await fs.writeFile(trustedRoot, '{"fixture":true}\n');
  await assert.rejects(verifyArchiveWithGh({ archive, attestationBundle, expectedArchiveSha256: archiveSha256,
    expectedSourceCommit: sourceCommit, sourceRepository: repository, trustedRoot, run }), /independent expected root digest/u);
  await assert.rejects(verifyArchiveWithGh({ archive, attestationBundle, expectedArchiveSha256: archiveSha256,
    expectedSourceCommit: sourceCommit, sourceRepository: repository, trustedRoot,
    expectedTrustedRootSha256: '0'.repeat(64), run }), /independent expected root digest/u);
  assert.equal(verifications, 1);
  await assert.rejects(retainAttestationMaterial({ archive, attestationBundle, expectedArchiveSha256: archiveSha256,
    expectedSourceCommit: sourceCommit, releaseIntentId, outputDir, sourceRepository: repository, runId: '123', attempt: '1', run }),
  { code: 'EEXIST' });
  assert.deepEqual(await fs.readFile(path.join(outputDir, retained.attestationFilename)), signed);
});

test('T-PRD054 release CLI entry cycles reject invalid local inputs without hanging or reaching a provider', async t => {
  const f = await fixture(t);
  for (const [script, args, reason] of [
    ['release-bundle.mjs', ['unknown-command'], /Expected prepare, seal or verify/u],
    ['publish-release.mjs', ['unknown-command'], /Expected preflight, draft or promote/u],
    ['release-gate.mjs', ['--target', 'unsupported', '--candidate-dir', f.candidateDir], /target|platform|unsupported/iu],
  ]) {
    await assert.rejects(execute(process.execPath, [path.resolve('scripts', script), ...args], {
      cwd: f.directory, timeout: 10_000, env: { ...process.env, GITHUB_TOKEN: '', GH_TOKEN: '' },
    }), error => {
      assert.equal(error.killed, false, `${script} must exit instead of deadlocking in a dynamic self-import`);
      assert.equal(error.code, 1);
      assert.match(error.stderr, reason);
      return true;
    });
  }
});
