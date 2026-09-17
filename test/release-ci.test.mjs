import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { canonical, readTarGzip, sha256, tarGzip } from '../packaging/standalone/archive.mjs';
import { isPrerelease, platformEntries } from '../packaging/standalone/protocol.mjs';
import { generateManifests } from '../packaging/winget/generate.mjs';
import { generateWindowsTesterPrompt, INPUT_FILENAME, renderWindowsTesterPrompt,
  validateWindowsTesterPrompt } from '../packaging/windows-tester/generate.mjs';
import { buildPackage } from '../scripts/package.mjs';
import { buildPlatforms, writeReleaseMetadata } from '../scripts/package-platforms.mjs';
import { RELEASE_SCOPE, RELEASE_TARGETS, RELEASE_GATE_TARGETS, archiveRecord, evidenceIdentity, options,
  homebrewMetadata, releaseRepository, sealBundle, selectGateFiles, validateGates, verifyBundle,
  prepareRelease, verifyCandidate, windowsTesterInput, windowsTesterReadiness, writeJson } from '../scripts/release-bundle.mjs';
import { publishApprovedDraft, publishDraft, verifyRegistryPayload } from '../scripts/publish-release.mjs';
import { NPM_TRUST, npmHandoffFromVerifiedBundle, prepareNpmHandoff } from '../scripts/npm-handoff.mjs';
import { acceptPublicHomebrew, downloadPublicAssets } from '../scripts/accept-release.mjs';
import { verifyIntelFormula, verifyMacosArchives, verifyNativeHomebrew } from '../scripts/release-gate.mjs';
import { verifyHomebrewQuality } from '../scripts/homebrew-quality.mjs';

let root;
let base;
let payload;
let originalTmp;
const repository = NPM_TRUST.repository;
const sourceCommit = 'a'.repeat(40);
const candidateBaseUrl = 'http://127.0.0.1:8765/';
const packagePrerelease = isPrerelease(
  JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8')).version);

function fixtureFormula(descriptor, { mode = 'stable', candidateBaseUrl } = {}) {
  const base = mode === 'candidate' ? candidateBaseUrl :
    `https://github.com/${repository}/releases/download/v${descriptor.version}/`;
  return (mode === 'candidate' ? '# Test-only local candidate; never publish to the stable tap.\n' : '') +
    'class AiSdlcFramework < Formula\n  depends_on :macos\n  depends_on "node@22"\n\n  on_macos do\n' +
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
    nodeDependency: { validation: 'Passed', formula: 'node@22', major: 22, scope: 'runtime', conditional: false },
    nativeExecution: 'NotRun', tool: 'Homebrew', brew, brewVersion: 'Homebrew unit-test fixture',
    style, audit, commands: [style, audit].map(stage => ({ command: brew, args: stage.args, exitCode: 0 })) };
}

async function mockQuality({ candidate, formulaPath, targetArch, mode }) {
  const bytes = await fs.readFile(formulaPath);
  return simulatedQuality(candidate, { filename: 'ai-sdlc-framework.rb', kind: 'homebrew',
    sha256: sha256(bytes), size: bytes.length }, targetArch, mode);
}

function simulatedGates(candidate) {
  const identity = candidate.context.identity;
  const intel = archiveRecord(candidate, 'macos-x64');
  const mode = candidate.context.prerelease ? 'candidate' : 'stable';
  const formulaBase = candidate.context.prerelease ? candidateBaseUrl :
    `https://github.com/${repository}/releases/download/v${identity.version}/`;
  const formula = candidate.descriptor.files.find(file => file.kind === 'homebrew') ?? (() => {
    const contents = fixtureFormula(candidate.descriptor, { mode, candidateBaseUrl });
    return { filename: 'ai-sdlc-framework.rb', kind: 'homebrew',
      sha256: sha256(Buffer.from(contents)), size: Buffer.byteLength(contents) };
  })();
  // Unit fixtures only: these records never leave the per-test directory or represent a real CI run.
  return RELEASE_GATE_TARGETS.map(target => ({
    schemaVersion: 1, target, identity, required: RELEASE_SCOPE[target].required,
    validation: RELEASE_SCOPE[target].validation,
    status: 'Passed',
    nativeValidation: target === 'macos-arm64' ? 'Passed' : 'NotRun',
    ...(target === 'macos-arm64' ? { networkDeniedLifecycle: 'Passed', host: { platform: 'darwin', arch: 'arm64' },
      homebrew: { nativeValidation: 'Passed', evidence: { passed: true, platform: 'darwin',
        architecture: 'arm64', uname: 'arm64', homebrewRuntime: { platform: 'darwin', arch: 'arm64', major: 22 },
        commands: ['unit fixture only'] },
      quality: simulatedQuality(candidate, formula, 'arm64', mode) } } : {}),
    ...(target === 'windows-x64' ? { deterministicCrossBuild: 'Passed', payloadIntegrity: 'Passed',
      schema: { schemaValidation: 'Passed' }, host: { platform: 'linux', arch: 'x64' },
      winget: { contractValidation: 'Passed', nativeValidation: 'NotRun' },
      testerInputValidation: 'Passed' } : {}),
    ...(target === 'macos-x64' ? {
      deterministicArchive: { validation: 'Passed', target, platform: 'darwin', arch: 'x64',
        filename: intel.filename, sha256: intel.sha256, size: intel.size,
        payloadSha256: identity.payloadSha256, inventoryDigest: candidate.descriptor.payload.inventoryDigest },
      homebrew: { validation: 'Passed', deterministicGeneration: 'Passed', mode, nativeValidation: 'NotRun',
        formula,
        quality: simulatedQuality(candidate, formula, 'x64', mode),
        architectures: ['arm64', 'x64'].map(arch => {
          const archive = archiveRecord(candidate, `macos-${arch}`);
          return { arch, ...archive, url: `${formulaBase}${archive.filename}` };
        }) },
    } : {}),
  }));
}

test.before(async () => {
  root = path.resolve('.test-data', `release-unit-${randomUUID()}`);
  await fs.mkdir(path.join(root, 'scratch'), { recursive: true });
  originalTmp = process.env.TMPDIR;
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
  await writeJson(path.join(base, INPUT_FILENAME), windowsTesterInput(final, repository, sha256(pe)));
  await writeJson(path.join(base, 'context.json'), { schemaVersion: 1, releaseRepository: repository,
    identity: evidenceIdentity(final), scope: RELEASE_SCOPE, prerelease,
    launcher: { sha256: sha256(pe) },
    homebrew: { status: prerelease ? 'NotPublishedPrerelease' : 'Generated' } });
});

test.after(async () => {
  if (originalTmp === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = originalTmp;
  await fs.rm(root, { recursive: true, force: true });
});

async function fixture(t) {
  const directory = path.join(root, randomUUID());
  const candidateDir = path.join(directory, 'candidate');
  const evidenceDir = path.join(directory, 'simulated-evidence');
  const outputDir = path.join(directory, 'bundle');
  await fs.cp(base, candidateDir, { recursive: true });
  const candidate = await verifyCandidate(candidateDir);
  for (const gate of simulatedGates(candidate)) await writeJson(path.join(evidenceDir, `${gate.target}.json`), gate);
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { directory, candidateDir, evidenceDir, outputDir, candidate };
}

test('Intel publishes with mandatory deterministic evidence, native NotRun, and Linux excluded', () => {
  assert.deepEqual(RELEASE_TARGETS, ['macos-arm64', 'macos-x64', 'windows-x64']);
  assert.deepEqual(RELEASE_GATE_TARGETS, ['macos-arm64', 'macos-x64', 'windows-x64']);
  assert.equal(RELEASE_SCOPE['macos-x64'].publish, true);
  assert.equal(RELEASE_SCOPE['macos-x64'].homebrew, true);
  assert.equal(RELEASE_SCOPE['macos-x64'].required, true);
  assert.equal(RELEASE_SCOPE['macos-x64'].native, 'NotRun');
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

test('bundle seals exact payload and final manager metadata before descriptor/checksum pins', async t => {
  const f = await fixture(t);
  const sealed = await sealBundle(f);
  const bundle = await verifyBundle({ directory: f.outputDir, expectedBundleSha256: sealed.bundleSha256 });
  assert.equal(bundle.identity.payloadSha256, payload.sha256);
  assert.equal(bundle.descriptor.files.filter(file => file.kind === 'winget').length, packagePrerelease ? 0 : 3);
  assert.equal(bundle.descriptor.files.filter(file => file.kind === 'archive').length, 4);
  assert.ok(bundle.files.every(file => !file.filename.includes('linux')));
  assert.ok(bundle.files.some(file => file.filename === `assets/ai-sdlc-framework-${payload.version}-macos-x64.tar.gz`));
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

test('Homebrew adapter requires separate arm64/x64 URL and checksum stanzas for the approved destination',
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
  await assert.rejects(homebrewMetadata({ ...args, repository: 'wrong/repo' }), /architecture stanzas/u);
  await assert.rejects(homebrewMetadata({ ...args, generator: async input =>
    ({ ...await generator(input), sha256: '0'.repeat(64) }) }), /invalid formula record/u);
  const armDigest = archiveRecord({ descriptor }, 'macos-arm64').sha256;
  const intelDigest = archiveRecord({ descriptor }, 'macos-x64').sha256;
  for (const mutate of [
    contents => contents.replace('  depends_on :macos', '  depends_on arch: :arm64\n  depends_on :macos'),
    contents => contents.replace('on_intel do', 'on_arm do'),
    contents => contents.replace('on_macos do', 'on_linux do'),
    contents => contents.replace(armDigest, intelDigest),
    contents => contents.replaceAll('macos-x64.tar.gz', 'macos-arm64.tar.gz'),
    contents => contents.replaceAll(armDigest, 'TEMP').replaceAll(intelDigest, armDigest).replaceAll('TEMP', intelDigest),
    contents => contents.replace('      sha256', '      # sha256'),
    contents => `${contents}url "https://example.invalid/override"\n`,
    contents => contents.replace('  depends_on "node@22"\n', ''),
    contents => contents.replace('  depends_on "node@22"\n', '    depends_on "node@22"\n'),
    contents => contents.replace('  depends_on "node@22"\n', '  depends_on "node@22" => :build\n'),
    contents => contents.replace('  depends_on "node@22"\n', '  depends_on "node@22" if Hardware::CPU.arm?\n'),
    contents => contents.replace('  depends_on "node@22"\n', '  depends_on "node@22"\n  depends_on "node@20"\n'),
    contents => contents.replace('  depends_on "node@22"\n', '  depends_on "node@22"\n  depends_on "node@22"\n'),
  ]) {
    await assert.rejects(homebrewMetadata({ ...args, generator: async input => {
      const formula = await generator(input);
      const contents = mutate(formula.contents);
      return { ...formula, contents, sha256: sha256(Buffer.from(contents)), size: Buffer.byteLength(contents) };
    } }), /Homebrew.*(?:stanzas|contract)/u);
  }
});

test('candidate verification independently rejects checksum-consistent swapped Intel formula metadata',
  { skip: packagePrerelease ? 'Stable Homebrew publication metadata is not generated for prereleases' : false }, async t => {
  const f = await fixture(t);
  const file = path.join(f.directory, 'ai-sdlc-framework.rb');
  const correct = fixtureFormula(f.candidate.descriptor);
  for (const corrupt of [false, true]) {
    await fs.writeFile(file, corrupt ? correct.replace('on_intel do', 'on_arm do') : correct);
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
    if (corrupt) await assert.rejects(verifyCandidate(f.candidateDir), /architecture stanzas/u);
    else assert.equal((await verifyCandidate(f.candidateDir)).context.homebrew.status, 'Generated');
  }
});

test('Intel cross-only gate reproduces archives and formula bytes without native execution', async t => {
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
    { ...gate, deterministicArchive: archive, homebrew } : gate);
  windowsTesterReadiness(f.candidate, gates);
  for (const mutate of [
    gate => { gate.deterministicArchive.sha256 = '0'.repeat(64); },
    gate => { gate.homebrew.architectures[1].url = 'https://example.invalid/latest'; },
    gate => { gate.homebrew.formula.sha256 = '0'.repeat(64); },
  ]) {
    const copy = structuredClone(gates);
    mutate(copy.find(gate => gate.target === 'macos-x64'));
    assert.throws(() => windowsTesterReadiness(f.candidate, copy), /not bound|candidate-bound/u);
  }
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

test('Intel archive must exist and have actual darwin/x64 identity, even with consistent outer checksums', async t => {
  const f = await fixture(t);
  const directory = path.join(f.candidateDir, 'assets');
  const intel = archiveRecord(f.candidate, 'macos-x64');
  await fs.unlink(path.join(directory, intel.filename));
  await assert.rejects(verifyCandidate(f.candidateDir), { code: 'ENOENT' });
  const arm = archiveRecord(f.candidate, 'macos-arm64');
  await fs.copyFile(path.join(directory, arm.filename), path.join(directory, intel.filename));
  const metadataFiles = f.candidate.descriptor.files.filter(file => file.kind !== 'archive')
    .map(file => ({ artifact: path.join(directory, file.filename), kind: file.kind }));
  await writeReleaseMetadata({ outputDir: directory, artifact: payload.artifact, sourceCommit,
    targets: RELEASE_TARGETS, metadataFiles });
  await assert.rejects(verifyCandidate(f.candidateDir), /Wrong-version or wrong-platform/u);
});

async function qualityFixture(t) {
  const f = await fixture(t);
  const prefix = path.join(f.directory, 'isolated-brew');
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
    assert.equal(quality.nodeDependency.formula, 'node@22');
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
  await fs.writeFile(wrongFormula, (await fs.readFile(f.formulaPath, 'utf8')).replace('node@22', 'node@20'));
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
    scratch: f.directory, brew: f.brew, verifyLifecycle: async () => assert.fail('Lifecycle must not run after failed metadata audit'),
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
    values => { values[0].host.arch = 'x64'; },
    values => { values[0].identity = { ...values[0].identity, payloadSha256: '0'.repeat(64) }; },
    values => { values.find(item => item.target === 'windows-x64').nativeValidation = 'Passed'; },
    values => { values.find(item => item.target === 'windows-x64').schema.schemaValidation = 'NotRun'; },
    values => { values.find(item => item.target === 'windows-x64').testerInputValidation = 'NotRun'; },
    values => { values[0].homebrew.nativeValidation = 'NotRun'; },
    values => { values.find(item => item.target === 'macos-x64').status = 'NotRun'; },
    values => { values.find(item => item.target === 'macos-x64').nativeValidation = 'Passed'; },
    values => { values.find(item => item.target === 'macos-x64').homebrew.deterministicGeneration = 'NotRun'; },
    values => { values[0].homebrew.quality.style.status = 'NotRun'; },
    values => { values[0].homebrew.quality.audit.status = 'Failed'; },
    values => { values[0].homebrew.quality.nodeDependency.scope = 'build'; },
    values => { values[0].homebrew.evidence.homebrewRuntime.major = 20; },
    values => { values.find(item => item.target === 'macos-x64').homebrew.quality.audit.args[4] = '--arch=arm'; },
    values => { values.find(item => item.target === 'macos-x64').homebrew.quality.commands = []; },
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
  const args = { candidate: f.candidate, candidateDir: f.candidateDir, scratch: f.directory };
  await assert.rejects(verifyNativeHomebrew({ ...args,
    candidate: { ...f.candidate, context: { ...f.candidate.context, homebrew: { status: 'NotIntegrated' } } } }),
  { code: 'RELEASE_INTEGRATION_BLOCKED' });
  await assert.rejects(verifyNativeHomebrew({ ...args, brew: '', verifyLifecycle: async () => ({ passed: true }) }),
    { code: 'RELEASE_INTEGRATION_BLOCKED' });
  const evidence = simulatedGates(f.candidate)[0].homebrew.evidence;
  const passed = await verifyNativeHomebrew({ ...args, brew: path.join(f.directory, 'isolated/bin/brew'), verifyQuality: mockQuality,
    verifyLifecycle: async input => {
      assert.equal(input.candidateDirectory, path.join(f.candidateDir, 'assets'));
      return evidence;
    } });
  assert.equal(passed.nativeValidation, 'Passed');
  await assert.rejects(verifyNativeHomebrew({ ...args, scratch: path.join(f.directory, 'bad-native'),
    brew: path.join(f.directory, 'isolated/bin/brew'), verifyQuality: mockQuality,
    verifyLifecycle: async () => ({ ...evidence, architecture: 'x64' }) }), /did not pass/u);
});

test('Intel deterministic evidence is required for sealing but Intel native execution is never required', async t => {
  const f = await fixture(t);
  const sealed = await sealBundle(f);
  await verifyBundle({ directory: f.outputDir, expectedBundleSha256: sealed.bundleSha256 });
  const intel = JSON.parse(await fs.readFile(path.join(f.outputDir, 'evidence/macos-x64.json'), 'utf8'));
  assert.equal(intel.status, 'Passed');
  assert.equal(intel.nativeValidation, 'NotRun');
  assert.equal(intel.required, true);
  await fs.unlink(path.join(f.evidenceDir, 'macos-x64.json'));
  await assert.rejects(sealBundle({ ...f, outputDir: path.join(f.directory, 'missing-intel-bundle') }), /every scoped mandatory gate/u);
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
  assert.ok(selected.find(file => file.includes('macos-arm64')).includes('-123-2'));
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
    if (route.includes('/git/ref/tags/')) return { status: 200, value: { object: { type: 'commit', sha: tagCommit } } };
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
    setTag: value => { tagCommit = value; }, setPrivate: value => { privateRepo = value; },
    makePublic: () => { release.draft = false; },
    duplicateDraft: () => { duplicateDraft = { ...release, id: release.id + 1 }; },
    clearDuplicateDraft: () => { duplicateDraft = undefined; } };
}

test('complete T-60 content authorizes publisher entrypoints and forged readiness is rejected', async t => {
  const f = await fixture(t);
  const sealed = await sealBundle(f);
  const handoff = await prepareNpmHandoff({ directory: f.outputDir, sourceRepository: repository,
    expectedBundleSha256: sealed.bundleSha256 });
  assert.equal(handoff.version, payload.version);
  const manifest = JSON.parse(await fs.readFile(path.join(f.outputDir, 'bundle.json'), 'utf8'));
  await fs.writeFile(path.join(f.outputDir, 'bundle.json'), canonical({ ...manifest, publicationReady: false }));
  await assert.rejects(verifyBundle({ directory: f.outputDir }), /readiness mismatch/u);
});

test('approved draft transport is idempotent and never overwrites mismatched bytes or creates tags', async t => {
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
  await assert.rejects(publishApprovedDraft(request, mock.api), /conflicts/u);
  assert.equal(mock.calls.filter(call => call.method === 'POST').length, mutations);
});

test('approved draft transport rejects private repos, wrong tag commits, unexpected assets and public releases', async t => {
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
  await assert.rejects(publishApprovedDraft(request, mock.api), /matching draft/u);
});

test('anonymous public acceptance compares saved hashes before extraction or native execution', async t => {
  const f = await fixture(t);
  await sealBundle(f);
  const bundle = await verifyBundle({ directory: f.outputDir });
  const requests = [];
  const fetcher = async (url, options) => {
    assert.equal(options, undefined, 'Anonymous asset downloads never send authentication options');
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
    async () => new Response('', { status: 404 })), /unavailable/u);
});

test('stable public Homebrew acceptance installs, tests and uninstalls the exact downloaded formula',
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
  const calls = [];
  const tap = `local/sdlc-acceptance-${formula.sha256.slice(0, 12)}`;
  const tapRepository = path.join(f.directory, 'tap');
  const result = await acceptPublicHomebrew({ bundle, downloaded, brew,
    run: async (command, args) => {
      assert.equal(command, brew);
      calls.push(args);
      return { stdout: args[0] === '--repository' ? `${tapRepository}\n` : '', stderr: '' };
    } });
  assert.equal(result.status, 'Passed');
  assert.deepEqual(calls, [
    ['tap-new', tap],
    ['--repository', tap],
    ['install', `${tap}/ai-sdlc-framework`],
    ['test', `${tap}/ai-sdlc-framework`],
    ['uninstall', '--formula', `${tap}/ai-sdlc-framework`],
    ['untap', tap],
  ]);
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

test('release workflow statically separates validation, sealing, opt-in publication and live acceptance', async () => {
  const ci = await fs.readFile('.github/workflows/ci.yml', 'utf8');
  const workflow = await fs.readFile('.github/workflows/release.yml', 'utf8');
  assert.doesNotMatch(ci, /publish-npm|publish-release|--clobber|gh release/u);
  assert.match(workflow, /target: macos-arm64\s+runner: macos-15/u);
  assert.match(workflow, /target: windows-x64\s+runner: ubuntu-24\.04/u);
  assert.match(workflow, /target: macos-x64\s+runner: macos-15/u);
  assert.match(workflow, /needs: \[candidate, release-gates\]/u);
  assert.match(workflow, /HOMEBREW_BREW_COMMIT: 99fd9a8eed4ff942c448da0c1f11156302441e4a/u);
  assert.match(workflow, /git -C "\$root" fetch --quiet --depth=1 origin "\$HOMEBREW_BREW_COMMIT"/u);
  assert.match(workflow, /SDLC_HOMEBREW_BREW=\$brew/u);
  assert.match(workflow, /"\$brew" install node@22/u);
  assert.doesNotMatch(workflow, /RELEASE_HOMEBREW_(?:INTEL_)?BREW/u);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch' && inputs\.publish_draft/u);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch' && inputs\.publish_npm/u);
  assert.doesNotMatch(workflow, /windows-latest|--clobber|--draft=false|mktemp|linux-x64/u);
  const acceptance = await fs.readFile('.github/workflows/release-acceptance.yml', 'utf8');
  assert.match(acceptance, /artifact-ids: \$\{\{ inputs\.bundle_artifact_id \}\}/u);
  assert.match(acceptance, /EXPECTED_BUNDLE_SHA256/u);
  assert.match(acceptance, /ACCEPTANCE_VERIFIER_COMMIT: \$\{\{ github\.sha \}\}/u);
  assert.doesNotMatch(acceptance, /ref: \$\{\{ inputs\.source_commit \}\}/u);
});
