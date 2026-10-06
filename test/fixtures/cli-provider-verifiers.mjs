import assert from 'node:assert/strict';
import { runCli } from 'ai-sdlc-framework/cli';
import { Store } from 'ai-sdlc-framework/store';
import { readMonitor } from 'ai-sdlc-framework/monitors';

const facts = JSON.parse(process.env.FIXTURE_PROVIDER_FACTS);
const home = process.env.FIXTURE_COPILOT_HOME;

const createStore = selectedHome => {
  const factoryHome = process.env.FIXTURE_FACTORY_HOME ??
    (process.env.FIXTURE_WRONG_HOME === '1' ? home : selectedHome);
  const store = new Store(factoryHome, {
    clock: { now: () => facts.now },
    verifyRepository: ({ provider, localRepositoryPath, remoteRepositoryURL }) => {
      assert.equal(provider, facts.repository.verifiedProvider);
      assert.equal(localRepositoryPath, facts.repository.canonicalLocalRepositoryPath);
      assert.equal(remoteRepositoryURL, facts.repository.verifiedRemoteRepositoryURL);
      return facts.repository;
    },
    verifyPullRequest: () => facts.pullRequest,
    verifyCheckResults: () => facts.checks,
    verifyOperationResult: ({ operation, observedResult }) => {
      assert.equal(operation.id, facts.operation?.id);
      assert.deepEqual(observedResult, facts.operation?.handle);
      return facts.operation.verification;
    },
    verifyArtifact: ({ operation, observation }) => {
      assert.equal(operation.id, facts.artifact?.operationId);
      assert.deepEqual(observation, facts.artifact?.handle);
      return facts.artifact.verification;
    },
  });
  return process.env.FIXTURE_READY_FACTORY === '1' ? store.ready() : store;
};

try {
  let result;
  let exitCode = 0;
  if (process.argv[2] === 'fixture-readback') {
    const store = await (await createStore(process.argv[3])).ready();
    result = {
      records: (await store.records(process.argv[4])).filter(record =>
        record.type === 'artifact' || record.type === 'repository-observation'),
      monitor: await readMonitor(store, process.argv[5]),
    };
  } else {
    ({ result, exitCode } = await runCli(process.argv.slice(2), {
      stdin: process.stdin,
    }, { createStore }));
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = exitCode;
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    verdict: 'error', error: { code: error.code ?? 'ERROR', message: error.message },
  })}\n`);
  process.exitCode = 4;
}
