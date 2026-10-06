import * as fs from 'node:fs/promises';
import path from 'node:path';
import { canonical, digest, id, LIMITS, requireThat, text } from './core.mjs';
import { canonicalPath } from './files.mjs';
import { normalizeToolName, SHELL_FAMILIES } from './platform.mjs';

function supportedContract(contract) {
  if (contract?.propagatesUniqueCallId !== true) return false;
  for (const field of ['adapterId', 'dispatchIdField', 'resultIdField']) {
    id(contract[field], `host contract ${field}`);
  }
  return true;
}

function normalizedArgs(toolName, value) {
  let args = value;
  if (typeof args === 'string') {
    try {
      const parsed = JSON.parse(args);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        args = parsed;
      } else if (SHELL_FAMILIES.includes(toolName)) {
        args = { command: value };
      }
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      if (SHELL_FAMILIES.includes(toolName)) args = { command: value };
    }
  }
  const serialized = canonical(args);
  requireThat(Buffer.byteLength(serialized, 'utf8') <= LIMITS.input, 'CAPACITY',
    'Tool arguments exceed the input budget');
  return args;
}

// adapterContract must come from a documented, trusted host adapter, never from
// a hook payload. An ID-shaped payload alone cannot establish call provenance.
export async function prepareHostInvocation({
  sessionId, toolName, toolArgs, cwd, shell, hostCallId,
}, { adapterContract } = {}) {
  text(sessionId, 'host session ID');
  text(toolName, 'host tool name');
  requireThat(typeof cwd === 'string' && path.isAbsolute(cwd), 'PATH',
    'Host working directory must be explicit and absolute');
  const canonicalCwd = await canonicalPath(cwd);
  requireThat((await fs.stat(canonicalCwd)).isDirectory(), 'PATH',
    'Host working directory must exist');
  const normalizedTool = normalizeToolName(toolName, { shellHint: shell });
  requireThat(normalizedTool !== 'ambiguous-shell', 'INPUT',
    'Shell family is ambiguous');
  const isShell = SHELL_FAMILIES.includes(normalizedTool);
  requireThat(isShell ? (shell === undefined || shell === normalizedTool) :
    shell === undefined, 'INPUT', 'Shell must match the invoked shell tool');
  const toolShell = isShell ? normalizedTool : null;
  const toolArgsDigest = digest(normalizedArgs(normalizedTool, toolArgs));
  const fingerprint = digest({
    sessionId, toolName: normalizedTool, toolArgsDigest, cwd: canonicalCwd, shell: toolShell,
  });
  const invocation = {
    fingerprint, sessionDigest: digest(sessionId), toolName: normalizedTool,
    cwdDigest: digest(canonicalCwd), shell: toolShell,
  };
  if (supportedContract(adapterContract) && hostCallId !== undefined) {
    id(hostCallId, 'proven host call ID');
    invocation.hostAdapterId = adapterContract.adapterId;
    invocation.hostContractDigest = digest({
      adapterId: adapterContract.adapterId,
      dispatchIdField: adapterContract.dispatchIdField,
      resultIdField: adapterContract.resultIdField,
    });
    invocation.hostCallIdDigest = digest(hostCallId);
  }
  return invocation;
}

export async function matchHostInvocation(prepared, callback, {
  adapterContract,
} = {}) {
  requireThat(prepared && typeof prepared === 'object' &&
    typeof prepared.fingerprint === 'string', 'INPUT',
  'Expected a prepared host invocation');
  const observed = await prepareHostInvocation(callback, { adapterContract });
  if (prepared.fingerprint !== observed.fingerprint ||
      prepared.sessionDigest !== observed.sessionDigest ||
      prepared.toolName !== observed.toolName ||
      prepared.cwdDigest !== observed.cwdDigest || prepared.shell !== observed.shell) {
    return { status: 'mismatch', reason: 'host-invocation-identity-mismatch' };
  }
  if (!prepared.hostCallIdDigest || !observed.hostCallIdDigest) {
    return { status: 'uncertain', reason: 'host-call-id-unproven' };
  }
  if (prepared.hostAdapterId !== observed.hostAdapterId ||
      prepared.hostContractDigest !== observed.hostContractDigest) {
    return { status: 'mismatch', reason: 'different-host-adapter-contract' };
  }
  if (prepared.hostCallIdDigest !== observed.hostCallIdDigest) {
    return { status: 'mismatch', reason: 'different-host-call-id' };
  }
  return { status: 'matched', bindingDigest: digest({
    fingerprint: prepared.fingerprint,
    adapterId: prepared.hostAdapterId,
    hostCallIdDigest: prepared.hostCallIdDigest,
  }) };
}
