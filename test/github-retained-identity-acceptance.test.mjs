export const validationDeclarations = {
  "schemaVersion": 1,
  "deferred": {"declaration": "test", "dispatch": "parent", "parent": "retained identity acceptance through existing public consumers"},
  "groups": [{
    "root": "retained identity acceptance through existing public consumers",
    "minimumSlots": 4
  }]
};
import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  createGitHubConnection, createGitHubExecutionAdapter, createGitHubHost,
  createGitHubStore, createGitHubTransport, registerGitHubAdapter, requireGitHubCapture,
} from 'ai-sdlc-framework/github';
import { providerAdapterIds, verifyProviderLink } from '../src/provider-adapters.mjs';
import {
  attachMonitor, associateMonitor, beginPoll, claimMonitor, observeMonitor,
  readMonitor, verifyMonitorLink,
} from '../src/monitors.mjs';
import { verifyReferencedEvidence } from '../src/monitor-evidence.mjs';
import { adoptPr } from '../src/pr.mjs';
import { runCli, humanOutput } from '../src/cli.mjs';
import { evaluatePolicy } from '../src/policy.mjs';
import { digest, SdlcError } from '../src/core.mjs';
import { fixture, grant, orient } from './helpers.mjs';
import {
  bridgeFixture as acquiredBridgeFixture, connectionId, durableBytes, remote, repositoryRef,
} from './fixtures/github-store-bridge.mjs';

const base = '/repos/bridge-owner/bridge-repo';
const web = 'https://github.com/bridge-owner/bridge-repo';
const identity = Object.freeze({
  provider: 'github', connection: connectionId, scopeRef: repositoryRef,
  definitionRef: '301', executionRef: '401', attemptKind: 'known', attemptRef: '2',
});
const sameAttemptReason =
  'GitHub metadata or final page does not identify the observed repository, run and exact attempt';
const verifiersOf = f => Object.fromEntries(Object.entries(f.bridge.storeOptions())
  .filter(([, value]) => typeof value === 'function'));

async function bridgeFixture(t) {
  const started = process.hrtime.bigint();
  const f = await acquiredBridgeFixture(t);
  t.diagnostic(JSON.stringify({
    kind: 'retained-bridge-setup',
    phase: 'fixture-and-bridge-setup',
    elapsedMs: Number(process.hrtime.bigint() - started) / 1e6,
  }));
  f.repositoryInput = { ...f.repositoryInput, observedAt: new Date(f.clock.now()).toISOString() };
  return f;
}

async function unchanged(f, call, code) {
  const before = await durableBytes(f);
  await assert.rejects(call, { code });
  assert.deepEqual(await durableBytes(f), before);
}

async function permissionDenied(f, call, route) {
  const before = await durableBytes(f);
  const firstCall = f.calls.length;
  f.denyNext(route);
  await assert.rejects(call, error => {
    assert.equal(error.code, 'PERMISSION');
    assert.equal(error.details.status, 403);
    assert.equal(error.details.connectionId, connectionId);
    assert.equal(error.details.dispatched, true);
    return true;
  });
  assert.deepEqual(f.calls.slice(firstCall).filter(call => call.denied),
    [{ key: `GET ${route}`, denied: true }]);
  assert.deepEqual(await durableBytes(f), before);
}

async function monitorFixture(t) {
  const f = await fixture(t, { initialize: false, compactPath: true });
  const repository = {
    id: 101, node_id: 'R_101', name: 'bridge-repo', full_name: 'bridge-owner/bridge-repo',
    owner: { login: 'bridge-owner' }, html_url: web,
  };
  const run = Object.freeze({
    id: 401, workflow_id: 301, run_attempt: 2, repository, html_url: `${web}/actions/runs/401`,
  });
  const connection = createGitHubConnection({
    id: connectionId, apiOrigin: 'https://api.github.com', webOrigin: 'https://github.com',
    scopes: [{ kind: 'repository', id: '101', owner: 'bridge-owner', name: 'bridge-repo' }],
  });
  const route = `${base}/actions/runs/401/attempts/2`;
  let status = 200;
  f.calls = [];
  const transport = createGitHubTransport({ connection, fetch: async (url, input) => {
    assert.equal(url, `https://api.github.com${route}`);
    assert.equal(input.method, 'GET');
    f.calls.push({ url, method: input.method });
    return new Response(JSON.stringify(status === 200 ? run : { message: 'Permission denied' }),
      { status, headers: { 'content-type': 'application/json' } });
  } });
  f.acquireRun = async () => {
    const capture = await transport.execute(transport.buildRestRequest({
      method: 'GET', path: route, profile: '2026-03-10', mediaType: 'application/vnd.github+json',
      expectedStatuses: [200], proofScope: repositoryRef, tokenClasses: ['anonymous'],
    }));
    requireGitHubCapture(capture, connection);
    return structuredClone(capture.body);
  };
  f.denyRun = () => { status = 403; };
  const pages = new Map([[`${web}/actions/runs/401/attempts/2`,
    Object.freeze({ accessible: true, finalUrl: `${web}/actions/runs/401/attempts/2` })]]);
  let pageAllowed = true;
  f.pageReads = 0;
  f.pageTool = async url => {
    if (!pageAllowed) throw new SdlcError('AUTHORITY', 'Human-page host permission denied',
      { scopeRef: repositoryRef, executionRef: '401', attemptRef: '2', effect: 'no-read-effect' });
    f.pageReads++;
    assert.equal(pages.has(url), true);
    return structuredClone(pages.get(url));
  };
  f.denyPage = () => { pageAllowed = false; };
  f.link = async () => ({
    connection: connectionId, run: await f.acquireRun(),
    access: await f.pageTool(`${web}/actions/runs/401/attempts/2`),
  });
  if (!providerAdapterIds().includes('github')) registerGitHubAdapter();
  f.monitor = await attachMonitor(f.store, {
    identity, origin: 'framework', schedulerAvailable: true, readAvailable: true,
  });
  return f;
}

const cases = [];
const test = (name, body) => { cases.push({ name, body }); };

test('T-GHC01-P exact repository workflow run and selected attempt enter the real monitor', async t => {
  const f = await monitorFixture(t);
  const result = await verifyMonitorLink(f.store, {
    runKey: f.monitor.key, adapterId: 'github', observation: await f.link(), evidenceRef: 'fixture:attempt-2',
  });
  assert.deepEqual(result.identity, identity);
  assert.equal(result.link.status, 'verified');
  assert.equal(result.link.url, `${web}/actions/runs/401/attempts/2`);
  assert.deepEqual((await readMonitor(f.store, result.key)).identity, identity);
  assert.equal(result.runStatus, 'unknown');
  assert.equal(f.calls.length, 1);
  assert.equal(f.pageReads, 1);
});

test('T-GHC01-N another latest attempt cannot replace the retained selected attempt', async t => {
  const f = await monitorFixture(t);
  const observed = await f.link();
  await verifyMonitorLink(f.store, {
    runKey: f.monitor.key, adapterId: 'github', observation: observed, evidenceRef: 'fixture:attempt-2',
  });
  observed.run.run_attempt = 3;
  observed.access.finalUrl = `${web}/actions/runs/401/attempts/3`;
  const before = await durableBytes(f);
  assert.deepEqual(await verifyProviderLink('github', identity, observed),
    { verified: false, reason: 'Provider observation identifies a different execution' });
  assert.deepEqual(await durableBytes(f), before);
  assert.equal((await readMonitor(f.store, f.monitor.key)).link.url, `${web}/actions/runs/401/attempts/2`);
});

test('T-GHC01-G absent provider attempt cannot be silently assigned to the selected attempt', async t => {
  const f = await monitorFixture(t);
  const observed = await f.link();
  delete observed.run.run_attempt;
  const before = await durableBytes(f);
  const result = await verifyProviderLink('github', identity, observed);
  assert.equal(result.verified, false);
  assert.match(result.reason, /^Provider observation is invalid \(INPUT\): Missing field: run_attempt$/u);
  assert.deepEqual(await durableBytes(f), before);
  assert.equal((await readMonitor(f.store, f.monitor.key)).runStatus, 'unknown');
});

test('T-GHC01-D actual HTTP403 for the exact attempt preserves durable monitor evidence', async t => {
  const f = await monitorFixture(t);
  const before = await durableBytes(f);
  f.denyRun();
  await assert.rejects(f.link(), error => {
    assert.equal(error.code, 'PERMISSION');
    assert.equal(error.details.status, 403);
    assert.equal(error.details.connectionId, connectionId);
    return true;
  });
  assert.deepEqual(f.calls, [{ url: `https://api.github.com${base}/actions/runs/401/attempts/2`, method: 'GET' }]);
  assert.equal(f.pageReads, 0);
  assert.deepEqual(await durableBytes(f), before);
});

test('T-GHC02-P separately acquired accessible human page enters monitor link verification', async t => {
  const f = await monitorFixture(t);
  const result = await verifyMonitorLink(f.store, {
    runKey: f.monitor.key, adapterId: 'github', observation: await f.link(), evidenceRef: 'fixture:human-page',
  });
  assert.equal(result.link.status, 'verified');
  assert.equal(result.link.kind, 'summary');
  assert.equal(result.link.url, `${web}/actions/runs/401/attempts/2`);
  assert.equal(result.runStatus, 'unknown');
  assert.equal(f.pageReads, 1);
});

test('T-GHC02-N login API unsafe URL and changed redirect leave prior human-page proof unchanged', async t => {
  const f = await monitorFixture(t);
  const observed = await f.link();
  await verifyMonitorLink(f.store, {
    runKey: f.monitor.key, adapterId: 'github', observation: observed, evidenceRef: 'fixture:human-page',
  });
  const before = await durableBytes(f);
  for (const finalUrl of [
    'https://github.com/login', `https://api.github.com${base}/actions/runs/401`,
    `${web}/actions/runs/402/attempts/2`, `${web}/actions/runs/401/attempts/2?token=fixture-only`,
  ]) {
    const result = await verifyProviderLink('github', identity,
      { ...observed, access: { accessible: true, finalUrl } });
    assert.equal(result.verified, false);
    if (finalUrl.includes('?')) assert.match(result.reason, /^Provider observation is invalid \(INPUT\):/u);
    else assert.equal(result.reason, sameAttemptReason);
    assert.equal(result.reason.includes('fixture-only'), false);
  }
  assert.deepEqual(await durableBytes(f), before);
  assert.equal((await readMonitor(f.store, f.monitor.key)).link.status, 'verified');
});

test('T-GHC02-G run metadata without a host page-access acquisition stays unverified', async t => {
  const f = await monitorFixture(t);
  const before = await durableBytes(f);
  const result = await verifyProviderLink('github', identity,
    { connection: connectionId, run: await f.acquireRun() });
  assert.equal(result.verified, false);
  assert.match(result.reason, /^Provider observation is invalid \(INPUT\): Missing field: access$/u);
  assert.equal(f.pageReads, 0);
  assert.deepEqual(await durableBytes(f), before);
});

test('T-GHC02-D human-page tool IAM refusal is distinct from an HTTP403 and cannot erase prior proof', async t => {
  const f = await monitorFixture(t);
  await verifyMonitorLink(f.store, {
    runKey: f.monitor.key, adapterId: 'github', observation: await f.link(), evidenceRef: 'fixture:human-page',
  });
  const before = await durableBytes(f);
  const reads = f.pageReads;
  f.denyPage();
  await assert.rejects(f.link(), error => {
    assert.equal(error.code, 'AUTHORITY');
    assert.equal(error.message, 'Human-page host permission denied');
    assert.deepEqual(error.details, {
      scopeRef: repositoryRef, executionRef: '401', attemptRef: '2', effect: 'no-read-effect',
    });
    return true;
  });
  assert.equal(f.pageReads, reads);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(await durableBytes(f), before);
  assert.equal((await readMonitor(f.store, f.monitor.key)).link.status, 'verified');
});

test('T-GHC03-P fetch and effective SSH push admit independently without granting publication', async t => {
  const f = await bridgeFixture(t);
  const ssh = 'git@github.com:bridge-owner/bridge-repo.git';
  await f.runGit('config', 'remote.origin.pushurl', ssh);
  const fetched = await f.store.currentRepositoryObservation(f.workItemId, 'primary', 'origin');
  assert.equal(fetched.observation.remoteRepositoryURL, remote);
  const pushed = await f.store.observeRepository({
    ...f.repositoryInput, pushURL: true, remoteRepositoryURL: ssh,
  });
  assert.equal(pushed.localRepositoryPath, f.repo);
  assert.equal(pushed.repositoryRef, repositoryRef);
  assert.equal(pushed.remoteRepositoryURL, ssh);
  assert.notEqual(pushed.id, fetched.observation.id);
  const state = await f.store.load(f.workItemId);
  assert.equal(evaluatePolicy(state, {
    class: 'push', repositoryId: 'primary', localRepositoryPath: f.repo, remoteRepositoryURL: ssh,
    sourceRevision: f.revision, sourceRef: 'refs/heads/feature/fixture', targetRef: 'refs/heads/feature/fixture',
    target: 'origin', remoteUrlDigest: digest([ssh]), force: false, delete: false,
  }, { clock: f.clock }).allowed, false);
  assert.equal(f.calls.every(call => call.key.startsWith('GET ')), true);
});

test('T-GHC03-N similar URL and wrong effective push destination cannot replace repository proof', async t => {
  const f = await bridgeFixture(t);
  await unchanged(f, () => f.store.observeRepository({
    ...f.repositoryInput, remoteRepositoryURL: 'https://github.com/bridge-owner/bridge-repo-extra.git',
  }), 'EVIDENCE');
  await f.runGit('config', 'remote.origin.pushurl', 'git@github.com:bridge-owner/bridge-repo.git');
  await unchanged(f, () => f.store.observeRepository({ ...f.repositoryInput, pushURL: true }), 'EVIDENCE');
});

test('T-GHC03-G missing independent destination proof cannot admit a publication repository', async t => {
  const f = await bridgeFixture(t);
  const original = verifiersOf(f);
  const host = createGitHubHost({ clock: f.clock, verifiers: {
    ...original, async verifyRepository(input) {
      const acquired = await original.verifyRepository(input);
      const { verifiedRemoteRepositoryURL, ...missing } = acquired;
      void verifiedRemoteRepositoryURL;
      return missing;
    },
  } });
  const store = await createGitHubStore(f.home, host).ready();
  await unchanged(f, () => store.observeRepository(f.repositoryInput), 'INPUT');
});

test('T-GHC03-D exact selected repository HTTP403 is neither proof nor verified absence', async t => {
  const f = await bridgeFixture(t);
  await permissionDenied(f, () => f.store.observeRepository(f.repositoryInput), base);
});

test('T-GHC04-P authenticated selected and default full refs bind their acquired full revision', async t => {
  const f = await bridgeFixture(t);
  const proof = await f.store.verifyRepository(f.boundaryInput);
  assert.deepEqual(proof.verifiedBranch, {
    branchRef: 'refs/heads/feature/fixture', revision: f.revision,
  });
  assert.equal(proof.verifiedDefaultBranchRef, 'refs/heads/main');
  assert.equal(proof.verifiedRevision, f.revision);
  const observed = await f.store.observeRepository(f.repositoryInput);
  assert.deepEqual(observed.verifiedBranch, proof.verifiedBranch);
  assert.equal(observed.defaultBranchRef, 'refs/heads/main');
  assert.equal(f.calls.some(call => call.key === `GET ${base}/branches/feature%2Ffixture`), true);
  assert.equal(f.calls.some(call => call.key === `GET ${base}/branches/main`), true);
});

test('T-GHC04-N prefix branch unrelated revision and stale default reject without replacing evidence', async t => {
  const f = await bridgeFixture(t);
  for (const input of [
    { ...f.repositoryInput, verifiedBranch: { branchRef: 'refs/heads/feature/fixture-extra', revision: f.revision } },
    { ...f.repositoryInput, revision: 'e'.repeat(40) },
    { ...f.repositoryInput, defaultBranchRef: 'refs/heads/stale-default' },
  ]) await unchanged(f, () => f.store.observeRepository(input), 'EVIDENCE');
});

test('T-GHC04-G branch name without acquired branch-to-commit proof cannot admit an exact ref', async t => {
  const f = await bridgeFixture(t);
  const original = verifiersOf(f);
  const host = createGitHubHost({ clock: f.clock, verifiers: {
    ...original, async verifyRepository(input) {
      const { verifiedBranch, ...missing } = await original.verifyRepository(input);
      void verifiedBranch;
      return missing;
    },
  } });
  const store = await createGitHubStore(f.home, host).ready();
  await unchanged(f, () => store.observeRepository(f.repositoryInput), 'EVIDENCE');
});

test('T-GHC04-D actual exact selected-ref HTTP403 cannot fall back to repository default metadata', async t => {
  const f = await bridgeFixture(t);
  await permissionDenied(f, () => f.store.observeRepository(f.repositoryInput),
    `${base}/branches/feature%2Ffixture`);
});

async function adoptFork(f) {
  const acquired = await f.acquirePr({ headRef: 'main', sourceRepository: f.forkRepository });
  f.pr = (await adoptPr(f.store, { workItemId: f.workItemId, ...acquired })).observation;
  return acquired;
}

test('T-GHC05-P actual PR base and independent same-ref fork enter Store as observation only', async t => {
  const f = await bridgeFixture(t);
  await adoptFork(f);
  assert.equal(f.pr.pullRequestRef, 'pull-request:801');
  assert.equal(f.pr.repositoryRef, repositoryRef);
  assert.equal(f.pr.sourceRepositoryURL, 'https://github.com/fork-owner/fork-repo.git');
  assert.equal(f.pr.sourceBranchRef, 'refs/heads/main');
  assert.equal(f.pr.targetBranchRef, 'refs/heads/main');
  assert.equal(f.pr.sourceRevision, f.revision);
  assert.equal(f.pr.state, 'active');
  assert.deepEqual((await f.store.records(f.workItemId)).find(record => record.id === f.pr.id), f.pr);
  assert.equal(f.calls.some(call => call.key === 'GET /repos/fork-owner/fork-repo'), true);
  assert.equal(f.calls.every(call => call.key.startsWith('GET ')), true);
});

test('T-GHC05-N base proof cannot establish another fork or unrelated PR', async t => {
  const f = await bridgeFixture(t);
  const acquired = await adoptFork(f);
  await unchanged(f, () => f.acquirePr({
    headRef: 'main', sourceRepository: f.forkRepository, borrowHead: true,
  }), 'EVIDENCE');
  await unchanged(f, () => adoptPr(f.store, {
    workItemId: f.workItemId, ...acquired,
    observation: { ...acquired.observation, pullRequestRef: 'pull-request:999' },
  }), 'EVIDENCE');
});

test('T-GHC05-G missing independent fork acquisition cannot borrow base readiness', async t => {
  const f = await bridgeFixture(t);
  await adoptFork(f);
  await unchanged(f, () => f.acquirePr({
    headRef: 'main', sourceRepository: f.forkRepository, omitHead: true,
  }), 'PROOF_GAP');
  assert.deepEqual((await f.store.records(f.workItemId)).find(record => record.id === f.pr.id), f.pr);
});

test('T-GHC05-D independent fork HTTP403 cannot reuse already admitted base proof', async t => {
  const f = await bridgeFixture(t);
  await adoptFork(f);
  await permissionDenied(f, () => f.acquirePr({
    headRef: 'main', sourceRepository: f.forkRepository,
  }), '/repos/fork-owner/fork-repo');
});

async function checkMonitor(f, acquired) {
  if (!providerAdapterIds().includes('github')) registerGitHubAdapter();
  const attached = await attachMonitor(f.store, {
    identity: acquired.identity, origin: 'framework', schedulerAvailable: true,
    readAvailable: true, workItemId: f.workItemId,
  });
  const claimed = await claimMonitor(f.store, { runKey: attached.key, workerId: 'retained-check-worker' });
  const poll = await beginPoll(f.store, {
    runKey: attached.key, workerId: 'retained-check-worker', claimGeneration: claimed.claimGeneration,
  });
  return { runKey: attached.key, workerId: 'retained-check-worker',
    claimGeneration: claimed.claimGeneration, pollGeneration: poll.pollGeneration };
}

test('T-GHC06-P independently acquired PR run attempt job check App checkout and selection enter monitor', async t => {
  const f = await bridgeFixture(t);
  await adoptFork(f);
  const acquired = await f.acquireChecks();
  const poll = await checkMonitor(f, acquired);
  const result = await observeMonitor(f.store, { ...poll, ...acquired, status: 'succeeded' });
  assert.deepEqual(result.identity, identity);
  assert.equal(result.runStatus, 'succeeded');
  assert.equal(result.evidenceVerification.verified, true);
  assert.deepEqual(result.checkResults, [{
    requiredCheckRef: 'bridge-build', checkResultRef: 'check:801', producerRef: '301',
    testedRevision: f.revision, evidenceRef: 'fixture:original-check', status: 'succeeded',
    localRepositoryPath: f.repo, remoteRepositoryURL: remote, repositoryRef,
    pullRequestRef: 'pull-request:801', sourceRepositoryURL: f.forkRepository.clone_url,
    sourceRevision: f.revision, targetRevision: f.revision,
  }]);
  assert.deepEqual((await readMonitor(f.store, poll.runKey)).checkResults, result.checkResults);
});

test('T-GHC06-N same SHA name wrong App producer or checkout cannot prove the selected check', async t => {
  const f = await bridgeFixture(t);
  await adoptFork(f);
  const acquired = await f.acquireChecks();
  const poll = await checkMonitor(f, acquired);
  await observeMonitor(f.store, { ...poll, ...acquired, status: 'succeeded' });
  for (const options of [{ wrongApp: true }, { wrongProducer: true }, { wrongCheckout: true }])
    await unchanged(f, () => f.acquireChecks(options), 'EVIDENCE');
  assert.deepEqual((await readMonitor(f.store, poll.runKey)).checkResults, acquired.checkResults);
});

test('T-GHC06-G missing original test selection or checkout bytes cannot manufacture check success', async t => {
  const f = await bridgeFixture(t);
  await adoptFork(f);
  await unchanged(f, () => f.acquireChecks({ missingSelection: true }), 'PROOF_GAP');
  const acquired = await f.acquireChecks();
  const poll = await checkMonitor(f, acquired);
  const { evidenceFilePath, ...withoutBytes } = acquired;
  void evidenceFilePath;
  await unchanged(f, () => observeMonitor(f.store, {
    ...poll, ...withoutBytes, status: 'succeeded',
  }), 'EVIDENCE');
  assert.equal((await readMonitor(f.store, poll.runKey)).runStatus, 'unknown');
});

test('T-GHC06-D exact check HTTP403 cannot erase prior passing producer evidence', async t => {
  const f = await bridgeFixture(t);
  await adoptFork(f);
  const acquired = await f.acquireChecks();
  const poll = await checkMonitor(f, acquired);
  await observeMonitor(f.store, { ...poll, ...acquired, status: 'succeeded' });
  await permissionDenied(f, () => f.acquireChecks(), `${base}/check-runs/801`);
  assert.deepEqual((await readMonitor(f.store, poll.runKey)).checkResults, acquired.checkResults);
});

test('T-GHC07-P increasing acquired sequence admits current PR while preserving archived predecessor', async t => {
  const f = await bridgeFixture(t);
  const first = await f.acquirePr();
  const prior = (await adoptPr(f.store, { workItemId: f.workItemId, ...first })).observation;
  f.clock.advance(1);
  const refresh = await f.acquirePr({ sequence: 2, previousObservationKey: prior.id });
  const current = (await adoptPr(f.store, {
    workItemId: f.workItemId, ...refresh, previousObservationKey: prior.id,
  })).observation;
  assert.equal(current.sequence, 2);
  assert.equal(current.previousObservationKey, prior.id);
  assert.equal(current.sourceRevision, f.revision);
  assert.deepEqual((await f.store.records(f.workItemId)).filter(record => record.type === 'pr-observation'), [current]);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(
    f.store.workPath(f.workItemId), 'evidence', `${prior.id}.json`), 'utf8')), prior);
});

test('T-GHC07-N delayed archived sequence and revoked authority cannot replace current evidence', async t => {
  const f = await bridgeFixture(t);
  const first = await f.acquirePr();
  const prior = (await adoptPr(f.store, { workItemId: f.workItemId, ...first })).observation;
  f.clock.advance(1);
  const refresh = await f.acquirePr({ sequence: 2, previousObservationKey: prior.id });
  const current = (await adoptPr(f.store, {
    workItemId: f.workItemId, ...refresh, previousObservationKey: prior.id,
  })).observation;
  await unchanged(f, () => adoptPr(f.store, { workItemId: f.workItemId, ...first }), 'STALE');
  await unchanged(f, () => adoptPr(f.store, {
    workItemId: f.workItemId, ...f.originalPrVariant(refresh, { sequence: 999 }),
    previousObservationKey: current.id,
  }), 'EVIDENCE');
  const prepared = await f.prepare('policy', '-retained-revoked', { claim: false });
  const stale = await f.prepare('notification', '-retained-stale', { claim: false });
  const source = path.join(f.repo, 'changed-retained-source.mjs');
  const sourceCalls = f.calls.length;
  await fs.writeFile(source, 'export const changed = true;\n');
  try {
    await unchanged(f, () => f.bridge.legacyOperations.claimDispatch(stale.preparation, f.store), 'STALE');
    assert.equal(f.calls.length, sourceCalls);
    const saved = (await f.store.records(f.workItemId)).find(record => record.id === stale.preparation.operation.id);
    assert.equal(saved.status, 'prepared');
    assert.equal(saved.dispatchBound, false);
  } finally { await fs.unlink(source); }
  const permission = (await f.store.records(f.workItemId)).find(record =>
    record.type === 'event' && record.kind === 'permission' && record.effect.grant === 'auto-merge');
  assert.equal(permission.effect.grant, 'auto-merge');
  await grant(f, 'revocation', { revokes: [permission.id] });
  await orient(f);
  const calls = f.calls.length;
  await unchanged(f, () => f.bridge.legacyOperations.claimDispatch(prepared.preparation, f.store), 'GATE');
  assert.equal(f.calls.length, calls);
  assert.deepEqual((await f.store.records(f.workItemId)).find(record => record.id === current.id), current);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(
    f.store.workPath(f.workItemId), 'evidence', `${prior.id}.json`), 'utf8')), prior);
});

test('T-GHC07-G missing current predecessor or immutable producer prevents current admission', async t => {
  const f = await bridgeFixture(t);
  const first = await f.acquirePr();
  const prior = (await adoptPr(f.store, { workItemId: f.workItemId, ...first })).observation;
  f.clock.advance(1);
  const refresh = await f.acquirePr({ sequence: 2, previousObservationKey: prior.id });
  await unchanged(f, () => adoptPr(f.store, { workItemId: f.workItemId, ...refresh }), 'STALE');
  const checks = await f.acquireChecks();
  const poll = await checkMonitor(f, checks);
  const { evidenceFilePath, ...withoutProducerBytes } = checks;
  void evidenceFilePath;
  await unchanged(f, () => observeMonitor(f.store, {
    ...poll, ...withoutProducerBytes, status: 'succeeded',
  }), 'EVIDENCE');
  assert.deepEqual((await f.store.records(f.workItemId)).find(record => record.id === prior.id), prior);
});

test('T-GHC07-D trusted current-context admission denial preserves prior PR with no HTTP fallback', async t => {
  const f = await bridgeFixture(t);
  const first = await f.acquirePr();
  const prior = (await adoptPr(f.store, { workItemId: f.workItemId, ...first })).observation;
  f.clock.advance(1);
  const refresh = await f.acquirePr({ sequence: 2, previousObservationKey: prior.id });
  const acquired = new Set([refresh.adapterObservation.handle]);
  const original = verifiersOf(f);
  const host = createGitHubHost({ clock: f.clock, verifiers: {
    ...original, verifyPullRequest(input) {
      assert.equal(acquired.has(input.adapterObservation.handle), true);
      throw new SdlcError('AUTHORITY', 'Current PR acquisition is not admitted by the trusted host');
    },
  } });
  const store = await createGitHubStore(f.home, host).ready();
  const calls = f.calls.length;
  await unchanged(f, () => adoptPr(store, {
    workItemId: f.workItemId, ...refresh, previousObservationKey: prior.id,
  }), 'AUTHORITY');
  assert.equal(f.calls.length, calls);
  assert.deepEqual((await f.store.records(f.workItemId)).find(record => record.id === prior.id), prior);
});

function cliInput(f, body, factory, home = f.home) {
  return runCli([
    'repository', 'observe', '--home', home, '--cwd', f.repo,
    '--work-item', f.workItemId, '--session', f.sessionId,
  ], { stdin: Readable.from([JSON.stringify(body)]), stdout: { write() {} }, stderr: { write() {} } },
  factory === undefined ? {} : { createStore: factory });
}

test('T-GHC17-P six manual verifiers wire selected-home CLI Store monitor and operation consumers', async t => {
  const f = await bridgeFixture(t);
  const seed = await f.prepare('execution', '-host-seed', { claim: false });
  const action = { ...seed.preparation.operation.action };
  delete action.operationId;
  await f.bridge.legacyOperations.recordResult(seed.preparation, {
    workItemId: f.workItemId, operationId: seed.preparation.operation.id, status: 'not-started',
    observedResult: f.nonDispatch(seed, 'cancelled-before-claim'),
  }, f.store);
  const original = verifiersOf(f);
  const calls = Object.fromEntries(Object.keys(original).map(name => [name, 0]));
  const host = createGitHubHost({
    connections: [{ connection: f.connection, transport: f.transport }], clock: f.clock,
    identifier: () => 'retained-six-verifier-call', authorize: () => true,
    verifiers: Object.fromEntries(Object.entries(original).map(([name, callback]) =>
      [name, input => { calls[name]++; return callback(input); }])),
  });
  f.store = await createGitHubStore(f.home, host).ready();
  const homes = [];
  const currentRepository = await f.store.verifyRepository(f.boundaryInput);
  const observed = await cliInput(f, {
    ...f.repositoryInput, observedAt: currentRepository.verifiedObservedAt,
    evidenceRef: currentRepository.verifiedEvidenceRef,
  }, home => {
    homes.push(home);
    return createGitHubStore(home, host);
  });
  assert.equal(observed.exitCode, 0);
  assert.deepEqual(homes, [f.home]);
  assert.equal(observed.result.repositoryRef, repositoryRef);
  assert.equal(observed.result.localRepositoryPath, f.repo);
  await adoptFork(f);
  const checks = await f.acquireChecks();
  const poll = await checkMonitor(f, checks);
  assert.equal((await observeMonitor(f.store, { ...poll, ...checks, status: 'succeeded' })).runStatus, 'succeeded');
  const preparation = await host.legacyOperations.prepare({
    workItemId: f.workItemId, sessionId: f.sessionId, operationId: 'op-retained-six-verifiers', action,
    request: { toolName: 'github-existing-consumer', toolArgs: { family: 'execution' }, cwd: f.repo },
    correlationKey: 'retained-six-verifiers', intent: 'Controlled selected-home producer',
  }, f.store);
  const claim = await host.legacyOperations.claimDispatch(preparation, f.store);
  const produced = await host.legacyOperations.recordResult(preparation, {
    workItemId: f.workItemId, operationId: claim.operation.id, status: 'succeeded',
    observedResult: await f.result({ preparation, claim }),
  }, f.store);
  assert.equal(produced.resultProof.executionIdentity.attemptRef, '2');
  const artifact = await f.selectArtifact(produced);
  assert.equal(artifact.artifactId, '901');
  const file = path.join(f.root, 'version-evidence.bin');
  await fs.writeFile(file, 'immutable fixture evidence');
  const version = await verifyReferencedEvidence({
    locator: 'fixture:immutable', immutableVersion: 'v1', retrievalContext: {
      provider: 'github', connection: connectionId, scopeRef: repositoryRef,
      retrievedAt: new Date(f.clock.now()).toISOString(),
    },
  }, { filePath: file, verifyProviderVersion: f.store.verifyProviderVersion });
  assert.equal(version.verified, true);
  assert.deepEqual(Object.keys(calls).sort(), [
    'verifyArtifact', 'verifyCheckResults', 'verifyOperationResult',
    'verifyProviderVersion', 'verifyPullRequest', 'verifyRepository',
  ]);
  for (const count of Object.values(calls)) assert.equal(count > 0, true);
  assert.equal(f.store.home, f.home);
});

test('T-GHC17-N wrong home reconstructed host or executable JSON cannot establish provider admission', async t => {
  const f = await bridgeFixture(t);
  const host = createGitHubHost({ clock: f.clock, verifiers: verifiersOf(f) });
  const otherHome = path.join(f.root, 'wrong home');
  await unchanged(f, () => cliInput(f, f.repositoryInput,
    () => createGitHubStore(otherHome, host)), 'ADAPTER');
  assert.throws(() => createGitHubStore(f.home, { ...host }), { code: 'ADAPTER' });
  assert.throws(() => createGitHubHost({ verifiers: {
    verifyRepository: { module: 'repository-controlled.mjs', trusted: true },
  } }), { code: 'ADAPTER' });
  assert.equal(f.calls.every(call => call.key.startsWith('GET ')), true);
});

test('T-GHC17-G missing trusted callback rejects six consumers instead of self-attested provider JSON', async t => {
  const f = await bridgeFixture(t);
  const host = createGitHubHost({ clock: f.clock });
  const store = await createGitHubStore(f.home, host).ready();
  const before = await durableBytes(f);
  const calls = f.calls.length;
  await assert.rejects(cliInput(f, f.repositoryInput, home => createGitHubStore(home, host)), { code: 'ADAPTER' });
  assert.deepEqual(host.missingVerifiers, [
    'verifyRepository', 'verifyPullRequest', 'verifyCheckResults',
    'verifyOperationResult', 'verifyArtifact', 'verifyProviderVersion',
  ]);
  assert.equal(store.home, f.home);
  assert.equal(f.calls.length, calls);
  assert.deepEqual(await durableBytes(f), before);
});

test('T-GHC17-D actual host IAM refusal leaves exact preparation unclaimed and causes zero effects', async t => {
  const f = await bridgeFixture(t);
  const seed = await f.prepare('notification', '', { claim: false });
  const action = { ...seed.preparation.operation.action };
  delete action.operationId;
  await f.bridge.legacyOperations.recordResult(seed.preparation, {
    workItemId: f.workItemId, operationId: seed.preparation.operation.id, status: 'not-started',
    observedResult: f.nonDispatch(seed, 'cancelled-before-claim'),
  }, f.store);
  const authorized = [];
  const host = createGitHubHost({
    clock: f.clock, verifiers: verifiersOf(f), identifier: () => 'retained-iam-call',
    authorize(operation) { authorized.push(operation.id); return false; },
  });
  const store = await createGitHubStore(f.home, host).ready();
  const prepared = await host.legacyOperations.prepare({
    workItemId: f.workItemId, sessionId: f.sessionId, operationId: 'op-retained-iam', action,
    request: { toolName: 'github-existing-consumer', toolArgs: { family: 'notification' }, cwd: f.repo },
    correlationKey: 'retained-iam', intent: 'Controlled denied publication',
  }, store);
  const calls = f.calls.length;
  await unchanged(f, () => host.legacyOperations.claimDispatch(prepared, store), 'AUTHORITY');
  assert.deepEqual(authorized, ['op-retained-iam']);
  const saved = (await store.records(f.workItemId)).find(record => record.id === prepared.operation.id);
  assert.equal(saved.status, 'prepared');
  assert.equal(saved.dispatchBound, false);
  assert.equal(saved.resultProof, undefined);
  assert.equal(f.calls.length, calls);
});

test('T-GHB20 ordinary offline CLI rejects unverified facts and executable repository JSON with zero network', async t => {
  const f = await bridgeFixture(t);
  let networkCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { networkCalls++; assert.fail('Offline CLI cannot acquire provider facts'); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls = f.calls.length;
  await unchanged(f, () => cliInput(f, f.repositoryInput), 'ADAPTER');
  const marker = path.join(f.root, 'must-not-execute');
  const module = path.join(f.repo, 'repository-controlled.mjs');
  await fs.writeFile(module,
    `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'executed');\n`);
  const config = path.join(f.repo, '.sdlc', 'config.json');
  const existing = JSON.parse(await fs.readFile(config, 'utf8'));
  await fs.writeFile(config, JSON.stringify({ ...existing, verifiers: { github: { module } } }));
  await unchanged(f, () => cliInput(f, f.repositoryInput), 'INPUT');
  await assert.rejects(fs.stat(marker), { code: 'ENOENT' });
  assert.equal(networkCalls, 0);
  assert.equal(f.calls.length, calls);
});

test('T-GHB21 connection transport adapter host and selected-home Store construction are acquisition-free', () => {
  const before = providerAdapterIds();
  const calls = { credentials: 0, fetch: 0, identifier: 0, authorize: 0, verifier: 0 };
  const connection = createGitHubConnection({
    id: 'construction-only', apiOrigin: 'https://api.github.com', webOrigin: 'https://github.com',
    scopes: [{ kind: 'repository', id: '101', owner: 'bridge-owner', name: 'bridge-repo' }],
    credentialResolver() { calls.credentials++; assert.fail('Construction cannot resolve credentials'); },
  });
  const transport = createGitHubTransport({
    connection, fetch() { calls.fetch++; assert.fail('Construction cannot acquire facts'); },
  });
  const host = createGitHubHost({
    connections: [{ connection, transport }],
    identifier() { calls.identifier++; assert.fail('Construction cannot claim a call'); },
    authorize() { calls.authorize++; assert.fail('Construction cannot request IAM'); },
    verifiers: { verifyRepository() { calls.verifier++; assert.fail('Construction cannot verify'); } },
  });
  const adapter = createGitHubExecutionAdapter();
  const store = createGitHubStore(path.resolve('fixture construction home'), host);
  assert.equal(adapter.attemptCapability, 'distinct');
  assert.equal(store.home, path.resolve('fixture construction home'));
  assert.deepEqual(calls, { credentials: 0, fetch: 0, identifier: 0, authorize: 0, verifier: 0 });
  assert.deepEqual(providerAdapterIds(), before);
});

test('T-GHB22 private transport causes getters and opaque result handles never enter output or durable evidence', async t => {
  const f = await bridgeFixture(t);
  const privateText = 'fixture-private-response-and-path';
  const privatePath = path.join(f.root, 'private-acquisition-response.log');
  const fakeSecret = `github_pat_${'x'.repeat(24)}`;
  let getters = 0;
  const transport = createGitHubTransport({ connection: f.connection, fetch() {
    const error = new Error(privateText, { cause: {
      rawProviderResponse: privateText, privatePath, signedUrl: `${web}?sig=${privateText}`,
    } });
    Object.defineProperty(error, 'privateDetails', { get() { getters++; throw new Error(privateText); } });
    throw error;
  } });
  const before = await durableBytes(f);
  await assert.rejects(transport.execute(transport.buildRestRequest({
    method: 'GET', path: base, profile: '2026-03-10', mediaType: 'application/vnd.github+json',
    expectedStatuses: [200], proofScope: repositoryRef, tokenClasses: ['fine-grained-pat'],
  })), error => {
    assert.equal(error.code, 'TRANSPORT');
    assert.equal(error.cause, undefined);
    assert.equal(JSON.stringify(error).includes(privateText), false);
    assert.equal(JSON.stringify(error).includes(privatePath), false);
    assert.equal(humanOutput(error).includes(privateText), false);
    return true;
  });
  assert.equal(getters, 0);
  assert.deepEqual(await durableBytes(f), before);
  const denied = createGitHubTransport({ connection: f.connection, fetch: async () =>
    new Response(JSON.stringify({
      rawProviderResponse: privateText, privatePath, accessToken: fakeSecret,
      signedUrl: `${web}?sig=${fakeSecret}`,
    }), { status: 403, headers: { 'content-type': 'application/json' } }) });
  const host = createGitHubHost({ clock: f.clock, verifiers: {
    ...verifiersOf(f), verifyRepository: () => denied.execute(denied.buildRestRequest({
      method: 'GET', path: base, profile: '2026-03-10', mediaType: 'application/vnd.github+json',
      expectedStatuses: [200], proofScope: repositoryRef, tokenClasses: ['fine-grained-pat'],
    })),
  } });
  await assert.rejects(cliInput(f, f.repositoryInput, home => createGitHubStore(home, host)), error => {
    assert.equal(error.code, 'PERMISSION');
    assert.equal(error.details.status, 403);
    for (const forbidden of [privateText, privatePath, fakeSecret])
      assert.equal(`${JSON.stringify(error)}\n${humanOutput(error)}\n${error.stack}`.includes(forbidden), false);
    return true;
  });
  assert.deepEqual(await durableBytes(f), before);
  const prepared = await f.prepare('notification');
  const opaque = f.opaqueResult(await f.result(prepared));
  const result = await f.record(prepared, opaque);
  assert.equal(result.status, 'succeeded');
  assert.equal(result.resultProof.providerResultId, 'comment:1001');
  assert.equal(humanOutput(result).includes(opaque.opaqueReference), false);
  const retained = JSON.stringify(await f.store.records(f.workItemId));
  assert.equal(retained.includes(opaque.opaqueReference), false);
  assert.equal(retained.includes(privateText), false);
  assert.equal(retained.includes(privatePath), false);
  assert.equal(retained.includes(fakeSecret), false);
  assert.equal(retained.includes('isolated-fixture-credential'), false);
});

async function distinctMergeCheck(t) {
  const f = await bridgeFixture(t);
  const head = f.revision, target = 'b'.repeat(40), testMerge = 'c'.repeat(40), terminalMerge = 'd'.repeat(40);
  const repo = await f.acquire('GET', base);
  const pr = await f.acquire('GET', `${base}/pulls/1`, {
    id: 801, merged: false, merge_commit_sha: testMerge,
    head: { sha: head, ref: 'feature/fixture', repo: { id: 101 } },
    base: { sha: target, ref: 'main', repo: { id: 101 } },
  });
  const run = await f.acquire('GET', `${base}/actions/runs/401/attempts/2`, {
    id: 401, workflow_id: 301, run_attempt: 2, repository: { id: 101 },
    head_sha: head, check_suite_id: 701,
  });
  const check = await f.acquire('GET', `${base}/check-runs/801`, {
    id: 801, head_sha: testMerge, app: { id: 601 }, check_suite: { id: 701 },
    name: 'bridge-build', conclusion: 'success', pull_requests: [{ id: 801 }],
  });
  const job = await f.acquire('GET', `${base}/actions/jobs/501`, {
    id: 501, run_id: 401, run_attempt: 2, check_run_url: `https://api.github.com${base}/check-runs/801`,
  });
  const policy = await f.acquire('GET', `${base}/branches/main/protection/required_status_checks`, {
    checks: [{ context: 'bridge-build', app_id: 601 }],
  });
  const runner = Object.freeze({
    repositoryId: '101', workflowId: '301', runId: '401', attempt: '2', jobId: '501',
    checkId: '801', checkout: testMerge, requiredTests: ['T-unit'], executedTests: ['T-unit'],
  });
  const bytes = Buffer.from(JSON.stringify(runner));
  const key = randomBytes(32);
  const signature = createHmac('sha256', key).update(bytes).digest();
  const file = path.join(f.root, 'distinct-checkout.bin');
  await fs.writeFile(file, bytes);
  const observedAt = new Date(f.clock.now()).toISOString();
  const observation = {
    repositoryId: 'primary', localRepositoryPath: f.repo, remoteRepositoryURL: repo.body.clone_url,
    provider: 'github', connection: connectionId, repositoryRef: `repository:${repo.body.id}`,
    pullRequestRef: `pull-request:${pr.body.id}`, sourceBranchRef: `refs/heads/${pr.body.head.ref}`,
    targetBranchRef: `refs/heads/${pr.body.base.ref}`, sourceRevision: pr.body.head.sha,
    targetRevision: pr.body.base.sha, state: 'active', observedAt, evidenceRef: 'fixture:distinct-pr',
  };
  const evidenceReference = { locator: 'fixture:distinct-checkout', sha256: digest(bytes),
    retrievalContext: { provider: 'github', connection: connectionId, scopeRef: repositoryRef, retrievedAt: observedAt } };
  const checkResult = {
    requiredCheckRef: policy.body.checks[0].context, checkResultRef: `check:${check.body.id}`,
    producerRef: String(run.body.workflow_id), testedRevision: runner.checkout,
    evidenceRef: 'fixture:distinct-check', status: 'succeeded', localRepositoryPath: f.repo,
    remoteRepositoryURL: repo.body.clone_url, repositoryRef: `repository:${repo.body.id}`,
    pullRequestRef: `pull-request:${pr.body.id}`, sourceRevision: pr.body.head.sha, targetRevision: pr.body.base.sha,
    mergeContext: { sourceRevision: pr.body.head.sha, targetRevision: pr.body.base.sha,
      mergeRevision: pr.body.merge_commit_sha, evidenceRef: 'fixture:unmerged-test-merge' },
  };
  const prHandle = Object.freeze({ ref: 'distinct-pr-acquisition' });
  const checkHandle = Object.freeze({ ref: 'distinct-runner-acquisition' });
  const host = createGitHubHost({ clock: f.clock, verifiers: {
    ...verifiersOf(f),
    verifyPullRequest(input) {
      assert.equal(input.adapterObservation.ref, prHandle.ref);
      for (const capture of [repo, pr]) requireGitHubCapture(capture, f.connection);
      assert.equal(pr.body.base.repo.id, repo.body.id);
      assert.equal(pr.body.head.repo.id, repo.body.id);
      return {
        canonicalLocalRepositoryPath: f.repo, verifiedRemoteRepositoryURL: repo.body.clone_url,
        verifiedProvider: 'github', verifiedConnection: connectionId, verifiedRepositoryRef: `repository:${repo.body.id}`,
        verifiedPullRequestRef: `pull-request:${pr.body.id}`,
        verifiedSourceBranchRef: `refs/heads/${pr.body.head.ref}`, verifiedTargetBranchRef: `refs/heads/${pr.body.base.ref}`,
        verifiedSourceRevision: pr.body.head.sha, verifiedTargetRevision: pr.body.base.sha,
        verifiedState: pr.body.merged ? 'merged' : 'active', verifiedObservedAt: observedAt,
        verifiedEvidenceRef: 'fixture:distinct-pr',
      };
    },
    verifyCheckResults(input) {
      assert.equal(input.adapterObservation.ref, checkHandle.ref);
      for (const capture of [repo, pr, run, check, job, policy]) requireGitHubCapture(capture, f.connection);
      assert.equal(timingSafeEqual(createHmac('sha256', key).update(bytes).digest(), signature), true);
      const actual = JSON.parse(bytes);
      assert.equal(String(run.body.repository.id), actual.repositoryId);
      assert.equal(String(run.body.id), actual.runId);
      assert.equal(String(run.body.workflow_id), actual.workflowId);
      assert.equal(String(run.body.run_attempt), actual.attempt);
      assert.equal(job.body.run_id, run.body.id);
      assert.equal(job.body.run_attempt, run.body.run_attempt);
      assert.equal(String(job.body.id), actual.jobId);
      assert.equal(String(check.body.id), actual.checkId);
      assert.equal(job.body.check_run_url, check.finalUrl);
      assert.equal(check.body.check_suite.id, run.body.check_suite_id);
      assert.equal(check.body.app.id, policy.body.checks[0].app_id);
      assert.equal(check.body.name, policy.body.checks[0].context);
      assert.equal(check.body.pull_requests[0].id, pr.body.id);
      assert.equal(check.body.head_sha, actual.checkout);
      assert.equal(pr.body.merge_commit_sha, actual.checkout);
      assert.deepEqual(actual.requiredTests, ['T-unit']);
      assert.deepEqual(actual.executedTests, ['T-unit']);
      return { identity, status: check.body.conclusion === 'success' ? 'succeeded' : 'failed',
        evidenceReference, checkResults: [checkResult] };
    },
  } });
  f.store = await createGitHubStore(f.home, host).ready();
  f.pr = (await adoptPr(f.store, { workItemId: f.workItemId, observation,
    adapterObservation: prHandle })).observation;
  const acquired = { identity, checkResults: [checkResult], checkObservation: checkHandle,
    evidence: { reference: evidenceReference }, evidenceFilePath: file };
  const poll = await checkMonitor(f, acquired);
  await observeMonitor(f.store, { ...poll, ...acquired, status: 'succeeded' });
  const nativeRepo = Object.fromEntries(Object.entries(f.repositoryBody).filter(([field]) => field !== 'url'));
  await verifyMonitorLink(f.store, { runKey: poll.runKey, adapterId: 'github',
    observation: { connection: connectionId, run: {
      id: run.body.id, workflow_id: run.body.workflow_id, run_attempt: run.body.run_attempt,
      repository: nativeRepo, html_url: `${web}/actions/runs/401`,
    }, access: { accessible: true, finalUrl: `${web}/actions/runs/401/attempts/2` } },
    evidenceRef: 'fixture:distinct-human-page' });
  const association = {
    runKey: poll.runKey, workItemId: f.workItemId, prRecordId: f.pr.id, prObservationKey: f.pr.id,
    checkId: checkResult.requiredCheckRef, localRepositoryPath: f.repo, remoteRepositoryURL: remote,
    requiredCheckRef: checkResult.requiredCheckRef, checkResultRef: checkResult.checkResultRef,
    producerRef: checkResult.producerRef, testedRevision: runner.checkout,
    sourceRevision: pr.body.head.sha, targetRevision: pr.body.base.sha,
    evidenceRef: checkResult.evidenceRef, mergeContext: checkResult.mergeContext, evidence: acquired.evidence,
  };
  return { f, association, head, target, testMerge, terminalMerge, runHead: run.body.head_sha };
}

test('T-GHC06-P unmerged test-merge checkout associates the check without claiming a completed merge', async t => {
  const { f, association, head, target, testMerge, terminalMerge, runHead } = await distinctMergeCheck(t);
  const admitted = await associateMonitor(f.store, association);
  assert.equal(new Set([head, target, testMerge, terminalMerge]).size, 4);
  assert.equal(runHead, head);
  assert.equal(admitted.testedRevision, testMerge);
  assert.deepEqual(admitted.mergeContext, {
    sourceRevision: head, targetRevision: target, mergeRevision: testMerge, evidenceRef: 'fixture:unmerged-test-merge',
  });
  assert.equal(f.pr.state, 'active');
  assert.equal(f.pr.mergeRevision, undefined);
  assert.equal((await f.store.records(f.workItemId)).some(record =>
    record.type === 'operation' && record.resultProof?.family === 'merge'), false);
});

test('T-GHC06-N API head or terminal merged revision cannot replace independently executed test-merge checkout', async t => {
  const { f, association, head, terminalMerge } = await distinctMergeCheck(t);
  for (const testedRevision of [head, terminalMerge])
    await unchanged(f, () => associateMonitor(f.store, { ...association, testedRevision }), 'EVIDENCE');
  const { mergeContext, ...withoutMergeJoin } = association;
  void mergeContext;
  await unchanged(f, () => associateMonitor(f.store, withoutMergeJoin), 'EVIDENCE');
  assert.equal(f.pr.state, 'active');
});

nodeTest('retained identity acceptance through existing public consumers', { concurrency: 4 }, async parent => {
  await Promise.all(cases.map(({ name, body }) => parent.test(name, body)));
});
