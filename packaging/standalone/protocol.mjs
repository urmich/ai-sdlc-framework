import * as fs from 'node:fs/promises';
import path from 'node:path';
import { canonical, comparePath, inventory, readTarGzip, safePath, sha256 } from './archive.mjs';

export const TARGETS = Object.freeze({
  'windows-x64': { platform: 'win32', arch: 'x64', extension: 'zip' },
  'macos-x64': { platform: 'darwin', arch: 'x64', extension: 'tar.gz' },
  'macos-arm64': { platform: 'darwin', arch: 'arm64', extension: 'tar.gz' },
  'linux-x64': { platform: 'linux', arch: 'x64', extension: 'tar.gz' },
});
export const DIGEST = /^[a-f0-9]{64}$/u;

export function isPrerelease(version) {
  const match = typeof version === 'string' &&
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.exec(version);
  if (!match || match[4]?.split('.').some(part => /^0\d+$/u.test(part))) {
    throw new Error('Release version must be valid SemVer');
  }
  return match[4] !== undefined;
}

export function parseCanonical(bytes, label) {
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch {
    throw new Error(`Malformed ${label}`);
  }
  if (canonical(value) !== bytes.toString('utf8')) throw new Error(`Noncanonical ${label}`);
  return value;
}

export function payloadIdentity(bytes) {
  const entries = readTarGzip(bytes);
  const files = inventory(entries, 'package/');
  const metadata = entries.find(entry => entry.path === 'package/package.json');
  if (!metadata) throw new Error('Payload is missing package.json');
  const pkg = JSON.parse(metadata.data.toString('utf8'));
  isPrerelease(pkg.version);
  if (pkg.name !== 'ai-sdlc-framework' ||
      pkg.engines?.node !== '>=22' || pkg.dependencies && Object.keys(pkg.dependencies).length) {
    throw new Error('Unsupported payload identity or runtime requirements');
  }
  for (const required of ['LICENSE', 'bin/sdlc.mjs', 'src/install.mjs',
    'packaging/standalone/runtime.mjs', 'packaging/standalone/install.sh',
    'packaging/standalone/install.ps1', 'packaging/standalone/sdlc']) {
    if (!files.some(file => file.path === required)) throw new Error(`Payload is missing ${required}`);
  }
  const manifest = { schemaVersion: 1, name: pkg.name, version: pkg.version,
    payload: { filename: `${pkg.name}-${pkg.version}.tgz`, sha256: sha256(bytes) },
    inventoryDigest: sha256(canonical(files)), inventory: files };
  return { entries, manifest };
}

export function validateWindowsLauncher(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 256 || bytes.toString('ascii', 0, 2) !== 'MZ') {
    throw new Error('Windows x64 native launcher is required (not a placeholder)');
  }
  const pe = bytes.readUInt32LE(60);
  if (pe + 26 > bytes.length || bytes.readUInt32LE(pe) !== 0x00004550 ||
      bytes.readUInt16LE(pe + 4) !== 0x8664 || bytes.readUInt16LE(pe + 24) !== 0x20b) {
    throw new Error('Windows launcher must be a PE32+ x64 executable');
  }
}

export function platformEntries(payloadBytes, target, windowsLauncher) {
  const spec = TARGETS[target];
  if (!spec) throw new Error(`Unsupported platform: ${target}`);
  const { entries, manifest } = payloadIdentity(payloadBytes);
  const fromPayload = relative => entries.find(entry => entry.path === `package/${relative}`).data;
  const textFromPayload = relative => fromPayload(relative).toString('utf8').replace(/\r\n?/gu, '\n');
  const wrapper = (name, data, mode = 0o644) => ({ path: name,
    data: Buffer.isBuffer(data) ? data : Buffer.from(data), mode });
  const platform = { schemaVersion: 1, name: manifest.name, version: manifest.version,
    platform: spec.platform, arch: spec.arch, payloadSha256: manifest.payload.sha256,
    inventoryDigest: manifest.inventoryDigest, payloadManifest: 'payload-manifest.json',
    checksumReference: 'SHA256SUMS' };
  const launchers = [];
  if (spec.platform === 'win32') {
    validateWindowsLauncher(windowsLauncher);
    platform.launcherSha256 = sha256(windowsLauncher);
    launchers.push(wrapper('bin/sdlc.exe', windowsLauncher),
      wrapper('install.ps1', textFromPayload('packaging/standalone/install.ps1').replace(/\n/gu, '\r\n')));
  } else {
    launchers.push(wrapper('bin/sdlc', textFromPayload('packaging/standalone/sdlc'), 0o755),
      wrapper('install.sh', textFromPayload('packaging/standalone/install.sh'), 0o755));
  }
  return { manifest, platform, entries: [...entries, ...launchers,
    wrapper(manifest.payload.filename, payloadBytes),
    wrapper('payload-manifest.json', canonical(manifest)),
    wrapper('platform.json', canonical(platform)), wrapper('LICENSE', fromPayload('LICENSE'))] };
}

export function verifyEntries(entries, { expectedPlatform, expectedArch } = {}) {
  const get = name => {
    const found = entries.find(entry => entry.path === name);
    if (!found) throw new Error(`Distribution is missing ${name}`);
    return found.data;
  };
  const manifest = parseCanonical(get('payload-manifest.json'), 'payload manifest');
  if (manifest.schemaVersion !== 1 || !DIGEST.test(manifest.payload?.sha256 ?? '') ||
      !DIGEST.test(manifest.inventoryDigest ?? '')) throw new Error('Malformed payload manifest');
  safePath(manifest.payload.filename);
  const platform = parseCanonical(get('platform.json'), 'platform metadata');
  const target = Object.keys(TARGETS).find(key =>
    TARGETS[key].platform === platform.platform && TARGETS[key].arch === platform.arch);
  if (!target || expectedPlatform && expectedPlatform !== platform.platform ||
      expectedArch && expectedArch !== platform.arch) throw new Error('Wrong platform or architecture');
  const expected = platformEntries(get(manifest.payload.filename), target,
    platform.platform === 'win32' ? get('bin/sdlc.exe') : undefined);
  if (canonical(expected.manifest) !== canonical(manifest) ||
      canonical(expected.platform) !== canonical(platform) ||
      canonical(inventory(entries)) !== canonical(inventory(expected.entries))) {
    throw new Error('Distribution payload, wrapper inventory or checksum mismatch');
  }
  return { ...expected, target };
}

export async function treeEntries(root, prefix = '') {
  const directory = path.join(root, prefix);
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Distribution directory is not a literal directory');
  const entries = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    safePath(relative);
    if (entry.isDirectory()) {
      const nested = await treeEntries(root, relative);
      if (!nested.length) throw new Error(`Unlisted empty distribution directory: ${relative}`);
      entries.push(...nested);
    }
    else if (entry.isFile()) {
      const current = await fs.lstat(path.join(root, relative));
      if (!current.isFile() || current.isSymbolicLink()) throw new Error('Distribution entry changed type');
      entries.push({ path: relative, data: await fs.readFile(path.join(root, relative)),
        mode: process.platform === 'win32' ? relative === 'package/bin/sdlc.mjs' ? 0o755 : 0o644 :
          current.mode & 0o777 });
    } else throw new Error(`Unsupported distribution entry: ${relative}`);
  }
  return entries.sort((a, b) => comparePath(a.path, b.path));
}

export async function verifyTree(root, expectations = {}) {
  const entries = await treeEntries(root);
  // Windows filesystems do not preserve POSIX permission bits.
  if (process.platform === 'win32') {
    const manifestFile = entries.find(entry => entry.path === 'payload-manifest.json');
    if (!manifestFile) throw new Error('Distribution is missing payload-manifest.json');
    const manifest = parseCanonical(manifestFile.data, 'payload manifest');
    for (const entry of entries) {
      const file = manifest.inventory?.find(item => `package/${item.path}` === entry.path);
      if (file) entry.mode = parseInt(file.mode, 8);
    }
  }
  return verifyEntries(entries, expectations);
}

export async function extractEntries(entries, root) {
  for (const entry of entries) {
    safePath(entry.path);
    const file = path.join(root, entry.path);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, entry.data, { flag: 'wx', mode: entry.mode });
    await fs.chmod(file, entry.mode);
  }
}
