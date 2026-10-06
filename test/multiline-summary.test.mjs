import test from 'node:test';
import assert from 'node:assert/strict';
import { safeSummary, unsafeSummaryContent } from '../src/core.mjs';
import { check } from '../src/checks.mjs';
import { status, resume } from '../src/recovery.mjs';
import { fixture } from './helpers.mjs';

const marker = 'fixture-only-sensitive-marker';
const continuation = 'fixture-only-continuation-marker';
const diagnostic = `rawProviderResponse: ${marker}\n${continuation}; Repository primary; run 42`;
const nextLineDiagnostic = `rawProviderResponse:\n${marker}\n${continuation}; Repository primary; run 42`;

function assertSafeSummary(input, suffix = '') {
  assert.equal(unsafeSummaryContent(input), true);
  const sanitized = safeSummary(input);
  assert.equal(sanitized.includes(marker), false);
  assert.equal(sanitized.includes(continuation), false);
  if (suffix) assert.ok(sanitized.endsWith(suffix));
  assert.equal(safeSummary(sanitized), sanitized);
  assert.equal(unsafeSummaryContent(sanitized), false);
}

test('multiline sensitive assignments redact next-line and continuation values through the delimiter', () => {
  for (const input of [
    `rawPrompt:\n${marker}`,
    `rawPrompt:\r\n${marker}\r\n${continuation}`,
    nextLineDiagnostic,
    diagnostic,
    `rawProviderResponse: "${marker}"\n${continuation}; Repository primary; run 42`,
    `rawPrompt:";[1]${marker}"\n${continuation}; Repository primary; run 42`,
    `rawProviderResponse:";[1]${marker}"\n${continuation}; Repository primary; run 42`,
    `rawPrompt:";[1]${marker}"\n[1]${continuation}; Repository primary; run 42`,
    `rawProviderResponse:";[1]${marker}"\n[1]${continuation}; Repository primary; run 42`,
    `rawProviderResponse: "${marker}" \r\n${continuation}; Repository primary; run 42`,
    `rawProviderResponse:\n{"safe":"${marker}"}\n${continuation}; Repository primary; run 42`,
  ]) {
    assertSafeSummary(input, input.includes('; Repository') ? '; Repository primary; run 42' : '');
  }
  assert.equal(safeSummary('{"safe":"visible","count":42}'),
    '{"safe":"visible","count":42}');
  assert.equal(safeSummary('https://example.invalid/run?token=fixture-url-marker&view=public'),
    'https://example.invalid/run?token=[redacted]&view=public');
});

test('check result and finding detail redact multiline provider errors but retain safe diagnostics', async t => {
  const f = await fixture(t);
  for (const message of [diagnostic, nextLineDiagnostic]) {
    const store = { home: f.home, load: async () => {
      throw Object.assign(new Error(message), { code: 'PROVIDER' });
    } };
    const checked = await check(store, f.workItemId, 'state');
    assert.equal(checked.verdict, 'error');
    assert.equal(checked.exitCode, 4);
    assert.equal(JSON.stringify(checked).includes(marker), false);
    assert.equal(JSON.stringify(checked).includes(continuation), false);
    const detailed = await check(store, f.workItemId, 'state', { finding: 0 });
    assert.equal(detailed.verdict, 'error');
    assert.equal(detailed.exitCode, 4);
    const finding = JSON.parse(detailed.detail);
    assert.match(finding.reason, /Repository primary; run 42$/u);
    assert.equal(detailed.detail.includes(marker), false);
    assert.equal(detailed.detail.includes(continuation), false);
  }
});

test('status redacts a persisted next-line sensitive conflict while retaining diagnostics', async t => {
  const f = await fixture(t);
  await f.store.transaction(f.workItemId, tx => {
    tx.put({ type: 'conflict', id: 'multiline-conflict',
      workItemId: f.workItemId, status: 'open', reason: nextLineDiagnostic,
      scope: {}, references: ['provider-result'] });
  });
  const visible = await status(f.store, f.workItemId);
  const statusText = JSON.stringify(visible);
  assert.equal(statusText.includes(marker), false);
  assert.equal(statusText.includes(continuation), false);
  assert.match(statusText, /Repository primary; run 42/u);
});

test('resume sanitizes a next-line sensitive artifact locator', async t => {
  const f = await fixture(t, { compactPath: true });
  const resumableStore = Object.create(f.store);
  resumableStore.load = async workItemId => {
    const loaded = await f.store.load(workItemId);
    loaded.manifest.artifacts.push({ role: 'requirements', kind: 'external-file',
      repositoryId: 'primary', artifactId: 'multiline-artifact',
      locatorId: `rawPrompt:\n${marker}; Repository primary`,
      digest: 'pending', planned: true });
    return loaded;
  };
  const resumed = await resume(resumableStore, {
    cwd: f.repo, sessionId: f.sessionId, workItemId: f.workItemId,
  });
  const resumeText = JSON.stringify(resumed);
  const artifact = resumed.artifacts.find(item => item.artifactId === 'multiline-artifact');
  assert.ok(artifact);
  assert.match(artifact.locator, /Repository primary$/u);
  assert.equal(resumeText.includes(marker), false);
});
