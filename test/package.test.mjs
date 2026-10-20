export const validationDeclarations = {
  "schemaVersion": 1,
  "plannedCases": [{"id": "T-PRD046", "selectors": [{"name": "T-36 package is reproducible, integrity-bound and installable in isolation", "parents": []}]}],
  "surfaces": [{"coverage": "direct", "paths": ["scripts/package.mjs", "scripts/verify-package.mjs"]}]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildPackage, npmInvocation } from '../scripts/package.mjs';
import { packageInstallArguments, verifyPackage } from '../scripts/verify-package.mjs';
import { isolatedNpmEnvironment } from './npm-environment.mjs';
import { parseWorkflow, validateWorkflowPolicy, workflowActionPins } from '../scripts/workflow-policy.mjs';
import { nativeWorkflowContract } from '../scripts/native-validation.mjs';

test('T-36 package is reproducible, integrity-bound and installable in isolation', async t => {
  const root = path.resolve('.test-data', randomUUID());
  await fs.mkdir(root, { recursive: true });
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  const environment = await isolatedNpmEnvironment(root);
  const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
  assert.equal(pkg.publishConfig?.access, 'public');
  assert.equal(pkg.publishConfig?.registry, 'https://registry.npmjs.org');
  assert.match(pkg.repository?.url ?? '', /^https:\/\/github\.com\/[^/]+\/[^/]+\.git$/u);
  const built = await buildPackage({ outputDir: path.join(root, 'dist'), environment });
  assert.equal(built.filename, `${pkg.name}-${pkg.version}.tgz`);
  assert.match(built.sha256, /^[a-f0-9]{64}$/u);
  assert.ok(built.files.some(file => file.path === 'bin/sdlc.mjs'));
  assert.ok(built.files.some(file =>
    file.path === 'docs/integrations/provider-adapters.md'));
  assert.ok(!built.files.some(file => file.path.startsWith('test/') ||
    file.path.startsWith('runtime/') || file.path.startsWith('.git/')));
  assert.deepEqual(await fs.readdir(path.dirname(built.artifact)), [built.filename]);
  const sources = await Promise.all(['ci', 'release', 'npm-publish', 'release-acceptance'].map(async name => ({
    file: `.github/workflows/${name}.yml`,
    contents: await fs.readFile(`.github/workflows/${name}.yml`, 'utf8'),
  })));
  assert.equal(validateWorkflowPolicy(sources).complete, true);
  const documents = new Map(sources.map(input => [input.file, parseWorkflow(input)]));
  const ci = documents.get(nativeWorkflowContract.path);
  const steps = Object.values(ci.jobs).flatMap(job => job.steps ?? []);
  const native = steps.find(step => step.name === nativeWorkflowContract.steps.execution);
  assert.ok(native?.run.includes('scripts/native-validation.mjs'),
    'CI must delegate to the substantive native driver, not omit validation behind missing npm literals');
  const [sourceId, sourceJob] = Object.entries(ci.jobs).find(([, job]) =>
    job.name === nativeWorkflowContract.sourceJob) ?? [];
  const [intentId, intentJob] = Object.entries(ci.jobs).find(([, job]) =>
    job.name === nativeWorkflowContract.intentJob) ?? [];
  assert.ok(sourceId && intentId);
  assert.ok(sourceJob.steps.some(step => step.run?.includes('scripts/native-validation.mjs') &&
    /--phase\s+candidate/u.test(step.run)), 'One source job must freeze the common candidate');
  assert.ok(intentJob.steps.every(step => !step.uses?.startsWith('actions/checkout@')));
  const nativeJobs = Object.values(ci.jobs).filter(job =>
    job.steps?.some(step => step.name === nativeWorkflowContract.steps.execution));
  const targets = nativeJobs.flatMap(job => job.strategy?.matrix?.target ??
    job.strategy?.matrix?.include?.map(item => item.target) ?? []);
  assert.deepEqual(targets.sort(), Object.keys(nativeWorkflowContract.jobs).sort());
  for (const job of nativeJobs) {
    const needs = Array.isArray(job.needs) ? job.needs : [job.needs];
    assert.ok(needs.includes(sourceId) && needs.includes(intentId));
  }
  const nativeSource = await fs.readFile('scripts/native-validation.mjs', 'utf8');
  assert.match(nativeSource, /name: 'static'[\s\S]*?args: \['scripts\/check\.mjs'\]/u);
  assert.match(nativeSource, /staticReport\.complete && staticReport\.exitCode === 0/u);
  const candidateSource = await fs.readFile('scripts/release-bundle.mjs', 'utf8');
  assert.match(candidateSource, /await buildPackage\(/u);
  assert.match(candidateSource, /await verifyRelease\(/u);
  const release = documents.get('.github/workflows/release.yml');
  assert.equal(release.jobs['npm-handoff'].uses, './.github/workflows/npm-publish.yml');
  assert.equal(release.jobs.acceptance.uses, './.github/workflows/release-acceptance.yml');
  assert.equal(release.jobs['npm-handoff'].permissions['id-token'], 'write');
  assert.ok(Object.values(release.jobs).flatMap(job => job.steps ?? [])
    .some(step => step.uses === `actions/upload-artifact@${workflowActionPins['actions/upload-artifact']}`));
  const publication = await fs.readFile('scripts/npm-handoff.mjs', 'utf8');
  assert.ok(publication.includes('pkg.repository?.url !== `https://github.com/${sourceRepository}.git`'));
  const protectedWorkflow = documents.get('.github/workflows/npm-publish.yml');
  assert.equal(protectedWorkflow.jobs.publish.environment, 'npm');
  assert.equal(protectedWorkflow.jobs.publish.env.NPM_TOOL_VERSION, '11.16.0');
  assert.ok(protectedWorkflow.jobs.publish.steps.some(step =>
    step.uses?.startsWith('actions/setup-node@') && step.with?.['node-version'] === '24.22.0'));
  assert.ok(protectedWorkflow.jobs.publish.steps.every(step => !step.uses?.startsWith('actions/checkout@')));
  assert.ok(protectedWorkflow.jobs.publish.steps.every(step => !/--provenance|npm (?:ci|run)|node scripts\//u.test(step.run ?? '')));
  const sourceBefore = await fs.readFile('src/core.mjs');
  await assert.rejects(buildPackage({ outputDir: 'src' }),
    /empty or contain only owned distribution files/u);
  assert.deepEqual(await fs.readFile('src/core.mjs'), sourceBefore);
  const windowsNpm = npmInvocation(['pack'], {
    platform: 'win32', execPath: 'C:\\Program Files\\nodejs\\node.exe', npmExecPath: '',
  });
  assert.equal(windowsNpm.command, 'C:\\Program Files\\nodejs\\node.exe');
  assert.match(windowsNpm.args[0], /npm-cli\.js$/u);
  assert.ok(!windowsNpm.args[0].endsWith('.cmd'));
  assert.ok(packageInstallArguments('prefix', 'artifact.tgz').includes('--bin-links=false'));
  const verified = await verifyPackage({ artifact: built.artifact, environment });
  assert.equal(verified.verified, true);
  assert.equal(verified.sha256, built.sha256);
  const previousUmask = process.umask(0o077);
  try {
    assert.equal((await verifyPackage({ artifact: built.artifact, environment })).verified, true);
  } finally {
    process.umask(previousUmask);
  }
  await fs.appendFile(built.artifact, Buffer.from([0]));
  await assert.rejects(verifyPackage({ artifact: built.artifact, environment }),
    /identity or integrity/u);
});
