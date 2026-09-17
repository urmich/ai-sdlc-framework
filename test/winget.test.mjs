import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { generateManifests, manifestContext, renderManifests, PACKAGE_IDENTIFIER, TEST_PACKAGE_IDENTIFIER } from '../packaging/winget/generate.mjs';
import { validateManifests } from '../packaging/winget/validate.mjs';
import { launcherBuildEnvironment, TOOLCHAIN } from '../packaging/winget/build-launcher.mjs';
import { isNewerVersion, requireNativeWindows } from '../packaging/winget/smoke.mjs';

const base = {
  version: '0.3.0', releaseRepository: 'example/public-releases',
  archive: { filename: 'ai-sdlc-framework-0.3.0-windows-x64.zip', sha256: 'a'.repeat(64), size: 123 },
};

async function fixture(t, version = '0.3.0') {
  const root = path.resolve('.test-data', `winget-${randomUUID()}`);
  await fs.mkdir(root, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  // Header fixture is sufficient here: complete inventory verification belongs
  // to verify-platform-package; these tests bind the supplied outer ZIP bytes.
  const bytes = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.from('test archive')]);
  const filename = `ai-sdlc-framework-${version}-windows-x64.zip`;
  const archivePath = path.join(root, filename);
  await fs.writeFile(archivePath, bytes);
  return {
    root, outputDir: path.join(root, 'manifests'), archivePath, version,
    releaseRepository: base.releaseRepository,
    archive: { filename, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length },
  };
}

test('T-51 WinGet stable manifests bind version, public URL, x64 archive and portable ownership', async t => {
  const options = await fixture(t);
  const result = await generateManifests(options);
  const second = await generateManifests({ ...options, outputDir: path.join(options.root, 'second') });
  assert.deepEqual(result.files.map(({ artifact, ...file }) => file), second.files.map(({ artifact, ...file }) => file));
  assert.equal(result.packageIdentifier, PACKAGE_IDENTIFIER);
  assert.equal(result.communityAccepted, false);
  assert.equal(result.clientAvailable, false);
  assert.equal(result.testOnly, false);
  assert.deepEqual(result.files.map(file => file.filename), [
    `${PACKAGE_IDENTIFIER}.installer.yaml`, `${PACKAGE_IDENTIFIER}.locale.en-US.yaml`, `${PACKAGE_IDENTIFIER}.yaml`,
  ]);
  for (const file of result.files) {
    const bytes = await fs.readFile(file.artifact);
    assert.equal(bytes.length, file.size);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
    assert.equal(file.kind, 'winget');
    assert.ok(!bytes.includes(13), 'manifests use LF only');
  }
  const installer = await fs.readFile(result.files[0].artifact, 'utf8');
  for (const contract of [
    'InstallerType: zip', 'NestedInstallerType: portable', 'RelativeFilePath: bin\\sdlc.exe',
    'PortableCommandAlias: "sdlc"', 'Scope: user', 'UpgradeBehavior: install',
    'PackageIdentifier: OpenJS.NodeJS.LTS', 'MinimumVersion: 22.0.0', 'Architecture: x64',
    `InstallerSha256: "${options.archive.sha256.toUpperCase()}"`,
    `https://github.com/example/public-releases/releases/download/v0.3.0/${options.archive.filename}`,
  ]) assert.ok(installer.includes(contract), contract);
  assert.doesNotMatch(installer, /InstallerSwitches|UninstallString|uninstall --purge|install\.ps1|\.cmd|ProductCode|DefaultInstallLocation/u);
  const verified = await validateManifests({ ...options, manifestDir: options.outputDir });
  assert.equal(verified.contractValidation, 'Passed');
  assert.equal(verified.nativeValidation, 'NotRun');
  assert.equal(verified.status, 'contract-validated');
  assert.equal(verified.publicationEligible, false);
});

test('T-51 WinGet validation rejects stale and unsafe metadata without modifying the candidate', async t => {
  const options = await fixture(t);
  await generateManifests(options);
  const installer = path.join(options.outputDir, `${PACKAGE_IDENTIFIER}.installer.yaml`);
  const good = await fs.readFile(installer, 'utf8');
  for (const [name, mutate] of [
    ['version', value => value.replace('PackageVersion: "0.3.0"', 'PackageVersion: "0.2.0"')],
    ['URL', value => value.replace('/download/v0.3.0/', '/download/v0.2.0/')],
    ['digest', value => value.replace(options.archive.sha256.toUpperCase(), '0'.repeat(64))],
    ['architecture', value => value.replace('Architecture: x64', 'Architecture: arm64')],
    ['Node prerequisite', value => value.replace('MinimumVersion: 22.0.0', 'MinimumVersion: 21.0.0')],
    ['Node dependency', value => value.replace('OpenJS.NodeJS.LTS', 'Wrong.Dependency')],
    ['portable target', value => value.replace('bin\\sdlc.exe', 'bin\\sdlc.cmd')],
    ['upgrade', value => value.replace('UpgradeBehavior: install', 'UpgradeBehavior: uninstallPrevious')],
    ['ownership', value => value.replace('Scope: user', 'Scope: machine')],
    ['uninstall command', value => `${value}UninstallString: sdlc uninstall --purge\n`],
    ['ARP ownership', value => `${value}ProductCode: attacker\n`],
    ['missing dependency', value => value.replace(/Dependencies:[\s\S]*?Installers:/u, 'Installers:')],
    ['duplicate key', value => `${value}InstallerType: exe\n`],
    ['line endings', value => value.replaceAll('\n', '\r\n')],
  ]) {
    await fs.writeFile(installer, mutate(good));
    await assert.rejects(validateManifests({ ...options, manifestDir: options.outputDir }), /contract mismatch/u, name);
  }
  await fs.writeFile(installer, good);
  await fs.writeFile(path.join(options.outputDir, 'extra.yaml'), 'extra');
  await assert.rejects(validateManifests({ ...options, manifestDir: options.outputDir }), /missing, extra/u);
  await fs.unlink(path.join(options.outputDir, 'extra.yaml'));
  await fs.unlink(path.join(options.outputDir, `${PACKAGE_IDENTIFIER}.yaml`));
  await assert.rejects(validateManifests({ ...options, manifestDir: options.outputDir }), /missing, extra/u);
});

test('T-51 WinGet input and archive integrity fail closed', async t => {
  for (const options of [
    { ...base, version: 'v0.3.0' },
    { ...base, version: '../0.3.0' },
    { ...base, version: '0.03.0' },
    { ...base, version: '0.3.0-01' },
    { ...base, version: '0.3.0\nInstallerType: exe' },
    { ...base, archive: { ...base.archive, filename: 'ai-sdlc-framework-0.2.0-windows-x64.zip' } },
    { ...base, archive: { ...base.archive, filename: 'ai-sdlc-framework-0.3.0-windows-arm64.zip' } },
    { ...base, archive: { ...base.archive, sha256: 'bad' } },
    { ...base, archive: { ...base.archive, size: 0 } },
    { ...base, archive: { ...base.archive, kind: 'metadata' } },
    { ...base, releaseRepository: undefined },
    { ...base, releaseRepository: 'https://github.com/private/repo' },
    { ...base, releaseRepository: 'owner/../repo' },
    { ...base, candidateUrl: 'http://127.0.0.1:8080/candidate.zip' },
    { ...base, testOnly: 'false' },
  ]) assert.throws(() => renderManifests(options), /WinGet|testOnly|Stable/u);
  const options = await fixture(t);
  await generateManifests(options);
  const original = await fs.readFile(options.archivePath);
  await fs.appendFile(options.archivePath, 'corruption');
  await assert.rejects(validateManifests({ ...options, manifestDir: options.outputDir }), /recorded size/u);
  await fs.writeFile(options.archivePath, Buffer.alloc(original.length));
  await assert.rejects(validateManifests({ ...options, manifestDir: options.outputDir }), /SHA-256/u);
  const notZip = Buffer.alloc(original.length);
  await assert.rejects(validateManifests({ ...options, archive: { ...options.archive,
    sha256: createHash('sha256').update(notZip).digest('hex') }, manifestDir: options.outputDir }), /contract mismatch/u);
  await assert.rejects(generateManifests({ ...options, archive: { ...options.archive,
    sha256: createHash('sha256').update(notZip).digest('hex') } }), /not a nonempty ZIP/u);
});

test('T-51 prerelease manifests are explicit isolated test candidates, never stable metadata', async t => {
  const options = await fixture(t, '0.4.0-rc.1');
  await assert.rejects(generateManifests(options), /Prereleases/u);
  const local = { ...options, testOnly: true,
    candidateUrl: `http://127.0.0.1:8765/${options.archive.filename}` };
  const result = await generateManifests(local);
  assert.equal(result.packageIdentifier, TEST_PACKAGE_IDENTIFIER);
  assert.equal(result.publicationEligible, false);
  assert.equal(result.testOnly, true);
  for (const file of result.files) {
    const content = await fs.readFile(file.artifact, 'utf8');
    assert.match(content, /TEST-ONLY LOCAL CANDIDATE; NOT FOR SUBMISSION OR RELEASE/u);
    assert.match(content, /Urmich\.AISDLCFramework\.Test/u);
  }
  const installer = await fs.readFile(result.files[0].artifact, 'utf8');
  assert.match(installer, /PortableCommandAlias: "sdlc-test"/u);
  assert.ok(installer.includes(local.candidateUrl));
  const validated = await validateManifests({ ...local, manifestDir: local.outputDir });
  assert.equal(validated.status, 'test-only');
  assert.equal(validated.publicationEligible, false);
  for (const candidateUrl of [undefined, 'file:///C:/candidate.zip',
    `https://github.com/owner/repo/${options.archive.filename}`,
    `http://127.0.0.1/${options.archive.filename}`, 'http://127.0.0.1:8765/wrong.zip',
    `${local.candidateUrl}?token=secret`, `${local.candidateUrl}#fragment`,
    `http://user:password@127.0.0.1:8765/${options.archive.filename}`,
    `http://127.0.0.1.evil.example:8765/${options.archive.filename}`]) {
    assert.throws(() => manifestContext({ ...local, candidateUrl }), /candidate|loopback/u);
  }
  const stableOptions = await fixture(t);
  const stable = await generateManifests(stableOptions);
  await assert.rejects(generateManifests({ ...local, outputDir: stableOptions.outputDir }), /owned manifest set/u);
  assert.equal(await fs.readFile(stable.files[0].artifact, 'utf8'), renderManifests(stableOptions)[0].content);
});

test('T-51 WinGet output refuses unrelated files and symbolic links', async t => {
  const options = await fixture(t);
  await fs.mkdir(options.outputDir);
  await fs.writeFile(path.join(options.outputDir, 'unrelated.txt'), 'keep');
  await assert.rejects(generateManifests(options), /owned manifest set/u);
  assert.equal(await fs.readFile(path.join(options.outputDir, 'unrelated.txt'), 'utf8'), 'keep');
  await fs.unlink(path.join(options.outputDir, 'unrelated.txt'));
  const target = path.join(options.root, 'unrelated.yaml');
  await fs.writeFile(target, 'keep');
  try {
    await fs.symlink(target, path.join(options.outputDir, `${PACKAGE_IDENTIFIER}.yaml`));
  } catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') return;
    throw error;
  }
  await assert.rejects(generateManifests(options), /owned manifest set/u);
  await assert.rejects(validateManifests({ ...options, manifestDir: options.outputDir }), /non-regular/u);
  assert.equal(await fs.readFile(target, 'utf8'), 'keep');
});

test('T-51 launcher toolchain contract overrides ambient build variation', async () => {
  assert.equal(TOOLCHAIN.goVersion, 'go1.27.1');
  assert.deepEqual(TOOLCHAIN.flags, ['-trimpath', '-buildvcs=false', '-ldflags=-buildid=']);
  const environment = launcherBuildEnvironment({
    PATH: 'preserved', CGO_ENABLED: '1', GOOS: 'linux', GOARCH: 'arm64', GOAMD64: 'v4',
    GOFLAGS: '-race', GOTOOLCHAIN: 'auto', GOENV: 'host-settings', GOEXPERIMENT: 'ambient',
    GOROOT: '/unrelated/toolchain', GOCACHE: '/unrelated/cache', goos: 'freebsd',
    GOCACHEPROG: 'untrusted-cache', gocacheprog: 'lowercase-cache', gOcAcHePrOg: 'mixed-case-cache',
  });
  assert.equal(environment.PATH, 'preserved');
  assert.equal(environment.GOARCH, 'amd64');
  assert.equal(environment.GOOS, 'windows');
  assert.equal(environment.CGO_ENABLED, '0');
  assert.equal(environment.GOAMD64, 'v1');
  assert.equal(environment.GOFLAGS, '');
  assert.equal(environment.GOEXPERIMENT, '');
  assert.equal(environment.GOTOOLCHAIN, 'local');
  assert.equal(environment.GOENV, 'off');
  assert.equal(environment.GOPROXY, 'off');
  assert.equal(environment.GOWORK, 'off');
  assert.equal(environment.GOROOT, undefined);
  assert.equal(environment.GOCACHE, undefined);
  assert.equal(environment.goos, undefined);
  for (const key of Object.keys(environment)) assert.notEqual(key.toUpperCase(), 'GOCACHEPROG');
  const goModule = await fs.readFile('cmd/sdlc-launcher/go.mod', 'utf8');
  assert.ok(goModule.includes(`go ${TOOLCHAIN.goVersion.slice(2)}`));
});

test('T-52 local-only validation never claims community acceptance or public availability', async t => {
  const options = await fixture(t);
  await generateManifests(options);
  const result = await validateManifests({ ...options, manifestDir: options.outputDir });
  assert.equal(result.communityAccepted, false);
  assert.equal(result.clientAvailable, false);
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    await assert.rejects(validateManifests({ ...options, manifestDir: options.outputDir, native: true }),
      /actual Windows x64/u);
    assert.throws(() => requireNativeWindows({ PROCESSOR_ARCHITECTURE: 'AMD64' }), /native Windows x64/u);
  }
  assert.throws(() => requireNativeWindows({ PROCESSOR_ARCHITECTURE: 'ARM64' }), /not emulation/u);
});

test('T-51 WinGet smoke requires a real semantic upgrade, including prereleases', () => {
  for (const [previous, next, expected] of [
    ['0.3.0', '0.4.0', true], ['1.9.0', '1.10.0', true], ['1.0.0', '1.0.1', true],
    ['0.3.0', '0.3.0', false], ['1.0.0', '0.9.9', false], ['1.0.0+one', '1.0.0+two', false],
    ['1.0.0-rc.9', '1.0.0-rc.10', true], ['1.0.0-rc.1', '1.0.0', true],
    ['1.0.0', '1.0.0-rc.1', false], ['1.0.0-alpha', '1.0.0-beta', true],
    ['1.0.0-beta.1', '1.0.0-beta.1.extra', true], ['1.0.0-beta.1', '1.0.0-beta', false],
    ['1.0.0-1', '1.0.0-alpha', true], ['1.0.0-alpha', '1.0.0-1', false],
  ]) assert.equal(isNewerVersion(previous, next), expected, `${previous} -> ${next}`);
});
