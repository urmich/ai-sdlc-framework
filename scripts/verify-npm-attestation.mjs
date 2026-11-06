import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { sha256 } from '../packaging/standalone/archive.mjs';

// This host adapter uses the dependency already shipped in the integrity-pinned
// npm tool. The dependency-free product runtime neither imports nor implements it.
export async function verifyRetainedNpmAttestation({ toolRoot, bundleFile, certificateIdentity,
  certificateIdentityKind = 'uri', certificateIssuer = 'https://token.actions.githubusercontent.com',
  cachePath, trustedRootFile, trustedRootSha256, offline = false }) {
  const resolvedToolRoot = await fs.realpath(toolRoot);
  const require = createRequire(path.join(resolvedToolRoot, 'package.json'));
  const npm = require('./package.json');
  if (npm.name !== 'npm' || npm.version !== '11.16.0') throw Object.assign(
    new Error('Pinned npm 11.16.0 verifier tooling is required'), { code: 'VERIFIER_UNAVAILABLE' });
  const verifierRoot = await fs.realpath(path.join(resolvedToolRoot, 'node_modules', 'sigstore'));
  const toolRelative = path.relative(resolvedToolRoot, verifierRoot);
  if (!toolRelative || toolRelative === '..' || toolRelative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(toolRelative)) {
    throw Object.assign(new Error('Bundled Sigstore must remain inside the pinned npm tool root'),
      { code: 'VERIFIER_UNAVAILABLE' });
  }
  const verifierEntry = await fs.realpath(require.resolve('sigstore'));
  const relative = path.relative(verifierRoot, verifierEntry);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw Object.assign(new Error('Global or ancestor-installed Sigstore cannot replace the pinned npm bundled verifier'),
      { code: 'VERIFIER_UNAVAILABLE' });
  }
  const sigstore = require(verifierEntry);
  if (typeof sigstore.verify !== 'function') throw Object.assign(
    new Error('Pinned npm tooling does not expose the required exact-bundle Sigstore verification API'),
    { code: 'VERIFIER_UNAVAILABLE' });
  const verifierVersion = require('sigstore/package.json').version;
  const bytes = await fs.readFile(bundleFile);
  if (!bytes.length || bytes.length > 4 * 1024 * 1024) throw new Error('Oversized or empty retained npm attestation');
  const bundle = JSON.parse(bytes);
  if (!bundle.verificationMaterial?.x509CertificateChain?.certificates?.length &&
      !bundle.verificationMaterial?.certificate?.rawBytes) {
    throw new Error('npm source provenance requires a signing certificate, not a key-only publish attestation');
  }
  if (!certificateIdentity || !bundle.verificationMaterial?.tlogEntries?.length) {
    throw new Error('npm source provenance requires an exact certificate identity and transparency witness');
  }
  if (!['uri', 'email'].includes(certificateIdentityKind)) throw new Error('Unsupported certificate identity kind');
  const identity = `^${certificateIdentity.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`;
  if (trustedRootFile !== undefined) {
    if (!offline || !/^[a-f0-9]{64}$/u.test(trustedRootSha256 ?? '')) {
      throw new Error('Pinned public trust requires offline verification and its independently selected SHA-256');
    }
    const trustBytes = await fs.readFile(trustedRootFile);
    if (trustBytes.length > 4 * 1024 * 1024 || sha256(trustBytes) !== trustedRootSha256) {
      throw new Error('Retained public trust-root integrity mismatch');
    }
    const bundled = createRequire(verifierEntry);
    for (const name of ['@sigstore/verify', '@sigstore/bundle', '@sigstore/protobuf-specs']) {
      const modulePath = await fs.realpath(bundled.resolve(name));
      const relative = path.relative(resolvedToolRoot, modulePath);
      if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw Object.assign(new Error('Offline verifier dependencies must remain inside the pinned npm tool'),
          { code: 'VERIFIER_UNAVAILABLE' });
      }
    }
    const { Verifier, toTrustMaterial, toSignedEntity } = bundled('@sigstore/verify');
    const { bundleFromJSON } = bundled('@sigstore/bundle');
    const { TrustedRoot } = bundled('@sigstore/protobuf-specs');
    const verifier = new Verifier(toTrustMaterial(TrustedRoot.fromJSON(JSON.parse(trustBytes))),
      { ctlogThreshold: 1, tlogThreshold: 1 });
    verifier.verify(toSignedEntity(bundleFromJSON(bundle)), {
      subjectAlternativeName: identity, extensions: { issuer: certificateIssuer },
    });
  } else {
    await sigstore.verify(bundle, {
      [certificateIdentityKind === 'email' ? 'certificateIdentityEmail' : 'certificateIdentityURI']: identity,
      certificateIssuer, ctLogThreshold: 1, tlogThreshold: 1,
      ...(cachePath ? { tufCachePath: cachePath } : {}), ...(offline ? { tufForceCache: true } : {}),
    });
  }
  if (bundle.dsseEnvelope?.payloadType !== 'application/vnd.in-toto+json' ||
      typeof bundle.dsseEnvelope.payload !== 'string') throw new Error('Verified npm attestation is not an in-toto statement');
  const statementBytes = Buffer.from(bundle.dsseEnvelope.payload, 'base64');
  return { bundleSha256: sha256(bytes), statementSha256: sha256(statementBytes),
    statement: JSON.parse(statementBytes), verifier: { id: 'npm-bundled-sigstore', version: verifierVersion,
      npmVersion: npm.version },
    mechanisms: {
      signature: { required: true, status: 'Passed', policy: 'sigstore DSSE signature' },
      certificate: { required: true, status: 'Passed', policy: { identity: certificateIdentity, issuer: certificateIssuer,
        certificateTransparencyThreshold: 1 } },
      transparency: { required: true, status: 'Passed', policy: { transparencyLogThreshold: 1 } },
    } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { 'tool-root': { type: 'string' }, bundle: { type: 'string' },
    'certificate-identity': { type: 'string' }, 'cache-path': { type: 'string' } } });
  try {
    const result = await verifyRetainedNpmAttestation({ toolRoot: values['tool-root'], bundleFile: values.bundle,
      certificateIdentity: values['certificate-identity'], cachePath: values['cache-path'] });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const unavailable = ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED', 'ENOENT', 'VERIFIER_UNAVAILABLE'].includes(error.code);
    const failure = { status: unavailable ? 'NotRun' : 'Failed', code: error.code ?? 'VERIFIER_ERROR',
      reason: error.message, mechanisms: Object.fromEntries(['signature', 'certificate', 'transparency'].map(name =>
        [name, { required: true, status: 'NotRun', reason: 'Verification did not establish this mechanism' }])) };
    const mechanism = { SIGNATURE_ERROR: 'signature', CERTIFICATE_ERROR: 'certificate',
      POLICY_ERROR: 'certificate', TLOG_ERROR: 'transparency', TIMESTAMP_ERROR: 'transparency' }[error.code];
    if (mechanism) failure.mechanisms[mechanism].status = 'Failed';
    process.stdout.write(`${JSON.stringify(failure)}\n`);
    process.exitCode = unavailable ? 2 : 1;
  }
}
