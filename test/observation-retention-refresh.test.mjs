export const validationDeclarations = {
  "schemaVersion": 1,
  "assertionNamespace": "test/observation-retention-regression.test.mjs"
};
import test from 'node:test';
import { runRefreshWorker } from './observation-refresh-worker.mjs';

test('FR-063/064 real refresh and prune archive superseded observations/facts before exhaustion', async t => {
  const { outcome, report, leases } = await runRefreshWorker(t);
  t.diagnostic(JSON.stringify({ refreshWorker: outcome, leases,
    process: { pid: report.pid, complete: report.complete, exitCode: report.exitCode,
      startedAt: report.startedAt, finishedAt: report.finishedAt, cleanup: report.cleanup } }));
});
