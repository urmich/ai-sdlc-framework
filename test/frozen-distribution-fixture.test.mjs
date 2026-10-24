export const validationDeclarations = {
  "schemaVersion": 1,
  "applicability": [
    {
      "names": [
        "T-PRD014 frozen distribution setup reuses exact verified bytes without builders and rereads every use",
        "T-PRD014 incomplete or wrong source and artifact contexts fail before setup mutation",
        "T-PRD014 setup rejects swapped foreign linked nonregular and unknown-target inputs",
        "T-PRD014 source verification rejects same-head edits and resealed payload source or mode changes",
        "T-PRD014 missing frozen inputs select real build boundaries and dedicated transport excludes siblings",
        "T-PRD016 verified private Linux setup preserves published bytes and target order without claiming standalone credit",
        "T-PRD014 real beforehook RED old packaging boundary versus verified frozen setup without builds",
        "T-PRD014 current-source fixtures and beforehook work without historical Git objects"
      ],
      "platforms": ["linux-x64", "windows-x64", "macos-arm64", "macos-x64"],
      "owner": "maintainer",
      "reason": "PR-only setup trust-boundary regressions; each root owns an exact current-source snapshot, archives and cleanup. The history-independent regression runs only two representative roots. No shared mutations, network, real builds, native execution or critical-budget additions.",
      "prerequisites": ["Node >=22", "Git and the current source checkout", "Owned checkout-local filesystem with directory links"]
    },
    {
      "names": ["T-PRD057 fixture-free release policy avoids builders while real consumers retain setup"],
      "platforms": ["linux-x64", "windows-x64", "macos-arm64", "macos-x64"],
      "owner": "maintainer",
      "reason": "PR-only pure-root and required-build boundary regression. Owned child processes deny all non-Git command dispatch; no package-manager, provisioning, native execution or critical-budget additions.",
      "prerequisites": ["Node >=22", "Git", "Owned checkout-local filesystem"]
    }
  ],
  "groups": [{
    "root": "T-PRD057 fixture-free release policy avoids builders while real consumers retain setup",
    "minimumSlots": 3
  }],
  "surfaces": [
    {"coverage": "direct", "paths": ["scripts/frozen-distribution-fixture.mjs", "scripts/frozen-fixture-transport.mjs", "scripts/committed-source-inputs.mjs"]}
  ]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { digest } from '../src/core.mjs';
import { tarGzip, zip, sha256 } from '../packaging/standalone/archive.mjs';
import { platformEntries } from '../packaging/standalone/protocol.mjs';
import { writeReleaseMetadata } from '../scripts/package-platforms.mjs';
import { frozenDistributionContext, prepareDistributionFixture } from '../scripts/frozen-distribution-fixture.mjs';
import { filterFrozenFixtureTransport } from '../scripts/frozen-fixture-transport.mjs';
import { executeValidationCommand } from '../scripts/validation-tools.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const execute = promisify(execFile);
function gitEnvironment() {
  const environment = { ...process.env };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) delete environment[key];
  return environment;
}
const git = args => execute('git', args, { cwd: ROOT, env: gitEnvironment(), maxBuffer: 8 * 1024 * 1024 });
const required = ['LICENSE', 'package.json', 'bin/sdlc.mjs', 'src/install.mjs',
  'packaging/standalone/runtime.mjs', 'packaging/standalone/install.sh',
  'packaging/standalone/install.ps1', 'packaging/standalone/sdlc'];
const forbidden = () => { throw new Error('FORBIDDEN_SETUP_BUILD'); };

async function snapshotSource(root) {
  const sourceRoot = path.join(root, 's');
  const hooks = path.join(root, 'h');
  await fs.mkdir(hooks);
  const environment = { ...gitEnvironment(), GIT_AUTHOR_NAME: 'Owned source fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Owned source fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
  await execute('git', ['init', '--quiet', sourceRoot], { cwd: ROOT, env: environment });
  const sourceGit = (args, input) => {
    const result = execute('git', ['-c', `core.hooksPath=${hooks}`, ...args],
      { cwd: sourceRoot, env: environment, maxBuffer: 8 * 1024 * 1024 });
    if (input !== undefined) result.child.stdin.end(input);
    return result;
  };
  const index = (await git(['ls-files', '--stage', '-z'])).stdout;
  const modes = new Map(index.split('\0').filter(Boolean).map(record => {
    const match = /^(100644|100755) [a-f0-9]+ 0\t(.+)$/su.exec(record);
    assert.ok(match, 'Current source requires regular merged Git modes');
    return [match[2], match[1]];
  }));
  const files = [...modes.keys()].filter(file =>
      !file.split('/').some(part => ['.git', '.test-data', 'node_modules'].includes(part)) &&
      !file.startsWith('test/.runner-fixture-')).sort();
  for (const file of [...required, 'scripts/frozen-distribution-fixture.mjs',
    'scripts/committed-source-inputs.mjs', 'scripts/frozen-fixture-transport.mjs',
    'test/frozen-distribution-fixture.test.mjs']) {
    assert.ok(files.includes(file), `Required fixture source must be registered in the Git index: ${file}`);
  }
  for (const file of files) {
    const original = path.join(ROOT, ...file.split('/'));
    const stat = await fs.lstat(original);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Snapshot source must be regular');
    const destination = path.join(sourceRoot, ...file.split('/'));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(original, destination);
    await fs.chmod(destination, modes.get(file) === '100755' ? 0o755 : 0o644);
  }
  // Commit the exact tested bytes, without checkout/clean filters or borrowed history.
  const hashes = (await sourceGit(['hash-object', '-w', '--no-filters', '--stdin-paths'],
    files.map(file => JSON.stringify(file)).join('\n') + '\n')).stdout.trim().split('\n');
  assert.equal(hashes.length, files.length);
  await sourceGit(['update-index', '-z', '--index-info'],
    files.map((file, index) => `${modes.get(file)} ${hashes[index]}\t${file}\0`).join(''));
  const tree = (await sourceGit(['write-tree'])).stdout.trim();
  const revision = (await sourceGit(['commit-tree', tree, '-m', `Owned current source ${randomUUID()}`])).stdout.trim();
  await sourceGit(['update-ref', 'HEAD', revision]);
  return { sourceRoot, sourceGit };
}

async function fixture(t, { targets = ['macos'], kind = 'published-candidate' } = {}) {
  const root = path.join(ROOT, '.test-data', `fs-${randomUUID().slice(0, 16)}`);
  await fs.mkdir(root, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { sourceRoot, sourceGit } = await snapshotSource(root);
  const directory = path.join(sourceRoot, '.test-data', 'release');
  await fs.mkdir(directory, { recursive: true });
  const source = (await sourceGit(['rev-parse', 'HEAD'])).stdout.trim();
  const tree = (await sourceGit(['rev-parse', 'HEAD^{tree}'])).stdout.trim();
  const index = (await sourceGit(['ls-files', '--stage', '-z'])).stdout;
  const entries = await Promise.all(required.map(async file => ({
    path: `package/${file}`, data: await fs.readFile(path.join(sourceRoot, ...file.split('/'))),
    mode: index.split('\0').find(line => line.endsWith(`\t${file}`)).startsWith('100755') ? 0o755 : 0o644,
  })));
  const bytes = tarGzip(entries);
  const pkg = JSON.parse(entries.find(entry => entry.path === 'package/package.json').data);
  const artifact = path.join(directory, `${pkg.name}-${pkg.version}.tgz`);
  await fs.writeFile(artifact, bytes);
  const archive = `${pkg.name}-${pkg.version}-macos.tar.gz`;
  // Format-only PE bytes exercise archive guards, never native execution or installer success.
  const launcher = Buffer.alloc(512);
  launcher.write('MZ');
  launcher.writeUInt32LE(128, 60);
  launcher.writeUInt32LE(0x00004550, 128);
  launcher.writeUInt16LE(0x8664, 132);
  launcher.writeUInt16LE(0x20b, 152);
  for (const target of targets) {
    const extension = target === 'windows-x64' ? 'zip' : 'tar.gz';
    const encode = target === 'windows-x64' ? zip : tarGzip;
    await fs.writeFile(path.join(directory, `${pkg.name}-${pkg.version}-${target}.${extension}`),
      encode(platformEntries(bytes, target, launcher).entries));
  }
  const metadataFile = path.join(directory, 'frozen-setup-metadata.txt');
  await fs.writeFile(metadataFile, 'controlled frozen metadata\n');
  const release = await writeReleaseMetadata({ outputDir: directory, artifact, sourceCommit: source, targets,
    metadataFiles: [{ file: metadataFile, kind: 'metadata' }] });
  let published = release;
  if (kind === 'private-test-library-only') {
    const publishedDirectory = path.join(sourceRoot, '.test-data', 'published');
    await fs.mkdir(publishedDirectory);
    for (const file of release.descriptor.files.filter(file =>
      file.kind === 'archive' && !file.filename.endsWith('-linux-x64.tar.gz'))) {
      await fs.copyFile(path.join(directory, file.filename), path.join(publishedDirectory, file.filename));
    }
    published = await writeReleaseMetadata({ outputDir: publishedDirectory,
      artifact: path.join(publishedDirectory, path.basename(artifact)), sourceCommit: source,
      targets: ['macos', 'windows-x64'] });
  }
  const artifacts = [{ name: 'frozen-descriptor', sha256: published.descriptorSha256 },
    { name: 'frozen-checksums', sha256: published.checksumsSha256 },
    ...published.descriptor.files.map(file => ({ name: file.filename, sha256: file.sha256 }))]
    .sort((a, b) => a.name < b.name ? -1 : 1);
  const native = { candidateDigest: digest({ revision: source, tree }),
    sources: [{ repositoryId: 'controlled-source', revision: source, contentDigest: digest(tree) }], artifacts };
  const createContext = options => frozenDistributionContext({ sourceRoot, ...options });
  const context = await createContext({ directory, targets, context: native, kind });
  const environment = { ...process.env, SDLC_RELEASE_DIR: directory, SDLC_RELEASE_SOURCE_COMMIT: source,
    SDLC_DISTRIBUTION_FIXTURE_CONTEXT: JSON.stringify(context), SDLC_DISTRIBUTION_TARGETS: targets.join(',') };
  return { root, sourceRoot, sourceGit, createContext, directory, artifact, archive, bytes, source, release, native, context, environment,
    options: { root: path.join(root, 'must-not-be-created'), environment, targets,
      packageBuilder: forbidden, platformBuilder: forbidden, sourceRoot } };
}

test('T-PRD014 frozen distribution setup reuses exact verified bytes without builders and rereads every use', async t => {
  const f = await fixture(t);
  const first = await prepareDistributionFixture(f.options);
  assert.equal(first.kind, 'published-candidate');
  assert.deepEqual(first.built.descriptor, f.release.descriptor);
  assert.equal(first.built.descriptorSha256, f.release.descriptorSha256);
  assert.equal(first.built.checksumsSha256, f.release.checksumsSha256);
  assert.equal(first.payload.artifact, f.artifact);
  assert.equal(first.payload.sha256, sha256(f.bytes));
  assert.deepEqual(first.built.payload, { filename: path.basename(f.artifact), sha256: sha256(f.bytes) });
  assert.deepEqual(first.built.archives, [{ target: 'macos', filename: f.archive,
    artifact: path.join(f.directory, f.archive),
    ...Object.fromEntries(['sha256', 'size'].map(key => [key,
      f.release.descriptor.files.find(file => file.filename === f.archive)[key]])) }]);
  assert.deepEqual(await prepareDistributionFixture(f.options), first);
  await assert.rejects(fs.lstat(f.options.root), { code: 'ENOENT' });
  await fs.appendFile(path.join(f.directory, f.archive), 'corruption');
  await assert.rejects(prepareDistributionFixture(f.options), /checksum mismatch/u);
});

test('T-PRD014 incomplete or wrong source and artifact contexts fail before setup mutation', async t => {
  const f = await fixture(t);
  for (const changed of [
    { SDLC_DISTRIBUTION_FIXTURE_CONTEXT: undefined },
    { SDLC_DISTRIBUTION_FIXTURE_CONTEXT: '{}' },
    { SDLC_RELEASE_SOURCE_COMMIT: undefined },
    { SDLC_RELEASE_SOURCE_COMMIT: 'a'.repeat(40) },
    { SDLC_DISTRIBUTION_FIXTURE_CONTEXT: JSON.stringify({ ...f.context, source: { ...f.context.source, contentDigest: 'a'.repeat(64) } }) },
    { SDLC_DISTRIBUTION_FIXTURE_CONTEXT: JSON.stringify({ ...f.context, native: { ...f.native, sources: [{ revision: 'a'.repeat(40) }] } }) },
    { SDLC_DISTRIBUTION_FIXTURE_CONTEXT: JSON.stringify({ ...f.context, artifacts: [] }) },
    { SDLC_DISTRIBUTION_FIXTURE_CONTEXT: JSON.stringify({ ...f.context, native: { ...f.native, artifacts: [] } }) },
    { SDLC_DISTRIBUTION_FIXTURE_CONTEXT: undefined, SDLC_TEST_REPORT_CONTEXT: JSON.stringify(f.context) },
  ]) {
    await assert.rejects(prepareDistributionFixture({ ...f.options,
      environment: { ...f.environment, ...changed } }), /Frozen distribution fixture/u);
    await assert.rejects(fs.lstat(f.options.root), { code: 'ENOENT' });
  }
});

test('T-PRD014 setup rejects swapped foreign linked nonregular and unknown-target inputs', async t => {
  const f = await fixture(t);
  const swapped = path.join(f.root, 'swapped');
  await fs.cp(f.directory, swapped, { recursive: true });
  for (const directory of [swapped, ROOT, `${f.directory}${path.sep}..${path.sep}release`]) {
    await assert.rejects(prepareDistributionFixture({ ...f.options,
      environment: { ...f.environment, SDLC_RELEASE_DIR: directory } }), /stale\/swapped|literal|owned/u);
  }
  for (const targets of [['unknown'], ['macos', 'macos']]) {
    await assert.rejects(f.createContext({ directory: f.directory, targets, context: f.native }), /unknown or duplicate/u);
  }
  const link = path.join(f.sourceRoot, '.test-data', 'linked');
  await fs.symlink(f.directory, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.createContext({ directory: link, targets: ['macos'], context: f.native }), /literal|owned/u);
  await fs.rm(path.join(f.directory, 'SHA256SUMS'));
  await fs.mkdir(path.join(f.directory, 'SHA256SUMS'));
  await assert.rejects(prepareDistributionFixture(f.options), /regular literal/u);
  await assert.rejects(fs.lstat(f.options.root), { code: 'ENOENT' });
});

test('T-PRD014 source verification rejects same-head edits and resealed payload source or mode changes', async t => {
  const f = await fixture(t);
  const marker = path.join(f.sourceRoot, 'test', 'npm-environment.mjs');
  const original = await fs.readFile(marker);
  await fs.appendFile(marker, '\n// same-head edit\n');
  assert.equal((await f.sourceGit(['rev-parse', 'HEAD'])).stdout.trim(), f.source);
  await assert.rejects(prepareDistributionFixture(f.options), /committed bytes/u);
  await fs.writeFile(marker, original);
  await f.sourceGit(['update-index', '--chmod=+x', 'test/npm-environment.mjs']);
  await assert.rejects(prepareDistributionFixture(f.options), /source index differs/u);
  await f.sourceGit(['update-index', '--chmod=-x', 'test/npm-environment.mjs']);
  const addition = path.join(f.sourceRoot, 'src', 'uncommitted-fixture.mjs');
  await fs.writeFile(addition, '// uncommitted source\n');
  await assert.rejects(prepareDistributionFixture(f.options), /uncommitted source additions/u);
  await fs.rm(addition);
  for (const modeOnly of [false, true]) {
    const { readTarGzip } = await import('../packaging/standalone/archive.mjs');
    const entries = readTarGzip(f.bytes).map(entry => entry.path === 'package/LICENSE' ?
      { ...entry, ...(modeOnly ? { mode: 0o755 } : { data: Buffer.from('changed source\n') }) } : entry);
    const bytes = tarGzip(entries);
    await fs.writeFile(f.artifact, bytes);
    await fs.writeFile(path.join(f.directory, f.archive), tarGzip(platformEntries(bytes, 'macos').entries));
    const changed = await writeReleaseMetadata({ outputDir: f.directory, artifact: f.artifact,
      sourceCommit: f.source, targets: ['macos'],
      metadataFiles: [{ file: path.join(f.directory, 'frozen-setup-metadata.txt'), kind: 'metadata' }] });
    const artifacts = [{ name: 'frozen-descriptor', sha256: changed.descriptorSha256 },
      { name: 'frozen-checksums', sha256: changed.checksumsSha256 },
      ...changed.descriptor.files.map(file => ({ name: file.filename, sha256: file.sha256 }))]
      .sort((a, b) => a.name < b.name ? -1 : 1);
    await assert.rejects(f.createContext({ directory: f.directory, targets: ['macos'],
      context: { ...f.native, artifacts } }), /payload source bytes\/mode differ/u);
  }
  await fs.writeFile(f.artifact, f.bytes);
  const malformed = platformEntries(f.bytes, 'macos').entries.map(entry =>
    entry.path === 'platform.json' ? { ...entry, data: Buffer.from('{}\n') } : entry);
  await fs.writeFile(path.join(f.directory, f.archive), tarGzip(malformed));
  await writeReleaseMetadata({ outputDir: f.directory, artifact: f.artifact,
    sourceCommit: f.source, targets: ['macos'],
    metadataFiles: [{ file: path.join(f.directory, 'frozen-setup-metadata.txt'), kind: 'metadata' }] });
  await assert.rejects(f.createContext({ directory: f.directory, targets: ['macos'],
    context: f.native }), /Wrong platform or architecture/u);
});

test('T-PRD014 missing frozen inputs select real build boundaries and dedicated transport excludes siblings', async t => {
  assert.equal(process.env.SDLC_DISTRIBUTION_FIXTURE_CONTEXT, undefined);
  const f = await fixture(t);
  const calls = [];
  const result = await prepareDistributionFixture({ root: f.options.root, targets: ['macos'], environment: {},
    packageBuilder: async options => { calls.push(['package', options]); return { artifact: 'controlled-boundary-only' }; },
    platformBuilder: async options => { calls.push(['platform', options]); return { marker: 'controlled-boundary-only' }; } });
  assert.deepEqual(result, { payload: { artifact: 'controlled-boundary-only' },
    built: { marker: 'controlled-boundary-only' } });
  assert.deepEqual(calls.map(([name]) => name), ['package', 'platform']);
  assert.equal(calls[1][1].artifact, 'controlled-boundary-only');
  const file = path.join(ROOT, 'test', 'distribution-channels.test.mjs');
  assert.deepEqual(filterFrozenFixtureTransport(f.environment, file), f.environment);
  for (const sibling of ['provider-observations.unit.test.mjs', 'release-ci.test.mjs', 'foreign/distribution-channels.test.mjs']) {
    const filtered = filterFrozenFixtureTransport(f.environment, path.join(ROOT, 'test', sibling));
    assert.equal(filtered.SDLC_DISTRIBUTION_FIXTURE_CONTEXT, undefined);
    assert.equal(f.environment.SDLC_DISTRIBUTION_FIXTURE_CONTEXT, JSON.stringify(f.context));
    assert.equal(filtered.SDLC_RELEASE_SOURCE_COMMIT, f.source);
  }
});

test('T-PRD016 verified private Linux setup preserves published bytes and target order without claiming standalone credit', async t => {
  const targets = ['macos', 'windows-x64', 'linux-x64'];
  const f = await fixture(t, { targets, kind: 'private-test-library-only' });
  const result = await prepareDistributionFixture(f.options);
  assert.equal(result.kind, 'private-test-library-only');
  assert.deepEqual(result.built.archives.map(archive => archive.target), targets);
  assert.deepEqual(result.built.payload, { filename: path.basename(f.artifact), sha256: sha256(f.bytes) });
  assert.ok(!f.native.artifacts.some(file => file.name.includes('linux')));
  for (const archive of result.built.archives.filter(archive => archive.target !== 'linux-x64')) {
    assert.equal(sha256(await fs.readFile(archive.artifact)),
      f.native.artifacts.find(file => file.name === archive.filename).sha256);
  }
  await assert.rejects(f.createContext({ directory: f.directory, targets, context: f.native,
    kind: 'published-candidate' }), /private test library inputs/u);
});

test('T-PRD014 real beforehook RED old packaging boundary versus verified frozen setup without builds', async t => {
  const f = await fixture(t);
  const preload = path.join(f.root, 'deny-build.mjs');
  const callsFile = path.join(f.root, 'boundary-calls.jsonl');
  const currentFile = path.join(f.root, 'current-distribution.test.mjs');
  const adapter = path.join(f.root, 'controlled-source-root.mjs');
  await fs.writeFile(adapter, `
    import * as fixture from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'scripts', 'frozen-distribution-fixture.mjs')).href)};
    export const buildDistributionFixture = fixture.buildDistributionFixture;
    export const prepareDistributionFixture = options =>
      fixture.prepareDistributionFixture({ ...options, sourceRoot: ${JSON.stringify(f.sourceRoot)} });
  `);
  const currentSource = await fs.readFile(path.join(ROOT, 'test', 'distribution-channels.test.mjs'), 'utf8');
  await fs.writeFile(currentFile, currentSource.replace(/from '(\.\.?\/[^']+)'/gu,
    (whole, relative) => `from '${pathToFileURL(relative.endsWith('/frozen-distribution-fixture.mjs') ?
      adapter : path.resolve(ROOT, 'test', relative)).href}'`));
  await fs.writeFile(preload, `
    import cp from 'node:child_process';
    import fs from 'node:fs';
    import { promisify } from 'node:util';
    import { syncBuiltinESMExports } from 'node:module';
    const original = cp.execFile;
    const originalAsync = promisify(original);
    const guard = (command, args) => {
      if (command === 'git') return;
      fs.appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify({ kind: 'forbidden-build',
        npmPack: args.includes('pack') && args.includes('--ignore-scripts') }) + '\\n');
      process.stderr.write('FORBIDDEN_SETUP_BUILD\\n');
      throw new Error('FORBIDDEN_SETUP_BUILD');
    };
    cp.execFile = function(command, args, ...rest) {
      guard(command, args);
      return original.call(this, command, args, ...rest);
    };
    cp.execFile[promisify.custom] = (command, args, ...rest) => {
      guard(command, args);
      return originalAsync(command, args, ...rest);
    };
    syncBuiltinESMExports();
  `);
  const run = async frozen => {
    const start = performance.now();
    const environment = { ...f.environment };
    for (const key of Object.keys(environment)) {
      if (key === 'NODE_TEST_CONTEXT' || key.startsWith('SDLC_TEST_REPORT_')) delete environment[key];
    }
    if (!frozen) {
      delete environment.SDLC_RELEASE_DIR;
      delete environment.SDLC_DISTRIBUTION_FIXTURE_CONTEXT;
    }
    try {
      const output = await execute(process.execPath, ['--import', pathToFileURL(preload).href, '--test',
        '--test-name-pattern', '^T-51 (ZIP and tar codecs|metadata finalization)', currentFile],
      { cwd: ROOT, env: environment, maxBuffer: 4 * 1024 * 1024 });
      return { exit: 0, ...output, elapsedMs: performance.now() - start };
    } catch (error) {
      return { exit: error.code, stdout: error.stdout, stderr: error.stderr, elapsedMs: performance.now() - start };
    }
  };
  const old = await run(false);
  assert.notEqual(old.exit, 0);
  assert.match(old.stdout + old.stderr, /FORBIDDEN_SETUP_BUILD/u);
  const beforeCalls = (await fs.readFile(callsFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(beforeCalls, [{ kind: 'forbidden-build', npmPack: true }]);
  const current = await run(true);
  assert.equal(current.exit, 0, current.stdout + current.stderr);
  assert.doesNotMatch(current.stdout + current.stderr, /FORBIDDEN_SETUP_BUILD/u);
  const allCalls = (await fs.readFile(callsFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(allCalls, beforeCalls);
  const evidence = { kind: 'controlled-fixture-only-no-native-speedup',
    before: { exit: old.exit, forbiddenBuildCalls: beforeCalls.length, elapsedMs: old.elapsedMs,
      stdoutSha256: sha256(old.stdout), stderrSha256: sha256(old.stderr) },
    after: { exit: current.exit, forbiddenBuildCalls: allCalls.length - beforeCalls.length, elapsedMs: current.elapsedMs,
      stdoutSha256: sha256(current.stdout), stderrSha256: sha256(current.stderr) } };
  if (process.env.SDLC_TEST_EVIDENCE_ROOT) {
    const output = path.resolve(process.env.SDLC_TEST_EVIDENCE_ROOT, `frozen-distribution-setup-pair-${randomUUID()}`);
    const relative = path.relative(ROOT, output);
    assert.equal(relative.split(path.sep)[0], '.test-data');
    assert.ok(!relative.split(path.sep).includes('..'));
    await fs.mkdir(output);
    for (const [name, result] of [['before', old], ['after', current]]) {
      await fs.writeFile(path.join(output, `${name}.stdout.log`), result.stdout, { flag: 'wx' });
      await fs.writeFile(path.join(output, `${name}.stderr.log`), result.stderr, { flag: 'wx' });
    }
    await fs.writeFile(path.join(output, 'comparison.json'), `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
  }
  t.diagnostic(JSON.stringify(evidence));
});

test('T-PRD014 current-source fixtures and beforehook work without historical Git objects', async t => {
  const root = path.join(ROOT, '.test-data', `ss-${randomUUID().slice(0, 16)}`);
  await fs.mkdir(root, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { sourceRoot, sourceGit } = await snapshotSource(root);
  const historical = 'fb631a1c80b2eadd0aa9dd694da2016244cee578';
  const revision = (await sourceGit(['rev-parse', 'HEAD'])).stdout.trim();
  assert.notEqual(revision, historical);
  assert.equal((await sourceGit(['rev-list', '--count', 'HEAD'])).stdout.trim(), '1');
  let objectAbsence;
  await assert.rejects(sourceGit(['cat-file', '-e', historical]), error => {
    objectAbsence = { command: ['git', 'cat-file', '-e', historical], exitCode: error.code,
      stdoutSha256: sha256(error.stdout), stderrSha256: sha256(error.stderr) };
    return [1, 128].includes(error.code);
  });
  await assert.rejects(fs.lstat(path.join(sourceRoot, '.git', 'objects', 'info', 'alternates')), { code: 'ENOENT' });
  const sourceFiles = [];
  for (const file of ['scripts/frozen-distribution-fixture.mjs', 'test/frozen-distribution-fixture.test.mjs']) {
    const bytes = await fs.readFile(path.join(sourceRoot, ...file.split('/')));
    assert.deepEqual(bytes, await fs.readFile(path.join(ROOT, ...file.split('/'))));
    sourceFiles.push({ path: file, sha256: sha256(bytes),
      gitBlobOid: (await sourceGit(['rev-parse', `HEAD:${file}`])).stdout.trim() });
  }
  const names = [
    'T-PRD014 frozen distribution setup reuses exact verified bytes without builders and rereads every use',
    'T-PRD014 real beforehook RED old packaging boundary versus verified frozen setup without builds',
  ];
  const pattern = `^(?:${names.map(name => name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|')})$`;
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key === 'NODE_TEST_CONTEXT' || key.startsWith('SDLC_TEST_REPORT_') ||
        key === 'SDLC_DISTRIBUTION_FIXTURE_CONTEXT') delete environment[key];
  }
  const evidenceRoot = path.join(sourceRoot, '.test-data', 'single-snapshot-evidence');
  await fs.mkdir(evidenceRoot, { recursive: true });
  await fs.mkdir(path.join(evidenceRoot, 'command'));
  const canary = path.join(root, 'private-canary');
  await fs.mkdir(canary);
  await fs.writeFile(path.join(canary, 'canary.txt'), 'Owned private canary; never fixture source.\n');
  const canaryRelative = '.sdlc/untracked-private-canary';
  const privateLink = path.join(sourceRoot, ...canaryRelative.split('/'));
  await fs.mkdir(path.dirname(privateLink), { recursive: true });
  await fs.symlink(canary, privateLink, process.platform === 'win32' ? 'junction' : 'dir');
  const visible = (await sourceGit(['ls-files', '--others', '--exclude-standard', '-z',
    '--', canaryRelative])).stdout.split('\0').filter(Boolean);
  assert.ok(visible.some(file => file === canaryRelative || file.startsWith(`${canaryRelative}/`)),
    'The controlled private canary must be visible to the unsafe untracked scan');
  assert.equal((await sourceGit(['ls-files', '--cached', '--', canaryRelative])).stdout, '');
  const accessLog = path.join(evidenceRoot, 'private-canary-access.log');
  const privacyGuard = path.join(evidenceRoot, 'deny-private-canary.mjs');
  await fs.writeFile(privacyGuard, `
    import fs from 'node:fs';
    import promises from 'node:fs/promises';
    import path from 'node:path';
    import { fileURLToPath } from 'node:url';
    import { syncBuiltinESMExports } from 'node:module';
    const normalize = value => {
      const resolved = path.resolve(value);
      return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    };
    const privateRoots = ${JSON.stringify([privateLink, canary])}.map(normalize);
    const record = fs.appendFileSync.bind(fs);
    const guard = (operation, args) => {
      for (const value of args) {
        const file = value instanceof URL ? fileURLToPath(value) :
          Buffer.isBuffer(value) ? value.toString() : typeof value === 'string' ? value : null;
        if (file === null) continue;
        const normalized = normalize(file);
        if (privateRoots.some(root => normalized === root || normalized.startsWith(root + path.sep))) {
          record(${JSON.stringify(accessLog)}, operation + '\\n');
          throw new Error('PRIVATE_CANARY_ACCESS: ' + operation);
        }
      }
    };
    for (const name of ['lstat', 'stat', 'realpath', 'readFile', 'readdir', 'opendir',
      'readlink', 'copyFile', 'open']) {
      const original = promises[name];
      promises[name] = function(...args) { guard(name, args); return original.apply(this, args); };
      const sync = fs[name + 'Sync'];
      if (sync) fs[name + 'Sync'] = function(...args) { guard(name, args); return sync.apply(this, args); };
    }
    const createReadStream = fs.createReadStream;
    fs.createReadStream = function(...args) { guard('createReadStream', args); return createReadStream.apply(this, args); };
    syncBuiltinESMExports();
  `);
  environment.NODE_OPTIONS = [environment.NODE_OPTIONS, `--import=${pathToFileURL(privacyGuard).href}`]
    .filter(Boolean).join(' ');
  const probe = path.join(evidenceRoot, 'unsafe-canary-probe.mjs');
  await fs.writeFile(probe, `
    import fs from 'node:fs/promises';
    for (const file of ${JSON.stringify(visible.map(file => path.join(sourceRoot, ...file.split('/'))))}) {
      await fs.lstat(file);
    }
  `);
  let unsafeProbe;
  await assert.rejects(execute(process.execPath, [probe], { cwd: sourceRoot, env: environment }),
    error => {
      unsafeProbe = { exitCode: error.code, stdoutSha256: sha256(error.stdout),
        stderrSha256: sha256(error.stderr) };
      return error.code !== 0 && /PRIVATE_CANARY_ACCESS: lstat/u.test(error.stderr);
    });
  assert.equal((await fs.readFile(accessLog, 'utf8')).trim(), 'lstat');
  await fs.rm(accessLog);
  environment.SDLC_TEST_REPORT_FILE = path.join(evidenceRoot, 'selected-two.json');
  const result = await executeValidationCommand({ name: 'single-snapshot-two', command: process.execPath,
    args: ['scripts/test-runner.mjs', 'targeted', '--workers', '1', '--name', pattern,
      'test/frozen-distribution-fixture.test.mjs'],
    cwd: sourceRoot, environment, outputDir: path.join(evidenceRoot, 'command'), signal: t.signal });
  assert.equal(result.complete, true, result.diagnostic);
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  const report = JSON.parse(await fs.readFile(environment.SDLC_TEST_REPORT_FILE, 'utf8'));
  assert.equal(report.complete, true);
  assert.equal(report.summary.counts.tests, 2);
  assert.equal(report.summary.counts.passed, 2);
  for (const key of ['failed', 'cancelled', 'skipped', 'todo']) assert.equal(report.summary.counts[key], 0);
  assert.deepEqual(report.executions.filter(row => names.includes(row.name))
    .map(row => [row.name, row.status]).sort(), names.map(name => [name, 'Passed']).sort());
  assert.equal(report.groupExecution.groups.length, 2);
  assert.ok(report.groupExecution.groups.every(group => group.status === 'Passed'));
  await assert.rejects(fs.lstat(accessLog), { code: 'ENOENT' });
  const proof = { sourceRevision: revision, historyCount: 1, historicalObjectAvailable: false,
    objectAbsence, alternates: false, sourceFiles, selected: names, counts: report.summary.counts,
    privacyCanary: { visibleToUntrackedScan: visible, cached: false, childFilesystemAccesses: 0,
      unsafeProbe, copiedOrRead: false, guardedOperations: ['lstat', 'stat', 'realpath', 'readFile', 'readdir',
        'opendir', 'readlink', 'copyFile', 'open', 'sync equivalents', 'createReadStream'] } };
  if (process.env.SDLC_TEST_EVIDENCE_ROOT) {
    const retained = path.resolve(process.env.SDLC_TEST_EVIDENCE_ROOT, `single-snapshot-proof-${randomUUID()}`);
    const relative = path.relative(ROOT, retained);
    assert.equal(relative.split(path.sep)[0], '.test-data');
    assert.ok(!relative.split(path.sep).includes('..'));
    await fs.cp(evidenceRoot, retained, { recursive: true, errorOnExist: true, force: false });
    await fs.writeFile(path.join(retained, 'proof.json'), `${JSON.stringify(proof, null, 2)}\n`, { flag: 'wx' });
  }
  t.diagnostic(JSON.stringify(proof));
});

test('T-PRD057 fixture-free release policy avoids builders while real consumers retain setup', async t => {
  const root = path.join(ROOT, '.test-data', `release-setup-${randomUUID()}`);
  await fs.mkdir(root, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const pure = 'T-PRD057 two archive targets retain four mandatory native execution platforms without Linux standalone support';
  const ordinary = 'release preparation cannot attribute candidate bytes to a different source commit';
  const realLauncher = 'T-PRD063 future Mac output leaves the separate Windows v1 PE and cross-platform npm bytes intact';
  const results = [];
  const run = async (name, names) => {
    const directory = path.join(root, name);
    await fs.mkdir(directory);
    const calls = path.join(directory, 'build-calls.jsonl');
    const preload = path.join(directory, 'deny-builds.mjs');
    await fs.writeFile(preload, `
      import cp from 'node:child_process';
      import fs from 'node:fs';
      import { promisify } from 'node:util';
      import { syncBuiltinESMExports } from 'node:module';
      const guard = (command, args = []) => {
        if (command === 'git') return;
        const argumentsList = Array.isArray(args) ? args : [];
        fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({
          npmPack: argumentsList.includes('pack') && argumentsList.includes('--ignore-scripts'),
        }) + '\\n');
        throw new Error('FORBIDDEN_RELEASE_SETUP_BUILD');
      };
      const originalFile = cp.execFile;
      const originalAsync = promisify(originalFile);
      cp.execFile = function(command, args, ...rest) {
        guard(command, args); return originalFile.call(this, command, args, ...rest);
      };
      cp.execFile[promisify.custom] = (command, args, ...rest) => {
        guard(command, args); return originalAsync(command, args, ...rest);
      };
      for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFileSync', 'fork']) {
        const original = cp[name];
        cp[name] = function(command, args, ...rest) {
          guard(command, args); return original.call(this, command, args, ...rest);
        };
      }
      syncBuiltinESMExports();
    `);
    const environment = { ...process.env };
    for (const key of Object.keys(environment)) {
      if (key === 'NODE_TEST_CONTEXT' || key.startsWith('SDLC_TEST_REPORT_') ||
          ['SDLC_DISTRIBUTION_FIXTURE_CONTEXT', 'SDLC_RELEASE_DIR', 'SDLC_RELEASE_SOURCE_COMMIT'].includes(key)) {
        delete environment[key];
      }
    }
    const pattern = `^(?:${names.map(name => name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|')})$`;
    const result = await executeValidationCommand({ name, command: process.execPath,
      args: ['--import', pathToFileURL(preload).href, '--test', '--test-reporter=tap',
        '--test-name-pattern', pattern, path.join(ROOT, 'test', 'release-ci.test.mjs')],
      cwd: ROOT, environment, outputDir: directory, signal: t.signal });
    assert.equal(result.complete, true, result.diagnostic);
    const count = key => Number(new RegExp(`^# ${key} (\\d+)$`, 'mu').exec(result.stdout)?.[1] ?? NaN);
    const buildCalls = await fs.readFile(calls, 'utf8').then(bytes =>
      bytes.trim().split('\n').map(line => JSON.parse(line)),
    error => { if (error.code === 'ENOENT') return []; throw error; });
    const observed = { name, exitCode: result.exitCode, tests: count('tests'),
      passed: count('pass'), failed: count('fail'), skipped: count('skipped'), buildCalls,
      stdoutSha256: sha256(result.stdout), stderrSha256: sha256(result.stderr) };
    results.push(observed);
    if (process.env.SDLC_TEST_EVIDENCE_ROOT) {
      const retained = path.resolve(process.env.SDLC_TEST_EVIDENCE_ROOT, `${path.basename(root)}-${name}`);
      const relative = path.relative(ROOT, retained);
      assert.equal(relative.split(path.sep)[0], '.test-data');
      assert.ok(!relative.split(path.sep).includes('..'));
      await fs.cp(directory, retained, { recursive: true, force: false, errorOnExist: true });
      await fs.writeFile(path.join(retained, 'observed.json'), `${JSON.stringify(observed, null, 2)}\n`, { flag: 'wx' });
    }
    return { result, observed };
  };
  const policy = await run('pure', [pure]);
  assert.equal(policy.result.exitCode, 0, policy.result.stdout + policy.result.stderr);
  assert.deepEqual([policy.observed.tests, policy.observed.passed, policy.observed.failed, policy.observed.skipped], [1, 1, 0, 0]);
  assert.deepEqual(policy.observed.buildCalls, []);
  const consumers = await run('consumers', [pure, ordinary, realLauncher]);
  assert.notEqual(consumers.result.exitCode, 0);
  assert.deepEqual([consumers.observed.tests, consumers.observed.passed, consumers.observed.failed,
    consumers.observed.skipped], [3, 1, 2, 0]);
  assert.deepEqual(consumers.observed.buildCalls, [{ npmPack: true }],
    'Real consumers still require the original build, initialized once per file lifetime');
  assert.match(consumers.result.stdout, /FORBIDDEN_RELEASE_SETUP_BUILD/u);
  t.diagnostic(JSON.stringify({ kind: 'controlled-setup-boundary-not-native-timing', results }));
});
