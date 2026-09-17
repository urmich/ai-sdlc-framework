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
  const newKeg = path.join(cellar, 'ai-sdlc-framework', '0.4.0');
  const nodeKeg = path.join(cellar, 'node@22', '22.23.2');
  const node = path.join(nodeKeg, 'bin', 'node');
  const destination = path.join(prefix, 'bin', 'sdlc');
  const home = path.join(root, 'copilot home');
  const sourceRoot = path.join(root, 'non-global npm', 'node_modules', 'ai-sdlc-framework');
  const formula = 'local/candidate/ai-sdlc-framework';
  const receipt = dependencies => JSON.stringify({
    installed_on_request: false, source: { tap: 'local/candidate' },
    runtime_dependencies: dependencies,
  });
  const dependencies = [{ full_name: 'node@22', pkg_version: '22.23.2' }];
  async function keg(directory, version) {
    await fs.mkdir(path.join(directory, 'bin'), { recursive: true });
    await fs.mkdir(path.join(directory, 'libexec', 'package'), { recursive: true });
    await fs.writeFile(path.join(directory, 'bin', 'sdlc'), `old or new ${version}\n`);
    await fs.writeFile(path.join(directory, 'libexec', 'package', 'package.json'),
      JSON.stringify({ name: 'ai-sdlc-framework', version }));
    await fs.writeFile(path.join(directory, 'INSTALL_RECEIPT.json'), receipt(dependencies));
  }
  await keg(oldKeg, '0.3.0');
  await fs.mkdir(path.join(nodeKeg, 'bin'), { recursive: true });
  await fs.writeFile(node, 'native node fixture\n', { mode: 0o755 });
  await fs.writeFile(path.join(nodeKeg, 'INSTALL_RECEIPT.json'), receipt([]));
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
  let captured;
  const json = value => ({ stdout: JSON.stringify(value), stderr: '' });
  async function writeHooks() {
    await fs.writeFile(path.join(home, 'hooks', 'sdlc.json'), JSON.stringify({
      hooks: { sessionStart: [{
        exec: node, args: [path.join(home, 'sdlc', 'bin', 'sdlc.mjs'), 'hook', 'sessionStart'],
      }] },
    }));
  }
  const run = async (command, args) => {
    calls.push({ command, args });
    if (command === '/usr/bin/uname') return { stdout: process.arch === 'arm64' ? 'arm64' : 'x86_64' };
    if (command === '/usr/sbin/sysctl') return { stdout: behavior.translated ?? '0' };
    if (command === 'fake-brew') {
      if (args[0] === '--prefix') return {
        stdout: args[1] === undefined ? prefix : args[1] === 'node@22' ? nodeKeg : installedNew ? newKeg : oldKeg,
      };
      if (args[0] === '--cellar') return { stdout: cellar };
      if (['install', 'tab'].includes(args[0])) {
        const lock = JSON.parse(await fs.readFile(path.join(prefix, 'var', 'ai-sdlc-framework-switch', 'active.lock'), 'utf8'));
        captured = JSON.parse(await fs.readFile(path.join(lock.root, 'state.json'), 'utf8'));
        assert.equal(captured.capturedBeforeBrew, true);
        assert.equal(captured.phase, args[0] === 'install' ? 'installing-new-channel' : 'retaining-node');
        assert.equal(captured.capturedLink.absolute, path.join(oldKeg, 'bin', 'sdlc'));
        assert.equal(captured.targetKeg, oldKeg);
        assert.ok(captured.kegs.some(item => item.path === nodeKeg));
        assert.deepEqual(captured.installedVersions[0].versions, ['0.3.0']);
        await fs.access(path.join(captured.kegs[0].backup, 'bin', 'sdlc'));
      }
      if (args[0] === 'install') {
        await fs.unlink(destination);
        await fs.rm(oldKeg, { recursive: true });
        if (behavior.removeDependency) await fs.rm(nodeKeg, { recursive: true });
        if (behavior.failInstall) throw new Error('brew install failed after cleaning the old keg');
        await keg(newKeg, '0.4.0');
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
        await fs.symlink(target(newKeg), destination);
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
        return json({});
      }
      if (action === 'install') { await writeHooks(); return json({ installed: true }); }
      if (action === 'doctor') return json({
        installed: true, home, frameworkVersion: '0.4.0', findings: [],
      });
    }
    if (command === path.join(newKeg, 'bin', 'sdlc')) {
      if (args[0] === 'install') { await writeHooks(); return json({ installed: true }); }
      if (args[0] === 'doctor') return json({
        installed: true, home, frameworkVersion: '0.4.0',
        findings: behavior.failDoctor ? ['failed doctor'] : [],
      });
    }
    throw new Error(`Unexpected invocation: ${command} ${args}`);
  };
  return { root, prefix, cellar, oldKeg, newKeg, nodeKeg, node, destination,
    home, sourceRoot, formula, run, calls, target, captured: () => captured,
    options: { brew: 'fake-brew', formula, home, sourceRoot, run } };
}

test('T-51 switching captures old version/dependencies before brew can unlink and clean it', nativeMac, async t => {
  const input = await setup(t, { removeDependency: true });
  const result = await switchToHomebrew(input.options);
  assert.equal(result.linked, true);
  assert.equal(await fs.readlink(input.destination), input.target(input.newKeg));
  assert.equal(await fs.readFile(path.join(input.oldKeg, 'bin', 'sdlc'), 'utf8'), 'old or new 0.3.0\n');
  assert.equal(await fs.readFile(input.node, 'utf8'), 'native node fixture\n');
  const state = JSON.parse(await fs.readFile(result.stateFile, 'utf8'));
  assert.equal(state.phase, 'complete');
  assert.equal(state.previousKeg, input.oldKeg);
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
