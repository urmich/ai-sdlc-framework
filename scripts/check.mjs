import * as fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
const execute = promisify(execFile);
async function files(directory) {
  const paths = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await files(file));
    else paths.push(file);
  }
  return paths;
}
const sources = (await Promise.all(['src', 'bin', 'scripts', 'test'].map(files))).flat().filter(file => file.endsWith('.mjs'));
for (const file of sources) await execute(process.execPath, ['--check', file]);
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
console.log(`Checked ${sources.length} JavaScript modules, 5 skills, 5 focused instructions, 8 hook events and dependency-free package metadata.`);
