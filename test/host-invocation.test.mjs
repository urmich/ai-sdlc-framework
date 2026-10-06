import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  prepareHostInvocation, matchHostInvocation,
} from '../src/host-invocations.mjs';

const contract = Object.freeze({
  adapterId: 'fixture-supported-host',
  propagatesUniqueCallId: true,
  dispatchIdField: 'dispatch.callId',
  resultIdField: 'result.callId',
});
const request = cwd => ({
  sessionId: 'session-1', toolName: 'functions.powershell',
  toolArgs: { command: 'Write-Output "hello"', description: 'fake' },
  cwd, shell: 'powershell',
});

test('T-108 canonical cwd, normalized tool and all tool arguments bind an invocation without raw args', async t => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'sdlc-host-invocation-'));
  t.after(async () => { await fs.rm(cwd, { recursive: true }); });
  const invocation = await prepareHostInvocation({
    ...request(cwd), hostCallId: 'call-1',
  }, { adapterContract: contract });
  assert.match(invocation.hostCallIdDigest, /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(invocation).includes('call-1'), false);
  assert.equal(invocation.toolName, 'powershell');
  assert.match(invocation.cwdDigest, /^[a-f0-9]{64}$/u);
  assert.match(invocation.sessionDigest, /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(invocation).includes(await fs.realpath(cwd)), false);
  assert.equal(JSON.stringify(invocation).includes('session-1'), false);
  assert.equal(JSON.stringify(invocation).includes('Write-Output'), false);
  assert.equal(JSON.stringify(invocation).includes('fake'), false);
  const sensitive = await prepareHostInvocation({
    ...request(cwd),
    toolArgs: { ...request(cwd).toolArgs, token: 'fixture-secret-value' },
    hostCallId: 'call-1',
  }, { adapterContract: contract });
  assert.notEqual(sensitive.fingerprint, invocation.fingerprint);
  assert.equal(JSON.stringify(sensitive).includes('fixture-secret-value'), false);
  const equivalent = await matchHostInvocation(invocation, {
    ...request(path.join(cwd, 'folder', '..')),
    toolName: 'pwsh',
    toolArgs: JSON.stringify({ description: 'fake', command: 'Write-Output "hello"' }),
    hostCallId: 'call-1',
  }, { adapterContract: contract });
  assert.equal(equivalent.status, 'matched');
  assert.match(equivalent.bindingDigest, /^[a-f0-9]{64}$/u);
  for (const changed of [
    { sessionId: 'session-2' },
    { toolName: 'cmd', shell: 'cmd' },
    { toolArgs: { ...request(cwd).toolArgs, description: 'changed' } },
    { toolArgs: { ...request(cwd).toolArgs, optional: true } },
    { cwd: path.dirname(cwd) },
    { shell: 'cmd' },
    { hostCallId: 'call-2' },
  ]) {
    const candidate = { ...request(cwd), hostCallId: 'call-1', ...changed };
    if (changed.shell === 'cmd' && changed.toolName === undefined) {
      await assert.rejects(matchHostInvocation(invocation, candidate, {
        adapterContract: contract,
      }), { code: 'INPUT' });
    } else {
      assert.equal((await matchHostInvocation(invocation, candidate, {
        adapterContract: contract,
      })).status, 'mismatch');
    }
  }
});

test('T-108 unproven or locally supplied IDs do not correlate identical callbacks', async t => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'sdlc-no-host-id-'));
  t.after(async () => { await fs.rm(cwd, { recursive: true }); });
  const initial = request(cwd);
  const unsupported = await prepareHostInvocation({
    ...initial, hostCallId: 'payload-id',
  });
  assert.equal(unsupported.hostCallIdDigest, undefined);
  assert.deepEqual(await matchHostInvocation(unsupported, {
    ...initial, hostCallId: 'payload-id',
  }), { status: 'uncertain', reason: 'host-call-id-unproven' });
  const locallyClaimed = await prepareHostInvocation({
    ...initial, hostCallId: 'generated-only',
  }, { adapterContract: { adapterId: 'fixture', propagatesUniqueCallId: false } });
  assert.equal(locallyClaimed.hostCallIdDigest, undefined);
  const proven = await prepareHostInvocation({
    ...initial, hostCallId: 'host-id',
  }, { adapterContract: contract });
  assert.deepEqual(await matchHostInvocation(proven, initial, {
    adapterContract: contract,
  }), { status: 'uncertain', reason: 'host-call-id-unproven' });
  assert.equal((await matchHostInvocation(proven, {
    ...initial, hostCallId: 'host-id',
  })).status, 'uncertain');
  assert.deepEqual(await matchHostInvocation(proven, {
    ...initial, hostCallId: 'host-id',
  }, { adapterContract: { ...contract, resultIdField: 'other.result.callId' } }),
  { status: 'mismatch', reason: 'different-host-adapter-contract' });
  assert.equal((await matchHostInvocation(proven, {
    ...initial, sessionId: 'other',
  })).status, 'mismatch');
});

test('T-108 a delayed earlier callback cannot complete a newer identical call', async t => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'sdlc-delayed-host-'));
  t.after(async () => { await fs.rm(cwd, { recursive: true }); });
  const initial = request(cwd);
  const oldInvocation = await prepareHostInvocation({
    ...initial, hostCallId: 'host-old',
  }, { adapterContract: contract });
  const newInvocation = await prepareHostInvocation({
    ...initial, hostCallId: 'host-new',
  }, { adapterContract: contract });
  let release;
  const delayedCallback = new Promise(resolve => { release = resolve; });
  const older = delayedCallback.then(() => matchHostInvocation(newInvocation, {
    ...initial, hostCallId: 'host-old',
  }, { adapterContract: contract }));
  const newer = await matchHostInvocation(newInvocation, {
    ...initial, hostCallId: 'host-new',
  }, { adapterContract: contract });
  assert.equal(newer.status, 'matched');
  assert.deepEqual(newer, await matchHostInvocation(newInvocation, {
    ...initial, hostCallId: 'host-new',
  }, { adapterContract: contract }));
  release();
  assert.deepEqual(await older, { status: 'mismatch', reason: 'different-host-call-id' });
  assert.equal((await matchHostInvocation(oldInvocation, {
    ...initial, hostCallId: 'host-old',
  }, { adapterContract: contract })).status, 'matched');
});
