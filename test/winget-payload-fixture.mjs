import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { buildLauncher } from '../packaging/winget/build-launcher.mjs';
import { validateWindowsLauncher } from '../packaging/standalone/protocol.mjs';
import { sameNativePath } from '../src/platform.mjs';
import { readBytes } from '../src/files.mjs';

export const fixtureSHA = bytes => createHash('sha256').update(bytes).digest('hex');
export function fixtureCanonical(value) {
  const sorted = item => Array.isArray(item) ? item.map(sorted) :
    item !== null && typeof item === 'object' ?
      Object.fromEntries(Object.keys(item).sort().map(key => [key, sorted(item[key])])) : item;
  return `${JSON.stringify(sorted(value))}\n`;
}

export async function fixtureWindowsLauncher({
  outputDir, goCommand, environment = process.env,
}) {
  if (environment.SDLC_WINDOWS_LAUNCHER === undefined) {
    return buildLauncher({ outputDir, goCommand, environment });
  }
  const source = environment.SDLC_RELEASE_SOURCE_COMMIT;
  const expected = environment.SDLC_WINDOWS_LAUNCHER_SHA256;
  const context = JSON.parse(environment.SDLC_WINDOWS_LAUNCHER_CONTEXT ?? 'null');
  if (!/^[a-f0-9]{40}$/u.test(source ?? '') ||
      !/^[a-f0-9]{64}$/u.test(expected ?? '') ||
      !Array.isArray(context?.sources) || !context.sources.length) {
    throw new Error('Frozen launcher fixture requires its source-bound native context and expected byte digest');
  }
  if (!context.sources.every(item => item?.revision === source)) {
    throw new Error('Frozen launcher fixture source differs from the current native source');
  }
  const root = fileURLToPath(new URL('../', import.meta.url));
  const owned = file => {
    const relative = path.relative(root, file);
    return relative.split(path.sep)[0] === '.test-data' &&
      !relative.split(path.sep).includes('..') && !path.isAbsolute(relative);
  };
  const input = environment.SDLC_WINDOWS_LAUNCHER;
  const destination = path.resolve(outputDir);
  if (typeof input !== 'string' || !path.isAbsolute(input) || !owned(input) || !owned(destination)) {
    throw new Error('Frozen launcher fixture must use owned repository-local files');
  }
  const stat = await fs.lstat(input);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024 * 1024 ||
      !sameNativePath(await fs.realpath(input), input) ||
      !sameNativePath(await fs.realpath(path.dirname(destination)), path.dirname(destination))) {
    throw new Error('Frozen launcher fixture must be a regular owned repository-local file');
  }
  const bytes = await readBytes(input, 128 * 1024 * 1024);
  if (fixtureSHA(bytes) !== expected) {
    throw new Error('Frozen launcher fixture bytes differ from their verified source digest');
  }
  validateWindowsLauncher(bytes);
  await fs.mkdir(destination);
  const artifact = path.join(destination, 'sdlc.exe');
  await fs.writeFile(artifact, bytes, { flag: 'wx', mode: 0o644 });
  return { artifact, filename: 'sdlc.exe', sha256: expected, size: bytes.length };
}

// Test-only USTAR fixtures keep launcher tests independent of the shared packager.
function tarFixture(files) {
  const blocks = [];
  for (const file of files) {
    const header = Buffer.alloc(512);
    const octal = (value, width) => `${value.toString(8).padStart(width - 1, '0')}\0`;
    header.write(`package/${file.path}`, 0, 100);
    header.write(octal(file.mode, 8), 100);
    header.write(octal(0, 8), 108);
    header.write(octal(0, 8), 116);
    header.write(octal(file.data.length, 12), 124);
    header.write(octal(0, 12), 136);
    header.fill(32, 148, 156);
    header[156] = 48;
    header.write('ustar\0', 257);
    header.write('00', 263);
    header.write(`${header.reduce((sum, value) => sum + value, 0).toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(header, file.data, Buffer.alloc((512 - file.data.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}

export async function writePayloadFixture(root, entryCode) {
  const sources = {
    LICENSE: 'MIT fixture license\n',
    'bin/sdlc.mjs': entryCode,
    'package.json': JSON.stringify({ name: 'ai-sdlc-framework', version: '0.3.0', engines: { node: '>=22' } }),
    'packaging/standalone/install.ps1': '# fixture\n',
    'packaging/standalone/install.sh': '#!/bin/sh\n',
    'packaging/standalone/runtime.mjs': '// Integrity must never execute this JS verifier.\n',
    'packaging/standalone/sdlc': '#!/bin/sh\n',
    'src/install.mjs': '// fixture\n',
  };
  const files = Object.keys(sources).sort().map(relative => ({
    path: relative, data: Buffer.from(sources[relative]), mode: relative === 'bin/sdlc.mjs' ? 0o755 : 0o644,
  }));
  for (const file of files) {
    const destination = path.join(root, 'package', file.path);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, file.data);
    await fs.chmod(destination, file.mode);
  }
  const payload = tarFixture(files);
  const inventory = files.map(file => ({ path: file.path, type: 'file', size: file.data.length,
    sha256: fixtureSHA(file.data), mode: file.mode === 0o755 ? '0755' : '0644' }));
  const manifest = { schemaVersion: 1, name: 'ai-sdlc-framework', version: '0.3.0',
    payload: { filename: 'ai-sdlc-framework-0.3.0.tgz', sha256: fixtureSHA(payload) },
    inventoryDigest: fixtureSHA(fixtureCanonical(inventory)), inventory };
  const platform = { schemaVersion: 1, name: manifest.name, version: manifest.version,
    platform: process.platform, arch: process.arch, payloadSha256: manifest.payload.sha256,
    inventoryDigest: manifest.inventoryDigest, payloadManifest: 'payload-manifest.json',
    checksumReference: 'SHA256SUMS', launcherSha256: fixtureSHA(await fs.readFile(path.join(root, 'bin', 'sdlc.exe'))) };
  await fs.writeFile(path.join(root, manifest.payload.filename), payload);
  await fs.writeFile(path.join(root, 'payload-manifest.json'), fixtureCanonical(manifest));
  await fs.writeFile(path.join(root, 'platform.json'), fixtureCanonical(platform));
  return { manifest, platform };
}
