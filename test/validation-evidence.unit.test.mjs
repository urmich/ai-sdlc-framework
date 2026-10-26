export const validationDeclarations = {
  "schemaVersion": 1,
  "surfaces": [{"coverage": "direct", "paths": ["src/validation-evidence.mjs", "src/validation-readiness.mjs", "src/core.mjs"]}],
  "applicability": [{
    "names": ["T-PRD037 fresh readiness validation reuses only its own canonical input and retains every data guard"],
    "platforms": ["linux-x64", "windows-x64", "macos-arm64", "macos-x64"],
    "owner": "evidence-validation",
    "reason": "PR-only pure Node regression for invocation-local serialization reuse, fresh mutable-input rejection and unchanged JSON/redaction bounds; no critical promotion or shared process concurrency.",
    "prerequisites": ["Node"]
  }]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, createSummarySanitizer, digest, safeSummary } from '../src/core.mjs';
import { reduceTestHistory, sanitizeExecutionPayload, validateRetainedPayload } from '../src/validation-evidence.mjs';
import { validateReadinessData } from '../src/validation-readiness.mjs';

test('T-PRD037 fresh readiness validation reuses only its own canonical input and retains every data guard', t => {
  const initial = 'owned-canonical-input-fixture';
  const changed = `${initial}-changed`;
  const stringify = JSON.stringify;
  let encodings = 0;
  t.mock.method(JSON, 'stringify', function (value, ...args) {
    if (value === initial || value === changed) encodings++;
    return Reflect.apply(stringify, this, [value, ...args]);
  });
  const source = { detail: initial, complete: true };
  assert.equal(validateReadinessData(source), source);
  assert.equal(encodings, 2, 'Encode the input and sanitized result once each, not the original twice');
  source.detail = changed;
  encodings = 0;
  assert.equal(validateReadinessData(source), source);
  assert.equal(encodings, 2, 'A later call must encode the changed input afresh');
  source.detail = 'Authorization: owned-private-fixture';
  assert.throws(() => validateReadinessData(source), { code: 'UNSAFE' });
  source.detail = initial;
  encodings = 0;
  assert.equal(validateReadinessData(source), source);
  assert.equal(encodings, 2, 'Neither passing nor rejected inputs confer cached validation');

  const unicode = { detail: 'é' };
  const bytes = Buffer.byteLength(stringify(unicode));
  assert.equal(validateReadinessData(unicode, bytes), unicode);
  assert.throws(() => validateReadinessData(unicode, bytes - 1), { code: 'CAPACITY' });
  let getterReads = 0;
  const accessor = { get detail() { getterReads++; return initial; } };
  for (const value of [accessor, { [Symbol('hidden')]: initial },
    Object.create({ inherited: initial }), new Date(), { detail: undefined },
    { detail: Infinity }, { detail: () => initial }]) {
    assert.throws(() => validateReadinessData(value), { code: 'INPUT' });
  }
  assert.equal(getterReads, 0, 'Plain-data admission must reject accessors without invoking them');
  for (const wrap of [value => value, value => ({ nested: [value] })]) {
    let reads = 0;
    const changing = new Proxy({ detail: initial }, {
      get(target, key, receiver) {
        if (key === 'detail') return ++reads < 3 ? initial : 'Authorization: owned-private-fixture';
        return Reflect.get(target, key, receiver);
      },
    });
    assert.throws(() => validateReadinessData(wrap(changing)), { code: 'UNSAFE' },
      'A proxy may change during validation and must retain the original fresh equality read');
    assert.equal(reads, 3);
  }
  for (const value of [{ detail: '\u0001' }, { password: 'owned-private-fixture' },
    { detail: 'output {"token":"owned-private-fixture"}' }]) {
    assert.throws(() => validateReadinessData(value), { code: 'UNSAFE' });
  }
  let deep = initial;
  for (let index = 0; index < 34; index++) deep = { detail: deep };
  assert.throws(() => validateReadinessData(deep), { code: 'CAPACITY' });
});

test('T-PRD037 markerless payload text retains core redaction without impossible structured scans', t => {
  const value = 'owned-markerless-path/0123456789abcdef';
  const replace = String.prototype.replace;
  let headerScans = 0;
  t.mock.method(String.prototype, 'replace', function (pattern, ...args) {
    if (String(this) === value && pattern?.source.includes('Proxy-Authorization')) headerScans++;
    return Reflect.apply(replace, this, [pattern, ...args]);
  });
  validateRetainedPayload(value);
  assert.equal(headerScans, 0);
  const jwt = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.opaque.payload`;
  assert.throws(() => validateRetainedPayload(jwt), { code: 'UNSAFE' },
    'Markerless text must still use the existing core redactor');
  for (const unsafe of [
    'Authorization: owned-fixture-value',
    'ACCESS_TOKEN=owned-fixture-value',
    'result {"password":"owned-fixture-value"}',
  ]) assert.throws(() => validateRetainedPayload(unsafe), { code: 'UNSAFE' });
});

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

test('T-PRD037 repeated summary text is sanitized once per traversal without reusing another call', () => {
  const text = 'Read https://example.invalid/run?token=fixture-value&view=summary';
  const matchAll = String.prototype.matchAll;
  let scans = 0;
  String.prototype.matchAll = function (...args) {
    if (String(this) === text) scans++;
    return Reflect.apply(matchAll, this, args);
  };
  try {
    const expected = safeSummary(text);
    const once = scans;
    assert.ok(once > 0, 'The observer must see the actual text sanitizer');
    assert.doesNotMatch(expected, /fixture-value/u);
    assert.match(expected, /view=summary/u);
    scans = 0;
    assert.deepEqual(safeSummary({ first: text, nested: { second: text }, list: [text] }),
      { first: expected, nested: { second: expected }, list: [expected] });
    assert.equal(scans, once, 'Identical text must not repeat pure parsing in one traversal');
    scans = 0;
    assert.deepEqual(safeSummary({ first: text, second: text }),
      { first: expected, second: expected });
    assert.equal(scans, once, 'A separate call must sanitize its inputs again');
    assert.match(safeSummary({ password: text, visible: text }).password,
      /^\[redacted:[a-f0-9]{64}\]$/u);
  } finally {
    String.prototype.matchAll = matchAll;
  }
  const texts = Array.from({ length: 512 }, (_, index) =>
    `https://example.invalid/run/${index}?token=fixture-${index}&view=summary`);
  const large = `${'ordinary diagnostic '.repeat(5000)}${text}`;
  assert.deepEqual(safeSummary({ texts, large, tail: [text, text] }), {
    texts: texts.map(safeSummary),
    large: safeSummary(large),
    tail: [safeSummary(text), safeSummary(text)],
  });
});

test('T-PRD037 retained text summaries reuse only identical strings inside one bounded sanitization', () => {
  const text = 'https://example.invalid/retained-summary/fixture?view=summary';
  const matchAll = String.prototype.matchAll;
  let scans = 0;
  String.prototype.matchAll = function (...args) {
    if (String(this) === text) scans++;
    return Reflect.apply(matchAll, this, args);
  };
  try {
    assert.equal(safeSummary(text), text);
    const once = scans;
    assert.ok(once > 0);
    for (let call = 0; call < 2; call++) {
      scans = 0;
      assert.doesNotThrow(() => validateRetainedPayload([text, text, text]));
      assert.equal(scans, once, 'Only pure summary scans are shared, never another invocation');
    }
    scans = 0;
    assert.doesNotThrow(() => validateRetainedPayload({ first: text, nested: { second: text } }));
    assert.equal(scans, once, 'Ancestor summaries reuse the same invocation-owned text work');
    const changed = [text, `${text}&token=fixture-private-value`];
    assert.throws(() => validateRetainedPayload(changed), { code: 'UNSAFE' });
    assert.throws(() => validateRetainedPayload(Array(65537).fill(text)), { code: 'CAPACITY' });
    const summarize = createSummarySanitizer();
    let reads = 0;
    const source = { get detail() { return ++reads === 1 ? text : `${text}&token=fixture-private-value`; } };
    const first = summarize(source);
    assert.equal(reads, 1);
    first.detail = 'caller mutation';
    assert.deepEqual(summarize({ detail: text }), { detail: text });
    const second = summarize(source);
    assert.equal(reads, 2);
    assert.doesNotMatch(second.detail, /fixture-private-value/u);
    assert.match(summarize({ password: text }).password, /^\[redacted:[a-f0-9]{64}\]$/u);
  } finally {
    String.prototype.matchAll = matchAll;
  }
});

test('T-PRD037 plain summary literals avoid rich-text scans without bypassing sensitive keys or limits', () => {
  const literals = ['', 'Passed', 'NotRun', 'provider', 'linux', 'x64',
    'Original behavior remains observable', 'a'.repeat(64)];
  const selected = new Set(literals);
  const matchAll = String.prototype.matchAll;
  let scans = 0;
  String.prototype.matchAll = function (...args) {
    if (selected.has(String(this))) scans++;
    return Reflect.apply(matchAll, this, args);
  };
  try {
    for (const text of literals) assert.equal(safeSummary(text), text);
    assert.deepEqual(safeSummary({ values: literals }), { values: literals });
    assert.equal(scans, 0, 'Policy-inert literals must not enter rich-text scanners');
    const protectedKeys = safeSummary({ password: 'Passed', token: literals.at(-1) });
    for (const value of Object.values(protectedKeys)) {
      assert.match(value, /^\[redacted:[a-f0-9]{64}\]$/u);
    }
  } finally {
    String.prototype.matchAll = matchAll;
  }
  for (const text of [
    'rawPrompt: fixture-private-value; visible tail',
    'https://example.invalid/run?token=fixture-private-value&view=public',
    '{"password":"fixture-private-value","safe":"visible"}',
    'ghp_' + 'a'.repeat(32),
    '-----BEGIN PRIVATE KEY-----\nfixture-private-value\n-----END PRIVATE KEY-----',
  ]) {
    assert.notEqual(safeSummary(text), text);
    assert.doesNotMatch(safeSummary(text), /fixture-private-value/u);
  }
  assert.throws(() => sanitizeExecutionPayload(Buffer.alloc(LIMITS.artifact + 1, 0x61)),
    { code: 'CAPACITY' });
});

test('T-PRD037 decoded JWT non-object headers avoid JSON parsing without changing redaction policy', () => {
  const token = header => `${Buffer.from(header).toString('base64url')}.opaque.payload`;
  const ordinary = Array.from({ length: 64 }, (_, index) => token(`ordinary-not-json-${index}`));
  const parse = JSON.parse;
  let scans = 0;
  JSON.parse = function (value, ...args) {
    if (typeof value === 'string' && value.startsWith('ordinary-not-json-')) scans++;
    return Reflect.apply(parse, this, [value, ...args]);
  };
  try {
    assert.deepEqual(safeSummary(ordinary), ordinary);
    assert.equal(scans, 0, 'Decoded non-object headers must not incur failed JSON parses');
  } finally {
    JSON.parse = parse;
  }
  for (const header of [
    '{"alg":"HS256"}',
    ' \r\n\t{"extra":true,"alg":" none "}',
    '{"alg":"\\u0048S256"}',
  ]) {
    const jwt = token(header);
    assert.equal(safeSummary(jwt), `[redacted:${digest(jwt)}]`);
  }
  for (const header of [
    '{}', '{"alg":""}', '{"alg":" "}', '{"alg":false}', '{"alg":5}',
    '[{"alg":"HS256"}]', 'null', '"HS256"', '{"alg":',
    '\ufeff{"alg":"HS256"}', '\u00a0{"alg":"HS256"}',
  ]) {
    const text = token(header);
    assert.equal(safeSummary(text), text);
  }
  const oversized = `${'a'.repeat(4097)}.opaque.payload`;
  assert.equal(safeSummary(oversized), `[redacted:${digest(oversized)}]`);
});

test('T-PRD037 punctuation-only diagnostics skip fragment discovery but retain scalar redaction', () => {
  const jwt = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.opaque.payload`;
  const examples = [
    ['test/public-readiness-observer.test.mjs:810 (linux-x64)', null],
    ['worker\'s "visible" diagnostic — complete', null],
    ['password=fixture-private-value; visible tail',
      `password=[redacted:${digest('fixture-private-value')}]; visible tail`],
    [`worker returned ${jwt}`, `worker returned [redacted:${digest(jwt)}]`],
    ['ghp_' + 'a'.repeat(32), `[redacted:${digest('ghp_' + 'a'.repeat(32))}]`],
    ['https://example.invalid/run?token=fixture-private-value&view=public',
      'https://example.invalid/run?token=[redacted]&view=public'],
  ];
  const matchAll = String.prototype.matchAll;
  for (const [source, expected] of examples) {
    let assignmentScans = 0;
    String.prototype.matchAll = function (expression) {
      if (String(this) === source && expression.source.includes('rawPrompt')) assignmentScans++;
      return Reflect.apply(matchAll, this, [expression]);
    };
    try {
      assert.equal(safeSummary(source), expected ?? source);
      assert.equal(assignmentScans, 1, 'No duplicate assignment scan for fragment discovery');
    } finally {
      String.prototype.matchAll = matchAll;
    }
  }
  const encoded = 'capture {"password":"fixture-private-value"} end';
  assert.doesNotMatch(safeSummary(encoded), /fixture-private-value/u);
  assert.doesNotMatch(safeSummary('capture {"\\u0070assword":"fixture-private-value"} end'),
    /fixture-private-value/u);
  for (const fragment of [
    "log{'AWS_SECRET_ACCESS_KEY':'fixture-private-value'}end",
    'log{"AWS_SECRET_ACCESS_KEY":\'fixture-private-value\'}end',
    'capture {"AWS_SECRET_ACCESS_KEY":"unterminated',
  ]) {
    assert.throws(() => sanitizeExecutionPayload(Buffer.from(JSON.stringify({ log: fragment }))),
      { code: 'UNSAFE' });
  }
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
