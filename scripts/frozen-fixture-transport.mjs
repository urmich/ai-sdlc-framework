import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sameNativePath } from '../src/platform.mjs';

const distributionFile = fileURLToPath(new URL('../test/distribution-channels.test.mjs', import.meta.url));

export function filterFrozenFixtureTransport(environment, file) {
  const selected = { ...environment };
  if (!sameNativePath(path.resolve(file), distributionFile)) {
    delete selected.SDLC_DISTRIBUTION_FIXTURE_CONTEXT;
  }
  return selected;
}
