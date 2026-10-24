import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { acquireTestWorker, readTestGroupProcesses } from '../scripts/test-budget.mjs';
import { processDiagnostic } from '../scripts/validation-tools.mjs';
import { protocolPairs, runProtocolRow } from './readiness-protocol-row.mjs';
import { protocolPoolIdentity } from './readiness-protocol-pool.mjs';

const [indexText, sourceDigest, scratch, groupId, pairText] = process.argv.slice(2);
const index = Number(indexText);
const pair = JSON.parse(pairText);
assert.ok(Number.isInteger(index) && index >= 0 && index < protocolPairs.length);
assert.deepEqual(pair, protocolPairs[index]);
assert.match(sourceDigest, /^[a-f0-9]{64}$/u);
assert.equal((await protocolPoolIdentity(protocolPairs)).sourceDigest, sourceDigest);
const allocation = await acquireTestWorker(1, { groupId });
const hooks = [];
const cleanupFailures = [];
let primary;
let row;
try {
  row = await runProtocolRow({ after: hook => hooks.push(hook), fixtureParent: scratch }, pair);
} catch (error) { primary = error; }
for (const hook of hooks.reverse()) {
  try { await hook(); } catch (error) {
    primary ??= error;
    cleanupFailures.push(processDiagnostic(error));
  }
}
try {
  if (primary) throw primary;
  assert.deepEqual(await fs.readdir(scratch), []);
  const processes = await readTestGroupProcesses(groupId);
  assert.equal(processes.length, 1);
  assert.equal(processes[0].pid, process.pid);
  assert.equal(processes[0].slot, allocation.slot);
  console.log(JSON.stringify({ index, pair, sourceDigest, groupId, status: 'Passed', cleaned: true,
    pid: process.pid, slot: allocation.slot, lease: processes[0],
    finishedAt: new Date().toISOString(), ...row }));
} catch (error) {
  console.error(JSON.stringify({ ...processDiagnostic(error), cleanupFailures }));
  process.exitCode = 1;
} finally { allocation.close(); }
