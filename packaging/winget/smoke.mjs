import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { generateManifests, manifestContext, TEST_PACKAGE_IDENTIFIER, verifyArchive } from './generate.mjs';
import { validateManifests } from './validate.mjs';

const execute = promisify(execFile);
const NO_APPLICATIONS_FOUND = 0x8a150014;

export function isNewerVersion(previous, next) {
  const parts = value => {
    const [core, ...suffix] = value.split('+')[0].split('-');
    return { core: core.split('.').map(BigInt), prerelease: suffix.length ? suffix.join('-').split('.') : null };
  };
  const before = parts(previous);
  const after = parts(next);
  for (let index = 0; index < 3; index++) {
    if (before.core[index] !== after.core[index]) return after.core[index] > before.core[index];
  }
  if (!before.prerelease || !after.prerelease) return !!before.prerelease && !after.prerelease;
  for (let index = 0; index < Math.max(before.prerelease.length, after.prerelease.length); index++) {
    const left = before.prerelease[index];
    const right = after.prerelease[index];
    if (left === right) continue;
    if (left === undefined || right === undefined) return left === undefined;
    const leftNumber = /^[0-9]+$/u.test(left);
    const rightNumber = /^[0-9]+$/u.test(right);
    if (leftNumber && rightNumber) return BigInt(right) > BigInt(left);
    if (leftNumber !== rightNumber) return leftNumber;
    return right > left;
  }
  return false;
}

export function requireNativeWindows(environment = process.env) {
  if (process.platform !== 'win32' || process.arch !== 'x64' ||
      (environment.PROCESSOR_ARCHITEW6432 || environment.PROCESSOR_ARCHITECTURE)?.toUpperCase() !== 'AMD64') {
    throw Object.assign(new Error('WinGet smoke requires a native Windows x64 host, not emulation'),
      { blocked: true });
  }
}

async function snapshot(directory) {
  const files = [];
  async function visit(current) {
    for (const entry of (await fs.readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(current, entry.name);
      const relative = path.relative(directory, file).split(path.sep).join('/');
      if (entry.isDirectory()) {
        files.push([relative, 'directory']);
        await visit(file);
      } else {
        assert.ok(entry.isFile(), `Unexpected non-regular Copilot-home entry: ${relative}`);
        files.push([relative, createHash('sha256').update(await fs.readFile(file)).digest('hex')]);
      }
    }
  }
  await visit(directory);
  return files;
}

async function exists(file) {
  try { await fs.lstat(file); return true; } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export function requireHealthyDoctor(doctor, version, phase) {
  assert.equal(doctor.installed, true, `${phase}: framework must remain installed`);
  assert.equal(doctor.frameworkVersion, version, `${phase}: framework version must match`);
  assert.deepEqual(doctor.findings, [], `${phase}: doctor findings must be empty`);
}

export async function verifyRetainedFramework({ home, version, removedRoot, workspace, environment = process.env }) {
  const entry = path.join(home, 'sdlc', 'bin', 'sdlc.mjs');
  const hooks = JSON.parse(await fs.readFile(path.join(home, 'hooks', 'sdlc.json'), 'utf8'));
  const retainedNode = await fs.realpath(process.execPath);
  const relativeNode = path.relative(path.resolve(removedRoot), retainedNode);
  assert.ok(relativeNode.startsWith(`..${path.sep}`) || relativeNode === '..' || path.isAbsolute(relativeNode),
    'Hook runtime must be independent of the removed channel');
  assert.equal(await exists(path.join(removedRoot, 'bin', 'sdlc.exe')), false, 'Channel launcher must already be removed');
  assert.equal(hooks.version, 1);
  const handlers = Object.values(hooks.hooks).flat();
  assert.ok(handlers.length > 0, 'Installed hook commands are required');
  for (const handler of handlers) {
    assert.equal(handler.type, 'command');
    assert.ok(path.isAbsolute(handler.exec), 'Installed hooks must select an absolute runtime');
    assert.equal(await fs.realpath(handler.exec), retainedNode);
    assert.ok(Array.isArray(handler.args) && handler.args.every(value => typeof value === 'string'));
    assert.equal(handler.args[0], entry, 'Hook must invoke the retained installed entrypoint');
  }
  const handler = hooks.hooks.sessionStart?.[0];
  assert.ok(handler, 'Installed sessionStart hook is required');
  assert.deepEqual(handler.args, [entry, 'hook', 'sessionStart', '--home', home],
    'Post-removal evidence must execute the installed sessionStart command for this isolated home');
  const inputFile = path.join(workspace, `post-removal-hook-${randomUUID()}.json`);
  await fs.writeFile(inputFile, JSON.stringify({ sessionId: 'winget-retained-runtime', cwd: workspace }), { flag: 'wx' });
  const env = { ...environment, COPILOT_HOME: home, SDLC_NODE: retainedNode };
  try {
    const hook = await execute(handler.exec, [...handler.args, '--input-file', inputFile], { env, timeout: 120_000 });
    assert.equal(hook.stderr, '', 'Installed hook must not report errors');
    assert.match(JSON.parse(hook.stdout).additionalContext, /AI SDLC lifecycle/u,
      'The actual installed hook must execute successfully after channel removal');
    const { stdout } = await execute(handler.exec, [entry, 'doctor', '--home', home], { env, timeout: 120_000 });
    requireHealthyDoctor(JSON.parse(stdout), version, 'after channel removal');
    return { hook: 'Passed', doctor: 'Passed' };
  } catch (error) {
    error.frameworkFailure = true;
    throw error;
  } finally {
    await fs.unlink(inputFile);
  }
}

export async function smokeWinGet({ input, upgradeInput, wingetCommand = 'winget' }) {
  requireNativeWindows();
  assert.ok(input?.archivePath && upgradeInput?.archivePath, 'Two verified archive inputs are required for a real upgrade');
  for (const candidate of [input, upgradeInput]) {
    manifestContext({ ...candidate, testOnly: true,
      candidateUrl: `http://127.0.0.1:1/${encodeURIComponent(candidate.archive?.filename)}` });
  }
  assert.ok(isNewerVersion(input.version, upgradeInput.version), 'Upgrade evidence requires an increasing package version');
  assert.ok(process.env.LOCALAPPDATA, 'LOCALAPPDATA is required');
  const alias = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'sdlc-test.exe');
  assert.equal(await exists(alias), false, 'Refusing to replace an existing WinGet test alias');
  const environment = { ...process.env, SDLC_NODE: await fs.realpath(process.execPath) };
  const winget = async args => {
    try {
      return await execute(wingetCommand, args,
        { env: environment, maxBuffer: 8 * 1024 * 1024, timeout: 300_000 });
    } catch (error) {
      error.blocked = true;
      throw error;
    }
  };
  try {
    await winget(['list', '--id', TEST_PACKAGE_IDENTIFIER, '--exact', '--disable-interactivity', '--accept-source-agreements']);
    throw new Error('Refusing to modify an existing WinGet test package');
  } catch (error) {
    if ((Number(error.code) >>> 0) !== NO_APPLICATIONS_FOUND) throw error;
  }

  const root = path.resolve('.test-data', `winget native ${randomUUID()}`);
  const home = path.join(root, 'Copilot home with spaces');
  environment.COPILOT_HOME = home;
  const installRoot = path.join(root, 'portable payload with spaces');
  const launcher = path.join(installRoot, 'bin', 'sdlc.exe');
  const served = new Map();
  const server = createServer((request, response) => {
    const bytes = served.get(request.url);
    if (!bytes || !['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': bytes.length });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  });
  let installationAttempted = false;
  const uninstall = () => winget(['uninstall', '--id', TEST_PACKAGE_IDENTIFIER, '--exact',
    '--scope', 'user', '--disable-interactivity', '--accept-source-agreements']);
  try {
    await fs.mkdir(home, { recursive: true });
    await fs.writeFile(path.join(home, 'unrelated.txt'), 'Preserve unrelated content.\n');
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const initial = await snapshot(home);
    const evidence = [];
    for (const [index, candidate] of [input, upgradeInput].entries()) {
      const candidateUrl = `http://127.0.0.1:${server.address().port}/${encodeURIComponent(candidate.archive.filename)}`;
      const options = { ...candidate, testOnly: true, candidateUrl };
      await verifyArchive(candidate.archivePath, options);
      served.set(`/${encodeURIComponent(candidate.archive.filename)}`, await fs.readFile(candidate.archivePath));
      const response = await fetch(candidateUrl);
      assert.ok(response.ok, 'Local candidate fixture must be responsive');
      assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'),
        candidate.archive.sha256.toLowerCase());
      const manifestDir = path.join(root, `manifest-${index}`);
      await generateManifests({ ...options, outputDir: manifestDir });
      await validateManifests({ ...options, manifestDir, native: true, wingetCommand });
      const before = await snapshot(home);
      // "install --manifest" upgrades an installed same-identifier local package.
      installationAttempted = true;
      await winget(['install', '--manifest', manifestDir, '--scope', 'user',
        '--location', installRoot, '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity']);
      assert.deepEqual(await snapshot(home), before, 'WinGet itself must not mutate COPILOT_HOME');
      assert.equal((await fs.realpath(alias)).toLowerCase(), (await fs.realpath(launcher)).toLowerCase(),
        'WinGet must own a Links alias targeting the executable inside the archive, not a copied binary');
      await execute(launcher, [index === 0 ? 'install' : 'update', '--home', home],
        { env: environment, timeout: 120_000 });
      const { stdout } = await execute(launcher, ['doctor', '--home', home],
        { env: environment, timeout: 120_000 });
      requireHealthyDoctor(JSON.parse(stdout), candidate.version, index === 0 ? 'after install' : 'after upgrade');
      evidence.push({ version: candidate.version, manifestValidation: 'Passed',
        operation: index === 0 ? 'install' : 'upgrade', channelOwnership: 'Passed', doctor: 'Passed' });
    }
    assert.notDeepEqual(await snapshot(home), initial, 'Explicit framework install must have run');
    const beforeRemoval = await snapshot(home);
    await uninstall();
    assert.equal(await exists(alias), false, 'WinGet uninstall must remove its alias');
    assert.equal(await exists(launcher), false, 'WinGet uninstall must remove its launcher');
    installationAttempted = false;
    assert.deepEqual(await snapshot(home), beforeRemoval, 'WinGet uninstall must preserve the explicit Copilot-home installation');
    const retained = await verifyRetainedFramework({
      home, version: upgradeInput.version, removedRoot: installRoot, workspace: root, environment,
    });
    return { status: 'Passed', nativeHost: 'windows-x64', evidence,
      channelUninstallPreservesFramework: 'Passed', testOnly: true,
      postRemovalHook: retained.hook, postRemovalDoctor: retained.doctor,
      communityAccepted: false, clientAvailable: false };
  } finally {
    await new Promise(resolve => server.close(resolve));
    // Never remove the workspace while WinGet may still own files inside it.
    if (installationAttempted) {
      const owned = await fs.realpath(alias).catch(() => null);
      const expected = await fs.realpath(launcher).catch(() => launcher);
      if (owned && owned.toLowerCase() !== expected.toLowerCase()) {
        throw new Error(`WinGet cleanup cannot prove alias ownership; retained ${root}`);
      }
      try { await uninstall(); } catch (error) {
        if ((Number(error.code) >>> 0) !== NO_APPLICATIONS_FOUND) {
          throw new Error(`WinGet cleanup failed; retained ${root}: ${error.stderr || error.message}`, { cause: error });
        }
      }
      if (await exists(alias)) throw new Error(`WinGet cleanup left an alias; retained ${root}`);
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--input' || args[2] !== '--upgrade-input') {
    throw new Error('Usage: node packaging/winget/smoke.mjs --input BEFORE.json --upgrade-input AFTER.json');
  }
  try {
    const input = JSON.parse(await fs.readFile(args[1], 'utf8'));
    const upgradeInput = JSON.parse(await fs.readFile(args[3], 'utf8'));
    console.log(JSON.stringify(await smokeWinGet({ input, upgradeInput }), null, 2));
  } catch (error) {
    const blocked = !error.frameworkFailure && (error.blocked || typeof error.code === 'number');
    console.error(JSON.stringify({ status: blocked ? 'NotRun' : 'Failed', diagnostic: blocked ? 'Blocked' : null,
      message: error.message, code: error.code ?? null, stdout: error.stdout ?? null, stderr: error.stderr ?? null,
      note: 'No policy or execution controls were changed. A generic client failure is not evidence of CFS quarantine.' }, null, 2));
    process.exitCode = 1;
  }
}
