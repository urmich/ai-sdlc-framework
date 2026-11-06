import * as fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { sha256 } from '../packaging/standalone/archive.mjs';
import { digest } from '../src/core.mjs';

export async function seedConsumerPreservation(home) {
  const sentinels = [
    ['user-settings.json', '{"consumerOwned":true}\n'],
    ['skills/community-consumer/SKILL.md', 'Unrelated consumer skill.\n'],
    ['hooks/community-consumer.json', '{"consumerOwned":true}\n'],
  ];
  for (const [relative, contents] of sentinels) {
    const file = path.join(home, ...relative.split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, contents, { flag: 'wx' });
  }
  return async () => {
    for (const [relative, contents] of sentinels) {
      assert.equal(await fs.readFile(path.join(home, ...relative.split('/')), 'utf8'), contents,
        `Consumer maintenance changed unrelated content: ${relative}`);
    }
  };
}

async function ownedManifest(home) {
  const manifest = JSON.parse(await fs.readFile(path.join(home, 'sdlc', 'install-manifest.json'), 'utf8'));
  assert.equal(manifest.owner, 'ai-sdlc-framework', 'Consumer ownership manifest is missing or foreign');
  assert.equal(manifest.schemaVersion, 1);
  assert.ok(Object.keys(manifest.files ?? {}).length, 'An empty ownership inventory cannot prove installation');
  for (const relative of Object.keys(manifest.files)) {
    assert.ok(!path.isAbsolute(relative) && !relative.split(/[\\/]/u).some(part => !part || part === '..'),
      'Unsafe consumer ownership inventory');
  }
  return manifest;
}

export async function installedConsumerSnapshot(home, version) {
  const manifest = await ownedManifest(home);
  assert.equal(manifest.version, version, 'Installed ownership version differs from the selected package');
  const files = [];
  for (const [relative, expected] of Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b))) {
    const file = path.join(home, ...relative.split('/'));
    assert.ok((await fs.lstat(file)).isFile(), 'Installed owned asset must be a literal file');
    const bytes = await fs.readFile(file);
    // Install manifests use the framework digest, not the archive SHA-256.
    assert.equal(digest(bytes), expected, `Installed owned bytes differ: ${relative}`);
    files.push({ relative, sha256: sha256(bytes) });
  }
  return { manifest, files, instructions: await fs.readFile(path.join(home, 'copilot-instructions.md'), 'utf8') };
}

export async function assertConsumerUpdate({ home, version, invoke, preserve = async () => {} }) {
  const first = JSON.parse((await invoke(['update'])).stdout);
  assert.equal(first.installed, true, 'Update did not report a completed installation');
  await preserve();
  const before = await installedConsumerSnapshot(home, version);
  const repeated = JSON.parse((await invoke(['update'])).stdout);
  assert.equal(repeated.installed, true);
  assert.deepEqual(repeated.changedFiles, [], 'Repeated update rewrote owned assets');
  assert.deepEqual(await installedConsumerSnapshot(home, version), before,
    'Repeated update changed ownership, instructions or installed bytes');
  await preserve();
  return { status: 'Passed', repeatedChangedFiles: [], version };
}

export async function assertConsumerUninstall({ home, invoke, preserve = async () => {}, purge = false }) {
  const manifest = await ownedManifest(home);
  const result = JSON.parse((await invoke(['uninstall', ...(purge ? ['--purge'] : [])])).stdout);
  assert.equal(result.uninstalled, true, 'Uninstall did not remove the owned installation');
  assert.deepEqual(result.preserved, [], 'An unmodified consumer fixture unexpectedly retained owned assets');
  assert.ok(result.removed?.length || result.purged, 'A no-op uninstall cannot prove removal');
  for (const relative of [...Object.keys(manifest.files), 'sdlc/install-manifest.json']) {
    await assert.rejects(fs.lstat(path.join(home, ...relative.split('/'))), { code: 'ENOENT' },
      `Uninstall retained an owned asset: ${relative}`);
  }
  const instructions = await fs.readFile(path.join(home, 'copilot-instructions.md'), 'utf8');
  assert.ok(!instructions.includes('<!-- ai-sdlc-framework:'), 'Uninstall retained its owned instruction block');
  if (purge) {
    assert.equal(result.purged, true);
    await assert.rejects(fs.lstat(path.join(home, 'sdlc')), { code: 'ENOENT' });
    for (const name of ['sdlc', 'sdlc-requirements', 'sdlc-test-design', 'sdlc-technical-design', 'sdlc-coding']) {
      await assert.rejects(fs.lstat(path.join(home, 'skills', name)), { code: 'ENOENT' });
    }
  }
  await preserve();
  return { status: 'Passed', purged: purge, removedFiles: result.removed?.length ?? 0 };
}

export async function npmPublicCommand({ prefix, packageName, environment, run, platform = process.platform }) {
  const metadata = JSON.parse(await fs.readFile(path.join(prefix, 'node_modules', packageName, 'package.json'), 'utf8'));
  assert.equal(metadata.name, packageName);
  assert.equal(metadata.bin?.sdlc, './bin/sdlc.mjs', 'Package does not declare the supported public npm command');
  const command = path.join(prefix, 'node_modules', '.bin', platform === 'win32' ? 'sdlc.cmd' : 'sdlc');
  const stat = await fs.lstat(command);
  assert.ok(stat.isFile() || (platform !== 'win32' && stat.isSymbolicLink()),
    'npm did not generate its public sdlc command');
  return async args => {
    if (platform !== 'win32') return run(command, args, { env: environment });
    const quote = value => {
      if (/["%!\r\n]/u.test(value)) throw new Error('Unsafe argument for the public npm Windows command');
      return `"${value}"`;
    };
    return run('cmd.exe', ['/d', '/s', '/c', `"${[command, ...args].map(quote).join(' ')}"`],
      { env: environment, windowsVerbatimArguments: true });
  };
}
