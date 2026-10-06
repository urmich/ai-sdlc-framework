import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { digest, canonical } from '../src/core.mjs';
import { writeJson } from '../src/files.mjs';
import {
  assertMonitorRecordSize, readMonitorEvidenceRecord, validateMonitorEvidence,
  verifyReferencedEvidence,
} from '../src/monitor-evidence.mjs';

const context = {
  provider: 'fixture', connection: 'connection',
  scopeRef: 'project', retrievedAt: '2026-10-04T10:42:17.000Z',
};
const reference = (overrides = {}) => ({
  locator: 'https://example.invalid/results?buildId=42',
  retrievalContext: context, sha256: '0'.repeat(64), ...overrides,
});

test('T-110 shallow summary and reference metadata have exact 511/512/513-character boundaries', () => {
  for (const count of [511, 512]) {
    assert.equal(validateMonitorEvidence({ summary: 'x'.repeat(count) }).summary.length, count);
    assert.equal(validateMonitorEvidence({ reference: reference({
      locator: `fixture:${'a'.repeat(count - 8)}`,
    }) }).reference.locator.length, count);
  }
  assert.throws(() => validateMonitorEvidence({ summary: 'x'.repeat(513) }),
    { code: 'INPUT' });
  assert.throws(() => validateMonitorEvidence({ reference: reference({
    locator: `fixture:${'a'.repeat(505)}`,
  }) }), { code: 'INPUT' });
  assert.deepEqual(Object.keys(validateMonitorEvidence({ summary: 'safe',
    reference: reference() })), ['summary', 'reference']);
  assert.deepEqual(validateMonitorEvidence({ reference: { locator: 'fixture:diagnostic' } }),
    { reference: { locator: 'fixture:diagnostic' } });
});

test('T-110 on-disk JSON including newline accepts 4095/4096 and rejects 4097 bytes', async t => {
  const folder = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sdlc-monitor-evidence-')));
  t.after(async () => { await fs.rm(folder, { recursive: true }); });
  const recordAt = target => {
    const base = { fields: Array(8).fill('x'.repeat(480)), tail: '' };
    const remaining = target - Buffer.byteLength(`${canonical(base)}\n`);
    assert.ok(remaining >= 0 && remaining <= 512);
    return { ...base, tail: 'z'.repeat(remaining) };
  };
  for (const count of [4095, 4096]) {
    const file = path.join(folder, `${count}.json`);
    const record = assertMonitorRecordSize(recordAt(count));
    await writeJson(file, record);
    assert.equal((await fs.stat(file)).size, count);
    assert.deepEqual(await readMonitorEvidenceRecord(file), record);
  }
  const oversized = recordAt(4097);
  assert.throws(() => assertMonitorRecordSize(oversized), { code: 'CAPACITY' });
  const file = path.join(folder, 'oversized.json');
  await writeJson(file, oversized);
  assert.equal((await fs.stat(file)).size, 4097);
  await assert.rejects(readMonitorEvidenceRecord(file), { code: 'CAPACITY' });
});

test('T-110 rejects credentials, sensitive query keys, raw headers and executable or nested payloads', () => {
  const unsafe = [
    { summary: 'Authorization: Bearer abc' },
    { summary: 'x-api-key: fake-fixture' },
    { summary: 'password=fixture' },
    { summary: 'token: fake-fixture' },
    { summary: 'Headers: content-type: text/plain' },
    { summary: '<script>alert(1)</script>' },
    { summary: 'javascript:alert(1)' },
    { summary: '$(dangerous)' },
    { summary: 'https://example.invalid/run?%74oken=fake-fixture' },
    { summary: 'https://example.invalid/run?sig=fake-fixture' },
    { summary: 'https://example.invalid/run?signature=fake-fixture' },
    { summary: 'https://example.invalid/run?key=fake-fixture' },
    { summary: 'https://example.invalid/run?password=fake-fixture' },
    { summary: 'https://example.invalid/run?%53ignature=fake-fixture' },
    { summary: 'https://example.invalid/run?note=Bearer%20fake-fixture' },
    { reference: reference({ locator: 'https://someone:fake@example.invalid/run' }) },
    { reference: reference({ locator: 'file:///tmp/evidence' }) },
    { reference: reference({ locator: '../evidence.json' }) },
    { summary: { raw: 'payload' } },
    { reference: reference({ headers: { Authorization: 'fake' } }) },
    { reference: reference({ retrievalContext: { ...context, payload: { nested: true } } }) },
    { reference: reference({ retrievalContext: { ...context, scopeRef: 'Authorization: Bearer fake' } }) },
    { summary: 'ok', headers: 'anything' },
  ];
  for (const input of unsafe) {
    assert.throws(() => validateMonitorEvidence(input), error =>
      ['INPUT', 'UNSAFE'].includes(error.code), 'unsafe evidence was accepted');
  }
  assert.throws(() => validateMonitorEvidence({ reference: reference({
    retrievalContext: undefined,
  }) }), { code: 'INPUT' });
  assert.throws(() => validateMonitorEvidence({ reference: reference({
    sha256: 'not-a-hash',
  }) }), { code: 'INPUT' });
  assert.throws(() => assertMonitorRecordSize({ summary: 'x'.repeat(513) }),
    { code: 'INPUT' });
  assert.throws(() => assertMonitorRecordSize({ payload: { raw: 'safe-looking' } }),
    { code: 'UNSAFE' });
  assert.throws(() => assertMonitorRecordSize({ apiKey: 'fixture' }),
    { code: 'UNSAFE' });
});

test('T-110 rejects quoted credentials and nested serialized responses in every bounded text field', () => {
  const unsafeText = [
    '{"access_token":"fixture-only-sensitive-marker"}',
    '{"accessToken":"fixture-only-sensitive-marker"}',
    '{"apiKey":"fixture-only-sensitive-marker"}',
    'refreshToken: fixture-only-sensitive-marker',
    'refresh_token=fixture-only-sensitive-marker',
    '{"rawProviderResponse":{"status":"running"}}',
    '{"headers":{"Authorization":"fixture-only-sensitive-marker"}}',
    'httpHeaders: fixture-only-sensitive-marker',
    'authorizationHeader: fixture-only-sensitive-marker',
    '{"response":{"content":"{\\"status\\":\\"running\\"}"}}',
    'response content: {"status":"running"}',
    'response content: {\\"status\\":\\"running\\"}',
    'X-Api-Key: fixture-only-sensitive-marker',
    'proxyAuthorization: fixture-only-sensitive-marker',
    'https://example.invalid/run?data=%7B%22status%22%3A%22running%22%7D',
    'https://example.invalid/run?data=%2525257B%25252522status%25252522%2525253A1%2525257D',
  ];
  for (const value of unsafeText) {
    assert.throws(() => validateMonitorEvidence({ summary: value }), { code: 'UNSAFE' });
    assert.throws(() => assertMonitorRecordSize({ evidence: { summary: value } }),
      { code: 'UNSAFE' });
  }
  for (const value of unsafeText.filter(item => !item.includes('://'))) {
    assert.throws(() => validateMonitorEvidence({
      reference: reference({ retrievalContext: { ...context, scopeRef: value } }),
    }), { code: 'UNSAFE' });
    assert.throws(() => validateMonitorEvidence({
      reference: reference({ immutableVersion: value }),
    }), { code: 'UNSAFE' });
  }
  assert.throws(() => validateMonitorEvidence({
    reference: { locator: 'fixture:%7B%22headers%22%3A%7B%22Authorization%22%3A%22x%22%7D%7D' },
  }), { code: 'UNSAFE' });
  assert.throws(() => validateMonitorEvidence({
    reference: reference({ locator: 'fixture:{"status":"running"}' }),
  }), { code: 'UNSAFE' });
  assert.deepEqual(validateMonitorEvidence({
    summary: 'Run 42 finished; 3 checks passed.',
  }), { summary: 'Run 42 finished; 3 checks passed.' });
  assert.equal(validateMonitorEvidence({ summary: 'Run 42 [OK]' }).summary, 'Run 42 [OK]');
});

test('T-110 read-only evidence verification accepts exactly 4 MiB and reports mismatch/missing', async t => {
  const folder = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sdlc-monitor-bytes-')));
  t.after(async () => { await fs.rm(folder, { recursive: true }); });
  const filePath = path.join(folder, 'evidence.bin');
  const bytes = Buffer.alloc(4 * 1024 * 1024, 65);
  await fs.writeFile(filePath, bytes);
  const checked = reference({ sha256: digest(bytes) });
  assert.deepEqual(await verifyReferencedEvidence(checked, { filePath }),
    { verified: true, identity: 'sha256' });
  assert.equal((await fs.stat(filePath)).size, bytes.length);
  await fs.writeFile(filePath, Buffer.alloc(4 * 1024 * 1024, 66));
  assert.deepEqual(await verifyReferencedEvidence(checked, { filePath }),
    { verified: false, reason: 'sha256-mismatch' });
  await fs.unlink(filePath);
  assert.deepEqual(await verifyReferencedEvidence(checked, { filePath }),
    { verified: false, reason: 'evidence-file-unavailable' });
  await fs.writeFile(filePath, Buffer.alloc(4 * 1024 * 1024 + 1));
  await assert.rejects(verifyReferencedEvidence(checked, { filePath }), { code: 'CAPACITY' });
  await assert.rejects(verifyReferencedEvidence(checked, {}), { code: 'PATH' });
});

test('T-110 mutable locator stays diagnostic and provider version needs an adapter proof', async t => {
  const folder = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sdlc-provider-version-')));
  t.after(async () => { await fs.rm(folder, { recursive: true }); });
  const filePath = path.join(folder, 'evidence.bin');
  await fs.writeFile(filePath, 'checked bytes');
  const diagnostic = { locator: 'fixture:mutable' };
  assert.deepEqual(await verifyReferencedEvidence(diagnostic, { filePath }),
    { verified: false, reason: 'immutable-identity-unavailable' });
  const versioned = { locator: 'fixture:version-42', retrievalContext: context,
    immutableVersion: 'fixed-version-42' };
  assert.deepEqual(await verifyReferencedEvidence(versioned, { filePath }),
    { verified: false, reason: 'provider-version-unproven' });
  assert.deepEqual(await verifyReferencedEvidence(versioned, {
    filePath, verifyProviderVersion: ({ immutableVersion, bytes, retrievalContext }) =>
      immutableVersion === 'fixed-version-42' &&
      bytes.toString() === 'checked bytes' &&
      retrievalContext.connection === 'connection',
  }), { verified: true, identity: 'provider-version' });
  assert.deepEqual(await verifyReferencedEvidence(versioned, {
    filePath, verifyProviderVersion: () => false,
  }), { verified: false, reason: 'provider-version-unproven' });
});
