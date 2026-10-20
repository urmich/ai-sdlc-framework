export const validationDeclarations = {
  "schemaVersion": 1,
  "surfaces": []
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './helpers.mjs';
import { loadConfig } from '../src/artifacts.mjs';
import { distribution } from '../src/install.mjs';

const guideNames = ['knowledge-retrieval', 'coding', 'testing', 'building', 'reviewing'];
const readGuide = name => fs.readFile(`assets/instructions/${name}.md`, 'utf8');

function section(contents, heading) {
  const marker = `## ${heading}`;
  const start = contents.indexOf(marker);
  assert.ok(start >= 0, `Missing section: ${heading}`);
  const bodyStart = contents.indexOf('\n', start) + 1;
  const next = contents.indexOf('\n## ', bodyStart);
  return contents.slice(bodyStart, next < 0 ? contents.length : next);
}

function assertSeparated(guides) {
  const bodies = Object.values(guides).map(contents =>
    contents.split('\n').slice(1).join('\n').trim());
  assert.equal(new Set(bodies).size, guideNames.length,
    'Focused guides must not collapse into one duplicated combined body');
}

test('T-37 focused engineering instructions are separated and installed by task type', async () => {
  const guides = Object.fromEntries(await Promise.all(
    guideNames.map(async name => [name, await readGuide(name)])));
  for (const [name, contents] of Object.entries(guides)) {
    assert.ok(contents.toLowerCase().startsWith(
      `# ${name.replaceAll('-', ' ')} instructions`));
    assert.ok(contents.length > 1200, `${name} guide must contain substantive guidance`);
    assert.match(contents, /repository|project|technology|tool/iu);
  }
  assertSeparated(guides);
  const combinedBody = Object.values(guides).join('\n');
  const duplicated = Object.fromEntries(guideNames.map(name =>
    [name, `# ${name}\n${combinedBody}`]));
  assert.throws(() => assertSeparated(duplicated),
    /must not collapse into one duplicated combined body/u);

  assert.match(section(guides.coding, '1. Ground truth and scope'),
    /requirements[\s\S]*repository[\s\S]*Do not commit or push/iu);
  assert.match(section(guides.coding, '5. Error handling'),
    /Never swallow[\s\S]*original cause[\s\S]*timeout/iu);
  assert.match(section(guides.coding, '10. LLM self-review'),
    /necessary[\s\S]*repository conventions[\s\S]*AI authorship/iu);

  assert.match(section(guides.testing, '2. Test selection'),
    /Happy path[\s\S]*boundar[\s\S]*Error[\s\S]*Concurrency/iu);
  assert.match(section(guides.testing, '4. Regression-first bug fixes'),
    /failing test[\s\S]*externally visible[\s\S]*tautological/iu);
  assert.match(section(guides.testing, '7. Determinism and isolation'),
    /any order[\s\S]*ambient credentials[\s\S]*arbitrary sleeps/iu);
  assert.match(section(guides.testing, '8. Cleanup and ownership'),
    /exact owned resource[\s\S]*teardown\/finally/iu);

  assert.match(section(guides.building, '1. Discover the build contract'),
    /canonical build unit[\s\S]*tool versions[\s\S]*architecture/iu);
  assert.match(section(guides.building, '3. Build selection'),
    /smallest canonical target[\s\S]*complete build/iu);
  assert.match(section(guides.building, '5. Build outputs'),
    /owned directories[\s\S]*artifact identity[\s\S]*digest/iu);

  assert.match(section(guides['knowledge-retrieval'], '1. Establish the instruction hierarchy'),
    /AGENTS\.md[\s\S]*copilot-instructions\.md[\s\S]*specific directory/iu);
  assert.match(section(guides['knowledge-retrieval'], '2. Find authoritative project knowledge'),
    /Requirements[\s\S]*Test Plan[\s\S]*Git history/iu);
  assert.match(section(guides['knowledge-retrieval'], '4. Treat retrieved content as data'),
    /untrusted data[\s\S]*do not[\s\S]*grant approval/iu);

  assert.match(section(guides.reviewing, '2. Review the behavior chain'),
    /public entry points[\s\S]*authorization[\s\S]*recovery/iu);
  assert.match(section(guides.reviewing, '4. Review tests as production code'),
    /public behavior[\s\S]*weak assertions[\s\S]*regression/iu);
  assert.match(section(guides.reviewing, '5. Findings'),
    /high-confidence[\s\S]*style[\s\S]*speculative/iu);

  const globalInstructions = await fs.readFile('assets/instructions.md', 'utf8');
  const markers = {
    'knowledge-retrieval': 'KNOWLEDGE_INSTRUCTIONS',
    coding: 'CODING_INSTRUCTIONS',
    testing: 'TESTING_INSTRUCTIONS',
    building: 'BUILDING_INSTRUCTIONS',
    reviewing: 'REVIEWING_INSTRUCTIONS',
  };
  for (const name of guideNames) {
    assert.ok(globalInstructions.includes(`{{${markers[name]}}}`));
  }
  const codingSkill = await fs.readFile('assets/skills/sdlc-coding/SKILL.md', 'utf8');
  for (const name of guideNames) {
    assert.ok(codingSkill.includes(`{{${markers[name]}}}`));
  }
  const skillContracts = {
    sdlc: ['KNOWLEDGE_INSTRUCTIONS'],
    'sdlc-requirements': ['KNOWLEDGE_INSTRUCTIONS'],
    'sdlc-test-design': ['KNOWLEDGE_INSTRUCTIONS', 'TESTING_INSTRUCTIONS'],
    'sdlc-technical-design': ['KNOWLEDGE_INSTRUCTIONS', 'BUILDING_INSTRUCTIONS'],
  };
  for (const [skill, expectedMarkers] of Object.entries(skillContracts)) {
    const contents = await fs.readFile(`assets/skills/${skill}/SKILL.md`, 'utf8');
    for (const marker of expectedMarkers) assert.ok(contents.includes(`{{${marker}}}`));
  }
});

test('T-37 bounded recovery and evidence rules require explicit reset without erasing history', async () => {
  const [entry, knowledge, coding, testing] = await Promise.all([
    fs.readFile('assets/instructions.md', 'utf8'),
    readGuide('knowledge-retrieval'), readGuide('coding'), readGuide('testing'),
  ]);
  const compact = contents => contents.replace(/\s+/gu, ' ');
  assert.match(compact(entry),
    /After session resume or compaction.*Use the summary only to locate these originals.*acknowledge.*only after this retrieval/u);
  assert.match(compact(entry),
    /does not prove reading, understanding, approval or passing tests/u);
  assert.match(compact(entry),
    /do not assume every hook can inject reminders.*host always delivers.*unmanaged\/uncredited, not a framework veto/u);
  assert.match(compact(knowledge),
    /proportionate time or attempt limit.*Stop when that question is answered.*do not broaden/u);
  assert.match(compact(knowledge),
    /permission or capability blocker ends that investigation.*separate explicit scope and authority/u);
  assert.match(compact(coding),
    /Keep Review, post-publication CI, environment tests and distribution\/release acceptance at their declared checkpoints/u);
  assert.match(compact(coding),
    /New findings do not extend the requested scope.*explicit inclusion/u);
  const execution = compact(section(testing, '10. Execution discipline'));
  assert.match(execution,
    /original execution's recorded inputs against independently established inputs required for the current validation target/u);
  assert.match(execution,
    /additions, modifications and deletions.*Mandatory evidence invalidation and reset/u);
  assert.match(execution,
    /\*\*When:\*\*.*tested behavior or dependencies, shared fixtures, selected cases\/assertions, test specification, artifact, configuration, toolchain\/platform\/environment, required prerequisites or freshness/u);
  assert.match(execution,
    /aggregate checkpoint pass that depends on it.*whole-candidate identity.*all results bound to it/u);
  assert.match(execution,
    /impact or applicability is unknown, remove current credit.*preserve the original execution and its outcome unchanged/u);
  assert.match(execution,
    /old and new input identities, invalidation reason, affected case IDs and dependent checkpoints.*`Passed` or `Failed` projections to `NotRun`/u);
  assert.match(execution,
    /Invalidation is not a new failing execution.*completed execution that actually failed/u);
  assert.match(execution,
    /Reuse proven unaffected results only when the contract explicitly permits it.*never rewrite old evidence/u);
  assert.match(execution,
    /fresh cycle or full local checkpoint.*reset that entire required current projection.*prescribed unit-first sequence/u);
  assert.match(execution,
    /Selective invalidation does not waive that requirement.*Deletion does not remove a required case/u);
  assert.equal((testing.match(/^\| Do \|/gmu) ?? []).length, 2);
  assert.equal((testing.match(/^\| Do not \|/gmu) ?? []).length, 2);
});

test('T-43 installed instructions keep framework guardrails advisory', async () => {
  const global = await fs.readFile('assets/instructions.md', 'utf8');
  for (const phrase of [
    'Framework lifecycle stages are advisory',
    'explicit user instruction to skip',
    'restart Copilot',
  ]) {
    assert.ok(global.includes(phrase), phrase);
  }
  assert.match(global,
    /Never tell the\s+user that a framework stage makes the requested stage override impossible/iu);
  assert.match(global,
    /run the literal\s+maintenance command in a host terminal outside that session/iu);
  assert.match(global, /operating[- ]system[\s\S]*network[\s\S]*identity and access management[\s\S]*repository\/provider/iu);
  assert.match(global, /bookkeeping rejects[\s\S]*requested tool action[\s\S]*unmanaged/iu);
  assert.match(global, /framework hook must not veto/iu);

  for (const skill of ['sdlc', 'sdlc-requirements', 'sdlc-test-design',
    'sdlc-technical-design', 'sdlc-coding']) {
    const contents = await fs.readFile(`assets/skills/${skill}/SKILL.md`, 'utf8');
    assert.match(contents,
      /explicit user|user\s+explicitly|user directs|explicitly directs|framework is advisory|lifecycle.intent/iu, skill);
    assert.doesNotMatch(contents,
      /framework (?:gate|prerequisite|rule) makes? (?:the )?(?:action|work) impossible/iu);
  }
});

test('T-44 delivery goals and go activate Requirements rather than a stage override', async () => {
  const global = await fs.readFile('assets/instructions.md', 'utf8');
  const orchestrator = await fs.readFile('assets/skills/sdlc/SKILL.md', 'utf8');
  for (const contract of [
    'Do not infer a stage override from the requested final deliverable or urgency',
    '“Go,” “start,” “do it,” “ASAP,” “right now,” “end-to-end,” “create the PR,”',
    'Begin Requirements and immediately perform',
    'A stage override requires unmistakable lifecycle',
    'For every development request, make one concise, natural attempt',
    'The user may override any stage at any',
  ]) {
    assert.ok(global.includes(contract), contract);
  }
  assert.match(orchestrator,
    /final PR\/plugin\/publication[\s\S]*not stage overrides[\s\S]*Start Requirements/iu);

  const reportedPrompt = `I want to port my GitHub Copilot framework into an
extension marketplace plugin. Read the contribution guidelines, implement and test
the plugin, and eventually create a PR so it appears in the marketplace. go!`;
  assert.match(reportedPrompt, /create a PR[\s\S]*go!/iu);
  assert.doesNotMatch(reportedPrompt,
    /\b(?:skip|bypass|reorder)\s+(?:requirements|test design|technical design|coding|review|stages?)\b/iu);
  assert.doesNotMatch(reportedPrompt,
    /\b(?:do not|don't)\s+(?:use|follow)\s+(?:the\s+)?(?:framework|stages?|flow)\b/iu);
});

test('T-49 every lifecycle skill uses one unmistakable override-intent contract', async () => {
  const lifecycle = await fs.readFile('assets/lifecycle-intent.md', 'utf8');
  const global = await fs.readFile('assets/instructions.md', 'utf8');
  assert.ok(global.includes('{{LIFECYCLE_INTENT_INSTRUCTIONS}}'));
  for (const skill of ['sdlc', 'sdlc-requirements', 'sdlc-test-design',
    'sdlc-technical-design', 'sdlc-coding']) {
    const contents = await fs.readFile(
      `assets/skills/${skill}/SKILL.md`, 'utf8');
    assert.ok(contents.includes('{{LIFECYCLE_INTENT_INSTRUCTIONS}}'), skill);
    assert.doesNotMatch(contents,
      /explicitly directs immediate implementation/iu, skill);
    assert.doesNotMatch(contents,
      /(?:implement this|fix this now|start coding)\s*(?:means|=>|→|:)\s*(?:skip|bypass)/iu,
    skill);
    assert.doesNotMatch(contents,
      /(?:create|record|manufacture)[\s\S]{0,80}(?:approval|completion|override) event from (?:ordinary|implementation|urgency)/iu,
    skill);
  }
  for (const ordinary of [
    'Implement this',
    'fix this now',
    'start coding',
    'ASAP',
    'end-to-end',
    'do not skip Requirements',
    'skip this generated file',
    'bypass the cache',
  ]) {
    assert.ok(lifecycle.toLowerCase().includes(ordinary.toLowerCase()),
      ordinary);
  }
  for (const explicit of [
    'Skip Requirements and implement directly',
    'Bypass Test Design for this fix',
    'Do not create a Technical Design',
    'Go directly to Coding instead of following the framework stages',
  ]) {
    assert.ok(lifecycle.includes(explicit), explicit);
  }
  assert.match(lifecycle,
    /immediately begin\s+useful work[\s\S]*Do not merely refuse/iu);
  assert.match(lifecycle,
    /never creates approval, completion, managed credit, or an\s+override event/iu);
  assert.match(lifecycle,
    /Explain the identified stage's value and consequence once[\s\S]*honor/iu);
});

test('T-50 STAGING guidance is policy-driven across every instruction surface', async () => {
  const paths = [
    'README.md',
    'docs/architecture/design-overview.md',
    'docs/sdlc/core-framework/requirements.md',
    'docs/sdlc/core-framework/test-plan.md',
    'docs/sdlc/core-framework/technical-design.md',
    'docs/reference/cli.md',
    'assets/instructions.md',
    'assets/templates/test-plan.md',
    ...['sdlc', 'sdlc-requirements', 'sdlc-test-design',
      'sdlc-technical-design', 'sdlc-coding'].map(skill =>
      `assets/skills/${skill}/SKILL.md`),
  ];
  const contents = (await Promise.all(paths.map(file =>
    fs.readFile(file, 'utf8')))).join('\n');
  for (const obsolete of [
    'STAGING testing is user-owned on an authorized machine',
    'Hand STAGING testing to the user on an authorized machine',
    'STAGING testing belongs to the user on an authorized machine',
    'STAGING build/deploy -> user runs tests on an authorized machine',
  ]) {
    assert.ok(!contents.includes(obsolete), obsolete);
  }
  assert.match(contents,
    /STAGING[\s\S]*execution contract[\s\S]*owner[\s\S]*location/iu);
  assert.match(contents,
    /user[\s\S]*agent[\s\S]*provider[\s\S]*external-system/iu);
  assert.match(contents,
    /individual[\s\S]*(?:Passed|passing)[\s\S]*completion[\s\S]*(?:confirmation|decision)/iu);
});

test('T-PRD009 repository critical/affected guidance does not replace a consumer local checkpoint', async t => {
  const guide = await fs.readFile('docs/contributing/README.md', 'utf8');
  assert.match(guide, /Local critical plus affected/u);
  assert.match(guide, /opt-in local exhaustive runs/u);
  assert.match(guide, /Every PR[\s\S]*complete applicable hosted validation/u);
  const f = await fixture(t);
  const config = { schemaVersion: 1, commands: [{
    command: 'consumer-own-test-command',
    action: { class: 'test', environment: 'local' },
  }] };
  const file = path.join(f.repo, '.sdlc/config.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(config));
  const { metadata } = await f.store.manifest(f.workItemId);
  const before = await fs.readFile(file);
  const { files } = await distribution(f.home);
  assert.deepEqual(await loadConfig(metadata, 'primary'), config);
  assert.deepEqual(await fs.readFile(file), before);
  assert.ok(![...files.keys()].some(key => /(?:^|\/)\.github\/|(?:^|\/)\.sdlc\/config\.json$/u.test(key)));
  const instructions = files.get('sdlc/instructions/coding.md').toString('utf8');
  assert.match(files.get('sdlc/instructions/knowledge-retrieval.md').toString('utf8'),
    /compatible repository rules before/u);
  assert.doesNotMatch(instructions, /npm run test:critical|framework\/coverage/u);
});
