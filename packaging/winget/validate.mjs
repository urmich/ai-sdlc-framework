import * as fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { manifestContext, renderManifests, verifyArchive } from './generate.mjs';

const execute = promisify(execFile);

export async function validateManifests({
  manifestDir, archivePath, native = false, wingetCommand = 'winget', ...options
}) {
  if (!manifestDir || !archivePath) throw new Error('Manifest validation requires manifestDir and the candidate archivePath');
  if (typeof native !== 'boolean') throw new Error('WinGet native validation option must be a boolean');
  const context = manifestContext(options);
  const expected = renderManifests(options);
  const directory = path.resolve(manifestDir);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  if (entries.some(entry => !entry.isFile()) ||
      JSON.stringify(entries.map(entry => entry.name).sort()) !== JSON.stringify(expected.map(file => file.filename).sort())) {
    throw new Error('WinGet manifest directory has missing, extra, or non-regular files');
  }
  for (const file of expected) {
    if (await fs.readFile(path.join(directory, file.filename), 'utf8') !== file.content) {
      throw new Error(`WinGet manifest contract mismatch in ${file.filename}: stale version/URL/digest, architecture, Node dependency, or portable install/upgrade/uninstall metadata`);
    }
  }
  await verifyArchive(archivePath, options);
  let nativeValidation = 'NotRun';
  if (native) {
    if (process.platform !== 'win32' || process.arch !== 'x64') {
      throw new Error('Native WinGet validation requires an actual Windows x64 process');
    }
    await execute(wingetCommand, ['validate', '--manifest', directory, '--disable-interactivity'],
      { maxBuffer: 4 * 1024 * 1024, timeout: 120_000 });
    nativeValidation = 'Passed';
  }
  return { schemaVersion: 1, version: context.version, packageIdentifier: context.identifier,
    contractValidation: 'Passed', archiveDigestValidation: 'Passed', nativeValidation,
    status: context.testOnly ? 'test-only' : native ? 'repository-ready' : 'contract-validated',
    testOnly: context.testOnly, publicationEligible: !context.testOnly && native,
    communityAccepted: false, clientAvailable: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const native = args.at(-1) === '--native';
  if (native) args.pop();
  if (args.length !== 4 || args[0] !== '--input' || args[2] !== '--manifest-dir') {
    throw new Error('Usage: node packaging/winget/validate.mjs --input INPUT.json --manifest-dir DIRECTORY [--native]');
  }
  const options = JSON.parse(await fs.readFile(args[1], 'utf8'));
  console.log(JSON.stringify(await validateManifests({ ...options, manifestDir: args[3], native }), null, 2));
}
