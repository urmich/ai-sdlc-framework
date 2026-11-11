export const validationDeclarations = {
  "schemaVersion": 1,
  "surfaces": [],
  "groups": [{
    "root": "T-PRD041 npm provenance distinguishes the reusable signer from the release caller",
    "dependsOn": [], "minimumSlots": 1, "exclusiveResources": []
  }],
  "applicability": [{
    "names": ["T-PRD041 npm provenance distinguishes the reusable signer from the release caller"],
    "platforms": ["linux-x64", "windows-x64", "macos-arm64", "macos-x64"],
    "owner": "maintainer",
    "reason": "PR-only FR-208/AC-208.5 regression checks the actual consumer command boundary and independent caller binding. One isolated root owns its fixtures, has no shared resources or prerequisite roots, leaves critical27 unchanged and supplies no public-release acceptance credit.",
    "prerequisites": ["Node >=22", "Owned filesystem fixture and controlled command transport"]
  }],
  "plannedCases": [{"id": "T-PRD041", "selectors": [{
    "name": "T-PRD041 npm provenance distinguishes the reusable signer from the release caller",
    "parents": []
  }]}]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from '../packaging/standalone/archive.mjs';
import { verifyPublishedProvenance } from '../scripts/accept-release.mjs';

test('T-PRD041 npm provenance distinguishes the reusable signer from the release caller', async t => {
  const parent = new URL('../.test-data/', import.meta.url);
  await fs.mkdir(parent, { recursive: true });
  const directory = await fs.mkdtemp(new URL('npm-provenance-', parent));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const bundle = { identity: { sourceCommit: 'a'.repeat(40), version: '0.5.0' },
    descriptor: { name: 'ai-sdlc-framework' } };
  const metadata = { dist: { signatures: [{ sig: 'controlled-unit-fixture' }],
    integrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
    attestations: { url: 'https://registry.npmjs.org/-/npm/v1/attestations/ai-sdlc-framework@0.5.0' } } };
  for (const caller of ['release.yml', 'npm-publish.yml']) {
    const root = path.join(directory, caller);
    await fs.mkdir(root);
    const statement = { _type: 'https://in-toto.io/Statement/v1',
      predicateType: 'https://slsa.dev/provenance/v1',
      subject: [{ name: 'pkg:npm/ai-sdlc-framework@0.5.0', digest: { sha512: '0'.repeat(128) } }],
      predicate: { buildDefinition: {
        buildType: 'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1',
        externalParameters: { workflow: { repository: 'https://github.com/urmich/ai-sdlc-framework',
          path: `.github/workflows/${caller}`, ref: 'refs/heads/main' } },
        resolvedDependencies: [{ uri: 'git+https://github.com/urmich/ai-sdlc-framework@refs/heads/main',
          digest: { gitCommit: bundle.identity.sourceCommit } }]
      }, runDetails: { builder: { id: 'https://github.com/actions/runner/github-hosted' } } } };
    const signed = { dsseEnvelope: { payloadType: 'application/vnd.in-toto+json',
      payload: Buffer.from(JSON.stringify(statement)).toString('base64') } };
    const stop = new Error('Controlled fixture stops before registry installation');
    let registryInstallReached = false;
    const run = async (command, args) => {
      if (args[0]?.endsWith('verify-npm-attestation.mjs')) {
        assert.equal(command, process.execPath);
        assert.equal(args[args.indexOf('--certificate-identity') + 1],
          'https://github.com/urmich/ai-sdlc-framework/.github/workflows/npm-publish.yml@refs/heads/main');
        const bytes = await fs.readFile(args[args.indexOf('--bundle') + 1]);
        const statementBytes = Buffer.from(signed.dsseEnvelope.payload, 'base64');
        return { stdout: JSON.stringify({ bundleSha256: sha256(bytes),
          statementSha256: sha256(statementBytes), statement,
          verifier: { id: 'npm-bundled-sigstore', npmVersion: '11.16.0' },
          mechanisms: Object.fromEntries(['signature', 'certificate', 'transparency'].map(name =>
            [name, { required: true, status: 'Passed', policy: 'Controlled command fixture, not signature proof' }]))
        }) };
      }
      assert.ok(args.includes('install'), 'Unexpected external command');
      registryInstallReached = true;
      throw stop;
    };
    await assert.rejects(verifyPublishedProvenance({ bundle, metadata, root,
      tool: { command: 'controlled-unit-command', prefix: [], root: path.join(root, 'npm-tool') },
      environment: {}, run, fetcher: async () => new Response(JSON.stringify({
        attestations: [{ predicateType: statement.predicateType, bundle: signed }]
      })) }), error => {
      if (caller === 'release.yml') {
        assert.equal(error, stop);
        assert.equal(error.provenance.npm.semanticBinding, 'Passed');
      } else {
        assert.match(error.message, /exact source, package and root release\.yml caller/u);
        assert.equal(error.provenance.npm.semanticBinding, 'NotRun');
      }
      return true;
    });
    assert.equal(registryInstallReached, caller === 'release.yml');
  }
});
