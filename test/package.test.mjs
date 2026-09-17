import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildPackage, npmInvocation } from '../scripts/package.mjs';
import { packageInstallArguments, verifyPackage } from '../scripts/verify-package.mjs';
import { isolatedNpmEnvironment } from './npm-environment.mjs';

test('T-36 package is reproducible, integrity-bound and installable in isolation', async t => {
  const root = path.resolve('.test-data', randomUUID());
  await fs.mkdir(root, { recursive: true });
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  const environment = await isolatedNpmEnvironment(root);
  const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
  assert.equal(pkg.publishConfig?.access, 'public');
  assert.equal(pkg.publishConfig?.registry, 'https://registry.npmjs.org');
  assert.match(pkg.repository?.url ?? '', /^https:\/\/github\.com\/[^/]+\/[^/]+\.git$/u);
  const built = await buildPackage({ outputDir: path.join(root, 'dist'), environment });
  assert.equal(built.filename, `${pkg.name}-${pkg.version}.tgz`);
  assert.match(built.sha256, /^[a-f0-9]{64}$/u);
  assert.ok(built.files.some(file => file.path === 'bin/sdlc.mjs'));
  assert.ok(built.files.some(file =>
    file.path === 'docs/provider-adapters.md'));
  assert.ok(!built.files.some(file => file.path.startsWith('test/') ||
    file.path.startsWith('runtime/') || file.path.startsWith('.git/')));
  assert.deepEqual(await fs.readdir(path.dirname(built.artifact)), [built.filename]);
  const workflow = await fs.readFile('.github/workflows/ci.yml', 'utf8');
  for (const contract of ['npm run check', 'npm test', 'npm run package:artifact',
    'npm run verify:package', 'actions/upload-artifact@v4', 'dist/*',
    'id-token: write', '--provenance', 'EXPECTED_REPOSITORY_URL',
    'GH_REPO: ${{ github.repository }}']) {
    assert.ok(workflow.includes(contract));
  }
  const sourceBefore = await fs.readFile('src/core.mjs');
  await assert.rejects(buildPackage({ outputDir: 'src' }),
    /empty or contain only owned distribution files/u);
  assert.deepEqual(await fs.readFile('src/core.mjs'), sourceBefore);
  const windowsNpm = npmInvocation(['pack'], {
    platform: 'win32', execPath: 'C:\\Program Files\\nodejs\\node.exe', npmExecPath: '',
  });
  assert.equal(windowsNpm.command, 'C:\\Program Files\\nodejs\\node.exe');
  assert.match(windowsNpm.args[0], /npm-cli\.js$/u);
  assert.ok(!windowsNpm.args[0].endsWith('.cmd'));
  assert.ok(packageInstallArguments('prefix', 'artifact.tgz').includes('--bin-links=false'));
  const verified = await verifyPackage({ artifact: built.artifact, environment });
  assert.equal(verified.verified, true);
  assert.equal(verified.sha256, built.sha256);
  const previousUmask = process.umask(0o077);
  try {
    assert.equal((await verifyPackage({ artifact: built.artifact, environment })).verified, true);
  } finally {
    process.umask(previousUmask);
  }
  await fs.appendFile(built.artifact, Buffer.from([0]));
  await assert.rejects(verifyPackage({ artifact: built.artifact, environment }),
    /identity or integrity/u);
});
