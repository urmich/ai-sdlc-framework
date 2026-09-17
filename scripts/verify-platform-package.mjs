import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonical, readTarGzip, readZip, sha256 } from '../packaging/standalone/archive.mjs';
import { DIGEST, parseCanonical, payloadIdentity, TARGETS, verifyEntries } from '../packaging/standalone/protocol.mjs';
import { buildPlatforms, commandOptions, renderChecksums } from './package-platforms.mjs';
import { buildPackage } from './package.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

export async function verifyReleaseChecksums({ outputDir, descriptor, checksums,
  allowExtra = false, selectedFiles, expectedDescriptorSha256, expectedChecksumsSha256 } = {}) {
  const directory = path.resolve(outputDir ?? path.dirname(descriptor));
  const descriptorBytes = await fs.readFile(descriptor ?? path.join(directory, 'release-descriptor.json'));
  if (expectedDescriptorSha256 && sha256(descriptorBytes) !== expectedDescriptorSha256) {
    throw new Error('Published descriptor differs from prepublication evidence');
  }
  const value = parseCanonical(descriptorBytes, 'release descriptor');
  if (value.schemaVersion !== 1 || value.name !== 'ai-sdlc-framework' ||
      typeof value.version !== 'string' || !/^[a-f0-9]{40}$/u.test(value.sourceCommit ?? '') ||
      !DIGEST.test(value.payload?.sha256 ?? '') || !DIGEST.test(value.payload?.inventoryDigest ?? '') ||
      !Array.isArray(value.files) || !value.files.length) throw new Error('Malformed release descriptor');
  const seen = new Set(['sha256sums', 'release-descriptor.json']);
  let last = '';
  for (const file of value.files) {
    if (!/^[a-zA-Z0-9_.+-]+$/u.test(file.filename ?? '') ||
        !['archive', 'homebrew', 'winget', 'metadata'].includes(file.kind) ||
        !DIGEST.test(file.sha256 ?? '') || !Number.isSafeInteger(file.size) || file.size < 0 ||
        seen.has(file.filename.toLowerCase()) || last >= file.filename ||
        Object.keys(file).sort().join(',') !== 'filename,kind,sha256,size') {
      throw new Error('Malformed or duplicate release file');
    }
    seen.add(file.filename.toLowerCase());
    last = file.filename;
  }
  const checksumBytes = await fs.readFile(checksums ?? path.join(directory, 'SHA256SUMS'));
  if (expectedChecksumsSha256 && sha256(checksumBytes) !== expectedChecksumsSha256) {
    throw new Error('Published checksums differ from prepublication evidence');
  }
  if (checksumBytes.toString('utf8') !== renderChecksums(value, descriptorBytes)) {
    throw new Error('Missing, malformed or swapped checksum manifest');
  }
  for (const file of value.files.filter(item => !selectedFiles || selectedFiles.includes(item.filename))) {
    const location = path.join(directory, file.filename);
    const stat = await fs.lstat(location);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Release contains a nonregular file');
    const bytes = await fs.readFile(location);
    if (bytes.length !== file.size || sha256(bytes) !== file.sha256) throw new Error(`Release checksum mismatch: ${file.filename}`);
  }
  if (!allowExtra) {
    for (const entry of await fs.readdir(directory)) {
      if (!seen.has(entry.toLowerCase())) throw new Error(`Unlisted release file: ${entry}`);
    }
  }
  const payloadFile = value.files.find(file => file.filename === value.payload.filename);
  if (!payloadFile || payloadFile.kind !== 'archive' || payloadFile.sha256 !== value.payload.sha256) {
    throw new Error('Release descriptor does not bind the npm payload');
  }
  return { descriptor: value, descriptorSha256: sha256(descriptorBytes), checksumsSha256: sha256(checksumBytes) };
}

export async function verifyPlatformPackage({ artifact, descriptor, checksums,
  expectedPlatform, expectedArch, allowExtra = false, expectedDescriptorSha256, expectedChecksumsSha256 } = {}) {
  if (!artifact) throw new Error('A platform archive is required');
  const file = path.resolve(artifact);
  const release = await verifyReleaseChecksums({ outputDir: path.dirname(file), descriptor, checksums,
    allowExtra, selectedFiles: [path.basename(file)], expectedDescriptorSha256, expectedChecksumsSha256 });
  const bytes = await fs.readFile(file);
  const entry = release.descriptor.files.find(item => item.filename === path.basename(file));
  if (!entry || entry.kind !== 'archive' || sha256(bytes) !== entry.sha256) throw new Error('Platform archive is not bound to the release');
  const entries = file.endsWith('.zip') ? readZip(bytes) : readTarGzip(bytes);
  const verified = verifyEntries(entries, { expectedPlatform, expectedArch });
  const { manifest, target } = verified;
  const expectedName = `${manifest.name}-${manifest.version}-${target}.${TARGETS[target].extension}`;
  if (path.basename(file) !== expectedName || manifest.version !== release.descriptor.version ||
      canonical({ ...manifest.payload, inventoryDigest: manifest.inventoryDigest }) !== canonical(release.descriptor.payload)) {
    throw new Error('Wrong-version or wrong-platform release artifact');
  }
  return { verified: true, filename: expectedName, sha256: entry.sha256, target,
    payloadSha256: manifest.payload.sha256, inventoryDigest: manifest.inventoryDigest,
    files: entries.length };
}

export async function verifyRelease({ outputDir = path.join(ROOT, 'dist'), windowsLauncher,
  environment = process.env, targets = Object.keys(TARGETS), rebuild = true, sourceCommit } = {}) {
  const directory = path.resolve(outputDir);
  const release = await verifyReleaseChecksums({ outputDir: directory });
  if (rebuild && release.descriptor.sourceCommit !== (sourceCommit ??
      execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim())) {
    throw new Error('Release descriptor does not match the expected source revision');
  }
  const payload = payloadIdentity(await fs.readFile(path.join(directory, release.descriptor.payload.filename)));
  if (payload.manifest.version !== release.descriptor.version ||
      payload.manifest.inventoryDigest !== release.descriptor.payload.inventoryDigest) throw new Error('Release payload identity mismatch');
  const expectedArchives = new Set([payload.manifest.payload.filename, ...targets.map(target => {
    if (!TARGETS[target]) throw new Error(`Unsupported platform: ${target}`);
    return `${payload.manifest.name}-${payload.manifest.version}-${target}.${TARGETS[target].extension}`;
  })]);
  const actualArchives = release.descriptor.files.filter(file => file.kind === 'archive').map(file => file.filename);
  if (actualArchives.length !== expectedArchives.size || actualArchives.some(name => !expectedArchives.has(name))) {
    throw new Error('Missing, extra or wrong-platform release archives');
  }
  const results = [];
  for (const filename of actualArchives.filter(name => name !== payload.manifest.payload.filename)) {
    results.push(await verifyPlatformPackage({ artifact: path.join(directory, filename) }));
  }
  if (rebuild) {
    const scratch = path.join(ROOT, '.test-data', `verify-platforms-${randomUUID()}`);
    try {
      const fresh = await buildPackage({ outputDir: path.join(scratch, 'npm'), environment });
      if (fresh.sha256 !== payload.manifest.payload.sha256) throw new Error('npm payload does not match a fresh source build');
      const metadataFiles = release.descriptor.files.filter(file => file.kind !== 'archive')
        .map(file => ({ file: path.join(directory, file.filename), kind: file.kind }));
      const rebuilt = await buildPlatforms({ artifact: fresh.artifact, outputDir: path.join(scratch, 'release'),
        windowsLauncher, environment, targets, sourceCommit: release.descriptor.sourceCommit, metadataFiles });
      if (canonical(rebuilt.descriptor) !== canonical(release.descriptor) ||
          rebuilt.descriptorSha256 !== release.descriptorSha256 || rebuilt.checksumsSha256 !== release.checksumsSha256) {
        throw new Error('Independent platform rebuild does not match release evidence');
      }
    } finally { await fs.rm(scratch, { recursive: true, force: true }); }
  }
  return { verified: true, complete: targets.length === Object.keys(TARGETS).length,
    ...release, archives: results, rebuilt: rebuild };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const options = commandOptions(process.argv.slice(2));
  const result = options.artifact ? await verifyPlatformPackage(options) : await verifyRelease(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
