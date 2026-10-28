export const validationDeclarations = {
  "schemaVersion": 1,
  "surfaces": [{"coverage": "direct", "paths": ["scripts/check-docs.mjs", "scripts/check.mjs", "src/documentation-links.mjs"]}],
  "applicability": [{
    "names": ["T-PRD088 RC66 DOC01 rendered Windows workspace preserves existing content and refuses collisions"],
    "options": "{skip:process.platform!=='win32'}",
    "platforms": ["windows-x64"],
    "owner": "maintainer",
    "reason": "The rendered PowerShell workspace prefix needs a native Windows shell; it never downloads or installs.",
    "prerequisites": ["Native Windows x64 Node", "Windows PowerShell", "Owned mock TEMP"]
  }],
  "groups": [
    {"root": "T-PRD088 RC66 DOC01 rendered Windows workspace preserves existing content and refuses collisions", "minimumSlots": 1, "exclusiveResources": []},
    {"root": "T-PRD088 RC66 DOC02 current runtime guidance matches actual validation and publishing inputs", "minimumSlots": 1, "exclusiveResources": []},
    {"root": "T-PRD088 RC66 DOC03 integration readers use the finite unit-first local gate", "minimumSlots": 1, "exclusiveResources": []},
    {"root": "T-PRD088 RC66 DOC04 canonical core definitions pass catalog and cycle definition admission", "minimumSlots": 1, "exclusiveResources": []},
    {"root": "T-PRD088 RC66 current reader identity needs only the repository maintainer handle", "minimumSlots": 1, "exclusiveResources": []},
    {"root": "T-PRD088 RC66 followup Homebrew public recipe binds both frozen release destinations", "minimumSlots": 1, "exclusiveResources": []},
    {"root": "T-PRD088 RC66 followup T52 separates automated provider work from manual user observations", "minimumSlots": 1, "exclusiveResources": []}
  ]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { parseArgs, promisify } from 'node:util';
import { checkDocumentation, documentationMigrations, documentationTopics,
  headingAnchors, markdownLinks, publicGuides, repositoryGuides } from '../scripts/check-docs.mjs';
import { npmInvocation } from '../scripts/package.mjs';
import { distribution, install, cleanInstall, doctor } from '../src/install.mjs';
import { runCli } from '../src/cli.mjs';
import { checkDocumentationLinks, checkPackagedDocumentation, rebaseDocumentationLinks } from '../src/documentation-links.mjs';
import { inspectGovernanceDispositions, inspectReaderContracts,
  inspectRepositoryGuidanceBoundary, documentedRecipe } from '../scripts/check-docs.mjs';
import { Store } from '../src/store.mjs';
import { fixture as frameworkFixture } from './helpers.mjs';
import { retainTestEvidence } from '../src/validation-evidence.mjs';
import { readValidationObject, buildTestCatalog, validateTestDefinitions } from '../src/validation-catalog.mjs';
import { normalizeTestDefinition, parseTestPlan, registerArtifact, resolveTestSpecification,
  splitMarkdownTableRow } from '../src/artifacts.mjs';
import { startCycle } from '../src/validation.mjs';
import { nativeToolchain, homebrewToolchain } from '../scripts/toolchain-baseline.mjs';
import { criticalProfileBudget } from '../scripts/test-profiles.mjs';
import { renderWindowsTesterPrompt, TESTER_TEMPLATE_SHA256 } from '../packaging/windows-tester/generate.mjs';
import { pathToFileURL } from 'node:url';
import { observerApiFixture } from './readiness-observer-fixture.mjs';
import { parseOptions } from '../scripts/test-runner.mjs';

const execute = promisify(execFile);
const source = path.resolve('.');

async function fixture(t) {
  const root = path.join(source, '.test-data', `documentation-${randomUUID()}`);
  await fs.mkdir(root, { recursive: true });
  t.after(async () => {
    assert.equal(path.dirname(root), path.join(source, '.test-data'));
    await fs.rm(root, { recursive: true });
    await assert.rejects(fs.stat(root), { code: 'ENOENT' });
  });
  await fs.cp(path.join(source, 'docs'), path.join(root, 'docs'), { recursive: true });
  await fs.cp(path.join(source, 'assets'), path.join(root, 'assets'), { recursive: true });
  await fs.cp(path.join(source, 'packaging'), path.join(root, 'packaging'), { recursive: true });
  for (const directory of ['.github', 'cmd']) {
    await fs.cp(path.join(source, directory), path.join(root, directory), { recursive: true });
  }
  for (const name of [...publicGuides, 'AGENTS.md', 'package.json', 'LICENSE']) {
    await fs.copyFile(path.join(source, name), path.join(root, name));
  }
  return root;
}
async function packageSource(root) {
  for (const directory of ['bin', 'src', 'assets']) {
    await fs.cp(path.join(source, directory), path.join(root, directory), { recursive: true });
  }
}
async function fileBytes(root, prefix = '') {
  const result = new Map();
  for (const entry of await fs.readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) for (const [key, value] of await fileBytes(root, relative)) result.set(key, value);
    else result.set(relative, await fs.readFile(path.join(root, relative)));
  }
  return result;
}
async function write(root, file, contents) {
  const target = path.join(root, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents);
}
async function diagnostics(root) {
  return (await checkDocumentation({ root })).diagnostics.join('\n');
}
function assertNoDiagnostics(result, context) {
  const summary = result.diagnostics.slice(0, 2)
    .map(value => String(value).replace(/[\r\n]/gu, ' ').slice(0, 180)).join('; ');
  assert.ok(result.diagnostics.length === 0,
    `${context}: expected no documentation diagnostics; observed ${result.diagnostics.length}; ${summary}`);
}
function assertFileBytes(actual, expected, context) {
  assert.ok(actual.size === expected.size, `${context}: file count changed`);
  for (const [relative, bytes] of expected) {
    assert.ok(actual.get(relative)?.equals(bytes) === true,
      `${context}: bytes changed for ${relative}`);
  }
}

test('T-PRD043 reader entry reaches every audience topic and local destination', async () => {
  const result = await checkDocumentation({ root: source });
  assertNoDiagnostics(result, 'Reader source graph');
  assert.ok(result.files > documentationTopics.length);
});

test('T-PRD044 malformed slugs, duplicate roles and reader specifications fail canonical layout', async t => {
  const root = await fixture(t);
  await write(root, 'docs/usage/requirements.md', '# Misplaced specification\n');
  await write(root, 'docs/sdlc/Bad_slug/requirements.md', '# Malformed feature\n');
  await write(root, 'docs/sdlc/case-feature/Requirements.md', '# Incorrect role casing\n');
  await write(root, 'docs/sdlc/core-framework/duplicate/requirements.md', '# Duplicate role\n');
  await fs.rm(path.join(root, 'docs/sdlc/test-performance/technical-design.md'));
  const errors = await diagnostics(root);
  assert.match(errors, /docs\/usage\/requirements\.md: invalid canonical layout/u);
  assert.match(errors, /Bad_slug\/requirements\.md: invalid feature slug/u);
  assert.match(errors, /case-feature\/Requirements\.md: invalid canonical layout/u);
  assert.match(errors, /core-framework\/duplicate\/requirements\.md: invalid canonical layout/u);
  assert.match(errors, /test-performance\/technical-design\.md: incomplete canonical feature/u);
});

test('T-PRD046 migrated package sources preserve installed compatibility and usable local links', async t => {
  const root = await fixture(t);
  const help = await runCli(['help']);
  assert.equal(help.exitCode, 0);
  assert.match(help.result.help, /docs\/reference\/cli\.md/u);
  assert.match(help.result.help, /<COPILOT_HOME>\/sdlc\/cli\.md/u);
  assert.doesNotMatch(help.result.help, /See docs\/cli\.md/u);
  for (const [old, current] of documentationMigrations) {
    await assert.rejects(fs.stat(path.join(source, old)), { code: 'ENOENT' });
    assert.ok((await fs.stat(path.join(source, current))).isFile(), current);
  }
  const pkg = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
  assert.ok(pkg.files.includes('docs'));
  assert.ok(!pkg.files.includes('docs/cli.md'));
  const home = path.join(root, 'owned fixture home [literal brackets]');
  await packageSource(root);
  const { files, block } = await distribution(home, root);
  assertNoDiagnostics(await checkPackagedDocumentation(files, { managedInstructions: block }),
    'Prepared installed documentation graph');
  for (const stable of ['cli.md', 'provider-adapters.md', 'github-adapters.md']) {
    const key = `sdlc/${stable}`;
    assert.ok(files.has(key), `Installed path must stay stable: ${key}`);
    const parsed = markdownLinks(files.get(key).toString('utf8'));
    assertNoDiagnostics(parsed, `Installed alias ${key}`);
    for (const href of parsed.links.filter(value =>
      !/^[a-z][a-z0-9+.-]*:|^#/iu.test(value))) {
      const target = path.posix.normalize(path.posix.join(
        path.posix.dirname(key), href.split(/[?#]/u)[0]));
      assert.ok(files.has(target), `${key}: missing installed destination ${href}`);
    }
  }
  for (const [, current] of documentationMigrations) {
    assert.ok(files.has(`sdlc/${current}`), `Missing installed source copy ${current}`);
  }
  await assert.rejects(fs.stat(home), { code: 'ENOENT' });
  const store = new Store(home);
  await install(store, { sourceRoot: root });
  await fs.writeFile(path.join(home, 'unowned.txt'), 'unrelated home sentinel');
  await fs.writeFile(path.join(home, 'unrelated-notes.md'), '[user-owned private link](missing-user-document.md)\n');
  const runtime = path.join(home, 'sdlc/runtime/doc-migration.json');
  await fs.writeFile(runtime, '{"preserve":"retained runtime"}');
  const before = await fileBytes(home);
  const mutations = [
    ['missing downstream guide', 'docs/usage/evidence.md', null, /missing or unsafe link/u],
    ['downstream fragment', 'docs/usage/evidence.md', '\n[bad](README.md#missing-graph-anchor)\n', /missing anchor/u],
    ['alias fragment', 'docs/reference/cli.md', '\n[bad](#missing-alias-anchor)\n', /missing anchor/u],
    ['reference fragment', 'docs/reference/cli.md', '\n[bad][graph]\n[graph]: ../usage/evidence.md#missing-reference-anchor\n', /missing anchor/u],
    ['installed template fragment', 'assets/templates/pr-coverage.md', '\n[bad](../docs/usage/evidence.md#missing-template-anchor)\n', /missing anchor/u],
    ['managed instruction fragment', 'assets/instructions.md', '\n[bad](sdlc/docs/usage/evidence.md#missing-managed-anchor)\n', /missing anchor/u],
    ['missing coverage template', 'assets/templates/pr-coverage.md', null, /missing sdlc\/templates\/pr-coverage\.md/u],
    ['missing coverage schema', 'assets/templates/pr-coverage.schema.json', null, /missing sdlc\/templates\/pr-coverage\.schema\.json/u],
  ];
  for (const [name, relative, appended, expected] of mutations) {
    const file = path.join(root, relative);
    const original = await fs.readFile(file);
    if (appended === null) await fs.rm(file);
    else await fs.appendFile(file, appended);
    try {
      for (const operation of [install, cleanInstall]) {
        await assert.rejects(operation(store, { sourceRoot: root }),
          error => error.code === 'INSTALL' && expected.test(error.message), name);
        assertFileBytes(await fileBytes(home), before,
          `${name} preserves every prior installed/runtime/unowned byte`);
      }
      const freshHome = path.join(root, `rejected-${name.replaceAll(' ', '-')}`);
      await assert.rejects(cleanInstall(new Store(freshHome), { sourceRoot: root }), { code: 'INSTALL' });
      await assert.rejects(fs.stat(freshHome), { code: 'ENOENT' });
    } finally { await fs.writeFile(file, original); }
  }
  assert.deepEqual((await doctor(store)).findings, []);
  assert.deepEqual((await install(store, { sourceRoot: root })).changedFiles, []);
  const rebased = rebaseDocumentationLinks(
    '# Same\n[own](#same)\n[ref][guide]\n[guide]: ../usage/evidence.md#2-declare-the-complete-required-profile\n',
    'sdlc/docs/reference/cli.md', 'sdlc/cli.md');
  assert.match(rebased, /\[own\]\(docs\/reference\/cli\.md#same\)/u);
  assert.match(rebased, /\[guide\]: docs\/usage\/evidence\.md#/u);
});

test('T-PRD047 reader topics reject raw operational evidence instead of publishing session state', async t => {
  const root = await fixture(t);
  await write(root, 'docs/usage/worker.log', 'raw fixture log\n');
  await write(root, 'docs/reference/session.json', '{"fixture":true}\n');
  await fs.appendFile(path.join(root, 'docs/usage/README.md'),
    '\n[private runtime](../../.sdlc/work-items/fixture.json)\n');
  const errors = await diagnostics(root);
  assert.match(errors, /worker\.log: operational evidence is not reader content/u);
  assert.match(errors, /session\.json: operational evidence is not reader content/u);
  assert.match(errors, /operational state is not a reader link/u);
  const records = await fs.readFile(path.join(root, 'docs/sdlc/README.md'), 'utf8');
  assert.match(records, /historical implementation[\s\S]*not current passing evidence/u);
  const f = await frameworkFixture(t);
  const report = path.join(f.root, 'retained-execution.json');
  await fs.writeFile(report, '{"testId":"T-retention","status":"Failed","attempt":"original"}\n');
  const retained = await retainTestEvidence(f.store, {
    workItemId: f.workItemId, evidenceRef: pathToFileURL(report).href,
  });
  const retainedPath = path.join(f.store.workPath(f.workItemId), 'validation',
    'objects', `${retained.ref.sha256}.json`);
  const retainedBytes = await fs.readFile(retainedPath);
  await fs.mkdir(path.join(f.repo, 'docs/sdlc/core-framework'), { recursive: true });
  await fs.writeFile(path.join(f.repo, 'docs/test-plan.md'), '# Historical Test Plan\n');
  await fs.rename(path.join(f.repo, 'docs/test-plan.md'),
    path.join(f.repo, 'docs/sdlc/core-framework/test-plan.md'));
  assert.deepEqual(await fs.readFile(retainedPath), retainedBytes);
  assert.ok(await readValidationObject(f.store, f.workItemId, retained.ref));
  assert.ok(![...await fileBytes(path.join(f.repo, 'docs'))].some(([file]) => file.includes(retained.ref.sha256)));
});

test('T-PRD048 links, references, duplicate heading slugs and explicit anchors have negative coverage', async t => {
  const headings = '# Repeated\n# Repeated\n# Repeated-1\nSetext heading\n---\n<a id="explicit"></a>\n';
  assert.deepEqual([...headingAnchors(headings)], [
    'repeated', 'repeated-1', 'repeated-1-1', 'setext-heading', 'explicit',
  ]);
  assert.deepEqual(markdownLinks(
    '[full][dest] [collapsed][] [shortcut]\n[dest]: <target.md>\n[collapsed]: #same\n[shortcut]: target.md#heading\n'
  ).links, ['target.md', '#same', 'target.md#heading']);
  assert.deepEqual(markdownLinks('`[not a link](missing.md)`\n```\n[also not](missing.md)\n```\n').links, []);
  assert.ok(markdownLinks('<a href="missing.md">bad</a>').diagnostics.length);
  assert.ok(markdownLinks('[missing reference]').diagnostics.length);
  assert.ok(markdownLinks('[bad](has spaces.md)').diagnostics.length);
  const root = await fixture(t);
  await write(root, 'docs/usage/link-fixture.md',
    `${headings}\n[valid](#repeated-1)\n[explicit](#explicit)\n[broken](missing.md)\n[fragment](README.md#absent)\n[wrong case](../installation/readme.md)\n[reference][lost]\n[lost]: ../installation/missing.md\n`);
  let errors = await diagnostics(root);
  assert.match(errors, /missing or unsafe link missing\.md/u);
  assert.match(errors, /missing anchor README\.md#absent/u);
  assert.match(errors, /missing or unsafe link \.\.\/installation\/readme\.md/u);
  assert.match(errors, /missing or unsafe link \.\.\/installation\/missing\.md/u);
  assert.doesNotMatch(errors, /missing anchor #(?:repeated-1|explicit)/u);
  await write(root, 'docs/cli.md', '# Stale authoritative source\n');
  errors = await diagnostics(root);
  assert.match(errors, /docs\/cli\.md: stale migrated source/u);
});

test('T-PRD088 professional structure rejects broken public contracts and source-only policy leaks', async t => {
  const root = await fixture(t);
  await packageSource(root);
  await write(root, 'docs/usage/session-recovery.md',
    '# Session recovery\n\nRecover the original evidence before starting another execution.\n');
  await write(root, 'docs/architecture/execution-model.md',
    '# Execution model\n\nIndependent groups use isolated processes and bounded shared resources.\n');
  assertNoDiagnostics(await checkDocumentation({ root }), 'Ordinary recovery and execution prose guides');
  const sourceOnlyMarker = `source-only-classification-${randomUUID()}`;
  for (const guide of repositoryGuides) {
    await fs.appendFile(path.join(root, guide), `\n${sourceOnlyMarker}\n`);
  }
  const manifestPath = path.join(root, 'package.json');
  const original = await fs.readFile(manifestPath, 'utf8');
  const pkg = JSON.parse(original);
  assert.deepEqual(inspectRepositoryGuidanceBoundary({
    ...pkg, exports: { './source/*': './src/*.mjs' },
  }), [], 'A confined source-code wildcard must remain exportable');
  for (const target of ['./src/*/copy*.mjs', './src/*/copy*2.mjs']) {
    assert.deepEqual(inspectRepositoryGuidanceBoundary({
      ...pkg, exports: { './source/*': target },
    }), [], `A confined repeated wildcard must remain exportable: ${target}`);
  }
  assert.match(inspectRepositoryGuidanceBoundary({
    ...pkg, exports: { './*': './*' },
  }).join('\n'), /repository-only guidance must not be exported/u);
  const invocation = npmInvocation(['pack', '--dry-run', '--json', '--ignore-scripts',
    '--cache', path.join(root, 'owned-npm-cache')]);
  const packed = async () => {
    const result = await execute(invocation.command, invocation.args, {
      cwd: root, timeout: 30000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, npm_config_update_notifier: 'false' },
    });
    return JSON.parse(result.stdout)[0].files.map(file => file.path);
  };
  const npmFiles = await packed();
  const packageGraph = async files => {
    const contents = new Map(await Promise.all(files.map(async file =>
      [file, await fs.readFile(path.join(root, file))])));
    const readers = new Map([...contents].filter(([file]) =>
      publicGuides.includes(file) || (file.startsWith('docs/') && file.endsWith('.md')))
      .map(([file, bytes]) => [file, bytes.toString('utf8')]));
    return checkDocumentationLinks(readers, async file => {
      if (contents.has(file)) return { contents: contents.get(file).toString('utf8') };
      if (files.some(name => name.startsWith(`${file}/`))) return { directory: true };
      return null;
    });
  };
  assertNoDiagnostics(await packageGraph(npmFiles), 'Actual npm reader graph');
  for (const guide of [...publicGuides, 'LICENSE']) {
    assert.ok(npmFiles.includes(guide), `Missing public/legal npm guide: ${guide}`);
  }
  assert.ok(!npmFiles.some(file => file === 'AGENTS.md' || file.startsWith('.github/')));
  const home = path.join(root, 'uncreated-owned-home');
  const prepared = await distribution(home, root);
  assertNoDiagnostics(await checkPackagedDocumentation(prepared.files,
    { managedInstructions: prepared.block }), 'Repository-only guidance stays outside installed graph');
  assert.ok(![...prepared.files.keys()].some(file =>
    /(?:^|\/)(?:AGENTS\.md|\.github)(?:\/|$)/u.test(file)));
  assert.ok(![...prepared.files.values(), prepared.block].some(value =>
    value.toString().includes(sourceOnlyMarker)),
  'Source-only instruction bytes must not enter any renamed installed file or managed default block');
  await assert.rejects(fs.stat(home), { code: 'ENOENT' });

  for (const guide of [...repositoryGuides, 'CONTRIBUTING.md', 'SECURITY.md']) {
    const target = path.join(root, guide);
    const bytes = await fs.readFile(target);
    await fs.rm(target);
    try { assert.match(await diagnostics(root), /missing or unsafe public guide/u); }
    finally { await fs.writeFile(target, bytes); }
  }
  const sourceOnlyInstructions = await fs.readFile(path.join(root, '.github/testing-policy.md'), 'utf8');
  const mutations = [
    ['SECURITY.md', text => text.replaceAll(
      'https://github.com/urmich/ai-sdlc-framework/security/advisories/new',
      'https://github.com/urmich/ai-sdlc-framework/issues'),
    /missing repository private reporting route/u],
    ['README.md', text => `${text}\n[missing](docs/getting-started/absent.md)\n`,
      /missing or unsafe link docs\/getting-started\/absent\.md/u],
    ['README.md', text => `${text}\n[missing](docs/getting-started/README.md#absent-section)\n`,
      /missing anchor docs\/getting-started\/README\.md#absent-section/u],
    ['README.md', text => `${text}\nai-sdlc-framework@0.0.1\n`, /stale public version pin/u],
    ['docs/usage/requirements.md', () => '# Misplaced reader specification\n',
      /invalid canonical layout/u],
    ['assets/instructions.md', text => `${text}\n[repo test policy](../.github/testing-policy.md)\n`,
      /generic assets must not depend on repository-only test guidance/u],
    ['assets/instructions.md', text => `${text}\n${sourceOnlyInstructions}`,
      /generic assets must not contain repository-only test instructions/u],
  ];
  for (const [relative, mutate, expected] of mutations) {
    const target = path.join(root, relative);
    const before = await fs.readFile(target, 'utf8').catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    const changed = mutate(before ?? '');
    assert.notEqual(changed, before, `Negative fixture must change ${relative}`);
    await fs.writeFile(target, changed);
    try { assert.match(await diagnostics(root), expected); }
    finally {
      if (before === null) await fs.rm(target);
      else await fs.writeFile(target, before);
    }
  }
  const omitted = path.join(root, 'docs/usage/evidence.md');
  const omittedBytes = await fs.readFile(omitted);
  await fs.rm(omitted);
  try {
    await assert.rejects(distribution(home, root), error =>
      error.code === 'INSTALL' && /invalid documentation/u.test(error.message));
    await assert.rejects(fs.stat(home), { code: 'ENOENT' });
  } finally { await fs.writeFile(omitted, omittedBytes); }
  await fs.appendFile(path.join(root, 'CONTRIBUTING.md'),
    '\n[repository-only policy](.github/testing-policy.md)\n');
  assert.match(await diagnostics(root), /repository-only guidance cannot be a shipped relative link/u);
  const leaking = { ...pkg, files: [...pkg.files, 'AGENTS.md', '.github'] };
  await fs.writeFile(manifestPath, JSON.stringify(leaking));
  try {
    assert.match(await diagnostics(root), /explicit file allowlist must exclude repository-only/u);
    const leaked = await packed();
    assert.ok(leaked.includes('AGENTS.md') && leaked.includes('.github/testing-policy.md'),
      'The negative fixture must actually include both source-only guides in npm');
    for (const files of [['.'], ['**/*'], ['src/../AGENTS.md']]) {
      await fs.writeFile(manifestPath, JSON.stringify({ ...pkg, files }));
      assert.match(await diagnostics(root), /explicit file allowlist must exclude repository-only/u);
    }
    await fs.writeFile(manifestPath, JSON.stringify({
      ...pkg, exports: { ...pkg.exports, './source-policy': './src/../.github/testing-policy.md' },
    }));
    assert.match(await diagnostics(root), /repository-only guidance must not be exported/u);
    await fs.writeFile(manifestPath, JSON.stringify({
      ...pkg, files: pkg.files.filter(file => file !== 'docs'),
    }));
    assert.match(await diagnostics(root), /missing shipped documentation selection docs/u);
    const missingDocs = await packed();
    assert.ok(!missingDocs.some(file => file.startsWith('docs/')));
    assert.match((await packageGraph(missingDocs)).diagnostics.join('\n'),
      /missing or unsafe link docs\//u);
  } finally { await fs.writeFile(manifestPath, original); }
});

test('T-PRD048 docs-only native admission rejects omitted or unexecuted required documentation checks', async t => {
  const root = await fixture(t);
  await fs.cp(path.join(source, 'assets'), path.join(root, 'assets'), { recursive: true });
  await fs.cp(path.join(source, 'bin'), path.join(root, 'bin'), { recursive: true });
  await fs.mkdir(path.join(root, 'src'));
  await fs.copyFile(path.join(source, 'src/documentation-links.mjs'),
    path.join(root, 'src/documentation-links.mjs'));
  await fs.mkdir(path.join(root, 'scripts'));
  for (const file of ['check.mjs', 'check-docs.mjs']) {
    await fs.copyFile(path.join(source, 'scripts', file), path.join(root, 'scripts', file));
  }
  await write(root, 'test/static-fixture.test.mjs', 'export const fixture = true;\n');
  const check = () => execute(process.execPath, ['scripts/check.mjs'], {
    cwd: root, timeout: 30000, maxBuffer: 1024 * 1024,
  });
  assert.match((await check()).stdout, /documentation files/u);
  await fs.appendFile(path.join(root, 'docs/usage/README.md'), '\n[broken](missing-required-doc.md)\n');
  await assert.rejects(check(), error => error.code !== 0 &&
    /missing-required-doc\.md/u.test(`${error.stderr}${error.stdout}`));
  const f = await observerApiFixture(t, { docsOnly: true });
  assert.ok(f.changedFiles.length > 0);
  assert.ok(f.changedFiles.every(file => file.endsWith('.md')),
    'The controlled provider fixture must contain an actual docs-only adopted/head tree delta');
  const verdict = snapshot => snapshot.prs[0].verdicts['framework/validation'];
  assert.equal(verdict(await f.connect().host.snapshot()).status, 'Passed');
  const lane = f.lanes.get('linux-x64');
  const original = lane.data.get('static.json');
  assert.ok(original && Object.getPrototypeOf(original) === Object.prototype,
    'Positive native fixture must include its actual parsed static/documentation report');
  lane.data.delete('static.json');
  f.refresh('linux-x64');
  assert.equal(verdict(await f.connect().host.snapshot()).status, 'NotRun');
  const incomplete = structuredClone(original);
  incomplete.complete = false;
  incomplete.exitCode = 0;
  lane.data.set('static.json', incomplete);
  f.refresh('linux-x64');
  assert.equal(verdict(await f.connect().host.snapshot()).status, 'NotRun');
  lane.data.set('static.json', original);
  f.refresh('linux-x64');
  assert.equal(verdict(await f.connect().host.snapshot()).status, 'Passed');
  f.assertReadOnly();
});

test('T-PRD049 public version, platform and latest-readiness examples reject stale claims', async t => {
  const root = await fixture(t);
  assertNoDiagnostics(await checkDocumentation({ root }), 'Unmodified public reader fixture');
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const corruptions = [
    ['README.md', text => text.replaceAll(`**${pkg.version}**`, '**0.0.1**'), /current version differs/u],
    ['README.md', text => `${text}\nai-sdlc-framework@0.0.1\n`, /stale public version pin/u],
    ['docs/installation/README.md', text => text.replace('| Node minimum | >=22 |', '| Node minimum | >=20 |'), /distribution contract Node minimum/u],
    ['docs/installation/README.md', text => text.replace('| Standalone archives | macos, windows-x64 |', '| Standalone archives | macos, windows-x64, linux-x64 |'), /distribution contract Standalone archives/u],
    ['README.md', text => `${text}\nThe macOS package contains two native Mac launchers.\n`, /Mac payload claim/u],
    ['docs/installation/README.md', text => text.replace('| macOS archive | ai-sdlc-framework-<version>-macos.tar.gz |', '| macOS archive | ai-sdlc-framework-<version>-macos-arm64.tar.gz |'), /distribution contract macOS archive/u],
    ['docs/installation/README.md', text => text.replace('linux-x64, windows-x64, macos-arm64, macos-x64 |', 'linux-x64, windows-x64, macos-arm64 |'), /distribution contract Required validation hosts/u],
    ['docs/installation/README.md', text => text.replace('| Candidate readiness | Unverified |', '| Candidate readiness | Passed |'), /distribution contract Candidate readiness/u],
    ['docs/installation/README.md', text => `${text}\n| Node minimum | >=22 |\n`, /distribution contract Node minimum is missing or duplicated/u],
    ['README.md', text => `${text}\nThe latest candidate is validated.\n`, /current readiness claim/u],
  ];
  for (const [relative, mutate, expected] of corruptions) {
    const file = path.join(root, relative);
    const original = await fs.readFile(file, 'utf8');
    try {
      const changed = mutate(original);
      assert.ok(changed !== original, `Negative fixture must actually corrupt ${relative}`);
      await fs.writeFile(file, changed);
      assert.match(await diagnostics(root), expected);
    } finally { await fs.writeFile(file, original); }
  }
  assertNoDiagnostics(await checkDocumentation({ root }), 'Restored public reader fixture');
  const security = await fs.readFile(path.join(root, 'SECURITY.md'), 'utf8');
  assert.match(security, /https:\/\/github\.com\/urmich\/ai-sdlc-framework\/security\/advisories\/new/u);
  assert.match(security, /enabled: true/u);
  assert.doesNotMatch(security, /private vulnerability reporting is disabled/iu);
  assert.doesNotMatch(security, /mailto:|security@[A-Za-z0-9]/u);
  const readerContents = new Map(await Promise.all([
    'README.md', 'SECURITY.md', 'docs/releases/README.md', 'docs/installation/README.md',
  ].map(async relative => [relative, await fs.readFile(path.join(root, relative), 'utf8')])));
  const claims = [
    ['coordinated negative', 'There are no Go module dependencies or bundled Node runtimes.', false],
    ['line-wrapped coordinated negative', 'There are no Go module\ndependencies or bundled Node runtimes.', false],
    ['direct no negative', 'There is no bundled Node runtime.', false],
    ['direct not negative', 'This is not a bundled Node runtime.', false],
    ['direct without negative', 'The package ships without a bundled Node runtime.', false],
    ['positive singular', 'The package includes a bundled Node runtime.', true],
    ['positive plural', 'The package includes bundled Node runtimes.', true],
    ['unrelated negative', 'There are no Go module dependencies. The package includes bundled Node runtimes.', true],
    ['negative then positive', 'There are no Go module dependencies or bundled Node runtimes. Another package includes bundled Node runtimes.', true],
  ];
  for (const ending of ['\n', '\r\n']) for (const [name, claim, conflict] of claims) {
    const contents = new Map(readerContents);
    contents.set('packaging/winget/README.md', claim.replaceAll('\n', ending));
    const errors = inspectReaderContracts(contents, pkg);
    assert.equal(errors.includes('packaging/winget/README.md: bundled Node claim conflicts with distribution contract'),
      conflict, `${name}: bundled-runtime classification with ${ending === '\n' ? 'LF' : 'CRLF'}`);
    assert.equal(errors.length, Number(conflict), `${name}: unrelated reader diagnostics`);
  }
});

test('T-PRD051 documented source-check command works in an isolated fixture and reports broken inputs', async t => {
  const root = await fixture(t);
  await packageSource(root);
  await fs.cp(path.join(source, 'scripts'), path.join(root, 'scripts'), { recursive: true });
  await fs.cp(path.join(source, '.github'), path.join(root, '.github'), { recursive: true });
  await fs.mkdir(path.join(root, 'test'), { recursive: true });
  const marker = path.join(root, 'selected-recipe.txt');
  await write(root, 'test/public-readiness-docs.test.mjs',
    'import test from "node:test"; import fs from "node:fs/promises";' +
    'test("T-PRD048 recipe selects the exact affected assertion",async()=>{' +
    'await fs.writeFile(process.env.RECIPE_SENTINEL,"executed");});' +
    'test("unselected sibling must not run",()=>{throw new Error("wrong selection");});\n');
  const guide = await fs.readFile(path.join(root, 'docs/contributing/README.md'), 'utf8');
  const readme = await fs.readFile(path.join(root, 'README.md'), 'utf8');
  const defaultCommands = /```sh\r?\n([\s\S]*?)\r?\n```/u.exec(
    readme.slice(readme.indexOf('## Contributor validation')))?.[1];
  assert.ok(defaultCommands);
  assert.equal((defaultCommands.match(/^npm run test:critical(?: -- .*)?\r?$/gmu) ?? []).length, 1);
  assert.doesNotMatch(defaultCommands, /^npm run test:unit\r?$/mu);
  assert.doesNotMatch(defaultCommands, /--affected/u);
  assert.match(readme, /standalone `npm run test:unit`/iu);
  const defaultLine = defaultCommands.split(/\r?\n/u).find(line => line.startsWith('npm run test:critical'));
  const defaultArguments = defaultLine.slice('npm run test:critical'.length).trim();
  assert.equal(defaultArguments, '');
  assert.doesNotThrow(() => parseOptions(['critical']));
  const recipes = documentedRecipe(guide, 'docs-local');
  assert.equal(recipes.length, 2);
  const userHome = path.join(root, 'owned-user-home');
  const copilotHome = path.join(root, 'owned-copilot-home');
  const scratch = path.join(root, 'owned-scratch');
  await fs.mkdir(userHome);
  await fs.mkdir(scratch);
  const environment = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !/^SDLC_TEST_(?:REPORT|JOURNAL)/u.test(key))),
    HOME: userHome, USERPROFILE: userHome, COPILOT_HOME: copilotHome,
    TMPDIR: scratch, TMP: scratch, TEMP: scratch,
    RECIPE_SENTINEL: marker, SDLC_TEST_REPORT_DIR: path.join(root, '.test-data/reports'),
  };
  const run = args => execute(process.execPath, args, { cwd: root,
    env: environment, timeout: 30000, maxBuffer: 1024 * 1024 });
  assert.match((await run(recipes[0])).stdout, /Checked \d+ documentation files/u);
  assert.match((await run(recipes[1])).stdout, /T-PRD048 recipe selects the exact affected assertion/u);
  assert.equal(await fs.readFile(marker, 'utf8'), 'executed');
  const absent = documentedRecipe(guide.replace(
    /(<!-- recipe:docs-local -->[\s\S]*?)test\/public-readiness-docs\.test\.mjs(?=\r?\n```)/u,
    '$1test/absent.test.mjs'), 'docs-local')[1];
  assert.ok(absent.includes('test/absent.test.mjs'));
  await assert.rejects(run(absent), error => error.code !== 0 && /absent\.test\.mjs/u.test(`${error.stderr}${error.stdout}`));
  assert.throws(() => documentedRecipe(guide.replace(
    /(<!-- recipe:docs-local -->[\s\S]*?)test\/public-readiness-docs\.test\.mjs(?=\r?\n```)/u,
    '$1../outside.test.mjs'), 'docs-local'), /escapes/u);
  await write(root, 'outside.test.mjs',
    'import fs from "node:fs/promises"; await fs.writeFile(process.env.RECIPE_SENTINEL,"unsafe execution");\n');
  await assert.rejects(run(['scripts/test-runner.mjs', 'targeted', 'test/../outside.test.mjs']),
    error => error.code !== 0 && /test|outside/u.test(`${error.stderr}${error.stdout}`));
  assert.equal(await fs.readFile(marker, 'utf8'), 'executed');
  assert.throws(() => documentedRecipe(guide.replace(
    'node scripts/check-docs.mjs', 'node scripts/check-docs.mjs; node unowned.mjs'), 'docs-local'), /Unsafe/u);
  await assert.rejects(run(['scripts/test-runner.mjs', 'targeted', '--workers', '0',
    'test/public-readiness-docs.test.mjs']), error => error.code !== 0 && /Workers/u.test(error.stderr));
  const worker = path.join(root, 'scripts/test-worker.mjs');
  await fs.rename(worker, `${worker}.held`);
  await fs.rm(marker);
  try {
    await assert.rejects(run(recipes[1]), error => error.code !== 0 && /test-worker\.mjs/u.test(`${error.stderr}${error.stdout}`));
    await assert.rejects(fs.stat(marker), { code: 'ENOENT' });
  } finally { await fs.rename(`${worker}.held`, worker); }
  const native = documentedRecipe(guide, 'native-pr', { native: true })[0];
  const nativeEnvironment = { ...environment };
  for (const key of Object.keys(nativeEnvironment)) {
    if (/^(?:GITHUB_|RUNNER_|EXPECTED_|RELEASE_INTENT_ID)/u.test(key)) delete nativeEnvironment[key];
  }
  await assert.rejects(execute(process.execPath, native, { cwd: root,
    env: nativeEnvironment, timeout: 30000 }),
  error => error.code !== 0 && /Missing exact EXPECTED_DESCRIPTOR_SHA256/u.test(`${error.stderr}${error.stdout}`));
  await assert.rejects(fs.stat(path.join(root, '.test-data/native-candidate')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(root, '.test-data/native-evidence')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(copilotHome), { code: 'ENOENT' });
  await fs.appendFile(path.join(root, 'docs/usage/README.md'), '\n[broken](does-not-exist.md)\n');
  await assert.rejects(run(recipes[0]),
    error => error.code === 1 && error.stderr.includes('does-not-exist.md'));
});

test('T-PRD052 every proposed FR-054 condition has an explicit adoption/defer boundary', async () => {
  const [requirements, mapping] = await Promise.all([
    fs.readFile('docs/sdlc/core-framework/requirements.md', 'utf8'),
    fs.readFile('docs/contributing/documentation.md', 'utf8'),
  ]);
  for (const ending of ['\n', '\r\n']) {
    const document = mapping.replace(/\r\n?/gu, '\n').replaceAll('\n', ending);
    assertNoDiagnostics({ diagnostics: inspectGovernanceDispositions(requirements, document) },
      `Original 19-condition governance mapping with ${ending === '\n' ? 'LF' : 'CRLF'}`);
    const missing = document.replace(/^\| AC-054\.2 \|[^\r\n]*(?:\r?\n|$)/mu, '');
    assert.ok(missing !== document, 'Missing-classification fixture must remove its original row');
    assert.ok(inspectGovernanceDispositions(requirements, missing).includes('AC-054.2: missing governance classification'),
      'Removing AC-054.2 must diagnose its missing governance classification');
    const duplicate = `${document}${ending}| AC-054.2 | **Deferred**: Contradicts its adopted reporting policy. |${ending}`;
    assert.match(inspectGovernanceDispositions(requirements, duplicate).join('\n'), /duplicate or conflicting/u);
    const expansion = document.replace('**Deferred**: The broader dependency-maintenance',
      '**Adopted**: The broader dependency-maintenance');
    assert.ok(expansion !== document, 'Scope-expansion fixture must change its disposition');
    assert.match(inspectGovernanceDispositions(requirements, expansion).join('\n'), /unauthorized governance scope expansion/u);
    const undefinedDisposition = document.replace('**Scoped**:', 'Relevant controls:');
    assert.match(inspectGovernanceDispositions(requirements, undefinedDisposition).join('\n'), /missing explicit governance disposition/u);
    assert.match(inspectGovernanceDispositions(requirements,
      `${document}${ending}## FR-054 adopted and deferred${ending}`).join('\n'), /exactly one adoption section/u);
    const unknown = document.replace('AC-054.19', 'AC-054.99');
    assert.match(inspectGovernanceDispositions(requirements, unknown).join('\n'), /unknown original governance condition/u);
  }
});

test('T-PRD062 packaging readers reject obsolete future Mac assets and nonblocking native gates', async t => {
  const root = await fixture(t);
  assertNoDiagnostics(await checkDocumentation({ root }), 'Unmodified packaging reader fixture');
  const file = path.join(root, 'packaging/homebrew/README.md');
  const original = await fs.readFile(file, 'utf8');
  const obsolete = original.replace('-macos.tar.gz', '-macos-arm64.tar.gz');
  assert.ok(obsolete !== original, 'Obsolete Mac filename fixture must change a current archive reference');
  await fs.writeFile(file, obsolete);
  assert.match(await diagnostics(root), /obsolete Mac archive claim/u);
  await fs.writeFile(file, `Native Intel lifecycle is non-blocking.\n\n${original}`);
  assert.match(await diagnostics(root), /native gate claim/u);
  await fs.writeFile(file, `<!-- historical:start -->\nThe 0.4.0 Mac archive was ai-sdlc-framework-0.4.0-macos-arm64.tar.gz.\n<!-- historical:end -->\n\n${original}`);
  assertNoDiagnostics(await checkDocumentation({ root }), 'Explicit historical packaging reader section');
  const standalone = path.join(root, 'packaging/standalone/README.md');
  const standaloneOriginal = await fs.readFile(standalone, 'utf8');
  await fs.writeFile(standalone, `Every archive contains the exact .tgz payload.\n\n${standaloneOriginal}`);
  assert.match(await diagnostics(root), /embedded Mac archive claim/u);
});

test('T-PRD088 RC66 DOC01 rendered Windows workspace preserves existing content and refuses collisions',
  { skip: process.platform !== 'win32' }, async t => {
    const root = path.join(source, '.test-data', `ww-${randomUUID().slice(0, 8)}`);
    await fs.mkdir(root);
    t.after(async () => {
      assert.equal(path.dirname(root), path.join(source, '.test-data'));
      await fs.rm(root, { recursive: true });
      await assert.rejects(fs.stat(root), { code: 'ENOENT' });
    });
    const pkg = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
    const identity = { version: pkg.version, sourceCommit: '1'.repeat(40),
      payloadSha256: '2'.repeat(64), descriptorSha256: '3'.repeat(64), checksumsSha256: '4'.repeat(64) };
    const rendered = renderWindowsTesterPrompt({ identity,
      releaseRepository: new URL(pkg.repository.url).pathname.slice(1).replace(/\.git$/u, ''),
      inventoryDigest: '5'.repeat(64), launcherSha256: '6'.repeat(64),
      templateSha256: TESTER_TEMPLATE_SHA256,
      archive: { filename: `ai-sdlc-framework-${pkg.version}-windows-x64.zip`,
        kind: 'archive', sha256: '7'.repeat(64), size: 1 },
      readiness: { identity, installerImplementation: 'Complete',
        nativeMacosArm64: 'Passed', nativeHomebrew: 'Passed' },
    });
    const prefix = /## 2\. Download[\s\S]*?```powershell\r?\n([\s\S]*?)\r?\n\$Descriptor =/u
      .exec(rendered.contents)?.[1];
    assert.ok(prefix, 'Execute only the rendered workspace allocation, never download/install instructions');
    assert.doesNotMatch(prefix, /Invoke-WebRequest|Expand-Archive|& \$Installer/iu);
    const mockTemp = path.join(root, 'owned mock TEMP');
    const oldFixed = path.join(mockTemp, 'AI SDLC Framework Windows Test');
    await fs.mkdir(oldFixed, { recursive: true });
    await fs.writeFile(path.join(oldFixed, 'sentinel.txt'), 'unrelated existing evidence');
    const probe = async (collision) => {
      const script = `Set-Location -LiteralPath '${source.replaceAll("'", "''")}'\n` +
        "$ErrorActionPreference = 'Stop'\n" +
        (collision ? 'function Join-Path { param([string]$Path, [string]$ChildPath) $env:RC66_COLLISION_PATH }\n' : '') +
        `try {\n${prefix}\n[ordered]@{ ok = $true; work = $Work } | ConvertTo-Json -Compress\n` +
        '} catch { [ordered]@{ ok = $false; work = $Work } | ConvertTo-Json -Compress }\n';
      const result = await execute('powershell.exe', ['-NoProfile', '-NonInteractive',
        '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
        cwd: source, env: { ...process.env, TEMP: mockTemp, TMP: mockTemp,
          ...(collision ? { RC66_COLLISION_PATH: collision } : {}) },
        timeout: 15000, maxBuffer: 1024 * 1024,
      });
      return JSON.parse(result.stdout.trim());
    };
    const first = await probe();
    assert.equal(first.ok, true);
    assert.equal(await fs.readFile(path.join(oldFixed, 'sentinel.txt'), 'utf8'),
      'unrelated existing evidence', 'Existing fixed-name content must never be deleted');
    assert.equal(path.dirname(first.work), mockTemp);
    assert.notEqual(first.work, oldFixed);
    assert.ok((await fs.stat(first.work)).isDirectory());
    const second = await probe();
    assert.equal(second.ok, true);
    assert.notEqual(second.work, first.work, 'Each execution must allocate a unique owned workspace');
    const guid = randomUUID();
    const collision = path.join(mockTemp, `AI SDLC Framework Windows Test-${guid.replaceAll('-', '')}`);
    await fs.mkdir(collision);
    await fs.writeFile(path.join(collision, 'sentinel.txt'), 'collision evidence');
    assert.deepEqual(await probe(collision), { ok: false, work: collision },
      'Exclusive creation must refuse an existing destination instead of reusing or deleting it');
    assert.equal(await fs.readFile(path.join(collision, 'sentinel.txt'), 'utf8'), 'collision evidence');
  });

test('T-PRD088 RC66 DOC02 current runtime guidance matches actual validation and publishing inputs', async () => {
  const read = relative => fs.readFile(path.join(source, relative), 'utf8');
  const [homebrew, release, ci, publisher, pkg] = await Promise.all([
    read('packaging/homebrew/README.md'), read('docs/releases/release-ci.md'),
    read('.github/workflows/ci.yml'), read('scripts/npm-handoff.mjs'),
    read('package.json').then(JSON.parse),
  ]);
  const minimum = /node-version: '([^']+)'/u.exec(ci)?.[1];
  const publishing = /process\.versions\.node !== '([^']+)'/u.exec(publisher)?.[1];
  assert.ok(minimum && publishing);
  for (const [name, guide] of [['Homebrew', homebrew], ['release', release]]) {
    assert.ok(guide.includes(`Node ${nativeToolchain.node}`), `${name}: actual native baseline`);
    assert.ok(guide.includes(`Node ${minimum}`), `${name}: separate minimum compatibility lane`);
    assert.ok(guide.includes(`Node ${publishing}`), `${name}: separate publishing baseline`);
    assert.ok(guide.includes(`Node ${pkg.engines.node}`), `${name}: unchanged product minimum`);
  }
  assert.ok(homebrew.includes(`declares \`${homebrewToolchain.formula}\``));
  const retention = homebrew.slice(homebrew.indexOf('The reverse helper captures rollback state'));
  assert.match(retention, /receipt/iu);
  assert.doesNotMatch(retention, /brew tab[^\r\n]*--formula node@\d+/u,
    'Runtime retention must use the actual installed receipt, not a hard-coded formula');
  assert.match(homebrew, /installed receipt[\s\S]*dependency/iu);
});

test('T-PRD088 RC66 DOC03 integration readers use the finite unit-first local gate', async () => {
  const guide = await fs.readFile(path.join(source, 'docs/integrations/github-adapters.md'), 'utf8');
  const pkg = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
  const recipe = /<!-- recipe:github-local -->\s*```sh\r?\n([\s\S]*?)\r?\n```/u.exec(guide)?.[1];
  assert.ok(recipe, 'Current integration guidance must expose its exact local gate');
  const commands = recipe.trim().split(/\r?\n/u).map(line => line.split(' ').slice(1));
  assert.deepEqual(commands, [pkg.scripts['test:critical'], pkg.scripts.check]
    .map(command => command.split(' ').slice(1)));
  assert.equal(parseOptions(commands[0].slice(1)).profile, 'critical');
  assert.ok(guide.includes(`${criticalProfileBudget.maximumAssertions}-assertion`));
  assert.match(guide, /full\/coverage[\s\S]*optional/iu);
  assert.match(guide, /\.\.\/contributing\/README\.md/u);
  assert.doesNotMatch(guide, /Complete local unit-first\/full\/static\/package validation precedes/u);
});

test('T-PRD088 RC66 DOC04 canonical core definitions pass catalog and cycle definition admission', async t => {
  const contents = await fs.readFile(path.join(source, 'docs/sdlc/core-framework/test-plan.md'), 'utf8');
  const parsed = parseTestPlan(contents);
  assert.equal(parsed.length, 60);
  assert.equal(new Set(parsed.map(item => item.id)).size, 60);
  const f = await frameworkFixture(t);
  const relative = 'docs/sdlc/core-framework/test-plan.md';
  await write(f.repo, relative, contents);
  await registerArtifact(f.store, { workItemId: f.workItemId, role: 'test-plan',
    repositoryId: 'primary', path: relative });
  const specification = await resolveTestSpecification(f.store, f.workItemId);
  assert.doesNotThrow(() => validateTestDefinitions(specification.tests));
  const catalog = buildTestCatalog(f.workItemId, specification);
  assert.deepEqual(catalog.tests.map(item => item.id), parsed.map(item => item.id).sort());
  for (const item of catalog.tests) {
    assert.ok(item.expected.length <= 2000, `${item.id}: bounded admission outcome`);
  }
  for (const id of ['T-51', 'T-52', 'T-58', 'T-59', 'T-60']) {
    assert.equal(parsed.find(item => item.id === id).status, 'NotRun');
    assert.match(contents, new RegExp(`### Procedure ${id}\\b`, 'u'));
    assert.ok(catalog.tests.find(item => item.id === id).expected.includes(`procedure ${id}`));
  }
  assert.match(contents, /hook-bound Node runtime survives formula dependency autoremove/u);
  assert.match(contents, /missing\/swapped\/wrong-identity evidence/u);
  await assert.rejects(startCycle(f.store, { workItemId: f.workItemId,
    configDigest: 'rc66-fixture-config', cause: 'Exercise actual canonical definition admission' }),
  error => error.code === 'PHASE' && /Validation cycles require Coding authority/u.test(error.message),
  'Real cycle admission must reach its independent authority guard, not reject canonical definitions');
  const state = await f.store.load(f.workItemId);
  assert.equal(state.checkpoint.phase, 'requirements');
  assert.equal(state.records.some(record => record.type === 'cycle'), false,
    'A fixture definition check cannot fabricate Coding approval or execution credit');
});

test('T-PRD088 RC66 current reader identity needs only the repository maintainer handle', async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
  const repository = new URL(pkg.repository.url);
  const handle = repository.pathname.split('/').filter(Boolean)[0];
  assert.ok(handle);
  assert.equal(pkg.author, handle);
  const legal = await fs.readFile(path.join(source, 'LICENSE'), 'utf8');
  const legalIdentity = /Copyright \(c\) \d{4} ([^\r\n]+)/u.exec(legal)?.[1];
  assert.ok(legalIdentity, 'Retain the existing required legal attribution');
  const current = ['README.md', 'CONTRIBUTING.md', 'OWNERSHIP.md', 'SUPPORT.md',
    'SECURITY.md', 'CODE_OF_CONDUCT.md', 'RELEASING.md'];
  const collect = async relative => {
    for (const entry of await fs.readdir(path.join(source, relative), { withFileTypes: true })) {
      if (relative === 'docs' && entry.name === 'sdlc') continue;
      const file = path.join(relative, entry.name);
      if (entry.isDirectory()) await collect(file);
      else if (/\.md(?:\.template)?$/u.test(entry.name)) current.push(file);
    }
  };
  for (const directory of ['docs', 'assets', 'packaging']) await collect(directory);
  for (const file of current) {
    const guide = await fs.readFile(path.join(source, file), 'utf8');
    assert.ok(!guide.includes(legalIdentity), `${file}: current reader guidance needs no legal-name repetition`);
    assert.doesNotMatch(guide, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
      `${file}: use project routes rather than personal email`);
  }
  const [ownership, security, support] = await Promise.all([
    fs.readFile(path.join(source, 'OWNERSHIP.md'), 'utf8'),
    fs.readFile(path.join(source, 'SECURITY.md'), 'utf8'),
    fs.readFile(path.join(source, 'SUPPORT.md'), 'utf8'),
  ]);
  assert.ok(ownership.includes(`https://github.com/${handle}`));
  assert.match(ownership, /personal third-party OSS/u);
  assert.ok(security.includes(`${repository.href.replace(/\.git$/u, '')}/security/advisories/new`));
  assert.ok(support.includes(`${repository.href.replace(/\.git$/u, '')}/issues`));
  assert.match(security, /Do not disclose exploit details or secrets in public Issues/u);
});

test('T-PRD088 RC66 followup Homebrew public recipe binds both frozen release destinations', async () => {
  const fixturePath = process.env.SDLC_DOCS_HOMEBREW_CONTRACT_FIXTURE;
  let contract = path.join(source, 'scripts', 'homebrew-lifecycle.mjs');
  if (fixturePath) {
    contract = path.resolve(fixturePath);
    const relative = path.relative(path.join(source, '.test-data'), contract);
    assert.ok(relative && !path.isAbsolute(relative) && !relative.startsWith('..'),
      'A cross-slice metadata fixture must be an owned repository-local file');
    assert.equal((await fs.lstat(contract)).isSymbolicLink(), false);
    const provenance = JSON.parse(await fs.readFile(`${contract}.provenance.json`, 'utf8'));
    assert.equal(provenance.protocol, 'read-only-source-contract-v1');
    assert.equal(provenance.sourcePath, 'scripts/homebrew-lifecycle.mjs');
    const bytes = await fs.readFile(contract);
    assert.equal(bytes.length, provenance.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), provenance.sha256);
  }
  const contents = await fs.readFile(contract, 'utf8');
  const metadata = /parseArgs\(\{ options: \{([\s\S]*?)\r?\n  \} \}\)/u.exec(contents)?.[1];
  assert.ok(metadata, 'Read the actual CLI option declaration without importing or executing the driver');
  const options = Object.fromEntries([...metadata.matchAll(
    /(?:'([^']+)'|([a-z][a-z-]*)):\s*\{\s*type:\s*'(string|boolean)'(?:,\s*default:\s*'([^']*)')?\s*\}/gu,
  )].map(match => [match[1] ?? match[2],
    { type: match[3], ...(match[4] === undefined ? {} : { default: match[4] }) }]));
  for (const side of ['previous', 'current']) {
    assert.ok(Object.hasOwn(options, `${side}-release-repository`),
      'The current caller-bound CLI contract, not the legacy worker script, is required');
    assert.ok(contents.includes(`values['${side}-release-repository']`));
  }
  const guide = await fs.readFile(path.join(source, 'packaging/homebrew/README.md'), 'utf8');
  const recipe = /<!-- recipe:homebrew-public -->\s*```sh\r?\n([\s\S]*?)\r?\n```/u.exec(guide)?.[1];
  assert.ok(recipe, 'Public acceptance needs a complete, independently destination-bound invocation');
  const tokens = [...recipe.replace(/\\\r?\n\s*/gu, ' ').matchAll(/"([^"]*)"|'([^']*)'|([^\s"']+)/gu)]
    .map(match => match[1] ?? match[2] ?? match[3]);
  assert.deepEqual(tokens.slice(0, 2), ['node', 'scripts/homebrew-lifecycle.mjs']);
  const bindings = {
    PWD: '/owned/checkout',
    VERIFIED_PREVIOUS_ASSETS: '/owned/previous-public-assets',
    EXACT_FROZEN_CURRENT_ASSETS: '/owned/current-public-assets',
    SUPPORTED_PREVIOUS_DESCRIPTOR_SHA256: '1'.repeat(64),
    SUPPORTED_PREVIOUS_CHECKSUMS_SHA256: '2'.repeat(64),
    EXPECTED_DESCRIPTOR_SHA256: '3'.repeat(64),
    EXPECTED_CHECKSUMS_SHA256: '4'.repeat(64),
    FROZEN_PREVIOUS_RELEASE_REPOSITORY: 'previous-owner/previous-release',
    FROZEN_CURRENT_RELEASE_REPOSITORY: 'current-owner/current-release',
  };
  const args = tokens.slice(2).map(token => token.replace(/\$([A-Z][A-Z0-9_]*)/gu, (_, name) => {
    assert.ok(Object.hasOwn(bindings, name), `Undeclared recipe input: ${name}`);
    return bindings[name];
  }));
  const { values } = parseArgs({ args, options, allowPositionals: false });
  assert.equal(values.mode, 'public');
  assert.deepEqual(Object.keys(values).sort(), Object.keys(options).sort(),
    'The public recipe must supply every current CLI input, including both destinations and all four pins');
  for (const [name, value] of [
    ['candidate-dir', bindings.VERIFIED_PREVIOUS_ASSETS],
    ['upgrade-dir', bindings.EXACT_FROZEN_CURRENT_ASSETS],
    ['previous-descriptor-sha256', bindings.SUPPORTED_PREVIOUS_DESCRIPTOR_SHA256],
    ['previous-checksums-sha256', bindings.SUPPORTED_PREVIOUS_CHECKSUMS_SHA256],
    ['current-descriptor-sha256', bindings.EXPECTED_DESCRIPTOR_SHA256],
    ['current-checksums-sha256', bindings.EXPECTED_CHECKSUMS_SHA256],
    ['previous-release-repository', bindings.FROZEN_PREVIOUS_RELEASE_REPOSITORY],
    ['current-release-repository', bindings.FROZEN_CURRENT_RELEASE_REPOSITORY],
  ]) assert.equal(values[name], value, `Preserve the independently selected ${name}`);
  assert.notEqual(values['previous-release-repository'], values['current-release-repository']);
  assert.match(guide, /independently frozen\s+previous and current release destinations/iu);
  assert.match(guide, /neither.*source repository.*fallback/isu);
});

test('T-PRD088 RC66 followup T52 separates automated provider work from manual user observations', async () => {
  const requirements = await fs.readFile(path.join(source, 'docs/sdlc/core-framework/requirements.md'), 'utf8');
  assert.match(requirements, /Semi-automated means that the agent drives an instruction-defined flow, not that\s+the user performs part of the scenario/u);
  const contents = await fs.readFile(path.join(source, 'docs/sdlc/core-framework/test-plan.md'), 'utf8');
  const parsed = parseTestPlan(contents);
  assert.equal(parsed.length, 60, 'Keep the existing canonical case identities without duplicate component cases');
  assert.equal(parsed.filter(item => item.id === 'T-52').length, 1);
  const tests = parsed.map(normalizeTestDefinition);
  assert.doesNotThrow(() => validateTestDefinitions(tests));
  const aggregate = tests.find(item => item.id === 'T-52');
  assert.equal(aggregate.mode, 'manual');
  assert.equal(aggregate.owner, 'user');
  assert.match(aggregate.location, /Microsoft-managed client/u);
  assert.equal(parsed.find(item => item.id === 'T-52').status, 'NotRun');
  const procedure = /### Procedure T-52\b([\s\S]*?)(?=### Procedure T-58\b)/u.exec(contents)?.[1];
  assert.ok(procedure);
  const matrix = /\| Part \| Mode \| Owner \| Location \| Procedure and expected outcome \|\r?\n\|[^\r\n]+\r?\n((?:\|[^\r\n]+\r?\n)+)/u.exec(procedure)?.[1];
  assert.ok(matrix, 'Mixed acceptance needs explicit component mode, owner, location and outcomes');
  const parts = matrix.trim().split(/\r?\n/u)
    .map(line => splitMarkdownTableRow(line).slice(1, -1).map(cell => cell.trim()));
  assert.equal(parts.length, 2);
  assert.deepEqual(parts.map(cells => cells.slice(0, 3)), [
    ['Published-byte automation', 'automated', 'provider'],
    ['Managed-client observations', 'manual', 'user'],
  ]);
  assert.match(parts[0][3], /CI.*native clean clients/iu);
  assert.match(parts[0][4], /original.*reports/iu);
  assert.match(parts[1][3], /Microsoft-managed client/u);
  assert.match(parts[1][4], /CFS.*registry.*WinGet.*OS/iu);
  assert.match(procedure, /neither runner-driven automation nor an\s+agent-driven flow can execute/iu);
  assert.match(procedure, /both.*automated.*manual.*results/isu);
  assert.match(procedure, /automated suites remain\s+automated/iu);
  assert.doesNotMatch(contents, /T-52 is semi-automated because|the semi-automated aggregate/iu);
  assert.match(procedure, /Public npm install\/update\/uninstall\/purge/u);
  assert.match(procedure, /real Homebrew tap install\/upgrade\/uninstall/u);
  assert.match(procedure, /A generic network error never proves CFS/u);
});
