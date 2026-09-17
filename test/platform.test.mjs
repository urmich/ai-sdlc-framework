import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fixture, orient } from './helpers.mjs';
import { parseRequirements, parseTestPlan } from '../src/artifacts.mjs';
import { atomicWrite, writeJson } from '../src/files.mjs';
import { evaluateGate as gate, normalizeHook, repositoryPathClassification } from '../src/gate.mjs';
import { doctor } from '../src/install.mjs';
import {
  cmdWords,
  commandWords,
  isUncPath,
  isWindowsDevicePath,
  normalizeToolName,
  platformCapabilities,
  repositoryRelativePath,
  sameNativePath,
  withinNativePath,
} from '../src/platform.mjs';

const execute = promisify(execFile);

test('T-38 documented hook aliases and field shapes normalize without shell guessing', () => {
  const powershell = normalizeHook({
    SessionId: 'session-platform',
    Cwd: 'C:\\repo',
    ToolName: 'PowerShell',
    ToolArgs: 'git status --short',
    ToolResult: { textResultForLlm: 'ok' },
  });
  assert.deepEqual(powershell.toolArgs, { command: 'git status --short' });
  assert.equal(powershell.toolName, 'powershell');
  assert.equal(powershell.sessionId, 'session-platform');
  assert.equal(powershell.cwd, 'C:\\repo');
  assert.equal(powershell.toolResult.textResultForLlm, 'ok');

  for (const alias of ['Cmd', 'cmd.exe', 'CommandPrompt', 'command_prompt']) {
    assert.equal(normalizeHook({ toolName: alias, toolArgs: { command: 'dir' } }).toolName, 'cmd');
  }
  assert.equal(normalizeHook({ toolName: 'unknown-shell', toolArgs: 'dir' }).toolName,
    'unknown-shell');
  assert.equal(normalizeToolName('Bash', { platform: 'win32' }), 'ambiguous-shell');
  assert.equal(normalizeToolName('Bash', {
    platform: 'win32',
    shellHint: 'PowerShell',
  }), 'powershell');
  assert.deepEqual(normalizeHook({
    tool_name: 'PowerShell',
    tool_input: '{"command":"git status --short"}',
  }).toolArgs, { command: 'git status --short' });
});

test('T-38 Bash, PowerShell and cmd use separate conservative token contracts', () => {
  assert.deepEqual(commandWords('bash', `node script.mjs "space value" '' trailing\\\\`),
    ['node', 'script.mjs', 'space value', '', 'trailing\\']);
  assert.deepEqual(commandWords('powershell', `node script.mjs 'space value' trailing\\`),
    ['node', 'script.mjs', 'space value', 'trailing\\']);
  assert.equal(commandWords('powershell', `node script.mjs ''`), null);
  assert.equal(commandWords('powershell', `'C:\\Program Files\\nodejs\\node.exe' script.mjs`), null);
  assert.equal(commandWords('powershell', 'git commit -S:--all --no-gpg-sign -m message'), null);
  assert.equal(commandWords('powershell', 'git commit -S:--amend --no-gpg-sign -m message'), null);
  assert.deepEqual(cmdWords('node script.mjs "space value" "" trailing\\'),
    ['node', 'script.mjs', 'space value', '', 'trailing\\']);
  for (const command of [
    'echo %TEMP%',
    'echo !TEMP!',
    'echo one ^& echo two',
    'echo one & echo two',
    'type file > output',
    'echo (group)',
    'node "C:\\space path\\"',
    'node "one"two',
  ]) {
    assert.equal(cmdWords(command), null, command);
  }
});

test('T-38 Windows path contracts preserve case-sensitive authority and UNC roots', () => {
  assert.equal(withinNativePath('C:\\Workspace\\Repo',
    'C:/Workspace/Repo/src/file.mjs', 'win32'), true);
  assert.equal(withinNativePath('C:\\Workspace\\Repo',
    'C:\\Workspace\\repo\\secret.mjs', 'win32'), false);
  assert.equal(sameNativePath('C:\\Workspace\\Repo',
    'C:\\Workspace\\repo', 'win32'), false);
  assert.equal(withinNativePath('C:\\Workspace\\Repo',
    'D:\\Workspace\\Repo\\file.mjs', 'win32'), false);
  assert.equal(withinNativePath('\\\\server\\share\\Repo',
    '//server/share/Repo/docs/file.md', 'win32'), true);
  assert.equal(withinNativePath('\\\\server\\share\\Repo',
    '\\\\server\\other\\Repo\\file.md', 'win32'), false);
  assert.equal(isUncPath('\\\\server\\share\\Repo'), true);
  assert.equal(isUncPath('\\/server/share/Repo'), true);
  assert.equal(isUncPath('/\\server\\share\\Repo'), true);
  assert.equal(isWindowsDevicePath('\\\\?\\C:\\Repo'), true);
  assert.equal(isWindowsDevicePath('\\\\.\\PIPE\\name'), true);
  assert.equal(repositoryRelativePath('C:\\Workspace\\Repo',
    'C:\\Workspace\\Repo\\.git\\config', 'win32'), '.git/config');
  assert.equal(repositoryRelativePath('C:\\Workspace\\Repo',
    'C:\\Workspace\\Repo\\.sdlc\\config.json', 'win32'), '.sdlc/config.json');
  assert.deepEqual(repositoryPathClassification('C:\\Workspace\\Repo',
    'C:\\Workspace\\repo\\.sdlc\\config.json', 'win32'), {
    relative: '.sdlc/config.json',
    contained: false,
  });
});

test('T-38 repository command adapters are selected by exact host and shell', async t => {
  const f = await fixture(t);
  await writeJson(path.join(f.repo, '.sdlc/config.json'), {
    defaultBranch: 'refs/heads/main',
    commands: [
      { command: 'npm run platform-test', platforms: [process.platform], shell: 'cmd',
        action: { class: 'read' } },
      { command: 'npm run platform-test',
        platforms: [process.platform === 'win32' ? 'darwin' : 'win32'],
        shell: 'cmd', action: { class: 'destructive' } },
    ],
  });
  await orient(f);
  const allowed = await gate(f.store, {
    cwd: f.repo,
    sessionId: f.sessionId,
    toolName: 'CommandPrompt',
    toolArgs: { command: 'npm run platform-test' },
  });
  assert.equal(allowed.permissionDecision, undefined, JSON.stringify(allowed));
  const wrongShell = await gate(f.store, {
    cwd: f.repo,
    sessionId: f.sessionId,
    toolName: 'PowerShell',
    toolArgs: { command: 'npm run platform-test' },
  });
  assert.equal(wrongShell.permissionDecision, 'deny');
});

test('T-38 strict evaluator flags every cmd UNC spelling and device cwd before trusted classification', async t => {
  const f = await fixture(t, { initialize: false });
  for (const cwd of [
    '\\\\server\\share\\repo',
    '//server/share/repo',
    '\\/server/share/repo',
    '/\\server\\share\\repo',
  ]) {
    const result = await gate(f.store, {
      cwd,
      sessionId: 'cmd-unc-session',
      toolName: 'cmd',
      toolArgs: { command: 'git status --short' },
    });
    assert.equal(result.permissionDecision, 'deny', cwd);
    assert.match(result.permissionDecisionReason, /UNC working directories are unavailable/u);
  }
  const device = await gate(f.store, {
    cwd: '\\\\?\\C:\\repo',
    sessionId: 'cmd-device-session',
    toolName: 'cmd',
    toolArgs: { command: 'dir' },
  });
  assert.equal(device.permissionDecision, 'deny');
  assert.match(device.permissionDecisionReason, /device namespace/u);
});

test('T-38 CRLF and LF framework documents parse to the same requirements and tests', () => {
  const requirementsLf = '#### FR-044 - Portable\n**Definition of Done**\n- AC-044.1: Works.\n';
  const planLf = '| ID | Environment | Level | Status | Requirements |\n' +
    '| --- | --- | --- | --- | --- |\n' +
    '| T-38 | local | integration | NotRun | FR-044 |\n';
  assert.deepEqual(parseRequirements(requirementsLf.replaceAll('\n', '\r\n')),
    parseRequirements(requirementsLf));
  assert.deepEqual(parseTestPlan(planLf.replaceAll('\n', '\r\n')),
    parseTestPlan(planLf));
  assert.equal(parseRequirements(requirementsLf).length, 1);
  assert.equal(parseTestPlan(planLf).length, 1);
});

test('T-38 Windows replacement contention retries narrowly and preserves the old file', async t => {
  const f = await fixture(t);
  const file = path.join(f.root, 'windows-replace.json');
  await fs.writeFile(file, 'old');
  let attempts = 0;
  await atomicWrite(file, 'new', {
    platform: 'win32',
    replaceRetryMs: 100,
    sleep: async () => {},
    rename: async (source, target) => {
      attempts++;
      if (attempts < 3) throw Object.assign(new Error('sharing violation'), { code: 'EPERM' });
      await fs.rename(source, target);
    },
  });
  assert.equal(attempts, 3);
  assert.equal(await fs.readFile(file, 'utf8'), 'new');

  await fs.writeFile(file, 'stable');
  await assert.rejects(atomicWrite(file, 'lost', {
    platform: 'win32',
    replaceRetryMs: 0,
    rename: async () => {
      throw Object.assign(new Error('sharing violation'), { code: 'EPERM' });
    },
  }), /sharing violation/u);
  assert.equal(await fs.readFile(file, 'utf8'), 'stable');
});

test('T-39 native macOS shell, filesystem, Git and doctor evidence stays host-specific',
  { skip: process.platform !== 'darwin' }, async t => {
  const f = await fixture(t);
  const observer = path.join(f.root, 'argument observer.mjs');
  await fs.writeFile(observer,
    'process.stdout.write(JSON.stringify({argv:process.argv.slice(2),cwd:process.cwd()}));\n');
  const command = `node '${observer}' "space value" '' trailing\\\\`;
  const expected = commandWords('bash', command);
  const observed = JSON.parse((await execute('/bin/sh', ['-c', command], {
    cwd: f.repo,
    encoding: 'utf8',
  })).stdout);
  assert.deepEqual(observed.argv, expected.slice(2));
  assert.equal(observed.cwd, f.repo);

  const capabilities = await platformCapabilities();
  assert.equal(capabilities.platform, process.platform);
  assert.equal(capabilities.paths.deviceNamespaces, false);
  assert.equal(capabilities.paths.cmdUncCwd, false);
  assert.equal(capabilities.verification.status, 'unverified');
  const report = await doctor(f.store);
  assert.equal(report.platform.platform, process.platform);
  assert.equal(report.capabilities.crossPlatform.nativeVerification, 'unverified');
  assert.equal(report.platform.filesystem.posixModes, true);
  assert.equal(report.platform.paths.unc, false);
  if (capabilities.shells.powershell.available) {
    const psCommand = `node '${observer}' 'space value' trailing\\`;
    const psExpected = commandWords('powershell', psCommand);
    const psObserved = JSON.parse((await execute('pwsh',
      ['-NoLogo', '-NoProfile', '-Command', psCommand], {
        cwd: f.repo,
        encoding: 'utf8',
      })).stdout);
    assert.deepEqual(psObserved.argv, psExpected.slice(2));
    assert.equal(psObserved.cwd, f.repo);
  }
});

test('T-40 native Windows PowerShell and cmd argv contracts',
  { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t);
  const observer = path.join(f.root, 'argument observer.mjs');
  await fs.writeFile(observer,
    'process.stdout.write(JSON.stringify({argv:process.argv.slice(2),cwd:process.cwd()}));\r\n');

  const psCommand = `node '${observer}' 'space value' trailing\\`;
  const psExpected = commandWords('powershell', psCommand);
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
  const powershell = path.win32.join(systemRoot,
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const psObserved = JSON.parse((await execute(powershell,
    ['-NoLogo', '-NoProfile', '-Command', psCommand], {
      cwd: f.repo,
      encoding: 'utf8',
    })).stdout);
  assert.deepEqual(psObserved.argv, psExpected.slice(2));
  assert.equal(sameNativePath(psObserved.cwd, f.repo, 'win32'), true);

  const cmdCommand = `node "${observer}" "space value" "" trailing\\`;
  const cmdExpected = commandWords('cmd', cmdCommand);
  const cmdObserved = JSON.parse((await execute(process.env.ComSpec ?? 'cmd.exe',
    ['/d', '/s', '/c', `"${cmdCommand}"`], {
      cwd: f.repo,
      encoding: 'utf8',
      windowsVerbatimArguments: true,
      windowsHide: true,
    })).stdout);
  assert.deepEqual(cmdObserved.argv, cmdExpected.slice(2));
  assert.equal(sameNativePath(cmdObserved.cwd, f.repo, 'win32'), true);
});
