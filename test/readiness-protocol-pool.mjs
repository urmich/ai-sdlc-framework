import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { digest } from '../src/core.mjs';
import { enterTestBudget } from '../scripts/test-budget.mjs';
import { resolveValidationWorkers, runValidationReadyPool } from '../scripts/test-scheduling.mjs';
import { executeValidationCommand, processDiagnostic } from '../scripts/validation-tools.mjs';
import { protocolPairs } from './readiness-protocol-row.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const defaultWorker = new URL('./readiness-protocol-worker.mjs', import.meta.url);

export async function protocolPoolIdentity(rows, worker = defaultWorker) {
  const sources = await Promise.all([
    new URL('./readiness-protocol-row.mjs', import.meta.url),
    new URL('./readiness-protocol-pool.mjs', import.meta.url),
    new URL('./readiness-observer-fixture.mjs', import.meta.url), worker,
  ].map(async url => ({ file: path.relative(repositoryRoot, fileURLToPath(url)), digest: digest(await fs.readFile(url)) })));
  return { sourceDigest: digest({ rows, sources }), sources };
}

function validateProtocolOutcome(outcome, pair, index, sourceDigest) {
  assert.equal(outcome.index, index, 'Child returned a foreign protocol row');
  assert.deepEqual(outcome.pair, pair, 'Mismatched protocol row pair');
  assert.equal(outcome.sourceDigest, sourceDigest, 'Mismatched protocol row source');
  assert.equal(outcome.groupId, digest({ sourceDigest, index, pair }), 'Mismatched protocol row group');
  assert.equal(outcome.status, 'Passed', 'Incomplete protocol row outcome');
  assert.equal(outcome.cleaned, true, 'Protocol row teardown must finish before its outcome');
  assert.ok(Number.isInteger(outcome.pid) && outcome.pid > 0);
  assert.match(outcome.slot, /^[a-f0-9-]{36}$/u);
  assert.equal(outcome.lease.pid, outcome.pid);
  assert.equal(outcome.lease.slot, outcome.slot);
  assert.equal(outcome.lease.minimumSlots, 1);
  assert.equal(outcome.lease.finishedAt, null, 'Capture the actual lease while the child holds it');
  assert.ok(Date.parse(outcome.finishedAt) >= Date.parse(outcome.lease.startedAt));
}

export function reconcileProtocolRows(rows, outcomes, sourceDigest) {
  assert.equal(outcomes.length, rows.length, 'Missing protocol row outcomes');
  const seen = new Set();
  for (const outcome of outcomes) {
    assert.ok(Number.isInteger(outcome.index) && outcome.index >= 0 && outcome.index < rows.length,
      'Unknown protocol row outcome');
    assert.ok(!seen.has(outcome.index), 'Duplicate protocol row outcome');
    seen.add(outcome.index);
    validateProtocolOutcome(outcome, rows[outcome.index], outcome.index, sourceDigest);
  }
  assert.equal(new Set(outcomes.map(outcome => outcome.slot)).size, outcomes.length,
    'Each row must own a distinct process lease, even if the OS reuses an exited PID');
  return [...outcomes].sort((left, right) => left.index - right.index);
}

export async function runProtocolPool(t, { workers, worker = defaultWorker, rows = protocolPairs } = {}) {
  assert.ok(rows.length > 0 && rows.length <= protocolPairs.length &&
    rows.every(pair => protocolPairs.some(expected => JSON.stringify(pair) === JSON.stringify(expected))) &&
    new Set(rows.map(pair => JSON.stringify(pair))).size === rows.length,
  'Protocol requests must be unique source-declared pairs');
  const resources = resolveValidationWorkers({ availableParallelism: os.availableParallelism(),
    totalMemoryBytes: os.totalmem(), requested: workers ?? process.env.SDLC_TEST_WORKERS ?? null });
  const requested = Math.min(4, resources.workers);
  const root = path.join(repositoryRoot, '.test-data', `protocol-pool-${randomUUID()}`);
  const retained = [];
  let allocation;
  const retentionDiagnostic = () => ({
    code: 'PROTOCOL_POOL_CLEANUP_UNVERIFIED',
    message: 'Retained owned protocol paths because command writers remain unverified.',
    root, operations: retained, allocation: allocation ?? null,
  });
  await fs.mkdir(root, { recursive: true });
  t.after(async () => {
    if (retained.length) {
      t.diagnostic(JSON.stringify(retentionDiagnostic()));
      return;
    }
    await fs.rm(root, { recursive: true });
    await assert.rejects(fs.stat(root), { code: 'ENOENT' });
  });
  const { sourceDigest, sources } = await protocolPoolIdentity(rows, worker);
  const budget = await enterTestBudget({ workers: requested, fileCount: rows.length });
  const groups = rows.map((pair, index) => ({ id: digest({ sourceDigest, index, pair }),
    index, pair, minimumSlots: 1, dependsOn: [], exclusiveResources: [] }));
  const reports = [];
  const outcomes = [];
  const failures = [];
  const cleanupFailures = [];
  const stopped = new AbortController();
  let primary;
  try {
    let poolError;
    let pool;
    try {
      pool = await runValidationReadyPool(groups, { concurrency: budget.workers,
        capacity: budget.workers, signal: AbortSignal.any([budget.signal, stopped.signal]), execute: async group => {
          const scratch = path.join(root, `scratch-${group.index}`);
          const lifetime = { cleanupSafe: true, unsettledCommands: [] };
          try {
            await fs.mkdir(scratch);
            const report = await executeValidationCommand({
              name: `row-${group.index}`, command: process.execPath,
              args: [fileURLToPath(worker), String(group.index), sourceDigest, scratch,
                group.id, JSON.stringify(group.pair)],
              cwd: repositoryRoot, outputDir: root,
              environment: { ...process.env, ...budget.environment,
                TMPDIR: scratch, TMP: scratch, TEMP: scratch },
              signal: budget.signal, lifetime,
            });
            reports.push({ index: group.index, ...report });
            assert.equal(report.complete, true, `Protocol row ${group.index} process was incomplete`);
            assert.equal(report.exitCode, 0,
              `Protocol row ${group.index} child failed: ${processDiagnostic({ message: report.stderr }).message}`);
            assert.equal(report.cleanup.rootExitObserved, true, 'Drain the actual owned child before returning');
            const outcome = JSON.parse(report.stdout);
            assert.equal(outcome.pid, report.pid, 'Child outcome must identify the owned process');
            validateProtocolOutcome(outcome, group.pair, group.index, sourceDigest);
            assert.ok(Date.parse(outcome.lease.startedAt) >= Date.parse(report.startedAt) &&
              Date.parse(outcome.finishedAt) <= Date.parse(report.finishedAt),
            'The live lease and completed row must belong to the actual child execution interval');
            if (worker.href === defaultWorker.href) {
              assert.equal(typeof outcome.fixtureRoot, 'string', 'A complete whole row must identify its cleaned fixture');
            }
            if (outcome.fixtureRoot) {
              assert.equal(path.dirname(outcome.fixtureRoot), scratch);
              assert.match(path.basename(outcome.fixtureRoot), /^observer-api-[a-f0-9-]{36}$/u);
              await assert.rejects(fs.stat(outcome.fixtureRoot), { code: 'ENOENT' });
            }
            outcomes.push(outcome);
            return 'Passed';
          } catch (error) {
            failures.push({ index: group.index, error });
            stopped.abort();
            throw error;
          } finally {
            try {
              if (!lifetime.cleanupSafe) {
                retained.push({ index: group.index, scratch, unsettledCommands: [...lifetime.unsettledCommands] });
                throw Object.assign(new Error('Retained owned protocol scratch because command writers remain unverified.'),
                  { code: 'PROTOCOL_POOL_CLEANUP_UNVERIFIED' });
              }
              await fs.rm(scratch, { recursive: true, force: true });
              await assert.rejects(fs.stat(scratch), { code: 'ENOENT' });
            } catch (error) {
              stopped.abort();
              cleanupFailures.push({ index: group.index, ...processDiagnostic(error) });
              if (!failures.some(failure => failure.index === group.index)) {
                failures.push({ index: group.index, error });
                throw error;
              }
            }
          }
        } });
    } catch (error) { poolError = error; }
    const ordered = failures.sort((left, right) => left.index - right.index);
    const failure = ordered[0]?.error ?? poolError;
    let snapshotError;
    try { allocation = await budget.snapshot(); }
    catch (error) { snapshotError = error; }
    if (failure || snapshotError) {
      const error = failure ?? snapshotError;
      error.protocolPool = { sourceDigest, sources, allocation: allocation ?? null,
        failures: ordered.map(({ index, error }) => ({ index, ...processDiagnostic(error) })),
        snapshotFailure: snapshotError ? processDiagnostic(snapshotError) : null,
        cleanupFailures, retention: retained.length ? retentionDiagnostic() : null,
        reports: reports.sort((left, right) => left.index - right.index) };
      throw error;
    }
    assert.equal(pool.notRun.length, 0, 'Every protocol row must complete; cancellation is not passing');
    assert.equal(pool.completed.size, rows.length);
    return { sourceDigest, sources, allocation, resources, workers: budget.workers,
      rows: reconcileProtocolRows(rows, outcomes, sourceDigest),
      reports: reports.sort((left, right) => left.index - right.index) };
  } catch (error) { primary = error; throw error; }
  finally {
    try { await budget.close(); }
    catch (error) {
      if (!primary) throw error;
      primary.budgetCleanup = processDiagnostic(error);
    }
  }
}
