import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { canonical, digest } from '../src/core.mjs';
import { observerApiFixture } from './readiness-observer-fixture.mjs';
import { inspectWorkflowTrust, verifyOriginalNativeRows, verifyNativeCleanup,
  retainObserverResult } from '../scripts/pr-observer.mjs';
import { nativePrPartsForProtocol, nativeWorkflowContract,
  nativeFrameworkShardProtocol, nativeFourBodyFrameworkShardProtocol,
  nativePlatformUnitFrameworkShardProtocol, nativeLegacyFrameworkShardProtocol,
  nativeFrameworkShardPlan, replayNativeEvidence, verifyNativeShardUnitOrder } from '../scripts/native-validation.mjs';
import { nativeUnitBootstrapProtocol, nativeBodyBootstrapProtocol,
  nativeBootstrapProtocol } from '../scripts/toolchain-baseline.mjs';
import { deriveNativeComponentSpecification, projectNativeComponentEvidence,
  replayNativeComponentEvidence } from '../scripts/native-components.mjs';
import { normalizeExecutionReport, evaluateReadiness } from 'ai-sdlc-framework/evidence';
import { calculatorFiles } from '../scripts/pr-calculator.mjs';

export const protocolPairs = Object.freeze([[nativeFrameworkShardProtocol, null],
  [nativeFourBodyFrameworkShardProtocol, null],
  [nativePlatformUnitFrameworkShardProtocol, null], [nativeLegacyFrameworkShardProtocol, null],
  [nativeFourBodyFrameworkShardProtocol, 'native-bootstrap-role-capabilities-v2'],
  [nativeFrameworkShardProtocol, 'native-bootstrap-role-capabilities-v3'],
  [nativeFourBodyFrameworkShardProtocol, nativeUnitBootstrapProtocol],
  [nativeFrameworkShardProtocol, 'native-bootstrap-role-capabilities-v2'],
  [nativeFrameworkShardProtocol, nativeUnitBootstrapProtocol],
  [nativeFrameworkShardProtocol, nativeBodyBootstrapProtocol],
  [nativeFourBodyFrameworkShardProtocol, nativeBodyBootstrapProtocol],
  [nativePlatformUnitFrameworkShardProtocol, nativeBodyBootstrapProtocol],
  [nativeLegacyFrameworkShardProtocol, nativeBodyBootstrapProtocol],
  [nativeFrameworkShardProtocol, nativeBootstrapProtocol],
  [nativeFourBodyFrameworkShardProtocol, nativeBootstrapProtocol],
  [nativePlatformUnitFrameworkShardProtocol, nativeBootstrapProtocol],
  [nativeLegacyFrameworkShardProtocol, nativeBootstrapProtocol]].map(pair => Object.freeze(pair)));

// SDK verifier capabilities and every causal assertion stay in the same child.
export async function runProtocolRow(t, [shardProtocol, bootstrapProtocol]) {
  const f = await observerApiFixture(t, { frameworkShards: true, shardProtocol, bootstrapProtocol,
    ambient: shardProtocol === nativeFrameworkShardProtocol, rootParent: t.fixtureParent });
  const expectedCount = nativePrPartsForProtocol(shardProtocol).length;
  const frameworkCount = expectedCount - 2;
  assert.equal(f.parts.size, expectedCount);
  assert.equal(expectedCount, shardProtocol === nativeFrameworkShardProtocol ? 25 :
    shardProtocol === nativeFourBodyFrameworkShardProtocol ? 24 : 20);
  const trust = inspectWorkflowTrust([{ file: nativeWorkflowContract.path,
    contents: f.source.files.get(nativeWorkflowContract.path) }]);
  assert.equal(trust.complete, true, JSON.stringify(trust.blockers));
  assert.equal(trust.nativeProtocol, shardProtocol);
  const dictionary = entries => ({ ...Object.fromEntries(entries),
    texts: Object.fromEntries([...entries].map(([file, value]) =>
      [file, typeof value === 'string' ? value : canonical(value)])) });
  const sourceFiles = [...f.source.files].map(([file, contents]) => ({ file, contents }));
  const prefixes = [];
  for (const part of f.parts.values()) {
    await verifyOriginalNativeRows({ data: dictionary(part.data), raw: part.data.get('execution.json'),
      specification: part.specification, inventory: f.source.inventory, goSources: f.source.goSources,
      target: part.target, component: part.component, shard: part.shard, shardProtocol,
      candidate: f.candidate, sourceFiles, plan: f.source.plan, context: part.context, bootstrapProtocol });
    if (f.cleanupReports.has(part.role)) {
      const cleanup = verifyNativeCleanup(dictionary(f.cleanupReports.get(part.role)),
        { inventory: f.source.inventory, plan: f.source.plan,
          ...part, bootstrapProtocol, shardProtocol, jobKey: part.jobKey });
      if (cleanup.prefix) prefixes.push(cleanup.prefix);
      else assert.equal(cleanup.status, 'not-required');
    }
  }
  const expectedMacCount = [nativeBodyBootstrapProtocol, nativeBootstrapProtocol].includes(bootstrapProtocol) ? 2 :
    bootstrapProtocol === nativeUnitBootstrapProtocol ? 8 :
    shardProtocol === nativeFrameworkShardProtocol ? 13 : 12;
  assert.equal(prefixes.length, expectedMacCount);
  assert.equal(new Set(prefixes).size, expectedMacCount);
  assert.equal(f.cleanupReports.size, shardProtocol === nativeFrameworkShardProtocol ? 13 : 12);
  const executions = [...f.parts.values()].map(part => ({ ...part,
    job: f.jobs.find(job => job.name === `native-${part.role}`) }));
  const unitOrder = verifyNativeShardUnitOrder(executions, { protocol: shardProtocol });
  if (shardProtocol === nativePlatformUnitFrameworkShardProtocol) {
    const staggered = executions.map(part => ({ ...part, job: structuredClone(part.job) }));
    staggered.find(part => part.target === 'macos-x64' && part.shard === 'units').job.completed_at =
      '2026-10-18T10:01:50.000Z';
    for (const part of staggered.filter(part => part.target === 'macos-x64' &&
      part.shard && part.shard !== 'units')) part.job.started_at = '2026-10-18T10:02:00.000Z';
    assert.equal(verifyNativeShardUnitOrder(staggered, { protocol: shardProtocol }).protocol, shardProtocol);
    assert.throws(() => verifyNativeShardUnitOrder(staggered, { protocol: nativeLegacyFrameworkShardProtocol }),
      { code: 'EVIDENCE' });
  }
  const framework = executions.filter(part => part.component === 'framework');
  const definition = deriveNativeComponentSpecification({ inventory: f.source.inventory,
    testPlan: f.source.plan, goSources: f.source.goSources, frameworkShards: true, shardProtocol, bootstrapProtocol,
    adapterSourceDigest: digest(f.source.files.get('scripts/native-components.mjs')) });
  const originals = framework.map(part => ({ target: part.target, role: part.role,
    text: canonical(part.data.get('execution.json')) }));
  const nativeEvaluations = framework.map(part => {
    const original = originals.find(original => original.role === part.role);
    const raw = JSON.parse(original.text);
    const normalized = normalizeExecutionReport(original.text, part.context, input => ({
      verifierId: 'controlled-shard-sdk-facts', reportDigest: input.reportDigest, context: part.context,
      sourceTime: raw.observedAt, sourceSequence: raw.sequence,
    }));
    return { role: part.role, evaluation: evaluateReadiness(part.specification, [normalized], {
      profile: part.specification.profile, executions: [{ id: part.context.jobRef, context: part.context }],
      now: '2026-10-18T10:10:00.000Z',
      policy: { maxAgeMs: 86400000, revisionPolicy: 'exact', verifierIds: ['controlled-shard-sdk-facts'] },
    }) };
  });
  const inputs = { definition, expectedLanes: framework, originals, unitOrder, nativeEvaluations,
    now: '2026-10-18T10:10:00.000Z', verifyOriginal: input => {
      const original = originals.find(original => original.role === input.role);
      const raw = original && JSON.parse(original.text);
      return raw && input.reportDigest === digest(original.text) ? {
        verifierId: 'controlled-shard-originals', reportDigest: input.reportDigest, context: raw.context,
        sourceTime: raw.observedAt, sourceSequence: raw.sequence,
      } : null;
    } };
  const projection = projectNativeComponentEvidence(inputs);
  assert.equal(projection.evaluation.status, 'Passed');
  assert.equal(definition.policy.protocol, shardProtocol === nativeFrameworkShardProtocol ?
    'native-component-projection-shards-v3' : shardProtocol === nativeFourBodyFrameworkShardProtocol ?
      'native-component-projection-shards-v2' : 'native-component-projection-shards-v1');
  assert.equal(projection.provenance.length, frameworkCount);
  assert.ok(projection.originals.every(original =>
    JSON.parse(original.text).context.native.toolchain.matrix.length === frameworkCount &&
    JSON.parse(original.text).context.native.kind === 'metadata'));
  assert.equal(replayNativeComponentEvidence({ ...inputs, bundle: projection.bundle }).evaluation.status, 'Passed');
  assert.equal(projectNativeComponentEvidence({ ...inputs, originals: originals.slice(0, -1) }).evaluation.status, 'NotRun');
  assert.equal(projectNativeComponentEvidence({ ...inputs,
    originals: [...originals.slice(1), originals[1]] }).evaluation.status, 'NotRun');
  assert.throws(() => projectNativeComponentEvidence({ ...inputs,
    unitOrder: JSON.parse(JSON.stringify(unitOrder)) }), { code: 'EVIDENCE' });
  assert.throws(() => projectNativeComponentEvidence({ ...inputs,
    nativeEvaluations: JSON.parse(JSON.stringify(nativeEvaluations)) }), { code: 'EVIDENCE' });
  const borrowedFacts = [...nativeEvaluations];
  borrowedFacts[1] = { ...borrowedFacts[1], evaluation: borrowedFacts[0].evaluation };
  assert.throws(() => projectNativeComponentEvidence({ ...inputs, nativeEvaluations: borrowedFacts }), { code: 'EVIDENCE' });
  const changedOriginals = originals.map(original => ({ ...original }));
  const changedRaw = JSON.parse(changedOriginals[0].text);
  changedRaw.results[0].detail = 'Different original bytes with the same claimed passing outcome';
  changedOriginals[0].text = canonical(changedRaw);
  assert.throws(() => projectNativeComponentEvidence({ ...inputs, originals: changedOriginals,
    verifyOriginal: input => {
      const original = changedOriginals.find(original => original.role === input.role);
      const raw = JSON.parse(original.text);
      return { verifierId: 'controlled-changed-original', reportDigest: digest(original.text),
        context: raw.context, sourceTime: raw.observedAt, sourceSequence: raw.sequence };
    } }), { code: 'EVIDENCE' });
  const refresh = framework.find(part => part.shard === 'refresh' &&
    (bootstrapProtocol === null || part.target === 'macos-arm64'));
  const archived = { schemaVersion: 1, kind: 'native-validation-definition',
    ...(bootstrapProtocol === null ? {} : { bootstrapProtocol }),
    target: refresh.target, profile: 'pr', component: 'framework', shard: 'refresh',
    frameworkShards: shardProtocol, selectedWorkersRequest: null,
    sourceFiles, plan: f.source.plan, inventory: f.source.inventory, goSources: f.source.goSources,
    calculatorSources: sourceFiles.filter(source => calculatorFiles.includes(source.file)),
    specification: refresh.specification,
    stages: nativeFrameworkShardPlan({ inventory: f.source.inventory, plan: f.source.plan,
      target: refresh.target, protocol: shardProtocol }).parts.find(part => part.shard === 'refresh').stages,
    configDigest: refresh.context.configDigest, testSpecDigest: refresh.context.testSpecDigest,
    inventoryDigest: refresh.context.inventoryDigest,
    source: { revision: f.revisions.merge, treeSha: f.source.sha, repositoryId: 'repository-17' } };
  const replay = await replayNativeEvidence({ definition: archived, data: dictionary(refresh.data),
    candidate: f.candidate, asOf: inputs.now, verifyArchive: input => ({
      verifierId: 'controlled-current-shard-archive', definitionDigest: input.definitionDigest,
      reportDigest: input.reportDigest, context: refresh.context,
      sourceTime: refresh.data.get('execution.json').observedAt, sourceSequence: 1,
    }) });
  assert.equal(replay.evaluation.status, 'Passed');
  assert.equal(replay.currentCredit, 'NotRun', 'Historical shard replay must never grant current-candidate credit');
  if ([nativeUnitBootstrapProtocol, nativeBodyBootstrapProtocol, nativeBootstrapProtocol].includes(bootstrapProtocol)) {
    for (const file of ['native-homebrew-prefix-allocation.json', 'native-homebrew-prefix-cleanup.json']) {
      const invented = new Map(refresh.data);
      invented.set(file, { status: 'Passed', prefix: '/opt/abcde' });
      await assert.rejects(verifyOriginalNativeRows({ data: dictionary(invented),
        raw: refresh.data.get('execution.json'), specification: refresh.specification,
        inventory: f.source.inventory, goSources: f.source.goSources, target: refresh.target,
        component: refresh.component, shard: refresh.shard, shardProtocol, candidate: f.candidate,
        sourceFiles, plan: f.source.plan, context: refresh.context, bootstrapProtocol }), { code: 'EVIDENCE' });
    }
  }
  if (bootstrapProtocol !== null) {
    const changed = structuredClone(archived);
    delete changed.bootstrapProtocol;
    await assert.rejects(replayNativeEvidence({ definition: changed, data: dictionary(refresh.data),
      candidate: f.candidate, asOf: inputs.now,
      verifyArchive: () => { throw new Error('Source capability mismatch must fail before archive verification'); } }),
    { code: 'EVIDENCE' });
  }
  await assert.rejects(replayNativeEvidence({ definition: { ...archived,
    frameworkShards: shardProtocol === nativeFrameworkShardProtocol ?
      nativePlatformUnitFrameworkShardProtocol : nativeFrameworkShardProtocol },
    data: dictionary(refresh.data), candidate: f.candidate, asOf: inputs.now,
    verifyArchive: () => { throw new Error('Protocol mismatch must fail before archive verification'); } }),
  { code: 'EVIDENCE' });
  assert.throws(() => verifyNativeShardUnitOrder(executions, { protocol:
    shardProtocol === nativeFrameworkShardProtocol ? nativePlatformUnitFrameworkShardProtocol :
      nativeFrameworkShardProtocol }), { code: 'EVIDENCE' });
  const borrowed = new Map(refresh.data);
  const units = framework.find(part => part.target === refresh.target && part.shard === 'units');
  borrowed.set('unit.json', units.data.get('unit.json'));
  await assert.rejects(verifyOriginalNativeRows({ data: dictionary(borrowed), raw: refresh.data.get('execution.json'),
    specification: refresh.specification, inventory: f.source.inventory, goSources: f.source.goSources,
    target: refresh.target, component: refresh.component, shard: refresh.shard, shardProtocol,
    candidate: f.candidate, sourceFiles, plan: f.source.plan, context: refresh.context }), { code: 'EVIDENCE' });
  const cleanup = structuredClone(f.cleanupReports.get('macos-arm64-framework-units'));
  if (cleanup.has('native-homebrew-prefix-cleanup.json')) cleanup.get('native-homebrew-prefix-cleanup.json').status = 'rolled-back';
  else cleanup.set('native-homebrew-prefix-cleanup.json', { status: 'removed', prefix: '/opt/abcde' });
  const macUnits = f.parts.get('macos-arm64-framework-units');
  assert.throws(() => verifyNativeCleanup(dictionary(cleanup),
    { ...macUnits, jobKey: macUnits.jobKey }), { code: 'EVIDENCE' });
  const output = path.join(f.root, 'versioned-parts-retained');
  const nativeParts = executions.map(part => {
    const artifact = f.artifacts.get(part.role);
    const bootstrap = f.artifacts.get(`bootstrap-${part.role}`);
    const cleanup = f.artifacts.get(`cleanup-${part.role}`);
    return { target: part.target, component: part.component, role: part.role,
      ...(part.shard === null ? {} : { shard: part.shard }),
      jobId: part.job.id, runId: f.run.id, attempt: 1,
      artifactId: artifact.id, artifactDigest: artifact.digest,
      bootstrapArtifactId: bootstrap.id, bootstrapArtifactDigest: bootstrap.digest,
      ...(cleanup ? { cleanupArtifactId: cleanup.id, cleanupArtifactDigest: cleanup.digest } : {}) };
  });
  const sourceArtifacts = nativeParts.filter(part => part.component === 'framework').map(part => ({
    target: part.target, role: part.role, artifactId: part.artifactId,
    artifactDigest: part.artifactDigest, jobId: part.jobId, runId: part.runId, attempt: part.attempt,
  }));
  await retainObserverResult({ status: 'Passed', results: [] }, output, { componentEvidence: [{
    prNumber: 1, sourceCommit: f.revisions.merge, projection, nativeParts, sourceArtifacts,
  }] });
  const retained = JSON.parse(await fs.readFile(path.join(output, 'observer-result.json'), 'utf8')).components[0];
  assert.equal(retained.nativeOriginals.length, frameworkCount);
  assert.equal(new Set(retained.nativeOriginals.map(original => original.filename)).size, frameworkCount);
  assert.ok(retained.unitOrder.filename.endsWith('-unit-order.json'));
  assert.equal(f.calls.length, 0, 'No native tools, provider acquisition or Python reader runs in this Node-only regression');
  return { fixtureRoot: f.root };
}
