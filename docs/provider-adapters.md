# Provider adapter extension guide

Provider adapters translate concrete DevOps-system observations into the strict
execution identity used by monitoring and PR readiness. Generic framework code
does not parse provider URLs or guess how a provider names projects, workflows,
builds, jobs, or attempts.

## Normalized execution identity

Every adapter returns:

```json
{
  "provider": "stable-adapter-id",
  "connection": "configured-connection",
  "scopeRef": "opaque-provider-scope",
  "definitionRef": "optional-definition",
  "executionRef": "required-execution",
  "attemptRef": "optional-attempt"
}
```

`scopeRef`, `definitionRef`, `executionRef`, and `attemptRef` are opaque to the
framework. Their meaning and construction must be deterministic within the
adapter. Do not use display names when the provider supplies stable IDs.

## Adapter interface

Register an adapter before monitor link verification:

```js
import { registerProviderAdapter } from
  'ai-sdlc-framework/provider-adapters';
import { attachMonitor, verifyMonitorLink } from
  'ai-sdlc-framework/monitors';
import { Store } from 'ai-sdlc-framework/store';

const store = new Store(process.env.COPILOT_HOME);
await store.ready();

registerProviderAdapter({
  id: 'example-ci',
  linkKinds: ['summary', 'logs'],
  async normalizeLinkObservation(observation) {
    const url = new URL(observation.run.webUrl);
    const finalUrl = new URL(observation.finalUrl);
    const providerOrigin = new URL(observation.providerOrigin).origin;
    const executionPath = `/projects/${encodeURIComponent(observation.project.id)}/runs/${encodeURIComponent(observation.run.id)}`;
    const sameExecution = url.protocol === 'https:' &&
      !url.username && !url.password &&
      url.origin === providerOrigin &&
      url.pathname === executionPath &&
      !finalUrl.username && !finalUrl.password &&
      finalUrl.origin === providerOrigin &&
      finalUrl.pathname === executionPath &&
      observation.run.projectId === observation.project.id &&
      observation.run.workflowId === observation.workflow.id;
    return {
      identity: {
        provider: 'example-ci',
        connection: observation.connection,
        scopeRef: observation.project.id,
        definitionRef: observation.workflow.id,
        executionRef: observation.run.id,
        attemptRef: observation.run.attempt,
      },
      url: url.href,
      kind: 'summary',
      accessible: observation.accessible && sameExecution,
      ...(observation.accessible && sameExecution ? {} : {
        reason: 'Execution page is unavailable or identifies another execution',
      }),
    };
  },
});
```

The registration contract requires:

- A stable lowercase adapter ID.
- One or more supported link kinds: `summary`, `job`, `logs`, or `deployment`.
- A normalization function that validates provider-native input and returns
  only `identity`, `url`, `kind`, `accessible`, and an optional `reason`.
- Credential-free HTTPS URLs.
- Provider-specific endpoint and page-shape validation inside the adapter;
  generic verification does not reject provider paths based on words such as
  `api`, `login`, or `job`.
- Exact identity derived from an authorized provider response, not copied from
  the expected monitor record.
- Explicit `accessible: false` when the link cannot be checked.

Duplicate adapter IDs fail. Repository configuration cannot dynamically load
adapter code. New built-in adapters are packaged with the framework; trusted
host integrations import the exported adapter, monitor, and Store modules,
initialize the Store for the selected Copilot home, and register an adapter
before calling the monitor API in the same process. Registration is process-local and
does not modify a separately launched CLI process.

## Azure DevOps reference adapter

The built-in `azure-devops` adapter accepts a bounded projection of an Azure
DevOps build read and link-access result:

```json
{
  "connection": "primary-ci",
  "build": {
    "id": 42,
    "project": { "id": "project-guid" },
    "repository": { "id": "repository-guid" },
    "definition": { "id": 17 },
    "_links": {
      "web": {
        "href": "https://dev.azure.com/example/project/_build/results?buildId=42"
      }
    }
  },
  "access": {
    "accessible": true,
    "finalUrl": "https://dev.azure.com/example/project/_build/results?buildId=42&view=results"
  }
}
```

The adapter derives:

- `scopeRef` from project ID and optional repository ID.
- `definitionRef` from the build definition ID.
- `executionRef` from the build ID.
- The canonical summary URL from `_links.web.href`.

Both the metadata URL and final URL must use the same trusted origin and build
results path and identify the same `buildId`. Additional query parameters are
allowed. Redirects to another organization, host, path, or build remain
unverified.

The adapter does not call Azure DevOps. The agent obtains the build response and
link-access result through an authorized provider tool, then passes the bounded
observation to the framework.

## Adding another provider

1. Define the provider's stable scope, definition, execution, and attempt IDs.
2. Identify an authorized API/tool response that contains those IDs and the
   provider-generated web URL.
3. Implement strict input validation and deterministic normalization.
4. Reject login pages, API endpoints, credentials in URLs, and identity-changing
   redirects.
5. Add fixtures for a valid execution, retries/attempts, wrong scope,
   wrong definition, wrong execution, inaccessible links, and malformed input.
6. Verify that monitor keys, notices, archives, and PR-check association work
   without provider-specific changes outside the adapter.
7. Document required provider capabilities and any unsupported execution type.

If the provider cannot supply enough identity evidence, return an unverified
result. Never infer missing identity from a URL display string.
