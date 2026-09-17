import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { registerArtifact } from '../src/artifacts.mjs';
import { captureReceipt, prepareDecision, applyDecision } from '../src/decisions.mjs';
import { resume, acknowledgeContext } from '../src/recovery.mjs';
import { classifyTool } from '../src/gate.mjs';
import { loadConfig } from '../src/artifacts.mjs';
import { digest } from '../src/core.mjs';
const execute = promisify(execFile);
export async function fixture(t, { initialize = true } = {}) {
  const root = path.resolve('.test-data', randomUUID());
  await fs.mkdir(root, { recursive: true });
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve('.test-data'));
    await fs.rm(root, { recursive: true });
    await assert.rejects(fs.stat(root), { code: 'ENOENT' });
  });
  const repo = path.join(root, 'repository with spaces');
  const home = path.join(root, 'isolated copilot home');
  await fs.mkdir(repo);
  const runGit = async (...args) => (await execute('git', args, { cwd: repo,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Fixture',
      GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
      GIT_TERMINAL_PROMPT: '0' } })).stdout.trim();
  await runGit('init', '-q', '-b', 'feature/fixture');
  await runGit('remote', 'add', 'origin', 'https://example.invalid/repository.git');
  const clock = { value: Date.parse('2026-09-08T00:00:00Z'), now() { return this.value; }, advance(ms) { this.value += ms; } };
  const store = await new Store(home, { clock }).ready();
  if (initialize) {
    await captureReceipt(store, { sessionId: 'session-a', source: 'userPromptSubmitted', input: 'Create the isolated component fixture work item.' });
    await store.init({ workItemId: 'wi-test', repositoryId: 'primary', cwd: repo, sessionId: 'session-a' });
  }
  return { root, repo, home, store, clock, runGit, workItemId: 'wi-test', sessionId: 'session-a' };
}
export async function artifact(f, role, contents) {
  const relative = `docs/${role}.md`;
  await fs.mkdir(path.join(f.repo, 'docs'), { recursive: true });
  await fs.writeFile(path.join(f.repo, relative), contents);
  return relative;
}
export async function cli(f, args, input) {
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [path.resolve('bin/sdlc.mjs'), ...args], {
      cwd: f.repo, env: { ...process.env, COPILOT_HOME: f.home, SDLC_SESSION_ID: f.sessionId },
      maxBuffer: 2 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error && typeof error.code !== 'number') reject(error);
      else {
        const lines = stdout.trim().split('\n').filter(Boolean);
        const final = lines.filter(line => {
          try { return JSON.parse(line).type !== 'progress'; }
          catch { return true; }
        }).at(-1);
        resolve({ code: error?.code ?? 0, stdout, stderr, json: final ? JSON.parse(final) : null });
      }
    });
    if (input !== undefined) child.stdin.end(JSON.stringify(input)); else child.stdin.end();
  });
}
export async function grant(f, kind, effect, { prepared = false, sessionId = f.sessionId, input = `User explicitly authorizes ${kind}` } = {}) {
  const decision = prepared ? await prepareDecision(f.store, { workItemId: f.workItemId, sessionId, kind, effect }) : null;
  f.clock.advance(1);
  const receipt = await captureReceipt(f.store, { sessionId, source: 'userPromptSubmitted', input });
  const request = { workItemId: f.workItemId, sessionId, kind, effect, receiptId: receipt.id, input,
    ...(decision ? { decisionId: decision.id } : {}) };
  return { ...(await applyDecision(f.store, request)), request, receipt, decision };
}
export async function coding(f) {
  for (const [role, content] of [
    ['requirements', '# Requirements\n### FR-001 - Safe work\n**Definition of Done**\n- AC-001.1: A request is safely handled.\n'],
    ['test-plan', '# Plan\n| ID | Requirements | Conditions | Environment | Level | Checkpoint | Mode | Owner | Location | Expected outcome | Implementation | Status |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n' +
      testDefinitions().map(test => `| ${test.id} | FR-001 | AC-001.1 | ${test.environment} | ${test.level} | ${test.checkpoint} | ${test.mode} | ${test.owner} | ${test.location} | ${test.expected} | ${test.implementation} | NotRun |`).join('\n') + '\n'],
    ['technical-design', '# Technical Design\nUse an offline ledger.\n'],
  ]) {
    const relative = await artifact(f, role, content);
    await registerArtifact(f.store, { workItemId: f.workItemId, role, repositoryId: 'primary', path: relative });
  }
  const phases = ['requirements', 'test-design', 'technical-design', 'coding'];
  for (let index = 0; index < 3; index++) await grant(f, 'approval', { transition: { from: phases[index], to: phases[index + 1] } }, { prepared: true });
  return f;
}
export async function orient(f, sessionId = f.sessionId) {
  const result = await resume(f.store, { cwd: f.repo, sessionId, workItemId: f.workItemId });
  await acknowledgeContext(f.store, { cwd: f.repo, sessionId, workItemId: f.workItemId, token: result.orientationToken });
  return result.orientationToken;
}
export async function completeReview(f, cycle) {
  const review = await grant(f, 'review-result', {
    cycleId: cycle.id, candidateDigest: cycle.candidateDigest, testSpecDigest: cycle.testSpecDigest,
    configDigest: cycle.configDigest, status: 'Passed', evidenceRef: 'copilot-cli:/review:fixture',
    summary: 'No blocking findings', blockingFindings: [], completedStage: 'review',
  }, { input: 'I ran GitHub Copilot CLI /review for this candidate; it reported no blocking findings. Continue.' });
  return review;
}
export async function pushAction(f, command = 'git push --no-follow-tags --no-recurse-submodules origin refs/heads/feature/fixture:refs/heads/feature/fixture') {
  const state = await f.store.load(f.workItemId);
  const member = state.metadata.members.find(item => item.repositoryId === 'primary');
  return (await classifyTool(f.store, { toolName: 'bash', toolArgs: { command }, cwd: f.repo },
    state, member, await loadConfig(state.metadata, member.repositoryId)))[0];
}
export function pushPermission(action) {
  return { grant: 'push', target: action.target, remoteUrlDigest: action.remoteUrlDigest,
    sourceRef: action.sourceRef, targetRef: action.targetRef,
    ...(action.sourceRevision ? { sourceRevision: action.sourceRevision } : {}),
    force: action.force, delete: action.delete };
}
export async function grantPush(f, command = 'git push --no-follow-tags --no-recurse-submodules origin refs/heads/feature/fixture:refs/heads/feature/fixture', options = {}) {
  const action = await pushAction(f, command);
  const { effect = {}, ...grantOptions } = options;
  return { action, grant: await grant(f, 'permission', { ...pushPermission(action), ...effect }, grantOptions) };
}
export function syntheticPushAction(target = 'origin') {
  return { class: 'push', repositoryId: 'primary', target, remoteUrlDigest: digest([target]),
    sourceRef: 'refs/heads/feature/fixture', targetRef: 'refs/heads/feature/fixture',
    force: false, delete: false };
}
export const testDefinitions = () => [
  { id: 'T-unit', environment: 'local', level: 'unit', checkpoint: 'pre-review', mode: 'automated', owner: 'agent', location: 'local', implementation: 'test/unit.mjs', expected: 'All assertions pass' },
  { id: 'T-integration', environment: 'local', level: 'integration', checkpoint: 'pre-review', mode: 'automated', owner: 'agent', location: 'local', implementation: 'test/integration.mjs', expected: 'Integration contract holds' },
  { id: 'T-dev', environment: 'DEV', level: 'integration', checkpoint: 'DEV', mode: 'semi-automated', owner: 'agent', location: 'development-machine', implementation: 'docs/dev-flow.md', expected: 'DEV scenario succeeds' },
  { id: 'T-staging', environment: 'STAGING', level: 'integration', checkpoint: 'STAGING', mode: 'automated', owner: 'user', location: 'authorized-machine', implementation: 'docs/staging-suite.md', expected: 'STAGING suite passes' },
];
