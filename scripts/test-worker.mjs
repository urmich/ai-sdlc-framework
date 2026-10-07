import { pipeline } from 'node:stream/promises';
import { constants } from 'node:os';
import { run } from 'node:test';
import { spec } from 'node:test/reporters';

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
  // Explicit files bypass CLI sorting; cancellation disposes active file processes.
  const tests = run({ ...options, signal: cancellation.signal });
  tests.on('test:fail', () => { process.exitCode ||= 1; });
  // Ending an inherited POSIX capture socket also shuts down the parent's output.
  await pipeline(tests, new spec(), process.stdout, { end: false });
} finally {
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', terminate);
  process.off('message', message);
  if (process.connected) process.disconnect();
}
