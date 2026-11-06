import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { isPrerelease } from '../packaging/standalone/protocol.mjs';
import { sha256 } from '../packaging/standalone/archive.mjs';
import { ROOT, options, readJson, releaseIntent, releaseRepository, requirePublicationReady,
  trustedEnvironment, verifyBundle, writeJson } from './release-bundle.mjs';
import { workflowActionPins, readWorkflowPolicySources, validateWorkflowPolicy } from './workflow-policy.mjs';
import { releaseEvidenceName } from './release-retention.mjs';

export const RELEASE_ACTION_PINS = workflowActionPins;

export function validateReleaseActions(workflows) {
  if (!Array.isArray(workflows)) throw new Error('Validate the complete adopted workflow/action/callee permission graph');
  return validateWorkflowPolicy(workflows);
}

async function requireSavedFrozenIntent(api, prefix, { releaseIntentId, sourceCommit, environment }) {
    if (environment.SAVED_BUNDLE_ARTIFACT_ID || environment.SAVED_CANDIDATE_ARTIFACT_ID) return;
    const artifacts = [];
    for (let page = 1; ; page++) {
      const response = await requireValue(api, `${prefix}/actions/artifacts?per_page=100&page=${page}`);
      if (!Array.isArray(response.artifacts)) throw new Error('Original release-artifact history is unavailable; do not guess that repacking is safe');
      artifacts.push(...response.artifacts);
      if (artifacts.length >= response.total_count) break;
      if (!response.artifacts.length || artifacts.length >= 5000) throw new Error('Release-artifact history is incomplete; select an exact saved candidate instead');
    }
    for (const artifact of artifacts.filter(item => !item.expired &&
      /^release-preflight-[1-9]\d*-[1-9]\d*$/u.test(item.name) &&
      item.workflow_run?.head_sha === sourceCommit)) {
      const runId = String(artifact.workflow_run.id);
      if (!artifacts.some(item => !item.expired && item.name.startsWith(`release-candidate-${runId}-`))) continue;
      const run = await requireValue(api, `${prefix}/actions/runs/${runId}`);
      if (run.path !== '.github/workflows/release.yml' || run.event !== 'workflow_dispatch' || run.head_sha !== sourceCommit) continue;
      const bytes = await requireValue(api, `${prefix}/actions/artifacts/${artifact.id}/zip`, { binary: true });
      if (bytes.length > 4 * 1024 * 1024) throw new Error('Oversized original release preflight artifact');
      const original = JSON.parse(execFileSync('python3', ['-I', '-c',
        'import io,json,stat,sys,zipfile\n' +
        'if sys.version_info[:3]!=(3,12,10): raise RuntimeError("Pinned history-reader Python 3.12.10 is required")\n' +
        'with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read(4194305))) as archive:\n' +
        ' rows=archive.infolist()\n' +
        ' if len(rows)!=1 or rows[0].filename!="release-preflight.json" or rows[0].file_size>262144 or rows[0].is_dir() or stat.S_ISLNK(rows[0].external_attr>>16): raise RuntimeError("Unexpected bounded preflight artifact inventory")\n' +
        ' sys.stdout.buffer.write(archive.read(rows[0]))'],
      { input: bytes, maxBuffer: 262_144, timeout: 30_000, cwd: ROOT }));
      if (original.status === 'Passed' && original.releaseIntentId === releaseIntentId &&
          original.sourceCommit === sourceCommit) {
        throw new Error(`Intent already froze candidate bytes in run ${runId}; select those saved artifact IDs instead of rebuilding`);
      }
    }
}

export async function boundedReadback(check, { timeoutMs = 600_000, now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), observe = () => {} } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 600_000) throw new Error('Readback budget must be at most ten minutes');
  const deadline = now() + timeoutMs;
  let attempt = 0;
  while (true) {
    const result = await check();
    observe({ attempt: ++attempt, available: result !== null, remainingMs: Math.max(0, deadline - now()) });
    if (result !== null) return result;
    const remaining = deadline - now();
    if (remaining <= 0) throw Object.assign(new Error('Exact publication readback is incomplete after the bounded propagation window'),
      { code: 'PUBLICATION_UNCERTAIN' });
    await sleep(Math.min(remaining, [1000, 2000, 4000, 8000, 16000][attempt - 1] ?? 30000));
  }
}

export async function preflightRelease({ sourceCommit, version, repository, releaseIntentId,
  outputFile, environment = process.env }, api = githubRequest, readRegistry = registryPackage) {
  repository = releaseRepository(repository);
  releaseIntentId = releaseIntent(releaseIntentId);
  if (environment.GITHUB_EVENT_NAME !== 'workflow_dispatch' || environment.GITHUB_REF !== 'refs/heads/main' ||
      environment.GITHUB_REPOSITORY !== 'urmich/ai-sdlc-framework' ||
      sourceCommit !== environment.GITHUB_SHA || !/^[a-f0-9]{40}$/u.test(sourceCommit ?? '') ||
      environment.RELEASE_REPOSITORY !== repository ||
      environment.GITHUB_WORKFLOW_REF !== `${environment.GITHUB_REPOSITORY}/.github/workflows/release.yml@refs/heads/main`) {
    throw new Error('Release start requires the explicit exact protected-main source, destination and actual release.yml maintainer dispatch');
  }
  if (!/^[1-9]\d*$/u.test(environment.GITHUB_RUN_ID ?? '') ||
      !/^[1-9]\d*$/u.test(environment.GITHUB_RUN_ATTEMPT ?? '') ||
      (await readJson(path.join(ROOT, 'package.json'))).version !== version) {
    throw new Error('Release version/run inputs differ from the selected source');
  }
  if (Number(environment.GITHUB_RUN_ATTEMPT) > 1 &&
      !environment.SAVED_BUNDLE_ARTIFACT_ID && !environment.SAVED_CANDIDATE_ARTIFACT_ID) {
    throw new Error('A new physical attempt must select the original saved candidate or sealed bundle; rebuilding is forbidden');
  }
  validateReleaseActions(await readWorkflowPolicySources(ROOT));
  if (environment.NPM_TRUSTED_PUBLISHER_REPOSITORY !== 'urmich/ai-sdlc-framework' ||
      environment.NPM_TRUSTED_PUBLISHER_CALLER !== 'release.yml' ||
      environment.NPM_TRUSTED_PUBLISHER_ENVIRONMENT !== 'npm') {
    throw new Error('Configure the exact npm trusted publisher repository/release.yml/npm prerequisite; no token fallback is permitted');
  }
  const previous = { version: environment.SUPPORTED_PREVIOUS_VERSION,
    descriptorSha256: environment.SUPPORTED_PREVIOUS_DESCRIPTOR_SHA256,
    checksumsSha256: environment.SUPPORTED_PREVIOUS_CHECKSUMS_SHA256 };
  if (!/^\d+\.\d+\.\d+$/u.test(previous.version ?? '') || previous.version === version ||
      !/^[a-f0-9]{64}$/u.test(previous.descriptorSha256 ?? '') ||
      !/^[a-f0-9]{64}$/u.test(previous.checksumsSha256 ?? '')) {
    throw new Error('Authentic supported previous public release version/descriptor/checksum pins are required for real native upgrades');
  }
  const priorParts = previous.version.split('.').map(Number);
  const nextParts = version.split(/[+-]/u)[0].split('.').map(Number);
  const firstDifference = priorParts.findIndex((part, index) => part !== nextParts[index]);
  if (![...priorParts, ...nextParts].every(Number.isSafeInteger) || firstDifference < 0 ||
      priorParts[firstDifference] >= nextParts[firstDifference]) throw new Error('The supported previous public version must precede this exact candidate');
  const prefix = `/repos/${environment.GITHUB_REPOSITORY}`;
  const source = await requireValue(api, prefix);
  const destination = repository === environment.GITHUB_REPOSITORY ? source : await requireValue(api, `/repos/${repository}`);
  if (source.private !== false || destination.private !== false) throw new Error('Publication requires explicitly selected public source and destination repositories');
  const permission = await requireValue(api, `${prefix}/collaborators/${encodeURIComponent(environment.GITHUB_ACTOR)}/permission`);
  if (!['admin', 'maintain'].includes(permission.permission)) throw new Error('Only an authorized maintainer may start this release intent');
  const main = await requireValue(api, `${prefix}/branches/main`);
  if (main.protected !== true || main.commit?.sha !== sourceCommit) throw new Error('Source must be the current accepted protected-main candidate');
  const protection = await requireValue(api, `${prefix}/branches/main/protection`);
  const contexts = protection.required_status_checks?.contexts ??
    protection.required_status_checks?.checks?.map(check => check.context) ?? [];
  if (protection.required_status_checks?.strict !== true ||
      !['framework/validation', 'framework/approval', 'framework/coverage'].every(context => contexts.includes(context)) ||
      !protection.required_pull_request_reviews || protection.required_conversation_resolution?.enabled !== true ||
      protection.enforce_admins?.enabled !== true || protection.allow_force_pushes?.enabled !== false ||
      protection.allow_deletions?.enabled !== false) {
    throw new Error('Effective protected-main merge/review/check/conversation/bypass settings do not match the adopted release policy');
  }
  const statuses = await requireValue(api, `${prefix}/commits/${sourceCommit}/status`);
  const requiredContexts = ['framework/validation', 'framework/approval', 'framework/coverage'];
  let sourceAcceptance = { kind: 'exact-source-statuses', revision: sourceCommit };
  if (requiredContexts.some(context => statuses.statuses?.some(status => status.context === context && status.state !== 'success'))) {
    throw new Error('A required current source status is non-passing');
  }
  if (!requiredContexts.every(context => statuses.statuses?.some(status => status.context === context && status.state === 'success'))) {
    const merged = [];
    for (let page = 1; ; page++) {
      const pulls = await requireValue(api, `${prefix}/commits/${sourceCommit}/pulls?per_page=100&page=${page}`);
      if (!Array.isArray(pulls)) throw new Error('Accepted protected-main PR/source facts are unavailable');
      merged.push(...pulls.filter(pr => pr.merged_at && pr.base?.ref === 'main' && pr.merge_commit_sha === sourceCommit));
      if (pulls.length < 100) break;
    }
    if (merged.length !== 1 || !/^[a-f0-9]{40}$/u.test(merged[0].head?.sha ?? '')) {
      throw new Error('Source needs passing exact-source checks or its one accepted protected-main merge record');
    }
    const accepted = await requireValue(api, `${prefix}/commits/${merged[0].head.sha}/status`);
    if (!requiredContexts.every(context => accepted.statuses?.some(status => status.context === context && status.state === 'success'))) {
      throw new Error('Accepted merge lacks its required validation/approval/coverage checks');
    }
    sourceAcceptance = { kind: 'accepted-protected-main-merge', revision: sourceCommit,
      pullRequest: merged[0].number, acceptedHead: merged[0].head.sha,
      releaseNativeCredit: 'NotRun-fresh-R-PRE-required' };
  }
  const npmEnvironment = await requireValue(api, `${prefix}/environments/npm`);
  if (!Array.isArray(npmEnvironment.protection_rules)) throw new Error('Effective npm environment protection facts are unavailable');
  if (npmEnvironment.protection_rules?.some(rule => rule.type === 'required_reviewers' && rule.reviewers?.length ||
      rule.type === 'wait_timer' && rule.wait_timer > 0)) {
    throw new Error('The npm environment currently requires additional intervention; resolve policy incompatibility explicitly, never auto-approve or disable it');
  }
  if (npmEnvironment.deployment_branch_policy?.custom_branch_policies) {
    const policies = [];
    for (let page = 1; ; page++) {
      const policy = await requireValue(api, `${prefix}/environments/npm/deployment-branch-policies?per_page=100&page=${page}`);
      if (!Array.isArray(policy.branch_policies)) throw new Error('Effective npm environment branch rules are unavailable');
      policies.push(...policy.branch_policies);
      if (policies.length >= policy.total_count) break;
      if (!policy.branch_policies.length) throw new Error('Incomplete npm environment branch-policy pagination');
    }
    if (!policies.some(policy => (policy.type === undefined || policy.type === 'branch') &&
        ['main', '*'].includes(policy.name))) throw new Error('The npm environment does not explicitly admit this protected-main caller; do not bypass deployment policy');
  }
  await requireSavedFrozenIntent(api, prefix, { releaseIntentId, sourceCommit, environment });
  const existingNpm = await readRegistry('ai-sdlc-framework', version);
  const existingTag = await api(`/repos/${repository}/git/ref/tags/${encodeURIComponent(`v${version}`)}`);
  if ((existingNpm || existingTag.status !== 404) &&
      !environment.SAVED_BUNDLE_ARTIFACT_ID && !environment.SAVED_CANDIDATE_ARTIFACT_ID) {
    throw new Error('Existing immutable publication requires its original saved bundle or frozen candidate artifact ID; reconcile instead of repacking');
  }
  const result = { schemaVersion: 1, status: 'Passed', releaseIntentId, sourceCommit, version, repository,
    actorPermission: permission.permission, sourceAcceptance, previous, trustedPublisherConfiguration: 'ExplicitlyConfigured',
    trustedPublisherAuthentication: 'NotRun', run: { id: environment.GITHUB_RUN_ID, attempt: environment.GITHUB_RUN_ATTEMPT },
    validationMode: environment.SAVED_BUNDLE_ARTIFACT_ID ? 'reuse-r-pre' :
      environment.SAVED_CANDIDATE_ARTIFACT_ID ? 'fresh-saved-candidate' : 'fresh-new-candidate',
    existing: { npm: Boolean(existingNpm), tag: existingTag.status !== 404 }, irreversibleEffects: 'NotRun' };
  if (outputFile) await writeJson(outputFile, result);
  return result;
}

export async function githubRequest(route, { method = 'GET', body, bytes, binary = false } = {}) {
  const upload = route.startsWith('/uploads/');
  const url = upload ? `https://uploads.github.com/${route.slice('/uploads/'.length)}` : `https://api.github.com${route}`;
  if (!process.env.GH_TOKEN) throw new Error('An approved GitHub release token is required');
  const response = await fetch(url, {
    method, signal: AbortSignal.timeout(30_000), headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`,
      Accept: binary ? 'application/octet-stream' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(bytes ? { 'Content-Type': 'application/octet-stream' } : {}) },
    body: bytes ?? (body ? JSON.stringify(body) : undefined),
  });
  if (response.status === 404) return { status: 404 };
  if (!response.ok) throw new Error(`GitHub request failed (${response.status}): ${method} ${route}`);
  return { status: response.status, value: binary ? Buffer.from(await response.arrayBuffer()) : await response.json() };
}

async function requireValue(api, route, options) {
  const response = await api(route, options);
  if (response.status === 404) throw new Error(`Required GitHub resource is missing: ${route}`);
  return response.value;
}

async function findDraftRelease(api, prefix, tag) {
  const matches = [];
  for (let page = 1; ; page++) {
    const releases = await requireValue(api, `${prefix}/releases?per_page=100&page=${page}`);
    matches.push(...releases.filter(release => release.draft && release.tag_name === tag));
    if (releases.length < 100) break;
  }
  if (matches.length > 1) throw new Error(`Multiple draft releases match ${tag}; refusing ambiguous resume`);
  return matches[0];
}

export async function publishDraft({ directory, repository, outputFile, ...expected }, api = githubRequest) {
  const bundle = await verifyBundle({ directory, ...expected });
  requirePublicationReady(bundle);
  const result = { status: 'NotRun', identity: bundle.identity, releaseIntentId: bundle.releaseIntentId, observations: [] };
  let journal;
  if (outputFile) {
    await fs.mkdir(path.dirname(outputFile), { recursive: true });
    journal = await fs.open(`${outputFile}.journal.jsonl`, 'wx');
  }
  try {
    Object.assign(result, await publishApprovedDraft({ directory, repository, bundle, onProgress: async observation => {
      const record = { ...observation, observedAt: new Date().toISOString() };
      result.observations.push(record);
      if (journal) { await journal.write(`${JSON.stringify(record)}\n`); await journal.sync(); }
    } }, api));
    return result;
  } catch (error) {
    result.status = 'PartialOrUncertain';
    result.reason = error.message;
    throw error;
  } finally {
    if (journal) await journal.close();
    if (outputFile) await writeJson(outputFile, result);
  }
}

export async function publishApprovedDraft({ directory, repository, bundle, onProgress = async () => {} }, api = githubRequest) {
  requirePublicationReady(bundle);
  repository = releaseRepository(repository);
  if (repository !== bundle.releaseRepository) throw new Error('Publication repository differs from the frozen metadata');
  const prefix = `/repos/${repository}`;
  const repo = await requireValue(api, prefix);
  if (repo.private !== false) throw new Error('Release assets require an approved public repository');
  const tag = `v${bundle.identity.version}`;
  const tagRoute = `${prefix}/git/ref/tags/${encodeURIComponent(tag)}`;
  let tagResponse = await api(tagRoute);
  const missingTag = tagResponse.status === 404;
  let ref = missingTag ? { type: 'commit', sha: bundle.identity.sourceCommit } : tagResponse.value.object;
  for (let depth = 0; ref.type === 'tag' && depth < 5; depth++) {
    ref = (await requireValue(api, `${prefix}/git/tags/${ref.sha}`)).object;
  }
  if (ref.type !== 'commit' || ref.sha !== bundle.identity.sourceCommit) {
    throw new Error('Release tag must resolve to the exact validated source commit; tags are never moved');
  }
  await onProgress({ stage: missingTag ? 'TagAbsenceReconciled' : 'TagVerified', tag, sourceCommit: ref.sha });
  let release = (await api(`${prefix}/releases/tags/${encodeURIComponent(tag)}`)).value;
  if (!release) release = await findDraftRelease(api, prefix, tag);
  if (!release) {
    let failure;
    await onProgress({ stage: 'DraftDispatching', tag });
    try { release = await requireValue(api, `${prefix}/releases`, { method: 'POST', body: {
      tag_name: tag, target_commitish: bundle.identity.sourceCommit, name: tag, draft: true, prerelease: isPrerelease(bundle.identity.version),
      body: `Validated immutable candidate for ${tag}.\n\n` +
        `Source: ${bundle.identity.sourceCommit}\nDescriptor SHA-256: ${bundle.identity.descriptorSha256}\n` +
        `SHA256SUMS SHA-256: ${bundle.identity.checksumsSha256}\n\n` +
        `Release intent: ${bundle.releaseIntentId}\n\n` +
        'All four native R-PRE lanes validated the frozen bytes. Linux is a development host, not a standalone release target. ' +
        'Public npm/GitHub readback, provenance and three native R-POST consumers determine completion; community/corporate availability remains separate.',
    } }); } catch (error) { failure = error; }
    if (!release) release = (await api(`${prefix}/releases/tags/${encodeURIComponent(tag)}`)).value ??
      await findDraftRelease(api, prefix, tag);
    if (!release) throw Object.assign(new Error('Draft creation outcome requires reconciliation; no blind retry'),
      { code: 'PUBLICATION_UNCERTAIN', cause: failure });
  }
  if (release.tag_name !== tag || release.prerelease !== isPrerelease(bundle.identity.version)) {
    throw new Error('Only the matching immutable release may be resumed');
  }
  await onProgress({ stage: release.draft ? 'DraftIdentified' : 'PublicReleaseIdentified', releaseId: release.id, tag });
  const records = bundle.files.filter(file => file.filename.startsWith('assets/'))
    .map(file => ({ ...file, name: file.filename.slice('assets/'.length) }));
  const existing = [];
  for (let page = 1; ; page++) {
    const items = await requireValue(api, `${prefix}/releases/${release.id}/assets?per_page=100&page=${page}`);
    existing.push(...items);
    if (items.length < 100) break;
  }
  if (new Set(existing.map(item => item.name)).size !== existing.length ||
      existing.some(item => !records.some(record => record.name === item.name) &&
        !releaseEvidenceName(item.name))) {
    throw new Error('Draft has duplicate or unexpected assets; never delete or overwrite them automatically');
  }
  const compare = async (asset, record) => {
    if (asset.size !== record.size || asset.state !== 'uploaded') throw new Error(`Existing asset conflicts: ${record.name}`);
    const bytes = await requireValue(api, `${prefix}/releases/assets/${asset.id}`, { binary: true });
    if (sha256(bytes) !== record.sha256) throw new Error(`Existing asset conflicts: ${record.name}`);
    await onProgress({ stage: 'AssetVerified', releaseId: release.id, assetId: asset.id,
      filename: record.name, sha256: record.sha256 });
  };
  // Verify all existing assets before uploading anything, making retries safe after partial failure.
  for (const asset of existing.filter(item => records.some(record => record.name === item.name))) {
    await compare(asset, records.find(record => record.name === asset.name));
  }
  if (missingTag) {
    tagResponse = await api(tagRoute);
    let failure;
    if (tagResponse.status === 404) {
      try {
        await onProgress({ stage: 'TagDispatching', tag, sourceCommit: bundle.identity.sourceCommit });
        await requireValue(api, `${prefix}/git/refs`, { method: 'POST',
          body: { ref: `refs/tags/${tag}`, sha: bundle.identity.sourceCommit } });
      } catch (error) { failure = error; }
      tagResponse = await api(tagRoute);
    }
    if (tagResponse.status === 404) throw Object.assign(new Error('Tag creation outcome requires reconciliation; no blind retry'),
      { code: 'PUBLICATION_UNCERTAIN', cause: failure });
    let current = tagResponse.value.object;
    for (let depth = 0; current.type === 'tag' && depth < 5; depth++) current =
      (await requireValue(api, `${prefix}/git/tags/${current.sha}`)).object;
    if (current.type !== 'commit' || current.sha !== bundle.identity.sourceCommit) throw new Error('Tag changed during reconciliation; never move it');
    await onProgress({ stage: 'TagVerified', tag, sourceCommit: current.sha });
  }
  for (const record of records) {
    if (existing.some(asset => asset.name === record.name)) continue;
    if (!release.draft) throw new Error('Published immutable release is missing an approved asset; never repair it by overwriting or repacking');
    const bytes = await fs.readFile(path.join(directory, record.filename));
    let uploaded;
    let failure;
    await onProgress({ stage: 'AssetDispatching', releaseId: release.id, filename: record.name, sha256: record.sha256 });
    try { uploaded = await requireValue(api,
      `/uploads/repos/${repository}/releases/${release.id}/assets?name=${encodeURIComponent(record.name)}`,
      { method: 'POST', bytes }); } catch (error) { failure = error; }
    if (!uploaded) {
      const listed = await requireValue(api, `${prefix}/releases/${release.id}/assets?per_page=100&page=1`);
      uploaded = listed.find(asset => asset.name === record.name);
    }
    if (!uploaded) throw Object.assign(new Error(`Asset upload outcome requires reconciliation: ${record.name}`),
      { code: 'PUBLICATION_UNCERTAIN', cause: failure });
    await compare(uploaded, record);
  }
  return { status: release.draft ? 'DraftAssetsVerified' : 'PublicAssetsVerified', releaseId: release.id,
    releaseIntentId: bundle.releaseIntentId, tag, assets: records.length,
    publicAvailability: 'NotRun', communityAcceptance: 'NotRun' };
}

export async function promoteRelease({ directory, repository, outputFile, readRegistry = registryPackage,
  verifyPayload = verifyRegistryPayload, readbackOptions, ...expected }, api = githubRequest) {
  const result = { schemaVersion: 1, github: { status: 'NotRun' }, npm: { status: 'NotRun' }, completion: 'NotRun' };
  try {
    const bundle = await verifyBundle({ directory, ...expected });
    requirePublicationReady(bundle);
    Object.assign(result, { identity: bundle.identity, releaseIntentId: bundle.releaseIntentId });
    const metadata = await boundedReadback(() => readRegistry(bundle.descriptor.name, bundle.identity.version), readbackOptions);
    await verifyPayload(metadata, { name: bundle.descriptor.name, version: bundle.identity.version, sha256: bundle.identity.payloadSha256 });
    if (!metadata.dist?.attestations?.url) throw new Error('Required npm provenance metadata is absent; GitHub promotion cannot proceed');
    result.npm = { status: 'PublishedBytesVerified', payloadSha256: bundle.identity.payloadSha256,
      cryptographicSignatureVerification: 'NotRun' };
    result.github = await publishApprovedDraft({ directory, repository, bundle }, api);
    if (result.github.status === 'DraftAssetsVerified') {
      try { await requireValue(api, `/repos/${repository}/releases/${result.github.releaseId}`,
        { method: 'PATCH', body: { draft: false } }); }
      catch (error) { result.github.promotion = 'Uncertain'; result.github.reason = error.message; }
    }

    const release = await boundedReadback(async () => {
      const response = await api(`/repos/${repository}/releases/tags/${encodeURIComponent(`v${bundle.identity.version}`)}`);
      return response.status === 404 || response.value.draft ? null : response.value;
    }, readbackOptions);
    if (release.id !== result.github.releaseId) throw new Error('Published GitHub release identity changed');
    result.github = { ...result.github, status: 'Published', publicAvailability: 'PendingNativeReadback' };
    return result;
  } catch (error) {
    result.reason = error.message;
    throw error;
  } finally {
    if (outputFile) await writeJson(outputFile, result);
  }
}

export async function publishEvidence({ directory, repository, artifact, outputFile, ...expected }, api = githubRequest) {
  const bundle = await verifyBundle({ directory, ...expected });
  requirePublicationReady(bundle);
  if (releaseRepository(repository) !== bundle.releaseRepository) throw new Error('Evidence destination differs from the frozen release');
  const name = path.basename(artifact);
  const match = releaseEvidenceName(name);
  const stat = await fs.lstat(artifact);
  if (!match || !stat.isFile() || stat.isSymbolicLink()) throw new Error('Only separately named regular digest-bound release evidence may be appended');
  const bytes = await fs.readFile(artifact);
  if (sha256(bytes) !== match[1]) throw new Error('Evidence asset filename does not bind its exact digest');
  const prefix = `/repos/${repository}`;
  const release = (await api(`${prefix}/releases/tags/v${bundle.identity.version}`)).value ??
    await findDraftRelease(api, prefix, `v${bundle.identity.version}`);
  if (!release) throw new Error('Evidence requires the existing exact saved release ID');
  const assets = [];
  for (let page = 1; ; page++) {
    const listed = await requireValue(api, `${prefix}/releases/${release.id}/assets?per_page=100&page=${page}`);
    assets.push(...listed);
    if (listed.length < 100) break;
  }
  const matches = assets.filter(asset => asset.name === name);
  if (matches.length > 1) throw new Error('Duplicate evidence asset; refusing ambiguous reconciliation');
  let asset = matches[0];
  if (!asset) {
    try { asset = await requireValue(api, `/uploads/repos/${repository}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,
      { method: 'POST', bytes }); }
    catch (error) {
      throw Object.assign(new Error(`Evidence upload outcome is uncertain; reconcile saved release ${release.id} and asset ${name} before retry`),
        { code: 'PUBLICATION_UNCERTAIN', cause: error });
    }
  }
  const downloaded = await requireValue(api, `${prefix}/releases/assets/${asset.id}`, { binary: true });
  if (asset.size !== bytes.length || asset.state !== 'uploaded' || sha256(downloaded) !== match[1]) {
    throw new Error('Existing evidence asset conflicts; it is never overwritten');
  }
  const result = { status: 'UploadedAndReadBack', releaseId: release.id, assetId: asset.id, filename: name,
    sha256: match[1], releaseIntentId: bundle.releaseIntentId, sourceCommit: bundle.identity.sourceCommit };
  if (outputFile) await writeJson(outputFile, result);
  return result;
}

export async function registryPackage(name, version, fetcher = fetch) {
  const response = await fetcher(`https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
    { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Anonymous npm registry query failed: ${response.status}`);
  return response.json();
}

export async function verifyRegistryPayload(metadata, { name, version, sha256: expectedSha256 }, fetcher = fetch) {
  const url = new URL(metadata.dist?.tarball);
  if (metadata.name !== name || metadata.version !== version || url.protocol !== 'https:' ||
      url.hostname !== 'registry.npmjs.org' || url.username || url.password || url.search || url.hash) {
    throw new Error('Unexpected anonymous npm package identity or tarball URL');
  }
  const response = await fetcher(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Anonymous npm payload download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  if (sha256(bytes) !== expectedSha256 || metadata.dist.integrity !== integrity) {
    throw new Error('Published npm bytes differ from the immutable release payload');
  }
  return bytes;
}

async function main() {
  if (process.argv[2] === 'npm') throw new Error('npm publication runs only in the protected data-only npm-publish.yml workflow called by release.yml');
  const command = { preflight: preflightRelease, draft: publishDraft, promote: promoteRelease, evidence: publishEvidence }[process.argv[2]];
  if (!command) throw new Error('Expected preflight, draft or promote');
  if (process.argv[2] !== 'preflight' && !process.env.EXPECTED_BUNDLE_SHA256) throw new Error('Publication requires the trusted immutable bundle digest');
  const input = { ...options(process.argv.slice(3)), ...trustedEnvironment() };
  let result;
  try { result = await command(input); }
  catch (error) {
    if (process.argv[2] === 'preflight' && input.outputFile) await writeJson(input.outputFile, {
      schemaVersion: 1, status: 'NotRun', diagnosticStatus: 'Blocked', reason: error.message,
      sourceCommit: input.sourceCommit, releaseIntentId: input.releaseIntentId, irreversibleEffects: 'NotRun',
    });
    throw error;
  }
  if (process.env.GITHUB_OUTPUT && result.releaseId) await fs.appendFile(process.env.GITHUB_OUTPUT, `release_id=${result.releaseId}\n`);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.stack ?? error.message); process.exitCode = 1; });
}
