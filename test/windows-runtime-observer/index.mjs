import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';

const home = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(home, '..', '..');
const dataRoot = path.join(repositoryRoot, '.test-data');
const images = new Set(['taskkill', 'node', 'node24']);
const reasons = new Set([
  'uncaptured', 'unsupportedRuntime', 'bridgeUnavailable', 'ownerUnverified',
  'ownerExited', 'ownerUnknown', 'released', 'invalidRequest',
  'deadlineBeforeCapture', 'captureUnavailable', 'deadline', 'targetExited', 'collectorFault',
]);
const resultKeys = [
  'schema', 'reason', 'ownerHandlePinned', 'ownerWaitStatus', 'compilerSandboxed',
  'tickEpoch', 'tickUnit', 'cpuTickUnit', 'threadWaits', 'deadlineMs',
  'perTargetSampleLimit', 'targetLimit', 'recordTruncated', 'durationMs', 'target', 'rootObservation',
];
const identityKeys = [
  'status', 'reason', 'image', 'handlePinned', 'creationTicks', 'capturedUtcMs',
  'sampleAttempts', 'samplesTruncated', 'lateSampleDropped', 'samples',
];
const sampleKeys = [
  'fromUtcMs', 'utcMs', 'elapsedMs', 'waitStatus', 'nativeExited',
  'exitTicks', 'exitCode', 'kernelTicks', 'userTicks', 'cpuTicks',
];
const exactKeys = (value, keys) => value && typeof value === 'object'
  && !Array.isArray(value) && Object.keys(value).sort().join() === [...keys].sort().join();
const number = (value, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  Number.isFinite(value) && value >= min && value <= max;
const boolean = value => typeof value === 'boolean';
const optional = (value, check) => value === null || check(value);
const tick = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value)
  && BigInt(value) <= 18446744073709551615n;
const wait = value => value === null || value === 0 || value === 258;
const unverifiedReasons = new Set([
  'uncaptured', 'captureUnavailable', 'creationAmbiguous', 'imageUnavailable',
  'imageMismatch', 'invalidRequest', 'deadlineBeforeCapture',
]);

export function validateObservation(value) {
  if (!exactKeys(value, resultKeys) || value.schema !== 2 || !reasons.has(value.reason)
    || !boolean(value.ownerHandlePinned) || !wait(value.ownerWaitStatus)
    || !boolean(value.compilerSandboxed) || value.tickEpoch !== '1601-01-01T00:00:00Z'
    || value.tickUnit !== '100ns' || value.cpuTickUnit !== '100ns'
    || value.threadWaits !== 'unavailable' || value.rootObservation !== 'unavailable'
    || value.deadlineMs !== 1000 || value.perTargetSampleLimit !== 8 || value.targetLimit !== 1
    || !boolean(value.recordTruncated) || !number(value.durationMs)) return false;
  const record = value.target;
  if (!exactKeys(record, identityKeys) || !['verified', 'unverified'].includes(record.status)
    || !boolean(record.handlePinned) || !optional(record.creationTicks, tick)
    || !optional(record.capturedUtcMs, number) || !Number.isInteger(record.sampleAttempts)
    || !number(record.sampleAttempts, 0, 32) || !boolean(record.samplesTruncated)
    || !boolean(record.lateSampleDropped) || !Array.isArray(record.samples)
    || record.samples.length > 8 || record.samples.length > record.sampleAttempts) return false;
  if (record.status === 'unverified') {
    return unverifiedReasons.has(record.reason) && record.image === null && !record.handlePinned
      && record.creationTicks === null && record.capturedUtcMs === null
      && record.sampleAttempts === 0 && record.samples.length === 0;
  }
  if (!['bound', 'exited'].includes(record.reason) || !images.has(record.image)
    || !record.handlePinned || record.creationTicks === null || record.capturedUtcMs === null
    || !value.ownerHandlePinned || !value.compilerSandboxed) return false;
  return record.samples.every(sample => {
    if (!exactKeys(sample, sampleKeys) || !number(sample.fromUtcMs) || !number(sample.utcMs)
      || sample.fromUtcMs > sample.utcMs || !number(sample.elapsedMs, 0, 1000)
      || sample.elapsedMs >= 1000 || !wait(sample.waitStatus)
      || !optional(sample.nativeExited, boolean) || !optional(sample.exitTicks, tick)
      || !optional(sample.exitCode, n => Number.isInteger(n) && number(n, 0, 4294967295))
      || ![sample.kernelTicks, sample.userTicks, sample.cpuTicks].every(n => optional(n, tick))) return false;
    if (sample.nativeExited !== (sample.waitStatus === 0 ? true : sample.waitStatus === 258 ? false : null)) {
      return false;
    }
    if (sample.nativeExited !== true && (sample.exitTicks !== null || sample.exitCode !== null)) return false;
    if (sample.exitTicks !== null && BigInt(sample.exitTicks) < BigInt(record.creationTicks)) return false;
    const cpu = [sample.kernelTicks, sample.userTicks, sample.cpuTicks];
    return cpu.every(n => n === null) || (cpu.every(n => n !== null)
      && BigInt(sample.cpuTicks) === BigInt(sample.kernelTicks) + BigInt(sample.userTicks));
  });
}

async function smallJson(filename, limit = 8192) {
  if ((await stat(filename)).size > limit) throw new Error('observer-record-oversize');
  const buffer = await readFile(filename);
  if (buffer.byteLength > limit) throw new Error('observer-record-oversize');
  return JSON.parse(buffer.toString('utf8'));
}

async function atomicJson(filename, value) {
  await writeFile(`${filename}.pending`, JSON.stringify(value), { flag: 'wx' });
  await rename(`${filename}.pending`, filename);
}

async function plainDirectory(directory) {
  const entry = await lstat(directory);
  return entry.isDirectory() && !entry.isSymbolicLink()
    && path.relative(directory, await realpath(directory)) === '';
}

async function observerDirectory(directory) {
  if (typeof directory !== 'string' || directory.length > 4096 || !path.isAbsolute(directory)
    || directory.split(/[\\/]/).some(part => part === '.' || part === '..')) {
    throw new Error('observer-invalid-directory');
  }
  const resolved = path.resolve(directory);
  const relative = path.relative(dataRoot, resolved);
  const parts = relative.split(path.sep);
  if (!relative || relative.length > 512 || path.isAbsolute(relative) || parts.length > 12
    || parts.some(part => !/^[a-z0-9][a-z0-9._-]{0,95}$/i.test(part) || part.endsWith('.')
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error('observer-invalid-directory');
  }
  try {
    if (!await plainDirectory(repositoryRoot) || !await plainDirectory(dataRoot)) {
      throw new Error('observer-invalid-directory');
    }
    let parent = dataRoot;
    for (const part of parts.slice(0, -1)) {
      parent = path.join(parent, part);
      if (!await plainDirectory(parent)) throw new Error('observer-invalid-directory');
    }
    try {
      await lstat(resolved);
      throw new Error('observer-invalid-directory');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  } catch {
    throw new Error('observer-invalid-directory');
  }
  return resolved;
}

// Use a NEW directory below repository .test-data, with existing plain parents.
// Await ready before target creation. Neither dispatch nor native observations
// may change the caller's original stop deadline or termination assertions.
export async function startWindowsRuntimeObserver({ directory, ownerPid, expectedImage }) {
  if (process.platform !== 'win32' || !Number.isInteger(ownerPid) || ownerPid <= 0
    || !images.has(expectedImage)) {
    throw new Error('observer-invalid-owner-or-image');
  }
  const resolved = await observerDirectory(directory);
  if (!process.env.SystemRoot || !path.isAbsolute(process.env.SystemRoot)) {
    throw new Error('observer-systemroot-unavailable');
  }
  const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const compilerSources = Object.fromEntries(await Promise.all(
    [['observerSha256', 'observer.ps1'], ['bridgeSha256', 'bridge.cs']].map(async ([key, name]) =>
      [key, createHash('sha256').update(await readFile(path.join(home, name))).digest('hex')]),
  ));
  await mkdir(resolved);
  if (!await plainDirectory(resolved)) throw new Error('observer-invalid-directory');
  const compilerDirectory = path.join(resolved, 'compiler');
  await mkdir(compilerDirectory);
  const nonce = randomBytes(16).toString('hex');
  const files = Object.fromEntries(['ready', 'request', 'captured', 'release', 'result']
    .map(kind => [kind, path.join(resolved, `${nonce}.${kind}.json`)]));
  files.compilerDirectory = compilerDirectory;
  files.bridgeAssembly = path.join(compilerDirectory, `${nonce}.bridge.dll`);
  files.compilerSettled = path.join(resolved, `${nonce}.compiler-settled.json`);
  const child = spawn(powershell, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(home, 'observer.ps1'),
    '-Directory', resolved, '-Nonce', nonce, '-OwnerPid', String(ownerPid),
    '-OwnerCreatedBeforeMs', String(Date.now()), '-ExpectedImage', expectedImage,
  ], {
    windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'],
    env: { ...process.env, TEMP: compilerDirectory, TMP: compilerDirectory },
  });
  let closed = false;
  let spawnFailed = false;
  let observerCreated = Number.isInteger(child.pid) && child.pid > 0;
  let compilerSettled = false;
  let stopAttempted = false;
  child.once('spawn', () => { observerCreated = true; });
  child.on('error', error => {
    if (!observerCreated && child.pid === undefined && !stopAttempted
      && ['ENOENT', 'EACCES', 'EPERM', 'ENOEXEC'].includes(error?.code)
      && error.syscall === `spawn ${powershell}` && error.path === powershell) {
      spawnFailed = true;
      compilerSettled = true;
    }
  });
  const exited = new Promise(resolve => child.once('close', (code, signal) => {
    closed = true;
    resolve({ code, signal, spawnFailed });
  }));
  async function marker(kind, timeoutMs) {
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      try { return await smallJson(files[kind], 256); }
      catch (error) {
        if (error.code !== 'ENOENT') throw new Error('observer-invalid-marker');
      }
      if (closed) return null;
      await sleep(10);
    }
    return null;
  }
  async function bounded(promise, timeoutMs) {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  async function refreshCompilerSettlement() {
    if (compilerSettled) return true;
    try {
      const value = await smallJson(files.compilerSettled, 256);
      if (exactKeys(value, ['schema', 'compilerSettled', 'observerSha256', 'bridgeSha256'])
        && value.schema === 1 && value.compilerSettled === true
        && value.observerSha256 === compilerSources.observerSha256
        && value.bridgeSha256 === compilerSources.bridgeSha256) compilerSettled = true;
    } catch {}
    return compilerSettled;
  }
  const completed = exited.then(async observerExit => {
    let observation = null;
    try {
      const value = await smallJson(files.result);
      if (validateObservation(value)) observation = value;
    } catch {}
    return { observation, observerExit, compilerSettled: await refreshCompilerSettlement() };
  });
  let isReady = false;
  const ready = marker('ready', 5000).then(async value => {
    if (!exactKeys(value, ['schema', 'ownerHandlePinned', 'compilerSandboxed'])
      || value.schema !== 2 || value.ownerHandlePinned !== true || value.compilerSandboxed !== true
      || !await refreshCompilerSettlement()) {
      throw new Error('observer-not-ready');
    }
    isReady = true;
    return { ready: true, ownerHandlePinned: true, compilerSandboxed: true, compilerSettled: true };
  });
  let requested = false;
  let finalization;
  let settledFinalization;
  let releaseAttempted = false;
  let releasePublished = false;
  let forcedObserverStop = false;
  let unrefAttempted = false;
  return {
    observerPid: child.pid,
    files,
    ready,
    completed,
    async request({ pid, createdBeforeMs }) {
      if (!isReady || requested || closed || !Number.isInteger(pid) || pid <= 0 || pid === ownerPid
        || !Number.isSafeInteger(createdBeforeMs) || createdBeforeMs <= 0) {
        throw new Error('observer-invalid-request');
      }
      requested = true;
      await atomicJson(files.request, { pid, createdBeforeMs });
    },
    async captured() {
      const value = await marker('captured', 1500);
      return exactKeys(value, ['schema', 'targetStatus'])
        && value.schema === 2 && value.targetStatus === 'verified';
    },
    finalize() {
      if (settledFinalization) return Promise.resolve(settledFinalization);
      finalization ??= (async () => {
        if (!releaseAttempted) {
          releaseAttempted = true;
          releasePublished = closed;
          if (!closed) {
            try { await atomicJson(files.release, { schema: 1 }); releasePublished = true; }
            catch {}
          }
        }
        let value = await bounded(completed, 2500);
        if (!value && !closed && !stopAttempted) {
          stopAttempted = true;
          // This is the original observer ChildProcess handle, never the target.
          try { forcedObserverStop = child.kill(); }
          catch { forcedObserverStop = null; }
          value = await bounded(completed, 1500);
        }
        const isCompilerSettled = await refreshCompilerSettlement();
        if (!value) {
          if (!unrefAttempted) {
            unrefAttempted = true;
            try { child.unref(); } catch {}
          }
          return {
            observation: null, observerExit: null, cleanup: 'unknown',
            forcedObserverStop, releasePublished, compilerSettled: isCompilerSettled,
          };
        }
        const result = {
          ...value, cleanup: isCompilerSettled ? 'awaited' : 'unknown',
          forcedObserverStop, releasePublished, compilerSettled: isCompilerSettled,
        };
        if (isCompilerSettled) settledFinalization = result;
        return result;
      })().finally(() => { finalization = undefined; });
      return finalization;
    },
  };
}
