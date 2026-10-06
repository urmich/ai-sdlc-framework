import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyToolArguments } from '../src/tool-arguments.mjs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../src/artifacts.mjs';
import { classifyTool, evaluateGate } from '../src/gate.mjs';
import { prepareOperation, markDispatching } from '../src/operations.mjs';
import { fixture, coding } from './helpers.mjs';

const action = { class: 'deploy', environment: 'DEV',
  target: 'slot-a', artifactId: 'artifact-1' };
const legacy = { toolName: 'fixture_deploy',
  match: { slot: 'slot-a', input: { artifact: 'artifact-1',
    flags: ['safe', 'fixed'] } }, action };
const argumentsContract = { toolName: 'fixture_deploy',
  arguments: {
    slot: { required: true, type: 'string', actionField: 'target' },
    artifact: { required: true, type: 'string', actionField: 'artifactId' },
    options: { type: 'object', actionField: 'toolOptions', properties: {
      mode: { required: true, value: 'safe' },
      labels: { type: 'array', items: { type: 'string' } },
    } },
    force: { value: false, actionField: 'force' },
  },
  action: { class: 'deploy', environment: 'DEV' },
};
const classify = (args, adapters = [argumentsContract], opts = {}) =>
  classifyToolArguments('fixture_deploy', args, adapters,
    { repositoryId: 'primary', ...opts });

test('T-109 legacy match is exact over the entire nested argument object', () => {
  const args = structuredClone(legacy.match);
  const original = classify(args, [legacy]);
  assert.equal(original.status, 'matched');
  assert.deepEqual(original.action, { ...action, repositoryId: 'primary' });
  for (const mutation of [
    { ...args, extra: 1 }, { slot: args.slot },
    { ...args, input: { ...args.input, flags: ['fixed', 'safe'] } },
    { ...args, input: { ...args.input, artifact: 'artifact-2' } },
    { ...args, input: { ...args.input, unused: true } },
  ]) assert.equal(classify(mutation, [legacy]).status, 'unmanaged');
});

test('T-109 declared required and optional arguments are exhaustive', () => {
  const required = { slot: 'slot-a', artifact: 'artifact-1' };
  const matched = classify(required);
  assert.equal(matched.status, 'matched');
  assert.deepEqual(matched.action, { ...argumentsContract.action,
    target: required.slot, artifactId: required.artifact,
    repositoryId: 'primary' });
  for (const missing of [{ slot: 'slot-a' }, { artifact: 'artifact-1' },
    { ...required, unexpected: true }, { ...required, artifact: 17 },
    { ...required, slot: null }, { ...required, slot: 'slot-a',
      options: { mode: 'safe', labels: [17] } },
    { ...required, options: { mode: 'safe', labels: ['ok'],
      extra: true } }]) {
    assert.equal(classify(missing).status, 'unmanaged');
  }
  assert.equal(classify({ ...required, force: false }).status, 'matched');
  assert.equal(classify({ ...required, force: true }).status, 'unmanaged');
});

test('T-109 mutations of every variable accepted argument alter action and call identity', () => {
  const initial = { slot: 'slot-a', artifact: 'artifact-1' };
  const changed = [
    { ...initial, slot: 'slot-b' },
    { ...initial, artifact: 'artifact-2' },
    { ...initial, options: { mode: 'safe', labels: ['A'] } },
    { ...initial, options: { mode: 'safe', labels: ['B'] } },
  ];
  for (const args of changed) {
    const a = classify(initial), b = classify(args);
    assert.equal(b.status, 'matched');
    assert.notDeepEqual(b.action, a.action);
    assert.notEqual(b.actionDigest, a.actionDigest);
    assert.notEqual(b.argumentDigest, a.argumentDigest);
  }
});

test('T-109 differing matches conflict in either order, including different meaning', () => {
  const args = { slot: 'slot-a', artifact: 'artifact-1' };
  const override = { ...argumentsContract,
    action: { ...argumentsContract.action, class: 'read' } };
  for (const adapters of [[argumentsContract, override],
    [override, argumentsContract]]) {
    const conflict = classify(args, adapters);
    assert.equal(conflict.status, 'conflict');
    assert.equal(conflict.reason, 'adapters-disagree');
    assert.equal(conflict.matches.length, 2);
    assert.notEqual(conflict.matches[0].actionDigest,
      conflict.matches[1].actionDigest);
  }
  const differentMapping = structuredClone(argumentsContract);
  differentMapping.arguments.slot.actionField = 'pipeline';
  for (const adapters of [[argumentsContract, differentMapping],
    [differentMapping, argumentsContract]]) {
    assert.equal(classify(args, adapters).status, 'conflict');
  }
  const identical = classify(args, [argumentsContract, argumentsContract]);
  assert.equal(identical.status, 'matched');
});

test('T-109 shell and independently recognized actions cannot be disguised', () => {
  const args = { slot: 'slot-a', artifact: 'artifact-1' };
  assert.deepEqual(classifyToolArguments('powershell',
    { command: 'git push origin main' }, [{
      toolName: 'powershell', match: { command: 'git push origin main' },
      action: { class: 'read' },
    }]), { status: 'unmanaged',
    reason: 'shell-requires-command-classification' });
    assert.deepEqual(classifyToolArguments('functions.powershell',
      { command: 'git push origin main' }, [{
        toolName: 'functions.powershell', match: { command: 'git push origin main' },
        action: { class: 'read' },
      }]), { status: 'unmanaged',
      reason: 'shell-requires-command-classification' });
  const protectedConflict = classify(args, [argumentsContract], {
    protectedAction: { class: 'read', repositoryId: 'primary' },
  });
  assert.equal(protectedConflict.status, 'conflict');
  assert.equal(protectedConflict.reason, 'adapter-relabels-protected-action');
  assert.equal(protectedConflict.matches.length, 1);
});

test('T-109 malformed configuration and invalid action mapping cannot classify', () => {
  const args = { slot: 'slot-a', artifact: 'artifact-1' };
  const invalid = [
    { ...argumentsContract, arguments: { slot: {
      type: 'string' } } },
    { ...argumentsContract, arguments: { slot: {
      type: 'string', actionField: 'class' } } },
    { ...argumentsContract, arguments: { slot: {
      type: 'object', actionField: 'target' } } },
    { ...argumentsContract, arguments: { slot: {
      type: 'string', value: 'fixed', actionField: 'target' } } },
    { ...argumentsContract, match: args },
  ];
  for (const adapter of invalid) assert.throws(() =>
    classify(args, [adapter]), error => error.code === 'CONFIG');
  assert.equal(classify('{"slot":"slot-a"}').status, 'unmanaged');
  assert.equal(classify({ slot: 'slot-a', artifact: 'artifact-1',
    options: { mode: 'safe', labels: [undefined] } }).status, 'unmanaged');
});

test('T-109 configured adapters classify only complete direct calls and expose conflicts', async t => {
  const f = await fixture(t);
  const state = await f.store.load(f.workItemId);
  const member = state.metadata.members[0];
  const file = path.join(f.repo, '.sdlc', 'config.json');
  const config = { toolAdapters: [{
    toolName: 'fixture_deploy',
    match: { destination: 'DEV', options: { dryRun: false } },
    action: { class: 'deploy', environment: 'DEV', target: 'dev-target' },
  }] };
  await fs.writeFile(file, JSON.stringify(config));
  const loaded = await loadConfig(state.metadata, member.repositoryId);
  const classify = toolArgs => classifyTool(f.store, {
    toolName: 'fixture_deploy', toolArgs, cwd: f.repo,
  }, state, member, loaded);
  assert.deepEqual(await classify({
    destination: 'DEV', options: { dryRun: false },
  }), [{ ...config.toolAdapters[0].action, repositoryId: member.repositoryId }]);
  assert.deepEqual(await classify({
    destination: 'DEV', options: { dryRun: false }, force: true,
  }), [{ class: 'unknown', repositoryId: member.repositoryId }]);
  loaded.toolAdapters.push({ ...config.toolAdapters[0],
    action: { class: 'read' } });
  await assert.rejects(classify({
    destination: 'DEV', options: { dryRun: false },
  }), { code: 'CONFLICT' });
  await fs.writeFile(file, JSON.stringify({
    toolAdapters: [{ toolName: 'fixture_deploy',
      arguments: { destination: { type: 'string' } },
      action: { class: 'deploy' } }],
  }));
  await assert.rejects(loadConfig(state.metadata, member.repositoryId),
    { code: 'CONFIG' });
});

test('T-109 the gate rejects a prepared PR ID different from the actual tool argument', async t => {
  const f = await coding(await fixture(t));
  await fs.writeFile(path.join(f.repo, '.sdlc', 'config.json'),
    JSON.stringify({ toolAdapters: [{
      toolName: 'fixture_pr_command',
      arguments: { prId: { required: true, type: 'string',
        actionField: 'prId' } },
      action: { class: 'code' },
    }] }));
  const request = { toolName: 'fixture_pr_command',
    toolArgs: { prId: 'PR-18' }, cwd: f.repo };
  const { operation } = await prepareOperation(f.store, {
    workItemId: f.workItemId, sessionId: f.sessionId,
    action: { class: 'code', repositoryId: 'primary', prId: 'PR-17' },
    request, correlationKey: 'wrong-pr-id',
    intent: 'Reject a differently targeted tool call',
  });
  await markDispatching(f.store, f.workItemId, operation.id);
  const gate = await evaluateGate(f.store, {
    ...request, sessionId: f.sessionId,
  });
  assert.equal(gate.permissionDecision, 'deny');
  assert.match(gate.permissionDecisionReason, /Prepared prId differs/u);
});
