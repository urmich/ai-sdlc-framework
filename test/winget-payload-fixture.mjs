import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

export const fixtureSHA = bytes => createHash('sha256').update(bytes).digest('hex');
export function fixtureCanonical(value) {
  const sorted = item => Array.isArray(item) ? item.map(sorted) :
    item !== null && typeof item === 'object' ?
      Object.fromEntries(Object.keys(item).sort().map(key => [key, sorted(item[key])])) : item;
  return `${JSON.stringify(sorted(value))}\n`;
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
