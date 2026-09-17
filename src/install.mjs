import path from 'node:path';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { LIMITS, canonical, digest, id, object, requireThat, SdlcError, text } from './core.mjs';
import { atomicWrite, canonicalPath, exists, readBytes, readJson,
  recoverDeadLock, safePath, updateJson, withLock, within,
  writeJson } from './files.mjs';
import { platformCapabilities } from './platform.mjs';

const SOURCE_ROOT = fileURLToPath(new URL('../', import.meta.url));
const INSTALL_LOCK = '.ai-sdlc-framework.install.lock';
const MAX_PROCESS_ID = 0x7fffffff;
const INVALID_LOCK_STALE_MS = 1000;
const REQUIRED_INSTALLED_FILES = [
  'sdlc/bin/sdlc.mjs',
  ...['artifacts', 'audit', 'authority', 'checks', 'cli', 'core', 'decisions',
    'files', 'gate', 'git', 'hooks', 'install', 'monitors', 'operations',
    'platform', 'policy', 'pr', 'provider-adapters', 'recovery', 'schemas',
    'staging', 'store',
    'validation'].map(name => `sdlc/src/${name}.mjs`),
  'sdlc/package.json',
  'hooks/sdlc.json',
  'sdlc/cli.md',
  'sdlc/provider-adapters.md',
  'sdlc/lifecycle-intent.md',
  ...['sdlc', 'sdlc-requirements', 'sdlc-test-design',
    'sdlc-technical-design', 'sdlc-coding'].map(name =>
    `skills/${name}/SKILL.md`),
  ...['engineering-instructions', 'requirements', 'technical-design',
    'test-plan'].map(name => `sdlc/templates/${name}.md`),
  ...['knowledge-retrieval', 'coding', 'testing', 'building',
    'reviewing'].map(name => `sdlc/instructions/${name}.md`),
];
export const BLOCK_START = '<!-- ai-sdlc-framework:start -->';
export const BLOCK_END = '<!-- ai-sdlc-framework:end -->';
export const HOOK_EVENTS = ['sessionStart', 'userPromptSubmitted', 'preToolUse', 'postToolUse', 'postToolUseFailure', 'preCompact', 'agentStop', 'sessionEnd'];
async function prepareMaintenanceHome(store) {
  await fs.mkdir(store.home, { recursive: true, mode: 0o700 });
  store.home = await canonicalPath(store.home);
  store.runtime = path.join(store.home, 'sdlc', 'runtime');
}
function installLock(store) {
  return path.join(store.home, INSTALL_LOCK);
}
async function purgeOwnedPath(root, relative) {
  requireThat(typeof relative === 'string' && relative &&
    !path.isAbsolute(relative) &&
    !relative.split(/[\\/]/u).includes('..'),
  'PATH', 'Purge requires a literal framework-owned relative path');
  const parts = relative.split(/[\\/]/u);
  let current = await canonicalPath(root);
  for (let index = 0; index < parts.length - 1; index++) {
    const part = parts[index];
    const next = path.join(current, part);
    let stat;
    try { stat = await fs.lstat(next); }
    catch (error) {
      if (error.code === 'ENOENT') return path.join(current, ...parts.slice(index));
      throw error;
    }
    requireThat(!stat.isSymbolicLink() && stat.isDirectory(), 'PATH',
      `Purge refuses to traverse a symlink or non-directory parent: ${relative}`);
    current = next;
  }
  return path.join(current, parts.at(-1));
}
async function preparePurgeLock(file) {
  let stat;
  try { stat = await fs.lstat(file); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  requireThat(!stat.isSymbolicLink(), 'LOCK_BUSY',
    'Purge refuses a symbolic-link install lock');
  let owner;
  try { owner = await readJson(file, { optional: true, limit: 2048 }); }
  catch (error) {
    if (!['JSON', 'CAPACITY'].includes(error.code)) throw error;
  }
  const valid = owner?.host &&
    Number.isSafeInteger(owner.pid) && owner.pid > 0 &&
    owner.pid <= MAX_PROCESS_ID && owner.token;
  if (valid) {
    requireThat(owner.host === os.hostname(), 'LOCK_BUSY',
      'Purge cannot verify an install lock created by another host');
    try {
      process.kill(owner.pid, 0);
      requireThat(false, 'LOCK_BUSY',
        'Another live process owns the framework install lock');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
    requireThat(await recoverDeadLock(file), 'LOCK_BUSY',
      'Install lock changed during recovery');
    return;
  }
  requireThat(Date.now() - stat.mtimeMs >= INVALID_LOCK_STALE_MS,
    'LOCK_BUSY',
    'Invalid install lock is too recent to prove it was abandoned');
  const guard = `${file}.invalid-recovery`;
  try { await fs.mkdir(guard, { mode: 0o700 }); }
  catch (error) {
    if (error.code === 'EEXIST') {
      throw new SdlcError('LOCK_BUSY',
        'Another process is recovering the invalid install lock');
    }
    throw error;
  }
  try {
    const current = await fs.lstat(file);
    requireThat(current.dev === stat.dev && current.ino === stat.ino &&
      current.size === stat.size && current.mtimeMs === stat.mtimeMs,
    'LOCK_BUSY', 'Install lock changed during recovery');
    await fs.unlink(file);
  } finally {
    await fs.rmdir(guard);
  }
}
async function prepareLegacyInstallLock(store) {
  const legacyRoot = await purgeOwnedPath(store.home, 'sdlc');
  let stat;
  try { stat = await fs.lstat(legacyRoot); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (stat.isSymbolicLink()) return;
  requireThat(stat.isDirectory(), 'PATH',
    'Purge refuses a non-directory legacy framework root');
  await preparePurgeLock(path.join(legacyRoot, '.install.lock'));
}
async function sourceVersion(sourceRoot = SOURCE_ROOT) {
  const pkg = await readJson(path.join(sourceRoot, 'package.json'));
  requireThat(typeof pkg.version === 'string' && pkg.version, 'INSTALL',
    'Package version is unavailable');
  return pkg.version;
}
async function filesUnder(root, prefix = '') {
  const result = [];
  for (const entry of await fs.readdir(path.join(root, prefix), { withFileTypes: true })) {
    requireThat(!entry.isSymbolicLink(), 'PATH', 'Distribution contains an unexpected symlink');
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(root, relative));
    else if (entry.isFile()) result.push(relative);
    else requireThat(false, 'PATH', `Distribution contains an unsupported filesystem entry: ${relative}`);
  }
  return result;
}
export function canonicalInstalledText(content) {
  return Buffer.from(content.toString('utf8').replace(/\r\n?/gu, '\n'));
}
export function ownedBlock(contents) {
  const start = contents.indexOf(BLOCK_START);
  const end = contents.indexOf(BLOCK_END);
  if (start < 0 && end < 0) return null;
  requireThat(start >= 0 && end >= start && contents.indexOf(BLOCK_START, start + 1) < 0 &&
    contents.indexOf(BLOCK_END, end + 1) < 0, 'INSTALL_CONFLICT', 'Instructions contain duplicate or incomplete ownership delimiters');
  return { start, end: end + BLOCK_END.length, text: contents.slice(start, end + BLOCK_END.length) };
}
export async function selectMaintenanceSource(store, input) {
  object(input, ['sessionId', 'receiptId', 'input', 'sourceRoot'],
    ['sessionId', 'receiptId', 'input', 'sourceRoot']);
  const sessionId = id(input.sessionId, 'session ID');
  const receiptId = id(input.receiptId, 'receipt ID');
  text(input.input, 'complete user input', LIMITS.input);
  const receipt = await readJson(path.join(store.runtime, 'sessions', sessionId,
    'receipts', `${receiptId}.json`));
  requireThat(receipt.sessionId === sessionId &&
    ['userPromptSubmitted', 'ask_user'].includes(receipt.source) &&
    receipt.inputDigest === digest(input.input),
  'PROVENANCE', 'Maintenance source selection requires the matching captured user input');
  const sourceRoot = await canonicalPath(input.sourceRoot);
  const pkg = await readJson(path.join(sourceRoot, 'package.json'));
  requireThat(pkg.name === 'ai-sdlc-framework' && typeof pkg.version === 'string',
    'INSTALL', 'Selected maintenance source is not an ai-sdlc-framework package');
  const entry = await canonicalPath(path.join(sourceRoot, 'bin', 'sdlc.mjs'));
  requireThat(await exists(entry), 'INSTALL', 'Selected maintenance source has no CLI entry');
  await updateJson(store.sessionPath(sessionId),
    { schemaVersion: 1, revision: 0, sessionId },
    session => {
      const roots = session.maintenanceSourceRoots ?? [];
      session.maintenanceSourceRoots = [...new Set([...roots, sourceRoot])].slice(-8);
      session.maintenanceSelectionReceiptId = receiptId;
      return session;
    });
  return { selected: true, sessionId, sourceRoot, frameworkVersion: pkg.version };
}
export async function distribution(home, sourceRoot = SOURCE_ROOT) {
  const files = new Map();
  const entry = path.join(home, 'sdlc', 'bin', 'sdlc.mjs');
  const substitutions = {
    NODE_EXECUTABLE: process.execPath,
    SDLC_ENTRY: entry,
    SDLC_HOME: path.join(home, 'sdlc'),
    KNOWLEDGE_INSTRUCTIONS: path.join(home, 'sdlc', 'instructions', 'knowledge-retrieval.md'),
    CODING_INSTRUCTIONS: path.join(home, 'sdlc', 'instructions', 'coding.md'),
    TESTING_INSTRUCTIONS: path.join(home, 'sdlc', 'instructions', 'testing.md'),
    BUILDING_INSTRUCTIONS: path.join(home, 'sdlc', 'instructions', 'building.md'),
    REVIEWING_INSTRUCTIONS: path.join(home, 'sdlc', 'instructions', 'reviewing.md'),
    LIFECYCLE_INTENT_INSTRUCTIONS: path.join(home, 'sdlc',
      'lifecycle-intent.md'),
  };
  const render = content => {
    let text = canonicalInstalledText(content).toString('utf8');
    for (const [marker, value] of Object.entries(substitutions)) {
      text = text.replaceAll(`{{${marker}}}`, () =>
        JSON.stringify(value).replaceAll('`', '\\u0060'));
    }
    return Buffer.from(text);
  };
  for (const directory of ['bin', 'src']) {
    for (const relative of await filesUnder(path.join(sourceRoot, directory))) {
      const target = path.posix.join('sdlc', directory, relative.split(path.sep).join('/'));
      files.set(target, canonicalInstalledText(
        await readBytes(path.join(sourceRoot, directory, relative), LIMITS.artifact)));
    }
  }
  files.set('sdlc/package.json',
    canonicalInstalledText(await readBytes(path.join(sourceRoot, 'package.json'), LIMITS.artifact)));
  for (const directory of ['skills', 'templates', 'instructions']) {
    for (const relative of await filesUnder(path.join(sourceRoot, 'assets', directory))) {
      const target = directory === 'skills' ?
        path.posix.join(directory, relative.split(path.sep).join('/')) :
        path.posix.join('sdlc', directory, relative.split(path.sep).join('/'));
      const content = await readBytes(path.join(sourceRoot, 'assets', directory, relative));
      files.set(target, directory === 'skills' ? render(content) : canonicalInstalledText(content));
    }
  }
  const hooks = await readJson(path.join(sourceRoot, 'assets', 'hooks', 'sdlc.json'));
  for (const handlers of Object.values(hooks.hooks)) for (const handler of handlers) {
    handler.exec = process.execPath;
    handler.args = [...handler.args.map(arg => arg === '__SDLC_ENTRY__' ? entry : arg), '--home', home];
  }
  files.set('hooks/sdlc.json', Buffer.from(`${canonical(hooks)}\n`));
  files.set('sdlc/cli.md', canonicalInstalledText(
    await readBytes(path.join(sourceRoot, 'docs', 'cli.md'))));
  files.set('sdlc/provider-adapters.md', canonicalInstalledText(
    await readBytes(path.join(sourceRoot, 'docs', 'provider-adapters.md'))));
  files.set('sdlc/lifecycle-intent.md', canonicalInstalledText(
    await readBytes(path.join(sourceRoot, 'assets', 'lifecycle-intent.md'))));
  const instructions = render(
    await readBytes(path.join(sourceRoot, 'assets', 'instructions.md'))).toString('utf8');
  for (const relative of REQUIRED_INSTALLED_FILES) {
    requireThat(files.has(relative), 'INSTALL',
      `Replacement package is incomplete: missing ${relative}`);
  }
  const pkg = JSON.parse(files.get('sdlc/package.json').toString('utf8'));
  requireThat(pkg.name === 'ai-sdlc-framework' &&
    pkg.bin?.sdlc === './bin/sdlc.mjs' &&
    typeof pkg.version === 'string' && pkg.version,
  'INSTALL', 'Replacement package metadata is invalid');
  return { files, block: `${BLOCK_START}\n${instructions.trimEnd()}\n${BLOCK_END}` };
}
async function installLocked(store, {
  sourceRoot = SOURCE_ROOT,
  fault = async () => {},
  prepared,
  preparedVersion,
} = {}) {
    const manifestFile = await safePath(store.home, 'sdlc/install-manifest.json');
    const previous = await readJson(manifestFile, { optional: true });
    if (previous) requireThat(previous.owner === 'ai-sdlc-framework' && previous.schemaVersion === 1, 'INSTALL_CONFLICT', 'Unknown ownership manifest');
    const { files, block } = prepared ?? await distribution(store.home, sourceRoot);
    const instructionsFile = await safePath(store.home, 'copilot-instructions.md');
    const original = await exists(instructionsFile) ? (await readBytes(instructionsFile)).toString('utf8') : '';
    const owned = ownedBlock(original);
    requireThat(!owned || (previous && owned.text === previous.instructionsBlock), 'INSTALL_CONFLICT', 'Modified/unowned instructions block preserved');
    const nextInstructions = owned ? original.slice(0, owned.start) + block + original.slice(owned.end) :
      `${original}${original && !original.endsWith('\n') ? '\n' : ''}${original ? '\n' : ''}${block}\n`;
    const changes = [];
    for (const [relative, content] of files) {
      const target = await safePath(store.home, relative);
      const before = await exists(target) ? await readBytes(target, LIMITS.artifact) : null;
      requireThat(!before || previous?.files?.[relative] === digest(before), 'INSTALL_CONFLICT', `Modified or unowned file preserved: ${relative}`);
      if (!before || !before.equals(content)) changes.push({ relative, target, before, content });
    }
    for (const [relative, hash] of Object.entries(previous?.files ?? {})) {
      if (files.has(relative)) continue;
      const target = await safePath(store.home, relative);
      if (await exists(target)) {
        const before = await readBytes(target, LIMITS.artifact);
        requireThat(digest(before) === hash, 'INSTALL_CONFLICT', `Modified obsolete file preserved: ${relative}`);
        changes.push({ relative, target, before, content: null });
      }
    }
    if (nextInstructions !== original) changes.push({ relative: 'copilot-instructions.md', target: instructionsFile,
      before: await exists(instructionsFile) ? Buffer.from(original) : null, content: Buffer.from(nextInstructions) });
    const applied = [];
    try {
      for (const change of changes) {
        // Recheck immediately before mutation; refuse to overwrite edits made since preflight.
        const current = await exists(change.target) ? await readBytes(change.target, LIMITS.artifact) : null;
        requireThat(current?.equals(change.before ?? Buffer.alloc(0)) ?? change.before === null, 'INSTALL_CONFLICT', `Concurrent edit preserved: ${change.relative}`);
        if (change.content) await atomicWrite(change.target, change.content, { mode: change.relative === 'sdlc/bin/sdlc.mjs' ? 0o700 : 0o600 });
        else await fs.unlink(change.target);
        applied.push(change);
        await fault(change.relative);
      }
      const manifest = { schemaVersion: 1, owner: 'ai-sdlc-framework',
        version: preparedVersion ?? await sourceVersion(sourceRoot),
        files: Object.fromEntries([...files].map(([relative, content]) => [relative, digest(content)])), instructionsBlock: block,
        instructionsOriginallyExisted: previous?.instructionsOriginallyExisted ?? (original !== '') };
      await writeJson(manifestFile, manifest);
      return { installed: true, changedFiles: changes.map(change => change.relative), home: store.home,
        entry: path.join(store.home, 'sdlc', 'bin', 'sdlc.mjs'), nextAction: 'Restart Copilot CLI, run doctor, and verify supported hook fixtures before relying on enforcement.' };
    } catch (error) {
      const preserved = [];
      for (const change of applied.reverse()) {
        const current = await exists(change.target) ? await readBytes(change.target, LIMITS.artifact) : null;
        const unchanged = change.content ? current?.equals(change.content) : current === null;
        if (!unchanged) { preserved.push(change.relative); continue; }
        if (change.before) await atomicWrite(change.target, change.before, { mode: change.relative === 'sdlc/bin/sdlc.mjs' ? 0o700 : 0o600 });
        else if (current) await fs.unlink(change.target);
      }
      throw new SdlcError('INSTALL_FAILED', error.message, { preservedConcurrentEdits: preserved });
    }
}
export async function install(store, options = {}) {
  await store.ready();
  return withLock(installLock(store), () => installLocked(store, options));
}
export async function cleanInstall(store, {
  sourceRoot = SOURCE_ROOT,
  fault = async () => {},
} = {}) {
  await prepareMaintenanceHome(store);
  const source = await canonicalPath(sourceRoot);
  const executingSource = await canonicalPath(SOURCE_ROOT);
  requireThat(!within(store.home, executingSource), 'INSTALL_CONFLICT',
    'Clean installation must execute from a package outside COPILOT_HOME');
  requireThat(!within(store.home, source), 'INSTALL_CONFLICT',
    'Clean installation source must be outside COPILOT_HOME');
  const prepared = await distribution(store.home, source);
  const preparedVersion = await sourceVersion(source);
  const lock = installLock(store);
  await preparePurgeLock(lock);
  return withLock(lock, async () => {
    await prepareLegacyInstallLock(store);
    const purge = await purgeLocked(store);
    try {
      await store.ready();
      const installed = await installLocked(store, {
        sourceRoot: source,
        fault,
        prepared,
        preparedVersion,
      });
      return {
        ...installed,
        purgedExisting: true,
        purge,
      };
    } catch (error) {
      throw new SdlcError('INSTALL_FAILED',
        `The previous framework was purged, but replacement installation failed: ${error.message}`,
        { purgedExisting: true, purge, causeCode: error.code });
    }
  });
}
async function uninstallLocked(store) {
    const manifestLiteral = await purgeOwnedPath(store.home,
      'sdlc/install-manifest.json');
    try {
      if ((await fs.lstat(manifestLiteral)).isSymbolicLink()) {
        return {
          uninstalled: false,
          removed: [],
          preserved: ['sdlc/install-manifest.json:symlink'],
          reason: 'Ownership manifest is a symlink; normal uninstall preserved all content.',
        };
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const manifestFile = await safePath(store.home,
      'sdlc/install-manifest.json');
    const manifest = await readJson(manifestFile, { optional: true });
    if (manifest) requireThat(manifest.owner === 'ai-sdlc-framework',
      'INSTALL_CONFLICT', 'Unknown ownership manifest');
    const removed = [], preserved = [];
    const remaining = {};
    for (const relative of Object.keys(manifest?.files ?? {})) {
      await purgeOwnedPath(store.home, relative);
    }
    const instructionPreflight = await purgeOwnedPath(store.home,
      'copilot-instructions.md');
    try {
      const stat = await fs.lstat(instructionPreflight);
      if (!stat.isSymbolicLink()) {
        ownedBlock((await readBytes(instructionPreflight)).toString('utf8'));
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    for (const [relative, hash] of Object.entries(manifest?.files ?? {})) {
      const literal = await purgeOwnedPath(store.home, relative);
      try {
        if ((await fs.lstat(literal)).isSymbolicLink()) {
          preserved.push(`${relative}:symlink`);
          remaining[relative] = hash;
          continue;
        }
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      const target = await safePath(store.home, relative);
      if (!(await exists(target))) continue;
      if (digest(await readBytes(target, LIMITS.artifact)) !== hash) {
        preserved.push(relative);
        remaining[relative] = hash;
        continue;
      }
      await fs.unlink(target); removed.push(relative);
    }
    const instructionsLiteral = await purgeOwnedPath(store.home,
      'copilot-instructions.md');
    try {
      if ((await fs.lstat(instructionsLiteral)).isSymbolicLink()) {
        preserved.push('copilot-instructions.md:symlink');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const instructionsFile = preserved.includes(
      'copilot-instructions.md:symlink') ? null :
      await safePath(store.home, 'copilot-instructions.md');
    if (instructionsFile && await exists(instructionsFile)) {
      const original = (await readBytes(instructionsFile)).toString('utf8');
      const block = ownedBlock(original);
      if (block && block.text !== manifest?.instructionsBlock) preserved.push('copilot-instructions.md:modified-owned-block');
      else if (block) {
        const next = original.slice(0, block.start) + original.slice(block.end);
        if (!manifest?.instructionsOriginallyExisted && !next.trim()) await fs.unlink(instructionsFile);
        else await atomicWrite(instructionsFile, next);
        removed.push('copilot-instructions.md:owned-block');
      }
    }
    if (manifest) {
      if (preserved.length) await writeJson(manifestFile, { ...manifest, files: remaining });
      else await fs.unlink(manifestFile);
    }
    return {
      uninstalled: preserved.length === 0,
      removed,
      preserved,
      reason: !manifest ? 'No ownership manifest was present.' : undefined,
    };
}
async function preflightPurge(store) {
  const instructionsEntry = await purgeOwnedPath(store.home,
    'copilot-instructions.md');
  let instructions = null;
  let instructionsFile = instructionsEntry;
  let instructionsSymlink = false;
  try {
    instructionsSymlink = (await fs.lstat(instructionsEntry)).isSymbolicLink();
    if (instructionsSymlink) {
      instructionsFile = await safePath(store.home, 'copilot-instructions.md');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (await exists(instructionsFile)) {
    const original = (await readBytes(instructionsFile)).toString('utf8');
    const block = ownedBlock(original);
    if (block) {
      let before = original.slice(0, block.start);
      let after = original.slice(block.end);
      if (before.endsWith('\n\n') && after.startsWith('\n')) {
        before = before.slice(0, -1);
        after = after.slice(1);
      }
      instructions = {
        file: instructionsFile,
        original: Buffer.from(original),
        next: before + after,
        symlink: instructionsSymlink,
      };
    }
  }
  const directories = await Promise.all([
    'skills/sdlc',
    'skills/sdlc-requirements',
    'skills/sdlc-test-design',
    'skills/sdlc-technical-design',
    'skills/sdlc-coding',
    'sdlc',
  ].map(relative => purgeOwnedPath(store.home, relative)
    .then(file => ({ relative, file }))));
  return {
    instructions,
    hook: await purgeOwnedPath(store.home, 'hooks/sdlc.json'),
    directories,
    cleanupDirectories: await Promise.all(['hooks', 'skills']
      .map(relative => purgeOwnedPath(store.home, relative))),
  };
}
async function purgeLocked(store) {
  const plan = await preflightPurge(store);
  const removed = [];
  try {
    if (plan.instructions) {
      const current = await readBytes(plan.instructions.file);
      requireThat(current.equals(plan.instructions.original), 'INSTALL_CONFLICT',
        'Copilot instructions changed during purge preflight');
      if (!plan.instructions.next.trim() && !plan.instructions.symlink) {
        await fs.unlink(plan.instructions.file);
      } else {
        await atomicWrite(plan.instructions.file, plan.instructions.next);
      }
      removed.push('copilot-instructions.md:owned-block');
    }
    const hook = await purgeOwnedPath(store.home, 'hooks/sdlc.json');
    requireThat(hook === plan.hook, 'PATH',
      'Hook parent changed during purge');
    await fs.rm(hook, { force: true });
    removed.push('hooks/sdlc.json');
    for (const { relative, file: planned } of plan.directories) {
      const current = await purgeOwnedPath(store.home, relative);
      requireThat(current === planned, 'PATH',
        `Owned path parent changed during purge: ${relative}`);
      await fs.rm(current, { recursive: true, force: true });
      removed.push(relative);
    }
    for (const planned of plan.cleanupDirectories) {
      const relative = path.relative(store.home, planned);
      const current = await purgeOwnedPath(store.home, relative);
      requireThat(current === planned, 'PATH',
        `Cleanup path parent changed during purge: ${relative}`);
      try { await fs.rmdir(current); }
      catch (error) {
        if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error;
      }
    }
  } catch (error) {
    throw new SdlcError('PURGE_FAILED',
      `Framework purge failed after removing ${removed.length} owned paths: ${error.message}`,
      { purgeStarted: removed.length > 0, removed, causeCode: error.code });
  }
  return {
    purged: true,
    uninstalled: true,
    removed,
    preserved: [],
    runtime: 'Irreversibly removed all framework runtime state and known framework-owned paths.',
  };
}
export async function uninstall(store, { purge = false } = {}) {
  if (!purge) {
    await store.ready();
    const result = await withLock(installLock(store), () =>
      uninstallLocked(store));
    return {
      ...result,
      runtime: 'Retained all runtime decisions, evidence and uncertain operations. No directories were deleted.',
    };
  }
  await prepareMaintenanceHome(store);
  const lock = installLock(store);
  await preparePurgeLock(lock);
  return withLock(lock, async () => {
    await prepareLegacyInstallLock(store);
    const result = await purgeLocked(store);
    return {
      ...result,
      runtime: 'Irreversibly removed all framework runtime state and known framework-owned paths.',
    };
  });
}
export async function doctor(store) {
  store.home = await canonicalPath(store.home);
  store.runtime = path.join(store.home, 'sdlc', 'runtime');
  const manifestFile = path.join(store.home, 'sdlc', 'install-manifest.json');
  const manifest = await readJson(manifestFile, { optional: true });
  const findings = [];
  if (manifest) for (const [relative, hash] of Object.entries(manifest.files)) {
    const target = await safePath(store.home, relative);
    if (!(await exists(target)) || digest(await readBytes(target, LIMITS.artifact)) !== hash) findings.push(`Missing or modified installed file: ${relative}`);
  }
  if (manifest?.instructionsBlock) {
    const instructionsFile = path.join(store.home,
      'copilot-instructions.md');
    if (!(await exists(instructionsFile))) {
      findings.push('Missing installed Copilot instruction block');
    } else {
      const instructions = (await readBytes(instructionsFile)).toString('utf8');
      let block;
      try { block = ownedBlock(instructions); }
      catch { block = null; }
      if (!block || block.text !== manifest.instructionsBlock) {
        findings.push('Missing or modified installed Copilot instruction block');
      }
    }
  }
  const platform = await platformCapabilities();
  return { nodeVersion: process.version, nodeSupported: Number(process.versions.node.split('.')[0]) >= 22,
    installed: Boolean(manifest), home: store.home, findings,
    frameworkVersion: manifest?.version ?? await sourceVersion(),
    platform,
    adapter: { contract: 'GitHub Copilot CLI hooks reference, camelCase, snake_case and documented PascalCase payloads (2026-09-09)',
      events: HOOK_EVENTS, commandExecution: 'exec + args (no shell)', structuredAskUser: 'Full textResultForLlm receipt only; arbitrary transcript imports unsupported',
      liveCliVersion: 'unverified: fixture conformance is not a smoke test of the running Copilot version',
      preToolUse: 'lifecycle-stage findings are one-time advisories; other findings are unmanaged; all framework results fall through',
      shells: {
        bash: 'supported conservative literal subset',
        powershell: 'supported conservative literal subset; native Windows verification remains host-specific',
        cmd: 'supported conservative literal subset; UNC cwd unavailable pending native mapping/cleanup verification',
      },
      compaction: 'preCompact invalidates only the affected session',
      timeout: 'Command hook timeouts and framework errors fall through; hooks are not a security boundary' },
    capabilities: { localLedger: true, networkClients: false, providerAccess: 'agent-owned/unverified', scheduler: 'host-owned/unverified',
      builtInReview: 'GitHub Copilot CLI /review required; live command availability remains unverified until exercised',
      crossPlatform: {
        supported: ['macOS', 'Windows PowerShell', 'Windows Command Prompt'],
        currentHost: platform.platform,
        nativeVerification: platform.verification.status,
        nonHostIntegration: 'unverified',
      } } };
}
