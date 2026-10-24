import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { canonical, sha256 } from '../packaging/standalone/archive.mjs';
import { isPrerelease, payloadIdentity } from '../packaging/standalone/protocol.mjs';
import { ROOT, emptyDirectory, options, requirePublicationReady, trustedEnvironment, verifyBundle, writeJson } from './release-bundle.mjs';
import { collectPublicationAttempts } from './release-history.mjs';
import { immutablePublicationBinding } from './release-history.mjs';
import { sanitizeExecutionPayload } from 'ai-sdlc-framework/evidence';

export const NPM_TRUST = Object.freeze({ repository: 'urmich/ai-sdlc-framework',
  callerFile: 'release.yml', publishingFile: 'npm-publish.yml', environment: 'npm' });

export async function npmHandoffFromVerifiedBundle({ directory, bundle, sourceRepository, bundleSha256 }) {
  requirePublicationReady(bundle);
  if (sourceRepository !== NPM_TRUST.repository) throw new Error('npm handoff must use the configured trusted source repository');
  const artifact = path.join(directory, 'assets', bundle.descriptor.payload.filename);
  const bytes = await fs.readFile(artifact);
  const { entries, manifest } = payloadIdentity(bytes);
  const pkg = JSON.parse(entries.find(entry => entry.path === 'package/package.json').data);
  if (pkg.repository?.url !== `https://github.com/${sourceRepository}.git` ||
      pkg.name !== 'ai-sdlc-framework' || pkg.version !== bundle.identity.version ||
      sha256(bytes) !== bundle.identity.payloadSha256 ||
      canonical(pkg.publishConfig) !== canonical({ access: 'public', registry: 'https://registry.npmjs.org' })) {
    throw new Error('npm package identity, registry or publication configuration differs from the trusted handoff');
  }
  return { schemaVersion: 1, sourceRepository, sourceCommit: bundle.identity.sourceCommit,
    bundleSha256, packageName: pkg.name, version: pkg.version, filename: manifest.payload.filename,
    sha256: sha256(bytes), size: bytes.length,
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    distTag: isPrerelease(pkg.version) ? 'next' : 'latest' };
}

export async function verifyPublishingTools({ outputDir, environment = process.env }) {
  if (process.platform !== 'linux' || process.arch !== 'x64' || process.versions.node !== '24.22.0') {
    throw new Error('Publishing prerequisites require the exact native Linux Node 24.22.0 baseline');
  }
  if (Object.keys(environment).some(key => /^(?:node_auth_token|npm_token|npm_auth_token|npm_id_token)$/iu.test(key) ||
      /^npm_config_/iu.test(key) && /auth|token/iu.test(key))) throw new Error('Pre-supplied npm credentials are forbidden; no token fallback');
  const root = path.resolve(outputDir);
  const relative = path.relative(path.join(ROOT, '.test-data'), root);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Publishing tool preflight requires owned project-local scratch');
  await emptyDirectory(root);
  const env = Object.fromEntries(Object.entries(environment).filter(([key]) =>
    !/token|credential|password|secret|auth|^npm_|^node_options$|^node_path$/iu.test(key)));
  Object.assign(env, { HOME: path.join(root, 'home'), NPM_CONFIG_CACHE: path.join(root, 'cache'),
    NPM_CONFIG_USERCONFIG: path.join(root, 'user.npmrc'), NPM_CONFIG_GLOBALCONFIG: path.join(root, 'global.npmrc'),
    NPM_CONFIG_IGNORE_SCRIPTS: 'true', NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org' });
  await fs.mkdir(env.HOME);
  await fs.mkdir(env.NPM_CONFIG_CACHE);
  await fs.writeFile(env.NPM_CONFIG_USERCONFIG, 'registry=https://registry.npmjs.org/\nignore-scripts=true\n', { flag: 'wx' });
  await fs.writeFile(env.NPM_CONFIG_GLOBALCONFIG, '', { flag: 'wx' });
  const { pinnedNpmTool } = await import('./accept-release.mjs');
  const tool = await pinnedNpmTool({ root, environment: env });
  const config = JSON.parse((await promisify(execFile)(tool.command, [...tool.prefix, 'config', 'list', '--json'],
    { env, cwd: root, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 })).stdout);
  if (Object.entries(config).some(([key, value]) =>
    /(?:^|:)(?:_auth(?:token)?|_password|username|password|cert(?:file)?|key(?:file)?)$/iu.test(key) &&
      value !== null && value !== undefined && value !== '') ||
      config['ignore-scripts'] !== true || !['https://registry.npmjs.org', 'https://registry.npmjs.org/'].includes(config.registry)) {
    throw new Error('Effective pinned publication tooling configuration is not token-free and script-disabled');
  }
  const result = { schemaVersion: 1, status: 'Passed', node: process.versions.node,
    npm: tool.version, integrity: tool.integrity, scripts: 'Disabled', credentials: 'Absent',
    sourceCommit: environment.EXPECTED_SOURCE_COMMIT, publication: 'NotRun' };
  await writeJson(path.join(root, 'tooling.json'), result);
  return result;
}

export async function prepareNpmHandoff({ directory, sourceRepository, expectedBundleSha256,
  bundleArtifactId, bundleArtifactDigest, sourceRunId, evidenceArtifactId, evidenceArtifactDigest,
  readinessFile, publicationHistoryDir, environment = process.env, api, ...expected }) {
  if (!/^[a-f0-9]{64}$/u.test(expectedBundleSha256 ?? '')) throw new Error('npm handoff requires the saved immutable bundle digest');
  const bundle = await verifyBundle({ directory, expectedBundleSha256, api, sourceRepository, ...expected });
  const base = await npmHandoffFromVerifiedBundle({ directory, bundle, sourceRepository, bundleSha256: expectedBundleSha256 });
  const normalizeDigest = value => /^[a-f0-9]{64}$/u.test(value ?? '') ? `sha256:${value}` : value;
  bundleArtifactDigest = normalizeDigest(bundleArtifactDigest);
  evidenceArtifactDigest = normalizeDigest(evidenceArtifactDigest);
  if (![bundleArtifactId, sourceRunId, evidenceArtifactId, environment.GITHUB_RUN_ID, environment.GITHUB_RUN_ATTEMPT]
    .every(value => /^[1-9]\d*$/u.test(value ?? '')) ||
      ![bundleArtifactDigest, evidenceArtifactDigest].every(value => /^sha256:[a-f0-9]{64}$/u.test(value ?? ''))) {
    throw new Error('Protected publication requires exact saved artifact IDs/digests and physical verifier origin');
  }
  const readinessBytes = await fs.readFile(readinessFile);
  const readiness = JSON.parse(readinessBytes);
  if (readiness.profile !== 'r-pre' || readiness.status !== 'Passed' ||
      readiness.bundleSha256 !== expectedBundleSha256 || readiness.releaseIntentId !== bundle.releaseIntentId ||
      canonical(readiness.identity) !== canonical(bundle.identity)) {
    throw new Error('Readiness must reference the completed immutable bundle without circular hashing');
  }
  const releaseBinding = { releaseRepository: bundle.releaseRepository,
    descriptorSha256: bundle.identity.descriptorSha256, checksumsSha256: bundle.identity.checksumsSha256 };
  api ??= (await import('./publish-release.mjs')).githubRequest;
  const input = { ...base, releaseIntentId: bundle.releaseIntentId, releaseBinding };
  const originals = { schemaVersion: 1, kind: 'npm-publication-history-originals',
    binding: immutablePublicationBinding(input), complete: false, originals: [] };
  if (publicationHistoryDir) await emptyDirectory(publicationHistoryDir);
  let retainedBytes = 0;
  let publicationRecovery;
  try {
    publicationRecovery = await collectPublicationAttempts({ api, sourceRepository, handoff: input,
      ...(publicationHistoryDir ? { retainOriginal: async ({ artifact, member, value }) => {
        const safe = sanitizeExecutionPayload(Buffer.from(JSON.stringify(value)));
        if (canonical(safe.binding) !== canonical(value.binding) || canonical(safe.run) !== canonical(value.run)) {
          throw new Error('Sanitization must not rewrite original publication identity or physical attempt');
        }
        const record = { artifact, member, originalSemanticSha256: sha256(Buffer.from(canonical(value))),
          retainedSemanticSha256: sha256(Buffer.from(canonical(safe))), value: safe };
        const bytes = Buffer.from(canonical(record));
        if (bytes.length > 4 * 1024 * 1024 || originals.originals.length >= 128 ||
            retainedBytes + bytes.length > 64 * 1024 * 1024) {
          throw new Error('Complete original publication diagnostics exceed the existing bounded host retention capacity; reconcile before another irreversible effect');
        }
        const filename = `npm-history-${artifact.id}.json`;
        await fs.writeFile(path.join(publicationHistoryDir, filename), bytes, { flag: 'wx' });
        retainedBytes += bytes.length;
        originals.originals.push({ filename, sha256: sha256(bytes), size: bytes.length, artifact, member });
      } } : {}) });
    originals.complete = true;
  } finally {
    if (publicationHistoryDir) await writeJson(path.join(publicationHistoryDir, 'npm-publication-history.json'), originals);
  }
  const result = { ...base, schemaVersion: 2, releaseIntentId: bundle.releaseIntentId, releaseBinding, publicationRecovery,
    readinessSha256: sha256(readinessBytes),
    artifactOrigin: { bundleArtifactId, bundleArtifactDigest, sourceRunId, evidenceArtifactId, evidenceArtifactDigest },
    verifierOrigin: { runId: environment.GITHUB_RUN_ID, attempt: environment.GITHUB_RUN_ATTEMPT,
      workflowRef: environment.GITHUB_WORKFLOW_REF, job: 'npm-readiness' } };
  if (Buffer.byteLength(canonical(result)) > 32 * 1024) throw new Error('Complete publication recovery exceeds the bounded handoff; retain originals and reconcile explicitly, never truncate history');
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const preflight = process.argv[2] === 'preflight';
  const result = await (preflight ? verifyPublishingTools : prepareNpmHandoff)({
    ...options(process.argv.slice(preflight ? 3 : 2)), ...trustedEnvironment() });
  if (!preflight && process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `handoff=${canonical(result).trimEnd()}\n`);
  console.log(JSON.stringify({ ...result, trust: NPM_TRUST, publication: 'NotRun' }, null, 2));
}
