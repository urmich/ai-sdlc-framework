# Provider adapter extension guide

Provider adapters translate concrete DevOps-system observations into the strict
execution identity used by monitoring and PR readiness. Generic framework code
does not parse provider URLs or guess how a provider names projects, workflows,
builds, jobs, or attempts.

GitHub's thin public provider boundary and retained core outcomes are described
in [GitHub trusted-host integration](github-adapters.md). Authorized provider
tools may own native actions; the framework verifies exact context and results
through its existing consumers rather than duplicating an exhaustive API catalog.
The actual GitHub facade retains 28 exports from seven nested modules:
connection, execution-adapter, host, repository, schemas, store-bridge and
transport. Its host uses manual six-verifier closures and existing
`legacyOperations`, not native domain factories. Integrated package/test
adaptation is separate and current validation remains `NotRun`.
Preserve every existing Azure baseline obligation and all nine result families;
descriptive registration is neither working support nor passing acceptance.

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

For a new hosted execution or environment-test result, supply the complete
verified `executionIdentity`, including an explicit `attemptKind`: `known`
with the actual `attemptRef`, or `not-applicable` only when the adapter proves
that this execution kind has no distinct attempts. Missing identity is not a
legacy compatibility shortcut for newly reported results.

A trusted result verifier may additionally return `executionContext` with
the independently proven provider, connection, execution scope, definition
and attempt capability. Both initial result recording and reconciliation
compare that context with the result identity. Do not derive execution scope
from a repository ID or copy untrusted result fields to create their own proof.

For an authorized action, independently verify the exact requested destination
and resulting effect. A repository name, requested asset name and deployment
target are distinct facts; similar names cannot resolve conflicting identities
or confer permission. Release/version/bytes and deployment context remain
required where the existing artifact/operation contract needs them, without a
separate release-administration or native control-plane SDK.

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

For offline CLI commands that require verified provider facts, a trusted host
can import `runCli` from `ai-sdlc-framework/cli` and supply `createStore`.
That function receives the selected Copilot home and returns a `Store`
constructed with the host's trusted verifier functions. The ordinary
`bin/sdlc.mjs` command has no such verifiers and rejects unverified provider
facts. Neither CLI JSON nor repository configuration can supply executable
adapter code. The host remains responsible for any provider reads; the
framework dispatcher makes no network call.

The existing Store verifier boundary is `verifyRepository`,
`verifyPullRequest`, `verifyCheckResults`, `verifyOperationResult`,
`verifyArtifact` and `verifyProviderVersion`. Preserve their actual schemas and
the selected canonical home. The retained result families are `execution`,
`test`, `artifact`, `deployment`, `pull-request`, `git-ref`, `merge`, `policy`
and `notification`, including generic baseline consumers that are not native
provider endpoints. Notification publication is not personal delivery proof;
policy results remain independently authorized, not a policy-management SDK.

Trusted online hosts use `claimOperationDispatch` from the existing
`ai-sdlc-framework/operations` export before invoking a prepared effect. The
claim binds the exact invocation and unique host call to current candidate,
specification, configuration and authority in one Store transaction. A separate
`markDispatching`/claim sequence creates an interruption window and must not be
used by a trusted dispatcher. Provider/IAM authorization is still required;
claimed or uncertain operations are reconciled read-only, never blindly retried.

The GitHub host's `legacyOperations` exposes `prepare`, `claimDispatch`,
`recordResult` and `reconcile`. Its dispatch wrapper requires the original
host/Store-bound preparation, independent `authorize(operation) === true` and
cancellation checks before and after awaited IAM, then invokes the existing
atomic claim. The caller owns the authorized physical effect; neither that
host nor the offline dispatcher performs an implicit provider mutation.

Lifecycle stages remain advisory and user-governed. A prepared/claimed
operation, verified observation, passing check or document label cannot create
user consent, external permission, Review completion or environment authority.
Currentness guards preserve exact source/candidate/spec/configuration and keep
stale/archived results historical. Protect raw responses/logs/causes, credentials,
private handles/user paths and signed URLs with safe bounded identities and
sanitized evidence references.

If a Git remote has different fetch and push URLs, the trusted host can
verify the actual push URL through `repository observe` with `pushURL:true`.
The default observation continues to use the fetch URL. The hosting service
must verify the exact push destination; similar-looking HTTPS and SSH URLs
are not assumed equivalent, and observing either URL grants no publication
permission.
For an early-draft document-only push, the adapter also verifies one
`verifiedBranch:{branchRef,revision}` pair from the hosted repository: the
named full branch ref pointed to that exact commit when observed. A default
branch name and an unrelated revision cannot substitute for this pair.
For an early-draft PR, verify the pair against the repository hosting the PR,
not the source fork's push destination.

For a host that proves a unique tool-call ID, import `prepareOperation` from
`ai-sdlc-framework/operations`. Pass the documented host adapter contract
and the host-proven call ID as its third, in-process argument. Preparation
stores only their binding digests; the verified provider-call result must
return the same call ID. `op prepare` JSON and hook payloads cannot supply
this proof. Without a trusted host ID or a provider-proven request link, a
matching provider result remains uncertain.

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
