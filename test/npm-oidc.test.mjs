import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { canonical, readTarGzip, sha256, tarGzip } from '../packaging/standalone/archive.mjs';
import { buildPackage } from '../scripts/package.mjs';
import { renderChecksums } from '../scripts/package-platforms.mjs';
import { NPM_TRUST } from '../scripts/npm-handoff.mjs';

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

async function fixture(t, { version = '0.3.0', publishConfig } = {}) {
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
  const bundle = { schemaVersion: 1, publicationReady: true,
    identity: { sourceCommit, version, payloadSha256: payload.sha256,
      descriptorSha256: sha256(descriptorBytes), checksumsSha256: sha256(checksums) }, files };
  const manifest = Buffer.from(canonical(bundle));
  await fs.writeFile(path.join(directory, 'bundle-data/bundle.json'), manifest);
  const handoff = { schemaVersion: 1, sourceRepository: NPM_TRUST.repository, sourceCommit,
    bundleSha256: sha256(manifest), packageName: 'ai-sdlc-framework', version, filename,
    sha256: payload.sha256, size: bytes.length, integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    distTag: version.split('+')[0].includes('-') ? 'next' : 'latest' };
  await fs.writeFile(path.join(directory, 'handoff.json'), JSON.stringify(handoff));
  const toolBytes = Buffer.from('Integrity-bound npm tool unit fixture; not a real CLI archive');
  await fs.writeFile(path.join(directory, 'npm-tool-download.tgz'), toolBytes);
  const tools = path.join(directory, 'tools');
  await fs.mkdir(tools);
  await fs.writeFile(path.join(tools, 'npm'), `#!${process.execPath}
import fs from 'node:fs';
import path from 'node:path';
if (process.argv[2] === '--version') {
  console.log(process.argv[1].includes('/npm-tool/node_modules/npm/bin/npm-cli.js') ?
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
  fs.writeFileSync(path.join(process.env.TEST_NPM_ROOT, 'published'), 'unit fixture');
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
    GITHUB_RUN_ID: '1234', GITHUB_RUN_ATTEMPT: '1',
    NPM_SOURCE_PRIVATE: 'false', NPM_TRUST_ENVIRONMENT: 'npm',
    NPM_TOOL_VERSION: '11.16.0', NPM_TOOL_INTEGRITY: `sha512-${createHash('sha512').update(toolBytes).digest('base64')}`,
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.invalid/oidc-fixture',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'unit-fixture-not-a-credential', TEST_NPM_ROOT: directory,
    TEST_NODE_VERSION: '24.16.0' };
  const run = (marker, overrides = {}, cwd = directory) =>
    execute(process.execPath, ['--import', mockModule,
      '--input-type=module', '-e', inlineScript(marker)],
    { cwd, env: { ...env, ...overrides }, maxBuffer: 4 * 1024 * 1024 });
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { directory, assets, bytes, filename, handoff, env, run };
}

test('protected npm job is data-only, tokenless, and trusts the actual reusable caller', async () => {
  const caller = await fs.readFile('.github/workflows/release.yml', 'utf8');
  assert.match(caller, /npm-readiness:[\s\S]*scripts\/npm-handoff\.mjs/u);
  assert.match(caller, /npm-handoff:[\s\S]*contents: read[\s\S]*id-token: write[\s\S]*uses: \.\/\.github\/workflows\/npm-publish\.yml/u);
  assert.match(workflow, /workflow_call:/u);
  assert.match(workflow, /environment: npm\s+permissions:\s+contents: read\s+id-token: write/u);
  assert.match(workflow, /runs-on: ubuntu-24\.04/u);
  assert.match(workflow, /node-version: '24'/u);
  assert.doesNotMatch(workflow, /actions\/checkout|secrets\.|attestations:|npm (?:ci|run)|node scripts\/|--provenance|registry-url:/u);
  assert.doesNotMatch(caller, /NODE_AUTH_TOKEN|secrets\.NPM_TOKEN|secrets: inherit/u);
  assert.deepEqual(NPM_TRUST, { repository: 'urmich/ai-sdlc-framework', callerFile: 'release.yml',
    publishingFile: 'npm-publish.yml', environment: 'npm' });
});

test('simulated OIDC preflight enforces hosted Node/npm and actual caller/environment boundaries', async t => {
  for (const overrides of [
    { RUNNER_ENVIRONMENT: 'self-hosted' }, { NPM_SOURCE_PRIVATE: 'true' },
    { NPM_CALLER_WORKFLOW_REF: `${NPM_TRUST.repository}/.github/workflows/npm-publish.yml@refs/heads/main` },
    { NPM_CALLER_WORKFLOW_REF: `${NPM_TRUST.repository}/.github/workflows/outer-wrapper.yml@refs/heads/main` },
    { NPM_TRUST_ENVIRONMENT: 'other' }, { ACTIONS_ID_TOKEN_REQUEST_TOKEN: '' },
    { GITHUB_WORKFLOW_REF: `${NPM_TRUST.repository}/.github/workflows/npm-publish.yml@refs/heads/main` },
    { EXPECTED_BUNDLE_ARTIFACT_ID: '1234,9999' },
    { TEST_NODE_VERSION: '22.12.0' },
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
    /npm >=11.15.0/u);
});

test('privileged data verifier reads only data, ignores embedded lifecycle scripts, and copies exact tgz bytes', async t => {
  const f = await fixture(t);
  await f.run('NPM_OIDC_PREFLIGHT');
  await f.run('NPM_DATA_VERIFY');
  assert.deepEqual(await fs.readFile(path.join(f.directory, 'npm-work', f.filename)), f.bytes);
  await assert.rejects(fs.stat(path.join(f.directory, 'npm-work/payload-executed')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(f.directory, 'npm-work/source-script.mjs')), { code: 'ENOENT' });
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
    const f = await fixture(t, { version });
    await f.run('NPM_OIDC_PREFLIGHT');
    await f.run('NPM_DATA_VERIFY');
    const work = path.join(f.directory, 'npm-work');
    const existing = await f.run('NPM_OIDC_PUBLISH', { TEST_NPM_EXISTS: 'true' }, work);
    assert.match(existing.stdout, /AlreadyPublishedIdentical/u);
    assert.match(existing.stdout, /NotVerifiedExistingPublication/u);
    await assert.rejects(fs.stat(path.join(f.directory, 'npm-call.json')), { code: 'ENOENT' });
    await assert.rejects(f.run('NPM_OIDC_PUBLISH', { TEST_NPM_EXISTS: 'true', TEST_NPM_CORRUPT: 'true' }, work),
      /Published npm bytes differ/u);
    const published = await f.run('NPM_OIDC_PUBLISH', { npm_config_registry: 'https://example.invalid' }, work);
    assert.match(published.stdout, /PublishedAndBytesVerified/u);
    const receipt = JSON.parse(await fs.readFile(path.join(work, 'npm-publication-result.json'), 'utf8'));
    assert.equal(receipt.provenanceMetadata.validation, 'Verified');
    assert.equal(receipt.provenanceMetadata.cryptographicSignatureVerification, 'NotRun');
    const call = JSON.parse(await fs.readFile(path.join(f.directory, 'npm-call.json'), 'utf8'));
    assert.deepEqual(call.args, ['publish', `./${f.filename}`, '--ignore-scripts', '--access', 'public',
      '--tag', f.handoff.distTag, '--registry', 'https://registry.npmjs.org']);
    assert.equal(call.config.inheritedRegistry, undefined);
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

test('provenance metadata is mandatory and binds source, caller, subject and hosted builder', async t => {
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
