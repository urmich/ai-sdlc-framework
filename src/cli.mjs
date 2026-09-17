import path from 'node:path';
import { LIMITS, parseJson, requireThat, SdlcError } from './core.mjs';
import { readBytes, readJson } from './files.mjs';
import { Store } from './store.mjs';
import { registerArtifact } from './artifacts.mjs';
import { captureReceipt, prepareDecision, applyDecision } from './decisions.mjs';
import { prepareOperation, markDispatching, recordOperation, addConflict, resolveConflict, pruneWork } from './operations.mjs';
import { preparePr, adoptPr, updatePrFacts, evaluateReadiness } from './pr.mjs';
import { associateMonitor, attachMonitor, refreshMonitorCapabilities, claimMonitor, beginPoll, observeMonitor, verifyMonitorLink, monitorNotice, interruptMonitor, dueMonitors, pruneMonitor } from './monitors.mjs';
import { formatAudit, recordAudit, replayAudit } from './audit.mjs';
import { status, resume, acknowledgeContext } from './recovery.mjs';
import { startCycle, recordTest, recordArtifact, stagingHandoff } from './validation.mjs';
import { gate } from './gate.mjs';
import { handleHook } from './hooks.mjs';
import { check } from './checks.mjs';
import { cleanInstall, install, uninstall, doctor, selectMaintenanceSource } from './install.mjs';

export function parseArguments(argv) {
  const flags = {}, words = [];
  const valued = new Set(['home', 'cwd', 'session', 'work-item', 'repository', 'token', 'operation', 'commit', 'input-file', 'source-root']);
  const boolean = new Set(['json', 'human', 'help', 'adopt', 'purge', 'purge-existing']);
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (!argument.startsWith('--')) { words.push(argument); continue; }
    const name = argument.slice(2);
    requireThat(!Object.hasOwn(flags, name), 'INPUT', `Duplicate option --${name}`);
    if (boolean.has(name)) flags[name] = true;
    else {
      requireThat(valued.has(name) && argv[index + 1] && !argv[index + 1].startsWith('--'), 'INPUT', `Unknown option or missing value: --${name}`);
      flags[name] = argv[++index];
    }
  }
  return { flags, words };
}
async function stdinJson(stream) {
  if (stream.isTTY) return {};
  let size = 0;
  const chunks = [];
  for await (const chunk of stream) {
    size += Buffer.byteLength(chunk);
    requireThat(size <= LIMITS.input, 'CAPACITY', 'Standard input exceeds 1 MiB');
    chunks.push(Buffer.from(chunk));
  }
  const input = Buffer.concat(chunks).toString('utf8').trim();
  return input ? parseJson(input) : {};
}
export const HELP = `AI SDLC Framework 1.0
Usage: sdlc <command> [subcommand] [--work-item ID] [--session ID] [--json|--human]
Commands:
  doctor | install [--purge-existing] | update | uninstall [--purge] | maintenance select
  init | create | adopt | member bind | artifact register
  status | resume | context ack
  receipt latest|capture | decision prepare|apply
  op show|prepare|mark-dispatching|record|reconcile | conflict add|resolve
  cycle start | evidence test|artifact | handoff staging
  pr prepare|create-result|adopt|update|evaluate
  monitor attach|associate|refresh-capabilities|claim|begin-poll|observe|link|notice|interrupt|due|prune
  audit format|record|replay | gate | hook EVENT
  check artifacts|state|history|evidence|all | prune
JSON mutations read stdin or --input-file FILE. No network, commit or push commands.
Use --home for isolated COPILOT_HOME; --cwd, --session, --repository identify context.
See docs/cli.md (installed: <COPILOT_HOME>/sdlc/cli.md) for contracts.`;

export async function runCli(argv = process.argv.slice(2), io = process) {
  const { flags, words } = parseArguments(argv);
  const [command, subcommand] = words;
  if (!command || flags.help || command === 'help') return { result: { help: HELP }, exitCode: 0, human: true };
  requireThat(words.length <= 2, 'INPUT', 'Unexpected positional arguments');
  if (['doctor', 'install', 'update', 'uninstall', 'init', 'create',
    'adopt', 'status', 'resume', 'gate', 'prune'].includes(command)) {
    requireThat(subcommand === undefined, 'INPUT',
      `${command} does not accept a positional subcommand`);
  }
  requireThat(!flags.purge || command === 'uninstall', 'INPUT',
    '--purge is supported only with uninstall');
  requireThat(!flags['purge-existing'] || command === 'install', 'INPUT',
    '--purge-existing is supported only with install');
  const store = new Store(flags.home);
  if (command === 'doctor') return { result: await doctor(store), exitCode: 0, human: flags.human };
  if (['install', 'update'].includes(command)) {
    const options = flags['source-root'] ?
      { sourceRoot: path.resolve(flags['source-root']) } : {};
    return {
      result: command === 'install' && flags['purge-existing'] ?
        await cleanInstall(store, options) : await install(store, options),
      exitCode: 0,
      human: flags.human,
    };
  }
  if (command === 'uninstall') return {
    result: await uninstall(store, { purge: flags.purge === true }),
    exitCode: 0,
    human: flags.human,
  };
  await store.ready();
  const cwd = path.resolve(flags.cwd ?? process.cwd());
  const sessionId = flags.session ?? process.env.SDLC_SESSION_ID;
  const needsInput = ['init', 'create', 'adopt', 'member', 'artifact', 'receipt', 'decision', 'op', 'conflict', 'cycle', 'evidence', 'pr', 'monitor', 'audit', 'context', 'gate', 'hook', 'maintenance'].includes(command);
  const body = needsInput ? flags['input-file'] ? parseJson((await readBytes(path.resolve(cwd, flags['input-file']))).toString('utf8')) : await stdinJson(io.stdin) : {};
  requireThat(body && typeof body === 'object' && !Array.isArray(body), 'INPUT', 'Command input must be a JSON object');
  if (command === 'gate') return { result: await gate(store, body), exitCode: 0 };
  if (command === 'hook') return { result: await handleHook(store, subcommand, body), exitCode: 0 };
  let workItemId = flags['work-item'] ?? body.workItemId;
  const independent = ['init', 'create', 'adopt', 'receipt', 'monitor', 'maintenance'].includes(command);
  if (!independent && !workItemId) {
    requireThat(sessionId || body.sessionId, 'INPUT', 'Use --session (or SDLC_SESSION_ID) and bind the work item, or provide --work-item');
    workItemId = (await store.resolve(cwd, sessionId ?? body.sessionId)).workItemId;
  }
  const work = { ...body, ...(workItemId ? { workItemId } : {}) };
  const session = { ...work, sessionId: body.sessionId ?? sessionId };
  let result;
  switch (command) {
    case 'init': case 'create': case 'adopt':
      result = await store.init({ ...session, cwd: body.cwd ?? cwd, repositoryId: body.repositoryId ?? flags.repository,
        ...(command === 'adopt' || flags.adopt ? { adopt: true } : {}) }); break;
    case 'member': requireThat(subcommand === 'bind', 'INPUT', 'Use member bind');
      result = await store.bindMember({ ...session, cwd: body.cwd ?? cwd, repositoryId: body.repositoryId ?? flags.repository }); break;
    case 'artifact': requireThat(subcommand === 'register', 'INPUT', 'Use artifact register'); result = await registerArtifact(store, work); break;
    case 'status': result = await status(store, workItemId); break;
    case 'resume': result = await resume(store, { workItemId, sessionId, cwd }); break;
    case 'context': requireThat(subcommand === 'ack', 'INPUT', 'Use context ack'); result = await acknowledgeContext(store, { ...session, cwd, token: flags.token ?? body.token }); break;
    case 'receipt':
      if (subcommand === 'capture') result = await captureReceipt(store, { ...body, sessionId: body.sessionId ?? sessionId });
      else if (subcommand === 'latest') {
        const current = await readJson(store.sessionPath(body.sessionId ?? sessionId));
        result = { sessionId: current.sessionId, receiptId: current.lastReceiptId ?? null, pendingDecisionId: current.pendingDecisionId ?? null };
      } else throw new SdlcError('INPUT', 'Use receipt latest|capture');
      break;
    case 'decision':
      requireThat(['prepare', 'apply'].includes(subcommand), 'INPUT', 'Use decision prepare|apply');
      result = await (subcommand === 'prepare' ? prepareDecision : applyDecision)(store, session); break;
    case 'op':
      if (subcommand === 'show') {
        const operationId = flags.operation ?? body.operationId;
        const record = (await store.records(workItemId)).find(record => record.id === operationId);
        requireThat(record?.type === 'operation', 'OPERATION', 'Active operation is unavailable; consult archived terminal evidence');
        result = { operation: record, nextAction: record.status === 'prepared' ? 'Dispatch only while current authority still applies.' : 'Query the provider read-only using the recorded handle/target/correlation key; never infer no effect from an absent response.' };
      } else if (subcommand === 'prepare') result = await prepareOperation(store, session);
      else if (subcommand === 'mark-dispatching') result = await markDispatching(store, workItemId, flags.operation ?? body.operationId);
      else if (['record', 'reconcile'].includes(subcommand)) result = await recordOperation(store, work, { reconcile: subcommand === 'reconcile' });
      else throw new SdlcError('INPUT', 'Use op prepare|mark-dispatching|record|reconcile');
      break;
    case 'conflict':
      requireThat(['add', 'resolve'].includes(subcommand), 'INPUT', 'Use conflict add|resolve');
      result = await (subcommand === 'add' ? addConflict : resolveConflict)(store, work); break;
    case 'cycle': requireThat(subcommand === 'start', 'INPUT', 'Use cycle start'); result = await startCycle(store, work); break;
    case 'evidence':
      requireThat(['test', 'artifact'].includes(subcommand), 'INPUT', 'Use evidence test|artifact');
      result = await (subcommand === 'test' ? recordTest : recordArtifact)(store, work); break;
    case 'handoff': requireThat(subcommand === 'staging', 'INPUT', 'Use handoff staging'); result = await stagingHandoff(store, workItemId); break;
    case 'pr':
      if (subcommand === 'prepare') result = await preparePr(store, work);
      else if (['adopt', 'create-result'].includes(subcommand)) result = await adoptPr(store, work);
      else if (subcommand === 'update') result = await updatePrFacts(store, work);
      else if (subcommand === 'evaluate') {
        const { workItemId: ignored, ...evaluation } = work;
        result = evaluateReadiness((await store.load(workItemId)).records, evaluation, { clock: store.clock });
      } else throw new SdlcError('INPUT', 'Use pr prepare|create-result|adopt|update|evaluate');
      break;
    case 'monitor': {
      const handlers = { attach: attachMonitor, associate: associateMonitor, 'refresh-capabilities': refreshMonitorCapabilities,
        claim: claimMonitor, 'begin-poll': beginPoll, observe: observeMonitor,
        link: verifyMonitorLink, notice: monitorNotice, interrupt: interruptMonitor, due: dueMonitors, prune: pruneMonitor };
      requireThat(handlers[subcommand], 'INPUT', 'Unknown monitor operation');
      result = await handlers[subcommand](store, body); break;
    }
    case 'maintenance':
      requireThat(subcommand === 'select', 'INPUT', 'Use maintenance select');
      result = await selectMaintenanceSource(store, {
        ...body,
        sessionId: body.sessionId ?? sessionId,
      });
      break;
    case 'audit':
      if (subcommand === 'format') result = await formatAudit(store, workItemId, body.eventIds);
      else if (subcommand === 'record') result = await recordAudit(store, { ...work, repositoryId: body.repositoryId ?? flags.repository, commit: body.commit ?? flags.commit });
      else if (subcommand === 'replay') result = await replayAudit(store, workItemId, { persist: false });
      else throw new SdlcError('INPUT', 'Use audit format|record|replay');
      break;
    case 'check': result = await check(store, workItemId, subcommand); return { result, exitCode: result.exitCode, human: flags.human };
    case 'prune': result = await pruneWork(store, workItemId); break;
    default: throw new SdlcError('INPUT', `Unknown command: ${command}`);
  }
  return { result, exitCode: 0, human: flags.human };
}
export function humanOutput(result) {
  if (result.help) return result.help;
  if (result.trailers) return result.trailers;
  if (result.summary) return [result.summary, ...result.findings.filter(f => f.verdict !== 'satisfied').map(f => `${f.verdict} ${f.rule}: ${f.reason}`)].join('\n');
  if (result.message) return result.message;
  if (result.nextAction) return `${result.phase ?? 'SDLC'}: ${result.nextAction}${result.orientationToken ? `\nOrientation token: ${result.orientationToken}` : ''}`;
  return JSON.stringify(result, null, 2);
}
