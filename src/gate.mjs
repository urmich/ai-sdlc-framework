import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, fingerprint, requireThat } from './core.mjs';
import { canonicalPath, readJson, updateJson } from './files.mjs';
import { bindingKey, identity, publicationPaths, verifyPublicationBase } from './git.mjs';
import { artifactPath, artifactRepositoryId, loadConfig } from './artifacts.mjs';
import { activeEvents, applicableOverride, currentCycle } from './authority.mjs';
import { evaluatePolicy, validateAction } from './policy.mjs';
import { assertOriented } from './recovery.mjs';
import { reserveOnceAuthorities } from './operations.mjs';
import { candidateStamp } from './validation.mjs';
import { git } from './git.mjs';
import { isNonRepositoryWorkspace } from './store.mjs';
import {
  SHELL_FAMILIES,
  commandWords,
  isUncPath,
  isWindowsDevicePath,
  normalizeToolName,
  powerShellWords,
  repositoryRelativePath,
  sameNativePath,
  shellWords,
  withinNativePath,
  cmdWords,
} from './platform.mjs';

const READ_TOOLS = new Set(['view', 'rg', 'grep', 'glob', 'web_fetch', 'web_search', 'ask_user', 'update_todo']);
const EDIT_TOOLS = new Set(['edit', 'create', 'apply_patch', 'str_replace_editor']);
const SHELL_TOOLS = new Set(SHELL_FAMILIES);
const FRAMEWORK_ENTRY = fileURLToPath(new URL('../bin/sdlc.mjs', import.meta.url));
const FRAMEWORK_COMMANDS = new Set(['status', 'resume', 'context', 'decision',
  'op', 'conflict', 'pr', 'monitor', 'audit', 'check', 'artifact', 'cycle',
  'evidence', 'handoff', 'prune', 'init', 'create', 'adopt', 'member',
  'maintenance']);
const MAINTENANCE_COMMANDS = new Set(['doctor', 'install', 'update', 'uninstall']);
const SOFT_STAGE_RULES = new Set([
  'active-work',
  'phase',
  'artifact-role',
  'orientation',
  'local-validation',
  'candidate-review',
  'review-completion',
  'unit-first',
  'dev-validation',
  'dev-completion',
  'staging-completion',
]);
const PASS_THROUGH = Object.freeze({});
const CLASSIFIED_SECURITY_FIELDS = ['class', 'repositoryId', 'environment', 'target', 'configDigest', 'stages',
  'sourceRef', 'targetRef', 'draft', 'sourceRevision', 'targetRevision', 'policyVersion', 'prRecordId',
  'artifactId', 'testId', 'owner', 'host', 'implicitEnvironments', 'externalPermission',
  'monitorCapability', 'preservesChanges', 'earlyDraft', 'outOfScope', 'itemId',
  'baseRef', 'remoteUrlDigest', 'force', 'delete', 'deploymentId', 'provider',
  'pipeline'];
export function normalizeHook(payload) {
  requireThat(payload && typeof payload === 'object', 'HOOK', 'Expected a hook input object');
  const rawName = payload.toolName ?? payload.tool_name ?? payload.ToolName;
  const shellHint = payload.shellFamily ?? payload.shell_family ?? payload.ShellFamily;
  const toolName = normalizeToolName(rawName, { shellHint });
  let toolArgs = payload.toolArgs ?? payload.tool_input ?? payload.ToolArgs ?? {};
  if (typeof toolArgs === 'string' && SHELL_TOOLS.has(toolName)) {
    try {
      const parsed = JSON.parse(toolArgs);
      toolArgs = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ?
        parsed : { command: toolArgs };
    } catch {
      toolArgs = { command: toolArgs };
    }
  } else if (typeof toolArgs === 'string' && rawName !== 'apply_patch') {
    try { toolArgs = JSON.parse(toolArgs); }
    catch { /* Some tools legitimately use a free-form string; classification will reject unknown forms. */ }
  }
  return {
    sessionId: payload.sessionId ?? payload.session_id ?? payload.SessionId,
    cwd: payload.cwd ?? payload.Cwd,
    timestamp: payload.timestamp ?? payload.Timestamp,
    prompt: payload.prompt ?? payload.Prompt,
    toolName,
    toolArgs,
    toolResult: payload.toolResult ?? payload.tool_result ?? payload.ToolResult,
  };
}
export { shellWords, powerShellWords, cmdWords };

export async function normalizeCommandHook(hook) {
  if (!SHELL_TOOLS.has(hook.toolName)) return hook;
  requireThat(!isWindowsDevicePath(hook.cwd), 'PATH',
    'Windows device namespace working directories are unsupported');
  requireThat(hook.toolName !== 'cmd' || !isUncPath(hook.cwd), 'HOOK',
    'cmd.exe UNC working directories are unavailable until native mapping and cleanup are verified; use PowerShell or a direct argument-array tool adapter');
  return hook;
}
function affectedPaths(toolName, args) {
  if (toolName === 'apply_patch' || args?.patch || args?.input?.startsWith?.('*** Begin Patch')) {
    const patch = typeof args === 'string' ? args : args.patch ?? args.input;
    requireThat(typeof patch === 'string' && patch.startsWith('*** Begin Patch') && patch.trimEnd().endsWith('*** End Patch'), 'HOOK', 'Unsupported patch format');
    const paths = [...patch.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gmu)].map(match => match[1]);
    requireThat(paths.length > 0, 'HOOK', 'Patch contains no recognizable affected files');
    return paths;
  }
  const file = args.path ?? args.file_path;
  requireThat(typeof file === 'string', 'HOOK', 'Edit tool has no supported file path');
  return [file, ...(args.move_path ? [args.move_path] : [])];
}
export function repositoryPathClassification(root, file, platform = process.platform) {
  return {
    relative: repositoryRelativePath(root, file, platform),
    contained: withinNativePath(root, file, platform),
  };
}
function gitInvocation(words) {
  if (words?.[0] !== 'git') return null;
  let index = 1;
  let cwd = null;
  let cwdOptions = 0;
  while (index < words.length) {
    const word = words[index];
    if (word === '--no-pager' || word === '--no-optional-locks') { index++; continue; }
    if (word === '-C') {
      requireThat(words[index + 1], 'HOOK', 'git -C requires a path');
      requireThat(++cwdOptions === 1, 'HOOK', 'Multiple git -C options are unsupported; use one bound worktree path');
      cwd = words[index + 1];
      index += 2;
      continue;
    }
    if (word.startsWith('-')) return { unsupported: true };
    return { operation: word, args: words.slice(index + 1), cwd };
  }
  return { unsupported: true };
}
function mergeClassifications(...actions) {
  const merged = {};
  for (const action of actions.filter(Boolean)) {
    for (const [field, value] of Object.entries(action)) {
      requireThat(merged[field] === undefined || digest(merged[field]) === digest(value),
        'CONFLICT', `Independent classifiers disagree on ${field}`);
      merged[field] = value;
    }
  }
  return merged;
}
function configuredCommand(config, command, shell) {
  const exact = (config?.commands ?? []).filter(item => item.command === command);
  const applicable = exact.filter(item =>
    (!item.platforms || item.platforms.includes(process.platform)) &&
    (!item.shell || item.shell === shell));
  if (!applicable.length) return null;
  const first = applicable[0];
  requireThat(applicable.every(item => digest(item.action) === digest(first.action)),
    'CONFLICT', 'Multiple platform/shell command adapters classify the same command differently');
  return first;
}
function requireIndexOnlyCommit(args) {
  const valueOptions = new Set(['-m', '--message', '-F', '--file', '--author', '--date', '--cleanup', '--trailer']);
  const flagOptions = new Set(['-q', '--quiet', '-v', '--verbose', '--no-verify', '-s', '--signoff',
    '--allow-empty', '--allow-empty-message', '--no-post-rewrite', '--no-gpg-sign', '-S', '--gpg-sign']);
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (valueOptions.has(argument)) {
      requireThat(args[index + 1] !== undefined, 'HOOK', `git commit ${argument} requires a value`);
      index++;
      continue;
    }
    if (flagOptions.has(argument) || /^-S.+/u.test(argument) || argument.startsWith('--gpg-sign=') ||
      [...valueOptions].some(option => argument.startsWith(`${option}=`))) continue;
    requireThat(false, 'HOOK', 'Use an index-only git commit form; -a, amend, include/only and pathspec commits require separate classification');
  }
}
function symbolicRefReadOnly(args) {
  const operands = [];
  for (const argument of args) {
    if (['-q', '--quiet', '--short'].includes(argument)) continue;
    if (argument.startsWith('-')) return false;
    operands.push(argument);
  }
  return operands.length === 1 && /^(?:HEAD|refs\/[A-Za-z0-9._/-]+)$/u.test(operands[0]) &&
    !operands[0].includes('..') && !operands[0].includes('@{');
}
function unboundReadOnlyShell(words) {
  const invocation = gitInvocation(words);
  if (invocation?.operation) {
    if (invocation.operation === 'symbolic-ref' && !symbolicRefReadOnly(invocation.args)) return false;
    if (!['status', 'log', 'show', 'diff', 'ls-files', 'rev-parse', 'symbolic-ref'].includes(invocation.operation)) return false;
    return !invocation.args.some(argument =>
      /^(?:--output|--ext-diff|--textconv|--no-index|--exec-path|--git-dir|--work-tree|--delete|-d)$/u.test(argument) ||
      argument.startsWith('--output='));
  }
  const command = words?.[0]?.toLowerCase();
  return ['pwd', 'ls', 'cd', 'dir', 'type', 'get-location', 'get-childitem',
    'get-content', 'resolve-path', 'set-location'].includes(command) &&
    !words.some(word => word.startsWith('-exec'));
}
export function isReadOnlyHook(hook) {
  if (READ_TOOLS.has(hook.toolName)) return true;
  if (!SHELL_TOOLS.has(hook.toolName)) return false;
  return unboundReadOnlyShell(commandWords(hook.toolName,
    hook.toolArgs?.command));
}
function branchRef(value, label) {
  requireThat(value.startsWith('refs/heads/'),
    'HOOK', `Managed push ${label} must be a fully qualified branch ref`);
  const ref = value;
  requireThat(/^refs\/heads\/[A-Za-z0-9._/-]+$/u.test(ref) && !ref.includes('..') && !ref.endsWith('/'),
    'HOOK', `Unsupported ${label} branch reference`);
  return ref;
}
async function classifyPush(member, args) {
  let force = false, deleteRef = false, endOptions = false, noFollowTags = false, noRecurseSubmodules = false;
  const operands = [];
  for (const argument of args) {
    if (!endOptions && argument === '--') { endOptions = true; continue; }
    if (!endOptions && argument.startsWith('-')) {
      if (['-q', '--quiet', '--porcelain', '--no-verify', '-u', '--set-upstream', '--dry-run'].includes(argument)) continue;
      if (argument === '--no-follow-tags') { noFollowTags = true; continue; }
      if (argument === '--no-recurse-submodules' || argument === '--recurse-submodules=no') {
        noRecurseSubmodules = true;
        continue;
      }
      if (argument === '-f' || argument === '--force' || argument === '--force-with-lease' ||
        argument.startsWith('--force-with-lease=')) { force = true; continue; }
      if (argument === '-d' || argument === '--delete') { deleteRef = true; continue; }
      requireThat(false, 'HOOK', `Unsupported git push option: ${argument}`);
    }
    requireThat(noFollowTags, 'HOOK', 'Managed git push requires explicit --no-follow-tags to prevent implicit tag publication');
    requireThat(noRecurseSubmodules, 'HOOK', 'Managed git push requires explicit --no-recurse-submodules to prevent child repository publication');
    operands.push(argument);
  }
  requireThat(operands.length === 2, 'HOOK', 'Managed git push requires one explicit remote and one explicit branch refspec');
  const [remote, rawRefspec] = operands;
  requireThat(/^[A-Za-z0-9._/-]+$/u.test(remote) || /^https?:\/\//u.test(remote),
    'HOOK', 'Unsupported git push remote');
  requireThat(/^[A-Za-z0-9._-]+$/u.test(remote), 'HOOK', 'Managed git push requires a configured remote name');
  const pushUrls = (await git(member.root, ['remote', 'get-url', '--push', '--all', remote])).split('\n').filter(Boolean);
  requireThat(pushUrls.length === 1, 'HOOK', 'Managed git push supports exactly one resolved push URL');
  const remoteUrlDigest = digest(pushUrls);
  let refspec = rawRefspec;
  if (refspec.startsWith('+')) { force = true; refspec = refspec.slice(1); }
  if (deleteRef) {
    requireThat(!refspec.includes(':'), 'HOOK', 'git push --delete accepts one destination branch');
    return { class: 'push', target: remote, remoteUrlDigest, targetRef: branchRef(refspec, 'destination'),
      force, delete: true };
  }
  const pieces = refspec.split(':');
  requireThat(pieces.length === 2 && pieces[0] && pieces[1],
    'HOOK', 'Managed git push requires an explicit source:destination branch refspec');
  const sourceRef = branchRef(pieces[0], 'source');
  requireThat(sourceRef === member.branch, 'BINDING', 'Managed push source must be the bound worktree branch');
  const targetRef = branchRef(pieces[1], 'destination');
  const sourceRevision = await git(member.root, ['rev-parse', '--verify', '-q', `${sourceRef}^{commit}`], { optional: true });
  return { class: 'push', target: remote, remoteUrlDigest, sourceRef, targetRef,
    ...(sourceRevision ? { sourceRevision } : {}), force, delete: false };
}
function applyConfiguredRestrictions(actions, configured) {
  if (!configured) return actions;
  return actions.map(action => {
    requireThat(configured.action.class === action.class, 'CONFLICT',
      'Configured command cannot replace independently derived Git path classification');
    return mergeClassifications(action, configured.action);
  });
}
async function stagedActions(store, state, member) {
  const names = (await git(member.root,   ['diff', '--cached', '--name-only', '--no-renames', '-z',
    '--diff-filter=ACDMRTUXB']))
    .split('\0').filter(Boolean);
  requireThat(names.length > 0, 'GIT', 'No staged changes are available to commit');
  const actions = [];
  for (const name of names) {
    if (name === '.sdlc/config.json') {
      actions.push({ class: 'configuration', repositoryId: member.repositoryId, paths: [name] });
      continue;
    }
    if (name.startsWith('.sdlc/work-items/')) {
      actions.push({ class: 'bookkeeping', repositoryId: member.repositoryId, paths: [name] });
      continue;
    }
    const artifact = state.manifest.artifacts.find(locator =>
      locator.kind === 'git' && locator.repositoryId === member.repositoryId && locator.path === name);
    actions.push(artifact ?
      { class: 'document', repositoryId: member.repositoryId, paths: [artifact.path] } :
      { class: 'code', repositoryId: member.repositoryId, paths: [name] });
  }
  return actions;
}
export async function classifyTool(store, hook, state, member, config) {
  const base = { repositoryId: member?.repositoryId };
  if (READ_TOOLS.has(hook.toolName)) return [{ class: 'read' }];
  if (EDIT_TOOLS.has(hook.toolName)) {
    const paths = affectedPaths(hook.toolName, hook.toolArgs);
    const actions = [];
    for (const file of paths) {
      const resolved = await canonicalPath(path.resolve(hook.cwd, file));
      let artifact;
      for (const locator of state.manifest.artifacts) {
        if (sameNativePath(await artifactPath(store, state.checkpoint.workItemId, locator, state.metadata), resolved)) artifact = locator;
      }
      const { relative, contained } = repositoryPathClassification(member.root, resolved);
      if (contained) {
        requireThat((relative === '.sdlc/config.json') ||
          (!relative.startsWith('.sdlc/') && !relative.startsWith('.git/') &&
          relative !== '.git' && relative !== '.sdlc'),
        'PATH', 'Protected runtime/manifest/Git metadata cannot be relabeled as a canonical document');
      }
      if (artifact) {
        actions.push({ class: 'document',
          repositoryId: artifactRepositoryId(artifact, state.manifest),
          paths: [artifact.path ?? resolved] });
      } else if (relative === '.sdlc/config.json') {
        requireThat(contained, 'PATH',
          'Repository configuration mutation must remain inside the exact bound member');
        actions.push({ class: 'configuration', ...base, paths: [relative] });
      } else {
        requireThat(contained, 'PATH', 'Mutation escapes bound member; register an authorized artifact or bind the member');
        requireThat(!relative.startsWith('.sdlc/') && !relative.startsWith('.git/') && relative !== '.git', 'PATH', 'Runtime/manifest/Git metadata changes require supported bookkeeping, not direct edits');
        actions.push({ class: 'code', ...base, paths: [relative] });
      }
    }
    return actions;
  }
  const adapter = config?.toolAdapters?.find(a => a.toolName === hook.toolName &&
    Object.entries(a.match ?? {}).every(([key, value]) =>
      hook.toolArgs[key] !== undefined &&
      digest(hook.toolArgs[key]) === digest(value)));
  if (!SHELL_TOOLS.has(hook.toolName) && adapter) {
    validateAction(adapter.action);
    return [{ ...adapter.action, ...base }];
  }
  if (SHELL_TOOLS.has(hook.toolName)) {
    const command = hook.toolArgs?.command;
    if (hook.toolName === 'powershell' && /[(){}@]/u.test(command ?? '')) return [{ class: 'unknown', ...base }];
    const words = commandWords(hook.toolName, command);
    if (!words?.length) return [{ class: 'unknown', ...base }];
    const configured = configuredCommand(config, command, hook.toolName);
    const invocation = gitInvocation(words);
    if (invocation?.unsupported) return [{ class: 'unknown', ...base }];
    requireThat(!invocation || (!process.env.GIT_DIR && !process.env.GIT_WORK_TREE),
      'BINDING', 'Managed Git commands do not support inherited GIT_DIR or GIT_WORK_TREE redirection');
    let gitCwd = await canonicalPath(hook.cwd);
    if (invocation?.cwd) {
      requireThat(literalPathSyntax(invocation.cwd),
        'BINDING', 'git -C requires a canonical literal path without expansion or parent traversal');
      gitCwd = await canonicalPath(path.resolve(hook.cwd, invocation.cwd));
      requireThat(sameNativePath(gitCwd, member.root), 'BINDING', 'git -C must target the bound member worktree');
    }
    const gitOperation = invocation?.operation ?? null;
    if (hook.toolName === 'bash' && /[{}*?\[\]]/u.test(command) && gitOperation !== 'add') {
      return [{ class: 'unknown', ...base }];
    }
    if (gitOperation === 'push') {
      requireThat(!configured || configured.action.class === 'push', 'CONFLICT', 'Configured command cannot relabel git push as a different operation class');
      requireThat(!adapter || adapter.action.class === 'push', 'CONFLICT', 'Tool adapter cannot relabel git push as a different operation class');
      return [{ ...mergeClassifications(configured?.action, adapter?.action, await classifyPush(member, invocation.args)), ...base }];
    }
    if (['reset', 'clean', 'checkout', 'restore', 'rebase'].includes(gitOperation)) {
      requireThat(!configured || configured.action.class === 'destructive', 'CONFLICT', 'Configured command cannot hide destructive Git behavior');
      requireThat(!adapter || adapter.action.class === 'destructive', 'CONFLICT', 'Tool adapter cannot hide destructive Git behavior');
      return [{ ...mergeClassifications(configured?.action, adapter?.action, { class: 'destructive' }), ...base }];
    }
    if (gitOperation === 'add') {
      requireThat(!adapter, 'CONFLICT', 'Tool adapters cannot replace built-in git add path classification');
      const separator = invocation.args.indexOf('--');
      const optionArea = separator >= 0 ?
        invocation.args.slice(0, separator) : invocation.args;
      const literalArea = separator >= 0 ?
        invocation.args.slice(separator + 1) : [];
      const args = [...optionArea, ...literalArea];
      requireThat(args.length > 0 && optionArea.every(word =>
        !word.startsWith('-') ||
          ['-A', '--all', '-u', '--update'].includes(word)),
        'HOOK', 'Use a supported git add path or all/update form');
      const changed = [
        ...(await git(member.root, ['diff', '--name-only', '--no-renames',
          '-z'])).split('\0'),
        ...(!args.some(word => ['-u', '--update'].includes(word)) ?
          (await git(member.root, ['ls-files', '--others',
            '--exclude-standard', '-z'])).split('\0') : []),
      ].filter(Boolean);
      const requested = [
        ...optionArea.filter(word => !word.startsWith('-')),
        ...literalArea,
      ];
      requireThat(requested.every(item => item === '.' || (
        path.posix.normalize(item) === item && !path.posix.isAbsolute(item) &&
        !item.split('/').includes('..') && !item.includes('\\') &&
        !/[*?\[\]{}]/u.test(item) && !item.startsWith(':'))),
      'HOOK', 'Git add operands must be canonical literal repository paths; wildcard/magic or ./../ forms require exact expansion');
      const prefix = path.relative(member.root, gitCwd)
        .split(path.sep).join('/');
      const repositoryRequested = requested.map(item =>
        path.posix.normalize(path.posix.join(prefix || '.', item)));
      const selected = repositoryRequested.length ? changed.filter(name =>
        repositoryRequested.some(item => item === '.' || name === item ||
          name.startsWith(`${item.replace(/\/$/u, '')}/`))) : changed;
      requireThat(selected.length > 0, 'GIT', 'No supported changed paths match this git add');
      const actions = [];
      for (const name of [...new Set(selected)]) {
        if (name === '.sdlc/config.json') actions.push({ class: 'configuration', ...base, paths: [name] });
        else if (name.startsWith('.sdlc/work-items/')) actions.push({ class: 'bookkeeping', ...base, paths: [name] });
        else {
          const artifact = state.manifest.artifacts.find(item => item.kind === 'git' && item.repositoryId === member.repositoryId && item.path === name);
          actions.push(artifact ? { class: 'document', ...base, paths: [name] } : { class: 'code', ...base, paths: [name] });
        }
      }
      return applyConfiguredRestrictions(actions, configured);
    }
    if (gitOperation === 'commit') {
      requireThat(!adapter, 'CONFLICT', 'Tool adapters cannot replace built-in git commit path classification');
      requireIndexOnlyCommit(invocation.args);
      return applyConfiguredRestrictions(await stagedActions(store, state, member), configured);
    }
    if (['switch', 'worktree', 'init', 'clone'].includes(gitOperation)) {
      requireThat(!adapter || adapter.action.class === 'destructive', 'CONFLICT', 'Tool adapter cannot hide repository-changing Git behavior');
      return [{ ...mergeClassifications(adapter?.action, { class: 'destructive' }), ...base }];
    }
    if (path.basename(words[0]) === 'node' || path.resolve(words[0]) === process.execPath) {
      if (words[1] && sameNativePath(await canonicalPath(path.resolve(hook.cwd, words[1])),
        await canonicalPath(FRAMEWORK_ENTRY))) {
        if (FRAMEWORK_COMMANDS.has(words[2]) ||
            (words[2] === 'receipt' && words[3] === 'latest')) {
          requireThat(!configured || configured.action.class === 'bookkeeping', 'CONFLICT', 'Configured command cannot relabel framework bookkeeping');
          requireThat(!adapter || adapter.action.class === 'bookkeeping', 'CONFLICT', 'Tool adapter cannot relabel framework bookkeeping');
          return [{ class: 'bookkeeping' }];
        }
      }
    }
    if (invocation) {
      const args = invocation.args;
      const operation = invocation.operation;
      if (operation === 'symbolic-ref') {
        if (!symbolicRefReadOnly(args)) {
          requireThat(!configured || configured.action.class === 'destructive', 'CONFLICT', 'Configured command cannot relabel a symbolic-ref write');
          requireThat(!adapter || adapter.action.class === 'destructive', 'CONFLICT', 'Tool adapter cannot relabel a symbolic-ref write');
          return [{ ...mergeClassifications(configured?.action, adapter?.action, { class: 'destructive' }), ...base }];
        }
      }
      if (['status', 'log', 'show', 'diff', 'ls-files', 'rev-parse', 'symbolic-ref'].includes(operation)) {
        const risky = args.some(arg => /^(?:--output|--ext-diff|--textconv|--no-index|--exec-path|--git-dir|--work-tree|--delete|-d)$/u.test(arg) || arg.startsWith('--output='));
        if (!risky) {
          requireThat(!configured || configured.action.class === 'read', 'CONFLICT', 'Configured command cannot relabel read-only Git discovery');
          requireThat(!adapter || adapter.action.class === 'read', 'CONFLICT', 'Tool adapter cannot relabel read-only Git discovery');
          return [{ class: 'read' }];
        }
      }
      if (operation === 'push') return [{ class: 'push', ...base }];
      if (['reset', 'clean', 'checkout', 'restore', 'rebase'].includes(operation)) return [{ class: 'destructive', ...base }];
    }
    if (unboundReadOnlyShell(words)) {
      requireThat(!configured || configured.action.class === 'read', 'CONFLICT', 'Configured command cannot relabel read-only shell discovery');
      requireThat(!adapter || adapter.action.class === 'read', 'CONFLICT', 'Tool adapter cannot relabel read-only shell discovery');
      return [{ class: 'read' }];
    }
    if (configured) {
      requireThat(!adapter || digest(adapter.action) === digest(configured.action), 'CONFLICT', 'Configured command and tool adapter classifications disagree');
      return [{ ...configured.action, ...base }];
    }
    if (adapter) return [{ ...adapter.action, ...base }];
  }
  return [{ class: 'unknown', ...base }];
}
function literalPathSyntax(value) {
  return Boolean(value) && !value.startsWith('-') && !value.startsWith('~') &&
    !/[*?\[\]{}]/u.test(value) && !value.includes('\0') &&
    !value.split(/[\\/]/u).includes('..');
}
async function literalBootstrapTarget(base, value, containmentRoot = base) {
  if (!literalPathSyntax(value)) return false;
  const canonicalRoot = await canonicalPath(containmentRoot);
  const target = await canonicalPath(path.resolve(base, value));
  return withinNativePath(canonicalRoot, target);
}
function literalBranch(value) {
  return typeof value === 'string' &&
    !value.startsWith('-') && !value.startsWith('~') &&
    /^[A-Za-z0-9._/-]+$/u.test(value) &&
    !value.includes('..') && !value.endsWith('/');
}
function maintenanceOptions(words, command) {
  const allowed = command === 'doctor' || command === 'uninstall' ?
    new Set(['--home']) : new Set(['--home', '--source-root']);
  const options = {};
  for (let index = 3; index < words.length; index += 2) {
    const name = words[index];
    const value = words[index + 1];
    if (!allowed.has(name) || value === undefined || options[name] !== undefined ||
        !literalPathSyntax(value)) return null;
    options[name] = value;
  }
  return options;
}
async function trustedMaintenanceInvocation(store, hook, words) {
  if (!words || words.length < 3 ||
      !['node', 'node.exe', process.execPath].includes(words[0]) ||
      !MAINTENANCE_COMMANDS.has(words[2])) return false;
  const options = maintenanceOptions(words, words[2]);
  if (!options) return false;
  const entry = await canonicalPath(path.resolve(hook.cwd, words[1]));
  const root = path.dirname(path.dirname(entry));
  if (!sameNativePath(entry, await canonicalPath(path.join(root, 'bin', 'sdlc.mjs')))) return false;
  const currentEntry = sameNativePath(entry, await canonicalPath(FRAMEWORK_ENTRY));
  const session = await readJson(store.sessionPath(hook.sessionId), { optional: true });
  const selected = candidate => session?.maintenanceSourceRoots?.some(value =>
    sameNativePath(value, candidate));
  if (!currentEntry && !selected(root)) return false;
  const pkg = await readJson(path.join(root, 'package.json'), { optional: true });
  if (pkg?.name !== 'ai-sdlc-framework' || typeof pkg.version !== 'string') return false;
  if (options['--source-root']) {
    const sourceRoot = await canonicalPath(path.resolve(hook.cwd, options['--source-root']));
    if (!sameNativePath(sourceRoot, await canonicalPath(root)) &&
        !selected(sourceRoot)) return false;
  }
  return true;
}
async function allowsPreBindingBootstrap(hook, invocation, session, error) {
  if (!session?.lastReceiptId || session.workItemId ||
      !await isNonRepositoryWorkspace(hook.cwd, error)) return false;
  if (process.env.GIT_DIR || process.env.GIT_WORK_TREE) return false;
  if (hook.toolName === 'bash' &&
      /[{}*?\[\]]/u.test(hook.toolArgs?.command ?? '')) return false;
  if (['clone', 'init'].includes(invocation?.operation) && invocation.cwd) return false;
  if (invocation?.operation === 'clone') {
    return invocation.args.length === 2 &&
      /^https:\/\/[^\s]+$/u.test(invocation.args[0]) &&
      await literalBootstrapTarget(hook.cwd, invocation.args[1]);
  }
  if (invocation?.operation === 'init') {
    const operands = [];
    for (let index = 0; index < invocation.args.length; index++) {
      const argument = invocation.args[index];
      if (['-q', '--quiet'].includes(argument)) continue;
      if (['-b', '--initial-branch'].includes(argument)) {
        if (!invocation.args[++index]) return false;
        continue;
      }
      if (argument.startsWith('--initial-branch=')) continue;
      if (argument.startsWith('-')) return false;
      operands.push(argument);
    }
    return operands.length <= 1 &&
      (!operands.length || await literalBootstrapTarget(hook.cwd, operands[0]));
  }
  if (['switch', 'worktree'].includes(invocation?.operation) && invocation.cwd) {
    if (!await literalBootstrapTarget(hook.cwd, invocation.cwd)) return false;
    const repository = await canonicalPath(path.resolve(hook.cwd, invocation.cwd));
    const observed = await identity(repository, 'bootstrap');
    if (!await literalBootstrapTarget(hook.cwd, observed.root)) return false;
    if (invocation.operation === 'switch') {
      if (invocation.args.length === 1) return literalBranch(invocation.args[0]);
      return invocation.args.length === 2 &&
        ['-c', '--create'].includes(invocation.args[0]) &&
        literalBranch(invocation.args[1]);
    }
    if (invocation.args[0] !== 'add') return false;
    if (invocation.args.length === 2) {
      return await literalBootstrapTarget(repository, invocation.args[1], hook.cwd);
    }
    if (invocation.args.length === 3) {
      return await literalBootstrapTarget(repository, invocation.args[1], hook.cwd) &&
        literalBranch(invocation.args[2]);
    }
    if (invocation.args.length === 4 &&
        ['-b', '--branch'].includes(invocation.args[1])) {
      return literalBranch(invocation.args[2]) &&
        await literalBootstrapTarget(repository, invocation.args[3], hook.cwd);
    }
    return false;
  }
  return false;
}
export async function evaluateGate(store, payload, { allowStageOverride = false } = {}) {
  try {
    const rawHook = normalizeHook(payload);
    const hook = await normalizeCommandHook(rawHook);
    requireThat(hook.sessionId && hook.cwd && hook.toolName, 'HOOK', 'Hook payload is missing sessionId/cwd/toolName');
    requireThat(hook.toolName !== 'powershell' || !/[(){}@]/u.test(hook.toolArgs?.command ?? ''),
      'HOOK', 'PowerShell expressions require an explicit supported adapter and cannot use framework pass-through');
    requireThat(hook.toolName !== 'powershell' ||
      !/(?:^|\s)--%(?:\s|$)|%[A-Za-z_][A-Za-z0-9_]*%/u.test(hook.toolArgs?.command ?? ''),
    'HOOK', 'PowerShell stop-parsing and environment expansion require an explicit adapter');
    requireThat(hook.toolName !== 'powershell' ||
      /^[\x09\x20-\x7e]*$/u.test(hook.toolArgs?.command ?? ''),
    'HOOK', 'PowerShell non-ASCII quotation or whitespace requires an explicit adapter');
    requireThat(hook.toolName !== 'cmd' || commandWords('cmd', hook.toolArgs?.command),
      'HOOK', 'Unsupported cmd.exe expansion, metacharacters, quoting, or tokenization requires an explicit adapter');
    if (READ_TOOLS.has(hook.toolName)) return PASS_THROUGH;
    // Recovery commands must stay available before a binding exists.
    const words = commandWords(hook.toolName, hook.toolArgs?.command);
    requireThat(hook.toolName !== 'powershell' || words,
      'HOOK', 'Unsupported or ambiguous PowerShell tokenization requires an explicit adapter');
    requireThat(hook.toolName !== 'powershell' ||
      !words?.some(word => word.includes('"')),
    'HOOK', 'PowerShell embedded double quotes require an explicit compatible adapter');
    requireThat(hook.toolName !== 'powershell' ||
      !words?.some(word => word === '--%' || /%[^%]+%/u.test(word)),
    'HOOK', 'PowerShell parsed stop-parsing or environment expansion requires an explicit adapter');
    if (words?.[2] === 'receipt' && words[3] === 'capture' && words[1] &&
      sameNativePath(await canonicalPath(path.resolve(hook.cwd, words[1])),
        await canonicalPath(FRAMEWORK_ENTRY))) {
      return { permissionDecision: 'deny', permissionDecisionReason: 'Receipt capture belongs to the runtime input adapter, not an agent-authored shell approval. Use receipt latest and the actual captured user input.' };
    }
    if (words?.length >= 3 && ['node', process.execPath].includes(words[0]) &&
      sameNativePath(await canonicalPath(path.resolve(hook.cwd, words[1])),
        await canonicalPath(FRAMEWORK_ENTRY)) &&
      FRAMEWORK_COMMANDS.has(words[2]) ||
      (words?.length >= 4 && ['node', process.execPath].includes(words[0]) &&
        sameNativePath(await canonicalPath(path.resolve(hook.cwd, words[1])),
          await canonicalPath(FRAMEWORK_ENTRY)) && words[2] === 'receipt' && words[3] === 'latest')) {
      return PASS_THROUGH;
    }
    if (await trustedMaintenanceInvocation(store, hook, words)) return PASS_THROUGH;
    if (SHELL_TOOLS.has(hook.toolName) && words?.length &&
      (hook.toolName !== 'bash' || !/[{}*?\[\]]/u.test(hook.toolArgs?.command ?? '')) &&
      unboundReadOnlyShell(words)) {
      const session = await readJson(store.sessionPath(hook.sessionId), {
        optional: true,
      });
      if (!session?.workItemId) return PASS_THROUGH;
    }
    let resolved;
    try {
      resolved = await store.resolve(hook.cwd, hook.sessionId);
    } catch (error) {
      const invocation = SHELL_TOOLS.has(hook.toolName) ?
        gitInvocation(words) : null;
      const session = await readJson(store.sessionPath(hook.sessionId), { optional: true });
      if (await allowsPreBindingBootstrap(hook, invocation, session, error)) return PASS_THROUGH;
      throw error;
    }
    const { workItemId, member, fallbackFromNonRepository = false } = resolved;
    return await store.transaction(workItemId, async tx => {
      const state = { ...tx, records: tx.all() };
      const config = await loadConfig(tx.metadata, member.repositoryId);
      const actions = await classifyTool(store, hook, state, member, config);
      if (fallbackFromNonRepository && SHELL_TOOLS.has(hook.toolName) &&
          !isReadOnlyHook(hook)) {
        const invocation = gitInvocation(words);
        const targetsBoundMember = invocation?.cwd &&
          literalPathSyntax(invocation.cwd) &&
          sameNativePath(await canonicalPath(path.resolve(hook.cwd, invocation.cwd)), member.root);
        requireThat(targetsBoundMember, 'BINDING',
          'A mutating shell command from a non-Git outer workspace must use a per-command cwd or explicit git -C path for the bound repository');
      }
      const exactFingerprint = fingerprint(rawHook.toolName, rawHook.toolArgs, await canonicalPath(rawHook.cwd));
      requireThat(!resolved.session?.unmanagedFingerprintOverflow &&
        !resolved.session?.unmanagedRequestFingerprints?.includes(exactFingerprint),
        'OPERATION', 'An earlier unmanaged identical invocation makes automatic result correlation ambiguous; reconcile it or use a new exact request');
      const operations = tx.all().filter(r => r.type === 'operation' && r.requestFingerprint === exactFingerprint && r.status === 'dispatching');
      requireThat(operations.length <= 1, 'CONFLICT', 'Multiple operations bind the same exact tool call');
      const operation = operations[0];
      requireThat(!operation?.dispatchBound, 'OPERATION',
        'This prepared operation already bound one invocation; repeated execution is unmanaged and requires reconciliation');
      const findings = [];
      const reservationChecks = [];
      for (let action of actions) {
        const cycle = currentCycle(tx.all(), tx.checkpoint);
        const context = { cycleId: cycle?.id, clock: store.clock };
        if (operation) {
          requireThat(operation.action.class === action.class ||
            (action.class === 'unknown' &&
              applicableOverride(tx.all(), 'supported-operation',
                operation.action, context)),
          'OPERATION',
          'Prepared action does not match the independently classified request');
          if (action.class !== 'unknown') {
            for (const field of CLASSIFIED_SECURITY_FIELDS) {
              if (action[field] === undefined) continue;
              requireThat(operation.action[field] !== undefined &&
                digest(action[field]) === digest(operation.action[field]),
              'OPERATION',
              `Prepared ${field} differs from the independently classified request`);
            }
          }
          requireThat(operation.sessionId === hook.sessionId &&
            operation.bindingKey === bindingKey(member),
          'BINDING', 'Operation belongs to a different session/member');
          action = { ...operation.action,
            paths: action.paths ?? operation.action.paths,
            operationId: operation.id };
        }
        if (['read', 'bookkeeping'].includes(action.class)) continue;
        try {
          await assertOriented(store, workItemId, member, state, hook.sessionId);
        } catch (error) {
          if (error.code !== 'ORIENTATION') throw error;
          const orientationAction = operation ?
            { ...operation.action, ...action, operationId: operation.id } : action;
          const override = applicableOverride(tx.all(), 'orientation',
            orientationAction, context);
          findings.push({
            rule: 'orientation',
            verdict: override ? 'authorized-deviation' : 'violation',
            reason: error.message,
            ...(override ? { eventId: override.id } : {}),
          });
        }
        const baseBranch = member.defaultBranch ?? config.defaultBranch;
        if (!member.linkedWorktree && (!baseBranch || member.branch === baseBranch) &&
          !applicableOverride(tx.all(), 'repository-workflow', action, context)) findings.push({ rule: 'repository-workflow', verdict: 'violation', reason: 'Use a feature branch/worktree; resolve the default branch or record a scoped override.' });
        if (action.earlyDraft) {
          if (action.class === 'push') await verifyPublicationBase(member, action.target,
            action.baseRef, action.targetRevision);
          requireThat(digest(await publicationPaths(member, action.sourceRevision, action.targetRevision)) === digest([...action.paths].sort()),
            'EVIDENCE', 'Early draft publication no longer matches the document-only source diff');
        }
        const policy = evaluatePolicy(state, action, { clock: store.clock, configuration: config });
        findings.push(...policy.findings);
        if (operation) reservationChecks.push({ action, policy });
        const external = ['push', 'build', 'deploy', 'pipeline', 'pr-create', 'pr-update', 'pr-validation', 'merge', 'auto-merge', 'policy-bypass'].includes(action.class) || (action.class === 'test' && action.environment !== 'local');
        if (external) {
          requireThat(operation?.status === 'dispatching' && !operation.dispatchBound, 'OPERATION', 'Prepare and mark-dispatching this exact request before the external call; reconcile previously dispatched calls');
          requireThat(operation.candidateStamp === await candidateStamp(tx.metadata, tx.manifest), 'STALE', 'Candidate/index/working content metadata changed since the exact operation was prepared');
          if (cycle) requireThat(operation.cycleId === cycle.id && operation.candidateDigest === cycle.candidateDigest, 'STALE', 'Candidate changed; restart local verification and obtain current authority');
        }
      }
      const denied = findings.filter(finding => finding.verdict === 'violation');
      const stageOverride = allowStageOverride &&
        resolved.session?.lastReceiptId &&
        denied.length > 0 &&
        denied.every(finding => SOFT_STAGE_RULES.has(finding.rule));
      if (!denied.length && operation) {
        const currentCycleRecord = currentCycle(tx.all(), tx.checkpoint);
        if (operation.retryOverrideId) {
          requireThat(activeEvents(tx.all(), {
            cycleId: currentCycleRecord?.id,
            clock: store.clock,
          }).some(event => event.id === operation.retryOverrideId),
          'AUTHORITY', 'Uncertain-retry authority is revoked or expired');
        }
        for (const check of reservationChecks) {
          reserveOnceAuthorities(tx, operation, check.policy,
            currentCycleRecord, store.clock, check.action);
        }
        operation.dispatchBound = true;
        operation.stageOverride = false;
        tx.put(operation);
      }
      if (stageOverride) {
        return {
          advisory: true,
          stageOverride: true,
          managedDispatchBound: false,
          advisoryReason: denied.map(finding =>
            `${finding.rule}: ${finding.reason}`).join('; '),
          findings,
        };
      }
      return denied.length ? {
        permissionDecision: 'deny',
        permissionDecisionReason: denied.map(f => `${f.rule}: ${f.reason}`).join('; '),
        findings,
      } : PASS_THROUGH;
    });
  } catch (error) {
    return { permissionDecision: 'deny', permissionDecisionReason: `${error.code ?? 'ERROR'}: ${error.message}`, error: error.code ?? 'ERROR' };
  }
}

export async function gate(store, payload) {
  const evaluation = await evaluateGate(store, payload, { allowStageOverride: true });
  if (!evaluation.advisory) {
    if (evaluation.permissionDecision !== 'deny') return evaluation;
    await recordUnmanagedInvocation(store, payload);
    const { permissionDecision: ignored, permissionDecisionReason, ...details } = evaluation;
    return {
      unmanaged: true,
      unmanagedReason: permissionDecisionReason,
      ...details,
    };
  }
  if (!evaluation.managedDispatchBound) await recordUnmanagedInvocation(store, payload);
  let hook;
  try {
    hook = normalizeHook(payload);
  } catch {
    return evaluation;
  }
  if (!hook.sessionId) return evaluation;
  const rules = [...new Set((evaluation.findings ?? [])
    .filter(finding => finding.verdict === 'violation')
    .map(finding => finding.rule))].sort();
  const advisoryKey = digest({
    rules,
  });
  const firstAdvisory = await recordStageAdvisory(store, hook.sessionId, advisoryKey);
  return {
    ...evaluation,
    ...(firstAdvisory ? {} : { advisoryReason: undefined }),
  };
}

async function recordUnmanagedInvocation(store, payload) {
  try {
    const hook = normalizeHook(payload);
    if (!hook.sessionId || !hook.cwd || !hook.toolName) return;
    const requestFingerprint = fingerprint(hook.toolName, hook.toolArgs,
      await canonicalPath(hook.cwd));
    let workItemId;
    await updateJson(store.sessionPath(hook.sessionId),
      { schemaVersion: 1, revision: 0, sessionId: hook.sessionId },
      session => {
        const fingerprints = session.unmanagedRequestFingerprints ?? [];
        if (!fingerprints.includes(requestFingerprint) && fingerprints.length >= 32) {
          session.unmanagedFingerprintOverflow = true;
        }
        session.unmanagedRequestFingerprints =
          [...new Set([...fingerprints, requestFingerprint])].slice(-32);
        workItemId = session.workItemId;
        return session;
      });
    if (!workItemId) return;
    await store.transaction(workItemId, tx => {
      const operation = tx.all().find(record =>
        record.type === 'operation' &&
        record.sessionId === hook.sessionId &&
        record.requestFingerprint === requestFingerprint &&
        record.status === 'dispatching');
      if (!operation) return;
      operation.status = 'uncertain';
      operation.dispatchAmbiguous = true;
      tx.put(operation);
    }, { allowRecoveryRequired: true });
  } catch {
    // Ambiguity tracking must not become a framework-owned tool veto.
  }
}

export async function recordStageAdvisory(store, sessionId, advisoryKey, {
  write = updateJson,
} = {}) {
  let firstAdvisory = false;
  try {
    await write(store.sessionPath(sessionId),
      { schemaVersion: 1, revision: 0, sessionId },
      current => {
        const shown = current.stageAdvisories ?? [];
        firstAdvisory = !shown.includes(advisoryKey);
        current.stageAdvisories = firstAdvisory ?
          [...shown.slice(-31), advisoryKey] : shown;
        return current;
      });
  } catch {
    // Never turn optional advisory bookkeeping into another execution blocker.
    firstAdvisory = false;
  }
  return firstAdvisory;
}
