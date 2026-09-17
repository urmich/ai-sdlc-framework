import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

export const MAX_ARCHIVE_SIZE = 128 * 1024 * 1024;
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const comparePath = (left, right) => left < right ? -1 : left > right ? 1 : 0;
export function canonical(value) {
  const sorted = item => Array.isArray(item) ? item.map(sorted) :
    item !== null && typeof item === 'object' ?
      Object.fromEntries(Object.keys(item).sort(comparePath).map(key => [key, sorted(item[key])])) : item;
  return `${JSON.stringify(sorted(value))}\n`;
}

export function safePath(name) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9_./+-]+$/u.test(name) ||
      name.split('/').some(part => !part || part === '.' || part === '..' ||
        part.endsWith('.') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))) {
    throw new Error(`Unsafe archive path: ${name}`);
  }
  return name;
}

export function validateEntries(entries) {
  if (!entries.length || entries.length > 20000) throw new Error('Invalid archive entry count');
  const seen = new Set();
  let total = 0;
  for (const entry of entries) {
    safePath(entry.path);
    const key = entry.path.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate archive entry: ${entry.path}`);
    seen.add(key);
    if (!Buffer.isBuffer(entry.data) || ![0o644, 0o755].includes(entry.mode)) {
      throw new Error(`Unsupported archive entry or mode: ${entry.path}`);
    }
    total += entry.data.length;
    if (total > MAX_ARCHIVE_SIZE) throw new Error('Archive exceeds size limit');
  }
  for (const name of seen) {
    const parts = name.split('/');
    while (parts.pop(), parts.length) {
      if (seen.has(parts.join('/'))) throw new Error('Archive contains a file/directory collision');
    }
  }
  return entries;
}

const sortedEntries = entries => [...validateEntries(entries)].sort((a, b) => comparePath(a.path, b.path));
const octal = (value, length) => `${value.toString(8).padStart(length - 1, '0')}\0`;
const text = bytes => bytes.toString('utf8').replace(/\0.*$/su, '');

export function tarGzip(entries) {
  const blocks = [];
  for (const entry of sortedEntries(entries)) {
    const header = Buffer.alloc(512);
    let name = entry.path;
    let prefix = '';
    if (Buffer.byteLength(name) > 100) {
      const split = name.lastIndexOf('/', 155);
      prefix = name.slice(0, split);
      name = name.slice(split + 1);
      if (split < 1 || Buffer.byteLength(name) > 100) throw new Error('Archive path exceeds USTAR limits');
    }
    header.write(name, 0, 100);
    header.write(octal(entry.mode, 8), 100);
    header.write(octal(0, 8), 108);
    header.write(octal(0, 8), 116);
    header.write(octal(entry.data.length, 12), 124);
    header.write(octal(0, 12), 136);
    header.fill(32, 148, 156);
    header[156] = 48;
    header.write('ustar\0', 257);
    header.write('00', 263);
    header.write(prefix, 345, 155);
    const sum = header.reduce((total, byte) => total + byte, 0);
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(header, entry.data, Buffer.alloc((512 - entry.data.length % 512) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  const result = gzipSync(Buffer.concat(blocks), { level: 9 });
  // The gzip OS byte is metadata, not part of payload identity.
  result[9] = 255;
  return result;
}

export function readTarGzip(bytes) {
  if (bytes.length > MAX_ARCHIVE_SIZE) throw new Error('Archive exceeds size limit');
  const tar = gunzipSync(bytes, { maxOutputLength: MAX_ARCHIVE_SIZE });
  if (tar.length % 512 !== 0) throw new Error('Truncated tar archive');
  const entries = [];
  let offset = 0;
  while (offset + 512 <= tar.length && tar.subarray(offset, offset + 512).some(byte => byte !== 0)) {
    const header = tar.subarray(offset, offset + 512);
    const number = (start, length) => {
      const value = text(header.subarray(start, start + length)).trim();
      if (!/^[0-7]+$/u.test(value)) throw new Error('Malformed tar numeric field');
      return parseInt(value, 8);
    };
    const sum = header.reduce((total, byte, i) => total + (i >= 148 && i < 156 ? 32 : byte), 0);
    if (number(148, 8) !== sum || text(header.subarray(257, 263)) !== 'ustar') {
      throw new Error('Malformed tar header or checksum');
    }
    if (![0, 48].includes(header[156]) || header.subarray(157, 257).some(byte => byte !== 0)) {
      throw new Error('Only regular archive files are allowed');
    }
    const name = text(header.subarray(0, 100));
    const prefix = text(header.subarray(345, 500));
    const size = number(124, 12);
    offset += 512;
    if (size > MAX_ARCHIVE_SIZE || offset + Math.ceil(size / 512) * 512 > tar.length) {
      throw new Error('Truncated tar entry');
    }
    entries.push({ path: prefix ? `${prefix}/${name}` : name,
      mode: number(100, 8), data: tar.subarray(offset, offset + size) });
    const padding = tar.subarray(offset + size, offset + Math.ceil(size / 512) * 512);
    if (padding.some(byte => byte !== 0)) throw new Error('Malformed tar padding');
    offset += Math.ceil(size / 512) * 512;
  }
  if (tar.length - offset < 1024 || tar.subarray(offset).some(byte => byte !== 0)) {
    throw new Error('Missing tar terminator or trailing entries');
  }
  return validateEntries(entries);
}

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function zip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const entry of sortedEntries(entries)) {
    const name = Buffer.from(entry.path);
    const checksum = crc32(entry.data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(33, 12); // 1980-01-01, ZIP's earliest timestamp.
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(entry.data.length, 18);
    header.writeUInt32LE(entry.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, entry.data);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50);
    record.writeUInt16LE(0x0314, 4);
    header.copy(record, 6, 4, 30);
    record.writeUInt32LE(((0o100000 | entry.mode) * 65536) >>> 0, 38);
    record.writeUInt32LE(offset, 42);
    central.push(record, name);
    offset += header.length + name.length + entry.data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

export function readZip(bytes) {
  if (bytes.length < 22 || bytes.length > MAX_ARCHIVE_SIZE) throw new Error('Invalid ZIP size');
  const end = bytes.subarray(-22);
  if (end.readUInt32LE() !== 0x06054b50 || end.readUInt32LE(4) !== 0 ||
      end.readUInt16LE(8) !== end.readUInt16LE(10) || end.readUInt16LE(20) !== 0) {
    throw new Error('Malformed ZIP directory');
  }
  const count = end.readUInt16LE(10);
  const start = end.readUInt32LE(16);
  if (start + end.readUInt32LE(12) !== bytes.length - 22) throw new Error('Truncated ZIP directory');
  const entries = [];
  let cursor = start;
  let offset = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > bytes.length - 22 || offset + 30 > start) throw new Error('Truncated ZIP entry');
    const central = bytes.subarray(cursor, cursor + 46);
    const header = bytes.subarray(offset, offset + 30);
    const size = header.readUInt32LE(22);
    const nameSize = header.readUInt16LE(26);
    if (central.readUInt32LE() !== 0x02014b50 || header.readUInt32LE() !== 0x04034b50 ||
        !central.subarray(6, 30).equals(header.subarray(4, 28)) ||
        header.readUInt16LE(6) !== 0 || header.readUInt16LE(8) !== 0 ||
        header.readUInt32LE(18) !== size || header.readUInt16LE(28) !== 0 ||
        central.readUInt16LE(30) !== 0 || central.readUInt32LE(32) !== 0 ||
        central.readUInt32LE(42) !== offset || offset + 30 + nameSize + size > start ||
        cursor + 46 + nameSize > bytes.length - 22) {
      throw new Error('Unsupported or inconsistent ZIP entry');
    }
    const name = bytes.subarray(offset + 30, offset + 30 + nameSize);
    if (!name.equals(bytes.subarray(cursor + 46, cursor + 46 + nameSize))) {
      throw new Error('ZIP filenames disagree');
    }
    const data = bytes.subarray(offset + 30 + nameSize, offset + 30 + nameSize + size);
    if (crc32(data) !== header.readUInt32LE(14)) throw new Error('ZIP checksum mismatch');
    const mode = central.readUInt32LE(38) >>> 16;
    if ((mode & 0o170000) !== 0o100000) throw new Error('Only regular ZIP files are allowed');
    entries.push({ path: name.toString('utf8'), mode: mode & 0o7777, data });
    offset += 30 + nameSize + size;
    cursor += 46 + nameSize;
  }
  if (offset !== start || cursor !== bytes.length - 22) throw new Error('Unlisted ZIP entries');
  return validateEntries(entries);
}

export function inventory(entries, prefix = '') {
  return sortedEntries(entries).map(entry => {
    if (!entry.path.startsWith(prefix)) throw new Error(`Entry is outside ${prefix}`);
    return { path: safePath(entry.path.slice(prefix.length)), type: 'file',
      size: entry.data.length, sha256: sha256(entry.data),
      mode: entry.mode.toString(8).padStart(4, '0') };
  });
}
