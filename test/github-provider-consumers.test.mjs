export const validationDeclarations = {
  "schemaVersion": 1,
  "variants": [
    {"expression": "id", "names": [
      "T-GH-36-ADO01-N", "T-GH-36-ADO01-G", "T-GH-36-ADO01-D", "T-GH-36-ADO01-P",
      "T-GH-36-ADO02-N", "T-GH-36-ADO02-G", "T-GH-36-ADO02-D", "T-GH-36-ADO02-P",
      "T-GH-36-ADO03-N", "T-GH-36-ADO03-G", "T-GH-36-ADO03-D", "T-GH-36-ADO03-P",
      "T-GH-36-ADO04-N", "T-GH-36-ADO04-G", "T-GH-36-ADO04-D", "T-GH-36-ADO04-P",
      "T-GH-36-ADO05-N", "T-GH-36-ADO05-G", "T-GH-36-ADO05-D", "T-GH-36-ADO05-P",
      "T-GH-36-ADO06-N", "T-GH-36-ADO06-G", "T-GH-36-ADO06-D", "T-GH-36-ADO06-P",
      "T-GH-36-ADO07-N", "T-GH-36-ADO07-G", "T-GH-36-ADO07-D", "T-GH-36-ADO07-P",
      "T-GH-36-ADO08-N", "T-GH-36-ADO08-G", "T-GH-36-ADO08-D", "T-GH-36-ADO08-P",
      "T-GH-36-ADO09-N", "T-GH-36-ADO09-G", "T-GH-36-ADO09-D", "T-GH-36-ADO09-P",
      "T-GH-36-ADO10-N", "T-GH-36-ADO10-G", "T-GH-36-ADO10-D", "T-GH-36-ADO10-P",
      "T-GH-36-ADO11-N", "T-GH-36-ADO11-G", "T-GH-36-ADO11-D", "T-GH-36-ADO11-P",
      "T-GH-36-ADO12-N", "T-GH-36-ADO12-G", "T-GH-36-ADO12-D", "T-GH-36-ADO12-P",
      "T-GH-36-ADO13-N", "T-GH-36-ADO13-G", "T-GH-36-ADO13-D", "T-GH-36-ADO13-P",
      "T-GH-36-ADO14-N", "T-GH-36-ADO14-G", "T-GH-36-ADO14-D", "T-GH-36-ADO14-P",
      "T-GH-36-ADO15-N", "T-GH-36-ADO15-G", "T-GH-36-ADO15-D", "T-GH-36-ADO15-P",
      "T-GH-36-ADO16-N", "T-GH-36-ADO16-G", "T-GH-36-ADO16-D", "T-GH-36-ADO16-P",
      "T-GH-36-ADO17-N", "T-GH-36-ADO17-G", "T-GH-36-ADO17-D", "T-GH-36-ADO17-P",
      "T-GH-36-ADO18-N", "T-GH-36-ADO18-G", "T-GH-36-ADO18-D", "T-GH-36-ADO18-P",
      "T-GH-36-ADO19-N", "T-GH-36-ADO19-G", "T-GH-36-ADO19-D", "T-GH-36-ADO19-P",
      "T-GH-36-ADO20-N", "T-GH-36-ADO20-G", "T-GH-36-ADO20-D", "T-GH-36-ADO20-P",
      "T-GH-36-ADO21-N", "T-GH-36-ADO21-G", "T-GH-36-ADO21-D", "T-GH-36-ADO21-P",
      "T-GH-36-ADO22-N", "T-GH-36-ADO22-G", "T-GH-36-ADO22-D", "T-GH-36-ADO22-P",
      "T-GH-36-ADO23-N", "T-GH-36-ADO23-G", "T-GH-36-ADO23-D", "T-GH-36-ADO23-P",
      "T-GH-36-ADO24-N", "T-GH-36-ADO24-G", "T-GH-36-ADO24-D", "T-GH-36-ADO24-P"
    ]},
    {"expression": "name", "names": ["wrong original producer", "same name from another App", "API head without actual executed checkout", "missing original selected-test source"]}
  ]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { Store } from '../src/store.mjs';
import { digest } from '../src/core.mjs';
import { install } from '../src/install.mjs';
import { adoptPr } from '../src/pr.mjs';
import { evaluatePolicy } from '../src/policy.mjs';
import {
  validateRepositoryObservation, validateSelectedFetchRemote, validateSelectedPushRemote,
} from '../src/repository-observations.mjs';
import {
  createGitHubStoreBridge, registerGitHubAdapter,
} from 'ai-sdlc-framework/github';
import {
  providerAdapterIds, registerProviderAdapter, validateAdapterExecutionIdentity, verifyProviderLink,
} from '../src/provider-adapters.mjs';
import {
  attachMonitor, claimMonitor, beginPoll, observeMonitor, verifyMonitorLink,
} from '../src/monitors.mjs';
import { bridgeFixture, connectionId, durableBytes, remote, repositoryRef } from './fixtures/github-store-bridge.mjs';

test('GH-36 all approved atomic parity quartets use actual existing consumers', async t => {
  const f = await bridgeFixture(t);
  const expectedIds = new Set(Array.from({ length: 24 }, (_, index) =>
    ['P', 'N', 'G', 'D'].map(variant => `T-GH-36-ADO${String(index + 1).padStart(2, '0')}-${variant}`)).flat());
  const executedIds = new Set();
  const identity = {
    provider: 'github', connection: connectionId, scopeRef: repositoryRef,
    definitionRef: '301', executionRef: '401', attemptKind: 'known', attemptRef: '2',
  };
  const repositoryVerification = await f.store.verifyRepository(f.boundaryInput);
  const repo = {
    ...f.repositoryInput, observedAt: repositoryVerification.verifiedObservedAt,
    evidenceRef: repositoryVerification.verifiedEvidenceRef,
  };
  const repoProof = Object.fromEntries(['canonicalLocalRepositoryPath', 'verifiedRemoteRepositoryURL',
    'verifiedProvider', 'verifiedConnection', 'verifiedRepositoryRef', 'verifiedBranch']
    .map(field => [field, repositoryVerification[field]]));
  const validateRepo = (source, verification) => {
    const { workItemId, repositoryId, selectedRemoteName, ...observation } = source;
    void workItemId; void repositoryId; void selectedRemoteName;
    return validateRepositoryObservation(observation, verification);
  };
  const nativeRun = await f.acquire('GET', '/repos/bridge-owner/bridge-repo/actions/runs/401/attempts/2', {
    id: 401, workflow_id: 301, run_attempt: 2,
    repository: Object.fromEntries(Object.entries(f.repositoryBody).filter(([field]) => field !== 'url')),
    html_url: 'https://github.com/bridge-owner/bridge-repo/actions/runs/401', status: 'completed', conclusion: 'success',
  });
  const link = () => ({
    connection: connectionId,
    run: Object.fromEntries(['id', 'workflow_id', 'run_attempt', 'repository', 'html_url']
      .map(field => [field, structuredClone(nativeRun.body[field])])),
    access: { accessible: true, finalUrl: 'https://github.com/bridge-owner/bridge-repo/actions/runs/401/attempts/2' },
  });
  const reject = async (call, code = 'EVIDENCE') => {
    const before = await durableBytes(f);
    await assert.rejects(call, error => {
      assert.ok((Array.isArray(code) ? code : [code]).includes(error.code), error.message);
      return true;
    });
    assert.deepEqual(await durableBytes(f), before);
  };
  const assertUnverified = async observation => {
    const result = await verifyProviderLink('github', identity, observation);
    assert.equal(result.verified, false);
    assert.equal(typeof result.reason, 'string');
  };
  const deniedRepository = async () => {
    f.denyNext();
    const before = await durableBytes(f);
    await assert.rejects(f.store.observeRepository({ ...repo, observedAt: new Date(f.clock.now()).toISOString() }), error => {
      assert.equal(error.code, 'PERMISSION');
      assert.equal(error.details.status, 403);
      assert.equal(error.details.connectionId, connectionId);
      return true;
    });
    assert.deepEqual(await durableBytes(f), before);
  };
  const deniedRun = async () => {
    f.denyNext();
    const before = await durableBytes(f);
    await assert.rejects(f.acquire('GET', '/repos/bridge-owner/bridge-repo/actions/runs/401/attempts/2',
      nativeRun.body), error => {
      assert.equal(error.code, 'PERMISSION');
      assert.equal(error.details.status, 403);
      assert.equal(error.details.connectionId, connectionId);
      return true;
    });
    assert.deepEqual(await durableBytes(f), before);
  };
  const deniedPr = async () => {
    f.denyNext('/repos/bridge-owner/bridge-repo/pulls/1');
    await reject(() => f.acquirePr({
      headRef: 'main', sourceRepository: f.forkRepository,
    }), 'PERMISSION');
  };
  const quartet = async (number, cases) => {
    const prefix = `T-GH-36-ADO${String(number).padStart(2, '0')}`;
    for (const variant of ['N', 'G', 'D', 'P']) {
      const id = `${prefix}-${variant}`;
      assert.ok(expectedIds.has(id), `No approved atomic parity contract for ${id}`);
      await t.test(id, async () => {
        assert.equal(typeof cases[variant], 'function', `${id} requires its own exact consumer assertion`);
        await cases[variant]();
        executedIds.add(id);
      });
    }
  };
  const packets = new Map();
  const packet = async family => {
    if (!packets.has(family)) {
      if (family === 'test') {
        const producer = (await prove('execution')).operation;
        if (!f.selectedArtifact) f.selectedArtifact = await f.selectArtifact(producer);
        f.deployment = (await prove('deployment')).operation;
      }
      const prepared = await f.prepare(family);
      const acquired = await f.result(prepared);
      packets.set(family, { prepared, acquired });
    }
    return packets.get(family);
  };
  const prove = async family => {
    const entry = await packet(family);
    const { prepared, acquired } = entry;
    const verified = f.verified(acquired);
    const operation = await f.record(prepared, acquired);
    entry.operation = operation;
    const proof = operation.resultProof;
    assert.equal(proof.status, 'succeeded');
    assert.equal(proof.dispatchId, prepared.claim.operation.id);
    const retained = (await f.store.records(f.workItemId)).find(value => value.id === operation.id);
    assert.deepEqual(retained.resultProof, proof);
    return { prepared, verified, proof, operation };
  };
  const rejectPacket = async (family, mutate) => {
    const { prepared, acquired } = await packet(family);
    await reject(() => f.record(prepared, f.variant(acquired, mutate)), ['EVIDENCE', 'ID_CONFLICT']);
  };
  const denyPacket = async family => {
    const { prepared } = await packet(family);
    await reject(() => f.record(prepared, f.deniedResult(prepared)), 'AUTHORITY');
  };

  await quartet(1, {
    D: deniedRun,
    N: () => reject(async () => validateAdapterExecutionIdentity('unregistered', identity), 'ADAPTER'),
    G: async () => {
      registerProviderAdapter({ id: 'github-without-capability', linkKinds: ['summary'],
        normalizeLinkObservation: value => value });
      await reject(async () => validateAdapterExecutionIdentity('github-without-capability',
        { ...identity, provider: 'github-without-capability' }), 'EVIDENCE');
    },
    P: async () => {
      if (!providerAdapterIds().includes('github')) registerGitHubAdapter();
      assert.deepEqual(validateAdapterExecutionIdentity('github', identity), identity);
      const azure = { provider: 'azure-devops', connection: 'fixture', scopeRef: 'project:10',
        definitionRef: '301', executionRef: '401', attemptKind: 'not-applicable' };
      assert.deepEqual(validateAdapterExecutionIdentity('azure-devops', azure), azure);
    },
  });
  await quartet(2, {
    D: deniedRun,
    N: async () => assert.equal((await verifyProviderLink('github',
      { ...identity, scopeRef: 'bridge-owner/bridge-repo' }, link())).verified, false),
    G: async () => { const value = link(); delete value.run.repository.id; await assertUnverified(value); },
    P: async () => assert.equal((await verifyProviderLink('github', identity, link())).identity.scopeRef, repositoryRef),
  });
  await quartet(3, {
    D: deniedRun,
    N: async () => assert.equal((await verifyProviderLink('github', { ...identity, definitionRef: '999' }, link())).verified, false),
    G: async () => { const value = link(); delete value.run.run_attempt; await assertUnverified(value); },
    P: async () => {
      const result = await verifyProviderLink('github', identity, link());
      assert.equal(result.verified, true);
      assert.deepEqual(result.identity, identity);
    },
  });
  await quartet(4, {
    D: deniedRun,
    N: async () => {
      const value = link(); value.access.finalUrl = 'https://api.github.com/repos/bridge-owner/bridge-repo/actions/runs/401';
      await assertUnverified(value);
    },
    G: async () => { const value = link(); value.access.accessible = false; await assertUnverified(value); },
    P: async () => {
      f.monitor = await attachMonitor(f.store, { identity, origin: 'framework',
        schedulerAvailable: true, readAvailable: true, workItemId: f.workItemId });
      const result = await verifyMonitorLink(f.store, { runKey: f.monitor.key, adapterId: 'github',
        observation: link(), evidenceRef: 'fixture:human-attempt-page' });
      assert.equal(result.link.status, 'verified');
      assert.equal(result.link.url, link().access.finalUrl);
    },
  });
  await quartet(5, {
    D: deniedRun,
    N: async () => {
      const value = link(); value.access.finalUrl = 'https://github.com/bridge-owner/bridge-repo/actions/runs/999/attempts/2';
      await assertUnverified(value);
    },
    G: async () => { const value = link(); delete value.access.finalUrl; await assertUnverified(value); },
    P: async () => assert.equal((await verifyProviderLink('github', identity, link())).verified, true),
  });
  await quartet(6, {
    D: deniedRepository,
    N: () => reject(async () => createGitHubStoreBridge({ verifiers: {
      verifyRepository: { module: 'repository-controlled.mjs' },
    } }), 'ADAPTER'),
    G: () => reject(() => createGitHubStoreBridge().storeOptions().verifyRepository(f.boundaryInput), 'ADAPTER'),
    P: async () => {
      const verified = await f.store.verifyRepository(f.boundaryInput);
      assert.equal(verified.verifiedRepositoryRef, repositoryRef);
      assert.equal(verified.canonicalLocalRepositoryPath, f.repo);
    },
  });
  await quartet(7, {
    D: deniedRepository,
    N: () => reject(async () => validateRepo({ ...repo,
      localRepositoryPath: path.join(f.repo, 'foreign') }, repoProof)),
    G: () => reject(async () => {
      const proof = { ...repoProof }; delete proof.verifiedRepositoryRef;
      validateRepo(repo, proof);
    }, 'INPUT'),
    P: async () => {
      const result = await f.store.observeRepository(repo);
      assert.equal(result.localRepositoryPath, f.repo);
      assert.equal(result.repositoryRef, repositoryRef);
    },
  });
  await quartet(8, {
    D: deniedRepository,
    N: () => reject(async () => validateRepo({ ...repo,
      remoteRepositoryURL: 'git@github.com:bridge-owner/bridge-repo.git' }, repoProof)),
    G: () => reject(() => createGitHubStoreBridge().storeOptions().verifyRepository(f.boundaryInput), 'ADAPTER'),
    P: async () => {
      const current = await f.store.currentRepositoryObservation(f.workItemId, 'primary', 'origin');
      assert.equal(validateSelectedFetchRemote(current.selectedFetchRemote), current.observation.remoteRepositoryURL);
    },
  });
  await quartet(9, {
    D: async () => {
      await f.runGit('config', 'remote.origin.pushurl', 'git@github.com:bridge-owner/bridge-repo.git');
      try {
        f.denyNext();
        await reject(() => f.store.observeRepository({
          ...repo, pushURL: true, remoteRepositoryURL: 'git@github.com:bridge-owner/bridge-repo.git',
          observedAt: new Date(f.clock.now()).toISOString(),
        }), 'PERMISSION');
      } finally { await f.runGit('config', '--unset', 'remote.origin.pushurl'); }
    },
    N: async () => {
      await f.runGit('config', 'remote.origin.pushurl', 'git@github.com:bridge-owner/bridge-repo.git');
      try {
        await reject(() => f.store.observeRepository({ ...repo, pushURL: true }));
      } finally { await f.runGit('config', '--unset', 'remote.origin.pushurl'); }
    },
    G: () => reject(async () => validateSelectedPushRemote({ selectedRemoteName: 'origin' }), 'INPUT'),
    P: async () => {
      const pushURL = 'git@github.com:bridge-owner/bridge-repo.git';
      await f.runGit('config', 'remote.origin.pushurl', pushURL);
      try {
        const verified = await f.store.verifyRepository({ ...f.boundaryInput, remoteRepositoryURL: pushURL });
        const observed = await f.store.observeRepository({
          ...repo, pushURL: true, remoteRepositoryURL: pushURL,
          observedAt: verified.verifiedObservedAt, evidenceRef: verified.verifiedEvidenceRef,
        });
        assert.equal(observed.remoteRepositoryURL, pushURL);
        const state = await f.store.load(f.workItemId);
        assert.equal(evaluatePolicy(state, {
          class: 'push', repositoryId: 'primary', localRepositoryPath: f.repo, remoteRepositoryURL: pushURL,
          sourceRevision: f.revision, sourceRef: 'refs/heads/feature/fixture',
          targetRef: 'refs/heads/feature/fixture', target: 'origin',
          remoteUrlDigest: digest([pushURL]), force: false, delete: false,
        }, { clock: f.clock }).allowed, false);
      } finally { await f.runGit('config', '--unset', 'remote.origin.pushurl'); }
    },
  });
  await quartet(10, {
    D: deniedRepository,
    N: () => reject(async () => validateRepo({ ...repo,
      verifiedBranch: { branchRef: 'refs/heads/feature/fixture-copy', revision: f.revision } }, repoProof)),
    G: () => reject(async () => {
      const proof = { ...repoProof }; delete proof.verifiedBranch;
      validateRepo(repo, proof);
    }),
    P: async () => {
      const actual = validateRepo(repo, repoProof);
      assert.deepEqual(actual.verifiedBranch, { branchRef: 'refs/heads/feature/fixture', revision: f.revision });
      assert.equal(actual.defaultBranchRef, 'refs/heads/main');
    },
  });
  const forkInput = () => ({ headRef: 'main', sourceRepository: f.forkRepository });
  await quartet(11, {
    D: deniedPr,
    N: () => reject(() => f.acquirePr({ ...forkInput(), borrowHead: true })),
    G: () => reject(() => f.acquirePr({ ...forkInput(), omitHead: true }), 'PROOF_GAP'),
    P: async () => {
      const acquired = await f.acquirePr(forkInput());
      f.pr = (await adoptPr(f.store, { workItemId: f.workItemId, ...acquired })).observation;
      assert.equal(f.pr.sourceRepositoryURL, f.forkRepository.clone_url);
      assert.equal(f.pr.sourceBranchRef, f.pr.targetBranchRef);
    },
  });
  await quartet(12, {
    D: deniedPr,
    N: async () => {
      const acquired = await f.acquirePr(forkInput());
      await reject(() => adoptPr(f.store, { workItemId: f.workItemId, ...acquired,
        observation: { ...acquired.observation, pullRequestRef: 'pull-request:999' } }));
    },
    G: () => reject(() => f.acquirePr({ ...forkInput(), omitHead: true }), 'PROOF_GAP'),
    P: async () => {
      f.clock.advance(1);
      const acquired = await f.acquirePr({ ...forkInput(), sequence: 2, previousObservationKey: f.pr.id });
      f.pr = (await adoptPr(f.store, { workItemId: f.workItemId, ...acquired, previousObservationKey: f.pr.id })).observation;
      assert.equal(f.pr.pullRequestRef, 'pull-request:801');
      assert.equal(f.pr.sourceRevision, f.revision);
      assert.equal(f.pr.state, 'active');
    },
  });
  await quartet(13, {
    D: deniedPr,
    N: async () => {
      const acquired = await f.acquirePr(forkInput());
      await reject(() => adoptPr(f.store, { workItemId: f.workItemId, ...acquired,
        previousObservationKey: 'stale-predecessor' }), 'STALE');
    },
    G: async () => {
      const acquired = await f.acquirePr(forkInput());
      await reject(() => adoptPr(f.store, { workItemId: f.workItemId, ...acquired }), 'STALE');
    },
    P: async () => {
      f.clock.advance(1);
      const acquired = await f.acquirePr({ ...forkInput(), sequence: 3, previousObservationKey: f.pr.id });
      f.pr = (await adoptPr(f.store, { workItemId: f.workItemId, ...acquired, previousObservationKey: f.pr.id })).observation;
      assert.equal(f.pr.sequence, 3);
    },
  });
  await quartet(14, {
    D: deniedRun,
    N: async () => {
      const value = link();
      delete value.run.run_attempt;
      await assertUnverified(value);
      assert.equal((await verifyProviderLink('github', { ...identity, attemptRef: '1' }, link())).verified, false);
    },
    G: () => reject(async () => validateAdapterExecutionIdentity('github-without-capability',
      { ...identity, provider: 'github-without-capability' })),
    P: async () => assert.equal(validateAdapterExecutionIdentity('github', identity).attemptRef, '2'),
  });
  await quartet(15, {
    D: deniedRun,
    N: async () => {
      const parsedOnly = { identity, url: link().access.finalUrl, kind: 'summary', accessible: true };
      const result = await verifyMonitorLink(f.store, { runKey: f.monitor.key, adapterId: 'github',
        observation: parsedOnly, evidenceRef: 'fixture:parser-only' });
      assert.equal(result.link.status, 'unverified');
      assert.equal(result.runStatus, 'unknown');
    },
    G: async () => {
      const value = link();
      value.access.accessible = false;
      const before = await durableBytes(f);
      await assertUnverified(value);
      assert.deepEqual(await durableBytes(f), before);
    },
    P: async () => {
      const claimed = await claimMonitor(f.store, { runKey: f.monitor.key, workerId: 'worker' });
      const poll = await beginPoll(f.store, { runKey: f.monitor.key, workerId: 'worker', claimGeneration: claimed.claimGeneration });
      const result = await observeMonitor(f.store, {
        runKey: f.monitor.key, workerId: 'worker', claimGeneration: claimed.claimGeneration,
        pollGeneration: poll.pollGeneration, identity, status: 'succeeded', evidenceRef: 'fixture:exact-run-poll',
      });
      const linked = await verifyMonitorLink(f.store, { runKey: result.key, adapterId: 'github',
        observation: link(), evidenceRef: 'fixture:human-attempt-page' });
      assert.equal(linked.runStatus, 'succeeded');
      assert.equal(linked.link.status, 'verified');
    },
  });
  const effectCases = [
    [16, 'execution', value => { value.observation.providerResultId = 'unrelated-run'; },
      value => { delete value.observation.causalProof; }],
    [17, 'test', value => { value.observation.result.testId = 'wrong-test'; },
      value => { delete value.observation.result.deploymentId; }],
    [18, 'artifact', value => { value.observation.result.executionIdentity.executionRef = '999'; },
      value => { delete value.observation.result.attemptRef; }],
    [19, 'deployment', value => { value.observation.result.environment = 'STAGING'; },
      value => { delete value.observation.causalProof; }],
    [20, 'pull-request', value => { value.observation.result.prId = 'pull-request:999'; },
      value => { delete value.observation.causalProof; }],
    [21, 'git-ref', value => { value.observation.result.revision = 'f'.repeat(40); },
      value => { delete value.observation.result.published; }],
  ];
  for (const [number, family, negative, gap] of effectCases) await quartet(number, {
    N: () => rejectPacket(family, negative), G: () => rejectPacket(family, gap), D: () => denyPacket(family),
    P: async () => {
      const { prepared, verified, proof } = await prove(family);
      assert.equal(verified.observation.family, prepared.claim.operation.intendedOutcome.family);
      assert.equal(proof.intendedOutcomeDigest, prepared.claim.operation.intendedOutcome.digest);
      if (family === 'artifact') assert.equal(proof.artifactIdentity.producingExecution.attemptRef, '2');
      if (family === 'test') {
        const evidence = (await f.store.records(f.workItemId)).find(value => value.type === 'test-evidence' &&
          value.operationId === proof.dispatchId);
        assert.equal(evidence.status, 'Passed');
        assert.equal(evidence.deploymentId, f.deployment.id);
      }
      if (family === 'git-ref') assert.equal(verified.observation.result.published, true);
    },
  });
  await quartet(22, {
    N: async () => {
      const policy = await prove('policy');
      const merge = await packet('merge');
      const policyPacket = await packet('policy');
      await reject(() => f.record(merge.prepared, policyPacket.acquired), 'EVIDENCE');
      assert.equal(policy.proof.mergeRevision, undefined);
    },
    G: () => rejectPacket('policy', value => { delete value.observation.result.changeApplied; }),
    D: () => denyPacket('policy'),
    P: async () => {
      const merge = await prove('merge');
      const policy = await prove('policy');
      assert.equal(merge.verified.observation.result.merged, true);
      assert.equal(merge.verified.observation.result.mergeRevision, f.revision);
      assert.equal(policy.verified.observation.result.changeApplied, true);
      assert.notEqual(policy.verified.observation.result.previousPolicyVersion,
        policy.verified.observation.result.policyVersion);
      assert.ok(f.calls.some(call => call.key === 'POST /graphql' &&
        call.payload.operationName === 'GitHubAutoMergeEnable'));
    },
  });
  await quartet(23, {
    N: () => rejectPacket('execution', value => { value.observation.causalProof.hostCallId = 'similar-run-search'; }),
    G: () => rejectPacket('execution', value => { delete value.observation.causalProof; }),
    D: () => denyPacket('execution'),
    P: async () => {
      const { prepared, proof } = await prove('execution');
      assert.equal(proof.causalKey, `host:${digest(prepared.claim.hostCallId)}`);
      assert.equal(proof.providerResultId, '401:2');
    },
  });

  const installedHome = path.join(f.root, 'installed runtime');
  await install(new Store(installedHome), { sourceRoot: path.resolve('.') });
  const installed = await import(pathToFileURL(path.join(installedHome, 'sdlc', 'src', 'github.mjs')).href);
  const installedCli = await import(pathToFileURL(path.join(installedHome, 'sdlc', 'src', 'cli.mjs')).href);
  const installedBridge = installed.createGitHubStoreBridge({
    clock: f.clock, verifiers: Object.fromEntries(Object.entries(f.bridge.storeOptions())
      .filter(([, value]) => typeof value === 'function')),
  });
  const installedConnection = installed.createGitHubConnection({
    id: connectionId, apiOrigin: 'https://api.github.com', webOrigin: 'https://github.com',
    scopes: [{ kind: 'repository', id: '101', owner: 'bridge-owner', name: 'bridge-repo' }],
  });
  const installedTransport = installed.createGitHubTransport({ connection: installedConnection,
    fetch: () => assert.fail('Installed Store verification must use the explicitly injected trusted acquirer') });
  const host = installed.createGitHubHost({ connections: [{ connection: installedConnection, transport: installedTransport }],
    clock: f.clock, verifiers: Object.fromEntries(Object.entries(installedBridge.storeOptions())
      .filter(([, value]) => typeof value === 'function')) });
  const cli = async (input, factory) => installedCli.runCli([
    'repository', 'observe', '--home', f.home, '--cwd', f.repo,
    '--work-item', f.workItemId, '--session', f.sessionId,
  ], { stdin: Readable.from([JSON.stringify(input)]), stdout: { write() {} }, stderr: { write() {} } },
  factory ? { createStore: factory } : {});
  const currentVerification = await f.store.verifyRepository(f.boundaryInput);
  const cliInput = { ...repo, observedAt: currentVerification.verifiedObservedAt,
    evidenceRef: currentVerification.verifiedEvidenceRef };
  await quartet(24, {
    N: () => reject(() => cli(cliInput, () => ({ fixtureOnly: true, ready: async () => ({}) })), 'ADAPTER'),
    G: () => reject(() => cli(cliInput), 'ADAPTER'),
    D: async () => {
      f.denyNext();
      await reject(() => cli(cliInput, home => installed.createGitHubStore(home, host)), 'PERMISSION');
    },
    P: async () => {
      const selectedHomes = [];
      const result = await cli(cliInput, home => {
        selectedHomes.push(home);
        return installed.createGitHubStore(home, host);
      });
      assert.equal(result.exitCode, 0);
      assert.deepEqual(selectedHomes, [f.home]);
      assert.equal(result.result.provider, 'github');
      assert.equal(result.result.repositoryRef, repositoryRef);
      assert.equal(result.result.localRepositoryPath, f.repo);
      assert.equal(result.result.remoteRepositoryURL, remote);
      assert.ok((await f.store.records(f.workItemId)).some(value => value.id === result.result.id));
    },
  });
  assert.deepEqual([...executedIds].sort(), [...expectedIds].sort());
});

test('retained monitor admits only independently joined PR check job App checkout and selected-test evidence', async t => {
  const f = await bridgeFixture(t);
  const pr = await f.acquirePr({ headRef: 'main', sourceRepository: f.forkRepository });
  f.pr = (await adoptPr(f.store, { workItemId: f.workItemId, ...pr })).observation;
  if (!providerAdapterIds().includes('github')) registerGitHubAdapter();
  const acquired = await f.acquireChecks();
  const attached = await attachMonitor(f.store, {
    identity: acquired.identity, origin: 'framework', schedulerAvailable: true,
    readAvailable: true, workItemId: f.workItemId,
  });
  const claimed = await claimMonitor(f.store, { runKey: attached.key, workerId: 'check-worker' });
  const poll = await beginPoll(f.store, { runKey: attached.key, workerId: 'check-worker',
    claimGeneration: claimed.claimGeneration });
  for (const [name, options, code] of [
    ['wrong original producer', { wrongProducer: true }, 'EVIDENCE'],
    ['same name from another App', { wrongApp: true }, 'EVIDENCE'],
    ['API head without actual executed checkout', { wrongCheckout: true }, 'EVIDENCE'],
    ['missing original selected-test source', { missingSelection: true }, 'PROOF_GAP'],
  ]) await t.test(name, async () => {
    const before = await durableBytes(f);
    await assert.rejects(f.acquireChecks(options), { code });
    assert.deepEqual(await durableBytes(f), before);
  });
  await t.test('actual exact check read denial is not empty success', async () => {
    const before = await durableBytes(f);
    f.denyNext('/repos/bridge-owner/bridge-repo/check-runs/801');
    await assert.rejects(f.acquireChecks(), error => {
      assert.equal(error.code, 'PERMISSION');
      assert.equal(error.details.status, 403);
      assert.equal(error.details.connectionId, connectionId);
      return true;
    });
    assert.deepEqual(await durableBytes(f), before);
  });
  await t.test('original joined check facts enter the actual immutable-evidence monitor consumer', async () => {
    const result = await observeMonitor(f.store, {
      runKey: attached.key, workerId: 'check-worker', claimGeneration: claimed.claimGeneration,
      pollGeneration: poll.pollGeneration, ...acquired, status: 'succeeded',
    });
    assert.equal(result.runStatus, 'succeeded');
    assert.equal(result.evidenceVerification.verified, true);
    assert.deepEqual(result.identity, acquired.identity);
    assert.deepEqual(result.checkResults, acquired.checkResults);
    assert.equal(result.checkResults[0].pullRequestRef, f.pr.pullRequestRef);
    assert.equal(result.checkResults[0].sourceRepositoryURL, f.forkRepository.clone_url);
    assert.equal(result.checkResults[0].testedRevision, f.revision);
    assert.equal(result.nextPollAt, null);
  });
  assert.ok(f.calls.every(call => call.key.startsWith('GET ')), 'Check verification has no physical write effects');
});
