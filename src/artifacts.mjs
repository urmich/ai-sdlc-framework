import path from 'node:path';
import * as fs from 'node:fs/promises';
import { LIMITS, budget, choice, digest, id, object, requireThat, safeRecord, strings, text } from './core.mjs';
import { atomicWrite, canonicalPath, exists, listJson, readBytes, readJson, safePath, withLock, writeJson } from './files.mjs';
import { git } from './git.mjs';
import { activeEvents, currentTestEvidence, permissionMatches } from './authority.mjs';
import { validateManifest } from './schemas.mjs';
import { HOST_PLATFORMS, SHELL_FAMILIES, sameNativePath } from './platform.mjs';
import { STAGING_OWNERS } from './staging.mjs';

export const ROLES = ['requirements', 'test-plan', 'technical-design'];
export function artifactRepositoryId(locator, manifest) {
  return locator.repositoryId ?? manifest.coordinatorId;
}
export function artifactDocumentId(locator) {
  return locator.artifactId ?? 'default';
}
export function artifactIdentity(locator, manifest) {
  return `${locator.role}\0${artifactRepositoryId(locator, manifest)}\0${artifactDocumentId(locator)}`;
}
function artifactOrder(left, right, manifest) {
  return ROLES.indexOf(left.role) - ROLES.indexOf(right.role) ||
    artifactRepositoryId(left, manifest).localeCompare(artifactRepositoryId(right, manifest)) ||
    artifactDocumentId(left).localeCompare(artifactDocumentId(right)) ||
    (left.path ?? left.locatorId).localeCompare(right.path ?? right.locatorId);
}
export function artifactLocator(locator, manifest) {
  return locator.kind === 'git' ?
    `${artifactRepositoryId(locator, manifest)}:${artifactDocumentId(locator) === 'default' ?
      '' : `${artifactDocumentId(locator)}:`}${locator.path}` :
    locator.locatorId;
}
export async function artifactPath(store, workItemId, locator, metadata) {
  if (locator.kind === 'external-file') {
    const mapping = await readJson(store.recordPath(workItemId, locator.locatorId));
    requireThat(mapping.id === locator.locatorId && mapping.digest === locator.digest,
      'BINDING', 'External locator does not match');
    return canonicalPath(mapping.path);
  }
  const member = metadata.members.find(m => m.repositoryId === locator.repositoryId);
  requireThat(member, 'BINDING', `No local mapping for repository ${locator.repositoryId}`);
  return safePath(member.root, locator.path);
}
export async function registerArtifact(store, input, { fault = async () => {} } = {}) {
  object(input, ['workItemId', 'role', 'repositoryId', 'artifactId', 'path', 'externalPath', 'authorizationId', 'planned'], ['workItemId', 'role']);
  choice(input.role, ROLES, 'artifact role');
  const artifactId = input.artifactId ? id(input.artifactId, 'artifact ID') : 'default';
  if (input.planned !== undefined) requireThat(typeof input.planned === 'boolean',
    'INPUT', 'planned must be a boolean');
  return withLock(path.join(store.workPath(input.workItemId), '.lock'), async () => {
    const { metadata, manifest, file } = await store.manifest(input.workItemId);
    let locator;
    let resolved;
    const repositoryId = input.repositoryId ?? metadata.coordinatorId;
    const identity = `${input.role}\0${repositoryId}\0${artifactId}`;
    if (input.externalPath) {
      const records = await store.records(input.workItemId);
      const checkpoint = await readJson(path.join(
        store.workPath(input.workItemId), 'checkpoint.json'), {
        limit: LIMITS.checkpoint,
      });
      const event = activeEvents(records, {
        cycleId: checkpoint.validationCycleRef,
        clock: store.clock,
      }).find(record => record.id === input.authorizationId &&
        permissionMatches(record, 'artifact-location', {
          class: 'document',
          repositoryId,
          target: input.externalPath,
        }, records));
      requireThat(event, 'AUTHORITY',
        'External artifact registration requires active explicit location authority');
      resolved = await canonicalPath(input.externalPath);
      locator = {
        role: input.role,
        kind: 'external-file',
        repositoryId,
        ...(artifactId === 'default' ? {} : { artifactId }),
      };
    } else {
      const member = metadata.members.find(m => m.repositoryId === repositoryId);
      requireThat(member, 'BINDING', 'Artifact repository is not a participating member');
      requireThat(!input.path.split(/[\\/]/u).some(part => ['.git', '.sdlc'].includes(part)),
        'PATH', 'Canonical artifacts cannot be registered in protected Git or framework metadata paths');
      resolved = await safePath(member.root, input.path);
      const relative = path.relative(member.root, resolved)
        .split(path.sep).join('/');
      requireThat(relative && !relative.startsWith('../'), 'PATH',
        'Canonical artifact path must remain inside its repository');
      requireThat(!relative.split('/').some(part =>
        ['.git', '.sdlc'].includes(part)),
      'PATH',
      'Canonical artifacts cannot resolve into protected Git or framework metadata paths');
      locator = { role: input.role, kind: 'git', repositoryId,
        ...(artifactId === 'default' ? {} : { artifactId }),
        path: relative, planned: input.planned === true };
    }
    if (input.planned) {
      requireThat(!input.externalPath, 'INPUT', 'Only repository artifacts can be planned before creation');
      const checkpoint = await readJson(path.join(store.workPath(input.workItemId), 'checkpoint.json'), { limit: LIMITS.checkpoint });
      const duePhase = { requirements: 'requirements', 'test-plan': 'test-design', 'technical-design': 'technical-design' }[input.role];
      requireThat(['requirements', 'test-design', 'technical-design', 'coding'].indexOf(checkpoint.phase) >=
        ['requirements', 'test-design', 'technical-design', 'coding'].indexOf(duePhase),
      'PHASE', `${input.role} cannot be planned before ${duePhase}`);
      requireThat(!(await exists(resolved)), 'ARTIFACT', 'The planned artifact already exists; register its actual content instead');
      locator.digest = 'pending';
    } else {
      locator.digest = digest(await readBytes(resolved, LIMITS.artifact));
      if (locator.kind === 'git') locator.planned = false;
    }
    let externalMapping;
    if (input.externalPath) {
      const bindingDigest = digest({
        path: resolved,
        authorizationId: input.authorizationId,
      });
      locator.locatorId = `locator-${digest({
        role: input.role,
        repositoryId,
        artifactId,
        bindingDigest,
        contentDigest: locator.digest,
      }).slice(0, 48)}`;
      externalMapping = safeRecord({
        type: 'locator',
        id: locator.locatorId,
        workItemId: input.workItemId,
        repositoryId,
        ...(artifactId === 'default' ? {} : { artifactId }),
        path: resolved,
        digest: locator.digest,
        bindingDigest,
        authorizationId: input.authorizationId,
      });
    }
    let other;
    for (const artifact of manifest.artifacts.filter(item =>
      artifactIdentity(item, manifest) !== identity &&
      artifactRepositoryId(item, manifest) === repositoryId)) {
      if (sameNativePath(await artifactPath(store, input.workItemId,
        artifact, metadata), resolved)) {
        other = artifact;
        break;
      }
    }
    requireThat(!other, 'ARTIFACT', 'One file cannot serve two distinct artifact roles');
    const nextManifest = {
      ...manifest,
      artifacts: [...manifest.artifacts.filter(artifact =>
      artifactIdentity(artifact, manifest) !== identity), locator]
        .sort((left, right) => artifactOrder(left, right, manifest)),
      revision: manifest.revision + 1,
    };
    validateManifest(nextManifest);
    budget(nextManifest, LIMITS.checkpoint, 'Manifest');
    if (externalMapping) await writeJson(
      store.recordPath(input.workItemId, locator.locatorId), externalMapping);
    try {
      await fault('before-manifest');
      await writeJson(file, nextManifest);
      await fault('after-manifest');
    } catch (error) {
      if (externalMapping) {
        let persisted;
        try { persisted = await readJson(file, { optional: true }); }
        catch { persisted = null; }
        const wasReferenced = manifest.artifacts.some(artifact =>
          artifact.kind === 'external-file' &&
          artifact.locatorId === locator.locatorId);
        const isReferenced = persisted?.artifacts?.some(artifact =>
          artifact.kind === 'external-file' &&
          artifact.locatorId === locator.locatorId);
        if (persisted && !wasReferenced && !isReferenced) {
          await fs.rm(store.recordPath(input.workItemId, locator.locatorId),
            { force: true });
        }
      }
      throw error;
    }
    const activeLocatorIds = new Set(nextManifest.artifacts
      .filter(artifact => artifact.kind === 'external-file')
      .map(artifact => artifact.locatorId));
    const recordsDirectory = path.join(store.workPath(input.workItemId), 'records');
    for (const name of await listJson(recordsDirectory)) {
      if (!name.startsWith('locator-')) continue;
      const recordId = name.slice(0, -'.json'.length);
      if (activeLocatorIds.has(recordId)) continue;
      const recordFile = store.recordPath(input.workItemId, recordId);
      const record = await readJson(recordFile, { optional: true });
      if (record?.type === 'locator') await fs.rm(recordFile, { force: true });
    }
    return locator;
  });
}
export async function snapshots(store, workItemId, roles, { persist = false } = {}) {
  const { manifest, metadata } = await store.manifest(workItemId);
  const result = [];
  const requested = [...new Set(roles)];
  for (const role of requested) {
    requireThat(manifest.artifacts.some(locator => locator.role === role),
      'ARTIFACT', `Register the ${role} artifact before requesting approval`);
  }
  const locators = manifest.artifacts.filter(locator => requested.includes(locator.role))
    .sort((left, right) => artifactOrder(left, right, manifest));
  return snapshotLocators(store, workItemId, locators, manifest, metadata, { persist });
}
export async function snapshotLocators(store, workItemId, locators, manifest, metadata,
  { persist = false } = {}) {
  const result = [];
  for (const locator of locators) {
    const repositoryId = artifactRepositoryId(locator, manifest);
    requireThat(!locator.planned && locator.digest !== 'pending', 'ARTIFACT',
      `${locator.role} for ${repositoryId} is planned but its content is not registered`);
    const bytes = await readBytes(await artifactPath(store, workItemId, locator, metadata), LIMITS.artifact);
    const hash = digest(bytes);
    if (persist) {
      const file = path.join(store.workPath(workItemId), 'snapshots', hash);
      if (!(await exists(file))) await atomicWrite(file, bytes);
    }
    const snapshot = { role: locator.role,
      ...(artifactDocumentId(locator) === 'default' ? {} :
        { artifactId: artifactDocumentId(locator) }),
      locator: artifactLocator(locator, manifest), digest: hash };
    if (locator.kind === 'external-file') {
      const mapping = await readJson(store.recordPath(workItemId, locator.locatorId));
      snapshot.bindingDigest = mapping.bindingDigest ??
        digest({ path: mapping.path, authorizationId: mapping.authorizationId });
    }
    if (persist && locator.kind === 'git') {
      const member = metadata.members.find(member => member.repositoryId === locator.repositoryId);
      const commit = await git(member.root, ['rev-parse', '--verify', '-q', 'HEAD'], { optional: true });
      if (commit) {
        const blob = await git(member.root, ['rev-parse', '--verify', '-q', `${commit}:${locator.path}`], { optional: true });
        if (blob) {
          const content = await git(member.root, ['show', `${commit}:${locator.path}`], { trim: false });
          if (digest(content) === hash) snapshot.git = { repositoryId: member.repositoryId, commit, blob, path: locator.path };
        }
      }
    }
    result.push(snapshot);
  }
  return result;
}
export function testSpecificationDigest(contents) {
  if (typeof contents !== 'string') {
    return digest(contents.map(({ status, evidenceRef, activity, blockers, ...definition }) => definition)
      .sort((left, right) => left.id.localeCompare(right.id)));
  }
  if (contents.trimStart().startsWith('{')) {
    const document = JSON.parse(contents);
    requireThat(Array.isArray(document.tests), 'ARTIFACT', 'JSON Test Plan requires a tests array');
    const { tests, status, evidence, activity, blockers, results, runs, execution, ...specification } = document;
    return digest({ ...specification,
      tests: tests.map(({ status: testStatus, evidenceRef, activity: testActivity, blockers: testBlockers, ...definition }) => definition)
        .sort((left, right) => left.id.localeCompare(right.id)) });
  }
  const lines = contents.split('\n');
  let mutableColumns = [];
  return digest(lines.map(line => {
    if (!line.trim().startsWith('|')) return line;
    const cells = line.split('|');
    const normalized = cells.map(cell => cell.trim());
    if (normalized.some(cell => /^ID$/iu.test(cell)) && normalized.some(cell => /^Status$/iu.test(cell))) {
      mutableColumns = normalized.map((cell, index) =>
        /^(?:status|evidence|activity|blockers?|run(?:\s+id)?)$/iu.test(cell) ? index : -1).filter(index => index >= 0);
      return normalized.join('|');
    }
    if (/^T-[A-Za-z0-9._-]+$/u.test(
      (normalized[1] ?? '').replace(/`/gu, ''))) {
      for (const index of mutableColumns) normalized[index] = '<execution-metadata>';
    }
    return normalized.join('|');
  }).join('\n'));
}
export function parseRequirements(contents) {
  const requirements = [];
  const matches = [...contents.matchAll(/^#{2,6}\s+(FR-\d+)\s*[-–:].*$/gmu)];
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index];
    const section = contents.slice(match.index, matches[index + 1]?.index ?? contents.length);
    const conditions = [...new Set([...section.matchAll(/\bAC-\d+\.\d+\b/gu)].map(m => m[0]))];
    requirements.push({ id: match[1], dod: /\*\*Definition of Done\*\*[\s\S]*\S/u.test(section),
      conditions, outOfScope: /\bClassification:\s*out-of-scope\b/iu.test(section) });
  }
  return requirements;
}
export function parseTestPlan(contents) {
  if (contents.trimStart().startsWith('{')) {
    const parsed = JSON.parse(contents);
    requireThat(Array.isArray(parsed.tests), 'ARTIFACT', 'Test document must contain tests');
    return parsed.tests;
  }
  const tests = [];
  let headings = [];
  for (const line of contents.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim().replace(/`/gu, ''));
    if (cells.some(cell => /^ID$/iu.test(cell)) && cells.some(cell => /^Status$/iu.test(cell))) { headings = cells.map(c => c.toLowerCase()); continue; }
    if (!/^T-[A-Za-z0-9._-]+$/u.test(cells[0] ?? '')) continue;
    const fields = Object.fromEntries(headings.map((heading, index) => [heading, cells[index]]));
    const requirements = [...new Set([...line.matchAll(/\bFR-\d+\b/gu)].map(match => match[0]))];
    for (const range of line.matchAll(/\bFR-(\d+)\s*(?:to|-|through|\.\.)\s*FR-(\d+)\b/gu)) {
      const start = Number(range[1]), end = Number(range[2]);
      requireThat(end >= start && end - start < 1000, 'ARTIFACT', 'Invalid requirement range');
      for (let n = start; n <= end; n++) requirements.push(`FR-${String(n).padStart(3, '0')}`);
    }
    tests.push({ id: cells[0], requirements: [...new Set(requirements)],
      conditions: [...new Set([...line.matchAll(/\bAC-\d+\.\d+\b/gu)].map(match => match[0]))],
      environment: fields.environment ?? '', level: fields.level ?? '',
      checkpoint: fields.checkpoint ?? '',
      mode: fields.mode ?? '', status: fields.status, implementation: fields.implementation ?? '',
      owner: fields.owner ?? '', location: fields.location ?? '',
      expected: fields['expected outcome'] ?? fields['observe or assert'] ?? '', outOfScope: fields.classification === 'out-of-scope' });
  }
  return tests;
}
function canonicalTest(test) {
  const environment = test.environment === 'local' || /^local$/iu.test(test.environment) ? 'local' :
    /^dev$/iu.test(test.environment) ? 'DEV' : /^staging(?:\/staging)?$/iu.test(test.environment) ? 'STAGING' : test.environment;
  return {
    id: test.id,
    environment,
    level: typeof test.level === 'string' ? test.level.toLowerCase() : test.level,
    checkpoint: test.checkpoint || (environment === 'DEV' ? 'DEV' : environment === 'STAGING' ? 'STAGING' :
      String(test.level).toLowerCase() === 'review' ? 'review' :
        String(test.level).toLowerCase() === 'workflow' ? 'post-review' : 'pre-review'),
    mode: typeof test.mode === 'string' ? test.mode.toLowerCase() : test.mode,
    owner: typeof test.owner === 'string' ? test.owner.toLowerCase() : test.owner,
    location: test.location,
    implementation: test.implementation,
    expected: test.expected,
  };
}
async function testPlanDocuments(store, workItemId, manifest, metadata) {
  const locators = manifest.artifacts.filter(locator => locator.role === 'test-plan')
    .sort((left, right) => artifactOrder(left, right, manifest));
  const documents = [];
  for (const locator of locators) {
    requireThat(!locator.planned && locator.digest !== 'pending', 'ARTIFACT',
      `test-plan for ${artifactRepositoryId(locator, manifest)} is not materialized`);
    const file = await artifactPath(store, workItemId, locator, metadata);
    const contents = (await readBytes(file, LIMITS.artifact)).toString('utf8');
    let bindingDigest;
    if (locator.kind === 'external-file') {
      const mapping = await readJson(store.recordPath(workItemId, locator.locatorId));
      bindingDigest = mapping.bindingDigest ??
        digest({ path: mapping.path, authorizationId: mapping.authorizationId });
    }
    documents.push({
      locator,
      locatorKey: artifactLocator(locator, manifest),
      specificationKey: locator.kind === 'git' ?
        artifactLocator(locator, manifest) :
        `external:${artifactRepositoryId(locator, manifest)}:${artifactDocumentId(locator)}`,
      file,
      contents,
      tests: parseTestPlan(contents).filter(test => !test.outOfScope).map(canonicalTest),
      ...(bindingDigest ? { bindingDigest } : {}),
    });
  }
  return documents;
}
export async function resolveTestSpecification(store, workItemId, suppliedTests) {
  const { manifest, metadata } = await store.manifest(workItemId);
  const documents = await testPlanDocuments(store, workItemId, manifest, metadata);
  requireThat(documents.length > 0, 'ARTIFACT', 'Register the canonical Test Plan before validation');
  const planned = documents.flatMap(document => document.tests);
  requireThat(planned.length > 0, 'ARTIFACT', 'The canonical Test Plan contains no in-scope tests');
  requireThat(new Set(planned.map(test => test.id)).size === planned.length,
    'ARTIFACT', 'Test IDs must be globally unique across all registered Test Plans');
  const ordered = tests => [...tests].sort((left, right) => left.id.localeCompare(right.id));
  if (suppliedTests !== undefined) {
    requireThat(Array.isArray(suppliedTests) &&
      digest(ordered(suppliedTests.map(canonicalTest))) === digest(ordered(planned)),
      'ARTIFACT', 'Cycle tests must exactly match every in-scope canonical Test Plan definition');
  }
  const specificationDigest = documents.length === 1 ?
    digest({
      tests: testSpecificationDigest(planned),
      plan: testSpecificationDigest(documents[0].contents),
    }) :
    digest({
      plans: documents.map(document => ({
        locator: document.specificationKey,
        ...(document.bindingDigest ? { bindingDigest: document.bindingDigest } : {}),
        tests: testSpecificationDigest(document.tests),
        plan: testSpecificationDigest(document.contents),
      })),
    });
  return { tests: planned, digest: specificationDigest,
    plans: documents.map(document => ({
      locator: document.locatorKey,
      testIds: document.tests.map(test => test.id),
    })) };
}
export async function currentTestSpecification(store, workItemId, tests) {
  return (await resolveTestSpecification(store, workItemId, tests)).digest;
}
export async function synchronizeTestPlan(store, workItemId, transactionOptions = {}) {
  return store.transaction(workItemId, async tx => {
    const cycle = tx.get(tx.checkpoint.validationCycleRef);
    if (!cycle) return { synchronized: true, changed: false };
    const documents = await testPlanDocuments(store, workItemId, tx.manifest, tx.metadata);
    requireThat(documents.length > 0, 'ARTIFACT',
      'The Test Plan locator is unavailable; evidence remains pending synchronization');
    const statuses = new Map(cycle.tests.map(test =>
      [test.id, currentTestEvidence(cycle, tx.all(), test, store.clock)?.status ?? 'NotRun']));
    let changed = false;
    for (const definition of documents) {
      const original = definition.contents;
      const definedIds = new Set(parseTestPlan(original).map(test => test.id));
      let updated;
      if (original.trimStart().startsWith('{')) {
        const document = JSON.parse(original);
        for (const test of document.tests) if (statuses.has(test.id)) test.status = statuses.get(test.id);
        updated = `${JSON.stringify(document, null, 2)}\n`;
      } else {
        let statusColumn = -1;
        updated = original.split('\n').map(line => {
          if (!line.trimStart().startsWith('|')) return line;
          const cells = line.split('|');
          const header = cells.findIndex(cell => /^Status$/iu.test(cell.trim()));
          if (header > 0) statusColumn = header;
          const testId = cells[1]?.trim().replace(/`/gu, '');
          if (statusColumn > 0 && statuses.has(testId)) cells[statusColumn] = ` ${statuses.get(testId)} `;
          return cells.join('|');
        }).join('\n');
      }
      const synchronized = parseTestPlan(updated);
      requireThat([...definedIds].every(testId =>
        !statuses.has(testId) ||
        synchronized.some(test => test.id === testId &&
          test.status === statuses.get(testId))),
      'ARTIFACT_SYNC', 'Unable to update every current-cycle Test Plan status; durable result evidence is retained');
      if (updated !== original) {
        await atomicWrite(definition.file, updated);
        changed = true;
      }
    }
    cycle.pendingPlanSync = false;
    tx.put(cycle);
    return { synchronized: true, changed };
  }, transactionOptions);
}
export async function loadConfig(metadata, repositoryId) {
  const member = metadata.members.find(m => m.repositoryId === repositoryId);
  requireThat(member, 'BINDING', 'Unknown repository configuration');
  const config = await readJson(await safePath(member.root, '.sdlc/config.json'), { optional: true }) ?? {};
  object(config, ['schemaVersion', 'defaultBranch', 'commands', 'environments',
    'environmentMappings', 'toolAdapters', 'artifactLocations']);
  safeRecord(config, LIMITS.checkpoint);
  if (config.defaultBranch) requireThat(config.defaultBranch.startsWith('refs/heads/'), 'CONFIG', 'defaultBranch must be a full ref resolved from repository policy');
  for (const command of config.commands ?? []) {
    object(command, ['command', 'action', 'platforms', 'shell'], ['command', 'action']);
    text(command.command, 'configured command', 4096);
    if (command.platforms) {
      strings(command.platforms, 'configured command platforms');
      requireThat(command.platforms.length > 0 &&
        command.platforms.every(platform => HOST_PLATFORMS.includes(platform)),
      'CONFIG', 'Configured command platforms must be darwin, win32, or linux');
    }
    if (command.shell) choice(command.shell, SHELL_FAMILIES, 'configured command shell');
  }
  for (const [environment, policy] of Object.entries(config.environments ?? {})) {
    choice(environment, ['DEV', 'STAGING', 'PROD'], 'environment');
    object(policy, ['target', 'configDigest', 'buildPipeline',
      'deployPipeline', 'allowedStages', 'pr', 'tests', 'artifact',
      'execution'], ['target', 'configDigest']);
    text(policy.target, 'target'); text(policy.configDigest, 'configuration revision');
    strings(policy.allowedStages ?? [environment], 'allowed stages');
    if (policy.execution !== undefined) {
      requireThat(environment === 'STAGING', 'CONFIG',
        'Execution owner/location policy is supported only for STAGING');
      object(policy.execution, ['owner', 'locations'],
        ['owner', 'locations']);
      choice(policy.execution.owner, STAGING_OWNERS,
        'STAGING execution owner');
      strings(policy.execution.locations, 'STAGING execution locations');
      requireThat(policy.execution.locations.length > 0 &&
        new Set(policy.execution.locations).size ===
          policy.execution.locations.length,
      'CONFIG',
      'STAGING execution locations must be nonempty and unique');
    }
    if (environment === 'PROD' && (policy.pr?.required === false || policy.pr?.validation === false)) {
      config.detectedConflicts = [{ rule: 'configuration-prod-policy', environment: 'PROD',
        reason: 'Repository configuration disables required PROD PR validation; correct the configuration or capture explicit scoped overrides.' }];
    }
  }
  const mappingKeys = new Set();
  for (const mapping of config.environmentMappings ?? []) {
    object(mapping, ['provider', 'pipeline', 'label', 'environment', 'target',
      'configDigest'], ['provider', 'pipeline', 'label', 'environment', 'target',
      'configDigest']);
    for (const field of ['provider', 'pipeline', 'label', 'target',
      'configDigest']) {
      text(mapping[field], `environment mapping ${field}`);
    }
    choice(mapping.environment, ['DEV', 'STAGING', 'PROD'],
      'mapped environment');
    const key = [mapping.provider, mapping.pipeline, mapping.label,
      mapping.target, mapping.configDigest].join('\u0000');
    requireThat(!mappingKeys.has(key), 'CONFIG',
      'Environment mappings must have unique provider/pipeline/label/target/configuration scope');
    mappingKeys.add(key);
  }
  for (const adapter of config.toolAdapters ?? []) {
    object(adapter, ['toolName', 'match', 'action'], ['toolName', 'action']);
    text(adapter.toolName, 'tool name');
  }
  return config;
}
