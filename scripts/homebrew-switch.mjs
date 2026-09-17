import * as fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import {
  advanceSwitchState, captureSwitchState, findInstalledKeg, finishSwitchState,
  linkState, ownsLauncher, preserveCapturedKegs,
} from '../packaging/homebrew/switch-state.mjs';

const execute = promisify(execFile);
export function runHomebrewCommand(command, args, { input = '', ...options } = {}) {
  const pending = execute(command, args, options);
  pending.child.stdin?.end(input);
  return pending;
}
const formulaName = value => typeof value === 'string' &&
  /^(?:[a-zA-Z0-9][a-zA-Z0-9_-]*\/[a-zA-Z0-9][a-zA-Z0-9_-]*\/)?[a-zA-Z0-9][a-zA-Z0-9@+_.-]*$/u.test(value);
const owned = ownsLauncher;

export async function assertNativeMacHost(run = runHomebrewCommand, env = process.env) {
  if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch)) {
    throw new Error('Homebrew switching requires native macOS x64 or arm64');
  }
  const uname = (await run('/usr/bin/uname', ['-m'], { env })).stdout.trim();
  if (uname !== (process.arch === 'arm64' ? 'arm64' : 'x86_64')) {
    throw new Error('The selected process is not native to the macOS host architecture');
  }
  let translated;
  try {
    translated = (await run('/usr/sbin/sysctl', ['-n', 'sysctl.proc_translated'], { env })).stdout.trim();
    if (translated !== '0') throw new Error('Rosetta cannot satisfy native Homebrew runtime validation');
  } catch (error) {
    if (error.code !== 1 || process.arch !== 'x64' || !error.stderr?.includes('unknown oid')) throw error;
    translated = 'unavailable on native Intel';
  }
  return { uname, translated };
}

export async function promoteHomebrewLink({
  prefix, formula, newKeg, previousFormula, previousKeg, runBrew, capturedLink,
}) {
  const destination = path.join(prefix, 'bin', 'sdlc');
  const captured = capturedLink ?? await linkState(destination);
  const current = await linkState(destination);
  if (owned(current, newKeg)) {
    return { linked: true, alreadyLinked: true,
      previousRetained: captured.kind !== 'absent' && Boolean(previousKeg) };
  }
  if (captured.kind !== 'absent' &&
      (!previousFormula || !previousKeg || !owned(captured, previousKeg))) {
    throw new Error('Unidentified sdlc destination (including global npm links); nothing was replaced. Retain both packages and resolve ownership manually.');
  }
  try {
    if (current.kind !== 'absent') {
      if (!owned(current, previousKeg)) throw new Error('Unidentified sdlc destination appeared during installation');
      await runBrew(['unlink', previousFormula]);
      if ((await linkState(destination)).kind !== 'absent') {
        throw new Error('Old Homebrew link was not removed');
      }
    }
    await runBrew(['link', formula]);
    if (!owned(await linkState(destination), newKeg)) {
      throw new Error('Homebrew did not link the expected new Cellar launcher');
    }
    return { linked: true, previousRetained: captured.kind !== 'absent' };
  } catch (error) {
    let restoration = captured.kind === 'absent' ? 'no old link to restore' : 'old link retained';
    try {
      let current = await linkState(destination);
      if (owned(current, newKeg)) {
        await runBrew(['unlink', formula]);
        current = await linkState(destination);
      }
      if (captured.kind !== 'absent' && current.kind === 'absent') {
        await fs.access(path.join(previousKeg, 'bin', 'sdlc'));
        await fs.symlink(captured.target, destination);
        const restored = await linkState(destination);
        if (!owned(restored, previousKeg) || restored.target !== captured.target) {
          throw new Error('Captured old link was not restored exactly');
        }
        restoration = 'old link restored';
      } else if (current.kind !== 'absent' && !owned(current, previousKeg ?? '')) {
        restoration = 'unidentified destination retained; restore the old link manually';
      }
    } catch (restoreError) {
      restoration = `restoration failed: ${restoreError.message}`;
    }
    throw new Error(`Homebrew link promotion failed; ${restoration}. Both packages are retained. ${error.message}`,
      { cause: error });
  }
}

async function brewContext(brew, environment, run) {
  const env = { ...environment, HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_ANALYTICS: '1',
    HOMEBREW_NO_INSTALL_CLEANUP: '1', HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK: '1' };
  const runBrew = args => run(brew, args, { env, maxBuffer: 8 * 1024 * 1024 });
  await assertNativeMacHost(run, env);
  const prefix = await fs.realpath((await runBrew(['--prefix'])).stdout.trim());
  const cellar = await fs.realpath((await runBrew(['--cellar'])).stdout.trim());
  return { env, runBrew, prefix, cellar };
}

async function nodeIdentity(node, run, env) {
  const runtime = JSON.parse((await run(node, ['-p',
    'JSON.stringify({execPath:process.execPath,major:Number(process.versions.node.split(".")[0]),platform:process.platform,arch:process.arch})'],
  { env })).stdout);
  if (!Number.isInteger(runtime.major) || runtime.major < 22 ||
      runtime.platform !== process.platform || runtime.arch !== process.arch ||
      runtime.execPath !== await fs.realpath(node)) {
    throw new Error('The retained Node runtime must be native Node 22+ at the exact selected executable');
  }
  return runtime.execPath;
}

export async function verifyHomebrewHooks({ doctor, forbiddenKegs = [], node, run = runHomebrewCommand,
  environment = process.env, executeHooks = false }) {
  if (!doctor.installed || !Array.isArray(doctor.findings) || doctor.findings.length) {
    throw new Error('Framework doctor did not establish a healthy copied installation');
  }
  const hooks = JSON.parse(await fs.readFile(path.join(doctor.home, 'hooks', 'sdlc.json'), 'utf8'));
  const copiedCli = path.join(doctor.home, 'sdlc', 'bin', 'sdlc.mjs');
  const handlers = Object.values(hooks.hooks).flat();
  if (!handlers.length) throw new Error('Installed hook commands are missing');
  for (const handler of handlers) {
    if (!Array.isArray(handler.args) || handler.args[0] !== copiedCli ||
        typeof handler.exec !== 'string') throw new Error('Hook does not invoke the copied Copilot-home CLI');
    for (const argument of [handler.exec, ...handler.args]) {
      if (typeof argument !== 'string' ||
          forbiddenKegs.some(keg => keg && argument.includes(keg))) {
        throw new Error('Installed hooks still depend on a channel payload');
      }
    }
    if (node && await fs.realpath(handler.exec) !== node) {
      throw new Error('Hook-bound Node differs from the independently retained runtime');
    }
    if (executeHooks) {
      const { stdout } = await run(handler.exec, handler.args, { env: environment, input: '{}\n' });
      for (const line of stdout.trim().split('\n').filter(Boolean)) JSON.parse(line);
    }
  }
}

export async function switchToHomebrew({
  brew = 'brew', formula = 'urmich/ai-sdlc-framework/ai-sdlc-framework',
  home, previousFormula, purgeExisting = false, environment = process.env,
  run = runHomebrewCommand,
} = {}) {
  if (!formulaName(formula) || (previousFormula && !formulaName(previousFormula))) {
    throw new Error('Invalid Homebrew formula name');
  }
  if (process.platform !== 'darwin') throw new Error('Homebrew switching is supported on macOS only');
  const { env, runBrew, prefix, cellar } = await brewContext(brew, environment, run);
  const state = await captureSwitchState({ prefix, cellar, formula, previousFormula, runBrew });
  let newKeg;
  let result;
  try {
    await advanceSwitchState(state, 'installing-new-channel');
    await runBrew(['install', '--formula', '--skip-link', formula]);
    newKeg = await findInstalledKeg(runBrew, formula, cellar);
    state.newKeg = newKeg;
    await preserveCapturedKegs(state);
    await advanceSwitchState(state, 'installing-framework');
    const launcher = path.join(newKeg, 'bin', 'sdlc');
    const flags = home ? ['--home', path.resolve(home)] : [];
    const invocation = async args => JSON.parse((await run(launcher, args,
      { env, maxBuffer: 8 * 1024 * 1024 })).stdout);
    const install = await invocation(['install', ...flags, ...(purgeExisting ? ['--purge-existing'] : [])]);
    const doctor = await invocation(['doctor', ...flags]);
    const pkg = JSON.parse(await fs.readFile(path.join(newKeg, 'libexec', 'package', 'package.json'), 'utf8'));
    if (!install.installed || doctor.frameworkVersion !== pkg.version) {
      throw new Error('New Homebrew launcher failed install/version verification');
    }
    await verifyHomebrewHooks({ doctor, forbiddenKegs: [newKeg, state.previousKeg] });
    await advanceSwitchState(state, 'promoting-new-link');
    const promoted = await promoteHomebrewLink({ prefix, formula, newKeg,
      previousFormula: state.previousFormula, previousKeg: state.previousKeg,
      capturedLink: state.capturedLink, runBrew });
    result = { ...promoted, launcher, frameworkVersion: doctor.frameworkVersion,
      restartRequired: true, oldPackageRemoved: false };
  } catch (error) {
    return finishSwitchState(state, { error, newKeg });
  }
  return { ...result, ...await finishSwitchState(state) };
}

export async function switchFromHomebrew({
  brew = 'brew', formula = 'urmich/ai-sdlc-framework/ai-sdlc-framework',
  sourceRoot, home, purgeExisting = false, environment = process.env, run = runHomebrewCommand,
} = {}) {
  if (!formulaName(formula)) throw new Error('Invalid Homebrew formula name');
  if (process.platform !== 'darwin') throw new Error('Homebrew switching is supported on macOS only');
  if (!sourceRoot) throw new Error('Provide an independently verified extracted or non-global npm package root');
  const source = await fs.realpath(sourceRoot);
  const pkg = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
  if (pkg.name !== 'ai-sdlc-framework' || typeof pkg.version !== 'string' ||
      !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(pkg.version)) {
    throw new Error('The replacement root must contain an ai-sdlc-framework package');
  }
  const { env, runBrew, prefix, cellar } = await brewContext(brew, environment, run);
  const relative = path.relative(cellar, source);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('The replacement package must be outside Homebrew Cellar');
  }
  const state = await captureSwitchState({ prefix, cellar, formula, runBrew });
  let result;
  try {
    if (!state.targetKeg) throw new Error('There is no installed Homebrew channel to replace');
    const runtimeKeg = await findInstalledKeg(runBrew, 'node@22', cellar);
    const node = await nodeIdentity(path.join(runtimeKeg, 'bin', 'node'), run, env);
    await advanceSwitchState(state, 'retaining-node');
    await runBrew(['tab', '--installed-on-request', '--formula', 'node@22']);
    const retained = JSON.parse(await fs.readFile(path.join(runtimeKeg, 'INSTALL_RECEIPT.json'), 'utf8'));
    if (retained.installed_on_request !== true) throw new Error('Homebrew did not retain Node independently of the formula');
    state.retainedNode = node;
    await advanceSwitchState(state, 'installing-replacement');
    const flags = home ? ['--home', path.resolve(home)] : [];
    const entry = path.join(source, 'bin', 'sdlc.mjs');
    const invoke = async (cli, args) => JSON.parse((await run(node, [cli, ...args, ...flags],
      { env, maxBuffer: 8 * 1024 * 1024 })).stdout);
    const installed = await invoke(entry, ['install', ...(purgeExisting ? ['--purge-existing'] : [])]);
    const doctor = await invoke(entry, ['doctor']);
    if (!installed.installed || doctor.frameworkVersion !== pkg.version) {
      throw new Error('Replacement package failed install/version verification');
    }
    await verifyHomebrewHooks({ doctor, forbiddenKegs: [state.targetKeg], node,
      run, environment: env, executeHooks: true });
    await verifyHomebrewHooks({ doctor: await invoke(entry, ['doctor']),
      forbiddenKegs: [state.targetKeg], node });
    await advanceSwitchState(state, 'removing-old-channel');
    await runBrew(['unlink', formula]);
    await runBrew(['uninstall', '--force', '--formula', formula]);
    await advanceSwitchState(state, 'verifying-after-removal');
    const copiedCli = path.join(doctor.home, 'sdlc', 'bin', 'sdlc.mjs');
    await nodeIdentity(node, run, env);
    const afterRemoval = await invoke(copiedCli, ['doctor']);
    await verifyHomebrewHooks({ doctor: afterRemoval, forbiddenKegs: [state.targetKeg], node,
      run, environment: env, executeHooks: true });
    const finalDoctor = await invoke(copiedCli, ['doctor']);
    await verifyHomebrewHooks({ doctor: finalDoctor, forbiddenKegs: [state.targetKeg], node });
    if (finalDoctor.frameworkVersion !== pkg.version) throw new Error('Post-removal framework version changed');
    result = { switched: true, oldPackageRemoved: true, node, home: doctor.home,
      restartRequired: true, frameworkVersion: pkg.version };
  } catch (error) {
    return finishSwitchState(state, { error });
  }
  return { ...result, ...await finishSwitchState(state) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: {
    brew: { type: 'string' }, formula: { type: 'string' }, home: { type: 'string' },
    'previous-formula': { type: 'string' }, 'purge-existing': { type: 'boolean' },
    'to-extracted': { type: 'string' },
  } });
  const options = {
    brew: values.brew, formula: values.formula, home: values.home,
    previousFormula: values['previous-formula'], purgeExisting: values['purge-existing'],
  };
  if (values['to-extracted'] && values['previous-formula']) {
    throw new Error('--previous-formula applies only when switching to Homebrew');
  }
  const result = values['to-extracted']
    ? await switchFromHomebrew({ ...options, sourceRoot: values['to-extracted'] })
    : await switchToHomebrew(options);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
