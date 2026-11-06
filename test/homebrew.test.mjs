export const validationDeclarations = {
  "schemaVersion": 1,
  "applicability": [
    {"names": ["T-PRD041 public Homebrew formula verification requires the independently frozen destination"], "platforms": ["linux-x64", "windows-x64", "macos-arm64", "macos-x64"], "owner": "release-consumer", "reason": "PR-only TOOL04 destination-authority and exact published-byte regression; local data-only formula fixtures, no brew/network or critical-profile growth.", "prerequisites": ["Node >=22", "Owned repository-local formula fixtures"]},
    {"options": "nativeMac", "platforms": ["macos-arm64", "macos-x64"], "owner": "maintainer", "reason": "Native Mac link promotion and rollback cannot be credited from Windows simulation.", "prerequisites": ["Native Mac Node", "Owned package-manager prefix"]}
  ],
  "surfaces": [{"coverage": "direct", "paths": ["packaging/homebrew/generate-formula.mjs", "scripts/homebrew-switch.mjs", "scripts/homebrew-lifecycle.mjs"]}],
  "plannedCases": [{"id": "T-PRD041", "selectors": [
    {"name": "T-PRD041 public Homebrew formula verification requires the independently frozen destination", "parents": []}
  ]}],
  "groups": [{"root": "T-PRD041 public Homebrew formula verification requires the independently frozen destination",
    "dependsOn": [], "minimumSlots": 1, "exclusiveResources": []}]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { generateHomebrewFormula } from '../packaging/homebrew/generate-formula.mjs';
import { promoteHomebrewLink, switchToHomebrew } from '../scripts/homebrew-switch.mjs';
import { validateInitialHomebrewFormula } from '../scripts/release-bundle.mjs';
import { publicHomebrewFormula } from '../scripts/homebrew-lifecycle.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const nativeMac = { skip: process.platform !== 'darwin' };

async function fixture(t, version = '0.3.0', shared = false) {
  const root = path.resolve('.test-data', `homebrew-${randomUUID()}`);
  await fs.mkdir(root, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const files = [];
  for (const arch of shared ? ['shared'] : ['x64', 'arm64']) {
    const filename = `ai-sdlc-framework-${version}-macos${shared ? '' : `-${arch}`}.tar.gz`;
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

test('T-PRD041 public Homebrew formula verification requires the independently frozen destination', async t => {
  const previousRepository = 'PreviousOwner/prior-releases';
  const currentRepository = 'ApprovedOwner/public-releases';
  const inputs = [];
  for (const [version, repository] of [['0.4.0', previousRepository], ['0.5.0', currentRepository],
    ['0.6.0', 'UrMiCh/AI-SDLC-Framework']]) {
    const input = await fixture(t, version, true);
    const generated = await generateHomebrewFormula(input);
    const contents = generated.contents.replaceAll('https://github.com/urmich/ai-sdlc-framework/releases/download/',
      `https://github.com/${repository}/releases/download/`);
    const record = { filename: 'ai-sdlc-framework.rb', kind: 'homebrew', sha256: digest(contents),
      size: Buffer.byteLength(contents) };
    input.descriptor.files.push(record);
    await fs.writeFile(path.join(input.root, record.filename), contents);
    const descriptorBefore = JSON.stringify(input.descriptor);
    const verified = await publicHomebrewFormula(input.root, input.descriptor, repository);
    assert.equal(verified.contents, contents);
    assert.equal(verified.sha256, record.sha256);
    assert.equal(JSON.stringify(input.descriptor), descriptorBefore);
    assert.equal(await fs.readFile(path.join(input.root, record.filename), 'utf8'), contents);
    await assert.rejects(publicHomebrewFormula(input.root, input.descriptor), { code: 'RELEASE_INTEGRATION_BLOCKED' });
    await assert.rejects(publicHomebrewFormula(input.root, input.descriptor, 'https://github.com/other/release'),
      /approved.*repository|destination/iu);
    await assert.rejects(publicHomebrewFormula(input.root, input.descriptor,
      repository === previousRepository ? currentRepository : previousRepository), /exact public archive URLs/u);
    const wrongSource = structuredClone(input.descriptor);
    wrongSource.files[0].filename = `ai-sdlc-framework-${version}-linux-x64.tar.gz`;
    await assert.rejects(publicHomebrewFormula(input.root, wrongSource, repository), /exact public archive URLs/u);
    const wrongVersion = { ...input.descriptor, version: '9.0.0' };
    await assert.rejects(publicHomebrewFormula(input.root, wrongVersion, repository), /exact public archive URLs/u);
    await fs.appendFile(path.join(input.root, record.filename), '\n');
    await assert.rejects(publicHomebrewFormula(input.root, input.descriptor, repository));
    await fs.writeFile(path.join(input.root, record.filename), contents.replace('class AiSdlcFramework', 'class AiSdlcFrameworX'));
    await assert.rejects(publicHomebrewFormula(input.root, input.descriptor, repository), /bytes differ/u);
    inputs.push({ input, repository });
  }
  await assert.rejects(publicHomebrewFormula(inputs[0].input.root, inputs[0].input.descriptor, currentRepository));
});

test('T-PRD061 shared Mac metadata has one verified URL/hash and native Node dependency for both consumers', async t => {
  const input = await fixture(t, '0.5.0', true);
  const formula = await generateHomebrewFormula(input);
  assert.deepEqual(await generateHomebrewFormula({ ...input, architectures: ['x64', 'arm64'] }), formula);
  const record = input.descriptor.files[0];
  assert.deepEqual([...formula.contents.matchAll(/^\s*url "([^"]+)"/gmu)].map(match => match[1]),
    [`https://github.com/urmich/ai-sdlc-framework/releases/download/v0.5.0/${record.filename}`]);
  assert.deepEqual([...formula.contents.matchAll(/^\s*sha256 "([^"]+)"/gmu)].map(match => match[1]), [record.sha256]);
  assert.doesNotMatch(formula.contents, /on_arm|on_intel|macos-(?:arm64|x64)|depends_on arch:/u);
  assert.match(formula.contents, /^  depends_on "node@24"$/mu);
  assert.match(formula.contents, /SDLC_NODE: "#\{formula_opt_bin\("node@24"\)\}\/node"/u);
  const validated = validateInitialHomebrewFormula({ descriptor: input.descriptor,
    repository: 'urmich/ai-sdlc-framework', contents: formula.contents });
  assert.deepEqual(validated.nodeDependency, {
    validation: 'Passed', formula: 'node@24', major: 24, scope: 'runtime', conditional: false,
  });
  assert.throws(() => validateInitialHomebrewFormula({ descriptor: input.descriptor,
    repository: 'urmich/ai-sdlc-framework', contents: formula.contents.replaceAll('node@24', 'node@22') }),
  /Node dependency contract mismatch/u);
  assert.equal(formula.sha256, digest(formula.contents));
  for (const arch of ['arm64', 'x64']) {
    const candidate = await generateHomebrewFormula({ ...input, mode: 'candidate', architectures: [arch],
      candidateBaseUrl: 'http://127.0.0.1:8123/' });
    assert.deepEqual([...candidate.contents.matchAll(/^\s*url "([^"]+)"/gmu)].map(match => match[1]),
      [`http://127.0.0.1:8123/${record.filename}`]);
    assert.deepEqual([...candidate.contents.matchAll(/^\s*sha256 "([^"]+)"/gmu)].map(match => match[1]), [record.sha256]);
    assert.match(candidate.contents, /^  depends_on "node@24"$/mu);
  }
  await fs.appendFile(path.join(input.root, record.filename), 'modified');
  await assert.rejects(generateHomebrewFormula(input), /checksum or size/u);
});

test('T-PRD061 shared formula rejects stale CPU assets and missing archives rather than selecting another URL', async t => {
  const input = await fixture(t, '0.5.0', true);
  const descriptor = structuredClone(input.descriptor);
  descriptor.files.push({ ...descriptor.files[0], filename: 'ai-sdlc-framework-0.5.0-macos-arm64.tar.gz' });
  await assert.rejects(generateHomebrewFormula({ ...input, descriptor }), /architecture-specific/u);
  await fs.unlink(path.join(input.root, input.descriptor.files[0].filename));
  await assert.rejects(generateHomebrewFormula(input), { code: 'ENOENT' });
});

test('T-51 stable Homebrew metadata deterministically binds both architectures and lifecycle ownership', async t => {
  const input = await fixture(t);
  const first = await generateHomebrewFormula(input);
  assert.deepEqual(await generateHomebrewFormula(input), first);
  assert.equal(first.sha256, digest(first.contents));
  assert.equal(first.size, Buffer.byteLength(first.contents));
  for (const [arch, block] of [['arm64', 'on_arm'], ['x64', 'on_intel']]) {
    const record = input.descriptor.files.find(file => file.filename.includes(`-${arch}.`));
    assert.ok(first.contents.includes(`${block} do\n      url "https://github.com/urmich/ai-sdlc-framework/releases/download/v0.3.0/${record.filename}"\n      sha256 "${record.sha256}"`));
  }
  assert.deepEqual(await generateHomebrewFormula({ ...input, architectures: ['x64', 'arm64'] }), first);
  assert.doesNotMatch(first.contents, /depends_on arch:/u);
  assert.match(first.contents, /depends_on "node@24"/u);
  assert.match(first.contents, /libexec.install Dir\["\*"\]/u);
  assert.match(first.contents, /skip_clean "libexec"/u);
  assert.match(first.contents, /cp libexec\/"LICENSE", prefix\/"LICENSE"/u);
  assert.match(first.contents, /write_env_script libexec\/"bin\/sdlc",\n\s+PATH: +"#\{formula_opt_bin\("node@24"\)\}:\$PATH"/u);
  assert.match(first.contents, /SDLC_NODE: "#\{formula_opt_bin\("node@24"\)\}\/node"/u);
  const install = first.contents.split('  def install\n')[1].split('  end\n')[0];
  assert.doesNotMatch(install, /COPILOT_HOME|system|purge|uninstall/u);
  assert.doesNotMatch(first.contents, /def (post_install|uninstall)|latest|--overwrite/u);
  for (const architectures of [['x64'], ['arm64']]) {
    await assert.rejects(generateHomebrewFormula({ ...input, architectures }), /requires both arm64 and x64/u);
  }
  const intel = input.descriptor.files.find(file => file.filename.includes('-x64.'));
  await fs.unlink(path.join(input.root, intel.filename));
  await assert.rejects(generateHomebrewFormula(input), { code: 'ENOENT' });
  input.descriptor.files = input.descriptor.files.filter(file => file !== intel);
  await assert.rejects(generateHomebrewFormula(input), /Missing macOS x64/u);
});

test('T-51 local candidate formulas support host-only and dual-architecture testing', async t => {
  const input = await fixture(t);
  const options = { ...input, mode: 'candidate', candidateBaseUrl: 'http://127.0.0.1:8123/',
    architectures: ['arm64', 'x64'] };
  const formula = await generateHomebrewFormula(options);
  assert.deepEqual(await generateHomebrewFormula({ ...options, architectures: ['x64', 'arm64'] }), formula);
  for (const [arch, block] of [['arm64', 'on_arm'], ['x64', 'on_intel']]) {
    const record = input.descriptor.files.find(file => file.filename.includes(`-${arch}.`));
    assert.ok(formula.contents.includes(`${block} do\n      url "http://127.0.0.1:8123/${record.filename}"`));
    assert.ok(formula.contents.includes(`sha256 "${record.sha256}"`));
  }
  const intel = await generateHomebrewFormula({ ...options, architectures: ['x64'] });
  assert.match(intel.contents, /depends_on arch: :x86_64/u);
  assert.doesNotMatch(intel.contents, /macos-arm64/u);
  for (const architectures of [[], ['arm64', 'arm64'], ['riscv64']]) {
    await assert.rejects(generateHomebrewFormula({ ...options, architectures }), /unique supported/u);
  }
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
  await assert.rejects(mutated(d => { d.files[1].sha256 = d.files[0].sha256; }), /checksum/u);
  await assert.rejects(mutated(d => { d.files[1].size++; }), /checksum or size/u);
  await assert.rejects(mutated(d => { d.version = '0.4.0'; }), /Invalid versioned/u);
  await assert.rejects(mutated(d => { d.files[0].filename = '../archive.tar.gz'; }), /Invalid/u);
  await assert.rejects(mutated(d => { d.sourceCommit = 'main'; }), /Invalid/u);
  await assert.rejects(mutated(d => { d.files[0].sha256 = ''; }), /Invalid/u);
  await assert.rejects(generateHomebrewFormula({ ...input, artifactDirectory: undefined }), /directory/u);
  const file = path.join(input.root, input.descriptor.files[1].filename);
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

test('T-51 channel promotion supports absent npm destination and proven old Homebrew link', nativeMac, async t => {
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

test('T-51 unidentified files and legacy global npm links are never replaced', nativeMac, async t => {
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

test('T-51 failed promotion restores captured owned link and retains both payloads', nativeMac, async t => {
  const input = await links(t, 'old', { failNewLink: true });
  await assert.rejects(promoteHomebrewLink(input), /old link restored.*Both packages/u);
  assert.equal(await fs.readlink(input.destination), input.target(input.previousKeg));
  for (const keg of [input.newKeg, input.previousKeg]) await fs.access(path.join(keg, 'bin', 'sdlc'));
  assert.deepEqual(input.calls.map(call => call[0]), ['unlink', 'link']);
});

test('T-51 unlink failure leaves old link; racing unidentified link is not deleted for rollback', nativeMac, async t => {
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

test('T-51 partially successful new linking is undone before restoring the captured old link', nativeMac, async t => {
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
  assert.deepEqual(input.calls.map(call => call[0]), ['unlink', 'link', 'unlink']);
});

test('T-51 formula arguments cannot be interpreted as brew options or paths', async () => {
  const run = () => assert.fail('Invalid formula must fail before executing brew');
  for (const formula of ['--overwrite', '.', '../escape', '/absolute', 'owner/tap', '-owner/tap/pkg']) {
    await assert.rejects(switchToHomebrew({ formula, run }), /Invalid Homebrew formula/u);
  }
  await assert.rejects(switchToHomebrew({ previousFormula: '--force', run }), /Invalid Homebrew formula/u);
});
