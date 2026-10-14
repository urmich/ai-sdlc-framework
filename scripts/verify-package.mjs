import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import filesystem from 'node:fs';
import promises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildPackage, npmInvocation } from './package.mjs';

const execute = promisify(execFile);
const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));

export const githubModuleNames = Object.freeze([
  'connection', 'execution-adapter', 'host', 'repository', 'schemas',
  'store-bridge', 'transport',
]);
export const githubPublicExportNames = Object.freeze([
  'GITHUB_REST_PROFILES', 'GITHUB_TOKEN_CLASSES', 'createGitHubConnection',
  'createGitHubExecutionAdapter', 'createGitHubHost', 'createGitHubStore',
  'createGitHubStoreBridge', 'createGitHubTransport', 'getGitHubTransportPageLimit',
  'githubRepositoryScopeRef', 'normalizeGitHubExecutionLink',
  'normalizeGitHubRepositoryIdentity', 'normalizeGitHubRepositoryObservation',
  'registerGitHubAdapter', 'requireGitHubCapture', 'requireGitHubConnection',
  'requireGitHubRequestBinding', 'requireGitHubTransport', 'resolveGitHubCredential',
  'selectGitHubProfile', 'selectGitHubScope', 'validateGitHubBranchRef',
  'validateGitHubConnection', 'validateGitHubCredentialContract', 'validateGitHubId',
  'validateGitHubNodeId', 'validateGitHubRevision', 'validateGitHubWebUrl',
]);

async function withoutFilesystemIO(action) {
  const saved = [];
  const deny = () => { throw new Error('GitHub construction attempted filesystem I/O'); };
  for (const target of [filesystem, promises]) {
    for (const name of Object.keys(target)) {
      if (typeof target[name] !== 'function' ||
          !/^(?:access|appendFile|chmod|chown|copyFile|cp|exists|lchmod|lchown|link|lstat|lutimes|mkdir|mkdtemp|open|opendir|read|readdir|readFile|readlink|realpath|rename|rm|rmdir|stat|symlink|truncate|unlink|utimes|watch|write|writeFile|createReadStream|createWriteStream)(?:Sync)?$/u.test(name)) continue;
      saved.push([target, name, target[name]]);
      target[name] = deny;
    }
  }
  syncBuiltinESMExports();
  try { return await action(); }
  finally {
    for (const [target, name, value] of saved) target[name] = value;
    syncBuiltinESMExports();
  }
}

export async function verifyGitHubImports(moduleDirectory, {
  loadFacade = () => import(pathToFileURL(path.join(moduleDirectory, '..', 'github.mjs'))),
  home = path.resolve(moduleDirectory, '..', '..', 'import smoke home'),
} = {}) {
  const assert = (await import('node:assert/strict')).default;
  const adapters = await import(pathToFileURL(path.join(moduleDirectory, '..', 'provider-adapters.mjs')));
  const beforeAdapters = adapters.providerAdapterIds();
  const github = await loadFacade();
  const filenames = (await fs.readdir(moduleDirectory)).filter(name => name.endsWith('.mjs')).sort();
  assert.deepEqual(filenames, githubModuleNames.map(name => `${name}.mjs`).sort(),
    'GitHub package inventory must match every actual nested module');
  const modules = await Promise.all(filenames.map(name =>
    import(pathToFileURL(path.join(moduleDirectory, name)))));
  assert.deepEqual(Object.keys(github).sort(), [...githubPublicExportNames].sort(),
    'Public facade must match the closed supported export inventory');
  for (const [name, entry] of Object.entries(github)) {
    assert.ok(modules.some(module => module[name] === entry),
      `Public export ${name} is not backed by an installed module`);
  }
  const verifierNames = [
    'verifyRepository', 'verifyPullRequest', 'verifyCheckResults',
    'verifyOperationResult', 'verifyArtifact', 'verifyProviderVersion',
  ];
  const stores = await import(pathToFileURL(path.join(moduleDirectory, '..', 'store.mjs')));
  const { host, store, bridge } = await withoutFilesystemIO(() => {
    const noCall = () => { throw new Error('Import or construction attempted host I/O'); };
    const connection = github.createGitHubConnection({
      id: 'package-smoke', apiOrigin: 'https://api.github.com', webOrigin: 'https://github.com',
      scopes: [{ kind: 'repository', id: '101', owner: 'fixture', name: 'sample' }],
      credentialResolver: noCall,
    });
    const transport = github.createGitHubTransport({ connection, fetch: noCall });
    const host = github.createGitHubHost({
      connections: [{ connection, transport }],
      clock: { now: noCall }, identifier: noCall, authorize: noCall,
      verifiers: Object.fromEntries(verifierNames.map(name => [name, noCall])),
    });
    assert.equal(github.createGitHubExecutionAdapter().id, 'github');
    return {
      host, store: github.createGitHubStore(home, host),
      bridge: github.createGitHubStoreBridge(),
    };
  });
  assert.deepEqual(Object.keys(host).sort(),
    ['storeOptions', 'legacyOperations', 'adapterContract', 'missingVerifiers'].sort());
  assert.deepEqual(Object.keys(host.legacyOperations).sort(),
    ['prepare', 'claimDispatch', 'recordResult', 'reconcile'].sort());
  assert.deepEqual(host.missingVerifiers, []);
  assert.equal(host.adapterContract.adapterId, 'github-existing-consumer');
  assert.equal(host.adapterContract.propagatesUniqueCallId, true);
  assert.ok(store instanceof stores.Store);
  assert.equal(store.home, path.resolve(home));
  assert.equal(store.runtime, path.join(path.resolve(home), 'sdlc', 'runtime'));
  for (const name of verifierNames) assert.equal(typeof store[name], 'function', name);
  assert.throws(() => github.createGitHubStore(home, { ...host }), { code: 'ADAPTER' });
  assert.equal(typeof bridge.storeOptions, 'function');
  assert.deepEqual(bridge.missingVerifiers, verifierNames);
  await assert.rejects(bridge.storeOptions().verifyRepository({
    provider: 'github', localRepositoryPath: home,
    remoteRepositoryURL: 'https://github.com/fixture/sample.git',
  }), { code: 'ADAPTER' });
  const { runCli } = await import(pathToFileURL(path.join(moduleDirectory, '..', 'cli.mjs')));
  await assert.rejects(runCli(['doctor', '--home', home], process, {
    createStore: () => github.createGitHubStore(path.join(home, 'foreign home'), host),
  }), { code: 'ADAPTER' });
  await assert.rejects(runCli(['doctor', '--home', home], process, {
    createStore: () => ({ home }),
  }), { code: 'ADAPTER' });
  assert.deepEqual(adapters.providerAdapterIds(), beforeAdapters, 'Import registered a provider adapter');
  return { modules: modules.length, publicExports: Object.keys(github).length,
    constructors: githubPublicExportNames.filter(name => name.startsWith('createGitHub')).length };
}

export async function smokeGitHubImports(moduleDirectory, options = {}, commandOptions = {}) {
  const { facade = pathToFileURL(path.join(moduleDirectory, '..', 'github.mjs')).href,
    ...verificationOptions } = options;
  const script = `
    const deny = () => { throw new Error('GitHub import smoke forbids host effects'); };
    globalThis.fetch = deny;
    const http = await import('node:http');
    const https = await import('node:https');
    const net = await import('node:net');
    const tls = await import('node:tls');
    http.default.request = http.default.get = deny;
    https.default.request = https.default.get = deny;
    net.default.connect = net.default.createConnection = deny;
    net.default.Socket.prototype.connect = deny;
    tls.default.connect = deny;
    const childProcess = await import('node:child_process');
    for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
      childProcess.default[name] = deny;
    }
    const filesystem = await import('node:fs');
    const promises = await import('node:fs/promises');
    for (const name of ['appendFile', 'chmod', 'chown', 'copyFile', 'cp', 'link', 'lchmod',
      'lchown', 'lutimes', 'mkdir', 'mkdtemp', 'rename', 'rm', 'rmdir', 'symlink',
      'truncate', 'unlink', 'utimes', 'writeFile']) {
      if (typeof filesystem.default[name] === 'function') filesystem.default[name] = deny;
      if (typeof filesystem.default[name + 'Sync'] === 'function') filesystem.default[name + 'Sync'] = deny;
      if (typeof promises.default[name] === 'function') promises.default[name] = deny;
    }
    filesystem.default.createWriteStream = deny;
    for (const target of [filesystem.default, promises.default]) {
      const open = target.open;
      target.open = function(file, flags, ...args) {
        if (flags !== 'r' && flags !== 0) deny();
        return open.call(this, file, flags, ...args);
      };
    }
    const openSync = filesystem.default.openSync;
    filesystem.default.openSync = function(file, flags, ...args) {
      if (flags !== 'r' && flags !== 0) deny();
      return openSync.call(this, file, flags, ...args);
    };
    (await import('node:module')).syncBuiltinESMExports();
    const { verifyGitHubImports } = await import(${JSON.stringify(import.meta.url)});
    console.log(JSON.stringify(await verifyGitHubImports(
      ${JSON.stringify(moduleDirectory)}, {
        ...${JSON.stringify(verificationOptions)},
        loadFacade: () => import(${JSON.stringify(facade)}),
      })));
  `;
  const { stdout } = await command(process.execPath,
    ['--input-type=module', '-e', script], commandOptions);
  return JSON.parse(stdout);
}

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
    if (JSON.stringify(embedded.exports) !== JSON.stringify(pkg.exports)) {
      throw new Error('Public package exports differ from the selected source');
    }
    for (const required of ['package.json', 'bin/sdlc.mjs', 'src/install.mjs',
      'src/provider-adapters.mjs', 'assets/instructions.md',
      'assets/lifecycle-intent.md', 'assets/hooks/sdlc.json', 'docs/cli.md',
      'docs/provider-adapters.md', 'docs/github-adapters.md',
      'src/github.mjs', 'src/validation-catalog.mjs', 'src/validation-evidence.mjs',
      ...githubModuleNames.map(name => `src/github/${name}.mjs`)]) {
      if (!actualFiles.some(file => file.path === required)) {
        throw new Error(`Package archive is missing ${required}`);
      }
    }
    const providerSmoke = `
      const adapters = await import('ai-sdlc-framework/provider-adapters');
      const monitors = await import('ai-sdlc-framework/monitors');
      const stores = await import('ai-sdlc-framework/store');
      const github = await import('ai-sdlc-framework/github');
      const operations = await import('ai-sdlc-framework/operations');
      for (const entry of [
        adapters.registerProviderAdapter, monitors.attachMonitor, stores.Store,
        operations.claimOperationDispatch,
        github.createGitHubExecutionAdapter, github.createGitHubConnection,
        github.createGitHubTransport, github.createGitHubStoreBridge,
        github.createGitHubHost, github.createGitHubStore,
      ]) if (typeof entry !== 'function') throw new Error('Provider extension API is unavailable');
      if (adapters.providerAdapterIds().includes('github')) throw new Error('Import registered GitHub implicitly');
    `;
    await command(process.execPath, ['--input-type=module', '-e', providerSmoke],
      { cwd: packageInstall, env: environment });
    const publicGitHub = await smokeGitHubImports(path.join(packageRoot, 'src', 'github'), {
      facade: 'ai-sdlc-framework/github', home: copilotHome,
    }, { cwd: packageInstall, env: environment });
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
    const installedGitHub = await smokeGitHubImports(path.join(copilotHome, 'sdlc', 'src', 'github'),
      { home: copilotHome }, { cwd: packageRoot, env: environment });
    if (JSON.stringify(publicGitHub) !== JSON.stringify(installedGitHub)) {
      throw new Error('Installed GitHub facade differs from the public package');
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
      packageFiles: expected.files.length, isolatedHome: true, github: publicGitHub };
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
