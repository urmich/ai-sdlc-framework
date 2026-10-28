import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { requireThat } from '../src/core.mjs';
import { sameNativePath } from '../src/platform.mjs';

const execute = promisify(execFile);

export async function assertCommittedSourceInputs(root, { include = () => true } = {}) {
  const { stdout } = await execute('git', ['ls-tree', '-r', '-z', 'HEAD'],
    { cwd: root, maxBuffer: 8 * 1024 * 1024 });
  const files = [];
  for (const entry of stdout.split('\0').filter(Boolean)) {
    const [, mode, oid, file] = /^(\d+) blob ([a-f0-9]+)\t([\s\S]+)$/u.exec(entry) ?? [];
    requireThat(file, 'EVIDENCE', 'Validation source must be a committed regular blob');
    if (!include(file)) continue;
    requireThat(['100644', '100755'].includes(mode), 'EVIDENCE', 'Validation source must be a committed regular blob');
    const selected = path.join(root, ...file.split('/'));
    const stat = await fs.lstat(selected);
    requireThat(stat.isFile() && !stat.isSymbolicLink() &&
      sameNativePath(await fs.realpath(selected), selected),
    'EVIDENCE', 'Validation input cannot be a linked working-tree file');
    const bytes = await fs.readFile(selected);
    const actual = createHash(oid.length === 40 ? 'sha1' : 'sha256')
      .update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    requireThat(actual === oid, 'EVIDENCE',
      `Validation input ${file} differs from its committed bytes; CRLF/filter transformations cannot receive credit`);
    files.push({ file, mode, oid });
  }
  return files;
}
