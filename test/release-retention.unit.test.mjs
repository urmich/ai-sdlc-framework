export const validationDeclarations = {
  "schemaVersion": 1,
  "surfaces": [{"coverage": "direct", "paths": ["scripts/release-retention.mjs"]}],
  "groups": [
    {"root": "T-PRD037 replay definitions deduplicate shared source without changing complete identities", "dependsOn": [], "minimumSlots": 1, "exclusiveResources": []},
    {"root": "T-PRD037 replay definitions reject missing changed and ambiguous source data", "dependsOn": [], "minimumSlots": 1, "exclusiveResources": []}
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
  }],
  "plannedCases": [{"id": "T-PRD037", "selectors": [
    {"name": "T-PRD037 replay definitions deduplicate shared source without changing complete identities", "parents": []},
    {"name": "T-PRD037 replay definitions reject missing changed and ambiguous source data", "parents": []}
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
