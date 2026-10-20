import { pipeline } from 'node:stream/promises';
import { Transform, Writable } from 'node:stream';
import { availableParallelism, constants, totalmem } from 'node:os';
import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { open, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { sanitizeExecutionPayload } from '../src/validation-evidence.mjs';
import { digest, LIMITS, requireThat, SdlcError } from '../src/core.mjs';
import { readTestBudget, readTestGroupProcesses } from './test-budget.mjs';
import { discoverDeclarations, nodeStartDefinition, cancelledNodeStarts,
  reconcileNodeExecution } from './validation-inventory.mjs';
import { validationExecutionGroups, validationGroupProtocol, validationSchedulingPolicyDigest,
  runValidationReadyPool } from './test-scheduling.mjs';

const reportPath = process.env.SDLC_TEST_REPORT_FILE;
const reportProfile = process.env.SDLC_TEST_REPORT_PROFILE;
const reportContext = process.env.SDLC_TEST_REPORT_CONTEXT;
const reportCommand = process.env.SDLC_TEST_REPORT_COMMAND;
const advisoryMs = process.env.SDLC_TEST_REPORT_ADVISORY_MS === undefined ? null :
  Number(process.env.SDLC_TEST_REPORT_ADVISORY_MS);
const producerStarted = performance.now();
delete process.env.SDLC_TEST_REPORT_FILE;
delete process.env.SDLC_TEST_REPORT_PROFILE;
delete process.env.SDLC_TEST_REPORT_CONTEXT;
delete process.env.SDLC_TEST_REPORT_COMMAND;
delete process.env.SDLC_TEST_REPORT_ADVISORY_MS;
let reportFile;
let report;
let journalFile;
let journal = Promise.resolve();
let journalError;
let evidenceError;
let sequence = 0;
let finished = false;
let interruption;
const declaredCases = [];
const observedStarts = [];

function rejectionCause(error) {
  const message = String(error.message);
  let safe;
  try { safe = sanitizeExecutionPayload(Buffer.from(JSON.stringify({ message }))).message; }
  catch { safe = 'The sanitizer cause could not be safely retained.'; }
  return { code: error.code, message: safe.slice(0, 1000),
    original: { sha256: digest(message), bytes: Buffer.byteLength(message) } };
}

function failureDiagnostic(error) {
  const original = { message: String(error.message), code: error.code ?? null,
    failureType: error.failureType ?? null };
  try {
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(original.message)) {
      throw new SdlcError('UNSAFE', 'Opaque failure diagnostic cannot be retained safely.');
    }
    const { message } = sanitizeExecutionPayload(Buffer.from(JSON.stringify({ message: original.message })));
    return { original, diagnostic: { ...original, message }, changed: message !== original.message };
  } catch (problem) {
    if (!(problem instanceof SdlcError) || problem.code !== 'UNSAFE') return { original, diagnostic: original };
    const identity = { sha256: digest(original.message), bytes: Buffer.byteLength(original.message) };
    return { original, changed: true, rejection: rejectionCause(problem),
      diagnostic: { ...original,
        message: 'Failure diagnostic text was rejected; its original identity is preserved.',
        originalMessage: identity, retention: { status: 'Rejected', ...rejectionCause(problem) } } };
  }
}

function retainEvent(kind, data, rejectedDiagnostic) {
  let value;
  let rejected = false;
  let diagnosticNotice;
  let abortReason;
  const envelope = { sequence: ++sequence, observedAt: new Date().toISOString(), kind, ...data };
  const originalBytes = Buffer.from(JSON.stringify(rejectedDiagnostic ?
    { ...envelope, diagnostic: rejectedDiagnostic.original } : envelope));
  const rejection = (error, cause = rejectionCause(error)) => ({
    code: error.code, message: 'Test evidence could not be safely retained; the execution is incomplete.',
    cause,
    original: { sha256: digest(originalBytes), bytes: originalBytes.length },
    ...(typeof data.groupId === 'string' && /^[a-f0-9]{64}$/u.test(data.groupId) ? { groupId: data.groupId } : {}),
    ...(typeof data.file === 'string' ? { fileDigest: digest(data.file) } : {}),
    ...(typeof data.name === 'string' ? { nameDigest: digest(data.name) } : {}),
  });
  try {
    if (kind === 'diagnostic' && typeof data.message === 'string' &&
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(data.message)) {
      throw new SdlcError('UNSAFE', 'Opaque diagnostic event cannot be retained safely.');
    }
    value = sanitizeExecutionPayload(Buffer.from(JSON.stringify(envelope)));
    if (rejectedDiagnostic?.rejection) {
      const detail = { ...rejection(rejectedDiagnostic.rejection, rejectedDiagnostic.rejection),
        event: kind, scope: 'failure-diagnostic', fatal: false };
      evidenceError ??= detail;
      diagnosticNotice = { sequence: ++sequence, observedAt: new Date().toISOString(),
        kind: 'evidence-rejected', event: kind, scope: 'failure-diagnostic', fatal: false, ...detail };
      process.exitCode ||= 2;
    }
  } catch (error) {
    if (!(error instanceof SdlcError) || !['UNSAFE', 'CAPACITY', 'JSON'].includes(error.code)) throw error;
    rejected = true;
    const detail = { ...rejection(error), event: kind, scope: 'event', fatal: true };
    evidenceError ??= detail;
    value = { sequence, observedAt: new Date().toISOString(), kind: 'evidence-rejected',
      event: kind, fatal: true, ...detail };
    process.exitCode ||= 2;
    console.error(`[test-worker:error] ${evidenceError.message} (${error.code})`);
    abortReason = new Error(evidenceError.message);
  }
  journal = journal.then(async () => {
    await journalFile.write(`${JSON.stringify(value)}\n`);
    if (diagnosticNotice) await journalFile.write(`${JSON.stringify(diagnosticNotice)}\n`);
    await journalFile.sync();
  }).catch(error => {
    journalError ??= error;
    process.exitCode ||= 1;
    cancellation.abort(error);
  });
  if (abortReason) cancellation.abort(abortReason);
  return rejected ? null : value;
}

const cancellation = new AbortController();
const cancel = signal => {
  if (!interruption) {
    interruption = { signal, producerPid: process.pid, observedAt: new Date().toISOString() };
    if (report && journalFile) {
      const retained = retainEvent('interruption', interruption);
      if (retained) interruption.sequence = retained.sequence;
    }
  }
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
  const declarations = await Promise.all(options.files.map(async file => discoverDeclarations(
    await readFile(file, 'utf8'), path.relative(options.cwd, file).split(path.sep).join('/'))));
  declaredCases.push(...declarations.flatMap(source => source.cases));
  const inventory = {
    files: declarations.map(({ file, sourceDigest }) => ({ file, sourceDigest })),
    cases: declaredCases, unresolved: declarations.flatMap(source => source.unresolved)
      .filter(item => item.code !== 'FOREIGN_BINDING_REQUIRES_CATALOG')
      .map(item => ({ code: item.code, file: item.file, ...(item.line ? { line: item.line } : {}) })),
    resourceRequirements: declarations.filter(source => source.declared.resources)
      .map(source => ({ file: source.file, ...source.declared.resources })),
    groupDeclarations: declarations.flatMap(source => (source.declared.groups ?? [])
      .map(group => ({ file: source.file, ...group }))),
  };
  const groups = validationExecutionGroups(inventory, {
    files: inventory.files.map(source => source.file),
    pattern: options.testNamePatterns?.[0], preserveOrder: true,
  });
  requireThat(!options.executionGroups || digest(groups) === digest(options.executionGroups),
    'INVENTORY', 'Dispatched root groups differ from independently read source closures');
  const capacity = (await readTestBudget()).capacity;
  requireThat(groups.every(group => group.minimumSlots <= capacity), 'BUDGET',
    'An execution group requires more minimum slots than this aggregate host allocation');
  if (reportPath) {
    const root = await realpath(path.resolve('.test-data'));
    const parent = await realpath(path.dirname(path.resolve(reportPath)));
    const relative = path.relative(root, parent);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('Test evidence must remain inside repository-local .test-data.');
    }
    reportFile = await open(path.resolve(reportPath), 'wx');
    journalFile = await open(`${path.resolve(reportPath)}.journal.ndjson`, 'wx');
    report = {
      schemaVersion: 1, profile: reportProfile, node: process.version,
      platform: process.platform, architecture: process.arch,
      process: { pid: process.pid, parentPid: process.ppid },
      executable: process.execPath,
      command: reportCommand ? JSON.parse(reportCommand) : null,
      workerCommand: [process.execPath, ...process.execArgv, ...process.argv.slice(1)],
      ...(reportContext ? { context: JSON.parse(reportContext) } : {}),
      files: options.files.map(file => path.relative(options.cwd, file).split(path.sep).join('/')),
      startedAt: new Date().toISOString(), finishedAt: null, complete: false,
      selection: { namePatterns: options.testNamePatterns ?? [],
        skipPatterns: options.testSkipPatterns ?? [],
        concurrency: options.concurrency, coverage: options.coverage ?? false },
      resources: { availableParallelism: availableParallelism(), totalMemoryBytes: totalmem(),
        fileConcurrency: options.concurrency, budget: await readTestBudget() },
      timing: { advisoryMs, elapsedMs: null, exceeded: null, advisoryOnly: true },
      executions: [], diagnostics: [], summary: null,
      diagnosticsScope: 'non-summary; original native counter diagnostics remain in the journal',
      groupExecution: {
        schemaVersion: 1, protocol: validationGroupProtocol,
        policyDigest: validationSchedulingPolicyDigest(), selectionDigest: digest(groups),
        groups: groups.map(group => ({ ...group, startedAt: null, finishedAt: null,
          status: 'NotRun', summary: null, processIds: [] })),
      },
      ...(options.coverage ? { coverage: { schemaVersion: 1,
        scope: 'per-isolated-root-native-coverage', aggregatePercentages: false, groups: [] } } : {}),
    };
    retainEvent('execution-start', { profile: reportProfile, files: report.files,
      context: report.context ?? null, selection: report.selection });
  }
  const summaries = [];
  const executeGroup = async group => {
    const reportingPaths = new Map();
    const executionStart = report?.executions.length ?? 0;
    const originalOptions = { ...options };
    delete originalOptions.executionGroups;
    delete originalOptions.executionCapacity;
    const encoded = Buffer.from(JSON.stringify({
      id: group.id, minimumSlots: group.minimumSlots, exclusiveResources: group.exclusiveResources,
    })).toString('base64url');
    const groupOptions = {
      ...originalOptions, coverage: false, files: [path.resolve(options.cwd, group.file)], concurrency: 1,
      testNamePatterns: [group.name], signal: cancellation.signal,
      execArgv: [`--conditions=sdlc-group-${encoded}`, ...(options.execArgv ?? [])],
    };
    const groupReport = report?.groupExecution.groups.find(value => value.id === group.id);
    let actualSummary;
    let coverageSummary;
    let groupStart;
    const observeStart = async () => {
      if (groupStart) return;
      const processes = await readTestGroupProcesses(group.id);
      if (!groupStart && processes.length) {
        groupStart = true;
        if (groupReport) {
          groupReport.startedAt = processes[0].startedAt;
          groupReport.processIds = processes.map(process => process.pid);
          groupReport.processes = processes;
          groupReport.workerCommand = [process.execPath, ...groupOptions.execArgv, ...groupOptions.files];
          retainEvent('group-start', { groupId: group.id, rootId: group.rootId,
            startedAt: groupReport.startedAt, processIds: groupReport.processIds,
            minimumSlots: group.minimumSlots, exclusiveResources: group.exclusiveResources });
        }
      }
    };
    // Every invocation owns a separate file process, including roots in the same module.
    const tests = run(groupOptions);
    tests.on('test:coverage', data => { coverageSummary = data.summary; });
    tests.on('test:fail', () => {
      if (!process.exitCode || process.exitCode === 2) process.exitCode = 1;
    });
    if (report) {
      tests.on('test:diagnostic', data => {
        const outcome = retainEvent('diagnostic', {
          groupId: group.id,
          file: data.file && path.relative(options.cwd, data.file).split(path.sep).join('/'),
          nesting: data.nesting, message: data.message,
        });
        if (!outcome) return;
        const { kind, ...diagnostic } = outcome;
        if (!/^(?:tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) \d+(?:\.\d+)?$/u.test(data.message)) {
          report.diagnostics.push(diagnostic);
        }
      });
      tests.on('test:start', data => {
        const names = reportingPaths.get(data.file) ?? [];
        names.length = data.nesting;
        names.push(data.name);
        reportingPaths.set(data.file, names);
      });
      for (const event of ['test:enqueue', 'test:dequeue']) tests.on(event, data => {
        const file = data.file && path.relative(options.cwd, data.file).split(path.sep).join('/');
        const start = { file, name: data.name, nesting: data.nesting, line: data.line, column: data.column };
        const definition = data.name === data.file ? null : nodeStartDefinition(declaredCases, start);
        const retained = retainEvent(event === 'test:enqueue' ? 'registration' : 'start', {
          ...start, groupId: group.id,
          ...(definition ? { parents: definition.parents, assertionId: definition.id } : {}),
        });
        if (event === 'test:dequeue' && definition && retained) observedStarts.push(retained);
      });
      for (const [event, status] of [['test:pass', 'Passed'], ['test:fail', 'Failed']]) {
        tests.on(event, data => {
          const file = data.file && path.relative(options.cwd, data.file).split(path.sep).join('/');
          const actualStatus = data.skip ? 'Skipped' : data.todo ? 'Todo' :
            (['cancelledByParent', 'testAborted'].includes(data.details?.error?.failureType) ||
              cancellation.signal.aborted && data.details?.error?.failureType === 'subtestsFailed') ?
              'Cancelled' : status;
          const diagnostic = data.details?.error && actualStatus === 'Failed' ?
            failureDiagnostic(data.details.error) : null;
          const outcome = retainEvent('completion', {
            groupId: group.id,
            file, name: data.name === data.file || data.name === file ? file : data.name,
            nameDigest: digest(data.name === data.file || data.name === file ? file : data.name),
            parents: (reportingPaths.get(data.file) ?? []).slice(0, data.nesting),
            parentDigests: (reportingPaths.get(data.file) ?? []).slice(0, data.nesting).map(name => digest(name)),
            nesting: data.nesting, line: data.line, column: data.column,
            status: actualStatus,
            skipReason: typeof data.skip === 'string' ? data.skip : null,
            todoReason: typeof data.todo === 'string' ? data.todo : null,
            durationMs: data.details?.duration_ms,
            type: data.details?.type ?? 'test',
            ...(diagnostic ? { diagnostic: diagnostic.diagnostic } : data.details?.error ? { diagnostic: {
              message: String(data.details.error.message),
              code: data.details.error.code ?? null,
              failureType: data.details.error.failureType ?? null,
            } } : {}),
          }, diagnostic?.rejection ? diagnostic : undefined);
          if (!outcome) return;
          const { kind, ...execution } = outcome;
          report.executions.push(execution);
        });
      }
      tests.on('test:summary', data => {
        if (!data.file) actualSummary = {
          success: data.success, counts: data.counts, durationMs: data.duration_ms,
        };
      });
    }
    const durableOutput = new Transform({
      transform(chunk, encoding, callback) {
        observeStart().then(() => journal).then(() => callback(null, chunk), callback);
      },
    });
    // Private sinks neither close shared stdout nor accumulate pipeline listeners on it.
    const output = new Writable({
      write(chunk, encoding, callback) { process.stdout.write(chunk, encoding, callback); },
    });
    const reporterView = new Transform({
      objectMode: true,
      transform(event, encoding, callback) {
        if (event.type === 'test:diagnostic') {
          const diagnostic = failureDiagnostic({ message: event.data.message });
          callback(null, diagnostic.changed ?
            { ...event, data: { ...event.data, message: diagnostic.diagnostic.message } } : event);
          return;
        }
        const error = event.type === 'test:fail' && event.data?.details?.error;
        const diagnostic = error && failureDiagnostic(error);
        if (!diagnostic?.changed) { callback(null, event); return; }
        const safeError = new Error(diagnostic.diagnostic.message);
        safeError.stack = `Error: ${diagnostic.diagnostic.message}`;
        for (const key of ['code', 'failureType']) {
          const value = diagnostic.diagnostic[key];
          if (typeof value === 'string' && /^[A-Za-z0-9_]{1,80}$/u.test(value)) {
            Object.defineProperty(safeError, key, { value, enumerable: false });
          }
        }
        callback(null, { ...event, data: { ...event.data,
          details: { ...event.data.details, error: safeError } } });
      },
    });
    await pipeline(tests, reporterView, new spec(), durableOutput, output);
    await observeStart();
    if (options.coverage) {
      requireThat(coverageSummary?.files?.length > 0, 'EVIDENCE',
        'Coverage requires the actual native child coverage summary for every executed root');
      const safe = sanitizeExecutionPayload(Buffer.from(JSON.stringify({
        ...coverageSummary, files: [],
      })));
      safe.files = coverageSummary.files.map(file =>
        sanitizeExecutionPayload(Buffer.from(JSON.stringify(file))));
      const bytes = Buffer.from(`${JSON.stringify(safe)}\n`);
      requireThat(bytes.length <= LIMITS.artifact, 'CAPACITY', 'Native root coverage exceeds its artifact bound');
      const outputPath = `${reportPath}.coverage-${group.id}.json`;
      const output = await open(outputPath, 'wx');
      try { await output.writeFile(bytes); await output.sync(); }
      finally { await output.close(); }
      const reference = { groupId: group.id,
        reportPath: path.relative(options.cwd, outputPath).split(path.sep).join('/'),
        sha256: digest(bytes), bytes: bytes.length, totals: safe.totals };
      if (report) report.coverage.groups.push(reference);
      retainEvent('coverage', reference);
    }
    if (actualSummary) summaries.push(actualSummary);
    if (!groupReport) return actualSummary?.success ? 'Passed' : 'NotRun';
    const processes = await readTestGroupProcesses(group.id);
    groupReport.processes = processes;
    groupReport.finishedAt = processes.length === 1 ? processes[0].finishedAt : null;
    groupReport.observedFinishedAt = new Date().toISOString();
    groupReport.summary = actualSummary ?? null;
    const executions = report.executions.slice(executionStart).filter(row => row.groupId === group.id);
    const groupInventory = { ...inventory,
      cases: declaredCases.filter(test => group.assertionIds.includes(test.id)),
      files: inventory.files.filter(source => source.file === group.file),
      digest: digest(group.assertionIds) };
    const reconciliation = reconcileNodeExecution(groupInventory, {
      ...report, files: [group.file], executions, summary: actualSummary,
      complete: !cancellation.signal.aborted && !!actualSummary,
      exitCode: actualSummary?.success ? 0 : 1,
    }, { files: [group.file],
      platform: `${{ win32: 'windows', darwin: 'macos', linux: 'linux' }[process.platform]}-${process.arch}` });
    groupReport.status = reconciliation.status;
    if (processes.length !== 1 || !groupReport.startedAt || !groupReport.finishedAt) {
      reconciliation.blockers.push({ code: 'INCOMPLETE_GROUP_PROCESS_OBSERVATION' });
      groupReport.status = reconciliation.counts.failed ? 'Failed' : 'NotRun';
      reconciliation.status = groupReport.status;
    }
    groupReport.reconciliation = {
      status: reconciliation.status, counts: reconciliation.counts, blockers: reconciliation.blockers,
    };
    const notApplicable = reconciliation.counts.required === 0 &&
      reconciliation.blockers.every(blocker => blocker.code === 'EMPTY_DENOMINATOR') &&
      actualSummary?.success === true;
    if (notApplicable) groupReport.disposition = 'not-applicable-on-this-host';
    if (reconciliation.status !== 'Passed' && !notApplicable && !process.exitCode) process.exitCode = 2;
    retainEvent('group-end', { groupId: group.id, rootId: group.rootId,
      finishedAt: groupReport.finishedAt, status: groupReport.status, summary: groupReport.summary,
      processIds: groupReport.processIds });
    return groupReport.status;
  };
  const pool = await runValidationReadyPool(groups, {
    concurrency: options.concurrency, capacity: options.executionCapacity ?? capacity,
    execute: executeGroup, signal: cancellation.signal,
  });
  if (pool.notRun.length) process.exitCode ||= 2;
  if (report && summaries.length) report.summary = {
    success: summaries.length === groups.length && summaries.every(summary => summary.success),
    counts: summaries.reduce((counts, summary) => {
      for (const [key, value] of Object.entries(summary.counts)) {
        if (typeof value === 'number') counts[key] = (counts[key] ?? 0) + value;
      }
      return counts;
    }, {}),
    durationMs: summaries.reduce((total, summary) => total + summary.durationMs, 0),
  };
  finished = true;
} finally {
  try {
    if (reportFile) {
      try {
        if (report && journalFile) {
          for (const row of cancelledNodeStarts({
            cases: declaredCases, starts: observedStarts, executions: report.executions,
            interruption, producerPid: process.pid,
          })) {
            const group = report.groupExecution.groups.find(group =>
              group.assertionIds.includes(row.assertionId) || declaredCases.some(test =>
                group.assertionIds.includes(test.id) && test.file === row.file &&
                test.name === row.name && digest(test.parents) === digest(row.parents)));
            const retained = retainEvent('completion', { ...row, ...(group ? { groupId: group.id } : {}) });
            if (retained) {
              const { kind, ...execution } = retained;
              report.executions.push(execution);
            }
          }
          if (interruption) report.interruption = interruption;
          report.finishedAt = new Date().toISOString();
          const selectedCases = report.executions.filter(row => row.name !== row.file);
          if (finished && selectedCases.length === 0) {
            if (!process.exitCode || process.exitCode < 128) process.exitCode = 2;
            console.error('[test-worker:error] The selected execution produced no test assertions.');
          }
          report.complete = finished && !evidenceError && !cancellation.signal.aborted && report.summary !== null &&
            report.summary.counts.cancelled === 0 && selectedCases.length > 0 &&
            report.groupExecution.groups.every(group =>
              group.startedAt && group.finishedAt && group.summary !== null);
          report.exitCode = process.exitCode ?? 0;
          report.timing.elapsedMs = performance.now() - producerStarted;
          report.timing.exceeded = advisoryMs !== null && report.timing.elapsedMs > advisoryMs;
          report.resources.budget = await readTestBudget();
          if (evidenceError) report.evidenceError = evidenceError;
          retainEvent('execution-end', { complete: report.complete, exitCode: report.exitCode,
            summary: report.summary });
          await journal;
          if (journalError) throw journalError;
          const sanitized = sanitizeExecutionPayload(Buffer.from(JSON.stringify({
            ...report, executions: [], diagnostics: [],
            groupExecution: { ...report.groupExecution, groups: [] },
          })));
          sanitized.executions = report.executions.map(row =>
            sanitizeExecutionPayload(Buffer.from(JSON.stringify(row))));
          sanitized.diagnostics = report.diagnostics.map(row =>
            sanitizeExecutionPayload(Buffer.from(JSON.stringify(row))));
          sanitized.groupExecution.groups = report.groupExecution.groups.map(group =>
            sanitizeExecutionPayload(Buffer.from(JSON.stringify(group))));
          const bytes = Buffer.from(`${JSON.stringify(sanitized)}\n`);
          requireThat(bytes.length <= LIMITS.artifact, 'CAPACITY', 'Test report exceeds its artifact bound');
          await reportFile.writeFile(bytes);
          await reportFile.sync();
        }
      } finally {
        await journalFile?.close();
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
