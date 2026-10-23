export const validationDeclarations = {
  "schemaVersion": 1,
  "surfaces": [
    {"coverage": "direct", "paths": ["scripts/synthetic-release-fixture.mjs"]}
  ],
  "applicability": [
    {
      "names": [
        "T-PRD057 portable synthetic recipe preserves all six original codec bytes and prepares once only for selected consumers",
        "T-PRD057 supplied portable setup rejects source recipe bytes layout links and missing inputs before consumer writes",
        "T-PRD057 portable consumers copy independently and never inspect an unregistered private canary",
        "T-PRD057 real release consumers retain fresh metadata and assertion-time builders with portable setup"
      ],
      "platforms": ["linux-x64", "windows-x64", "macos-arm64", "macos-x64"],
      "owner": "maintainer",
      "reason": "PR-only synthetic setup/source/byte/path/recipe isolation contracts using controlled Node codec inputs, not authentic npm/compiler/native equivalence. No critical promotion or provider access.",
      "prerequisites": ["Node >=22", "Git", "Owned checkout-local filesystem and directory links"]
    }
  ],
  "groups": [
    {"root": "T-PRD057 real release consumers retain fresh metadata and assertion-time builders with portable setup", "minimumSlots": 3}
  ]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import promises from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { syncBuiltinESMExports } from 'node:module';
import { canonical, readTarGzip, sha256, tarGzip, zip } from '../packaging/standalone/archive.mjs';
import { platformEntries } from '../packaging/standalone/protocol.mjs';
import { prepareSyntheticReleaseFixture, prepareSelectedSyntheticReleaseFixture,
  materializeSyntheticReleaseInputs, syntheticReleaseContextVariable, releaseFixturePureRoot } from '../scripts/synthetic-release-fixture.mjs';
import { filterFrozenFixtureTransport } from '../scripts/frozen-fixture-transport.mjs';
import { executeValidationCommand } from '../scripts/validation-tools.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const execute = promisify(execFile);
const forbidden = () => { throw new Error('PORTABLE_SETUP_BUILDER_MUST_NOT_RUN'); };

async function fixture(t) {
  const owner = path.join(ROOT, '.test-data', `sr-${randomUUID().slice(0, 8)}`);
  const sourceRoot = path.join(owner, 's');
  await fs.mkdir(sourceRoot, { recursive: true });
  t.after(() => fs.rm(owner, { recursive: true, force: true }));
  const environment = { ...process.env };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) delete environment[key];
  Object.assign(environment, { GIT_AUTHOR_NAME: 'Owned synthetic fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Owned synthetic fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' });
  const hooks = path.join(owner, 'h');
  await fs.mkdir(hooks);
  const git = (args, input) => {
    const result = execute('git', ['-c', `core.hooksPath=${hooks}`, ...args],
      { cwd: sourceRoot, env: environment, maxBuffer: 8 * 1024 * 1024 });
    if (input !== undefined) result.child.stdin.end(input);
    return result;
  };
  await git(['init', '--quiet']);
  const sources = {
    LICENSE: 'Controlled fixture license\n',
    'package.json': JSON.stringify({ name: 'ai-sdlc-framework', version: '0.4.0', engines: { node: '>=22' } }),
    'bin/sdlc.mjs': '// Controlled payload data, never executed.\n',
    'src/install.mjs': '// Controlled installer data, never executed.\n',
    'packaging/standalone/runtime.mjs': '// Controlled runtime data, never executed.\n',
    'packaging/standalone/install.sh': '#!/bin/sh\n',
    'packaging/standalone/install.ps1': '# Controlled fixture\n',
    'packaging/standalone/sdlc': '#!/bin/sh\n',
  };
  const files = Object.keys(sources).sort();
  for (const file of files) {
    const selected = path.join(sourceRoot, ...file.split('/'));
    await fs.mkdir(path.dirname(selected), { recursive: true });
    await fs.writeFile(selected, sources[file]);
    await fs.chmod(selected, file === 'bin/sdlc.mjs' ? 0o755 : 0o644);
  }
  const hashes = (await git(['hash-object', '-w', '--no-filters', '--stdin-paths'],
    files.map(file => JSON.stringify(file)).join('\n') + '\n')).stdout.trim().split('\n');
  await git(['update-index', '-z', '--index-info'], files.map((file, index) =>
    `${file === 'bin/sdlc.mjs' ? '100755' : '100644'} ${hashes[index]}\t${file}\0`).join(''));
  const tree = (await git(['write-tree'])).stdout.trim();
  const revision = (await git(['commit-tree', tree, '-m', `Owned synthetic source ${randomUUID()}`])).stdout.trim();
  await git(['update-ref', 'HEAD', revision]);
  const data = path.join(sourceRoot, '.test-data');
  await fs.mkdir(data);
  const entries = files.map(file => ({ path: `package/${file}`, data: Buffer.from(sources[file]),
    mode: file === 'bin/sdlc.mjs' ? 0o755 : 0o644 }));
  const payload = tarGzip(entries);
  const calls = [];
  const packageBuilder = async options => {
    calls.push({ kind: 'package', options });
    await fs.mkdir(options.outputDir, { recursive: true });
    const artifact = path.join(options.outputDir, 'ai-sdlc-framework-0.4.0.tgz');
    await fs.writeFile(artifact, payload);
    return { artifact };
  };
  const platformBuilder = async options => {
    calls.push({ kind: 'platform', options });
    assert.equal(options.sourceCommit, 'a'.repeat(40));
    assert.deepEqual(options.targets, ['macos', 'windows-x64']);
    await fs.mkdir(options.outputDir);
    const input = await fs.readFile(options.artifact);
    const launcher = await fs.readFile(options.windowsLauncher);
    const archives = [];
    for (const target of options.targets) {
      const encode = target === 'windows-x64' ? zip : tarGzip;
      const filename = `ai-sdlc-framework-0.4.0-${target}.${target === 'windows-x64' ? 'zip' : 'tar.gz'}`;
      const artifact = path.join(options.outputDir, filename);
      await fs.writeFile(artifact, encode(platformEntries(input, target, launcher).entries));
      archives.push({ target, artifact, filename });
    }
    return { archives };
  };
  const options = { sourceRoot, environment, packageBuilder, platformBuilder,
    directory: path.join(data, 'portable') };
  const context = await prepareSyntheticReleaseFixture(options);
  const supplied = { ...environment, [syntheticReleaseContextVariable]: JSON.stringify(context) };
  const consumer = async name => {
    const root = path.join(data, name);
    await fs.mkdir(root);
    return { root, sourceRoot, environment: supplied, packageBuilder: forbidden, platformBuilder: forbidden };
  };
  return { owner, sourceRoot, data, entries, payload, context, supplied, calls, git, sources,
    options, consumer, environment };
}

test('T-PRD057 portable synthetic recipe preserves all six original codec bytes and prepares once only for selected consumers', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.calls.map(call => call.kind), ['package', 'platform']);
  const pe = Buffer.alloc(256);
  pe.write('MZ'); pe.writeUInt32LE(128, 60); pe.writeUInt32LE(0x4550, 128);
  pe.writeUInt16LE(0x8664, 132); pe.writeUInt16LE(0x20b, 152);
  const previous = tarGzip(readTarGzip(f.payload).map(entry => entry.path === 'package/package.json' ?
    { ...entry, data: Buffer.from(JSON.stringify({ ...JSON.parse(entry.data), version: '0.3.0' })) } : entry));
  for (const generation of ['current', 'previous']) {
    const payload = generation === 'current' ? f.payload : previous;
    for (const target of ['payload', 'macos', 'windows-x64']) {
      const spec = f.context.files.find(file => file.role === `${generation}-${target}`);
      const expected = target === 'payload' ? payload :
        (target === 'windows-x64' ? zip : tarGzip)(platformEntries(payload, target, pe).entries);
      const location = path.join(f.context.directory, ...spec.relative.split('/'));
      assert.deepEqual(await fs.readFile(location), expected);
      if (process.platform !== 'win32') assert.equal((await fs.stat(location)).mode & 0o777, 0o644);
    }
  }
  const release = name => ({ file: 'test/release-ci.test.mjs', name, parents: [],
    applicability: { platforms: ['linux-x64'] } });
  for (const stages of [[{ name: 'unit', cases: [release('consumer')] }],
    [{ name: 'regression', cases: [release(releaseFixturePureRoot)] }],
    [{ name: 'regression', cases: [{ ...release('refresh'), file: 'test/refresh.test.mjs' }] }]]) {
    assert.equal(await prepareSelectedSyntheticReleaseFixture({ ...f.options, stages, target: 'linux-x64',
      packageBuilder: forbidden, platformBuilder: forbidden }), null);
  }
  const selected = await prepareSelectedSyntheticReleaseFixture({ ...f.options,
    directory: path.join(f.data, 'selected'), stages: [{ name: 'regression',
      cases: [release('consumer one'), release('consumer two')] }], target: 'linux-x64' });
  assert.equal(selected.files.length, 6);
  assert.deepEqual(f.calls.map(call => call.kind), ['package', 'platform', 'package', 'platform']);
  assert.notEqual(selected.sourceOrigin.revision, 'a'.repeat(40));
  assert.equal(selected.configuration.currentRevision, 'a'.repeat(40));
  assert.equal(selected.configuration.previousRevision, 'b'.repeat(40));
  await assert.rejects(prepareSyntheticReleaseFixture({ ...f.options, directory: path.join(f.data, 'wrong-source'),
    expectedSourceCommit: 'a'.repeat(40) }), /selected native source/u);
  await assert.rejects(fs.lstat(path.join(f.data, 'wrong-source')), { code: 'ENOENT' });
});

test('T-PRD057 supplied portable setup rejects source recipe bytes layout links and missing inputs before consumer writes', async t => {
  const f = await fixture(t);
  const options = await f.consumer('rejected');
  const variants = [
    {}, { ...f.context, sourceOrigin: { ...f.context.sourceOrigin, revision: 'a'.repeat(40) } },
    { ...f.context, kind: 'published-candidate' },
    { ...f.context, configuration: { ...f.context.configuration, previousVersion: '9.9.9' } },
    { ...f.context, configuration: { ...f.context.configuration, launcherSha256: 'a'.repeat(64) } },
    { ...f.context, files: f.context.files.slice(1) },
    { ...f.context, files: [...f.context.files.slice(0, 5), f.context.files[0]] },
    { ...f.context, files: f.context.files.map((file, index) => index === 0 ?
      { ...file, relative: '../private/canary.txt' } : file) },
    { ...f.context, directory: f.owner },
  ];
  for (const context of variants) {
    await assert.rejects(materializeSyntheticReleaseInputs({ ...options,
      environment: { ...f.environment, [syntheticReleaseContextVariable]: JSON.stringify(context) } }));
    assert.deepEqual(await fs.readdir(options.root), []);
  }
  const link = path.join(f.data, 'linked');
  await fs.symlink(f.context.directory, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(materializeSyntheticReleaseInputs({ ...options, environment: { ...f.supplied,
    [syntheticReleaseContextVariable]: JSON.stringify({ ...f.context, directory: link }) } }), /linked/u);
  const file = path.join(f.context.directory, ...f.context.files[0].relative.split('/'));
  const original = await fs.readFile(file);
  await fs.appendFile(file, 'changed');
  await assert.rejects(materializeSyntheticReleaseInputs(options), /bytes changed/u);
  await fs.writeFile(file, original);
  await fs.unlink(file);
  await assert.rejects(materializeSyntheticReleaseInputs(options), /layout|ENOENT/u);
  await fs.writeFile(file, original, { mode: 0o644 });
  const priorRecord = f.context.files.find(file => file.role === 'previous-payload');
  const priorPath = path.join(f.context.directory, ...priorRecord.relative.split('/'));
  const priorBytes = await fs.readFile(priorPath);
  const foreign = tarGzip(readTarGzip(priorBytes).map(entry => entry.path === 'package/LICENSE' ?
    { ...entry, data: Buffer.from('Foreign previous payload\n') } : entry));
  await fs.writeFile(priorPath, foreign);
  const resealed = { ...f.context, files: f.context.files.map(file => file.role === 'previous-payload' ?
    { ...file, sha256: sha256(foreign), size: foreign.length } : file) };
  await assert.rejects(materializeSyntheticReleaseInputs({ ...options, environment: { ...f.supplied,
    [syntheticReleaseContextVariable]: JSON.stringify(resealed) } }), /payload recipe differs/u);
  await fs.writeFile(priorPath, priorBytes);
  await assert.rejects(materializeSyntheticReleaseInputs({ ...options, root: f.owner }), /escapes/u);
  const source = path.join(f.sourceRoot, 'LICENSE');
  await fs.appendFile(source, 'same-head edit');
  await assert.rejects(materializeSyntheticReleaseInputs(options), /committed bytes/u);
  await fs.writeFile(source, f.sources.LICENSE);
  await f.git(['update-index', '--chmod=+x', 'LICENSE']);
  await assert.rejects(materializeSyntheticReleaseInputs(options), /index differs/u);
  await f.git(['update-index', '--chmod=-x', 'LICENSE']);
  assert.deepEqual(await fs.readdir(options.root), []);
  assert.equal(f.calls.length, 2);
});

test('T-PRD057 portable consumers copy independently and never inspect an unregistered private canary', async t => {
  const f = await fixture(t);
  const privateDirectory = path.join(f.owner, 'private');
  await fs.mkdir(privateDirectory);
  await fs.writeFile(path.join(privateDirectory, 'canary.txt'), 'Private controlled canary\n');
  const link = path.join(f.sourceRoot, '.sdlc', 'untracked-canary');
  await fs.mkdir(path.dirname(link));
  await fs.symlink(privateDirectory, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.ok((await f.git(['ls-files', '--others', '--exclude-standard', '--', '.sdlc/untracked-canary'])).stdout);
  const saved = new Map();
  let accesses = 0;
  for (const name of ['readFile', 'lstat', 'stat', 'realpath', 'readdir', 'copyFile', 'open']) {
    const original = promises[name];
    saved.set(name, original);
    promises[name] = function(...args) {
      if (args.some(arg => typeof arg === 'string' && [link, privateDirectory].some(root =>
        arg === root || arg.startsWith(root + path.sep)))) {
        accesses++;
        throw new Error('PRIVATE_CANARY_ACCESS');
      }
      return original.apply(this, args);
    };
  }
  syncBuiltinESMExports();
  let first;
  let second;
  try {
    first = await materializeSyntheticReleaseInputs(await f.consumer('first'));
    second = await materializeSyntheticReleaseInputs(await f.consumer('second'));
  } finally {
    for (const [name, original] of saved) promises[name] = original;
    syncBuiltinESMExports();
  }
  assert.equal(accesses, 0);
  assert.notEqual(first.payload.artifact, second.payload.artifact);
  await fs.appendFile(first.payload.artifact, 'private edit');
  assert.deepEqual(await fs.readFile(second.payload.artifact), f.payload);
  assert.deepEqual(await fs.readFile(path.join(f.context.directory, ...f.context.files[0].relative.split('/'))), f.payload);
  assert.equal(f.calls.length, 2);
  const file = path.join(ROOT, 'test', 'release-ci.test.mjs');
  assert.equal(filterFrozenFixtureTransport(f.supplied, file)[syntheticReleaseContextVariable], f.supplied[syntheticReleaseContextVariable]);
  for (const sibling of ['unit.test.mjs', 'foreign/release-ci.test.mjs', 'synthetic-release-fixture.test.mjs']) {
    assert.equal(filterFrozenFixtureTransport(f.supplied, path.join(ROOT, 'test', sibling))[syntheticReleaseContextVariable], undefined);
  }
});

test('T-PRD057 real release consumers retain fresh metadata and assertion-time builders with portable setup', async t => {
  const f = await fixture(t);
  const retainedPrefix = `synthetic-${randomUUID()}`;
  const adapter = path.join(f.owner, 'adapter.mjs');
  await fs.writeFile(adapter, `
    import * as fixture from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'scripts', 'synthetic-release-fixture.mjs')).href)};
    export * from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'scripts', 'synthetic-release-fixture.mjs')).href)};
    export const materializeSyntheticReleaseInputs = options =>
      fixture.materializeSyntheticReleaseInputs({ ...options, sourceRoot: ${JSON.stringify(f.sourceRoot)} });
  `);
  const file = path.join(f.owner, 'release.test.mjs');
  const source = await fs.readFile(path.join(ROOT, 'test', 'release-ci.test.mjs'), 'utf8');
  await fs.writeFile(file, source.replace(/from '(\.\.?\/[^']+)'/gu, (whole, relative) =>
    `from '${pathToFileURL(relative.endsWith('/synthetic-release-fixture.mjs') ?
      adapter : path.resolve(ROOT, 'test', relative)).href}'`)
    .replace('import.meta.url', JSON.stringify(pathToFileURL(path.join(ROOT, 'test', 'release-ci.test.mjs')).href)));
  const run = async (name, selector, supplied) => {
    const outputDir = path.join(f.data, name);
    await fs.mkdir(outputDir);
    const log = path.join(outputDir, 'calls.jsonl');
    const preload = path.join(outputDir, 'guard.mjs');
    await fs.writeFile(preload, `
      import cp from 'node:child_process';
      import fs from 'node:fs';
      import promises from 'node:fs/promises';
      import path from 'node:path';
      import { promisify } from 'node:util';
      import { syncBuiltinESMExports } from 'node:module';
      const original = cp.execFile;
      const originalAsync = promisify(original);
      const guard = (command, args = []) => {
        if (command === 'git') return;
        fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ command: path.basename(command),
          npmPack: Array.isArray(args) && args.includes('pack') }) + '\\n');
        throw new Error('ASSERTION_BUILDER_DENIED');
      };
      cp.execFile = function(command, args, ...rest) { guard(command, args); return original.call(this, command, args, ...rest); };
      cp.execFile[promisify.custom] = (command, args, ...rest) => { guard(command, args); return originalAsync(command, args, ...rest); };
      const sync = cp.execFileSync;
      cp.execFileSync = function(command, args, ...rest) { guard(command, args); return sync.call(this, command, args, ...rest); };
      for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'fork']) {
        const original = cp[name];
        cp[name] = function(command, args, ...rest) {
          guard(command, args); return original.call(this, command, args, ...rest);
        };
      }
      const write = promises.writeFile;
      promises.writeFile = function(file, data, ...args) {
        if (typeof file === 'string' && (/^release-descriptor\\.json(?:\\..+\\.pending)?$/.test(path.basename(file)) ||
            path.basename(file) === 'context.json')) {
          const value = JSON.parse(data.toString());
          fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ metadata: path.basename(file).startsWith('release-descriptor.json') ?
            'release-descriptor.json' : 'context.json',
            revision: value.sourceCommit ?? value.identity?.sourceCommit }) + '\\n');
        }
        return write.call(this, file, data, ...args);
      };
      syncBuiltinESMExports();
    `);
    const environment = { ...f.supplied };
    for (const key of Object.keys(environment)) {
      if (key === 'NODE_TEST_CONTEXT' || key.startsWith('SDLC_TEST_REPORT_') || key.startsWith('SDLC_WINDOWS_LAUNCHER')) delete environment[key];
    }
    if (!supplied) delete environment[syntheticReleaseContextVariable];
    const result = await executeValidationCommand({ name, command: process.execPath,
      args: ['--import', pathToFileURL(preload).href, '--test', '--test-reporter=tap', '--test-name-pattern', selector, file],
      cwd: f.sourceRoot, environment, outputDir, signal: t.signal });
    assert.equal(result.complete, true, result.diagnostic);
    assert.equal(Number(/^# tests (\d+)$/mu.exec(result.stdout)?.[1]), 1, result.stdout);
    assert.equal(Number(/^# skipped (\d+)$/mu.exec(result.stdout)?.[1]), 0, result.stdout);
    const calls = await fs.readFile(log, 'utf8').then(text => text.trim().split('\n').map(line => JSON.parse(line)),
      error => { if (error.code === 'ENOENT') return []; throw error; });
    if (process.env.SDLC_TEST_EVIDENCE_ROOT) {
      const destination = path.resolve(process.env.SDLC_TEST_EVIDENCE_ROOT, `${retainedPrefix}-${name}`);
      assert.equal(path.relative(ROOT, destination).split(path.sep)[0], '.test-data');
      await fs.cp(outputDir, destination, { recursive: true, force: false, errorOnExist: true });
    }
    return { result, calls };
  };
  const pure = await run('pure', '^T-PRD057 two archive targets', true);
  assert.equal(pure.result.exitCode, 0, pure.result.stdout);
  assert.deepEqual(pure.calls, []);
  const consumer = await run('consumer', '^release preparation cannot attribute', true);
  assert.equal(consumer.result.exitCode, 0, consumer.result.stdout + consumer.result.stderr);
  assert.equal(consumer.calls.filter(call => call.metadata === 'release-descriptor.json').length, 4);
  assert.deepEqual(consumer.calls.filter(call => call.metadata === 'release-descriptor.json')
    .map(call => call.revision), ['a'.repeat(40), 'a'.repeat(40), 'b'.repeat(40), 'b'.repeat(40)]);
  const absent = await run('absent', '^release preparation cannot attribute', false);
  assert.notEqual(absent.result.exitCode, 0);
  assert.ok(absent.calls.some(call => call.npmPack));
  const realBuilder = await run('real-builder', '^T-PRD063 future Mac output', true);
  assert.notEqual(realBuilder.result.exitCode, 0);
  assert.ok(realBuilder.calls.some(call => /^(?:go|go\.exe)$/iu.test(call.command ?? '')));
  assert.equal(f.calls.length, 2);
  t.diagnostic(JSON.stringify({ kind: 'controlled-codec-only-no-native-or-package-equivalence',
    producerBuilds: f.calls.map(call => call.kind), freshDescriptors: 4,
    pureExit: pure.result.exitCode, consumerExit: consumer.result.exitCode,
    absentExit: absent.result.exitCode, realBuilderExit: realBuilder.result.exitCode }));
});
