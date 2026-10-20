import { spawn } from 'node:child_process';
import { open, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeExecutionPayload } from '../src/validation-evidence.mjs';
import { digest, SdlcError } from '../src/core.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const maxOutputBytes = 4 * 1024 * 1024;

function processDiagnostic(error) {
  const original = String(error?.message ?? error);
  let message;
  try {
    const safe = sanitizeExecutionPayload(Buffer.from(original));
    message = typeof safe === 'string' ? safe : JSON.stringify(safe);
  } catch {
    message = 'Process diagnostic could not be safely retained; its original identity is preserved.';
  }
  return { code: typeof error?.code === 'string' && /^[A-Z0-9_-]{1,80}$/u.test(error.code) ?
    error.code : 'PROCESS_ERROR', message: message.slice(0, 2000),
  original: { sha256: digest(original), bytes: Buffer.byteLength(original) } };
}

async function persistCommandReport(handle, report) {
  const sanitized = sanitizeExecutionPayload(Buffer.from(JSON.stringify(report)));
  const bytes = Buffer.from(`${JSON.stringify(sanitized)}\n`);
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, offset);
    if (!bytesWritten) throw new Error('Validation report persistence made no progress.');
    offset += bytesWritten;
  }
  await handle.truncate(bytes.length);
  await handle.sync();
  return sanitized;
}

export async function executeValidationCommand({
  name, command, args, cwd = root, environment = process.env, outputDir, signal,
}) {
  if (!/^[a-z][a-z0-9-]{0,79}$/u.test(name) || typeof command !== 'string' ||
      !Array.isArray(args) || !args.every(value => typeof value === 'string')) {
    throw new Error('A validation process needs an explicit name, executable and argument array.');
  }
  const evidenceRoot = await realpath(path.join(root, '.test-data'));
  const destination = await realpath(outputDir);
  const relative = path.relative(evidenceRoot, destination);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Validation process evidence must remain inside repository-local .test-data.');
  }
  const reportFile = await open(path.join(destination, `${name}.json`), 'wx');
  let journalFile;
  try {
    journalFile = await open(path.join(destination, `${name}.journal.ndjson`), 'wx');
    let sequence = 0;
    let journal = Promise.resolve();
    let persistenceError;
    let interrupted = signal?.aborted === true;
    let outputError;
    let cleanupError;
    let child;
    let stopping;
    const cleanup = { requested: false, pid: null, mechanism: null, outcome: 'not-requested',
      survivorsVerified: false, error: null };
    const stop = () => {
      if (!child?.pid || stopping || child.exitCode !== null || child.signalCode !== null) return;
      cleanup.requested = true;
      cleanup.pid = child.pid;
      cleanup.mechanism = process.platform === 'win32' ? 'owned-pid-tree' : 'owned-process-group';
      cleanup.outcome = 'pending';
      stopping = Promise.resolve().then(async () => {
        if (child.exitCode !== null || child.signalCode !== null) {
          cleanup.outcome = 'root-exited-unverified';
          return;
        }
        if (process.platform === 'win32') {
          const killer = spawn(path.join(process.env.SystemRoot, 'System32', 'taskkill.exe'),
            ['/PID', String(child.pid), '/T', '/F'], { stdio: ['ignore', 'ignore', 'pipe'], shell: false });
          cleanup.control = { pid: killer.pid ?? null, exitCode: null, signal: null };
          await new Promise((resolve, reject) => {
            let diagnostic = '';
            const original = createHash('sha256');
            let bytesSeen = 0;
            killer.stderr.on('data', bytes => {
              original.update(bytes);
              bytesSeen += bytes.length;
              if (diagnostic.length < 2000) diagnostic += bytes.toString('utf8').slice(0, 2000 - diagnostic.length);
            });
            killer.stderr.once('error', reject);
            killer.once('error', reject);
            killer.once('close', (code, termination) => {
              cleanup.control = { ...cleanup.control, exitCode: code, signal: termination,
                originalStderr: { sha256: original.digest('hex'), bytes: bytesSeen } };
              if (code === 0) resolve();
              else reject(Object.assign(new Error(`Cannot stop the owned validation process tree: ${diagnostic}`),
                { code: 'STOP_FAILED' }));
            });
          });
          cleanup.outcome = 'reported-stopped';
        } else {
          try { process.kill(-child.pid, 'SIGTERM'); }
          catch (error) {
            if (error.code !== 'ESRCH') throw error;
            cleanup.outcome = 'target-not-found';
          }
          if (cleanup.outcome === 'pending') cleanup.outcome = 'signal-sent';
        }
      }).catch(async error => {
        cleanupError ??= error;
        cleanup.outcome = 'uncertain';
        cleanup.error = processDiagnostic(error);
        const originalOutput = Object.fromEntries([...streams].map(([channel, state]) => [
          channel, { sha256: state.hash.copy().digest('hex'), bytes: state.bytes },
        ]));
        const causes = [
          ...(interrupted ? [{ type: 'cancellation', code: 'CANCELLED', message: 'Validation process was cancelled.' }] : []),
          ...[[outputError, 'output'], [cleanupError, 'cleanup'], [persistenceError, 'persistence']]
            .filter(([value]) => value).map(([value, type]) => ({ type, ...processDiagnostic(value) })),
        ];
        try {
          retain('cleanup-uncertain', { cleanup, originalOutput });
          await persistCommandReport(reportFile, { ...report, complete: false, finishedAt: null,
            diagnostic: causes.map(value => value.message).join('; '), causes, originalOutput });
        } catch (retentionError) { persistenceError ??= retentionError; }
      });
    };
    const retain = (kind, data) => {
      const value = sanitizeExecutionPayload(Buffer.from(JSON.stringify({
        sequence: ++sequence, observedAt: new Date().toISOString(), kind, ...data,
      })));
      journal = journal.then(async () => {
        await journalFile.write(`${JSON.stringify(value)}\n`);
        await journalFile.sync();
      }).catch(error => {
        persistenceError ??= error;
        stop();
      });
      return value;
    };
    const actualCommand = [command, ...args].map((argument, index, values) =>
      ['--eval', '-e', '--print', '-p', '-c'].includes(values[index - 1]) ?
        '[inline source omitted; use the source-bound validation procedure]' : argument);
    const report = {
      schemaVersion: 1, kind: 'validation-command', command: actualCommand, cwd,
      startedAt: new Date().toISOString(), finishedAt: null, complete: false,
      node: process.version, platform: process.platform, architecture: process.arch,
      context: environment.SDLC_TEST_REPORT_CONTEXT ?
        JSON.parse(environment.SDLC_TEST_REPORT_CONTEXT) : null,
      stdout: '', stderr: '', exitCode: null, signal: null, diagnostic: null,
      pid: null, cleanup, causes: [],
    };
    retain('command-start', { command: actualCommand, cwd, context: report.context });
    const streams = new Map();
    const retainOutput = (channel, text) => {
      try { report[channel] += retain('output', { channel, text }).text; }
      catch (error) {
        const failure = processDiagnostic(error);
        outputError ??= Object.assign(new Error(`Validation ${channel} could not be safely retained (${failure.code}).`),
          { code: failure.code });
        try {
          retain('output-rejected', { channel, code: failure.code,
            diagnostic: 'Unsafe or over-budget output was not retained; this execution is incomplete.' });
        } catch (retentionError) { persistenceError ??= retentionError; }
        stop();
      }
    };
    const consume = (channel, bytes) => {
      const state = streams.get(channel);
      state.hash.update(bytes);
      state.bytes += bytes.length;
      if (state.bytes > maxOutputBytes) {
        outputError ??= Object.assign(new Error(`Validation ${channel} exceeds the retained-output budget.`),
          { code: 'CAPACITY' });
        stop();
        return;
      }
      state.pending += state.decoder.write(bytes);
      const newline = state.pending.lastIndexOf('\n');
      if (newline >= 0) {
        const text = state.pending.slice(0, newline + 1);
        state.pending = state.pending.slice(newline + 1);
        retainOutput(channel, text);
      }
    };
    for (const channel of ['stdout', 'stderr']) streams.set(channel, {
      decoder: new StringDecoder('utf8'), pending: '', hash: createHash('sha256'), bytes: 0,
    });
    await persistCommandReport(reportFile, report);
    const abort = () => { interrupted = true; stop(); };
    signal?.addEventListener('abort', abort, { once: true });
    let outcome;
    try {
      interrupted ||= signal?.aborted === true;
      if (interrupted) outcome = { code: null, signal: null, error: new Error('Validation cancelled before launch.') };
      else if (persistenceError) outcome = { code: null, signal: null, error: persistenceError };
      else {
        try {
          child = spawn(command, args, { cwd, env: environment, shell: false,
            detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (error) { outcome = { code: null, signal: null, error }; }
        if (child) {
          report.pid = child.pid ?? null;
          const closed = new Promise(resolve => {
            let launchError;
            child.once('error', error => { launchError = error; });
            child.once('close', (code, termination) => resolve({ code, signal: termination, error: launchError, closed: true }));
          });
          for (const channel of ['stdout', 'stderr']) {
            child[channel].on('data', bytes => consume(channel, bytes));
            child[channel].once('error', error => { outputError ??= error; stop(); });
          }
          try { retain('command-dispatched', { pid: report.pid }); }
          catch (error) { persistenceError ??= error; stop(); }
          outcome = await closed;
        }
      }
    } finally {
      signal?.removeEventListener('abort', abort);
    }
    if (stopping) await stopping;
    for (const [channel, state] of streams) {
      const text = state.pending + state.decoder.end();
      if (text) retainOutput(channel, text);
    }
    report.finishedAt = new Date().toISOString();
    report.exitCode = outcome.code;
    report.signal = outcome.signal;
    cleanup.rootExitObserved = outcome.closed === true;
    report.originalOutput = Object.fromEntries([...streams].map(([channel, state]) => [
      channel, { sha256: state.hash.digest('hex'), bytes: state.bytes },
    ]));
    let observedStop;
    do {
      observedStop = stopping;
      if (observedStop) await observedStop;
      await journal;
    } while (stopping !== observedStop);
    const project = () => {
      interrupted ||= signal?.aborted === true;
      report.causes = [
        ...(interrupted ? [{ type: 'cancellation', code: 'CANCELLED', message: 'Validation process was cancelled.' }] : []),
        ...[[outputError, 'output'], [outcome.error, 'process'], [cleanupError, 'cleanup'], [persistenceError, 'persistence']]
          .filter(([error]) => error).map(([error, type]) => ({ type, ...processDiagnostic(error) })),
      ];
      if (!report.causes.length && outcome.code === null) report.causes.push({
        type: 'process', code: 'INCOMPLETE_EXIT', message: 'Validation process has no completed exit status.',
      });
      report.complete = !report.causes.length && outcome.code !== null;
      report.diagnostic = report.causes.length ? report.causes.map(cause => cause.message).join('; ') : null;
    };
    project();
    try {
      retain('command-end', { complete: report.complete, exitCode: report.exitCode,
        signal: report.signal, diagnostic: report.diagnostic, originalOutput: report.originalOutput, cleanup });
    } catch (error) { persistenceError ??= error; }
    await journal;
    project();
    try { return await persistCommandReport(reportFile, report); }
    catch (error) {
      if (!(error instanceof SdlcError) || !['UNSAFE', 'CAPACITY', 'JSON'].includes(error.code)) throw error;
      persistenceError ??= error;
      report.stdout = '[Transcript omitted from incomplete report; original output identities and partial journal remain retained.]';
      report.stderr = '[Transcript omitted from incomplete report; original output identities and partial journal remain retained.]';
      project();
      return await persistCommandReport(reportFile, report);
    }
  } finally {
    await journalFile?.close();
    await reportFile.close();
  }
}

export function discoverGoDeclarations(sourceFiles) {
  const expected = sourceFiles.flatMap(({ file, contents }) => {
    const functions = [...contents.matchAll(/^func (Test[A-Za-z0-9_]+)\(t \*testing\.T\)/gmu)]
      .map(match => match[1]);
    const declarations = [...contents.matchAll(/^const validation[A-Za-z]+Inventory = `([^`]+)`/gmu)];
    if (declarations.length !== 1) throw new Error('Every Go test file needs one literal validation inventory.');
    const declared = JSON.parse(declarations[0][1]);
    if (declared.schemaVersion !== 1 ||
        Object.keys(declared).some(key => !['schemaVersion', 'tests'].includes(key)) ||
        !declared.tests || Object.getPrototypeOf(declared.tests) !== Object.prototype ||
        digest(Object.keys(declared.tests).sort()) !== digest([...functions].sort()) ||
        !Object.values(declared.tests).every(names => Array.isArray(names) &&
          names.every(name => typeof name === 'string' && name.trim().length > 0 &&
            !/[\u0000-\u001f]/u.test(name)) &&
          new Set(names.map(name => name.replace(/\s/gu, '_'))).size === names.length)) {
      throw new Error('Go declarations must cover every current test function and its finite subcases.');
    }
    return functions.flatMap(name => [name,
      ...declared.tests[name].map(child => `${name}/${child.replace(/\s/gu, '_')}`)]
      .map(selector => ({ file, name: selector, sourceDigest: digest(contents) })));
  });
  if (!expected.length || new Set(expected.map(test => test.name)).size !== expected.length) {
    throw new Error('Go validation needs unique declared test functions from every current source file.');
  }
  return expected;
}

export function reconcileGoExecution(sourceFiles, report) {
  const expected = discoverGoDeclarations(sourceFiles);
  const blockers = [];
  const events = [];
  for (const [index, line] of String(report.stdout ?? '').split('\n').entries()) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (!event || Object.getPrototypeOf(event) !== Object.prototype ||
          typeof event.Action !== 'string' ||
          (event.Test !== undefined && typeof event.Test !== 'string')) {
        blockers.push({ code: 'INVALID_GO_EVENT', line: index + 1 });
      } else events.push(event);
    } catch {
      blockers.push({ code: 'INVALID_GO_EVENT', line: index + 1 });
    }
  }
  const terminals = events.filter(event => event.Test && ['pass', 'fail', 'skip'].includes(event.Action));
  const registrations = events.filter(event => event.Test && event.Action === 'run');
  for (const test of expected) {
    if (terminals.filter(event => event.Test === test.name).length !== 1) {
      blockers.push({ code: 'MISSING_OR_DUPLICATE_GO_TEST', ...test });
    }
  }
  for (const event of terminals) {
    if (!expected.some(test => event.Test === test.name) ||
        registrations.filter(row => row.Test === event.Test).length !== 1) {
      blockers.push({ code: 'UNDECLARED_OR_DUPLICATE_GO_TEST', name: event.Test });
    }
    if (event.Action === 'skip' && !(report.platform === 'win32' &&
        event.Test === 'TestNativePayloadRejectsTampering/extracted_mode_changed')) {
      blockers.push({ code: 'REQUIRED_GO_TEST_SKIPPED', name: event.Test });
    }
  }
  for (const event of registrations) if (!terminals.some(row => row.Test === event.Test)) {
    blockers.push({ code: 'INCOMPLETE_GO_TEST', name: event.Test });
  }
  for (const event of registrations) if (!expected.some(test => test.name === event.Test)) {
    blockers.push({ code: 'UNDECLARED_GO_REGISTRATION', name: event.Test });
  }
  const packages = events.filter(event => !event.Test && ['pass', 'fail'].includes(event.Action));
  if (packages.length !== 1) blockers.push({ code: 'MISSING_OR_DUPLICATE_GO_PACKAGE' });
  if (!report.complete || report.exitCode !== 0) blockers.push({ code: 'INCOMPLETE_GO_COMMAND' });
  const failed = terminals.some(event => event.Action === 'fail');
  return {
    status: failed || packages.some(event => event.Action === 'fail') ? 'Failed' :
      report.complete && report.exitCode === 0 && !blockers.length ?
      'Passed' : 'NotRun',
    expected, executions: terminals, blockers,
    dispositions: terminals.filter(event => event.Action === 'skip' && report.platform === 'win32' &&
      event.Test === 'TestNativePayloadRejectsTampering/extracted_mode_changed').map(event => ({
      name: event.Test, status: 'NotRun', platform: report.platform,
      owner: 'launcher-maintainer', requiredOn: ['linux-x64', 'macos-arm64', 'macos-x64'],
      reason: 'Windows extracted mode identity comes from verified tar metadata, not POSIX chmod.',
    })),
  };
}
