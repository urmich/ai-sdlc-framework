import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as github from 'ai-sdlc-framework/github';
import { providerAdapterIds } from 'ai-sdlc-framework/provider-adapters';
import { Store } from 'ai-sdlc-framework/store';
import { distribution, install, doctor, cleanInstall } from '../src/install.mjs';
import { githubModuleNames, smokeGitHubImports } from '../scripts/verify-package.mjs';

const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
const retainedModules = Object.freeze([
  'connection', 'execution-adapter', 'host', 'repository', 'schemas', 'store-bridge', 'transport',
]);
const retainedExports = Object.freeze([
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

async function isolatedRoot(t) {
  const root = path.resolve('.test-data', `github-install-${randomUUID()}`);
  await fs.mkdir(root, { recursive: true });
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve('.test-data'));
    await fs.rm(root, { recursive: true, maxRetries: 10, retryDelay: 100 });
    await assert.rejects(fs.stat(root), { code: 'ENOENT' });
  });
  return root;
}

test('GitHub public subpath exposes exactly the retained core without implicit registration', () => {
  assert.deepEqual(Object.keys(github).sort(), [...retainedExports].sort());
  assert.equal(retainedExports.length, 28);
  for (const entry of [
    github.createGitHubExecutionAdapter, github.registerGitHubAdapter,
    github.createGitHubConnection, github.createGitHubTransport,
    github.createGitHubHost, github.createGitHubStore, github.createGitHubStoreBridge,
    github.normalizeGitHubRepositoryObservation, github.normalizeGitHubExecutionLink,
  ]) assert.equal(typeof entry, 'function');
  assert.equal(providerAdapterIds().includes('github'), false);
});

test('source public inventory contains exactly seven modules and twenty-eight exports without acquisition', async t => {
  const root = await isolatedRoot(t);
  assert.deepEqual([...githubModuleNames].sort(), [...retainedModules]);
  const actual = await smokeGitHubImports(path.join(sourceRoot, 'src', 'github'), {
    facade: 'ai-sdlc-framework/github', home: path.join(root, 'home'),
  }, { cwd: sourceRoot });
  assert.equal(actual.modules, 7);
  assert.equal(actual.publicExports, 28);
  await assert.rejects(fs.stat(path.join(root, 'home')), { code: 'ENOENT' });
});

test('isolated installation preserves seven modules, core validation, doctor and idempotence', async t => {
  const root = await isolatedRoot(t);
  const home = path.join(root, 'copilot home');
  const store = new Store(home);
  const { files } = await distribution(home);
  const expected = [
    'sdlc/src/github.mjs', 'sdlc/src/validation-catalog.mjs', 'sdlc/src/validation-evidence.mjs',
    'sdlc/github-adapters.md', ...retainedModules.map(name => `sdlc/src/github/${name}.mjs`),
  ];
  for (const file of expected) assert.equal(files.has(file), true, file);
  for (const file of ['capabilities', 'capability-operations', 'provider-capabilities']) {
    assert.equal(files.has(`sdlc/src/${file}.mjs`), false);
  }
  assert.deepEqual([...files.keys()].filter(file => file.startsWith('sdlc/src/github/')).sort(),
    retainedModules.map(name => `sdlc/src/github/${name}.mjs`).sort());
  assert.equal((await install(store)).installed, true);
  assert.deepEqual((await doctor(store)).findings, []);
  const installedGitHub = await import(pathToFileURL(path.join(home, 'sdlc', 'src', 'github.mjs')));
  const installedStores = await import(pathToFileURL(path.join(home, 'sdlc', 'src', 'store.mjs')));
  const installedCatalog = await import(pathToFileURL(path.join(home, 'sdlc', 'src', 'validation-catalog.mjs')));
  const installedEvidence = await import(pathToFileURL(path.join(home, 'sdlc', 'src', 'validation-evidence.mjs')));
  assert.deepEqual(Object.keys(installedGitHub).sort(), [...retainedExports].sort());
  assert.equal(typeof installedCatalog.buildTestCatalog, 'function');
  assert.equal(typeof installedCatalog.readValidationObject, 'function');
  assert.equal(typeof installedEvidence.retainTestEvidence, 'function');
  assert.equal(typeof installedEvidence.readTestEvidence, 'function');
  assert.equal(installedCatalog.OUTCOME_PAGE_SIZE, 64);
  assert.notEqual(installedStores.Store, Store);
  const selectedStore = installedGitHub.createGitHubStore(home, installedGitHub.createGitHubHost());
  assert.ok(selectedStore instanceof installedStores.Store);
  assert.equal(selectedStore.home, home);
  for (const relative of expected.filter(file => file.endsWith('.mjs'))) {
    assert.deepEqual(await fs.readFile(path.join(home, ...relative.split('/'))), files.get(relative), relative);
  }
  const actual = await smokeGitHubImports(path.join(home, 'sdlc', 'src', 'github'), { home });
  assert.equal(actual.modules, 7);
  assert.equal(actual.publicExports, 28);
  assert.deepEqual((await install(store)).changedFiles, []);
});

test('installed core protects credentials, privately brands SDK proof and rejects unsafe host input', async t => {
  const root = await isolatedRoot(t);
  const home = path.join(root, 'home');
  await install(new Store(home));
  const installed = await import(pathToFileURL(path.join(home, 'sdlc', 'src', 'github.mjs')));
  const sentinel = 'isolated-private-packaging-credential';
  const calls = [];
  const connection = installed.createGitHubConnection({
    id: 'packaging-private', apiOrigin: 'https://api.github.com', webOrigin: 'https://github.com',
    scopes: [{ kind: 'repository', id: '101', owner: 'fixture', name: 'sample' }],
    credentialResolver: () => ({ apiOrigin: 'https://api.github.com',
      tokenClass: 'fine-grained-pat', token: sentinel,
      generation: 'packaging-generation', actorVisibility: 'packaging-actor' }),
  });
  const transport = installed.createGitHubTransport({ connection, async fetch(url, init) {
    calls.push({ url, method: init.method });
    assert.equal(init.headers.authorization, `Bearer ${sentinel}`);
    return new Response('{"id":101}', { headers: { 'content-type': 'application/json' } });
  } });
  const host = installed.createGitHubHost({ connections: [{ connection, transport }] });
  const request = { method: 'GET', path: '/repos/fixture/sample', profile: '2026-03-10',
    mediaType: 'application/vnd.github+json', expectedStatuses: [200],
    proofScope: 'repository:101', tokenClasses: ['fine-grained-pat'] };
  const capture = await transport.execute(transport.buildRestRequest(request));
  assert.deepEqual(calls, [{ url: 'https://api.github.com/repos/fixture/sample', method: 'GET' }]);
  assert.deepEqual(capture.body, { id: 101 });
  assert.equal(installed.requireGitHubCapture(capture, connection), capture);
  for (const forged of [{ ...capture }, JSON.parse(JSON.stringify(capture))]) {
    assert.throws(() => installed.requireGitHubCapture(forged, connection), { code: 'EVIDENCE' });
  }
  assert.doesNotMatch(JSON.stringify({ connection, transport, host, capture }), new RegExp(sentinel));
  await assert.rejects(host.legacyOperations.prepare({ token: sentinel },
    installed.createGitHubStore(home, host)), { code: 'UNSAFE' });
  assert.equal(calls.length, 1);
  assert.deepEqual((await doctor(new Store(home))).findings, []);
});

test('T-46 every missing GitHub or referenced-validation module rejects replacement before existing content is purged', async t => {
  const root = await isolatedRoot(t);
  const home = path.join(root, 'home');
  const source = path.join(root, 'replacement');
  for (const directory of ['bin', 'src', 'assets', 'docs']) {
    await fs.cp(path.join(sourceRoot, directory), path.join(source, directory), { recursive: true });
  }
  await fs.copyFile(path.join(sourceRoot, 'package.json'), path.join(source, 'package.json'));
  const store = new Store(home);
  await install(store);
  const runtime = path.join(home, 'sdlc', 'runtime', 'private-state.json');
  await fs.writeFile(runtime, '{"preserve":"existing-runtime"}\n');
  const { files } = await distribution(home);
  const before = new Map(await Promise.all([...files.keys(),
    'copilot-instructions.md', 'sdlc/install-manifest.json', 'sdlc/runtime/private-state.json']
    .map(async relative => [relative, await fs.readFile(path.join(home, ...relative.split('/')))])));
  const modulePaths = [
    'src/github.mjs', ...retainedModules.map(name => `src/github/${name}.mjs`),
    'src/validation-catalog.mjs', 'src/validation-evidence.mjs',
  ];
  for (const relativeModule of modulePaths) {
    const module = path.join(source, ...relativeModule.split('/'));
    const held = `${module}.held`;
    await fs.rename(module, held);
    try {
      await assert.rejects(cleanInstall(store, { sourceRoot: source }), error =>
        error.code === 'INSTALL' && error.message.includes(`sdlc/${relativeModule}`));
      assert.equal(await fs.readFile(runtime, 'utf8'), '{"preserve":"existing-runtime"}\n');
    } finally {
      await fs.rename(held, module);
    }
  }
  for (const [relative, content] of before) {
    assert.deepEqual(await fs.readFile(path.join(home, ...relative.split('/'))), content, relative);
  }
  assert.deepEqual((await doctor(store)).findings, []);
});
