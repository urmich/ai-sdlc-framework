import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { switchFromHomebrew, switchToHomebrew } from '../scripts/homebrew-switch.mjs';

const nativeMac = { skip: process.platform !== 'darwin' };

async function setup(t, behavior = {}) {
  const root = path.resolve('.test-data', `homebrew-switch-${randomUUID()}`);
  await fs.mkdir(root, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const prefix = path.join(root, 'brew prefix');
  const cellar = path.join(prefix, 'Cellar');
  const oldKeg = path.join(cellar, 'ai-sdlc-framework', '0.3.0');
  const candidateVersion = behavior.candidateVersion ?? '0.4.0';
  const candidateRevision = behavior.candidateRevision ?? 0;
  const candidatePkgVersion = `${candidateVersion}${candidateRevision ? `_${candidateRevision}` : ''}`;
  const newKeg = path.join(cellar, 'ai-sdlc-framework', candidatePkgVersion);
  const nodeKeg = path.join(cellar, 'node@22', '22.23.2');
  const node = path.join(nodeKeg, 'bin', 'node');
  const destination = path.join(prefix, 'bin', 'sdlc');
  const home = path.join(root, 'copilot home');
  const sourceRoot = path.join(root, 'non-global npm', 'node_modules', 'ai-sdlc-framework');
  const formula = 'local/candidate/ai-sdlc-framework';
  const receipt = (dependencies, version, revision = 0) => JSON.stringify({
    installed_on_request: false, source: { tap: 'local/candidate',
      versions: { stable: version }, revision },
    runtime_dependencies: dependencies,
  });
  const recordedNodeVersion = behavior.recordedNodeVersion ?? '22.23.2';
  const dependencies = [{ full_name: 'node@22', pkg_version: recordedNodeVersion }];
  async function keg(directory, version, revision = 0) {
    await fs.mkdir(path.join(directory, 'bin'), { recursive: true });
    await fs.mkdir(path.join(directory, 'libexec', 'package'), { recursive: true });
    await fs.writeFile(path.join(directory, 'bin', 'sdlc'), `old or new ${version}\n`);
    await fs.writeFile(path.join(directory, 'libexec', 'package', 'package.json'),
      JSON.stringify({ name: 'ai-sdlc-framework', version }));
    await fs.writeFile(path.join(directory, 'INSTALL_RECEIPT.json'), receipt(dependencies, version, revision));
  }
  await keg(oldKeg, '0.3.0');
  const inactiveKeg = path.join(cellar, 'ai-sdlc-framework', '0.2.0');
  const obsoleteNodeKeg = path.join(cellar, 'node@22', '22.1.0');
  if (behavior.inactiveRetiredDependencies) {
    await keg(inactiveKeg, '0.2.0');
    await fs.writeFile(path.join(inactiveKeg, 'INSTALL_RECEIPT.json'), receipt([
      { full_name: 'node@22', pkg_version: '22.1.0' },
      { full_name: 'icu4c@71', pkg_version: '71.1' },
    ], '0.2.0'));
    await fs.mkdir(path.join(obsoleteNodeKeg, 'bin'), { recursive: true });
    await fs.writeFile(path.join(obsoleteNodeKeg, 'bin', 'node'), 'inactive node fixture\n');
    await fs.writeFile(path.join(obsoleteNodeKeg, 'INSTALL_RECEIPT.json'), receipt([
      { full_name: 'icu4c@70', pkg_version: '70.1' },
    ], '22.1.0'));
  }
  await fs.mkdir(path.join(nodeKeg, 'bin'), { recursive: true });
  await fs.writeFile(node, 'native node fixture\n', { mode: 0o755 });
  await fs.writeFile(path.join(nodeKeg, 'INSTALL_RECEIPT.json'), receipt([], '22.23.2'));
  const historicalNodeKeg = path.join(cellar, 'node@22', recordedNodeVersion);
  if (behavior.keepHistoricalDependency && historicalNodeKeg !== nodeKeg) {
    await fs.mkdir(path.join(historicalNodeKeg, 'bin'), { recursive: true });
    await fs.writeFile(path.join(historicalNodeKeg, 'bin', 'node'), 'historical node fixture\n', { mode: 0o755 });
    await fs.writeFile(path.join(historicalNodeKeg, 'INSTALL_RECEIPT.json'), receipt([], recordedNodeVersion));
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.mkdir(path.join(prefix, 'opt'), { recursive: true });
  await fs.mkdir(path.join(prefix, 'var', 'homebrew', 'linked'), { recursive: true });
  const target = directory => path.relative(path.dirname(destination), path.join(directory, 'bin', 'sdlc'));
  await fs.symlink(target(oldKeg), destination);
  await fs.symlink(oldKeg, path.join(prefix, 'opt', 'ai-sdlc-framework'));
  await fs.symlink(oldKeg, path.join(prefix, 'var', 'homebrew', 'linked', 'ai-sdlc-framework'));
  await fs.symlink(nodeKeg, path.join(prefix, 'opt', 'node@22'));
  await fs.mkdir(path.join(sourceRoot, 'bin'), { recursive: true });
  await fs.writeFile(path.join(sourceRoot, 'package.json'),
    '{"name":"ai-sdlc-framework","version":"0.4.0"}\n');
  await fs.writeFile(path.join(sourceRoot, 'bin', 'sdlc.mjs'), 'replacement fixture');
  await fs.mkdir(path.join(home, 'hooks'), { recursive: true });
  await fs.mkdir(path.join(home, 'sdlc', 'bin'), { recursive: true });
  await fs.writeFile(path.join(home, 'sdlc', 'bin', 'sdlc.mjs'), 'copied fixture');
  const calls = [];
  let installedNew = false;
  let removed = false;
  let promoted = false;
  let promotionAttempts = 0;
  let captured;
  const json = value => ({ stdout: JSON.stringify(value), stderr: '' });
  async function writeHooks() {
    await fs.writeFile(path.join(home, 'hooks', 'sdlc.json'), JSON.stringify({
      hooks: { sessionStart: [{
        exec: node, args: [path.join(home, 'sdlc', 'bin', 'sdlc.mjs'), 'hook', 'sessionStart'],
      }] },
    }));
  }
  const run = async (command, args, options = {}) => {
    calls.push({ command, args, noInstallCleanup: options.env?.HOMEBREW_NO_INSTALL_CLEANUP });
    if (command === '/usr/bin/uname') return { stdout: process.arch === 'arm64' ? 'arm64' : 'x86_64' };
    if (command === '/usr/sbin/sysctl') return { stdout: behavior.translated ?? '0' };
    if (command === 'fake-brew') {
      assert.equal(options.env?.HOMEBREW_NO_INSTALL_CLEANUP, '1', 'Every brew operation must suppress install cleanup');
      if (args[0] === '--prefix') return { stdout: args[1] === undefined ? prefix :
        path.join(prefix, 'opt', args[1].split('/').at(-1)) };
      if (args[0] === '--cellar') return { stdout: cellar };
      if (args[0] === 'info') return json({ formulae: [{
        name: 'ai-sdlc-framework', full_name: formula,
        versions: { stable: candidateVersion }, revision: candidateRevision,
      }] });
      if (['install', 'tab'].includes(args[0])) {
        const lock = JSON.parse(await fs.readFile(path.join(prefix, 'var', 'ai-sdlc-framework-switch', 'active.lock'), 'utf8'));
        captured = JSON.parse(await fs.readFile(path.join(lock.root, 'state.json'), 'utf8'));
        assert.equal(captured.capturedBeforeBrew, true);
        assert.equal(captured.phase, args[0] === 'install' ? 'installing-new-channel' : 'retaining-node');
        assert.equal(captured.capturedLink.absolute, path.join(oldKeg, 'bin', 'sdlc'));
        assert.equal(captured.targetKeg, oldKeg);
        assert.ok(captured.kegs.some(item => item.path === nodeKeg));
        assert.deepEqual(captured.installedVersions[0].versions, [
          ...(behavior.inactiveRetiredDependencies ? ['0.2.0'] : []),
          '0.3.0', ...(installedNew ? [candidatePkgVersion] : []),
        ].sort());
        await fs.access(path.join(captured.kegs[0].backup, 'bin', 'sdlc'));
      }
      if (args[0] === 'install') {
        if (installedNew || behavior.skipCandidateInstall) return { stdout: 'Candidate already installed', stderr: '' };
        await fs.unlink(destination);
        if (behavior.removeOld || behavior.failInstall) await fs.rm(oldKeg, { recursive: true });
        if (behavior.modifyOld) await fs.appendFile(path.join(oldKeg, 'bin', 'sdlc'), 'unexpected mutation');
        if (behavior.removeDependency) await fs.rm(nodeKeg, { recursive: true });
        if (behavior.failInstall) throw new Error('brew install failed after cleaning the old keg');
        await keg(newKeg, candidateVersion, candidateRevision);
        installedNew = true;
        await fs.unlink(path.join(prefix, 'opt', 'ai-sdlc-framework'));
        await fs.symlink(newKeg, path.join(prefix, 'opt', 'ai-sdlc-framework'));
        if (behavior.foreignLink) await fs.writeFile(destination, 'unidentified replacement');
      } else if (args[0] === 'tab') {
        if (!behavior.failRetention) {
          const file = path.join(nodeKeg, 'INSTALL_RECEIPT.json');
          const tab = JSON.parse(await fs.readFile(file, 'utf8'));
          tab.installed_on_request = true;
          await fs.writeFile(file, JSON.stringify(tab));
        }
      } else if (args[0] === 'link') {
        promotionAttempts++;
        if (behavior.failFirstPromotion && promotionAttempts === 1) throw new Error('first candidate promotion failed');
        await fs.symlink(target(newKeg), destination);
        await fs.unlink(path.join(prefix, 'opt', 'ai-sdlc-framework'));
        await fs.symlink(newKeg, path.join(prefix, 'opt', 'ai-sdlc-framework'));
        promoted = true;
      } else if (args[0] === 'unlink') {
        try { await fs.unlink(destination); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      } else if (args[0] === 'uninstall') {
        assert.equal(JSON.parse(await fs.readFile(path.join(nodeKeg, 'INSTALL_RECEIPT.json'), 'utf8')).installed_on_request, true);
        await fs.rm(oldKeg, { recursive: true });
        removed = true;
        if (behavior.removeRuntime) await fs.rm(nodeKeg, { recursive: true });
      }
      return { stdout: '', stderr: '' };
    }
    if (command === node) {
      await fs.access(node);
      if (args[0] === '-p') return json({
        execPath: node, major: Object.hasOwn(behavior, 'nodeMajor') ? behavior.nodeMajor : 22,
        platform: process.platform, arch: process.arch,
      });
      const action = args[1];
      if (action === 'hook') {
        if (removed && behavior.failPostRemovalHook) throw new Error('hook failed after channel removal');
        if (promoted && behavior.failPostPromotionHook) throw new Error('hook failed after link promotion');
        return json({});
      }
      if (action === 'install') { await writeHooks(); return json({ installed: true }); }
      if (action === 'doctor') return json({
        installed: true, home, frameworkVersion: candidateVersion,
        findings: promoted && behavior.failPostPromotionDoctor ? ['post-promotion doctor failed'] : [],
      });
    }
    if (command === path.join(newKeg, 'bin', 'sdlc')) {
      if (args[0] === 'install') { await writeHooks(); return json({ installed: true }); }
      if (args[0] === 'doctor') return json({
        installed: true, home, frameworkVersion: candidateVersion,
        findings: behavior.failDoctor ? ['failed doctor'] : [],
      });
    }
    throw new Error(`Unexpected invocation: ${command} ${args}`);
  };
  return { root, prefix, cellar, oldKeg, inactiveKeg, obsoleteNodeKeg, newKeg, nodeKeg, historicalNodeKeg, node, destination,
    candidateVersion, candidateRevision, candidatePkgVersion,
    home, sourceRoot, formula, run, calls, target, captured: () => captured,
    options: { brew: 'fake-brew', formula, home, sourceRoot, run,
      environment: { ...process.env, HOMEBREW_NO_INSTALL_CLEANUP: '0' } } };
}

test('T-51 switching verifies retained old kegs and runs copied hooks/doctor after promotion', nativeMac, async t => {
  const input = await setup(t);
  const result = await switchToHomebrew(input.options);
  assert.equal(result.linked, true);
  assert.equal(await fs.readlink(input.destination), input.target(input.newKeg));
  assert.equal(await fs.readFile(path.join(input.oldKeg, 'bin', 'sdlc'), 'utf8'), 'old or new 0.3.0\n');
  assert.equal(await fs.readFile(input.node, 'utf8'), 'native node fixture\n');
  const state = JSON.parse(await fs.readFile(result.stateFile, 'utf8'));
  assert.equal(state.phase, 'complete');
  assert.equal(state.previousKeg, input.oldKeg);
  assert.equal(state.retentionVerifiedBeforePromotion, true);
  assert.equal(result.postSwitchVerified, true);
  assert.equal(result.oldPackageCleanupAllowed, true);
  const promotedIndex = input.calls.findIndex(call => call.args[0] === 'link');
  const postPromotion = input.calls.slice(promotedIndex + 1);
  assert.ok(postPromotion.some(call => call.command === input.node && call.args[1] === 'hook'));
  assert.ok(postPromotion.some(call => call.command === input.node && call.args[1] === 'doctor'));
  assert.ok(!postPromotion.some(call => call.command.startsWith(input.oldKeg)));
  assert.ok(!input.calls.some(call => ['uninstall', 'cleanup'].includes(call.args[0])));
});

test('T-51 promotion rollback then retry activates the intended candidate despite old opt and install no-op', nativeMac, async t => {
  for (const version of [{}, { candidateVersion: '0.3.0', candidateRevision: 1 }]) {
    const input = await setup(t, { ...version, failFirstPromotion: true });
    await assert.rejects(switchToHomebrew(input.options), /first candidate promotion failed/u);
    await fs.access(path.join(input.newKeg, 'INSTALL_RECEIPT.json'));
    assert.equal(await fs.realpath(path.join(input.prefix, 'opt', 'ai-sdlc-framework')), input.oldKeg);
    assert.equal(await fs.readlink(input.destination), input.target(input.oldKeg));
    const retry = await switchToHomebrew(input.options);
    assert.equal(retry.launcher, path.join(input.newKeg, 'bin', 'sdlc'));
    assert.equal(retry.frameworkVersion, input.candidateVersion);
    assert.equal(retry.candidateVersion, input.candidatePkgVersion);
    assert.equal(await fs.realpath(path.join(input.prefix, 'opt', 'ai-sdlc-framework')), input.newKeg);
    assert.equal(await fs.readlink(input.destination), input.target(input.newKeg));
    const record = JSON.parse(await fs.readFile(retry.stateFile, 'utf8'));
    assert.equal(record.requestedCandidate.revision, input.candidateRevision);
    assert.equal(record.requestedCandidate.keg, input.newKeg);
  }
});

test('T-51 forward and reverse switching survive retired receipt dependency versions after cleanup', nativeMac, async t => {
  for (const direction of [switchToHomebrew, switchFromHomebrew]) {
    const input = await setup(t, { recordedNodeVersion: '22.22.0' });
    await assert.rejects(fs.access(input.historicalNodeKeg), { code: 'ENOENT' });
    const result = await direction(input.options);
    assert.equal(result.postSwitchVerified, true);
    const record = JSON.parse(await fs.readFile(result.stateFile, 'utf8'));
    const old = record.kegs.find(keg => keg.path === input.oldKeg);
    assert.equal(old.receipt.runtime_dependencies[0].pkg_version, '22.22.0');
    assert.deepEqual(old.dependencies[0], {
      fullName: 'node@22', recordedVersion: '22.22.0', historicalKeg: input.historicalNodeKeg,
      historicalPresent: false, requiredLive: true, currentKeg: input.nodeKeg,
    });
    assert.ok(record.kegs.some(keg => keg.path === input.nodeKeg));
    assert.ok(!record.kegs.some(keg => keg.path === input.historicalNodeKeg));
    await fs.access(input.node);
  }
});

test('T-51 current dependency and still-present historical keg are both captured', nativeMac, async t => {
  const input = await setup(t, { recordedNodeVersion: '22.22.0', keepHistoricalDependency: true });
  const result = await switchToHomebrew(input.options);
  const record = JSON.parse(await fs.readFile(result.stateFile, 'utf8'));
  assert.ok(record.kegs.some(keg => keg.path === input.nodeKeg));
  assert.ok(record.kegs.some(keg => keg.path === input.historicalNodeKeg));
  assert.equal(record.kegs.find(keg => keg.path === input.oldKeg).dependencies[0].historicalPresent, true);
});

test('T-51 missing requested candidate never falls back to the old opt keg', nativeMac, async t => {
  const input = await setup(t, { skipCandidateInstall: true });
  await assert.rejects(switchToHomebrew(input.options), error => {
    assert.equal(error.code, 'HOMEBREW_SWITCH_FAILED');
    assert.equal(error.cause.code, 'ENOENT');
    return true;
  });
  assert.ok(!input.calls.some(call => call.args[0] === 'link'));
  assert.ok(!input.calls.some(call => [input.oldKeg, input.newKeg].some(keg => call.command.startsWith(keg))));
  assert.equal(await fs.readlink(input.destination), input.target(input.oldKeg));
});

test('T-51 an unresolved current dependency still fails even when its historical keg exists', nativeMac, async t => {
  for (const direction of [switchToHomebrew, switchFromHomebrew]) {
    const input = await setup(t, { recordedNodeVersion: '22.22.0', keepHistoricalDependency: true });
    await fs.unlink(path.join(input.prefix, 'opt', 'node@22'));
    await assert.rejects(direction(input.options), { code: 'ENOENT' });
    assert.ok(!input.calls.some(call => ['install', 'tab', 'uninstall'].includes(call.args[0])));
    await fs.access(input.historicalNodeKeg);
  }
});

test('T-51 inactive framework and transitive historical receipts do not require retired ICU providers', nativeMac, async t => {
  for (const direction of [switchToHomebrew, switchFromHomebrew]) {
    const input = await setup(t, { inactiveRetiredDependencies: true });
    const result = await direction(input.options);
    assert.equal(result.postSwitchVerified, true);
    const record = JSON.parse(await fs.readFile(result.stateFile, 'utf8'));
    const inactive = record.kegs.find(keg => keg.path === input.inactiveKeg);
    const obsoleteNode = record.kegs.find(keg => keg.path === input.obsoleteNodeKeg);
    assert.equal(inactive.role, 'historical');
    assert.equal(obsoleteNode.role, 'historical');
    assert.equal(record.kegs.find(keg => keg.path === input.oldKeg).role, 'live');
    assert.equal(record.kegs.find(keg => keg.path === input.nodeKeg).role, 'live');
    for (const provenance of [
      inactive.dependencies.find(dependency => dependency.fullName === 'icu4c@71'),
      obsoleteNode.dependencies.find(dependency => dependency.fullName === 'icu4c@70'),
    ]) {
      assert.equal(provenance.requiredLive, false);
      assert.equal(provenance.historicalPresent, false);
      assert.equal(Object.hasOwn(provenance, 'currentKeg'), false);
    }
    assert.ok(!input.calls.some(call => call.args[0] === '--prefix' && /^icu4c@/u.test(call.args[1])));
    assert.equal(inactive.receipt.runtime_dependencies[1].full_name, 'icu4c@71');
    assert.equal(obsoleteNode.receipt.runtime_dependencies[0].full_name, 'icu4c@70');
  }
});

test('T-51 missing live transitive ICU providers still prevent both switch directions', nativeMac, async t => {
  for (const direction of [switchToHomebrew, switchFromHomebrew]) {
    const input = await setup(t, { inactiveRetiredDependencies: true });
    const receiptFile = path.join(input.nodeKeg, 'INSTALL_RECEIPT.json');
    const receipt = JSON.parse(await fs.readFile(receiptFile, 'utf8'));
    receipt.runtime_dependencies = [{ full_name: 'icu4c@78', pkg_version: '78.3' }];
    await fs.writeFile(receiptFile, JSON.stringify(receipt));
    await assert.rejects(direction(input.options), { code: 'ENOENT' });
    assert.ok(!input.calls.some(call => ['install', 'tab', 'uninstall'].includes(call.args[0])));
  }
});

test('T-51 stale transitive inventory in a live receipt is provenance, not the current direct graph', nativeMac, async t => {
  for (const direction of [switchToHomebrew, switchFromHomebrew]) {
    const input = await setup(t);
    const receiptFile = path.join(input.oldKeg, 'INSTALL_RECEIPT.json');
    const receipt = JSON.parse(await fs.readFile(receiptFile, 'utf8'));
    receipt.runtime_dependencies[0].declared_directly = true;
    receipt.runtime_dependencies.push({ full_name: 'icu4c@70', pkg_version: '70.1', declared_directly: false });
    await fs.writeFile(receiptFile, JSON.stringify(receipt));
    const result = await direction(input.options);
    const record = JSON.parse(await fs.readFile(result.stateFile, 'utf8'));
    const provenance = record.kegs.find(keg => keg.path === input.oldKeg).dependencies[1];
    assert.equal(provenance.requiredLive, false);
    assert.equal(provenance.historicalPresent, false);
    assert.ok(!input.calls.some(call => call.args[0] === '--prefix' && call.args[1] === 'icu4c@70'));
  }
});

test('T-51 unsupported old-keg retention aborts before framework mutation or promotion', nativeMac, async t => {
  for (const behavior of [{ removeOld: true }, { removeDependency: true }, { modifyOld: true }]) {
    const input = await setup(t, behavior);
    await assert.rejects(switchToHomebrew(input.options), error => {
      assert.equal(error.cause.code, 'HOMEBREW_RETENTION_UNSUPPORTED');
      return true;
    });
    assert.ok(!input.calls.some(call => call.args[0] === 'link'));
    assert.ok(!input.calls.some(call => call.command === path.join(input.newKeg, 'bin', 'sdlc')));
    if (!behavior.modifyOld) {
      assert.equal(await fs.readlink(input.destination), input.target(input.oldKeg));
      assert.equal(await fs.readFile(input.node, 'utf8'), 'native node fixture\n');
    }
  }
});

test('T-51 failed post-promotion hooks or doctor roll back without old-keg cleanup', nativeMac, async t => {
  for (const behavior of [{ failPostPromotionHook: true }, { failPostPromotionDoctor: true }]) {
    const input = await setup(t, behavior);
    await assert.rejects(switchToHomebrew(input.options), error => {
      assert.equal(error.code, 'HOMEBREW_SWITCH_FAILED');
      return true;
    });
    assert.equal(await fs.readlink(input.destination), input.target(input.oldKeg));
    assert.ok(!input.calls.some(call => ['uninstall', 'cleanup'].includes(call.args[0])));
    await fs.access(path.join(input.oldKeg, 'bin', 'sdlc'));
  }
});

test('T-51 install and doctor failure restore the exact pre-install keg and link, not the new version', nativeMac, async t => {
  for (const behavior of [{ failInstall: true, removeDependency: true }, { failDoctor: true }]) {
    const input = await setup(t, behavior);
    await assert.rejects(switchToHomebrew(input.options), error => {
      assert.equal(error.code, 'HOMEBREW_SWITCH_FAILED');
      return true;
    });
    assert.equal(await fs.readlink(input.destination), input.target(input.oldKeg));
    assert.equal(await fs.readlink(path.join(input.prefix, 'opt', 'ai-sdlc-framework')), input.oldKeg);
    await fs.access(input.node);
    await fs.access(path.join(input.oldKeg, 'INSTALL_RECEIPT.json'));
  }
});

test('T-51 a racing unidentified link is retained and incomplete rollback is reported', nativeMac, async t => {
  const input = await setup(t, { foreignLink: true });
  await assert.rejects(switchToHomebrew(input.options), error => {
    assert.equal(error.code, 'HOMEBREW_SWITCH_INCOMPLETE');
    return true;
  });
  assert.equal(await fs.readFile(input.destination, 'utf8'), 'unidentified replacement');
  await fs.access(path.join(input.oldKeg, 'bin', 'sdlc'));
  await fs.access(path.join(input.captured().kegs[0].backup, 'bin', 'sdlc'));
});

test('T-51 reverse switching retains dependency-only Node before removal and executes hooks afterward', nativeMac, async t => {
  const input = await setup(t);
  const result = await switchFromHomebrew(input.options);
  assert.equal(result.oldPackageRemoved, true);
  assert.equal(result.postSwitchVerified, true);
  assert.equal(JSON.parse(await fs.readFile(path.join(input.nodeKeg, 'INSTALL_RECEIPT.json'), 'utf8')).installed_on_request, true);
  const removedIndex = input.calls.findIndex(call => call.args[0] === 'uninstall');
  assert.ok(input.calls.findIndex(call => call.args[0] === 'tab') < removedIndex);
  assert.ok(input.calls.slice(removedIndex + 1).some(call => call.command === input.node && call.args[1] === 'doctor'));
  assert.ok(input.calls.slice(removedIndex + 1).some(call => call.command === input.node && call.args[1] === 'hook'));
});

test('T-51 failed runtime retention prevents old-package removal', nativeMac, async t => {
  const input = await setup(t, { failRetention: true });
  await assert.rejects(switchFromHomebrew(input.options), /did not retain Node/u);
  assert.ok(!input.calls.some(call => call.args[0] === 'uninstall'));
  assert.equal(await fs.readlink(input.destination), input.target(input.oldKeg));
});

test('T-51 missing runtime or failing hooks after removal restores the captured old channel', nativeMac, async t => {
  for (const behavior of [{ removeRuntime: true }, { failPostRemovalHook: true }]) {
    const input = await setup(t, behavior);
    await assert.rejects(switchFromHomebrew(input.options), error => {
      assert.equal(error.code, 'HOMEBREW_SWITCH_FAILED');
      return true;
    });
    await fs.access(input.node);
    assert.equal(await fs.readlink(input.destination), input.target(input.oldKeg));
    assert.equal(await fs.readFile(path.join(input.oldKeg, 'bin', 'sdlc'), 'utf8'), 'old or new 0.3.0\n');
  }
});

test('T-51 incompatible or malformed Node probes fail before retention or package removal', nativeMac, async t => {
  for (const nodeMajor of [21, null, '22']) {
    const input = await setup(t, { nodeMajor });
    await assert.rejects(switchFromHomebrew(input.options), /native Node 22/u);
    assert.ok(!input.calls.some(call => ['tab', 'uninstall'].includes(call.args[0])));
    assert.equal(await fs.readlink(input.destination), input.target(input.oldKeg));
  }
});

test('T-51 unidentified initial links and translated hosts fail before brew mutation', nativeMac, async t => {
  const unidentified = await setup(t);
  await fs.unlink(unidentified.destination);
  await fs.writeFile(unidentified.destination, 'not owned');
  await assert.rejects(switchToHomebrew(unidentified.options), /Unidentified sdlc/u);
  assert.ok(!unidentified.calls.some(call => call.args[0] === 'install'));
  assert.equal(await fs.readFile(unidentified.destination, 'utf8'), 'not owned');
  const translated = await setup(t, { translated: '1' });
  await assert.rejects(switchFromHomebrew(translated.options), /Rosetta/u);
  assert.ok(!translated.calls.some(call => ['install', 'tab', 'uninstall'].includes(call.args[0])));
});
