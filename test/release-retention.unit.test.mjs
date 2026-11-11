export const validationDeclarations = {
  "schemaVersion": 1,
  "surfaces": [{"coverage": "direct", "paths": ["scripts/release-retention.mjs"]}],
  "groups": [
    {"root": "T-PRD037 replay definitions deduplicate shared source without changing complete identities", "dependsOn": [], "minimumSlots": 1, "exclusiveResources": []},
    {"root": "T-PRD037 replay definitions reject missing changed and ambiguous source data", "dependsOn": [], "minimumSlots": 1, "exclusiveResources": []},
    {"root": "T-PRD037 trust retention opens a caller-relative archive without changing signed bytes", "dependsOn": [], "minimumSlots": 1, "exclusiveResources": []},
    {"root": "T-PRD037 archive verification opens caller-relative bundle and independently pinned root paths", "dependsOn": [], "minimumSlots": 1, "exclusiveResources": []}
  ],
  "applicability": [{
    "names": [
      "T-PRD037 replay definitions deduplicate shared source without changing complete identities",
      "T-PRD037 replay definitions reject missing changed and ambiguous source data"
    ],
    "platforms": ["linux-x64", "windows-x64", "macos-arm64", "macos-x64"],
    "owner": "maintainer",
    "reason": "PR-only FR-206/AC-206.2 functional regressions preserve complete replay identities while deduplicating identical source arrays, retain version-one compatibility and reject corrupted or ambiguous retained data. Independent process-isolated one-slot roots use owned filesystem and in-memory fixtures, with no external access, shared resources or critical-profile growth. Fixture results supply no native or release acceptance credit.",
    "prerequisites": ["Node >=22", "Owned repository-local filesystem and in-memory fixtures"]
  }, {
    "names": [
      "T-PRD037 trust retention opens a caller-relative archive without changing signed bytes",
      "T-PRD037 archive verification opens caller-relative bundle and independently pinned root paths"
    ],
    "platforms": ["linux-x64", "windows-x64", "macos-arm64", "macos-x64"],
    "owner": "maintainer",
    "reason": "PR-only FR-206/AC-206.2 functional regressions exercise the shared gh file-open boundary and actual immutable trust retention. Injected transport reads real owned files using subprocess cwd/argv semantics, including spaces, relative inputs and absolute-path compatibility. Independent one-slot roots have no dependencies, global mutations, shared resources or critical-profile growth. Controlled verifier output is not cryptographic or release acceptance evidence.",
    "prerequisites": ["Node >=22", "Owned repository-local filesystem fixtures; no gh, credentials, network or package manager"]
  }],
  "plannedCases": [{"id": "T-PRD037", "selectors": [
    {"name": "T-PRD037 replay definitions deduplicate shared source without changing complete identities", "parents": []},
    {"name": "T-PRD037 replay definitions reject missing changed and ambiguous source data", "parents": []},
    {"name": "T-PRD037 trust retention opens a caller-relative archive without changing signed bytes", "parents": []},
    {"name": "T-PRD037 archive verification opens caller-relative bundle and independently pinned root paths", "parents": []}
  ]}]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { canonical, sha256 } from '../packaging/standalone/archive.mjs';
import { digest } from '../src/core.mjs';
import * as retention from '../scripts/release-retention.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const targets = ['linux-x64', 'windows-x64', 'macos-arm64', 'macos-x64'];
const sourceCommit = 'a'.repeat(40);
const observedAt = '2026-11-11T12:00:00.000Z';

function storedJson(filename, value) {
  const bytes = Buffer.from(canonical(value));
  return { bytes, reference: { filename, sha256: sha256(bytes), size: bytes.length } };
}

function sourceBlock(value) {
  const bytes = Buffer.from(canonical(value));
  const hash = sha256(bytes);
  return { bytes, reference: { filename: `replay/sources/${hash}.json`, sha256: hash, size: bytes.length } };
}

async function signedPathFixture(t) {
  const directory = path.join(ROOT, '.test-data', `release trust paths ${randomUUID()}`);
  await fs.mkdir(path.dirname(directory), { recursive: true });
  await fs.mkdir(directory);
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
    await assert.rejects(fs.lstat(directory), { code: 'ENOENT' });
  });
  const archiveBytes = Buffer.from('Owned file-open fixture, not authentic release evidence\n');
  const archiveSha256 = sha256(archiveBytes);
  const archive = path.join(directory, `release-prepublication-path-fixture-123-1-${archiveSha256}.tar.gz`);
  const signedBytes = Buffer.from(`${JSON.stringify({
    verificationMaterial: { certificate: 'controlled-fixture-only' },
    dsseEnvelope: { payload: Buffer.from('{}').toString('base64'), signatures: [{ sig: 'fixture-only' }] },
  })}\n`);
  const attestationBundle = path.join(directory, 'signed bundle.jsonl');
  const rootBytes = Buffer.from('{"fixture":"independently selected root"}\n');
  const trustedRoot = path.join(directory, 'trusted root.json');
  const outputDir = path.join(directory, 'retained trust');
  await fs.mkdir(outputDir);
  await fs.writeFile(archive, archiveBytes, { flag: 'wx' });
  await fs.writeFile(attestationBundle, signedBytes, { flag: 'wx' });
  await fs.writeFile(trustedRoot, rootBytes, { flag: 'wx' });
  const opened = [];
  const run = async (command, args, options) => {
    assert.equal(command, 'gh');
    assert.equal(options.cwd, directory);
    const readArgument = index => fs.readFile(path.resolve(options.cwd, args[index]));
    assert.deepEqual(await readArgument(2), archiveBytes);
    assert.deepEqual(await readArgument(args.indexOf('--bundle') + 1), signedBytes);
    if (args.includes('--custom-trusted-root')) {
      assert.deepEqual(await readArgument(args.indexOf('--custom-trusted-root') + 1), rootBytes);
    }
    assert.equal(args[args.indexOf('--repo') + 1], 'fixture/trust-paths');
    assert.equal(args[args.indexOf('--signer-workflow') + 1], 'fixture/trust-paths/.github/workflows/release.yml');
    assert.equal(args[args.indexOf('--signer-digest') + 1], sourceCommit);
    assert.equal(args[args.indexOf('--source-digest') + 1], sourceCommit);
    assert.equal(args[args.indexOf('--source-ref') + 1], 'refs/heads/main');
    assert.ok(args.includes('--deny-self-hosted-runners'));
    opened.push(args.includes('--custom-trusted-root') ? 'independently-pinned-root' : 'default-host-roots');
    return { stdout: JSON.stringify([{ verificationResult: {
      statement: { subject: [{ digest: { sha256: archiveSha256 } }] },
      verifiedTimestamps: [{ type: 'Tlog' }],
    } }]) };
  };
  return { archive, archiveBytes, archiveSha256, attestationBundle, signedBytes, trustedRoot, rootBytes,
    outputDir, opened, request: { archive, attestationBundle, expectedArchiveSha256: archiveSha256,
      expectedSourceCommit: sourceCommit, sourceRepository: 'fixture/trust-paths', run } };
}

test('T-PRD037 trust retention opens a caller-relative archive without changing signed bytes', async t => {
  const f = await signedPathFixture(t);
  const retained = await retention.retainAttestationMaterial({
    ...f.request, archive: path.relative(process.cwd(), f.archive),
    releaseIntentId: 'path-fixture', runId: '123', attempt: '1', outputDir: f.outputDir,
  });
  assert.deepEqual(f.opened, ['default-host-roots']);
  assert.deepEqual(await fs.readFile(f.archive), f.archiveBytes);
  assert.deepEqual(await fs.readFile(f.attestationBundle), f.signedBytes);
  assert.deepEqual(await fs.readFile(path.join(f.outputDir, retained.attestationFilename)), f.signedBytes);
  const trustBytes = await fs.readFile(path.join(f.outputDir, retained.trustFilename));
  assert.equal(sha256(trustBytes), retained.trustSha256);
  const trust = JSON.parse(trustBytes);
  assert.deepEqual(trust.subject, { filename: path.basename(f.archive), sha256: f.archiveSha256 });
  assert.deepEqual(trust.attestation, {
    filename: retained.attestationFilename, sha256: sha256(f.signedBytes), size: f.signedBytes.length,
  });
  assert.deepEqual(trust.verification.mechanisms, {
    signature: 'Passed', certificate: 'Passed', transparency: 'Passed',
  });
});

test('T-PRD037 archive verification opens caller-relative bundle and independently pinned root paths', async t => {
  const f = await signedPathFixture(t);
  const request = { ...f.request, trustedRoot: f.trustedRoot, expectedTrustedRootSha256: sha256(f.rootBytes) };
  const absolute = await retention.verifyArchiveWithGh(request);
  const relative = await retention.verifyArchiveWithGh({
    ...request, attestationBundle: path.relative(process.cwd(), f.attestationBundle),
    trustedRoot: path.relative(process.cwd(), f.trustedRoot),
  });
  assert.deepEqual(relative, absolute);
  assert.deepEqual(f.opened, ['independently-pinned-root', 'independently-pinned-root']);
  await assert.rejects(retention.verifyArchiveWithGh({
    ...request, trustedRoot: path.relative(process.cwd(), f.trustedRoot),
    expectedTrustedRootSha256: '0'.repeat(64),
  }), { code: 'RELEASE_REPLAY' });
  assert.equal(f.opened.length, 2, 'An unpinned root must fail before invoking the verifier');
  assert.deepEqual(await fs.readFile(f.archive), f.archiveBytes);
  assert.deepEqual(await fs.readFile(f.attestationBundle), f.signedBytes);
  assert.deepEqual(await fs.readFile(f.trustedRoot), f.rootBytes);
});

test('T-PRD037 replay definitions deduplicate shared source without changing complete identities', async t => {
  const directory = path.join(ROOT, '.test-data', `release-retention-unit-${randomUUID()}`);
  await fs.mkdir(path.dirname(directory), { recursive: true });
  await fs.mkdir(directory);
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
    await assert.rejects(fs.lstat(directory), { code: 'ENOENT' });
  });
  const shared = [{ file: 'src/replay-fixture.mjs', contents: 'export const retained = 1;\n' }];
  const distinct = [{ file: 'src/replay-fixture.mjs', contents: 'export const retained = 2;\n' }];
  const definitions = targets.map((target, index) => ({
    schemaVersion: 1, kind: 'native-validation-definition', target, profile: 'r-pre',
    selectedWorkersRequest: null,
    source: { revision: sourceCommit, treeSha: 'b'.repeat(40), repositoryId: 'repository-123' },
    sourceFiles: index === 3 ? distinct : shared,
  }));
  const originals = structuredClone(definitions);
  const byTarget = new Map(definitions.map(definition => [definition.target, definition]));
  const bundle = {
    identity: { version: '1.2.3', sourceCommit },
    releaseRepository: 'fixture/release-retention',
    releaseIntentId: 'release-retention-unit',
    files: [],
    producerVerification: {
      origins: targets.map(target => ({ target })),
      contexts: targets.map(target => ({ target, sourceTime: observedAt, sourceSequence: 1 })),
    },
  };
  await fs.writeFile(path.join(directory, 'bundle.json'), canonical(bundle), { flag: 'wx' });
  const { graph, entries } = await retention.captureReleaseReplayInputs({
    bundle, directory, sourceRepository: 'fixture/replay-source', observedAt,
    captureDefinition: async ({ target }) => byTarget.get(target),
  });

  assert.equal(graph.schemaVersion, 2, 'Replay capture must store shared source separately from target definitions');
  const files = new Map(entries.map(entry => [entry.path, entry.data]));
  assert.equal(files.size, entries.length, 'Shared blocks must be emitted once, not as duplicate archive entries');
  const blocks = entries.filter(entry => entry.path.startsWith('replay/sources/'));
  assert.equal(blocks.length, 2, 'Three identical source arrays share one block; the distinct fourth retains its own');
  assert.deepEqual(new Set(blocks.map(entry => entry.path)),
    new Set([sourceBlock(shared).reference.filename, sourceBlock(distinct).reference.filename]));
  assert.deepEqual(definitions, originals, 'Capturing compact definitions must not mutate native originals');
  assert.deepEqual(graph.definitions.map(reference => reference.target).sort(), [...targets].sort());
  for (const original of originals) {
    const { sourceFiles, ...compact } = original;
    const stored = storedJson(`replay/definitions/${original.target}.json`, compact);
    const block = sourceBlock(sourceFiles);
    const reference = graph.definitions.find(row => row.target === original.target);
    assert.deepEqual(reference, {
      target: original.target, ...stored.reference, definitionDigest: digest(original),
      sourceFiles: block.reference,
    });
    assert.deepEqual(files.get(reference.filename), stored.bytes);
    assert.deepEqual(files.get(reference.sourceFiles.filename), block.bytes);
    const restored = await retention.readReleaseReplayDefinition({ files, reference, schemaVersion: graph.schemaVersion });
    assert.deepEqual(restored, original);
    assert.equal(canonical(restored), canonical(original));
    assert.equal(digest(restored), reference.definitionDigest);
  }

  const original = originals[0];
  const legacy = storedJson(`replay/definitions/${original.target}.json`, original);
  const restored = await retention.readReleaseReplayDefinition({
    files: new Map([[legacy.reference.filename, legacy.bytes]]),
    reference: { target: original.target, ...legacy.reference, definitionDigest: digest(original) },
    schemaVersion: 1,
  });
  assert.deepEqual(restored, original, 'Version-one full definitions remain replayable without shared blocks');
  assert.equal(canonical(restored), canonical(original));
  assert.equal(digest(restored), digest(original));
});

test('T-PRD037 replay definitions reject missing changed and ambiguous source data', async () => {
  const compact = { schemaVersion: 1, kind: 'native-validation-definition', target: 'linux-x64',
    profile: 'r-pre', source: { revision: sourceCommit } };
  const sourceFiles = [{ file: 'src/replay-fixture.mjs', contents: 'export const retained = 1;\n' }];
  const complete = { ...compact, sourceFiles };
  const stored = storedJson('replay/definitions/linux-x64.json', compact);
  const block = sourceBlock(sourceFiles);
  const reference = { target: compact.target, ...stored.reference, definitionDigest: digest(complete),
    sourceFiles: block.reference };
  const files = new Map([[stored.reference.filename, stored.bytes], [block.reference.filename, block.bytes]]);
  assert.equal(typeof retention.readReleaseReplayDefinition, 'function', 'Replay requires the validated definition reader');
  assert.deepEqual(await retention.readReleaseReplayDefinition({ files, reference, schemaVersion: 2 }), complete);
  const reject = (input, message) => assert.rejects(
    async () => retention.readReleaseReplayDefinition({ files, reference, schemaVersion: 2, ...input }),
    { code: 'RELEASE_REPLAY' }, message);

  const missing = new Map(files);
  missing.delete(block.reference.filename);
  await reject({ files: missing }, 'A missing shared source block cannot reconstruct the original definition');

  const changed = sourceBlock([{ ...sourceFiles[0], contents: 'export const retained = 2;\n' }]);
  assert.equal(changed.bytes.length, block.bytes.length);
  await reject({ files: new Map(files).set(block.reference.filename, changed.bytes) },
    'Same-size source-byte changes must fail the stored hash check');
  await reject({ reference: { ...reference, sourceFiles: { ...block.reference, size: block.reference.size + 1 } } },
    'Source size mismatch must reject even when the expected hash matches');
  await reject({ reference: { ...reference, sourceFiles: { ...block.reference, sha256: '0'.repeat(64) } } },
    'Source hash mismatch must reject even when the expected size matches');
  await reject({
    files: new Map(files).set(changed.reference.filename, changed.bytes),
    reference: { ...reference, sourceFiles: changed.reference },
  }, 'Recomputing a changed source block reference cannot preserve the original complete-definition identity');

  const ambiguous = storedJson(stored.reference.filename, { ...compact, sourceFiles });
  await reject({
    files: new Map(files).set(ambiguous.reference.filename, ambiguous.bytes),
    reference: { ...reference, ...ambiguous.reference },
  }, 'A compact definition cannot also supply its own sourceFiles, even if those values agree');

  const nonArray = sourceBlock({ file: sourceFiles[0].file, contents: sourceFiles[0].contents });
  await reject({
    files: new Map(files).set(nonArray.reference.filename, nonArray.bytes),
    reference: { ...reference, sourceFiles: nonArray.reference, definitionDigest: digest({ ...compact, sourceFiles: {
      file: sourceFiles[0].file, contents: sourceFiles[0].contents,
    } }) },
  }, 'Shared source data must be an array even when its complete-definition digest matches');

  const changedCompact = storedJson(stored.reference.filename, { ...compact, source: { revision: 'b'.repeat(40) } });
  await reject({ files: new Map(files).set(changedCompact.reference.filename, changedCompact.bytes) },
    'Compact definition bytes remain independently hash checked');
  await reject({ schemaVersion: 3 }, 'Unknown graph schemas cannot select a replay interpretation');
});
