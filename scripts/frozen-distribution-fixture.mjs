import * as fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { digest } from '../src/core.mjs';
import { sameNativePath } from '../src/platform.mjs';
import { canonical, sha256 } from '../packaging/standalone/archive.mjs';
import { payloadIdentity } from '../packaging/standalone/protocol.mjs';
import { captureLocalSourceInputs } from './test-local-evidence.mjs';
import { buildPackage } from './package.mjs';
import { buildPlatforms } from './package-platforms.mjs';
import { verifyRelease } from './verify-platform-package.mjs';
import { assertCommittedSourceInputs } from './committed-source-inputs.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const execute = promisify(execFile);
const requireFixture = (condition, message) => {
  if (!condition) throw new Error(`Frozen distribution fixture: ${message}`);
};

async function literalOwned(location, directory = false, sourceRoot = ROOT) {
  requireFixture(typeof location === 'string' && path.isAbsolute(location) &&
    location === path.resolve(location), 'requires an absolute literal owned path');
  const relative = path.relative(sourceRoot, location);
  requireFixture(relative.split(path.sep)[0] === '.test-data' &&
    !relative.split(path.sep).includes('..') && !path.isAbsolute(relative), 'path escapes owned .test-data');
  const stat = await fs.lstat(location);
  requireFixture((directory ? stat.isDirectory() : stat.isFile()) && !stat.isSymbolicLink() &&
    sameNativePath(await fs.realpath(location), location), 'requires regular literal inputs without linked ancestors');
  return stat;
}

async function sourceInputs(sourceRoot) {
  const committed = await assertCommittedSourceInputs(sourceRoot);
  const snapshot = await captureLocalSourceInputs(sourceRoot);
  const tracked = new Set(committed.map(entry => entry.file));
  requireFixture(snapshot.files.every(file => tracked.has(file.file)),
    'uncommitted source additions cannot receive frozen setup credit');
  const git = args => execute('git', args, { cwd: sourceRoot, maxBuffer: 8 * 1024 * 1024 });
  const tree = (await git(['rev-parse', 'HEAD^{tree}'])).stdout.trim();
  const index = (await git(['ls-files', '--stage', '-z'])).stdout;
  requireFixture(index === committed.map(entry => `${entry.mode} ${entry.oid} 0\t${entry.file}\0`).join(''),
    'source index differs from its committed bytes/modes');
  return { identity: { root: sourceRoot, revision: snapshot.revision, contentDigest: snapshot.contentDigest,
    tree, indexDigest: sha256(index) }, index };
}

function artifactPins(release) {
  return [{ name: 'frozen-descriptor', sha256: release.descriptorSha256 },
    { name: 'frozen-checksums', sha256: release.checksumsSha256 },
    ...release.descriptor.files.map(file => ({ name: file.filename, sha256: file.sha256 }))]
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

async function checkedRelease(directory, targets, sourceRoot) {
  requireFixture(Array.isArray(targets) && targets.length > 0 &&
    new Set(targets).size === targets.length &&
    targets.every(target => ['macos', 'windows-x64', 'linux-x64'].includes(target)), 'unknown or duplicate targets');
  await literalOwned(directory, true, sourceRoot);
  for (const name of await fs.readdir(directory)) await literalOwned(path.join(directory, name), false, sourceRoot);
  return verifyRelease({ outputDir: directory, targets, rebuild: false });
}

function checkNativeSource(context, source) {
  requireFixture(/^[a-f0-9]{40}$/u.test(source.revision ?? '') &&
    context?.sources?.length === 1 && context.sources[0]?.revision === source.revision &&
    context.sources[0]?.contentDigest === digest(source.tree) &&
    context.candidateDigest === digest({ revision: source.revision, tree: source.tree }),
  'source/head differs from the source-bound native context');
}

function checkPublishedArtifacts(context, release, kind) {
  requireFixture(Array.isArray(context?.artifacts) && context.artifacts.length > 0 &&
    new Set(context.artifacts.map(file => file?.name)).size === context.artifacts.length &&
    context.artifacts.every(file => typeof file?.name === 'string' && /^[a-f0-9]{64}$/u.test(file.sha256 ?? '')),
  'missing or malformed native artifact identities');
  if (kind === 'published-candidate') {
    requireFixture(release.archiveTargets.every(target => ['macos', 'windows-x64'].includes(target)),
      'Linux fixtures are private test library inputs, not published standalone archives');
    requireFixture(canonical(context.artifacts) === canonical(artifactPins(release)),
      'release differs from native artifact identities');
  } else {
    requireFixture(kind === 'private-test-library-only' &&
      canonical(release.archiveTargets) === canonical(['macos', 'windows-x64', 'linux-x64']),
    'invalid private host fixture distinction');
    for (const file of release.descriptor.files.filter(file =>
      file.kind === 'archive' && !file.filename.endsWith('-linux-x64.tar.gz'))) {
      requireFixture(context.artifacts.some(pin => pin.name === file.filename && pin.sha256 === file.sha256),
        'private fixture differs from frozen published payload/archive bytes');
    }
  }
}

async function checkedPayload(directory, release, index, sourceRoot) {
  const artifact = path.join(directory, release.descriptor.payload.filename);
  const bytes = await fs.readFile(artifact);
  const { entries, manifest } = payloadIdentity(bytes);
  const modes = new Map(index.split('\0').filter(Boolean).map(record => {
    const match = /^(100644|100755) [a-f0-9]+ 0\t(.+)$/su.exec(record);
    return match ? [match[2], match[1] === '100755' ? 0o755 : 0o644] : [null, null];
  }));
  for (const entry of entries) {
    const relative = entry.path.slice('package/'.length);
    const file = path.join(sourceRoot, ...relative.split('/'));
    const stat = await fs.lstat(file);
    requireFixture(stat.isFile() && !stat.isSymbolicLink() &&
      sameNativePath(await fs.realpath(file), file) && modes.get(relative) === entry.mode &&
      (await fs.readFile(file)).equals(entry.data), `payload source bytes/mode differ: ${relative}`);
  }
  return { artifact, schemaVersion: 1, name: manifest.name, version: manifest.version,
    filename: manifest.payload.filename, sha256: sha256(bytes), size: bytes.length,
    unpackedSize: entries.reduce((sum, entry) => sum + entry.data.length, 0),
    files: entries.map(entry => ({ path: entry.path.slice('package/'.length), size: entry.data.length }))
      .sort((a, b) => a.path.localeCompare(b.path)) };
}

// Dedicated transport, not reporter evidence or a producer "verified" boolean.
export async function frozenDistributionContext({ directory, targets, context,
  kind = 'published-candidate', sourceRoot = ROOT }) {
  const source = await sourceInputs(sourceRoot);
  checkNativeSource(context, source.identity);
  const release = await checkedRelease(directory, targets, sourceRoot);
  requireFixture(release.descriptor.sourceCommit === source.identity.revision, 'release source/head differs');
  checkPublishedArtifacts(context, release, kind);
  await checkedPayload(directory, release, source.index, sourceRoot);
  return { schemaVersion: 1, kind, directory, targets: [...targets],
    source: source.identity, native: { candidateDigest: context.candidateDigest,
      sources: context.sources, artifacts: context.artifacts }, artifacts: artifactPins(release) };
}

export async function buildDistributionFixture({ root, environment = process.env,
  targets, windowsLauncher, packageBuilder = buildPackage, platformBuilder = buildPlatforms }) {
  const payload = await packageBuilder({ outputDir: path.join(root, 'npm'), environment });
  const built = await platformBuilder({ artifact: payload.artifact, outputDir: path.join(root, 'release'),
    windowsLauncher, environment, targets, sourceCommit: environment.SDLC_RELEASE_SOURCE_COMMIT });
  return { payload, built };
}

export async function prepareDistributionFixture(options) {
  const { environment = process.env, targets, sourceRoot = ROOT } = options;
  const directory = environment.SDLC_RELEASE_DIR;
  const supplied = environment.SDLC_DISTRIBUTION_FIXTURE_CONTEXT;
  if (directory === undefined && supplied === undefined) return buildDistributionFixture(options);
  requireFixture(typeof directory === 'string' && directory.length > 0 && typeof supplied === 'string',
    'provided release requires its dedicated source-bound context');
  const context = JSON.parse(supplied);
  requireFixture(context?.schemaVersion === 1 && context.directory === directory &&
    canonical(context.targets) === canonical(targets), 'stale/swapped path or target context');
  const source = await sourceInputs(sourceRoot);
  requireFixture(environment.SDLC_RELEASE_SOURCE_COMMIT === source.identity.revision,
    'missing or wrong expected source revision');
  checkNativeSource(context.native, source.identity);
  requireFixture(canonical(source.identity) === canonical(context.source), 'current source bytes/index differ');
  const release = await checkedRelease(directory, targets, sourceRoot);
  requireFixture(release.descriptor.sourceCommit === source.identity.revision, 'release source/head differs');
  checkPublishedArtifacts(context.native, release, context.kind);
  requireFixture(canonical(artifactPins(release)) === canonical(context.artifacts), 'release bytes differ from setup context');
  const payload = await checkedPayload(directory, release, source.index, sourceRoot);
  const archives = targets.map(target => {
    const archive = release.archives.find(archive => archive.target === target);
    const file = release.descriptor.files.find(file => file.filename === archive.filename);
    return { target: archive.target, filename: archive.filename, artifact: path.join(directory, archive.filename),
      sha256: file.sha256, size: file.size };
  });
  return { payload, built: { ...release, outputDir: directory,
    payload: { filename: payload.filename, sha256: payload.sha256 },
    archives }, kind: context.kind };
}
