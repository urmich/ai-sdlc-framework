import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { canonical, sha256 } from '../packaging/standalone/archive.mjs';
import { isPrerelease, payloadIdentity } from '../packaging/standalone/protocol.mjs';
import { options, requirePublicationReady, trustedEnvironment, verifyBundle } from './release-bundle.mjs';

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

export async function prepareNpmHandoff({ directory, sourceRepository, expectedBundleSha256, ...expected }) {
  if (!/^[a-f0-9]{64}$/u.test(expectedBundleSha256 ?? '')) throw new Error('npm handoff requires the saved immutable bundle digest');
  const bundle = await verifyBundle({ directory, expectedBundleSha256, ...expected });
  return npmHandoffFromVerifiedBundle({ directory, bundle, sourceRepository, bundleSha256: expectedBundleSha256 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await prepareNpmHandoff({ ...options(process.argv.slice(2)), ...trustedEnvironment() });
  if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `handoff=${canonical(result).trimEnd()}\n`);
  console.log(JSON.stringify({ ...result, trust: NPM_TRUST, publication: 'NotRun' }, null, 2));
}
