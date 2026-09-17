import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { requireHealthyDoctor, verifyRetainedFramework } from '../packaging/winget/smoke.mjs';

const execute = promisify(execFile);

test('T-51 WinGet requires empty doctor findings at every lifecycle phase', () => {
  for (const phase of ['after install', 'after upgrade', 'after channel removal']) {
    const good = { installed: true, frameworkVersion: '0.3.0', findings: [] };
    requireHealthyDoctor(good, '0.3.0', phase);
    for (const findings of [undefined, null, '', ['modified installed file'], { length: 0 }]) {
      assert.throws(() => requireHealthyDoctor({ ...good, findings }, '0.3.0', phase), /findings must be empty/u);
    }
    assert.throws(() => requireHealthyDoctor({ ...good, installed: false }, '0.3.0', phase), /must remain installed/u);
    assert.throws(() => requireHealthyDoctor(good, '0.4.0', phase), /version must match/u);
  }
});

test('T-51 post-removal WinGet evidence executes installed hooks and rejects hook/doctor failures', async t => {
  const root = path.resolve('.test-data', `winget retained framework ${randomUUID()}`);
  const home = path.join(root, 'Copilot home');
  const removedRoot = path.join(root, 'removed channel');
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(path.join(removedRoot, 'bin'), { recursive: true });
  await fs.writeFile(path.join(removedRoot, 'bin', 'sdlc.exe'), 'channel fixture');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const environment = { ...process.env, COPILOT_HOME: home };
  const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
  await execute(process.execPath, [path.resolve('bin/sdlc.mjs'), 'install', '--home', home], { env: environment });
  const options = { home, version: pkg.version, removedRoot, workspace: root, environment };
  await assert.rejects(verifyRetainedFramework(options), /must already be removed/u);
  await fs.rm(removedRoot, { recursive: true });
  assert.deepEqual(await verifyRetainedFramework(options), { hook: 'Passed', doctor: 'Passed' });

  const skill = path.join(home, 'skills', 'sdlc', 'SKILL.md');
  const originalSkill = await fs.readFile(skill);
  await fs.appendFile(skill, '\nChanged after package removal.\n');
  await assert.rejects(verifyRetainedFramework(options), /doctor findings must be empty/u);
  await fs.writeFile(skill, originalSkill);

  const entry = path.join(home, 'sdlc', 'bin', 'sdlc.mjs');
  const originalEntry = await fs.readFile(entry);
  await fs.writeFile(entry, "process.stderr.write('installed hook failure'); process.exit(19);\n");
  await assert.rejects(verifyRetainedFramework(options), error => error.code === 19 && error.frameworkFailure === true);
  await fs.writeFile(entry, "process.stdout.write('{}');\n");
  await assert.rejects(verifyRetainedFramework(options), error => error.frameworkFailure === true);
  await fs.writeFile(entry, originalEntry);
  await assert.rejects(verifyRetainedFramework({ ...options, version: '99.0.0' }), /framework version must match/u);
  assert.deepEqual(await verifyRetainedFramework(options), { hook: 'Passed', doctor: 'Passed' });
  assert.ok(!(await fs.readdir(root)).some(name => name.startsWith('post-removal-hook-')),
    'Hook evidence input files must be cleaned up on success and failure');
});
