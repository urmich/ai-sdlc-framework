import { pipeline } from 'node:stream/promises';
import { constants } from 'node:os';
import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { sanitizeExecutionPayload } from '../src/validation-evidence.mjs';

const reportPath = process.env.SDLC_TEST_REPORT_FILE;
const reportProfile = process.env.SDLC_TEST_REPORT_PROFILE;
const reportContext = process.env.SDLC_TEST_REPORT_CONTEXT;
delete process.env.SDLC_TEST_REPORT_FILE;
delete process.env.SDLC_TEST_REPORT_PROFILE;
delete process.env.SDLC_TEST_REPORT_CONTEXT;
let reportFile;
let report;

const cancellation = new AbortController();
const cancel = signal => {
  process.exitCode ||= 128 + constants.signals[signal];
  cancellation.abort(new Error(`Test run interrupted by ${signal}`));
};
const interrupt = () => cancel('SIGINT');
const terminate = () => cancel('SIGTERM');
const message = value => {
  if (value?.type === 'cancel' && ['SIGINT', 'SIGTERM'].includes(value.signal)) {
    cancel(value.signal);
  } else {
    console.error('[test-worker:error] Invalid cancellation request.');
    process.exitCode ||= 1;
    cancellation.abort(new Error('Invalid cancellation request'));
  }
};
process.on('SIGINT', interrupt);
process.on('SIGTERM', terminate);
process.on('message', message);
try {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const options = JSON.parse(input);
  if (reportPath) {
    const root = await realpath(path.resolve('.test-data'));
    const parent = await realpath(path.dirname(path.resolve(reportPath)));
    const relative = path.relative(root, parent);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('Test evidence must remain inside repository-local .test-data.');
    }
    reportFile = await open(path.resolve(reportPath), 'wx');
    report = {
      schemaVersion: 1, profile: reportProfile, node: process.version,
      platform: process.platform, architecture: process.arch,
      ...(reportContext ? { context: JSON.parse(reportContext) } : {}),
      files: options.files.map(file => path.relative(options.cwd, file).split(path.sep).join('/')),
      executions: [], summary: null,
    };
  }
  // Explicit files bypass CLI sorting; cancellation disposes active file processes.
  const tests = run({ ...options, signal: cancellation.signal });
  tests.on('test:fail', () => { process.exitCode ||= 1; });
  if (report) {
    for (const [event, status] of [['test:pass', 'Passed'], ['test:fail', 'Failed']]) {
      tests.on(event, data => {
        const file = data.file && path.relative(options.cwd, data.file).split(path.sep).join('/');
        report.executions.push({
          file, name: data.name === data.file || data.name === file ? file : data.name,
          nesting: data.nesting, line: data.line, column: data.column,
          status: data.skip ? 'Skipped' : data.todo ? 'Todo' : status,
          durationMs: data.details?.duration_ms,
        });
      });
    }
    tests.on('test:summary', data => {
      if (!data.file) report.summary = {
        success: data.success, counts: data.counts, durationMs: data.duration_ms,
      };
    });
  }
  // Ending an inherited POSIX capture socket also shuts down the parent's output.
  await pipeline(tests, new spec(), process.stdout, { end: false });
} finally {
  try {
    if (reportFile) {
      try {
        const sanitized = sanitizeExecutionPayload(Buffer.from(JSON.stringify(report)));
        await reportFile.writeFile(`${JSON.stringify(sanitized)}\n`);
      } finally {
        await reportFile.close();
      }
    }
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
    process.off('message', message);
    if (process.connected) process.disconnect();
  }
}
