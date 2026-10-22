import path from 'node:path';
import * as fs from 'node:fs/promises';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';
import { canonical } from '../src/core.mjs';

// Cache only immutable fixture Git reads; transactions and filesystem I/O stay real.
const execute = childProcess.execFile;
const gitReads = new Map();
childProcess.execFile = (file, args, options, callback) => {
  const gitArgs = args.filter(argument => !['--no-pager',
    '--no-optional-locks'].includes(argument));
  const command = gitArgs[0];
  const cacheable = file === 'git' && (['rev-parse', 'symbolic-ref', 'for-each-ref'].includes(command) ||
    command === 'remote' && (gitArgs.length === 1 || gitArgs[1] === 'get-url'));
  if (file === 'git' && !cacheable) gitReads.clear();
  const key = canonical([options.cwd, args]);
  if (cacheable && gitReads.has(key)) {
    const { stdout, stderr } = gitReads.get(key);
    queueMicrotask(() => callback(null, stdout, stderr));
    return undefined;
  }
  return execute(file, args, options, (error, stdout, stderr) => {
    if (!error && cacheable) gitReads.set(key, { stdout, stderr });
    callback(error, stdout, stderr);
  });
};
const cachedGit = childProcess.execFile;
cachedGit[promisify.custom] = (file, args, options) => new Promise((resolve, reject) => {
  cachedGit(file, args, options, (error, stdout, stderr) => {
    if (error) reject(error);
    else resolve({ stdout, stderr });
  });
});
syncBuiltinESMExports();
export const { fixture, observeFixtureRepository } = await import('./helpers.mjs');
export const { pruneWork } = await import('../src/operations.mjs');
export const { adoptPr, evaluateReadiness, updatePrFacts } = await import('../src/pr.mjs');
export const { archiveSupersededObservations, withObservationRetention } =
  await import('../src/observation-retention.mjs');
export const { currentArtifact, currentDeployment } = await import('../src/current-evidence.mjs');
export const { deriveIntendedOutcome } = await import('../src/external-results.mjs');
export const { attachMonitor, monitorAssociationKey, withMonitorLocks } =
  await import('../src/monitors.mjs');
export const { immutableJson, readJson, withLock, writeJson } = await import('../src/files.mjs');
childProcess.execFile = execute;
syncBuiltinESMExports();

export async function retentionFixture(t) {
  const f = await fixture(t);
  await f.runGit('commit', '--allow-empty', '-qm', 'Retention fixture baseline');
  f.store.verifyPullRequest = ({ adapterObservation: observation }) => ({
    canonicalLocalRepositoryPath: observation.localRepositoryPath,
    verifiedRemoteRepositoryURL: observation.remoteRepositoryURL,
    verifiedProvider: observation.provider,
    verifiedConnection: observation.connection,
    verifiedRepositoryRef: observation.repositoryRef,
    verifiedPullRequestRef: observation.pullRequestRef,
    verifiedSourceBranchRef: observation.sourceBranchRef,
    verifiedTargetBranchRef: observation.targetBranchRef,
    verifiedSourceRevision: observation.sourceRevision,
    verifiedTargetRevision: observation.targetRevision,
    verifiedState: observation.state,
    verifiedObservedAt: observation.observedAt,
    verifiedEvidenceRef: observation.evidenceRef,
  });
  return f;
}

export async function refreshPr(f, repository, predecessor, overrides = {}) {
  f.clock.advance(1);
  const observation = {
    repositoryId: repository.repositoryId,
    localRepositoryPath: repository.localRepositoryPath,
    remoteRepositoryURL: repository.remoteRepositoryURL,
    provider: repository.provider, connection: repository.connection,
    repositoryRef: repository.repositoryRef, pullRequestRef: 'retention-pr',
    sourceBranchRef: 'refs/heads/feature/fixture',
    targetBranchRef: 'refs/heads/main',
    sourceRevision: repository.revision, targetRevision: 'b'.repeat(40),
    state: 'active', observedAt: new Date(f.clock.now()).toISOString(),
    evidenceRef: `fixture:pr:${f.clock.now()}`, ...overrides,
  };
  return (await adoptPr(f.store, {
    workItemId: f.workItemId, observation, adapterObservation: observation,
    ...(predecessor ? { previousObservationKey: predecessor.id } : {}),
  })).observation;
}

export const factsInput = (f, pr) => ({
  workItemId: f.workItemId, prRecordId: pr.id, policyVersion: 'policy-1',
  sourceRevision: pr.sourceRevision, targetRevision: pr.targetRevision,
  requiredChecks: [], checks: [], reviewsSatisfied: true,
  providerEvidenceRef: 'fixture:policy',
});

export async function archivedBytes(f, recordId) {
  return fs.readFile(path.join(f.store.workPath(f.workItemId),
    'evidence', `${recordId}.json`));
}
