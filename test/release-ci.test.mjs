import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readTarGzip, sha256, tarGzip } from '../packaging/standalone/archive.mjs';
import { platformEntries } from '../packaging/standalone/protocol.mjs';
import { generateManifests } from '../packaging/winget/generate.mjs';
import { buildPackage } from '../scripts/package.mjs';
import { buildPlatforms, writeReleaseMetadata } from '../scripts/package-platforms.mjs';
import { RELEASE_SCOPE, RELEASE_TARGETS, archiveRecord, evidenceIdentity, options,
  homebrewMetadata, releaseRepository, sealBundle, selectGateFiles, validateGates, verifyBundle, verifyCandidate, writeJson } from '../scripts/release-bundle.mjs';
import { publishDraft, publishNpm, verifyRegistryPayload } from '../scripts/publish-release.mjs';
import { downloadPublicAssets } from '../scripts/accept-release.mjs';

let root;
let base;
let payload;
let originalTmp;
const repository = 'example/public-releases';
const sourceCommit = 'a'.repeat(40);

function simulatedGates(identity) {
  // Unit fixtures only: these records never leave the per-test directory or represent a real CI run.
  return RELEASE_TARGETS.map(target => ({
    schemaVersion: 1, target, identity, required: RELEASE_SCOPE[target].required,
    validation: RELEASE_SCOPE[target].validation,
    status: target === 'macos-x64' ? 'NotRun' : 'Passed',
    nativeValidation: target === 'macos-arm64' ? 'Passed' : 'NotRun',
    ...(target === 'macos-arm64' ? { networkDeniedLifecycle: 'Passed', host: { platform: 'darwin', arch: 'arm64' } } : {}),
    ...(target === 'windows-x64' ? { deterministicCrossBuild: 'Passed', payloadIntegrity: 'Passed',
      schema: { schemaValidation: 'Passed' }, host: { platform: 'linux', arch: 'x64' },
      winget: { contractValidation: 'Passed', nativeValidation: 'NotRun' } } : {}),
  }));
}

test.before(async () => {
  root = path.resolve('.test-data', `release-unit-${randomUUID()}`);
  await fs.mkdir(path.join(root, 'scratch'), { recursive: true });
  originalTmp = process.env.TMPDIR;
  process.env.TMPDIR = path.join(root, 'scratch');
  payload = await buildPackage({ outputDir: path.join(root, 'npm') });
  const pe = Buffer.alloc(256);
  pe.write('MZ');
  pe.writeUInt32LE(128, 60);
  pe.writeUInt32LE(0x4550, 128);
  pe.writeUInt16LE(0x8664, 132);
  pe.writeUInt16LE(0x20b, 152);
  const launcher = path.join(root, 'nonexecutable-PE-test-fixture');
  await fs.writeFile(launcher, pe);
  base = path.join(root, 'base');
  const built = await buildPlatforms({ artifact: payload.artifact, outputDir: path.join(base, 'assets'),
    windowsLauncher: launcher, sourceCommit, targets: RELEASE_TARGETS });
  const archive = archiveRecord(built, 'windows-x64');
  const winget = await generateManifests({ version: built.descriptor.version, releaseRepository: repository,
    archive, archivePath: path.join(base, 'assets', archive.filename), outputDir: path.join(root, 'winget') });
  const final = await writeReleaseMetadata({ outputDir: path.join(base, 'assets'), artifact: payload.artifact,
    sourceCommit, targets: RELEASE_TARGETS, metadataFiles: winget.files });
  await writeJson(path.join(base, 'context.json'), { schemaVersion: 1, releaseRepository: repository,
    identity: evidenceIdentity(final), scope: RELEASE_SCOPE, prerelease: false, homebrew: { status: 'NotIntegrated' } });
});

test.after(async () => {
  if (originalTmp === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = originalTmp;
  await fs.rm(root, { recursive: true, force: true });
});

async function fixture(t) {
  const directory = path.join(root, randomUUID());
  const candidateDir = path.join(directory, 'candidate');
  const evidenceDir = path.join(directory, 'simulated-evidence');
  const outputDir = path.join(directory, 'bundle');
  await fs.cp(base, candidateDir, { recursive: true });
  const candidate = await verifyCandidate(candidateDir);
  for (const gate of simulatedGates(candidate.context.identity)) await writeJson(path.join(evidenceDir, `${gate.target}.json`), gate);
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { directory, candidateDir, evidenceDir, outputDir, candidate };
}

test('release scope requires Apple Silicon native and Windows cross-validation; Intel is NotRun and Linux excluded', () => {
  assert.deepEqual(RELEASE_TARGETS, ['macos-arm64', 'macos-x64', 'windows-x64']);
  assert.equal(RELEASE_SCOPE['linux-x64'].publish, false);
  for (const invalid of ['', 'https://github.com/owner/repo', 'owner/../repo', 'owner/repo\nx']) {
    assert.throws(() => releaseRepository(invalid), /explicitly approved/u);
  }
  assert.equal(releaseRepository(repository), repository);
  assert.deepEqual(options(['--candidate-dir', 'with spaces', '--target', 'macos-arm64']),
    { candidateDir: 'with spaces', target: 'macos-arm64' });
  assert.throws(() => options(['--target', 'x', '--target', 'y']), /Duplicate/u);
});

test('bundle seals exact payload and final manager metadata before descriptor/checksum pins', async t => {
  const f = await fixture(t);
  const sealed = await sealBundle(f);
  const bundle = await verifyBundle({ directory: f.outputDir, expectedBundleSha256: sealed.bundleSha256 });
  assert.equal(bundle.identity.payloadSha256, payload.sha256);
  assert.equal(bundle.descriptor.files.filter(file => file.kind === 'winget').length, 3);
  assert.ok(bundle.files.every(file => !file.filename.includes('linux')));
  assert.equal(bundle.context.homebrew.status, 'NotIntegrated');
  const names = bundle.files.map(file => file.filename);
  assert.ok(names.includes('assets/release-descriptor.json'));
  assert.ok(names.includes('assets/SHA256SUMS'));
  await assert.rejects(verifyBundle({ directory: f.outputDir, expectedBundleSha256: '0'.repeat(64) }), /digest mismatch/u);
  await assert.rejects(verifyCandidate(f.candidateDir, { sourceCommit: 'b'.repeat(40) }), /trusted evidence/u);
});

test('Homebrew adapter uses the committed generator contract and rejects a different public destination', async t => {
  const f = await fixture(t);
  const descriptor = f.candidate.descriptor;
  const generator = async input => {
    assert.deepEqual(input, { descriptor, artifactDirectory: path.join(f.candidateDir, 'assets'), mode: 'stable' });
    const contents = ['macos-arm64', 'macos-x64'].map(target =>
      `  url "https://github.com/${repository}/releases/download/v${descriptor.version}/${archiveRecord({ descriptor }, target).filename}"\n`).join('');
    return { filename: 'ai-sdlc-framework.rb', kind: 'homebrew', mode: 'stable',
      contents, sha256: sha256(Buffer.from(contents)), size: Buffer.byteLength(contents) };
  };
  const args = { descriptor, artifactDirectory: path.join(f.candidateDir, 'assets'),
    outputDir: path.join(f.directory, 'formula'), repository, generator };
  const result = await homebrewMetadata(args);
  assert.equal(result.status, 'Generated');
  assert.equal(result.nativeValidation, 'NotRun');
  assert.equal(result.files[0].sha256, sha256(await fs.readFile(result.files[0].artifact)));
  await assert.rejects(homebrewMetadata({ ...args, repository: 'wrong/repo' }), /approved release repository/u);
  await assert.rejects(homebrewMetadata({ ...args, generator: async input =>
    ({ ...await generator(input), sha256: '0'.repeat(64) }) }), /invalid stable formula record/u);
});

test('missing, failed, stale, skipped or emulated required evidence blocks sealing', async t => {
  const f = await fixture(t);
  const gates = simulatedGates(f.candidate.context.identity);
  for (const mutate of [
    values => values.pop(),
    values => { values[0].status = 'NotRun'; },
    values => { values[0].host.arch = 'x64'; },
    values => { values[0].identity = { ...values[0].identity, payloadSha256: '0'.repeat(64) }; },
    values => { values.find(item => item.target === 'windows-x64').nativeValidation = 'Passed'; },
    values => { values.find(item => item.target === 'windows-x64').schema.schemaValidation = 'NotRun'; },
    values => { values.find(item => item.target === 'macos-x64').status = 'Passed'; },
  ]) {
    const copy = structuredClone(gates);
    mutate(copy);
    assert.throws(() => validateGates(copy, f.candidate.context.identity));
  }
  await fs.unlink(path.join(f.evidenceDir, 'macos-arm64.json'));
  await assert.rejects(sealBundle(f), /every scoped gate/u);
});

test('partial workflow reruns retain prior successful targets but never hide a newer failed gate', async t => {
  const f = await fixture(t);
  const evidenceDir = path.join(f.directory, 'downloaded-gate-artifacts');
  const gates = simulatedGates(f.candidate.context.identity);
  for (const gate of gates) {
    await writeJson(path.join(evidenceDir, `release-gate-${gate.target}-123-1`, `${gate.target}.json`),
      { ...gate, run: { id: '123', attempt: '1' } });
  }
  const failed = { ...gates[0], status: 'Failed', run: { id: '123', attempt: '2' } };
  await writeJson(path.join(evidenceDir, `release-gate-${failed.target}-123-2`, `${failed.target}.json`), failed);
  const selected = await selectGateFiles(evidenceDir, '123');
  assert.ok(selected.find(file => file.includes('macos-arm64')).includes('-123-2'));
  await assert.rejects(sealBundle({ ...f, evidenceDir, runId: '123' }), /Required gate did not pass/u);
  await assert.rejects(selectGateFiles(evidenceDir, '124'), /Unexpected gate artifact/u);
});

test('immutable bundle rejects modified, extra, empty-directory and linked content', async t => {
  const f = await fixture(t);
  await sealBundle(f);
  const extra = path.join(f.outputDir, 'unexpected');
  await fs.mkdir(extra);
  await assert.rejects(verifyBundle({ directory: f.outputDir }), /empty directories/u);
  await fs.rmdir(extra);
  await fs.writeFile(extra, 'changed');
  await assert.rejects(verifyBundle({ directory: f.outputDir }), /files changed/u);
  await fs.unlink(extra);
  await fs.symlink(path.join(f.outputDir, 'context.json'), extra);
  await assert.rejects(verifyBundle({ directory: f.outputDir }), /regular files/u);
  await fs.unlink(extra);
  await fs.appendFile(path.join(f.outputDir, 'assets', payload.filename), 'changed');
  await assert.rejects(verifyBundle({ directory: f.outputDir }), /files changed/u);
});

test('checksum-consistent Linux archives cannot enter a scoped candidate', async t => {
  const f = await fixture(t);
  const filename = `ai-sdlc-framework-${payload.version}-linux-x64.tar.gz`;
  await fs.writeFile(path.join(f.candidateDir, 'assets', filename),
    tarGzip(platformEntries(await fs.readFile(payload.artifact), 'linux-x64').entries));
  await writeReleaseMetadata({ outputDir: path.join(f.candidateDir, 'assets'), artifact: payload.artifact,
    sourceCommit, targets: [...RELEASE_TARGETS, 'linux-x64'] });
  await assert.rejects(verifyCandidate(f.candidateDir), /Unlisted|wrong-platform/u);
});

function githubFixture(bundle, directory) {
  let release;
  const assets = [];
  const calls = [];
  let tagCommit = sourceCommit;
  let privateRepo = false;
  const api = async (route, options = {}) => {
    calls.push({ route, ...options });
    if (route === `/repos/${repository}`) return { status: 200, value: { private: privateRepo } };
    if (route.includes('/git/ref/tags/')) return { status: 200, value: { object: { type: 'commit', sha: tagCommit } } };
    if (route.includes('/releases/tags/')) return release ? { status: 200, value: release } : { status: 404 };
    if (route === `/repos/${repository}/releases` && options.method === 'POST') {
      release = { id: 7, ...options.body };
      return { status: 201, value: release };
    }
    if (route.includes('/assets?per_page=')) return { status: 200, value: assets };
    if (route.startsWith('/uploads/')) {
      const name = new URL(`https://example.invalid${route}`).searchParams.get('name');
      const asset = { name, id: assets.length + 100, size: options.bytes.length,
        state: 'uploaded', bytes: Buffer.from(options.bytes) };
      assets.push(asset);
      return { status: 201, value: asset };
    }
    const id = Number(route.split('/').at(-1));
    return { status: 200, value: assets.find(asset => asset.id === id).bytes };
  };
  return { api, calls, assets, directory, bundle,
    setTag: value => { tagCommit = value; }, setPrivate: value => { privateRepo = value; },
    makePublic: () => { release.draft = false; } };
}

test('draft publication is idempotent and never overwrites mismatched bytes or creates tags', async t => {
  const f = await fixture(t);
  const sealed = await sealBundle(f);
  const bundle = await verifyBundle({ directory: f.outputDir });
  const mock = githubFixture(bundle, f.outputDir);
  const request = { directory: f.outputDir, repository, expectedBundleSha256: sealed.bundleSha256 };
  assert.equal((await publishDraft(request, mock.api)).status, 'DraftAssetsVerified');
  const mutations = mock.calls.filter(call => call.method === 'POST').length;
  await publishDraft(request, mock.api);
  assert.equal(mock.calls.filter(call => call.method === 'POST').length, mutations);
  assert.ok(mock.calls.every(call => !['DELETE', 'PATCH', 'PUT'].includes(call.method)));
  mock.assets[0].bytes[0] ^= 255;
  await assert.rejects(publishDraft(request, mock.api), /conflicts/u);
  assert.equal(mock.calls.filter(call => call.method === 'POST').length, mutations);
});

test('draft publication rejects private repos, wrong tag commits, unexpected assets and public releases', async t => {
  const f = await fixture(t);
  await sealBundle(f);
  const bundle = await verifyBundle({ directory: f.outputDir });
  const mock = githubFixture(bundle, f.outputDir);
  const request = { directory: f.outputDir, repository };
  await assert.rejects(publishDraft({ ...request, repository: 'other/repo' }, mock.api), /frozen metadata/u);
  mock.setPrivate(true);
  await assert.rejects(publishDraft(request, mock.api), /public repository/u);
  mock.setPrivate(false);
  mock.setTag('b'.repeat(40));
  await assert.rejects(publishDraft(request, mock.api), /exact validated source/u);
  mock.setTag(sourceCommit);
  await publishDraft(request, mock.api);
  mock.assets.push({ name: 'unowned.txt' });
  await assert.rejects(publishDraft(request, mock.api), /unexpected assets/u);
  mock.assets.pop();
  mock.makePublic();
  await assert.rejects(publishDraft(request, mock.api), /matching draft/u);
});

test('anonymous public acceptance compares saved hashes before extraction or native execution', async t => {
  const f = await fixture(t);
  await sealBundle(f);
  const bundle = await verifyBundle({ directory: f.outputDir });
  const requests = [];
  const fetcher = async (url, options) => {
    assert.equal(options, undefined, 'Anonymous asset downloads never send authentication options');
    requests.push(url);
    const filename = decodeURIComponent(new URL(url).pathname.split('/').at(-1));
    const bytes = await fs.readFile(path.join(f.outputDir, 'assets', filename));
    return new Response(bytes);
  };
  assert.equal((await downloadPublicAssets(bundle, path.join(f.directory, 'public-download'), fetcher)).status, 'Passed');
  assert.ok(requests[0].endsWith('release-descriptor.json'));
  assert.ok(requests[1].endsWith('SHA256SUMS'));
  await assert.rejects(downloadPublicAssets(bundle, path.join(f.directory, 'corrupt-download'),
    async () => new Response('bad bytes')), /prepublication evidence/u);
  await assert.rejects(downloadPublicAssets(bundle, path.join(f.directory, 'unpublished-download'),
    async () => new Response('', { status: 404 })), /unavailable/u);
});

test('npm handoff reuses the exact bundled tgz and identical public versions never republish', async t => {
  const f = await fixture(t);
  await sealBundle(f);
  const bytes = await fs.readFile(payload.artifact);
  const pkg = JSON.parse(readTarGzip(bytes).find(entry => entry.path === 'package/package.json').data);
  const metadata = { name: pkg.name, version: pkg.version, dist: {
    tarball: `https://registry.npmjs.org/${pkg.name}/-/${payload.filename}`,
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` } };
  const fetcher = async url => new Response(String(url).endsWith('.tgz') ? bytes : JSON.stringify(metadata));
  const sourceRepository = pkg.repository.url.slice('https://github.com/'.length, -4);
  const result = await publishNpm({ directory: f.outputDir, sourceRepository }, {
    fetcher, run: () => assert.fail('An identical existing npm version must not be republished'),
  });
  assert.equal(result.status, 'AlreadyPublishedIdentical');
  let published = false;
  await publishNpm({ directory: f.outputDir, sourceRepository }, {
    fetcher: async url => !published ? new Response('', { status: 404 }) : fetcher(url),
    run: async (_command, args) => {
      const index = args.indexOf('publish');
      assert.equal(await fs.readFile(args[index + 1]).then(sha256), payload.sha256);
      assert.ok(args.includes('--ignore-scripts'));
      published = true;
    },
    sleep: () => assert.fail('Mock registry is immediately consistent'),
  });
  await assert.rejects(verifyRegistryPayload(metadata, { name: pkg.name, version: pkg.version,
    sha256: '0'.repeat(64) }, fetcher), /immutable release payload/u);
});

test('release workflow statically separates validation, sealing, opt-in publication and live acceptance', async () => {
  const ci = await fs.readFile('.github/workflows/ci.yml', 'utf8');
  const workflow = await fs.readFile('.github/workflows/release.yml', 'utf8');
  assert.doesNotMatch(ci, /publish-npm|publish-release|--clobber|gh release/u);
  assert.match(workflow, /target: macos-arm64\s+runner: macos-15/u);
  assert.match(workflow, /target: windows-x64\s+runner: ubuntu-24\.04/u);
  assert.match(workflow, /target: macos-x64\s+runner: ubuntu-24\.04/u);
  assert.match(workflow, /needs: \[candidate, release-gates\]/u);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch' && inputs\.publish_draft/u);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch' && inputs\.publish_npm/u);
  assert.doesNotMatch(workflow, /windows-latest|--clobber|--draft=false|mktemp|linux-x64/u);
  const acceptance = await fs.readFile('.github/workflows/release-acceptance.yml', 'utf8');
  assert.match(acceptance, /artifact-ids: \$\{\{ inputs\.bundle_artifact_id \}\}/u);
  assert.match(acceptance, /EXPECTED_BUNDLE_SHA256/u);
});
