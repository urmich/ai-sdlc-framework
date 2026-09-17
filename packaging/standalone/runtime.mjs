import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { canonical } from './archive.mjs';
import { extractEntries, verifyTree } from './protocol.mjs';
import { canonicalPath, within } from '../../src/files.mjs';
import { parseArguments } from '../../src/cli.mjs';
import { Store } from '../../src/store.mjs';
import { withinNativePath } from '../../src/platform.mjs';

const exists = async file => {
  try { return await fs.lstat(file); } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
};

export async function runtimePreflight({ node = process.execPath, platform = process.platform,
  arch = process.arch } = {}) {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('AI SDLC requires Node.js 22+');
  if (!path.isAbsolute(node) || await fs.realpath(node) !== await fs.realpath(process.execPath)) {
    throw new Error('Selected Node.js runtime changed or is shadowed');
  }
  const stat = await fs.stat(node);
  if (!stat.isFile()) throw new Error('Node.js is not an executable file');
  await fs.access(node, fs.constants.X_OK);
  if (platform !== process.platform || arch !== process.arch) throw new Error('Node.js runtime has the wrong platform or architecture');
  const machine = os.machine().toLowerCase();
  const nativeArch = { x86_64: 'x64', amd64: 'x64', arm64: 'arm64', aarch64: 'arm64' }[machine];
  if (nativeArch !== arch) throw new Error('Node.js must run on the native host architecture');
  if (platform === 'darwin') {
    const translated = spawnSync('/usr/sbin/sysctl', ['-in', 'sysctl.proc_translated'], { encoding: 'utf8' });
    if (translated.status === 0 && translated.stdout.trim() === '1') throw new Error('Rosetta cannot satisfy native runtime requirements');
  }
  return await fs.realpath(node);
}

async function literalDirectory(directory, { create = false } = {}) {
  const resolved = path.resolve(directory);
  const parts = resolved.slice(path.parse(resolved).root.length).split(path.sep).filter(Boolean);
  let current = path.parse(resolved).root;
  for (const part of parts) {
    current = path.join(current, part);
    if (create) {
      try { await fs.mkdir(current); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Channel path is not a literal directory: ${current}`);
  }
  return resolved;
}

async function acquireLock(root, timeout) {
  const lock = path.join(root, '.channel-lock');
  const start = Date.now();
  for (;;) {
    try {
      await fs.mkdir(lock);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() - start >= timeout) {
        throw new Error('Channel is busy; lock timeout. Retain the prior version; remove a stale .channel-lock only after confirming no installer is running.');
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  try {
    await fs.writeFile(path.join(lock, 'owner.json'), canonical({ pid: process.pid, token: randomUUID() }), { flag: 'wx' });
  } catch (error) {
    await fs.rm(lock, { recursive: true, force: true });
    throw error;
  }
  return async () => fs.rm(lock, { recursive: true, force: true });
}

function defaultRoot() {
  if (process.platform === 'win32') {
    if (!process.env.LOCALAPPDATA || !path.isAbsolute(process.env.LOCALAPPDATA)) {
      throw new Error('LOCALAPPDATA must identify an absolute user-owned directory');
    }
    return path.join(process.env.LOCALAPPDATA, 'ai-sdlc-framework');
  }
  return path.join(os.homedir(), '.local', 'share', 'ai-sdlc-framework');
}

async function canonicalLayoutPath(file, links = 0) {
  if (links > 32) throw new Error('Channel/home symlink chain is too deep');
  const absolute = path.resolve(file);
  const parent = path.dirname(absolute);
  if (parent === absolute) return canonicalPath(absolute);
  const candidate = path.join(await canonicalLayoutPath(parent, links), path.basename(absolute));
  const stat = await exists(candidate);
  if (stat?.isSymbolicLink()) {
    return canonicalLayoutPath(path.resolve(path.dirname(candidate), await fs.readlink(candidate)), links + 1);
  }
  return stat ? canonicalPath(candidate) : candidate;
}

export function layoutPathsOverlap(channel, home, platform = process.platform) {
  // Uncreated suffixes cannot be realpathed; conservatively protect case-insensitive destinations.
  const comparable = value => ['win32', 'darwin'].includes(platform) ? value.toLowerCase() : value;
  return withinNativePath(comparable(channel), comparable(home), platform) ||
    withinNativePath(comparable(home), comparable(channel), platform);
}

export async function validateChannelHome({ channelRoot = defaultRoot(), home } = {}) {
  const channel = await canonicalLayoutPath(channelRoot);
  const copilot = await canonicalLayoutPath(new Store(home).home);
  if (layoutPathsOverlap(channel, copilot)) {
    throw new Error('Channel root and Copilot home must be separate, non-overlapping directories');
  }
  return { channelRoot: channel, home: copilot };
}

function bindHome(args, home) {
  const index = args.indexOf('--home');
  if (index < 0) args.push('--home', home);
  else args[index + 1] = home;
}

function windowsCurrent(version) {
  return `# ai-sdlc-framework standalone current v1\r\n` +
    `$ErrorActionPreference = 'Stop'\r\n` +
    `& (Join-Path $PSScriptRoot 'versions/${version}/bin/sdlc.exe') @args\r\n` +
    `exit $LASTEXITCODE\r\n`;
}

async function cleanAbandonedStages(root) {
  const reserved = /^\.(?:staging|current)-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
  const abandoned = (await fs.readdir(root)).filter(name => reserved.test(name));
  if (abandoned.length > 32) throw new Error('Too many abandoned channel stages; inspect channel ownership before manual cleanup');
  for (const name of abandoned) {
    const file = path.join(root, name);
    const stat = await fs.lstat(file);
    if (name.startsWith('.staging-') && (!stat.isDirectory() || stat.isSymbolicLink())) {
      throw new Error('Abandoned stage is not an owned literal directory');
    }
    await fs.rm(file, { recursive: name.startsWith('.staging-'), force: true });
  }
}

export async function activateChannel({ sourceRoot, channelRoot = defaultRoot(),
  home, node = process.execPath, lockTimeoutMs = 5000, beforeStep = async () => {} }) {
  if (!Number.isInteger(lockTimeoutMs) || lockTimeoutMs < 0 || lockTimeoutMs > 30000) {
    throw new Error('Channel lock timeout must be between 0 and 30000ms');
  }
  // All bytes and the exact runtime are checked before creating even the channel root.
  const verified = await verifyTree(sourceRoot, { expectedPlatform: process.platform, expectedArch: process.arch });
  const selectedNode = await runtimePreflight({ node,
    platform: verified.platform.platform, arch: verified.platform.arch });
  const root = path.resolve(channelRoot);
  const layout = await validateChannelHome({ channelRoot, home });
  const source = await canonicalPath(sourceRoot);
  if (within(layout.channelRoot, source) || within(source, layout.channelRoot)) {
    throw new Error('Channel root must be separate from the downloaded distribution');
  }
  await literalDirectory(root, { create: true });
  const release = await acquireLock(root, lockTimeoutMs);
  let staging;
  let promotion;
  try {
    const marker = path.join(root, 'channel.json');
    const markerBytes = canonical({ schemaVersion: 1, name: verified.manifest.name });
    if (await exists(marker)) {
      const stat = await fs.lstat(marker);
      if (!stat.isFile() || stat.isSymbolicLink() || await fs.readFile(marker, 'utf8') !== markerBytes) {
        throw new Error('Channel ownership marker does not match');
      }
    } else {
      const names = await fs.readdir(root);
      if (names.some(name => name !== '.channel-lock')) throw new Error('Refusing to adopt an unowned channel directory');
      await fs.writeFile(marker, markerBytes, { flag: 'wx' });
    }
    await cleanAbandonedStages(root);
    const versions = await literalDirectory(path.join(root, 'versions'), { create: true });
    const versionRoot = path.join(versions, verified.manifest.version);
    if (await exists(versionRoot)) {
      const existing = await verifyTree(versionRoot, { expectedPlatform: process.platform, expectedArch: process.arch });
      if (canonical(existing.manifest) !== canonical(verified.manifest) ||
          canonical(existing.platform) !== canonical(verified.platform)) {
        throw new Error('Immutable channel version has a conflicting digest');
      }
    } else {
      staging = path.join(root, `.staging-${randomUUID()}`);
      await fs.mkdir(staging);
      await beforeStep('copy');
      await extractEntries(verified.entries, staging);
      await beforeStep('verify-staging');
      await verifyTree(staging, { expectedPlatform: process.platform, expectedArch: process.arch });
      await beforeStep('activate-version');
      await fs.rename(staging, versionRoot);
      staging = undefined;
    }
    const current = path.join(root, process.platform === 'win32' ? 'current.ps1' : 'current');
    const old = await exists(current);
    if (old) {
      if (process.platform === 'win32') {
        if (!old.isFile() || old.isSymbolicLink()) throw new Error('Current launcher is not channel-owned');
        const content = await fs.readFile(current, 'utf8');
        const version = /'versions\/([0-9A-Za-z.+-]+)\/bin\/sdlc\.exe'/u.exec(content)?.[1];
        if (!version || content !== windowsCurrent(version)) {
          throw new Error('Current launcher is not channel-owned');
        }
      } else if (!old.isSymbolicLink() || !/^versions\/[0-9A-Za-z.+-]+$/u.test(await fs.readlink(current))) {
        throw new Error('Current launcher is not channel-owned');
      }
    }
    promotion = path.join(root, `.current-${randomUUID()}`);
    if (process.platform === 'win32') {
      await fs.writeFile(promotion, windowsCurrent(verified.manifest.version), { flag: 'wx' });
    } else {
      await fs.symlink(`versions/${verified.manifest.version}`, promotion);
    }
    await beforeStep('promote-current');
    await fs.rename(promotion, current);
    promotion = undefined;
    return { activated: true, version: verified.manifest.version,
      payloadSha256: verified.manifest.payload.sha256, channelRoot: root, node: selectedNode,
      launcher: path.join(versionRoot, 'bin', process.platform === 'win32' ? 'sdlc.exe' : 'sdlc'),
      current, restartRequired: true };
  } finally {
    try {
      if (staging) await fs.rm(staging, { recursive: true, force: true });
      if (promotion) await fs.rm(promotion, { force: true });
    } finally {
      await release();
    }
  }
}

export function invokeFramework(root, node, args) {
  const entry = path.join(root, 'package', 'bin', 'sdlc.mjs');
  const result = spawnSync(node, [entry, ...args], { stdio: 'inherit', env: { ...process.env, SDLC_NODE: node } });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

export async function main(argv) {
  const [operation, ...input] = argv;
  const separator = input.indexOf('--');
  if (separator < 0) throw new Error('Expected runtime options followed by --');
  const options = input.slice(0, separator);
  if (options.length !== 4 || options[0] !== '--root' || options[2] !== '--node') {
    throw new Error('Expected --root and --node runtime options');
  }
  const root = await fs.realpath(options[1]);
  const node = await runtimePreflight({ node: options[3] });
  const args = input.slice(separator + 1);
  if (operation === 'launch') {
    await verifyTree(root, { expectedPlatform: process.platform, expectedArch: process.arch });
    const { flags } = parseArguments(args);
    const parent = path.dirname(root);
    const managedRoot = path.basename(parent) === 'versions' &&
      await exists(path.join(path.dirname(parent), 'channel.json')) ? path.dirname(parent) : root;
    const layout = await validateChannelHome({ channelRoot: managedRoot, home: flags.home });
    bindHome(args, layout.home);
    return invokeFramework(root, node, args);
  }
  if (operation !== 'install-channel') throw new Error('Unsupported distribution runtime operation');
  let channelRoot;
  let channelOnly = false;
  for (let index = 0; index < args.length;) {
    if (args[index] === '--channel-root') {
      if (!args[index + 1] || channelRoot) throw new Error('--channel-root requires one path');
      channelRoot = args[index + 1];
      args.splice(index, 2);
    } else if (args[index] === '--channel-only') {
      channelOnly = true;
      args.splice(index, 1);
    } else index++;
  }
  if (!args.length || args[0].startsWith('--')) args.unshift('install');
  if (!['install', 'update', 'doctor', 'uninstall'].includes(args[0])) {
    throw new Error('Standalone installer accepts install, update, doctor, or uninstall');
  }
  if (args.includes('--source-root')) throw new Error('Standalone source-root cannot be overridden');
  if (args[0] !== 'install' && args.includes('--purge-existing') ||
      args[0] !== 'uninstall' && args.includes('--purge')) throw new Error('Invalid purge operation');
  const { flags } = parseArguments(args);
  const layout = await validateChannelHome({ channelRoot, home: flags.home });
  bindHome(args, layout.home);
  await verifyTree(root, { expectedPlatform: process.platform, expectedArch: process.arch });
  if (['doctor', 'uninstall'].includes(args[0])) {
    if (channelOnly) throw new Error('--channel-only applies only to install/update');
    return invokeFramework(root, node, args);
  }
  const activation = await activateChannel({ sourceRoot: root, channelRoot, home: layout.home, node });
  if (channelOnly) {
    process.stdout.write(`${JSON.stringify(activation)}\n`);
    return 0;
  }
  // Never resolve "sdlc" through PATH, and never hold the channel lock during framework maintenance.
  const result = spawnSync(activation.launcher, args, {
    stdio: 'inherit', env: { ...process.env, SDLC_NODE: node },
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await main(process.argv.slice(2)); } catch (error) {
    process.stderr.write(`Standalone installation failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
