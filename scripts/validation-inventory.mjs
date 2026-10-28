import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { digest, requireThat } from '../src/core.mjs';

export const validationPlatforms = Object.freeze([
  'linux-x64', 'windows-x64', 'macos-arm64', 'macos-x64',
]);
function stringEnd(source, from, quote) {
  for (let index = from + 1; index < source.length; index++) {
    if (source[index] === '\\') index++;
    else if (source[index] === quote) return index + 1;
  }
  throw new Error('Unterminated JavaScript string in validation declarations');
}
function templateEnd(source, from, nesting = 0, interpolations = []) {
  requireThat(nesting < 64, 'INVENTORY', 'JavaScript template nesting exceeds 64 levels');
  let index = from + 1;
  while (index < source.length) {
    if (source[index] === '\\') index += 2;
    else if (source[index] === '`') return index + 1;
    else if (source.startsWith('${', index)) {
      const start = index;
      index = declarationTokensIn(source, index + 2, source.length, nesting + 1, true).end;
      interpolations.push({ start, end: index });
    } else index++;
  }
  throw new Error('Unterminated JavaScript template in validation declarations');
}
function decodeString(source) {
  const value = source.slice(1, -1);
  return value.replace(/\\(?:u\{([a-f0-9]+)\}|u([a-f0-9]{4})|x([a-f0-9]{2})|(\r?\n)|(.))/giu,
    (_, point, unicode, hex, continuation, escaped) => {
      if (point || unicode || hex) return String.fromCodePoint(parseInt(point ?? unicode ?? hex, 16));
      if (continuation) return '';
      return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' })[escaped] ?? escaped;
    });
}
export function declarationTokens(source) {
  return declarationTokensIn(source, 0, source.length).tokens;
}
function declarationTokensIn(source, from, to, nesting = 0, interpolation = false) {
  const tokens = [];
  let index = from;
  let depth = 1;
  let located = 0;
  let line = 1;
  let column = 1;
  while (index < to) {
    const start = index;
    const character = source[index];
    if (/\s/u.test(character)) { index++; continue; }
    if (source.startsWith('//', index)) {
      const end = source.indexOf('\n', index);
      index = end < 0 ? source.length : end;
      continue;
    }
    if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2);
      requireThat(end >= 0, 'INVENTORY', 'Unterminated JavaScript comment');
      index = end + 2;
      continue;
    }
    let kind = 'punctuation';
    let value = character;
    let interpolations;
    if (character === "'" || character === '"') {
      kind = 'string';
      interpolations = [];
      index = stringEnd(source, index, character);
      value = decodeString(source.slice(start, index));
    } else if (character === '`') {
      kind = 'template';
      interpolations = [];
      index = templateEnd(source, index, nesting, interpolations);
      value = source.slice(start, index);
    } else if (/[A-Za-z_$]/u.test(character)) {
      kind = 'identifier';
      index++;
      while (index < source.length && /[\w$]/u.test(source[index])) index++;
      value = source.slice(start, index);
    } else if (character === '/' && (!tokens.length ||
        ['(', '[', '{', ',', '=', ':', 'return', '>', '!', '&', '|', '?', ';'].includes(tokens.at(-1).value))) {
      kind = 'regex';
      let characterClass = false;
      for (index++; index < source.length; index++) {
        if (source[index] === '\\') index++;
        else if (source[index] === '[') characterClass = true;
        else if (source[index] === ']') characterClass = false;
        else if (source[index] === '/' && !characterClass) { index++; break; }
      }
      while (index < source.length && /[a-z]/iu.test(source[index])) index++;
      value = source.slice(start, index);
    } else index++;
    requireThat(index <= to, 'INVENTORY', 'JavaScript token crosses its interpolation boundary');
    if (interpolation && kind === 'punctuation') {
      if (character === '{') depth++;
      else if (character === '}' && --depth === 0) return { tokens, end: index };
    }
    const gap = source.slice(located, start);
    const newline = gap.lastIndexOf('\n');
    line += gap.split('\n').length - 1;
    column = newline < 0 ? column + gap.length : gap.length - newline;
    located = start;
    tokens.push({ kind, value, start, end: index, line,
      column, ...(interpolations ? { interpolations } : {}) });
  }
  requireThat(!interpolation, 'INVENTORY', 'Unterminated JavaScript interpolation');
  return { tokens, end: index };
}
/**
 * Locate the innermost source literal without evaluating expressions. Offsets and
 * immediate template interpolation spans are absolute and end-exclusive.
 * Malformed layouts and template nesting beyond 64 levels throw.
 */
export function sourceLiteralAt(source, position, tokens = declarationTokens(source)) {
  if (!Number.isInteger(position) || position < 0 || position >= source.length) return null;
  for (let nesting = 0; nesting <= 64; nesting++) {
    const token = tokens.find(candidate => candidate.start <= position && position < candidate.end);
    if (!token || !['string', 'template'].includes(token.kind)) return null;
    if (token.kind === 'string') return token;
    const interpolation = token.interpolations.find(span => span.start <= position && position < span.end);
    if (!interpolation) return token;
    if (position < interpolation.start + 2 || position >= interpolation.end - 1) return null;
    tokens = declarationTokensIn(source, interpolation.start + 2, interpolation.end - 1, nesting + 1).tokens;
  }
  throw new Error('JavaScript template nesting exceeds 64 levels');
}
function matching(tokens, from) {
  const close = { '(': ')', '[': ']', '{': '}' }[tokens[from]?.value];
  requireThat(close, 'INVENTORY', 'Expected a balanced validation declaration');
  const stack = [close];
  for (let index = from + 1; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.kind !== 'punctuation') continue;
    if (['(', '[', '{'].includes(token.value)) stack.push({ '(': ')', '[': ']', '{': '}' }[token.value]);
    else if (token.value === stack.at(-1)) {
      stack.pop();
      if (!stack.length) return index;
    }
  }
  throw new Error('Unbalanced JavaScript validation declaration');
}
function constantImportSpecifier(tokens, from) {
  const prefixes = [];
  let value = '';
  let expectingLiteral = true;
  for (let index = from; index < tokens.length; index++) {
    const token = tokens[index];
    if (expectingLiteral) {
      if (token.kind === 'punctuation' && token.value === '(') {
        prefixes.push(value);
        value = '';
        continue;
      }
      if (token.kind === 'string') value += token.value;
      else if (token.kind === 'template') {
        for (let offset = 1; offset < token.value.length - 1; offset++) {
          if (token.value[offset] === '\\') offset++;
          else if (token.value.startsWith('${', offset)) return null;
        }
        value += decodeString(token.value);
      } else return null;
      expectingLiteral = false;
    } else if (token.kind === 'punctuation' && token.value === '+') expectingLiteral = true;
    else if (token.kind === 'punctuation' && token.value === ')' && prefixes.length) {
      value = prefixes.pop() + value;
    } else if (token.kind === 'punctuation' && !prefixes.length &&
        [')', ','].includes(token.value)) return value;
    else return null;
  }
  return null;
}
function declarations(source, tokens, file) {
  const starts = tokens.flatMap((token, index) =>
    token.value === 'export' && tokens[index + 1]?.value === 'const' &&
      tokens[index + 2]?.value === 'validationDeclarations' ? [index + 2] :
      token.value === 'validationDeclarations' && tokens[index - 1]?.value === '.' &&
        tokens[index - 2]?.value === 'exports' ? [index] : []);
  requireThat(starts.length <= 1, 'INVENTORY', 'Duplicate validation declarations');
  if (!starts.length) return { schemaVersion: 1, variants: [], surfaces: [], applicability: [], projects: [] };
  const start = starts[0] + 2;
  requireThat(tokens[starts[0] + 1]?.value === '=' && tokens[start]?.value === '{',
    'INVENTORY', 'Validation declarations must be literal JSON, not executable expressions');
  const end = matching(tokens, start);
  let value;
  try { value = JSON.parse(source.slice(tokens[start].start, tokens[end].end)); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error(`Validation declarations must use strict JSON fields and values (${file})`);
  }
  requireThat(value.schemaVersion === 1 && Object.keys(value).every(key =>
    ['schemaVersion', 'variants', 'surfaces', 'applicability', 'deferred', 'assertionNamespace',
      'plannedCases', 'projects', 'resources', 'groups'].includes(key)) &&
    ['variants', 'surfaces', 'applicability', 'plannedCases', 'projects', 'groups'].every(key =>
      value[key] === undefined || Array.isArray(value[key])),
  'INVENTORY', 'Unsupported validation declaration fields');
  return { variants: [], surfaces: [], applicability: [], plannedCases: [], projects: [], groups: [], ...value };
}
function testBindings(tokens) {
  const functions = new Set(['test']);
  const namespaces = new Set();
  const modifiers = new Map();
  const drivers = new Set();
  const unsupported = [];
  const registrations = new Set(['default', 'test', 'it', 'describe', 'suite', 'skip', 'todo', 'only']);
  const ordinary = new Set(['before', 'after', 'beforeEach', 'afterEach', 'mock', 'snapshot', 'assert']);
  const named = (from, to, separator) => {
    for (let index = from; index < to;) {
      if (tokens[index].value === ',') { index++; continue; }
      const imported = tokens[index++];
      const alias = tokens[index]?.value === separator ? tokens[++index] : imported;
      if (alias !== imported) index++;
      if (imported.kind !== 'identifier' || alias?.kind !== 'identifier') {
        unsupported.push({ line: imported.line, code: 'UNSUPPORTED_TEST_IMPORT_BINDING' });
        break;
      }
      if (registrations.has(imported.value)) {
        functions.add(alias.value);
        namespaces.add(alias.value);
        if (['skip', 'todo', 'only'].includes(imported.value)) modifiers.set(alias.value, imported.value);
      } else if (imported.value === 'run') drivers.add(alias.value);
      else if (!ordinary.has(imported.value)) unsupported.push({
        line: imported.line, code: 'UNSUPPORTED_TEST_IMPORT_BINDING',
      });
      if (tokens[index]?.value !== ',' && index < to) {
        unsupported.push({ line: imported.line, code: 'UNSUPPORTED_TEST_IMPORT_BINDING' });
        break;
      }
    }
  };
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index].value === 'import') {
      if (tokens[index + 1]?.value === '(') {
        const specifier = constantImportSpecifier(tokens, index + 2);
        // Keep prior literal-led unsupported expressions fail-closed without evaluating them.
        if (specifier === 'node:test' || specifier === null &&
            tokens[index + 2]?.kind === 'string' && tokens[index + 2]?.value === 'node:test') unsupported.push({
          line: tokens[index].line, code: 'UNSUPPORTED_DYNAMIC_TEST_IMPORT_BINDING',
        });
        continue;
      }
      let end = index + 1;
      for (; end < tokens.length && tokens[end].value !== ';' &&
        !(tokens[end].value === 'from' && tokens[end + 1]?.kind === 'string'); end++);
      if (tokens[end]?.value !== 'from' || tokens[end + 1]?.value !== 'node:test') continue;
      let start = index + 1;
      if (tokens[start]?.kind === 'identifier') {
        functions.add(tokens[start].value);
        namespaces.add(tokens[start++].value);
        if (tokens[start]?.value === ',') start++;
      }
      if (tokens[start]?.value === '{') named(start + 1, matching(tokens, start), 'as');
      else if (tokens[start]?.value === '*' && tokens[start + 1]?.value === 'as' &&
        tokens[start + 2]?.kind === 'identifier') namespaces.add(tokens[start + 2].value);
      else if (start !== end) unsupported.push({
        line: tokens[start]?.line ?? tokens[index].line, code: 'UNSUPPORTED_TEST_IMPORT_BINDING',
      });
    }
    if (tokens[index].value !== 'require' || tokens[index + 1]?.value !== '(' ||
        tokens[index + 2]?.value !== 'node:test' || tokens[index + 3]?.value !== ')') continue;
    if (tokens[index - 1]?.value !== '=') {
      unsupported.push({ line: tokens[index].line, code: 'UNSUPPORTED_TEST_IMPORT_BINDING' });
      continue;
    }
    if (tokens[index - 2]?.kind === 'identifier') {
      functions.add(tokens[index - 2].value);
      namespaces.add(tokens[index - 2].value);
    } else if (tokens[index - 2]?.value === '}') {
      let start = index - 3;
      while (start >= 0 && !(tokens[start].value === '{' && matching(tokens, start) === index - 2)) start--;
      if (start >= 0) named(start + 1, index - 2, ':');
      else unsupported.push({ line: tokens[index].line, code: 'UNSUPPORTED_TEST_IMPORT_BINDING' });
    } else unsupported.push({ line: tokens[index].line, code: 'UNSUPPORTED_TEST_IMPORT_BINDING' });
  }
  for (let index = 0; index < tokens.length; index++) {
    if (['const', 'let', 'var'].includes(tokens[index].value) && tokens[index + 1]?.value === '{') {
      const end = matching(tokens, index + 1);
      if (tokens[end + 1]?.value === '=' && namespaces.has(tokens[end + 2]?.value)) {
        named(index + 2, end, ':');
      }
    }
    if (!['const', 'let', 'var'].includes(tokens[index].value) ||
        tokens[index + 1]?.kind !== 'identifier' || tokens[index + 2]?.value !== '=') continue;
    const value = tokens[index + 3];
    if (functions.has(value?.value) && [';', ','].includes(tokens[index + 4]?.value)) {
      functions.add(tokens[index + 1].value);
      if (namespaces.has(value.value)) namespaces.add(tokens[index + 1].value);
      if (modifiers.has(value.value)) modifiers.set(tokens[index + 1].value, modifiers.get(value.value));
    } else if (namespaces.has(value?.value) && tokens[index + 4]?.value === '.' &&
      registrations.has(tokens[index + 5]?.value) && [';', ','].includes(tokens[index + 6]?.value)) {
      functions.add(tokens[index + 1].value);
      if (['skip', 'todo', 'only'].includes(tokens[index + 5].value)) {
        modifiers.set(tokens[index + 1].value, tokens[index + 5].value);
      }
    } else if ((functions.has(value?.value) || namespaces.has(value?.value)) &&
        tokens[index + 4]?.value !== '(') unsupported.push({
      line: value.line, code: 'UNSUPPORTED_TEST_REGISTRATION_ALIAS',
    });
  }
  for (let index = 0; index < tokens.length; index++) if (namespaces.has(tokens[index].value) &&
      tokens[index + 1]?.value === '[') unsupported.push({
    line: tokens[index].line, code: 'UNSUPPORTED_TEST_REGISTRATION_ALIAS',
  });
  for (let index = 0; index < tokens.length; index++) if (namespaces.has(tokens[index].value) &&
    tokens[index + 1]?.value === '.' && tokens[index + 2]?.kind === 'identifier' &&
    !registrations.has(tokens[index + 2].value) && !ordinary.has(tokens[index + 2].value) &&
    tokens[index + 2].value !== 'run' && tokens[index + 3]?.value === '(') unsupported.push({
    line: tokens[index].line, code: 'UNSUPPORTED_TEST_REGISTRATION_ALIAS',
  });
  for (let index = 0; index < tokens.length; index++) {
    if (drivers.has(tokens[index].value) && tokens[index + 1]?.value === '(' ||
      tokens[index].value === 'run' && tokens[index - 1]?.value === '.' &&
        namespaces.has(tokens[index - 2]?.value) && tokens[index + 1]?.value === '(') {
      unsupported.push({ line: tokens[index].line, code: 'UNSUPPORTED_TEST_REGISTRATION_DRIVER' });
    }
  }
  return { functions, namespaces, modifiers, unsupported };
}
function variantNames(variant) {
  requireThat(Object.keys(variant).every(key =>
    ['expression', 'occurrence', 'names', 'domains', 'parentNames'].includes(key)) &&
    (variant.names !== undefined) !== (variant.domains !== undefined),
  'INVENTORY', 'Finite variants require literal names or explicit display domains');
  if (variant.names) return variant.names;
  requireThat(variant.expression.startsWith('`') && variant.expression.endsWith('`') &&
    variant.domains && Object.getPrototypeOf(variant.domains) === Object.prototype,
  'INVENTORY', 'Display domains belong to one literal test-name template');
  const template = variant.expression.slice(1, -1);
  const fields = [...template.matchAll(/\$\{([^}]+)\}/gu)];
  requireThat(fields.length > 0 && Object.keys(variant.domains).length ===
    new Set(fields.map(field => field[1])).size && fields.every(field =>
      Array.isArray(variant.domains[field[1]]) && variant.domains[field[1]].length > 0 &&
      variant.domains[field[1]].every(value => typeof value === 'string')),
  'INVENTORY', 'Every interpolation needs its complete finite display domain');
  let bindings = [{}];
  for (const name of new Set(fields.map(field => field[1]))) {
    requireThat(bindings.length * variant.domains[name].length <= 10000,
      'CAPACITY', 'Finite variant expansion exceeds the case budget');
    bindings = bindings.flatMap(binding => variant.domains[name].map(value => ({ ...binding, [name]: value })));
  }
  return bindings.map(binding => {
    let name = '';
    let position = 0;
    for (const field of fields) {
      name += decodeString(`\`${template.slice(position, field.index)}\``) + binding[field[1]];
      position = field.index + field[0].length;
    }
    return name + decodeString(`\`${template.slice(position)}\``);
  });
}
function iterationRanges(tokens, sourceLength) {
  const ranges = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const loop = token.kind === 'identifier' && token.value === 'for' &&
      tokens[index + 1]?.value === '(';
    const mapped = token.kind === 'identifier' && ['map', 'forEach'].includes(token.value) &&
      tokens[index - 1]?.value === '.' && tokens[index + 1]?.value === '(';
    if (!loop && !mapped) continue;
    const close = matching(tokens, index + 1);
    let end = close;
    if (loop) {
      end++;
      if (tokens[end]?.value === '{') end = matching(tokens, end);
      else for (; end < tokens.length && tokens[end].value !== ';'; end++) {
        if (tokens[end].kind === 'punctuation' &&
            ['(', '[', '{'].includes(tokens[end].value)) end = matching(tokens, end);
      }
    }
    ranges.push({ start: token.start, end: tokens[end]?.end ?? sourceLength });
  }
  return ranges;
}
function validateApplicability(policy) {
  requireThat(policy && Object.getPrototypeOf(policy) === Object.prototype &&
    Object.keys(policy).every(key =>
      ['options', 'names', 'excludeNames', 'platforms', 'owner', 'reason', 'prerequisites'].includes(key)) &&
    (typeof policy.options === 'string' && policy.options.trim() || Array.isArray(policy.names)) &&
    (policy.names === undefined || Array.isArray(policy.names) && policy.names.length > 0 &&
      new Set(policy.names).size === policy.names.length &&
      policy.names.every(name => typeof name === 'string' && name.trim())) &&
    (policy.excludeNames === undefined || Array.isArray(policy.excludeNames) &&
      policy.excludeNames.every(name => typeof name === 'string' && name.trim())) &&
    Array.isArray(policy.platforms) && policy.platforms.length > 0 &&
    new Set(policy.platforms).size === policy.platforms.length &&
    policy.platforms.every(platform => validationPlatforms.includes(platform)) &&
    typeof policy.owner === 'string' && policy.owner.trim() &&
    typeof policy.reason === 'string' && policy.reason.trim() &&
    Array.isArray(policy.prerequisites) && new Set(policy.prerequisites).size === policy.prerequisites.length &&
    policy.prerequisites.every(item => typeof item === 'string' && item.trim()),
  'INVENTORY', 'Skip dispositions need explicit native assignments, owner, reason and prerequisites');
}
export function discoverDeclarations(source, file) {
  requireThat(Buffer.byteLength(source) <= 4 * 1024 * 1024,
    'CAPACITY', 'Validation source exceeds its bounded declaration size');
  const tokens = declarationTokens(source);
  const iterations = iterationRanges(tokens, source.length);
  const declared = declarations(source, tokens, file);
  declared.applicability.forEach(validateApplicability);
  if (declared.resources !== undefined) requireThat(
    declared.resources && Object.getPrototypeOf(declared.resources) === Object.prototype &&
    Object.keys(declared.resources).every(key => ['workers', 'names', 'owner', 'reason'].includes(key)) &&
    Number.isInteger(declared.resources.workers) && declared.resources.workers > 0 &&
    declared.resources.workers <= 32 && typeof declared.resources.owner === 'string' &&
    declared.resources.owner.trim() && typeof declared.resources.reason === 'string' &&
    declared.resources.reason.trim() && (declared.resources.names === undefined ||
      Array.isArray(declared.resources.names) && declared.resources.names.length > 0 &&
      new Set(declared.resources.names).size === declared.resources.names.length &&
      declared.resources.names.every(name => typeof name === 'string' && name.trim())),
  'INVENTORY', 'File resource reservations require an explicit bounded worker class and owner');
  const calls = [];
  const bindings = testBindings(tokens);
  const unresolved = bindings.unsupported.map(item => ({ file, ...item }));
  const usedVariants = new Set();
  const occurrences = new Map();
  const callOpenings = new Set();
  const contexts = new Set(['t', 'context']);
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index].value === '=' && tokens[index + 1]?.value === '>' &&
        tokens[index - 1]?.kind === 'identifier') contexts.add(tokens[index - 1].value);
    if (tokens[index].value === '=' && tokens[index + 1]?.value === '>' &&
        tokens[index - 1]?.value === ')' && tokens[index - 2]?.kind === 'identifier' &&
        tokens[index - 3]?.value === '(') contexts.add(tokens[index - 2].value);
  }
  for (let index = 0; index < tokens.length; index++) {
    const context = tokens[index - 1]?.value === '.' &&
      contexts.has(tokens[index - 2]?.value) && tokens[index].value === 'test';
    const namespace = tokens[index - 1]?.value === '.' &&
      bindings.namespaces.has(tokens[index - 2]?.value) &&
      ['test', 'it', 'describe', 'suite', 'skip', 'todo', 'only'].includes(tokens[index].value);
    if ((!bindings.functions.has(tokens[index].value) && !context && !namespace) ||
        tokens[index].kind !== 'identifier') continue;
    if (context && declared.deferred?.dispatch === tokens[index - 2].value) continue;
    if (tokens[index - 1]?.value === '.' && !context && !namespace) continue;
    let open = index + 1;
    let modifier = bindings.modifiers.get(tokens[index].value) ??
      (namespace && ['skip', 'todo', 'only'].includes(tokens[index].value) ? tokens[index].value : undefined);
    if (tokens[open]?.value === '.' && ['skip', 'todo', 'only'].includes(tokens[open + 1]?.value)) {
      modifier = tokens[open + 1].value;
      open += 2;
    }
    if (tokens[open]?.value !== '(') continue;
    if (callOpenings.has(open)) continue;
    callOpenings.add(open);
    const end = matching(tokens, open);
    let comma = open + 1;
    for (; comma < end; comma++) {
      if (tokens[comma].value === ',') break;
      if (['(', '[', '{'].includes(tokens[comma].value)) comma = matching(tokens, comma);
    }
    const first = tokens[open + 1];
    const expression = source.slice(first.start, tokens[comma - 1]?.end ?? first.end).trim();
    const literal = comma === open + 2 && first.kind === 'string' ? first.value :
      comma === open + 2 && first.kind === 'template' && !first.value.includes('${') ?
        decodeString(first.value) : null;
    const occurrence = (occurrences.get(expression) ?? 0) + 1;
    occurrences.set(expression, occurrence);
    const variant = declared.variants.find(item => item.expression === expression &&
      (item.occurrence ?? 1) === occurrence);
    const names = variant ? variantNames(variant) : null;
    if (variant) {
      requireThat(declared.variants.filter(item => item.expression === expression &&
          (item.occurrence ?? 1) === occurrence).length === 1 &&
        Array.isArray(names) && names.length > 0 && names.length <= 10000 &&
        names.every(name => typeof name === 'string' && name.trim() && name.length <= 4096) &&
        new Set(names).size === names.length,
      'INVENTORY', 'Finite test variants need unique nonempty declared names');
      usedVariants.add(variant);
    }
    if (literal === null && !variant) unresolved.push({
      file, line: tokens[index].line, expression, code: 'UNDECLARED_VARIANTS',
      occurrence,
    });
    let options = null;
    const next = comma + 1;
    if (tokens[next]?.value === '{') {
      const through = matching(tokens, next);
      if (tokens[through + 1]?.value === ',') options = source.slice(tokens[next].start, tokens[through].end);
    } else if (tokens[next]?.kind === 'identifier' && tokens[next + 1]?.value === ',') {
      options = tokens[next].value;
    }
    calls.push({
      file, line: tokens[index].line, column: tokens[index].column,
      expression, names: literal === null ? names ?? [] : [literal],
      start: tokens[index].start, end: tokens[end].end, context, variant,
      deferred: !context && declared.deferred?.declaration === tokens[index].value,
      options, modifier,
    });
  }
  for (const variant of declared.variants) if (!usedVariants.has(variant)) unresolved.push({
    file, expression: variant.expression, code: 'STALE_VARIANTS',
  });
  for (const call of calls) if (!call.variant && iterations.some(iteration =>
    iteration.start < call.start && iteration.end >= call.end &&
      !calls.some(parent => parent !== call && parent.start < call.start && parent.end > call.end &&
        parent.start > iteration.start && parent.end <= iteration.end))) {
    unresolved.push({ file, line: call.line, expression: call.expression,
      code: 'UNDECLARED_REPEATED_REGISTRATION' });
  }
  const sourceDigest = digest(source);
  const namespace = declared.assertionNamespace ?? file;
  requireThat(typeof namespace === 'string' && namespace.startsWith('test/') &&
    /\.test\.(?:mjs|cjs|js)$/u.test(namespace) && namespace.split('/').every(part =>
      part && part !== '.' && part !== '..') && !namespace.includes('\\'),
  'INVENTORY', 'Stable assertion namespaces must identify a repository test family');
  const signature = value => declarationTokens(value).map(token => [token.kind, token.value]);
  const usedApplicability = new Set();
  const policyFor = call => {
    const policies = declared.applicability.filter(policy =>
      (policy.options === undefined || call.options !== null &&
        digest(signature(policy.options)) === digest(signature(call.options))) &&
      (policy.names === undefined || call.names.length > 0 &&
        call.names.every(name => policy.names.includes(name))) &&
      (policy.excludeNames === undefined || !call.names.some(name => policy.excludeNames.includes(name))));
    requireThat(policies.length <= 1, 'INVENTORY', 'Test applicability must have one unambiguous owner');
    const policy = policies[0];
    const dynamicSkip = tokens.some((token, index) => token.kind === 'identifier' &&
      token.value === 'skip' && tokens[index - 1]?.value === '.' &&
      contexts.has(tokens[index - 2]?.value) && token.start > call.start && token.end < call.end &&
      !calls.some(child => child.start > call.start && child.end < call.end &&
        token.start > child.start && token.end < child.end));
    const optional = ['skip', 'todo'].includes(call.modifier) ||
      call.options !== null && (declarationTokens(call.options).some(token =>
      token.value === 'skip' || token.value === 'nativeMac') ||
      declarationTokens(call.options).length === 1);
    if ((optional || dynamicSkip) && !policy) unresolved.push({
      file, line: call.line, options: call.options, name: call.names[0] ?? call.expression,
      code: 'UNOWNED_SKIP_DISPOSITION',
    });
    if (!policy) return { platforms: [...validationPlatforms], owner: null,
      reason: null, prerequisites: [] };
    usedApplicability.add(policy);
    return { platforms: policy.platforms, owner: policy.owner,
      reason: policy.reason, prerequisites: policy.prerequisites };
  };
  const ancestry = call => {
    if (call.deferred) {
      requireThat(typeof declared.deferred.parent === 'string' &&
        calls.some(parent => !parent.deferred && parent.names.includes(declared.deferred.parent)),
      'INVENTORY', 'Deferred registrations need their declared actual parent test');
      return [[declared.deferred.parent]];
    }
    const parent = calls.filter(parent => parent.start < call.start && parent.end > call.end)
      .sort((left, right) => right.start - left.start)[0];
    if (!parent) return [[]];
    const paths = ancestry(parent);
    requireThat(paths.length * parent.names.length <= 10000,
      'CAPACITY', 'Nested test variants exceed the bounded assertion inventory');
    return paths.flatMap(path => parent.names.map(name => [...path, name]));
  };
  for (const call of calls.filter(call => call.variant?.parentNames)) {
    const selected = call.variant.parentNames;
    const parents = ancestry(call).map(path => path.at(-1));
    requireThat(selected && Object.getPrototypeOf(selected) === Object.prototype &&
      Object.keys(selected).length === call.names.length &&
      call.names.every(name => Array.isArray(selected[name]) && selected[name].length > 0 &&
        selected[name].every(parent => parents.includes(parent))),
    'INVENTORY', 'Nested variants need explicit existing parent-name assignments');
  }
  const cases = calls.flatMap(call => {
    const applicability = policyFor(call);
    return call.names.flatMap(name =>
    ancestry(call).filter(parents => !call.variant?.parentNames ||
      call.variant.parentNames[name]?.includes(parents.at(-1))).map(parents => ({
      id: `assertion-${digest([namespace, parents, name])}`,
      file, name, parents, line: call.line, column: call.column,
      sourceDigest, context: call.context || call.deferred, options: call.options,
      definitionDigest: digest(source.slice(call.start, call.end).replace(/\r\n/gu, '\n')),
      applicability,
    })));
  });
  for (const policy of declared.applicability) if (!usedApplicability.has(policy)) unresolved.push({
    file, code: 'STALE_SKIP_DISPOSITION',
  });
  for (const name of declared.resources?.names ?? []) if (!cases.some(test => test.name === name)) unresolved.push({
    file, name, code: 'STALE_RESOURCE_RESERVATION',
  });
  requireThat(new Set(cases.map(test => test.id)).size === cases.length,
    'INVENTORY', 'Duplicate executable validation identity');
  requireThat(new Set(cases.map(test => digest([test.file, test.parents, test.name]))).size === cases.length,
    'INVENTORY', 'Public selectors must distinguish every required executable assertion');
  const plannedIds = new Set();
  const foreignBindings = [];
  for (const binding of declared.plannedCases ?? []) {
    requireThat(binding && Object.getPrototypeOf(binding) === Object.prototype &&
      Object.keys(binding).every(key => ['id', 'selectors'].includes(key)) &&
      typeof binding.id === 'string' && /^T-[A-Z0-9]+(?:-[A-Z0-9]+)*$/u.test(binding.id) &&
      !plannedIds.has(binding.id) && Array.isArray(binding.selectors) &&
      binding.selectors.length > 0 && binding.selectors.length <= 10000,
    'INVENTORY', `Planned cases require unique IDs and nonempty exact assertion selectors (${file})`);
    plannedIds.add(binding.id);
    const selectors = new Set();
    for (const selector of binding.selectors) {
      requireThat(selector && Object.getPrototypeOf(selector) === Object.prototype &&
        Object.keys(selector).every(key => ['file', 'name', 'parents'].includes(key)) &&
        (selector.file === undefined || isValidationTestPath(selector.file)) &&
        typeof selector.name === 'string' && selector.name.trim() && selector.name.length <= 4096 &&
        (selector.parents === undefined || Array.isArray(selector.parents) &&
          selector.parents.every(name => typeof name === 'string' && name.trim() && name.length <= 4096)),
      'INVENTORY', 'Planned case selectors require literal names and optional exact parent paths');
      if (selector.file !== undefined && selector.file !== file) {
        const key = digest([selector.file, selector.parents ?? null, selector.name]);
        requireThat(!selectors.has(key), 'INVENTORY', 'Duplicate planned case assertion selector');
        selectors.add(key);
        foreignBindings.push({ declaredBy: file, testId: binding.id, selector });
        unresolved.push({ file, testId: binding.id, selector, code: 'FOREIGN_BINDING_REQUIRES_CATALOG' });
        continue;
      }
      const candidates = cases.filter(test => test.name === selector.name &&
        (selector.parents === undefined || digest(test.parents) === digest(selector.parents)));
      requireThat(candidates.length <= 1, 'INVENTORY',
        'Ambiguous planned case selector; declare the exact parent path');
      const key = digest([file, selector.parents ?? candidates[0]?.parents ?? null, selector.name]);
      requireThat(!selectors.has(key), 'INVENTORY', 'Duplicate planned case assertion selector');
      selectors.add(key);
      if (!candidates.length) unresolved.push({
        file, testId: binding.id, selector, code: 'STALE_PLANNED_CASE_SELECTOR',
      });
      else {
        const test = candidates[0];
        test.plannedCases ??= [];
        test.plannedCases.push(binding.id);
      }
    }
  }
  const groupRoots = new Set();
  for (const name of declared.resources?.names ?? []) requireThat(cases.some(test =>
    test.name === name || test.parents.includes(name)),
  'INVENTORY', 'File resource reservation references an unknown assertion name');
  for (const group of declared.groups ?? []) {
    requireThat(group && Object.getPrototypeOf(group) === Object.prototype &&
      Object.keys(group).every(key =>
        ['root', 'dependsOn', 'minimumSlots', 'exclusiveResources'].includes(key)) &&
      typeof group.root === 'string' && group.root.trim() && !groupRoots.has(group.root) &&
      cases.filter(test => !test.parents.length && test.name === group.root).length === 1 &&
      (group.minimumSlots === undefined || Number.isInteger(group.minimumSlots) &&
        group.minimumSlots > 0 && group.minimumSlots <= 32) &&
      ['dependsOn', 'exclusiveResources'].every(key => group[key] === undefined ||
        Array.isArray(group[key]) && new Set(group[key]).size === group[key].length &&
        group[key].every(value => typeof value === 'string' && value.trim() && value.length <= 4096)),
    'INVENTORY', 'Execution groups require unique declared roots, bounded minimum slots and unique dependency/resource names');
    groupRoots.add(group.root);
  }
  return { file, sourceDigest: digest(source), cases, unresolved, declared, foreignBindings };
}
async function executableSurfaces(root, directory) {
  const files = [];
  for (const entry of await readdir(path.join(root, ...directory.split('/')), { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`;
    requireThat(!entry.isSymbolicLink(), 'INVENTORY', 'Executable inventory cannot traverse symbolic links');
    if (entry.isDirectory()) files.push(...await executableSurfaces(root, file));
    else if (isExecutableSurface(file)) files.push(file);
  }
  return files;
}
function isExecutableSurface(file) {
  return /^(?:bin|src|scripts|packaging|cmd)\//u.test(file) &&
    (/\.(?:mjs|cjs|js|py|go|sh|ps1|rb|cmd)$/u.test(file) || file === 'packaging/standalone/sdlc');
}
function repositoryPath(file) {
  return typeof file === 'string' && !file.includes('\\') && !file.includes(':') &&
    !/[\u0000-\u001f\u007f]/u.test(file) &&
    !path.posix.isAbsolute(file) && file.split('/').every(part => part && part !== '.' && part !== '..');
}
export async function compileValidationInventory(root) {
  const paths = [];
  async function walk(directory) {
    for (const entry of await readdir(path.join(root, ...directory.split('/')), { withFileTypes: true })) {
      const file = `${directory}/${entry.name}`;
      if (generatedTestPath(file)) continue;
      requireThat(!entry.isSymbolicLink(), 'INVENTORY', 'Test inventory cannot traverse symbolic links');
      if (entry.isDirectory()) await walk(file);
      else if (isValidationTestPath(file) || independentManifest(file)) {
        requireThat(entry.isFile(), 'INVENTORY', 'Required test sources must be regular files');
        paths.push(file);
      }
    }
  }
  await walk('test');
  const files = validationSourcePaths(paths);
  const sources = await Promise.all(files.map(async file => ({
    file, contents: await readFile(path.join(root, ...file.split('/')), 'utf8'),
  })));
  const actualSurfaces = [];
  for (const directory of ['bin', 'src', 'scripts', 'packaging', 'cmd']) {
    let present = true;
    try { await stat(path.join(root, directory)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; present = false; }
    if (present) actualSurfaces.push(...await executableSurfaces(root, directory));
  }
  return compileValidationSourceInventory({ files: sources, surfacePaths: actualSurfaces });
}
export function compileValidationSourceInventory({ files, surfacePaths }) {
  requireThat(Array.isArray(files) && files.length > 0 && files.every(source =>
    source && Object.getPrototypeOf(source) === Object.prototype &&
    Object.keys(source).every(key => ['file', 'contents'].includes(key)) &&
    (isValidationTestPath(source.file) || independentManifest(source.file)) &&
    typeof source.contents === 'string') &&
    new Set(files.map(source => source.file)).size === files.length,
  'INVENTORY', 'Source inventory requires unique literal test/project paths and source text');
  requireThat(Array.isArray(surfacePaths) && surfacePaths.every(repositoryPath) &&
    new Set(surfacePaths).size === surfacePaths.length,
  'INVENTORY', 'Source inventory requires unique repository-relative tree paths');
  const ordered = [...files].sort((left, right) => left.file.localeCompare(right.file, 'en'));
  const allDeclarations = ordered.filter(source => isValidationTestPath(source.file))
    .map(({ file, contents }) => discoverDeclarations(contents, file));
  const projectDefinitions = allDeclarations.flatMap(source =>
    source.declared.projects.map(project => ({ ...project, declaredBy: source.file })));
  requireThat(new Set(projectDefinitions.map(project => project.root)).size === projectDefinitions.length,
    'INVENTORY', 'Independent test projects require one unambiguous disposition');
  const projectRoots = new Set(projectDefinitions.map(project => project.root));
  requireThat(projectDefinitions.every(project => !projectDefinitions.some(other =>
    other !== project && typeof project.root === 'string' &&
      typeof other.root === 'string' && project.root.startsWith(`${other.root}/`))),
  'INVENTORY', 'Independent project dispositions cannot overlap');
  const projectUnresolved = [];
  const independentProjects = projectDefinitions.map(project => {
    requireThat(Object.keys(project).every(key =>
      ['root', 'files', 'coverage', 'owner', 'reason', 'command', 'prerequisites', 'declaredBy'].includes(key)) &&
      repositoryPath(project.root) && project.root.startsWith('test/') &&
      Array.isArray(project.files) && project.files.length > 0 &&
      new Set(project.files).size === project.files.length &&
      project.files.every(file => isValidationTestPath(file) && file.startsWith(`${project.root}/`)) &&
      ['fixture-only', 'untested'].includes(project.coverage) &&
      typeof project.owner === 'string' && project.owner.trim() &&
      typeof project.reason === 'string' && project.reason.trim() &&
      Array.isArray(project.command) && project.command.length > 0 &&
      project.command.every(value => typeof value === 'string' && value.trim()) &&
      Array.isArray(project.prerequisites) && project.prerequisites.every(value =>
        typeof value === 'string' && value.trim()),
    'INVENTORY', 'Independent projects need explicit files, owner, reason, command and prerequisites');
    requireThat(project.command[0] === 'node' && project.command[1] === '--test' &&
      project.command.length > 2 && project.command.slice(2).every(value =>
        !/[:\\\u0000-\u001f]/u.test(value) &&
        value.split('/').every(part => part && part !== '.' && part !== '..' && !part.startsWith('.')) &&
        /\.test\.(?:mjs|cjs|js)$/u.test(value)),
    'INVENTORY', 'Unsupported independent Node test command requires an explicit source adapter, not silent omission');
    const manifestPath = `${project.root}/package.json`;
    const metadata = ordered.find(source => source.file === manifestPath);
    let manifest;
    try { manifest = metadata ? JSON.parse(metadata.contents) : null; }
    catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      throw new Error('Independent test project metadata must be literal JSON');
    }
    if (!metadata || manifest?.scripts?.test !== project.command.join(' ')) projectUnresolved.push({
      file: manifestPath, code: 'MISSING_OR_CHANGED_PROJECT_COMMAND',
    });
    const declarations = allDeclarations.filter(source => source.file.startsWith(`${project.root}/`));
    for (const file of project.files) {
      if (!declarations.some(source => source.file === file)) projectUnresolved.push({
        file, code: 'STALE_PROJECT_TEST',
      });
    }
    for (const source of declarations) if (!project.files.includes(source.file)) projectUnresolved.push({
      file: source.file, code: 'UNASSIGNED_PROJECT_TEST',
    });
    return { ...project, status: 'NotRun', manifest: metadata ?
      { file: manifestPath, sourceDigest: digest(metadata.contents) } : null,
    cases: declarations.flatMap(source => source.cases),
    files: declarations.map(source => ({ file: source.file, sourceDigest: source.sourceDigest })) };
  });
  for (const metadata of ordered.filter(source => independentManifest(source.file))) {
    const root = metadata.file.slice(0, -'/package.json'.length);
    let declaredTestCommand = false;
    try { declaredTestCommand = typeof JSON.parse(metadata.contents)?.scripts?.test === 'string'; }
    catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      projectUnresolved.push({ file: metadata.file, code: 'INVALID_NODE_PROJECT_METADATA' });
    }
    if ((declaredTestCommand || allDeclarations.some(source => source.file.startsWith(`${root}/`))) &&
        !projectRoots.has(root)) {
      projectUnresolved.push({ file: metadata.file, code: 'UNCLASSIFIED_NODE_PROJECT' });
    }
  }
  const declarations = allDeclarations.filter(source =>
    !independentProjects.some(project => source.file.startsWith(`${project.root}/`)));
  requireThat(new Set(allDeclarations.flatMap(source => source.cases.map(test => test.id))).size ===
    allDeclarations.reduce((count, source) => count + source.cases.length, 0),
  'INVENTORY', 'Stable assertion identities cannot be duplicated across test projects');
  const cases = declarations.flatMap(file => file.cases);
  for (const binding of declarations.flatMap(source => source.foreignBindings)) {
    const matches = cases.filter(test => test.file === binding.selector.file &&
      test.name === binding.selector.name && (binding.selector.parents === undefined ||
        digest(test.parents) === digest(binding.selector.parents)));
    requireThat(matches.length <= 1, 'INVENTORY', 'Ambiguous cross-file selector needs an exact parent path');
    if (!matches.length) projectUnresolved.push({
      file: binding.declaredBy, testId: binding.testId, selector: binding.selector,
      code: 'STALE_PLANNED_CASE_SELECTOR',
    });
    else {
      requireThat(!matches[0].plannedCases?.includes(binding.testId),
        'INVENTORY', 'Duplicate cross-file planned assertion binding');
      (matches[0].plannedCases ??= []).push(binding.testId);
    }
  }
  for (const declaration of declarations) declaration.unresolved = declaration.unresolved
    .filter(item => item.code !== 'FOREIGN_BINDING_REQUIRES_CATALOG');
  requireThat(new Set(cases.map(test => test.id)).size === cases.length,
    'INVENTORY', 'Stable assertion identities cannot be duplicated across source files');
  const unresolved = [...allDeclarations.flatMap(file => file.unresolved), ...projectUnresolved];
  for (const file of allDeclarations) if (!file.cases.length) unresolved.push({
    file: file.file, code: 'EMPTY_TEST_FILE',
  });
  const nodeUnresolved = [...unresolved];
  const actualSurfaces = surfacePaths.filter(isExecutableSurface).sort();
  const surfaces = allDeclarations.flatMap(file => file.declared.surfaces.map(surface => {
    requireThat(surface && Object.keys(surface).every(key => ['paths', 'coverage'].includes(key)) &&
      Array.isArray(surface.paths) && surface.paths.length > 0 &&
      ['direct', 'process', 'fixture-only', 'untested'].includes(surface.coverage),
    'INVENTORY', 'Executable surfaces need explicit paths and coverage classification');
    return surface.paths.map(surfacePath => {
      requireThat(repositoryPath(surfacePath), 'INVENTORY',
        'Executable surface paths must be repository-relative');
      if (!actualSurfaces.includes(surfacePath)) unresolved.push({
        file: file.file, path: surfacePath, code: 'STALE_EXECUTABLE_SURFACE',
      });
      return { path: surfacePath, coverage: surface.coverage, file: file.file,
        assertionIds: file.cases.map(test => test.id) };
    });
  })).flat();
  for (const file of actualSurfaces) if (!surfaces.some(surface => surface.path === file)) {
    unresolved.push({ path: file, code: 'UNMAPPED_EXECUTABLE_SURFACE' });
  }
  return {
    schemaVersion: 1, files: declarations.map(({ file, sourceDigest }) => ({ file, sourceDigest })),
    sourceFiles: ordered.map(({ file, contents }) => ({ file, sourceDigest: digest(contents) })),
    cases, surfaces, independentProjects, unresolved, nodeUnresolved, complete: unresolved.length === 0,
    resourceRequirements: declarations.filter(source => source.declared.resources)
      .map(source => ({ file: source.file, ...source.declared.resources })),
    groupDeclarations: declarations.flatMap(source => (source.declared.groups ?? [])
      .map(group => ({ file: source.file, ...group }))),
    coverageGaps: [...surfaces.filter(surface => ['untested', 'fixture-only'].includes(surface.coverage)),
      ...independentProjects],
    digest: digest({ declarations: allDeclarations.map(({ file, sourceDigest, cases, unresolved }) =>
      ({ file, sourceDigest, cases, unresolved })), independentProjects,
    sourceFiles: ordered.map(({ file, contents }) => ({ file, sourceDigest: digest(contents) })) }),
  };
}
function generatedTestPath(file) {
  const parts = file.split('/');
  return parts[0] === 'test' && (parts[1]?.startsWith('.runner-fixture-') ||
    parts.slice(1).some(part => ['node_modules', '.git', '.test-data'].includes(part)));
}
export function isValidationTestPath(file, { generated = false } = {}) {
  return repositoryPath(file) && file.startsWith('test/') && (generated || !generatedTestPath(file)) &&
    /\.test\.(?:mjs|cjs|js)$/u.test(file);
}
function independentManifest(file) {
  return repositoryPath(file) && file.startsWith('test/') && !generatedTestPath(file) &&
    file.endsWith('/package.json');
}
export function validationSourcePaths(paths) {
  requireThat(Array.isArray(paths) && paths.every(repositoryPath) && new Set(paths).size === paths.length,
    'INVENTORY', 'Select source paths from a complete literal repository tree');
  return paths.filter(file => isValidationTestPath(file) || independentManifest(file)).sort();
}
export function compareValidationInventory(actual, expected) {
  requireThat(expected.schemaVersion === 1 && actual.schemaVersion === 1 &&
    Array.isArray(expected.cases) && Array.isArray(actual.cases),
  'INVENTORY', 'Compare complete versioned validation inventories');
  const before = new Map(expected.cases.map(test => [test.id, test]));
  const after = new Map(actual.cases.map(test => [test.id, test]));
  const added = actual.cases.filter(test => !before.has(test.id)).map(test => test.id);
  const removed = expected.cases.filter(test => !after.has(test.id)).map(test => test.id);
  const changed = actual.files.filter(file => expected.files.some(previous =>
    previous.file === file.file && previous.sourceDigest !== file.sourceDigest)).map(file => file.file);
  return { complete: actual.complete && expected.complete && !added.length && !removed.length &&
    !changed.length && actual.digest === expected.digest, added, removed, changed };
}
export function nodeStartDefinition(cases, event) {
  if (!event || typeof event.file !== 'string' || typeof event.name !== 'string' ||
      event.name === event.file || !Number.isInteger(event.nesting) || event.nesting < 0) return null;
  let candidates = cases.filter(test => test.file === event.file && test.name === event.name &&
    test.parents.length === event.nesting);
  if (Array.isArray(event.parents)) candidates = candidates.filter(test =>
    digest(test.parents) === digest(event.parents));
  if (candidates.length > 1 && Number.isInteger(event.line)) candidates = candidates.filter(test =>
    test.line === event.line);
  if (candidates.length > 1 && Number.isInteger(event.column)) candidates = candidates.filter(test =>
    test.column === event.column);
  return candidates.length === 1 ? candidates[0] : null;
}

export function cancelledNodeStarts({ cases, starts, executions, interruption, producerPid }) {
  if (!interruption || !['SIGINT', 'SIGTERM'].includes(interruption.signal) ||
      interruption.producerPid !== producerPid || !Number.isSafeInteger(producerPid) ||
      !Number.isSafeInteger(interruption.sequence) || interruption.sequence <= 0 ||
      !Number.isFinite(Date.parse(interruption.observedAt))) return [];
  const active = starts.filter(event => event.kind === 'start' &&
    Number.isSafeInteger(event.sequence) && event.sequence > 0 &&
    event.sequence < interruption.sequence &&
    Number.isFinite(Date.parse(event.observedAt)) &&
    Date.parse(event.observedAt) <= Date.parse(interruption.observedAt))
    .map(event => ({ event, definition: nodeStartDefinition(cases, event) }))
    .filter(value => value.definition);
  return active.filter(({ event, definition }) =>
    active.filter(value => value.definition.id === definition.id).length === 1 &&
    !executions.some(row => row.file === event.file && row.name === event.name &&
      ['Passed', 'Failed', 'Skipped', 'Todo', 'Cancelled'].includes(row.status) &&
      (() => {
        const completed = nodeStartDefinition(cases, {
          ...row, nesting: Array.isArray(row.parents) ? row.parents.length : row.nesting,
        });
        return !completed || completed.id === definition.id;
      })()))
    .map(({ event, definition }) => ({
      file: definition.file, name: definition.name, parents: definition.parents,
      nameDigest: digest(definition.name), parentDigests: definition.parents.map(name => digest(name)),
      nesting: definition.parents.length, line: event.line ?? definition.line,
      column: event.column ?? definition.column,
      status: 'Cancelled', durationMs: null, skipReason: null, todoReason: null,
      completionSource: 'owned-cancellation-after-observed-start',
      cancellation: { signal: interruption.signal, producerPid, startedSequence: event.sequence,
        interruptionSequence: interruption.sequence },
      diagnostic: { code: 'TEST_INTERRUPTED', failureType: 'testAborted',
        message: `Test case started before ${interruption.signal} interrupted its producer; no terminal event was emitted.` },
    }));
}

export function reconcileNodeExecution(inventory, report, {
  platform, files = inventory.files.map(item => item.file), pattern,
} = {}) {
  requireThat(report && Object.getPrototypeOf(report) === Object.prototype,
    'INVENTORY', 'Reconcile actual plain producer data, not executable input');
  requireThat(validationPlatforms.includes(platform) && Array.isArray(files) && files.length > 0 &&
    new Set(files).size === files.length && files.every(file =>
      inventory.files.some(item => item.file === file)), 'INVENTORY',
  'Select an explicit declared native platform and complete file inventory');
  const selected = pattern === undefined ? null : new RegExp(pattern);
  const declared = inventory.cases.filter(test => files.includes(test.file) &&
    (!selected || matchesNodeSelection(test, selected)));
  const expected = declared.filter(test => test.applicability.platforms.includes(platform));
  const key = test => digest([test.file, test.parents, test.name]);
  const bySelector = new Map(declared.map(test => [key(test), test]));
  const matches = new Map();
  const blockers = [...inventory.unresolved];
  const dispositions = [];
  const expectedHost = {
    'linux-x64': ['linux', 'x64'], 'windows-x64': ['win32', 'x64'],
    'macos-arm64': ['darwin', 'arm64'], 'macos-x64': ['darwin', 'x64'],
  }[platform];
  if (!expected.length) blockers.push({ code: 'EMPTY_DENOMINATOR' });
  if (report.platform !== expectedHost[0] || report.architecture !== expectedHost[1]) {
    blockers.push({ code: 'WRONG_NATIVE_HOST' });
  }
  if (report.complete !== true || !report.summary ||
      !Number.isInteger(report.exitCode) || !Array.isArray(report.executions) ||
      report.summary?.counts?.tests + (report.summary?.counts?.suites ?? 0) !== report.executions.length ||
      report.summary?.counts?.cancelled !== 0 ||
      !Array.isArray(report.files) || digest([...report.files].sort()) !== digest([...files].sort())) {
    blockers.push({ code: 'INCOMPLETE_PRODUCER' });
  }
  let sequence = 0;
  for (const row of Array.isArray(report.executions) ? report.executions : []) {
    if (!row || Object.getPrototypeOf(row) !== Object.prototype ||
        !Array.isArray(row.parents) || typeof row.file !== 'string' || typeof row.name !== 'string' ||
        !row.parents.every(name => typeof name === 'string') ||
        !Number.isSafeInteger(row.sequence) || row.sequence <= sequence ||
        typeof row.observedAt !== 'string' || !Number.isFinite(Date.parse(row.observedAt)) ||
        row.nameDigest !== digest(row.name) ||
        !Array.isArray(row.parentDigests) ||
        digest(row.parentDigests) !== digest(row.parents.map(name => digest(name))) ||
        !['Passed', 'Failed', 'Skipped', 'Todo', 'Cancelled'].includes(row.status)) {
      blockers.push({ code: 'INVALID_ASSERTION_OBSERVATION' });
      continue;
    }
    sequence = row.sequence;
    const definition = bySelector.get(key(row));
    if (!definition) {
      blockers.push({ code: 'UNMAPPED_OBSERVATION', file: row.file, name: row.name });
      continue;
    }
    const values = matches.get(definition.id) ?? [];
    values.push(row);
    matches.set(definition.id, values);
    if (!definition.applicability.platforms.includes(platform)) dispositions.push({
      assertionId: definition.id, platform, status: 'NotRun', rawStatus: row.status,
      disposition: 'not-applicable-on-this-host',
      owner: definition.applicability.owner, reason: definition.applicability.reason,
      requiredOn: definition.applicability.platforms,
    });
  }
  for (const [assertionId, rows] of matches) if (rows.length !== 1) blockers.push({
    code: 'DUPLICATE_OBSERVATION', assertionId,
  });
  const cases = expected.map(test => {
    const rows = matches.get(test.id);
    const observation = rows?.length === 1 ? rows[0] : null;
    const status = observation?.status === 'Failed' ? 'Failed' :
      observation?.status === 'Passed' ? 'Passed' : 'NotRun';
    if (!rows) blockers.push({ code: 'MISSING_REQUIRED_OBSERVATION', assertionId: test.id });
    else if (observation && status === 'NotRun') blockers.push({
      code: 'UNEXECUTED_REQUIRED_ASSERTION', assertionId: test.id, rawStatus: observation.status,
      reason: observation.skipReason ?? observation.todoReason ?? observation.diagnostic?.message ?? null,
    });
    return { assertionId: test.id, file: test.file, name: test.name, parents: test.parents,
      status, rawStatus: observation?.status ?? null,
      observation, prerequisites: test.applicability.prerequisites };
  });
  const counts = { required: cases.length,
    passed: cases.filter(test => test.status === 'Passed').length,
    failed: cases.filter(test => test.status === 'Failed').length,
    notRun: cases.filter(test => test.status === 'NotRun').length };
  const status = counts.failed > 0 ? 'Failed' :
    counts.passed === counts.required && !blockers.length &&
      report.exitCode === 0 && report.summary?.success === true ? 'Passed' : 'NotRun';
  return { status, counts, cases, dispositions, blockers, inventoryDigest: inventory.digest };
}

export function matchesNodeSelection(test, pattern) {
  const names = [...test.parents, test.name];
  return names.some(name => pattern.test(name)) ||
    names.some((_, index) => pattern.test(names.slice(0, index + 1).join(' ').trim()));
}
export function requiredFileWorkers({ cases, resources }, pattern) {
  if (!resources) return 1;
  const selected = pattern === undefined ? cases : cases.filter(test =>
    matchesNodeSelection(test, typeof pattern === 'string' ? new RegExp(pattern) : pattern));
  return !resources.names || selected.some(test => [...test.parents, test.name]
    .some(name => resources.names.includes(name))) ? resources.workers : 1;
}

export function partitionValidationInventory(inventory, count, durations = []) {
  requireThat(Number.isInteger(count) && count > 0 && count <= 32 && inventory.complete,
    'INVENTORY', 'Partition a complete declared inventory over 1..32 bounded native shards');
  const timings = new Map();
  for (const item of durations) {
    requireThat(item && Number.isFinite(item.durationMs) && item.durationMs >= 0,
      'INVENTORY', 'Scheduling hints need actual finite nonnegative durations');
    const test = inventory.cases.find(test => test.id === item.assertionId);
    if (test && test.sourceDigest === item.sourceDigest) timings.set(test.id, item.durationMs);
  }
  const groups = inventory.files.map(file => ({
    file: file.file, assertions: inventory.cases.filter(test => test.file === file.file),
  })).map(group => ({ ...group, durationMs: group.assertions.reduce((sum, test) =>
    sum + (timings.get(test.id) ?? 0), 0) }));
  groups.sort((left, right) => right.durationMs - left.durationMs ||
    left.file.localeCompare(right.file, 'en'));
  const shards = Array.from({ length: count }, (_, index) => ({
    index, files: [], assertionIds: [], durationMs: 0,
  }));
  for (const group of groups) {
    const shard = [...shards].sort((left, right) => left.durationMs - right.durationMs ||
      left.files.length - right.files.length || left.index - right.index)[0];
    shard.files.push(group.file);
    shard.assertionIds.push(...group.assertions.map(test => test.id));
    shard.durationMs += group.durationMs;
  }
  requireThat(new Set(shards.flatMap(shard => shard.assertionIds)).size === inventory.cases.length &&
    shards.reduce((sum, shard) => sum + shard.assertionIds.length, 0) === inventory.cases.length,
  'INVENTORY', 'Native shards must cover the exact required assertion inventory once');
  return shards;
}
