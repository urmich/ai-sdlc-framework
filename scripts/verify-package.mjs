import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildPackage, npmInvocation } from './package.mjs';

const execute = promisify(execFile);
const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));

async function command(executable, args, options = {}) {
  return execute(executable, args, { maxBuffer: 4 * 1024 * 1024, ...options });
}

async function jsonCommand(executable, args, options) {
  const { stdout } = await command(executable, args, options);
  return JSON.parse(stdout);
}

export function packageInstallArguments(prefix, artifact) {
  return ['install', '--ignore-scripts', '--no-audit', '--no-fund',
    '--bin-links=false', '--prefix', prefix, artifact];
}

async function filesUnder(root, prefix = '') {
  const files = [];
  for (const entry of await fs.readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(root, relative));
    else if (entry.isFile()) {
      const stat = await fs.stat(path.join(root, relative));
      files.push({ path: relative.split(path.sep).join('/'),
        size: stat.size });
    } else {
      throw new Error(`Installed package contains unsupported entry: ${relative}`);
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

export async function verifyPackage({ artifact, environment = process.env } = {}) {
  const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const filename = `${pkg.name}-${pkg.version}.tgz`;
  const artifactFile = path.resolve(artifact ?? path.join(ROOT, 'dist', filename));
  if (path.basename(artifactFile) !== filename) {
    throw new Error(`Distribution filename must be ${filename}`);
  }
  const digest = createHash('sha256').update(await fs.readFile(artifactFile)).digest('hex');
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ai-sdlc-verify-')));
  try {
    const expected = await buildPackage({
      outputDir: path.join(root, 'expected package'),
      environment,
    });
    if (expected.filename !== filename || expected.sha256 !== digest) {
      throw new Error('Package identity or integrity does not match the current source');
    }
    const packageInstall = path.join(root, 'package install');
    const copilotHome = path.join(root, 'isolated copilot home');
    await fs.mkdir(copilotHome, { recursive: true });
    await fs.writeFile(path.join(copilotHome, 'copilot-instructions.md'),
      'Preserve isolated user instructions.\n');
    const runtimeFile = path.join(copilotHome, 'sdlc', 'runtime', 'package-verification.json');
    const runtimeContents = `${JSON.stringify({ retained: true, value: 'package-verification' })}\n`;
    await fs.mkdir(path.dirname(runtimeFile), { recursive: true });
    await fs.writeFile(runtimeFile, runtimeContents);
    const npm = npmInvocation(packageInstallArguments(packageInstall, artifactFile),
      { npmExecPath: environment.npm_execpath });
    await command(npm.command, npm.args, { cwd: ROOT, env: environment });
    const packageRoot = path.join(packageInstall, 'node_modules', pkg.name);
    const actualFiles = await filesUnder(packageRoot);
    const archiveSize = (await fs.stat(artifactFile)).size;
    const unpackedSize = actualFiles.reduce((total, file) => total + file.size, 0);
    if (expected.size !== archiveSize || expected.unpackedSize !== unpackedSize ||
        JSON.stringify(expected.files) !== JSON.stringify(actualFiles)) {
      throw new Error('Package sizes or file inventory do not match the current source');
    }
    const embedded = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
    if (embedded.name !== expected.name || embedded.version !== expected.version) {
      throw new Error('Embedded package identity does not match the current source');
    }
    for (const required of ['package.json', 'bin/sdlc.mjs', 'src/install.mjs',
      'src/provider-adapters.mjs', 'assets/instructions.md',
      'assets/lifecycle-intent.md', 'assets/hooks/sdlc.json', 'docs/cli.md',
      'docs/provider-adapters.md']) {
      if (!actualFiles.some(file => file.path === required)) {
        throw new Error(`Package archive is missing ${required}`);
      }
      await command(process.execPath, ['--input-type=module', '-e',
        "const adapters=await import('ai-sdlc-framework/provider-adapters');const monitors=await import('ai-sdlc-framework/monitors');const stores=await import('ai-sdlc-framework/store');if(typeof adapters.registerProviderAdapter!=='function'||typeof monitors.attachMonitor!=='function'||typeof stores.Store!=='function')throw new Error('Provider extension API is unavailable')"],
      { cwd: packageInstall, env: environment });
    }
    const entry = path.join(packageRoot, 'bin', 'sdlc.mjs');
    const installed = await jsonCommand(process.execPath,
      [entry, 'install', '--home', copilotHome], { cwd: packageRoot, env: environment });
    if (!installed.installed || !installed.changedFiles.length) {
      throw new Error('Isolated package installation did not materialize the framework');
    }
    const installedEntry = path.join(copilotHome, 'sdlc', 'bin', 'sdlc.mjs');
    const doctor = await jsonCommand(process.execPath,
      [installedEntry, 'doctor', '--home', copilotHome], { cwd: packageRoot, env: environment });
    if (!doctor.installed || doctor.frameworkVersion !== pkg.version || doctor.findings.length) {
      throw new Error('Installed package failed doctor verification');
    }
    const updated = await jsonCommand(process.execPath,
      [entry, 'update', '--home', copilotHome, '--source-root', packageRoot],
      { cwd: packageRoot, env: environment });
    if (updated.changedFiles.length !== 0) {
      throw new Error('Updating from the same package must be idempotent');
    }
    if (await fs.readFile(runtimeFile, 'utf8') !== runtimeContents) {
      throw new Error('Package update changed isolated runtime state');
    }
    const removed = await jsonCommand(process.execPath,
      [installedEntry, 'uninstall', '--home', copilotHome], { cwd: packageRoot, env: environment });
    if (!removed.uninstalled || removed.preserved.length) {
      throw new Error('Isolated package uninstall left owned content behind');
    }
    const after = await jsonCommand(process.execPath,
      [entry, 'doctor', '--home', copilotHome], { cwd: packageRoot, env: environment });
    const instructions = await fs.readFile(
      path.join(copilotHome, 'copilot-instructions.md'), 'utf8');
    if (after.installed || !instructions.includes('Preserve isolated user instructions.')) {
      throw new Error('Uninstall did not preserve isolated user content');
    }
    if (await fs.readFile(runtimeFile, 'utf8') !== runtimeContents) {
      throw new Error('Package uninstall changed isolated runtime state');
    }
    return { verified: true, filename, sha256: digest,
      packageFiles: expected.files.length, isolatedHome: true };
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const artifactIndex = process.argv.indexOf('--artifact');
  const artifact = artifactIndex >= 0 ? process.argv[artifactIndex + 1] : undefined;
  if (artifactIndex >= 0 && !artifact) throw new Error('--artifact requires a path');
  process.stdout.write(`${JSON.stringify(await verifyPackage({ artifact }), null, 2)}\n`);
}
