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
    dist: { tarball: `https://registry.npmjs.org/${data.packageName}/-/${data.filename}`, integrity: data.integrity } });
};
