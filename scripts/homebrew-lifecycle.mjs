import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateHomebrewFormula } from '../packaging/homebrew/generate-formula.mjs';
import { homebrewFormulaEvidence } from '../packaging/homebrew/evidence.mjs';
import { assertNativeMacHost, runHomebrewCommand, switchFromHomebrew, switchToHomebrew, verifyCopiedHomebrewInstallation } from './homebrew-switch.mjs';
import { assertConsumerUpdate, assertConsumerUninstall, installedConsumerSnapshot,
  seedConsumerPreservation } from './consumer-lifecycle.mjs';
import { verifyReleaseChecksums } from './verify-platform-package.mjs';
import { nativeToolchain, homebrewToolchain } from './toolchain-baseline.mjs';
import { verifyHomebrewPrefixOwnership } from './native-homebrew-prefix.mjs';

const execute = runHomebrewCommand;
const ROOT = fileURLToPath(new URL('../', import.meta.url));

async function snapshot(root, prefix = '') {
  const inventory = [];
  for (const name of (await fs.readdir(path.join(root, prefix))).sort()) {
    const relative = path.join(prefix, name);
    const full = path.join(root, relative);
    const stat = await fs.lstat(full);
    if (stat.isDirectory()) inventory.push(...await snapshot(root, relative));
    else inventory.push({ path: relative, mode: stat.mode & 0o777,
      content: stat.isSymbolicLink() ? await fs.readlink(full) :
        createHash('sha256').update(await fs.readFile(full)).digest('hex') });
  }
  return inventory;
}

export async function verifyHomebrewLifecycle({ brew, candidateDirectory, upgradeDirectory, root,
  targetArch = process.arch, mode = 'stable', expectedNodeVersion = nativeToolchain.node, expectedPreviousIdentity,
  expectedCurrentIdentity, environment: selectedEnvironment = process.env } = {}) {
  assert.equal(process.platform, 'darwin', 'Homebrew lifecycle requires native macOS');
  assert.ok(['arm64', 'x64'].includes(process.arch), 'Unsupported native architecture');
  assert.equal(process.arch, targetArch, 'Homebrew lifecycle must execute on its declared native architecture');
  assert.ok(['candidate', 'stable', 'public'].includes(mode), 'Unknown Homebrew lifecycle mode');
  assert.ok(brew && candidateDirectory, 'Provide the isolated brew executable and candidate directory');
  const { uname: host, translated } = await assertNativeMacHost();
  const scratchRoot = path.join(ROOT, '.test-data');
  const work = path.resolve(root ?? path.join(scratchRoot, `homebrew-lifecycle-${randomUUID()}`));
  const relative = path.relative(scratchRoot, work);
  assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
    'Lifecycle output must be a new child of this checkout’s .test-data');
  let parent = scratchRoot;
  for (const part of ['', ...path.relative(scratchRoot, path.dirname(work)).split(path.sep).filter(Boolean)]) {
    if (part) parent = path.join(parent, part);
    const stat = await fs.lstat(parent);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Homebrew lifecycle ancestors must be literal owned directories');
  }
  await fs.mkdir(work, { recursive: false });
  const evidence = { schemaVersion: 1, platform: process.platform, architecture: process.arch,
    node: process.version, uname: host, sysctlProcTranslated: translated,
    candidateDirectory: path.resolve(candidateDirectory), commands: [], formulas: {}, passed: false,
    publicAcceptance: 'NotRun', upgradeKind: upgradeDirectory ? 'version' : 'formula-revision', mode };
  const environment = { ...Object.fromEntries(Object.entries(selectedEnvironment).filter(([key]) =>
    !/token|credential|password|secret|auth|^npm_|^node_options$|^node_path$|^rubyopt$|^gem_|^bundle_/iu.test(key))),
    HOME: path.join(work, 'home'), COPILOT_HOME: path.join(work, 'copilot home'),
    HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_ANALYTICS: '1', HOMEBREW_DEVELOPER: '1',
    HOMEBREW_NO_INSTALL_CLEANUP: '1', HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK: '1',
    ...(selectedEnvironment.SDLC_HOMEBREW_PREFIX_PROOF ? { HOMEBREW_NO_INSTALL_FROM_API: '1' } : {}),
    HOMEBREW_CACHE: path.join(work, 'cache'), HOMEBREW_LOGS: path.join(work, 'logs'),
    HOMEBREW_TEMP: path.join(work, 'scratch'), TMPDIR: path.join(work, 'scratch'),
    npm_config_cache: path.join(work, 'npm-cache'), npm_config_offline: 'true',
    npm_config_registry: 'http://127.0.0.1:1', npm_config_audit: 'false',
    npm_config_fund: 'false', npm_config_update_notifier: 'false',
  };
  for (const key of ['NODE_AUTH_TOKEN', 'NPM_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN']) delete environment[key];
  for (const key of ['HOME', 'COPILOT_HOME', 'HOMEBREW_CACHE', 'HOMEBREW_LOGS', 'HOMEBREW_TEMP']) {
    await fs.mkdir(environment[key], { recursive: true });
  }
  let currentFormula;
  let formulaName;
  let formulaFile;
  const run = async (command, args, options = {}) => {
    const entry = { command, args };
    evidence.commands.push(entry);
    try {
      if (command === brew) {
        entry.noInstallCleanup = (options.env ?? environment).HOMEBREW_NO_INSTALL_CLEANUP;
        assert.equal(entry.noInstallCleanup, '1', 'Every brew operation must suppress install cleanup');
        if (currentFormula && args.some(arg => arg === formulaName || arg === formulaFile)) {
          const actual = await fs.readFile(formulaFile);
          assert.equal(createHash('sha256').update(actual).digest('hex'), currentFormula.sha256,
            'The formula used by brew differs from the saved run evidence');
          assert.equal(actual.length, currentFormula.size);
          entry.formula = { ...currentFormula };
        }
      }
      const channelOnly = command === brew && ['install', 'upgrade', 'uninstall', 'autoremove', 'tab', 'link', 'unlink'].includes(args[0]);
      const before = channelOnly ? await snapshot(environment.COPILOT_HOME) : undefined;
      const output = await execute(command, args,
        { maxBuffer: 16 * 1024 * 1024, ...options, env: options.env ?? environment });
      if (before) {
        const after = await snapshot(environment.COPILOT_HOME);
        entry.homeBeforeSha256 = createHash('sha256').update(JSON.stringify(before)).digest('hex');
        entry.homeAfterSha256 = createHash('sha256').update(JSON.stringify(after)).digest('hex');
        assert.deepEqual(after, before, `brew ${args[0]} changed COPILOT_HOME`);
      }
      Object.assign(entry, { success: true, ...output });
      return output;
    } catch (error) {
      Object.assign(entry, { success: false, stdout: error.stdout, stderr: error.stderr,
        error: error.message });
      throw error;
    }
  };
  const runBrew = args => run(brew, args);
  const json = async (command, args) => JSON.parse((await run(command, args)).stdout);
  let server;
  let tapRoot;
  let tap;
  const installed = new Set();
  try {
    const prefix = await fs.realpath((await runBrew(['--prefix'])).stdout.trim());
    const relativePrefix = path.relative(await fs.realpath(scratchRoot), prefix);
    const repository = await fs.realpath((await runBrew(['--repository'])).stdout.trim());
    if (relativePrefix && !relativePrefix.startsWith('..') && !path.isAbsolute(relativePrefix)) {
      const relativeRepository = path.relative(await fs.realpath(scratchRoot), repository);
      assert.ok(relativeRepository && !relativeRepository.startsWith('..') && !path.isAbsolute(relativeRepository),
        'Refusing to mutate a system Homebrew repository');
    } else {
      assert.ok(selectedEnvironment.SDLC_HOMEBREW_PREFIX_PROOF,
        'An outside-checkout Homebrew prefix requires its bootstrap ownership proof');
      const verified = await verifyHomebrewPrefixOwnership({
        bootstrapDirectory: selectedEnvironment.SDLC_HOMEBREW_PREFIX_PROOF,
        repositoryRoot: ROOT, target: `macos-${process.arch}`, environment: selectedEnvironment,
      });
      assert.equal(prefix, verified.prefix, 'Homebrew prefix differs from its owned allocation');
      assert.equal(repository, verified.prefix, 'Homebrew repository differs from its owned allocation');
    }
    environment.PATH = `${prefix}/bin:${environment.PATH}`;
    evidence.brewVersion = (await runBrew(['--version'])).stdout.trim();
    const node = path.join((await runBrew(['--prefix', homebrewToolchain.formula])).stdout.trim(), 'bin', 'node');
    const runtime = await json(node, ['-p', 'JSON.stringify({platform:process.platform,arch:process.arch,major:Number(process.versions.node.split(".")[0])})']);
    assert.deepEqual(runtime, { platform: 'darwin', arch: process.arch, major: homebrewToolchain.major },
      `Install the real Homebrew ${homebrewToolchain.formula} dependency before this test`);
    evidence.homebrewRuntime = runtime;
    evidence.homebrewNodeVersion = (await run(node, ['--version'])).stdout.trim().replace(/^v/u, '');
    if (expectedNodeVersion) assert.equal(evidence.homebrewNodeVersion, expectedNodeVersion,
      'Homebrew must use the selected native Node baseline');
    const candidate = JSON.parse(await fs.readFile(path.join(candidateDirectory, 'release-descriptor.json'), 'utf8'));
    const upgrade = upgradeDirectory
      ? JSON.parse(await fs.readFile(path.join(upgradeDirectory, 'release-descriptor.json'), 'utf8')) : candidate;
    if (mode === 'public' || expectedPreviousIdentity || expectedCurrentIdentity) {
      await verifyHomebrewUpgradeInputs({ candidateDirectory, upgradeDirectory,
        previous: expectedPreviousIdentity, current: expectedCurrentIdentity });
      evidence.previousIdentity = expectedPreviousIdentity;
      evidence.currentIdentity = expectedCurrentIdentity;
    }
    if (upgradeDirectory) assert.notEqual(candidate.version, upgrade.version,
      'A same-version formula revision cannot satisfy prior-version upgrade');
    const archiveName = descriptor => {
      const shared = `ai-sdlc-framework-${descriptor.version}-macos.tar.gz`;
      return descriptor.files.some(file => file.filename === shared) ? shared :
        `ai-sdlc-framework-${descriptor.version}-macos-${process.arch}.tar.gz`;
    };
    const served = new Map();
    for (const [descriptor, directory] of [[candidate, candidateDirectory], [upgrade, upgradeDirectory ?? candidateDirectory]]) {
      if (mode !== 'public') await generateHomebrewFormula({ descriptor, artifactDirectory: directory, mode: 'candidate',
        candidateBaseUrl: 'http://127.0.0.1:1/', architectures: [process.arch] });
      const filename = archiveName(descriptor);
      const bytes = await fs.readFile(path.join(directory, filename));
      const record = descriptor.files.find(file => file.filename === filename);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256);
      evidence.archiveInputs ??= [];
      evidence.archiveInputs.push({ filename, sha256: record.sha256, size: bytes.length });
      if (served.has(filename)) assert.deepEqual(served.get(filename), bytes);
      served.set(filename, bytes);
    }
    let candidateBaseUrl;
    if (mode !== 'public') {
      server = createServer((request, response) => {
      const bytes = served.get(request.url?.slice(1));
      if (!bytes) { response.writeHead(404).end(); return; }
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': bytes.length });
      response.end(bytes);
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
      candidateBaseUrl = `http://127.0.0.1:${server.address().port}/`;
      assert.equal((await fetch(`${candidateBaseUrl}${archiveName(candidate)}`)).status, 200);
    }
    tap = `local/sdlc-${randomUUID().replaceAll('-', '')}`;
    tapRoot = path.join(repository, 'Library', 'Taps', 'local', `homebrew-${tap.split('/')[1]}`);
    await fs.mkdir(path.join(tapRoot, 'Formula'), { recursive: true });
    await fs.mkdir(path.join(work, 'Formula'));
    await run('git', ['init', '--quiet', tapRoot]);
    formulaFile = path.join(tapRoot, 'Formula', 'ai-sdlc-framework.rb');
    formulaName = `${tap}/ai-sdlc-framework`;
    const generate = (descriptor, artifactDirectory, mode = 'candidate') =>
      generateHomebrewFormula({ descriptor, artifactDirectory, mode,
        ...(mode === 'candidate' ? { candidateBaseUrl, architectures: [process.arch] } : {}) });
    if (mode === 'stable' && !candidate.version.includes('-')) {
      const stable = await generate(candidate, candidateDirectory, 'stable');
      const repeated = await generateHomebrewFormula({ descriptor: candidate,
        artifactDirectory: candidateDirectory, architectures: ['x64', 'arm64'] });
      assert.deepEqual(repeated, stable, 'Dual-architecture formula metadata is not deterministic');
      evidence.formulaMetadataArchitectures = ['arm64', 'x64'];
      evidence.formulaMetadataSha256 = stable.sha256;
      evidence.deterministicFormulaMetadata = 'passed';
      await fs.writeFile(formulaFile, stable.contents);
      await fs.writeFile(path.join(work, 'stable-ai-sdlc-framework.rb'), stable.contents);
      currentFormula = evidence.formulas.stable = await homebrewFormulaEvidence(work, 'stable');
      await runBrew(['style', formulaFile]);
      await runBrew(['audit', '--strict', '--formula', formulaName]);
      evidence.stableMetadataAudit = 'passed';
    } else {
      evidence.stableMetadataAudit = mode === 'public' ? 'exact-published-formula' :
        mode === 'candidate' ? 'NotRun-unpublished-candidate' : 'not-applicable-prerelease';
      evidence.publicAcceptance = mode === 'candidate' ? 'NotRun' : 'not-applicable-prerelease';
    }
    const local = mode === 'public' ? await publicHomebrewFormula(candidateDirectory, candidate) :
      await generate(candidate, candidateDirectory);
    await fs.writeFile(formulaFile, local.contents);
    await fs.writeFile(path.join(work, 'Formula', 'ai-sdlc-framework.rb'), local.contents);
    currentFormula = evidence.formulas.candidate = mode === 'public' ? {
      filename: local.filename, sha256: local.sha256, size: local.size, source: 'exact-published-bytes',
    } : await homebrewFormulaEvidence(work, 'candidate');
    await runBrew(['style', formulaFile]);
    await runBrew(['audit', '--strict', '--formula', formulaName]);
    const home = environment.COPILOT_HOME;
    await fs.writeFile(path.join(home, 'copilot-instructions.md'), 'Unrelated user instructions.\n');
    const preserveUserContent = await seedConsumerPreservation(home);
    await fs.mkdir(path.join(home, 'sdlc', 'runtime'), { recursive: true });
    await fs.writeFile(path.join(home, 'sdlc', 'runtime', 'keep.json'), '{"retained":true}\n');
    const initialHome = await snapshot(home);
    await runBrew(['install', '--formula', '--skip-link', formulaName]);
    installed.add(formulaName);
    assert.deepEqual(await snapshot(home), initialHome, 'brew install changed COPILOT_HOME');
    await assert.rejects(fs.lstat(path.join(prefix, 'bin', 'sdlc')), { code: 'ENOENT' });
    const switched = await switchToHomebrew({ brew, formula: formulaName, home, environment, run });
    assert.equal(switched.linked, true);
    assert.equal(switched.postSwitchVerified, true);
    await preserveUserContent();
    const launcher = switched.launcher;
    assert.equal((await json(launcher, ['doctor'])).frameworkVersion, candidate.version);
    const installedHome = await snapshot(home);
    const shadow = path.join(work, 'shadowed node');
    await fs.mkdir(shadow);
    await fs.writeFile(path.join(shadow, 'node'), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
    const shadowedDoctor = JSON.parse((await run(launcher, ['doctor'], {
      env: { ...environment, PATH: `${shadow}:${environment.PATH}`,
        SDLC_NODE: path.join(shadow, 'node') },
    })).stdout);
    assert.equal(shadowedDoctor.findings.length, 0, 'The wrapper selected a shadowing PATH/SDLC_NODE runtime');
    assert.deepEqual(await snapshot(home), installedHome);
    await runBrew(['test', formulaName]);
    assert.deepEqual(await snapshot(home), installedHome, 'brew test escaped its isolated home');
    const hooks = await fs.readFile(path.join(home, 'hooks', 'sdlc.json'), 'utf8');
    assert.ok(!hooks.includes(path.join(prefix, 'Cellar', 'ai-sdlc-framework') + path.sep),
      'Hooks depend on a channel payload');

    await runBrew(['unlink', formulaName]);
    const destination = path.join(prefix, 'bin', 'sdlc');
    await fs.writeFile(destination, 'unidentified launcher\n');
    try {
      await assert.rejects(switchToHomebrew({ brew, formula: formulaName, home, environment, run }),
        /Unidentified/u);
      assert.equal(await fs.readFile(destination, 'utf8'), 'unidentified launcher\n');
    } finally {
      await fs.unlink(destination);
    }
    if (mode !== 'public') {
    const previousName = `${tap}/ai-sdlc-framework-previous`;
    await fs.writeFile(path.join(tapRoot, 'Formula', 'ai-sdlc-framework-previous.rb'),
      local.contents.replace('class AiSdlcFramework <', 'class AiSdlcFrameworkPrevious <'));
    await runBrew(['install', '--formula', '--skip-link', previousName]);
    installed.add(previousName);
    await runBrew(['link', previousName]);
    const oldKeg = await fs.realpath((await runBrew(['--prefix', previousName])).stdout.trim());
    const switchedOwned = await switchToHomebrew({
      brew, formula: formulaName, home, previousFormula: previousName, environment, run,
    });
    assert.equal(switchedOwned.previousRetained, true);
    assert.equal(switchedOwned.postSwitchVerified, true);
    assert.equal(switchedOwned.oldPackageCleanupAllowed, true);
    await preserveUserContent();
    await fs.access(path.join(oldKeg, 'bin', 'sdlc'));
    const beforeOldRemoval = await snapshot(home);
    await runBrew(['uninstall', '--formula', previousName]);
    installed.delete(previousName);
    assert.deepEqual(await snapshot(home), beforeOldRemoval, 'Removing old channel changed replacement');
    await verifyCopiedHomebrewInstallation({ home, node, frameworkVersion: candidate.version,
      forbiddenKegs: [oldKeg], run, environment });
    }

    const next = mode === 'public' ? await publicHomebrewFormula(upgradeDirectory, upgrade) :
      await generate(upgrade, upgradeDirectory ?? candidateDirectory);
    const upgradedFormula = upgradeDirectory ? next.contents :
      next.contents.replace('  license "MIT"\n', '  license "MIT"\n  revision 1\n');
    await fs.writeFile(formulaFile, upgradedFormula);
    await fs.writeFile(path.join(work, 'upgraded-ai-sdlc-framework.rb'), upgradedFormula);
    currentFormula = evidence.formulas.upgrade = mode === 'public' ? {
      filename: next.filename, sha256: next.sha256, size: next.size, source: 'exact-published-bytes',
    } : await homebrewFormulaEvidence(work, 'upgrade');
    let failedPromotionState;
    await assert.rejects(switchToHomebrew({
      brew, formula: formulaName, home, environment, upgradePackage: true,
      run: async (command, args, options) => {
        if (command === brew && args[0] === 'link' && args[1] === formulaName) {
          assert.equal(options.env.HOMEBREW_NO_INSTALL_CLEANUP, '1');
          evidence.commands.push({ command, args, success: false,
            noInstallCleanup: options.env.HOMEBREW_NO_INSTALL_CLEANUP,
            formula: { ...currentFormula },
            faultInjected: 'one candidate promotion fails to exercise rollback and retry' });
          throw new Error('Injected candidate promotion failure');
        }
        return run(command, args, options);
      },
    }), error => {
      assert.equal(error.code, 'HOMEBREW_SWITCH_FAILED');
      assert.match(error.message, /Injected candidate promotion failure/u);
      failedPromotionState = error.details.stateFile;
      return true;
    });
    const failedState = JSON.parse(await fs.readFile(failedPromotionState, 'utf8'));
    await preserveUserContent();
    const priorKeg = path.dirname(path.dirname(launcher));
    assert.equal(await fs.realpath((await runBrew(['--prefix', formulaName])).stdout.trim()), priorKeg);
    await fs.access(path.join(failedState.requestedCandidate.keg, 'INSTALL_RECEIPT.json'));
    const upgraded = await switchToHomebrew({ brew, formula: formulaName, home, environment, run, upgradePackage: true });
    const rollbackState = JSON.parse(await fs.readFile(upgraded.stateFile, 'utf8'));
    await preserveUserContent();
    assert.equal(upgraded.postSwitchVerified, true);
    assert.equal(rollbackState.retentionVerifiedBeforePromotion, true);
    assert.equal(rollbackState.oldPackageCleanupAllowed, true);
    assert.equal(rollbackState.targetKeg, path.dirname(path.dirname(launcher)),
      'Upgrade did not capture its old keg before brew install');
    assert.equal(rollbackState.capturedLink.absolute, launcher);
    assert.equal(upgraded.launcher, path.join(failedState.requestedCandidate.keg, 'bin', 'sdlc'));
    assert.equal(upgraded.candidateVersion, failedState.requestedCandidate.pkgVersion);
    evidence.failedPromotionRetry = { passed: true, priorKeg,
      candidateKeg: failedState.requestedCandidate.keg, candidateVersion: upgraded.candidateVersion };
    const upgradedKeg = await fs.realpath((await runBrew(['--prefix', formulaName])).stdout.trim());
    assert.notEqual(upgradedKeg, path.dirname(path.dirname(launcher)), 'Homebrew did not replace the keg');
    const upgradedLauncher = path.join(upgradedKeg, 'bin', 'sdlc');
    if (mode === 'public') {
      assert.equal((await json(upgradedLauncher, ['doctor'])).frameworkVersion, upgrade.version);
      await fs.rm(priorKeg, { recursive: true });
      await assert.rejects(fs.access(priorKeg), { code: 'ENOENT' });
      await verifyCopiedHomebrewInstallation({ home, node, frameworkVersion: upgrade.version,
        forbiddenKegs: [priorKeg], run, environment });
    }
    await runBrew(['style', formulaFile]);
    await runBrew(['audit', '--strict', '--formula', formulaName]);
    await runBrew(['test', formulaName]);
    const preserve = async () => {
      await preserveUserContent();
      assert.equal(await fs.readFile(path.join(home, 'sdlc', 'runtime', 'keep.json'), 'utf8'), '{"retained":true}\n');
      assert.match(await fs.readFile(path.join(home, 'copilot-instructions.md'), 'utf8'), /^Unrelated user instructions\.\n/u);
      await fs.access(node);
    };
    evidence.idempotentUpdate = await assertConsumerUpdate({ home, version: upgrade.version,
      invoke: args => run(upgradedLauncher, args), preserve });
    assert.equal((await json(upgradedLauncher, ['doctor'])).frameworkVersion, upgrade.version);
    assert.equal(await fs.readFile(path.join(home, 'sdlc', 'runtime', 'keep.json'), 'utf8'), '{"retained":true}\n');

    const extracted = path.join(work, 'replacement npm payload');
    await fs.cp(path.join(upgradedKeg, 'libexec', 'package'), extracted, { recursive: true });
    await runBrew(['tab', '--no-installed-on-request', '--formula', homebrewToolchain.formula]);
    const removed = await switchFromHomebrew({
      brew, formula: formulaName, sourceRoot: extracted, home, environment, run,
    });
    installed.delete(formulaName);
    assert.equal(removed.oldPackageRemoved, true);
    assert.equal(removed.postSwitchVerified, true);
    await preserveUserContent();
    await runBrew(['autoremove']);
    await verifyCopiedHomebrewInstallation({ home, node: removed.node, frameworkVersion: upgrade.version,
      forbiddenKegs: [upgradedKeg], run, environment });
    const entry = path.join(extracted, 'bin', 'sdlc.mjs');
    evidence.ordinaryUninstall = await assertConsumerUninstall({ home,
      invoke: args => run(node, [entry, ...args]), preserve });
    assert.equal(await fs.readFile(path.join(home, 'sdlc', 'runtime', 'keep.json'), 'utf8'), '{"retained":true}\n');
    await json(node, [entry, 'install', '--purge-existing']);
    await assert.rejects(fs.access(path.join(home, 'sdlc', 'runtime', 'keep.json')), { code: 'ENOENT' });
    assert.equal((await json(node, [entry, 'doctor'])).findings.length, 0);
    await installedConsumerSnapshot(home, upgrade.version);
    await preserveUserContent();
    evidence.purge = await assertConsumerUninstall({ home, purge: true,
      invoke: args => run(node, [entry, ...args]), preserve: async () => {
        await preserveUserContent();
        assert.match(await fs.readFile(path.join(home, 'copilot-instructions.md'), 'utf8'), /^Unrelated user instructions\.\n+$/u);
        await fs.access(removed.node);
      } });
    assert.match(await fs.readFile(path.join(home, 'copilot-instructions.md'), 'utf8'),
      /^Unrelated user instructions\.\n+$/u);
    evidence.passed = true;
    if (mode === 'public') evidence.publicAcceptance = 'Passed';
    return evidence;
  } catch (error) {
    evidence.error = error.message;
    throw error;
  } finally {
    for (const formula of installed) {
      try {
        if (!evidence.passed) {
          try {
            const failedKeg = (await runBrew(['--prefix', formula])).stdout.trim();
            await fs.cp(path.join(failedKeg, 'libexec'),
              path.join(work, `failed-${formula.split('/').at(-1)}`), { recursive: true });
          } catch (error) {
            evidence.diagnosticError = error.message;
          }

        }
        await runBrew(['uninstall', '--force', '--formula', formula]);
        installed.delete(formula);
      }
      catch (error) { evidence.cleanupError = error.message; }
    }
    if (server) await new Promise(resolve => server.close(resolve));
    if (tapRoot && installed.size === 0) await fs.rm(tapRoot, { recursive: true, force: true });
    await fs.writeFile(path.join(work, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  }
}

export async function verifyHomebrewUpgradeInputs({ candidateDirectory, upgradeDirectory, previous, current }) {
  if (!candidateDirectory || !upgradeDirectory || ![previous, current].every(identity =>
    identity && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(identity.version ?? '') &&
    /^[a-f0-9]{40}$/u.test(identity.sourceCommit ?? '') &&
    ['descriptorSha256', 'checksumsSha256', 'payloadSha256'].every(key => /^[a-f0-9]{64}$/u.test(identity[key] ?? '')))) {
    throw Object.assign(new Error('Authentic supported-previous pins and exact frozen current pins are required'),
      { code: 'RELEASE_INTEGRATION_BLOCKED' });
  }
  const versions = [previous.version, current.version].map(version => {
    assert.match(version ?? '', /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u);
    return version.split(/[.-]/u).slice(0, 3).map(BigInt);
  });
  const difference = versions[1].findIndex((value, index) => value !== versions[0][index]);
  assert.ok(difference >= 0 && versions[1][difference] > versions[0][difference],
    'Upgrade requires a genuinely newer current release, not a formula revision or downgrade');
  for (const [directory, identity] of [[candidateDirectory, previous], [upgradeDirectory, current]]) {
    const { descriptor } = await verifyReleaseChecksums({ outputDir: directory, selectedFiles: [],
      expectedDescriptorSha256: identity.descriptorSha256, expectedChecksumsSha256: identity.checksumsSha256 });
    assert.equal(descriptor.version, identity.version);
    assert.equal(descriptor.sourceCommit, identity.sourceCommit);
    assert.equal(descriptor.payload.sha256, identity.payloadSha256);
  }
  return { previous, current, upgradeKind: 'version' };
}

export async function publicHomebrewFormula(directory, descriptor) {
  const records = descriptor.files.filter(file => file.kind === 'homebrew');
  assert.equal(records.length, 1, 'Public lifecycle requires one exact published formula');
  const [record] = records;
  assert.equal(record.filename, 'ai-sdlc-framework.rb');
  const file = path.join(directory, record.filename);
  const stat = await fs.lstat(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Published formula must be a literal file');
  const bytes = await fs.readFile(file);
  assert.equal(bytes.length, record.size);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256,
    'Published formula bytes differ from the verified public descriptor');
  const contents = bytes.toString('utf8');
  const urls = [...contents.matchAll(/^\s*url\s+"([^"]+)"\s*$/gmu)].map(match => match[1]);
  assert.ok(urls.length > 0 && urls.every(url => descriptor.files.some(archive =>
    archive.kind === 'archive' && archive.filename.includes('-macos') &&
    url === `https://github.com/urmich/ai-sdlc-framework/releases/download/v${descriptor.version}/${archive.filename}`)),
  'Published formula must execute its exact public archive URLs, never a regenerated loopback candidate');
  return { ...record, contents };
}

async function identityFromPins(directory, descriptorSha256, checksumsSha256) {
  if (!directory || !/^[a-f0-9]{64}$/u.test(descriptorSha256 ?? '') ||
      !/^[a-f0-9]{64}$/u.test(checksumsSha256 ?? '')) {
    throw Object.assign(new Error('Independent prior/current descriptor and checksum pins are required for a version-upgrade procedure'),
      { code: 'RELEASE_INTEGRATION_BLOCKED' });
  }
  const { descriptor } = await verifyReleaseChecksums({ outputDir: directory, selectedFiles: [],
    expectedDescriptorSha256: descriptorSha256, expectedChecksumsSha256: checksumsSha256 });
  return { version: descriptor.version, sourceCommit: descriptor.sourceCommit,
    payloadSha256: descriptor.payload.sha256, descriptorSha256, checksumsSha256 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: {
    brew: { type: 'string' }, 'candidate-dir': { type: 'string' },
    'upgrade-dir': { type: 'string' }, root: { type: 'string' }, mode: { type: 'string', default: 'stable' },
    'previous-descriptor-sha256': { type: 'string' }, 'previous-checksums-sha256': { type: 'string' },
    'current-descriptor-sha256': { type: 'string' }, 'current-checksums-sha256': { type: 'string' },
  } });
  const versionUpgrade = ['candidate', 'public'].includes(values.mode);
  const expectedPreviousIdentity = versionUpgrade ? await identityFromPins(values['candidate-dir'],
    values['previous-descriptor-sha256'], values['previous-checksums-sha256']) : undefined;
  const expectedCurrentIdentity = versionUpgrade ? await identityFromPins(values['upgrade-dir'],
    values['current-descriptor-sha256'], values['current-checksums-sha256']) : undefined;
  const evidence = await verifyHomebrewLifecycle({ brew: values.brew,
    candidateDirectory: values['candidate-dir'], upgradeDirectory: values['upgrade-dir'],
    root: values.root, mode: values.mode, expectedNodeVersion: nativeToolchain.node,
    expectedPreviousIdentity, expectedCurrentIdentity });
  process.stdout.write(`${JSON.stringify({ passed: evidence.passed,
    architecture: evidence.architecture, upgradeKind: evidence.upgradeKind,
    publicAcceptance: evidence.publicAcceptance })}\n`);
}
