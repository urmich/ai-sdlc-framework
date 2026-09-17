import * as fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildPackage } from './package.mjs';
import { canonical, comparePath, safePath, sha256, tarGzip, zip } from '../packaging/standalone/archive.mjs';
import { isPrerelease, payloadIdentity, platformEntries, TARGETS } from '../packaging/standalone/protocol.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export { canonical, sha256, TARGETS };

function filenameOnly(filename) {
  safePath(filename);
  if (filename.includes('/')) throw new Error('Release assets must have flat, unique filenames');
  return filename;
}

function metadataSource(item) {
  const file = item.file ?? item.artifact;
  if (typeof file !== 'string' || !file) throw new Error('Release metadata requires a file or artifact path');
  return file;
}

async function writeOwned(file, bytes) {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Release destination is not a regular file: ${file}`);
    if ((await fs.readFile(file)).equals(bytes)) return;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const staging = `${file}.${randomUUID()}.pending`;
  try {
    await fs.writeFile(staging, bytes, { flag: 'wx', mode: 0o644 });
    await fs.rename(staging, file);
  } finally { await fs.rm(staging, { force: true }); }
}

export function renderChecksums(descriptor, descriptorBytes = canonical(descriptor)) {
  return [...descriptor.files, { filename: 'release-descriptor.json', sha256: sha256(descriptorBytes) }]
    .sort((a, b) => comparePath(a.filename, b.filename))
    .map(file => `${file.sha256}  ${file.filename}\n`).join('');
}

export async function writeReleaseMetadata({ outputDir, artifact, sourceCommit, metadataFiles = [],
  targets = Object.keys(TARGETS) }) {
  const directory = path.resolve(outputDir);
  const outputStat = await fs.lstat(directory);
  if (!outputStat.isDirectory() || outputStat.isSymbolicLink()) throw new Error('Release output must be a literal directory');
  const payloadBytes = await fs.readFile(artifact);
  const { manifest } = payloadIdentity(payloadBytes);
  if (isPrerelease(manifest.version) && metadataFiles.some(item => ['homebrew', 'winget'].includes(item.kind))) {
    throw new Error('Prereleases cannot include stable package-manager metadata');
  }
  const commit = sourceCommit ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  if (!/^[a-f0-9]{40}$/u.test(commit)) throw new Error('Release sourceCommit must be a full Git commit');
  const filenames = new Set(['release-descriptor.json', 'sha256sums']);
  const files = [];
  const add = async (filename, kind, bytes) => {
    filenameOnly(filename);
    if (filenames.has(filename.toLowerCase())) throw new Error(`Duplicate release filename: ${filename}`);
    filenames.add(filename.toLowerCase());
    await writeOwned(path.join(directory, filename), bytes);
    files.push({ filename, kind, sha256: sha256(bytes), size: bytes.length });
  };
  await add(manifest.payload.filename, 'archive', payloadBytes);
  for (const target of targets) {
    if (!TARGETS[target]) throw new Error(`Unsupported platform: ${target}`);
    const filename = `${manifest.name}-${manifest.version}-${target}.${TARGETS[target].extension}`;
    await add(filename, 'archive', await fs.readFile(path.join(directory, filename)));
  }
  for (const item of metadataFiles) {
    if (!['homebrew', 'winget', 'metadata'].includes(item.kind)) throw new Error('Unsupported release metadata kind');
    const file = metadataSource(item);
    const bytes = await fs.readFile(file);
    if (item.sha256 !== undefined && item.sha256 !== sha256(bytes) ||
        item.size !== undefined && item.size !== bytes.length) {
      throw new Error('Generated release metadata does not match its supplied digest or size');
    }
    await add(item.filename ?? path.basename(file), item.kind, bytes);
  }
  files.sort((a, b) => comparePath(a.filename, b.filename));
  const descriptor = { schemaVersion: 1, name: manifest.name, version: manifest.version,
    sourceCommit: commit, payload: { ...manifest.payload, inventoryDigest: manifest.inventoryDigest }, files };
  const descriptorBytes = canonical(descriptor);
  const checksumBytes = renderChecksums(descriptor, descriptorBytes);
  await writeOwned(path.join(directory, 'release-descriptor.json'), Buffer.from(descriptorBytes));
  await writeOwned(path.join(directory, 'SHA256SUMS'), Buffer.from(checksumBytes));
  return { descriptor, descriptorSha256: sha256(descriptorBytes), checksumsSha256: sha256(checksumBytes) };
}

export async function buildPlatforms({ artifact, outputDir = path.join(ROOT, 'dist'),
  windowsLauncher, metadataFiles = [], sourceCommit, environment = process.env,
  targets = Object.keys(TARGETS) } = {}) {
  if (!targets.length || new Set(targets).size !== targets.length || targets.some(target => !TARGETS[target])) {
    throw new Error('Select unique supported platform targets');
  }
  const output = path.resolve(outputDir);
  if (output === path.resolve(ROOT)) throw new Error('Release output cannot be the source root');
  const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const payloadFilename = `${pkg.name}-${pkg.version}.tgz`;
  const allowed = new Set([payloadFilename, 'release-descriptor.json', 'SHA256SUMS',
    ...targets.map(target => `${pkg.name}-${pkg.version}-${target}.${TARGETS[target].extension}`),
    ...metadataFiles.map(item => filenameOnly(item.filename ?? path.basename(metadataSource(item))))]);
  await fs.mkdir(output, { recursive: true });
  if (!(await fs.lstat(output)).isDirectory() || (await fs.lstat(output)).isSymbolicLink()) {
    throw new Error('Release output must be a literal directory');
  }
  for (const entry of await fs.readdir(output, { withFileTypes: true })) {
    if (!allowed.has(entry.name) || !entry.isFile()) throw new Error('Release output contains an unowned entry');
  }
  if (targets.includes('windows-x64') && !windowsLauncher) throw new Error('--windows-launcher is required for Windows packaging');
  const launcherBytes = targets.includes('windows-x64') ? await fs.readFile(windowsLauncher) : undefined;
  let ownedPayload;
  try {
    if (!artifact) {
      ownedPayload = path.join(output, `.payload-${randomUUID()}`);
      artifact = (await buildPackage({ outputDir: ownedPayload, environment })).artifact;
    }
    const payload = await fs.readFile(artifact);
    const { manifest } = payloadIdentity(payload);
    if (path.basename(artifact) !== payloadFilename || manifest.name !== pkg.name || manifest.version !== pkg.version) {
      throw new Error('Payload filename or version does not match this source');
    }
    // The supplied npm bytes, not a source-tree reconstruction, define every wrapper.
    const archives = [];
    for (const target of targets) {
      const { entries } = platformEntries(payload, target, launcherBytes);
      const encode = TARGETS[target].extension === 'zip' ? zip : tarGzip;
      const bytes = encode(entries);
      if (!bytes.equals(encode(entries))) throw new Error('Platform archive build is not deterministic');
      const filename = `${manifest.name}-${manifest.version}-${target}.${TARGETS[target].extension}`;
      await writeOwned(path.join(output, filename), bytes);
      archives.push({ target, filename, artifact: path.join(output, filename), sha256: sha256(bytes), size: bytes.length });
    }
    const metadata = await writeReleaseMetadata({ outputDir: output, artifact, sourceCommit, metadataFiles, targets });
    return { ...metadata, outputDir: output, payload: manifest.payload, archives,
      complete: targets.length === Object.keys(TARGETS).length };
  } finally {
    if (ownedPayload) await fs.rm(ownedPayload, { recursive: true, force: true });
  }
}

export function commandOptions(argv) {
  const options = {};
  const names = { '--artifact': 'artifact', '--output-dir': 'outputDir',
    '--windows-launcher': 'windowsLauncher', '--source-commit': 'sourceCommit' };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    if (flag === '--targets') options.targets = value.split(',');
    else if (names[flag]) options[names[flag]] = value;
    else if (flag === '--metadata') options.metadataFile = value;
    else throw new Error(`Unknown package option: ${flag}`);
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const options = commandOptions(process.argv.slice(2));
  if (options.metadataFile) options.metadataFiles = JSON.parse(await fs.readFile(options.metadataFile, 'utf8'));
  process.stdout.write(`${JSON.stringify(await buildPlatforms(options), null, 2)}\n`);
}
