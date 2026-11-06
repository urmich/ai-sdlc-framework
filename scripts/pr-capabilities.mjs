import * as fs from 'node:fs/promises';
import path from 'node:path';
import { requireThat } from '../src/core.mjs';
import { sha256 } from '../packaging/standalone/archive.mjs';
import { pinnedNpmTool } from './accept-release.mjs';
import { verifyRetainedNpmAttestation } from './verify-npm-attestation.mjs';

// Public verification material only. These pins do not confer signing authority.
export const prCryptoFixture = Object.freeze({
  bundle: Object.freeze({
    url: 'https://raw.githubusercontent.com/sigstore/sigstore-js/769a53d8713248a8bf49edfc2a5d1955b0dcc24d/tests/bundles/bundleV03-intoto.sigstore',
    sha256: '0fb27faaccc8efe29c485d584adc5fc08b54e70acc48e637a8257e7bda50cc94',
  }),
  trust: Object.freeze({
    url: 'https://raw.githubusercontent.com/sigstore/root-signing/67e8656ef7950b2dd70c96eb35c6f07a68b72404/targets/trusted_root.json',
    sha256: '6494e21ea73fa7ee769f85f57d5a3e6a08725eae1e38c755fc3517c9e6bc0b66',
  }),
  certificateIdentity: 'brian@dehamer.com',
  certificateIdentityKind: 'email',
  certificateIssuer: 'https://github.com/login/oauth',
});

export async function fetchPinnedFixture(pin, fetcher = fetch) {
  const response = await fetcher(pin.url, { redirect: 'error', signal: AbortSignal.timeout(60_000) });
  requireThat(response.ok, 'HOST', `Required public crypto fixture unavailable: ${pin.url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  requireThat(bytes.length > 0 && bytes.length <= 4 * 1024 * 1024 && sha256(bytes) === pin.sha256,
    'HOST', `Required public crypto fixture integrity mismatch: ${pin.url}`);
  return bytes;
}

export async function provisionPrCryptoFixture({ root, environment, run, fetcher = fetch }) {
  requireThat(environment.GITHUB_ACTIONS === 'true', 'HOST',
    'Required PR crypto fixture provisioning runs only in CI; local tests consume retained owned bytes');
  await fs.mkdir(root);
  const bundleFile = path.join(root, 'public-intoto.sigstore');
  const cachePath = path.join(root, 'offline-trust');
  await fs.mkdir(cachePath);
  const trustedRootFile = path.join(cachePath, 'fixture-trusted-root.json');
  for (const [file, pin] of [[bundleFile, prCryptoFixture.bundle], [trustedRootFile, prCryptoFixture.trust]]) {
    await fs.writeFile(file, await fetchPinnedFixture(pin, fetcher), { flag: 'wx' });
  }
  const tool = await pinnedNpmTool({ root, environment, run, fetcher });
  const proof = await verifyRetainedNpmAttestation({ toolRoot: tool.root, bundleFile,
    certificateIdentity: prCryptoFixture.certificateIdentity,
    certificateIdentityKind: prCryptoFixture.certificateIdentityKind,
    certificateIssuer: prCryptoFixture.certificateIssuer, cachePath,
    trustedRootFile, trustedRootSha256: prCryptoFixture.trust.sha256, offline: true });
  requireThat(proof.bundleSha256 === prCryptoFixture.bundle.sha256 &&
    Object.values(proof.mechanisms).every(item => item.status === 'Passed'),
  'HOST', 'Required authentic PR crypto fixture did not pass the real offline verifier');
  const selected = {
    SDLC_NPM_SIGNED_FIXTURE_BUNDLE: bundleFile,
    SDLC_NPM_SIGNED_FIXTURE_SHA256: prCryptoFixture.bundle.sha256,
    SDLC_NPM_SIGNED_FIXTURE_CERTIFICATE_IDENTITY: prCryptoFixture.certificateIdentity,
    SDLC_NPM_SIGNED_FIXTURE_CERTIFICATE_IDENTITY_KIND: prCryptoFixture.certificateIdentityKind,
    SDLC_NPM_SIGNED_FIXTURE_CERTIFICATE_ISSUER: prCryptoFixture.certificateIssuer,
    SDLC_NPM_TOOL_ROOT: tool.root, SDLC_NPM_TUF_CACHE: cachePath,
    SDLC_NPM_SIGNED_FIXTURE_TRUST_SHA256: prCryptoFixture.trust.sha256,
  };
  await fs.writeFile(path.join(root, 'fixture.json'), JSON.stringify({
    schemaVersion: 1, kind: 'public-crypto-fixture', status: 'Passed',
    pins: prCryptoFixture, verifier: proof.verifier, mechanisms: proof.mechanisms,
    purpose: 'Offline code regression only; not this candidate publication or public-consumer acceptance',
  }) + '\n', { flag: 'wx' });
  return selected;
}
