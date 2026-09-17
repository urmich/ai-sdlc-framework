import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { TOOLCHAIN } from '../packaging/winget/build-launcher.mjs';

const execute = promisify(execFile);
const goCommand = process.env.SDLC_GO || 'go';
const enabled = !!process.env.SDLC_GO || process.platform === 'win32';

test('T-51 native Go launcher preserves paths, streams, arguments, working directory and child exit code', { skip: !enabled }, async t => {
  const root = path.resolve('.test-data', `winget native with spaces ${randomUUID()}`);
  await fs.mkdir(root, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const env = { ...process.env, ...TOOLCHAIN.environment, GOOS: process.platform === 'win32' ? 'windows' : process.platform,
    GOARCH: process.arch === 'x64' ? 'amd64' : process.arch,
    GOTMPDIR: root, TMPDIR: root, TEMP: root, TMP: root, GOCACHE: path.join(root, 'cache') };
  const { stdout: version } = await execute(goCommand, ['version'], { env });
  assert.equal(version.trim().split(/\s+/u)[2], TOOLCHAIN.goVersion);
  const archiveRoot = path.join(root, 'archive with spaces');
  const entry = path.join(archiveRoot, 'package', 'bin', 'sdlc.mjs');
  const launcher = path.join(archiveRoot, 'bin', 'sdlc.exe');
  await fs.mkdir(path.dirname(entry), { recursive: true });
  await fs.mkdir(path.dirname(launcher), { recursive: true });
  await execute(goCommand, ['build', ...TOOLCHAIN.flags, '-o', launcher, '.'],
    { cwd: path.resolve('cmd/sdlc-launcher'), env, timeout: 180_000 });
  await fs.writeFile(entry, `import * as fs from 'node:fs';
fs.writeFileSync(process.env.COPILOT_HOME + '/invoked', 'CLI invoked');
process.stdout.write(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(),
  node: process.execPath, options: process.env.NODE_OPTIONS ?? null,
  home: process.env.COPILOT_HOME, stdin: fs.readFileSync(0, 'utf8') }));
process.stderr.write('child stderr');
process.exit(Number(process.env.SDLC_TEST_EXIT ?? 0));
`);
  const nodeDirectory = path.join(root, 'node with spaces');
  const home = path.join(root, 'isolated Copilot home');
  const cwd = path.join(root, 'unrelated working directory');
  for (const directory of [nodeDirectory, home, cwd]) await fs.mkdir(directory);
  const node = path.join(nodeDirectory, process.platform === 'win32' ? 'node.exe' : 'node');
  if (process.platform === 'win32') await fs.copyFile(process.execPath, node);
  else await fs.symlink(process.execPath, node);
  const runtimeEnv = { ...process.env, PATH: nodeDirectory, PATHEXT: '.EXE;.CMD',
    COPILOT_HOME: home, NODE_OPTIONS: '--import=missing-preload.mjs', NODE_PATH: 'untrusted-preload' };
  delete runtimeEnv.SDLC_NODE;
  const args = ['install', '--home', 'path with spaces', '& echo SHOULD_NOT_RUN', '"quoted"', '', 'unicode-λ', '--purge-existing'];
  const run = command => new Promise(resolve => {
    const child = execFile(command, args, { cwd, env: runtimeEnv }, (error, stdout, stderr) =>
      resolve({ error, stdout, stderr }));
    child.stdin.end('forwarded stdin');
  });
  const result = await run(launcher);
  assert.ifError(result.error);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.args, args);
  assert.equal(output.cwd, cwd);
  assert.equal(output.home, home);
  assert.equal(output.options, null);
  assert.equal(output.stdin, 'forwarded stdin');
  assert.equal(result.stderr, 'child stderr');
  assert.equal(await fs.readFile(path.join(home, 'invoked'), 'utf8'), 'CLI invoked');
  runtimeEnv.SDLC_TEST_EXIT = '37';
  const failure = await run(launcher);
  assert.equal(failure.error.code, 37);
  assert.equal(failure.stderr, 'child stderr');
  delete runtimeEnv.SDLC_TEST_EXIT;
  const alias = path.join(root, 'Microsoft', 'WinGet', 'Links', 'sdlc.exe');
  await fs.mkdir(path.dirname(alias), { recursive: true });
  try {
    await fs.symlink(launcher, alias);
    const linked = await run(alias);
    assert.ifError(linked.error);
    assert.deepEqual(JSON.parse(linked.stdout).args, args);
  } catch (error) {
    if (process.platform !== 'win32' || error.code !== 'EPERM') throw error;
    t.diagnostic('Native Links symlink fixture unavailable; real winget install remains mandatory');
  }
  await fs.unlink(path.join(home, 'invoked'));
  runtimeEnv.PATH = cwd;
  const missing = await run(launcher);
  assert.equal(missing.error.code, 1);
  assert.match(missing.stderr, /Node.js 22\+ must be available on PATH/u);
  await assert.rejects(fs.stat(path.join(home, 'invoked')), { code: 'ENOENT' });
  runtimeEnv.SDLC_NODE = node;
  const overridden = await run(launcher);
  assert.ifError(overridden.error);
  assert.equal((await fs.realpath(JSON.parse(overridden.stdout).node)).toLowerCase(),
    (await fs.realpath(node)).toLowerCase());
  await fs.unlink(path.join(home, 'invoked'));
  runtimeEnv.SDLC_NODE = 'node';
  const relativeOverride = await run(launcher);
  assert.equal(relativeOverride.error.code, 1);
  assert.match(relativeOverride.stderr, /SDLC_NODE must identify an absolute/u);
  await assert.rejects(fs.stat(path.join(home, 'invoked')), { code: 'ENOENT' });
  delete runtimeEnv.SDLC_NODE;
  runtimeEnv.PATH = nodeDirectory;
  await fs.unlink(entry);
  const missingPayload = await run(launcher);
  assert.equal(missingPayload.error.code, 1);
  assert.match(missingPayload.stderr, /package\/bin\/sdlc.mjs is unavailable/u);
});
