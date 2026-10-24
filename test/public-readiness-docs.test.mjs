export const validationDeclarations = {
  "schemaVersion": 1,
  "surfaces": [{"coverage": "direct", "paths": ["scripts/check-docs.mjs", "scripts/check.mjs", "src/documentation-links.mjs"]}]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
import { readValidationObject } from '../src/validation-catalog.mjs';
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
