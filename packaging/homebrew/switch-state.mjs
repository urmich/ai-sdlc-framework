import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const leaf = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9@+_.-]*$/u.test(value);

export async function linkState(file) {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isSymbolicLink()) return { kind: 'unidentified' };
    const target = await fs.readlink(file);
    return { kind: 'link', target, absolute: path.resolve(path.dirname(file), target) };
  } catch (error) {
    if (error.code === 'ENOENT') return { kind: 'absent' };
    throw error;
  }
}

export const ownsLauncher = (state, keg) => Boolean(keg) && state.kind === 'link' &&
  state.absolute === path.join(keg, 'bin', 'sdlc');

async function inventory(root, relative = '') {
  const result = [];
  for (const name of (await fs.readdir(path.join(root, relative))).sort()) {
    const entry = path.join(relative, name);
    const file = path.join(root, entry);
    const stat = await fs.lstat(file);
    if (stat.isDirectory()) result.push(...await inventory(root, entry));
    else if (stat.isSymbolicLink()) result.push({ path: entry, link: await fs.readlink(file) });
    else if (stat.isFile()) {
      // Homebrew may legitimately change installed-on-request flags in the receipt.
      if (entry !== 'INSTALL_RECEIPT.json') result.push({
        path: entry, mode: stat.mode & 0o777, sha256: sha256(await fs.readFile(file)),
      });
    } else throw new Error(`Unsupported Homebrew keg entry: ${file}`);
  }
  return result;
}

async function persist(state) {
  const candidate = path.join(state.root, `state-${randomUUID()}.json`);
  let created = false;
  let renamed = false;
  try {
    const handle = await fs.open(candidate, 'wx', 0o600);
    created = true;
    try {
      await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(candidate, state.stateFile);
    renamed = true;
  } finally {
    if (created && !renamed) await fs.rm(candidate, { force: true });
  }
}

export async function advanceSwitchState(state, phase) {
  state.phase = phase;
  await persist(state);
}

async function acquireState(prefix) {
  const base = path.join(prefix, 'var', 'ai-sdlc-framework-switch');
  await fs.mkdir(base, { recursive: true, mode: 0o700 });
  const lock = path.join(base, 'active.lock');
  let handle;
  try { handle = await fs.open(lock, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(`Another or interrupted Homebrew switch owns ${lock}; inspect its recorded recovery state before retrying`);
    }
    throw error;
  }
  const root = path.join(base, randomUUID());
  try {
    await fs.mkdir(root, { mode: 0o700 });
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, root })}\n`);
    return { root, lock };
  } catch (error) {
    await fs.unlink(lock);
    throw error;
  } finally {
    await handle.close();
  }
}

export async function findInstalledKeg(runBrew, formula, cellar, { optional = false, expectedKeg } = {}) {
  const prefix = expectedKeg ?? (await runBrew(['--prefix', formula])).stdout.trim();
  let keg;
  try { keg = await fs.realpath(prefix); }
  catch (error) {
    if (optional && error.code === 'ENOENT') return undefined;
    throw error;
  }
  const components = path.relative(cellar, keg).split(path.sep);
  if (components.length !== 2 || !components.every(leaf) ||
      components[0] !== formula.split('/').at(-1) || (expectedKeg && keg !== expectedKeg)) {
    throw new Error('Formula prefix is not an installed Homebrew Cellar keg');
  }
  const receipt = JSON.parse(await fs.readFile(path.join(keg, 'INSTALL_RECEIPT.json'), 'utf8'));
  const fullName = receipt.source?.tap && receipt.source.tap !== 'homebrew/core'
    ? `${receipt.source.tap}/${components[0]}` : components[0];
  if (formula.includes('/') && formula !== fullName) {
    throw new Error(`Installed keg belongs to ${fullName}, not ${formula}`);
  }
  return keg;
}

export async function resolveHomebrewCandidate(runBrew, formula, cellar) {
  const metadata = JSON.parse((await runBrew(['info', '--json=v2', '--formula', formula])).stdout);
  const info = metadata.formulae?.length === 1 ? metadata.formulae[0] : undefined;
  if (!info || !leaf(info.name) || info.name !== formula.split('/').at(-1) ||
      (formula.includes('/') && info.full_name !== formula) ||
      typeof info.versions?.stable !== 'string' ||
      !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(info.versions.stable) ||
      !Number.isSafeInteger(info.revision) || info.revision < 0) {
    throw new Error('Homebrew did not identify one exact stable candidate version/revision');
  }
  const version = info.versions.stable;
  const pkgVersion = `${version}${info.revision ? `_${info.revision}` : ''}`;
  return { name: info.name, version, revision: info.revision,
    pkgVersion, keg: path.join(cellar, info.name, pkgVersion) };
}

/** Capture every rollback input before the first mutating Homebrew command. */
export async function captureSwitchState({ prefix, cellar, formula, previousFormula, runBrew }) {
  const storage = await acquireState(prefix);
  const state = { schemaVersion: 1, ...storage, stateFile: path.join(storage.root, 'state.json'),
    prefix, cellar, formula, previousFormula, phase: 'capturing', kegs: [], links: [],
    destination: path.join(prefix, 'bin', 'sdlc') };
  try {
    state.capturedLink = await linkState(state.destination);
    state.targetKeg = await findInstalledKeg(runBrew, formula, cellar, { optional: true });
    state.previousKeg = previousFormula
      ? await findInstalledKeg(runBrew, previousFormula, cellar) : state.targetKeg;
    state.previousFormula = previousFormula ?? formula;
    if (state.capturedLink.kind !== 'absent' &&
        !ownsLauncher(state.capturedLink, state.previousKeg)) {
      throw new Error('Unidentified sdlc destination (including global npm links); no Homebrew install or framework mutation was attempted');
    }
    const roots = [...new Set([state.targetKeg, state.previousKeg].filter(Boolean))];
    const liveQueue = [...roots];
    const historicalQueue = [];
    state.installedVersions = [];
    for (const directory of new Set(roots.map(keg => path.dirname(keg)))) {
      const versions = [];
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        if (!entry.isDirectory() || !leaf(entry.name)) throw new Error(`Unexpected installed version entry: ${directory}/${entry.name}`);
        versions.push(entry.name);
        historicalQueue.push(path.join(directory, entry.name));
      }
      state.installedVersions.push({ directory, versions: versions.sort() });
    }
    const seen = new Set();
    const currentDependencies = new Map();
    let liveIndex = 0;
    let historicalIndex = 0;
    // Finish the required graph first; inactive receipts never add live edges.
    while (liveIndex < liveQueue.length || historicalIndex < historicalQueue.length) {
      const live = liveIndex < liveQueue.length;
      const keg = live ? liveQueue[liveIndex++] : historicalQueue[historicalIndex++];
      if (seen.has(keg)) continue;
      seen.add(keg);
      const components = path.relative(cellar, keg).split(path.sep);
      if (components.length !== 2 || !components.every(leaf) ||
          !(await fs.lstat(keg)).isDirectory() ||
          await fs.realpath(keg) !== keg) throw new Error(`Invalid rollback keg: ${keg}`);
      const receiptBytes = await fs.readFile(path.join(keg, 'INSTALL_RECEIPT.json'));
      const receipt = JSON.parse(receiptBytes);
      if (!Array.isArray(receipt.runtime_dependencies)) throw new Error(`Missing dependency state: ${keg}`);
      const backup = path.join(state.root, 'kegs', String(state.kegs.length));
      const files = await inventory(keg);
      await fs.cp(keg, backup, { recursive: true, verbatimSymlinks: true,
        force: false, errorOnExist: true, mode: constants.COPYFILE_FICLONE });
      if (JSON.stringify(await inventory(backup)) !== JSON.stringify(files)) {
        throw new Error(`Keg changed while capturing rollback state: ${keg}`);
      }
      if (sha256(await fs.readFile(path.join(backup, 'INSTALL_RECEIPT.json'))) !== sha256(receiptBytes)) {
        throw new Error(`Keg receipt changed while capturing rollback state: ${keg}`);
      }
      const dependencies = [];
      state.kegs.push({ path: keg, name: components[0], version: components[1],
        role: live ? 'live' : 'historical',
        receipt, receiptSha256: sha256(receiptBytes), backup, files, dependencies });
      for (const dependency of receipt.runtime_dependencies) {
        const name = dependency.full_name?.split('/').at(-1);
        if (!leaf(name) || !leaf(dependency.pkg_version) ||
            !/^(?:[a-zA-Z0-9][a-zA-Z0-9_-]*\/[a-zA-Z0-9][a-zA-Z0-9_-]*\/)?[a-zA-Z0-9][a-zA-Z0-9@+_.-]*$/u.test(dependency.full_name)) {
          throw new Error('Invalid dependency rollback identity');
        }
        const requiredLive = live && dependency.declared_directly !== false;
        let currentKeg;
        if (requiredLive) {
          if (!currentDependencies.has(dependency.full_name)) {
            currentDependencies.set(dependency.full_name,
              await findInstalledKeg(runBrew, dependency.full_name, cellar));
          }
          currentKeg = currentDependencies.get(dependency.full_name);
          liveQueue.push(currentKeg);
        }
        const historicalKeg = path.join(cellar, name, dependency.pkg_version);
        let historicalPresent;
        try {
          await fs.lstat(historicalKeg);
          historicalPresent = true;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          historicalPresent = false;
        }
        dependencies.push({ fullName: dependency.full_name, recordedVersion: dependency.pkg_version,
          historicalKeg, historicalPresent, requiredLive, ...(requiredLive ? { currentKeg } : {}) });
        if (historicalPresent) historicalQueue.push(historicalKeg);
      }
      for (const file of [path.join(prefix, 'opt', components[0]),
        path.join(prefix, 'var', 'homebrew', 'linked', components[0])]) {
        if (state.links.some(link => link.path === file)) continue;
        const captured = await linkState(file);
        if (captured.kind === 'unidentified' || (captured.kind === 'link' &&
            path.dirname(captured.absolute) !== path.join(cellar, components[0]))) {
          throw new Error(`Unidentified Homebrew rollback link: ${file}`);
        }
        state.links.push({ path: file, name: components[0], captured });
        if (captured.kind === 'link') {
          try {
            await fs.lstat(captured.absolute);
            historicalQueue.push(captured.absolute);
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
          }
        }
      }
    }
    state.phase = 'captured-before-brew';
    state.capturedBeforeBrew = true;
    await persist(state);
    return state;
  } catch (error) {
    await fs.rm(state.root, { recursive: true, force: true });
    await fs.unlink(state.lock);
    throw error;
  }
}

export async function verifyCapturedKegs(state) {
  try {
    await preserveCapturedKegs(state, { restoreMissing: false });
  } catch (error) {
    const unsupported = new Error(`Captured keg retention is unsupported: ${error.message}`,
      { cause: error });
    unsupported.code = 'HOMEBREW_RETENTION_UNSUPPORTED';
    throw unsupported;
  }
}

export async function preserveCapturedKegs(state, { restoreMissing = true } = {}) {
  for (const keg of state.kegs) {
    try {
      if (!(await fs.lstat(keg.path)).isDirectory() || await fs.realpath(keg.path) !== keg.path) {
        throw new Error(`Captured keg was replaced by an unidentified entry: ${keg.path}`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!restoreMissing) throw new Error(`Homebrew did not retain the captured keg: ${keg.path}`, { cause: error });
      await fs.mkdir(path.dirname(keg.path), { recursive: true });
      if (await fs.realpath(path.dirname(keg.path)) !== path.dirname(keg.path)) {
        throw new Error(`Captured keg parent was replaced: ${keg.path}`);
      }
      await fs.mkdir(keg.path);
      for (const name of await fs.readdir(keg.backup)) {
        await fs.cp(path.join(keg.backup, name), path.join(keg.path, name),
          { recursive: true, verbatimSymlinks: true,
            force: false, errorOnExist: true, mode: constants.COPYFILE_FICLONE });
      }
    }
    if (JSON.stringify(await inventory(keg.path)) !== JSON.stringify(keg.files)) {
      throw new Error(`Captured keg was modified; recovery will not overwrite it: ${keg.path}`);
    }
    const receipt = JSON.parse(await fs.readFile(path.join(keg.path, 'INSTALL_RECEIPT.json'), 'utf8'));
    const { installed_on_request: beforeRequested, ...before } = keg.receipt;
    const { installed_on_request: afterRequested, ...after } = receipt;
    if (!isDeepStrictEqual(before, after)) {
      throw new Error(`Captured keg dependency/receipt state changed: ${keg.path}`);
    }
  }
}

async function restoreLink(file, captured, isOwned) {
  const current = await linkState(file);
  if (current.kind === captured.kind && current.target === captured.target) return;
  if (current.kind !== 'absent') {
    if (current.kind !== 'link' || !isOwned(current)) {
      throw new Error(`Unidentified replacement retained at ${file}`);
    }
    await fs.unlink(file);
  }
  if (captured.kind === 'link') {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.symlink(captured.target, file);
  }
}

export async function finishSwitchState(state, { error, newKeg } = {}) {
  let recoveryError;
  if (error) {
    try {
      await preserveCapturedKegs(state);
      for (const link of state.links) {
        await restoreLink(link.path, link.captured, current =>
          current.absolute === newKeg || state.kegs.some(keg => keg.path === current.absolute));
      }
      await restoreLink(state.destination, state.capturedLink, current =>
        ownsLauncher(current, newKeg) || ownsLauncher(current, state.previousKeg));
    } catch (failure) {
      recoveryError = failure;
    }
  }
  state.phase = recoveryError ? 'incomplete-recovery' : error ? 'rolled-back' : 'complete';
  state.error = error?.message;
  state.recoveryError = recoveryError?.message;
  try {
    await persist(state);
    if (!recoveryError) await fs.rm(path.join(state.root, 'kegs'), { recursive: true, force: true });
    await fs.unlink(state.lock);
  } catch (failure) {
    const incomplete = new Error(`Homebrew switch ${error ? 'recovery' : 'completed'}, but recovery-state cleanup is incomplete. Inspect ${state.stateFile} and ${state.lock}: ${failure.message}`,
      { cause: failure });
    incomplete.code = 'HOMEBREW_SWITCH_CLEANUP_INCOMPLETE';
    incomplete.details = { stateFile: state.stateFile, phase: state.phase };
    throw incomplete;
  }
  if (error) {
    const failure = new Error(`Homebrew switch failed; ${recoveryError
      ? `recovery incomplete: ${recoveryError.message}`
      : 'captured payloads and owned links restored'}. Framework changes are not rolled back. Runtime-retention flags may remain set. Recovery record: ${state.stateFile}. ${error.message}`,
    { cause: error });
    failure.code = recoveryError ? 'HOMEBREW_SWITCH_INCOMPLETE' : 'HOMEBREW_SWITCH_FAILED';
    failure.details = { stateFile: state.stateFile, phase: state.phase };
    throw failure;
  }
  return { stateFile: state.stateFile };
}
