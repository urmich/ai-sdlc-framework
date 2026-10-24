export const validationDeclarations = {
  "schemaVersion": 1,
  "surfaces": [{"coverage": "direct", "paths": ["scripts/verify-github-acceptance.mjs"]}]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { verifyAcceptance } from '../scripts/verify-github-acceptance.mjs';

function fixture() {
  const requirements = '## FR-140: Observable requirement\n**Definition of Done**\n- AC-140.1: Admit exact evidence.\n';
  const plan = `| ID | Requirements | Environment | Level | Checkpoint | Mode | Owner | Location | Expected Outcome | Implementation | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-GHC01-P | FR-140; AC-140.1 | local | unit | pre-review | automated | agent | local | Exact proof admits | test/actual.test.mjs: exact assertion | NotRun |`;
  const context = { candidateDigest: 'candidate-a', testSpecDigest: 'spec-a', configDigest: 'config-a' };
  const selector = { file: 'test/actual.test.mjs', name: 'exact assertion' };
  const bindings = [{ id: 'T-GHC01-P', kind: 'assertions', selectors: [selector] }];
  const reports = [{ context: { ...context }, platform: 'win32', architecture: 'x64',
    files: [selector.file], executions: [{ ...selector, status: 'Passed' }],
    summary: { success: true, counts: { tests: 1, failed: 0, cancelled: 0, todo: 0 } } }];
  return { requirements, plan, context, bindings, reports };
}

test('T-GHB24 requirement acceptance uses exact executable assertions and current evidence, not suite totals', () => {
  const input = fixture();
  const result = verifyAcceptance(input);
  assert.deepEqual(result.counts, { Passed: 1, Failed: 0, NotRun: 0 });
  assert.equal(result.requirements, 1);
  assert.equal(result.conditions, 1);
  for (const mutation of [
    value => { value.reports[0].executions[0].status = 'Skipped'; },
    value => { value.reports[0].executions[0].name = 'different assertion'; },
    value => { value.reports = []; },
  ]) {
    const changed = structuredClone(input);
    mutation(changed);
    assert.deepEqual(verifyAcceptance(changed).counts, { Passed: 0, Failed: 0, NotRun: 1 });
  }
  for (const mutation of [
    value => { value.bindings.push(structuredClone(value.bindings[0])); },
    value => { value.bindings[0].id = 'T-orphan'; },
    value => { value.bindings = []; },
    value => { value.plan = value.plan.replace('AC-140.1', 'AC-140.2'); },
  ]) {
    const changed = structuredClone(input);
    mutation(changed);
    assert.throws(() => verifyAcceptance(changed), { code: 'COVERAGE' });
  }
  for (const mutation of [
    value => { value.reports[0].context.candidateDigest = 'old'; },
    value => { value.reports[0].context.testSpecDigest = 'old'; },
    value => { value.reports[0].context.configDigest = 'old'; },
  ]) {
    const changed = structuredClone(input);
    mutation(changed);
    assert.throws(() => verifyAcceptance(changed), { code: 'STALE' });
  }
  for (const mutation of [
    value => { value.reports[0].summary.success = false; },
    value => { value.reports[0].summary.counts.tests = 2; },
    value => { value.reports[0].executions.push(structuredClone(value.reports[0].executions[0])); value.reports[0].summary.counts.tests = 2; },
  ]) {
    const changed = structuredClone(input);
    mutation(changed);
    assert.throws(() => verifyAcceptance(changed), { code: 'EVIDENCE' });
  }
});

test('T-GHB24 conditional CI and Review cannot inherit local assertion success', () => {
  const input = fixture();
  input.bindings[0] = { id: 'T-GHC01-P', kind: 'ci', command: 'gh run view exact-run --attempt 1' };
  assert.equal(verifyAcceptance(input).cases[0].status, 'NotRun');
  input.gates = [{ id: 'T-GHC01-P', command: input.bindings[0].command,
    context: input.context, status: 'Passed', exitCode: 0, expectedMet: false }];
  assert.equal(verifyAcceptance(input).cases[0].status, 'NotRun');
  input.gates[0].expectedMet = true;
  assert.equal(verifyAcceptance(input).cases[0].status, 'Passed');
  input.gates[0].exitCode = 1;
  assert.equal(verifyAcceptance(input).cases[0].status, 'NotRun');
});

test('T-GHB24 canonical plan binds every condition, Azure baseline and result family without awarding unexecuted credit', async () => {
  const directory = path.resolve('docs', 'sdlc', 'github-integration');
  const [requirements, plan, contents] = await Promise.all([
    fs.readFile(path.join(directory, 'requirements.md'), 'utf8'),
    fs.readFile(path.join(directory, 'test-plan.md'), 'utf8'),
    fs.readFile(path.join(directory, 'acceptance-bindings.json'), 'utf8'),
  ]);
  const manifest = JSON.parse(contents);
  const result = verifyAcceptance({ requirements, plan, bindings: manifest.bindings,
    context: { candidateDigest: 'unexecuted', testSpecDigest: 'unexecuted', configDigest: 'unexecuted' } });
  assert.equal(result.requirements, 12);
  assert.equal(result.conditions, 50);
  assert.equal(result.planned, 133);
  assert.deepEqual(result.counts, { Passed: 0, Failed: 0, NotRun: 133 });
  assert.deepEqual(manifest.azureBaselines.map(item => item.id),
    Array.from({ length: 24 }, (_, index) => `ADO-${String(index + 1).padStart(2, '0')}`));
  assert.deepEqual(manifest.resultFamilies.map(item => item.family), [
    'execution', 'test', 'artifact', 'deployment', 'pull-request', 'git-ref',
    'merge', 'policy', 'notification',
  ]);
  for (const item of [...manifest.azureBaselines, ...manifest.resultFamilies]) {
    assert.ok(item.cases.length > 0);
    assert.ok(item.cases.every(id => manifest.bindings.some(binding => binding.id === id)));
  }
  const root = path.resolve('test');
  for (const binding of manifest.bindings.filter(item => item.kind === 'assertions')) {
    for (const selector of binding.selectors) {
      const file = path.resolve(selector.file);
      const relative = path.relative(root, file);
      assert.ok(relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
      assert.ok((await fs.lstat(file)).isFile());
    }
  }
});
