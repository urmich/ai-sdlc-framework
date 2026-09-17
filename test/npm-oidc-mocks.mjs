import * as fs from 'node:fs/promises';
import path from 'node:path';

// Simulated runner metadata and registry responses: never actual OIDC or publication evidence.
if (process.env.TEST_NODE_VERSION) Object.defineProperty(process.versions, 'node', { value: process.env.TEST_NODE_VERSION });
globalThis.fetch = async (input, options) => {
  const root = process.env.TEST_NPM_ROOT;
  if (!root) throw new Error('npm OIDC mocks require an explicit unit-test root');
  const data = JSON.parse(await fs.readFile(path.join(root, 'handoff.json'), 'utf8'));
  const url = String(input);
  if (!url.startsWith('https://registry.npmjs.org/')) throw new Error(`Unexpected unit-test URL: ${url}`);
  if (options?.headers) throw new Error('Registry requests must be anonymous');
  if (url === 'https://registry.npmjs.org/npm/-/npm-11.16.0.tgz') {
    let bytes = await fs.readFile(path.join(root, 'npm-tool-download.tgz'));
    if (process.env.TEST_NPM_BAD_TOOL === 'true') bytes = Buffer.concat([bytes, Buffer.from('tampered')]);
    return new Response(bytes);
  }
  if (url.includes('/-/npm/v1/attestations/')) {
    const statement = { _type: 'https://in-toto.io/Statement/v1',
      predicateType: 'https://slsa.dev/provenance/v1',
      subject: [{ name: `pkg:npm/${data.packageName}@${data.version}`,
        digest: { sha512: Buffer.from(data.integrity.slice(7), 'base64').toString('hex') } }],
      predicate: { buildDefinition: {
        buildType: 'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1',
        externalParameters: { workflow: { repository: 'https://github.com/urmich/ai-sdlc-framework',
          path: '.github/workflows/release.yml', ref: 'refs/heads/main' } },
        resolvedDependencies: [{ uri: 'git+https://github.com/urmich/ai-sdlc-framework@refs/heads/main',
          digest: { gitCommit: data.sourceCommit } }] },
      runDetails: { builder: { id: 'https://github.com/actions/runner/github-hosted' },
        metadata: { invocationId: 'https://github.com/urmich/ai-sdlc-framework/actions/runs/1234/attempts/1' } } } };
    const bad = process.env.TEST_NPM_BAD_PROVENANCE;
    if (bad === 'source') statement.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = 'b'.repeat(40);
    if (bad === 'caller') statement.predicate.buildDefinition.externalParameters.workflow.path = '.github/workflows/npm-publish.yml';
    if (bad === 'subject') statement.subject[0].digest.sha512 = '0'.repeat(128);
    if (bad === 'builder') statement.predicate.runDetails.builder.id = 'https://github.com/actions/runner/self-hosted';
    return Response.json({ attestations: [{ predicateType: statement.predicateType,
      bundle: { dsseEnvelope: { payloadType: 'application/vnd.in-toto+json',
        payload: Buffer.from(JSON.stringify(statement)).toString('base64'),
        signatures: [{ sig: 'unit-metadata-fixture-not-a-verified-signature' }] } } }] });
  }
  if (url.endsWith('.tgz')) {
    let bytes = await fs.readFile(path.join(root, 'bundle-data/assets', data.filename));
    if (process.env.TEST_NPM_CORRUPT === 'true') bytes = Buffer.concat([bytes, Buffer.from('changed')]);
    return new Response(bytes);
  }
  const published = await fs.stat(path.join(root, 'published')).then(() => true, error => {
    if (error.code !== 'ENOENT') throw error;
    return false;
  });
  if (process.env.TEST_NPM_EXISTS !== 'true' && !published) return new Response('', { status: 404 });
  return Response.json({ name: data.packageName, version: data.version,
    dist: { tarball: `https://registry.npmjs.org/${data.packageName}/-/${data.filename}`, integrity: data.integrity,
      ...(process.env.TEST_NPM_MISSING_PROVENANCE === 'true' ? {} : {
        attestations: { url: `https://registry.npmjs.org/-/npm/v1/attestations/${data.packageName}@${data.version}` },
      }) } });
};
