import { spawn } from 'node:child_process';
import { readdir, realpath, stat } from 'node:fs/promises';
import { availableParallelism, constants } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const unitFiles = Object.freeze([
  'test/provider-observations.unit.test.mjs',
  'test/execution-artifact-identity.test.mjs',
  'test/tool-adapters.test.mjs',
]);
const expensiveFiles = [
  'deployment.test.mjs', 'recovery-gate.test.mjs',
  'normalized-operation-retry.test.mjs', 'workflow.test.mjs',
  'pr-artifact-readiness.test.mjs', 'pr.test.mjs',
  'deployment-staging.test.mjs', 'pr-fork-identity.test.mjs',
  'deployment-revisions.test.mjs', 'pr-publication.test.mjs',
];
const maxWorkers = 32;

export function parseOptions(argv, env = process.env) {
  const [profile, ...args] = argv;
  if (!['unit', 'full', 'targeted', 'coverage'].includes(profile)) {
    throw new Error('Expected test profile: unit, full, targeted or coverage.');
  }
  const options = { profile, files: [], workers: env.SDLC_TEST_WORKERS };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') {
      options.files.push(...args.slice(index + 1));
      break;
    }
    if (arg === '--workers' || arg === '--name') {
      if (seen.has(arg) || !args[index + 1] || args[index + 1].startsWith('--')) {
        throw new Error(`Expected exactly one value for ${arg}.`);
      }
      seen.add(arg);
      options[arg === '--workers' ? 'workers' : 'name'] = args[++index];
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      options.files.push(arg);
    }
  }
  if (profile !== 'targeted' && (options.files.length || options.name !== undefined)) {
    throw new Error('Explicit files and --name require the targeted profile.');
  }
  if (profile === 'targeted' && !options.files.length) {
    throw new Error('The targeted profile requires at least one test file.');
  }
  if (options.name !== undefined) new RegExp(options.name);
  if (options.workers !== undefined &&
      (!/^[1-9]\d*$/u.test(options.workers) || Number(options.workers) > maxWorkers)) {
    throw new Error(`Workers must be an integer from 1 to ${maxWorkers}.`);
  }
  options.workers = options.workers === undefined ?
    Math.min(16, availableParallelism()) : Number(options.workers);
  return options;
}

function within(directory, file) {
  const relative = path.relative(directory, file);
  return relative !== '' && relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function createPlan(options, root = repositoryRoot) {
  const testRoot = await realpath(path.join(root, 'test'));
  let selected;
  if (options.profile === 'unit') {
    selected = [...unitFiles];
  } else if (options.profile === 'targeted') {
    selected = options.files;
  } else {
    const entries = await readdir(testRoot, { withFileTypes: true });
    selected = entries.filter(entry =>
      (entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith('.test.mjs'))
      .map(entry => path.join('test', entry.name));
    selected.sort((a, b) => {
      const rank = file => {
        const index = expensiveFiles.indexOf(path.basename(file));
        return index === -1 ? expensiveFiles.length : index;
      };
      return rank(a) - rank(b) || a.localeCompare(b, 'en');
    });
  }
  if (!selected.length) throw new Error('The selected profile contains no test files.');
  const files = [];
  const canonical = new Set();
  for (const file of selected) {
    const resolved = path.resolve(root, file);
    if (!within(path.join(root, 'test'), resolved) || !resolved.endsWith('.test.mjs')) {
      throw new Error('Test files must be .test.mjs files inside the repository test directory.');
    }
    const actual = await realpath(resolved);
    if (!within(testRoot, actual) || !(await stat(actual)).isFile()) {
      throw new Error('Selected test file is not a regular file inside the test directory.');
    }
    if (canonical.has(actual)) throw new Error('A test file was selected more than once.');
    canonical.add(actual);
    files.push(resolved);
  }
  return {
    ...options, files,
    testOptions: {
      files, concurrency: options.workers, cwd: root,
      coverage: options.profile === 'coverage',
      ...(options.name === undefined ? {} : { testNamePatterns: [options.name] }),
    },
    args: [
      ...(options.profile === 'coverage' ? ['--experimental-test-coverage'] : []),
      fileURLToPath(new URL('./test-worker.mjs', import.meta.url)),
    ],
  };
}

export async function run(plan) {
  const started = performance.now();
  const metadata = {
    profile: plan.profile, workers: plan.workers,
    files: plan.files.map(file => path.relative(repositoryRoot, file).split(path.sep).join('/')),
    executable: process.execPath, node: process.version,
    platform: process.platform, architecture: process.arch,
  };
  console.log(`[test-runner:start] ${JSON.stringify(metadata)}`);
  const env = { ...process.env };
  // This is a new test run even when a test invokes the public command.
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, plan.args, {
    cwd: repositoryRoot, env, stdio: ['pipe', 'inherit', 'inherit', 'ipc'], shell: false,
  });
  let interruption;
  const interrupted = signal => {
    interruption ??= signal;
    if (child.connected) {
      child.send({ type: 'cancel', signal }, error => {
        if (error) console.error(`[test-runner:error] Cancellation delivery failed: ${error.message}`);
      });
    } else if (child.exitCode === null && child.signalCode === null) {
      console.error('[test-runner:error] Cancellation channel closed before the worker exited.');
    }
  };
  const interrupt = () => interrupted('SIGINT');
  const terminate = () => interrupted('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  try {
    const result = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.stdin.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
      child.stdin.end(JSON.stringify(plan.testOptions));
    });
    const childCode = result.code ?? (128 + (constants.signals[result.signal] ?? 1));
    const exitCode = interruption && childCode === 0 ? 128 + constants.signals[interruption] : childCode;
    console.log(`[test-runner:end] ${JSON.stringify({
      ...metadata, elapsedMs: Math.round(performance.now() - started),
      exitCode, signal: result.signal, interruptedBy: interruption ?? null,
    })}`);
    return exitCode;
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    process.exitCode = await run(await createPlan(parseOptions(process.argv.slice(2))));
  } catch (error) {
    console.error(`[test-runner:error] ${error.message}`);
    process.exitCode = 1;
  }
}
