import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { requireThat } from '../src/core.mjs';
import { sanitizeExecutionPayload } from 'ai-sdlc-framework/evidence';
import { repositoryRoot } from './test-runner.mjs';
import { executeValidationCommand } from './validation-tools.mjs';
import { nativeToolchain, nativeResourceFacts } from './native-validation.mjs';
import { provisionPrCryptoFixture, prCryptoFixture } from './pr-capabilities.mjs';

export const homebrewToolchain = Object.freeze({
  commit: '99fd9a8eed4ff942c448da0c1f11156302441e4a', ruby: '4.0.7', node: '22.23.3',
});
const targets = { 'linux-x64': ['linux', 'x64'], 'windows-x64': ['win32', 'x64'],
  'macos-arm64': ['darwin', 'arm64'], 'macos-x64': ['darwin', 'x64'] };

export function validateBootstrapRequest({ target, outputDir }) {
  requireThat(targets[target]?.[0] === process.platform && targets[target]?.[1] === process.arch &&
    process.versions.node === nativeToolchain.node, 'HOST', 'Bootstrap requires the pinned native Node and actual matrix host');
  requireThat(typeof outputDir === 'string' && outputDir.trim(), 'INPUT', 'Bootstrap needs a new explicit owned output path');
  const directory = path.resolve(repositoryRoot, outputDir);
  const relative = path.relative(path.join(repositoryRoot, '.test-data'), directory);
  requireThat(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative), 'INPUT', 'Native bootstrap is confined to checkout-local .test-data');
  return directory;
}

export function nativeBootstrapEnvironment(directory, inherited = process.env) {
  requireThat(typeof directory === 'string' && path.isAbsolute(directory), 'INPUT',
    'Bootstrap environment requires its explicit owned absolute directory');
  const environment = { ...Object.fromEntries(Object.entries(inherited)
    .filter(([name]) => !/^HOMEBREW_|^RUBYOPT$|^GEM_|^BUNDLE_/iu.test(name))),
    GOTOOLCHAIN: 'local', CGO_ENABLED: '0',
    HOME: path.join(directory, 'home'), USERPROFILE: path.join(directory, 'home'),
    APPDATA: path.join(directory, 'app-data'), LOCALAPPDATA: path.join(directory, 'local-app-data'),
    COPILOT_HOME: path.join(directory, 'copilot-home'),
    NODE_OPTIONS: '', NODE_PATH: '',
    TMPDIR: path.join(directory, 'scratch'), TMP: path.join(directory, 'scratch'), TEMP: path.join(directory, 'scratch'),
    GOCACHE: path.join(directory, 'go-cache'), GOPATH: path.join(directory, 'go-path'),
    PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1',
    PYTHONUSERBASE: path.join(directory, 'python-user'),
    PYTHONPYCACHEPREFIX: path.join(directory, 'python-bytecode'),
    PIP_CACHE_DIR: path.join(directory, 'pip-cache'),
    PIP_BUILD_TRACKER: path.join(directory, 'pip-build-tracker'),
    PIP_SRC: path.join(directory, 'pip-source'),
    XDG_CACHE_HOME: path.join(directory, 'cache'),
    HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_ANALYTICS: '1',
    HOMEBREW_NO_COLOR: '1', NO_COLOR: '1',
    HOMEBREW_NO_INSTALL_CLEANUP: '1', HOMEBREW_DEVELOPER: '1',
    HOMEBREW_CACHE: path.join(directory, 'brew-cache'), HOMEBREW_LOGS: path.join(directory, 'brew-logs'),
    HOMEBREW_TEMP: path.join(directory, 'scratch'),
  };
  for (const key of ['NODE_AUTH_TOKEN', 'NPM_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN',
    'FORCE_COLOR', 'CLICOLOR_FORCE']) delete environment[key];
  return environment;
}

export function portableRubyBootstrapEnvironment(environment) {
  const selected = { ...environment };
  // The pinned pre-Ruby shell forces colour for Actions and ignores NO_COLOR.
  delete selected.GITHUB_ACTIONS;
  delete selected.HOMEBREW_COLOR;
  return selected;
}

export function schemaPipInstallArguments(environment) {
  requireThat(typeof environment.PIP_CACHE_DIR === 'string' && path.isAbsolute(environment.PIP_CACHE_DIR),
    'INPUT', 'Schema dependency installation requires its explicit owned absolute pip cache');
  return ['-m', 'pip', 'install', '--disable-pip-version-check',
    '--cache-dir', environment.PIP_CACHE_DIR, '--requirement', '.github/release-requirements.txt'];
}

export function nativeBootstrapExports(environment) {
  const keys = ['HOME', 'USERPROFILE', 'COPILOT_HOME', 'GOCACHE', 'GOPATH', 'APPDATA', 'LOCALAPPDATA',
    'PYTHONUSERBASE', 'PYTHONPYCACHEPREFIX', 'PIP_CACHE_DIR', 'PIP_BUILD_TRACKER', 'PIP_SRC',
    'XDG_CACHE_HOME', 'NO_COLOR'];
  requireThat(keys.every(key => typeof environment[key] === 'string' && environment[key].length > 0),
    'INPUT', 'Selected native tool environment must retain all owned cache and home paths');
  return Object.fromEntries(keys.map(key => [key, environment[key]]));
}

export async function bootstrapNativeToolchain(options) {
  const directory = validateBootstrapRequest(options);
  let current = repositoryRoot;
  for (const part of path.relative(repositoryRoot, directory).split(path.sep)) {
    current = path.join(current, part);
    await fs.mkdir(current).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const stat = await fs.lstat(current);
    requireThat(stat.isDirectory() && !stat.isSymbolicLink(), 'HOST', 'Bootstrap cannot traverse linked or non-directory paths');
  }
  requireThat(!(await fs.readdir(directory)).length, 'HOST', 'Bootstrap owns a new empty directory, never an installed prefix');
  const environment = nativeBootstrapEnvironment(directory);
  for (const key of ['HOME', 'COPILOT_HOME', 'TMPDIR', 'GOCACHE', 'GOPATH', 'HOMEBREW_CACHE', 'HOMEBREW_LOGS',
    'APPDATA', 'LOCALAPPDATA', 'PYTHONUSERBASE', 'PYTHONPYCACHEPREFIX', 'PIP_CACHE_DIR', 'PIP_BUILD_TRACKER',
    'PIP_SRC', 'XDG_CACHE_HOME']) {
    await fs.mkdir(environment[key]);
  }
  const reports = [];
  const cancellation = new AbortController();
  const interrupt = () => cancellation.abort();
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  const run = async (name, command, args, cwd = repositoryRoot, commandEnvironment = environment) => {
    const result = await executeValidationCommand({ name, command, args, cwd, environment: commandEnvironment,
      signal: cancellation.signal, outputDir: directory });
    reports.push({ name, complete: result.complete, exitCode: result.exitCode });
    requireThat(result.complete && result.exitCode === 0, 'HOST',
      `Pinned native prerequisite ${name} is unavailable; retained diagnostics identify the blocker`);
    return result.stdout.trim();
  };
  const retained = { schemaVersion: 1, status: 'NotRun', target: options.target,
    native: { platform: process.platform, architecture: process.arch, node: process.versions.node,
      os: os.release(), machine: os.machine(), imageOS: process.env.ImageOS ?? null,
      imageVersion: process.env.ImageVersion ?? null }, reports };
  const selected = {};
  try {
    retained.native.resources = nativeResourceFacts();
    const goRoot = await run('go-root', process.env.SDLC_GO || 'go', ['env', 'GOROOT']);
    selected.SDLC_GO = path.join(goRoot, 'bin', process.platform === 'win32' ? 'go.exe' : 'go');
    const go = await run('go-version', selected.SDLC_GO, ['version']);
    requireThat(go.split(/\s+/u)[2] === nativeToolchain.go, 'HOST', 'The selected Go pin is unavailable; no toolchain download fallback is allowed');
    const pythonCommand = process.env.SDLC_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    const python = JSON.parse(await run('python-identity', pythonCommand, ['-c',
      'import sys,json,platform; print(json.dumps({"executable":sys.executable,"version":platform.python_version(),"implementation":platform.python_implementation(),"machine":platform.machine()}))']));
    requireThat(python.version === nativeToolchain.python && python.implementation === 'CPython' &&
      (process.arch === 'arm64' ? ['arm64', 'aarch64'] : ['AMD64', 'x86_64']).includes(python.machine),
      'HOST', 'The selected native CPython baseline must be available exactly');
    const pythonHome = path.join(directory, 'python');
    await run('schema-python-environment', python.executable, ['-m', 'venv', pythonHome]);
    selected.SDLC_PYTHON = process.platform === 'win32' ?
      path.join(pythonHome, 'Scripts', 'python.exe') : path.join(pythonHome, 'bin', 'python');
    const requirements = (await fs.readFile(path.join(repositoryRoot, '.github', 'release-requirements.txt'), 'utf8'))
      .trim().split(/\r?\n/u).map(line => line.split('=='));
    requireThat(requirements.every(row => row.length === 2 && row.every(Boolean)),
      'HOST', 'Schema dependencies must use exact version pins');
    const probe = ['-c', 'import importlib.metadata,json; print(json.dumps({p:importlib.metadata.version(p) for p in ' +
      `${JSON.stringify(requirements.map(([name]) => name))}}))`];
    const dependencyProbe = await executeValidationCommand({ name: 'schema-dependency-probe',
      command: selected.SDLC_PYTHON, args: probe, environment, signal: cancellation.signal, outputDir: directory });
    reports.push({ name: 'schema-dependency-probe', complete: dependencyProbe.complete, exitCode: dependencyProbe.exitCode });
    if (!dependencyProbe.complete || dependencyProbe.exitCode !== 0) {
      await run('schema-dependencies-install', selected.SDLC_PYTHON,
        schemaPipInstallArguments(environment));
    }
    const packages = JSON.parse(await run('schema-dependencies-verify', selected.SDLC_PYTHON, probe));
    requireThat(requirements.every(([name, version]) => packages[name] === version),
      'HOST', 'Schema package baseline differs; a different installed version is not accepted');
    retained.native.go = go;
    retained.native.python = python;
    retained.native.schemaPackages = packages;
    retained.native.git = await run('git-version', 'git', ['--version']);
    retained.native.executables = { node: process.execPath, go: selected.SDLC_GO, python: selected.SDLC_PYTHON };
    if (process.platform === 'win32') {
      retained.native.powershell = await run('powershell-version', 'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()']);
      retained.native.cmd = await run('cmd-version', process.env.ComSpec, ['/d', '/c', 'ver']);
    } else {
      retained.native.bash = await run('bash-version', '/bin/bash', ['--version']);
      if (process.platform === 'darwin') retained.native.zsh = await run('zsh-version', '/bin/zsh', ['--version']);
    }
    if (process.platform === 'darwin') {
      const uname = await run('mac-uname', '/usr/bin/uname', ['-m']);
      requireThat(uname === (process.arch === 'arm64' ? 'arm64' : 'x86_64'),
        'HOST', 'Translated process architecture cannot satisfy native macOS');
      const translated = await executeValidationCommand({ name: 'mac-translation',
        command: '/usr/sbin/sysctl', args: ['-n', 'sysctl.proc_translated'], environment,
        signal: cancellation.signal, outputDir: directory });
      requireThat(translated.complete && ((translated.exitCode === 0 && translated.stdout.trim() === '0') ||
        (process.arch === 'x64' && translated.exitCode === 1 && translated.stderr.includes('unknown oid'))),
      'HOST', 'Native macOS translation probe is unavailable or indicates Rosetta');
      const brewRoot = path.join(directory, 'homebrew');
      await fs.mkdir(brewRoot);
      await run('brew-git-init', 'git', ['init', '--quiet', brewRoot]);
      await run('brew-git-fetch', 'git', ['-C', brewRoot, 'fetch', '--quiet', '--depth=1',
        'https://github.com/Homebrew/brew.git', homebrewToolchain.commit]);
      await run('brew-git-checkout', 'git', ['-C', brewRoot, 'checkout', '--quiet', '--detach', homebrewToolchain.commit]);
      const actualCommit = await run('brew-git-identity', 'git', ['-C', brewRoot, 'rev-parse', 'HEAD']);
      requireThat(actualCommit === homebrewToolchain.commit, 'HOST', 'Homebrew source pin differs');
      selected.SDLC_HOMEBREW_BREW = path.join(brewRoot, 'bin', 'brew');
      const brew = selected.SDLC_HOMEBREW_BREW;
      requireThat(await fs.realpath(await run('brew-prefix', brew, ['--prefix'])) === await fs.realpath(brewRoot) &&
        await fs.realpath(await run('brew-repository', brew, ['--repository'])) === await fs.realpath(brewRoot),
      'HOST', 'Homebrew must use only the isolated owned prefix and repository');
      await run('brew-portable-ruby', brew, ['vendor-install', 'ruby'], repositoryRoot,
        portableRubyBootstrapEnvironment(environment));
      const ruby = await run('brew-ruby-identity', brew, ['ruby', '-e', 'puts RUBY_VERSION']);
      requireThat(ruby === homebrewToolchain.ruby, 'HOST', 'The integrity-pinned Homebrew portable Ruby is unavailable');
      const rubyExecutable = await run('brew-ruby-path', brew, ['ruby', '-rrbconfig', '-e', 'puts RbConfig.ruby']);
      requireThat(path.relative(brewRoot, await fs.realpath(rubyExecutable)).split(path.sep)[0] !== '..',
        'HOST', 'System Ruby cannot substitute for the isolated portable runtime');
      await run('brew-node-install', brew, ['install', '--formula', 'node@22']);
      const nodePrefix = await run('brew-node-prefix', brew, ['--prefix', 'node@22']);
      requireThat(!(path.relative(brewRoot, await fs.realpath(nodePrefix))).startsWith('..'),
        'HOST', 'Homebrew dependency must remain inside the owned prefix');
      const node = JSON.parse(await run('brew-node-identity', path.join(nodePrefix, 'bin', 'node'),
        ['-p', 'JSON.stringify({version:process.versions.node,platform:process.platform,arch:process.arch})']));
      requireThat(node.version === homebrewToolchain.node && node.platform === 'darwin' && node.arch === process.arch,
        'HOST', 'The native Homebrew Node dependency pin is unavailable; latest/system/Rosetta cannot substitute');
      retained.native.homebrew = { commit: actualCommit, ruby, rubyExecutable, node, nodePrefix,
        uname, translation: translated.exitCode === 0 ? '0' : 'unavailable on native Intel' };
    }
    selected.GOTOOLCHAIN = 'local';
    Object.assign(selected, await provisionPrCryptoFixture({
      root: path.join(directory, 'crypto-fixture'), environment,
      run: async (command, args, options = {}) => ({
        stdout: await run(`crypto-tool-${reports.length + 1}`, command, args, options.cwd ?? repositoryRoot),
      }),
    }));
    retained.native.cryptoFixture = { bundleSha256: prCryptoFixture.bundle.sha256,
      trustSha256: prCryptoFixture.trust.sha256, offline: true, verifier: 'npm-11.16.0-bundled-sigstore' };
    selected.CGO_ENABLED = '0';
    Object.assign(selected, nativeBootstrapExports(environment));
    selected.SDLC_NATIVE_TOOLCHAIN_REPORT = path.join(directory, 'toolchain.json');
    if (process.env.GITHUB_ENV) {
      for (const [name, value] of Object.entries(selected)) {
        requireThat(!/[\r\n]/u.test(value), 'HOST', 'Toolchain paths cannot inject workflow environment entries');
        await fs.appendFile(process.env.GITHUB_ENV, `${name}=${value}\n`);
      }
    }
    retained.status = 'Passed';
    return { ...selected, report: retained };
  } catch (error) {
    retained.blocker = { code: error.code ?? 'NATIVE_BOOTSTRAP', message: error.message };
    throw error;
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
    retained.cancelled = cancellation.signal.aborted;
    const safe = sanitizeExecutionPayload(Buffer.from(JSON.stringify(retained)));
    const handle = await fs.open(path.join(directory, 'toolchain.json'), 'wx');
    try { await handle.writeFile(`${JSON.stringify(safe)}\n`); await handle.sync(); }
    finally { await handle.close(); }
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  requireThat(args.length === 4 && args[0] === '--target' && args[2] === '--output-dir',
    'INPUT', 'Usage: native-toolchain.mjs --target PLATFORM --output-dir OWNED_DIRECTORY');
  await bootstrapNativeToolchain({ target: args[1], outputDir: args[3] });
}
