import * as fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { canonical, inventory, readTarGzip, readZip, sha256, tarGzip, zip } from '../packaging/standalone/archive.mjs';
import { ARCHIVE_TARGETS, payloadIdentity, platformEntries, TARGETS, verifyEntries } from '../packaging/standalone/protocol.mjs';
import { sameNativePath } from '../src/platform.mjs';
import { readBytes } from '../src/files.mjs';
import { assertCommittedSourceInputs } from './committed-source-inputs.mjs';
import { buildPackage } from './package.mjs';
import { buildPlatforms } from './package-platforms.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const execute = promisify(execFile);
export const syntheticReleaseContextVariable = 'SDLC_SYNTHETIC_RELEASE_FIXTURE_CONTEXT';
export const releaseFixturePureRoot =
  'T-PRD057 two archive targets retain four mandatory native execution platforms without Linux standalone support';
const requireInput = (condition, message) => {
  if (!condition) throw new Error(`Synthetic release fixture: ${message}`);
};
const git = async (root, args) => (await execute('git', args,
  { cwd: root, maxBuffer: 8 * 1024 * 1024 })).stdout;

export function syntheticReleaseLauncher() {
  const pe = Buffer.alloc(256);
  pe.write('MZ');
  pe.writeUInt32LE(128, 60);
  pe.writeUInt32LE(0x4550, 128);
  pe.writeUInt16LE(0x8664, 132);
  pe.writeUInt16LE(0x20b, 152);
  return pe;
}

async function configuration(sourceRoot, environment) {
  requireInput(/^100(?:644|755) [a-f0-9]+ 0\tpackage\.json\0$/u.test(
    await git(sourceRoot, ['ls-files', '--stage', '-z', '--', 'package.json'])),
  'package.json must be a registered regular source input');
  const packageFile = path.join(sourceRoot, 'package.json');
  const packageStat = await fs.lstat(packageFile);
  requireInput(packageStat.isFile() && !packageStat.isSymbolicLink() &&
    sameNativePath(await fs.realpath(packageFile), packageFile), 'package.json must be literal source');
  const pkg = JSON.parse(await fs.readFile(packageFile, 'utf8'));
  const material = Object.fromEntries(Object.entries(environment).filter(([key]) =>
    /^(?:npm_config_|npm_execpath$|NODE_OPTIONS$|NODE_PATH$)/iu.test(key)));
  return { schemaVersion: 1, recipe: 'release-ci-portable-six-v1', name: pkg.name, version: pkg.version,
    previousVersion: '0.3.0', currentRevision: 'a'.repeat(40), previousRevision: 'b'.repeat(40),
    targets: [...ARCHIVE_TARGETS], launcherSha256: sha256(syntheticReleaseLauncher()),
    node: process.version, platform: process.platform, architecture: process.arch,
    environmentDigest: sha256(canonical(material)) };
}

async function sourceOrigin(sourceRoot) {
  const files = await assertCommittedSourceInputs(sourceRoot);
  const index = await git(sourceRoot, ['ls-files', '--stage', '-z']);
  requireInput(index === files.map(file => `${file.mode} ${file.oid} 0\t${file.file}\0`).join(''),
    'registered index differs from committed source bytes/modes');
  return { root: sourceRoot, revision: (await git(sourceRoot, ['rev-parse', 'HEAD'])).trim(),
    tree: (await git(sourceRoot, ['rev-parse', 'HEAD^{tree}'])).trim(),
    indexDigest: sha256(index), registeredDigest: sha256(canonical(files)) };
}

async function literal(location, sourceRoot, directory) {
  requireInput(typeof location === 'string' && path.isAbsolute(location) &&
    location === path.resolve(location), 'requires literal absolute paths');
  const relative = path.relative(sourceRoot, location);
  requireInput(relative.split(path.sep)[0] === '.test-data' && !relative.split(path.sep).includes('..') &&
    !path.isAbsolute(relative), 'path escapes owned .test-data');
  const stat = await fs.lstat(location);
  requireInput(!stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile()) &&
    sameNativePath(await fs.realpath(location), location), 'linked or nonregular input');
  if (!directory) requireInput(stat.size <= 128 * 1024 * 1024 &&
    (process.platform === 'win32' || (stat.mode & 0o777) === 0o644), 'invalid input size/mode');
  return stat;
}

function specifications(config) {
  return ['current', 'previous'].flatMap(generation => {
    const version = generation === 'current' ? config.version : config.previousVersion;
    return [{ role: `${generation}-payload`, relative: `${generation}/${config.name}-${version}.tgz` },
      ...config.targets.map(target => ({ role: `${generation}-${target}`,
        relative: `${generation}/${config.name}-${version}-${target}.${TARGETS[target].extension}` }))];
  });
}

function previousEntries(entries) {
  return entries.map(entry => entry.path === 'package/package.json' ? { ...entry,
    data: Buffer.from(JSON.stringify({ ...JSON.parse(entry.data), version: '0.3.0' })) } : entry);
}

async function verifyPortable(bytes, config, sourceRoot) {
  const current = payloadIdentity(bytes.get('current-payload'));
  const previous = payloadIdentity(bytes.get('previous-payload'));
  requireInput(current.manifest.name === config.name && current.manifest.version === config.version &&
    previous.manifest.version === config.previousVersion &&
    canonical(inventory(previous.entries)) === canonical(inventory(previousEntries(current.entries))),
  'current/previous payload recipe differs');
  const index = await git(sourceRoot, ['ls-files', '--stage', '-z']);
  const modes = new Map(index.split('\0').filter(Boolean).map(record => {
    const match = /^(100644|100755) [a-f0-9]+ 0\t(.+)$/su.exec(record);
    requireInput(match, 'payload source requires registered regular Git modes');
    return [match[2], match[1] === '100755' ? 0o755 : 0o644];
  }));
  for (const entry of current.entries) {
    const relative = entry.path.slice('package/'.length);
    requireInput(modes.get(relative) === entry.mode, `unregistered or changed payload mode: ${relative}`);
    const file = path.join(sourceRoot, ...relative.split('/'));
    const stat = await fs.lstat(file);
    requireInput(stat.isFile() && !stat.isSymbolicLink() &&
      sameNativePath(await fs.realpath(file), file) && (await fs.readFile(file)).equals(entry.data),
    `payload differs from current raw source: ${relative}`);
  }
  for (const generation of ['current', 'previous']) {
    const payload = generation === 'current' ? current : previous;
    for (const target of config.targets) {
      const archive = bytes.get(`${generation}-${target}`);
      const entries = target === 'windows-x64' ? readZip(archive) : readTarGzip(archive);
      const verified = verifyEntries(entries, { expectedPlatform: TARGETS[target].platform });
      requireInput(verified.target === target &&
        canonical(verified.manifest) === canonical(payload.manifest), 'archive payload/manifest differs');
      if (target === 'windows-x64') requireInput(entries.find(entry => entry.path === 'bin/sdlc.exe')
        ?.data.equals(syntheticReleaseLauncher()), 'archive substitutes the synthetic launcher recipe');
    }
  }
  return current;
}

async function buildPortable({ directory, sourceRoot, environment,
  packageBuilder = buildPackage, platformBuilder = buildPlatforms }) {
  const config = await configuration(sourceRoot, environment);
  const work = path.join(directory, 'building');
  await fs.mkdir(work);
  const temporary = Object.fromEntries(['TMPDIR', 'TMP', 'TEMP'].map(key => [key, process.env[key]]));
  try {
    const scratch = path.join(work, 'scratch');
    await fs.mkdir(scratch);
    // The packager's comparison reads process temp settings, not only its child environment.
    for (const key of Object.keys(temporary)) process.env[key] = scratch;
    const buildEnvironment = { ...environment, TMPDIR: scratch, TMP: scratch, TEMP: scratch };
    const payload = await packageBuilder({ outputDir: path.join(work, 'npm'), environment: buildEnvironment });
    const launcher = path.join(work, 'nonexecutable-PE-test-fixture');
    await fs.writeFile(launcher, syntheticReleaseLauncher(), { flag: 'wx', mode: 0o644 });
    const built = await platformBuilder({ artifact: payload.artifact, outputDir: path.join(work, 'current'),
      windowsLauncher: launcher, sourceCommit: config.currentRevision, targets: config.targets, environment: buildEnvironment });
    const currentBytes = await fs.readFile(payload.artifact);
    const previousBytes = tarGzip(previousEntries(readTarGzip(currentBytes)));
    const bytes = new Map([['current-payload', currentBytes], ['previous-payload', previousBytes]]);
    for (const target of config.targets) {
      const archive = built.archives.find(archive => archive.target === target);
      requireInput(archive, 'builder omitted a required archive');
      bytes.set(`current-${target}`, await fs.readFile(archive.artifact));
      const encode = TARGETS[target].extension === 'zip' ? zip : tarGzip;
      bytes.set(`previous-${target}`, encode(platformEntries(previousBytes, target, syntheticReleaseLauncher()).entries));
    }
    await verifyPortable(bytes, config, sourceRoot);
    return { bytes, config };
  } finally {
    for (const [key, value] of Object.entries(temporary)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(work, { recursive: true, force: true });
  }
}

export async function prepareSyntheticReleaseFixture({ directory, sourceRoot = ROOT,
  environment = process.env, expectedSourceCommit, expectedTree, ...builders }) {
  requireInput(typeof directory === 'string' && path.isAbsolute(directory) &&
    directory === path.resolve(directory), 'preparation requires a literal absolute directory');
  await literal(path.dirname(directory), sourceRoot, true);
  const origin = await sourceOrigin(sourceRoot);
  requireInput((expectedSourceCommit === undefined || origin.revision === expectedSourceCommit) &&
    (expectedTree === undefined || origin.tree === expectedTree), 'producer source differs from its selected native source');
  await fs.mkdir(directory);
  const { bytes, config } = await buildPortable({ directory, sourceRoot, environment, ...builders });
  const files = [];
  for (const spec of specifications(config)) {
    const file = path.join(directory, ...spec.relative.split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    const data = bytes.get(spec.role);
    await fs.writeFile(file, data, { flag: 'wx', mode: 0o644 });
    await fs.chmod(file, 0o644);
    files.push({ ...spec, sha256: sha256(data), size: data.length, mode: '0644' });
  }
  requireInput(canonical(await sourceOrigin(sourceRoot)) === canonical(origin), 'source changed during preparation');
  requireInput(canonical(await configuration(sourceRoot, environment)) === canonical(config),
    'configuration changed during preparation');
  return { schemaVersion: 1, kind: 'synthetic-release-ci-only', directory, sourceOrigin: origin,
    configuration: config, files };
}

async function suppliedBytes(context, sourceRoot, environment) {
  requireInput(context?.schemaVersion === 1 && context.kind === 'synthetic-release-ci-only' &&
    Object.keys(context).sort().join(',') === 'configuration,directory,files,kind,schemaVersion,sourceOrigin',
  'invalid supplied context');
  const origin = await sourceOrigin(sourceRoot);
  requireInput(canonical(context.sourceOrigin) === canonical(origin), 'stale or foreign source origin');
  const config = await configuration(sourceRoot, environment);
  requireInput(canonical(context.configuration) === canonical(config), 'foreign recipe/configuration');
  const specs = specifications(config);
  requireInput(Array.isArray(context.files) && context.files.length === 6 &&
    canonical(context.files.map(({ role, relative }) => ({ role, relative }))) === canonical(specs),
  'missing, duplicate or foreign portable inputs');
  await literal(context.directory, sourceRoot, true);
  requireInput(canonical((await fs.readdir(context.directory)).sort()) === canonical(['current', 'previous']),
    'unexpected portable input layout');
  const bytes = new Map();
  for (const generation of ['current', 'previous']) {
    const location = path.join(context.directory, generation);
    await literal(location, sourceRoot, true);
    requireInput(canonical((await fs.readdir(location)).sort()) === canonical(specs
      .filter(spec => spec.relative.startsWith(`${generation}/`)).map(spec => path.basename(spec.relative)).sort()),
    'unexpected generation layout');
  }
  for (const file of context.files) {
    requireInput(Object.keys(file).sort().join(',') === 'mode,relative,role,sha256,size' &&
      /^[a-f0-9]{64}$/u.test(file.sha256 ?? '') && Number.isSafeInteger(file.size) &&
      file.mode === '0644', 'invalid input identity');
    const location = path.join(context.directory, ...file.relative.split('/'));
    const stat = await literal(location, sourceRoot, false);
    const data = await readBytes(location, 128 * 1024 * 1024);
    requireInput(stat.size === data.length && file.size === data.length && sha256(data) === file.sha256,
      `portable bytes changed: ${file.role}`);
    bytes.set(file.role, data);
  }
  await verifyPortable(bytes, config, sourceRoot);
  requireInput(canonical(await sourceOrigin(sourceRoot)) === canonical(origin), 'source changed during verification');
  requireInput(canonical(await configuration(sourceRoot, environment)) === canonical(config),
    'configuration changed during verification');
  return { bytes, config };
}

export async function materializeSyntheticReleaseInputs({ root, sourceRoot = ROOT,
  environment = process.env, ...builders }) {
  const supplied = environment[syntheticReleaseContextVariable];
  let prepared;
  if (supplied !== undefined) prepared = await suppliedBytes(JSON.parse(supplied), sourceRoot, environment);
  else {
    await literal(root, sourceRoot, true);
    prepared = await buildPortable({ directory: root, sourceRoot, environment, ...builders });
  }
  const { bytes, config } = prepared;
  const identity = payloadIdentity(bytes.get('current-payload'));
  await literal(root, sourceRoot, true);
  const destinations = new Map();
  for (const spec of specifications(config)) {
    const basename = path.basename(spec.relative);
    const destination = spec.role === 'current-payload' ? path.join(root, 'npm', basename) :
      spec.role.startsWith('current-') ? path.join(root, 'base', 'assets', basename) :
      spec.role === 'previous-payload' ? path.join(root, 'controlled-previous-version-input', basename) :
        path.join(root, 'controlled-previous-version-input', 'assets', basename);
    destinations.set(spec.role, destination);
  }
  // Validate every existing ancestor before any write; write the exact buffers that were verified.
  for (const destination of destinations.values()) {
    let current = path.dirname(destination);
    while (current !== root) {
      try { await literal(current, sourceRoot, true); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      current = path.dirname(current);
    }
    await fs.lstat(destination).then(() => { throw new Error('Synthetic release fixture: destination already exists'); },
      error => { if (error.code !== 'ENOENT') throw error; });
  }
  for (const [role, destination] of destinations) {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, bytes.get(role), { flag: 'wx', mode: 0o644 });
    await fs.chmod(destination, 0o644);
  }
  const data = bytes.get('current-payload');
  return { payload: { artifact: destinations.get('current-payload'), schemaVersion: 1,
    name: identity.manifest.name, version: identity.manifest.version,
    filename: identity.manifest.payload.filename, sha256: sha256(data), size: data.length,
    unpackedSize: identity.entries.reduce((total, entry) => total + entry.data.length, 0),
    files: identity.entries.map(entry => ({ path: entry.path.slice('package/'.length), size: entry.data.length }))
      .sort((a, b) => a.path.localeCompare(b.path)) },
    previousArtifact: destinations.get('previous-payload') };
}

export function needsSyntheticReleaseFixture(stages, target) {
  return stages.some(stage => stage.name === 'regression' && stage.cases.some(test =>
    test.file === 'test/release-ci.test.mjs' && !test.parents.length && test.name !== releaseFixturePureRoot &&
    test.applicability.platforms.includes(target)));
}

export async function prepareSelectedSyntheticReleaseFixture({ stages, target, ...options }) {
  return needsSyntheticReleaseFixture(stages, target) ? prepareSyntheticReleaseFixture(options) : null;
}
