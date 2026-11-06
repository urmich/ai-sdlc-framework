import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { checkDocumentation } from './check-docs.mjs';
const execute = promisify(execFile);

export function syntaxCheckWorkers({
  parallelism = os.availableParallelism(), inheritedBudget = process.env.SDLC_TEST_BUDGET,
} = {}) {
  assert.ok(Number.isSafeInteger(parallelism) && parallelism > 0, 'Syntax checks need positive available parallelism');
  assert.ok(inheritedBudget === undefined || typeof inheritedBudget === 'string',
    'Inherited syntax-check allocation must be an environment value');
  return inheritedBudget ? 1 : Math.min(32, parallelism);
}

export async function checkSyntaxSources(sources, { workers = syntaxCheckWorkers(), run = execute } = {}) {
  assert.ok(Array.isArray(sources) && sources.every(file => typeof file === 'string'),
    'Syntax checks need explicit source paths');
  assert.ok(Number.isSafeInteger(workers) && workers > 0 && workers <= 32,
    'Syntax checks need a bounded positive worker count');
  assert.equal(typeof run, 'function');
  let next = 0;
  const failures = [];
  const worker = async () => {
    while (next < sources.length && failures.length === 0) {
      const index = next++;
      try { await run(process.execPath, ['--check', sources[index]]); }
      catch (error) { failures.push({ index, error }); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(workers, sources.length) }, worker));
  if (failures.length) throw failures.sort((left, right) => left.index - right.index)[0].error;
}

async function files(directory) {
  const paths = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (directory === 'test' && entry.isDirectory() && entry.name.startsWith('.runner-fixture-')) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await files(file));
    else paths.push(file);
  }
  return paths;
}
export async function check() {
  const sources = (await Promise.all(['src', 'bin', 'scripts', 'test'].map(files))).flat().filter(file => file.endsWith('.mjs'));
  await checkSyntaxSources(sources);
  const hooks = JSON.parse(await fs.readFile('assets/hooks/sdlc.json', 'utf8'));
  assert.equal(hooks.version, 1);
  assert.deepEqual(Object.keys(hooks.hooks).sort(), ['sessionStart', 'userPromptSubmitted', 'preToolUse', 'postToolUse', 'postToolUseFailure', 'preCompact', 'agentStop', 'sessionEnd'].sort());
  for (const handlers of Object.values(hooks.hooks)) for (const handler of handlers) {
    assert.equal(handler.exec, 'node'); assert.ok(Array.isArray(handler.args));
    assert.ok(!handler.bash && !handler.powershell && !handler.command);
  }
  const launcher = await fs.readFile('bin/sdlc.mjs', 'utf8');
  assert.doesNotMatch(launcher, /^import\s/mu);
  assert.doesNotMatch(launcher, /permissionDecision['"]?\s*:\s*['"]deny/u);
  for (const name of ['sdlc', 'sdlc-requirements', 'sdlc-test-design', 'sdlc-technical-design', 'sdlc-coding']) {
    const text = await fs.readFile(`assets/skills/${name}/SKILL.md`, 'utf8');
    assert.ok(text.startsWith(`---\nname: ${name}\ndescription:`));
  }
  for (const name of ['knowledge-retrieval', 'coding', 'testing', 'building', 'reviewing']) {
    const text = await fs.readFile(`assets/instructions/${name}.md`, 'utf8');
    assert.ok(text.toLowerCase().startsWith(
      `# ${name.replaceAll('-', ' ')} instructions`));
  }
  const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
  assert.equal(pkg.type, 'module'); assert.ok(!pkg.dependencies);
  const docs = await checkDocumentation();
  assert.deepEqual(docs.diagnostics, [], docs.diagnostics.join('\n'));
  console.log(`Checked ${sources.length} JavaScript modules, 5 skills, 5 focused instructions, 8 hook events, ${docs.files} documentation files and dependency-free package metadata.`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await check();
