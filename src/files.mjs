import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { canonical, digest, newId, parseJson, LIMITS, requireThat } from './core.mjs';
import { isWindowsDevicePath, sameNativePath, withinNativePath } from './platform.mjs';

export async function exists(file) {
  try { await fs.lstat(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
export async function canonicalPath(file) {
  requireThat(process.platform !== 'win32' || !isWindowsDevicePath(file),
    'PATH', 'Windows device namespace paths are unsupported');
  const absolute = path.resolve(file);
  try { return await fs.realpath(absolute); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = path.dirname(absolute);
    if (parent === absolute) throw error;
    return path.join(await canonicalPath(parent), path.basename(absolute));
  }
}
export function within(root, file) {
  return withinNativePath(root, file);
}
export async function safePath(root, relative) {
  requireThat(typeof relative === 'string' && relative && !path.isAbsolute(relative), 'PATH', 'Expected a relative path');
  const canonicalRoot = await canonicalPath(root);
  const absolute = path.resolve(canonicalRoot, relative);
  let current = canonicalRoot;
  for (const part of path.relative(canonicalRoot, absolute).split(path.sep)) {
    if (!part || part === '.') continue;
    const candidate = path.join(current, part);
    try {
      const stat = await fs.lstat(candidate);
      if (stat.isSymbolicLink()) {
        const target = path.resolve(path.dirname(candidate),
          await fs.readlink(candidate));
        const resolvedTarget = await canonicalPath(target);
        requireThat(within(canonicalRoot, resolvedTarget), 'PATH',
          `Path escapes its root through a symlink: ${relative}`);
        current = resolvedTarget;
      } else {
        current = candidate;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      current = candidate;
    }
  }
  const result = await canonicalPath(absolute);
  requireThat(within(canonicalRoot, result), 'PATH', `Path escapes its root: ${relative}`);
  return result;
}
export async function privateDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
}
export async function readBytes(file, limit = LIMITS.input) {
  if (file instanceof URL) file = fileURLToPath(file);
  requireThat(sameNativePath(await canonicalPath(file), path.resolve(file)), 'PATH', `Refusing an unresolved symlink read: ${file}`);
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    requireThat(stat.isFile() && stat.size <= limit, 'CAPACITY', `File is not regular or exceeds ${limit} bytes: ${file}`);
    const result = await handle.readFile();
    requireThat(result.length <= limit, 'CAPACITY', `File grew beyond ${limit} bytes: ${file}`);
    return result;
  } finally { await handle.close(); }
}
export async function readJson(file, { optional = false, limit = LIMITS.input } = {}) {
  try { return parseJson((await readBytes(file, limit)).toString('utf8'), limit); }
  catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
}
async function syncDirectory(directory) {
  let handle;
  try {
    handle = await fs.open(directory, 'r');
    await handle.sync();
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EISDIR', ...(process.platform === 'win32' ? ['EPERM', 'EACCES'] : [])].includes(error.code)) throw error;
  } finally { if (handle) await handle.close(); }
}
export async function atomicWrite(file, content, {
  fault = async () => {},
  mode = 0o600,
  platform = process.platform,
  rename = fs.rename,
  sleep = delay,
  replaceRetryMs = 100,
} = {}) {
  await privateDirectory(path.dirname(file));
  requireThat(sameNativePath(await canonicalPath(file), path.resolve(file)), 'PATH', `Refusing symlink destination: ${file}`);
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${newId('write')}`);
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', mode);
    await fault('created');
    await handle.writeFile(content);
    await fault('written');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fault('flushed');
    const deadline = Date.now() + replaceRetryMs;
    while (true) {
      try {
        await rename(temporary, file);
        break;
      } catch (error) {
        if (platform !== 'win32' || !['EACCES', 'EBUSY', 'EPERM'].includes(error.code) ||
            Date.now() >= deadline) throw error;
        await sleep(10);
      }
    }
    await fault('replaced');
    await syncDirectory(path.dirname(file));
    await fault('directory-flushed');
  } finally {
    if (handle) await handle.close();
    await fs.rm(temporary, { force: true });
  }
}
export async function writeJson(file, value, options) { await atomicWrite(file, `${canonical(value)}\n`, options); }

function confirmedDead(owner) {
  if (!owner || owner.host !== os.hostname() || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || !owner.token) return false;
  try { process.kill(owner.pid, 0); return false; }
  catch (error) { if (error.code === 'ESRCH') return true; if (error.code === 'EPERM') return false; throw error; }
}
async function recoverDeadLockGuarded(file) {
  const current = await readJson(file, { optional: true, limit: 2048 });
  if (!confirmedDead(current)) return false;
  const recovery = `${file}.${newId('recovery')}.stale`;
  try {
    try { await fs.rename(file, recovery); }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    const moved = await readJson(recovery, { limit: 2048 });
    requireThat(moved.token === current.token && confirmedDead(moved),
      'LOCK_OWNER', 'Lock ownership changed during dead-owner recovery');
    await fs.unlink(recovery);
    return true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return true;
  }
}
async function withRecoveryGuard(file, action) {
    const guard = `${file}.recovery-guard`;
    try { await fs.mkdir(guard, { mode: 0o700 }); }
    catch (error) {
      if (error.code === 'EEXIST') {
        const owner = await readJson(path.join(guard, 'owner.json'), {
          optional: true,
          limit: 2048,
        }).catch(readError => {
          if (['ENOENT', 'JSON'].includes(readError.code)) return null;
          throw readError;
        });
        if (!confirmedDead(owner)) return { acquired: false };
        let claim;
        try {
          claim = await fs.open(path.join(guard, 'reclaim'), 'wx', 0o600);
        } catch (claimError) {
          if (['EEXIST', 'ENOENT'].includes(claimError.code)) {
            return { acquired: false };
          }
          throw claimError;
        }
        await claim.close();
        const confirmed = await readJson(path.join(guard, 'owner.json'), {
          optional: true,
          limit: 2048,
        });
        if (confirmed?.token !== owner.token || !confirmedDead(confirmed)) {
          await fs.unlink(path.join(guard, 'reclaim'));
          return { acquired: false };
        }
        await fs.rm(guard, { recursive: true });
        return withRecoveryGuard(file, action);
      }
      throw error;
    }
    try {
      await writeJson(path.join(guard, 'owner.json'), {
        token: newId('recovery'),
        host: os.hostname(),
        pid: process.pid,
        acquiredAt: new Date().toISOString(),
      });
      return { acquired: true, value: await action() };
    } finally {
      await fs.rm(guard, { recursive: true });
    }
}
export async function recoverDeadLock(file) {
  const guarded = await withRecoveryGuard(file, () =>
    recoverDeadLockGuarded(file));
  return guarded.acquired ? guarded.value : false;
}
async function recoverStaleQuarantines(file) {
  const directory = path.dirname(file);
  const prefix = `${path.basename(file)}.`;
  for (const name of await fs.readdir(directory)) {
    if (!name.startsWith(prefix) || !name.endsWith('.stale')) continue;
    const stale = path.join(directory, name);
    const owner = await readJson(stale, { optional: true, limit: 2048 });
    if (confirmedDead(owner)) await fs.unlink(stale);
  }
}
export async function withLock(file, action, {
  waitMs = 250,
  retryMs = 10,
  clock = Date,
  sleep = delay,
  fault = async () => {},
} = {}) {
  await privateDirectory(path.dirname(file));
  requireThat(sameNativePath(await canonicalPath(file), path.resolve(file)), 'PATH', 'Lock path is a symlink');
  const owner = { token: newId('owner'), host: os.hostname(), pid: process.pid, acquiredAt: new Date(clock.now()).toISOString() };
  const deadline = clock.now() + waitMs;
  const candidate = `${file}.${owner.token}.candidate`;
  let published = false;
  try {
    while (!published) {
      let handle;
      try {
        handle = await fs.open(candidate, 'wx', 0o600);
        await handle.writeFile(canonical(owner));
        await handle.sync();
        await handle.close();
        handle = undefined;
        const guarded = await withRecoveryGuard(file, async () => {
          await recoverStaleQuarantines(file);
          try {
            await fs.link(candidate, file);
            return true;
          } catch (error) {
            if (error.code !== 'EEXIST') throw error;
            if (!await recoverDeadLockGuarded(file)) return false;
            await fs.link(candidate, file);
            return true;
          }
        });
        requireThat(guarded.acquired && guarded.value, 'LOCK_BUSY',
          'State is locked or lock recovery is in progress');
        published = true;
      } catch (error) {
        if (error.code !== 'LOCK_BUSY') throw error;
        requireThat(clock.now() < deadline, 'LOCK_BUSY', 'State is locked or ownership is unverifiable; retry recovery', { lock: file });
        await sleep(Math.min(retryMs, Math.max(1, deadline - clock.now())));
      } finally {
        if (handle) await handle.close();
        if (published) await fault('candidate-published');
        try { await fs.unlink(candidate); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
    return await action();
  } finally {
    if (published) {
      const current = await readJson(file, { optional: true, limit: 2048 });
      requireThat(current?.token === owner.token, 'LOCK_OWNER', 'Lock ownership changed; refusing to remove another owner');
      await fs.unlink(file);
    }
  }
}
export async function updateJson(file, initial, update, { expectedRevision, limit = LIMITS.input, ...lockOptions } = {}) {
  return withLock(`${file}.lock`, async () => {
    const before = await readJson(file, { optional: true, limit }) ?? structuredClone(initial);
    requireThat(Number.isSafeInteger(before.revision), 'SCHEMA', 'Mutable record requires a revision');
    if (expectedRevision !== undefined) requireThat(before.revision === expectedRevision, 'STALE', 'Revision changed; recompute the update');
    const after = await update(structuredClone(before));
    after.revision = before.revision + 1;
    requireThat(Buffer.byteLength(canonical(after)) <= limit, 'CAPACITY', `Store exceeds ${limit} bytes`);
    await writeJson(file, after);
    return after;
  }, lockOptions);
}
export async function listJson(directory) {
  let names;
  try { names = await fs.readdir(directory); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  return names.filter(name => name.endsWith('.json')).sort();
}
export async function immutableJson(file, value, options) {
  const old = await readJson(file, { optional: true });
  requireThat(!old || digest(old) === digest(value), 'ID_CONFLICT', 'Immutable identifier reused with different content');
  if (!old) await writeJson(file, value, options);
  return old ?? value;
}
