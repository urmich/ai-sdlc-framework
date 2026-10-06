import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Store } from '../src/store.mjs';
import { install, uninstall } from '../src/install.mjs';
import { canonical, digest, fingerprint } from '../src/core.mjs';
import { canonicalPath } from '../src/files.mjs';
import { validateRecord } from '../src/schemas.mjs';

const execute = promisify(execFile);

test('T-115 native Windows candidate loads all eight advisory hooks in an isolated Copilot home',
  { skip: process.platform !== 'win32' }, async t => {
    const root = path.resolve('.test-data', `windows-hooks-${randomUUID()}`);
    const home = path.join(root, 'Copilot home with spaces');
    await fs.mkdir(home, { recursive: true });
    t.after(async () => {
      assert.equal(path.dirname(root), path.resolve('.test-data'));
      await fs.rm(root, { recursive: true });
      await assert.rejects(fs.stat(root), { code: 'ENOENT' });
    });
    assert.equal(process.arch, 'x64');
    assert.ok(Number(process.versions.node.split('.')[0]) >= 22);
    const node = await fs.readFile(process.execPath);
    const peOffset = node.readUInt32LE(0x3c);
    assert.equal(node.readUInt16LE(peOffset + 4), 0x8664);

    const preserved = path.join(home, 'unrelated.txt');
    await fs.writeFile(preserved, 'keep');
    const isolatedUser = path.join(root, 'user');
    const isolatedTemp = path.join(root, 'temp');
    const appData = path.join(root, 'app-data');
    const localAppData = path.join(root, 'local-app-data');
    const configHome = path.join(root, 'config');
    const cacheHome = path.join(root, 'cache');
    const repository = path.join(root, 'repository');
    for (const directory of [isolatedUser, isolatedTemp, appData,
      localAppData, configHome, cacheHome, repository]) {
      await fs.mkdir(directory);
    }
    const gitConfig = path.join(root, 'empty-git-config');
    await fs.writeFile(gitConfig, '');
    const childEnvironment = {
      ...Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'ComSpec',
        'PATHEXT', 'OS', 'PROCESSOR_ARCHITECTURE']
        .filter(key => typeof process.env[key] === 'string')
        .map(key => [key, process.env[key]])),
      COPILOT_HOME: home,
      HOME: isolatedUser, USERPROFILE: isolatedUser,
      TEMP: isolatedTemp, TMP: isolatedTemp, TMPDIR: isolatedTemp,
      APPDATA: appData, LOCALAPPDATA: localAppData,
      XDG_CONFIG_HOME: configHome, XDG_CACHE_HOME: cacheHome,
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: gitConfig,
    };
    await execute('git', ['init', '-q', '-b', 'feature/fixture'], {
      cwd: repository, env: childEnvironment,
    });
    const store = await new Store(home).ready();
    assert.equal((await install(store)).installed, true);
    const installedEntry = path.join(home, 'sdlc', 'bin', 'sdlc.mjs');
    const fixtureDoctor = async () => JSON.parse((await execute(
      process.execPath, [installedEntry, 'doctor', '--home', home], {
        cwd: repository, env: childEnvironment,
      })).stdout);
    const before = await fixtureDoctor();
    assert.equal(before.installed, true);
    assert.equal(before.frameworkVersion, '0.3.1');
    assert.deepEqual(before.findings, []);

    const config = JSON.parse(await fs.readFile(
      path.join(home, 'hooks', 'sdlc.json'), 'utf8'));
    const events = ['sessionStart', 'userPromptSubmitted', 'preToolUse',
      'postToolUse', 'postToolUseFailure', 'preCompact', 'agentStop',
      'sessionEnd'];
    assert.deepEqual(Object.keys(config.hooks).sort(), [...events].sort());
    const sessionId = `hook-smoke-${randomUUID()}`;
    const sessionFile = path.join(home, 'sdlc', 'runtime', 'sessions',
      `${sessionId}.json`);
    let workItemId;
    let lastReceiptId;
    let previousOrientation;
    let previousCheckpointRevision = 0;
    for (const event of events) {
      const [handler] = config.hooks[event];
      assert.ok(handler);
      assert.equal(path.resolve(handler.exec), path.resolve(process.execPath));
      assert.deepEqual(handler.args, [
        path.join(home, 'sdlc', 'bin', 'sdlc.mjs'),
        ...(event === 'preToolUse' ? ['gate'] : ['hook', event]),
        '--home', home,
      ]);
      const payload = {
        sessionId, cwd: repository,
        ...(event === 'userPromptSubmitted' ?
          { prompt: 'Inspect a local fixture without changing it.' } : {}),
        ...(event === 'preToolUse' ? {
          toolName: 'unknown_mutator',
          toolArgs: { target: 'synthetic-only' },
        } : {}),
        ...(event === 'postToolUse' ? {
          toolName: 'ask_user', toolArgs: {},
          toolResult: { textResultForLlm: 'Fixture confirmation' },
        } : {}),
        ...(event === 'postToolUseFailure' ? {
          toolName: 'powershell',
          toolArgs: { command: 'Get-ChildItem -LiteralPath .' },
        } : {}),
      };
      const pending = execute(handler.exec, handler.args, {
        cwd: repository, env: childEnvironment,
        timeout: 30_000,
      });
      pending.child.stdin?.end(JSON.stringify(payload));
      const { stdout, stderr } = await pending;
      assert.equal(stderr, '', `${event}: unexpected hook error`);
      const lines = stdout.trim().split(/\r?\n/u).map(line => JSON.parse(line));
      assert.ok(lines.length >= 1, `${event}: missing JSON output`);
      const last = lines.at(-1);
      assert.equal(last.permissionDecision, undefined, event);
      assert.doesNotMatch(stdout, /1\.2\.4|old runtime path/iu);
      if (event === 'preToolUse') assert.deepEqual(last, {});
      if (event === 'sessionStart') {
        assert.match(last.additionalContext, /lifecycle stages are advisory/u);
      }
      const session = JSON.parse(await fs.readFile(sessionFile, 'utf8'));
      if (event === 'userPromptSubmitted' || event === 'postToolUse') {
        assert.ok(session.lastReceiptId);
        if (lastReceiptId) assert.notEqual(session.lastReceiptId, lastReceiptId);
        lastReceiptId = session.lastReceiptId;
        const receipt = await fs.readFile(path.join(home, 'sdlc', 'runtime',
          'sessions', sessionId, 'receipts', `${lastReceiptId}.json`), 'utf8');
        assert.doesNotMatch(receipt, /Fixture confirmation|Inspect a local fixture/u);
      }
      if (event === 'postToolUse') {
        const action = { class: 'read', repositoryId: 'primary' };
        const observedCwd = await canonicalPath(repository);
        const synthetic = validateRecord({
          type: 'operation', id: 'op-synthetic-failure',
          workItemId, sessionId, repositoryId: 'primary',
          bindingKey: 'fixture-binding', class: 'read', action,
          target: 'local', status: 'dispatching',
          correlationKey: 'synthetic-hook-failure',
          requestFingerprint: fingerprint('powershell',
            { command: 'Get-ChildItem -LiteralPath .' }, observedCwd),
          effectFingerprint: digest(action),
          intent: 'Verify failure-hook reconciliation without any external action',
          createdAt: new Date().toISOString(),
          dispatchBound: true,
        });
        const operationFile = store.recordPath(workItemId, synthetic.id);
        await fs.mkdir(path.dirname(operationFile), { recursive: true });
        await fs.writeFile(operationFile, `${canonical(synthetic)}\n`, {
          flag: 'wx',
        });
      }
      if (event === 'userPromptSubmitted') {
        const pendingInit = execute(process.execPath, [
          installedEntry, 'init', '--home', home,
          '--cwd', repository, '--session', sessionId,
        ], { cwd: repository, env: childEnvironment });
        pendingInit.child.stdin?.end(JSON.stringify({
          repositoryId: 'primary', sessionId, cwd: repository,
        }));
        workItemId = JSON.parse((await pendingInit).stdout).workItemId;
        assert.ok(workItemId);
      }
      if (event === 'preToolUse') {
        assert.ok(session.unmanagedRequestFingerprints?.length > 0,
          'The advisory gate records an unsupported call as unmanaged');
      }
      if (event === 'postToolUseFailure') {
        assert.equal(session.workItemId, workItemId,
          'The failed-tool hook must see the fixture work-item binding');
        const recorded = (await store.records(workItemId)).find(record =>
          record.id === 'op-synthetic-failure');
        assert.equal(recorded?.status, 'uncertain',
          'The failed-tool hook must not credit or retry an unresolved result');
      }
      if (event === 'agentStop') {
        const checkpoint = JSON.parse(await fs.readFile(path.join(home,
          'sdlc', 'runtime', 'work-items', workItemId,
          'checkpoint.json'), 'utf8'));
        assert.ok(checkpoint.revision > previousCheckpointRevision,
          'The agent-stop hook runs work-item pruning');
      }
      if (event === 'preCompact' || event === 'sessionEnd') {
        assert.equal(session.orientationGeneration, previousOrientation + 1);
      }
      previousOrientation = session.orientationGeneration;
      if (workItemId) {
        const checkpoint = JSON.parse(await fs.readFile(path.join(home,
          'sdlc', 'runtime', 'work-items', workItemId,
          'checkpoint.json'), 'utf8'));
        previousCheckpointRevision = checkpoint.revision;
      }
    }
    assert.deepEqual((await fixtureDoctor()).findings, []);
    await uninstall(store);
    await assert.rejects(fs.stat(path.join(home, 'hooks', 'sdlc.json')),
      { code: 'ENOENT' });
    assert.equal(await fs.readFile(preserved, 'utf8'), 'keep');
  });
