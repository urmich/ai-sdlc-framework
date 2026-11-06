export const validationDeclarations = {
  "schemaVersion": 1,
  "surfaces": [{"coverage": "direct", "paths": ["src/install-progress.mjs"]}]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { install, doctor } from '../src/install.mjs';
import { Store } from '../src/store.mjs';
import { installPhase, observeInstallOperation } from '../src/install-progress.mjs';
import { processDiagnostic } from '../scripts/validation-tools.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const marker = /^sdlc-install-v1 trace=([a-f0-9-]+) pid=(\d+) ppid=(\d+) seq=(\d+) wall=(\d+) mono=([\d.]+) cpu_user=(\d+) cpu_system=(\d+) phase=([a-z-]+) event=(begin|end|progress) count=(\d+) elapsed_us=(\d+)$/u;

async function fixture(t) {
  const root = path.join(repositoryRoot, '.test-data', `install-progress-${randomUUID()}`);
  await fs.mkdir(root, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, maxRetries: 10, retryDelay: 100 }));
  return { root, home: path.join(root, 'home') };
}

function tracing(t) {
  const previous = process.env.SDLC_INSTALL_TRACE_ID;
  process.env.SDLC_INSTALL_TRACE_ID = randomUUID();
  t.after(() => {
    if (previous === undefined) delete process.env.SDLC_INSTALL_TRACE_ID;
    else process.env.SDLC_INSTALL_TRACE_ID = previous;
    syncBuiltinESMExports();
  });
}

test('install progress traces real install and purge phases without changing stdout or exposing owned contents', async t => {
  const f = await fixture(t);
  const program = path.join(f.root, 'probe.mjs');
  await fs.writeFile(program, `
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Store } from ${JSON.stringify(new URL('../src/store.mjs', import.meta.url).href)};
import { install, cleanInstall, doctor } from ${JSON.stringify(new URL('../src/install.mjs', import.meta.url).href)};
const store = new Store(process.argv[2]);
const traceIds = [process.env.SDLC_INSTALL_TRACE_ID];
await install(store);
await fs.writeFile(store.runtime + '/private-fixture.json', 'owned-private-value');
process.env.SDLC_INSTALL_TRACE_ID = randomUUID();
traceIds.push(process.env.SDLC_INSTALL_TRACE_ID);
const replacement = await cleanInstall(store);
delete process.env.SDLC_INSTALL_TRACE_ID;
const health = await doctor(store);
console.log(JSON.stringify({ installed: health.installed, purged: replacement.purgedExisting,
  findings: health.findings, traceIds }));
`);
  const output = await promisify(execFile)(process.execPath, [program, f.home],
    { cwd: repositoryRoot, env: { ...process.env, SDLC_INSTALL_TRACE_ID: randomUUID() },
      maxBuffer: 1024 * 1024 }).catch(error => {
    if (!Number.isInteger(error.code)) throw error;
    const primary = error.stderr.split(/\r?\n/u)
      .find(line => /^\w*Error(?: \[[A-Z0-9_]+\])?:/u.test(line)) ?? 'Child probe failed';
    const identity = value => ({ sha256: createHash('sha256').update(value).digest('hex'),
      bytes: Buffer.byteLength(value) });
    assert.fail(JSON.stringify({ exitCode: error.code, signal: error.signal,
      primary: processDiagnostic(primary), stdout: identity(error.stdout), stderr: identity(error.stderr) }));
  });
  const result = JSON.parse(output.stdout);
  assert.equal(result.installed, true);
  assert.equal(result.purged, true);
  assert.deepEqual(result.findings, []);
  const lines = output.stderr.trim().split(/\r?\n/u);
  const events = lines.map(line => {
    const match = marker.exec(line);
    assert.ok(match, line);
    return { trace: match[1], phase: match[9], event: match[10], count: Number(match[11]) };
  });
  for (const trace of result.traceIds) {
    assert.ok(events.some(row => row.trace === trace && row.phase === 'manifest' && row.event === 'end'));
    assert.ok(events.some(row => row.trace === trace && row.phase === 'file-flush' && row.count > 0));
  }
  for (const phase of ['distribution', 'documentation', 'replacement-preflight', 'replacement-writes',
    'purge-lock', 'purge-preflight', 'purge-remove', 'lock-release']) {
    assert.ok(events.some(row => row.phase === phase), phase);
  }
  assert.ok(lines.length <= 512);
  assert.ok(!output.stderr.includes(f.home));
  assert.ok(!output.stderr.includes('owned-private-value'));
});

test('install progress stream failures preserve the primary installer failure after rollback', async t => {
  const f = await fixture(t);
  tracing(t);
  const write = t.mock.method(fsSync, 'writeSync', () => {
    throw Object.assign(new Error('Controlled diagnostic sink failure'), { code: 'EPIPE' });
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(install(new Store(f.home), {
      fault: async () => { throw new Error('Owned primary installer failure'); },
    }), error => {
      assert.equal(error.code, 'INSTALL_FAILED');
      assert.match(error.message, /Owned primary installer failure/u);
      assert.equal(error.details.installTraceFailure.code, 'EPIPE');
      return true;
    });
  } finally {
    write.mock.restore();
    syncBuiltinESMExports();
  }
});

test('install progress stream failures cannot roll back an otherwise settled installation', async t => {
  const f = await fixture(t);
  tracing(t);
  const write = t.mock.method(fsSync, 'writeSync', () => {
    throw Object.assign(new Error('Controlled diagnostic sink failure'), { code: 'EPIPE' });
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(install(new Store(f.home)), { code: 'INSTALL_TRACE_FAILED' });
  } finally {
    write.mock.restore();
    syncBuiltinESMExports();
  }
  delete process.env.SDLC_INSTALL_TRACE_ID;
  const health = await doctor(new Store(f.home));
  assert.equal(health.installed, true);
  assert.deepEqual(health.findings, []);
});

test('install progress caps diagnostic records and visibly marks truncation', async t => {
  tracing(t);
  const lines = [];
  const write = t.mock.method(fsSync, 'writeSync', (_fd, value) => {
    lines.push(value);
    return Buffer.byteLength(value);
  });
  syncBuiltinESMExports();
  try {
    await observeInstallOperation(async () => {
      for (let count = 0; count < 1000; count++) installPhase('replacement-writes', 'progress', count);
    });
  } finally {
    write.mock.restore();
    syncBuiltinESMExports();
  }
  assert.equal(lines.length, 256);
  assert.match(lines.at(-1), /phase=trace-limit event=progress/u);
});
