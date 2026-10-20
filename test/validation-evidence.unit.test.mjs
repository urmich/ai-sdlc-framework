export const validationDeclarations = {
  "schemaVersion": 1,
  "surfaces": [{"coverage": "direct", "paths": ["src/validation-evidence.mjs", "src/core.mjs"]}]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import { safeSummary } from '../src/core.mjs';
import { reduceTestHistory, sanitizeExecutionPayload, validateRetainedPayload } from '../src/validation-evidence.mjs';

function permutations(items) {
  return items.length ? items.flatMap((item, index) =>
    permutations(items.filter((_, other) => other !== index))
      .map(rest => [item, ...rest])) : [[]];
}
const observedAt = '2026-10-08T00:00:00.000Z';
function observation(id, status, sequence, extra = {}) {
  return { id, status, sequence, observedAt, owner: 'agent', host: 'local',
    executionSourceDigest: 'a'.repeat(64), ...extra };
}

test('equal-time mixed producer reduction is permutation independent, not pairwise', () => {
  const history = [
    observation('direct-failed', 'Failed', 1),
    observation('operation-pending', 'NotRun', 2, { operationId: 'op-1' }),
    observation('direct-passed', 'Passed', 3),
  ];
  for (const order of permutations(history)) {
    assert.equal(reduceTestHistory(order)?.id, 'operation-pending');
  }
});

test('direct sequence supersedes only the same producer, including event ties', () => {
  const history = [
    observation('direct-failed', 'Failed', 1, { host: 'other' }),
    observation('direct-passed', 'Passed', 9),
    observation('event-passed', 'Passed', 10, { eventId: 'event-1' }),
  ];
  for (const order of permutations(history)) {
    assert.equal(reduceTestHistory(order)?.id, 'direct-failed');
  }
});

test('newer source timestamps dominate and equal ranks have stable identity ties', () => {
  const later = observation('later', 'Passed', 2,
    { observedAt: '2026-10-08T00:00:01.000Z' });
  assert.equal(reduceTestHistory([observation('old', 'Failed', 1), later]).id, 'later');
  const tied = [
    observation('a', 'Failed', 1, { eventId: 'event-a' }),
    observation('z', 'Failed', 2, { operationId: 'op-z' }),
  ];
  assert.equal(reduceTestHistory(tied).id, reduceTestHistory(tied.reverse()).id);
  assert.throws(() => reduceTestHistory([observation('invalid', 'Passed', 1,
    { observedAt: 'not-a-time' })]), { code: 'EVIDENCE' });
});

test('retained payload bytes, not just locators, are sanitized', () => {
  const source = { password: 'fixture-private-value',
    log: 'https://example.invalid/run?access_token=fixture-private-value' };
  const retained = sanitizeExecutionPayload(Buffer.from(JSON.stringify(source)));
  assert.doesNotMatch(JSON.stringify(retained), /fixture-private-value/u);
  assert.match(JSON.stringify(retained), /redacted/u);
  assert.throws(() => sanitizeExecutionPayload(Buffer.from([0xff, 0xfe])), { code: 'UNSAFE' });
});

test('T-PRD037 JWT diagnostics and signed query links are sanitized without changing case outcomes', () => {
  const jwt = [
    JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
    JSON.stringify({ sub: 'synthetic-fixture', purpose: 'not-a-real-credential' }),
    'synthetic-signature',
  ].map(value => Buffer.from(value).toString('base64url')).join('.');
  const unsigned = jwt.slice(0, jwt.lastIndexOf('.') + 1);
  const cases = [{ testId: 'T-one', status: 'Passed',
    assertions: [{ name: 'Original behavior remains observable', passed: true }] }];
  const source = {
    detail: `Worker returned ${jwt}`,
    nested: [JSON.stringify({ detail: jwt })],
    links: [
      `https://example.invalid/run?jwt=${jwt}&view=summary`,
      `https://example.invalid/run?%6a%77%74=${jwt.replaceAll('.', '%2E')}`,
      `https://example.invalid/run?trace=${jwt}`,
      `https://example.invalid/run?trace=${unsigned}`,
    ],
    jwt: 'synthetic-opaque-token',
    safe: 'release 1.2.3 and package/service.mjs',
    cases,
  };
  assert.throws(() => validateRetainedPayload(source), { code: 'UNSAFE' });
  for (const retained of [
    safeSummary(source),
    sanitizeExecutionPayload(Buffer.from(JSON.stringify(source))),
  ]) {
    assert.equal(JSON.stringify(retained).includes(jwt), false);
    assert.equal(JSON.stringify(retained).includes(unsigned), false);
    assert.equal(JSON.stringify(retained).includes('synthetic-opaque-token'), false);
    assert.equal(JSON.stringify(retained).includes(jwt.replaceAll('.', '%2E')), false);
    assert.match(JSON.stringify(retained), /redacted/u);
    assert.deepEqual(retained.cases, cases);
    assert.equal(retained.safe, source.safe);
    assert.doesNotThrow(() => validateRetainedPayload(retained));
  }
});

test('T-PRD037 JWT-bearing assertion identity is rejected rather than rewritten as passing proof', () => {
  const jwt = [
    JSON.stringify({ alg: 'none', typ: 'JWT' }),
    JSON.stringify({ sub: 'synthetic-identity-fixture' }),
    '',
  ].map(value => Buffer.from(value).toString('base64url')).join('.');
  const source = { cases: [{ testId: 'T-one', status: 'Passed',
    assertions: [{ name: `Verify ${jwt}`, passed: true }] }] };
  assert.throws(() => sanitizeExecutionPayload(Buffer.from(JSON.stringify(source))),
    { code: 'UNSAFE' });
  assert.equal(source.cases[0].status, 'Passed');
  assert.equal(source.cases[0].assertions[0].name, `Verify ${jwt}`);
});

test('declared sanitizer covers environment secrets and HTTP session headers without changing assertions', () => {
  const raw = Buffer.from('AWS_SECRET_ACCESS_KEY=fixture-not-a-real-secret\n' +
    'Cookie: session=fixture-not-a-real-cookie\n' +
    'X-API-Key: fixture-not-a-real-api-key\n' +
    'export SERVICE_AUTH_TOKEN="fixture-not-a-real-token"\n' +
    'case T-one: Passed\n');
  const retained = sanitizeExecutionPayload(raw);
  assert.doesNotMatch(retained, /fixture-not-a-real-(?:secret|cookie|api-key|token)/u);
  assert.match(retained, /case T-one: Passed/u);
  const structured = sanitizeExecutionPayload(Buffer.from(JSON.stringify({
    AWS_SECRET_ACCESS_KEY: 'fixture-env-secret',
    headers: { Cookie: 'fixture-session-cookie' },
    cases: [{ testId: 'T-one', status: 'Passed',
      assertions: [{ name: 'Verify signed request', passed: true }] }],
  })));
  assert.doesNotMatch(JSON.stringify(structured), /fixture-env-secret|fixture-session-cookie/u);
  assert.equal(structured.cases[0].assertions[0].passed, true);
  assert.throws(() => sanitizeExecutionPayload(Buffer.from(JSON.stringify({
    cases: [{ testId: 'T-one', status: 'Passed',
      assertions: [{ name: 'Cookie: fixture-required-sensitive-proof', passed: true }] }],
  }))), { code: 'UNSAFE' });
});

test('bounded sanitizer follows nested JSON strings, escaped arrays and embedded log fragments', () => {
  const embedded = JSON.stringify({
    AWS_SECRET_ACCESS_KEY: 'fixture-embedded-secret', Cookie: 'session=fixture-embedded-cookie',
  });

  const source = {
    log: embedded,
    twice: JSON.stringify(embedded),
    array: [JSON.stringify([{ payload: embedded }])],
    fragment: `prefix ${embedded} suffix`,
    escapedFragment: `capture ${JSON.stringify(embedded)} end`,
    headers: JSON.stringify({ log: 'Cookie: session=fixture-nested-header' }),
    safe: 'case T-one: Passed',
  };
  const retained = sanitizeExecutionPayload(Buffer.from(JSON.stringify(source)));
  assert.doesNotMatch(JSON.stringify(retained),
    /fixture-embedded-secret|fixture-embedded-cookie|fixture-nested-header/u);
  assert.equal(retained.safe, source.safe);
  assert.match(retained.fragment, /^prefix .* suffix$/u);
  assert.throws(() => sanitizeExecutionPayload(Buffer.from(JSON.stringify({
    cases: [{ testId: 'T-one', status: 'Passed', assertions: [{ name: embedded, passed: true }] }],
  }))), { code: 'UNSAFE' });
  let deeplyEncoded = embedded;
  for (let level = 0; level < 20; level++) deeplyEncoded = JSON.stringify(deeplyEncoded);
  assert.throws(() => sanitizeExecutionPayload(Buffer.from(JSON.stringify({ log: deeplyEncoded }))),
    { code: 'CAPACITY' });
  assert.throws(() => sanitizeExecutionPayload(Buffer.from(JSON.stringify({
    log: '['.repeat(40) + '0' + ']'.repeat(40),
  }))), { code: 'CAPACITY' });
  assert.throws(() => sanitizeExecutionPayload(Buffer.from(JSON.stringify({
    log: 'capture {"AWS_SECRET_ACCESS_KEY":"unterminated',
  }))), { code: 'UNSAFE' });
});

test('unsupported Python and mixed-quoted credential fragments fail closed while normal diagnostics survive', () => {
  for (const fragment of [
    "log{'AWS_SECRET_ACCESS_KEY':'fixture-python-secret','Cookie':'session=fixture-python-cookie'}end",
    "log{'aws-secret-access-key':'fixture-python-secret','cookie':'session=fixture-python-cookie'}end",
    'log{"AWS_SECRET_ACCESS_KEY":\'fixture-python-secret\'}end',
    'log{AWS_SECRET_ACCESS_KEY:fixture-python-secret}end',
    "log{'x_api_key':'fixture-python-secret'}end",
    "log{'awsSecretAccessKey':'fixture-python-secret'}end",
    "log{'AWS_SECRET_ACCESS_KEY':'fixture-python-secret'end",
  ]) {
    assert.throws(() => sanitizeExecutionPayload(Buffer.from(JSON.stringify({ log: fragment }))),
      { code: 'UNSAFE' });
    assert.throws(() => sanitizeExecutionPayload(Buffer.from(JSON.stringify({
      cases: [{ testId: 'T-one', status: 'Passed',
        assertions: [{ name: fragment, passed: true }] }],
    }))), { code: 'UNSAFE' });
  }
  const diagnostics = { log: "worker's diagnostic {count:2} complete", value: 'ordinary message' };
  assert.deepEqual(sanitizeExecutionPayload(Buffer.from(JSON.stringify(diagnostics))), diagnostics);
  const supported = sanitizeExecutionPayload(Buffer.from(JSON.stringify({
    log: 'log{"aws-secret-access-key":"fixture-json-key","x_api_key":"fixture-json-api"}end',
  })));
  assert.doesNotMatch(JSON.stringify(supported), /fixture-json-key|fixture-json-api/u);
});
