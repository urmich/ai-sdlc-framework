import * as fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonical, readTarGzip, readZip, sha256, tarGzip } from '../packaging/standalone/archive.mjs';
import { ARCHIVE_TARGETS, EXECUTION_PLATFORMS, archiveTarget, isPrerelease, TARGETS } from '../packaging/standalone/protocol.mjs';
import { buildLauncher } from '../packaging/winget/build-launcher.mjs';
import { generateManifests } from '../packaging/winget/generate.mjs';
import { validateManifests } from '../packaging/winget/validate.mjs';
import { generateWindowsTesterPrompt, INPUT_FILENAME, TESTER_TEMPLATE_SHA256, validateWindowsTesterInput,
  validateWindowsTesterPrompt } from '../packaging/windows-tester/generate.mjs';
import { buildPackage } from './package.mjs';
import { buildPlatforms, writeReleaseMetadata } from './package-platforms.mjs';
import { verifyRelease } from './verify-platform-package.mjs';
import { collectReleaseAttemptHistory, requireCurrentReleaseGates } from './release-history.mjs';
import { homebrewToolchain } from './toolchain-baseline.mjs';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const MACOS_ARCHITECTURES = Object.freeze(['arm64', 'x64']);
export const RELEASE_TARGETS = ARCHIVE_TARGETS;
export const RELEASE_EXECUTION_PLATFORMS = EXECUTION_PLATFORMS;
export const RELEASE_GATE_TARGETS = EXECUTION_PLATFORMS;
export const RELEASE_SCOPE = Object.freeze({
  'linux-x64': { required: true, validation: 'native-full-regression', publish: false },
  'windows-x64': { required: true, validation: 'native-full-regression', publish: true },
  'macos-arm64': { required: true, validation: 'native-full-regression', publish: true, homebrew: true },
  'macos-x64': { required: true, validation: 'native-full-regression', publish: true, homebrew: true },
});
export const RELEASE_PRE_CASES = Object.freeze({
  'linux-x64': 'T-PRD079-LX', 'windows-x64': 'T-PRD079-WX',
  'macos-arm64': 'T-PRD079-MA', 'macos-x64': 'T-PRD079-MI',
});

export function releaseIntent(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/u.test(value)) {
    throw new Error('An explicit stable release intent ID is required');
  }
  return value;
}

export function releaseRepository(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_][A-Za-z0-9_.-]*$/u.test(value)) {
    throw new Error('An explicitly approved public release repository (owner/repository) is required');
  }
  return value;
}

export async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, canonical(value), { flag: 'wx' });
}

export async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

export async function emptyDirectory(directory) {
  await fs.mkdir(directory, { recursive: true });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (await fs.readdir(directory)).length) {
    throw new Error(`A new, empty literal directory is required: ${directory}`);
  }
}

export function evidenceIdentity(release) {
  return { sourceCommit: release.descriptor.sourceCommit, version: release.descriptor.version,
    payloadSha256: release.descriptor.payload.sha256, descriptorSha256: release.descriptorSha256,
    checksumsSha256: release.checksumsSha256 };
}

export function archiveRecord(release, target) {
  const resolved = archiveTarget(target);
  const filename = `ai-sdlc-framework-${release.descriptor.version}-${resolved}.${TARGETS[resolved].extension}`;
  const record = release.descriptor.files.find(file => file.filename === filename && file.kind === 'archive');
  if (resolved === 'macos' && record && release.descriptor.files.some(file =>
    file.kind === 'archive' && /^ai-sdlc-framework-.*-macos-(?:arm64|x64)\.tar\.gz$/u.test(file.filename))) {
    throw new Error('Shared Mac release cannot include stale CPU archives');
  }
  if (record) return record;
  // Old immutable bundles keep their original per-CPU identity.
  if (target.startsWith('macos-') && !release.descriptor.files.some(file =>
    /^ai-sdlc-framework-.*-macos\.tar\.gz$/u.test(file.filename))) {
    const legacy = `ai-sdlc-framework-${release.descriptor.version}-${target}.${TARGETS[target].extension}`;
    const found = release.descriptor.files.find(file => file.filename === legacy && file.kind === 'archive');
    if (found) return found;
  }
  throw new Error(`Missing release archive: ${target}`);
}

export function windowsTesterInput(release, repository, launcherSha256) {
  return { identity: evidenceIdentity(release), releaseRepository: releaseRepository(repository),
    inventoryDigest: release.descriptor.payload.inventoryDigest, launcherSha256, templateSha256: TESTER_TEMPLATE_SHA256,
    archive: archiveRecord(release, 'windows-x64') };
}

export async function verifyCandidate(directory, { allowGeneratedPrompt = false, ...expected } = {}) {
  const release = await verifyRelease({ outputDir: path.join(directory, 'assets'),
    targets: RELEASE_TARGETS, rebuild: false });
  const context = await readJson(path.join(directory, 'context.json'));
  releaseRepository(context.releaseRepository);
  const selectedPrevious = previousReleasePins(process.env, context.releaseRepository);
  if (selectedPrevious && canonical(context.previousRelease) !== canonical(selectedPrevious)) {
    throw new Error('Frozen supported-previous release differs from the independently selected current configuration');
  }
  if (canonical(context.identity) !== canonical(evidenceIdentity(release)) ||
      canonical(context.scope) !== canonical(RELEASE_SCOPE) ||
      context.prerelease !== isPrerelease(release.descriptor.version)) throw new Error('Candidate identity or release scope mismatch');
  const formulas = release.descriptor.files.filter(file => file.kind === 'homebrew');
  if (formulas.length > 1 || formulas.some(file => file.filename !== 'ai-sdlc-framework.rb')) {
    throw new Error('Homebrew metadata must contain only the dual-architecture formula');
  }
  if (!context.prerelease && context.homebrew?.status === 'Generated' && formulas.length !== 1) {
    throw new Error('Generated stable Homebrew metadata is missing from the candidate');
  }
  for (const file of formulas) {
    validateInitialHomebrewFormula({ descriptor: release.descriptor, repository: context.releaseRepository,
      contents: await fs.readFile(path.join(directory, 'assets', file.filename), 'utf8') });
  }
  for (const [key, value] of Object.entries(expected)) {
    if (value && context.identity[key] !== value) throw new Error(`Candidate ${key} differs from trusted evidence`);
  }
  const windows = archiveRecord(release, 'windows-x64');
  const platform = JSON.parse(readZip(await fs.readFile(path.join(directory, 'assets', windows.filename)))
    .find(entry => entry.path === 'platform.json').data);
  if (context.launcher?.sha256 !== platform.launcherSha256) throw new Error('Candidate launcher digest does not match the verified Windows archive');
  const testerInput = windowsTesterInput(release, context.releaseRepository, platform.launcherSha256);
  validateWindowsTesterInput(testerInput);
  if (await fs.readFile(path.join(directory, INPUT_FILENAME), 'utf8') !== canonical(testerInput)) {
    throw new Error('T-60 input is not bound to the final candidate and launcher');
  }
  if (!allowGeneratedPrompt && await fs.lstat(path.join(directory, 'handoff')).then(() => true, error => {
    if (error.code !== 'ENOENT') throw error;
    return false;
  })) throw new Error('T-60 prompt generation is deferred until mandatory native validation completes');
  return { ...release, context, testerInput };
}

export function validateInitialHomebrewFormula({ descriptor, repository, contents, mode = 'stable', candidateBaseUrl }) {
  if (!['stable', 'candidate'].includes(mode)) throw new Error('Unknown Homebrew metadata mode');
  let base = `https://github.com/${releaseRepository(repository)}/releases/download/v${descriptor.version}/`;
  if (mode === 'candidate') {
    const url = new URL(candidateBaseUrl);
    if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) ||
        !url.port || url.username || url.password || url.search || url.hash ||
        !/^\/[a-zA-Z0-9/_-]*$/u.test(url.pathname) || !url.pathname.endsWith('/')) {
      throw new Error('Test-only Homebrew metadata requires an explicit loopback base URL');
    }
    base = url.href;
  } else if (isPrerelease(descriptor.version) || candidateBaseUrl !== undefined) {
    throw new Error('Stable Homebrew metadata cannot use prereleases or candidate URLs');
  }
  const records = MACOS_ARCHITECTURES.map(arch => {
    const archive = archiveRecord({ descriptor }, `macos-${arch}`);
    return { arch, ...archive, url: `${base}${archive.filename}` };
  });
  const shared = records[0].filename === records[1].filename;
  if (shared && descriptor.files.some(file => /^ai-sdlc-framework-.*-macos-(?:arm64|x64)\.tar\.gz$/u.test(file.filename))) {
    throw new Error('Homebrew shared archive contract cannot include stale per-CPU archives');
  }
  // Validate the generator's bounded source DSL as data; never execute Ruby, brew, or a target launcher.
  const expectedSources = ['on_macos do', ...records.flatMap(record => [
    `${record.arch === 'arm64' ? 'on_arm' : 'on_intel'} do`, `url "${record.url}"`,
    ...(mode === 'candidate' ? [`version "${descriptor.version}" if version.to_s != "${descriptor.version}"`] : []),
    `sha256 "${record.sha256}"`, 'end',
  ]), 'end'].join('\n');
  const sources = [...contents.matchAll(/^  on_macos do\n[\s\S]*?^  end[ \t]*$/gmu)];
  if (!shared && (sources.length !== 1 || sources[0][0].split('\n').map(line => line.trim()).join('\n') !== expectedSources ||
      [...contents.matchAll(/^\s*(?:on_arm|on_intel) do\s*$/gmu)].length !== 2 ||
      /^\s*depends_on\s+arch:/mu.test(contents) || /\bon_linux\b/u.test(contents))) {
    throw new Error('Homebrew architecture stanzas must bind each arm64/x64 URL and checksum to its matching architecture');
  }
  if (shared && (sources.length || /^\s*(?:on_arm|on_intel|on_linux|on_macos)\b/mu.test(contents) ||
      /^\s*depends_on\s+arch:/mu.test(contents) ||
      !contents.includes(`\n  url "${records[0].url}"\n`) ||
      !contents.includes(`\n  sha256 "${records[0].sha256}"\n`))) {
    throw new Error('Homebrew shared archive contract requires one unconditional Mac URL and checksum');
  }
  const actualUrls = [...contents.matchAll(/^\s*url "([^"]+)"[ \t]*$/gmu)].map(match => match[1]);
  const digests = [...contents.matchAll(/^\s*sha256 "([a-f0-9]{64})"[ \t]*$/gmu)].map(match => match[1]);
  const dependencies = [...contents.matchAll(/^[ \t]*depends_on[^\n]*$/gmu)].map(match => match[0]);
  const sourceRecords = shared ? records.slice(0, 1) : records;
  if (canonical(actualUrls) !== canonical(sourceRecords.map(record => record.url)) ||
      canonical(digests) !== canonical(sourceRecords.map(record => record.sha256)) ||
      canonical(dependencies) !== canonical(['  depends_on :macos', `  depends_on "${homebrewToolchain.formula}"`]) ||
      (mode === 'candidate' && !contents.startsWith('# Test-only local candidate; never publish to the stable tap.\n'))) {
    throw new Error('Homebrew formula URL/checksum/architecture or Node dependency contract mismatch');
  }
  return { validation: 'Passed', mode, architectures: records, nativeValidation: 'NotRun',
    nodeDependency: { validation: 'Passed', formula: homebrewToolchain.formula, major: homebrewToolchain.major,
      scope: 'runtime', conditional: false } };
}

export function validateHomebrewQualityEvidence(quality, { identity, targetArch, formula, mode }) {
  const expectedDependency = { validation: 'Passed', formula: homebrewToolchain.formula,
    major: homebrewToolchain.major, scope: 'runtime', conditional: false };
  const expectedAudit = ['audit', '--strict', '--formula', '--os=macos', `--arch=${targetArch === 'x64' ? 'intel' : 'arm'}`];
  if (!quality || quality.validation !== 'Passed' || quality.tool !== 'Homebrew' ||
      typeof quality.brewVersion !== 'string' || !quality.brewVersion.trim() ||
      quality.targetArch !== targetArch || quality.mode !== mode || quality.nativeExecution !== 'NotRun' ||
      canonical(quality.identity) !== canonical(identity) || canonical(quality.formula) !== canonical(formula) ||
      canonical(quality.nodeDependency) !== canonical(expectedDependency) ||
      quality.style?.status !== 'Passed' || quality.style?.exitCode !== 0 ||
      quality.audit?.status !== 'Passed' || quality.audit?.exitCode !== 0 ||
      quality.style?.args?.length !== 2 || quality.style.args[0] !== 'style' ||
      !quality.style.args[1].endsWith('/Formula/ai-sdlc-framework.rb') ||
      quality.audit?.args?.length !== 6 || canonical(quality.audit.args.slice(0, 5)) !== canonical(expectedAudit) ||
      !/^local\/sdlc-quality-[a-f0-9]+\/ai-sdlc-framework$/u.test(quality.audit.args[5])) {
    throw new Error('Missing or invalid candidate-bound Homebrew audit/style/Node dependency evidence');
  }
  for (const stage of ['style', 'audit']) {
    if (!quality.commands?.some(record => record.command === quality.brew &&
        record.exitCode === 0 && canonical(record.args) === canonical(quality[stage].args))) {
      throw new Error('Homebrew audit/style requires successful actual command evidence');
    }
  }
}

export async function homebrewMetadata({ descriptor, artifactDirectory, outputDir, repository, generator,
  mode = 'stable', candidateBaseUrl }) {
  const modulePath = path.join(ROOT, 'packaging/homebrew/generate-formula.mjs');
  if (!generator) {
    const present = await fs.stat(modulePath).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (!present) return { status: 'NotIntegrated', files: [], nativeValidation: 'NotRun' };
    generator = (await import(pathToFileURL(modulePath).href)).generateHomebrewFormula;
  }
  if (typeof generator !== 'function') throw new Error('Homebrew module must export generateHomebrewFormula');
  const formula = await generator({ descriptor, artifactDirectory, mode, architectures: [...MACOS_ARCHITECTURES],
    ...(candidateBaseUrl ? { candidateBaseUrl } : {}) });
  if (formula.filename !== 'ai-sdlc-framework.rb' || formula.kind !== 'homebrew' ||
      formula.mode !== mode || typeof formula.contents !== 'string' ||
      formula.sha256 !== sha256(Buffer.from(formula.contents)) || formula.size !== Buffer.byteLength(formula.contents)) {
    throw new Error('generateHomebrewFormula returned an invalid formula record');
  }
  const validation = validateInitialHomebrewFormula({ descriptor, repository, contents: formula.contents, mode, candidateBaseUrl });
  await emptyDirectory(outputDir);
  const artifact = path.join(outputDir, formula.filename);
  await fs.writeFile(artifact, formula.contents, { flag: 'wx' });
  const { contents, mode: generatedMode, ...record } = formula;
  return { status: 'Generated', nativeValidation: 'NotRun', validation, files: [{ ...record, artifact }] };
}

export function previousReleasePins(environment, repository, { required = false } = {}) {
  const values = [environment.SUPPORTED_PREVIOUS_VERSION, environment.SUPPORTED_PREVIOUS_DESCRIPTOR_SHA256,
    environment.SUPPORTED_PREVIOUS_CHECKSUMS_SHA256];
  if (!values.some(Boolean) && !required) return undefined;
  if (!/^\d+\.\d+\.\d+$/u.test(values[0] ?? '') || !values.slice(1).every(value => /^[a-f0-9]{64}$/u.test(value ?? ''))) {
    throw Object.assign(new Error('Independently pinned authentic supported-previous public release inputs are required'),
      { code: 'RELEASE_INTEGRATION_BLOCKED' });
  }
  return { version: values[0], descriptorSha256: values[1], checksumsSha256: values[2],
    repository: releaseRepository(environment.SUPPORTED_PREVIOUS_REPOSITORY ?? repository) };
}

export async function prepareRelease({ outputDir, repository, sourceCommit, environment = process.env,
  homebrewGenerator } = {}) {
  repository = releaseRepository(repository);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  sourceCommit ??= head;
  if (sourceCommit !== head || execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim()) {
    throw new Error('Release preparation requires the exact clean committed source revision');
  }
  const directory = path.resolve(outputDir);
  const previousRelease = previousReleasePins(environment, repository, { required: Boolean(environment.RELEASE_INTENT_ID) });
  await emptyDirectory(directory);
  const pkg = await readJson(path.join(ROOT, 'package.json'));
  if (environment.GITHUB_REF?.startsWith('refs/tags/') && environment.GITHUB_REF !== `refs/tags/v${pkg.version}`) {
    throw new Error('Release tag must equal v<package.json version>');
  }
  const npm = await buildPackage({ outputDir: path.join(directory, 'npm'), environment });
  const launcher = await buildLauncher({ outputDir: path.join(directory, 'launcher'), environment });
  const assets = path.join(directory, 'assets');
  const initial = await buildPlatforms({ artifact: npm.artifact, outputDir: assets,
    windowsLauncher: launcher.artifact, targets: RELEASE_TARGETS, sourceCommit, environment });
  // Generators only consume already-verified archive records. No generator takes a final descriptor digest.
  await verifyRelease({ outputDir: assets, windowsLauncher: launcher.artifact,
    targets: RELEASE_TARGETS, sourceCommit, environment });
  const prerelease = isPrerelease(pkg.version);
  const archive = archiveRecord(initial, 'windows-x64');
  const wingetInput = { version: pkg.version, releaseRepository: repository, archive,
    ...(prerelease ? { testOnly: true, candidateUrl: `http://127.0.0.1:8765/${archive.filename}` } : {}) };
  const wingetOptions = { ...wingetInput, archivePath: path.join(assets, archive.filename) };
  const manifests = await generateManifests({ ...wingetOptions, outputDir: path.join(directory, 'winget') });
  const winget = await validateManifests({ ...wingetOptions, manifestDir: path.join(directory, 'winget') });
  await writeJson(path.join(directory, 'winget-input.json'), wingetInput);
  const homebrewInput = { descriptor: initial.descriptor, artifactDirectory: 'assets',
    mode: prerelease ? 'candidate' : 'stable', architectures: [...MACOS_ARCHITECTURES] };
  await writeJson(path.join(directory, 'homebrew-input.json'), homebrewInput);
  const homebrew = prerelease ? { status: 'NotPublishedPrerelease', files: [] } :
    await homebrewMetadata({ descriptor: initial.descriptor, artifactDirectory: assets,
      outputDir: path.join(directory, 'homebrew'), repository, generator: homebrewGenerator });
  const metadataFiles = prerelease ? [] : [...manifests.files, ...homebrew.files];
  // Final ordering: exact npm -> archives -> managers -> descriptor -> SHA256SUMS. Freeze here.
  const final = await writeReleaseMetadata({ outputDir: assets, artifact: npm.artifact,
    sourceCommit, targets: RELEASE_TARGETS, metadataFiles });
  await verifyRelease({ outputDir: assets, windowsLauncher: launcher.artifact,
    targets: RELEASE_TARGETS, sourceCommit, environment });
  const testerInput = windowsTesterInput(final, repository, launcher.sha256);
  validateWindowsTesterInput(testerInput);
  await writeJson(path.join(directory, INPUT_FILENAME), testerInput);
  const context = { schemaVersion: 1, releaseRepository: repository, identity: evidenceIdentity(final),
    ...(previousRelease ? { previousRelease } : {}),
    ...(environment.RELEASE_INTENT_ID ? { releaseIntentId: releaseIntent(environment.RELEASE_INTENT_ID) } : {}),
    scope: RELEASE_SCOPE, prerelease, launcher: { sha256: launcher.sha256, toolchain: launcher.toolchain },
    winget, homebrew: { status: homebrew.status, nativeValidation: 'NotRun', supportedArchitectures: [...MACOS_ARCHITECTURES] },
    windowsTesterPrompt: { generationStatus: 'DeferredUntilRequiredValidation',
      contentStatus: 'PendingIntegration', nativeExecution: 'NotRun' },
    publicAssets: 'NotRun', npmPublication: 'NotRun', communityAcceptance: 'NotRun' };
  await writeJson(path.join(directory, 'context.json'), context);
  return { ...context.identity, version: pkg.version, candidateDir: directory };
}

export function validateGates(gates, identity, { releaseIntentId, now = Date.now() } = {}) {
  if (!Array.isArray(gates) || gates.length !== RELEASE_GATE_TARGETS.length) throw new Error('Unexpected or missing release gate');
  for (const target of RELEASE_GATE_TARGETS) {
    const gate = gates.find(item => item.target === target);
    if (!gate || gates.filter(item => item.target === target).length !== 1 ||
        canonical(gate.identity) !== canonical(identity) ||
        gate.required !== RELEASE_SCOPE[target].required ||
        gate.validation !== RELEASE_SCOPE[target].validation) throw new Error(`Missing or stale gate: ${target}`);
    if (gate.required && gate.status !== 'Passed') throw new Error(`Required gate did not pass: ${target}`);
    const [platform, arch] = target.split('-');
    if (gate.profile !== 'r-pre' || gate.caseId !== RELEASE_PRE_CASES[target] ||
        gate.nativeValidation !== 'Passed' || gate.host?.kind !== 'native' ||
        gate.host.platform !== ({ linux: 'linux', windows: 'win32', macos: 'darwin' })[platform] ||
        gate.host.architecture !== arch || gate.reportDirectory !== `native/${target}` ||
        !/^[1-9]\d*$/u.test(gate.run?.id ?? '') || !/^[1-9]\d*$/u.test(gate.run?.attempt ?? '') ||
        !Number.isFinite(Date.parse(gate.finishedAt)) || Date.parse(gate.finishedAt) > now ||
        now - Date.parse(gate.finishedAt) > 24 * 60 * 60 * 1000 ||
        (releaseIntentId && gate.releaseIntentId !== releaseIntentId)) {
      throw new Error(`Missing fresh native R-PRE ${target} execution; PR, metadata and later acceptance are not substitutes`);
    }
  }
}

export function windowsTesterReadiness(candidate, gates, { now = Date.now() } = {}) {
  validateGates(gates, candidate.context.identity, { releaseIntentId: candidate.context.releaseIntentId, now });
  if (!candidate.context.prerelease && candidate.context.homebrew?.status !== 'Generated') {
    throw new Error('Stable Homebrew implementation and metadata must be integrated before T-60 generation');
  }
  return { installerImplementation: 'Complete', nativeMacosArm64: 'Passed', nativeHomebrew: 'Passed',
    identity: candidate.context.identity };
}

export function requirePublicationReady(bundle) {
  if (bundle.publicationReady !== true) {
    throw new Error('Publication blocked: T-60 content completeness remains PendingIntegration/NotRun');
  }
}

async function inventoryTree(directory, prefix = '') {
  const stat = await fs.lstat(path.join(directory, prefix));
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Bundle root must be a literal directory');
  const files = [];
  for (const entry of await fs.readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const nested = await inventoryTree(directory, relative);
      if (!nested.length) throw new Error('Bundle cannot contain unlisted empty directories');
      files.push(...nested);
    }

    else if (entry.isFile()) {
      const bytes = await fs.readFile(path.join(directory, relative));
      files.push({ filename: relative, sha256: sha256(bytes), size: bytes.length });
    } else throw new Error('Bundle must contain only literal directories and regular files');
  }
  return files.sort((a, b) => a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0);
}

export async function copyNativeReports(source, destination) {
  await emptyDirectory(destination);
  const copy = async (from, to) => {
    const stat = await fs.lstat(from);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Native evidence must contain regular original report files');
    await fs.copyFile(from, to, fs.constants.COPYFILE_EXCL);
  };
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    if (/\.(?:json|jsonl|ndjson|md|log|txt)$/u.test(entry.name)) {
      await copy(path.join(source, entry.name), path.join(destination, entry.name));
    } else if (/^tools-[a-f0-9-]+$/u.test(entry.name)) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('Original tool reports require literal directories');
      const names = (await fs.readdir(path.join(source, entry.name))).filter(name => /\.(?:json|jsonl|ndjson|md|log|txt)$/u.test(name));
      if (!names.length) continue;
      await fs.mkdir(path.join(destination, entry.name));
      for (const name of names) await copy(path.join(source, entry.name, name), path.join(destination, entry.name, name));
    }
  }
}

export async function selectGateFiles(evidenceDir, runId) {
  const names = (await fs.readdir(evidenceDir)).sort();
  if (!runId) {
    if (RELEASE_GATE_TARGETS.some(target => !names.includes(`${target}.json`)) ||
        names.some(name => name !== 'native' && !RELEASE_GATE_TARGETS.some(target => name === `${target}.json`))) {
      throw new Error('A result from every scoped mandatory gate is required');
    }
    return names.filter(name => name !== 'native').map(name => path.join(evidenceDir, name));
  }
  if (!/^[1-9][0-9]*$/u.test(runId)) throw new Error('Expected a numeric GitHub run ID');
  const latest = new Map();
  for (const name of names) {
    const match = /^release-gate-(linux-x64|macos-arm64|macos-x64|windows-x64)-([0-9]+)-([1-9][0-9]*)$/u.exec(name);
    if (!match || match[2] !== runId) throw new Error('Unexpected gate artifact name or run');
    const [, target, , attempt] = match;
    const file = path.join(evidenceDir, name, `${target}.json`);
    const record = await readJson(file);
    if (record.run?.id !== runId || record.run?.attempt !== attempt) throw new Error('Gate artifact origin mismatch');
    if (!latest.has(target) || Number(attempt) > latest.get(target).attempt) {
      latest.set(target, { file, attempt: Number(attempt) });
    }
  }
  if (RELEASE_GATE_TARGETS.some(target => !latest.has(target))) throw new Error('A result from every scoped mandatory gate is required');
  return RELEASE_GATE_TARGETS.filter(target => latest.has(target)).map(target => latest.get(target).file);
}

async function nativeVerifier() {
  return (await import('./native-validation.mjs')).verifyNativeEvidence;
}

async function verifyNativeProducer(gate, sourceCommit, api, sourceRepository) {
  api ??= (await import('./publish-release.mjs')).githubRequest;
  const prefix = `/repos/${releaseRepository(sourceRepository ?? process.env.GITHUB_REPOSITORY)}`;
  const read = async route => {
    const response = await api(`${prefix}${route}`);
    if (response.status === 404) throw new Error('Original native producer is no longer available for independent verification');
    return response.value;
  };
  const run = await read(`/actions/runs/${gate.run.id}/attempts/${gate.run.attempt}`);
  if (run.head_sha !== sourceCommit || run.event !== 'workflow_dispatch' ||
      run.path !== '.github/workflows/release.yml') throw new Error('Native R-PRE belongs to an unexpected producer/source/profile');
  const jobs = [];
  for (let page = 1; ; page++) {
    const result = await read(`/actions/runs/${gate.run.id}/attempts/${gate.run.attempt}/jobs?per_page=100&page=${page}`);
    jobs.push(...result.jobs);
    if (jobs.length >= result.total_count) break;
    if (!result.jobs.length) throw new Error('Incomplete native job pagination');
  }
  const matching = jobs.filter(job => job.name === `native-${gate.target}`);
  const preflight = jobs.filter(job => job.name === 'preflight');
  const runner = { 'linux-x64': 'ubuntu-24.04', 'windows-x64': 'windows-2022',
    'macos-arm64': 'macos-15', 'macos-x64': 'macos-15-intel' }[gate.target];
  if (preflight.length !== 1 || preflight[0].conclusion !== 'success' ||
      !preflight[0].steps?.some(step => step.name === 'Verify publishing toolchain availability and integrity before any tag or asset effect' &&
        step.conclusion === 'success') ||
      matching.length !== 1 || matching[0].conclusion !== 'success' || !matching[0].labels?.includes(runner) ||
      !matching[0].steps?.some(step => step.name === 'Fresh complete native R-PRE inventory against the frozen unpublished bytes' &&
        step.conclusion === 'success')) throw new Error(`Native R-PRE producer/job/required-step mismatch: ${gate.target}`);
  return { schemaVersion: 1, kind: 'release-native-producer-facts', target: gate.target,
    run, job: matching[0], preflight: preflight[0] };
}

async function verifyGateExecutions({ candidateDir, candidate, gateFiles, gates,
  verifyEvidence, expectedRepositoryId = process.env.GITHUB_REPOSITORY_ID,
  expectedWorkflowRef = process.env.GITHUB_WORKFLOW_REF, api, sourceRepository, now = Date.now() }) {
  const trustedTestVerifier = verifyEvidence !== undefined;
  verifyEvidence ??= await nativeVerifier();
  if (typeof verifyEvidence !== 'function') throw new Error('Full native execution evidence verifier is not integrated');
  const { requireReadinessEvaluation } = await import('ai-sdlc-framework/evidence');
  const origins = [];
  const contexts = [];
  for (const [index, gate] of gates.entries()) {
    if (!trustedTestVerifier || api) origins.push(await verifyNativeProducer(gate, candidate.context.identity.sourceCommit, api, sourceRepository));
    const result = await verifyEvidence({ target: gate.target, profile: 'r-pre', candidateDir,
      evidenceDir: path.join(path.dirname(gateFiles[index]), ...gate.reportDirectory.split('/')),
      expectedSourceCommit: candidate.context.identity.sourceCommit,
      expectedRunId: gate.run.id, expectedAttempt: gate.run.attempt,
      releaseIntentId: candidate.context.releaseIntentId, expectedRepositoryId, expectedWorkflowRef,
      now: new Date(now).toISOString() });
    requireReadinessEvaluation(result.evaluation);
    if (result.historical === true || result.currentCredit === 'NotRun') {
      throw new Error('Historical/as-of verification cannot provide current publication readiness');
    }
    if (result.evaluation?.status !== 'Passed' ||
        canonical(result.context.native) !== canonical(gate.host) ||
        result.context.intentId !== gate.releaseIntentId) {
      throw new Error(`Complete underlying R-PRE execution did not pass: ${gate.target}`);
    }
    const original = await readJson(path.join(path.dirname(gateFiles[index]), ...gate.reportDirectory.split('/'), 'execution.json'));
    contexts.push({ target: gate.target, context: result.context,
      sourceTime: original.observedAt, sourceSequence: original.sequence });
  }
  if (!trustedTestVerifier || api) {
    const oldest = Math.min(...origins.map(origin => Date.parse(origin.run.created_at)));
    if (!Number.isFinite(oldest)) throw new Error('Original native producer timestamps are unavailable');
    const reader = api ?? (await import('./publish-release.mjs')).githubRequest;
    const history = await collectReleaseAttemptHistory({ api: reader,
      sourceRepository: sourceRepository ?? process.env.GITHUB_REPOSITORY,
      binding: { ...candidate.context.identity, releaseIntentId: candidate.context.releaseIntentId,
        releaseRepository: candidate.context.releaseRepository },
      notBefore: new Date(oldest).toISOString(), now: new Date(now).toISOString() });
    requireCurrentReleaseGates(history, gates);
    return { origins, history, contexts };
  }
  return { origins: [], history: null, contexts };
}

export async function sealBundle({ candidateDir, evidenceDir, outputDir, runId, verifyEvidence, api, sourceRepository, clock = Date.now,
  releaseIntentId = process.env.RELEASE_INTENT_ID, sourceCommit = process.env.EXPECTED_SOURCE_COMMIT }) {
  const candidate = await verifyCandidate(candidateDir, { sourceCommit });
  releaseIntent(candidate.context.releaseIntentId);
  if (releaseIntentId && candidate.context.releaseIntentId !== releaseIntentId) throw new Error('Release intent differs from frozen candidate');
  const gateFiles = await selectGateFiles(evidenceDir, runId);
  const gates = await Promise.all(gateFiles.map(readJson));
  validateGates(gates, candidate.context.identity, { now: clock() });
  await verifyGateExecutions({ candidateDir, candidate, gateFiles, gates, verifyEvidence, api, sourceRepository, now: clock() });
  const readiness = windowsTesterReadiness(candidate, gates, { now: clock() });
  await emptyDirectory(outputDir);
  await fs.cp(path.join(candidateDir, 'assets'), path.join(outputDir, 'assets'), { recursive: true });
  await fs.copyFile(path.join(candidateDir, INPUT_FILENAME), path.join(outputDir, INPUT_FILENAME));
  await fs.copyFile(path.join(candidateDir, 'context.json'), path.join(outputDir, 'context.json'));
  for (const [index, gate] of gates.entries()) {
    await writeJson(path.join(outputDir, 'evidence', `${gate.target}.json`), gate);
    const source = path.join(path.dirname(gateFiles[index]), ...gate.reportDirectory.split('/'));
    await copyNativeReports(source, path.join(outputDir, 'evidence', ...gate.reportDirectory.split('/')));
  }
  const testerPrompt = await generateWindowsTesterPrompt({ outputDir: path.join(outputDir, 'handoff'),
    ...candidate.testerInput, readiness });
  const files = await inventoryTree(outputDir);
  const bundle = { schemaVersion: 1, identity: candidate.context.identity,
    releaseIntentId: candidate.context.releaseIntentId ?? gates[0].releaseIntentId,
    releaseRepository: candidate.context.releaseRepository, scope: RELEASE_SCOPE, files,
    publicationReady: testerPrompt.completionValidation === 'Passed' };
  await writeJson(path.join(outputDir, 'bundle.json'), bundle);
  return { ...(await verifyBundle({ directory: outputDir, verifyEvidence, api, sourceRepository, clock })).identity,
    bundleSha256: sha256(Buffer.from(canonical(bundle))), publicationReady: bundle.publicationReady };
}

export async function verifyBundle({ directory, expectedBundleSha256, verifyEvidence, releaseIntentId,
  api, sourceRepository, clock = Date.now, ...expected }) {
  const bytes = await fs.readFile(path.join(directory, 'bundle.json'));
  if (expectedBundleSha256 && sha256(bytes) !== expectedBundleSha256) throw new Error('Immutable bundle digest mismatch');
  const bundle = JSON.parse(bytes);
  if (canonical(bundle) !== bytes.toString() || bundle.schemaVersion !== 1) throw new Error('Malformed bundle manifest');
  const actual = (await inventoryTree(directory)).filter(file => file.filename !== 'bundle.json');
  if (canonical(bundle.files) !== canonical(actual)) throw new Error('Immutable bundle files changed');
  const candidate = await verifyCandidate(directory, { ...expected, allowGeneratedPrompt: true });
  if (canonical(bundle.identity) !== canonical(candidate.context.identity) ||
      canonical(bundle.scope) !== canonical(RELEASE_SCOPE) ||
      bundle.releaseRepository !== candidate.context.releaseRepository ||
      bundle.releaseIntentId !== candidate.context.releaseIntentId) throw new Error('Bundle identity mismatch');
  releaseIntent(bundle.releaseIntentId);
  if (releaseIntentId && bundle.releaseIntentId !== releaseIntent(releaseIntentId)) throw new Error('Bundle belongs to a different logical release intent');
  const gateNames = await fs.readdir(path.join(directory, 'evidence'));
  if (gateNames.some(name => name !== 'native' && !RELEASE_GATE_TARGETS.some(target => name === `${target}.json`))) {
    throw new Error('Unexpected release evidence');
  }
  const gateFiles = gateNames.filter(name => name !== 'native').map(name => path.join(directory, 'evidence', name));
  const gates = await Promise.all(gateFiles.map(readJson));
  validateGates(gates, candidate.context.identity, { releaseIntentId: bundle.releaseIntentId, now: clock() });
  const producerVerification = await verifyGateExecutions({ candidateDir: directory, candidate, gateFiles, gates, verifyEvidence,
    api, sourceRepository, now: clock() });
  const readiness = windowsTesterReadiness(candidate, gates, { now: clock() });
  const testerPrompt = await validateWindowsTesterPrompt({ outputDir: path.join(directory, 'handoff'),
    ...candidate.testerInput, readiness });
  if (bundle.publicationReady !== (testerPrompt.completionValidation === 'Passed')) throw new Error('Bundle publication readiness mismatch');
  return { ...bundle, context: candidate.context, descriptor: candidate.descriptor, testerPrompt, producerVerification };
}

export async function prepublicationEvidence({ directory, outputDir, expectedBundleSha256,
  runId = process.env.GITHUB_RUN_ID, attempt = process.env.GITHUB_RUN_ATTEMPT,
  captureDefinition, sourceRepository = process.env.GITHUB_REPOSITORY, ...expected }) {
  const bundle = await verifyBundle({ directory, expectedBundleSha256, sourceRepository, ...expected });
  requirePublicationReady(bundle);
  const intent = releaseIntent(bundle.releaseIntentId);
  if (!/^[1-9]\d*$/u.test(runId ?? '') || !/^[1-9]\d*$/u.test(attempt ?? '')) throw new Error('Evidence assets require the actual physical run and attempt');
  await emptyDirectory(outputDir);
  const bundleSha256 = sha256(await fs.readFile(path.join(directory, 'bundle.json')));
  const readiness = { schemaVersion: 1, profile: 'r-pre', status: 'Passed',
    releaseIntentId: intent, identity: bundle.identity, bundleSha256,
    requiredCases: RELEASE_PRE_CASES, physicalAttempt: { runId, attempt },
    originalExecutions: await Promise.all(RELEASE_GATE_TARGETS.map(async target => {
      const gate = await readJson(path.join(directory, 'evidence', `${target}.json`));
      return { target, caseId: gate.caseId, run: gate.run, finishedAt: gate.finishedAt,
        executionSha256: sha256(await fs.readFile(path.join(directory, 'evidence', 'native', target, 'execution.json'))) };
    })) };
  await writeJson(path.join(outputDir, 'readiness.json'), readiness);
  const readinessBytes = await fs.readFile(path.join(outputDir, 'readiness.json'));
  const files = bundle.files.filter(file => !file.filename.startsWith('assets/'));
  const entries = await Promise.all(files.map(async file => ({ path: file.filename, mode: 0o644,
    data: await fs.readFile(path.join(directory, ...file.filename.split('/'))) })));
  entries.push({ path: 'bundle.json', mode: 0o644, data: await fs.readFile(path.join(directory, 'bundle.json')) },
    { path: 'readiness.json', mode: 0o644, data: readinessBytes });
  const { captureReleaseReplayInputs } = await import('./release-retention.mjs');
  const replay = await captureReleaseReplayInputs({ bundle, directory, captureDefinition, sourceRepository });
  entries.push(...replay.entries);
  const bytes = tarGzip(entries);
  const filename = `release-prepublication-${intent}-${runId}-${attempt}-${sha256(bytes)}.tar.gz`;
  await fs.writeFile(path.join(outputDir, filename), bytes, { flag: 'wx' });
  return { bundleSha256, readinessSha256: sha256(readinessBytes),
    evidenceSha256: sha256(bytes), evidenceFilename: filename, publicationReady: true };
}

export async function reuseBundle({ directory, evidenceDir, runId, bundleArtifactId,
  evidenceArtifactId, expectedBundleSha256, api, sourceRepository = process.env.GITHUB_REPOSITORY,
  verifyAttestation, clock = Date.now, ...expected }) {
  if (![runId, bundleArtifactId, evidenceArtifactId].every(value => /^[1-9]\d*$/u.test(value ?? ''))) {
    throw new Error('Release retry requires original exact run and artifact IDs');
  }

  api ??= (await import('./publish-release.mjs')).githubRequest;
  const bundle = await verifyBundle({ directory, expectedBundleSha256, api, sourceRepository, clock, ...expected });
  requirePublicationReady(bundle);
  const artifacts = [];
  for (const artifactId of [bundleArtifactId, evidenceArtifactId]) {
    const response = await api(`/repos/${releaseRepository(sourceRepository)}/actions/artifacts/${artifactId}`);
    const artifact = response.value;
    if (!artifact || artifact.expired || String(artifact.id) !== artifactId ||
        String(artifact.workflow_run?.id) !== runId || artifact.workflow_run.head_sha !== bundle.identity.sourceCommit ||
        !/^sha256:[a-f0-9]{64}$/u.test(artifact.digest ?? '')) {
      throw new Error('Saved artifact origin/digest expired or differs from the immutable release source');
    }
    const rolePrefix = artifactId === bundleArtifactId ?
      `release-bundle-${bundle.identity.version}-${runId}-` : `release-prepublication-${runId}-`;
    const physicalAttempt = artifact.name?.startsWith(rolePrefix) ? artifact.name.slice(rolePrefix.length) : '';
    if (!/^[1-9]\d*$/u.test(physicalAttempt)) throw new Error('Saved immutable artifact has an unexpected release producer role');
    artifacts.push({ ...artifact, physicalAttempt });
  }
  const readinessBytes = await fs.readFile(path.join(evidenceDir, 'readiness.json'));
  const readiness = JSON.parse(readinessBytes);
  const originalExecutions = await Promise.all(RELEASE_GATE_TARGETS.map(async target => {
    const gate = await readJson(path.join(directory, 'evidence', `${target}.json`));
    return { target, caseId: gate.caseId, run: gate.run, finishedAt: gate.finishedAt,
      executionSha256: sha256(await fs.readFile(path.join(directory, 'evidence', 'native', target, 'execution.json'))) };
  }));
  if (readiness.bundleSha256 !== expectedBundleSha256 || readiness.releaseIntentId !== bundle.releaseIntentId ||
      readiness.status !== 'Passed' || readiness.profile !== 'r-pre' ||
      readiness.physicalAttempt?.runId !== runId ||
      readiness.physicalAttempt?.attempt !== artifacts[1].physicalAttempt ||
      canonical(readiness.originalExecutions) !== canonical(originalExecutions) ||
      readiness.originalExecutions.some(record => record.run.id !== runId ||
        clock() - Date.parse(record.finishedAt) > 24 * 60 * 60 * 1000)) {
    throw new Error('Only the same intent and unchanged source/spec/config/artifacts/native producer may reuse original R-PRE within 24 hours');
  }
  const files = await fs.readdir(evidenceDir);
  const names = files.filter(name => /^release-prepublication-[A-Za-z0-9_-]+-[a-f0-9]{64}\.tar\.gz$/u.test(name));
  const { releaseEvidenceName } = await import('./release-retention.mjs');
  if (names.length !== 1 || files.some(name => {
    if (name === 'readiness.json' || name === names[0]) return false;
    return !/^release-(?:attestation|trust)-/u.test(name) || !releaseEvidenceName(name);
  })) {
    throw new Error('Saved evidence selection is incomplete or ambiguous');
  }
  const bytes = await fs.readFile(path.join(evidenceDir, names[0]));
  const evidenceSha256 = sha256(bytes);
  if (!names[0].endsWith(`-${evidenceSha256}.tar.gz`)) throw new Error('Saved evidence archive digest differs');
  const archived = readTarGzip(bytes);
  if (!archived.find(file => file.path === 'readiness.json')?.data.equals(readinessBytes) ||
      sha256(archived.find(file => file.path === 'bundle.json')?.data ?? Buffer.alloc(0)) !== expectedBundleSha256) {
    throw new Error('Saved attested archive does not contain this exact acyclic readiness/bundle pair');
  }
  const verifyArgs = ['attestation', 'verify', path.join(evidenceDir, names[0]),
    '--repo', 'urmich/ai-sdlc-framework', '--signer-workflow', 'urmich/ai-sdlc-framework/.github/workflows/release.yml',
    '--signer-digest', bundle.identity.sourceCommit, '--source-digest', bundle.identity.sourceCommit,
    '--source-ref', 'refs/heads/main', '--deny-self-hosted-runners',
    '--predicate-type', 'https://slsa.dev/provenance/v1', '--format', 'json'];
  const trusts = files.filter(name => name.startsWith('release-trust-'));
  if (!trusts.length && files.some(name => name.startsWith('release-attestation-'))) {
    throw new Error('A retained signature lost its immutable subject/retrieval binding');
  }
  if (trusts.length) {
    if (trusts.length !== 1) throw new Error('Saved signed verification material is ambiguous');
    const trustBytes = await fs.readFile(path.join(evidenceDir, trusts[0]));
    if (!trusts[0].endsWith(`-${sha256(trustBytes)}.json`)) throw new Error('Saved trust record digest differs');
    const trust = JSON.parse(trustBytes);
    if (trust.subject?.filename !== names[0] || trust.subject.sha256 !== evidenceSha256 ||
        !files.includes(trust.attestation?.filename) || !releaseEvidenceName(trust.attestation.filename) ||
        trust.sourceCommit !== bundle.identity.sourceCommit) throw new Error('Saved signed trust graph is foreign or incomplete');
    const signed = await fs.readFile(path.join(evidenceDir, trust.attestation.filename));
    if (sha256(signed) !== trust.attestation.sha256 || signed.length !== trust.attestation.size) {
      throw new Error('Original signed attestation bytes changed');
    }
    verifyArgs.push('--bundle', path.join(evidenceDir, trust.attestation.filename));
  }
  const attestation = verifyAttestation ? await verifyAttestation({ artifact: path.join(evidenceDir, names[0]), args: verifyArgs,
    sha256: evidenceSha256, sourceCommit: bundle.identity.sourceCommit }) :
    JSON.parse(execFileSync('gh', verifyArgs,
      { cwd: ROOT, env: process.env, timeout: 120_000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
  if (!Array.isArray(attestation) || !attestation.some(row =>
    row.verificationResult?.statement?.subject?.some(subject => subject.digest?.sha256 === evidenceSha256) &&
    row.verificationResult?.verifiedTimestamps?.some(time => time.type === 'Tlog'))) {
    throw new Error('Saved evidence lacks exact-subject witnessed cryptographic verification');
  }
  return { bundleArtifactDigest: artifacts[0].digest, evidenceArtifactDigest: artifacts[1].digest,
    bundleSha256: expectedBundleSha256, readinessSha256: sha256(readinessBytes),
    evidenceFilename: names[0], evidenceSha256, publicationReady: true };
}

export async function resumeCandidate({ candidateDir, artifactId, runId, identity,
  releaseIntentId = process.env.RELEASE_INTENT_ID, sourceCommit = process.env.EXPECTED_SOURCE_COMMIT,
  api, sourceRepository = process.env.GITHUB_REPOSITORY, repository = process.env.RELEASE_REPOSITORY }) {
  if (![artifactId, runId].every(value => /^[1-9]\d*$/u.test(value ?? ''))) throw new Error('Candidate recovery requires exact saved run/artifact IDs');
  const pins = JSON.parse(identity);
  if (Object.keys(pins).sort().join(',') !== 'checksumsSha256,descriptorSha256' ||
      !Object.values(pins).every(value => /^[a-f0-9]{64}$/u.test(value ?? ''))) throw new Error('Saved candidate metadata pins are required');
  const candidate = await verifyCandidate(candidateDir, { sourceCommit, ...pins });
  if (candidate.context.releaseIntentId !== releaseIntent(releaseIntentId)) throw new Error('Saved candidate belongs to another logical release intent');
  if (repository && candidate.context.releaseRepository !== releaseRepository(repository)) throw new Error('Saved candidate destination differs from this immutable intent');
  api ??= (await import('./publish-release.mjs')).githubRequest;
  const response = await api(`/repos/${releaseRepository(sourceRepository)}/actions/artifacts/${artifactId}`);
  const artifact = response.value;
  if (!artifact || artifact.expired || String(artifact.id) !== artifactId ||
      String(artifact.workflow_run?.id) !== runId || artifact.workflow_run.head_sha !== sourceCommit) {
    throw new Error('Original frozen candidate is unavailable or has a different provider origin; never rebuild a replacement');
  }
  const match = new RegExp(`^release-candidate-${runId}-([1-9][0-9]*)$`, 'u').exec(artifact.name ?? '');
  if (!match) throw new Error('Saved candidate is not the original immutable release candidate artifact');
  const run = (await api(`/repos/${releaseRepository(sourceRepository)}/actions/runs/${runId}/attempts/${match[1]}`)).value;
  if (!run || run.head_sha !== sourceCommit || run.path !== '.github/workflows/release.yml' ||
      run.event !== 'workflow_dispatch') throw new Error('Saved candidate has a foreign original producer');
  const jobs = [];
  for (let page = 1; ; page++) {
    const result = (await api(`/repos/${releaseRepository(sourceRepository)}/actions/runs/${runId}/attempts/${match[1]}/jobs?per_page=100&page=${page}`)).value;
    if (!Array.isArray(result?.jobs)) throw new Error('Original candidate producer facts are unavailable');
    jobs.push(...result.jobs);
    if (jobs.length >= result.total_count) break;
    if (!result.jobs.length) throw new Error('Original candidate producer pagination is incomplete');
  }
  const original = jobs.filter(job => job.name === 'candidate');
  if (original.length !== 1 || original[0].conclusion !== 'success' ||
      !original[0].steps?.some(step => step.name === 'Freeze exact npm, shared Mac, Windows PE and manager metadata once' &&
        step.conclusion === 'success')) throw new Error('Original frozen candidate was not produced by the adopted successful freeze step');
  return candidate.context.identity;
}

export function options(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!/^--[a-z]+(?:-[a-z]+)*$/u.test(argv[index]) || !argv[index + 1] || argv[index + 1].startsWith('--')) {
      throw new Error('Release commands require --option value pairs');
    }
    const name = argv[index].slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
    if (name in result) throw new Error(`Duplicate option: ${name}`);
    result[name] = argv[index + 1];
  }
  return result;
}

export function trustedEnvironment() {
  return Object.fromEntries(Object.entries({ sourceCommit: process.env.EXPECTED_SOURCE_COMMIT,
    descriptorSha256: process.env.EXPECTED_DESCRIPTOR_SHA256,
    checksumsSha256: process.env.EXPECTED_CHECKSUMS_SHA256,
    expectedBundleSha256: process.env.EXPECTED_BUNDLE_SHA256,
    releaseIntentId: process.env.RELEASE_INTENT_ID }).filter(([, value]) => value));
}

async function main() {
  const commands = { prepare: prepareRelease, seal: sealBundle, verify: verifyBundle,
    evidence: prepublicationEvidence, reuse: reuseBundle, 'resume-candidate': resumeCandidate };
  const command = commands[process.argv[2]];
  if (!command) throw new Error('Expected prepare, seal or verify');
  const result = await command({ ...options(process.argv.slice(3)), ...trustedEnvironment() });
  if (process.env.GITHUB_OUTPUT) {
    for (const name of ['version', 'sourceCommit', 'payloadSha256', 'descriptorSha256', 'checksumsSha256', 'bundleSha256', 'publicationReady',
      'readinessSha256', 'evidenceSha256', 'evidenceFilename']) {
      if (result[name] !== undefined) await fs.appendFile(process.env.GITHUB_OUTPUT, `${name}=${result[name]}\n`);
    }
    for (const name of ['bundleArtifactDigest', 'evidenceArtifactDigest']) {
      if (result[name] !== undefined) await fs.appendFile(process.env.GITHUB_OUTPUT, `${name}=${result[name]}\n`);
    }
  }
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.stack ?? error.message); process.exitCode = 1; });
}
