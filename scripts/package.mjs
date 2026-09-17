import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

async function sha256(file) {
  return createHash('sha256').update(await fs.readFile(file)).digest('hex');
}

async function packOnce(destination, environment) {
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
  const file = path.join(destination, result.filename);
  return { result, file, digest: await sha256(file) };
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
  const first = await packOnce(destination, environment);
  if (first.result.filename !== expectedFilename) {
    throw new Error(`Expected ${expectedFilename}, received ${first.result.filename}`);
  }

  const comparisonRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-sdlc-pack-'));
  try {
    const second = await packOnce(comparisonRoot, environment);
    if (second.result.filename !== expectedFilename || second.digest !== first.digest) {
      throw new Error('Repeated packaging did not produce the same artifact digest');
    }
  } finally {
    await fs.rm(comparisonRoot, { recursive: true, force: true });
  }

  const files = [...first.result.files]
    .map(file => ({ path: file.path, size: file.size }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const manifest = { schemaVersion: 1, name: pkg.name, version: pkg.version,
    filename: expectedFilename, sha256: first.digest,
    size: first.result.size, unpackedSize: first.result.unpackedSize, files };
  return { artifact: first.file, ...manifest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const outputIndex = process.argv.indexOf('--output-dir');
  const outputDir = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
  if (outputIndex >= 0 && !outputDir) throw new Error('--output-dir requires a path');
  process.stdout.write(`${JSON.stringify(await buildPackage({ outputDir }), null, 2)}\n`);
}
