import * as fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const execute = promisify(execFile);
const formulaName = value => typeof value === 'string' &&
  /^(?:[a-zA-Z0-9][a-zA-Z0-9_-]*\/[a-zA-Z0-9][a-zA-Z0-9_-]*\/)?[a-zA-Z0-9][a-zA-Z0-9@+_.-]*$/u.test(value);

async function linkState(file) {
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

const owned = (state, keg) => state.kind === 'link' &&
  state.absolute === path.join(keg, 'bin', 'sdlc');

export async function promoteHomebrewLink({
  prefix, formula, newKeg, previousFormula, previousKeg, runBrew,
}) {
  const destination = path.join(prefix, 'bin', 'sdlc');
  const captured = await linkState(destination);
  if (owned(captured, newKeg)) return { linked: true, alreadyLinked: true };
  if (captured.kind !== 'absent' &&
      (!previousFormula || !previousKeg || !owned(captured, previousKeg))) {
    throw new Error('Unidentified sdlc destination (including global npm links); nothing was replaced. Retain both packages and resolve ownership manually.');
  }
  try {
    if (captured.kind !== 'absent') {
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
        await runBrew(['link', previousFormula]);
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

async function installedKeg(runBrew, formula, cellar) {
  if (!formulaName(formula)) throw new Error('Invalid Homebrew formula name');
  const keg = await fs.realpath((await runBrew(['--prefix', formula])).stdout.trim());
  const relative = path.relative(cellar, keg).split(path.sep);
  if (relative.length !== 2 || relative.some(part => !part || part === '..')) {
    throw new Error('Formula prefix is not an installed Homebrew Cellar keg');
  }
  await fs.access(path.join(keg, 'INSTALL_RECEIPT.json'));
  await fs.access(path.join(keg, 'bin', 'sdlc'));
  return keg;
}

export async function switchToHomebrew({
  brew = 'brew', formula = 'urmich/ai-sdlc-framework/ai-sdlc-framework',
  home, previousFormula, purgeExisting = false, environment = process.env,
  run = execute,
} = {}) {
  if (!formulaName(formula) || (previousFormula && !formulaName(previousFormula))) {
    throw new Error('Invalid Homebrew formula name');
  }
  if (process.platform !== 'darwin') throw new Error('Homebrew switching is supported on macOS only');
  const env = { ...environment, HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_ANALYTICS: '1',
    HOMEBREW_NO_INSTALL_CLEANUP: '1', HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK: '1' };
  const runBrew = args => run(brew, args, { env, maxBuffer: 8 * 1024 * 1024 });
  await runBrew(['install', '--formula', '--skip-link', formula]);
  const prefix = (await runBrew(['--prefix'])).stdout.trim();
  const cellar = await fs.realpath((await runBrew(['--cellar'])).stdout.trim());
  const newKeg = await installedKeg(runBrew, formula, cellar);
  const previousKeg = previousFormula ? await installedKeg(runBrew, previousFormula, cellar) : undefined;
  const launcher = path.join(newKeg, 'bin', 'sdlc');
  const flags = home ? ['--home', path.resolve(home)] : [];
  const invocation = async args => JSON.parse((await run(launcher, args,
    { env, maxBuffer: 8 * 1024 * 1024 })).stdout);
  const install = await invocation(['install', ...flags, ...(purgeExisting ? ['--purge-existing'] : [])]);
  const doctor = await invocation(['doctor', ...flags]);
  const pkg = JSON.parse(await fs.readFile(path.join(newKeg, 'libexec', 'package', 'package.json'), 'utf8'));
  if (!install.installed || !doctor.installed || doctor.frameworkVersion !== pkg.version ||
      !Array.isArray(doctor.findings) || doctor.findings.length) {
    throw new Error('New Homebrew launcher failed install/doctor; old links and both payloads are retained');
  }
  const hooks = JSON.parse(await fs.readFile(path.join(doctor.home, 'hooks', 'sdlc.json'), 'utf8'));
  for (const handler of Object.values(hooks.hooks).flat()) {
    for (const argument of [handler.exec, ...handler.args]) {
      if ([newKeg, previousKeg].some(keg => keg && argument.includes(keg + path.sep))) {
        throw new Error('Installed hooks still depend on a channel payload; old links and both payloads are retained');
      }
    }
  }
  const result = await promoteHomebrewLink({ prefix, formula, newKeg,
    previousFormula, previousKeg, runBrew });
  return { ...result, launcher, frameworkVersion: doctor.frameworkVersion,
    restartRequired: true, oldPackageRemoved: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: {
    brew: { type: 'string' }, formula: { type: 'string' }, home: { type: 'string' },
    'previous-formula': { type: 'string' }, 'purge-existing': { type: 'boolean' },
  } });
  process.stdout.write(`${JSON.stringify(await switchToHomebrew({
    brew: values.brew, formula: values.formula, home: values.home,
    previousFormula: values['previous-formula'], purgeExisting: values['purge-existing'],
  }))}\n`);
}
