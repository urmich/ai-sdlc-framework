# Technical Design: Thin GitHub product boundary

## Binding and current design status

This maintains the existing `github-integration` Technical Design for
`wi-github-integration` on `github-integration/trusted-adapters`. The
[Requirements](requirements.md) and [one living Test Plan](test-plan.md) define
the current release: 12 requirements, 50 ACs and 133 core execution cases.
Historical approved snapshots and actual prior evidence stay in their ledger
references; this maintenance grants no new approval, completed stage,
case-level validation or receipt-bound Review completion. The living Test Plan
records current canonical case statuses and exact evidence separately from
historical local regression and review assessments.

The target is the whole framework product with a smaller provider boundary,
not a repository/run parser detached from Requirements, tests, design,
implementation, Review and delivery. Preserve all 24 Azure baseline obligations
and nine existing result families. Native operation ownership may remain with
Copilot's actual authorized tools. No exhaustive operation registry, parallel
native-capability ledger or administration SDK is required for this release.

The runtime cut is complete for its owned boundary: seven nested modules and
28 public facade exports. The previous frozen cut milestone's Windows/Linux profiles, the
453-test retained-boundary/all-nine-family selection, 33 Windows regressions,
19 native Linux IAM/claim checks and reproducible isolated package gates passed.
The final native-launcher Windows regression passed 1,180 tests with zero
failures and 27 skips among 1,207 tests. Its frozen source/package identity was
reverified unchanged, and built-in GPT-6.1 Sol/max re-review returned
**NoBlockingFindings**.

That assessment closes active-ID protection, cancellation including rejected
IAM, ordinary-error/in-flight claim cleanup and bounded-reader/test-contract
repairs. Exact evidence and historical outcomes remain in the
[living Test Plan](test-plan.md). Complete canonical case acceptance,
receipt-bound Review completion, user approval and external authority remain
separate; neither the source cut nor the clean assessment grants them.

## Instruction and evidence correction

Apply the authorized correction to `assets/instructions.md` and the existing
knowledge-retrieval, coding and testing guides. The persistent entry points
require authoritative retrieval after resume/compaction; focused guides bound
discovery, separate checkpoint gates, capture evidence from the first run and
define comparison, invalidation, reset and replacement explicitly.
Historical execution records stay immutable. Current case/checkpoint projections
lose credit when required inputs change or applicability is unknown; exact
whole-candidate and fresh full-checkpoint contracts remain controlling.

Use existing reporting, storage and installation paths; no second evidence
system or new runtime recovery subsystem is introduced. Existing hook-driven
orientation invalidation and current-token checks detect stale orientation
but do not attest guide reading, comprehension or reliable host reminder
delivery. Instruction/installation regressions and the unchanged local
checkpoint validate the current packaged guidance.

The only coupled test-helper repair removes a shell-specific exit-code
assumption from T-51. Prove allowed Node lookup first and check npm absence with
portable shell control flow, while retaining the real OS-bound network and
direct-npm negative controls. Preserve the original failing execution.

## Actual retained module ownership

All nested modules below are under `src/github/` and are exposed through the
explicit `src/github.mjs` facade. The exact 28 public names are listed in the
[integration guide](../../integrations/github-adapters.md); internal exports are not extra
public facade contracts.

| Retained module | Responsibility |
|---|---|
| `connection.mjs` | Explicit branded connection, selected API/token/scope profile and host-owned credential contract |
| `execution-adapter.mjs` | Exact run/attempt link normalization and explicit process-local adapter registration |
| `host.mjs` | Six-callback host construction, selected-home Store, legacy operation wrapper and independent IAM/cancellation guards |
| `repository.mjs` | Exact hosted repository and selected checkout/URL/ref observation normalization |
| `schemas.mjs` | Stable repository scope, ID/node/ref/revision/connection/web-URL validation |
| `store-bridge.mjs` | Existing six-verifier Store wiring, atomic claims, nine-family result admission and read-only reconciliation |
| `transport.mjs` | Explicit bounded request/capture binding, pagination, origin/scope/profile and acquisition safeguards |

The public boundary contains no native registry, native execution evaluator,
domain operation factories or control-plane helpers. Needed core validation
catalog/evidence storage remains provider-independent; it is not a native
capability registry or a second provider result ledger.

## Responsibilities and data flow

| Owner | Contract |
|---|---|
| Copilot / trusted host | Retrieve applicable instructions and exact source facts; use actually authorized provider tools; own connections, credentials, scheduler, acquisition and external dispatch |
| Thin public GitHub boundary | Direct repository/execution normalization and bounded transport; manually supplied trusted verifier closures provide PR/check/result/artifact/delivery proof through existing consumers; explicit registration only |
| Existing Store / CLI / consumers | Canonical selected home, six verifier contracts, exact member/source/candidate/spec/config binding, authority accounting, atomic dispatch claims, durable results/currentness and recovery |
| User / actual host and provider controls | User governs scope/stages and consequential actions; real host/IAM/provider controls enforce execution permissions |

1. Ground the current task in exact selected source and registered canonical
   artifacts, keeping current maintenance separate from historical approval.
2. The trusted host obtains minimum sufficient provider/producer observations
   using actual authorized tools and a declared connection/version contract.
3. The public boundary validates independently acquired identity and source
   joins, then returns only existing verifier/result shapes with safe references.
4. Store admits those facts against exact current context. Offline CLI input
   cannot supply executable code or create its own evidence.
5. For an independently authorized effect, prepare exact intent and atomically
   claim the actual invocation/call before host dispatch. Admit only what the
   causal reply and necessary supported readback prove.
6. Carry exact context/results into Review/readiness and separately authorized
   delivery; reconcile interrupted effects read-only.

Importing/constructing the public boundary performs no credential lookup,
network call, adapter registration or provider effect. Host registration is
process-local and explicit; duplicate registration fails. Pure normalization
does not read ambient state or manufacture request provenance.

## Existing six-verifier interface

Use existing signatures and accepted fields, not new generic repository
objects or a descriptor catalog. The consumer remains the schema authority.
`createGitHubHost` takes only `connections`, `clock`, `identifier`, `authorize`
and `verifiers`. Optional connections are original branded
`{connection, transport}` pairs. The six manually supplied verifier closures
own actual authorized acquisition/verification; missing callbacks reject
explicitly instead of returning default successful observations.

The host exposes `storeOptions`, `legacyOperations`, `adapterContract` and
`missingVerifiers`. `legacyOperations` contains `prepare`, `claimDispatch`,
`recordResult` and `reconcile`, not native read/execute/catalog methods.

| Store verifier | Input / verified output obligation |
|---|---|
| `verifyRepository` | Existing `{provider, adapterObservation, localRepositoryPath, remoteRepositoryURL}` acquisition context; independently prove canonical checkout, exact selected URL, provider/connection/repository and acquired branch facts. Fetch/push selection remains the consumer's exact guard. |
| `verifyPullRequest` | Existing repository/acquisition context; independently prove exact PR, base/head repositories/URLs/refs/revisions/state and observation identity. Source/fork evidence is separate, not copied from expected context. |
| `verifyCheckResults` | Existing `{identity, status, evidenceReference, adapterObservation}`; match identity/status/evidence and bounded actual producer/tested-revision/PR/head/base facts. No raw job arrays or arbitrary provider payloads. |
| `verifyOperationResult` | Existing `{operation, observedResult}`; return the exact operation-bound dispatch/observation and supported `executionContext` only. That context is independently proven provider/connection/scope/definition/attempt capability, not copied expected/result data. |
| `verifyArtifact` | Existing `{operation: producer, observation: producerObservation}`; establish actual immutable artifact, checkout/repository/source/configuration/producer/run/attempt/retrieval/byte identity under core validation. |
| `verifyProviderVersion` | Preserve actual version-verification signature/schema. Verify the selected operation's supported profile and response semantics, not any arbitrary version string accompanying success. |

The in-process host returns an actual `Store` for the home selected by
`runCli(..., {createStore})`; it must not substitute an ambient/default home.
Repository JSON holds declarative selectors only. The ordinary `bin/sdlc.mjs`
dispatcher has no provider verifiers and stays offline. Actual authorized
acquisition and issued proof cannot be reconstructed by deserializing captures
or echoing expected identity from input.

The existing `claimOperationDispatch` boundary is one atomic transaction over
the exact prepared operation and invocation, trusted host call, selected member,
current source/candidate/spec/configuration and action authority. Do not split
it into mark-dispatching followed by an independent claim. This is bookkeeping,
not external permission; the actual host and provider must also permit the call.
The host wrapper requires `authorize(operation) === true`: absent or non-true
IAM authorization rejects. It checks cancellation before authorization,
when awaited authorization rejects and again after successful authorization,
before the bridge's atomic claim. The host reports a fixed `AbortError` without
reading or retaining private signal reasons, causes or getters.
Non-cancellation authorization errors remain explicit and unchanged.
Preparation protects the shared record namespace:
an operation ID cannot replace an active conflict, cycle or approval event;
active non-operation IDs reject before operation-history lookup. The
host rejects simultaneous claims for the same Store operation without changing
the successful claimant's durable state. An in-flight claim guard is released
on completion or failure; the durable atomic claim still prevents redispatch.
The original preparation is host/Store-bound; the caller performs a separately
authorized physical effect only after a successful claim, propagates the
exact call binding and retains uncertainty. No host method automatically
dispatches or retries a provider mutation.

## Evidence identities and currentness

| Context | Required independent facts / prohibited shortcut |
|---|---|
| Repository / source | Canonical checkout, stable hosted repository identity, exact selected fetch or effective push URL, full selected ref/revision; no guessed alias equivalence |
| Candidate / artifacts | Actual source/content, current configuration/spec/cycle and canonical artifact content identities; document labels do not create approvals |
| PR / forks | Independent base/head repository/URL/ref/full revision and exact PR; fork source cannot borrow base proof |
| Check / execution | Repository/workflow/run/distinct attempt, job/check/producer link, actual executed checkout and selected tests; head metadata/name/SHA coincidence is insufficient |
| Artifact / release | Immutable artifact ID/version, exact producer/run/attempt/source/configuration and independently supported byte digest/context; tag, release name and signed retrieval URL are not provenance |
| Deployment | Actual deployment/environment/target, selected artifact and matching candidate/configuration/test outcomes; gate approval is not deployed success |

Mutable facts need current trusted acquisition/sequence and existing
compare-and-set/currentness guards. Context changes, delayed results, revoked
authority and archived producers prevent current admission while retaining
history. Time/name/body similarity cannot turn old evidence into a fresh proof.
Absence requires a supported complete scoped observation; inaccessible, empty
restricted results or present-day inventory cannot establish historical absence.

Verify human-facing run/attempt pages independently from API status polling.
The final accessible page must match exact execution/attempt; login/API pages,
unsafe URLs and identity-changing redirects reject. Status polling can continue
despite a link-proof gap when actual scheduler/read capability exists.

## Nine result families, without a second provider ledger

| Existing family | Admission contract | Refused stronger inference |
|---|---|---|
| `execution` | Exact causal repository/workflow/run/attempt/source/candidate/configuration and proven state | Accepted dispatch or similar run is not completed selected execution |
| `test` | Actual selected test/outcome/producer/checkout/candidate/configuration and required artifact/deployment context | Green run/check name/report upload is not selected test success |
| `artifact` | Exact immutable artifact/producer/attempt/source/configuration/bytes provenance | Name, cache hit, mutable alias or null digest is not provenance |
| `deployment` | Exact selected artifact/candidate/configuration/environment/target/deployment plus required target tests | Gate approval or creation/status alone is not completed validation |
| `pull-request` | Causal exact requested PR/head/base/destination/state result | Similar PR discovery or readiness label is not completed effect |
| `git-ref` | Exact authorized destination/full ref/revision and proven publication/deletion | Local commit or unconfirmed push is not remote resulting state |
| `merge` | Exact PR/head/base/method/expected head and terminal merged revision | Test-merge, auto-merge enabled or pending response is not merge |
| `policy` | Exact separately authorized target/version/requested applied policy effect | Provider permission, configuration existence or green CI is not bypass/merge authority |
| `notification` | Exact causal publication result to selected target | Comment/thread/subscription is not personal delivery/read proof |

Every family has actual consumer P/N/G/D cases C08-C16. The boundary does not
force unrelated data into a family merely because an API exists. Relevant
release/version/asset observations supplement artifact and operation context;
release and deployment completion require their exact supported effect proof.
No generic release/registry restore or security administration facade is hidden
behind that requirement.

Pin the actual acquired API/schema/tool contract. If a supported dispatch
response identifies an exact run, retain that causal association and reconcile
that run. A legacy empty acknowledgement establishes acceptance only without
additional supported association. Never search event/ref/SHA/time to invent a
causal run or redispatch because evidence was not found. Pending/failed/limited/
uncertain observations stay distinct from completed successful effects.

For missing artifact digest/attempt metadata, acquire supported independent
producer and retrieval evidence instead of filling fictional provider fields.
Downloaded-byte hashing establishes those bytes, not their expected producer.
Ephemeral archive URLs remain private retrieval context, not persisted identity;
do not forward authorization to an unrelated redirect origin.

## Grounding, stage handoff and delivery

Requirements ground exact intent and DoD; the living plan defines observable
proof; design selects only necessary components; implementation preserves those
contracts. Each handoff carries selected source/candidate/configuration and
canonical current artifact identities, with approved snapshots kept distinct.
Retrieve relevant authoritative content before dependent mutation and use the
current context acknowledgement for managed credit. Missing or rejected
bookkeeping cannot create consent and does not turn an advisory stage into a
host execution veto.

Explicit user stage overrides proceed under normal host permissions. The
framework's approval/evidence ledger remains truthful: no inferred approval
from source text, labels, review outcomes or successful commands; no transfer
of Coding authority across branches.

Publication resolves the actual push destination and existing PR first. Ordinary
push permission is not force-push/ref deletion; Review, provider approvals,
checks, policy and merge permission are independent. Preparation or a provider
read cannot authorize the next effect.

Build/test/artifact/release/deployment context follows exact selected bytes and
candidate, not a mutable name. Local success grants no DEV execution. Current
DEV completion precedes STAGING recommendation, separate promotion authority
precedes STAGING execution, and current STAGING completion precedes PROD
readiness. PROD remains a recommendation, never automatic execution.

## Recovery, privacy and monitoring

Use the existing Store locks, atomic persistence, authority consumption, retention
and fault-injection conventions. One one-shot claim can produce one dispatch.
Provider mutations are not rolled back by a local transaction or AbortSignal.
Failure before persistence leaves an unclaimed preparation; interruption after
the persisted claim leaves an uncertain effect requiring read-only reconciliation.
No assumed universal provider idempotency key or hidden retry path is added.

Preserve the 262,144-byte active-record budget during observation replacement.
Before replacement writes, reclaim only durably archived observations obsolete
in both original and pending dependency snapshots. Original current heads and
dependencies stay intact; Store checks the actual remaining durable pre-removal
peak under the same lock. Interrupted reclamation preserves historical bytes
and the unchanged checkpoint. A changed recovery-guard owner during bounded
reading remains lock contention, never confirmed dead ownership.

Bounded file reads permit at most two additional confirmations for settling
metadata, returning the original bytes only after a stable pass. Every pass
requires unchanged content, device/inode and size; mutations are not retried.
Continued metadata churn still fails explicitly, and named-path/symlink and
byte-capacity checks remain intact.

Real Store transactions reuse their verified bound operation history. A custom
Store's existing archival callback still triggers result revalidation after
its awaited lookup; independently verified execution context is snapshotted
before that lookup. Neither path admits reused causal proof or caller JSON.

Retain exact operation/call commitments and supported result association as
bounded safe references. On restart, reconcile exact known handles using actual
authorized sources; serialized private references are not fresh proof. Lost
evidence, revoked permission, stale context or missing causality remains a gap,
not a success-shaped fallback or permission to repeat a mutation.

Protect data at acquisition before output/persistence. Raw provider JSON,
credentials, response/error causes, logs, private handles, user paths and signed
retrieval URLs are not published canonical evidence. Keep required safe stable
identity and sanitized references, with private values host-owned. Unsupported
input/profile, permission denial, inaccessibility, stale/conflict, missing proof,
integrity failure, provider failure and uncertain effect remain distinguishable
through repository-standard safe diagnostics; do not expose arbitrary causes
or evaluate thrown getters to classify errors.

Monitoring uses actual authorized read tools and the host scheduler for immediate
attachment and subsequent 60-second polling of exact run/attempt/source. Page
verification is independent. Retain reported/triggered origin, interrupted
ownership, terminal notices and explicit capability gaps. The offline ledger
cannot poll after its host stops; observation never grants action authority.

Cleanup awaits exact owned resources and specific process IDs. Cancellation
after dispatch cannot claim provider rollback. Cleanup failure remains explicit
without hiding the primary failure or deleting caller-selected directories.

## Acceptance and integrated package boundary

The plan's denominator is 88 core P/N/G/D cases plus 36 local boundary/gates,
one built-in Review, four CI and four authorized read-only cases. It maps every
AC, all 24 Azure IDs and every existing result family. Removed administration
surfaces do not count as omitted core tests; required baseline consumers do.
Readiness, implementation mapping, execution status and evidence are separate.
Every new candidate's results start `NotRun` until actual matching validation.

The plan uses one existing-format canonical definition/status table with 133
full IDs, explicit execution metadata and FR/AC traceability. Assertion tables
are descriptive only, so the parser cannot count prefixes or duplicate rows.
Read-only parser/catalog validation does not create a cycle or test evidence.
The installed runtime's current 100-definition cycle cap remains a compatibility
gap for this complete plan; the worktree's referenced-catalog path supports
the full denominator. Do not truncate it, update the active install or mutate
a cycle merely to obtain schema acceptance. Exact local selectors and separate
gate procedures are now retained in `acceptance-bindings.json`. Native event
reports and unchanged candidate/specification/configuration establish individual
outcomes; existence, source inventory and broad totals do not award case credit.

Preserve the fast **16-case**, not 16-file, profile. After every implementation/
test/configuration fix, restart unit-first local validation: `test:unit`, complete
retained `test:targeted` selection, full `npm test`, `check`, `package:artifact`
and `verify:package`, plus applicable existing platform checks. Preserve original
Azure/offline/storage/recovery regressions and exact discovery/skip accounting.

The normal built-in `/review` uses current GPT-6.1 Sol/max after required current
pre-review evidence. No additional compulsory per-stage review/fanout is added.
Blocking findings return to Coding and fresh validation. Actual Review evidence
and captured user confirmation remain distinct from publication/remote authority.
CI and live evidence are separately source/run/attempt-bound and authorized.

Packaging must expose the 28-export facade and include the exact seven nested
runtime modules, then exercise both npm and isolated installed
consumers on the selected canonical home. Missing required modules must fail
preflight before replacing owned installed content; imports/constructors remain
side-effect-free. Preserve existing update/ownership/purge/storage behavior,
Node >=22 portability and no third-party runtime dependencies.

Retained direct test surfaces are identity-foundation, transport,
operation-results, existing-consumer-boundaries and packaging under `test/`.
The living Test Plan names their exact existing paths; test/fixture adaptation
must preserve six-callback, nine-family, selected-home, authority/cancellation,
currentness and recovery assertions. Excluded native tests are removed, not
skipped. Parent-owned wiring removes obsolete native backend exports/callers
while preserving core validation catalog/evidence. The parent binds actual
final selectors and integrated package results; all current plan outcomes stay
`NotRun` until matching validation. Source inventory is not acceptance evidence.
