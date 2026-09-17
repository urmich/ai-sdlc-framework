import path from 'node:path';
import * as fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export const HOST_PLATFORMS = ['darwin', 'win32', 'linux'];
export const SHELL_FAMILIES = ['bash', 'powershell', 'cmd'];

export function normalizeToolName(value, {
  platform = process.platform,
  shellHint,
} = {}) {
  if (typeof value !== 'string' || !value) return value;
  const stripped = value.replace(/^functions\./u, '');
  if (stripped === 'Bash' && platform === 'win32') {
    const hinted = normalizeToolName(shellHint, { platform });
    return SHELL_FAMILIES.includes(hinted) ? hinted : 'ambiguous-shell';
  }
  const key = stripped.toLowerCase().replace(/[\s_.-]/gu, '');
  const aliases = {
    bash: 'bash',
    shell: 'bash',
    read: 'view',
    write: 'create',
    edit: 'edit',
    glob: 'glob',
    grep: 'grep',
    webfetch: 'web_fetch',
    websearch: 'web_search',
    askuserquestion: 'ask_user',
    powershell: 'powershell',
    powershellextension: 'powershell',
    powershellcore: 'powershell',
    powershellexe: 'powershell',
    pwsh: 'powershell',
    cmd: 'cmd',
    cmdexe: 'cmd',
    commandprompt: 'cmd',
  };
  return aliases[key] ?? stripped;
}

export function shellWords(command) {
  if (typeof command !== 'string' || /[;&|<>`$\n\r]/u.test(command)) return null;
  const words = [];
  let word = '', quote = null, started = false;
  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    if (quote) {
      if (char === quote) quote = null;
      else if (char === '\\' && quote === '"' && ['"', '\\'].includes(command[index + 1])) word += command[++index];
      else word += char;
      started = true;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/u.test(char)) {
      if (started) {
        words.push(word);
        word = '';
        started = false;
      }
    } else if (char === '\\') {
      if (++index >= command.length) return null;
      word += command[index];
      started = true;
    } else {
      word += char;
      started = true;
    }
  }
  if (quote) return null;
  if (started) words.push(word);
  return words;
}

export function powerShellWords(command) {
  if (typeof command !== 'string' || /[;&|<>`$\n\r]/u.test(command)) return null;
  if (/^\s*["']/u.test(command)) return null;
  const words = [];
  let word = '', quote = null, started = false, justClosedQuote = false;
  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    if (quote) {
      if (char === quote && command[index + 1] === quote) {
        word += quote;
        index++;
      } else if (char === quote) {
        quote = null;
        justClosedQuote = true;
      } else {
        word += char;
      }
      started = true;
    } else if (char === '"' || char === "'") {
      if (justClosedQuote) return null;
      quote = char;
      started = true;
    } else if (/\s/u.test(char)) {
      if (started) {
        if (word === '') return null;
        words.push(word);
        word = '';
        started = false;
      }
      justClosedQuote = false;
    } else {
      if (justClosedQuote) return null;
      word += char;
      started = true;
    }
  }
  if (quote) return null;
  if (started) {
    if (word === '') return null;
    words.push(word);
  }
  if (words.some(value => value.startsWith('-') && value.includes(':'))) return null;
  return words;
}

export function cmdWords(command) {
  if (typeof command !== 'string' ||
      !/^[\x09\x20-\x7e]*$/u.test(command) ||
      /[&|<>^%!()\n\r]/u.test(command)) return null;
  const words = [];
  let word = '', quoted = false, started = false, justClosedQuote = false;
  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    if (quoted) {
      if (char === '"') {
        if (word.endsWith('\\')) return null;
        quoted = false;
        justClosedQuote = true;
      } else {
        word += char;
      }
      started = true;
    } else if (char === '"') {
      if (started || justClosedQuote) return null;
      quoted = true;
      started = true;
    } else if (char === ' ' || char === '\t') {
      if (started) {
        words.push(word);
        word = '';
        started = false;
      }
      justClosedQuote = false;
    } else {
      if (justClosedQuote) return null;
      word += char;
      started = true;
    }
  }
  if (quoted) return null;
  if (started) words.push(word);
  if (['call', 'cmd', 'cmd.exe', 'start'].includes(words[0]?.toLowerCase())) return null;
  return words;
}

export function commandWords(shell, command) {
  if (shell === 'bash') return shellWords(command);
  if (shell === 'powershell') return powerShellWords(command);
  if (shell === 'cmd') return cmdWords(command);
  return null;
}

export function isWindowsDevicePath(value) {
  if (typeof value !== 'string') return false;
  return /^\\\\[?.]\\/u.test(value.replaceAll('/', '\\'));
}

export function isUncPath(value) {
  if (typeof value !== 'string' || isWindowsDevicePath(value)) return false;
  return /^\\\\[^\\?][^\\]*\\[^\\]+/u.test(value.replaceAll('/', '\\'));
}

function normalizedPath(value, platform) {
  const api = platform === 'win32' ? path.win32 : path.posix;
  return api.normalize(value);
}

export function sameNativePath(left, right, platform = process.platform) {
  return normalizedPath(left, platform) === normalizedPath(right, platform);
}

export function withinNativePath(root, file, platform = process.platform) {
  const api = platform === 'win32' ? path.win32 : path.posix;
  const normalizedRoot = normalizedPath(root, platform);
  const normalizedFile = normalizedPath(file, platform);
  const rootParts = normalizedRoot.slice(api.parse(normalizedRoot).root.length)
    .split(api.sep).filter(Boolean);
  const fileParts = normalizedFile.slice(api.parse(normalizedFile).root.length)
    .split(api.sep).filter(Boolean);
  if (api.parse(normalizedRoot).root !== api.parse(normalizedFile).root ||
      rootParts.length > fileParts.length) return false;
  return rootParts.every((part, index) => part === fileParts[index]);
}

export function repositoryRelativePath(root, file, platform = process.platform) {
  const api = platform === 'win32' ? path.win32 : path.posix;
  return api.relative(root, file).split(api.sep).join('/');
}

async function executableVersion(command, args) {
  try {
    const result = await execute(command, args, {
      encoding: 'utf8',
      timeout: 2000,
      windowsHide: true,
      env: process.env,
    });
    return { available: true, version: `${result.stdout}${result.stderr}`.trim().split(/\r?\n/u)[0] || 'available' };
  } catch (error) {
    if (error.code === 'ENOENT') return { available: false, reason: 'not found' };
    return { available: false, reason: error.code ?? error.message };
  }
}

export async function platformCapabilities({
  platform = process.platform,
  arch = process.arch,
  nodeVersion = process.version,
} = {}) {
  const shells = {};
  if (platform === 'win32') {
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
    const windowsPowerShell = path.win32.join(systemRoot,
      'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    shells.cmd = await executableVersion(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'ver']);
    shells.powershell = await executableVersion(windowsPowerShell,
      ['-NoLogo', '-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()']);
    shells.bash = { available: false, reason: 'not a required Windows adapter' };
  } else {
    shells.bash = await executableVersion('/bin/sh', ['-c', 'printf %s \"$0\"']);
    shells.powershell = await executableVersion('pwsh',
      ['-NoLogo', '-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()']);
    shells.cmd = { available: false, reason: 'Windows-only adapter' };
  }
  return {
    platform,
    arch,
    nodeVersion,
    nodeSupported: Number(process.versions.node.split('.')[0]) >= 22,
    shells,
    paths: {
      spaces: true,
      driveLetters: platform === 'win32',
      unc: platform === 'win32',
      cmdUncCwd: false,
      deviceNamespaces: false,
      caseComparison: 'case-preserving canonical ancestry',
    },
    filesystem: {
      atomicReplace: true,
      boundedWindowsReplaceRetry: true,
      posixModes: platform !== 'win32',
      reparsePoints: platform === 'win32' ? 'canonicalize-and-recheck' : 'not-applicable',
    },
    verification: {
      status: 'unverified',
      source: 'Native host checkpoints are external evidence; installation does not manufacture a pass.',
    },
  };
}

export async function isDirectorySymbolicLinkOrJunction(file) {
  const stat = await fs.lstat(file);
  return stat.isSymbolicLink();
}
