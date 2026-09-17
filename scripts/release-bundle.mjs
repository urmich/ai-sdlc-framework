import * as fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonical, sha256 } from '../packaging/standalone/archive.mjs';
import { isPrerelease, TARGETS } from '../packaging/standalone/protocol.mjs';
import { buildLauncher } from '../packaging/winget/build-launcher.mjs';
import { generateManifests } from '../packaging/winget/generate.mjs';
import { validateManifests } from '../packaging/winget/validate.mjs';
import { generateWindowsTesterPrompt, validateWindowsTesterPrompt } from '../packaging/windows-tester/generate.mjs';
import { buildPackage } from './package.mjs';
import { buildPlatforms, writeReleaseMetadata } from './package-platforms.mjs';
import { verifyRelease } from './verify-platform-package.mjs';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const RELEASE_TARGETS = Object.freeze(['macos-arm64', 'windows-x64']);
export const RELEASE_GATE_TARGETS = Object.freeze(['macos-arm64', 'macos-x64', 'windows-x64']);
export const RELEASE_SCOPE = Object.freeze({
  'macos-arm64': { required: true, validation: 'native-lifecycle', publish: true },
  'windows-x64': { required: true, validation: 'cross-build-schema-payload-metadata', native: 'NotRun', publish: true },
  'macos-x64': { required: false, validation: 'NotRun', publish: false, supported: false, homebrew: false },
  'linux-x64': { required: false, validation: 'OutOfScope', publish: false },
});

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
  const filename = `ai-sdlc-framework-${release.descriptor.version}-${target}.${TARGETS[target].extension}`;
  const record = release.descriptor.files.find(file => file.filename === filename && file.kind === 'archive');
  if (!record) throw new Error(`Missing release archive: ${target}`);
  return record;
}

export function windowsTesterInput(release, repository) {
  return { identity: evidenceIdentity(release), releaseRepository: releaseRepository(repository),
    inventoryDigest: release.descriptor.payload.inventoryDigest, archive: archiveRecord(release, 'windows-x64') };
}

export async function verifyCandidate(directory, expected = {}) {
  const release = await verifyRelease({ outputDir: path.join(directory, 'assets'),
    targets: RELEASE_TARGETS, rebuild: false });
  const context = await readJson(path.join(directory, 'context.json'));
  releaseRepository(context.releaseRepository);
  if (canonical(context.identity) !== canonical(evidenceIdentity(release)) ||
      canonical(context.scope) !== canonical(RELEASE_SCOPE)) throw new Error('Candidate identity or release scope mismatch');
  const formulas = release.descriptor.files.filter(file => file.kind === 'homebrew');
  if (formulas.length > 1 || formulas.some(file => file.filename !== 'ai-sdlc-framework.rb')) {
    throw new Error('Initial Homebrew metadata must contain only the arm64 formula');
  }
  for (const file of formulas) {
    validateInitialHomebrewFormula({ descriptor: release.descriptor, repository: context.releaseRepository,
      contents: await fs.readFile(path.join(directory, 'assets', file.filename), 'utf8') });
  }
  for (const [key, value] of Object.entries(expected)) {
    if (value && context.identity[key] !== value) throw new Error(`Candidate ${key} differs from trusted evidence`);
  }
  const testerPrompt = await validateWindowsTesterPrompt({ outputDir: path.join(directory, 'handoff'),
    ...windowsTesterInput(release, context.releaseRepository) });
  return { ...release, context, testerPrompt };
}

export function validateInitialHomebrewFormula({ descriptor, repository, contents }) {
  const archive = archiveRecord({ descriptor }, 'macos-arm64');
  const expectedUrl = `https://github.com/${releaseRepository(repository)}/releases/download/v${descriptor.version}/${archive.filename}`;
  const actualUrls = [...contents.matchAll(/^\s+url "([^"]+)"$/gmu)].map(match => match[1]);
  if (canonical(actualUrls) !== canonical([expectedUrl])) throw new Error('Homebrew formula URLs differ from the approved release repository');
  if (!/^\s*depends_on\s+arch:\s*:arm64\s*$/mu.test(contents) || /\bon_intel\b|\bmacos-x64\b/u.test(contents)) {
    throw new Error('Initial stable Homebrew metadata must explicitly support arm64 only');
  }
  const digests = [...contents.matchAll(/^\s+sha256 "([a-f0-9]{64})"\s*$/gmu)].map(match => match[1]);
  if (canonical(digests) !== canonical([archive.sha256])) throw new Error('Homebrew formula must bind the exact arm64 archive digest');
}

export async function homebrewMetadata({ descriptor, artifactDirectory, outputDir, repository, generator }) {
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
  const formula = await generator({ descriptor, artifactDirectory, mode: 'stable' });
  if (formula.filename !== 'ai-sdlc-framework.rb' || formula.kind !== 'homebrew' ||
      formula.mode !== 'stable' || typeof formula.contents !== 'string' ||
      formula.sha256 !== sha256(Buffer.from(formula.contents)) || formula.size !== Buffer.byteLength(formula.contents)) {
    throw new Error('generateHomebrewFormula returned an invalid stable formula record');
  }
  validateInitialHomebrewFormula({ descriptor, repository, contents: formula.contents });
  await emptyDirectory(outputDir);
  const artifact = path.join(outputDir, formula.filename);
  await fs.writeFile(artifact, formula.contents, { flag: 'wx' });
  const { contents, mode, ...record } = formula;
  return { status: 'Generated', nativeValidation: 'NotRun', files: [{ ...record, artifact }] };
}

export async function prepareRelease({ outputDir, repository, sourceCommit, environment = process.env,
  homebrewGenerator } = {}) {
  repository = releaseRepository(repository);
  sourceCommit ??= execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const directory = path.resolve(outputDir);
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
    mode: prerelease ? 'candidate' : 'stable' };
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
  const testerPrompt = await generateWindowsTesterPrompt({ outputDir: path.join(directory, 'handoff'),
    ...windowsTesterInput(final, repository) });
  const context = { schemaVersion: 1, releaseRepository: repository, identity: evidenceIdentity(final),
    scope: RELEASE_SCOPE, prerelease, launcher: { sha256: launcher.sha256, toolchain: launcher.toolchain },
    winget, homebrew: { status: homebrew.status, nativeValidation: 'NotRun', supportedArchitectures: ['arm64'] },
    windowsTesterPrompt: { contentStatus: testerPrompt.contentStatus, nativeExecution: 'NotRun' },
    publicAssets: 'NotRun', npmPublication: 'NotRun', communityAcceptance: 'NotRun' };
  await writeJson(path.join(directory, 'context.json'), context);
  return { ...context.identity, version: pkg.version, candidateDir: directory };
}

export function validateGates(gates, identity) {
  for (const target of RELEASE_GATE_TARGETS) {
    const gate = gates.find(item => item.target === target);
    if (!gate || gates.filter(item => item.target === target).length !== 1 ||
        canonical(gate.identity) !== canonical(identity) ||
        gate.required !== RELEASE_SCOPE[target].required ||
        gate.validation !== RELEASE_SCOPE[target].validation) throw new Error(`Missing or stale gate: ${target}`);
    if (gate.required && gate.status !== 'Passed') throw new Error(`Required gate did not pass: ${target}`);
    if (target === 'macos-x64' && gate.status !== 'NotRun') throw new Error('Intel native evidence must explicitly remain NotRun');
    if (target === 'windows-x64' && gate.nativeValidation !== 'NotRun') throw new Error('Cross-build cannot claim native Windows evidence');
    if (target === 'macos-arm64' && (gate.nativeValidation !== 'Passed' ||
        gate.networkDeniedLifecycle !== 'Passed' || gate.host?.platform !== 'darwin' || gate.host?.arch !== 'arm64')) {
      throw new Error('Missing mandatory native Apple Silicon lifecycle evidence');
    }
    if (target === 'windows-x64' && (gate.deterministicCrossBuild !== 'Passed' ||
        gate.payloadIntegrity !== 'Passed' || gate.schema?.schemaValidation !== 'Passed' ||
        gate.winget?.contractValidation !== 'Passed' || gate.winget?.nativeValidation !== 'NotRun' ||
        gate.testerPrompt?.test !== 'T-60' || gate.testerPrompt?.generationValidation !== 'Passed' ||
        gate.testerPrompt?.nativeExecution !== 'NotRun' ||
        canonical(gate.testerPrompt?.identity) !== canonical(identity) ||
        !['linux', 'darwin'].includes(gate.host?.platform))) {
      throw new Error('Missing mandatory non-native Windows validation evidence');
    }
  }
  if (gates.length !== RELEASE_GATE_TARGETS.length) throw new Error('Unexpected release gate');
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

export async function selectGateFiles(evidenceDir, runId) {
  const names = (await fs.readdir(evidenceDir)).sort();
  if (!runId) {
    if (RELEASE_TARGETS.some(target => !names.includes(`${target}.json`)) ||
        names.some(name => !RELEASE_GATE_TARGETS.some(target => name === `${target}.json`))) {
      throw new Error('A result from every scoped mandatory gate is required');
    }
    return names.map(name => path.join(evidenceDir, name));
  }
  if (!/^[1-9][0-9]*$/u.test(runId)) throw new Error('Expected a numeric GitHub run ID');
  const latest = new Map();
  for (const name of names) {
    const match = /^release-gate-(macos-arm64|macos-x64|windows-x64)-([0-9]+)-([1-9][0-9]*)$/u.exec(name);
    if (!match || match[2] !== runId) throw new Error('Unexpected gate artifact name or run');
    const [, target, , attempt] = match;
    const file = path.join(evidenceDir, name, `${target}.json`);
    const record = await readJson(file);
    if (record.run?.id !== runId || record.run?.attempt !== attempt) throw new Error('Gate artifact origin mismatch');
    if (!latest.has(target) || Number(attempt) > latest.get(target).attempt) {
      latest.set(target, { file, attempt: Number(attempt) });
    }
  }
  if (RELEASE_TARGETS.some(target => !latest.has(target))) throw new Error('A result from every scoped mandatory gate is required');
  return RELEASE_GATE_TARGETS.filter(target => latest.has(target)).map(target => latest.get(target).file);
}

export async function sealBundle({ candidateDir, evidenceDir, outputDir, runId }) {
  const candidate = await verifyCandidate(candidateDir);
  const gateFiles = await selectGateFiles(evidenceDir, runId);
  const gates = await Promise.all(gateFiles.map(readJson));
  if (!gates.some(gate => gate.target === 'macos-x64')) {
    gates.push({ schemaVersion: 1, target: 'macos-x64', required: false, validation: 'NotRun',
      identity: candidate.context.identity, status: 'NotRun', nativeValidation: 'NotRun',
      reason: 'Unsupported and excluded from publication/Homebrew metadata; no Intel runner or native validation requested.' });
  }
  validateGates(gates, candidate.context.identity);
  await emptyDirectory(outputDir);
  await fs.cp(path.join(candidateDir, 'assets'), path.join(outputDir, 'assets'), { recursive: true });
  await fs.cp(path.join(candidateDir, 'handoff'), path.join(outputDir, 'handoff'), { recursive: true });
  await fs.copyFile(path.join(candidateDir, 'context.json'), path.join(outputDir, 'context.json'));
  for (const gate of gates) await writeJson(path.join(outputDir, 'evidence', `${gate.target}.json`), gate);
  const files = await inventoryTree(outputDir);
  const bundle = { schemaVersion: 1, identity: candidate.context.identity,
    releaseRepository: candidate.context.releaseRepository, scope: RELEASE_SCOPE, files };
  await writeJson(path.join(outputDir, 'bundle.json'), bundle);
  return { ...(await verifyBundle({ directory: outputDir })).identity,
    bundleSha256: sha256(Buffer.from(canonical(bundle))) };
}

export async function verifyBundle({ directory, expectedBundleSha256, ...expected }) {
  const bytes = await fs.readFile(path.join(directory, 'bundle.json'));
  if (expectedBundleSha256 && sha256(bytes) !== expectedBundleSha256) throw new Error('Immutable bundle digest mismatch');
  const bundle = JSON.parse(bytes);
  if (canonical(bundle) !== bytes.toString() || bundle.schemaVersion !== 1) throw new Error('Malformed bundle manifest');
  const actual = (await inventoryTree(directory)).filter(file => file.filename !== 'bundle.json');
  if (canonical(bundle.files) !== canonical(actual)) throw new Error('Immutable bundle files changed');
  const candidate = await verifyCandidate(directory, expected);
  if (canonical(bundle.identity) !== canonical(candidate.context.identity) ||
      canonical(bundle.scope) !== canonical(RELEASE_SCOPE) ||
      bundle.releaseRepository !== candidate.context.releaseRepository) throw new Error('Bundle identity mismatch');
  const gateNames = await fs.readdir(path.join(directory, 'evidence'));
  const gates = await Promise.all(gateNames.map(name => readJson(path.join(directory, 'evidence', name))));
  validateGates(gates, bundle.identity);
  return { ...bundle, context: candidate.context, descriptor: candidate.descriptor };
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
    expectedBundleSha256: process.env.EXPECTED_BUNDLE_SHA256 }).filter(([, value]) => value));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const commands = { prepare: prepareRelease, seal: sealBundle, verify: verifyBundle };
  const command = commands[process.argv[2]];
  if (!command) throw new Error('Expected prepare, seal or verify');
  const result = await command({ ...options(process.argv.slice(3)), ...trustedEnvironment() });
  if (process.env.GITHUB_OUTPUT) {
    for (const name of ['version', 'sourceCommit', 'payloadSha256', 'descriptorSha256', 'checksumsSha256', 'bundleSha256']) {
      if (result[name]) await fs.appendFile(process.env.GITHUB_OUTPUT, `${name}=${result[name]}\n`);
    }
  }
  console.log(JSON.stringify(result, null, 2));
}
