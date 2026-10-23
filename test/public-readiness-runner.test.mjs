export const validationDeclarations = {
  "schemaVersion": 1,
  "surfaces": [
    {"coverage": "process", "paths": ["scripts/test-profiles.mjs", "scripts/test-budget-worker.mjs"]},
    {"coverage": "direct", "paths": ["scripts/test-scheduling.mjs", "scripts/test-budget.mjs", "scripts/test-local-evidence.mjs", "scripts/validation-benchmark.mjs"]}
  ],
  "groups": [{
    "root": "T-PRD010-CATALOG catalog third root overlaps a live four-slot retained guard within seven shared slots",
    "minimumSlots": 7
  }],
  "applicability": [{
    "names": [
      "T-PRD010 independent file workers overlap without sharing environment, module patches or fixture ownership",
      "T-PRD010 nested producers retain one aggregate budget, queued work and ordered real file outcomes",
      "T-PRD010 benchmark completes same-file root measurements under the actual shared budget",
      "T-PRD010 same-file roots overlap in isolated processes while ordered children and hooks remain causal",
      "T-PRD011 sibling producers dynamically consume freed aggregate capacity without token multiplication"
    ],
    "platforms": ["linux-x64", "windows-x64", "macos-arm64", "macos-x64"],
    "owner": "runner-resource-contract",
    "reason": "Real overlap requires two aggregate host slots; an undersized allocation remains NotRun.",
    "prerequisites": ["Aggregate test-worker capacity of at least two"]
  }],
  "resources": {
    "workers": 2,
    "names": [
      "T-PRD010 independent file workers overlap without sharing environment, module patches or fixture ownership",
      "T-PRD010 nested producers retain one aggregate budget, queued work and ordered real file outcomes",
      "T-PRD010 benchmark completes same-file root measurements under the actual shared budget",
      "T-PRD010 same-file roots overlap in isolated processes while ordered children and hooks remain causal",
      "T-PRD011 sibling producers dynamically consume freed aggregate capacity without token multiplication"
    ],
    "owner": "runner-resource-contract",
    "reason": "Reserve two host slots before these callbacks so nested overlap deadlines do not begin while capacity is unavailable."
  },
  "plannedCases": [
    {"id": "T-PRD011", "selectors": [
      {"name": "T-PRD010 independent file workers overlap without sharing environment, module patches or fixture ownership", "parents": []}
    ]}
  ]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { criticalSelectors, criticalSelection, criticalProfileBudget, exactPattern, excludingPattern } from '../scripts/test-profiles.mjs';
import { createPlan, parseOptions, repositoryRoot, unitFiles } from '../scripts/test-runner.mjs';
import { compileValidationInventory, discoverDeclarations } from '../scripts/validation-inventory.mjs';
import { digest, SdlcError } from '../src/core.mjs';
import { captureBenchmarkCache, compareValidationBenchmarks, runValidationBenchmark } from '../scripts/validation-benchmark.mjs';
import { hostedValidationSelection, scheduleValidationFiles, validationExecutionGroups,
  runValidationReadyPool, validationSchedulingPolicyDigest, sourceValidationSchedulingPolicy,
  validationSchedulingPolicy } from '../scripts/test-scheduling.mjs';
import { acquireTestWorker, enterTestBudget, readTestBudget } from '../scripts/test-budget.mjs';
import { readEvidenceBundle } from '../src/evidence.mjs';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { deriveLocalSanitySpecification, localEvidenceFailureDiagnostic } from '../scripts/test-local-evidence.mjs';
import { processDiagnostic, executeValidationCommand } from '../scripts/validation-tools.mjs';
import { windowsProcessIdentity, assertOwnedProcessExited } from './owned-process-fixture.mjs';
import net from 'node:net';
import { getEventListeners } from 'node:events';

const execute = promisify(execFile);
const requiredCriticalSelectors = [
  ['test/storage.test.mjs', 'T-16 canonical data, atomic replacement, and deterministic write-boundary failures preserve old/new state'],
  ['test/storage.test.mjs', 'T-16 old live locks are never stolen; concurrent revision updates serialize'],
  ['test/storage.test.mjs', 'T-19 bindings resolve linked worktrees and refuse stale branch authority'],
  ['test/storage.test.mjs', 'T-23 symlink escapes and unsafe identifiers are rejected'],
  ['test/advisory-gate.test.mjs', 'T-41 command-hook launcher fails open for malformed input and import failure'],
  ['test/advisory-gate.test.mjs', 'T-41 unmanaged tool execution invalidates stale candidate evidence when files changed'],
  ['test/cli-install.test.mjs', 'T-23 install/update/uninstall preserve user files, paths with spaces, modified assets and runtime'],
  ['test/cli-install.test.mjs', 'T-23 partial installation rolls back only its own unchanged writes'],
  ['test/current-evidence.test.mjs', 'publication consent for hosted URL A cannot authorize URL B from the same checkout'],
  ['test/test-runner.test.mjs', 'T-130 public runner preserves a real failing child and still executes the passing sibling'],
  ['test/test-runner.test.mjs', 'T-GHB24 native execution evidence distinguishes passing, failing and skipped assertions without overwriting reports'],
];

async function inspectionBroker(t) {
  const connections = [];
  const requests = [];
  const waiters = [];
  const server = net.createServer(socket => {
    const connection = { socket, closed: new Promise(resolve => socket.once('close', resolve)) };
    connections.push(connection);
    socket.on('error', () => {});
    let buffer = '';
    socket.on('data', bytes => {
      buffer += bytes;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const request = { ...connection, request: JSON.parse(buffer.slice(0, newline)) };
      buffer = buffer.slice(newline + 1);
      const waiting = waiters.shift();
      if (waiting) waiting(request);
      else requests.push(request);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const inherited = process.env.SDLC_TEST_BUDGET;
  process.env.SDLC_TEST_BUDGET = JSON.stringify({ version: 2, host: '127.0.0.1',
    port: server.address().port, id: randomUUID(), key: 'a'.repeat(64) });
  t.after(async () => {
    if (inherited === undefined) delete process.env.SDLC_TEST_BUDGET;
    else process.env.SDLC_TEST_BUDGET = inherited;
    for (const { socket } of connections) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  return { connections, next: () => requests.length ? Promise.resolve(requests.shift()) :
    new Promise(resolve => waiters.push(resolve)) };
}

test('T-PRD010 budget inspection rejects a pre-connect abort without creating a socket and preserves ordinary snapshots',
  { timeout: 5000 }, async t => {
    const broker = await inspectionBroker(t);
    const cancellation = new AbortController();
    cancellation.abort();
    await assert.rejects(readTestBudget({ signal: cancellation.signal }), { code: 'BUDGET' });
    assert.equal(broker.connections.length, 0);
    assert.equal(getEventListeners(cancellation.signal, 'abort').length, 0);
    const pending = readTestBudget();
    const owned = await broker.next();
    const response = { request: owned.request.request, capacity: 3, activeWorkers: 1,
      residentWorkers: 2, producers: 1 };
    owned.socket.write(`${JSON.stringify(response)}\n`);
    assert.deepEqual(await pending, response);
    await owned.closed;
    assert.equal(broker.connections.length, 1);
  });

test('T-PRD010 in-flight budget inspection abort drains only its owned socket and leaves a sibling request intact',
  { timeout: 5000 }, async t => {
    const broker = await inspectionBroker(t);
    const cancellation = new AbortController();
    const pending = readTestBudget({ signal: cancellation.signal });
    const rejected = assert.rejects(pending, { code: 'BUDGET' });
    const owned = await broker.next();
    const siblingPending = readTestBudget();
    const sibling = await broker.next();
    cancellation.abort();
    await rejected;
    await owned.closed;
    assert.equal(owned.socket.destroyed, true);
    assert.equal(sibling.socket.destroyed, false);
    assert.equal(getEventListeners(cancellation.signal, 'abort').length, 0);
    sibling.socket.write(`${JSON.stringify({ request: sibling.request.request, capacity: 2 })}\n`);
    assert.equal((await siblingPending).capacity, 2);
    await sibling.closed;
  });

test('T-PRD008 equivalent benchmark fixtures require actual origin, original assertions and matching execution conditions', () => {
  const message = 'Only a known execution attempt has an attempt reference';
  const cause = localEvidenceFailureDiagnostic(new SdlcError('INPUT', message));
  assert.equal(cause.code, 'INPUT');
  assert.equal(cause.message, message);
  assert.equal(cause.truncated, false);
  const sensitive = 'synthetic-local-cause-value';
  const redacted = localEvidenceFailureDiagnostic(new SdlcError('INPUT', `accessToken="${sensitive}"`));
  assert.equal(JSON.stringify(redacted).includes(sensitive), false);
  const bounded = localEvidenceFailureDiagnostic(new SdlcError('INPUT', 'x'.repeat(2000)));
  assert.ok(bounded.message.length <= 1000);
  assert.equal(bounded.truncated, true);
  const opaque = localEvidenceFailureDiagnostic(new SdlcError('INPUT', '\u0000'));
  assert.equal(opaque.code, 'LOCAL_EVIDENCE_CAUSE_REJECTED');
  assert.equal(opaque.sanitizationCode, 'UNSAFE');
  const originalAssertionIds = ['assertion-original'];
  const makeVersion = (version, wallMs) => ({
    sourceDigest: digest(version), measurements: ['full', 'focused'].flatMap(scope => [1, 2].map(repeat => {
      const assertions = [{ id: originalAssertionIds[0], definitionDigest: digest('unchanged assertion body'),
        applicabilityDigest: digest('same native assignment'), resourceWorkers: 1,
        applicable: true, platforms: ['windows-x64'], status: 'Passed' }];
      const time = Date.parse('2026-10-19T00:00:00.000Z') +
        ((scope === 'full' ? 0 : 2) + repeat - 1) * 4000 + (version === 'candidate' ? 2000 : 0);
      return { scope, repeat, cache: repeat === 1 ? 'cold' : 'warm',
        startedAt: new Date(time).toISOString(), finishedAt: new Date(time + wallMs).toISOString(),
        cacheEvidence: { files: repeat === 1 ? 0 : 1, digest: repeat === 1 ? digest([]) : digest('cache state'),
          seededFrom: repeat === 1 ? null : digest(`${version}:${scope}:1`) },
        sourceDigest: digest(version), reportDigest: digest(`${version}:${scope}:${repeat}`),
        testSpecDigest: digest('same selected definitions'), configurationDigest: digest({ scope, repeat }),
        inventoryDigest: digest(originalAssertionIds), assertions, assertionsDigest: digest(assertions),
        complete: true, exitCode: 0, wallMs, workers: 2, unexpectedSkips: [],
        counts: { required: 1, passed: 1, failed: 0, skipped: 0, cancelled: 0 },
        native: { platform: 'win32', architecture: 'x64', image: 'fixture-image' },
        toolchain: { node: 'fixture-runtime', executable: 'fixture-executable' },
        resources: { capacity: 2, availableParallelism: 4, totalMemoryBytes: 8 * 1024 ** 3 },
        environmentPolicyDigest: digest({ scope, isolated: true }) };
    })),
  });
  const input = { baseline: makeVersion('baseline', 200), candidate: makeVersion('candidate', 150),
    originalAssertionIds, focusedAssertionIds: originalAssertionIds, addedAssertionIds: ['new-contract-only'] };
  const compare = value => {
    const trusted = new Map(Object.entries({ baseline: value.baseline, candidate: value.candidate })
      .flatMap(([version, input]) => input.measurements.filter(Boolean).map(measurement =>
        [`${version}:${measurement.reportDigest}`, { measurementDigest: digest(measurement) }])));
    return compareValidationBenchmarks(value, ({ version, measurement }) =>
      trusted.get(`${version}:${measurement.reportDigest}`));
  };
  const complete = compare(input);
  assert.equal(complete.status, 'Passed');
  assert.equal(complete.comparisons.length, 4);
  assert.ok(complete.comparisons.every(value => value.ratio === 0.75));
  assert.deepEqual(complete.addedAssertionIds, ['new-contract-only']);
  assert.equal(compareValidationBenchmarks(JSON.parse(JSON.stringify(input))).status, 'NotRun',
    'Serialized passing fields cannot manufacture an origin verifier');
  for (const mutate of [
    value => { value.candidate.measurements.pop(); },
    value => { value.candidate.measurements[3] = structuredClone(value.candidate.measurements[0]); },
    value => { value.candidate.measurements[0].workers = 1; },
    value => { value.candidate.measurements[0].resources.capacity = 4; },
    value => { value.candidate.measurements[0].native.architecture = 'other'; },
    value => { value.candidate.measurements[0].toolchain.node = 'other-runtime'; },
    value => { value.candidate.measurements[0].environmentPolicyDigest = digest('different environment'); },
    value => { value.candidate.measurements[0].cache = 'warm'; },
    value => { value.candidate.measurements[0].cacheEvidence.files = 1; },
    value => { value.candidate.measurements[1].cacheEvidence.seededFrom = digest('foreign cold measurement'); },
    value => { value.candidate.measurements[0].startedAt = value.baseline.measurements[0].startedAt; },
    value => { value.candidate.measurements[0].complete = false; },
    value => { value.candidate.measurements[0].assertions = []; },
    value => { value.candidate.measurements[0].assertions[0].definitionDigest = digest('changed assertion'); },
    value => { value.candidate.measurements[0].assertions[0].applicabilityDigest = digest('waived native assignment'); },
    value => { value.candidate.measurements[0].assertions[0].resourceWorkers = 2; },
    value => { value.candidate.measurements[0].assertions[0].status = 'Skipped'; },
    value => { value.candidate.measurements[0].assertions.push(structuredClone(value.candidate.measurements[0].assertions[0])); },
    value => { delete value.candidate.measurements[0].environmentPolicyDigest; },
  ]) {
    const changed = structuredClone(input);
    mutate(changed);
    for (const measurement of changed.candidate.measurements) if (Array.isArray(measurement?.assertions)) {
      measurement.assertionsDigest = digest(measurement.assertions);
    }
    const result = compare(changed);
    assert.equal(result.status, 'NotRun');
    assert.deepEqual(result.comparisons, [], 'Non-equivalent inputs never produce a speedup ratio');
  }
  const failed = structuredClone(input);
  Object.assign(failed.candidate.measurements[0], { exitCode: 1,
    counts: { required: 1, passed: 0, failed: 1, skipped: 0, cancelled: 0 } });
  failed.candidate.measurements[0].assertions[0].status = 'Failed';
  failed.candidate.measurements[0].assertionsDigest = digest(failed.candidate.measurements[0].assertions);
  assert.equal(compare(failed).status, 'Failed');
  assert.deepEqual(compare(failed).comparisons, []);
});

test('T-PRD008 benchmark cache observations distinguish empty cold roots and changed warm bytes', async t => {
  const root = path.join(repositoryRoot, '.test-data', `benchmark-cache-${randomUUID()}`);
  await fs.mkdir(path.join(root, 'nested'), { recursive: true });
  t.after(() => fs.rm(root, { recursive: true }));
  const cold = await captureBenchmarkCache(root);
  assert.deepEqual(cold, { files: 0, digest: digest([]) });
  const file = path.join(root, 'nested', 'producer-cache');
  await fs.writeFile(file, 'first');
  const warm = await captureBenchmarkCache(root);
  assert.equal(warm.files, 1);
  assert.notEqual(warm.digest, cold.digest);
  assert.deepEqual(await captureBenchmarkCache(root), warm);
  await fs.writeFile(file, 'other');
  const changed = await captureBenchmarkCache(root);
  assert.equal(changed.files, 1);
  assert.notEqual(changed.digest, warm.digest, 'Same-size cache edits change the captured identity');
  await fs.unlink(file);
  assert.deepEqual(await captureBenchmarkCache(root), cold);
});

async function runnerFixture(t, { riskBoundaries = false, timedUnit = false, blockedUnit = false } = {}) {
  const root = path.join(repositoryRoot, '.test-data', `runner-contract-${randomUUID()}`);
  await fs.mkdir(path.join(root, 'scripts'), { recursive: true });
  t.after(async () => {
    assert.equal(path.dirname(root), path.join(repositoryRoot, '.test-data'));
    await fs.rm(root, { recursive: true });
    await assert.rejects(fs.stat(root), { code: 'ENOENT' });
  });
  await fs.cp(path.join(repositoryRoot, 'src'), path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    type: 'module', version: JSON.parse(await fs.readFile(path.join(repositoryRoot, 'package.json'), 'utf8')).version,
  }));
  if (riskBoundaries) {
    await fs.cp(path.join(repositoryRoot, 'assets'), path.join(root, 'assets'), { recursive: true });
    await fs.mkdir(path.join(root, 'test'), { recursive: true });
    await fs.copyFile(path.join(repositoryRoot, 'test', 'helpers.mjs'), path.join(root, 'test', 'helpers.mjs'));
  }
  await Promise.all(['test-runner.mjs', 'test-worker.mjs', 'test-profiles.mjs', 'validation-inventory.mjs',
    'test-scheduling.mjs', 'test-budget.mjs', 'test-budget-worker.mjs', 'frozen-fixture-transport.mjs',
    'test-local-evidence.mjs'].map(file =>
    fs.copyFile(path.join(repositoryRoot, 'scripts', file), path.join(root, 'scripts', file))));
  const planDirectory = path.join(root, 'docs', 'sdlc', 'public-readiness');
  await fs.mkdir(planDirectory, { recursive: true });
  const tests = [
    { id: 'T-PRD008', level: 'unit' },
    { id: 'T-PRD002', level: 'unit' },
    { id: 'T-PRD005', level: 'integration' },
    { id: 'T-PRD052', level: 'contract' },
    { id: 'T-PRD050', level: 'contract', mode: 'semi-automated', owner: 'agent',
      implementation: 'procedure: section-10-documents' },
  ].map(test => ({ mode: 'automated', ...test, environment: 'local', checkpoint: 'pre-review',
    location: 'development-machine' }));
  await fs.writeFile(path.join(planDirectory, 'test-plan.md'), JSON.stringify({
    tests, criticalSelectors: requiredCriticalSelectors,
  }));
  const log = path.join(root, 'execution-order.ndjson');
  const enteredFile = path.join(root, '.test-data', 'blocked-unit-entered');
  const cases = new Map(unitFiles.map((file, index) => [file, [
    `unit ${file}`,
    ...Array.from({ length: (index === 0 ? 5 : 4) - (index === 0 && (timedUnit || blockedUnit) ? 1 : 0) },
      (_, child) => `unit ${file} additional ${child}`),
  ]]));
  const unitNames = [...cases.values()].flat();
  for (const [file, name] of requiredCriticalSelectors) {
    cases.set(file, [...(cases.get(file) ?? []), name]);
  }
  cases.set('test/ordinary.test.mjs', ['ordinary full-only case']);
  cases.set('test/public-readiness-fixture.test.mjs', [
    'T-PRD008 planned unit preserves state', 'T-PRD005 planned integration preserves state',
    'T-PRD052 automated contract preserves state',
  ]);
  const riskBodies = new Map([
    [requiredCriticalSelectors[0][1], `async t=>{
      const file=${JSON.stringify(path.join(root, '.test-data', 'actual-atomic-registry.json'))};
      await writeJson(file,{revision:3,count:7});
      await assert.rejects(atomicWrite(file,'replacement',{fault:stage=>{
        if(stage==='flushed')throw new Error('controlled flushed-write interruption');
      }}),/controlled flushed-write interruption/);
      assert.deepEqual(await readJson(file),{revision:3,count:7});
      await assert.rejects(updateJson(file,{},value=>({...value,count:99}),{expectedRevision:2}),{code:'STALE'});
      assert.deepEqual(await readJson(file),{revision:3,count:7});
      if(process.env.RUNNER_RISK_REGRESSION==='storage')await writeFile(file,'{"corrupted":');
      assert.deepEqual(await readJson(file),{revision:3,count:7});
    }`],
    [requiredCriticalSelectors[2][1], `async t=>{
      const actual=await fixture(t);
      await actual.runGit('add','.sdlc');await actual.runGit('commit','-qm','Bind isolated branch fixture');
      assert.equal((await actual.store.resolve(actual.repo,actual.sessionId)).workItemId,actual.workItemId);
      await actual.runGit('checkout','-qb','feature/stale-authority');
      if(process.env.RUNNER_RISK_REGRESSION==='authority')
        await actual.store.resolve(actual.repo,actual.sessionId);
      await assert.rejects(actual.store.resolve(actual.repo,actual.sessionId),{code:'BINDING'});
    }`],
    [requiredCriticalSelectors[6][1], `async t=>{
      const actual=await fixture(t,{initialize:false});
      const options={sourceRoot:${JSON.stringify(repositoryRoot)}};
      await install(actual.store,options);
      const userFile=path.join(actual.home,'skills','sdlc','SKILL.md');
      const modified=(await readFile(userFile,'utf8'))+'\\nUser-owned preserved policy.\\n';
      await writeFile(userFile,modified);
      await assert.rejects(install(actual.store,options),{code:'INSTALL_CONFLICT'});
      assert.equal(await readFile(userFile,'utf8'),modified);
      if(process.env.RUNNER_RISK_REGRESSION==='installer')await install(actual.store,options);
      assert.equal(await readFile(userFile,'utf8'),modified);
    }`],
  ]);
  const requestedRisk = typeof riskBoundaries === 'string' ? {
    storage: requiredCriticalSelectors[0][1], authority: requiredCriticalSelectors[2][1],
    installer: requiredCriticalSelectors[6][1],
  }[riskBoundaries] : null;
  for (const [file, names] of cases) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    const declarations = [];
    for (const name of names) {
      if (blockedUnit && name === `unit ${unitFiles[0]}`) {
        declarations.push(`test(${JSON.stringify(name)},async t=>{await t.test('T-PRD008 planned unit preserves state',async()=>{
          const keepAlive=setInterval(()=>{},1000);
          try{await writeFile(${JSON.stringify(enteredFile)},String(process.pid));await new Promise(()=>{});}
          finally{clearInterval(keepAlive);}
        });});`);
        continue;
      }
      if (timedUnit && name === `unit ${unitFiles[0]}`) {
        declarations.push(`test(${JSON.stringify(name)},async t=>{await t.test('T-PRD008 planned unit preserves state',async()=>{
          if(process.env.RUNNER_TIMING_FAIL)assert.fail('immediate failure before timed work');
          const before=performance.now();await new Promise(resolve=>setTimeout(resolve,30));
          assert.ok(performance.now()-before>=10);
          await appendFile(${JSON.stringify(log)},JSON.stringify(${JSON.stringify(name)})+'\\n');
        });});`);
        continue;
      }
      if (riskBoundaries && riskBodies.has(name) && (!requestedRisk || requestedRisk === name)) {
        declarations.push(`test(${JSON.stringify(name)},${riskBodies.get(name)});`);
        continue;
      }
      const sentinel = path.join(root, `sentinel-${randomUUID()}`);
      await fs.writeFile(sentinel, 'preserved original state');
      const nestedUnit = name.startsWith('T-PRD008 ');
      declarations.push(`${nestedUnit ? "test('unit parent',async t=>{await t.test(" : 'test('}${JSON.stringify(name)},async t=>{` +
        `if(process.env.RUNNER_FIXTURE_SKIP===${JSON.stringify(name)}){t.skip('required fixture prerequisite absent');return;}` +
        `await appendFile(${JSON.stringify(log)},JSON.stringify(${JSON.stringify(name)})+'\\n');` +
        (name === requiredCriticalSelectors[0][1] ?
          `if(process.env.RUNNER_MUTATE_SOURCE)await appendFile(${JSON.stringify(path.join(root, 'src', 'core.mjs'))},'\\n// changed after local source capture\\n');` : '') +
        `if(process.env.RUNNER_FIXTURE_FAILURE===${JSON.stringify(name)})` +
          `await writeFile(${JSON.stringify(sentinel)},'corrupted fixture state');` +
        `assert.equal(await readFile(${JSON.stringify(sentinel)},'utf8'),'preserved original state');});${nestedUnit ? '});' : ''}`);
    }
    await fs.writeFile(path.join(root, file), [
      `export const validationDeclarations = ${JSON.stringify({ schemaVersion: 1,
        ...(file === unitFiles[0] ? { plannedCases: ['T-PRD008', 'T-PRD002'].map(id => ({
          id, selectors: [{ name: names[0], parents: [] }],
        })) } : {}), applicability: [{
        names, platforms: ['linux-x64', 'windows-x64', 'macos-arm64', 'macos-x64'],
        owner: 'runner-contract-fixture', reason: 'Controlled required-prerequisite failure; a skip cannot pass',
        prerequisites: ['uncorrupted owned fixture state'],
      }] })};`,
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import {appendFile,readFile,writeFile} from 'node:fs/promises';",
      ...(riskBoundaries ? [
        "import {atomicWrite,readJson,writeJson,updateJson} from '../src/files.mjs';",
        "import {fixture} from './helpers.mjs';",
        "import {install} from '../src/install.mjs';",
        "import path from 'node:path';",
      ] : []),
      ...declarations,
    ].join('\n'));
  }
  const invoke = async (args, env = {}) => {
    let completedAtMs;
    try {
      const pending = execute(process.execPath, [path.join(root, 'scripts', 'test-runner.mjs'), ...args],
        { cwd: root, env: { ...process.env, SDLC_TEST_WORKERS: '2', ...env },
          maxBuffer: 4 * 1024 * 1024 });
      pending.child.prependOnceListener('close', () => { completedAtMs = Date.now(); });
      const output = await pending;
      assert.ok(Number.isSafeInteger(completedAtMs), 'Original producer completion boundary is required');
      return { ...output, exitCode: 0, completedAtMs };
    } catch (error) {
      if (typeof error.code !== 'number') throw error;
      assert.ok(Number.isSafeInteger(completedAtMs), 'Original failed producer completion boundary is required');
      return { stdout: error.stdout, stderr: error.stderr, exitCode: error.code, completedAtMs };
    }
  };
  return { root, log, enteredFile, invoke, tests, unitNames,
    planFile: path.join(planDirectory, 'test-plan.md') };
}

test('T-PRD010 benchmark completes same-file root measurements under the actual shared budget', async t => {
  const baseline = await runnerFixture(t);
  const candidate = await runnerFixture(t);
  const fixtureSource = [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "test('first independent benchmark root',()=>assert.equal(2+2,4));",
    "test('second independent benchmark root',()=>assert.equal(3*3,9));",
  ].join('\n');
  for (const root of [baseline.root, candidate.root]) {
    const directory = path.join(root, 'test');
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      assert.ok(entry.isFile());
      await fs.unlink(path.join(directory, entry.name));
    }
    await fs.writeFile(path.join(directory, 'benchmark-fixture.test.mjs'), fixtureSource);
  }
  let inventory = await compileValidationInventory(baseline.root);
  assert.ok(inventory.unresolved.every(item => item.code === 'UNMAPPED_EXECUTABLE_SURFACE'));
  const outputDirectory = path.join(repositoryRoot, '.test-data', `benchmark-contract-${randomUUID()}`);
  t.after(() => fs.rm(outputDirectory, { recursive: true, force: true }));
  await assert.rejects(runValidationBenchmark({ baselineRoot: baseline.root, candidateRoot: candidate.root,
    outputDirectory, workers: 2, focusedAssertionIds: [inventory.cases[0].id] }),
  error => error.code === 'INVENTORY' && error.message.includes('before measurement'));
  await assert.rejects(fs.stat(outputDirectory), { code: 'ENOENT' });
  const harnessDeclaration = `export const validationDeclarations=${JSON.stringify({ schemaVersion: 1,
    surfaces: [{ coverage: 'fixture-only', paths: inventory.unresolved.map(item => item.path) }],
  })};\n`;
  for (const root of [baseline.root, candidate.root]) {
    await fs.writeFile(path.join(root, 'test', 'benchmark-fixture.test.mjs'), harnessDeclaration + fixtureSource);
  }
  await fs.appendFile(path.join(candidate.root, 'test', 'benchmark-fixture.test.mjs'),
    "\ntest('candidate-only independent benchmark root',()=>assert.fail('not an original measurement'));\n");
  inventory = await compileValidationInventory(baseline.root);
  assert.equal(inventory.complete, true, JSON.stringify(inventory.unresolved));
  assert.equal(inventory.cases.length, 2);
  const inherited = process.env.SDLC_TEST_BUDGET ? await readTestBudget() : null;
  const workers = 2;
  assert.ok(!inherited || inherited.capacity >= workers);
  const { comparison } = await runValidationBenchmark({ baselineRoot: baseline.root,
    candidateRoot: candidate.root, outputDirectory, workers,
    focusedAssertionIds: [inventory.cases[0].id] });
  assert.equal(comparison.status, 'Passed', JSON.stringify({ blockers: comparison.blockers,
    measurements: comparison.baseline.measurements.map(measurement => measurement.completion) }));
  assert.equal(comparison.comparisons.length, 4);
  const candidateInventory = await compileValidationInventory(candidate.root);
  assert.deepEqual(comparison.addedAssertionIds, candidateInventory.cases
    .filter(test => test.name === 'candidate-only independent benchmark root').map(test => test.id));
  assert.equal(comparison.addedAssertionIds.length, 1);
  for (const version of ['baseline', 'candidate']) {
    assert.equal(comparison[version].measurements.length, 4);
    for (const measurement of comparison[version].measurements) {
      assert.equal(measurement.complete, true);
      assert.equal(measurement.counts.passed, measurement.scope === 'full' ? 2 : 1);
      assert.equal(measurement.fileConcurrency, measurement.scope === 'full' ? 2 : 1);
      const report = JSON.parse(await fs.readFile(measurement.reportPath, 'utf8'));
      assert.equal(typeof measurement.resources.policy, 'string');
      assert.equal(typeof measurement.resources.protocolVersion, 'number');
      assert.equal(measurement.resources.policy, report.resources.budget.allocationPolicy);
      assert.equal(measurement.resources.protocolVersion, report.resources.budget.version);
      assert.equal(measurement.groupSelectionDigest, report.groupExecution.selectionDigest);
    }
  }
  for (let index = 0; index < comparison.baseline.measurements.length; index++) {
    const baselineMeasurement = comparison.baseline.measurements[index];
    const candidateMeasurement = comparison.candidate.measurements[index];
    assert.notEqual(baselineMeasurement.sourceDigest, candidateMeasurement.sourceDigest);
    assert.notEqual(baselineMeasurement.groupSelectionDigest, candidateMeasurement.groupSelectionDigest);
    assert.equal(baselineMeasurement.configurationDigest, candidateMeasurement.configurationDigest);
  }
});

function criticalSequence(stdout) {
  const prefix = '[test-runner:sequence] ';
  const line = stdout.split(/\r?\n/u).find(line => line.startsWith(prefix));
  assert.ok(line, stdout);
  return JSON.parse(line.slice(prefix.length));
}

test('T-PRD002 full rejects a hidden failing dynamic node:test registration beside a known passing root', async t => {
  const f = await runnerFixture(t);
  for (const name of await fs.readdir(path.join(f.root, 'test'))) {
    if (name.endsWith('.test.mjs')) await fs.unlink(path.join(f.root, 'test', name));
  }
  const file = path.join(f.root, 'test', 'dynamic-registration.test.mjs');
  const marker = path.join(f.root, 'known-root-started');
  for (const operand of [
    "'node:test'", '"node:test"', '`node:test`', "('node:test')",
    '((/* around literal */ "node:test" /* after */))',
    '( // outer wrapper\n ( /* inner */ `node:test` ) )',
    "'node\\u003atest'", '`node\\x3atest`', "'node\\u{3a}test'",
    "'node:\\\ntest'", `${'('.repeat(128)}\`node:test\`${')'.repeat(128)}`,
    "( /* outer */ ('node\\x3atest') /* done */ )",
    "'node:' + 'test'", "('node:' + (`te` + 'st'))", "`node:test` + ''",
    "'node:test' + ('' || '')",
  ]) {
    await fs.writeFile(file, `import test from 'node:test';
import assert from 'node:assert/strict';import {writeFile} from 'node:fs/promises';
test('known passing root',()=>writeFile(${JSON.stringify(marker)},'started'));
const {it:extra}=await import(${operand});
extra('hidden failing dynamic root',()=>assert.fail('owned dynamic registration failure'));
`);
    const result = await f.invoke(['full']);
    assert.notEqual(result.exitCode, 0, `${operand}: ${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /UNSUPPORTED_DYNAMIC_TEST_IMPORT_BINDING/u);
    await assert.rejects(fs.stat(marker), { code: 'ENOENT' },
      'Reject the incomplete source denominator before any exact root filter can omit the failure');
  }
  for (const operand of [
    "'node:fs/promises'", '`node:fs/promises`',
    '( /* wrappers */ ( `node:\\u0066s/promises` ) )',
    "'node:test/reporters'", "(( 'node:\\\nfs/promises' ))",
    "'node:test' + '/reporters'", "('node:' + (`fs` + '/promises'))",
    "( ('node:' /* split */ + 'test/reporters') )",
  ]) {
    await fs.writeFile(file, `import test from 'node:test';
import assert from 'node:assert/strict';import {writeFile} from 'node:fs/promises';
const dependency=await import(${operand});
test('known passing root',async()=>{
  assert.ok(Object.keys(dependency).length>0);
  await writeFile(${JSON.stringify(marker)},'started');
});
`);
    const result = await f.invoke(['full']);
    assert.equal(result.exitCode, 0, `${operand}: ${result.stdout}${result.stderr}`);
    assert.equal(await fs.readFile(marker, 'utf8'), 'started');
    await fs.unlink(marker);
  }
});

test('T-PRD010 impossible four-level resident lineage rejects before yielding and restores every owned lease', async () => {
  const keys = ['SDLC_TEST_BUDGET', 'SDLC_TEST_BUDGET_PRODUCER', 'SDLC_TEST_BUDGET_PARENT', 'SDLC_TEST_BUDGET_SLOT'];
  const original = new Map(keys.map(key => [key, process.env[key]]));
  const owner = await enterTestBudget({
    workers: 2, fileCount: 2, control: true, inherited: null, parent: null, slot: null,
  });
  const owned = [];
  let pending;
  const observeAdmission = async request => {
    pending = request.then(lease => {
      owned.push({ kind: 'producer', lease });
      return { status: 'admitted' };
    }, error => ({ status: 'rejected', code: error.code, message: error.message }));
    let timer;
    try {
      return await Promise.race([pending, new Promise(resolve => {
        timer = setTimeout(() => resolve({ status: 'stalled' }), 1500);
      })]);
    } finally { clearTimeout(timer); }
  };
  try {
    let parent = owner.parent;
    let slot = null;
    for (let level = 0; level < 3; level++) {
      const producer = await enterTestBudget({ workers: 2, fileCount: 2,
        inherited: owner.inherited, parent, slot });
      owned.push({ kind: 'producer', lease: producer });
      Object.assign(process.env, producer.environment);
      const worker = await acquireTestWorker(2);
      owned.push({ kind: 'worker', lease: worker });
      parent = worker.slot;
      slot = worker.slot;
    }
    const before = await owner.snapshot();
    assert.deepEqual([before.capacity, before.producers, before.potentialResidentWorkers,
      before.residentWorkers, before.activeWorkers, before.pendingParentRestorations], [2, 3, 6, 3, 1, 0]);
    const result = await observeAdmission(enterTestBudget({
      workers: 2, fileCount: 2, inherited: owner.inherited, parent, slot,
    }));
    assert.equal(result.status, 'rejected', 'An impossible waiting ancestor lineage must terminate explicitly');
    assert.equal(result.code, 'BUDGET');
    assert.match(result.message, /lineage.*resident limit/u);
    const rejected = await owner.snapshot();
    assert.deepEqual([rejected.producers, rejected.potentialResidentWorkers, rejected.residentWorkers,
      rejected.activeWorkers, rejected.pendingParentRestorations], [3, 6, 3, 1, 0],
    'Rejected admission must not yield the current parent token or create a pending restoration');
    const control = await enterTestBudget({ workers: 2, fileCount: 2, control: true,
      inherited: owner.inherited, parent, slot });
    owned.push({ kind: 'control', lease: control });
    const controlled = await observeAdmission(enterTestBudget({ workers: 2, fileCount: 2,
      inherited: owner.inherited, parent: control.parent, slot: null }));
    assert.equal(controlled.status, 'rejected');
    assert.equal(controlled.code, 'BUDGET');
    assert.match(controlled.message, /lineage.*resident limit/u);
    await control.close();
    owned.pop();
    const restored = await owner.snapshot();
    assert.deepEqual([restored.controls, restored.activeWorkers, restored.pendingParentRestorations], [1, 1, 0],
      'A controller must restore its original parent after rejected descendant admission');
  } finally {
    try {
      for (const { lease } of owned.reverse()) await lease.close();
      if (pending) await pending;
      const closed = await owner.snapshot();
      assert.deepEqual([closed.producers, closed.potentialResidentWorkers, closed.residentWorkers,
        closed.activeWorkers, closed.pendingParentRestorations], [0, 0, 0, 0, 0]);
    } finally {
      await owner.close();
      for (const [key, value] of original) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }
});

test('T-PRD005 affected planned units without a unit suffix keep their root closure before all integration work', async t => {
  const f = await runnerFixture(t);
  const file = path.join(f.root, 'test', 'affected-classifier.test.mjs');
  const integration = path.join(f.root, 'integration-started');
  const sibling = path.join(f.root, 'ordered-unit-child');
  await fs.writeFile(file, `export const validationDeclarations=${JSON.stringify({
    schemaVersion: 1, plannedCases: [{ id: 'T-PRD002', selectors: [
      { name: 'unprefixed failing unit child', parents: ['unprefixed causal unit root'] },
    ] }],
  })};
import test from 'node:test';import assert from 'node:assert/strict';import {writeFile} from 'node:fs/promises';
test('T-PRD002 prefixed affected unit',()=>assert.fail('owned prefixed unit failure'));
test('unprefixed causal unit root',async t=>{
  await t.test('unprefixed failing unit child',()=>assert.fail('owned bound unit failure'));
  await t.test('ordered unit child',()=>writeFile(${JSON.stringify(sibling)},'finished'));
});
test('integration after affected units',()=>writeFile(${JSON.stringify(integration)},'started'));
`);
  const result = await f.invoke(['critical', '--affected', file, '--affected-name',
    'T-PRD002 prefixed affected unit|unprefixed failing unit child|integration after affected units']);
  assert.equal(result.exitCode, 1, result.stdout + result.stderr);
  const sequence = criticalSequence(result.stdout);
  assert.ok(sequence.stages.some(stage => stage.stage === 'affected-units' && stage.exitCode === 1));
  assert.ok(!sequence.stages.some(stage => ['integration', 'affected'].includes(stage.stage)));
  const names = (await fs.readFile(f.log, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(new Set(names), new Set(f.unitNames));
  assert.equal(await fs.readFile(sibling, 'utf8'), 'finished');
  await assert.rejects(fs.stat(integration), { code: 'ENOENT' });
  const units = sequence.stages.find(stage => stage.stage === 'affected-units');
  const report = JSON.parse(await fs.readFile(units.reportPath, 'utf8'));
  assert.deepEqual(new Set(report.executions.map(row => row.name)), new Set([
    'T-PRD002 prefixed affected unit', 'unprefixed causal unit root',
    'unprefixed failing unit child', 'ordered unit child',
  ]));
});

test('T-PRD005 public critical command executes canonical units before risk-based cases and keeps targeted/full available', async t => {
  const f = await runnerFixture(t);
  const critical = await f.invoke(['critical']);
  assert.equal(critical.exitCode, 0, critical.stdout + critical.stderr);
  const names = (await fs.readFile(f.log, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(new Set(names.slice(0, f.unitNames.length)), new Set(f.unitNames));
  assert.deepEqual(new Set(names.slice(f.unitNames.length)),
    new Set(requiredCriticalSelectors.map(([, name]) => name)));
  assert.equal(new Set(names).size, names.length, 'No unit is executed twice across critical stages');
  assert.ok(!names.includes('ordinary full-only case'));
  const targeted = await f.invoke(['targeted', '--name', '^ordinary full-only case$', 'test/ordinary.test.mjs']);
  assert.equal(targeted.exitCode, 0, targeted.stdout + targeted.stderr);
  const full = await f.invoke(['full']);
  assert.equal(full.exitCode, 0, full.stdout + full.stderr);
  assert.match(full.stdout, /ordinary full-only case/u);
  const reports = await fs.readdir(path.join(f.root, '.test-data', 'executions'));
  assert.equal(reports.length, 3);
  const outputs = (await Promise.all(reports.map(async report => {
    const directory = path.join(f.root, '.test-data', 'executions', report);
    return Promise.all((await fs.readdir(directory)).filter(file => file.endsWith('.sequence.json'))
      .map(async file => JSON.parse(await fs.readFile(path.join(directory, file)))));
  }))).flat();
  assert.equal(outputs.length, 1);
  assert.deepEqual(outputs[0].stages.map(stage => stage.stage),
    ['canonical-units', 'required-units', 'integration']);
  assert.ok(outputs[0].stages.every(stage =>
    stage.execution === 'not-required' || stage.reconciliation.status === 'Passed'));
  assert.deepEqual(outputs[0].stages[0].bindings, []);
  assert.deepEqual(outputs[0].stages[2].bindings, []);
  assert.equal(outputs[0].complete, true, 'Only the automated profile completed');
  assert.equal(outputs[0].profileScope, 'automated-local-critical');
  assert.deepEqual(outputs[0].deferredCases.map(test => [test.testId, test.mode, test.status]),
    f.tests.map(test => [test.id, test.mode, 'NotRun']));
  assert.equal(outputs[0].deferredCases.find(test => test.testId === 'T-PRD050').implementation,
    'procedure: section-10-documents');
  assert.equal(outputs[0].localCheckpoint.complete, true);
  assert.equal(outputs[0].localCheckpoint.status, 'Passed');
  assert.equal(outputs[0].plannedAcceptance.status, 'NotRun');
  assert.ok(!names.some(name => name.startsWith('T-PRD050 ')));
  const unitReport = JSON.parse(await fs.readFile(outputs[0].unitReport));
  const integrationReport = JSON.parse(await fs.readFile(outputs[0].reportPath));
  assert.ok(Date.parse(unitReport.finishedAt) <= Date.parse(integrationReport.startedAt));
});

test('T-PRD005 local critical and directly affected observations use public evidence without CI identity or full-checkpoint credit', async t => {
  const f = await runnerFixture(t);
  const withoutHosted = Object.fromEntries(Object.keys(process.env)
    .filter(key => /^(?:GITHUB_|RUNNER_)/u.test(key)).map(key => [key, undefined]));
  const result = await f.invoke(['critical', '--affected', 'test/ordinary.test.mjs'], withoutHosted);
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  const sequence = criticalSequence(result.stdout);
  assert.equal(sequence.evidence.status, 'Passed');
  assert.equal(sequence.evidence.sourceMatches, true);
  assert.equal(sequence.localCheckpoint.status, 'Passed');
  assert.equal(sequence.localCheckpoint.complete, true);
  assert.equal(sequence.plannedAcceptance.status, 'NotRun');
  assert.deepEqual(sequence.deferredCases.map(test => [test.testId, test.status]),
    f.tests.map(test => [test.id, 'NotRun']));
  assert.deepEqual(new Set(sequence.stages.map(stage => stage.stage)),
    new Set(['canonical-units', 'required-units', 'integration', 'affected']));
  const raw = JSON.parse(await fs.readFile(sequence.evidence.paths.execution, 'utf8'));
  assert.equal(raw.context.producer.provider, 'local-process');
  assert.equal(raw.context.location, 'development-machine');
  assert.equal(raw.context.native.platform, process.platform);
  assert.equal(raw.context.native.architecture, process.arch);
  assert.ok(raw.results.some(test => test.selector.name === 'ordinary full-only case'));
  assert.equal(raw.sourceSummary.reports.length, 3);
  assert.ok(raw.sourceSummary.reports.every(report => report.process.pid > 0 && report.sha256));
  const bundle = JSON.parse(await fs.readFile(sequence.evidence.paths.bundle, 'utf8'));
  const get = ref => bundle.objects.find(object => object.ref.sha256 === ref.sha256).value;
  const independentPlan = await createPlan(parseOptions(['critical'], {}), f.root);
  const expected = deriveLocalSanitySpecification({ inventory: independentPlan.inventory,
    testPlan: await fs.readFile(f.planFile, 'utf8') });
  const actualSpecification = get(bundle.manifest.specificationRef).specification;
  assert.deepEqual(actualSpecification.cases.find(test => test.id === 'T-LOCAL-REGRESSIONS'),
    expected.specification.cases[0], 'Optional debugging cannot change the independently derived finite-L catalog');
  assert.ok(actualSpecification.cases.find(test => test.id === 'T-LOCAL-AFFECTED').assertions
    .some(assertion => assertion.selector.name === 'ordinary full-only case'));
  assert.equal(bundle.manifest.kind, 'validation-bundle');
  assert.ok(bundle.objects.filter(object => object.value.kind === 'execution-bytes').length >= 4);
  const replay = readEvidenceBundle(bundle, {
    specification: get(bundle.manifest.specificationRef).specification,
    context: get(bundle.manifest.contextRef).context,
  });
  assert.equal(replay.historicalSummary.status, 'Passed');
  assert.equal(replay.evaluation.status, 'NotRun', 'Serialized local host flags are not a fresh origin verifier');
  const changed = await f.invoke(['critical'], { RUNNER_MUTATE_SOURCE: '1' });
  assert.equal(changed.exitCode, 2, changed.stdout + changed.stderr);
  const stale = criticalSequence(changed.stdout);
  assert.equal(stale.evidence.status, 'NotRun');
  assert.equal(stale.evidence.sourceMatches, false);
  const original = JSON.parse(await fs.readFile(sequence.evidence.paths.execution, 'utf8'));
  assert.deepEqual(original, raw, 'A changed source cannot rewrite the original local execution');
});

test('T-PRD005 missing local producer output remains explicit NotRun with original process context', async t => {
  const f = await runnerFixture(t);
  const worker = path.join(f.root, 'scripts', 'test-worker.mjs');
  await fs.appendFile(worker, "\nimport {unlink as removeOwnReport} from 'node:fs/promises';\nif(reportPath)await removeOwnReport(reportPath);\n");
  const result = await f.invoke(['critical']);
  assert.equal(result.exitCode, 2, result.stdout + result.stderr);
  const sequence = criticalSequence(result.stdout);
  assert.equal(sequence.evidence.status, 'NotRun');
  const raw = JSON.parse(await fs.readFile(sequence.evidence.paths.execution, 'utf8'));
  assert.equal(raw.complete, false);
  assert.ok(raw.sourceSummary.reports.some(report => report.problem === 'ENOENT' && report.process.pid > 0));
  assert.equal(sequence.localCheckpoint.complete, false);
});

test('T-PRD005 cancelled local critical input retains a public incomplete bundle without surviving owned workers', async t => {
  const f = await runnerFixture(t, { blockedUnit: true });
  const runner = pathToFileURL(path.join(f.root, 'scripts', 'test-runner.mjs')).href;
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', `
import {createPlan,parseOptions,run} from ${JSON.stringify(runner)};
process.once('message',()=>process.emit('SIGTERM'));
process.exitCode=await run(await createPlan(parseOptions(['critical','--workers','2'])));
if(process.connected)process.disconnect();
`], { cwd: f.root, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', value => { stdout += value; });
  child.stderr.on('data', value => { stderr += value; });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => resolve(code));
  });
  let closed = false;
  done.then(() => { closed = true; }, () => { closed = true; });
  const requestCancellation = () => new Promise((resolve, reject) =>
    child.send('cancel', error => error ? reject(error) : resolve()));
  try {
    const deadline = Date.now() + 30000;
    let workerPid;
    let observedStart;
    while (Date.now() < deadline && !closed) {
      try { workerPid = Number(await fs.readFile(f.enteredFile, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const dispatch = stdout.split(/\r?\n/u).slice(0, -1)
        .filter(line => line.startsWith('[test-runner:start] '))
        .map(line => JSON.parse(line.slice('[test-runner:start] '.length)))
        .find(stage => stage.profile === 'critical-canonical-units');
      if (dispatch) {
        try {
          const journal = await fs.readFile(path.resolve(f.root, `${dispatch.reportPath}.journal.ndjson`), 'utf8');
          observedStart = journal.split('\n').slice(0, -1).filter(Boolean).map(line => JSON.parse(line))
            .find(event => event.kind === 'start' && event.file === unitFiles[0] &&
              event.name === 'T-PRD008 planned unit preserves state' && event.nesting === 1);
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      if (workerPid && observedStart) break;
      await delay(20);
    }
    assert.ok(workerPid, stdout + stderr);
    assert.ok(observedStart, 'Cancel only after the actual leaf callback and producer case-start observation');
    await requestCancellation();
    assert.equal(await done, 143, stdout + stderr);
    assert.throws(() => process.kill(workerPid, 0), error => error.code === 'ESRCH');
    const sequence = criticalSequence(stdout);
    assert.equal(sequence.evidence.status, 'NotRun');
    const raw = JSON.parse(await fs.readFile(sequence.evidence.paths.execution, 'utf8'));
    const producer = JSON.parse(await fs.readFile(sequence.unitReport, 'utf8'));
    t.diagnostic(JSON.stringify({
      kind: 'local-cancellation-observation', workerPid,
      started: { sequence: observedStart.sequence, file: observedStart.file,
        name: observedStart.name, nesting: observedStart.nesting },
      producer: { complete: producer.complete, exitCode: producer.exitCode,
        assertions: producer.executions.filter(row => row.name === 'T-PRD008 planned unit preserves state')
          .map(row => ({ status: row.status, durationMs: row.durationMs ?? null,
            parents: row.parents, failureType: row.diagnostic?.failureType ?? null,
            completionSource: row.completionSource ?? 'node-terminal-event',
            cancellation: row.cancellation ?? null })) },
      projected: raw.results.filter(row => row.selector.name === 'T-PRD008 planned unit preserves state')
        .map(row => ({ status: row.status, durationMs: row.durationMs })),
    }));
    assert.equal(raw.complete, false);
    assert.ok(raw.results.some(test => test.status === 'Cancelled'));
    assert.ok(raw.results.some(test => test.selector.name === 'T-PRD008 planned unit preserves state' &&
      test.status === 'Cancelled'));
    assert.ok(!raw.results.some(test => test.testId === 'T-PRD005' && test.status === 'Cancelled'),
      'Never-started integration work must not be relabeled as cancelled');
    const readiness = JSON.parse(await fs.readFile(sequence.evidence.paths.readiness, 'utf8'));
    assert.ok(readiness.cases.every(test => test.testId !== 'T-PRD005'),
      'Finite sanity evidence must not invent a planned-case completion projection');
    assert.equal(sequence.localCheckpoint.status, 'NotRun');
  } finally {
    if (!closed && child.connected) await requestCancellation();
    else if (!closed) child.kill('SIGTERM');
    await done;
  }
});

test('T-PRD006 critical failure is non-passing and a failed unit prerequisite never starts later critical work', async t => {
  const f = await runnerFixture(t);
  const failure = criticalSelectors[0][1];
  const critical = await f.invoke(['critical'], { RUNNER_FIXTURE_FAILURE: failure });
  assert.equal(critical.exitCode, 1, critical.stdout + critical.stderr);
  assert.match(critical.stdout + critical.stderr, /corrupted fixture state/u);
  await fs.writeFile(f.log, '');
  const unit = await f.invoke(['critical'], { RUNNER_FIXTURE_FAILURE: `unit ${unitFiles[0]}` });
  assert.equal(unit.exitCode, 1, unit.stdout + unit.stderr);
  const names = (await fs.readFile(f.log, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(names.every(name => name.startsWith('unit ')));
  assert.match(unit.stdout, /"notRun":"critical"/u);
  const plannedFixture = await runnerFixture(t);
  const planned = await plannedFixture.invoke(['critical'], {
    RUNNER_FIXTURE_FAILURE: 'T-PRD008 planned unit preserves state',
  });
  assert.equal(planned.exitCode, 0, planned.stdout + planned.stderr);
  const plannedNames = (await fs.readFile(plannedFixture.log, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(!plannedNames.includes('T-PRD008 planned unit preserves state'));
  assert.ok(plannedNames.some(name => criticalSelectors.some(([, criticalName]) => name === criticalName)));
  assert.ok(!plannedNames.includes('T-PRD005 planned integration preserves state'));
  const missingFixture = await runnerFixture(t);
  await fs.writeFile(missingFixture.planFile, JSON.stringify({ tests: [
    ...missingFixture.tests, { ...missingFixture.tests[0], id: 'T-PRD004' },
  ], criticalSelectors: requiredCriticalSelectors }));
  const missing = await missingFixture.invoke(['critical']);
  assert.equal(missing.exitCode, 0, missing.stdout + missing.stderr);
  assert.ok(criticalSequence(missing.stdout).deferredCases.some(test =>
    test.testId === 'T-PRD004' && test.status === 'NotRun'));
  assert.ok(!(await fs.readFile(missingFixture.log, 'utf8')).includes('T-PRD004'));
  const skippedFixture = await runnerFixture(t);
  const skipped = await skippedFixture.invoke(['critical'], {
    RUNNER_FIXTURE_SKIP: `unit ${unitFiles[0]}`,
  });
  assert.equal(skipped.exitCode, 2, skipped.stdout + skipped.stderr);
  assert.match(skipped.stdout, /required fixture prerequisite absent/u);
  assert.ok(!(await fs.readFile(skippedFixture.log, 'utf8')).includes('T-PRD005'));
});

test('T-PRD006 independent critical obligations execute real storage, stale-authority and installer-preservation boundaries', async t => {
  for (const risk of ['storage', 'authority', 'installer']) {
    const f = await runnerFixture(t, { riskBoundaries: risk });
    const healthy = await f.invoke(['critical']);
    assert.equal(healthy.exitCode, 0, `${risk}: ${healthy.stdout}${healthy.stderr}`);
    const adverse = await f.invoke(['critical'], { RUNNER_RISK_REGRESSION: risk });
    assert.equal(adverse.exitCode, 1, `${risk}: ${adverse.stdout}${adverse.stderr}`);
    assert.match(adverse.stdout + adverse.stderr,
      risk === 'storage' ? /JSON|json/u : risk === 'authority' ?
        /BINDING|branch changed|bound/u : /INSTALL_CONFLICT|Modified.*preserved/u);
  }
  const inadequate = await runnerFixture(t);
  const profileFile = path.join(inadequate.root, 'scripts', 'test-profiles.mjs');
  const source = await fs.readFile(profileFile, 'utf8');
  const requiredLine = source.split('\n').find(line => line.includes(requiredCriticalSelectors[0][1]));
  assert.ok(requiredLine);
  await fs.writeFile(profileFile, source.replace(`${requiredLine}\n`, ''));
  const trivial = await inadequate.invoke(['critical']);
  assert.equal(trivial.exitCode, 2, trivial.stdout + trivial.stderr);
  assert.match(trivial.stdout, /MISSING_REQUIRED_RISK_BINDING|CRITICAL_PROFILE_BUDGET_EXCEEDED/u,
    'Removing a production selector cannot remove its independent canonical risk obligation');
});

test('T-PRD008 timing is observational and critical selection retains slow authority, storage and preservation cases', async () => {
  const plan = await createPlan(parseOptions(['critical'], {}));
  const names = new RegExp(plan.name);
  for (const [, name] of criticalSelectors) assert.ok(names.test(name), name);
  assert.ok(!plan.critical.cases.some(test => test.name.startsWith('T-PRD067 ')));
  assert.ok(!plan.critical.cases.some(test => test.name.startsWith('T-PRD052 ')));
  assert.deepEqual(plan.critical.deferredCases, [],
    'Hosted exhaustive cases are not hidden prerequisites of the finite local sanity profile');
  assert.deepEqual(plan.critical.units.cases, []);
  assert.ok(plan.critical.units.cases.every(test => !names.test([...test.parents, test.name].join(' '))));
  assert.ok(!names.test('unrelated fast success'));
  assert.ok(!names.test(`${criticalSelectors[0][1]} changed`));
  assert.equal(new RegExp(exactPattern(['a.b[0]'])).test('a.b[0]'), true);
  assert.equal(new RegExp(exactPattern(['a.b[0]'])).test('axb0'), false);
  const excluded = ['canonical unit', 'a.b[0]'];
  const regressionNames = Array.from({ length: 1000 }, (_, index) =>
    `regression ${index} preserves all required original assertions and source identities`);
  assert.ok(exactPattern(regressionNames).length > 32767);
  const regressionPattern = excludingPattern(excluded);
  assert.ok(regressionPattern.length < 1000);
  const complement = new RegExp(regressionPattern);
  assert.ok(regressionNames.every(name => complement.test(name)));
  assert.ok(excluded.every(name => !complement.test(name)));
  assert.ok(complement.test('a.b[0] changed'));
  assert.equal(regressionPattern, excludingPattern([...excluded].reverse()));
  const selected = criticalSelection([discoverDeclarations(
    "import test from 'node:test';test('unit parent',async t=>{" +
    "await t.test('T-PRD008 slow unit',()=>{});});" +
    "test('T-PRD005 integration',()=>{});", 'test/public-readiness-fixture.test.mjs')], [
    { id: 'T-PRD008', level: 'unit', environment: 'local', checkpoint: 'pre-review',
      location: 'development-machine', mode: 'automated' },
    { id: 'T-PRD005', level: 'integration', environment: 'local', checkpoint: 'pre-review',
      location: 'development-machine', mode: 'automated' },
  ]);
  assert.deepEqual(selected.deferredCases.map(({ testId, status }) => ({ testId, status })), [
    { testId: 'T-PRD008', status: 'NotRun' },
    { testId: 'T-PRD005', status: 'NotRun' },
  ], 'Explicit local exhaustive declarations remain deferred rather than credited by sanity');
  assert.ok(!new RegExp(selected.units.name).test('unit parent T-PRD008 slow unit'));
  assert.ok(!new RegExp(selected.units.name).test('unit parent'));
  assert.ok(!new RegExp(selected.name).test('unit parent T-PRD008 slow unit'));
  const mixed = criticalSelection([discoverDeclarations(
    "import test from 'node:test';test('T-PRD008 unit parent',async t=>{" +
    "await t.test('T-PRD005 integration child',()=>{});});",
    'test/public-readiness-fixture.test.mjs')], [
    { id: 'T-PRD008', level: 'unit', environment: 'local', checkpoint: 'pre-review',
      location: 'development-machine', mode: 'automated' },
    { id: 'T-PRD005', level: 'integration', environment: 'local', checkpoint: 'pre-review',
      location: 'development-machine', mode: 'automated' },
  ]);
  assert.deepEqual(mixed.units.cases, []);
  assert.ok(!mixed.units.blockers.some(item => item.code === 'MIXED_UNIT_INTEGRATION_ANCESTRY'));
  const siblings = criticalSelection([discoverDeclarations(
    "import test from 'node:test';test('unit parent',async t=>{" +
    "await t.test('T-PRD008 slow unit',()=>{});await t.test('unprefixed required sibling',()=>{});});",
    'test/public-readiness-fixture.test.mjs')], [
    { id: 'T-PRD008', level: 'unit', environment: 'local', checkpoint: 'pre-review',
      location: 'development-machine', mode: 'automated' },
  ]);
  assert.deepEqual(siblings.units.cases, []);
  const originalName = 'original unit assertion';
  const aliasedSource = `export const validationDeclarations = ${JSON.stringify({
    schemaVersion: 1, plannedCases: [
      { id: 'T-PRD008', selectors: [{ name: originalName, parents: [] }] },
      { id: 'T-PRD002', selectors: [{ name: originalName, parents: [] }] },
    ],
  })};import test from 'node:test';test(${JSON.stringify(originalName)},()=>{});`;
  const aliasedFile = 'test/provider-observations.unit.test.mjs';
  const aliased = criticalSelection([discoverDeclarations(aliasedSource, aliasedFile)], [
    { id: 'T-PRD008', level: 'unit', environment: 'local', checkpoint: 'pre-review',
      location: 'development-machine', mode: 'automated' },
    { id: 'T-PRD002', level: 'unit', environment: 'local', checkpoint: 'pre-review',
      location: 'development-machine', mode: 'automated' },
  ], { canonicalFiles: [aliasedFile] });
  assert.deepEqual(aliased.units.cases, []);
  assert.equal(aliased.canonical.cases.length, 1);
  assert.deepEqual(aliased.canonical.bindings, [],
    'One sanity assertion cannot imply completion of two exhaustive planned cases');
  assert.ok(!aliased.units.blockers.some(item => item.code === 'MISSING_REQUIRED_BINDING'));
  const shared = criticalSelection([discoverDeclarations(`export const validationDeclarations = ${JSON.stringify({
    schemaVersion: 1, plannedCases: [{
      id: 'T-PRD005', selectors: [{
        name: 'T-PRD008 original unit assertion', parents: [],
      }, { name: 'original integration assertion', parents: [] }],
    }],
  })};import test from 'node:test';test('T-PRD008 original unit assertion',()=>{});` +
    "test('original integration assertion',()=>{});", 'test/shared.test.mjs')], [
    { id: 'T-PRD008', level: 'unit', environment: 'local', checkpoint: 'pre-review',
      location: 'development-machine', mode: 'automated' },
    { id: 'T-PRD005', level: 'integration', environment: 'local', checkpoint: 'pre-review',
      location: 'development-machine', mode: 'automated' },
  ]);
  assert.ok(!shared.units.blockers.some(item => item.code === 'MIXED_UNIT_INTEGRATION_ANCESTRY'));
  assert.deepEqual(shared.units.cases, []);
  assert.deepEqual(shared.cases, []);
  assert.deepEqual(shared.units.bindings, []);
  assert.deepEqual(shared.bindings, []);
  assert.equal(new Set([...shared.units.cases, ...shared.cases].map(test => test.id)).size, 0);
  const collision = criticalSelection([
    discoverDeclarations(aliasedSource, aliasedFile),
    discoverDeclarations(`export const validationDeclarations = ${JSON.stringify({
      schemaVersion: 1, plannedCases: [{
        id: 'T-PRD005', selectors: [{ name: originalName, parents: [] }],
      }],
    })};import test from 'node:test';test(${JSON.stringify(originalName)},()=>{});` +
      "test('T-PRD008 another unit in the same file',()=>{});", 'test/another.test.mjs'),
  ], [
    { id: 'T-PRD008', level: 'unit', environment: 'local', checkpoint: 'pre-review',
      location: 'development-machine', mode: 'automated' },
    { id: 'T-PRD002', level: 'unit', environment: 'local', checkpoint: 'pre-review',
      location: 'development-machine', mode: 'automated' },
    { id: 'T-PRD005', level: 'integration', environment: 'local', checkpoint: 'pre-review',
      location: 'development-machine', mode: 'automated' },
  ]);
  assert.ok(!collision.units.blockers.some(item => item.code === 'AMBIGUOUS_CRITICAL_SELECTOR'));
  const executionModes = [
    { id: 'T-PRD052', level: 'contract', mode: 'automated' },
    { id: 'T-PRD050', level: 'contract', mode: 'semi-automated', owner: 'agent',
      implementation: 'procedure: section-10-documents' },
    { id: 'T-CONSUMER-MANUAL', level: 'contract', mode: 'manual', owner: 'maintainer',
      implementation: 'procedure: independently observed walkthrough' },
  ].map(test => ({ ...test, environment: 'local', checkpoint: 'pre-review',
    location: 'development-machine' }));
  const modeDeclarations = [discoverDeclarations("import test from 'node:test';" +
    "test('T-PRD052 automated contract',()=>{});" +
    "test('T-PRD050 Node stub is not evidence for the procedure',()=>{});",
  'test/modes.test.mjs')];
  const modes = criticalSelection(modeDeclarations, executionModes);
  assert.deepEqual(modes.cases, []);
  assert.ok(![...modes.units.blockers, ...modes.blockers].some(item =>
    item.code === 'MISSING_REQUIRED_BINDING'));
  assert.deepEqual(modes.deferredCases.map(test => [test.testId, test.mode, test.status]), [
    ['T-PRD052', 'automated', 'NotRun'],
    ['T-PRD050', 'semi-automated', 'NotRun'], ['T-CONSUMER-MANUAL', 'manual', 'NotRun'],
  ]);
  assert.deepEqual(modes.bindings, []);
  const invalidMode = structuredClone(executionModes);
  invalidMode[0].mode = '';
  assert.throws(() => criticalSelection(modeDeclarations, invalidMode), /execution mode/u);
  assert.ok(plan.workers >= 1 && plan.workers <= 16);
});

test('T-PRD008 real timed critical producers retain slow success, immediate failure and native resource identities', async t => {
  const f = await runnerFixture(t, { timedUnit: true });
  const file = path.join(f.root, 'scripts', 'test-profiles.mjs');
  await fs.writeFile(file, (await fs.readFile(file, 'utf8')).replace('criticalMs: 30000', 'criticalMs: 1'));
  const passing = await f.invoke(['critical']);
  assert.equal(passing.exitCode, 0, passing.stdout + passing.stderr);
  const readSequence = output => JSON.parse(output.split(/\r?\n/u)
    .find(line => line.startsWith('[test-runner:sequence] ')).slice('[test-runner:sequence] '.length));
  const complete = readSequence(passing.stdout);
  const passingExecution = JSON.parse(await fs.readFile(complete.evidence.paths.execution, 'utf8'));
  assert.ok(passingExecution.results.length > 0);
  assert.equal(passingExecution.context.attemptCapability, 'none');
  assert.equal(passingExecution.context.producer.attemptKind, 'not-applicable');
  assert.equal(Object.hasOwn(passingExecution.context.producer, 'attemptRef'), false,
    'Only a known provider attempt can carry an attempt reference');
  assert.ok(passingExecution.results.every(result => !Object.hasOwn(result, 'detail')),
    'Diagnostic-free successes omit the optional nonempty public evidence diagnostic');
  const report = JSON.parse(await fs.readFile(complete.unitReport, 'utf8'));
  const actual = report.executions.find(test => test.name === 'T-PRD008 planned unit preserves state');
  assert.equal(actual.status, 'Passed');
  assert.ok(actual.durationMs >= 10);
  assert.equal(report.timing.advisoryMs, 1);
  assert.equal(report.timing.advisoryOnly, true);
  assert.equal(report.timing.exceeded, true);
  assert.equal(report.summary.success, true);
  assert.equal(report.node, process.version);
  assert.equal(report.executable, process.execPath);
  assert.equal(report.platform, process.platform);
  assert.equal(report.architecture, process.arch);
  assert.ok(report.resources.availableParallelism >= 1);
  assert.ok(report.resources.totalMemoryBytes > 0);
  assert.ok(report.resources.budget.peakActiveWorkers <= report.resources.budget.capacity);
  const failing = await f.invoke(['critical'], { RUNNER_TIMING_FAIL: '1' });
  assert.equal(failing.exitCode, 1, failing.stdout + failing.stderr);
  const incomplete = readSequence(failing.stdout);
  const failed = JSON.parse(await fs.readFile(incomplete.unitReport, 'utf8'));
  assert.equal(failed.executions.find(test =>
    test.name === 'T-PRD008 planned unit preserves state').status, 'Failed');
  assert.match(failing.stdout + failing.stderr, /immediate failure before timed work/u);
  assert.equal(incomplete.complete, false);
  assert.equal(incomplete.evidence.status, 'Failed');
  const failingExecution = JSON.parse(await fs.readFile(incomplete.evidence.paths.execution, 'utf8'));
  assert.match(failingExecution.results.find(result =>
    result.selector.name === 'T-PRD008 planned unit preserves state' &&
    result.status === 'Failed').detail, /immediate failure before timed work/u);
});

test('T-PRD005 finite sanity membership ignores historical planned-case growth and rejects budget expansion', async t => {
  const declarations = [];
  const sourceCases = new Map(unitFiles.map((file, index) => [file,
    Array.from({ length: index === 0 ? 6 : 5 }, (_, child) => `canonical ${index}-${child}`)]));
  for (const [file, name] of requiredCriticalSelectors) {
    sourceCases.set(file, [...(sourceCases.get(file) ?? []), name]);
  }
  for (const [file, names] of sourceCases) declarations.push(discoverDeclarations(
    "import test from 'node:test';" + names.map(name => `test(${JSON.stringify(name)},()=>{});`).join(''), file));
  const tests = Array.from({ length: 100 }, (_, index) => ({
    id: `T-PRD${String(index + 1).padStart(3, '0')}`, level: index % 2 ? 'unit' : 'integration',
    mode: 'automated', environment: 'local', checkpoint: 'pre-review', location: 'development-machine',
  }));
  declarations.push(discoverDeclarations("import test from 'node:test';" +
    "test('T-PRD099 newly authored unit must remain PR-only',()=>{});", 'test/new.unit.test.mjs'));
  const selected = criticalSelection(declarations, tests, {
    canonicalFiles: unitFiles, requiredSelectors: requiredCriticalSelectors,
  });
  assert.deepEqual(selected.metrics, {
    canonicalAssertions: 16, canonicalRoots: 16, riskRoots: 11, riskAssertions: 11, rootChecks: 27, assertions: 27,
  });
  assert.equal(selected.budget.maximumRootChecks, criticalProfileBudget.maximumRootChecks);
  assert.equal(selected.cases.length + selected.canonical.cases.length, 27);
  assert.deepEqual(selected.units.cases, []);
  assert.deepEqual([...selected.units.blockers, ...selected.blockers], []);
  assert.equal(selected.deferredCases.length, tests.length);
  assert.ok(selected.deferredCases.every(test => test.status === 'NotRun'));
  const grown = structuredClone(declarations);
  const additional = discoverDeclarations("import test from 'node:test';test('new implicit unit',()=>{});",
    unitFiles[0]).cases[0];
  grown[0].cases.push(additional);
  assert.ok(criticalSelection(grown, tests, { canonicalFiles: unitFiles,
    requiredSelectors: requiredCriticalSelectors }).units.blockers.some(blocker =>
    blocker.code === 'CRITICAL_PROFILE_BUDGET_EXCEEDED'));
  const newRisk = ['test/new.unit.test.mjs', 'T-PRD099 newly authored unit must remain PR-only'];
  const changed = criticalSelection(declarations, tests, {
    canonicalFiles: unitFiles, requiredSelectors: [...requiredCriticalSelectors, newRisk],
  });
  assert.ok(changed.units.blockers.some(blocker => blocker.code === 'CRITICAL_PROFILE_BUDGET_EXCEEDED'));
  assert.ok(changed.blockers.some(blocker => blocker.code === 'MISSING_REQUIRED_RISK_BINDING'));
  const missing = criticalSelection(declarations, tests, {
    canonicalFiles: unitFiles, requiredSelectors: requiredCriticalSelectors.slice(1),
  });
  assert.ok(missing.blockers.some(blocker => blocker.code === 'UNDECLARED_CRITICAL_RISK'));
  const descendant = discoverDeclarations(`import test from 'node:test';test(${JSON.stringify(
    requiredCriticalSelectors[0][1])},async t=>{await t.test('new nested sanity assertion',()=>{});});`,
  requiredCriticalSelectors[0][0]).cases.find(test => test.parents.length === 1);
  const descendantGrowth = structuredClone(declarations);
  descendantGrowth.find(declaration => declaration.file === descendant.file).cases.push(descendant);
  const enlarged = criticalSelection(descendantGrowth, tests, {
    canonicalFiles: unitFiles, requiredSelectors: requiredCriticalSelectors,
  });
  assert.equal(enlarged.metrics.rootChecks, 27);
  assert.equal(enlarged.metrics.assertions, 28);
  assert.ok(enlarged.units.blockers.some(blocker => blocker.code === 'CRITICAL_PROFILE_BUDGET_EXCEEDED'),
    'A descendant cannot silently grow the fixed assertion budget while retaining the same root count');
  const hosted = hostedValidationSelection({
    inventory: { complete: true, files: declarations.map(({ file, sourceDigest }) => ({ file, sourceDigest })),
      cases: declarations.flatMap(declaration => declaration.cases) },
    tests, canonicalFiles: unitFiles,
  });
  assert.equal(Object.values(hosted).flatMap(stage => stage.cases).length, 28);
  assert.ok(hosted.units.cases.some(test => test.name === newRisk[1]));
  const adopted = { files: declarations.map(({ file, sourceDigest }) => ({ file, sourceDigest })),
    cases: declarations.flatMap(declaration => declaration.cases), nodeUnresolved: [] };
  const testPlan = JSON.stringify({ tests, criticalSelectors: requiredCriticalSelectors });
  const expected = deriveLocalSanitySpecification({ inventory: adopted, testPlan, platform: 'windows-x64' });
  assert.equal(expected.policy, 'finite-local-sanity-v1');
  assert.deepEqual(expected.specification.cases.map(test => test.id), ['T-LOCAL-REGRESSIONS']);
  assert.equal(expected.requiredAssertionIds.length, 27);
  assert.deepEqual(expected.requiredAssertionIds,
    expected.specification.cases[0].assertions.map(assertion => assertion.id));
  assert.ok(!expected.specification.cases[0].assertions.some(assertion => assertion.selector.name === newRisk[1]));
  const prOnlyCases = tests.map(test => ({ ...test, environment: 'CI', location: 'github-pr-matrix',
    checkpoint: 'post-review' }));
  const prOnly = criticalSelection(declarations, prOnlyCases, {
    canonicalFiles: unitFiles, requiredSelectors: requiredCriticalSelectors,
  });
  assert.deepEqual(prOnly.cases.map(test => test.id), selected.cases.map(test => test.id));
  assert.deepEqual(prOnly.deferredCases, []);
  assert.deepEqual(deriveLocalSanitySpecification({ inventory: adopted,
    testPlan: JSON.stringify({ tests: prOnlyCases, criticalSelectors: requiredCriticalSelectors }),
    platform: 'windows-x64' }).specification, expected.specification,
  'Finite sanity identity is independent of every logical case moving to the PR checkpoint');
  const missingSource = structuredClone(adopted);
  missingSource.cases = missingSource.cases.filter(test => test.name !== requiredCriticalSelectors[0][1]);
  assert.throws(() => deriveLocalSanitySpecification({ inventory: missingSource, testPlan }),
    /membership is incomplete/u);
  assert.throws(() => deriveLocalSanitySpecification({ inventory: adopted,
    testPlan: JSON.stringify({ tests, criticalSelectors: requiredCriticalSelectors.slice(1) }) }),
  /membership is incomplete/u);
  const f = await runnerFixture(t);
  const started = path.join(f.root, '.test-data', 'unapproved-local-growth');
  const originalUnit = await fs.readFile(path.join(f.root, unitFiles[0]), 'utf8');
  await fs.appendFile(path.join(f.root, unitFiles[0]),
    `\ntest('unapproved implicit canonical root',()=>writeFile(${JSON.stringify(started)},'started'));\n`);
  const rejected = await f.invoke(['critical']);
  assert.equal(rejected.exitCode, 2, rejected.stdout + rejected.stderr);
  assert.match(rejected.stdout, /CRITICAL_PROFILE_BUDGET_EXCEEDED/u);
  await assert.rejects(fs.stat(started), { code: 'ENOENT' });
  await assert.rejects(fs.stat(f.log), { code: 'ENOENT' },
    'Reject implicit growth before any timed sanity callback, not after executing the enlarged gate');
  await fs.writeFile(path.join(f.root, unitFiles[0]), originalUnit);
  const riskFile = path.join(f.root, requiredCriticalSelectors[0][0]);
  const originalRisk = await fs.readFile(riskFile, 'utf8');
  const opening = `test(${JSON.stringify(requiredCriticalSelectors[0][1])},async t=>{`;
  assert.ok(originalRisk.includes(opening));
  await fs.writeFile(riskFile, originalRisk.replace(opening, opening +
    `await t.test('unapproved nested sanity child',()=>writeFile(${JSON.stringify(started)},'nested'));`));
  const rejectedChild = await f.invoke(['critical']);
  assert.equal(rejectedChild.exitCode, 2, rejectedChild.stdout + rejectedChild.stderr);
  assert.match(rejectedChild.stdout, /CRITICAL_PROFILE_BUDGET_EXCEEDED/u);
  await assert.rejects(fs.stat(started), { code: 'ENOENT' });
  await assert.rejects(fs.stat(f.log), { code: 'ENOENT' });
});

test('T-PRD010 ready root groups validate exact partitions, dependencies and resource declarations', async () => {
  const file = 'test/ready-groups.test.mjs';
  const source = groups => `export const validationDeclarations=${JSON.stringify({
    schemaVersion: 1, groups,
  })};import test from 'node:test';test('first root',async t=>{
    await t.test('ordered one',()=>{});await t.test('ordered two',()=>{});
  });test('second root',()=>{});test('independent root',()=>{});`;
  const inventory = groups => {
    const declaration = discoverDeclarations(source(groups), file);
    return { files: [{ file, sourceDigest: declaration.sourceDigest }], cases: declaration.cases,
      groupDeclarations: declaration.declared.groups.map(group => ({ file, ...group })) };
  };
  const adopted = inventory([
    { root: 'first root', minimumSlots: 2, exclusiveResources: ['owned-device'] },
    { root: 'second root', dependsOn: ['first root'], exclusiveResources: ['owned-device'] },
  ]);
  const groups = validationExecutionGroups(adopted, { preserveOrder: true });
  assert.deepEqual(groups[0].assertionIds, adopted.cases.slice(0, 3).map(test => test.id));
  assert.deepEqual(groups[1].dependsOn, [groups[0].id]);
  assert.deepEqual(groups.flatMap(group => group.assertionIds).sort(),
    adopted.cases.map(test => test.id).sort());
  assert.equal(groups[0].minimumSlots, 2);
  for (const invalid of [
    [{ root: 'unknown root' }],
    [{ root: 'first root' }, { root: 'first root' }],
    [{ root: 'first root', minimumSlots: 0 }],
    [{ root: 'first root', minimumSlots: 33 }],
    [{ root: 'first root', exclusiveResources: ['same', 'same'] }],
    [{ root: 'second root', dependsOn: ['missing'] }],
    [{ root: 'second root', dependsOn: ['first root', 'first root'] }],
    [{ root: 'first root', dependsOn: ['second root'] }, { root: 'second root', dependsOn: ['first root'] }],
  ]) assert.throws(() => validationExecutionGroups(inventory(invalid)));
  assert.throws(() => validationExecutionGroups(adopted, { pattern: '^second root$' }), /missing a prerequisite/u);
  const duplicate = structuredClone(adopted);
  duplicate.cases.push(duplicate.cases[0]);
  assert.throws(() => validationExecutionGroups(duplicate), /unique adopted/u);
  assert.throws(() => discoverDeclarations("import test from 'node:test';" +
    "test('same root',()=>{});test('same root',()=>{});", file), /Duplicate executable/u);
  const events = [];
  const result = await runValidationReadyPool(groups, {
    concurrency: 3, capacity: 3, execute: async group => {
      events.push(`start:${group.root}`);
      await delay(group.root === 'first root' ? 30 : 5);
      events.push(`end:${group.root}`);
      return 'Passed';
    },
  });
  assert.equal(result.completed.size, 3);
  assert.equal(result.notRun.length, 0);
  assert.ok(events.indexOf('start:independent root') < events.indexOf('end:first root'));
  assert.ok(events.indexOf('start:second root') > events.indexOf('end:first root'));
  const failed = await runValidationReadyPool(groups, {
    concurrency: 3, capacity: 3, execute: async group => group.root === 'first root' ? 'Failed' : 'Passed',
  });
  assert.deepEqual(failed.notRun.map(group => group.root), ['second root']);
});

test('T-PRD010 same-file roots overlap in isolated processes while ordered children and hooks remain causal', async t => {
  const f = await runnerFixture(t);
  const entered = path.join(f.root, '.test-data', 'same-file-entered');
  await fs.mkdir(entered, { recursive: true });
  const file = path.join(f.root, 'test', 'same-file.test.mjs');
  const rootBody = name => `async t=>{
    assert.equal(process.env.SDLC_ROOT_HOOK,String(process.pid));
    await fs.writeFile(path.join(${JSON.stringify(entered)},${JSON.stringify(name)}),String(process.pid),{flag:'wx'});
    const deadline=Date.now()+10000;
    while((await fs.readdir(${JSON.stringify(entered)})).length<2){
      assert.ok(Date.now()<deadline,'Same-file roots did not overlap');await delay(10);
    }
    const state=path.join(${JSON.stringify(entered)},'state-'+process.pid);
    await t.test('first causal child',()=>fs.writeFile(state,'first',{flag:'wx'}));
    await t.test('second causal child',async()=>assert.equal(await fs.readFile(state,'utf8'),'first'));
  }`;
  await fs.writeFile(file, "import test from 'node:test';import assert from 'node:assert/strict';" +
    "import * as fs from 'node:fs/promises';import path from 'node:path';" +
    "import {setTimeout as delay} from 'node:timers/promises';" +
    "test.before(()=>{assert.equal(process.env.SDLC_ROOT_HOOK,undefined);process.env.SDLC_ROOT_HOOK=String(process.pid);});" +
    "test.after(()=>{assert.equal(process.env.SDLC_ROOT_HOOK,String(process.pid));delete process.env.SDLC_ROOT_HOOK;});" +
    `test('first isolated root',${rootBody('first')});test('second isolated root',${rootBody('second')});`);
  const reportPath = path.join(f.root, '.test-data', 'same-file.json');
  const result = await f.invoke(['targeted', '--workers', '2', file], { SDLC_TEST_REPORT_FILE: reportPath });
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  assert.equal(report.selection.concurrency, 2);
  assert.equal(report.groupExecution.groups.length, 2);
  assert.equal(report.groupExecution.policyDigest, validationSchedulingPolicyDigest());
  const groups = report.groupExecution.groups;
  assert.equal(new Set(groups.flatMap(group => group.processIds)).size, 2);
  assert.ok(groups.every(group => group.status === 'Passed' && group.processIds.length === 1));
  assert.ok(Date.parse(groups[0].startedAt) < Date.parse(groups[1].finishedAt) &&
    Date.parse(groups[1].startedAt) < Date.parse(groups[0].finishedAt));
  assert.equal(report.executions.length, 6);
  assert.equal(new Set(report.executions.map(row =>
    digest([row.file, row.parents, row.name]))).size, 6);
  for (const group of groups) {
    const rows = report.executions.filter(row => row.groupId === group.id);
    assert.deepEqual(rows.map(row => row.name), ['first causal child', 'second causal child', group.root]);
  }
  const journal = (await fs.readFile(`${reportPath}.journal.ndjson`, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(journal.filter(row => row.kind === 'group-start').length, 2);
  assert.equal(journal.filter(row => row.kind === 'group-end').length, 2);
  assert.ok(journal.every((row, index) => row.sequence === index + 1));
  assert.deepEqual(journal.filter(row => row.kind === 'completion').map(({ kind, ...row }) => row),
    report.executions);
  const dependentFile = path.join(f.root, 'test', 'dependent.test.mjs');
  const marker = path.join(entered, 'dependency-state');
  const independentMarker = `${marker}.independent`;
  await fs.writeFile(dependentFile, `export const validationDeclarations=${JSON.stringify({
    schemaVersion: 1, groups: [{ root: 'dependent root', dependsOn: ['prerequisite root'] }],
  })};import test from 'node:test';import assert from 'node:assert/strict';import * as fs from 'node:fs/promises';
  test('prerequisite root',async()=>{
    if(process.env.RUNNER_FAIL_DEPENDENCY)assert.fail('owned prerequisite failure');
    await fs.writeFile(${JSON.stringify(marker)},'ready',{flag:'wx'});
  });
  test('dependent root',async()=>assert.equal(await fs.readFile(${JSON.stringify(marker)},'utf8'),'ready'));
  test('independent root',()=>fs.writeFile(${JSON.stringify(independentMarker)},'finished'));
  `);
  const dependencyReport = path.join(entered, 'dependency.json');
  const healthy = await f.invoke(['targeted', '--workers', '2', dependentFile], {
    SDLC_TEST_REPORT_FILE: dependencyReport,
  });
  assert.equal(healthy.exitCode, 0, healthy.stdout + healthy.stderr);
  const dependency = JSON.parse(await fs.readFile(dependencyReport, 'utf8'));
  const prerequisite = dependency.groupExecution.groups.find(group => group.root === 'prerequisite root');
  const dependent = dependency.groupExecution.groups.find(group => group.root === 'dependent root');
  assert.ok(Date.parse(prerequisite.finishedAt) <= Date.parse(dependent.startedAt));
  await fs.unlink(marker);
  await fs.unlink(independentMarker);
  const failedReport = path.join(entered, 'dependency-failed.json');
  const failed = await f.invoke(['targeted', '--workers', '2', dependentFile], {
    SDLC_TEST_REPORT_FILE: failedReport, RUNNER_FAIL_DEPENDENCY: '1',
  });
  assert.equal(failed.exitCode, 1, failed.stdout + failed.stderr);
  const failure = JSON.parse(await fs.readFile(failedReport, 'utf8'));
  assert.equal(failure.complete, false);
  const neverStarted = failure.groupExecution.groups.find(group => group.root === 'dependent root');
  assert.equal(neverStarted.status, 'NotRun');
  assert.deepEqual(neverStarted.processIds, []);
  assert.equal(neverStarted.startedAt, null);
  assert.equal(await fs.readFile(independentMarker, 'utf8'), 'finished');
  assert.ok(!failure.executions.some(row => row.name === 'dependent root'),
    'A failed prerequisite cannot create a passing or cancelled observation for an unstarted dependent');
});

test('T-PRD011 sibling producers dynamically consume freed aggregate capacity without token multiplication', async t => {
  const f = await runnerFixture(t);
  const inheritedBudget = Boolean(process.env.SDLC_TEST_BUDGET);
  const budget = await enterTestBudget({ workers: 2, fileCount: 2, control: true });
  let independent;
  t.after(async () => {
    try { if (independent) await independent.close(); }
    finally { await budget.close(); }
  });
  independent = await enterTestBudget({ workers: 2, fileCount: 1,
    inherited: budget.inherited, parent: budget.parent, slot: null });
  const entered = path.join(f.root, '.test-data', 'dynamic-capacity');
  await fs.mkdir(entered, { recursive: true });
  const slow = path.join(f.root, 'test', 'dynamic-slow.test.mjs');
  const sibling = path.join(f.root, 'test', 'dynamic-sibling.test.mjs');
  const common = "import test from 'node:test';import assert from 'node:assert/strict';" +
    "import * as fs from 'node:fs/promises';import path from 'node:path';" +
    "import {setTimeout as delay} from 'node:timers/promises';" +
    `async function ownedReady(label){
      if(process.platform!=='win32')return;
      const ready=path.join(${JSON.stringify(entered)},label+'.ready');
      const release=path.join(${JSON.stringify(entered)},label+'.release');
      await fs.writeFile(ready+'.pending',JSON.stringify({pid:process.pid,observedAtMs:Date.now()}),{flag:'wx'});
      await fs.rename(ready+'.pending',ready);
      while(true){try{await fs.stat(release);break;}
        catch(error){if(error.code!=='ENOENT')throw error;}
        await delay(10);}
    }`;
  const runOwnedPhase = async (files, paths, labels) => {
    const monitors = new Map();
    const releases = labels.flat().map(label => path.join(entered, `${label}.release`));
    const releaseAll = () => Promise.all(releases.map(file => fs.writeFile(file, 'released')));
    const capture = process.platform !== 'win32' ? Promise.resolve(null) :
      Promise.allSettled(labels.flat().map(async label => {
        const ready = path.join(entered, `${label}.ready`);
        const deadline = Date.now() + 10000;
        let owned;
        while (!owned) {
          try { owned = JSON.parse(await fs.readFile(ready, 'utf8')); }
          catch (error) {
            if (error.code !== 'ENOENT') throw error;
            assert.ok(Date.now() < deadline, `Owned worker never reached its identity barrier: ${label}`);
            await delay(10);
          }
        }
        assert.ok(Number.isSafeInteger(owned.observedAtMs),
          'The live worker ready observation must establish its creation bound');
        const exitPath = path.join(entered, `${label}.exit.json`);
        const monitor = await windowsProcessIdentity(owned.pid, exitPath, { createdBeforeMs: owned.observedAtMs });
        monitors.set(label, { ...monitor, exitPath });
        t.diagnostic(JSON.stringify({ kind: 'owned-worker-identity-captured',
          owned: monitor.identity, capturedBeforeTrigger: true, label }));
        await fs.writeFile(path.join(entered, `${label}.release`), 'captured');
      })).then(async outcomes => {
        const failure = outcomes.find(outcome => outcome.status === 'rejected');
        if (failure) await releaseAll();
        return failure?.reason ?? null;
      });
    const producers = files.map((file, index) =>
      f.invoke(['targeted', '--workers', '2', file],
        { ...budget.environment, SDLC_TEST_REPORT_FILE: paths[index] }).then(result => {
        t.diagnostic(JSON.stringify({ kind: 'owned-producer-completed', index,
          completedAtMs: result.completedAtMs, completionClockPrecisionMs: 1,
          independentProducer: independent.parent, independentProducerActive: !independent.signal.aborted }));
        return result;
      }));
    try {
      const results = await Promise.all(producers);
      const captureError = await capture;
      if (captureError) throw captureError;
      assert.ok(results.every(result => result.exitCode === 0),
        results.map(result => result.stdout + result.stderr).join('\n'));
      const reports = await Promise.all(paths.map(async file => JSON.parse(await fs.readFile(file, 'utf8'))));
      const active = await independent.snapshot();
      assert.equal(independent.signal.aborted, false);
      assert.ok(active.producers >= 1, 'The independent producer must remain active at the owned-exit boundary');
      for (let index = 0; index < reports.length; index++) {
        for (const group of reports[index].groupExecution.groups) {
          for (const pid of group.processIds) {
            if (process.platform === 'win32') {
              const monitor = monitors.get(group.root);
              assert.ok(monitor, 'Every owned file process needs a pre-trigger creation identity');
              assert.equal(monitor.identity.pid, pid);
              const outcome = await monitor.closed;
              if (outcome.code !== 0 || outcome.signal !== null) {
                const detail = await fs.readFile(`${monitor.exitPath}.error`, 'utf8').catch(error => {
                  if (error.code === 'ENOENT') return 'Held process observer retained no error record';
                  throw error;
                });
                t.diagnostic(JSON.stringify({ kind: 'owned-worker-observation-failed',
                  owned: monitor.identity, completedAtMs: results[index].completedAtMs,
                  outcome, cause: processDiagnostic(detail) }));
              }
              assert.deepEqual(outcome, { code: 0, signal: null });
              const observed = JSON.parse(await fs.readFile(monitor.exitPath, 'utf8'));
              t.diagnostic(JSON.stringify({ kind: 'owned-worker-exit-observation',
                owned: monitor.identity, observed, completedAtMs: results[index].completedAtMs,
                completionClockPrecisionMs: 1, groupId: group.id, root: group.root,
                independentProducer: independent.parent,
                independentProducerActive: !independent.signal.aborted }));
              assertOwnedProcessExited(monitor.identity, observed, results[index].completedAtMs);
            } else {
              assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH',
                'Every owned file process is gone even when an independent producer is still active');
            }
          }
        }
      }
      return { results, reports };
    } finally {
      await capture;
      await releaseAll();
      await Promise.allSettled(producers);
      await Promise.all([...monitors.values()].map(monitor => monitor.closed));
    }
  };
  await fs.writeFile(slow, common +
    `test('waiting root',async()=>{
      await ownedReady('waiting root');
      await fs.writeFile(${JSON.stringify(path.join(entered, 'waiting'))},String(process.pid),{flag:'wx'});
      const deadline=Date.now()+10000;
      while(true){try{await fs.stat(${JSON.stringify(path.join(entered, 'sibling'))});break;}
        catch(error){if(error.code!=='ENOENT')throw error;}
        assert.ok(Date.now()<deadline,'Sibling producer could not borrow idle host capacity');await delay(10);}
    });test('short root',async()=>{await ownedReady('short root');await delay(80);});`);
  await fs.writeFile(sibling, common +
    `test('sibling ready root',async()=>{
      await ownedReady('sibling ready root');
      await fs.writeFile(${JSON.stringify(path.join(entered, 'sibling'))},String(process.pid),{flag:'wx'});
      await delay(30);
    });`);
  const paths = [path.join(entered, 'first.json'), path.join(entered, 'second.json')];
  const { reports } = await runOwnedPhase([slow, sibling], paths,
    [['waiting root', 'short root'], ['sibling ready root']]);
  assert.ok(reports.every(report => report.resources.budget.id === budget.id &&
    report.resources.budget.peakActiveWorkers <= budget.capacity));
  const waiting = reports[0].groupExecution.groups.find(group => group.root === 'waiting root');
  const other = reports[1].groupExecution.groups[0];
  assert.ok(Date.parse(other.startedAt) < Date.parse(waiting.finishedAt),
    'Independent producers share readiness capacity, not permanently divided worker branches');
  const lock = path.join(entered, 'exclusive-setup.lock');
  const exclusiveFiles = await Promise.all(['left', 'right'].map(async name => {
    const file = path.join(f.root, 'test', `exclusive-${name}.test.mjs`);
    await fs.writeFile(file, `export const validationDeclarations=${JSON.stringify({
      schemaVersion: 1, groups: [{ root: `exclusive ${name}`, exclusiveResources: ['shared-owned-device'] }],
    })};` + common +
      `test.before(async()=>{await ownedReady('exclusive ${name}');await fs.writeFile(${JSON.stringify(lock)},String(process.pid),{flag:'wx'});await delay(30);});
      test.after(()=>fs.unlink(${JSON.stringify(lock)}));
      test('exclusive ${name}',()=>{});`);
    return file;
  }));
  const exclusiveReports = exclusiveFiles.map((_, index) => path.join(entered, `exclusive-${index}.json`));
  const exclusive = await runOwnedPhase(exclusiveFiles, exclusiveReports,
    [['exclusive left'], ['exclusive right']]);
  const exclusiveGroups = exclusive.reports.map(report => report.groupExecution.groups[0]);
  const ordered = exclusiveGroups.sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt));
  assert.ok(Date.parse(ordered[0].finishedAt) <= Date.parse(ordered[1].startedAt),
    'Named resources are acquired before module hooks and are exclusive across sibling producers');
  const snapshot = await budget.snapshot();
  assert.ok(snapshot.activeWorkers <= snapshot.capacity);
  assert.ok(snapshot.residentWorkers <= snapshot.residentLimit);
  for (const group of [...reports.flatMap(report => report.groupExecution.groups), ...exclusiveGroups]) {
    assert.ok(group.processes.every(process => process.finishedAt));
  }
  await independent.close();
  independent = null;
  if (!inheritedBudget) {
    const completed = await budget.snapshot();
    assert.equal(completed.activeWorkers, 0);
    assert.equal(completed.residentWorkers, 0);
    assert.equal(completed.pendingParentRestorations, 0);
  }
});

test('T-PRD010 grouped coverage retains each actual native root report without inventing aggregate percentages', async t => {
  const f = await runnerFixture(t);
  const reportPath = path.join(f.root, '.test-data', 'coverage.json');
  const result = await f.invoke(['coverage', '--workers', '2'], { SDLC_TEST_REPORT_FILE: reportPath });
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  assert.equal(report.coverage.aggregatePercentages, false);
  assert.equal(report.coverage.groups.length, report.groupExecution.groups.length);
  assert.ok(report.groupExecution.groups.every(group => group.status === 'Passed'));
  for (const group of report.coverage.groups) {
    const bytes = await fs.readFile(path.resolve(f.root, group.reportPath));
    assert.equal(digest(bytes), group.sha256);
    assert.equal(bytes.length, group.bytes);
    const coverage = JSON.parse(bytes);
    assert.ok(coverage.files.length > 0);
    assert.deepEqual(coverage.totals, group.totals);
    assert.ok(coverage.files.some(file => file.path.startsWith(f.root)));
  }
});

test('T-PRD010 independent file workers overlap without sharing environment, module patches or fixture ownership', async t => {
  const inherited = process.env.SDLC_TEST_BUDGET ? await readTestBudget() : null;
  if (inherited && inherited.capacity < 2) { t.skip('Aggregate host allocation has fewer than two slots'); return; }
  const f = await runnerFixture(t);
  const entered = path.join(f.root, 'entered');
  await fs.mkdir(entered);
  const files = [];
  for (const id of ['first', 'second']) {
    const home = path.join(f.root, `private-${id}`);
    await fs.mkdir(home);
    const sentinel = path.join(home, 'sentinel');
    await fs.writeFile(sentinel, 'original fixture content');
    const file = path.join(f.root, 'test', `isolation-${id}.test.mjs`);
    files.push(file);
    await fs.writeFile(file, `import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
test('isolated ${id}', async t => {
  const original=fs.readFile;
  const previous=process.env.SDLC_ISOLATION_FIXTURE;
  process.env.SDLC_ISOLATION_FIXTURE='${id}';
  fs.readFile=async (file,...args)=>file===${JSON.stringify(sentinel)}?'patched-${id}':original(file,...args);
  syncBuiltinESMExports();
  t.after(()=>{
    fs.readFile=original;syncBuiltinESMExports();
    if(previous===undefined)delete process.env.SDLC_ISOLATION_FIXTURE;
    else process.env.SDLC_ISOLATION_FIXTURE=previous;
  });
  await fs.writeFile(${JSON.stringify(path.join(entered, id))},JSON.stringify({pid:process.pid}),{flag:'wx'});
  const deadline=Date.now()+20000;
  while((await fs.readdir(${JSON.stringify(entered)})).length!==2){
    assert.ok(Date.now()<deadline,'Independent workers did not reach the shared barrier');
    await delay(10);
  }
  assert.equal(process.env.SDLC_ISOLATION_FIXTURE,'${id}');
  assert.equal(await fs.readFile(${JSON.stringify(sentinel)},'utf8'),'patched-${id}');
  assert.equal(await original(${JSON.stringify(sentinel)},'utf8'),'original fixture content');
});
`);
  }
  const result = await f.invoke(['targeted', '--workers', '2', ...files]);
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  const workers = await Promise.all(['first', 'second'].map(async id =>
    JSON.parse(await fs.readFile(path.join(entered, id), 'utf8'))));
  assert.equal(new Set(workers.map(worker => worker.pid)).size, 2);
  for (const id of ['first', 'second']) assert.equal(
    await fs.readFile(path.join(f.root, `private-${id}`, 'sentinel'), 'utf8'), 'original fixture content');
});

test('T-PRD010 complete hosted units and actual implicit dispatch use the adopted expensive-first policy', async t => {
  const declarations = [
    ...unitFiles.map((file, index) => discoverDeclarations(
      `import test from 'node:test';test('canonical ${index}',()=>{});`, file)),
    discoverDeclarations("import test from 'node:test';test('unit family without local binding',()=>{});",
      'test/complete-native.unit.test.mjs'),
    discoverDeclarations("import test from 'node:test';test('T-PRD008 selected planned unit',()=>{});" +
      "test('T-PRD005 integration remainder',()=>{});", 'test/mixed.test.mjs'),
    discoverDeclarations("import test from 'node:test';test('retained expensive behavior',()=>{});",
      'test/observation-retention-refresh.test.mjs'),
    discoverDeclarations("import test from 'node:test';test('T-PRD024 measured observer tail',()=>{});",
      'test/public-readiness-observer.test.mjs'),
    discoverDeclarations("import test from 'node:test';test('retained identity acceptance through existing public consumers',()=>{});",
      'test/github-retained-identity-acceptance.test.mjs'),
    discoverDeclarations("import test from 'node:test';test('catalog independent case',()=>{});",
      'test/validation-catalog.test.mjs'),
    discoverDeclarations("import test from 'node:test';test('unchanged native launcher family',()=>{});",
      'test/winget-launcher-native.test.mjs'),
    discoverDeclarations("import test from 'node:test';test('unchanged joined release-report family',()=>{});",
      'test/public-readiness-release-report.test.mjs'),
    discoverDeclarations("import test from 'node:test';test('unchanged CI input family',()=>{});",
      'test/public-readiness-ci.test.mjs'),
    discoverDeclarations("import test from 'node:test';test('unchanged retained evidence family',()=>{});",
      'test/public-readiness-evidence.test.mjs'),
  ];
  const inventory = { complete: true, files: declarations.map(source =>
    ({ file: source.file, sourceDigest: source.sourceDigest })), cases: declarations.flatMap(source => source.cases) };
  const selected = hostedValidationSelection({ inventory, canonicalFiles: unitFiles, tests: [
    { id: 'T-PRD008', level: 'unit', mode: 'automated' },
    { id: 'T-PRD005', level: 'integration', mode: 'automated' },
    { id: 'T-PRD024', level: 'unit', mode: 'automated' },
  ] });
  assert.ok(selected.units.cases.some(test => test.name === 'unit family without local binding'));
  assert.ok(selected.units.cases.some(test => test.name === 'T-PRD008 selected planned unit'));
  assert.deepEqual(selected.regression.files.slice(0, 7), [
    'test/observation-retention-refresh.test.mjs',
    'test/public-readiness-ci.test.mjs',
    'test/public-readiness-evidence.test.mjs',
    'test/github-retained-identity-acceptance.test.mjs',
    'test/validation-catalog.test.mjs',
    'test/winget-launcher-native.test.mjs',
    'test/public-readiness-release-report.test.mjs',
  ]);
  assert.equal(selected.units.files[0], 'test/public-readiness-observer.test.mjs');
  assert.deepEqual(Object.values(selected).flatMap(stage => stage.cases.map(test => test.id)).sort(),
    inventory.cases.map(test => test.id).sort());
  assert.ok(Object.values(selected).every(stage => stage.blockers.length === 0));
  const stale = scheduleValidationFiles(inventory, { files: selected.regression.files,
    durations: [{ assertionId: selected.regression.cases.find(test => test.file === 'test/mixed.test.mjs').id,
      sourceDigest: 'foreign-source', durationMs: 999999 }] });
  assert.equal(stale[0], 'test/observation-retention-refresh.test.mjs');
  const f = await runnerFixture(t);
  const marker = path.join(f.root, '.test-data', 'actual-dispatch-order');
  for (const [file, value] of [
    ['observation-retention-refresh.test.mjs', 'retention'],
    ['github-operation-results.unit.test.mjs', 'operation'],
    ['public-readiness-observer.test.mjs', 'observer'],
    ['github-retained-identity-acceptance.test.mjs', 'retained-identity'],
    ['validation-catalog.test.mjs', 'catalog'],
    ['winget-launcher-native.test.mjs', 'native-launcher'],
    ['public-readiness-release-report.test.mjs', 'release-report'],
    ['public-readiness-ci.test.mjs', 'ci'],
    ['public-readiness-evidence.test.mjs', 'evidence'],
  ]) await fs.writeFile(path.join(f.root, 'test', file),
    "import test from 'node:test';import {appendFile} from 'node:fs/promises';" +
    `test('dispatch ${value}',()=>appendFile(${JSON.stringify(marker)},'${value}\\n'));`);
  const result = await f.invoke(['full', '--workers', '1']);
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  assert.deepEqual((await fs.readFile(marker, 'utf8')).trim().split(/\r?\n/u),
    ['retention', 'observer', 'ci', 'evidence', 'retained-identity', 'catalog',
      'native-launcher', 'release-report', 'operation']);
  const source = await fs.readFile(new URL('../scripts/test-scheduling.mjs', import.meta.url), 'utf8');
  const previous = source.replace("  'public-readiness-ci.test.mjs',\n", '')
    .replace("  'public-readiness-evidence.test.mjs',\n", '')
    .replace("schemaVersion: 5, algorithm: 'source-bound-ready-root-v5'",
      "schemaVersion: 4, algorithm: 'source-bound-ready-root-v4'");
  const middle = previous.replace("  'winget-launcher-native.test.mjs',\n", '')
    .replace("  'public-readiness-release-report.test.mjs',\n", '')
    .replace("schemaVersion: 4, algorithm: 'source-bound-ready-root-v4'",
      "schemaVersion: 3, algorithm: 'source-bound-ready-root-v3'");
  const legacy = middle.replace("  'validation-catalog.test.mjs',\n", '')
    .replace("schemaVersion: 3, algorithm: 'source-bound-ready-root-v3'",
      "schemaVersion: 2, algorithm: 'source-bound-ready-root-v2'");
  const selectedPolicy = contents => sourceValidationSchedulingPolicy([{ file: 'scripts/test-scheduling.mjs', contents }]);
  assert.equal(selectedPolicy(source), validationSchedulingPolicy);
  assert.equal(selectedPolicy(previous).schemaVersion, 4);
  assert.equal(validationSchedulingPolicyDigest(selectedPolicy(previous)),
    '2273d5335dc6b8bdb7034af1dfde42a2843c1df35345188cb97d3285d0151d64');
  assert.equal(selectedPolicy(middle).schemaVersion, 3);
  assert.equal(validationSchedulingPolicyDigest(selectedPolicy(middle)),
    '6274c99ad21f86dff3a67164c7f486bcb35cae3e9fcf67fb71deec2c72859c3f');
  assert.equal(selectedPolicy(legacy).schemaVersion, 2);
  assert.equal(validationSchedulingPolicyDigest(selectedPolicy(legacy)),
    '0217489f1d88ac4649cee4e85b81777276297c70c140e4ab9346eef2770ee6db');
  assert.notEqual(validationSchedulingPolicyDigest(selectedPolicy(legacy)), validationSchedulingPolicyDigest());
  assert.throws(() => validationSchedulingPolicyDigest({ ...validationSchedulingPolicy }), { code: 'EVIDENCE' });
  for (const changed of [
    source.replace('maxWorkers: 32', 'maxWorkers: 31'),
    source.replace("  'validation-catalog.test.mjs',\n", ''),
    source.replace("  'winget-launcher-native.test.mjs',\n", ''),
    source.replace("  'public-readiness-release-report.test.mjs',\n", ''),
    source.replace("  'public-readiness-ci.test.mjs',\n", ''),
    source.replace("  'public-readiness-evidence.test.mjs',\n", ''),
    source.replace('export const measuredFilePriorities', 'const measuredFilePriorities') +
      '\n// export const measuredFilePriorities = Object.freeze([]);\n',
    source + '\nexport const validationGroupProtocol = "forged";\n',
    source.replace('Object.freeze([', 'untrustedFactory(['),
  ]) assert.throws(() => selectedPolicy(changed), { code: 'EVIDENCE' });
});

test('T-PRD010-CATALOG catalog third root overlaps a live four-slot retained guard within seven shared slots', async t => {
  const f = await runnerFixture(t);
  const evidence = path.join(f.root, '.test-data', 'catalog-overlap');
  await fs.mkdir(evidence, { recursive: true });
  const shared = `import test from 'node:test';import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {readTestBudget,readTestGroupProcesses} from ${JSON.stringify(new URL('../scripts/test-budget.mjs', import.meta.url).href)};
const root=${JSON.stringify(evidence)};
const wait=async predicate=>{const end=performance.now()+15000;while(!await predicate()){
  assert.ok(performance.now()<end,'Owned overlap barrier expired');await delay(10);}};
const exists=async name=>fs.stat(path.join(root,name)).then(()=>true,error=>{
  if(error.code!=='ENOENT')throw error;return false;});
const entered=async name=>{
  const encoded=process.execArgv.find(value=>value.startsWith('--conditions=sdlc-group-'));
  assert.ok(encoded);
  const group=JSON.parse(Buffer.from(encoded.slice('--conditions=sdlc-group-'.length),'base64url').toString('utf8'));
  const leases=await readTestGroupProcesses(group.id);
  const lease=leases.find(value=>value.pid===process.pid&&value.slot===process.env.SDLC_TEST_BUDGET_SLOT);
  assert.ok(lease);assert.equal(lease.finishedAt,null);assert.equal(lease.minimumSlots,group.minimumSlots);
  const budget=await readTestBudget();
  const pending=path.join(root,name+'.pending');
  await fs.writeFile(pending,JSON.stringify({pid:process.pid,time:Date.now(),group,lease,
    producer:process.env.SDLC_TEST_BUDGET_PRODUCER,budgetId:budget.id,globalCapacity:budget.capacity}),{flag:'wx'});
  await fs.rename(pending,path.join(root,name));
};
`;
  await fs.writeFile(path.join(f.root, 'test', 'github-retained-identity-acceptance.test.mjs'),
    'export const validationDeclarations={"schemaVersion":1,"groups":[{"root":"retained guard","minimumSlots":4}]};\n' +
    shared + `test('retained guard',async()=>{
      await entered('retained-entered');
      await wait(async()=>await exists('catalog-0')&&await exists('catalog-1')&&await exists('catalog-2'));
      await wait(()=>exists('release-retained'));
      await entered('retained-finished');
    });`);
  await fs.writeFile(path.join(f.root, 'test', 'validation-catalog.test.mjs'), shared +
    [0, 1, 2].map(index => `test('catalog ${index}',async()=>{
      await wait(()=>exists('retained-entered'));await entered('catalog-${index}');
      await wait(()=>exists('retained-finished'));
    });`).join('\n'));
  const reportPath = path.join(f.root, '.test-data', 'catalog-overlap.json');
  const initial = await readTestBudget();
  const files = [path.join(f.root, 'test', 'github-retained-identity-acceptance.test.mjs'),
    path.join(f.root, 'test', 'validation-catalog.test.mjs')];
  const args = ['targeted', '--workers', '7', ...files];
  const planned = await createPlan(parseOptions(args), f.root);
  assert.equal(planned.groups.length, 4);
  assert.equal(planned.groups.reduce((sum, group) => sum + group.minimumSlots, 0), 7);
  const controller = new AbortController();
  const signal = AbortSignal.any([t.signal, controller.signal]);
  const timer = setTimeout(() => controller.abort(new Error('Owned overlap observation expired')), 15000);
  let nested;
  const wait = async predicate => {
    const deadline = performance.now() + 15000;
    while (!await predicate()) {
      signal.throwIfAborted();
      assert.ok(performance.now() < deadline, 'Owned overlap observation expired');
      await delay(10, undefined, { signal });
    }
  };
  const exists = name => fs.stat(path.join(evidence, name)).then(() => true, error => {
    if (error.code !== 'ENOENT') throw error;
    return false;
  });
  try {
    nested = executeValidationCommand({ name: 'catalog-overlap', command: process.execPath,
      args: [path.join(f.root, 'scripts', 'test-runner.mjs'), ...args], cwd: f.root,
      environment: { ...process.env, SDLC_TEST_REPORT_FILE: reportPath }, outputDir: evidence, signal });
    await wait(async () => await exists('retained-entered') && await exists('catalog-0') &&
      await exists('catalog-1') && await exists('catalog-2'));
    const occupied = await readTestBudget();
    assert.equal(occupied.id, initial.id);
    assert.equal(occupied.capacity, initial.capacity);
    const live = await Promise.all(['retained-entered','catalog-0','catalog-1','catalog-2']
      .map(async name => JSON.parse(await fs.readFile(path.join(evidence, name), 'utf8'))));
    assert.equal(new Set(live.map(item => item.pid)).size, 4);
    assert.equal(new Set(live.map(item => item.producer)).size, 1);
    assert.equal(new Set(live.map(item => item.group.id)).size, 4);
    assert.equal(new Set(live.map(item => item.lease.slot)).size, 4);
    for (const item of live) {
      const expected = planned.groups.find(group => group.id === item.group.id);
      assert.ok(expected);
      for (const field of ['minimumSlots', 'exclusiveResources']) {
        assert.deepEqual(item.group[field], expected[field]);
      }
      assert.equal(item.lease.pid, item.pid);
      assert.equal(item.lease.minimumSlots, expected.minimumSlots);
      assert.equal(item.lease.finishedAt, null);
      assert.equal(item.budgetId, initial.id);
      assert.equal(item.globalCapacity, initial.capacity);
    }
    assert.equal(live.reduce((sum, item) => sum + item.lease.minimumSlots, 0), 7,
      'Only these participants own four plus three live slots; global spare capacity is not reserved');
    await fs.writeFile(path.join(evidence, 'release-retained'), 'release', { flag: 'wx' });
    const result = await nested;
    signal.throwIfAborted();
    assert.equal(result.complete, true, 'The nested command must finish evidence finalization without cancellation');
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    for (const group of report.groupExecution.groups) {
      const expected = planned.groups.find(item => item.id === group.id);
      assert.ok(expected);
      for (const field of ['rootId', 'file', 'sourceDigest']) assert.deepEqual(group[field], expected[field]);
    }
    const retained = report.groupExecution.groups.find(group => group.root === 'retained guard');
    const catalog = report.groupExecution.groups.filter(group => /^catalog [012]$/u.test(group.root));
    assert.equal(retained.minimumSlots, 4);
    assert.equal(catalog.length, 3);
    assert.equal(retained.minimumSlots + catalog.reduce((sum, group) => sum + group.minimumSlots, 0), 7);
    assert.ok(catalog.every(group => group.minimumSlots === 1 &&
      Date.parse(group.startedAt) < Date.parse(retained.finishedAt)));
    const observed = await Promise.all(['retained-entered','catalog-0','catalog-1','catalog-2','retained-finished']
      .map(async name => JSON.parse(await fs.readFile(path.join(evidence,name),'utf8'))));
    assert.equal(new Set(observed.slice(0,4).map(item=>item.pid)).size,4);
    assert.ok(observed.slice(1,4).every(item=>item.time<=observed[4].time));
    assert.equal(report.resources.budget.id, initial.id);
    assert.equal(report.resources.budget.capacity, initial.capacity);
    assert.ok(report.resources.budget.peakActiveWorkers <= initial.capacity);
    t.diagnostic(JSON.stringify({ sharedBudgetId: initial.id, globalCapacity: initial.capacity,
      participantSlots: 7, retainedSlots: 4, catalogSlots: 3, participantProcesses: 4,
      noOutsideReservation: true, participants: live.map(item => ({
        groupId: item.group.id, sourceDigest: planned.groups.find(group => group.id === item.group.id).sourceDigest,
        file: planned.groups.find(group => group.id === item.group.id).file,
        minimumSlots: item.lease.minimumSlots, pid: item.pid, slot: item.lease.slot,
        startedAt: item.lease.startedAt, finishedAt: item.lease.finishedAt,
      })) }));
  } finally {
    clearTimeout(timer);
    await fs.writeFile(path.join(evidence, 'release-retained'), 'release');
    controller.abort();
    if (nested) await nested.catch(() => {});
  }
});

test('T-PRD010 nested producers retain one aggregate budget, queued work and ordered real file outcomes', async t => {
  const inherited = process.env.SDLC_TEST_BUDGET ? await readTestBudget() : null;
  if (inherited && inherited.capacity < 2) { t.skip('Aggregate host allocation has fewer than two slots'); return; }
  const f = await runnerFixture(t);
  const evidence = path.join(f.root, '.test-data', 'nested-resource-contract');
  await fs.mkdir(evidence, { recursive: true });
  const outerFiles = [];
  for (const id of ['first', 'second', 'third', 'fourth']) {
    const entered = path.join(evidence, `entered-${id}`);
    await fs.mkdir(entered);
    const leafFiles = [];
    for (const index of [0, 1]) {
      const state = path.join(evidence, `${id}-${index}.state`);
      const file = path.join(f.root, 'test', `leaf-${id}-${index}.test.mjs`);
      leafFiles.push(file);
      await fs.writeFile(file, `import test from 'node:test';
import assert from 'node:assert/strict';import * as fs from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
test('leaf ${id}-${index}',async t=>{
  await fs.writeFile(${JSON.stringify(path.join(entered, String(index)))},String(process.pid),{flag:'wx'});
  const deadline=Date.now()+20000;
  while((await fs.readdir(${JSON.stringify(entered)})).length!==2){
    assert.ok(Date.now()<deadline,'Two reserved file workers never overlapped');await delay(10);
  }
  await t.test('first causal state',()=>fs.writeFile(${JSON.stringify(state)},'first',{flag:'wx'}));
  await t.test('second causal state',async()=>{
    assert.equal(await fs.readFile(${JSON.stringify(state)},'utf8'),'first');
    await fs.writeFile(${JSON.stringify(state)},'second');
  });
});`);
    }
    const file = path.join(f.root, 'test', `outer-${id}.test.mjs`);
    const innerReport = path.join(evidence, `inner-${id}.json`);
    outerFiles.push(file);
    await fs.writeFile(file, `export const validationDeclarations=${JSON.stringify({
      schemaVersion: 1, resources: { workers: 2, owner: 'owned-nested-fixture',
        reason: 'Two actual file-worker overlap assertions are required' },
    })};
import test from 'node:test';import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
test('outer ${id}',async()=>{
  const execute=promisify(execFile);
  await execute(process.execPath,${JSON.stringify([path.join(f.root, 'scripts', 'test-runner.mjs'),
    'targeted', '--workers', '2', ...leafFiles])},{
    cwd:${JSON.stringify(f.root)},env:{...process.env,SDLC_TEST_REPORT_FILE:${JSON.stringify(innerReport)}},
    maxBuffer:4*1024*1024
  });
});`);
  }
  const outerReport = path.join(evidence, 'outer.json');
  const result = await f.invoke(['targeted', '--workers', '2', ...outerFiles],
    { SDLC_TEST_REPORT_FILE: outerReport });
  assert.equal(result.exitCode, 0, result.stdout + result.stderr);
  const report = JSON.parse(await fs.readFile(outerReport, 'utf8'));
  const identity = inherited?.id ?? report.resources.budget.id;
  assert.equal(report.resources.budget.id, identity);
  assert.equal(report.selection.concurrency, 2);
  assert.equal(report.executions.length, 4, 'More queued files than producer slots must still finish');
  for (const id of ['first', 'second', 'third', 'fourth']) {
    const inner = JSON.parse(await fs.readFile(path.join(evidence, `inner-${id}.json`), 'utf8'));
    assert.equal(inner.complete, true);
    assert.equal(inner.resources.budget.id, identity, 'Nested producers cannot allocate a fresh independent budget');
    assert.equal(inner.selection.concurrency, 2);
    assert.ok(inner.resources.budget.peakActiveWorkers <= inner.resources.budget.capacity);
    assert.ok(inner.resources.budget.peakPotentialResidentWorkers <= inner.resources.budget.residentLimit);
    assert.ok(inner.resources.budget.peakProducers <= inner.resources.budget.producerLimit);
    const pids = await Promise.all([0, 1].map(async index =>
      Number(await fs.readFile(path.join(evidence, `entered-${id}`, String(index)), 'utf8'))));
    assert.equal(new Set(pids).size, 2);
    for (const index of [0, 1]) assert.equal(
      await fs.readFile(path.join(evidence, `${id}-${index}.state`), 'utf8'), 'second');
    const leaves = inner.executions.filter(test => test.name === 'second causal state');
    assert.equal(leaves.length, 2);
    assert.ok(inner.executions.every(test => Number.isFinite(test.durationMs) && test.durationMs >= 0));
  }
});
