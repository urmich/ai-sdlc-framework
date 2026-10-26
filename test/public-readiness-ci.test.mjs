export const validationDeclarations = {
  "schemaVersion": 1,
  "surfaces": [
    {"coverage": "process", "paths": ["scripts/validation-tools.mjs", "scripts/check.mjs", "scripts/validate-winget-schema.py", "scripts/read-validation-artifact.py", "cmd/sdlc-launcher/main_test.go", "cmd/sdlc-launcher/integrity_test.go"]},
    {"coverage": "direct", "paths": ["scripts/pr-readiness.mjs", "scripts/github-readiness-host.mjs", "scripts/pr-observer.mjs", "scripts/workflow-policy.mjs", "scripts/native-toolchain.mjs", "scripts/native-homebrew-prefix.mjs"]}
  ]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import fsPromises from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { executeValidationCommand, processDiagnostic, reconcileGoExecution } from '../scripts/validation-tools.mjs';
import { launcherBuildEnvironment } from '../packaging/winget/build-launcher.mjs';
import { generateManifests } from '../packaging/winget/generate.mjs';
import { writePayloadFixture, fixtureCanonical, fixtureSHA, fixtureWindowsLauncher } from './winget-payload-fixture.mjs';
import { repositoryRoot } from '../scripts/test-runner.mjs';
import { previousReleasePins } from '../scripts/release-bundle.mjs';
import { nativePrParts, nativeLegacyPrParts, nativePartJobKey, nativeFrameworkShardPlan,
  nativeResourceFacts, nativePrPartsForProtocol, nativeFrameworkShardProtocols,
  nativeFrameworkUnitShardNames } from '../scripts/native-validation.mjs';
import { compileValidationInventory } from '../scripts/validation-inventory.mjs';
import { expectedBodySdkRequirements } from './native-sdk-expectations.mjs';
import { digest } from '../src/core.mjs';
import { evaluateApproval, evaluateConversations, sharedStatusKeys, planStatusUpdate, reconcileStatusKey,
  reconcilePrReadiness, statusContexts, normalStatusLimit, disposableStatusLimits,
  runDisposablePolicyProbe } from '../scripts/pr-readiness.mjs';
import { createReadinessGitHubClient } from '../scripts/github-readiness-host.mjs';
import { createPrReadinessHost, inspectWorkflowTrust, readTrustedJobContext,
  readTrustedValidationIntent, renderObserverSummary, statusConcurrencyGroup } from '../scripts/pr-observer.mjs';
import { prepareCoverage, renderCoverageSection } from '../src/coverage.mjs';
import { inspectWorkflowPolicy, readWorkflowPolicySources } from '../scripts/workflow-policy.mjs';
import { nativeBootstrapEnvironment, portableRubyBootstrapEnvironment,
  schemaPipInstallArguments, nativeBootstrapExports, homebrewToolchain,
  requireHomebrewBottlePlan, requireHomebrewBottleReceipts } from '../scripts/native-toolchain.mjs';
import { nativeBootstrapProtocol } from '../scripts/toolchain-baseline.mjs';
import { homebrewPrefixBinding, requireShortHomebrewPrefix, allocateOwnedDirectory,
  cleanupOwnedDirectory, recordOwnedDirectoryNotRequired, allocateHomebrewPrefix,
  verifyOwnedDirectoryOwnership, verifyHomebrewPrefixOwnership,
  verifyHomebrewSourceCheckout } from '../scripts/native-homebrew-prefix.mjs';

const sourceA = 'a'.repeat(40);
const now = Date.parse('2026-10-18T10:00:00.000Z');
function approvalPr(authorId = 11) {
  return {
    headSha: sourceA, authorId,
    threads: { complete: true, observedAt: new Date(now).toISOString(), headSha: sourceA, unresolved: 0 },
    reviews: { complete: true, observedAt: new Date(now).toISOString(), headSha: sourceA, items: [
      { id: 1, actorId: 11, state: 'APPROVED', commitSha: sourceA },
    ] },
  };
}
function statusFixture(context = 'framework/coverage', count = 0) {
  const verdict = () => ({ status: 'Passed', inputDigest: digest('current source/spec/body/review/producer'),
    blockers: [] });
  const snapshot = { repositoryId: 17, complete: true, prs: [1, 2].map(number => ({
    number, headSha: sourceA, baseSha: 'b'.repeat(40), mergeSha: String(number).repeat(40),
    verdicts: Object.fromEntries(statusContexts.map(context => [context, verdict()])),
  })) };
  let nextId = count;
  const items = Array.from({ length: count }, (_, index) => ({
    id: index + 1, context, state: 'success', description: 'old green result', creatorId: 42,
  }));
  const writes = [];
  const policy = { repositoryId: 17, writerId: 42,
    detailsUrl: 'https://github.com/fixture/repo/actions/runs/1/attempts/1' };
  const key = { repositoryId: 17, sha: sourceA, context };
  const host = {
    snapshot: async () => structuredClone(snapshot),
    statuses: async target => ({ complete: true,
      items: structuredClone(items.filter(item => item.sha === undefined || item.sha === target.sha)) }),
    verifyWriterControl: async () => true,
    publish: async (target, value) => {
      assert.equal(target.repositoryId, 17);
      const record = { id: ++nextId, context: target.context, sha: target.sha, creatorId: 42, ...value };
      writes.push({ key: structuredClone(target), value: record });
      items.push(record);
      return structuredClone(record);
    },
  };
  return { host, policy, key, snapshot, items, writes };
}

async function fixture(t) {
  const root = path.join(repositoryRoot, '.test-data', `native-tools-${randomUUID()}`);
  await fs.mkdir(root);
  t.after(async () => {
    assert.equal(path.dirname(root), path.join(repositoryRoot, '.test-data'));
    await fs.rm(root, { recursive: true });
    await assert.rejects(fs.stat(root), { code: 'ENOENT' });
  });
  const reportDir = path.join(process.env.SDLC_TEST_EVIDENCE_ROOT ??
    path.join(repositoryRoot, '.test-data', 'executions'), `tools-${randomUUID()}`);
  const home = path.join(root, 'home');
  const temporary = path.join(root, 'tmp');
  for (const directory of [reportDir, home, temporary]) await fs.mkdir(directory, { recursive: true });
  const environment = { ...process.env, HOME: home, USERPROFILE: home, COPILOT_HOME: home,
    XDG_CACHE_HOME: path.join(home, 'cache'), PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1',
    TMPDIR: temporary, TEMP: temporary, TMP: temporary, NODE_OPTIONS: '', NODE_PATH: '' };
  const run = (name, command, args, options = {}) =>
    executeValidationCommand({ name, command, args, environment, outputDir: reportDir,
      signal: t.signal, ...options });
  return { root, reportDir, environment, run };
}

async function frozenLauncherFixture(f) {
  const bytes = Buffer.alloc(512);
  bytes.write('MZ');
  bytes.writeUInt32LE(128, 60);
  bytes.writeUInt32LE(0x00004550, 128);
  bytes.writeUInt16LE(0x8664, 132);
  bytes.writeUInt16LE(0x20b, 152);
  const directory = path.join(f.root, 'frozen-input');
  await fs.mkdir(directory);
  const input = path.join(directory, 'sdlc.exe');
  await fs.writeFile(input, bytes);
  const environment = {
    SDLC_WINDOWS_LAUNCHER: input, SDLC_WINDOWS_LAUNCHER_SHA256: fixtureSHA(bytes),
    SDLC_RELEASE_SOURCE_COMMIT: sourceA,
    SDLC_WINDOWS_LAUNCHER_CONTEXT: JSON.stringify({ sources: [{ revision: sourceA }] }),
  };
  return { bytes, input, directory, environment };
}

test('T-PRD015 frozen launcher setup reuses only source-matched owned bytes', async t => {
  const f = await fixture(t);
  const prepared = await frozenLauncherFixture(f);
  const isolated = await fs.mkdtemp(path.join(repositoryRoot, 'test', '.runner-fixture-'));
  t.after(() => fs.rm(isolated, { recursive: true }));
  const file = path.join(isolated, 'launcher.test.mjs');
  const isolatedOutput = path.join(f.root, 'isolated-launcher');
  await fs.writeFile(file, `import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureWindowsLauncher } from ${JSON.stringify(pathToFileURL(path.join(repositoryRoot, 'test', 'winget-payload-fixture.mjs')).href)};
test('isolated source-bound launcher setup', async () => {
  for (const name of ['FILE', 'PROFILE', 'CONTEXT', 'COMMAND', 'ADVISORY_MS']) {
    assert.equal(process.env['SDLC_TEST_REPORT_' + name], undefined);
  }
  const result = await fixtureWindowsLauncher({
    outputDir: ${JSON.stringify(isolatedOutput)}, goCommand: process.execPath,
  });
  assert.equal(result.sha256, ${JSON.stringify(fixtureSHA(prepared.bytes))});
});
`);
  const isolatedReport = path.join(f.reportDir, 'isolated-launcher-tests.json');
  const environment = { ...f.environment, ...prepared.environment, NO_COLOR: '1',
    SDLC_TEST_REPORT_FILE: isolatedReport,
    SDLC_TEST_REPORT_CONTEXT: JSON.stringify({ reporterOnly: true }) };
  delete environment.FORCE_COLOR;
  const execution = await f.run('isolated-launcher', process.execPath,
    ['scripts/test-runner.mjs', 'targeted', '--workers', '1', file], {
      environment,
    });
  assert.equal(execution.complete, true, execution.diagnostic);
  assert.equal(execution.exitCode, 0, execution.stdout + execution.stderr);
  const report = JSON.parse(await fs.readFile(isolatedReport, 'utf8'));
  assert.equal(report.complete, true);
  assert.equal(report.summary.counts.passed, 1);
  assert.deepEqual(report.context, { reporterOnly: true });
  assert.deepEqual(await fs.readFile(path.join(isolatedOutput, 'sdlc.exe')), prepared.bytes);
  const result = await fixtureWindowsLauncher({
    outputDir: path.join(f.root, 'copied-launcher'), goCommand: process.execPath,
    environment: prepared.environment,
  });
  assert.equal(result.sha256, fixtureSHA(prepared.bytes));
  assert.equal(result.size, prepared.bytes.length);
  assert.notEqual(result.artifact, prepared.input);
  assert.deepEqual(await fs.readFile(result.artifact), prepared.bytes);
  await fs.appendFile(result.artifact, 'owned copy changed');
  assert.deepEqual(await fs.readFile(prepared.input), prepared.bytes);
  await fs.appendFile(prepared.input, 'source changed');
  const outputDir = path.join(f.root, 'changed-input');
  await assert.rejects(fixtureWindowsLauncher({
    outputDir, goCommand: process.execPath, environment: prepared.environment,
  }), /bytes differ from their verified source digest/u);
  await assert.rejects(fs.stat(outputDir), { code: 'ENOENT' });
});

test('T-PRD015 frozen launcher setup rejects incomplete source proof and linked or invalid inputs', async t => {
  const f = await fixture(t);
  const prepared = await frozenLauncherFixture(f);
  const variants = [
    [{ SDLC_WINDOWS_LAUNCHER_SHA256: undefined }, /expected byte digest/u],
    [{ SDLC_WINDOWS_LAUNCHER_CONTEXT: undefined,
      SDLC_TEST_REPORT_CONTEXT: prepared.environment.SDLC_WINDOWS_LAUNCHER_CONTEXT }, /source-bound native context/u],
    [{ SDLC_WINDOWS_LAUNCHER_CONTEXT: JSON.stringify({ sources: [null] }) }, /source differs/u],
    [{ SDLC_RELEASE_SOURCE_COMMIT: 'b'.repeat(40) }, /source differs/u],
    [{ SDLC_WINDOWS_LAUNCHER_SHA256: '0'.repeat(64) }, /bytes differ/u],
    [{ SDLC_WINDOWS_LAUNCHER: path.join(repositoryRoot, 'LICENSE') }, /owned repository-local/u],
    [{ SDLC_WINDOWS_LAUNCHER: prepared.directory }, /regular owned repository-local/u],
  ];
  const linked = path.join(f.root, 'linked-input');
  await fs.symlink(prepared.directory, linked, process.platform === 'win32' ? 'junction' : 'dir');
  variants.push([{ SDLC_WINDOWS_LAUNCHER: path.join(linked, 'sdlc.exe') }, /regular owned repository-local/u]);
  for (const [index, [change, expected]] of variants.entries()) {
    const outputDir = path.join(f.root, `invalid-${index}`);
    await assert.rejects(fixtureWindowsLauncher({
      outputDir, goCommand: process.execPath, environment: { ...prepared.environment, ...change },
    }), expected);
    await assert.rejects(fs.stat(outputDir), { code: 'ENOENT' });
  }
  await fs.writeFile(prepared.input, Buffer.alloc(512));
  await assert.rejects(fixtureWindowsLauncher({
    outputDir: path.join(f.root, 'invalid-pe'), goCommand: process.execPath,
    environment: { ...prepared.environment, SDLC_WINDOWS_LAUNCHER_SHA256: fixtureSHA(Buffer.alloc(512)) },
  }), /native launcher is required/u);
});

test('T-PRD015 short Homebrew prefixes bind native disposable GitHub Mac jobs and reject deep or ambient roots', async t => {
  const environment = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_OS: 'macOS',
    RUNNER_ARCH: 'ARM64', RUNNER_NAME: 'Hosted Agent', GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_WORKSPACE: path.join(repositoryRoot, '.test-data', 'virtual-workspace'),
    GITHUB_REPOSITORY: 'fixture/repository', GITHUB_REPOSITORY_ID: '123',
    GITHUB_RUN_ID: '456', GITHUB_RUN_ATTEMPT: '2', GITHUB_JOB: 'native_macos' };
  const host = { platform: 'darwin', architecture: 'arm64', machine: 'arm64', release: '24.6.0',
    hostname: 'runner-mac', uid: 501, gid: 20 };
  const request = { target: 'macos-arm64', environment, host };
  const binding = homebrewPrefixBinding(request);
  assert.equal(requireShortHomebrewPrefix('/opt/abc12'), '/opt/abc12');
  assert.equal(Buffer.byteLength('/opt/abc12'), 10);
  for (const prefix of ['/opt/homebrew', '/usr/local', '/opt/ABC12', '/opt/abcd',
    '/opt/abcdef', '/opt/abc12/', '/opt/../abc12', '/Users/runner/work/repository/.test-data/bootstrap/homebrew']) {
    assert.throws(() => requireShortHomebrewPrefix(prefix), { code: 'HOST' });
  }
  for (const change of [
    { target: 'macos-x64' }, { host: { ...host, platform: 'linux' } },
    { host: { ...host, machine: 'x86_64' } }, { host: { ...host, uid: 0 } },
    { environment: { ...environment, RUNNER_ENVIRONMENT: 'self-hosted' } },
    { environment: { ...environment, GITHUB_ACTIONS: 'false' } },
    { environment: { ...environment, GITHUB_RUN_ATTEMPT: '' } },
    { environment: { ...environment, GITHUB_JOB: '' } },
  ]) assert.throws(() => homebrewPrefixBinding({ ...request, ...change }), { code: 'HOST' });
  const intel = homebrewPrefixBinding({ target: 'macos-x64', environment: { ...environment, RUNNER_ARCH: 'X64' },
    host: { ...host, architecture: 'x64', machine: 'x86_64' } });
  assert.equal(intel.target, 'macos-x64');
  assert.notDeepEqual(homebrewPrefixBinding({ ...request,
    environment: { ...environment, GITHUB_RUN_ATTEMPT: '3' } }), binding);
  assert.notDeepEqual(homebrewPrefixBinding({ ...request,
    environment: { ...environment, GITHUB_JOB: 'other_job' } }), binding);
  if (process.platform !== 'darwin') {
    let calls = 0;
    await assert.rejects(allocateHomebrewPrefix({ environment, target: 'macos-arm64',
      run: () => { calls++; } }), { code: 'HOST' });
    await assert.rejects(verifyHomebrewPrefixOwnership({ environment, target: 'macos-arm64' }), { code: 'HOST' });
    assert.equal(calls, 0, 'Non-Mac hosts must not dispatch privileged provisioning');
  }
  const f = await prefixFixture(t);
  const originalEnvironment = { ...f.environment };
  assert.deepEqual(await verifyHomebrewSourceCheckout({ ...f.context, environment: f.environment }),
    { workspace: f.workspace, repositoryRoot: f.context.repositoryRoot });
  assert.deepEqual(f.environment, originalEnvironment, 'The actual Actions workspace must never be rewritten');
  for (const workspace of [f.context.repositoryRoot, f.root, `${f.workspace}${path.sep}..`]) {
    await assert.rejects(verifyHomebrewSourceCheckout({ ...f.context,
      environment: { ...f.environment, GITHUB_WORKSPACE: workspace } }), { code: 'HOST' });
  }
  await assert.rejects(verifyHomebrewSourceCheckout({ ...f.context, environment: f.environment,
    repositoryRoot: f.workspace }), { code: 'HOST' });
  const outside = path.join(f.root, 'outside');
  await fs.mkdir(outside, { mode: 0o700 });
  await assert.rejects(verifyHomebrewSourceCheckout({ ...f.context, environment: f.environment,
    repositoryRoot: outside }), { code: 'HOST' });
  const parked = path.join(f.workspace, 'real-source');
  await fs.rename(f.context.repositoryRoot, parked);
  await fs.symlink(parked, f.context.repositoryRoot, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(verifyHomebrewSourceCheckout({ ...f.context, environment: f.environment }), { code: 'HOST' });
  await fs.unlink(f.context.repositoryRoot);
  await fs.rename(parked, f.context.repositoryRoot);
  const parkedWorkspace = path.join(f.root, 'real-workspace');
  await fs.rename(f.workspace, parkedWorkspace);
  await fs.symlink(parkedWorkspace, f.workspace, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(verifyHomebrewSourceCheckout({ ...f.context, environment: f.environment }), { code: 'HOST' });
  await fs.unlink(f.workspace);
  await fs.rename(parkedWorkspace, f.workspace);
});

async function prefixFixture(t) {
  const root = path.join(repositoryRoot, '.test-data', `owned-prefix-${randomUUID()}`);
  await fs.mkdir(root, { mode: 0o700 });
  t.after(async () => {
    assert.equal(path.dirname(root), path.join(repositoryRoot, '.test-data'));
    await fs.rm(root, { recursive: true });
  });
  const workspace = path.join(root, 'workspace');
  const checkout = path.join(workspace, 'source');
  const data = path.join(checkout, '.test-data');
  const bootstrapDirectory = path.join(data, 'bootstrap');
  for (const directory of [workspace, checkout, data, bootstrapDirectory]) await fs.mkdir(directory, { mode: 0o700 });
  const stat = await fs.lstat(root);
  const binding = { host: { uid: stat.uid, gid: stat.gid }, job: 'fixture', attempt: '1' };
  const environment = { GITHUB_WORKSPACE: workspace };
  const context = { repositoryRoot: checkout, bootstrapDirectory, prefix: path.join(root, 'prefix'), binding,
    createDirectory: selected => fs.mkdir(selected, { mode: 0o700 }),
    claimDirectory: async () => {} };
  await verifyHomebrewSourceCheckout({ ...context, environment });
  return { root, workspace, context, environment };
}

test('T-PRD015 owned Homebrew prefix proof survives a separate cleanup step without adopting existing directories', async t => {
  const { root, context } = await prefixFixture(t);
  const first = await allocateOwnedDirectory(context);
  const allocationPath = path.join(context.bootstrapDirectory, 'native-homebrew-prefix-allocation.json');
  const originalAllocation = await fs.readFile(allocationPath);
  const before = await fs.lstat(allocationPath, { bigint: true });
  assert.deepEqual(JSON.parse(originalAllocation), first.allocation);
  assert.deepEqual(await verifyOwnedDirectoryOwnership(context), first);
  assert.deepEqual(await fs.readFile(allocationPath), originalAllocation);
  const after = await fs.lstat(allocationPath, { bigint: true });
  assert.equal(after.mtimeNs, before.mtimeNs, 'Ownership inspection never rewrites allocation evidence');
  assert.deepEqual(await fs.readdir(context.prefix), ['.sdlc-native-homebrew-prefix.json']);
  await fs.mkdir(path.join(context.prefix, 'Cellar'));
  await fs.writeFile(path.join(context.prefix, 'Cellar', 'retained'), 'owned bottle content');
  const sentinel = path.join(root, 'unowned');
  await fs.writeFile(sentinel, 'do not touch');
  await assert.rejects(allocateOwnedDirectory(context), { code: 'HOST' });
  const cleanupContext = structuredClone({ repositoryRoot: context.repositoryRoot, bootstrapDirectory: context.bootstrapDirectory,
    binding: context.binding });
  await assert.rejects(cleanupOwnedDirectory({ ...cleanupContext,
    binding: { ...context.binding, attempt: '2' } }), { code: 'HOST' });
  await assert.rejects(verifyOwnedDirectoryOwnership({ ...cleanupContext,
    binding: { ...context.binding, attempt: '2' } }), { code: 'HOST' });
  assert.equal(await fs.readFile(path.join(context.prefix, 'Cellar', 'retained'), 'utf8'), 'owned bottle content');
  assert.deepEqual(await cleanupOwnedDirectory(cleanupContext), { prefix: context.prefix, status: 'removed' });
  await assert.rejects(fs.lstat(context.prefix), { code: 'ENOENT' });
  await assert.rejects(verifyOwnedDirectoryOwnership(context), { code: 'HOST' });
  assert.deepEqual(await cleanupOwnedDirectory(cleanupContext), { prefix: context.prefix, status: 'removed' });
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'do not touch');
  await fs.mkdir(context.prefix);
  await assert.rejects(cleanupOwnedDirectory(cleanupContext), { code: 'HOST' });
  assert.ok((await fs.lstat(context.prefix)).isDirectory(), 'A replacement after cleanup is never removed');
  const unused = await prefixFixture(t);
  await recordOwnedDirectoryNotRequired(unused.context);
  assert.deepEqual(await cleanupOwnedDirectory(unused.context),
    { status: 'not-required', reason: 'No Homebrew prefix allocation was requested' });
  await assert.rejects(verifyOwnedDirectoryOwnership(unused.context), { code: 'HOST' });
  await assert.rejects(allocateOwnedDirectory(unused.context), { code: 'EEXIST' });
  await assert.rejects(fs.lstat(unused.context.prefix), { code: 'ENOENT' });
});

test('T-PRD015 owned Homebrew prefix cleanup refuses lost tampered linked and replaced ownership evidence', async t => {
  const { root, context } = await prefixFixture(t);
  await assert.rejects(cleanupOwnedDirectory(context), { code: 'HOST' });
  await allocateOwnedDirectory(context);
  const marker = path.join(context.prefix, '.sdlc-native-homebrew-prefix.json');
  const originalMarker = await fs.readFile(marker);
  const proof = path.join(context.bootstrapDirectory, 'native-homebrew-prefix-allocation.json');
  const originalProof = await fs.readFile(proof);
  await fs.writeFile(marker, '{"wrong":"marker"}');
  await assert.rejects(verifyOwnedDirectoryOwnership(context), { code: 'HOST' });
  await assert.rejects(cleanupOwnedDirectory(context), { code: 'HOST' });
  await fs.writeFile(marker, originalMarker);
  const parkedMarker = path.join(root, 'original-marker');
  await fs.rename(marker, parkedMarker);
  await fs.writeFile(marker, originalMarker, { flag: 'wx', mode: 0o600 });
  await assert.rejects(verifyOwnedDirectoryOwnership(context), { code: 'HOST' });
  assert.deepEqual(await fs.readFile(marker), originalMarker, 'A byte-identical replacement marker is rejected without mutation');
  await fs.unlink(marker);
  await fs.symlink(parkedMarker, marker, process.platform === 'win32' ? 'junction' : 'file');
  await assert.rejects(verifyOwnedDirectoryOwnership(context), { code: 'HOST' });
  await assert.rejects(cleanupOwnedDirectory(context), { code: 'HOST' });
  await fs.unlink(marker);
  await fs.rename(parkedMarker, marker);
  await fs.unlink(proof);
  await assert.rejects(verifyOwnedDirectoryOwnership(context), { code: 'ENOENT' });
  await assert.rejects(cleanupOwnedDirectory(context), { code: 'ENOENT' });
  const tamperedProof = JSON.parse(originalProof);
  tamperedProof.requestDigest = '0'.repeat(64);
  await fs.writeFile(proof, JSON.stringify(tamperedProof), { flag: 'wx', mode: 0o600 });
  await assert.rejects(verifyOwnedDirectoryOwnership(context), { code: 'HOST' });
  assert.deepEqual(await fs.readFile(marker), originalMarker, 'Rejected ownership inspection must not remove or change the prefix');
  await fs.unlink(proof);
  await fs.writeFile(proof, originalProof, { flag: 'wx', mode: 0o600 });
  const parked = path.join(root, 'original');
  await fs.rename(context.prefix, parked);
  await fs.mkdir(context.prefix, { mode: 0o700 });
  await fs.writeFile(marker, originalMarker, { mode: 0o600 });
  await assert.rejects(verifyOwnedDirectoryOwnership(context), { code: 'HOST' });
  await assert.rejects(cleanupOwnedDirectory(context), { code: 'HOST' });
  await fs.rm(context.prefix, { recursive: true });
  await fs.symlink(parked, context.prefix, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(verifyOwnedDirectoryOwnership(context), { code: 'HOST' });
  await assert.rejects(cleanupOwnedDirectory(context), { code: 'HOST' });
  assert.deepEqual(await fs.readFile(path.join(parked, path.basename(marker))), originalMarker);
  await fs.unlink(context.prefix);
  await fs.rename(parked, context.prefix);
  assert.equal((await cleanupOwnedDirectory(context)).status, 'removed');
});

test('T-PRD015 failed owned Homebrew allocation rolls back only confirmed empty creation and retains original failures', async t => {
  const { context } = await prefixFixture(t);
  const denied = new Error('original chown permission failure');
  let rollbacks = 0;
  await assert.rejects(allocateOwnedDirectory({ ...context, claimDirectory: async () => { throw denied; },
    removeEmptyDirectory: async selected => { rollbacks++; await fs.rmdir(selected); } }),
    error => error.code === 'HOST' && error.cause === denied && /rolled back/u.test(error.message));
  assert.equal(rollbacks, 1, 'Confirmed empty allocation rollback uses the same narrow removal capability');
  await assert.rejects(fs.lstat(context.prefix), { code: 'ENOENT' });
  assert.deepEqual(await cleanupOwnedDirectory(context), { prefix: context.prefix, status: 'rolled-back' });
  const other = await prefixFixture(t);
  const original = new Error('uncertain mkdir result');
  await assert.rejects(allocateOwnedDirectory({ ...other.context, createDirectory: async selected => {
    await fs.mkdir(selected, { mode: 0o700 });
    throw original;
  } }), error => error.code === 'HOST' && error.cause === original && /unconfirmed/u.test(error.message));
  assert.ok((await fs.lstat(other.context.prefix)).isDirectory());
  await assert.rejects(cleanupOwnedDirectory(other.context), { code: 'ENOENT' });
  const unknown = await prefixFixture(t);
  await assert.rejects(allocateOwnedDirectory({ ...unknown.context, claimDirectory: async selected => {
    await fs.writeFile(path.join(selected, 'unknown'), 'preserve unknown contents');
    throw denied;
  } }), error => error.code === 'HOST' && error.cause === denied && error.cleanupError?.code === 'ENOTEMPTY');
  assert.equal(await fs.readFile(path.join(unknown.context.prefix, 'unknown'), 'utf8'), 'preserve unknown contents');
});

test('T-PRD015 owned Homebrew prefix uses retained empty-root removal with a non-writable parent and never retries nonempty roots', async t => {
  const { root, context } = await prefixFixture(t);
  const { allocation } = await allocateOwnedDirectory(context);
  await fs.mkdir(path.join(context.prefix, 'Cellar'));
  await fs.writeFile(path.join(context.prefix, 'Cellar', 'bottle'), 'owned bottle');
  const outside = path.join(root, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'sentinel'), 'preserve external target');
  await fs.symlink(outside, path.join(context.prefix, 'linked-runtime'),
    process.platform === 'win32' ? 'junction' : 'dir');
  let removals = 0;
  await fs.chmod(root, 0o555);
  try {
    const result = await cleanupOwnedDirectory({ ...context, removeEmptyDirectory: async selected => {
      removals++;
      assert.equal(selected, context.prefix);
      const stat = await fs.lstat(selected, { bigint: true });
      assert.equal(String(stat.dev), allocation.prefixIdentity.device);
      assert.equal(String(stat.ino), allocation.prefixIdentity.inode);
      assert.equal(Number(stat.uid), context.binding.host.uid);
      assert.deepEqual(await fs.readdir(selected), [], 'Owned contents and the last marker precede empty-root removal');
      // Restore only this fixture's parent permission to model the narrow privileged rmdir capability.
      await fs.chmod(root, 0o700);
      await fs.rmdir(selected);
    } });
    assert.deepEqual(result, { prefix: context.prefix, status: 'removed' });
  } finally { await fs.chmod(root, 0o700); }
  assert.equal(removals, 1);
  await assert.rejects(fs.lstat(context.prefix), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(outside, 'sentinel'), 'utf8'), 'preserve external target');

  const nonempty = await prefixFixture(t);
  await allocateOwnedDirectory(nonempty.context);
  let attempts = 0;
  await assert.rejects(cleanupOwnedDirectory({ ...nonempty.context, removeEmptyDirectory: async selected => {
    attempts++;
    await fs.writeFile(path.join(selected, 'unexpected'), 'never delete this');
    await fs.rmdir(selected);
  } }), { code: 'ENOTEMPTY' });
  assert.equal(attempts, 1);
  assert.equal(await fs.readFile(path.join(nonempty.context.prefix, 'unexpected'), 'utf8'), 'never delete this');
  await assert.rejects(fs.lstat(path.join(nonempty.context.bootstrapDirectory,
    'native-homebrew-prefix-cleanup.json')), { code: 'ENOENT' });
});

test('T-PRD015 isolated Homebrew bootstrap preserves complete plain transcripts without changing host homes or pins', async t => {
  const f = await fixture(t);
  const inherited = { ...f.environment, HOMEBREW_COLOR: '1', FORCE_COLOR: '1', CLICOLOR_FORCE: '1' };
  delete inherited.HOMEBREW_NO_COLOR;
  delete inherited.NO_COLOR;
  const before = { ...inherited };
  const directory = path.join(f.root, 'bootstrap');
  const selected = nativeBootstrapEnvironment(directory, inherited);
  assert.deepEqual(inherited, before, 'Child log controls cannot mutate the host environment');
  assert.equal(selected.HOMEBREW_NO_COLOR, '1');
  assert.equal(selected.NO_COLOR, '1');
  assert.equal(selected.HOMEBREW_COLOR, undefined);
  assert.equal(selected.FORCE_COLOR, undefined);
  assert.equal(selected.CLICOLOR_FORCE, undefined);
  for (const key of ['HOME', 'USERPROFILE', 'COPILOT_HOME', 'HOMEBREW_CACHE', 'HOMEBREW_TEMP']) {
    const relative = path.relative(directory, selected[key]);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  }
  const plain = '==> Downloading pinned Homebrew dependency\n';
  const colored = '\u001b[34m==>\u001b[0m \u001b[1mDownloading pinned Homebrew dependency\u001b[0m\n';
  const count = 24;
  const source = `const plain=${JSON.stringify(plain)},colored=${JSON.stringify(colored)};` +
    `process.stdout.write((process.env.HOMEBREW_NO_COLOR||process.env.NO_COLOR?plain:colored).repeat(${count}));`;
  const rejected = await f.run('brew-colored-control', process.execPath, ['--eval', source],
    { environment: inherited });
  assert.equal(rejected.complete, false);
  assert.ok(rejected.causes.some(cause => cause.type === 'output' && ['UNSAFE', 'CAPACITY'].includes(cause.code)));
  assert.equal(rejected.originalOutput.stdout.sha256, fixtureSHA(Buffer.from(colored.repeat(count))));
  const captured = await f.run('brew-plain-logs', process.execPath, ['--eval', source],
    { environment: selected });
  assert.equal(captured.complete, true, captured.diagnostic);
  assert.equal(captured.exitCode, 0);
  assert.equal(captured.stdout, plain.repeat(count));
  assert.equal(captured.originalOutput.stdout.sha256, fixtureSHA(Buffer.from(plain.repeat(count))));
  await assert.rejects(fs.stat(directory), { code: 'ENOENT' });
});

test('T-PRD015 pre-Ruby Homebrew child avoids Actions forced colour while retaining real host context and raw fingerprints', async t => {
  const f = await fixture(t);
  const base = nativeBootstrapEnvironment(path.join(f.root, 'bootstrap'),
    { ...f.environment, GITHUB_ACTIONS: 'true', CI: 'true' });
  const selected = portableRubyBootstrapEnvironment(base);
  assert.equal(base.GITHUB_ACTIONS, 'true');
  assert.equal(selected.GITHUB_ACTIONS, undefined);
  assert.equal(selected.CI, 'true');
  assert.equal(selected.HOME, base.HOME);
  assert.equal(selected.SDLC_TEST_REPORT_CONTEXT, base.SDLC_TEST_REPORT_CONTEXT);
  assert.equal(nativeBootstrapExports(base).NO_COLOR, '1');
  assert.equal(Object.hasOwn(nativeBootstrapExports(base), 'GITHUB_ACTIONS'), false);
  const records = [
    ['arm64', 'e0088dff5614b39387300136ec7a5f95bf1e07589547245c919524fc9e8b4197',
      'dfbd10d59a3257d69d599383df2090d53ec2dd1a37b891d1bd9536019ad020b0'],
    ['x64', '57bebadc864405cbd39743e32eef741f4b75c0ba121f5cd9296ab84994b9f83b',
      'd82c0f08d38fa0117ae2796a1b034beaa5f470eba024f9a708615a90dd3b6a94'],
  ];
  for (const [arch, pin, observedHash] of records) {
    const message = `Downloading https://ghcr.io/v2/homebrew/core/portable-ruby/blobs/sha256:${pin}`;
    const plain = `==> ${message}\n`;
    const colored = `\u001b[34m==>\u001b[0m \u001b[1m${message}\u001b[0m\n`;
    const source = "if(process.env.GITHUB_ACTIONS)process.env.HOMEBREW_COLOR='1';" +
      `process.stderr.write(process.env.HOMEBREW_COLOR?${JSON.stringify(colored)}:${JSON.stringify(plain)});`;
    const rejected = await f.run(`ruby-actions-${arch}`, process.execPath, ['--eval', source],
      { environment: base });
    assert.equal(rejected.complete, false);
    assert.ok(rejected.causes.some(cause => cause.type === 'output' && cause.code === 'UNSAFE'));
    assert.equal(rejected.originalOutput.stderr.bytes, 158);
    assert.equal(rejected.originalOutput.stderr.sha256, observedHash);
    const captured = await f.run(`ruby-plain-${arch}`, process.execPath, ['--eval', source],
      { environment: selected });
    assert.equal(captured.complete, true, captured.diagnostic);
    assert.equal(captured.exitCode, 0);
    assert.equal(captured.stderr, plain);
    assert.equal(captured.originalOutput.stderr.sha256, fixtureSHA(Buffer.from(plain)));
  }
});

test('T-PRD015 schema pip cache and runtime paths override relative ambient locations without installing dependencies', async t => {
  const f = await fixture(t);
  const inherited = { ...f.environment, PIP_CACHE_DIR: 'pip', PIP_BUILD_TRACKER: 'pip',
    PIP_SRC: 'pip-source', PYTHONPYCACHEPREFIX: 'pip-bytecode',
    APPDATA: 'relative-app-data', LOCALAPPDATA: 'relative-local-app-data' };
  const directory = path.join(f.root, 'owned bootstrap');
  const selected = nativeBootstrapEnvironment(directory, inherited);
  for (const key of ['PIP_CACHE_DIR', 'PIP_BUILD_TRACKER', 'PIP_SRC', 'PYTHONPYCACHEPREFIX',
    'PYTHONUSERBASE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CACHE_HOME', 'TMPDIR', 'TMP', 'TEMP']) {
    assert.ok(path.isAbsolute(selected[key]), key);
    const relative = path.relative(directory, selected[key]);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), key);
  }
  assert.equal(inherited.PIP_CACHE_DIR, 'pip');
  const exported = nativeBootstrapExports(selected);
  assert.equal(exported.PIP_CACHE_DIR, selected.PIP_CACHE_DIR);
  assert.equal(exported.PIP_BUILD_TRACKER, selected.PIP_BUILD_TRACKER);
  assert.equal(exported.APPDATA, selected.APPDATA);
  assert.equal(exported.LOCALAPPDATA, selected.LOCALAPPDATA);
  const python = process.env.SDLC_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const relative = await f.run('pip-relative-cache-probe', python,
    ['-m', 'pip', '--disable-pip-version-check', 'cache', 'dir'],
    { cwd: f.root, environment: inherited });
  assert.equal(relative.complete, true, relative.diagnostic);
  assert.equal(relative.exitCode, 0, relative.stderr);
  assert.equal(path.relative(path.join(f.root, 'pip'), path.resolve(f.root, relative.stdout.trim())), '');
  const owned = await f.run('pip-owned-cache-probe', python,
    ['-m', 'pip', '--disable-pip-version-check', 'cache', 'dir'],
    { cwd: f.root, environment: selected });
  assert.equal(owned.complete, true, owned.diagnostic);
  assert.equal(owned.exitCode, 0, owned.stderr);
  assert.equal(path.relative(selected.PIP_CACHE_DIR, path.resolve(owned.stdout.trim())), '');
  const args = schemaPipInstallArguments(selected);
  const cacheOption = args.indexOf('--cache-dir');
  assert.ok(cacheOption >= 0);
  assert.equal(args[cacheOption + 1], selected.PIP_CACHE_DIR);
  const explicit = await f.run('pip-explicit-cache-probe', python,
    ['-m', 'pip', '--disable-pip-version-check', '--cache-dir', selected.PIP_CACHE_DIR, 'cache', 'dir'],
    { cwd: f.root, environment: { ...selected, PIP_CACHE_DIR: 'pip' } });
  assert.equal(explicit.complete, true, explicit.diagnostic);
  assert.equal(explicit.exitCode, 0, explicit.stderr);
  assert.equal(path.relative(selected.PIP_CACHE_DIR, path.resolve(explicit.stdout.trim())), '');
  assert.throws(() => schemaPipInstallArguments({ PIP_CACHE_DIR: 'pip' }), { code: 'INPUT' });
  await assert.rejects(fs.stat(path.join(f.root, 'pip')), { code: 'ENOENT' });
});

test('T-PRD015 Homebrew bottle preflight rejects absent native or non-relocatable prerequisites before source compilation', () => {
  const prefix = path.join(repositoryRoot, '.test-data', 'virtual-owned-homebrew');
  const entry = (name, version, sha) => ({
    name, version, pkgVersion: version, prefix: path.join(prefix, 'Cellar', name, version),
    bottleTag: 'sequoia', bottleAvailable: true, builtCellar: '/usr/local/Cellar',
    sha256: sha.repeat(64), compatible: true, pourable: true,
  });
  const plan = { schemaVersion: 1, kind: 'native-homebrew-bottle-plan', prefix,
    cellar: path.join(prefix, 'Cellar'), architecture: 'x86_64', rubyPlatform: 'x86_64-darwin24',
    rubyVersion: homebrewToolchain.ruby, nativeTag: 'sequoia', macosVersion: '15.7.1',
    relocationEnabled: true, entries: [
      entry(homebrewToolchain.formula, homebrewToolchain.node, 'a'), entry('openssl@3', '3.5.9', 'b'),
    ] };
  assert.equal(requireHomebrewBottlePlan(plan, { prefix, target: 'macos-x64' }), plan);
  for (const mutate of [
    selected => { selected.entries[0].bottleTag = null; selected.entries[0].pourable = false; },
    selected => { selected.entries[1].compatible = false; },
    selected => { selected.entries[0].bottleTag = 'arm64_sequoia'; },
    selected => { selected.entries[0].version = '22.99.0'; },
    selected => { selected.entries[0].prefix = path.join(path.parse(prefix).root, 'unowned', 'node'); },
    selected => { selected.architecture = 'arm64'; },
    selected => { selected.nativeTag = 'arm64_sequoia'; },
    selected => { selected.macosVersion = '26.0'; },
    selected => { selected.entries[0].bottleAvailable = false; },
    selected => { selected.entries[0].builtCellar = '/Cellar'; },
    selected => { selected.entries[0].builtCellar = 'relative/Cellar'; },
    selected => { selected.relocationEnabled = 'false'; },
    selected => { selected.entries[1].sha256 = 'not-an-integrity-digest'; },
  ]) {
    const changed = structuredClone(plan);
    mutate(changed);
    assert.throws(() => requireHomebrewBottlePlan(changed, { prefix, target: 'macos-x64' }), { code: 'HOST' });
  }
  const missing = structuredClone(plan);
  missing.entries[0].bottleTag = null;
  missing.entries[0].bottleAvailable = false;
  missing.entries[0].pourable = false;
  assert.throws(() => requireHomebrewBottlePlan(missing, { prefix, target: 'macos-x64' }),
    new RegExp(`${homebrewToolchain.formula}.*no matching native bottle.*available=false.*Source compilation is not permitted`, 'u'));
  const incompatible = structuredClone(plan);
  incompatible.entries[0].compatible = false;
  assert.throws(() => requireHomebrewBottlePlan(incompatible, { prefix, target: 'macos-x64' }),
    /available=true; compatible=false.*builtCellar=\/usr\/local\/Cellar.*Source compilation is not permitted/u);
  const receipts = plan.entries.map(selected => ({
    name: selected.name, pkgVersion: selected.pkgVersion, prefix: selected.prefix,
    receipt: { poured_from_bottle: true, source: { versions: { stable: selected.version } } } }));
  assert.equal(requireHomebrewBottleReceipts(plan, receipts), receipts);
  for (const mutate of [
    selected => { selected.pop(); },
    selected => { selected[0].receipt.poured_from_bottle = false; },
    selected => { selected[1].receipt.source.versions.stable = 'wrong-version'; },
    selected => { selected[1].pkgVersion = 'wrong-revision'; },
    selected => { selected[1].prefix = path.join(path.parse(prefix).root, 'global-prefix'); },
    selected => { selected.push({ ...selected[0], name: 'unexpected-source-dependency' }); },
    selected => { selected[1] = selected[0]; },
  ]) {
    const changed = structuredClone(receipts);
    mutate(changed);
    assert.throws(() => requireHomebrewBottleReceipts(plan, changed), { code: 'HOST' });
  }
});

test('T-PRD015 actual pinned Go, Python schema and static validators execute valid and invalid owned inputs', async t => {
  const f = await fixture(t);
  const go = process.env.SDLC_GO || 'go';
  const python = process.env.SDLC_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const requirements = (await fs.readFile('.github/release-requirements.txt', 'utf8'))
    .trim().split(/\r?\n/u).map(line => line.split('=='));
  const pythonIdentity = await f.run('python-identity', python, ['-c',
    'import sys,json,importlib.metadata; print(json.dumps({"version":sys.version.split()[0],"packages":' +
    `{p:importlib.metadata.version(p) for p in ${JSON.stringify(requirements.map(([name]) => name))}}}))`]);
  assert.equal(pythonIdentity.exitCode, 0, pythonIdentity.stderr);
  const actualPython = JSON.parse(pythonIdentity.stdout);
  assert.equal(actualPython.version, '3.12.10');
  assert.deepEqual(actualPython.packages, Object.fromEntries(requirements));
  const goVersion = await f.run('go-identity', go, ['version']);
  assert.equal(goVersion.exitCode, 0, goVersion.stderr);
  assert.match(goVersion.stdout, /^go version go1\.27\.1 /u);
  const launcher = await fixtureWindowsLauncher({
    outputDir: path.join(f.root, 'launcher'), goCommand: go, environment: f.environment,
  });

  const shared = path.join(f.root, 'shared');
  await fs.mkdir(path.join(shared, 'bin'), { recursive: true });
  await fs.copyFile(launcher.artifact, path.join(shared, 'bin', 'sdlc.exe'));
  const payload = await writePayloadFixture(shared, "throw new Error('Go integrity must not execute JavaScript');\n");
  await fs.writeFile(path.join(shared, 'platform.json'),
    fixtureCanonical({ ...payload.platform, platform: 'win32', arch: 'x64' }));
  const goEnvironment = { ...launcherBuildEnvironment(f.environment),
    GOOS: process.platform === 'win32' ? 'windows' : process.platform,
    GOARCH: process.arch === 'x64' ? 'amd64' : process.arch,
    GOCACHE: path.join(f.root, 'go-cache'), GOTMPDIR: path.join(f.root, 'tmp'),
    TMPDIR: path.join(f.root, 'tmp'), TEMP: path.join(f.root, 'tmp'), TMP: path.join(f.root, 'tmp'),
    SDLC_VERIFY_SHARED_ROOT: shared };
  const goTests = await f.run('go-tests', go, ['test', '-json', '-count=1', './...'], {
    cwd: path.join(repositoryRoot, 'cmd', 'sdlc-launcher'), environment: goEnvironment,
  });
  const sources = await Promise.all((await fs.readdir(path.join('cmd', 'sdlc-launcher')))
    .filter(file => file.endsWith('_test.go')).map(async file => ({
    file, contents: await fs.readFile(path.join('cmd', 'sdlc-launcher', file), 'utf8'),
  })));
  const reconciliation = reconcileGoExecution(sources, goTests);
  assert.equal(reconciliation.status, 'Passed', JSON.stringify({ reconciliation, stderr: goTests.stderr }));
  assert.equal(reconciliation.executions.length, reconciliation.expected.length);
  assert.equal(reconcileGoExecution(sources, { ...goTests,
    stdout: goTests.stdout.split('\n').filter(line => !line.includes('TestRuntimeValidation/minimum')).join('\n'),
  }).status, 'NotRun');
  const vet = await f.run('go-vet', go, ['vet', './...'], {
    cwd: path.join(repositoryRoot, 'cmd', 'sdlc-launcher'), environment: goEnvironment,
  });
  assert.equal(vet.exitCode, 0, vet.stderr);
  const manifests = path.join(f.root, 'manifests');
  const archive = path.join(f.root, 'ai-sdlc-framework-0.3.0-windows-x64.zip');
  const zip = Buffer.from([0x50, 0x4b, 3, 4, 1]);
  await fs.writeFile(archive, zip);
  await generateManifests({ outputDir: manifests, version: '0.3.0',
    releaseRepository: 'example/public-releases', archivePath: archive,
    archive: { filename: path.basename(archive), sha256: fixtureSHA(zip), size: zip.length } });
  const schemas = path.join(f.root, 'schemas');
  const validate = (name, schemaDir = schemas) => f.run(name, python, [
    'scripts/validate-winget-schema.py', '--manifest-dir', manifests, '--schema-dir', schemaDir,
  ]);
  const valid = await validate('schema-valid');
  assert.equal(valid.exitCode, 0, valid.stderr);
  assert.equal(JSON.parse(valid.stdout).schemaValidation, 'Passed');
  const installer = (await fs.readdir(manifests)).find(file => file.endsWith('.installer.yaml'));
  const manifestPath = path.join(manifests, installer);
  const original = await fs.readFile(manifestPath, 'utf8');
  await fs.writeFile(manifestPath, original.replace('Architecture: x64', 'Architecture: invalid'));
  const invalidManifest = await validate('schema-invalid-manifest');
  assert.equal(invalidManifest.complete, true);
  assert.equal(invalidManifest.exitCode, 1);
  assert.equal(JSON.parse(invalidManifest.stderr).schemaValidation, 'Failed');
  await fs.writeFile(manifestPath, original);
  const swapped = path.join(f.root, 'swapped-schemas');
  await fs.cp(schemas, swapped, { recursive: true });
  await fs.writeFile(path.join(swapped, 'manifest.installer.1.10.0.json'), '{}');
  const invalidSchema = await validate('schema-swapped', swapped);
  assert.notEqual(invalidSchema.exitCode, 0);
  assert.match(invalidSchema.stderr, /Official schema digest mismatch/u);
  const ignored = await fs.mkdtemp(path.join(repositoryRoot, 'test', '.runner-fixture-'));
  t.after(() => fs.rm(ignored, { recursive: true, force: true }));
  await fs.writeFile(path.join(ignored, 'incomplete.test.mjs'), 'this is deliberately incomplete JavaScript {');
  try {
    const staticCheck = await f.run('static-valid', process.execPath, ['scripts/check.mjs']);
    assert.equal(staticCheck.exitCode, 0, JSON.stringify({ stage: 'static-valid',
      complete: staticCheck.complete, diagnostic: staticCheck.diagnostic,
      report: path.relative(repositoryRoot, path.join(f.reportDir, 'static-valid.json')) }));
  } finally {
    await fs.rm(ignored, { recursive: true });
  }
  const broken = path.join(f.root, 'broken-static');
  await fs.mkdir(broken);
  for (const directory of ['src', 'bin', 'scripts', 'packaging', 'test', 'assets', 'docs']) {
    await fs.cp(directory, path.join(broken, directory), {
      recursive: true, filter: source => !path.basename(source).startsWith('.runner-fixture-'),
    });
  }
  await fs.copyFile('package.json', path.join(broken, 'package.json'));
  for (const file of ['README.md', 'CONTRIBUTING.md', 'SUPPORT.md', 'SECURITY.md',
    'CODE_OF_CONDUCT.md', 'OWNERSHIP.md', 'RELEASING.md', 'CHANGELOG.md', 'LICENSE']) {
    await fs.copyFile(file, path.join(broken, file));
  }
  const hooks = path.join(broken, 'assets', 'hooks', 'sdlc.json');
  const document = JSON.parse(await fs.readFile(hooks, 'utf8'));
  await fs.writeFile(hooks, JSON.stringify({ ...document, version: 99 }));
  await fs.writeFile(path.join(broken, 'verify-static.mjs'), `
try { const { check } = await import('./scripts/check.mjs'); await check(); }
catch (error) {
  if (error.code !== 'ERR_ASSERTION') throw error;
  console.error(JSON.stringify({code:error.code,message:error.message,actual:error.actual,expected:error.expected}));
  process.exitCode=1;
}
`);
  const invalidStatic = await f.run('static-invalid', process.execPath,
    ['verify-static.mjs'], { cwd: broken });
  assert.equal(invalidStatic.complete, true, JSON.stringify({ stage: 'static-invalid',
    diagnostic: invalidStatic.diagnostic,
    report: path.relative(repositoryRoot, path.join(f.reportDir, 'static-invalid.json')) }));
  assert.notEqual(invalidStatic.exitCode, 0);
  const rejectedHooks = JSON.parse(invalidStatic.stderr);
  assert.equal(rejectedHooks.code, 'ERR_ASSERTION');
  assert.equal(rejectedHooks.actual, 99);
  assert.equal(rejectedHooks.expected, 1);
  assert.match(invalidStatic.stderr, /99 !== 1/u);
});

test('T-PRD018 tool processes retain failures, sanitized partial output and cancellation without surviving children', async t => {
  const f = await fixture(t);
  const failing = path.join(f.root, 'failing.mjs');
  await fs.writeFile(failing, "process.stderr.write('actual validator failure\\n');process.exitCode=7;\n");
  const failure = await f.run('failure', process.execPath, [failing]);
  assert.equal(failure.complete, true);
  assert.equal(failure.exitCode, 7);
  assert.match(failure.stderr, /actual validator failure/u);
  await assert.rejects(f.run('failure', process.execPath, [failing]), { code: 'EEXIST' });
  const marker = path.join(f.root, 'ready.json');
  const waiting = path.join(f.root, 'waiting.mjs');
  const observePosix = ['darwin', 'linux'].includes(process.platform);
  const originalReady = new Map();
  const originalStarts = new Map();
  const lifetime = randomUUID();
  const childReady = `${marker}.child`;
  const rootReady = `${marker}.parent`;
  const readySource = destination => `writeFileSync(${JSON.stringify(`${destination}.tmp`)},
JSON.stringify({pid:process.pid,ppid:process.ppid,lifetime:${JSON.stringify(lifetime)},
observedAtMs:Date.now(),uptimeMs:Math.floor(process.uptime()*1000)}));
renameSync(${JSON.stringify(`${destination}.tmp`)},${JSON.stringify(destination)});`;
  const childSource = observePosix ?
    `const {writeFileSync,renameSync}=require('node:fs');${readySource(childReady)}setInterval(()=>{},1000)` :
    'setInterval(()=>{},1000)';
  await fs.writeFile(waiting, `import {writeFileSync,renameSync} from 'node:fs';
import {spawn} from 'node:child_process';
const child=spawn(process.execPath,['-e',${JSON.stringify(childSource)}],{stdio:'ignore'});
${observePosix ? readySource(rootReady) : ''}
process.stdout.write('Authorization: Bearer ');
process.stdout.write('fixture-secret-value\\n');
writeFileSync(${JSON.stringify(`${marker}.tmp`)},JSON.stringify({parent:process.pid,child:child.pid}));
renameSync(${JSON.stringify(`${marker}.tmp`)},${JSON.stringify(marker)});
setInterval(()=>{},1000);
`);
  const cancellation = new AbortController();
  const pending = f.run('cancelled', process.execPath, [waiting], { signal: cancellation.signal });
  t.after(async () => { cancellation.abort(); await pending; });
  const deadline = Date.now() + 20000;
  let pids;
  while (!pids) {
    try {
      const ready = JSON.parse(await fs.readFile(marker, 'utf8'));
      if (observePosix) {
        originalReady.set(ready.parent, JSON.parse(await fs.readFile(rootReady, 'utf8')));
        originalReady.set(ready.child, JSON.parse(await fs.readFile(childReady, 'utf8')));
      }
      pids = ready;
    }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      assert.ok(Date.now() < deadline, 'Owned validation process never reached its ready barrier');
      await delay(10);
    }
  }
  const observeOwned = async (phase, completedAtMs = 0) => {
    const queryStartedAtMs = Date.now();
    let query;
    try {
      query = await new Promise(resolve => childProcess.execFile('/bin/ps',
        ['-p', Object.values(pids).join(','), '-o', 'pid=', '-o', 'ppid=', '-o', 'pgid=',
          '-o', 'stat=', '-o', 'lstart='],
        { encoding: 'utf8', timeout: 1000, maxBuffer: 2048,
          env: { ...f.environment, LC_ALL: 'C', TZ: 'UTC' } },
        (error, stdout) => resolve({ error, stdout })));
    } catch (error) { query = { error, stdout: '' }; }
    const queryFinishedAtMs = Date.now();
    const rows = new Map();
    let valid = !query.error || query.error.code === 1 && !query.stdout.trim();
    for (const line of query.stdout.trim().split('\n').filter(Boolean)) {
      const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([A-Za-z+<>=-]{1,16})\s+((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s*$/u.exec(line);
      const pid = Number(match?.[1]);
      if (!match || !Object.values(pids).includes(pid) || rows.has(pid)) { valid = false; break; }
      rows.set(pid, { ppid: Number(match[2]), pgid: Number(match[3]), state: match[4],
        start: match[5].replace(/\s+/gu, ' ') });
    }
    for (const pid of Object.values(pids)) {
      const row = valid ? rows.get(pid) : null;
      const ready = originalReady.get(pid);
      if (phase === 'before-cancel' && row) originalStarts.set(pid, row.start);
      const cause = query.error ? processDiagnostic(query.error) : null;
      t.diagnostic(JSON.stringify({
        kind: 'owned-cancellation-observation', phase, pid, completedAtMs,
        queryStartedAtMs, queryFinishedAtMs,
        timing: phase === 'before-cancel' ? 'before-trigger' : 'after-strict-failure-not-at-return',
        observation: !valid ? 'unknown' : row ? 'present-at-query' : 'no-row-at-query',
        ppid: row?.ppid ?? -1, pgid: row?.pgid ?? -1, state: row?.state ?? 'unknown',
        start: row?.start ?? 'unknown', startPrecision: 'one-second',
        originalStart: originalStarts.get(pid) ?? 'unknown',
        creationComparison: !row || !originalStarts.has(pid) ? 'unknown' :
          row.start === originalStarts.get(pid) ? 'same-start-second-not-unique-proof' : 'different-start',
        readyPid: Number.isSafeInteger(ready?.pid) ? ready.pid : -1,
        readyPpid: Number.isSafeInteger(ready?.ppid) ? ready.ppid : -1,
        readyAtMs: Number.isSafeInteger(ready?.observedAtMs) ? ready.observedAtMs : -1,
        readyUptimeMs: Number.isSafeInteger(ready?.uptimeMs) ? ready.uptimeMs : -1,
        lifetime: ready?.lifetime === lifetime ? lifetime : 'unknown',
        queryCode: cause?.code ?? 'OK',
        queryExitCode: Number.isInteger(query.error?.code) ? query.error.code : -1,
        queryErrorSha256: cause?.original.sha256 ?? 'none',
        queryErrorBytes: cause?.original.bytes ?? 0,
      }));
    }
  };
  if (observePosix) await observeOwned('before-cancel');
  cancellation.abort();
  const interrupted = await pending;
  const completedAtMs = Date.now();
  assert.equal(interrupted.complete, false);
  assert.match(interrupted.diagnostic, /cancelled/u);
  assert.ok(!interrupted.stdout.includes('fixture-secret-value'));
  const journal = await fs.readFile(path.join(f.reportDir, 'cancelled.journal.ndjson'), 'utf8');
  assert.ok(!journal.includes('fixture-secret-value'));
  assert.ok(journal.trim().split('\n').map(JSON.parse).some(row => row.kind === 'command-end' &&
    row.complete === false));
  try {
    for (const pid of Object.values(pids)) {
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, `Owned process ${pid} survived cancellation`);
    }
  } catch (error) {
    try {
      if (observePosix) await observeOwned('after-strict-failure', completedAtMs);
    } finally { throw error; }
  }
  for (const [index, order] of (process.platform === 'win32' ?
    ['stop-failure-before-exit', 'exit-before-stop-failure'] : ['signal-failure-before-exit']).entries()) {
    const directory = path.join(f.root, `stop-race-${index}`);
    await fs.mkdir(directory);
    const ready = path.join(directory, 'ready.json');
    const trigger = path.join(directory, 'emit-unsafe');
    const finish = path.join(directory, 'finish');
    const source = path.join(directory, 'owned.mjs');
    const unsafe = "{authorization:'fixture-stop-race'}\n";
    const tail = 'owned process completed naturally\n';
    await fs.writeFile(source, `import {existsSync,writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
let emitted=false,finished=false;
writeFileSync(${JSON.stringify(ready)},JSON.stringify({pid:process.pid}));
while(!finished){
  if(!emitted&&existsSync(${JSON.stringify(trigger)})){
    emitted=true;process.stdout.write(${JSON.stringify(unsafe)});
  }
  if(!finished&&existsSync(${JSON.stringify(finish)})){
    finished=true;process.stdout.write(${JSON.stringify(tail)});
  }
  if(!finished)await delay(10);
}
`);
    const originalSpawn = childProcess.spawn;
    const originalKill = process.kill;
    let owned;
    let control;
    let observedStop;
    let rejectStop;
    const stopped = new Promise((resolve, reject) => { observedStop = resolve; rejectStop = reject; });
    const stopOutcome = stopped.then(() => null, error => error);
    const barrier = setTimeout(() => rejectStop(new Error('Owned stop request did not reach its barrier')), 20000);
    t.mock.method(childProcess, 'spawn', (command, args, options) => {
      if (process.platform === 'win32' && path.basename(command).toLowerCase() === 'taskkill.exe') {
        assert.ok(owned?.pid, 'A stop request may select only this actually spawned fixture');
        assert.deepEqual(args, ['/PID', String(owned.pid), '/T', '/F']);
        control = Object.assign(new EventEmitter(), { stderr: new PassThrough() });
        observedStop();
        return control;
      }
      const spawned = originalSpawn(command, args, options);
      if (command === process.execPath && args[0] === source) owned = spawned;
      return spawned;
    });
    if (process.platform !== 'win32') t.mock.method(process, 'kill', (pid, signal) => {
      if (owned && pid === -owned.pid && signal === 'SIGTERM') {
        observedStop();
        throw Object.assign(new Error('Owned fixture stop is unsupported'), { code: 'ENOTSUP' });
      }
      return originalKill(pid, signal);
    });
    syncBuiltinESMExports();
    const name = `stop-race-${index}`;
    const pending = f.run(name, process.execPath, [source]);
    const settled = pending.then(value => ({ value }), error => ({ error }));
    try {
      const deadline = Date.now() + 20000;
      for (;;) {
        try { await fs.readFile(ready); break; }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          assert.ok(Date.now() < deadline, 'Owned process did not reach its ready barrier');
          await delay(10);
        }
      }
      assert.equal(JSON.parse(await fs.readFile(path.join(f.reportDir, `${name}.json`), 'utf8')).complete, false,
        'An in-flight command must retain a nonempty incomplete report before output or stop failures');
      await fs.writeFile(trigger, '', { flag: 'wx' });
      const stopFailure = await stopOutcome;
      if (stopFailure) throw stopFailure;
      clearTimeout(barrier);
      const closed = new Promise(resolve => owned.once('close', resolve));
      const failControl = () => {
        control.stderr.end('Operation not supported for the owned fixture tree.\n');
        control.emit('close', 1, null);
      };
      if (order === 'stop-failure-before-exit') failControl();
      if (order !== 'exit-before-stop-failure') {
        const deadline = Date.now() + 20000;
        let partial;
        let latest;
        while (!partial) {
          try {
            const reportPath = path.join(f.reportDir, `${name}.json`);
            // A pending Windows reader can deny the writer's bounded atomic replacement.
            const value = JSON.parse(process.platform === 'win32' ?
              readFileSync(reportPath, 'utf8') : await fs.readFile(reportPath, 'utf8'));
            latest = value;
            if (value.cleanup.outcome === 'uncertain') partial = value;
          } catch (error) {
            if (!(error instanceof SyntaxError)) throw error;
          }
          if (!partial) {
            if (Date.now() >= deadline) {
              const events = (await fs.readFile(path.join(f.reportDir, `${name}.journal.ndjson`), 'utf8'))
                .trim().split('\n').map(JSON.parse);
              assert.fail(`Uncertain cleanup did not retain its pending original report: ${
                JSON.stringify({ order, report: latest, events: events.map(event => ({
                  kind: event.kind, cleanup: event.cleanup, cause: event.cause,
                })) })}`);
            }
            await delay(10);
          }
        }
        assert.equal(partial.complete, false);
        assert.equal(partial.finishedAt, null);
        assert.equal(partial.pid, owned.pid);
        assert.equal(partial.originalOutput.stdout.sha256, fixtureSHA(Buffer.from(unsafe)));
      }
      await fs.writeFile(finish, '', { flag: 'wx' });
      if (order === 'exit-before-stop-failure') {
        await closed;
        failControl();
      }
      const result = await settled;
      if (result.error) throw result.error;
      const report = result.value;
      assert.equal(report.complete, false);
      assert.equal(report.exitCode, 0, 'Keep the actual natural exit distinct from failed cleanup/retention');
      assert.equal(report.cleanup.outcome, 'uncertain');
      assert.equal(report.cleanup.pid, owned.pid);
      assert.equal(report.cleanup.survivorsVerified, false);
      assert.ok(report.causes.some(cause => cause.type === 'output' && cause.code === 'UNSAFE'));
      assert.ok(report.causes.some(cause => cause.type === 'cleanup'));
      assert.equal(report.originalOutput.stdout.sha256, fixtureSHA(Buffer.from(unsafe + tail)));
      assert.equal(report.originalOutput.stdout.bytes, Buffer.byteLength(unsafe + tail));
      assert.ok(!report.stdout.includes('fixture-stop-race'));
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.reportDir, `${name}.json`), 'utf8')), report);
      const events = (await fs.readFile(path.join(f.reportDir, `${name}.journal.ndjson`), 'utf8'))
        .trim().split('\n').map(JSON.parse);
      assert.ok(events.some(event => event.kind === 'command-end' && event.complete === false &&
        event.cleanup.outcome === 'uncertain'));
      assert.throws(() => originalKill(owned.pid, 0), { code: 'ESRCH' });
    } finally {
      clearTimeout(barrier);
      await fs.writeFile(finish, '');
      if (control && control.listenerCount('close')) {
        control.stderr.end();
        control.emit('close', 1, null);
      }
      await settled;
      t.mock.restoreAll();
      syncBuiltinESMExports();
    }
  }
});

test('T-PRD018 command checkpoints recover Windows sharing conflicts without hiding permanent persistence failures', async t => {
  const f = await fixture(t);
  const source = path.join(f.root, 'checkpoint.mjs');
  const output = 'owned checkpoint output\n';
  await fs.writeFile(source, `process.stdout.write(${JSON.stringify(output)});\n`);
  const originalRename = fsPromises.rename;
  for (const mode of ['transient', 'permanent', 'nontransient']) {
    const name = `checkpoint-${mode}`;
    const reportPath = path.join(f.reportDir, `${name}.json`);
    const failure = Object.assign(new Error(`Owned checkpoint ${mode} replacement failure`),
      { code: mode === 'nontransient' ? 'EIO' : 'EPERM' });
    const attempts = [];
    let previous;
    let clock = 0;
    const mockedClock = t.mock.method(Date, 'now', () => clock);
    const mocked = t.mock.method(fsPromises, 'rename', async (staged, destination) => {
      if (destination === reportPath) {
        const bytes = readFileSync(staged);
        const snapshot = JSON.parse(bytes);
        if (snapshot.checkpoint.phase === 'finished') {
          assert.equal(snapshot.cleanup.rootExitObserved, true);
          previous ??= readFileSync(reportPath);
          attempts.push({ staged, sha256: fixtureSHA(bytes) });
          if (mode !== 'transient' || attempts.length === 1) {
            clock += 10;
            throw failure;
          }
        }
      }
      return originalRename(staged, destination);
    });
    syncBuiltinESMExports();
    try {
      if (mode === 'transient' && process.platform === 'win32') {
        const report = await f.run(name, process.execPath, [source]);
        assert.equal(report.complete, true);
        assert.equal(report.exitCode, 0);
        assert.deepEqual(report.causes, []);
        assert.equal(report.stdout, output);
        assert.equal(report.originalOutput.stdout.sha256, fixtureSHA(Buffer.from(output)));
        assert.deepEqual(JSON.parse(await fs.readFile(reportPath, 'utf8')), report);
        assert.equal(attempts.length, 2);
        assert.deepEqual(attempts[1], attempts[0], 'Retry the same flushed atomic snapshot');
      } else {
        await assert.rejects(f.run(name, process.execPath, [source]), error => error === failure);
        assert.deepEqual(await fs.readFile(reportPath), previous,
          'A failed replacement must preserve the previous incomplete checkpoint');
        assert.equal(JSON.parse(previous).complete, false);
        if (mode === 'nontransient' || process.platform !== 'win32') assert.equal(attempts.length, 1);
      }
      assert.ok(attempts.length > 0, 'The actual final command checkpoint must encounter the injected fault');
      for (const staged of new Set(attempts.map(attempt => attempt.staged))) {
        await assert.rejects(fs.stat(staged), { code: 'ENOENT' });
      }
      const retained = JSON.parse(await fs.readFile(reportPath, 'utf8'));
      const journal = await fs.readFile(path.join(f.reportDir, `${name}.journal.ndjson`));
      const reference = retained.checkpoint.originalJournalPrefix;
      assert.equal(fixtureSHA(journal.subarray(0, reference.bytes)), reference.sha256);
      const events = journal.toString('utf8').trim().split('\n').map(JSON.parse);
      assert.equal(events.at(-1).kind, 'command-end',
        'A final persistence failure must not start another stop or checkpoint after command closure');
      assert.equal(retained.cleanup.requested, false);
      assert.ok(Number.isSafeInteger(retained.pid));
      assert.throws(() => process.kill(retained.pid, 0), { code: 'ESRCH' });
    } finally {
      mocked.mock.restore();
      mockedClock.mock.restore();
      syncBuiltinESMExports();
    }
  }
});

test('T-PRD024 owner and external review policy keep identical CI and conversation requirements without self-approval', () => {
  const policy = { ownerId: 11, now, maxAgeMs: 60000 };
  const owner = approvalPr();
  owner.reviews.items = [];
  assert.equal(evaluateApproval(owner, policy).status, 'Passed');
  assert.equal(evaluateApproval(owner, policy).enforcement, 'provider-enforcement-unverified');
  const external = approvalPr(22);
  assert.equal(evaluateApproval(external, policy).status, 'Passed');
  for (const change of [
    value => { value.reviews.items = []; },
    value => { value.reviews.items[0].commitSha = 'c'.repeat(40); },
    value => { value.reviews.items[0].state = 'DISMISSED'; },
    value => { value.reviews.items.push({ id: 2, actorId: 11, state: 'CHANGES_REQUESTED', commitSha: sourceA }); },
    value => { value.reviews.complete = false; },
    value => { value.reviews.observedAt = new Date(now - 60001).toISOString(); },
  ]) {
    const changed = structuredClone(external);
    change(changed);
    assert.equal(evaluateApproval(changed, policy).status, 'NotRun');
  }
});

test('T-PRD080 unresolved, reopened, missing and stale conversations block both author classes independently of approval', () => {
  const policy = { ownerId: 11, now, maxAgeMs: 60000 };
  for (const authorId of [11, 22]) {
    const pr = approvalPr(authorId);
    pr.protection = { observed: true, conversations: true, capability: 'Available' };
    pr.threads.unresolved = 1;
    assert.equal(evaluateConversations(pr, policy).status, 'NotRun');
    assert.equal(evaluateApproval(pr, policy).status, 'Passed');
    pr.threads.unresolved = 0;
    assert.equal(evaluateConversations(pr, policy).status, 'Passed');
    pr.threads.unresolved = 2;
    assert.equal(evaluateConversations(pr, policy).status, 'NotRun');
    pr.threads.unresolved = 0;
    pr.threads.complete = false;
    assert.equal(evaluateConversations(pr, policy).status, 'NotRun');
    pr.threads.complete = true;
    pr.threads.headSha = 'c'.repeat(40);
    assert.equal(evaluateConversations(pr, policy).status, 'NotRun');
    pr.threads.headSha = sourceA;
    pr.threads.observedAt = new Date(now - 60001).toISOString();
    assert.equal(evaluateConversations(pr, policy).status, 'NotRun');
  }
});

test('T-PRD085 all shared status contexts reserve non-passing capacity and reconcile lost replies without blind retries', async () => {
  for (const context of statusContexts) {
    for (const count of [997, 998, 999, 1000]) {
      const f = statusFixture(context, count);
      const result = await reconcileStatusKey(f.host, f.key, f.policy);
      assert.equal(result.status, 'NotRun');
      assert.ok(!f.writes.some(write => write.value.state === 'success'));
      if (count === 1000) {
        assert.equal(f.writes.length, 0);
        assert.match(result.reason, /enforcement is unavailable/u);
      } else {
        assert.equal(f.items.at(-1).state, 'error');
        assert.ok(f.items.length <= 1000);
        const before = f.writes.length;
        f.snapshot.prs[0].verdicts[context].inputDigest = digest('edited metadata after cutoff');
        assert.equal((await reconcileStatusKey(f.host, f.key, f.policy)).status, 'NotRun');
        assert.equal(f.writes.length, before, 'A confirmed capacity error freezes its exact key');
      }
    }
    const lost = statusFixture(context);
    const publish = lost.host.publish;
    let lostOnce = false;
    lost.host.publish = async (...args) => {
      const result = await publish(...args);
      if (!lostOnce) { lostOnce = true; throw Object.assign(new Error('lost POST reply'), { code: 'TIMEOUT' }); }
      return result;
    };
    assert.equal((await reconcileStatusKey(lost.host, lost.key, lost.policy)).status, 'Passed');
    assert.deepEqual(lost.writes.map(write => write.value.state), ['pending', 'success']);
    for (const code of ['TIMEOUT', 'RATE_LIMIT']) {
      const absent = statusFixture(context);
      let attempts = 0;
      absent.host.publish = async () => { attempts++; throw Object.assign(new Error('uncertain POST'), { code }); };
      const result = await reconcileStatusKey(absent.host, absent.key, absent.policy);
      assert.equal(result.status, 'NotRun');
      assert.equal(attempts, 1);
      assert.match(result.reason, /not a blind retry/u);
    }
  }
});

test('T-PRD085 shared membership, metadata changes, pagination and stale events cannot overwrite another PR verdict', async () => {
  const f = statusFixture();
  f.snapshot.prs[1].verdicts['framework/coverage'] = {
    status: 'NotRun', inputDigest: digest('missing description section'), blockers: ['Missing coverage section'],
  };
  const groups = sharedStatusKeys(f.snapshot).filter(group => group.context === 'framework/coverage');
  assert.equal(groups.find(group => group.sha === sourceA).status, 'NotRun');
  assert.equal(groups.find(group => group.sha === '1'.repeat(40)).status, 'Passed');
  assert.equal(groups.find(group => group.sha === '2'.repeat(40)).status, 'NotRun');
  assert.equal((await reconcileStatusKey(f.host, f.key, f.policy)).status, 'NotRun');
  assert.ok(f.writes.every(write => write.value.state !== 'success'));
  f.snapshot.prs.pop();
  assert.equal((await reconcileStatusKey(f.host, f.key, f.policy)).status, 'Passed');
  const written = f.writes.length;
  assert.equal((await reconcileStatusKey(f.host, f.key, f.policy)).status, 'Passed');
  assert.equal(f.writes.length, written, 'Fresh unchanged evaluation does not spend another status slot');
  f.snapshot.prs[0].verdicts['framework/coverage'] = {
    status: 'NotRun', inputDigest: digest('description deleted at unchanged SHA'), blockers: ['Missing coverage section'],
  };
  assert.equal((await reconcileStatusKey(f.host, f.key, f.policy)).status, 'NotRun');
  assert.equal(f.items.at(-1).state, 'failure');
  f.snapshot.complete = false;
  assert.equal(sharedStatusKeys(f.snapshot).every(group => group.status !== 'Passed'), true);
  f.host.statuses = async () => ({ complete: false, items: [] });
  const before = f.writes.length;
  assert.equal((await reconcileStatusKey(f.host, f.key, f.policy)).status, 'NotRun');
  assert.equal(f.writes.length, before);
});

test('T-PRD027 unavailable writer controls or foreign repository scope dispatch no status mutation or enforcement claim', async () => {
  const denied = statusFixture();
  denied.host.verifyWriterControl = async () => false;
  const result = await reconcileStatusKey(denied.host, denied.key, denied.policy);
  assert.equal(result.status, 'NotRun');
  assert.match(result.reason, /verified writer control/u);
  assert.equal(denied.writes.length, 0);
  await assert.rejects(reconcileStatusKey(denied.host, { ...denied.key, repositoryId: 18 }, denied.policy),
    { code: 'SCOPE' });
  assert.equal(evaluateApproval(approvalPr(), { ownerId: 11, now, maxAgeMs: 60000 }).enforcement,
    'provider-enforcement-unverified');
});

test('T-PRD085 a source or description race after success immediately restores a non-passing provider status', async () => {
  const f = statusFixture();
  const publish = f.host.publish;
  f.host.publish = async (key, value) => {
    const record = await publish(key, value);
    if (value.state === 'success') f.snapshot.prs[0].verdicts[key.context] = {
      status: 'NotRun', inputDigest: digest('body changed during publication'), blockers: ['Stale metadata'],
    };
    return record;
  };
  assert.equal((await reconcileStatusKey(f.host, f.key, f.policy)).status, 'NotRun');
  assert.deepEqual(f.writes.map(write => write.value.state), ['pending', 'success', 'failure']);
  assert.equal(f.items.at(-1).state, 'failure');
  const all = statusFixture();
  const result = await reconcilePrReadiness(all.host, all.policy);
  assert.equal(result.status, 'Passed');
  assert.deepEqual(new Set(all.writes.map(write => write.key.context)), new Set(statusContexts));
  const coverage = sharedStatusKeys(all.snapshot).find(group => group.context === all.key.context);
  assert.equal(planStatusUpdate(coverage, { complete: false, items: all.items }, {
    writerId: 42, writerControl: true,
  }).action, 'blocked');
});

const checkoutPin = 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262';
const ciDefinition = `name: CI
on: pull_request
permissions:
  contents: read
jobs:
  native:
    strategy:
      matrix:
        include: ${JSON.stringify(nativeLegacyPrParts.map(part => ({ ...part,
    os: { 'linux-x64': 'ubuntu-24.04', 'windows-x64': 'windows-2022',
      'macos-arm64': 'macos-15', 'macos-x64': 'macos-15-intel' }[part.target],
    architecture: part.target.split('-')[1] })))}
    steps:
      - uses: ${checkoutPin}
        with:
          persist-credentials: false
`;
function writerDefinition() {
  return `on: workflow_dispatch
permissions:
  contents: read
  actions: read
  pull-requests: read
  statuses: write
concurrency:
  group: ${statusConcurrencyGroup}
  cancel-in-progress: false
jobs:
  observe:
    steps:
      - uses: ${checkoutPin}
        with:
          ref: \${{ github.event.repository.default_branch }}
          persist-credentials: false
`;
}

function mutateWorkflowSource(source, edit, label) {
  const original = source.contents.replace(/\r\n/gu, '\n');
  const changed = edit(original);
  assert.ok(changed !== original, `${source.file}: ${label} must change the actual semantic source`);
  source.contents = changed;
}

test('T-PRD022 actual workflow graph applies semantic YAML, effective permissions and immutable action policy', async () => {
  const workflows = await readWorkflowPolicySources(repositoryRoot);
  const positive = inspectWorkflowTrust(workflows);
  assert.equal(positive.complete, true, JSON.stringify(positive.blockers));
  assert.equal(positive.nativeResourcePolicy, 'arm-regression-allocation-v6-all-critical-bodies-first');
  const producer = positive.workflows.find(item => item.file === '.github/workflows/ci.yml');
  assert.deepEqual(producer.document.permissions, { contents: 'read' });
  assert.deepEqual(producer.jobs.find(job => job.id === 'mac-admission').effectivePermissions,
    { actions: 'read', contents: 'read' });
  assert.deepEqual(producer.jobs.find(job => job.id === 'intel-admission').effectivePermissions,
    { actions: 'read', contents: 'read' });
  assert.deepEqual(producer.jobs.find(job => job.id === 'intel-homebrew-admission').effectivePermissions,
    { actions: 'read', contents: 'read' });
  for (const key of ['intel-retained-admission', 'arm-refresh-admission']) {
    assert.deepEqual(producer.jobs.find(job => job.id === key).effectivePermissions,
      { actions: 'read', contents: 'read' });
  }
  for (const [file, edit, code] of [
    ['ci.yml', text => text.replace(checkoutPin, `"actions/checkout@v4"`), 'UNPINNED_ACTION'],
    ['ci.yml', text => text.replace(checkoutPin, `"unknown/action@${'f'.repeat(40)}"`), 'UNAPPROVED_ACTION'],
    ['ci.yml', text => text.replace('permissions:\n  contents: read', 'permissions: {"contents": "read", "id-token": "write"} # real grant'), 'EXCESS_WORKFLOW_PERMISSION'],
    ['ci.yml', text => text.replace('permissions:\n  contents: read', 'permissions: "write-all"'), 'UNSUPPORTED_PERMISSIONS'],
    ['pr-readiness.yml', text => text.replace('cancel-in-progress: false', 'cancel-in-progress: true'), 'STATUS_WRITER_NOT_SERIALIZED'],
    ['pr-readiness.yml', text => text.replace(statusConcurrencyGroup, `${statusConcurrencyGroup}-\${{ github.event.number }}`), 'STATUS_WRITER_NOT_SERIALIZED'],
    ['pr-readiness.yml', text => text.replace('github.event.repository.default_branch', 'github.event.pull_request.head.sha'), 'CANDIDATE_EXECUTION_IN_PRIVILEGED_WORKFLOW'],
    ['ci.yml', text => text.replace(checkoutPin, "'./.github/actions/../../untrusted'"), 'UNSAFE_LOCAL_ACTION'],
    ['ci.yml', text => text.replace(checkoutPin, "'./.github/actions/missing'"), 'MISSING_LOCAL_DEPENDENCY'],
    ['ci.yml', text => text.replace('permissions:\n  contents: read', 'permissions: &grants {contents: read}'), 'UNSUPPORTED_WORKFLOW_YAML'],
  ]) {
    const changed = structuredClone(workflows);
    const selected = changed.find(item => item.file === `.github/workflows/${file}`);
    selected.contents = selected.contents.replace(/\r?\n/gu, '\r\n');
    mutateWorkflowSource(selected, edit, code);
    const result = inspectWorkflowTrust(changed);
    assert.equal(result.complete, false);
    assert.ok(result.blockers.some(item => item.file === selected.file && item.code === code),
      JSON.stringify(result.blockers));
  }
  const commented = structuredClone(workflows);
  commented[0].contents += '\n# permissions: write-all\n# uses: actions/checkout@v4\n';
  assert.equal(inspectWorkflowTrust(commented).complete, true);
  const semantic = [{ file: '.github/workflows/pr-readiness.yml',
    contents: writerDefinition().replace('permissions:\n  contents: read\n  actions: read\n  pull-requests: read\n  statuses: write',
      "permissions: {'contents': 'read', actions: read, 'pull-requests': read, statuses: write}") }];
  assert.equal(inspectWorkflowPolicy(semantic).complete, true);
  assert.deepEqual(inspectWorkflowPolicy(semantic).workflows[0].jobs[0].effectivePermissions,
    { contents: 'read', actions: 'read', 'pull-requests': 'read', statuses: 'write' });
  const lowered = structuredClone(workflows);
  mutateWorkflowSource(lowered.find(item => item.file === '.github/workflows/ci.yml'),
    text => text.replace('  native:\n', '  native:\n    permissions: {}\n'), 'lowered native grant');
  const effective = inspectWorkflowTrust(lowered);
  assert.equal(effective.complete, true, JSON.stringify(effective.blockers));
  assert.deepEqual(effective.workflows.find(item => item.file === '.github/workflows/ci.yml')
    .jobs.find(job => job.id === 'native').effectivePermissions, {});
  const called = structuredClone(workflows);
  const caller = called.find(item => item.file === '.github/workflows/ci.yml');
  mutateWorkflowSource(caller, text => text.replace(/  source:\n[\s\S]*?\n  native:\n/u,
    '  source:\n    uses: ./.github/workflows/npm-publish.yml\n    permissions: {contents: read}\n\n  native:\n'),
  'privileged reusable callee');
  const callee = inspectWorkflowTrust(called);
  assert.ok(callee.blockers.some(item => item.file === '.github/workflows/npm-publish.yml' &&
    item.code === 'PRODUCER_PRIVILEGED_CALLEE'), JSON.stringify(callee.blockers));
  assert.ok(callee.blockers.some(item => item.file === '.github/workflows/npm-publish.yml' &&
    item.code === 'CALLEE_PERMISSION_ESCALATION'));
  const nested = structuredClone(workflows);
  mutateWorkflowSource(nested.find(item => item.file === '.github/workflows/ci.yml'),
    text => text.replace(checkoutPin, "'./.github/actions/controlled-policy-fixture'"), 'nested mutable action');
  const action = { file: '.github/actions/controlled-policy-fixture/action.yml',
    contents: "name: Controlled policy fixture\nruns:\n  using: composite\n  steps:\n" +
      "    - uses: 'actions/checkout@v4'\n      with: {persist-credentials: false}\n" };
  nested.push(action);
  assert.ok(inspectWorkflowTrust(nested).blockers.some(item => item.file === action.file &&
    item.code === 'UNPINNED_ACTION'));
  action.contents = action.contents.replace('actions/checkout@v4', './.github/actions/controlled-policy-fixture');
  assert.ok(inspectWorkflowTrust(nested).blockers.some(item => item.file === action.file &&
    item.code === 'WORKFLOW_REFERENCE_CYCLE'));
});

test('T-PRD020 actual fork producer graph rejects secrets, OIDC, real homes and privileged cache reuse', async () => {
  const workflows = await readWorkflowPolicySources(repositoryRoot);
  assert.equal(inspectWorkflowTrust(workflows).complete, true);
  for (const [file, edit, code] of [
    ['ci.yml', text => text.replace('  native:\n', '  native:\n    permissions: {"contents": "write", "id-token": "write"}\n'), 'EXCESS_JOB_PERMISSION'],
    ['ci.yml', text => text.replace('env:\n', 'env:\n  NPM_TOKEN: ${{ secrets.NPM_TOKEN }}\n'), 'UNAPPROVED_SECRET'],
    ['ci.yml', text => text.replace('env:\n', 'env:\n  COPILOT_HOME: ~/.copilot\n'), 'UNOWNED_INSTALLATION_TARGET'],
    ['ci.yml', text => text.replace('--candidate-dir .test-data/frozen-candidate', '--candidate-dir ~/.copilot'), 'UNOWNED_INSTALLATION_TARGET'],
    ['pr-readiness.yml', text => text.replace(checkoutPin, `actions/cache@${'a'.repeat(40)}`), 'PRIVILEGED_CACHE_RESTORE'],
    ['pr-readiness.yml', text => text.replace('persist-credentials: false', 'persist-credentials: true'), 'PERSISTED_CHECKOUT_CREDENTIALS'],
    ['ci.yml', text => text.replace('      actions: read\n      contents: read\n',
      '      actions: write\n      contents: read\n'), 'EXCESS_JOB_PERMISSION'],
    ['ci.yml', text => text.replace('      actions: read\n      contents: read\n',
      '      actions: read\n      contents: read\n      id-token: write\n'), 'EXCESS_JOB_PERMISSION'],
    ['ci.yml', text => text.replace('GITHUB_TOKEN: ${{ github.token }}',
      'GITHUB_TOKEN: ${{ secrets.PUBLICATION_TOKEN }}'), 'UNAPPROVED_SECRET'],
  ]) {
    const changed = structuredClone(workflows);
    const selected = changed.find(item => item.file === `.github/workflows/${file}`);
    mutateWorkflowSource(selected, edit, code);
    assert.ok(inspectWorkflowTrust(changed).blockers.some(item =>
      item.file === selected.file && item.code === code), code);
  }
});

function disposableProviderFixture() {
  const id = 'owned-probe';
  const contexts = ['coverage', 'validation'].map(name => `framework/disposable/${id}/${name}`);
  const protection = { required_status_checks: { strict: true,
    checks: contexts.map(context => ({ context, app_id: 15368 })) } };
  const request = { schemaVersion: 1, kind: 'disposable-readiness-probe', id,
    repository: 'urmich/ai-sdlc-framework', repositoryId: 17, prNumber: 41,
    headRef: `readiness-probe/${id}/head`, baseRef: `readiness-probe/${id}/base`,
    headSha: sourceA, baseSha: 'b'.repeat(40), mergeSha: 'c'.repeat(40), sourceCommit: 'd'.repeat(40),
    statusWriterId: 42, statusAppId: 15368, protectionDigest: digest(protection) };
  const records = [];
  const calls = [];
  const state = { protectionStatus: 200, headSha: request.headSha };
  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });
  let nextId = 0;
  const client = createReadinessGitHubClient({ repository: request.repository, repositoryId: 17, writerId: 42,
    token: 'controlled-disposable-fixture-token', generation: 'disposable-policy-fixture',
    fetch: async (url, input) => {
      const parsed = new URL(url);
      assert.equal(parsed.origin, 'https://api.github.com');
      const route = decodeURIComponent(parsed.pathname.slice(`/repos/${request.repository}`.length));
      calls.push({ method: input.method, route });
      if (route === '') return json({ id: 17, full_name: request.repository, default_branch: 'main',
        owner: { id: 11, type: 'User' } });
      if (route === '/branches/main') return json({ commit: { sha: request.sourceCommit } });
      if (route === '/pulls/41') return json({ number: 41, state: 'open', user: { id: 11 }, mergeable: true,
        head: { sha: state.headSha, ref: request.headRef, repo: { id: 17 } },
        base: { sha: request.baseSha, ref: request.baseRef, repo: { id: 17 } },
        merge_commit_sha: request.mergeSha,
        mergeable_state: contexts.every(context => records.filter(row => row.context === context).at(-1)?.state === 'success') ?
          'clean' : 'blocked' });
      if (route === `/branches/${request.baseRef}/protection`) return state.protectionStatus === 200 ?
        json(protection) : json({ message: 'Controlled denied or unavailable branch feature' }, state.protectionStatus);
      if (route === `/commits/${request.headSha}/statuses`) return json(records);
      if (route === `/statuses/${request.headSha}` && input.method === 'POST') {
        const value = JSON.parse(input.body);
        assert.ok(contexts.includes(value.context), 'No production or foreign-context write is permitted in this fake backend');
        const record = { id: ++nextId, ...value, creator: { id: 42 } };
        records.push(record);
        return json(record, 201);
      }
      throw new Error(`Unexpected disposable fixture operation ${input.method} ${route}`);
    } });
  return { client, request, records, calls, contexts, state };
}

test('T-PRD027 disposable API denies missing authority and unavailable actual controls before any status or setting dispatch', async () => {
  const f = disposableProviderFixture();
  const absent = await f.client.authorizeDisposableProbe(f.request);
  assert.equal(absent.activity, 'blocked');
  assert.equal(absent.blocker.code, 'MISSING_SCOPED_AUTHORITY');
  assert.equal(f.calls.length, 0);
  await assert.rejects(f.client.authorizeDisposableProbe({ ...f.request, authorized: true }, () => true),
    { code: 'SCOPE' });
  for (const protectionStatus of [403, 404]) {
    f.state.protectionStatus = protectionStatus;
    const denied = await f.client.authorizeDisposableProbe(f.request, () => true);
    assert.equal(denied.activity, 'blocked');
    assert.equal(denied.blocker.capability, protectionStatus === 403 ? 'Denied' : 'Unavailable');
  }
  f.state.protectionStatus = 200;
  const rejected = await f.client.authorizeDisposableProbe(f.request, () => false);
  assert.equal(rejected.blocker.code, 'MISSING_SCOPED_AUTHORITY');
  assert.equal(f.records.length, 0);
  assert.ok(f.calls.every(call => call.method === 'GET'));
});

test('T-PRD085 disposable opaque authority has a fixed reduced budget without weakening production 998 or crossing refs', async () => {
  const f = disposableProviderFixture();
  const admission = await f.client.authorizeDisposableProbe(f.request, input =>
    input.facts.repository.ownerId === 11 && input.requestDigest === digest(f.request));
  assert.equal(admission.activity, 'authorized');
  await assert.rejects(f.client.publishDisposable({ verified: true, ...admission.capability },
    { context: f.contexts[0], state: 'success', description: 'forged capability' }), { code: 'AUTHORITY' });
  await assert.rejects(f.client.publishDisposable(admission.capability,
    { context: statusContexts[0], state: 'success', description: 'production is forbidden' }), { code: 'SCOPE' });
  for (let index = 0; index < disposableStatusLimits.normal; index++) {
    const update = await f.client.publishDisposable(admission.capability,
      { context: f.contexts[0], state: 'success', description: `Owned reduced-budget slot ${index + 1}` });
    assert.equal(update.state, 'success');
  }
  const terminal = await f.client.publishDisposable(admission.capability,
    { context: f.contexts[0], state: 'success', description: 'must freeze before hard limit' });
  assert.equal(terminal.state, 'error');
  assert.equal(terminal.capacity, true);
  const count = f.records.length;
  const repeated = await f.client.publishDisposable(admission.capability,
    { context: f.contexts[0], state: 'success', description: 'cannot renew success' });
  assert.equal(repeated.action, 'reuse');
  assert.equal(repeated.state, 'error');
  assert.equal(f.records.length, count);
  assert.ok(count < disposableStatusLimits.hard);
  assert.equal(normalStatusLimit, 998);
  f.state.headSha = 'e'.repeat(40);
  await assert.rejects(f.client.publishDisposable(admission.capability,
    { context: f.contexts[1], state: 'success', description: 'stale scope' }), { code: 'SCOPE' });
  assert.equal(f.records.length, count);
  for (const field of ['baseRef', 'headRef']) {
    await assert.rejects(f.client.authorizeDisposableProbe({ ...f.request, [field]: 'main' }, () => true),
      { code: 'SCOPE' });
  }
});

test('T-PRD026 disposable policy driver retains a real failing child and passing sibling plus API merge-eligibility and capacity observations', async t => {
  const owned = await fixture(t);
  const f = disposableProviderFixture();
  const directory = owned.reportDir;
  const result = await runDisposablePolicyProbe({ client: f.client, request: f.request,
    authorize: () => true, evidenceDir: directory,
    execution: { runId: 202, attempt: 1, workflowRef: 'urmich/ai-sdlc-framework/.github/workflows/pr-policy-refresh.yml@refs/heads/main' },
    poll: operation => operation() });
  assert.equal(result.status, 'Passed', JSON.stringify(result.blocker));
  assert.equal(result.nativeAcceptance, 'NotRun', 'Controlled fake-provider fixtures do not establish actual GitHub enforcement');
  assert.equal(result.fixtureCredit, 'NotRun');
  const positive = JSON.parse(await fs.readFile(path.join(directory, 'fixture-positive.json'), 'utf8'));
  assert.equal(positive.complete, true);
  assert.equal(positive.exitCode, 0);
  assert.match(positive.stdout, /^ok \d+ - controlled required failure$/mu);
  assert.match(positive.stdout, /^ok \d+ - controlled required sibling$/mu);
  assert.doesNotMatch(positive.stderr, /called recursively|skipping running files/u);
  const failed = JSON.parse(await fs.readFile(path.join(directory, 'fixture-failure.json'), 'utf8'));
  assert.equal(failed.complete, true);
  assert.notEqual(failed.exitCode, 0);
  assert.match(failed.stdout, /not ok \d+ - controlled required failure/u);
  assert.match(failed.stdout, /ok \d+ - controlled required sibling/u);
  const journal = (await fs.readFile(path.join(directory, 'probe-events.ndjson'), 'utf8'))
    .trim().split('\n').map(JSON.parse);
  for (const label of ['failure', 'missing-job', 'skipped', 'missing-prerequisite', 'missing coverage']) {
    assert.ok(journal.some(row => row.kind === 'provider-observation' && row.label === label &&
      row.expected === 'blocked' && row.facts.pr.mergeState === 'blocked'), label);
  }
  assert.ok(f.records.every(row => f.contexts.includes(row.context)));
  assert.ok(f.contexts.every(context => f.records.filter(row => row.context === context).at(-1).state === 'error'));
  assert.ok(f.calls.every(call => call.method === 'GET' ||
    call.method === 'POST' && call.route === `/statuses/${f.request.headSha}`));
});

function contextProof() {
  const at = number => `2026-10-18T10:00:${String(number).padStart(2, '0')}.000Z`;
  const names = ['Record trusted execution context', 'Check out exact candidate',
    'Materialize committed source bytes', 'Provision isolated native toolchain',
    'Execute native validation', 'Retain native validation evidence'];
  const job = { id: 9, run_id: 101, head_sha: sourceA, conclusion: 'success',
    steps: names.map((name, index) => ({ name, number: index + 1, conclusion: 'success',
      started_at: at(index * 2), completed_at: at(index * 2 + 1) })) };
  const body = { repositoryId: '17', prNumber: '1', headRepositoryId: '29', headSha: sourceA,
    baseSha: 'b'.repeat(40), mergeSha: 'c'.repeat(40), event: 'pull_request', runId: '101', attempt: '1',
    ImageOS: 'ubuntu24', ImageVersion: 'fixture-image', platform: 'linux', architecture: 'x64' };
  body.resources = { availableParallelism: 4, totalMemoryBytes: 8 * 1024 ** 3, configuredWorkers: null };
  const logs = `${at(0)} sdlc-run-context:${JSON.stringify(body)}\n` +
    `${at(2)} [command]/usr/bin/git log -1 --format=%H\n${at(2)} ${body.mergeSha}\n`;
  return { job, body, logs, expected: { repositoryId: 17, runId: 101, attempt: 1,
    expectedMerge: body.mergeSha, prNumber: 1 } };
}

test('T-PRD020 actual CI schedules twenty-five producer parts behind both Intel unit jobs and distinguishes edited base retargets', async t => {
  const workflows = await readWorkflowPolicySources(repositoryRoot);
  const result = inspectWorkflowTrust(workflows);
  assert.equal(result.complete, true, JSON.stringify(result.blockers));
  const ci = result.workflows.find(item => item.file === '.github/workflows/ci.yml').document;
  const previous = previousReleasePins(ci.env, 'fixture/repo', { required: true });
  const pkg = JSON.parse(await fs.readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
  assert.notEqual(previous.version, pkg.version,
    'Ordinary PR validation must freeze a complete prior-version baseline without repository settings');
  assert.ok(ci.on.pull_request.types.includes('edited'));
  assert.equal(ci.jobs.source.name, 'Freeze source candidate');
  assert.equal(ci.jobs.source.needs, 'intent');
  assert.deepEqual(ci.jobs.native.needs, ['intent', 'source', 'native-units']);
  assert.deepEqual(ci.jobs['native-units'].needs, ['intent', 'source']);
  assert.deepEqual(ci.jobs['native-homebrew'].needs, ['intent', 'source']);
  assert.equal(ci.env.SDLC_MAC_ADMISSION_POLICY, 'arm-regression-allocation-v6-all-critical-bodies-first');
  const historicalV5 = structuredClone(ci);
  historicalV5.env.SDLC_MAC_ADMISSION_POLICY = 'arm-regression-allocation-v5-critical-body-first';
  historicalV5.jobs['native-mi'].needs = ['intent', 'source', 'native-units-mi', 'intel-homebrew-admission'];
  historicalV5.jobs['intel-admission'].needs = ['intent', 'source', 'native-units-mi', 'intel-homebrew-admission'];
  historicalV5.jobs['native-homebrew-mi'].needs = ['intent', 'source', 'arm-refresh-admission'];
  historicalV5.jobs['intel-homebrew-admission'].steps[4].name = 'Wait for actual Intel Homebrew worker allocation';
  historicalV5.jobs['intel-homebrew-admission'].steps[4].run =
    historicalV5.jobs['intel-homebrew-admission'].steps[4].run.replace('--group intel-bodies', '--group intel-homebrew');
  const legacy = structuredClone(historicalV5);
  const primaryPart = legacy.jobs['native-mi-retained'].strategy.matrix.include[0];
  const remainingParts = legacy.jobs['native-mi'].strategy.matrix.include;
  legacy.env.SDLC_MAC_ADMISSION_POLICY = 'arm-regression-allocation-v4-retained-first';
  legacy.jobs['native-mi-retained'].strategy.matrix.include = remainingParts.filter(part => part.shard === 'body-1');
  legacy.jobs['native-mi'].strategy.matrix.include = [primaryPart, ...remainingParts.filter(part => part.shard === 'body-2')];
  const legacyStep = legacy.jobs['intel-retained-admission'].steps[4];
  legacyStep.name = 'Wait for actual Intel retained body worker allocation';
  legacyStep.run = legacyStep.run.replace('--group intel-primary-body', '--group intel-retained-body');
  const inspectDocument = document => inspectWorkflowTrust(workflows.map(workflow =>
    workflow.file === '.github/workflows/ci.yml' ? { ...workflow, contents: Object.entries(document)
      .map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`).join('\n') + '\n' } : workflow));
  assert.equal(inspectDocument(historicalV5).complete, true,
    'Historical v5 topology and closed receipt groups remain authentic without being relabeled');
  const relabeledV5 = structuredClone(historicalV5);
  relabeledV5.env.SDLC_MAC_ADMISSION_POLICY = ci.env.SDLC_MAC_ADMISSION_POLICY;
  assert.equal(inspectDocument(relabeledV5).complete, false,
    'A cosmetic v6 label cannot admit the old Homebrew-before-bodies graph');
  const hybrid = structuredClone(ci);
  hybrid.jobs['intel-homebrew-admission'].steps[4].run =
    historicalV5.jobs['intel-homebrew-admission'].steps[4].run;
  assert.equal(inspectDocument(hybrid).complete, false,
    'Current dependencies cannot be combined with a historical Homebrew allocation receipt');
  assert.equal(inspectDocument(legacy).complete, true,
    'Historical v4 retained-first allocation and its original closed receipt group must remain authentic');
  const relabeled = structuredClone(legacy);
  relabeled.env.SDLC_MAC_ADMISSION_POLICY = 'arm-regression-allocation-v5-critical-body-first';
  assert.equal(inspectDocument(relabeled).complete, false,
    'An old retained-body allocation cannot be relabeled as a current primary-body allocation');
  assert.deepEqual(ci.jobs['mac-admission'].needs, ['intent', 'source', 'native-units-ma']);
  assert.deepEqual(ci.jobs['native-ma'].needs, ['intent', 'source', 'native-units-ma']);
  assert.deepEqual(ci.jobs['native-mi'].needs, ['intent', 'source', 'native-units-mi', 'arm-refresh-admission']);
  assert.deepEqual(ci.jobs['native-units-ma'].needs, ['intent', 'source']);
  assert.deepEqual(ci.jobs['native-units-mi'].needs, ['intent', 'source']);
  assert.deepEqual(ci.jobs['intel-admission'].needs, ['intent', 'source', 'native-units-mi', 'arm-refresh-admission']);
  assert.deepEqual(ci.jobs['native-mi-refresh'].needs,
    ['intent', 'source', 'native-units-mi', 'intel-admission']);
  assert.deepEqual(ci.jobs['intel-homebrew-admission'].needs,
    ['intent', 'source', 'native-units-mi', 'arm-refresh-admission']);
  assert.deepEqual(ci.jobs['native-homebrew-mi'].needs, ['intent', 'source', 'intel-homebrew-admission']);
  assert.deepEqual(ci.jobs['native-mi-retained'].needs, ['intent', 'source', 'native-units-mi', 'mac-admission']);
  assert.deepEqual(ci.jobs['native-ma-refresh'].needs, ['intent', 'source', 'native-units-ma', 'intel-retained-admission']);
  assert.deepEqual(ci.jobs['intel-retained-admission'].needs, ['intent', 'source', 'native-units-mi', 'mac-admission']);
  assert.deepEqual(ci.jobs['arm-refresh-admission'].needs, ['intent', 'source', 'native-units-ma', 'intel-retained-admission']);
  assert.deepEqual(ci.jobs['native-mi'].strategy.matrix.include.map(row => row.shard),
    ['body-1', 'body-2']);
  assert.deepEqual(ci.jobs['native-ma'].strategy.matrix.include.map(row => row.shard),
    ['body-0', 'body-1', 'body-2']);
  assert.equal(ci.jobs['native-homebrew'].strategy.matrix.include.length, 1);
  assert.equal(ci.jobs['native-homebrew'].strategy.matrix.include[0].target, 'macos-arm64');
  const jobKeyForPart = part => part.target === 'macos-arm64' && part.shard === 'refresh' ?
    'native-ma-refresh' : part.target === 'macos-x64' && part.shard === 'body-0' ?
      'native-mi-retained' : part.target === 'macos-x64' && part.component === 'homebrew' ?
    'native-homebrew-mi' : part.target === 'macos-x64' && part.shard === 'refresh' ?
      'native-mi-refresh' : nativePartJobKey(part);
  const keys = ['native-units', 'native', 'native-units-wx', 'native-wx',
    'native-units-ma', 'native-ma', 'native-units-mi', 'native-mi', 'native-homebrew',
    'native-mi-refresh', 'native-homebrew-mi', 'native-ma-refresh', 'native-mi-retained'];
  const parts = keys.flatMap(key => ci.jobs[key].strategy.matrix.include);
  assert.deepEqual(parts.map(({ target, component, role, shard }) => ({
    target, component, role, ...(shard === undefined ? {} : { shard }),
  }))
    .sort((a, b) => a.role.localeCompare(b.role)),
  [...nativePrParts].sort((a, b) => a.role.localeCompare(b.role)));
  assert.equal(ci.jobs.native.strategy['fail-fast'], false);
  assert.equal(ci.jobs.native['timeout-minutes'], 360);
  assert.equal(ci.jobs.native.name, 'native-${{ matrix.role }}');
  assert.equal(parts.length, 25);
  for (const target of ['linux-x64', 'windows-x64']) {
    assert.equal(parts.filter(part => part.target === target).length, 6);
    assert.equal(parts.filter(part => part.target === target && part.shard.startsWith('body-')).length, 4);
  }
  assert.equal(parts.filter(part => part.target.startsWith('macos-')).length, 13);
  assert.equal(parts.filter(part => part.target === 'macos-arm64').length, 6);
  assert.equal(parts.filter(part => part.target === 'macos-x64').length, 7);
  const f = await fixture(t);
  const output = path.join(f.root, 'source-bootstrap-tools.txt');
  const selection = ci.jobs.source.steps.find(step => step.id === 'bootstrap-protocol');
  const script = /^node --input-type=module -e '([\s\S]+)'$/u.exec(selection.run.trim());
  assert.ok(script, 'Workflow SDK dispatch must execute the source-owned requirement recipe');
  const selected = await f.run('source-bootstrap-tools', process.execPath,
    ['--input-type=module', '--eval', script[1]],
    { environment: { ...f.environment, GITHUB_OUTPUT: output } });
  assert.equal(selected.exitCode, 0, selected.stderr);
  const outputs = Object.fromEntries((await fs.readFile(output, 'utf8')).trim().split('\n')
    .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  assert.equal(outputs.protocol, nativeBootstrapProtocol);
  const tools = JSON.parse(outputs.tools);
  assert.deepEqual(Object.keys(tools).sort(), parts.map(part => part.role).sort());
  const inventory = await compileValidationInventory(repositoryRoot);
  const plan = await fs.readFile(path.join(repositoryRoot, 'docs', 'sdlc', 'public-readiness', 'test-plan.md'), 'utf8');
  const assignments = new Map([...new Set(parts.map(part => part.target))].map(target =>
    [target, nativeFrameworkShardPlan({ inventory, plan, target })]));
  const expectedRoles = { go: [], python: [], schema: [] };
  for (const part of parts) {
    const expected = part.shard?.startsWith('body-') ?
      expectedBodySdkRequirements(inventory, part.target,
        assignments.get(part.target).parts.find(selected => selected.shard === part.shard)) :
      { go: false, python: part.shard?.startsWith('units') ?? false, schema: false };
    for (const tool of Object.keys(expectedRoles)) if (expected[tool]) expectedRoles[tool].push(part.role);
  }
  for (const [tool, roles] of Object.entries(expectedRoles)) {
    assert.deepEqual(Object.entries(tools).filter(([, value]) => value[tool]).map(([role]) => role).sort(),
      roles.sort(), `Only source-selected roles may require ${tool}`);
  }
  assert.equal(Object.values(tools).filter(value => value.schema).length, 4);
  assert.equal(Object.values(tools).filter(value => value.ownedPrefix).length, 2);
  assert.equal(Object.values(tools).filter(value => value.crypto).length, 4);
  assert.equal(Object.values(tools).filter(value => value.crypto === false).length, 21);
  assert.ok(Object.values(tools).every(value =>
    Object.keys(value).sort().join(',') === 'crypto,go,homebrew,ownedPrefix,python,schema'));
  assert.ok(Object.entries(tools).every(([role, value]) =>
    value.homebrew === value.ownedPrefix && value.ownedPrefix === role.endsWith('-homebrew')));
  for (const key of keys) {
    assert.equal(ci.jobs[key].steps.find(step => step.name === 'Select pinned native Go').if,
      '${{ fromJSON(needs.source.outputs.bootstrap-tools)[matrix.role].go }}');
    const pythonStep = ci.jobs[key].steps.find(step => step.name === 'Select pinned native CPython');
    if (key.includes('units')) assert.ok(ci.jobs[key].strategy.matrix.include.every(part => tools[part.role].python));
    else assert.equal(pythonStep.if,
      '${{ fromJSON(needs.source.outputs.bootstrap-tools)[matrix.role].python }}');
    assert.ok(ci.jobs[key].strategy.matrix.include.every(part => jobKeyForPart(part) === key));
    assert.equal(ci.jobs[key]['timeout-minutes'], 360);
    assert.equal(ci.jobs[key].strategy['fail-fast'], false);
    const part = ci.jobs[key].strategy.matrix.include[0];
    assert.deepEqual(ci.jobs[key].needs, ['intent', 'source',
      ...(part.shard && part.shard !== 'units' ? [nativePartJobKey({ ...part, shard: 'units' })] : []),
      ...(key === 'native-mi' ? ['arm-refresh-admission'] : []),
      ...(key === 'native-mi-refresh' ? ['intel-admission'] : []),
      ...(key === 'native-homebrew-mi' ? ['intel-homebrew-admission'] : []),
      ...(key === 'native-mi-retained' ? ['mac-admission'] : []),
      ...(key === 'native-ma-refresh' ? ['intel-retained-admission'] : [])]);
    if (part.shard === 'units') {
      assert.equal(ci.jobs[key].strategy.matrix.include.length, part.target === 'macos-x64' ? 2 : 1);
      assert.ok(ci.jobs[key].strategy.matrix.include.every(row =>
        row.shard === 'units' || row.target === 'macos-x64' && row.shard === 'units-1'));
    }
    if (part.component === 'framework') {
      const hosts = {
        'linux-x64': { availableParallelism: 4, totalMemoryBytes: 16760344576 },
        'windows-x64': { availableParallelism: 4, totalMemoryBytes: 17174360064 },
        'macos-arm64': { availableParallelism: 3, totalMemoryBytes: 7516192768 },
        'macos-x64': { availableParallelism: 4, totalMemoryBytes: 15032385536 },
      };
      const host = hosts[part.target];
      const configuredWorkers = ci.jobs[key].env.SDLC_TEST_WORKERS;
      assert.match(configuredWorkers ?? '', /^[1-9]\d*$/u);
      const resources = nativeResourceFacts({ ...host, configuredWorkers });
      const cpuMatched = part.target === 'macos-x64' && key === 'native-units-mi';
      assert.equal(resources.workerCapacity, cpuMatched ? host.availableParallelism :
        Math.min(32, Math.floor(host.totalMemoryBytes / (1024 ** 3))),
      'Intel unit roles use the CPU-count budget; regression hosts use the observed memory budget');
      assert.equal(resources.workerCapacity > host.availableParallelism, !cpuMatched);
      assert.equal(resources.configuredWorkers, configuredWorkers);
      assert.ok(ci.jobs[key].steps.every(step => step.env?.SDLC_TEST_WORKERS === undefined),
        'Bootstrap, trusted context and execution must inherit one matching host allocation');
    }
  }
  assert.equal(ci.jobs['minimum-node'].needs, 'intent');
  assert.equal(ci.jobs['minimum-node'].if, ci.jobs.native.if);
  assert.deepEqual(ci.jobs['producer-summary'].needs,
    ['intent', 'minimum-node', 'source', ...keys, 'mac-admission', 'intel-admission',
      'intel-homebrew-admission', 'intel-retained-admission', 'arm-refresh-admission']);
  for (const [key, template] of [['native-mi-refresh', 'native-mi'], ['native-homebrew-mi', 'native-homebrew'],
    ['native-mi-retained', 'native-mi'], ['native-ma-refresh', 'native-ma']]) {
    const recipe = structuredClone(ci.jobs[key]);
    recipe.needs = ci.jobs[template].needs;
    recipe.strategy = ci.jobs[template].strategy;
    assert.deepEqual(recipe, ci.jobs[template], 'Split roles must retain the complete original execution recipe');
  }
  const nativeSteps = ci.jobs.native.steps;
  const bootstrapIndex = nativeSteps.findIndex(step => step.name === 'Provision isolated native toolchain');
  const retainedIndex = nativeSteps.findIndex(step => step.name === 'Retain native bootstrap diagnostics');
  const executionIndex = nativeSteps.findIndex(step => step.name === 'Execute native validation');
  assert.ok(bootstrapIndex >= 0 && bootstrapIndex < retainedIndex && retainedIndex < executionIndex,
    'Original provisioning evidence must be observable before the full native suite');
  const cleanup = nativeSteps.find(step => step.name === 'Retain native cleanup diagnostics');
  assert.notEqual(cleanup.with.name, nativeSteps[retainedIndex].with.name,
    'Later cleanup cannot overwrite immutable provisioning evidence');
  for (const name of ['Retain native bootstrap diagnostics', 'Retain native validation evidence',
    'Retain native cleanup diagnostics']) {
    assert.match(nativeSteps.find(step => step.name === name).with.name, /\$\{\{ matrix\.role \}\}/u,
      'Each independently hosted role retains a separate immutable artifact');
  }
  assert.match(nativeSteps[executionIndex].run, /--component "\$NATIVE_COMPONENT"/u);
  assert.match(nativeSteps[executionIndex].run, /--framework-shard "\$SDLC_FRAMEWORK_SHARD"/u);
  assert.match(nativeSteps[bootstrapIndex].run, /bootstrap-\$NATIVE_ROLE/u);
  assert.match(nativeSteps.find(step => step.name === 'Remove owned short Homebrew prefix').run,
    /bootstrap-\$NATIVE_ROLE/u);
  for (const change of [
    text => text.replace('role: macos-arm64-homebrew', 'role: macos-arm64-framework'),
    text => text.replace('component: homebrew', 'component: full'),
    text => text.replace('os: macos-15-intel', 'os: macos-15'),
  ]) {
    const altered = structuredClone(workflows);
    mutateWorkflowSource(altered.find(item => item.file === '.github/workflows/ci.yml'), change,
      'Reject mismatched Mac component/runner roles');
    assert.ok(inspectWorkflowTrust(altered).blockers.some(blocker => blocker.code === 'NATIVE_COMPONENT_MATRIX_DIFFERS'));
  }
  for (const needs of [
    '[intent, source]', '[intent, source, native-units]', '[intent, source, native-units-mi]',
  ]) {
    const altered = structuredClone(workflows);
    mutateWorkflowSource(altered.find(item => item.file === '.github/workflows/ci.yml'),
      text => text.replace('needs: [intent, source, native-units-wx]', `needs: ${needs}`),
      'Windows regression must depend on its own complete units job');
    assert.ok(inspectWorkflowTrust(altered).blockers.some(blocker => blocker.code === 'NATIVE_COMPONENT_MATRIX_DIFFERS'));
  }
  const documentSource = document => ({
    file: '.github/workflows/ci.yml',
    contents: Object.entries(document).map(([key, value]) =>
      `${JSON.stringify(key)}: ${JSON.stringify(value)}`).join('\n') + '\n',
  });
  const admissionStep = document => document.jobs['mac-admission'].steps
    .find(step => step.name === 'Wait for actual ARM body worker allocation');
  for (const [label, mutate, code] of [
    ['missing Intel admission edge', doc => { doc.jobs['native-mi'].needs.pop(); }, 'NATIVE_COMPONENT_MATRIX_DIFFERS'],
    ['missing Intel own unit barrier', doc => {
      doc.jobs['native-mi'].needs = ['intent', 'source', 'mac-admission'];
    }, 'NATIVE_COMPONENT_MATRIX_DIFFERS'],
    ['missing one Intel unit producer', doc => {
      doc.jobs['native-units-mi'].strategy.matrix.include.pop();
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['missing primary Intel unit producer', doc => {
      doc.jobs['native-units-mi'].strategy.matrix.include.shift();
    }, 'NATIVE_COMPONENT_MATRIX_DIFFERS'],
    ['refresh loses its explicit Intel unit barrier', doc => {
      doc.jobs['native-mi-refresh'].needs = ['intent', 'source', 'intel-admission'];
    }, 'NATIVE_COMPONENT_MATRIX_DIFFERS'],
    ['missing coordinator with its resource marker retained', doc => {
      delete doc.jobs['mac-admission'];
      doc.jobs['native-mi'].needs.pop();
      doc.jobs['producer-summary'].needs.pop();
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['missing resource marker', doc => { delete doc.env.SDLC_MAC_ADMISSION_POLICY; }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['unknown resource variant', doc => { doc.env.SDLC_MAC_ADMISSION_POLICY = 'unreviewed-v2'; }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['extra Mac VM', doc => { doc.jobs['mac-admission']['runs-on'] = 'macos-15'; }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['extra native part name', doc => { doc.jobs['mac-admission'].name = 'native-macos-arm64-admission'; }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['global unit barrier', doc => {
      doc.jobs['mac-admission'].needs.push('native-units', 'native-units-mi');
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['ARM completion barrier', doc => {
      doc.jobs['mac-admission'].needs = ['intent', 'source', 'native-ma'];
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['ARM unit barrier removed', doc => {
      doc.jobs['native-ma'].needs = ['intent', 'source'];
    }, 'NATIVE_COMPONENT_MATRIX_DIFFERS'],
    ['unfrozen checkout', doc => {
      doc.jobs['mac-admission'].steps.find(step => step.name === 'Check out exact candidate').with.ref = '${{ github.head_ref }}';
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['persisted checkout credential', doc => {
      doc.jobs['mac-admission'].steps.find(step => step.name === 'Check out exact candidate').with['persist-credentials'] = true;
    }, 'PERSISTED_CHECKOUT_CREDENTIALS'],
    ['missing caller context', doc => { doc.jobs['mac-admission'].steps.shift(); }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['forged caller context', doc => {
      doc.jobs['mac-admission'].env.SDLC_HEAD_SHA = '${{ github.sha }}';
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['untrusted repository argument', doc => {
      admissionStep(doc).run = admissionStep(doc).run.replace('"$GITHUB_REPOSITORY"', '"other/repository"');
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['unscoped attempt argument', doc => {
      admissionStep(doc).run = admissionStep(doc).run.replace(' --attempt "$GITHUB_RUN_ATTEMPT"', '');
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['wrong source argument', doc => {
      admissionStep(doc).env.ADMISSION_HEAD_SHA = '${{ github.sha }}';
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['unsafe API context', doc => { doc.env.GITHUB_API_URL = 'https://untrusted.invalid'; }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['runtime injection', doc => { doc.env.NODE_OPTIONS = '--import ./untrusted.mjs'; }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['queued timestamp fallback', doc => {
      admissionStep(doc).run = 'node -e "console.log(jobs.every(job => job.started_at))"';
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['success-shaped fallback', doc => { admissionStep(doc).run += ' || true\n'; }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['writable Actions grant', doc => { doc.jobs['mac-admission'].permissions.actions = 'write'; }, 'EXCESS_JOB_PERMISSION'],
    ['publication grant', doc => { doc.jobs['mac-admission'].permissions.contents = 'write'; }, 'EXCESS_JOB_PERMISSION'],
    ['unreviewed step', doc => {
      doc.jobs['mac-admission'].steps.push({ run: 'node unreviewed.mjs' });
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['wrong execution directory', doc => { doc.defaults.run['working-directory'] = '.'; }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['coordinator omitted from completeness', doc => {
      doc.jobs['producer-summary'].needs.pop();
    }, 'NATIVE_COMPONENT_MATRIX_DIFFERS'],
    ['coordinator result forged', doc => {
      doc.jobs['producer-summary'].steps[0].env.MAC_ADMISSION_RESULT = 'success';
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['coordinator result ignored', doc => {
      const step = doc.jobs['producer-summary'].steps[0];
      step.run = step.run.replace(' "$MAC_ADMISSION_RESULT"', '');
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['completeness assertion bypassed', doc => {
      const step = doc.jobs['producer-summary'].steps[0];
      step.run = step.run.replace('for result in "${results[@]}"; do test "$result" = success; done', 'true');
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['completeness unexpectedly skipped', doc => {
      doc.jobs['producer-summary'].if = '${{ false }}';
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['missing Intel Homebrew admission edge on refresh', doc => {
      doc.jobs['native-mi-refresh'].needs.pop();
    }, 'NATIVE_COMPONENT_MATRIX_DIFFERS'],
    ['early Intel Homebrew steals initial capacity', doc => {
      doc.jobs['native-homebrew-mi'].needs = ['intent', 'source'];
    }, 'NATIVE_COMPONENT_MATRIX_DIFFERS'],
    ['deferred ARM Homebrew changes initial schedule', doc => {
      doc.jobs['native-homebrew'].needs.push('intel-admission');
    }, 'NATIVE_COMPONENT_MATRIX_DIFFERS'],
    ['refresh steals first body allocation', doc => {
      doc.jobs['native-mi-refresh'].needs = ['intent', 'source', 'native-units-mi', 'mac-admission'];
    }, 'NATIVE_COMPONENT_MATRIX_DIFFERS'],
    ['Intel admission waits for body completion', doc => {
      doc.jobs['intel-admission'].needs.push('native-mi');
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['Intel admission loses own unit barrier', doc => {
      doc.jobs['intel-admission'].needs = ['intent', 'source', 'mac-admission'];
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['Intel admission loses ARM admission', doc => {
      doc.jobs['intel-admission'].needs.pop();
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['Intel admission waits on Mac runner', doc => {
      doc.jobs['intel-admission']['runs-on'] = 'macos-15-intel';
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['Intel admission broad token', doc => {
      doc.jobs['intel-admission'].permissions.actions = 'write';
    }, 'EXCESS_JOB_PERMISSION'],
    ['Intel admission publication token', doc => {
      doc.jobs['intel-admission'].steps[4].env.GITHUB_TOKEN = '${{ secrets.PUBLICATION_TOKEN }}';
    }, 'UNAPPROVED_SECRET'],
    ['Intel admission unfrozen checkout', doc => {
      doc.jobs['intel-admission'].steps[1].with.ref = '${{ github.head_ref }}';
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['Intel admission wrong caller head', doc => {
      doc.jobs['intel-admission'].env.SDLC_HEAD_SHA = '${{ github.sha }}';
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['Intel admission enables OIDC', doc => {
      doc.jobs['intel-admission'].permissions['id-token'] = 'write';
    }, 'EXCESS_JOB_PERMISSION'],
    ['Intel body group serialized by extra max-parallel', doc => {
      doc.jobs['native-mi'].strategy['max-parallel'] = 1;
    }, 'NATIVE_COMPONENT_MATRIX_DIFFERS'],
    ['new workflow-wide native serialization', doc => {
      doc.concurrency = { group: 'unreviewed-native-pool' };
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['Intel admission polls ARM instead of bodies', doc => {
      doc.jobs['intel-admission'].steps[4].run =
        doc.jobs['intel-admission'].steps[4].run.replace('--group intel-bodies ', '');
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['Intel admission treats queued timestamp as allocation', doc => {
      doc.jobs['intel-admission'].steps[4].run = 'node -e "console.log(jobs.every(job => job.started_at))"';
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['Intel admission omitted from completeness', doc => {
      doc.jobs['producer-summary'].needs.pop();
    }, 'NATIVE_COMPONENT_MATRIX_DIFFERS'],
    ['Intel admission completeness result ignored', doc => {
      doc.jobs['producer-summary'].steps[0].run =
        doc.jobs['producer-summary'].steps[0].run.replace(' "$INTEL_ADMISSION_RESULT"', '');
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['Intel refresh added as extra native part', doc => {
      doc.jobs['native-mi'].strategy.matrix.include.push(
        structuredClone(doc.jobs['native-mi-refresh'].strategy.matrix.include[0]));
    }, 'NATIVE_COMPONENT_MATRIX_DIFFERS'],
    ['Intel Homebrew duplicates native part', doc => {
      doc.jobs['native-homebrew'].strategy.matrix.include.push(
        structuredClone(doc.jobs['native-homebrew-mi'].strategy.matrix.include[0]));
    }, 'NATIVE_COMPONENT_MATRIX_DIFFERS'],
    ['Intel refresh drops execution retention', doc => {
      doc.jobs['native-mi-refresh'].steps.pop();
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['refresh bypasses remaining Intel body allocation', doc => {
      doc.jobs['native-mi-refresh'].needs = ['intent', 'source', 'native-units-mi', 'intel-homebrew-admission'];
    }, 'NATIVE_COMPONENT_MATRIX_DIFFERS'],
    ['Homebrew bypasses critical body allocation gate', doc => {
      doc.jobs['native-homebrew-mi'].needs = ['intent', 'source', 'arm-refresh-admission'];
    }, 'NATIVE_COMPONENT_MATRIX_DIFFERS'],
    ['Homebrew admission waits for Homebrew completion', doc => {
      doc.jobs['intel-homebrew-admission'].needs.push('native-homebrew-mi');
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['Homebrew admission creates refresh cycle', doc => {
      doc.jobs['intel-homebrew-admission'].needs.push('native-mi-refresh');
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['Homebrew admission bypasses Intel bodies', doc => {
      doc.jobs['intel-homebrew-admission'].needs = ['intent', 'source', 'native-units-mi', 'mac-admission'];
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['Homebrew admission loses Intel unit barrier', doc => {
      doc.jobs['intel-homebrew-admission'].needs = ['intent', 'source', 'intel-admission'];
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['Homebrew admission missing', doc => {
      delete doc.jobs['intel-homebrew-admission'];
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['Homebrew admission holds a Mac worker', doc => {
      doc.jobs['intel-homebrew-admission']['runs-on'] = 'macos-15-intel';
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['Homebrew admission adds a native part', doc => {
      doc.jobs['intel-homebrew-admission'].name = 'native-macos-x64-homebrew-admission';
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['Homebrew admission writable actions', doc => {
      doc.jobs['intel-homebrew-admission'].permissions.actions = 'write';
    }, 'EXCESS_JOB_PERMISSION'],
    ['Homebrew admission writable contents', doc => {
      doc.jobs['intel-homebrew-admission'].permissions.contents = 'write';
    }, 'EXCESS_JOB_PERMISSION'],
    ['Homebrew admission enables OIDC', doc => {
      doc.jobs['intel-homebrew-admission'].permissions['id-token'] = 'write';
    }, 'EXCESS_JOB_PERMISSION'],
    ['Homebrew admission publication token', doc => {
      doc.jobs['intel-homebrew-admission'].steps[4].env.GITHUB_TOKEN = '${{ secrets.PUBLICATION_TOKEN }}';
    }, 'UNAPPROVED_SECRET'],
    ['Homebrew admission unfrozen checkout', doc => {
      doc.jobs['intel-homebrew-admission'].steps[1].with.ref = '${{ github.head_ref }}';
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['Homebrew admission forged caller head', doc => {
      doc.jobs['intel-homebrew-admission'].env.SDLC_HEAD_SHA = '${{ github.sha }}';
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['Homebrew admission missing attempt binding', doc => {
      const step = doc.jobs['intel-homebrew-admission'].steps[4];
      step.run = step.run.replace(' --attempt "$GITHUB_RUN_ATTEMPT"', '');
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['Homebrew admission polls its own worker instead of the body group', doc => {
      const step = doc.jobs['intel-homebrew-admission'].steps[4];
      step.run = step.run.replace('--group intel-bodies', '--group intel-homebrew');
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['Homebrew admission accepts queued timestamps', doc => {
      doc.jobs['intel-homebrew-admission'].steps[4].run = 'node -e "console.log(jobs.every(job => job.started_at))"';
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['Homebrew admission ignored by completeness', doc => {
      doc.jobs['producer-summary'].needs.pop();
    }, 'NATIVE_COMPONENT_MATRIX_DIFFERS'],
    ['Homebrew admission result omitted', doc => {
      const step = doc.jobs['producer-summary'].steps[0];
      step.run = step.run.replace(' "$INTEL_HOMEBREW_ADMISSION_RESULT"', '');
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ['ARM refresh steals retained first allocation', doc => {
      doc.jobs['native-ma-refresh'].needs = ['intent', 'source', 'native-units-ma', 'mac-admission'];
    }, 'NATIVE_COMPONENT_MATRIX_DIFFERS'],
    ['ARM refresh loses its own unit barrier', doc => {
      doc.jobs['native-ma-refresh'].needs = ['intent', 'source', 'intel-retained-admission'];
    }, 'NATIVE_COMPONENT_MATRIX_DIFFERS'],
    ['Intel retained producer loses its own unit barrier', doc => {
      doc.jobs['native-mi-retained'].needs = ['intent', 'source', 'mac-admission'];
    }, 'NATIVE_COMPONENT_MATRIX_DIFFERS'],
    ['retained body waits for remaining bodies', doc => {
      doc.jobs['native-mi-retained'].needs = ['intent', 'source', 'native-units-mi', 'intel-homebrew-admission'];
    }, 'NATIVE_COMPONENT_MATRIX_DIFFERS'],
    ['remaining Intel bodies steal retained or Homebrew allocation', doc => {
      doc.jobs['native-mi'].needs = ['intent', 'source', 'native-units-mi', 'mac-admission'];
    }, 'NATIVE_COMPONENT_MATRIX_DIFFERS'],
    ['Homebrew bypasses ARM refresh allocation', doc => {
      doc.jobs['native-homebrew-mi'].needs = ['intent', 'source', 'intel-retained-admission'];
    }, 'NATIVE_COMPONENT_MATRIX_DIFFERS'],
    ['ARM body gate still waits on short refresh', doc => {
      const step = doc.jobs['mac-admission'].steps[4];
      step.run = step.run.replace('--group arm-bodies ', '');
    }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ...[
      ['intel-retained-admission', 'native-mi-retained', 'intel-primary-body', 'INTEL_RETAINED_ADMISSION_RESULT'],
      ['arm-refresh-admission', 'native-ma-refresh', 'arm-refresh', 'ARM_REFRESH_ADMISSION_RESULT'],
    ].flatMap(([key, nativeJob, group, result]) => [
      [`${key} waits for producer completion`, doc => {
        doc.jobs[key].needs.push(nativeJob);
      }, 'MAC_ADMISSION_POLICY_DIFFERS'],
      [`${key} loses predecessor gate`, doc => { doc.jobs[key].needs.pop(); }, 'MAC_ADMISSION_POLICY_DIFFERS'],
      [`${key} loses own unit barrier`, doc => {
        doc.jobs[key].needs = doc.jobs[key].needs.filter(id => !id.startsWith('native-units'));
      }, 'MAC_ADMISSION_POLICY_DIFFERS'],
      [`${key} holds a Mac VM`, doc => { doc.jobs[key]['runs-on'] = 'macos-15'; }, 'MAC_ADMISSION_POLICY_DIFFERS'],
      [`${key} is counted as native`, doc => { doc.jobs[key].name = `native-${key}`; }, 'MAC_ADMISSION_POLICY_DIFFERS'],
      [`${key} writable actions`, doc => { doc.jobs[key].permissions.actions = 'write'; }, 'EXCESS_JOB_PERMISSION'],
      [`${key} enables OIDC`, doc => { doc.jobs[key].permissions['id-token'] = 'write'; }, 'EXCESS_JOB_PERMISSION'],
      [`${key} publication credential`, doc => {
        doc.jobs[key].steps[4].env.GITHUB_TOKEN = '${{ secrets.PUBLICATION_TOKEN }}';
      }, 'UNAPPROVED_SECRET'],
      [`${key} unfrozen checkout`, doc => {
        doc.jobs[key].steps[1].with.ref = '${{ github.head_ref }}';
      }, 'MAC_ADMISSION_POLICY_DIFFERS'],
      [`${key} wrong closed group`, doc => {
        const step = doc.jobs[key].steps[4];
        step.run = step.run.replace(`--group ${group}`, '--group intel-homebrew');
      }, 'MAC_ADMISSION_POLICY_DIFFERS'],
      [`${key} queued placeholder fallback`, doc => {
        doc.jobs[key].steps[4].run = 'node -e "console.log(jobs.every(job => job.started_at))"';
      }, 'MAC_ADMISSION_POLICY_DIFFERS'],
      [`${key} omitted from completeness`, doc => {
        doc.jobs['producer-summary'].needs = doc.jobs['producer-summary'].needs.filter(id => id !== key);
      }, 'NATIVE_COMPONENT_MATRIX_DIFFERS'],
      [`${key} result forged`, doc => {
        doc.jobs['producer-summary'].steps[0].env[result] = 'success';
      }, 'MAC_ADMISSION_POLICY_DIFFERS'],
    ]),
  ]) {
    const document = structuredClone(ci);
    mutate(document);
    const changed = workflows.map(source => source.file === '.github/workflows/ci.yml' ?
      documentSource(document) : source);
    const rejected = inspectWorkflowTrust(changed);
    assert.equal(rejected.complete, false, label);
    assert.ok(rejected.blockers.some(blocker => blocker.code === code),
      `${label}: ${JSON.stringify(rejected.blockers)}`);
  }
  const removeRetainedPriority = document => {
    document.jobs['native-ma'].strategy.matrix.include.unshift(
      ...document.jobs['native-ma-refresh'].strategy.matrix.include);
    document.jobs['native-mi'].strategy.matrix.include.push(
      ...document.jobs['native-mi-retained'].strategy.matrix.include);
    document.jobs['native-mi'].strategy.matrix.include.sort((a, b) => a.shard.localeCompare(b.shard));
    for (const key of ['native-ma-refresh', 'native-mi-retained', 'intel-retained-admission', 'arm-refresh-admission']) {
      delete document.jobs[key];
    }
    document.jobs['mac-admission'].steps[4].name = 'Wait for actual ARM worker allocation';
    document.jobs['mac-admission'].steps[4].run =
      document.jobs['mac-admission'].steps[4].run.replace(' --group arm-bodies', '');
    document.jobs['native-mi'].needs = ['intent', 'source', 'native-units-mi', 'mac-admission'];
    document.jobs['intel-admission'].needs = ['intent', 'source', 'native-units-mi', 'mac-admission'];
    document.jobs['intel-homebrew-admission'].needs = ['intent', 'source', 'native-units-mi', 'intel-admission'];
    document.jobs['intel-homebrew-admission'].steps[4].name = 'Wait for actual Intel Homebrew worker allocation';
    document.jobs['intel-homebrew-admission'].steps[4].run =
      document.jobs['intel-homebrew-admission'].steps[4].run.replace('--group intel-bodies', '--group intel-homebrew');
    document.jobs['native-homebrew-mi'].needs = ['intent', 'source', 'intel-admission'];
    document.jobs['native-mi-refresh'].needs = ['intent', 'source', 'native-units-mi', 'intel-homebrew-admission'];
    document.jobs['producer-summary'].needs = document.jobs['producer-summary'].needs.filter(key =>
      !['native-ma-refresh', 'native-mi-retained', 'intel-retained-admission', 'arm-refresh-admission'].includes(key));
    const step = document.jobs['producer-summary'].steps[0];
    for (const name of ['ARM_REFRESH_RESULT', 'MI_RETAINED_RESULT',
      'INTEL_RETAINED_ADMISSION_RESULT', 'ARM_REFRESH_ADMISSION_RESULT']) delete step.env[name];
    step.run = step.run.replace(' "$ARM_REFRESH_RESULT" "$MI_RETAINED_RESULT" ' +
      '"$INTEL_RETAINED_ADMISSION_RESULT" "$ARM_REFRESH_ADMISSION_RESULT"', '');
  };
  const admittedV3 = structuredClone(ci);
  removeRetainedPriority(admittedV3);
  admittedV3.env.SDLC_MAC_ADMISSION_POLICY = 'arm-regression-allocation-v3-intel-homebrew-first';
  const previousV3 = inspectWorkflowTrust([documentSource(admittedV3)]);
  assert.equal(previousV3.complete, true, JSON.stringify(previousV3.blockers));
  assert.equal(previousV3.nativeResourcePolicy, 'arm-regression-allocation-v3-intel-homebrew-first');
  const oldV3Violation = structuredClone(admittedV3);
  oldV3Violation.jobs['native-mi-refresh'].needs = ['intent', 'source', 'native-units-mi', 'intel-admission'];
  assert.ok(inspectWorkflowTrust([documentSource(oldV3Violation)]).blockers
    .some(blocker => blocker.code === 'NATIVE_COMPONENT_MATRIX_DIFFERS'));
  const removeHomebrewPriority = document => {
    removeRetainedPriority(document);
    delete document.jobs['intel-homebrew-admission'];
    document.jobs['native-mi-refresh'].needs = ['intent', 'source', 'native-units-mi', 'intel-admission'];
    document.jobs['producer-summary'].needs = document.jobs['producer-summary'].needs.filter(key =>
      key !== 'intel-homebrew-admission');
    const step = document.jobs['producer-summary'].steps[0];
    delete step.env.INTEL_HOMEBREW_ADMISSION_RESULT;
    step.run = step.run.replace(' "$INTEL_HOMEBREW_ADMISSION_RESULT"', '');
  };
  const admittedV2 = structuredClone(ci);
  removeHomebrewPriority(admittedV2);
  admittedV2.env.SDLC_MAC_ADMISSION_POLICY = 'arm-regression-allocation-v2-priority-intel-bodies';
  const previousV2 = inspectWorkflowTrust([documentSource(admittedV2)]);
  assert.equal(previousV2.complete, true, JSON.stringify(previousV2.blockers));
  assert.equal(previousV2.nativeResourcePolicy, 'arm-regression-allocation-v2-priority-intel-bodies');
  const orphanedGate = structuredClone(ci);
  orphanedGate.env.SDLC_MAC_ADMISSION_POLICY = 'arm-regression-allocation-v2-priority-intel-bodies';
  assert.equal(inspectWorkflowTrust([documentSource(orphanedGate)]).complete, false,
    'Historical v2 cannot ignore an unadopted third gate');
  const removePriority = document => {
    removeHomebrewPriority(document);
    document.jobs['native-mi'].strategy.matrix.include.unshift(
      ...document.jobs['native-mi-refresh'].strategy.matrix.include);
    document.jobs['native-homebrew'].strategy.matrix.include.push(
      ...document.jobs['native-homebrew-mi'].strategy.matrix.include);
    for (const key of ['native-mi-refresh', 'native-homebrew-mi', 'intel-admission']) delete document.jobs[key];
    document.jobs['producer-summary'].needs = document.jobs['producer-summary'].needs.filter(key =>
      !['native-mi-refresh', 'native-homebrew-mi', 'intel-admission'].includes(key));
    const step = document.jobs['producer-summary'].steps[0];
    for (const name of ['MI_REFRESH_RESULT', 'MI_HOMEBREW_RESULT', 'INTEL_ADMISSION_RESULT']) delete step.env[name];
    step.run = step.run.replace(' "$INTEL_ADMISSION_RESULT" "$MI_REFRESH_RESULT" "$MI_HOMEBREW_RESULT"', '');
  };
  const admittedV1 = structuredClone(ci);
  removePriority(admittedV1);
  admittedV1.env.SDLC_MAC_ADMISSION_POLICY = 'arm-regression-allocation-v1';
  const previousResource = inspectWorkflowTrust([documentSource(admittedV1)]);
  assert.equal(previousResource.complete, true, JSON.stringify(previousResource.blockers));
  assert.equal(previousResource.nativeResourcePolicy, 'arm-regression-allocation-v1');
  for (const protocol of nativeFrameworkShardProtocols) {
    const historical = structuredClone(ci);
    removePriority(historical);
    delete historical.env.SDLC_MAC_ADMISSION_POLICY;
    delete historical.jobs['mac-admission'];
    for (const key of keys) delete historical.jobs[key];
    const parts = nativePrPartsForProtocol(protocol);
    const historicalKeys = [...new Set(parts.map(part => nativePartJobKey(part, protocol)))];
    for (const key of historicalKeys) {
      const rows = parts.filter(part => nativePartJobKey(part, protocol) === key);
      const part = rows[0];
      const unit = nativeFrameworkUnitShardNames(part.target, protocol).includes(part.shard);
      const job = structuredClone(ci.jobs[part.component === 'homebrew' ? 'native-homebrew' :
        unit ? 'native-units' : 'native']);
      job.strategy.matrix.include = rows.map(row => ({ ...row,
        os: { 'linux-x64': 'ubuntu-24.04', 'windows-x64': 'windows-2022',
          'macos-arm64': 'macos-15', 'macos-x64': 'macos-15-intel' }[row.target],
        architecture: row.target.split('-')[1] }));
      job.needs = ['intent', 'source', ...(part.shard && !unit ?
        [nativePartJobKey({ ...part, shard: 'units' }, protocol)] : [])];
      historical.jobs[key] = job;
    }
    historical.jobs['producer-summary'].needs = ['intent', 'minimum-node', 'source', ...historicalKeys];
    const summary = historical.jobs['producer-summary'].steps[0];
    delete summary.env.MAC_ADMISSION_RESULT;
    summary.run = summary.run.replace(' "$MAC_ADMISSION_RESULT"', '');
    const replay = inspectWorkflowTrust([documentSource(historical)]);
    assert.equal(replay.complete, true, `${protocol}: ${JSON.stringify(replay.blockers)}`);
    assert.equal(replay.nativeProtocol, protocol);
    assert.equal(replay.nativeResourcePolicy, null);
  }
  const freeze = ci.jobs.source.steps.find(step => step.name === 'Freeze exact source candidate');
  assert.match(freeze.run, /--phase candidate/u);
  const pr = { number: 1, head: { sha: sourceA }, base: { sha: 'b'.repeat(40) },
    merge_commit_sha: 'c'.repeat(40) };
  const job = { name: 'Classify native validation intent', run_id: 101, conclusion: 'success',
    steps: [{ name: 'Record validation intent', conclusion: 'success',
      started_at: '2026-10-18T10:00:00.000Z', completed_at: '2026-10-18T10:00:01.000Z' }] };
  const proof = { repositoryId: '17', prNumber: '1', runId: '101', attempt: '1', event: 'pull_request',
    action: 'edited', baseChanged: false, requiresNative: false,
    headSha: pr.head.sha, baseSha: pr.base.sha, mergeSha: pr.merge_commit_sha };
  const log = value => `2026-10-18T10:00:00.500Z sdlc-validation-intent:${JSON.stringify(value)}\n`;
  const expected = { repositoryId: 17, runId: 101, attempt: 1, pr };
  assert.equal(readTrustedValidationIntent(job, log(proof), expected).requiresNative, false);
  assert.equal(readTrustedValidationIntent(job, log({ ...proof, baseChanged: true, requiresNative: true }),
    expected).requiresNative, true);
  assert.throws(() => readTrustedValidationIntent(job, log({ ...proof, baseChanged: true }), expected),
    { code: 'EVIDENCE' });
  assert.throws(() => readTrustedValidationIntent({ ...job, conclusion: 'failure' }, log(proof), expected),
    { code: 'EVIDENCE' });
});

test('T-PRD021 actual trusted pre-candidate context and checkout logs bind PR source and native identity, not uploaded flags', () => {
  const f = contextProof();
  assert.equal(readTrustedJobContext(f.job, f.logs, f.expected).prNumber, 1);
  for (const change of [
    value => { value.job.conclusion = 'failure'; },
    value => { value.job.steps[3].conclusion = 'skipped'; },
    value => { value.logs = value.logs.replace(f.body.mergeSha, 'd'.repeat(40)); },
    value => { value.logs += `2026-10-18T10:00:00.500Z sdlc-run-context:${JSON.stringify(f.body)}\n`; },
    value => { value.logs = value.logs.replace('"prNumber":"1"', '"prNumber":"2"'); },
    value => { value.logs = value.logs.replace('"architecture":"x64"', '"architecture":"other"'); },
    value => { value.job.steps[0].started_at = '2026-10-18T10:00:10.000Z'; },
  ]) {
    const changed = structuredClone(f);
    change(changed);
    assert.throws(() => readTrustedJobContext(changed.job, changed.logs, changed.expected), { code: 'EVIDENCE' });
  }
});

test('T-PRD021 quoted Windows Git checkout requires the exact command and immediately following merge SHA', () => {
  const f = contextProof();
  const windows = { ...f.body, platform: 'win32', ImageOS: 'win22' };
  const git = '"C:\\Program Files\\Git\\bin\\git.exe"';
  const logs = f.logs.replace(JSON.stringify(f.body), JSON.stringify(windows)).replace('/usr/bin/git', git);
  assert.equal(readTrustedJobContext(f.job, logs, f.expected).platform, 'win32');
  for (const changed of [
    logs.replace(`Z ${f.body.mergeSha}\n`, `Z ${'d'.repeat(40)}\n`),
    logs.split('\n').filter(line => !line.includes('[command]')).join('\n'),
    logs.replace('git.exe"', 'notgit.exe"'),
    logs.replace('log -1 --format=%H', 'log -2 --format=%H'),
    logs.replace('log -1 --format=%H', 'log -1 --format=%H --all'),
    logs.replace(`Z ${f.body.mergeSha}\n`,
      `Z ${'d'.repeat(40)}\n2026-10-18T10:00:02.500Z ${f.body.mergeSha}\n`),
    logs.replace('2026-10-18T10:00:02.000Z [command]', '2026-10-18T10:00:12.000Z [command]'),
  ]) assert.throws(() => readTrustedJobContext(f.job, changed, f.expected), { code: 'EVIDENCE' });
  const failedCheckout = structuredClone(f.job);
  failedCheckout.steps.find(step => step.name === 'Check out exact candidate').conclusion = 'failure';
  assert.throws(() => readTrustedJobContext(failedCheckout, logs, f.expected), { code: 'EVIDENCE' });
});

function artifactApi(archive, python) {
  const metadata = { id: 19, name: 'native-evidence-fixture', expired: false,
    digest: `sha256:${digest(archive)}`, size_in_bytes: archive.length };
  const calls = [];
  const client = createReadinessGitHubClient({
    repository: 'urmich/ai-sdlc-framework', repositoryId: 17, writerId: 42,
    token: 'fixture-ephemeral-token', generation: 'fixture-generation', python,
    fetch: async (url, options) => {
      calls.push({ url, method: options.method });
      assert.equal(new Headers(options.headers).get('authorization'), 'Bearer fixture-ephemeral-token');
      if (url.endsWith('/actions/runs/101/artifacts?per_page=100')) {
        return new Response(JSON.stringify({ artifacts: [metadata] }), { headers: { 'content-type': 'application/json' } });
      }
      if (url.endsWith('/actions/artifacts/19/zip')) {
        return new Response(archive, { headers: { 'content-type': 'application/zip' } });
      }
      throw new Error('Unexpected fixture API route');
    },
  });
  return { client, metadata, calls };
}

test('T-PRD021 bounded data-only artifact acquisition preserves originals and refuses code, links and traversal without extraction', async t => {
  const f = await fixture(t);
  const python = process.env.SDLC_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const builder = path.join(f.root, 'build-artifact.py');
  await fs.writeFile(builder, `import json,stat,sys,zipfile
entries=json.load(open(sys.argv[1],encoding="utf-8"))
with zipfile.ZipFile(sys.argv[2],"w",compression=zipfile.ZIP_DEFLATED) as bundle:
    for entry in entries:
        item=zipfile.ZipInfo(entry["name"])
        item.compress_type=zipfile.ZIP_DEFLATED
        item.external_attr=entry.get("mode",stat.S_IFREG|0o644)<<16
        bundle.writestr(item,entry["text"]*entry.get("repeat",1))
`);
  const good = [
    { name: 'execution.json', text: '{"kind":"original-data"}\n' },
    { name: 'readiness-bundle.json', text: '{"kind":"retained-data"}\n' },
  ];
  const nonallocation = [
    { name: 'toolchain.json', text: '{"kind":"controlled-bootstrap"}\n' },
    { name: 'native-homebrew-prefix-request.json',
      text: '{"schemaVersion":1,"kind":"native-homebrew-prefix-not-required"}\n' },
  ];
  const cases = [
    ['valid', good],
    ['valid-prefix-free-cleanup', nonallocation, { kind: 'cleanup', ownedPrefix: false }],
    ['prefix-free-default-invalid', nonallocation, { kind: 'cleanup' }],
    ['prefix-free-allocation-invalid', [...nonallocation,
      { name: 'native-homebrew-prefix-allocation.json', text: '{}' }], { kind: 'cleanup', ownedPrefix: false }],
    ['prefix-free-removal-invalid', [...nonallocation,
      { name: 'native-homebrew-prefix-cleanup.json', text: '{}' }], { kind: 'cleanup', ownedPrefix: false }],
    ['prefix-free-missing-request', [nonallocation[0]], { kind: 'cleanup', ownedPrefix: false }],
    ['valid-stage-journal', [...good, { name: 'regression.json.journal.ndjson',
      text: '{"kind":"diagnostic","text":"' + 'x'.repeat(1000) + '"}\n', repeat: 5000 }]],
    ['oversized-other', [...good, { name: 'other.log', text: 'x', repeat: 4 * 1024 * 1024 + 1 }]],
    ['unknown-journal', [...good, { name: 'unrecognized.json.journal.ndjson', text: 'x',
      repeat: 4 * 1024 * 1024 + 1 }]],
    ['nested-journal', [...good, { name: 'nested/regression.json.journal.ndjson', text: 'x',
      repeat: 4 * 1024 * 1024 + 1 }]],
    ['oversized-stage-journal', [...good, { name: 'regression.json.journal.ndjson', text: 'x',
      repeat: 16 * 1024 * 1024 + 1 }]],
    ['aggregate-journals', [good[0], { name: 'readiness-bundle.json', text: ' ', repeat: 16 * 1024 * 1024 },
      ...['unit', 'required-units', 'regression'].map(stage => ({
        name: `${stage}.json.journal.ndjson`, text: 'x', repeat: 16 * 1024 * 1024,
      }))]],
    ['code', [...good, { name: 'payload.mjs', text: 'throw new Error("must not execute");' }]],
    ['traversal', [...good, { name: '../escape.json', text: '{}' }]],
    ['link', [...good, { name: 'linked.json', text: '/outside', mode: 0o120777 }]],
    ['duplicate', [...good, good[0]]],
    ['collision', [...good, { name: 'folder.json', text: '{}' },
      { name: 'folder.json/nested.json', text: '{}' }]],
  ];
  for (const [name, entries, options = {}] of cases) {
    const input = path.join(f.root, `${name}.json`);
    const output = path.join(f.root, `${name}.zip`);
    await fs.writeFile(input, JSON.stringify(entries));
    assert.equal((await f.run(`zip-${name}`, python, ['-I', '-S', '-B', builder, input, output])).exitCode, 0);
    const api = artifactApi(await fs.readFile(output), python);
    const [metadata] = await api.client.list('/actions/runs/101/artifacts?per_page=100', 'artifacts');
    if (name === 'valid-prefix-free-cleanup') {
      const result = await api.client.artifact(metadata, options);
      assert.equal(result['native-homebrew-prefix-request.json'].kind, 'native-homebrew-prefix-not-required');
      assert.equal(Object.hasOwn(result, 'native-homebrew-prefix-allocation.json'), false);
      assert.equal(Object.hasOwn(result, 'native-homebrew-prefix-cleanup.json'), false);
    } else if (name === 'valid' || name === 'valid-stage-journal') {
      const result = await api.client.artifact(metadata);
      assert.deepEqual(result['execution.json'], { kind: 'original-data' });
      assert.equal(result.texts['execution.json'], good[0].text);
      assert.equal(result.files.find(file => file.filename === 'execution.json').sha256, digest(good[0].text));
      if (name === 'valid-stage-journal') {
        const original = entries.at(-1).text.repeat(entries.at(-1).repeat);
        const journal = 'regression.json.journal.ndjson';
        assert.ok(Buffer.byteLength(original) > 4 * 1024 * 1024);
        assert.equal(result.texts[journal], original);
        assert.deepEqual(result.files.find(file => file.filename === journal), {
          filename: journal, size: Buffer.byteLength(original), sha256: digest(original),
        });
      }
      const before = api.calls.length;
      await assert.rejects(api.client.artifact({ ...metadata, verified: true }), { code: 'EVIDENCE' });
      assert.equal(api.calls.length, before, 'Serialized flags cannot become an acquired artifact capability');
    } else await assert.rejects(api.client.artifact(metadata, options), { code: 'EVIDENCE' });
    assert.ok(api.calls.every(call => call.method === 'GET'));
    await assert.rejects(fs.stat(path.join(f.root, 'escape.json')), { code: 'ENOENT' });
    await assert.rejects(fs.stat(path.join(f.root, 'payload.mjs')), { code: 'ENOENT' });
  }
});

function observerFixture() {
  const revisions = { head: sourceA, base: 'b'.repeat(40), merge: 'c'.repeat(40), trusted: 'd'.repeat(40) };
  const requirements = '# Requirements\n\n### FR-200: Preserve records\n\n**Definition of Done**\n\n- AC-200.1: Preserve original state.\n';
  const plan = JSON.stringify({ tests: [{
    id: 'T-PRD085', requirements: ['FR-200'], conditions: ['AC-200.1'],
    environment: 'local', level: 'integration', checkpoint: 'pre-review',
    mode: 'automated', owner: 'agent', location: 'development-machine',
    expected: 'Failed write preserves the original record',
    implementation: 'test/orders.test.mjs#orders preserve state', status: 'NotRun',
  }] });
  const files = new Map([
    ['docs/sdlc/public-readiness/requirements.md', requirements],
    ['docs/sdlc/public-readiness/test-plan.md', plan],
    ['test/orders.test.mjs', 'export const validationDeclarations=' + JSON.stringify({
      schemaVersion: 1,
      surfaces: [{ coverage: 'fixture-only', paths: ['scripts/native-components.mjs', 'scripts/toolchain-baseline.mjs'] }],
    }) + ";\nimport test from 'node:test';throw new Error('candidate code must never execute');test('orders preserve state',()=>{});\n"],
    ['scripts/native-components.mjs', "throw new Error('candidate component adapter must never execute');\n"],
    ['scripts/toolchain-baseline.mjs', `export const nativeBootstrapProtocol = '${nativeBootstrapProtocol}';\n` +
      "throw new Error('candidate toolchain source must never execute');\n"],
    ['.github/workflows/ci.yml', ciDefinition],
    ['.github/workflows/pr-readiness.yml', writerDefinition()],
    ['.github/workflows/coverage-metadata.yml', writerDefinition()],
  ]);
  const blobs = new Map();
  const tree = [...files].map(([file, contents]) => {
    const bytes = Buffer.from(contents);
    const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    blobs.set(sha, { sha, size: bytes.length, encoding: 'base64', content: bytes.toString('base64') });
    return { path: file, type: 'blob', mode: '100644', sha, size: bytes.length };
  });
  const treeSha = createHash('sha1').update(JSON.stringify(tree)).digest('hex');
  const input = { repositoryId: 'primary', sourceRevision: revisions.head,
    requirements: [{ artifactId: 'public-readiness', path: 'docs/sdlc/public-readiness/requirements.md', contents: requirements }],
    testPlans: [{ artifactId: 'public-readiness', path: 'docs/sdlc/public-readiness/test-plan.md', contents: plan }] };
  const pr = { number: 1, state: 'open', user: { id: 22 }, body: renderCoverageSection(prepareCoverage(input)),
    mergeable: true, merge_commit_sha: revisions.merge,
    head: { sha: revisions.head, repo: { id: 29 } },
    base: { sha: revisions.base, ref: 'main', repo: { id: 17 } } };
  const calls = [];
  const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  let incompleteMembership = false;
  let tamperedBlob = false;
  const client = createReadinessGitHubClient({
    repository: 'urmich/ai-sdlc-framework', repositoryId: 17, writerId: 42,
    token: 'fixture-ephemeral-token', generation: 'observer-fixture',
    fetch: async (url, options) => {
      calls.push({ url, method: options.method });
      const parsed = new URL(url);
      const route = parsed.pathname.replace('/repos/urmich/ai-sdlc-framework', '');
      if (parsed.pathname === '/graphql') {
        return json({ data: { repository: { databaseId: 17, pullRequest: {
          number: pr.number, headRefOid: pr.head.sha, reviewThreads: {
            nodes: [], pageInfo: { hasNextPage: false, endCursor: null },
          },
        } } } });
      }
      if (route === '') return json({ id: 17, full_name: 'urmich/ai-sdlc-framework',
        default_branch: 'main', owner: { id: 11, type: 'User' } });
      if (route === '/branches/main') return json({ commit: { sha: revisions.trusted } });
      if (route === '/branches/main/protection') return json({ required_conversation_resolution: { enabled: true } });
      if (route === '/pulls') {
        if (incompleteMembership) return new Response(JSON.stringify([pr]), { headers: {
          'content-type': 'application/json',
          link: '<https://api.github.com/repos/foreign/repository/pulls?page=2>; rel="next"',
        } });
        return json([pr]);
      }
      if (route === '/pulls/1') return json(pr);
      if (route === '/pulls/1/reviews') return json([
        { id: 1, user: { id: 11 }, state: 'APPROVED', commit_id: pr.head.sha },
      ]);
      if (route === '/actions/workflows/ci.yml') return json({ id: 99, path: '.github/workflows/ci.yml' });
      if (route === '/actions/workflows/99/runs') return json({ workflow_runs: [] });
      if (route.startsWith('/git/commits/')) return json({
        sha: route.split('/').at(-1), tree: { sha: treeSha },
        parents: [{ sha: revisions.head }, { sha: revisions.base }],
      });
      if (route === `/git/trees/${treeSha}`) return json({ sha: treeSha, truncated: false, tree });
      if (route.startsWith('/git/blobs/')) {
        const data = blobs.get(route.split('/').at(-1));
        assert.ok(data, 'Unexpected immutable source blob');
        return json(tamperedBlob ? { ...data, content: Buffer.from('changed bytes').toString('base64') } : data);
      }
      throw new Error(`Unexpected read-only fixture route ${route}`);
    },
  });
  const { host, policy } = createPrReadinessHost({
    api: client, defaultRevision: revisions.trusted, writerId: 42,
    now: () => now, detailsUrl: 'https://github.com/urmich/ai-sdlc-framework/actions/runs/101/attempts/1',
  });
  return { client, host, policy, pr, input, calls,
    incomplete: () => { incompleteMembership = true; },
    tamper: () => { tamperedBlob = true; } };
}

test('T-PRD085 actual API-source coverage inspection rejects same-head edits and cannot execute candidate source or borrow test success', async () => {
  const f = observerFixture();
  const initial = await f.host.snapshot();
  assert.equal(initial.prs[0].verdicts['framework/coverage'].status, 'Passed',
    JSON.stringify(initial.prs[0].verdicts['framework/coverage']));
  assert.equal(initial.prs[0].verdicts['framework/approval'].status, 'Passed');
  assert.equal(initial.prs[0].verdicts['framework/validation'].status, 'NotRun');
  const originalDigest = initial.prs[0].verdicts['framework/coverage'].inputDigest;
  for (const body of [
    '', '## Requirements Coverage\nThere is no machine-readable section.',
    `${f.pr.body}\n${f.pr.body}`,
    f.pr.body.replace('"schemaVersion": 1', '"schemaVersion": 99'),
    f.pr.body.replaceAll(sourceA, 'f'.repeat(40)),
  ]) {
    f.pr.body = body;
    const snapshot = await f.host.snapshot();
    assert.equal(snapshot.prs[0].headSha, sourceA);
    assert.equal(snapshot.prs[0].verdicts['framework/coverage'].status, 'NotRun');
    assert.equal(snapshot.prs[0].verdicts['framework/approval'].status, 'Passed');
    assert.notEqual(snapshot.prs[0].verdicts['framework/coverage'].inputDigest, originalDigest);
  }
  f.pr.body = renderCoverageSection(prepareCoverage(f.input));
  assert.equal((await f.host.snapshot()).prs[0].verdicts['framework/coverage'].status, 'Passed');
  assert.equal(await f.host.verifyWriterControl(), true);
  assert.ok(f.calls.every(call => ['GET', 'POST'].includes(call.method)));
  assert.ok(f.calls.filter(call => call.method === 'POST').every(call => call.url.endsWith('/graphql')),
    'Metadata evaluation dispatches no provider mutation');
});

test('T-PRD021 incomplete provider membership and tampered immutable source cannot become complete trusted facts', async () => {
  const partial = observerFixture();
  partial.incomplete();
  await assert.rejects(partial.host.snapshot(), error => ['SCOPE', 'PROOF_GAP', 'INPUT', 'CONTRACT'].includes(error.code));
  const tampered = observerFixture();
  tampered.tamper();
  const snapshot = await tampered.host.snapshot();
  assert.equal(snapshot.prs[0].verdicts['framework/coverage'].status, 'NotRun');
  assert.equal(snapshot.prs[0].verdicts['framework/validation'].status, 'NotRun');
  assert.ok(snapshot.prs[0].verdicts['framework/coverage'].blockers.includes('EVIDENCE'));
});

test('T-PRD018 observer UI bounds retain complete-report links and do not convert omitted keys into success', () => {
  const result = { status: 'NotRun', results: Array.from({ length: 40 }, (_, index) => ({
    key: { sha: sourceA, context: 'framework/coverage' }, status: 'NotRun',
    members: [{ number: index + 1 }], reason: `Missing coverage <script>${index}</script>\n::error::not a command`,
  })) };
  const summary = renderObserverSummary(result, {
    completeReportRef: 'https://github.com/urmich/ai-sdlc-framework/actions/runs/101/attempts/1', maxBytes: 2048,
  });
  assert.ok(Buffer.byteLength(summary) <= 2048);
  assert.match(summary, /UI excerpt omitted/u);
  assert.match(summary, /Complete machine-readable outcomes/u);
  assert.ok(!summary.includes('<script>'));
  assert.equal(result.results.length, 40);
  assert.equal(result.status, 'NotRun');
});
