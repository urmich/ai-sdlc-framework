import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const PACKAGE_IDENTIFIER = 'Urmich.AISDLCFramework';
export const TEST_PACKAGE_IDENTIFIER = `${PACKAGE_IDENTIFIER}.Test`;
export const MANIFEST_VERSION = '1.10.0';
const HASH = /^[a-f0-9]{64}$/iu;
const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;
const templates = Object.fromEntries(await Promise.all(
  ['version', 'installer', 'defaultLocale'].map(async type =>
    [type, await fs.readFile(new URL(`./templates/${type}.yaml.template`, import.meta.url), 'utf8')])));

export function manifestContext({ version, archive, releaseRepository, testOnly = false, candidateUrl } = {}) {
  const parsed = typeof version === 'string' && VERSION.exec(version);
  if (!parsed || version.length > 128 || parsed[4]?.split('.').some(value => /^0[0-9]+$/u.test(value))) {
    throw new Error('WinGet requires a valid package SemVer');
  }
  if (typeof testOnly !== 'boolean') throw new Error('testOnly must be a boolean');
  if (parsed[4] && !testOnly) throw new Error('Prereleases cannot generate stable WinGet metadata');
  const filename = `ai-sdlc-framework-${version}-windows-x64.zip`;
  if (!archive || archive.filename !== filename || !HASH.test(archive.sha256 ?? '') ||
      !Number.isSafeInteger(archive.size) || archive.size <= 0 ||
      (archive.kind !== undefined && archive.kind !== 'archive')) {
    throw new Error('WinGet requires the exact versioned Windows x64 ZIP filename, SHA-256 and byte size');
  }
  let url;
  if (testOnly) {
    try { url = new URL(candidateUrl); } catch { throw new Error('Test-only WinGet metadata requires a loopback HTTP candidate URL'); }
    if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) ||
        !url.port || url.username || url.password || url.search || url.hash ||
        url.pathname !== `/${encodeURIComponent(filename)}`) {
      throw new Error('Test-only candidate URL must be loopback HTTP with an explicit port and exact archive filename');
    }
    url = url.href;
  } else {
    if (candidateUrl !== undefined) throw new Error('Stable WinGet metadata cannot contain a candidate URL');
    if (typeof releaseRepository !== 'string' ||
        !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_][A-Za-z0-9_.-]*$/u.test(releaseRepository)) {
      throw new Error('Stable WinGet metadata requires the approved public release repository as owner/repository');
    }
    url = `https://github.com/${releaseRepository}/releases/download/v${encodeURIComponent(version)}/${encodeURIComponent(filename)}`;
  }
  return {
    version, filename, sha256: archive.sha256.toUpperCase(), size: archive.size, url, testOnly,
    identifier: testOnly ? TEST_PACKAGE_IDENTIFIER : PACKAGE_IDENTIFIER,
    command: testOnly ? 'sdlc-test' : 'sdlc',
    packageName: testOnly ? 'AI SDLC Framework (local validation only)' : 'AI SDLC Framework',
  };
}

export function renderManifests(options) {
  const context = manifestContext(options);
  const values = Object.fromEntries(Object.entries(context).map(([key, value]) => [key, JSON.stringify(value)]));
  values.testNotice = context.testOnly ? '# TEST-ONLY LOCAL CANDIDATE; NOT FOR SUBMISSION OR RELEASE.\n' : '';
  const suffixes = { version: '', installer: '.installer', defaultLocale: '.locale.en-US' };
  return Object.entries(templates).map(([type, template]) => {
    const content = template.replace(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/gu, (_, key) => {
      if (!(key in values)) throw new Error(`Unknown WinGet template placeholder ${key}`);
      return values[key];
    });
    if (content.includes('{{')) throw new Error('Unresolved WinGet template placeholder');
    return {
      filename: `${context.identifier}${suffixes[type]}.yaml`,
      kind: 'winget',
      sha256: createHash('sha256').update(content).digest('hex'),
      size: Buffer.byteLength(content),
      content,
    };
  }).sort((left, right) => left.filename < right.filename ? -1 : left.filename > right.filename ? 1 : 0);
}

export async function verifyArchive(archivePath, options) {
  const context = manifestContext(options);
  if (path.basename(archivePath) !== context.filename) throw new Error('WinGet archive path has a stale or wrong-platform filename');
  const info = await fs.lstat(archivePath);
  if (!info.isFile() || info.size !== context.size) throw new Error('WinGet archive must be a regular file of the recorded size');
  const bytes = await fs.readFile(archivePath);
  if (createHash('sha256').update(bytes).digest('hex').toUpperCase() !== context.sha256) {
    throw new Error('WinGet archive SHA-256 does not match the prepublication candidate');
  }
  if (bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50) {
    throw new Error('WinGet archive is not a nonempty ZIP');
  }
}

export async function generateManifests({ outputDir, archivePath, ...options }) {
  if (!outputDir) throw new Error('WinGet outputDir is required');
  const context = manifestContext(options);
  const rendered = renderManifests(options);
  if (archivePath) await verifyArchive(archivePath, options);
  const destination = path.resolve(outputDir);
  await fs.mkdir(destination, { recursive: true });
  if (!(await fs.lstat(destination)).isDirectory()) throw new Error('WinGet output must be a real directory');
  const names = new Set(rendered.map(file => file.filename));
  for (const entry of await fs.readdir(destination, { withFileTypes: true })) {
    if (!names.has(entry.name) || !entry.isFile()) {
      throw new Error('WinGet output must be empty or contain only the owned manifest set');
    }
  }
  const files = [];
  for (const file of rendered) {
    const artifact = path.join(destination, file.filename);
    const current = await fs.lstat(artifact).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (current && !current.isFile()) throw new Error('WinGet output contains a non-regular manifest');
    if (current) await fs.unlink(artifact);
    await fs.writeFile(artifact, file.content, { encoding: 'utf8', flag: 'wx', mode: 0o644 });
    const { content, ...metadata } = file;
    files.push({ ...metadata, artifact });
  }
  return { schemaVersion: 1, version: context.version, packageIdentifier: context.identifier,
    testOnly: context.testOnly, publicationEligible: false,
    communityAccepted: false, clientAvailable: false, files };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--input' || args[2] !== '--output-dir') {
    throw new Error('Usage: node packaging/winget/generate.mjs --input INPUT.json --output-dir DIRECTORY');
  }
  const options = JSON.parse(await fs.readFile(args[1], 'utf8'));
  console.log(JSON.stringify(await generateManifests({ ...options, outputDir: args[3] }), null, 2));
}
