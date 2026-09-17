import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { homebrewFormulaEvidence, readHomebrewRunEvidence } from '../packaging/homebrew/evidence.mjs';

async function fixture(t, port) {
  const root = path.resolve('.test-data', `homebrew-evidence-${randomUUID()}`);
  await fs.mkdir(path.join(root, 'Formula'), { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const candidate = `url "http://127.0.0.1:${port}/candidate.tar.gz"\n`;
  await fs.writeFile(path.join(root, 'Formula', 'ai-sdlc-framework.rb'), candidate);
  await fs.writeFile(path.join(root, 'upgraded-ai-sdlc-framework.rb'), `${candidate}revision 1\n`);
  await fs.writeFile(path.join(root, 'stable-ai-sdlc-framework.rb'), 'url "https://example.com/v0.3.0/archive.tar.gz"\n');
  const formulas = {};
  for (const kind of ['stable', 'candidate', 'upgrade']) formulas[kind] = await homebrewFormulaEvidence(root, kind);
  const evidence = { passed: true, formulas, formulaMetadataSha256: formulas.stable.sha256,
    commands: [
      { args: ['install', 'local/test/formula'], formula: formulas.candidate, success: true },
      { args: ['install', 'local/test/formula'], formula: formulas.upgrade, success: true },
    ] };
  await fs.writeFile(path.join(root, 'evidence.json'), JSON.stringify(evidence));
  return { root, evidence };
}

test('T-51 handoff identities come from each exact native run and command formula', async t => {
  const first = await fixture(t, 8123);
  const second = await fixture(t, 9456);
  const result = await readHomebrewRunEvidence(first.root);
  assert.deepEqual(result.formulas, first.evidence.formulas);
  assert.notEqual(result.formulas.candidate.sha256,
    (await readHomebrewRunEvidence(second.root)).formulas.candidate.sha256);
  assert.notEqual(result.formulas.candidate.sha256, result.formulas.upgrade.sha256);
  assert.equal(result.evidenceSha256, createHash('sha256')
    .update(await fs.readFile(path.join(first.root, 'evidence.json'))).digest('hex'));
});

test('T-51 handoff rejects stale hashes, changed bytes, and another runs candidate', async t => {
  for (const mutation of ['hash', 'bytes', 'command', 'other-run']) {
    const current = await fixture(t, 8123);
    if (mutation === 'hash') current.evidence.formulas.upgrade.sha256 = '0'.repeat(64);
    if (mutation === 'bytes') await fs.appendFile(path.join(current.root, 'Formula', 'ai-sdlc-framework.rb'), '# changed\n');
    if (mutation === 'command') current.evidence.commands[0].formula = {
      ...current.evidence.formulas.candidate, sha256: '0'.repeat(64),
    };
    if (mutation === 'other-run') current.evidence.formulas.candidate = (await fixture(t, 9456)).evidence.formulas.candidate;
    await fs.writeFile(path.join(current.root, 'evidence.json'), JSON.stringify(current.evidence));
    await assert.rejects(readHomebrewRunEvidence(current.root), /mismatch|different formula/u);
  }
});

test('T-51 handoff rejects incomplete run or unsupported formula identity', async t => {
  const current = await fixture(t, 8123);
  current.evidence.passed = false;
  await fs.writeFile(path.join(current.root, 'evidence.json'), JSON.stringify(current.evidence));
  await assert.rejects(readHomebrewRunEvidence(current.root), /passing native run/u);
  await assert.rejects(homebrewFormulaEvidence(current.root, '../escape'), /Unknown Homebrew/u);
});
