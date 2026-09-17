import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const FORMULAS = {
  stable: 'stable-ai-sdlc-framework.rb',
  candidate: 'Formula/ai-sdlc-framework.rb',
  upgrade: 'upgraded-ai-sdlc-framework.rb',
};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export async function homebrewFormulaEvidence(root, kind) {
  if (!Object.hasOwn(FORMULAS, kind)) throw new Error(`Unknown Homebrew formula evidence kind: ${kind}`);
  const file = path.join(root, FORMULAS[kind]);
  if (!(await fs.lstat(file)).isFile()) throw new Error(`Formula evidence must be a regular file: ${file}`);
  const bytes = await fs.readFile(file);
  return { kind, path: FORMULAS[kind], sha256: sha256(bytes), size: bytes.length };
}

/** Read exact saved formula bytes, never regenerate a candidate's ephemeral URL. */
export async function readHomebrewRunEvidence(root) {
  const directory = path.resolve(root);
  const evidenceFile = path.join(directory, 'evidence.json');
  const bytes = await fs.readFile(evidenceFile);
  const evidence = JSON.parse(bytes);
  if (evidence.passed !== true || !evidence.formulas?.candidate || !evidence.formulas?.upgrade) {
    throw new Error('A passing native run with candidate and upgrade formula identities is required');
  }
  const formulas = {};
  for (const [kind, expected] of Object.entries(evidence.formulas)) {
    const actual = await homebrewFormulaEvidence(directory, kind);
    if (expected.kind !== kind || expected.path !== actual.path ||
        expected.sha256 !== actual.sha256 || expected.size !== actual.size) {
      throw new Error(`Native run formula identity mismatch: ${kind}`);
    }
    formulas[kind] = actual;
  }
  if (formulas.stable && evidence.formulaMetadataSha256 !== formulas.stable.sha256) {
    throw new Error('Stable metadata digest does not match the cited run');
  }
  for (const command of evidence.commands ?? []) {
    if (!command.formula) continue;
    const actual = formulas[command.formula.kind];
    if (!actual || command.formula.path !== actual.path ||
        command.formula.sha256 !== actual.sha256 || command.formula.size !== actual.size) {
      throw new Error('Homebrew command evidence is bound to a different formula');
    }
  }
  return { directory, evidenceFile, evidenceSha256: sha256(bytes), formulas, evidence };
}
