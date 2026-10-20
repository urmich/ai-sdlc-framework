import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { canonical, sha256 } from '../packaging/standalone/archive.mjs';
import { verifyPlatformPackage } from './verify-platform-package.mjs';
import { buildPackage } from './package.mjs';
import { buildPlatforms, renderChecksums } from './package-platforms.mjs';
import { verifyHomebrewQuality } from './homebrew-quality.mjs';
import { nativeToolchain, homebrewToolchain } from './toolchain-baseline.mjs';
import { ROOT, MACOS_ARCHITECTURES, RELEASE_GATE_TARGETS, RELEASE_PRE_CASES, RELEASE_SCOPE, archiveRecord, copyNativeReports, homebrewMetadata, options, releaseIntent,
  readJson, trustedEnvironment, validateHomebrewQualityEvidence, validateInitialHomebrewFormula, verifyCandidate, writeJson } from './release-bundle.mjs';

function integrationBlocked(message) {
  return Object.assign(new Error(message), { code: 'RELEASE_INTEGRATION_BLOCKED',
    homebrewResult: { nativeValidation: 'NotRun', reason: message } });
}

export function validateNativeHomebrewEvidence(result, { candidate, targetArch,
  mode = 'candidate', expectedNodeVersion = nativeToolchain.node }) {
  const evidence = result?.evidence;
  const previous = candidate.context.previousRelease;
  if (!['arm64', 'x64'].includes(targetArch) || result?.nativeValidation !== 'Passed' ||
      evidence?.passed !== true || evidence.platform !== 'darwin' || evidence.architecture !== targetArch ||
      evidence.uname !== (targetArch === 'arm64' ? 'arm64' : 'x86_64') ||
      [true, 1, '1'].includes(evidence.sysctlProcTranslated) ||
      (targetArch === 'arm64' && evidence.sysctlProcTranslated !== '0') ||
      (targetArch === 'x64' && !['0', 'unavailable on native Intel'].includes(evidence.sysctlProcTranslated)) ||
      evidence.homebrewNodeVersion !== expectedNodeVersion ||
      canonical(evidence.homebrewRuntime) !== canonical({ platform: 'darwin', arch: targetArch, major: homebrewToolchain.major }) ||
      !previous || evidence.upgradeKind !== 'version' ||
      evidence.previousIdentity?.version !== previous.version ||
      evidence.previousIdentity?.descriptorSha256 !== previous.descriptorSha256 ||
      evidence.previousIdentity?.checksumsSha256 !== previous.checksumsSha256 ||
      canonical(evidence.currentIdentity) !== canonical(candidate.context.identity) ||
      evidence.previousIdentity.version === evidence.currentIdentity.version ||
      evidence.cleanupError || !evidence.failedPromotionRetry?.passed ||
      evidence.failedPromotionRetry.priorKeg === evidence.failedPromotionRetry.candidateKeg) {
    throw new Error('Missing actual native Homebrew lifecycle, upgrade/rollback, retained Node or cleanup proof');
  }
  const previousDescriptor = result.previousMetadata?.descriptor;
  const previousChecksums = result.previousMetadata?.checksums;
  if (!previousDescriptor || typeof previousChecksums !== 'string' ||
      sha256(Buffer.from(canonical(previousDescriptor))) !== previous.descriptorSha256 ||
      sha256(Buffer.from(previousChecksums)) !== previous.checksumsSha256 ||
      renderChecksums(previousDescriptor, Buffer.from(canonical(previousDescriptor))) !== previousChecksums ||
      previousDescriptor.version !== evidence.previousIdentity.version ||
      previousDescriptor.sourceCommit !== evidence.previousIdentity.sourceCommit ||
      previousDescriptor.payload?.sha256 !== evidence.previousIdentity.payloadSha256) {
    throw new Error('Original supported-previous identity is not bound to its independently pinned public descriptor/checksums');
  }
  const formula = result.formula;
  if (!formula || typeof formula.contents !== 'string' ||
      sha256(Buffer.from(formula.contents)) !== result.quality?.formula?.sha256) {
    throw new Error('Native Homebrew requires the original exact candidate formula source');
  }
  validateInitialHomebrewFormula({ descriptor: candidate.descriptor, repository: candidate.context.releaseRepository,
    contents: formula.contents, candidateBaseUrl: formula.candidateBaseUrl, mode });
  const formulaRecord = { filename: 'ai-sdlc-framework.rb', kind: 'homebrew',
    sha256: sha256(Buffer.from(formula.contents)), size: Buffer.byteLength(formula.contents) };
  validateHomebrewQualityEvidence(result.quality, { identity: candidate.context.identity,
    targetArch, formula: formulaRecord, mode });
  const archive = archiveRecord(candidate, `macos-${targetArch}`);
  if (!evidence.archiveInputs?.some(record => record.filename === archive.filename &&
      record.sha256 === archive.sha256 && record.size === archive.size)) throw new Error('Native Homebrew did not consume the exact frozen Mac archive');
  const previousArchive = archiveRecord({ descriptor: previousDescriptor }, `macos-${targetArch}`);
  if (!evidence.archiveInputs.some(record => record.filename === previousArchive.filename &&
      record.sha256 === previousArchive.sha256 && record.size === previousArchive.size)) {
    throw new Error('Native upgrade did not install the authentic supported-previous Mac archive');
  }
  const commands = evidence.commands;
  if (!Array.isArray(commands)) throw new Error('Original native Homebrew commands are missing');
  for (const name of ['install', 'test', 'uninstall', 'link', 'unlink', 'autoremove', 'tab']) {
    if (!commands.some(command => command.command === result.quality.brew &&
        command.args?.[0] === name && command.success === true &&
        command.noInstallCleanup === '1')) throw new Error(`Native Homebrew did not execute ${name}`);
  }
  const channelCommands = commands.filter(command => command.command === result.quality.brew &&
    ['install', 'uninstall', 'autoremove', 'tab'].includes(command.args?.[0]) && command.success === true);
  if (!channelCommands.length || channelCommands.some(command =>
    !/^[a-f0-9]{64}$/u.test(command.homeBeforeSha256 ?? '') ||
    command.homeBeforeSha256 !== command.homeAfterSha256)) throw new Error('Native Homebrew commands lack home-preservation evidence');
  if (!commands.some(command => command.success === true && command.args?.includes('hook')) ||
      !commands.some(command => command.success === true && command.args?.includes('doctor'))) {
    throw new Error('Native Homebrew did not execute retained installed hooks and doctor');
  }
  return result;
}

export async function verifyNativeHomebrew({ candidate, candidateDir, scratch,
  brew = process.env.SDLC_HOMEBREW_BREW, verifyLifecycle, verifyQuality = verifyHomebrewQuality, generator,
  targetArch = 'arm64', mode = 'candidate', previous, verifyUpgradeInputs, environment = process.env,
  expectedNodeVersion = nativeToolchain.node } = {}) {
  if (!['arm64', 'x64'].includes(targetArch) || !['candidate', 'stable'].includes(mode)) {
    throw new Error('Select an explicit native Mac architecture and formula mode');
  }
  if (!candidate.context.prerelease && candidate.context.homebrew.status !== 'Generated') {
    throw integrationBlocked('Mandatory native Homebrew validation requires the integrated dual-architecture stable generator');
  }
  if (!verifyLifecycle) {
    const modulePath = path.join(ROOT, 'scripts/homebrew-lifecycle.mjs');
    const present = await fs.stat(modulePath).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (!present) throw integrationBlocked('Mandatory native Homebrew lifecycle hook is not integrated');
    verifyLifecycle = (await import(pathToFileURL(modulePath).href)).verifyHomebrewLifecycle;
  }
  if (typeof verifyLifecycle !== 'function') throw new Error('Homebrew lifecycle module must export verifyHomebrewLifecycle');
  if (!brew || !path.isAbsolute(brew)) throw integrationBlocked('Provide SDLC_HOMEBREW_BREW for an approved isolated Homebrew prefix');
  const previousPins = candidate.context.previousRelease;
  if (!previousPins) throw integrationBlocked('Native R-PRE needs independently frozen supported-previous release pins');
  if (!previous) {
    const { downloadPreviousRelease } = await import('./accept-release.mjs');
    previous = await downloadPreviousRelease({ repository: previousPins.repository,
      version: previousPins.version, descriptorSha256: previousPins.descriptorSha256,
      checksumsSha256: previousPins.checksumsSha256, directory: path.join(scratch, 'previous-public-release') });
  }
  if (previous.identity?.version !== previousPins.version ||
      previous.identity?.descriptorSha256 !== previousPins.descriptorSha256 ||
      previous.identity?.checksumsSha256 !== previousPins.checksumsSha256) {
    throw new Error('Native R-PRE cannot select a different or same-version upgrade input');
  }
  verifyUpgradeInputs ??= (await import('./homebrew-lifecycle.mjs')).verifyHomebrewUpgradeInputs;
  await verifyUpgradeInputs({ candidateDirectory: previous.directory, upgradeDirectory: path.resolve(candidateDir, 'assets'),
    previous: previous.identity, current: candidate.context.identity });
  const root = path.join(scratch, 'homebrew-native');
  let server;
  let candidateBaseUrl;
  if (mode === 'candidate') {
    const archive = archiveRecord(candidate, `macos-${targetArch}`);
    const bytes = await fs.readFile(path.resolve(candidateDir, 'assets', archive.filename));
    if (sha256(bytes) !== archive.sha256 || bytes.length !== archive.size) throw new Error('Frozen Homebrew candidate archive changed');
    server = createServer((request, response) => {
      if (request.url !== `/${archive.filename}`) { response.writeHead(404).end(); return; }
      response.writeHead(200, { 'content-length': bytes.length, 'content-type': 'application/octet-stream' }).end(bytes);
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    candidateBaseUrl = `http://127.0.0.1:${server.address().port}/`;
  }
  let quality;
  try {
    let formula = candidate.descriptor.files.find(file => file.kind === 'homebrew');
    let formulaPath = formula && path.resolve(candidateDir, 'assets', formula.filename);
    if (mode === 'candidate') {
      const generated = await homebrewMetadata({ descriptor: candidate.descriptor, artifactDirectory: path.resolve(candidateDir, 'assets'),
        outputDir: path.join(scratch, `${targetArch}-formula-quality`), repository: candidate.context.releaseRepository,
        mode, candidateBaseUrl, generator });
      if (generated.status !== 'Generated') throw integrationBlocked('Native candidate audit/style requires the Homebrew generator');
      const { artifact, ...record } = generated.files[0];
      formula = record;
      formulaPath = artifact;
    }
    if (!formulaPath) throw integrationBlocked('Native Homebrew audit/style requires candidate-bound formula metadata');
    quality = await verifyQuality({ candidate, formulaPath, mode, candidateBaseUrl, environment,
      targetArch, outputDir: path.join(scratch, `${targetArch}-homebrew-quality`), brew });
    validateHomebrewQualityEvidence(quality, { identity: candidate.context.identity, targetArch, formula, mode });
    const evidence = await verifyLifecycle({ brew, candidateDirectory: previous.directory, root,
      targetArch, mode, upgradeDirectory: path.resolve(candidateDir, 'assets'), expectedNodeVersion, environment,
      expectedPreviousIdentity: previous.identity, expectedCurrentIdentity: candidate.context.identity });
    if (evidence?.passed !== true || evidence.platform !== 'darwin' || evidence.architecture !== targetArch ||
        evidence.uname !== (targetArch === 'arm64' ? 'arm64' : 'x86_64') ||
        canonical(evidence.homebrewRuntime) !== canonical({ platform: 'darwin', arch: targetArch, major: homebrewToolchain.major }) ||
        evidence.homebrewNodeVersion !== expectedNodeVersion ||
        [true, 1, '1'].includes(evidence.sysctlProcTranslated) || evidence.cleanupError) {
      throw new Error('Mandatory Homebrew native lifecycle, architecture or cleanup did not pass');
    }
    const result = { nativeValidation: 'Passed', evidence, quality,
      previousMetadata: { descriptor: previous.descriptor, checksums: previous.checksums ??
        await fs.readFile(path.join(previous.directory, 'SHA256SUMS'), 'utf8') },
      formula: { contents: await fs.readFile(formulaPath, 'utf8'), ...(candidateBaseUrl ? { candidateBaseUrl } : {}) } };
    validateNativeHomebrewEvidence(result, { candidate, targetArch, mode, expectedNodeVersion });
    return result;
  } catch (error) {
    const evidence = await readJson(path.join(root, 'evidence.json')).catch(() => null);
    error.homebrewResult = { nativeValidation: error.code === 'RELEASE_INTEGRATION_BLOCKED' ? 'NotRun' : 'Failed',
      reason: error.message, evidence, quality };
    error.retainedWorkspace = scratch;
    throw error;
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
  }
}

export async function verifyMacosArchives({ candidate, candidateDir, scratch, environment = process.env }) {
  const assets = path.resolve(candidateDir, 'assets');
  const fresh = await buildPackage({ outputDir: path.join(scratch, 'fresh-npm'), environment });
  if (fresh.sha256 !== candidate.context.identity.payloadSha256) throw new Error('Intel archive payload differs from the current source');
  const artifacts = [path.join(assets, candidate.descriptor.payload.filename), fresh.artifact];
  for (const [index, artifact] of artifacts.entries()) {
    const rebuilt = await buildPlatforms({ artifact, outputDir: path.join(scratch, `macos-rebuild-${index}`),
      sourceCommit: candidate.context.identity.sourceCommit, targets: ['macos'], environment });
    for (const arch of MACOS_ARCHITECTURES) {
      const record = archiveRecord(candidate, `macos-${arch}`);
      const actual = rebuilt.archives.find(file => file.target === 'macos');
      if (actual.sha256 !== record.sha256 || actual.size !== record.size) throw new Error(`Independent macOS ${arch} archive rebuild mismatch`);
    }
  }
  const archive = archiveRecord(candidate, 'macos-x64');
  const verified = await verifyPlatformPackage({ artifact: path.join(assets, archive.filename),
    expectedPlatform: 'darwin', expectedArch: 'x64',
    expectedDescriptorSha256: candidate.context.identity.descriptorSha256,
    expectedChecksumsSha256: candidate.context.identity.checksumsSha256 });
  return { validation: 'Passed', target: 'macos-x64', archiveTarget: verified.target, platform: 'darwin', arch: 'x64',
    filename: verified.filename, sha256: verified.sha256, size: archive.size,
    payloadSha256: verified.payloadSha256, inventoryDigest: verified.inventoryDigest };
}

export async function verifyIntelFormula({ candidate, candidateDir, scratch, generator,
  brew = process.env.SDLC_HOMEBREW_BREW, verifyQuality = verifyHomebrewQuality }) {
  const descriptor = { ...candidate.descriptor, files: candidate.descriptor.files.filter(file => file.kind === 'archive') };
  const options = { descriptor, artifactDirectory: path.resolve(candidateDir, 'assets'),
    repository: candidate.context.releaseRepository, generator,
    ...(candidate.context.prerelease ? { mode: 'candidate', candidateBaseUrl: 'http://127.0.0.1:8765/' } : {}) };
  const results = [];
  for (const iteration of ['first', 'second']) {
    const result = await homebrewMetadata({ ...options, outputDir: path.join(scratch, `intel-formula-${iteration}`) });
    if (result.status !== 'Generated') throw integrationBlocked('Mandatory Intel formula validation requires the integrated dual-architecture Homebrew generator');
    results.push(result);
  }
  const records = results.map(result => result.files.map(({ artifact, ...record }) => record));
  if (canonical(records[0]) !== canonical(records[1])) throw new Error('Independent Intel Homebrew formula generations differ');
  if (!candidate.context.prerelease &&
      canonical(records[0]) !== canonical(candidate.descriptor.files.filter(file => file.kind === 'homebrew'))) {
    throw new Error('Rebuilt Intel formula differs from frozen public Homebrew metadata');
  }
  const mode = candidate.context.prerelease ? 'candidate' : 'stable';
  const quality = await verifyQuality({ candidate, formulaPath: results[0].files[0].artifact, mode,
    candidateBaseUrl: options.candidateBaseUrl, targetArch: 'x64',
    outputDir: path.join(scratch, 'intel-homebrew-quality'), brew });
  validateHomebrewQualityEvidence(quality, { identity: candidate.context.identity, targetArch: 'x64', formula: records[0][0], mode });
  return { ...results[0].validation, deterministicGeneration: 'Passed', formula: records[0][0],
    publication: candidate.context.prerelease ? 'NotPublishedPrerelease' : 'StableMetadata',
    nativeValidation: 'NotRun', quality };
}

export async function runGate({ candidateDir, evidenceDir, target,
  releaseIntentId = process.env.RELEASE_INTENT_ID, ...expected }) {
  if (!RELEASE_GATE_TARGETS.includes(target)) throw new Error('Target is outside the release scope');
  releaseIntentId = releaseIntent(releaseIntentId);
  const candidate = await verifyCandidate(candidateDir, expected);
  if (candidate.context.releaseIntentId !== releaseIntentId) throw new Error('R-PRE must use the frozen logical release intent');
  const policy = RELEASE_SCOPE[target];
  const result = { schemaVersion: 1, profile: 'r-pre', caseId: RELEASE_PRE_CASES[target],
    releaseIntentId, target, required: policy.required, validation: policy.validation,
    identity: candidate.context.identity, status: 'NotRun', nativeValidation: 'NotRun',
    reportDirectory: `native/${target}`,
    ...(process.env.GITHUB_RUN_ID ? { run: { id: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT } } : {}) };
  const reports = path.join(ROOT, '.test-data', `release-native-${target}-${randomUUID()}`);
  try {
    const { runNativeValidation } = await import('./native-validation.mjs');
    const native = await runNativeValidation({ target, profile: 'r-pre', candidateDir,
      evidenceDir: reports, buildCandidate: false });
    const original = await readJson(path.join(reports, 'execution.json'));
    result.host = native.context.native;
    result.finishedAt = original.finishedAt;
    result.nativeValidation = native.status;
    if (native.status !== 'Passed') throw Object.assign(new Error(`Complete native ${target} R-PRE inventory did not pass`),
      { code: native.status === 'NotRun' ? 'RELEASE_INTEGRATION_BLOCKED' : 'NATIVE_VALIDATION_FAILED' });
    result.nativeValidation = 'Passed';
    result.status = 'Passed';
    return result;
  } catch (error) {
    result.status = result.nativeValidation === 'Failed' ? 'Failed' : 'NotRun';
    result.diagnosticStatus = result.status === 'Failed' ? 'FailedExecution' : 'Blocked';
    if (error.homebrewResult) result.homebrew = error.homebrewResult;
    if (error.homebrewQuality) result.homebrew = { ...result.homebrew, quality: error.homebrewQuality };
    result.reason = error.message;
    if (error.stdout) process.stdout.write(error.stdout);
    if (error.stderr) process.stderr.write(error.stderr);
    throw error;
  } finally {
    if (await fs.lstat(reports).then(() => true, error => {
      if (error.code !== 'ENOENT') throw error;
      return false;
    })) {
      await copyNativeReports(reports, path.join(evidenceDir, 'native', target));
      await fs.rm(reports, { recursive: true, force: true });
    }
    await writeJson(path.join(evidenceDir, `${target}.json`), result);
  }
}

async function main() {
  console.log(JSON.stringify(await runGate({ ...options(process.argv.slice(2)), ...trustedEnvironment() }), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.stack ?? error.message); process.exitCode = 1; });
}
