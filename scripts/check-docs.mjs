import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDocumentationLinks, markdownLinks } from '../src/documentation-links.mjs';
import { ARCHIVE_TARGETS, EXECUTION_PLATFORMS, TARGETS } from '../packaging/standalone/protocol.mjs';
export { headingAnchors, markdownLinks } from '../src/documentation-links.mjs';

export const documentationTopics = [
  'getting-started', 'installation', 'usage', 'architecture', 'reference',
  'integrations', 'contributing', 'releases',
];
export const publicGuides = [
  'README.md', 'CONTRIBUTING.md', 'SUPPORT.md', 'SECURITY.md',
  'CODE_OF_CONDUCT.md', 'OWNERSHIP.md', 'RELEASING.md', 'CHANGELOG.md',
];
export const repositoryGuides = ['AGENTS.md', '.github/testing-policy.md'];
export const documentationMigrations = [
  ...['requirements', 'test-plan', 'technical-design'].map(role =>
    [`docs/${role}.md`, `docs/sdlc/core-framework/${role}.md`]),
  ...['github-integration', 'repository-evidence', 'test-performance']
    .flatMap(feature => ['requirements', 'test-plan', 'technical-design']
      .map(role => [`docs/${feature}/${role}.md`, `docs/sdlc/${feature}/${role}.md`])),
  ['docs/github-integration/acceptance-bindings.json',
    'docs/sdlc/github-integration/acceptance-bindings.json'],
  ['docs/cli.md', 'docs/reference/cli.md'],
  ['docs/design-overview.md', 'docs/architecture/design-overview.md'],
  ['docs/provider-adapters.md', 'docs/integrations/provider-adapters.md'],
  ['docs/github-adapters.md', 'docs/integrations/github-adapters.md'],
  ['docs/ado-acceptance-test.md', 'docs/integrations/azure-devops.md'],
  ['docs/release-ci.md', 'docs/releases/release-ci.md'],
];
const roles = ['requirements.md', 'test-plan.md', 'technical-design.md'];
const knownFeatures = ['core-framework', 'github-integration',
  'repository-evidence', 'test-performance', 'public-readiness'];
const strip = value => value.replace(/[`*]/gu, '').trim();

async function tree(root, directory, diagnostics) {
  const result = [];
  for (const entry of await fs.readdir(path.join(root, directory), { withFileTypes: true })) {
    const file = path.posix.join(directory, entry.name);
    if (entry.isSymbolicLink()) diagnostics.push(`${file}: symbolic links are unsupported`);
    else if (entry.isDirectory()) result.push(...await tree(root, file, diagnostics));
    else result.push(file);
  }
  return result;
}
async function safeTarget(root, relative) {
  let current = root;
  for (const part of relative.split('/')) {
    if (!part || part === '.') continue;
    if (!(await fs.readdir(current)).includes(part)) {
      const error = new Error('missing exact-case destination');
      error.code = 'ENOENT';
      throw error;
    }
    current = path.join(current, part);
    if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('symbolic-link destination');
  }
  return fs.stat(current);
}
function currentText(text) {
  return text.replace(/<!-- historical:start -->[\s\S]*?<!-- historical:end -->/gu, '')
    .replace(/^## Historical[^\n]*\n[\s\S]*?(?=^## |$(?![\s\S]))/gimu, '');
}

export function inspectReaderContracts(contents, pkg) {
  const diagnostics = [];
  const specification = (contents.get('docs/installation/README.md') ?? '').replace(/\r\n?/gu, '\n');
  const rows = [...specification.matchAll(/^\| ([^|]+) \| ([^|]+) \|$/gmu)]
    .map(([, name, value]) => [strip(name), strip(value)]);
  const cells = new Map(rows);
  const expected = new Map([
    ['Node minimum', pkg.engines.node],
    ['Standalone archives', ARCHIVE_TARGETS.join(', ')],
    ['macOS archive', `${pkg.name}-<version>-macos.${TARGETS.macos.extension}`],
    ['macOS architectures', TARGETS.macos.architectures.join(', ')],
    ['macOS payload', 'portable JavaScript and shell; no native binary, embedded tgz or bundled Node'],
    ['Required validation hosts', EXECUTION_PLATFORMS.join(', ')],
    ['Candidate readiness', 'Unverified'],
  ]);
  for (const [field, value] of expected) {
    if (rows.filter(([name]) => name === field).length !== 1) {
      diagnostics.push(`docs/installation/README.md: distribution contract ${field} is missing or duplicated`);
    } else if (cells.get(field) !== value) {
      diagnostics.push(`docs/installation/README.md: distribution contract ${field} differs from package/archive/native contract`);
    }
  }
  const patterns = [
    ['Mac payload', /native\s+(?:Mac(?:OS)?\s+)?(?:launcher\s+)?slices|(?:both|two)\s+native\s+(?:Mac(?:OS)?\s+)?launchers|(?:Universal\s*2|Mach-O)\s+(?:binary|executable|launcher)/giu],
    ['obsolete Mac archive', /(?:ai-sdlc-framework-[^\s/`]*|ai-sdlc-framework-<[^>]+>)-macos-(?:arm64|x64)\.tar\.gz/giu],
    ['embedded Mac archive', /Every archive (?:contains|includes)[^\n]*?\.tgz/giu],
    ['native gate', /(?:Intel(?:\s+native)?\s+lifecycle[^.\n]*non.blocking|Windows\s+is\s+cross.validated|only mandatory native target is)/giu],
    ['bundled Node', /bundl(?:es|ed|ing)\s+(?:a\s+)?Node(?:\.js)?\s+runtime/giu],
    ['current readiness', /(?:latest|current)\s+(?:source\s+)?candidate\s+(?:is|has been)\s+(?:fully\s+)?(?:validated|ready|passing)/giu],
    ['unsupported platform', /Linux\s+standalone\s+(?:is\s+)?(?:supported|available)|supports?\s+(?:a\s+)?Linux\s+standalone/giu],
  ];
  for (const [file, raw] of contents) {
    if (file.startsWith('docs/sdlc/') || file === 'docs/integrations/azure-devops.md') continue;
    const text = currentText(raw).replace(/[*`]/gu, '');
    for (const match of text.matchAll(/ai-sdlc-framework@(\d+\.\d+\.\d+)/gu)) {
      if (match[1] !== pkg.version) diagnostics.push(`${file}: stale public version pin ${match[1]}`);
    }
    for (const [field, pattern] of patterns) for (const match of text.matchAll(pattern)) {
      const before = text.slice(Math.max(0, match.index - 24), match.index).replace(/[*`]/gu, '');
      if (/\b(?:not|no|without)\s+(?:a\s+|an\s+)?(?:Universal\s*2\s*)?$/iu.test(before)) continue;
      if (field === 'bundled Node' && /\bno\s+Go\s+module\s+dependencies\s+or\s*$/iu.test(
        text.slice(Math.max(0, match.index - 96), match.index))) continue;
      diagnostics.push(`${file}: ${field} claim conflicts with distribution contract`);
    }
  }
  for (const file of ['README.md', 'SECURITY.md', 'docs/releases/README.md']) {
    if (!contents.get(file)?.includes(`**${pkg.version}**`)) {
      diagnostics.push(`${file}: current version differs from package.json`);
    }
  }
  if (!contents.get('README.md')?.includes(`Node.js **${pkg.engines.node.slice(2)} or later**`)) {
    diagnostics.push('README.md: Node minimum differs from package.json');
  }
  const repository = pkg.repository?.url?.replace(/\.git$/u, '').replace(/\/$/u, '');
  if (repository && !markdownLinks(contents.get('SECURITY.md') ?? '').links.includes(
    `${repository}/security/advisories/new`)) {
    diagnostics.push('SECURITY.md: missing repository private reporting route; live availability requires provider verification');
  }
  return [...new Set(diagnostics)].sort();
}

export function inspectRepositoryGuidanceBoundary(pkg) {
  const diagnostics = [];
  const repositoryOnly = value => /^(?:AGENTS\.md(?:\/|$)|\.github(?:\/|$))/iu.test(
    path.posix.normalize(String(value).replaceAll('\\', '/')));
  if (!Array.isArray(pkg.files) || pkg.files.some(entry =>
    typeof entry !== 'string' || entry === '.' || entry === './' ||
    entry === '' || /[*?]/u.test(entry) || repositoryOnly(entry))) {
    diagnostics.push('package.json: explicit file allowlist must exclude repository-only AGENTS.md and .github guidance');
  }
  for (const guide of ['docs', ...publicGuides.filter(file => file !== 'README.md')]) {
    if (!Array.isArray(pkg.files) || !pkg.files.includes(guide)) {
      diagnostics.push(`package.json: missing shipped documentation selection ${guide}`);
    }
  }
  const inspectExport = (value, wildcard = false) => {
    if (typeof value === 'string') {
      const target = path.posix.normalize(value.replaceAll('\\', '/'));
      const pattern = wildcard && target.includes('*') ? new RegExp(`^${target.split('*')
        .map((part, index) => `${index === 1 ? '(.*)' : index > 1 ? '(?:\\1)' : ''}${
          part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`).join('')}$`, 'iu') : null;
      if (!repositoryOnly(value) && !repositoryGuides.some(file => pattern?.test(file))) return;
      diagnostics.push('package.json: repository-only guidance must not be exported');
    } else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        inspectExport(child, key.startsWith('./') ? key.includes('*') : wildcard);
      }
    }
  };
  inspectExport(pkg.exports);
  return [...new Set(diagnostics)].sort();
}

export function inspectGovernanceDispositions(requirements, document) {
  requirements = requirements.replace(/\r\n?/gu, '\n');
  document = document.replace(/\r\n?/gu, '\n');
  const diagnostics = [];
  const ids = [...requirements.matchAll(/^-\s+(AC-054\.\d+):/gmu)].map(match => match[1]);
  const section = document.split('## FR-054 adopted and deferred');
  if (section.length !== 2) return ['FR-054: exactly one adoption section is required'];
  const allowed = new Map([
    ...[1, 2, 3, 7, 10].map(id => [`AC-054.${id}`, 'Adopted']),
    ...[4, 5, 6, 11, 12, 13, 14, 15].map(id => [`AC-054.${id}`, 'Deferred']),
    ...[8, 16, 17, 18].map(id => [`AC-054.${id}`, 'Scoped']),
    ...[9, 19].map(id => [`AC-054.${id}`, 'Reporting-only']),
  ]);
  const observed = new Map();
  for (const match of section[1].matchAll(/^\| ([^|]+) \| ([^|]+) \|$/gmu)) {
    const conditions = [...match[1].matchAll(/\bAC-054\.\d+\b/gu)].map(value => value[0]);
    if (!conditions.length) continue;
    const disposition = /^\*\*(Adopted|Deferred|Scoped|Reporting-only)\*\*:/u.exec(match[2])?.[1];
    for (const id of conditions) {
      if (!ids.includes(id)) diagnostics.push(`${id}: unknown original governance condition`);
      if (observed.has(id)) diagnostics.push(`${id}: duplicate or conflicting governance disposition`);
      observed.set(id, disposition);
      if (!disposition) diagnostics.push(`${id}: missing explicit governance disposition`);
      else if (allowed.get(id) !== disposition) diagnostics.push(`${id}: unauthorized governance scope expansion or contradiction`);
    }
  }
  for (const id of ids) if (!observed.has(id)) diagnostics.push(`${id}: missing governance classification`);
  if (ids.length !== 19 || new Set(ids).size !== ids.length) {
    diagnostics.push('FR-054: original condition definitions are incomplete or duplicated');
  }
  return [...new Set(diagnostics)].sort();
}

export function documentedRecipe(contents, name, { native = false } = {}) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const matches = [...contents.matchAll(new RegExp(
    `<!-- recipe:${escaped} -->\\s*\\x60\\x60\\x60sh\\r?\\n([\\s\\S]*?)\\r?\\n\\x60\\x60\\x60`, 'gu'))];
  if (matches.length !== 1) throw new Error(`Exactly one documented recipe ${name} is required`);
  return matches[0][1].trim().split(/\r?\n/u).map(line => {
    if (!/^node [^;&|<>]+$/u.test(line)) throw new Error(`Unsafe documented recipe command: ${line}`);
    const tokens = [...line.matchAll(/"([^"]*)"|'([^']*)'|([^\s"']+)/gu)]
      .map(match => match[1] ?? match[2] ?? match[3]);
    if (tokens.join(' ') !== line.replace(/["']/gu, '')) throw new Error('Malformed documented recipe arguments');
    if (!['scripts/check-docs.mjs', 'scripts/test-runner.mjs',
      ...(native ? ['scripts/native-validation.mjs'] : [])].includes(tokens[1])) {
      throw new Error('Undeclared documented recipe executable');
    }
    if (tokens.some(token => /(?:^|[/\\])\.\.(?:[/\\]|$)|purge|--home|https?:/u.test(token))) {
      throw new Error('Documented recipe escapes owned local validation');
    }
    return tokens.slice(1);
  });
}

export async function checkDocumentation({ root = process.cwd() } = {}) {
  root = path.resolve(root);
  const diagnostics = [];
  let docs;
  try { docs = await tree(root, 'docs', diagnostics); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { files: 0, diagnostics: ['docs: missing documentation tree'] };
  }
  const files = new Set([...docs, ...await tree(root, 'packaging', diagnostics)]);
  for (const guide of [...publicGuides, ...repositoryGuides]) {
    try {
      const stat = await safeTarget(root, guide);
      if (!stat.isFile()) diagnostics.push(`${guide}: public guide must be a regular file`);
      else files.add(guide);
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code) &&
        error.message !== 'symbolic-link destination') throw error;
      diagnostics.push(`${guide}: missing or unsafe public guide`);
    }
  }
  for (const required of ['docs/README.md', 'docs/sdlc/README.md',
    ...documentationTopics.map(topic => `docs/${topic}/README.md`),
    ...knownFeatures.flatMap(feature => roles.map(role => `docs/sdlc/${feature}/${role}`)),
    ...documentationMigrations.map(([, file]) => file)]) {
    if (!files.has(required)) diagnostics.push(`${required}: missing documentation destination`);
  }
  for (const [old] of documentationMigrations) if (files.has(old)) diagnostics.push(`${old}: stale migrated source`);
  const features = new Set();
  for (const file of docs) {
    const parts = file.split('/');
    if (roles.includes(parts.at(-1).toLowerCase())) {
      if (parts.length !== 4 || parts[1] !== 'sdlc' ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(parts[2]) || !roles.includes(parts[3])) {
        diagnostics.push(`${file}: invalid canonical layout`);
      } else features.add(parts[2]);
    }
    if (parts[1] === 'sdlc' && parts.length > 2 && parts[2] !== 'README.md' &&
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(parts[2])) diagnostics.push(`${file}: invalid feature slug`);
    if (parts[1] !== 'sdlc' && /(?:\.log|\.jsonl|\.ndjson)$|(?:^|\/)(?:execution|producer|readiness-bundle|checkpoint|session)[^/]*\.json$/iu.test(file)) {
      diagnostics.push(`${file}: operational evidence is not reader content`);
    }
  }
  for (const feature of features) for (const role of roles) {
    if (!files.has(`docs/sdlc/${feature}/${role}`)) diagnostics.push(`docs/sdlc/${feature}/${role}: incomplete canonical feature`);
  }
  const contents = new Map(await Promise.all([...files].filter(file => file.endsWith('.md'))
    .map(async file => [file, await fs.readFile(path.join(root, file), 'utf8')])));
  const graph = await checkDocumentationLinks(contents, async file => {
    try {
      const stat = await safeTarget(root, file);
      return stat.isDirectory() ? { directory: true } :
        { contents: file.endsWith('.md') ? await fs.readFile(path.join(root, file), 'utf8') : '' };
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code) && error.message !== 'symbolic-link destination') throw error;
      return null;
    }
  });
  diagnostics.push(...graph.diagnostics);
  for (const [file, targets] of graph.edges) {
    if (repositoryGuides.includes(file)) continue;
    for (const target of targets) if (repositoryGuides.includes(target)) {
      diagnostics.push(`${file}: repository-only guidance cannot be a shipped relative link; use a filename mention or explicit source URL`);
    }
    try {
      const sourceOnlyInstructions = repositoryGuides.map(file =>
        contents.get(file)?.replace(/\r\n?/gu, '\n').trim()).filter(Boolean);
      for (const file of await tree(root, 'assets', diagnostics)) {
        if (!file.endsWith('.md')) continue;
        const text = await fs.readFile(path.join(root, file), 'utf8');
        if (sourceOnlyInstructions.some(instructions =>
          text.replace(/\r\n?/gu, '\n').includes(instructions))) {
          diagnostics.push(`${file}: generic assets must not contain repository-only test instructions`);
        }
        const links = markdownLinks(text).links;
        for (const link of links) {
          const target = path.posix.normalize(path.posix.join(path.posix.dirname(file),
            link.split(/[?#]/u)[0]));
          if (repositoryGuides.includes(target)) {
            diagnostics.push(`${file}: generic assets must not depend on repository-only test guidance`);
          }
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      diagnostics.push('assets: missing generic guidance tree');
    }
  }
  const reachable = new Set();
  const visit = file => {
    if (reachable.has(file)) return;
    reachable.add(file);
    for (const target of graph.edges.get(file) ?? []) visit(target);
  };
  visit('README.md');
  for (const file of ['docs/README.md', ...publicGuides,
    ...documentationTopics.map(topic => `docs/${topic}/README.md`)]) {
    if (!reachable.has(file)) diagnostics.push(`${file}: unreachable from README`);
  }
  await safeTarget(root, 'package.json');
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  diagnostics.push(...inspectReaderContracts(contents, pkg));
  diagnostics.push(...inspectRepositoryGuidanceBoundary(pkg));
  diagnostics.push(...inspectGovernanceDispositions(
    contents.get('docs/sdlc/core-framework/requirements.md') ?? '',
    contents.get('docs/contributing/documentation.md') ?? ''));
  return { files: contents.size, diagnostics: [...new Set(diagnostics)].sort() };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkDocumentation();
  if (result.diagnostics.length) { console.error(result.diagnostics.join('\n')); process.exitCode = 1; }
  else console.log(`Checked ${result.files} documentation files, local links, anchors and canonical layout.`);
}
