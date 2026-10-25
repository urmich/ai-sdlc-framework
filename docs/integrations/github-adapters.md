# GitHub trusted-host integration

GitHub integration is a thin public provider boundary for the framework's
grounded development and delivery workflow, not an exhaustive GitHub SDK.
Copilot and actual authorized provider tools own native operations; the
framework verifies exact context/results through existing consumers and retains
authority, currentness, privacy and recovery safeguards.

The ordinary CLI remains offline. The `ai-sdlc-framework/github` public boundary
must not register adapters, read credentials, acquire data or dispatch effects
merely on import/construction. The actual retained boundary has seven nested
modules and 28 public facade exports. Integrated root/package/install wiring
and direct test adaptation remain separate; current acceptance stays `NotRun`.
The source inventory below is not a package-install or execution pass.

## Actual public facade

Import the following names from `ai-sdlc-framework/github`, not deleted
domain modules or unsupported deep-import paths. The table lists exactly 28
public exports from the seven retained modules under `src/github/`.

| Module | Public facade exports |
|---|---|
| `connection.mjs` | `GITHUB_REST_PROFILES`, `GITHUB_TOKEN_CLASSES`, `createGitHubConnection`, `requireGitHubConnection`, `resolveGitHubCredential`, `selectGitHubProfile`, `selectGitHubScope`, `validateGitHubCredentialContract` |
| `execution-adapter.mjs` | `createGitHubExecutionAdapter`, `normalizeGitHubExecutionLink`, `registerGitHubAdapter` |
| `host.mjs` | `createGitHubHost`, `createGitHubStore` |
| `repository.mjs` | `normalizeGitHubRepositoryIdentity`, `normalizeGitHubRepositoryObservation` |
| `schemas.mjs` | `githubRepositoryScopeRef`, `validateGitHubBranchRef`, `validateGitHubConnection`, `validateGitHubId`, `validateGitHubNodeId`, `validateGitHubRevision`, `validateGitHubWebUrl` |
| `store-bridge.mjs` | `createGitHubStoreBridge` |
| `transport.mjs` | `createGitHubTransport`, `getGitHubTransportPageLimit`, `requireGitHubCapture`, `requireGitHubRequestBinding`, `requireGitHubTransport` |

## Retained product outcomes

- Ground Requirements, one living Test Plan, design, implementation, validation
  and Review in exact selected repository/source/candidate and canonical
  artifact identities, without converting retrieved content into consent.
- Verify exact repository/fetch/push/ref, independent PR base/head/fork, check/
  producer/checkout, workflow/run/attempt and accessible human-page facts.
- Admit existing execution/test/artifact/deployment/PR/ref/merge/policy/
  notification results with actual supported causality and currentness.
- Carry exact producer/bytes/version/release/deployment/environment/destination
  context through separately authorized publication and DEV/STAGING handoffs.
- Preserve one-shot atomic claims, safe diagnostics, read-only reconciliation,
  truthful monitoring gaps and the existing Azure/offline product baseline.

The current release scope is defined in the maintained
[Requirements](../sdlc/github-integration/requirements.md),
[living Test Plan](../sdlc/github-integration/test-plan.md) and
[Technical Design](../sdlc/github-integration/technical-design.md). They are not an
endpoint catalog or evidence of new user approval.

## Removed default features

No compulsory Codespaces control/export vault, Projects UI/schema CRUD, runner/
cache/group administration, secrets/OIDC/variables administration, environment/
ruleset administration, enterprise audit/personal notification/webhook
administration, repository CRUD, generic registry restore, release/security
administration or stack/queue manager is retained as a default or hidden optional
SDK. Removed operations are not replaced with error-only facade stubs or
descriptive registrations presented as working support.

This does not remove core policy/notification result consumers, relevant source/
policy reads, release/artifact/deployment provenance or independently authorized
actions performed by a provider tool. Only proven supported core outcomes are
admitted; missing identity, permissions or stronger proof stays explicit.

## Existing host and Store contract

A trusted host acquires provider facts using its explicit authorized connection
and tool/transport, then manually supplies the existing in-process Store
callbacks. No removed native PR/check/artifact/delivery factory acquires them
automatically:

| Verifier | Facts it must independently establish |
|---|---|
| `verifyRepository` | Canonical checkout, exact selected hosted URL/repository, acquired exact branch/revision |
| `verifyPullRequest` | Exact PR with independent base/head repositories/URLs/refs/revisions and current state |
| `verifyCheckResults` | Exact check/producer/run/attempt/PR/tested-checkout and selected-result association |
| `verifyOperationResult` | Actual operation-bound causal response, supported state/result and independent execution context where applicable |
| `verifyArtifact` | Immutable artifact, exact producer/run/attempt/source/configuration/candidate and supported bytes/version proof |
| `verifyProviderVersion` | Actual selected supported provider request/response version contract |

Use existing callback input/output schemas; raw response objects and expected
identity copied from JSON are not trusted proof. The host's `createStore`
callback supplied to `runCli` must return a real Store on the exact selected
canonical home. Process-local adapter registration is explicit; duplicates
fail. Repository configuration cannot load code or inject verifiers, and the
ordinary dispatcher rejects unverified provider facts.

Authentication, credentials, endpoint compatibility, actual network/tool calls,
accessible-page acquisition and scheduler capability remain host responsibilities.
No implicit ambient credential lookup, hidden online CLI or alternate result
ledger is added. `createGitHubHost` accepts only `connections`, `clock`,
`identifier`, `authorize` and `verifiers`; optional connections are original
branded `{connection, transport}` pairs. Missing verifier callbacks explicitly
reject provider admission.

The actual host surface is `storeOptions`, `legacyOperations`,
`adapterContract` and `missingVerifiers`. The legacy operation path is
`prepare` -> `claimDispatch` -> caller-owned authorized effect ->
`recordResult`, with `reconcile` for trusted read-only recovery. It uses the
existing Store and nine families, not a native registry, evaluator or ledger.
`createGitHubStore(home, host)` constructs a real Store on the selected home
and rejects reconstructed/foreign hosts.

## Identity, result strength and currentness

Repository identity includes the selected fetch or effective push destination;
similar-looking URLs are not interchangeable. PR head/base, fork source,
test-merge, actual executed checkout and completed merge identities remain
distinct. Checks require supported run/attempt/job/producer/PR and test-selection
joins, not matching names or SHAs.

Runs require explicit attempt identity/capability. Latest-job observations cannot
prove another attempt. Actual accessible human run/attempt pages are checked
independently; API metadata/login pages/changed redirects cannot satisfy that
proof. Polling may continue with a page-proof gap when actual read/scheduler
capabilities exist.

Pin the acquired provider contract. Exact response-identified runs retain their
request association; legacy empty acknowledgements establish acceptance only
without additional supported causality. Accepted/pending/uncertain effects
cannot become completed execution through similar-run searches.

Artifacts bind immutable identity, producer/run/attempt/source/configuration/
candidate and independently supported bytes/version. Nullable provider metadata
is not filled with invented proof. Signed URLs, mutable release/tag aliases,
current inventory absence and computed bytes alone cannot establish historical
producer provenance. Release publication, artifact integrity and deployment/
target-test completion are separate supported claims.

Each of the existing nine result families remains required:
`execution`, `test`, `artifact`, `deployment`, `pull-request`, `git-ref`,
`merge`, `policy`, `notification`. Policy results need exact privileged action
authority where applicable. Notification publication does not prove personal
delivery or reading. Local builds remain local.

Current admission rechecks actual source/candidate/spec/configuration, destination,
observation sequence and authority. Archived, stale or revoked evidence remains
history without current passing credit.

## Dispatch, recovery and privacy

Prepare exact intent using the existing operations contract. Immediately before
an authorized effect, use `claimOperationDispatch` from
`ai-sdlc-framework/operations` to atomically bind the prepared operation, exact
invocation, trusted host call and current context/authority. Do not split
mark-dispatching and claim into separate transactions.

The claim input is `{workItemId, operationId, invocation, adapterContract,
hostCallId}`; `invocation` carries the exact session, tool, arguments and cwd.
Host-call proof is an in-process trusted capability, not a caller JSON label.
This is not external permission: real Copilot/host/provider/IAM controls still
apply, and reads/provider permissions grant no writes.

The public host's `legacyOperations.claimDispatch` requires the original
host/Store-bound preparation, an independent `authorize(operation) === true`
result and a non-aborted signal. Missing/non-true IAM authorization rejects;
cancellation before or after awaited IAM rejects before the bridge's atomic
claim, including when authorization itself rejects after cancellation.
Cancellation returns an `AbortError` with the fixed message
`GitHub dispatch was cancelled`, without retaining the original signal reason
or cause or evaluating its getters. Authorization errors without cancellation
remain explicit errors, not successful authorization or cancellation.
The host never performs the physical effect itself. The caller executes only
after claim success and preserves exact call/result association.

Failure before persistence leaves an unclaimed preparation. Interruption after
a persisted claim or a lost response requires exact read-only reconciliation;
never automatically retry a mutation. Concurrent/consumed one-shot authority
cannot dispatch twice. Cancellation of local waiting cannot erase a remote
effect. Changed context, missing causality and lost evidence stay explicit.

Keep private payloads, raw responses/logs/error causes, credentials, private
handles/user paths and signed retrieval URLs out of published records and
diagnostics. Use bounded safe identity and sanitized evidence references, with
sensitive acquisition values host-owned. Private reference loss needs supported
recovery/reacquisition, not copied JSON claiming trust.

Triggered/reported run monitoring uses actual authorized reads and the host
scheduler at 60-second intervals, with separate page-access proof. Report
interruption, missing capabilities and terminal outcomes. The offline ledger
cannot poll while its host is stopped.

## Current acceptance and delivery boundary

The living Test Plan contains 133 retained core cases: 88 independent P/N/G/D
variants, 36 local boundary/gates, one built-in Review, four CI and four authorized
read-only cases. Every current status is `NotRun` until actual matching
validation; old passes, schema checks and this guide do not prove execution.
Retained direct tests cover identity, transport, manual Store bridge/nine-family
results and isolated packaging. The test owner adapts fixtures and expectations;
the parent records actual selectors and integrated package/installer evidence.
Excluded native administration tests are removed rather than skipped. Core
validation catalog/evidence remains separate from the deleted native registry.

Preserve Node >=22 and the dependency-free runtime. The current required local
gate is the finite 27-assertion critical sanity selection, including the
canonical 16-case unit stage first, followed by static/documentation checks:

<!-- recipe:github-local -->
```sh
node scripts/test-runner.mjs critical
node scripts/check.mjs
```

See [contributor testing guidance](../contributing/README.md) for the current
gate and protected-host commands. Targeted debugging and full/coverage local
runs are optional; separate artifact production is not a mandatory local Review
prerequisite. Older exhaustive feature-acceptance sequences in the canonical
records are historical obligations/evidence, not a replacement local gate.
After the required local gate, use normal built-in `/review` with current
GPT-6.1 Sol/max. CI, release and live acceptance remain separately
source/run/attempt-bound and authorized.

Lifecycle stages are advisory and user-governed. Review, provider checks,
publication/merge authority, DEV completion, STAGING promotion and STAGING
completion are independent. Local success or scope approval authorizes none of
those effects; PROD is never automatic.
