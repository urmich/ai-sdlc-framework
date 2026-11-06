export const validationDeclarations = {
  "schemaVersion": 1,
  "surfaces": [{"coverage": "direct", "paths": ["scripts/package.mjs", "packaging/standalone/archive.mjs"]}],
  "applicability": [{
    "names": [
      "T-36 canonical npm archive ignores host metadata but retains independently selected Git modes",
      "T-36 canonical npm archive preserves content changes and rejects selection drift",
      "T-36 canonical npm archive rejects unknown unmerged and nonregular Git modes",
      "T-36 canonical npm archive rejects links and unsafe or duplicate paths"
    ],
    "platforms": ["linux-x64", "windows-x64", "macos-arm64", "macos-x64"],
    "owner": "maintainer-package-reproducibility",
    "reason": "PR-only pure archive regression; no critical-budget growth, npm execution, filesystem, network or native acceptance claim.",
    "prerequisites": ["Node >=22 with built-in zlib; in-memory generic TAR fixtures"]
  }],
  "groups": [
    {"root": "T-36 canonical npm archive ignores host metadata but retains independently selected Git modes", "minimumSlots": 1, "dependsOn": [], "exclusiveResources": []},
    {"root": "T-36 canonical npm archive preserves content changes and rejects selection drift", "minimumSlots": 1, "dependsOn": [], "exclusiveResources": []},
    {"root": "T-36 canonical npm archive rejects unknown unmerged and nonregular Git modes", "minimumSlots": 1, "dependsOn": [], "exclusiveResources": []},
    {"root": "T-36 canonical npm archive rejects links and unsafe or duplicate paths", "minimumSlots": 1, "dependsOn": [], "exclusiveResources": []}
  ]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { canonicalPackageArchive } from '../scripts/package.mjs';
import { comparePath, readTarGzip, tarGzip } from '../packaging/standalone/archive.mjs';

const sourceFiles = [
  { path: 'README.md', data: Buffer.from('generic data\n'), mode: 0o644 },
  { path: 'bin/tool.mjs', data: Buffer.from('#!/usr/bin/env node\n'), mode: 0o755 },
];
const index = sourceFiles.map(entry =>
  `${entry.mode === 0o755 ? '100755' : '100644'} ${'a'.repeat(40)} 0\t${entry.path}\0`).join('');
const selection = sourceFiles.map(entry => ({ path: entry.path, size: entry.data.length }));
const packageEntries = sourceFiles.map(entry => ({ ...entry, path: `package/${entry.path}` }));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function checksum(header) {
  header.fill(32, 148, 156);
  const sum = header.reduce((total, byte) => total + byte, 0);
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
}

function archiveVariant(entries, { reverse = false, metadata = false, editHeader = () => {} } = {}) {
  const tar = gunzipSync(tarGzip(entries));
  const records = [];
  let offset = 0;
  for (const entry of [...entries].sort((a, b) => comparePath(a.path, b.path))) {
    const length = 512 + Math.ceil(entry.data.length / 512) * 512;
    const record = Buffer.from(tar.subarray(offset, offset + length));
    const header = record.subarray(0, 512);
    if (metadata) {
      header.write('0000123\0', 108);
      header.write('0000456\0', 116);
      header.write('12345670123\0', 136);
      header.write('generic-owner', 265);
      header.write('generic-group', 297);
    }
    editHeader(header, entry);
    checksum(header);
    records.push(record);
    offset += length;
  }
  if (reverse) records.reverse();
  const bytes = gzipSync(Buffer.concat([...records, Buffer.alloc(1024)]), { level: metadata ? 1 : 9 });
  if (metadata) bytes.writeUInt32LE(12345678, 4);
  bytes[9] = metadata ? 10 : 3;
  return bytes;
}

const normalize = (bytes, gitIndex = index, files = selection) =>
  canonicalPackageArchive(bytes, { gitIndex, files });

test('T-36 canonical npm archive ignores host metadata but retains independently selected Git modes', () => {
  const posix = archiveVariant(packageEntries);
  const windows = archiveVariant(packageEntries.map(entry => ({ ...entry, mode: 0o644 })),
    { reverse: true, metadata: true });
  const executableHost = archiveVariant(packageEntries.map(entry => ({ ...entry, mode: 0o755 })));
  assert.notEqual(hash(posix), hash(windows), 'Old raw archive identity differs for the same content');
  assert.notEqual(hash(windows), hash(executableHost));
  assert.notDeepEqual(readTarGzip(posix), readTarGzip(windows));
  const expected = tarGzip(packageEntries);
  for (const raw of [posix, windows, executableHost]) {
    const actual = normalize(raw);
    assert.deepEqual(actual.bytes, expected);
    assert.deepEqual(readTarGzip(actual.bytes), packageEntries);
    assert.equal(actual.sha256, hash(expected));
    assert.equal(actual.size, expected.length);
    assert.equal(actual.unpackedSize, sourceFiles.reduce((sum, entry) => sum + entry.data.length, 0));
    assert.deepEqual(actual.files, [selection[1], selection[0]]);
    assert.equal(actual.bytes[9], 255);
    assert.deepEqual(normalize(actual.bytes), actual);
  }
});

test('T-36 canonical npm archive preserves content changes and rejects selection drift', () => {
  const original = normalize(tarGzip(packageEntries));
  const changed = packageEntries.map((entry, i) =>
    i ? entry : { ...entry, data: Buffer.from('changed data\n') });
  assert.equal(changed[0].data.length, packageEntries[0].data.length);
  const actual = normalize(tarGzip(changed));
  assert.notEqual(actual.sha256, original.sha256);
  assert.deepEqual(readTarGzip(actual.bytes)[0].data, changed[0].data);
  const extra = { path: 'package/extra.txt', data: Buffer.from('extra'), mode: 0o644 };
  const extendedIndex = `${index}100644 ${'b'.repeat(40)} 0\textra.txt\0`;
  assert.throws(() => normalize(tarGzip([...packageEntries, extra]), extendedIndex),
    /file selection disagree/u);
  assert.throws(() => normalize(tarGzip(packageEntries.slice(1))), /file selection disagree/u);
  assert.throws(() => normalize(tarGzip(packageEntries), index,
    selection.map((file, i) => ({ ...file, size: file.size + (i ? 0 : 1) }))), /file selection disagree/u);
  assert.throws(() => normalize(tarGzip(packageEntries), index, [selection[0], selection[0]]),
    /duplicate npm file selection/u);
});

test('T-36 canonical npm archive rejects unknown unmerged and nonregular Git modes', () => {
  const bytes = tarGzip(packageEntries);
  for (const gitIndex of [
    index.replace('100644', '120000'), index.replace('100644', '160000'),
    index.replace('100644', '100600'), index.split('\0').slice(1).join('\0'),
  ]) assert.throws(() => normalize(bytes, gitIndex), /regular tracked Git mode/u);
  for (const gitIndex of [
    index.replace(' 0\t', ' 1\t'), `${index}${index}`, index.slice(0, -1),
    index.replace('a'.repeat(40), 'not-an-object-id'),
  ]) assert.throws(() => normalize(bytes, gitIndex), /Git index/u);
});

test('T-36 canonical npm archive rejects links and unsafe or duplicate paths', () => {
  const altered = editHeader => archiveVariant(packageEntries, { editHeader });
  assert.throws(() => normalize(altered(header => { header[156] = 50; })), /regular archive files/u);
  assert.throws(() => normalize(altered(header => {
    header.fill(0, 0, 100);
    header.write('package/../outside');
  })), /Unsafe archive path/u);
  assert.throws(() => normalize(altered(header => {
    header.fill(0, 0, 100);
    header.write('package/same');
  })), /Duplicate archive entry/u);
  assert.throws(() => normalize(tarGzip(packageEntries.map(entry =>
    ({ ...entry, path: entry.path.replace('package/', 'other/') })))), /outside package/u);
});
