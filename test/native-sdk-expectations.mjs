import assert from 'node:assert/strict';

const pythonFiles = new Set([
  'test/public-readiness-ci.test.mjs', 'test/public-readiness-consumer.test.mjs',
  'test/public-readiness-observer.test.mjs', 'test/public-readiness-native.test.mjs',
  'test/public-readiness-docs.test.mjs',
]);
const goLauncherRoots = new Set([
  'T-51 native Go launcher preserves paths, streams, arguments, working directory and child exit code',
  'T-51 reproducible launcher builds cannot delegate to an ambient GOCACHEPROG',
]);
const schemaRoot = 'T-PRD015 actual pinned Go, Python schema and static validators execute valid and invalid owned inputs';

export function expectedBodySdkRequirements(inventory, target, part) {
  assert.equal(inventory.complete, true);
  const selected = new Set(part.assertionIds);
  const roots = inventory.cases.filter(test => !test.parents.length &&
    test.applicability.platforms.includes(target) && selected.has(test.id));
  const schema = roots.some(test => test.file === 'test/public-readiness-ci.test.mjs' &&
    test.name === schemaRoot);
  return {
    go: schema || roots.some(test => test.file === 'test/winget-launcher-native.test.mjs' &&
      goLauncherRoots.has(test.name)),
    python: roots.some(test => pythonFiles.has(test.file)),
    schema,
  };
}
