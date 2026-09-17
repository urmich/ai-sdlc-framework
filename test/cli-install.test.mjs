import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fixture, artifact, coding, cli, grant, orient } from './helpers.mjs';
import { cleanInstall, install, uninstall, doctor, BLOCK_START, canonicalInstalledText } from '../src/install.mjs';
import { registerArtifact } from '../src/artifacts.mjs';
import { aggregate, check } from '../src/checks.mjs';
import { readJson, writeJson } from '../src/files.mjs';
import { safeRecord } from '../src/core.mjs';
import { evaluateGate as gate } from '../src/gate.mjs';
const execute = promisify(execFile);
const packageVersion = JSON.parse(await fs.readFile(
  new URL('../package.json', import.meta.url), 'utf8')).version;

test('T-38 installed framework text uses canonical LF without changing source', () => {
  const source = Buffer.from('first\r\nsecond\rthird\n');
  assert.equal(canonicalInstalledText(source).toString('utf8'), 'first\nsecond\nthird\n');
  assert.equal(source.toString('utf8'), 'first\r\nsecond\rthird\n');
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
  const installedCodingSkill = await fs.readFile(
    path.join(f.home, 'skills/sdlc-coding/SKILL.md'), 'utf8');
  for (const name of ['knowledge-retrieval', 'coding', 'testing', 'building', 'reviewing']) {
    const installedPath = path.join(f.home, `sdlc/instructions/${name}.md`);
    assert.ok(installedGlobal.includes(JSON.stringify(installedPath)));
    assert.ok(installedCodingSkill.includes(JSON.stringify(installedPath)));
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
    'assets/templates', 'assets/instructions', 'assets/hooks', 'docs']) {
    await fs.mkdir(path.join(incompleteSource, directory), { recursive: true });
  }
  await fs.writeFile(path.join(incompleteSource, 'assets/hooks/sdlc.json'),
    '{"hooks":{}}\n');
  await fs.writeFile(path.join(incompleteSource, 'assets/instructions.md'), '');
  await fs.writeFile(path.join(incompleteSource,
    'assets/lifecycle-intent.md'), '');
  await fs.writeFile(path.join(incompleteSource, 'docs/cli.md'), '');
  await fs.writeFile(path.join(incompleteSource,
    'docs/provider-adapters.md'), '');
  await fs.writeFile(path.join(incompleteSource, 'package.json'), JSON.stringify({
    name: 'ai-sdlc-framework',
    version: '9.9.9',
    bin: { sdlc: './bin/sdlc.mjs' },
  }));
  await assert.rejects(cleanInstall(f.store, {
    sourceRoot: incompleteSource,
  }), { code: 'INSTALL' });
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
  await fs.writeFile(lock, '');
  const writer = delay(20).then(() => fs.writeFile(lock, JSON.stringify({
    host: os.hostname(),
    pid: process.pid,
    token: 'live-owner',
  })));
  await assert.rejects(uninstall(f.store, { purge: true }),
    { code: 'LOCK_BUSY' });
  await writer;
  assert.equal(JSON.parse(await fs.readFile(lock, 'utf8')).token,
    'live-owner');
  await fs.unlink(lock);
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
