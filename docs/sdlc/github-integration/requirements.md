# Requirements: Grounded GitHub SDLC delivery

## Current product scope

Deliver usable GitHub integration for the whole framework product: grounded
Requirements -> one living Test Plan -> Technical Design -> implementation ->
unit-first validation -> built-in candidate Review -> separately authorized
publication and environment handoffs. The framework owns exact context,
evidence admission, authority accounting and recovery. Copilot and authorized
provider tools may own native operations; the framework need not duplicate
GitHub's API surface.

This is maintenance of the existing `github-integration` canonical artifact
for `wi-github-integration` on `github-integration/trusted-adapters`. The explicit
October 12 scope-cut direction governs current release scope. This document
does not rewrite historical approved snapshots, record a new phase approval,
complete Review or grant an external action. Original approvals and prior
evidence remain in their actual ledger/session references, not copied here.

Keep every existing Azure baseline obligation and all nine core result
families. Keep exact repository/source/candidate/PR/check/run/attempt/artifact/
release/deployment context and outcomes needed for user-authorized delivery.
Keep truthful provider limitations, privacy, durable uncertainty and recovery.
Local-only actions remain local; lifecycle recommendations remain advisory
and user-governed. Actual host, provider and IAM controls enforce permissions.

### Removed default features

The release does not require endpoint exhaustiveness or a parallel native
control-plane SDK. Remove compulsory Codespaces/cloud-environment control and
export vaults; Projects UI/schema CRUD; runner, cache and runner-group
administration; secrets, OIDC and variables administration; environment and
ruleset administration; enterprise audit, personal notification and webhook
administration; repository CRUD; generic registry restore; release and security
administration; stack and merge-queue managers. Do not retain hidden optional
SDKs, error-only substitutes or obsolete catalogs merely because they were
written.

These cuts do not remove relevant source reading, exact release/deployment
results, policy observations/results, notification publication results or
authorized core actions. A provider tool can perform an independently authorized
operation while the framework verifies its actual supported result through an
existing core contract. A fact without enough proof stays limited/unverified;
it is not relabeled unsupported solely to excuse required core behavior.

The actual public facade now retains 28 exports from seven nested modules:
`connection.mjs`, `execution-adapter.mjs`, `host.mjs`, `repository.mjs`,
`schemas.mjs`, `store-bridge.mjs` and `transport.mjs`. The host uses manually
supplied existing verifier callbacks and `legacyOperations`; it does not
acquire PR/check/artifact/delivery proof through removed native domain factories.
Authorized tools and trusted callbacks own that acquisition. Exact module
inventory is source fact, not execution acceptance or a coverage denominator.

## FR-140: Identify GitHub executions and their exact attempts

**Definition of Done**

- AC-140.1: The usable provider boundary identifies Actions by stable
  repository, workflow, run and explicit attempt identity/capability. Missing
  attempts are not silently assigned to the latest attempt.
- AC-140.2: Actual human-page access binds the same repository/run/attempt.
  API metadata, login pages, credentials in URLs and identity-changing redirects
  cannot establish accessible execution-page proof.
- AC-140.3: Latest-run/jobs data cannot satisfy another or archived attempt.
  Historical success does not confer current evidence or authority.

## FR-141: Verify hosted repository and branch identity

**Definition of Done**

- AC-141.1: Trusted observations bind the canonical checkout, exact selected
  hosted URL and stable repository identity. Remote names and similar URLs are
  not identity proof.
- AC-141.2: Fetch and effective push destinations are resolved independently.
  SSH/HTTPS aliases and renamed repositories need explicit verification, not
  guessed normalization.
- AC-141.3: Default and selected branches are authenticated exact-ref/full-
  revision facts. Prefix searches, stale defaults and unrelated commits reject.
- AC-141.4: Observation grants no publication, merge or deployment authority.
  Source-revision, revocation and destination guards remain effective.

## FR-142: Bind PR and check facts to their actual contexts

**Definition of Done**

- AC-142.1: Identify the exact PR and independent base/head repositories, URLs,
  refs and full revisions. Fork proof cannot be borrowed from the base.
- AC-142.2: Required checks join exact run/attempt, job, check, producer and PR
  identities through supported provider/producer evidence. Names or SHAs alone
  cannot establish the association.
- AC-142.3: PR head, base, test-merge, executed checkout and terminal merged
  revisions stay distinct. Run head metadata alone is not checkout proof.
- AC-142.4: An unmerged test-merge SHA is not completed merge. Missing checkout
  or association evidence remains an explicit readiness/test-proof gap.
- AC-142.5: Currentness, sequence, archival, destination, revocation and
  producer-retention safeguards apply to every admitted observation.

## FR-143: Normalize provider results without inventing causality

**Definition of Done**

- AC-143.1: Retain `execution`, `test`, `artifact`, `deployment`,
  `pull-request`, `git-ref`, `merge`, `policy` and `notification`. Each family
  has an admitted positive through its actual trusted consumer and independent
  wrong-target/result, missing-causality and denial/error assertions.
- AC-143.2: Pin the actual provider version and supported request/response
  contract. A response identifying an exact run differs from a legacy empty
  acknowledgement. Similar event/ref/SHA/time searches never replace causality.
- AC-143.3: Report missing correlation, insufficient evidence and provider
  errors explicitly. No unsupported-family blanket, successful fallback,
  invented permission or document label waives a retained core obligation.
- AC-143.4: Exercise writes and asynchronous results with controlled fixtures
  and independently scoped authority. Scope approval requires no live write
  and grants none.
- AC-143.5: Preserve exact authorized policy-change results, including supported
  auto-merge/configuration effects, without building an administration SDK.
  Privileged changes need distinct authority. Notification publication proves
  the selected target/result, not personal delivery or reading.
- AC-143.6: Local build/test handling remains usable without being relabeled a
  hosted GitHub execution.

## FR-144: Preserve complete artifact provenance

**Definition of Done**

- AC-144.1: Acceptance binds immutable artifact identity, producing repository/
  run/attempt, source, configuration and candidate.
- AC-144.2: Missing/nullable digest or attempt metadata stays missing. Supported
  independent producer/retrieval evidence may establish the core contract;
  copied JSON or computed bytes alone cannot invent producer provenance.
- AC-144.3: Expired/deleted/unavailable producers, conflicting facts and byte
  integrity mismatches remain explicit failures or unavailable proof.
- AC-144.4: Signed retrieval URLs and mutable aliases are not stable identity.
  Current inventory absence cannot prove historical absence.
- AC-144.5: Controlled admission/rejection cases and actual live artifact
  acceptance are separate. Live status remains `NotRun` until exact bytes and
  producer/context facts have actually been verified under read authority.

## FR-145: Provide a usable existing trusted-host boundary

**Definition of Done**

- AC-145.1: Public GitHub integration wires actual authorized acquisition to
  the existing Store/CLI/monitor consumers, not disconnected parsers. Preserve
  `verifyRepository`, `verifyPullRequest`, `verifyCheckResults`,
  `verifyOperationResult`, `verifyArtifact` and `verifyProviderVersion`, the
  selected canonical home and exact atomic dispatch claims.
- AC-145.2: The ordinary dispatcher remains offline and rejects unverified
  facts. Repository JSON cannot load code, register executable adapters or
  self-attest evidence.
- AC-145.3: Connections, authentication, provider tools/transport and external
  permissions are explicit host responsibilities. Evidence, diagnostics,
  causes, URLs and configuration expose no credentials or private raw payloads.
- AC-145.4: Preserve Node >=22 portability, dependency-free runtime, Azure
  behavior, durable storage, isolated fixtures and recovery. Package/install
  the seven retained nested modules and actual 28-export public facade, without
  removed native backends or compatibility stubs. Integrated validation remains
  separate from source inventory.

## FR-146: Demonstrate the current integration truthfully

**Definition of Done**

- AC-146.1: The living Test Plan maps every AC to observable core assertions,
  including positive, negative, proof-gap, denial, current/history and attempt
  boundaries. Fast feedback, complete local validation and live acceptance
  remain separate.
- AC-146.2: Required unit-first local tests, full regression, static/package
  checks and the normal built-in `/review` assess the current candidate.
  Fixes require fresh validation; old passes cannot be reused as current proof.
- AC-146.3: Read-only live acceptance identifies actual repository/ref, PR,
  run/attempt/check and accessible-page evidence. Missing fork, rerun, checkout
  or artifact facts remain gaps; fixtures do not certify those live claims.
- AC-146.4: Use the current GPT-6.1 Sol/max review configuration at the normal
  built-in final Review boundary. No extra per-stage model review or fanout is
  compulsory. A review result is not user approval or remote-action consent.

## FR-147: Ground full-product scope and preserve core parity

**Definition of Done**

- AC-147.1: Ground a requirement and its DoD in the selected repository/source
  revision, applicable instructions and exact relevant provider facts. Source
  identity, retrieved content and user decision evidence remain distinct.
- AC-147.2: Preserve all ADO-01 through ADO-24 obligations below and all nine
  result families, including generic framework consumers that are not native
  GitHub endpoints. No scope cut may silently remove this product baseline.
- AC-147.3: Completion uses the current Test Plan's meaningful core assertions
  and actual selected/executed results, not endpoint/factory/catalog counts or
  a selected subset reported as complete product validation.
- AC-147.4: Report implementation readiness, current fixture/local/CI/live
  results and blockers separately. Unavailable tools, proof or environment
  access remain visible; current execution starts `NotRun`.
- AC-147.5: State exactly what a supported observation proves. Acquire
  available necessary source joins; do not invent stronger guarantees or use
  missing fixture data as proof that the provider cannot supply evidence.

## FR-148: Carry grounded context across core stage handoffs

**Definition of Done**

- AC-148.1: Requirements, Test Plan and design reference exact relevant source
  artifacts and revisions. Authorized provider/source reading supplies needed
  context without compulsory planning-board, Wiki or Projects CRUD wrappers.
- AC-148.2: Carry the canonical artifact, its current content identity,
  historical approved snapshot, source/candidate/configuration and current
  context through Requirements -> tests -> design -> implementation -> Review.
  Labels and retrieved content cannot create approval or passing evidence.
- AC-148.3: User decisions independently govern stage progression and scope.
  Explicit stage overrides proceed through normal host permissions; lifecycle
  advice cannot veto actions. Invalid bookkeeping stays uncredited/truthful.

## FR-149: Establish candidate-bound collaboration readiness

**Definition of Done**

- AC-149.1: Use exact repository/source/candidate/PR/check facts to assess
  readiness and safely identify an existing PR before any authorized publication.
  Forks, PR head/base and reviewed/tested candidates cannot borrow identities.
- AC-149.2: Framework Review, provider reviews, required checks, policy facts,
  merge permission and publication authority are independent. Green CI does
  not authorize merge, auto-merge, force-push, ref deletion or policy bypass.
- AC-149.3: Authorized core PR/ref/merge/policy actions use exact destination,
  requested effect, current context and causal result. Missing policy/access
  or producer evidence reports a gap rather than permissive readiness.

## FR-150: Bind delivery to exact production and destination results

**Definition of Done**

- AC-150.1: Bind build/test/run/attempt and selected artifact to candidate,
  source and configuration. Accepted dispatch, aggregate success, release
  labels or mutable tags cannot substitute for terminal required outcomes.
- AC-150.2: Carry actual release/version/asset bytes and deployment/environment/
  target context through existing artifact and operation contracts and
  authorized provider tools. Publication, provenance and deployed verification
  stay distinct; no release/registry administration SDK is required.
- AC-150.3: Keep push/PR/release/publication, DEV and STAGING permissions
  independently scoped. Current DEV completion precedes recommending STAGING;
  separate STAGING promotion/completion precedes PROD readiness. Never execute
  PROD automatically or infer environment authority from local success.
- AC-150.4: Prove exact successful and rejected/limited delivery outcomes with
  fixtures. Actual CI, release, artifact and deployment acceptance need matching
  candidate/run/attempt/bytes/destination evidence and authorized execution.

## FR-151: Preserve action authority, privacy and recoverable observation

**Definition of Done**

- AC-151.1: Reads, provider capabilities and source content grant no writes.
  Each actual effect has exact current user authority and separate host/IAM
  permission. Protect private responses, logs, causes, handles and user paths;
  retain only bounded safe identities and sanitized evidence references.
- AC-151.2: Prepare exact intent, atomically claim the actual invocation/call
  under current candidate/spec/configuration/authority, then execute via an
  authorized host tool. Concurrent or consumed claims cannot duplicate effects.
- AC-151.3: Reconcile timeout/lost-response/interruption against exact persisted
  operation and supported provider evidence read-only. Preserve uncertainty,
  revocation, stale context and history; never blindly repeat a mutation.
- AC-151.4: Observe triggered and reported runs with exact attempt and source,
  independent accessible-page proof, real scheduler/read capability and
  60-second polling. Report host interruption, monitoring gaps and terminal
  results without treating observation as consent.

## Authorized instruction maintenance

The user-approved cost/evidence correction refines existing AC-147.1,
AC-147.3/4, AC-148.1/2/3 and AC-151.3; it adds no provider feature or acceptance
denominator. Establish scope, checkpoint gates, exact selectors and evidence
capture before expensive execution. Bound investigations, retain current
execution handles and recover original authoritative instructions/evidence
after compaction instead of rediscovering or rerunning unchanged work.

Evidence reuse compares recorded original execution inputs against independently
established inputs required for the current claim. Additions, modifications and
deletions can invalidate evidence. Preserve immutable historical executions;
reset affected current case and dependent checkpoint credit to `NotRun` with
the old/new identities and reason. Exact whole-candidate contracts and required
fresh full checkpoints take precedence over selective reuse. Unknown impact or
applicability cannot retain passing credit, and invalidation is not a test
failure. No acknowledgement or instruction text proves understanding, passing
tests, approval or external authority.

This correction changes the existing entry/focused guides, not the runtime
hook architecture. Existing persistent orientation generation and stale-token
detection remain distinct from automatic reminder delivery or comprehension;
no "never forgotten" guarantee is claimed.

## Retained Azure baseline

Baseline provenance is merged `main` at `dd8d082`. Native means a built-in
Azure execution adapter; generic means an existing framework contract, not an
Azure API connector. These stable IDs retain their original obligations.

| IDs | Required parity outcome | Core source / AC |
|---|---|---|
| ADO-01, ADO-02, ADO-03 | Registered execution adapter; stable repository/workflow scope; exact definition/run/attempt identity | `src/provider-adapters.mjs`; AC-140.1 |
| ADO-04, ADO-05, ADO-15 | Credential-free human summary page; exact access/redirect verification; actual monitor admission | `src/provider-adapters.mjs`, `src/monitors.mjs`; AC-140.2 |
| ADO-06, ADO-14 | Trusted process-local registration and explicit attempt capability | `src/provider-adapters.mjs`; AC-140.1, AC-145.1 |
| ADO-07, ADO-08, ADO-09 | Canonical checkout/hosted identity; selected fetch and effective push URL proof | `src/repository-observations.mjs`; AC-141.1, AC-141.2 |
| ADO-10 | Authenticated default/selected exact branch-to-revision proof | `src/repository-observations.mjs`; AC-141.3 |
| ADO-11, ADO-12, ADO-13 | Independent fork source; exact PR observation; current PR transitions/sequence | `src/pr.mjs`, `src/repository-observations.mjs`; AC-142.1, AC-142.5 |
| ADO-16, ADO-17 | Hosted execution and selected test results, with their actual causal/context proof | `src/external-results.mjs`; AC-143.1 |
| ADO-18 | Immutable artifact/producer/attempt/source/configuration/bytes provenance | `src/repository-observations.mjs`; AC-144.1 |
| ADO-19 | Exact artifact/configuration/environment/target deployment result | `src/external-results.mjs`; AC-143.1, AC-150.2 |
| ADO-20, ADO-21, ADO-22 | Exact PR, Git-ref, merge and authorized policy results | `src/external-results.mjs`; AC-143.1, AC-143.5 |
| ADO-23 | Exact provider/host dispatch-result causality, never similarity search | `src/external-results.mjs`; AC-143.2, AC-143.3 |
| ADO-24 | Actual selected-home verifier injection and usable provider/CLI boundary | `src/store.mjs`, `src/cli.mjs`; AC-145.1 |

The additional `notification` family remains required even though it has no
separate native Azure endpoint baseline row. Complete coverage is defined in
the [living Test Plan](test-plan.md), not by a native API inventory.
