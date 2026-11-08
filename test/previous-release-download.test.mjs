export const validationDeclarations = {
  "schemaVersion": 1,
  "groups": [
    {"root": "TOOL03 prior-release acquisition recovers one gateway timeout without changing pinned bytes",
      "minimumSlots": 1, "exclusiveResources": []},
    {"root": "TOOL03 prior-release acquisition exhausts its original phase budget without another request",
      "minimumSlots": 1, "exclusiveResources": []},
    {"root": "TOOL03 prior-release acquisition never retries denied responses or mismatched pins",
      "minimumSlots": 1, "exclusiveResources": []}
  ],
  "surfaces": [
    {"coverage": "direct", "paths": ["scripts/accept-release.mjs"]},
    {"coverage": "fixture-only", "paths": ["scripts/package-platforms.mjs", "packaging/standalone/protocol.mjs"]}
  ]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { downloadPreviousRelease, downloadPublicAssets } from '../scripts/accept-release.mjs';
import { canonical, sha256, tarGzip } from '../packaging/standalone/archive.mjs';
import { payloadIdentity } from '../packaging/standalone/protocol.mjs';
import { renderChecksums } from '../scripts/package-platforms.mjs';

async function fixture(t) {
  const directory = path.resolve('.test-data', `previous-download-${randomUUID()}`);
  await fs.mkdir(directory, { recursive: true });
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
    await assert.rejects(fs.lstat(directory), { code: 'ENOENT' });
  });
  const entries = [{
    path: 'package/package.json', mode: 0o644,
    data: Buffer.from(JSON.stringify({ name: 'ai-sdlc-framework', version: '0.3.1', engines: { node: '>=22' } })),
  }];
  for (const file of ['LICENSE', 'bin/sdlc.mjs', 'src/install.mjs', 'packaging/standalone/runtime.mjs',
    'packaging/standalone/install.sh', 'packaging/standalone/install.ps1', 'packaging/standalone/sdlc']) {
    entries.push({ path: `package/${file}`, mode: 0o644,
      data: await fs.readFile(new URL(`../${file}`, import.meta.url)) });
  }
  const bytes = tarGzip(entries);
  const { manifest } = payloadIdentity(bytes);
  const descriptor = { schemaVersion: 1, name: manifest.name, version: manifest.version,
    sourceCommit: 'a'.repeat(40), payload: { ...manifest.payload, inventoryDigest: manifest.inventoryDigest },
    files: [{ filename: manifest.payload.filename, kind: 'archive', sha256: sha256(bytes), size: bytes.length }] };
  const descriptorBytes = Buffer.from(canonical(descriptor));
  const checksums = Buffer.from(renderChecksums(descriptor, descriptorBytes));
  const assets = new Map([['release-descriptor.json', descriptorBytes], ['SHA256SUMS', checksums],
    [manifest.payload.filename, bytes]]);
  return { directory, assets, identity: { repository: 'urmich/ai-sdlc-framework', version: '0.3.1',
    descriptorSha256: sha256(descriptorBytes), checksumsSha256: sha256(checksums) } };
}

function clock(timeoutMs = 600_000) {
  let time = 0;
  const sleeps = [];
  const observations = [];
  return { sleeps, observations, options: { timeoutMs, now: () => time,
    sleep: async ms => { sleeps.push(ms); time += ms; },
    observe: value => observations.push(value) } };
}

test('TOOL03 prior-release acquisition recovers one gateway timeout without changing pinned bytes', async t => {
  const f = await fixture(t);
  for (const failedAsset of f.assets.keys()) {
    const timing = clock();
    const requests = [];
    let cancelled = 0;
    let failed = false;
    const fetcher = async (url, options) => {
      assert.equal(options.headers, undefined);
      assert.equal(options.signal.aborted, false);
      const name = new URL(url).pathname.split('/').at(-1);
      requests.push(name);
      if (name === failedAsset && !failed) {
        failed = true;
        return { status: 504, ok: false, body: { cancel: async () => { cancelled++; } },
          arrayBuffer: () => assert.fail('Gateway error bodies must not become release bytes') };
      }
      return new Response(f.assets.get(name));
    };
    const directory = path.join(f.directory, failedAsset);
    const result = await downloadPreviousRelease({ ...f.identity, directory, fetcher, readbackOptions: timing.options });
    assert.equal(result.identity.descriptorSha256, f.identity.descriptorSha256);
    assert.equal(result.identity.checksumsSha256, f.identity.checksumsSha256);
    assert.equal(cancelled, 1);
    assert.deepEqual(timing.sleeps, [1000]);
    const expected = [...f.assets.keys()].flatMap(name => name === failedAsset ? [name, name] : [name]);
    assert.deepEqual(requests, expected);
    for (const [name, bytes] of f.assets) assert.deepEqual(await fs.readFile(path.join(directory, name)), bytes);
    assert.deepEqual(timing.observations.filter(item => item.status === 504).map(item =>
      ({ asset: item.asset, attempt: item.attempt, available: item.available, remainingMs: item.remainingMs })),
    [{ asset: failedAsset, attempt: 1, available: false, remainingMs: 600_000 }]);
  }
});

test('TOOL03 prior-release acquisition exhausts its original phase budget without another request', async t => {
  const f = await fixture(t);
  const timing = clock(1500);
  let requests = 0;
  let cancelled = 0;
  const directory = path.join(f.directory, 'unavailable');
  await assert.rejects(downloadPreviousRelease({ ...f.identity, directory, readbackOptions: timing.options,
    fetcher: async () => {
      requests++;
      return { status: 504, ok: false, body: { cancel: async () => { cancelled++; } } };
    } }), { code: 'PUBLICATION_UNCERTAIN' });
  assert.equal(requests, 2);
  assert.equal(cancelled, 2);
  assert.deepEqual(timing.sleeps, [1000, 500]);
  assert.deepEqual(await fs.readdir(directory), []);
  const shared = clock(1500);
  const names = [];
  const seen = new Set();
  const partial = path.join(f.directory, 'shared-deadline');
  await assert.rejects(downloadPreviousRelease({ ...f.identity, directory: partial, readbackOptions: shared.options,
    fetcher: async url => {
      const name = new URL(url).pathname.split('/').at(-1);
      names.push(name);
      if (!seen.has(name)) {
        seen.add(name);
        return new Response('', { status: 504 });
      }
      return new Response(f.assets.get(name));
    } }), { code: 'PUBLICATION_UNCERTAIN' });
  assert.deepEqual(names, ['release-descriptor.json', 'release-descriptor.json', 'SHA256SUMS']);
  assert.deepEqual(shared.sleeps, [1000, 500]);
  assert.deepEqual(await fs.readdir(partial), ['release-descriptor.json']);
  assert.deepEqual(await fs.readFile(path.join(partial, 'release-descriptor.json')),
    f.assets.get('release-descriptor.json'));
  await assert.rejects(downloadPreviousRelease({ ...f.identity, directory: path.join(f.directory, 'over-budget'),
    readbackOptions: { timeoutMs: 600_001 }, fetcher: () => assert.fail('Invalid budgets must not dispatch') }),
  /at most ten minutes/u);
});

test('TOOL03 prior-release acquisition never retries denied responses or mismatched pins', async t => {
  const f = await fixture(t);
  for (const status of [401, 403, 500, 503]) {
    const timing = clock();
    let requests = 0;
    await assert.rejects(downloadPreviousRelease({ ...f.identity, directory: path.join(f.directory, String(status)),
      readbackOptions: timing.options, fetcher: async () => {
        requests++;
        return new Response('', { status });
      } }), new RegExp(`Anonymous public download failed: ${status}`));
    assert.equal(requests, 1);
    assert.deepEqual(timing.sleeps, []);
  }
  const timing = clock();
  let requests = 0;
  const directory = path.join(f.directory, 'corrupt');
  await assert.rejects(downloadPreviousRelease({ ...f.identity, directory, readbackOptions: timing.options,
    fetcher: async () => {
      requests++;
      return new Response('different metadata');
    } }), /metadata differs from the independently saved public identity/u);
  assert.equal(requests, 1);
  assert.deepEqual(timing.sleeps, []);
  assert.deepEqual(await fs.readdir(directory), []);
  const payload = [...f.assets.keys()].at(-1);
  const retried = clock();
  const names = [];
  const corruptPayload = path.join(f.directory, 'corrupt-after-timeout');
  await assert.rejects(downloadPreviousRelease({ ...f.identity, directory: corruptPayload, readbackOptions: retried.options,
    fetcher: async url => {
      const name = new URL(url).pathname.split('/').at(-1);
      names.push(name);
      if (name !== payload) return new Response(f.assets.get(name));
      return names.filter(item => item === payload).length === 1 ?
        new Response('', { status: 504 }) : new Response('different payload');
    } }), /Previous public release asset integrity mismatch/u);
  assert.deepEqual(names, ['release-descriptor.json', 'SHA256SUMS', payload, payload]);
  assert.deepEqual(retried.sleeps, [1000]);
  assert.deepEqual((await fs.readdir(corruptPayload)).sort(), ['SHA256SUMS', 'release-descriptor.json']);
  let currentRequests = 0;
  const bundle = { releaseRepository: f.identity.repository, identity: { version: f.identity.version },
    files: [...f.assets].map(([name, bytes]) => ({ filename: `assets/${name}`, size: bytes.length, sha256: sha256(bytes) })) };
  await assert.rejects(downloadPublicAssets(bundle, path.join(f.directory, 'current-public'), async () => {
    currentRequests++;
    return new Response('', { status: 504 });
  }), /Anonymous public download failed: 504/u);
  assert.equal(currentRequests, 1, 'Current-public acceptance does not acquire a new retry policy');
});
