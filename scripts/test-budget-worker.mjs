import { acquireTestWorker } from './test-budget.mjs';
import path from 'node:path';
import { filterFrozenFixtureTransport } from './frozen-fixture-transport.mjs';

const fixtureEnvironment = filterFrozenFixtureTransport(process.env, process.argv[1]);
if (fixtureEnvironment.SDLC_DISTRIBUTION_FIXTURE_CONTEXT === undefined) {
  delete process.env.SDLC_DISTRIBUTION_FIXTURE_CONTEXT;
}
const resources = JSON.parse(process.env.SDLC_TEST_FILE_RESOURCES ?? '{}');
const file = path.resolve(process.argv[1]);
const encodedGroup = process.execArgv.find(argument => argument.startsWith('--conditions=sdlc-group-'));
const group = encodedGroup ? JSON.parse(Buffer.from(encodedGroup.slice('--conditions=sdlc-group-'.length),
  'base64url').toString('utf8')) : null;
const allocation = await acquireTestWorker(group?.minimumSlots ??
  resources[process.platform === 'win32' ? file.toLowerCase() : file] ?? 1,
group ? { groupId: group.id, exclusiveResources: group.exclusiveResources } : {});
if (process.env.SDLC_TEST_CWD) process.chdir(process.env.SDLC_TEST_CWD);
process.once('beforeExit', allocation.close);
process.once('exit', allocation.close);
