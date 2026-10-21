import { spawn } from 'node:child_process';
import { open, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeExecutionPayload } from '../src/validation-evidence.mjs';
import { digest, SdlcError } from '../src/core.mjs';
import { atomicWrite } from '../src/files.mjs';
import { declarationTokens } from './validation-inventory.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const maxOutputBytes = 4 * 1024 * 1024;
const maxInspectionBytes = 64 * 1024;

function assertionInspectionJson(text) {
  if (Buffer.byteLength(text) > maxInspectionBytes) return null;
  try {
    const tokens = declarationTokens(text);
    if (tokens.length > 65536) return null;
    let cursor = 0;
    let edge = 0;
    for (const token of tokens) {
      if (text.slice(edge, token.start).trim()) return null;
      edge = token.end;
    }
    if (text.slice(edge).trim()) return null;
    const take = value => {
      if (tokens[cursor]?.value !== value) throw new Error('Unsupported inspection syntax');
      cursor++;
    };
    const parse = depth => {
      if (depth > 32) throw new Error('Inspection nesting exceeds its bound');
      const token = tokens[cursor];
      if (!token) throw new Error('Incomplete inspection');
      if (token.value === '[' && tokens[cursor + 1]?.kind === 'identifier' &&
          ['Object', 'Array'].includes(tokens[cursor + 1]?.value) &&
          tokens[cursor + 2]?.value === ']') {
        cursor += 3;
        return { nodeInspectionType: tokens[cursor - 2].value, elided: true };
      }
      if (token.kind === 'regex') {
        cursor++;
        return { nodeInspectionType: 'RegExp',
          original: { sha256: digest(token.value), bytes: Buffer.byteLength(token.value) } };
      }
      if (token.value === '[' && tokens[cursor + 1]?.kind === 'identifier' &&
          ['Function', 'AsyncFunction', 'GeneratorFunction', 'AsyncGeneratorFunction']
            .includes(tokens[cursor + 1]?.value)) {
        let end = cursor + 2;
        if (tokens[end]?.value === '(' && tokens[end + 1]?.value === 'anonymous' &&
            tokens[end + 2]?.value === ')') end += 3;
        else if (tokens[end]?.value === ':' && tokens[end + 1]?.kind === 'identifier') end += 2;
        if (tokens[end]?.value !== ']') throw new Error('Unsupported inspected function marker');
        const literal = text.slice(token.start, tokens[end].end);
        const type = tokens[cursor + 1].value;
        cursor = end + 1;
        return { nodeInspectionType: type,
          original: { sha256: digest(literal), bytes: Buffer.byteLength(literal) } };
      }
      if (token.value === '{' || token.value === '[') {
        const object = token.value === '{';
        const result = object ? Object.create(null) : [];
        const end = object ? '}' : ']';
        cursor++;
        while (tokens[cursor]?.value !== end) {
          let key;
          if (object) {
            const property = tokens[cursor++];
            if (!['identifier', 'string'].includes(property?.kind) || Object.hasOwn(result, property.value)) {
              throw new Error('Unsupported or duplicate inspection property');
            }
            key = property.value;
            take(':');
          }
          const value = parse(depth + 1);
          if (object) result[key] = value;
          else result.push(value);
          if (tokens[cursor]?.value !== ',') break;
          cursor++;
        }
        take(end);
        return result;
      }
      if (token.kind === 'string') {
        let value = token.value;
        cursor++;
        while (tokens[cursor]?.value === '+' && tokens[cursor + 1]?.kind === 'string') {
          value += tokens[cursor + 1].value;
          cursor += 2;
        }
        return value;
      }
      if (token.kind === 'identifier' && ['true', 'false', 'null'].includes(token.value)) {
        cursor++;
        return { true: true, false: false, null: null }[token.value];
      }
      if (token.kind === 'identifier' && ['undefined', 'NaN', 'Infinity'].includes(token.value)) {
        cursor++;
        return { nodeInspectionType: token.value };
      }
      const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(text.slice(token.start));
      if (!number || !Number.isFinite(Number(number[0]))) {
        throw new Error('Unsupported inspection value');
      }
      const end = token.start + number[0].length;
      while (tokens[cursor]?.end <= end) cursor++;
      if (tokens[cursor - 1]?.end !== end) throw new Error('Incomplete inspection number');
      return Object.is(Number(number[0]), -0) ? { nodeInspectionType: 'number', value: '-0' } : Number(number[0]);
    };
    const value = parse(0);
    const omittedExpected = value && !Object.hasOwn(value, 'expected') &&
      ['rejects', 'throws'].includes(value.operator);
    // Only Node's typed assertion metadata is adapted; arbitrary inspected objects remain unsupported.
    if (cursor !== tokens.length || !value || Array.isArray(value) ||
        Object.keys(value).some(key => !['generatedMessage', 'code', 'actual', 'expected', 'operator', 'diff'].includes(key)) ||
        typeof value.generatedMessage !== 'boolean' || value.code !== 'ERR_ASSERTION' ||
        !Object.hasOwn(value, 'actual') || !Object.hasOwn(value, 'expected') && !omittedExpected ||
        typeof value.operator !== 'string' || !/^[A-Za-z!=<>]{1,64}$/u.test(value.operator) ||
        Object.hasOwn(value, 'diff') && value.diff !== 'simple') return null;
    return JSON.stringify(omittedExpected ? { ...value, inspectionOmittedFields: ['expected'] } : value);
  } catch {
    return null;
  }
}

function outputRecord(state, text, final = false) {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text)) {
    throw new SdlcError('UNSAFE', 'Opaque validation output cannot be retained safely.');
  }
  state.pending += text;
  let boundary = 0;
  for (; state.scanned < state.pending.length; state.scanned++) {
    const index = state.scanned;
    const character = state.pending[index];
    if (state.quote) {
      if (state.escaped) state.escaped = false;
      else if (character === '\\') state.escaped = true;
      else if (character === state.quote) state.quote = null;
    } else if (['"', "'", '`'].includes(character) && (state.stack.length ||
        /[A-Za-z_][A-Za-z0-9_.-]*[ \t]*=[ \t]*$/u.test(state.pending.slice(state.lineStart, index)))) {
      state.quote = character;
    } else if (character === '{' || character === '[') {
      if (state.stack.length >= 32) throw new SdlcError('CAPACITY', 'Output structure exceeds its bounded depth.');
      state.stack.push({ character, index });
    } else if (character === '}' || character === ']') {
      const opening = state.stack.pop();
      if (opening?.character !== (character === '}' ? '{' : '[')) state.stack.length = 0;
      else if (character === '}' &&
          /^\{\s*generatedMessage\s*:/u.test(state.pending.slice(opening.index, index + 1))) {
        state.inspections.push({ from: opening.index, to: index + 1 });
      }
    }
    if (character === '\n') {
      if (!state.stack.length && !state.quote) {
        const line = state.pending.slice(state.lineStart, index + 1);
        const header = /^[ \t]*(?:Authorization|Proxy-Authorization|Cookie|Set-Cookie|X-API-Key|X-Auth-Token|X-Amz-Security-Token)[ \t]*:/iu.test(line);
        if (header) state.header = true;
        else if (!state.header || !/^[ \t]/u.test(line)) {
          state.header = false;
          boundary = index + 1;
        }
      }
      state.lineStart = index + 1;
    }
  }
  if (final) {
    if (state.quote) throw new SdlcError('UNSAFE', 'Incomplete quoted validation output cannot be retained safely.');
    boundary = state.pending.length;
  }
  if (!boundary) return null;
  const original = state.pending.slice(0, boundary);
  let normalized = '';
  let cursor = 0;
  let count = 0;
  const inspections = state.inspections.filter(item => item.to <= boundary)
    .sort((left, right) => left.from - right.from || right.to - left.to);
  for (const item of inspections) {
    if (item.from < cursor) continue;
    const json = assertionInspectionJson(original.slice(item.from, item.to));
    if (json !== null) {
      normalized += original.slice(cursor, item.from) + json;
      cursor = item.to;
      count++;
    }
  }
  normalized += original.slice(cursor);
  state.pending = state.pending.slice(boundary);
  state.scanned -= boundary;
  state.lineStart = Math.max(0, state.lineStart - boundary);
  state.stack.forEach(item => { item.index -= boundary; });
  state.inspections = state.inspections.filter(item => item.to > boundary)
    .map(item => ({ from: item.from - boundary, to: item.to - boundary }));
  return { text: normalized, original: { sha256: digest(original), bytes: Buffer.byteLength(original) },
    ...(count ? { normalization: 'node-assertion-metadata-json', normalizedRecords: count } : {}) };
}

function outputDecoder() {
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
}

function resetOutputRecord(state) {
  Object.assign(state, { decoder: outputDecoder(), pending: '', scanned: 0, lineStart: 0,
    stack: [], inspections: [], quote: null, escaped: false, header: false });
}

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

function commandReportBytes(report) {
  const sanitized = sanitizeExecutionPayload(Buffer.from(JSON.stringify(report)));
  const bytes = Buffer.from(`${JSON.stringify(sanitized)}\n`);
  return { sanitized, bytes };
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
  const reportPath = path.join(destination, `${name}.json`);
  let reportFile = await open(reportPath, 'wx');
  let journalFile;
  let checkpointQueue = Promise.resolve();
  let progressTimer;
  let finalizing = false;
  try {
    journalFile = await open(path.join(destination, `${name}.journal.ndjson`), 'wx');
    let sequence = 0;
    let journal = Promise.resolve();
    let journalError;
    const journalHash = createHash('sha256');
    let journalBytes = 0;
    let checkpointPending = 0;
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
      retain('command-stop-request', { pid: child.pid, cleanup });
      if (!finalizing) requestCheckpoint('cancelling', { force: true });
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
          Object.assign(report, { complete: false, finishedAt: null,
            diagnostic: causes.map(value => value.message).join('; '), causes, originalOutput });
          await requestCheckpoint('cancelling', { force: true });
        } catch (retentionError) { persistenceError ??= retentionError; }
      });
    };
    const retain = (kind, data) => {
      const value = sanitizeExecutionPayload(Buffer.from(JSON.stringify({
        sequence: ++sequence, observedAt: new Date().toISOString(), kind, ...data,
      })));
      const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
      journalHash.update(bytes);
      journalBytes += bytes.length;
      journal = journal.then(async () => {
        await journalFile.writeFile(bytes);
        await journalFile.sync();
      }).catch(error => {
        journalError ??= error;
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
    const streams = new Map();
    const requestCheckpoint = (phase, { final = false, force = false } = {}) => {
      if (!force && checkpointPending) return checkpointQueue;
      const prefix = journal;
      const snapshot = JSON.parse(JSON.stringify({
        ...report, complete: final ? report.complete : false,
        finishedAt: final ? report.finishedAt : null,
        exitCode: final ? report.exitCode : null, signal: final ? report.signal : null,
        originalOutput: final ? report.originalOutput : Object.fromEntries([...streams].map(([channel, state]) => [
          channel, { sha256: state.hash.copy().digest('hex'), bytes: state.bytes },
        ])),
        checkpoint: { phase, journalSequence: sequence,
          originalJournalPrefix: { sha256: journalHash.copy().digest('hex'), bytes: journalBytes } },
      }));
      checkpointPending++;
      checkpointQueue = checkpointQueue.then(async () => {
        await prefix;
        snapshot.checkpoint.journalDurable = !journalError;
        if (persistenceError) snapshot.complete = false;
        if (journalError) snapshot.checkpoint.journalError = processDiagnostic(journalError);
        let serialized;
        try { serialized = commandReportBytes(snapshot); }
        catch (error) {
          if (!(error instanceof SdlcError) || !['UNSAFE', 'CAPACITY', 'JSON'].includes(error.code)) throw error;
          persistenceError ??= error;
          stop();
          const original = Buffer.from(JSON.stringify(snapshot));
          retain('report-retention-rejected', { phase, cause: processDiagnostic(error),
            original: { sha256: digest(original), bytes: original.length }, complete: false });
          await journal;
          serialized = commandReportBytes({
            ...snapshot, complete: false,
            stdout: '[Transcript omitted; original output identities and journal remain retained.]',
            stderr: '[Transcript omitted; original output identities and journal remain retained.]',
            causes: [...snapshot.causes, { type: 'persistence', ...processDiagnostic(error) }],
            diagnostic: 'The original command checkpoint could not be safely retained.',
            checkpoint: { ...snapshot.checkpoint, phase: 'retention-failed',
              journalSequence: sequence, journalDurable: !journalError,
              originalJournalPrefix: { sha256: journalHash.copy().digest('hex'), bytes: journalBytes },
              originalSnapshot: { sha256: digest(original), bytes: original.length } },
          });
        }
        if (reportFile) {
          const handle = reportFile;
          reportFile = null;
          try { await handle.writeFile(serialized.bytes); await handle.sync(); }
          finally { await handle.close(); }
        } else {
          await atomicWrite(reportPath, serialized.bytes);
        }
        return serialized.sanitized;
      }).catch(error => {
        persistenceError ??= error;
        stop();
        return null;
      }).finally(() => { checkpointPending--; });
      return checkpointQueue;
    };
    const checkpointProgress = () => {
      if (progressTimer || finalizing) return;
      progressTimer = setTimeout(() => {
        progressTimer = null;
        requestCheckpoint('running');
      }, 1000);
      progressTimer.unref();
    };
    retain('command-start', { command: actualCommand, cwd, context: report.context });
    const rejectOutput = (channel, error, original) => {
      const failure = processDiagnostic(error);
      outputError ??= Object.assign(new Error(`Validation ${channel} could not be safely retained (${failure.code}).`),
        { code: failure.code });
      try {
        retain('output-rejected', { channel, code: failure.code, original, cause: failure,
          diagnostic: 'Unsafe or over-budget output was not retained; this execution is incomplete.' });
      } catch (retentionError) { persistenceError ??= retentionError; }
      stop();
    };
    const retainOutput = (channel, record) => {
      try {
        report[channel] += retain('output', { channel, ...record }).text;
        checkpointProgress();
      }
      catch (error) {
        rejectOutput(channel, error, record.original);
      }
    };
    const consume = (channel, bytes) => {
      const state = streams.get(channel);
      state.hash.update(bytes);
      state.bytes += bytes.length;
      if (state.bytes > maxOutputBytes) {
        outputError ??= Object.assign(new Error(`Validation ${channel} exceeds the retained-output budget.`),
          { code: 'CAPACITY' });
        try {
          retain('output-rejected', { channel, code: 'CAPACITY',
            original: { sha256: state.hash.copy().digest('hex'), bytes: state.bytes },
            diagnostic: 'Output exceeds the unchanged retained-output budget.' });
        } catch (retentionError) { persistenceError ??= retentionError; }
        stop();
        return;
      }
      try {
        let text;
        try { text = state.decoder.decode(bytes, { stream: true }); }
        catch { throw new SdlcError('UNSAFE', 'Validation output must be supported UTF-8 text.'); }
        const record = outputRecord(state, text);
        if (record) retainOutput(channel, record);
      } catch (error) {
        rejectOutput(channel, error, { sha256: digest(bytes), bytes: bytes.length });
        resetOutputRecord(state);
      }
    };
    for (const channel of ['stdout', 'stderr']) {
      const state = { hash: createHash('sha256'), bytes: 0 };
      resetOutputRecord(state);
      streams.set(channel, state);
    }
    await requestCheckpoint('initializing', { force: true });
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
          await requestCheckpoint('running', { force: true });
          outcome = await closed;
        }
      }
    } finally {
      signal?.removeEventListener('abort', abort);
    }
    if (stopping) await stopping;
    for (const [channel, state] of streams) {
      try {
        let tail;
        try { tail = state.decoder.decode(); }
        catch { throw new SdlcError('UNSAFE', 'Validation output ended with incomplete UTF-8 text.'); }
        const record = outputRecord(state, tail, true);
        if (record?.text) retainOutput(channel, record);
      } catch (error) {
        rejectOutput(channel, error, { sha256: digest(state.pending), bytes: Buffer.byteLength(state.pending) });
      }
    }
    finalizing = true;
    clearTimeout(progressTimer);
    report.finishedAt = new Date().toISOString();
    report.exitCode = outcome.code;
    report.signal = outcome.signal;
    cleanup.rootExitObserved = outcome.closed === true;
    report.originalOutput = Object.fromEntries([...streams].map(([channel, state]) => [
      channel, { sha256: state.hash.copy().digest('hex'), bytes: state.bytes },
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
    const retained = await requestCheckpoint('finished', { final: true, force: true });
    if (!retained) throw persistenceError;
    return retained;
  } finally {
    finalizing = true;
    clearTimeout(progressTimer);
    await checkpointQueue;
    await journalFile?.close();
    await reportFile?.close();
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
