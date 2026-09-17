import * as fs from 'node:fs/promises';
import path from 'node:path';
import { canonical, sha256 } from '../standalone/archive.mjs';
import { DIGEST, isPrerelease } from '../standalone/protocol.mjs';

export const PROMPT_FILENAME = 'windows-tester-prompt.md';
export const BINDING_FILENAME = 'windows-tester-prompt.json';
export const INPUT_FILENAME = 'windows-tester-input.json';
const template = await fs.readFile(new URL('./prompt.md.template', import.meta.url), 'utf8');
export const TESTER_TEMPLATE_SHA256 = sha256(Buffer.from(template));

export function validateWindowsTesterInput({ identity, releaseRepository, inventoryDigest, launcherSha256,
  templateSha256, archive } = {}) {
  if (!identity || !/^[a-f0-9]{40}$/u.test(identity.sourceCommit ?? '') ||
      !['payloadSha256', 'descriptorSha256', 'checksumsSha256'].every(key => DIGEST.test(identity[key] ?? '')) ||
      !DIGEST.test(inventoryDigest ?? '') || !DIGEST.test(launcherSha256 ?? '') || templateSha256 !== TESTER_TEMPLATE_SHA256 ||
      !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_][A-Za-z0-9_.-]*$/u.test(releaseRepository ?? '')) {
    throw new Error('T-60 requires the exact final candidate identity and approved release repository');
  }
  isPrerelease(identity.version);
  const filename = `ai-sdlc-framework-${identity.version}-windows-x64.zip`;
  if (archive?.filename !== filename || archive.kind !== 'archive' ||
      !DIGEST.test(archive.sha256 ?? '') || !Number.isSafeInteger(archive.size) || archive.size <= 0) {
    throw new Error('T-60 requires the exact Windows x64 archive record');
  }
  const base = `https://github.com/${releaseRepository}/releases/download/v${encodeURIComponent(identity.version)}`;
  return { schemaVersion: 1, test: 'T-60', target: 'windows-x64',
    contentStatus: 'Complete', nativeExecution: 'NotRun',
    identity, inventoryDigest, launcherSha256, archive, releaseRepository,
    urls: { archive: `${base}/${encodeURIComponent(filename)}`,
      descriptor: `${base}/release-descriptor.json`, checksums: `${base}/SHA256SUMS` },
    templateSha256 };
}

export function renderWindowsTesterPrompt({ readiness, ...input } = {}) {
  const binding = validateWindowsTesterInput(input);
  if (readiness?.installerImplementation !== 'Complete' || readiness.nativeMacosArm64 !== 'Passed' ||
      readiness.nativeHomebrew !== 'Passed' || canonical(readiness.identity) !== canonical(binding.identity)) {
    throw new Error('T-60 generation requires completed implementation and candidate-bound native macOS/Homebrew validation');
  }
  if (template.split('{{binding}}').length !== 2 || template.includes('\r')) {
    throw new Error('T-60 template must be LF-only with exactly one candidate binding');
  }
  const contents = template.replace('{{binding}}', canonical(binding).trimEnd());
  if (/\{\{[^}]+\}\}/u.test(contents)) throw new Error('T-60 contains an unresolved template input');
  return { contents, manifest: { ...binding,
    prompt: { filename: PROMPT_FILENAME, sha256: sha256(Buffer.from(contents)), size: Buffer.byteLength(contents) } } };
}

export async function generateWindowsTesterPrompt({ outputDir, ...input }) {
  const rendered = renderWindowsTesterPrompt(input);
  await fs.mkdir(outputDir, { recursive: true });
  const stat = await fs.lstat(outputDir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (await fs.readdir(outputDir)).length) {
    throw new Error('T-60 output must be a new empty literal directory');
  }
  await fs.writeFile(path.join(outputDir, PROMPT_FILENAME), rendered.contents, { flag: 'wx' });
  await fs.writeFile(path.join(outputDir, BINDING_FILENAME), canonical(rendered.manifest), { flag: 'wx' });
  return validateWindowsTesterPrompt({ outputDir, ...input });
}

export async function validateWindowsTesterPrompt({ outputDir, ...input }) {
  const rendered = renderWindowsTesterPrompt(input);
  const stat = await fs.lstat(outputDir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('T-60 handoff must be a literal directory');
  const entries = await fs.readdir(outputDir, { withFileTypes: true });
  if (entries.some(entry => !entry.isFile()) ||
      canonical(entries.map(entry => entry.name).sort()) !== canonical([PROMPT_FILENAME, BINDING_FILENAME].sort())) {
    throw new Error('T-60 handoff contains missing, extra or nonregular files');
  }
  if (await fs.readFile(path.join(outputDir, PROMPT_FILENAME), 'utf8') !== rendered.contents ||
      await fs.readFile(path.join(outputDir, BINDING_FILENAME), 'utf8') !== canonical(rendered.manifest)) {
    throw new Error('T-60 handoff is stale, nondeterministic or not bound to the final candidate');
  }
  return { test: 'T-60', generationValidation: 'Passed', completionValidation: 'Passed', contentStatus: 'Complete',
    nativeExecution: 'NotRun', identity: rendered.manifest.identity, prompt: rendered.manifest.prompt };
}
