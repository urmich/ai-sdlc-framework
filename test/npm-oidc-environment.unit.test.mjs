export const validationDeclarations = {
  "schemaVersion": 1,
  "surfaces": [{"coverage": "direct", "paths": [".github/workflows/npm-publish.yml"]}],
  "groups": [{
    "root": "T-PRD031 publisher environment retains both OIDC request fields without unrelated credentials",
    "dependsOn": [], "minimumSlots": 1, "exclusiveResources": []
  }],
  "applicability": [{
    "names": ["T-PRD031 publisher environment retains both OIDC request fields without unrelated credentials"],
    "platforms": ["linux-x64", "windows-x64", "macos-arm64", "macos-x64"],
    "owner": "maintainer",
    "reason": "PR-only FR-206/AC-206.4 regression executes the actual inline publisher environment declaration with controlled input. One independent process-isolated root has no shared resources, prerequisite roots or critical-profile growth. It supplies no actual publication acceptance credit.",
    "prerequisites": ["Node >=22", "In-memory workflow environment fixture"]
  }],
  "plannedCases": [{"id": "T-PRD031", "selectors": [{
    "name": "T-PRD031 publisher environment retains both OIDC request fields without unrelated credentials",
    "parents": []
  }]}]
};
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { runInNewContext } from 'node:vm';

test('T-PRD031 publisher environment retains both OIDC request fields without unrelated credentials', async () => {
  const workflow = await fs.readFile(new URL('../.github/workflows/npm-publish.yml', import.meta.url), 'utf8');
  const step = /^ +node --input-type=module <<'NPM_OIDC_PUBLISH'\r?\n([\s\S]*?)^ +NPM_OIDC_PUBLISH\r?$/mu.exec(workflow);
  assert.ok(step, 'Missing actual publication step');
  const declaration = /^ +const npmEnvironment = \{[\s\S]*?^ +\};\r?$/mu.exec(step[1]);
  assert.ok(declaration, 'Missing actual npm subprocess environment declaration');
  const environment = Object.freeze({
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.invalid/oidc-fixture',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'controlled-unit-fixture',
    ARTIFACT_READ_TOKEN: 'controlled-unit-fixture',
    TEST_SECRET: 'controlled-unit-fixture',
    CLIENT_CREDENTIAL: 'controlled-unit-fixture',
    SERVICE_PASSWORD: 'controlled-unit-fixture',
    npm_config_registry: 'https://example.invalid/untrusted-registry',
    PATH: 'owned-fixture-bin',
  });
  const actual = runInNewContext(`${declaration[0]}\nnpmEnvironment`, {
    process: { env: environment }, path,
  });
  assert.deepEqual(Object.fromEntries(Object.keys(environment)
    .filter(key => Object.hasOwn(actual, key)).map(key => [key, actual[key]])), {
    ACTIONS_ID_TOKEN_REQUEST_URL: environment.ACTIONS_ID_TOKEN_REQUEST_URL,
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
    PATH: environment.PATH,
  });
});
