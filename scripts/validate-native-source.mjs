import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { digest, requireThat } from '../src/core.mjs';
import { assertCommittedSourceInputs } from './committed-source-inputs.mjs';
import { captureNativeDefinitionInputs } from './native-validation.mjs';
import { repositoryRoot } from './test-runner.mjs';

const execute = promisify(execFile);

export async function validateNativeSource({ expectedSourceCommit = process.env.EXPECTED_SOURCE_COMMIT } = {}) {
  requireThat(typeof expectedSourceCommit === 'string' && /^[a-f0-9]{40,64}$/u.test(expectedSourceCommit),
    'INPUT', 'Source safety requires the independently selected source commit');
  const revision = (await execute('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot })).stdout.trim();
  requireThat(revision === expectedSourceCommit, 'EVIDENCE',
    'Source safety checkout differs from the independently selected source commit');
  // Capture invokes the archive's unconditional safety guard before compiling its definitions.
  const definition = await captureNativeDefinitionInputs({ target: 'linux-x64', profile: 'pr' });
  const selected = new Set(definition.sourceFiles.map(source => source.file));
  await assertCommittedSourceInputs(repositoryRoot, { include: file => selected.has(file) });
  const after = (await execute('git', ['rev-parse', 'HEAD', 'HEAD^{tree}'],
    { cwd: repositoryRoot })).stdout.trim().split(/\r?\n/u);
  requireThat(definition.source.revision === revision && after[0] === revision &&
    after[1] === definition.source.treeSha, 'EVIDENCE', 'Source safety inputs changed during verification');
  return { kind: 'native-source-safety', status: 'Passed', source: definition.source,
    sourceFileCount: definition.sourceFiles.length, sourceDigest: digest(definition.sourceFiles) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await validateNativeSource())); }
  catch (error) {
    console.error(`${error.code ?? 'SOURCE'}: ${error.message}`);
    process.exitCode = 1;
  }
}
