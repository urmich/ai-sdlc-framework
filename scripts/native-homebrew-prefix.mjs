import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { canonical, digest, requireThat, SdlcError } from '../src/core.mjs';

const files = Object.freeze({
  request: 'native-homebrew-prefix-request.json',
  allocation: 'native-homebrew-prefix-allocation.json',
  cleanup: 'native-homebrew-prefix-cleanup.json',
  marker: '.sdlc-native-homebrew-prefix.json',
});
const maximumRecordBytes = 16 * 1024;
const same = (left, right) => canonical(left) === canonical(right);
const identity = stat => ({
  device: String(stat.dev), inode: String(stat.ino), created: String(stat.birthtimeNs),
  uid: Number(stat.uid), gid: Number(stat.gid),
});
const failure = (message, cause) => {
  const error = new SdlcError('HOST', message);
  error.cause = cause;
  return error;
};

function nativeHost() {
  return { platform: process.platform, architecture: process.arch, machine: os.machine(),
    release: os.release(), hostname: os.hostname(), uid: process.getuid?.(), gid: process.getgid?.() };
}

/** Pure policy inspection; allocation/cleanup always supply actual nativeHost(), never caller host facts. */
export function homebrewPrefixBinding({ target, environment, host }) {
  const arm = target === 'macos-arm64';
  requireThat(['macos-arm64', 'macos-x64'].includes(target) &&
    host?.platform === 'darwin' && host.architecture === (arm ? 'arm64' : 'x64') &&
    host.machine === (arm ? 'arm64' : 'x86_64') && /^24\./u.test(host.release) &&
    /^[A-Za-z0-9._-]{1,255}$/u.test(host.hostname) &&
    Number.isSafeInteger(host.uid) && host.uid > 0 &&
    Number.isSafeInteger(host.gid) && host.gid > 0,
  'HOST', 'A short Homebrew prefix requires the actual non-root native macOS 15 target and user');
  requireThat(environment?.GITHUB_ACTIONS === 'true' &&
    environment.RUNNER_ENVIRONMENT === 'github-hosted' && environment.RUNNER_OS === 'macOS' &&
    environment.RUNNER_ARCH === (arm ? 'ARM64' : 'X64') &&
    environment.GITHUB_SERVER_URL === 'https://github.com' &&
    typeof environment.GITHUB_WORKSPACE === 'string' && path.isAbsolute(environment.GITHUB_WORKSPACE) &&
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(environment.GITHUB_REPOSITORY ?? '') &&
    ['GITHUB_REPOSITORY_ID', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT'].every(key =>
      /^[1-9][0-9]{0,19}$/u.test(environment[key] ?? '')) &&
    /^[A-Za-z_][A-Za-z0-9_-]{0,99}$/u.test(environment.GITHUB_JOB ?? '') &&
    /^[A-Za-z0-9._ -]{1,200}$/u.test(environment.RUNNER_NAME ?? ''),
  'HOST', 'Short Homebrew allocation is restricted to an identified disposable GitHub-hosted Mac job');
  return { schemaVersion: 1, target, host: { ...host },
    github: Object.fromEntries(['GITHUB_SERVER_URL', 'GITHUB_REPOSITORY', 'GITHUB_REPOSITORY_ID',
      'GITHUB_WORKSPACE', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_JOB', 'RUNNER_NAME', 'RUNNER_ENVIRONMENT',
      'RUNNER_OS', 'RUNNER_ARCH'].map(key => [key, environment[key]])) };
}

export function requireShortHomebrewPrefix(prefix) {
  requireThat(typeof prefix === 'string' && /^\/opt\/[a-f0-9]{5}$/u.test(prefix) &&
    Buffer.byteLength(prefix) === 10, 'HOST', 'Homebrew requires a new real ten-byte /opt/<five hex digits> prefix');
  return prefix;
}

async function absent(file) {
  try { await fs.lstat(file); return false; }
  catch (error) { if (error.code === 'ENOENT') return true; throw error; }
}

async function realDirectory(directory) {
  const stat = await fs.lstat(directory, { bigint: true });
  requireThat(stat.isDirectory() && !stat.isSymbolicLink() &&
    await fs.realpath(directory) === directory, 'HOST', 'Ownership paths must be stable real directories');
  return stat;
}

function requireOwner(stat, binding) {
  requireThat(Number(stat.uid) === binding.host.uid && Number(stat.gid) === binding.host.gid &&
    (process.platform === 'win32' || stat.isSymbolicLink() || (Number(stat.mode) & 0o022) === 0),
  'HOST', 'Ownership evidence and prefix must belong to the bound user/group and not be publicly writable');
}

/** Actual Actions workspace stays unchanged; this repository is checked out only into its literal source child. */
export async function verifyHomebrewSourceCheckout({ repositoryRoot, environment, binding }) {
  const workspace = environment?.GITHUB_WORKSPACE;
  requireThat(typeof workspace === 'string' && path.isAbsolute(workspace) &&
    path.resolve(workspace) === workspace && repositoryRoot === path.join(workspace, 'source'),
  'HOST', 'The repository must be the literal source checkout of the canonical GitHub workspace');
  requireOwner(await realDirectory(workspace), binding);
  requireOwner(await realDirectory(repositoryRoot), binding);
  return { workspace, repositoryRoot };
}

async function storage({ bootstrapDirectory, repositoryRoot, binding }) {
  requireThat(typeof repositoryRoot === 'string' && typeof bootstrapDirectory === 'string' &&
    path.isAbsolute(repositoryRoot) && path.isAbsolute(bootstrapDirectory) &&
    path.resolve(repositoryRoot) === repositoryRoot && path.resolve(bootstrapDirectory) === bootstrapDirectory,
  'HOST', 'Ownership records require explicit canonical repository and bootstrap paths');
  const relative = path.relative(repositoryRoot, bootstrapDirectory);
  requireThat(relative.split(path.sep)[0] === '.test-data' && relative.split(path.sep).length >= 2 &&
    !path.isAbsolute(relative) && !relative.split(path.sep).includes('..'),
  'HOST', 'Ownership records must stay in the repository-local .test-data bootstrap');
  requireOwner(await realDirectory(repositoryRoot), binding);
  let current = repositoryRoot;
  for (const component of relative.split(path.sep)) {
    current = path.join(current, component);
    requireOwner(await realDirectory(current), binding);
  }
  return Object.fromEntries(Object.entries(files).filter(([key]) => key !== 'marker')
    .map(([key, name]) => [key, path.join(bootstrapDirectory, name)]));
}

async function writeRecord(file, value) {
  const bytes = Buffer.from(`${canonical(value)}\n`);
  requireThat(bytes.length <= maximumRecordBytes, 'HOST', 'Prefix ownership record exceeds its bound');
  const handle = await fs.open(file, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
  // Directory fsync is unsupported by Node on Windows; the native production host is macOS.
  if (process.platform !== 'win32') {
    const directory = await fs.open(path.dirname(file), constants.O_RDONLY);
    try { await directory.sync(); } finally { await directory.close(); }
  }
  return digest(bytes);
}

async function readRecord(file, binding) {
  const before = await fs.lstat(file, { bigint: true });
  requireThat(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n &&
    before.size > 0n && before.size <= BigInt(maximumRecordBytes),
  'HOST', 'Missing, linked or oversized prefix ownership evidence is not authority');
  requireOwner(before, binding);
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat({ bigint: true });
    requireThat(same(identity(before), identity(stat)), 'HOST', 'Prefix ownership evidence was replaced');
    const bytes = Buffer.alloc(maximumRecordBytes + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    requireThat(BigInt(bytesRead) === stat.size && bytesRead <= maximumRecordBytes &&
      same(identity(stat), identity(await fs.lstat(file, { bigint: true }))),
    'HOST', 'Prefix ownership evidence changed while being read');
    const original = bytes.subarray(0, bytesRead);
    let value;
    try { value = JSON.parse(original.toString('utf8')); }
    catch (error) { throw failure('Malformed prefix ownership evidence', error); }
    return { value, sha256: digest(original), identity: identity(stat) };
  } finally { await handle.close(); }
}

function requestValue(context, prefix) {
  return { schemaVersion: 1, kind: 'owned-native-homebrew-prefix',
    repositoryRoot: context.repositoryRoot, bootstrapDirectory: context.bootstrapDirectory,
    binding: context.binding, prefix, nonce: randomBytes(32).toString('hex') };
}

function verifyRequest(request, context) {
  requireThat(request?.schemaVersion === 1 && request.kind === 'owned-native-homebrew-prefix' &&
    request.repositoryRoot === context.repositoryRoot && request.bootstrapDirectory === context.bootstrapDirectory &&
    same(request.binding, context.binding) && typeof request.prefix === 'string' &&
    (context.prefix === undefined || context.prefix === request.prefix) &&
    path.isAbsolute(request.prefix) && path.resolve(request.prefix) === request.prefix &&
    /^[a-f0-9]{64}$/u.test(request.nonce ?? '') &&
    same(Object.keys(request).sort(), ['schemaVersion', 'kind', 'repositoryRoot', 'bootstrapDirectory',
      'binding', 'prefix', 'nonce'].sort()), 'HOST', 'Prefix ownership request does not match this host/job/bootstrap');
}

async function verifyRoot(prefix, expected, binding) {
  const stat = await realDirectory(prefix);
  requireOwner(stat, binding);
  requireThat(same(identity(stat), expected), 'HOST', 'Allocated prefix was replaced or its owner changed');
}

async function ownedChildren(directory, binding, device) {
  const root = await realDirectory(directory);
  requireOwner(root, binding);
  requireThat(String(root.dev) === device, 'HOST', 'Prefix cleanup cannot cross filesystem boundaries');
  const children = [];
  for (const name of await fs.readdir(directory)) {
    const selected = path.join(directory, name);
    const stat = await fs.lstat(selected, { bigint: true });
    requireOwner(stat, binding);
    requireThat(String(stat.dev) === device &&
      (stat.isDirectory() || stat.isFile() || stat.isSymbolicLink()),
    'HOST', 'Prefix cleanup requires user-owned ordinary contents on the allocated filesystem');
    if (stat.isDirectory()) await ownedChildren(selected, binding, device);
    children.push({ selected, identity: identity(stat) });
  }
  requireThat(same(identity(root), identity(await realDirectory(directory))),
    'HOST', 'Prefix contents changed filesystem identity during ownership verification');
  return children;
}

function emptyDirectoryRemover(context) {
  const remove = context.removeEmptyDirectory ?? (selected => fs.rmdir(selected));
  requireThat(typeof remove === 'function', 'HOST', 'Prefix removal requires an empty-directory-only operation');
  return remove;
}

/**
 * Low-level ownership protocol, also used by repository-local filesystem regressions.
 * createDirectory must create exclusively; a failed/uncertain callback never grants ownership.
 * This primitive grants no elevation and does not bypass the production Mac/path policy.
 */
export async function allocateOwnedDirectory(context) {
  const { prefix, binding, createDirectory, claimDirectory } = context;
  const locations = await storage(context);
  const removeEmptyDirectory = emptyDirectoryRemover(context);
  requireThat(typeof prefix === 'string' && path.isAbsolute(prefix) && path.resolve(prefix) === prefix &&
    typeof createDirectory === 'function' && typeof claimDirectory === 'function',
  'HOST', 'Owned directory allocation requires an exact path and exclusive creation/claim operations');
  requireThat(await absent(prefix) && await absent(locations.allocation) && await absent(locations.cleanup),
    'HOST', 'Never adopt a pre-existing prefix or allocation');
  const request = requestValue(context, prefix);
  const requestDigest = await writeRecord(locations.request, request);
  let created;
  let markerDigest;
  let markerIdentity;
  try {
    await createDirectory(prefix);
    created = identity(await realDirectory(prefix));
    await claimDirectory(prefix);
    const root = await realDirectory(prefix);
    requireThat(root.dev.toString() === created.device && root.ino.toString() === created.inode &&
      root.birthtimeNs.toString() === created.created, 'HOST', 'Prefix identity changed during ownership transfer');
    requireOwner(root, binding);
    created = identity(root);
    requireThat((await fs.readdir(prefix)).length === 0, 'HOST', 'A newly allocated prefix must be empty');
    const markerPath = path.join(prefix, files.marker);
    markerDigest = await writeRecord(markerPath, { requestDigest, prefixIdentity: created });
    const marker = await readRecord(markerPath, binding);
    requireThat(marker.sha256 === markerDigest, 'HOST', 'New prefix marker changed before allocation commit');
    markerIdentity = marker.identity;
    const allocation = { schemaVersion: 1, requestDigest, prefixIdentity: created,
      markerDigest, markerIdentity: marker.identity };
    await writeRecord(locations.allocation, allocation);
    return { prefix, allocation };
  } catch (error) {
    let cleanupError;
    if (created) {
      try {
        const root = await realDirectory(prefix);
        requireThat(same(identity(root), created), 'HOST', 'Failed allocation changed identity; no cleanup permitted');
        if (markerDigest && markerIdentity) {
          const marker = await readRecord(path.join(prefix, files.marker), binding);
          requireThat(marker.sha256 === markerDigest && same(marker.identity, markerIdentity),
            'HOST', 'Failed allocation marker changed; no cleanup permitted');
          await fs.unlink(path.join(prefix, files.marker));
        }
        requireThat(same(identity(await realDirectory(prefix)), created),
          'HOST', 'Failed allocation changed identity before empty-directory removal');
        await removeEmptyDirectory(prefix);
        requireThat(await absent(prefix), 'HOST', 'Failed allocation empty-directory removal did not finish');
        await writeRecord(locations.cleanup, { schemaVersion: 1, requestDigest,
          status: 'rolled-back', prefixIdentity: created });
      } catch (cleanupFailure) { cleanupError = cleanupFailure; }
    }
    const original = failure(`Homebrew prefix allocation failed; retained request: ${locations.request}; ` +
      (cleanupError ? `rollback failed: ${cleanupError.message}` :
        created ? 'created empty prefix was rolled back' : 'creation was unconfirmed; no unknown path was removed'), error);
    if (cleanupError) original.cleanupError = cleanupError;
    throw original;
  }
}

async function liveOwnership(context, locations, request) {
  verifyRequest(request.value, context);
  const { prefix } = request.value;
  requireThat(await absent(locations.cleanup), 'HOST', 'A cleaned or rolled-back allocation is not live ownership');
  const allocation = await readRecord(locations.allocation, context.binding);
  const proof = allocation.value;
  requireThat(proof?.schemaVersion === 1 && proof.requestDigest === request.sha256 &&
    same(Object.keys(proof).sort(), ['schemaVersion', 'requestDigest', 'prefixIdentity',
      'markerDigest', 'markerIdentity'].sort()), 'HOST', 'Allocation proof does not match the original request');
  await verifyRoot(prefix, proof.prefixIdentity, context.binding);
  const marker = await readRecord(path.join(prefix, files.marker), context.binding);
  requireThat(marker.sha256 === proof.markerDigest && same(marker.identity, proof.markerIdentity) &&
    same(marker.value, { requestDigest: request.sha256, prefixIdentity: proof.prefixIdentity }),
  'HOST', 'Prefix marker is missing, replaced or does not match the retained allocation');
  await verifyRoot(prefix, proof.prefixIdentity, context.binding);
  return { prefix, allocation: proof };
}

/** Read-only ownership protocol shared by lifecycle proof checks and cleanup, including local FS regressions. */
export async function verifyOwnedDirectoryOwnership(context) {
  const locations = await storage(context);
  return liveOwnership(context, locations, await readRecord(locations.request, context.binding));
}

/** Verify ownership before user-level contents cleanup, then remove only the exact empty allocated root. */
export async function cleanupOwnedDirectory(context) {
  const locations = await storage(context);
  requireThat(!(await absent(locations.request)), 'HOST',
    'Missing prefix ownership request is not proof that allocation was unnecessary');
  const request = await readRecord(locations.request, context.binding);
  if (request.value?.kind === 'native-homebrew-prefix-not-required') {
    requireThat(same(request.value, { schemaVersion: 1, kind: 'native-homebrew-prefix-not-required',
      repositoryRoot: context.repositoryRoot, bootstrapDirectory: context.bootstrapDirectory, binding: context.binding }) &&
      await absent(locations.allocation) && await absent(locations.cleanup),
    'HOST', 'Conflicting not-required prefix ownership record');
    return { status: 'not-required', reason: 'No Homebrew prefix allocation was requested' };
  }
  verifyRequest(request.value, context);
  const { prefix } = request.value;
  if (!(await absent(locations.cleanup))) {
    const cleaned = await readRecord(locations.cleanup, context.binding);
    requireThat(cleaned.value?.schemaVersion === 1 && cleaned.value.requestDigest === request.sha256 &&
      ['removed', 'rolled-back'].includes(cleaned.value.status) && await absent(prefix),
    'HOST', 'Cleanup receipt conflicts with the prefix request or a replacement prefix');
    return { prefix, status: cleaned.value.status };
  }
  const { allocation: proof } = await liveOwnership(context, locations, request);
  const removeEmptyDirectory = emptyDirectoryRemover(context);
  const children = await ownedChildren(prefix, context.binding, proof.prefixIdentity.device);
  await verifyRoot(prefix, proof.prefixIdentity, context.binding);
  for (const child of children.filter(child => path.basename(child.selected) !== files.marker)) {
    await verifyRoot(prefix, proof.prefixIdentity, context.binding);
    requireThat(same(identity(await fs.lstat(child.selected, { bigint: true })), child.identity),
      'HOST', 'Prefix child was replaced before contents cleanup');
    await fs.rm(child.selected, { recursive: true });
  }
  const finalMarker = await readRecord(path.join(prefix, files.marker), context.binding);
  requireThat(finalMarker.sha256 === proof.markerDigest && same(finalMarker.identity, proof.markerIdentity) &&
    same(await fs.readdir(prefix), [files.marker]), 'HOST', 'Prefix changed before last-marker cleanup');
  await verifyRoot(prefix, proof.prefixIdentity, context.binding);
  await fs.unlink(path.join(prefix, files.marker));
  await verifyRoot(prefix, proof.prefixIdentity, context.binding);
  await removeEmptyDirectory(prefix);
  requireThat(await absent(prefix), 'HOST', 'Owned Homebrew prefix removal did not finish');
  await writeRecord(locations.cleanup, { schemaVersion: 1, requestDigest: request.sha256,
    status: 'removed', prefixIdentity: proof.prefixIdentity });
  return { prefix, status: 'removed' };
}

async function productionContext(options) {
  const environment = options.environment ?? process.env;
  const binding = homebrewPrefixBinding({ ...options, environment, host: nativeHost() });
  await verifyHomebrewSourceCheckout({ repositoryRoot: options.repositoryRoot, environment, binding });
  const context = { bootstrapDirectory: options.bootstrapDirectory, repositoryRoot: options.repositoryRoot, binding };
  await storage(context);
  return context;
}

function retainedEmptyPrefixRemoval(context, options) {
  requireThat(typeof options.run === 'function', 'HOST', 'Empty prefix removal requires retained command execution');
  return selected => options.run('brew-prefix-rmdir', '/usr/bin/sudo',
    ['-n', '/bin/rmdir', requireShortHomebrewPrefix(selected)], context.repositoryRoot,
    options.environment ?? process.env, 30_000);
}

/**
 * Caller must already verify uname/translation and retain run(name, command, args, cwd, environment, timeoutMs).
 * Call cleanupHomebrewPrefix with the same retained run callback in a same-job always step after validation.
 * Only exclusive mkdir, ownership transfer and empty-root rmdir use sudo; contents cleanup never does.
 * No PATH/export integration is performed here.
 */
export async function allocateHomebrewPrefix(options) {
  try {
    const context = await productionContext(options);
    requireThat(typeof options.run === 'function', 'HOST', 'Prefix provisioning requires retained command execution');
    requireThat(await fs.realpath('/opt') === '/opt' && (await fs.lstat('/opt')).isDirectory(),
      'HOST', 'The short prefix parent must be the real /opt directory');
    const prefix = requireShortHomebrewPrefix(`/opt/${randomBytes(3).toString('hex').slice(0, 5)}`);
    return await allocateOwnedDirectory({ ...context, prefix,
      removeEmptyDirectory: retainedEmptyPrefixRemoval(context, options),
      createDirectory: selected => options.run('brew-prefix-mkdir', '/usr/bin/sudo',
        ['-n', '/bin/mkdir', '-m', '0700', selected], context.repositoryRoot, options.environment ?? process.env, 30_000),
      claimDirectory: selected => options.run('brew-prefix-chown', '/usr/bin/sudo',
        ['-n', '/usr/sbin/chown', `${context.binding.host.uid}:${context.binding.host.gid}`, selected],
        context.repositoryRoot, options.environment ?? process.env, 30_000) });
  } catch (error) {
    if (error.code === 'HOST') throw error;
    throw failure('Short Homebrew prefix host prerequisite failed; original diagnostics identify the blocker', error);
  }
}

/**
 * Read-only, fail-closed proof for every external-prefix lifecycle mutation.
 * Pass SDLC_HOMEBREW_PREFIX_PROOF as bootstrapDirectory; callers must also match brew prefix/repository.
 * Completed, missing, tampered or replaced allocations never yield an optional success.
 */
export async function verifyHomebrewPrefixOwnership(options) {
  try {
    const context = await productionContext(options);
    const locations = await storage(context);
    const request = await readRecord(locations.request, context.binding);
    const prefix = requireShortHomebrewPrefix(request.value?.prefix);
    return await liveOwnership({ ...context, prefix }, locations, request);
  } catch (error) {
    if (error.code === 'HOST') throw error;
    throw failure('Homebrew prefix ownership proof could not be verified; no mutation is authorized', error);
  }
}

export async function cleanupHomebrewPrefix(options) {
  try {
    const context = await productionContext(options);
    const locations = await storage(context);
    const request = await readRecord(locations.request, context.binding);
    const prefix = request.value?.kind === 'native-homebrew-prefix-not-required' ? undefined :
      requireShortHomebrewPrefix(request.value?.prefix);
    return await cleanupOwnedDirectory({ ...context, prefix,
      removeEmptyDirectory: prefix === undefined ? undefined : retainedEmptyPrefixRemoval(context, options) });
  } catch (error) {
    if (error.code === 'HOST') throw error;
    throw failure('Homebrew prefix cleanup could not verify ownership; no unknown path may be removed', error);
  }
}

/** Explicit, exclusive non-allocation evidence; never infer this state from a missing request. */
export async function recordOwnedDirectoryNotRequired(context) {
  const locations = await storage(context);
  requireThat(await absent(locations.allocation) && await absent(locations.cleanup),
    'HOST', 'An existing allocation cannot be relabelled not-required');
  await writeRecord(locations.request, { schemaVersion: 1, kind: 'native-homebrew-prefix-not-required',
    repositoryRoot: context.repositoryRoot, bootstrapDirectory: context.bootstrapDirectory, binding: context.binding });
  return { status: 'not-required', reason: 'No Homebrew prefix allocation was requested' };
}

/** Use only when the bootstrap knows it never called allocation; missing/lost records are not equivalent. */
export async function recordHomebrewPrefixNotRequired(options) {
  try { return await recordOwnedDirectoryNotRequired(await productionContext(options)); }
  catch (error) {
    if (error.code === 'HOST') throw error;
    throw failure('Could not retain explicit Homebrew prefix non-allocation evidence', error);
  }
}
