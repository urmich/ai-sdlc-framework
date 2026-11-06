import * as fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonical, sha256 } from '../packaging/standalone/archive.mjs';
import { options, releaseIntent, releaseRepository, trustedEnvironment, verifyBundle } from './release-bundle.mjs';

export const releaseConsumerTargets = Object.freeze(['windows-x64', 'macos-arm64', 'macos-x64']);
const numeric = value => /^[1-9]\d*$/u.test(value ?? '');
const hash = value => /^[a-f0-9]{64}$/u.test(value ?? '');

function exactStart(environment, identity) {
  if (environment.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
      environment.GITHUB_REPOSITORY !== 'urmich/ai-sdlc-framework' ||
      environment.GITHUB_REF !== 'refs/heads/main' || environment.GITHUB_SHA !== identity.sourceCommit ||
      environment.GITHUB_WORKFLOW_REF !== 'urmich/ai-sdlc-framework/.github/workflows/release.yml@refs/heads/main' ||
      !numeric(environment.GITHUB_RUN_ID) || !numeric(environment.GITHUB_RUN_ATTEMPT)) {
    throw new Error('Acceptance belongs only to the identified maintainer release invocation, not another caller/source');
  }
}

export function admitAcceptanceHandoff(value, { environment = process.env, expectedBundleSha256,
  expectedSourceCommit, expectedReleaseIntentId } = {}) {
  if (typeof value === 'string') {
    if (Buffer.byteLength(value) > 32 * 1024) throw new Error('Acceptance handoff exceeds its data budget');
    value = JSON.parse(value);
  }
  if (!value || value.schemaVersion !== 1 || value.kind !== 'release-acceptance-handoff' ||
      !hash(value.bundle?.sha256) || !numeric(value.bundle.artifactId) || !numeric(value.bundle.sourceRunId) ||
      !numeric(value.publication?.releaseId) || value.publication.status !== 'Published' ||
      !hash(value.evidence?.sha256) || typeof value.evidence.filename !== 'string' ||
      !/^release-prepublication-[A-Za-z0-9_-]+-[a-f0-9]{64}\.tar\.gz$/u.test(value.evidence.filename) ||
      !value.evidence.filename.endsWith(`-${value.evidence.sha256}.tar.gz`) ||
      !/^[a-f0-9]{40}$/u.test(value.identity?.sourceCommit ?? '') ||
      !['payloadSha256', 'descriptorSha256', 'checksumsSha256'].every(key => hash(value.identity[key])) ||
      !/^\d+\.\d+\.\d+$/u.test(value.previous?.version ?? '') ||
      value.previous.version === value.identity.version ||
      !hash(value.previous.descriptorSha256) || !hash(value.previous.checksumsSha256) ||
      canonical(value.requiredTargets) !== canonical(releaseConsumerTargets)) {
    throw new Error('Acceptance requires exact saved bundle/publication/provenance/previous-release identities');
  }
  releaseIntent(value.releaseIntentId);
  releaseRepository(value.releaseRepository);
  exactStart(environment, value.identity);
  if (value.invocation.runId !== environment.GITHUB_RUN_ID || value.invocation.attempt !== environment.GITHUB_RUN_ATTEMPT ||
      expectedBundleSha256 && value.bundle.sha256 !== expectedBundleSha256 ||
      expectedSourceCommit && value.identity.sourceCommit !== expectedSourceCommit ||
      expectedReleaseIntentId && value.releaseIntentId !== expectedReleaseIntentId) {
    throw new Error('Acceptance handoff cannot be reused for a different physical or logical release selection');
  }
  return structuredClone(value);
}

export async function prepareAcceptanceHandoff({ directory, publicationFile, bundleArtifactId, sourceRunId,
  evidenceFilename, evidenceSha256, previousVersion, previousDescriptorSha256, previousChecksumsSha256,
  environment = process.env, verifyEvidence, ...expected }) {
  const bundle = await verifyBundle({ directory, verifyEvidence, ...expected });
  const publication = JSON.parse(await fs.readFile(publicationFile, 'utf8'));
  if (publication.github?.status !== 'Published' || canonical(publication.identity) !== canonical(bundle.identity) ||
      publication.releaseIntentId !== bundle.releaseIntentId || publication.npm?.status !== 'PublishedBytesVerified') {
    throw new Error('Public asset and npm effects must be confirmed before scheduling acceptance');
  }
  if (bundle.context.previousRelease?.version !== previousVersion ||
      bundle.context.previousRelease.descriptorSha256 !== previousDescriptorSha256 ||
      bundle.context.previousRelease.checksumsSha256 !== previousChecksumsSha256) {
    throw new Error('Acceptance must use the authentic previous release pins frozen before native validation');
  }
  return admitAcceptanceHandoff({
    schemaVersion: 1, kind: 'release-acceptance-handoff', identity: bundle.identity,
    releaseRepository: bundle.releaseRepository, releaseIntentId: bundle.releaseIntentId,
    invocation: { runId: environment.GITHUB_RUN_ID, attempt: environment.GITHUB_RUN_ATTEMPT },
    bundle: { artifactId: bundleArtifactId, sourceRunId, sha256: expected.expectedBundleSha256 ??
      sha256(await fs.readFile(path.join(directory, 'bundle.json'))) },
    publication: { releaseId: String(publication.github.releaseId), status: publication.github.status },
    evidence: { filename: evidenceFilename, sha256: evidenceSha256 },
    previous: { version: previousVersion, descriptorSha256: previousDescriptorSha256, checksumsSha256: previousChecksumsSha256 },
    requiredTargets: [...releaseConsumerTargets],
  }, { environment, expectedBundleSha256: expected.expectedBundleSha256,
    expectedSourceCommit: expected.sourceCommit, expectedReleaseIntentId: expected.releaseIntentId });
}

export async function runReleaseAcceptance({ handoff, target, directory, outputFile,
  environment = process.env, consumer, ...expected }) {
  const admitted = admitAcceptanceHandoff(handoff, { environment,
    expectedBundleSha256: expected.expectedBundleSha256, expectedSourceCommit: expected.sourceCommit,
    expectedReleaseIntentId: expected.releaseIntentId });
  if (!releaseConsumerTargets.includes(target)) throw new Error('Acceptance must execute every declared native consumer target');
  consumer ??= (await import('./accept-release.mjs')).acceptRelease;
  const result = await consumer({
    directory, outputFile, target, expectedBundleSha256: admitted.bundle.sha256,
    sourceCommit: admitted.identity.sourceCommit, releaseIntentId: admitted.releaseIntentId,
    previousVersion: admitted.previous.version, previousDescriptorSha256: admitted.previous.descriptorSha256,
    previousChecksumsSha256: admitted.previous.checksumsSha256,
    evidenceFilename: admitted.evidence.filename, evidenceSha256: admitted.evidence.sha256,
  });
  if (!result || result.target !== target || canonical(result.identity) !== canonical(admitted.identity) ||
      result.releaseIntentId !== admitted.releaseIntentId ||
      result.run?.id !== admitted.invocation.runId || result.run?.attempt !== admitted.invocation.attempt) {
    throw new Error('Acceptance returned a missing or misbound physical execution handle');
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const command = { prepare: prepareAcceptanceHandoff, consume: runReleaseAcceptance }[process.argv[2]];
  if (!command) throw new Error('Expected prepare or consume');
  const result = await command({ ...options(process.argv.slice(3)), ...trustedEnvironment() });
  if (process.argv[2] === 'prepare' && process.env.GITHUB_OUTPUT) {
    await fs.appendFile(process.env.GITHUB_OUTPUT, `handoff=${canonical(result).trimEnd()}\n`);
  }
  console.log(JSON.stringify(result));
  if (process.argv[2] === 'consume' && result.status !== 'Passed') process.exitCode = result.status === 'Failed' ? 1 : 2;
}
