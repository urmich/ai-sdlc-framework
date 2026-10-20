import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { consumerSpecification, completeRelease, consumerScope } from '../scripts/accept-release.mjs';
import { expectedConsumerContext, consumerOriginalInventory, consumerEvidenceMarker } from '../scripts/consumer-evidence.mjs';
import { canonical, sha256 } from '../packaging/standalone/archive.mjs';
import { normalizeExecutionReport, evaluateReadiness, createEvidenceBundle, renderReadinessReport } from 'ai-sdlc-framework/evidence';
import { ROOT } from '../scripts/release-bundle.mjs';
import { nativeToolchain } from '../scripts/toolchain-baseline.mjs';

const targets = ['windows-x64', 'macos-arm64', 'macos-x64'];
const clone = value => structuredClone(value);
const write = (file, value) => fs.writeFile(file, typeof value === 'string' ? value : canonical(value));
const mechanisms = () => Object.fromEntries(['signature', 'certificate', 'transparency'].map(name =>
  [name, { required: true, status: 'Passed', policy: 'controlled host-verifier fixture; not cryptographic proof' }]));
const maintenance = () => ({ idempotentUpdate: { status: 'Passed' },
  ordinaryUninstall: { status: 'Passed' }, purge: { status: 'Passed' }, installedEvents: 8 });

// Receives a genuinely verified/sealed unit fixture from the caller. No fixture
// record or callback here represents actual native, provider or signature proof.
export async function createCompletionFixture(t, { directory, bundle, bundleDirectory, expected = {},
  verifyEvidence, tree = 'b'.repeat(40), previousVersion = bundle?.context?.previousRelease?.version ?? '0.3.0',
  runId = '456', attempt = '2', baseJobId = 700 + Number(attempt) * targets.length,
  repositoryId = '123', plan: selectedPlan }) {
  assert.ok(bundle?.identity && bundleDirectory && typeof verifyEvidence === 'function');
  assert.match(String(runId), /^[1-9]\d*$/u);
  assert.match(String(attempt), /^[1-9]\d*$/u);
  assert.match(String(repositoryId), /^[1-9]\d*$/u);
  assert.ok([runId, attempt, repositoryId].every(value => Number.isSafeInteger(Number(value))));
  assert.ok(Number.isSafeInteger(baseJobId) && baseJobId > 0 && baseJobId <= Number.MAX_SAFE_INTEGER - targets.length);
  const root = path.join(directory, `consumer-completion-${randomUUID()}`);
  const evidenceDir = path.join(root, 'originals');
  await fs.mkdir(evidenceDir, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const environment = { GITHUB_REPOSITORY: 'urmich/ai-sdlc-framework', GITHUB_REPOSITORY_ID: String(repositoryId),
    GITHUB_RUN_ID: String(runId), GITHUB_RUN_ATTEMPT: String(attempt),
    GITHUB_WORKFLOW_REF: 'urmich/ai-sdlc-framework/.github/workflows/release.yml@refs/heads/main',
    SUPPORTED_PREVIOUS_VERSION: previousVersion, ImageOS: 'fixture-completion', ImageVersion: '1' };
  const scope = consumerScope(environment);
  const prepublicationEvidenceSha256 = sha256(Buffer.from('Retained fixture evidence; not a public release'));
  const plan = selectedPlan ?? await fs.readFile(path.join(ROOT, 'docs', 'sdlc', 'public-readiness', 'test-plan.md'), 'utf8');
  assert.equal(typeof plan, 'string');
  const consumers = new Map();
  const provider = new Map();
  const npm = { status: 'PublishedAndBytesVerified', sourceCommit: bundle.identity.sourceCommit,
    bundleSha256: expected.expectedBundleSha256, releaseIntentId: bundle.releaseIntentId };
  const github = { identity: bundle.identity, github: { status: 'Published' } };
  const npmResultFile = path.join(root, 'npm-publication.json');
  const githubResultFile = path.join(root, 'github-publication.json');
  await write(npmResultFile, npm);
  await write(githubResultFile, github);

  for (const [index, target] of targets.entries()) {
    const windows = target === 'windows-x64';
    const platform = windows ? 'win32' : 'darwin';
    const architecture = target === 'macos-arm64' ? 'arm64' : 'x64';
    const bootstrap = { platform, architecture, node: nativeToolchain.node, os: 'fixture-os-build',
      machine: architecture === 'arm64' ? 'arm64' : windows ? 'AMD64' : 'x86_64',
      imageOS: windows ? 'win22' : 'macos15', imageVersion: '20261019.1' };
    const native = { kind: 'native', platform, architecture, node: nativeToolchain.node,
      image: `${bootstrap.imageOS}/${bootstrap.imageVersion}`, bootstrap };
    const specification = consumerSpecification(plan, target);
    const context = expectedConsumerContext({ bundle, specification, plan, tree, target, native, scope });
    const observedAt = new Date().toISOString();
    const result = { schemaVersion: 1, profile: 'r-post', target, identity: bundle.identity,
      releaseIntentId: bundle.releaseIntentId, native, status: 'Passed',
      run: { id: scope.runId, attempt: scope.attempt }, startedAt: observedAt, finishedAt: observedAt,
      publicAssets: { status: 'Passed' },
      standalone: { status: 'Passed', upgradeKind: 'version', previousVersion, version: bundle.identity.version,
        shells: (windows ? ['powershell', 'cmd'] : ['bash', 'zsh']).map(shell => ({
          status: 'Passed', shell, upgradeKind: 'version', previousVersion, version: bundle.identity.version, ...maintenance(),
        })) },
      npm: { status: 'Passed', upgradeKind: 'version', previousVersion, version: bundle.identity.version,
        command: windows ? 'npm-generated-sdlc.cmd' : 'npm-generated-sdlc', ...maintenance() },
      homebrew: { status: windows ? 'NotRun' : 'Passed', formulaSha256: 'f'.repeat(64), evidence: {
        passed: true, mode: 'public', publicAcceptance: 'Passed', upgradeKind: 'version',
        previousIdentity: { version: previousVersion }, currentIdentity: bundle.identity,
        formulas: { upgrade: { source: 'exact-published-bytes', sha256: 'f'.repeat(64) } },
      } },
      provenance: { status: 'Passed',
        npm: { cryptographicSignatureVerification: 'Passed',
          verifier: { id: 'npm-bundled-sigstore', npmVersion: '11.16.0', version: 'fixture-only' },
          mechanisms: { ...mechanisms(), registrySignature: { required: true, status: 'Passed',
            verifier: { id: 'npm-audit-signatures', version: '11.16.0' }, policy: 'controlled unit fixture only' } } },
        github: { cryptographicSignatureVerification: 'Passed', subjectSha256: prepublicationEvidenceSha256,
          verifier: { id: 'gh-attestation-verify', version: 'fixture-only' }, mechanisms: mechanisms() } },
    };
    const report = { schemaVersion: 1, kind: 'test-execution', context,
      startedAt: observedAt, finishedAt: observedAt, observedAt, sequence: 1, complete: true, exitCode: 0,
      results: specification.cases.flatMap(test => test.assertions.map(assertion => ({
        testId: test.id, assertionId: assertion.id, selector: assertion.selector,
        expectedDigest: test.expectedDigest, checkpoint: test.checkpoint, status: 'Passed',
        expectedMet: true, observedAt, sourceSequence: 1, durationMs: 1, exitCode: 0,
        detail: 'Controlled consumer-host fixture; not native/public/cryptographic execution',
      }))) };
    const file = path.join(evidenceDir, `${target}.json`);
    const normalized = normalizeExecutionReport(report, context, input => ({
      verifierId: 'published-consumer-host', reportDigest: input.reportDigest, context,
      sourceTime: report.observedAt, sourceSequence: 1,
    }));
    const evaluation = evaluateReadiness(specification, [normalized], { profile: specification.profile,
      executions: [{ id: `consumer-${target}`, context }], now: observedAt,
      policy: { maxAgeMs: 86_400_000, revisionPolicy: 'exact', verifierIds: ['published-consumer-host'] } });
    assert.equal(evaluation.status, 'Passed', 'Completion fixture must begin with a complete matching assertion inventory');
    await write(file, result);
    await write(`${file}.execution.json`, report);
    await write(`${file}.readiness-bundle.json`, createEvidenceBundle(evaluation));
    await write(`${file}.readiness.md`, renderReadinessReport(evaluation));
    await write(`${file}.commands.jsonl`, `${canonical({ executable: 'fixture-only', args: ['consumer'],
      exitCode: 0, stdout: 'controlled execution fixture', stderr: '' })}\n`);
    await write(`${file}.toolchain.json`, { schemaVersion: 1, status: 'Passed', target, native: bootstrap });
    consumers.set(target, { file, result, report, context, native, specification });
    provider.set(target, { id: String(baseJobId + index), name: `acceptance / consumer-${target}`,
      head_sha: bundle.identity.sourceCommit, conclusion: 'success', status: 'completed',
      started_at: new Date(Date.parse(observedAt) - 60_000).toISOString(), completed_at: observedAt,
      labels: [windows ? 'windows-2022' : target === 'macos-arm64' ? 'macos-15' : 'macos-15-intel'],
      steps: [{ name: 'Anonymous exact public downloads, real prior-version upgrades and cryptographic provenance',
        conclusion: 'success' }], native: clone(native), marker: null });
  }

  async function refreshProducer(target) {
    const original = consumers.get(target);
    provider.get(target).marker = { target, sourceCommit: bundle.identity.sourceCommit,
      releaseIntentId: bundle.releaseIntentId, scope, native: provider.get(target).native,
      files: await consumerOriginalInventory(original.file) };
  }
  for (const target of targets) await refreshProducer(target);
  const api = async route => {
    if (route.endsWith(`/attempts/${scope.attempt}`)) return { status: 200, value: {
      id: Number(scope.runId), run_attempt: Number(scope.attempt),
      repository: { id: Number(scope.repositoryId), full_name: scope.repository },
      head_sha: bundle.identity.sourceCommit, head_branch: 'main', path: '.github/workflows/release.yml',
      event: 'workflow_dispatch',
    } };
    if (route.includes('/jobs?')) return { status: 200, value: { total_count: provider.size,
      jobs: [...provider.values()].map(({ native, marker, ...job }) => job) } };
    const job = [...provider.values()].find(item => route.endsWith(`/jobs/${item.id}/logs`));
    assert.ok(job, `Unexpected controlled provider route: ${route}`);
    return { status: 200, value: Buffer.from(`${consumerEvidenceMarker}${canonical(job.marker)}\n`) };
  };
  const request = { ...expected, directory: bundleDirectory, evidenceDir, npmResultFile, githubResultFile,
    prepublicationEvidenceSha256, verifyEvidence, api, environment,
    readSourceTree: async () => tree, readTestPlan: async () => plan };
  return { root, request, environment, consumers, provider, publication: { npm, github },
    refreshProducer, async writeConsumer(target) {
      const original = consumers.get(target);
      await write(original.file, original.result);
      await write(`${original.file}.execution.json`, original.report);
      await refreshProducer(target);
    }, async complete() {
      const outputDir = path.join(root, `completion-${randomUUID()}`);
      const result = await completeRelease({ ...request, outputDir });
      return { result, outputDir, completion: JSON.parse(await fs.readFile(path.join(outputDir, 'completion.json'), 'utf8')),
        readable: await fs.readFile(path.join(outputDir, 'completion.md'), 'utf8') };
    } };
}
