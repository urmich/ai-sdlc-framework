import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { generateHomebrewFormula } from '../packaging/homebrew/generate-formula.mjs';
import { promoteHomebrewLink, switchToHomebrew } from '../scripts/homebrew-switch.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(t, version = '0.3.0') {
  const root = path.resolve('.test-data', `homebrew-${randomUUID()}`);
  await fs.mkdir(root, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const files = [];
  for (const arch of ['x64', 'arm64']) {
    const filename = `ai-sdlc-framework-${version}-macos-${arch}.tar.gz`;
    const bytes = Buffer.from(`checksum fixture ${version} ${arch}`);
    await fs.writeFile(path.join(root, filename), bytes);
    files.push({ filename, kind: 'archive', sha256: digest(bytes), size: bytes.length });
  }
  const descriptor = { schemaVersion: 1, name: 'ai-sdlc-framework', version,
    sourceCommit: 'a'.repeat(40), payload: {
      filename: `ai-sdlc-framework-${version}.tgz`,
      sha256: 'b'.repeat(64), inventoryDigest: 'c'.repeat(64),
    }, files };
  return { root, descriptor, artifactDirectory: root };
}

test('T-51 Homebrew stable metadata binds both public architecture assets and lifecycle ownership', async t => {
  const input = await fixture(t);
  const first = await generateHomebrewFormula(input);
  assert.deepEqual(await generateHomebrewFormula(input), first);
  assert.equal(first.sha256, digest(first.contents));
  assert.equal(first.size, Buffer.byteLength(first.contents));
  for (const [arch, block] of [['arm64', 'on_arm'], ['x64', 'on_intel']]) {
    const record = input.descriptor.files.find(file => file.filename.includes(`-${arch}.`));
    assert.ok(first.contents.includes(`${block} do\n      url "https://github.com/urmich/ai-sdlc-framework/releases/download/v0.3.0/${record.filename}"\n      sha256 "${record.sha256}"`));
  }
  assert.match(first.contents, /depends_on "node@22"/u);
  assert.match(first.contents, /libexec.install Dir\["\*"\]/u);
  assert.match(first.contents, /skip_clean "libexec"/u);
  assert.match(first.contents, /cp libexec\/"LICENSE", prefix\/"LICENSE"/u);
  assert.match(first.contents, /write_env_script libexec\/"bin\/sdlc", PATH: "#\{formula_opt_bin\("node@22"\)\}:\$PATH"/u);
  const install = first.contents.split('  def install\n')[1].split('  end\n')[0];
  assert.doesNotMatch(install, /COPILOT_HOME|system|purge|uninstall/u);
  assert.doesNotMatch(first.contents, /def (post_install|uninstall)|latest|--overwrite/u);
});

test('T-51 Homebrew rejects missing, swapped, corrupt, stale and ambiguous metadata before output', async t => {
  const input = await fixture(t);
  const mutated = change => {
    const descriptor = structuredClone(input.descriptor);
    change(descriptor);
    return generateHomebrewFormula({ ...input, descriptor });
  };
  await assert.rejects(mutated(d => d.files.pop()), /Missing macOS/u);
  await assert.rejects(mutated(d => d.files.push(d.files[0])), /duplicate/u);
  await assert.rejects(mutated(d => { d.files[0].sha256 = d.files[1].sha256; }), /checksum/u);
  await assert.rejects(mutated(d => { d.files[0].size++; }), /checksum or size/u);
  await assert.rejects(mutated(d => { d.version = '0.4.0'; }), /Invalid versioned/u);
  await assert.rejects(mutated(d => { d.files[0].filename = '../archive.tar.gz'; }), /Invalid/u);
  await assert.rejects(mutated(d => { d.sourceCommit = 'main'; }), /Invalid/u);
  await assert.rejects(mutated(d => { d.files[0].sha256 = ''; }), /Invalid/u);
  await assert.rejects(generateHomebrewFormula({ ...input, artifactDirectory: undefined }), /directory/u);
  const file = path.join(input.root, input.descriptor.files[0].filename);
  await fs.appendFile(file, 'corruption');
  await assert.rejects(generateHomebrewFormula(input), /checksum or size/u);
});

test('T-51 prereleases only produce explicit local test formulas, never stable metadata', async t => {
  const input = await fixture(t, '0.4.0-rc.1');
  await assert.rejects(generateHomebrewFormula(input), /Prereleases/u);
  const formula = await generateHomebrewFormula({
    ...input, mode: 'candidate', candidateBaseUrl: 'http://127.0.0.1:8123/',
  });
  assert.match(formula.contents, /^# Test-only local candidate/u);
  assert.match(formula.contents, /version "0.4.0-rc.1"/u);
  assert.match(formula.contents, /url "http:\/\/127.0.0.1:8123\/ai-sdlc-framework-0.4.0-rc.1-macos-arm64.tar.gz"/u);
  assert.doesNotMatch(formula.contents, /releases\/download/u);
  for (const candidateBaseUrl of ['https://example.com:8123/', 'http://127.0.0.1/',
    'http://127.0.0.1:8123/no-trailing-slash', 'http://user@127.0.0.1:8123/',
    'http://127.0.0.1:8123/?token=x', 'http://127.0.0.1:8123/%22/']) {
    await assert.rejects(generateHomebrewFormula({ ...input, mode: 'candidate', candidateBaseUrl }), /loopback/u);
  }
  const stable = await fixture(t);
  await assert.rejects(generateHomebrewFormula({ ...stable,
    candidateBaseUrl: 'http://127.0.0.1:8123/' }), /Stable metadata/u);
});

async function links(t, initial = 'absent', behavior = {}) {
  const { root } = await fixture(t);
  const prefix = path.join(root, 'brew prefix');
  const destination = path.join(prefix, 'bin', 'sdlc');
  const newKeg = path.join(prefix, 'Cellar', 'ai-sdlc-framework', '0.4.0');
  const previousKeg = path.join(prefix, 'Cellar', 'previous-sdlc', '0.3.0');
  await fs.mkdir(path.dirname(destination), { recursive: true });
  for (const keg of [newKeg, previousKeg]) {
    await fs.mkdir(path.join(keg, 'bin'), { recursive: true });
    await fs.writeFile(path.join(keg, 'bin', 'sdlc'), '#!/bin/sh\n');
  }
  const target = keg => path.relative(path.dirname(destination), path.join(keg, 'bin', 'sdlc'));
  if (initial === 'old') await fs.symlink(target(previousKeg), destination);
  if (initial === 'new') await fs.symlink(target(newKeg), destination);
  if (initial === 'file') await fs.writeFile(destination, 'unrelated');
  if (initial === 'npm') await fs.symlink('../lib/node_modules/ai-sdlc-framework/bin/sdlc.mjs', destination);
  const calls = [];
  const formula = 'local/candidate/ai-sdlc-framework';
  const previousFormula = 'local/previous/previous-sdlc';
  const runBrew = async args => {
    calls.push(args);
    if (behavior.intercept && await behavior.intercept(args, { destination })) return;
    const [command, name] = args;
    if (command === 'unlink') await fs.unlink(destination);
    else if (command === 'link') {
      if (behavior.failNewLink && name === formula) throw new Error('simulated link failure');
      await fs.symlink(target(name === formula ? newKeg : previousKeg), destination);
    } else throw new Error(`Unexpected brew command: ${args}`);
  };
  return { prefix, newKeg, previousKeg, formula, previousFormula, destination,
    target, calls, runBrew };
}

test('T-51 channel promotion supports absent npm destination and proven old Homebrew link', async t => {
  for (const initial of ['absent', 'old', 'new']) {
    const input = await links(t, initial);
    const result = await promoteHomebrewLink(input);
    assert.equal(result.linked, true);
    assert.equal(await fs.readlink(input.destination), input.target(input.newKeg));
    await fs.access(path.join(input.previousKeg, 'bin', 'sdlc'));
    assert.deepEqual(input.calls, initial === 'new' ? [] : [
      ...(initial === 'old' ? [['unlink', input.previousFormula]] : []),
      ['link', input.formula],
    ]);
  }
});

test('T-51 unidentified files and legacy global npm links are never replaced', async t => {
  for (const initial of ['file', 'npm']) {
    const input = await links(t, initial);
    await assert.rejects(promoteHomebrewLink(input), /Unidentified/u);
    assert.deepEqual(input.calls, []);
    if (initial === 'file') assert.equal(await fs.readFile(input.destination, 'utf8'), 'unrelated');
    else assert.equal(await fs.readlink(input.destination), '../lib/node_modules/ai-sdlc-framework/bin/sdlc.mjs');
  }
  const input = await links(t, 'old');
  await assert.rejects(promoteHomebrewLink({ ...input, previousFormula: undefined }), /Unidentified/u);
  assert.deepEqual(input.calls, []);
});

test('T-51 failed promotion restores captured owned link and retains both payloads', async t => {
  const input = await links(t, 'old', { failNewLink: true });
  await assert.rejects(promoteHomebrewLink(input), /old link restored.*Both packages/u);
  assert.equal(await fs.readlink(input.destination), input.target(input.previousKeg));
  for (const keg of [input.newKeg, input.previousKeg]) await fs.access(path.join(keg, 'bin', 'sdlc'));
  assert.deepEqual(input.calls.map(call => call[0]), ['unlink', 'link', 'link']);
});

test('T-51 unlink failure leaves old link; racing unidentified link is not deleted for rollback', async t => {
  const unchanged = await links(t, 'old', {
    intercept: async ([command]) => { if (command === 'unlink') throw new Error('cannot unlink'); },
  });
  await assert.rejects(promoteHomebrewLink(unchanged), /old link retained/u);
  assert.equal(await fs.readlink(unchanged.destination), unchanged.target(unchanged.previousKeg));
  const raced = await links(t, 'old', {
    intercept: async ([command], { destination }) => {
      if (command === 'link') {
        await fs.writeFile(destination, 'unrelated arrival');
        throw new Error('destination appeared');
      }
    },
  });
  await assert.rejects(promoteHomebrewLink(raced), /unidentified destination retained/u);
  assert.equal(await fs.readFile(raced.destination, 'utf8'), 'unrelated arrival');
  assert.deepEqual(raced.calls.map(call => call[0]), ['unlink', 'link']);
});

test('T-51 partially successful new linking is undone before restoring the captured old link', async t => {
  let failed = false;
  const input = await links(t, 'old', {
    intercept: async ([command, formula], { destination }) => {
      if (!failed && command === 'link' && formula.endsWith('/ai-sdlc-framework')) {
        failed = true;
        await fs.symlink('../Cellar/ai-sdlc-framework/0.4.0/bin/sdlc', destination);
        throw new Error('partially linked new keg');
      }
    },
  });
  await assert.rejects(promoteHomebrewLink(input), /old link restored/u);
  assert.equal(await fs.readlink(input.destination), input.target(input.previousKeg));
  assert.deepEqual(input.calls.map(call => call[0]), ['unlink', 'link', 'unlink', 'link']);
});

test('T-51 formula arguments cannot be interpreted as brew options or paths', async () => {
  const run = () => assert.fail('Invalid formula must fail before executing brew');
  for (const formula of ['--overwrite', '.', '../escape', '/absolute', 'owner/tap', '-owner/tap/pkg']) {
    await assert.rejects(switchToHomebrew({ formula, run }), /Invalid Homebrew formula/u);
  }
  await assert.rejects(switchToHomebrew({ previousFormula: '--force', run }), /Invalid Homebrew formula/u);
});
