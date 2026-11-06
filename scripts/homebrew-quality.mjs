import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { sha256 } from '../packaging/standalone/archive.mjs';
import { ROOT, emptyDirectory, validateInitialHomebrewFormula, writeJson } from './release-bundle.mjs';
import { verifyHomebrewPrefixOwnership } from './native-homebrew-prefix.mjs';
import { createOwnedCommandRunner, processDiagnostic } from './validation-tools.mjs';

function contained(root, file) {
  const relative = path.relative(root, file);
  return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function blocked(message) {
  return Object.assign(new Error(message), { code: 'RELEASE_INTEGRATION_BLOCKED',
    homebrewResult: { nativeValidation: 'NotRun', reason: message } });
}

async function literalDirectories(root, parts) {
  let directory = root;
  for (const part of parts) {
    directory = path.join(directory, part);
    await fs.mkdir(directory).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Homebrew quality directory is not a literal directory');
  }
  return directory;
}

// Injected runners must supply their in-process settlement observer, not output-shaped cleanup authority.
export async function verifyHomebrewQuality({ candidate, formulaPath, mode, candidateBaseUrl, targetArch,
  outputDir, brew = process.env.SDLC_HOMEBREW_BREW, environment = process.env, run, processSettlement,
  lifetime = { cleanupSafe: true } }) {
  if (!['arm64', 'x64'].includes(targetArch)) throw new Error('Select an explicit Homebrew audit architecture');
  if (run === undefined) {
    const owned = createOwnedCommandRunner({ lifetime });
    run = owned.run;
    processSettlement = owned.isSettled;
  }
  if (typeof run !== 'function' || typeof processSettlement !== 'function') {
    throw new TypeError('Homebrew quality requires its in-process command settlement observer.');
  }
  if (lifetime.cleanupSafe === false) throw Object.assign(
    new Error('An unsettled owned command prevents Homebrew quality work.'), { code: 'STOP_UNVERIFIED' });
  const formulaStat = await fs.lstat(formulaPath);
  if (!formulaStat.isFile() || formulaStat.isSymbolicLink()) throw new Error('Homebrew quality requires a regular candidate formula');
  const contents = await fs.readFile(formulaPath, 'utf8');
  const metadata = validateInitialHomebrewFormula({ descriptor: candidate.descriptor,
    repository: candidate.context.releaseRepository, contents, mode, candidateBaseUrl });
  const formula = { filename: 'ai-sdlc-framework.rb', kind: 'homebrew',
    sha256: sha256(Buffer.from(contents)), size: Buffer.byteLength(contents) };
  const localPath = path.join(ROOT, '.test-data');
  if ((await fs.lstat(localPath)).isSymbolicLink()) throw new Error('Homebrew quality scratch root cannot be a symlink');
  const localRoot = await fs.realpath(localPath);
  if (!brew || !path.isAbsolute(brew)) throw blocked('Homebrew audit/style requires an approved isolated brew executable');
  const executable = await fs.realpath(brew).catch(error => {
    if (!['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code)) throw error;
    throw blocked(`Homebrew audit/style executable is unavailable: ${error.code}`);
  });
  let ownedPrefix;
  if (!contained(localRoot, executable)) {
    if (!environment.SDLC_HOMEBREW_PREFIX_PROOF) {
      throw blocked('Homebrew audit/style cannot use a system or external Homebrew prefix');
    }
    const verified = await verifyHomebrewPrefixOwnership({
      bootstrapDirectory: environment.SDLC_HOMEBREW_PREFIX_PROOF, repositoryRoot: path.resolve(ROOT),
      target: `macos-${process.arch}`, environment,
    });
    ownedPrefix = verified.prefix;
    if (executable !== path.join(ownedPrefix, 'bin', 'brew')) {
      throw blocked('Homebrew audit/style executable differs from its verified owned prefix');
    }
  }
  await fs.access(executable, fs.constants.X_OK).catch(error => {
    if (!['ENOENT', 'EACCES'].includes(error.code)) throw error;
    throw blocked(`Homebrew audit/style executable cannot run: ${error.code}`);
  });
  outputDir = path.resolve(outputDir);
  if (!contained(localRoot, outputDir)) throw new Error('Homebrew quality evidence must use project-local scratch');
  await literalDirectories(localRoot, path.relative(localRoot, path.dirname(outputDir)).split(path.sep).filter(Boolean));
  await emptyDirectory(outputDir);
  if (!contained(localRoot, await fs.realpath(outputDir))) throw new Error('Homebrew quality scratch escapes the checkout');
  const allowed = Object.fromEntries(Object.entries(environment).filter(([key]) =>
    !/token|credential|password|secret|auth|^homebrew_|^rubyopt$|^rubocop|^gem_|^bundle_|^git_|^node_options$|^node_path$/iu.test(key)));
  const env = { ...allowed, HOME: path.join(outputDir, 'home'), HOMEBREW_NO_AUTO_UPDATE: '1',
    HOMEBREW_NO_ANALYTICS: '1', HOMEBREW_DEVELOPER: '1', HOMEBREW_NO_INSTALL_CLEANUP: '1',
    HOMEBREW_NO_INSTALL_FROM_API: '1', HOMEBREW_CACHE: path.join(outputDir, 'cache'),
    HOMEBREW_LOGS: path.join(outputDir, 'logs'), HOMEBREW_TEMP: path.join(outputDir, 'tmp'),
    TMPDIR: path.join(outputDir, 'tmp'), TMP: path.join(outputDir, 'tmp'), TEMP: path.join(outputDir, 'tmp'),
    RUBOCOP_CACHE_ROOT: path.join(outputDir, 'rubocop-cache'),
    GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  for (const key of ['HOME', 'HOMEBREW_CACHE', 'HOMEBREW_LOGS', 'HOMEBREW_TEMP', 'RUBOCOP_CACHE_ROOT']) {
    await fs.mkdir(env[key]);
  }
  const result = { schemaVersion: 1, identity: candidate.context.identity, targetArch, mode,
    formula, nodeDependency: metadata.nodeDependency, nativeExecution: 'NotRun',
    tool: 'Homebrew', brew: executable, brewVersion: '', commands: [],
    style: { status: 'NotRun' }, audit: { status: 'NotRun' } };
  let observationError;
  const settled = () => {
    try { return processSettlement() === true; }
    catch (error) {
      observationError ??= error;
      result.settlementDiagnostic ??= processDiagnostic(error);
      return false;
    }
  };
  const executeCommand = async (command, args, options) => {
    const output = await run(command, args, options);
    if (!settled()) {
      lifetime.cleanupSafe = false;
      throw Object.assign(new Error('Homebrew quality writer settlement is unverified.'),
        { code: 'STOP_UNVERIFIED', stdout: output.stdout, stderr: output.stderr, ownedProcess: output.ownedProcess });
    }
    return output;
  };
  const command = async (args, stage) => {
    const record = { command: executable, args, exitCode: null };
    result.commands.push(record);
    try {
      const output = await executeCommand(executable, args, { env, cwd: ROOT, timeout: 300_000, maxBuffer: 8 * 1024 * 1024 });
      Object.assign(record, { exitCode: 0, stdout: output.stdout, stderr: output.stderr, ownedProcess: output.ownedProcess });
      if (stage) result[stage] = { status: 'Passed', args, exitCode: 0 };
      return output.stdout.trim();
    } catch (error) {
      Object.assign(record, { exitCode: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? error.message,
        ownedProcess: error.ownedProcess });
      if (stage) result[stage] = { status: 'Failed', args, exitCode: error.code };
      throw error;
    }
  };
  let tapRoot;
  let tapCreated = false;
  let primaryError;
  try {
    const prefix = await fs.realpath(await command(['--prefix']));
    const repository = await fs.realpath(await command(['--repository']));
    if (ownedPrefix ? prefix !== ownedPrefix || repository !== ownedPrefix :
      !contained(localRoot, prefix) || !contained(localRoot, repository)) {
      throw blocked('Homebrew audit/style prefix and repository must match the owned allocation or checkout .test-data');
    }
    result.brewVersion = await command(['--version']);
    const parent = await literalDirectories(repository, ['Library', 'Taps', 'local']);
    const tapName = `sdlc-quality-${randomUUID().replaceAll('-', '')}`;
    tapRoot = path.join(parent, `homebrew-${tapName}`);
    await fs.mkdir(tapRoot);
    tapCreated = true;
    await fs.mkdir(path.join(tapRoot, 'Formula'));
    const staged = path.join(tapRoot, 'Formula', formula.filename);
    await fs.writeFile(staged, contents, { flag: 'wx' });
    await executeCommand('git', ['init', '--quiet', tapRoot], { cwd: ROOT, env, timeout: 30_000 });
    const name = `local/${tapName}/ai-sdlc-framework`;
    await command(['style', staged], 'style');
    if (!(await fs.lstat(staged)).isFile() || sha256(await fs.readFile(staged)) !== formula.sha256) {
      throw new Error('Homebrew style changed the frozen formula');
    }
    await command(['audit', '--strict', '--formula', '--os=macos',
      `--arch=${targetArch === 'x64' ? 'intel' : 'arm'}`, name], 'audit');
    for (const file of [formulaPath, staged]) {
      if (!(await fs.lstat(file)).isFile() || sha256(await fs.readFile(file)) !== formula.sha256) {
        throw new Error('Homebrew audit/style changed the frozen formula');
      }
    }
    result.validation = 'Passed';
    return result;
  } catch (error) {
    primaryError = error;
    result.validation = error.code === 'RELEASE_INTEGRATION_BLOCKED' ? 'NotRun' : 'Failed';
    result.reason = error.message;
    error.homebrewQuality = result;
    throw error;
  } finally {
    let pending = primaryError;
    const finalizationFailure = (error, resultField, errorField) => {
      const diagnostic = processDiagnostic(error);
      result.validation = 'Failed';
      result.reason ??= diagnostic.message;
      result[resultField] = diagnostic;
      if (pending) pending[errorField] = diagnostic;
      else {
        pending = error;
        pending.homebrewQuality = result;
      }
    };
    if (!settled()) {
      lifetime.cleanupSafe = false;
      result.cleanupDeferred = { tapRoot: tapRoot ?? null, reason: 'Owned writer settlement is unverified' };
      finalizationFailure(observationError ?? Object.assign(new Error('Homebrew quality cleanup deferred until owned writers settle.'),
        { code: 'STOP_UNVERIFIED' }), 'cleanupDiagnostic', 'qualityCleanupDiagnostic');
    } else if (tapCreated) {
      try { await fs.rm(tapRoot, { recursive: true, force: true }); }
      catch (error) { finalizationFailure(error, 'cleanupDiagnostic', 'qualityCleanupDiagnostic'); }
    }
    try { await writeJson(path.join(outputDir, 'quality-evidence.json'), result); }
    catch (error) { finalizationFailure(error, 'retentionDiagnostic', 'qualityRetentionDiagnostic'); }
    if (!primaryError && pending) throw pending;
  }
}
