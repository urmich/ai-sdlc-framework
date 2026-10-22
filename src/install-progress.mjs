import { writeSync } from 'node:fs';
import { requireThat, SdlcError } from './core.mjs';

const phases = new Set([
  'install', 'clean-install', 'uninstall', 'doctor', 'distribution', 'documentation',
  'install-lock', 'purge-lock', 'lock-release', 'purge-preflight', 'purge-remove',
  'replacement-preflight', 'replacement-writes', 'manifest',
  'runtime-main', 'runtime-preflight', 'runtime-verify-source', 'runtime-verify-active',
  'runtime-verify-staging', 'runtime-launch', 'channel-lock',
  'file-write', 'file-flush', 'directory-flush', 'trace-limit',
]);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
let state;

function selected() {
  const id = process.env.SDLC_INSTALL_TRACE_ID;
  if (id === undefined) return null;
  requireThat(uuid.test(id), 'INPUT', 'Install trace identity must be a UUID');
  if (!state || state.id !== id) {
    requireThat(!state?.scopes, 'INPUT', 'Install trace identity changed during an operation');
    state = { id, scopes: 0, sequence: 0, limited: false, counters: new Map(), failure: null };
  }
  return state;
}

function emit(current, phase, event, count, elapsedUs) {
  requireThat(phases.has(phase) && ['begin', 'end', 'progress'].includes(event),
    'INPUT', 'Unknown install observation phase or event');
  requireThat(Number.isSafeInteger(count) && count >= 0 &&
    Number.isSafeInteger(elapsedUs) && elapsedUs >= 0,
  'INPUT', 'Install observation counters must be bounded nonnegative integers');
  if (current.limited) return;
  if (current.sequence === 255) {
    current.limited = true;
    phase = 'trace-limit';
    event = 'progress';
    count = 1;
    elapsedUs = 0;
  }
  const cpu = process.cpuUsage();
  const line = `sdlc-install-v1 trace=${current.id} pid=${process.pid} ppid=${process.ppid}` +
    ` seq=${++current.sequence} wall=${Date.now()} mono=${performance.now().toFixed(3)}` +
    ` cpu_user=${cpu.user} cpu_system=${cpu.system} phase=${phase} event=${event}` +
    ` count=${count} elapsed_us=${elapsedUs}\n`;
  try { writeSync(2, line); }
  catch (error) {
    current.failure ??= { code: /^[A-Z0-9_]+$/u.test(error.code ?? '') ? error.code : 'WRITE_ERROR' };
  }
}

export function installPhase(phase, event, count = 0, elapsedUs = 0) {
  if (!state?.scopes) return;
  const current = selected();
  if (current) emit(current, phase, event, count, elapsedUs);
}

export function installProgress(phase, count) {
  if (count === 1 || count % 16 === 0) installPhase(phase, 'progress', count);
}

export function beginInstallActivity(phase) {
  if (!state?.scopes) return null;
  const current = selected();
  if (!current) return null;
  const counter = current.counters.get(phase) ?? { count: 0, elapsedUs: 0 };
  current.counters.set(phase, counter);
  if (counter.count % 16 === 0) emit(current, phase, 'begin', counter.count, counter.elapsedUs);
  return { current, phase, started: performance.now() };
}

export function finishInstallActivity(activity) {
  if (!activity) return;
  const { current, phase, started } = activity;
  const counter = current.counters.get(phase);
  counter.count++;
  counter.elapsedUs += Math.max(0, Math.round((performance.now() - started) * 1000));
  if (counter.count === 1 || counter.count % 16 === 0) {
    emit(current, phase, 'progress', counter.count, counter.elapsedUs);
  }
}

export async function observeInstallPhase(phase, action) {
  if (!state?.scopes) return action();
  const started = performance.now();
  installPhase(phase, 'begin');
  const result = await action();
  installPhase(phase, 'end', 0, Math.max(0, Math.round((performance.now() - started) * 1000)));
  return result;
}

export async function observeInstallOperation(action) {
  const current = selected();
  if (!current) return action();
  if (current.scopes === 0) {
    current.sequence = 0;
    current.limited = false;
    current.counters.clear();
    current.failure = null;
  }
  current.scopes++;
  let result;
  try { result = await action(); }
  catch (error) {
    if (current.failure && error instanceof SdlcError) {
      error.details = { ...error.details, installTraceFailure: current.failure };
    }
    throw error;
  } finally { current.scopes--; }
  if (current.scopes === 0) {
    for (const [phase, counter] of current.counters) {
      emit(current, phase, 'end', counter.count, counter.elapsedUs);
    }
    if (current.failure && !(typeof result === 'number' && result !== 0)) {
      throw new SdlcError('INSTALL_TRACE_FAILED', 'Install observation stream failed after operation settlement',
        { operationSettled: true, causeCode: current.failure.code });
    }
  }
  return result;
}
