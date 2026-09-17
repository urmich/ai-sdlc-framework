import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';

const execute = promisify(execFile);
const missing = error => ['ENOENT', 'ENOTDIR'].includes(error.code);

async function npmCliPaths(environment) {
  const nodeDirectory = path.dirname(process.execPath);
  const candidates = [environment.npm_execpath,
    path.join(nodeDirectory, 'node_modules/npm/bin/npm-cli.js'),
    path.join(nodeDirectory, '../lib/node_modules/npm/bin/npm-cli.js'),
    ...(environment.PATH ?? '').split(path.delimiter).filter(Boolean).map(directory => path.join(directory, 'npm'))];
  const paths = new Set();
  for (const candidate of candidates.filter(Boolean)) {
    try {
      const resolved = await fs.realpath(candidate);
      if (resolved.endsWith(`${path.sep}npm${path.sep}bin${path.sep}npm-cli.js`)) paths.add(resolved);
    } catch (error) { if (!missing(error)) throw error; }
  }
  if (!paths.size) throw new Error('Cannot establish a real direct npm CLI negative control');
  return [...paths];
}

export function deniedEnvironment(environment, bin) {
  const allowed = new Set(['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP',
    'TMP', 'TMPDIR', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'LANG', 'LC_ALL', 'TZ', 'COPILOT_HOME']);
  return { ...Object.fromEntries(Object.entries(environment).filter(([key]) => allowed.has(key.toUpperCase()))),
    PATH: bin, SDLC_NODE: process.execPath };
}

const namespaceScript = `set -eu
empty=$1
count=$2
shift 2
/usr/bin/mount --make-rprivate /
while [ "$count" -gt 0 ]; do
  /usr/bin/mount --bind "$empty" "$1"
  /usr/bin/mount -o remount,bind,ro "$1"
  shift
  count=$((count - 1))
done
exec "$@"
`;

export function networkAdapter(platform, { npmRoots, emptyDirectory }) {
  if (platform === 'darwin') {
    const policy = '(version 1)(allow default)(deny network*)' +
      npmRoots.map(root => `(deny file-read* (subpath ${JSON.stringify(root)}))`).join('');
    return { name: 'macos-seatbelt', command: '/usr/bin/sandbox-exec', args: ['-p', policy] };
  }
  if (platform === 'linux') {
    return { name: 'linux-user-mount-network-namespace', command: '/usr/bin/unshare',
      args: ['--user', '--map-root-user', '--mount', '--net', '--fork', '--',
        '/bin/sh', '-c', namespaceScript, 'sdlc-network-boundary',
        emptyDirectory, String(npmRoots.length), ...npmRoots] };
  }
  if (platform === 'win32') {
    return { name: 'windows-native', status: 'NotRun',
      reason: 'No validated Windows per-process network-and-npm filesystem isolation adapter is available. Global firewall changes and proxy/shim substitutes are not permitted evidence.' };
  }
  return { name: platform, status: 'NotRun', reason: 'No native network isolation adapter is available for this platform.' };
}

export async function createNetworkBoundary({ directory, environment }) {
  const adapter = networkAdapter(process.platform, { npmRoots: [], emptyDirectory: '' });
  if (adapter.status === 'NotRun') return adapter;
  try {
    await fs.access('/usr/bin/openssl', fs.constants.X_OK);
  } catch (error) {
    if (!missing(error) && !['EACCES', 'EPERM'].includes(error.code)) throw error;
    return { name: adapter.name, status: 'NotRun',
      reason: 'Native HTTPS negative-control certificate generation requires an executable /usr/bin/openssl.' };
  }
  const clis = await npmCliPaths(environment);
  const npmRoots = clis.map(file => path.dirname(path.dirname(file)));
  const bin = path.join(directory, 'allowed commands');
  const emptyDirectory = path.join(directory, 'empty npm mount');
  await fs.mkdir(bin);
  await fs.mkdir(emptyDirectory);
  for (const [name, file] of [['node', process.execPath], ['dirname', '/usr/bin/dirname'], ['readlink', '/usr/bin/readlink']]) {
    await fs.symlink(await fs.realpath(file), path.join(bin, name));
  }
  const env = deniedEnvironment(environment, bin);
  const selected = networkAdapter(process.platform, { npmRoots, emptyDirectory });
  const run = (command, args, options = {}) => execute(selected.command,
    [...selected.args, command, ...args], { ...options, env, timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
  let probe;
  try {
    probe = await run(process.execPath, ['-e',
      'console.log(JSON.stringify({platform:process.platform,arch:process.arch,networkNamespace:process.platform==="linux"?require("node:fs").readlinkSync("/proc/self/ns/net"):null}))']);
  } catch (error) {
    if (!missing(error) && !/operation not permitted|permission denied|sandbox.*not permitted/iu.test(error.stderr ?? '')) throw error;
    return { name: selected.name, status: 'NotRun',
      reason: `Native isolation cannot be established: ${error.stderr?.trim() || error.message}` };
  }
  const identity = JSON.parse(probe.stdout);
  assert.equal(identity.platform, process.platform);
  assert.equal(identity.arch, process.arch);
  if (process.platform === 'linux') {
    assert.notEqual(identity.networkNamespace, await fs.readlink('/proc/self/ns/net'),
      'The network namespace must differ from the connected parent');
  }
  return { name: selected.name, status: 'Ready', environment: env, execute: run, npmCliPaths: clis };
}

const requestCode = `
const transport = require(process.argv[1].startsWith('https:') ? 'node:https' : 'node:http');
const req = transport.get(process.argv[1], {rejectUnauthorized:false}, response => {
  let data = '';
  response.on('data', chunk => data += chunk);
  response.on('end', () => { if(data !== 'sdlc-network-control')process.exit(74); console.log(data); });
});
req.on('error', error => { console.error(error.code); process.exit(73); });
req.setTimeout(2000, () => { console.error('CONTROL_TIMEOUT'); req.destroy(); process.exit(75); });
`;

export async function verifyNetworkNegativeControls(boundary, directory) {
  const key = path.join(directory, 'control-key.pem');
  const cert = path.join(directory, 'control-cert.pem');
  await execute('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost'],
  { env: boundary.environment, timeout: 15000 });
  const respond = (_request, response) => response.end('sdlc-network-control');
  const servers = [http.createServer(respond), https.createServer({
    key: await fs.readFile(key), cert: await fs.readFile(cert),
  }, respond)];
  try {
    for (const server of servers) {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
    }
    for (const [index, server] of servers.entries()) {
      const url = `${index ? 'https' : 'http'}://127.0.0.1:${server.address().port}`;
      const available = await execute(process.execPath, ['-e', requestCode, url], { env: boundary.environment, timeout: 5000 });
      assert.equal(available.stdout.trim(), 'sdlc-network-control', 'Negative control endpoint must actually work outside isolation');
      await assert.rejects(boundary.execute(process.execPath, ['-e', requestCode, url]), error =>
        error.code === 73 && /EPERM|EACCES|ENETUNREACH|EHOSTUNREACH|ECONNREFUSED/u.test(error.stderr),
      'Direct Node HTTP(S) must be rejected by the OS boundary, not by a proxy or timeout');
    }
    for (const cli of boundary.npmCliPaths) {
      const available = await execute(process.execPath, [cli, '--version'], { env: boundary.environment, timeout: 5000 });
      assert.match(available.stdout.trim(), /^\d+\.\d+\.\d+/u, 'The direct npm CLI control must exist and execute outside isolation');
      await assert.rejects(boundary.execute(process.execPath, [cli, '--version']), error =>
        error.code !== 0 && /EPERM|EACCES|ENOENT|Cannot find module|permission denied/iu.test(error.stderr),
      'Direct npm CLI execution must fail even without PATH lookup');
    }
    await assert.rejects(boundary.execute('/bin/sh', ['-c', 'command -v npm']), { code: 1 });
    assert.ok(!Object.keys(boundary.environment).some(key => /^(npm_|node_options$|node_path$)/iu.test(key)));
    return { adapter: boundary.name, httpDenied: true, httpsDenied: true, directNpmDenied: true };
  } finally {
    await Promise.all(servers.map(server => server.listening ?
      new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) : Promise.resolve()));
  }
}
