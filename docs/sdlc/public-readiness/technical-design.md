# Technical Design: Public repository readiness

Status: 2026-10-20 policy revision; implementation is in progress under explicit
user direction. No frozen-candidate validation or live enforcement is claimed.

**Current maintenance context:** This historical Draft header predates the
subsequent explicit Coding approval recorded in the
[Requirements maintenance context](requirements.md).
The approved design baseline SHA-256 remains
`80267eccce7a0901af23d61ccce8bb0581f4408dd8ef476c6939245914560be6`.
Source implementation exists across the collaborating owner slices.
Current execution credit comes from the declared checkpoints and retained
native/public/provider proof, not this header. Maintenance updates references
without rewriting approved snapshots.

## 1. Design summary and boundaries

Implement [FR-200 through FR-215](requirements.md) against the
[living Test Plan](test-plan.md). Its approved baseline is the 91-case plan
SHA-256 `e7a52a2d93aa42e55a0d205ad95704ca59c062ade4ec650b509a22d79c634ed4`;
the approved requirements baseline is
`8311068e1a75ba4e08fda5331f24baf99f47db06cd86743666aa0f49d985cdea`.
The detached-CI/managed-credit boundary adds the focused test T-PRD082 to the
same living plan. Subsequent user-directed coverage-format/authoring
clarification adds AC-213.15/16 and T-PRD083/084. Existing approvals and their
snapshots are not rewritten.
The October 18 revision replaces the proposed tracked coverage index with
PR-description metadata and adds FR-214/T-PRD085/086 for this repository's
mandatory guardrail only. Consumer CI/CD policy remains the consumer's choice.
The October 20 revision replaces the broad local gate with finite sanity
membership, requires capable PR placement for non-local code tests and adds
dependency/resource-aware logical-group execution plus professional structure
regressions. The living Plan now preserves the original 96 cases and adds
T-PRD087/088/089, covering the current 94 ACs. The earlier approved snapshots
above remain historical; user-directed implementation and Test Plan maintenance
do not fabricate new managed approval or passing execution records.

The solution has five cooperating parts:

1. A complete declared test/utility inventory, critical local profile and
   process-isolated scheduler with mandatory execution reconciliation.
2. Framework-native normalization, immutable execution evidence and profile
   readiness, usable without GitHub or an interactive Copilot session.
3. Unprivileged native PR producers plus a separately trusted metadata/evidence
   observer and actual provider merge controls.
4. One maintainer-started release that validates, freezes, publishes and verifies
   the same artifacts automatically, including one shared Mac archive.
5. Topic-organized reader documentation and migrated canonical SDLC artifacts,
   preserving installed-path contracts and historical evidence.

Keep the shipped framework Node >=22 and dependency-free. No new service,
database, GitHub App, long-lived npm credential, hidden alternate registry,
OS-policy workaround or second evidence ledger is introduced.

This design does not authorize Coding, repository settings, branch publication,
live provider probes, npm trust changes or a release. The installed 0.4.0 home
and published 0.4.0 assets/tags are never implementation or test mutation targets.
Tests of product review/approval behavior remain in the Test Plan; performing
our development reviews remains outside its test inventory.

## 2. Grounded starting interfaces

| Existing boundary | Reuse and necessary extension |
| --- | --- |
| `scripts/test-runner.mjs` / `test-worker.mjs` | Preserve public unit/targeted/full/coverage commands, Node `test.run`, file-process isolation, cancellation IPC and nonzero outcomes. Extend profiles, declarations, scheduling and durable producer output. |
| `src/artifacts.mjs` | Reuse canonical artifact identities, `parseRequirements`, `parseTestPlan`, specification digests and complete registered-plan composition. Status/evidence projections remain distinct from definitions. |
| `src/validation-catalog.mjs` | Reuse bounded content-addressed objects, complete case catalogs, traceability and verified object reads. Do not introduce another mutable catalog/status database. |
| `src/validation-evidence.mjs` | Reuse sanitization, retained execution payloads, original-byte digests, assertion outcomes, immutable source/reset bindings and history reduction. |
| `src/validation.mjs` / `authority.mjs` | Preserve `recordTests`, managed-cycle admission, currentness and `stagePassed`. Extract shared pure admission/currentness rules for detached CI evaluation rather than relaxing lifecycle authority. |
| `Store` and existing trusted hosts | Preserve all six existing verifier signatures, selected-home binding, locking, operation claims and reconciliation. New evidence verification is a host-supplied in-process capability, never a JSON function/boolean. |
| Platform packaging/runtime | Extend readers for a shared Mac manifest while retaining legacy readers and Windows PE integrity. Separate archive targets from execution-platform variants. |
| `release-bundle`, `release-gate`, `npm-handoff`, protected publisher | Preserve exact-byte identity, data-only OIDC publication, mandatory gate admission and immutable handoffs; replace fragmented/manual sequencing. |

All names described below as **proposed** are new interfaces to implement, not
methods claimed to exist in 0.4.0.

## 3. Components and implementation locations

| Responsibility | Proposed location / change |
| --- | --- |
| Consumer validation policy | Caller-supplied configuration and the consumer's existing chosen CI/configuration interfaces. No new coverage/policy sidecar is generated and no CI policy is installed implicitly. |
| Executable assertion bindings | Canonical Test Plan selector/procedure fields and explicit declarations in existing test sources. Preserve finite variants/source identities without a separate generated binding file or duplicated requirement prose. |
| PR coverage metadata | One versioned, machine-readable section of the PR description, prepared in memory from canonical definitions. No additional coverage/index file is committed or required. |
| Native authoring/inspection | Extend existing phase skills, templates and focused guidance; ship the metadata schema/example with the framework. Proposed `coverage prepare/inspect` and the extended existing `check artifacts` share normalized definitions and validation helpers. |
| This repository's guardrail | Proposed `.github/workflows/coverage-metadata.yml` and a thin repository CI adapter invoke the shared checker and publish required `framework/coverage` status. Not installed into consumers. |
| Inventory compiler and scheduler | Extend existing runner; small development-only helper modules under `scripts/` where a separate responsibility warrants one. Keep parsing/normalization independent from dispatch. |
| Generic evidence/readiness | Proposed `src/validation-readiness.mjs`; shared predicates/reducer extracted from existing validation modules, not copied into a GitHub-only implementation. |
| Readable/machine report projection | Proposed `src/validation-report.mjs`, producing both views from one evaluated result without storing another authoritative status. |
| Public package API | Proposed `ai-sdlc-framework/evidence` facade with normalization/evaluation/bundle functions and existing retain/read/record operations. Existing exports stay compatible. |
| CLI surface | Existing `evidence retain/show/tests` stays supported. Proposed `readiness evaluate/report` exposes offline evaluation; verification gaps are explicit, not trusted input flags. |
| Repository CI adapter | Reviewed scripts under `scripts/`, consuming the same public framework API. Provider acquisition and token ownership stay outside the offline core. |
| Trusted PR observer | Proposed `.github/workflows/pr-readiness.yml`; trusted default-branch code, metadata and bounded JSON only, no candidate execution. |
| PR policy refresh | A small read-only workflow for supported PR review events; it wakes the trusted observer, not grants approval. |
| Release consumers | Refactor existing native/generic helpers; retain one source of packaging/lifecycle truth rather than separate test and release installers. |

Avoid a general orchestration/plugin framework. Adapters are explicit trusted
code with narrow data contracts. Existing consumer validation behavior and
CI/CD remain unchanged unless the consumer explicitly adopts an integration.
Unknown metadata schema versions are diagnosed without deleting existing data.

## 4. Complete inventory and local execution

### 4.1 Two levels of identity

Distinguish logical planned cases from executable assertions. A single planned
case such as a complete native lane can require many Node/Go/Python assertions.
Report both counts; the plan's 91 baseline entries are not the complete Node
assertion denominator.

A required execution key comprises:

| Field | Meaning |
| --- | --- |
| Plan artifact identity and test ID | Stable requirement-facing case, composed through existing registered plans. |
| Assertion ID and selector | Stable executable identity, with file/tool, fully qualified test name and declared variant. |
| Profile and platform variant | Local, PR, R-PRE, R-POST or acceptance; native architecture is explicit. |
| Definition/source identity | Expected assertion/fixture digests and independently established tested content. |
| Requiredness/applicability | Determined by the trusted plan/policy, never by the producer's skipped result. |

Bindings may relate one actual assertion to several ACs, but each logical
case passes only when all its required assertions pass. Parent-suite success
does not replace missing leaf/subcase outcomes.

### 4.2 Declaration and discovery

Use explicit declarative bindings plus actual runner registration/completion
events. Do not claim regex or arbitrary JavaScript evaluation can statically
discover every possible dynamic subcase.

The compiler checks all current test files and shipped executable surfaces
against source-bound bindings before a substantial run. Existing finite
parameterized cases declare their input domain and expected IDs; a missing
dynamic variant cannot be learned away from an incomplete execution.
Unrecognized registration shapes, new unmapped files/utilities, duplicate IDs,
stale source bindings and reduced required inventories fail admission.

During migration, establish the original assertion inventory from source
definitions and available source-bound reports; missing native-only definitions
remain an inventory gap until declared. Historical report totals alone do not
establish the new denominator. Candidate-produced observations never approve
their own expected inventory.

Observed extra/missing/duplicate cases are reconciled against declarations.
Changes to required test definitions or policy require maintainer-controlled
review/adoption; a fork cannot remove a failing test by editing its manifest.
Ordinary new tests still execute unprivileged, even while their binding/policy
change is awaiting acceptance.

### 4.3 Profiles and performance

Within one synchronous native component selection, derive its common
configuration and specification digests once after the existing definition,
lane and unit-order guards. Every case still validates its own complete context,
and every later selection and replay derives fresh values. The specification
guard rejects empty case lists before these per-operation derivations. This
changes neither serialized identities nor protocol, source, origin, freshness
or cleanup validation; it introduces no cross-call identity or verdict cache.

Preserve `test:unit`'s exact current three-file/16-case sanity contract. The named
critical profile contains those files and only the eleven exact root selectors
in the Test Plan, with their declared descendants and cheap applicable static
checks. New feature/evidence/runner/unit tests do not enter it automatically.
Membership, root/assertion count budgets and addition rationale are explicit;
source growth cannot silently redefine the finite profile. Targeted mode
continues to accept explicit filenames and escaped name patterns without globs.
Full and coverage modes retain complete discovery.

The current correction explicitly tightens the earlier candidate's alias
scheduling: logical unit/integration mixtures and integration aliases on
canonical unit files fail `MIXED_UNIT_INTEGRATION_ANCESTRY`. Same-level sharing
is allowed without duplicate execution. Approved Plan levels/assertion names
are unchanged; old source behavior is not relabelled as always having been
strict. Stage-order obligations prevent a completed unit-only projection from
displaying a Passed integration logical case.

Schedule longest measured independent groups early and balance hosted work by
recorded duration. A logical execution group is an exact source-declared root
and its complete descendant closure, unless an explicit necessary dependency or
shared-resource declaration further constrains execution. Independent roots
from one file may execute in separate owned processes; ordering among steps in
one scenario remains intact. Repeated per-process module setup is part of the
measured cost, not assumed free or immutable.

Use a bounded ready-work pool rather than a permanent worker split between
independent branches. Validate assignment completeness/uniqueness, dependency
references/cycles and resource declarations before dispatch. Prerequisites must
finish successfully; declared minimum/exclusive allocation is acquired before
timed execution. Completion releases capacity for other ready groups; failure
and cancellation block dependents without suppressing original diagnostics.
Policy v8 retains v7's admission rule: each pass stably orders pending groups by declared
`minimumSlots` descending, retaining input order for equal demand. Skip groups
with unmet dependencies, insufficient available capacity or an exclusive-resource
conflict; admit the next fitting eligible group instead of stopping the pass.
Larger eligible groups get first consideration and smaller fitting work
backfills remaining capacity. This preserves AC-202.6's dynamic shared pool,
with no idle capacity barrier, padding, extra token reservation or whole-host
exclusion. Cancellation still drains already-running work as before.
CPU/memory/resource limits and explicit validated overrides bound the pool,
and nested producers share the same aggregate budget.

The concrete development helper protocol is `enterTestBudget({ workers,
fileCount, inherited, parent, slot, control })` /
`acquireTestWorker()` in `scripts/test-budget.mjs`. A root creates one ephemeral
version-2 `127.0.0.1` broker with
`allocationPolicy: dynamic-ready-worker-tokens-v2`; nested producers inherit the same opaque endpoint,
producer and worker-slot context through `SDLC_TEST_BUDGET`,
`SDLC_TEST_BUDGET_PRODUCER` and `SDLC_TEST_BUDGET_SLOT`. The endpoint key is private
job-local coordination data, never public evidence or action authority.

`begin` clamps requested workers to the ancestor/host allocation. A nested
producer yields its parent's active slot while waiting/running; the broker
borrows unique tokens from ancestor/host pools and queues work rather than
creating a fresh independent budget. Each file worker acquires a slot before
test execution. Closing/cancellation returns only owned tokens up the original
ownership stack; cancelled/closing parents cannot authorize new children.
For host budget B (1-32), active case-worker tokens stay <=B, producer and
control reservations each <=2B+1, registered/potential resident file processes
<=3B and orchestration reservations <=4B+2. Resident capacity is reserved from
the exact file count before a `test.run` controller spawns; the file preload
must acquire its token before candidate test code. All sibling nested calls
return only after their tokens are returned and the parent slot is reacquired.
This bounds test orchestration, not every operating-system process or a security
sandbox. Actual resource identities, allocation/peak counters and cleanup are
reported. A fixture needing two genuinely overlapping workers needs aggregate
capacity >=2; absent capability cannot become an overlap/timing pass.

`scheduleValidationFiles(inventory, { files, durations })` accepts only unique
declared files and actual nonnegative `{ assertionId, sourceDigest, durationMs }`
hints. A hint is eligible only for the matching current source digest; measured
parents/descendants are not double counted. Larger verified duration is first,
then retained measured priorities and deterministic filename ties. Targeted
explicit order stays caller-owned. Hosted selection partitions every adopted
assertion exactly once across canonical/required-unit/regression stages,
including recursive `.test.mjs`, `.test.js` and `.test.cjs` discovery and explicit
fixture-only exclusions with owner/procedure/reason/NotRun disposition.
`validationSchedulingPolicyDigest()` binds measured priorities, duration-hint
identity, full hosted unit-root partition, targeted order and budget protocol
version. Independent critical risk obligations are read from the existing
canonical File/Exact critical case name table, not learned from production
selector constants. `critical --affected FILE` (repeatable) /
`--affected-name REGEX` first executes all selected canonical/critical/affected
unit groups, then independent integration groups concurrently where the one
aggregate budget permits. Timing advisory/elapsed/exceeded fields never change
correctness status or declaration requiredness.
Archived native reconstruction selects the scheduling policy from the existing
authenticated `definition.sourceFiles` entry for `scripts/test-scheduling.mjs`.
The non-executing declaration tokenizer requires exact token-normalized
fingerprints for the exported protocol, priority table and complete policy
initializers. Current live execution uses literal v8; its complete budget binds
declared-demand-first ready backfill. Historical reconstruction retains
the exact v7, v6, v5, v4, v3 and v2 contracts, original file-admission budget labels
and digests. Missing,
unknown, duplicate, spoofed or computed contracts fail `EVIDENCE`. Do not
execute captured code, accept a report policy flag or try alternate digests.
Thread that source-selected policy through ordering, configuration and original
group validation without rewriting old reports or renewing historical credit.
Live capture and execution continue to require the current policy.
Historical replay validates captured definitions and reports, not the live
ready-pool runtime; retain old group IDs, order, protocol and execution records.

Split independent top-level scenarios into coherent file processes, retaining
stable case IDs. Each has unique Git/home/cache/temp roots. Do not enable blanket
same-process concurrency around environment changes, module patches, registries
or mutable shared package-manager state. A causally ordered 550-refresh retention
scenario stays ordered; moving it to another shard does not make it faster.

Read independent active and archived JSON entries in bounded batches of sixteen,
using the directory's canonical root once per scan while preserving the existing
per-entry containment/symlink checks and complete bounded file validation. Drain
all dispatched reads before yielding sorted records or exposing an ordered
failure, so a validation error or early consumer exit leaves no background reads.
Do not cache contents or infer a record's type from its filename. Size ordinary
read buffers from the observed file size plus an EOF probe, retaining the existing
growth limit and identity/content/metadata confirmation checks. Empty-check PR
fact updates use their full authoritative transaction without a redundant
preliminary history scan; monitored checks retain their association preflight.
On each fresh active-record scan, the authoritative record validator already
checks event content digests. Do not repeat that same digest calculation after
validation. Retain both the initial transaction read and persisted-record
reread before removal or commit; alteration at either boundary still fails
`DIGEST`. This reuses no record, authority or verification result between reads.
Canonical record encoding, accessor behavior, credential precedence and UTF-8
budgets remain unchanged.

Batch the three fresh Git repository-path queries into one plumbing invocation,
then retain the existing branch-before-HEAD queries and all three canonical-path
checks. Ambiguous line-framed path output uses the original individual queries.
Do not cache repository, worktree, branch or revision state between calls.
For an already bound ordinary branch, use its stored name only as a bounded
current-ref lookup hint. Git must independently mark that exact full ref as the
checked-out HEAD and return its current object ID before either fact is used.
Missing, stale, unborn or unusual hints retain the original fresh symbolic-ref
and HEAD queries; a same-commit different branch cannot qualify. All canonical
path checks still run on each call, without a cross-call identity cache.
The process-count and fresh-state regression is PR-only, outside the finite
27-assertion local sanity profile; hosted latency still needs actual native proof.
Manifest reads need the current worktree binding, not a revision value. Share
the unchanged fresh repository-path lookup and all three canonical-path checks,
then read the current symbolic branch after those checks. Do not request an
unused HEAD object ID or current-ref lookup for this binding-only guard.
Revision-bearing callers retain the complete identity queries and fallbacks.
PR-only process and controlled branch-switch regressions preserve unborn,
newly committed and same-commit branch behavior without trusting stored state.
Remote-name selection uses that same fresh binding-only guard because choosing
current fetch/push URLs does not consume a revision. For an explicit selected
remote, one native direction-specific `remote get-url --all` query supplies
existence and the complete rewritten URLs. Only Git's exact missing-remote
failure falls back to the original fresh name enumeration and selection error;
other native errors propagate. Implicit selection still enumerates names.
Repeat binding and URL reads on every call; do not cache identity or currentness.
Revision-bearing consumers retain their full identity checks.
The concurrent-revision test oracle coordinates eight real durable updates by
observed peer completion, rather than treating elapsed host I/O as a lost update.
Each contender has at most eight contention retries, and each no-progress
barrier retains a three-second bound. Drain all updates and propagate failures;
production lock deadlines, live-owner checks, durability and cleanup are unchanged.
Its PR-only regression retains a real exclusion barrier, a finite clock step
and an independently held live lock that must fail without progress.
The retention fixture's existing immutable Git-read cache also recognizes the
read-only current-ref query. Its rename regression rejects the cached old
destination and observes a fresh URL query for the renamed destination, rather
than requiring redundant name enumeration. A targeted negative control must
detect disabled rename invalidation; real commit, URL and branch-write guards
remain intact.
Writes and unknown Git commands still invalidate
all cached fixture reads. This test-only reuse does not cache production state
or replace any real refresh, archival, durability or cleanup operation.

During one `safeSummary` object/array traversal, reuse the existing pure text
transformation for identical string values. Keep that temporary map bounded to
256 entries and 64 KiB of input/output text; uncached values still receive the
complete sanitizer. Discard the map after the call, preserve the scalar-string
fast path and every redaction rule, and never cache objects, evidence or current
eligibility. Retained-payload node, depth, byte and decoded-work budgets still run
independently. The PR-only regression observes actual parsing work and checks
fresh calls, sensitive keys, high-cardinality input and oversized-text fallback.
ASCII alphanumeric/space-only values cannot match the existing scalar text
redaction markers, so return them unchanged before rich-text scans or text-map
lookup. Sensitive object keys still redact their values first. Punctuation,
control characters and non-ASCII input retain the exact existing text pipeline;
retained-payload structure, decode and byte budgets remain independent.
For JWT-shaped text, preserve the conservative overlong-header rule and exact
base64/UTF-8 decoding. A decoded header that cannot begin a JSON object after
JSON whitespace cannot supply the required `alg` field, so reject that candidate
without a failed JSON parse. Object-shaped headers retain the existing parser,
algorithm-field predicate and malformed-input handling; no token or payload
limit changes.

After fresh binding validation, issue the independent candidate Git reads
together: three index/diff/untracked queries for a dispatch stamp and those
same queries plus object-format and file-mode configuration for a full snapshot.
The bound is five read-only Git processes per member; members remain sequential.
Await every dispatched read before returning or failing, then consume results
and apply index/dirty-file capacity checks in their original order. Keep all
queries, options, exact-byte hashing, mode handling and branch/worktree guards.
This does not cache a candidate or make separate Git reads an atomic snapshot.
The overlap and held-completion failure regressions are PR-only; native
whole-platform timing remains the performance acceptance test.

Read independent small Homebrew rollback-inventory entries in bounded batches
of sixteen, preserving sorted depth-first records, modes, symlink targets and
every payload hash. Drain each batch before recursion, failure or owned recovery
cleanup. Hash initially larger-than-one-MiB payloads sequentially; small entries
use bounded streaming buffers even if they grow during capture. The scheduling
threshold is not a new accepted file-size limit.
Keep receipt validation, real backups, copy verification, locks, durable state
transitions and all channel, hook and quality commands unchanged. No captured
dependency state is cached across mutation phases.

For ordinary PR validation, use twenty-five independently required native producer
parts consuming the same frozen candidate. Intel Mac has two unit producers;
each other platform has one unit producer
and one producer containing the entire unchanged 550-refresh root. Partition
the remaining root closures across four Linux/Windows body producers and three
body producers per Mac architecture; each Mac also retains its real Homebrew
producer. Separate hosts add actual execution capacity rather than multiplying
one host's worker budget. Preserve every original root and descendant identity,
declared resource constraint and substantive native/tool/static/project stage.

Derive the exact disjoint assignment from the frozen source inventory, not the
observed part results. Require source-, platform-, job-, run- and attempt-bound
unit evidence before regression shards execute. Independently verify every
part's SDK context, complete assertion union and allocated-prefix cleanup;
missing, duplicated, overlapping or swapped parts cannot produce completeness.
The source-adopted `native-framework-shards-v4-split-intel-units` protocol uses four
explicit platform-specific unit-to-regression job groups. A platform's unit
producers must all complete successfully, including retention and cleanup, before
its own regression jobs start. Unrelated unit producers may finish later, but
overall completeness still requires every one of the twenty-five parts. The same
source-inventory file partitioner assigns extended units with a count of two
for Intel and one otherwise; complete root closures, source digests, dependencies
and exclusive resources remain intact. Canonical units and static validation
execute only on the original `units` producer; `units-1` executes only its
nonempty extended-unit subset. Both Intel unit jobs share `native-units-mi`'s
standard runner matrix, each with its own four-worker budget and prefix. No waiting
regression host is started early merely to overlap provisioning.
Preserve the original `native-framework-shards-v1` global-barrier and
`native-framework-shards-v2-platform-units` twenty-part proof and archive
semantics, and the `native-framework-shards-v3-four-body-platform-units`
twenty-four-part topology. Do not relabel their eighteen or twenty-two framework
origins as the current twenty-three.
Bind the current SDK component projection to
`native-component-projection-shards-v3`; retain
`native-component-projection-shards-v1` and `native-component-projection-shards-v2`
for their historical topologies and reject
cross-version producer counts or borrowed origins.
Under historical bootstrap v3/v2/null, all thirteen Mac producer prefixes require
distinct owned allocation and matching guarded cleanup. Bootstrap v4 instead
requires eight real owners and five nonallocation proofs across thirteen
diagnostic artifacts, as specified below; no producer may borrow another's receipt.
Bootstrap v5 requires two genuine Homebrew owners and eleven source-bound
nonallocation proofs, retaining all thirteen diagnostic artifacts and steps.
Keep default whole-native execution and release prepublication compatible.
The required logical lane span is at most 460 seconds on Linux, 665 seconds on
Windows and 627 seconds on Apple Silicon, and strictly under 1,200 seconds on
Intel macOS. Measure from the earliest required unit/framework/Homebrew worker
start through the last evidence/cleanup completion, including unit barriers,
repeated provisioning and internal queues. Intel's former fifteen-minute target
is a stretch goal. Its observation cutoff moves from sixteen to twenty minutes,
without changing command watchdogs, owned-process settlement or other limits.
Configured host fan-out, an isolated shard time or an elapsed-work estimate is
not a passing latency result; fresh complete hosted measurements are required.
Keep the existing observation refresh/regression and observer priorities first.
Under implicit policy v8, preserve v7's existing higher-priority prefix: CI-input and retained-evidence
families next, then prioritize provider consumers, reproducible packaging,
facts/archive recovery, distribution lifecycle and runner probes, in that order,
where those files belong to the selected shard, before shorter families.
Distribution stays ahead of runner probes because its measured long roots are
longer; this ordering is a lead, not a predicted latency gain.
File/group selection metadata is unchanged. Parallel admission considers
declared demand first, so strict actual start order across unequal demands is
not promised; equal-demand ties retain the input order.
Preserve the relative retained-identity acceptance, catalog, native
WinGet launcher and joined release-report prefix in shards that own those files.
Place PR-description work immediately after that prefix, before shorter families
on its same source-assigned shard. Its real ready-pool regression retains the
five-slot nested participant, live four-slot guard, explicit caller-order
negative control and every isolated outcome/cleanup; no worker allowance grows.
The catalog's independent long root can use the three remaining ARM slots while
the retained guard reserves four of the existing seven. Retain the complete
38-assertion closure, callback ordering/concurrency and every catalog root.
This changes neither host capacity, shard ownership nor explicit targeted
caller order. Actual overlap and whole-lane improvement require native proof.
Policy v8 changes only this source-adopted file-priority entry and retains v7's
demand-first admission, declared minima, workloads and shard ownership.
Historical v2-v7 identities and captured-source replay remain unchanged.
It does not cache cold Go builds, prune lifecycle/failure probes or alter assertions.

The PR workflow uses five Linux read-only allocation coordinators under
`arm-regression-allocation-v6-all-critical-bodies-first`. After ARM's own unit barrier,
`mac-admission` observes its three long body workers before releasing Intel's
measured critical body-0 producer, still behind both Intel unit jobs. The
`intel-retained-admission` coordinator observes that actual worker before
releasing ARM's separate short refresh, which retains its own ARM unit barrier.
The coordinator retains its historical job/artifact identifier, while its
current closed `intel-primary-body` group requires body-0 allocation.
Then `arm-refresh-admission` observes the refresh worker before Intel body-1
and body-2 become eligible, retaining both Intel unit jobs and no Homebrew
dependency. ARM's genuine Homebrew producer retains its initial schedule.
The existing `intel-homebrew-admission` coordinator now observes allocation
of all three Intel bodies through the closed `intel-bodies` group before
releasing Intel's genuine Homebrew producer. This lets eligible critical bodies
take available Mac capacity first, without reserving an extra VM or waiting
for a body to finish. `intel-admission` independently observes those same
allocations before releasing the separate short Intel refresh. No gate waits for a Homebrew command or any
producer's completion. Native part names, recipes, assertions, retention and
cleanup remain unchanged.
A queued `started_at` placeholder is not allocation evidence; a runner or
started step is required. Completed allocated parts also satisfy admission; no stage
waits for its allocated parts to finish. Each helper invocation selects only
the closed `arm-bodies`, `intel-primary-body`, `arm-refresh`,
`intel-homebrew` or `intel-bodies` group. The historical `arm-regressions`
group remains the default for existing callers. Current v6 and historical v5
use `intel-primary-body`; historical v4 retains `intel-retained-body` and its
original body-1 receipt semantics. Preserve v5's original Homebrew-allocation
dependency only as historical v5, never relabel it as current v6.
Retain the exact historical v1-v5 resource graphs and unmarked native v1-v4 replay rather than
silently adopting new dependencies.
No coordinator occupies a Mac VM while waiting or adds a native producer
part. The policy does not change the twenty-five-part assertion union,
architecture coverage, resource allowances or command watchdogs. Their
same-run metadata reads use ephemeral read-only CI tokens, bounded polling
and complete pagination;
identity mismatches, unavailable reads and incomplete allocation fail explicitly.
All five gates are included in producer completeness. Bind the split ARM
refresh, Intel retained body, Intel refresh and Homebrew cleanup receipts to
their actual selected-source job identities;
stale historical job IDs cannot supply current proof. An admission receipt
proves allocation only, not native correctness or latency.
Release prepublication and default whole-native execution remain separate and
unchanged. Fresh complete hosted measurements still decide delivery success.
This prioritizes owned work within the existing shared pool; it does not claim
that Intel Homebrew is the only provider bottleneck or erase provisioning gaps.
The existing Homebrew command trace also records a monotonic `elapsedMs` for
each awaited subprocess, including rejected commands. This measures service
time, not surrounding snapshot checks, bootstrap, evidence retention or cleanup.
Retain those costs in whole-lane timing. No command, order, watchdog, assertion
or fresh keg/receipt verification is changed or cached by this diagnostic.

Reuse only verified immutable fixture inputs such as an unchanged payload
build. Keep transactions, durability flushes, lock races, archival and cleanup
real. Any runtime optimization of repeated reads/indexing must preserve revision,
containment, invalidation and crash guarantees and receive its affected regression
coverage. Do not add a test-only switch disabling fsync or reducing stress limits.
When a purge lock's owner file changes during its bounded read, treat the
unresolved concurrent owner as `LOCK_BUSY`, not as permission to remove the lock.
Preserve owner bytes and runtime contents without retrying or weakening the
lock's durability and exclusion guarantees.
Setup-only Windows-launcher consumers may copy the already source-verified
frozen native candidate. Require its exported byte digest, matching execution
source and owned regular-file paths; read and hash each input again and write
only a fresh owned fixture copy. Transport the verified source context through
the dedicated launcher-fixture environment channel, not the reporter context
that isolated test dispatch removes. Invalid supplied inputs fail rather than
falling back. Without prepared input, retain the real pinned builder. Actual
Go tests, vet, native launcher execution and independent cold-cache rebuild
comparisons remain unchanged.

Within one evidence-sanitization traversal, repeated pure text validation may
reuse bounded work while preserving every field-specific constraint, secret
handling rule and byte/node budget. The scope ends with that traversal: no
origin verification, admission, freshness decision or report verdict is cached
or shared with a later call.
Text without literal object/array fragment delimiters avoids duplicate fragment
discovery, while retaining the existing scalar redaction and validation path.

All platforms use the same deterministic priority and dependency-aware ready
pool. Schedule the measured native-observer unit tail before shorter fallback
files instead of leaving it near the end of the unit queue. Preserve explicit
targeted caller order, complete assertion membership, causal dependencies,
exclusive resources and shared worker tokens. Hardware-specific timing and
capacity remain measurements, not a reason to change the test semantics.

The historical source-bound `native-bootstrap-role-capabilities-v3` declaration selects
bootstrap requirements from the exact captured role/profile. Its PR
framework producers use the pinned native Actions Node runtime. Their Mac
bootstrap still provisions real pinned Homebrew/core/portable Ruby in its own
owned prefix, but does not pour Homebrew Node or synthesize bottle receipts and
`nodePrefix` evidence. The refresh-only producer's complete source-selected
root uses Node, Git and filesystem operations, so v3 omits unused Go, CPython
and schema acquisition, facts and version reports for that role only. All
other v3 roles retain their actual pinned Go/Python requirements. Genuine Homebrew
producers, whole/full validation and R-PRE retain complete bottle, Homebrew Node,
quality, lifecycle and cleanup requirements. Historical v2 retains actual Go/Python
requirements for refresh, and a missing declaration retains full-bootstrap
semantics. Bind the capability and required tool inventory into captured
definitions, configuration digests, protected admission and actual reports.
Missing required reports, invented absent-tool facts and role/protocol
mismatches fail rather than downgrade.
V3 retains all twenty-five producer origins and thirteen distinct Mac cleanup
owners. V2 and null declarations retain their original topology and requirements.

The distinct `native-bootstrap-role-capabilities-v4` contract keeps the same
twenty-five origins, twenty-three framework parts and two genuine Homebrew parts.
Every unit producer retains real pinned native CPython for standard-library
consumer execution, including conservative provisioning on unit partitions that
do not currently call Python. Unit producers omit unused Go, Python schema
packages and Mac Homebrew/core/Ruby/prefix acquisition. Refresh retains Node,
Git and filesystem execution without those unused tools or a prefix. Body,
genuine Homebrew, whole/full and R-PRE requirements are unchanged.

V4's closed boolean tool requirements are derived from captured source protocol
and the validated role, bound into configuration, SDK capture/replay and protected
admission. Required Python runtime facts and original probes remain mandatory;
omitted tool/schema/prefix facts and receipts must be absent, never synthesized
as Passed. All thirteen Mac cleanup diagnostic artifacts and steps remain:
eight own real distinct prefixes (six bodies and two genuine Homebrew producers),
while five carry exact source/run/role-bound nonallocation requests without
allocation or removal receipts. Historical v3/v2/null digests and real ownership
requirements do not acquire this exception. No assertion, causal root, stress
boundary, shard assignment or worker policy changes with this setup optimization.

The distinct source-selected `native-bootstrap-role-capabilities-v5` removes
only setup that has no semantic consumer in the complete selected closure:

| Producer on the current source | Go | CPython runtime | Schema packages | Brew/core/Ruby/owned prefix |
| --- | --- | --- | --- | --- |
| Every framework `body-0` | Required | Required | Required | Not required |
| Linux/Windows `body-1` and `body-2` | Not required | Required | Not required | Not required |
| Linux/Windows `body-3` | Not required | Not required | Not required | Not required |
| Both Mac `body-1` and `body-2` | Not required | Required | Not required | Not required |
| All current unit partitions | Not required | Required | Not required | Not required |
| Refresh | Not required | Not required | Not required | Not required |
| Genuine Homebrew on both Mac architectures | Not required | Not required | Not required | Required |

The implementation follows the existing source-selected root closures rather
than hardcoding body order. The real pinned Go/schema root and native launcher
roots retain their tests, vet, native executable behavior and two independent
cold-cache builds. Artifact consumers retain stdlib CPython subprocess readers;
consumer roots retain the real non-Node producer. Even Intel's main unit partition
contains actual observer-reader consumers, so its Python requirement remains
conservative; the consumer producer on `units-1` is not the only Python caller.
Body packaging consumes the source/digest/ownership-verified frozen PE; copying
that fixture does not establish or replace compiler reproducibility.

Framework Homebrew switch/metadata/quality tests use owned fixtures and injected
commands, not the bootstrap Brew executable. Genuine Homebrew keeps the complete
native Node bottle dependency closure, pinned Brew/core/Ruby, actual audit/style,
previous/current lifecycle, runtime retention and guarded cleanup. Removing its
independent Go/CPython/schema SDK setup does not prune any bottle dependency.
Whole/full and R-PRE requirements are unchanged. Unknown tool use remains
required rather than receiving an omission.

Bind v5's closed requirements into source workflow SDK dispatch, bootstrap
capture, configuration, component projection, replay and protected admission.
Omitted facts/probes/schema/ownership receipts must be absent. Preserve all
twenty-five origins, twenty-three framework origins and thirteen Mac diagnostic
artifacts; only the two genuine Homebrew roles allocate real prefixes. Preserve
v4's eight real owners/five nonallocations and every older serialized shape,
configuration/specification digest and ownership requirement. Native timing and
actual CPython/native tool acceptance remain NotRun until their capable PR lanes
execute; Node-only regressions do not establish a native speedup.

The distinct source-selected `native-bootstrap-role-capabilities-v6` retains
v5's five SDK/resource decisions and adds one closed boolean `crypto` requirement.
It derives that requirement from the complete selected root closure and its
literal applicability prerequisites, not from a claimed producer flag or fixed
body number. The authentic T-PRD041 root must remain recognized with its declared
owner, pinned Sigstore inputs and npm 11.16.0 prerequisite; a missing or unknown
declaration fails closed. Unrecognized verifier/crypto prerequisites retain
acquisition rather than authorizing omission.

On the current 25-role source inventory, Linux/Windows `body-0` and both Mac
`body-2` closures require the authentic fixture. The other 21 roles, including
both genuine Homebrew roles, have no semantic consumer of that fixture. V6 alone
omits their bundle/trust/npm acquisition, install, version probe and setup
verification, as well as their fixture directories, exported inputs and
`native.cryptoFixture` facts. It must not manufacture NotRequired or Passed
crypto evidence. Required roles keep the real pinned CLI/verifier, owned paths,
offline trust, exact certificate identity and every authentic positive/negative
control. Their retained paths must belong to their own producer's bootstrap;
runtime exports must match those exact pinned inputs.

Bind the sixth boolean and conditional pinned fixture into configuration,
captured source definitions, component projection, replay and protected
admission. V5 remains a named historical protocol: its five-field tool objects,
all-role crypto setup and original configuration/specification/projection
digests do not acquire v6 semantics. Preserve v4/v3/v2/null and full/R-PRE
contracts unchanged. All 1610 assertion identities, complete closures, 25
origins, 13 Mac diagnostics, two real prefix owners, eleven nonallocations,
SDK decisions and worker allocations remain unchanged. Controlled Node-only
dispatch/absence tests establish no native elapsed improvement, authentic
verification success or achievement of the complete native lane timing limits.

The PR workflow explicitly allocates 15 shared test-worker slots on Linux and
Windows, 7 on Apple Silicon, four on both Intel unit hosts and fourteen on Intel
regression hosts. The two CPU-matched Intel unit jobs completed their measured
barrier in 5m20s, but the four-slot regression trial did not finish before the
cutoff. The next measurement changes only Intel regression concurrency back to
its memory-bounded allocation; it does not extrapolate CPU-heavy unit behavior
to I/O-heavy regression roots. A whole-lane speedup remains unverified until
complete hosted measurement. The other memory-bounded allocations
use the observed native hosts' whole-GiB capacities rather than limiting
I/O-heavy isolated roots to CPU count. They stay below the existing 32-slot
ceiling; nested producers still share that one host allocation, with all
dependency, exclusive-resource and resident-process bounds unchanged.
The personal-account hosted Mac ceiling is five simultaneous jobs, shared by
both architectures. Two Intel unit hosts, the ARM unit host and both genuine
Homebrew hosts can occupy all five slots initially without delaying ready work;
adding queued Mac shards is not additional execution capacity.
The four-body Linux/Windows matrices can provide five regression hosts per
platform while at most five Mac hosts run, fitting fifteen native jobs within
the conservative twenty-job standard personal allowance. Use standard runners
in this public repository without paid larger runners or a billing change.
If a required non-Intel lane remains active at 16 minutes, or Intel remains
active at 20 minutes, cancel that attempt and retain its non-passing originals.
Report misses of the tighter delivery limits separately; they do not cancel an
Intel measurement before its cutoff. Revise the measured bottleneck rather than
waiting for a late green result.
Reject a non-improving iteration as an unsuccessful optimization and revise its
measured critical path; neither a configured allocation nor a passing local
regression demonstrates a hosted speedup.

The agent/maintainer may explicitly select affected local families for debugging
from the actual dependency trace; no automatic impact-map implementation is
claimed. Unknown impact broadens that explicit regression choice, not the
default finite local gate. Hosted PR membership remains complete. Benchmark equivalent
inventories/toolchains/resources repeatedly; timing is advisory and no speedup
is claimed before measurement.

Canonical JSON encoding keeps its existing bytes, lexical key order, primitive
guards and sparse-array behavior. One invocation may reuse only the JSON
encoding of a repeated property name, with at most 128 bounded entries; every
value is still read and encoded afresh. The map is discarded after that call.
Payload sanitization similarly classifies repeated property and assignment
names in a bounded, invocation-local map. This stores no values, source facts,
reports, verifier capabilities or evaluation outcomes. Every value, sensitive
field, structured-log fragment, byte/depth/work budget and final equality check
still executes. The text scanner compares its three structural characters
directly rather than constructing a membership array for each character.
These are representation/classification optimizations, not cached validation.

Payload text without a double quote, opening object/array marker, colon or
equals sign cannot contain a candidate for the structured-fragment, header or
assignment parsers. After the unchanged byte bound and redacted-value check,
such text proceeds directly to the existing core summary sanitizer. That
sanitizer still examines JWTs and other sensitive text; marker-free text is
never accepted merely because it lacks parser punctuation. Other text keeps
the complete original parsing path, work limits and final equality check.

The existing 550-refresh retention root keeps its assertion identity and every
ordered assertion, but executes that unchanged body in one source-bound Node
child without `node:test` bookkeeping. The protected outer test yields its
existing active worker slot; the child acquires that same aggregate budget.
The original fixture module is explicitly preloaded before transport imports
can capture Git's executor, preserving its isolated immutable-read cache and
real mutation-triggered invalidation. Production Git and storage are unchanged.
Completion requires the actual owned PID, source/preload digest, nonce, closed
lease, exit zero, single complete result and verified fixture teardown. An
assertion, cleanup, cancellation or provenance failure remains non-passing and
retains its owned evidence. No new timeout, grace, process allowance, CI part
or reduced iteration/durability boundary is introduced; child setup, execution,
retention and cleanup remain inside whole-root and whole-lane measurements.
The preservation guard binds the outer dispatch and reconstructs the original
callback fingerprint from the actual exported scenario. Confirm the actual
lease is live after scenario cleanup, then match that same closed lease after
child exit. The worker, command observer and broker own separate clock domains:
check their individual intervals without cross-observer UTC comparisons or an
added grace interval. Retain child and broker timing with the actual inspection,
including on validation failure.

Standalone activation hands its exact version to the existing launch path in
the current runtime process instead of starting another verifier process.
The launch path still freshly verifies the activated tree and runtime and
revalidates the owned layout before invoking the framework; no verification
result is cached or skipped. Channel locks remain released before maintenance.
Tree verification batches at most sixteen independent literal-file reads per
directory while preserving each path/type/byte/mode check. Directory recursion
stays sequential, results retain their original sorted inventory and all
dispatched reads settle before the first failure is reported. Writes, flushes,
denial policy and watchdogs are unchanged.
Core distribution loading and replacement preflight also read independent
inputs in batches of at most sixteen. Preserve each fresh bounded read and
path/identity/ownership check, result order and the original first error.
Drain every dispatched read before returning failure and do not start a later
batch after a failure. All preflight completes before mutation; the existing
ordered writes, immediate concurrent-edit checks, rollback, locks and durability
flushes remain unchanged.
The test-only durable-byte snapshot hashes the fresh file buffer directly,
avoiding canonical JSON encoding of its bytes. Its directory walk, exclusions,
sorted paths and byte-preservation comparisons remain unchanged; no mutable
snapshot or validation result is reused. Read contiguous literal files in
bounded batches of sixteen while keeping directory recursion sequential.
Drain a failed batch before propagating its error and stop further dispatch;
only lock files are excluded, not directories with lock-like names.
The retained-identity acceptance parent reserves four slots from the existing
aggregate budget before its four concurrent public-consumer contexts start.
Keep its original thirty-eight assertions, callbacks and internal concurrency
unchanged. This is conservative resource admission within the selected pool,
not an additional worker allowance or a timing pass; retain actual admission
and complete hosted execution observations.
Its file-local fixture wrapper emits one monotonic setup duration through the
existing test diagnostic channel. The closed phase label and elapsed duration
separate bridge preparation from the complete callback duration without logging
paths or identities, caching state, or changing any of the thirty-eight
callbacks. Native observations, not aggregate durations alone, decide whether
fixture preparation is a remaining optimization target.
Windows recovery-guard creation can report `EPERM` for an existing directory.
Treat that case like existing-guard contention only after a fresh literal-
directory inspection, retaining all owner/token checks. A missing or nonliteral
guard keeps the original permission error; no wait or retry allowance grows.
The unsafe-diagnostic worker-exit fixture reserves four existing aggregate
worker slots before its timed callback: the orchestrator, nested runner, held
worker and Windows process observer need admission together. This does not
increase a host budget or extend the five-second identity capture or
thirty-second case deadline. Keep the real held process handle, creation-time
bound, release barrier and independently observed exit.
Use the same held .NET process object directly and write closed scalar JSON
records to the observer's stdout and owned exit file. Validate the image's
existing ASCII identifier contract before encoding it. Avoid `Get-Process` and
`ConvertTo-Json` module autoload in each observer; all process startup and
identity capture still occur within the original five-second budget. Keep
creation and exit ticks, immediate identity output, the fifteen-second exit
wait, guarded termination and disposal unchanged.
The measured GitHub partition guard retains its original 143-assertion
fingerprint and root vector. Account for the additional byte-snapshot regression
by its exact ID, file, name and parent closure, and require all 144 current IDs
to remain unique; do not rebase the original callback fingerprint.

The standalone `validation-benchmark.mjs` adapter consumes explicitly owned
baseline/candidate workspaces, worker budget, focused assertion-ID JSON and an
owned output directory. Both workspaces need the same adopted harness protocol.
It retains two full and two focused measurements per version, matched cold/warm
owned caches and original per-attempt reports/journals. The comparison manifest
binds exact original assertions/definitions/applicability, scheduling-policy
digest and host/tool/resource identity; added assertions are shown separately.
Missing/mismatched/failed/unverified inputs cannot yield a ratio. A valid math
comparison neither claims hosted T-PRD012 executed nor grants publication or
waives critical correctness. The full opt-in benchmark is separate from the
normal finite local sanity loop.

Benchmark admission requires complete test and executable-surface inventory
before measuring. Derive expected group identity from the adopted source
inventory, not copies decorated with measurement-only resource fields. Validate
the actual root-group selection and concurrency, source stability and allocated
broker protocol; record precise completion diagnostics and the actual policy/
version rather than a stale fixed token-policy label. Controlled two-root
fixture regressions exercise all eight measurement paths without claiming a
product-scale or hosted performance benchmark.

### 4.4 Producer output and cancellation

Installer timing observations are opt-in and use a strict non-secret
`SDLC_INSTALL_TRACE_ID` UUID. A small shared observer emits bounded
`sdlc-install-v1` fixed-format stderr records, never stdout JSON or file contents,
paths, credentials or verifier data. Source/active verification, runtime launch,
distribution/documentation, lock acquisition/release, purge, replacement and
manifest spans retain actual process identity, monotonic/wall time and cumulative
process CPU. Existing per-file writes and flushes report aggregate attempts/time
at bounded intervals; no write, flush, rollback or path check is removed or
parallelized. A 256-record ceiling emits an explicit limit marker.
Observer failures are latched during transaction work and surfaced only after
settlement, or attached to the preserved primary installer error. They cannot
cause transaction rollback after successful manifest publication. Normal callers
without the trace UUID emit nothing. Broker observations stay in the owning test
process outside the denial boundary; phase spans alone are not a contention or
filesystem-latency verdict.
The raw denial-boundary executor shares the existing owned-group stop and
settlement policy with validation commands, without substituting sanitized
reports for its raw stream/Error contract. A live tracked child anchors its
dedicated POSIX group; one 15,000ms watchdog requests synchronous owned
termination. The 1,000ms settlement bound includes root close and observed group
disappearance. No delayed destructive signal follows ownership loss. Uncertain
writers keep the primary timeout/overflow failure and prevent fixture deletion;
the raw 4MiB stream limits and native negative-control outcomes stay intact.
Darwin can report `EPERM` while a signaled group's zombies are being reaped.
Read-only group probes may therefore continue within the original deadline,
without treating denial as absence: root close plus `ESRCH` are still required.
A denial that persists to the deadline remains an explicit failed cleanup;
termination-signal denial is not converted into success or retried.
Validation commands publish rejected-stop uncertainty before allowing read-only
root/output drainage within the remaining original settlement deadline. Natural
exit codes and complete output remain distinct from cleanup success; no second
grace period or later destructive signal is introduced.
The native ownership fixture reserves four aggregate worker slots for its
test process and three real child processes, without changing host capacities
or the one-second settlement bound.
The controlled Windows settlement fixture separately reserves five slots for
its test process and at most two independent owned root/writer pairs. Fresh
VM contexts and unique paths isolate all six scenarios; each pair settles
before another is admitted. Real peer provenance proves overlap, all six
cleanup closures remain required, and the existing twenty-second test and
one-second stop deadlines remain unchanged. Retain per-mode phase diagnostics
so a later timeout identifies the unfinished boundary.
The publication fixture arms its five-second ready deadline only when the
parent releases the intentional write barrier, not while that barrier forbids
progress. A controlled timer advance while paused must not consume the later
readiness allowance. Complete atomic publication and exact writer reaping
remain required within the unchanged fifteen-second test ceiling.
Its separate five-second pause-announcement watchdog uses real timers even
while the readiness regression controls virtual time, so a missing announcement
still enters bounded failure cleanup.
The denied installer lifecycle likewise reserves four slots for its observed
test/runtime/runtime/CLI process chain. Its child environment still excludes
broker credentials, so the owning test reserves their capacity in advance.
This is process accounting, not a change to host limits, execution deadlines,
durability or a claim about contention causality.
The Windows periodic-checkpoint fixture injects its classified failure without
asynchronous preparation inside the timed replacement attempt. Its marker is
prepared beforehand and published only after a subsequent real replacement;
production's 100ms retry budget and worker-liveness checks are unchanged.
Existing broker inspection accepts an optional AbortSignal that closes and drains
only its request socket; no-signal callers, credential checks, scheduling and
capacity limits are unchanged. The owning test samples safe counts at bounded
intervals with cancellable requests outside the denial child. Controlled tests
cover loss of ownership, output overflow, stubborn close, abort drainage and
sibling survival; native POSIX and actual purge timing remain separate gates.

The pure release archive-policy root needs no generated fixture. Other release
roots retain the original complete initializer, lazily shared only within the
same file lifetime. Synthetic revision, PE and target-set identities are not
interchangeable with native frozen artifacts; distribution context transport
continues to exclude that consumer. The PR-only denied-build control reserves
three slots for its test worker and two nested Node processes. This removes
unused setup without weakening real builder requirements or adding a cache.
The selected native producer can prepare a separate six-file synthetic release
input set once, after candidate verification and before regression dispatch.
Its actual source origin and recipe/configuration binding are distinct from
the original synthetic current/previous descriptor revisions and PE recipe.
Only release-fixture consumers receive the dedicated
`SDLC_SYNTHETIC_RELEASE_FIXTURE_CONTEXT`; unrelated workers and reporter/broker
channels do not retain it.
The reader revalidates registered source/index/raw-mode identity and every
archive's bytes, layout and modes on each use, then exclusively writes private
consumer copies. Supplied invalid context fails closed; absence alone selects
the real-build fallback. Pure policy, unit, refresh and unrelated selections
do not prepare it. Metadata constructors, owned paths, environment lifecycle
and tester/context generation stay fresh. No assertion-time real launcher,
reproduction, nondeterminism or cold-build call is replaced.
The producer retains fixture-only observations in an existing top-level JSON
upload path: real attempt/completion counters, actual source/recipe/configuration
bindings, six input pins and canonical digest linkage. No paths, credentials,
archive bytes or native-pass assertion are serialized. Consumers emit a
separate provided-or-successful-absent-fallback receipt only after validation
and private copying; rejected or failed work has no success receipt. Transport
context shape stays unchanged, and observation persistence failures propagate.
Observation snapshots use a dedicated owned checkpoint writer: exclusive
initial creation, ordered atomic updates and no overwrite of a pre-existing
foreign record. Immutable artifact outputs keep their exclusive writer.
The negative-readiness test may reuse only root-local immutable serialized
nonlocal producer input bytes. An independent original-constructor reference
and byte/isolation checks precede reuse; each variant reconstructs its own
mutable manifest, readers, facts and verifier closures. Finite-local inputs,
all consumer invocations and fresh source/content/configuration/SDK-origin
verification remain unchanged. This is test-input preparation, not a production
cache or reuse of evaluations, capabilities, verifier results or admission.

Native fixture setup transports its verified candidate/source/artifact identity
in a dedicated context, never a reporter control. Only the exact distribution
test file retains that context through worker preload. Each use freshly checks
all committed raw blobs, HEAD/tree/index/modes and working-tree additions, a
complete source snapshot, owned literal release paths and real
`verifyRelease(rebuild:false)` payload/archive/manifest checks before reuse.
Invalid supplied input fails explicitly; absent input retains the real build
path. Setup reuse does not replace dedicated fresh/reproducibility builders,
native launcher execution or cold-cache builds. Linux's once-built three-target
private fixtures retain their exact published-byte comparisons and test-only
identity. Metadata-finalization setup edits only its owned copied metadata.
Test fixture construction creates a history-independent one-commit snapshot from
registered index paths and their current bytes/modes; new source files must be
registered before freeze. It never collects arbitrary untracked private data.
The dedicated history regression proves representative fixture/beforehook
execution without the old object or alternates and guards an owned visible
untracked canary against filesystem access and copying.

The seventeen versioned protocol/bootstrap scenarios stay within their existing
logical root but execute as whole isolated Node children. Its four-slot
reservation precedes setup; one existing shared producer and ready pool bound
dispatch to the smaller of four and the actual caller/broker allocation.
Each child retains its live SDK verifier/projection objects and owns its fixture
scratch, including temporary-environment changes. Only source-bound scalar
completion and actual process/lease identity cross the boundary. Reject
incomplete or mismatched row closures, stop new dispatch on observed failure,
drain all started siblings, report the source-order primary error and await
scratch cleanup before restoring the parent budget. Retain all seventeen rows,
all original assertions and historical protocol semantics.

The standalone syntax checker uses one common bounded ready-work policy across
hosts, limited by available CPUs and the existing 32-slot ceiling. It remains
serial under an inherited test allocation. Syntax-check failure stops further
dispatch, awaits every already-started child and preserves the original
source-order primary error; independent completions release capacity immediately.

The worker emits sanitized incremental records to a unique owned execution
journal and publishes an incomplete JSON checkpoint before callbacks begin.
An exclusive output claim prevents another attempt from replacing that path.
While the attempt is active, serialized atomic replacements update its partial
checkpoint; the completed final report is immutable. Keep original registration/
start/completion diagnostics and actual expected-result evaluation.

Partial checkpoints retain `complete=false`, null finish/exit fields, the
current phase, actual active/pending groups and a durable journal-prefix
sequence, byte count and SHA-256. A journal may continue growing after that
prefix. Refresh real lease/process observations before periodic snapshots,
including silent roots; do not infer activity or completion from console output.
The worker coalesces running snapshots at ten seconds; command capture retains
its actual dispatched PID and coalesces output snapshots at one second.
These intervals are diagnostics, not test deadlines or passing evidence.

Use existing IPC/AbortController cancellation, wait for worker shutdown, and
retain nonzero/interrupted outcomes. Await journal flushes and staged-file
fsync/close before atomic replacement. Commit the final manifest only after all
expected workers close and evidence flushes. Never overwrite another attempt's
report or an already completed final report; attempt/run identity and digest
select a new output. Missing final output, interrupted snapshots and journal-only
recovery cannot pass readiness. A kill before initial publication or an OS/
filesystem failure may still prevent the first checkpoint.
For a stopped POSIX command, root closure is not proof that its created group
has disappeared. Await bounded group settlement before final command completion;
only `ESRCH` verifies disappearance, while denied, persistent or unknown
observations stay non-passing. Do not send unverified delayed destructive
signals after losing the tracked root or observing group disappearance.

Periodic worker replacements reuse `atomicWrite`, including its existing
100-ms recovery budget for classified Windows sharing conflicts, rather than
performing an unguarded one-shot rename. Keep the initial exclusive report
claim, staged-file durability and explicit failure/cancellation behavior.
An exhausted or unclassified replacement error remains non-passing; no test
deadline, output bound or worker liveness assertion is relaxed.

On Windows, test polling of mutable checkpoints uses same-turn synchronous
reads so the test itself does not hold a read handle across an awaited atomic
replacement. A retained checkpoint error fails explicitly; it is not a fresh
active-worker observation. Production replacement recovery is unchanged.

Windows owned-process test assertions share a held-original-process observer rather than
interpreting a currently occupied PID as the original worker. Capture creation
identity behind the live ready barrier, then compare kernel exit time against
the immutable original producer-close event with the existing conservative
millisecond bound. Unknown identity, a live original, late exit and same-bucket
ambiguity fail. The sibling-capacity fixture keeps a real independent broker
producer active across these checks; later global closure is not a substitute
for each worker's own completion boundary. Await attached observer cleanup
without changing deadlines or claiming the original CI proved PID reuse.
For the cancelled-local-critical PID oracle, an explicit-retention observer mode
pins the verified live Windows process until owner release after the unchanged
immediate ESRCH probe. The observer also holds the owner identity so owner exit
releases abandoned resources. It cannot terminate the original before owner
release; normal automatic-exit observation remains the default for other callers.

POSIX tool-cancellation fixtures retain their strict original PID-exit assertion.
Publish owned-process ready identities before cancellation and retain bounded
exact-PID state/creation observations without command lines or environment data.
A diagnostic query after strict failure is timestamped as a later observation,
never proof of state at the earlier command return. One-second creation matches
are not unique identity proof; unknown state never changes a failure to a pass.

Checkpoint retention rejection preserves a bounded invalid-partial record with
the actual cause and original snapshot identity, not passing observation rows.
It remains incomplete/nonzero and does not raise existing output bounds.

Project every failed assertion's already-sanitized message and scalar failure
classification into plain reporter errors, including the safe cause expected
by Node's `ERR_TEST_FAILURE` wrapper. Do not forward enumerable exception
metadata to the Spec reporter: its JavaScript inspection output is not JSON.
Keep the original structured failed outcome; ordinary failures must not abort
independent roots through a secondary transcript-format rejection.

Consumer subprocess execution awaits both stdin completion and the real child
outcome before cleanup. Preserve a failed child's exit and diagnostics; a
successful exit cannot hide incomplete input. Close absent input without an
empty write, and report spawn or pipe failures instead of uncaught stream errors.

Concurrent monitor regressions preserve bounded lock acquisition. A documented
`LOCK_BUSY` attach may reconcile once after the original contenders settle;
canonical alias identity, exactly one poll owner and the later in-flight fence
remain mandatory. Do not increase lock deadlines or steal a live lock to make
the fixture pass.

The original schema-1 producer report and single ordered NDJSON journal retain
their assertion identities. Additive `groupExecution` version 1 uses
`isolated-root-ready-pool-v1`; each group ID binds protocol, root ID and source
digest, and the selection digest binds the complete independently derived group
list. Scheduling policy version 2 identifies `source-bound-ready-root-v2`.
Actual group process/lease start and release, stream-drain completion, original
assertion outcomes and native summaries remain inspectable. A stream may drain
after its lease releases; do not invent timestamp equality or global-idle
requirements while an unrelated owned group is still running.

Retain every original diagnostic in NDJSON. The final JSON can omit duplicate
native summary diagnostics only with an explicit diagnostics-scope marker;
per-group original counters and outcomes remain intact. Sanitize bounded rows/
groups without raising global core limits or dropping assertions. Required
native artifact readers allow 16 MiB only for the exact three declared original
stage journals; unrelated files remain limited to 4 MiB and the total expanded
artifact remains 64 MiB. Nonexecuting size projections establish capacity needs,
not evidence that a full suite ran. Coverage retains actual immutable per-root
native inspector summaries with byte/hash references; do not invent combined
branch percentages from independent processes.

Finite local critical producer output, and separately identified optional
affected output, are also consumers of the
public normalization/evaluation/bundle API. Its local process host independently
binds the selected source/specification/configuration, expected assertion set,
actual child command/exit and original report bytes/times before supplying an
in-process verifier. It does not invent GitHub identities, Copilot receipts or
managed cycles. Failed/cancelled/missing/stale local inputs remain non-passing.
The retained result describes the exact `automated-local-critical` selection
only. A complete passing finite selection can complete L, not the old 69-case
logical inventory. Deferred PR/acceptance procedures remain NotRun at their own
checkpoint; they do not become hidden local prerequisites. A versioned reader
must not relabel an older broad profile or its original evidence as this one.
Nested runner processes share one bounded job-local allocation rather than
multiplying file workers. An ephemeral owned loopback budget broker is test
orchestration, not a new service or a network client in the offline evidence
core. Missing required broker/allocation capability is explicit, not permission
to claim overlap or fall back to unlimited execution.

`deriveLocalSanitySpecification({ inventory, testPlan, platform })` is the pure
repository adapter for independently establishing finite L. It reads adopted
source inventory and the canonical risk table, enforces exactly sixteen
canonical assertions, eleven risk roots and a maximum of 27 total assertions,
then returns the SDK `T-LOCAL-REGRESSIONS` specification and source-bound
assertion selectors. The native platform is an explicit validation target such
as `windows-x64`; omitting it uses the actual host target. It must not learn its
expected catalog from a received bundle. Optional affected assertions have a
separate `T-LOCAL-AFFECTED` case and cannot change the base expected digest.

The repository readiness composer keeps input-manifest schema 1 readable but
emits report schema 2 to distinguish this finite L meaning from the historical
69-case local checkpoint. Its trusted host supplies current source inventory;
without that independent finite expectation, L is NotRun. It checks the exact
normalized source-derived SDK case rather than crediting a legacy logical-case
summary. Additional affected outcomes remain visible, and an actual verified
failure cannot be hidden by a passing sanity subset.

### 4.5 Coverage in PR metadata, without extra repository files

Keep the user-authored `requirements.md`, `test-plan.md` and existing tests as
the source definitions. Compile coverage in memory and place it in one dedicated
section of the PR description. Do not create a coverage/index/binding/policy
sidecar in the consuming source tree, even temporarily as a publication input.
Ordinary test-result artifacts and existing framework runtime evidence remain
separate mechanisms, not substitutes for this metadata location.

Use exactly one explicitly delimited JSON block, identified by
`sdlc-coverage:v1`, inside a visible Requirements Coverage section. The shipped
schema defines `schemaVersion`, the selected source revision, canonical
specification references/definition digests, AC-to-test-ID links and uncovered
AC identities. Existing Test Plan fields retain their meanings; selectors,
procedures and finite variants refer to canonical definitions/declarations
instead of being copied into another manually maintained document.
The metadata records declared traceability, not passing statuses, approval or
proof that an assertion adequately tests the requirement.

The native framework authoring path is:

1. Requirements and Test Design skills use the shipped fixed templates to
   author stable FR/AC/test identities, explicit DoDs, coverage links and
   executable selector/procedure references in the existing documents/tests.
   Requirements-only work reports that a Test Plan is not yet available; it
   does not invent complete coverage.
2. Proposed `coverage prepare/inspect` helpers use those definitions and
   caller-supplied policy to produce the section and gap diagnostics in memory
   or on standard output. They report missing AC mappings, unknown references,
   ambiguous input and planned/unresolved selectors. They perform no implicit
   provider write, CI installation or branch-rule change.
3. The PR-creation/update instructions include the prepared section during
   separately authorized publication. Use provider body data or standard input
   rather than creating a body/coverage file. Preserve text outside the owned
   section, read the current description before editing and reconcile detected
   concurrent edits or uncertain writes instead of blindly overwriting/retrying.
   The candidate now authors that extension through `preparePrDescription`,
   `publishPrDescription` and `reconcilePrDescription` on the existing `/pr`
   export, plus offline `pr description-prepare`. `preparePr` accepts optional
   create/update class, update PR ID and transient current description/version.
   Original field-absent API/IDs stay compatible. Store only description/
   coverage/previous-body digests and version in bounded intents/operations,
   never the full provider body. Exact receipt-bound publication permission and
   operation scope include the action, source, PR and body binding.
   The host reacquires complete matches; update requires genuine atomic
   version/body compare-and-set support, not a read-before-write approximation.
   A claimed callback failure remains uncertain until real provider result
   proof is reconciled through the existing verifier. No helper acquires network,
   settings, merge or consumer-policy authority or silently retries a write.
4. After source/specification changes, maintenance regenerates the section for
   the selected source and surfaces any new uncovered areas before an authorized
   update. Source-bound snapshots and historical execution evidence remain
   unchanged; metadata generation does not grant approval or execution credit.
5. Other projects choose whether and how their CI consumes this metadata.
   Framework installation and ordinary authoring do not add workflows, required
   checks, new configuration/coverage files or provider permissions. Only this
   repository adopts the mandatory checker in section 6.5.

The strict input grammar remains in the shipped templates: FR headings define
requirements, explicit AC bullets define their DoD, and named Test Plan
Requirements/Conditions cells define mappings. The current combined
Requirements cell may list both kinds of IDs. References in prose/examples do
not define or cover a requirement. Tighten the new compiler at these boundaries,
retaining legacy readers without treating permissive whole-row scans as a
strict public format.

Use a pure shared compiler/parser/inspector, bounded JSON/field validation and
the existing definition-digest exclusions for mutable result projections.
Multiple registered artifact sets are explicit inputs; metadata cannot silently
narrow the required set selected by an adopting repository. Reject duplicate
coverage sections, unknown versions and malformed references with exact
diagnostics. Bound the complete payload to the provider's description budget;
if it cannot fit, report that limitation rather than truncate mappings, split
authority across comments or fall back to a repository file.

The maintained parser now shares escape-aware Markdown row tokenization across
strict coverage and specification digests. Status/evidence columns are excluded
only after the correct column split. Unescaped legacy definition identities
remain unchanged. Escaped definition cells use explicit unambiguous canonical
row encoding: a genuinely corrected definition digest invalidates affected
current credit. This is not a blanket formatting exclusion and never rewrites
historical approved snapshot digests or original execution records.

Consumers can inspect partial mappings and gap diagnostics without adopting a
merge gate. This repository's checker applies its explicit completeness policy
under FR-214. Runnable selectors and actual outcomes remain separate execution
checks at their applicable profiles; PR metadata never requires future R-POST
results or proves tests passed. Semantic adequacy remains a Test Design/code/
user-review responsibility, not an LLM pipeline or per-assertion signature.

Ship the schema/example, native Requirements/Test Design/Technical Design/Coding
instructions, PR-publication guidance and helper interfaces together using the
existing templates/skills/focused-instructions distribution. Test authoring and
publication through an isolated candidate install/provider fixture without
touching the live 0.4.0 home, creating consumer coverage files or changing its
CI/CD policy.

## 5. Generic framework evidence contract

### 5.1 Observation is not approval or managed credit

Headless CI must be able to normalize and evaluate real test execution without
fabricating Copilot receipts, work-item phase approvals or deployment authority.
The public API therefore supports a **detached immutable execution report**.
It is a transport representation, not another mutable ledger.

For managed workflows, the same report is retained as existing execution payload
content and admitted through the normal current-cycle rules. The importer keeps
the original producer/context/digest and records a separate admission mapping;
it never rewrites the original report to claim it ran under a later cycle.

An observational validation verdict can say all required assertions passed.
It does not say a managed phase was approved or authorize publication. Existing
`startCycle`/`recordTests` lifecycle checks are not weakened to accommodate CI.

### 5.2 Proposed public interfaces

| Interface | Contract |
| --- | --- |
| `normalizeExecutionReport(report, context, verifier)` | Validate the selected producer format, expected selectors and independently supplied context; return canonical observations plus diagnostics. No network or tool dispatch. |
| `evaluateReadiness(specification, observations, context)` | Deterministically evaluate a selected profile using the shared eligibility/history rules; return verdict, required-case projections, counts, missing/invalid evidence and input identities. |
| `createEvidenceBundle(evaluation, retainedObjects)` | Produce a bounded canonical manifest and content-addressed payload set for the host's configured persistence/transport. No automatic upload or publication. |
| Existing retain/read/record operations | Preserve compatibility. Managed import must additionally verify producer origin and current-cycle equivalence before deriving current credit. |

The in-process verifier returns protected semantic facts from a trusted host,
not secrets, arbitrary provider blobs or a caller's `verified=true`. Existing
Store/host callbacks remain intact. A JSON configuration cannot register code
or manufacture a verifier.

The ordinary offline CLI can check structure, hashes and supplied local evidence.
Where independent provider/signature origin verification is required and absent,
it reports an explicit verification gap and non-passing readiness. A trusted
embedding host obtains/validates those facts using its separately authorized
provider tools. Hash equality alone is not proof of who executed a test.

### 5.3 Canonical data

| Object | Required content |
| --- | --- |
| Execution context | Source repository/content and commit identities, test specification/bindings digest, validation configuration, selected profile, actual host/toolchain, artifact identities, producer/run/job/attempt and timestamps. |
| Case observation | Logical test/assertion/AC IDs, exact selector/procedure, raw producer outcome, expected-result evaluation, exit, activity, observed times and retained evidence references. |
| Verification facts | Independently verified producer/repository/workflow/source/attempt/artifact scope, verifier identity/version and verification result. Stored flags are not trusted on replay without the declared verifier/trust policy. |
| Readiness projection | `Passed`, `Failed` or `NotRun`, selected required denominator, per-case status/reasons, verification/currentness diagnostics, input identities and retained provenance references. |

Retain raw producer skipped/todo/cancelled states separately. A required skipped
or missing result projects to NotRun with a blocker, not Passed. Actual failed
required assertions project to Failed. The gate exits nonzero for either outcome:
0 only for complete Passed, 1 for observed failure, 2 for incomplete/invalid/
unverified evidence. Host infrastructure errors are explicit diagnostics.

The gate is always evaluated and cannot be skipped because an upstream job failed.
Neither zero failures, a producer's own count, a green job nor an empty catalog
can prove complete success.

Expanded assertion inventories may exceed the inline-case limit even when the
logical plan has fewer than 100 rows. Reuse referenced catalogs and paged outcome
objects, including the existing 64-slot page mechanism, rather than truncating
cases or embedding all histories in one checkpoint. Existing object/record
budgets remain enforced; capacity failure is explicit and non-passing.
Persist the SDK-created bundle canonically with exclusive creation and fsync.
Its objects have already passed the SDK's per-object sanitization, integrity
and paging checks; applying that single-object sanitizer again to the aggregate
container incorrectly rejects valid large failure reports. Keep the existing
object, sanitizer-work and aggregate byte budgets unchanged.
Command checkpoints reuse the existing atomic-write helper rather than a
one-shot temporary-file rename. Its Windows-only EACCES/EBUSY/EPERM handling
uses the existing 100 ms retry budget and 10 ms backoff; unrelated errors fail
immediately and exhausted conflicts remain explicit non-passing persistence
failures. Preserve exclusive initial creation, the prior durable report,
original journals and owned-process cleanup assertions.
Native Homebrew CLI failures use the shared bounded process-diagnostic renderer
before a nonzero exit, including argument, host and frozen-input failures before
the lifecycle procedure begins. Do not emit raw Node inspection stacks that
strict transcript retention must reject. Preserve the original diagnostic
identity and failed/NotRun outcome without relaxing sanitization, host checks or
candidate identity requirements.
Reuse the command-evidence argument normalizer for Homebrew lifecycle records:
inline programs remain executable inputs, not log fragments. Retain an omitted
program's exact SHA-256 and byte count without storing its source in log fields.
The existing top-level native Homebrew report retains sanitized lifecycle and
quality details; do not upload whole nested workspaces, fixtures or binaries.
If strict retention rejects that rich report, retain a bounded non-passing
record with its original identity, the primary process diagnostic, the actual
procedure stage and a separate retention diagnostic. Rethrow the primary error
when present; a serialization failure must neither hide it nor create passing
credit. Preserve exclusive report creation and all existing retention budgets.

### 5.4 Currentness, reduction and compatibility

Share the existing `reduceTestHistory` ordering and independently eligible source/
spec/config/reset predicates across detached and managed evaluation. Later failure
or in-flight/uncertain replacement prevents an older pass masking current status.
Compare exact required assertion and input identities, not branch/version labels.

Invalidate affected current credit to NotRun on changed tested dependencies,
fixtures, selectors, specification, configuration, artifact, host/toolchain or
required freshness. Preserve original records and their actual outcomes.
Whole-candidate contracts invalidate the whole relevant profile; unknown impact
does not become an invented selective-reuse exception.

Existing schema/storage readers continue to read supported 0.4.0 records and
referenced objects. New report fields have explicit versioned readers and
conversion rules. Unsupported future/legacy evidence is unverified, not silently
upgraded, deleted or credited. A rollback to an older runtime is not promised
to interpret future schemas; report that limitation before such a rollback.

Managed evidence reload traverses a bounded complete admission dependency
graph: admitted payload -> import/object-map pages -> assertion pages and
original bundle/payload objects. Verify work-item identity, kind, reference
size and digest at every edge without trusting saved verification booleans.
Missing/corrupt children remove current credit; they never delete or recreate
the original observations. Inline and referenced cycles share that rule.
Fresh-Store regressions cover each missing/corrupt graph class while old
snapshot/decision/execution bytes remain unchanged.

### 5.5 Sanitization and retention

Reuse the existing bounded text/JSON sanitizer and content-addressed object
mechanism. Sanitize producer output **before** upload, then bind the final safe
bytes to provider artifact digest. Preserve original-byte and normalized-content
digests distinctly where redaction occurs. Never relabel modified bytes as the
same artifact.

Secrets, auth configuration values, tokens, cookies, signed URLs and unrelated
user content never enter public evidence. Do not redact a test ID/assertion
status in a way that changes matching semantics; reject unsafe identity-bearing
data instead. Assertions and boolean outcomes are not weakened by sanitization.
Bound JSON size/depth, UTF-8, file counts, archive expansion and safe literal paths.
Untrusted archives are data-only and cannot introduce executable helpers.

Captured native definitions are **typed source**, not execution-log strings.
`captureNativeDefinitionInputs({ target, profile })` records exact raw
`{ file, contents }` source plus immutable Git/blob/path identity, plan,
inventory/Go/stages/specification and scheduling/worker request digests.
Preserve BOM and exact source bytes. Its separate bounded literal UTF-8/path/
count codec (64 MiB combined source ceiling) rejects credential-shaped real
PAT/private-PEM/literal-JWT/non-reserved credential URL data while preserving
declared credential-negative and reserved fixture source. Never feed source
through a generic log sanitizer or relabel modified code as the same definition.

Keep CI/interrupted-run artifacts for 90 days in the public repository. For each
released version, publish sanitized, cryptographically verifiable prepublication
and completion evidence as separately named release evidence assets, retained
for the supported release's lifetime, with no automatic deletion. Download the
verification bundles/trust material needed for the declared offline verification.

A clean consumer can reconstruct from these durable assets after CI retention
expires. If required bytes, trust material or source evidence are unavailable,
readiness is NotRun/Blocked; a local remembered pass is never recovery.
Consumers may select private authorized storage through the same host interface.

Durable release retention includes every non-asset input required by full
bundle verification: original bundle/context, tester input/handoff, original
native reports, source/spec/configuration definitions, independently captured
producer origins and verification/trust material. Frozen distribution assets
remain individually immutable public assets; the separately named evidence
archive is produced afterwards and never hashes itself into the bundle.
A clean receiver reconstructs the complete literal inventory and verifies all
references from those durable inputs, without expired CI storage or live
producer APIs. Missing/tampered inputs are explicit non-passing results.
Historical/as-of verification is a distinct mode: it retains original times,
attempts, outcomes and trust observations, never renews current eligibility or
the <=24-hour publication window, and cannot be supplied to a publisher as
current readiness. Fresh current use still requires its declared context,
freshness and independently verified native producers.

## 6. Trusted PR validation

### 6.1 Unprivileged producer workflow

`ci.yml` runs on initial/updated PRs, including forks, with read-only permissions,
no publication OIDC/secrets and no real Copilot installation. It validates the
current PR head/base/test-merge tuple and provisions the exact Test Plan matrix.

Build one candidate artifact set in an unprivileged producer, then native jobs
consume its verified bytes by exact artifact/run ID. Mac arm64 and Intel jobs
must use the same archive digest. Run complete applicable assertions and utilities
across all four native hosts, with resource-bounded shards and an always-evaluated
producer summary. Upload sanitized case results on failure/cancellation too.

The no-checkout/no-token intent classifier distinguishes a source/base change
from a body-only `edited` wakeup. The source job runs `--phase candidate` to do
canonical/static checks and freeze once; four `validation` lanes depend on that
same frozen artifact and run independently in parallel. A true native intent
requires the source job and all lanes in the final conjunction. Metadata-only
skipped native jobs never manufacture native credit; the trusted observer must
still retrieve matching eligible original evidence for the current source.

No path filter skips a required check. Documentation changes retain their checks;
unsupported platform-only cases are assigned to their matching native lanes.
Undeclared skips, absent prerequisites, incomplete reports or missing shards
cannot turn the summary green.

Authentic signature/certificate/transparency regression inputs belong to a
required capable PR group with reproducible pinned fixture/trust/tool setup.
Setup failure is explicit and non-passing, not a required test's optional skip
or a demand for every local contributor to supply verifier inputs. Safe fixtures
do not confer signing/publication/admin authority. Actual public provenance
acceptance remains postpublication.

The independent calculator project runs its own real command, initially eleven assertions,
as T-PRD087, retaining namespaced source/command/outcome evidence separately from
framework and native tool assertions. The stable completeness result includes
that expected project result; a green framework report cannot hide its absence.
Resolve every declared project test file and source assertion from the complete
independent-project inventory into literal platform-safe argv. The baseline
eleven is not a permanent success denominator: declared new files/assertions
must execute, with exact file/name matching and dynamic counts. Retain legacy
baseline replay without using its two-file list as a live capture filter.
T-PRD088 reuses the public documentation/static checks and owned mutation
fixtures to prevent structural, navigation, release-example and repository-only
instruction-boundary regressions. Neither automated structural checks nor
reference research replace T-PRD089's actual published-experience assessment.

The 99 canonical readiness cases remain a different layer from L's underlying
27 sanity assertions. This revision assigns 76 canonical cases to PR, four to
R-PRE, seven to R-POST, eleven to A, and T-PRD019 to observer output. Moving
component execution out of the local default must not orphan its 69 logical
component cases or borrow their success from an outer T-PRD014 lane verdict.
The native component adapter derives their complete executable bindings from
the current Plan, inherited source declarations and exact root/descendant
inventory, then normalizes verified original native assertion outcomes through
the same public evidence API. It requires every applicable native variant and
preserves original source, timing, attempt and verifier provenance. Missing,
ambiguous, procedural or unresolved bindings stay non-passing; a partial lane,
outer green result or producer's own denominator cannot approve the component.
Use bounded shared original references and existing bundle/catalog mechanisms,
not another mutable ledger or global capacity increases.

Present results through the standard GitHub Actions UI, not a new dashboard.
The existing readable-report projection produces Markdown for
`GITHUB_STEP_SUMMARY`: tested candidate/profile/platform, required/passed/failed/
NotRun totals, raw skip/cancellation diagnostics, per-test success/failure lists
and links to job/step logs and the complete sanitized readable/machine reports.
PR check/status details link to the matching run. Emit escaped `::error`
annotations for failures where a real source location is available; ordinary
runner logs retain the assertion diagnostics. Render/upload the retained output
after failed producers too, with interruption limitations explicit.

GitHub renders Markdown summaries, not arbitrary result JSON automatically.
Reuse the runner records and generic report projection for this small adapter;
no third-party test-reporting action or per-test signature is required.
Preflight the documented 1 MiB per-step summary limit and at most 20 displayed
step summaries per job. Keep any bounded UI excerpt explicit and link to all
outcomes in the full retained reports; do not truncate the evidence denominator.
GitHub summary-upload errors do not automatically fail a job, so retain and
surface presentation diagnostics without substituting UI appearance for the
independently evaluated validation result.

### 6.2 Trusted observer and required status contexts

Run the evidence observer from reviewed default-branch code, using supported
`workflow_run` events for the known producer workflow IDs. Give it only metadata/
actions/PR read access and `statuses:write`. It does not check out, import,
execute or restore candidate code/caches or artifact-supplied programs.

The observer queries actual upstream run/job/attempt/artifact facts, verifies
expected workflow/repository/source identities, adopted producer definitions,
required step outcomes and artifact digests, reads only bounded declared result
data, and evaluates it through the generic framework API.
Untrusted report fields cannot choose another repository, PR, commit, helper
revision, policy or expected denominator.

Scheduling/budget/local-evidence helpers, schema pins and non-test helper source
OIDs participate in the adopted producer definition. Configuration hashes bind
`validationSchedulingPolicyDigest()` and normalized configured worker request;
host-specific actual resources remain in each independently expected native
context. Trusted pre-checkout logs record actual CPU/memory/request, bootstrap
and native independently cross-check them, and the observer resolves expected
capacity with the shared worker policy. Every original stage must match its
selection/concurrency, budget identity/version/limits and captured allocation
peaks; an uploaded resource claim is not authority.

Use ordinary reviewed CI as the execution trust boundary. The expected workflow,
actions, runner/reporter and binding definitions are part of the adopted
validation configuration; a PR cannot silently replace them and make its new
reporting policy authoritative. A change to that machinery is visible in review
and requires maintainer-controlled adoption before the observer credits that
changed producer. Verify the actual producer definition and expected execution
steps, not merely a workflow ID or an uploaded JSON `Passed` flag. Foreign,
unadopted or incomplete producer output remains non-passing with diagnostics.

This authenticates the declared CI execution/reporting path at normal CI
assurance. It is not a cryptographic proof that arbitrary malicious code
trusted to run on the same host cannot interfere with a test process, nor a
claim that mapped assertions are semantically adequate. Code review and
protected CI configuration are explicit trust assumptions. Artifact
attestations authenticate origin/integrity; they do not establish assertion
truth by themselves. No new service, sandbox or per-assertion signing mechanism
is required or claimed.

Publish REST **commit statuses**, not merely the observer's own workflow-job
check, under distinct contexts:

- `framework/validation`: complete matching required native test evidence.
- `framework/approval`: current author-specific maintainer-approval facts.
- `framework/coverage`: this repository's current PR-description coverage
  verdict, supplied by the metadata-only evaluation in section 6.5.

GitHub documents that `workflow_run` workflow-job checks are not ordinary
PR-required checks. The commit-status API is an explicit separate publication
channel; its actual association and expected integration source must be proved
by the controlled provider tests before enabling it as required.

Bind the PR head, base and actual tested merge SHA. Set pending on a new tuple;
publish only against the corresponding current head/test-merge commits and
recheck those identities before and after status publication. A stale event
cannot overwrite a newer candidate's status. Require the branch to be up to date;
if a test-merge commit has checks, GitHub evaluates that commit, otherwise the
head. Conflicts/missing current merge identity remain non-passing.

All three context writers use one repository-wide Actions concurrency group,
shared across their workflows, with `cancel-in-progress: false`. Do not suffix
this group with PR, workflow or run identity. Native test jobs remain parallel;
only the small status reconciler is serialized. Pending notifications may be
coalesced/replaced by GitHub, so every admitted writer refreshes all current
in-scope PRs and affected status keys, not just the triggering PR. Events are
wakeups, not an ordered journal or commands to replay stale payloads.

The provider status key is exactly `(repository identity, SHA, context)`, not
PR number, description digest or target URL. For each actual head/eligible
test-merge target, enumerate every open in-scope PR that can consume that key.
Publish success only if every member has a fresh passing verdict for that
context. Evaluate each member's coverage, approval and native evidence under
its own source/specification/author rules before this final conjunction; never
pool mismatched evidence or let an owner's approval exception approve another
PR. A missing/failing/uncertain member makes the shared result non-passing.
Distinct verified merge targets may retain distinct results; do not assume
merge SHAs are either always unique or always shared.

Re-fetch complete paginated membership and each member's selected producer,
review, metadata and source facts before/after publication. Unknown membership
or changed inputs cannot produce success. Reconcile current keys after source,
base, description, review or open/closed membership changes so a departed PR
does not leave a shared key incorrectly blocked. If genuinely shared keys cannot
express different PR verdicts, block the shared group and identify the blocking
members; a separately authorized fresh source commit can give a PR an
independent key. A per-PR lock or a PR ID inside report text is not isolation.

Recompute eligibility on every reconciliation, but do not append redundant
pending/success records for unchanged keys. Bind a canonical digest of the
current member/input projection to the status and its retained observation,
excluding notification IDs and read timestamps. Reuse the latest expected-source
status only after confirming that digest, verdict, membership and all currentness
rules still match. A description, review, source, producer or freshness change
must be evaluated before any reuse; no-op suppression is not cached approval.
This prevents one PR's event from consuming every unchanged PR's write budget.

Respect the documented limit of 1,000 appended statuses per repository/SHA/
context. Count all existing statuses for the exact key across every API page,
including prior attempts and creators, before each write. Normal pending/final
writes may use at most the first 998 slots; no success is written when the
observed count is 998 or greater. This leaves two slots outside normal use.
At the cutoff, ensure a terminal non-passing status, preferably an explicit
capacity `error`, then freeze that key rather than append on every notification.
Reuse the confirmed capacity error; the normal transition needs at most slot
999. A remaining slot is only emergency non-passing capacity, never success.

All authorized writers of these contexts must use this coordinator/budget.
Reconcile a timed-out POST and its actual status/count before retrying; do not
spend reserved slots on blind retries. Missing pagination, unknown counts or
unverified writer control preclude a claimed passing protocol. If adoption
discovers a pre-existing exhausted key with old success, another failed workflow
cannot change that required status: report enforcement as unavailable and
require an authorized fresh source commit before enabling/claiming this gate.
Do not rename the context, delete/recreate the PR, force-push or change rules to
hide exhaustion. Fresh source validation uses its actual new identity and does
not relabel old evidence.

Preserve uncertain API effects and expose current blockers. These safeguards
close shared-key overwrite and reachable quota-exhaustion paths; they do not
turn mutable metadata/status APIs into an atomic merge transaction or defeat
an administrator deliberately bypassing the adopted writer controls.

Use fixed context names distinct from job names to avoid the same-name status/
check collision. Verify the selected provider/App source rather than hardcoding
an assumed installation ID. If the chosen token/source cannot provide an
enforceable required status, report the prerequisite gap; do not install a new
App, key or permission relationship automatically.

### 6.3 Conditional review and native conversation enforcement

Native GitHub approving-review counts are not conditional on PR authorship.
Do not pretend a global toggle expresses the solo-maintainer exception.

The trusted approval evaluator identifies the repository owner's immutable
account ID. Owner-authored PRs require no second human approval. Other PRs need
a current, non-dismissed approval from the maintainer for the current head.
Use actual opinionated review facts/commit identities, not comments or a
contributor's claimed review status.

Supported `pull_request_review` events can run an unprivileged policy-refresh
producer; its completion wakes the trusted observer. Treat it only as a wakeup:
the observer reacquires review facts itself. An external PR cannot alter trusted
policy/refresh definitions and approve that trust-root change with its own data;
such changes require maintainer-controlled adoption.

`pull_request_review_thread` is a webhook event, not a documented Actions trigger.
Do not depend on it to refresh merge eligibility. Enforce **all conversations
resolved** natively for all PRs; it applies even to owner-authored PRs. When
reporting merge readiness, paginate actual review-thread facts and keep them
distinct from approving reviews and CI validation. Native conversation rules
handle resolve/reopen transitions independently of a cached CI status.

Conditional approval via a status has event/reevaluation latency; it is not an
atomic native author-specific approval rule. Document that limitation and the
maintainer's responsibility to verify fresh external approval before normal
merge. A stronger atomic conditional control would require a separately agreed
provider capability/merge integration, not an unmentioned bypass or new service.
Tests must report actual observed enforcement at that assurance level.

### 6.4 Branch policy and threat boundary

Proposed `main` protection: PR-only changes, required current
validation/approval/coverage contexts, up-to-date branch and resolved
conversations; force push/deletion disabled; no silent CI exemption for
administrators. Do not enable auto-merge or
use admin merge flags as a substitute for policy.

Apply only after explicit owner consent and an actual successful observed status
from the intended source; then verify positive/negative controlled PR/ref cases
and effective settings. Read-only API access or this design grants no writes.
Test ordinary rejection without modifying production refs or merging broken code.

The authored disposable procedure is an owner-only `workflow_dispatch` in
`pr-policy-refresh.yml`, input `disposable-request`, running trusted default-
branch code with the fixed non-cancelling status-writer serialization and
contents/actions/PR read plus status-write permissions only. Its command is
`pr-readiness.mjs probe --evidence-dir` under a unique owned run/attempt root.
The request is exact version-1 `disposable-readiness-probe` data: id,
repository/repositoryId/PR number, head/base refs and SHAs, merge SHA, trusted
source commit, actual status writer/App identities and canonical effective
protection digest. The id is `[a-z][a-z0-9-]{5,31}`; refs are exactly
`readiness-probe/<id>/{head,base}` and required contexts exactly
`framework/disposable/<id>/{coverage,validation}` on the selected App.

A mandatory in-process authorizer acquires the actual dispatch run/path/source/
default/attempt/repository, owner actor and triggering actor, PR/ref/protection/
writer facts and request digest before the SDK mints an opaque capability.
Unknown fields or JSON approval/verified/Passed flags cannot authorize.
Prerequisite PR/refs/rules are separately precreated/approved; this helper has
no creation/settings/merge/delete methods and cannot touch main/production keys.
403/404, missing writer/authorizer or changed identities retain NotRun with no
status/settings POST. Every effect has an immutable fsynced dispatching record
before one SDK call; uncertainty requires reconciliation, not a retry.

After admission, real owned Node tests establish a two-pass baseline and a
required failure with passing sibling, retaining actual child output/exit.
Generic fixture evidence cannot become native proof. The normal provider
baseline must observe clean eligibility after both controlled contexts succeed.
Real coverage empty-body rejection and generic failed/missing-job/skipped/
missing-prerequisite variants then publish only scoped failure/pending statuses,
require fresh provider blocked observations, and restore clean baseline between
negatives except the final prerequisite. Fixed disposable normal/hard write
budgets are 8/10, separate from production 998/1000: force a terminal capacity
error at cutoff, reuse the confirmed error without another POST and observe final
blocked eligibility. Original JSON/NDJSON, generic bundles, actual failures and
clean/blocked observations are retained 90 days. No remote cleanup is inferred.
This describes an unexecuted source protocol, not actual provider enforcement.

Fork authors are untrusted; the owner and protected workflow administration are
trust roots. A malicious actor already allowed to edit trusted workflows or mint
equivalent write-token statuses is not defeated by naming a required check.
Protect that administrative boundary, restrict workflows that write statuses,
and expose unexpected status sources. Configuration-changing external proposals
may run safely but cannot self-redefine the trusted gate before maintainer adoption.

### 6.5 Coverage guardrail for this repository only

Add the proposed repository-owned `coverage-metadata.yml` workflow and thin CI
adapter, not a workflow installed by the framework into consumer projects.
Use supported `pull_request_target` activity types `opened`, `synchronize`,
`reopened`, `edited`, `closed` and `ready_for_review` so description removal can
invalidate coverage without a new commit and closure refreshes shared-key
membership. Keep this check cheap and independent of the
native test matrix; a metadata-only edit need not rerun all substantive tests.

The checker executes reviewed default-branch helpers only. It re-fetches the
actual PR body/head/base and reads the expected canonical specification files
at the selected source through bounded provider reads as data. No candidate
checkout, dependency install, helper import, cache restore or execution of PR
text is allowed in this status-writing job. Grant the shared reconciler the
required metadata/contents, Actions and PR/review read permissions for all
three context evaluations, plus status-write permission only. It gains no
PR-body write or publication/OIDC secrets; retained producer reports are bounded
data, never executable helpers.
Expected artifact sets and requiredness come from this repository's adopted CI
policy, not from a PR payload choosing an easier denominator.

Parse the one owned coverage section and compare its source/specification
identities and declared links with the actual canonical definitions. Missing,
empty, malformed, duplicate, stale or inconsistent metadata, and uncovered
required ACs, produce a non-passing `framework/coverage` result even when the
execution matrix passes. Complete matching metadata passes this guardrail only;
it neither approves the PR nor changes any test outcome. A coverage file, label,
comment, old green run or contributor-authored `Passed` flag is not a substitute.

Publish against actual PR head/eligible tested-merge keys using section 6.2,
never the event's default-branch `GITHUB_SHA`. The common reconciler includes
all PRs consuming each shared key and applies the reserved status-write budget;
this workflow may not publish its triggering PR's success independently.
Include member PR/source/specification/description identities and any capacity
blocker in the observed result and linked summary. Reacquire all relevant
current metadata before/after publication. As with normal CI, event processing
has latency; this is not an atomic lock on the mutable PR description.

Use native job/check details and `GITHUB_STEP_SUMMARY` for actionable missing
sections, AC/test identities and source mismatches. Keep declared coverage and
ordinary pass/fail test reports visibly separate. No LLM or bot service is
needed, and no extra consumer coverage files are produced.

Bootstrap the reviewed checker on the trusted branch, observe a real successful
context/source, then obtain the separately scoped rule-change/probe authority
before making it required. T-PRD085 covers controlled checker/event negatives;
T-PRD086 observes live absence/validity/deletion, actual shared-target association
and an expressly approved reduced-budget disposable probe, without exhausting
production status capacity or merging a probe. Neither observer is a
prerequisite of the gate it tests. This is
`urmich/ai-sdlc-framework` CI/CD policy only; consumers retain their own decisions.

## 7. Shared macOS distribution

Publish exactly:

- `ai-sdlc-framework-<version>.tgz`: existing cross-platform npm payload.
- `ai-sdlc-framework-<version>-macos.tar.gz`: one shared Mac standalone archive.
- `ai-sdlc-framework-<version>-windows-x64.zip`: separate Windows PE distribution.
- Required manager metadata, external descriptor and checksum files.

The Mac archive contains one copy of the exact payload and shell launcher.
Its proposed platform metadata version 2 declares `platform=darwin` and the
supported architecture list `[arm64, x64]`; this is not a Universal 2 executable.
Keep the payload inventory canonical and deterministic.

Readers accept supported legacy v1 single-architecture Mac archives without
rewriting them. New Mac packaging produces only v2/shared output. Windows keeps
its v1 platform/PE contract unless an independently required change demands more;
do not expand Go launcher scope merely to rename the Mac artifact.

Runtime validation checks native host architecture, selected Node's platform/
architecture/version and translation status before channel/home mutation.
Only membership in the shared Mac architecture list replaces the old single-arch
comparison; no integrity or native-runtime check is weakened. Existing immutable
channel versions and their current-launcher rollback state remain available.
Standalone control processes import the shared lightweight argument parser and
home resolver instead of loading the complete framework dispatcher and Store
before invoking the actual CLI. Preserve the CLI parser re-export, selected-home
defaults, argument/error precedence and every native/source/staging/launch
verification. The activated framework invocation still loads the real CLI;
there is no cached verdict or preverified bypass.

Separate `archiveTargets` from `executionPlatforms`: two standalone archives
versus Linux/Windows/Mac-arm64/Mac-x64 validation lanes. Generic archive-library
capability does not imply Linux release support or a complete native release.

Homebrew uses one stable URL/checksum and native `node@24`. Candidate native
tests may use a clearly test-only loopback formula serving verified frozen
bytes; never rewrite the stable release formula or checksum inventory to pass
prepublication tests. Both native Homebrew paths must actually execute install,
upgrade, test, uninstall/switch and post-removal runtime checks.

The user-directed baseline revision selects Node 24.20.0, Homebrew core commit
`0bae42d6d1e59c2c400da252bd64e585e3fe7d58`, and the existing pinned Brew/Ruby.
The complete 18-formula snapshot has 35 available native bottle archives; newer
24.21/24.22 root formulas lack Intel bottles. Pin the core checkout and disable
API formula installation and automatic updates rather than mixing older Node
with current dependencies. Registry metadata/HEAD checks establish availability
only; real installation verifies hashes, poured receipts, relocation and native
execution. Historical dependency-tab version skews are not assumed ABI passes.

Retain the actual native Mac bottle tag, macOS version, relocation-policy state
and unfiltered bottle candidate before evaluating compatibility. Homebrew's
`formula.bottle` filters incompatible candidates out; a missing return value
alone must not be reported as proof that the archive does not exist. Keep the
installer's own eligibility warnings and refuse installation when either
compatibility or pourability fails. Upload immutable bootstrap diagnostics as
soon as provisioning finishes, before the full suite; retain later cleanup in
a separate artifact so observation never requires interrupting healthy tests.

Run the source-owned Ruby probe through Homebrew's supported external-command
loader in its already initialized process. The pinned `brew ruby` command
executes a second Ruby instance after the parent `global.rb` has consumed the
ARM default-prefix environment variable; the second initialization computes an
invalid `/Cellar` and falsely rejects an available ARM bottle. Keep the probe
in a new owned checkout-local command directory, bind its exact bytes in the
bootstrap evidence, and scope its PATH entry to that single invocation.
Do not patch Brew constants, alter upstream formula metadata, force bottles or
change relocation policy to compensate for the initialization error.

Fixed-cellar Node/OpenSSL bottles require the genuinely owned short prefix
allocated by `native-homebrew-prefix.mjs`, not the long checkout path or an
existing global installation. Bind its literal filesystem identity and marker
to the canonical `GITHUB_WORKSPACE/source` checkout, bootstrap directory,
target, run, attempt and owner. Persist matching ownership evidence in the
checkout, verify it before lifecycle mutation, and clean only that allocation.
Privileged operations are limited to exclusive creation, ownership transfer
and removal of the exact empty directory; never use privileged recursive
deletion. An always-evaluated cleanup step retains its outcome after native
success, failure or interruption.

All four full native lanes use the selected Node 24.20.0 baseline. A separate
mandatory Linux Node 22.23.3 sanity/static job preserves minimum-supported-major
coverage without enlarging the local 27-assertion gate. The protected publisher
remains on its separate Node 24.22.0/npm 11.16.0 identity contract. Existing Node
22 Homebrew channel receipts and retained runtimes remain valid historical
inputs for switching; a new default formula does not rewrite or discard them.

## 8. Release graph and immutable evidence

### 8.1 One authorized entry

Keep the actual root caller `release.yml` and actual publishing environment `npm`
to preserve the established trusted-publisher identity. Proposed root entry is
maintainer `workflow_dispatch`, not arbitrary PR/merge/tag auto-publication.
Require explicit exact source SHA, version, destination and release intent.
Source must be the accepted protected-main candidate selected by that invocation;
workflow SHA and package version must agree.

Before building or writing tags/assets, verify actor/permissions, source/ref/
version consistency, required policy/checks, destination, tool pins, artifact
retention, registry trust and necessary environment capabilities. Missing
`RELEASE_REPOSITORY` or an inconsistent input gets an early actionable failure.
No implicit version bump or existing-version replacement occurs.

A single authorized release start covers the declared jobs; configure their
normal environment policy accordingly. Do not programmatically approve or
disable mandatory organization/environment reviewers to obtain automation.
Any incompatible external policy is a reported prerequisite requiring owner action.

### 8.2 Ordered operation graph

```text
authorized start, exact-source/policy/tool preflight
  -> deterministic payload, Windows launcher and platform assets
  -> frozen candidate bytes and producer identity
  -> parallel complete Linux / Windows / Mac arm64 / Mac Intel lanes, unit-first per lane
  -> complete R-PRE evidence and sealed bundle
  -> framework readiness admission
  -> matching GitHub tag/draft + verified exact assets
  -> data-only npm OIDC publication + exact readback
  -> GitHub release made public
  -> automatic native R-POST consumers and provenance verification
  -> durable attested completion evidence and final summary
```

Linux and native case inventories match the Test Plan's R-PRE profile.
Freezing the common candidate does not mark Linux source/static/schema/Go or
any other native obligation passed. Those complete lane reports remain mandatory
inputs to the final conjunction; they need not serialize all other hosts behind
the complete Linux regression. PR production follows the same freeze-once,
four-lane parallel pattern, with bounded actual resources on each host.
Public-download consumers are exclusively R-POST. Acceptance observers/reports
T-PRD055/056/074 assess completed flows afterwards; their own results are never
inputs to the flow they observe.

No package rebuild occurs between channels. If a comparison build differs,
stop rather than replace the frozen bytes. Keep action/callee permissions
explicit and pin external actions to reviewed full commits. Relative reviewed
repository-owned callees execute under the verified merged workflow source.
Any trusted helper needing a commit pin uses a reviewed bootstrap commit and
a later pinning change; never invent a self-referential commit SHA.

### 8.3 Data-only publisher

Retain the protected npm callee's no-checkout/no-repository-import/no-package-code
execution boundary. A contents-read verifier job evaluates framework readiness
and emits a digest-bound data handoff. The OIDC job verifies bounded inline data,
exact bundle/payload hashes, caller/source/environment and token-free auth before
publishing only that tgz. No secret inheritance or token fallback.

Independent artifact verification confirms the handoff came from the expected
source/run/verifier, not just that its JSON says ready. The sole tooling exception
is the approved integrity-pinned npm CLI, with scripts disabled. OIDC and
attestation-write privileges belong only to the jobs needing them.

### 8.4 Acyclic sealing

Use this dependency order:

1. Payload and standalone/manager assets.
2. External descriptor/checksums for those frozen distribution assets.
3. Native execution reports bound to those source/asset identities.
4. Bundle inventory and manifest, excluding its own bytes from its file list.
5. Readiness manifest referencing the completed bundle digest.
6. Separate evidence archive/attestation referencing bundle and readiness.
7. After publication, separate completion evidence referencing prior proof,
   publication effects and actual consumer reports.

The bundle does not contain a readiness file that hashes that same bundle.
Postpublication evidence is not inserted into already frozen distribution
checksums. Publish evidence archives under unique digest/attempt-bearing names;
old assets are never clobbered. The final release summary links the selected
evidence and actual outcomes without rewriting historical attempts.

### 8.5 Logical intent, physical attempts and retry

`releaseIntentId` identifies one authorized immutable source/version/destination/
configuration/bundle selection. Provider run/job/attempt IDs identify physical
executions and remain unchanged in original observations.

R-PRE executes freshly for that logical intent. A retry of only failed publishing
or verification within the same intent can consume its original R-PRE evidence
only when all declared source/spec/configuration/artifact/native-producer
conditions remain eligible and evidence is at most 24 hours old. It does not
claim those tests reran under the retry's provider attempt. A different logical
release or profile cannot borrow them. Expired/changed inputs require fresh
validation of the unchanged saved candidate, not repacking a new artifact under
the same release identity.
Reconcile the complete independent provider run/attempt chronology, not only the
selected artifact's own older passing run: A-pass/B-fail/C-selecting-A cannot
borrow A's proof. Bind the original preflight digest, source/intent and exact
artifact producer/step. Newer failed/cancelled/missing work and unresolved
original publication effects remain visible and prevent silent reuse; dropping
their dependencies or changing immutable input cannot erase uncertainty.

After a publish command succeeds, allow a bounded ten-minute propagation window
with observable backoff (1, 2, 4, 8, 16 seconds, then at most 30 seconds between
checks), honoring an earlier explicit provider retry delay within the budget.
Check exact version bytes/integrity and required provenance. A timeout after
success is incomplete/uncertain, not proof npm rejected the package.

Before any retry, reconcile existing package/tag/release/assets and provider
handles. Identical bytes/provenance allow safe no-op/resume; mismatches fail.
An existing package's authentication is not freshly credited as OIDC publication.
Never unpublish, move a tag, overwrite an asset, force-push or bump a version as
automatic failure recovery.

If npm is confirmed but GitHub promotion fails, retain that partial state and
fail overall completion. Automation cannot promise transactional rollback or
eliminate third-party outages.

## 9. Native consumers and provenance

Use the exact Test Plan toolchains, actual native probes and fresh fixture homes/
cache/config. Fetch public assets anonymously and compare external pins and
inventory before executing anything. Keep the offline lifecycle distinct from
network-enabled download/signature-verification stages.

Ordinary installation upgrade support is version-independent for recognized
`owner: ai-sdlc-framework`, `schemaVersion: 1` ownership data. File hashes and the
managed instructions block determine safe replacement; `previous.version` is
diagnostic/provenance data, not a whitelist or semver-order gate. Unknown
owner/schema, malformed/unprovable ownership and modified-owned conflicts
preserve existing content/state without destructive fallback. Explicit
`--purge-existing` is a separate irreversible reinstall, never an automatic
remedy. Compatibility of installed data does not imply that arbitrary old
executables can understand a future source layout.

Core T-42 establishes a genuine old home with public v0.3.1's own CLI, source
commit `8b2e4e8719b407454e28f84d716907b0ff834d3c`, then invokes the verified
new package's updater and checks updated installed doctor/idempotent update.
The retained fixture is `test/fixtures/upgrade-v0.3.1-source.tar.gz` with
`test/fixtures/upgrade-v0.3.1-source.json` provenance. Separate controlled
recognized-owner/schema-1 version-label fixtures are ownership-format proof, not fabricated old packages
or historical private release execution. No private v1.2.0 tag or all-version
binary sweep is required. Earlier T-42 evidence remains historical; the amended
definition is `NotRun` until actual validation. These assertions stay PR-only,
without adding a readiness case or expanding finite L.

Previous/current lifecycle inputs are independently pinned before parsing their
descriptor identity. Freeze `previousRelease` version/repository/descriptor/
checksum references with the candidate, then bind both old/current source,
payload and metadata identities. Windows executes actual PowerShell/cmd and Mac
actual bash/zsh. Candidate Homebrew uses an explicit previous-directory/current-
upgrade-directory with all four external metadata pins and keeps public
acceptance NotRun. Public Homebrew executes exact saved published formulas and
URLs without regeneration. A same-version formula revision cannot receive
R-PRE or R-POST version-upgrade credit.
After `brew upgrade` temporarily links the candidate, restore both captured
owned `opt` and linked-keg references before the normal promotion boundary.
Homebrew resolves `unlink` from `opt` before its linked-keg record, so restoring
only the launcher and linked-keg reference can select the wrong installed
version. Reuse the guarded link-restoration primitive; retain unidentified
replacements and reject missing capture records. Keep ordinary formula-based
link/unlink commands, captured payloads and the failed-promotion/retry assertions.
If the exact requested candidate keg is already present in the captured
rollback inventory, resume its verification and promotion rather than invoking
another upgrade over that retained version. Cellar/tap ownership, receipt
version, captured payload integrity and copied-framework checks remain
mandatory. An absent candidate still requires the real version upgrade; do not
force a reinstall, remove retained payloads or substitute formula-revision credit.
Ordinary PR CI supplies reviewed, source-controlled pins for the genuine public
v0.3.1 binary baseline, independent of repository variables. Its original
descriptor binds the legacy platform archives. This is a representative
regression input, not an installer support whitelist or the release workflow's
separately selected previous-release configuration.

Each actual operation verifies owned byte/manifest equality and zero changed
files for idempotence; ordinary uninstall removes every owned asset/manifest/
instruction block while preserving runtime/unrelated state. A separate offline
verified-tgz npm consumer invokes the npm-generated public shim, not an internal
entry fallback. All eight hook routes use valid isolated payloads and strict
companion checks with durable effects, so a fail-open empty response cannot
impersonate a working hook.

Completion reconstructs source/spec/config/inventory/artifact/native context
from frozen inputs and independently acquired provider run/job/step/log facts.
The unique `sdlc-consumer-evidence` producer marker binds original file digests
and native/bootstrap scope. Uploaded `report.context` never selects its own
expected context. Retain bounded sanitized originals and original/retained
digest pairs before admission, including failed/foreign/rejected attempts.
Matching observed failures remain Failed; missing/foreign origins remain
NotRun and block passing. Later successful attempts do not erase earlier bytes
or outcomes.

Exercise genuine prior-version channel upgrade using the explicitly selected
compatible previous public release, not a same-version reinstall or formula
revision. This representative channel input is not an installer support gate.
Retain old keg/channel/runtime before changing it. Verify installed hooks and
doctor after old-channel removal and dependency cleanup when that scenario
requires it. Cleanup affects only owned fixtures and preserves unrelated content.

For npm signatures/provenance, use a controlled registry-oriented audit prefix
with scripts/bin links disabled and the exact version/integrity selected.
Compare it with the independently verified payload before package execution.
Run the pinned npm signature tool in the approved hosted environment. A zero-
dependency/no-verification result is not a cryptographic pass; installing a
local tgz offline and seeing no audited registry package is insufficient.

For GitHub evidence attestations, use the trusted host's established verification
tool rather than implement Sigstore cryptography in the dependency-free core.
The verified CLI supports `gh attestation verify` with repository, signer workflow,
signer/source digests, source ref, predicate type, hosted-runner policy and JSON
output; offline bundles may be supplied. Require exact subject digests and
independently expected certificate/workflow/source identities.

A signed predicate is not inherently truthful test data: the trusted builder/
observer must independently validate the producer records before attesting
their evaluated manifest. Signature/certificate/transparency outcomes are recorded
separately from semantic metadata matching.

The native host verifies the exact retained signed statement bytes through the
integrity-pinned npm tool's existing Sigstore API and captured trust inputs.
Certificate URI/issuer, certificate-transparency and transparency-log policies
are checked separately; semantic source/workflow/subject checks apply to that
same cryptographically verified statement hash, not unrelated audit counts.
The required real-signed-fixture regression has no authenticated retained input
established here. Missing fixture/trust capability remains raw skip/NotRun,
never a unit-double substitute or a claim that cryptography/native execution passed.

WinGet community discovery and corporate-managed-client access are separate
capability outcomes. Neither local manifest validity nor GitHub availability
promises a corporate registry/CFS/OS-policy bypass.

## 10. Documentation and artifact migration

### 10.1 Reader structure

| Topic | Proposed canonical location |
| --- | --- |
| Entry and navigation | Root README and `docs/README.md` |
| Getting started / supported platforms | `docs/getting-started/` |
| Install, upgrade, channels, troubleshooting | `docs/installation/` |
| Lifecycle usage and operational examples | `docs/usage/` |
| Architecture / trust boundaries | `docs/architecture/` |
| CLI and evidence format reference | `docs/reference/` |
| GitHub / ADO / provider integrations | `docs/integrations/` |
| Contributor testing and maintenance | `docs/contributing/` |
| Release procedure, evidence and recovery | `docs/releases/` |
| Core internal specifications | `docs/sdlc/core-framework/{requirements,test-plan,technical-design}.md` |
| Feature internal specifications | `docs/sdlc/<existing-feature-slug>/{requirements,test-plan,technical-design}.md` |
| Declared requirement/test coverage | One versioned section in the PR description; no additional source-tree coverage artifact |

Keep a checked explicit old-to-new mapping for every moved file/anchor and
registered artifact. Preserve existing feature names, FR/T IDs, original snapshots
and execution records. Update README/topic links, relative anchors, templates,
checks, generator paths, package file lists and install-source readers together.
Do not keep two competing canonical specifications.

Source docs may move while the installed public locations such as
`sdlc/cli.md`, `provider-adapters.md` and `github-adapters.md` remain stable.
`distribution`/package verification read the new source locations and still
install those contracted destinations. Existing released packages stay unchanged.

One shipped Markdown/link implementation is reused by installer preflight and
the development checker. It parses inline/reference destinations and heading/
explicit anchors, rebases stable aliases, then validates the complete resulting
installed local target/fragment graph, including downstream guides. It
also checks all shipped skills/templates/instructions and its generated managed
block; it never interprets unrelated user Markdown as framework-owned.
Preflight finishes before ordinary update writes, obsolete-file deletion or
clean-install purge. Missing guides/anchors/modules reject the replacement
without changing the prior installation, runtime, manifest or unowned sentinels.
The regression replacement fixture must first be a complete valid package
including root policies/LICENSE before any mandatory module is omitted.

Use existing artifact registration/locking to relocate current authoritative
locators where the work-item binding permits it. Portable repository manifests
and runtime bindings are distinct: never hand-edit another active session's runtime
to pretend a cross-branch relocation was approved. Preserve old snapshot lookup
by content identity; stale current bindings remain explicit until legitimately
adopted/rebound. Link edits that affect specification identity invalidate current
credit under the existing contract; do not invent a formatting exclusion.
The nine actual portable locators in three older work items remain explicitly
unadopted while legitimate bound recovery is unavailable. Their exact mapping
and bounded supported future registration procedure are in
[documentation maintenance](../../contributing/documentation.md#blocked-current-locator-adoption).
No runtime/portable JSON hand-edit, historical rewrite, implicit old-path alias,
fabricated ACK or budget change substitutes for that admission.

### 10.2 Professional public entry points

Provide contributor, support, security-reporting, conduct, ownership/review and
change/release guidance. Derive versions/commands/platforms from current metadata
and tested examples; remove stale public pins and implementation-status claims.

Adopt the relevant reader/governance guidance from proposed FR-054 rather than
duplicate it: public third-party identity, reporting/support/contribution routes
and architectural trust boundaries. Do not silently claim completion of its
broader SBOM, CodeQL, institutional approval or account-security-control program.
Maintain an explicit adopted/deferred mapping.

Use verified GitHub private vulnerability reporting if separately enabled by the
owner; otherwise require an owner-supplied private reporting destination before
claiming that route exists. Do not invent a mailbox, corporate sponsorship or SLA.

Link/anchor/layout checking covers inline/reference links, headings, duplicate
slugs and moved canonical paths in the documented supported Markdown subset.
Unsupported constructs fail diagnostically rather than being silently ignored.
External reachability is checked through authorized tools where required; a local
parser does not prove a contact or provider feature is usable.

## 11. Adoption sequence and operational prerequisites

After Coding authorization, implement coherent increments:

1. Generic evidence/currentness interfaces, report schemas and compatibility;
   baseline inventory/critical profiles, strict authoring templates/skills,
   in-memory PR coverage preparation/inspection and focused negative tests.
2. Scheduler/fixture organization and complete native read-only PR producers;
   preserve assertions and collect comparable timings.
3. Trusted observer/bootstrap pins and effective status/review/conversation
   policy, including this repository's separate coverage-metadata guardrail.
   Prove a valid status before making it required; obtain explicit owner
   setting/probe consent and independently verify actual enforcement.
4. Shared Mac reader/writer and manager metadata, legacy upgrade compatibility,
   complete fresh native release gates and automatic public consumers.
5. Release orchestration, bounded recovery, durable attested evidence and one
   separately authorized new-version rehearsal.
6. Coherent documentation/locator/package migration and clean consumer guidance.

Maintain the living Test Plan throughout; all current statuses remain NotRun.
Local correctness tests precede broader checks, candidate implementation Review
and separately authorized publication. No production action follows merely from
a passing design or local build.

The final readable readiness report is a projection joining the existing public
evidence bundles with actual comparable benchmark records, effective protection
observations and immutable channel/attempt history. It is not a second ledger.
Its machine/readable views carry exact source/profile/context identities,
required/passed/failed/NotRun totals, timing input comparability, original failed
attempts, provider control observations and explicit missing capabilities.
Missing benchmark/protection/consumer proof yields a truthful partial or
non-passing report, not a filled-in success inferred from source configuration.
T-PRD056/T-PRD074 consume this report after the actual flows they observe; their
own outcome is never an input to that flow's production gate.

The concrete development adapter is `scripts/release-report.mjs`:
`composeReadinessReport({ manifest, plan, read, expectations, verifiers,
benchmarkVerifier, protectionVerifier, releaseVerifier, now })`.
The version-1 `repository-readiness-inputs` manifest binds `candidate` source
commit/test-spec digest and optional source/configuration digests; `checkpoints`
maps L/PR/R-PRE/R-POST/A/OBSERVERS to literal relative data references
`{ id, filename, sha256, size }`. Optional benchmark/protections references,
release-history reference arrays and explicit limitations complete the inputs.
It does not select the denominator: L derives exactly 16 canonical assertions
plus 11 risk roots, at most 27 total assertions including descendants.
The historical 69-local denominator is not a separate SDK stage or current
credit. PR/R-PRE/R-POST/A use the living Test Plan's closed 76/4/7/11 case sets,
and T-PRD019 is an explicit OBSERVERS output outside production gate inputs.

Each execution reference requires an independently supplied
`expectations[refId]: { specification, context }` and trusted public evidence
verifier; composition uses `readEvidenceBundle` and `renderReadinessReport`,
not saved `Passed`. Side verifiers bind the exact report digest and
`digest(candidate)` plus verifier identity; verified protection origin is
distinct from a Passed effective-protection outcome. Timing ratios require a
verified equivalent passing comparison. Missing expectation/verifier/proof is
NotRun. Relative paths cannot escape or select executable helpers.
CLI `--manifest-file`, `--plan-file`, `--output-dir` emits readiness.json/md,
but remains unverified without separately authorized in-process host
capabilities. This is ordinary retained execution-report input, not a new
consumer coverage/index/policy file.

Historical full-bundle recovery uses `scripts/release-retention.mjs`
`verifyHistoricalRelease`, with exact archive/attestation, independently
expected archive/bundle/source/intent identities, `as-of`, frozen assets and
an owned materialization directory. Raw signed `.jsonl` verification material
and digest-named trust metadata are separately retained assets created after
attestation, avoiding a hash cycle. The declared gh bundle verifier checks
repository/workflow/signer/source/ref/hosted/transparency policy offline.
An optional custom root needs an independently expected root hash. It performs
pure native replay at the chosen original <=24-hour as-of interval without
live CI/API/Git and returns historical status while CURRENT stays NotRun and
publication readiness false. No historical field renews current authority.
Completion-lifetime replay also retains its canonical plan/tree, independently
expected consumer contexts and captured provider-origin facts, and uses the
shared pure consumer evaluator. Recovering only prepublication proof does not
establish completion; every required postpublication original and publication
receipt remains part of that graph.
`verifyHistoricalCompletion(opts)` / CLI `release-retention.mjs completion`
therefore requires independently pinned completion and prepublication archives
and both attestation bundles, the same frozen bundle/source/intent, explicit
original as-of, frozen assets and owned receiver. Verify both signed subjects,
exact canonical plan/tree/repository identity, original-provider to retained
sanitized digest bridges and actual bootstrap/lifecycle/provenance through the
shared pure consumer evaluator. The aggregate provenance case replays exactly
the three admitted child hashes; missing closure is non-passing. Separate
Failed/Passed physical attempts remain immutable and CURRENT is always NotRun
with publication readiness false.
The concrete native boundary is
`replayNativeEvidence({ definition, data, candidate, asOf, verifyArchive })`.
It recompiles exact captured source as data only and compares derived
definitions and original commands/results, without Git/current checkout/live API
or archive-code execution. `data.texts` retains exact UTF-8 JSON/NDJSON/Markdown
while parsed originals must match those bytes. The separately codec-verified
candidate is not inferred from `data.files` or stored status.
The mandatory in-process archive verifier binds definition/report/candidate,
independently expected original producer context and source time/sequence.
The returned historical evaluation has `historical: true`, explicit as-of and
`currentCredit: NotRun`; current native verification remains a separate path.

Before claiming operational readiness, independently resolve:

- Actual hosted/tool/runtime availability, including the pinned Homebrew Node/
  portable Ruby paths and exact VM identities; no assumed immutable runner label.
- Complete per-platform applicability for every existing skip. Authentic public
  upgrade inputs, explicitly controlled ownership-format fixtures, unavailable
  Windows isolation and client-only capabilities remain distinct. Private Git
  history is not a public-fork prerequisite; no required behavior is silently
  dropped or converted to Passed for convenience.
- Actual commit-status/App association, branch/ruleset capabilities and the
  conditional-review assurance limitations described above.
- Publishing trust/environment rules and artifact-attestation/crypto capability.
  Permissions/settings require specific owner authority before changing them.
- A new candidate version greater than the selected package-manager proof input
  for real channel upgrade/rehearsal, not an installer version whitelist;
  version selection and live publication are explicit decisions.
- Retained evidence availability after CI expiry. Missing signed durable evidence
  is a blocker, not a reason to backfill old tests or mutate 0.4.0.

Unsupported controls stop the affected validation or operation and are reported.
Do not automatically provision replacement infrastructure, elevate privileges,
disable sandboxing, change registry hosts or modify corporate controls.

## 12. Requirements and test traceability

| Requirement | Design sections | Planned validation |
| --- | --- | --- |
| FR-200 | 3-4, 5.3, 6.1 | T-PRD001 through T-PRD004; T-PRD013; T-PRD083 |
| FR-201 | 4.3-4.4, 5.1, 11 | T-PRD005 through T-PRD009 |
| FR-202 | 4.3-4.4 | T-PRD010 through T-PRD013 |
| FR-203 | 4.1-4.2, 5.3, 6, 8.2 | T-PRD014-LX/WX/MA/MI; T-PRD015 through T-PRD019; T-PRD079-LX/WX/MA/MI |
| FR-204 | 5.2, 5.5, 6.1-6.4, 8.3 | T-PRD020 through T-PRD023 |
| FR-205 | 6.2-6.4 | T-PRD024 through T-PRD027; T-PRD080; T-PRD081 |
| FR-206 | 7-8 | T-PRD028 through T-PRD032; T-PRD079-LX/WX/MA/MI |
| FR-207 | 5.3-5.5, 8.4-8.5 | T-PRD033 through T-PRD037 |
| FR-208 | 7, 8.2, 9 | T-PRD038-WX/MA/MI; T-PRD039-WX/MA/MI; T-PRD040 through T-PRD042; T-PRD079-WX/MA/MI |
| FR-209 | 10 | T-PRD043 through T-PRD048 |
| FR-210 | 10-11 | T-PRD049 through T-PRD052 |
| FR-211 | 6.4, 8-9, 11 | T-PRD053 through T-PRD056 |
| FR-212 | 7-9 | T-PRD057 through T-PRD059; T-PRD060-MA/MI; T-PRD061 through T-PRD063; T-PRD079-MA/MI |
| FR-213 | 3, 4.5, 5, 6.2, 8.4-8.5, 9, 10-11 | T-PRD064 through T-PRD077; T-PRD082 through T-PRD084 |
| FR-214 | 3, 4.5, 6.2, 6.4-6.5, 11 | T-PRD084; T-PRD085; T-PRD086 |

T-PRD078 is not reintroduced: performed development reviews are not Test Plan
cases. T-PRD082 specifically proves that detached CI evidence cannot manufacture
interactive approvals or bypass managed admission.

## 13. Verified sources and remaining verification

Source/API discovery for this design is read-only. It is not evidence that any
future implementation, hosted job, policy probe or release succeeded.

- Existing repository interfaces named in section 2 and the current Test Plan.
- [Actions workflow events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows):
  default-branch `workflow_run` behavior and privilege warning; no documented
  `pull_request_review_thread` Actions trigger. Metadata-only
  `pull_request_target` supports `edited` and source/reopen events and must never
  execute untrusted candidate code.
- [GitHub CLI PR editing](https://cli.github.com/manual/gh_pr_edit):
  description updates accept body data or `--body-file -` standard input,
  without creating a repository coverage/body file.
- [Required status troubleshooting](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks):
  latest/test-merge SHA selection, skipped checks and workflow-job event limitations.
- [Commit status API](https://docs.github.com/en/rest/commits/statuses):
  explicit context/state publication, PR reflection and the 1,000-status
  repository/SHA/context limit.
- [Actions concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency):
  shared cross-workflow concurrency groups, non-cancellation of the active writer
  and pending-run coalescing; reconcile current state instead of assuming every
  event runs once.
- [Actions job summaries and annotations](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands#adding-a-job-summary):
  Markdown test summaries via `GITHUB_STEP_SUMMARY`, file/line error annotations,
  1 MiB per-step/20 displayed step-summary limits and summary-upload error behavior.
- [Workflow run logs](https://docs.github.com/en/actions/how-tos/monitor-workflows/use-workflow-run-logs)
  and [retained artifacts](https://docs.github.com/en/actions/tutorials/store-and-share-data):
  native job/step outcomes, diagnostic permalinks and complete uploaded reports.
- Read-only GitHub GraphQL introspection confirmed `reviewThreads`,
  `latestOpinionatedReviews`, `reviewDecision`, head/base/potential merge identities,
  thread resolution and review commit/state fields.
- Installed `gh attestation verify --help` confirmed the identity/digest/ref/
  predicate/hosted/offline verification options and the distinction between
  signed certificate/timestamp facts and potentially workflow-controlled predicates.

Runtime and provider-dependent claims remain unverified until their planned
actual checks pass. Technical Design approval would authorize implementation of
this solution, not imply successful tests, effective settings or release authority.
