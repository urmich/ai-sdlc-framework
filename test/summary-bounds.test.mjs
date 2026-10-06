import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LIMITS, digest, safeSummary, unsafeSummaryContent } from '../src/core.mjs';
import { aggregate, boundedCheck, check } from '../src/checks.mjs';
import { status, resume } from '../src/recovery.mjs';
import { humanOutput, runCli } from '../src/cli.mjs';
import { registerArtifact } from '../src/artifacts.mjs';
import { fixture } from './helpers.mjs';

const outputBytes = result => Buffer.byteLength(JSON.stringify(result) + '\n');

test('T-112 exact 256 KiB check boundary preserves normal shape; one byte more paginates', () => {
  const findings = [{ rule: 'exact', verdict: 'unverified', reason: '' }];
  const emptySize = outputBytes(aggregate(findings));
  findings[0].reason = 'x'.repeat(LIMITS.workingSet - emptySize);
  const exact = boundedCheck(findings, 'all', 'wi-test');
  assert.equal(outputBytes(exact), 256 * 1024);
  assert.deepEqual(exact, aggregate(findings));
  findings[0].reason += 'x';
  const overflow = boundedCheck(findings, 'all', 'wi-test');
  assert.ok(outputBytes(overflow) <= LIMITS.workingSet);
  assert.equal(overflow.verdict, 'unverified');
  assert.equal(overflow.exitCode, 3);
  assert.equal(overflow.total, 1);
  assert.equal(overflow.count, 1);
  assert.equal(overflow.findings[0].rule, 'exact');
  assert.equal(overflow.findings[0].detailDigest, digest(findings[0]));
  assert.equal(overflow.findings[0].detailBytes, Buffer.byteLength(JSON.stringify(findings[0])));
  assert.equal(overflow.findingsDigest, digest(findings));
  assert.equal(overflow.nextOffset, null);
  assert.ok(Buffer.byteLength(humanOutput(overflow) + '\n') <= LIMITS.workingSet);
  findings[0].reason = 'π'.repeat(LIMITS.workingSet / 2);
  assert.ok(outputBytes(boundedCheck(findings, 'all', 'wi-test')) <= LIMITS.workingSet);
});

test('T-112 encoded signing URLs and mixed checker diagnostics redact only unsafe content', async t => {
  const urls = [
    'https://example.invalid/run?%74oken=fixture-encoded-value',
    'https://example.invalid/run?X-Amz-Signature=fixture-signature-value',
    "https://example.invalid/run?token=prefix'fixture-suffix",
  ];
  for (const url of urls) {
    assert.equal(unsafeSummaryContent(url), true);
    const safe = safeSummary(`Run 42 failed at ${url}; inspect the check`);
    assert.match(safe, /Run 42 failed at https:\/\/example\.invalid\/run/u);
    assert.doesNotMatch(safe, /fixture-encoded-value|fixture-signature-value|fixture-suffix/u);
  }
  const f = await fixture(t);
  const error = new Error('Repository primary; run 42; HTTP 403; ' +
    'https://example.invalid/safe-check; ' +
    '{"rawProviderResponse":"fixture-sensitive-body"}');
  error.code = 'PROVIDER';
  const store = { home: f.home, load: async () => { throw error; } };
  const checked = await check(store, f.workItemId, 'all');
  assert.equal(checked.exitCode, 4);
  assert.equal(checked.verdict, 'error');
  assert.match(checked.findings[0].reason,
    /Repository primary; run 42; HTTP 403/u);
  assert.doesNotMatch(JSON.stringify(checked), /fixture-sensitive-body/u);
  const detail = await check(store, f.workItemId, 'all', {
    finding: 0, offset: 0, limit: 1000,
  });

  assert.equal(detail.exitCode, 4);
  assert.match(detail.detail, /Repository primary; run 42; HTTP 403/u);
  assert.match(detail.detail, /https:\/\/example\.invalid\/safe-check/u);
  assert.doesNotMatch(detail.detail, /fixture-sensitive-body/u);
});

test('T-112 sensitive assignments enclosing JSON do not expose a payload or hide later diagnostics', async t => {
  const secret = 'fixture-sensitive-marker';
  const message = `Provider failed: rawProviderResponse={"message":"${secret}"}; ` +
    'Repository primary; run 42; HTTP 403; https://example.invalid/safe-check';
  const bracket = `rawProviderResponse=[123]${secret}.md`;
  const quoted = `token="prefix[123]${secret}"`;
  const urlValue = `token=https://example.invalid/[123]${secret}`;
  const unquoted = `rawProviderResponse=prefix[123]${secret}.md`;
  const spacedBracket = `rawProviderResponse=[403] Request failed ${secret}; Repository primary; run 42`;
  const authorization = `authorization=Bearer ${secret}; Repository primary; run 42`;
  const escaped = 'Provider failed: ' +
    JSON.stringify({ rawProviderResponse: `${secret}\\` }) +
    '; Repository primary; run 42';
  for (const text of [message, bracket, quoted, urlValue, unquoted,
    spacedBracket, authorization, escaped]) {
    assert.equal(unsafeSummaryContent(text), true);
    assert.doesNotMatch(safeSummary(text), /fixture-sensitive-marker/u);
    assert.equal(safeSummary(safeSummary(text)), safeSummary(text));
  }
  assert.match(safeSummary(message),
    /Repository primary; run 42; HTTP 403; https:\/\/example.invalid\/safe-check/u);
  for (const text of [spacedBracket, authorization, escaped]) {
    assert.match(safeSummary(text), /Repository primary; run 42/u);
  }
  assert.equal(safeSummary('https://example.invalid/?token=[redacted]'),
    'https://example.invalid/?token=[redacted]');
  const f = await fixture(t);
  const state = await f.store.load(f.workItemId);
  state.records.push({ type: 'conflict', id: 'synthetic-conflict',
    workItemId: f.workItemId, status: 'open', reason: message,
    scope: {}, references: ['provider-result', 'fixture-repository'] });
  const visible = await status({ home: f.home, clock: f.clock,
    load: async () => state }, f.workItemId);
  assert.doesNotMatch(JSON.stringify(visible), /fixture-sensitive-marker/u);
  assert.match(JSON.stringify(visible), /Repository primary; run 42; HTTP 403/u);
  const error = Object.assign(new Error(message), { code: 'PROVIDER' });
  const checked = await check({ home: f.home,
    load: async () => { throw error; } }, f.workItemId, 'state');
  assert.equal(checked.exitCode, 4);
  assert.doesNotMatch(JSON.stringify(checked), /fixture-sensitive-marker/u);
  const detailed = await check({ home: f.home,
    load: async () => { throw error; } }, f.workItemId, 'state',
  { finding: 0 });
  assert.match(detailed.detail, /Repository primary; run 42; HTTP 403/u);
  assert.doesNotMatch(detailed.detail, /fixture-sensitive-marker/u);
  await registerArtifact(f.store, { workItemId: f.workItemId,
    role: 'requirements', repositoryId: 'primary',
    artifactId: 'planned-sensitive-locator',
    path: `docs/${bracket}`, planned: true });
  const resumed = await resume(f.store, {
    cwd: f.repo, sessionId: f.sessionId, workItemId: f.workItemId,
  });
  assert.doesNotMatch(JSON.stringify(resumed), /fixture-sensitive-marker/u);
});

test('T-112 repeated query pairs, URL components and quoted values keep safe context', async t => {
  const inputs = [
    {
      input: 'https://example.invalid/?x=safe&x=rawProviderResponse%3DFIRST&y=rawProviderResponse%3DSECRET',
      secrets: ['FIRST', 'SECRET'], preserved: ['x=safe'],
    },
    {
      input: 'https://example.invalid/run?rawProviderResponse=RAW_SECRET&%72awProviderResponse=ENCODED_KEY_SECRET&view=public',
      secrets: ['RAW_SECRET', 'ENCODED_KEY_SECRET'], preserved: ['view=public'],
    },
    {
      input: 'https://example.invalid/rawProviderResponse=PATH_SECRET#access_token=FRAGMENT_SECRET',
      secrets: ['PATH_SECRET', 'FRAGMENT_SECRET'], preserved: ['example.invalid'],
    },
    {
      input: 'https://example.invalid/%72awProviderResponse%3DENCODED_PATH#%61ccess_token%3DENCODED_FRAGMENT',
      secrets: ['ENCODED_PATH', 'ENCODED_FRAGMENT'], preserved: ['example.invalid'],
    },
    {
      input: 'https://example.invalid/bad%GG/%72awProviderResponse%3DMALFORMED_COMPONENT',
      secrets: ['MALFORMED_COMPONENT'], preserved: ['example.invalid'],
    },
    {
      input: 'https://example.invalid/?token=prefix"QUOTE_SECRET',
      secrets: ['QUOTE_SECRET', 'prefix'], preserved: ['example.invalid'],
    },
    {
      input: 'https://user:PASS_SECRET@example.invalid/safe?%74oken=ENCODED_SECRET&view=public',
      secrets: ['PASS_SECRET', 'ENCODED_SECRET'], preserved: ['view=public'],
    },
  ];
  for (const { input, secrets, preserved } of inputs) {
    const diagnostic = `確認 π: ${input}; repository primary; run 42`;
    assert.equal(unsafeSummaryContent(diagnostic), true);
    const sanitized = safeSummary(diagnostic);
    assert.match(sanitized, /^確認 π: /u);
    assert.match(sanitized, /repository primary; run 42$/u);
    for (const secret of secrets) assert.equal(sanitized.includes(secret), false);
    for (const safe of preserved) assert.ok(sanitized.includes(safe));
    const finding = { rule: 'provider-observation', verdict: 'error', reason: diagnostic };
    const summary = boundedCheck([finding], 'state', 'wi-test');
    assert.equal(summary.verdict, 'error');
    assert.equal(summary.exitCode, 4);
    for (const secret of secrets) assert.equal(JSON.stringify(summary).includes(secret), false);
    const page = boundedCheck([finding], 'state', 'wi-test', { finding: 0 });
    assert.equal(page.verdict, 'error');
    assert.equal(page.exitCode, 4);
    assert.equal(JSON.parse(page.detail).reason, sanitized);
  }
  const safe = '確認 π: https://example.invalid/safe-check?view=public; repository primary';
  assert.equal(unsafeSummaryContent(safe), false);
  assert.equal(safeSummary(safe), safe);
  const redacted = 'https://example.invalid/?x=rawProviderResponse%3D%5Bredacted%5D&view=public';
  assert.equal(unsafeSummaryContent(redacted), false);
  assert.equal(safeSummary(redacted), redacted);
  assert.equal(safeSummary('{"safe": "確認 π", "count": 42}'),
    '{"safe": "確認 π", "count": 42}');
  const malformed = 'https://%ZZ.invalid/?token=MALFORMED_SECRET';
  assert.equal(unsafeSummaryContent(malformed), true);
  assert.equal(safeSummary(malformed).includes('MALFORMED_SECRET'), false);
  assert.equal(safeSummary('rawProviderResponse=multi word SECRET; Repository primary'),
    `rawProviderResponse=[redacted:${digest('multi word SECRET')}]; Repository primary`);
  assert.equal(safeSummary('token="quoted SECRET value"; Repository primary').includes('SECRET'),
    false);

  const f = await fixture(t);
  const state = await f.store.load(f.workItemId);
  state.records.push({ type: 'conflict', id: 'url-components', status: 'open',
    reason: `確認 π: ${inputs[1].input}; repository primary; run 42`,
    scope: { repositoryIds: ['primary'] },
    references: ['FR-065'] });
  const projected = await status({ ...f.store, load: async () => state }, f.workItemId);
  const serialized = JSON.stringify(projected);
  assert.equal(serialized.includes('RAW_SECRET'), false);
  assert.equal(serialized.includes('ENCODED_KEY_SECRET'), false);
  assert.match(serialized, /repository primary; run 42/u);
});

test('T-112 embedded JSON in checker diagnostics preserves Unicode and safe text on both sides', async t => {
  const secret = 'fixture-raw-payload';
  const prefix = 'Provider failed: ';
  const suffix = '; Repository primary; run 42; HTTP 403; https://example.invalid/safe-check; 確認 π';
  const diagnostic = `${prefix}{"rawProviderResponse":"${secret}","safe":"visible"}${suffix}`;
  const f = await fixture(t);
  const store = { home: f.home, load: async () => {
    throw Object.assign(new Error(diagnostic), { code: 'PROVIDER' });
  } };
  const checked = await check(store, f.workItemId, 'state');
  assert.equal(checked.verdict, 'error');
  assert.equal(checked.exitCode, 4);
  assert.equal(JSON.stringify(checked).includes(secret), false);
  const detail = await check(store, f.workItemId, 'state', { finding: 0 });
  assert.equal(detail.verdict, 'error');
  assert.equal(detail.exitCode, 4);
  const reason = JSON.parse(detail.detail).reason;
  assert.match(reason, /^PROVIDER: Provider failed: /u);
  assert.match(reason, /"safe":"visible"/u);
  assert.ok(reason.endsWith(suffix));
  assert.equal(reason.includes(secret), false);
  assert.equal(safeSummary(`確認 π; ${diagnostic}`), `確認 π; ${safeSummary(diagnostic)}`);
});

test('T-112 check pages cover every finding and keep aggregate verdict and exit on every page', () => {
  const findings = Array.from({ length: 1900 }, (_, index) => ({
    rule: `test:T-${index}`, verdict: index === 1899 ? 'violation' : 'satisfied',
    reason: 'No unverified claim. '.repeat(20),
  }));
  const expected = aggregate(findings);
  const seen = [];
  let offset = 0;
  do {
    const page = boundedCheck(findings, 'all', 'wi-test', { offset, limit: 900 });
    assert.ok(outputBytes(page) <= LIMITS.workingSet);
    assert.equal(page.verdict, expected.verdict);
    assert.equal(page.exitCode, expected.exitCode);
    assert.equal(page.summary, expected.summary);
    assert.equal(page.total, findings.length);
    assert.equal(page.count, page.findings.length);
    assert.equal(page.offset, offset);
    assert.equal(page.omittedDigest, digest([
      ...findings.slice(0, offset), ...findings.slice(offset + page.count),
    ]));
    seen.push(...page.findings);
    offset = page.nextOffset;
    if (offset !== null) assert.match(page.detailCommand,
      new RegExp(`--offset ${offset} --limit 900$`, 'u'));
  } while (offset !== null);
  assert.deepEqual(seen, findings);
});

test('T-112 status detail preserves identities without exposing decision effects or provider payloads', async t => {
  const f = await fixture(t);
  const state = await f.store.load(f.workItemId);
  const privateText = 'fixture-private-marker-not-for-output';
  state.manifest.artifacts = Array.from({ length: 2100 }, (_, index) => ({
    role: 'requirements', repositoryId: 'primary', artifactId: `artifact-${index}`,
    kind: 'git', path: `docs/long-identity-${index}.md`, digest: 'pending', planned: true,
  }));
  state.records.push({ type: 'pending-decision', id: 'decision-1',
    kind: 'approval', effect: { rawPrompt: privateText } });
  state.records.push({ type: 'operation', id: 'operation-1', status: 'uncertain',
    target: { rawProviderResponse: privateText } });
  const store = { ...f.store, clock: f.clock, load: async () => state };
  const seen = [];
  let offset = 0;
  do {
    const page = await status(store, f.workItemId, { offset, limit: 800 });
    assert.ok(outputBytes(page) <= LIMITS.workingSet);
    assert.equal(page.workItemId, f.workItemId);
    assert.equal(page.inventory.artifacts.count, 2100);
    assert.equal(page.inventory.operations.count, 1);
    assert.equal(page.total, page.inventory.artifacts.count +
      Object.entries(page.inventory).filter(([name]) => name !== 'artifacts')
        .reduce((sum, [, value]) => sum + value.count, 0));
    assert.equal(JSON.stringify(page).includes(privateText), false);
    assert.ok(Buffer.byteLength(humanOutput(page) + '\n') <= LIMITS.workingSet);
    seen.push(...page.items);
    offset = page.nextOffset;
  } while (offset !== null);
  assert.equal(seen.filter(item => item.kind === 'artifacts').length, 2100);
  assert.ok(seen.some(item => item.kind === 'repositories' && item.repositoryId === 'primary'));
  assert.ok(seen.some(item => item.kind === 'operations' &&
    item.id === 'operation-1' && item.detailCommand.includes('op show')));
  assert.ok(seen.some(item => item.kind === 'artifacts' && item.artifactId === 'artifact-2099'));
  assert.equal(JSON.stringify(await status(store, f.workItemId)).includes(privateText), false);
});

test('T-112 status keeps legacy PR history and pages every current hosted PR by exact URL and sequence', async t => {
  const f = await fixture(t);
  const state = await f.store.load(f.workItemId);
  const store = { ...f.store, load: async () => state };
  const firstURL = 'https://example.invalid/first.git';
  const secondURL = 'https://example.invalid/second.git';
  const observation = (id, remoteRepositoryURL, sequence, sourceRevision) => ({
    type: 'pr-observation', id, repositoryId: 'primary',
    localRepositoryPath: f.repo, remoteRepositoryURL,
    provider: 'github', connection: 'fixture', repositoryRef: 'same-ref',
    pullRequestRef: '17', sequence, state: 'active',
    sourceRevision, targetRevision: 'f'.repeat(40),
  });
  const first = observation('first-1', firstURL, 1, 'a'.repeat(40));
  const refreshed = observation('first-2', firstURL, 2, 'b'.repeat(40));
  const otherHostedURL = observation('second-9', secondURL, 9, 'c'.repeat(40));
  const legacy = { type: 'pr', id: 'legacy-pr', url: 'https://example.invalid/legacy/pull/1',
    state: 'open', sourceRevision: 'd'.repeat(40) };
  state.records.push(refreshed, otherHostedURL, first, legacy);
  const ordinary = await status(store, f.workItemId);
  assert.deepEqual(ordinary.pullRequests, [
    { id: 'legacy-pr', url: legacy.url, state: 'open', sourceRevision: legacy.sourceRevision },
    ...[refreshed, otherHostedURL].map(record => ({
      id: record.id, observationId: record.id, localRepositoryPath: f.repo,
      remoteRepositoryURL: record.remoteRepositoryURL,
      provider: 'github', connection: 'fixture', repositoryRef: 'same-ref',
      pullRequestRef: '17', state: 'active',
      sourceRevision: record.sourceRevision, targetRevision: record.targetRevision,
      sequence: record.sequence,
    })),
  ]);

  const secret = 'fixture-hosted-url-secret';
  state.records.push(observation('unsafe-url', `https://example.invalid/private.git?token=${secret}&view=public`,
    1, 'e'.repeat(40)));
  for (let index = 0; index < 850; index++) {
    state.records.push(observation(`extra-${index}`,
      `https://example.invalid/extra-${index}.git`, 1, 'a'.repeat(40)));
  }
  const seen = [];
  let offset = 0;
  do {
    const page = await status(store, f.workItemId, { offset, limit: 600 });
    assert.ok(outputBytes(page) <= LIMITS.workingSet);
    assert.equal(page.inventory.pullRequests.count, 854);
    assert.equal(JSON.stringify(page).includes(secret), false);
    seen.push(...page.items.filter(item => item.kind === 'pullRequests'));
    offset = page.nextOffset;
  } while (offset !== null);
  assert.equal(seen.length, 854);
  assert.ok(seen.some(item => item.id === 'legacy-pr' && item.observationId === undefined));
  assert.equal(seen.some(item => item.id === first.id), false);
  assert.ok(seen.some(item => item.observationId === refreshed.id &&
    item.sourceRevision === refreshed.sourceRevision));
  assert.ok(seen.some(item => item.observationId === otherHostedURL.id &&
    item.remoteRepositoryURL === secondURL));
  assert.ok(seen.some(item => item.observationId === 'unsafe-url' &&
    item.remoteRepositoryURL.includes('token=[redacted]') &&
    item.remoteRepositoryURL.includes('view=public')));
});

test('T-112 unsafe small legacy details are digest-only without changing safe responses', async t => {
  const f = await fixture(t);
  const state = await f.store.load(f.workItemId);
  const privateText = 'fixture-private-marker-not-for-output';
  state.records.push({ type: 'pending-decision', id: 'private-decision',
    kind: 'approval', effect: { fullPrompt: privateText } });
  const result = await status({ clock: f.clock, load: async () => state }, f.workItemId);
  assert.equal(result.total > 0, true);
  assert.equal(JSON.stringify(result).includes(privateText), false);
  assert.ok(result.items.some(item => item.id === 'private-decision'));
  const findings = [{ rule: 'checker', verdict: 'error', reason: `password=${privateText}` }];
  const checked = boundedCheck(findings, 'all', f.workItemId);
  assert.equal(checked.exitCode, 4);
  assert.equal(JSON.stringify(checked).includes(privateText), false);
  assert.equal(checked.findings[0].detailDigest, digest(findings[0]));
});

test('T-112 CLI rejects invalid page flags and small check/status retain normal shapes', async t => {
  const f = await fixture(t);
  for (const args of [
    ['check', 'all', '--offset', '-1'], ['check', 'all', '--offset', '1.5'],
    ['check', 'all', '--offset', '9007199254740992'],
    ['check', 'all', '--offset', '1000001'],
    ['check', 'all', '--limit', '0'], ['check', 'all', '--limit', '1001'],
    ['status', '--limit', 'NaN'], ['resume', '--offset', '0'],
  ]) {
    await assert.rejects(runCli(args), { code: 'INPUT' });
  }
  const options = ['--home', f.home, '--cwd', f.repo, '--work-item', f.workItemId];
  const ordinary = await runCli(['status', ...options]);
  assert.deepEqual(ordinary.result, await status(f.store, f.workItemId));
  assert.equal(ordinary.result.items, undefined);
  const checks = await runCli(['check', 'state', ...options]);
  assert.deepEqual(checks.result, await check(f.store, f.workItemId, 'state'));
  assert.equal(checks.exitCode, checks.result.exitCode);
  assert.equal(checks.result.total, undefined);
  const explicit = await runCli(['check', 'state', ...options, '--offset', '0', '--limit', '1']);
  assert.equal(explicit.exitCode, checks.exitCode);
  assert.equal(explicit.result.count, 1);
});

test('T-112 resume stays within orientation cap and points to status identity detail', async t => {
  const f = await fixture(t);
  for (let index = 0; index < 12; index++) {
    await registerArtifact(f.store, {
      workItemId: f.workItemId, role: 'requirements', repositoryId: 'primary',
      artifactId: `planned-${index}`, path: `docs/requirements-${index}.md`,
      planned: true,
    });
  }
  const result = await resume(f.store, {
    cwd: f.repo, sessionId: f.sessionId, workItemId: f.workItemId,
  });
  assert.ok(outputBytes(result) <= LIMITS.context);
  assert.ok(outputBytes(result) <= LIMITS.workingSet);
  assert.equal(result.artifactSummary.count, 12);
  assert.equal(result.detailCommand,
    `sdlc status --work-item ${f.workItemId} --home '${f.home}'`);
  const detail = await runCli(['status', '--home', f.home, '--cwd', f.repo,
    '--work-item', f.workItemId, '--offset', '0', '--limit', '100']);
  assert.equal(detail.result.inventory.artifacts.count, 12);
});

test('T-112 credential URLs and serialized provider/prompt text never appear in status, resume or checker errors', async t => {
  const f = await fixture(t);
  const secret = 'fixture-secret-never-output';
  const url = `https://example.invalid/evidence?sig=${secret}&view=public`;
  const payload = `request failed: {"rawPrompt":"${secret}","rawProviderResponse":"${secret}"}`;
  const state = await f.store.load(f.workItemId);
  state.records.push({ type: 'operation', id: 'unsafe-operation', status: 'uncertain',
    target: { url, rawProviderResponse: payload } });
  state.records.push({ type: 'conflict', id: 'unsafe-conflict', status: 'open',
    reason: `Check ${url}`, scope: { rawPrompt: payload }, references: ['FR-001', 'FR-002'] });
  const projected = await status({ ...f.store, load: async () => state }, f.workItemId);
  assert.equal(JSON.stringify(projected).includes(secret), false);
  assert.equal(JSON.stringify(projected).includes('sig=[redacted]'), true);
  assert.deepEqual(projected.items.find(item => item.id === 'unsafe-conflict').references,
    ['FR-001', 'FR-002']);
  const originalLoad = f.store.load.bind(f.store);
  f.store.load = async workItemId => {
    const loaded = await originalLoad(workItemId);
    loaded.manifest.artifacts.push({ role: 'requirements', repositoryId: 'primary',
      artifactId: 'unsafe-planned', kind: 'git',
      path: `docs/plan.md?token=${secret}#access_token=${secret}`,
      digest: 'pending', planned: true });
    return loaded;
  };
  const recovered = await resume(f.store, { cwd: f.repo,
    sessionId: f.sessionId, workItemId: f.workItemId });
  assert.equal(JSON.stringify(recovered).includes(secret), false);
  assert.equal(recovered.artifacts[0].artifactId, 'unsafe-planned');
  const checked = await check({ home: f.home, load: async () => {
    throw Object.assign(new Error(`${payload}; ${url}`), { code: 'PROVIDER' });
  } }, f.workItemId, 'state');
  assert.equal(checked.verdict, 'error');
  assert.equal(checked.exitCode, 4);
  assert.equal(JSON.stringify(checked).includes(secret), false);
  const detail = await check({ home: f.home, load: async () => {
    throw Object.assign(new Error(`${payload}; ${url}`), { code: 'PROVIDER' });
  } }, f.workItemId, 'state', { finding: 0 });
  assert.equal(detail.verdict, 'error');
  assert.equal(detail.exitCode, 4);
  assert.match(JSON.parse(detail.detail).reason, /PROVIDER: request failed: /u);
  assert.match(JSON.parse(detail.detail).reason, /view=public/u);
  assert.equal(detail.detail.includes(secret), false);
});

test('T-112 overflow preserves safe conflict detail and loads status state once', async t => {
  const f = await fixture(t);
  const state = await f.store.load(f.workItemId);
  state.manifest.artifacts = Array.from({ length: 1900 }, (_, index) => ({
    role: 'requirements', repositoryId: 'primary', artifactId: `a-${index}`,
    kind: 'git', path: `docs/a-${index}.md`, digest: 'pending', planned: true,
  }));
  state.records.push({ type: 'conflict', id: 'conflict-1', status: 'open',
    reason: 'Different destination branches', scope: { repositoryIds: ['primary'] },
    references: ['FR-001', 'FR-002'] });
  let loads = 0;
  const store = { ...f.store, load: async () => { loads++; return state; } };
  const first = await status(store, f.workItemId);
  assert.equal(loads, 1);
  let page = first;
  let conflict;
  while (page) {
    conflict ??= page.items.find(item => item.id === 'conflict-1');
    page = page.nextOffset === null ? null : await status(store, f.workItemId,
      { offset: page.nextOffset, limit: 1000 });
  }
  assert.deepEqual(conflict, { kind: 'conflicts', id: 'conflict-1', status: 'open',
    reason: 'Different destination branches', scope: { repositoryIds: ['primary'] },
    references: ['FR-001', 'FR-002'] });
});

test('T-112 repository notice overflow paginates without reloading the snapshot', async t => {
  const f = await fixture(t);
  const state = await f.store.load(f.workItemId);
  state.metadata.members = Array.from({ length: 6 }, () => state.metadata.members[0]);
  let loads = 0;
  const store = { ...f.store, load: async () => { loads++; return state; } };
  const baseline = await status(store, f.workItemId);
  assert.equal(baseline.items, undefined);
  const available = LIMITS.workingSet - outputBytes(baseline);
  state.checkpoint.activeTask = 'x'.repeat(available + 40);
  loads = 0;
  const page = await status(store, f.workItemId);
  assert.equal(loads, 1);
  assert.equal(page.inventory.repositories.count, 6);
  assert.ok(outputBytes(page) <= LIMITS.workingSet);
});

test('T-112 oversized safe missing conditions can be reconstructed from bounded finding pages', () => {
  const missing = Array.from({ length: 24000 }, (_, index) => `AC-065.${index}`);
  const finding = { rule: 'coverage-depth', verdict: 'unverified',
    reason: 'Acceptance-condition coverage is not established', missing };
  const page = boundedCheck([finding], 'artifacts', 'wi-test');
  assert.equal(page.findings[0].detailDigest, digest(finding));
  assert.match(page.findings[0].detailCommand, /--finding 0 --offset 0/u);
  let offset = 0;
  let detail = '';
  do {
    const part = boundedCheck([finding], 'artifacts', 'wi-test',
      { finding: 0, offset, limit: 65536 });
    assert.ok(outputBytes(part) <= LIMITS.workingSet);
    assert.equal(part.verdict, 'unverified');
    assert.equal(part.exitCode, 3);
    detail += part.detail;
    offset = part.nextOffset;
  } while (offset !== null);
  assert.deepEqual(JSON.parse(detail), finding);
});

test('T-112 finding detail projects unsafe text while preserving safe rule, verdict and URL context', () => {
  const secret = 'fixture-private-token';
  const finding = { rule: 'provider-observation', verdict: 'error',
    reason: `PROVIDER: https://example.invalid/item?token=${secret}&view=public`,
    evidence: `{"rawProviderResponse":"${secret}"}` };
  const inventory = boundedCheck([finding], 'state', 'wi-test');
  assert.equal(inventory.exitCode, 4);
  assert.equal(JSON.stringify(inventory).includes(secret), false);
  const page = boundedCheck([finding], 'state', 'wi-test',
    { finding: 0, offset: 0, limit: 65536 });
  assert.equal(page.exitCode, 4);
  assert.equal(outputBytes(page) <= LIMITS.workingSet, true);
  assert.equal(page.detail.includes(secret), false);
  const recovered = JSON.parse(page.detail);
  assert.equal(recovered.rule, 'provider-observation');
  assert.equal(recovered.verdict, 'error');
  assert.match(recovered.reason, /PROVIDER: https:\/\/example.invalid\/item\?token=\[redacted\]&view=public/u);
  assert.match(JSON.parse(recovered.evidence).rawProviderResponse,
    /^\[redacted:/u);
  const alternate = boundedCheck([{ rule: 'safe-url', verdict: 'error',
    reason: `https://example.invalid/item?accessToken=${secret}&view=public`,
    provider: `{"token":"${secret}"}` }], 'state', 'wi-test',
  { finding: 0 });
  assert.equal(alternate.detail.includes(secret), false);
  assert.match(JSON.parse(alternate.detail).reason,
    /https:\/\/example.invalid\/item\?accessToken=\[redacted\]&view=public/u);
  assert.match(JSON.parse(JSON.parse(alternate.detail).provider).token,
    /^\[redacted:/u);
});

test('T-112 large valid FR rule retains violation exit and is retrievable via check --finding', async t => {
  const f = await fixture(t);
  const ruleId = `FR-${'9'.repeat(LIMITS.workingSet + 5)}`;
  const file = path.join(f.repo, 'requirements.md');
  await writeFile(file, `## ${ruleId} - Scope\n\nA requirement without a Definition of Done.\n`);
  await registerArtifact(f.store, { workItemId: f.workItemId, role: 'requirements',
    repositoryId: 'primary', path: 'requirements.md' });
  const args = ['--home', f.home, '--work-item', f.workItemId];
  const summary = await runCli(['check', 'artifacts', ...args]);
  assert.equal(summary.exitCode, 2);
  assert.equal(summary.result.verdict, 'violation');
  const findingIndex = summary.result.findings.findIndex(item =>
    item.rule === 'redacted-or-oversized-rule' && item.verdict === 'violation');
  assert.ok(findingIndex >= 0);
  assert.match(summary.result.findings[findingIndex].detailCommand, /--home '.*isolated copilot home'/u);
  let offset = 0;
  let detail = '';
  do {
    const part = await runCli(['check', 'artifacts', ...args,
      '--finding', String(findingIndex), '--offset', String(offset), '--limit', '65536']);
    assert.equal(part.exitCode, 2);
    assert.equal(part.result.verdict, 'violation');
    assert.ok(outputBytes(part.result) <= LIMITS.workingSet);
    assert.ok(Buffer.byteLength(humanOutput(part.result) + '\n') <= LIMITS.workingSet);
    detail += part.result.detail;
    offset = part.result.nextOffset;
  } while (offset !== null);
  assert.equal(JSON.parse(detail).rule, `dod:${ruleId}`);
});

test('T-112 generated home commands select fixture store and finding inputs reject invalid indices', async t => {
  const f = await fixture(t);
  const store = { ...f.store, load: async () => {
    const state = await f.store.load(f.workItemId);
    state.records.push({ type: 'operation', id: 'op-1', status: 'uncertain',
      target: { rawPrompt: 'private' } });
    return state;
  } };
  const page = await status(store, f.workItemId);
  assert.match(page.items.find(item => item.id === 'op-1').detailCommand,
    /--home '.*isolated copilot home' --operation op-1$/u);
  const recovered = await resume(f.store, { cwd: f.repo,
    sessionId: f.sessionId, workItemId: f.workItemId });
  const selectedHome = recovered.detailCommand.match(/--home '([^']+)'/u)?.[1];
  assert.equal(selectedHome, f.home);
  const selected = await runCli(['status', '--work-item', f.workItemId,
    '--home', selectedHome, '--offset', '0', '--limit', '1']);
  assert.equal(selected.result.workItemId, f.workItemId);
  for (const args of [
    ['--finding', '-1'], ['--finding', '1.5'], ['--finding', '9007199254740992'],
    ['--finding', '99999'], ['--finding', '0', '--offset', '-1'],
    ['--finding', '0', '--limit', '65537'], ['--finding', '0', '--offset', '999999999'],
  ]) await assert.rejects(runCli(['check', 'state', '--home', f.home,
    '--work-item', f.workItemId, ...args]), { code: 'INPUT' });
  await assert.rejects(runCli(['status', '--finding', '0']), { code: 'INPUT' });
});

test('T-112 op show projects credential-bearing operation URLs from the selected home', async t => {
  const f = await fixture(t);
  const secret = 'fixture-private-sig';
  await f.store.transaction(f.workItemId, tx => {
    tx.put({ type: 'operation', id: 'operation-detail', workItemId: f.workItemId,
      repositoryId: 'primary', class: 'build',
      target: `https://example.invalid/build?sig=${secret}&view=public`,
      status: 'uncertain', requestFingerprint: 'fixture-fingerprint',
      correlationKey: 'fixture-correlation', dispatchBound: false });
  });
  const args = ['--home', f.home, '--work-item', f.workItemId];
  const page = await runCli(['status', ...args]);
  const command = page.result.items.find(item => item.id === 'operation-detail').detailCommand;
  assert.match(command, /--home '.*isolated copilot home' --operation operation-detail$/u);
  const shown = await runCli(['op', 'show', ...args, '--operation', 'operation-detail'],
    { stdin: { isTTY: true } });
  assert.equal(JSON.stringify(shown.result).includes(secret), false);
  assert.equal(shown.result.operation.target,
    'https://example.invalid/build?sig=[redacted]&view=public');
  assert.equal(shown.result.operation.status, 'uncertain');
});

test('T-112 resume checks its exact 1536-byte output including newline', async t => {
  const f = await fixture(t);
  const input = { cwd: f.repo, sessionId: f.sessionId, workItemId: f.workItemId };
  const baseline = await resume(f.store, input);
  const padding = LIMITS.context - outputBytes(baseline);
  assert.ok(padding > 0);
  f.store.home += 'x'.repeat(padding);
  const edge = await resume(f.store, input);
  assert.equal(outputBytes(edge), LIMITS.context);
  f.store.home += 'x';
  const beyond = await resume(f.store, input);
  assert.ok(outputBytes(beyond) <= LIMITS.context);
});
