import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execute = promisify(execFile);
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const TOOLCHAIN = JSON.parse(await fs.readFile(new URL('./toolchain.json', import.meta.url), 'utf8'));

export function launcherBuildEnvironment(environment = process.env) {
  const controlled = new Set([...Object.keys(TOOLCHAIN.environment), 'GOROOT', 'GOCACHE',
    'GOTMPDIR', 'TMPDIR', 'TEMP', 'TMP']);
  const inherited = Object.fromEntries(Object.entries(environment)
    .filter(([key]) => !controlled.has(key.toUpperCase())));
  return { ...inherited, ...TOOLCHAIN.environment };
}

export async function buildLauncher({
  outputDir = path.join(ROOT, 'dist', 'winget-launcher'),
  goCommand = process.env.SDLC_GO || 'go',
  environment = process.env,
} = {}) {
  const destination = path.resolve(outputDir);
  if (destination === path.resolve(ROOT)) throw new Error('Launcher output cannot be the repository root');
  const env = launcherBuildEnvironment(environment);
  const { stdout } = await execute(goCommand, ['version'], { env });
  if (stdout.trim().split(/\s+/u)[2] !== TOOLCHAIN.goVersion) {
    throw new Error(`Launcher requires exactly ${TOOLCHAIN.goVersion}; received ${stdout.trim()}`);
  }
  await fs.mkdir(destination, { recursive: true });
  if (!(await fs.lstat(destination)).isDirectory()) throw new Error('Launcher output must be a real directory');
  for (const entry of await fs.readdir(destination, { withFileTypes: true })) {
    if (entry.name !== 'sdlc.exe' || !entry.isFile()) {
      throw new Error('Launcher output must be empty or contain only the owned sdlc.exe');
    }
  }
  const scratch = path.join(ROOT, '.test-data', `launcher-build-${randomUUID()}`);
  await fs.mkdir(scratch, { recursive: true });
  try {
    const outputs = [];
    for (const iteration of ['first', 'second']) {
      const directory = path.join(scratch, iteration);
      await fs.mkdir(directory);
      const artifact = path.join(directory, 'sdlc.exe');
      await execute(goCommand, ['build', ...TOOLCHAIN.flags, '-o', artifact, '.'], {
        cwd: path.join(ROOT, 'cmd', 'sdlc-launcher'),
        env: { ...env, GOCACHE: path.join(directory, 'cache'), GOTMPDIR: directory, TMPDIR: directory, TEMP: directory, TMP: directory },
        maxBuffer: 4 * 1024 * 1024,
      });
      outputs.push(await fs.readFile(artifact));
    }
    if (!outputs[0].equals(outputs[1])) throw new Error('Independent launcher rebuilds differ');
    const bytes = outputs[0];
    const peOffset = bytes.readUInt32LE(0x3c);
    if (bytes.toString('ascii', 0, 2) !== 'MZ' ||
        bytes.toString('ascii', peOffset, peOffset + 4) !== 'PE\u0000\u0000' ||
        bytes.readUInt16LE(peOffset + 4) !== 0x8664) {
      throw new Error('Launcher is not a Windows x64 PE executable');
    }
    const artifact = path.join(destination, 'sdlc.exe');
    // Refuse symlink replacement, including an output changed during the build.
    const previous = await fs.lstat(artifact).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (previous && !previous.isFile()) throw new Error('Existing launcher is not an owned regular file');
    if (previous) await fs.unlink(artifact);
    await fs.copyFile(path.join(scratch, 'first', 'sdlc.exe'), artifact, fs.constants.COPYFILE_EXCL);
    await fs.chmod(artifact, 0o644);
    return { artifact, filename: 'sdlc.exe', sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, toolchain: TOOLCHAIN.goVersion };
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--output-dir')) {
    throw new Error('Usage: node packaging/winget/build-launcher.mjs [--output-dir DIRECTORY]');
  }
  console.log(JSON.stringify(await buildLauncher({ outputDir: args[1] }), null, 2));
}
