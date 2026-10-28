import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readTarGzip, safePath, sha256, tarGzip } from '../packaging/standalone/archive.mjs';

const execute = promisify(execFile);
const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));

export function npmInvocation(args, {
  platform = process.platform,
  execPath = process.execPath,
  npmExecPath = process.env.npm_execpath,
} = {}) {
  if (npmExecPath?.endsWith('npm-cli.js')) {
    return { command: execPath, args: [npmExecPath, ...args] };
  }
  if (platform === 'win32') {
    const npmCli = path.win32.join(path.win32.dirname(execPath),
      'node_modules', 'npm', 'bin', 'npm-cli.js');
    return { command: execPath, args: [npmCli, ...args] };
  }
  return { command: 'npm', args };
}

// npm owns file selection and contents; Git, not host filesystem permissions,
// owns executable modes. Re-encode only metadata through the shared codec.
export function canonicalPackageArchive(bytes, { gitIndex, files }) {
  if (typeof gitIndex !== 'string' || !gitIndex.endsWith('\0')) {
    throw new Error('Package modes require a NUL-terminated Git index');
  }
  const indexed = new Map();
  for (const record of gitIndex.slice(0, -1).split('\0')) {
    const match = /^([0-7]{6}) ([a-f0-9]{40}|[a-f0-9]{64}) ([0-3])\t(.+)$/su.exec(record);
    if (!match || match[3] !== '0' || indexed.has(match[4])) {
      throw new Error('Package modes require unique, merged Git index entries');
    }
    indexed.set(match[4], match[1]);
  }
  if (!Array.isArray(files) || !files.length) throw new Error('npm pack must report its selected files');
  const selected = new Map();
  const names = new Set();
  for (const file of files) {
    const name = safePath(file.path);
    if (!Number.isSafeInteger(file.size) || file.size < 0 || names.has(name.toLowerCase())) {
      throw new Error(`Invalid or duplicate npm file selection: ${name}`);
    }
    names.add(name.toLowerCase());
    selected.set(name, file.size);
  }
  const entries = readTarGzip(bytes);
  if (entries.length !== selected.size) throw new Error('npm archive and reported file selection disagree');
  const canonicalEntries = entries.map(entry => {
    if (!entry.path.startsWith('package/')) throw new Error('npm archive entry is outside package/');
    const name = safePath(entry.path.slice('package/'.length));
    if (!selected.has(name) || selected.get(name) !== entry.data.length) {
      throw new Error(`npm archive and reported file selection disagree: ${name}`);
    }
    const mode = indexed.get(name);
    if (!['100644', '100755'].includes(mode)) {
      throw new Error(`Package file requires a regular tracked Git mode: ${name}`);
    }
    return { ...entry, mode: mode === '100755' ? 0o755 : 0o644 };
  });
  const archive = tarGzip(canonicalEntries);
  const inventory = canonicalEntries.map(entry => ({
    path: entry.path.slice('package/'.length), size: entry.data.length,
  })).sort((left, right) => left.path.localeCompare(right.path));
  return { bytes: archive, sha256: sha256(archive), size: archive.length,
    unpackedSize: inventory.reduce((total, file) => total + file.size, 0), files: inventory };
}

async function packOnce(destination, environment, expectedFilename, gitIndex) {
  await fs.mkdir(destination, { recursive: true });
  const invocation = npmInvocation(
    ['pack', '--json', '--ignore-scripts', '--pack-destination', destination],
    { npmExecPath: environment.npm_execpath });
  const { stdout } = await execute(invocation.command, invocation.args,
    { cwd: ROOT, env: environment, maxBuffer: 4 * 1024 * 1024 });
  const results = JSON.parse(stdout);
  if (!Array.isArray(results) || results.length !== 1) {
    throw new Error('npm pack must produce exactly one package');
  }
  const result = results[0];
  if (result.filename !== expectedFilename) {
    throw new Error(`Expected ${expectedFilename}, received ${result.filename}`);
  }
  const file = path.join(destination, result.filename);
  const { bytes, ...manifest } = canonicalPackageArchive(await fs.readFile(file),
    { gitIndex, files: result.files });
  if (result.unpackedSize !== manifest.unpackedSize) {
    throw new Error('npm archive and reported unpacked size disagree');
  }
  await fs.writeFile(file, bytes);
  return { file, ...manifest };
}

export async function buildPackage({
  outputDir = path.join(ROOT, 'dist'),
  environment = process.env,
} = {}) {
  const destination = path.resolve(outputDir);
  if (destination === ROOT) throw new Error('Package output directory cannot be the repository root');
  const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(pkg.name) ||
      !/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/u.test(pkg.version)) {
    throw new Error('Package name or version is not suitable for a distribution filename');
  }
  const expectedFilename = `${pkg.name}-${pkg.version}.tgz`;
  await fs.mkdir(destination, { recursive: true });
  const ownedNames = new Set([expectedFilename]);
  for (const entry of await fs.readdir(destination, { withFileTypes: true })) {
    if (!ownedNames.has(entry.name) || !entry.isFile()) {
      throw new Error('Package output directory must be empty or contain only owned distribution files');
    }
  }
  for (const name of ownedNames) {
    await fs.rm(path.join(destination, name), { force: true });
  }
  const { stdout: gitIndex } = await execute('git', ['ls-files', '--stage', '-z'],
    { cwd: ROOT, maxBuffer: 4 * 1024 * 1024 });
  const first = await packOnce(destination, environment, expectedFilename, gitIndex);

  const comparisonRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-sdlc-pack-'));
  try {
    const second = await packOnce(comparisonRoot, environment, expectedFilename, gitIndex);
    if (second.sha256 !== first.sha256) {
      throw new Error('Repeated packaging did not produce the same artifact digest');
    }
  } finally {
    await fs.rm(comparisonRoot, { recursive: true, force: true });
  }

  const manifest = { schemaVersion: 1, name: pkg.name, version: pkg.version,
    filename: expectedFilename, sha256: first.sha256,
    size: first.size, unpackedSize: first.unpackedSize, files: first.files };
  return { artifact: first.file, ...manifest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const outputIndex = process.argv.indexOf('--output-dir');
  const outputDir = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
  if (outputIndex >= 0 && !outputDir) throw new Error('--output-dir requires a path');
  process.stdout.write(`${JSON.stringify(await buildPackage({ outputDir }), null, 2)}\n`);
}
