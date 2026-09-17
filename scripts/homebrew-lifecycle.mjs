import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { generateHomebrewFormula } from '../packaging/homebrew/generate-formula.mjs';
import { assertNativeMacHost, runHomebrewCommand, switchFromHomebrew, switchToHomebrew, verifyCopiedHomebrewInstallation } from './homebrew-switch.mjs';

const execute = runHomebrewCommand;

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

export async function verifyHomebrewLifecycle({ brew, candidateDirectory, upgradeDirectory, root } = {}) {
  assert.equal(process.platform, 'darwin', 'Homebrew lifecycle requires native macOS');
  assert.ok(['arm64', 'x64'].includes(process.arch), 'Unsupported native architecture');
  assert.ok(brew && candidateDirectory, 'Provide the isolated brew executable and candidate directory');
  const { uname: host, translated } = await assertNativeMacHost();
  const work = path.resolve(root ?? path.join('.test-data', `homebrew-lifecycle-${randomUUID()}`));
  const relative = path.relative(path.resolve('.test-data'), work);
  assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
    'Lifecycle output must be a new child of this checkout’s .test-data');
  await fs.mkdir(work, { recursive: false });
  const evidence = { schemaVersion: 1, platform: process.platform, architecture: process.arch,
    node: process.version, uname: host, sysctlProcTranslated: translated,
    candidateDirectory: path.resolve(candidateDirectory), commands: [], passed: false,
    publicAcceptance: 'NotRun', upgradeKind: upgradeDirectory ? 'version' : 'formula-revision' };
  const environment = { ...process.env,
    HOME: path.join(work, 'home'), COPILOT_HOME: path.join(work, 'copilot home'),
    HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_ANALYTICS: '1', HOMEBREW_DEVELOPER: '1',
    HOMEBREW_NO_INSTALL_CLEANUP: '1', HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK: '1',
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
  const run = async (command, args, options = {}) => {
    const entry = { command, args };
    evidence.commands.push(entry);
    try {
      if (command === brew) {
        entry.noInstallCleanup = (options.env ?? environment).HOMEBREW_NO_INSTALL_CLEANUP;
        assert.equal(entry.noInstallCleanup, '1', 'Every brew operation must suppress install cleanup');
      }
      const channelOnly = command === brew && ['install', 'upgrade', 'uninstall', 'autoremove', 'tab'].includes(args[0]);
      const before = channelOnly ? await snapshot(environment.COPILOT_HOME) : undefined;
      const output = await execute(command, args,
        { maxBuffer: 16 * 1024 * 1024, ...options, env: options.env ?? environment });
      if (before) assert.deepEqual(await snapshot(environment.COPILOT_HOME), before,
        `brew ${args[0]} changed COPILOT_HOME`);
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
    const relativePrefix = path.relative(path.resolve('.test-data'), prefix);
    assert.ok(relativePrefix && !relativePrefix.startsWith('..') && !path.isAbsolute(relativePrefix),
      'Refusing to mutate a system Homebrew prefix; supply an isolated checkout under .test-data');
    environment.PATH = `${prefix}/bin:${environment.PATH}`;
    const repository = (await runBrew(['--repository'])).stdout.trim();
    evidence.brewVersion = (await runBrew(['--version'])).stdout.trim();
    const node = path.join((await runBrew(['--prefix', 'node@22'])).stdout.trim(), 'bin', 'node');
    const runtime = await json(node, ['-p', 'JSON.stringify({platform:process.platform,arch:process.arch,major:Number(process.versions.node.split(".")[0])})']);
    assert.deepEqual(runtime, { platform: 'darwin', arch: process.arch, major: 22 },
      'Install the real Homebrew node@22 dependency before this test');
    evidence.homebrewRuntime = runtime;
    const candidate = JSON.parse(await fs.readFile(path.join(candidateDirectory, 'release-descriptor.json'), 'utf8'));
    const upgrade = upgradeDirectory
      ? JSON.parse(await fs.readFile(path.join(upgradeDirectory, 'release-descriptor.json'), 'utf8')) : candidate;
    const served = new Map();
    for (const [descriptor, directory] of [[candidate, candidateDirectory], [upgrade, upgradeDirectory ?? candidateDirectory]]) {
      await generateHomebrewFormula({ descriptor, artifactDirectory: directory, mode: 'candidate',
        candidateBaseUrl: 'http://127.0.0.1:1/', architectures: [process.arch] });
      const filename = `ai-sdlc-framework-${descriptor.version}-macos-${process.arch}.tar.gz`;
      const bytes = await fs.readFile(path.join(directory, filename));
      if (served.has(filename)) assert.deepEqual(served.get(filename), bytes);
      served.set(filename, bytes);
    }
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
    const candidateBaseUrl = `http://127.0.0.1:${server.address().port}/`;
    assert.equal((await fetch(`${candidateBaseUrl}ai-sdlc-framework-${candidate.version}-macos-${process.arch}.tar.gz`)).status, 200);
    tap = `local/sdlc-${randomUUID().replaceAll('-', '')}`;
    tapRoot = path.join(repository, 'Library', 'Taps', 'local', `homebrew-${tap.split('/')[1]}`);
    await fs.mkdir(path.join(tapRoot, 'Formula'), { recursive: true });
    await fs.mkdir(path.join(work, 'Formula'));
    await run('git', ['init', '--quiet', tapRoot]);
    const formulaFile = path.join(tapRoot, 'Formula', 'ai-sdlc-framework.rb');
    const formulaName = `${tap}/ai-sdlc-framework`;
    const generate = (descriptor, artifactDirectory, mode = 'candidate') =>
      generateHomebrewFormula({ descriptor, artifactDirectory, mode,
        ...(mode === 'candidate' ? { candidateBaseUrl, architectures: [process.arch] } : {}) });
    if (!candidate.version.includes('-') && process.arch === 'arm64') {
      const stable = await generate(candidate, candidateDirectory, 'stable');
      await fs.writeFile(formulaFile, stable.contents);
      await fs.writeFile(path.join(work, 'stable-ai-sdlc-framework.rb'), stable.contents);
      await runBrew(['style', formulaFile]);
      await runBrew(['audit', '--strict', '--formula', formulaName]);
      evidence.stableMetadataAudit = 'passed';
    } else if (candidate.version.includes('-')) {
      evidence.stableMetadataAudit = 'not-applicable-prerelease';
      evidence.publicAcceptance = 'not-applicable-prerelease';
    } else {
      evidence.stableMetadataAudit = 'not-applicable-unverified-architecture';
      evidence.publicAcceptance = 'not-applicable-unverified-architecture';
    }
    const local = await generate(candidate, candidateDirectory);
    await fs.writeFile(formulaFile, local.contents);
    await fs.writeFile(path.join(work, 'Formula', 'ai-sdlc-framework.rb'), local.contents);
    await runBrew(['style', formulaFile]);
    await runBrew(['audit', '--strict', '--formula', formulaName]);
    const home = environment.COPILOT_HOME;
    await fs.writeFile(path.join(home, 'copilot-instructions.md'), 'Unrelated user instructions.\n');
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
    await fs.access(path.join(oldKeg, 'bin', 'sdlc'));
    const beforeOldRemoval = await snapshot(home);
    await runBrew(['uninstall', '--formula', previousName]);
    installed.delete(previousName);
    assert.deepEqual(await snapshot(home), beforeOldRemoval, 'Removing old channel changed replacement');
    await verifyCopiedHomebrewInstallation({ home, node, frameworkVersion: candidate.version,
      forbiddenKegs: [oldKeg], run, environment });

    const next = await generate(upgrade, upgradeDirectory ?? candidateDirectory);
    const upgradedFormula = upgradeDirectory ? next.contents :
      next.contents.replace('  license "MIT"\n', '  license "MIT"\n  revision 1\n');
    await fs.writeFile(formulaFile, upgradedFormula);
    await fs.writeFile(path.join(work, 'upgraded-ai-sdlc-framework.rb'), upgradedFormula);
    const upgraded = await switchToHomebrew({ brew, formula: formulaName, home, environment, run });
    const rollbackState = JSON.parse(await fs.readFile(upgraded.stateFile, 'utf8'));
    assert.equal(upgraded.postSwitchVerified, true);
    assert.equal(rollbackState.retentionVerifiedBeforePromotion, true);
    assert.equal(rollbackState.oldPackageCleanupAllowed, true);
    assert.equal(rollbackState.targetKeg, path.dirname(path.dirname(launcher)),
      'Upgrade did not capture its old keg before brew install');
    assert.equal(rollbackState.capturedLink.absolute, launcher);
    const upgradedKeg = await fs.realpath((await runBrew(['--prefix', formulaName])).stdout.trim());
    assert.notEqual(upgradedKeg, path.dirname(path.dirname(launcher)), 'Homebrew did not replace the keg');
    const upgradedLauncher = path.join(upgradedKeg, 'bin', 'sdlc');
    await json(upgradedLauncher, ['update']);
    assert.equal((await json(upgradedLauncher, ['doctor'])).frameworkVersion, upgrade.version);
    assert.equal(await fs.readFile(path.join(home, 'sdlc', 'runtime', 'keep.json'), 'utf8'), '{"retained":true}\n');

    const extracted = path.join(work, 'replacement npm payload');
    await fs.cp(path.join(upgradedKeg, 'libexec', 'package'), extracted, { recursive: true });
    await runBrew(['tab', '--no-installed-on-request', '--formula', 'node@22']);
    const removed = await switchFromHomebrew({
      brew, formula: formulaName, sourceRoot: extracted, home, environment, run,
    });
    installed.delete(formulaName);
    assert.equal(removed.oldPackageRemoved, true);
    assert.equal(removed.postSwitchVerified, true);
    await runBrew(['autoremove']);
    await verifyCopiedHomebrewInstallation({ home, node: removed.node, frameworkVersion: upgrade.version,
      forbiddenKegs: [upgradedKeg], run, environment });
    const entry = path.join(extracted, 'bin', 'sdlc.mjs');
    await json(node, [entry, 'uninstall']);
    assert.equal(await fs.readFile(path.join(home, 'sdlc', 'runtime', 'keep.json'), 'utf8'), '{"retained":true}\n');
    await json(node, [entry, 'install', '--purge-existing']);
    await assert.rejects(fs.access(path.join(home, 'sdlc', 'runtime', 'keep.json')), { code: 'ENOENT' });
    assert.equal((await json(node, [entry, 'doctor'])).findings.length, 0);
    await json(node, [entry, 'uninstall', '--purge']);
    assert.match(await fs.readFile(path.join(home, 'copilot-instructions.md'), 'utf8'),
      /^Unrelated user instructions\.\n+$/u);
    evidence.passed = true;
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

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: {
    brew: { type: 'string' }, 'candidate-dir': { type: 'string' },
    'upgrade-dir': { type: 'string' }, root: { type: 'string' },
  } });
  const evidence = await verifyHomebrewLifecycle({ brew: values.brew,
    candidateDirectory: values['candidate-dir'], upgradeDirectory: values['upgrade-dir'],
    root: values.root });
  process.stdout.write(`${JSON.stringify({ passed: evidence.passed,
    architecture: evidence.architecture, upgradeKind: evidence.upgradeKind,
    publicAcceptance: evidence.publicAcceptance })}\n`);
}
