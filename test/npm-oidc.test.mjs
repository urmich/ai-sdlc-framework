import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { canonical, readTarGzip, sha256, tarGzip, zip } from '../packaging/standalone/archive.mjs';
import { extractEntries } from '../packaging/standalone/protocol.mjs';
import { buildPackage } from '../scripts/package.mjs';
import { renderChecksums } from '../scripts/package-platforms.mjs';
import { NPM_TRUST } from '../scripts/npm-handoff.mjs';
import { verifyPublishedProvenance } from '../scripts/accept-release.mjs';
import { immutablePublicationBinding, publicationRecoveryDecision, collectPublicationAttempts } from '../scripts/release-history.mjs';
import { readWorkflowPolicySources, inspectWorkflowPolicy, validateWorkflowPolicy } from '../scripts/workflow-policy.mjs';

const execute = promisify(execFile);
const sourceCommit = 'a'.repeat(40);
const workflow = await fs.readFile('.github/workflows/npm-publish.yml', 'utf8');
const mockModule = path.resolve('test/npm-oidc-mocks.mjs');
let root;
let packageBytes;
let originalTmp;

function inlineScript(marker) {
  const match = new RegExp(`^( +)node --input-type=module <<'${marker}'\\n([\\s\\S]*?)^\\1${marker}$`, 'mu').exec(workflow);
  assert.ok(match, `Missing trusted inline workflow step ${marker}`);
  return match[2].split('\n').map(line => line.startsWith(match[1]) ? line.slice(match[1].length) : line).join('\n');
}

test.before(async () => {
  root = path.resolve('.test-data', `npm-oidc-${randomUUID()}`);
  await fs.mkdir(path.join(root, 'scratch'), { recursive: true });
  originalTmp = process.env.TMPDIR;
  process.env.TMPDIR = path.join(root, 'scratch');
  const built = await buildPackage({ outputDir: path.join(root, 'npm') });
  packageBytes = await fs.readFile(built.artifact);
});
test.after(async () => {
  if (originalTmp === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = originalTmp;
  await fs.rm(root, { recursive: true, force: true });
});

async function fixture(t, { version = '0.3.0', publishConfig, runId = '1234', attempt = '1', publicationRecovery } = {}) {
  const directory = path.join(root, randomUUID());
  const assets = path.join(directory, 'bundle-data/assets');
  await fs.mkdir(assets, { recursive: true });
  const entries = readTarGzip(packageBytes).map(entry => {
    if (entry.path !== 'package/package.json') return entry;
    const pkg = JSON.parse(entry.data);
    pkg.version = version;
    pkg.scripts = { prepublishOnly: 'node -e "require(\'fs\').writeFileSync(\'payload-executed\',\'bad\')"' };
    if (publishConfig) pkg.publishConfig = publishConfig;
    return { ...entry, data: Buffer.from(JSON.stringify(pkg)) };
  });
  const bytes = tarGzip(entries);
  const filename = `ai-sdlc-framework-${version}.tgz`;
  const payload = { filename, kind: 'archive', sha256: sha256(bytes), size: bytes.length };
  const descriptor = { schemaVersion: 1, name: 'ai-sdlc-framework', version, sourceCommit,
    payload: { filename, sha256: payload.sha256, inventoryDigest: 'b'.repeat(64) }, files: [payload] };
  const descriptorBytes = Buffer.from(canonical(descriptor));
  const checksums = Buffer.from(renderChecksums(descriptor, descriptorBytes));
  await fs.writeFile(path.join(assets, filename), bytes);
  await fs.writeFile(path.join(assets, 'release-descriptor.json'), descriptorBytes);
  await fs.writeFile(path.join(assets, 'SHA256SUMS'), checksums);
  const maliciousSource = Buffer.from("throw new Error('Downloaded source must never execute');\n");
  await fs.writeFile(path.join(directory, 'bundle-data/source-script.mjs'), maliciousSource);
  // Synthetic approval fixture for the data-only boundary, not release/native/OIDC evidence.
  const files = [
    { filename: `assets/${filename}`, sha256: payload.sha256, size: bytes.length },
    { filename: 'assets/release-descriptor.json', sha256: sha256(descriptorBytes), size: descriptorBytes.length },
    { filename: 'assets/SHA256SUMS', sha256: sha256(checksums), size: checksums.length },
    { filename: 'source-script.mjs', sha256: sha256(maliciousSource), size: maliciousSource.length },
  ];
  const releaseIntentId = 'oidc-unit-fixture';
  const bundle = { schemaVersion: 1, publicationReady: true, releaseIntentId, releaseRepository: NPM_TRUST.repository,
    identity: { sourceCommit, version, payloadSha256: payload.sha256,
      descriptorSha256: sha256(descriptorBytes), checksumsSha256: sha256(checksums) }, files };
  const manifest = Buffer.from(canonical(bundle));
  await fs.writeFile(path.join(directory, 'bundle-data/bundle.json'), manifest);
  const readiness = { schemaVersion: 1, profile: 'r-pre', status: 'Passed', releaseIntentId,
    bundleSha256: sha256(manifest), requiredCases: { 'linux-x64': 'T-PRD079-LX', 'windows-x64': 'T-PRD079-WX',
      'macos-arm64': 'T-PRD079-MA', 'macos-x64': 'T-PRD079-MI' },
    originalExecutions: ['LX', 'WX', 'MA', 'MI'].map(target => ({ target, finishedAt: new Date().toISOString() })) };
  const readinessBytes = Buffer.from(canonical(readiness));
  await fs.mkdir(path.join(directory, 'readiness-data'));
  await fs.writeFile(path.join(directory, 'readiness-data', 'readiness.json'), readinessBytes);
  const handoff = { schemaVersion: 2, sourceRepository: NPM_TRUST.repository, sourceCommit, releaseIntentId,
    releaseBinding: { releaseRepository: NPM_TRUST.repository, descriptorSha256: sha256(descriptorBytes),
      checksumsSha256: sha256(checksums) },
    readinessSha256: sha256(readinessBytes),
    artifactOrigin: { bundleArtifactId: '1234', bundleArtifactDigest: `sha256:${'c'.repeat(64)}`,
      sourceRunId: '1234', evidenceArtifactId: '1235', evidenceArtifactDigest: `sha256:${'d'.repeat(64)}` },
    verifierOrigin: { runId, attempt,
      workflowRef: `${NPM_TRUST.repository}/.github/workflows/release.yml@refs/heads/main`, job: 'npm-readiness' },
    bundleSha256: sha256(manifest), packageName: 'ai-sdlc-framework', version, filename,
    sha256: payload.sha256, size: bytes.length, integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    distTag: version.split('+')[0].includes('-') ? 'next' : 'latest' };
  const binding = immutablePublicationBinding(handoff);
  handoff.publicationRecovery = typeof publicationRecovery === 'function' ? publicationRecovery(binding) :
    publicationRecovery ?? publicationRecoveryDecision([], binding);
  await fs.writeFile(path.join(directory, 'handoff.json'), JSON.stringify(handoff));
  const toolBytes = Buffer.from('Integrity-bound npm tool unit fixture; not a real CLI archive');
  await fs.writeFile(path.join(directory, 'npm-tool-download.tgz'), toolBytes);
  const tools = path.join(directory, 'tools');
  await fs.mkdir(tools);
  await fs.writeFile(path.join(tools, 'npm'), `#!${process.execPath}
import fs from 'node:fs';
import path from 'node:path';
if (process.argv[2] === '--version') {
  console.log(process.argv[1].replaceAll('\\\\', '/').includes('/npm-tool/node_modules/npm/bin/npm-cli.js') ?
    (process.env.TEST_NPM_UPGRADED_VERSION || '11.16.0') : (process.env.TEST_NPM_VERSION || '11.16.0'));
} else if (process.argv[2] === 'config') {
  console.log(JSON.stringify({ registry: process.env.NPM_CONFIG_REGISTRY,
    'ignore-scripts': process.env.NPM_CONFIG_IGNORE_SCRIPTS === 'true', _auth: null,
    ...(process.env.TEST_NPM_EFFECTIVE_AUTH === 'true' ? {'//registry.npmjs.org/:_authToken':'(protected fixture)'} : {}) }));
} else if (process.argv[2] === 'install') {
  const args=process.argv.slice(2);
  if(!args.includes('--offline')||!args.includes('--ignore-scripts')||!args.includes('--bin-links=false')) throw new Error('Unsafe tool install');
  const prefix=args[args.indexOf('--prefix')+1];
  const packageRoot=path.join(prefix,'node_modules/npm');
  fs.mkdirSync(path.join(packageRoot,'bin'),{recursive:true});
  fs.writeFileSync(path.join(packageRoot,'package.json'),JSON.stringify({type:'module'}));
  fs.writeFileSync(path.join(packageRoot,'bin/npm-cli.js'),fs.readFileSync(process.argv[1]));
  fs.writeFileSync(path.join(process.env.TEST_NPM_ROOT,'tool-install.json'),JSON.stringify(args));
} else if (process.argv[2] === 'publish') {
  fs.writeFileSync(path.join(process.env.TEST_NPM_ROOT, 'npm-call.json'), JSON.stringify({
    args: process.argv.slice(2),
    config: { registry: process.env.NPM_CONFIG_REGISTRY, scripts: process.env.NPM_CONFIG_IGNORE_SCRIPTS,
      user: process.env.NPM_CONFIG_USERCONFIG, global: process.env.NPM_CONFIG_GLOBALCONFIG,
      inheritedRegistry: process.env.npm_config_registry, provenance: process.env.NPM_CONFIG_PROVENANCE }
  }));
  fs.appendFileSync(path.join(process.env.TEST_NPM_ROOT, 'publish-calls.jsonl'), JSON.stringify(process.argv.slice(2))+'\\n');
  if (process.env.TEST_NPM_REJECT === 'true') {
    console.log(JSON.stringify({error:{code:'E403',summary:'Controlled registry rejection without any effect'}}));
    console.error(process.env.TEST_NPM_DIAGNOSTIC || 'npm error code E403 controlled no-effect rejection');
    process.exit(1);
  }
  if (process.env.TEST_NPM_NO_EFFECT_UNKNOWN === 'true') {
    console.error(process.env.TEST_NPM_DIAGNOSTIC || 'Controlled connection loss; no authoritative rejection');
    process.exit(1);
  }
  fs.writeFileSync(path.join(process.env.TEST_NPM_ROOT, 'published'), 'unit fixture');
  if (process.env.TEST_NPM_LOST_RESPONSE === 'true') throw new Error('Unit fixture lost publish response after effect');
  console.log('Unit fixture publication only');
} else process.exit(99);
`, { mode: 0o755 });
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^npm_|^node_auth_token$|^node_options$|^node_path$/iu.test(key))),
    PATH: `${tools}${path.delimiter}${process.env.PATH}`, GITHUB_WORKSPACE: directory,
    GITHUB_ENV: path.join(directory, 'github-env'), GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted',
    GITHUB_REPOSITORY: NPM_TRUST.repository, GITHUB_SHA: sourceCommit, EXPECTED_SOURCE_COMMIT: sourceCommit,
    EXPECTED_BUNDLE_ARTIFACT_ID: '1234',
    EXPECTED_BUNDLE_SHA256: handoff.bundleSha256, EXPECTED_NPM_HANDOFF: JSON.stringify(handoff),
    NPM_CALLER_WORKFLOW_REF: `${NPM_TRUST.repository}/.github/workflows/release.yml@refs/heads/main`,
    GITHUB_WORKFLOW_REF: `${NPM_TRUST.repository}/.github/workflows/release.yml@refs/heads/main`,
    GITHUB_SERVER_URL: 'https://github.com', GITHUB_REF: 'refs/heads/main',
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_RUN_ID: runId, GITHUB_RUN_ATTEMPT: attempt,
    NPM_SOURCE_PRIVATE: 'false', NPM_TRUST_ENVIRONMENT: 'npm',
    NPM_TOOL_VERSION: '11.16.0', NPM_TOOL_INTEGRITY: `sha512-${createHash('sha512').update(toolBytes).digest('base64')}`,
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.invalid/oidc-fixture',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'unit-fixture-not-a-credential', TEST_NPM_ROOT: directory,
    TEST_NODE_VERSION: '24.22.0', SOURCE_RUN_ID: '1234', EVIDENCE_ARTIFACT_ID: '1235',
    ARTIFACT_READ_TOKEN: 'unit-fixture-not-a-credential' };
  const script = (marker, overrides = {}, cwd = directory) => execute(process.execPath, ['--import', pathToFileURL(mockModule).href,
      '--input-type=module', '-e', inlineScript(marker)],
    { cwd, env: { ...env, ...overrides }, maxBuffer: 4 * 1024 * 1024 });
  const run = async (marker, overrides = {}, cwd = directory) => {
    if (marker === 'NPM_OIDC_PUBLISH') {
      const work = path.join(directory, 'npm-work');
      const dispatchFile = path.join(work, 'publication-dispatch.json');
      const exists = await fs.lstat(dispatchFile).then(() => true, error => {
        if (error.code !== 'ENOENT') throw error;
        return false;
      });
      if (!exists) await script('NPM_DISPATCH_PREPARE', overrides, work);
      const dispatchBytes = await fs.readFile(dispatchFile);
      const dispatchZip = zip([{ path: 'publication-dispatch.json', data: dispatchBytes, mode: 0o644 }]);
      overrides = { ...overrides, EXPECTED_DISPATCH_ARTIFACT_ID: '2001',
        EXPECTED_DISPATCH_ARTIFACT_DIGEST: `sha256:${sha256(dispatchZip)}`,
        EXPECTED_DISPATCH_RECORD_SHA256: sha256(dispatchBytes) };
      await fs.writeFile(path.join(directory, 'durable-dispatch-fixture.zip'), dispatchZip);
    }
    return script(marker, overrides, cwd);
  };
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { directory, assets, bytes, filename, handoff, env, run };
}

test('protected npm job is data-only, tokenless, and trusts the actual reusable caller', async () => {
  const caller = await fs.readFile('.github/workflows/release.yml', 'utf8');
  assert.match(caller, /npm-readiness:[\s\S]*scripts\/npm-handoff\.mjs/u);
  assert.match(caller, /npm-handoff:[\s\S]*contents: read[\s\S]*id-token: write[\s\S]*uses: \.\/\.github\/workflows\/npm-publish\.yml/u);
  assert.match(workflow, /workflow_call:/u);
  const sources = await readWorkflowPolicySources(path.resolve('.'));
  const inspected = inspectWorkflowPolicy(sources);
  assert.equal(inspected.complete, true, JSON.stringify(inspected.blockers));
  const publisher = inspected.workflows.find(value => value.file === '.github/workflows/npm-publish.yml')
    .jobs.find(job => job.id === 'publish');
  assert.deepEqual(publisher.effectivePermissions, { contents: 'read', actions: 'read', 'id-token': 'write' });
  for (const excess of ['packages', 'attestations', 'statuses', 'checks']) {
    const changed = sources.map(source => source.file === '.github/workflows/npm-publish.yml' ?
      { ...source, contents: source.contents.replace('      id-token: write', `      id-token: write\n      ${excess}: write`) } : source);
    assert.throws(() => validateWorkflowPolicy(changed), /permission|policy/iu, excess);
  }
  assert.match(workflow, /runs-on: ubuntu-24\.04/u);
  assert.match(workflow, /node-version: '24\.22\.0'/u);
  assert.doesNotMatch(workflow, /actions\/checkout|secrets\.|attestations:|npm (?:ci|run)|node scripts\/|--provenance|registry-url:/u);
  assert.doesNotMatch(caller, /NODE_AUTH_TOKEN|secrets\.NPM_TOKEN|secrets: inherit/u);
  assert.deepEqual(NPM_TRUST, { repository: 'urmich/ai-sdlc-framework', callerFile: 'release.yml',
    publishingFile: 'npm-publish.yml', environment: 'npm' });
});

test('T-PRD031 simulated OIDC preflight enforces exact hosted runtime, maintainer event, caller and environment without token fallback', async t => {
  for (const overrides of [
    { RUNNER_ENVIRONMENT: 'self-hosted' }, { NPM_SOURCE_PRIVATE: 'true' },
    { NPM_CALLER_WORKFLOW_REF: `${NPM_TRUST.repository}/.github/workflows/npm-publish.yml@refs/heads/main` },
    { NPM_CALLER_WORKFLOW_REF: `${NPM_TRUST.repository}/.github/workflows/outer-wrapper.yml@refs/heads/main` },
    { NPM_TRUST_ENVIRONMENT: 'other' }, { ACTIONS_ID_TOKEN_REQUEST_TOKEN: '' },
    { GITHUB_WORKFLOW_REF: `${NPM_TRUST.repository}/.github/workflows/npm-publish.yml@refs/heads/main` },
    { EXPECTED_BUNDLE_ARTIFACT_ID: '1234,9999' },
    { TEST_NODE_VERSION: '22.12.0' },
    { TEST_NODE_VERSION: '24.16.0' }, { GITHUB_EVENT_NAME: 'pull_request' },
    { GITHUB_SHA: 'b'.repeat(40) }, { NODE_AUTH_TOKEN: 'unit-fixture' }, { NPM_TOKEN: 'unit-fixture' },
    { NPM_CONFIG_PROVENANCE: 'false' },
    { TEST_NPM_EFFECTIVE_AUTH: 'true' },
  ]) {
    const rejected = await fixture(t);
    await assert.rejects(rejected.run('NPM_OIDC_PREFLIGHT', overrides), /requires|forbidden|must not be disabled|auth config contains credentials/u);
  }
  for (const npmVersion of ['11.14.9', '10.9.0', '11.15.0-beta.1']) {
    const old = await fixture(t);
    const result = await old.run('NPM_OIDC_PREFLIGHT', { TEST_NPM_VERSION: npmVersion });
    assert.match(result.stdout, /IntegrityVerifiedPinnedToolUpgrade/u);
    const tool = JSON.parse(await fs.readFile(path.join(old.directory, 'npm-work/npm-tool.json'), 'utf8'));
    assert.equal(tool.npmVersion, '11.16.0');
  }
  const f = await fixture(t);
  const result = await f.run('NPM_OIDC_PREFLIGHT', { TEST_NPM_VERSION: '11.15.0' });
  assert.match(result.stdout, /"callerFilename":"release.yml"/u);
  assert.match(result.stdout, /"environment":"npm"/u);
  const npmrc = await fs.readFile(path.join(f.directory, 'npm-work/user.npmrc'), 'utf8');
  assert.doesNotMatch(npmrc, /auth|token|provenance/u);
});

test('npm tool upgrade rejects a tampered archive or insufficient resulting version', async t => {
  const tampered = await fixture(t);
  await assert.rejects(tampered.run('NPM_OIDC_PREFLIGHT', { TEST_NPM_VERSION: '11.14.0', TEST_NPM_BAD_TOOL: 'true' }),
    /tooling integrity mismatch/u);
  await assert.rejects(fs.stat(path.join(tampered.directory, 'tool-install.json')), { code: 'ENOENT' });
  const old = await fixture(t);
  await assert.rejects(old.run('NPM_OIDC_PREFLIGHT', { TEST_NPM_VERSION: '11.14.0', TEST_NPM_UPGRADED_VERSION: '11.14.0' }),
    /pinned npm 11.16.0/u);
});

test('privileged data verifier reads only data, ignores embedded lifecycle scripts, and copies exact tgz bytes', async t => {
  const f = await fixture(t);
  await f.run('NPM_OIDC_PREFLIGHT');
  await f.run('NPM_DATA_VERIFY');
  assert.deepEqual(await fs.readFile(path.join(f.directory, 'npm-work', f.filename)), f.bytes);
  await assert.rejects(fs.stat(path.join(f.directory, 'npm-work/payload-executed')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(f.directory, 'npm-work/source-script.mjs')), { code: 'ENOENT' });
});

test('protected origin verification rejects foreign artifacts, changed digests and a failed read-only verifier', async t => {
  const f = await fixture(t);
  await f.run('NPM_ORIGIN_VERIFY');
  for (const bad of ['digest', 'source', 'verifier']) {
    await assert.rejects(f.run('NPM_ORIGIN_VERIFY', { TEST_NPM_BAD_ORIGIN: bad }), /origin|verifier|artifact/iu);
  }
});

test('T-PRD033 delayed and uncertain npm effects reconcile within ten minutes without a second publish', async t => {
  const f = await fixture(t);
  await f.run('NPM_OIDC_PREFLIGHT');
  await f.run('NPM_DATA_VERIFY');
  await f.run('NPM_OIDC_PUBLISH', { TEST_NPM_PROPAGATION_STEPS: '6', TEST_NPM_LOST_RESPONSE: 'true' },
    path.join(f.directory, 'npm-work'));
  const result = JSON.parse(await fs.readFile(path.join(f.directory, 'npm-work/npm-publication-result.json')));
  assert.equal(result.status, 'PublishedAndBytesVerified');
  assert.equal(result.authentication, 'NotVerifiedUncertainCommand');
  assert.equal(result.oidcPublication, 'NotRun', 'Reconciliation must not fabricate a fresh OIDC authentication result');
  assert.deepEqual(result.readbacks.slice(0, 4).map(record => record.delayMs), [1000, 2000, 4000, 8000]);
  assert.ok(result.readbacks.every(record => record.delayMs === undefined || record.delayMs <= 30_000));
  assert.equal((await fs.readFile(path.join(f.directory, 'publish-calls.jsonl'), 'utf8')).trim().split('\n').length, 1);
  assert.equal(result.command.exitCode, 1);
  assert.match(result.command.stderr, /lost publish response/u);
  assert.equal(result.command.confirmedRejected, false);
  assert.equal(result.readback.status, 'Verified');
});

test('T-PRD033 metadata, tarball and provenance propagate independently within the exact bounded window', async t => {
  for (const transient of ['503', 'network']) {
    const f = await fixture(t);
    await f.run('NPM_OIDC_PREFLIGHT');
    await f.run('NPM_DATA_VERIFY');
    await f.run('NPM_OIDC_PUBLISH', { TEST_NPM_METADATA_STEPS: '2', TEST_NPM_TARBALL_STEPS: '2',
      TEST_NPM_PROVENANCE_STEPS: '2', TEST_NPM_TRANSIENT_STATUS: transient }, path.join(f.directory, 'npm-work'));
    const result = JSON.parse(await fs.readFile(path.join(f.directory, 'npm-work/npm-publication-result.json')));
    assert.equal(result.status, 'PublishedAndBytesVerified');
    assert.equal(result.command.exitCode, 0);
    assert.equal(result.command.signal, null);
    assert.deepEqual(result.readbacks.slice(0, 5).map(row => row.delayMs), [1000, 2000, 4000, 8000, 16000]);
    assert.ok(result.readbacks.some(row => !row.packageAvailable && row.tarball === 'NotRun'));
    assert.ok(result.readbacks.some(row => row.packageAvailable && (row.tarball === 'Missing' || row.transportFailure)));
    assert.ok(result.readbacks.some(row => row.tarball === 'Verified' && (row.provenance === 'Missing' || row.transportFailure)));
    if (transient === 'network') assert.ok(result.readbacks.some(row => row.transportFailure?.code === 'ECONNRESET'));
    assert.equal(result.readbacks.at(-1).provenance, 'Verified');
    assert.equal((await fs.readFile(path.join(f.directory, 'publish-calls.jsonl'), 'utf8')).trim().split('\n').length, 1);
  }
});

test('T-PRD033 a successful command with expired readback remains uncertain without losing its command outcome', async t => {
  for (const stage of ['metadata', 'tarball', 'provenance']) {
    const f = await fixture(t);
    await f.run('NPM_OIDC_PREFLIGHT');
    await f.run('NPM_DATA_VERIFY');
    await assert.rejects(f.run('NPM_OIDC_PUBLISH', { [`TEST_NPM_${stage.toUpperCase()}_STEPS`]: '9999' },
      path.join(f.directory, 'npm-work')), /ten-minute|uncertain/iu);
    const result = JSON.parse(await fs.readFile(path.join(f.directory, 'npm-work/npm-publication-result.json')));
    assert.equal(result.status, 'FailedOrIncomplete');
    assert.equal(result.command.exitCode, 0);
    assert.equal(result.effect, 'CommandSucceeded');
    assert.equal(result.readback.status, 'Expired');
    assert.equal(result.readback.cause.code, 'PUBLICATION_UNCERTAIN');
    assert.equal(result.readbacks.reduce((total, row) => total + (row.delayMs ?? 0), 0), 600_000);
    assert.equal((await fs.readFile(path.join(f.directory, 'publish-calls.jsonl'), 'utf8')).trim().split('\n').length, 1);
  }
});

test('T-PRD033 a confirmed no-effect rejection retains sanitized original diagnostics separately from polling', async t => {
  const f = await fixture(t);
  await f.run('NPM_OIDC_PREFLIGHT');
  await f.run('NPM_DATA_VERIFY');
  const token = `ghp_${'X'.repeat(30)}`;
  const jwt = `${Buffer.from('{"alg":"RS256","typ":"JWT"}').toString('base64url')}.` +
    `${Buffer.from('{"controlled":true}').toString('base64url')}.fixture-signature`;
  const diagnostic = `npm error code E403 denied ${token} ${jwt} https://example.invalid/run?token=fixture-query ` +
    'https://fixture-user:fixture-pass@example.invalid/run Authorization: Basic controlled-basic Cookie: sid=controlled-cookie';
  await assert.rejects(f.run('NPM_OIDC_PUBLISH', { TEST_NPM_REJECT: 'true', TEST_NPM_DIAGNOSTIC: diagnostic },
    path.join(f.directory, 'npm-work')), /rejected without an effect/u);
  const raw = await fs.readFile(path.join(f.directory, 'npm-work/npm-publication-result.json'), 'utf8');
  const result = JSON.parse(raw);
  assert.equal(result.status, 'RejectedWithoutEffect');
  assert.equal(result.command.exitCode, 1);
  assert.equal(result.command.confirmedRejected, true);
  assert.equal(result.command.rejectionCode, 'E403');
  assert.equal(result.readback.status, 'NotRun');
  assert.equal(result.command.stderrSha256, sha256(Buffer.from(`${diagnostic}\n`)));
  for (const secret of [token, jwt, 'fixture-query', 'fixture-user', 'fixture-pass', 'controlled-basic', 'controlled-cookie']) {
    assert.equal(raw.includes(secret), false);
  }
  const journal = await fs.readFile(path.join(f.directory, 'npm-work/npm-publication-journal.ndjson'), 'utf8');
  for (const secret of [token, jwt, 'fixture-query', 'fixture-user', 'fixture-pass', 'controlled-basic', 'controlled-cookie']) {
    assert.equal(journal.includes(secret), false);
  }
  assert.deepEqual(journal.trim().split('\n').map(line => JSON.parse(line).kind),
    ['attempt-started', 'dispatching', 'command-outcome', 'attempt-finished']);
  await assert.rejects(fs.stat(path.join(f.directory, 'published')), { code: 'ENOENT' });
});

test('T-PRD033 cancellation preserves an irreversible command and its physical dispatch for reconciliation', async t => {
  for (const signal of ['SIGTERM', 'SIGINT']) {
    const f = await fixture(t);
    await f.run('NPM_OIDC_PREFLIGHT');
    await f.run('NPM_DATA_VERIFY');
    await assert.rejects(f.run('NPM_OIDC_PUBLISH', { TEST_NPM_CANCEL_STAGE: 'metadata', TEST_NPM_CANCEL_SIGNAL: signal },
      path.join(f.directory, 'npm-work')), /interrupt|registry readback/iu);
    const result = JSON.parse(await fs.readFile(path.join(f.directory, 'npm-work/npm-publication-result.json')));
    assert.equal(result.status, 'Cancelled');
    assert.equal(result.interruptionSignal, signal);
    assert.equal(result.command.exitCode, 0);
    assert.equal(result.publishAttempted, true);
    assert.equal(result.readback.status, 'Cancelled');
    assert.deepEqual(result.dispatch.run, { id: '1234', attempt: '1' });
    assert.equal((await fs.readFile(path.join(f.directory, 'publish-calls.jsonl'), 'utf8')).trim().split('\n').length, 1);
  }
});

test('T-PRD033 a fresh physical job never republishes a prior ambiguous dispatch even after another registry 404', async t => {
  const original = await fixture(t);
  await original.run('NPM_OIDC_PREFLIGHT');
  await original.run('NPM_DATA_VERIFY');
  await assert.rejects(original.run('NPM_OIDC_PUBLISH', { TEST_NPM_NO_EFFECT_UNKNOWN: 'true' },
    path.join(original.directory, 'npm-work')), /uncertain/u);
  const resultFile = path.join(original.directory, 'npm-work/npm-publication-result.json');
  const originalBytes = await fs.readFile(resultFile);
  const result = JSON.parse(originalBytes);
  const old = { ...result.dispatch, confirmedEffect: 'Uncertain', dispatchArtifact: result.dispatch.artifact,
    result };
  const next = await fixture(t, { attempt: '2', publicationRecovery: binding => publicationRecoveryDecision([old], binding) });
  await next.run('NPM_OIDC_PREFLIGHT');
  await next.run('NPM_DATA_VERIFY');
  await assert.rejects(next.run('NPM_OIDC_PUBLISH', {}, path.join(next.directory, 'npm-work')), /uncertain/u);
  const recovered = JSON.parse(await fs.readFile(path.join(next.directory, 'npm-work/npm-publication-result.json')));
  assert.equal(recovered.dispatch.mode, 'reconcile-only');
  assert.equal(recovered.publishAttempted, false);
  assert.equal(recovered.command, null);
  assert.equal(recovered.history[0].run.attempt, '1');
  assert.equal(recovered.run.attempt, '2');
  assert.equal(recovered.history[0].result.command.exitCode, 1);
  await assert.rejects(fs.stat(path.join(next.directory, 'npm-call.json')), { code: 'ENOENT' });
  assert.deepEqual(await fs.readFile(resultFile), originalBytes);
});

test('T-PRD033 orphaned or self-referential recovery cannot prepare a protected publication dispatch', async t => {
  for (const invalid of ['missing-root', 'self-reference', 'duplicate-artifact', 'empty-recovery']) {
    const f = await fixture(t, { publicationRecovery: binding => {
      const original = { schemaVersion: 1, kind: 'npm-publication-attempt', binding,
        run: { id: '101', attempt: '1' }, mode: 'publish', confirmedEffect: 'Uncertain',
        invocationRef: `https://github.com/${NPM_TRUST.repository}/actions/runs/101/attempts/1`,
        dispatchArtifact: { id: '1001', digest: `sha256:${'a'.repeat(64)}` } };
      const retry = { ...original, run: { id: '202', attempt: '1' }, mode: 'reconcile-only',
        invocationRef: `https://github.com/${NPM_TRUST.repository}/actions/runs/202/attempts/1`,
        dispatchArtifact: { id: '1002', digest: `sha256:${'b'.repeat(64)}` },
        priorDispatchArtifacts: [original.dispatchArtifact] };
      if (invalid === 'self-reference' || invalid === 'duplicate-artifact') retry.dispatchArtifact = original.dispatchArtifact;
      if (invalid === 'empty-recovery') retry.priorDispatchArtifacts = [];
      return { schemaVersion: 1, kind: 'npm-publication-recovery', binding,
        history: invalid === 'duplicate-artifact' ? [original, retry] : [retry],
        mayDispatch: true, disposition: 'NoUnresolvedPriorEffect', unresolvedAttempts: [] };
    } });
    await f.run('NPM_OIDC_PREFLIGHT');
    await f.run('NPM_DATA_VERIFY');
    await assert.rejects(f.run('NPM_OIDC_PUBLISH', {}, path.join(f.directory, 'npm-work')),
      /forget|original|distinct/iu, invalid);
    await assert.rejects(fs.stat(path.join(f.directory, 'npm-call.json')), { code: 'ENOENT' });
    await assert.rejects(fs.stat(path.join(f.directory, 'npm-work/publication-dispatch.json')), { code: 'ENOENT' });
  }
});

test('data verifier rejects changed bytes, unlisted files, redirected inputs and unsafe publish configuration', async t => {
  for (const mutate of [
    async f => fs.appendFile(path.join(f.assets, f.filename), 'changed'),
    async f => fs.writeFile(path.join(f.directory, 'bundle-data/unlisted.mjs'), 'throw 1'),
    async f => { await fs.unlink(path.join(f.assets, f.filename)); await fs.symlink(path.join(f.directory, 'handoff.json'), path.join(f.assets, f.filename)); },
    async f => { f.env.EXPECTED_NPM_HANDOFF = JSON.stringify({ ...f.handoff, filename: '../outside.tgz' }); },
    async f => { f.env.EXPECTED_NPM_HANDOFF = JSON.stringify({ ...f.handoff, authentication: 'unexpected override' }); },
    async f => { f.env.EXPECTED_BUNDLE_SHA256 = '0'.repeat(64); },
  ]) {
    const f = await fixture(t);
    await f.run('NPM_OIDC_PREFLIGHT');
    await mutate(f);
    await assert.rejects(f.run('NPM_DATA_VERIFY'), /mismatch|Unlisted|Nonregular|Invalid/u);
  }
  const wrongConfig = await fixture(t, { publishConfig: { registry: 'https://registry.npmjs.org', access: 'public', provenance: false } });
  await wrongConfig.run('NPM_OIDC_PREFLIGHT');
  await assert.rejects(wrongConfig.run('NPM_DATA_VERIFY'), /publication configuration is not approved/u);
});

test('inline OIDC transport is idempotent, rejects conflicting versions, and never repacks or runs scripts', async t => {
  for (const version of ['0.3.0', '0.3.1-rc.1', '0.3.1+build-with-dash']) {
    const existingFixture = await fixture(t, { version });
    await existingFixture.run('NPM_OIDC_PREFLIGHT');
    await existingFixture.run('NPM_DATA_VERIFY');
    const existing = await existingFixture.run('NPM_OIDC_PUBLISH', { TEST_NPM_EXISTS: 'true' },
      path.join(existingFixture.directory, 'npm-work'));
    assert.match(existing.stdout, /AlreadyPublishedIdentical/u);
    assert.match(existing.stdout, /NotVerifiedExistingPublication/u);
    await assert.rejects(fs.stat(path.join(existingFixture.directory, 'npm-call.json')), { code: 'ENOENT' });
    const conflicting = await fixture(t, { version });
    await conflicting.run('NPM_OIDC_PREFLIGHT');
    await conflicting.run('NPM_DATA_VERIFY');
    await assert.rejects(conflicting.run('NPM_OIDC_PUBLISH', { TEST_NPM_EXISTS: 'true', TEST_NPM_CORRUPT: 'true' },
      path.join(conflicting.directory, 'npm-work')), /Published npm bytes differ/u);
    await assert.rejects(fs.stat(path.join(conflicting.directory, 'npm-call.json')), { code: 'ENOENT' });
    const f = await fixture(t, { version });
    await f.run('NPM_OIDC_PREFLIGHT');
    await f.run('NPM_DATA_VERIFY');
    const work = path.join(f.directory, 'npm-work');
    const published = await f.run('NPM_OIDC_PUBLISH', { npm_config_registry: 'https://example.invalid' }, work);
    assert.match(published.stdout, /PublishedAndBytesVerified/u);
    const receipt = JSON.parse(await fs.readFile(path.join(work, 'npm-publication-result.json'), 'utf8'));
    assert.equal(receipt.provenanceMetadata.validation, 'Verified');
    assert.equal(receipt.provenanceMetadata.cryptographicSignatureVerification, 'NotRun');
    const call = JSON.parse(await fs.readFile(path.join(f.directory, 'npm-call.json'), 'utf8'));
    assert.deepEqual(call.args, ['publish', `./${f.filename}`, '--ignore-scripts', '--access', 'public', '--json',
      '--tag', f.handoff.distTag, '--registry', 'https://registry.npmjs.org']);
    assert.equal(call.config.inheritedRegistry,
      process.platform === 'win32' ? 'https://registry.npmjs.org' : undefined);
    assert.equal(call.config.provenance, undefined);
    assert.equal(call.config.scripts, 'true');
    await assert.rejects(fs.stat(path.join(work, 'payload-executed')), { code: 'ENOENT' });
  }
});

test('publication rejects changed auth files and effective token configuration before any registry action', async t => {
  for (const mode of ['user-file', 'project-file', 'effective-token']) {
    const f = await fixture(t);
    await f.run('NPM_OIDC_PREFLIGHT');
    await f.run('NPM_DATA_VERIFY');
    const work = path.join(f.directory, 'npm-work');
    if (mode === 'user-file') await fs.appendFile(path.join(work, 'user.npmrc'), '//registry.npmjs.org/:_authToken=unit-fixture\n');
    if (mode === 'project-file') await fs.writeFile(path.join(work, '.npmrc'), '//registry.npmjs.org/:_authToken=unit-fixture\n');
    await assert.rejects(f.run('NPM_OIDC_PUBLISH', mode === 'effective-token' ? { TEST_NPM_EFFECTIVE_AUTH: 'true' } : {}, work),
      /auth config|auth configuration/u);
    await assert.rejects(fs.stat(path.join(f.directory, 'npm-call.json')), { code: 'ENOENT' });
  }
});

test('T-PRD041 provenance metadata binds source, caller, subject and hosted builder without claiming cryptographic verification', async t => {
  for (const overrides of [
    { TEST_NPM_MISSING_PROVENANCE: 'true' },
    ...['source', 'caller', 'subject', 'builder'].map(value => ({ TEST_NPM_BAD_PROVENANCE: value })),
  ]) {
    const f = await fixture(t);
    await f.run('NPM_OIDC_PREFLIGHT');
    await f.run('NPM_DATA_VERIFY');
    const work = path.join(f.directory, 'npm-work');
    await assert.rejects(f.run('NPM_OIDC_PUBLISH', { TEST_NPM_EXISTS: 'true', ...overrides }, work), /provenance metadata/u);
    await assert.rejects(fs.stat(path.join(f.directory, 'npm-call.json')), { code: 'ENOENT' });
    const result = JSON.parse(await fs.readFile(path.join(work, 'npm-publication-result.json'), 'utf8'));
    assert.equal(result.status, 'FailedOrIncomplete');
    assert.equal(result.publishAttempted, false);
  }
});

test('the verified npm upgrade is used for publishing, and bad provenance retains a truthful partial result', async t => {
  const f = await fixture(t);
  await f.run('NPM_OIDC_PREFLIGHT', { TEST_NPM_VERSION: '11.14.0' });
  await f.run('NPM_DATA_VERIFY');
  const work = path.join(f.directory, 'npm-work');
  const result = await f.run('NPM_OIDC_PUBLISH', { TEST_NPM_VERSION: '11.14.0' }, work);
  assert.match(result.stdout, /PublishedAndBytesVerified/u);
  const tool = JSON.parse(await fs.readFile(path.join(work, 'npm-tool.json'), 'utf8'));
  assert.equal(tool.npmVersion, '11.16.0');
  const bad = await fixture(t);
  await bad.run('NPM_OIDC_PREFLIGHT');
  await bad.run('NPM_DATA_VERIFY');
  const badWork = path.join(bad.directory, 'npm-work');
  await assert.rejects(bad.run('NPM_OIDC_PUBLISH', { TEST_NPM_BAD_PROVENANCE: 'source' }, badWork), /provenance metadata/u);
  const partial = JSON.parse(await fs.readFile(path.join(badWork, 'npm-publication-result.json'), 'utf8'));
  assert.equal(partial.status, 'FailedOrIncomplete');
  assert.equal(partial.publishAttempted, true);
  assert.equal(partial.provenanceMetadata, 'NotVerified');
});

test('T-PRD041 native provenance adapter requires real verifier success, exact subjects and witnessed signatures', async t => {
  for (const fault of ['none', 'source', 'workflow', 'digest', 'missing', 'signature', 'empty-audit', 'transparency']) {
    const f = await fixture(t);
    const root = path.join(f.directory, 'consumer-provenance');
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, f.filename), f.bytes);
    const manifest = JSON.parse(await fs.readFile(path.join(f.directory, 'bundle-data/bundle.json')));
    const descriptor = JSON.parse(await fs.readFile(path.join(f.assets, 'release-descriptor.json')));
    const bundle = { ...manifest, descriptor, releaseRepository: NPM_TRUST.repository };
    const proofBytes = Buffer.from('Unit fixture for a host-verified evidence archive; not a signature or release');
    const proof = { filename: 'unit-evidence.tar.gz', sha256: sha256(proofBytes) };
    const metadata = { name: descriptor.name, version: descriptor.version, dist: {
      tarball: `https://registry.npmjs.org/${descriptor.name}/-/${f.filename}`,
      integrity: f.handoff.integrity, signatures: [{ sig: 'fixture-only-host-tool-controls-verification' }],
      ...(fault === 'missing' ? {} : { attestations: { url:
        `https://registry.npmjs.org/-/npm/v1/attestations/${descriptor.name}@${descriptor.version}` } }),
    } };
    const statement = { _type: 'https://in-toto.io/Statement/v1', predicateType: 'https://slsa.dev/provenance/v1',
      subject: [{ name: `pkg:npm/${descriptor.name}@${descriptor.version}`,
        digest: { sha512: fault === 'digest' ? '0'.repeat(128) :
          Buffer.from(f.handoff.integrity.slice(7), 'base64').toString('hex') } }],
      predicate: { buildDefinition: {
        buildType: 'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1',
        externalParameters: { workflow: { repository: 'https://github.com/urmich/ai-sdlc-framework',
          path: fault === 'workflow' ? '.github/workflows/other.yml' : '.github/workflows/release.yml',
          ref: 'refs/heads/main' } },
        resolvedDependencies: [{ uri: 'git+https://github.com/urmich/ai-sdlc-framework@refs/heads/main',
          digest: { gitCommit: fault === 'source' ? 'b'.repeat(40) : sourceCommit } }],
      }, runDetails: { builder: { id: 'https://github.com/actions/runner/github-hosted' } } } };
    const fetcher = async url => new Response(String(url).startsWith('https://github.com/') ? proofBytes :
      JSON.stringify({ attestations: [{ predicateType: statement.predicateType, bundle: { dsseEnvelope: {
        payloadType: 'application/vnd.in-toto+json', payload: Buffer.from(JSON.stringify(statement)).toString('base64'),
      } } }] }));
    const run = async (command, args, options) => {
      if (command === 'gh') {
        if (args[0] === '--version') return { stdout: 'gh version 2.83.0 (controlled fixture)\n', stderr: '' };
        assert.ok(args.includes('--source-digest') && args.includes(sourceCommit));
        assert.ok(args.includes('--deny-self-hosted-runners'));
        return { stdout: JSON.stringify([{ verificationResult: {
          statement: { subject: [{ digest: { sha256: proof.sha256 } }] },
          verifiedTimestamps: fault === 'transparency' ? [] : [{ type: 'Tlog' }],
        } }]), stderr: '' };
      }
      if (args[0]?.endsWith('verify-npm-attestation.mjs')) {
        if (fault === 'signature') throw new Error('Host Sigstore verifier rejected the cryptographic signature');
        const bytes = await fs.readFile(args[args.indexOf('--bundle') + 1]);
        const signed = JSON.parse(bytes);
        const statementBytes = Buffer.from(signed.dsseEnvelope.payload, 'base64');
        return { stdout: JSON.stringify({ bundleSha256: sha256(bytes), statementSha256: sha256(statementBytes),
          statement: JSON.parse(statementBytes),
          verifier: { id: 'npm-bundled-sigstore', npmVersion: '11.16.0', version: 'controlled-host-fixture' },
          mechanisms: Object.fromEntries(['signature', 'certificate', 'transparency'].map(name => [name,
            { required: true, status: 'Passed', policy: 'Controlled host verifier; not actual cryptographic execution' }])) }),
        stderr: '' };
      }
      if (args.includes('install')) {
        const packageRoot = path.join(options.cwd, 'node_modules', descriptor.name);
        await extractEntries(readTarGzip(f.bytes).map(entry => ({ ...entry, path: entry.path.slice('package/'.length) })), packageRoot);
        await fs.writeFile(path.join(options.cwd, 'package-lock.json'), JSON.stringify({ packages: {
          '': { dependencies: { [descriptor.name]: descriptor.version } },
          [`node_modules/${descriptor.name}`]: { version: descriptor.version,
            resolved: metadata.dist.tarball, integrity: metadata.dist.integrity },
        } }));
        return { stdout: 'Unit fixture install only', stderr: '' };
      }
      if (fault === 'signature') throw Object.assign(new Error('Host npm verifier rejected the cryptographic signature'), { code: 1 });
      return { stdout: fault === 'empty-audit' ? 'audited 0 packages' :
        'audited 1 package in 0s\n1 package has a verified registry signature\n1 package has a verified attestation\n', stderr: '' };
    };
    const verify = () => verifyPublishedProvenance({ bundle, metadata, root,
      tool: { command: 'unit-only-signature-tool', root: path.join(root, 'npm-tool'), prefix: [], version: '11.16.0' }, environment: {},
      evidenceAsset: proof, fetcher, run });
    if (fault === 'none') assert.equal((await verify()).status, 'Passed', 'This is a controlled host-tool fixture, not actual cryptographic release evidence');
    else await assert.rejects(verify(), /provenance|signature|cryptographic|subject|witnessed/iu, fault);
  }
});
