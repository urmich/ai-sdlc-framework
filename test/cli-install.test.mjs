export const validationDeclarations = {
  "schemaVersion": 1,
  "applicability": [
    {"names": ["T-42 uninstall preflight preserves missing modified and redirected owned entries"], "platforms": ["linux-x64", "windows-x64", "macos-arm64", "macos-x64"], "owner": "maintainer", "reason": "Native redirected-content preservation requires owned file symlinks; unavailable Windows symlink privilege remains explicit NotRun, not success.", "prerequisites": ["Node and Git", "Native file-symlink creation"]}
  ],
  "surfaces": [{"coverage": "process", "paths": ["bin/sdlc.mjs", "src/cli.mjs", "src/install.mjs", "src/hooks.mjs", "src/checks.mjs"]}],
  "plannedCases": [
    {"id": "T-23", "selectors": [
      {"name": "T-23 controlled obsolete symlink update preserves the literal entry and unowned target before any writes", "parents": []},
      {"name": "T-23 native obsolete symlink update preserves the literal entry and unowned target before any writes", "parents": []},
      {"name": "T-23 ordinary uninstall rejects unsupported ownership schemas without partial removal", "parents": []},
      {"name": "T-23 ordinary uninstall rejects malformed ownership records before removing any content", "parents": []},
      {"name": "T-23 update rejects malformed ownership records before replacement writes", "parents": []},
      {"name": "T-23 canonical ownership file keys reject aliases before update or uninstall mutations", "parents": []},
      {"name": "T-23 uninstall rejects a last serialized root alias before any owned file removal", "parents": []},
      {"name": "T-23 uninstall preflights non-file and unreadable entries before deleting owned assets", "parents": []}
    ]},
    {"id": "T-42", "selectors": [
      {"name": "T-42 ordinary uninstall accepts schema-one ownership with compatible version labels", "parents": []},
      {"name": "T-42 partial uninstall preserves valid empty inventories and accepts omitted legacy optional fields", "parents": []},
      {"name": "T-42 uninstall preflight preserves missing modified and redirected owned entries", "parents": []}
    ]}
  ],
  "groups": [
    {"root": "T-23 controlled obsolete symlink update preserves the literal entry and unowned target before any writes", "dependsOn": [], "minimumSlots": 1, "exclusiveResources": []},
    {"root": "T-23 native obsolete symlink update preserves the literal entry and unowned target before any writes", "dependsOn": [], "minimumSlots": 1, "exclusiveResources": []},
    {"root": "T-23 ordinary uninstall rejects unsupported ownership schemas without partial removal", "dependsOn": [], "minimumSlots": 1, "exclusiveResources": []},
    {"root": "T-42 ordinary uninstall accepts schema-one ownership with compatible version labels", "dependsOn": [], "minimumSlots": 1, "exclusiveResources": []},
    {"root": "T-23 ordinary uninstall rejects malformed ownership records before removing any content", "dependsOn": [], "minimumSlots": 1, "exclusiveResources": []},
    {"root": "T-23 update rejects malformed ownership records before replacement writes", "dependsOn": [], "minimumSlots": 1, "exclusiveResources": []},
    {"root": "T-42 partial uninstall preserves valid empty inventories and accepts omitted legacy optional fields", "dependsOn": [], "minimumSlots": 1, "exclusiveResources": []},
    {"root": "T-23 canonical ownership file keys reject aliases before update or uninstall mutations", "dependsOn": [], "minimumSlots": 1, "exclusiveResources": []},
    {"root": "T-23 uninstall rejects a last serialized root alias before any owned file removal", "dependsOn": [], "minimumSlots": 1, "exclusiveResources": []},
    {"root": "T-23 uninstall preflights non-file and unreadable entries before deleting owned assets", "dependsOn": [], "minimumSlots": 1, "exclusiveResources": []},
    {"root": "T-42 uninstall preflight preserves missing modified and redirected owned entries", "dependsOn": [], "minimumSlots": 1, "exclusiveResources": []}
  ]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { fixture, artifact, coding, cli, grant, orient } from './helpers.mjs';
import { cleanInstall, install, uninstall, doctor, distribution, BLOCK_START, canonicalInstalledText } from '../src/install.mjs';
import { registerArtifact } from '../src/artifacts.mjs';
import { aggregate, check } from '../src/checks.mjs';
import { readJson, writeJson } from '../src/files.mjs';
import { digest, LIMITS, safeRecord } from '../src/core.mjs';
import { evaluateGate as gate } from '../src/gate.mjs';
const execute = promisify(execFile);
const packageVersion = JSON.parse(await fs.readFile(
  new URL('../package.json', import.meta.url), 'utf8')).version;

test('T-38 installed framework text uses canonical LF without changing source', () => {
  const source = Buffer.from('first\r\nsecond\rthird\n');
  assert.equal(canonicalInstalledText(source).toString('utf8'), 'first\nsecond\nthird\n');
  assert.equal(source.toString('utf8'), 'first\r\nsecond\rthird\n');
});

test('T-23 installation read batches drain failures before writes and stop further dispatch', async t => {
  for (const phase of ['source', 'destination']) {
    const f = await fixture(t);
    const prepared = await distribution(f.home);
    const targets = new Set([...prepared.files.keys()].map(relative =>
      path.join(f.home, relative)));
    const source = path.resolve('src') + path.sep;
    const method = phase === 'source' ? 'open' : 'lstat';
    const original = fsPromises[method];
    const started = [];
    const seen = new Set();
    const releases = [];
    const batchStarted = Promise.withResolvers();
    const firstFailed = Promise.withResolvers();
    const releaseAll = Promise.withResolvers();
    const failure = new Error(`Controlled ${phase} read failure`);
    let active = 0;
    let peak = 0;
    let settled = false;
    let mutations = 0;
    const mocked = t.mock.method(fsPromises, method, async (file, ...options) => {
      const selected = typeof file === 'string' && (phase === 'source' ?
        file.startsWith(source) : targets.has(file));
      if (!selected || seen.has(file)) return original(file, ...options);
      seen.add(file);
      const index = started.length;
      const release = Promise.withResolvers();
      releases.push(release);
      started.push(file);
      active++;
      peak = Math.max(peak, active);
      if (started.length === 16) batchStarted.resolve();
      try {
        await Promise.race([release.promise, releaseAll.promise]);
        if (index === 0) {
          firstFailed.resolve();
          throw failure;
        }
        return await original(file, ...options);
      } finally {
        active--;
      }
    });
    syncBuiltinESMExports();
    const work = install(f.store, { fault: async () => { mutations++; } })
      .then(value => { settled = true; return { value }; },
        error => { settled = true; return { error }; });
    let timer;
    try {
      await Promise.race([batchStarted.promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`The ${phase} read batch did not fill`)), 10000);
      })]);
      clearTimeout(timer);
      assert.equal(active, 16);
      releases[0].resolve();
      await firstFailed.promise;
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(settled, false, 'The remaining dispatched reads must drain');
      assert.equal(mutations, 0);
      for (const release of releases.slice(1)) release.resolve();
      const result = await work;
      assert.equal(result.error, failure);
      assert.equal(active, 0);
      assert.equal(peak, 16);
      assert.equal(started.length, 16, 'No later batch may start after a read failure');
      assert.equal(mutations, 0);
    } finally {
      clearTimeout(timer);
      releaseAll.resolve();
      await work;
      mocked.mock.restore();
      syncBuiltinESMExports();
    }
    await assert.rejects(fs.lstat(path.join(f.home, 'sdlc/bin/sdlc.mjs')), { code: 'ENOENT' });
    await assert.rejects(fs.lstat(path.join(f.home, 'sdlc/install-manifest.json')), { code: 'ENOENT' });
  }
});

test('T-23 install/update/uninstall preserve user files, paths with spaces, modified assets and runtime', async t => {
  const f = await fixture(t);
  const instructions = path.join(f.home, 'copilot-instructions.md');
  await fs.writeFile(instructions, 'Personal instructions stay here.\n');
  const first = await install(f.store);
  assert.equal(first.installed, true);
  assert.equal((await install(f.store)).changedFiles.length, 0);
  const hooks = await readJson(path.join(f.home, 'hooks/sdlc.json'));
  assert.equal(hooks.hooks.preToolUse[0].args[0], path.join(f.home, 'sdlc/bin/sdlc.mjs'));
  assert.deepEqual(hooks.hooks.preToolUse[0].args.slice(-2), ['--home', f.home]);
  for (const name of ['knowledge-retrieval', 'coding', 'testing', 'building', 'reviewing']) {
    assert.ok(await fs.stat(path.join(f.home, `sdlc/instructions/${name}.md`)));
  }
  assert.ok(await fs.stat(path.join(f.home, 'sdlc/provider-adapters.md')));
  const lifecycleIntent = path.join(f.home, 'sdlc/lifecycle-intent.md');
  assert.ok(await fs.stat(lifecycleIntent));
  const installedGlobal = await fs.readFile(instructions, 'utf8');
  assert.match(installedGlobal,
    /After session resume or compaction[\s\S]*An accepted token[\s\S]*does not prove reading/u);
  const installedCodingSkill = await fs.readFile(
    path.join(f.home, 'skills/sdlc-coding/SKILL.md'), 'utf8');
  for (const name of ['knowledge-retrieval', 'coding', 'testing', 'building', 'reviewing']) {
    const installedPath = path.join(f.home, `sdlc/instructions/${name}.md`);
    assert.ok(installedGlobal.includes(JSON.stringify(installedPath)));
    assert.ok(installedCodingSkill.includes(JSON.stringify(installedPath)));
    assert.deepEqual(await fs.readFile(installedPath), canonicalInstalledText(
      await fs.readFile(path.join('assets', 'instructions', `${name}.md`))),
    'Installed focused guidance must preserve the current source instructions');
  }
  assert.ok(installedGlobal.includes(JSON.stringify(lifecycleIntent)));
  for (const skill of ['sdlc', 'sdlc-requirements', 'sdlc-test-design',
    'sdlc-technical-design', 'sdlc-coding']) {
    assert.ok((await fs.readFile(path.join(f.home, 'skills', skill,
      'SKILL.md'), 'utf8')).includes(JSON.stringify(lifecycleIntent)));
  }
  const installedGuidance = [
    installedGlobal,
    ...(await Promise.all(['sdlc', 'sdlc-requirements', 'sdlc-test-design',
      'sdlc-technical-design', 'sdlc-coding'].map(skill =>
      fs.readFile(path.join(f.home, 'skills', skill, 'SKILL.md'), 'utf8')))),
    await fs.readFile(path.join(f.home, 'sdlc/templates/test-plan.md'), 'utf8'),
    await fs.readFile(path.join(f.home, 'sdlc/cli.md'), 'utf8'),
  ].join('\n');
  for (const obsolete of [
    'STAGING testing is user-owned on an authorized machine',
    'Hand STAGING testing to the user on an authorized machine',
    'STAGING testing belongs to the user on an authorized machine',
  ]) {
    assert.ok(!installedGuidance.includes(obsolete), obsolete);
  }
  assert.doesNotMatch(`${installedGlobal}\n${installedCodingSkill}`,
    /\{\{[A-Z_]+\}\}/u);
  const result = await execute(process.execPath, [path.join(f.home, 'sdlc/bin/sdlc.mjs'), 'doctor'], { env: { ...process.env, COPILOT_HOME: f.home } });
  assert.equal(JSON.parse(result.stdout).installed, true);
  assert.equal((await doctor(f.store)).findings.length, 0);
  const installedInstructions = await fs.readFile(instructions);
  await fs.unlink(instructions);
  const missingInstructions = await doctor(f.store);
  assert.equal(missingInstructions.installed, true);
  assert.ok(missingInstructions.findings.some(finding =>
    finding.includes('instruction block')));
  await fs.writeFile(instructions, installedInstructions);
  const manifestFile = path.join(f.home, 'sdlc/install-manifest.json');
  const manifest = await readJson(manifestFile);
  await fs.unlink(manifestFile);
  const missingManifest = await execute(process.execPath,
    [path.join(f.home, 'sdlc/bin/sdlc.mjs'), 'doctor', '--home', f.home]);
  assert.equal(JSON.parse(missingManifest.stdout).installed, false);
  assert.equal(JSON.parse(missingManifest.stdout).frameworkVersion, packageVersion);
  await writeJson(manifestFile, manifest);
  await fs.appendFile(path.join(f.home, 'skills/sdlc/SKILL.md'), '\nUser customization.\n');
  await assert.rejects(install(f.store), { code: 'INSTALL_CONFLICT' });
  const removed = await uninstall(f.store);
  assert.ok(removed.preserved.includes('skills/sdlc/SKILL.md'));
  assert.match(await fs.readFile(instructions, 'utf8'), /Personal instructions stay here/u);
  assert.ok(!(await fs.readFile(instructions, 'utf8')).includes(BLOCK_START));
  assert.ok(await fs.stat(path.join(f.home, 'sdlc/runtime/work-items/wi-test/checkpoint.json')));
  assert.match(await fs.readFile(path.join(f.home, 'skills/sdlc/SKILL.md'), 'utf8'), /User customization/u);
});
test('T-23 partial installation rolls back only its own unchanged writes', async t => {
  const f = await fixture(t, { initialize: false });
  const instructions = path.join(f.home, 'copilot-instructions.md');
  await fs.writeFile(instructions, 'Keep user instructions');
  await assert.rejects(install(f.store, { fault: async relative => {
    if (relative === 'sdlc/bin/sdlc.mjs') {
      await fs.appendFile(path.join(f.home, relative), '\n// concurrent user edit\n');
      throw new Error('injected installation failure');
    }
  } }), { code: 'INSTALL_FAILED' });
  assert.equal(await fs.readFile(instructions, 'utf8'), 'Keep user instructions');
  assert.match(await fs.readFile(path.join(f.home, 'sdlc/bin/sdlc.mjs'), 'utf8'), /concurrent user edit/u);
});

async function obsoleteSymlinkUpdate(t, controlled) {
  const f = await fixture(t, { initialize: false });
  const instructions = path.join(f.home, 'copilot-instructions.md');
  await fs.writeFile(instructions, 'Keep personal instructions.\n');
  await install(f.store);
  const manifestFile = path.join(f.home, 'sdlc/install-manifest.json');
  const manifest = await readJson(manifestFile);
  const obsolete = path.join(f.home, 'sdlc/obsolete-owned.txt');
  const unowned = path.join(f.home, 'unowned-target.txt');
  const bytes = Buffer.from('Former owned content, now unowned.\n');
  await fs.writeFile(unowned, bytes);
  const restores = [];
  try {
    if (controlled) {
      // Exercise the real updater with controlled filesystem link observations,
      // independently of the host's privilege to create native file symlinks.
      await fs.writeFile(obsolete, bytes);
      const originalLstat = fsPromises.lstat;
      const originalRealpath = fsPromises.realpath;
      const originalReadlink = fsPromises.readlink;
      restores.push(t.mock.method(fsPromises, 'lstat', async (file, ...options) => {
        const stat = await originalLstat(file, ...options);
        if (file === obsolete) {
          stat.isSymbolicLink = () => true;
          stat.isFile = () => false;
        }
        return stat;
      }));
      restores.push(t.mock.method(fsPromises, 'realpath', (file, ...options) =>
        originalRealpath(file === obsolete ? unowned : file, ...options)));
      restores.push(t.mock.method(fsPromises, 'readlink', (file, ...options) =>
        file === obsolete ? Promise.resolve(unowned) : originalReadlink(file, ...options)));
      syncBuiltinESMExports();
    } else {
      try { await fs.symlink(unowned, obsolete, 'file'); }
      catch (error) {
        if (process.platform !== 'win32' ||
            !['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) throw error;
        t.skip(`Native file-symlink capability unavailable (${error.code}); regression NotRun on this host`);
        return;
      }
    }
    assert.equal((await fs.lstat(obsolete)).isSymbolicLink(), true);
    assert.equal(await fs.readlink(obsolete), unowned);
    const pending = path.join(f.home, 'sdlc/README.md');
    await fs.appendFile(pending, '\nPrevious owned revision.\n');
    manifest.files['sdlc/README.md'] = digest(await fs.readFile(pending));
    manifest.files['sdlc/obsolete-owned.txt'] = digest(bytes);
    const ordinaryObsolete = path.join(f.home, 'sdlc/ordinary-obsolete.txt');
    await fs.writeFile(ordinaryObsolete, 'Unchanged obsolete owned content.\n');
    manifest.files['sdlc/ordinary-obsolete.txt'] = digest(await fs.readFile(ordinaryObsolete));
    await writeJson(manifestFile, manifest);
    const snapshot = new Map(await Promise.all([
      ...Object.keys(manifest.files).filter(relative => relative !== 'sdlc/obsolete-owned.txt'),
      'sdlc/install-manifest.json', 'copilot-instructions.md', 'unowned-target.txt',
    ].map(async relative => [relative, await fs.readFile(path.join(f.home, relative))])));
    let mutations = 0;
    await assert.rejects(install(f.store, { fault: async () => { mutations++; } }),
      { code: 'INSTALL_CONFLICT' });
    assert.equal(mutations, 0, 'All obsolete ownership checks must finish before replacement writes');
    for (const [relative, content] of snapshot) {
      assert.deepEqual(await fs.readFile(path.join(f.home, relative)), content, relative);
    }
    assert.equal((await fs.lstat(obsolete)).isSymbolicLink(), true);
    assert.equal(await fs.readlink(obsolete), unowned);
  } finally {
    for (const mocked of restores.reverse()) mocked.mock.restore();
    syncBuiltinESMExports();
  }
}

test('T-23 controlled obsolete symlink update preserves the literal entry and unowned target before any writes', async t => {
  await obsoleteSymlinkUpdate(t, true);
});

test('T-23 native obsolete symlink update preserves the literal entry and unowned target before any writes', async t => {
  await obsoleteSymlinkUpdate(t, false);
});

test('T-23 ordinary uninstall rejects unsupported ownership schemas without partial removal', async t => {
  const f = await fixture(t, { initialize: false });
  const instructions = path.join(f.home, 'copilot-instructions.md');
  await fs.writeFile(instructions, 'Keep personal instructions.\n');
  await install(f.store);
  const manifestFile = path.join(f.home, 'sdlc/install-manifest.json');
  const manifest = await readJson(manifestFile);
  const unowned = path.join(f.home, 'user-settings.json');
  const runtime = path.join(f.home, 'sdlc/runtime/user-sentinel.json');
  await fs.writeFile(unowned, '{"user":"preserved"}\n');
  await fs.writeFile(runtime, '{"runtime":"preserved"}\n');
  const snapshot = new Map(await Promise.all([
    ...Object.keys(manifest.files), 'copilot-instructions.md',
    'user-settings.json', 'sdlc/runtime/user-sentinel.json',
  ].map(async relative => [relative, await fs.readFile(path.join(f.home, relative))])));
  for (const schemaVersion of [2, '1', null, undefined]) {
    const unsupported = { ...manifest, schemaVersion };
    if (schemaVersion === undefined) delete unsupported.schemaVersion;
    await writeJson(manifestFile, unsupported);
    const manifestBytes = await fs.readFile(manifestFile);
    await assert.rejects(uninstall(f.store), {
      code: 'INSTALL_CONFLICT', message: 'Unknown ownership manifest',
    });
    assert.deepEqual(await fs.readFile(manifestFile), manifestBytes);
    for (const [relative, content] of snapshot) {
      assert.deepEqual(await fs.readFile(path.join(f.home, relative)), content, relative);
    }
  }
});

test('T-42 ordinary uninstall accepts schema-one ownership with compatible version labels', async t => {
  for (const version of ['0.0.1', '0.1.0-private.7', 'legacy internal build']) {
    const f = await fixture(t, { initialize: false });
    const instructions = path.join(f.home, 'copilot-instructions.md');
    await fs.writeFile(instructions, 'Keep personal instructions.\n');
    await install(f.store);
    const manifestFile = path.join(f.home, 'sdlc/install-manifest.json');
    const manifest = await readJson(manifestFile);
    await writeJson(manifestFile, { ...manifest, version });
    const unowned = path.join(f.home, 'user-settings.json');
    const runtime = path.join(f.home, 'sdlc/runtime/user-sentinel.json');
    await fs.writeFile(unowned, '{"user":"preserved"}\n');
    await fs.writeFile(runtime, '{"runtime":"preserved"}\n');
    const result = await uninstall(f.store);
    assert.equal(result.uninstalled, true, version);
    assert.deepEqual(result.preserved, []);
    assert.ok(result.removed.includes('copilot-instructions.md:owned-block'));
    for (const relative of [...Object.keys(manifest.files), 'sdlc/install-manifest.json']) {
      await assert.rejects(fs.lstat(path.join(f.home, relative)), { code: 'ENOENT' });
    }
    assert.equal((await fs.readFile(instructions, 'utf8')).trim(), 'Keep personal instructions.');
    assert.equal(await fs.readFile(unowned, 'utf8'), '{"user":"preserved"}\n');
    assert.equal(await fs.readFile(runtime, 'utf8'), '{"runtime":"preserved"}\n');
  }
});

async function malformedOwnershipPreservesContent(t, update) {
  const f = await fixture(t, { initialize: false });
  const instructions = path.join(f.home, 'copilot-instructions.md');
  await fs.writeFile(instructions, 'Keep personal instructions.\n');
  await install(f.store);
  const manifestFile = path.join(f.home, 'sdlc/install-manifest.json');
  const manifest = await readJson(manifestFile);
  const pending = path.join(f.home, 'sdlc/README.md');
  await fs.appendFile(pending, '\nPrevious owned revision.\n');
  manifest.files['sdlc/README.md'] = digest(await fs.readFile(pending));
  const obsolete = path.join(f.home, 'sdlc/ordinary-obsolete.txt');
  await fs.writeFile(obsolete, 'Unchanged obsolete owned content.\n');
  manifest.files['sdlc/ordinary-obsolete.txt'] = digest(await fs.readFile(obsolete));
  await fs.writeFile(path.join(f.home, 'user-settings.json'), '{"user":"preserved"}\n');
  await fs.writeFile(path.join(f.home, 'sdlc/runtime/user-sentinel.json'), '{"runtime":"preserved"}\n');
  const snapshot = new Map(await Promise.all([
    ...Object.keys(manifest.files), 'copilot-instructions.md',
    'user-settings.json', 'sdlc/runtime/user-sentinel.json',
  ].map(async relative => [relative, await fs.readFile(path.join(f.home, relative))])));
  const missingInventory = { ...manifest };
  delete missingInventory.files;
  const missingBlock = { ...manifest };
  delete missingBlock.instructionsBlock;
  const malformed = [
    ['null inventory', { ...manifest, files: null }],
    ['missing inventory', missingInventory],
    ['array inventory', { ...manifest, files: [] }],
    ['string inventory', { ...manifest, files: 'not an inventory' }],
    ['boolean inventory', { ...manifest, files: false }],
    ['number inventory', { ...manifest, files: 7 }],
    ...[null, {}, [], 7, '0'.repeat(63), 'g'.repeat(64)].map(hash => [
      `invalid hash ${JSON.stringify(hash)}`,
      { ...manifest, files: { ...manifest.files, 'sdlc/missing-obsolete.txt': hash } },
    ]),
    ['empty inventory path', { ...manifest, files: { ...manifest.files, '': digest('') } }],
    ['missing instruction block', missingBlock],
    ...[null, 7, '', 'not an owned block', `prefix${manifest.instructionsBlock}`,
      `${manifest.instructionsBlock}\n${manifest.instructionsBlock}`].map(instructionsBlock => [
      `invalid instruction block ${JSON.stringify(instructionsBlock).slice(0, 80)}`,
      { ...manifest, instructionsBlock },
    ]),
    ['invalid instruction provenance', { ...manifest, instructionsOriginallyExisted: 'false' }],
    ['invalid version field', { ...manifest, version: null }],
    ['null record', null],
    ['boolean record', false],
    ['array record', []],
  ];
  for (const [label, candidate] of malformed) {
    await writeJson(manifestFile, candidate);
    const manifestBytes = await fs.readFile(manifestFile);
    let writes = 0;
    await assert.rejects(update ?
      install(f.store, { fault: async () => { writes++; } }) : uninstall(f.store),
    { code: 'INSTALL_CONFLICT' }, label);
    assert.equal(writes, 0, label);
    assert.deepEqual(await fs.readFile(manifestFile), manifestBytes, label);
    for (const [relative, content] of snapshot) {
      assert.deepEqual(await fs.readFile(path.join(f.home, relative)), content, `${label}: ${relative}`);
    }
  }
}

test('T-23 ordinary uninstall rejects malformed ownership records before removing any content', async t => {
  await malformedOwnershipPreservesContent(t, false);
});

test('T-23 update rejects malformed ownership records before replacement writes', async t => {
  await malformedOwnershipPreservesContent(t, true);
});

test('T-42 partial uninstall preserves valid empty inventories and accepts omitted legacy optional fields', async t => {
  const f = await fixture(t, { initialize: false });
  const instructions = path.join(f.home, 'copilot-instructions.md');
  await fs.writeFile(instructions, 'Keep personal instructions.\n');
  await install(f.store);
  const installedInstructions = await fs.readFile(instructions);
  const manifestFile = path.join(f.home, 'sdlc/install-manifest.json');
  const installedManifest = await readJson(manifestFile);
  const unowned = path.join(f.home, 'user-settings.json');
  const runtime = path.join(f.home, 'sdlc/runtime/user-sentinel.json');
  await fs.writeFile(unowned, '{"user":"preserved"}\n');
  await fs.writeFile(runtime, '{"runtime":"preserved"}\n');
  const modifiedInstructions = Buffer.from(installedInstructions.toString('utf8')
    .replace(BLOCK_START, `${BLOCK_START}\nUser customization inside the block.`));
  await fs.writeFile(instructions, modifiedInstructions);
  const first = await uninstall(f.store);
  assert.equal(first.uninstalled, false);
  assert.deepEqual(first.preserved, ['copilot-instructions.md:modified-owned-block']);
  for (const relative of Object.keys(installedManifest.files)) {
    await assert.rejects(fs.lstat(path.join(f.home, relative)), { code: 'ENOENT' });
  }
  const partial = await readJson(manifestFile);
  assert.deepEqual(partial.files, {});
  delete partial.version;
  delete partial.instructionsOriginallyExisted;
  await writeJson(manifestFile, partial);
  const partialBytes = await fs.readFile(manifestFile);
  const repeated = await uninstall(f.store);
  assert.equal(repeated.uninstalled, false);
  assert.deepEqual(repeated.removed, []);
  assert.deepEqual(repeated.preserved, first.preserved);
  assert.deepEqual(await fs.readFile(instructions), modifiedInstructions);
  assert.deepEqual(await fs.readFile(manifestFile), partialBytes);
  await fs.writeFile(instructions, installedInstructions);
  assert.equal((await install(f.store)).installed, true);
  const restored = await readJson(manifestFile);
  assert.deepEqual(restored.files, installedManifest.files);
  for (const [relative, hash] of Object.entries(restored.files)) {
    assert.equal(digest(await fs.readFile(path.join(f.home, relative))), hash, relative);
  }
  assert.equal((await uninstall(f.store)).uninstalled, true);
  await assert.rejects(fs.lstat(manifestFile), { code: 'ENOENT' });
  assert.equal((await fs.readFile(instructions, 'utf8')).trim(), 'Keep personal instructions.');
  assert.equal(await fs.readFile(unowned, 'utf8'), '{"user":"preserved"}\n');
  assert.equal(await fs.readFile(runtime, 'utf8'), '{"runtime":"preserved"}\n');
});

async function ownershipPreflightFixture(t) {
  const f = await fixture(t, { initialize: false });
  const instructions = path.join(f.home, 'copilot-instructions.md');
  await fs.writeFile(instructions, 'Keep personal instructions.\n');
  await install(f.store);
  const manifestFile = path.join(f.home, 'sdlc/install-manifest.json');
  const manifest = await readJson(manifestFile);
  await fs.mkdir(path.join(f.home, 'zz-user'));
  await fs.writeFile(path.join(f.home, 'zz-user/note.txt'), 'Keep unowned content.\n');
  await fs.writeFile(path.join(f.home, 'sdlc/runtime/user-sentinel.json'), '{"runtime":"preserved"}\n');
  const ownedPaths = Object.keys(manifest.files);
  const snapshot = async ({ omit = [], include = [] } = {}) => new Map(await Promise.all([
    ...ownedPaths, 'copilot-instructions.md', 'sdlc/install-manifest.json',
    'zz-user/note.txt', 'sdlc/runtime/user-sentinel.json', ...include,
  ].filter(relative => !omit.includes(relative)).map(async relative =>
    [relative, await fs.readFile(path.join(f.home, relative))])));
  return { ...f, instructions, manifestFile, manifest, snapshot };
}

async function assertOwnershipSnapshot(home, snapshot, label) {
  for (const [relative, content] of snapshot) {
    assert.deepEqual(await fs.readFile(path.join(home, relative)), content, `${label}: ${relative}`);
  }
}

test('T-23 canonical ownership file keys reject aliases before update or uninstall mutations', async t => {
  const f = await ownershipPreflightFixture(t);
  const keys = [
    'zz-user/.', 'zz-user/', 'zz-user//note.txt', './zz-user/note.txt',
    'zz-user/../zz-user/note.txt', 'zz-user\\note.txt', '',
    '.', '..', '/zz-user/note.txt', 'C:zz-user/note.txt', 'C:/zz-user/note.txt',
    '\\\\server\\share\\note.txt', 'zz-user/note.txt:stream', 'zz-user/\0',
    path.join(f.home, 'zz-user', 'note.txt'),
  ];
  for (const relative of keys) {
    for (const update of [false, true]) {
      const label = `${update ? 'update' : 'uninstall'} ${JSON.stringify(relative)}`;
      await writeJson(f.manifestFile, {
        ...f.manifest, files: { ...f.manifest.files, [relative]: digest('Keep unowned content.\n') },
      });
      const snapshot = await f.snapshot();
      const outcome = await (update ? install(f.store) : uninstall(f.store))
        .then(value => ({ value }), error => ({ error }));
      await assertOwnershipSnapshot(f.home, snapshot, label);
      assert.deepEqual(await fs.readdir(path.join(f.home, 'zz-user')), ['note.txt'], label);
      assert.equal(outcome.error?.code, 'INSTALL_CONFLICT', label);
    }
  }
});

test('T-23 uninstall rejects a last serialized root alias before any owned file removal', async t => {
  const f = await ownershipPreflightFixture(t);
  // Keep the root alias after valid entries; canonical serialization would sort it first.
  await fs.writeFile(f.manifestFile, `${JSON.stringify({
    ...f.manifest, files: { ...f.manifest.files, '.': digest('valid recorded bytes') },
  })}\n`);
  const snapshot = await f.snapshot();
  const outcome = await uninstall(f.store).then(value => ({ value }), error => ({ error }));
  await assertOwnershipSnapshot(f.home, snapshot, 'last serialized root alias');
  assert.equal(outcome.error?.code, 'INSTALL_CONFLICT');
});

test('T-23 uninstall preflights non-file and unreadable entries before deleting owned assets', async t => {
  for (const scenario of [
    'inventory-directory', 'inventory-oversized', 'instructions-directory', 'instructions-oversized',
  ]) {
    const f = await ownershipPreflightFixture(t);
    const inventory = scenario.startsWith('inventory-');
    const directory = scenario.endsWith('-directory');
    const relative = inventory ? (directory ? 'zz-user' : 'zz-oversized-owned.txt') :
      'copilot-instructions.md';
    const target = path.join(f.home, relative);
    if (inventory) {
      await writeJson(f.manifestFile, {
        ...f.manifest, files: { ...f.manifest.files, [relative]: digest('valid recorded bytes') },
      });
    } else {
      await fs.unlink(target);
    }
    if (directory) {
      if (!inventory) {
        await fs.mkdir(target);
        await fs.writeFile(path.join(target, 'note.txt'), 'Keep unrelated instruction-directory content.\n');
      }
    } else {
      await fs.writeFile(target, Buffer.alloc((inventory ? LIMITS.artifact : LIMITS.input) + 1, 0x61));
    }
    const snapshot = await f.snapshot({
      omit: directory ? [relative] : [],
      include: directory ? (inventory ? [] : [`${relative}/note.txt`]) : (inventory ? [relative] : []),
    });
    const outcome = await uninstall(f.store).then(value => ({ value }), error => ({ error }));
    await assertOwnershipSnapshot(f.home, snapshot, scenario);
    if (directory) {
      assert.equal((await fs.lstat(target)).isDirectory(), true, scenario);
      assert.deepEqual(await fs.readdir(target), ['note.txt'], scenario);
    }
    assert.equal(outcome.error?.code,
      directory ? (inventory ? 'INSTALL_CONFLICT' : 'PATH') : 'CAPACITY', scenario);
  }
});

test('T-42 uninstall preflight preserves missing modified and redirected owned entries', async t => {
  const f = await ownershipPreflightFixture(t);
  const modified = 'sdlc/README.md';
  const redirected = 'skills/sdlc/SKILL.md';
  const missing = 'sdlc/bin/sdlc.mjs';
  const originalModified = await fs.readFile(path.join(f.home, modified));
  const originalRedirected = await fs.readFile(path.join(f.home, redirected));
  const originalInstructions = await fs.readFile(f.instructions);
  const redirectTarget = path.join(f.home, 'zz-user/redirect-target.txt');
  const instructionsTarget = path.join(f.home, 'zz-user/instructions-target.txt');
  await fs.writeFile(redirectTarget, originalRedirected);
  await fs.writeFile(instructionsTarget, originalInstructions);
  await fs.unlink(path.join(f.home, redirected));
  await fs.unlink(f.instructions);
  try {
    await fs.symlink(redirectTarget, path.join(f.home, redirected), 'file');
    await fs.symlink(instructionsTarget, f.instructions, 'file');
  } catch (error) {
    if (process.platform !== 'win32' ||
        !['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) throw error;
    t.skip(`Native file-symlink capability unavailable (${error.code}); compatibility regression NotRun`);
    return;
  }
  await fs.appendFile(path.join(f.home, modified), '\nUser customization.\n');
  const modifiedBytes = await fs.readFile(path.join(f.home, modified));
  await fs.unlink(path.join(f.home, missing));
  const obsolete = 'sdlc/obsolete..owned.txt';
  await fs.writeFile(path.join(f.home, obsolete), 'Unchanged obsolete owned content.\n');
  await writeJson(f.manifestFile, {
    ...f.manifest, files: { ...f.manifest.files,
      [obsolete]: digest('Unchanged obsolete owned content.\n'),
      'zz-already-removed.txt': digest('Already removed.\n') },
  });
  const first = await uninstall(f.store);
  assert.equal(first.uninstalled, false);
  assert.deepEqual(new Set(first.preserved), new Set([
    modified, `${redirected}:symlink`, 'copilot-instructions.md:symlink',
  ]));
  assert.deepEqual(await fs.readFile(path.join(f.home, modified)), modifiedBytes);
  assert.equal(await fs.readlink(path.join(f.home, redirected)), redirectTarget);
  assert.equal(await fs.readlink(f.instructions), instructionsTarget);
  assert.deepEqual((await readJson(f.manifestFile)).files, {
    [modified]: f.manifest.files[modified], [redirected]: f.manifest.files[redirected],
  });
  for (const relative of [...Object.keys(f.manifest.files).filter(file =>
    ![modified, redirected].includes(file)), obsolete, 'zz-already-removed.txt']) {
    await assert.rejects(fs.lstat(path.join(f.home, relative)), { code: 'ENOENT' });
  }
  await fs.writeFile(path.join(f.home, modified), originalModified);
  await fs.unlink(path.join(f.home, redirected));
  await fs.writeFile(path.join(f.home, redirected), originalRedirected);
  await fs.unlink(f.instructions);
  await fs.writeFile(f.instructions, originalInstructions);
  assert.equal((await uninstall(f.store)).uninstalled, true);
  await assert.rejects(fs.lstat(f.manifestFile), { code: 'ENOENT' });
  assert.equal((await fs.readFile(f.instructions, 'utf8')).trim(), 'Keep personal instructions.');
  assert.deepEqual(await fs.readFile(redirectTarget), originalRedirected);
  assert.deepEqual(await fs.readFile(instructionsTarget), originalInstructions);
  assert.equal(await fs.readFile(path.join(f.home, 'zz-user/note.txt'), 'utf8'), 'Keep unowned content.\n');
  assert.equal(await fs.readFile(path.join(f.home, 'sdlc/runtime/user-sentinel.json'), 'utf8'),
    '{"runtime":"preserved"}\n');
});

test('T-PRD023 competing installs and interrupted rollback preserve unowned content, runtime and the other fixture', async t => {
  const first = await fixture(t);
  const second = await fixture(t);
  const outside = path.join(os.tmpdir(), `sdlc-unowned-${randomUUID()}.json`);
  await fs.writeFile(outside, '{"outside":"preserved"}\n', { flag: 'wx' });
  t.after(() => fs.unlink(outside));
  const settings = await Promise.all([first, second].map(async f => {
    const file = path.join(f.home, 'user-settings.json');
    await fs.writeFile(file, '{"user":"preserved"}\n', { flag: 'wx' });
    const runtime = path.join(f.home, 'sdlc', 'runtime', 'user-sentinel.json');
    await fs.writeFile(runtime, '{"runtime":"preserved"}\n', { flag: 'wx' });
    return { file, runtime };
  }));
  const entered = [Promise.withResolvers(), Promise.withResolvers()];
  const secondCompleted = Promise.withResolvers();
  const wait = async promise => {
    const timeout = new AbortController();
    try {
      return await Promise.race([promise, delay(20000, null, { signal: timeout.signal, ref: false })
        .then(() => { throw new Error('Independent installer did not reach its owned-resource barrier'); })]);
    } finally { timeout.abort(); }
  };
  let injected = false;
  const failed = install(first.store, { fault: async relative => {
    if (relative !== 'sdlc/bin/sdlc.mjs') return;
    entered[0].resolve();
    await wait(entered[1].promise);
    await wait(secondCompleted.promise);
    await fs.appendFile(path.join(first.home, relative), '\n// preserved concurrent user modification\n');
    injected = true;
    throw new Error('Interrupted owned installation');
  } });
  const failedOutcome = failed.then(() => null, error => error);
  try {
    const success = await install(second.store, { fault: async relative => {
      if (relative !== 'sdlc/bin/sdlc.mjs') return;
      entered[1].resolve();
      await wait(entered[0].promise);
    } });
    assert.equal(success.installed, true);
  } finally {
    entered[0].resolve();
    entered[1].resolve();
    secondCompleted.resolve();
    await failedOutcome;
  }
  const failure = await failedOutcome;
  assert.equal(failure?.code, 'INSTALL_FAILED');
  assert.equal(injected, true);
  assert.match(await fs.readFile(path.join(first.home, 'sdlc/bin/sdlc.mjs'), 'utf8'),
    /preserved concurrent user modification/u);
  await uninstall(second.store);
  for (const { file, runtime } of settings) {
    assert.equal(await fs.readFile(file, 'utf8'), '{"user":"preserved"}\n');
    assert.equal(await fs.readFile(runtime, 'utf8'), '{"runtime":"preserved"}\n');
  }
  assert.equal(await fs.readFile(outside, 'utf8'), '{"outside":"preserved"}\n');
});

test('T-46 explicit purge removes all framework traces but preserves unrelated Copilot content', async t => {
  const f = await fixture(t, { initialize: false });
  const instructions = path.join(f.home, 'copilot-instructions.md');
  await fs.writeFile(instructions, 'Personal instructions stay.\n');
  await install(f.store);
  await fs.appendFile(path.join(f.home, 'skills/sdlc-coding/SKILL.md'),
    '\nModified framework skill.\n');
  await fs.writeFile(instructions, (await fs.readFile(instructions, 'utf8'))
    .replace('AI SDLC', 'Customized AI SDLC'));
  const runtime = path.join(f.home, 'sdlc/runtime/work-items/legacy/evidence.json');
  await fs.mkdir(path.dirname(runtime), { recursive: true });
  await fs.writeFile(runtime, '{"legacy":true}\n');
  const unrelatedSkill = path.join(f.home, 'skills/community-skill/SKILL.md');
  await fs.mkdir(path.dirname(unrelatedSkill), { recursive: true });
  await fs.writeFile(unrelatedSkill, 'Keep this skill.\n');
  await fs.rm(path.join(f.home, 'skills/sdlc'), { recursive: true });
  await fs.symlink(path.join(f.home, 'skills/community-skill'),
    path.join(f.home, 'skills/sdlc'));
  const unrelatedHook = path.join(f.home, 'hooks/community.json');
  await fs.writeFile(unrelatedHook, '{"keep":true}\n');
  await fs.rm(path.join(f.home, 'hooks/sdlc.json'));
  await fs.symlink(unrelatedHook, path.join(f.home, 'hooks/sdlc.json'));
  const unrelatedFile = path.join(f.home, 'user-settings.json');
  await fs.writeFile(unrelatedFile, '{"keep":true}\n');
  const abandonedLock = path.join(f.home, 'sdlc/.install.lock');
  await fs.writeFile(abandonedLock, '');
  const stale = new Date(Date.now() - 5000);
  await fs.utimes(abandonedLock, stale, stale);

  const result = await uninstall(f.store, { purge: true });
  assert.equal(result.purged, true);
  assert.equal(result.uninstalled, true);
  assert.deepEqual(result.preserved, []);
  await assert.rejects(fs.stat(path.join(f.home, 'sdlc')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(f.home, 'hooks/sdlc.json')), { code: 'ENOENT' });
  for (const name of ['sdlc', 'sdlc-requirements', 'sdlc-test-design',
    'sdlc-technical-design', 'sdlc-coding']) {
    await assert.rejects(fs.stat(path.join(f.home, 'skills', name)),
      { code: 'ENOENT' });
  }
  const remainingInstructions = await fs.readFile(instructions, 'utf8');
  assert.match(remainingInstructions, /^Personal instructions stay\./u);
  assert.ok(!remainingInstructions.includes(BLOCK_START));
  assert.ok(!remainingInstructions.includes('Customized AI SDLC'));
  assert.equal(await fs.readFile(unrelatedSkill, 'utf8'), 'Keep this skill.\n');
  assert.equal(await fs.readFile(unrelatedHook, 'utf8'), '{"keep":true}\n');
  assert.equal(await fs.readFile(unrelatedFile, 'utf8'), '{"keep":true}\n');
  assert.equal((await uninstall(f.store, { purge: true })).purged, true);
});
test('T-46 clean install purges the previous framework and installs the new package in one operation', async t => {
  const f = await fixture(t, { initialize: false });
  const instructions = path.join(f.home, 'copilot-instructions.md');
  await fs.writeFile(instructions, 'Keep personal instructions.\n');
  await install(f.store);
  await fs.appendFile(path.join(f.home, 'skills/sdlc-coding/SKILL.md'),
    '\nOld modified installation.\n');
  const oldRuntime = path.join(f.home,
    'sdlc/runtime/work-items/old/private-state.json');
  await fs.mkdir(path.dirname(oldRuntime), { recursive: true });
  await fs.writeFile(oldRuntime, '{"old":true}\n');
  const unrelated = path.join(f.home, 'unrelated.json');
  await fs.writeFile(unrelated, '{"keep":true}\n');

  await assert.rejects(cleanInstall(f.store, {
    sourceRoot: path.join(f.home, 'sdlc'),
  }), { code: 'INSTALL_CONFLICT' });
  assert.equal(await fs.readFile(oldRuntime, 'utf8'), '{"old":true}\n');
  const incompleteSource = path.join(f.root, 'incomplete-package');
  for (const directory of ['bin', 'src', 'assets/skills',
    'assets/templates', 'assets/instructions', 'assets/hooks',
    'docs/reference', 'docs/integrations']) {
    await fs.mkdir(path.join(incompleteSource, directory), { recursive: true });
  }
  await fs.writeFile(path.join(incompleteSource, 'assets/hooks/sdlc.json'),
    '{"hooks":{}}\n');
  await fs.writeFile(path.join(incompleteSource, 'assets/instructions.md'), '');
  await fs.writeFile(path.join(incompleteSource,
    'assets/lifecycle-intent.md'), '');
  for (const name of ['README.md', 'CONTRIBUTING.md', 'SUPPORT.md', 'SECURITY.md',
    'CODE_OF_CONDUCT.md', 'OWNERSHIP.md', 'RELEASING.md', 'CHANGELOG.md', 'LICENSE']) {
    await fs.writeFile(path.join(incompleteSource, name), '');
  }
  await fs.writeFile(path.join(incompleteSource, 'docs/reference/cli.md'), '');
  await fs.writeFile(path.join(incompleteSource,
    'docs/integrations/provider-adapters.md'), '');
  await fs.writeFile(path.join(incompleteSource, 'package.json'), JSON.stringify({
    name: 'ai-sdlc-framework',
    version: '9.9.9',
    bin: { sdlc: './bin/sdlc.mjs' },
  }));
  await assert.rejects(cleanInstall(f.store, {
    sourceRoot: incompleteSource,
  }), { code: 'INSTALL', message: /missing docs\/integrations\/github-adapters\.md/u });
  assert.equal(await fs.readFile(oldRuntime, 'utf8'), '{"old":true}\n');
  await assert.rejects(execute(process.execPath, [
    path.join(f.home, 'sdlc/bin/sdlc.mjs'),
    'install',
    '--purge-existing',
    '--source-root',
    path.resolve('.'),
    '--home',
    f.home,
  ]), error => JSON.parse(error.stdout).error.code === 'INSTALL_CONFLICT');
  assert.equal(await fs.readFile(oldRuntime, 'utf8'), '{"old":true}\n');
  const execution = await execute(process.execPath, [
    path.resolve('bin/sdlc.mjs'),
    'install',
    '--purge-existing',
    '--home',
    f.home,
  ]);
  const result = JSON.parse(execution.stdout);
  assert.equal(result.purgedExisting, true);
  assert.equal(result.installed, true);
  await assert.rejects(fs.stat(oldRuntime), { code: 'ENOENT' });
  assert.doesNotMatch(await fs.readFile(
    path.join(f.home, 'skills/sdlc-coding/SKILL.md'), 'utf8'),
  /Old modified installation/u);
  assert.match(await fs.readFile(instructions, 'utf8'),
    /Keep personal instructions/u);
  assert.equal(await fs.readFile(unrelated, 'utf8'), '{"keep":true}\n');
  const report = await doctor(f.store);
  assert.equal(report.installed, true);
  assert.deepEqual(report.findings, []);
});
test('T-46 purge does not follow manifest or instruction symlinks and ignores corrupt manifests', async t => {
  const f = await fixture(t, { initialize: false });
  const instructionTarget = path.join(f.home, 'personal-instructions.md');
  const instructions = path.join(f.home, 'copilot-instructions.md');
  await fs.writeFile(instructionTarget, 'Keep personal instructions.\n');
  await fs.symlink(instructionTarget, instructions);
  await install(f.store);

  const manifest = path.join(f.home, 'sdlc/install-manifest.json');
  const unrelatedManifest = path.join(f.home, 'unrelated-manifest.json');
  await fs.writeFile(unrelatedManifest,
    '{"owner":"ai-sdlc-framework","keep":true}\n');
  await fs.unlink(manifest);
  await fs.symlink(unrelatedManifest, manifest);

  assert.equal((await uninstall(f.store, { purge: true })).purged, true);
  assert.equal(await fs.readFile(unrelatedManifest, 'utf8'),
    '{"owner":"ai-sdlc-framework","keep":true}\n');
  assert.equal(await fs.readFile(instructionTarget, 'utf8'),
    'Keep personal instructions.\n');

  await install(f.store);
  await fs.writeFile(path.join(f.home, 'sdlc/install-manifest.json'), '{"owner":');
  assert.equal((await uninstall(f.store, { purge: true })).purged, true);

  const redirectedFramework = path.join(f.root, 'redirected-framework');
  await fs.mkdir(redirectedFramework);
  await fs.writeFile(path.join(redirectedFramework, '.install.lock'),
    '{"unrelated":true}\n');
  await fs.symlink(redirectedFramework, path.join(f.home, 'sdlc'));
  assert.equal((await uninstall(f.store, { purge: true })).purged, true);
  assert.equal(await fs.readFile(
    path.join(redirectedFramework, '.install.lock'), 'utf8'),
  '{"unrelated":true}\n');
});
test('T-46 purge recovers invalid locks and unlinks runtime redirects without following them', async t => {
  const f = await fixture(t, { initialize: false });
  for (const lock of [
    'x'.repeat(4096),
    JSON.stringify({
      host: os.hostname(),
      pid: Number.MAX_SAFE_INTEGER,
      token: 'invalid-owner',
    }),
  ]) {
    await install(f.store);
    const abandoned = path.join(f.home, 'sdlc/.install.lock');
    await fs.writeFile(abandoned, lock);
    const stale = new Date(Date.now() - 5000);
    await fs.utimes(abandoned, stale, stale);
    assert.equal((await uninstall(f.store, { purge: true })).purged, true);
  }
  const externalLock = path.join(f.home,
    '.ai-sdlc-framework.install.lock');
  await fs.writeFile(externalLock, 'x'.repeat(4096));
  const stale = new Date(Date.now() - 5000);
  await fs.utimes(externalLock, stale, stale);
  assert.equal((await uninstall(f.store, { purge: true })).purged, true);

  await install(f.store);
  const unrelatedRuntime = path.join(f.root, 'unrelated-runtime');
  await fs.mkdir(unrelatedRuntime);
  await fs.writeFile(path.join(unrelatedRuntime, 'keep.json'), '{"keep":true}\n');
  await fs.rm(path.join(f.home, 'sdlc/runtime'), { recursive: true });
  await fs.symlink(unrelatedRuntime, path.join(f.home, 'sdlc/runtime'));
  assert.equal((await uninstall(f.store, { purge: true })).purged, true);
  assert.equal(await fs.readFile(path.join(unrelatedRuntime, 'keep.json'), 'utf8'),
    '{"keep":true}\n');
});
test('T-46 purge does not steal a newly populated live lock', async t => {
  const f = await fixture(t, { initialize: false });
  const lock = path.join(f.home, '.ai-sdlc-framework.install.lock');
  const content = path.join(f.store.runtime, 'live-owner.json');
  const owner = JSON.stringify({
    host: os.hostname(),
    pid: process.pid,
    token: 'live-owner',
  });
  await fs.writeFile(content, '{"preserve":true}\n');
  await fs.writeFile(lock, '');
  const open = fsPromises.open;
  let populated = false;
  const mocked = t.mock.method(fsPromises, 'open', async (file, ...options) => {
    const handle = await open(file, ...options);
    if (file === lock && !populated) {
      const read = handle.read.bind(handle);
      t.mock.method(handle, 'read', async (...readOptions) => {
        if (!populated) {
          populated = true;
          await fs.writeFile(lock, owner);
        }
        return read(...readOptions);
      });
    }
    return handle;
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(uninstall(f.store, { purge: true }),
      { code: 'LOCK_BUSY' });
    assert.equal(populated, true);
    assert.equal(await fs.readFile(lock, 'utf8'), owner);
    await assert.rejects(uninstall(f.store, { purge: true }),
      { code: 'LOCK_BUSY' });
    assert.equal(await fs.readFile(lock, 'utf8'), owner);
    assert.equal(await fs.readFile(content, 'utf8'), '{"preserve":true}\n');
  } finally {
    mocked.mock.restore();
    syncBuiltinESMExports();
    await fs.unlink(lock);
  }
});
test('T-46 purge validates every parent before removing any owned content', async t => {
  const f = await fixture(t, { initialize: false });
  await install(f.store);
  const instructions = path.join(f.home, 'copilot-instructions.md');
  const before = await fs.readFile(instructions, 'utf8');
  const hook = path.join(f.home, 'hooks/sdlc.json');
  const runtime = path.join(f.home, 'sdlc/runtime/private-state.json');
  await fs.writeFile(runtime, '{"old":true}\n');
  await fs.rm(path.join(f.home, 'skills'), { recursive: true });
  await fs.writeFile(path.join(f.home, 'skills'), 'not a directory\n');

  await assert.rejects(cleanInstall(f.store), { code: 'PATH' });
  assert.equal(await fs.readFile(instructions, 'utf8'), before);
  assert.ok(await fs.stat(hook));
  assert.equal(await fs.readFile(runtime, 'utf8'), '{"old":true}\n');
});
test('T-46 clean install holds one lock and reports failure after irreversible purge', async t => {
  const f = await fixture(t, { initialize: false });
  await install(f.store);
  const runtime = path.join(f.home, 'sdlc/runtime/private-state.json');
  await fs.writeFile(runtime, '{"old":true}\n');
  let competingInstallChecked = false;
  await assert.rejects(cleanInstall(f.store, {
    fault: async relative => {
      if (!competingInstallChecked) {
        competingInstallChecked = true;
        await assert.rejects(install(f.store), { code: 'LOCK_BUSY' });
      }
      if (relative === 'sdlc/bin/sdlc.mjs') {
        throw new Error('replacement failure');
      }
    },
  }), error => error.code === 'INSTALL_FAILED' &&
    error.details?.purgedExisting === true &&
    error.details?.purge?.purged === true);
  assert.equal(competingInstallChecked, true);
  await assert.rejects(fs.stat(runtime), { code: 'ENOENT' });
});
test('T-14/T-21 phase-aware artifact checks and CLI exit codes distinguish unknown, broken and corrupt', async t => {
  const f = await fixture(t);
  const relative = await artifact(f, 'requirements', '# Requirements\n### FR-001 - Explicit outcome\n**Definition of Done**\n- AC-001.1: Observable success.\n');
  await registerArtifact(f.store, { workItemId: f.workItemId, role: 'requirements', repositoryId: 'primary', path: relative });
  const early = await cli(f, ['check', 'artifacts', '--work-item', f.workItemId]);
  assert.equal(early.code, 0);
  assert.ok(early.json.findings.some(finding => finding.rule === 'artifact:test-plan' && finding.verdict === 'not-applicable'));
  assert.equal((await cli(f, ['check', 'history', '--work-item', f.workItemId])).code, 3);
  await fs.writeFile(path.join(f.repo, relative), '# No stable requirement or DoD');
  assert.equal((await cli(f, ['check', 'artifacts', '--work-item', f.workItemId])).code, 2);
  await fs.writeFile(path.join(f.store.workPath(f.workItemId), 'checkpoint.json'), '{corrupt');
  assert.equal((await cli(f, ['check', 'state', '--work-item', f.workItemId])).code, 4);
  assert.equal(aggregate([{ verdict: 'violation' }, { verdict: 'unverified' }]).exitCode, 2);
  assert.equal(aggregate([{ verdict: 'error' }, { verdict: 'violation' }]).exitCode, 4);
  assert.equal(aggregate([{ verdict: 'authorized-deviation' }]).verdict, 'authorized-deviation');
});
test('T-14/T-21 invalid test statuses fail instead of being silently normalized; deviations remain visible', async t => {
  const f = await coding(await fixture(t));
  const plan = path.join(f.repo, 'docs/test-plan.md');
  await fs.writeFile(plan, (await fs.readFile(plan, 'utf8')).replace('NotRun', 'Skipped'));
  const broken = await check(f.store, f.workItemId, 'artifacts');
  assert.equal(broken.exitCode, 2);
  await grant(f, 'override', { rules: ['status:T-unit'], reason: 'User explicitly accepts this documentation deviation, not a test pass' });
  const deviation = await check(f.store, f.workItemId, 'artifacts');
  assert.equal(deviation.exitCode, 0);
  assert.ok(deviation.findings.some(f => f.verdict === 'authorized-deviation'));
  assert.equal((await check(f.store, f.workItemId, 'evidence')).exitCode, 3);
});
test('T-23 malformed, unknown, unsafe and oversized state input is explicit; strict evaluator findings remain visible', async t => {
  const f = await fixture(t);
  assert.throws(() => safeRecord({ note: 'x'.repeat(5000) }), { code: 'CAPACITY' });
  assert.throws(() => safeRecord({ accessToken: 'not-a-real-token-but-unsafe-field' }), { code: 'UNSAFE' });
  const unknown = await cli(f, ['decision', 'apply'], { workItemId: f.workItemId, sessionId: f.sessionId, evidence: 'approved' });
  assert.equal(unknown.code, 4);
  const invalidGate = await cli(f, ['gate'], { toolName: 'bash', toolArgs: { command: 'anything' } });
  assert.equal(invalidGate.code, 0);
  assert.deepEqual(invalidGate.json, {});
});
test('T-01/T-04 planned canonical artifact can be created before final registration', async t => {
  const f = await fixture(t);
  await writeJson(path.join(f.repo, '.sdlc/config.json'), { defaultBranch: 'refs/heads/main' });
  await orient(f);
  const create = { cwd: f.repo, sessionId: f.sessionId, toolName: 'create',
    toolArgs: { path: 'docs/requirements.md', file_text: '# Requirements\n' } };
  assert.equal((await gate(f.store, create)).permissionDecision, 'deny');
  const planned = await registerArtifact(f.store, { workItemId: f.workItemId, role: 'requirements',
    repositoryId: 'primary', path: 'docs/requirements.md', planned: true });
  assert.equal(planned.digest, 'pending');
  await orient(f);
  const allowed = await gate(f.store, create);
  assert.equal(allowed.permissionDecision, undefined, JSON.stringify(allowed));
  await fs.mkdir(path.join(f.repo, 'docs'), { recursive: true });
  await fs.writeFile(path.join(f.repo, 'docs/requirements.md'),
    '# Requirements\n### FR-001 - Bootstrap\n**Definition of Done**\n- AC-001.1: Created.\n');
  const registered = await registerArtifact(f.store, { workItemId: f.workItemId, role: 'requirements',
    repositoryId: 'primary', path: 'docs/requirements.md' });
  assert.equal(registered.planned, false);
  assert.match(registered.digest, /^[a-f0-9]{64}$/u);
  assert.equal((await check(f.store, f.workItemId, 'artifacts')).exitCode, 0);
});
test('T-01 information-only Git reads do not require a development binding', async t => {
  const f = await fixture(t, { initialize: false });
  const result = await gate(f.store, { cwd: f.repo, sessionId: 'information-session',
    toolName: 'bash', toolArgs: { command: 'git status --short' } });
  assert.equal(result.permissionDecision, undefined);
  const expanded = await gate(f.store, { cwd: f.repo, sessionId: 'information-session',
    toolName: 'bash', toolArgs: { command: 'git diff --{output=/tmp/review-probe,no-color}' } });
  assert.equal(expanded.permissionDecision, 'deny');
  const powershell = await gate(f.store, { cwd: f.repo, sessionId: 'information-session',
    toolName: 'powershell', toolArgs: { command: 'git status (Remove-Item -LiteralPath victim)' } });
  assert.equal(powershell.permissionDecision, 'deny');
  assert.match(powershell.permissionDecisionReason, /PowerShell expressions/u);
  const recoveryExpression = await gate(f.store, { cwd: f.repo, sessionId: 'information-session',
    toolName: 'powershell', toolArgs: { command: `node ${path.resolve('bin/sdlc.mjs')} status (Remove-Item victim)` } });
  assert.equal(recoveryExpression.permissionDecision, 'deny');
  assert.match(recoveryExpression.permissionDecisionReason, /PowerShell expressions/u);
  const bound = await fixture(t);
  await writeJson(path.join(bound.repo, '.sdlc/config.json'), { defaultBranch: 'refs/heads/main' });
  await orient(bound);
  const boundExpression = await gate(bound.store, { cwd: bound.repo, sessionId: bound.sessionId,
    toolName: 'powershell', toolArgs: { command: 'git status (Remove-Item -LiteralPath victim)' } });
  assert.equal(boundExpression.permissionDecision, 'deny');
  assert.match(boundExpression.permissionDecisionReason, /PowerShell expressions/u);
});
test('T-01/T-04 planned artifact paths reject protected metadata and support Test Plan creation', async t => {
  const f = await fixture(t);
  await writeJson(path.join(f.repo, '.sdlc/config.json'), { defaultBranch: 'refs/heads/main' });
  await assert.rejects(registerArtifact(f.store, { workItemId: f.workItemId,
    role: 'requirements', repositoryId: 'primary', path: 'docs/invalid.md',
    planned: 'true' }), { code: 'INPUT' });
  await assert.rejects(registerArtifact(f.store, { workItemId: f.workItemId, role: 'requirements',
    repositoryId: 'primary', path: '.git/hooks/pre-push', planned: true }), { code: 'PATH' });
  const requirements = await artifact(f, 'requirements',
    '# Requirements\n### FR-001 - Plan tests\n**Definition of Done**\n- AC-001.1: Tests are planned.\n');
  await registerArtifact(f.store, { workItemId: f.workItemId, role: 'requirements',
    repositoryId: 'primary', path: requirements });
  await grant(f, 'approval', { transition: { from: 'requirements', to: 'test-design' } }, { prepared: true });
  await registerArtifact(f.store, { workItemId: f.workItemId, role: 'test-plan',
    repositoryId: 'primary', path: 'docs/test-plan.md', planned: true });
  await orient(f);
  const create = await gate(f.store, { cwd: f.repo, sessionId: f.sessionId, toolName: 'create',
    toolArgs: { path: 'docs/test-plan.md', file_text: '# Test Plan\n' } });
  assert.equal(create.permissionDecision, undefined, JSON.stringify(create));
});
test('T-20 repository configuration remains editable without becoming a canonical artifact', async t => {
  const f = await fixture(t);
  await grant(f, 'override', { rules: ['repository-workflow'],
    reason: 'Fixture has no resolvable default branch but must classify supported configuration' });
  await orient(f);
  const result = await gate(f.store, { cwd: f.repo, sessionId: f.sessionId, toolName: 'create',
    toolArgs: { path: '.sdlc/config.json', file_text: '{"defaultBranch":"refs/heads/main"}' } });
  assert.equal(result.permissionDecision, undefined, JSON.stringify(result));
});
