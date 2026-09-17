import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { isPrerelease } from '../packaging/standalone/protocol.mjs';
import { readTarGzip, sha256 } from '../packaging/standalone/archive.mjs';
import { npmInvocation } from './package.mjs';
import { options, releaseRepository, trustedEnvironment, verifyBundle } from './release-bundle.mjs';

const execute = promisify(execFile);

export async function githubRequest(route, { method = 'GET', body, bytes, binary = false } = {}) {
  const upload = route.startsWith('/uploads/');
  const url = upload ? `https://uploads.github.com/${route.slice('/uploads/'.length)}` : `https://api.github.com${route}`;
  if (!process.env.GH_TOKEN) throw new Error('An approved GitHub release token is required');
  const response = await fetch(url, {
    method, headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`,
      Accept: binary ? 'application/octet-stream' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(bytes ? { 'Content-Type': 'application/octet-stream' } : {}) },
    body: bytes ?? (body ? JSON.stringify(body) : undefined),
  });
  if (response.status === 404) return { status: 404 };
  if (!response.ok) throw new Error(`GitHub request failed (${response.status}): ${method} ${route}`);
  return { status: response.status, value: binary ? Buffer.from(await response.arrayBuffer()) : await response.json() };
}

async function requireValue(api, route, options) {
  const response = await api(route, options);
  if (response.status === 404) throw new Error(`Required GitHub resource is missing: ${route}`);
  return response.value;
}

export async function publishDraft({ directory, repository, ...expected }, api = githubRequest) {
  const bundle = await verifyBundle({ directory, ...expected });
  repository = releaseRepository(repository);
  if (repository !== bundle.releaseRepository) throw new Error('Publication repository differs from the frozen metadata');
  const prefix = `/repos/${repository}`;
  const repo = await requireValue(api, prefix);
  if (repo.private !== false) throw new Error('Release assets require an approved public repository');
  const tag = `v${bundle.identity.version}`;
  let ref = (await requireValue(api, `${prefix}/git/ref/tags/${encodeURIComponent(tag)}`)).object;
  for (let depth = 0; ref.type === 'tag' && depth < 5; depth++) {
    ref = (await requireValue(api, `${prefix}/git/tags/${ref.sha}`)).object;
  }
  if (ref.type !== 'commit' || ref.sha !== bundle.identity.sourceCommit) {
    throw new Error('Pre-existing release tag must resolve to the exact validated source commit; no tags are created');
  }
  let release = (await api(`${prefix}/releases/tags/${encodeURIComponent(tag)}`)).value;
  if (!release) {
    release = await requireValue(api, `${prefix}/releases`, { method: 'POST', body: {
      tag_name: tag, name: tag, draft: true, prerelease: isPrerelease(bundle.identity.version),
      body: `Validated immutable candidate for ${tag}.\n\n` +
        `Source: ${bundle.identity.sourceCommit}\nDescriptor SHA-256: ${bundle.identity.descriptorSha256}\n` +
        `SHA256SUMS SHA-256: ${bundle.identity.checksumsSha256}\n\n` +
        'macOS arm64 native lifecycle is required. Windows evidence is cross-build/schema/payload/metadata only; ' +
        'native Windows is NotRun. macOS Intel is unsupported/NotRun and is excluded along with Linux installers. ' +
        'Homebrew native acceptance and package-manager community acceptance are separate evidence.\n\n' +
        'This workflow never makes the draft public. Review before manually publishing, then run Release acceptance.',
    } });
  }
  if (!release.draft || release.tag_name !== tag || release.prerelease !== isPrerelease(bundle.identity.version)) {
    throw new Error('Only a matching draft release may be resumed; published releases are never changed');
  }
  const records = bundle.files.filter(file => file.filename.startsWith('assets/'))
    .map(file => ({ ...file, name: file.filename.slice('assets/'.length) }));
  const existing = [];
  for (let page = 1; ; page++) {
    const items = await requireValue(api, `${prefix}/releases/${release.id}/assets?per_page=100&page=${page}`);
    existing.push(...items);
    if (items.length < 100) break;
  }
  if (new Set(existing.map(item => item.name)).size !== existing.length ||
      existing.some(item => !records.some(record => record.name === item.name))) {
    throw new Error('Draft has duplicate or unexpected assets; never delete or overwrite them automatically');
  }
  const compare = async (asset, record) => {
    if (asset.size !== record.size || asset.state !== 'uploaded') throw new Error(`Existing asset conflicts: ${record.name}`);
    const bytes = await requireValue(api, `${prefix}/releases/assets/${asset.id}`, { binary: true });
    if (sha256(bytes) !== record.sha256) throw new Error(`Existing asset conflicts: ${record.name}`);
  };
  // Verify all existing assets before uploading anything, making retries safe after partial failure.
  for (const asset of existing) await compare(asset, records.find(record => record.name === asset.name));
  for (const record of records) {
    if (existing.some(asset => asset.name === record.name)) continue;
    const bytes = await fs.readFile(path.join(directory, record.filename));
    const uploaded = await requireValue(api,
      `/uploads/repos/${repository}/releases/${release.id}/assets?name=${encodeURIComponent(record.name)}`,
      { method: 'POST', bytes });
    await compare(uploaded, record);
  }
  return { status: 'DraftAssetsVerified', tag, assets: records.length,
    publicAvailability: 'NotRun', communityAcceptance: 'NotRun' };
}

export async function registryPackage(name, version, fetcher = fetch) {
  const response = await fetcher(`https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
    { headers: { Accept: 'application/json' } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Anonymous npm registry query failed: ${response.status}`);
  return response.json();
}

export async function verifyRegistryPayload(metadata, { name, version, sha256: expectedSha256 }, fetcher = fetch) {
  const url = new URL(metadata.dist?.tarball);
  if (metadata.name !== name || metadata.version !== version || url.protocol !== 'https:' ||
      url.hostname !== 'registry.npmjs.org' || url.username || url.password || url.search || url.hash) {
    throw new Error('Unexpected anonymous npm package identity or tarball URL');
  }
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`Anonymous npm payload download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  if (sha256(bytes) !== expectedSha256 || metadata.dist.integrity !== integrity) {
    throw new Error('Published npm bytes differ from the immutable release payload');
  }
  return bytes;
}

export async function publishNpm({ directory, sourceRepository, ...expected }, {
  fetcher = fetch, run = execute, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  const bundle = await verifyBundle({ directory, ...expected });
  const artifact = path.resolve(directory, 'assets', bundle.descriptor.payload.filename);
  const entries = readTarGzip(await fs.readFile(artifact));
  const pkg = JSON.parse(entries.find(entry => entry.path === 'package/package.json').data);
  releaseRepository(sourceRepository);
  if (pkg.repository?.url !== `https://github.com/${sourceRepository}.git` || pkg.version !== bundle.identity.version) {
    throw new Error('npm repository identity/version must match the publishing source repository');
  }
  const identity = { name: pkg.name, version: pkg.version, sha256: bundle.identity.payloadSha256 };
  const existing = await registryPackage(pkg.name, pkg.version, fetcher);
  if (existing) {
    await verifyRegistryPayload(existing, identity, fetcher);
    return { status: 'AlreadyPublishedIdentical', version: pkg.version, distTagsChanged: false };
  }
  const tag = isPrerelease(pkg.version) ? 'next' : 'latest';
  const invocation = npmInvocation(['publish', artifact, '--ignore-scripts', '--access', 'public', '--tag', tag,
    ...(process.env.REPOSITORY_PRIVATE === 'false' ? ['--provenance'] : [])]);
  await run(invocation.command, invocation.args, { env: process.env, maxBuffer: 4 * 1024 * 1024 });
  for (let attempt = 0; attempt < 6; attempt++) {
    const published = await registryPackage(pkg.name, pkg.version, fetcher);
    if (published) {
      await verifyRegistryPayload(published, identity, fetcher);
      return { status: 'PublishedAndBytesVerified', version: pkg.version, distTag: tag };
    }
    await sleep(10_000);
  }
  throw new Error('npm publish returned but anonymous registry evidence is not yet available');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const command = { draft: publishDraft, npm: publishNpm }[process.argv[2]];
  if (!command) throw new Error('Expected draft or npm publication handoff');
  if (!process.env.EXPECTED_BUNDLE_SHA256) throw new Error('Publication requires the trusted immutable bundle digest');
  console.log(JSON.stringify(await command({
    ...options(process.argv.slice(3)), ...trustedEnvironment(),
  }), null, 2));
}
