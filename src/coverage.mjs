import path from 'node:path';
import { LIMITS, SdlcError, canonical, choice, digest, id, object, requireThat,
  safeRecord, strings, text, unsafeSummaryContent } from './core.mjs';
import { normalizeTestDefinition, splitMarkdownTableRow, testSpecificationDigest } from './artifacts.mjs';
import { validateTestDefinitions } from './validation-catalog.mjs';

export const COVERAGE_START = '<!-- sdlc-coverage:v1 -->';
export const COVERAGE_END = '<!-- /sdlc-coverage -->';
export const COVERAGE_MAX_BYTES = 32 * 1024;
export const PR_BODY_MAX_BYTES = 64 * 1024;

const requirementId = /^FR-\d+$/u;
const conditionId = /^AC-\d+\.\d+$/u;
const testId = /^T-[A-Za-z0-9._-]+$/u;
const sha256 = /^[a-f0-9]{64}$/u;
const revision = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const outcomes = ['NotRun', 'Passed', 'Failed'];

function record(value, allowed, required = allowed) {
  requireThat(value && Object.getPrototypeOf(value) === Object.prototype &&
    Object.values(Object.getOwnPropertyDescriptors(value)).every(field =>
      Object.hasOwn(field, 'value')), 'COVERAGE', 'Expected plain coverage data');
  requireThat(Object.keys(value).every(key => allowed.includes(key)),
      'COVERAGE', 'Unknown coverage field');
  return object(value, allowed, required);
}
function parseCoverageJson(contents, label) {
  try { return JSON.parse(contents); }
  catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      throw new SdlcError('COVERAGE', `Malformed ${label} JSON`);
  }
}
function identity(value, pattern, label) {
  text(value, label, 100);
  requireThat(pattern.test(value), 'COVERAGE', `Invalid ${label}`);
  return value;
}
function unique(values, label) {
  requireThat(new Set(values).size === values.length,
    'COVERAGE', `Duplicate ${label}`);
}
function sourcePath(value) {
  text(value, 'specification path', 512);
  requireThat(!path.win32.isAbsolute(value) && !path.posix.isAbsolute(value) &&
    !/[:\u0000-\u001f?#]/u.test(value),
  'COVERAGE', 'Specification path must be repository-relative');
  requireThat(!unsafeSummaryContent(value), 'UNSAFE',
    'Specification path contains unsupported sensitive identity data');
  const parts = value.replaceAll('\\', '/').split('/');
  requireThat(parts.every(part => part && !['.', '..', '.git', '.sdlc']
    .includes(part.toLowerCase())), 'COVERAGE', 'Unsafe specification path');
  return parts.join('/');
}
export { sourcePath as validateCoverageSourcePath };
function document(value) {
  record(value, ['artifactId', 'path', 'contents'], ['path', 'contents']);
  const artifactId = id(value.artifactId ?? 'default', 'artifact ID');
  text(value.contents, 'specification contents', LIMITS.artifact);
  return { artifactId, path: sourcePath(value.path), contents: value.contents };
}
function plainCell(value) {
  const trimmed = value.trim();
  return /^`[^`]*`$/u.test(trimmed) ? trimmed.slice(1, -1) : trimmed;
}
function tableCells(line) {
  return splitMarkdownTableRow(line.trim()).slice(1, -1).map(plainCell);
}
function links(value, patterns, label) {
  const values = value.replaceAll('`', '').split(/[;,\s]+/u).filter(Boolean);
  requireThat(values.every(item => patterns.some(pattern => pattern.test(item))),
    'COVERAGE', `Unsupported ${label}; list explicit stable IDs`);
  unique(values, label);
  return values;
}
function* definitionLines(contents, label) {
  let fence;
  for (const [index, line] of contents.split(/\r?\n/u).entries()) {
    if (fence) {
      const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u.exec(line);
      if (closing && closing[1][0] === fence.marker && closing[1].length >= fence.length) {
        fence = undefined;
      }
      yield [index, ''];
      continue;
    }
    const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (opening && (opening[1][0] === '~' || !opening[2].includes('`'))) {
      fence = { marker: opening[1][0], length: opening[1].length };
      yield [index, ''];
      continue;
    }
    yield [index, line];
  }
  requireThat(!fence, 'COVERAGE', `Unclosed fenced example in ${label}`);
}
function requirementsFrom(contents) {
  const result = [];
  let current;
  let requirementDepth = 0;
  let definitionOfDone = false;
  for (const [index, line] of definitionLines(contents, 'Requirements')) {
    const heading = /^#{2,6}\s+(FR-\d+)\s*[-\u2013:]\s*\S.*$/u.exec(line);
    if (/^#{2,6}\s+FR-/u.test(line)) {
      requireThat(heading, 'COVERAGE',
        `Malformed requirement heading at line ${index + 1}`);
      current = { id: heading[1], conditions: [], outOfScope: false, dod: false };
      requirementDepth = /^#+/u.exec(line)[0].length;
      result.push(current);
      definitionOfDone = false;
      continue;
    }
    const boundary = /^(#{1,6})\s/u.exec(line);
    if (boundary && boundary[1].length <= requirementDepth) {
      current = undefined;
      definitionOfDone = false;
    }
    if (!current) continue;
    if (line.trim() === '**Definition of Done**') {
      requireThat(!definitionOfDone, 'COVERAGE',
        `Duplicate Definition of Done for ${current.id}`);
      definitionOfDone = true;
      current.dod = true;
    }
    if (/^\s*(?:\*\*)?Classification:\s*(?:\*\*)?out-of-scope\b/iu.test(line)) {
      current.outOfScope = true;
    }
    if (/^\s*-\s+AC-/u.test(line)) {
      const condition = /^\s*-\s+(AC-\d+\.\d+):\s*\S.*$/u.exec(line);
      requireThat(definitionOfDone && condition, 'COVERAGE',
        `Malformed acceptance condition at line ${index + 1}`);
      requireThat(condition[1].split('.')[0].slice(3) === current.id.slice(3),
        'COVERAGE', `Acceptance condition belongs to another requirement at line ${index + 1}`);
      current.conditions.push(condition[1]);
    }
  }
  requireThat(result.length > 0, 'COVERAGE', 'Requirements contain no definitions');
  unique(result.map(item => item.id), 'requirement ID');
  for (const item of result) {
    unique(item.conditions, 'acceptance condition ID');
    requireThat(item.outOfScope || item.dod && item.conditions.length > 0,
      'COVERAGE', `Requirement ${item.id} needs an explicit DoD and acceptance conditions`);
  }
  return result;
}
function testFrom(value) {
  record(value, ['id', 'requirements', 'conditions', 'environment', 'level',
    'checkpoint', 'mode', 'owner', 'location', 'expected', 'implementation',
    'status', 'evidenceRef', 'activity', 'blockers', 'outOfScope'],
  ['id', 'requirements', 'conditions', 'environment', 'level', 'checkpoint',
    'mode', 'owner', 'location', 'expected', 'implementation']);
  identity(value.id, testId, 'test ID');
  strings(value.requirements, 'test requirement IDs', 10000);
  strings(value.conditions, 'test condition IDs', 10000);
  requireThat(value.requirements.every(item => requirementId.test(item)) &&
    value.conditions.every(item => conditionId.test(item)),
  'COVERAGE', 'Invalid test coverage reference');
  if (value.status !== undefined) choice(value.status, outcomes, 'test status projection');
  if (value.outOfScope !== undefined) requireThat(typeof value.outOfScope === 'boolean',
    'COVERAGE', 'Test scope must be explicit boolean data');
  text(value.checkpoint, 'test checkpoint');
  requireThat(value.outOfScope === true ||
    value.requirements.length > 0 && value.conditions.length > 0,
  'COVERAGE', 'Each required test needs explicit requirement and AC links');
  return { ...normalizeTestDefinition(value), requirements: [...value.requirements],
    conditions: [...value.conditions], outOfScope: value.outOfScope === true };
}
function testsFrom(contents) {
  if (contents.trimStart().startsWith('{')) {
    const parsed = parseCoverageJson(contents, 'Test Plan');
    record(parsed, ['schemaVersion', 'tests'], ['tests']);
    requireThat(parsed.schemaVersion === undefined || parsed.schemaVersion === 1,
      'COVERAGE', 'Unsupported Test Plan schema version');
    requireThat(Array.isArray(parsed.tests) && parsed.tests.length <= 10000,
      'COVERAGE', 'Invalid Test Plan definitions');
    return parsed.tests.map(testFrom);
  }
  const result = [];
  let headings;
  for (const [index, line] of definitionLines(contents, 'Test Plan')) {
    if (/^(?: {4}| {0,3}\t)/u.test(line)) {
      headings = undefined;
      continue;
    }
    if (!line.trim().startsWith('|')) { headings = undefined; continue; }
    requireThat(line.trim().endsWith('|'), 'COVERAGE',
      `Unclosed Test Plan row at line ${index + 1}`);
    const cells = tableCells(line);
    if (cells.some(cell => /^id$/iu.test(cell)) &&
        cells.some(cell => /^status$/iu.test(cell))) {
      headings = cells.map(cell => cell.toLowerCase());
      unique(headings, 'Test Plan column');
      for (const required of ['id', 'requirements', 'environment', 'level',
        'checkpoint', 'mode', 'owner', 'location', 'implementation', 'status']) {
        requireThat(headings.includes(required), 'COVERAGE',
          `Test Plan is missing the ${required} column`);
      }
      requireThat(headings.includes('expected outcome') ||
        headings.includes('observe or assert'), 'COVERAGE',
      'Test Plan needs an expected-result column');
      continue;
    }
    if (!cells[0]?.startsWith('T-')) continue;
    requireThat(headings && headings.length === cells.length, 'COVERAGE',
      `Malformed Test Plan definition at line ${index + 1}`);
    const fields = Object.fromEntries(headings.map((heading, offset) =>
      [heading, cells[offset]]));
    const references = links(fields.requirements,
      [requirementId, conditionId], 'Requirements links');
    const conditions = links(fields.conditions ?? '', [conditionId], 'Conditions links');
    const combinedConditions = [...references.filter(item => conditionId.test(item)),
      ...conditions];
    unique(combinedConditions, 'test condition link');
    result.push(testFrom({
      id: fields.id, requirements: references.filter(item => requirementId.test(item)),
      conditions: combinedConditions, environment: fields.environment,
      level: fields.level, checkpoint: fields.checkpoint, mode: fields.mode,
      owner: fields.owner, location: fields.location,
      expected: fields['expected outcome'] ?? fields['observe or assert'],
      implementation: fields.implementation, status: fields.status,
      outOfScope: fields.classification === 'out-of-scope',
    }));
  }
  requireThat(result.length > 0, 'COVERAGE', 'Test Plan contains no definitions');
  return result;
}
function documents(values, label) {
  requireThat(Array.isArray(values) && values.length > 0 && values.length <= 100,
    'COVERAGE', `Supply the canonical ${label} documents`);
  const result = values.map(document).sort((left, right) =>
    compare(left.artifactId, right.artifactId) || compare(left.path, right.path));
  unique(result.map(item => item.artifactId), `${label} artifact ID`);
  unique(result.map(item => item.path), `${label} path`);
  return result;
}
export function compileCoverage(input) {
  record(input, ['repositoryId', 'requirements', 'testPlans']);
  const repositoryId = id(input.repositoryId, 'repository ID');
  const requirements = documents(input.requirements, 'Requirements');
  const testPlans = documents(input.testPlans, 'Test Plan');
  requireThat([...requirements, ...testPlans].reduce((size, item) =>
    size + Buffer.byteLength(item.contents), 0) <= LIMITS.artifact,
  'CAPACITY', 'Coverage source documents exceed the combined byte budget');
  unique([...requirements, ...testPlans].map(item => item.path), 'specification role path');
  const definitions = requirements.flatMap(item => requirementsFrom(item.contents));
  unique(definitions.map(item => item.id), 'requirement ID across documents');
  const tests = testPlans.flatMap(item => testsFrom(item.contents));
  unique(tests.map(item => item.id), 'test ID across documents');
  const required = definitions.filter(item => !item.outOfScope);
  const selectedTests = tests.filter(item => !item.outOfScope);
  validateTestDefinitions(selectedTests.map(normalizeTestDefinition),
    { inline: false, requireUnitFirst: false });
  const requirementMap = new Map(definitions.map(item => [item.id, item]));
  const conditionMap = new Map(definitions.flatMap(item =>
    item.conditions.map(condition => [condition, item.id])));
  for (const item of tests) {
    for (const reference of item.requirements) requireThat(requirementMap.has(reference),
      'COVERAGE', `Unknown requirement reference in ${item.id}`);
    for (const reference of item.conditions) {
      const parent = conditionMap.get(reference);
      requireThat(parent && item.requirements.includes(parent), 'COVERAGE',
        `Unknown or mismatched acceptance condition in ${item.id}`);
    }
  }
  const coverage = required.flatMap(item => item.conditions.map(condition => ({
    requirement: item.id, condition,
    tests: selectedTests.filter(test => test.conditions.includes(condition))
      .map(test => test.id).sort(compare),
  }))).sort((left, right) => compare(left.condition, right.condition));
  return {
    repositoryId,
    requirements: requirements.map(item => ({
      artifactId: item.artifactId, path: item.path, sha256: digest(item.contents),
    })),
    testPlans: testPlans.map(item => ({
      artifactId: item.artifactId, path: item.path,
      definitionDigest: testSpecificationDigest(item.contents),
    })),
    definitions, tests, coverage,
    uncovered: coverage.filter(item => item.tests.length === 0).map(item => item.condition),
  };
}
function references(values, role) {
  requireThat(Array.isArray(values) && values.length > 0 && values.length <= 100,
    'COVERAGE', `Invalid ${role} references`);
  const field = role === 'requirements' ? 'sha256' : 'definitionDigest';
  const result = values.map(item => {
    record(item, ['artifactId', 'path', field]);
    return { artifactId: id(item.artifactId, 'artifact ID'), path: sourcePath(item.path),
      [field]: identity(item[field], sha256, 'specification digest') };
  }).sort((left, right) => compare(left.artifactId, right.artifactId));
  unique(result.map(item => item.artifactId), `${role} artifact ID`);
  unique(result.map(item => item.path), `${role} path`);
  return result;
}
export function validateCoverageMetadata(value) {
  record(value, ['schemaVersion', 'repositoryId', 'sourceRevision', 'requirements',
    'testPlans', 'coverage', 'uncovered']);
  requireThat(value.schemaVersion === 1, 'COVERAGE', 'Unsupported coverage schema version');
  const requirements = references(value.requirements, 'requirements');
  const testPlans = references(value.testPlans, 'testPlans');
  unique([...requirements, ...testPlans].map(item => item.path), 'specification role path');
  requireThat(Array.isArray(value.coverage) && value.coverage.length <= 10000,
    'COVERAGE', 'Invalid coverage mapping');
  const coverage = value.coverage.map(item => {
    record(item, ['requirement', 'condition', 'tests']);
    identity(item.requirement, requirementId, 'requirement ID');
    identity(item.condition, conditionId, 'acceptance condition ID');
    requireThat(item.condition.split('.')[0].slice(3) === item.requirement.slice(3),
      'COVERAGE', 'Acceptance condition belongs to another requirement');
    strings(item.tests, 'covered test IDs', 10000);
    for (const test of item.tests) identity(test, testId, 'covered test ID');
    return { requirement: item.requirement, condition: item.condition,
      tests: [...item.tests].sort(compare) };
  }).sort((left, right) => compare(left.condition, right.condition));
  unique(coverage.map(item => item.condition), 'coverage condition');
  strings(value.uncovered, 'uncovered condition IDs', 10000);
  const uncovered = [...value.uncovered].sort(compare);
  requireThat(canonical(uncovered) === canonical(coverage
    .filter(item => item.tests.length === 0).map(item => item.condition)),
  'COVERAGE', 'Uncovered conditions contradict the declared mapping');
  const result = { schemaVersion: 1,
    repositoryId: id(value.repositoryId, 'repository ID'),
    sourceRevision: identity(value.sourceRevision, revision, 'source revision'),
    requirements, testPlans, coverage, uncovered };
  safeRecord(result, COVERAGE_MAX_BYTES);
  return result;
}
function coverageProjection(input) {
  record(input, ['repositoryId', 'sourceRevision', 'requirements', 'testPlans']);
  identity(input.sourceRevision, revision, 'source revision');
  const { sourceRevision, ...specification } = input;
  const compiled = compileCoverage(specification);
  return {
    metadata: validateCoverageMetadata({
      schemaVersion: 1, repositoryId: compiled.repositoryId, sourceRevision,
      requirements: compiled.requirements, testPlans: compiled.testPlans,
      coverage: compiled.coverage, uncovered: compiled.uncovered,
    }),
    unresolved: compiled.tests.filter(item => !item.outOfScope &&
      /^(?:planned:|add during coding\b)/iu.test(item.implementation))
      .map(item => item.id).sort(compare),
  };
}
export function prepareCoverage(input) {
  return coverageProjection(input).metadata;
}
function bodyText(body) {
  requireThat(typeof body === 'string' && Buffer.byteLength(body) <= PR_BODY_MAX_BYTES &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(body),
  'COVERAGE', 'Invalid or oversized PR description');
}
function sectionRange(body) {
  bodyText(body);
  const starts = [...body.matchAll(/<!--\s*sdlc-coverage:([^>]*?)-->/gu)];
  const ends = [...body.matchAll(/<!--\s*\/sdlc-coverage\s*-->/gu)];
  if (starts.length === 0 && ends.length === 0) return null;
  requireThat(starts.length === 1 && ends.length === 1,
    'COVERAGE', 'PR description needs exactly one complete coverage section');
  requireThat(starts[0][1].trim() === 'v1' && starts[0].index < ends[0].index,
    'COVERAGE', 'Unsupported or malformed coverage section');
  return { start: starts[0].index, contentStart: starts[0].index + starts[0][0].length,
    contentEnd: ends[0].index, end: ends[0].index + ends[0][0].length };
}
export function renderCoverageSection(metadata) {
  const normalized = validateCoverageMetadata(metadata);
  const encoded = JSON.stringify(normalized, null, 2)
    .replaceAll('`', '\\u0060').replaceAll('<', '\\u003c');
  const section = `${COVERAGE_START}\n\`\`\`json\n${encoded}\n\`\`\`\n${COVERAGE_END}`;
  requireThat(Buffer.byteLength(section) <= COVERAGE_MAX_BYTES,
    'CAPACITY', 'Coverage section exceeds 32 KiB; mappings cannot be truncated or moved to a sidecar');
  return section;
}
export function readCoverageSection(body) {
  const range = sectionRange(body);
  requireThat(range, 'COVERAGE', 'PR description has no coverage section');
  const contents = body.slice(range.contentStart, range.contentEnd).trim();
  const fenced = /^```json\r?\n([\s\S]*?)\r?\n```$/u.exec(contents);
  requireThat(fenced && Buffer.byteLength(contents) <= COVERAGE_MAX_BYTES,
    'COVERAGE', 'Coverage section must contain one bounded JSON block');
  return validateCoverageMetadata(parseCoverageJson(fenced[1], 'coverage section'));
}
export function replaceCoverageSection(body, metadata) {
  const range = sectionRange(body);
  const section = renderCoverageSection(metadata);
  const result = range ?
    body.slice(0, range.start) + section + body.slice(range.end) :
    `${body}${body.trim() ? '\n\n' : ''}## Requirements Coverage\n\n${section}\n`;
  bodyText(result);
  return result;
}
export function inspectCoverage(input) {
  record(input, ['repositoryId', 'sourceRevision', 'requirements', 'testPlans', 'body']);
  const { body, ...specification } = input;
  const { metadata: expected, unresolved } = coverageProjection(specification);
  const diagnostics = [];
  let metadata = null;
  try { metadata = readCoverageSection(body); }
  catch (error) {
    if (!(error instanceof SdlcError)) throw error;
    diagnostics.push({ code: error.code, message: error.message });
  }
  if (metadata) {
    if (metadata.repositoryId !== expected.repositoryId ||
        metadata.sourceRevision !== expected.sourceRevision) {
      diagnostics.push({ code: 'STALE_SOURCE',
        message: 'Coverage belongs to a different repository or source revision' });
    }
    if (canonical([metadata.requirements, metadata.testPlans]) !==
        canonical([expected.requirements, expected.testPlans])) {
      diagnostics.push({ code: 'STALE_SPECIFICATION',
        message: 'Coverage specification references or definition digests have changed' });
    }
    if (canonical(metadata.coverage) !== canonical(expected.coverage)) {
      diagnostics.push({ code: 'COVERAGE_MISMATCH',
        message: 'Coverage links do not match the canonical Requirements and Test Plan' });
    }
  }
  if (expected.uncovered.length) diagnostics.push({
    code: 'UNCOVERED_CRITERIA', message: 'Required acceptance conditions have no mapped tests',
    ids: expected.uncovered,
  });
  if (expected.coverage.length === 0) diagnostics.push({
    code: 'EMPTY_SCOPE', message: 'No required acceptance conditions were selected',
  });
  return {
    complete: diagnostics.length === 0, diagnostics,
    required: expected.coverage.length,
    covered: expected.coverage.length - expected.uncovered.length,
    uncovered: expected.uncovered, metadata,
    unresolved,
    warnings: unresolved.length ? [{
      code: 'PLANNED_BINDINGS', message: 'Planned selectors are not execution evidence',
      ids: unresolved,
    }] : [],
    specificationDigest: digest([expected.requirements, expected.testPlans]),
  };
}
